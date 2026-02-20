/**
 * heavy-ocr.js
 * Offscreen document OCR processor for Mangekyo Translator
 * Handles heavy Tesseract.js operations in isolated context (MV3 compliance)
 */

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================

const CONFIG = {
    TESSERACT_PATH: '../computer-vision/ocr/language-data/',
    MAX_WORKERS: 1, // Offscreen docs limited to single worker due to memory constraints
    DEFAULT_LANG: 'eng',
    PREPROCESS_DEFAULTS: {
        denoise: true,
        binarize: true,
        deskew: true,
        contrast: 1.2
    },
    PERFORMANCE: {
        maxImageDimension: 4096,
        compressionQuality: 0.92,
        timeout: 300000 // 5 minutes
    }
};

// Language configurations with display names
const LANG_CONFIG = {
    'eng': { name: 'English', vertical: false, engine: 'tesseract' },
    'jpn': { name: 'Japanese', vertical: false, engine: 'tesseract' },
    'jpn_vert': { name: 'Japanese (Vertical)', vertical: true, engine: 'tesseract' },
    'kor': { name: 'Korean', vertical: false, engine: 'tesseract' },
    'chi_sim': { name: 'Chinese (Simplified)', vertical: false, engine: 'tesseract' },
    'chi_tra': { name: 'Chinese (Traditional)', vertical: false, engine: 'tesseract' }
};

// ==========================================
// STATE MANAGEMENT
// ==========================================

const state = {
    tesseract: null,
    worker: null,
    isReady: false,
    currentJob: null,
    jobQueue: [],
    loadedLanguages: new Set(),
    stats: {
        totalProcessed: 0,
        totalErrors: 0,
        avgProcessingTime: 0
    }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Logging utility with levels and UI updates
 */
const logger = {
    console: document.getElementById('log-console'),
    
    log(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${level}`;
        entry.textContent = `[${timestamp}] ${message}`;
        
        this.console.appendChild(entry);
        this.console.scrollTop = this.console.scrollHeight;
        
        // Also log to browser console for debugging
        console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log'](message);
    },
    
    info(msg) { this.log(msg, 'info'); },
    success(msg) { this.log(msg, 'success'); },
    warning(msg) { this.log(msg, 'warning'); },
    error(msg) { this.log(msg, 'error'); }
};

/**
 * Update UI status indicator
 */
function updateStatus(status, isActive = false) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const aura = document.getElementById('ems-aura');
    
    text.textContent = status;
    
    if (isActive) {
        text.classList.add('active');
        aura.classList.add('active');
        indicator.style.animation = 'sharingan-spin 1s linear infinite';
    } else {
        text.classList.remove('active');
        aura.classList.remove('active');
        indicator.style.animation = 'sharingan-pulse 3s ease-in-out infinite';
    }
}

/**
 * Update progress bar
 */
function updateProgress(percent, statusText) {
    const bar = document.getElementById('ocr-progress');
    const percentText = document.getElementById('progress-percent');
    const status = document.getElementById('progress-status');
    
    bar.style.width = `${percent}%`;
    if (percent >= 100) bar.classList.add('complete');
    else bar.classList.remove('complete');
    
    percentText.textContent = `${Math.round(percent)}%`;
    if (statusText) status.textContent = statusText;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 MB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Update memory usage display
 */
function updateMemoryStats() {
    if (performance.memory) {
        const used = performance.memory.usedJSHeapSize;
        document.getElementById('memory-usage').textContent = formatBytes(used);
    }
}

// ==========================================
// IMAGE PREPROCESSING
// ==========================================

/**
 * Image preprocessing pipeline for better OCR accuracy
 */
const ImagePreprocessor = {
    canvas: document.createElement('canvas'),
    ctx: null,
    
    init() {
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    },
    
    /**
     * Main preprocessing function
     */
    async process(imageData, options = {}) {
        const startTime = performance.now();
        const opts = { ...CONFIG.PREPROCESS_DEFAULTS, ...options };
        
        logger.info('Starting image preprocessing...');
        updateProgress(10, 'Loading image...');
        
        // Load image from various sources (blob, dataURL, ImageData)
        let img = await this.loadImage(imageData);
        
        // Resize if too large
        img = await this.resizeIfNeeded(img);
        
        // Draw to canvas
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.ctx.drawImage(img, 0, 0);
        
        updateProgress(25, 'Applying filters...');
        
        let imageDataObj = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        // Apply preprocessing steps
        if (opts.denoise) {
            imageDataObj = this.denoise(imageDataObj);
        }
        
        if (opts.contrast !== 1) {
            imageDataObj = this.adjustContrast(imageDataObj, opts.contrast);
        }
        
        if (opts.binarize) {
            imageDataObj = this.binarize(imageDataObj);
        }
        
        if (opts.deskew) {
            imageDataObj = await this.deskew(imageDataObj);
        }
        
        // Put back on canvas
        this.ctx.putImageData(imageDataObj, 0, 0);
        
        // Update preview
        this.updatePreview('processed-canvas', this.canvas);
        
        const duration = Math.round(performance.now() - startTime);
        logger.success(`Preprocessing complete (${duration}ms)`);
        
        return {
            canvas: this.canvas,
            imageData: imageDataObj,
            width: this.canvas.width,
            height: this.canvas.height
        };
    },
    
    /**
     * Load image from various input types
     */
    loadImage(source) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image'));
            
            if (source instanceof Blob) {
                img.src = URL.createObjectURL(source);
            } else if (typeof source === 'string') {
                img.src = source;
            } else if (source instanceof ImageData) {
                // Create temporary canvas to convert ImageData to data URL
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = source.width;
                tempCanvas.height = source.height;
                tempCanvas.getContext('2d').putImageData(source, 0, 0);
                img.src = tempCanvas.toDataURL();
            } else {
                reject(new Error('Unsupported image source type'));
            }
        });
    },
    
    /**
     * Resize image if dimensions exceed maximum
     */
    resizeIfNeeded(img) {
        const maxDim = CONFIG.PERFORMANCE.maxImageDimension;
        
        if (img.width <= maxDim && img.height <= maxDim) {
            return img;
        }
        
        const ratio = Math.min(maxDim / img.width, maxDim / img.height);
        const newWidth = Math.round(img.width * ratio);
        const newHeight = Math.round(img.height * ratio);
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Use better quality downsampling
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        tempCtx.drawImage(img, 0, 0, newWidth, newHeight);
        
        logger.info(`Resized image from ${img.width}x${img.height} to ${newWidth}x${newHeight}`);
        
        return this.loadImage(tempCanvas.toDataURL('image/png'));
    },
    
    /**
     * Simple noise reduction using median filter
     */
    denoise(imageData) {
        const { width, height, data } = imageData;
        const output = new Uint8ClampedArray(data);
        const windowSize = 3;
        const halfWindow = Math.floor(windowSize / 2);
        
        for (let y = halfWindow; y < height - halfWindow; y++) {
            for (let x = halfWindow; x < width - halfWindow; x++) {
                const idx = (y * width + x) * 4;
                
                // Apply median filter to each channel
                for (let c = 0; c < 3; c++) {
                    const values = [];
                    for (let wy = -halfWindow; wy <= halfWindow; wy++) {
                        for (let wx = -halfWindow; wx <= halfWindow; wx++) {
                            const nIdx = ((y + wy) * width + (x + wx)) * 4;
                            values.push(data[nIdx + c]);
                        }
                    }
                    values.sort((a, b) => a - b);
                    output[idx + c] = values[Math.floor(values.length / 2)];
                }
            }
        }
        
        return new ImageData(output, width, height);
    },
    
    /**
     * Adjust contrast
     */
    adjustContrast(imageData, factor) {
        const { data } = imageData;
        const intercept = 128 * (1 - factor);
        
        for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i] * factor + intercept;     // R
            data[i + 1] = data[i + 1] * factor + intercept; // G
            data[i + 2] = data[i + 2] * factor + intercept; // B
        }
        
        return imageData;
    },
    
    /**
     * Adaptive binarization (Otsu's method simplified)
     */
    binarize(imageData) {
        const { data } = imageData;
        
        // Calculate threshold using simple mean
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            sum += gray;
        }
        const threshold = sum / (data.length / 4);
        
        // Apply threshold
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const val = gray > threshold ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = val;
        }
        
        return imageData;
    },
    
    /**
     * Deskew (rotation correction) - simplified version
     */
    async deskew(imageData) {
        // For production, implement Hough transform or projection profile method
        // This is a placeholder that returns original
        logger.info('Deskew: Using simplified algorithm');
        return imageData;
    },
    
    /**
     * Update canvas preview in UI
     */
    updatePreview(canvasId, sourceCanvas) {
        const target = document.getElementById(canvasId);
        if (!target) return;
        
        target.width = sourceCanvas.width;
        target.height = sourceCanvas.height;
        const ctx = target.getContext('2d');
        ctx.drawImage(sourceCanvas, 0, 0);
    }
};

// ==========================================
// TESSERACT OCR ENGINE
// ==========================================

const OCREngine = {
    /**
     * Initialize Tesseract.js
     */
    async initialize() {
        logger.info('Initializing Tesseract.js engine...');
        updateStatus('Initializing', true);
        
        try {
            // Dynamically import Tesseract.js
            // In production, this should be bundled or loaded from CDN
            if (typeof Tesseract === 'undefined') {
                await this.loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js');
            }
            
            state.tesseract = Tesseract;
            logger.success('Tesseract.js loaded');
            
            // Create worker with progress tracking
            state.worker = await state.tesseract.createWorker('eng', 1, {
                logger: (m) => this.handleProgress(m),
                errorHandler: (e) => logger.error(`Worker error: ${e}`)
            });
            
            // Set path to language data
            await state.worker.load();
            
            document.getElementById('tesseract-version').textContent = state.tesseract.version;
            document.getElementById('worker-status').textContent = 'Ready';
            document.getElementById('worker-status').classList.add('active');
            
            state.loadedLanguages.add('eng');
            updateLanguageUI();
            
            state.isReady = true;
            document.getElementById('loading-overlay').classList.add('hidden');
            
            logger.success('OCR Engine ready');
            updateStatus('Standby');
            
            return true;
            
        } catch (error) {
            logger.error(`Initialization failed: ${error.message}`);
            updateStatus('Error');
            throw error;
        }
    },
    
    /**
     * Load external script dynamically
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    },
    
    /**
     * Handle Tesseract progress updates
     */
    handleProgress(message) {
        if (message.status === 'recognizing text') {
            const progress = message.progress * 100;
            updateProgress(30 + (progress * 0.6), `Recognizing: ${Math.round(progress)}%`);
        } else if (message.status === 'loading language traineddata') {
            updateProgress(20 + (message.progress * 10), `Loading language data...`);
        }
    },
    
    /**
     * Load additional language
     */
    async loadLanguage(langCode) {
        if (state.loadedLanguages.has(langCode)) return;
        if (!LANG_CONFIG[langCode]) throw new Error(`Unsupported language: ${langCode}`);
        
        logger.info(`Loading language: ${LANG_CONFIG[langCode].name}`);
        updateStatus('Loading Language', true);
        
        try {
            await state.worker.loadLanguage(langCode);
            await state.worker.reinitialize(langCode);
            state.loadedLanguages.add(langCode);
            updateLanguageUI();
            logger.success(`Language loaded: ${langCode}`);
        } catch (error) {
            logger.error(`Failed to load language ${langCode}: ${error.message}`);
            throw error;
        } finally {
            updateStatus('Standby');
        }
    },
    
    /**
     * Perform OCR on image
     */
    async recognize(imageData, options = {}) {
        if (!state.isReady) {
            throw new Error('OCR Engine not initialized');
        }
        
        const startTime = performance.now();
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        state.currentJob = jobId;
        updateStatus('Processing', true);
        updateProgress(0, 'Starting OCR...');
        
        try {
            // Load required language
            const lang = options.language || CONFIG.DEFAULT_LANG;
            if (!state.loadedLanguages.has(lang)) {
                await this.loadLanguage(lang);
            }
            
            // Preprocess image
            const processed = await ImagePreprocessor.process(imageData, options.preprocess);
            
            // Configure recognition parameters
            const params = {
                tessedit_pageseg_mode: options.pageSegMode || '6', // Assume single uniform block of text
                tessedit_char_whitelist: options.whitelist || '',
                preserve_interword_spaces: '1'
            };
            
            if (LANG_CONFIG[lang]?.vertical) {
                params.tessedit_pageseg_mode = '5'; // Vertical text
            }
            
            await state.worker.setParameters(params);
            
            updateProgress(30, 'Running OCR...');
            
            // Execute OCR
            const result = await state.worker.recognize(processed.canvas);
            
            if (state.currentJob !== jobId) {
                throw new Error('Job cancelled');
            }
            
            // Process results
            const processedResult = this.processResult(result, options);
            
            // Update UI with results
            displayResults(processedResult);
            
            // Update stats
            const duration = Math.round(performance.now() - startTime);
            state.stats.totalProcessed++;
            state.stats.avgProcessingTime = 
                (state.stats.avgProcessingTime * (state.stats.totalProcessed - 1) + duration) 
                / state.stats.totalProcessed;
            
            document.getElementById('process-time').textContent = `${duration} ms`;
            updateMemoryStats();
            
            updateProgress(100, 'Complete');
            logger.success(`OCR complete: ${processedResult.text.length} chars in ${duration}ms`);
            updateStatus('Standby');
            
            return processedResult;
            
        } catch (error) {
            state.stats.totalErrors++;
            logger.error(`OCR failed: ${error.message}`);
            updateStatus('Error');
            throw error;
        } finally {
            state.currentJob = null;
        }
    },
    
    /**
     * Process and format Tesseract result
     */
    processResult(result, options) {
        const lines = result.data.lines || [];
        const words = result.data.words || [];
        
        // Filter by confidence if specified
        const minConfidence = options.minConfidence || 30;
        const filteredLines = lines.filter(line => line.confidence >= minConfidence);
        
        return {
            text: result.data.text,
            confidence: result.data.confidence,
            lines: filteredLines.map(line => ({
                text: line.text,
                confidence: Math.round(line.confidence),
                bbox: line.bbox
            })),
            words: words.map(w => ({
                text: w.text,
                confidence: Math.round(w.confidence),
                bbox: w.bbox
            })),
            html: result.data.hocr
        };
    },
    
    /**
     * Terminate worker
     */
    async terminate() {
        if (state.worker) {
            await state.worker.terminate();
            state.worker = null;
            state.isReady = false;
            logger.info('OCR Engine terminated');
        }
    }
};

// ==========================================
// UI UPDATES
// ==========================================

function updateLanguageUI() {
    document.querySelectorAll('.lang-item').forEach(item => {
        const lang = item.dataset.lang;
        if (state.loadedLanguages.has(lang)) {
            item.classList.add('loaded');
            item.classList.add('active');
        }
    });
}

function displayResults(result) {
    const output = document.getElementById('ocr-output');
    
    if (!result.text.trim()) {
        output.innerHTML = '<div style="color: #666; font-style: italic;">No text detected</div>';
        return;
    }
    
    output.innerHTML = result.lines.map(line => {
        let confidenceClass = 'low';
        if (line.confidence >= 80) confidenceClass = 'high';
        else if (line.confidence >= 50) confidenceClass = 'medium';
        
        return `
            <div class="ocr-line">
                <span class="confidence-badge ${confidenceClass}">${line.confidence}%</span>
                <span>${escapeHtml(line.text)}</span>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// MESSAGE HANDLING (Service Worker Communication)
// ==========================================

const MessageHandler = {
    init() {
        // Listen for messages from service worker
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep channel open for async
        });
        
        logger.info('Message handler initialized');
    },
    
    async handleMessage(message, sender, sendResponse) {
        logger.info(`Received command: ${message.command}`);
        
        try {
            switch (message.command) {
                case 'ocr:process':
                    const result = await OCREngine.recognize(message.imageData, message.options);
                    sendResponse({ success: true, result });
                    break;
                    
                case 'ocr:preload-language':
                    await OCREngine.loadLanguage(message.language);
                    sendResponse({ success: true });
                    break;
                    
                case 'ocr:get-status':
                    sendResponse({
                        success: true,
                        status: {
                            isReady: state.isReady,
                            loadedLanguages: Array.from(state.loadedLanguages),
                            currentJob: state.currentJob,
                            stats: state.stats
                        }
                    });
                    break;
                    
                case 'ocr:cancel':
                    state.currentJob = null;
                    sendResponse({ success: true });
                    break;
                    
                case 'ping':
                    sendResponse({ success: true, pong: true });
                    break;
                    
                default:
                    sendResponse({ success: false, error: 'Unknown command' });
            }
        } catch (error) {
            logger.error(`Command failed: ${error.message}`);
            sendResponse({ success: false, error: error.message });
        }
    }
};

// ==========================================
// INITIALIZATION
// ==========================================

async function init() {
    logger.info('Heavy OCR Document starting...');
    
    // Initialize preprocessor
    ImagePreprocessor.init();
    
    // Setup message handling
    MessageHandler.init();
    
    // Initialize Tesseract
    try {
        await OCREngine.initialize();
        
        // Notify service worker that we're ready
        chrome.runtime.sendMessage({
            target: 'service-worker',
            type: 'offscreen:ready',
            timestamp: Date.now()
        });
        
    } catch (error) {
        logger.error(`Failed to initialize: ${error.message}`);
        document.getElementById('loading-overlay').innerHTML = `
            <div style="color: #ff4444; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                <div>Failed to initialize OCR Engine</div>
                <div style="font-size: 12px; margin-top: 10px; color: #666;">${error.message}</div>
            </div>
        `;
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    OCREngine.terminate();
});