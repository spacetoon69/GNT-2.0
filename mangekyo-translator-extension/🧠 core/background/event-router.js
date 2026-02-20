/**
 * Mangekyo Extension - Event Router
 * Central message passing coordinator handling all inter-component communication
 * Implements pub/sub pattern with priority routing and middleware support
 * @version 2.0.0
 */

import { CONFIG } from '../shared/constants.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class EventRouter {
  constructor(serviceWorker) {
    this.sw = serviceWorker;
    this.handlers = new Map();
    this.middleware = [];
    this.channels = new Map();
    this.pendingResponses = new Map();
    this.messageHistory = [];
    this.MAX_HISTORY = 100;
    
    // Priority levels for message processing
    this.PRIORITY = {
      CRITICAL: 0,   // Security, license validation
      HIGH: 1,       // User interactions, translations
      NORMAL: 2,     // General data flow
      LOW: 3,        // Analytics, logging
      BACKGROUND: 4  // Cleanup, maintenance
    };
    
    // Component registry
    this.components = {
      CONTENT: 'content',
      OFFSCREEN: 'offscreen',
      POPUP: 'popup',
      OPTIONS: 'options',
      OVERLAY: 'overlay',
      NATIVE: 'native',
      BACKGROUND: 'background'
    };
    
    // Initialize middleware chain
    this.initializeMiddleware();
  }

  /**
   * Initialize middleware pipeline
   */
  initializeMiddleware() {
    // Security validation middleware
    this.use(async (message, context, next) => {
      if (message.requiresAuth && !this.sw.securityContext.licenseValid) {
        throw new Error('License validation required for this operation');
      }
      await next();
    });
    
    // Rate limiting middleware
    this.use(async (message, context, next) => {
      const key = `${context.sender?.tab?.id || 'background'}_${message.type}`;
      const limiter = this.getRateLimiter(key);
      
      if (!limiter.allow()) {
        throw new Error('Rate limit exceeded');
      }
      await next();
    });
    
    // Logging middleware
    this.use(async (message, context, next) => {
      const start = performance.now();
      await next();
      const duration = performance.now() - start;
      
      if (duration > 100) {
        console.warn(`[EventRouter] Slow message ${message.type}: ${duration.toFixed(2)}ms`);
      }
    });
  }

  /**
   * Register a middleware function
   */
  use(middleware) {
    this.middleware.push(middleware);
  }

  /**
   * Register an event handler
   */
  on(eventType, handler, options = {}) {
    const config = {
      priority: this.PRIORITY.NORMAL,
      once: false,
      async: true,
      component: this.components.BACKGROUND,
      ...options
    };
    
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    
    this.handlers.get(eventType).push({ handler, config });
    
    // Sort by priority
    this.handlers.get(eventType).sort((a, b) => 
      a.config.priority - b.config.priority
    );
    
    return () => this.off(eventType, handler); // Return unsubscribe function
  }

  /**
   * Remove event handler
   */
  off(eventType, handlerToRemove) {
    if (!this.handlers.has(eventType)) return;
    
    const handlers = this.handlers.get(eventType);
    const index = handlers.findIndex(({ handler }) => handler === handlerToRemove);
    
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Route message to appropriate handler(s)
   */
  async route(type, payload, sender) {
    const context = {
      type,
      payload,
      sender,
      timestamp: Date.now(),
      id: this.generateMessageId(),
      component: this.detectComponent(sender)
    };
    
    // Log message
    this.logMessage(context);
    
    // Execute middleware chain
    await this.executeMiddleware(context);
    
    // Find handlers
    const handlers = this.handlers.get(type) || [];
    
    if (handlers.length === 0) {
      // Try wildcard handlers
      const wildcards = this.handlers.get('*') || [];
      if (wildcards.length === 0) {
        throw new Error(`No handler registered for event type: ${type}`);
      }
      handlers.push(...wildcards);
    }
    
    // Execute handlers
    const results = [];
    for (const { handler, config } of handlers) {
      try {
        let result;
        
        if (config.async) {
          result = await handler(payload, context, this.sw);
        } else {
          result = handler(payload, context, this.sw);
        }
        
        results.push(result);
        
        // Remove once handlers
        if (config.once) {
          this.off(type, handler);
        }
        
        // Stop propagation if handler returns false
        if (result === false) break;
        
      } catch (error) {
        console.error(`[EventRouter] Handler error for ${type}:`, error);
        throw error;
      }
    }
    
    return results.length === 1 ? results[0] : results;
  }

  /**
   * Execute middleware chain
   */
  async executeMiddleware(context) {
    const compose = (middlewares) => {
      return async (ctx) => {
        let index = -1;
        
        const dispatch = async (i) => {
          if (i <= index) throw new Error('next() called multiple times');
          index = i;
          
          const fn = middlewares[i];
          if (!fn) return;
          
          await fn(ctx, () => dispatch(i + 1));
        };
        
        await dispatch(0);
      };
    };
    
    await compose(this.middleware)(context);
  }

  /**
   * Create a dedicated communication channel
   */
  createChannel(channelId, options = {}) {
    const channel = {
      id: channelId,
      port: null,
      listeners: new Set(),
      options: {
        persistent: false,
        buffered: false,
        ...options
      },
      buffer: [],
      connected: false
    };
    
    this.channels.set(channelId, channel);
    return {
      send: (data) => this.channelSend(channelId, data),
      onMessage: (callback) => this.channelListen(channelId, callback),
      close: () => this.closeChannel(channelId),
      id: channelId
    };
  }

  /**
   * Connect a port to a channel (for long-lived connections)
   */
  connectChannel(channelId, port) {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    
    channel.port = port;
    channel.connected = true;
    
    port.onMessage.addListener((message) => {
      channel.listeners.forEach(listener => {
        try {
          listener(message, port);
        } catch (error) {
          console.error(`[EventRouter] Channel listener error:`, error);
        }
      });
    });
    
    port.onDisconnect.addListener(() => {
      channel.connected = false;
      channel.port = null;
      if (!channel.options.persistent) {
        this.closeChannel(channelId);
      }
    });
    
    // Flush buffer if exists
    if (channel.buffer.length > 0) {
      channel.buffer.forEach(msg => port.postMessage(msg));
      channel.buffer = [];
    }
    
    return true;
  }

  /**
   * Send message through channel
   */
  channelSend(channelId, data) {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    
    const message = {
      ...data,
      _channelId: channelId,
      _timestamp: Date.now()
    };
    
    if (channel.connected && channel.port) {
      channel.port.postMessage(message);
      return true;
    } else if (channel.options.buffered) {
      channel.buffer.push(message);
      return true;
    }
    
    return false;
  }

  /**
   * Listen to channel messages
   */
  channelListen(channelId, callback) {
    const channel = this.channels.get(channelId);
    if (!channel) return () => {};
    
    channel.listeners.add(callback);
    return () => channel.listeners.delete(callback);
  }

  /**
   * Close and cleanup channel
   */
  closeChannel(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    
    if (channel.port) {
      channel.port.disconnect();
    }
    
    channel.listeners.clear();
    this.channels.delete(channelId);
  }

  /**
   * Request-response pattern with timeout
   */
  async request(target, type, payload, timeout = 30000) {
    const requestId = this.generateMessageId();
    
    return new Promise((resolve, reject) => {
      // Setup timeout
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Request timeout: ${type} to ${target}`));
      }, timeout);
      
      // Store pending response handler
      this.pendingResponses.set(requestId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timestamp: Date.now()
      });
      
      // Send request
      const message = {
        type: 'REQUEST',
        requestType: type,
        requestId,
        payload,
        replyTo: 'background'
      };
      
      this.sendToTarget(target, message).catch(error => {
        this.pendingResponses.delete(requestId);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /**
   * Handle incoming response
   */
  handleResponse(requestId, success, data) {
    const pending = this.pendingResponses.get(requestId);
    if (!pending) {
      console.warn(`[EventRouter] Unknown response for request: ${requestId}`);
      return;
    }
    
    this.pendingResponses.delete(requestId);
    
    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(data));
    }
  }

  /**
   * Send message to specific target component
   */
  async sendToTarget(target, message) {
    switch (target) {
      case this.components.CONTENT:
        return this.broadcastToContent(message);
        
      case this.components.OFFSCREEN:
        return this.sendToOffscreen(message);
        
      case this.components.POPUP:
        return this.sendToPopup(message);
        
      case this.components.OPTIONS:
        return this.sendToOptions(message);
        
      case this.components.OVERLAY:
        return this.broadcastToOverlays(message);
        
      case this.components.NATIVE:
        return this.sendToNative(message);
        
      case this.components.BACKGROUND:
        // Internal routing
        return this.route(message.type, message.payload, { id: 'internal' });
        
      default:
        throw new Error(`Unknown target: ${target}`);
    }
  }

  /**
   * Broadcast to all content scripts
   */
  async broadcastToContent(message, filter = {}) {
    const tabs = await chrome.tabs.query({ 
      active: filter.activeOnly ? true : undefined,
      url: filter.urlPattern || ['*://*/*manga*', '*://*/*manhwa*', '*://mangadex.org/*']
    });
    
    const results = [];
    for (const tab of tabs) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          ...message,
          _broadcast: true,
          _targetTab: tab.id
        });
        results.push({ tabId: tab.id, success: true, data: result });
      } catch (error) {
        results.push({ tabId: tab.id, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Send to offscreen document
   */
  async sendToOffscreen(message) {
    // Ensure offscreen exists
    await this.sw.ensureOffscreenDocument();
    
    return chrome.runtime.sendMessage({
      ...message,
      target: 'offscreen'
    });
  }

  /**
   * Send to popup (if open)
   */
  async sendToPopup(message) {
    try {
      return chrome.runtime.sendMessage({
        ...message,
        target: 'popup'
      });
    } catch (error) {
      // Popup likely closed
      return { error: 'Popup not available', closed: true };
    }
  }

  /**
   * Send to options page
   */
  async sendToOptions(message) {
    const optionsUrl = chrome.runtime.getURL('ui/options/options.html');
    const tabs = await chrome.tabs.query({ url: `${optionsUrl}*` });
    
    if (tabs.length === 0) {
      return { error: 'Options page not open' };
    }
    
    return chrome.tabs.sendMessage(tabs[0].id, {
      ...message,
      target: 'options'
    });
  }

  /**
   * Broadcast to overlay components
   */
  async broadcastToOverlays(message) {
    // Send to all overlay frames in active manga tabs
    const results = [];
    for (const tabId of this.sw.activeMangaTabs) {
      try {
        // Send to sharingan float
        await chrome.tabs.sendMessage(tabId, {
          ...message,
          target: 'sharingan-float',
          _overlay: true
        });
        
        // Send to madara overlay if active
        await chrome.tabs.sendMessage(tabId, {
          ...message,
          target: 'madara-active',
          _overlay: true
        });
        
        results.push({ tabId, success: true });
      } catch (error) {
        results.push({ tabId, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Send to native messaging host
   */
  async sendToNative(message) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative('com.mangekyo.native');
      
      port.onMessage.addListener((response) => {
        resolve(response);
        port.disconnect();
      });
      
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });
      
      port.postMessage(message);
    });
  }

  /**
   * Setup long-lived port connections
   */
  setupPortListener() {
    chrome.runtime.onConnect.addListener((port) => {
      const { name } = port;
      
      // Route to appropriate channel
      if (name.startsWith('channel:')) {
        const channelId = name.replace('channel:', '');
        this.connectChannel(channelId, port);
        return;
      }
      
      // Handle component-specific ports
      switch (name) {
        case 'content-script':
          this.handleContentPort(port);
          break;
          
        case 'offscreen':
          this.handleOffscreenPort(port);
          break;
          
        case 'popup':
          this.handlePopupPort(port);
          break;
          
        case 'overlay':
          this.handleOverlayPort(port);
          break;
      }
    });
  }

  /**
   * Handle content script port connections
   */
  handleContentPort(port) {
    const tabId = port.sender?.tab?.id;
    if (!tabId) return;
    
    port.onMessage.addListener(async (message) => {
      try {
        const result = await this.route(message.type, message.payload, port.sender);
        if (message._requestId) {
          port.postMessage({
            type: 'RESPONSE',
            requestId: message._requestId,
            success: true,
            data: result
          });
        }
      } catch (error) {
        if (message._requestId) {
          port.postMessage({
            type: 'RESPONSE',
            requestId: message._requestId,
            success: false,
            error: error.message
          });
        }
      }
    });
    
    port.onDisconnect.addListener(() => {
      // Cleanup tab-specific resources
      this.sw.activeMangaTabs.delete(tabId);
    });
  }

  /**
   * Handle offscreen document port
   */
  handleOffscreenPort(port) {
    port.onMessage.addListener(async (message) => {
      if (message.type === 'OCR_PROGRESS') {
        // Broadcast progress to relevant tab
        this.broadcastToContent({
          type: 'OCR_PROGRESS_UPDATE',
          progress: message.progress,
          requestId: message.requestId
        }, { tabIds: [message.tabId] });
      }
    });
  }

  /**
   * Handle popup port
   */
  handlePopupPort(port) {
    port.onMessage.addListener(async (message) => {
      const result = await this.route(message.type, message.payload, port.sender);
      port.postMessage({ type: 'POPUP_RESPONSE', data: result });
    });
  }

  /**
   * Handle overlay port
   */
  handleOverlayPort(port) {
    port.onMessage.addListener(async (message) => {
      // Overlay messages often need immediate response for UI updates
      const result = await this.route(message.type, message.payload, port.sender);
      port.postMessage({ type: 'OVERLAY_RESPONSE', data: result });
    });
  }

  /**
   * Event emitter pattern for internal use
   */
  emit(eventType, data) {
    return this.route(eventType, data, { id: 'internal', internal: true });
  }

  /**
   * One-time event listener
   */
  once(eventType, handler) {
    return this.on(eventType, handler, { once: true });
  }

  /**
   * Wait for specific event
   */
  waitFor(eventType, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(eventType, handler);
        reject(new Error(`Timeout waiting for ${eventType}`));
      }, timeout);
      
      const handler = (data) => {
        clearTimeout(timer);
        resolve(data);
        return false; // Stop propagation
      };
      
      this.once(eventType, handler);
    });
  }

  /**
   * Batch process multiple messages
   */
  async batch(messages, options = {}) {
    const { sequential = false, stopOnError = true } = options;
    
    const results = [];
    
    if (sequential) {
      for (const msg of messages) {
        try {
          const result = await this.route(msg.type, msg.payload, msg.sender);
          results.push({ success: true, data: result });
        } catch (error) {
          results.push({ success: false, error: error.message });
          if (stopOnError) break;
        }
      }
    } else {
      const promises = messages.map(msg => 
        this.route(msg.type, msg.payload, msg.sender)
          .then(data => ({ success: true, data }))
          .catch(error => ({ success: false, error: error.message }))
      );
      
      results.push(...await Promise.all(promises));
    }
    
    return results;
  }

  /**
   * Utility: Generate unique message ID
   */
  generateMessageId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Utility: Detect component type from sender
   */
  detectComponent(sender) {
    if (!sender) return this.components.BACKGROUND;
    if (sender.id !== chrome.runtime.id) return 'external';
    if (sender.url?.includes('offscreen')) return this.components.OFFSCREEN;
    if (sender.url?.includes('popup')) return this.components.POPUP;
    if (sender.url?.includes('options')) return this.components.OPTIONS;
    if (sender.frameId && sender.frameId > 0) return this.components.OVERLAY;
    return this.components.CONTENT;
  }

  /**
   * Utility: Simple rate limiter
   */
  getRateLimiter(key) {
    if (!this._rateLimiters) this._rateLimiters = new Map();
    
    if (!this._rateLimiters.has(key)) {
      this._rateLimiters.set(key, {
        count: 0,
        resetTime: Date.now() + 60000, // 1 minute window
        allow() {
          const now = Date.now();
          if (now > this.resetTime) {
            this.count = 0;
            this.resetTime = now + 60000;
          }
          this.count++;
          return this.count <= 100; // 100 requests per minute
        }
      });
    }
    
    return this._rateLimiters.get(key);
  }

  /**
   * Log message to history
   */
  logMessage(context) {
    this.messageHistory.push({
      ...context,
      _logged: true
    });
    
    if (this.messageHistory.length > this.MAX_HISTORY) {
      this.messageHistory.shift();
    }
  }

  /**
   * Get message history for debugging
   */
  getHistory(filter = {}) {
    let history = this.messageHistory;
    
    if (filter.type) {
      history = history.filter(h => h.type === filter.type);
    }
    if (filter.component) {
      history = history.filter(h => h.component === filter.component);
    }
    if (filter.since) {
      history = history.filter(h => h.timestamp > filter.since);
    }
    
    return history;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Close all channels
    this.channels.forEach((channel, id) => {
      this.closeChannel(id);
    });
    
    // Clear pending responses
    this.pendingResponses.forEach((pending, id) => {
      pending.reject(new Error('Router cleanup'));
    });
    this.pendingResponses.clear();
    
    // Clear handlers
    this.handlers.clear();
    this.middleware = [];
    this.messageHistory = [];
  }
}

// Export factory function for service worker integration
export function createEventRouter(serviceWorker) {
  const router = new EventRouter(serviceWorker);
  router.setupPortListener();
  return router;
}

export { EventRouter };