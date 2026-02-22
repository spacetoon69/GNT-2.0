// ui/options/pages/hotkey-settings.js
// Keyboard shortcut configuration and hotkey management system

import { ConfigManager } from '../../../core/shared/config-manager.js';
import { EventEmitter } from '../../../core/shared/utils/event-emitter.js';

/**
 * HotkeySettings - Manages all keyboard shortcuts and input bindings
 * Supports complex chords, modifier combinations, and context-aware shortcuts
 */
class HotkeySettings extends EventEmitter {
  constructor() {
    super();
    this.config = new ConfigManager();
    this.container = null;
    this.currentSettings = null;
    this.recordingState = null;
    
    // Default hotkey configuration
    this.defaults = {
      // Core activation shortcuts
      activation: {
        toggleExtension: {
          key: 'KeyT',
          modifiers: ['Alt'],
          display: 'Alt + T',
          description: 'Toggle extension on/off',
          global: false,
          context: 'all'
        },
        activateSharingan: {
          key: 'KeyS',
          modifiers: ['Alt', 'Shift'],
          display: 'Alt + Shift + S',
          description: 'Activate Sharingan scan mode',
          global: false,
          context: 'content'
        },
        quickTranslate: {
          key: 'KeyQ',
          modifiers: ['Alt'],
          display: 'Alt + Q',
          description: 'Quick translate under cursor',
          global: false,
          context: 'content'
        },
        emergencyStop: {
          key: 'Escape',
          modifiers: [],
          display: 'Escape',
          description: 'Emergency stop all operations',
          global: true,
          context: 'all'
        }
      },
      
      // Navigation shortcuts
      navigation: {
        nextPanel: {
          key: 'ArrowRight',
          modifiers: [],
          display: '→',
          description: 'Navigate to next manga panel',
          global: false,
          context: 'content'
        },
        previousPanel: {
          key: 'ArrowLeft',
          modifiers: [],
          display: '←',
          description: 'Navigate to previous panel',
          global: false,
          context: 'content'
        },
        nextPage: {
          key: 'PageDown',
          modifiers: [],
          display: 'Page Down',
          description: 'Next page/chapter',
          global: false,
          context: 'content'
        },
        previousPage: {
          key: 'PageUp',
          modifiers: [],
          display: 'Page Up',
          description: 'Previous page/chapter',
          global: false,
          context: 'content'
        },
        firstPanel: {
          key: 'Home',
          modifiers: [],
          display: 'Home',
          description: 'Jump to first panel',
          global: false,
          context: 'content'
        },
        lastPanel: {
          key: 'End',
          modifiers: [],
          display: 'End',
          description: 'Jump to last panel',
          global: false,
          context: 'content'
        }
      },
      
      // Translation controls
      translation: {
        translatePage: {
          key: 'KeyR',
          modifiers: ['Alt'],
          display: 'Alt + R',
          description: 'Translate entire page',
          global: false,
          context: 'content'
        },
        translateSelection: {
          key: 'KeyT',
          modifiers: ['Control'],
          display: 'Ctrl + T',
          description: 'Translate selected text/bubble',
          global: false,
          context: 'content'
        },
        retranslate: {
          key: 'KeyR',
          modifiers: ['Control', 'Shift'],
          display: 'Ctrl + Shift + R',
          description: 'Retranslate with different engine',
          global: false,
          context: 'content'
        },
        toggleOriginal: {
          key: 'KeyO',
          modifiers: ['Alt'],
          display: 'Alt + O',
          description: 'Toggle original/translation',
          global: false,
          context: 'content'
        },
        copyTranslation: {
          key: 'KeyC',
          modifiers: ['Control', 'Alt'],
          display: 'Ctrl + Alt + C',
          description: 'Copy translation to clipboard',
          global: false,
          context: 'content'
        }
      },
      
      // OCR and scanning
      ocr: {
        scanArea: {
          key: 'KeyA',
          modifiers: ['Alt', 'Shift'],
          display: 'Alt + Shift + A',
          description: 'Scan specific area',
          global: false,
          context: 'content'
        },
        rescanPanel: {
          key: 'KeyF5',
          modifiers: [],
          display: 'F5',
          description: 'Rescan current panel',
          global: false,
          context: 'content'
        },
        toggleOCR: {
          key: 'KeyO',
          modifiers: ['Control', 'Shift'],
          display: 'Ctrl + Shift + O',
          description: 'Toggle OCR on/off',
          global: false,
          context: 'content'
        },
        manualBubbleSelect: {
          key: 'KeyB',
          modifiers: ['Alt'],
          display: 'Alt + B',
          description: 'Manual bubble selection mode',
          global: false,
          context: 'content'
        }
      },
      
      // UI controls
      ui: {
        toggleOverlay: {
          key: 'KeyH',
          modifiers: ['Alt'],
          display: 'Alt + H',
          description: 'Hide/show all overlays',
          global: false,
          context: 'all'
        },
        toggleSharinganEye: {
          key: 'KeyE',
          modifiers: ['Alt'],
          display: 'Alt + E',
          description: 'Toggle Sharingan eye visibility',
          global: false,
          context: 'all'
        },
        openSettings: {
          key: 'Comma',
          modifiers: ['Alt'],
          display: 'Alt + ,',
          description: 'Open settings page',
          global: false,
          context: 'all'
        },
        openPopup: {
          key: 'KeyP',
          modifiers: ['Alt'],
          display: 'Alt + P',
          description: 'Open extension popup',
          global: false,
          context: 'all'
        }
      },
      
      // Advanced/Developer
      advanced: {
        debugMode: {
          key: 'F12',
          modifiers: ['Control', 'Shift'],
          display: 'Ctrl + Shift + F12',
          description: 'Toggle debug overlay',
          global: false,
          context: 'all'
        },
        exportData: {
          key: 'KeyE',
          modifiers: ['Control', 'Shift', 'Alt'],
          display: 'Ctrl + Shift + Alt + E',
          description: 'Export translation data',
          global: false,
          context: 'all'
        },
        clearCache: {
          key: 'Delete',
          modifiers: ['Control', 'Shift', 'Alt'],
          display: 'Ctrl + Shift + Alt + Del',
          description: 'Clear translation cache',
          global: false,
          context: 'all'
        },
        reloadExtension: {
          key: 'KeyR',
          modifiers: ['Control', 'Shift', 'Alt'],
          display: 'Ctrl + Shift + Alt + R',
          description: 'Reload extension (dev)',
          global: false,
          context: 'all'
        }
      },
      
      // Mouse bindings (for completeness)
      mouse: {
        quickTranslate: {
          button: 'middle',
          modifiers: [],
          display: 'Middle Click',
          description: 'Quick translate on click',
          enabled: true
        },
        bubbleSelect: {
          button: 'left',
          modifiers: ['Alt'],
          display: 'Alt + Left Click',
          description: 'Select bubble for translation',
          enabled: true
        },
        areaScan: {
          button: 'left',
          modifiers: ['Control', 'Alt'],
          display: 'Ctrl + Alt + Drag',
          description: 'Drag to scan area',
          enabled: true
        }
      }
    };

    // Forbidden combinations (browser reserved)
    this.reservedShortcuts = [
      { key: 'KeyW', modifiers: ['Control'], reason: 'Close tab' },
      { key: 'KeyT', modifiers: ['Control'], reason: 'New tab' },
      { key: 'KeyN', modifiers: ['Control'], reason: 'New window' },
      { key: 'KeyR', modifiers: ['Control'], reason: 'Refresh page' },
      { key: 'F5', modifiers: [], reason: 'Refresh page' },
      { key: 'F12', modifiers: [], reason: 'DevTools' },
      { key: 'KeyP', modifiers: ['Control'], reason: 'Print' },
      { key: 'KeyS', modifiers: ['Control'], reason: 'Save page' },
      { key: 'KeyF', modifiers: ['Control'], reason: 'Find' },
      { key: 'Tab', modifiers: ['Alt'], reason: 'Window switch' }
    ];

    // Modifier key display mapping
    this.modifierDisplay = {
      'Control': 'Ctrl',
      'Alt': 'Alt',
      'Shift': 'Shift',
      'Meta': '⌘',
      'Command': '⌘'
    };

    this.keyDisplayMap = {
      'ArrowUp': '↑',
      'ArrowDown': '↓',
      'ArrowLeft': '←',
      'ArrowRight': '→',
      'Escape': 'Esc',
      'Delete': 'Del',
      'Backspace': '⌫',
      'Enter': '↵',
      'Space': 'Space',
      'Tab': 'Tab',
      'Comma': ',',
      'Period': '.',
      'Slash': '/',
      'Semicolon': ';',
      'Quote': "'",
      'BracketLeft': '[',
      'BracketRight': ']',
      'Backslash': '\\',
      'Minus': '-',
      'Equal': '=',
      'Backquote': '`'
    };
  }

  /**
   * Initialize the hotkey settings page
   */
  async init(container) {
    this.container = container;
    this.currentSettings = await this.loadSettings();
    
    // Check for conflicts on load
    this.validateAllBindings();
    
    this.render();
    this.attachEventListeners();
    this.updateConflictDisplay();
  }

  /**
   * Load settings from storage
   */
  async loadSettings() {
    const stored = await this.config.get('hotkeys');
    return this.deepMerge(this.defaults, stored || {});
  }

  /**
   * Save settings to storage and notify background script
   */
  async saveSettings() {
    // Validate before saving
    const conflicts = this.findConflicts();
    if (conflicts.length > 0) {
      this.showConflictWarning(conflicts);
      return false;
    }

    await this.config.set('hotkeys', this.currentSettings);
    
    // Update Chrome commands API for global shortcuts
    await this.updateChromeCommands();
    
    // Notify other components
    chrome.runtime.sendMessage({
      type: 'HOTKEY_SETTINGS_UPDATED',
      settings: this.currentSettings
    });
    
    this.emit('settingsChanged', this.currentSettings);
    return true;
  }

  /**
   * Update Chrome extension commands (global shortcuts)
   */
  async updateChromeCommands() {
    const commands = await chrome.commands.getAll();
    
    for (const [category, bindings] of Object.entries(this.currentSettings)) {
      if (category === 'mouse') continue;
      
      for (const [action, binding] of Object.entries(bindings)) {
        if (binding.global) {
          const commandId = `${category}.${action}`;
          const shortcut = this.formatForChromeCommands(binding);
          
          try {
            await chrome.commands.update({
              name: commandId,
              shortcut: shortcut
            });
          } catch (e) {
            console.warn(`Failed to update global shortcut ${commandId}:`, e);
          }
        }
      }
    }
  }

  /**
   * Format binding for Chrome commands API
   */
  formatForChromeCommands(binding) {
    const parts = [];
    if (binding.modifiers.includes('Ctrl')) parts.push('Ctrl');
    if (binding.modifiers.includes('Alt')) parts.push('Alt');
    if (binding.modifiers.includes('Shift')) parts.push('Shift');
    if (binding.modifiers.includes('Command')) parts.push('Command');
    
    let key = binding.key.replace('Key', '').replace('Digit', '');
    if (key.length === 1) key = key.toUpperCase();
    
    parts.push(key);
    return parts.join('+');
  }

  /**
   * Render the hotkey settings UI
   */
  render() {
    this.container.innerHTML = `
      <div class="hotkey-settings">
        <header class="settings-header">
          <h2>⌨️ Hotkey Settings</h2>
          <p class="subtitle">Configure keyboard shortcuts for lightning-fast translation</p>
          
          <div class="hotkey-presets">
            <label>Quick Preset:</label>
            <select id="preset-selector">
              <option value="default">Default (Balanced)</option>
              <option value="vim">Vim-style (HJKL)</option>
              <option value="wasd">Gaming (WASD)</option>
              <option value="minimal">Minimal (Essentials only)</option>
              <option value="power">Power User (Everything)</option>
            </select>
            <button class="btn-icon" id="apply-preset" title="Apply Preset">✓</button>
          </div>
        </header>

        <div class="conflict-banner" id="conflict-banner" style="display: none;">
          <span class="conflict-icon">⚠️</span>
          <div class="conflict-content">
            <strong>Shortcut Conflicts Detected</strong>
            <span id="conflict-details">Some shortcuts are overlapping</span>
          </div>
          <button class="btn-text" id="auto-resolve">Auto-resolve</button>
        </div>

        <!-- Core Activation -->
        <section class="setting-card hotkey-category" data-category="activation">
          <div class="card-header">
            <h3>⚡ Core Activation</h3>
            <span class="badge critical">Essential</span>
          </div>
          <div class="hotkey-list" id="activation-list">
            ${this.renderHotkeyList('activation')}
          </div>
        </section>

        <!-- Navigation -->
        <section class="setting-card hotkey-category" data-category="navigation">
          <div class="card-header">
            <h3>🧭 Navigation</h3>
            <span class="badge">Reading</span>
          </div>
          <div class="hotkey-list" id="navigation-list">
            ${this.renderHotkeyList('navigation')}
          </div>
        </section>

        <!-- Translation -->
        <section class="setting-card hotkey-category" data-category="translation">
          <div class="card-header">
            <h3>🌐 Translation</h3>
            <span class="badge">Core</span>
          </div>
          <div class="hotkey-list" id="translation-list">
            ${this.renderHotkeyList('translation')}
          </div>
        </section>

        <!-- OCR Controls -->
        <section class="setting-card hotkey-category" data-category="ocr">
          <div class="card-header">
            <h3>👁️ OCR & Scanning</h3>
            <span class="badge">Advanced</span>
          </div>
          <div class="hotkey-list" id="ocr-list">
            ${this.renderHotkeyList('ocr')}
          </div>
        </section>

        <!-- UI Controls -->
        <section class="setting-card hotkey-category" data-category="ui">
          <div class="card-header">
            <h3>🎨 UI Controls</h3>
            <span class="badge">Interface</span>
          </div>
          <div class="hotkey-list" id="ui-list">
            ${this.renderHotkeyList('ui')}
          </div>
        </section>

        <!-- Advanced -->
        <section class="setting-card hotkey-category collapsed" data-category="advanced">
          <div class="card-header">
            <h3>⚙️ Advanced/Developer</h3>
            <span class="badge">Expert</span>
            <button class="collapse-toggle">▼</button>
          </div>
          <div class="hotkey-list" id="advanced-list" style="display: none;">
            ${this.renderHotkeyList('advanced')}
          </div>
        </section>

        <!-- Mouse Bindings -->
        <section class="setting-card hotkey-category" data-category="mouse">
          <div class="card-header">
            <h3>🖱️ Mouse Bindings</h3>
            <span class="badge">Input</span>
          </div>
          <div class="hotkey-list" id="mouse-list">
            ${this.renderMouseBindings()}
          </div>
        </section>

        <!-- Test Area -->
        <section class="setting-card test-area">
          <div class="card-header">
            <h3>🧪 Test Shortcuts</h3>
            <span class="badge">Debug</span>
          </div>
          <div class="test-zone" id="test-zone" tabindex="0">
            <div class="test-placeholder">
              <span class="test-icon">⌨️</span>
              <p>Click here and press any shortcut to test</p>
              <span class="last-detected" id="last-detected">Waiting for input...</span>
            </div>
          </div>
        </section>

        <!-- Actions -->
        <div class="settings-actions">
          <button class="btn-secondary" id="reset-hotkeys">
            <span>↺</span> Reset to Defaults
          </button>
          <button class="btn-secondary" id="export-hotkeys">
            <span>📤</span> Export
          </button>
          <button class="btn-secondary" id="import-hotkeys">
            <span>📥</span> Import
          </button>
          <button class="btn-primary" id="save-hotkeys">
            <span>💾</span> Save Changes
          </button>
        </div>

        <!-- Recording Modal -->
        <div class="recording-modal" id="recording-modal" style="display: none;">
          <div class="modal-content">
            <h3>Recording New Shortcut</h3>
            <div class="recording-display" id="recording-display">
              <span class="recording-placeholder">Press key combination...</span>
            </div>
            <div class="recording-options">
              <label class="checkbox">
                <input type="checkbox" id="global-shortcut">
                <span>Allow in input fields</span>
              </label>
            </div>
            <div class="modal-actions">
              <button class="btn-text" id="cancel-recording">Cancel</button>
              <button class="btn-primary" id="save-recording" disabled>Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render a category of hotkey bindings
   */
  renderHotkeyList(category) {
    const bindings = this.currentSettings[category];
    if (!bindings) return '';

    return Object.entries(bindings).map(([action, binding]) => {
      const conflict = this.checkConflict(category, action);
      const isReserved = this.isReserved(binding);
      
      return `
        <div class="hotkey-item ${conflict ? 'conflict' : ''} ${isReserved ? 'reserved' : ''}" 
             data-category="${category}" 
             data-action="${action}">
          <div class="hotkey-info">
            <span class="hotkey-name">${this.formatActionName(action)}</span>
            <span class="hotkey-description">${binding.description}</span>
            ${conflict ? `<span class="conflict-badge" title="${conflict}">⚠️ Conflict</span>` : ''}
            ${isReserved ? `<span class="reserved-badge" title="${isReserved}">⚠️ Browser Reserved</span>` : ''}
          </div>
          <div class="hotkey-binding">
            <kbd class="hotkey-kbd" title="Click to change">
              ${binding.display}
            </kbd>
            <button class="btn-icon clear-hotkey" title="Clear">×</button>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render mouse binding controls
   */
  renderMouseBindings() {
    const bindings = this.currentSettings.mouse;
    return Object.entries(bindings).map(([action, binding]) => `
      <div class="hotkey-item mouse-binding" data-action="${action}">
        <div class="hotkey-info">
          <span class="hotkey-name">${this.formatActionName(action)}</span>
          <span class="hotkey-description">${binding.description}</span>
        </div>
        <div class="mouse-binding-controls">
          <select class="mouse-button-select" data-action="${action}">
            ${['left', 'middle', 'right', 'back', 'forward'].map(btn => `
              <option value="${btn}" ${binding.button === btn ? 'selected' : ''}>
                ${btn.charAt(0).toUpperCase() + btn.slice(1)}
              </option>
            `).join('')}
          </select>
          <label class="checkbox">
            <input type="checkbox" class="mouse-modifier" data-mod="Alt" 
                   ${binding.modifiers.includes('Alt') ? 'checked' : ''}> Alt
          </label>
          <label class="checkbox">
            <input type="checkbox" class="mouse-modifier" data-mod="Control" 
                   ${binding.modifiers.includes('Control') ? 'checked' : ''}> Ctrl
          </label>
          <label class="checkbox">
            <input type="checkbox" class="mouse-modifier" data-mod="Shift" 
                   ${binding.modifiers.includes('Shift') ? 'checked' : ''}> Shift
          </label>
          <label class="switch small">
            <input type="checkbox" class="mouse-enabled" 
                   ${binding.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `).join('');
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Hotkey recording
    this.container.querySelectorAll('.hotkey-kbd').forEach(kbd => {
      kbd.addEventListener('click', (e) => this.startRecording(e));
    });

    // Clear hotkey
    this.container.querySelectorAll('.clear-hotkey').forEach(btn => {
      btn.addEventListener('click', (e) => this.clearHotkey(e));
    });

    // Category collapse
    this.container.querySelectorAll('.collapse-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        const card = e.target.closest('.setting-card');
        const list = card.querySelector('.hotkey-list');
        const isCollapsed = card.classList.toggle('collapsed');
        list.style.display = isCollapsed ? 'none' : 'block';
        e.target.textContent = isCollapsed ? '▶' : '▼';
      });
    });

    // Mouse binding changes
    this.container.querySelectorAll('.mouse-button-select').forEach(select => {
      select.addEventListener('change', (e) => this.updateMouseBinding(e));
    });

    this.container.querySelectorAll('.mouse-modifier').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => this.updateMouseBinding(e));
    });

    this.container.querySelectorAll('.mouse-enabled').forEach(toggle => {
      toggle.addEventListener('change', (e) => this.updateMouseBinding(e));
    });

    // Recording modal
    const modal = this.container.querySelector('#recording-modal');
    const display = this.container.querySelector('#recording-display');
    const saveBtn = this.container.querySelector('#save-recording');

    this.container.querySelector('#cancel-recording').addEventListener('click', () => {
      this.stopRecording();
      modal.style.display = 'none';
    });

    saveBtn.addEventListener('click', () => {
      this.saveRecording();
      modal.style.display = 'none';
    });

    // Keyboard recording handler
    const handleKeyDown = (e) => {
      if (modal.style.display === 'none') return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // Build binding object
      const modifiers = [];
      if (e.ctrlKey) modifiers.push('Control');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.metaKey) modifiers.push('Meta');
      
      // Don't allow binding modifier-only
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      
      this.recordingState.newBinding = {
        key: e.code,
        modifiers: modifiers,
        display: this.formatDisplay(e.code, modifiers),
        description: this.recordingState.currentBinding.description,
        global: this.container.querySelector('#global-shortcut').checked,
        context: this.recordingState.currentBinding.context
      };
      
      display.innerHTML = `<kbd>${this.recordingState.newBinding.display}</kbd>`;
      saveBtn.disabled = false;
      
      // Check for conflicts immediately
      const conflict = this.checkConflict(
        this.recordingState.category,
        this.recordingState.action,
        this.recordingState.newBinding
      );
      
      if (conflict) {
        display.innerHTML += `<span class="recording-warning">⚠️ Conflicts with: ${conflict}</span>`;
      }
      
      if (this.isReserved(this.recordingState.newBinding)) {
        display.innerHTML += `<span class="recording-warning reserved">⚠️ Browser reserved</span>`;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Test zone
    const testZone = this.container.querySelector('#test-zone');
    const lastDetected = this.container.querySelector('#last-detected');
    
    testZone.addEventListener('keydown', (e) => {
      const detected = this.detectShortcut(e);
      if (detected) {
        e.preventDefault();
        lastDetected.textContent = `Detected: ${detected.category}.${detected.action} (${detected.binding.display})`;
        lastDetected.classList.add('detected');
        
        // Visual feedback
        testZone.classList.add('shortcut-detected');
        setTimeout(() => testZone.classList.remove('shortcut-detected'), 300);
      } else {
        lastDetected.textContent = `Key: ${this.formatDisplay(e.code, [])}`;
        lastDetected.classList.remove('detected');
      }
    });

    // Presets
    this.container.querySelector('#apply-preset').addEventListener('click', () => {
      const preset = this.container.querySelector('#preset-selector').value;
      this.applyPreset(preset);
    });

    // Actions
    this.container.querySelector('#reset-hotkeys').addEventListener('click', () => {
      if (confirm('Reset all hotkeys to default?')) {
        this.resetToDefaults();
      }
    });

    this.container.querySelector('#save-hotkeys').addEventListener('click', () => {
      this.saveSettings().then(success => {
        if (success) {
          this.showNotification('Hotkeys saved successfully!', 'success');
        }
      });
    });

    this.container.querySelector('#export-hotkeys').addEventListener('click', () => {
      this.exportSettings();
    });

    this.container.querySelector('#import-hotkeys').addEventListener('click', () => {
      this.importSettings();
    });

    this.container.querySelector('#auto-resolve').addEventListener('click', () => {
      this.autoResolveConflicts();
    });
  }

  /**
   * Start recording a new hotkey
   */
  startRecording(e) {
    const item = e.target.closest('.hotkey-item');
    const category = item.dataset.category;
    const action = item.dataset.action;
    
    this.recordingState = {
      category,
      action,
      currentBinding: this.currentSettings[category][action],
      newBinding: null
    };
    
    const modal = this.container.querySelector('#recording-modal');
    const display = this.container.querySelector('#recording-display');
    const saveBtn = this.container.querySelector('#save-recording');
    
    display.innerHTML = '<span class="recording-placeholder">Press key combination...</span>';
    saveBtn.disabled = true;
    modal.style.display = 'flex';
    
    // Focus the modal to capture keys immediately
    modal.focus();
  }

  /**
   * Stop recording
   */
  stopRecording() {
    this.recordingState = null;
  }

  /**
   * Save the recorded hotkey
   */
  saveRecording() {
    if (!this.recordingState || !this.recordingState.newBinding) return;
    
    const { category, action, newBinding } = this.recordingState;
    this.currentSettings[category][action] = newBinding;
    
    // Re-render the specific item
    const list = this.container.querySelector(`#${category}-list`);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.renderHotkeyList(category);
    list.innerHTML = tempDiv.querySelector('.hotkey-list')?.innerHTML || tempDiv.innerHTML;
    
    // Re-attach listeners to new elements
    this.attachEventListeners();
    this.updateConflictDisplay();
    
    this.emit('hotkeyChanged', { category, action, binding: newBinding });
  }

  /**
   * Clear a hotkey binding
   */
  clearHotkey(e) {
    const item = e.target.closest('.hotkey-item');
    const category = item.dataset.category;
    const action = item.dataset.action;
    
    this.currentSettings[category][action] = {
      ...this.currentSettings[category][action],
      key: null,
      modifiers: [],
      display: 'None'
    };
    
    const kbd = item.querySelector('.hotkey-kbd');
    kbd.textContent = 'None';
    kbd.classList.add('unbound');
    
    this.updateConflictDisplay();
  }

  /**
   * Update mouse binding
   */
  updateMouseBinding(e) {
    const item = e.target.closest('.mouse-binding');
    const action = item.dataset.action;
    
    const button = item.querySelector('.mouse-button-select').value;
    const modifiers = Array.from(item.querySelectorAll('.mouse-modifier:checked')).map(cb => cb.dataset.mod);
    const enabled = item.querySelector('.mouse-enabled').checked;
    
    this.currentSettings.mouse[action] = {
      ...this.currentSettings.mouse[action],
      button,
      modifiers,
      enabled,
      display: this.formatMouseDisplay(button, modifiers)
    };
  }

  /**
   * Detect if a keyboard event matches any configured shortcut
   */
  detectShortcut(e) {
    for (const [category, bindings] of Object.entries(this.currentSettings)) {
      if (category === 'mouse') continue;
      
      for (const [action, binding] of Object.entries(bindings)) {
        if (binding.key === e.code && 
            binding.modifiers.includes('Control') === e.ctrlKey &&
            binding.modifiers.includes('Alt') === e.altKey &&
            binding.modifiers.includes('Shift') === e.shiftKey &&
            binding.modifiers.includes('Meta') === e.metaKey) {
          return { category, action, binding };
        }
      }
    }
    return null;
  }

  /**
   * Check for conflicts with other bindings
   */
  checkConflict(category, action, newBinding = null) {
    const binding = newBinding || this.currentSettings[category][action];
    if (!binding.key) return null;
    
    for (const [cat, bindings] of Object.entries(this.currentSettings)) {
      if (cat === 'mouse') continue;
      
      for (const [act, other] of Object.entries(bindings)) {
        if (cat === category && act === action) continue;
        if (!other.key) continue;
        
        if (binding.key === other.key &&
            binding.modifiers.length === other.modifiers.length &&
            binding.modifiers.every(m => other.modifiers.includes(m))) {
          return `${this.formatActionName(act)} (${cat})`;
        }
      }
    }
    return null;
  }

  /**
   * Find all conflicts
   */
  findConflicts() {
    const conflicts = [];
    for (const [category, bindings] of Object.entries(this.currentSettings)) {
      if (category === 'mouse') continue;
      
      for (const [action, binding] of Object.entries(bindings)) {
        const conflict = this.checkConflict(category, action);
        if (conflict) {
          conflicts.push({ category, action, conflict });
        }
      }
    }
    return conflicts;
  }

  /**
   * Check if shortcut is browser-reserved
   */
  isReserved(binding) {
    if (!binding.key) return false;
    
    const match = this.reservedShortcuts.find(r => 
      r.key === binding.key &&
      r.modifiers.length === binding.modifiers.length &&
      r.modifiers.every(m => binding.modifiers.includes(m))
    );
    
    return match ? match.reason : false;
  }

  /**
   * Validate all bindings
   */
  validateAllBindings() {
    const conflicts = this.findConflicts();
    const reserved = [];
    
    for (const [category, bindings] of Object.entries(this.currentSettings)) {
      if (category === 'mouse') continue;
      for (const [action, binding] of Object.entries(bindings)) {
        const reason = this.isReserved(binding);
        if (reason) reserved.push({ category, action, reason });
      }
    }
    
    return { conflicts, reserved };
  }

  /**
   * Update conflict display banner
   */
  updateConflictDisplay() {
    const banner = this.container.querySelector('#conflict-banner');
    const details = this.container.querySelector('#conflict-details');
    const conflicts = this.findConflicts();
    
    if (conflicts.length > 0) {
      banner.style.display = 'flex';
      details.textContent = `${conflicts.length} conflicting shortcut${conflicts.length > 1 ? 's' : ''} detected`;
      
      // Highlight conflicting items
      this.container.querySelectorAll('.hotkey-item').forEach(item => {
        item.classList.remove('conflict');
      });
      
      conflicts.forEach(({ category, action }) => {
        const item = this.container.querySelector(
          `.hotkey-item[data-category="${category}"][data-action="${action}"]`
        );
        if (item) item.classList.add('conflict');
      });
    } else {
      banner.style.display = 'none';
    }
  }

  /**
   * Auto-resolve conflicts by unbinding duplicates
   */
  autoResolveConflicts() {
    const conflicts = this.findConflicts();
    const seen = new Set();
    
    conflicts.forEach(({ category, action }) => {
      const binding = this.currentSettings[category][action];
      const key = `${binding.key}-${binding.modifiers.sort().join('-')}`;
      
      if (seen.has(key)) {
        // Unbind this one
        this.currentSettings[category][action] = {
          ...binding,
          key: null,
          modifiers: [],
          display: 'None'
        };
      } else {
        seen.add(key);
      }
    });
    
    this.render();
    this.attachEventListeners();
    this.updateConflictDisplay();
    this.showNotification('Conflicts resolved', 'success');
  }

  /**
   * Apply preset configuration
   */
  applyPreset(presetName) {
    const presets = {
      vim: {
        navigation: {
          nextPanel: { key: 'KeyL', modifiers: [], display: 'L' },
          previousPanel: { key: 'KeyH', modifiers: [], display: 'H' },
          nextPage: { key: 'KeyJ', modifiers: [], display: 'J' },
          previousPage: { key: 'KeyK', modifiers: [], display: 'K' }
        }
      },
      wasd: {
        navigation: {
          nextPanel: { key: 'KeyD', modifiers: [], display: 'D' },
          previousPanel: { key: 'KeyA', modifiers: [], display: 'A' },
          nextPage: { key: 'KeyS', modifiers: [], display: 'S' },
          previousPage: { key: 'KeyW', modifiers: [], display: 'W' }
        }
      },
      minimal: {
        activation: {
          toggleExtension: this.defaults.activation.toggleExtension,
          quickTranslate: this.defaults.activation.quickTranslate
        },
        navigation: {
          nextPanel: this.defaults.navigation.nextPanel,
          previousPanel: this.defaults.navigation.previousPanel
        },
        translation: {
          translatePage: this.defaults.translation.translatePage
        }
      },
      power: this.defaults
    };
    
    const preset = presets[presetName];
    if (!preset) return;
    
    if (presetName === 'power') {
      this.currentSettings = JSON.parse(JSON.stringify(this.defaults));
    } else {
      // Merge preset with current, preserving non-conflicting keys
      for (const [category, bindings] of Object.entries(preset)) {
        if (this.currentSettings[category]) {
          Object.assign(this.currentSettings[category], bindings);
        }
      }
    }
    
    this.render();
    this.attachEventListeners();
    this.updateConflictDisplay();
    this.showNotification(`Applied ${presetName} preset`, 'success');
  }

  /**
   * Reset to defaults
   */
  async resetToDefaults() {
    this.currentSettings = JSON.parse(JSON.stringify(this.defaults));
    this.render();
    this.attachEventListeners();
    this.updateConflictDisplay();
    await this.saveSettings();
    this.showNotification('Hotkeys reset to defaults', 'success');
  }

  /**
   * Export settings to JSON
   */
  exportSettings() {
    const data = JSON.stringify(this.currentSettings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `sharingan-hotkeys-${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    this.showNotification('Hotkeys exported', 'success');
  }

  /**
   * Import settings from JSON
   */
  importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          this.currentSettings = this.deepMerge(this.defaults, imported);
          this.render();
          this.attachEventListeners();
          this.updateConflictDisplay();
          this.showNotification('Hotkeys imported successfully', 'success');
        } catch (err) {
          this.showNotification('Failed to import: Invalid JSON', 'error');
        }
      };
      reader.readAsText(file);
    };
    
    input.click();
  }

  /**
   * Format display string for key combination
   */
  formatDisplay(key, modifiers) {
    const parts = modifiers.map(m => this.modifierDisplay[m] || m);
    
    let keyDisplay = this.keyDisplayMap[key] || key;
    if (key.startsWith('Key')) keyDisplay = key.replace('Key', '');
    if (key.startsWith('Digit')) keyDisplay = key.replace('Digit', '');
    if (key.startsWith('Numpad')) keyDisplay = 'Num' + key.replace('Numpad', '');
    if (key.startsWith('F') && key.length <= 3) keyDisplay = key; // F1-F12
    
    parts.push(keyDisplay);
    return parts.join(' + ');
  }

  /**
   * Format mouse binding display
   */
  formatMouseDisplay(button, modifiers) {
    const parts = modifiers.map(m => this.modifierDisplay[m] || m);
    parts.push(button.charAt(0).toUpperCase() + button.slice(1) + ' Click');
    return parts.join(' + ');
  }

  /**
   * Format action name for display
   */
  formatActionName(action) {
    return action
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Show notification toast
   */
  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => toast.classList.add('show'));
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Deep merge utility
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
   * Cleanup
   */
  destroy() {
    this.stopRecording();
    this.removeAllListeners();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in options page
export default HotkeySettings;

// Initialize if loaded directly
if (typeof window !== 'undefined' && document.currentScript) {
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('hotkey-settings-container');
    if (container) {
      const settings = new HotkeySettings();
      settings.init(container);
    }
  });
}