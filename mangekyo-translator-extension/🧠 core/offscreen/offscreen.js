/**
 * Offscreen Document Coordinator
 * 
 * Manages heavy processing tasks outside service worker context (MV3 requirement).
 * Coordinates OCR, translation, and image analysis through dedicated documents.
 * 
 * Architecture:
 * - offscreen.html (this): Coordinator, message router, lightweight processing
 * - heavy-ocr.html: Tesseract.js OCR processing (heavy memory usage)
 * - image-analysis.html: Computer vision tasks (TensorFlow.js)
 * 
 * @module offscreen/offscreen
 */

import { MessageRouter } from '../core/background/event-router.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class OffscreenCoordinator {
  constructor() {
    this.processingQueues = {
      ocr: [],
      translation: [],
      vision: []
    };
    
    this.activeDocuments = new Map();
    this.workerPools = new Map();
    this.messagePorts = new Map();
    
    this.config = {
      maxConcurrentOCR: 2,
      maxConcurrentTranslation: 3,
      maxConcurrentVision: 1,
      taskTimeout: 30000, // 30 seconds
      cleanupInterval: 60000 // 1 minute
    };

    this.stats = {
      processed: 0,
      failed: 0,
      queued: 0
    };

    this.init();
  }

  /**
   * Initialize offscreen coordinator
   */
  init() {
    console.log('[Offscreen] Coordinator initialized');
    
    // Setup message handling from service worker
    this.setupMessageHandling();
    
    // Setup periodic cleanup
    setInterval(() => this.cleanup(), this.config.cleanupInterval);
    
    // Notify service worker we're ready
    this.notifyReady();
  }

  /**
   * Setup Chrome runtime message handling
   */
  setupMessageHandling() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep channel open for async
    });

    // Also listen for dedicated port connections (for streaming)
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name.startsWith('offscreen-')) {
        this.handlePortConnection(port);
      }
    });
  }

  /**
   * Route incoming messages to appropriate handlers
   */
  async handleMessage(message, sender, sendResponse) {
    const { type, payload, taskId } = message;
    
    console.log(`[Offscreen] Received: ${type}`, taskId);

    try {
      switch (type) {
        case 'OCR_REQUEST':
          const ocrResult = await this.handleOCR(payload, taskId);
          sendResponse({ success: true, result: ocrResult, taskId });
          break;

        case 'TRANSLATION_REQUEST':
          const transResult = await this.handleTranslation(payload, taskId);
          sendResponse({ success: true, result: transResult, taskId });
          break;

        case 'VISION_REQUEST':
          const visionResult = await this.handleVisionAnalysis(payload, taskId);
          sendResponse({ success: true, result: visionResult, taskId });
          break;

        case 'IMAGE_PREPROCESS':
          const processed = await this.handleImagePreprocessing(payload, taskId);
          sendResponse({ success: true, result: processed, taskId });
          break;

        case 'HEALTH_CHECK':
          sendResponse({ 
            success: true, 
            status: 'healthy',
            stats: this.stats,
            queues: this.getQueueStatus()
          });
          break;

        case 'CLEANUP':
          this.forceCleanup();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[Offscreen] Error:', error);
      sendResponse({ success: false, error: error.message, taskId });
      this.stats.failed++;
    }
  }

  /**
   * Handle OCR request - delegates to heavy-ocr.html or worker
   */
  async handleOCR(payload, taskId) {
    const perfMark = PerformanceMonitor.mark(`ocr-${taskId}`);
    
    // Queue if at capacity
    if (this.getActiveOCRCount() >= this.config.maxConcurrentOCR) {
      return this.queueTask('ocr', payload, taskId);
    }

    try {
      // Option 1: Use dedicated offscreen document for heavy OCR
      if (payload.heavy || payload.language === 'jpn_vert') {
        return await this.processInDedicatedDocument('heavy-ocr', payload, taskId);
      }
      
      // Option 2: Use inline worker for lightweight OCR
      return await this.processInWorker('ocr', payload, taskId);
      
    } finally {
      PerformanceMonitor.measure(perfMark, `ocr-complete-${taskId}`);
      this.stats.processed++;
    }
  }

  /**
   * Handle translation request
   */
  async handleTranslation(payload, taskId) {
    if (this.getActiveTranslationCount() >= this.config.maxConcurrentTranslation) {
      return this.queueTask('translation', payload, taskId);
    }

    // Translation happens via API calls, can be done directly here
    const { text, sourceLang, targetLang, engine } = payload;
    
    const translator = await this.getTranslationEngine(engine);
    const result = await translator.translate(text, sourceLang, targetLang);
    
    return {
      originalText: text,
      translatedText: result.text,
      engine: engine,
      confidence: result.confidence,
      alternatives: result.alternatives || []
    };
  }

  /**
   * Handle computer vision analysis (bubble detection, etc.)
   */
  async handleVisionAnalysis(payload, taskId) {
    if (this.getActiveVisionCount() >= this.config.maxConcurrentVision) {
      return this.queueTask('vision', payload, taskId);
    }

    // Vision tasks require TensorFlow.js, use dedicated document
    return await this.processInDedicatedDocument('image-analysis', payload, taskId);
  }

  /**
   * Handle image preprocessing (resize, denoise, binarize)
   */
  async handleImagePreprocessing(payload, taskId) {
    const { imageData, operations } = payload;
    
    const canvas = document.getElementById('processing-canvas');
    const ctx = canvas.getContext('2d');
    
    // Load image
    const img = await this.loadImage(imageData);
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    
    // Apply preprocessing pipeline
    let processed = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    for (const op of operations) {
      switch (op.type) {
        case 'grayscale':
          processed = this.applyGrayscale(processed);
          break;
        case 'binarize':
          processed = this.applyBinarization(processed, op.threshold);
          break;
        case 'denoise':
          processed = this.applyDenoise(processed);
          break;
        case 'deskew':
          processed = await this.applyDeskew(processed);
          break;
        case 'resize':
          processed = this.applyResize(processed, op.width, op.height);
          break;
      }
    }
    
    // Return as data URL
    ctx.putImageData(processed, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /**
   * Process task in dedicated offscreen document (iframe)
   */
  async processInDedicatedDocument(docType, payload, taskId) {
    const doc = await this.getOrCreateDocument(docType);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task ${taskId} timeout`));
      }, this.config.taskTimeout);

      const handler = (event) => {
        if (event.data.taskId === taskId) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data.result);
          }
          
          this.releaseDocument(docType, taskId);
        }
      };

      window.addEventListener('message', handler);
      
      // Send to iframe
      doc.contentWindow.postMessage({
        type: 'PROCESS',
        taskId,
        payload
      }, '*');
    });
  }

  /**
   * Process task in Web Worker
   */
  async processInWorker(workerType, payload, taskId) {
    const worker = await this.getOrCreateWorker(workerType);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker task ${taskId} timeout`));
      }, this.config.taskTimeout);

      const handler = (event) => {
        if (event.data.taskId === taskId) {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data.result);
          }
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'PROCESS', taskId, payload });
    });
  }

  /**
   * Get or create dedicated processing document (iframe)
   */
  async getOrCreateDocument(docType) {
    if (this.activeDocuments.has(docType)) {
      return this.activeDocuments.get(docType);
    }

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    
    const docPath = {
      'heavy-ocr': 'heavy-ocr.html',
      'image-analysis': 'image-analysis.html'
    }[docType];

    iframe.src = docPath;
    
    await new Promise((resolve, reject) => {
      iframe.onload = resolve;
      iframe.onerror = reject;
      document.body.appendChild(iframe);
    });

    this.activeDocuments.set(docType, iframe);
    return iframe;
  }

  /**
   * Get or create Web Worker
   */
  async getOrCreateWorker(workerType) {
    if (this.workerPools.has(workerType)) {
      return this.workerPools.get(workerType);
    }

    const workerPaths = {
      'ocr': 'workers/ocr-worker.js',
      'translation': 'workers/translation-worker.js'
    };

    const worker = new Worker(workerPaths[workerType], { type: 'module' });
    this.workerPools.set(workerType, worker);
    return worker;
  }

  /**
   * Queue task for later processing
   */
  queueTask(type, payload, taskId) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        type,
        payload,
        taskId,
        resolve,
        reject,
        timestamp: Date.now()
      };

      this.processingQueues[type].push(queueItem);
      this.stats.queued++;
      
      console.log(`[Offscreen] Queued ${type} task ${taskId}. Queue length: ${this.processingQueues[type].length}`);
      
      // Try to process queue
      this.processQueues();
    });
  }

  /**
   * Process queued tasks when capacity frees up
   */
  async processQueues() {
    for (const [type, queue] of Object.entries(this.processingQueues)) {
      while (queue.length > 0 && this.hasCapacity(type)) {
        const item = queue.shift();
        
        try {
          let result;
          switch (type) {
            case 'ocr':
              result = await this.handleOCR(item.payload, item.taskId);
              break;
            case 'translation':
              result = await this.handleTranslation(item.payload, item.taskId);
              break;
            case 'vision':
              result = await this.handleVisionAnalysis(item.payload, item.taskId);
              break;
          }
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      }
    }
  }

  /**
   * Check if we have capacity for task type
   */
  hasCapacity(type) {
    const counts = {
      'ocr': this.getActiveOCRCount(),
      'translation': this.getActiveTranslationCount(),
      'vision': this.getActiveVisionCount()
    };
    
    const limits = {
      'ocr': this.config.maxConcurrentOCR,
      'translation': this.config.maxConcurrentTranslation,
      'vision': this.config.maxConcurrentVision
    };
    
    return counts[type] < limits[type];
  }

  /**
   * Get active OCR task count
   */
  getActiveOCRCount() {
    // Implementation would track active promises
    return 0;
  }

  getActiveTranslationCount() {
    return 0;
  }

  getActiveVisionCount() {
    return 0;
  }

  /**
   * Image preprocessing helpers
   */
  applyGrayscale(imageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    return imageData;
  }

  applyBinarization(imageData, threshold = 128) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i]; // Already grayscale
      const val = gray > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    return imageData;
  }

  applyDenoise(imageData) {
    // Simple median filter implementation
    // Full implementation would use more sophisticated algorithms
    return imageData;
  }

  async applyDeskew(imageData) {
    // Would use Hough transform or projection profile
    return imageData;
  }

  applyResize(imageData, width, height) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    tempCtx.putImageData(imageData, 0, 0);
    
    ctx.drawImage(tempCanvas, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }

  /**
   * Utility: Load image from various sources
   */
  loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      
      if (typeof source === 'string') {
        img.src = source;
      } else if (source instanceof Blob) {
        img.src = URL.createObjectURL(source);
      } else if (source instanceof ImageData) {
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d').putImageData(source, 0, 0);
        img.src = canvas.toDataURL();
      }
    });
  }

  /**
   * Get translation engine instance
   */
  async getTranslationEngine(engineName) {
    const { TranslationEngine } = await import('../computer-vision/translation/engines/translation-engine.js');
    
    switch (engineName) {
      case 'google':
        const { GoogleTranslate } = await import('../computer-vision/translation/engines/google-translate.js');
        return new GoogleTranslate();
      case 'deepl':
        const { DeepLAdapter } = await import('../computer-vision/translation/engines/deepL-adapter.js');
        return new DeepLAdapter();
      case 'openai':
        const { OpenAIGPT } = await import('../computer-vision/translation/engines/openai-gpt.js');
        return new OpenAIGPT();
      default:
        return new TranslationEngine();
    }
  }

  /**
   * Release document resources
   */
  releaseDocument(docType, taskId) {
    // Keep documents alive for reuse, but track usage
    console.log(`[Offscreen] Released ${docType} for task ${taskId}`);
  }

  /**
   * Cleanup idle resources
   */
  cleanup() {
    // Remove idle documents
    for (const [type, doc] of this.activeDocuments) {
      // Check if idle for too long
      doc.idleTime = (doc.idleTime || 0) + 1;
      if (doc.idleTime > 5) { // 5 minutes
        doc.remove();
        this.activeDocuments.delete(type);
        console.log(`[Offscreen] Cleaned up idle ${type} document`);
      }
    }
  }

  forceCleanup() {
    this.activeDocuments.forEach(doc => doc.remove());
    this.activeDocuments.clear();
    this.workerPools.forEach(worker => worker.terminate());
    this.workerPools.clear();
  }

  /**
   * Get queue status for monitoring
   */
  getQueueStatus() {
    return {
      ocr: this.processingQueues.ocr.length,
      translation: this.processingQueues.translation.length,
      vision: this.processingQueues.vision.length
    };
  }

  /**
   * Notify service worker that offscreen is ready
   */
  notifyReady() {
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_READY',
      timestamp: Date.now()
    }).catch(() => {
      // Service worker might not be listening yet
    });
  }

  /**
   * Handle port connections for streaming data
   */
  handlePortConnection(port) {
    console.log('[Offscreen] Port connected:', port.name);
    this.messagePorts.set(port.name, port);
    
    port.onMessage.addListener((msg) => {
      // Handle streaming data
      if (msg.type === 'STREAM_DATA') {
        this.handleStreamData(msg);
      }
    });
    
    port.onDisconnect.addListener(() => {
      this.messagePorts.delete(port.name);
    });
  }

  /**
   * Handle streaming data (for large images/progressive results)
   */
  handleStreamData(message) {
    // Implementation for chunked data processing
  }

  /**
   * Logging utilities
   */
  log(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };
    
    console.log(`[Offscreen] ${level}:`, message, data || '');
    
    // Update UI if in debug mode
    const container = document.getElementById('log-container');
    if (container && container.style.display !== 'none') {
      const div = document.createElement('div');
      div.className = `log-entry ${level}`;
      div.textContent = `[${entry.timestamp.split('T')[1].split('.')[0]}] ${message}`;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
  }
}

// Initialize coordinator
const coordinator = new OffscreenCoordinator();

// Expose for debugging
window.mangekyoOffscreen = coordinator;