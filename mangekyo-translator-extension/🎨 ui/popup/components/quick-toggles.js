/**
 * quick-toggles.js
 * 
 * Quick access toggle switches for core Mangekyo Reader features.
 * Designed with EMS (Eternal Mangekyo Sharingan) aesthetic - smooth, powerful, immediate.
 */

class QuickToggles extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.toggles = new Map();
    this.state = {
      autoTranslate: false,
      ocrEnabled: true,
      bubbleOverlay: true,
      soundEffects: false,
      privacyMode: false,
      desktopCapture: false
    };
    
    this.render();
    this.initializeStorage();
  }

  static TOGGLE_CONFIG = [
    {
      id: 'autoTranslate',
      label: 'Auto-Translate',
      description: 'Instant translation on page load',
      icon: 'sharingan',
      color: '#DC143C',
      requires: ['ocrEnabled']
    },
    {
      id: 'ocrEnabled',
      label: 'OCR Engine',
      description: 'Text recognition from images',
      icon: 'eye',
      color: '#8B0000',
      isMaster: true
    },
    {
      id: 'bubbleOverlay',
      label: 'Bubble Overlay',
      description: 'Replace original text bubbles',
      icon: 'bubble',
      color: '#FF4500',
      requires: ['ocrEnabled']
    },
    {
      id: 'soundEffects',
      label: 'SFX Audio',
      description: 'Activation sounds & feedback',
      icon: 'sound',
      color: '#FFD700',
      premium: true
    },
    {
      id: 'privacyMode',
      label: 'Privacy Mode',
      description: 'No cloud API calls, local only',
      icon: 'shield',
      color: '#4a5568',
      warning: 'Limited translation quality'
    },
    {
      id: 'desktopCapture',
      label: 'Desktop Capture',
      description: 'Translate outside browser',
      icon: 'monitor',
      color: '#6b46c1',
      requiresPermission: 'desktopCapture',
      experimental: true
    }
  ];

  render() {
    const styles = `
      :host {
        display: block;
        font-family: 'Segoe UI', system-ui, sans-serif;
        --toggle-height: 44px;
        --transition-speed: 0.3s;
      }

      .toggles-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: linear-gradient(180deg, rgba(20, 20, 20, 0.95), rgba(10, 10, 10, 0.98));
        border-radius: 12px;
        border: 1px solid rgba(139, 0, 0, 0.2);
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(139, 0, 0, 0.3);
      }

      .section-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #DC143C;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .section-title::before {
        content: '◈';
        color: #8B0000;
      }

      .master-switch {
        font-size: 10px;
        padding: 4px 8px;
        background: rgba(139, 0, 0, 0.2);
        border: 1px solid rgba(220, 20, 60, 0.4);
        color: #DC143C;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .master-switch:hover {
        background: rgba(220, 20, 60, 0.3);
      }

      .toggle-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 8px;
        border: 1px solid transparent;
        transition: all var(--transition-speed) ease;
        cursor: pointer;
        position: relative;
        overflow: hidden;
      }

      .toggle-item:hover {
        background: rgba(139, 0, 0, 0.08);
        border-color: rgba(139, 0, 0, 0.3);
        transform: translateX(2px);
      }

      .toggle-item.active {
        background: linear-gradient(90deg, rgba(139, 0, 0, 0.15), transparent);
        border-left: 3px solid var(--toggle-color, #DC143C);
      }

      .toggle-item.disabled {
        opacity: 0.4;
        pointer-events: none;
        filter: grayscale(0.8);
      }

      .toggle-item.experimental::after {
        content: 'BETA';
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 8px;
        padding: 2px 4px;
        background: rgba(107, 70, 193, 0.8);
        color: white;
        border-radius: 3px;
        font-weight: 700;
      }

      .icon-wrapper {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: all var(--transition-speed);
        flex-shrink: 0;
      }

      .toggle-item.active .icon-wrapper {
        background: var(--toggle-color, #DC143C);
        box-shadow: 0 0 15px var(--toggle-color, rgba(220, 20, 60, 0.5));
        border-color: transparent;
      }

      .icon {
        width: 16px;
        height: 16px;
        fill: currentColor;
        color: #888;
        transition: all var(--transition-speed);
      }

      .toggle-item.active .icon {
        color: white;
        filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.8));
      }

      /* Sharingan icon animation when active */
      .icon-sharingan {
        animation: none;
      }

      .toggle-item.active .icon-sharingan {
        animation: sharinganSpin 4s linear infinite;
      }

      @keyframes sharinganSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .toggle-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .toggle-label {
        font-size: 13px;
        font-weight: 600;
        color: #e0e0e0;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .toggle-item.active .toggle-label {
        color: white;
        text-shadow: 0 0 10px var(--toggle-color, rgba(220, 20, 60, 0.5));
      }

      .premium-badge {
        font-size: 8px;
        padding: 2px 4px;
        background: linear-gradient(135deg, #FFD700, #FFA500);
        color: #000;
        border-radius: 3px;
        font-weight: 800;
      }

      .toggle-description {
        font-size: 11px;
        color: #666;
        line-height: 1.3;
      }

      .toggle-item.active .toggle-description {
        color: #aaa;
      }

      .warning-text {
        font-size: 10px;
        color: #ff6b6b;
        margin-top: 2px;
        display: none;
      }

      .toggle-item.active .warning-text {
        display: block;
      }

      /* EMS Switch */
      .ems-switch {
        position: relative;
        width: 48px;
        height: 24px;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        cursor: pointer;
        transition: all var(--transition-speed);
        flex-shrink: 0;
      }

      .ems-switch::before {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, #666, #333);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        transition: all var(--transition-speed);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .ems-switch.active {
        background: linear-gradient(90deg, rgba(139, 0, 0, 0.6), rgba(220, 20, 60, 0.8));
        border-color: rgba(220, 20, 60, 0.5);
        box-shadow: 0 0 20px rgba(220, 20, 60, 0.3);
      }

      .ems-switch.active::before {
        transform: translateX(24px);
        background: radial-gradient(circle at 30% 30%, #ff4444, #8B0000);
        box-shadow: 
          0 0 10px rgba(220, 20, 60, 0.8),
          0 0 20px rgba(220, 20, 60, 0.4);
        border-color: rgba(255, 255, 255, 0.3);
      }

      /* Ripple effect on toggle */
      .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(220, 20, 60, 0.4);
        transform: scale(0);
        animation: rippleEffect 0.6s ease-out;
        pointer-events: none;
      }

      @keyframes rippleEffect {
        to {
          transform: scale(4);
          opacity: 0;
        }
      }

      .shortcut-hint {
        font-size: 10px;
        color: #555;
        background: rgba(0, 0, 0, 0.3);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
        margin-left: auto;
      }

      .divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(139, 0, 0, 0.3), transparent);
        margin: 8px 0;
      }

      .batch-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .batch-btn {
        flex: 1;
        padding: 8px;
        background: rgba(139, 0, 0, 0.2);
        border: 1px solid rgba(139, 0, 0, 0.4);
        color: #DC143C;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: 600;
      }

      .batch-btn:hover {
        background: rgba(220, 20, 60, 0.3);
        transform: translateY(-1px);
      }

      .batch-btn:active {
        transform: translateY(0);
      }
    `;

    const html = `
      <div class="toggles-container">
        <div class="section-header">
          <div class="section-title">Quick Controls</div>
          <button class="master-switch" id="resetDefaults">Reset</button>
        </div>
        
        <div id="togglesList">
          ${QuickToggles.TOGGLE_CONFIG.map(config => this.createToggleHTML(config)).join('')}
        </div>
        
        <div class="divider"></div>
        
        <div class="batch-actions">
          <button class="batch-btn" id="enableAll">Enable All</button>
          <button class="batch-btn" id="disableAll">Disable All</button>
        </div>
      </div>
    `;

    this.shadowRoot.innerHTML = `<style>${styles}</style>${html}`;
    this.attachEventListeners();
  }

  createToggleHTML(config) {
    const isActive = this.state[config.id];
    const isDisabled = this.checkDependencies(config);
    
    return `
      <div class="toggle-item ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''} ${config.experimental ? 'experimental' : ''}" 
           data-id="${config.id}"
           style="--toggle-color: ${config.color}"
           title="${config.warning || ''}">
        
        <div class="icon-wrapper">
          ${this.getIconSVG(config.icon)}
        </div>
        
        <div class="toggle-content">
          <div class="toggle-label">
            ${config.label}
            ${config.premium ? '<span class="premium-badge">PRO</span>' : ''}
          </div>
          <div class="toggle-description">${config.description}</div>
          ${config.warning ? `<div class="warning-text">⚠ ${config.warning}</div>` : ''}
        </div>
        
        <div class="ems-switch ${isActive ? 'active' : ''}" data-toggle="${config.id}"></div>
      </div>
    `;
  }

  getIconSVG(type) {
    const icons = {
      sharingan: `<svg class="icon icon-sharingan" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2 L14 8 L12 6 L10 8 Z" fill="currentColor" transform="rotate(0 12 12)"/><path d="M12 2 L14 8 L12 6 L10 8 Z" fill="currentColor" transform="rotate(120 12 12)"/><path d="M12 2 L14 8 L12 6 L10 8 Z" fill="currentColor" transform="rotate(240 12 12)"/></svg>`,
      eye: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>`,
      bubble: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/></svg>`,
      sound: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/></svg>`,
      shield: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="currentColor"/></svg>`,
      monitor: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z" fill="currentColor"/></svg>`
    };
    return icons[type] || icons.eye;
  }

  attachEventListeners() {
    const container = this.shadowRoot.getElementById('togglesList');
    
    // Individual toggle clicks
    container.addEventListener('click', (e) => {
      const toggleItem = e.target.closest('.toggle-item');
      const switchEl = e.target.closest('.ems-switch');
      
      if (switchEl) {
        e.stopPropagation();
        this.handleToggle(switchEl.dataset.toggle);
        this.createRipple(e, switchEl);
      } else if (toggleItem && !toggleItem.classList.contains('disabled')) {
        const toggleId = toggleItem.dataset.id;
        this.handleToggle(toggleId);
      }
    });

    // Batch actions
    this.shadowRoot.getElementById('enableAll').addEventListener('click', () => {
      this.batchToggle(true);
    });
    
    this.shadowRoot.getElementById('disableAll').addEventListener('click', () => {
      this.batchToggle(false);
    });
    
    this.shadowRoot.getElementById('resetDefaults').addEventListener('click', () => {
      this.resetToDefaults();
    });
  }

  createRipple(e, element) {
    const rect = element.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top = (e.clientY - rect.top) + 'px';
    element.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  checkDependencies(config) {
    if (!config.requires) return false;
    return config.requires.some(dep => !this.state[dep]);
  }

  async handleToggle(id) {
    const config = QuickToggles.TOGGLE_CONFIG.find(c => c.id === id);
    if (!config) return;

    // Check permissions if required
    if (config.requiresPermission) {
      const hasPermission = await this.requestPermission(config.requiresPermission);
      if (!hasPermission) return;
    }

    // Toggle state
    this.state[id] = !this.state[id];
    
    // Handle master toggle logic
    if (config.isMaster && !this.state[id]) {
      // Disable dependents
      QuickToggles.TOGGLE_CONFIG.forEach(c => {
        if (c.requires?.includes(id)) {
          this.state[c.id] = false;
        }
      });
    }

    await this.saveState();
    this.updateUI();
    
    // Notify background script
    this.broadcastChange(id, this.state[id]);
    
    // Dispatch event
    this.dispatchEvent(new CustomEvent('togglechange', {
      detail: { id, state: this.state[id], allStates: { ...this.state } }
    }));
  }

  async requestPermission(permission) {
    try {
      if (typeof chrome !== 'undefined' && chrome.permissions) {
        return await chrome.permissions.request({ permissions: [permission] });
      }
      return true;
    } catch (e) {
      console.error('Permission denied:', e);
      return false;
    }
  }

  batchToggle(enable) {
    QuickToggles.TOGGLE_CONFIG.forEach(config => {
      if (!config.experimental) {
        this.state[config.id] = enable;
      }
    });
    this.saveState();
    this.updateUI();
    
    this.dispatchEvent(new CustomEvent('batchtoggle', {
      detail: { enabled: enable }
    }));
  }

  resetToDefaults() {
    this.state = {
      autoTranslate: false,
      ocrEnabled: true,
      bubbleOverlay: true,
      soundEffects: false,
      privacyMode: false,
      desktopCapture: false
    };
    this.saveState();
    this.updateUI();
  }

  updateUI() {
    const container = this.shadowRoot.getElementById('togglesList');
    container.innerHTML = QuickToggles.TOGGLE_CONFIG.map(config => 
      this.createToggleHTML(config)
    ).join('');
  }

  async initializeStorage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('quickToggles');
        if (result.quickToggles) {
          this.state = { ...this.state, ...result.quickToggles };
          this.updateUI();
        }
      }
    } catch (e) {
      console.log('Storage not available, using defaults');
    }
  }

  async saveState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ quickToggles: this.state });
      }
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }

  broadcastChange(id, value) {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'TOGGLE_CHANGE',
        payload: { id, value, timestamp: Date.now() }
      });
    }
  }

  // Public API
  getState() {
    return { ...this.state };
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.saveState();
    this.updateUI();
  }

  enable(id) {
    if (this.state.hasOwnProperty(id)) {
      this.state[id] = true;
      this.handleToggle(id);
    }
  }

  disable(id) {
    if (this.state.hasOwnProperty(id)) {
      this.state[id] = false;
      this.handleToggle(id);
    }
  }
}

// Register custom element
customElements.define('quick-toggles', QuickToggles);

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuickToggles;
}