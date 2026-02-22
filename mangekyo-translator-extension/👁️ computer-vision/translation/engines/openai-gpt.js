/**
 * @fileoverview OpenAI GPT-4 Vision Adapter for Mangekyo Extension
 * @module computer-vision/translation/engines/openai-gpt
 * 
 * Advanced AI translation with:
 * - GPT-4 Vision for image context understanding
 * - Narrative context preservation across panels
 * - Character voice consistency
 * - Cultural nuance handling
 * - SFX and visual element translation
 * - Streaming support for real-time feedback
 */

import { CacheManager } from '../cache-manager.js';
import { HonorificsHandler } from '../honorifics-handler.js';
import { ContextPreserver } from '../context-preserver.js';
import { SFXTranslator } from '../sfx-translator.js';
import { CONFIG } from '../../../core/shared/constants.js';
import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

/**
 * OpenAI API Configuration
 * @constant {Object}
 */
const OPENAI_CONFIG = {
  API_URL: 'https://api.openai.com/v1',
  ENDPOINTS: {
    CHAT: '/chat/completions',
    VISION: '/chat/completions', // Vision uses same endpoint with image support
    MODELS: '/models'
  },
  
  MODELS: {
    VISION: 'gpt-4o', // Latest vision model
    VISION_LEGACY: 'gpt-4-turbo',
    CHEAP: 'gpt-4o-mini', // Cost-effective option
    CONTEXT: 'gpt-4o' // For context analysis
  },
  
  LIMITS: {
    MAX_TOKENS_PER_REQUEST: 4096,
    MAX_CONTEXT_TOKENS: 128000, // gpt-4o context window
    VISION_MAX_TOKENS: 4096,
    MAX_IMAGE_SIZE: 20 * 1024 * 1024, // 20MB
    SUPPORTED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    RATE_LIMIT_RPM: 500, // Requests per minute (tier 1)
    RATE_LIMIT_TPM: 30000 // Tokens per minute
  },
  
  TIMEOUT_MS: 60000, // Longer for vision processing
  
  RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY_MS: 2000,
    MAX_DELAY_MS: 30000,
    RETRYABLE_ERRORS: ['rate_limit_exceeded', 'timeout', 'temporarily_unavailable']
  },
  
  // Cost tracking (approximate per 1K tokens)
  PRICING: {
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 }
  }
};

/**
 * System prompts for different translation modes
 * @constant {Object}
 */
const SYSTEM_PROMPTS = {
  // Standard manga translation with context awareness
  MANGA_TRANSLATOR: `You are an expert manga translator with deep understanding of Japanese culture, anime/manga tropes, and natural English dialogue. Your task is to translate manga text while:

1. PRESERVING CHARACTER VOICE: Maintain personality, speech patterns, and emotional tone
2. HANDLING HONORIFICS: Keep -san, -kun, -chan, -sama when culturally significant, adapt when natural
3. TRANSLATING SFX: Convert Japanese sound effects to equivalent English onomatopoeia (ドキドキ → *thump thump*, ガン → *bang*)
4. ADAPTING IDIOMS: Convert Japanese expressions to natural English equivalents, not literal translations
5. MAINTAINING CONTEXT: Consider story context, relationships between characters, and scene mood
6. FORMATTING: Use *asterisks* for emphasis, [brackets] for translator notes when necessary

Output format: Provide ONLY the translated text. Do not include explanations, notes, or original text unless specifically requested.`,

  // Vision-enabled panel analysis
  VISION_ANALYST: `You are a manga panel analysis expert. Analyze the provided manga panel image and extract:

1. TEXT CONTENT: All visible text in speech bubbles, thought bubbles, narration boxes, and sound effects
2. VISUAL CONTEXT: Character expressions, scene setting, action happening, emotional tone
3. TEXT TYPE: speech (dialogue), thought (internal monologue), narration, sfx (sound effect), sign (background text)
4. SPEAKER IDENTIFICATION: Who is speaking if identifiable from context
5. RELATIONSHIPS: Character dynamics visible in the panel

Output as JSON with fields: text, type, speaker, context, emotion, notes`,

  // Context preservation specialist
  CONTEXT_SPECIALIST: `You are a narrative continuity expert. Given previous manga panels and current text, ensure translation maintains:

1. STORY CONSISTENCY: Character names, terminology, and established phrases remain consistent
2. EMOTIONAL ARC: Maintain the emotional progression of the scene
3. FORESHADOWING PRESERVATION: Keep subtle hints and callbacks accurate
4. TONE MATCHING: Ensure dialogue fits the scene's mood (serious, comedic, dramatic)

Provide translation that fits seamlessly into the ongoing narrative.`,

  // Cultural consultant for tricky passages
  CULTURAL_CONSULTANT: `You are a Japanese cultural expert specializing in anime/manga. Explain cultural references, wordplay, puns, or historical allusions in the text. Provide context needed for accurate translation that English readers will understand.

Output: Brief cultural note (1-2 sentences) + suggested translation approach.`
};

/**
 * Error types for OpenAI operations
 * @enum {string}
 */
export const OpenAIError = {
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_KEY: 'INVALID_API_KEY',
  CONTENT_FILTERED: 'CONTENT_FILTERED',
  CONTEXT_TOO_LONG: 'CONTEXT_TOO_LONG',
  VISION_ERROR: 'VISION_ERROR',
  TIMEOUT: 'TIMEOUT',
  SERVER_ERROR: 'SERVER_ERROR'
};

/**
 * OpenAI GPT Translation Engine
 * @class
 */
export class OpenAIGPTEngine {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiKey - OpenAI API key
   * @param {string} options.model - Model to use (gpt-4o, gpt-4o-mini, etc.)
   * @param {CacheManager} options.cacheManager - Cache instance
   * @param {boolean} options.useVision - Enable image analysis
   * @param {boolean} options.streaming - Enable streaming responses
   * @param {number} options.temperature - Creativity (0-2, default 0.7)
   * @param {boolean} options.preserveContext - Maintain narrative memory
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.model = options.model || OPENAI_CONFIG.MODELS.VISION;
    this.fallbackModel = options.fallbackModel || OPENAI_CONFIG.MODELS.CHEAP;
    
    this.cacheManager = options.cacheManager || new CacheManager();
    this.honorificsHandler = new HonorificsHandler();
    this.contextPreserver = options.preserveContext !== false ? new ContextPreserver() : null;
    this.sfxTranslator = new SFXTranslator();
    this.performanceMonitor = new PerformanceMonitor('openai-gpt');
    
    this.useVision = options.useVision !== false;
    this.streaming = options.streaming || false;
    this.temperature = options.temperature ?? 0.7;
    
    // Conversation memory for context preservation
    this.conversationMemory = [];
    this.maxMemoryPanels = 5; // Keep last 5 panels for context
    
    // Rate limiting
    this.requestCount = { minute: 0, hour: 0 };
    this.tokenCount = { minute: 0 };
    this.lastReset = Date.now();
    
    // Cost tracking
    this.sessionCost = 0;
    this.totalTokens = { input: 0, output: 0 };
    
    this._initRateLimiting();
  }

  /**
   * Initialize rate limiting
   * @private
   */
  _initRateLimiting() {
    setInterval(() => {
      this.requestCount.minute = 0;
      this.tokenCount.minute = 0;
      this.lastReset = Date.now();
    }, 60000);
    
    setInterval(() => {
      this.requestCount.hour = 0;
    }, 3600000);
  }

  /**
   * Enforce rate limits
   * @private
   * @param {number} estimatedTokens 
   */
  async _enforceRateLimits(estimatedTokens = 1000) {
    if (this.requestCount.minute >= OPENAI_CONFIG.LIMITS.RATE_LIMIT_RPM) {
      const wait = 60000 - (Date.now() - this.lastReset);
      console.warn(`[OpenAI] Rate limit reached, waiting ${wait}ms`);
      await this._sleep(wait);
      this.requestCount.minute = 0;
    }
    
    if (this.tokenCount.minute + estimatedTokens > OPENAI_CONFIG.LIMITS.RATE_LIMIT_TPM) {
      const wait = 60000 - (Date.now() - this.lastReset);
      await this._sleep(wait);
      this.tokenCount.minute = 0;
    }
    
    this.requestCount.minute++;
    this.requestCount.hour++;
    this.tokenCount.minute += estimatedTokens;
  }

  /**
   * Sleep utility
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate retry delay
   * @private
   */
  _getRetryDelay(attempt) {
    const delay = Math.min(
      OPENAI_CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt),
      OPENAI_CONFIG.RETRY.MAX_DELAY_MS
    );
    return delay + Math.random() * 2000;
  }

  /**
   * Estimate token count (rough approximation)
   * @private
   * @param {string} text 
   * @returns {number}
   */
  _estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 chars for English, 1 token ≈ 1 char for Japanese
    return Math.ceil(text.length / 2);
  }

  /**
   * Calculate request cost
   * @private
   * @param {number} inputTokens 
   * @param {number} outputTokens 
   * @returns {number} Cost in USD
   */
  _calculateCost(inputTokens, outputTokens) {
    const pricing = OPENAI_CONFIG.PRICING[this.model] || OPENAI_CONFIG.PRICING['gpt-4o'];
    const cost = (inputTokens / 1000 * pricing.input) + (outputTokens / 1000 * pricing.output);
    this.sessionCost += cost;
    this.totalTokens.input += inputTokens;
    this.totalTokens.output += outputTokens;
    return cost;
  }

  /**
   * Prepare image for vision API
   * @private
   * @param {string} imageData - Base64 or URL
   * @returns {Object}
   */
  _prepareImageContent(imageData) {
    // If it's a URL
    if (imageData.startsWith('http')) {
      return {
        type: 'image_url',
        image_url: { url: imageData }
      };
    }
    
    // If it's base64 data
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageData.match(/data:(image\/\w+);base64/)?.[1] || 'image/jpeg';
    
    if (!OPENAI_CONFIG.LIMITS.SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
      throw new Error(`Unsupported image type: ${mimeType}`);
    }
    
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`,
        detail: 'high' // Use high detail for manga text
      }
    };
  }

  /**
   * Build conversation context from memory
   * @private
   * @returns {Array<Object>}
   */
  _buildContextMessages() {
    if (!this.contextPreserver || this.conversationMemory.length === 0) {
      return [];
    }
    
    return this.conversationMemory.map(panel => ({
      role: 'user',
      content: `Previous panel context: ${panel.context}\nText: "${panel.original}"`
    })).slice(-this.maxMemoryPanels);
  }

  /**
   * Make API request to OpenAI
   * @private
   * @param {Array<Object>} messages 
   * @param {Object} options 
   * @param {number} attempt 
   * @returns {Promise<Object>}
   */
  async _makeRequest(messages, options = {}, attempt = 0) {
    const model = options.model || this.model;
    const estimatedTokens = this._estimateTokens(
      messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('')
    );
    
    await this._enforceRateLimits(estimatedTokens);
    
    const payload = {
      model,
      messages,
      temperature: options.temperature ?? this.temperature,
      max_tokens: options.maxTokens || OPENAI_CONFIG.LIMITS.MAX_TOKENS_PER_REQUEST,
      top_p: options.topP || 1,
      frequency_penalty: options.frequencyPenalty || 0,
      presence_penalty: options.presencePenalty || 0,
      stream: options.stream || this.streaming
    };
    
    // Add response format for JSON mode if requested
    if (options.jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_CONFIG.TIMEOUT_MS);

    try {
      const response = await fetch(`${OPENAI_CONFIG.API_URL}${OPENAI_CONFIG.ENDPOINTS.CHAT}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Organization': options.orgId || ''
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorCode = errorData.error?.code;
        const errorMessage = errorData.error?.message || response.statusText;

        // Handle specific errors
        if (response.status === 429) {
          if (errorCode === 'insufficient_quota') {
            throw new Error(OpenAIError.QUOTA_EXCEEDED);
          }
          throw new Error(OpenAIError.RATE_LIMITED);
        }
        if (response.status === 401) throw new Error(OpenAIError.INVALID_KEY);
        if (response.status === 400 && errorMessage.includes('maximum context length')) {
          throw new Error(OpenAIError.CONTEXT_TOO_LONG);
        }
        if (errorCode === 'content_filter') throw new Error(OpenAIError.CONTENT_FILTERED);

        // Retryable errors
        if (OPENAI_CONFIG.RETRY.RETRYABLE_ERRORS.includes(errorCode) && attempt < OPENAI_CONFIG.RETRY.MAX_ATTEMPTS) {
          const delay = this._getRetryDelay(attempt);
          console.warn(`[OpenAI] Retrying after error: ${errorCode}`);
          await this._sleep(delay);
          return this._makeRequest(messages, options, attempt + 1);
        }

        throw new Error(`${OpenAIError.SERVER_ERROR}: ${errorMessage}`);
      }

      const data = await response.json();
      
      // Track cost
      const cost = this._calculateCost(
        data.usage?.prompt_tokens || estimatedTokens,
        data.usage?.completion_tokens || 0
      );
      
      return {
        ...data,
        cost,
        modelUsed: model
      };

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        if (attempt < OPENAI_CONFIG.RETRY.MAX_ATTEMPTS) {
          return this._makeRequest(messages, options, attempt + 1);
        }
        throw new Error(OpenAIError.TIMEOUT);
      }
      
      throw error;
    }
  }

  /**
   * Analyze image with GPT-4 Vision
   * @param {string} imageData - Base64 image or URL
   * @param {Object} options 
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeImage(imageData, options = {}) {
    if (!this.useVision) {
      throw new Error('Vision is disabled');
    }

    const startTime = performance.now();
    
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.VISION_ANALYST
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: options.prompt || 'Analyze this manga panel and extract all text with context.'
          },
          this._prepareImageContent(imageData)
        ]
      }
    ];

    try {
      const result = await this._makeRequest(messages, {
        model: this.model,
        jsonMode: true,
        maxTokens: 2000
      });

      const analysis = JSON.parse(result.choices[0].message.content);
      
      this.performanceMonitor.record('vision_analysis', performance.now() - startTime);
      
      return {
        ...analysis,
        cost: result.cost,
        model: result.modelUsed,
        timestamp: Date.now()
      };

    } catch (error) {
      this.performanceMonitor.record('vision_error', performance.now() - startTime);
      throw error;
    }
  }

  /**
   * Translate text with optional image context
   * @param {string} text 
   * @param {Object} options 
   * @returns {Promise<Object>}
   */
  async translate(text, options = {}) {
    const startTime = performance.now();
    const {
      sourceLang = 'ja',
      targetLang = 'en',
      useCache = true,
      imageContext = null, // Optional image for vision context
      characterContext = null, // Character speaking info
      sceneContext = null, // Scene mood/setting
      preserveHonorifics = true,
      explainCultural = false
    } = options;

    if (!text || !text.trim()) {
      return { text: '', confidence: 0 };
    }

    // Check cache
    if (useCache && this.cacheManager) {
      const cacheKey = {
        text,
        source: sourceLang,
        target: targetLang,
        engine: 'openai',
        model: this.model,
        context: !!imageContext
      };
      
      const cached = await this.cacheManager.get('translation', cacheKey);
      if (cached) {
        this.performanceMonitor.record('cache_hit', performance.now() - startTime);
        return { ...cached, fromCache: true };
      }
    }

    // Preprocess
    let processedText = text;
    const markers = [];
    
    if (preserveHonorifics && sourceLang === 'ja') {
      const honorificResult = this.honorificsHandler.extract(processedText);
      processedText = honorificResult.text;
      markers.push(...honorificResult.markers);
    }

    // Build messages
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.MANGA_TRANSLATOR
      },
      ...this._buildContextMessages(),
      {
        role: 'user',
        content: []
      }
    ];

    const userContent = messages[messages.length - 1].content;

    // Add image context if provided
    if (imageContext && this.useVision) {
      userContent.push(this._prepareImageContent(imageContext));
    }

    // Build translation prompt
    let prompt = `Translate from ${sourceLang} to ${targetLang}:\n\n"${processedText}"`;
    
    if (characterContext) {
      prompt += `\n\nCharacter speaking: ${characterContext.name || 'Unknown'}`;
      prompt += `\nPersonality: ${characterContext.personality || 'Neutral'}`;
    }
    
    if (sceneContext) {
      prompt += `\nScene context: ${sceneContext}`;
    }

    if (explainCultural) {
      prompt += `\n\nNote: Provide brief cultural context if relevant.`;
    }

    userContent.push({
      type: 'text',
      text: prompt
    });

    try {
      const result = await this._makeRequest(messages, {
        maxTokens: 1000,
        temperature: 0.7
      });

      let translatedText = result.choices[0].message.content.trim();
      
      // Clean up common AI artifacts
      translatedText = translatedText
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes
        .replace(/^Translation:\s*/i, '')
        .replace(/^["'].*?["']:\s*/, ''); // Remove "Original": prefix

      // Postprocess
      if (preserveHonorifics && markers.length > 0) {
        translatedText = this.honorificsHandler.restore(translatedText, markers, targetLang);
      }

      // Update memory
      if (this.contextPreserver) {
        this.conversationMemory.push({
          original: text,
          translated: translatedText,
          context: sceneContext || '',
          timestamp: Date.now()
        });
        
        // Trim memory
        if (this.conversationMemory.length > this.maxMemoryPanels * 2) {
          this.conversationMemory = this.conversationMemory.slice(-this.maxMemoryPanels);
        }
      }

      const translationResult = {
        text: translatedText,
        originalText: text,
        detectedLanguage: sourceLang,
        confidence: 0.95, // GPT-4 generally high confidence
        engine: 'openai',
        model: result.modelUsed,
        cost: result.cost,
        tokens: {
          input: result.usage?.prompt_tokens,
          output: result.usage?.completion_tokens
        },
        timestamp: Date.now()
      };

      // Cache
      if (useCache && this.cacheManager) {
        await this.cacheManager.set('translation', {
          text,
          source: sourceLang,
          target: targetLang,
          engine: 'openai',
          model: this.model
        }, translationResult);
      }

      this.performanceMonitor.record('translation_success', performance.now() - startTime);
      return translationResult;

    } catch (error) {
      this.performanceMonitor.record('translation_error', performance.now() - startTime);
      
      // Fallback to cheaper model on certain errors
      if (error.message === OpenAIError.QUOTA_EXCEEDED && this.model !== this.fallbackModel) {
        console.warn('[OpenAI] Falling back to cheaper model');
        const fallbackOptions = { ...options, model: this.fallbackModel };
        return this.translate(text, fallbackOptions);
      }
      
      throw error;
    }
  }

  /**
   * Translate with full panel context (image + text)
   * @param {string} text 
   * @param {string} imageData 
   * @param {Object} options 
   * @returns {Promise<Object>}
   */
  async translateWithVision(text, imageData, options = {}) {
    if (!this.useVision) {
      return this.translate(text, options);
    }

    // First analyze image if detailed context needed
    let imageAnalysis = null;
    if (options.analyzeFirst) {
      imageAnalysis = await this.analyzeImage(imageData, {
        prompt: 'Identify speakers, emotions, and scene context for translation.'
      });
    }

    return this.translate(text, {
      ...options,
      imageContext: imageData,
      characterContext: imageAnalysis?.speaker ? {
        name: imageAnalysis.speaker,
        personality: imageAnalysis.emotion
      } : null,
      sceneContext: imageAnalysis?.context || options.sceneContext
    });
  }

  /**
   * Batch translate with context awareness
   * @param {Array<{text: string, image?: string, context?: Object}>} items 
   * @param {Object} options 
   * @returns {Promise<Array<Object>>}
   */
  async translateBatch(items, options = {}) {
    const results = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const result = item.image 
          ? await this.translateWithVision(item.text, item.image, { ...options, ...item.context })
          : await this.translate(item.text, { ...options, ...item.context });
        
        results.push(result);
        
        // Small delay to respect rate limits
        if (i < items.length - 1) await this._sleep(100);
        
      } catch (error) {
        console.error(`[OpenAI] Batch item ${i} failed:`, error);
        results.push({
          text: '[Translation Failed]',
          originalText: item.text,
          error: error.message,
          engine: 'openai'
        });
      }
    }
    
    return results;
  }

  /**
   * Get cultural explanation for text
   * @param {string} text 
   * @param {string} sourceLang 
   * @returns {Promise<Object>}
   */
  async explainCulturalContext(text, sourceLang = 'ja') {
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.CULTURAL_CONSULTANT
      },
      {
        role: 'user',
        content: `Explain cultural context for: "${text}" (${sourceLang})`
      }
    ];

    const result = await this._makeRequest(messages, {
      model: this.fallbackModel, // Use cheaper model for explanations
      maxTokens: 500,
      temperature: 0.5
    });

    return {
      explanation: result.choices[0].message.content,
      cost: result.cost,
      model: result.modelUsed
    };
  }

  /**
   * Stream translation (for real-time UI updates)
   * @param {string} text 
   * @param {Object} options 
   * @param {Function} onChunk - Callback for each text chunk
   * @returns {Promise<Object>}
   */
  async translateStreaming(text, options = {}, onChunk) {
    if (!onChunk || typeof onChunk !== 'function') {
      throw new Error('onChunk callback required for streaming');
    }

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPTS.MANGA_TRANSLATOR
      },
      {
        role: 'user',
        content: `Translate: "${text}"`
      }
    ];

    await this._enforceRateLimits();
    
    const response = await fetch(`${OPENAI_CONFIG.API_URL}${OPENAI_CONFIG.ENDPOINTS.CHAT}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: this.temperature,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`Streaming failed: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                onChunk(content, fullText);
              }
            } catch (e) {
              // Ignore parse errors for [DONE] or empty lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: fullText,
      originalText: text,
      engine: 'openai',
      streaming: true,
      timestamp: Date.now()
    };
  }

  /**
   * Clear conversation memory
   */
  clearMemory() {
    this.conversationMemory = [];
    console.log('[OpenAI] Conversation memory cleared');
  }

  /**
   * Get usage statistics
   * @returns {Object}
   */
  getUsageStats() {
    return {
      sessionCost: this.sessionCost,
      totalTokens: this.totalTokens,
      requestCount: this.requestCount,
      memorySize: this.conversationMemory.length,
      model: this.model
    };
  }

  /**
   * Update configuration
   * @param {Object} config 
   */
  updateConfig(config) {
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.model) this.model = config.model;
    if (config.temperature !== undefined) this.temperature = config.temperature;
    if (config.useVision !== undefined) this.useVision = config.useVision;
    if (config.streaming !== undefined) this.streaming = config.streaming;
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
      
      return {
        status: 'healthy',
        latency: Date.now() - start,
        model: this.model,
        cost: result.cost,
        visionEnabled: this.useVision
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        model: this.model
      };
    }
  }
}

// Singleton instance
export const openaiGPT = new OpenAIGPTEngine();

export default OpenAIGPTEngine;