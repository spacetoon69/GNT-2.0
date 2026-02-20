/**
 * @fileoverview Hardware Fingerprint - Mangekyo Security Layer
 * Privacy-safe hardware fingerprinting for license binding and device identification
 * @module security/license/hardware-fingerprint
 * @version 1.0.0
 */

'use strict';

/**
 * Hardware fingerprinting system using stable, privacy-respecting attributes
 * Creates unique but non-identifying device signatures for license binding
 */
class HardwareFingerprint {
  constructor() {
    this.version = '1.0.0';
    this.stabilityThreshold = 0.7; // 70% match required for same device
    this.cacheDuration = 86400000; // 24 hours
    this.cachedFingerprint = null;
    this.cacheTimestamp = 0;
    
    // Component weights for fingerprint calculation
    this.weights = {
      cpuCores: 0.15,
      memory: 0.15,
      screen: 0.20,
      colorDepth: 0.10,
      timezone: 0.15,
      languages: 0.15,
      platform: 0.10
    };
  }

  /**
   * Generate hardware fingerprint
   * @param {boolean} useCache - Use cached result if available
   * @returns {Promise<Object>} Fingerprint object with hash and components
   */
  async generate(useCache = true) {
    const now = Date.now();
    
    // Return cached if valid
    if (useCache && this.cachedFingerprint && (now - this.cacheTimestamp) < this.cacheDuration) {
      return this.cachedFingerprint;
    }

    const components = await this._collectComponents();
    const hash = await this._computeHash(components);
    
    const fingerprint = {
      hash: hash,
      components: components,
      version: this.version,
      generatedAt: now,
      stability: this._calculateStability(components)
    };

    // Cache result
    this.cachedFingerprint = fingerprint;
    this.cacheTimestamp = now;

    return fingerprint;
  }

  /**
   * Collect hardware components (privacy-safe)
   * @private
   * @returns {Promise<Object>}
   */
  async _collectComponents() {
    const components = {
      // CPU information (coarse-grained)
      cpu: {
        cores: navigator.hardwareConcurrency || 4,
        platform: navigator.platform || 'unknown'
      },

      // Memory (rounded to reduce variance)
      memory: {
        total: this._roundMemory(navigator.deviceMemory),
        limit: performance?.memory?.jsHeapSizeLimit || 0
      },

      // Display characteristics
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        ratio: this._simplifyRatio(screen.width, screen.height),
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
        refreshRate: await this._estimateRefreshRate()
      },

      // Graphics capabilities (WebGL fingerprint - privacy safe subset)
      graphics: await this._getGraphicsInfo(),

      // System locale (stable but not identifying)
      locale: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
        languages: navigator.languages?.slice(0, 3) || [navigator.language],
        locale: navigator.language
      },

      // Browser characteristics (for validation, not identification)
      browser: {
        userAgent: this._hashString(navigator.userAgent),
        vendor: navigator.vendor,
        product: navigator.productSub || 'unknown',
        maxTouchPoints: navigator.maxTouchPoints || 0
      },

      // Input devices (coarse classification)
      input: {
        maxTouchPoints: navigator.maxTouchPoints || 0,
        pointerEnabled: 'onpointerdown' in window,
        deviceMemory: navigator.deviceMemory || 'unknown'
      },

      // Media capabilities (supported formats)
      media: await this._getMediaCapabilities(),

      // Feature detection (stable across sessions)
      features: this._detectFeatures()
    };

    // Anonymize sensitive values
    return this._anonymizeComponents(components);
  }

  /**
   * Compute stable hash from components
   * @private
   * @param {Object} components 
   * @returns {Promise<string>}
   */
  async _computeHash(components) {
    // Create canonical string representation
    const canonical = JSON.stringify(components, Object.keys(components).sort());
    
    // Hash using Web Crypto
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Return hex-encoded hash
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Compare two fingerprints for similarity
   * @param {Object} fp1 
   * @param {Object} fp2 
   * @returns {Object} Comparison result with match percentage
   */
  compare(fp1, fp2) {
    if (!fp1 || !fp2 || !fp1.components || !fp2.components) {
      return { match: false, similarity: 0, details: {} };
    }

    const components1 = fp1.components;
    const components2 = fp2.components;
    
    const comparisons = {
      cpu: this._compareCPU(components1.cpu, components2.cpu),
      memory: this._compareMemory(components1.memory, components2.memory),
      screen: this._compareScreen(components1.screen, components2.screen),
      graphics: this._compareGraphics(components1.graphics, components2.graphics),
      locale: this._compareLocale(components1.locale, components2.locale),
      features: this._compareFeatures(components1.features, components2.features)
    };

    // Calculate weighted similarity
    let totalWeight = 0;
    let weightedScore = 0;

    for (const [key, result] of Object.entries(comparisons)) {
      const weight = this.weights[key] || 0.1;
      totalWeight += weight;
      weightedScore += result.similarity * weight;
    }

    const overallSimilarity = weightedScore / totalWeight;
    const isMatch = overallSimilarity >= this.stabilityThreshold;

    return {
      match: isMatch,
      similarity: overallSimilarity,
      threshold: this.stabilityThreshold,
      details: comparisons,
      recommendation: isMatch ? 'SAME_DEVICE' : 'DIFFERENT_DEVICE'
    };
  }

  /**
   * Verify if current device matches stored fingerprint
   * @param {string} storedHash 
   * @returns {Promise<Object>}
   */
  async verify(storedHash) {
    const current = await this.generate();
    
    // Direct hash match (exact)
    if (current.hash === storedHash) {
      return {
        valid: true,
        confidence: 1.0,
        method: 'EXACT_MATCH'
      };
    }

    // Component-based fuzzy match
    // Note: This requires stored components, not just hash
    // Implementation depends on license storage strategy
    
    return {
      valid: false,
      confidence: 0,
      method: 'NO_MATCH',
      currentHash: current.hash
    };
  }

  /**
   * Round memory to reduce variance from browser updates
   * @private
   * @param {number} memoryGB 
   * @returns {number}
   */
  _roundMemory(memoryGB) {
    if (!memoryGB) return 0;
    // Round to nearest 2GB bucket
    return Math.round(memoryGB / 2) * 2;
  }

  /**
   * Simplify aspect ratio to common standards
   * @private
   * @param {number} width 
   * @param {number} height 
   * @returns {string}
   */
  _simplifyRatio(width, height) {
    const gcd = this._gcd(width, height);
    const w = width / gcd;
    const h = height / gcd;
    
    // Map to common ratios
    const ratio = w / h;
    const commonRatios = [
      { name: '16:9', val: 16/9 },
      { name: '16:10', val: 16/10 },
      { name: '4:3', val: 4/3 },
      { name: '21:9', val: 21/9 },
      { name: '1:1', val: 1 }
    ];
    
    const closest = commonRatios.reduce((prev, curr) => 
      Math.abs(curr.val - ratio) < Math.abs(prev.val - ratio) ? curr : prev
    );
    
    return closest.name;
  }

  /**
   * Calculate GCD
   * @private
   * @param {number} a 
   * @param {number} b 
   * @returns {number}
   */
  _gcd(a, b) {
    return b === 0 ? a : this._gcd(b, a % b);
  }

  /**
   * Estimate screen refresh rate
   * @private
   * @returns {Promise<number>}
   */
  async _estimateRefreshRate() {
    return new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      
      const countFrames = () => {
        frames++;
        if (performance.now() - start < 1000) {
          requestAnimationFrame(countFrames);
        } else {
          // Round to common rates
          const rate = Math.round(frames / 10) * 10;
          resolve(rate > 30 ? rate : 60);
        }
      };
      
      requestAnimationFrame(countFrames);
    });
  }

  /**
   * Get graphics information (privacy-safe subset)
   * @private
   * @returns {Promise<Object>}
   */
  async _getGraphicsInfo() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        return { supported: false };
      }

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      
      // Only use coarse-grained info, not specific GPU model
      const info = {
        supported: true,
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
        renderer: debugInfo ? 
          this._categorizeGPU(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : 
          'unknown',
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
        precisionFormats: this._getPrecisionFormats(gl)
      };

      // Clean up
      canvas.remove();
      
      return info;
    } catch (e) {
      return { supported: false, error: 'WEBGL_UNAVAILABLE' };
    }
  }

  /**
   * Categorize GPU into broad classes
   * @private
   * @param {string} renderer 
   * @returns {string}
   */
  _categorizeGPU(renderer) {
    if (!renderer) return 'unknown';
    
    const lower = renderer.toLowerCase();
    
    if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('rtx')) {
      return 'discrete_nvidia';
    } else if (lower.includes('amd') || lower.includes('radeon')) {
      return 'discrete_amd';
    } else if (lower.includes('intel')) {
      return 'integrated_intel';
    } else if (lower.includes('apple') || lower.includes('m1') || lower.includes('m2')) {
      return 'apple_silicon';
    } else if (lower.includes('adreno')) {
      return 'mobile_qualcomm';
    } else if (lower.includes('mali')) {
      return 'mobile_arm';
    }
    
    return 'unknown';
  }

  /**
   * Get WebGL precision formats (coarse)
   * @private
   * @param {WebGLRenderingContext} gl 
   * @returns {Object}
   */
  _getPrecisionFormats(gl) {
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER];
    const precisions = ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT'];
    
    const result = {};
    shaders.forEach(shader => {
      precisions.forEach(prec => {
        const info = gl.getShaderPrecisionFormat(shader, gl[prec]);
        result[`${shader}_${prec}`] = info ? info.precision : 0;
      });
    });
    
    return result;
  }

  /**
   * Get media capabilities
   * @private
   * @returns {Promise<Object>}
   */
  async _getMediaCapabilities() {
    const codecs = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=hev1',
      'audio/webm;codecs=opus',
      'audio/mp4;codecs=mp4a'
    ];

    const capabilities = {};
    
    if ('MediaSource' in window) {
      for (const codec of codecs) {
        capabilities[codec.split(';')[0]] = {
          supported: MediaSource.isTypeSupported(codec),
          codec: codec.split(';')[1]
        };
      }
    }

    return capabilities;
  }

  /**
   * Detect stable browser features
   * @private
   * @returns {Object}
   */
  _detectFeatures() {
    return {
      webgl: 'WebGLRenderingContext' in window,
      webgl2: 'WebGL2RenderingContext' in window,
      webworker: 'Worker' in window,
      sharedArrayBuffer: 'SharedArrayBuffer' in window,
      wasm: 'WebAssembly' in window,
      offscreenCanvas: 'OffscreenCanvas' in window,
      serviceWorker: 'serviceWorker' in navigator,
      indexedDB: 'indexedDB' in window,
      webcrypto: 'crypto' in window && 'subtle' in crypto,
      webglMultiplied: 'WebGLMultiDraw' in window
    };
  }

  /**
   * Anonymize component values
   * @private
   * @param {Object} components 
   * @returns {Object}
   */
  _anonymizeComponents(components) {
    // Hash identifying strings, keep categorical data
    return {
      ...components,
      browser: {
        ...components.browser,
        userAgent: components.browser.userAgent // Already hashed
      }
    };
  }

  /**
   * Hash string using simple but stable algorithm
   * @private
   * @param {string} str 
   * @returns {string}
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Calculate stability score for components
   * @private
   * @param {Object} components 
   * @returns {number}
   */
  _calculateStability(components) {
    // Higher score = more stable components
    let score = 1.0;
    
    // Reduce score for volatile components
    if (components.screen.refreshRate < 60) score -= 0.1;
    if (components.graphics.supported === false) score -= 0.2;
    
    return Math.max(0, score);
  }

  /**
   * Compare CPU components
   * @private
   * @param {Object} c1 
   * @param {Object} c2 
   * @returns {Object}
   */
  _compareCPU(c1, c2) {
    const coresMatch = c1.cores === c2.cores;
    const platformMatch = c1.platform === c2.platform;
    
    return {
      similarity: (coresMatch ? 0.5 : 0) + (platformMatch ? 0.5 : 0),
      details: { coresMatch, platformMatch }
    };
  }

  /**
   * Compare memory components
   * @private
   * @param {Object} c1 
   * @param {Object} c2 
   * @returns {Object}
   */
  _compareMemory(c1, c2) {
    const totalMatch = c1.total === c2.total;
    const limitMatch = Math.abs(c1.limit - c2.limit) < 100000000; // 100MB tolerance
    
    return {
      similarity: (totalMatch ? 0.6 : 0) + (limitMatch ? 0.4 : 0),
      details: { totalMatch, limitMatch }
    };
  }

  /**
   * Compare screen components
   * @private
   * @param {Object} c1 
   * @param {Object} c2 
   * @returns {Object}
   */
  _compareScreen(c1, c2) {
    const resolutionMatch = c1.width === c2.width && c1.height === c2.height;
    const ratioMatch = c1.ratio === c2.ratio;
    const colorMatch = c1.colorDepth === c2.colorDepth;
    const refreshMatch = Math.abs(c1.refreshRate - c2.refreshRate) <= 5;
    
    return {
      similarity: (resolutionMatch ? 0.4 : 0) + 
                  (ratioMatch ? 0.2 : 0) + 
                  (colorMatch ? 0.2 : 0) + 
                  (refreshMatch ? 0.2 : 0),
      details: { resolutionMatch, ratioMatch, colorMatch, refreshMatch }
    };
  }

  /**
   * Compare graphics components
   * @private
   * @param {Object} c1 
   * @param {Object} c2 
   * @returns {Object}
   */
  _compareGraphics(c1, c2) {
    if (!c1.supported || !c2.supported) {
      return { similarity: c1.supported === c2.supported ? 1 : 0, details: {} };
    }
    
    const vendorMatch = c1.vendor === c2.vendor;
    const categoryMatch = c1.renderer === c2.renderer;
    const textureMatch = c1.maxTextureSize === c2.maxTextureSize;
    
    return {
      similarity: (vendorMatch ? 0.3 : 0) + 
                  (categoryMatch ? 0.5 : 0) + 
                  (textureMatch ? 0.2 : 0),
      details: { vendorMatch, categoryMatch, textureMatch }
    };
  }

  /**
   * Compare locale components
   * @private
   * @param {Object} c1 
   * @param {Object} c2 
   * @returns {Object}
   */
  _compareLocale(c1, c2) {
    const timezoneMatch = c1.timezone === c2.timezone;
    const offsetMatch = c1.offset === c2.offset;
    const primaryLangMatch = c1.languages[0] === c2.languages[0];
    
    return {
      similarity: (timezoneMatch ? 0.5 : 0) + 
                  (offsetMatch ? 0.3 : 0) + 
                  (primaryLangMatch ? 0.2 : 0),
      details: { timezoneMatch, offsetMatch, primaryLangMatch }
    };
  }

  /**
   * Compare feature sets
   * @private
   * @param {Object} c1 
   * @param {Object} c2 
   * @returns {Object}
   */
  _compareFeatures(c1, c2) {
    const keys = Object.keys(c1);
    const matches = keys.filter(k => c1[k] === c2[k]).length;
    const similarity = matches / keys.length;
    
    return {
      similarity,
      details: { matches, total: keys.length }
    };
  }

  /**
   * Check if fingerprint has changed significantly (potential tampering)
   * @param {Object} baseline 
   * @returns {Promise<Object>}
   */
  async detectTampering(baseline) {
    const current = await this.generate();
    const comparison = this.compare(baseline, current);
    
    // Sudden significant change suggests tampering
    const tamperingIndicators = [];
    
    if (comparison.details.screen?.resolutionMatch === false) {
      tamperingIndicators.push('RESOLUTION_CHANGE');
    }
    if (comparison.details.graphics?.categoryMatch === false) {
      tamperingIndicators.push('GPU_SPOOFING');
    }
    if (comparison.details.cpu?.coresMatch === false) {
      tamperingIndicators.push('CPU_SPOOFING');
    }

    return {
      tampered: comparison.similarity < 0.5 && comparison.details.screen?.resolutionMatch === false,
      confidence: 1 - comparison.similarity,
      indicators: tamperingIndicators,
      comparison
    };
  }

  /**
   * Export fingerprint for license storage
   * @returns {Promise<Object>}
   */
  async exportForLicense() {
    const fp = await this.generate();
    
    return {
      hash: fp.hash,
      stability: fp.stability,
      version: fp.version,
      // Include selective components for fuzzy matching
      components: {
        cpu: { cores: fp.components.cpu.cores },
        memory: { total: fp.components.memory.total },
        screen: { 
          ratio: fp.components.screen.ratio,
          colorDepth: fp.components.screen.colorDepth 
        },
        graphics: { renderer: fp.components.graphics.renderer },
        locale: { timezone: fp.components.locale.timezone }
      }
    };
  }
}

// Export singleton
const hardwareFingerprint = new HardwareFingerprint();

export {
  HardwareFingerprint,
  hardwareFingerprint as default
};

// Global exposure
if (typeof window !== 'undefined') {
  window.HardwareFingerprint = HardwareFingerprint;
  window.hardwareFingerprint = hardwareFingerprint;
}