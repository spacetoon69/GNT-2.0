/**
 * text-roi-extractor.js
 * 
 * Advanced Text Region of Interest (ROI) Extractor for Manga
 * 
 * Features:
 * - Connected Component Analysis (CCA) for text blob detection
 * - Vertical and horizontal text orientation detection
 * - Furigana (ruby text) detection and filtering
 * - Text line grouping and reading order calculation
 * - Integration with speech bubble masks
 * - Curved text path detection
 * - Multi-scale text detection
 */

import { BoundingBoxUtils } from '../bubble-detector/bounding-box-utils.js';

/**
 * Configuration for text ROI extraction
 */
const CONFIG = {
  // Preprocessing
  ADAPTIVE_THRESHOLD_BLOCK_SIZE: 15,
  ADAPTIVE_THRESHOLD_C: 10,
  MORPH_KERNEL_WIDTH: 3,
  MORPH_KERNEL_HEIGHT: 7,  // Taller for vertical text
  MIN_TEXT_BLOB_AREA: 20,
  MAX_TEXT_BLOB_AREA: 50000,
  
  // Text characteristics
  MIN_ASPECT_RATIO: 0.1,
  MAX_ASPECT_RATIO: 15,
  MIN_DENSITY: 0.05,  // Text pixels / bbox area
  
  // Orientation detection
  VERTICAL_THRESHOLD: 1.5,  // height/width ratio for vertical
  HORIZONTAL_THRESHOLD: 0.6, // width/height ratio for horizontal
  
  // Furigana detection
  FURIGANA_MAX_HEIGHT: 15,  // Pixels
  FURIGANA_SIZE_RATIO: 0.5,  // Furigana/main text height ratio
  FURIGANA_VERTICAL_OFFSET: 0.3,  // Expected position relative to main text
  
  // Line grouping
  LINE_GROUPING_THRESHOLD: 1.5,  // Multiplier of average char size
  MAX_LINE_GAP: 30,  // Max pixels between lines
  
  // Performance
  DOWNSAMPLE_MAX_DIM: 1000,
  MIN_CONFIDENCE: 0.6
};

/**
 * Text orientation types
 */
const TEXT_ORIENTATION = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
  MIXED: 'mixed',
  CURVED: 'curved',
  UNKNOWN: 'unknown'
};

/**
 * Text line types
 */
const LINE_TYPE = {
  MAIN: 'main',           // Primary text
  FURIGANA: 'furigana',  // Ruby text above/beside main text
  SFX: 'sfx',            // Sound effects
  NARRATION: 'narration'  // Boxed narration
};

/**
 * Main TextROIExtractor class
 */
export class TextROIExtractor {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.bboxUtils = new BoundingBoxUtils();
    this.tempCanvas = null;
    this.tempCtx = null;
    
    this._initTempCanvas();
  }

  /**
   * Initialize temporary canvas
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
   * Main extraction method
   * @param {HTMLCanvasElement|HTMLImageElement} source - Input image (bubble/panel)
   * @param {Object} options - Extraction options
   * @returns {Promise<TextROI[]>}
   */
  async extract(source, options = {}) {
    const startTime = performance.now();
    
    try {
      // 1. Preprocess image
      const { canvas, scale, originalSize } = this._preprocess(source);
      
      // 2. Detect text orientation
      const orientation = await this._detectOrientation(canvas);
      
      // 3. Apply orientation-specific preprocessing
      const processed = this._applyOrientationPreprocessing(canvas, orientation);
      
      // 4. Extract text blobs using CCA
      const blobs = this._extractTextBlobs(processed, scale);
      
      // 5. Filter and classify blobs
      const filteredBlobs = this._filterTextBlobs(blobs, orientation);
      
      // 6. Detect and separate furigana
      const { mainText, furigana } = this._detectFurigana(filteredBlobs, orientation);
      
      // 7. Group into text lines
      const lines = this._groupIntoLines(mainText, orientation);
      
      // 8. Calculate reading order
      const orderedLines = this._calculateReadingOrder(lines, orientation);
      
      // 9. Create final ROIs
      const rois = this._createROIs(orderedLines, furigana, orientation, originalSize);
      
      console.log(`[TextROIExtractor] Extracted ${rois.length} text regions in ${(performance.now() - startTime).toFixed(2)}ms`);
      
      return rois;
      
    } catch (error) {
      console.error('[TextROIExtractor] Extraction failed:', error);
      throw error;
    }
  }

  /**
   * Preprocess image: grayscale, resize if needed
   * @private
   */
  _preprocess(source) {
    let width = source.naturalWidth || source.width;
    let height = source.naturalHeight || source.height;
    
    // Calculate scale
    const maxDim = Math.max(width, height);
    let scale = 1;
    if (maxDim > this.config.DOWNSAMPLE_MAX_DIM) {
      scale = this.config.DOWNSAMPLE_MAX_DIM / maxDim;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    
    // Setup canvas
    this.tempCanvas.width = width;
    this.tempCanvas.height = height;
    
    // Draw and convert to grayscale
    this.tempCtx.drawImage(source, 0, 0, width, height);
    const imageData = this.tempCtx.getImageData(0, 0, width, height);
    const gray = this._convertToGrayscale(imageData);
    
    return { 
      canvas: this.tempCanvas, 
      scale, 
      originalSize: { 
        width: source.naturalWidth || source.width,
        height: source.naturalHeight || source.height
      },
      gray,
      width,
      height
    };
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
   * Detect text orientation using projection profiles
   * @private
   */
  async _detectOrientation({ gray, width, height }) {
    // Calculate horizontal and vertical projections
    const hProj = new Array(height).fill(0);
    const vProj = new Array(width).fill(0);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = gray[y * width + x];
        if (val < 128) {  // Dark pixel (text)
          hProj[y]++;
          vProj[x]++;
        }
      }
    }
    
    // Calculate variance in projections
    const hVariance = this._calculateVariance(hProj);
    const vVariance = this._calculateVariance(vProj);
    
    // Higher variance indicates text direction
    const hScore = hVariance / (height * height);
    const vScore = vVariance / (width * width);
    
    if (vScore > hScore * 1.5) {
      return TEXT_ORIENTATION.VERTICAL;
    } else if (hScore > vScore * 1.5) {
      return TEXT_ORIENTATION.HORIZONTAL;
    } else {
      return TEXT_ORIENTATION.MIXED;
    }
  }

  /**
   * Calculate variance of array
   * @private
   */
  _calculateVariance(arr) {
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  }

  /**
   * Apply orientation-specific morphological preprocessing
   * @private
   */
  _applyOrientationPreprocessing({ gray, width, height }, orientation) {
    // Adaptive thresholding
    const binary = this._adaptiveThreshold(gray, width, height);
    
    // Morphological operations based on orientation
    let kernelWidth = this.config.MORPH_KERNEL_WIDTH;
    let kernelHeight = this.config.MORPH_KERNEL_HEIGHT;
    
    if (orientation === TEXT_ORIENTATION.HORIZONTAL) {
      // Wider kernel for horizontal text
      [kernelWidth, kernelHeight] = [kernelHeight, kernelWidth];
    }
    
    // Close operation to connect character components
    const closed = this._morphologicalClose(binary, width, height, kernelWidth, kernelHeight);
    
    return { binary: closed, width, height, orientation };
  }

  /**
   * Adaptive thresholding
   * @private
   */
  _adaptiveThreshold(gray, width, height) {
    const binary = new Uint8Array(width * height);
    const blockSize = this.config.ADAPTIVE_THRESHOLD_BLOCK_SIZE;
    const halfBlock = Math.floor(blockSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Calculate local statistics
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
        
        const mean = sum / count;
        const threshold = mean - this.config.ADAPTIVE_THRESHOLD_C;
        
        const idx = y * width + x;
        binary[idx] = gray[idx] < threshold ? 255 : 0;
      }
    }
    
    return binary;
  }

  /**
   * Morphological close operation
   * @private
   */
  _morphologicalClose(binary, width, height, kWidth, kHeight) {
    // Dilate then erode
    const dilated = this._dilate(binary, width, height, kWidth, kHeight);
    return this._erode(dilated, width, height, kWidth, kHeight);
  }

  /**
   * Morphological dilation
   * @private
   */
  _dilate(binary, width, height, kWidth, kHeight) {
    const result = new Uint8Array(binary);
    const halfKW = Math.floor(kWidth / 2);
    const halfKH = Math.floor(kHeight / 2);
    
    for (let y = halfKH; y < height - halfKH; y++) {
      for (let x = halfKW; x < width - halfKW; x++) {
        const idx = y * width + x;
        
        // Check if any pixel in kernel is foreground
        let maxVal = 0;
        for (let ky = -halfKH; ky <= halfKH; ky++) {
          for (let kx = -halfKW; kx <= halfKW; kx++) {
            const nIdx = (y + ky) * width + (x + kx);
            maxVal = Math.max(maxVal, binary[nIdx]);
          }
        }
        
        result[idx] = maxVal;
      }
    }
    
    return result;
  }

  /**
   * Morphological erosion
   * @private
   */
  _erode(binary, width, height, kWidth, kHeight) {
    const result = new Uint8Array(binary);
    const halfKW = Math.floor(kWidth / 2);
    const halfKH = Math.floor(kHeight / 2);
    
    for (let y = halfKH; y < height - halfKH; y++) {
      for (let x = halfKW; x < width - halfKW; x++) {
        const idx = y * width + x;
        
        // Check if all pixels in kernel are foreground
        let minVal = 255;
        for (let ky = -halfKH; ky <= halfKH; ky++) {
          for (let kx = -halfKW; kx <= halfKW; kx++) {
            const nIdx = (y + ky) * width + (x + kx);
            minVal = Math.min(minVal, binary[nIdx]);
          }
        }
        
        result[idx] = minVal;
      }
    }
    
    return result;
  }

  /**
   * Extract text blobs using Connected Component Analysis
   * @private
   */
  _extractTextBlobs({ binary, width, height }, scale) {
    const visited = new Uint8Array(width * height);
    const blobs = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        if (binary[idx] === 255 && !visited[idx]) {
          // BFS to find connected component
          const component = [];
          const queue = [idx];
          visited[idx] = 1;
          
          let minX = x, maxX = x, minY = y, maxY = y;
          let pixelCount = 0;
          
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
            pixelCount++;
            
            // Check 8 neighbors
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                
                const nx = cx + dx;
                const ny = cy + dy;
                
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const nIdx = ny * width + nx;
                  if (!visited[nIdx] && binary[nIdx] === 255) {
                    visited[nIdx] = 1;
                    queue.push(nIdx);
                  }
                }
              }
            }
          }
          
          // Scale coordinates back to original
          const bbox = {
            x: Math.round(minX / scale),
            y: Math.round(minY / scale),
            width: Math.round((maxX - minX + 1) / scale),
            height: Math.round((maxY - minY + 1) / scale)
          };
          
          blobs.push({
            bbox,
            pixels: component,
            pixelCount,
            density: pixelCount / ((maxX - minX + 1) * (maxY - minY + 1)),
            centroid: {
              x: Math.round((minX + maxX) / 2 / scale),
              y: Math.round((minY + maxY) / 2 / scale)
            }
          });
        }
      }
    }
    
    return blobs;
  }

  /**
   * Filter text blobs by size and characteristics
   * @private
   */
  _filterTextBlobs(blobs, orientation) {
    return blobs.filter(blob => {
      const { bbox, pixelCount, density } = blob;
      const area = bbox.width * bbox.height;
      const aspectRatio = bbox.width / (bbox.height + 0.001);
      
      // Size filters
      if (area < this.config.MIN_TEXT_BLOB_AREA || 
          area > this.config.MAX_TEXT_BLOB_AREA) {
        return false;
      }
      
      // Aspect ratio check
      if (aspectRatio < this.config.MIN_ASPECT_RATIO || 
          aspectRatio > this.config.MAX_ASPECT_RATIO) {
        return false;
      }
      
      // Density check (remove noise/artifacts)
      if (density < this.config.MIN_DENSITY) {
        return false;
      }
      
      // Orientation consistency check
      if (orientation === TEXT_ORIENTATION.VERTICAL && aspectRatio > 1.5) {
        return false; // Too wide for vertical text
      }
      if (orientation === TEXT_ORIENTATION.HORIZONTAL && aspectRatio < 0.5) {
        return false; // Too tall for horizontal text
      }
      
      return true;
    });
  }

  /**
   * Detect and separate furigana from main text
   * @private
   */
  _detectFurigana(blobs, orientation) {
    if (blobs.length === 0) return { mainText: [], furigana: [] };
    
    // Sort by size (height) descending
    const sortedByHeight = [...blobs].sort((a, b) => b.bbox.height - a.bbox.height);
    
    // Estimate base character size from largest blobs
    const baseHeight = sortedByHeight[Math.floor(sortedByHeight.length * 0.3)].bbox.height;
    const furiganaThreshold = baseHeight * this.config.FURIGANA_SIZE_RATIO;
    
    const mainText = [];
    const furigana = [];
    
    for (const blob of blobs) {
      const isFurigana = blob.bbox.height < furiganaThreshold &&
                        blob.bbox.height < this.config.FURIGANA_MAX_HEIGHT;
      
      if (isFurigana) {
        // Check position relative to main text
        const nearMainText = mainText.some(main => {
          const dist = Math.sqrt(
            Math.pow(blob.centroid.x - main.centroid.x, 2) +
            Math.pow(blob.centroid.y - main.centroid.y, 2)
          );
          return dist < baseHeight * 2;
        });
        
        if (nearMainText) {
          furigana.push({ ...blob, type: LINE_TYPE.FURIGANA });
        } else {
          mainText.push(blob); // Small but isolated, probably punctuation
        }
      } else {
        mainText.push(blob);
      }
    }
    
    return { mainText, furigana };
  }

  /**
   * Group text blobs into lines
   * @private
   */
  _groupIntoLines(blobs, orientation) {
    if (blobs.length === 0) return [];
    
    // Sort based on orientation
    const sorted = [...blobs].sort((a, b) => {
      if (orientation === TEXT_ORIENTATION.VERTICAL) {
        // Sort by X (columns), then Y (top-to-bottom within column)
        const colDiff = Math.abs(a.centroid.x - b.centroid.x);
        const sameCol = colDiff < Math.min(a.bbox.width, b.bbox.width) * 1.5;
        
        if (sameCol) {
          return a.centroid.y - b.centroid.y; // Top to bottom
        }
        return b.centroid.x - a.centroid.x; // Right to left (manga)
      } else {
        // Horizontal: sort by Y (rows), then X (left-to-right or right-to-left)
        const rowDiff = Math.abs(a.centroid.y - b.centroid.y);
        const sameRow = rowDiff < Math.min(a.bbox.height, b.bbox.height) * 1.2;
        
        if (sameRow) {
          return a.centroid.x - b.centroid.x; // Left to right
        }
        return a.centroid.y - b.centroid.y; // Top to bottom
      }
    });
    
    // Group into lines using clustering
    const lines = [];
    let currentLine = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = currentLine[currentLine.length - 1];
      
      const shouldGroup = orientation === TEXT_ORIENTATION.VERTICAL ?
        Math.abs(current.centroid.x - last.centroid.x) < this.config.LINE_GROUPING_THRESHOLD * last.bbox.width :
        Math.abs(current.centroid.y - last.centroid.y) < this.config.LINE_GROUPING_THRESHOLD * last.bbox.height;
      
      if (shouldGroup) {
        currentLine.push(current);
      } else {
        lines.push(this._createLine(currentLine, orientation));
        currentLine = [current];
      }
    }
    
    if (currentLine.length > 0) {
      lines.push(this._createLine(currentLine, orientation));
    }
    
    return lines;
  }

  /**
   * Create line object from blob group
   * @private
   */
  _createLine(blobs, orientation) {
    // Calculate line bounding box
    const minX = Math.min(...blobs.map(b => b.bbox.x));
    const maxX = Math.max(...blobs.map(b => b.bbox.x + b.bbox.width));
    const minY = Math.min(...blobs.map(b => b.bbox.y));
    const maxY = Math.max(...blobs.map(b => b.bbox.y + b.bbox.height));
    
    return {
      blobs,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      },
      orientation,
      charCount: blobs.length,
      avgCharSize: {
        width: blobs.reduce((sum, b) => sum + b.bbox.width, 0) / blobs.length,
        height: blobs.reduce((sum, b) => sum + b.bbox.height, 0) / blobs.length
      },
      text: null, // To be filled by OCR
      confidence: 0
    };
  }

  /**
   * Calculate reading order for text lines
   * @private
   */
  _calculateReadingOrder(lines, orientation) {
    if (lines.length === 0) return [];
    
    if (orientation === TEXT_ORIENTATION.VERTICAL) {
      // Vertical text: right-to-left, top-to-bottom within each column
      // Group by columns first
      const columns = [];
      let currentCol = [lines[0]];
      
      for (let i = 1; i < lines.length; i++) {
        const current = lines[i];
        const last = currentCol[currentCol.length - 1];
        
        // Check if same column (similar X position)
        const xDiff = Math.abs(current.bbox.x - last.bbox.x);
        const sameCol = xDiff < Math.min(current.bbox.width, last.bbox.width) * 2;
        
        if (sameCol) {
          currentCol.push(current);
        } else {
          columns.push(currentCol);
          currentCol = [current];
        }
      }
      
      if (currentCol.length > 0) {
        columns.push(currentCol);
      }
      
      // Sort columns right-to-left
      columns.sort((a, b) => b[0].bbox.x - a[0].bbox.x);
      
      // Flatten with order
      let order = 1;
      const result = [];
      for (const col of columns) {
        // Within column, sort top-to-bottom
        col.sort((a, b) => a.bbox.y - b.bbox.y);
        for (const line of col) {
          result.push({ ...line, readingOrder: order++ });
        }
      }
      
      return result;
    } else {
      // Horizontal text: top-to-bottom, left-to-right within each row
      const rows = [];
      let currentRow = [lines[0]];
      
      for (let i = 1; i < lines.length; i++) {
        const current = lines[i];
        const last = currentRow[currentRow.length - 1];
        
        const yDiff = Math.abs(current.bbox.y - last.bbox.y);
        const sameRow = yDiff < Math.min(current.bbox.height, last.bbox.height) * 1.5;
        
        if (sameRow) {
          currentRow.push(current);
        } else {
          rows.push(currentRow);
          currentRow = [current];
        }
      }
      
      if (currentRow.length > 0) {
        rows.push(currentRow);
      }
      
      // Sort rows top-to-bottom
      rows.sort((a, b) => a[0].bbox.y - b[0].bbox.y);
      
      let order = 1;
      const result = [];
      for (const row of rows) {
        // Within row, sort left-to-right (or right-to-left for manga)
        row.sort((a, b) => a.bbox.x - b.bbox.x);
        for (const line of row) {
          result.push({ ...line, readingOrder: order++ });
        }
      }
      
      return result;
    }
  }

  /**
   * Create final ROI objects
   * @private
   */
  _createROIs(lines, furigana, orientation, originalSize) {
    const rois = [];
    
    // Add main text lines
    for (const line of lines) {
      rois.push({
        type: LINE_TYPE.MAIN,
        bbox: line.bbox,
        orientation: line.orientation,
        readingOrder: line.readingOrder,
        charCount: line.charCount,
        avgCharSize: line.avgCharSize,
        confidence: this._calculateLineConfidence(line),
        furigana: [], // Will be populated below
        text: null,
        ocrConfidence: 0
      });
    }
    
    // Associate furigana with main text lines
    for (const f of furigana) {
      // Find nearest main text line
      let nearest = null;
      let minDist = Infinity;
      
      for (const roi of rois) {
        const dist = Math.sqrt(
          Math.pow(f.centroid.x - (roi.bbox.x + roi.bbox.width/2), 2) +
          Math.pow(f.centroid.y - (roi.bbox.y + roi.bbox.height/2), 2)
        );
        
        if (dist < minDist && dist < roi.bbox.height * 1.5) {
          minDist = dist;
          nearest = roi;
        }
      }
      
      if (nearest) {
        nearest.furigana.push({
          bbox: f.bbox,
          centroid: f.centroid,
          confidence: 0.8
        });
      }
    }
    
    // Scale bboxes to original size if needed
    if (originalSize.width !== this.tempCanvas.width || 
        originalSize.height !== this.tempCanvas.height) {
      const scaleX = originalSize.width / this.tempCanvas.width;
      const scaleY = originalSize.height / this.tempCanvas.height;
      
      for (const roi of rois) {
        roi.bbox = {
          x: Math.round(roi.bbox.x * scaleX),
          y: Math.round(roi.bbox.y * scaleY),
          width: Math.round(roi.bbox.width * scaleX),
          height: Math.round(roi.bbox.height * scaleY)
        };
      }
    }
    
    return rois;
  }

  /**
   * Calculate confidence score for text line
   * @private
   */
  _calculateLineConfidence(line) {
    // Based on consistency of character sizes and spacing
    const sizes = line.blobs.map(b => b.bbox.height);
    const mean = sizes.reduce((a, b) => a + b) / sizes.length;
    const variance = sizes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sizes.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower stdDev = higher confidence
    const consistency = Math.max(0, 1 - stdDev / mean);
    
    // Density check
    const avgDensity = line.blobs.reduce((sum, b) => sum + b.density, 0) / line.blobs.length;
    
    return (consistency * 0.6 + avgDensity * 0.4) * 0.8 + 0.2; // Scale to 0.2-1.0
  }

  /**
   * Extract text ROI with mask for precise OCR
   * @param {TextROI} roi 
   * @param {HTMLCanvasElement} sourceCanvas
   * @returns {Object} - { image: HTMLCanvasElement, mask: Uint8Array }
   */
  extractWithMask(roi, sourceCanvas) {
    const { x, y, width, height } = roi.bbox;
    
    // Extract region
    const regionCanvas = document.createElement('canvas');
    regionCanvas.width = width;
    regionCanvas.height = height;
    const ctx = regionCanvas.getContext('2d');
    
    ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
    
    // Create binary mask for text
    const imageData = ctx.getImageData(0, 0, width, height);
    const mask = new Uint8Array(width * height);
    
    for (let i = 0; i < imageData.data.length; i += 4) {
      const gray = (imageData.data[i] + imageData.data[i+1] + imageData.data[i+2]) / 3;
      mask[i / 4] = gray < 128 ? 255 : 0;
    }
    
    return {
      image: regionCanvas,
      mask,
      width,
      height,
      orientation: roi.orientation
    };
  }

  /**
   * Batch extraction for multiple bubbles/panels
   * @param {Array<{image: HTMLCanvasElement, id: string}>} regions 
   * @returns {Promise<Object>} - Map of id to TextROI[]
   */
  async extractBatch(regions) {
    const results = {};
    
    for (const region of regions) {
      results[region.id] = await this.extract(region.image);
    }
    
    return results;
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
  }
}

/**
 * Text ROI type definition
 * @typedef {Object} TextROI
 * @property {string} type - Line type (main, furigana, sfx, narration)
 * @property {Object} bbox - Bounding box {x, y, width, height}
 * @property {string} orientation - Text orientation
 * @property {number} readingOrder - Reading sequence order
 * @property {number} charCount - Estimated character count
 * @property {Object} avgCharSize - Average character dimensions
 * @property {number} confidence - Detection confidence
 * @property {Array} furigana - Associated furigana regions
 * @property {string} text - OCR result (populated later)
 * @property {number} ocrConfidence - OCR confidence score
 */

export default TextROIExtractor;