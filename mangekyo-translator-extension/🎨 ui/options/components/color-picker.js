// ui/options/components/color-picker.js

/**
 * ColorPicker Component
 * Advanced color selection with presets, opacity control, and theme integration
 * Supports: HEX, RGB, HSL input modes, eyedropper API, and Sharingan-themed presets
 */

class ColorPicker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._value = '#ff4757';
    this._opacity = 1;
    this._isOpen = false;
    this._inputMode = 'hex'; // hex | rgb | hsl
    this._presets = [];
    this._history = [];
    this.maxHistory = 8;
  }

  static get observedAttributes() {
    return [
      'value',
      'opacity',
      'presets',
      'show-opacity',
      'show-eyedropper',
      'label',
      'theme-preset',      // sharingan | mangekyo | ems | custom
      'allow-custom-presets'
    ];
  }

  connectedCallback() {
    this.loadThemePresets();
    this.render();
    this.attachListeners();
    this.loadHistory();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'value':
        this._value = newValue || '#ff4757';
        this.updateColorDisplay();
        break;
      case 'opacity':
        this._opacity = parseFloat(newValue) || 1;
        this.updateOpacityDisplay();
        break;
      case 'presets':
        try {
          this._presets = JSON.parse(newValue);
        } catch {
          this._presets = [];
        }
        if (this._isOpen) this.renderPicker();
        break;
      case 'theme-preset':
        this.loadThemePresets();
        if (this._isOpen) this.renderPicker();
        break;
    }
  }

  /**
   * Load theme-specific color presets
   */
  loadThemePresets() {
    const theme = this.getAttribute('theme-preset') || 'custom';
    
    const themePresets = {
      sharingan: [
        { name: 'Tomoe Red', value: '#ff4757', type: 'theme' },
        { name: 'Sharingan Black', value: '#1a1a1a', type: 'theme' },
        { name: 'Iris Crimson', value: '#c0392b', type: 'theme' },
        { name: 'Bloodline', value: '#e74c3c', type: 'theme' },
        { name: 'Chakra Blue', value: '#3498db', type: 'accent' },
        { name: 'Byakugan', value: '#9b59b6', type: 'accent' }
      ],
      mangekyo: [
        { name: 'Mangekyo Red', value: '#c0392b', type: 'theme' },
        { name: 'Kaleidoscope', value: '#8e44ad', type: 'theme' },
        { name: 'Amaterasu Black', value: '#2c3e50', type: 'theme' },
        { name: 'Tsukuyomi Purple', value: '#9b59b6', type: 'theme' },
        { name: 'Susanoo Blue', value: '#2980b9', type: 'accent' },
        { name: 'Flame Orange', value: '#e67e22', type: 'accent' }
      ],
      ems: [
        { name: 'Eternal Crimson', value: '#c0392b', type: 'theme' },
        { name: 'Madara Eternal', value: '#e74c3c', type: 'theme' },
        { name: 'Rinnegan Purple', value: '#8e44ad', type: 'theme' },
        { name: 'Limbo Gray', value: '#7f8c8d', type: 'theme' },
        { name: 'Truth Black', value: '#2c3e50', type: 'theme' },
        { name: 'God Tree', value: '#27ae60', type: 'accent' }
      ],
      custom: [
        { name: 'Primary', value: '#ff4757', type: 'theme' },
        { name: 'Secondary', value: '#2ed573', type: 'accent' },
        { name: 'Warning', value: '#ffa502', type: 'utility' },
        { name: 'Info', value: '#3742fa', type: 'utility' },
        { name: 'Dark', value: '#2f3542', type: 'neutral' },
        { name: 'Light', value: '#f1f2f6', type: 'neutral' }
      ]
    };

    this._presets = themePresets[theme] || themePresets.custom;
  }

  /**
   * Render the color picker component
   */
  render() {
    const showOpacity = this.hasAttribute('show-opacity');
    const label = this.getAttribute('label') || 'Color';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          --picker-bg: var(--surface-1, #1a1a1a);
          --picker-border: var(--border-subtle, #333);
          --picker-radius: 12px;
          --text-primary: var(--text-1, #fff);
          --text-secondary: var(--text-2, #888);
          --accent-color: var(--primary, #ff4757);
          --accent-glow: var(--primary-glow, rgba(255, 71, 87, 0.3));
          
          --saturation-bg: linear-gradient(to right, #fff, rgba(255,255,255,0)),
                           linear-gradient(to top, #000, rgba(0,0,0,0));
          --hue-bg: linear-gradient(to right, 
            #f00 0%, #ff0 17%, #0f0 33%, 
            #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
        }

        .color-picker-trigger {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: var(--picker-bg);
          border: 2px solid var(--picker-border);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          user-select: none;
        }

        .color-picker-trigger:hover {
          border-color: var(--accent-color);
          box-shadow: 0 0 15px var(--accent-glow);
        }

        .color-preview {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.1);
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }

        .color-preview::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 50%);
        }

        .color-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .color-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .color-value {
          font-size: 12px;
          color: var(--text-secondary);
          font-family: 'SF Mono', monospace;
          text-transform: uppercase;
        }

        .dropdown-arrow {
          color: var(--text-secondary);
          transition: transform 0.2s ease;
        }

        .dropdown-arrow.open {
          transform: rotate(180deg);
        }

        /* Picker Popup */
        .picker-popup {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          width: 280px;
          background: var(--picker-bg);
          border: 1px solid var(--picker-border);
          border-radius: var(--picker-radius);
          padding: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
          z-index: 1000;
          opacity: 0;
          visibility: hidden;
          transform: translateY(-10px);
          transition: all 0.2s ease;
        }

        .picker-popup.open {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }

        /* Saturation/Value Box */
        .sv-box {
          width: 100%;
          height: 160px;
          background: var(--saturation-bg), ${this._value};
          background-color: ${this._value};
          border-radius: 8px;
          position: relative;
          cursor: crosshair;
          margin-bottom: 12px;
          overflow: hidden;
        }

        .sv-cursor {
          position: absolute;
          width: 12px;
          height: 12px;
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 4px rgba(0,0,0,0.5);
          transform: translate(-50%, -50%);
          pointer-events: none;
        }

        /* Hue Slider */
        .hue-slider {
          width: 100%;
          height: 12px;
          background: var(--hue-bg);
          border-radius: 6px;
          position: relative;
          cursor: pointer;
          margin-bottom: 16px;
        }

        .hue-cursor {
          position: absolute;
          width: 16px;
          height: 16px;
          background: white;
          border: 2px solid rgba(0,0,0,0.2);
          border-radius: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          pointer-events: none;
        }

        /* Opacity Slider */
        .opacity-control {
          margin-bottom: 16px;
        }

        .opacity-label {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }

        .opacity-slider {
          width: 100%;
          height: 12px;
          background: 
            linear-gradient(45deg, #333 25%, transparent 25%),
            linear-gradient(-45deg, #333 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #333 75%),
            linear-gradient(-45deg, transparent 75%, #333 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
          border-radius: 6px;
          position: relative;
          cursor: pointer;
        }

        .opacity-fill {
          position: absolute;
          height: 100%;
          background: linear-gradient(to right, transparent, ${this._value});
          border-radius: 6px;
          pointer-events: none;
        }

        .opacity-cursor {
          position: absolute;
          width: 16px;
          height: 16px;
          background: white;
          border: 2px solid rgba(0,0,0,0.2);
          border-radius: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          pointer-events: none;
        }

        /* Input Modes */
        .input-section {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }

        .input-mode-tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
        }

        .mode-tab {
          padding: 4px 10px;
          font-size: 11px;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.15s ease;
        }

        .mode-tab:hover {
          color: var(--text-primary);
          background: rgba(255,255,255,0.05);
        }

        .mode-tab.active {
          background: var(--accent-color);
          color: white;
        }

        .color-input {
          flex: 1;
          background: rgba(0,0,0,0.3);
          border: 1px solid var(--picker-border);
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: 6px;
          font-family: 'SF Mono', monospace;
          font-size: 13px;
          text-transform: uppercase;
        }

        .color-input:focus {
          outline: none;
          border-color: var(--accent-color);
        }

        /* Eyedropper */
        .eyedropper-btn {
          padding: 8px;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--picker-border);
          border-radius: 6px;
          cursor: pointer;
          color: var(--text-secondary);
          transition: all 0.15s ease;
        }

        .eyedropper-btn:hover {
          border-color: var(--accent-color);
          color: var(--accent-color);
        }

        /* Presets Grid */
        .presets-section {
          margin-bottom: 16px;
        }

        .presets-title {
          font-size: 11px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .presets-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 8px;
        }

        .preset-color {
          aspect-ratio: 1;
          border-radius: 6px;
          cursor: pointer;
          border: 2px solid transparent;
          transition: all 0.15s ease;
          position: relative;
        }

        .preset-color:hover {
          transform: scale(1.1);
          border-color: white;
          z-index: 1;
        }

        .preset-color.active {
          border-color: var(--accent-color);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }

        .preset-color.theme {
          box-shadow: 0 0 8px rgba(255, 71, 87, 0.3);
        }

        .preset-color.accent {
          box-shadow: 0 0 8px rgba(46, 213, 115, 0.3);
        }

        /* History */
        .history-section {
          border-top: 1px solid var(--picker-border);
          padding-top: 12px;
        }

        .history-grid {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .history-color {
          width: 24px;
          height: 24px;
          border-radius: 4px;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.1);
          transition: transform 0.15s ease;
        }

        .history-color:hover {
          transform: scale(1.15);
        }

        /* Add to Presets */
        .add-preset-btn {
          font-size: 11px;
          color: var(--accent-color);
          cursor: pointer;
          background: none;
          border: none;
          padding: 0;
        }

        .add-preset-btn:hover {
          text-decoration: underline;
        }

        /* Actions */
        .picker-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }

        .btn {
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s ease;
          border: none;
        }

        .btn-secondary {
          background: rgba(255,255,255,0.05);
          color: var(--text-secondary);
        }

        .btn-secondary:hover {
          background: rgba(255,255,255,0.1);
          color: var(--text-primary);
        }

        .btn-primary {
          background: var(--accent-color);
          color: white;
        }

        .btn-primary:hover {
          box-shadow: 0 0 15px var(--accent-glow);
          transform: translateY(-1px);
        }

        /* Container positioning */
        .picker-container {
          position: relative;
          display: inline-block;
        }

        /* Sharingan theme active states */
        :host([theme-active="true"]) .sv-box {
          box-shadow: 0 0 20px rgba(255, 71, 87, 0.2);
        }

        :host([theme-active="true"]) .preset-color.theme {
          animation: sharingan-pulse 2s infinite;
        }

        @keyframes sharingan-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(255, 71, 87, 0.3); }
          50% { box-shadow: 0 0 16px rgba(255, 71, 87, 0.6); }
        }
      </style>

      <div class="picker-container">
        <div class="color-picker-trigger" part="trigger">
          <div class="color-preview" id="color-preview" style="background: ${this.getColorWithOpacity()}"></div>
          <div class="color-info">
            <span class="color-label">${label}</span>
            <span class="color-value" id="color-value">${this.formatColor()}</span>
          </div>
          <span class="dropdown-arrow" id="dropdown-arrow">▼</span>
        </div>

        <div class="picker-popup ${this._isOpen ? 'open' : ''}" id="picker-popup">
          <!-- Saturation/Value Selection -->
          <div class="sv-box" id="sv-box">
            <div class="sv-cursor" id="sv-cursor"></div>
          </div>

          <!-- Hue Slider -->
          <div class="hue-slider" id="hue-slider">
            <div class="hue-cursor" id="hue-cursor"></div>
          </div>

          ${showOpacity ? `
          <!-- Opacity Slider -->
          <div class="opacity-control">
            <div class="opacity-label">
              <span>Opacity</span>
              <span>${Math.round(this._opacity * 100)}%</span>
            </div>
            <div class="opacity-slider" id="opacity-slider">
              <div class="opacity-fill" style="width: ${this._opacity * 100}%"></div>
              <div class="opacity-cursor" style="left: ${this._opacity * 100}%"></div>
            </div>
          </div>
          ` : ''}

          <!-- Input Modes -->
          <div class="input-mode-tabs">
            <button class="mode-tab ${this._inputMode === 'hex' ? 'active' : ''}" data-mode="hex">HEX</button>
            <button class="mode-tab ${this._inputMode === 'rgb' ? 'active' : ''}" data-mode="rgb">RGB</button>
            <button class="mode-tab ${this._inputMode === 'hsl' ? 'active' : ''}" data-mode="hsl">HSL</button>
          </div>
          <div class="input-section">
            <input type="text" class="color-input" id="color-input" value="${this.formatColor()}" spellcheck="false">
            ${this.hasAttribute('show-eyedropper') && 'EyeDropper' in window ? `
            <button class="eyedropper-btn" id="eyedropper-btn" title="Pick from screen">🎨</button>
            ` : ''}
          </div>

          <!-- Presets -->
          <div class="presets-section">
            <div class="presets-title">
              <span>${this.getAttribute('theme-preset') || 'Custom'} Presets</span>
              ${this.hasAttribute('allow-custom-presets') ? `
              <button class="add-preset-btn" id="add-preset-btn">+ Save Current</button>
              ` : ''}
            </div>
            <div class="presets-grid" id="presets-grid">
              ${this.renderPresets()}
            </div>
          </div>

          <!-- History -->
          <div class="history-section">
            <div class="presets-title">Recent Colors</div>
            <div class="history-grid" id="history-grid">
              ${this.renderHistory()}
            </div>
          </div>

          <!-- Actions -->
          <div class="picker-actions">
            <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
            <button class="btn btn-primary" id="apply-btn">Apply</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render preset colors
   */
  renderPresets() {
    return this._presets.map((preset, index) => `
      <div class="preset-color ${preset.type || ''} ${preset.value === this._value ? 'active' : ''}" 
           style="background: ${preset.value}"
           data-color="${preset.value}"
           title="${preset.name}">
      </div>
    `).join('');
  }

  /**
   * Render color history
   */
  renderHistory() {
    return this._history.map(color => `
      <div class="history-color" style="background: ${color}" data-color="${color}"></div>
    `).join('');
  }

  /**
   * Attach all event listeners
   */
  attachListeners() {
    // Trigger open/close
    const trigger = this.shadowRoot.getElementById('color-picker-trigger');
    trigger?.addEventListener('click', () => this.togglePicker());

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target) && this._isOpen) {
        this.closePicker();
      }
    });

    // SV Box interaction
    const svBox = this.shadowRoot.getElementById('sv-box');
    let isDraggingSV = false;

    const handleSVMove = (e) => {
      if (!isDraggingSV) return;
      const rect = svBox.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      
      this.updateFromSV(x, y);
      this.updateSVCursor(x, y);
    };

    svBox?.addEventListener('mousedown', (e) => {
      isDraggingSV = true;
      handleSVMove(e);
    });

    document.addEventListener('mousemove', handleSVMove);
    document.addEventListener('mouseup', () => isDraggingSV = false);

    // Hue slider
    const hueSlider = this.shadowRoot.getElementById('hue-slider');
    let isDraggingHue = false;

    const handleHueMove = (e) => {
      if (!isDraggingHue) return;
      const rect = hueSlider.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.updateFromHue(x);
      this.updateHueCursor(x);
    };

    hueSlider?.addEventListener('mousedown', (e) => {
      isDraggingHue = true;
      handleHueMove(e);
    });

    document.addEventListener('mousemove', handleHueMove);
    document.addEventListener('mouseup', () => isDraggingHue = false);

    // Opacity slider
    const opacitySlider = this.shadowRoot.getElementById('opacity-slider');
    if (opacitySlider) {
      let isDraggingOpacity = false;
      
      const handleOpacityMove = (e) => {
        if (!isDraggingOpacity) return;
        const rect = opacitySlider.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._opacity = Math.round(x * 100) / 100;
        this.updateOpacityDisplay();
        this.updateColorPreview();
      };

      opacitySlider.addEventListener('mousedown', (e) => {
        isDraggingOpacity = true;
        handleOpacityMove(e);
      });

      document.addEventListener('mousemove', handleOpacityMove);
      document.addEventListener('mouseup', () => isDraggingOpacity = false);
    }

    // Input mode tabs
    this.shadowRoot.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._inputMode = tab.dataset.mode;
        this.shadowRoot.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.updateInputValue();
      });
    });

    // Color input
    const colorInput = this.shadowRoot.getElementById('color-input');
    colorInput?.addEventListener('change', (e) => {
      this.parseAndSetColor(e.target.value);
    });

    // Eyedropper
    const eyedropperBtn = this.shadowRoot.getElementById('eyedropper-btn');
    eyedropperBtn?.addEventListener('click', async () => {
      try {
        const eyeDropper = new EyeDropper();
        const result = await eyeDropper.open();
        this.setColor(result.sRGBHex);
      } catch (e) {
        console.log('Eyedropper cancelled');
      }
    });

    // Presets
    this.shadowRoot.getElementById('presets-grid')?.addEventListener('click', (e) => {
      const preset = e.target.closest('.preset-color');
      if (preset) {
        this.setColor(preset.dataset.color);
      }
    });

    // History
    this.shadowRoot.getElementById('history-grid')?.addEventListener('click', (e) => {
      const historyItem = e.target.closest('.history-color');
      if (historyItem) {
        this.setColor(historyItem.dataset.color);
      }
    });

    // Add preset
    this.shadowRoot.getElementById('add-preset-btn')?.addEventListener('click', () => {
      this.addToPresets();
    });

    // Actions
    this.shadowRoot.getElementById('cancel-btn')?.addEventListener('click', () => {
      this.closePicker();
    });

    this.shadowRoot.getElementById('apply-btn')?.addEventListener('click', () => {
      this.applyColor();
    });
  }

  /**
   * Toggle picker visibility
   */
  togglePicker() {
    this._isOpen = !this._isOpen;
    const popup = this.shadowRoot.getElementById('picker-popup');
    const arrow = this.shadowRoot.getElementById('dropdown-arrow');
    
    popup?.classList.toggle('open', this._isOpen);
    arrow?.classList.toggle('open', this._isOpen);

    if (this._isOpen) {
      this.updatePickerUI();
    }
  }

  /**
   * Close picker
   */
  closePicker() {
    this._isOpen = false;
    const popup = this.shadowRoot.getElementById('picker-popup');
    const arrow = this.shadowRoot.getElementById('dropdown-arrow');
    
    popup?.classList.remove('open');
    arrow?.classList.remove('open');
  }

  /**
   * Apply selected color
   */
  applyColor() {
    this.addToHistory(this._value);
    this.dispatchEvent(new CustomEvent('change', {
      detail: { 
        value: this._value, 
        opacity: this._opacity,
        rgba: this.getColorWithOpacity()
      },
      bubbles: true,
      composed: true
    }));
    this.closePicker();
  }

  /**
   * Set color value
   */
  setColor(color) {
    this._value = color;
    this.updateColorPreview();
    this.updateInputValue();
    this.updatePickerUI();
  }

  /**
   * Parse and set color from input
   */
  parseAndSetColor(input) {
    // Basic validation - in production, use a color parsing library
    if (input.match(/^#[0-9A-F]{6}$/i)) {
      this.setColor(input.toLowerCase());
    }
  }

  /**
   * Update from Saturation/Value coordinates
   */
  updateFromSV(x, y) {
    const hsl = this.hexToHSL(this._value);
    hsl.s = x * 100;
    hsl.l = (1 - y) * 100;
    this._value = this.hslToHex(hsl);
    this.updateColorPreview();
    this.updateInputValue();
  }

  /**
   * Update from Hue coordinate
   */
  updateFromHue(x) {
    const hsl = this.hexToHSL(this._value);
    hsl.h = x * 360;
    this._value = this.hslToHex(hsl);
    this.updateColorPreview();
    this.updateInputValue();
    this.updateSVBackground();
  }

  /**
   * Update UI elements
   */
  updateColorPreview() {
    const preview = this.shadowRoot.getElementById('color-preview');
    const value = this.shadowRoot.getElementById('color-value');
    if (preview) preview.style.background = this.getColorWithOpacity();
    if (value) value.textContent = this.formatColor();
  }

  updateInputValue() {
    const input = this.shadowRoot.getElementById('color-input');
    if (input) input.value = this.formatColor();
  }

  updateOpacityDisplay() {
    const fill = this.shadowRoot.querySelector('.opacity-fill');
    const cursor = this.shadowRoot.querySelector('.opacity-cursor');
    const label = this.shadowRoot.querySelector('.opacity-label span:last-child');
    
    if (fill) fill.style.width = `${this._opacity * 100}%`;
    if (cursor) cursor.style.left = `${this._opacity * 100}%`;
    if (label) label.textContent = `${Math.round(this._opacity * 100)}%`;
    
    this.updateColorPreview();
  }

  updateSVCursor(x, y) {
    const cursor = this.shadowRoot.getElementById('sv-cursor');
    if (cursor) {
      cursor.style.left = `${x * 100}%`;
      cursor.style.top = `${y * 100}%`;
    }
  }

  updateHueCursor(x) {
    const cursor = this.shadowRoot.getElementById('hue-cursor');
    if (cursor) cursor.style.left = `${x * 100}%`;
  }

  updateSVBackground() {
    const svBox = this.shadowRoot.getElementById('sv-box');
    if (svBox) {
      const hsl = this.hexToHSL(this._value);
      svBox.style.backgroundColor = `hsl(${hsl.h}, 100%, 50%)`;
    }
  }

  updatePickerUI() {
    const hsl = this.hexToHSL(this._value);
    this.updateSVCursor(hsl.s / 100, 1 - (hsl.l / 100));
    this.updateHueCursor(hsl.h / 360);
    this.updateSVBackground();
  }

  /**
   * Format color for display based on input mode
   */
  formatColor() {
    switch (this._inputMode) {
      case 'hex':
        return this._value.toUpperCase();
      case 'rgb':
        const rgb = this.hexToRGB(this._value);
        return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
      case 'hsl':
        const hsl = this.hexToHSL(this._value);
        return `${Math.round(hsl.h)}°, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%`;
      default:
        return this._value;
    }
  }

  /**
   * Get color with opacity for preview
   */
  getColorWithOpacity() {
    if (this._opacity === 1) return this._value;
    const rgb = this.hexToRGB(this._value);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this._opacity})`;
  }

  /**
   * Color conversion utilities
   */
  hexToRGB(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  hexToHSL(hex) {
    const rgb = this.hexToRGB(hex);
    const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  hslToHex({ h, s, l }) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /**
   * History management
   */
  addToHistory(color) {
    this._history = [color, ...this._history.filter(c => c !== color)].slice(0, this.maxHistory);
    this.saveHistory();
    if (this._isOpen) {
      const historyGrid = this.shadowRoot.getElementById('history-grid');
      if (historyGrid) historyGrid.innerHTML = this.renderHistory();
    }
  }

  saveHistory() {
    try {
      localStorage.setItem('color-picker-history', JSON.stringify(this._history));
    } catch (e) {
      console.error('Failed to save color history:', e);
    }
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('color-picker-history');
      if (saved) {
        this._history = JSON.parse(saved);
      }
    } catch (e) {
      this._history = [];
    }
  }

  /**
   * Custom presets management
   */
  addToPresets() {
    if (!this.hasAttribute('allow-custom-presets')) return;
    
    const name = prompt('Name this color preset:');
    if (name) {
      this._presets.push({
        name,
        value: this._value,
        type: 'custom'
      });
      this.render();
      this.attachListeners();
      
      // Save to storage
      this.dispatchEvent(new CustomEvent('save-preset', {
        detail: { presets: this._presets },
        bubbles: true,
        composed: true
      }));
    }
  }

  /**
   * Public API
   */
  get value() {
    return this._value;
  }

  set value(val) {
    this._value = val;
    this.setAttribute('value', val);
    this.updateColorDisplay();
  }

  get opacity() {
    return this._opacity;
  }

  set opacity(val) {
    this._opacity = val;
    this.setAttribute('opacity', val);
    this.updateOpacityDisplay();
  }
}

// Register custom element
customElements.define('color-picker', ColorPicker);

export default ColorPicker;