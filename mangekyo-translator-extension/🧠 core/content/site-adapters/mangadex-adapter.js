/**
 * MangaDex Adapter
 * 
 * Site-specific handler for mangaDex.org
 * Handles MD@Home image loading, chapter navigation, and reader modes
 * 
 * Located in: core/content/site-adapters/mangadex-adapter.js
 */

import { BaseMangaAdapter } from './generic-manga-adapter.js';
import { getMutationObserver } from '../mutation-observer.js';
import { ImageCache } from '../../../storage/indexeddb/image-cache.js';

class MangaDexAdapter extends BaseMangaAdapter {
  constructor() {
    super();
    
    this.name = 'MangaDex';
    this.domains = ['mangadex.org', 'www.mangadex.org'];
    this.readerUrlPattern = /\/chapter\/[0-9a-f-]+/;
    
    // MangaDex-specific selectors
    this.selectors = {
      readerContainer: '.md--reader__container, .reader--container, [class*="reader"]',
      pageImage: '.md--reader__image, .reader-image, img[data-src]',
      pageWrapper: '.md--reader__page, .reader-page',
      chapterTitle: '.md--chapter-header__title, .chapter-title',
      mangaTitle: '.md--manga-header__title, .manga-title',
      progressBar: '.md--reader__progress, .reader-progress',
      settingsPanel: '.md--reader__settings, .reader-settings',
      commentsSection: '.md--comments__container'
    };

    // MD@Home server data
    this.mdHomeData = {
      baseUrl: null,
      chapterHash: null,
      data: [],
      dataSaver: []
    };

    this.currentChapter = null;
    this.pageObserver = null;
    this.preloadQueue = new Set();
  }

  /**
   * Detect if current page is a MangaDex reader
   */
  detect() {
    const isReader = this.readerUrlPattern.test(window.location.pathname);
    const hasContainer = !!document.querySelector(this.selectors.readerContainer);
    
    return isReader && hasContainer;
  }

  /**
   * Initialize adapter for current chapter
   */
  async initialize() {
    if (!this.detect()) {
      throw new Error('Not a valid MangaDex reader page');
    }

    console.debug('[MangaDexAdapter] Initializing...');
    
    // Extract chapter metadata from DOM or API
    await this.extractChapterData();
    
    // Setup page observation
    this.setupPageObserver();
    
    // Intercept MD@Home image loading
    this.interceptImageLoading();
    
    // Handle reader mode changes (long-strip vs single-page)
    this.detectReaderMode();
    
    return this;
  }

  /**
   * Extract chapter information from page data or API
   */
  async extractChapterData() {
    // Method 1: Extract from window.__DATA__ (server-side rendered)
    if (window.__DATA__?.chapter) {
      this.currentChapter = {
        id: window.__DATA__.chapter.id,
        mangaId: window.__DATA__.manga.id,
        title: window.__DATA__.chapter.title,
        chapterNumber: window.__DATA__.chapter.chapter,
        volume: window.__DATA__.chapter.volume,
        pages: window.__DATA__.chapter.pages,
        translatedLanguage: window.__DATA__.chapter.translatedLanguage
      };
      
      this.mdHomeData = {
        baseUrl: window.__DATA__.baseUrl,
        chapterHash: window.__DATA__.chapter.hash,
        data: window.__DATA__.chapter.data,
        dataSaver: window.__DATA__.chapter.dataSaver
      };
    } 
    // Method 2: Extract from API if window data not available
    else {
      const chapterId = this.extractChapterIdFromUrl();
      await this.fetchChapterData(chapterId);
    }

    console.debug('[MangaDexAdapter] Chapter data:', this.currentChapter);
  }

  /**
   * Extract chapter UUID from URL
   */
  extractChapterIdFromUrl() {
    const match = window.location.pathname.match(/\/chapter\/([0-9a-f-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetch chapter data from MangaDex API
   */
  async fetchChapterData(chapterId) {
    try {
      const response = await fetch(`https://api.mangadex.org/chapter/${chapterId}`);
      const { data } = await response.json();
      
      this.currentChapter = {
        id: data.id,
        mangaId: data.relationships.find(r => r.type === 'manga')?.id,
        title: data.attributes.title,
        chapterNumber: data.attributes.chapter,
        volume: data.attributes.volume,
        translatedLanguage: data.attributes.translatedLanguage
      };

      // Fetch image server data
      const atHomeResponse = await fetch(
        `https://api.mangadex.org/at-home/server/${chapterId}`
      );
      const atHomeData = await atHomeResponse.json();
      
      this.mdHomeData = {
        baseUrl: atHomeData.baseUrl,
        chapterHash: atHomeData.chapter.hash,
        data: atHomeData.chapter.data,
        dataSaver: atHomeData.chapter.dataSaver
      };
    } catch (error) {
      console.error('[MangaDexAdapter] Failed to fetch chapter data:', error);
      throw error;
    }
  }

  /**
   * Setup observer for page changes (long-strip scroll or page navigation)
   */
  setupPageObserver() {
    const readerContainer = document.querySelector(this.selectors.readerContainer);
    if (!readerContainer) return;

    // Use shared mutation observer with MangaDex-specific filters
    this.pageObserver = getMutationObserver();
    
    // Observe reader container for image additions
    this.pageObserver.observeElement(readerContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src', 'data-page']
    });

    // Listen for custom events from mutation observer
    document.addEventListener('manga-translator:scanRequested', (e) => {
      if (e.detail.type === 'images') {
        this.handleNewImages();
      }
    });

    // MangaDex-specific: Listen for page change events
    document.addEventListener('md:pageChange', (e) => {
      this.onPageChange(e.detail);
    });
  }

  /**
   * Intercept MD@Home image loading for processing
   */
  interceptImageLoading() {
    // Override Image.prototype.src to catch lazy-loaded images
    const originalSrcSetter = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype, 
      'src'
    ).set;

    const adapter = this;
    
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      set: function(value) {
        // Check if this is a MangaDex image
        if (adapter.isMangaDexImageUrl(value)) {
          adapter.processImageElement(this, value);
        }
        
        return originalSrcSetter.call(this, value);
      },
      get: function() {
        return this.getAttribute('src');
      }
    });

    // Also intercept data-src for lazy loading
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'data-src' || mutation.attributeName === 'src')) {
          const img = mutation.target;
          const src = img.src || img.dataset.src;
          
          if (src && adapter.isMangaDexImageUrl(src)) {
            adapter.processImageElement(img, src);
          }
        }
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['src', 'data-src'],
      subtree: true
    });
  }

  /**
   * Check if URL is from MD@Home servers
   */
  isMangaDexImageUrl(url) {
    if (!url) return false;
    
    return url.includes('mangadex.org') || 
           url.includes('md-cdn.') ||
           /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d+\.(jpg|png|webp)/.test(url);
  }

  /**
   * Process discovered image element
   */
  async processImageElement(imgElement, src) {
    // Skip if already processed
    if (imgElement.dataset.mangaTranslatorProcessed) return;
    
    imgElement.dataset.mangaTranslatorProcessed = 'true';
    
    const pageData = {
      element: imgElement,
      src: src,
      pageNumber: this.extractPageNumber(imgElement),
      dimensions: {
        width: imgElement.naturalWidth || imgElement.width,
        height: imgElement.naturalHeight || imgElement.height
      }
    };

    // Dispatch for OCR processing
    this.dispatchAdapterEvent('pageDiscovered', pageData);
    
    // Preload adjacent pages for smoother experience
    this.preloadAdjacentPages(pageData.pageNumber);
  }

  /**
   * Extract page number from element or URL
   */
  extractPageNumber(imgElement) {
    // Try data attribute first
    if (imgElement.dataset.page) {
      return parseInt(imgElement.dataset.page, 10);
    }
    
    // Try parent container
    const parent = imgElement.closest('[data-page]');
    if (parent) {
      return parseInt(parent.dataset.page, 10);
    }
    
    // Extract from URL
    const match = imgElement.src?.match(/\/(\d+)\.(jpg|png|webp)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    
    return null;
  }

  /**
   * Preload next/prev pages for faster navigation
   */
  preloadAdjacentPages(currentPage) {
    const preloadRange = 2; // Preload 2 pages ahead and behind
    
    for (let offset = -preloadRange; offset <= preloadRange; offset++) {
      if (offset === 0) continue;
      
      const targetPage = currentPage + offset;
      if (targetPage < 1 || targetPage > this.currentChapter.pages) continue;
      
      const cacheKey = `${this.currentChapter.id}_${targetPage}`;
      if (this.preloadQueue.has(cacheKey)) continue;
      
      this.preloadQueue.add(cacheKey);
      
      // Preload into IndexedDB cache
      ImageCache.preloadImage(
        this.constructImageUrl(targetPage),
        cacheKey
      ).catch(() => {
        this.preloadQueue.delete(cacheKey);
      });
    }
  }

  /**
   * Construct full image URL from MD@Home data
   */
  constructImageUrl(pageNumber, dataSaver = false) {
    const filename = dataSaver 
      ? this.mdHomeData.dataSaver[pageNumber - 1]
      : this.mdHomeData.data[pageNumber - 1];
      
    return `${this.mdHomeData.baseUrl}/data/${this.mdHomeData.chapterHash}/${filename}`;
  }

  /**
   * Detect reader mode (long-strip vs paginated)
   */
  detectReaderMode() {
    const readerContainer = document.querySelector(this.selectors.readerContainer);
    if (!readerContainer) return 'unknown';

    // Check for long-strip mode indicators
    const isLongStrip = 
      readerContainer.classList.contains('md--reader__container--long-strip') ||
      getComputedStyle(readerContainer).display === 'flex' ||
      document.querySelector('.md--reader__page').style.width === '100%';

    this.readerMode = isLongStrip ? 'long-strip' : 'paginated';
    
    console.debug('[MangaDexAdapter] Reader mode:', this.readerMode);
    
    return this.readerMode;
  }

  /**
   * Handle new images detected by mutation observer
   */
  handleNewImages() {
    const images = document.querySelectorAll(this.selectors.pageImage);
    
    images.forEach(img => {
      if (!img.dataset.mangaTranslatorProcessed) {
        this.processImageElement(img, img.src || img.dataset.src);
      }
    });
  }

  /**
   * Handle page navigation event
   */
  onPageChange(detail) {
    const { pageNumber, direction } = detail;
    
    this.dispatchAdapterEvent('pageChanged', {
      pageNumber,
      direction,
      chapter: this.currentChapter
    });
    
    // Update active translation overlays
    this.updateVisibleOverlays(pageNumber);
  }

  /**
   * Get all visible manga pages in current viewport
   */
  getVisiblePages() {
    const pages = document.querySelectorAll(this.selectors.pageWrapper);
    const visible = [];
    
    pages.forEach(page => {
      const rect = page.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
      
      if (isVisible) {
        const img = page.querySelector('img');
        if (img) {
          visible.push({
            element: img,
            pageNumber: this.extractPageNumber(img),
            boundingRect: rect
          });
        }
      }
    });
    
    return visible;
  }

  /**
   * Inject translation overlay specific to MangaDex layout
   */
  injectOverlay(pageElement, translationData) {
    const overlay = document.createElement('div');
    overlay.className = 'manga-translator-overlay md-compatible';
    
    // Position relative to page wrapper
    const pageWrapper = pageElement.closest(this.selectors.pageWrapper);
    if (pageWrapper) {
      pageWrapper.style.position = 'relative';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '1000';
      
      pageWrapper.appendChild(overlay);
    }
    
    return overlay;
  }

  /**
   * Update overlay positions on scroll (critical for long-strip mode)
   */
  updateOverlayPositions() {
    if (this.readerMode !== 'long-strip') return;
    
    const overlays = document.querySelectorAll('.manga-translator-overlay');
    overlays.forEach(overlay => {
      const pageWrapper = overlay.closest(this.selectors.pageWrapper);
      if (pageWrapper) {
        const rect = pageWrapper.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
        
        overlay.style.display = isVisible ? 'block' : 'none';
        
        if (isVisible) {
          // Adjust for any scaling/transforms applied by MangaDex
          const transform = window.getComputedStyle(pageWrapper).transform;
          if (transform && transform !== 'none') {
            overlay.style.transform = transform;
          }
        }
      }
    });
  }

  /**
   * Cleanup when navigating away
   */
  destroy() {
    if (this.pageObserver) {
      this.pageObserver.destroy();
    }
    
    this.preloadQueue.clear();
    
    // Remove all overlays
    document.querySelectorAll('.manga-translator-overlay').forEach(el => el.remove());
    
    console.debug('[MangaDexAdapter] Destroyed');
  }

  /**
   * MangaDex-specific: Handle data saver mode toggle
   */
  handleDataSaverMode(enabled) {
    // Re-process images with lower quality if needed
    if (enabled) {
      console.debug('[MangaDexAdapter] Data saver mode enabled');
    }
  }

  /**
   * Get current reading progress
   */
  getReadingProgress() {
    const progressBar = document.querySelector(this.selectors.progressBar);
    if (progressBar) {
      return parseFloat(progressBar.style.width) || 0;
    }
    
    // Calculate from scroll position in long-strip mode
    if (this.readerMode === 'long-strip') {
      const scrollPercent = (window.scrollY / 
        (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      return Math.min(100, Math.max(0, scrollPercent));
    }
    
    return 0;
  }
}

// Export singleton
let instance = null;

export function getMangaDexAdapter() {
  if (!instance) {
    instance = new MangaDexAdapter();
  }
  return instance;
}

export default MangaDexAdapter;