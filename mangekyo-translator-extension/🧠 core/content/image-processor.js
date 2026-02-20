/**
 * Image Processor - Preprocessing Pipeline for OCR
 * Handles image enhancement, noise reduction, and optimization for text recognition
 * Specialized for manga/comic processing with panel detection and text region isolation
 */

import { CONFIG } from '../shared/constants.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class ImageProcessor {
  constructor(config = {}) {
    this.config = {
      // Preprocessing toggles
      enableDenoising: true,
      enableBinarization: true,
      enableDeskewing: true,
      enableContrastEnhancement: true,
      enablePanelDetection: true,
      
      // Processing parameters
      targetDPI: 300,
      maxDimension: 2048, // Resize if larger
      minDimension: 400,  // Upscale if smaller
      
      // Denoising
      denoiseStrength: 10, // 0-30
      preserveEdges: true,
      
      // Binarization
      binarizationMethod: 'adaptive', // 'otsu', 'adaptive', 'sauvola'
      adaptiveBlockSize: 15,
      adaptiveC: 10,
      
      // Deskewing
      maxSkewAngle: 15, // degrees
      skewCorrectionThreshold: 0.5,
      
      // Contrast
      contrastClipLimit: 2.0,
      contrastTileSize: 8,
      
      // Manga specific
      screenToneRemoval: true,
      speechBubbleIsolation: true,
      backgroundRemoval: false,
      
      // Output
      outputFormat: 'imageData', // 'imageData', 'blob', 'dataUrl'
      outputQuality: 0.92,
      
      ...config
    };

    this.performanceMonitor = new PerformanceMonitor('image-processor');
    
    // Web Workers for heavy processing
    this.workerPool = [];
    this.maxWorkers = 2;
    
    // Cache for processed images
    this.processCache = new Map();
    this.cacheMaxSize = 50;
    
    // Initialize WASM modules if available
    this.wasmReady = false;
    this.initWasm();
  }

  /**
   * Initialize WASM optimization modules
   */
  async initWasm() {
    try {
      // Check for OpenCV.js or custom WASM
      if (typeof cv !== 'undefined') {
        this.wasmReady = true;
        console.log('[ImageProcessor] OpenCV.js ready');
      }
    } catch (e) {
      console.warn('[ImageProcessor] WASM not available, using JS fallback');
    }
  }

  /**
   * Main processing entry point
   * @param {ImageData|HTMLImageElement|Blob} source - Input image
   * @param {Object} options - Processing options override
   * @returns {Promise<ImageData>} Processed image ready for OCR
   */
  async prepareForOCR(source, options = {}) {
    const perfMark = this.performanceMonitor.start('prepareForOCR');
    const opts = { ...this.config, ...options };
    
    try {
      // Normalize input to ImageData
      let imageData = await this.normalizeInput(source);
      
      // Check cache
      const cacheKey = await this.getCacheKey(imageData, opts);
      if (this.processCache.has(cacheKey)) {
        console.log('[ImageProcessor] Cache hit');
        this.performanceMonitor.end(perfMark);
        return this.processCache.get(cacheKey);
      }
      
      // Step 1: Resize to optimal dimensions
      imageData = this.resizeToOptimal(imageData, opts);
      
      // Step 2: Convert to grayscale
      imageData = this.toGrayscale(imageData);
      
      // Step 3: Denoise
      if (opts.enableDenoising) {
        imageData = this.denoise(imageData, opts);
      }
      
      // Step 4: Contrast enhancement (CLAHE)
      if (opts.enableContrastEnhancement) {
        imageData = this.enhanceContrast(imageData, opts);
      }
      
      // Step 5: Deskew
      if (opts.enableDeskewing) {
        const deskewResult = this.deskew(imageData, opts);
        imageData = deskewResult.imageData;
        opts.detectedSkew = deskewResult.angle;
      }
      
      // Step 6: Binarization
      if (opts.enableBinarization) {
        imageData = this.binarize(imageData, opts);
      }
      
      // Step 7: Manga-specific processing
      if (opts.screenToneRemoval) {
        imageData = this.removeScreenTones(imageData, opts);
      }
      
      // Cache result
      this.addToCache(cacheKey, imageData);
      
      this.performanceMonitor.end(perfMark);
      return imageData;
      
    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[ImageProcessor] Processing failed:', error);
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
      return this.imageToImageData(source);
    }
    
    if (source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d');
      return ctx.getImageData(0, 0, source.width, source.height);
    }
    
    if (source instanceof Blob || source instanceof File) {
      const bitmap = await createImageBitmap(source);
      return this.bitmapToImageData(bitmap);
    }
    
    throw new Error(`Unsupported input type: ${typeof source}`);
  }

  /**
   * Convert Image to ImageData
   */
  imageToImageData(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Convert ImageBitmap to ImageData
   */
  bitmapToImageData(bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Resize image to optimal OCR dimensions
   */
  resizeToOptimal(imageData, opts) {
    const { width, height } = imageData;
    const maxDim = Math.max(width, height);
    const minDim = Math.min(width, height);
    
    let targetWidth = width;
    let targetHeight = height;
    
    // Downscale if too large
    if (maxDim > opts.maxDimension) {
      const scale = opts.maxDimension / maxDim;
      targetWidth = Math.round(width * scale);
      targetHeight = Math.round(height * scale);
    }
    
    // Upscale if too small (improves OCR accuracy)
    if (maxDim < opts.minDimension) {
      const scale = opts.minDimension / maxDim;
      targetWidth = Math.round(width * scale);
      targetHeight = Math.round(height * scale);
    }
    
    if (targetWidth === width && targetHeight === height) {
      return imageData;
    }
    
    return this.resizeImageData(imageData, targetWidth, targetHeight);
  }

  /**
   * Resize ImageData using canvas
   */
  resizeImageData(imageData, targetWidth, targetHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    
    const resized = document.createElement('canvas');
    resized.width = targetWidth;
    resized.height = targetHeight;
    
    const resizedCtx = resized.getContext('2d');
    
    // Use better quality scaling
    resizedCtx.imageSmoothingEnabled = true;
    resizedCtx.imageSmoothingQuality = 'high';
    
    resizedCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    
    return resizedCtx.getImageData(0, 0, targetWidth, targetHeight);
  }

  /**
   * Convert to grayscale
   */
  toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8ClampedArray(width * height * 4);
    
    for (let i = 0; i < data.length; i += 4) {
      // Luminance formula
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      
      gray[i] = lum;
      gray[i + 1] = lum;
      gray[i + 2] = lum;
      gray[i + 3] = data[i + 3]; // Preserve alpha
    }
    
    return new ImageData(gray, width, height);
  }

  /**
   * Denoise using median filter or bilateral filter
   */
  denoise(imageData, opts) {
    if (this.wasmReady && typeof cv !== 'undefined') {
      return this.denoiseOpenCV(imageData, opts);
    }
    
    return this.denoiseJS(imageData, opts);
  }

  /**
   * OpenCV denoising (fast)
   */
  denoiseOpenCV(imageData, opts) {
    const src = cv.matFromImageData(imageData);
    const dst = new cv.Mat();
    
    // Fast NL Means denoising
    cv.fastNlMeansDenoising(src, dst, opts.denoiseStrength, 7, 21);
    
    const result = new ImageData(
      new Uint8ClampedArray(dst.data),
      dst.cols,
      dst.rows
    );
    
    src.delete();
    dst.delete();
    
    return result;
  }

  /**
   * JavaScript median filter denoising
   */
  denoiseJS(imageData, opts) {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data);
    const windowSize = 3;
    const half = Math.floor(windowSize / 2);
    
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        const pixels = [];
        
        // Collect window pixels
        for (let wy = -half; wy <= half; wy++) {
          for (let wx = -half; wx <= half; wx++) {
            const idx = ((y + wy) * width + (x + wx)) * 4;
            pixels.push(data[idx]); // Red channel (grayscale)
          }
        }
        
        // Median
        pixels.sort((a, b) => a - b);
        const median = pixels[Math.floor(pixels.length / 2)];
        
        const idx = (y * width + x) * 4;
        output[idx] = median;
        output[idx + 1] = median;
        output[idx + 2] = median;
      }
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization)
   */
  enhanceContrast(imageData, opts) {
    if (this.wasmReady && typeof cv !== 'undefined') {
      return this.enhanceContrastOpenCV(imageData, opts);
    }
    
    return this.enhanceContrastJS(imageData, opts);
  }

  /**
   * OpenCV CLAHE
   */
  enhanceContrastOpenCV(imageData, opts) {
    const src = cv.matFromImageData(imageData);
    const dst = new cv.Mat();
    
    // Convert to Lab color space for CLAHE on L channel
    const lab = new cv.Mat();
    cv.cvtColor(src, lab, cv.COLOR_RGBA2Lab);
    
    // Split channels
    const planes = new cv.MatVector();
    cv.split(lab, planes);
    
    // Apply CLAHE to L channel
    const clahe = new cv.CLAHE(opts.contrastClipLimit, 
      new cv.Size(opts.contrastTileSize, opts.contrastTileSize));
    clahe.apply(planes.get(0), planes.get(0));
    
    // Merge back
    cv.merge(planes, lab);
    cv.cvtColor(lab, dst, cv.COLOR_Lab2RGBA);
    
    const result = new ImageData(
      new Uint8ClampedArray(dst.data),
      dst.cols,
      dst.rows
    );
    
    src.delete();
    dst.delete();
    lab.delete();
    planes.delete();
    clahe.delete();
    
    return result;
  }

  /**
   * JavaScript histogram equalization
   */
  enhanceContrastJS(imageData, opts) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    
    // Build histogram
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[Math.floor(data[i])]++;
    }
    
    // Build cumulative distribution
    const cdf = new Array(256).fill(0);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }
    
    // Normalize
    const cdfMin = cdf.find(v => v > 0);
    const output = new Uint8ClampedArray(data);
    
    for (let i = 0; i < data.length; i += 4) {
      const val = Math.floor(data[i]);
      const newVal = Math.round(((cdf[val] - cdfMin) / (pixelCount - cdfMin)) * 255);
      
      output[i] = newVal;
      output[i + 1] = newVal;
      output[i + 2] = newVal;
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Detect and correct skew angle
   */
  deskew(imageData, opts) {
    const angle = this.detectSkewAngle(imageData, opts);
    
    if (Math.abs(angle) < opts.skewCorrectionThreshold) {
      return { imageData, angle: 0 };
    }
    
    const rotated = this.rotateImage(imageData, -angle);
    return { imageData: rotated, angle };
  }

  /**
   * Detect skew angle using projection profile
   */
  detectSkewAngle(imageData, opts) {
    const { width, height } = imageData;
    
    // Sample angles to test
    const angles = [];
    for (let a = -opts.maxSkewAngle; a <= opts.maxSkewAngle; a += 0.5) {
      angles.push(a);
    }
    
    let bestAngle = 0;
    let maxVariance = 0;
    
    // Test each angle
    for (const angle of angles) {
      const variance = this.calculateProjectionVariance(imageData, angle);
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = angle;
      }
    }
    
    return bestAngle;
  }

  /**
   * Calculate variance of projection profile at given angle
   */
  calculateProjectionVariance(imageData, angle) {
    const { data, width, height } = imageData;
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    // Project pixels onto perpendicular axis
    const projections = new Map();
    
    for (let y = 0; y < height; y += 2) { // Sample for speed
      for (let x = 0; x < width; x += 2) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 128) { // Dark pixel
          const proj = Math.round(x * cos + y * sin);
          projections.set(proj, (projections.get(proj) || 0) + 1);
        }
      }
    }
    
    // Calculate variance
    let sum = 0, sumSq = 0, count = 0;
    for (const val of projections.values()) {
      sum += val;
      sumSq += val * val;
      count++;
    }
    
    if (count === 0) return 0;
    
    const mean = sum / count;
    return (sumSq / count) - (mean * mean);
  }

  /**
   * Rotate image by given angle
   */
  rotateImage(imageData, angle) {
    const { width, height, data } = imageData;
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    // Calculate new dimensions
    const newWidth = Math.ceil(Math.abs(width * cos) + Math.abs(height * sin));
    const newHeight = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos));
    
    const output = new Uint8ClampedArray(newWidth * newHeight * 4);
    const cx = width / 2, cy = height / 2;
    const ncx = newWidth / 2, ncy = newHeight / 2;
    
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        // Inverse rotation
        const dx = x - ncx;
        const dy = y - ncy;
        const srcX = Math.round(dx * cos + dy * sin + cx);
        const srcY = Math.round(-dx * sin + dy * cos + cy);
        
        const dstIdx = (y * newWidth + x) * 4;
        
        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const srcIdx = (srcY * width + srcX) * 4;
          output[dstIdx] = data[srcIdx];
          output[dstIdx + 1] = data[srcIdx + 1];
          output[dstIdx + 2] = data[srcIdx + 2];
          output[dstIdx + 3] = data[srcIdx + 3];
        } else {
          output[dstIdx] = 255; // White background
          output[dstIdx + 1] = 255;
          output[dstIdx + 2] = 255;
          output[dstIdx + 3] = 255;
        }
      }
    }
    
    return new ImageData(output, newWidth, newHeight);
  }

  /**
   * Binarize image using selected method
   */
  binarize(imageData, opts) {
    switch (opts.binarizationMethod) {
      case 'otsu':
        return this.otsuBinarize(imageData);
      case 'sauvola':
        return this.sauvolaBinarize(imageData, opts);
      case 'adaptive':
      default:
        return this.adaptiveBinarize(imageData, opts);
    }
  }

  /**
   * Otsu's thresholding method
   */
  otsuBinarize(imageData) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    
    // Build histogram
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[Math.floor(data[i])]++;
    }
    
    // Find optimal threshold
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }
    
    let sumB = 0, wB = 0, wF = 0;
    let maxVariance = 0;
    let threshold = 0;
    
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      
      wF = pixelCount - wB;
      if (wF === 0) break;
      
      sumB += t * histogram[t];
      
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      
      const variance = wB * wF * (mB - mF) * (mB - mF);
      
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }
    
    // Apply threshold
    const output = new Uint8ClampedArray(data);
    for (let i = 0; i < data.length; i += 4) {
      const val = data[i] < threshold ? 0 : 255;
      output[i] = val;
      output[i + 1] = val;
      output[i + 2] = val;
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Adaptive (local) thresholding
   */
  adaptiveBinarize(imageData, opts) {
    const { data, width, height } = imageData;
    const blockSize = opts.adaptiveBlockSize;
    const C = opts.adaptiveC;
    const half = Math.floor(blockSize / 2);
    
    const output = new Uint8ClampedArray(data);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Calculate local mean
        let sum = 0, count = 0;
        
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              sum += data[(ny * width + nx) * 4];
              count++;
            }
          }
        }
        
        const threshold = (sum / count) - C;
        const idx = (y * width + x) * 4;
        const val = data[idx] < threshold ? 0 : 255;
        
        output[idx] = val;
        output[idx + 1] = val;
        output[idx + 2] = val;
      }
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Sauvola's thresholding (good for varying illumination)
   */
  sauvolaBinarize(imageData, opts) {
    const { data, width, height } = imageData;
    const blockSize = opts.adaptiveBlockSize;
    const half = Math.floor(blockSize / 2);
    const R = 128; // Dynamic range of standard deviation
    const k = 0.5; // Parameter
    
    const output = new Uint8ClampedArray(data);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Calculate local mean and std
        let sum = 0, sumSq = 0, count = 0;
        
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const val = data[(ny * width + nx) * 4];
              sum += val;
              sumSq += val * val;
              count++;
            }
          }
        }
        
        const mean = sum / count;
        const variance = (sumSq / count) - (mean * mean);
        const std = Math.sqrt(variance);
        
        const threshold = mean * (1 + k * ((std / R) - 1));
        
        const idx = (y * width + x) * 4;
        const val = data[idx] < threshold ? 0 : 255;
        
        output[idx] = val;
        output[idx + 1] = val;
        output[idx + 2] = val;
      }
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Remove manga screen tones (halftone patterns)
   */
  removeScreenTones(imageData, opts) {
    const { data, width, height } = imageData;
    
    // Detect and remove regular dot patterns
    // This is a simplified version - full implementation would use frequency domain filtering
    
    const output = new Uint8ClampedArray(data);
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        const idx = (y * width + x) * 4;
        
        // Check for local variance pattern indicative of screentone
        let localVar = 0;
        const localVals = [];
        
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const nidx = ((y + dy) * width + (x + dx)) * 4;
            localVals.push(data[nidx]);
          }
        }
        
        const mean = localVals.reduce((a, b) => a + b, 0) / localVals.length;
        localVar = localVals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / localVals.length;
        
        // High variance in small window suggests screentone or detail
        // Smooth if it looks like a pattern (medium variance)
        if (localVar > 100 && localVar < 2000) {
          // Apply slight blur
          output[idx] = mean;
          output[idx + 1] = mean;
          output[idx + 2] = mean;
        }
      }
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Extract specific region from image
   */
  extractRegion(imageData, region) {
    const { x, y, width, height } = region;
    const { width: imgWidth, data } = imageData;
    
    const output = new Uint8ClampedArray(width * height * 4);
    
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const srcIdx = ((y + row) * imgWidth + (x + col)) * 4;
        const dstIdx = (row * width + col) * 4;
        
        output[dstIdx] = data[srcIdx];
        output[dstIdx + 1] = data[srcIdx + 1];
        output[dstIdx + 2] = data[srcIdx + 2];
        output[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    
    return new ImageData(output, width, height);
  }

  /**
   * Detect panels in manga page
   */
  detectPanels(imageData) {
    const { width, height, data } = imageData;
    const panels = [];
    
    // Simple panel detection based on line detection
    // Full implementation would use Hough transform or ML
    
    // Find horizontal and vertical lines
    const horizontalLines = this.detectHorizontalLines(imageData);
    const verticalLines = this.detectVerticalLines(imageData);
    
    // Find intersections to define panel boundaries
    const intersections = this.findIntersections(horizontalLines, verticalLines);
    
    // Group intersections into rectangles
    // Simplified: return full image as single panel if no clear divisions
    if (intersections.length < 4) {
      panels.push({
        x: 0, y: 0, width, height,
        confidence: 0.5
      });
    } else {
      // Sort and create panels from intersections
      // This is a placeholder for full panel detection logic
      panels.push({
        x: 0, y: 0, width, height,
        confidence: 0.8,
        subdivisions: intersections.length / 4
      });
    }
    
    return panels;
  }

  /**
   * Detect horizontal lines (panel boundaries)
   */
  detectHorizontalLines(imageData) {
    const { width, height, data } = imageData;
    const lines = [];
    
    for (let y = 10; y < height - 10; y += 5) {
      let lineStrength = 0;
      let gapCount = 0;
      
      for (let x = 0; x < width; x += 2) {
        const idx = (y * width + x) * 4;
        const isDark = data[idx] < 50; // Threshold for black line
        
        if (isDark) {
          lineStrength++;
        } else {
          gapCount++;
        }
      }
      
      // Strong horizontal line if mostly dark with few gaps
      if (lineStrength > width * 0.7 && gapCount < width * 0.1) {
        lines.push({ y, strength: lineStrength / width });
      }
    }
    
    return lines;
  }

  /**
   * Detect vertical lines
   */
  detectVerticalLines(imageData) {
    const { width, height, data } = imageData;
    const lines = [];
    
    for (let x = 10; x < width - 10; x += 5) {
      let lineStrength = 0;
      
      for (let y = 0; y < height; y += 2) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 50) lineStrength++;
      }
      
      if (lineStrength > height * 0.7) {
        lines.push({ x, strength: lineStrength / height });
      }
    }
    
    return lines;
  }

  /**
   * Generate cache key for processed image
   */
  async getCacheKey(imageData, opts) {
    // Simple hash of image data and options
    const data = imageData.data.slice(0, 1000); // Sample first 1000 bytes
    const optString = JSON.stringify(opts);
    
    // Combine into string and hash
    const str = Array.from(data).join(',') + optString;
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return hash.toString();
  }

  /**
   * Add to cache with LRU eviction
   */
  addToCache(key, imageData) {
    if (this.processCache.size >= this.cacheMaxSize) {
      // Remove oldest entry
      const firstKey = this.processCache.keys().next().value;
      this.processCache.delete(firstKey);
    }
    
    this.processCache.set(key, imageData);
  }

  /**
   * Clear processing cache
   */
  clearCache() {
    this.processCache.clear();
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      cacheSize: this.processCache.size,
      wasmEnabled: this.wasmReady,
      config: this.config
    };
  }

  /**
   * Process batch of images
   */
  async processBatch(sources, options = {}) {
    const results = await Promise.all(
      sources.map(source => this.prepareForOCR(source, options).catch(err => {
        console.error('[ImageProcessor] Batch item failed:', err);
        return null;
      }))
    );
    
    return results;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.clearCache();
    this.workerPool.forEach(worker => worker.terminate());
    this.workerPool = [];
  }
}

// Utility functions for ImageData
ImageProcessor.utils = {
  /**
   * Calculate image hash for comparison
   */
  async hashImageData(imageData) {
    const { data } = imageData;
    // Simple average hash
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i];
    }
    return sum.toString();
  },

  /**
   * Convert ImageData to Blob
   */
  toBlob(imageData, type = 'image/png', quality = 0.92) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      
      const ctx = canvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);
      
      canvas.toBlob(resolve, type, quality);
    });
  },

  /**
   * Convert ImageData to Data URL
   */
  toDataURL(imageData, type = 'image/png', quality = 0.92) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    
    return canvas.toDataURL(type, quality);
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageProcessor;
}

export default ImageProcessor;