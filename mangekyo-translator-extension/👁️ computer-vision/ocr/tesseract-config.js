// /computer-vision/ocr/tesseract-config.js

/**
 * Tesseract.js Configuration for Mangekyo Reader
 * Optimized for manga/manhwa text recognition with vertical Japanese support
 * @module TesseractConfig
 */

import { createWorker, createScheduler } from 'tesseract.js';
import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

export const TESSERACT_CONFIG = {
  // Core OCR settings optimized for manga text
  ocr: {
    // PSM modes: https://github.com/tesseract-ocr/tesseract/blob/main/doc/tesseract.1.asc
    PSM_MODE: {
      AUTO: '3',                    // Fully automatic page segmentation
      SINGLE_COLUMN: '4',           // Assume single column of variable text
      SINGLE_BLOCK: '6',            // Assume single uniform block of text
      SINGLE_LINE: '7',             // Treat as single text line
      SINGLE_WORD: '8',             // Treat as single word
      CIRCLE_WORD: '9',             // Treat as single word in circle
      SINGLE_CHAR: '10',            // Treat as single character
      SPARSE_TEXT: '11',            // Sparse text - find as much text as possible
      SPARSE_TEXT_OSD: '12',        // Sparse text with orientation detection
      RAW_LINE: '13',               // Raw line - no preprocessing
    },
    
    // OEM modes: OCR Engine modes
    OEM_MODE: {
      LSTM_ONLY: '1',               // Neural nets LSTM engine only
      TESSERACT_LSTM_COMBINED: '2', // Legacy + LSTM engines
      DEFAULT: '3',                 // Default, based on what's available
    },
    
    // Language codes
    LANGUAGES: {
      JAPANESE: 'jpn',
      JAPANESE_VERTICAL: 'jpn_vert',
      KOREAN: 'kor',
      CHINESE_SIMPLIFIED: 'chi_sim',
      CHINESE_TRADITIONAL: 'chi_tra',
      ENGLISH: 'eng',
      OSD: 'osd',                   // Orientation and script detection
    },
  },
  
  // Performance tuning
  performance: {
    WORKER_POOL_SIZE: navigator.hardwareConcurrency > 4 ? 4 : 2,
    MAX_CONCURRENT_JOBS: 3,
    CACHE_SIZE: 100,              // Number of recent OCR results to cache
    TIMEOUT_MS: 30000,              // OCR operation timeout
    RETRY_ATTEMPTS: 2,
  },
  
  // Image preprocessing hints
  image: {
    MIN_DIMENSION: 32,            // Minimum image dimension for OCR
    MAX_DIMENSION: 4096,          // Maximum dimension (performance limit)
    IDEAL_DPI: 300,               // Target DPI for optimal recognition
    SUPPORTED_FORMATS: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'],
  },
};

// ============================================================================
// LANGUAGE CONFIGURATION
// ============================================================================

/**
 * Language-specific configurations for manga content
 */
export const LANGUAGE_CONFIGS = {
  japanese: {
    code: 'jpn',
    verticalCode: 'jpn_vert',
    isVertical: true,
    honorifics: ['さん', 'くん', 'ちゃん', '様', '殿', '先生', '先輩', '後輩'],
    sfxPatterns: /[ドバガコンゴシャカ]/,
    preprocessing: {
      deskew: true,
      denoise: true,
      binarize: true,
      invertIfNeeded: true,       // Manga often has white text on black bubbles
    },
    tesseractOptions: {
      tessedit_pageseg_mode: TESSERACT_CONFIG.ocr.PSM_MODE.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: '', // Use full charset for Japanese
    },
  },
  
  korean: {
    code: 'kor',
    isVertical: false,
    honorifics: ['님', '씨', '군', '양', '선생님', '형', '누나', '오빠', '언니'],
    preprocessing: {
      deskew: true,
      denoise: true,
      binarize: true,
      invertIfNeeded: true,
    },
    tesseractOptions: {
      tessedit_pageseg_mode: TESSERACT_CONFIG.ocr.PSM_MODE.SINGLE_BLOCK,
      tessedit_char_whitelist: '',
    },
  },
  
  chinese: {
    codeSimplified: 'chi_sim',
    codeTraditional: 'chi_tra',
    isVertical: true,             // Traditional Chinese manga often vertical
    preprocessing: {
      deskew: true,
      denoise: true,
      binarize: true,
      invertIfNeeded: true,
    },
    tesseractOptions: {
      tessedit_pageseg_mode: TESSERACT_CONFIG.ocr.PSM_MODE.SINGLE_BLOCK,
      tessedit_char_whitelist: '',
    },
  },
  
  english: {
    code: 'eng',
    isVertical: false,
    sfxPatterns: /[BAM POW WHACK ZAP]/i,
    preprocessing: {
      deskew: true,
      denoise: false,             // English less sensitive to noise
      binarize: true,
      invertIfNeeded: true,
    },
    tesseractOptions: {
      tessedit_pageseg_mode: TESSERACT_CONFIG.ocr.PSM_MODE.SINGLE_LINE,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-—""\'() ',
    },
  },
};

// ============================================================================
// WORKER MANAGER CLASS
// ============================================================================

/**
 * Manages Tesseract.js workers with pooling and scheduling
 * Optimized for manga OCR with language-specific workers
 */
export class TesseractWorkerManager {
  constructor() {
    this.scheduler = null;
    this.workers = new Map();      // lang -> worker[]
    this.activeJobs = new Map();
    this.performanceMonitor = new PerformanceMonitor('tesseract');
    this.cache = new Map();        // Simple LRU cache
    this.cacheOrder = [];
    
    this.isInitialized = false;
  }

  /**
   * Initialize worker pool with specified languages
   * @param {string[]} languages - Array of language codes to load
   * @param {Object} options - Initialization options
   */
  async initialize(languages = ['jpn', 'eng'], options = {}) {
    if (this.isInitialized) {
      console.warn('[TesseractManager] Already initialized');
      return;
    }

    const startTime = performance.now();
    
    try {
      // Create scheduler for job management
      this.scheduler = createScheduler();
      
      // Initialize workers for each language
      const workerPromises = languages.map(lang => this._createWorkerPool(lang, options));
      await Promise.all(workerPromises);
      
      this.isInitialized = true;
      
      const initTime = performance.now() - startTime;
      this.performanceMonitor.record('initialization', initTime);
      
      console.log(`[TesseractManager] Initialized ${languages.length} languages in ${initTime.toFixed(2)}ms`);
      
    } catch (error) {
      console.error('[TesseractManager] Initialization failed:', error);
      throw new TesseractInitializationError(error.message);
    }
  }

  /**
   * Create worker pool for specific language
   * @private
   */
  async _createWorkerPool(language, options) {
    const poolSize = options.workerPoolSize || TESSERACT_CONFIG.performance.WORKER_POOL_SIZE;
    const workers = [];
    
    for (let i = 0; i < poolSize; i++) {
      const worker = await createWorker(language, TESSERACT_CONFIG.ocr.OEM_MODE.LSTM_ONLY, {
        logger: m => this._handleWorkerLog(m, language, i),
        errorHandler: e => this._handleWorkerError(e, language, i),
      });
      
      // Configure worker with language-specific settings
      await this._configureWorker(worker, language);
      
      workers.push(worker);
      this.scheduler.addWorker(worker);
    }
    
    this.workers.set(language, workers);
    return workers;
  }

  /**
   * Configure worker with language-specific Tesseract parameters
   * @private
   */
  async _configureWorker(worker, language) {
    const config = this._getLanguageConfig(language);
    
    await worker.setParameters({
      tessedit_pageseg_mode: config.tesseractOptions.tessedit_pageseg_mode,
      preserve_interword_spaces: config.tesseractOptions.preserve_interword_spaces || '0',
      tessedit_char_whitelist: config.tesseractOptions.tessedit_char_whitelist || '',
      
      // Manga-specific optimizations
      textord_min_linesize: '2.5',           // Minimum text line size
      textord_max_noise_size: '0.5',          // Filter small noise
      textord_heavy_nr: '1',                   // Heavy noise removal
      textord_parallel_baselines: '1',         // Better for vertical text
      
      // Performance vs accuracy balance
      tessedit_do_invert: config.preprocessing.invertIfNeeded ? '1' : '0',
    });
  }

  /**
   * Get configuration for language
   * @private
   */
  _getLanguageConfig(language) {
    const langMap = {
      'jpn': LANGUAGE_CONFIGS.japanese,
      'jpn_vert': LANGUAGE_CONFIGS.japanese,
      'kor': LANGUAGE_CONFIGS.korean,
      'chi_sim': LANGUAGE_CONFIGS.chinese,
      'chi_tra': LANGUAGE_CONFIGS.chinese,
      'eng': LANGUAGE_CONFIGS.english,
    };
    
    return langMap[language] || LANGUAGE_CONFIGS.japanese;
  }

  // ============================================================================
  // OCR OPERATIONS
  // ============================================================================

  /**
   * Perform OCR on image with automatic language detection
   * @param {ImageData|HTMLCanvasElement|Blob|string} image - Image source
   * @param {Object} options - OCR options
   * @returns {Promise<OCRResult>}
   */
  async recognize(image, options = {}) {
    if (!this.isInitialized) {
      throw new TesseractNotInitializedError();
    }

    const {
      language = 'auto',
      detectOrientation = true,
      preprocessing = true,
      region = null,              // {x, y, width, height} for ROI
      confidenceThreshold = 60,
    } = options;

    const jobId = this._generateJobId();
    const startTime = performance.now();

    try {
      // Check cache first
      const cacheKey = this._generateCacheKey(image, options);
      const cached = this._getFromCache(cacheKey);
      if (cached) {
        this.performanceMonitor.record('cache_hit', 0);
        return cached;
      }

      // Auto-detect language and orientation if needed
      let targetLang = language;
      let isVertical = false;
      
      if (language === 'auto') {
        const detection = await this._detectLanguageAndOrientation(image);
        targetLang = detection.language;
        isVertical = detection.isVertical;
      } else {
        isVertical = this._getLanguageConfig(targetLang).isVertical;
      }

      // Use vertical variant if detected
      if (targetLang === 'jpn' && isVertical) {
        targetLang = 'jpn_vert';
      }

      // Preprocess image if enabled
      let processedImage = image;
      if (preprocessing) {
        processedImage = await this._preprocessImage(image, targetLang, region);
      }

      // Execute OCR
      const result = await this._executeOCR(processedImage, targetLang, jobId);
      
      // Post-process results
      const processedResult = this._postProcessResult(result, {
        confidenceThreshold,
        isVertical,
        language: targetLang,
      });

      // Cache result
      this._addToCache(cacheKey, processedResult);

      // Record metrics
      const duration = performance.now() - startTime;
      this.performanceMonitor.record('recognition', duration, {
        language: targetLang,
        confidence: processedResult.confidence,
        textLength: processedResult.text.length,
      });

      return processedResult;

    } catch (error) {
      this.performanceMonitor.record('error', performance.now() - startTime);
      throw new TesseractRecognitionError(error.message, jobId);
    }
  }

  /**
   * Execute OCR with retry logic
   * @private
   */
  async _executeOCR(image, language, jobId) {
    const attempts = TESSERACT_CONFIG.performance.RETRY_ATTEMPTS;
    
    for (let i = 0; i <= attempts; i++) {
      try {
        // Add timeout wrapper
        const result = await this._withTimeout(
          this.scheduler.addJob('recognize', image),
          TESSERACT_CONFIG.performance.TIMEOUT_MS
        );
        
        return result;
        
      } catch (error) {
        if (i === attempts) throw error;
        
        console.warn(`[TesseractManager] OCR attempt ${i + 1} failed, retrying...`);
        await this._delay(100 * (i + 1)); // Exponential backoff
      }
    }
  }

  /**
   * Detect language and text orientation
   * @private
   */
  async _detectLanguageAndOrientation(image) {
    // Use OSD (Orientation and Script Detection) worker
    const osdWorker = await createWorker('osd');
    
    try {
      const result = await osdWorker.recognize(image);
      const orientation = result.data.orientation;
      
      // Determine language from script detection
      let language = 'jpn';
      const scripts = result.data.scripts || [];
      
      if (scripts.length > 0) {
        const primaryScript = scripts[0];
        const scriptMap = {
          'Japanese': 'jpn',
          'Korean': 'kor',
          'Han': 'chi_sim',       // Simplified Chinese as default for Han
          'Latin': 'eng',
        };
        language = scriptMap[primaryScript.script] || 'jpn';
      }
      
      return {
        language,
        isVertical: Math.abs(orientation.degrees) > 45 && Math.abs(orientation.degrees) < 135,
        orientation: orientation.degrees,
        confidence: orientation.confidence,
      };
      
    } finally {
      await osdWorker.terminate();
    }
  }

  // ============================================================================
  // PREPROCESSING
  // ============================================================================

  /**
   * Preprocess image for optimal OCR
   * @private
   */
  async _preprocessImage(image, language, region) {
    // This integrates with your preprocessors (denoiser.js, binarizer.js, etc.)
    const config = this._getLanguageConfig(language);
    
    // Create offscreen canvas for processing
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Load image to canvas
    await this._loadImageToCanvas(image, canvas, ctx, region);
    
    // Apply preprocessing pipeline based on language config
    // Note: Actual implementation would call your preprocessor modules
    const preprocessingSteps = [];
    
    if (config.preprocessing.deskew) {
      preprocessingSteps.push('deskew');
    }
    if (config.preprocessing.denoise) {
      preprocessingSteps.push('denoise');
    }
    if (config.preprocessing.binarize) {
      preprocessingSteps.push('binarize');
    }
    
    // Return processed image data
    return canvas;
  }

  /**
   * Load image source to canvas
   * @private
   */
  async _loadImageToCanvas(image, canvas, ctx, region) {
    // Handle different image input types
    let bitmap;
    
    if (image instanceof ImageBitmap) {
      bitmap = image;
    } else if (image instanceof ImageData) {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.putImageData(image, 0, 0);
      return;
    } else if (image instanceof Blob || typeof image === 'string') {
      const img = new Image();
      if (image instanceof Blob) {
        img.src = URL.createObjectURL(image);
      } else {
        img.src = image;
      }
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      bitmap = await createImageBitmap(img);
    } else {
      // Assume HTMLCanvasElement or OffscreenCanvas
      bitmap = await createImageBitmap(image);
    }
    
    // Apply region of interest if specified
    const width = region ? region.width : bitmap.width;
    const height = region ? region.height : bitmap.height;
    const x = region ? region.x : 0;
    const y = region ? region.y : 0;
    
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  }

  // ============================================================================
  // POST-PROCESSING
  // ============================================================================

  /**
   * Post-process OCR results
   * @private
   */
  _postProcessResult(result, options) {
    const { confidenceThreshold, isVertical, language } = options;
    const lines = result.data.lines || [];
    
    // Filter low confidence lines
    const validLines = lines.filter(line => line.confidence >= confidenceThreshold);
    
    // Sort lines for vertical text (top-to-bottom, right-to-left)
    if (isVertical) {
      validLines.sort((a, b) => {
        // Group by columns (x-coordinate)
        const xDiff = Math.abs(a.bbox.x0 - b.bbox.x0);
        if (xDiff > 20) { // Same threshold for column grouping
          return b.bbox.x0 - a.bbox.x0; // Right to left
        }
        return a.bbox.y0 - b.bbox.y0; // Top to bottom
      });
    }
    
    // Clean text artifacts
    const cleanedText = this._cleanText(
      validLines.map(l => l.text).join('\n'),
      language
    );
    
    return {
      text: cleanedText,
      html: this._generateHTML(validLines, isVertical),
      confidence: this._calculateAverageConfidence(validLines),
      lines: validLines.map(line => ({
        text: this._cleanText(line.text, language),
        confidence: line.confidence,
        bbox: line.bbox,
        words: line.words.map(w => ({
          text: w.text,
          confidence: w.confidence,
          bbox: w.bbox,
        })),
      })),
      isVertical,
      language,
      processingTime: result.data.processingTime,
    };
  }

  /**
   * Clean common OCR artifacts in manga text
   * @private
   */
  _cleanText(text, language) {
    let cleaned = text;
    
    // Remove common OCR noise
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Language-specific cleaning
    switch (language) {
      case 'jpn':
      case 'jpn_vert':
        // Fix common Japanese OCR errors
        cleaned = cleaned
          .replace(/ﾞ/g, '゛')  // Dakuten
          .replace(/ﾟ/g, '゜')  // Handakuten
          .replace(/ー/g, 'ー') // Chōonpu normalization
          .replace(/…/g, '……') // Ellipsis standardization
          .replace(/・・・/g, '……');
        break;
        
      case 'kor':
        // Fix Korean jamo composition issues
        cleaned = cleaned.replace(/([ㄱ-ㅎ])([ㅏ-ㅣ])/g, (match, cho, jung) => {
          // Attempt to compose jamo into syllables if needed
          return match;
        });
        break;
        
      case 'chi_sim':
      case 'chi_tra':
        // Fix Chinese punctuation
        cleaned = cleaned
          .replace(/,/g, '，')
          .replace(/\./g, '。')
          .replace(/!/g, '！')
          .replace(/\?/g, '？');
        break;
    }
    
    return cleaned.trim();
  }

  /**
   * Generate HTML representation with positioning
   * @private
   */
  _generateHTML(lines, isVertical) {
    const containerClass = isVertical ? 'ocr-result-vertical' : 'ocr-result-horizontal';
    
    return lines.map(line => {
      const { x0, y0, x1, y1 } = line.bbox;
      const style = `position:absolute;left:${x0}px;top:${y0}px;width:${x1-x0}px;height:${y1-y0}px;`;
      
      return `<div class="ocr-line" style="${style}" data-confidence="${line.confidence}">${this._escapeHtml(line.text)}</div>`;
    }).join('');
  }

  /**
   * Calculate average confidence
   * @private
   */
  _calculateAverageConfidence(lines) {
    if (lines.length === 0) return 0;
    const sum = lines.reduce((acc, line) => acc + line.confidence, 0);
    return Math.round(sum / lines.length);
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  _generateJobId() {
    return `ocr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateCacheKey(image, options) {
    // Simple hash of image data and options
    const str = JSON.stringify({ image: typeof image, options });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  _getFromCache(key) {
    return this.cache.get(key);
  }

  _addToCache(key, value) {
    if (this.cache.size >= TESSERACT_CONFIG.performance.CACHE_SIZE) {
      // LRU eviction
      const oldest = this.cacheOrder.shift();
      this.cache.delete(oldest);
    }
    
    this.cache.set(key, value);
    this.cacheOrder.push(key);
  }

  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OCR timeout')), ms)
      ),
    ]);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _handleWorkerLog(message, language, workerIndex) {
    if (message.status === 'recognizing text') {
      // Progress updates
      const progress = Math.round(message.progress * 100);
      console.debug(`[TesseractWorker ${language}-${workerIndex}] ${progress}%`);
    }
  }

  _handleWorkerError(error, language, workerIndex) {
    console.error(`[TesseractWorker ${language}-${workerIndex}] Error:`, error);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Terminate all workers and cleanup
   */
  async terminate() {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
    }
    
    this.workers.clear();
    this.cache.clear();
    this.cacheOrder = [];
    this.isInitialized = false;
    
    console.log('[TesseractManager] Terminated');
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

export class TesseractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TesseractError';
  }
}

export class TesseractInitializationError extends TesseractError {
  constructor(message) {
    super(`Initialization failed: ${message}`);
    this.name = 'TesseractInitializationError';
  }
}

export class TesseractNotInitializedError extends TesseractError {
  constructor() {
    super('TesseractManager not initialized. Call initialize() first.');
    this.name = 'TesseractNotInitializedError';
  }
}

export class TesseractRecognitionError extends TesseractError {
  constructor(message, jobId) {
    super(`Recognition failed (Job: ${jobId}): ${message}`);
    this.name = 'TesseractRecognitionError';
    this.jobId = jobId;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance = null;

/**
 * Get singleton instance of TesseractWorkerManager
 * @returns {TesseractWorkerManager}
 */
export function getTesseractManager() {
  if (!instance) {
    instance = new TesseractWorkerManager();
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetTesseractManager() {
  if (instance) {
    instance.terminate();
  }
  instance = null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  TESSERACT_CONFIG,
  LANGUAGE_CONFIGS,
  TesseractWorkerManager,
  getTesseractManager,
  resetTesseractManager,
  TesseractError,
  TesseractInitializationError,
  TesseractNotInitializedError,
  TesseractRecognitionError,
};