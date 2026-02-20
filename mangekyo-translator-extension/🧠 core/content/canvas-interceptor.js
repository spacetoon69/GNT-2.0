/**
 * Canvas Interceptor - Advanced Content Capture Module
 * Intercepts and captures content from Canvas/WebGL-based manga readers
 * Handles WebGL contexts, 2D contexts, and OffscreenCanvas
 */

import { CONFIG } from '../shared/constants.js';
import { ImageUtils } from '../shared/utils/image-utils.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class CanvasInterceptor {
  constructor(config = {}) {
    this.config = {
      // Detection settings
      monitorNewCanvas: true,
      captureOnDraw: false, // Capture every frame vs on-demand
      maxCanvasSize: 4096, // Prevent memory issues with huge canvases
      minCanvasSize: 100,  // Ignore tiny canvases (icons, etc.)
      
      // WebGL settings
      preserveWebGLContext: true,
      captureWebGL: true,
      
      // Performance
      throttleFPS: 30, // Limit capture rate
      useRequestAnimationFrame: true,
      
      // Filtering
      ignoreTransparent: true,
      minContentRatio: 0.1, // Min non-transparent pixels
      
      ...config
    };

    this.performanceMonitor = new PerformanceMonitor('canvas-interceptor');
    
    // State
    this.isActive = false;
    this.monitoredCanvases = new WeakMap(); // Canvas -> metadata
    this.canvasRegistry = new Map(); // ID -> canvas info
    this.canvasCounter = 0;
    this.captureQueue = [];
    this.isProcessingQueue = false;
    
    // Original methods storage
    this.originalMethods = {
      getContext: HTMLCanvasElement.prototype.getContext,
      toDataURL: HTMLCanvasElement.prototype.toDataURL,
      toBlob: HTMLCanvasElement.prototype.toBlob,
      transferControlToOffscreen: HTMLCanvasElement.prototype.transferControlToOffscreen
    };
    
    // WebGL specific
    this.webGLMethods = [
      'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
      'clear', 'clearColor', 'drawBuffersWEBGL'
    ];
    
    // 2D context methods that indicate content changes
    this.d2Methods = [
      'drawImage', 'putImageData', 'fillRect', 'strokeRect', 'fillText', 'strokeText',
      'clearRect', 'drawFocusIfNeeded'
    ];
  }

  /**
   * Initialize interceptor
   */
  activate() {
    if (this.isActive) return;
    this.isActive = true;
    
    console.log('[CanvasInterceptor] Activating...');
    
    // Patch Canvas prototype
    this.patchCanvasPrototype();
    
    // Patch WebGL rendering context
    this.patchWebGLContexts();
    
    // Patch 2D rendering context
    this.patch2DContexts();
    
    // Monitor existing canvases
    this.scanExistingCanvases();
    
    // Setup mutation observer for new canvases
    if (this.config.monitorNewCanvas) {
      this.setupCanvasObserver();
    }
    
    // Start capture loop if needed
    if (this.config.captureOnDraw) {
      this.startCaptureLoop();
    }
    
    console.log(`[CanvasInterceptor] Monitoring ${this.canvasRegistry.size} canvases`);
  }

  /**
   * Deactivate interceptor
   */
  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    
    console.log('[CanvasInterceptor] Deactivating...');
    
    // Restore original methods
    HTMLCanvasElement.prototype.getContext = this.originalMethods.getContext;
    HTMLCanvasElement.prototype.toDataURL = this.originalMethods.toDataURL;
    HTMLCanvasElement.prototype.toBlob = this.originalMethods.toBlob;
    HTMLCanvasElement.prototype.transferControlToOffscreen = this.originalMethods.transferControlToOffscreen;
    
    // Stop observers
    this.canvasObserver?.disconnect();
    cancelAnimationFrame(this.captureLoopId);
    
    // Clear registry
    this.canvasRegistry.clear();
  }

  /**
   * Patch Canvas prototype to intercept getContext
   */
  patchCanvasPrototype() {
    const self = this;
    
    // Intercept getContext to track canvas usage
    HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
      const context = self.originalMethods.getContext.call(this, contextType, contextAttributes);
      
      if (!context) return context;
      
      // Register canvas
      self.registerCanvas(this, contextType);
      
      // Patch context methods based on type
      if (contextType.includes('webgl')) {
        self.patchWebGLContext(context, this);
      } else if (contextType === '2d') {
        self.patch2DContext(context, this);
      }
      
      return context;
    };
    
    // Intercept toDataURL
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      self.handleCanvasAccess(this, 'toDataURL');
      return self.originalMethods.toDataURL.apply(this, args);
    };
    
    // Intercept toBlob
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      self.handleCanvasAccess(this, 'toBlob');
      return self.originalMethods.toBlob.call(this, callback, ...args);
    };
    
    // Intercept OffscreenCanvas transfer
    HTMLCanvasElement.prototype.transferControlToOffscreen = function() {
      const offscreen = self.originalMethods.transferControlToOffscreen.call(this);
      self.registerCanvas(this, 'offscreen');
      return offscreen;
    };
  }

  /**
   * Register a canvas for monitoring
   */
  registerCanvas(canvas, contextType) {
    if (this.monitoredCanvases.has(canvas)) return;
    
    const id = `canvas_${++this.canvasCounter}_${Date.now()}`;
    const info = {
      id,
      element: canvas,
      contextType,
      registeredAt: Date.now(),
      captureCount: 0,
      lastCapture: null,
      isMangaCandidate: false,
      dimensions: { width: canvas.width, height: canvas.height }
    };
    
    this.monitoredCanvases.set(canvas, info);
    this.canvasRegistry.set(id, info);
    
    // Initial assessment
    this.assessCanvas(canvas, info);
    
    return id;
  }

  /**
   * Assess if canvas is a manga/comic candidate
   */
  assessCanvas(canvas, info) {
    const width = canvas.width;
    const height = canvas.height;
    
    // Size checks
    if (width < this.config.minCanvasSize || height < this.config.minCanvasSize) {
      info.isMangaCandidate = false;
      return;
    }
    
    if (width > this.config.maxCanvasSize || height > this.config.maxCanvasSize) {
      info.isMangaCandidate = false;
      return;
    }
    
    // Aspect ratio check (manga usually portrait)
    const ratio = height / width;
    if (ratio < 0.3 || ratio > 3) {
      info.isMangaCandidate = false;
      return;
    }
    
    // Check if in viewport or likely content area
    const rect = canvas.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
    const isReasonableSize = rect.width > 200 && rect.height > 300;
    
    info.isMangaCandidate = isVisible && isReasonableSize;
    info.dimensions = { width, height, clientWidth: rect.width, clientHeight: rect.height };
    
    if (info.isMangaCandidate) {
      console.log(`[CanvasInterceptor] Manga candidate detected: ${info.id} (${width}x${height})`);
    }
  }

  /**
   * Patch WebGL rendering context methods
   */
  patchWebGLContexts() {
    // Patch prototype methods that are common to WebGL/WebGL2
    const webGLProtos = [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype];
    
    webGLProtos.forEach(proto => {
      if (!proto) return;
      
      this.webGLMethods.forEach(methodName => {
        if (!proto[methodName]) return;
        
        const original = proto[methodName];
        const self = this;
        
        proto[methodName] = function(...args) {
          // Get canvas from context
          const canvas = this.canvas;
          if (canvas) {
            self.handleCanvasDraw(canvas, 'webgl', methodName);
          }
          
          return original.apply(this, args);
        };
      });
    });
  }

  /**
   * Patch specific WebGL context instance
   */
  patchWebGLContext(gl, canvas) {
    // Additional instance-specific patching if needed
    // Most patching done at prototype level above
    
    // Store reference for preserveDrawingBuffer
    if (this.config.preserveWebGLContext) {
      const params = gl.getContextAttributes();
      if (!params.preserveDrawingBuffer) {
        // Note: Can't change after creation, but we can warn
        console.warn('[CanvasInterceptor] WebGL context without preserveDrawingBuffer detected');
      }
    }
  }

  /**
   * Patch 2D rendering context methods
   */
  patch2DContexts() {
    const proto = CanvasRenderingContext2D.prototype;
    const self = this;
    
    this.d2Methods.forEach(methodName => {
      if (!proto[methodName]) return;
      
      const original = proto[methodName];
      
      proto[methodName] = function(...args) {
        const canvas = this.canvas;
        if (canvas) {
          self.handleCanvasDraw(canvas, '2d', methodName);
        }
        
        return original.apply(this, args);
      };
    });
  }

  /**
   * Patch specific 2D context instance
   */
  patch2DContext(ctx, canvas) {
    // Additional instance-specific patching
    // Track image smoothing settings for quality
    const info = this.monitoredCanvases.get(canvas);
    if (info) {
      info.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
    }
  }

  /**
   * Handle canvas draw operation
   */
  handleCanvasDraw(canvas, contextType, methodName) {
    const info = this.monitoredCanvases.get(canvas);
    if (!info || !info.isMangaCandidate) return;
    
    // Throttle captures
    const now = Date.now();
    if (info.lastCapture && (now - info.lastCapture) < (1000 / this.config.throttleFPS)) {
      return;
    }
    
    // Queue for capture
    if (!this.config.captureOnDraw) {
      this.captureQueue.push({ canvas, info, priority: 'normal' });
      this.processCaptureQueue();
    }
  }

  /**
   * Handle canvas access (toDataURL, toBlob)
   */
  handleCanvasAccess(canvas, methodName) {
    const info = this.monitoredCanvases.get(canvas);
    if (!info) return;
    
    // Mark as recently accessed
    info.lastAccessed = Date.now();
    
    // If it's a manga candidate, trigger immediate capture
    if (info.isMangaCandidate) {
      this.captureQueue.push({ canvas, info, priority: 'high' });
      this.processCaptureQueue();
    }
  }

  /**
   * Process capture queue with throttling
   */
  async processCaptureQueue() {
    if (this.isProcessingQueue || this.captureQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    // Sort by priority
    this.captureQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    // Process batch
    const batch = this.captureQueue.splice(0, 5);
    
    for (const item of batch) {
      try {
        await this.captureCanvas(item.canvas, item.info);
      } catch (error) {
        console.error('[CanvasInterceptor] Capture failed:', error);
      }
    }
    
    this.isProcessingQueue = false;
    
    // Continue if more in queue
    if (this.captureQueue.length > 0) {
      setTimeout(() => this.processCaptureQueue(), 100);
    }
  }

  /**
   * Capture canvas content
   */
  async captureCanvas(canvas, info) {
    const perfMark = this.performanceMonitor.start('captureCanvas');
    
    try {
      let imageData;
      
      // Try different capture methods based on context type
      if (info.contextType?.includes('webgl')) {
        imageData = await this.captureWebGL(canvas);
      } else {
        imageData = await this.capture2D(canvas);
      }
      
      if (!imageData) {
        throw new Error('Failed to capture canvas content');
      }
      
      // Validate content
      if (!this.hasValidContent(imageData)) {
        return null;
      }
      
      // Update info
      info.lastCapture = Date.now();
      info.captureCount++;
      
      // Emit capture event
      this.emitCapture(canvas, info, imageData);
      
      this.performanceMonitor.end(perfMark);
      return imageData;
      
    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[CanvasInterceptor] Capture error:', error);
      return null;
    }
  }

  /**
   * Capture WebGL canvas
   */
  async captureWebGL(canvas) {
    // Method 1: Try toDataURL (requires preserveDrawingBuffer)
    try {
      const dataUrl = canvas.toDataURL('image/png');
      return await ImageUtils.dataUrlToImageData(dataUrl);
    } catch (e) {
      // preserveDrawingBuffer likely false
    }
    
    // Method 2: Read pixels directly (slower but always works)
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Create framebuffer to read current render buffer
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    
    // Flip Y (WebGL has origin at bottom-left)
    const flipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((height - 1 - y) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        flipped[dstIdx] = pixels[srcIdx];
        flipped[dstIdx + 1] = pixels[srcIdx + 1];
        flipped[dstIdx + 2] = pixels[srcIdx + 2];
        flipped[dstIdx + 3] = pixels[srcIdx + 3];
      }
    }
    
    return new ImageData(new Uint8ClampedArray(flipped), width, height);
  }

  /**
   * Capture 2D canvas
   */
  async capture2D(canvas) {
    // Method 1: toDataURL (fastest)
    try {
      const dataUrl = canvas.toDataURL('image/png');
      return await ImageUtils.dataUrlToImageData(dataUrl);
    } catch (e) {
      // Fallback
    }
    
    // Method 2: getContext and getImageData
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    try {
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      // Canvas may be tainted (cross-origin)
      console.warn('[CanvasInterceptor] Cannot capture 2D canvas - may be tainted');
      return null;
    }
  }

  /**
   * Check if captured image has valid content
   */
  hasValidContent(imageData) {
    if (!imageData || !imageData.data) return false;
    
    const { data, width, height } = imageData;
    const totalPixels = width * height;
    
    // Check for mostly transparent
    if (this.config.ignoreTransparent) {
      let transparentPixels = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 10) transparentPixels++;
      }
      
      const transparencyRatio = transparentPixels / totalPixels;
      if (transparencyRatio > (1 - this.config.minContentRatio)) {
        return false;
      }
    }
    
    // Check for solid color (blank canvas)
    let uniqueColors = new Set();
    const sampleStep = Math.max(1, Math.floor(totalPixels / 1000)); // Sample 1000 pixels
    
    for (let i = 0; i < data.length; i += 4 * sampleStep) {
      const colorKey = `${data[i]},${data[i+1]},${data[i+2]}`;
      uniqueColors.add(colorKey);
      if (uniqueColors.size > 10) break; // Has variation
    }
    
    if (uniqueColors.size < 3) {
      return false; // Too uniform, likely blank
    }
    
    return true;
  }

  /**
   * Emit capture event to scanner
   */
  emitCapture(canvas, info, imageData) {
    // Create custom event
    const event = new CustomEvent('manga-canvas-captured', {
      detail: {
        canvasId: info.id,
        canvas: canvas,
        imageData: imageData,
        metadata: {
          width: imageData.width,
          height: imageData.height,
          contextType: info.contextType,
          captureCount: info.captureCount,
          timestamp: Date.now()
        }
      },
      bubbles: true
    });
    
    canvas.dispatchEvent(event);
    
    // Also notify via chrome runtime if needed
    chrome.runtime.sendMessage({
      type: 'CANVAS_CAPTURED',
      payload: {
        canvasId: info.id,
        metadata: {
          width: imageData.width,
          height: imageData.height,
          url: window.location.href
        }
      }
    });
  }

  /**
   * Scan for existing canvases on page
   */
  scanExistingCanvases() {
    const canvases = document.querySelectorAll('canvas');
    console.log(`[CanvasInterceptor] Found ${canvases.length} existing canvases`);
    
    canvases.forEach(canvas => {
      // Try to determine context type
      let contextType = 'unknown';
      
      // Check for webgl
      if (canvas.getContext('webgl2') || canvas.getContext('webgl')) {
        contextType = 'webgl';
      } else if (canvas.getContext('2d')) {
        contextType = '2d';
      }
      
      this.registerCanvas(canvas, contextType);
    });
  }

  /**
   * Setup mutation observer for new canvases
   */
  setupCanvasObserver() {
    this.canvasObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          
          // Check if node is canvas
          if (node.tagName === 'CANVAS') {
            this.registerCanvas(node, 'unknown');
          }
          
          // Check for canvases within added node
          if (node.querySelectorAll) {
            const canvases = node.querySelectorAll('canvas');
            canvases.forEach(canvas => this.registerCanvas(canvas, 'unknown'));
          }
        }
      }
    });
    
    this.canvasObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Start continuous capture loop
   */
  startCaptureLoop() {
    const loop = () => {
      if (!this.isActive) return;
      
      // Capture all manga candidate canvases
      this.canvasRegistry.forEach((info, id) => {
        if (info.isMangaCandidate) {
          this.captureQueue.push({ 
            canvas: info.element, 
            info, 
            priority: 'low' 
          });
        }
      });
      
      this.processCaptureQueue();
      
      this.captureLoopId = requestAnimationFrame(loop);
    };
    
    if (this.config.useRequestAnimationFrame) {
      this.captureLoopId = requestAnimationFrame(loop);
    } else {
      // Use setInterval as fallback
      this.captureInterval = setInterval(() => {
        if (!this.isActive) return;
        this.canvasRegistry.forEach((info) => {
          if (info.isMangaCandidate) {
            this.captureCanvas(info.element, info);
          }
        });
      }, 1000 / this.config.throttleFPS);
    }
  }

  /**
   * Force capture specific canvas
   */
  async forceCapture(canvas) {
    const info = this.monitoredCanvases.get(canvas);
    if (!info) {
      // Register on-the-fly
      const id = this.registerCanvas(canvas, 'unknown');
      return this.captureCanvas(canvas, this.canvasRegistry.get(id));
    }
    
    return this.captureCanvas(canvas, info);
  }

  /**
   * Get all manga candidate canvases
   */
  getMangaCandidates() {
    const candidates = [];
    this.canvasRegistry.forEach((info, id) => {
      if (info.isMangaCandidate) {
        candidates.push({
          id,
          element: info.element,
          dimensions: info.dimensions,
          contextType: info.contextType
        });
      }
    });
    return candidates;
  }

  /**
   * Get capture history for canvas
   */
  getCaptureHistory(canvasId) {
    const info = this.canvasRegistry.get(canvasId);
    if (!info) return null;
    
    return {
      captureCount: info.captureCount,
      lastCapture: info.lastCapture,
      dimensions: info.dimensions
    };
  }

  /**
   * Create visual overlay for canvas (for debugging)
   */
  createDebugOverlay(canvas, info) {
    const overlay = document.createElement('div');
    overlay.className = 'canvas-debug-overlay';
    overlay.style.cssText = `
      position: absolute;
      border: 2px solid #ff6b6b;
      pointer-events: none;
      z-index: 999999;
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
    `;
    
    const label = document.createElement('span');
    label.textContent = `${info.id} (${info.contextType})`;
    label.style.cssText = `
      background: #ff6b6b;
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      font-family: monospace;
    `;
    
    overlay.appendChild(label);
    
    // Position over canvas
    const rect = canvas.getBoundingClientRect();
    const parent = canvas.offsetParent || document.body;
    const parentRect = parent.getBoundingClientRect();
    
    overlay.style.left = `${rect.left - parentRect.left}px`;
    overlay.style.top = `${rect.top - parentRect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    
    parent.appendChild(overlay);
    
    return overlay;
  }

  /**
   * Cleanup and destroy
   */
  destroy() {
    this.deactivate();
    this.canvasRegistry.clear();
    this.captureQueue = [];
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CanvasInterceptor;
}

export default CanvasInterceptor;