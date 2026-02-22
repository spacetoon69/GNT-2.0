/**
 * @fileoverview Google Translate API Adapter for Mangekyo Extension
 * @module computer-vision/translation/engines/google-translate
 * 
 * Provides translation services using Google's Cloud Translation API with:
 * - Smart rate limiting and quota management
 * - Automatic retry with exponential backoff
 * - Integration with extension cache manager
 * - Honorifics preservation for Japanese content
 * - Context-aware batching
 */

import { CacheManager } from '../cache-manager.js';
import { HonorificsHandler } from '../honorifics-handler.js';
import { ContextPreserver } from '../context-preserver.js';
import { CONFIG } from '../../../core/shared/constants.js';
import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

/**
 * Google Translate Engine Configuration
 * @constant {Object}
 */
const GOOGLE_CONFIG = {
  API_BASE_URL: 'https://translation.googleapis.com/language/translate/v2',
  BATCH_SIZE: 128, // Max 128 strings per request
  MAX_TEXT_LENGTH: 5000, // Google Translate limit per text
  RATE_LIMIT: {
    REQUESTS_PER_MINUTE: 60,
    REQUESTS_PER_DAY: 500000, // Free tier: 500k chars/day, paid: unlimited
    COOLDOWN_MS: 1000
  },
  RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY_MS: 1000,
    MAX_DELAY_MS: 10000
  },
  TIMEOUT_MS: 30000
};

/**
 * Error types for Google Translate operations
 * @enum {string}
 */
export const GoogleTranslateError = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_RESPONSE: 'INVALID_RESPONSE'
};

/**
 * Google Translate Engine
 * @class
 */
export class GoogleTranslateEngine {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiKey - Google Cloud API key
   * @param {CacheManager} options.cacheManager - Cache instance
   * @param {boolean} options.preserveHonorifics - Keep Japanese honorifics
   * @param {boolean} options.useContext - Enable context preservation
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.cacheManager = options.cacheManager || new CacheManager();
    this.honorificsHandler = options.preserveHonorifics !== false ? new HonorificsHandler() : null;
    this.contextPreserver = options.useContext !== false ? new ContextPreserver() : null;
    this.performanceMonitor = new PerformanceMonitor('google-translate');
    
    // Rate limiting state
    this.requestQueue = [];
    this.requestsThisMinute = 0;
    this.requestsToday = 0;
    this.lastRequestTime = 0;
    this.lastResetTime = Date.now();
    
    // Initialize rate limit reset intervals
    this._initRateLimiting();
  }

  /**
   * Initialize rate limiting timers
   * @private
   */
  _initRateLimiting() {
    // Reset per-minute counter every minute
    setInterval(() => {
      this.requestsThisMinute = 0;
      this.lastResetTime = Date.now();
    }, 60000);

    // Reset daily counter at midnight
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
      this.requestsToday = 0;
      setInterval(() => {
        this.requestsToday = 0;
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * Check and enforce rate limits
   * @private
   * @returns {Promise<void>}
   */
  async _enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Per-minute limit
    if (this.requestsThisMinute >= GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_MINUTE) {
      const waitTime = 60000 - (now - this.lastResetTime);
      console.warn(`[GoogleTranslate] Rate limit approached. Waiting ${waitTime}ms`);
      await this._sleep(waitTime);
      this.requestsThisMinute = 0;
    }
    
    // Daily limit check (soft warning at 80%)
    if (this.requestsToday >= GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_DAY * 0.8) {
      console.warn(`[GoogleTranslate] Daily quota 80% consumed: ${this.requestsToday}`);
    }
    
    if (this.requestsToday >= GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_DAY) {
      throw new Error(GoogleTranslateError.QUOTA_EXCEEDED);
    }
    
    // Cooldown between requests
    if (timeSinceLastRequest < GOOGLE_CONFIG.RATE_LIMIT.COOLDOWN_MS) {
      await this._sleep(GOOGLE_CONFIG.RATE_LIMIT.COOLDOWN_MS - timeSinceLastRequest);
    }
    
    this.requestsThisMinute++;
    this.requestsToday++;
    this.lastRequestTime = Date.now();
  }

  /**
   * Sleep utility
   * @private
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate retry delay with exponential backoff
   * @private
   * @param {number} attempt - Current attempt number
   * @returns {number} Delay in milliseconds
   */
  _getRetryDelay(attempt) {
    const delay = Math.min(
      GOOGLE_CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt),
      GOOGLE_CONFIG.RETRY.MAX_DELAY_MS
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  /**
   * Preprocess text before translation
   * @private
   * @param {string} text - Original text
   * @param {string} sourceLang - Source language code
   * @returns {Object} Processed text and metadata
   */
  _preprocessText(text, sourceLang) {
    if (!text || typeof text !== 'string') {
      return { text: '', markers: [] };
    }

    let processedText = text;
    const markers = [];

    // Extract and preserve honorifics for Japanese
    if (this.honorificsHandler && sourceLang === 'ja') {
      const result = this.honorificsHandler.extract(processedText);
      processedText = result.text;
      markers.push(...result.markers);
    }

    // Handle context preservation for narrative flow
    if (this.contextPreserver) {
      const contextResult = this.contextPreserver.markContext(processedText);
      processedText = contextResult.text;
      markers.push(...contextResult.markers);
    }

    // Truncate if too long
    if (processedText.length > GOOGLE_CONFIG.MAX_TEXT_LENGTH) {
      console.warn(`[GoogleTranslate] Text truncated from ${processedText.length} chars`);
      processedText = processedText.substring(0, GOOGLE_CONFIG.MAX_TEXT_LENGTH);
    }

    return { text: processedText, markers, originalLength: text.length };
  }

  /**
   * Postprocess translated text
   * @private
   * @param {string} text - Translated text
   * @param {Array} markers - Preservation markers
   * @param {string} targetLang - Target language
   * @returns {string} Restored text
   */
  _postprocessText(text, markers, targetLang) {
    let processedText = text;

    // Restore context markers
    if (this.contextPreserver) {
      processedText = this.contextPreserver.restoreContext(processedText, markers);
    }

    // Restore honorifics
    if (this.honorificsHandler && markers.some(m => m.type === 'honorific')) {
      processedText = this.honorificsHandler.restore(processedText, markers);
    }

    // Clean up common OCR artifacts in manga context
    processedText = processedText
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/([.!?])\s+/g, '$1 ') // Fix spacing after punctuation
      .trim();

    return processedText;
  }

  /**
   * Make authenticated API request to Google Translate
   * @private
   * @param {Object} payload - Request payload
   * @param {number} attempt - Current retry attempt
   * @returns {Promise<Object>} API response
   */
  async _makeRequest(payload, attempt = 0) {
    await this._enforceRateLimit();

    const url = new URL(GOOGLE_CONFIG.API_BASE_URL);
    url.searchParams.append('key', this.apiKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GOOGLE_CONFIG.TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorCode = errorData.error?.code || response.status;
        const errorMessage = errorData.error?.message || response.statusText;

        // Handle specific error codes
        if (errorCode === 403) {
          throw new Error(GoogleTranslateError.INVALID_API_KEY);
        }
        if (errorCode === 429) {
          throw new Error(GoogleTranslateError.RATE_LIMITED);
        }
        if (errorCode === 400 && errorMessage.includes('quota')) {
          throw new Error(GoogleTranslateError.QUOTA_EXCEEDED);
        }
        if (errorCode === 400 && errorMessage.includes('language')) {
          throw new Error(GoogleTranslateError.UNSUPPORTED_LANGUAGE);
        }

        throw new Error(`HTTP ${errorCode}: ${errorMessage}`);
      }

      const data = await response.json();
      
      if (!data.data || !data.data.translations) {
        throw new Error(GoogleTranslateError.INVALID_RESPONSE);
      }

      return data.data.translations;

    } catch (error) {
      clearTimeout(timeoutId);

      // Handle network errors with retry
      if (attempt < GOOGLE_CONFIG.RETRY.MAX_ATTEMPTS && 
          (error.name === 'TypeError' || error.name === 'AbortError' || 
           error.message === GoogleTranslateError.RATE_LIMITED)) {
        
        const delay = this._getRetryDelay(attempt);
        console.warn(`[GoogleTranslate] Retry ${attempt + 1}/${GOOGLE_CONFIG.RETRY.MAX_ATTEMPTS} after ${delay}ms`);
        await this._sleep(delay);
        return this._makeRequest(payload, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Translate a single text string
   * @param {string} text - Text to translate
   * @param {Object} options - Translation options
   * @param {string} options.sourceLang - Source language code (e.g., 'ja', 'ko')
   * @param {string} options.targetLang - Target language code (e.g., 'en')
   * @param {boolean} options.useCache - Whether to use cache
   * @returns {Promise<Object>} Translation result
   */
  async translate(text, options = {}) {
    const startTime = performance.now();
    const { sourceLang = 'auto', targetLang = 'en', useCache = true } = options;

    if (!text || !text.trim()) {
      return { text: '', detectedLanguage: sourceLang, confidence: 0 };
    }

    // Check cache first
    if (useCache && this.cacheManager) {
      const cached = await this.cacheManager.get('translation', {
        text,
        source: sourceLang,
        target: targetLang,
        engine: 'google'
      });
      
      if (cached) {
        this.performanceMonitor.record('cache_hit', performance.now() - startTime);
        return { ...cached, fromCache: true };
      }
    }

    // Preprocess
    const { text: processedText, markers } = this._preprocessText(text, sourceLang);

    try {
      const translations = await this._makeRequest({
        q: processedText,
        source: sourceLang === 'auto' ? undefined : sourceLang,
        target: targetLang,
        format: 'text',
        model: 'nmt' // Use Neural Machine Translation
      });

      if (!translations || translations.length === 0) {
        throw new Error(GoogleTranslateError.INVALID_RESPONSE);
      }

      const result = translations[0];
      let translatedText = result.translatedText;
      const detectedSource = result.detectedSourceLanguage || sourceLang;

      // Postprocess
      translatedText = this._postprocessText(translatedText, markers, targetLang);

      const translationResult = {
        text: translatedText,
        originalText: text,
        detectedLanguage: detectedSource,
        confidence: result.confidence || 1.0,
        engine: 'google',
        timestamp: Date.now()
      };

      // Cache result
      if (useCache && this.cacheManager) {
        await this.cacheManager.set('translation', {
          text,
          source: sourceLang,
          target: targetLang,
          engine: 'google'
        }, translationResult);
      }

      this.performanceMonitor.record('translation_success', performance.now() - startTime);
      return translationResult;

    } catch (error) {
      this.performanceMonitor.record('translation_error', performance.now() - startTime);
      console.error('[GoogleTranslate] Translation failed:', error);
      throw error;
    }
  }

  /**
   * Translate multiple texts in batch (more efficient)
   * @param {Array<string>} texts - Array of texts to translate
   * @param {Object} options - Translation options
   * @returns {Promise<Array<Object>>} Array of translation results
   */
  async translateBatch(texts, options = {}) {
    const startTime = performance.now();
    const { sourceLang = 'auto', targetLang = 'en', useCache = true } = options;

    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    // Filter empty strings and check cache
    const results = new Array(texts.length).fill(null);
    const toTranslate = [];
    const preprocessData = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      
      if (!text || !text.trim()) {
        results[i] = { text: '', detectedLanguage: sourceLang, confidence: 0 };
        continue;
      }

      // Check cache
      if (useCache && this.cacheManager) {
        const cached = await this.cacheManager.get('translation', {
          text,
          source: sourceLang,
          target: targetLang,
          engine: 'google'
        });
        
        if (cached) {
          results[i] = { ...cached, fromCache: true };
          continue;
        }
      }

      // Preprocess and queue
      const processed = this._preprocessText(text, sourceLang);
      preprocessData[i] = processed;
      toTranslate.push({ index: i, text: processed.text, original: text });
    }

    if (toTranslate.length === 0) {
      return results;
    }

    // Process in chunks of BATCH_SIZE
    const chunks = [];
    for (let i = 0; i < toTranslate.length; i += GOOGLE_CONFIG.BATCH_SIZE) {
      chunks.push(toTranslate.slice(i, i + GOOGLE_CONFIG.BATCH_SIZE));
    }

    for (const chunk of chunks) {
      try {
        const payload = {
          q: chunk.map(item => item.text),
          source: sourceLang === 'auto' ? undefined : sourceLang,
          target: targetLang,
          format: 'text',
          model: 'nmt'
        };

        const translations = await this._makeRequest(payload);

        // Map results back to original indices
        for (let i = 0; i < translations.length; i++) {
          const { index, original } = chunk[i];
          const result = translations[i];
          
          let translatedText = result.translatedText;
          const detectedSource = result.detectedSourceLanguage || sourceLang;

          // Postprocess
          translatedText = this._postprocessText(
            translatedText, 
            preprocessData[index].markers, 
            targetLang
          );

          const translationResult = {
            text: translatedText,
            originalText: original,
            detectedLanguage: detectedSource,
            confidence: result.confidence || 1.0,
            engine: 'google',
            timestamp: Date.now()
          };

          results[index] = translationResult;

          // Cache individual result
          if (useCache && this.cacheManager) {
            await this.cacheManager.set('translation', {
              text: original,
              source: sourceLang,
              target: targetLang,
              engine: 'google'
            }, translationResult);
          }
        }

      } catch (error) {
        console.error('[GoogleTranslate] Batch chunk failed:', error);
        
        // Mark failed translations
        for (const item of chunk) {
          if (!results[item.index]) {
            results[item.index] = {
              text: '[Translation Failed]',
              originalText: item.original,
              error: error.message,
              engine: 'google'
            };
          }
        }
      }
    }

    this.performanceMonitor.record('batch_translation', performance.now() - startTime);
    return results;
  }

  /**
   * Detect language of text
   * @param {string} text - Text to analyze
   * @returns {Promise<Object>} Detection result with language code and confidence
   */
  async detectLanguage(text) {
    if (!text || text.trim().length < 10) {
      return { language: 'unknown', confidence: 0 };
    }

    try {
      const url = new URL(`${GOOGLE_CONFIG.API_BASE_URL}/detect`);
      url.searchParams.append('key', this.apiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text.substring(0, 1000) }) // Use first 1000 chars
      });

      if (!response.ok) {
        throw new Error(`Detection failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.data?.detections?.[0]?.[0]) {
        const detection = data.data.detections[0][0];
        return {
          language: detection.language,
          confidence: detection.confidence,
          isReliable: detection.isReliable
        };
      }

      return { language: 'unknown', confidence: 0 };

    } catch (error) {
      console.error('[GoogleTranslate] Language detection failed:', error);
      return { language: 'unknown', confidence: 0, error: error.message };
    }
  }

  /**
   * Get supported languages
   * @param {string} targetLang - Language to get names in
   * @returns {Promise<Array<Object>>} List of supported languages
   */
  async getSupportedLanguages(targetLang = 'en') {
    try {
      const url = new URL(`${GOOGLE_CONFIG.API_BASE_URL}/languages`);
      url.searchParams.append('key', this.apiKey);
      url.searchParams.append('target', targetLang);

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        throw new Error(`Failed to fetch languages: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data?.languages || [];

    } catch (error) {
      console.error('[GoogleTranslate] Failed to get languages:', error);
      // Return fallback list for manga-common languages
      return [
        { language: 'ja', name: 'Japanese' },
        { language: 'ko', name: 'Korean' },
        { language: 'zh', name: 'Chinese (Simplified)' },
        { language: 'zh-TW', name: 'Chinese (Traditional)' },
        { language: 'en', name: 'English' }
      ];
    }
  }

  /**
   * Get current quota usage statistics
   * @returns {Object} Quota information
   */
  getQuotaStatus() {
    return {
      requestsThisMinute: this.requestsThisMinute,
      requestsToday: this.requestsToday,
      limitPerMinute: GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_MINUTE,
      limitPerDay: GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_DAY,
      remainingToday: Math.max(0, GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_DAY - this.requestsToday),
      utilizationPercent: (this.requestsToday / GOOGLE_CONFIG.RATE_LIMIT.REQUESTS_PER_DAY) * 100
    };
  }

  /**
   * Update API key (for settings changes)
   * @param {string} newApiKey - New Google Cloud API key
   */
  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log('[GoogleTranslate] API key updated');
  }

  /**
   * Clear internal caches
   */
  async clearCache() {
    if (this.cacheManager) {
      await this.cacheManager.clear('translation');
    }
  }

  /**
   * Health check for the translation service
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const testResult = await this.translate('hello', { 
        sourceLang: 'en', 
        targetLang: 'ja',
        useCache: false 
      });
      
      return {
        status: 'healthy',
        latency: Date.now() - testResult.timestamp,
        quota: this.getQuotaStatus()
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

// Export singleton instance for extension use
export const googleTranslate = new GoogleTranslateEngine();

// Default export for module systems
export default GoogleTranslateEngine;