/**
 * Cubari Adapter - Site-specific handler for cubari.moe
 * 
 * Cubari is an image proxy reader that serves manga from various sources.
 * It uses a dynamic React-based UI with lazy-loaded images and custom navigation.
 * 
 * @module content/site-adapters/cubari-adapter
 */

import { MangaAdapter } from './base-adapter.js';
import { DOMHelpers } from '../../shared/utils/dom-helpers.js';
import { ImageUtils } from '../../shared/utils/image-utils.js';
import { PerformanceMonitor } from '../../shared/utils/performance-monitor.js';

/**
 * Cubari platform adapter
 * Handles detection and extraction for cubari.moe galleries
 */
export class CubariAdapter extends MangaAdapter {
  constructor() {
    super();
    this.platform = 'cubari';
    this.domainPatterns = [
      /cubari\.moe/i,
      /cubari\.gitbook\.io/i  // Legacy domains
    ];
    
    // Cubari-specific selectors
    this.selectors = {
      // Reader container
      readerContainer: '.reader-container, [class*="Reader"]',
      imageContainer: '.image-container, .manga-image-container',
      
      // Image elements - Cubari uses progressive loading
      image: 'img[alt*="page"], img[data-src], .reader-image img, img[src*="imgur"], img[src*="redd.it"]',
      lazyImage: 'img[data-src], img[data-original]',
      
      // Navigation
      nextButton: 'button[aria-label="Next"], .next-page, [class*="Next"]',
      prevButton: 'button[aria-label="Previous"], .prev-page, [class*="Previous"]',
      pageIndicator: '.page-indicator, [class*="PageIndicator"], .current-page',
      
      // Chapter navigation
      chapterList: '.chapter-list, [class*="ChapterList"]',
      chapterLink: 'a[href*="/read/"]',
      
      // Metadata
      title: 'h1, .manga-title, [class*="Title"]',
      chapterTitle: '.chapter-title, [class*="ChapterTitle"]'
    };

    this.observers = new Map();
    this.imageCache = new Map();
    this.processedImages = new WeakSet();
  }

  /**
   * Check if current page is a Cubari reader page
   * @returns {boolean}
   */
  isMatch() {
    const url = window.location.href;
    const isCubariDomain = this.domainPatterns.some(pattern => pattern.test(url));
    const hasReader = !!document.querySelector(this.selectors.readerContainer) ||
                      !!document.querySelector(this.selectors.image);
    
    return isCubariDomain && hasReader;
  }

  /**
   * Initialize adapter for current page
   */
  async initialize() {
    if (this.initialized) return;
    
    console.log('[CubariAdapter] Initializing...');
    const perfMark = PerformanceMonitor.mark('cubari-init');

    // Wait for React hydration
    await this.waitForHydration();
    
    // Setup mutation observer for dynamic content
    this.setupMutationObserver();
    
    // Intercept image loads
    this.interceptImageLoading();
    
    // Setup navigation listeners
    this.setupNavigationListeners();

    this.initialized = true;
    PerformanceMonitor.measure(perfMark, 'cubari-init-complete');
    
    // Emit ready event
    this.emit('ready', {
      platform: this.platform,
      url: window.location.href,
      metadata: await this.extractMetadata()
    });
  }

  /**
   * Wait for React hydration and initial image load
   */
  async waitForHydration() {
    return new Promise((resolve) => {
      const checkReady = () => {
        const images = this.getImageElements();
        const hasContent = images.length > 0 && images.some(img => img.naturalWidth > 0);
        
        if (hasContent || document.readyState === 'complete') {
          setTimeout(resolve, 500); // Buffer for React effects
        } else {
          setTimeout(checkReady, 100);
        }
      };
      
      checkReady();
    });
  }

  /**
   * Get all manga page images from current view
   * @returns {HTMLImageElement[]}
   */
  getImageElements() {
    // Cubari loads images dynamically, check multiple states
    const selectors = [
      this.selectors.image,
      this.selectors.lazyImage,
      '.reader-container img',
      'main img',
      'article img'
    ].join(', ');

    const images = Array.from(document.querySelectorAll(selectors));
    
    // Filter for actual manga pages (exclude icons, avatars)
    return images.filter(img => {
      const src = img.src || img.dataset.src || '';
      const isPageImage = (
        src.includes('imgur') ||
        src.includes('redd.it') ||
        src.includes('githubusercontent') ||
        img.naturalWidth > 400 || // Assume manga pages are wide
        img.closest(this.selectors.readerContainer)
      );
      
      return isPageImage && !this.isProcessed(img);
    });
  }

  /**
   * Extract manga metadata from page
   * @returns {Object}
   */
  async extractMetadata() {
    const url = window.location.href;
    const urlMatch = url.match(/\/read\/([^/]+)\/([^/]+)\/?/);
    
    const metadata = {
      platform: this.platform,
      url: url,
      title: this.extractTitle(),
      chapter: this.extractChapterInfo(),
      seriesId: urlMatch ? urlMatch[1] : null,
      chapterId: urlMatch ? urlMatch[2] : null,
      totalPages: this.getTotalPages(),
      currentPage: this.getCurrentPage(),
      source: this.detectSource()
    };

    return metadata;
  }

  /**
   * Extract title from various Cubari layouts
   */
  extractTitle() {
    const selectors = [
      'h1',
      '.manga-title',
      '[class*="Title"]',
      'title'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        // Cubari titles often include chapter info, clean it up
        return text.replace(/ - Chapter \d+.*$/i, '').trim();
      }
    }
    
    return 'Unknown Title';
  }

  /**
   * Extract chapter information
   */
  extractChapterInfo() {
    const url = window.location.href;
    const chapterMatch = url.match(/\/read\/[^/]+\/([^/]+)\/?/);
    
    const chapterEl = document.querySelector(this.selectors.chapterTitle);
    const pageIndicator = document.querySelector(this.selectors.pageIndicator);
    
    return {
      id: chapterMatch ? chapterMatch[1] : null,
      title: chapterEl ? chapterEl.textContent.trim() : null,
      number: this.extractChapterNumber(chapterEl?.textContent || chapterMatch?.[1] || ''),
      currentPage: this.getCurrentPage(),
      totalPages: this.getTotalPages()
    };
  }

  /**
   * Detect image source type (Imgur, Reddit, GitHub, etc.)
   */
  detectSource() {
    const firstImage = this.getImageElements()[0];
    if (!firstImage) return 'unknown';
    
    const src = firstImage.src || '';
    if (src.includes('imgur.com')) return 'imgur';
    if (src.includes('redd.it') || src.includes('reddit.com')) return 'reddit';
    if (src.includes('githubusercontent.com')) return 'github';
    if (src.includes('catbox.moe')) return 'catbox';
    
    return 'unknown';
  }

  /**
   * Get current page number
   */
  getCurrentPage() {
    // Try URL first
    const urlMatch = window.location.hash.match(/page=(\d+)/);
    if (urlMatch) return parseInt(urlMatch[1]);
    
    // Try indicator element
    const indicator = document.querySelector(this.selectors.pageIndicator);
    if (indicator) {
      const match = indicator.textContent.match(/(\d+)\s*\/\s*\d+/);
      if (match) return parseInt(match[1]);
    }
    
    return 1;
  }

  /**
   * Get total pages in current chapter
   */
  getTotalPages() {
    const indicator = document.querySelector(this.selectors.pageIndicator);
    if (indicator) {
      const match = indicator.textContent.match(/\d+\s*\/\s*(\d+)/);
      if (match) return parseInt(match[1]);
    }
    
    // Count images as fallback
    return this.getImageElements().length;
  }

  /**
   * Setup mutation observer for dynamic image loading
   */
  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let hasNewImages = false;
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const images = node.matches?.('img') ? [node] : 
                          node.querySelectorAll?.('img') || [];
            
            images.forEach(img => {
              if (this.isMangaImage(img) && !this.processedImages.has(img)) {
                hasNewImages = true;
                this.handleNewImage(img);
              }
            });
          }
        });
      });
      
      if (hasNewImages) {
        this.emit('imagesUpdated', { count: this.getImageElements().length });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src']
    });

    this.observers.set('mutation', observer);
  }

  /**
   * Check if image is a manga page
   */
  isMangaImage(img) {
    const src = img.src || img.dataset?.src || '';
    const width = img.naturalWidth || img.width || 0;
    
    return (
      (src.includes('imgur') || 
       src.includes('redd.it') || 
       src.includes('github') ||
       width > 400) &&
      !src.includes('icon') &&
      !src.includes('avatar') &&
      !src.includes('logo')
    );
  }

  /**
   * Handle newly detected image
   */
  handleNewImage(img) {
    // Ensure image is fully loaded before processing
    if (img.complete) {
      this.emit('imageLoaded', { image: img, src: img.src });
    } else {
      img.addEventListener('load', () => {
        this.emit('imageLoaded', { image: img, src: img.src });
      }, { once: true });
    }
  }

  /**
   * Intercept image loading for preprocessing
   */
  interceptImageLoading() {
    // Override Image.prototype.src to catch dynamic loads
    const originalSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
    const adapter = this;
    
    Object.defineProperty(Image.prototype, 'src', {
      set: function(value) {
        // Call original setter
        originalSrc.set.call(this, value);
        
        // Notify adapter
        if (adapter.isMangaImage(this)) {
          adapter.handleNewImage(this);
        }
      },
      get: originalSrc.get
    });
  }

  /**
   * Setup navigation event listeners
   */
  setupNavigationListeners() {
    // Cubari uses React Router - listen for URL changes
    let lastUrl = location.href;
    
    const observer = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        this.handleNavigation(url);
      }
    });
    
    observer.observe(document, { subtree: true, childList: true });
    this.observers.set('navigation', observer);
    
    // Also listen for popstate
    window.addEventListener('popstate', () => {
      this.handleNavigation(location.href);
    });
  }

  /**
   * Handle page/chapter navigation
   */
  handleNavigation(url) {
    console.log('[CubariAdapter] Navigation detected:', url);
    
    // Reset state
    this.processedImages = new WeakSet();
    this.imageCache.clear();
    
    // Re-initialize for new page
    this.initialized = false;
    this.initialize().then(() => {
      this.emit('navigation', { url, metadata: this.extractMetadata() });
    });
  }

  /**
   * Get high-resolution image URL
   * Cubari sometimes serves compressed images
   */
  getHighResUrl(img) {
    let src = img.src || img.dataset?.src || '';
    
    // Imgur: replace size suffixes with original
    if (src.includes('imgur.com')) {
      src = src.replace(/_(l|m|t|h)\.([a-z]+)$/i, '.$2');
      src = src.replace(/\.([a-z]+)\?.*$/, '.$1'); // Remove query params
    }
    
    // Reddit: remove resizing parameters
    if (src.includes('redd.it')) {
      src = src.replace(/\?.*$/, '');
    }
    
    return src;
  }

  /**
   * Extract text regions from image using computer vision
   * @param {HTMLImageElement} img 
   * @returns {Promise<Array>}
   */
  async extractTextRegions(img) {
    const canvas = await ImageUtils.imageToCanvas(img);
    const highResSrc = this.getHighResUrl(img);
    
    // Emit for OCR processing
    this.emit('extractText', {
      image: img,
      canvas: canvas,
      src: highResSrc,
      metadata: {
        page: this.getCurrentPage(),
        chapter: this.extractChapterInfo()
      }
    });
    
    return [];
  }

  /**
   * Inject translation overlay
   */
  injectOverlay(translation, originalRegion) {
    const overlay = document.createElement('div');
    overlay.className = 'mangekyo-translation-overlay cubari-overlay';
    
    // Position over original text
    const rect = originalRegion.getBoundingClientRect();
    const containerRect = this.getReaderContainer().getBoundingClientRect();
    
    overlay.style.cssText = `
      position: absolute;
      left: ${rect.left - containerRect.left}px;
      top: ${rect.top - containerRect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      font-family: 'Noto Sans JP', sans-serif;
      font-size: ${Math.max(12, rect.height / 3)}px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 4px;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: none;
      box-sizing: border-box;
    `;
    
    overlay.textContent = translation.text;
    
    this.getReaderContainer().appendChild(overlay);
    
    // Auto-remove after delay or on navigation
    setTimeout(() => overlay.remove(), 10000);
  }

  /**
   * Get reader container element
   */
  getReaderContainer() {
    return document.querySelector(this.selectors.readerContainer) ||
           document.querySelector('main') ||
           document.body;
  }

  /**
   * Navigate to next page
   */
  async nextPage() {
    const nextBtn = document.querySelector(this.selectors.nextButton);
    if (nextBtn) {
      nextBtn.click();
      return true;
    }
    
    // Fallback: keyboard navigation
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    return true;
  }

  /**
   * Navigate to previous page
   */
  async prevPage() {
    const prevBtn = document.querySelector(this.selectors.prevButton);
    if (prevBtn) {
      prevBtn.click();
      return true;
    }
    
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    return true;
  }

  /**
   * Cleanup adapter resources
   */
  destroy() {
    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();
    this.imageCache.clear();
    this.initialized = false;
    
    // Remove overlays
    document.querySelectorAll('.mangekyo-translation-overlay').forEach(el => el.remove());
  }

  /**
   * Check if image has been processed
   */
  isProcessed(img) {
    return this.processedImages.has(img);
  }

  /**
   * Mark image as processed
   */
  markProcessed(img) {
    this.processedImages.add(img);
  }

  /**
   * Extract chapter number from string
   */
  extractChapterNumber(text) {
    if (!text) return null;
    const match = text.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
    return match ? parseFloat(match[1]) : null;
  }
}

// Export singleton instance
export const cubariAdapter = new CubariAdapter();
export default cubariAdapter;