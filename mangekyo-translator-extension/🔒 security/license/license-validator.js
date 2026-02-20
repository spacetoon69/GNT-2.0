/**
 * @fileoverview License Validator - Mangekyo Security Layer
 * License key verification, hardware fingerprint binding, and entitlement management
 * @module security/license/license-validator
 * @version 1.0.0
 */

'use strict';

import { mangekyoCipher } from '../obfuscation/custom-encryption.js';
import { hardwareFingerprint } from './hardware-fingerprint.js';

/**
 * License types and entitlement levels
 */
const LICENSE_TYPES = {
  TRIAL: 'trial',
  STANDARD: 'standard',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
  LIFETIME: 'lifetime'
};

/**
 * Feature flags per license tier
 */
const TIER_FEATURES = {
  [LICENSE_TYPES.TRIAL]: {
    ocrLanguages: ['eng', 'jpn'],
    maxPagesPerDay: 50,
    translationEngines: ['google'],
    offlineMode: false,
    cloudSync: false,
    prioritySupport: false,
    watermark: true,
    expiresDays: 7
  },
  [LICENSE_TYPES.STANDARD]: {
    ocrLanguages: ['eng', 'jpn', 'kor', 'chi_sim'],
    maxPagesPerDay: 200,
    translationEngines: ['google', 'deepl'],
    offlineMode: true,
    cloudSync: true,
    prioritySupport: false,
    watermark: false,
    expiresDays: 365
  },
  [LICENSE_TYPES.PRO]: {
    ocrLanguages: ['all'],
    maxPagesPerDay: -1, // unlimited
    translationEngines: ['google', 'deepl', 'openai'],
    offlineMode: true,
    cloudSync: true,
    prioritySupport: true,
    watermark: false,
    expiresDays: 365,
    betaAccess: true
  },
  [LICENSE_TYPES.ENTERPRISE]: {
    ocrLanguages: ['all'],
    maxPagesPerDay: -1,
    translationEngines: ['all'],
    offlineMode: true,
    cloudSync: true,
    prioritySupport: true,
    watermark: false,
    expiresDays: 365,
    betaAccess: true,
    customModels: true,
    apiAccess: true,
    adminDashboard: true
  },
  [LICENSE_TYPES.LIFETIME]: {
    ocrLanguages: ['all'],
    maxPagesPerDay: -1,
    translationEngines: ['all'],
    offlineMode: true,
    cloudSync: true,
    prioritySupport: true,
    watermark: false,
    expiresDays: -1, // never
    betaAccess: true,
    customModels: true
  }
};

/**
 * License validation and management system
 */
class LicenseValidator {
  constructor() {
    this.version = '1.0.0';
    this.currentLicense = null;
    this.validationCache = null;
    this.cacheExpiry = 3600000; // 1 hour
    this.lastValidation = 0;
    this.offlineGracePeriod = 86400000; // 24 hours
    
    // License server endpoints (encrypted)
    this._endpoints = {
      validate: 'https://api.mangekyo.io/v1/license/validate',
      activate: 'https://api.mangekyo.io/v1/license/activate',
      deactivate: 'https://api.mangekyo.io/v1/license/deactivate',
      check: 'https://api.mangekyo.io/v1/license/check'
    };
    
    this.init();
  }

  /**
   * Initialize license system
   * @private
   */
  async init() {
    await this._loadStoredLicense();
    this._scheduleValidation();
  }

  /**
   * Validate license key format and signature
   * @param {string} licenseKey 
   * @returns {Object}
   */
  validateFormat(licenseKey) {
    // Format: MGKY-XXXX-XXXX-XXXX-XXXX-SIGN
    const pattern = /^MGKY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-F0-9]{64}$/;
    
    if (!pattern.test(licenseKey)) {
      return {
        valid: false,
        error: 'INVALID_FORMAT',
        message: 'License key format is invalid'
      };
    }

    const parts = licenseKey.split('-');
    const payload = parts.slice(0, 5).join('-');
    const signature = parts[5];

    // Verify Ed25519 signature (simplified - real impl uses subtle crypto)
    const isSignatureValid = this._verifySignature(payload, signature);
    
    if (!isSignatureValid) {
      return {
        valid: false,
        error: 'INVALID_SIGNATURE',
        message: 'License signature verification failed'
      };
    }

    // Extract metadata from payload
    const metadata = this._decodePayload(payload);
    
    return {
      valid: true,
      type: metadata.type,
      issuedAt: metadata.issuedAt,
      expiresAt: metadata.expiresAt,
      features: TIER_FEATURES[metadata.type] || TIER_FEATURES[LICENSE_TYPES.TRIAL]
    };
  }

  /**
   * Activate license with hardware binding
   * @param {string} licenseKey 
   * @returns {Promise<Object>}
   */
  async activate(licenseKey) {
    try {
      // Validate format first
      const formatCheck = this.validateFormat(licenseKey);
      if (!formatCheck.valid) {
        return formatCheck;
      }

      // Get hardware fingerprint
      const fingerprint = await hardwareFingerprint.generate();
      
      // Check if already activated on this device
      const stored = await this._getStoredLicense();
      if (stored && stored.key === licenseKey && stored.activated) {
        return {
          success: true,
          message: 'License already activated on this device',
          license: stored
        };
      }

      // Server validation with hardware binding
      const activation = await this._serverActivate(licenseKey, fingerprint);
      
      if (!activation.success) {
        return {
          success: false,
          error: activation.error,
          message: activation.message
        };
      }

      // Store encrypted license
      const licenseData = {
        key: licenseKey,
        type: formatCheck.type,
        fingerprint: fingerprint.hash,
        activatedAt: Date.now(),
        expiresAt: formatCheck.expiresAt,
        features: formatCheck.features,
        activationId: activation.activationId,
        offlineToken: activation.offlineToken,
        activated: true
      };

      await this._storeLicense(licenseData);
      this.currentLicense = licenseData;
      
      return {
        success: true,
        message: 'License activated successfully',
        license: {
          type: licenseData.type,
          expiresAt: licenseData.expiresAt,
          features: licenseData.features
        }
      };

    } catch (error) {
      return {
        success: false,
        error: 'ACTIVATION_ERROR',
        message: error.message
      };
    }
  }

  /**
   * Validate current license status
   * @param {boolean} forceServer - Force server check vs cache
   * @returns {Promise<Object>}
   */
  async validate(forceServer = false) {
    const now = Date.now();
    
    // Use cache if valid and not forced
    if (!forceServer && this.validationCache && (now - this.lastValidation) < this.cacheExpiry) {
      return this.validationCache;
    }

    if (!this.currentLicense) {
      return {
        valid: false,
        status: 'NO_LICENSE',
        message: 'No license found',
        tier: LICENSE_TYPES.TRIAL,
        features: TIER_FEATURES[LICENSE_TYPES.TRIAL]
      };
    }

    // Check expiration
    if (this.currentLicense.expiresAt !== -1 && now > this.currentLicense.expiresAt) {
      return {
        valid: false,
        status: 'EXPIRED',
        message: 'License has expired',
        expiredAt: this.currentLicense.expiresAt,
        tier: LICENSE_TYPES.TRIAL,
        features: TIER_FEATURES[LICENSE_TYPES.TRIAL]
      };
    }

    // Verify hardware fingerprint
    const currentFingerprint = await hardwareFingerprint.generate();
    if (currentFingerprint.hash !== this.currentLicense.fingerprint) {
      // Hardware changed - check if allowed (e.g., reinstalled OS)
      const hardwareValid = await this._validateHardwareChange(currentFingerprint);
      
      if (!hardwareValid) {
        return {
          valid: false,
          status: 'HARDWARE_MISMATCH',
          message: 'License bound to different hardware',
          tier: LICENSE_TYPES.TRIAL,
          features: TIER_FEATURES[LICENSE_TYPES.TRIAL]
        };
      }
    }

    // Server validation (with offline fallback)
    let serverValid = false;
    try {
      serverValid = await this._serverValidate();
    } catch (error) {
      // Offline mode - use grace period
      const offlineValid = (now - this.currentLicense.activatedAt) < this.offlineGracePeriod;
      
      if (!offlineValid) {
        return {
          valid: false,
          status: 'OFFLINE_EXPIRED',
          message: 'Offline grace period expired. Please connect to internet.',
          tier: this.currentLicense.type,
          features: this._degradeFeatures(this.currentLicense.features)
        };
      }
      
      serverValid = true; // Allow offline usage
    }

    if (!serverValid) {
      return {
        valid: false,
        status: 'REVOKED',
        message: 'License has been revoked',
        tier: LICENSE_TYPES.TRIAL,
        features: TIER_FEATURES[LICENSE_TYPES.TRIAL]
      };
    }

    const result = {
      valid: true,
      status: 'ACTIVE',
      tier: this.currentLicense.type,
      features: this.currentLicense.features,
      expiresAt: this.currentLicense.expiresAt,
      daysRemaining: this.currentLicense.expiresAt === -1 ? -1 : 
        Math.ceil((this.currentLicense.expiresAt - now) / 86400000)
    };

    // Update cache
    this.validationCache = result;
    this.lastValidation = now;

    return result;
  }

  /**
   * Deactivate license on current device
   * @returns {Promise<Object>}
   */
  async deactivate() {
    if (!this.currentLicense) {
      return { success: false, message: 'No active license' };
    }

    try {
      const fingerprint = await hardwareFingerprint.generate();
      
      const response = await fetch(this._endpoints.deactivate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: this.currentLicense.key,
          fingerprint: fingerprint.hash,
          activationId: this.currentLicense.activationId
        })
      });

      const result = await response.json();

      if (result.success) {
        await this._clearLicense();
        this.currentLicense = null;
        this.validationCache = null;
      }

      return result;

    } catch (error) {
      return {
        success: false,
        error: 'DEACTIVATION_FAILED',
        message: error.message
      };
    }
  }

  /**
   * Get current license info (safe subset)
   * @returns {Object|null}
   */
  getLicenseInfo() {
    if (!this.currentLicense) return null;
    
    return {
      type: this.currentLicense.type,
      activatedAt: this.currentLicense.activatedAt,
      expiresAt: this.currentLicense.expiresAt,
      features: this.currentLicense.features
    };
  }

  /**
   * Check if feature is enabled
   * @param {string} feature 
   * @returns {boolean}
   */
  hasFeature(feature) {
    if (!this.currentLicense) {
      return TIER_FEATURES[LICENSE_TYPES.TRIAL][feature] || false;
    }
    
    return this.currentLicense.features[feature] || false;
  }

  /**
   * Get usage limits
   * @returns {Object}
   */
  getLimits() {
    const features = this.currentLicense ? 
      this.currentLicense.features : 
      TIER_FEATURES[LICENSE_TYPES.TRIAL];
    
    return {
      maxPagesPerDay: features.maxPagesPerDay,
      ocrLanguages: features.ocrLanguages,
      translationEngines: features.translationEngines
    };
  }

  /**
   * Server-side activation request
   * @private
   * @param {string} licenseKey 
   * @param {Object} fingerprint 
   * @returns {Promise<Object>}
   */
  async _serverActivate(licenseKey, fingerprint) {
    const response = await fetch(this._endpoints.activate, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': this.version
      },
      body: JSON.stringify({
        licenseKey,
        fingerprint: fingerprint.hash,
        components: fingerprint.components,
        timestamp: Date.now(),
        nonce: this._generateNonce()
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Server-side validation request
   * @private
   * @returns {Promise<boolean>}
   */
  async _serverValidate() {
    if (!this.currentLicense) return false;

    const response = await fetch(this._endpoints.validate, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Offline-Token': this.currentLicense.offlineToken || ''
      },
      body: JSON.stringify({
        licenseKey: this.currentLicense.key,
        activationId: this.currentLicense.activationId,
        timestamp: Date.now()
      })
    });

    if (!response.ok) return false;
    
    const result = await response.json();
    return result.valid && !result.revoked;
  }

  /**
   * Validate hardware change (e.g., after OS reinstall)
   * @private
   * @param {Object} newFingerprint 
   * @returns {Promise<boolean>}
   */
  async _validateHardwareChange(newFingerprint) {
    // Allow if >70% of components match (threshold for minor changes)
    const oldComponents = this.currentLicense.fingerprintComponents || {};
    const newComponents = newFingerprint.components;
    
    let matchCount = 0;
    const keys = Object.keys(oldComponents);
    
    for (const key of keys) {
      if (oldComponents[key] === newComponents[key]) {
        matchCount++;
      }
    }
    
    const matchRatio = matchCount / keys.length;
    
    if (matchRatio > 0.7) {
      // Update stored fingerprint
      this.currentLicense.fingerprint = newFingerprint.hash;
      this.currentLicense.fingerprintComponents = newComponents;
      await this._storeLicense(this.currentLicense);
      return true;
    }
    
    return false;
  }

  /**
   * Load license from encrypted storage
   * @private
   * @returns {Promise<void>}
   */
  async _loadStoredLicense() {
    try {
      const result = await chrome.storage.local.get(['mangekyo_license']);
      if (result.mangekyo_license) {
        const decrypted = await mangekyoCipher.decryptString(
          result.mangekyo_license,
          await this._getStorageKey()
        );
        this.currentLicense = JSON.parse(decrypted);
      }
    } catch (error) {
      this.currentLicense = null;
    }
  }

  /**
   * Store license in encrypted form
   * @private
   * @param {Object} licenseData 
   */
  async _storeLicense(licenseData) {
    const encrypted = await mangekyoCipher.encryptString(
      JSON.stringify(licenseData),
      await this._getStorageKey()
    );
    await chrome.storage.local.set({ mangekyo_license: encrypted });
  }

  /**
   * Get storage encryption key
   * @private
   * @returns {Promise<string>}
   */
  async _getStorageKey() {
    // Derive from hardware fingerprint + static salt
    const fp = await hardwareFingerprint.generate();
    return `mgky_store_${fp.hash.slice(0, 16)}`;
  }

  /**
   * Get stored license (raw)
   * @private
   * @returns {Promise<Object|null>}
   */
  async _getStoredLicense() {
    await this._loadStoredLicense();
    return this.currentLicense;
  }

  /**
   * Clear stored license
   * @private
   */
  async _clearLicense() {
    await chrome.storage.local.remove(['mangekyo_license']);
  }

  /**
   * Schedule periodic validation
   * @private
   */
  _scheduleValidation() {
    // Validate every 6 hours
    setInterval(() => this.validate(true), 21600000);
    
    // Validate on network reconnect
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.validate(true));
    }
  }

  /**
   * Verify Ed25519 signature (placeholder - real impl uses WebCrypto)
   * @private
   * @param {string} payload 
   * @param {string} signature 
   * @returns {boolean}
   */
  _verifySignature(payload, signature) {
    // Real implementation would use:
    // crypto.subtle.verify with Ed25519 or ECDSA
    // This is a structural placeholder
    const expectedLength = 64; // hex-encoded Ed25519 sig
    return signature.length === expectedLength && /^[a-f0-9]+$/i.test(signature);
  }

  /**
   * Decode license payload
   * @private
   * @param {string} payload 
   * @returns {Object}
   */
  _decodePayload(payload) {
    // Remove MGKY- prefix and parse
    const clean = payload.replace('MGKY-', '').replace(/-/g, '');
    
    // Base32 decode ( Crockford variant)
    const decoded = this._base32Decode(clean);
    
    return {
      type: this._decodeType(decoded[0]),
      issuedAt: this._decodeTimestamp(decoded.slice(1, 5)),
      expiresAt: this._decodeTimestamp(decoded.slice(5, 9)),
      serial: decoded.slice(9, 13).join('')
    };
  }

  /**
   * Decode license type byte
   * @private
   * @param {number} byte 
   * @returns {string}
   */
  _decodeType(byte) {
    const types = Object.values(LICENSE_TYPES);
    return types[byte % types.length] || LICENSE_TYPES.TRIAL;
  }

  /**
   * Decode timestamp bytes
   * @private
   * @param {Array<number>} bytes 
   * @returns {number}
   */
  _decodeTimestamp(bytes) {
    const timestamp = bytes.reduce((acc, b, i) => acc + (b << (i * 8)), 0);
    return timestamp * 1000; // Convert to ms
  }

  /**
   * Base32 decode (Crockford)
   * @private
   * @param {string} str 
   * @returns {Array<number>}
   */
  _base32Decode(str) {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const decoded = [];
    let bits = 0;
    let value = 0;
    
    for (const char of str.toUpperCase()) {
      const val = alphabet.indexOf(char);
      if (val === -1) continue;
      
      value = (value << 5) | val;
      bits += 5;
      
      if (bits >= 8) {
        decoded.push((value >> (bits - 8)) & 0xFF);
        bits -= 8;
      }
    }
    
    return decoded;
  }

  /**
   * Generate cryptographically secure nonce
   * @private
   * @returns {string}
   */
  _generateNonce() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Degrade features for offline expiration
   * @private
   * @param {Object} features 
   * @returns {Object}
   */
  _degradeFeatures(features) {
    return {
      ...features,
      maxPagesPerDay: Math.min(features.maxPagesPerDay, 10),
      translationEngines: ['google'],
      offlineMode: true,
      cloudSync: false
    };
  }
}

/**
 * License usage tracking and enforcement
 */
class LicenseEnforcer {
  constructor(validator) {
    this.validator = validator;
    this.usage = {
      pagesToday: 0,
      lastReset: Date.now(),
      history: []
    };
    this.limits = {
      warningThreshold: 0.8,
      hardLimit: true
    };
    
    this._loadUsage();
    this._scheduleReset();
  }

  /**
   * Check if action is allowed under current license
   * @param {string} action 
   * @param {Object} params 
   * @returns {Promise<boolean>}
   */
  async checkQuota(action, params = {}) {
    const validation = await this.validator.validate();
    
    if (!validation.valid) {
      return false;
    }

    const limits = this.validator.getLimits();

    // Check daily page limit
    if (limits.maxPagesPerDay !== -1) {
      if (this.usage.pagesToday >= limits.maxPagesPerDay) {
        this._notifyLimitReached();
        return false;
      }
      
      // Warning at 80%
      if (this.usage.pagesToday >= limits.maxPagesPerDay * this.limits.warningThreshold) {
        this._notifyApproachingLimit();
      }
    }

    // Check specific feature
    if (params.feature && !this.validator.hasFeature(params.feature)) {
      return false;
    }

    return true;
  }

  /**
   * Record usage
   * @param {string} action 
   * @param {Object} details 
   */
  recordUsage(action, details = {}) {
    if (action === 'ocr_page') {
      this.usage.pagesToday++;
      this.usage.history.push({
        action,
        timestamp: Date.now(),
        details
      });
      
      this._saveUsage();
    }
  }

  /**
   * Get current usage stats
   * @returns {Object}
   */
  getUsageStats() {
    const limits = this.validator.getLimits();
    
    return {
      used: this.usage.pagesToday,
      limit: limits.maxPagesPerDay,
      remaining: limits.maxPagesPerDay === -1 ? -1 : limits.maxPagesPerDay - this.usage.pagesToday,
      percentage: limits.maxPagesPerDay === -1 ? 0 : (this.usage.pagesToday / limits.maxPagesPerDay) * 100,
      resetsAt: this._getNextReset()
    };
  }

  /**
   * Load usage from storage
   * @private
   */
  async _loadUsage() {
    try {
      const result = await chrome.storage.local.get(['mangekyo_usage']);
      if (result.mangekyo_usage) {
        this.usage = result.mangekyo_usage;
        
        // Reset if new day
        if (!this._isSameDay(this.usage.lastReset, Date.now())) {
          this._resetDailyUsage();
        }
      }
    } catch (error) {
      // Use defaults
    }
  }

  /**
   * Save usage to storage
   * @private
   */
  async _saveUsage() {
    await chrome.storage.local.set({ mangekyo_usage: this.usage });
  }

  /**
   * Reset daily usage counter
   * @private
   */
  _resetDailyUsage() {
    this.usage.pagesToday = 0;
    this.usage.lastReset = Date.now();
    this._saveUsage();
  }

  /**
   * Schedule daily reset
   * @private
   */
  _scheduleReset() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
      this._resetDailyUsage();
      this._scheduleReset(); // Reschedule for next day
    }, msUntilMidnight);
  }

  /**
   * Check if timestamps are same day
   * @private
   * @param {number} ts1 
   * @param {number} ts2 
   * @returns {boolean}
   */
  _isSameDay(ts1, ts2) {
    const d1 = new Date(ts1);
    const d2 = new Date(ts2);
    return d1.getDate() === d2.getDate() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getFullYear() === d2.getFullYear();
  }

  /**
   * Get next reset timestamp
   * @private
   * @returns {number}
   */
  _getNextReset() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return tomorrow.getTime();
  }

  /**
   * Notify approaching limit
   * @private
   */
  _notifyApproachingLimit() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'LICENSE_WARNING',
        message: 'Approaching daily page limit'
      });
    }
  }

  /**
   * Notify limit reached
   * @private
   */
  _notifyLimitReached() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'LIMIT_REACHED',
        message: 'Daily page limit reached. Upgrade for unlimited access.'
      });
    }
  }
}

// Export singletons
const licenseValidator = new LicenseValidator();
const licenseEnforcer = new LicenseEnforcer(licenseValidator);

export {
  LicenseValidator,
  LicenseEnforcer,
  LICENSE_TYPES,
  TIER_FEATURES,
  licenseValidator,
  licenseEnforcer
};

// Global exposure
if (typeof window !== 'undefined') {
  window.LicenseValidator = LicenseValidator;
  window.LicenseEnforcer = LicenseEnforcer;
  window.licenseValidator = licenseValidator;
  window.licenseEnforcer = licenseEnforcer;
}