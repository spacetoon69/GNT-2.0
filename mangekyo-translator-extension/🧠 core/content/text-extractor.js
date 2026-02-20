/**
 * Text Extractor - Content Script Module
 * Extracts text from manga images using OCR and DOM analysis
 * Coordinates between browser APIs and offscreen document processing
 */

import { CONFIG } from '../shared/constants.js';
import { DOMHelpers } from '../shared/utils/dom-helpers.js';
import { ImageUtils } from '../shared/utils/image-utils.js';
import { TextSanitizer } from '../shared/utils/text-sanitizer.js';

class TextExtractor {
  constructor(config = {}) {
    this.config = {
      minTextLength: 2,
      maxTextLength: 500,
      ocrConfidenceThreshold: 0.65,
      verticalTextThreshold: 0.7, // Ratio height/width to consider vertical
      mergeOverlapThreshold: 0.3, // IoU threshold for merging boxes
      ...config
    };

    this.sanitizer = new TextSanitizer();
    this.languagePatterns = this.initLanguagePatterns();
    
    // Caches
    this.ocrCache = new Map(); // imageKey -> regions
    this.fontCache = new Map(); // element -> font metrics
    
    // Processing state
    this.processingQueue = [];
    this.isProcessing = false;
  }

  /**
   * Initialize language-specific regex patterns
   */
  initLanguagePatterns() {
    return {
      ja: {
        // Japanese - includes hiragana, katakana, kanji, punctuation
        charPattern: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u3400-\u4DBF]/,
        // Common manga sfx patterns
        sfxPattern: /[ドバガキコッツゥ]/,
        // Honorifics
        honorifics: /(さん|くん|ちゃん|様|殿|氏|君|さま|どの)/g,
        vertical: true
      },
      ko: {
        // Korean - hangul syllables and jamo
        charPattern: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
        sfxPattern: /[쿠당쾅쿵]/,
        honorifics: /(님|씨|군|양)/g,
        vertical: false
      },
      zh: {
        // Chinese - simplified and traditional
        charPattern: /[\u4E00-\u9FAF\u3400-\u4DBF]/,
        sfxPattern: /[砰嘣咚]/,
        honorifics: /(先生|女士|小姐)/g,
        vertical: true
      },
      en: {
        charPattern: /[a-zA-Z]/,
        sfxPattern: /(boom|crash|bang|pow)/i,
        honorifics: /(Mr\.|Mrs\.|Ms\.|Dr\.)/g,
        vertical: false
      }
    };
  }

  /**
   * Main extraction entry point
   * @param {ImageData|HTMLImageElement|HTMLCanvasElement} source - Image source
   * @param {Array} detections - Pre-detected text regions from bubble detector
   * @returns {Promise<Array>} Extracted text regions with metadata
   */
  async extract(source, detections = []) {
    console.log(`[TextExtractor] Starting extraction with ${detections.length} detected regions`);

    try {
      // Normalize source to ImageData
      const imageData = await this.normalizeSource(source);
      
      // If no detections provided, run full page OCR
      if (detections.length === 0) {
        detections = await this.detectTextRegions(imageData);
      }

      // Filter and sort detections by reading order
      const validDetections = this.filterDetections(detections);
      const orderedDetections = this.sortReadingOrder(validDetections);

      // Extract text from each region
      const regions = await this.extractRegions(imageData, orderedDetections);
      
      // Post-process and merge related regions
      const processedRegions = this.postProcessRegions(regions);
      
      // Detect language and context
      this.enrichRegionMetadata(processedRegions);

      console.log(`[TextExtractor] Extracted ${processedRegions.length} text regions`);
      return processedRegions;

    } catch (error) {
      console.error('[TextExtractor] Extraction failed:', error);
      throw error;
    }
  }

  /**
   * Normalize various source types to ImageData
   */
  async normalizeSource(source) {
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

    if (source instanceof Blob || source instanceof File) {
      const bitmap = await createImageBitmap(source);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    throw new Error(`Unsupported source type: ${typeof source}`);
  }

  /**
   * Detect text regions using offscreen OCR or fallback
   */
  async detectTextRegions(imageData) {
    // Check cache first
    const cacheKey = await ImageUtils.hashImageData(imageData);
    if (this.ocrCache.has(cacheKey)) {
      return this.ocrCache.get(cacheKey);
    }

    try {
      // Send to offscreen document for heavy OCR processing
      const regions = await this.offscreenOCR(imageData, 'detect-only');
      this.ocrCache.set(cacheKey, regions);
      return regions;
    } catch (error) {
      console.warn('[TextExtractor] Offscreen OCR failed, using fallback:', error);
      return this.fallbackRegionDetection(imageData);
    }
  }

  /**
   * Perform OCR in offscreen document
   */
  offscreenOCR(imageData, mode = 'full') {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OCR timeout'));
      }, 30000);

      // Convert ImageData to transferable format
      const message = {
        type: 'OCR_REQUEST',
        payload: {
          mode,
          imageData: {
            width: imageData.width,
            height: imageData.height,
            data: Array.from(imageData.data) // Convert to array for cloning
          },
          languages: this.config.ocrLanguages || ['eng', 'jpn', 'kor', 'chi_sim'],
          preprocessing: {
            deskew: true,
            denoise: true,
            binarize: true
          }
        }
      };

      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (response?.success) {
          resolve(response.regions);
        } else {
          reject(new Error(response?.error || 'OCR failed'));
        }
      });
    });
  }

  /**
   * Fallback region detection using basic image analysis
   */
  fallbackRegionDetection(imageData) {
    // Simple connected component analysis for text-like regions
    const { data, width, height } = imageData;
    const regions = [];
    const visited = new Set();
    
    // Convert to grayscale and threshold
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      binary[i / 4] = gray < 128 ? 1 : 0;
    }

    // Find connected components (simplified)
    for (let y = 0; y < height; y += 4) { // Skip pixels for performance
      for (let x = 0; x < width; x += 4) {
        const idx = y * width + x;
        if (binary[idx] === 1 && !visited.has(idx)) {
          const component = this.floodFill(binary, x, y, width, height, visited);
          if (this.isValidTextComponent(component)) {
            regions.push({
              x: component.minX,
              y: component.minY,
              width: component.maxX - component.minX,
              height: component.maxY - component.minY,
              confidence: 0.5,
              text: '' // Will be filled later
            });
          }
        }
      }
    }

    return regions;
  }

  /**
   * Flood fill algorithm for connected components
   */
  floodFill(binary, startX, startY, width, height, visited) {
    const stack = [[startX, startY]];
    const component = { 
      pixels: [], 
      minX: startX, 
      maxX: startX, 
      minY: startY, 
      maxY: startY 
    };

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const idx = y * width + x;
      
      if (visited.has(idx) || binary[idx] !== 1) continue;
      visited.add(idx);
      
      component.pixels.push([x, y]);
      component.minX = Math.min(component.minX, x);
      component.maxX = Math.max(component.maxX, x);
      component.minY = Math.min(component.minY, y);
      component.maxY = Math.max(component.maxY, y);

      // 4-connectivity
      if (x > 0) stack.push([x - 1, y]);
      if (x < width - 1) stack.push([x + 1, y]);
      if (y > 0) stack.push([x, y - 1]);
      if (y < height - 1) stack.push([x, y + 1]);
    }

    return component;
  }

  /**
   * Check if component is valid text region
   */
  isValidTextComponent(component) {
    const area = component.pixels.length;
    const width = component.maxX - component.minX;
    const height = component.maxY - component.minY;
    
    // Size filters
    if (area < 100 || area > width * height * 0.9) return false;
    if (width < 10 || height < 10) return false;
    if (width > 1000 || height > 500) return false;
    
    // Aspect ratio filter (text usually not too extreme)
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (ratio > 20) return false;
    
    return true;
  }

  /**
   * Filter detections by quality metrics
   */
  filterDetections(detections) {
    return detections.filter(det => {
      // Size checks
      if (det.width < 20 || det.height < 20) return false;
      if (det.width > 2000 || det.height > 1000) return false;
      
      // Confidence threshold
      if (det.confidence && det.confidence < 0.3) return false;
      
      // Avoid edge artifacts
      if (det.x < 0 || det.y < 0) return false;
      
      return true;
    });
  }

  /**
   * Sort detections by manga reading order (top-to-bottom, right-to-left for Japanese)
   */
  sortReadingOrder(detections) {
    // Group by rows using vertical overlap
    const rows = this.groupIntoRows(detections);
    
    // Sort rows top to bottom
    rows.sort((a, b) => a[0].y - b[0].y);
    
    // Sort each row based on language direction
    const isRTL = this.config.readingDirection === 'rtl';
    
    rows.forEach(row => {
      row.sort((a, b) => isRTL ? b.x - a.x : a.x - b.x);
    });
    
    // Flatten
    return rows.flat();
  }

  /**
   * Group detections into rows based on vertical overlap
   */
  groupIntoRows(detections) {
    const rows = [];
    const sorted = [...detections].sort((a, b) => a.y - b.y);
    
    sorted.forEach(det => {
      let added = false;
      for (const row of rows) {
        // Check vertical overlap with row
        const rowY = row[0].y;
        const rowHeight = Math.max(...row.map(d => d.height));
        if (Math.abs(det.y - rowY) < rowHeight * 0.5) {
          row.push(det);
          added = true;
          break;
        }
      }
      if (!added) {
        rows.push([det]);
      }
    });
    
    return rows;
  }

  /**
   * Extract text from specific regions
   */
  async extractRegions(imageData, detections) {
    const regions = [];
    
    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      
      try {
        // Crop region from full image
        const regionData = this.cropRegion(imageData, det);
        
        // Perform OCR on region
        const ocrResult = await this.recognizeText(regionData, det);
        
        if (ocrResult.text && ocrResult.text.length >= this.config.minTextLength) {
          regions.push({
            id: `region_${i}_${Date.now()}`,
            text: ocrResult.text,
            originalText: ocrResult.text,
            confidence: ocrResult.confidence,
            boundingBox: {
              x: det.x,
              y: det.y,
              width: det.width,
              height: det.height
            },
            isVertical: this.detectVerticalText(det, ocrResult.text),
            fontSize: this.estimateFontSize(det, ocrResult.text),
            language: null, // Will be detected later
            isSFX: false,   // Will be classified later
            context: {
              prevText: i > 0 ? regions[i-1]?.text : null,
              nextText: null,
              panelId: det.panelId || null
            }
          });
        }
      } catch (error) {
        console.warn(`[TextExtractor] Failed to extract region ${i}:`, error);
      }
    }
    
    // Link context
    regions.forEach((region, idx) => {
      if (idx < regions.length - 1) {
        region.context.nextText = regions[idx + 1].text;
      }
    });
    
    return regions;
  }

  /**
   * Crop specific region from ImageData
   */
  cropRegion(imageData, box) {
    const { data, width, height } = imageData;
    const { x, y, width: boxWidth, height: boxHeight } = box;
    
    // Bounds checking
    const startX = Math.max(0, Math.floor(x));
    const startY = Math.max(0, Math.floor(y));
    const endX = Math.min(width, Math.floor(x + boxWidth));
    const endY = Math.min(height, Math.floor(y + boxHeight));
    
    const cropWidth = endX - startX;
    const cropHeight = endY - startY;
    
    const cropped = new ImageData(cropWidth, cropHeight);
    
    for (let row = 0; row < cropHeight; row++) {
      for (let col = 0; col < cropWidth; col++) {
        const srcIdx = ((startY + row) * width + (startX + col)) * 4;
        const dstIdx = (row * cropWidth + col) * 4;
        
        cropped.data[dstIdx] = data[srcIdx];
        cropped.data[dstIdx + 1] = data[srcIdx + 1];
        cropped.data[dstIdx + 2] = data[srcIdx + 2];
        cropped.data[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    
    return cropped;
  }

  /**
   * Recognize text in cropped region
   */
  async recognizeText(regionData, originalDet) {
    // Check if we have cached result
    const cacheKey = await ImageUtils.hashImageData(regionData);
    if (this.ocrCache.has(cacheKey)) {
      return this.ocrCache.get(cacheKey);
    }

    try {
      // Try offscreen OCR first
      const result = await this.offscreenOCR(regionData, 'recognize');
      this.ocrCache.set(cacheKey, result);
      return result;
    } catch (error) {
      // Fallback to basic text detection
      return this.fallbackTextRecognition(regionData);
    }
  }

  /**
   * Fallback text recognition using basic heuristics
   */
  fallbackTextRecognition(imageData) {
    // This is a placeholder - in production, use Tesseract.js directly
    // or another client-side OCR library as fallback
    
    // Simple heuristic: check pixel patterns
    const { data, width, height } = imageData;
    let darkPixels = 0;
    let totalPixels = width * height;
    
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      if (brightness < 128) darkPixels++;
    }
    
    const density = darkPixels / totalPixels;
    
    // Very basic estimation
    return {
      text: density > 0.05 ? '[Text detected]' : '',
      confidence: density > 0.1 ? 0.4 : 0.1,
      isFallback: true
    };
  }

  /**
   * Detect if text is vertical (Japanese traditional)
   */
  detectVerticalText(box, text) {
    // Aspect ratio check
    const ratio = box.height / box.width;
    if (ratio > this.config.verticalTextThreshold) {
      return true;
    }
    
    // Character analysis
    const jaPattern = this.languagePatterns.ja.charPattern;
    const jaChars = [...text].filter(c => jaPattern.test(c)).length;
    const totalChars = text.length;
    
    if (totalChars > 0 && jaChars / totalChars > 0.5) {
      // Japanese text in tall box is likely vertical
      if (ratio > 1.5) return true;
    }
    
    return false;
  }

  /**
   * Estimate font size from region and text
   */
  estimateFontSize(box, text) {
    if (!text || text.length === 0) return 16;
    
    // Rough estimation based on box size and character count
    const isVertical = box.height > box.width;
    const charCount = [...text].length; // Handle unicode properly
    
    if (isVertical) {
      return Math.round(box.height / Math.max(charCount, 1));
    } else {
      // Assume average char width is ~fontSize for CJK, ~0.6 for Latin
      const isCJK = /[\u4E00-\u9FAF]/.test(text);
      const avgCharWidth = isCJK ? 1 : 0.6;
      return Math.round((box.width / Math.max(charCount, 1)) / avgCharWidth);
    }
  }

  /**
   * Post-process regions: merge, clean, deduplicate
   */
  postProcessRegions(regions) {
    if (regions.length === 0) return regions;
    
    // Merge overlapping regions
    let merged = this.mergeOverlappingRegions(regions);
    
    // Clean text content
    merged = merged.map(r => ({
      ...r,
      text: this.sanitizer.cleanOCRText(r.text),
      originalText: r.text
    }));
    
    // Remove duplicates
    merged = this.removeDuplicates(merged);
    
    // Filter by final quality
    merged = merged.filter(r => 
      r.text.length >= this.config.minTextLength &&
      r.confidence >= this.config.ocrConfidenceThreshold
    );
    
    return merged;
  }

  /**
   * Merge overlapping text regions
   */
  mergeOverlappingRegions(regions) {
    const merged = [];
    const used = new Set();
    
    for (let i = 0; i < regions.length; i++) {
      if (used.has(i)) continue;
      
      let current = { ...regions[i] };
      used.add(i);
      
      for (let j = i + 1; j < regions.length; j++) {
        if (used.has(j)) continue;
        
        const other = regions[j];
        const iou = this.calculateIoU(current.boundingBox, other.boundingBox);
        
        if (iou > this.config.mergeOverlapThreshold) {
          // Merge regions
          const box1 = current.boundingBox;
          const box2 = other.boundingBox;
          
          current.boundingBox = {
            x: Math.min(box1.x, box2.x),
            y: Math.min(box1.y, box2.y),
            width: Math.max(box1.x + box1.width, box2.x + box2.width) - Math.min(box1.x, box2.x),
            height: Math.max(box1.y + box1.height, box2.y + box2.height) - Math.min(box1.y, box2.y)
          };
          
          // Concatenate text intelligently
          if (current.isVertical === other.isVertical) {
            current.text = this.mergeText(current.text, other.text, current.isVertical);
          } else {
            current.text += ' ' + other.text;
          }
          
          current.confidence = Math.max(current.confidence, other.confidence);
          used.add(j);
        }
      }
      
      merged.push(current);
    }
    
    return merged;
  }

  /**
   * Calculate Intersection over Union for two boxes
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
   * Merge two text strings based on orientation
   */
  mergeText(text1, text2, isVertical) {
    // Simple heuristic: if vertical, text flows top-to-bottom
    // so we concatenate; if horizontal, left-to-right
    if (isVertical) {
      return text1 + text2;
    } else {
      // Check if they should be space-separated
      const needsSpace = !/[、。！？\.\!\?]$/.test(text1) && 
                         !/^[、。！？\.\!\?]/.test(text2);
      return text1 + (needsSpace ? ' ' : '') + text2;
    }
  }

  /**
   * Remove duplicate regions
   */
  removeDuplicates(regions) {
    const seen = new Set();
    return regions.filter(r => {
      const key = `${r.text}_${Math.round(r.boundingBox.x)}_${Math.round(r.boundingBox.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Enrich regions with metadata (language, SFX detection, etc.)
   */
  enrichRegionMetadata(regions) {
    regions.forEach(region => {
      // Detect language
      region.language = this.detectLanguage(region.text);
      
      // Classify as SFX
      region.isSFX = this.classifySFX(region);
      
      // Detect honorifics
      region.hasHonorifics = this.detectHonorifics(region);
      
      // Estimate reading difficulty
      region.difficulty = this.estimateDifficulty(region);
    });
  }

  /**
   * Detect text language
   */
  detectLanguage(text) {
    if (!text || text.length === 0) return 'unknown';
    
    const scores = {};
    
    for (const [lang, patterns] of Object.entries(this.languagePatterns)) {
      let matchCount = 0;
      let totalChars = 0;
      
      for (const char of text) {
        if (/[\s\d\p{P}]/u.test(char)) continue; // Skip whitespace, digits, punctuation
        totalChars++;
        if (patterns.charPattern.test(char)) {
          matchCount++;
        }
      }
      
      scores[lang] = totalChars > 0 ? matchCount / totalChars : 0;
    }
    
    // Find best match
    const bestLang = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])[0];
    
    return bestLang && bestLang[1] > 0.5 ? bestLang[0] : 'mixed';
  }

  /**
   * Classify if region is sound effect (SFX)
   */
  classifySFX(region) {
    const text = region.text;
    
    // Length check - SFX usually short
    if (text.length > 10) return false;
    
    // Check against SFX patterns
    const lang = region.language;
    const patterns = this.languagePatterns[lang]?.sfxPattern;
    
    if (patterns && patterns.test(text)) {
      return true;
    }
    
    // Heuristic: all caps Latin is often SFX
    if (lang === 'en' && /^[A-Z\s]+$/.test(text)) {
      return true;
    }
    
    // Japanese katakana-heavy text often SFX
    if (lang === 'ja') {
      const katakana = /[\u30A0-\u30FF]/.test(text);
      const hiragana = /[\u3040-\u309F]/.test(text);
      if (katakana && !hiragana) return true;
    }
    
    // Context: isolated small text boxes often SFX
    if (text.length <= 4 && region.boundingBox.width < 100) {
      return true;
    }
    
    return false;
  }

  /**
   * Detect honorifics in text
   */
  detectHonorifics(region) {
    const patterns = this.languagePatterns[region.language];
    if (!patterns?.honorifics) return false;
    
    return patterns.honorifics.test(region.text);
  }

  /**
   * Estimate text difficulty (for translation complexity)
   */
  estimateDifficulty(region) {
    let score = 0;
    const text = region.text;
    
    // Length factor
    score += Math.min(text.length / 50, 2);
    
    // Kanji density (for Japanese)
    if (region.language === 'ja') {
      const kanji = (text.match(/[\u4E00-\u9FAF]/g) || []).length;
      const kanjiRatio = kanji / text.length;
      score += kanjiRatio * 2;
    }
    
    // Honorifics complexity
    if (region.hasHonorifics) score += 0.5;
    
    // Context availability
    if (!region.context.prevText && !region.context.nextText) {
      score += 0.5; // Isolated text harder to translate
    }
    
    return Math.min(score, 5); // Cap at 5
  }

  /**
   * Extract text from DOM element (for hybrid extraction)
   */
  extractFromElement(element) {
    // Check if element has cached data
    if (element.dataset.ocrText) {
      return {
        text: element.dataset.ocrText,
        source: 'cache',
        confidence: 0.9
      };
    }

    // Check for image alt text
    if (element.alt) {
      return {
        text: element.alt,
        source: 'alt',
        confidence: 0.7
      };
    }

    // Check for nearby text elements
    const siblingText = this.findSiblingText(element);
    if (siblingText) {
      return {
        text: siblingText,
        source: 'sibling',
        confidence: 0.6
      };
    }

    return null;
  }

  /**
   * Find text in sibling elements
   */
  findSiblingText(element) {
    const parent = element.parentElement;
    if (!parent) return null;
    
    // Look for text nodes or text elements near the image
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(element);
    
    // Check previous siblings
    for (let i = index - 1; i >= Math.max(0, index - 3); i--) {
      const text = siblings[i].textContent?.trim();
      if (text && text.length > 0) return text;
    }
    
    // Check next siblings
    for (let i = index + 1; i < Math.min(siblings.length, index + 3); i++) {
      const text = siblings[i].textContent?.trim();
      if (text && text.length > 0) return text;
    }
    
    return null;
  }

  /**
   * Clear caches
   */
  clearCache() {
    this.ocrCache.clear();
    this.fontCache.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextExtractor;
}

export default TextExtractor;