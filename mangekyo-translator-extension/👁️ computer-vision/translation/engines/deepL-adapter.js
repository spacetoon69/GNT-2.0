/**
 * @fileoverview DeepL API Adapter for Mangekyo Extension
 * @module computer-vision/translation/engines/deepL-adapter
 * 
 * High-quality neural machine translation with:
 * - Superior Japanese/Asian language handling
 * - Formality level control (formal/informal)
 * - Glossary support for consistent terminology
 * - Smart context windowing for long texts
 * - Automatic script conversion (Kanji ↔ Romaji hints)
 */

import { CacheManager } from '../cache-manager.js';
import { HonorificsHandler } from '../honorifics-handler.js';
import { ContextPreserver } from '../context-preserver.js';
import { SFXTranslator } from '../sfx-translator.js';
import { CONFIG } from '../../../core/shared/constants.js';
import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

/**
 * DeepL API Configuration
 * @constant {Object}
 */
const DEEPL_CONFIG = {
  // Free API: api-free.deepl.com, Pro: api.deepl.com
  API_FREE_URL: 'https://api-free.deepl.com/v2',
  API_PRO_URL: 'https://api.deepl.com/v2',
  
  ENDPOINTS: {
    TRANSLATE: '/translate',
    USAGE: '/usage',
    LANGUAGES: '/languages',
    GLOSSARIES: '/glossaries'
  },
  
  LIMITS: {
    FREE: {
      MAX_CHARS_PER_REQUEST: 5000,
      MAX_CHARS_PER_MONTH: 500000
    },
    PRO: {
      MAX_CHARS_PER_REQUEST: 50000, // Higher for Pro
      MAX_CHARS_PER_MONTH: Infinity
    },
    MAX_TEXTS_PER_REQUEST: 50,
    RATE_LIMIT_PER_MINUTE: 60
  },
  
  TIMEOUT_MS: 30000,
  
  RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY_MS: 1000,
    MAX_DELAY_MS: 15000,
    RETRYABLE_STATUS: [429, 500, 502, 503, 504]
  }
};

/**
 * DeepL Language Code Mapping
 * DeepL uses different codes than standard ISO
 * @constant {Object}
 */
const DEEPL_LANG_CODES = {
  // Source languages
  'ja': 'JA',
  'en': 'EN',
  'zh': 'ZH',
  'zh-CN': 'ZH',
  'zh-TW': 'ZH-HANT',
  'ko': 'KO',
  'fr': 'FR',
  'de': 'DE',
  'es': 'ES',
  'it': 'IT',
  'pt': 'PT',
  'ru': 'RU',
  'pl': 'PL',
  'nl': 'NL',
  // Target languages (extended)
  'en-US': 'EN-US',
  'en-GB': 'EN-GB',
  'pt-BR': 'PT-BR',
  'pt-PT': 'PT-PT'
};

/**
 * Formality levels for supported languages
 * @constant {Array<string>}
 */
const FORMALITY_LANGUAGES = ['DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT', 'PT-BR', 'PT-PT', 'RU', 'JA'];

/**
 * Error types for DeepL operations
 * @enum {string}
 */
export const DeepLError = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  AUTH_FAILED: 'AUTH_FAILED',
  INVALID_LANG: 'INVALID_LANGUAGE',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  SERVER_ERROR: 'SERVER_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  CONNECTION_ERROR: 'CONNECTION_ERROR'
};

/**
 * DeepL Translation Engine
 * @class
 */
export class DeepLEngine {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.authKey - DeepL API authentication key
   * @param {boolean} options.isPro - Whether using Pro API (default: false)
   * @param {CacheManager} options.cacheManager - Cache instance
   * @param {boolean} options.preserveHonorifics - Keep Japanese honorifics
   * @param {boolean} options.useContext - Enable context preservation
   * @param {string} options.formality - 'default', 'more', 'less', 'prefer_more', 'prefer_less'
   * @param {string} options.glossaryId - Glossary ID for consistent terminology
   */
  constructor(options = {}) {
    this.authKey = options.authKey || null;
    this.isPro = options.isPro || false;
    this.baseUrl = this.isPro ? DEEPL_CONFIG.API_PRO_URL : DEEPL_CONFIG.API_FREE_URL;
    
    this.cacheManager = options.cacheManager || new CacheManager();
    this.honorificsHandler = options.preserveHonorifics !== false ? new HonorificsHandler() : null;
    this.contextPreserver = options.useContext !== false ? new ContextPreserver() : null;
    this.sfxTranslator = new SFXTranslator();
    this.performanceMonitor = new PerformanceMonitor('deepl-translate');
    
    this.formality = options.formality || 'default';
    this.glossaryId = options.glossaryId || null;
    
    // Rate limiting and quota tracking
    this.requestQueue = [];
    this.requestsThisMinute = 0;
    this.characterCount = {
      current: 0,
      limit: this.isPro ? DEEPL_CONFIG.LIMITS.PRO.MAX_CHARS_PER_MONTH : DEEPL_CONFIG.LIMITS.FREE.MAX_CHARS_PER_MONTH
    };
    this.lastResetTime = Date.now();
    
    this._initRateLimiting();
  }

  /**
   * Initialize rate limiting
   * @private
   */
  _initRateLimiting() {
    // Reset per-minute counter
    setInterval(() => {
      this.requestsThisMinute = 0;
      this.lastResetTime = Date.now();
    }, 60000);
  }

  /**
   * Get current API limits based on tier
   * @private
   * @returns {Object}
   */
  _getLimits() {
    return this.isPro ? DEEPL_CONFIG.LIMITS.PRO : DEEPL_CONFIG.LIMITS.FREE;
  }

  /**
   * Convert standard language code to DeepL format
   * @private
   * @param {string} code - ISO language code
   * @param {boolean} isTarget - Whether this is a target language
   * @returns {string} DeepL language code
   */
  _toDeepLLangCode(code, isTarget = false) {
    if (!code) return isTarget ? 'EN-US' : 'JA';
    
    const normalized = code.toLowerCase().trim();
    
    // Handle special cases
    if (isTarget) {
      if (normalized === 'en') return 'EN-US'; // Default to American English
      if (normalized === 'pt') return 'PT-BR'; // Default to Brazilian Portuguese
      if (normalized === 'zh') return 'ZH-HANS';
    }
    
    return DEEPL_LANG_CODES[normalized] || normalized.toUpperCase();
  }

  /**
   * Enforce rate limits and quotas
   * @private
   * @param {number} charCount - Characters in current request
   * @returns {Promise<void>}
   */
  async _enforceLimits(charCount) {
    // Check character quota
    if (this.characterCount.current + charCount > this.characterCount.limit) {
      throw new Error(DeepLError.QUOTA_EXCEEDED);
    }
    
    // Per-minute rate limit
    if (this.requestsThisMinute >= DEEPL_CONFIG.LIMITS.RATE_LIMIT_PER_MINUTE) {
      const waitTime = 60000 - (Date.now() - this.lastResetTime);
      if (waitTime > 0) {
        console.warn(`[DeepL] Rate limit reached. Waiting ${waitTime}ms`);
        await this._sleep(waitTime);
        this.requestsThisMinute = 0;
      }
    }
    
    this.requestsThisMinute++;
  }

  /**
   * Sleep utility
   * @private
   * @param {number} ms 
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate retry delay with exponential backoff
   * @private
   * @param {number} attempt 
   * @returns {number}
   */
  _getRetryDelay(attempt) {
    const delay = Math.min(
      DEEPL_CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt),
      DEEPL_CONFIG.RETRY.MAX_DELAY_MS
    );
    return delay + Math.random() * 1000; // Jitter
  }

  /**
   * Preprocess text for DeepL optimization
   * @private
   * @param {string} text 
   * @param {string} sourceLang 
   * @returns {Object}
   */
  _preprocessText(text, sourceLang) {
    if (!text || typeof text !== 'string') {
      return { text: '', markers: [], metadata: {} };
    }

    let processed = text;
    const markers = [];
    const metadata = {
      originalLength: text.length,
      hadHonorifics: false,
      sfxDetected: false
    };

    // Handle SFX (sound effects) preservation
    const sfxResult = this.sfxTranslator.identify(processed);
    if (sfxResult.isSFX) {
      processed = sfxResult.placeholder;
      markers.push({
        type: 'sfx',
        original: sfxResult.original,
        placeholder: sfxResult.placeholder,
        category: sfxResult.category
      });
      metadata.sfxDetected = true;
    }

    // Extract honorifics for Japanese
    if (this.honorificsHandler && sourceLang === 'ja') {
      const honorificResult = this.honorificsHandler.extract(processed);
      processed = honorificResult.text;
      markers.push(...honorificResult.markers);
      metadata.hadHonorifics = honorificResult.markers.length > 0;
    }

    // Context preservation for narrative continuity
    if (this.contextPreserver) {
      const contextResult = this.contextPreserver.markContext(processed);
      processed = contextResult.text;
      markers.push(...contextResult.markers);
    }

    // DeepL-specific: Handle long texts by splitting intelligently
    const limits = this._getLimits();
    if (processed.length > limits.MAX_CHARS_PER_REQUEST) {
      console.warn(`[DeepL] Text exceeds limit, splitting ${processed.length} chars`);
      // Split at sentence boundaries
      const chunks = this._splitAtSentences(processed, limits.MAX_CHARS_PER_REQUEST);
      metadata.chunks = chunks;
    }

    return { text: processed, markers, metadata };
  }

  /**
   * Split text at sentence boundaries without breaking context
   * @private
   * @param {string} text 
   * @param {number} maxLength 
   * @returns {Array<string>}
   */
  _splitAtSentences(text, maxLength) {
    const sentences = text.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [text];
    const chunks = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxLength && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }
    
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks.length > 0 ? chunks : [text.substring(0, maxLength)];
  }

  /**
   * Postprocess translated text
   * @private
   * @param {string} text 
   * @param {Array} markers 
   * @param {string} targetLang 
   * @returns {string}
   */
  _postprocessText(text, markers, targetLang) {
    let processed = text;

    // Restore context markers
    if (this.contextPreserver) {
      processed = this.contextPreserver.restoreContext(processed, markers);
    }

    // Restore honorifics with appropriate target language adaptation
    if (this.honorificsHandler && markers.some(m => m.type === 'honorific')) {
      processed = this.honorificsHandler.restore(processed, markers, targetLang);
    }

    // Restore SFX with translated equivalents
    const sfxMarkers = markers.filter(m => m.type === 'sfx');
    for (const marker of sfxMarkers) {
      const translatedSFX = this.sfxTranslator.translate(marker.original, targetLang);
      processed = processed.replace(marker.placeholder, translatedSFX);
    }

    // DeepL-specific cleanups
    processed = processed
      .replace(/\s+/g, ' ')
      .replace(/([.!?])\s+/g, '$1 ')
      .replace(/\s+([.!?])/g, '$1')
      .trim();

    return processed;
  }

  /**
   * Make authenticated request to DeepL API
   * @private
   * @param {string} endpoint 
   * @param {Object} params 
   * @param {number} attempt 
   * @returns {Promise<Object>}
   */
  async _makeRequest(endpoint, params, attempt = 0) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    // DeepL uses form-urlencoded for most endpoints
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        body.append(key, value);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEEPL_CONFIG.TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.authKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: body.toString(),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle rate limiting (429) with retry
      if (response.status === 429) {
        if (attempt < DEEPL_CONFIG.RETRY.MAX_ATTEMPTS) {
          const delay = this._getRetryDelay(attempt);
          console.warn(`[DeepL] Rate limited, retrying in ${delay}ms`);
          await this._sleep(delay);
          return this._makeRequest(endpoint, params, attempt + 1);
        }
        throw new Error(DeepLError.RATE_LIMITED);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.message || `HTTP ${response.status}`;
        
        if (response.status === 403) throw new Error(DeepLError.AUTH_FAILED);
        if (response.status === 456) throw new Error(DeepLError.QUOTA_EXCEEDED);
        if (response.status === 400 && message.includes('language')) {
          throw new Error(DeepLError.INVALID_LANG);
        }
        if (response.status === 413) throw new Error(DeepLError.TEXT_TOO_LONG);
        
        // Retryable server errors
        if (DEEPL_CONFIG.RETRY.RETRYABLE_STATUS.includes(response.status)) {
          if (attempt < DEEPL_CONFIG.RETRY.MAX_ATTEMPTS) {
            const delay = this._getRetryDelay(attempt);
            await this._sleep(delay);
            return this._makeRequest(endpoint, params, attempt + 1);
          }
        }
        
        throw new Error(`${DeepLError.SERVER_ERROR}: ${message}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        if (attempt < DEEPL_CONFIG.RETRY.MAX_ATTEMPTS) {
          return this._makeRequest(endpoint, params, attempt + 1);
        }
        throw new Error(DeepLError.CONNECTION_ERROR);
      }
      
      throw error;
    }
  }

  /**
   * Translate single text
   * @param {string} text 
   * @param {Object} options 
   * @returns {Promise<Object>}
   */
  async translate(text, options = {}) {
    const startTime = performance.now();
    const {
      sourceLang = 'auto',
      targetLang = 'en',
      useCache = true,
      formality = this.formality,
      glossaryId = this.glossaryId
    } = options;

    if (!text || !text.trim()) {
      return { text: '', detectedLanguage: sourceLang, confidence: 0 };
    }

    // Check cache
    if (useCache && this.cacheManager) {
      const cached = await this.cacheManager.get('translation', {
        text,
        source: sourceLang,
        target: targetLang,
        engine: 'deepl',
        formality
      });
      
      if (cached) {
        this.performanceMonitor.record('cache_hit', performance.now() - startTime);
        return { ...cached, fromCache: true };
      }
    }

    // Preprocess
    const { text: processedText, markers, metadata } = this._preprocessText(text, sourceLang);
    
    // Handle chunked text
    if (metadata.chunks) {
      return this._translateChunked(metadata.chunks, options, markers, metadata, startTime);
    }

    await this._enforceLimits(processedText.length);

    try {
      const params = {
        text: processedText,
        target_lang: this._toDeepLLangCode(targetLang, true),
        source_lang: sourceLang !== 'auto' ? this._toDeepLLangCode(sourceLang) : undefined,
        split_sentences: '1', // DeepL handles sentence splitting
        preserve_formatting: '1',
        tag_handling: 'xml', // Enable XML tag handling for markers
        formality: FORMALITY_LANGUAGES.includes(this._toDeepLLangCode(targetLang, true)) ? formality : undefined,
        glossary_id: glossaryId
      };

      const data = await this._makeRequest(DEEPL_CONFIG.ENDPOINTS.TRANSLATE, params);
      
      if (!data.translations || data.translations.length === 0) {
        throw new Error('Empty translation response');
      }

      const translation = data.translations[0];
      let translatedText = translation.text;
      const detectedSource = translation.detected_source_language || sourceLang;

      // Update character count
      this.characterCount.current += text.length;

      // Postprocess
      translatedText = this._postprocessText(translatedText, markers, targetLang);

      const result = {
        text: translatedText,
        originalText: text,
        detectedLanguage: detectedSource.toLowerCase(),
        confidence: 0.98, // DeepL doesn't provide confidence, use high default
        engine: 'deepl',
        billedCharacters: translation.billed_characters || text.length,
        formality: formality,
        timestamp: Date.now()
      };

      // Cache
      if (useCache && this.cacheManager) {
        await this.cacheManager.set('translation', {
          text,
          source: sourceLang,
          target: targetLang,
          engine: 'deepl',
          formality
        }, result);
      }

      this.performanceMonitor.record('translation_success', performance.now() - startTime);
      return result;

    } catch (error) {
      this.performanceMonitor.record('translation_error', performance.now() - startTime);
      console.error('[DeepL] Translation failed:', error);
      throw error;
    }
  }

  /**
   * Handle chunked translation for long texts
   * @private
   * @param {Array<string>} chunks 
   * @param {Object} options 
   * @param {Array} markers 
   * @param {Object} metadata 
   * @param {number} startTime 
   * @returns {Promise<Object>}
   */
  async _translateChunked(chunks, options, markers, metadata, startTime) {
    const results = [];
    let totalBilled = 0;

    for (const chunk of chunks) {
      const chunkResult = await this.translate(chunk, { ...options, useCache: false });
      results.push(chunkResult.text);
      totalBilled += chunkResult.billedCharacters || chunk.length;
    }

    const combinedText = results.join(' ');
    
    return {
      text: this._postprocessText(combinedText, markers, options.targetLang),
      originalText: metadata.originalText,
      detectedLanguage: results[0]?.detectedLanguage || options.sourceLang,
      confidence: 0.95,
      engine: 'deepl',
      billedCharacters: totalBilled,
      chunked: true,
      timestamp: Date.now()
    };
  }

  /**
   * Translate multiple texts (batch)
   * @param {Array<string>} texts 
   * @param {Object} options 
   * @returns {Promise<Array<Object>>}
   */
  async translateBatch(texts, options = {}) {
    const startTime = performance.now();
    const {
      sourceLang = 'auto',
      targetLang = 'en',
      useCache = true,
      formality = this.formality
    } = options;

    if (!Array.isArray(texts) || texts.length === 0) return [];

    // DeepL supports up to 50 texts per request
    const results = new Array(texts.length).fill(null);
    const toTranslate = [];
    const preprocessData = [];

    // Check cache and preprocess
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      
      if (!text || !text.trim()) {
        results[i] = { text: '', detectedLanguage: sourceLang, confidence: 0 };
        continue;
      }

      if (useCache && this.cacheManager) {
        const cached = await this.cacheManager.get('translation', {
          text,
          source: sourceLang,
          target: targetLang,
          engine: 'deepl',
          formality
        });
        
        if (cached) {
          results[i] = { ...cached, fromCache: true };
          continue;
        }
      }

      const processed = this._preprocessText(text, sourceLang);
      preprocessData[i] = processed;
      toTranslate.push({ index: i, text: processed.text, original: text });
    }

    if (toTranslate.length === 0) return results;

    // Process in chunks of 50
    const chunks = [];
    for (let i = 0; i < toTranslate.length; i += DEEPL_CONFIG.LIMITS.MAX_TEXTS_PER_REQUEST) {
      chunks.push(toTranslate.slice(i, i + DEEPL_CONFIG.LIMITS.MAX_TEXTS_PER_REQUEST));
    }

    for (const chunk of chunks) {
      const totalChars = chunk.reduce((sum, item) => sum + item.text.length, 0);
      await this._enforceLimits(totalChars);

      try {
        const params = {
          target_lang: this._toDeepLLangCode(targetLang, true),
          source_lang: sourceLang !== 'auto' ? this._toDeepLLangCode(sourceLang) : undefined,
          split_sentences: '1',
          preserve_formatting: '1',
          formality: FORMALITY_LANGUAGES.includes(this._toDeepLLangCode(targetLang, true)) ? formality : undefined
        };

        // DeepL accepts multiple text parameters
        chunk.forEach((item, idx) => {
          params[`text[${idx}]`] = item.text;
        });

        const data = await this._makeRequest(DEEPL_CONFIG.ENDPOINTS.TRANSLATE, params);
        
        this.characterCount.current += totalChars;

        for (let i = 0; i < data.translations.length; i++) {
          const { index, original } = chunk[i];
          const translation = data.translations[i];
          
          let translatedText = translation.text;
          const detectedSource = translation.detected_source_language || sourceLang;

          translatedText = this._postprocessText(
            translatedText,
            preprocessData[index].markers,
            targetLang
          );

          const result = {
            text: translatedText,
            originalText: original,
            detectedLanguage: detectedSource.toLowerCase(),
            confidence: 0.98,
            engine: 'deepl',
            billedCharacters: translation.billed_characters || original.length,
            timestamp: Date.now()
          };

          results[index] = result;

          if (useCache && this.cacheManager) {
            await this.cacheManager.set('translation', {
              text: original,
              source: sourceLang,
              target: targetLang,
              engine: 'deepl',
              formality
            }, result);
          }
        }

      } catch (error) {
        console.error('[DeepL] Batch chunk failed:', error);
        
        for (const item of chunk) {
          if (!results[item.index]) {
            results[item.index] = {
              text: '[Translation Failed]',
              originalText: item.original,
              error: error.message,
              engine: 'deepl'
            };
          }
        }
      }
    }

    this.performanceMonitor.record('batch_translation', performance.now() - startTime);
    return results;
  }

  /**
   * Get current usage statistics
   * @returns {Promise<Object>}
   */
  async getUsage() {
    try {
      const data = await this._makeRequest(DEEPL_CONFIG.ENDPOINTS.USAGE, {});
      return {
        characterCount: data.character_count,
        characterLimit: data.character_limit,
        utilizationPercent: (data.character_count / data.character_limit) * 100,
        remaining: data.character_limit - data.character_count
      };
    } catch (error) {
      console.error('[DeepL] Failed to get usage:', error);
      return {
        characterCount: this.characterCount.current,
        characterLimit: this.characterCount.limit,
        utilizationPercent: (this.characterCount.current / this.characterCount.limit) * 100,
        error: error.message
      };
    }
  }

  /**
   * Get supported languages
   * @param {string} type - 'source' or 'target'
   * @returns {Promise<Array<Object>>}
   */
  async getSupportedLanguages(type = 'target') {
    try {
      const params = { type };
      const data = await this._makeRequest(DEEPL_CONFIG.ENDPOINTS.LANGUAGES, params);
      return data.map(lang => ({
        code: lang.language.toLowerCase(),
        name: lang.name,
        supportsFormality: lang.supports_formality
      }));
    } catch (error) {
      console.error('[DeepL] Failed to get languages:', error);
      // Fallback for manga
      return type === 'source' 
        ? [
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'zh', name: 'Chinese' },
            { code: 'en', name: 'English' }
          ]
        : [
            { code: 'en-us', name: 'English (American)' },
            { code: 'en-gb', name: 'English (British)' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'zh-hans', name: 'Chinese (Simplified)' },
            { code: 'zh-hant', name: 'Chinese (Traditional)' }
          ];
    }
  }

  /**
   * Create or update glossary for consistent terminology
   * @param {string} name 
   * @param {Array<{source: string, target: string}>} entries 
   * @param {string} sourceLang 
   * @param {string} targetLang 
   * @returns {Promise<Object>}
   */
  async createGlossary(name, entries, sourceLang, targetLang) {
    const tsv = entries.map(e => `${e.source}\t${e.target}`).join('\n');
    
    const params = {
      name,
      source_lang: this._toDeepLLangCode(sourceLang),
      target_lang: this._toDeepLLangCode(targetLang, true),
      entries: tsv,
      entries_format: 'tsv'
    };

    try {
      const data = await this._makeRequest(DEEPL_CONFIG.ENDPOINTS.GLOSSARIES, params);
      this.glossaryId = data.glossary_id;
      return {
        id: data.glossary_id,
        name: data.name,
        ready: data.ready,
        entryCount: data.entry_count
      };
    } catch (error) {
      console.error('[DeepL] Failed to create glossary:', error);
      throw error;
    }
  }

  /**
   * Update configuration
   * @param {Object} config 
   */
  updateConfig(config) {
    if (config.authKey) {
      this.authKey = config.authKey;
      // Detect Pro vs Free from key suffix
      this.isPro = config.authKey.endsWith(':fx') ? false : true;
      this.baseUrl = this.isPro ? DEEPL_CONFIG.API_PRO_URL : DEEPL_CONFIG.API_FREE_URL;
    }
    if (config.formality) this.formality = config.formality;
    if (config.glossaryId) this.glossaryId = config.glossaryId;
    if (config.isPro !== undefined) {
      this.isPro = config.isPro;
      this.baseUrl = this.isPro ? DEEPL_CONFIG.API_PRO_URL : DEEPL_CONFIG.API_FREE_URL;
    }
  }

  /**
   * Get quota status
   * @returns {Object}
   */
  getQuotaStatus() {
    return {
      requestsThisMinute: this.requestsThisMinute,
      characterCount: this.characterCount.current,
      characterLimit: this.characterCount.limit,
      utilizationPercent: (this.characterCount.current / this.characterCount.limit) * 100,
      isPro: this.isPro
    };
  }

  /**
   * Health check
   * @returns {Promise<Object>}
   */
  async healthCheck() {
    try {
      const start = Date.now();
      const result = await this.translate('hello', {
        sourceLang: 'en',
        targetLang: 'ja',
        useCache: false
      });
      
      const usage = await this.getUsage().catch(() => null);
      
      return {
        status: 'healthy',
        latency: Date.now() - start,
        quota: usage || this.getQuotaStatus(),
        isPro: this.isPro
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        quota: this.getQuotaStatus()
      };
    }
  }
}

// Singleton instance
export const deepLAdapter = new DeepLEngine();

export default DeepLEngine;