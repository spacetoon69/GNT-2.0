/**
 * Manga Scanner - Core Content Script
 * Detects manga/manhwa pages and orchestrates the scanning pipeline
 * Runs in isolated world with access to DOM
 */

import { CONFIG } from '../shared/constants.js';
import { ConfigManager } from '../shared/config-manager.js';
import { DOMHelpers } from '../shared/utils/dom-helpers.js';
import { ImageUtils } from '../shared/utils/image-utils.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';
import { TextExtractor } from './text-extractor.js';
import { BubbleDetector } from './bubble-detector.js';
import { OverlayInjector } from './overlay-injector.js';
import { CanvasInterceptor } from './canvas-interceptor.js';
import { ImageProcessor } from './image-processor.js';
import { MutationObserverManager } from './mutation-observer.js';
import { SiteAdapterFactory } from './site-adapters/generic-manga-adapter.js';

class MangaScanner {
  constructor() {
    this.config = null;
    this.isActive = false;
    this.isScanning = false;
    this.currentPage = null;
    this.processedImages = new WeakSet();
    this.translationCache = new Map();
    this.observerManager = null;
    this.siteAdapter = null;
    this.performanceMonitor = new PerformanceMonitor('manga-scanner');
    
    // State management
    this.state = {
      scanQueue: [],
      activeTranslations: new Map(),
      pendingImages: new Set(),
      lastScanTime: 0,
      scanCooldown: 500, // ms between scans
      pageMetadata: null
    };

    this.init();
  }

  /**
   * Initialize scanner
   */
  async init() {
    try {
      console.log('[MangaScanner] Initializing...');
      
      // Load configuration
      this.config = await ConfigManager.load();
      
      // Detect site adapter
      this.siteAdapter = SiteAdapterFactory.createAdapter(window.location.hostname);
      
      // Initialize components
      this.textExtractor = new TextExtractor(this.config);
      this.bubbleDetector = new BubbleDetector(this.config);
      this.overlayInjector = new OverlayInjector(this.config);
      this.canvasInterceptor = new CanvasInterceptor(this.config);
      this.imageProcessor = new ImageProcessor(this.config);
      
      // Setup mutation observer for dynamic content
      this.observerManager = new MutationObserverManager(
        this.handleDOMChanges.bind(this),
        this.config
      );

      // Setup message listeners
      this.setupMessageListeners();
      
      // Setup keyboard shortcuts
      this.setupKeyboardShortcuts();
      
      // Check if current page is manga content
      const isMangaPage = await this.detectMangaPage();
      
      if (isMangaPage) {
        await this.activate();
      }

      // Notify background script
      chrome.runtime.sendMessage({
        type: 'SCANNER_INITIALIZED',
        payload: {
          url: window.location.href,
          isMangaPage,
          adapter: this.siteAdapter?.name || 'generic'
        }
      });

    } catch (error) {
      console.error('[MangaScanner] Initialization failed:', error);
      this.reportError('INIT_FAILED', error);
    }
  }

  /**
   * Detect if current page contains manga/manhwa content
   */
  async detectMangaPage() {
    const perfMark = this.performanceMonitor.start('detectMangaPage');
    
    try {
      // Fast checks first
      const urlPatterns = [
        /manga|manhwa|manhua|webtoon|comic/i,
        /chapter|episodes|pages/i
      ];
      
      const isUrlMatch = urlPatterns.some(pattern => 
        pattern.test(window.location.href) || 
        pattern.test(document.title)
      );

      // Check for site-specific indicators
      const siteIndicators = this.siteAdapter?.getIndicators() || [];
      const hasSiteIndicators = siteIndicators.some(selector => 
        document.querySelector(selector) !== null
      );

      // Image analysis - look for manga-style image patterns
      const images = this.getMangaImages();
      const hasMangaImages = images.length > 0 && await this.analyzeImagePatterns(images);

      // Meta tag detection
      const metaTags = {
        ogType: document.querySelector('meta[property="og:type"]')?.content,
        keywords: document.querySelector('meta[name="keywords"]')?.content || '',
        description: document.querySelector('meta[name="description"]')?.content || ''
      };
      
      const hasMetaIndicators = /manga|manhwa|comic/i.test(
        `${metaTags.keywords} ${metaTags.description}`
      );

      const confidence = this.calculateDetectionConfidence({
        isUrlMatch,
        hasSiteIndicators,
        hasMangaImages,
        hasMetaIndicators,
        imageCount: images.length
      });

      this.state.pageMetadata = {
        confidence,
        indicators: {
          url: isUrlMatch,
          site: hasSiteIndicators,
          images: hasMangaImages,
          meta: hasMetaIndicators
        }
      };

      this.performanceMonitor.end(perfMark);
      
      return confidence > 0.6; // Threshold for activation

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[MangaScanner] Detection error:', error);
      return false;
    }
  }

  /**
   * Calculate detection confidence score
   */
  calculateDetectionConfidence(indicators) {
    const weights = {
      isUrlMatch: 0.25,
      hasSiteIndicators: 0.35,
      hasMangaImages: 0.30,
      hasMetaIndicators: 0.10
    };

    let score = 0;
    if (indicators.isUrlMatch) score += weights.isUrlMatch;
    if (indicators.hasSiteIndicators) score += weights.hasSiteIndicators;
    if (indicators.hasMangaImages) score += weights.hasMangaImages;
    if (indicators.hasMetaIndicators) score += weights.hasMetaIndicators;

    // Boost score if multiple indicators present
    const trueCount = Object.values(indicators).filter(Boolean).length;
    if (trueCount >= 3) score += 0.1;

    // Adjust based on image count
    if (indicators.imageCount > 5) score += 0.05;
    if (indicators.imageCount > 20) score += 0.05;

    return Math.min(score, 1.0);
  }

  /**
   * Get potential manga images from page
   */
  getMangaImages() {
    const selectors = this.siteAdapter?.getImageSelectors() || [
      'img[src*=".jpg"]',
      'img[src*=".jpeg"]',
      'img[src*=".png"]',
      'img[src*=".webp"]',
      'picture source[srcset]',
      '[data-src]', // Lazy loaded images
      'canvas[data-image]' // Canvas-based readers
    ];

    const images = [];
    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (this.isValidMangaImage(el)) {
          images.push(el);
        }
      });
    });

    // Remove duplicates and sort by position (top-to-bottom reading order)
    return this.deduplicateImages(images)
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectA.top - rectB.top || rectA.left - rectB.left;
      });
  }

  /**
   * Validate if element is a valid manga image
   */
  isValidMangaImage(element) {
    // Skip tiny images (icons, buttons)
    const rect = element.getBoundingClientRect();
    const minSize = this.config.minImageSize || { width: 200, height: 300 };
    
    if (rect.width < minSize.width || rect.height < minSize.height) {
      return false;
    }

    // Skip images that are likely UI elements
    const ariaLabel = element.getAttribute('aria-label') || '';
    const altText = element.alt || '';
    const skipKeywords = ['logo', 'icon', 'button', 'avatar', 'profile'];
    
    if (skipKeywords.some(kw => 
      ariaLabel.toLowerCase().includes(kw) || 
      altText.toLowerCase().includes(kw)
    )) {
      return false;
    }

    // Check aspect ratio (manga typically portrait)
    const ratio = rect.height / rect.width;
    if (ratio < 0.5 || ratio > 3.0) {
      return false; // Too wide or too tall
    }

    return true;
  }

  /**
   * Remove duplicate images (same src or data-src)
   */
  deduplicateImages(images) {
    const seen = new Set();
    return images.filter(img => {
      const key = img.src || img.dataset.src || img.currentSrc;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Analyze image patterns to confirm manga content
   */
  async analyzeImagePatterns(images) {
    if (images.length === 0) return false;
    
    // Sample first few images
    const sampleSize = Math.min(3, images.length);
    const samples = images.slice(0, sampleSize);
    
    let mangaLikeCount = 0;
    
    for (const img of samples) {
      try {
        const features = await this.imageProcessor.extractFeatures(img);
        
        // Check for manga characteristics
        const isMangaLike = (
          features.hasSpeechBubbles || 
          features.textDensity > 0.1 ||
          features.panelLayoutDetected ||
          features.aspectRatio > 1.2 // Portrait orientation
        );
        
        if (isMangaLike) mangaLikeCount++;
        
      } catch (e) {
        // Ignore processing errors for individual images
      }
    }

    return mangaLikeCount / sampleSize > 0.5;
  }

  /**
   * Activate scanner on current page
   */
  async activate() {
    if (this.isActive) return;
    
    console.log('[MangaScanner] Activating...');
    this.isActive = true;
    
    // Inject CSS
    this.injectStyles();
    
    // Setup canvas interceptor for WebGL/Canvas readers
    this.canvasInterceptor.activate();
    
    // Start observing DOM changes
    this.observerManager.start();
    
    // Initial scan
    await this.scanPage();
    
    // Notify UI
    this.showActivationIndicator();
    
    // Setup auto-scan if enabled
    if (this.config.autoScan) {
      this.setupAutoScan();
    }
  }

  /**
   * Deactivate scanner
   */
  deactivate() {
    if (!this.isActive) return;
    
    console.log('[MangaScanner] Deactivating...');
    this.isActive = false;
    
    this.observerManager?.stop();
    this.canvasInterceptor?.deactivate();
    this.overlayInjector?.clearAll();
    
    this.hideActivationIndicator();
    
    // Clear state
    this.state.activeTranslations.clear();
    this.state.pendingImages.clear();
    this.state.scanQueue = [];
  }

  /**
   * Main scanning function
   */
  async scanPage(force = false) {
    if (this.isScanning && !force) {
      console.log('[MangaScanner] Scan already in progress, queueing...');
      this.state.scanQueue.push({ force });
      return;
    }

    // Rate limiting
    const now = Date.now();
    if (!force && now - this.state.lastScanTime < this.state.scanCooldown) {
      return;
    }
    this.state.lastScanTime = now;

    this.isScanning = true;
    const perfMark = this.performanceMonitor.start('scanPage');

    try {
      // Get all manga images
      const images = this.getMangaImages();
      console.log(`[MangaScanner] Found ${images.length} potential manga images`);

      // Filter unprocessed images
      const newImages = images.filter(img => !this.processedImages.has(img));
      
      if (newImages.length === 0) {
        console.log('[MangaScanner] No new images to process');
        return;
      }

      // Process images in batches
      const batchSize = this.config.processingBatchSize || 3;
      for (let i = 0; i < newImages.length; i += batchSize) {
        const batch = newImages.slice(i, i + batchSize);
        await this.processImageBatch(batch);
      }

      // Process any queued scans
      if (this.state.scanQueue.length > 0) {
        const next = this.state.scanQueue.shift();
        setTimeout(() => this.scanPage(next.force), 100);
      }

    } catch (error) {
      console.error('[MangaScanner] Scan error:', error);
      this.reportError('SCAN_ERROR', error);
    } finally {
      this.isScanning = false;
      this.performanceMonitor.end(perfMark);
    }
  }

  /**
   * Process a batch of images
   */
  async processImageBatch(images) {
    const promises = images.map(img => this.processSingleImage(img));
    await Promise.allSettled(promises);
  }

  /**
   * Process single manga image
   */
  async processSingleImage(imageElement) {
    if (this.processedImages.has(imageElement)) return;
    if (this.state.pendingImages.has(imageElement)) return;

    this.state.pendingImages.add(imageElement);
    const perfMark = this.performanceMonitor.start('processImage');

    try {
      // Wait for image to load
      await this.ensureImageLoaded(imageElement);

      // Extract image data
      const imageData = await this.imageProcessor.prepareForOCR(imageElement);
      
      // Detect text regions/bubbles
      const detections = await this.bubbleDetector.detect(imageData);
      
      if (detections.length === 0) {
        console.log('[MangaScanner] No text detected in image');
        this.processedImages.add(imageElement);
        return;
      }

      console.log(`[MangaScanner] Detected ${detections.length} text regions`);

      // Extract text from regions
      const textRegions = await this.textExtractor.extract(
        imageData, 
        detections
      );

      // Filter valid text (not SFX, not too short)
      const validRegions = this.filterValidText(textRegions);
      
      if (validRegions.length === 0) {
        this.processedImages.add(imageElement);
        return;
      }

      // Send to background for translation
      const translations = await this.requestTranslations(validRegions);

      // Inject overlays
      await this.overlayInjector.inject(imageElement, translations);

      // Mark as processed
      this.processedImages.add(imageElement);
      
      // Store active translations
      translations.forEach(t => {
        this.state.activeTranslations.set(t.id, t);
      });

      // Notify background
      chrome.runtime.sendMessage({
        type: 'IMAGE_PROCESSED',
        payload: {
          imageId: imageElement.src || imageElement.dataset.src,
          regionCount: validRegions.length,
          translationCount: translations.length
        }
      });

    } catch (error) {
      console.error('[MangaScanner] Image processing error:', error);
      this.reportError('IMAGE_PROCESS_ERROR', error, {
        imageSrc: imageElement.src
      });
    } finally {
      this.state.pendingImages.delete(imageElement);
      this.performanceMonitor.end(perfMark);
    }
  }

  /**
   * Ensure image is fully loaded
   */
  ensureImageLoaded(imageElement) {
    return new Promise((resolve, reject) => {
      if (imageElement.complete && imageElement.naturalWidth > 0) {
        resolve();
        return;
      }

      const onLoad = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('Image failed to load'));
      };

      const cleanup = () => {
        imageElement.removeEventListener('load', onLoad);
        imageElement.removeEventListener('error', onError);
      };

      imageElement.addEventListener('load', onLoad);
      imageElement.addEventListener('error', onError);

      // Timeout after 10 seconds
      setTimeout(() => {
        cleanup();
        reject(new Error('Image load timeout'));
      }, 10000);
    });
  }

  /**
   * Filter valid text regions (remove noise, SFX, etc.)
   */
  filterValidText(regions) {
    return regions.filter(region => {
      // Skip if too short
      if (region.text.length < 2) return false;
      
      // Skip if likely SFX (configurable)
      if (this.config.skipSFX && region.isSFX) return false;
      
      // Skip if confidence too low
      if (region.confidence < (this.config.minOCRConfidence || 0.6)) {
        return false;
      }

      // Skip common non-text patterns
      const noisePatterns = [
        /^[0-9\s]+$/,
        /^[!?.]+$/,
        /^\s*$/,
        /^www\./,
        /^http/
      ];
      
      if (noisePatterns.some(p => p.test(region.text))) {
        return false;
      }

      return true;
    });
  }

  /**
   * Request translations from background script
   */
  async requestTranslations(regions) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Translation request timeout'));
      }, 30000);

      chrome.runtime.sendMessage({
        type: 'TRANSLATE_REGIONS',
        payload: {
          regions: regions.map(r => ({
            id: r.id,
            text: r.text,
            language: r.detectedLanguage,
            context: r.context,
            boundingBox: r.boundingBox
          })),
          targetLanguage: this.config.targetLanguage,
          preserveHonorifics: this.config.preserveHonorifics,
          contextPreservation: this.config.contextPreservation
        }
      }, (response) => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (response?.success) {
          resolve(response.translations);
        } else {
          reject(new Error(response?.error || 'Translation failed'));
        }
      });
    });
  }

  /**
   * Handle DOM mutations
   */
  handleDOMChanges(mutations) {
    if (!this.isActive) return;

    let hasNewImages = false;
    let hasSignificantChange = false;

    mutations.forEach(mutation => {
      // Check for added nodes
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if new images added
          if (node.tagName === 'IMG' || node.querySelector('img')) {
            hasNewImages = true;
          }
          
          // Check for dynamic content containers
          if (this.siteAdapter?.isContentContainer(node)) {
            hasSignificantChange = true;
          }
        }
      });

      // Check for attribute changes on images (lazy loading)
      if (mutation.type === 'attributes' && 
          mutation.target.tagName === 'IMG') {
        const attrName = mutation.attributeName;
        if (['src', 'data-src', 'srcset'].includes(attrName)) {
          hasNewImages = true;
        }
      }
    });

    if (hasSignificantChange || hasNewImages) {
      // Debounce rapid mutations
      clearTimeout(this._mutationDebounce);
      this._mutationDebounce = setTimeout(() => {
        this.scanPage();
      }, 500);
    }
  }

  /**
   * Setup message listeners for background communication
   */
  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const handler = this.messageHandlers[message.type];
      
      if (handler) {
        handler.call(this, message.payload, sendResponse);
        return true; // Async response
      }
    });
  }

  /**
   * Message handlers
   */
  messageHandlers = {
    // Manual scan trigger
    SCAN_PAGE: async (payload, sendResponse) => {
      try {
        await this.scanPage(true);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    },

    // Toggle scanner state
    TOGGLE_SCANNER: (payload, sendResponse) => {
      if (this.isActive) {
        this.deactivate();
      } else {
        this.activate();
      }
      sendResponse({ success: true, isActive: this.isActive });
    },

    // Get current state
    GET_STATE: (payload, sendResponse) => {
      sendResponse({
        isActive: this.isActive,
        isScanning: this.isScanning,
        processedCount: this.processedImages.length,
        pendingCount: this.state.pendingImages.size,
        activeTranslations: this.state.activeTranslations.size,
        pageMetadata: this.state.pageMetadata
      });
    },

    // Update configuration
    UPDATE_CONFIG: async (payload, sendResponse) => {
      this.config = { ...this.config, ...payload };
      await ConfigManager.save(this.config);
      sendResponse({ success: true });
    },

    // Clear all translations
    CLEAR_TRANSLATIONS: (payload, sendResponse) => {
      this.overlayInjector.clearAll();
      this.processedImages = new WeakSet();
      this.state.activeTranslations.clear();
      sendResponse({ success: true });
    },

    // Reprocess specific image
    REPROCESS_IMAGE: async (payload, sendResponse) => {
      try {
        const { imageSrc } = payload;
        // Find image by src
        const img = document.querySelector(`img[src="${imageSrc}"]`);
        if (img && this.processedImages.has(img)) {
          this.processedImages.delete(img);
          await this.processSingleImage(img);
        }
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
  };

  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Only trigger if not in input field
      if (e.target.matches('input, textarea, [contenteditable]')) {
        return;
      }

      const shortcuts = this.config.shortcuts || {};
      
      // Scan trigger: Alt+S
      if (e.altKey && e.key === 's') {
        e.preventDefault();
        this.scanPage(true);
      }
      
      // Toggle scanner: Alt+M
      if (e.altKey && e.key === 'm') {
        e.preventDefault();
        if (this.isActive) {
          this.deactivate();
        } else {
          this.activate();
        }
      }
      
      // Clear translations: Alt+C
      if (e.altKey && e.key === 'c') {
        e.preventDefault();
        this.overlayInjector.clearAll();
      }
    });
  }

  /**
   * Setup auto-scan interval
   */
  setupAutoScan() {
    if (this._autoScanInterval) {
      clearInterval(this._autoScanInterval);
    }
    
    const interval = this.config.autoScanInterval || 5000;
    this._autoScanInterval = setInterval(() => {
      if (this.isActive && !this.isScanning) {
        this.scanPage();
      }
    }, interval);
  }

  /**
   * Inject required styles
   */
  injectStyles() {
    if (document.getElementById('manga-scanner-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'manga-scanner-styles';
    styles.textContent = `
      .manga-scanner-overlay {
        position: absolute;
        pointer-events: auto;
        z-index: 2147483646;
        font-family: 'Noto Sans JP', 'Noto Sans KR', sans-serif;
        transition: opacity 0.3s ease;
      }
      
      .manga-scanner-overlay:hover {
        z-index: 2147483647;
      }
      
      .manga-scanner-indicator {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(220, 38, 38, 0.9);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        z-index: 2147483647;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: mangaScannerPulse 2s infinite;
      }
      
      @keyframes mangaScannerPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.8; }
      }
      
      .manga-scanner-loading {
        position: absolute;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        pointer-events: none;
        z-index: 2147483646;
      }
    `;
    
    document.head.appendChild(styles);
  }

  /**
   * Show activation indicator
   */
  showActivationIndicator() {
    this.hideActivationIndicator();
    
    const indicator = document.createElement('div');
    indicator.id = 'manga-scanner-active';
    indicator.className = 'manga-scanner-indicator';
    indicator.innerHTML = '👁️';
    indicator.title = 'Manga Scanner Active (Alt+M to toggle)';
    
    indicator.addEventListener('click', () => {
      this.deactivate();
    });
    
    document.body.appendChild(indicator);
  }

  /**
   * Hide activation indicator
   */
  hideActivationIndicator() {
    const existing = document.getElementById('manga-scanner-active');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Report error to background
   */
  reportError(type, error, context = {}) {
    chrome.runtime.sendMessage({
      type: 'SCANNER_ERROR',
      payload: {
        errorType: type,
        message: error.message,
        stack: error.stack,
        context: {
          url: window.location.href,
          ...context
        }
      }
    });
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    this.deactivate();
    
    if (this._autoScanInterval) {
      clearInterval(this._autoScanInterval);
    }
    
    this.observerManager?.destroy();
    this.canvasInterceptor?.destroy();
    
    // Remove styles
    document.getElementById('manga-scanner-styles')?.remove();
    
    console.log('[MangaScanner] Destroyed');
  }
}

// Initialize scanner
const scanner = new MangaScanner();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  scanner.destroy();
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MangaScanner;
}