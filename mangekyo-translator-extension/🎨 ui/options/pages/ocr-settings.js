// ui/options/pages/ocr-settings.js

import { ConfigManager } from '../../../core/shared/config-manager.js';
import { I18n } from '../../../core/shared/i18n/i18n.js';
import { EventEmitter } from '../../../core/shared/utils/event-emitter.js';

/**
 * OCR Settings Page Controller
 * Manages Tesseract.js configuration, image preprocessing pipelines, and computer vision parameters
 */
export class OCRSettings {
  constructor() {
    this.config = new ConfigManager();
    this.i18n = new I18n();
    this.events = new EventEmitter();
    
    this.container = null;
    this.settings = {};
    this.previewImage = null;
    this.initialized = false;
  }

  /**
   * Initialize the OCR settings page
   * @param {HTMLElement} container - DOM container for settings
   */
  async init(container) {
    this.container = container;
    await this.loadSettings();
    this.render();
    this.attachEventListeners();
    this.initialized = true;
    
    this.events.emit('ocrSettings:initialized', this.settings);
  }

  /**
   * Load current settings from storage
   */
  async loadSettings() {
    const defaults = {
      // Tesseract Core Settings
      tesseract: {
        psm: 6, // Page Segmentation Mode: 6 = Assume uniform block of text
        oem: 3, // OCR Engine Mode: 3 = Default, based on what is available
        tessdataDir: './tessdata',
        langPath: './tessdata',
        debug: false
      },

      // Language Configuration
      languages: {
        primary: 'jpn', // Primary language
        secondary: 'eng', // Fallback/secondary
        vertical: true, // Enable vertical text detection
        autoDetect: true // Auto-detect language
      },

      // Image Preprocessing Pipeline
      preprocessing: {
        enabled: true,
        denoise: {
          enabled: true,
          strength: 'medium', // 'low', 'medium', 'high'
          method: 'bilateral' // 'gaussian', 'bilateral', 'nlmeans'
        },
        binarization: {
          enabled: true,
          method: 'adaptive', // 'otsu', 'adaptive', 'sauvola'
          blockSize: 11,
          constant: 2
        },
        deskew: {
          enabled: true,
          maxAngle: 15 // Maximum rotation angle to correct
        },
        contrast: {
          enabled: true,
          clipLimit: 2.0,
          tileSize: 8
        },
        scaling: {
          enabled: true,
          targetDPI: 300,
          minDimension: 1000 // Minimum width/height
        }
      },

      // Manga-Specific Detection
      manga: {
        panelDetection: true,
        bubbleDetection: true,
        sfxDetection: false, // Separate SFX handling
        readingDirection: 'rtl', // 'rtl' (right-to-left), 'ltr', 'ttb' (top-to-bottom)
        skipCredits: true,
        skipAuthorNotes: true
      },

      // Performance & Accuracy
      performance: {
        workerCount: 2, // Number of Tesseract workers
        timeout: 30000, // OCR timeout per image (ms)
        retryAttempts: 2,
        confidenceThreshold: 60, // Minimum confidence to accept
        fallbackOnLowConfidence: true
      },

      // Advanced CV Settings
      computerVision: {
        bubbleModel: 'tensorflow', // 'tensorflow', 'heuristic', 'hybrid'
        textROIExpansion: 10, // Pixels to expand detected text regions
        minTextHeight: 12, // Minimum text height in pixels
        maxTextHeight: 200, // Maximum text height
        mergeOverlapping: true,
        overlapThreshold: 0.3 // IoU threshold for merging
      },

      // Experimental Features
      experimental: {
        useGPU: false, // WebGL acceleration
        useWASM: true, // WebAssembly optimizations
        fastMode: false, // Speed over accuracy
        legacyMode: false // Use Tesseract v4 instead of v5
      }
    };

    this.settings = await this.config.get('ocr', defaults);
  }

  /**
   * Render the settings UI
   */
  render() {
    this.container.innerHTML = `
      <div class="settings-page ocr-settings">
        <header class="settings-header">
          <h1>${this.i18n.get('ocr_settings_title')}</h1>
          <p class="settings-description">${this.i18n.get('ocr_settings_desc')}</p>
        </header>

        <div class="settings-content">
          ${this.renderLanguageSection()}
          ${this.renderPreprocessingSection()}
          ${this.renderMangaDetectionSection()}
          ${this.renderTesseractCoreSection()}
          ${this.renderPerformanceSection()}
          ${this.renderCVSection()}
          ${this.renderExperimentalSection()}
        </div>

        <div class="settings-preview">
          <div class="preview-header">
            <h3>${this.i18n.get('live_preview')}</h3>
            <button class="btn-secondary" id="load-preview-image">
              ${this.i18n.get('load_test_image')}
            </button>
          </div>
          <div class="preview-container" id="ocr-preview">
            <div class="preview-placeholder">
              <span class="preview-icon">🖼️</span>
              <p>${this.i18n.get('preview_placeholder')}</p>
            </div>
          </div>
          <div class="preview-controls">
            <button class="btn-primary" id="run-ocr-test">
              ${this.i18n.get('run_ocr_test')}
            </button>
            <div class="preview-stats" id="preview-stats"></div>
          </div>
        </div>

        <div class="settings-actions">
          <button class="btn-secondary" id="reset-ocr-settings">
            ${this.i18n.get('reset_to_defaults')}
          </button>
          <button class="btn-primary" id="save-ocr-settings">
            ${this.i18n.get('save_changes')}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Language Configuration Section
   */
  renderLanguageSection() {
    const languageOptions = [
      { code: 'jpn', name: this.i18n.get('lang_japanese'), vertical: true },
      { code: 'jpn_vert', name: this.i18n.get('lang_japanese_vert'), vertical: true },
      { code: 'kor', name: this.i18n.get('lang_korean'), vertical: false },
      { code: 'chi_sim', name: this.i18n.get('lang_chinese_simp'), vertical: true },
      { code: 'chi_tra', name: this.i18n.get('lang_chinese_trad'), vertical: true },
      { code: 'eng', name: this.i18n.get('lang_english'), vertical: false }
    ];

    return `
      <section class="setting-group" data-section="languages">
        <h2>${this.i18n.get('ocr_languages')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('primary_language')}</label>
              <p class="setting-help">${this.i18n.get('primary_language_help')}</p>
            </div>
            <div class="setting-control">
              <select id="primary-lang" class="select-styled">
                ${languageOptions.map(lang => `
                  <option value="${lang.code}" ${this.settings.languages.primary === lang.code ? 'selected' : ''}>
                    ${lang.name} ${lang.vertical ? '(↕️)' : '(↔️)'}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('secondary_language')}</label>
              <p class="setting-help">${this.i18n.get('secondary_language_help')}</p>
            </div>
            <div class="setting-control">
              <select id="secondary-lang" class="select-styled">
                <option value="">${this.i18n.get('none')}</option>
                ${languageOptions.map(lang => `
                  <option value="${lang.code}" ${this.settings.languages.secondary === lang.code ? 'selected' : ''}>
                    ${lang.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('auto_detect_lang')}</label>
              <p class="setting-help">${this.i18n.get('auto_detect_lang_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="auto-detect-lang" 
                       ${this.settings.languages.autoDetect ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('vertical_text_mode')}</label>
              <p class="setting-help">${this.i18n.get('vertical_text_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="vertical-mode" 
                       ${this.settings.languages.vertical ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('download_languages')}</label>
              <p class="setting-help">${this.i18n.get('download_languages_help')}</p>
            </div>
            <div class="setting-control">
              <button class="btn-secondary" id="manage-lang-packs">
                ${this.i18n.get('manage_language_packs')}
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Image Preprocessing Pipeline Section
   */
  renderPreprocessingSection() {
    return `
      <section class="setting-group" data-section="preprocessing">
        <h2>${this.i18n.get('image_preprocessing')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('enable_preprocessing')}</label>
              <p class="setting-help">${this.i18n.get('preprocessing_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="preprocessing-enabled" 
                       ${this.settings.preprocessing.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="preprocessing-pipeline ${this.settings.preprocessing.enabled ? '' : 'disabled'}">
            <!-- Denoising -->
            <div class="pipeline-step">
              <div class="step-header">
                <label class="toggle-switch small">
                  <input type="checkbox" id="denoise-enabled" 
                         ${this.settings.preprocessing.denoise.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="step-name">${this.i18n.get('denoising')}</span>
              </div>
              <div class="step-controls" id="denoise-controls">
                <select id="denoise-method" class="select-styled small">
                  <option value="bilateral" ${this.settings.preprocessing.denoise.method === 'bilateral' ? 'selected' : ''}>
                    ${this.i18n.get('bilateral_filter')}
                  </option>
                  <option value="gaussian" ${this.settings.preprocessing.denoise.method === 'gaussian' ? 'selected' : ''}>
                    ${this.i18n.get('gaussian_blur')}
                  </option>
                  <option value="nlmeans" ${this.settings.preprocessing.denoise.method === 'nlmeans' ? 'selected' : ''}>
                    ${this.i18n.get('nlmeans')}
                  </option>
                </select>
                <div class="strength-selector">
                  ${['low', 'medium', 'high'].map(level => `
                    <button class="strength-btn ${this.settings.preprocessing.denoise.strength === level ? 'active' : ''}" 
                            data-strength="${level}">
                      ${this.i18n.get(`strength_${level}`)}
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>

            <!-- Contrast Enhancement -->
            <div class="pipeline-step">
              <div class="step-header">
                <label class="toggle-switch small">
                  <input type="checkbox" id="contrast-enabled" 
                         ${this.settings.preprocessing.contrast.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="step-name">${this.i18n.get('contrast_enhancement')}</span>
              </div>
              <div class="step-controls" id="contrast-controls">
                <div class="range-control compact">
                  <label>${this.i18n.get('clip_limit')}</label>
                  <input type="range" id="contrast-clip" min="1" max="4" step="0.5" 
                         value="${this.settings.preprocessing.contrast.clipLimit}">
                  <span class="range-value">${this.settings.preprocessing.contrast.clipLimit}</span>
                </div>
              </div>
            </div>

            <!-- Binarization -->
            <div class="pipeline-step">
              <div class="step-header">
                <label class="toggle-switch small">
                  <input type="checkbox" id="binarize-enabled" 
                         ${this.settings.preprocessing.binarization.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="step-name">${this.i18n.get('binarization')}</span>
              </div>
              <div class="step-controls" id="binarize-controls">
                <select id="binarize-method" class="select-styled small">
                  <option value="adaptive" ${this.settings.preprocessing.binarization.method === 'adaptive' ? 'selected' : ''}>
                    ${this.i18n.get('adaptive_threshold')}
                  </option>
                  <option value="otsu" ${this.settings.preprocessing.binarization.method === 'otsu' ? 'selected' : ''}>
                    ${this.i18n.get('otsu_method')}
                  </option>
                  <option value="sauvola" ${this.settings.preprocessing.binarization.method === 'sauvola' ? 'selected' : ''}>
                    ${this.i18n.get('sauvola_method')}
                  </option>
                </select>
                <div class="range-control compact">
                  <label>${this.i18n.get('block_size')}</label>
                  <input type="range" id="binarize-block" min="3" max="21" step="2" 
                         value="${this.settings.preprocessing.binarization.blockSize}">
                  <span class="range-value">${this.settings.preprocessing.binarization.blockSize}</span>
                </div>
              </div>
            </div>

            <!-- Deskew -->
            <div class="pipeline-step">
              <div class="step-header">
                <label class="toggle-switch small">
                  <input type="checkbox" id="deskew-enabled" 
                         ${this.settings.preprocessing.deskew.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="step-name">${this.i18n.get('deskew')}</span>
              </div>
              <div class="step-controls" id="deskew-controls">
                <div class="range-control compact">
                  <label>${this.i18n.get('max_angle')}</label>
                  <input type="range" id="deskew-angle" min="5" max="45" step="5" 
                         value="${this.settings.preprocessing.deskew.maxAngle}">
                  <span class="range-value">±${this.settings.preprocessing.deskew.maxAngle}°</span>
                </div>
              </div>
            </div>

            <!-- Scaling -->
            <div class="pipeline-step">
              <div class="step-header">
                <label class="toggle-switch small">
                  <input type="checkbox" id="scaling-enabled" 
                         ${this.settings.preprocessing.scaling.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="step-name">${this.i18n.get('scaling')}</span>
              </div>
              <div class="step-controls" id="scaling-controls">
                <div class="range-control compact">
                  <label>${this.i18n.get('target_dpi')}</label>
                  <input type="range" id="scaling-dpi" min="150" max="600" step="50" 
                         value="${this.settings.preprocessing.scaling.targetDPI}">
                  <span class="range-value">${this.settings.preprocessing.scaling.targetDPI} DPI</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Manga Detection Settings
   */
  renderMangaDetectionSection() {
    return `
      <section class="setting-group" data-section="manga">
        <h2>${this.i18n.get('manga_detection')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('panel_detection')}</label>
              <p class="setting-help">${this.i18n.get('panel_detection_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="panel-detection" 
                       ${this.settings.manga.panelDetection ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('bubble_detection')}</label>
              <p class="setting-help">${this.i18n.get('bubble_detection_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="bubble-detection" 
                       ${this.settings.manga.bubbleDetection ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('sfx_detection')}</label>
              <p class="setting-help">${this.i18n.get('sfx_detection_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="sfx-detection" 
                       ${this.settings.manga.sfxDetection ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span class="badge badge-beta">BETA</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('reading_direction')}</label>
              <p class="setting-help">${this.i18n.get('reading_direction_help')}</p>
            </div>
            <div class="setting-control">
              <div class="direction-selector">
                <button class="dir-btn ${this.settings.manga.readingDirection === 'rtl' ? 'active' : ''}" 
                        data-dir="rtl" title="${this.i18n.get('right_to_left')}">
                  <span class="dir-icon">⬅️</span>
                  <span class="dir-label">Manga</span>
                </button>
                <button class="dir-btn ${this.settings.manga.readingDirection === 'ltr' ? 'active' : ''}" 
                        data-dir="ltr" title="${this.i18n.get('left_to_right')}">
                  <span class="dir-icon">➡️</span>
                  <span class="dir-label">Comics</span>
                </button>
                <button class="dir-btn ${this.settings.manga.readingDirection === 'ttb' ? 'active' : ''}" 
                        data-dir="ttb" title="${this.i18n.get('top_to_bottom')}">
                  <span class="dir-icon">⬇️</span>
                  <span class="dir-label">Manhua</span>
                </button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('skip_credits')}</label>
              <p class="setting-help">${this.i18n.get('skip_credits_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="skip-credits" 
                       ${this.settings.manga.skipCredits ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Tesseract Core Settings
   */
  renderTesseractCoreSection() {
    const psmModes = [
      { value: 0, name: this.i18n.get('psm_0'), desc: this.i18n.get('psm_0_desc') },
      { value: 1, name: this.i18n.get('psm_1'), desc: this.i18n.get('psm_1_desc') },
      { value: 3, name: this.i18n.get('psm_3'), desc: this.i18n.get('psm_3_desc') },
      { value: 4, name: this.i18n.get('psm_4'), desc: this.i18n.get('psm_4_desc') },
      { value: 6, name: this.i18n.get('psm_6'), desc: this.i18n.get('psm_6_desc') },
      { value: 7, name: this.i18n.get('psm_7'), desc: this.i18n.get('psm_7_desc') },
      { value: 8, name: this.i18n.get('psm_8'), desc: this.i18n.get('psm_8_desc') },
      { value: 11, name: this.i18n.get('psm_11'), desc: this.i18n.get('psm_11_desc') },
      { value: 12, name: this.i18n.get('psm_12'), desc: this.i18n.get('psm_12_desc') },
      { value: 13, name: this.i18n.get('psm_13'), desc: this.i18n.get('psm_13_desc') }
    ];

    const oemModes = [
      { value: 0, name: this.i18n.get('oem_0'), desc: this.i18n.get('oem_0_desc') },
      { value: 1, name: this.i18n.get('oem_1'), desc: this.i18n.get('oem_1_desc') },
      { value: 2, name: this.i18n.get('oem_2'), desc: this.i18n.get('oem_2_desc') },
      { value: 3, name: this.i18n.get('oem_3'), desc: this.i18n.get('oem_3_desc') }
    ];

    return `
      <section class="setting-group advanced-settings" data-section="tesseract">
        <h2>
          ${this.i18n.get('tesseract_core')}
          <button class="btn-text toggle-advanced" id="toggle-tesseract-advanced">
            ${this.i18n.get('show_advanced')}
          </button>
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('psm_mode')}</label>
              <p class="setting-help">${this.i18n.get('psm_help')}</p>
            </div>
            <div class="setting-control">
              <select id="psm-mode" class="select-styled">
                ${psmModes.map(mode => `
                  <option value="${mode.value}" ${this.settings.tesseract.psm === mode.value ? 'selected' : ''}>
                    ${mode.name} - ${mode.desc}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('oem_mode')}</label>
              <p class="setting-help">${this.i18n.get('oem_help')}</p>
            </div>
            <div class="setting-control">
              <select id="oem-mode" class="select-styled">
                ${oemModes.map(mode => `
                  <option value="${mode.value}" ${this.settings.tesseract.oem === mode.value ? 'selected' : ''}>
                    ${mode.name} - ${mode.desc}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="advanced-options hidden" id="tesseract-advanced">
            <div class="setting-row">
              <div class="setting-info">
                <label class="setting-label">${this.i18n.get('tessdata_path')}</label>
              </div>
              <div class="setting-control">
                <input type="text" id="tessdata-path" 
                       value="${this.settings.tesseract.tessdataDir}" 
                       placeholder="./tessdata">
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <label class="setting-label">${this.i18n.get('debug_mode')}</label>
              </div>
              <div class="setting-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="tesseract-debug" 
                         ${this.settings.tesseract.debug ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Performance Settings
   */
  renderPerformanceSection() {
    return `
      <section class="setting-group" data-section="performance">
        <h2>${this.i18n.get('ocr_performance')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('worker_count')}</label>
              <p class="setting-help">${this.i18n.get('worker_count_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="worker-count" min="1" max="4" step="1" 
                     value="${this.settings.performance.workerCount}">
              <span class="range-value">${this.settings.performance.workerCount}</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('ocr_timeout')}</label>
              <p class="setting-help">${this.i18n.get('ocr_timeout_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="ocr-timeout" min="5000" max="60000" step="5000" 
                     value="${this.settings.performance.timeout}">
              <span class="range-value">${(this.settings.performance.timeout / 1000).toFixed(0)}s</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('retry_attempts')}</label>
            </div>
            <div class="setting-control">
              <select id="retry-attempts" class="select-styled">
                <option value="0" ${this.settings.performance.retryAttempts === 0 ? 'selected' : ''}>0</option>
                <option value="1" ${this.settings.performance.retryAttempts === 1 ? 'selected' : ''}>1</option>
                <option value="2" ${this.settings.performance.retryAttempts === 2 ? 'selected' : ''}>2</option>
                <option value="3" ${this.settings.performance.retryAttempts === 3 ? 'selected' : ''}>3</option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('confidence_threshold')}</label>
              <p class="setting-help">${this.i18n.get('confidence_threshold_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="confidence-threshold" min="0" max="100" step="5" 
                     value="${this.settings.performance.confidenceThreshold}">
              <span class="range-value">${this.settings.performance.confidenceThreshold}%</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('fallback_low_confidence')}</label>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="fallback-confidence" 
                       ${this.settings.performance.fallbackOnLowConfidence ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Computer Vision Settings
   */
  renderCVSection() {
    return `
      <section class="setting-group" data-section="cv">
        <h2>${this.i18n.get('computer_vision')}</h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('bubble_detection_model')}</label>
              <p class="setting-help">${this.i18n.get('bubble_model_help')}</p>
            </div>
            <div class="setting-control">
              <select id="bubble-model" class="select-styled">
                <option value="tensorflow" ${this.settings.computerVision.bubbleModel === 'tensorflow' ? 'selected' : ''}>
                  ${this.i18n.get('model_tensorflow')} (ML-based)
                </option>
                <option value="heuristic" ${this.settings.computerVision.bubbleModel === 'heuristic' ? 'selected' : ''}>
                  ${this.i18n.get('model_heuristic')} (Rule-based)
                </option>
                <option value="hybrid" ${this.settings.computerVision.bubbleModel === 'hybrid' ? 'selected' : ''}>
                  ${this.i18n.get('model_hybrid')} (Combined)
                </option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('text_roi_expansion')}</label>
              <p class="setting-help">${this.i18n.get('roi_expansion_help')}</p>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="roi-expansion" min="0" max="50" step="5" 
                     value="${this.settings.computerVision.textROIExpansion}">
              <span class="range-value">+${this.settings.computerVision.textROIExpansion}px</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('text_height_range')}</label>
            </div>
            <div class="setting-control dual-range">
              <div class="range-control compact">
                <label>${this.i18n.get('min')}</label>
                <input type="number" id="min-text-height" 
                       value="${this.settings.computerVision.minTextHeight}" min="8" max="100">
                <span>px</span>
              </div>
              <div class="range-control compact">
                <label>${this.i18n.get('max')}</label>
                <input type="number" id="max-text-height" 
                       value="${this.settings.computerVision.maxTextHeight}" min="50" max="500">
                <span>px</span>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('merge_overlapping')}</label>
              <p class="setting-help">${this.i18n.get('merge_overlapping_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="merge-overlapping" 
                       ${this.settings.computerVision.mergeOverlapping ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row conditional" id="overlap-threshold-row"
               style="${!this.settings.computerVision.mergeOverlapping ? 'display:none' : ''}">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('overlap_threshold')}</label>
            </div>
            <div class="setting-control range-control">
              <input type="range" id="overlap-threshold" min="0.1" max="0.9" step="0.1" 
                     value="${this.settings.computerVision.overlapThreshold}">
              <span class="range-value">${Math.round(this.settings.computerVision.overlapThreshold * 100)}%</span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * Experimental Features
   */
  renderExperimentalSection() {
    return `
      <section class="setting-group experimental-settings" data-section="experimental">
        <h2>
          ${this.i18n.get('experimental_features')}
          <span class="badge badge-warning">${this.i18n.get('advanced')}</span>
        </h2>
        
        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('gpu_acceleration')}</label>
              <p class="setting-help">${this.i18n.get('gpu_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="use-gpu" 
                       ${this.settings.experimental.useGPU ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span class="badge badge-beta">WebGL</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('wasm_optimization')}</label>
              <p class="setting-help">${this.i18n.get('wasm_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="use-wasm" 
                       ${this.settings.experimental.useWASM ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('fast_mode')}</label>
              <p class="setting-help">${this.i18n.get('fast_mode_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="fast-mode" 
                       ${this.settings.experimental.fastMode ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">${this.i18n.get('legacy_tesseract')}</label>
              <p class="setting-help">${this.i18n.get('legacy_help')}</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="legacy-mode" 
                       ${this.settings.experimental.legacyMode ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
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
    // Language settings
    const primaryLang = this.container.querySelector('#primary-lang');
    primaryLang?.addEventListener('change', (e) => {
      this.settings.languages.primary = e.target.value;
      this.updatePreview();
    });

    const secondaryLang = this.container.querySelector('#secondary-lang');
    secondaryLang?.addEventListener('change', (e) => {
      this.settings.languages.secondary = e.target.value;
    });

    const autoDetectLang = this.container.querySelector('#auto-detect-lang');
    autoDetectLang?.addEventListener('change', (e) => {
      this.settings.languages.autoDetect = e.target.checked;
    });

    const verticalMode = this.container.querySelector('#vertical-mode');
    verticalMode?.addEventListener('change', (e) => {
      this.settings.languages.vertical = e.target.checked;
    });

    // Preprocessing pipeline
    const preprocessingEnabled = this.container.querySelector('#preprocessing-enabled');
    preprocessingEnabled?.addEventListener('change', (e) => {
      this.settings.preprocessing.enabled = e.target.checked;
      const pipeline = this.container.querySelector('.preprocessing-pipeline');
      pipeline?.classList.toggle('disabled', !e.target.checked);
    });

    // Denoise controls
    const denoiseEnabled = this.container.querySelector('#denoise-enabled');
    denoiseEnabled?.addEventListener('change', (e) => {
      this.settings.preprocessing.denoise.enabled = e.target.checked;
    });

    const denoiseMethod = this.container.querySelector('#denoise-method');
    denoiseMethod?.addEventListener('change', (e) => {
      this.settings.preprocessing.denoise.method = e.target.value;
    });

    this.container.querySelectorAll('[data-strength]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('[data-strength]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.settings.preprocessing.denoise.strength = e.currentTarget.dataset.strength;
      });
    });

    // Contrast controls
    const contrastEnabled = this.container.querySelector('#contrast-enabled');
    contrastEnabled?.addEventListener('change', (e) => {
      this.settings.preprocessing.contrast.enabled = e.target.checked;
    });

    const contrastClip = this.container.querySelector('#contrast-clip');
    contrastClip?.addEventListener('input', (e) => {
      this.settings.preprocessing.contrast.clipLimit = parseFloat(e.target.value);
      e.target.nextElementSibling.textContent = e.target.value;
    });

    // Binarization controls
    const binarizeEnabled = this.container.querySelector('#binarize-enabled');
    binarizeEnabled?.addEventListener('change', (e) => {
      this.settings.preprocessing.binarization.enabled = e.target.checked;
    });

    const binarizeMethod = this.container.querySelector('#binarize-method');
    binarizeMethod?.addEventListener('change', (e) => {
      this.settings.preprocessing.binarization.method = e.target.value;
    });

    const binarizeBlock = this.container.querySelector('#binarize-block');
    binarizeBlock?.addEventListener('input', (e) => {
      this.settings.preprocessing.binarization.blockSize = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = e.target.value;
    });

    // Deskew controls
    const deskewEnabled = this.container.querySelector('#deskew-enabled');
    deskewEnabled?.addEventListener('change', (e) => {
      this.settings.preprocessing.deskew.enabled = e.target.checked;
    });

    const deskewAngle = this.container.querySelector('#deskew-angle');
    deskewAngle?.addEventListener('input', (e) => {
      this.settings.preprocessing.deskew.maxAngle = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `±${e.target.value}°`;
    });

    // Scaling controls
    const scalingEnabled = this.container.querySelector('#scaling-enabled');
    scalingEnabled?.addEventListener('change', (e) => {
      this.settings.preprocessing.scaling.enabled = e.target.checked;
    });

    const scalingDPI = this.container.querySelector('#scaling-dpi');
    scalingDPI?.addEventListener('input', (e) => {
      this.settings.preprocessing.scaling.targetDPI = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value} DPI`;
    });

    // Manga detection
    const panelDetection = this.container.querySelector('#panel-detection');
    panelDetection?.addEventListener('change', (e) => {
      this.settings.manga.panelDetection = e.target.checked;
    });

    const bubbleDetection = this.container.querySelector('#bubble-detection');
    bubbleDetection?.addEventListener('change', (e) => {
      this.settings.manga.bubbleDetection = e.target.checked;
    });

    const sfxDetection = this.container.querySelector('#sfx-detection');
    sfxDetection?.addEventListener('change', (e) => {
      this.settings.manga.sfxDetection = e.target.checked;
    });

    // Reading direction
    this.container.querySelectorAll('.dir-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.settings.manga.readingDirection = e.currentTarget.dataset.dir;
      });
    });

    const skipCredits = this.container.querySelector('#skip-credits');
    skipCredits?.addEventListener('change', (e) => {
      this.settings.manga.skipCredits = e.target.checked;
    });

    // Tesseract core
    const psmMode = this.container.querySelector('#psm-mode');
    psmMode?.addEventListener('change', (e) => {
      this.settings.tesseract.psm = parseInt(e.target.value);
    });

    const oemMode = this.container.querySelector('#oem-mode');
    oemMode?.addEventListener('change', (e) => {
      this.settings.tesseract.oem = parseInt(e.target.value);
    });

    const tessdataPath = this.container.querySelector('#tessdata-path');
    tessdataPath?.addEventListener('change', (e) => {
      this.settings.tesseract.tessdataDir = e.target.value;
    });

    const tesseractDebug = this.container.querySelector('#tesseract-debug');
    tesseractDebug?.addEventListener('change', (e) => {
      this.settings.tesseract.debug = e.target.checked;
    });

    // Toggle advanced
    const toggleAdvanced = this.container.querySelector('#toggle-tesseract-advanced');
    toggleAdvanced?.addEventListener('click', () => {
      const advanced = this.container.querySelector('#tesseract-advanced');
      advanced?.classList.toggle('hidden');
      toggleAdvanced.textContent = advanced?.classList.contains('hidden') 
        ? this.i18n.get('show_advanced') 
        : this.i18n.get('hide_advanced');
    });

    // Performance
    const workerCount = this.container.querySelector('#worker-count');
    workerCount?.addEventListener('input', (e) => {
      this.settings.performance.workerCount = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = e.target.value;
    });

    const ocrTimeout = this.container.querySelector('#ocr-timeout');
    ocrTimeout?.addEventListener('input', (e) => {
      this.settings.performance.timeout = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${(e.target.value / 1000).toFixed(0)}s`;
    });

    const retryAttempts = this.container.querySelector('#retry-attempts');
    retryAttempts?.addEventListener('change', (e) => {
      this.settings.performance.retryAttempts = parseInt(e.target.value);
    });

    const confidenceThreshold = this.container.querySelector('#confidence-threshold');
    confidenceThreshold?.addEventListener('input', (e) => {
      this.settings.performance.confidenceThreshold = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `${e.target.value}%`;
    });

    const fallbackConfidence = this.container.querySelector('#fallback-confidence');
    fallbackConfidence?.addEventListener('change', (e) => {
      this.settings.performance.fallbackOnLowConfidence = e.target.checked;
    });

    // Computer vision
    const bubbleModel = this.container.querySelector('#bubble-model');
    bubbleModel?.addEventListener('change', (e) => {
      this.settings.computerVision.bubbleModel = e.target.value;
    });

    const roiExpansion = this.container.querySelector('#roi-expansion');
    roiExpansion?.addEventListener('input', (e) => {
      this.settings.computerVision.textROIExpansion = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = `+${e.target.value}px`;
    });

    const minTextHeight = this.container.querySelector('#min-text-height');
    minTextHeight?.addEventListener('change', (e) => {
      this.settings.computerVision.minTextHeight = parseInt(e.target.value);
    });

    const maxTextHeight = this.container.querySelector('#max-text-height');
    maxTextHeight?.addEventListener('change', (e) => {
      this.settings.computerVision.maxTextHeight = parseInt(e.target.value);
    });

    const mergeOverlapping = this.container.querySelector('#merge-overlapping');
    mergeOverlapping?.addEventListener('change', (e) => {
      this.settings.computerVision.mergeOverlapping = e.target.checked;
      this.toggleConditionalRow('overlap-threshold-row', e.target.checked);
    });

    const overlapThreshold = this.container.querySelector('#overlap-threshold');
    overlapThreshold?.addEventListener('input', (e) => {
      this.settings.computerVision.overlapThreshold = parseFloat(e.target.value);
      e.target.nextElementSibling.textContent = `${Math.round(e.target.value * 100)}%`;
    });

    // Experimental
    const useGPU = this.container.querySelector('#use-gpu');
    useGPU?.addEventListener('change', (e) => {
      this.settings.experimental.useGPU = e.target.checked;
    });

    const useWASM = this.container.querySelector('#use-wasm');
    useWASM?.addEventListener('change', (e) => {
      this.settings.experimental.useWASM = e.target.checked;
    });

    const fastMode = this.container.querySelector('#fast-mode');
    fastMode?.addEventListener('change', (e) => {
      this.settings.experimental.fastMode = e.target.checked;
    });

    const legacyMode = this.container.querySelector('#legacy-mode');
    legacyMode?.addEventListener('change', (e) => {
      this.settings.experimental.legacyMode = e.target.checked;
    });

    // Preview controls
    const loadPreviewBtn = this.container.querySelector('#load-preview-image');
    loadPreviewBtn?.addEventListener('click', () => this.loadPreviewImage());

    const runTestBtn = this.container.querySelector('#run-ocr-test');
    runTestBtn?.addEventListener('click', () => this.runOCRTest());

    // Action buttons
    const saveBtn = this.container.querySelector('#save-ocr-settings');
    saveBtn?.addEventListener('click', () => this.save());

    const resetBtn = this.container.querySelector('#reset-ocr-settings');
    resetBtn?.addEventListener('click', () => this.resetToDefaults());
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
   * Load preview image for testing
   */
  async loadPreviewImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        this.previewImage = event.target.result;
        const previewContainer = this.container.querySelector('#ocr-preview');
        previewContainer.innerHTML = `
          <img src="${this.previewImage}" class="preview-image" alt="Test image">
          <div class="preview-overlay" id="preview-overlay"></div>
        `;
      };
      reader.readAsDataURL(file);
    };
    
    input.click();
  }

  /**
   * Run OCR test with current settings
   */
  async runOCRTest() {
    if (!this.previewImage) {
      this.showToast(this.i18n.get('load_image_first'), 'warning');
      return;
    }

    const runBtn = this.container.querySelector('#run-ocr-test');
    const originalText = runBtn.textContent;
    runBtn.textContent = this.i18n.get('processing');
    runBtn.disabled = true;

    try {
      const startTime = performance.now();
      
      const result = await chrome.runtime.sendMessage({
        action: 'testOCR',
        image: this.previewImage,
        settings: this.settings
      });

      const duration = performance.now() - startTime;
      
      // Display results
      this.displayOCRResults(result, duration);
      
    } catch (error) {
      this.showToast(this.i18n.get('ocr_test_failed'), 'error');
      console.error('OCR Test failed:', error);
    } finally {
      runBtn.textContent = originalText;
      runBtn.disabled = false;
    }
  }

  /**
   * Display OCR test results
   */
  displayOCRResults(result, duration) {
    const statsContainer = this.container.querySelector('#preview-stats');
    const overlay = this.container.querySelector('#preview-overlay');
    
    // Update stats
    statsContainer.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">${this.i18n.get('confidence')}</span>
        <span class="stat-value ${result.confidence > 80 ? 'good' : result.confidence > 60 ? 'medium' : 'poor'}">
          ${result.confidence.toFixed(1)}%
        </span>
      </div>
      <div class="stat-item">
        <span class="stat-label">${this.i18n.get('duration')}</span>
        <span class="stat-value">${(duration / 1000).toFixed(2)}s</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">${this.i18n.get('text_blocks')}</span>
        <span class="stat-value">${result.blocks?.length || 0}</span>
      </div>
    `;

    // Draw bounding boxes on overlay
    if (result.blocks && overlay) {
      overlay.innerHTML = '';
      result.blocks.forEach((block, index) => {
        const box = document.createElement('div');
        box.className = `ocr-box confidence-${block.confidence > 80 ? 'high' : block.confidence > 60 ? 'medium' : 'low'}`;
        box.style.left = `${block.bbox.x0}px`;
        box.style.top = `${block.bbox.y0}px`;
        box.style.width = `${block.bbox.x1 - block.bbox.x0}px`;
        box.style.height = `${block.bbox.y1 - block.bbox.y0}px`;
        box.title = `${block.text} (${block.confidence.toFixed(1)}%)`;
        box.dataset.index = index;
        overlay.appendChild(box);
      });
    }

    this.showToast(this.i18n.get('ocr_test_complete'), 'success');
  }

  /**
   * Update preview when settings change
   */
  updatePreview() {
    // Debounced preview update could be implemented here
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
      await this.config.set('ocr', this.settings);
      this.events.emit('ocrSettings:saved', this.settings);
      this.showToast(this.i18n.get('settings_saved'), 'success');

      // Notify background to reinitialize OCR workers
      chrome.runtime.sendMessage({
        action: 'ocrSettingsUpdated',
        settings: this.settings
      });
    } catch (error) {
      this.showToast(this.i18n.get('save_error'), 'error');
      console.error('Failed to save OCR settings:', error);
    }
  }

  /**
   * Reset to default settings
   */
  async resetToDefaults() {
    if (confirm(this.i18n.get('reset_ocr_confirm'))) {
      await this.config.remove('ocr');
      await this.loadSettings();
      this.render();
      this.attachEventListeners();
      this.showToast(this.i18n.get('settings_reset'), 'success');
      this.events.emit('ocrSettings:reset');
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
export default OCRSettings;