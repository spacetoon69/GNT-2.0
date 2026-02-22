// ui/options/pages/advanced-settings.js

/**
 * Advanced Settings Page
 * Performance, security, and experimental features for power users
 */

import { ConfigManager } from '../../../core/shared/config-manager.js';
import { PerformanceMonitor } from '../../../core/shared/utils/performance-monitor.js';

class AdvancedSettings {
  constructor() {
    this.config = new ConfigManager();
    this.perfMonitor = new PerformanceMonitor();
    this.settingsContainer = null;
    this.debounceTimer = null;
  }

  /**
   * Initialize the advanced settings page
   */
  async init() {
    this.settingsContainer = document.getElementById('advanced-settings-container');
    if (!this.settingsContainer) return;

    await this.render();
    this.attachEventListeners();
    await this.loadCurrentSettings();
  }

  /**
   * Render the advanced settings UI
   */
  async render() {
    const settings = [
      {
        id: 'performance-section',
        title: chrome.i18n.getMessage('advanced_performance_title') || 'Performance & Resource Management',
        icon: '⚡',
        settings: [
          {
            id: 'ocr-concurrency',
            type: 'slider',
            label: 'OCR Processing Threads',
            description: 'Maximum parallel OCR operations. Higher values use more RAM but process pages faster.',
            min: 1,
            max: 8,
            step: 1,
            default: 4,
            unit: 'threads',
            warning: 'Values above 4 may cause instability on systems with less than 16GB RAM'
          },
          {
            id: 'image-cache-limit',
            type: 'slider',
            label: 'Image Cache Size',
            description: 'Maximum storage for processed manga pages. Auto-clears oldest entries when exceeded.',
            min: 100,
            max: 2000,
            step: 100,
            default: 500,
            unit: 'MB',
            warning: null
          },
          {
            id: 'gpu-acceleration',
            type: 'toggle',
            label: 'GPU Acceleration',
            description: 'Use WebGL for image preprocessing and TensorFlow.js operations. Disable if experiencing graphics driver issues.',
            default: true,
            warning: null
          },
          {
            id: 'lazy-loading-threshold',
            type: 'select',
            label: 'Lazy Loading Threshold',
            description: 'Distance from viewport to begin pre-processing pages.',
            options: [
              { value: 'conservative', label: 'Conservative (500px) - Less RAM, slower' },
              { value: 'balanced', label: 'Balanced (1000px) - Recommended' },
              { value: 'aggressive', label: 'Aggressive (2000px) - More RAM, instant' }
            ],
            default: 'balanced',
            warning: null
          },
          {
            id: 'memory-pressure-handler',
            type: 'toggle',
            label: 'Memory Pressure Handler',
            description: 'Automatically pause processing and clear caches when system memory is low.',
            default: true,
            warning: null
          }
        ]
      },
      {
        id: 'security-section',
        title: chrome.i18n.getMessage('advanced_security_title') || 'Security & Privacy Hardening',
        icon: '🛡️',
        settings: [
          {
            id: 'integrity-checks',
            type: 'toggle',
            label: 'Runtime Integrity Verification',
            description: 'Continuously verify code integrity to detect tampering. Slight performance impact.',
            default: true,
            warning: 'Disabling reduces protection against extension modification'
          },
          {
            id: 'wasm-sandbox',
            type: 'toggle',
            label: 'WASM Sandboxing',
            description: 'Isolate WebAssembly modules in separate process with strict CSP.',
            default: true,
            warning: null
          },
          {
            id: 'api-key-encryption',
            type: 'select',
            label: 'API Key Storage Encryption',
            description: 'Encryption level for stored translation service credentials.',
            options: [
              { value: 'standard', label: 'Standard (AES-256-GCM with browser key)' },
              { value: 'hardware', label: 'Hardware-backed (Requires TPM/Secure Enclave)' },
              { value: 'password', label: 'Password-derived (PBKDF2 + User Password)' }
            ],
            default: 'standard',
            warning: 'Hardware-backed may fail on unsupported systems'
          },
          {
            id: 'network-isolation',
            type: 'toggle',
            label: 'Strict Network Isolation',
            description: 'Prevent content scripts from accessing translation APIs directly. All requests routed through background service worker.',
            default: true,
            warning: null
          },
          {
            id: 'audit-logging',
            type: 'toggle',
            label: 'Security Audit Logging',
            description: 'Log security-relevant events (permission changes, integrity failures) locally.',
            default: false,
            warning: 'Logs may contain sensitive page metadata'
          }
        ]
      },
      {
        id: 'ocr-engine-section',
        title: chrome.i18n.getMessage('advanced_ocr_title') || 'OCR Engine Tuning',
        icon: '👁️',
        settings: [
          {
            id: 'tesseract-psm',
            type: 'select',
            label: 'Page Segmentation Mode',
            description: 'How Tesseract analyzes page structure. Manga-specific modes available.',
            options: [
              { value: '6', label: '6: Assume uniform block of text' },
              { value: '3', label: '3: Fully automatic (Default)' },
              { value: '11', label: '11: Sparse text - find as much text as possible' },
              { value: '12', label: '12: Sparse text with OSD' },
              { value: 'manga', label: 'Manga-optimized (Custom)' }
            ],
            default: 'manga',
            warning: null
          },
          {
            id: 'ocr-engine-mode',
            type: 'select',
            label: 'OCR Engine Mode',
            description: 'Accuracy vs speed tradeoff.',
            options: [
              { value: '0', label: '0: Legacy engine only (Fastest, less accurate)' },
              { value: '1', label: '1: Neural nets LSTM only (Recommended)' },
              { value: '2', label: '2: Legacy + LSTM (Slowest, most accurate)' },
              { value: '3', label: '3: Default (Based on available models)' }
            ],
            default: '1',
            warning: null
          },
          {
            id: 'vertical-text-optimization',
            type: 'toggle',
            label: 'Vertical Text Optimization',
            description: 'Specialized preprocessing for Japanese vertical text (tategaki).',
            default: true,
            warning: null
          },
          {
            id: 'handwriting-detection',
            type: 'toggle',
            label: 'Handwritten Text Detection',
            description: 'Enable experimental support for handwritten notes/sfx in manga.',
            default: false,
            warning: 'Experimental: High false-positive rate on stylized fonts'
          }
        ]
      },
      {
        id: 'experimental-section',
        title: chrome.i18n.getMessage('advanced_experimental_title') || 'Experimental Features',
        icon: '⚗️',
        experimental: true,
        settings: [
          {
            id: 'local-llm',
            type: 'toggle',
            label: 'On-Device Translation (LLM)',
            description: 'Use WebGPU-accelerated local LLM for translation without API calls. Requires 8GB+ VRAM.',
            default: false,
            warning: 'EXTREMELY EXPERIMENTAL: High battery usage, limited language support'
          },
          {
            id: 'predictive-preload',
            type: 'toggle',
            label: 'Predictive Page Preloading',
            description: 'AI-based prediction of next page to preload. Analyzes reading speed and scroll patterns.',
            default: false,
            warning: 'Sends anonymized reading metrics to local ML model'
          },
          {
            id: 'contextual-translation',
            type: 'toggle',
            label: 'Cross-Bubble Context Awareness',
            description: 'Maintain translation context across multiple speech bubbles for narrative coherence.',
            default: false,
            warning: 'Increases API usage and cost'
          },
          {
            id: 'desktop-overlay-mode',
            type: 'toggle',
            label: 'System-Level Overlay Mode',
            description: 'Native desktop overlay using companion app. Allows translation outside browser.',
            default: false,
            warning: 'Requires native messaging host installation and additional permissions'
          },
          {
            id: 'debug-mode',
            type: 'toggle',
            label: 'Developer Debug Mode',
            description: 'Enable verbose logging, performance metrics overlay, and inspector access.',
            default: false,
            warning: 'Significant performance impact. Logs may contain page content.'
          }
        ]
      }
    ];

    this.settingsContainer.innerHTML = settings.map(section => this.renderSection(section)).join('');
    
    // Add system info panel
    await this.renderSystemInfo();
  }

  /**
   * Render a settings section
   */
  renderSection(section) {
    const experimentalBadge = section.experimental ? 
      '<span class="experimental-badge">EXPERIMENTAL</span>' : '';
    
    const settingsHtml = section.settings.map(setting => this.renderSetting(setting)).join('');

    return `
      <div class="settings-section" id="${section.id}">
        <div class="section-header">
          <span class="section-icon">${section.icon}</span>
          <h3>${section.title}${experimentalBadge}</h3>
        </div>
        <div class="section-content">
          ${settingsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render individual setting control
   */
  renderSetting(setting) {
    const warningHtml = setting.warning ? 
      `<div class="setting-warning"><span class="warning-icon">⚠️</span>${setting.warning}</div>` : '';
    
    let controlHtml = '';
    
    switch (setting.type) {
      case 'toggle':
        controlHtml = `
          <label class="toggle-switch">
            <input type="checkbox" id="${setting.id}" data-setting-id="${setting.id}">
            <span class="toggle-slider"></span>
          </label>
        `;
        break;
        
      case 'slider':
        controlHtml = `
          <div class="slider-control">
            <input type="range" id="${setting.id}" 
              min="${setting.min}" max="${setting.max}" step="${setting.step}"
              data-setting-id="${setting.id}">
            <span class="slider-value" id="${setting.id}-value">${setting.default} ${setting.unit}</span>
          </div>
        `;
        break;
        
      case 'select':
        const options = setting.options.map(opt => 
          `<option value="${opt.value}">${opt.label}</option>`
        ).join('');
        controlHtml = `
          <select id="${setting.id}" data-setting-id="${setting.id}">
            ${options}
          </select>
        `;
        break;
    }

    return `
      <div class="setting-card" data-type="${setting.type}">
        <div class="setting-info">
          <label class="setting-label" for="${setting.id}">${setting.label}</label>
          <p class="setting-description">${setting.description}</p>
          ${warningHtml}
        </div>
        <div class="setting-control">
          ${controlHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render system information panel
   */
  async renderSystemInfo() {
    const info = await this.gatherSystemInfo();
    
    const infoPanel = document.createElement('div');
    infoPanel.className = 'system-info-panel';
    infoPanel.innerHTML = `
      <div class="section-header">
        <span class="section-icon">📊</span>
        <h3>System Information</h3>
      </div>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Extension Version</span>
          <span class="info-value">${info.version}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Manifest Version</span>
          <span class="info-value">${info.manifestVersion}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Available Memory</span>
          <span class="info-value ${info.memoryClass}">${info.availableMemory}</span>
        </div>
        <div class="info-item">
          <span class="info-label">WebGPU Support</span>
          <span class="info-value ${info.webgpu ? 'supported' : 'unsupported'}">
            ${info.webgpu ? '✓ Available' : '✗ Unavailable'}
          </span>
        </div>
        <div class="info-item">
          <span class="info-label">Hardware Concurrency</span>
          <span class="info-value">${info.cores} cores</span>
        </div>
        <div class="info-item">
          <span class="info-label">Storage Quota</span>
          <span class="info-value">${info.storageQuota}</span>
        </div>
        <div class="info-item wide">
          <span class="info-label">Translation Cache</span>
          <span class="info-value">${info.cacheSize} entries (${info.cacheStorage})</span>
          <button class="secondary-btn" id="clear-cache-btn">Clear Cache</button>
        </div>
      </div>
      <div class="diagnostics-actions">
        <button class="secondary-btn" id="export-logs-btn">Export Diagnostic Logs</button>
        <button class="secondary-btn" id="reset-advanced-btn">Reset to Defaults</button>
      </div>
    `;
    
    this.settingsContainer.appendChild(infoPanel);
  }

  /**
   * Gather system information
   */
  async gatherSystemInfo() {
    const manifest = chrome.runtime.getManifest();
    const memory = navigator.deviceMemory || 'unknown';
    const cores = navigator.hardwareConcurrency || 'unknown';
    
    // Check WebGPU support
    let webgpu = false;
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      webgpu = !!adapter;
    } catch (e) {
      webgpu = false;
    }

    // Get storage info
    let storageQuota = 'unknown';
    try {
      const estimate = await navigator.storage?.estimate();
      if (estimate) {
        const total = Math.round(estimate.quota / 1024 / 1024);
        const used = Math.round((estimate.usage || 0) / 1024 / 1024);
        storageQuota = `${used}MB / ${total}MB`;
      }
    } catch (e) {
      storageQuota = 'unavailable';
    }

    // Get cache stats
    const cacheStats = await this.perfMonitor.getCacheStats();

    return {
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
      availableMemory: memory === 8 ? '8GB+' : memory < 8 ? `${memory}GB (Limited)` : `${memory}GB`,
      memoryClass: memory < 8 ? 'warning' : memory >= 16 ? 'optimal' : '',
      webgpu,
      cores,
      storageQuota,
      cacheSize: cacheStats.entries,
      cacheStorage: cacheStats.size
    };
  }

  /**
   * Attach event listeners to controls
   */
  attachEventListeners() {
    // Toggle switches
    this.settingsContainer.querySelectorAll('input[type="checkbox"]').forEach(toggle => {
      toggle.addEventListener('change', (e) => this.handleSettingChange(e.target.dataset.settingId, e.target.checked));
    });

    // Sliders
    this.settingsContainer.querySelectorAll('input[type="range"]').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const valueSpan = document.getElementById(`${e.target.dataset.settingId}-value`);
        const setting = this.findSettingById(e.target.dataset.settingId);
        valueSpan.textContent = `${e.target.value} ${setting?.unit || ''}`;
      });
      slider.addEventListener('change', (e) => this.handleSettingChange(e.target.dataset.settingId, parseInt(e.target.value)));
    });

    // Selects
    this.settingsContainer.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', (e) => this.handleSettingChange(e.target.dataset.settingId, e.target.value));
    });

    // System info buttons
    this.settingsContainer.addEventListener('click', async (e) => {
      if (e.target.id === 'clear-cache-btn') {
        await this.clearCache();
      } else if (e.target.id === 'export-logs-btn') {
        await this.exportLogs();
      } else if (e.target.id === 'reset-advanced-btn') {
        await this.resetToDefaults();
      }
    });
  }

  /**
   * Handle setting change with debouncing
   */
  handleSettingChange(settingId, value) {
    // Debounce rapid changes
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      await this.config.set(`advanced.${settingId}`, value);
      
      // Apply immediate effects for certain settings
      if (settingId === 'debug-mode') {
        await this.applyDebugMode(value);
      } else if (settingId === 'gpu-acceleration') {
        await this.applyGPUAcceleration(value);
      }
      
      // Show toast notification
      this.showToast(`${this.findSettingById(settingId)?.label || settingId} updated`);
    }, 300);
  }

  /**
   * Load current settings from storage
   */
  async loadCurrentSettings() {
    const advanced = await this.config.get('advanced') || {};
    
    Object.entries(advanced).forEach(([key, value]) => {
      const element = document.querySelector(`[data-setting-id="${key}"]`);
      if (!element) return;

      if (element.type === 'checkbox') {
        element.checked = value;
      } else if (element.type === 'range') {
        element.value = value;
        const valueSpan = document.getElementById(`${key}-value`);
        const setting = this.findSettingById(key);
        if (valueSpan) valueSpan.textContent = `${value} ${setting?.unit || ''}`;
      } else {
        element.value = value;
      }
    });
  }

  /**
   * Find setting definition by ID
   */
  findSettingById(id) {
    const sections = this.settingsContainer.querySelectorAll('.settings-section');
    for (const section of sections) {
      // This is a simplified lookup - in production, store settings map
      const card = section.querySelector(`[data-setting-id="${id}"]`)?.closest('.setting-card');
      if (card) {
        return {
          id,
          label: card.querySelector('.setting-label')?.textContent,
          unit: card.querySelector('.slider-value') ? 
            card.querySelector('.slider-value').textContent.split(' ').slice(1).join(' ') : 
            undefined
        };
      }
    }
    return null;
  }

  /**
   * Apply debug mode immediately
   */
  async applyDebugMode(enabled) {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_DEBUG_MODE',
      enabled
    });
  }

  /**
   * Apply GPU acceleration setting
   */
  async applyGPUAcceleration(enabled) {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_GPU_ACCELERATION',
      enabled
    });
  }

  /**
   * Clear translation cache
   */
  async clearCache() {
    if (!confirm('Clear all cached translations and processed images? This cannot be undone.')) return;
    
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    this.showToast('Cache cleared successfully');
    await this.renderSystemInfo(); // Refresh stats
  }

  /**
   * Export diagnostic logs
   */
  async exportLogs() {
    const logs = await chrome.runtime.sendMessage({ type: 'EXPORT_DIAGNOSTICS' });
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `madara-diagnostics-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showToast('Diagnostic logs exported');
  }

  /**
   * Reset all advanced settings to defaults
   */
  async resetToDefaults() {
    if (!confirm('Reset all advanced settings to default values?')) return;
    
    await this.config.remove('advanced');
    await this.loadCurrentSettings();
    this.showToast('Settings reset to defaults');
  }

  /**
   * Show toast notification
   */
  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new AdvancedSettings().init());
} else {
  new AdvancedSettings().init();
}

export default AdvancedSettings;