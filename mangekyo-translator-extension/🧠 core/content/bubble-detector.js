/**
 * Bubble Detector - Computer Vision Module
 * Detects speech bubbles, text regions, and panel layouts in manga images
 * Uses TensorFlow.js models with fallback heuristic detection
 */

import { CONFIG } from '../shared/constants.js';
import { ImageUtils } from '../shared/utils/image-utils.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class BubbleDetector {
  constructor(config = {}) {
    this.config = {
      modelPath: '/computer-vision/detection/bubble-detector/model/',
      confidenceThreshold: 0.75,
      nmsThreshold: 0.3, // Non-maximum suppression
      maxDetections: 50,
      inputSize: 640, // Model input size
      useWebGL: true,
      fallbackToHeuristics: true,
      ...config
    };

    this.model = null;
    this.modelLoading = null;
    this.performanceMonitor = new PerformanceMonitor('bubble-detector');
    
    // Detection class mappings
    this.classNames = {
      0: 'speech_bubble',
      1: 'thought_bubble',
      2: 'narration_box',
      3: 'sfx_bubble',
      4: 'panel',
      5: 'text_line'
    };

    // Cache for repeated detections
    this.detectionCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize detector and load model
   */
  async init() {
    if (this.model) return true;
    if (this.modelLoading) return this.modelLoading;

    this.modelLoading = this.loadModel();
    return this.modelLoading;
  }

  /**
   * Load TensorFlow.js model
   */
  async loadModel() {
    const perfMark = this.performanceMonitor.start('loadModel');
    
    try {
      // Check if TF.js is available
      if (typeof tf === 'undefined') {
        await this.loadTensorFlowJS();
      }

      // Configure backend
      if (this.config.useWebGL && tf.backend() !== 'webgl') {
        await tf.setBackend('webgl');
        console.log('[BubbleDetector] Using WebGL backend');
      }

      // Load model
      const modelUrl = chrome.runtime.getURL(this.config.modelPath + 'model.json');
      this.model = await tf.loadGraphModel(modelUrl);
      
      // Warm up model
      const dummyInput = tf.zeros([1, this.config.inputSize, this.config.inputSize, 3]);
      await this.model.predict(dummyInput).data();
      dummyInput.dispose();

      console.log('[BubbleDetector] Model loaded successfully');
      this.performanceMonitor.end(perfMark);
      return true;

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[BubbleDetector] Model loading failed:', error);
      
      if (this.config.fallbackToHeuristics) {
        console.warn('[BubbleDetector] Falling back to heuristic detection');
        return false;
      }
      throw error;
    }
  }

  /**
   * Load TensorFlow.js library dynamically
   */
  loadTensorFlowJS() {
    return new Promise((resolve, reject) => {
      if (typeof tf !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('lib/tf.min.js');
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Main detection entry point
   * @param {ImageData|HTMLImageElement|HTMLCanvasElement} source 
   * @returns {Promise<Array>} Detected bubble regions
   */
  async detect(source) {
    const perfMark = this.performanceMonitor.start('detect');
    
    try {
      // Initialize if needed
      await this.init();

      // Normalize input
      const imageData = await this.normalizeInput(source);
      
      // Check cache
      const cacheKey = await ImageUtils.hashImageData(imageData);
      if (this.detectionCache.has(cacheKey)) {
        const cached = this.detectionCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          console.log('[BubbleDetector] Returning cached results');
          return cached.results;
        }
      }

      let detections = [];

      // Try ML detection if model available
      if (this.model) {
        detections = await this.mlDetection(imageData);
      }

      // Fallback or supplement with heuristics
      if (detections.length === 0 || !this.model) {
        const heuristicDetections = await this.heuristicDetection(imageData);
        detections = this.mergeDetections(detections, heuristicDetections);
      }

      // Post-process
      const processed = this.postProcessDetections(detections, imageData);
      
      // Cache results
      this.detectionCache.set(cacheKey, {
        results: processed,
        timestamp: Date.now()
      });

      this.performanceMonitor.end(perfMark);
      return processed;

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[BubbleDetector] Detection failed:', error);
      throw error;
    }
  }

  /**
   * Normalize various input types to ImageData
   */
  async normalizeInput(source) {
    if (source instanceof ImageData) {
      return source;
    }

    if (source instanceof HTMLImageElement) {
      return ImageUtils.imageToImageData(source);
    }

    if (source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d');
      return ctx.getImageData(0, 0, source.width, source.height);
    }

    throw new Error(`Unsupported input type: ${typeof source}`);
  }

  /**
   * ML-based detection using TensorFlow.js
   */
  async mlDetection(imageData) {
    const perfMark = this.performanceMonitor.start('mlDetection');
    
    try {
      // Preprocess image
      const tensor = this.preprocessImage(imageData);
      
      // Run inference
      const predictions = this.model.predict(tensor);
      const [boxes, scores, classes, validDetections] = predictions;
      
      // Get data from tensors
      const boxesData = await boxes.data();
      const scoresData = await scores.data();
      const classesData = await classes.data();
      const validCount = (await validDetections.data())[0];

      // Cleanup tensors
      tensor.dispose();
      boxes.dispose();
      scores.dispose();
      classes.dispose();
      validDetections.dispose();

      // Parse results
      const detections = [];
      const [batch, maxDetections] = boxesData.shape || [1, this.config.maxDetections];
      
      for (let i = 0; i < Math.min(validCount, maxDetections); i++) {
        const score = scoresData[i];
        
        if (score < this.config.confidenceThreshold) continue;

        const classId = Math.round(classesData[i]);
        const bbox = boxesData.slice(i * 4, (i + 1) * 4);
        
        // Convert normalized coords to pixel coords
        const [y1, x1, y2, x2] = Array.from(bbox);
        const width = imageData.width;
        const height = imageData.height;

        detections.push({
          x: x1 * width,
          y: y1 * height,
          width: (x2 - x1) * width,
          height: (y2 - y1) * height,
          confidence: score,
          class: this.classNames[classId] || 'unknown',
          classId: classId,
          source: 'ml'
        });
      }

      this.performanceMonitor.end(perfMark);
      return detections;

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      throw error;
    }
  }

  /**
   * Preprocess image for model input
   */
  preprocessImage(imageData) {
    const { data, width, height } = imageData;
    
    // Create tensor from pixel data
    const tensor = tf.browser.fromPixels({
      data: new Uint8ClampedArray(data),
      width,
      height
    });

    // Resize with padding to maintain aspect ratio
    const resized = tf.image.resizeBilinear(tensor, [
      this.config.inputSize, 
      this.config.inputSize
    ]);

    // Normalize to [0, 1]
    const normalized = resized.div(255.0);
    
    // Add batch dimension
    const batched = normalized.expandDims(0);
    
    tensor.dispose();
    resized.dispose();
    normalized.dispose();
    
    return batched;
  }

  /**
   * Heuristic-based bubble detection (fallback)
   */
  async heuristicDetection(imageData) {
    const perfMark = this.performanceMonitor.start('heuristicDetection');
    const detections = [];

    try {
      // Convert to grayscale and threshold
      const { binary, gray } = this.binarizeImage(imageData);
      
      // Find connected components
      const components = this.findConnectedComponents(binary, imageData.width, imageData.height);
      
      // Analyze each component
      for (const comp of components) {
        const features = this.analyzeComponent(comp, gray, imageData.width, imageData.height);
        
        if (this.isBubbleCandidate(features)) {
          detections.push({
            x: comp.minX,
            y: comp.minY,
            width: comp.maxX - comp.minX,
            height: comp.maxY - comp.minY,
            confidence: features.confidence,
            class: this.classifyBubbleType(features),
            classId: -1,
            source: 'heuristic',
            features: features
          });
        }
      }

      // Additional pass: detect rectangular panels
      const panels = this.detectPanels(binary, imageData.width, imageData.height);
      detections.push(...panels);

      this.performanceMonitor.end(perfMark);
      return detections;

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[BubbleDetector] Heuristic detection error:', error);
      return [];
    }
  }

  /**
   * Binarize image using adaptive thresholding
   */
  binarizeImage(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8Array(width * height);
    const binary = new Uint8Array(width * height);

    // Convert to grayscale
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // Adaptive thresholding (simplified)
    const windowSize = 15;
    const C = 10;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // Calculate local mean
        let sum = 0, count = 0;
        for (let wy = -windowSize; wy <= windowSize; wy++) {
          for (let wx = -windowSize; wx <= windowSize; wx++) {
            const ny = y + wy, nx = x + wx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              sum += gray[ny * width + nx];
              count++;
            }
          }
        }
        
        const threshold = (sum / count) - C;
        binary[idx] = gray[idx] < threshold ? 1 : 0;
      }
    }

    return { binary, gray };
  }

  /**
   * Find connected components using union-find
   */
  findConnectedComponents(binary, width, height) {
    const visited = new Uint8Array(width * height);
    const components = [];

    for (let y = 0; y < height; y += 2) { // Skip for performance
      for (let x = 0; x < width; x += 2) {
        const idx = y * width + x;
        
        if (binary[idx] === 1 && !visited[idx]) {
          const component = this.floodFill(binary, x, y, width, height, visited);
          
          if (component.pixels.length > 100) { // Min size filter
            components.push(component);
          }
        }
      }
    }

    return components;
  }

  /**
   * Flood fill algorithm
   */
  floodFill(binary, startX, startY, width, height, visited) {
    const stack = [[startX, startY]];
    const component = {
      pixels: [],
      minX: startX, maxX: startX,
      minY: startY, maxY: startY,
      edgePixels: []
    };

    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const idx = y * width + x;

      if (visited[idx] || binary[idx] !== 1) continue;
      visited[idx] = 1;

      component.pixels.push([x, y]);
      component.minX = Math.min(component.minX, x);
      component.maxX = Math.max(component.maxX, x);
      component.minY = Math.min(component.minY, y);
      component.maxY = Math.max(component.maxY, y);

      // Check if edge pixel
      let isEdge = false;
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          isEdge = true;
          continue;
        }
        const nidx = ny * width + nx;
        if (binary[nidx] === 0) isEdge = true;
        else if (!visited[nidx]) stack.push([nx, ny]);
      }
      
      if (isEdge) component.edgePixels.push([x, y]);
    }

    return component;
  }

  /**
   * Analyze component features
   */
  analyzeComponent(component, gray, width, height) {
    const w = component.maxX - component.minX;
    const h = component.maxY - component.minY;
    const area = component.pixels.length;
    const perimeter = component.edgePixels.length;
    
    // Shape features
    const aspectRatio = w / h;
    const compactness = (perimeter * perimeter) / (4 * Math.PI * area);
    const fillRatio = area / (w * h);
    
    // Convex hull approximation (simplified)
    const convexity = this.estimateConvexity(component);
    
    // Roundness check (for bubbles)
    const isRound = compactness < 1.5 && convexity > 0.8;
    
    // Check for tail (speech bubble indicator)
    const hasTail = this.detectTail(component, w, h);
    
    // Calculate confidence
    let confidence = 0.5;
    
    if (isRound) confidence += 0.2;
    if (hasTail) confidence += 0.2;
    if (aspectRatio > 0.5 && aspectRatio < 2.0) confidence += 0.1;
    if (fillRatio > 0.3 && fillRatio < 0.95) confidence += 0.1;
    
    // Size checks
    const isValidSize = w > 30 && h > 20 && w < width * 0.8 && h < height * 0.5;
    if (!isValidSize) confidence *= 0.5;

    return {
      width: w,
      height: h,
      area,
      aspectRatio,
      compactness,
      fillRatio,
      convexity,
      isRound,
      hasTail,
      isValidSize,
      confidence: Math.min(confidence, 0.95)
    };
  }

  /**
   * Estimate convexity using bounding box ratio
   */
  estimateConvexity(component) {
    const w = component.maxX - component.minX;
    const h = component.maxY - component.minY;
    const bboxArea = w * h;
    return component.pixels.length / bboxArea;
  }

  /**
   * Detect if component has a tail (speech bubble feature)
   */
  detectTail(component, width, height) {
    if (component.edgePixels.length < 10) return false;
    
    // Find centroid
    let cx = 0, cy = 0;
    for (const [x, y] of component.pixels) {
      cx += x;
      cy += y;
    }
    cx /= component.pixels.length;
    cy /= component.pixels.length;
    
    // Check for protrusions (tail candidates)
    const bbox = {
      minX: component.minX, maxX: component.maxX,
      minY: component.minY, maxY: component.maxY
    };
    
    let tailCount = 0;
    for (const [x, y] of component.edgePixels) {
      // Check if point is far from centroid but close to bbox edge
      const distFromCenter = Math.hypot(x - cx, y - cy);
      const maxDist = Math.max(width, height) / 2;
      
      if (distFromCenter > maxDist * 0.8) {
        // Check if it's a sharp point (few neighbors)
        const neighbors = this.countEdgeNeighbors(x, y, component.edgePixels);
        if (neighbors < 3) tailCount++;
      }
    }
    
    return tailCount > 0 && tailCount < 5;
  }

  /**
   * Count neighboring edge pixels
   */
  countEdgeNeighbors(x, y, edgePixels) {
    let count = 0;
    for (const [ex, ey] of edgePixels) {
      if (ex === x && ey === y) continue;
      if (Math.abs(ex - x) <= 1 && Math.abs(ey - y) <= 1) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if component is a bubble candidate
   */
  isBubbleCandidate(features) {
    return features.confidence > 0.6 && features.isValidSize;
  }

  /**
   * Classify bubble type based on features
   */
  classifyBubbleType(features) {
    if (features.hasTail) return 'speech_bubble';
    if (features.isRound && features.fillRatio > 0.7) return 'thought_bubble';
    if (!features.isRound && features.aspectRatio > 1.5) return 'narration_box';
    if (features.area < 2000) return 'sfx_bubble';
    return 'speech_bubble';
  }

  /**
   * Detect rectangular panels
   */
  detectPanels(binary, width, height) {
    const panels = [];
    
    // Look for large rectangular regions with low fill ratio (white space inside)
    const visited = new Uint8Array(width * height);
    
    for (let y = 10; y < height - 10; y += 10) {
      for (let x = 10; x < width - 10; x += 10) {
        const idx = y * width + x;
        if (visited[idx]) continue;
        
        // Try to find rectangular border
        const panel = this.findRectangularRegion(binary, x, y, width, height, visited);
        
        if (panel && panel.width > 100 && panel.height > 100) {
          panels.push({
            x: panel.x,
            y: panel.y,
            width: panel.width,
            height: panel.height,
            confidence: 0.7,
            class: 'panel',
            classId: 4,
            source: 'heuristic'
          });
        }
      }
    }
    
    return panels;
  }

  /**
   * Find rectangular region by following edges
   */
  findRectangularRegion(binary, startX, startY, width, height, visited) {
    // Simplified: look for horizontal and vertical line segments
    const minLineLength = 50;
    
    // Scan right for horizontal line
    let right = startX;
    while (right < width && binary[startY * width + right] === 1) right++;
    
    if (right - startX < minLineLength) return null;
    
    // Scan down for vertical line
    let bottom = startY;
    while (bottom < height && binary[bottom * width + startX] === 1) bottom++;
    
    if (bottom - startY < minLineLength) return null;
    
    // Mark visited
    for (let y = startY; y < bottom; y++) {
      for (let x = startX; x < right; x++) {
        visited[y * width + x] = 1;
      }
    }
    
    return {
      x: startX,
      y: startY,
      width: right - startX,
      height: bottom - startY
    };
  }

  /**
   * Merge ML and heuristic detections
   */
  mergeDetections(mlDetections, heuristicDetections) {
    if (mlDetections.length === 0) return heuristicDetections;
    if (heuristicDetections.length === 0) return mlDetections;
    
    const merged = [...mlDetections];
    
    // Add heuristic detections that don't overlap significantly with ML
    for (const h of heuristicDetections) {
      let overlaps = false;
      for (const m of mlDetections) {
        const iou = this.calculateIoU(h, m);
        if (iou > 0.5) {
          overlaps = true;
          break;
        }
      }
      
      if (!overlaps) {
        merged.push(h);
      }
    }
    
    return merged;
  }

  /**
   * Post-process detections
   */
  postProcessDetections(detections, imageData) {
    // Non-maximum suppression
    let filtered = this.nonMaxSuppression(detections);
    
    // Filter by confidence
    filtered = filtered.filter(d => d.confidence >= this.config.confidenceThreshold);
    
    // Sort by priority (speech bubbles first, then panels, etc.)
    const priority = { speech_bubble: 0, thought_bubble: 1, narration_box: 2, sfx_bubble: 3, panel: 4 };
    filtered.sort((a, b) => (priority[a.class] || 5) - (priority[b.class] || 5));
    
    // Add metadata
    filtered.forEach((d, i) => {
      d.id = `bubble_${i}_${Date.now()}`;
      d.centerX = d.x + d.width / 2;
      d.centerY = d.y + d.height / 2;
      d.imageWidth = imageData.width;
      d.imageHeight = imageData.height;
    });
    
    return filtered;
  }

  /**
   * Non-maximum suppression
   */
  nonMaxSuppression(detections) {
    // Sort by confidence
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    const suppressed = new Set();
    const result = [];

    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue;
      
      const current = sorted[i];
      result.push(current);
      
      // Suppress overlapping boxes
      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed.has(j)) continue;
        
        const other = sorted[j];
        const iou = this.calculateIoU(current, other);
        
        if (iou > this.config.nmsThreshold) {
          suppressed.add(j);
        }
      }
    }
    
    return result;
  }

  /**
   * Calculate Intersection over Union
   */
  calculateIoU(box1, box2) {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
    
    if (x2 <= x1 || y2 <= y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;
    
    return intersection / union;
  }

  /**
   * Detect panel grid layout
   */
  detectPanelLayout(detections) {
    const panels = detections.filter(d => d.class === 'panel');
    
    if (panels.length === 0) return null;
    
    // Find grid structure
    const rows = this.groupIntoRows(panels);
    const cols = this.groupIntoColumns(panels);
    
    return {
      type: rows.length > 1 ? 'grid' : 'single',
      rows: rows.length,
      columns: cols.length,
      readingOrder: this.inferReadingOrder(rows),
      panels: panels.map((p, i) => ({
        ...p,
        row: rows.findIndex(r => r.includes(p)),
        col: cols.findIndex(c => c.includes(p)),
        index: i
      }))
    };
  }

  /**
   * Group detections into rows
   */
  groupIntoRows(detections) {
    const rows = [];
    const sorted = [...detections].sort((a, b) => a.y - b.y);
    
    for (const det of sorted) {
      let added = false;
      for (const row of rows) {
        const rowY = row[0].centerY;
        if (Math.abs(det.centerY - rowY) < det.height * 0.5) {
          row.push(det);
          added = true;
          break;
        }
      }
      if (!added) rows.push([det]);
    }
    
    return rows;
  }

  /**
   * Group detections into columns
   */
  groupIntoColumns(detections) {
    const cols = [];
    const sorted = [...detections].sort((a, b) => a.x - b.x);
    
    for (const det of sorted) {
      let added = false;
      for (const col of cols) {
        const colX = col[0].centerX;
        if (Math.abs(det.centerX - colX) < det.width * 0.5) {
          col.push(det);
          added = true;
          break;
        }
      }
      if (!added) cols.push([det]);
    }
    
    return cols;
  }

  /**
   * Infer reading order from panel layout
   */
  inferReadingOrder(rows) {
    // Japanese manga: right-to-left, top-to-bottom
    // Korean/Chinese manhwa: left-to-right, top-to-bottom
    
    const isRTL = this.config.readingDirection === 'rtl';
    
    const order = [];
    for (let r = 0; r < rows.length; r++) {
      const row = [...rows[r]].sort((a, b) => 
        isRTL ? b.centerX - a.centerX : a.centerX - b.centerX
      );
      order.push(...row.map(d => d.id));
    }
    
    return order;
  }

  /**
   * Associate bubbles with panels
   */
  associateBubblesWithPanels(detections) {
    const bubbles = detections.filter(d => 
      ['speech_bubble', 'thought_bubble', 'narration_box', 'sfx_bubble'].includes(d.class)
    );
    const panels = detections.filter(d => d.class === 'panel');
    
    // Assign each bubble to containing panel
    bubbles.forEach(bubble => {
      let bestPanel = null;
      let bestOverlap = 0;
      
      for (const panel of panels) {
        const overlap = this.calculateOverlapRatio(bubble, panel);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestPanel = panel;
        }
      }
      
      bubble.panelId = bestPanel?.id || null;
      bubble.panelOverlap = bestOverlap;
    });
    
    return detections;
  }

  /**
   * Calculate overlap ratio of inner box with outer box
   */
  calculateOverlapRatio(inner, outer) {
    const x1 = Math.max(inner.x, outer.x);
    const y1 = Math.max(inner.y, outer.y);
    const x2 = Math.min(inner.x + inner.width, outer.x + outer.width);
    const y2 = Math.min(inner.y + inner.height, outer.y + outer.height);
    
    if (x2 <= x1 || y2 <= y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const innerArea = inner.width * inner.height;
    
    return intersection / innerArea;
  }

  /**
   * Clear detection cache
   */
  clearCache() {
    this.detectionCache.clear();
  }

  /**
   * Dispose model to free memory
   */
  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.clearCache();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BubbleDetector;
}

export default BubbleDetector;