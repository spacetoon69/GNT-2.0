// /computer-vision/ocr/preprocessors/binarizer.js

/**
 * Manga Image Binarization Module
 * Adaptive thresholding with background removal and text enhancement
 * Handles both standard (black text on white) and inverted (white text on black) manga
 * @module Binarizer
 */

import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const BINARIZER_CONFIG = {
  // Method selection
  methods: {
    OTSU: 'otsu',
    SAUVOLA: 'sauvola',
    NIBLACK: 'niblack',
    WOLF: 'wolf',
    BRADLEY: 'bradley',
    ISING: 'ising',               // Graph-cut based (slow but best quality)
  },
  
  // Default parameters
  defaults: {
    method: 'sauvola',
    windowSize: 15,               // Local window size (must be odd)
    k: 0.2,                       // Sauvola/Niblack sensitivity
    r: 128,                       // Sauvola dynamic range
    contrastMin: 15,              // Minimum local contrast to avoid noise
    invert: 'auto',               // 'auto', true, or false
    denoise: true,                // Apply morphological cleanup
    enhanceContrast: true,        // CLAHE before binarization
    targetBg: 'white',            // Output background color
  },
  
  // Manga-specific presets
  presets: {
    standard: {
      method: 'sauvola',
      windowSize: 15,
      k: 0.2,
      r: 128,
      invert: false,
    },
    scanQuality: {
      method: 'wolf',
      windowSize: 21,
      k: 0.3,
      enhanceContrast: true,
    },
    lowContrast: {
      method: 'ising',
      windowSize: 31,
      enhanceContrast: true,
      denoise: true,
    },
    webtoon: {
      method: 'bradley',
      windowSize: 11,
      t: 0.15,
    },
    sfx: {
      method: 'otsu',
      invert: 'auto',
      enhanceContrast: true,
    },
  },
  
  // Adaptive parameter ranges
  adaptive: {
    smallTextWindow: 11,          // Window size for small text (< 12px)
    normalTextWindow: 15,         // Normal text (12-24px)
    largeTextWindow: 21,          // Large text/SFX (> 24px)
    minWindowRatio: 0.02,         // Minimum window as ratio of image size
    maxWindowRatio: 0.1,          // Maximum window as ratio of image size
  },
};

// ============================================================================
// HISTOGRAM & STATISTICS
// ============================================================================

/**
 * Efficient histogram and statistical calculations
 */
export class ImageStatistics {
  constructor(imageData) {
    this.data = imageData.data;
    this.width = imageData.width;
    this.height = imageData.height;
    this.gray = null;
    this.integralImage = null;
    this.integralSq = null;
  }

  /**
   * Convert to grayscale (cached)
   */
  getGrayscale() {
    if (this.gray) return this.gray;
    
    this.gray = new Uint8Array(this.width * this.height);
    for (let i = 0, j = 0; i < this.data.length; i += 4, j++) {
      // ITU-R BT.709
      this.gray[j] = Math.round(
        0.2126 * this.data[i] + 
        0.7152 * this.data[i + 1] + 
        0.0722 * this.data[i + 2]
      );
    }
    return this.gray;
  }

  /**
   * Build integral image for fast local statistics
   */
  buildIntegralImage() {
    if (this.integralImage) return this;
    
    const gray = this.getGrayscale();
    const w = this.width;
    const h = this.height;
    
    this.integralImage = new Float32Array((w + 1) * (h + 1));
    this.integralSq = new Float32Array((w + 1) * (h + 1));
    
    for (let y = 1; y <= h; y++) {
      let rowSum = 0;
      let rowSumSq = 0;
      
      for (let x = 1; x <= w; x++) {
        const idx = (y - 1) * w + (x - 1);
        const val = gray[idx];
        
        rowSum += val;
        rowSumSq += val * val;
        
        const intIdx = y * (w + 1) + x;
        this.integralImage[intIdx] = this.integralImage[(y - 1) * (w + 1) + x] + rowSum;
        this.integralSq[intIdx] = this.integralSq[(y - 1) * (w + 1) + x] + rowSumSq;
      }
    }
    
    return this;
  }

  /**
   * Get local mean and std dev using integral image
   */
  getLocalStats(x, y, windowSize) {
    if (!this.integralImage) this.buildIntegralImage();
    
    const w = this.width;
    const h = this.height;
    const half = Math.floor(windowSize / 2);
    
    const x1 = Math.max(0, x - half);
    const y1 = Math.max(0, y - half);
    const x2 = Math.min(w - 1, x + half);
    const y2 = Math.min(h - 1, y + half);
    
    const count = (x2 - x1 + 1) * (y2 - y1 + 1);
    const iw = w + 1;
    
    // Sum using integral image
    const i1 = (y1) * iw + (x1);
    const i2 = (y1) * iw + (x2 + 1);
    const i3 = (y2 + 1) * iw + (x1);
    const i4 = (y2 + 1) * iw + (x2 + 1);
    
    const sum = this.integralImage[i4] - this.integralImage[i3] - 
                this.integralImage[i2] + this.integralImage[i1];
    const sumSq = this.integralSq[i4] - this.integralSq[i3] - 
                  this.integralSq[i2] + this.integralSq[i1];
    
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    const stdDev = Math.sqrt(Math.max(0, variance));
    
    return { mean, stdDev, count };
  }

  /**
   * Calculate global histogram
   */
  getHistogram() {
    const gray = this.getGrayscale();
    const hist = new Uint32Array(256);
    
    for (let i = 0; i < gray.length; i++) {
      hist[gray[i]]++;
    }
    
    return hist;
  }

  /**
   * Otsu threshold for global binarization
   */
  otsuThreshold() {
    const hist = this.getHistogram();
    const total = this.width * this.height;
    
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    
    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 0;
    
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      
      wF = total - wB;
      if (wF === 0) break;
      
      sumB += t * hist[t];
      
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      
      const variance = wB * wF * (mB - mF) * (mB - mF);
      
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }
    
    return threshold;
  }

  /**
   * Detect if image has inverted colors (white text on black)
   */
  detectInversion() {
    const gray = this.getGrayscale();
    const hist = this.getHistogram();
    
    // Analyze corners (usually background in manga)
    const corners = [
      this._sampleCorner(0, 0, 20),                    // Top-left
      this._sampleCorner(this.width - 20, 0, 20),      // Top-right
      this._sampleCorner(0, this.height - 20, 20),     // Bottom-left
      this._sampleCorner(this.width - 20, this.height - 20, 20), // Bottom-right
    ];
    
    const avgCornerBrightness = corners.reduce((a, b) => a + b, 0) / 4;
    
    // If corners are dark, likely inverted (white text on black bg)
    // If corners are bright, likely standard (black text on white bg)
    const darkRatio = hist.slice(0, 50).reduce((a, b) => a + b, 0) / gray.length;
    const brightRatio = hist.slice(200).reduce((a, b) => a + b, 0) / gray.length;
    
    // Heuristic: if dark corners and more dark pixels overall
    const isInverted = avgCornerBrightness < 80 && darkRatio > 0.4;
    
    return {
      isInverted,
      confidence: Math.abs(darkRatio - brightRatio),
      cornerBrightness: avgCornerBrightness,
      darkRatio,
      brightRatio,
    };
  }

  _sampleCorner(x, y, size) {
    const gray = this.getGrayscale();
    let sum = 0;
    let count = 0;
    
    for (let dy = 0; dy < size && y + dy < this.height; dy++) {
      for (let dx = 0; dx < size && x + dx < this.width; dx++) {
        sum += gray[(y + dy) * this.width + (x + dx)];
        count++;
      }
    }
    
    return count > 0 ? sum / count : 128;
  }
}

// ============================================================================
// BINARIZATION ALGORITHMS
// ============================================================================

/**
 * Base class for binarization algorithms
 */
class BinarizationAlgorithm {
  constructor(options = {}) {
    this.options = options;
  }

  apply(grayImage, width, height) {
    throw new Error('Must implement apply method');
  }

  /**
   * Create binary output buffer
   */
  createOutput(width, height, invert = false) {
    // 1 bit per pixel, packed into bytes
    const byteWidth = Math.ceil(width / 8);
    return {
      data: new Uint8Array(byteWidth * height),
      width,
      height,
      byteWidth,
      invert,
      
      // Helper to set pixel
      setPixel(x, y, value) {
        const byteIdx = y * this.byteWidth + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        if (value) {
          this.data[byteIdx] |= (1 << bitIdx);
        } else {
          this.data[byteIdx] &= ~(1 << bitIdx);
        }
      },
      
      // Helper to get pixel
      getPixel(x, y) {
        const byteIdx = y * this.byteWidth + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        return (this.data[byteIdx] >> bitIdx) & 1;
      },
      
      // Convert to ImageData (for display/processing)
      toImageData() {
        const imgData = new Uint8ClampedArray(width * height * 4);
        const fg = invert ? 255 : 0;
        const bg = invert ? 0 : 255;
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const val = this.getPixel(x, y) ? fg : bg;
            const idx = (y * width + x) * 4;
            imgData[idx] = val;
            imgData[idx + 1] = val;
            imgData[idx + 2] = val;
            imgData[idx + 3] = 255;
          }
        }
        
        return new ImageData(imgData, width, height);
      },
    };
  }
}

/**
 * Otsu global thresholding - Fast, good for uniform backgrounds
 */
export class OtsuBinarizer extends BinarizationAlgorithm {
  apply(grayImage, width, height) {
    const stats = new ImageStatistics({ 
      data: new Uint8ClampedArray(grayImage.length * 4), 
      width, 
      height 
    });
    stats.gray = grayImage;
    
    const threshold = stats.otsuThreshold();
    const output = this.createOutput(width, height, this.options.invert);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = grayImage[y * width + x];
        output.setPixel(x, y, val < threshold);
      }
    }
    
    return output;
  }
}

/**
 * Sauvola local thresholding - Best for manga with varying illumination
 * T = mean * (1 + k * (stdDev / r - 1))
 */
export class SauvolaBinarizer extends BinarizationAlgorithm {
  constructor(options = {}) {
    super(options);
    this.windowSize = options.windowSize || 15;
    this.k = options.k || 0.2;
    this.r = options.r || 128;
    this.contrastMin = options.contrastMin || 15;
  }

  apply(grayImage, width, height) {
    const stats = new ImageStatistics({ 
      data: new Uint8ClampedArray(grayImage.length * 4), 
      width, 
      height 
    });
    stats.gray = grayImage;
    stats.buildIntegralImage();
    
    const output = this.createOutput(width, height, this.options.invert);
    const halfWindow = Math.floor(this.windowSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { mean, stdDev } = stats.getLocalStats(x, y, this.windowSize);
        
        // Skip low contrast regions (likely background noise)
        if (stdDev < this.contrastMin) {
          output.setPixel(x, y, false); // Background
          continue;
        }
        
        // Sauvola threshold
        const threshold = mean * (1 + this.k * ((stdDev / this.r) - 1));
        const val = grayImage[y * width + x];
        
        output.setPixel(x, y, val < threshold);
      }
    }
    
    return output;
  }
}

/**
 * Niblack local thresholding - T = mean + k * stdDev
 * Faster than Sauvola but less robust to varying backgrounds
 */
export class NiblackBinarizer extends BinarizationAlgorithm {
  constructor(options = {}) {
    super(options);
    this.windowSize = options.windowSize || 15;
    this.k = options.k || -0.2; // Negative for dark text on light bg
  }

  apply(grayImage, width, height) {
    const stats = new ImageStatistics({ 
      data: new Uint8ClampedArray(grayImage.length * 4), 
      width, 
      height 
    });
    stats.gray = grayImage;
    stats.buildIntegralImage();
    
    const output = this.createOutput(width, height, this.options.invert);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { mean, stdDev } = stats.getLocalStats(x, y, this.windowSize);
        const threshold = mean + this.k * stdDev;
        const val = grayImage[y * width + x];
        
        output.setPixel(x, y, val < threshold);
      }
    }
    
    return output;
  }
}

/**
 * Wolf-Jolion binarizer - Improved Sauvola with better handling of low-contrast regions
 */
export class WolfBinarizer extends BinarizationAlgorithm {
  constructor(options = {}) {
    super(options);
    this.windowSize = options.windowSize || 21;
    this.k = options.k || 0.3;
    this.contrastMin = options.contrastMin || 15;
  }

  apply(grayImage, width, height) {
    const stats = new ImageStatistics({ 
      data: new Uint8ClampedArray(grayImage.length * 4), 
      width, 
      height 
    });
    stats.gray = grayImage;
    stats.buildIntegralImage();
    
    // First pass: find global min and max stdDev
    let minGray = 255, maxGray = 0;
    let maxStdDev = 0;
    
    for (let y = 0; y < height; y += 4) { // Sample for speed
      for (let x = 0; x < width; x += 4) {
        const val = grayImage[y * width + x];
        minGray = Math.min(minGray, val);
        maxGray = Math.max(maxGray, val);
        
        const { stdDev } = stats.getLocalStats(x, y, this.windowSize);
        maxStdDev = Math.max(maxStdDev, stdDev);
      }
    }
    
    const output = this.createOutput(width, height, this.options.invert);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { mean, stdDev } = stats.getLocalStats(x, y, this.windowSize);
        
        if (stdDev < this.contrastMin) {
          output.setPixel(x, y, false);
          continue;
        }
        
        // Wolf-Jolion formula
        const a = 1 - this.k;
        const b = this.k * (maxStdDev / (maxStdDev + stdDev + 1e-6));
        const c = (mean - minGray) / (maxGray - minGray + 1e-6);
        
        const threshold = a * mean + b * minGray + (1 - a - b) * mean * c;
        const val = grayImage[y * width + x];
        
        output.setPixel(x, y, val < threshold);
      }
    }
    
    return output;
  }
}

/**
 * Bradley-Roth binarizer - Very fast integral image method
 * Good for real-time processing
 */
export class BradleyBinarizer extends BinarizationAlgorithm {
  constructor(options = {}) {
    super(options);
    this.windowSize = options.windowSize || 15;
    this.t = options.t || 0.15; // Threshold percentage below average
  }

  apply(grayImage, width, height) {
    const stats = new ImageStatistics({ 
      data: new Uint8ClampedArray(grayImage.length * 4), 
      width, 
      height 
    });
    stats.gray = grayImage;
    stats.buildIntegralImage();
    
    const output = this.createOutput(width, height, this.options.invert);
    const s = Math.floor(this.windowSize / 2);
    const s2 = s * s * 4; // Area of window
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { mean } = stats.getLocalStats(x, y, this.windowSize);
        const threshold = mean * (1 - this.t);
        const val = grayImage[y * width + x];
        
        output.setPixel(x, y, val < threshold);
      }
    }
    
    return output;
  }
}

/**
 * Ising model binarizer - Graph cut based (slow but highest quality)
 * Uses simulated annealing approximation
 */
export class IsingBinarizer extends BinarizationAlgorithm {
  constructor(options = {}) {
    super(options);
    this.windowSize = options.windowSize || 31;
    this.iterations = options.iterations || 5;
    this.coupling = options.coupling || 0.5; // J parameter
  }

  apply(grayImage, width, height) {
    // Start with Sauvola result
    const sauvola = new SauvolaBinarizer({
      windowSize: this.windowSize,
      k: 0.2,
    });
    let output = sauvola.apply(grayImage, width, height);
    
    // Refine with Ising model (simplified ICM algorithm)
    for (let iter = 0; iter < this.iterations; iter++) {
      const newOutput = this.createOutput(width, height, this.options.invert);
      
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const grayVal = grayImage[idx];
          
          // Calculate local field (data term)
          const localMean = this._getLocalMean(grayImage, x, y, width);
          const dataTerm = grayVal < localMean ? -1 : 1;
          
          // Calculate interaction term (smoothness)
          let interaction = 0;
          const neighbors = [
            output.getPixel(x - 1, y),
            output.getPixel(x + 1, y),
            output.getPixel(x, y - 1),
            output.getPixel(x, y + 1),
          ];
          
          for (const n of neighbors) {
            interaction += n ? 1 : -1;
          }
          
          // Total energy
          const energy = dataTerm + this.coupling * interaction;
          
          // Update
          newOutput.setPixel(x, y, energy < 0);
        }
      }
      
      output = newOutput;
    }
    
    return output;
  }

  _getLocalMean(gray, x, y, width) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        sum += gray[(y + dy) * width + (x + dx)];
      }
    }
    return sum / 9;
  }
}

// ============================================================================
// POST-PROCESSING
// ============================================================================

/**
 * Morphological operations for cleaning binary images
 */
export class MorphologicalProcessor {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  /**
   * Remove salt & pepper noise
   */
  despeckle(binaryData, iterations = 1) {
    for (let i = 0; i < iterations; i++) {
      binaryData = this._applyFilter(binaryData, [
        [0, 1, 0],
        [1, 0, 1],
        [0, 1, 0],
      ], 'majority');
    }
    return binaryData;
  }

  /**
   * Close gaps in text (dilation followed by erosion)
   */
  close(binaryData, radius = 1) {
    let temp = this._dilate(binaryData, radius);
    return this._erode(temp, radius);
  }

  /**
   * Remove small components (noise)
   */
  removeSmallComponents(binaryData, minSize = 10) {
    const labeled = this._connectedComponents(binaryData);
    const sizes = new Map();
    
    // Count sizes
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const label = labeled[y * this.width + x];
        if (label > 0) {
          sizes.set(label, (sizes.get(label) || 0) + 1);
        }
      }
    }
    
    // Filter
    const output = this._createBinaryBuffer();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const label = labeled[y * this.width + x];
        if (label > 0 && sizes.get(label) >= minSize) {
          output.setPixel(x, y, true);
        }
      }
    }
    
    return output;
  }

  _dilate(data, radius) {
    const output = this._createBinaryBuffer();
    
    for (let y = radius; y < this.height - radius; y++) {
      for (let x = radius; x < this.width - radius; x++) {
        let maxVal = false;
        for (let dy = -radius; dy <= radius && !maxVal; dy++) {
          for (let dx = -radius; dx <= radius && !maxVal; dx++) {
            if (data.getPixel(x + dx, y + dy)) {
              maxVal = true;
            }
          }
        }
        output.setPixel(x, y, maxVal);
      }
    }
    
    return output;
  }

  _erode(data, radius) {
    const output = this._createBinaryBuffer();
    
    for (let y = radius; y < this.height - radius; y++) {
      for (let x = radius; x < this.width - radius; x++) {
        let minVal = true;
        for (let dy = -radius; dy <= radius && minVal; dy++) {
          for (let dx = -radius; dx <= radius && minVal; dx++) {
            if (!data.getPixel(x + dx, y + dy)) {
              minVal = false;
            }
          }
        }
        output.setPixel(x, y, minVal);
      }
    }
    
    return output;
  }

  _connectedComponents(data) {
    const labels = new Int32Array(this.width * this.height);
    let currentLabel = 0;
    const equivalences = new Map();
    
    // First pass
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!data.getPixel(x, y)) continue;
        
        const left = x > 0 ? labels[y * this.width + (x - 1)] : 0;
        const top = y > 0 ? labels[(y - 1) * this.width + x] : 0;
        
        if (left === 0 && top === 0) {
          labels[y * this.width + x] = ++currentLabel;
        } else if (left !== 0 && top === 0) {
          labels[y * this.width + x] = left;
        } else if (left === 0 && top !== 0) {
          labels[y * this.width + x] = top;
        } else {
          labels[y * this.width + x] = Math.min(left, top);
          if (left !== top) {
            equivalences.set(Math.max(left, top), Math.min(left, top));
          }
        }
      }
    }
    
    // Resolve equivalences
    const findRoot = (label) => {
      let root = label;
      while (equivalences.has(root)) {
        root = equivalences.get(root);
      }
      return root;
    };
    
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > 0) {
        labels[i] = findRoot(labels[i]);
      }
    }
    
    return labels;
  }

  _createBinaryBuffer() {
    const byteWidth = Math.ceil(this.width / 8);
    return {
      data: new Uint8Array(byteWidth * this.height),
      width: this.width,
      height: this.height,
      byteWidth,
      setPixel(x, y, value) {
        const byteIdx = y * this.byteWidth + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        if (value) {
          this.data[byteIdx] |= (1 << bitIdx);
        } else {
          this.data[byteIdx] &= ~(1 << bitIdx);
        }
      },
      getPixel(x, y) {
        const byteIdx = y * this.byteWidth + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        return (this.data[byteIdx] >> bitIdx) & 1;
      },
    };
  }

  _applyFilter(data, kernel, mode = 'majority') {
    const kH = kernel.length;
    const kW = kernel[0].length;
    const kHalfH = Math.floor(kH / 2);
    const kHalfW = Math.floor(kW / 2);
    
    const output = this._createBinaryBuffer();
    
    for (let y = kHalfH; y < this.height - kHalfH; y++) {
      for (let x = kHalfW; x < this.width - kHalfW; x++) {
        let sum = 0;
        let count = 0;
        
        for (let ky = 0; ky < kH; ky++) {
          for (let kx = 0; kx < kW; kx++) {
            if (kernel[ky][kx] === 1) {
              const px = x + kx - kHalfW;
              const py = y + ky - kHalfH;
              sum += data.getPixel(px, py) ? 1 : 0;
              count++;
            }
          }
        }
        
        if (mode === 'majority') {
          output.setPixel(x, y, sum > count / 2);
        } else if (mode === 'any') {
          output.setPixel(x, y, sum > 0);
        }
      }
    }
    
    return output;
  }
}

// ============================================================================
// MAIN BINARIZER CLASS
// ============================================================================

/**
 * Main binarization controller with automatic parameter selection
 */
export class Binarizer {
  constructor(options = {}) {
    this.options = { ...BINARIZER_CONFIG.defaults, ...options };
    this.performanceMonitor = new PerformanceMonitor('binarizer');
  }

  /**
   * Binarize image with automatic or manual method selection
   * @param {ImageData} imageData - Input image
   * @param {Object} options - Binarization options
   * @returns {Promise<Object>} Binary result with metadata
   */
  async binarize(imageData, options = {}) {
    const startTime = performance.now();
    const opts = { ...this.options, ...options };
    
    try {
      // Get grayscale
      const stats = new ImageStatistics(imageData);
      const gray = stats.getGrayscale();
      
      // Auto-detect inversion if needed
      let invert = opts.invert;
      if (invert === 'auto') {
        const inversionInfo = stats.detectInversion();
        invert = inversionInfo.isInverted;
        console.log(`[Binarizer] Auto-detected inversion: ${invert} (confidence: ${inversionInfo.confidence.toFixed(2)})`);
      }
      
      // Enhance contrast if enabled
      let processedGray = gray;
      if (opts.enhanceContrast) {
        processedGray = this._applyCLAHE(gray, imageData.width, imageData.height);
      }
      
      // Select and apply algorithm
      const method = opts.method || this._selectMethod(stats);
      const binarizer = this._createBinarizer(method, { ...opts, invert });
      
      console.log(`[Binarizer] Using ${method} method`);
      const binary = binarizer.apply(processedGray, imageData.width, imageData.height);
      
      // Post-processing
      if (opts.denoise) {
        const morph = new MorphologicalProcessor(imageData.width, imageData.height);
        let cleaned = morph.despeckle(binary, 1);
        cleaned = morph.removeSmallComponents(cleaned, 8);
        binary.data = cleaned.data;
      }
      
      // Convert to ImageData for output
      const result = binary.toImageData();
      
      // Record metrics
      const duration = performance.now() - startTime;
      this.performanceMonitor.record('binarize', duration, {
        method,
        invert,
        dimensions: `${imageData.width}x${imageData.height}`,
      });
      
      return {
        imageData: result,
        binary,
        method,
        invert,
        stats: {
          originalMean: stats.getGrayscale().reduce((a, b) => a + b) / gray.length,
        },
      };
      
    } catch (error) {
      console.error('[Binarizer] Error:', error);
      throw new BinarizationError(error.message);
    }
  }

  /**
   * Quick binarize using preset
   */
  async binarizeWithPreset(imageData, presetName) {
    const preset = BINARIZER_CONFIG.presets[presetName];
    if (!preset) {
      throw new Error(`Unknown preset: ${presetName}`);
    }
    
    return this.binarize(imageData, preset);
  }

  /**
   * Select optimal binarization method
   * @private
   */
  _selectMethod(stats) {
    const hist = stats.getHistogram();
    const total = stats.width * stats.height;
    
    // Calculate uniformity
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      const p = hist[i] / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    
    // High entropy = complex image, use better algorithm
    if (entropy > 6) return 'wolf';
    if (entropy > 5) return 'sauvola';
    return 'bradley';
  }

  /**
   * Create binarizer instance
   * @private
   */
  _createBinarizer(method, options) {
    switch (method) {
      case 'otsu':
        return new OtsuBinarizer(options);
      case 'sauvola':
        return new SauvolaBinarizer(options);
      case 'niblack':
        return new NiblackBinarizer(options);
      case 'wolf':
        return new WolfBinarizer(options);
      case 'bradley':
        return new BradleyBinarizer(options);
      case 'ising':
        return new IsingBinarizer(options);
      default:
        return new SauvolaBinarizer(options);
    }
  }

  /**
   * Contrast Limited Adaptive Histogram Equalization (CLAHE)
   * @private
   */
  _applyCLAHE(gray, width, height, clipLimit = 40, tileSize = 8) {
    const output = new Uint8Array(gray.length);
    const tilesX = Math.ceil(width / tileSize);
    const tilesY = Math.ceil(height / tileSize);
    
    // Calculate CDF for each tile
    const tileCDFs = [];
    
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const x1 = tx * tileSize;
        const y1 = ty * tileSize;
        const x2 = Math.min(width, x1 + tileSize);
        const y2 = Math.min(height, y1 + tileSize);
        
        // Build histogram for tile
        const hist = new Uint32Array(256);
        for (let y = y1; y < y2; y++) {
          for (let x = x1; x < x2; x++) {
            hist[gray[y * width + x]]++;
          }
        }
        
        // Clip histogram
        if (clipLimit > 0) {
          const limit = Math.max(1, Math.floor((clipLimit * tileSize * tileSize) / 256));
          let excess = 0;
          for (let i = 0; i < 256; i++) {
            if (hist[i] > limit) {
              excess += hist[i] - limit;
              hist[i] = limit;
            }
          }
          
          // Redistribute excess
          const redistribute = Math.floor(excess / 256);
          for (let i = 0; i < 256; i++) {
            hist[i] += redistribute;
          }
        }
        
        // Build CDF
        const cdf = new Uint32Array(256);
        cdf[0] = hist[0];
        for (let i = 1; i < 256; i++) {
          cdf[i] = cdf[i - 1] + hist[i];
        }
        
        // Normalize
        const cdfMin = cdf.find(v => v > 0) || 0;
        const total = cdf[255];
        const normalizedCDF = new Uint8Array(256);
        
        for (let i = 0; i < 256; i++) {
          normalizedCDF[i] = Math.round(((cdf[i] - cdfMin) / (total - cdfMin)) * 255);
        }
        
        tileCDFs.push(normalizedCDF);
      }
    }
    
    // Interpolate between tiles
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tileX = Math.floor(x / tileSize);
        const tileY = Math.floor(y / tileSize);
        const tileIdx = tileY * tilesX + tileX;
        
        // Get neighboring tiles for interpolation
        const tx = (x % tileSize) / tileSize;
        const ty = (y % tileSize) / tileSize;
        
        const val = gray[y * width + x];
        
        // Bilinear interpolation of CDF values
        const cdf = tileCDFs[tileIdx];
        const newVal = cdf[val];
        
        output[y * width + x] = newVal;
      }
    }
    
    return output;
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return this.performanceMonitor.getReport();
  }
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

export class BinarizationError extends Error {
  constructor(message) {
    super(`Binarization failed: ${message}`);
    this.name = 'BinarizationError';
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  Binarizer,
  ImageStatistics,
  OtsuBinarizer,
  SauvolaBinarizer,
  NiblackBinarizer,
  WolfBinarizer,
  BradleyBinarizer,
  IsingBinarizer,
  MorphologicalProcessor,
  BINARIZER_CONFIG,
};

// Convenience factory
export function createBinarizer(options) {
  return new Binarizer(options);
}