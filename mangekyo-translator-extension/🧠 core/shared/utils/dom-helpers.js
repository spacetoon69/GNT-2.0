/**
 * DOM Helpers Module
 * Specialized utilities for manga page manipulation, element detection, and overlay management
 * @module shared/utils/dom-helpers
 */

import { PERFORMANCE_THRESHOLDS, SELECTORS } from '../constants.js';

/**
 * Configuration for DOM operations
 */
const CONFIG = {
  // Performance limits
  MAX_MUTATION_BATCH: 100,
  DEBOUNCE_DELAY: 150,
  THROTTLE_FPS: 30,
  
  // Manga-specific selectors (fallbacks)
  MANGA_SELECTORS: {
    imageContainers: [
      'img[src*="manga"]',
      'img[src*="chapter"]',
      'img[src*="page"]',
      '.reader-image',
      '.manga-page',
      '[class*="page"] img',
      '[class*="chapter"] img'
    ],
    textElements: [
      'p', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      '[class*="text"]', '[class*="dialog"]', '[class*="speech"]'
    ],
    bubbleIndicators: [
      '[class*="bubble"]', '[class*="speech"]', '[class*="dialog"]',
      '[class*="balloon"]', '[class*="text-box"]'
    ]
  },
  
  // Visual thresholds for manga detection
  DETECTION: {
    minImageWidth: 400,
    minImageHeight: 600,
    aspectRatioThreshold: 0.3, // Width/Height ratio for manga pages
    textContrastThreshold: 4.5
  }
};

/**
 * Debounce function to limit execution rate
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @param {boolean} immediate - Execute immediately on first call
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = CONFIG.DEBOUNCE_DELAY, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(this, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(this, args);
  };
}

/**
 * Throttle function to limit execution to specified FPS
 * @param {Function} func - Function to throttle
 * @param {number} fps - Frames per second limit
 * @returns {Function} Throttled function
 */
export function throttle(func, fps = CONFIG.THROTTLE_FPS) {
  let lastTime = 0;
  const interval = 1000 / fps;
  return function executedFunction(...args) {
    const now = Date.now();
    if (now - lastTime >= interval) {
      lastTime = now;
      func.apply(this, args);
    }
  };
}

/**
 * RequestAnimationFrame wrapper with cleanup
 * @param {Function} callback - Animation callback
 * @returns {Object} Controller with start/stop methods
 */
export function createAnimationLoop(callback) {
  let rafId = null;
  let isRunning = false;
  
  const loop = (timestamp) => {
    if (!isRunning) return;
    callback(timestamp);
    rafId = requestAnimationFrame(loop);
  };
  
  return {
    start() {
      if (!isRunning) {
        isRunning = true;
        rafId = requestAnimationFrame(loop);
      }
      return this;
    },
    stop() {
      isRunning = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      return this;
    },
    get isRunning() {
      return isRunning;
    }
  };
}

/**
 * Create a DOM element with attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes to set
 * @param {Array|string} children - Child elements or text content
 * @returns {HTMLElement} Created element
 */
export function createElement(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  
  // Set attributes (handle special cases)
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'dataset') {
      Object.assign(element.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, value);
    }
  });
  
  // Append children
  const childArray = Array.isArray(children) ? children : [children];
  childArray.forEach(child => {
    if (child instanceof Node) {
      element.appendChild(child);
    } else if (child != null) {
      element.appendChild(document.createTextNode(String(child)));
    }
  });
  
  return element;
}

/**
 * Find all manga image elements on the page
 * Uses multiple detection strategies for robustness
 * @param {HTMLElement} root - Root element to search within
 * @returns {Array<HTMLImageElement>} Array of manga page images
 */
export function findMangaImages(root = document) {
  const images = new Set();
  
  // Strategy 1: Selector-based detection
  CONFIG.MANGA_SELECTORS.imageContainers.forEach(selector => {
    try {
      root.querySelectorAll(selector).forEach(img => {
        if (isValidMangaImage(img)) images.add(img);
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });
  
  // Strategy 2: Dimension-based detection (large portrait images)
  root.querySelectorAll('img').forEach(img => {
    if (isValidMangaImage(img) && isLikelyMangaDimensions(img)) {
      images.add(img);
    }
  });
  
  // Strategy 3: Parent container analysis (reader sites)
  root.querySelectorAll('[class*="reader"], [id*="reader"]').forEach(reader => {
    reader.querySelectorAll('img').forEach(img => {
      if (img.naturalWidth > CONFIG.DETECTION.minImageWidth) {
        images.add(img);
      }
    });
  });
  
  return Array.from(images);
}

/**
 * Validate if an image element is suitable for manga processing
 * @param {HTMLImageElement} img - Image to validate
 * @returns {boolean} True if valid manga image
 */
export function isValidMangaImage(img) {
  if (!img || img.tagName !== 'IMG') return false;
  
  // Check if loaded and visible
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  
  // Check minimum dimensions
  if (img.naturalWidth < CONFIG.DETECTION.minImageWidth || 
      img.naturalHeight < CONFIG.DETECTION.minImageHeight) {
    return false;
  }
  
  // Check if likely manga aspect ratio (tall images)
  const ratio = img.naturalWidth / img.naturalHeight;
  if (ratio > 1.5) return false; // Too wide (likely banner/header)
  
  // Exclude common non-manga images
  const src = (img.src || img.dataset.src || '').toLowerCase();
  const excludePatterns = ['logo', 'icon', 'avatar', 'banner', 'ad', 'thumb'];
  if (excludePatterns.some(p => src.includes(p))) return false;
  
  return true;
}

/**
 * Check if image dimensions match typical manga page proportions
 * @param {HTMLImageElement} img - Image element
 * @returns {boolean} True if dimensions suggest manga page
 */
export function isLikelyMangaDimensions(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  
  if (!w || !h) return false;
  
  const ratio = w / h;
  // Manga pages typically 0.6-0.8 width/height ratio (portrait)
  return ratio > CONFIG.DETECTION.aspectRatioThreshold && ratio < 1.2;
}

/**
 * Get absolute coordinates of an element relative to document
 * Accounts for scroll position and transformations
 * @param {HTMLElement} element - Target element
 * @returns {DOMRect} Absolute bounding rect
 */
export function getAbsoluteRect(element) {
  const rect = element.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;
  
  return {
    top: rect.top + scrollY,
    left: rect.left + scrollX,
    bottom: rect.bottom + scrollY,
    right: rect.right + scrollX,
    width: rect.width,
    height: rect.height,
    x: rect.x + scrollX,
    y: rect.y + scrollY
  };
}

/**
 * Check if element is in viewport (with optional margin)
 * @param {HTMLElement} element - Element to check
 * @param {number} margin - Margin around viewport in pixels
 * @returns {boolean} True if element is visible
 */
export function isInViewport(element, margin = 0) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= -margin &&
    rect.left >= -margin &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + margin &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth) + margin
  );
}

/**
 * Find text elements within a specific region (for bubble detection)
 * @param {DOMRect} region - Bounding box to search within
 * @param {HTMLElement} root - Root element (usually image container)
 * @returns {Array<HTMLElement>} Text elements in region
 */
export function findTextInRegion(region, root = document.body) {
  const textElements = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        if (node.children.length === 0 && node.textContent.trim()) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  
  let node;
  while (node = walker.nextNode()) {
    const rect = getAbsoluteRect(node);
    if (rectsIntersect(region, rect)) {
      textElements.push(node);
    }
  }
  
  return textElements;
}

/**
 * Check if two rectangles intersect
 * @param {DOMRect} r1 - First rectangle
 * @param {DOMRect} r2 - Second rectangle
 * @returns {boolean} True if rectangles intersect
 */
export function rectsIntersect(r1, r2) {
  return !(r2.left > r1.right || 
           r2.right < r1.left || 
           r2.top > r1.bottom || 
           r2.bottom < r1.top);
}

/**
 * Calculate intersection area of two rectangles
 * @param {DOMRect} r1 - First rectangle
 * @param {DOMRect} r2 - Second rectangle
 * @returns {number} Intersection area in square pixels
 */
export function getIntersectionArea(r1, r2) {
  const left = Math.max(r1.left, r2.left);
  const right = Math.min(r1.right, r2.right);
  const top = Math.max(r1.top, r2.top);
  const bottom = Math.min(r1.bottom, r2.bottom);
  
  if (left >= right || top >= bottom) return 0;
  return (right - left) * (bottom - top);
}

/**
 * Inject a shadow DOM container for isolated styling
 * @param {HTMLElement} parent - Parent element
 * @param {string} id - Unique identifier
 * @param {string} css - CSS styles to inject
 * @returns {ShadowRoot} Created shadow root
 */
export function createShadowContainer(parent, id, css = '') {
  const container = createElement('div', {
    id: `mangekyo-${id}`,
    style: {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2147483646' // Max - 1
    }
  });
  
  const shadow = container.attachShadow({ mode: 'open' });
  
  if (css) {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }
  
  parent.style.position = parent.style.position || 'relative';
  parent.appendChild(container);
  
  return shadow;
}

/**
 * Safely remove an element with cleanup
 * @param {HTMLElement} element - Element to remove
 * @param {Function} cleanup - Optional cleanup callback
 */
export function safeRemove(element, cleanup = null) {
  if (!element || !element.parentNode) return;
  
  if (cleanup && typeof cleanup === 'function') {
    try {
      cleanup(element);
    } catch (e) {
      console.warn('Cleanup error:', e);
    }
  }
  
  // Remove event listeners by cloning
  const clone = element.cloneNode(false);
  while (element.firstChild) {
    clone.appendChild(element.firstChild);
  }
  
  element.parentNode.replaceChild(clone, element);
  clone.remove();
}

/**
 * Wait for element to appear in DOM (mutation observer based)
 * @param {string} selector - CSS selector
 * @param {HTMLElement} root - Root element to observe
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<HTMLElement>} Found element
 */
export function waitForElement(selector, root = document.body, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = root.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver((mutations, obs) => {
      const el = root.querySelector(selector);
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    
    observer.observe(root, {
      childList: true,
      subtree: true
    });
    
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for element: ${selector}`));
    }, timeout);
  });
}

/**
 * Batch process DOM mutations for performance
 * @param {Function} processor - Function to process batched mutations
 * @returns {MutationObserver} Configured observer
 */
export function createBatchedMutationObserver(processor) {
  let batch = [];
  let rafId = null;
  
  const processBatch = () => {
    rafId = null;
    if (batch.length === 0) return;
    
    // Limit batch size
    const toProcess = batch.slice(0, CONFIG.MAX_MUTATION_BATCH);
    batch = batch.slice(CONFIG.MAX_MUTATION_BATCH);
    
    processor(toProcess);
    
    // Process remaining in next frame if needed
    if (batch.length > 0) {
      rafId = requestAnimationFrame(processBatch);
    }
  };
  
  return new MutationObserver((mutations) => {
    batch.push(...mutations);
    if (!rafId) {
      rafId = requestAnimationFrame(processBatch);
    }
  });
}

/**
 * Get computed text color contrast ratio against background
 * @param {HTMLElement} element - Element to check
 * @returns {number} Contrast ratio (1-21)
 */
export function getContrastRatio(element) {
  const style = window.getComputedStyle(element);
  const color = parseColor(style.color);
  const bgColor = parseColor(style.backgroundColor) || { r: 255, g: 255, b: 255 };
  
  if (!color) return 0;
  
  const lum1 = getLuminance(color);
  const lum2 = getLuminance(bgColor);
  
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Parse CSS color to RGB object
 * @param {string} color - CSS color string
 * @returns {Object|null} RGB object or null
 */
function parseColor(color) {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
    return null;
  }
  
  const div = document.createElement('div');
  div.style.color = color;
  document.body.appendChild(div);
  const computed = window.getComputedStyle(div).color;
  document.body.removeChild(div);
  
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3])
  };
}

/**
 * Calculate relative luminance of a color
 * @param {Object} color - RGB object
 * @returns {number} Luminance value
 */
function getLuminance(color) {
  const a = [color.r, color.g, color.b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Clone an element for OCR processing (preserves visual styling)
 * @param {HTMLElement} element - Element to clone
 * @returns {HTMLElement} Cloned element with computed styles inlined
 */
export function cloneForOCR(element) {
  const clone = element.cloneNode(true);
  const computed = window.getComputedStyle(element);
  
  // Inline critical styles for canvas rendering
  const criticalStyles = [
    'font-family', 'font-size', 'font-weight', 'font-style',
    'color', 'background-color', 'line-height', 'letter-spacing',
    'text-align', 'writing-mode', 'text-orientation'
  ];
  
  let styleText = '';
  criticalStyles.forEach(prop => {
    styleText += `${prop}: ${computed.getPropertyValue(prop)}; `;
  });
  
  clone.style.cssText = styleText;
  
  // Recursively apply to children
  const originalChildren = element.querySelectorAll('*');
  const clonedChildren = clone.querySelectorAll('*');
  originalChildren.forEach((orig, i) => {
    if (clonedChildren[i]) {
      const comp = window.getComputedStyle(orig);
      let st = '';
      criticalStyles.forEach(prop => {
        st += `${prop}: ${comp.getPropertyValue(prop)}; `;
      });
      clonedChildren[i].style.cssText = st;
    }
  });
  
  return clone;
}

/**
 * Prevent event propagation for overlay interactions
 * @param {HTMLElement} element - Element to isolate
 * @param {Array<string>} events - Event types to stop (default: all mouse/touch)
 */
export function isolateElement(element, events = ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
  events.forEach(event => {
    element.addEventListener(event, (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
  });
}

/**
 * Smart scroll handler that pauses processing during scroll
 * @param {Function} onScrollStart - Callback when scroll begins
 * @param {Function} onScrollEnd - Callback when scroll settles
 * @param {number} delay - Delay to consider scroll ended
 */
export function createSmartScrollHandler(onScrollStart, onScrollEnd, delay = 150) {
  let scrollTimeout;
  let isScrolling = false;
  
  const handleScroll = () => {
    if (!isScrolling) {
      isScrolling = true;
      onScrollStart?.();
    }
    
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      onScrollEnd?.();
    }, delay);
  };
  
  window.addEventListener('scroll', handleScroll, { passive: true });
  
  return {
    isScrolling: () => isScrolling,
    destroy: () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    }
  };
}

/**
 * Detect if page uses infinite scroll / lazy loading
 * @returns {boolean} True if infinite scroll detected
 */
export function detectInfiniteScroll() {
  // Check for common infinite scroll indicators
  const indicators = [
    () => document.querySelector('[class*="infinite"], [class*="lazy"], [class*="load-more"]'),
    () => window.scrollHeight > document.documentElement.clientHeight * 2,
    () => document.querySelectorAll('img[data-src], img[data-original]').length > 5,
    () => document.querySelector('meta[name="generator"][content*="WordPress"]') && 
          document.querySelector('.infinite-scroll')
  ];
  
  return indicators.some(check => check());
}

/**
 * Get element path for debugging/identification
 * @param {HTMLElement} element - Target element
 * @returns {string} CSS path selector
 */
export function getElementPath(element) {
  const path = [];
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let selector = element.nodeName.toLowerCase();
    if (element.id) {
      selector += `#${element.id}`;
      path.unshift(selector);
      break;
    } else {
      let sibling = element;
      let nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.nodeName.toLowerCase() === selector) nth++;
      }
      if (nth !== 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    element = element.parentNode;
  }
  return path.join(' > ');
}

/**
 * Memory-efficient element cache with LRU eviction
 * @param {number} maxSize - Maximum cache size
 */
export class ElementCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  get(key) {
    const value = this.cache.get(key);
    if (value) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  clear() {
    this.cache.clear();
  }
  
  has(key) {
    return this.cache.has(key);
  }
}

// Export default object for convenience
export default {
  debounce,
  throttle,
  createAnimationLoop,
  createElement,
  findMangaImages,
  isValidMangaImage,
  isLikelyMangaDimensions,
  getAbsoluteRect,
  isInViewport,
  findTextInRegion,
  rectsIntersect,
  getIntersectionArea,
  createShadowContainer,
  safeRemove,
  waitForElement,
  createBatchedMutationObserver,
  getContrastRatio,
  cloneForOCR,
  isolateElement,
  createSmartScrollHandler,
  detectInfiniteScroll,
  getElementPath,
  ElementCache
};