/**
 * @fileoverview Tamper Detection System - Mangekyo Security Layer
 * Runtime integrity monitoring, code tampering detection, and self-defense mechanisms
 * @module security/integrity/tamper-detection
 * @version 1.0.0
 */

'use strict';

import checksums from './checksums.json' assert { type: 'json' };

/**
 * Runtime tamper detection and integrity verification system
 * Monitors code integrity, detects debugging attempts, and responds to threats
 */
class TamperDetection {
  constructor() {
    this.version = '1.0.0';
    this.checksums = checksums;
    this.verifiedHashes = new Map();
    this.tamperAttempts = 0;
    this.maxAttempts = 3;
    this.isCompromised = false;
    
    // Detection thresholds
    this.thresholds = {
      checksumMismatch: 1,
      debuggerDetected: 2,
      codeMutation: 1,
      timingAnomaly: 3,
      memoryTampering: 1
    };
    
    // Security responses
    this.responses = {
      LOG: 'log',
      ALERT: 'alert',
      DEGRADE: 'degrade',
      SHUTDOWN: 'shutdown',
      SELF_DESTRUCT: 'self_destruct'
    };
    
    this.init();
  }

  /**
   * Initialize tamper detection systems
   * @private
   */
  init() {
    this._setupDebuggerDetection();
    this._setupCodeIntegrityChecks();
    this._setupTimingChecks();
    this._setupMemoryProtection();
    this._startMonitoringLoop();
    
    // Self-verify on load
    this._selfVerify();
  }

  /**
   * Verify file integrity against stored checksums
   * @param {string} filePath - Relative path to file
   * @param {string} currentHash - Computed SHA-256 hash
   * @returns {boolean}
   */
  verifyIntegrity(filePath, currentHash) {
    const expected = this._getExpectedHash(filePath);
    
    if (!expected) {
      this._handleTamper('UNKNOWN_FILE', { file: filePath }, this.responses.LOG);
      return false;
    }
    
    const match = expected.hash === currentHash;
    
    if (!match) {
      this._handleTamper('CHECKSUM_MISMATCH', {
        file: filePath,
        expected: expected.hash,
        actual: currentHash,
        critical: expected.critical
      }, expected.critical ? this.responses.SHUTDOWN : this.responses.ALERT);
    } else {
      this.verifiedHashes.set(filePath, {
        hash: currentHash,
        timestamp: Date.now(),
        verified: true
      });
    }
    
    return match;
  }

  /**
   * Batch verify multiple files
   * @param {Array<{path: string, hash: string}>} files 
   * @returns {Object}
   */
  verifyBatch(files) {
    const results = {
      passed: [],
      failed: [],
      critical: [],
      timestamp: Date.now()
    };
    
    for (const { path, hash } of files) {
      const isValid = this.verifyIntegrity(path, hash);
      const fileInfo = this._getExpectedHash(path);
      
      if (isValid) {
        results.passed.push(path);
      } else {
        results.failed.push(path);
        if (fileInfo?.critical) {
          results.critical.push(path);
        }
      }
    }
    
    // Auto-shutdown if critical files compromised
    if (results.critical.length > 0 && checksums.verification.shutdownOnCritical) {
      this._executeShutdown('CRITICAL_FILES_COMPROMISED', results.critical);
    }
    
    return results;
  }

  /**
   * Compute SHA-256 hash of code string
   * @param {string} code 
   * @returns {Promise<string>}
   */
  async computeHash(code) {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Setup debugger detection traps
   * @private
   */
  _setupDebuggerDetection() {
    // DevTools detection via timing
    const checkDevTools = () => {
      const start = performance.now();
      debugger; // eslint-disable-line no-debugger
      const end = performance.now();
      
      if (end - start > 100) {
        this._handleTamper('DEBUGGER_DETECTED', {
          method: 'timing',
          delay: end - start
        }, this.responses.DEGRADE);
      }
    };

    // Console function proxy detection
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug
    };

    ['log', 'warn', 'error', 'debug'].forEach(method => {
      Object.defineProperty(console, method, {
        get: () => {
          this._handleTamper('CONSOLE_ACCESS', { method }, this.responses.LOG);
          return originalConsole[method];
        },
        set: () => {
          this._handleTamper('CONSOLE_OVERRIDE', { method }, this.responses.ALERT);
        }
      });
    });

    // Periodic checks
    setInterval(checkDevTools, 2000);
    
    // Function constructor monitoring
    const originalFunction = window.Function;
    window.Function = new Proxy(originalFunction, {
      construct(target, args) {
        const code = args.join('');
        if (code.includes('debugger') || code.includes('chrome')) {
          this._handleTamper('SUSPICIOUS_CODE_EXECUTION', { code: code.slice(0, 50) }, this.responses.SHUTDOWN);
        }
        return new target(...args);
      }
    });
  }

  /**
   * Setup code integrity monitoring
   * @private
   */
  _setupCodeIntegrityChecks() {
    // Store original function signatures
    this._originalSignatures = this._captureSignatures();
    
    // MutationObserver for DOM script changes
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.tagName === 'SCRIPT') {
              this._handleTamper('SCRIPT_INJECTION', {
                src: node.src,
                inline: !node.src
              }, this.responses.ALERT);
            }
          });
        });
      });
      
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    // Proxy sensitive APIs
    this._proxySensitiveAPIs();
  }

  /**
   * Capture function signatures for integrity comparison
   * @private
   * @returns {Map}
   */
  _captureSignatures() {
    const signatures = new Map();
    const criticalObjects = [chrome, window, document, console];
    
    criticalObjects.forEach(obj => {
      if (!obj) return;
      const props = Object.getOwnPropertyNames(obj);
      props.forEach(prop => {
        try {
          const value = obj[prop];
          if (typeof value === 'function') {
            signatures.set(`${obj.constructor.name}.${prop}`, value.toString().length);
          }
        } catch (e) {
          // Skip inaccessible properties
        }
      });
    });
    
    return signatures;
  }

  /**
   * Verify function signatures haven't changed
   * @returns {boolean}
   */
  verifySignatures() {
    const current = this._captureSignatures();
    let tampered = false;
    
    for (const [key, originalLength] of this._originalSignatures) {
      const currentLength = current.get(key);
      if (currentLength && currentLength !== originalLength) {
        tampered = true;
        this._handleTamper('FUNCTION_TAMPERING', { function: key }, this.responses.SHUTDOWN);
      }
    }
    
    return !tampered;
  }

  /**
   * Setup timing-based anomaly detection
   * @private
   */
  _setupTimingChecks() {
    let lastCheck = performance.now();
    
    setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastCheck;
      const expected = 5000; // 5 second interval
      
      // Detect time manipulation (debugging breakpoints)
      if (elapsed > expected * 2) {
        this._handleTamper('TIMING_ANOMALY', {
          expected: expected,
          actual: elapsed
        }, this.responses.DEGRADE);
      }
      
      lastCheck = now;
    }, 5000);
  }

  /**
   * Setup memory protection mechanisms
   * @private
   */
  _setupMemoryProtection() {
    // Seal critical configuration
    if (this.checksums) {
      Object.freeze(this.checksums);
      Object.seal(this.checksums);
    }
    
    // Protect own methods from override
    const methods = Object.getOwnPropertyNames(TamperDetection.prototype);
    methods.forEach(method => {
      if (typeof this[method] === 'function') {
        Object.defineProperty(this, method, {
          writable: false,
          configurable: false
        });
      }
    });
  }

  /**
   * Proxy sensitive Chrome APIs to detect unauthorized access
   * @private
   */
  _proxySensitiveAPIs() {
    if (typeof chrome === 'undefined') return;
    
    // Protect storage APIs
    const protectAPI = (apiPath, api) => {
      return new Proxy(api, {
        get: (target, prop) => {
          const value = target[prop];
          
          // Log sensitive operations
          if (['set', 'remove', 'clear', 'get'].includes(prop)) {
            this._logAccess(apiPath, prop);
          }
          
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set: () => {
          this._handleTamper('API_OVERRIDE', { api: apiPath }, this.responses.SHUTDOWN);
          return false;
        }
      });
    };

    // Apply protection
    if (chrome.storage?.local) {
      chrome.storage.local = protectAPI('storage.local', chrome.storage.local);
    }
    if (chrome.storage?.sync) {
      chrome.storage.sync = protectAPI('storage.sync', chrome.storage.sync);
    }
  }

  /**
   * Start continuous monitoring loop
   * @private
   */
  _startMonitoringLoop() {
    const interval = checksums.verification.scanInterval || 300000; // 5 minutes
    
    setInterval(() => {
      // Periodic signature verification
      this.verifySignatures();
      
      // Check for code mutations
      this._checkCodeMutations();
      
      // Verify critical file hashes
      this._verifyCriticalFiles();
      
    }, interval);
  }

  /**
   * Check for code mutations in runtime
   * @private
   */
  _checkCodeMutations() {
    const currentScripts = document.querySelectorAll('script');
    currentScripts.forEach(script => {
      if (script.dataset.verified !== 'true' && script.textContent) {
        const hash = this.computeHash(script.textContent);
        // Compare against known good hashes
        // Implementation depends on build-time hash injection
      }
    });
  }

  /**
   * Verify all critical files
   * @private
   */
  async _verifyCriticalFiles() {
    const criticalFiles = this._getCriticalFiles();
    
    for (const file of criticalFiles) {
      try {
        const response = await fetch(chrome.runtime.getURL(file));
        const code = await response.text();
        const hash = await this.computeHash(code);
        
        this.verifyIntegrity(file, hash);
      } catch (error) {
        this._handleTamper('FILE_ACCESS_ERROR', { file, error: error.message }, this.responses.LOG);
      }
    }
  }

  /**
   * Self-verification of tamper detection system
   * @private
   */
  _selfVerify() {
    // Verify own integrity
    const ownCode = TamperDetection.toString();
    // Hash would be injected at build time
    // if (hash !== expected) this._handleTamper('SELF_TAMPER', {}, this.responses.SELF_DESTRUCT);
  }

  /**
   * Handle detected tampering attempt
   * @private
   * @param {string} type - Tamper type
   * @param {Object} details - Event details
   * @param {string} response - Response level
   */
  _handleTamper(type, details, response) {
    this.tamperAttempts++;
    
    const event = {
      type,
      timestamp: Date.now(),
      details,
      response,
      attemptCount: this.tamperAttempts,
      userAgent: navigator.userAgent,
      url: location.href
    };
    
    // Log to secure channel
    this._secureLog(event);
    
    // Execute response
    switch (response) {
      case this.responses.LOG:
        // Silent logging only
        break;
        
      case this.responses.ALERT:
        this._notifyBackground(event);
        break;
        
      case this.responses.DEGRADE:
        this._degradeFunctionality();
        break;
        
      case this.responses.SHUTDOWN:
        this._executeShutdown(type, details);
        break;
        
      case this.responses.SELF_DESTRUCT:
        this._selfDestruct();
        break;
    }
    
    // Auto-escalate if too many attempts
    if (this.tamperAttempts >= this.maxAttempts) {
      this._executeShutdown('MAX_ATTEMPTS_EXCEEDED', event);
    }
  }

  /**
   * Degrade functionality on minor tamper detection
   * @private
   */
  _degradeFunctionality() {
    // Disable premium features
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'SECURITY_DEGRADE',
        reason: 'TAMPER_DETECTED'
      });
    }
    
    // Add visual indicator
    document.documentElement.dataset.securityLevel = 'degraded';
  }

  /**
   * Execute emergency shutdown
   * @private
   * @param {string} reason 
   * @param {Object} details 
   */
  _executeShutdown(reason, details) {
    this.isCompromised = true;
    
    // Notify background script
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'SECURITY_SHUTDOWN',
        reason,
        details,
        timestamp: Date.now()
      });
    }
    
    // Disable extension functionality
    this._disableExtension();
    
    // Clear sensitive data
    this._clearSensitiveData();
    
    // Redirect or freeze
    if (checksums.verification.alertOnMismatch) {
      this._showSecurityWarning();
    }
  }

  /**
   * Self-destruct sequence for critical compromise
   * @private
   */
  _selfDestruct() {
    // Clear all storage
    if (chrome.storage) {
      chrome.storage.local.clear();
      chrome.storage.sync.clear();
    }
    
    // Remove content scripts
    const scripts = document.querySelectorAll('script[data-mangekyo]');
    scripts.forEach(s => s.remove());
    
    // Clear memory references
    Object.keys(this).forEach(key => {
      this[key] = null;
    });
    
    // Freeze execution
    while (true) {
      debugger; // eslint-disable-line no-debugger
    }
  }

  /**
   * Disable extension features
   * @private
   */
  _disableExtension() {
    // Remove event listeners
    // Stop OCR processing
    // Disable translation
    document.documentElement.dataset.mangekyoDisabled = 'true';
  }

  /**
   * Clear sensitive cached data
   * @private
   */
  _clearSensitiveData() {
    // Clear translation cache
    // Remove API keys from memory
    // Clear image cache
    this.verifiedHashes.clear();
  }

  /**
   * Show security warning to user
   * @private
   */
  _showSecurityWarning() {
    const warning = document.createElement('div');
    warning.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:sans-serif;">
        <div style="background:#1a1a1a;border:2px solid #ff3333;padding:40px;border-radius:8px;max-width:500px;text-align:center;color:#fff;">
          <h2 style="color:#ff3333;margin:0 0 20px;">⚠️ Security Alert</h2>
          <p>Mangekyo has detected unauthorized modifications.</p>
          <p style="color:#888;font-size:14px;margin-top:20px;">Extension disabled for your protection.</p>
        </div>
      </div>
    `;
    document.body.appendChild(warning);
  }

  /**
   * Secure logging to background script
   * @private
   * @param {Object} event 
   */
  _secureLog(event) {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'SECURITY_EVENT',
        event: 'TAMPER_ATTEMPT',
        data: event
      }).catch(() => {});
    }
  }

  /**
   * Notify background of security event
   * @private
   * @param {Object} event 
   */
  _notifyBackground(event) {
    this._secureLog(event);
  }

  /**
   * Log API access
   * @private
   * @param {string} api 
   * @param {string} method 
   */
  _logAccess(api, method) {
    // Rate-limited logging for sensitive API access
  }

  /**
   * Get expected hash from checksums
   * @private
   * @param {string} filePath 
   * @returns {Object|null}
   */
  _getExpectedHash(filePath) {
    const parts = filePath.split('/');
    let current = this.checksums;
    
    for (const part of parts) {
      if (current[part]) {
        current = current[part];
      } else {
        return null;
      }
    }
    
    return current.hash ? current : null;
  }

  /**
   * Get list of critical files
   * @private
   * @returns {Array<string>}
   */
  _getCriticalFiles() {
    const critical = [];
    const traverse = (obj, path = '') => {
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object') {
          if (value.critical && value.hash) {
            critical.push(path ? `${path}/${key}` : key);
          } else if (!value.hash) {
            traverse(value, path ? `${path}/${key}` : key);
          }
        }
      }
    };
    
    traverse(this.checksums);
    return critical;
  }

  /**
   * Public API: Check if system is compromised
   * @returns {boolean}
   */
  isSystemCompromised() {
    return this.isCompromised;
  }

  /**
   * Public API: Get security status
   * @returns {Object}
   */
  getStatus() {
    return {
      compromised: this.isCompromised,
      attempts: this.tamperAttempts,
      verifiedFiles: this.verifiedHashes.size,
      lastCheck: Date.now()
    };
  }

  /**
   * Public API: Manual integrity check
   * @param {string} filePath 
   * @returns {Promise<boolean>}
   */
  async manualCheck(filePath) {
    try {
      const response = await fetch(chrome.runtime.getURL(filePath));
      const code = await response.text();
      const hash = await this.computeHash(code);
      return this.verifyIntegrity(filePath, hash);
    } catch (error) {
      return false;
    }
  }
}

// Export singleton
const tamperDetection = new TamperDetection();

export {
  TamperDetection,
  tamperDetection as default
};

// Global exposure for non-module contexts
if (typeof window !== 'undefined') {
  window.TamperDetection = TamperDetection;
  window.tamperDetection = tamperDetection;
}