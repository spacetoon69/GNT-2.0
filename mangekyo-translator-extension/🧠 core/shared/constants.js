/**
 * constants.js
 * Global constants and configuration for Mangekyo Translator
 * Shared across all extension contexts (background, content, offscreen, popup)
 */

// ==========================================
// EXTENSION METADATA
// ==========================================

const EXTENSION = {
    NAME: 'Mangekyo Translator',
    VERSION: '1.0.0',
    MANIFEST_VERSION: 3,
    AUTHOR: 'Mangekyo Team',
    REPOSITORY: 'https://github.com/mangekyo-translator/extension',
    WEBSITE: 'https://mangekyo-translator.app',
    SUPPORT_EMAIL: 'support@mangekyo-translator.app'
};

// ==========================================
// ENVIRONMENT & DEBUGGING
// ==========================================

const ENV = {
    DEVELOPMENT: 'development',
    STAGING: 'staging',
    PRODUCTION: 'production',
    
    // Current environment (set during build)
    CURRENT: (typeof process !== 'undefined' && process.env.NODE_ENV) || 'production',
    
    // Debug flags
    DEBUG: {
        LOG_LEVEL: 'info', // 'verbose', 'info', 'warn', 'error', 'silent'
        ENABLE_INSPECTOR: false,
        MOCK_APIS: false,
        SIMULATE_SLOW_NETWORK: false
    }
};

// ==========================================
// STORAGE KEYS
// ==========================================

const STORAGE_KEYS = {
    // Settings
    SETTINGS: 'mt_settings',
    USER_PREFERENCES: 'mt_user_prefs',
    API_KEYS: 'mt_api_keys_encrypted',
    
    // Cache
    TRANSLATION_CACHE: 'mt_translation_cache',
    IMAGE_CACHE: 'mt_image_cache',
    OCR_CACHE: 'mt_ocr_cache',
    
    // State
    SESSION_STATE: 'mt_session',
    LAST_TRANSLATION: 'mt_last_translation',
    HISTORY: 'mt_history',
    
    // License & Security
    LICENSE_DATA: 'mt_license',
    HARDWARE_FINGERPRINT: 'mt_hw_id',
    CHECKSUMS: 'mt_checksums',
    
    // Sync
    SYNC_TIMESTAMP: 'mt_sync_ts',
    PENDING_SYNC: 'mt_pending_sync'
};

// ==========================================
// MESSAGE TYPES (Inter-context communication)
// ==========================================

const MESSAGE_TYPES = {
    // Background <-> Content
    CONTENT: {
        SCAN_PAGE: 'content:scan',
        EXTRACT_TEXT: 'content:extract',
        INJECT_OVERLAY: 'content:inject',
        REMOVE_OVERLAY: 'content:remove',
        GET_PAGE_INFO: 'content:page_info',
        SCROLL_TO: 'content:scroll'
    },
    
    // Background <-> Offscreen
    OFFSCREEN: {
        OCR_PROCESS: 'offscreen:ocr',
        OCR_STATUS: 'offscreen:ocr_status',
        OCR_CANCEL: 'offscreen:ocr_cancel',
        TRANSLATE: 'offscreen:translate',
        TRANSLATE_BATCH: 'offscreen:translate_batch',
        ANALYZE_IMAGE: 'offscreen:analyze',
        READY: 'offscreen:ready',
        PING: 'offscreen:ping'
    },
    
    // Background <-> Popup
    POPUP: {
        GET_STATUS: 'popup:status',
        GET_STATS: 'popup:stats',
        TRIGGER_SCAN: 'popup:scan',
        UPDATE_SETTINGS: 'popup:settings',
        TOGGLE_FEATURE: 'popup:toggle'
    },
    
    // Internal Events
    EVENTS: {
        TRANSLATION_COMPLETE: 'evt:translation_done',
        OCR_COMPLETE: 'evt:ocr_done',
        DETECTION_COMPLETE: 'evt:detection_done',
        ERROR: 'evt:error',
        LICENSE_INVALID: 'evt:license_invalid',
        RATE_LIMIT_HIT: 'evt:rate_limit'
    }
};

// ==========================================
// OCR CONFIGURATION
// ==========================================

const OCR_CONFIG = {
    // Tesseract settings
    TESSERACT: {
        WORKER_PATH: 'computer-vision/ocr/worker.min.js',
        LANG_PATH: 'computer-vision/ocr/language-data/',
        CORE_PATH: 'computer-vision/ocr/tesseract-core.wasm.js',
        
        // Default parameters
        DEFAULTS: {
            psm: 6, // Page segmentation mode: Assume single uniform block of text
            oem: 3, // OCR Engine mode: Default, based on what is available
            preserve_interword_spaces: '1',
            tessedit_char_blacklist: '', // Characters to exclude
            tessedit_char_whitelist: ''  // Characters to include only
        },
        
        // Language packs
        LANGUAGES: {
            ENG: { code: 'eng', name: 'English', vertical: false, size: '10MB' },
            JPN: { code: 'jpn', name: 'Japanese', vertical: false, size: '15MB' },
            JPN_VERT: { code: 'jpn_vert', name: 'Japanese (Vertical)', vertical: true, size: '15MB' },
            KOR: { code: 'kor', name: 'Korean', vertical: false, size: '12MB' },
            CHI_SIM: { code: 'chi_sim', name: 'Chinese (Simplified)', vertical: false, size: '20MB' },
            CHI_TRA: { code: 'chi_tra', name: 'Chinese (Traditional)', vertical: false, size: '20MB' }
        },
        
        // Preprocessing defaults
        PREPROCESS: {
            RESIZE_MAX_DIMENSION: 4096,
            DENOISE: true,
            BINARIZE: true,
            DESKEW: true,
            CONTRAST: 1.2,
            SHARPEN: false
        }
    },
    
    // Performance
    TIMEOUT: 300000, // 5 minutes
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
};

// ==========================================
// TRANSLATION CONFIGURATION
// ==========================================

const TRANSLATION_CONFIG = {
    // Default settings
    DEFAULTS: {
        SOURCE_LANG: 'auto',
        TARGET_LANG: 'en',
        ENGINE: 'google',
        PRESERVE_CONTEXT: true,
        HONORIFICS: true,
        SFX_TRANSLATION: true,
        CACHE_ENABLED: true
    },
    
    // Engine configurations
    ENGINES: {
        GOOGLE: {
            id: 'google',
            name: 'Google Translate',
            requiresKey: false,
            maxTextLength: 5000,
            rateLimit: 100, // per minute
            supportsContext: false,
            supportsFormality: false,
            url: 'https://translate.googleapis.com/translate_a/single'
        },
        DEEPL: {
            id: 'deepl',
            name: 'DeepL',
            requiresKey: true,
            maxTextLength: 3000,
            rateLimit: 50,
            supportsContext: true,
            supportsFormality: true,
            url: 'https://api-free.deepl.com/v2/translate',
            proUrl: 'https://api.deepl.com/v2/translate'
        },
        OPENAI: {
            id: 'openai',
            name: 'OpenAI GPT-4',
            requiresKey: true,
            maxTextLength: 8000,
            rateLimit: 20,
            supportsContext: true,
            supportsVision: true,
            url: 'https://api.openai.com/v1/chat/completions',
            models: {
                GPT4: 'gpt-4-turbo-preview',
                GPT4_VISION: 'gpt-4-vision-preview',
                GPT35: 'gpt-3.5-turbo'
            }
        },
        LOCAL: {
            id: 'local',
            name: 'Local LLM',
            requiresKey: false,
            maxTextLength: 2000,
            rateLimit: 1000,
            supportsContext: true,
            url: 'http://localhost:11434/api/generate' // Ollama default
        }
    },
    
    // Language mappings
    LANGUAGES: [
        { code: 'auto', name: 'Auto-detect', native: 'Auto' },
        { code: 'en', name: 'English', native: 'English' },
        { code: 'ja', name: 'Japanese', native: '日本語' },
        { code: 'ko', name: 'Korean', native: '한국어' },
        { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
        { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
        { code: 'es', name: 'Spanish', native: 'Español' },
        { code: 'fr', name: 'French', native: 'Français' },
        { code: 'de', name: 'German', native: 'Deutsch' },
        { code: 'it', name: 'Italian', native: 'Italiano' },
        { code: 'pt', name: 'Portuguese', native: 'Português' },
        { code: 'ru', name: 'Russian', native: 'Русский' }
    ],
    
    // Cache settings
    CACHE: {
        MAX_SIZE: 1000,
        TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
        COMPRESSION: true
    }
};

// ==========================================
// COMPUTER VISION CONFIGURATION
// ==========================================

const CV_CONFIG = {
    // Detection models
    MODELS: {
        BUBBLE_DETECTOR: {
            name: 'bubble-detector',
            path: 'computer-vision/detection/bubble-detector/model/',
            inputSize: [640, 640],
            confidenceThreshold: 0.65,
            nmsThreshold: 0.3,
            classes: ['speech_bubble', 'thought_bubble', 'narration_box', 'sfx']
        },
        PANEL_DETECTOR: {
            name: 'panel-segmenter',
            path: 'computer-vision/detection/panel-detector/',
            inputSize: [1024, 1024],
            minPanelArea: 0.05, // Minimum 5% of image area
            padding: 10
        },
        TEXT_DETECTOR: {
            name: 'text-region',
            path: 'computer-vision/detection/text-region/',
            inputSize: [512, 512],
            confidenceThreshold: 0.5
        }
    },
    
    // Image processing
    IMAGE: {
        MAX_DIMENSION: 4096,
        PREVIEW_QUALITY: 0.92,
        THUMBNAIL_SIZE: 200,
        SUPPORTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']
    },
    
    // Post-processing
    POST_PROCESS: {
        MERGE_OVERLAPPING: true,
        MIN_BUBBLE_SIZE: 20, // Minimum pixel dimension
        MAX_BUBBLE_SIZE: 0.8, // Maximum 80% of image dimension
        ASPECT_RATIO_LIMIT: 5 // Max width/height ratio
    }
};

// ==========================================
// UI CONFIGURATION
// ==========================================

const UI_CONFIG = {
    // Overlay settings
    OVERLAY: {
        DEFAULT_OPACITY: 0.95,
        HOVER_OPACITY: 1,
        BACKGROUND_COLOR: 'rgba(0, 0, 0, 0.85)',
        TEXT_COLOR: '#ffffff',
        BORDER_COLOR: '#ff4444',
        FONT_FAMILY: "'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC', sans-serif",
        FONT_SIZE_MIN: 12,
        FONT_SIZE_MAX: 24,
        PADDING: 12,
        BORDER_RADIUS: 8,
        SHADOW: '0 4px 20px rgba(0, 0, 0, 0.5)',
        
        // Animation
        FADE_IN_DURATION: 200,
        FADE_OUT_DURATION: 150,
        SCALE_DURATION: 300
    },
    
    // Sharingan visual modes
    MODES: {
        IDLE: {
            name: 'idle',
            icon: 'tomoe-sharingan',
            color: '#ff4444',
            animation: 'spin-slow'
        },
        ACTIVE: {
            name: 'active',
            icon: 'ems-madara',
            color: '#ff0000',
            animation: 'spin-fast'
        },
        PROCESSING: {
            name: 'processing',
            icon: 'ems-madara',
            color: '#ffaa00',
            animation: 'pulse'
        },
        ERROR: {
            name: 'error',
            icon: 'tomoe-sharingan',
            color: '#666666',
            animation: 'none'
        }
    },
    
    // Hotkeys
    HOTKEYS: {
        TOGGLE_OVERLAY: { key: 't', ctrl: true, shift: false },
        SCAN_PAGE: { key: 's', ctrl: true, shift: true },
        CANCEL: { key: 'Escape', ctrl: false, shift: false },
        NEXT_BUBBLE: { key: 'ArrowDown', ctrl: false, shift: false },
        PREV_BUBBLE: { key: 'ArrowUp', ctrl: false, shift: false }
    },
    
    // Popup dimensions
    POPUP: {
        WIDTH: 380,
        HEIGHT: 600
    },
    
    // Options page
    OPTIONS: {
        SECTIONS: [
            'general',
            'translation',
            'ocr',
            'appearance',
            'hotkeys',
            'advanced',
            'about'
        ]
    }
};

// ==========================================
// SITE ADAPTERS
// ==========================================

const SITE_ADAPTERS = {
    MANGADEX: {
        id: 'mangadex',
        name: 'MangaDex',
        domains: ['mangadex.org', 'www.mangadex.org'],
        selectors: {
            reader: '.md-reader',
            page: '.md-reader__page',
            image: '.md-reader__image'
        },
        features: {
            infiniteScroll: false,
            doublePage: true,
            longStrip: true
        }
    },
    WEBTOON: {
        id: 'webtoon',
        name: 'Webtoon',
        domains: ['webtoons.com', 'www.webtoons.com', 'm.webtoons.com'],
        selectors: {
            reader: '#_viewer',
            page: '.viewer_img',
            image: 'img'
        },
        features: {
            infiniteScroll: true,
            doublePage: false,
            longStrip: true
        }
    },
    CUBARI: {
        id: 'cubari',
        name: 'Cubari',
        domains: ['cubari.moe', 'guya.moe'],
        selectors: {
            reader: '#reader',
            page: '.page',
            image: 'img'
        },
        features: {
            infiniteScroll: false,
            doublePage: true,
            longStrip: false
        }
    },
    GENERIC: {
        id: 'generic',
        name: 'Generic Manga Site',
        domains: ['*'],
        selectors: {
            reader: 'body',
            page: 'img',
            image: 'img'
        },
        features: {
            infiniteScroll: false,
            doublePage: false,
            longStrip: false
        }
    }
};

// ==========================================
// SECURITY & PRIVACY
// ==========================================

const SECURITY_CONFIG = {
    // Encryption
    ENCRYPTION: {
        ALGORITHM: 'AES-GCM',
        KEY_LENGTH: 256,
        ITERATIONS: 100000,
        SALT_LENGTH: 16,
        IV_LENGTH: 12
    },
    
    // License validation
    LICENSE: {
        VALIDATION_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
        GRACE_PERIOD: 7 * 24 * 60 * 60 * 1000, // 7 days
        CHECKSUM_ALGORITHM: 'SHA-256'
    },
    
    // Data retention
    DATA_RETENTION: {
        TRANSLATION_HISTORY: 30 * 24 * 60 * 60 * 1000, // 30 days
        CACHE: 7 * 24 * 60 * 60 * 1000, // 7 days
        LOGS: 7 * 24 * 60 * 60 * 1000 // 7 days
    },
    
    // Permissions
    PERMISSIONS: {
        REQUIRED: ['storage', 'activeTab', 'scripting'],
        OPTIONAL: ['clipboardWrite', 'downloads'],
        HOST: ['<all_urls>']
    }
};

// ==========================================
// PERFORMANCE & LIMITS
// ==========================================

const PERFORMANCE = {
    // Memory limits
    MEMORY: {
        MAX_CACHE_SIZE: 50 * 1024 * 1024, // 50MB
        MAX_IMAGE_CACHE: 20 * 1024 * 1024, // 20MB
        GC_THRESHOLD: 100 * 1024 * 1024 // 100MB
    },
    
    // Timeouts
    TIMEOUTS: {
        OCR: 300000, // 5 minutes
        TRANSLATION: 30000, // 30 seconds
        DETECTION: 60000, // 1 minute
        API_CALL: 10000, // 10 seconds
        OFFSCREEN_LIFETIME: 300000 // 5 minutes idle
    },
    
    // Batch processing
    BATCH: {
        MAX_CONCURRENT_OCR: 3,
        MAX_CONCURRENT_TRANSLATE: 5,
        MAX_IMAGE_QUEUE: 10
    },
    
    // Throttling
    THROTTLE: {
        SCROLL: 100, // ms
        RESIZE: 250, // ms
        MOUSE_MOVE: 50 // ms
    }
};

// ==========================================
// ERROR CODES
// ==========================================

const ERROR_CODES = {
    // General
    UNKNOWN: 'ERR_UNKNOWN',
    TIMEOUT: 'ERR_TIMEOUT',
    CANCELLED: 'ERR_CANCELLED',
    INVALID_PARAMS: 'ERR_INVALID_PARAMS',
    
    // OCR
    OCR_INIT_FAILED: 'ERR_OCR_INIT',
    OCR_LANGUAGE_LOAD_FAILED: 'ERR_OCR_LANG',
    OCR_PROCESSING_FAILED: 'ERR_OCR_PROCESS',
    OCR_TIMEOUT: 'ERR_OCR_TIMEOUT',
    
    // Translation
    TRANSLATION_API_ERROR: 'ERR_TRANS_API',
    TRANSLATION_RATE_LIMIT: 'ERR_TRANS_RATE_LIMIT',
    TRANSLATION_INVALID_KEY: 'ERR_TRANS_KEY',
    TRANSLATION_QUOTA_EXCEEDED: 'ERR_TRANS_QUOTA',
    
    // CV
    CV_MODEL_LOAD_FAILED: 'ERR_CV_MODEL',
    CV_DETECTION_FAILED: 'ERR_CV_DETECT',
    
    // Network
    NETWORK_OFFLINE: 'ERR_NETWORK_OFFLINE',
    NETWORK_TIMEOUT: 'ERR_NETWORK_TIMEOUT',
    NETWORK_CORS: 'ERR_NETWORK_CORS',
    
    // License
    LICENSE_INVALID: 'ERR_LICENSE_INVALID',
    LICENSE_EXPIRED: 'ERR_LICENSE_EXPIRED',
    LICENSE_HARDWARE_MISMATCH: 'ERR_LICENSE_HW',
    
    // Security
    TAMPER_DETECTED: 'ERR_SECURITY_TAMPER',
    CHECKSUM_FAILED: 'ERR_SECURITY_CHECKSUM'
};

// ==========================================
// EVENT NAMES (DOM Custom Events)
// ==========================================

const EVENTS = {
    // Extension lifecycle
    EXTENSION_READY: 'mangekyo:ready',
    EXTENSION_ERROR: 'mangekyo:error',
    
    // OCR
    OCR_START: 'mangekyo:ocr:start',
    OCR_PROGRESS: 'mangekyo:ocr:progress',
    OCR_COMPLETE: 'mangekyo:ocr:complete',
    OCR_ERROR: 'mangekyo:ocr:error',
    
    // Translation
    TRANSLATION_START: 'mangekyo:translation:start',
    TRANSLATION_COMPLETE: 'mangekyo:translation:complete',
    TRANSLATION_ERROR: 'mangekyo:translation:error',
    
    // Detection
    DETECTION_START: 'mangekyo:detection:start',
    DETECTION_COMPLETE: 'mangekyo:detection:complete',
    
    // UI
    OVERLAY_SHOW: 'mangekyo:overlay:show',
    OVERLAY_HIDE: 'mangekyo:overlay:hide',
    BUBBLE_SELECT: 'mangekyo:bubble:select',
    SETTINGS_CHANGE: 'mangekyo:settings:change'
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Deep freeze object to prevent mutations
 */
function deepFreeze(obj) {
    Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            deepFreeze(obj[key]);
        }
    });
    return Object.freeze(obj);
}

// Freeze all constants to prevent accidental modification
const Constants = deepFreeze({
    EXTENSION,
    ENV,
    STORAGE_KEYS,
    MESSAGE_TYPES,
    OCR_CONFIG,
    TRANSLATION_CONFIG,
    CV_CONFIG,
    UI_CONFIG,
    SITE_ADAPTERS,
    SECURITY_CONFIG,
    PERFORMANCE,
    ERROR_CODES,
    EVENTS
});

// ==========================================
// EXPORTS
// ==========================================

// ES Module export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Constants;
}

// AMD export
if (typeof define === 'function' && define.amd) {
    define('Constants', [], () => Constants);
}

// Global export for browser
if (typeof window !== 'undefined') {
    window.MangekyoConstants = Constants;
}

// Export individual constants for tree-shaking
export {
    EXTENSION,
    ENV,
    STORAGE_KEYS,
    MESSAGE_TYPES,
    OCR_CONFIG,
    TRANSLATION_CONFIG,
    CV_CONFIG,
    UI_CONFIG,
    SITE_ADAPTERS,
    SECURITY_CONFIG,
    PERFORMANCE,
    ERROR_CODES,
    EVENTS
};

export default Constants;