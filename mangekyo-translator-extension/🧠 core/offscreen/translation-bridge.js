/**
 * translation-bridge.js
 * Translation API orchestrator for Mangekyo Translator
 * Manages multiple translation engines, caching, and context preservation
 */

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================

const CONFIG = {
    // API Endpoints
    ENDPOINTS: {
        GOOGLE_TRANSLATE: 'https://translate.googleapis.com/translate_a/single',
        DEEPL_API: 'https://api-free.deepl.com/v2/translate',
        DEEPL_PRO_API: 'https://api.deepl.com/v2/translate',
        OPENAI_API: 'https://api.openai.com/v1/chat/completions',
        OPENAI_VISION: 'https://api.openai.com/v1/chat/completions'
    },
    
    // Rate limiting (requests per minute)
    RATE_LIMITS: {
        google: 100,
        deepl: 50,
        openai: 20,
        local: 1000
    },
    
    // Cache settings
    CACHE: {
        maxSize: 1000,          // Max cached translations
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
        compression: true
    },
    
    // Translation defaults
    DEFAULTS: {
        sourceLang: 'auto',
        targetLang: 'en',
        engine: 'google',
        preserveContext: true,
        honorifics: true,
        sfxTranslation: true
    },
    
    // Retry settings
    RETRY: {
        maxAttempts: 3,
        backoffMs: 1000,
        maxBackoffMs: 10000
    }
};

// Translation engine metadata
const ENGINES = {
    google: {
        name: 'Google Translate',
        requiresKey: false,
        supportsContext: false,
        maxTextLength: 5000,
        supportedLangs: ['auto', 'en', 'ja', 'ko', 'zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'pt']
    },
    deepl: {
        name: 'DeepL',
        requiresKey: true,
        supportsContext: true,
        maxTextLength: 3000,
        supportedLangs: ['en', 'ja', 'ko', 'zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'pt', 'auto']
    },
    openai: {
        name: 'OpenAI GPT-4',
        requiresKey: true,
        supportsContext: true,
        maxTextLength: 8000,
        supportedLangs: ['en', 'ja', 'ko', 'zh', 'zh-TW', 'es', 'fr', 'de', 'it', 'ru', 'pt', 'auto']
    },
    local: {
        name: 'Local LLM',
        requiresKey: false,
        supportsContext: true,
        maxTextLength: 2000,
        supportedLangs: ['en', 'ja', 'ko', 'zh']
    }
};

// Language code mappings
const LANG_CODES = {
    // Google Translate codes
    google: {
        'auto': 'auto',
        'en': 'en',
        'ja': 'ja',
        'ko': 'ko',
        'zh': 'zh-CN',
        'zh-TW': 'zh-TW',
        'es': 'es',
        'fr': 'fr',
        'de': 'de',
        'it': 'it',
        'ru': 'ru',
        'pt': 'pt'
    },
    // DeepL codes
    deepl: {
        'auto': null, // DeepL doesn't support auto, must specify
        'en': 'EN',
        'ja': 'JA',
        'ko': 'KO',
        'zh': 'ZH',
        'zh-TW': 'ZH-HANT',
        'es': 'ES',
        'fr': 'FR',
        'de': 'DE',
        'it': 'IT',
        'ru': 'RU',
        'pt': 'PT-BR'
    },
    // OpenAI uses standard codes
    openai: {
        'auto': 'auto',
        'en': 'en',
        'ja': 'ja',
        'ko': 'ko',
        'zh': 'zh',
        'zh-TW': 'zh-Hant',
        'es': 'es',
        'fr': 'fr',
        'de': 'de',
        'it': 'it',
        'ru': 'ru',
        'pt': 'pt'
    }
};

// ==========================================
// STATE MANAGEMENT
// ==========================================

const state = {
    cache: new Map(),
    rateLimiters: new Map(),
    contextMemory: new Map(), // Context preservation across calls
    stats: {
        totalRequests: 0,
        cacheHits: 0,
        errors: 0,
        byEngine: {}
    },
    apiKeys: {
        deepl: null,
        openai: null
    },
    settings: { ...CONFIG.DEFAULTS }
};

// Initialize stats for each engine
Object.keys(ENGINES).forEach(engine => {
    state.stats.byEngine[engine] = {
        requests: 0,
        errors: 0,
        avgLatency: 0
    };
});

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Generate cache key for translation
 */
function generateCacheKey(text, sourceLang, targetLang, engine, context) {
    const normalized = text.trim().toLowerCase().substring(0, 100);
    const contextHash = context ? hashString(context) : '0';
    return `${engine}:${sourceLang}:${targetLang}:${contextHash}:${normalized}`;
}

/**
 * Simple hash function for strings
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

/**
 * Rate limiter implementation
 */
class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }
    
    canProceed() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        return this.requests.length < this.maxRequests;
    }
    
    async waitForSlot() {
        while (!this.canProceed()) {
            await sleep(100);
        }
        this.requests.push(Date.now());
    }
}

/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff
 */
function getBackoffDelay(attempt) {
    const delay = Math.min(
        CONFIG.RETRY.backoffMs * Math.pow(2, attempt),
        CONFIG.RETRY.maxBackoffMs
    );
    return delay + Math.random() * 1000; // Add jitter
}

/**
 * Update rate limiter for engine
 */
function getRateLimiter(engine) {
    if (!state.rateLimiters.has(engine)) {
        const limit = CONFIG.RATE_LIMITS[engine] || 60;
        state.rateLimiters.set(engine, new RateLimiter(limit, 60000));
    }
    return state.rateLimiters.get(engine);
}

// ==========================================
// CACHE MANAGEMENT
// ==========================================

const CacheManager = {
    /**
     * Get cached translation
     */
    get(key) {
        const entry = state.cache.get(key);
        if (!entry) return null;
        
        // Check TTL
        if (Date.now() - entry.timestamp > CONFIG.CACHE.ttl) {
            state.cache.delete(key);
            return null;
        }
        
        state.stats.cacheHits++;
        return entry.data;
    },
    
    /**
     * Store translation in cache
     */
    set(key, data) {
        // Enforce max size (LRU eviction)
        if (state.cache.size >= CONFIG.CACHE.maxSize) {
            const firstKey = state.cache.keys().next().value;
            state.cache.delete(firstKey);
        }
        
        state.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    },
    
    /**
     * Clear expired entries
     */
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of state.cache.entries()) {
            if (now - entry.timestamp > CONFIG.CACHE.ttl) {
                state.cache.delete(key);
            }
        }
    },
    
    /**
     * Get cache stats
     */
    getStats() {
        return {
            size: state.cache.size,
            hitRate: state.stats.totalRequests > 0 
                ? (state.stats.cacheHits / state.stats.totalRequests * 100).toFixed(2) + '%'
                : '0%'
        };
    }
};

// ==========================================
// CONTEXT PRESERVATION
// ==========================================

const ContextManager = {
    /**
     * Store context for manga series/page
     */
    setContext(id, context) {
        state.contextMemory.set(id, {
            ...context,
            lastUpdated: Date.now()
        });
        
        // Cleanup old contexts
        this.cleanup();
    },
    
    /**
     * Get context for series/page
     */
    getContext(id) {
        const ctx = state.contextMemory.get(id);
        if (!ctx) return null;
        
        // Context expires after 30 minutes of inactivity
        if (Date.now() - ctx.lastUpdated > 30 * 60 * 1000) {
            state.contextMemory.delete(id);
            return null;
        }
        
        return ctx;
    },
    
    /**
     * Build context prompt for translation
     */
    buildContextPrompt(context, currentText) {
        if (!context || !context.previousLines || context.previousLines.length === 0) {
            return '';
        }
        
        const recentLines = context.previousLines.slice(-3);
        return `Previous context:\n${recentLines.join('\n')}\n\nCurrent text to translate:\n${currentText}`;
    },
    
    /**
     * Cleanup old contexts
     */
    cleanup() {
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [id, ctx] of state.contextMemory.entries()) {
            if (ctx.lastUpdated < cutoff) {
                state.contextMemory.delete(id);
            }
        }
    }
};

// ==========================================
// TRANSLATION ENGINES
// ==========================================

/**
 * Google Translate (Free, no API key required)
 */
const GoogleTranslate = {
    async translate(text, sourceLang, targetLang, options = {}) {
        const url = new URL(CONFIG.ENDPOINTS.GOOGLE_TRANSLATE);
        url.searchParams.append('client', 'gtx');
        url.searchParams.append('sl', LANG_CODES.google[sourceLang] || 'auto');
        url.searchParams.append('tl', LANG_CODES.google[targetLang] || 'en');
        url.searchParams.append('dt', 't');
        url.searchParams.append('dt', 'bd');
        url.searchParams.append('dj', '1');
        url.searchParams.append('q', text);
        
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Google Translate HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Extract translated text
        let translatedText = '';
        if (data.sentences) {
            translatedText = data.sentences.map(s => s.trans).join('');
        }
        
        return {
            text: translatedText,
            detectedLang: data.src || sourceLang,
            confidence: data.confidence || 1,
            alternatives: data.dict?.[0]?.terms || [],
            engine: 'google'
        };
    }
};

/**
 * DeepL Translator
 */
const DeepLTranslate = {
    async translate(text, sourceLang, targetLang, options = {}) {
        if (!state.apiKeys.deepl) {
            throw new Error('DeepL API key not configured');
        }
        
        const isPro = state.apiKeys.deepl.endsWith(':fx');
        const endpoint = isPro ? CONFIG.ENDPOINTS.DEEPL_PRO_API : CONFIG.ENDPOINTS.DEEPL_API;
        
        const body = new URLSearchParams({
            text: text,
            target_lang: LANG_CODES.deepl[targetLang] || 'EN',
            ...(sourceLang !== 'auto' && { source_lang: LANG_CODES.deepl[sourceLang] }),
            preserve_formatting: '1',
            tag_handling: 'html'
        });
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${state.apiKeys.deepl}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`DeepL Error: ${error.message || response.statusText}`);
        }
        
        const data = await response.json();
        const translation = data.translations[0];
        
        return {
            text: translation.text,
            detectedLang: translation.detected_source_language?.toLowerCase() || sourceLang,
            confidence: 1,
            alternatives: [],
            engine: 'deepl'
        };
    }
};

/**
 * OpenAI GPT-4 Translator (with vision support)
 */
const OpenAITranslate = {
    async translate(text, sourceLang, targetLang, options = {}) {
        if (!state.apiKeys.openai) {
            throw new Error('OpenAI API key not configured');
        }
        
        const isVision = options.imageData || options.useVision;
        const model = isVision ? 'gpt-4-vision-preview' : 'gpt-4-turbo-preview';
        
        // Build system prompt for manga translation
        const systemPrompt = this.buildSystemPrompt(sourceLang, targetLang, options);
        
        const messages = [
            {
                role: 'system',
                content: systemPrompt
            }
        ];
        
        // Add context if available
        if (options.context) {
            messages.push({
                role: 'user',
                content: `Context from previous panels:\n${options.context}`
            });
        }
        
        // Add main translation request
        const userContent = [];
        
        if (isVision && options.imageData) {
            userContent.push({
                type: 'image_url',
                image_url: {
                    url: options.imageData,
                    detail: 'high'
                }
            });
        }
        
        userContent.push({
            type: 'text',
            text: `Translate this manga text from ${sourceLang} to ${targetLang}:\n\n${text}`
        });
        
        messages.push({
            role: 'user',
            content: userContent
        });
        
        const response = await fetch(CONFIG.ENDPOINTS.OPENAI_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.apiKeys.openai}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.3,
                max_tokens: 2000
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`OpenAI Error: ${error.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        const translatedText = data.choices[0].message.content;
        
        return {
            text: this.cleanResponse(translatedText),
            detectedLang: sourceLang,
            confidence: 1,
            alternatives: [],
            engine: 'openai',
            tokensUsed: data.usage?.total_tokens
        };
    },
    
    buildSystemPrompt(sourceLang, targetLang, options) {
        let prompt = `You are a professional manga translator. Translate the given text from ${sourceLang} to ${targetLang}.
Rules:
- Preserve the tone and style of the original (casual, formal, slang, etc.)
- Keep character voice consistent
- Translate sound effects (SFX) appropriately for the target language culture`;
        
        if (options.honorifics && targetLang === 'en') {
            prompt += '\n- Preserve Japanese honorifics (-san, -kun, -chan, -sama) in the translation';
        }
        
        if (options.sfxTranslation) {
            prompt += '\n- Translate sound effects creatively (e.g., "ドキドキ" → "Ba-dump" for heartbeat)';
        }
        
        prompt += '\nReturn only the translated text without explanations or notes.';
        
        return prompt;
    },
    
    cleanResponse(text) {
        // Remove common prefixes that GPT might add
        return text
            .replace(/^(Translation:|Translated text:|Here is the translation:)\s*/i, '')
            .replace(/^["']|["']$/g, '')
            .trim();
    }
};

/**
 * Local LLM (placeholder for future implementation)
 */
const LocalLLM = {
    async translate(text, sourceLang, targetLang, options = {}) {
        // This would connect to a local LLM server (e.g., via Ollama, llama.cpp)
        throw new Error('Local LLM not yet implemented');
    }
};

// ==========================================
// HONORIFICS & SFX HANDLING
// ==========================================

const TextProcessor = {
    /**
     * Handle Japanese honorifics preservation
     */
    processHonorifics(text, options) {
        if (!options.honorifics) return text;
        
        const honorifics = ['san', 'kun', 'chan', 'sama', 'sensei', 'senpai', 'kouhai'];
        const pattern = new RegExp(`(-(${honorifics.join('|')}))`, 'gi');
        
        // In a real implementation, this would be more sophisticated
        // handling attachment to names and context
        return text;
    },
    
    /**
     * Translate sound effects
     */
    translateSFX(text, targetLang) {
        const sfxMap = {
            'ja': {
                'ドキドキ': { en: 'Ba-dump ba-dump', description: 'heartbeat' },
                'ガン': { en: 'BANG', description: 'impact' },
                'ザザ': { en: 'Rustle rustle', description: 'movement' },
                'ニヤリ': { en: '*grin*', description: 'smirk' },
                'ムカ': { en: 'Boiling anger', description: 'anger' },
                'ゴク': { en: '*gulp*', description: 'swallowing' }
            }
        };
        
        // Simple replacement for known SFX
        let result = text;
        const langSFX = sfxMap['ja'] || {};
        
        for (const [sfx, translation] of Object.entries(langSFX)) {
            if (text.includes(sfx)) {
                result = result.replace(sfx, translation[targetLang] || translation.en);
            }
        }
        
        return result;
    },
    
    /**
     * Post-process translation based on options
     */
    postProcess(translation, options) {
        let text = translation.text;
        
        if (options.honorifics) {
            text = this.processHonorifics(text, options);
        }
        
        if (options.sfxTranslation) {
            text = this.translateSFX(text, options.targetLang);
        }
        
        return { ...translation, text };
    }
};

// ==========================================
// MAIN TRANSLATION API
// ==========================================

const TranslationBridge = {
    /**
     * Initialize the bridge with settings
     */
    async initialize(settings) {
        state.settings = { ...CONFIG.DEFAULTS, ...settings };
        
        if (settings.apiKeys) {
            state.apiKeys = { ...state.apiKeys, ...settings.apiKeys };
        }
        
        // Periodic cache cleanup
        setInterval(() => CacheManager.cleanup(), 5 * 60 * 1000);
        
        console.log('Translation Bridge initialized');
        return true;
    },
    
    /**
     * Main translate method
     */
    async translate(request) {
        const startTime = performance.now();
        const {
            text,
            sourceLang = state.settings.sourceLang,
            targetLang = state.settings.targetLang,
            engine = state.settings.engine,
            context,
            options = {}
        } = request;
        
        // Validate
        if (!text || text.trim().length === 0) {
            throw new Error('Empty text provided');
        }
        
        if (!ENGINES[engine]) {
            throw new Error(`Unknown engine: ${engine}`);
        }
        
        // Merge options with defaults
        const opts = { ...state.settings, ...options };
        
        // Check cache
        const cacheKey = generateCacheKey(text, sourceLang, targetLang, engine, context);
        const cached = CacheManager.get(cacheKey);
        if (cached && !opts.skipCache) {
            return { ...cached, cached: true };
        }
        
        // Rate limiting
        const limiter = getRateLimiter(engine);
        await limiter.waitForSlot();
        
        // Execute translation with retry logic
        let lastError;
        for (let attempt = 0; attempt < CONFIG.RETRY.maxAttempts; attempt++) {
            try {
                const result = await this.executeTranslate(
                    text, sourceLang, targetLang, engine, context, opts
                );
                
                // Update stats
                const duration = performance.now() - startTime;
                this.updateStats(engine, duration);
                
                // Post-process
                const processed = TextProcessor.postProcess(result, opts);
                
                // Cache result
                CacheManager.set(cacheKey, processed);
                
                return processed;
                
            } catch (error) {
                lastError = error;
                state.stats.errors++;
                state.stats.byEngine[engine].errors++;
                
                if (attempt < CONFIG.RETRY.maxAttempts - 1) {
                    const delay = getBackoffDelay(attempt);
                    console.warn(`Translation attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                    await sleep(delay);
                }
            }
        }
        
        throw lastError || new Error('Translation failed after retries');
    },
    
    /**
     * Execute translation with specific engine
     */
    async executeTranslate(text, sourceLang, targetLang, engine, context, options) {
        // Get context if provided
        let contextPrompt = '';
        if (options.preserveContext && context) {
            const ctxData = ContextManager.getContext(context.id);
            contextPrompt = ContextManager.buildContextPrompt(ctxData, text);
        }
        
        const translateOptions = {
            ...options,
            context: contextPrompt
        };
        
        switch (engine) {
            case 'google':
                return await GoogleTranslate.translate(text, sourceLang, targetLang, translateOptions);
            case 'deepl':
                return await DeepLTranslate.translate(text, sourceLang, targetLang, translateOptions);
            case 'openai':
                return await OpenAITranslate.translate(text, sourceLang, targetLang, translateOptions);
            case 'local':
                return await LocalLLM.translate(text, sourceLang, targetLang, translateOptions);
            default:
                throw new Error(`Engine ${engine} not implemented`);
        }
    },
    
    /**
     * Batch translate multiple texts
     */
    async translateBatch(requests, options = {}) {
        const results = [];
        const concurrency = options.concurrency || 3;
        
        // Process in chunks to limit concurrency
        for (let i = 0; i < requests.length; i += concurrency) {
            const chunk = requests.slice(i, i + concurrency);
            const promises = chunk.map(req => 
                this.translate({ ...req, options }).catch(err => ({
                    error: err.message,
                    text: req.text,
                    engine: req.engine
                }))
            );
            
            const chunkResults = await Promise.all(promises);
            results.push(...chunkResults);
        }
        
        return results;
    },
    
    /**
     * Detect language of text
     */
    async detectLanguage(text) {
        // Use Google Translate's auto-detection
        const result = await GoogleTranslate.translate(text, 'auto', 'en');
        return result.detectedLang;
    },
    
    /**
     * Update context for series/page
     */
    updateContext(id, lines) {
        ContextManager.setContext(id, {
            previousLines: lines,
            lastUpdated: Date.now()
        });
    },
    
    /**
     * Update statistics
     */
    updateStats(engine, duration) {
        state.stats.totalRequests++;
        const stats = state.stats.byEngine[engine];
        stats.requests++;
        stats.avgLatency = (stats.avgLatency * (stats.requests - 1) + duration) / stats.requests;
    },
    
    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...state.stats,
            cache: CacheManager.getStats(),
            contexts: state.contextMemory.size
        };
    },
    
    /**
     * Configure API keys
     */
    setApiKeys(keys) {
        state.apiKeys = { ...state.apiKeys, ...keys };
    },
    
    /**
     * Clear cache
     */
    clearCache() {
        state.cache.clear();
        console.log('Translation cache cleared');
    }
};

// ==========================================
// MESSAGE HANDLING
// ==========================================

const MessageHandler = {
    init() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true;
        });
        console.log('Translation Bridge message handler ready');
    },
    
    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.command) {
                case 'translate:init':
                    await TranslationBridge.initialize(message.settings);
                    sendResponse({ success: true });
                    break;
                    
                case 'translate:text':
                    const result = await TranslationBridge.translate(message.request);
                    sendResponse({ success: true, result });
                    break;
                    
                case 'translate:batch':
                    const results = await TranslationBridge.translateBatch(
                        message.requests, 
                        message.options
                    );
                    sendResponse({ success: true, results });
                    break;
                    
                case 'translate:detect':
                    const detected = await TranslationBridge.detectLanguage(message.text);
                    sendResponse({ success: true, language: detected });
                    break;
                    
                case 'translate:context':
                    TranslationBridge.updateContext(message.id, message.lines);
                    sendResponse({ success: true });
                    break;
                    
                case 'translate:stats':
                    sendResponse({ success: true, stats: TranslationBridge.getStats() });
                    break;
                    
                case 'translate:config':
                    if (message.apiKeys) {
                        TranslationBridge.setApiKeys(message.apiKeys);
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'translate:clear-cache':
                    TranslationBridge.clearCache();
                    sendResponse({ success: true });
                    break;
                    
                default:
                    sendResponse({ success: false, error: 'Unknown command' });
            }
        } catch (error) {
            console.error('Translation Bridge error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
};

// ==========================================
// INITIALIZATION
// ==========================================

function init() {
    MessageHandler.init();
    
    // Notify service worker we're ready
    chrome.runtime.sendMessage({
        target: 'service-worker',
        type: 'bridge:ready',
        timestamp: Date.now()
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TranslationBridge, ENGINES, LANG_CODES };
}