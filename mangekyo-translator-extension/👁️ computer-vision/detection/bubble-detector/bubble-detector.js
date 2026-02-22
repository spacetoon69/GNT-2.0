/**
 * bubble-detector.js
 * 
 * Advanced Manga Speech Bubble Detection System
 * Uses TensorFlow.js for real-time bubble detection with CV preprocessing
 * 
 * Features:
 * - Multi-scale detection for various bubble sizes
 * - Contour analysis for irregular bubble shapes
 * - Confidence scoring with NMS (Non-Maximum Suppression)
 * - Integration with Manga109-style trained models
 */

import * as tf from '@tensorflow/tfjs';
import { BoundingBoxUtils } from './bounding-box-utils.js';

/**
 * Configuration constants for bubble detection
 */
const CONFIG = {
  // Model configuration
  MODEL_PATH: '/computer-vision/detection/bubble-detector/model/model.json',
  INPUT_SIZE: 416, // Model input size (square)
  CONFIDENCE_THRESHOLD: 0.65,
  NMS_IOU_THRESHOLD: 0.45,
  
  // Detection scales for multi-scale inference
  SCALES: [0.5, 1.0, 1.5, 2.0],
  
  // Preprocessing
  NORMALIZATION: {
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225]
  },
  
  // Post-processing
  MIN_BUBBLE_AREA: 400,      // Minimum pixel area for valid bubble
  MAX_BUBBLE_AREA: 500000,   // Maximum pixel area
  ASPECT_RATIO_LIMIT: 5.0,   // Max width/height ratio
  
  // Performance
  MAX_DETECTIONS_PER_IMAGE: 50,
  BATCH_SIZE: 4,
  
  // Canvas processing
  TEMP_CANVAS_ID: 'bubble-detector-temp-canvas'
};

/**
 * Bubble types classification
 */
const BUBBLE_TYPES = {
  SPEECH: 'speech',           // Standard speech bubble (oval/round)
  THOUGHT: 'thought',         // Cloud-style thought bubble
  NARRATION: 'narration',     // Rectangular narration box
  SFX: 'sfx',                 // Sound effect (onomatopoeia)
  WHISPER: 'whisper',         // Dashed/whisper bubble
  SHOUT: 'shout',             // Spiky/shout bubble
  UNKNOWN: 'unknown'
};

/**
 * Main BubbleDetector class
 */
export class BubbleDetector {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.model = null;
    this.isModelLoaded = false;
    this.bboxUtils = new BoundingBoxUtils();
    this.tempCanvas = null;
    this.tempCtx = null;
    
    // Performance metrics
    this.metrics = {
      inferenceTime: 0,
      preprocessingTime: 0,
      postprocessingTime: 0,
      totalDetections: 0
    };
    
    // Initialize temporary canvas for preprocessing
    this._initTempCanvas();
  }

  /**
   * Initialize offscreen canvas for image preprocessing
   * @private
   */
  _initTempCanvas() {
    if (typeof document !== 'undefined') {
      this.tempCanvas = document.createElement('canvas');
      this.tempCanvas.id = this.config.TEMP_CANVAS_ID;
      this.tempCanvas.style.display = 'none';
      document.body.appendChild(this.tempCanvas);
      this.tempCtx = this.tempCanvas.getContext('2d', { 
        willReadFrequently: true,
        alpha: false 
      });
    }
  }

  /**
   * Load the TensorFlow.js model
   * @returns {Promise<void>}
   */
  async loadModel() {
    if (this.isModelLoaded) return;
    
    try {
      console.log('[BubbleDetector] Loading model from:', this.config.MODEL_PATH);
      
      // Load model with custom weight loading if needed
      this.model = await tf.loadGraphModel(this.config.MODEL_PATH, {
        weightUrlConverter: this._weightUrlConverter.bind(this)
      });
      
      // Warm up the model with a dummy input
      const dummyInput = tf.zeros([1, this.config.INPUT_SIZE, this.config.INPUT_SIZE, 3]);
      await this.model.predict(dummyInput).data();
      tf.dispose(dummyInput);
      
      this.isModelLoaded = true;
      console.log('[BubbleDetector] Model loaded successfully');
      
    } catch (error) {
      console.error('[BubbleDetector] Failed to load model:', error);
      throw new Error(`Model loading failed: ${error.message}`);
    }
  }

  /**
   * Custom weight URL converter for WASM loading
   * @private
   */
  _weightUrlConverter(url) {
    // Handle WASM binary weight loading
    if (url.endsWith('.bin')) {
      return chrome.runtime.getURL(url);
    }
    return url;
  }

  /**
   * Main detection method
   * @param {HTMLImageElement|HTMLCanvasElement|ImageData} source - Input image
   * @param {Object} options - Detection options
   * @returns {Promise<BubbleDetection[]>}
   */
  async detect(source, options = {}) {
    if (!this.isModelLoaded) {
      await this.loadModel();
    }

    const startTime = performance.now();
    const detections = [];
    
    try {
      // 1. Preprocess image
      const preprocessStart = performance.now();
      const { tensor, scaleFactors, padding } = await this._preprocess(source);
      this.metrics.preprocessingTime = performance.now() - preprocessStart;
      
      // 2. Run inference with multi-scale detection
      const inferenceStart = performance.now();
      const rawDetections = await this._inferenceMultiScale(tensor, options);
      this.metrics.inferenceTime = performance.now() - inferenceStart;
      
      // 3. Post-process detections
      const postprocessStart = performance.now();
      const processedDetections = await this._postprocess(
        rawDetections, 
        scaleFactors, 
        padding,
        source.width || source.videoWidth || 800,
        source.height || source.videoHeight || 600
      );
      this.metrics.postprocessingTime = performance.now() - postprocessStart;
      
      // 4. Classify bubble types and refine boundaries
      const refinedDetections = await this._refineDetections(
        processedDetections, 
        source
      );
      
      detections.push(...refinedDetections);
      this.metrics.totalDetections = detections.length;
      
      console.log(`[BubbleDetector] Found ${detections.length} bubbles in ${(performance.now() - startTime).toFixed(2)}ms`);
      
    } catch (error) {
      console.error('[BubbleDetector] Detection error:', error);
      throw error;
    } finally {
      // Cleanup tensors
      tf.engine().startScope();
      tf.engine().endScope();
    }
    
    return detections;
  }

  /**
   * Preprocess image for model input
   * @private
   */
  async _preprocess(source) {
    const targetSize = this.config.INPUT_SIZE;
    
    // Get image dimensions
    let width, height;
    if (source instanceof ImageData) {
      width = source.width;
      height = source.height;
    } else {
      width = source.naturalWidth || source.videoWidth || source.width;
      height = source.naturalHeight || source.videoHeight || source.height;
    }
    
    // Calculate scaling to fit within target size while maintaining aspect ratio
    const scale = Math.min(targetSize / width, targetSize / height);
    const scaledWidth = Math.round(width * scale);
    const scaledHeight = Math.round(height * scale);
    
    // Calculate padding to center the image
    const padX = Math.round((targetSize - scaledWidth) / 2);
    const padY = Math.round((targetSize - scaledHeight) / 2);
    
    // Resize temp canvas
    this.tempCanvas.width = targetSize;
    this.tempCanvas.height = targetSize;
    
    // Fill with padding color (grey for model normalization)
    this.tempCtx.fillStyle = '#808080';
    this.tempCtx.fillRect(0, 0, targetSize, targetSize);
    
    // Draw image centered with padding
    if (source instanceof ImageData) {
      // Create temporary canvas for ImageData
      const tempImgCanvas = document.createElement('canvas');
      tempImgCanvas.width = width;
      tempImgCanvas.height = height;
      tempImgCanvas.getContext('2d').putImageData(source, 0, 0);
      this.tempCtx.drawImage(tempImgCanvas, padX, padY, scaledWidth, scaledHeight);
    } else {
      this.tempCtx.drawImage(source, padX, padY, scaledWidth, scaledHeight);
    }
    
    // Get image data and convert to tensor
    const imageData = this.tempCtx.getImageData(0, 0, targetSize, targetSize);
    const data = new Float32Array(imageData.data.length / 4 * 3);
    
    // Normalize and convert RGB to NCHW format with ImageNet normalization
    let idx = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      // R
      data[idx] = (imageData.data[i] / 255.0 - this.config.NORMALIZATION.mean[0]) / this.config.NORMALIZATION.std[0];
      // G
      data[idx + targetSize * targetSize] = (imageData.data[i + 1] / 255.0 - this.config.NORMALIZATION.mean[1]) / this.config.NORMALIZATION.std[1];
      // B
      data[idx + targetSize * targetSize * 2] = (imageData.data[i + 2] / 255.0 - this.config.NORMALIZATION.mean[2]) / this.config.NORMALIZATION.std[2];
      idx++;
    }
    
    const tensor = tf.tensor4d(data, [1, 3, targetSize, targetSize]);
    
    return {
      tensor,
      scaleFactors: { x: scale, y: scale },
      padding: { x: padX, y: padY },
      originalSize: { width, height }
    };
  }

  /**
   * Multi-scale inference for better small/large bubble detection
   * @private
   */
  async _inferenceMultiScale(tensor, options) {
    const allDetections = [];
    const scales = options.singleScale ? [1.0] : this.config.SCALES;
    
    for (const scale of scales) {
      let scaledTensor = tensor;
      
      // Resize for different scales if needed
      if (scale !== 1.0) {
        const newSize = Math.round(this.config.INPUT_SIZE * scale);
        scaledTensor = tf.image.resizeBilinear(tensor, [newSize, newSize]);
      }
      
      // Run inference
      const predictions = this.model.predict(scaledTensor);
      
      // Extract detection results
      // Model output format: [batch, num_boxes, 6] -> [x, y, w, h, confidence, class]
      const detectionData = await predictions.data();
      const numBoxes = detectionData.length / 6;
      
      for (let i = 0; i < numBoxes; i++) {
        const offset = i * 6;
        const confidence = detectionData[offset + 4];
        
        if (confidence > this.config.CONFIDENCE_THRESHOLD) {
          allDetections.push({
            x: detectionData[offset],
            y: detectionData[offset + 1],
            width: detectionData[offset + 2],
            height: detectionData[offset + 3],
            confidence: confidence,
            classId: Math.round(detectionData[offset + 5]),
            scale: scale
          });
        }
      }
      
      if (scale !== 1.0) {
        tf.dispose(scaledTensor);
      }
      tf.dispose(predictions);
    }
    
    return allDetections;
  }

  /**
   * Post-process raw detections with NMS and coordinate transformation
   * @private
   */
  async _postprocess(detections, scaleFactors, padding, origWidth, origHeight) {
    if (detections.length === 0) return [];
    
    // Apply Non-Maximum Suppression
    const nmsResults = this.bboxUtils.nms(
      detections,
      this.config.NMS_IOU_THRESHOLD
    );
    
    // Transform coordinates back to original image space
    const processed = nmsResults.map(det => {
      // Remove padding and rescale
      const x = (det.x - padding.x) / scaleFactors.x;
      const y = (det.y - padding.y) / scaleFactors.y;
      const width = det.width / scaleFactors.x;
      const height = det.height / scaleFactors.y;
      
      // Ensure bounds
      const clampedX = Math.max(0, Math.min(x, origWidth));
      const clampedY = Math.max(0, Math.min(y, origHeight));
      const clampedW = Math.min(width, origWidth - clampedX);
      const clampedH = Math.min(height, origHeight - clampedY);
      
      return {
        bbox: {
          x: clampedX,
          y: clampedY,
          width: clampedW,
          height: clampedH,
          centerX: clampedX + clampedW / 2,
          centerY: clampedY + clampedH / 2
        },
        confidence: det.confidence,
        classId: det.classId,
        type: this._classIdToType(det.classId),
        scale: det.scale
      };
    });
    
    // Filter by size constraints
    return processed.filter(det => {
      const area = det.bbox.width * det.bbox.height;
      const aspectRatio = Math.max(
        det.bbox.width / det.bbox.height,
        det.bbox.height / det.bbox.width
      );
      
      return area >= this.config.MIN_BUBBLE_AREA &&
             area <= this.config.MAX_BUBBLE_AREA &&
             aspectRatio <= this.config.ASPECT_RATIO_LIMIT;
    });
  }

  /**
   * Refine detections with contour analysis and type classification
   * @private
   */
  async _refineDetections(detections, source) {
    const refined = [];
    
    for (const det of detections) {
      try {
        // Extract region of interest
        const roi = await this._extractROI(source, det.bbox);
        
        // Analyze contour for better boundary fitting
        const contourInfo = await this._analyzeContour(roi, det.bbox);
        
        // Determine bubble type characteristics
        const characteristics = this._analyzeBubbleCharacteristics(
          roi, 
          contourInfo
        );
        
        refined.push({
          ...det,
          bbox: contourInfo.refinedBBox || det.bbox,
          contour: contourInfo.contour,
          mask: contourInfo.mask,
          characteristics,
          confidence: det.confidence * contourInfo.qualityScore,
          textRegion: this._estimateTextRegion(contourInfo),
          readingOrder: 0 // Will be calculated later
        });
        
      } catch (error) {
        console.warn('[BubbleDetector] Refinement failed for detection:', error);
        refined.push(det); // Use original if refinement fails
      }
    }
    
    // Calculate reading order (manga reading direction: right-to-left, top-to-bottom)
    return this._calculateReadingOrder(refined);
  }

  /**
   * Extract Region of Interest from source image
   * @private
   */
  async _extractROI(source, bbox) {
    const { x, y, width, height } = bbox;
    
    // Add padding for context
    const padding = 10;
    const padX = Math.max(0, x - padding);
    const padY = Math.max(0, y - padding);
    const padW = Math.min(width + padding * 2, source.width - padX);
    const padH = Math.min(height + padding * 2, source.height - padY);
    
    // Create ROI canvas
    const roiCanvas = document.createElement('canvas');
    roiCanvas.width = padW;
    roiCanvas.height = padH;
    const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
    
    // Draw ROI
    ctx.drawImage(
      source,
      padX, padY, padW, padH,  // Source
      0, 0, padW, padH         // Dest
    );
    
    return {
      canvas: roiCanvas,
      ctx: ctx,
      imageData: ctx.getImageData(0, 0, padW, padH),
      offset: { x: padX, y: padY },
      originalBbox: bbox
    };
  }

  /**
   * Analyze contour for precise bubble boundary
   * @private
   */
  async _analyzeContour(roi, originalBbox) {
    const { data, width, height } = roi.imageData;
    
    // Convert to grayscale
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    // Apply adaptive thresholding for bubble boundary detection
    const binary = this._adaptiveThreshold(gray, width, height, 15, 10);
    
    // Find contours using marching squares approximation
    const contours = this._findContours(binary, width, height);
    
    if (contours.length === 0) {
      return {
        refinedBBox: originalBbox,
        contour: null,
        mask: null,
        qualityScore: 0.8
      };
    }
    
    // Find largest contour (main bubble)
    const mainContour = contours.reduce((max, c) => 
      c.area > max.area ? c : max, contours[0]
    );
    
    // Fit bounding box to contour
    const minX = Math.min(...mainContour.points.map(p => p.x));
    const maxX = Math.max(...mainContour.points.map(p => p.x));
    const minY = Math.min(...mainContour.points.map(p => p.y));
    const maxY = Math.max(...mainContour.points.map(p => p.y));
    
    // Create mask
    const mask = new Uint8Array(width * height);
    this._fillPolygon(mask, width, height, mainContour.points);
    
    // Calculate quality score based on contour completeness
    const perimeter = mainContour.points.length;
    const area = mainContour.area;
    const circularity = 4 * Math.PI * area / (perimeter * perimeter);
    const qualityScore = Math.min(1.0, circularity * 1.5); // Boost circular bubbles
    
    return {
      refinedBBox: {
        x: roi.offset.x + minX,
        y: roi.offset.y + minY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: roi.offset.x + (minX + maxX) / 2,
        centerY: roi.offset.y + (minY + maxY) / 2
      },
      contour: mainContour.points.map(p => ({
        x: roi.offset.x + p.x,
        y: roi.offset.y + p.y
      })),
      mask: mask,
      qualityScore: qualityScore,
      circularity: circularity,
      solidity: area / ((maxX - minX) * (maxY - minY))
    };
  }

  /**
   * Adaptive thresholding for bubble segmentation
   * @private
   */
  _adaptiveThreshold(gray, width, height, blockSize, C) {
    const binary = new Uint8Array(width * height);
    const halfBlock = Math.floor(blockSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Calculate local mean
        let sum = 0;
        let count = 0;
        
        for (let dy = -halfBlock; dy <= halfBlock; dy++) {
          for (let dx = -halfBlock; dx <= halfBlock; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              sum += gray[ny * width + nx];
              count++;
            }
          }
        }
        
        const threshold = sum / count - C;
        const idx = y * width + x;
        binary[idx] = gray[idx] < threshold ? 255 : 0; // Inverted for bubbles
      }
    }
    
    return binary;
  }

  /**
   * Find contours using simple edge following
   * @private
   */
  _findContours(binary, width, height) {
    const visited = new Uint8Array(width * height);
    const contours = [];
    const directions = [[1,0], [1,1], [0,1], [-1,1], [-1,0], [-1,-1], [0,-1], [1,-1]];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        if (binary[idx] === 255 && !visited[idx]) {
          // Start new contour
          const contour = [];
          let cx = x, cy = y;
          let startIdx = idx;
          let steps = 0;
          const maxSteps = 10000;
          
          do {
            visited[cy * width + cx] = 1;
            contour.push({ x: cx, y: cy });
            
            // Find next edge pixel
            let found = false;
            for (let d = 0; d < 8; d++) {
              const nx = cx + directions[d][0];
              const ny = cy + directions[d][1];
              const nIdx = ny * width + nx;
              
              if (binary[nIdx] === 255 && !visited[nIdx]) {
                cx = nx;
                cy = ny;
                found = true;
                break;
              }
            }
            
            if (!found) break;
            steps++;
          } while ((cx !== x || cy !== y) && steps < maxSteps);
          
          if (contour.length > 20) { // Filter small noise
            // Calculate area using shoelace formula
            let area = 0;
            for (let i = 0; i < contour.length; i++) {
              const j = (i + 1) % contour.length;
              area += contour[i].x * contour[j].y;
              area -= contour[j].x * contour[i].y;
            }
            
            contours.push({
              points: contour,
              area: Math.abs(area) / 2
            });
          }
        }
      }
    }
    
    return contours;
  }

  /**
   * Fill polygon for mask generation
   * @private
   */
  _fillPolygon(mask, width, height, points) {
    // Simple scanline fill
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));
    
    for (let y = minY; y <= maxY; y++) {
      const intersections = [];
      
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const p1 = points[i];
        const p2 = points[j];
        
        if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
          const x = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
          intersections.push(x);
        }
      }
      
      intersections.sort((a, b) => a - b);
      
      for (let i = 0; i < intersections.length; i += 2) {
        const x1 = Math.max(0, Math.floor(intersections[i]));
        const x2 = Math.min(width, Math.ceil(intersections[i + 1]));
        
        for (let x = x1; x < x2; x++) {
          mask[y * width + x] = 1;
        }
      }
    }
  }

  /**
   * Analyze bubble characteristics for type classification
   * @private
   */
  _analyzeBubbleCharacteristics(roi, contourInfo) {
    const { width, height } = roi.canvas;
    const { circularity, solidity } = contourInfo;
    
    // Analyze edge characteristics for bubble type
    const edgeData = roi.ctx.getImageData(0, 0, width, height);
    const edgeScore = this._calculateEdgeRoughness(edgeData, contourInfo.contour);
    
    // Classify based on shape characteristics
    let type = BUBBLE_TYPES.UNKNOWN;
    let confidence = 0.5;
    
    if (circularity > 0.8 && solidity > 0.9) {
      type = BUBBLE_TYPES.SPEECH;
      confidence = circularity;
    } else if (circularity > 0.7 && edgeScore > 0.3) {
      type = BUBBLE_TYPES.THOUGHT; // Cloud-like irregular edges
      confidence = edgeScore;
    } else if (solidity > 0.95 && circularity < 0.5) {
      type = BUBBLE_TYPES.NARRATION; // Rectangular
      confidence = solidity;
    } else if (edgeScore > 0.5) {
      type = BUBBLE_TYPES.SFX; // Spiky/irregular
      confidence = edgeScore;
    }
    
    return {
      type,
      typeConfidence: confidence,
      circularity,
      solidity,
      edgeRoughness: edgeScore,
      hasTail: this._detectTail(roi, contourInfo),
      isVertical: height > width * 1.5
    };
  }

  /**
   * Calculate edge roughness for thought/cloud detection
   * @private
   */
  _calculateEdgeRoughness(imageData, contour) {
    if (!contour || contour.length < 10) return 0;
    
    // Sample points along contour and measure deviation from smooth curve
    let roughness = 0;
    const sampleStep = Math.max(1, Math.floor(contour.length / 20));
    
    for (let i = 0; i < contour.length; i += sampleStep) {
      const prev = contour[(i - sampleStep + contour.length) % contour.length];
      const curr = contour[i];
      const next = contour[(i + sampleStep) % contour.length];
      
      // Expected position if smooth
      const expectedX = (prev.x + next.x) / 2;
      const expectedY = (prev.y + next.y) / 2;
      
      // Deviation
      const dev = Math.sqrt(
        Math.pow(curr.x - expectedX, 2) + 
        Math.pow(curr.y - expectedY, 2)
      );
      
      roughness += dev;
    }
    
    // Normalize
    const avgRoughness = roughness / (contour.length / sampleStep);
    const bboxDiag = Math.sqrt(
      Math.pow(imageData.width, 2) + 
      Math.pow(imageData.height, 2)
    );
    
    return Math.min(1.0, avgRoughness / (bboxDiag * 0.1));
  }

  /**
   * Detect if bubble has a tail (speech indicator)
   * @private
   */
  _detectTail(roi, contourInfo) {
    // Analyze contour convexity defects for tail detection
    if (!contourInfo.contour) return false;
    
    const hull = this._convexHull(contourInfo.contour);
    const defects = this._convexityDefects(contourInfo.contour, hull);
    
    // Significant defect indicates tail
    const significantDefects = defects.filter(d => d.depth > 10);
    return significantDefects.length > 0;
  }

  /**
   * Calculate convex hull using Graham scan
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
   * Find convexity defects (indentations)
   * @private
   */
  _convexityDefects(contour, hull) {
    const hullSet = new Set(hull.map(p => `${p.x},${p.y}`));
    const defects = [];
    
    let i = 0;
    while (i < contour.length) {
      if (hullSet.has(`${contour[i].x},${contour[i].y}`)) {
        // Start of potential defect
        const start = contour[i];
        let end = null;
        let farthest = null;
        let maxDist = 0;
        
        let j = (i + 1) % contour.length;
        while (j !== i && !hullSet.has(`${contour[j].x},${contour[j].y}`)) {
          // Check distance to line between start and next hull point
          const nextHull = hull[(hull.indexOf(start) + 1) % hull.length];
          const dist = this._pointLineDistance(contour[j], start, nextHull);
          
          if (dist > maxDist) {
            maxDist = dist;
            farthest = contour[j];
            end = nextHull;
          }
          j = (j + 1) % contour.length;
        }
        
        if (farthest && maxDist > 5) {
          defects.push({ start, end, defect: farthest, depth: maxDist });
        }
        
        i = j;
      } else {
        i++;
      }
    }
    
    return defects;
  }

  /**
   * Point to line distance
   * @private
   */
  _pointLineDistance(p, lineStart, lineEnd) {
    const A = lineEnd.y - lineStart.y;
    const B = lineStart.x - lineEnd.x;
    const C = lineEnd.x * lineStart.y - lineStart.x * lineEnd.y;
    
    return Math.abs(A * p.x + B * p.y + C) / Math.sqrt(A * A + B * B);
  }

  /**
   * Estimate text region within bubble (padding removal)
   * @private
   */
  _estimateTextRegion(contourInfo) {
    if (!contourInfo.mask) return null;
    
    const { mask } = contourInfo;
    // Calculate safe text region by eroding mask
    // Simplified: return inset bbox
    const inset = 5; // pixels
    
    return {
      padding: inset,
      safeZone: {
        x: inset,
        y: inset,
        width: Math.max(0, contourInfo.refinedBBox.width - inset * 2),
        height: Math.max(0, contourInfo.refinedBBox.height - inset * 2)
      }
    };
  }

  /**
   * Calculate manga reading order (right-to-left, top-to-bottom)
   * @private
   */
  _calculateReadingOrder(detections) {
    // Sort by Y first (rows), then X (right-to-left within row)
    const sorted = [...detections].sort((a, b) => {
      const rowDiff = Math.abs(a.bbox.centerY - b.bbox.centerY);
      const sameRow = rowDiff < Math.min(a.bbox.height, b.bbox.height) * 0.5;
      
      if (sameRow) {
        // Same row: right-to-left (higher X first)
        return b.bbox.centerX - a.bbox.centerX;
      } else {
        // Different rows: top-to-bottom
        return a.bbox.centerY - b.bbox.centerY;
      }
    });
    
    // Assign order numbers
    return sorted.map((det, idx) => ({
      ...det,
      readingOrder: idx + 1
    }));
  }

  /**
   * Convert class ID to bubble type
   * @private
   */
  _classIdToType(classId) {
    const types = [
      BUBBLE_TYPES.SPEECH,
      BUBBLE_TYPES.THOUGHT,
      BUBBLE_TYPES.NARRATION,
      BUBBLE_TYPES.SFX,
      BUBBLE_TYPES.WHISPER,
      BUBBLE_TYPES.SHOUT
    ];
    return types[classId] || BUBBLE_TYPES.UNKNOWN;
  }

  /**
   * Batch detection for multiple images
   * @param {Array<HTMLImageElement>} images 
   * @returns {Promise<Array<BubbleDetection[]>>}
   */
  async detectBatch(images) {
    const results = [];
    const batchSize = this.config.BATCH_SIZE;
    
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchPromises = batch.map(img => this.detect(img));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Real-time detection with video stream
   * @param {HTMLVideoElement} video 
   * @param {Function} onDetection - Callback for each frame
   * @param {Object} options 
   */
  async detectVideoStream(video, onDetection, options = {}) {
    const { fps = 5, maxDuration = 30000 } = options;
    const interval = 1000 / fps;
    let isRunning = true;
    let lastTime = 0;
    
    const processFrame = async (timestamp) => {
      if (!isRunning) return;
      
      if (timestamp - lastTime >= interval) {
        try {
          // Create frame canvas
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0);
          
          const detections = await this.detect(canvas);
          onDetection(detections, timestamp);
          
          lastTime = timestamp;
        } catch (error) {
          console.error('[BubbleDetector] Frame processing error:', error);
        }
      }
      
      if (timestamp < maxDuration) {
        requestAnimationFrame(processFrame);
      }
    };
    
    requestAnimationFrame(processFrame);
    
    return () => { isRunning = false; };
  }

  /**
   * Get performance metrics
   * @returns {Object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics() {
    this.metrics = {
      inferenceTime: 0,
      preprocessingTime: 0,
      postprocessingTime: 0,
      totalDetections: 0
    };
  }

  /**
   * Dispose resources
   */
  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.isModelLoaded = false;
    
    if (this.tempCanvas && this.tempCanvas.parentNode) {
      this.tempCanvas.parentNode.removeChild(this.tempCanvas);
      this.tempCanvas = null;
      this.tempCtx = null;
    }
    
    tf.disposeVariables();
  }
}

/**
 * Detection result type definition
 * @typedef {Object} BubbleDetection
 * @property {Object} bbox - Bounding box {x, y, width, height, centerX, centerY}
 * @property {number} confidence - Detection confidence (0-1)
 * @property {string} type - Bubble type (speech, thought, etc.)
 * @property {number} classId - Numeric class ID
 * @property {Array<{x,y}>} contour - Polygon points for precise boundary
 * @property {Uint8Array} mask - Binary mask of bubble region
 * @property {Object} characteristics - Shape analysis results
 * @property {Object} textRegion - Estimated text-safe zone
 * @property {number} readingOrder - Sequential reading order
 * @property {number} scale - Detection scale used
 */

export default BubbleDetector;