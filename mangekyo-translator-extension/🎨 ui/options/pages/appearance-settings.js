// ui/options/pages/appearance-settings.js
// Theme customization and visual appearance management for the manga translator extension

import { ConfigManager } from '../../../core/shared/config-manager.js';
import { EventEmitter } from '../../../core/shared/utils/event-emitter.js';

/**
 * AppearanceSettings - Manages all visual customization options
 * Handles themes, Sharingan visual effects, overlay styling, and accessibility
 */
class AppearanceSettings extends EventEmitter {
  constructor() {
    super();
    this.config = new ConfigManager();
    this.container = null;
    this.currentSettings = null;
    
    // Default appearance configuration
    this.defaults = {
      // Theme settings
      theme: {
        mode: 'system', // 'light', 'dark', 'system', 'sharingan'
        primaryColor: '#ff0000', // Sharingan red default
        accentColor: '#4a0000', // Dark crimson
        backgroundImage: null,
        customCSS: ''
      },
      
      // Sharingan visual effects
      sharingan: {
        idleAnimation: true,
        idleSpinSpeed: 1.0, // 0.5x to 3x
        activationAnimation: true,
        emsPulseIntensity: 0.8, // 0.0 to 1.0
        susanooAuraEnabled: true,
        chakraGlowIntensity: 0.6,
        eyePosition: 'bottom-right', // 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'custom'
        eyeSize: 'medium', // 'small', 'medium', 'large'
        eyeOpacity: 0.9,
        alwaysVisible: false,
        autoHideDelay: 3000 // ms when not in use
      },
      
      // Translation overlay styling
      overlay: {
        bubbleStyle: 'manga', // 'manga', 'minimal', 'boxed', 'transparent'
        fontFamily: 'Noto Sans JP',
        fontSize: 16,
        fontColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 2,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backgroundBlur: 0,
        borderRadius: 8,
        padding: 12,
        maxWidth: 300,
        textAlign: 'center',
        lineHeight: 1.4,
        textShadow: true,
        smartPositioning: true,
        avoidOverlap: true,
        fadeInDuration: 200,
        fadeOutDuration: 150
      },
      
      // Advanced visual effects
      effects: {
        scanlinesEnabled: true,
        scanlineOpacity: 0.15,
        chakraParticles: true,
        particleDensity: 'medium', // 'low', 'medium', 'high'
        screenShakeOnActivate: false,
        shakeIntensity: 'low',
        glowEffects: true,
        chromaticAberration: false
      },
      
      // Accessibility
      accessibility: {
        highContrast: false,
        reduceMotion: false,
        largeText: false,
        colorBlindMode: 'none', // 'none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'
        screenReaderOptimized: false,
        focusIndicators: true
      }
    };
    
    this.themes = {
      sharingan: {
        name: 'Sharingan',
        colors: {
          primary: '#ff0000',
          secondary: '#8b0000',
          background: '#0a0a0a',
          surface: '#1a1a1a',
          text: '#ffffff',
          accent: '#ff4500'
        },
        gradients: {
          background: 'radial-gradient(circle at center, #1a0000 0%, #000000 100%)',
          sharingan: 'conic-gradient(from 0deg, #ff0000, #8b0000, #ff0000)'
        }
      },
      mangekyou: {
        name: 'Mangekyō Sharingan',
        colors: {
          primary: '#dc143c',
          secondary: '#4a0000',
          background: '#050505',
          surface: '#121212',
          text: '#e0e0e0',
          accent: '#ff1493'
        }
      },
      rinnegan: {
        name: 'Rinnegan',
        colors: {
          primary: '#9370db',
          secondary: '#4b0082',
          background: '#0d001a',
          surface: '#1a0a2e',
          text: '#f0e6ff',
          accent: '#dda0dd'
        }
      },
      byakugan: {
        name: 'Byakugan',
        colors: {
          primary: '#e0e0e0',
          secondary: '#a9a9a9',
          background: '#f5f5f5',
          surface: '#ffffff',
          text: '#1a1a1a',
          accent: '#87ceeb'
        }
      }
    };
    
    this.fonts = [
      { id: 'noto-sans-jp', name: 'Noto Sans JP', family: '"Noto Sans JP", sans-serif' },
      { id: 'noto-serif-jp', name: 'Noto Serif JP', family: '"Noto Serif JP", serif' },
      { id: 'mplus-1p', name: 'M PLUS 1p', family: '"M PLUS 1p", sans-serif' },
      { id: 'kosugi-maru', name: 'Kosugi Maru', family: '"Kosugi Maru", sans-serif' },
      { id: 'sawarabi-gothic', name: 'Sawarabi Gothic', family: '"Sawarabi Gothic", sans-serif' },
      { id: 'manga-font', name: 'Anime Ace', family: '"Anime Ace", "Comic Sans MS", cursive' },
      { id: 'wild-words', name: 'Wild Words', family: '"Wild Words", "Arial Black", sans-serif' },
      { id: 'system', name: 'System Default', family: 'system-ui, -apple-system, sans-serif' }
    ];
  }

  /**
   * Initialize the appearance settings page
   */
  async init(container) {
    this.container = container;
    this.currentSettings = await this.loadSettings();
    this.render();
    this.attachEventListeners();
    this.applyPreview();
  }

  /**
   * Load settings from storage
   */
  async loadSettings() {
    const stored = await this.config.get('appearance');
    return this.deepMerge(this.defaults, stored || {});
  }

  /**
   * Save settings to storage
   */
  async saveSettings() {
    await this.config.set('appearance', this.currentSettings);
    this.emit('settingsChanged', this.currentSettings);
    
    // Notify other extension components
    chrome.runtime.sendMessage({
      type: 'APPEARANCE_SETTINGS_UPDATED',
      settings: this.currentSettings
    });
  }

  /**
   * Render the settings UI
   */
  render() {
    this.container.innerHTML = `
      <div class="appearance-settings">
        <header class="settings-header">
          <h2>👁️ Appearance Settings</h2>
          <p class="subtitle">Customize the visual experience and Sharingan effects</p>
        </header>

        <!-- Theme Selection -->
        <section class="setting-card" data-section="theme">
          <div class="card-header">
            <h3>🎨 Theme</h3>
            <span class="badge">Visual</span>
          </div>
          
          <div class="theme-selector">
            <div class="theme-grid">
              ${Object.entries(this.themes).map(([key, theme]) => `
                <div class="theme-option ${this.currentSettings.theme.mode === key ? 'active' : ''}" 
                     data-theme="${key}">
                  <div class="theme-preview" style="
                    background: ${theme.colors.background};
                    border-color: ${theme.colors.primary};
                  ">
                    <div class="theme-color-dot" style="background: ${theme.colors.primary}"></div>
                    <div class="theme-color-secondary" style="background: ${theme.colors.secondary}"></div>
                  </div>
                  <span class="theme-name">${theme.name}</span>
                </div>
              `).join('')}
              
              <div class="theme-option ${this.currentSettings.theme.mode === 'custom' ? 'active' : ''}" 
                   data-theme="custom">
                <div class="theme-preview custom-theme">
                  <div class="custom-indicator">+</div>
                </div>
                <span class="theme-name">Custom</span>
              </div>
            </div>
          </div>

          <div class="color-customization ${this.currentSettings.theme.mode === 'custom' ? 'visible' : ''}">
            <div class="color-picker-row">
              <div class="color-input-group">
                <label>Primary Color</label>
                <input type="color" id="primary-color" 
                       value="${this.currentSettings.theme.primaryColor}">
              </div>
              <div class="color-input-group">
                <label>Accent Color</label>
                <input type="color" id="accent-color" 
                       value="${this.currentSettings.theme.accentColor}">
              </div>
            </div>
          </div>
        </section>

        <!-- Sharingan Visual Settings -->
        <section class="setting-card" data-section="sharingan">
          <div class="card-header">
            <h3>🔴 Sharingan Eye</h3>
            <span class="badge">Animation</span>
          </div>

          <div class="setting-group">
            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="idle-animation" 
                       ${this.currentSettings.sharingan.idleAnimation ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Idle Animation</span>
                <span class="description">Spinning tomoe when not in use</span>
              </div>
            </div>

            <div class="range-setting ${this.currentSettings.sharingan.idleAnimation ? '' : 'disabled'}">
              <label>Spin Speed</label>
              <input type="range" id="idle-speed" min="0.5" max="3" step="0.1" 
                     value="${this.currentSettings.sharingan.idleSpinSpeed}">
              <span class="value">${this.currentSettings.sharingan.idleSpinSpeed}x</span>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="activation-animation" 
                       ${this.currentSettings.sharingan.activationAnimation ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Activation Effects</span>
                <span class="description">EMS transformation when translating</span>
              </div>
            </div>

            <div class="range-setting">
              <label>EMS Pulse Intensity</label>
              <input type="range" id="ems-pulse" min="0" max="1" step="0.1" 
                     value="${this.currentSettings.sharingan.emsPulseIntensity}">
              <span class="value">${Math.round(this.currentSettings.sharingan.emsPulseIntensity * 100)}%</span>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="susanoo-aura" 
                       ${this.currentSettings.sharingan.susanooAuraEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Susanoo Aura</span>
                <span class="description">Chakra aura effect around the eye</span>
              </div>
            </div>

            <div class="select-setting">
              <label>Eye Position</label>
              <select id="eye-position">
                ${['bottom-right', 'bottom-left', 'top-right', 'top-left', 'custom'].map(pos => `
                  <option value="${pos}" ${this.currentSettings.sharingan.eyePosition === pos ? 'selected' : ''}>
                    ${pos.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="select-setting">
              <label>Eye Size</label>
              <select id="eye-size">
                ${['small', 'medium', 'large'].map(size => `
                  <option value="${size}" ${this.currentSettings.sharingan.eyeSize === size ? 'selected' : ''}>
                    ${size.charAt(0).toUpperCase() + size.slice(1)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="range-setting">
              <label>Eye Opacity</label>
              <input type="range" id="eye-opacity" min="0.3" max="1" step="0.1" 
                     value="${this.currentSettings.sharingan.eyeOpacity}">
              <span class="value">${Math.round(this.currentSettings.sharingan.eyeOpacity * 100)}%</span>
            </div>
          </div>
        </section>

        <!-- Translation Overlay Styling -->
        <section class="setting-card" data-section="overlay">
          <div class="card-header">
            <h3>💬 Translation Bubbles</h3>
            <span class="badge">Overlay</span>
          </div>

          <div class="bubble-style-selector">
            <label>Bubble Style</label>
            <div class="style-options">
              ${[
                { id: 'manga', name: 'Manga', icon: '📚' },
                { id: 'minimal', name: 'Minimal', icon: '✨' },
                { id: 'boxed', name: 'Boxed', icon: '⬜' },
                { id: 'transparent', name: 'Transparent', icon: '👻' }
              ].map(style => `
                <div class="style-option ${this.currentSettings.overlay.bubbleStyle === style.id ? 'active' : ''}" 
                     data-style="${style.id}">
                  <span class="style-icon">${style.icon}</span>
                  <span class="style-name">${style.name}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="setting-group">
            <div class="select-setting">
              <label>Font Family</label>
              <select id="font-family">
                ${this.fonts.map(font => `
                  <option value="${font.id}" ${this.currentSettings.overlay.fontFamily === font.family ? 'selected' : ''}>
                    ${font.name}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="range-setting">
              <label>Font Size</label>
              <input type="range" id="font-size" min="10" max="32" step="1" 
                     value="${this.currentSettings.overlay.fontSize}">
              <span class="value">${this.currentSettings.overlay.fontSize}px</span>
            </div>

            <div class="color-input-group">
              <label>Text Color</label>
              <input type="color" id="font-color" 
                     value="${this.currentSettings.overlay.fontColor}">
            </div>

            <div class="range-setting">
              <label>Background Opacity</label>
              <input type="range" id="bg-opacity" min="0" max="1" step="0.05" 
                     value="${this.parseOpacity(this.currentSettings.overlay.backgroundColor)}">
              <span class="value">${Math.round(this.parseOpacity(this.currentSettings.overlay.backgroundColor) * 100)}%</span>
            </div>

            <div class="range-setting">
              <label>Corner Radius</label>
              <input type="range" id="border-radius" min="0" max="24" step="2" 
                     value="${this.currentSettings.overlay.borderRadius}">
              <span class="value">${this.currentSettings.overlay.borderRadius}px</span>
            </div>

            <div class="range-setting">
              <label>Max Width</label>
              <input type="range" id="max-width" min="150" max="500" step="10" 
                     value="${this.currentSettings.overlay.maxWidth}">
              <span class="value">${this.currentSettings.overlay.maxWidth}px</span>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="smart-positioning" 
                       ${this.currentSettings.overlay.smartPositioning ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Smart Positioning</span>
                <span class="description">Auto-adjust to avoid overlapping manga panels</span>
              </div>
            </div>
          </div>

          <!-- Live Preview -->
          <div class="bubble-preview-container">
            <div class="preview-label">Live Preview</div>
            <div class="bubble-preview" id="bubble-preview">
              <div class="sample-bubble" style="
                font-family: ${this.getFontFamily(this.currentSettings.overlay.fontFamily)};
                font-size: ${this.currentSettings.overlay.fontSize}px;
                color: ${this.currentSettings.overlay.fontColor};
                background: ${this.currentSettings.overlay.backgroundColor};
                border-radius: ${this.currentSettings.overlay.borderRadius}px;
                padding: ${this.currentSettings.overlay.padding}px;
                max-width: ${this.currentSettings.overlay.maxWidth}px;
                text-align: ${this.currentSettings.overlay.textAlign};
                line-height: ${this.currentSettings.overlay.lineHeight};
                text-shadow: ${this.currentSettings.overlay.textShadow ? '2px 2px 0 #000' : 'none'};
                -webkit-text-stroke: ${this.currentSettings.overlay.strokeWidth}px ${this.currentSettings.overlay.strokeColor};
              ">
                "I won't forgive you... for hurting my friends!"
                <br>
                <span class="translation-note">Translated from Japanese</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Advanced Effects -->
        <section class="setting-card" data-section="effects">
          <div class="card-header">
            <h3>✨ Advanced Effects</h3>
            <span class="badge">Performance</span>
          </div>

          <div class="setting-group">
            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="scanlines" 
                       ${this.currentSettings.effects.scanlinesEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Scanline Effect</span>
                <span class="description">Retro CRT scanlines during active scanning</span>
              </div>
            </div>

            <div class="range-setting">
              <label>Scanline Opacity</label>
              <input type="range" id="scanline-opacity" min="0.05" max="0.5" step="0.05" 
                     value="${this.currentSettings.effects.scanlineOpacity}">
              <span class="value">${Math.round(this.currentSettings.effects.scanlineOpacity * 100)}%</span>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="chakra-particles" 
                       ${this.currentSettings.effects.chakraParticles ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Chakra Particles</span>
                <span class="description">Floating energy particles around the eye</span>
              </div>
            </div>

            <div class="select-setting">
              <label>Particle Density</label>
              <select id="particle-density">
                ${['low', 'medium', 'high'].map(density => `
                  <option value="${density}" ${this.currentSettings.effects.particleDensity === density ? 'selected' : ''}>
                    ${density.charAt(0).toUpperCase() + density.slice(1)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="screen-shake" 
                       ${this.currentSettings.effects.screenShakeOnActivate ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Screen Shake</span>
                <span class="description">Subtle shake on Sharingan activation</span>
              </div>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="chromatic-aberration" 
                       ${this.currentSettings.effects.chromaticAberration ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Chromatic Aberration</span>
                <span class="description">RGB split effect during intense moments</span>
              </div>
            </div>
          </div>

          <div class="performance-warning" id="performance-warning" style="display: none;">
            <span class="warning-icon">⚠️</span>
            <span>Some effects may impact performance on lower-end devices</span>
          </div>
        </section>

        <!-- Accessibility -->
        <section class="setting-card" data-section="accessibility">
          <div class="card-header">
            <h3>♿ Accessibility</h3>
            <span class="badge">Universal Design</span>
          </div>

          <div class="setting-group">
            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="reduce-motion" 
                       ${this.currentSettings.accessibility.reduceMotion ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Reduce Motion</span>
                <span class="description">Minimize animations for vestibular disorders</span>
              </div>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="high-contrast" 
                       ${this.currentSettings.accessibility.highContrast ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">High Contrast</span>
                <span class="description">Enhanced contrast for visibility</span>
              </div>
            </div>

            <div class="toggle-setting">
              <label class="switch">
                <input type="checkbox" id="large-text" 
                       ${this.currentSettings.accessibility.largeText ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <div class="setting-info">
                <span class="label">Large Text</span>
                <span class="description">Increase base font size by 25%</span>
              </div>
            </div>

            <div class="select-setting">
              <label>Color Blind Mode</label>
              <select id="color-blind-mode">
                ${[
                  { id: 'none', name: 'None' },
                  { id: 'protanopia', name: 'Protanopia (Red-blind)' },
                  { id: 'deuteranopia', name: 'Deuteranopia (Green-blind)' },
                  { id: 'tritanopia', name: 'Tritanopia (Blue-blind)' },
                  { id: 'achromatopsia', name: 'Achromatopsia (Monochrome)' }
                ].map(mode => `
                  <option value="${mode.id}" ${this.currentSettings.accessibility.colorBlindMode === mode.id ? 'selected' : ''}>
                    ${mode.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        </section>

        <!-- Reset & Actions -->
        <div class="settings-actions">
          <button class="btn-secondary" id="reset-appearance">
            <span>↺</span> Reset to Defaults
          </button>
          <button class="btn-primary" id="save-appearance">
            <span>💾</span> Save Changes
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners to all interactive elements
   */
  attachEventListeners() {
    // Theme selection
    this.container.querySelectorAll('.theme-option').forEach(option => {
      option.addEventListener('click', (e) => this.handleThemeChange(e));
    });

    // Color pickers
    const primaryColor = this.container.querySelector('#primary-color');
    const accentColor = this.container.querySelector('#accent-color');
    
    if (primaryColor) {
      primaryColor.addEventListener('input', (e) => {
        this.currentSettings.theme.primaryColor = e.target.value;
        this.updatePreview();
      });
    }

    if (accentColor) {
      accentColor.addEventListener('input', (e) => {
        this.currentSettings.theme.accentColor = e.target.value;
        this.updatePreview();
      });
    }

    // Sharingan settings
    this.bindToggle('idle-animation', 'sharingan.idleAnimation');
    this.bindRange('idle-speed', 'sharingan.idleSpinSpeed', (v) => `${v}x`);
    this.bindToggle('activation-animation', 'sharingan.activationAnimation');
    this.bindRange('ems-pulse', 'sharingan.emsPulseIntensity', (v) => `${Math.round(v * 100)}%`);
    this.bindToggle('susanoo-aura', 'sharingan.susanooAuraEnabled');
    this.bindSelect('eye-position', 'sharingan.eyePosition');
    this.bindSelect('eye-size', 'sharingan.eyeSize');
    this.bindRange('eye-opacity', 'sharingan.eyeOpacity', (v) => `${Math.round(v * 100)}%`);

    // Overlay settings
    this.container.querySelectorAll('.style-option').forEach(option => {
      option.addEventListener('click', (e) => this.handleBubbleStyleChange(e));
    });

    this.bindSelect('font-family', 'overlay.fontFamily', (val) => {
      const font = this.fonts.find(f => f.id === val);
      return font ? font.family : val;
    });
    
    this.bindRange('font-size', 'overlay.fontSize', (v) => `${v}px`);
    this.bindColor('font-color', 'overlay.fontColor');
    this.bindRange('bg-opacity', 'overlay.backgroundColor', (v) => {
      this.currentSettings.overlay.backgroundColor = `rgba(0, 0, 0, ${v})`;
      return `${Math.round(v * 100)}%`;
    });
    this.bindRange('border-radius', 'overlay.borderRadius', (v) => `${v}px`);
    this.bindRange('max-width', 'overlay.maxWidth', (v) => `${v}px`);
    this.bindToggle('smart-positioning', 'overlay.smartPositioning');

    // Effects
    this.bindToggle('scanlines', 'effects.scanlinesEnabled');
    this.bindRange('scanline-opacity', 'effects.scanlineOpacity', (v) => `${Math.round(v * 100)}%`);
    this.bindToggle('chakra-particles', 'effects.chakraParticles');
    this.bindSelect('particle-density', 'effects.particleDensity');
    this.bindToggle('screen-shake', 'effects.screenShakeOnActivate');
    this.bindToggle('chromatic-aberration', 'effects.chromaticAberration');

    // Accessibility
    this.bindToggle('reduce-motion', 'accessibility.reduceMotion');
    this.bindToggle('high-contrast', 'accessibility.highContrast');
    this.bindToggle('large-text', 'accessibility.largeText');
    this.bindSelect('color-blind-mode', 'accessibility.colorBlindMode');

    // Actions
    this.container.querySelector('#reset-appearance').addEventListener('click', () => {
      this.resetToDefaults();
    });

    this.container.querySelector('#save-appearance').addEventListener('click', () => {
      this.saveSettings();
      this.showNotification('Settings saved successfully!', 'success');
    });

    // Performance warning check
    this.checkPerformanceImpact();
  }

  /**
   * Helper methods for binding form elements
   */
  bindToggle(id, path) {
    const element = this.container.querySelector(`#${id}`);
    if (!element) return;
    
    element.addEventListener('change', (e) => {
      this.setNestedValue(this.currentSettings, path, e.target.checked);
      this.updatePreview();
      this.checkPerformanceImpact();
      
      // Handle dependent fields
      if (id === 'idle-animation') {
        const speedSetting = this.container.querySelector('.range-setting:has(#idle-speed)');
        if (speedSetting) {
          speedSetting.classList.toggle('disabled', !e.target.checked);
        }
      }
    });
  }

  bindRange(id, path, formatFn) {
    const element = this.container.querySelector(`#${id}`);
    if (!element) return;
    
    element.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.setNestedValue(this.currentSettings, path, value);
      
      const valueDisplay = e.target.nextElementSibling;
      if (valueDisplay && formatFn) {
        valueDisplay.textContent = formatFn(value);
      }
      
      this.updatePreview();
    });
  }

  bindSelect(id, path, transformFn) {
    const element = this.container.querySelector(`#${id}`);
    if (!element) return;
    
    element.addEventListener('change', (e) => {
      let value = e.target.value;
      if (transformFn) value = transformFn(value);
      this.setNestedValue(this.currentSettings, path, value);
      this.updatePreview();
    });
  }

  bindColor(id, path) {
    const element = this.container.querySelector(`#${id}`);
    if (!element) return;
    
    element.addEventListener('input', (e) => {
      this.setNestedValue(this.currentSettings, path, e.target.value);
      this.updatePreview();
    });
  }

  /**
   * Handle theme selection
   */
  handleThemeChange(e) {
    const themeKey = e.currentTarget.dataset.theme;
    
    // Update UI
    this.container.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.remove('active');
    });
    e.currentTarget.classList.add('active');
    
    // Update settings
    this.currentSettings.theme.mode = themeKey;
    
    if (themeKey !== 'custom' && this.themes[themeKey]) {
      const theme = this.themes[themeKey];
      this.currentSettings.theme.primaryColor = theme.colors.primary;
      this.currentSettings.theme.accentColor = theme.colors.secondary;
    }
    
    // Show/hide custom color picker
    const customSection = this.container.querySelector('.color-customization');
    if (customSection) {
      customSection.classList.toggle('visible', themeKey === 'custom');
    }
    
    this.updatePreview();
    this.applyTheme(themeKey);
  }

  /**
   * Handle bubble style selection
   */
  handleBubbleStyleChange(e) {
    const style = e.currentTarget.dataset.style;
    
    this.container.querySelectorAll('.style-option').forEach(opt => {
      opt.classList.remove('active');
    });
    e.currentTarget.classList.add('active');
    
    this.currentSettings.overlay.bubbleStyle = style;
    this.updatePreview();
  }

  /**
   * Apply selected theme to the settings page itself
   */
  applyTheme(themeKey) {
    document.body.setAttribute('data-theme', themeKey);
    
    if (this.themes[themeKey]) {
      const theme = this.themes[themeKey];
      document.documentElement.style.setProperty('--theme-primary', theme.colors.primary);
      document.documentElement.style.setProperty('--theme-secondary', theme.colors.secondary);
      document.documentElement.style.setProperty('--theme-bg', theme.colors.background);
    }
  }

  /**
   * Update the live preview elements
   */
  updatePreview() {
    const preview = this.container.querySelector('#bubble-preview .sample-bubble');
    if (!preview) return;
    
    const font = this.fonts.find(f => f.id === this.currentSettings.overlay.fontFamily) || this.fonts[0];
    
    preview.style.cssText = `
      font-family: ${font.family};
      font-size: ${this.currentSettings.overlay.fontSize}px;
      color: ${this.currentSettings.overlay.fontColor};
      background: ${this.currentSettings.overlay.backgroundColor};
      border-radius: ${this.currentSettings.overlay.borderRadius}px;
      padding: ${this.currentSettings.overlay.padding}px;
      max-width: ${this.currentSettings.overlay.maxWidth}px;
      text-align: ${this.currentSettings.overlay.textAlign};
      line-height: ${this.currentSettings.overlay.lineHeight};
      text-shadow: ${this.currentSettings.overlay.textShadow ? '2px 2px 0 #000' : 'none'};
      -webkit-text-stroke: ${this.currentSettings.overlay.strokeWidth}px ${this.currentSettings.overlay.strokeColor};
      transition: all 0.3s ease;
    `;
    
    // Apply accessibility modifiers
    if (this.currentSettings.accessibility.highContrast) {
      preview.style.filter = 'contrast(1.5)';
    } else {
      preview.style.filter = '';
    }
    
    if (this.currentSettings.accessibility.largeText) {
      preview.style.fontSize = `${this.currentSettings.overlay.fontSize * 1.25}px`;
    }
  }

  /**
   * Apply preview to actual extension components
   */
  applyPreview() {
    chrome.runtime.sendMessage({
      type: 'APPLY_APPEARANCE_PREVIEW',
      settings: this.currentSettings
    });
  }

  /**
   * Check for performance-heavy combinations
   */
  checkPerformanceImpact() {
    const heavyEffects = [
      this.currentSettings.effects.chakraParticles && this.currentSettings.effects.particleDensity === 'high',
      this.currentSettings.effects.chromaticAberration,
      this.currentSettings.effects.screenShakeOnActivate,
      this.currentSettings.sharingan.susanooAuraEnabled && this.currentSettings.effects.chakraParticles
    ];
    
    const warningEl = this.container.querySelector('#performance-warning');
    if (warningEl) {
      warningEl.style.display = heavyEffects.filter(Boolean).length >= 2 ? 'flex' : 'none';
    }
  }

  /**
   * Reset all appearance settings to defaults
   */
  async resetToDefaults() {
    if (!confirm('Reset all appearance settings to default values?')) return;
    
    this.currentSettings = JSON.parse(JSON.stringify(this.defaults));
    await this.saveSettings();
    this.render();
    this.attachEventListeners();
    this.applyPreview();
    
    this.showNotification('Settings reset to defaults', 'info');
  }

  /**
   * Show notification toast
   */
  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Utility: Set nested object value by path
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Utility: Deep merge objects
   */
  deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Utility: Parse opacity from rgba string
   */
  parseOpacity(rgba) {
    const match = rgba.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
    return match ? parseFloat(match[1]) : 0.85;
  }

  /**
   * Utility: Get font family by ID
   */
  getFontFamily(fontId) {
    const font = this.fonts.find(f => f.id === fontId);
    return font ? font.family : fontId;
  }

  /**
   * Export settings for backup
   */
  exportSettings() {
    return JSON.stringify(this.currentSettings, null, 2);
  }

  /**
   * Import settings from backup
   */
  async importSettings(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      this.currentSettings = this.deepMerge(this.defaults, imported);
      await this.saveSettings();
      this.render();
      this.attachEventListeners();
      return true;
    } catch (e) {
      console.error('Failed to import settings:', e);
      return false;
    }
  }

  /**
   * Get CSS variables for current theme
   */
  getThemeCSS() {
    const settings = this.currentSettings;
    const theme = this.themes[settings.theme.mode] || this.themes.sharingan;
    
    return `
      :root {
        --sharingan-primary: ${settings.theme.primaryColor};
        --sharingan-secondary: ${settings.theme.accentColor};
        --sharingan-bg: ${theme.colors.background};
        --sharingan-surface: ${theme.colors.surface};
        --sharingan-text: ${theme.colors.text};
        
        --overlay-font-family: ${this.getFontFamily(settings.overlay.fontFamily)};
        --overlay-font-size: ${settings.overlay.fontSize}px;
        --overlay-font-color: ${settings.overlay.fontColor};
        --overlay-bg: ${settings.overlay.backgroundColor};
        --overlay-radius: ${settings.overlay.borderRadius}px;
        --overlay-padding: ${settings.overlay.padding}px;
        --overlay-max-width: ${settings.overlay.maxWidth}px;
        
        --eye-opacity: ${settings.sharingan.eyeOpacity};
        --eye-spin-speed: ${settings.sharingan.idleSpinSpeed}s;
        --ems-pulse: ${settings.sharingan.emsPulseIntensity};
      }
    `;
  }

  /**
   * Cleanup
   */
  destroy() {
    this.removeAllListeners();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in options page
export default AppearanceSettings;

// Initialize if loaded directly
if (typeof window !== 'undefined' && document.currentScript) {
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('appearance-settings-container');
    if (container) {
      const settings = new AppearanceSettings();
      settings.init(container);
    }
  });
}