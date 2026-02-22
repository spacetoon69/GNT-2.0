/**
 * status-indicator.js
 * 
 * Real-time connection and operational status indicator for Mangekyo Reader.
 * Displays service worker health, API connectivity, and processing state.
 * Themed with Sharingan visual states (dormant → active).
 */

class StatusIndicator extends HTMLElement {
  static get observedAttributes() {
    return ['status', 'message', 'progress'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.currentStatus = 'idle';
    this.checkInterval = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    
    this.render();
    this.initializeEventListeners();
  }

  // Status definitions with Sharingan-themed states
  static STATUS_CONFIG = {
    idle: {
      icon: 'tomoe',
      color: '#8B0000', // Deep red
      glowColor: 'rgba(139, 0, 0, 0.4)',
      animation: 'pulse',
      label: 'Ready',
      description: 'Waiting for manga page...'
    },
    scanning: {
      icon: 'sharingan-spinning',
      color: '#DC143C', // Crimson
      glowColor: 'rgba(220, 20, 60, 0.6)',
      animation: 'spin-fast',
      label: 'Scanning',
      description: 'Detecting text regions...'
    },
    processing: {
      icon: 'ems-activating',
      color: '#FF4500', // Orange-red
      glowColor: 'rgba(255, 69, 0, 0.8)',
      animation: 'intensify',
      label: 'Processing',
      description: 'OCR & Translation in progress...'
    },
    active: {
      icon: 'ems-active',
      color: '#FFD700', // Gold
      glowColor: 'rgba(255, 215, 0, 0.9)',
      animation: 'susanoo-aura',
      label: 'Active',
      description: 'Translation overlay active'
    },
    error: {
      icon: 'tomoe-damaged',
      color: '#4a0000', // Dark blood red
      glowColor: 'rgba(74, 0, 0, 0.5)',
      animation: 'glitch',
      label: 'Error',
      description: 'Connection failed'
    },
    offline: {
      icon: 'tomoe-dim',
      color: '#555555',
      glowColor: 'rgba(0, 0, 0, 0.2)',
      animation: 'none',
      label: 'Offline',
      description: 'Extension disabled'
    }
  };

  render() {
    const styles = `
      :host {
        display: block;
        font-family: 'Segoe UI', system-ui, sans-serif;
        --indicator-size: 48px;
        --transition-speed: 0.3s;
      }

      .status-container {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: linear-gradient(135deg, rgba(20, 20, 20, 0.95), rgba(10, 10, 10, 0.98));
        border-radius: 12px;
        border: 1px solid rgba(139, 0, 0, 0.3);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        transition: all var(--transition-speed) ease;
      }

      .status-container:hover {
        border-color: rgba(220, 20, 60, 0.5);
        box-shadow: 0 6px 30px rgba(139, 0, 0, 0.2);
      }

      .icon-wrapper {
        position: relative;
        width: var(--indicator-size);
        height: var(--indicator-size);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .sharingan-icon {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        position: relative;
        background: radial-gradient(circle at 30% 30%, #ff4444, #8B0000);
        box-shadow: 
          0 0 20px var(--glow-color, rgba(139, 0, 0, 0.4)),
          inset 0 0 10px rgba(0, 0, 0, 0.5);
        transition: all var(--transition-speed) ease;
      }

      /* Tomoe design (3 comma shapes) */
      .sharingan-icon.tomoe::before,
      .sharingan-icon.tomoe::after {
        content: '';
        position: absolute;
        width: 35%;
        height: 35%;
        background: #000;
        border-radius: 50% 0 50% 50%;
        transform-origin: 100% 100%;
      }

      .sharingan-icon.tomoe::before {
        top: 15%;
        left: 50%;
        transform: translateX(-50%) rotate(0deg);
        box-shadow: 
          -12px 20px 0 -2px #000,
          12px 20px 0 -2px #000;
      }

      /* EMS Design (straight tomoe/Madara pattern) */
      .sharingan-icon.ems::before {
        content: '';
        position: absolute;
        width: 80%;
        height: 80%;
        border: 3px solid #000;
        border-radius: 50%;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: 
          linear-gradient(0deg, transparent 45%, #000 45%, #000 55%, transparent 55%),
          linear-gradient(60deg, transparent 45%, #000 45%, #000 55%, transparent 55%),
          linear-gradient(120deg, transparent 45%, #000 45%, #000 55%, transparent 55%);
      }

      .sharingan-icon.spinning {
        animation: spin 1s linear infinite;
      }

      .sharingan-icon.intensifying {
        animation: intensify 0.5s ease-in-out infinite alternate;
      }

      .sharingan-icon.glitch {
        animation: glitch 0.3s ease-in-out infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes intensify {
        0% { 
          transform: scale(1);
          filter: brightness(1);
        }
        100% { 
          transform: scale(1.1);
          filter: brightness(1.3) saturate(1.5);
        }
      }

      @keyframes glitch {
        0%, 100% { transform: translate(0); }
        20% { transform: translate(-2px, 2px); }
        40% { transform: translate(-2px, -2px); }
        60% { transform: translate(2px, 2px); }
        80% { transform: translate(2px, -2px); }
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .pulse-ring {
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        border: 2px solid var(--glow-color, rgba(139, 0, 0, 0.4));
        animation: pulse-ring 2s ease-out infinite;
        opacity: 0;
      }

      @keyframes pulse-ring {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(1.5); opacity: 0; }
      }

      .status-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .status-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--status-color, #DC143C);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .status-label::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        animation: pulse 2s ease-in-out infinite;
      }

      .status-description {
        font-size: 12px;
        color: #888;
        line-height: 1.4;
      }

      .progress-bar {
        width: 100%;
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        margin-top: 8px;
        overflow: hidden;
        display: none;
      }

      .progress-bar.active {
        display: block;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #8B0000, #DC143C, #FFD700);
        width: 0%;
        transition: width 0.3s ease;
        box-shadow: 0 0 10px rgba(220, 20, 60, 0.5);
      }

      .retry-button {
        background: transparent;
        border: 1px solid #DC143C;
        color: #DC143C;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        margin-top: 6px;
        display: none;
      }

      .retry-button:hover {
        background: rgba(220, 20, 60, 0.2);
      }

      .retry-button.visible {
        display: inline-block;
      }

      .connection-details {
        font-size: 10px;
        color: #555;
        margin-top: 4px;
        font-family: monospace;
      }

      /* Tooltip */
      .tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
        background: rgba(0, 0, 0, 0.9);
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
        border: 1px solid rgba(139, 0, 0, 0.5);
        z-index: 1000;
      }

      .icon-wrapper:hover .tooltip {
        opacity: 1;
      }

      /* Error state specific */
      .error-log {
        max-height: 60px;
        overflow-y: auto;
        font-size: 10px;
        color: #ff6666;
        background: rgba(74, 0, 0, 0.3);
        padding: 4px 6px;
        border-radius: 4px;
        margin-top: 6px;
        display: none;
        font-family: monospace;
      }

      .error-log.visible {
        display: block;
      }
    `;

    const html = `
      <div class="status-container" id="container">
        <div class="icon-wrapper">
          <div class="pulse-ring" id="pulse"></div>
          <div class="sharingan-icon tomoe" id="icon"></div>
          <div class="tooltip" id="tooltip">Click for details</div>
        </div>
        
        <div class="status-info">
          <div class="status-label" id="label">Ready</div>
          <div class="status-description" id="description">Waiting for manga page...</div>
          
          <div class="progress-bar" id="progressBar">
            <div class="progress-fill" id="progressFill"></div>
          </div>
          
          <button class="retry-button" id="retryBtn">Retry Connection</button>
          <div class="error-log" id="errorLog"></div>
          <div class="connection-details" id="details"></div>
        </div>
      </div>
    `;

    this.shadowRoot.innerHTML = `<style>${styles}</style>${html}`;
  }

  initializeEventListeners() {
    const container = this.shadowRoot.getElementById('container');
    const retryBtn = this.shadowRoot.getElementById('retryBtn');
    
    container.addEventListener('click', () => this.handleClick());
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.retryConnection();
    });

    // Listen for background messages
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'STATUS_UPDATE') {
          this.updateStatus(message.payload);
        }
      });
    }
  }

  async checkServiceHealth() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Extension context unavailable');
      }

      const response = await chrome.runtime.sendMessage({ 
        type: 'HEALTH_CHECK',
        timestamp: Date.now()
      });

      if (response && response.status === 'healthy') {
        this.setStatus('idle');
        this.retryCount = 0;
      } else {
        throw new Error('Unhealthy response');
      }
    } catch (error) {
      console.error('Health check failed:', error);
      this.handleError(error);
    }
  }

  handleError(error) {
    this.retryCount++;
    const errorLog = this.shadowRoot.getElementById('errorLog');
    const retryBtn = this.shadowRoot.getElementById('retryBtn');
    
    errorLog.textContent = `Error: ${error.message}`;
    errorLog.classList.add('visible');
    
    if (this.retryCount >= this.maxRetries) {
      this.setStatus('error');
      retryBtn.classList.add('visible');
    } else {
      this.setStatus('offline');
      setTimeout(() => this.checkServiceHealth(), 1000 * this.retryCount);
    }
  }

  async retryConnection() {
    const retryBtn = this.shadowRoot.getElementById('retryBtn');
    const errorLog = this.shadowRoot.getElementById('errorLog');
    
    retryBtn.textContent = 'Retrying...';
    retryBtn.disabled = true;
    
    this.retryCount = 0;
    await this.checkServiceHealth();
    
    retryBtn.textContent = 'Retry Connection';
    retryBtn.disabled = false;
    retryBtn.classList.remove('visible');
    errorLog.classList.remove('visible');
  }

  setStatus(statusKey, customMessage = null) {
    const config = StatusIndicator.STATUS_CONFIG[statusKey];
    if (!config) return;

    this.currentStatus = statusKey;
    const container = this.shadowRoot.getElementById('container');
    const icon = this.shadowRoot.getElementById('icon');
    const label = this.shadowRoot.getElementById('label');
    const description = this.shadowRoot.getElementById('description');
    const pulse = this.shadowRoot.getElementById('pulse');

    // Update visual state
    container.style.setProperty('--status-color', config.color);
    container.style.setProperty('--glow-color', config.glowColor);
    
    label.textContent = config.label;
    description.textContent = customMessage || config.description;
    
    // Update icon class and animation
    icon.className = `sharingan-icon ${config.icon === 'ems-active' ? 'ems' : 'tomoe'}`;
    
    // Apply animation
    if (config.animation === 'spin') {
      icon.classList.add('spinning');
    } else if (config.animation === 'intensify') {
      icon.classList.add('intensifying');
    } else if (config.animation === 'glitch') {
      icon.classList.add('glitch');
    }

    // Pulse ring for active states
    pulse.style.display = ['scanning', 'processing', 'active'].includes(statusKey) ? 'block' : 'none';

    // Trigger event for external listeners
    this.dispatchEvent(new CustomEvent('statuschange', {
      detail: { status: statusKey, config }
    }));
  }

  updateProgress(percent) {
    const progressBar = this.shadowRoot.getElementById('progressBar');
    const progressFill = this.shadowRoot.getElementById('progressFill');
    
    progressBar.classList.add('active');
    progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    
    if (percent >= 100) {
      setTimeout(() => progressBar.classList.remove('active'), 500);
    }
  }

  updateStatus(payload) {
    const { state, progress, message, details } = payload;
    
    if (state) this.setStatus(state, message);
    if (typeof progress === 'number') this.updateProgress(progress);
    
    const detailsEl = this.shadowRoot.getElementById('details');
    if (details) {
      detailsEl.textContent = details;
    }
  }

  handleClick() {
    // Toggle detailed view or trigger manual refresh
    if (this.currentStatus === 'error' || this.currentStatus === 'offline') {
      this.retryConnection();
    } else {
      this.dispatchEvent(new CustomEvent('statusclick', {
        detail: { currentStatus: this.currentStatus }
      }));
    }
  }

  startMonitoring(intervalMs = 30000) {
    this.checkServiceHealth();
    this.checkInterval = setInterval(() => this.checkServiceHealth(), intervalMs);
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  connectedCallback() {
    this.startMonitoring();
  }

  disconnectedCallback() {
    this.stopMonitoring();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    
    switch(name) {
      case 'status':
        this.setStatus(newValue);
        break;
      case 'message':
        const desc = this.shadowRoot.getElementById('description');
        if (desc) desc.textContent = newValue;
        break;
      case 'progress':
        this.updateProgress(parseFloat(newValue));
        break;
    }
  }
}

// Register the custom element
customElements.define('status-indicator', StatusIndicator);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StatusIndicator;
}