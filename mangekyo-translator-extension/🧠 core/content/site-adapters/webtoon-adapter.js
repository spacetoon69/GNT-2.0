/**
 * Webtoon Adapter
 * 
 * Site-specific handler for webtoons.com and Webtoon apps
 * Handles infinite scroll canvas, lazy loading, and vertical episode structure
 * 
 * Located in: core/content/site-adapters/webtoon-adapter.js
 */

import { BaseMangaAdapter } from './generic-manga-adapter.js';
import { getMutationObserver } from '../mutation-observer.js';
import { CanvasInterceptor } from '../canvas-interceptor.js';
import { ImageCache } from '../../../storage/indexeddb/image-cache.js';

class WebtoonAdapter extends BaseMangaAdapter {
  constructor() {
    super();
    
    this.name = 'Webtoon';
    this.domains = [
      'webtoons.com',
      'www.webtoons.com',
      'm.webtoons.com',
      'webtoon.com'
    ];
    
    // Webtoon URL patterns vary by region (en, es, fr, etc.)
    this.episodeUrlPattern = /\/(?:episode|viewer)\?titleNo=\d+&episodeNo=\d+/;
    
    // Webtoon-specific selectors (highly dynamic, frequently change)
    this.selectors = {
      viewerContainer: '#viewer, .viewer, [class*="viewer"], #content',
      canvasContainer: '#canvas-container, .canvas-container, .viewer-images',
      imageList: '#_imageList, .viewer-images, [class*="image-list"]',
      episodeImages: '#_imageList img, .viewer-images img, .viewer img[data-url]',
      episodeTitle: '.episode-info .title, .viewer-top .title, h1[class*="title"]',
      seriesTitle: '.series-info .title, .viewer-top .series-title',
      nextEpisodeBtn: '.episode-nav .next, .viewer-bottom .next-episode',
      prevEpisodeBtn: '.episode-nav .prev, .viewer-bottom .prev-episode',
      commentSection: '#comment, .comment-section',
      likeButton: '.like-btn, .u_btn_like'
    };

    // Webtoon viewer state
    this.viewerState = {
      episodeId: null,
      seriesId: null,
      totalImages: 0,
      loadedImages: 0,
      isCanvasMode: false,
      scrollProgress: 0,
      imageDimensions: new Map() // Track actual rendered sizes
    };

    this.imageObserver = null;
    this.scrollThrottle = null;
    this.canvasInterceptor = null;
  }

  /**
   * Detect if current page is a Webtoon episode viewer
   */
  detect() {
    const isEpisodePage = this.episodeUrlPattern.test(window.location.search) ||
                         document.querySelector(this.selectors.viewerContainer) ||
                         document.querySelector('#_imageList') !== null;
    
    const hasImages = !!document.querySelector(this.selectors.episodeImages);
    
    return isEpisodePage && hasImages;
  }

  /**
   * Initialize adapter for current episode
   */
  async initialize() {
    if (!this.detect()) {
      throw new Error('Not a valid Webtoon episode page');
    }

    console.debug('[WebtoonAdapter] Initializing...');
    
    // Extract episode metadata
    this.extractEpisodeData();
    
    // Detect rendering mode (Canvas vs DOM images)
    this.detectRenderMode();
    
    // Setup infinite scroll handling
    this.setupInfiniteScroll();
    
    // Initialize appropriate image capture method
    if (this.viewerState.isCanvasMode) {
      await this.initializeCanvasMode();
    } else {
      await this.initializeImageMode();
    }
    
    // Monitor scroll progress for translation triggering
    this.setupScrollMonitoring();
    
    return this;
  }

  /**
   * Extract episode information from URL and DOM
   */
  extractEpisodeData() {
    const urlParams = new URLSearchParams(window.location.search);
    
    this.viewerState.seriesId = urlParams.get('titleNo');
    this.viewerState.episodeId = urlParams.get('episodeNo');
    
    // Extract from DOM if URL params fail (SPA navigation)
    if (!this.viewerState.seriesId) {
      const seriesMatch = window.location.pathname.match(/\/(\d+)\//);
      if (seriesMatch) this.viewerState.seriesId = seriesMatch[1];
    }

    // Get episode metadata
    const episodeTitle = document.querySelector(this.selectors.episodeTitle);
    const seriesTitle = document.querySelector(this.selectors.seriesTitle);
    
    this.episodeInfo = {
      seriesId: this.viewerState.seriesId,
      episodeId: this.viewerState.episodeId,
      seriesTitle: seriesTitle?.textContent?.trim(),
      episodeTitle: episodeTitle?.textContent?.trim(),
      url: window.location.href
    };

    console.debug('[WebtoonAdapter] Episode info:', this.episodeInfo);
  }

  /**
   * Detect if Webtoon is using Canvas or Image DOM rendering
   */
  detectRenderMode() {
    const canvas = document.querySelector('canvas');
    const imageList = document.querySelector(this.selectors.imageList);
    
    // Check for canvas-based viewer (newer implementation)
    this.viewerState.isCanvasMode = !!canvas && !imageList;
    
    // Alternative: Check for WebGL context
    if (canvas) {
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) this.viewerState.isCanvasMode = true;
    }

    console.debug('[WebtoonAdapter] Render mode:', 
      this.viewerState.isCanvasMode ? 'Canvas/WebGL' : 'DOM Images');
    
    return this.viewerState.isCanvasMode;
  }

  /**
   * Initialize Canvas interception mode
   */
  async initializeCanvasMode() {
    console.debug('[WebtoonAdapter] Initializing Canvas interceptor...');
    
    this.canvasInterceptor = new CanvasInterceptor({
      onFrameCapture: (imageData, metadata) => {
        this.handleCanvasFrame(imageData, metadata);
      },
      samplingRate: 1000, // Check every 1 second
      minScrollDelta: 100 // Minimum scroll before re-scan
    });

    await this.canvasInterceptor.initialize();
    
    // Hook into Webtoon's internal image loading
    this.hookImageLoading();
  }

  /**
   * Initialize standard image DOM mode
   */
  async initializeImageMode() {
    console.debug('[WebtoonAdapter] Initializing Image mode...');
    
    // Setup Intersection Observer for lazy-loaded images
    this.setupImageObserver();
    
    // Process existing images
    this.scanForImages();
    
    // Watch for dynamically added images (infinite scroll)
    this.setupDynamicImageLoading();
  }

  /**
   * Setup Intersection Observer for lazy loading detection
   */
  setupImageObserver() {
    this.imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          this.processImageElement(img);
          
          // Unobserve after processing
          this.imageObserver.unobserve(img);
        }
      });
    }, {
      root: null,
      rootMargin: '500px', // Preload 500px before viewport
      threshold: 0.01
    });
  }

  /**
   * Scan and observe all episode images
   */
  scanForImages() {
    const images = document.querySelectorAll(this.selectors.episodeImages);
    
    images.forEach((img, index) => {
      // Skip if already processed
      if (img.dataset.webtoonProcessed) return;
      
      // Mark with index for ordering
      img.dataset.webtoonIndex = index;
      
      // Observe for viewport entry
      this.imageObserver.observe(img);
    });

    this.viewerState.totalImages = images.length;
  }

  /**
   * Setup mutation observer for infinite scroll loading
   */
  setupDynamicImageLoading() {
    const imageList = document.querySelector(this.selectors.imageList);
    if (!imageList) return;

    const mutationObserver = getMutationObserver();
    
    mutationObserver.observeElement(imageList, {
      childList: true,
      subtree: true
    });

    // Listen for new images
    document.addEventListener('manga-translator:scanRequested', (e) => {
      if (e.detail.type === 'images') {
        // Small delay to let images load
        setTimeout(() => this.scanForImages(), 500);
      }
    });
  }

  /**
   * Process individual image element
   */
  async processImageElement(img) {
    if (img.dataset.webtoonProcessed) return;
    img.dataset.webtoonProcessed = 'true';

    // Wait for image to fully load
    if (!img.complete) {
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 5000); // Timeout fallback
      });
    }

    // Get actual rendered dimensions (Webtoon uses data-url lazy loading)
    const src = img.dataset.url || img.src;
    if (!src) return;

    const dimensions = {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: img.clientWidth,
      renderedHeight: img.clientHeight,
      offsetTop: img.offsetTop
    };

    this.viewerState.imageDimensions.set(img, dimensions);
    this.viewerState.loadedImages++;

    const imageData = {
      element: img,
      src: src,
      index: parseInt(img.dataset.webtoonIndex, 10),
      dimensions: dimensions,
      episodeInfo: this.episodeInfo
    };

    // Dispatch for OCR processing
    this.dispatchAdapterEvent('imageDiscovered', imageData);
    
    // Update progress
    this.updateLoadingProgress();
  }

  /**
   * Handle canvas frame capture
   */
  handleCanvasFrame(imageData, metadata) {
    // Canvas frames represent viewport slices in Webtoon's implementation
    const frameData = {
      type: 'canvas',
      imageData: imageData, // ImageBitmap or ImageData
      scrollPosition: metadata.scrollY,
      viewportHeight: metadata.viewportHeight,
      timestamp: metadata.timestamp,
      episodeInfo: this.episodeInfo
    };

    this.dispatchAdapterEvent('canvasFrameCaptured', frameData);
  }

  /**
   * Hook into Webtoon's internal image loading system
   */
  hookImageLoading() {
    // Intercept fetch/XHR for image data URLs
    const originalFetch = window.fetch;
    const adapter = this;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      
      // Clone to avoid consuming the response
      const clone = response.clone();
      
      // Check if this is an image request
      const url = args[0];
      if (typeof url === 'string' && 
          (url.includes('webtoon') || url.match(/\.(jpg|jpeg|png|webp)/i))) {
        
        // Cache the image data for processing
        clone.blob().then(blob => {
          adapter.cacheImageBlob(url, blob);
        }).catch(() => {});
      }
      
      return response;
    };
  }

  /**
   * Cache image blob for processing
   */
  async cacheImageBlob(url, blob) {
    const cacheKey = `webtoon_${this.viewerState.seriesId}_${this.viewerState.episodeId}_${url}`;
    
    try {
      await ImageCache.storeBlob(cacheKey, blob, {
        seriesId: this.viewerState.seriesId,
        episodeId: this.viewerState.episodeId,
        url: url,
        timestamp: Date.now()
      });
    } catch (error) {
      console.debug('[WebtoonAdapter] Failed to cache image:', error);
    }
  }

  /**
   * Setup infinite scroll handling
   */
  setupInfiniteScroll() {
    // Webtoons load content as user scrolls
    let lastScrollY = 0;
    let scrollTimeout;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY;
      
      // Update progress
      this.viewerState.scrollProgress = this.calculateScrollProgress();
      
      // Detect scroll direction and speed
      const scrollSpeed = Math.abs(scrollDelta);
      const isScrollingDown = scrollDelta > 0;
      
      // Trigger events for translation overlay updates
      this.dispatchAdapterEvent('scrollUpdate', {
        progress: this.viewerState.scrollProgress,
        direction: isScrollingDown ? 'down' : 'up',
        speed: scrollSpeed,
        position: currentScrollY
      });

      // Debounce scroll end detection
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.onScrollEnd();
      }, 150);

      lastScrollY = currentScrollY;
    };

    // Throttle scroll events
    this.scrollThrottle = this.throttle(handleScroll, 50);
    window.addEventListener('scroll', this.scrollThrottle, { passive: true });
  }

  /**
   * Calculate reading progress percentage
   */
  calculateScrollProgress() {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return 0;
    
    return (window.scrollY / docHeight) * 100;
  }

  /**
   * Handle scroll end - trigger translation for visible content
   */
  onScrollEnd() {
    const visibleImages = this.getVisibleImages();
    
    visibleImages.forEach(imgData => {
      if (!imgData.processed) {
        this.dispatchAdapterEvent('imageVisible', imgData);
      }
    });

    // Check for next episode preloading
    if (this.viewerState.scrollProgress > 80) {
      this.preloadNextEpisode();
    }
  }

  /**
   * Get currently visible images in viewport
   */
  getVisibleImages() {
    const images = document.querySelectorAll(this.selectors.episodeImages);
    const visible = [];
    const viewportBuffer = window.innerHeight * 0.5; // 50% buffer

    images.forEach(img => {
      if (!img.dataset.webtoonProcessed) return;
      
      const rect = img.getBoundingClientRect();
      const isVisible = (
        rect.top < window.innerHeight + viewportBuffer &&
        rect.bottom > -viewportBuffer
      );

      if (isVisible) {
        const dims = this.viewerState.imageDimensions.get(img);
        visible.push({
          element: img,
          index: parseInt(img.dataset.webtoonIndex, 10),
          dimensions: dims,
          boundingRect: rect
        });
      }
    });

    return visible;
  }

  /**
   * Setup scroll monitoring for translation triggering
   */
  setupScrollMonitoring() {
    // Create scroll-linked translation updates
    const updateInterval = setInterval(() => {
      if (!this.detect()) {
        clearInterval(updateInterval);
        return;
      }

      // Update overlay positions based on scroll
      this.updateOverlayPositions();
    }, 100);
  }

  /**
   * Update translation overlay positions for vertical scroll
   */
  updateOverlayPositions() {
    const overlays = document.querySelectorAll('.manga-translator-overlay');
    
    overlays.forEach(overlay => {
      const associatedImage = overlay.dataset.sourceImage;
      if (!associatedImage) return;

      const img = document.querySelector(`[data-webtoon-index="${associatedImage}"]`);
      if (!img) {
        overlay.style.display = 'none';
        return;
      }

      const rect = img.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;

      if (isVisible) {
        overlay.style.display = 'block';
        overlay.style.position = 'absolute';
        overlay.style.top = `${img.offsetTop}px`;
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = `${rect.height}px`;
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '1000';
      } else {
        overlay.style.display = 'none';
      }
    });
  }

  /**
   * Inject translation overlay for Webtoon layout
   */
  injectOverlay(targetImage, translationData) {
    // Find the image container
    const container = targetImage.closest('li, div, .viewer-img') || 
                     targetImage.parentElement;
    
    if (!container) return null;

    // Ensure container is positioned
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'manga-translator-overlay webtoon-compatible';
    overlay.dataset.sourceImage = targetImage.dataset.webtoonIndex;
    
    // Webtoon-specific styling
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
      overflow: hidden;
    `;

    // Add translation content
    if (translationData.bubbles) {
      translationData.bubbles.forEach(bubble => {
        const bubbleEl = this.createBubbleElement(bubble);
        overlay.appendChild(bubbleEl);
      });
    }

    container.appendChild(overlay);
    
    // Store reference
    this.activeOverlays = this.activeOverlays || new Map();
    this.activeOverlays.set(targetImage.dataset.webtoonIndex, overlay);

    return overlay;
  }

  /**
   * Create speech bubble element
   */
  createBubbleElement(bubbleData) {
    const bubble = document.createElement('div');
    bubble.className = 'translation-bubble';
    
    // Position relative to image coordinates
    bubble.style.cssText = `
      position: absolute;
      left: ${bubbleData.x}%;
      top: ${bubbleData.y}%;
      width: ${bubbleData.width}%;
      height: ${bubbleData.height}%;
      background: rgba(255, 255, 255, 0.95);
      border: 2px solid #000;
      border-radius: 50%;
      padding: 10px;
      font-family: 'Noto Sans', sans-serif;
      font-size: 14px;
      line-height: 1.4;
      color: #000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: auto;
    `;
    
    bubble.textContent = bubbleData.translatedText;
    
    return bubble;
  }

  /**
   * Preload next episode data
   */
  async preloadNextEpisode() {
    const nextBtn = document.querySelector(this.selectors.nextEpisodeBtn);
    if (!nextBtn) return;

    const href = nextBtn.getAttribute('href');
    if (!href || nextBtn.dataset.preloaded) return;

    nextBtn.dataset.preloaded = 'true';
    
    console.debug('[WebtoonAdapter] Preloading next episode:', href);
    
    // Fetch next episode metadata
    try {
      const response = await fetch(href);
      const text = await response.text();
      
      // Extract image URLs for preloading
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const images = doc.querySelectorAll(this.selectors.episodeImages);
      
      // Preload first few images
      images.forEach((img, index) => {
        if (index < 3) {
          const src = img.dataset.url || img.src;
          if (src) {
            const preloadImg = new Image();
            preloadImg.src = src;
          }
        }
      });
    } catch (error) {
      console.debug('[WebtoonAdapter] Failed to preload next episode:', error);
    }
  }

  /**
   * Update loading progress UI
   */
  updateLoadingProgress() {
    const progress = (this.viewerState.loadedImages / this.viewerState.totalImages) * 100;
    
    this.dispatchAdapterEvent('loadingProgress', {
      loaded: this.viewerState.loadedImages,
      total: this.viewerState.totalImages,
      percentage: progress
    });
  }

  /**
   * Handle episode change (SPA navigation)
   */
  onEpisodeChange(newEpisodeData) {
    // Reset state
    this.viewerState.loadedImages = 0;
    this.viewerState.imageDimensions.clear();
    this.activeOverlays?.forEach(overlay => overlay.remove());
    this.activeOverlays?.clear();
    
    // Re-initialize
    this.extractEpisodeData();
    this.scanForImages();
  }

  /**
   * Utility: Throttle function
   */
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Cleanup adapter
   */
  destroy() {
    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }
    
    if (this.scrollThrottle) {
      window.removeEventListener('scroll', this.scrollThrottle);
    }
    
    if (this.canvasInterceptor) {
      this.canvasInterceptor.destroy();
    }
    
    this.activeOverlays?.forEach(overlay => overlay.remove());
    
    console.debug('[WebtoonAdapter] Destroyed');
  }
}

// Export singleton
let instance = null;

export function getWebtoonAdapter() {
  if (!instance) {
    instance = new WebtoonAdapter();
  }
  return instance;
}

export default WebtoonAdapter;