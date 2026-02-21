// /computer-vision/ocr/preprocessors/denoiser.js

/**
 * Manga Image Denoising Module
 * Optimized for scan artifacts, JPEG compression, and print noise
 * Implements multiple algorithms: Non-local Means, Bilateral, Median, and Wavelet-based
 * @module Denoiser
 */

import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const DENOISE_CONFIG = {
  // Algorithm selection thresholds
  thresholds: {
    NOISE_ESTIMATE_HIGH: 25,      // Standard deviation threshold for heavy noise
    NOISE_ESTIMATE_MEDIUM: 15,    // Medium noise level
    JPEG_ARTIFACT_THRESHOLD: 0.15, // DCT blocking artifact detection
    EDGE_PRESERVATION_RATIO: 0.9,  // Minimum edge preservation ratio
  },
  
  // Default parameters
  defaults: {
    strength: 0.7,                // Denoising strength (0-1)
    preserveEdges: true,          // Edge-preserving mode
    fastMode: false,              // Skip expensive algorithms
    targetPSNR: 35,               // Target quality metric
  },
  
  // Algorithm-specific presets
  presets: {
    mangaScan: {
      algorithm: 'bilateral',
      strength: 0.6,
      windowSize: 5,
      sigmaColor: 30,
      sigmaSpace: 5,
    },
    webtoon: {
      algorithm: 'median',
      strength: 0.4,
      windowSize: 3,
    },
    oldPrint: {
      algorithm: 'nlm',
      strength: 0.8,
      windowSize: 7,
      searchWindow: 21,
      h: 15,
    },
    digital: {
      algorithm: 'wavelet',
      strength: 0.3,
      threshold: 20,
    },
  },
};

// ============================================================================
// NOISE ESTIMATION
// ============================================================================

/**
 * Estimates noise level in image using multiple methods
 */
export class NoiseEstimator {
  constructor() {
    this.performanceMonitor = new PerformanceMonitor('noise-estimation');
  }

  /**
   * Estimate noise using Laplacian variance method
   * Fast but less accurate for textured regions
   */
  estimateLaplacianVariance(imageData) {
    const { data, width, height } = imageData;
    const gray = this._toGrayscale(data);
    
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    
    // Laplacian kernel (3x3)
    const laplacian = [
      0, 1, 0,
      1, -4, 1,
      0, 1, 0,
    ];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let conv = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kIdx = (ky + 1) * 3 + (kx + 1);
            conv += gray[idx] * laplacian[kIdx];
          }
        }
        sum += Math.abs(conv);
        sumSq += conv * conv;
        count++;
      }
    }
    
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    const stdDev = Math.sqrt(variance);
    
    // Convert to approximate noise sigma
    return stdDev / Math.sqrt(0.25); // Laplacian normalization factor
  }

  /**
   * Estimate noise using block-based variance (more accurate for manga)
   * Analyzes flat regions to estimate noise
   */
  estimateBlockVariance(imageData, blockSize = 8) {
    const { data, width, height } = imageData;
    const gray = this._toGrayscale(data);
    
    const variances = [];
    const edgeThreshold = 50; // Skip blocks with edges
    
    for (let y = 0; y < height - blockSize; y += blockSize) {
      for (let x = 0; x < width - blockSize; x += blockSize) {
        const blockVar = this._calculateBlockVariance(gray, x, y, width, blockSize);
        const blockGrad = this._calculateBlockGradient(gray, x, y, width, blockSize);
        
        // Only use flat regions for noise estimation
        if (blockGrad < edgeThreshold) {
          variances.push(blockVar);
        }
      }
    }
    
    if (variances.length === 0) return 0;
    
    // Use median of lowest quartile for robust estimation
    variances.sort((a, b) => a - b);
    const lowestQuartile = variances.slice(0, Math.floor(variances.length / 4));
    const medianVar = this._median(lowestQuartile);
    
    return Math.sqrt(medianVar);
  }

  /**
   * Detect JPEG compression artifacts using DCT analysis
   */
  detectJPEGArtifacts(imageData) {
    const { data, width, height } = imageData;
    const gray = this._toGrayscale(data);
    
    // Check for 8x8 blocking artifacts
    const blockSize = 8;
    let blockingScore = 0;
    let count = 0;
    
    for (let y = 0; y < height - blockSize; y += blockSize) {
      for (let x = 0; x < width - blockSize; x += blockSize) {
        // Calculate difference across block boundaries
        const rightDiff = this._boundaryDifference(gray, x, y, width, blockSize, 'right');
        const bottomDiff = this._boundaryDifference(gray, x, y, width, blockSize, 'bottom');
        
        // Compare with internal variation
        const internalVar = this._calculateBlockVariance(gray, x, y, width, blockSize);
        
        if (internalVar > 0) {
          const ratio = (rightDiff + bottomDiff) / (2 * Math.sqrt(internalVar));
          blockingScore += ratio;
          count++;
        }
      }
    }
    
    return count > 0 ? blockingScore / count : 0;
  }

  /**
   * Comprehensive noise analysis
   */
  analyze(imageData) {
    const startTime = performance.now();
    
    const laplacianSigma = this.estimateLaplacianVariance(imageData);
    const blockSigma = this.estimateBlockVariance(imageData);
    const jpegScore = this.detectJPEGArtifacts(imageData);
    
    // Conservative estimate: take minimum of methods
    const noiseSigma = Math.min(laplacianSigma, blockSigma);
    
    const duration = performance.now() - startTime;
    this.performanceMonitor.record('estimation', duration);
    
    return {
      noiseSigma,
      confidence: this._estimateConfidence(laplacianSigma, blockSigma),
      jpegArtifacts: jpegScore > DENOISE_CONFIG.thresholds.JPEG_ARTIFACT_THRESHOLD,
      recommendedStrength: this._recommendStrength(noiseSigma, jpegScore),
      metrics: {
        laplacian: laplacianSigma,
        block: blockSigma,
        jpegScore,
      },
    };
  }

  // Private helpers
  _toGrayscale(rgba) {
    const gray = new Float32Array(rgba.length / 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      // ITU-R BT.709 coefficients
      gray[j] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    }
    return gray;
  }

  _calculateBlockVariance(gray, x, y, width, blockSize) {
    let sum = 0;
    let sumSq = 0;
    
    for (let by = 0; by < blockSize; by++) {
      for (let bx = 0; bx < blockSize; bx++) {
        const idx = (y + by) * width + (x + bx);
        const val = gray[idx];
        sum += val;
        sumSq += val * val;
      }
    }
    
    const n = blockSize * blockSize;
    const mean = sum / n;
    return (sumSq / n) - (mean * mean);
  }

  _calculateBlockGradient(gray, x, y, width, blockSize) {
    let gradSum = 0;
    
    for (let by = 0; by < blockSize; by++) {
      for (let bx = 0; bx < blockSize - 1; bx++) {
        const idx1 = (y + by) * width + (x + bx);
        const idx2 = (y + by) * width + (x + bx + 1);
        gradSum += Math.abs(gray[idx1] - gray[idx2]);
      }
    }
    
    return gradSum / (blockSize * (blockSize - 1));
  }

  _boundaryDifference(gray, x, y, width, blockSize, direction) {
    let diff = 0;
    let count = 0;
    
    if (direction === 'right') {
      const x1 = x + blockSize - 1;
      const x2 = x + blockSize;
      if (x2 >= width) return 0;
      
      for (let i = 0; i < blockSize; i++) {
        const y1 = y + i;
        diff += Math.abs(gray[y1 * width + x1] - gray[y1 * width + x2]);
        count++;
      }
    } else {
      const y1 = y + blockSize - 1;
      const y2 = y + blockSize;
      if (y2 * width >= gray.length) return 0;
      
      for (let i = 0; i < blockSize; i++) {
        const x1 = x + i;
        diff += Math.abs(gray[y1 * width + x1] - gray[y2 * width + x1]);
        count++;
      }
    }
    
    return diff / count;
  }

  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  _estimateConfidence(lap, block) {
    const ratio = Math.max(lap, block) / (Math.min(lap, block) + 1e-6);
    return ratio < 2 ? 'high' : ratio < 4 ? 'medium' : 'low';
  }

  _recommendStrength(sigma, jpegScore) {
    if (jpegScore > 0.3) return 0.8;
    if (sigma > 25) return 0.7;
    if (sigma > 15) return 0.5;
    return 0.3;
  }
}

// ============================================================================
// DENOISING ALGORITHMS
// ============================================================================

/**
 * Fast Median Filter - Good for salt & pepper noise (scans, print defects)
 */
export class MedianFilter {
  constructor(windowSize = 3) {
    this.windowSize = windowSize;
    this.halfSize = Math.floor(windowSize / 2);
  }

  apply(imageData, strength = 1.0) {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const window = new Uint8Array(this.windowSize * this.windowSize);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let count = 0;
        
        // Collect window samples
        for (let wy = -this.halfSize; wy <= this.halfSize; wy++) {
          for (let wx = -this.halfSize; wx <= this.halfSize; wx++) {
            const sy = Math.min(height - 1, Math.max(0, y + wy));
            const sx = Math.min(width - 1, Math.max(0, x + wx));
            const sIdx = (sy * width + sx) * 4;
            
            // Use luminance for median calculation
            window[count++] = Math.round(
              0.299 * data[sIdx] + 
              0.587 * data[sIdx + 1] + 
              0.114 * data[sIdx + 2]
            );
          }
        }
        
        // Find median
        window.sort((a, b) => a - b);
        const median = window[Math.floor(count / 2)];
        
        // Apply with strength (blend original and median)
        const idx = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const blended = data[idx + c] * (1 - strength) + median * strength;
          output[idx + c] = Math.round(blended);
        }
        output[idx + 3] = data[idx + 3]; // Preserve alpha
      }
    }
    
    return new ImageData(output, width, height);
  }
}

/**
 * Bilateral Filter - Edge-preserving smoothing (best for manga)
 * Approximation using lookup tables for performance
 */
export class BilateralFilter {
  constructor(sigmaColor = 30, sigmaSpace = 5, windowSize = 5) {
    this.sigmaColor = sigmaColor;
    this.sigmaSpace = sigmaSpace;
    this.windowSize = windowSize;
    this.halfSize = Math.floor(windowSize / 2);
    
    // Precompute Gaussian weights
    this._initLookupTables();
  }

  _initLookupTables() {
    // Spatial Gaussian
    this.spatialWeights = new Float32Array(this.windowSize * this.windowSize);
    let idx = 0;
    for (let y = -this.halfSize; y <= this.halfSize; y++) {
      for (let x = -this.halfSize; x <= this.halfSize; x++) {
        this.spatialWeights[idx++] = Math.exp(
          -(x * x + y * y) / (2 * this.sigmaSpace * this.sigmaSpace)
        );
      }
    }
    
    // Color Gaussian lookup (256 levels)
    this.colorWeights = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      this.colorWeights[i] = Math.exp(
        -(i * i) / (2 * this.sigmaColor * this.sigmaColor)
      );
    }
  }

  apply(imageData, strength = 1.0) {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data.length);
    
    // Process luminance channel only, then apply to RGB
    const luminance = new Float32Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      luminance[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    
    const filteredLuma = new Float32Array(width * height);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = y * width + x;
        const centerVal = luminance[centerIdx];
        
        let sumWeight = 0;
        let sumValue = 0;
        let wIdx = 0;
        
        for (let wy = -this.halfSize; wy <= this.halfSize; wy++) {
          for (let wx = -this.halfSize; wx <= this.halfSize; wx++) {
            const sy = Math.min(height - 1, Math.max(0, y + wy));
            const sx = Math.min(width - 1, Math.max(0, x + wx));
            const sIdx = sy * width + sx;
            
            const colorDiff = Math.abs(luminance[sIdx] - centerVal);
            const colorWeight = this.colorWeights[Math.min(255, Math.floor(colorDiff))];
            const spatialWeight = this.spatialWeights[wIdx++];
            
            const weight = colorWeight * spatialWeight;
            sumWeight += weight;
            sumValue += weight * luminance[sIdx];
          }
        }
        
        filteredLuma[centerIdx] = sumValue / sumWeight;
      }
    }
    
    // Apply filtered luminance to output with strength blending
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const origLuma = luminance[j];
      const filtLuma = filteredLuma[j];
      const newLuma = origLuma * (1 - strength) + filtLuma * strength;
      
      // Preserve chrominance, adjust luminance
      const ratio = newLuma / (origLuma + 1e-6);
      
      for (let c = 0; c < 3; c++) {
        output[i + c] = Math.min(255, Math.max(0, data[i + c] * ratio));
      }
      output[i + 3] = data[i + 3];
    }
    
    return new ImageData(output, width, height);
  }
}

/**
 * Non-Local Means Filter - Best quality, slower (for heavy noise)
 * Simplified fast approximation using integral images
 */
export class NonLocalMeansFilter {
  constructor(searchWindow = 21, patchSize = 7, h = 15) {
    this.searchWindow = searchWindow;
    this.patchSize = patchSize;
    this.h = h;
    this.halfPatch = Math.floor(patchSize / 2);
    this.halfSearch = Math.floor(searchWindow / 2);
  }

  apply(imageData, strength = 1.0) {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data.length);
    
    // Convert to grayscale for patch comparison
    const gray = new Float32Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    
    // Precompute patch distances using sliding window
    const patchDistances = this._computePatchDistances(gray, width, height);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const centerPatch = patchDistances[idx];
        
        let sumWeight = 0;
        let sumR = 0, sumG = 0, sumB = 0;
        
        // Search window
        const yStart = Math.max(0, y - this.halfSearch);
        const yEnd = Math.min(height, y + this.halfSearch + 1);
        const xStart = Math.max(0, x - this.halfSearch);
        const xEnd = Math.min(width, x + this.halfSearch + 1);
        
        for (let sy = yStart; sy < yEnd; sy++) {
          for (let sx = xStart; sx < xEnd; sx++) {
            const sIdx = sy * width + sx;
            const dist = patchDistances[sIdx];
            
            // Gaussian weight based on patch distance
            const weight = Math.exp(-dist / (this.h * this.h));
            
            const dataIdx = sIdx * 4;
            sumR += weight * data[dataIdx];
            sumG += weight * data[dataIdx + 1];
            sumB += weight * data[dataIdx + 2];
            sumWeight += weight;
          }
        }
        
        const outIdx = idx * 4;
        const norm = sumWeight > 0 ? 1 / sumWeight : 0;
        
        // Blend with original based on strength
        output[outIdx] = data[outIdx] * (1 - strength) + sumR * norm * strength;
        output[outIdx + 1] = data[outIdx + 1] * (1 - strength) + sumG * norm * strength;
        output[outIdx + 2] = data[outIdx + 2] * (1 - strength) + sumB * norm * strength;
        output[outIdx + 3] = data[outIdx + 3];
      }
    }
    
    return new ImageData(output, width, height);
  }

  _computePatchDistances(gray, width, height) {
    const distances = new Float32Array(width * height);
    
    // Simplified: use local variance as patch distance approximation
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = y * width + x;
        const centerVal = gray[centerIdx];
        
        let sumSqDiff = 0;
        let count = 0;
        
        for (let py = -this.halfPatch; py <= this.halfPatch; py++) {
          for (let px = -this.halfPatch; px <= this.halfPatch; px++) {
            const sy = Math.min(height - 1, Math.max(0, y + py));
            const sx = Math.min(width - 1, Math.max(0, x + px));
            const diff = gray[sy * width + sx] - centerVal;
            sumSqDiff += diff * diff;
            count++;
          }
        }
        
        distances[centerIdx] = sumSqDiff / count;
      }
    }
    
    return distances;
  }
}

/**
 * Wavelet-based denoising - Good for preserving fine details
 * Uses Haar wavelet transform
 */
export class WaveletFilter {
  constructor(levels = 2, threshold = 20) {
    this.levels = levels;
    this.threshold = threshold;
  }

  apply(imageData, strength = 1.0) {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data.length);
    
    // Process each channel separately
    for (let c = 0; c < 3; c++) {
      // Extract channel
      const channel = new Float32Array(width * height);
      for (let i = 0, j = c; i < width * height; i++, j += 4) {
        channel[i] = data[j];
      }
      
      // Forward wavelet transform
      const coeffs = this._waveletTransform(channel, width, height);
      
      // Threshold detail coefficients
      this._thresholdCoeffs(coeffs, width, height, this.threshold * strength);
      
      // Inverse transform
      const denoised = this._inverseWavelet(coeffs, width, height);
      
      // Write back
      for (let i = 0, j = c; i < width * height; i++, j += 4) {
        output[j] = Math.min(255, Math.max(0, denoised[i]));
      }
    }
    
    // Copy alpha
    for (let i = 3; i < data.length; i += 4) {
      output[i] = data[i];
    }
    
    return new ImageData(output, width, height);
  }

  _waveletTransform(signal, width, height) {
    const result = new Float32Array(signal);
    const temp = new Float32Array(Math.max(width, height));
    
    // Horizontal pass
    for (let y = 0; y < height; y++) {
      const row = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        row[x] = result[y * width + x];
      }
      
      const transformed = this._haar1D(row);
      for (let x = 0; x < width; x++) {
        result[y * width + x] = transformed[x];
      }
    }
    
    // Vertical pass
    for (let x = 0; x < width; x++) {
      const col = new Float32Array(height);
      for (let y = 0; y < height; y++) {
        col[y] = result[y * width + x];
      }
      
      const transformed = this._haar1D(col);
      for (let y = 0; y < height; y++) {
        result[y * width + x] = transformed[y];
      }
    }
    
    return result;
  }

  _haar1D(data) {
    const n = data.length;
    const half = Math.floor(n / 2);
    const result = new Float32Array(n);
    
    for (let i = 0; i < half; i++) {
      const a = data[2 * i];
      const b = data[2 * i + 1] || a;
      result[i] = (a + b) / Math.SQRT2;        // Approximation
      result[half + i] = (a - b) / Math.SQRT2; // Detail
    }
    
    return result;
  }

  _thresholdCoeffs(coeffs, width, height, threshold) {
    // Skip approximation (low-frequency), threshold details only
    const quarterW = Math.floor(width / 2);
    const quarterH = Math.floor(height / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = quarterW; x < width; x++) {
        const idx = y * width + x;
        const sign = Math.sign(coeffs[idx]);
        const abs = Math.abs(coeffs[idx]);
        coeffs[idx] = sign * Math.max(0, abs - threshold);
      }
    }
    
    for (let y = quarterH; y < height; y++) {
      for (let x = 0; x < quarterW; x++) {
        const idx = y * width + x;
        const sign = Math.sign(coeffs[idx]);
        const abs = Math.abs(coeffs[idx]);
        coeffs[idx] = sign * Math.max(0, abs - threshold);
      }
    }
  }

  _inverseWavelet(coeffs, width, height) {
    const result = new Float32Array(coeffs);
    const temp = new Float32Array(Math.max(width, height));
    
    // Inverse vertical
    for (let x = 0; x < width; x++) {
      const col = new Float32Array(height);
      for (let y = 0; y < height; y++) {
        col[y] = result[y * width + x];
      }
      
      const transformed = this._inverseHaar1D(col);
      for (let y = 0; y < height; y++) {
        result[y * width + x] = transformed[y];
      }
    }
    
    // Inverse horizontal
    for (let y = 0; y < height; y++) {
      const row = new Float32Array(width);
      for (let x = 0; x < width; x++) {
        row[x] = result[y * width + x];
      }
      
      const transformed = this._inverseHaar1D(row);
      for (let x = 0; x < width; x++) {
        result[y * width + x] = transformed[x];
      }
    }
    
    return result;
  }

  _inverseHaar1D(data) {
    const n = data.length;
    const half = Math.floor(n / 2);
    const result = new Float32Array(n);
    
    for (let i = 0; i < half; i++) {
      const a = data[i];
      const d = data[half + i] || 0;
      result[2 * i] = (a + d) / Math.SQRT2;
      result[2 * i + 1] = (a - d) / Math.SQRT2;
    }
    
    return result;
  }
}

// ============================================================================
// MAIN DENOISER CLASS
// ============================================================================

/**
 * Main denoising controller with automatic algorithm selection
 */
export class Denoiser {
  constructor(options = {}) {
    this.options = { ...DENOISE_CONFIG.defaults, ...options };
    this.noiseEstimator = new NoiseEstimator();
    this.performanceMonitor = new PerformanceMonitor('denoiser');
    
    // Algorithm instances
    this.algorithms = {
      median: new MedianFilter(),
      bilateral: new BilateralFilter(),
      nlm: new NonLocalMeansFilter(),
      wavelet: new WaveletFilter(),
    };
  }

  /**
   * Denoise image with automatic or manual algorithm selection
   * @param {ImageData} imageData - Input image
   * @param {Object} options - Denoising options
   * @returns {Promise<ImageData>} Denoised image
   */
  async denoise(imageData, options = {}) {
    const startTime = performance.now();
    const opts = { ...this.options, ...options };
    
    try {
      // Analyze noise if not specified
      let noiseInfo = options.noiseInfo;
      if (!noiseInfo) {
        noiseInfo = this.noiseEstimator.analyze(imageData);
      }
      
      // Select algorithm
      const algorithm = opts.algorithm || this._selectAlgorithm(noiseInfo, opts);
      const strength = opts.strength || noiseInfo.recommendedStrength;
      
      console.log(`[Denoiser] Using ${algorithm} filter (strength: ${strength.toFixed(2)})`);
      
      // Apply denoising
      const filter = this._getFilter(algorithm, opts);
      const result = filter.apply(imageData, strength);
      
      // Record metrics
      const duration = performance.now() - startTime;
      this.performanceMonitor.record('denoise', duration, {
        algorithm,
        strength,
        noiseSigma: noiseInfo.noiseSigma,
      });
      
      return result;
      
    } catch (error) {
      console.error('[Denoiser] Error:', error);
      // Return original on failure
      return imageData;
    }
  }

  /**
   * Quick denoise using preset configuration
   */
  async denoiseWithPreset(imageData, presetName) {
    const preset = DENOISE_CONFIG.presets[presetName];
    if (!preset) {
      throw new Error(`Unknown preset: ${presetName}`);
    }
    
    return this.denoise(imageData, {
      algorithm: preset.algorithm,
      strength: preset.strength,
      ...preset,
    });
  }

  /**
   * Batch denoise multiple regions
   */
  async denoiseRegions(imageData, regions, options = {}) {
    const results = [];
    
    for (const region of regions) {
      const regionData = this._extractRegion(imageData, region);
      const denoised = await this.denoise(regionData, options);
      results.push({
        region,
        data: denoised,
      });
    }
    
    return results;
  }

  /**
   * Select optimal algorithm based on noise characteristics
   * @private
   */
  _selectAlgorithm(noiseInfo, options) {
    if (options.fastMode) return 'median';
    
    const { noiseSigma, jpegArtifacts, confidence } = noiseInfo;
    
    // Heavy noise: NLM
    if (noiseSigma > DENOISE_CONFIG.thresholds.NOISE_ESTIMATE_HIGH) {
      return 'nlm';
    }
    
    // JPEG artifacts: Bilateral (preserves edges while smoothing blocks)
    if (jpegArtifacts) {
      return 'bilateral';
    }
    
    // Medium noise: Bilateral (good balance)
    if (noiseSigma > DENOISE_CONFIG.thresholds.NOISE_ESTIMATE_MEDIUM) {
      return 'bilateral';
    }
    
    // Light noise: Wavelet (preserves fine details)
    if (confidence === 'high') {
      return 'wavelet';
    }
    
    // Default
    return 'bilateral';
  }

  /**
   * Get or create filter instance
   * @private
   */
  _getFilter(algorithm, options) {
    switch (algorithm) {
      case 'median':
        return new MedianFilter(options.windowSize || 3);
      case 'bilateral':
        return new BilateralFilter(
          options.sigmaColor || 30,
          options.sigmaSpace || 5,
          options.windowSize || 5
        );
      case 'nlm':
        return new NonLocalMeansFilter(
          options.searchWindow || 21,
          options.patchSize || 7,
          options.h || 15
        );
      case 'wavelet':
        return new WaveletFilter(
          options.levels || 2,
          options.threshold || 20
        );
      default:
        return this.algorithms.bilateral;
    }
  }

  /**
   * Extract region from image data
   * @private
   */
  _extractRegion(imageData, region) {
    const { data, width, height } = imageData;
    const { x, y, width: rW, height: rH } = region;
    
    const regionData = new Uint8ClampedArray(rW * rH * 4);
    
    for (let ry = 0; ry < rH; ry++) {
      for (let rx = 0; rx < rW; rx++) {
        const srcIdx = ((y + ry) * width + (x + rx)) * 4;
        const dstIdx = (ry * rW + rx) * 4;
        
        for (let c = 0; c < 4; c++) {
          regionData[dstIdx + c] = data[srcIdx + c];
        }
      }
    }
    
    return new ImageData(regionData, rW, rH);
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      denoiser: this.performanceMonitor.getReport(),
      estimator: this.noiseEstimator.performanceMonitor.getReport(),
    };
  }
}

// ============================================================================
// WEB WORKER BRIDGE
// ============================================================================

/**
 * Offload heavy denoising to worker (for large images)
 */
export class WorkerDenoiser {
  constructor(workerScript = '/workers/denoiser-worker.js') {
    this.worker = new Worker(workerScript, { type: 'module' });
    this.pendingJobs = new Map();
    this.jobId = 0;
    
    this.worker.onmessage = (e) => {
      const { jobId, result, error } = e.data;
      const job = this.pendingJobs.get(jobId);
      
      if (job) {
        if (error) {
          job.reject(new Error(error));
        } else {
          // Reconstruct ImageData
          const { data, width, height } = result;
          job.resolve(new ImageData(
            new Uint8ClampedArray(data),
            width,
            height
          ));
        }
        this.pendingJobs.delete(jobId);
      }
    };
  }

  async denoise(imageData, options) {
    return new Promise((resolve, reject) => {
      const id = ++this.jobId;
      this.pendingJobs.set(id, { resolve, reject });
      
      // Transfer image data
      this.worker.postMessage({
        jobId: id,
        imageData: {
          data: imageData.data.buffer,
          width: imageData.width,
          height: imageData.height,
        },
        options,
      }, [imageData.data.buffer]);
    });
  }

  terminate() {
    this.worker.terminate();
    this.pendingJobs.clear();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  Denoiser,
  NoiseEstimator,
  MedianFilter,
  BilateralFilter,
  NonLocalMeansFilter,
  WaveletFilter,
  WorkerDenoiser,
  DENOISE_CONFIG,
};

// Convenience factory function
export function createDenoiser(options) {
  return new Denoiser(options);
}