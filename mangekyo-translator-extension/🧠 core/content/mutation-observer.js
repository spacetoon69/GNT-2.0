/**
 * Mutation Observer Module
 * 
 * Watches for DOM changes to detect new manga pages, panels, or dynamically
 * loaded content. Essential for single-page applications and infinite scroll readers.
 * 
 * Located in: core/content/mutation-observer.js
 */

import { PERFORMANCE_CONFIG } from '../shared/constants.js';
import { debounce, throttle } from '../shared/utils/performance-monitor.js';

class MangaMutationObserver {
  constructor() {
    this.observer = null;
    this.isObserving = false;
    this.callbackQueue = new Map();
    this.observedElements = new WeakSet();
    
    // Configuration
    this.config = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src', 'style', 'class'],
      characterData: false
    };
    
    // Debounced handlers to prevent performance degradation
    this.debouncedProcess = debounce(
      this.processMutations.bind(this), 
      PERFORMANCE_CONFIG.mutationDebounceMs || 150
    );
    
    this.throttledScan = throttle(
      this.triggerContentScan.bind(this),
      PERFORMANCE_CONFIG.scanThrottleMs || 500
    );
  }

  /**
   * Initialize observer on target container
   * @param {HTMLElement} target - Root element to observe (usually document.body or reader container)
   */
  initialize(target = document.body) {
    if (this.isObserving) {
      console.warn('[MangaTranslator] Observer already active');
      return this;
    }

    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.observer.observe(target, this.config);
    this.isObserving = true;
    
    console.debug('[MangaTranslator] Mutation observer initialized');
    return this;
  }

  /**
   * Process mutation batch
   */
  handleMutations(mutations) {
    const significantChanges = this.categorizeMutations(mutations);
    
    if (significantChanges.hasNewImages) {
      this.throttledScan('images');
    }
    
    if (significantChanges.hasNewText) {
      this.debouncedProcess(significantChanges.textMutations);
    }
    
    if (significantChanges.layoutChanged) {
      this.handleLayoutChange(significantChanges.layoutMutations);
    }
  }

  /**
   * Categorize mutations by type for targeted processing
   */
  categorizeMutations(mutations) {
    const result = {
      hasNewImages: false,
      hasNewText: false,
      layoutChanged: false,
      textMutations: [],
      layoutMutations: [],
      imageNodes: []
    };

    for (const mutation of mutations) {
      // Check for added nodes
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Detect image additions (manga pages)
            if (this.isMangaImage(node) || node.querySelector('img')) {
              result.hasNewImages = true;
              result.imageNodes.push(node);
            }
            
            // Detect text containers (speech bubbles, dialogue)
            if (this.isTextContainer(node)) {
              result.hasNewText = true;
              result.textMutations.push(mutation);
            }
            
            // Detect layout containers (panel changes)
            if (this.isLayoutElement(node)) {
              result.layoutChanged = true;
              result.layoutMutations.push(mutation);
            }
          }
        }
      }
      
      // Check for attribute changes (lazy loading, visibility changes)
      if (mutation.type === 'attributes') {
        if (mutation.attributeName === 'src' || mutation.attributeName === 'data-src') {
          result.hasNewImages = true;
        }
        if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
          result.layoutChanged = true;
        }
      }
    }

    return result;
  }

  /**
   * Determine if element is a manga page image
   */
  isMangaImage(element) {
    if (element.tagName !== 'IMG') return false;
    
    const indicators = [
      element.classList.contains('page-image'),
      element.classList.contains('reader-image'),
      element.closest('.manga-page, .reader-container, .chapter-page'),
      element.src?.match(/\.(jpg|jpeg|png|webp|gif)$/i),
      element.dataset.src?.match(/\.(jpg|jpeg|png|webp|gif)$/i),
      element.alt?.toLowerCase().includes('page'),
      element.width > 400 && element.height > 600 // Typical manga dimensions
    ];
    
    return indicators.some(Boolean);
  }

  /**
   * Identify text containers (speech bubbles, narration boxes)
   */
  isTextContainer(element) {
    const textSelectors = [
      '.bubble', '.speech-bubble', '.dialogue',
      '[class*="text"]', '[class*="dialog"]',
      '.ts-bubble', // MangaDex specific
      '.viewer-paragraph' // Webtoon specific
    ];
    
    return textSelectors.some(selector => 
      element.matches?.(selector) || element.querySelector?.(selector)
    );
  }

  /**
   * Detect layout structure changes
   */
  isLayoutElement(element) {
    const layoutSelectors = [
      '.reader-container', '.manga-reader',
      '.chapter-container', '.page-container',
      '.viewer', '#reader'
    ];
    
    return layoutSelectors.some(selector => 
      element.matches?.(selector) || element.querySelector?.(selector)
    );
  }

  /**
   * Process text mutations with batching
   */
  processMutations(mutations) {
    const textElements = new Set();
    
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          this.extractTextElements(node, textElements);
        }
      });
    });

    if (textElements.size > 0) {
      this.dispatchContentEvent('textDetected', Array.from(textElements));
    }
  }

  /**
   * Recursively extract text elements from node
   */
  extractTextElements(node, collection) {
    if (this.isTextContainer(node)) {
      collection.add(node);
    }
    
    if (node.children) {
      Array.from(node.children).forEach(child => 
        this.extractTextElements(child, collection)
      );
    }
  }

  /**
   * Handle significant layout changes (page turns, chapter loads)
   */
  handleLayoutChange(mutations) {
    // Clear cached translations when layout changes significantly
    this.dispatchContentEvent('layoutChanged', {
      timestamp: Date.now(),
      mutationCount: mutations.length
    });
    
    // Re-scan entire page for new content
    setTimeout(() => this.triggerContentScan('full'), 100);
  }

  /**
   * Trigger content scan via event system
   */
  triggerContentScan(scanType) {
    this.dispatchContentEvent('scanRequested', {
      type: scanType,
      url: window.location.href,
      timestamp: Date.now()
    });
  }

  /**
   * Dispatch custom events for other modules
   */
  dispatchContentEvent(eventType, detail) {
    const event = new CustomEvent(`manga-translator:${eventType}`, {
      detail,
      bubbles: true,
      cancelable: true
    });
    
    document.dispatchEvent(event);
  }

  /**
   * Pause observation (during heavy processing)
   */
  pause() {
    if (this.observer) {
      this.observer.disconnect();
      this.isObserving = false;
      console.debug('[MangaTranslator] Observer paused');
    }
  }

  /**
   * Resume observation
   */
  resume() {
    if (!this.isObserving) {
      this.initialize();
    }
  }

  /**
   * Clean disconnect and cleanup
   */
  destroy() {
    this.pause();
    this.callbackQueue.clear();
    this.observer = null;
    console.debug('[MangaTranslator] Observer destroyed');
  }

  /**
   * Observe specific element (for single-page reader containers)
   */
  observeElement(element, customConfig = {}) {
    if (this.observedElements.has(element)) return;
    
    const specificObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });
    
    specificObserver.observe(element, { ...this.config, ...customConfig });
    this.observedElements.add(element);
    
    return specificObserver;
  }
}

// Singleton instance
let instance = null;

export function getMutationObserver() {
  if (!instance) {
    instance = new MangaMutationObserver();
  }
  return instance;
}

export function initMutationObserver(target) {
  return getMutationObserver().initialize(target);
}

export default MangaMutationObserver;