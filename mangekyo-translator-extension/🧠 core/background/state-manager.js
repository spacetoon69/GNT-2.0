/**
 * Mangekyo Extension - State Manager
 * Centralized state management with persistence, sync, and reactive updates
 * Implements Redux-like pattern with Chrome storage integration
 * @version 2.0.0
 */

import { SecureStorage } from '../privacy/encryption/secure-storage.js';
import { CONFIG } from '../shared/constants.js';

class StateManager {
  constructor() {
    // In-memory state cache
    this.state = new Map();
    
    // Subscribers for reactive updates
    this.subscribers = new Map();
    
    // Storage backends
    this.storage = {
      local: chrome.storage.local,
      sync: chrome.storage.sync,
      session: chrome.storage.session, // MV3 only
      secure: SecureStorage
    };
    
    // State schemas for validation
    this.schemas = new Map();
    
    // Migration handlers
    this.migrations = new Map();
    
    // Current version
    this.VERSION = '2.0.0';
    
    // Initialize default schemas
    this.initializeSchemas();
    
    // Setup storage change listeners
    this.setupStorageListeners();
  }

  /**
   * Initialize state schemas with defaults and validators
   */
  initializeSchemas() {
    // Extension settings
    this.registerSchema('settings', {
      defaults: {
        translation: {
          engine: 'google',
          targetLanguage: 'en',
          sourceLanguage: 'auto',
          honorifics: true,
          preserveFormatting: true,
          autoTranslate: false,
          confidenceThreshold: 0.7
        },
        ocr: {
          engine: 'tesseract',
          preprocess: true,
          language: 'jpn',
          psm: 6, // Page segmentation mode
          oem: 3  // OCR engine mode
        },
        overlay: {
          theme: 'madara',
          opacity: 0.95,
          fontSize: 14,
          fontFamily: 'Noto Sans JP',
          position: 'auto',
          duration: 5000
        },
        security: {
          licenseKey: null,
          hardwareBound: true,
          obfuscation: true
        },
        privacy: {
          analytics: false,
          crashReports: true,
          cacheDuration: 7 * 24 * 60 * 60 * 1000 // 7 days
        },
        hotkeys: {
          toggle: 'Alt+T',
          capture: 'Alt+C',
          settings: 'Alt+S'
        }
      },
      validator: (data) => {
        if (data.translation?.confidenceThreshold < 0 || data.translation?.confidenceThreshold > 1) {
          throw new Error('Confidence threshold must be between 0 and 1');
        }
        return true;
      },
      storage: 'sync' // Sync across devices
    });

    // Session state (not persisted)
    this.registerSchema('session', {
      defaults: {
        activeTabs: new Set(),
        currentEngine: null,
        lastScreenshot: null,
        translationQueue: [],
        isProcessing: false,
        uiState: {
          sharinganVisible: false,
          emsActive: false,
          settingsOpen: false
        }
      },
      validator: () => true,
      storage: 'session'
    });

    // Translation cache
    this.registerSchema('cache', {
      defaults: {
        translations: new Map(),
        images: new Map(),
        lastCleanup: Date.now()
      },
      validator: () => true,
      storage: 'local'
    });

    // User statistics
    this.registerSchema('stats', {
      defaults: {
        totalTranslations: 0,
        totalCharacters: 0,
        favoriteEngines: {},
        accuracyRatings: [],
        sessionCount: 0,
        totalSessionTime: 0,
        lastSession: null
      },
      validator: () => true,
      storage: 'local'
    });

    // License info (secure storage)
    this.registerSchema('license', {
      defaults: {
        key: null,
        validated: false,
        expiresAt: null,
        features: [],
        hardwareId: null
      },
      validator: (data) => {
        if (data.key && !/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.key)) {
          throw new Error('Invalid license key format');
        }
        return true;
      },
      storage: 'secure'
    });

    // Manga site preferences
    this.registerSchema('sitePrefs', {
      defaults: {},
      validator: () => true,
      storage: 'sync'
    });
  }

  /**
   * Register a state schema
   */
  registerSchema(key, schema) {
    this.schemas.set(key, {
      defaults: schema.defaults,
      validator: schema.validator || (() => true),
      storage: schema.storage || 'local',
      version: schema.version || 1
    });
  }

  /**
   * Initialize state from storage
   */
  async initialize() {
    console.log('[StateManager] Initializing...');
    
    for (const [key, schema] of this.schemas) {
      try {
        // Load from appropriate storage
        const data = await this.loadFromStorage(key, schema.storage);
        
        // Merge with defaults (deep merge)
        const merged = this.deepMerge(schema.defaults, data || {});
        
        // Validate
        schema.validator(merged);
        
        // Set in memory
        this.state.set(key, merged);
        
        // Notify subscribers
        this.notify(key, merged, 'init');
        
      } catch (error) {
        console.error(`[StateManager] Failed to load ${key}:`, error);
        // Fall back to defaults
        this.state.set(key, this.clone(schema.defaults));
      }
    }
    
    console.log('[StateManager] Initialized with', this.state.size, 'state keys');
  }

  /**
   * Get state value (supports nested paths)
   */
  get(key, path = null, defaultValue = undefined) {
    const state = this.state.get(key);
    
    if (!state) return defaultValue;
    if (!path) return this.clone(state);
    
    // Navigate path
    const parts = path.split('.');
    let current = state;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      current = current[part];
    }
    
    return this.clone(current);
  }

  /**
   * Set state value (supports nested paths)
   */
  async set(key, valueOrPath, valueOrOptions = {}, options = {}) {
    let path, value, opts;
    
    // Handle overloads: set(key, value) or set(key, path, value)
    if (typeof valueOrPath === 'string' && arguments.length >= 3) {
      path = valueOrPath;
      value = valueOrOptions;
      opts = options;
    } else {
      path = null;
      value = valueOrPath;
      opts = valueOrOptions || {};
    }
    
    const { 
      persist = true, 
      sync = true,
      validate = true,
      notify = true 
    } = opts;
    
    const schema = this.schemas.get(key);
    if (!schema) {
      throw new Error(`Unknown state key: ${key}`);
    }
    
    // Get current state
    let current = this.state.get(key) || this.clone(schema.defaults);
    let newValue;
    
    if (path) {
      // Set nested value
      const parts = path.split('.');
      const last = parts.pop();
      let target = current;
      
      for (const part of parts) {
        if (!(part in target) || typeof target[part] !== 'object') {
          target[part] = {};
        }
        target = target[part];
      }
      
      const oldValue = target[last];
      target[last] = value;
      newValue = current;
      
      // Track change details
      var changeInfo = { path, oldValue, newValue: value };
    } else {
      // Replace entire state
      var oldState = current;
      newValue = typeof value === 'function' ? value(current) : value;
      changeInfo = { path: null, oldValue: oldState, newValue };
    }
    
    // Validate
    if (validate) {
      try {
        schema.validator(newValue);
      } catch (error) {
        throw new Error(`Validation failed for ${key}: ${error.message}`);
      }
    }
    
    // Update memory
    this.state.set(key, this.clone(newValue));
    
    // Persist to storage
    if (persist) {
      await this.saveToStorage(key, newValue, schema.storage);
    }
    
    // Sync across contexts (broadcast to other extension pages)
    if (sync && schema.storage !== 'session') {
      this.broadcastChange(key, path, value);
    }
    
    // Notify subscribers
    if (notify) {
      this.notify(key, newValue, 'update', changeInfo);
    }
    
    return newValue;
  }

  /**
   * Update multiple keys atomically
   */
  async batch(updates) {
    const results = [];
    
    // Validate all first
    for (const { key, value, path } of updates) {
      const schema = this.schemas.get(key);
      if (!schema) throw new Error(`Unknown state key: ${key}`);
      
      let testValue = this.state.get(key) || schema.defaults;
      if (path) {
        testValue = this.setInPath(testValue, path, value, true); // dry run
      } else {
        testValue = value;
      }
      
      schema.validator(testValue);
    }
    
    // Apply all
    for (const update of updates) {
      results.push(await this.set(update.key, update.path || update.value, update.value || {}));
    }
    
    return results;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(key, callback, options = {}) {
    const { path = null, immediate = false } = options;
    
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Map());
    }
    
    const subscriptionId = this.generateId();
    const subscriber = { callback, path, id: subscriptionId };
    
    this.subscribers.get(key).set(subscriptionId, subscriber);
    
    // Immediate callback with current value
    if (immediate) {
      const current = this.get(key, path);
      callback(current, { type: 'immediate', key, path });
    }
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.delete(subscriptionId);
        if (subs.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Notify subscribers of state change
   */
  notify(key, value, type, changeInfo = {}) {
    const subs = this.subscribers.get(key);
    if (!subs) return;
    
    for (const [id, subscriber] of subs) {
      // Check path filter
      if (subscriber.path && changeInfo.path) {
        if (!changeInfo.path.startsWith(subscriber.path)) continue;
      }
      
      try {
        subscriber.callback(this.clone(value), {
          type,
          key,
          ...changeInfo
        });
      } catch (error) {
        console.error(`[StateManager] Subscriber error for ${key}:`, error);
      }
    }
  }

  /**
   * Watch multiple keys
   */
  watch(keys, callback) {
    const unsubs = keys.map(key => 
      this.subscribe(key, (value, info) => {
        callback(key, value, info);
      })
    );
    
    return () => unsubs.forEach(unsub => unsub());
  }

  /**
   * Computed state (derived values)
   */
  computed(dependencies, computeFn) {
    let cachedValue;
    let dirty = true;
    
    // Subscribe to all dependencies
    const unsubs = dependencies.map(dep => 
      this.subscribe(dep, () => {
        dirty = true;
      })
    );
    
    return {
      get: () => {
        if (dirty) {
          const values = dependencies.map(key => this.get(key));
          cachedValue = computeFn(...values);
          dirty = false;
        }
        return cachedValue;
      },
      dispose: () => unsubs.forEach(unsub => unsub())
    };
  }

  /**
   * Storage operations
   */
  async loadFromStorage(key, storageType) {
    const storage = this.storage[storageType];
    if (!storage) return null;
    
    try {
      const result = await storage.get(key);
      return result[key];
    } catch (error) {
      console.error(`[StateManager] Storage read error for ${key}:`, error);
      return null;
    }
  }

  async saveToStorage(key, value, storageType) {
    const storage = this.storage[storageType];
    if (!storage) return;
    
    try {
      // Special handling for complex types
      const serialized = this.serializeForStorage(value);
      await storage.set({ [key]: serialized });
    } catch (error) {
      console.error(`[StateManager] Storage write error for ${key}:`, error);
      throw error;
    }
  }

  /**
   * Serialize special types for storage
   */
  serializeForStorage(value) {
    if (value instanceof Set) {
      return { __type: 'Set', data: Array.from(value) };
    }
    if (value instanceof Map) {
      return { __type: 'Map', data: Array.from(value.entries()) };
    }
    if (value instanceof Date) {
      return { __type: 'Date', data: value.toISOString() };
    }
    return value;
  }

  /**
   * Deserialize special types from storage
   */
  deserializeFromStorage(value) {
    if (value && typeof value === 'object') {
      if (value.__type === 'Set') return new Set(value.data);
      if (value.__type === 'Map') return new Map(value.data);
      if (value.__type === 'Date') return new Date(value.data);
      
      // Recurse into objects
      const result = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.deserializeFromStorage(v);
      }
      return result;
    }
    return value;
  }

  /**
   * Setup cross-context synchronization
   */
  setupStorageListeners() {
    // Listen for changes from other extension contexts
    chrome.storage.onChanged.addListener((changes, areaName) => {
      for (const [key, change] of Object.entries(changes)) {
        if (!this.schemas.has(key)) continue;
        
        const schema = this.schemas.get(key);
        if (schema.storage !== areaName) continue;
        
        // Update local cache if different
        const newValue = this.deserializeFromStorage(change.newValue);
        const current = this.state.get(key);
        
        if (!this.deepEqual(current, newValue)) {
          this.state.set(key, this.clone(newValue));
          this.notify(key, newValue, 'external', {
            oldValue: change.oldValue
          });
        }
      }
    });
  }

  /**
   * Broadcast change to other contexts
   */
  broadcastChange(key, path, value) {
    // Use runtime messaging for immediate sync
    chrome.runtime.sendMessage({
      type: 'STATE_CHANGE',
      key,
      path,
      timestamp: Date.now()
    }).catch(() => {}); // Ignore errors (no listeners)
  }

  /**
   * Reset state to defaults
   */
  async reset(key = null) {
    if (key) {
      const schema = this.schemas.get(key);
      if (!schema) throw new Error(`Unknown state key: ${key}`);
      
      await this.set(key, this.clone(schema.defaults), { validate: false });
    } else {
      // Reset all
      for (const [k, schema] of this.schemas) {
        await this.set(k, this.clone(schema.defaults), { validate: false });
      }
    }
  }

  /**
   * Export state (for backup)
   */
  export(keys = null) {
    const exportKeys = keys || Array.from(this.schemas.keys());
    const exportData = {
      version: this.VERSION,
      timestamp: Date.now(),
      data: {}
    };
    
    for (const key of exportKeys) {
      if (this.schemas.get(key)?.storage === 'secure') continue; // Don't export secure data
      exportData.data[key] = this.get(key);
    }
    
    return exportData;
  }

  /**
   * Import state (from backup)
   */
  async import(exportData, options = {}) {
    const { merge = false, validate = true } = options;
    
    if (exportData.version !== this.VERSION) {
      // Run migrations if needed
      exportData = await this.migrate(exportData);
    }
    
    for (const [key, value] of Object.entries(exportData.data)) {
      if (!this.schemas.has(key)) continue;
      
      if (merge) {
        const current = this.get(key) || {};
        await this.set(key, this.deepMerge(current, value), { validate });
      } else {
        await this.set(key, value, { validate });
      }
    }
  }

  /**
   * State migrations
   */
  async migrate(data) {
    // Implementation for version migrations
    return data;
  }

  /**
   * Transaction support (atomic updates)
   */
  transaction(fn) {
    const backup = new Map(this.state);
    
    try {
      const result = fn({
        get: (k, p) => this.get(k, p),
        set: (k, v, o) => {
          // Queue for batch commit
          if (!this._transactionQueue) this._transactionQueue = [];
          this._transactionQueue.push({ key: k, value: v, opts: o });
        }
      });
      
      // Commit all
      if (this._transactionQueue) {
        return this.batch(this._transactionQueue).finally(() => {
          delete this._transactionQueue;
        });
      }
      
      return result;
      
    } catch (error) {
      // Rollback
      this.state = backup;
      throw error;
    }
  }

  /**
   * Utility: Deep merge objects
   */
  deepMerge(target, source) {
    if (!source) return target;
    if (!target) return source;
    
    const result = this.clone(target);
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Utility: Deep clone
   */
  clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Set) return new Set(obj);
    if (obj instanceof Map) return new Map(obj);
    if (Array.isArray(obj)) return obj.map(item => this.clone(item));
    
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.clone(obj[key]);
      }
    }
    return cloned;
  }

  /**
   * Utility: Deep equality check
   */
  deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;
    
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    
    if (keysA.length !== keysB.length) return false;
    
    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!this.deepEqual(a[key], b[key])) return false;
    }
    
    return true;
  }

  /**
   * Utility: Set value at path (for nested updates)
   */
  setInPath(obj, path, value, dryRun = false) {
    const parts = path.split('.');
    const last = parts.pop();
    let current = dryRun ? this.clone(obj) : obj;
    let target = current;
    
    for (const part of parts) {
      if (!(part in target)) target[part] = {};
      target = target[part];
    }
    
    target[last] = value;
    return current;
  }

  /**
   * Utility: Generate unique ID
   */
  generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all state (for debugging)
   */
  getAll() {
    const all = {};
    for (const [key, value] of this.state) {
      all[key] = this.clone(value);
    }
    return all;
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.subscribers.clear();
    this.state.clear();
  }
}

// Reactive helper for UI components
class ReactiveState {
  constructor(stateManager, key, path = null) {
    this.sm = stateManager;
    this.key = key;
    this.path = path;
    this.listeners = new Set();
    this.unsubscribe = null;
    
    this.connect();
  }
  
  connect() {
    this.unsubscribe = this.sm.subscribe(this.key, (value) => {
      const actual = this.path ? this.getPathValue(value, this.path) : value;
      this.listeners.forEach(cb => cb(actual));
    }, { immediate: true });
  }
  
  getPathValue(obj, path) {
    return path.split('.').reduce((o, p) => o?.[p], obj);
  }
  
  get() {
    return this.sm.get(this.key, this.path);
  }
  
  set(value) {
    return this.sm.set(this.key, this.path || value, this.path ? value : {});
  }
  
  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners.clear();
  }
}

export { StateManager, ReactiveState };