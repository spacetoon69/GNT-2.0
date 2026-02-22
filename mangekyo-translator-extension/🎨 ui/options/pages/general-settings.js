// ui/options/pages/general-settings.js

import { ConfigManager } from '../../../core/shared/config-manager.js';
import { I18n } from '../../../core/shared/i18n/i18n.js';
import { EventEmitter } from '../../../core/shared/utils/event-emitter.js';

/**
 * General Settings Page Controller
 * Manages core extension behavior, activation modes, and system preferences
 */
export class GeneralSettings {
  constructor() {
    this.config = new ConfigManager();
    this.i18n = new I18n();
    this.events = new EventEmitter();
    
    this.container = null;
    this.settings = {};
    this.initialized = false;
  }

  /**
   * Initialize the general settings page
   * @param {HTMLElement} container - DOM container for settings
   */
  async init(container) {
    this.container = container;
    await this.loadSettings();
    this.render();
    this.attachEventListeners();
    this.initialized = true;
    
    this.events.emit('generalSettings:initialized', this.settings);
  }

  /**
   * Load current settings from storage
   */
  async loadSettings() {
    const defaults = {
      // Activation & Behavior
      activationMode: 'click', // 'click', 'hover', 'auto', 'hotkey'
      autoTranslate: false,
      translationDelay: 500, // ms for hover mode
      
      // Language Preferences
      sourceLanguage: 'auto', // 'auto', 'ja', 'ko', 'zh', 'en'
      targetLanguage: navigator.language.split('-')[0] || 'en',
      
      // UI Behavior
      showSharinganFloat: true,
      sharinganPosition: 'bottom-right', // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
      sharinganSize: 'medium', // 'small', 'medium', 'large'
      autoHideSharingan: false,
      autoHideDelay: 3000,
      
      // Performance
      processingQuality: 'balanced', // 'speed', 'balanced', 'quality'
      maxConcurrentRequests: 3,
      cacheEnabled: true,
      cacheExpiry: 7, // days
      
      // Notifications
      showNotifications: true,
      soundEffects: true,
      scanCompleteSound: true,
      
      // Privacy
      analyticsEnabled: false,
      crashReporting: false,
      cloudSync: false
    };

    this.settings = await this.config.get('general', defaults);
  }

  /**
   * Render the settings UI
   */
  render() {
    this.container.innerHTML = `
      <div class="settings-page general-settings">
        <header class="settings-header">
          <h1>${this.i18n.get('general_settings_title')}</h1>
          <p class="settings-description">${this.i18n.get('general_settings_desc')}</p>
        </header>

        <div class="settings-content">
          ${this.renderActivationSection()}
          ${this.renderLanguageSection()}
          ${this.renderSharinganUISection()}
          ${this.renderPerformanceSection()}
          ${this.renderNotificationsSection()}
          ${this.renderPrivacySection()}
        </div>

        <div class="settings-actions">
          <button class="btn-secondary" id="reset-general-settings">
            ${this.i18n.get('reset_to_defaults')}
          </button>
          <button class="btn-primary" id="save-general-settings">
            ${this.i18n.get('save_changes')}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Activation Mode Section
   */
  renderActivationSection() {
    return `
      <section class="setting-group" data-section="activation">
        <h2>${this.i18n.get('activation_behavior')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('activation_mode')}</label>
              <p class="setting-help">${this.i18n.get('activation_mode_help')}</p>
            </div>
            <div class="setting-control">
              <select id="activation-mode" class="select-styled">
                <option value="click" ${this.settings.activationMode === 'click' ? 'selected' : ''}>
                  ${this.i18n.get('mode_click')}
                </option>
                <option value="hover" ${this.settings.activationMode === 'hover' ? 'selected' : ''}>
                  ${this.i18n.get('mode_hover')}
                </option>
                <option value="auto" ${this.settings.activationMode === 'auto' ? 'selected' : ''}>
                  ${this.i18n.get('mode_auto')}
                </option>
                <option value="hotkey" ${this.settings.activationMode === 'hotkey' ? 'selected' : ''}>
                  ${this.i18n.get('mode_hotkey')}
                </option>
              </select>
            </div>
          </div>

          <div class="setting-row conditional" id="hover-delay-row" 
               style="${this.settings.activationMode !== 'hover' ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('hover_delay')}</label>
              <p class="setting-help">${this.i18n.get('hover_delay_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="hover-delay" min="100" max="2000" step="100" 
                     value="${this.settings.translationDelay}">
              <span class="range-value">${this.settings.translationDelay}ms</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('auto_translate')}</label>
              <p class="setting-help">${this.i18n.get('auto_translate_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="auto-translate" 
                       ${this.settings.autoTranslate ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Language Preferences Section
   */
  renderLanguageSection() {
    const languages = [
      { code: 'auto', name: this.i18n.get('lang_auto_detect') },
      { code: 'ja', name: this.i18n.get('lang_japanese') },
      { code: 'ko', name: this.i18n.get('lang_korean') },
      { code: 'zh', name: this.i18n.get('lang_chinese') },
      { code: 'en', name: this.i18n.get('lang_english') }
    ];

    const targetLanguages = [
      { code: 'en', name: this.i18n.get('lang_english') },
      { code: 'ja', name: this.i18n.get('lang_japanese') },
      { code: 'ko', name: this.i18n.get('lang_korean') },
      { code: 'zh', name: this.i18n.get('lang_chinese') },
      { code: 'es', name: this.i18n.get('lang_spanish') },
      { code: 'fr', name: this.i18n.get('lang_french') },
      { code: 'de', name: this.i18n.get('lang_german') },
      { code: 'pt', name: this.i18n.get('lang_portuguese') },
      { code: 'ru', name: this.i18n.get('lang_russian') },
      { code: 'it', name: this.i18n.get('lang_italian') }
    ];

    return `
      <section class="setting-group" data-section="language">
        <h2>${this.i18n.get('language_preferences')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('source_language')}</label>
              <p class="setting-help">${this.i18n.get('source_language_help')}</p>
            </div>
            <div class="setting-control">
              <select id="source-language" class="select-styled">
                ${languages.map(lang => `
                  <option value="${lang.code}" ${this.settings.sourceLanguage === lang.code ? 'selected' : ''}>
                    ${lang.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('target_language')}</label>
              <p class="setting-help">${this.i18n.get('target_language_help')}</p>
            </div>
            <div class="setting-control">
              <select id="target-language" class="select-styled">
                ${targetLanguages.map(lang => `
                  <option value="${lang.code}" ${this.settings.targetLanguage === lang.code ? 'selected' : ''}>
                    ${lang.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('detect_manga_language')}</label>
              <p class="setting-help">${this.i18n.get('detect_manga_language_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="detect-manga-lang" checked disabled>
                <span class="toggle-slider"></span>
              </label>
              <span class="badge badge-pro">PRO</span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Sharingan UI Section (Themed controls)
   */
  renderSharinganUISection() {
    const positions = [
      { value: 'top-left', icon: '↖️', label: this.i18n.get('pos_top_left') },
      { value: 'top-right', icon: '↗️', label: this.i18n.get('pos_top_right') },
      { value: 'bottom-left', icon: '↙️', label: this.i18n.get('pos_bottom_left') },
      { value: 'bottom-right', icon: '↘️', label: this.i18n.get('pos_bottom_right') }
    ];

    return `
      <section class="setting-group" data-section="ui">
        <h2>
          <span class="sharingan-icon-small"></span>
          ${this.i18n.get('sharingan_ui_settings')}
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('show_sharingan_float')}</label>
              <p class="setting-help">${this.i18n.get('show_sharingan_float_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="show-sharingan" 
                       ${this.settings.showSharinganFloat ? 'checked' : ''}>
                <span class="toggle-slider sharingan-toggle"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="sharingan-options" 
               style="${!this.settings.showSharinganFloat ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('sharingan_position')}</label>
            </div>
            <div class="setting-control position-selector">
              ${positions.map(pos => `
                <button class="position-btn ${this.settings.sharinganPosition === pos.value ? 'active' : ''}" 
                        data-position="${pos.value}" title="${pos.label}">
                  <span class="position-icon">${pos.icon}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="setting-row conditional" id="sharingan-size-row"
               style="${!this.settings.showSharinganFloat ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('sharingan_size')}</label>
            </div>
            <div class="setting-control">
              <select id="sharingan-size" class="select-styled">
                <option value="small" ${this.settings.sharinganSize === 'small' ? 'selected' : ''}>
                  ${this.i18n.get('size_small')}
                </option>
                <option value="medium" ${this.settings.sharinganSize === 'medium' ? 'selected' : ''}>
                  ${this.i18n.get('size_medium')}
                </option>
                <option value="large" ${this.settings.sharinganSize === 'large' ? 'selected' : ''}>
                  ${this.i18n.get('size_large')}
                </option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('auto_hide_sharingan')}</label>
              <p class="setting-help">${this.i18n.get('auto_hide_sharingan_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="auto-hide-sharingan" 
                       ${this.settings.autoHideSharingan ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="auto-hide-delay-row"
               style="${!this.settings.autoHideSharingan ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('auto_hide_delay')}</label>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="auto-hide-delay" min="1000" max="10000" step="500" 
                     value="${this.settings.autoHideDelay}">
              <span class="range-value">${(this.settings.autoHideDelay / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Performance Settings Section
   */
  renderPerformanceSection() {
    return `
      <section class="setting-group" data-section="performance">
        <h2>${this.i18n.get('performance_settings')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('processing_quality')}</label>
              <p class="setting-help">${this.i18n.get('processing_quality_help')}</p>
            </div>
            <div class="setting-control">
              <div class="quality-selector">
                <button class="quality-btn ${this.settings.processingQuality === 'speed' ? 'active' : ''}" 
                        data-quality="speed">
                  <span class="quality-icon">⚡</span>
                  <span class="quality-label">${this.i18n.get('quality_speed')}</span>
                </button>
                <button class="quality-btn ${this.settings.processingQuality === 'balanced' ? 'active' : ''}" 
                        data-quality="balanced">
                  <span class="quality-icon">⚖️</span>
                  <span class="quality-label">${this.i18n.get('quality_balanced')}</span>
                </button>
                <button class="quality-btn ${this.settings.processingQuality === 'quality' ? 'active' : ''}" 
                        data-quality="quality">
                  <span class="quality-icon">✨</span>
                  <span class="quality-label">${this.i18n.get('quality_quality')}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('max_concurrent')}</label>
              <p class="setting-help">${this.i18n.get('max_concurrent_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="max-concurrent" min="1" max="10" step="1" 
                     value="${this.settings.maxConcurrentRequests}">
              <span class="range-value">${this.settings.maxConcurrentRequests}</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('cache_enabled')}</label>
              <p class="setting-help">${this.i18n.get('cache_enabled_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="cache-enabled" 
                       ${this.settings.cacheEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="cache-expiry-row"
               style="${!this.settings.cacheEnabled ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('cache_expiry')}</label>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="cache-expiry" min="1" max="30" step="1" 
                     value="${this.settings.cacheExpiry}">
              <span class="range-value">${this.settings.cacheExpiry} ${this.i18n.get('days')}</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('clear_cache_now')}</label>
            </div>
            <div class="setting-control">
              <button class="btn-text" id="clear-cache-btn">
                ${this.i18n.get('clear_cache')}
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Notifications Section
   */
  renderNotificationsSection() {
    return `
      <section class="setting-group" data-section="notifications">
        <h2>${this.i18n.get('notifications')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('show_notifications')}</label>
              <p class="setting-help">${this.i18n.get('show_notifications_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="show-notifications" 
                       ${this.settings.showNotifications ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('sound_effects')}</label>
              <p class="setting-help">${this.i18n.get('sound_effects_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="sound-effects" 
                       ${this.settings.soundEffects ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="scan-sound-row"
               style="${!this.settings.soundEffects ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('scan_complete_sound')}</label>
              <p class="setting-help">${this.i18n.get('scan_complete_sound_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="scan-sound" 
                       ${this.settings.scanCompleteSound ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <button class="btn-icon preview-sound" data-sound="scan-complete" title="${this.i18n.get('preview')}">
                ▶️
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Privacy Section
   */
  renderPrivacySection() {
    return `
      <section class="setting-group" data-section="privacy">
        <h2>${this.i18n.get('privacy_security')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('analytics')}</label>
              <p class="setting-help">${this.i18n.get('analytics_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="analytics" 
                       ${this.settings.analyticsEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('crash_reporting')}</label>
              <p class="setting-help">${this.i18n.get('crash_reporting_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="crash-reporting" 
                       ${this.settings.crashReporting ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('cloud_sync')}</label>
              <p class="setting-help">${this.i18n.get('cloud_sync_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="cloud-sync" 
                       ${this.settings.cloudSync ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span class="badge badge-beta">BETA</span>
            </div>
          </div>

          <div class="setting-row danger-zone">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('export_import_data')}</label>
              <p class="setting-help">${this.i18n.get('export_import_help')}</p>
            </div>
            <div class="setting-control">
              <button class="btn-secondary" id="export-data">
                ${this.i18n.get('export')}
              </button>
              <button class="btn-secondary" id="import-data">
                ${this.i18n.get('import')}
              </button>
            </div>
          </div>

          <div class="setting-row danger-zone">
            <div class="setting-info">
              <label class="setting-label text-danger">${this.i18n.get('reset_all_data')}</label>
              <p class="setting-help">${this.i18n.get('reset_all_data_help')}</p>
            </div>
            <div class="setting-control">
              <button class="btn-danger" id="reset-all-data">
                ${this.i18n.get('reset_everything')}
              </button>
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
    // Activation mode changes
    const activationMode = this.container.querySelector('#activation-mode');
    activationMode?.addEventListener('change', (e) => {
      this.toggleConditionalRow('hover-delay-row', e.target.value === 'hover');
      this.settings.activationMode = e.target.value;
      this.events.emit('settingChanged', { key: 'activationMode', value: e.target.value });
    });

    // Hover delay slider
    const hoverDelay = this.container.querySelector('#hover-delay');
    hoverDelay?.addEventListener('input', (e) => {
      this.settings.translationDelay = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value}ms`;
    });

    // Auto translate toggle
    const autoTranslate = this.container.querySelector('#auto-translate');
    autoTranslate?.addEventListener('change', (e) => {
      this.settings.autoTranslate = e.target.checked;
    });

    // Language selectors
    const sourceLang = this.container.querySelector('#source-language');
    sourceLang?.addEventListener('change', (e) => {
      this.settings.sourceLanguage = e.target.value;
    });

    const targetLang = this.container.querySelector('#target-language');
    targetLang?.addEventListener('change', (e) => {
      this.settings.targetLanguage = e.target.value;
    });

    // Sharingan UI controls
    const showSharingan = this.container.querySelector('#show-sharingan');
    showSharingan?.addEventListener('change', (e) => {
      this.settings.showSharinganFloat = e.target.checked;
      this.toggleConditionalRow('sharingan-options', e.target.checked);
      this.toggleConditionalRow('sharingan-size-row', e.target.checked);
    });

    // Position buttons
    this.container.querySelectorAll('.position-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.position-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.settings.sharinganPosition = e.currentTarget.dataset.position;
      });
    });

    // Sharingan size
    const sharinganSize = this.container.querySelector('#sharingan-size');
    sharinganSize?.addEventListener('change', (e) => {
      this.settings.sharinganSize = e.target.value;
    });

    // Auto hide
    const autoHide = this.container.querySelector('#auto-hide-sharingan');
    autoHide?.addEventListener('change', (e) => {
      this.settings.autoHideSharingan = e.target.checked;
      this.toggleConditionalRow('auto-hide-delay-row', e.target.checked);
    });

    const autoHideDelay = this.container.querySelector('#auto-hide-delay');
    autoHideDelay?.addEventListener('input', (e) => {
      this.settings.autoHideDelay = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${(e.target.value / 1000).toFixed(1)}s`;
    });

    // Quality selector
    this.container.querySelectorAll('.quality-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.settings.processingQuality = e.currentTarget.dataset.quality;
      });
    });

    // Max concurrent
    const maxConcurrent = this.container.querySelector('#max-concurrent');
    maxConcurrent?.addEventListener('input', (e) => {
      this.settings.maxConcurrentRequests = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = e.target.value;
    });

    // Cache settings
    const cacheEnabled = this.container.querySelector('#cache-enabled');
    cacheEnabled?.addEventListener('change', (e) => {
      this.settings.cacheEnabled = e.target.checked;
      this.toggleConditionalRow('cache-expiry-row', e.target.checked);
    });

    const cacheExpiry = this.container.querySelector('#cache-expiry');
    cacheExpiry?.addEventListener('input', (e) => {
      this.settings.cacheExpiry = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value} ${this.i18n.get('days')}`;
    });

    // Clear cache
    const clearCache = this.container.querySelector('#clear-cache-btn');
    clearCache?.addEventListener('click', () => this.handleClearCache());

    // Notifications
    const showNotifications = this.container.querySelector('#show-notifications');
    showNotifications?.addEventListener('change', (e) => {
      this.settings.showNotifications = e.target.checked;
    });

    const soundEffects = this.container.querySelector('#sound-effects');
    soundEffects?.addEventListener('change', (e) => {
      this.settings.soundEffects = e.target.checked;
      this.toggleConditionalRow('scan-sound-row', e.target.checked);
    });

    const scanSound = this.container.querySelector('#scan-sound');
    scanSound?.addEventListener('change', (e) => {
      this.settings.scanCompleteSound = e.target.checked;
    });

    // Privacy toggles
    const analytics = this.container.querySelector('#analytics');
    analytics?.addEventListener('change', (e) => {
      this.settings.analyticsEnabled = e.target.checked;
    });

    const crashReporting = this.container.querySelector('#crash-reporting');
    crashReporting?.addEventListener('change', (e) => {
      this.settings.crashReporting = e.target.checked;
    });

    const cloudSync = this.container.querySelector('#cloud-sync');
    cloudSync?.addEventListener('change', (e) => {
      this.settings.cloudSync = e.target.checked;
    });

    // Data management
    const exportBtn = this.container.querySelector('#export-data');
    exportBtn?.addEventListener('click', () => this.handleExport());

    const importBtn = this.container.querySelector('#import-data');
    importBtn?.addEventListener('click', () => this.handleImport());

    const resetAllBtn = this.container.querySelector('#reset-all-data');
    resetAllBtn?.addEventListener('click', () => this.handleResetAll());

    // Save and reset buttons
    const saveBtn = this.container.querySelector('#save-general-settings');
    saveBtn?.addEventListener('click', () => this.save());

    const resetBtn = this.container.querySelector('#reset-general-settings');
    resetBtn?.addEventListener('click', () => this.resetToDefaults());

    // Sound preview
    this.container.querySelectorAll('.preview-sound').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.playSoundPreview(e.currentTarget.dataset.sound);
      });
    });
  }

  /**
   * Toggle conditional row visibility
   */
  toggleConditionalRow(rowId, show) {
    const row = this.container.querySelector(`#${rowId}`);
    if (row) {
      row.style.display = show ? 'flex' : 'none';
      if (show) {
        row.classList.add('fade-in');
      }
    }
  }

  /**
   * Handle cache clearing
   */
  async handleClearCache() {
    if (confirm(this.i18n.get('clear_cache_confirm'))) {
      try {
        await chrome.runtime.sendMessage({ action: 'clearCache' });
        this.showToast(this.i18n.get('cache_cleared'), 'success');
      } catch (error) {
        this.showToast(this.i18n.get('cache_clear_error'), 'error');
      }
    }
  }

  /**
   * Handle data export
   */
  async handleExport() {
    try {
      const data = await this.config.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `sharingan-translator-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showToast(this.i18n.get('export_success'), 'success');
    } catch (error) {
      this.showToast(this.i18n.get('export_error'), 'error');
    }
  }

  /**
   * Handle data import
   */
  async handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await this.config.importAll(data);
        this.showToast(this.i18n.get('import_success'), 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (error) {
        this.showToast(this.i18n.get('import_error'), 'error');
      }
    };
    
    input.click();
  }

  /**
   * Handle reset all data
   */
  async handleResetAll() {
    if (confirm(this.i18n.get('reset_all_confirm'))) {
      if (confirm(this.i18n.get('reset_all_confirm_2'))) {
        try {
          await this.config.clearAll();
          this.showToast(this.i18n.get('reset_success'), 'success');
          setTimeout(() => location.reload(), 1500);
        } catch (error) {
          this.showToast(this.i18n.get('reset_error'), 'error');
        }
      }
    }
  }

  /**
   * Play sound preview
   */
  playSoundPreview(soundName) {
    chrome.runtime.sendMessage({ 
      action: 'playSound', 
      sound: soundName,
      preview: true 
    });
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
      await this.config.set('general', this.settings);
      this.events.emit('generalSettings:saved', this.settings);
      this.showToast(this.i18n.get('settings_saved'), 'success');
      
      // Notify background script of changes
      chrome.runtime.sendMessage({
        action: 'settingsUpdated',
        settings: this.settings
      });
    } catch (error) {
      this.showToast(this.i18n.get('save_error'), 'error');
      console.error('Failed to save settings:', error);
    }
  }

  /**
   * Reset to default settings
   */
  async resetToDefaults() {
    if (confirm(this.i18n.get('reset_defaults_confirm'))) {
      await this.config.remove('general');
      await this.loadSettings();
      this.render();
      this.attachEventListeners();
      this.showToast(this.i18n.get('settings_reset'), 'success');
      this.events.emit('generalSettings:reset');
    }
  }

  /**
   * Get current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Update specific setting
   */
  async updateSetting(key, value) {
    this.settings[key] = value;
    await this.save();
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
export default GeneralSettings;