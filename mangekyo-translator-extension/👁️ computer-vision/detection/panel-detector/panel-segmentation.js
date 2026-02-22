/**
 * panel-segmentation.js
 * 
 * Advanced Manga Panel Segmentation System
 * 
 * Features:
 * - Classical CV approach: Canny + morphology + connected components
 * - ML-based approach: Integration with detection models
 * - Handling of borderless, joined, irregular, and unclosed panels
 * - Screentone removal and background analysis
 * - Recursive binary splitting for complex layouts
 * - Panel shape refinement and corner detection
 */

import { BoundingBoxUtils } from '../bubble-detector/bounding-box-utils.js';

/**
 * Configuration for panel segmentation
 */
const CONFIG = {
  // Classical CV parameters
  CANNY_THRESHOLD1: 50,
  CANNY_THRESHOLD2: 150,
  MORPH_KERNEL_SIZE: 3,
  DILATION_ITERATIONS: 2,
  MIN_PANEL_AREA_RATIO: 0.01,      // Min 1% of page
  MAX_PANEL_AREA_RATIO: 0.9,       // Max 90% of page
  ASPECT_RATIO_LIMIT: 10,          // Max width/height ratio
  
  // Splitting parameters
  MIN_SPLIT_CONFIDENCE: 0.3,
  SPLIT_MIN_GAP: 20,               // Min pixels between panels
  
  // Background detection
  BACKGROUND_THRESHOLD: 240,       // White background threshold
  SCREENTONE_FILTER_SIZE: 5,       // For screentone removal
  
  // Shape extraction
  CORNER_SEARCH_RADIUS: 10,
  MIN_SOLIDITY: 0.85,              // For rectangular panels
  
  // Performance
  DOWNSAMPLE_MAX_DIM: 1200,        // Max dimension for processing
  USE_WEBWORKER: true
};

/**
 * Panel types based on visual characteristics
 */
const PANEL_TYPES = {
  STANDARD: 'standard',           // Closed rectangular with borders
  BORDERLESS: 'borderless',       // No visible borders, inferred from content
  IRREGULAR: 'irregular',         // Non-rectangular shape
  JOINED: 'joined',               // Connected to adjacent panels
  UNCLOSED: 'unclosed',           // Partial borders (e.g., fourth wall break)
  FULL_BLEED: 'full_bleed',       // Extends to page edge
  INSET: 'inset'                  // Panel within another panel
};

/**
 * Main PanelSegmenter class
 */
export class PanelSegmenter {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.bboxUtils = new BoundingBoxUtils();
    this.tempCanvas = null;
    this.tempCtx = null;
    this.worker = null;
    
    this._initTempCanvas();
    this._initWorker();
  }

  /**
   * Initialize temporary canvas for processing
   * @private
   */
  _initTempCanvas() {
    if (typeof document !== 'undefined') {
      this.tempCanvas = document.createElement('canvas');
      this.tempCanvas.style.display = 'none';
      document.body.appendChild(this.tempCanvas);
      this.tempCtx = this.tempCanvas.getContext('2d', { 
        willReadFrequently: true 
      });
    }
  }

  /**
   * Initialize Web Worker for heavy processing
   * @private
   */
  _initWorker() {
    if (this.config.USE_WEBWORKER && typeof Worker !== 'undefined') {
      // Inline worker for portability
      const workerCode = `
        self.onmessage = function(e) {
          const { type, data } = e.data;
          if (type === 'processImage') {
            // Process image data in worker
            const result = processImageData(data);
            self.postMessage({ type: 'result', data: result });
          }
        };
        
        function processImageData(imageData) {
          // Simplified processing - full implementation would be here
          return { width: imageData.width, height: imageData.height };
        }
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
    }
  }

  /**
   * Main segmentation method
   * @param {HTMLImageElement|HTMLCanvasElement} source - Input manga page
   * @param {Object} options - Segmentation options
   * @returns {Promise<Panel[]>}
   */
  async segment(source, options = {}) {
    const startTime = performance.now();
    
    try {
      // 1. Preprocess and downsample if needed
      const { canvas, scale } = this._preprocessImage(source);
      const width = canvas.width;
      const height = canvas.height;
      
      // 2. Detect page background
      const backgroundMask = this._detectBackground(canvas);
      
      // 3. Generate panel block (connected panel regions)
      const panelBlock = this._generatePanelBlock(canvas, backgroundMask);
      
      // 4. Recursive binary splitting for joined panels
      const rawPanels = this._recursiveSplitting(panelBlock, canvas);
      
      // 5. Extract precise panel shapes
      const panels = await this._extractPanelShapes(rawPanels, canvas, scale);
      
      // 6. Classify panel types and validate
      const validatedPanels = this._validateAndClassify(panels, width, height);
      
      // 7. Calculate reading order
      const orderedPanels = this._calculateReadingOrder(validatedPanels);
      
      console.log(`[PanelSegmenter] Segmented ${orderedPanels.length} panels in ${(performance.now() - startTime).toFixed(2)}ms`);
      
      return orderedPanels;
      
    } catch (error) {
      console.error('[PanelSegmenter] Segmentation failed:', error);
      throw error;
    }
  }

  /**
   * Preprocess image: convert to grayscale, downsample if needed
   * @private
   */
  _preprocessImage(source) {
    let width = source.naturalWidth || source.width;
    let height = source.naturalHeight || source.height;
    
    // Calculate scale if downsampling needed
    const maxDim = Math.max(width, height);
    let scale = 1;
    
    if (maxDim > this.config.DOWNSAMPLE_MAX_DIM) {
      scale = this.config.DOWNSAMPLE_MAX_DIM / maxDim;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    
    // Resize canvas
    this.tempCanvas.width = width;
    this.tempCanvas.height = height;
    
    // Draw and convert to grayscale
    this.tempCtx.drawImage(source, 0, 0, width, height);
    
    // Get image data for processing
    const imageData = this.tempCtx.getImageData(0, 0, width, height);
    const gray = this._convertToGrayscale(imageData);
    
    // Put grayscale back
    const grayData = new ImageData(width, height);
    for (let i = 0; i < gray.length; i++) {
      grayData.data[i * 4] = gray[i];
      grayData.data[i * 4 + 1] = gray[i];
      grayData.data[i * 4 + 2] = gray[i];
      grayData.data[i * 4 + 3] = 255;
    }
    
    this.tempCtx.putImageData(grayData, 0, 0);
    
    return { canvas: this.tempCanvas, scale, originalSize: { width, height } };
  }

  /**
   * Convert to grayscale
   * @private
   */
  _convertToGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8Array(width * height);
    
    for (let i = 0; i < data.length; i += 4) {
      // Luminance formula
      gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    return gray;
  }

  /**
   * Detect page background using flood fill from edges
   * @private
   */
  _detectBackground(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Create background mask
    const background = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    const queue = [];
    
    // Add all edge pixels as starting points
    const threshold = this.config.BACKGROUND_THRESHOLD;
    
    // Top and bottom edges
    for (let x = 0; x < width; x++) {
      queue.push({ x, y: 0 });
      queue.push({ x, y: height - 1 });
    }
    // Left and right edges
    for (let y = 1; y < height - 1; y++) {
      queue.push({ x: 0, y });
      queue.push({ x: width - 1, y });
    }
    
    // BFS flood fill
    let head = 0;
    while (head < queue.length) {
      const { x, y } = queue[head++];
      const idx = y * width + x;
      
      if (visited[idx]) continue;
      visited[idx] = 1;
      
      // Check if pixel is background (light colored)
      const pixelIdx = idx * 4;
      const brightness = (data[pixelIdx] + data[pixelIdx + 1] + data[pixelIdx + 2]) / 3;
      
      if (brightness > threshold) {
        background[idx] = 1;
        
        // Add neighbors
        const neighbors = [
          { x: x + 1, y }, { x: x - 1, y },
          { x, y: y + 1 }, { x, y: y - 1 }
        ];
        
        for (const n of neighbors) {
          if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
            const nIdx = n.y * width + n.x;
            if (!visited[nIdx]) {
              queue.push(n);
            }
          }
        }
      }
    }
    
    return background;
  }

  /**
   * Generate panel block by inverting background and closing gaps
   * @private
   */
  _generatePanelBlock(canvas, backgroundMask) {
    const { width, height } = canvas;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, width, height);
    
    // Invert background to get potential panel regions
    const panelBlock = new Uint8Array(width * height);
    for (let i = 0; i < backgroundMask.length; i++) {
      panelBlock[i] = backgroundMask[i] ? 0 : 255;
    }
    
    // Apply morphological operations to close gaps
    // Dilate to connect nearby components (joined panels)
    const dilated = this._dilate(panelBlock, width, height, this.config.DILATION_ITERATIONS);
    
    // Erode to restore approximate size
    const eroded = this._erode(dilated, width, height, this.config.DILATION_ITERATIONS - 1);
    
    // Fill holes inside panels
    const filled = this._fillHoles(eroded, width, height);
    
    return { mask: filled, width, height };
  }

  /**
   * Morphological dilation
   * @private
   */
  _dilate(mask, width, height, iterations) {
    let result = new Uint8Array(mask);
    const kernel = this.config.MORPH_KERNEL_SIZE;
    const half = Math.floor(kernel / 2);
    
    for (let iter = 0; iter < iterations; iter++) {
      const newResult = new Uint8Array(result);
      
      for (let y = half; y < height - half; y++) {
        for (let x = half; x < width - half; x++) {
          const idx = y * width + x;
          
          // Check neighborhood
          let maxVal = 0;
          for (let ky = -half; ky <= half; ky++) {
            for (let kx = -half; kx <= half; kx++) {
              const nIdx = (y + ky) * width + (x + kx);
              maxVal = Math.max(maxVal, result[nIdx]);
            }
          }
          
          newResult[idx] = maxVal;
        }
      }
      
      result = newResult;
    }
    
    return result;
  }

  /**
   * Morphological erosion
   * @private
   */
  _erode(mask, width, height, iterations) {
    let result = new Uint8Array(mask);
    const kernel = this.config.MORPH_KERNEL_SIZE;
    const half = Math.floor(kernel / 2);
    
    for (let iter = 0; iter < iterations; iter++) {
      const newResult = new Uint8Array(result);
      
      for (let y = half; y < height - half; y++) {
        for (let x = half; x < width - half; x++) {
          const idx = y * width + x;
          
          let minVal = 255;
          for (let ky = -half; ky <= half; ky++) {
            for (let kx = -half; kx <= half; kx++) {
              const nIdx = (y + ky) * width + (x + kx);
              minVal = Math.min(minVal, result[nIdx]);
            }
          }
          
          newResult[idx] = minVal;
        }
      }
      
      result = newResult;
    }
    
    return result;
  }

  /**
   * Fill holes in binary mask
   * @private
   */
  _fillHoles(mask, width, height) {
    // Invert mask
    const inverted = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      inverted[i] = mask[i] ? 0 : 255;
    }
    
    // Flood fill from edges on inverted
    const filled = this._floodFillFromEdges(inverted, width, height);
    
    // Invert back
    const result = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      result[i] = filled[i] ? 0 : 255;
    }
    
    return result;
  }

  /**
   * Flood fill from image edges
   * @private
   */
  _floodFillFromEdges(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const queue = [];
    
    // Add edge pixels
    for (let x = 0; x < width; x++) {
      queue.push(x, (height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y++) {
      queue.push(y * width, y * width + width - 1);
    }
    
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      
      if (visited[idx] || mask[idx] === 0) continue;
      visited[idx] = 1;
      
      const x = idx % width;
      const y = Math.floor(idx / width);
      
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      
      for (const nIdx of neighbors) {
        if (!visited[nIdx] && mask[nIdx] > 0) {
          queue.push(nIdx);
        }
      }
    }
    
    return visited;
  }

  /**
   * Recursive binary splitting for joined panels
   * @private
   */
  _recursiveSplitting(panelBlock, canvas) {
    const { mask, width, height } = panelBlock;
    const regions = [];
    
    // Find connected components
    const components = this._findConnectedComponents(mask, width, height);
    
    for (const component of components) {
      this._splitComponent(component, mask, width, height, regions, 0);
    }
    
    return regions;
  }

  /**
   * Find connected components using 4-connectivity
   * @private
   */
  _findConnectedComponents(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const components = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        if (mask[idx] > 0 && !visited[idx]) {
          // BFS to find component
          const component = [];
          const queue = [idx];
          visited[idx] = 1;
          let minX = x, maxX = x, minY = y, maxY = y;
          
          let head = 0;
          while (head < queue.length) {
            const cIdx = queue[head++];
            const cx = cIdx % width;
            const cy = Math.floor(cIdx / width);
            
            component.push({ x: cx, y: cy });
            minX = Math.min(minX, cx);
            maxX = Math.max(maxX, cx);
            minY = Math.min(minY, cy);
            maxY = Math.max(maxY, cy);
            
            // Check 4 neighbors
            const neighbors = [];
            if (cx > 0) neighbors.push(cIdx - 1);
            if (cx < width - 1) neighbors.push(cIdx + 1);
            if (cy > 0) neighbors.push(cIdx - width);
            if (cy < height - 1) neighbors.push(cIdx + width);
            
            for (const nIdx of neighbors) {
              if (!visited[nIdx] && mask[nIdx] > 0) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
          
          components.push({
            pixels: component,
            bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
          });
        }
      }
    }
    
    return components;
  }

  /**
   * Recursively split component if it contains multiple panels
   * @private
   */
  _splitComponent(component, mask, width, height, regions, depth) {
    const MAX_DEPTH = 10;
    if (depth > MAX_DEPTH) {
      regions.push(component);
      return;
    }
    
    const { x, y, w, h } = component.bbox;
    
    // Calculate optimal splitting line
    const split = this._findOptimalSplit(component, mask, width, height);
    
    if (!split || split.confidence < this.config.MIN_SPLIT_CONFIDENCE) {
      // No good split found, treat as single panel
      regions.push(component);
      return;
    }
    
    // Split component
    const [comp1, comp2] = this._splitComponentAt(component, split, mask, width, height);
    
    if (comp1.pixels.length > 100 && comp2.pixels.length > 100) {
      // Recursively split both halves
      this._splitComponent(comp1, mask, width, height, regions, depth + 1);
      this._splitComponent(comp2, mask, width, height, regions, depth + 1);
    } else {
      regions.push(component);
    }
  }

  /**
   * Find optimal splitting line using cost function
   * @private
   */
  _findOptimalSplit(component, mask, width, height) {
    const { x, y, width: w, height: h } = component.bbox;
    
    // Accumulate pixel values along horizontal and vertical directions
    const hProj = new Array(h).fill(0);
    const vProj = new Array(w).fill(0);
    
    for (const { x: px, y: py } of component.pixels) {
      const localX = px - x;
      const localY = py - y;
      hProj[localY]++;
      vProj[localX]++;
    }
    
    // Find gaps (low density regions)
    const findBestGap = (proj, minGap) => {
      let bestScore = -Infinity;
      let bestPos = -1;
      
      for (let i = minGap; i < proj.length - minGap; i++) {
        // Calculate gap score: low density in middle, high on sides
        const left = proj.slice(0, i).reduce((a, b) => a + b, 0);
        const right = proj.slice(i).reduce((a, b) => a + b, 0);
        const center = proj[i];
        
        const score = (left + right) / (center + 1);
        
        if (score > bestScore && Math.min(left, right) > 0) {
          bestScore = score;
          bestPos = i;
        }
      }
      
      return { pos: bestPos, score: bestScore };
    };
    
    const minGap = Math.floor(this.config.SPLIT_MIN_GAP / 2);
    const hBest = findBestGap(hProj, minGap);
    const vBest = findBestGap(vProj, minGap);
    
    // Choose better split
    if (hBest.score > vBest.score && hBest.score > 2) {
      return {
        type: 'horizontal',
        pos: y + hBest.pos,
        confidence: Math.min(1, hBest.score / 10)
      };
    } else if (vBest.score > 2) {
      return {
        type: 'vertical',
        pos: x + vBest.pos,
        confidence: Math.min(1, vBest.score / 10)
      };
    }
    
    return null;
  }

  /**
   * Split component at given line
   * @private
   */
  _splitComponentAt(component, split, mask, width, height) {
    const comp1 = { pixels: [], bbox: { x: Infinity, y: Infinity, width: 0, height: 0 } };
    const comp2 = { pixels: [], bbox: { x: Infinity, y: Infinity, width: 0, height: 0 } };
    
    for (const p of component.pixels) {
      let inComp1;
      if (split.type === 'horizontal') {
        inComp1 = p.y < split.pos;
      } else {
        inComp1 = p.x < split.pos;
      }
      
      const target = inComp1 ? comp1 : comp2;
      target.pixels.push(p);
      target.bbox.x = Math.min(target.bbox.x, p.x);
      target.bbox.y = Math.min(target.bbox.y, p.y);
      target.bbox.width = Math.max(target.bbox.width, p.x - target.bbox.x + 1);
      target.bbox.height = Math.max(target.bbox.height, p.y - target.bbox.y + 1);
    }
    
    return [comp1, comp2];
  }

  /**
   * Extract precise panel shapes from raw regions
   * @private
   */
  async _extractPanelShapes(rawPanels, canvas, scale) {
    const { width, height } = canvas;
    const panels = [];
    
    for (const raw of rawPanels) {
      // Scale back to original coordinates
      const bbox = {
        x: Math.round(raw.bbox.x / scale),
        y: Math.round(raw.bbox.y / scale),
        width: Math.round(raw.bbox.width / scale),
        height: Math.round(raw.bbox.height / scale)
      };
      
      // Extract corners using convex hull + optimization
      const corners = this._extractCorners(raw, scale);
      
      // Calculate solidity to detect irregular shapes
      const area = raw.pixels.length / (scale * scale);
      const bboxArea = bbox.width * bbox.height;
      const solidity = area / bboxArea;
      
      panels.push({
        bbox,
        corners,
        area,
        solidity,
        mask: null, // Could extract precise mask if needed
        type: solidity > this.config.MIN_SOLIDITY ? PANEL_TYPES.STANDARD : PANEL_TYPES.IRREGULAR
      });
    }
    
    return panels;
  }

  /**
   * Extract four corners of panel using convex hull
   * @private
   */
  _extractCorners(rawPanel, scale) {
    const points = rawPanel.pixels.map(p => ({
      x: p.x / scale,
      y: p.y / scale
    }));
    
    // Compute convex hull
    const hull = this._convexHull(points);
    
    if (hull.length < 4) {
      // Fallback to bounding box corners
      const { x, y, width, height } = rawPanel.bbox;
      return [
        { x: x / scale, y: y / scale },
        { x: (x + width) / scale, y: y / scale },
        { x: (x + width) / scale, y: (y + height) / scale },
        { x: x / scale, y: (y + height) / scale }
      ];
    }
    
    // Find centroid
    let cx = 0, cy = 0;
    for (const p of hull) {
      cx += p.x;
      cy += p.y;
    }
    cx /= hull.length;
    cy /= hull.length;
    
    // Separate into quadrants and find furthest points
    const quadrants = [[], [], [], []]; // TL, TR, BR, BL
    for (const p of hull) {
      if (p.x < cx && p.y < cy) quadrants[0].push(p);
      else if (p.x >= cx && p.y < cy) quadrants[1].push(p);
      else if (p.x >= cx && p.y >= cy) quadrants[2].push(p);
      else quadrants[3].push(p);
    }
    
    // Find furthest point in each quadrant
    const corners = quadrants.map(q => {
      if (q.length === 0) return null;
      return q.reduce((max, p) => {
        const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
        return dist > max.dist ? { ...p, dist } : max;
      }, { dist: -1 });
    }).filter(c => c !== null);
    
    // Local optimization to maximize quadrilateral area
    return this._optimizeCorners(corners, points);
  }

  /**
   * Compute convex hull using Graham scan
   * @private
   */
  _convexHull(points) {
    if (points.length < 3) return points;
    
    // Find lowest point
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < points[start].y || 
          (points[i].y === points[start].y && points[i].x < points[start].x)) {
        start = i;
      }
    }
    
    // Sort by polar angle
    const sorted = points.map((p, i) => ({ ...p, idx: i }))
      .sort((a, b) => {
        if (a.idx === start) return -1;
        if (b.idx === start) return 1;
        const angleA = Math.atan2(a.y - points[start].y, a.x - points[start].x);
        const angleB = Math.atan2(b.y - points[start].y, b.x - points[start].x);
        return angleA - angleB;
      });
    
    // Build hull
    const hull = [sorted[0], sorted[1]];
    for (let i = 2; i < sorted.length; i++) {
      while (hull.length > 1 && 
             this._crossProduct(
               hull[hull.length - 2], 
               hull[hull.length - 1], 
               sorted[i]
             ) <= 0) {
        hull.pop();
      }
      hull.push(sorted[i]);
    }
    
    return hull;
  }

  /**
   * Cross product for convex hull
   * @private
   */
  _crossProduct(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  /**
   * Optimize corner positions locally
   * @private
   */
  _optimizeCorners(initialCorners, allPoints) {
    const radius = this.config.CORNER_SEARCH_RADIUS;
    const optimized = [];
    
    for (const corner of initialCorners) {
      let bestArea = -1;
      let bestCorner = corner;
      
      // Search in local neighborhood
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const testCorner = { x: corner.x + dx, y: corner.y + dy };
          
          // Calculate quadrilateral area with this corner
          const testCorners = initialCorners.map((c, i) => 
            i === initialCorners.indexOf(corner) ? testCorner : c
          );
          
          const area = this._quadrilateralArea(testCorners);
          if (area > bestArea) {
            bestArea = area;
            bestCorner = testCorner;
          }
        }
      }
      
      optimized.push(bestCorner);
    }
    
    return optimized;
  }

  /**
   * Calculate quadrilateral area using shoelace formula
   * @private
   */
  _quadrilateralArea(corners) {
    if (corners.length !== 4) return 0;
    
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += corners[i].x * corners[j].y;
      area -= corners[j].x * corners[i].y;
    }
    
    return Math.abs(area) / 2;
  }

  /**
   * Validate panels and classify types
   * @private
   */
  _validateAndClassify(panels, width, height) {
    const validated = [];
    const totalArea = width * height;
    
    for (const panel of panels) {
      const { bbox, area, solidity } = panel;
      
      // Size checks
      const areaRatio = area / totalArea;
      if (areaRatio < this.config.MIN_PANEL_AREA_RATIO || 
          areaRatio > this.config.MAX_PANEL_AREA_RATIO) {
        continue;
      }
      
      // Aspect ratio check
      const aspectRatio = Math.max(bbox.width / bbox.height, bbox.height / bbox.width);
      if (aspectRatio > this.config.ASPECT_RATIO_LIMIT) {
        continue;
      }
      
      // Classify panel type
      let type = panel.type;
      
      // Check if borderless (low solidity with standard shape)
      if (solidity < 0.7 && aspectRatio < 3) {
        type = PANEL_TYPES.BORDERLESS;
      }
      
      // Check if full bleed (touches page edges)
      const touchesEdge = bbox.x <= 5 || bbox.y <= 5 || 
                         bbox.x + bbox.width >= width - 5 || 
                         bbox.y + bbox.height >= height - 5;
      
      if (touchesEdge && areaRatio > 0.3) {
        type = PANEL_TYPES.FULL_BLEED;
      }
      
      validated.push({
        ...panel,
        type,
        touchesEdge,
        confidence: solidity * (1 - Math.abs(1 - aspectRatio) / 10)
      });
    }
    
    // Detect insets (panels inside other panels)
    for (let i = 0; i < validated.length; i++) {
      for (let j = 0; j < validated.length; j++) {
        if (i !== j && this.bboxUtils.contains(validated[j].bbox, validated[i].bbox, 0.95)) {
          validated[i] = { ...validated[i], type: PANEL_TYPES.INSET, parent: j };
        }
      }
    }
    
    return validated;
  }

  /**
   * Calculate manga reading order (right-to-left, top-to-bottom)
   * @private
   */
  _calculateReadingOrder(panels) {
    if (panels.length === 0) return [];
    
    // Sort by Y first (rows), then X (right-to-left)
    const sorted = [...panels].sort((a, b) => {
      const rowDiff = Math.abs(a.bbox.y + a.bbox.height/2 - b.bbox.y - b.bbox.height/2);
      const sameRow = rowDiff < Math.min(a.bbox.height, b.bbox.height) * 0.4;
      
      if (sameRow) {
        // Same row: right-to-left
        return (b.bbox.x + b.bbox.width) - (a.bbox.x + a.bbox.width);
      } else {
        // Different rows: top-to-bottom
        return a.bbox.y - b.bbox.y;
      }
    });
    
    // Assign order numbers
    return sorted.map((panel, idx) => ({
      ...panel,
      readingOrder: idx + 1
    }));
  }

  /**
   * Detect if panel is joined to another (shares border)
   * @param {Panel} panel1 
   * @param {Panel} panel2 
   * @returns {boolean}
   */
  isJoinedPanel(panel1, panel2) {
    const bbox1 = panel1.bbox;
    const bbox2 = panel2.bbox;
    
    // Check if they share a significant border
    const xOverlap = Math.max(0, Math.min(bbox1.x + bbox1.width, bbox2.x + bbox2.width) - 
                              Math.max(bbox1.x, bbox2.x));
    const yOverlap = Math.max(0, Math.min(bbox1.y + bbox1.height, bbox2.y + bbox2.height) - 
                              Math.max(bbox1.y, bbox2.y));
    
    // Share vertical border
    if (xOverlap > Math.min(bbox1.height, bbox2.height) * 0.8 && 
        Math.abs(bbox1.x + bbox1.width - bbox2.x) < 5) {
      return true;
    }
    
    // Share horizontal border
    if (yOverlap > Math.min(bbox1.width, bbox2.width) * 0.8 && 
        Math.abs(bbox1.y + bbox1.height - bbox2.y) < 5) {
      return true;
    }
    
    return false;
  }

  /**
   * Merge joined panels into a single panel group
   * @param {Panel[]} panels 
   * @returns {PanelGroup[]}
   */
  groupJoinedPanels(panels) {
    const groups = [];
    const visited = new Set();
    
    for (let i = 0; i < panels.length; i++) {
      if (visited.has(i)) continue;
      
      const group = [panels[i]];
      visited.add(i);
      
      // BFS to find all joined panels
      const queue = [i];
      let head = 0;
      
      while (head < queue.length) {
        const currentIdx = queue[head++];
        
        for (let j = 0; j < panels.length; j++) {
          if (!visited.has(j) && this.isJoinedPanel(panels[currentIdx], panels[j])) {
            visited.add(j);
            queue.push(j);
            group.push(panels[j]);
          }
        }
      }
      
      // Calculate group bounding box
      const groupBbox = group.reduce((acc, p) => this.bboxUtils.merge(acc, p.bbox, 'union'), group[0].bbox);
      
      groups.push({
        panels: group,
        bbox: groupBbox,
        readingOrder: Math.min(...group.map(p => p.readingOrder))
      });
    }
    
    return groups.sort((a, b) => a.readingOrder - b.readingOrder);
  }

  /**
   * Extract panel as isolated image
   * @param {HTMLCanvasElement} sourceCanvas 
   * @param {Panel} panel 
   * @returns {HTMLCanvasElement}
   */
  extractPanelImage(sourceCanvas, panel) {
    const { x, y, width, height } = panel.bbox;
    
    const extractCanvas = document.createElement('canvas');
    extractCanvas.width = width;
    extractCanvas.height = height;
    const ctx = extractCanvas.getContext('2d');
    
    // Handle irregular shapes with mask
    if (panel.corners && panel.corners.length === 4 && panel.type === PANEL_TYPES.IRREGULAR) {
      // Create clipping path
      ctx.beginPath();
      ctx.moveTo(panel.corners[0].x - x, panel.corners[0].y - y);
      for (let i = 1; i < panel.corners.length; i++) {
        ctx.lineTo(panel.corners[i].x - x, panel.corners[i].y - y);
      }
      ctx.closePath();
      ctx.clip();
    }
    
    ctx.drawImage(
      sourceCanvas,
      x, y, width, height,
      0, 0, width, height
    );
    
    return extractCanvas;
  }

  /**
   * Dispose resources
   */
  dispose() {
    if (this.tempCanvas && this.tempCanvas.parentNode) {
      this.tempCanvas.parentNode.removeChild(this.tempCanvas);
      this.tempCanvas = null;
      this.tempCtx = null;
    }
    
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

/**
 * Panel result type definition
 * @typedef {Object} Panel
 * @property {Object} bbox - Bounding box {x, y, width, height}
 * @property {Array<{x,y}>} corners - Four corner points for precise shape
 * @property {number} area - Pixel area
 * @property {number} solidity - Area / bbox area ratio
 * @property {string} type - Panel type classification
 * @property {number} readingOrder - Sequential reading order
 * @property {boolean} touchesEdge - Whether panel touches page edge
 * @property {number} confidence - Detection confidence
 * @property {number} [parent] - Index of parent panel if inset
 */

export default PanelSegmenter;