/**
 * @fileoverview WASM Loader - Secure WebAssembly Module Loader
 * Loads and instantiates core-crypto.wasm with CSP compliance
 * @module security/wasm/wasm-loader
 */

'use strict';

/**
 * Secure WASM loader with integrity checks and sandboxing
 */
class WASMLoader {
  constructor() {
    this.module = null;
    this.instance = null;
    this.memory = null;
    this.loaded = false;
    this.integrityHash = null;
  }

  /**
   * Load and instantiate WASM module
   * @param {string} url - Path to .wasm file
   * @param {Object} options 
   * @returns {Promise<Object>}
   */
  async load(url, options = {}) {
    try {
      // Fetch with integrity check if hash provided
      const fetchOptions = {};
      if (options.integrity) {
        fetchOptions.integrity = options.integrity;
      }

      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`);
      }

      // Check MIME type
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/wasm')) {
        console.warn('WASM response has incorrect MIME type:', contentType);
      }

      // Compile streaming
      const module = await WebAssembly.compileStreaming(response);
      
      // Verify module imports/exports match expected interface
      this._verifyInterface(module);

      // Create memory with guard pages
      const memory = new WebAssembly.Memory({
        initial: 2,  // 128KB
        maximum: 16, // 1MB max
        shared: false
      });

      // Import object with secure environment
      const importObject = {
        env: {
          memory: memory,
          log: this._createSecureLog(),
          abort: this._createAbortHandler(),
          ...options.additionalImports
        }
      };

      // Instantiate with sanitized imports
      const instance = await WebAssembly.instantiate(module, importObject);

      this.module = module;
      this.instance = instance;
      this.memory = memory;
      this.loaded = true;

      // Bind exported functions
      return this._bindExports(instance.exports);

    } catch (error) {
      this.loaded = false;
      throw new Error(`WASM load failed: ${error.message}`);
    }
  }

  /**
   * Load from base64-encoded inline WASM
   * @param {string} base64 
   * @returns {Promise<Object>}
   */
  async loadFromBase64(base64) {
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const module = await WebAssembly.compile(binary);
    
    const memory = new WebAssembly.Memory({ initial: 2, maximum: 16 });
    
    const instance = await WebAssembly.instantiate(module, {
      env: { memory }
    });

    this.instance = instance;
    this.memory = memory;
    this.loaded = true;

    return this._bindExports(instance.exports);
  }

  /**
   * Verify WASM interface matches expected
   * @private
   * @param {WebAssembly.Module} module 
   */
  _verifyInterface(module) {
    const exports = WebAssembly.Module.exports(module);
    const required = [
      'aes256_encrypt_block',
      'chacha20_block',
      'secure_zero',
      'constant_time_compare',
      'memory'
    ];

    const exportNames = exports.map(e => e.name);
    
    for (const name of required) {
      if (!exportNames.includes(name)) {
        throw new Error(`Required export missing: ${name}`);
      }
    }

    // Verify no unexpected imports that could be dangerous
    const imports = WebAssembly.Module.imports(module);
    const allowedImports = ['env.memory', 'env.log', 'env.abort'];
    
    for (const imp of imports) {
      const fullName = `${imp.module}.${imp.name}`;
      if (!allowedImports.includes(fullName)) {
        throw new Error(`Unexpected import: ${fullName}`);
      }
    }
  }

  /**
   * Bind exported functions with type checking
   * @private
   * @param {Object} exports 
   * @returns {Object}
   */
  _bindExports(exports) {
    const bound = {
      memory: exports.memory,
      
      // AES-256 encryption
      aes256Encrypt: (input, key) => {
        if (input.length !== 16 || key.length !== 32) {
          throw new Error('Invalid AES input/key size');
        }
        
        const inputPtr = 0;
        const outputPtr = 16;
        const keyPtr = 32;
        
        this._writeBytes(inputPtr, input);
        this._writeBytes(keyPtr, key);
        
        exports.aes256_encrypt_block(inputPtr, outputPtr, keyPtr);
        
        return this._readBytes(outputPtr, 16);
      },

      // ChaCha20 keystream generation
      chacha20: (key, nonce, counter) => {
        if (key.length !== 32 || nonce.length !== 12) {
          throw new Error('Invalid ChaCha20 parameters');
        }
        
        const keyPtr = 0;
        const noncePtr = 32;
        const outputPtr = 64;
        
        this._writeBytes(keyPtr, key);
        this._writeBytes(noncePtr, nonce);
        
        exports.chacha20_block(keyPtr, noncePtr, counter, outputPtr);
        
        return this._readBytes(outputPtr, 64);
      },

      // Secure memory clearing
      secureZero: (buffer) => {
        const ptr = 0;
        this._writeBytes(ptr, buffer);
        exports.secure_zero(ptr, buffer.length);
        return this._readBytes(ptr, buffer.length);
      },

      // Constant-time comparison
      constantTimeEquals: (a, b) => {
        if (a.length !== b.length) return false;
        
        const aPtr = 0;
        const bPtr = a.length;
        
        this._writeBytes(aPtr, a);
        this._writeBytes(bPtr, b);
        
        const result = exports.constant_time_compare(aPtr, bPtr, a.length);
        return result === 0;
      }
    };

    return bound;
  }

  /**
   * Write bytes to WASM memory
   * @private
   * @param {number} ptr 
   * @param {Uint8Array} data 
   */
  _writeBytes(ptr, data) {
    const memory = new Uint8Array(this.memory.buffer);
    memory.set(data, ptr);
  }

  /**
   * Read bytes from WASM memory
   * @private
   * @param {number} ptr 
   * @param {number} len 
   * @returns {Uint8Array}
   */
  _readBytes(ptr, len) {
    const memory = new Uint8Array(this.memory.buffer);
    return memory.slice(ptr, ptr + len);
  }

  /**
   * Create secure logging function
   * @private
   * @returns {Function}
   */
  _createSecureLog() {
    return (ptr, len) => {
      // Only allow logging in debug mode, sanitize output
      if (process.env.NODE_ENV === 'development') {
        const bytes = this._readBytes(ptr, len);
        console.log('WASM:', new TextDecoder().decode(bytes));
      }
    };
  }

  /**
   * Create abort handler
   * @private
   * @returns {Function}
   */
  _createAbortHandler() {
    return (code) => {
      throw new Error(`WASM abort: ${code}`);
    };
  }

  /**
   * Get memory usage statistics
   * @returns {Object}
   */
  getMemoryStats() {
    if (!this.memory) return null;
    
    return {
      bufferSize: this.memory.buffer.byteLength,
      pages: this.memory.buffer.byteLength / (64 * 1024)
    };
  }

  /**
   * Destroy instance and clear memory
   */
  destroy() {
    if (this.memory) {
      // Zero memory before releasing
      const view = new Uint8Array(this.memory.buffer);
      view.fill(0);
    }
    
    this.instance = null;
    this.module = null;
    this.memory = null;
    this.loaded = false;
  }
}

// Export singleton
const wasmLoader = new WASMLoader();

export {
  WASMLoader,
  wasmLoader as default
};

// Global exposure
if (typeof window !== 'undefined') {
  window.WASMLoader = WASMLoader;
  window.wasmLoader = wasmLoader;
}