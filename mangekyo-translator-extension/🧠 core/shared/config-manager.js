/**
 * config-manager.js
 * Centralized configuration and settings management for Mangekyo Translator
 * Handles storage operations, validation, migrations, and change notifications
 */

// Import constants (assumes constants.js is available)
// In production, use proper module imports
const Constants = typeof window !== 'undefined' && window.MangekyoConstants 
    ? window.MangekyoConstants 
    : require('./constants.js');

const { 
    STORAGE_KEYS, 
    OCR_CONFIG, 
    TRANSLATION_CONFIG, 
    UI_CONFIG, 
    SECURITY_CONFIG,
    PERFORMANCE,
    EVENTS 
} = Constants;

// ==========================================
// DEFAULT CONFIGURATION
// ==========================================

const DEFAULTS = {
    // General settings
    general: {
        enabled: true,
        autoTranslate: false,
        showNotifications: true,
        preserveFormatting: true,
        darkMode: true,
        language: 'en'
    },
    
    // Translation settings
    translation: {
        engine: TRANSLATION_CONFIG.DEFAULTS.ENGINE,
        sourceLang: TRANSLATION_CONFIG.DEFAULTS.SOURCE_LANG,
        targetLang: TRANSLATION_CONFIG.DEFAULTS.TARGET_LANG,
        preserveContext: TRANSLATION_CONFIG.DEFAULTS.PRESERVE_CONTEXT,
        honorifics: TRANSLATION_CONFIG.DEFAULTS.HONORIFICS,
        sfxTranslation: TRANSLATION_CONFIG.DEFAULTS.SFX_TRANSLATION,
        cacheEnabled: TRANSLATION_CONFIG.DEFAULTS.CACHE_ENABLED,
        formality: 'default', // 'default', 'formal', 'informal'
        fallbackEngine: 'google'
    },
    
    // OCR settings
    ocr: {
        language: 'jpn',
        verticalText: false,
        confidenceThreshold: 65,
        preprocess: {
            denoise: OCR_CONFIG.TESSERACT.PREPROCESS.DENOISE,
            binarize: OCR_CONFIG.TESSERACT.PREPROCESS.BINARIZE,
            deskew: OCR_CONFIG.TESSERACT.PREPROCESS.DESKEW,
            contrast: OCR_CONFIG.TESSERACT.PREPROCESS.CONTRAST,
            sharpen: OCR_CONFIG.TESSERACT.PREPROCESS.SHARPEN
        },
        autoRotate: true,
        psm: 6
    },
    
    // Appearance settings
    appearance: {
        theme: 'sharingan', // 'sharingan', 'minimal', 'custom'
        overlayOpacity: UI_CONFIG.OVERLAY.DEFAULT_OPACITY,
        fontSize: 16,
        fontFamily: UI_CONFIG.OVERLAY.FONT_FAMILY,
        textColor: UI_CONFIG.OVERLAY.TEXT_COLOR,
        backgroundColor: UI_CONFIG.OVERLAY.BACKGROUND_COLOR,
        borderColor: UI_CONFIG.OVERLAY.BORDER_COLOR,
        borderRadius: UI_CONFIG.OVERLAY.BORDER_RADIUS,
        padding: UI_CONFIG.OVERLAY.PADDING,
        shadow: UI_CONFIG.OVERLAY.SHADOW,
        showConfidence: true,
        showOriginal: false,
        animationSpeed: 'normal' // 'slow', 'normal', 'fast', 'none'
    },
    
    // Hotkey settings
    hotkeys: {
        toggleOverlay: { key: 't', ctrl: true, shift: false, alt: false },
        scanPage: { key: 's', ctrl: true, shift: true, alt: false },
        cancel: { key: 'Escape', ctrl: false, shift: false, alt: false },
        nextBubble: { key: 'ArrowDown', ctrl: false, shift: false, alt: false },
        prevBubble: { key: 'ArrowUp', ctrl: false, shift: false, alt: false },
        quickTranslate: { key: 'q', ctrl: true, shift: false, alt: false }
    },
    
    // Advanced settings
    advanced: {
        debugMode: false,
        logLevel: 'info',
        maxCacheSize: PERFORMANCE.MEMORY.MAX_CACHE_SIZE,
        ocrTimeout: PERFORMANCE.TIMEOUTS.OCR,
        translationTimeout: PERFORMANCE.TIMEOUTS.TRANSLATION,
        concurrentOcr: PERFORMANCE.BATCH.MAX_CONCURRENT_OCR,
        concurrentTranslation: PERFORMANCE.BATCH.MAX_CONCURRENT_TRANSLATE,
        enableHardwareAcceleration: true,
        disableAnalytics: false,
        experimentalFeatures: false
    },
    
    // API keys (encrypted at rest)
    apiKeys: {
        deepl: null,
        openai: null,
        customEndpoint: null
    },
    
    // Site-specific overrides
    sites: {}
};

// ==========================================
// SCHEMA VALIDATION
// ==========================================

const SCHEMA = {
    general: {
        enabled: { type: 'boolean', default: true },
        autoTranslate: { type: 'boolean', default: false },
        showNotifications: { type: 'boolean', default: true },
        preserveFormatting: { type: 'boolean', default: true },
        darkMode: { type: 'boolean', default: true },
        language: { type: 'string', enum: ['en', 'ja', 'ko', 'zh', 'es', 'fr', 'de'], default: 'en' }
    },
    
    translation: {
        engine: { 
            type: 'string', 
            enum: Object.keys(TRANSLATION_CONFIG.ENGINES), 
            default: 'google' 
        },
        sourceLang: { 
            type: 'string', 
            enum: TRANSLATION_CONFIG.LANGUAGES.map(l => l.code), 
            default: 'auto' 
        },
        targetLang: { 
            type: 'string', 
            enum: TRANSLATION_CONFIG.LANGUAGES.map(l => l.code), 
            default: 'en' 
        },
        preserveContext: { type: 'boolean', default: true },
        honorifics: { type: 'boolean', default: true },
        sfxTranslation: { type: 'boolean', default: true },
        cacheEnabled: { type: 'boolean', default: true },
        formality: { type: 'string', enum: ['default', 'formal', 'informal'], default: 'default' },
        fallbackEngine: { 
            type: 'string', 
            enum: Object.keys(TRANSLATION_CONFIG.ENGINES), 
            default: 'google' 
        }
    },
    
    ocr: {
        language: { 
            type: 'string', 
            enum: Object.keys(OCR_CONFIG.TESSERACT.LANGUAGES), 
            default: 'jpn' 
        },
        verticalText: { type: 'boolean', default: false },
        confidenceThreshold: { 
            type: 'number', 
            min: 0, 
            max: 100, 
            default: 65 
        },
        preprocess: {
            type: 'object',
            properties: {
                denoise: { type: 'boolean', default: true },
                binarize: { type: 'boolean', default: true },
                deskew: { type: 'boolean', default: true },
                contrast: { type: 'number', min: 0.5, max: 2.0, default: 1.2 },
                sharpen: { type: 'boolean', default: false }
            }
        },
        autoRotate: { type: 'boolean', default: true },
        psm: { type: 'number', enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], default: 6 }
    },
    
    appearance: {
        theme: { type: 'string', enum: ['sharingan', 'minimal', 'custom'], default: 'sharingan' },
        overlayOpacity: { type: 'number', min: 0.1, max: 1.0, default: 0.95 },
        fontSize: { type: 'number', min: 8, max: 32, default: 16 },
        fontFamily: { type: 'string', default: UI_CONFIG.OVERLAY.FONT_FAMILY },
        textColor: { type: 'string', pattern: /^#[0-9A-Fa-f]{6}$/, default: '#ffffff' },
        backgroundColor: { type: 'string', pattern: /^rgba?\(.*\)$/, default: 'rgba(0, 0, 0, 0.85)' },
        borderColor: { type: 'string', pattern: /^#[0-9A-Fa-f]{6}$/, default: '#ff4444' },
        borderRadius: { type: 'number', min: 0, max: 20, default: 8 },
        padding: { type: 'number', min: 0, max: 24, default: 12 },
        shadow: { type: 'string', default: UI_CONFIG.OVERLAY.SHADOW },
        showConfidence: { type: 'boolean', default: true },
        showOriginal: { type: 'boolean', default: false },
        animationSpeed: { type: 'string', enum: ['slow', 'normal', 'fast', 'none'], default: 'normal' }
    },
    
    hotkeys: {
        type: 'object',
        patternProperties: {
            '^[a-zA-Z]+$': {
                type: 'object',
                properties: {
                    key: { type: 'string', required: true },
                    ctrl: { type: 'boolean', default: false },
                    shift: { type: 'boolean', default: false },
                    alt: { type: 'boolean', default: false }
                }
            }
        }
    },
    
    advanced: {
        debugMode: { type: 'boolean', default: false },
        logLevel: { type: 'string', enum: ['verbose', 'info', 'warn', 'error', 'silent'], default: 'info' },
        maxCacheSize: { type: 'number', min: 10 * 1024 * 1024, max: 200 * 1024 * 1024, default: 50 * 1024 * 1024 },
        ocrTimeout: { type: 'number', min: 60000, max: 600000, default: 300000 },
        translationTimeout: { type: 'number', min: 5000, max: 120000, default: 30000 },
        concurrentOcr: { type: 'number', min: 1, max: 5, default: 3 },
        concurrentTranslation: { type: 'number', min: 1, max: 10, default: 5 },
        enableHardwareAcceleration: { type: 'boolean', default: true },
        disableAnalytics: { type: 'boolean', default: false },
        experimentalFeatures: { type: 'boolean', default: false }
    }
};

// ==========================================
// CONFIGURATION MANAGER CLASS
// ==========================================

class ConfigManager {
    constructor() {
        this.cache = new Map();
        this.listeners = new Map();
        this.initialized = false;
        this.encryptionKey = null;
    }
    
    /**
     * Initialize configuration manager
     */
    async initialize() {
        if (this.initialized) return;
        
        // Load settings from storage
        const stored = await this.loadFromStorage();
        
        // Merge with defaults and validate
        this.config = this.mergeWithDefaults(stored);
        this.validate();
        
        // Setup storage change listeners
        this.setupStorageListeners();
        
        this.initialized = true;
        this.emit('initialized', this.config);
        
        console.log('ConfigManager initialized');
        return this.config;
    }
    
    /**
     * Load settings from Chrome storage
     */
    async loadFromStorage() {
        try {
            const result = await chrome.storage.local.get([
                STORAGE_KEYS.SETTINGS,
                STORAGE_KEYS.USER_PREFERENCES
            ]);
            
            const settings = result[STORAGE_KEYS.SETTINGS] || {};
            const preferences = result[STORAGE_KEYS.USER_PREFERENCES] || {};
            
            return { ...settings, ...preferences };
        } catch (error) {
            console.error('Failed to load settings:', error);
            return {};
        }
    }
    
    /**
     * Merge stored settings with defaults
     */
    mergeWithDefaults(stored) {
        const merged = {};
        
        // Deep merge each section
        for (const [section, defaults] of Object.entries(DEFAULTS)) {
            if (section === 'apiKeys') continue; // Handle separately
            
            merged[section] = this.deepMerge(
                JSON.parse(JSON.stringify(defaults)),
                stored[section] || {}
            );
        }
        
        // Handle site-specific settings
        merged.sites = stored.sites || {};
        
        return merged;
    }
    
    /**
     * Deep merge helper
     */
    deepMerge(target, source) {
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                target[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                target[key] = source[key];
            }
        }
        return target;
    }
    
    /**
     * Validate current configuration against schema
     */
    validate() {
        const errors = [];
        
        for (const [section, schema] of Object.entries(SCHEMA)) {
            if (!this.config[section]) continue;
            
            const sectionErrors = this.validateSection(
                section, 
                this.config[section], 
                schema
            );
            errors.push(...sectionErrors);
        }
        
        if (errors.length > 0) {
            console.warn('Configuration validation errors:', errors);
            // Fix invalid values
            errors.forEach(error => this.fixInvalidValue(error));
        }
        
        return errors.length === 0;
    }
    
    /**
     * Validate a configuration section
     */
    validateSection(sectionName, data, schema) {
        const errors = [];
        
        for (const [key, rules] of Object.entries(schema)) {
            const value = data[key];
            
            // Check required
            if (rules.required && (value === undefined || value === null)) {
                errors.push({ section: sectionName, key, error: 'required', rules });
                continue;
            }
            
            if (value === undefined) continue;
            
            // Type checking
            if (rules.type && !this.checkType(value, rules.type)) {
                errors.push({ section: sectionName, key, error: 'type', value, rules });
                continue;
            }
            
            // Enum checking
            if (rules.enum && !rules.enum.includes(value)) {
                errors.push({ section: sectionName, key, error: 'enum', value, rules });
            }
            
            // Range checking for numbers
            if (rules.type === 'number') {
                if (rules.min !== undefined && value < rules.min) {
                    errors.push({ section: sectionName, key, error: 'min', value, rules });
                }
                if (rules.max !== undefined && value > rules.max) {
                    errors.push({ section: sectionName, key, error: 'max', value, rules });
                }
            }
            
            // Pattern checking for strings
            if (rules.pattern && !rules.pattern.test(value)) {
                errors.push({ section: sectionName, key, error: 'pattern', value, rules });
            }
            
            // Recursive object validation
            if (rules.type === 'object' && rules.properties) {
                const nestedErrors = this.validateSection(
                    `${sectionName}.${key}`, 
                    value, 
                    rules.properties
                );
                errors.push(...nestedErrors);
            }
        }
        
        return errors;
    }
    
    /**
     * Check value type
     */
    checkType(value, expectedType) {
        if (expectedType === 'array') return Array.isArray(value);
        if (expectedType === 'object') return typeof value === 'object' && !Array.isArray(value);
        return typeof value === expectedType;
    }
    
    /**
     * Fix invalid configuration value
     */
    fixInvalidValue(error) {
        const { section, key, rules } = error;
        
        if (rules.default !== undefined) {
            this.config[section][key] = rules.default;
            console.log(`Fixed invalid value for ${section}.${key} to default:`, rules.default);
        }
    }
    
    /**
     * Setup storage change listeners for sync
     */
    setupStorageListeners() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            
            let hasChanges = false;
            
            for (const [key, change] of Object.entries(changes)) {
                if (key === STORAGE_KEYS.SETTINGS || key === STORAGE_KEYS.USER_PREFERENCES) {
                    // Update local config
                    this.config = this.mergeWithDefaults(change.newValue || {});
                    this.validate();
                    hasChanges = true;
                }
            }
            
            if (hasChanges) {
                this.emit('changed', this.config);
            }
        });
    }
    
    // ==========================================
    // GETTERS
    // ==========================================
    
    /**
     * Get full configuration
     */
    getAll() {
        return JSON.parse(JSON.stringify(this.config));
    }
    
    /**
     * Get section configuration
     */
    get(section, key = null) {
        if (!this.config[section]) return undefined;
        
        if (key === null) {
            return JSON.parse(JSON.stringify(this.config[section]));
        }
        
        return this.config[section][key];
    }
    
    /**
     * Get nested value using dot notation
     */
    getPath(path) {
        const parts = path.split('.');
        let current = this.config;
        
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        
        return current;
    }
    
    /**
     * Get effective configuration for a specific site
     */
    getForSite(domain) {
        const base = this.getAll();
        const siteOverrides = base.sites[domain] || {};
        
        // Deep merge site-specific overrides
        for (const [section, overrides] of Object.entries(siteOverrides)) {
            if (base[section] && typeof base[section] === 'object') {
                base[section] = this.deepMerge(base[section], overrides);
            }
        }
        
        return base;
    }
    
    // ==========================================
    // SETTERS
    // ==========================================
    
    /**
     * Set configuration value
     */
    async set(section, key, value) {
        if (!this.config[section]) {
            this.config[section] = {};
        }
        
        const oldValue = this.config[section][key];
        this.config[section][key] = value;
        
        // Validate after change
        const errors = this.validate();
        if (errors.length > 0) {
            // Revert if invalid
            this.config[section][key] = oldValue;
            throw new Error(`Invalid value for ${section}.${key}`);
        }
        
        // Persist to storage
        await this.save();
        
        // Notify listeners
        this.emit('changed', {
            section,
            key,
            oldValue,
            newValue: value,
            config: this.getAll()
        });
        
        return true;
    }
    
    /**
     * Set multiple values at once
     */
    async setMultiple(section, values) {
        const oldValues = { ...this.config[section] };
        
        Object.assign(this.config[section], values);
        
        // Validate
        const errors = this.validate();
        if (errors.length > 0) {
            // Revert
            this.config[section] = oldValues;
            throw new Error('Invalid values in batch update');
        }
        
        await this.save();
        this.emit('changed', { section, values, config: this.getAll() });
        
        return true;
    }
    
    /**
     * Set site-specific configuration
     */
    async setSiteOverride(domain, section, values) {
        if (!this.config.sites[domain]) {
            this.config.sites[domain] = {};
        }
        
        this.config.sites[domain][section] = {
            ...this.config.sites[domain][section],
            ...values
        };
        
        await this.save();
        this.emit('siteChanged', { domain, section, values });
        
        return true;
    }
    
    /**
     * Remove site-specific override
     */
    async removeSiteOverride(domain, section = null) {
        if (section) {
            delete this.config.sites[domain]?.[section];
        } else {
            delete this.config.sites[domain];
        }
        
        await this.save();
        return true;
    }
    
    // ==========================================
    // STORAGE OPERATIONS
    // ==========================================
    
    /**
     * Save configuration to storage
     */
    async save() {
        try {
            // Separate sensitive API keys
            const { apiKeys, ...safeConfig } = this.config;
            
            await chrome.storage.local.set({
                [STORAGE_KEYS.SETTINGS]: safeConfig,
                [STORAGE_KEYS.USER_PREFERENCES]: {
                    general: safeConfig.general,
                    appearance: safeConfig.appearance
                }
            });
            
            // Save API keys encrypted (if encryption available)
            if (apiKeys && (apiKeys.deepl || apiKeys.openai)) {
                await this.saveApiKeys(apiKeys);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            throw error;
        }
    }
    
    /**
     * Save API keys with encryption
     */
    async saveApiKeys(apiKeys) {
        try {
            // In production, use proper encryption
            // For now, use chrome.storage.local with obfuscation
            const obfuscated = this.obfuscate(JSON.stringify(apiKeys));
            await chrome.storage.local.set({
                [STORAGE_KEYS.API_KEYS]: obfuscated
            });
        } catch (error) {
            console.error('Failed to save API keys:', error);
        }
    }
    
    /**
     * Load API keys
     */
    async loadApiKeys() {
        try {
            const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEYS);
            if (result[STORAGE_KEYS.API_KEYS]) {
                const deobfuscated = this.deobfuscate(result[STORAGE_KEYS.API_KEYS]);
                return JSON.parse(deobfuscated);
            }
        } catch (error) {
            console.error('Failed to load API keys:', error);
        }
        return { deepl: null, openai: null, customEndpoint: null };
    }
    
    /**
     * Simple obfuscation (not true encryption)
     * In production, use AES-GCM via Web Crypto API
     */
    obfuscate(str) {
        return btoa(str.split('').reverse().join(''));
    }
    
    deobfuscate(str) {
        return atob(str).split('').reverse().join('');
    }
    
    // ==========================================
    // RESET & MIGRATION
    // ==========================================
    
    /**
     * Reset configuration to defaults
     */
    async reset(section = null) {
        if (section) {
            this.config[section] = JSON.parse(JSON.stringify(DEFAULTS[section]));
        } else {
            this.config = JSON.parse(JSON.stringify(DEFAULTS));
        }
        
        await this.save();
        this.emit('reset', { section, config: this.getAll() });
        
        return true;
    }
    
    /**
     * Export configuration
     */
    export() {
        return JSON.stringify(this.getAll(), null, 2);
    }
    
    /**
     * Import configuration
     */
    async import(jsonString) {
        try {
            const imported = JSON.parse(jsonString);
            
            // Validate imported config
            this.config = this.mergeWithDefaults(imported);
            this.validate();
            
            await this.save();
            this.emit('imported', this.getAll());
            
            return true;
        } catch (error) {
            console.error('Failed to import settings:', error);
            throw new Error('Invalid settings file');
        }
    }
    
    /**
     * Migrate settings from older versions
     */
    async migrate(fromVersion) {
        const migrations = {
            '0.9': (config) => {
                // Example: migrate old hotkey format
                if (config.hotkeys && typeof config.hotkeys.toggle === 'string') {
                    config.hotkeys.toggleOverlay = {
                        key: config.hotkeys.toggle,
                        ctrl: true,
                        shift: false
                    };
                    delete config.hotkeys.toggle;
                }
                return config;
            }
        };
        
        let currentConfig = this.getAll();
        
        for (const [version, migration] of Object.entries(migrations)) {
            if (this.compareVersions(fromVersion, version) < 0) {
                console.log(`Migrating settings from ${version}...`);
                currentConfig = migration(currentConfig);
            }
        }
        
        this.config = currentConfig;
        await this.save();
        
        return true;
    }
    
    /**
     * Semantic version comparison
     */
    compareVersions(a, b) {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const partA = partsA[i] || 0;
            const partB = partsB[i] || 0;
            
            if (partA < partB) return -1;
            if (partA > partB) return 1;
        }
        
        return 0;
    }
    
    // ==========================================
    // EVENT SYSTEM
    // ==========================================
    
    /**
     * Subscribe to configuration changes
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        
        // Return unsubscribe function
        return () => this.listeners.get(event).delete(callback);
    }
    
    /**
     * Emit event to listeners
     */
    emit(event, data) {
        // Dispatch DOM event for content scripts
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(EVENTS.SETTINGS_CHANGE, {
                detail: { event, data }
            }));
        }
        
        // Call registered listeners
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => {
                try {
                    cb(data);
                } catch (error) {
                    console.error('Error in config listener:', error);
                }
            });
        }
    }
    
    // ==========================================
    // UTILITY METHODS
    // ==========================================
    
    /**
     * Check if feature is enabled
     */
    isEnabled(feature) {
        return this.get('general', 'enabled') && this.get('general', feature);
    }
    
    /**
     * Get effective hotkey string for display
     */
    getHotkeyString(action) {
        const hotkey = this.get('hotkeys', action);
        if (!hotkey) return '';
        
        const parts = [];
        if (hotkey.ctrl) parts.push('Ctrl');
        if (hotkey.shift) parts.push('Shift');
        if (hotkey.alt) parts.push('Alt');
        parts.push(hotkey.key.toUpperCase());
        
        return parts.join('+');
    }
    
    /**
     * Check if current settings indicate first run
     */
    isFirstRun() {
        return !this.config._initialized;
    }
    
    /**
     * Mark as initialized
     */
    async markInitialized() {
        this.config._initialized = true;
        this.config._initializedAt = Date.now();
        await this.save();
    }
}

// ==========================================
// SINGLETON INSTANCE
// ==========================================

const configManager = new ConfigManager();

// Initialize on load
if (typeof window !== 'undefined') {
    // Browser environment
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => configManager.initialize());
    } else {
        configManager.initialize();
    }
}

// ==========================================
// EXPORTS
// ==========================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConfigManager, configManager, DEFAULTS, SCHEMA };
}

if (typeof window !== 'undefined') {
    window.ConfigManager = ConfigManager;
    window.configManager = configManager;
}

export { ConfigManager, configManager, DEFAULTS, SCHEMA };
export default configManager;