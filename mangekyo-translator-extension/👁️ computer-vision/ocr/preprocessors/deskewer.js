/**
 * deskewer.js
 * 
 * Image deskewing (rotation correction) for manga/manhwa OCR preprocessing.
 * Detects and corrects skew angles in scanned/captured manga pages.
 * Optimized for CJK text orientation and manga panel layouts.
 */

import { PerformanceMonitor } from '../../shared/utils/performance-monitor.js';

/**
 * Configuration constants for deskewing operations
 */
const DESKEW_CONFIG = {
  // Angle detection range (degrees)
  MAX_SKEW_ANGLE: 45,
  MIN_SKEW_ANGLE: -45,
  
  // Resolution reduction for speed vs accuracy trade-off
  DOWNSAMPLE_WIDTH: 800,
  
  // Hough transform parameters
  HOUGH_THRESHOLD: 100,
  HOUGH_MIN_LINE_LENGTH: 100,
  HOUGH_MAX_LINE_GAP: 10,
  
  // Text line detection
  PROJECTION_SMOOTHING: 5,
  MIN_TEXT_HEIGHT: 20,
  
  // Performance
  MAX_PROCESSING_TIME: 5000, // ms
  
  // CJK specific: favor horizontal/vertical alignment
  PREFER_HORIZONTAL: true,
  ORIENTATION_CONFIDENCE_THRESHOLD: 0.7
};

/**
 * Deskewer class for rotation correction
 */
export class Deskewer {
  constructor(config = {}) {
    this.config = { ...DESKEW_CONFIG, ...config };
    this.performance = new PerformanceMonitor('Deskewer');
    this.canvas = null;
    this.ctx = null;
    this._initCanvas();
  }

  /**
   * Initialize offscreen canvas for processing
   */
  _initCanvas() {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(1, 1);
    } else {
      this.canvas = document.createElement('canvas');
    }
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Main entry point: detect and correct skew in image
   * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} image - Input image
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Deskew result with corrected image and metadata
   */
  async deskew(image, options = {}) {
    const startTime = performance.now();
    this.performance.start('deskew');
    
    try {
      // Setup canvas with image dimensions
      const width = image.width || image.videoWidth || image.naturalWidth;
      const height = image.height || image.videoHeight || image.naturalHeight;
      
      if (!width || !height) {
        throw new Error('Invalid image dimensions');
      }

      // Resize for processing if needed
      const scale = Math.min(1, this.config.DOWNSAMPLE_WIDTH / width);
      const procWidth = Math.floor(width * scale);
      const procHeight = Math.floor(height * scale);
      
      this.canvas.width = procWidth;
      this.canvas.height = procHeight;
      
      // Draw and get image data
      this.ctx.drawImage(image, 0, 0, procWidth, procHeight);
      const imageData = this.ctx.getImageData(0, 0, procWidth, procHeight);
      
      // Detect orientation (horizontal vs vertical text)
      const orientation = await this._detectOrientation(imageData);
      
      // Detect skew angle using appropriate method
      let skewAngle = 0;
      let confidence = 0;
      
      if (options.method === 'hough') {
        ({ angle: skewAngle, confidence } = await this._houghTransformDetect(imageData));
      } else if (options.method === 'projection') {
        ({ angle: skewAngle, confidence } = await this._projectionProfileDetect(imageData, orientation));
      } else {
        // Hybrid approach: use both methods and combine results
        const houghResult = await this._houghTransformDetect(imageData);
        const projResult = await this._projectionProfileDetect(imageData, orientation);
        
        // Weight by confidence
        if (houghResult.confidence > projResult.confidence) {
          skewAngle = houghResult.angle;
          confidence = houghResult.confidence;
        } else {
          skewAngle = projResult.angle;
          confidence = projResult.confidence;
        }
      }

      // Validate angle is within bounds
      if (Math.abs(skewAngle) > this.config.MAX_SKEW_ANGLE) {
        console.warn(`Detected skew angle ${skewAngle}° exceeds max, clamping`);
        skewAngle = Math.sign(skewAngle) * this.config.MAX_SKEW_ANGLE;
        confidence *= 0.5;
      }

      // Apply correction if significant skew detected
      let correctedImage = image;
      let applied = false;
      
      if (Math.abs(skewAngle) > 0.5 && confidence > 0.3) {
        correctedImage = await this._rotateImage(image, -skewAngle, width, height);
        applied = true;
      }

      const processingTime = performance.now() - startTime;
      this.performance.end('deskew');
      
      return {
        originalAngle: skewAngle,
        correctedAngle: applied ? -skewAngle : 0,
        confidence,
        orientation: orientation.type, // 'horizontal' | 'vertical' | 'mixed'
        orientationConfidence: orientation.confidence,
        applied,
        processingTime,
        image: correctedImage,
        metadata: {
          originalWidth: width,
          originalHeight: height,
          scaleFactor: scale,
          method: options.method || 'hybrid'
        }
      };
      
    } catch (error) {
      this.performance.end('deskew');
      console.error('Deskew failed:', error);
      return {
        originalAngle: 0,
        correctedAngle: 0,
        confidence: 0,
        error: error.message,
        applied: false,
        image
      };
    }
  }

  /**
   * Detect text orientation (horizontal vs vertical)
   * Critical for CJK manga where text can be either direction
   */
  async _detectOrientation(imageData) {
    const { width, height, data } = imageData;
    
    // Convert to binary for analysis
    const binary = this._binarize(data, width, height);
    
    // Calculate horizontal and vertical projections
    const hProj = new Array(height).fill(0);
    const vProj = new Array(width).fill(0);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (binary[y * width + x]) {
          hProj[y]++;
          vProj[x]++;
        }
      }
    }
    
    // Analyze projection variance
    // Horizontal text creates strong horizontal lines (high variance in vertical projection)
    // Vertical text creates strong vertical lines (high variance in horizontal projection)
    const hVariance = this._calculateVariance(hProj);
    const vVariance = this._calculateVariance(vProj);
    
    // Check for striping patterns
    const hStripes = this._countStripes(hProj);
    const vStripes = this._countStripes(vProj);
    
    // Combine metrics
    const hScore = (vVariance / (hVariance + 1)) * (hStripes + 1);
    const vScore = (hVariance / (vVariance + 1)) * (vStripes + 1);
    
    const total = hScore + vScore;
    const hConfidence = total > 0 ? hScore / total : 0.5;
    
    if (hConfidence > this.config.ORIENTATION_CONFIDENCE_THRESHOLD) {
      return { type: 'horizontal', confidence: hConfidence };
    } else if (hConfidence < (1 - this.config.ORIENTATION_CONFIDENCE_THRESHOLD)) {
      return { type: 'vertical', confidence: 1 - hConfidence };
    } else {
      return { type: 'mixed', confidence: 0.5 };
    }
  }

  /**
   * Detect skew using Hough Transform
   * Good for detecting panel borders and speech bubble edges
   */
  async _houghTransformDetect(imageData) {
    const { width, height, data } = imageData;
    
    // Edge detection using Sobel operator
    const edges = this._sobelEdgeDetection(data, width, height);
    
    // Hough transform accumulator
    const maxDist = Math.ceil(Math.sqrt(width * width + height * height));
    const angleStep = 1; // 1 degree resolution
    const numAngles = 180; // -90 to 89 degrees
    
    const accumulator = new Array(numAngles).fill(0).map(() => new Array(maxDist * 2).fill(0));
    
    // Vote in accumulator
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] > 128) {
          for (let thetaIdx = 0; thetaIdx < numAngles; thetaIdx++) {
            const theta = (thetaIdx - 90) * Math.PI / 180;
            const rho = x * Math.cos(theta) + y * Math.sin(theta);
            const rhoIdx = Math.floor(rho + maxDist);
            if (rhoIdx >= 0 && rhoIdx < maxDist * 2) {
              accumulator[thetaIdx][rhoIdx]++;
            }
          }
        }
      }
    }
    
    // Find peaks in accumulator
    let maxVotes = 0;
    let bestAngle = 0;
    
    for (let thetaIdx = 0; thetaIdx < numAngles; thetaIdx++) {
      const angle = thetaIdx - 90;
      // Skip near-vertical angles for horizontal text preference
      if (this.config.PREFER_HORIZONTAL && Math.abs(angle) > 85) continue;
      
      for (let rhoIdx = 0; rhoIdx < maxDist * 2; rhoIdx++) {
        if (accumulator[thetaIdx][rhoIdx] > maxVotes) {
          maxVotes = accumulator[thetaIdx][rhoIdx];
          bestAngle = angle;
        }
      }
    }
    
    // Calculate confidence based on peak sharpness
    const confidence = Math.min(1, maxVotes / (this.config.HOUGH_THRESHOLD * 2));
    
    return { angle: bestAngle, confidence };
  }

  /**
   * Detect skew using projection profile method
   * Optimized for text lines (horizontal) or text columns (vertical)
   */
  async _projectionProfileDetect(imageData, orientation) {
    const { width, height, data } = imageData;
    const binary = this._binarize(data, width, height);
    
    // Test angles in range
    const angles = [];
    const step = 0.5;
    for (let a = this.config.MIN_SKEW_ANGLE; a <= this.config.MAX_SKEW_ANGLE; a += step) {
      angles.push(a);
    }
    
    let bestAngle = 0;
    let maxVariance = 0;
    
    for (const angle of angles) {
      const variance = this._calculateProjectionVariance(binary, width, height, angle, orientation.type);
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = angle;
      }
    }
    
    // Confidence based on peak distinctness
    const confidence = Math.min(1, maxVariance / (width * height * 0.1));
    
    return { angle: bestAngle, confidence };
  }

  /**
   * Calculate projection variance for given angle
   */
  _calculateProjectionVariance(binary, width, height, angle, orientation) {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    // Rotate and project
    const projections = new Map();
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (binary[y * width + x]) {
          // Project onto axis perpendicular to text direction
          let proj;
          if (orientation === 'vertical') {
            // For vertical text, project onto x-axis (horizontal position)
            proj = Math.round(x * cos - y * sin);
          } else {
            // For horizontal text, project onto y-axis (vertical position)
            proj = Math.round(x * sin + y * cos);
          }
          
          projections.set(proj, (projections.get(proj) || 0) + 1);
        }
      }
    }
    
    // Calculate variance of projection histogram
    const values = Array.from(projections.values());
    if (values.length < 2) return 0;
    
    return this._calculateVariance(values);
  }

  /**
   * Rotate image by given angle using high-quality interpolation
   */
  async _rotateImage(image, angle, origWidth, origHeight) {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    // Calculate new bounding box
    const newWidth = Math.ceil(Math.abs(origWidth * cos) + Math.abs(origHeight * sin));
    const newHeight = Math.ceil(Math.abs(origWidth * sin) + Math.abs(origHeight * cos));
    
    // Setup canvas
    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    
    // Clear and set high-quality rendering
    this.ctx.clearRect(0, 0, newWidth, newHeight);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    
    // Perform rotation around center
    this.ctx.save();
    this.ctx.translate(newWidth / 2, newHeight / 2);
    this.ctx.rotate(rad);
    this.ctx.drawImage(image, -origWidth / 2, -origHeight / 2, origWidth, origHeight);
    this.ctx.restore();
    
    // Return as ImageBitmap for efficient processing
    if (typeof createImageBitmap !== 'undefined') {
      return await createImageBitmap(this.canvas);
    }
    
    return this.canvas;
  }

  /**
   * Binarize image data using adaptive threshold
   */
  _binarize(data, width, height) {
    const gray = new Uint8Array(width * height);
    const binary = new Uint8Array(width * height);
    
    // Convert to grayscale
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    
    // Simple adaptive threshold using local mean
    const windowSize = 15;
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        
        for (let wy = -halfWindow; wy <= halfWindow; wy++) {
          for (let wx = -halfWindow; wx <= halfWindow; wx++) {
            const ny = y + wy;
            const nx = x + wx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              sum += gray[ny * width + nx];
              count++;
            }
          }
        }
        
        const threshold = sum / count - 10; // Slight bias toward white
        const idx = y * width + x;
        binary[idx] = gray[idx] < threshold ? 1 : 0;
      }
    }
    
    return binary;
  }

  /**
   * Sobel edge detection
   */
  _sobelEdgeDetection(data, width, height) {
    const gray = new Uint8Array(width * height);
    const edges = new Uint8Array(width * height);
    
    // Grayscale conversion
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    
    // Sobel operators
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            gx += gray[idx] * sobelX[kernelIdx];
            gy += gray[idx] * sobelY[kernelIdx];
          }
        }
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y * width + x] = Math.min(255, magnitude);
      }
    }
    
    return edges;
  }

  /**
   * Calculate statistical variance
   */
  _calculateVariance(arr) {
    if (arr.length === 0) return 0;
    
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squaredDiffs = arr.map(v => (v - mean) ** 2);
    return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Count stripes in projection (indicates text lines/columns)
   */
  _countStripes(projection) {
    let stripes = 0;
    let inStripe = false;
    const threshold = Math.max(...projection) * 0.1;
    
    for (const val of projection) {
      if (val > threshold && !inStripe) {
        stripes++;
        inStripe = true;
      } else if (val <= threshold) {
        inStripe = false;
      }
    }
    
    return stripes;
  }

  /**
   * Batch process multiple images
   */
  async batchDeskew(images, options = {}) {
    const results = [];
    const concurrency = options.concurrency || 1;
    
    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const batchPromises = batch.map(img => this.deskew(img, options));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      if (options.onProgress) {
        options.onProgress(Math.min(i + concurrency, images.length), images.length);
      }
    }
    
    return results;
  }

  /**
   * Dispose resources
   */
  dispose() {
    this.canvas = null;
    this.ctx = null;
    this.performance.clear();
  }
}

/**
 * Factory function for quick deskewing
 */
export async function deskewImage(image, options = {}) {
  const deskewer = new Deskewer(options.config);
  try {
    return await deskewer.deskew(image, options);
  } finally {
    if (!options.keepAlive) {
      deskewer.dispose();
    }
  }
}

export default Deskewer;