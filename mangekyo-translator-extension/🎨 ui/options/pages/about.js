// ui/options/pages/about.js

/**
 * About Page
 * Extension information, credits, licenses, and update management
 * Themed around the "Madara" persona and the extension's journey
 */

import { ConfigManager } from '../../../core/shared/config-manager.js';

class AboutPage {
  constructor() {
    this.config = new ConfigManager();
    this.container = null;
    this.version = chrome.runtime.getManifest().version;
  }

  /**
   * Initialize the about page
   */
  async init() {
    this.container = document.getElementById('about-container');
    if (!this.container) return;

    await this.render();
    this.attachEventListeners();
    await this.checkForUpdates();
  }

  /**
   * Render the complete about page
   */
  async render() {
    this.container.innerHTML = `
      <div class="about-layout">
        <!-- Hero Section -->
        <section class="about-hero">
          <div class="ems-backdrop"></div>
          <div class="hero-content">
            <div class="logo-animation">
              <img src="../../build/assets/icons/icon128.png" alt="Madara" class="main-logo" id="logo-pulse">
              <div class="sharingan-glow"></div>
            </div>
            <h1 class="extension-name">Madara</h1>
            <p class="tagline">"I alone am the translator of all manga"</p>
            <div class="version-badge">
              <span class="version-number">v${this.version}</span>
              <span class="channel-tag" id="channel-tag">Stable</span>
            </div>
          </div>
        </section>

        <!-- Quick Stats -->
        <section class="stats-grid">
          <div class="stat-card">
            <span class="stat-icon">📖</span>
            <span class="stat-value" id="pages-translated">0</span>
            <span class="stat-label">Pages Translated</span>
          </div>
          <div class="stat-card">
            <span class="stat-icon">🎯</span>
            <span class="stat-value" id="accuracy-rate">0%</span>
            <span class="stat-label">OCR Accuracy</span>
          </div>
          <div class="stat-card">
            <span class="stat-icon">⚡</span>
            <span class="stat-value" id="active-sessions">0</span>
            <span class="stat-label">Active Sessions</span>
          </div>
          <div class="stat-card">
            <span class="stat-icon">🌐</span>
            <span class="stat-value">12</span>
            <span class="stat-label">Languages</span>
          </div>
        </section>

        <!-- Update Manager -->
        <section class="update-section" id="update-section">
          <div class="section-header">
            <span class="section-icon">🔄</span>
            <h3>Update Status</h3>
          </div>
          <div class="update-card" id="update-card">
            <div class="update-status">
              <div class="status-indicator" id="update-indicator"></div>
              <span class="status-text" id="update-status-text">Checking for updates...</span>
            </div>
            <div class="update-actions">
              <button class="secondary-btn" id="check-update-btn" disabled>Check Now</button>
              <button class="primary-btn hidden" id="install-update-btn">Install Update</button>
            </div>
            <div class="update-changelog hidden" id="changelog-container">
              <h4>What's New</h4>
              <ul id="changelog-list"></ul>
            </div>
          </div>
        </section>

        <!-- The Journey / Story -->
        <section class="story-section">
          <div class="section-header">
            <span class="section-icon">📜</span>
            <h3>The Journey</h3>
          </div>
          <div class="timeline">
            <div class="timeline-item completed">
              <div class="timeline-marker">✓</div>
              <div class="timeline-content">
                <h4>Awakening</h4>
                <p>Initial release with core OCR and translation capabilities</p>
                <span class="timeline-date">v1.0 - 2024</span>
              </div>
            </div>
            <div class="timeline-item completed">
              <div class="timeline-marker">✓</div>
              <div class="timeline-content">
                <h4>Mangekyō</h4>
                <p>Computer vision integration for bubble detection and panel analysis</p>
                <span class="timeline-date">v2.0</span>
              </div>
            </div>
            <div class="timeline-item active">
              <div class="timeline-marker">★</div>
              <div class="timeline-content">
                <h4>Eternal Mangekyō</h4>
                <p>Current: Advanced security, WebAssembly acceleration, and site adapters</p>
                <span class="timeline-date">v${this.version}</span>
              </div>
            </div>
            <div class="timeline-item future">
              <div class="timeline-marker">◯</div>
              <div class="timeline-content">
                <h4>Rinnegan</h4>
                <p>On-device LLM translation and predictive preloading</p>
                <span class="timeline-date">v3.0 - Roadmap</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Credits -->
        <section class="credits-section">
          <div class="section-header">
            <span class="section-icon">👥</span>
            <h3>The Shinobi Behind the Scenes</h3>
          </div>
          <div class="credits-grid">
            <div class="credit-card lead">
              <div class="avatar">🦸</div>
              <h4>Lead Developer</h4>
              <p>Architecture & Vision</p>
              <span class="handle">@madara-dev</span>
            </div>
            <div class="credit-card">
              <div class="avatar">🔬</div>
              <h4>CV/OCR Team</h4>
              <p>Computer Vision & Machine Learning</p>
              <span class="handle">Tesseract.js & TensorFlow.js</span>
            </div>
            <div class="credit-card">
              <div class="avatar">🎨</div>
              <h4>UI/UX Design</h4>
              <p>Interface & Experience</p>
              <span class="handle">Sharingan Theme System</span>
            </div>
            <div class="credit-card">
              <div class="avatar">🌐</div>
              <h4>Translation Engines</h4>
              <p>Google, DeepL, OpenAI</p>
              <span class="handle">API Partners</span>
            </div>
          </div>
          
          <div class="special-thanks">
            <h4>Special Thanks</h4>
            <p>
              To the manga scanlation community for pushing the boundaries of what's possible. 
              To Masashi Kishimoto for creating the visual language that inspired our interface. 
              And to every user who reported bugs, suggested features, and shared their favorite manga moments.
            </p>
          </div>
        </section>

        <!-- Open Source Licenses -->
        <section class="licenses-section">
          <div class="section-header">
            <span class="section-icon">📄</span>
            <h3>Open Source Licenses</h3>
          </div>
          <div class="license-list">
            <div class="license-item">
              <div class="license-header" data-license="tesseract">
                <span class="license-name">Tesseract.js</span>
                <span class="license-type">Apache 2.0</span>
                <span class="expand-icon">▼</span>
              </div>
              <div class="license-content hidden">
                <p>Copyright 2020 Jeromy Wu</p>
                <p>Licensed under the Apache License, Version 2.0. Tesseract.js is a pure Javascript port of the popular Tesseract OCR engine.</p>
                <a href="https://github.com/naptha/tesseract.js" target="_blank" rel="noopener">View Source</a>
              </div>
            </div>
            
            <div class="license-item">
              <div class="license-header" data-license="tensorflow">
                <span class="license-name">TensorFlow.js</span>
                <span class="license-type">Apache 2.0</span>
                <span class="expand-icon">▼</span>
              </div>
              <div class="license-content hidden">
                <p>Copyright 2020 Google LLC</p>
                <p>A WebGL accelerated, browser based JavaScript library for training and deploying ML models.</p>
                <a href="https://github.com/tensorflow/tfjs" target="_blank" rel="noopener">View Source</a>
              </div>
            </div>
            
            <div class="license-item">
              <div class="license-header" data-license="sharp">
                <span class="license-name">Sharp</span>
                <span class="license-type">Apache 2.0</span>
                <span class="expand-icon">▼</span>
              </div>
              <div class="license-content hidden">
                <p>High performance Node.js image processing</p>
                <a href="https://github.com/lovell/sharp" target="_blank" rel="noopener">View Source</a>
              </div>
            </div>

            <div class="license-item">
              <div class="license-header" data-license="extension">
                <span class="license-name">Madara Extension</span>
                <span class="license-type">GPL-3.0</span>
                <span class="expand-icon">▼</span>
              </div>
              <div class="license-content hidden">
                <p>This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation.</p>
                <button class="secondary-btn" id="view-full-license">View Full License</button>
              </div>
            </div>
          </div>
        </section>

        <!-- Links & Resources -->
        <section class="links-section">
          <div class="section-header">
            <span class="section-icon">🔗</span>
            <h3>Resources</h3>
          </div>
          <div class="links-grid">
            <a href="https://github.com/madara-dev/madara-extension" class="resource-link" target="_blank" rel="noopener">
              <span class="link-icon">💻</span>
              <div class="link-info">
                <span class="link-title">GitHub Repository</span>
                <span class="link-desc">Source code & issue tracker</span>
              </div>
            </a>
            <a href="https://docs.madara.dev" class="resource-link" target="_blank" rel="noopener">
              <span class="link-icon">📚</span>
              <div class="link-info">
                <span class="link-title">Documentation</span>
                <span class="link-desc">API reference & guides</span>
              </div>
            </a>
            <a href="https://discord.gg/madara" class="resource-link" target="_blank" rel="noopener">
              <span class="link-icon">💬</span>
              <div class="link-info">
                <span class="link-title">Community Discord</span>
                <span class="link-desc">Support & discussions</span>
              </div>
            </a>
            <a href="#" class="resource-link" id="feedback-link">
              <span class="link-icon">✉️</span>
              <div class="link-info">
                <span class="link-title">Send Feedback</span>
                <span class="link-desc">Report bugs or suggest features</span>
              </div>
            </a>
          </div>
        </section>

        <!-- Debug Info (Collapsible) -->
        <section class="debug-section">
          <button class="debug-toggle" id="debug-toggle">
            <span>Technical Information</span>
            <span class="toggle-icon">▶</span>
          </button>
          <div class="debug-content hidden" id="debug-content">
            <div class="debug-grid">
              <div class="debug-item">
                <span class="debug-label">Extension ID</span>
                <code class="debug-value" id="extension-id">Loading...</code>
              </div>
              <div class="debug-item">
                <span class="debug-label">Chrome Version</span>
                <code class="debug-value" id="chrome-version">Loading...</code>
              </div>
              <div class="debug-item">
                <span class="debug-label">Platform</span>
                <code class="debug-value" id="platform-info">Loading...</code>
              </div>
              <div class="debug-item">
                <span class="debug-label">Service Worker</span>
                <code class="debug-value" id="sw-status">Checking...</code>
              </div>
              <div class="debug-item wide">
                <span class="debug-label">Permissions</span>
                <code class="debug-value" id="permissions-list">Loading...</code>
              </div>
            </div>
            <button class="secondary-btn" id="copy-debug-btn">Copy to Clipboard</button>
          </div>
        </section>

        <!-- Footer -->
        <footer class="about-footer">
          <p>Made with ❤️ and a lot of ☕ by the Madara Team</p>
          <p class="copyright">© 2024 Madara Project. All rights reserved.</p>
          <p class="disclaimer">
            This extension is not affiliated with any manga publishers or translation groups. 
            Use responsibly and support official releases when available.
          </p>
        </footer>
      </div>

      <!-- Feedback Modal -->
      <div class="modal hidden" id="feedback-modal">
        <div class="modal-overlay"></div>
        <div class="modal-content">
          <h3>Send Feedback</h3>
          <form id="feedback-form">
            <div class="form-group">
              <label>Type</label>
              <select id="feedback-type" required>
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
                <option value="translation">Translation Issue</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label>Message</label>
              <textarea id="feedback-message" rows="5" placeholder="Describe your experience..." required></textarea>
            </div>
            <div class="form-group checkbox">
              <label>
                <input type="checkbox" id="include-logs" checked>
                Include diagnostic logs
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="secondary-btn" id="cancel-feedback">Cancel</button>
              <button type="submit" class="primary-btn">Send</button>
            </div>
          </form>
        </div>
      </div>
    `;

    await this.loadStatistics();
    await this.loadTechnicalInfo();
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Logo pulse animation on click
    const logo = document.getElementById('logo-pulse');
    if (logo) {
      logo.addEventListener('click', () => {
        logo.classList.add('mangekyo-spin');
        setTimeout(() => logo.classList.remove('mangekyo-spin'), 2000);
      });
    }

    // Update check button
    document.getElementById('check-update-btn')?.addEventListener('click', () => this.checkForUpdates(true));
    document.getElementById('install-update-btn')?.addEventListener('click', () => this.installUpdate());

    // License expand/collapse
    this.container.querySelectorAll('.license-header').forEach(header => {
      header.addEventListener('click', (e) => this.toggleLicense(e.currentTarget));
    });

    // View full license button
    document.getElementById('view-full-license')?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('LICENSE') });
    });

    // Debug toggle
    document.getElementById('debug-toggle')?.addEventListener('click', (e) => {
      const content = document.getElementById('debug-content');
      const icon = e.currentTarget.querySelector('.toggle-icon');
      content.classList.toggle('hidden');
      icon.textContent = content.classList.contains('hidden') ? '▶' : '▼';
    });

    // Copy debug info
    document.getElementById('copy-debug-btn')?.addEventListener('click', () => this.copyDebugInfo());

    // Feedback modal
    document.getElementById('feedback-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('feedback-modal').classList.remove('hidden');
    });

    document.getElementById('cancel-feedback')?.addEventListener('click', () => {
      document.getElementById('feedback-modal').classList.add('hidden');
    });

    document.getElementById('feedback-form')?.addEventListener('submit', (e) => this.submitFeedback(e));

    // Close modal on overlay click
    document.querySelector('.modal-overlay')?.addEventListener('click', () => {
      document.getElementById('feedback-modal').classList.add('hidden');
    });
  }

  /**
   * Load user statistics
   */
  async loadStatistics() {
    try {
      const stats = await chrome.runtime.sendMessage({ type: 'GET_USER_STATS' });
      
      // Animate numbers
      this.animateNumber('pages-translated', stats.pagesTranslated || 0);
      this.animateNumber('accuracy-rate', stats.accuracyRate || 95, '%');
      this.animateNumber('active-sessions', stats.activeSessions || 1);
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  }

  /**
   * Animate number counting up
   */
  animateNumber(elementId, target, suffix = '') {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const duration = 1500;
    const start = 0;
    const startTime = performance.now();

    const update = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(start + (target - start) * easeOut);
      
      element.textContent = current + suffix;
      
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };

    requestAnimationFrame(update);
  }

  /**
   * Check for extension updates
   */
  async checkForUpdates(manual = false) {
    const indicator = document.getElementById('update-indicator');
    const statusText = document.getElementById('update-status-text');
    const checkBtn = document.getElementById('check-update-btn');
    const installBtn = document.getElementById('install-update-btn');
    const changelog = document.getElementById('changelog-container');

    if (manual) {
      indicator.className = 'status-indicator checking';
      statusText.textContent = 'Checking for updates...';
      checkBtn.disabled = true;
    }

    try {
      // Check Chrome Web Store or internal update endpoint
      const updateInfo = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATES' });
      
      if (updateInfo.available) {
        indicator.className = 'status-indicator update-available';
        statusText.textContent = `Update available: v${updateInfo.version}`;
        checkBtn.classList.add('hidden');
        installBtn.classList.remove('hidden');
        changelog.classList.remove('hidden');
        
        // Populate changelog
        const list = document.getElementById('changelog-list');
        list.innerHTML = updateInfo.changelog.map(item => `<li>${item}</li>`).join('');
      } else {
        indicator.className = 'status-indicator up-to-date';
        statusText.textContent = 'You are up to date!';
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check Again';
      }
    } catch (e) {
      indicator.className = 'status-indicator error';
      statusText.textContent = 'Update check failed';
      checkBtn.disabled = false;
    }
  }

  /**
   * Trigger update installation
   */
  async installUpdate() {
    try {
      await chrome.runtime.sendMessage({ type: 'INSTALL_UPDATE' });
      // Extension will reload, show message before that
      const statusText = document.getElementById('update-status-text');
      statusText.textContent = 'Installing update... Extension will restart.';
    } catch (e) {
      alert('Failed to install update. Please try again later.');
    }
  }

  /**
   * Toggle license accordion
   */
  toggleLicense(header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.expand-icon');
    
    const isHidden = content.classList.contains('hidden');
    
    // Close all others
    this.container.querySelectorAll('.license-content').forEach(c => c.classList.add('hidden'));
    this.container.querySelectorAll('.expand-icon').forEach(i => i.textContent = '▼');
    
    if (isHidden) {
      content.classList.remove('hidden');
      icon.textContent = '▲';
    }
  }

  /**
   * Load technical/debug information
   */
  async loadTechnicalInfo() {
    const manifest = chrome.runtime.getManifest();
    
    // Extension ID
    document.getElementById('extension-id').textContent = chrome.runtime.id || 'Development Mode';
    
    // Chrome version
    const chromeVersion = /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1] || 'Unknown';
    document.getElementById('chrome-version').textContent = chromeVersion;
    
    // Platform
    document.getElementById('platform-info').textContent = `${navigator.platform} | ${navigator.language}`;
    
    // Service Worker status
    try {
      const swStatus = await navigator.serviceWorker?.ready ? 'Active' : 'Inactive';
      document.getElementById('sw-status').textContent = swStatus;
    } catch (e) {
      document.getElementById('sw-status').textContent = 'MV3 Service Worker';
    }
    
    // Permissions
    const permissions = await chrome.permissions.getAll();
    document.getElementById('permissions-list').textContent = permissions.permissions?.join(', ') || 'None';
  }

  /**
   * Copy debug info to clipboard
   */
  async copyDebugInfo() {
    const info = {
      extensionId: chrome.runtime.id,
      version: this.version,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      timestamp: new Date().toISOString()
    };
    
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
    
    const btn = document.getElementById('copy-debug-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = originalText, 2000);
  }

  /**
   * Submit feedback form
   */
  async submitFeedback(e) {
    e.preventDefault();
    
    const type = document.getElementById('feedback-type').value;
    const message = document.getElementById('feedback-message').value;
    const includeLogs = document.getElementById('include-logs').checked;
    
    try {
      await chrome.runtime.sendMessage({
        type: 'SUBMIT_FEEDBACK',
        feedback: { type, message, includeLogs, timestamp: new Date().toISOString() }
      });
      
      document.getElementById('feedback-modal').classList.add('hidden');
      e.target.reset();
      this.showToast('Feedback sent! Thank you.');
    } catch (err) {
      alert('Failed to send feedback. Please try again.');
    }
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

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new AboutPage().init());
} else {
  new AboutPage().init();
}

export default AboutPage;