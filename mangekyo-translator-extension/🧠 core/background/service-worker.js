/**
 * Mangekyo Extension - Service Worker (MV3)
 * Core background script managing OCR, translation, and UI state coordination
 * @version 2.0.0
 */

import { CONFIG } from '../shared/constants.js';
import { ConfigManager } from '../shared/config-manager.js';
import { EventRouter } from './event-router.js';
import { APIManager } from './api-manager.js';
import { StateManager } from './state-manager.js';
import { LicenseValidator } from '../security/license/license-validator.js';
import { IntegrityChecker } from '../security/integrity/tamper-detection.js';
import { SecureStorage } from '../privacy/encryption/secure-storage.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class ServiceWorker {
  constructor() {
    this.initialized = false;
    this.state = null;
    this.config = null;
    this.eventRouter = null;
    this.apiManager = null;
    this.integrityChecker = null;
    this.performanceMonitor = null;
    
    // Offscreen document management
    this.offscreenDocumentPath = 'core/offscreen/offscreen.html';
    this.offscreenDocumentCreating = false;
    
    // Keep-alive mechanism
    this.keepAliveInterval = null;
    this.KEEP_ALIVE_INTERVAL = 20000; // 20 seconds
    
    // Active tabs tracking
    this.activeMangaTabs = new Set();
    this.translationQueue = new Map();
    
    // Security context
    this.securityContext = {
      licenseValid: false,
      integrityVerified: false,
      sessionToken: null
    };
  }

  /**
   * Initialize service worker
   */
  async initialize() {
    console.log('[Mangekyo] Service Worker initializing...');
    
    try {
      // Security checks first
      await this.performSecurityChecks();
      
      // Initialize core components
      this.performanceMonitor = new PerformanceMonitor();
      this.config = await ConfigManager.load();
      this.state = new StateManager();
      this.eventRouter = new EventRouter(this);
      this.apiManager = new APIManager(this.config);
      this.integrityChecker = new IntegrityChecker();
      
      // Setup event listeners
      this.setupLifecycleListeners();
      this.setupMessageListeners();
      this.setupAlarmListeners();
      this.setupTabListeners();
      this.setupContextMenu();
      
      // Start keep-alive for MV3
      this.startKeepAlive();
      
      // Initialize offscreen document if needed
      await this.ensureOffscreenDocument();
      
      this.initialized = true;
      console.log('[Mangekyo] Service Worker initialized successfully');
      
      // Broadcast ready state
      this.broadcastToAllTabs({ type: 'WORKER_READY', timestamp: Date.now() });
      
    } catch (error) {
      console.error('[Mangekyo] Initialization failed:', error);
      this.handleFatalError(error);
    }
  }

  /**
   * Security validation chain
   */
  async performSecurityChecks() {
    // Verify code integrity
    const integrity = await this.verifyCodeIntegrity();
    if (!integrity.valid) {
      throw new Error(`Integrity check failed: ${integrity.reason}`);
    }
    this.securityContext.integrityVerified = true;
    
    // Validate license
    const licenseValidator = new LicenseValidator();
    const licenseStatus = await licenseValidator.validate();
    if (!licenseStatus.valid) {
      console.warn('[Mangekyo] License validation failed:', licenseStatus.error);
      // Graceful degradation - limited functionality
      this.securityContext.licenseValid = false;
    } else {
      this.securityContext.licenseValid = true;
      this.securityContext.sessionToken = licenseStatus.token;
    }
    
    // Initialize secure storage
    await SecureStorage.initialize();
  }

  /**
   * Verify code hasn't been tampered with
   */
  async verifyCodeIntegrity() {
    try {
      // Check runtime environment
      if (chrome.runtime.id === undefined) {
        return { valid: false, reason: 'Extension context invalidated' };
      }
      
      // Verify extension files (simplified - real implementation would check hashes)
      const manifest = chrome.runtime.getManifest();
      if (manifest.version !== CONFIG.EXPECTED_VERSION) {
        return { valid: false, reason: 'Version mismatch' };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Setup extension lifecycle handlers
   */
  setupLifecycleListeners() {
    // Installation
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });
    
    // Startup
    chrome.runtime.onStartup.addListener(() => {
      this.handleStartup();
    });
    
    // Suspend warning (MV3 specific)
    if (chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(() => {
        this.handleSuspend();
      });
    }
  }

  /**
   * Handle extension installation/update
   */
  async handleInstall(details) {
    console.log('[Mangekyo] Install event:', details.reason);
    
    if (details.reason === 'install') {
      // First install
      await this.state.set('firstInstall', Date.now());
      await this.state.set('installVersion', chrome.runtime.getManifest().version);
      
      // Open onboarding
      chrome.tabs.create({
        url: chrome.runtime.getURL('ui/options/options.html?onboarding=true')
      });
      
      // Initialize default settings
      await ConfigManager.resetToDefaults();
      
    } else if (details.reason === 'update') {
      // Handle migration
      const previousVersion = details.previousVersion;
      const currentVersion = chrome.runtime.getManifest().version;
      
      await this.runMigrations(previousVersion, currentVersion);
      await this.state.set('lastUpdate', Date.now());
    }
    
    // Setup periodic alarms
    chrome.alarms.create('healthCheck', { periodInMinutes: 5 });
    chrome.alarms.create('cacheCleanup', { periodInMinutes: 60 });
    chrome.alarms.create('licenseRefresh', { periodInMinutes: 30 });
  }

  /**
   * Handle browser startup
   */
  async handleStartup() {
    console.log('[Mangekyo] Browser startup');
    await this.state.set('lastStartup', Date.now());
    
    // Restore previous session if needed
    const session = await this.state.get('lastSession');
    if (session && session.activeTranslation) {
      // Notify user of restored session
      this.showNotification('Session Restored', 'Mangekyo is ready to translate');
    }
  }

  /**
   * Handle imminent suspension (MV3)
   */
  handleSuspend() {
    console.log('[Mangekyo] Preparing for suspend');
    this.state.set('lastSession', {
      timestamp: Date.now(),
      activeTranslation: this.activeMangaTabs.size > 0
    });
    this.cleanup();
  }

  /**
   * Setup message passing infrastructure
   */
  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Async message handling
      this.handleMessage(message, sender)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      
      return true; // Keep channel open for async
    });
    
    // External messages (from native messaging host)
    chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
      this.handleExternalMessage(message, sender, sendResponse);
      return true;
    });
  }

  /**
   * Route messages to appropriate handlers
   */
  async handleMessage(message, sender) {
    const { type, payload, requestId } = message;
    
    // Performance tracking
    const perfMark = this.performanceMonitor.start(`msg_${type}`);
    
    try {
      let result;
      
      switch (type) {
        // Content Script Messages
        case 'DETECT_MANGA_PAGE':
          result = await this.handleMangaDetection(sender.tab.id, payload);
          break;
          
        case 'EXTRACT_TEXT':
          result = await this.handleTextExtraction(payload, sender.tab.id);
          break;
          
        case 'REQUEST_TRANSLATION':
          result = await this.handleTranslationRequest(payload, sender.tab.id);
          break;
          
        case 'CAPTURE_SCREENSHOT':
          result = await this.handleScreenshotRequest(sender.tab);
          break;
          
        // UI Messages
        case 'TOGGLE_TRANSLATION':
          result = await this.toggleTranslation(sender.tab.id, payload);
          break;
          
        case 'GET_STATUS':
          result = await this.getExtensionStatus();
          break;
          
        case 'UPDATE_SETTINGS':
          result = await this.handleSettingsUpdate(payload);
          break;
          
        // Offscreen Document Messages
        case 'OCR_COMPLETE':
          result = await this.handleOCRResult(payload, requestId);
          break;
          
        case 'OCR_ERROR':
          result = await this.handleOCRError(payload, requestId);
          break;
          
        // Security Messages
        case 'VALIDATE_LICENSE':
          result = await this.handleLicenseValidation(payload);
          break;
          
        case 'GET_SECURITY_CONTEXT':
          result = this.getSecurityContext();
          break;
          
        default:
          // Route to event router for custom handlers
          result = await this.eventRouter.route(type, payload, sender);
      }
      
      this.performanceMonitor.end(perfMark);
      return result;
      
    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error(`[Mangekyo] Message handling error [${type}]:`, error);
      throw error;
    }
  }

  /**
   * Handle external messages (native apps, other extensions)
   */
  handleExternalMessage(message, sender, sendResponse) {
    // Verify sender origin if needed
    if (!this.verifyExternalSender(sender)) {
      sendResponse({ error: 'Unauthorized sender' });
      return;
    }
    
    switch (message.type) {
      case 'NATIVE_SCREEN_CAPTURE':
        this.handleNativeCapture(message.payload).then(sendResponse);
        break;
        
      case 'DESKTOP_OVERLAY_COMMAND':
        this.handleDesktopOverlayCommand(message.payload).then(sendResponse);
        break;
        
      default:
        sendResponse({ error: 'Unknown command' });
    }
  }

  /**
   * Manga detection handler
   */
  async handleMangaDetection(tabId, payload) {
    const { url, hasImages, imageCount } = payload;
    
    // Check if site is supported
    const isSupported = this.checkSiteSupport(url);
    const confidence = this.calculateMangaConfidence(payload);
    
    if (confidence > 0.7) {
      this.activeMangaTabs.add(tabId);
      
      // Notify content script to activate scanner
      chrome.tabs.sendMessage(tabId, {
        type: 'ACTIVATE_SCANNER',
        config: await ConfigManager.get('scanner')
      });
      
      // Update icon to idle state (3 tomoe)
      this.updateIcon('idle', tabId);
    }
    
    return { isManga: confidence > 0.7, confidence, isSupported };
  }

  /**
   * Text extraction and OCR coordination
   */
  async handleTextExtraction(payload, tabId) {
    const { imageData, regions, language } = payload;
    
    // Ensure offscreen document is ready for heavy OCR
    await this.ensureOffscreenDocument();
    
    // Generate unique request ID
    const requestId = `ocr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Queue the request
    this.translationQueue.set(requestId, {
      tabId,
      timestamp: Date.now(),
      status: 'processing'
    });
    
    // Send to offscreen document for OCR processing
    await chrome.runtime.sendMessage({
      type: 'PROCESS_OCR',
      target: 'offscreen',
      requestId,
      payload: {
        imageData,
        regions,
        language,
        preprocess: true
      }
    });
    
    return { requestId, status: 'processing' };
  }

  /**
   * Handle OCR results from offscreen document
   */
  async handleOCRResult(payload, requestId) {
    const { text, regions, confidence } = payload;
    const request = this.translationQueue.get(requestId);
    
    if (!request) {
      console.warn('[Mangekyo] Unknown OCR request:', requestId);
      return;
    }
    
    // Update queue status
    request.status = 'translating';
    request.ocrConfidence = confidence;
    
    // Proceed to translation if text found
    if (text && text.length > 0) {
      const translation = await this.apiManager.translate(text, {
        sourceLang: request.sourceLang || 'auto',
        targetLang: await ConfigManager.get('targetLanguage'),
        preserveContext: true,
        honorifics: await ConfigManager.get('honorificsHandling')
      });
      
      // Send result back to content script
      chrome.tabs.sendMessage(request.tabId, {
        type: 'TRANSLATION_COMPLETE',
        requestId,
        original: text,
        translation,
        regions,
        confidence
      });
      
      // Cache the translation
      await this.cacheTranslation(text, translation, request.tabId);
    }
    
    this.translationQueue.delete(requestId);
    return { processed: true };
  }

  /**
   * Handle OCR errors
   */
  handleOCRError(payload, requestId) {
    const { error, stage } = payload;
    const request = this.translationQueue.get(requestId);
    
    if (request) {
      chrome.tabs.sendMessage(request.tabId, {
        type: 'TRANSLATION_ERROR',
        requestId,
        error: `OCR failed at ${stage}: ${error}`
      });
      
      this.translationQueue.delete(requestId);
    }
  }

  /**
   * Translation request handler
   */
  async handleTranslationRequest(payload, tabId) {
    const { text, context, sourceLang, targetLang } = payload;
    
    // Check cache first
    const cached = await this.getCachedTranslation(text);
    if (cached) {
      return { translation: cached, cached: true };
    }
    
    // Call translation API
    const result = await this.apiManager.translate(text, {
      sourceLang: sourceLang || 'auto',
      targetLang: targetLang || await ConfigManager.get('targetLanguage'),
      context,
      engine: await ConfigManager.get('translationEngine')
    });
    
    return { translation: result, cached: false };
  }

  /**
   * Screenshot capture for canvas/WebGL content
   */
  async handleScreenshotRequest(tab) {
    try {
      // Use chrome.tabs.captureVisibleTab for screenshot
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png',
        quality: 100
      });
      
      return { success: true, dataUrl };
    } catch (error) {
      console.error('[Mangekyo] Screenshot failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Toggle translation state
   */
  async toggleTranslation(tabId, payload) {
    const { active } = payload;
    
    if (active) {
      // Activate EMS mode
      this.updateIcon('active', tabId);
      
      chrome.tabs.sendMessage(tabId, {
        type: 'ACTIVATE_EMS',
        config: await ConfigManager.get('overlay')
      });
      
      // Start periodic translation if auto-mode enabled
      if (await ConfigManager.get('autoTranslate')) {
        chrome.alarms.create(`translate_${tabId}`, {
          periodInMinutes: 0.5 // Every 30 seconds
        });
      }
      
    } else {
      // Deactivate to idle state
      this.updateIcon('idle', tabId);
      
      chrome.tabs.sendMessage(tabId, {
        type: 'DEACTIVATE_EMS'
      });
      
      // Clear auto-translate alarm
      chrome.alarms.clear(`translate_${tabId}`);
    }
    
    return { active };
  }

  /**
   * Settings update handler
   */
  async handleSettingsUpdate(payload) {
    const { category, settings } = payload;
    
    await ConfigManager.set(category, settings);
    
    // Broadcast to all manga tabs
    this.broadcastToMangaTabs({
      type: 'SETTINGS_UPDATED',
      category,
      settings
    });
    
    return { saved: true };
  }

  /**
   * Alarm handlers for periodic tasks
   */
  setupAlarmListeners() {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      switch (alarm.name) {
        case 'healthCheck':
          await this.performHealthCheck();
          break;
          
        case 'cacheCleanup':
          await this.cleanupCache();
          break;
          
        case 'licenseRefresh':
          await this.refreshLicense();
          break;
          
        default:
          if (alarm.name.startsWith('translate_')) {
            const tabId = parseInt(alarm.name.replace('translate_', ''));
            await this.triggerAutoTranslate(tabId);
          }
      }
    });
  }

  /**
   * Tab event listeners
   */
  setupTabListeners() {
    // Track tab updates for manga detection
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        // Check if manga site
        if (this.isMangaSite(tab.url)) {
          this.activeMangaTabs.add(tabId);
        }
      }
    });
    
    // Cleanup on tab close
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.activeMangaTabs.delete(tabId);
      this.translationQueue.delete(tabId);
      chrome.alarms.clear(`translate_${tabId}`);
    });
    
    // Handle activation
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      if (this.activeMangaTabs.has(activeInfo.tabId)) {
        const isActive = await this.state.get(`tab_${activeInfo.tabId}_active`);
        this.updateIcon(isActive ? 'active' : 'idle', activeInfo.tabId);
      }
    });
  }

  /**
   * Context menu setup
   */
  setupContextMenu() {
    chrome.contextMenus.create({
      id: 'mangekyo-translate',
      title: 'Translate with Mangekyo',
      contexts: ['image', 'selection'],
      documentUrlPatterns: ['*://*/*manga*', '*://*/*manhwa*', '*://mangadex.org/*', '*://webtoons.com/*']
    });
    
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === 'mangekyo-translate') {
        if (info.srcUrl) {
          // Image translation
          this.handleImageTranslation(info.srcUrl, tab.id);
        } else if (info.selectionText) {
          // Text translation
          this.handleTranslationRequest({ text: info.selectionText }, tab.id);
        }
      }
    });
  }

  /**
   * Offscreen document management (MV3 requirement for DOM APIs)
   */
  async ensureOffscreenDocument() {
    if (await this.hasOffscreenDocument()) {
      return;
    }
    
    if (this.offscreenDocumentCreating) {
      await this.waitForOffscreenDocument();
      return;
    }
    
    this.offscreenDocumentCreating = true;
    
    try {
      await chrome.offscreen.createDocument({
        url: this.offscreenDocumentPath,
        reasons: ['WORKERS', 'DOM_PARSER', 'LOCAL_STORAGE'],
        justification: 'OCR processing requires DOM APIs and Web Workers not available in service worker'
      });
      
      console.log('[Mangekyo] Offscreen document created');
    } catch (error) {
      console.error('[Mangekyo] Failed to create offscreen document:', error);
      throw error;
    } finally {
      this.offscreenDocumentCreating = false;
    }
  }

  /**
   * Check if offscreen document exists
   */
  async hasOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(this.offscreenDocumentPath)]
    });
    return existingContexts.length > 0;
  }

  /**
   * Wait for offscreen document creation
   */
  async waitForOffscreenDocument() {
    while (this.offscreenDocumentCreating) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Keep-alive mechanism for MV3 (prevent service worker suspension)
   */
  startKeepAlive() {
    // Periodic self-message to keep alive
    this.keepAliveInterval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'KEEP_ALIVE', timestamp: Date.now() })
        .catch(() => {/* Ignore errors */});
    }, this.KEEP_ALIVE_INTERVAL);
    
    // Listen for keep-alive responses
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'KEEP_ALIVE') return true;
    });
  }

  /**
   * Update extension icon based on state
   */
  updateIcon(state, tabId) {
    const icons = {
      idle: {
        16: 'build/assets/icons/icon-idle-16.png',
        32: 'build/assets/icons/icon-idle-32.png'
      },
      active: {
        16: 'build/assets/icons/icon-active-16.png',
        32: 'build/assets/icons/icon-active-32.png'
      },
      disabled: {
        16: 'build/assets/icons/icon16.png',
        32: 'build/assets/icons/icon32.png'
      }
    };
    
    chrome.action.setIcon({
      tabId,
      path: icons[state] || icons.disabled
    });
    
    // Update badge
    if (state === 'active') {
      chrome.action.setBadgeText({ text: '●', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }

  /**
   * Broadcast message to all manga tabs
   */
  broadcastToMangaTabs(message) {
    this.activeMangaTabs.forEach(tabId => {
      chrome.tabs.sendMessage(tabId, message).catch(() => {
        // Tab may be closed, remove from tracking
        this.activeMangaTabs.delete(tabId);
      });
    });
  }

  /**
   * Broadcast to all tabs
   */
  broadcastToAllTabs(message) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      });
    });
  }

  /**
   * Utility methods
   */
  checkSiteSupport(url) {
    const supportedPatterns = [
      /mangadex\.org/i,
      /webtoons\.com/i,
      /manga.*reader/i,
      /manhwa/i,
      /cubari\.moe/i
    ];
    return supportedPatterns.some(pattern => pattern.test(url));
  }

  calculateMangaConfidence(payload) {
    let score = 0;
    if (payload.hasImages) score += 0.3;
    if (payload.imageCount > 5) score += 0.3;
    if (payload.hasLongStripLayout) score += 0.2;
    if (this.checkSiteSupport(payload.url)) score += 0.2;
    return Math.min(score, 1.0);
  }

  isMangaSite(url) {
    return this.checkSiteSupport(url);
  }

  async cacheTranslation(original, translation, tabId) {
    // Implementation would use IndexedDB via storage/
  }

  async getCachedTranslation(text) {
    // Implementation would check IndexedDB
    return null;
  }

  async performHealthCheck() {
    const memory = performance.memory;
    console.log('[Mangekyo] Health check - Memory:', memory?.usedJSHeapSize);
    
    // Check queue health
    const now = Date.now();
    for (const [id, request] of this.translationQueue) {
      if (now - request.timestamp > 300000) { // 5 minutes timeout
        this.translationQueue.delete(id);
      }
    }
  }

  async cleanupCache() {
    // Cleanup old translations
  }

  async refreshLicense() {
    if (this.securityContext.licenseValid) {
      const validator = new LicenseValidator();
      await validator.refresh();
    }
  }

  getSecurityContext() {
    return {
      ...this.securityContext,
      initialized: this.initialized,
      timestamp: Date.now()
    };
  }

  getExtensionStatus() {
    return {
      initialized: this.initialized,
      activeTabs: this.activeMangaTabs.size,
      queueSize: this.translationQueue.size,
      security: this.getSecurityContext(),
      performance: this.performanceMonitor?.getStats()
    };
  }

  showNotification(title, message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'build/assets/icons/icon128.png',
      title,
      message
    });
  }

  async runMigrations(fromVersion, toVersion) {
    console.log(`[Mangekyo] Migrating from ${fromVersion} to ${toVersion}`);
    // Version-specific migrations
  }

  handleFatalError(error) {
    // Log to error tracking
    console.error('[Mangekyo] Fatal error:', error);
    
    // Notify user
    this.showNotification(
      'Mangekyo Error',
      'Extension failed to initialize. Please reload or reinstall.'
    );
  }

  cleanup() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    this.translationQueue.clear();
  }
}

// Initialize service worker
const worker = new ServiceWorker();
worker.initialize();

// Handle unhandled errors
self.onerror = (error) => {
  console.error('[Mangekyo] Unhandled error:', error);
};

self.onunhandledrejection = (event) => {
  console.error('[Mangekyo] Unhandled rejection:', event.reason);
};