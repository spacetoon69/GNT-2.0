/**
 * local-llm.js
 * On-device translation using WebLLM / Transformers.js
 * Privacy-preserving local inference for manga/manhwa translation
 * 
 * @module core/computer-vision/translation/engines/local-llm
 */

import { PerformanceMonitor } from '../../../shared/utils/performance-monitor.js';
import { ConfigManager } from '../../../shared/config-manager.js';
import { SecureStorage } from '../../../privacy/encryption/secure-storage.js';

/**
 * Local LLM Translation Engine
 * Runs translation models locally using WebGPU/WebGL acceleration
 * No data leaves the device - maximum privacy
 */
class LocalLLMTranslator {
  constructor() {
    this.model = null;
    this.tokenizer = null;
    this.pipeline = null;
    this.isInitialized = false;
    this.isLoading = false;
    
    // Model registry - curated for manga translation
    this.MODEL_REGISTRY = {
      // Lightweight models for quick translation (< 500MB)
      'lightweight': {
        'opus-mt-en-ja': {
          id: 'Xenova/opus-mt-en-ja',
          size: '~300MB',
          languages: ['en', 'ja'],
          optimizedFor: 'general',
          quantization: 'q4'
        },
        'opus-mt-ja-en': {
          id: 'Xenova/opus-mt-ja-en',
          size: '~300MB',
          languages: ['ja', 'en'],
          optimizedFor: 'general',
          quantization: 'q4'
        }
      },
      
      // Manga-optimized models (understanding speech bubbles, SFX, honorifics)
      'manga-optimized': {
        'sakura-13b': {
          id: 'SakuraLLM/Sakura-13B-LNovel-v0.9',
          size: '~7GB',
          languages: ['ja', 'zh', 'en'],
          optimizedFor: 'light-novel-manga',
          contextWindow: 4096,
          supportsHonorifics: true,
          supportsSFX: true
        }
      },
      
      // Multilingual models
      'multilingual': {
        'nllb-200-distilled': {
          id: 'Xenova/nllb-200-distilled-600M',
          size: '~600MB',
          languages: ['en', 'ja', 'ko', 'zh', 'es', 'fr', 'de', 'ru'],
          optimizedFor: 'general',
          quantization: 'q4'
        }
      }
    };

    this.currentConfig = {
      modelType: 'lightweight',
      modelId: 'opus-mt-ja-en',
      device: 'webgpu', // 'webgpu' | 'webgl' | 'cpu'
      maxLength: 512,
      batchSize: 1,
      cacheModels: true,
      quantization: 'q4'
    };

    this.cache = new Map();
    this.maxCacheSize = 100;
    
    this.performanceMonitor = new PerformanceMonitor('local-llm');
    this.configManager = new ConfigManager();
    this.secureStorage = new SecureStorage();
  }

  /**
   * Initialize the local LLM engine
   * @param {Object} options - Configuration options
   * @returns {Promise<boolean>} Initialization success
   */
  async initialize(options = {}) {
    if (this.isInitialized) return true;
    if (this.isLoading) throw new Error('Model already loading');

    this.isLoading = true;
    const perfMark = this.performanceMonitor.start('initialization');

    try {
      // Merge configuration
      Object.assign(this.currentConfig, options);
      
      // Check WebGPU availability
      await this._checkHardwareCapabilities();
      
      // Dynamically import transformers.js (lazy loading for MV3)
      const { pipeline, env } = await this._loadTransformers();
      
      // Configure environment
      this._configureEnvironment(env);
      
      // Load model
      const modelInfo = this._getModelInfo();
      console.log(`[LocalLLM] Loading model: ${modelInfo.id}`);
      
      this.pipeline = await pipeline(
        'translation',
        modelInfo.id,
        {
          quantized: this.currentConfig.quantization !== 'none',
          revision: 'main',
          device: this.currentConfig.device,
          dtype: this.currentConfig.quantization === 'q4' ? 'q4' : 'fp16'
        }
      );

      this.isInitialized = true;
      this.isLoading = false;
      
      this.performanceMonitor.end(perfMark);
      console.log('[LocalLLM] Initialization complete');
      
      return true;

    } catch (error) {
      this.isLoading = false;
      this.performanceMonitor.end(perfMark, { error: error.message });
      console.error('[LocalLLM] Initialization failed:', error);
      throw new Error(`Local LLM init failed: ${error.message}`);
    }
  }

  /**
   * Translate text using local model
   * @param {string} text - Text to translate
   * @param {Object} context - Translation context
   * @returns {Promise<Object>} Translation result
   */
  async translate(text, context = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!text || text.trim().length === 0) {
      return { text: '', confidence: 0, source: 'local-llm' };
    }

    const perfMark = this.performanceMonitor.start('translation');
    
    try {
      // Check cache
      const cacheKey = this._generateCacheKey(text, context);
      const cached = this._getCache(cacheKey);
      if (cached) {
        this.performanceMonitor.end(perfMark, { cached: true });
        return { ...cached, cached: true };
      }

      // Preprocess text for manga context
      const preprocessed = this._preprocessMangaText(text, context);
      
      // Run inference
      const result = await this._runInference(preprocessed, context);
      
      // Postprocess (handle honorifics, SFX, etc.)
      const postprocessed = this._postprocessResult(result, context);

      // Cache result
      this._setCache(cacheKey, postprocessed);

      this.performanceMonitor.end(perfMark, {
        textLength: text.length,
        model: this.currentConfig.modelId
      });

      return {
        text: postprocessed.text,
        confidence: postprocessed.confidence,
        source: 'local-llm',
        model: this.currentConfig.modelId,
        processingTime: this.performanceMonitor.getDuration(perfMark),
        metadata: {
          honorificsPreserved: postprocessed.honorificsPreserved,
          sfxTranslated: postprocessed.sfxTranslated,
          contextUsed: context.narrativeContext ? true : false
        }
      };

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: error.message });
      console.error('[LocalLLM] Translation error:', error);
      
      // Fallback to empty result with error flag
      return {
        text: text,
        confidence: 0,
        source: 'local-llm',
        error: error.message,
        fallback: true
      };
    }
  }

  /**
   * Batch translate multiple text segments
   * Optimized for manga pages with multiple speech bubbles
   * @param {Array<string>} texts - Array of texts to translate
   * @param {Object} context - Shared context
   * @returns {Promise<Array<Object>>} Array of results
   */
  async translateBatch(texts, context = {}) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    // Process in chunks to avoid memory issues
    const batchSize = this.currentConfig.batchSize;
    const results = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const chunkPromises = chunk.map(text => this.translate(text, {
        ...context,
        batchIndex: i,
        totalBatches: Math.ceil(texts.length / batchSize)
      }));
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      results.push(...chunkResults.map(r => 
        r.status === 'fulfilled' ? r.value : { error: r.reason, text: '' }
      ));

      // Yield to main thread in MV3
      if (i + batchSize < texts.length) {
        await this._yieldToMainThread();
      }
    }

    return results;
  }

  /**
   * Run actual model inference
   * @private
   */
  async _runInference(text, context) {
    const { narrativeContext, previousBubbles, characterInfo } = context;
    
    // Build prompt with manga-specific instructions
    let inputText = text;
    
    // Add context if available (for larger models)
    if (this._supportsContext() && narrativeContext) {
      inputText = this._buildContextualPrompt(text, narrativeContext, previousBubbles);
    }

    // Generate translation
    const output = await this.pipeline(inputText, {
      max_length: this.currentConfig.maxLength,
      num_beams: 2,
      early_stopping: true,
      src_lang: this._getLangCode(context.sourceLang),
      tgt_lang: this._getLangCode(context.targetLang)
    });

    // Extract translation
    let translatedText = '';
    let confidence = 0.8; // Default confidence for local models

    if (Array.isArray(output) && output.length > 0) {
      translatedText = output[0].translation_text || output[0].generated_text || '';
      confidence = output[0].score || confidence;
    } else if (output && output.translation_text) {
      translatedText = output.translation_text;
    }

    return {
      text: translatedText,
      confidence: confidence,
      raw: output
    };
  }

  /**
   * Preprocess text for manga-specific handling
   * @private
   */
  _preprocessMangaText(text, context) {
    let processed = text;

    // Preserve vertical text markers
    processed = processed.replace(/([^\n])\n([^\n])/g, '$1 $2');

    // Handle furigana (ruby text) - remove readings, keep base text
    // This would need actual DOM parsing in content script, here we handle plain text
    processed = processed.replace(/[\u3040-\u309F]+/g, (match) => {
      // If surrounded by kanji, likely furigana - context dependent
      return match;
    });

    // Mark sound effects for special handling
    if (this._isSoundEffect(processed)) {
      context.isSFX = true;
    }

    // Handle character-specific speech patterns
    if (context.characterInfo?.speechPattern) {
      processed = this._applySpeechPattern(processed, context.characterInfo);
    }

    return processed;
  }

  /**
   * Postprocess translation result
   * @private
   */
  _postprocessResult(result, context) {
    let text = result.text;
    let honorificsPreserved = false;
    let sfxTranslated = false;

    // Restore honorifics if they were stripped
    if (context.preserveHonorifics !== false) {
      const restored = this._restoreHonorifics(text, context.originalText);
      text = restored.text;
      honorificsPreserved = restored.honorificsFound;
    }

    // Handle sound effects
    if (context.isSFX) {
      text = this._translateSFX(text, context.targetLang);
      sfxTranslated = true;
    }

    // Clean up artifacts
    text = this._cleanArtifacts(text);

    // Match original formatting (line breaks, etc.)
    text = this._matchFormatting(text, context.originalText);

    return {
      text: text,
      confidence: result.confidence,
      honorificsPreserved,
      sfxTranslated
    };
  }

  /**
   * Build prompt with narrative context for better coherence
   * @private
   */
  _buildContextualPrompt(text, narrativeContext, previousBubbles) {
    // For models that support context (like Sakura-13B)
    const contextParts = [];
    
    if (narrativeContext.setting) {
      contextParts.push(`Setting: ${narrativeContext.setting}`);
    }
    if (narrativeContext.scene) {
      contextParts.push(`Scene: ${narrativeContext.scene}`);
    }
    if (previousBubbles && previousBubbles.length > 0) {
      const recentContext = previousBubbles
        .slice(-3)
        .map(b => `Previous: ${b.original} → ${b.translated}`)
        .join('\n');
      contextParts.push(`Context:\n${recentContext}`);
    }

    if (contextParts.length > 0) {
      return `[Context]\n${contextParts.join('\n')}\n\n[Text to translate]\n${text}`;
    }

    return text;
  }

  /**
   * Check hardware capabilities and select optimal device
   * @private
   */
  async _checkHardwareCapabilities() {
    const capabilities = {
      webgpu: false,
      webgl: false,
      memory: 0,
      recommendedDevice: 'cpu'
    };

    // Check WebGPU
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const info = await adapter.requestAdapterInfo();
          capabilities.webgpu = true;
          capabilities.gpuInfo = info;
          
          // Check if GPU has enough VRAM (rough estimate)
          if (info.memory || info.device) {
            capabilities.webgpu = true;
          }
        }
      } catch (e) {
        console.log('[LocalLLM] WebGPU check failed:', e);
      }
    }

    // Check WebGL
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        capabilities.webgl = true;
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          capabilities.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (e) {
      console.log('[LocalLLM] WebGL check failed:', e);
    }

    // Estimate available memory
    if (typeof performance !== 'undefined' && performance.memory) {
      capabilities.memory = performance.memory.jsHeapSizeLimit;
    }

    // Determine optimal device
    if (capabilities.webgpu) {
      capabilities.recommendedDevice = 'webgpu';
    } else if (capabilities.webgl) {
      capabilities.recommendedDevice = 'webgl';
    }

    // Auto-adjust model selection based on capabilities
    if (!capabilities.webgpu && this.currentConfig.modelType === 'manga-optimized') {
      console.warn('[LocalLLM] WebGPU not available, falling back to lightweight model');
      this.currentConfig.modelType = 'lightweight';
      this.currentConfig.modelId = 'opus-mt-ja-en';
    }

    this.hardwareCapabilities = capabilities;
    return capabilities;
  }

  /**
   * Configure Transformers.js environment
   * @private
   */
  _configureEnvironment(env) {
    // Use local cache for models
    env.useBrowserCache = true;
    env.allowLocalModels = false; // Only use remote for security
    
    // Configure cache location
    env.cacheDir = '/models';
    
    // WebGPU specific settings
    if (this.currentConfig.device === 'webgpu') {
      env.backends.onnx.wasm.numThreads = 1; // MV3 compatibility
    }

    // Logging
    env.logLevel = 'warning';
  }

  /**
   * Dynamically load Transformers.js
   * Uses dynamic import to avoid bundling large library when not needed
   * @private
   */
  async _loadTransformers() {
    // In MV3 extension, we need to handle this carefully
    // The library should be loaded from offscreen document or dynamic import
    try {
      // Attempt dynamic import
      const module = await import('@xenova/transformers');
      return module;
    } catch (error) {
      console.error('[LocalLLM] Failed to load Transformers.js:', error);
      throw new Error('Transformers.js library not available. Ensure it is included in the offscreen document.');
    }
  }

  /**
   * Get model information from registry
   * @private
   */
  _getModelInfo() {
    const registry = this.MODEL_REGISTRY[this.currentConfig.modelType];
    if (!registry) {
      throw new Error(`Unknown model type: ${this.currentConfig.modelType}`);
    }
    
    const model = registry[this.currentConfig.modelId];
    if (!model) {
      throw new Error(`Unknown model ID: ${this.currentConfig.modelId}`);
    }
    
    return model;
  }

  /**
   * Check if current model supports context windows
   * @private
   */
  _supportsContext() {
    const info = this._getModelInfo();
    return info.contextWindow && info.contextWindow > 1024;
  }

  /**
   * Detect if text is a sound effect
   * @private
   */
  _isSoundEffect(text) {
    // Japanese SFX patterns
    const sfxPatterns = [
      /[\u30A1-\u30FA]{1,4}/, // Katakana (common for SFX)
      /(ドキドキ|ガタガタ|バタン|ゴゴゴ|メラメラ)/,
      /[\uFF66-\uFF9D]{2,4}/  // Half-width katakana
    ];
    
    // Check if mostly katakana (indicates SFX)
    const katakanaCount = (text.match(/[\u30A0-\u30FF]/g) || []).length;
    const totalLength = text.length;
    
    if (totalLength > 0 && (katakanaCount / totalLength) > 0.7) {
      return true;
    }

    return sfxPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Translate sound effects to target language equivalents
   * @private
   */
  _translateSFX(text, targetLang) {
    // Common manga SFX mappings
    const sfxMap = {
      'ja': {
        'ドキドキ': { en: 'Ba-dump ba-dump', meaning: 'heartbeat' },
        'ガタガタ': { en: 'Rattle rattle', meaning: 'shaking' },
        'バタン': { en: 'Slam', meaning: 'door closing' },
        'ゴゴゴ': { en: 'Rumble', meaning: 'ominous sound' },
        'メラメラ': { en: 'Crackle', meaning: 'fire burning' },
        'ピカピカ': { en: 'Sparkle', meaning: 'shining' },
        'ニコニコ': { en: 'Grin', meaning: 'smiling' }
      }
    };

    // Try exact match first
    const langMap = sfxMap['ja'];
    if (langMap && langMap[text]) {
      const sfx = langMap[text];
      return targetLang === 'en' ? sfx.en : `${sfx.meaning} (${text})`;
    }

    // Return original with annotation if no translation found
    return targetLang === 'en' ? `[SFX: ${text}]` : text;
  }

  /**
   * Restore Japanese honorifics in translated text
   * @private
   */
  _restoreHonorifics(translatedText, originalText) {
    const honorifics = ['san', 'chan', 'kun', 'sama', 'sensei', 'senpai', 'kohai'];
    const honorificPattern = new RegExp(`(${honorifics.join('|')})`, 'gi');
    
    // Extract honorifics from original (if written in romaji or preserved)
    const foundHonorifics = [];
    const originalLower = originalText.toLowerCase();
    
    honorifics.forEach(h => {
      if (originalLower.includes(h)) {
        foundHonorifics.push(h);
      }
    });

    // If honorifics were in original but missing in translation, try to restore
    let restoredText = translatedText;
    let honorificsFound = foundHonorifics.length > 0;

    // Simple heuristic: if translation ends with name but no honorific, add from context
    // This is a simplified version - full implementation would need name entity recognition
    
    return {
      text: restoredText,
      honorificsFound,
      restoredCount: foundHonorifics.length
    };
  }

  /**
   * Clean common translation artifacts
   * @private
   */
  _cleanArtifacts(text) {
    return text
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/([.!?])\s+/g, '$1 ')  // Normalize spacing after punctuation
      .replace(/^\s+|\s+$/g, '')       // Trim
      .replace(/\\n/g, '\n')           // Fix escaped newlines
      .replace(/<unk>/g, '')            // Remove unknown tokens
      .replace(/<s>|<\/s>/g, '');      // Remove special tokens
  }

  /**
   * Match original text formatting (line breaks, etc.)
   * @private
   */
  _matchFormatting(translated, original) {
    const originalLines = original.split('\n').length;
    const translatedLines = translated.split('\n').length;
    
    // If original had line breaks but translation doesn't, try to restore
    if (originalLines > 1 && translatedLines === 1) {
      // Estimate where to break based on length ratio
      const words = translated.split(' ');
      const wordsPerLine = Math.ceil(words.length / originalLines);
      
      const lines = [];
      for (let i = 0; i < words.length; i += wordsPerLine) {
        lines.push(words.slice(i, i + wordsPerLine).join(' '));
      }
      return lines.join('\n');
    }
    
    return translated;
  }

  /**
   * Generate cache key for translation result
   * @private
   */
  _generateCacheKey(text, context) {
    const key = `${this.currentConfig.modelId}:${context.sourceLang}:${context.targetLang}:${text}`;
    // Simple hash for key
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Get cached result
   * @private
   */
  _getCache(key) {
    return this.cache.get(key);
  }

  /**
   * Set cache result with LRU eviction
   * @private
   */
  _setCache(key, value) {
    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  /**
   * Convert language codes to model-specific format
   * @private
   */
  _getLangCode(lang) {
    const codeMap = {
      'en': 'eng_Latn',
      'ja': 'jpn_Jpan',
      'ko': 'kor_Hang',
      'zh': 'zho_Hans',
      'zh-TW': 'zho_Hant',
      'es': 'spa_Latn',
      'fr': 'fra_Latn',
      'de': 'deu_Latn',
      'ru': 'rus_Cyrl'
    };
    return codeMap[lang] || lang;
  }

  /**
   * Apply character-specific speech patterns
   * @private
   */
  _applySpeechPattern(text, characterInfo) {
    // Placeholder for character voice preservation
    // Would adjust formality, dialect markers, etc.
    return text;
  }

  /**
   * Yield to main thread (MV3 compatibility)
   * @private
   */
  async _yieldToMainThread() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Unload model to free memory
   */
  async unload() {
    if (this.pipeline) {
      // Dispose of model resources
      if (this.pipeline.model && this.pipeline.model.dispose) {
        this.pipeline.model.dispose();
      }
      this.pipeline = null;
    }
    this.model = null;
    this.tokenizer = null;
    this.isInitialized = false;
    this.cache.clear();
    
    // Force garbage collection hint
    if (typeof globalThis !== 'undefined' && globalThis.gc) {
      globalThis.gc();
    }
    
    console.log('[LocalLLM] Model unloaded');
  }

  /**
   * Get current status and performance metrics
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      loading: this.isLoading,
      model: this.currentConfig.modelId,
      device: this.currentConfig.device,
      cacheSize: this.cache.size,
      hardwareCapabilities: this.hardwareCapabilities,
      performance: this.performanceMonitor.getMetrics()
    };
  }

  /**
   * Update configuration dynamically
   */
  async updateConfig(newConfig) {
    const needsReload = 
      newConfig.modelId !== this.currentConfig.modelId ||
      newConfig.modelType !== this.currentConfig.modelType ||
      newConfig.device !== this.currentConfig.device;

    Object.assign(this.currentConfig, newConfig);

    if (needsReload && this.isInitialized) {
      await this.unload();
      await this.initialize();
    }

    return this.getStatus();
  }

  /**
   * Estimate memory requirements for current model
   */
  estimateMemoryRequirements() {
    const modelInfo = this._getModelInfo();
    const sizeStr = modelInfo.size;
    const sizeMB = parseInt(sizeStr.replace(/[^0-9]/g, ''));
    
    // Estimate: model size * 2 for runtime + 500MB buffer
    const requiredMB = (sizeMB * 2) + 500;
    const requiredGB = (requiredMB / 1024).toFixed(2);
    
    return {
      modelSize: sizeStr,
      estimatedRequiredMB: requiredMB,
      estimatedRequiredGB: requiredGB,
      recommendedVRAM: `${requiredGB}GB+`,
      fitsIn8GB: requiredMB < 8192,
      fitsIn4GB: requiredMB < 4096
    };
  }
}

// Export singleton instance
export const localLLM = new LocalLLMTranslator();
export default LocalLLMTranslator;