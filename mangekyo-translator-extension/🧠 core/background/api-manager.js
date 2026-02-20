/**
 * Mangekyo Extension - API Manager
 * External API orchestration with load balancing, caching, and failover
 * Supports: Google Translate, DeepL, OpenAI GPT-4 Vision, local LLM
 * @version 2.0.0
 */

import { CONFIG } from '../shared/constants.js';
import { SecureStorage } from '../privacy/encryption/secure-storage.js';
import { CacheManager } from '../computer-vision/translation/cache-manager.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class APIManager {
  constructor(config) {
    this.config = config;
    this.engines = new Map();
    this.currentEngine = null;
    this.fallbackChain = [];
    this.rateLimiters = new Map();
    this.circuitBreakers = new Map();
    this.requestQueue = [];
    this.processingQueue = false;
    
    // API Keys storage
    this.keys = {
      deepl: null,
      openai: null,
      google: null
    };
    
    // Engine configurations
    this.engineConfig = {
      google: {
        name: 'Google Translate',
        endpoint: 'https://translate.googleapis.com/translate_a/single',
        maxRetries: 3,
        timeout: 10000,
        rateLimit: { requests: 100, window: 60000 }, // 100 req/min
        supportsContext: false,
        supportsVision: false,
        honorifics: false
      },
      deepl: {
        name: 'DeepL',
        endpoint: 'https://api-free.deepl.com/v2/translate',
        maxRetries: 3,
        timeout: 15000,
        rateLimit: { requests: 50, window: 60000 }, // Free tier: 50 req/min
        supportsContext: true,
        supportsVision: false,
        honorifics: true
      },
      openai: {
        name: 'OpenAI GPT-4 Vision',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        maxRetries: 2,
        timeout: 30000,
        rateLimit: { requests: 20, window: 60000 }, // GPT-4 is expensive
        supportsContext: true,
        supportsVision: true,
        honorifics: true,
        model: 'gpt-4-vision-preview'
      },
      local: {
        name: 'Local LLM',
        endpoint: 'http://localhost:11434/api/generate', // Ollama default
        maxRetries: 1,
        timeout: 60000,
        rateLimit: { requests: 10, window: 60000 },
        supportsContext: true,
        supportsVision: false, // Local models usually don't have vision
        honorifics: true
      }
    };
    
    this.cache = new CacheManager();
    this.perfMonitor = new PerformanceMonitor();
    
    this.initialize();
  }

  /**
   * Initialize API manager
   */
  async initialize() {
    await this.loadApiKeys();
    this.setupEngines();
    this.setupFallbackChain();
  }

  /**
   * Load encrypted API keys from secure storage
   */
  async loadApiKeys() {
    try {
      const encrypted = await SecureStorage.get('api_keys');
      if (encrypted) {
        this.keys = {
          deepl: encrypted.deepl || null,
          openai: encrypted.openai || null,
          google: null // Google doesn't require key for basic usage
        };
      }
    } catch (error) {
      console.warn('[APIManager] Failed to load API keys:', error);
    }
  }

  /**
   * Save API keys securely
   */
  async saveApiKeys(keys) {
    this.keys = { ...this.keys, ...keys };
    await SecureStorage.set('api_keys', this.keys);
  }

  /**
   * Setup translation engines
   */
  setupEngines() {
    // Google Translate (default, no key required)
    this.engines.set('google', {
      translate: this.googleTranslate.bind(this),
      config: this.engineConfig.google
    });
    
    // DeepL (if key available)
    if (this.keys.deepl) {
      this.engines.set('deepl', {
        translate: this.deeplTranslate.bind(this),
        config: this.engineConfig.deepl
      });
    }
    
    // OpenAI (if key available)
    if (this.keys.openai) {
      this.engines.set('openai', {
        translate: this.openaiTranslate.bind(this),
        config: this.engineConfig.openai
      });
    }
    
    // Local LLM (always available if running)
    this.engines.set('local', {
      translate: this.localLlmTranslate.bind(this),
      config: this.engineConfig.local
    });
    
    // Set default
    this.currentEngine = 'google';
  }

  /**
   * Setup fallback priority chain
   */
  setupFallbackChain() {
    this.fallbackChain = ['openai', 'deepl', 'google', 'local'];
    // Filter to available engines
    this.fallbackChain = this.fallbackChain.filter(engine => 
      this.engines.has(engine) || engine === 'google'
    );
  }

  /**
   * Main translation method with failover
   */
  async translate(text, options = {}) {
    const {
      sourceLang = 'auto',
      targetLang = 'en',
      engine = null,
      preserveContext = true,
      honorifics = true,
      context = null,
      imageData = null, // For vision models
      priority = 'normal'
    } = options;

    // Check cache first
    const cacheKey = this.generateCacheKey(text, sourceLang, targetLang, engine);
    const cached = await this.cache.get(cacheKey);
    if (cached && !options.skipCache) {
      return { ...cached, cached: true };
    }

    // Determine which engine to use
    let enginesToTry = engine ? [engine] : this.fallbackChain;
    
    // If image provided, prioritize vision-capable engines
    if (imageData) {
      enginesToTry = enginesToTry.filter(e => 
        this.engineConfig[e]?.supportsVision
      );
      if (enginesToTry.length === 0) {
        throw new Error('No vision-capable translation engine available');
      }
    }

    // Try engines in order
    let lastError = null;
    for (const engineName of enginesToTry) {
      const engineImpl = this.engines.get(engineName);
      if (!engineImpl) continue;

      // Check circuit breaker
      if (this.isCircuitOpen(engineName)) {
        console.warn(`[APIManager] Circuit open for ${engineName}, skipping...`);
        continue;
      }

      // Check rate limit
      if (!this.checkRateLimit(engineName)) {
        console.warn(`[APIManager] Rate limit hit for ${engineName}`);
        continue;
      }

      try {
        const startTime = performance.now();
        
        const result = await this.executeWithTimeout(
          engineImpl.translate(text, {
            sourceLang,
            targetLang,
            preserveContext,
            honorifics,
            context,
            imageData
          }),
          engineImpl.config.timeout
        );

        const duration = performance.now() - startTime;
        
        // Record success
        this.recordSuccess(engineName, duration);
        
        // Format response
        const translation = {
          text: result.text,
          original: text,
          engine: engineName,
          confidence: result.confidence || 0.9,
          alternatives: result.alternatives || [],
          detectedLang: result.detectedLang || sourceLang,
          processingTime: duration,
          timestamp: Date.now(),
          cached: false
        };

        // Cache result
        await this.cache.set(cacheKey, translation, {
          ttl: this.getCacheTTL(engineName)
        });

        return translation;

      } catch (error) {
        console.error(`[APIManager] ${engineName} failed:`, error);
        this.recordFailure(engineName, error);
        lastError = error;
        
        // Continue to next engine
        continue;
      }
    }

    // All engines failed
    throw new Error(`All translation engines failed. Last error: ${lastError?.message}`);
  }

  /**
   * Google Translate implementation (free, no key)
   */
  async googleTranslate(params) {
    const { text, sourceLang, targetLang } = params;
    
    // Google Translate API client
    const url = new URL(this.engineConfig.google.endpoint);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', sourceLang);
    url.searchParams.set('tl', targetLang);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

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
    
    // Parse Google response format
    let translatedText = '';
    if (data && data[0]) {
      data[0].forEach(part => {
        if (part[0]) translatedText += part[0];
      });
    }

    return {
      text: translatedText,
      confidence: 0.85,
      detectedLang: data[2] || sourceLang
    };
  }

  /**
   * DeepL implementation
   */
  async deeplTranslate(params) {
    const { text, sourceLang, targetLang, preserveContext } = params;
    
    if (!this.keys.deepl) {
      throw new Error('DeepL API key not configured');
    }

    const body = {
      text: [text],
      target_lang: targetLang.toUpperCase(),
      preserve_formatting: true,
      tag_handling: 'html'
    };

    if (sourceLang !== 'auto') {
      body.source_lang = sourceLang.toUpperCase();
    }

    if (preserveContext) {
      body.context = params.context;
    }

    const response = await fetch(this.engineConfig.deepl.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${this.keys.deepl}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepL API error: ${error}`);
    }

    const data = await response.json();
    const translation = data.translations[0];

    return {
      text: translation.text,
      detectedLang: translation.detected_source_language?.toLowerCase(),
      confidence: 0.92,
      alternatives: [] // DeepL doesn't provide alternatives in free tier
    };
  }

  /**
   * OpenAI GPT-4 Vision implementation
   */
  async openaiTranslate(params) {
    const { text, sourceLang, targetLang, context, imageData, honorifics } = params;
    
    if (!this.keys.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const messages = [
      {
        role: 'system',
        content: `You are a professional manga translator. Translate the following text from ${sourceLang} to ${targetLang}.
          ${honorifics ? 'Preserve Japanese honorifics (-san, -kun, -chan, etc.)' : ''}
          Maintain the tone and style appropriate for manga dialogue.
          ${context ? `Context: ${context}` : ''}`
      }
    ];

    // If image provided, use vision capabilities
    if (imageData) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Translate this manga text: "${text}"`
          },
          {
            type: 'image_url',
            image_url: {
              url: imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`,
              detail: 'high'
            }
          }
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: text
      });
    }

    const response = await fetch(this.engineConfig.openai.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.keys.openai}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.engineConfig.openai.model,
        messages: messages,
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Parse response - GPT might add explanations, try to extract just translation
    const translation = this.extractTranslationFromGPT(content);

    return {
      text: translation,
      confidence: 0.95,
      detectedLang: sourceLang === 'auto' ? 'unknown' : sourceLang,
      alternatives: [] // Could parse multiple choices if requested
    };
  }

  /**
   * Local LLM implementation (Ollama/LM Studio)
   */
  async localLlmTranslate(params) {
    const { text, sourceLang, targetLang, context } = params;

    const prompt = `Translate the following ${sourceLang} text to ${targetLang}:
    
    "${text}"
    
    ${context ? `Context: ${context}` : ''}
    
    Provide only the translation, no explanations.`;

    const response = await fetch(this.engineConfig.local.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama2', // Configurable
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 500
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Local LLM error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      text: data.response.trim(),
      confidence: 0.8, // Local models vary in quality
      detectedLang: sourceLang
    };
  }

  /**
   * Batch translation for multiple text blocks
   */
  async translateBatch(texts, options = {}) {
    const { maxConcurrency = 3 } = options;
    
    const results = [];
    const queue = [...texts];
    
    async function processNext() {
      if (queue.length === 0) return;
      
      const text = queue.shift();
      try {
        const result = await this.translate(text, options);
        results.push({ success: true, ...result });
      } catch (error) {
        results.push({ success: false, error: error.message, original: text });
      }
      
      return processNext.call(this);
    }

    // Start concurrent workers
    const workers = Array(maxConcurrency)
      .fill()
      .map(() => processNext.call(this));

    await Promise.all(workers);
    
    return results;
  }

  /**
   * Dictionary lookup (Jisho, etc.)
   */
  async lookupDictionary(word, dictionary = 'jisho') {
    const cacheKey = `dict_${dictionary}_${word}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    let result;
    switch (dictionary) {
      case 'jisho':
        result = await this.jishoLookup(word);
        break;
      default:
        throw new Error(`Unknown dictionary: ${dictionary}`);
    }

    await this.cache.set(cacheKey, result, { ttl: 86400000 }); // 24 hours
    return result;
  }

  /**
   * Jisho.org API integration
   */
  async jishoLookup(word) {
    const response = await fetch(
      `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`
    );
    
    if (!response.ok) {
      throw new Error(`Jisho API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      word,
      results: data.data.map(entry => ({
        reading: entry.japanese[0]?.reading,
        meaning: entry.senses[0]?.english_definitions,
        partsOfSpeech: entry.senses[0]?.parts_of_speech,
        jlpt: entry.jlpt?.[0],
        common: entry.is_common
      }))
    };
  }

  /**
   * Image hosting for processing (Imgur, etc.)
   */
  async uploadImage(imageData, provider = 'imgur') {
    // Remove data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    
    switch (provider) {
      case 'imgur':
        return this.imgurUpload(base64Data);
      default:
        throw new Error(`Unknown image provider: ${provider}`);
    }
  }

  /**
   * Imgur anonymous upload
   */
  async imgurUpload(base64Data) {
    const clientId = CONFIG.IMGUR_CLIENT_ID; // Should be in constants
    
    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': `Client-ID ${clientId}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: base64Data,
        type: 'base64'
      })
    });

    if (!response.ok) {
      throw new Error(`Imgur upload failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      url: data.data.link,
      deleteHash: data.data.deletehash,
      id: data.data.id
    };
  }

  /**
   * Rate limiting
   */
  checkRateLimit(engineName) {
    const now = Date.now();
    const config = this.engineConfig[engineName];
    
    if (!this.rateLimiters.has(engineName)) {
      this.rateLimiters.set(engineName, {
        count: 0,
        windowStart: now
      });
    }
    
    const limiter = this.rateLimiters.get(engineName);
    
    // Reset window
    if (now - limiter.windowStart > config.rateLimit.window) {
      limiter.count = 0;
      limiter.windowStart = now;
    }
    
    limiter.count++;
    return limiter.count <= config.rateLimit.requests;
  }

  /**
   * Circuit breaker pattern
   */
  isCircuitOpen(engineName) {
    if (!this.circuitBreakers.has(engineName)) {
      this.circuitBreakers.set(engineName, {
        failures: 0,
        lastFailure: 0,
        state: 'closed' // closed, open, half-open
      });
    }
    
    const breaker = this.circuitBreakers.get(engineName);
    const config = this.engineConfig[engineName];
    
    if (breaker.state === 'open') {
      // Try half-open after 60 seconds
      if (Date.now() - breaker.lastFailure > 60000) {
        breaker.state = 'half-open';
        return false;
      }
      return true;
    }
    
    return false;
  }

  recordSuccess(engineName, duration) {
    const breaker = this.circuitBreakers.get(engineName);
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'closed';
    }
  }

  recordFailure(engineName, error) {
    const breaker = this.circuitBreakers.get(engineName);
    if (!breaker) return;
    
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    // Open circuit after 5 failures
    if (breaker.failures >= 5) {
      breaker.state = 'open';
      console.warn(`[APIManager] Circuit opened for ${engineName}`);
    }
  }

  /**
   * Utility: Execute with timeout
   */
  executeWithTimeout(promise, timeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      )
    ]);
  }

  /**
   * Utility: Generate cache key
   */
  generateCacheKey(text, source, target, engine) {
    const hash = this.simpleHash(`${text}_${source}_${target}_${engine}`);
    return `trans_${hash}`;
  }

  /**
   * Simple hash function
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Extract clean translation from GPT response
   */
  extractTranslationFromGPT(content) {
    // Remove common GPT artifacts
    let clean = content
      .replace(/^(Translation:|Translated text:|Here's the translation:)/i, '')
      .replace(/["']/g, '')
      .trim();
    
    // Take first line if multiple lines
    const lines = clean.split('\n').filter(l => l.trim());
    return lines[0] || clean;
  }

  /**
   * Get cache TTL based on engine
   */
  getCacheTTL(engine) {
    const ttls = {
      google: 86400000,    // 24 hours
      deepl: 604800000,    // 7 days (more stable)
      openai: 259200000,   // 3 days (expensive)
      local: 3600000       // 1 hour (may change)
    };
    return ttls[engine] || 86400000;
  }

  /**
   * Get API status and quotas
   */
  async getStatus() {
    const status = {};
    
    for (const [name, engine] of this.engines) {
      const limiter = this.rateLimiters.get(name);
      const breaker = this.circuitBreakers.get(name);
      const config = this.engineConfig[name];
      
      status[name] = {
        available: true,
        rateLimit: {
          limit: config.rateLimit.requests,
          used: limiter?.count || 0,
          remaining: config.rateLimit.requests - (limiter?.count || 0),
          resetIn: limiter ? 
            Math.max(0, config.rateLimit.window - (Date.now() - limiter.windowStart)) : 
            config.rateLimit.window
        },
        circuitState: breaker?.state || 'closed',
        hasKey: name === 'google' ? true : !!this.keys[name]
      };
    }
    
    return status;
  }

  /**
   * Set preferred engine
   */
  setPreferredEngine(engineName) {
    if (!this.engines.has(engineName)) {
      throw new Error(`Engine ${engineName} not available`);
    }
    this.currentEngine = engineName;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.cache.cleanup();
    this.rateLimiters.clear();
    this.circuitBreakers.clear();
  }
}

export { APIManager };