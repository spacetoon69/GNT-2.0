// ui/options/components/setting-card.js

/**
 * SettingCard Component
 * Reusable, accessible setting card with multiple input types and states
 * Supports: toggle, slider, select, text, number, color, keybind, file
 */

class SettingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._value = null;
    this._disabled = false;
    this._loading = false;
  }

  static get observedAttributes() {
    return [
      'type',           // toggle | slider | select | text | number | color | keybind | file | button
      'label',
      'description',
      'icon',
      'value',
      'disabled',
      'loading',
      'min',            // slider/number
      'max',            // slider/number
      'step',           // slider/number
      'unit',           // slider display suffix
      'options',        // select: JSON array
      'placeholder',    // text/number
      'accept',         // file: mime types
      'variant',        // default | compact | prominent | danger
      'require-restart', // boolean
      'beta',           // boolean - show beta badge
      'premium'         // boolean - show premium badge
    ];
  }

  connectedCallback() {
    this.render();
    this.attachListeners();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    
    if (name === 'value') {
      this._value = this.parseValue(newValue);
      this.updateInputValue();
    } else if (name === 'disabled') {
      this._disabled = newValue !== null;
      this.updateDisabledState();
    } else if (name === 'loading') {
      this._loading = newValue !== null;
      this.updateLoadingState();
    } else {
      this.render();
    }
  }

  /**
   * Parse value based on type
   */
  parseValue(value) {
    const type = this.getAttribute('type');
    if (type === 'toggle') return value === 'true' || value === true;
    if (type === 'number' || type === 'slider') return parseFloat(value);
    if (type === 'select') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  /**
   * Render the complete component
   */
  render() {
    const type = this.getAttribute('type') || 'text';
    const variant = this.getAttribute('variant') || 'default';
    const label = this.getAttribute('label') || 'Setting';
    const description = this.getAttribute('description') || '';
    const icon = this.getAttribute('icon') || '';
    const requireRestart = this.hasAttribute('require-restart');
    const isBeta = this.hasAttribute('beta');
    const isPremium = this.hasAttribute('premium');

    const badges = [
      isBeta ? '<span class="badge beta">BETA</span>' : '',
      isPremium ? '<span class="badge premium">PREMIUM</span>' : '',
      requireRestart ? '<span class="badge restart">↻ Requires Restart</span>' : ''
    ].join('');

    const iconHtml = icon ? `<span class="setting-icon">${icon}</span>` : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          --card-bg: var(--surface-1, #1a1a1a);
          --card-border: var(--border-subtle, #333);
          --card-radius: 12px;
          --card-padding: 20px;
          --text-primary: var(--text-1, #fff);
          --text-secondary: var(--text-2, #888);
          --accent-color: var(--primary, #ff4757);
          --accent-glow: var(--primary-glow, rgba(255, 71, 87, 0.3));
          --danger-color: #ff3344;
          --success-color: #2ed573;
          --warning-color: #ffa502;
          --beta-color: #8e44ad;
          --premium-color: #f1c40f;
          
          --toggle-bg: #2d2d2d;
          --toggle-active: var(--accent-color);
          --slider-track: #2d2d2d;
          --slider-fill: var(--accent-color);
          --input-bg: #0f0f0f;
          --input-border: #333;
          --input-focus: var(--accent-color);
          
          --transition-fast: 0.15s ease;
          --transition-medium: 0.3s ease;
        }

        :host([variant="compact"]) {
          --card-padding: 12px 16px;
        }

        :host([variant="prominent"]) {
          --card-bg: var(--surface-2, #252525);
          --card-border: var(--border-prominent, #444);
        }

        :host([variant="danger"]) {
          --accent-color: var(--danger-color);
          --accent-glow: rgba(255, 51, 68, 0.3);
        }

        .card {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: var(--card-radius);
          padding: var(--card-padding);
          display: flex;
          align-items: center;
          gap: 16px;
          transition: all var(--transition-medium);
          position: relative;
          overflow: hidden;
        }

        .card:hover {
          border-color: var(--accent-color);
          box-shadow: 0 0 20px var(--accent-glow);
          transform: translateY(-1px);
        }

        .card.disabled {
          opacity: 0.5;
          pointer-events: none;
          filter: grayscale(0.5);
        }

        .card.loading::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(2px);
        }

        .content {
          flex: 1;
          min-width: 0;
        }

        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }

        .setting-icon {
          font-size: 20px;
          filter: drop-shadow(0 0 4px var(--accent-glow));
        }

        .label {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .badges {
          display: flex;
          gap: 6px;
        }

        .badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .badge.beta {
          background: var(--beta-color);
          color: white;
        }

        .badge.premium {
          background: var(--premium-color);
          color: #000;
        }

        .badge.restart {
          background: var(--warning-color);
          color: #000;
        }

        .description {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
        }

        .control {
          flex-shrink: 0;
          min-width: 120px;
        }

        /* Toggle Switch */
        .toggle {
          position: relative;
          width: 52px;
          height: 28px;
          background: var(--toggle-bg);
          border-radius: 14px;
          cursor: pointer;
          transition: background var(--transition-fast);
          border: 2px solid transparent;
        }

        .toggle.active {
          background: var(--toggle-active);
          box-shadow: 0 0 10px var(--accent-glow);
        }

        .toggle-knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform var(--transition-fast);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        .toggle.active .toggle-knob {
          transform: translateX(24px);
        }

        .toggle:focus-visible {
          outline: none;
          border-color: var(--accent-color);
        }

        /* Slider */
        .slider-container {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .slider {
          -webkit-appearance: none;
          width: 140px;
          height: 6px;
          background: var(--slider-track);
          border-radius: 3px;
          outline: none;
        }

        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          background: var(--slider-fill);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px var(--accent-glow);
          transition: transform var(--transition-fast);
        }

        .slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        .slider-value {
          font-size: 14px;
          font-weight: 600;
          color: var(--accent-color);
          min-width: 50px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        /* Select */
        select {
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          padding: 8px 32px 8px 12px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          min-width: 160px;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }

        select:focus {
          outline: none;
          border-color: var(--input-focus);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }

        /* Text/Number Input */
        .input {
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 14px;
          width: 160px;
          transition: all var(--transition-fast);
        }

        .input:focus {
          outline: none;
          border-color: var(--input-focus);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }

        input[type="number"] {
          width: 100px;
        }

        input[type="color"] {
          width: 50px;
          height: 36px;
          padding: 2px;
          border-radius: 6px;
          cursor: pointer;
        }

        /* Keybind */
        .keybind {
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-family: monospace;
          cursor: pointer;
          min-width: 120px;
          text-align: center;
          user-select: none;
          transition: all var(--transition-fast);
        }

        .keybind:hover {
          border-color: var(--accent-color);
        }

        .keybind.recording {
          background: var(--accent-color);
          color: white;
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        /* File Input */
        .file-input {
          position: relative;
          overflow: hidden;
        }

        .file-input input[type="file"] {
          position: absolute;
          opacity: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
        }

        .file-button {
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .file-button:hover {
          border-color: var(--accent-color);
        }

        .file-name {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Button */
        .action-button {
          background: var(--accent-color);
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .action-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px var(--accent-glow);
        }

        .action-button:active {
          transform: translateY(0);
        }

        /* Compact variant adjustments */
        :host([variant="compact"]) .description {
          display: none;
        }

        :host([variant="compact"]) .card {
          gap: 12px;
        }

        /* Loading spinner */
        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--text-secondary);
          border-top-color: var(--accent-color);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Danger variant */
        :host([variant="danger"]) .card:hover {
          border-color: var(--danger-color);
          box-shadow: 0 0 20px rgba(255, 51, 68, 0.2);
        }

        /* Sharingan theme integration */
        :host([theme-active="true"]) .toggle.active {
          background: #ff4757;
          box-shadow: 0 0 15px rgba(255, 71, 87, 0.6);
        }

        :host([theme-active="true"]) .toggle.active .toggle-knob {
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
        }
      </style>

      <div class="card ${this._disabled ? 'disabled' : ''} ${this._loading ? 'loading' : ''}" part="card">
        <div class="content">
          <div class="header">
            ${iconHtml}
            <span class="label">${label}</span>
            <div class="badges">${badges}</div>
          </div>
          ${description ? `<p class="description">${description}</p>` : ''}
        </div>
        <div class="control" part="control">
          ${this.renderControl(type)}
        </div>
        ${this._loading ? '<div class="spinner"></div>' : ''}
      </div>
    `;
  }

  /**
   * Render the appropriate control based on type
   */
  renderControl(type) {
    const value = this._value;
    const placeholder = this.getAttribute('placeholder') || '';
    const min = this.getAttribute('min') || '0';
    const max = this.getAttribute('max') || '100';
    const step = this.getAttribute('step') || '1';
    const unit = this.getAttribute('unit') || '';

    switch (type) {
      case 'toggle':
        const isActive = value === true || value === 'true';
        return `
          <div class="toggle ${isActive ? 'active' : ''}" role="switch" aria-checked="${isActive}" tabindex="0" part="toggle">
            <div class="toggle-knob"></div>
          </div>
        `;

      case 'slider':
        const sliderValue = value !== null ? value : (parseInt(min) + parseInt(max)) / 2;
        return `
          <div class="slider-container">
            <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${sliderValue}" part="slider">
            <span class="slider-value">${sliderValue}${unit}</span>
          </div>
        `;

      case 'select':
        let options = [];
        try {
          options = JSON.parse(this.getAttribute('options') || '[]');
        } catch (e) {
          console.error('Invalid options JSON:', e);
        }
        const optionsHtml = options.map(opt => 
          `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
        ).join('');
        return `
          <select part="select">${optionsHtml}</select>
        `;

      case 'text':
        return `<input type="text" class="input" value="${value || ''}" placeholder="${placeholder}" part="input">`;

      case 'number':
        return `<input type="number" class="input" value="${value || ''}" min="${min}" max="${max}" step="${step}" placeholder="${placeholder}" part="input">`;

      case 'color':
        return `<input type="color" class="input" value="${value || '#ff4757'}" part="color-input">`;

      case 'keybind':
        const keybindValue = value || 'Click to set...';
        return `<div class="keybind" tabindex="0" part="keybind">${keybindValue}</div>`;

      case 'file':
        const accept = this.getAttribute('accept') || '*/*';
        const fileName = value ? value.name : 'No file chosen';
        return `
          <div class="file-input">
            <input type="file" accept="${accept}" part="file-input">
            <div class="file-button">
              <span>📁</span>
              <span>Choose File</span>
            </div>
            <div class="file-name">${fileName}</div>
          </div>
        `;

      case 'button':
        const buttonText = this.getAttribute('label') || 'Action';
        return `<button class="action-button" part="button">${buttonText}</button>`;

      default:
        return `<span>Unknown type: ${type}</span>`;
    }
  }

  /**
   * Attach event listeners to controls
   */
  attachListeners() {
    const type = this.getAttribute('type');
    const card = this.shadowRoot.querySelector('.card');
    
    if (this._disabled || this._loading) return;

    switch (type) {
      case 'toggle':
        const toggle = this.shadowRoot.querySelector('.toggle');
        toggle?.addEventListener('click', () => this.handleToggle());
        toggle?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.handleToggle();
          }
        });
        break;

      case 'slider':
        const slider = this.shadowRoot.querySelector('.slider');
        const valueDisplay = this.shadowRoot.querySelector('.slider-value');
        slider?.addEventListener('input', (e) => {
          const unit = this.getAttribute('unit') || '';
          valueDisplay.textContent = `${e.target.value}${unit}`;
        });
        slider?.addEventListener('change', (e) => {
          this.handleValueChange(parseFloat(e.target.value));
        });
        break;

      case 'select':
        const select = this.shadowRoot.querySelector('select');
        select?.addEventListener('change', (e) => {
          this.handleValueChange(e.target.value);
        });
        break;

      case 'text':
      case 'number':
        const input = this.shadowRoot.querySelector('input');
        let debounceTimer;
        input?.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const val = type === 'number' ? parseFloat(e.target.value) : e.target.value;
            this.handleValueChange(val);
          }, 300);
        });
        break;

      case 'color':
        const colorInput = this.shadowRoot.querySelector('input[type="color"]');
        colorInput?.addEventListener('change', (e) => {
          this.handleValueChange(e.target.value);
        });
        break;

      case 'keybind':
        const keybind = this.shadowRoot.querySelector('.keybind');
        keybind?.addEventListener('click', () => this.startKeybindRecording());
        keybind?.addEventListener('keydown', (e) => {
          if (keybind.classList.contains('recording')) {
            e.preventDefault();
            this.handleKeybindRecord(e);
          }
        });
        // Prevent scrolling with space when recording
        keybind?.addEventListener('keydown', (e) => {
          if (e.key === ' ' && keybind.classList.contains('recording')) {
            e.preventDefault();
          }
        });
        break;

      case 'file':
        const fileInput = this.shadowRoot.querySelector('input[type="file"]');
        fileInput?.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            this.handleValueChange(file);
            // Update filename display
            const fileNameEl = this.shadowRoot.querySelector('.file-name');
            if (fileNameEl) fileNameEl.textContent = file.name;
          }
        });
        break;

      case 'button':
        const button = this.shadowRoot.querySelector('.action-button');
        button?.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('action', { 
            bubbles: true, 
            composed: true 
          }));
        });
        break;
    }
  }

  /**
   * Handle toggle switch
   */
  handleToggle() {
    const newValue = !this._value;
    this._value = newValue;
    
    const toggle = this.shadowRoot.querySelector('.toggle');
    toggle.classList.toggle('active', newValue);
    toggle.setAttribute('aria-checked', newValue);
    
    this.handleValueChange(newValue);
  }

  /**
   * Start recording keyboard shortcut
   */
  startKeybindRecording() {
    const keybind = this.shadowRoot.querySelector('.keybind');
    keybind.classList.add('recording');
    keybind.textContent = 'Press keys...';
    
    // Cancel on blur or escape
    const cancelRecording = () => {
      keybind.classList.remove('recording');
      keybind.textContent = this._value || 'Click to set...';
      keybind.blur();
    };
    
    keybind.addEventListener('blur', cancelRecording, { once: true });
    
    // Handle escape
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        cancelRecording();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Handle keybind recording
   */
  handleKeybindRecord(e) {
    e.preventDefault();
    
    // Build key combo string
    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Meta');
    
    // Don't record modifier keys alone
    if (!['Control', 'Alt', 'Shift', 'Meta', 'Escape'].includes(e.key)) {
      keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
      const combo = keys.join('+');
      
      const keybind = this.shadowRoot.querySelector('.keybind');
      keybind.classList.remove('recording');
      keybind.textContent = combo;
      
      this.handleValueChange(combo);
    }
  }

  /**
   * Dispatch value change event
   */
  handleValueChange(value) {
    this._value = value;
    this.setAttribute('value', typeof value === 'object' ? JSON.stringify(value) : value);
    
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value, id: this.getAttribute('id') },
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Update input value without re-rendering
   */
  updateInputValue() {
    const type = this.getAttribute('type');
    
    switch (type) {
      case 'toggle':
        const toggle = this.shadowRoot.querySelector('.toggle');
        if (toggle) {
          toggle.classList.toggle('active', this._value);
          toggle.setAttribute('aria-checked', this._value);
        }
        break;
        
      case 'slider':
        const slider = this.shadowRoot.querySelector('.slider');
        const valueDisplay = this.shadowRoot.querySelector('.slider-value');
        if (slider) slider.value = this._value;
        if (valueDisplay) {
          const unit = this.getAttribute('unit') || '';
          valueDisplay.textContent = `${this._value}${unit}`;
        }
        break;
        
      case 'select':
        const select = this.shadowRoot.querySelector('select');
        if (select) select.value = this._value;
        break;
        
      case 'text':
      case 'number':
      case 'color':
        const input = this.shadowRoot.querySelector('input');
        if (input) input.value = this._value;
        break;
        
      case 'keybind':
        const keybind = this.shadowRoot.querySelector('.keybind');
        if (keybind && !keybind.classList.contains('recording')) {
          keybind.textContent = this._value || 'Click to set...';
        }
        break;
    }
  }

  /**
   * Update disabled state
   */
  updateDisabledState() {
    const card = this.shadowRoot.querySelector('.card');
    if (card) {
      card.classList.toggle('disabled', this._disabled);
    }
  }

  /**
   * Update loading state
   */
  updateLoadingState() {
    const card = this.shadowRoot.querySelector('.card');
    if (card) {
      card.classList.toggle('loading', this._loading);
    }
  }

  /**
   * Public API: Get current value
   */
  get value() {
    return this._value;
  }

  /**
   * Public API: Set value programmatically
   */
  set value(val) {
    this._value = this.parseValue(val);
    this.setAttribute('value', typeof val === 'object' ? JSON.stringify(val) : val);
    this.updateInputValue();
  }

  /**
   * Public API: Set loading state
   */
  set loading(isLoading) {
    this._loading = isLoading;
    if (isLoading) {
      this.setAttribute('loading', '');
    } else {
      this.removeAttribute('loading');
    }
  }

  /**
   * Public API: Set disabled state
   */
  set disabled(isDisabled) {
    this._disabled = isDisabled;
    if (isDisabled) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }
}

// Register the custom element
customElements.define('setting-card', SettingCard);

export default SettingCard;