// ui/options/pages/translation-settings.js

import { ConfigManager } from '../../../core/shared/config-manager.js';
import { I18n } from '../../../core/shared/i18n/i18n.js';
import { EventEmitter } from '../../../core/shared/utils/event-emitter.js';

/**
 * Translation Settings Page Controller
 * Manages translation engines, API configurations, and manga-specific translation preferences
 */
export class TranslationSettings {
  constructor() {
    this.config = new ConfigManager();
    this.i18n = new I18n();
    this.events = new EventEmitter();
    
    this.container = null;
    this.settings = {};
    this.apiStatus = new Map(); // Cache for API connection tests
    this.initialized = false;
  }

  /**
   * Initialize the translation settings page
   * @param {HTMLElement} container - DOM container for settings
   */
  async init(container) {
    this.container = container;
    await this.loadSettings();
    await this.testApiConnections();
    this.render();
    this.attachEventListeners();
    this.initialized = true;
    
    this.events.emit('translationSettings:initialized', this.settings);
  }

  /**
   * Load current settings from storage
   */
  async loadSettings() {
    const defaults = {
      // Primary Engine
      primaryEngine: 'google', // 'google', 'deepl', 'openai', 'local'
      
      // Fallback Configuration
      fallbackEnabled: true,
      fallbackEngine: 'google',
      fallbackOnError: true,
      fallbackOnQuota: true,
      
      // Google Translate Settings
      google: {
        apiKey: '',
        useFreeTier: true,
        region: 'global'
      },
      
      // DeepL Settings
      deepl: {
        apiKey: '',
        usePro: false,
        formality: 'default', // 'default', 'more', 'less'
        glossaryId: ''
      },
      
      // OpenAI/GPT Settings
      openai: {
        apiKey: '',
        model: 'gpt-4o', // 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'
        temperature: 0.3,
        maxTokens: 2000,
        useVision: true,
        systemPrompt: '',
        customPrompts: {
          manga: '',
          sfx: '',
          honorifics: ''
        }
      },
      
      // Local LLM Settings (Future/Ollama)
      local: {
        enabled: false,
        endpoint: 'http://localhost:11434',
        model: 'llama2',
        timeout: 30000
      },
      
      // Context & Preservation
      contextWindow: 3, // Number of previous bubbles for context
      preserveNames: true,
      preserveHonorifics: true,
      honorificStyle: 'keep', // 'keep', 'translate', 'remove'
      
      // Manga-Specific
      translateSFX: true,
      sfxStyle: 'adaptive', // 'adaptive', 'literal', 'ignore'
      sfxGlossary: {},
      verticalTextHandling: 'rotate', // 'rotate', 'vertical', 'horizontal'
      
      // Quality & Review
      enableReviewMode: false,
      confidenceThreshold: 0.7,
      flagLowConfidence: true,
      
      // Caching
      translationCache: true,
      cacheStrategy: 'aggressive' // 'conservative', 'aggressive', 'none'
    };

    this.settings = await this.config.get('translation', defaults);
  }

  /**
   * Test API connection statuses
   */
  async testApiConnections() {
    const engines = ['google', 'deepl', 'openai'];
    
    for (const engine of engines) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'testApiConnection',
          engine: engine,
          config: this.settings[engine]
        });
        this.apiStatus.set(engine, response.success ? 'connected' : 'error');
      } catch (e) {
        this.apiStatus.set(engine, 'unknown');
      }
    }
  }

  /**
   * Render the settings UI
   */
  render() {
    this.container.innerHTML = `
      <div class="settings-page translation-settings">
        <header class="settings-header">
          <h1>${this.i18n.get('translation_settings_title')}</h1>
          <p class="settings-description">${this.i18n.get('translation_settings_desc')}</p>
        </header>

        <div class="settings-content">
          ${this.renderEngineSelection()}
          ${this.renderGoogleSettings()}
          ${this.renderDeepLSettings()}
          ${this.renderOpenAISettings()}
          ${this.renderLocalLLMSettings()}
          ${this.renderContextSettings()}
          ${this.renderMangaSpecificSettings()}
          ${this.renderQualitySettings()}
        </div>

        <div class="settings-actions">
          <button class="btn-secondary" id="test-all-apis">
            ${this.i18n.get('test_api_connections')}
          </button>
          <button class="btn-secondary" id="reset-translation-settings">
            ${this.i18n.get('reset_to_defaults')}
          </button>
          <button class="btn-primary" id="save-translation-settings">
            ${this.i18n.get('save_changes')}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Engine Selection & Fallback Section
   */
  renderEngineSelection() {
    const engines = [
      { id: 'google', name: 'Google Translate', icon: '🔍', status: this.apiStatus.get('google') },
      { id: 'deepl', name: 'DeepL', icon: '🧠', status: this.apiStatus.get('deepl') },
      { id: 'openai', name: 'OpenAI GPT-4', icon: '✨', status: this.apiStatus.get('openai') },
      { id: 'local', name: 'Local LLM (Ollama)', icon: '💻', status: 'local' }
    ];

    return `
      <section class="setting-group" data-section="engines">
        <h2>${this.i18n.get('translation_engines')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('primary_engine')}</label>
              <p class="setting-help">${this.i18n.get('primary_engine_help')}</p>
            </div>
            <div class="setting-control">
              <div class="engine-selector">
                ${engines.map(engine => `
                  <div class="engine-option ${this.settings.primaryEngine === engine.id ? 'active' : ''}" 
                       data-engine="${engine.id}">
                    <span class="engine-icon">${engine.icon}</span>
                    <span class="engine-name">${engine.name}</span>
                    <span class="engine-status status-${engine.status || 'unknown'}"></span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('enable_fallback')}</label>
              <p class="setting-help">${this.i18n.get('enable_fallback_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="fallback-enabled" 
                       ${this.settings.fallbackEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="fallback-options"
               style="${!this.settings.fallbackEnabled ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('fallback_engine')}</label>
            </div>
            <div class="setting-control">
              <select id="fallback-engine" class="select-styled">
                ${engines.filter(e => e.id !== 'local').map(engine => `
                  <option value="${engine.id}" ${this.settings.fallbackEngine === engine.id ? 'selected' : ''}>
                    ${engine.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Google Translate Configuration
   */
  renderGoogleSettings() {
    const isActive = this.settings.primaryEngine === 'google' || this.settings.fallbackEngine === 'google';
    
    return `
      <section class="setting-group api-config ${isActive ? 'active-api' : ''}" data-api="google">
        <h2>
          <span class="api-icon">🔍</span>
          Google Translate
          <span class="api-badge ${this.apiStatus.get('google') === 'connected' ? 'badge-success' : 'badge-neutral'}">
            ${this.apiStatus.get('google') === 'connected' ? this.i18n.get('connected') : this.i18n.get('not_configured')}
          </span>
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('use_free_tier')}</label>
              <p class="setting-help">${this.i18n.get('google_free_tier_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="google-free-tier" 
                       ${this.settings.google.useFreeTier ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="google-api-key-row"
               style="${this.settings.google.useFreeTier ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('google_api_key')}</label>
              <p class="setting-help">${this.i18n.get('google_api_key_help')}</p>
            </div>
            <div class="setting-control">
              <div class="api-key-input">
                <input type="password" id="google-api-key" 
                       value="${this.settings.google.apiKey}" 
                       placeholder="${this.i18n.get('enter_api_key')}">
                <button class="btn-icon toggle-visibility" title="${this.i18n.get('show_hide')}">👁️</button>
                <button class="btn-icon test-api" data-api="google" title="${this.i18n.get('test_connection')}">▶️</button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('google_region')}</label>
            </div>
            <div class="setting-control">
              <select id="google-region" class="select-styled">
                <option value="global" ${this.settings.google.region === 'global' ? 'selected' : ''}>Global</option>
                <option value="us" ${this.settings.google.region === 'us' ? 'selected' : ''}>US (North America)</option>
                <option value="eu" ${this.settings.google.region === 'eu' ? 'selected' : ''}>EU (Europe)</option>
                <option value="asia" ${this.settings.google.region === 'asia' ? 'selected' : ''}>Asia Pacific</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * DeepL Configuration
   */
  renderDeepLSettings() {
    const isActive = this.settings.primaryEngine === 'deepl' || this.settings.fallbackEngine === 'deepl';
    
    return `
      <section class="setting-group api-config ${isActive ? 'active-api' : ''}" data-api="deepl">
        <h2>
          <span class="api-icon">🧠</span>
          DeepL
          <span class="api-badge ${this.apiStatus.get('deepl') === 'connected' ? 'badge-success' : 'badge-neutral'}">
            ${this.apiStatus.get('deepl') === 'connected' ? this.i18n.get('connected') : this.i18n.get('not_configured')}
          </span>
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('deepl_api_key')}</label>
              <p class="setting-help">${this.i18n.get('deepl_api_key_help')}</p>
            </div>
            <div class="setting-control">
              <div class="api-key-input">
                <input type="password" id="deepl-api-key" 
                       value="${this.settings.deepl.apiKey}" 
                       placeholder="${this.i18n.get('enter_api_key')}">
                <button class="btn-icon toggle-visibility" title="${this.i18n.get('show_hide')}">👁️</button>
                <button class="btn-icon test-api" data-api="deepl" title="${this.i18n.get('test_connection')}">▶️</button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('deepl_plan')}</label>
            </div>
            <div class="setting-control">
              <select id="deepl-pro" class="select-styled">
                <option value="free" ${!this.settings.deepl.usePro ? 'selected' : ''}>DeepL Free</option>
                <option value="pro" ${this.settings.deepl.usePro ? 'selected' : ''}>DeepL Pro</option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('formality')}</label>
              <p class="setting-help">${this.i18n.get('formality_help')}</p>
            </div>
            <div class="setting-control">
              <select id="deepl-formality" class="select-styled">
                <option value="default" ${this.settings.deepl.formality === 'default' ? 'selected' : ''}>
                  ${this.i18n.get('formality_default')}
                </option>
                <option value="more" ${this.settings.deepl.formality === 'more' ? 'selected' : ''}>
                  ${this.i18n.get('formality_more')}
                </option>
                <option value="less" ${this.settings.deepl.formality === 'less' ? 'selected' : ''}>
                  ${this.i18n.get('formality_less')}
                </option>
              </select>
            </div>
          </div>

          <div class="setting-row pro-feature">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('glossary_id')}</label>
              <p class="setting-help">${this.i18n.get('glossary_help')}</p>
            </div>
            <div class="setting-control">
              <input type="text" id="deepl-glossary" 
                     value="${this.settings.deepl.glossaryId}" 
                     placeholder="${this.i18n.get('optional_glossary_id')}">
              <span class="badge badge-pro">PRO</span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * OpenAI/GPT Configuration
   */
  renderOpenAISettings() {
    const isActive = this.settings.primaryEngine === 'openai';
    const models = [
      { id: 'gpt-4o', name: 'GPT-4o (Recommended)', desc: 'Best quality, vision capable' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Fast, cost-effective' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', desc: 'High quality, higher cost' }
    ];

    return `
      <section class="setting-group api-config ${isActive ? 'active-api' : ''}" data-api="openai">
        <h2>
          <span class="api-icon">✨</span>
          OpenAI GPT-4 Vision
          <span class="api-badge ${this.apiStatus.get('openai') === 'connected' ? 'badge-success' : 'badge-neutral'}">
            ${this.apiStatus.get('openai') === 'connected' ? this.i18n.get('connected') : this.i18n.get('not_configured')}
          </span>
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('openai_api_key')}</label>
              <p class="setting-help">${this.i18n.get('openai_api_key_help')}</p>
            </div>
            <div class="setting-control">
              <div class="api-key-input">
                <input type="password" id="openai-api-key" 
                       value="${this.settings.openai.apiKey}" 
                       placeholder="sk-...">
                <button class="btn-icon toggle-visibility" title="${this.i18n.get('show_hide')}">👁️</button>
                <button class="btn-icon test-api" data-api="openai" title="${this.i18n.get('test_connection')}">▶️</button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('gpt_model')}</label>
              <p class="setting-help">${this.i18n.get('gpt_model_help')}</p>
            </div>
            <div class="setting-control">
              <select id="openai-model" class="select-styled">
                ${models.map(model => `
                  <option value="${model.id}" ${this.settings.openai.model === model.id ? 'selected' : ''}>
                    ${model.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('enable_vision')}</label>
              <p class="setting-help">${this.i18n.get('enable_vision_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="openai-vision" 
                       ${this.settings.openai.useVision ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('temperature')}</label>
              <p class="setting-help">${this.i18n.get('temperature_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="openai-temperature" min="0" max="1" step="0.1" 
                     value="${this.settings.openai.temperature}">
              <span class="range-value">${this.settings.openai.temperature}</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('max_tokens')}</label>
            </div>
            <div class="setting-control">
              <input type="number" id="openai-max-tokens" 
                     value="${this.settings.openai.maxTokens}" 
                     min="100" max="4000" step="100">
            </div>
          </div>

          <div class="setting-row advanced-setting">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('custom_system_prompt')}</label>
              <p class="setting-help">${this.i18n.get('system_prompt_help')}</p>
            </div>
            <div class="setting-control">
              <textarea id="openai-system-prompt" rows="4" 
                        placeholder="${this.i18n.get('system_prompt_placeholder')}">${this.settings.openai.systemPrompt}</textarea>
            </div>
          </div>

          <div class="setting-row advanced-setting">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('manga_translation_prompt')}</label>
            </div>
            <div class="setting-control">
              <textarea id="openai-manga-prompt" rows="3" 
                        placeholder="${this.i18n.get('manga_prompt_placeholder')}">${this.settings.openai.customPrompts.manga}</textarea>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Local LLM (Ollama) Configuration
   */
  renderLocalLLMSettings() {
    return `
      <section class="setting-group api-config" data-api="local">
        <h2>
          <span class="api-icon">💻</span>
          Local LLM (Ollama)
          <span class="badge badge-beta">BETA</span>
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('enable_local_llm')}</label>
              <p class="setting-help">${this.i18n.get('local_llm_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="local-enabled" 
                       ${this.settings.local.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="local-endpoint-row"
               style="${!this.settings.local.enabled ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('ollama_endpoint')}</label>
              <p class="setting-help">${this.i18n.get('ollama_endpoint_help')}</p>
            </div>
            <div class="setting-control">
              <input type="url" id="local-endpoint" 
                     value="${this.settings.local.endpoint}" 
                     placeholder="http://localhost:11434">
              <button class="btn-icon test-api" data-api="local" title="${this.i18n.get('test_connection')}">▶️</button>
            </div>
          </div>

          <div class="setting-row conditional" id="local-model-row"
               style="${!this.settings.local.enabled ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('local_model')}</label>
            </div>
            <div class="setting-control">
              <input type="text" id="local-model" 
                     value="${this.settings.local.model}" 
                     placeholder="llama2, mistral, etc.">
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Context Preservation Settings
   */
  renderContextSettings() {
    return `
      <section class="setting-group" data-section="context">
        <h2>${this.i18n.get('context_preservation')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('context_window')}</label>
              <p class="setting-help">${this.i18n.get('context_window_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="context-window" min="0" max="10" step="1" 
                     value="${this.settings.contextWindow}">
              <span class="range-value">${this.settings.contextWindow} ${this.i18n.get('bubbles')}</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('preserve_names')}</label>
              <p class="setting-help">${this.i18n.get('preserve_names_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="preserve-names" 
                       ${this.settings.preserveNames ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('preserve_honorifics')}</label>
              <p class="setting-help">${this.i18n.get('preserve_honorifics_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="preserve-honorifics" 
                       ${this.settings.preserveHonorifics ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="honorific-style-row"
               style="${!this.settings.preserveHonorifics ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('honorific_style')}</label>
            </div>
            <div class="setting-control">
              <select id="honorific-style" class="select-styled">
                <option value="keep" ${this.settings.honorificStyle === 'keep' ? 'selected' : ''}>
                  ${this.i18n.get('honorific_keep')} (san, kun, chan)
                </option>
                <option value="translate" ${this.settings.honorificStyle === 'translate' ? 'selected' : ''}>
                  ${this.i18n.get('honorific_translate')} (Mr., Ms., etc.)
                </option>
                <option value="remove" ${this.settings.honorificStyle === 'remove' ? 'selected' : ''}>
                  ${this.i18n.get('honorific_remove')}
                </option>
              </select>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Manga-Specific Translation Settings
   */
  renderMangaSpecificSettings() {
    return `
      <section class="setting-group" data-section="manga">
        <h2>${this.i18n.get('manga_specific')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('translate_sfx')}</label>
              <p class="setting-help">${this.i18n.get('translate_sfx_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="translate-sfx" 
                       ${this.settings.translateSFX ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="sfx-style-row"
               style="${!this.settings.translateSFX ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('sfx_translation_style')}</label>
            </div>
            <div class="setting-control">
              <div class="sfx-style-selector">
                <button class="sfx-style-btn ${this.settings.sfxStyle === 'adaptive' ? 'active' : ''}" 
                        data-style="adaptive">
                  <span class="style-name">${this.i18n.get('sfx_adaptive')}</span>
                  <span class="style-desc">${this.i18n.get('sfx_adaptive_desc')}</span>
                </button>
                <button class="sfx-style-btn ${this.settings.sfxStyle === 'literal' ? 'active' : ''}" 
                        data-style="literal">
                  <span class="style-name">${this.i18n.get('sfx_literal')}</span>
                  <span class="style-desc">${this.i18n.get('sfx_literal_desc')}</span>
                </button>
                <button class="sfx-style-btn ${this.settings.sfxStyle === 'ignore' ? 'active' : ''}" 
                        data-style="ignore">
                  <span class="style-name">${this.i18n.get('sfx_ignore')}</span>
                  <span class="style-desc">${this.i18n.get('sfx_ignore_desc')}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('vertical_text')}</label>
              <p class="setting-help">${this.i18n.get('vertical_text_help')}</p>
            </div>
            <div class="setting-control">
              <select id="vertical-text" class="select-styled">
                <option value="rotate" ${this.settings.verticalTextHandling === 'rotate' ? 'selected' : ''}>
                  ${this.i18n.get('vertical_rotate')} (Rotate for reading)
                </option>
                <option value="vertical" ${this.settings.verticalTextHandling === 'vertical' ? 'selected' : ''}>
                  ${this.i18n.get('vertical_keep')} (Keep vertical layout)
                </option>
                <option value="horizontal" ${this.settings.verticalTextHandling === 'horizontal' ? 'selected' : ''}>
                  ${this.i18n.get('vertical_convert')} (Convert to horizontal)
                </option>
              </select>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Quality & Review Settings
   */
  renderQualitySettings() {
    return `
      <section class="setting-group" data-section="quality">
        <h2>${this.i18n.get('quality_review')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('enable_review_mode')}</label>
              <p class="setting-help">${this.i18n.get('review_mode_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="review-mode" 
                       ${this.settings.enableReviewMode ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span class="badge badge-pro">PRO</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('confidence_threshold')}</label>
              <p class="setting-help">${this.i18n.get('confidence_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="confidence-threshold" min="0" max="1" step="0.05" 
                     value="${this.settings.confidenceThreshold}">
              <span class="range-value">${Math.round(this.settings.confidenceThreshold * 100)}%</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('flag_low_confidence')}</label>
              <p class="setting-help">${this.i18n.get('flag_low_confidence_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="flag-low-confidence" 
                       ${this.settings.flagLowConfidence ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('cache_strategy')}</label>
              <p class="setting-help">${this.i18n.get('cache_strategy_help')}</p>
            </div>
            <div class="setting-control">
              <select id="cache-strategy" class="select-styled">
                <option value="aggressive" ${this.settings.cacheStrategy === 'aggressive' ? 'selected' : ''}>
                  ${this.i18n.get('cache_aggressive')} (Max savings)
                </option>
                <option value="conservative" ${this.settings.cacheStrategy === 'conservative' ? 'selected' : ''}>
                  ${this.i18n.get('cache_conservative')} (Balance)
                </option>
                <option value="none" ${this.settings.cacheStrategy === 'none' ? 'selected' : ''}>
                  ${this.i18n.get('cache_none')} (Always fresh)
                </option>
              </select>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Engine selection
    this.container.querySelectorAll('.engine-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const engine = e.currentTarget.dataset.engine;
        this.selectEngine(engine);
      });
    });

    // Fallback toggle
    const fallbackToggle = this.container.querySelector('#fallback-enabled');
    fallbackToggle?.addEventListener('change', (e) => {
      this.settings.fallbackEnabled = e.target.checked;
      this.toggleConditionalRow('fallback-options', e.target.checked);
      this.highlightActiveApis();
    });

    const fallbackEngine = this.container.querySelector('#fallback-engine');
    fallbackEngine?.addEventListener('change', (e) => {
      this.settings.fallbackEngine = e.target.value;
      this.highlightActiveApis();
    });

    // Google settings
    const googleFreeTier = this.container.querySelector('#google-free-tier');
    googleFreeTier?.addEventListener('change', (e) => {
      this.settings.google.useFreeTier = e.target.checked;
      this.toggleConditionalRow('google-api-key-row', !e.target.checked);
    });

    const googleApiKey = this.container.querySelector('#google-api-key');
    googleApiKey?.addEventListener('change', (e) => {
      this.settings.google.apiKey = e.target.value;
    });

    const googleRegion = this.container.querySelector('#google-region');
    googleRegion?.addEventListener('change', (e) => {
      this.settings.google.region = e.target.value;
    });

    // DeepL settings
    const deeplApiKey = this.container.querySelector('#deepl-api-key');
    deeplApiKey?.addEventListener('change', (e) => {
      this.settings.deepl.apiKey = e.target.value;
    });

    const deeplPro = this.container.querySelector('#deepl-pro');
    deeplPro?.addEventListener('change', (e) => {
      this.settings.deepl.usePro = e.target.value === 'pro';
    });

    const deeplFormality = this.container.querySelector('#deepl-formality');
    deeplFormality?.addEventListener('change', (e) => {
      this.settings.deepl.formality = e.target.value;
    });

    const deeplGlossary = this.container.querySelector('#deepl-glossary');
    deeplGlossary?.addEventListener('change', (e) => {
      this.settings.deepl.glossaryId = e.target.value;
    });

    // OpenAI settings
    const openaiApiKey = this.container.querySelector('#openai-api-key');
    openaiApiKey?.addEventListener('change', (e) => {
      this.settings.openai.apiKey = e.target.value;
    });

    const openaiModel = this.container.querySelector('#openai-model');
    openaiModel?.addEventListener('change', (e) => {
      this.settings.openai.model = e.target.value;
    });

    const openaiVision = this.container.querySelector('#openai-vision');
    openaiVision?.addEventListener('change', (e) => {
      this.settings.openai.useVision = e.target.checked;
    });

    const openaiTemp = this.container.querySelector('#openai-temperature');
    openaiTemp?.addEventListener('input', (e) => {
      this.settings.openai.temperature = parseFloat(e.target.value);
      e.target.nextElementSibling.textContent = e.target.value;
    });

    const openaiMaxTokens = this.container.querySelector('#openai-max-tokens');
    openaiMaxTokens?.addEventListener('change', (e) => {
      this.settings.openai.maxTokens = parseInt(e.target.value);
    });

    const openaiSystemPrompt = this.container.querySelector('#openai-system-prompt');
    openaiSystemPrompt?.addEventListener('change', (e) => {
      this.settings.openai.systemPrompt = e.target.value;
    });

    const openaiMangaPrompt = this.container.querySelector('#openai-manga-prompt');
    openaiMangaPrompt?.addEventListener('change', (e) => {
      this.settings.openai.customPrompts.manga = e.target.value;
    });

    // Local LLM settings
    const localEnabled = this.container.querySelector('#local-enabled');
    localEnabled?.addEventListener('change', (e) => {
      this.settings.local.enabled = e.target.checked;
      this.toggleConditionalRow('local-endpoint-row', e.target.checked);
      this.toggleConditionalRow('local-model-row', e.target.checked);
    });

    const localEndpoint = this.container.querySelector('#local-endpoint');
    localEndpoint?.addEventListener('change', (e) => {
      this.settings.local.endpoint = e.target.value;
    });

    const localModel = this.container.querySelector('#local-model');
    localModel?.addEventListener('change', (e) => {
      this.settings.local.model = e.target.value;
    });

    // Context settings
    const contextWindow = this.container.querySelector('#context-window');
    contextWindow?.addEventListener('input', (e) => {
      this.settings.contextWindow = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value} ${this.i18n.get('bubbles')}`;
    });

    const preserveNames = this.container.querySelector('#preserve-names');
    preserveNames?.addEventListener('change', (e) => {
      this.settings.preserveNames = e.target.checked;
    });

    const preserveHonorifics = this.container.querySelector('#preserve-honorifics');
    preserveHonorifics?.addEventListener('change', (e) => {
      this.settings.preserveHonorifics = e.target.checked;
      this.toggleConditionalRow('honorific-style-row', e.target.checked);
    });

    const honorificStyle = this.container.querySelector('#honorific-style');
    honorificStyle?.addEventListener('change', (e) => {
      this.settings.honorificStyle = e.target.value;
    });

    // Manga settings
    const translateSfx = this.container.querySelector('#translate-sfx');
    translateSfx?.addEventListener('change', (e) => {
      this.settings.translateSFX = e.target.checked;
      this.toggleConditionalRow('sfx-style-row', e.target.checked);
    });

    this.container.querySelectorAll('.sfx-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.sfx-style-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.settings.sfxStyle = e.currentTarget.dataset.style;
      });
    });

    const verticalText = this.container.querySelector('#vertical-text');
    verticalText?.addEventListener('change', (e) => {
      this.settings.verticalTextHandling = e.target.value;
    });

    // Quality settings
    const reviewMode = this.container.querySelector('#review-mode');
    reviewMode?.addEventListener('change', (e) => {
      this.settings.enableReviewMode = e.target.checked;
    });

    const confidenceThreshold = this.container.querySelector('#confidence-threshold');
    confidenceThreshold?.addEventListener('input', (e) => {
      this.settings.confidenceThreshold = parseFloat(e.target.value);
      e.target.nextElementSibling.textContent = `${Math.round(e.target.value * 100)}%`;
    });

    const flagLowConfidence = this.container.querySelector('#flag-low-confidence');
    flagLowConfidence?.addEventListener('change', (e) => {
      this.settings.flagLowConfidence = e.target.checked;
    });

    const cacheStrategy = this.container.querySelector('#cache-strategy');
    cacheStrategy?.addEventListener('change', (e) => {
      this.settings.cacheStrategy = e.target.value;
    });

    // API testing
    this.container.querySelectorAll('.test-api').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const api = e.currentTarget.dataset.api;
        this.testApiConnection(api);
      });
    });

    // Visibility toggles
    this.container.querySelectorAll('.toggle-visibility').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const input = e.currentTarget.previousElementSibling;
        input.type = input.type === 'password' ? 'text' : 'password';
        e.currentTarget.textContent = input.type === 'password' ? '👁️' : '🙈';
      });
    });

    // Action buttons
    const testAllBtn = this.container.querySelector('#test-all-apis');
    testAllBtn?.addEventListener('click', () => this.testAllApis());

    const saveBtn = this.container.querySelector('#save-translation-settings');
    saveBtn?.addEventListener('click', () => this.save());

    const resetBtn = this.container.querySelector('#reset-translation-settings');
    resetBtn?.addEventListener('click', () => this.resetToDefaults());
  }

  /**
   * Select primary translation engine
   */
  selectEngine(engine) {
    this.settings.primaryEngine = engine;
    
    // Update UI
    this.container.querySelectorAll('.engine-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.engine === engine);
    });
    
    this.highlightActiveApis();
    this.events.emit('engineChanged', engine);
  }

  /**
   * Highlight APIs that are in use
   */
  highlightActiveApis() {
    const primary = this.settings.primaryEngine;
    const fallback = this.settings.fallbackEngine;
    
    this.container.querySelectorAll('.api-config').forEach(section => {
      const api = section.dataset.api;
      const isActive = api === primary || (this.settings.fallbackEnabled && api === fallback);
      section.classList.toggle('active-api', isActive);
    });
  }

  /**
   * Test individual API connection
   */
  async testApiConnection(api) {
    const btn = this.container.querySelector(`.test-api[data-api="${api}"]`);
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testApiConnection',
        engine: api,
        config: this.settings[api]
      });

      this.apiStatus.set(api, response.success ? 'connected' : 'error');
      
      // Update badge
      const section = this.container.querySelector(`[data-api="${api}"]`);
      const badge = section?.querySelector('.api-badge');
      if (badge) {
        badge.className = `api-badge ${response.success ? 'badge-success' : 'badge-error'}`;
        badge.textContent = response.success ? this.i18n.get('connected') : this.i18n.get('error');
      }

      this.showToast(
        response.success ? this.i18n.get('api_test_success', { api }) : this.i18n.get('api_test_failed', { api }),
        response.success ? 'success' : 'error'
      );
    } catch (error) {
      this.showToast(this.i18n.get('api_test_error', { api }), 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  /**
   * Test all API connections
   */
  async testAllApis() {
    const apis = ['google', 'deepl', 'openai'];
    for (const api of apis) {
      await this.testApiConnection(api);
    }
  }

  /**
   * Toggle conditional row visibility
   */
  toggleConditionalRow(rowId, show) {
    const row = this.container.querySelector(`#${rowId}`);
    if (row) {
      row.style.display = show ? 'flex' : 'none';
      if (show) row.classList.add('fade-in');
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }, 100);
  }

  /**
   * Save settings to storage
   */
  async save() {
    try {
      // Validate required fields
      if (this.settings.primaryEngine === 'google' && !this.settings.google.useFreeTier && !this.settings.google.apiKey) {
        throw new Error(this.i18n.get('error_google_key_required'));
      }
      if (this.settings.primaryEngine === 'deepl' && !this.settings.deepl.apiKey) {
        throw new Error(this.i18n.get('error_deepl_key_required'));
      }
      if (this.settings.primaryEngine === 'openai' && !this.settings.openai.apiKey) {
        throw new Error(this.i18n.get('error_openai_key_required'));
      }

      await this.config.set('translation', this.settings);
      this.events.emit('translationSettings:saved', this.settings);
      this.showToast(this.i18n.get('settings_saved'), 'success');

      // Notify background script
      chrome.runtime.sendMessage({
        action: 'translationSettingsUpdated',
        settings: this.settings
      });
    } catch (error) {
      this.showToast(error.message || this.i18n.get('save_error'), 'error');
    }
  }

  /**
   * Reset to default settings
   */
  async resetToDefaults() {
    if (confirm(this.i18n.get('reset_translation_confirm'))) {
      await this.config.remove('translation');
      await this.loadSettings();
      this.render();
      this.attachEventListeners();
      this.showToast(this.i18n.get('settings_reset'), 'success');
      this.events.emit('translationSettings:reset');
    }
  }

  /**
   * Get current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Destroy the settings page
   */
  destroy() {
    this.events.removeAllListeners();
    this.initialized = false;
  }
}

// Export for use in options page
export default TranslationSettings;