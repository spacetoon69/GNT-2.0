/**
 * @fileoverview Custom Encryption Module - Mangekyo Security Layer
 * Provides string obfuscation, algorithm encryption, and runtime decryption
 * for protecting sensitive extension logic from reverse engineering.
 * @module security/obfuscation/custom-encryption
 * @version 1.0.0
 */

'use strict';

/**
 * Custom encryption system using layered obfuscation techniques
 * Combines XOR, AES-GCM, and dynamic key derivation
 */
class MangekyoCipher {
  constructor() {
    this.version = '1.0.0';
    this.keyRotationInterval = 3600000; // 1 hour
    this.algorithm = 'AES-GCM';
    this.keyUsages = ['encrypt', 'decrypt'];
    
    // Dynamic key material (changes per session)
    this._sessionSalt = this._generateSessionSalt();
    this._keyCache = new Map();
    this._lastRotation = Date.now();
  }

  /**
   * Generate unique session salt based on hardware fingerprint
   * @private
   * @returns {Uint8Array} 16-byte session salt
   */
  _generateSessionSalt() {
    const hardwareSig = this._getHardwareSignature();
    const timeComponent = BigInt(Date.now()).toString(16).padStart(16, '0');
    const combined = hardwareSig + timeComponent;
    
    return this._stringToBytes(combined).slice(0, 16);
  }

  /**
   * Extract hardware signature for key binding
   * @private
   * @returns {string} Hardware fingerprint component
   */
  _getHardwareSignature() {
    // Safe hardware properties that don't violate privacy
    const props = [
      navigator.hardwareConcurrency || 4,
      navigator.deviceMemory || 8,
      screen.colorDepth,
      screen.pixelDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone
    ];
    
    return props.map(p => String(p).charCodeAt(0)).join('');
  }

  /**
   * Convert string to Uint8Array
   * @private
   * @param {string} str 
   * @returns {Uint8Array}
   */
  _stringToBytes(str) {
    return new TextEncoder().encode(str);
  }

  /**
   * Convert Uint8Array to string
   * @private
   * @param {Uint8Array} bytes 
   * @returns {string}
   */
  _bytesToString(bytes) {
    return new TextDecoder().decode(bytes);
  }

  /**
   * Derive encryption key from password using PBKDF2
   * @private
   * @param {string} password 
   * @param {Uint8Array} salt 
   * @returns {Promise<CryptoKey>}
   */
  async _deriveKey(password, salt) {
    const cacheKey = `${password}:${this._bytesToString(salt)}`;
    
    if (this._keyCache.has(cacheKey)) {
      return this._keyCache.get(cacheKey);
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      this._stringToBytes(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: this.algorithm, length: 256 },
      false,
      this.keyUsages
    );

    this._keyCache.set(cacheKey, key);
    return key;
  }

  /**
   * XOR obfuscation layer (fast, reversible)
   * @param {Uint8Array} data 
   * @param {Uint8Array} key 
   * @returns {Uint8Array}
   */
  xorObfuscate(data, key) {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] ^ key[i % key.length];
    }
    return result;
  }

  /**
   * Generate cryptographically secure random bytes
   * @param {number} length 
   * @returns {Uint8Array}
   */
  generateRandomBytes(length = 16) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Encrypt sensitive string data
   * @param {string} plaintext 
   * @param {string} password 
   * @returns {Promise<string>} Base64 encoded ciphertext
   */
  async encryptString(plaintext, password) {
    try {
      const iv = this.generateRandomBytes(12);
      const key = await this._deriveKey(password, this._sessionSalt);
      const encoded = this._stringToBytes(plaintext);

      const ciphertext = await crypto.subtle.encrypt(
        { name: this.algorithm, iv: iv },
        key,
        encoded
      );

      // Combine IV + ciphertext + auth tag
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);

      // Additional XOR layer with rotating key
      const xorKey = await this._generateXorKey(password);
      const obfuscated = this.xorObfuscate(combined, xorKey);

      return this._bytesToBase64(obfuscated);
    } catch (error) {
      this._handleCryptoError('encryptString', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt string data
   * @param {string} ciphertext 
   * @param {string} password 
   * @returns {Promise<string>}
   */
  async decryptString(ciphertext, password) {
    try {
      const encrypted = this._base64ToBytes(ciphertext);
      const xorKey = await this._generateXorKey(password);
      const deobfuscated = this.xorObfuscate(encrypted, xorKey);

      const iv = deobfuscated.slice(0, 12);
      const data = deobfuscated.slice(12);

      const key = await this._deriveKey(password, this._sessionSalt);
      const decrypted = await crypto.subtle.decrypt(
        { name: this.algorithm, iv: iv },
        key,
        data
      );

      return this._bytesToString(new Uint8Array(decrypted));
    } catch (error) {
      this._handleCryptoError('decryptString', error);
      throw new Error('Decryption failed - possible tampering detected');
    }
  }

  /**
   * Generate dynamic XOR key based on session
   * @private
   * @param {string} seed 
   * @returns {Promise<Uint8Array>}
   */
  async _generateXorKey(seed) {
    const base = this._stringToBytes(seed + this._sessionSalt.join(''));
    const hash = await crypto.subtle.digest('SHA-256', base);
    return new Uint8Array(hash);
  }

  /**
   * Convert Uint8Array to Base64
   * @private
   * @param {Uint8Array} bytes 
   * @returns {string}
   */
  _bytesToBase64(bytes) {
    const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binString);
  }

  /**
   * Convert Base64 to Uint8Array
   * @private
   * @param {string} base64 
   * @returns {Uint8Array}
   */
  _base64ToBytes(base64) {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.charCodeAt(0));
  }

  /**
   * Encrypt algorithm configuration objects
   * @param {Object} config 
   * @param {string} password 
   * @returns {Promise<string>}
   */
  async encryptAlgorithmConfig(config, password) {
    const serialized = JSON.stringify(config);
    const compressed = this._compressString(serialized);
    return this.encryptString(compressed, password);
  }

  /**
   * Decrypt algorithm configuration
   * @param {string} encrypted 
   * @param {string} password 
   * @returns {Promise<Object>}
   */
  async decryptAlgorithmConfig(encrypted, password) {
    const decrypted = await this.decryptString(encrypted, password);
    const decompressed = this._decompressString(decrypted);
    return JSON.parse(decompressed);
  }

  /**
   * Simple string compression (RLE + dictionary)
   * @private
   * @param {string} str 
   * @returns {string}
   */
  _compressString(str) {
    // Basic compression for API keys and configs
    const dict = {};
    let dictSize = 256;
    const data = str.split('').map(c => c.charCodeAt(0));
    const compressed = [];
    let w = [];

    for (const k of data) {
      const wk = w.concat([k]);
      const wkKey = wk.join(',');
      if (wkKey in dict) {
        w = wk;
      } else {
        compressed.push(w.length > 0 ? dict[w.join(',')] : w[0]);
        dict[wkKey] = dictSize++;
        w = [k];
      }
    }

    if (w.length > 0) {
      compressed.push(w.length > 1 ? dict[w.join(',')] : w[0]);
    }

    return compressed.map(c => String.fromCharCode(c)).join('');
  }

  /**
   * Decompress string
   * @private
   * @param {string} compressed 
   * @returns {string}
   */
  _decompressString(compressed) {
    const dict = {};
    let dictSize = 256;
    const data = compressed.split('').map(c => c.charCodeAt(0));
    let w = [data[0]];
    const result = [String.fromCharCode(data[0])];

    for (let i = 1; i < data.length; i++) {
      const k = data[i];
      let entry;

      if (k in dict) {
        entry = dict[k];
      } else if (k === dictSize) {
        entry = w.concat([w[0]]);
      } else {
        throw new Error('Invalid compressed data');
      }

      result.push(...entry.map(c => String.fromCharCode(c)));
      dict[dictSize++] = w.concat([entry[0]]);
      w = entry;
    }

    return result.join('');
  }

  /**
   * Runtime string obfuscation (reversible at runtime)
   * @param {string} str 
   * @returns {string} Obfuscated string
   */
  runtimeObfuscate(str) {
    const key = this.generateRandomBytes(8);
    const bytes = this._stringToBytes(str);
    const obfuscated = this.xorObfuscate(bytes, key);
    
    // Return as executable code that decrypts at runtime
    const keyStr = Array.from(key).join(',');
    const dataStr = Array.from(obfuscated).join(',');
    
    return `((k,d)=>{const x=(a,b)=>a.map((v,i)=>v^b[i%b.length]);return new TextDecoder().decode(new Uint8Array(x(d,new Uint8Array(k))))})([${keyStr}],[${dataStr}])`;
  }

  /**
   * Create tamper-evident sealed data
   * @param {any} data 
   * @param {string} password 
   * @returns {Promise<Object>}
   */
  async sealData(data, password) {
    const serialized = JSON.stringify(data);
    const timestamp = Date.now();
    const nonce = this.generateRandomBytes(8);
    
    const payload = {
      data: serialized,
      timestamp: timestamp,
      nonce: Array.from(nonce),
      version: this.version
    };

    const encrypted = await this.encryptString(JSON.stringify(payload), password);
    const checksum = await this._calculateChecksum(encrypted);

    return {
      sealed: encrypted,
      checksum: checksum,
      algorithm: this.algorithm
    };
  }

  /**
   * Verify and unseal data
   * @param {Object} sealedPackage 
   * @param {string} password 
   * @returns {Promise<any>}
   */
  async unsealData(sealedPackage, password) {
    const { sealed, checksum } = sealedPackage;
    
    // Verify integrity
    const computedChecksum = await this._calculateChecksum(sealed);
    if (computedChecksum !== checksum) {
      throw new Error('Data integrity check failed - possible tampering');
    }

    const decrypted = await this.decryptString(sealed, password);
    const payload = JSON.parse(decrypted);

    // Check expiration (24 hours default)
    const age = Date.now() - payload.timestamp;
    if (age > 86400000) {
      throw new Error('Sealed data expired');
    }

    return JSON.parse(payload.data);
  }

  /**
   * Calculate SHA-256 checksum
   * @private
   * @param {string} data 
   * @returns {Promise<string>}
   */
  async _calculateChecksum(data) {
    const hash = await crypto.subtle.digest('SHA-256', this._stringToBytes(data));
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Handle cryptographic errors securely
   * @private
   * @param {string} operation 
   * @param {Error} error 
   */
  _handleCryptoError(operation, error) {
    // Log to secure monitoring without exposing sensitive details
    const sanitized = {
      operation,
      timestamp: Date.now(),
      type: error.name,
      message: 'Encryption operation failed'
    };

    // Send to background script for logging
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'SECURITY_EVENT',
        event: 'CRYPTO_ERROR',
        data: sanitized
      }).catch(() => {});
    }
  }

  /**
   * Rotate encryption keys (call periodically)
   * @returns {Promise<void>}
   */
  async rotateKeys() {
    const now = Date.now();
    if (now - this._lastRotation < this.keyRotationInterval) {
      return;
    }

    this._keyCache.clear();
    this._sessionSalt = this._generateSessionSalt();
    this._lastRotation = now;
  }

  /**
   * Secure memory wipe
   */
  destroy() {
    this._keyCache.clear();
    this._sessionSalt.fill(0);
  }
}

/**
 * String encryption utilities for protecting API keys and secrets
 */
class StringVault {
  constructor(cipher) {
    this.cipher = cipher;
    this.vault = new Map();
  }

  /**
   * Store encrypted secret
   * @param {string} key 
   * @param {string} secret 
   * @param {string} password 
   */
  async store(key, secret, password) {
    const encrypted = await this.cipher.encryptString(secret, password);
    this.vault.set(key, {
      data: encrypted,
      timestamp: Date.now()
    });
  }

  /**
   * Retrieve and decrypt secret
   * @param {string} key 
   * @param {string} password 
   * @returns {Promise<string>}
   */
  async retrieve(key, password) {
    const entry = this.vault.get(key);
    if (!entry) throw new Error('Secret not found');
    
    return this.cipher.decryptString(entry.data, password);
  }

  /**
   * Check if key exists
   * @param {string} key 
   * @returns {boolean}
   */
  has(key) {
    return this.vault.has(key);
  }

  /**
   * Remove secret from vault
   * @param {string} key 
   */
  delete(key) {
    this.vault.delete(key);
  }
}

/**
 * Algorithm protection - encrypts sensitive business logic
 */
class AlgorithmShield {
  constructor(cipher) {
    this.cipher = cipher;
    this.shielded = new WeakMap();
  }

  /**
   * Shield function - wraps to prevent debugging
   * @param {Function} fn 
   * @param {string} password 
   * @returns {Function}
   */
  shieldFunction(fn, password) {
    const fnString = fn.toString();
    const encrypted = this.cipher.runtimeObfuscate(fnString);
    
    // Return wrapper that decrypts and executes
    return new Function('return ' + encrypted)();
  }

  /**
   * Shield object methods
   * @param {Object} obj 
   * @param {Array<string>} methods 
   * @param {string} password 
   */
  shieldMethods(obj, methods, password) {
    methods.forEach(method => {
      if (typeof obj[method] === 'function') {
        const original = obj[method].bind(obj);
        obj[method] = this.shieldFunction(original, password);
      }
    });
  }
}

// Export singleton instance and classes
const mangekyoCipher = new MangekyoCipher();

export {
  MangekyoCipher,
  StringVault,
  AlgorithmShield,
  mangekyoCipher as default
};

// Global exposure for non-module contexts (wrapped in IIFE check)
if (typeof window !== 'undefined') {
  window.MangekyoCipher = MangekyoCipher;
  window.StringVault = StringVault;
  window.AlgorithmShield = AlgorithmShield;
  window.mangekyoCipher = mangekyoCipher;
}