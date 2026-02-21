/**
 * Image Utilities Module
 * Advanced image processing for manga OCR, preprocessing, and canvas operations
 * @module shared/utils/image-utils
 */

import { PERFORMANCE_THRESHOLDS } from '../constants.js';

/**
 * Image processing configuration
 */
const CONFIG = {
  // Canvas limits for performance
  MAX_CANVAS_DIMENSION: 4096,
  MAX_PIXELS: 16777216, // 4096 * 4096
  
  // Preprocessing defaults
  DEFAULT_DPI: 300,
  BINARIZATION_THRESHOLD: 128,
  CONTRAST_ENHANCEMENT: 1.5,
  
  // Color detection
  COLOR_DETECTION_SAMPLE_SIZE: 100,
  COLOR_VARIANCE_THRESHOLD: 30,
  
  // Compression
  JPEG_QUALITY: 0.92,
  PNG_COMPRESSION: 0.8,
  
  // Memory management
  MAX_CONCURRENT_PROCESSING: 3,
  IMAGE_CACHE_DURATION: 300000 // 5 minutes
};

/**
 * Processing queue for limiting concurrent operations
 */
class ProcessingQueue {
  constructor(maxConcurrent = CONFIG.MAX_CONCURRENT_PROCESSING) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }
  
  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }
  
  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;
    
    this.running++;
    const { task, resolve, reject } = this.queue.shift();
    
    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process(); // Process next
    }
  }
}

const processQueue = new ProcessingQueue();

/**
 * Load image from various sources (URL, File, Blob, ImageData)
 * @param {string|File|Blob|ImageData} source - Image source
 * @returns {Promise<HTMLImageElement>} Loaded image
 */
export async function loadImage(source) {
  return processQueue.add(async () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      
      if (source instanceof File || source instanceof Blob) {
        img.src = URL.createObjectURL(source);
      } else if (source instanceof ImageData) {
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(source, 0, 0);
        img.src = canvas.toDataURL();
      } else {
        img.src = source;
      }
    });
  });
}

/**
 * Create canvas from image with automatic sizing
 * @param {HTMLImageElement} img - Source image
 * @param {Object} options - Processing options
 * @returns {Object} { canvas, ctx, scaleFactor }
 */
export function createCanvasFromImage(img, options = {}) {
  const {
    maxWidth = CONFIG.MAX_CANVAS_DIMENSION,
    maxHeight = CONFIG.MAX_CANVAS_DIMENSION,
    maintainAspect = true,
    smoothing = 'high'
  } = options;
  
  let { width, height } = img;
  let scaleFactor = 1;
  
  // Calculate scale to fit within limits
  if (width > maxWidth || height > maxHeight) {
    const scaleX = maxWidth / width;
    const scaleY = maxHeight / height;
    scaleFactor = Math.min(scaleX, scaleY);
    width = Math.floor(width * scaleFactor);
    height = Math.floor(height * scaleFactor);
  }
  
  // Ensure even dimensions for WASM compatibility
  width = width - (width % 2);
  height = height - (height % 2);
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  const ctx = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true // Reduced latency rendering
  });
  
  // Set image smoothing quality
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = smoothing;
  
  ctx.drawImage(img, 0, 0, width, height);
  
  return { canvas, ctx, scaleFactor, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight };
}

/**
 * Extract image data from specific region (for bubble OCR)
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {Object} region - { x, y, width, height }
 * @param {Object} options - Extraction options
 * @returns {ImageData} Extracted region
 */
export function extractRegion(canvas, region, options = {}) {
  const {
    padding = 0,
    scale = 1,
    grayscale = false
  } = options;
  
  const x = Math.max(0, Math.floor(region.x - padding));
  const y = Math.max(0, Math.floor(region.y - padding));
  const width = Math.min(canvas.width - x, Math.ceil(region.width + padding * 2));
  const height = Math.min(canvas.height - y, Math.ceil(region.height + padding * 2));
  
  const ctx = canvas.getContext('2d');
  let imageData = ctx.getImageData(x, y, width, height);
  
  if (scale !== 1) {
    imageData = rescaleImageData(imageData, scale);
  }
  
  if (grayscale) {
    imageData = convertToGrayscale(imageData);
  }
  
  return imageData;
}

/**
 * Rescale ImageData using high-quality interpolation
 * @param {ImageData} imageData - Source image data
 * @param {number} scale - Scale factor
 * @returns {ImageData} Scaled image data
 */
export function rescaleImageData(imageData, scale) {
  const srcWidth = imageData.width;
  const srcHeight = imageData.height;
  const dstWidth = Math.floor(srcWidth * scale);
  const dstHeight = Math.floor(srcHeight * scale);
  
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcWidth;
  srcCanvas.height = srcHeight;
  srcCanvas.getContext('2d').putImageData(imageData, 0, 0);
  
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstWidth;
  dstCanvas.height = dstHeight;
  const dstCtx = dstCanvas.getContext('2d');
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(srcCanvas, 0, 0, dstWidth, dstHeight);
  
  return dstCtx.getImageData(0, 0, dstWidth, dstHeight);
}

/**
 * Convert ImageData to grayscale
 * @param {ImageData} imageData - Source image data
 * @param {boolean} inplace - Modify original data
 * @returns {ImageData} Grayscale image data
 */
export function convertToGrayscale(imageData, inplace = false) {
  const data = inplace ? imageData.data : new Uint8ClampedArray(imageData.data);
  const len = data.length;
  
  for (let i = 0; i < len; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;     // R
    data[i + 1] = gray; // G
    data[i + 2] = gray; // B
    // Alpha unchanged
  }
  
  if (inplace) return imageData;
  return new ImageData(data, imageData.width, imageData.height);
}

/**
 * Adaptive binarization (Sauvola method) for manga text
 * @param {ImageData} imageData - Grayscale image data
 * @param {number} windowSize - Local window size (odd number)
 * @param {number} k - Sauvola parameter (0.2-0.5)
 * @returns {ImageData} Binary image (black text on white)
 */
export function adaptiveBinarize(imageData, windowSize = 15, k = 0.34) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data.length);
  const halfWindow = Math.floor(windowSize / 2);
  const R = 128; // Dynamic range of standard deviation
  
  // Pre-calculate integral image and squared integral image
  const integral = new Float32Array((width + 1) * (height + 1));
  const integralSq = new Float32Array((width + 1) * (height + 1));
  
  for (let y = 0; y < height; y++) {
    let sum = 0;
    let sumSq = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const val = data[idx];
      sum += val;
      sumSq += val * val;
      const i = (y + 1) * (width + 1) + (x + 1);
      integral[i] = integral[i - width - 1] + sum;
      integralSq[i] = integralSq[i - width - 1] + sumSq;
    }
  }
  
  // Apply Sauvola thresholding
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - halfWindow);
      const y1 = Math.max(0, y - halfWindow);
      const x2 = Math.min(width - 1, x + halfWindow);
      const y2 = Math.min(height - 1, y + halfWindow);
      
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const i1 = y1 * (width + 1) + x1;
      const i2 = y1 * (width + 1) + x2 + 1;
      const i3 = (y2 + 1) * (width + 1) + x1;
      const i4 = (y2 + 1) * (width + 1) + x2 + 1;
      
      const sum = integral[i4] - integral[i3] - integral[i2] + integral[i1];
      const sumSq = integralSq[i4] - integralSq[i3] - integralSq[i2] + integralSq[i1];
      
      const mean = sum / area;
      const variance = (sumSq / area) - (mean * mean);
      const std = Math.sqrt(variance);
      
      const threshold = mean * (1 + k * ((std / R) - 1));
      
      const idx = (y * width + x) * 4;
      const val = data[idx];
      const binary = val < threshold ? 0 : 255;
      
      output[idx] = binary;
      output[idx + 1] = binary;
      output[idx + 2] = binary;
      output[idx + 3] = 255;
    }
  }
  
  return new ImageData(output, width, height);
}

/**
 * Simple Otsu thresholding for global binarization
 * @param {ImageData} imageData - Grayscale image data
 * @returns {Object} { imageData, threshold }
 */
export function otsuBinarize(imageData) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  
  // Calculate histogram
  const histogram = new Float32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.floor(data[i])]++;
  }
  
  // Normalize histogram
  for (let i = 0; i < 256; i++) {
    histogram[i] /= pixelCount;
  }
  
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;
  
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    wF = 1 - wB;
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
  const output = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const val = data[i] < threshold ? 0 : 255;
    output[i] = val;
    output[i + 1] = val;
    output[i + 2] = val;
    output[i + 3] = 255;
  }
  
  return {
    imageData: new ImageData(output, width, height),
    threshold
  };
}

/**
 * Deskew image using Hough transform (simplified)
 * @param {ImageData} imageData - Binary image data
 * @returns {Object} { imageData, angle, confidence }
 */
export function deskewImage(imageData) {
  const { width, height, data } = imageData;
  
  // Projection profile method for skew detection
  const maxSkew = 15; // degrees
  const steps = 60;
  const profiles = [];
  
  for (let s = 0; s < steps; s++) {
    const angle = -maxSkew + (s * 2 * maxSkew / steps);
    const radians = angle * Math.PI / 180;
    const profile = new Float32Array(height);
    
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0; x < width; x++) {
        const srcX = Math.floor(x + y * Math.tan(radians));
        if (srcX >= 0 && srcX < width) {
          const idx = (y * width + srcX) * 4;
          if (data[idx] === 0) count++;
        }
      }
      profile[y] = count;
    }
    
    // Calculate variance (higher variance = sharper peaks = better alignment)
    const mean = profile.reduce((a, b) => a + b, 0) / height;
    const variance = profile.reduce((sum, val) => sum + (val - mean) ** 2, 0) / height;
    profiles.push({ angle, variance, profile });
  }
  
  // Find angle with maximum variance
  const best = profiles.reduce((max, curr) => curr.variance > max.variance ? curr : max);
  
  // Rotate image if significant skew detected
  if (Math.abs(best.angle) > 0.5) {
    const rotated = rotateImageData(imageData, -best.angle);
    return {
      imageData: rotated,
      angle: best.angle,
      confidence: best.variance
    };
  }
  
  return {
    imageData,
    angle: 0,
    confidence: best.variance
  };
}

/**
 * Rotate ImageData by given angle
 * @param {ImageData} imageData - Source image data
 * @param {number} angle - Rotation angle in degrees
 * @returns {ImageData} Rotated image
 */
export function rotateImageData(imageData, angle) {
  const { width: w, height: h, data } = imageData;
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  
  // Calculate new dimensions
  const newW = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const newH = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  
  const output = new Uint8ClampedArray(newW * newH * 4);
  const cx = w / 2;
  const cy = h / 2;
  const ncx = newW / 2;
  const ncy = newH / 2;
  
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const srcX = Math.round(cx + (x - ncx) * cos + (y - ncy) * sin);
      const srcY = Math.round(cy - (x - ncx) * sin + (y - ncy) * cos);
      
      const dstIdx = (y * newW + x) * 4;
      
      if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
        const srcIdx = (srcY * w + srcX) * 4;
        output[dstIdx] = data[srcIdx];
        output[dstIdx + 1] = data[srcIdx + 1];
        output[dstIdx + 2] = data[srcIdx + 2];
        output[dstIdx + 3] = data[srcIdx + 3];
      } else {
        output[dstIdx] = 255;
        output[dstIdx + 1] = 255;
        output[dstIdx + 2] = 255;
        output[dstIdx + 3] = 255;
      }
    }
  }
  
  return new ImageData(output, newW, newH);
}

/**
 * Detect if image is color or grayscale manga
 * @param {ImageData} imageData - Image data to analyze
 * @returns {Object} { isColor, dominantColors, hasScreenTone }
 */
export function analyzeColorMode(imageData) {
  const { data, width, height } = imageData;
  const sampleStep = Math.ceil(Math.sqrt((width * height) / CONFIG.COLOR_DETECTION_SAMPLE_SIZE));
  
  let colorVariance = 0;
  let totalSaturation = 0;
  const colorCounts = new Map();
  let screenToneDetected = false;
  
  // Sample pixels
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      // Check saturation
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      totalSaturation += saturation;
      
      // Check variance from gray
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      colorVariance += Math.abs(r - gray) + Math.abs(g - gray) + Math.abs(b - gray);
      
      // Quantize color for counting
      const quantized = `${Math.floor(r / 32)},${Math.floor(g / 32)},${Math.floor(b / 32)}`;
      colorCounts.set(quantized, (colorCounts.get(quantized) || 0) + 1);
      
      // Screen tone detection (halftone patterns)
      if (!screenToneDetected && x > 0 && y > 0) {
        const prevIdx = (y * width + (x - 1)) * 4;
        const diff = Math.abs(data[idx] - data[prevIdx]);
        if (diff > 20 && diff < 60) screenToneDetected = true;
      }
    }
  }
  
  const samples = Math.ceil(width / sampleStep) * Math.ceil(height / sampleStep);
  const avgSaturation = totalSaturation / samples;
  const avgVariance = colorVariance / (samples * 3);
  
  // Determine if color based on saturation and variance
  const isColor = avgSaturation > 0.15 || avgVariance > CONFIG.COLOR_VARIANCE_THRESHOLD;
  
  // Get dominant colors
  const dominantColors = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([color, count]) => ({
      rgb: color.split(',').map(c => parseInt(c) * 32),
      frequency: count / samples
    }));
  
  return {
    isColor,
    dominantColors,
    hasScreenTone: screenToneDetected,
    saturation: avgSaturation,
    colorVariance: avgVariance
  };
}

/**
 * Remove noise using median filter
 * @param {ImageData} imageData - Source image data
 * @param {number} radius - Filter radius (1-2 recommended)
 * @returns {ImageData} Denoised image
 */
export function medianFilter(imageData, radius = 1) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data.length);
  const size = (radius * 2 + 1) ** 2;
  const half = Math.floor(size / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = [], g = [], b = [];
      
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = Math.min(width - 1, Math.max(0, x + dx));
          const py = Math.min(height - 1, Math.max(0, y + dy));
          const idx = (py * width + px) * 4;
          r.push(data[idx]);
          g.push(data[idx + 1]);
          b.push(data[idx + 2]);
        }
      }
      
      r.sort((a, b) => a - b);
      g.sort((a, b) => a - b);
      b.sort((a, b) => a - b);
      
      const idx = (y * width + x) * 4;
      output[idx] = r[half];
      output[idx + 1] = g[half];
      output[idx + 2] = b[half];
      output[idx + 3] = data[idx + 3];
    }
  }
  
  return new ImageData(output, width, height);
}

/**
 * Enhance contrast using histogram equalization
 * @param {ImageData} imageData - Source image data
 * @returns {ImageData} Enhanced image
 */
export function enhanceContrast(imageData) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  
  // Calculate histogram
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.floor(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    histogram[gray]++;
  }
  
  // Calculate cumulative distribution
  const cdf = new Uint32Array(256);
  cdf[0] = histogram[0];
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1] + histogram[i];
  }
  
  // Normalize
  const cdfMin = cdf.find(v => v > 0);
  const scale = 255 / (pixelCount - cdfMin);
  
  const lookup = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lookup[i] = Math.round((cdf[i] - cdfMin) * scale);
  }
  
  // Apply
  const output = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.floor(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    const val = lookup[gray];
    output[i] = val;
    output[i + 1] = val;
    output[i + 2] = val;
    output[i + 3] = data[i + 3];
  }
  
  return new ImageData(output, width, height);
}

/**
 * Detect text regions using edge density
 * @param {ImageData} imageData - Grayscale or binary image
 * @returns {Array} Array of bounding boxes { x, y, width, height, density }
 */
export function detectTextRegions(imageData) {
  const { width, height, data } = imageData;
  const edgeMap = new Float32Array(width * height);
  
  // Sobel edge detection
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      // Sobel operators
      const gx = 
        -1 * data[((y - 1) * width + (x - 1)) * 4] +
        -2 * data[((y) * width + (x - 1)) * 4] +
        -1 * data[((y + 1) * width + (x - 1)) * 4] +
        1 * data[((y - 1) * width + (x + 1)) * 4] +
        2 * data[((y) * width + (x + 1)) * 4] +
        1 * data[((y + 1) * width + (x + 1)) * 4];
      
      const gy = 
        -1 * data[((y - 1) * width + (x - 1)) * 4] +
        -2 * data[((y - 1) * width + (x)) * 4] +
        -1 * data[((y - 1) * width + (x + 1)) * 4] +
        1 * data[((y + 1) * width + (x - 1)) * 4] +
        2 * data[((y + 1) * width + (x)) * 4] +
        1 * data[((y + 1) * width + (x + 1)) * 4];
      
      edgeMap[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  
  // Sliding window analysis for text block detection
  const regions = [];
  const windowWidth = Math.floor(width / 20);
  const windowHeight = Math.floor(height / 30);
  const strideX = Math.floor(windowWidth / 2);
  const strideY = Math.floor(windowHeight / 2);
  
  for (let y = 0; y < height - windowHeight; y += strideY) {
    for (let x = 0; x < width - windowWidth; x += strideX) {
      let edgeSum = 0;
      let edgeCount = 0;
      
      for (let wy = 0; wy < windowHeight; wy++) {
        for (let wx = 0; wx < windowWidth; wx++) {
          const val = edgeMap[(y + wy) * width + (x + wx)];
          edgeSum += val;
          if (val > 50) edgeCount++;
        }
      }
      
      const density = edgeCount / (windowWidth * windowHeight);
      
      if (density > 0.1 && density < 0.6) { // Text-like density
        regions.push({
          x, y,
          width: windowWidth,
          height: windowHeight,
          density,
          avgEdge: edgeSum / (windowWidth * windowHeight)
        });
      }
    }
  }
  
  // Non-maximum suppression
  return mergeOverlappingRegions(regions, 0.5);
}

/**
 * Merge overlapping bounding boxes
 * @param {Array} regions - Detected regions
 * @param {number} overlapThreshold - IoU threshold for merging
 * @returns {Array} Merged regions
 */
function mergeOverlappingRegions(regions, overlapThreshold = 0.5) {
  if (regions.length === 0) return [];
  
  // Sort by density
  regions.sort((a, b) => b.density - a.density);
  
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < regions.length; i++) {
    if (used.has(i)) continue;
    
    let current = { ...regions[i] };
    used.add(i);
    
    for (let j = i + 1; j < regions.length; j++) {
      if (used.has(j)) continue;
      
      const overlap = calculateIoU(current, regions[j]);
      if (overlap > overlapThreshold) {
        // Merge
        const minX = Math.min(current.x, regions[j].x);
        const minY = Math.min(current.y, regions[j].y);
        const maxX = Math.max(current.x + current.width, regions[j].x + regions[j].width);
        const maxY = Math.max(current.y + current.height, regions[j].y + regions[j].height);
        
        current = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          density: (current.density + regions[j].density) / 2
        };
        used.add(j);
      }
    }
    
    merged.push(current);
  }
  
  return merged;
}

/**
 * Calculate Intersection over Union
 * @param {Object} box1 - First box
 * @param {Object} box2 - Second box
 * @returns {number} IoU value 0-1
 */
function calculateIoU(box1, box2) {
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
 * Compress image data for storage/transmission
 * @param {HTMLCanvasElement|ImageData} source - Image source
 * @param {Object} options - Compression options
 * @returns {Promise<Blob>} Compressed image blob
 */
export async function compressImage(source, options = {}) {
  const {
    type = 'image/jpeg',
    quality = CONFIG.JPEG_QUALITY,
    maxWidth = CONFIG.MAX_CANVAS_DIMENSION,
    maxHeight = CONFIG.MAX_CANVAS_DIMENSION
  } = options;
  
  let canvas;
  
  if (source instanceof ImageData) {
    canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d').putImageData(source, 0, 0);
  } else {
    canvas = source;
  }
  
  // Resize if needed
  let { width, height } = canvas;
  if (width > maxWidth || height > maxHeight) {
    const scale = Math.min(maxWidth / width, maxHeight / height);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
    
    const resized = document.createElement('canvas');
    resized.width = width;
    resized.height = height;
    const ctx = resized.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, width, height);
    canvas = resized;
  }
  
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Compression failed')),
      type,
      quality
    );
  });
}

/**
 * Convert blob to base64 data URL
 * @param {Blob} blob - Image blob
 * @returns {Promise<string>} Base64 data URL
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Calculate image hash for deduplication (average hash)
 * @param {ImageData} imageData - Source image
 * @param {number} size - Hash size (8 = 64-bit hash)
 * @returns {string} Hex hash string
 */
export function calculateImageHash(imageData, size = 8) {
  // Resize to small grayscale image
  const small = rescaleImageData(convertToGrayscale(imageData), size / imageData.width);
  const data = small.data;
  
  // Calculate average
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i];
  }
  const avg = sum / (size * size);
  
  // Create hash
  let hash = '';
  for (let i = 0; i < data.length; i += 4) {
    hash += data[i] >= avg ? '1' : '0';
  }
  
  // Convert to hex
  const hex = parseInt(hash, 2).toString(16).padStart(size * size / 4, '0');
  return hex;
}

/**
 * Compare two image hashes (Hamming distance)
 * @param {string} hash1 - First hash
 * @param {string} hash2 - Second hash
 * @returns {number} Similarity 0-1 (1 = identical)
 */
export function compareHashes(hash1, hash2) {
  const h1 = parseInt(hash1, 16);
  const h2 = parseInt(hash2, 16);
  const xor = h1 ^ h2;
  const distance = xor.toString(2).replace(/0/g, '').length;
  const maxBits = Math.max(hash1.length, hash2.length) * 4;
  return 1 - (distance / maxBits);
}

/**
 * Memory-efficient image cache
 */
export class ImageCache {
  constructor(maxSize = 50, ttl = CONFIG.IMAGE_CACHE_DURATION) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }
  
  set(key, imageData) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data: imageData,
      timestamp: Date.now()
    });
  }
  
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }
  
  clear() {
    this.cache.clear();
  }
}

/**
 * Preprocess pipeline for OCR-ready images
 * @param {HTMLImageElement} img - Source image
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processed result with canvas and metadata
 */
export async function preprocessForOCR(img, options = {}) {
  const {
    grayscale = true,
    binarize = true,
    deskew = true,
    denoise = false,
    enhanceContrast: doEnhance = true,
    targetDPI = CONFIG.DEFAULT_DPI
  } = options;
  
  const startTime = performance.now();
  
  // Create canvas
  let { canvas, ctx, scaleFactor } = createCanvasFromImage(img, {
    maxWidth: CONFIG.MAX_CANVAS_DIMENSION,
    maxHeight: CONFIG.MAX_CANVAS_DIMENSION
  });
  
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let processingSteps = [];
  
  // Analyze color mode
  const colorAnalysis = analyzeColorMode(imageData);
  processingSteps.push('color_analysis');
  
  // Convert to grayscale if needed
  if (grayscale || !colorAnalysis.isColor) {
    imageData = convertToGrayscale(imageData, true);
    processingSteps.push('grayscale');
  }
  
  // Enhance contrast
  if (doEnhance) {
    imageData = enhanceContrast(imageData);
    processingSteps.push('contrast_enhance');
  }
  
  // Denoise
  if (denoise) {
    imageData = medianFilter(imageData, 1);
    processingSteps.push('denoise');
  }
  
  // Deskew
  let skewAngle = 0;
  if (deskew) {
    const deskewResult = deskewImage(imageData);
    imageData = deskewResult.imageData;
    skewAngle = deskewResult.angle;
    if (Math.abs(skewAngle) > 0.5) processingSteps.push('deskew');
  }
  
  // Binarize
  if (binarize) {
    imageData = adaptiveBinarize(imageData);
    processingSteps.push('binarize');
  }
  
  // Put back to canvas
  ctx.putImageData(imageData, 0, 0);
  
  return {
    canvas,
    ctx,
    imageData,
    scaleFactor,
    colorAnalysis,
    skewAngle,
    processingSteps,
    processingTime: performance.now() - startTime,
    originalDimensions: {
      width: img.naturalWidth,
      height: img.naturalHeight
    }
  };
}

// Export default object
export default {
  loadImage,
  createCanvasFromImage,
  extractRegion,
  rescaleImageData,
  convertToGrayscale,
  adaptiveBinarize,
  otsuBinarize,
  deskewImage,
  rotateImageData,
  analyzeColorMode,
  medianFilter,
  enhanceContrast,
  detectTextRegions,
  compressImage,
  blobToBase64,
  calculateImageHash,
  compareHashes,
  ImageCache,
  preprocessForOCR,
  CONFIG
};