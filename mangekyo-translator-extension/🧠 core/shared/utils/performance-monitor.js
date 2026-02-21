/**
 * performance-monitor.js
 * 
 * Performance monitoring and optimization utilities for the manga translation extension.
 * Tracks OCR latency, translation throughput, memory usage, and frame rates.
 */

import { DEBUG_MODE, PERFORMANCE_THRESHOLDS } from '../constants.js';

/**
 * PerformanceMonitor - Centralized performance tracking and alerting
 */
export class PerformanceMonitor {
  constructor(options = {}) {
    this.options = {
      enableLogging: DEBUG_MODE,
      sampleRate: 1.0, // 1.0 = 100% of operations
      maxHistorySize: 1000,
      alertThresholds: {
        ocrLatency: 2000,      // 2 seconds
        translationLatency: 3000, // 3 seconds
        frameDropThreshold: 5,  // Drops per second
        memoryLimitMB: 512,     // Extension memory limit
        ...PERFORMANCE_THRESHOLDS
      },
      ...options
    };

    // Metrics storage
    this.metrics = {
      ocr: new MetricCollector('ocr', this.options.maxHistorySize),
      translation: new MetricCollector('translation', this.options.maxHistorySize),
      detection: new MetricCollector('detection', this.options.maxHistorySize),
      rendering: new MetricCollector('rendering', this.options.maxHistorySize),
      memory: new MetricCollector('memory', 100),
      network: new MetricCollector('network', this.options.maxHistorySize)
    };

    // Active operation tracking
    this.activeOperations = new Map();
    this.operationId = 0;

    // Frame tracking for UI performance
    this.frameMetrics = {
      lastFrameTime: performance.now(),
      frameDrops: 0,
      frameTimes: [],
      targetFPS: 60
    };

    // Alert callbacks
    this.alertHandlers = new Set();

    // Initialize memory tracking if available
    if (performance.memory) {
      this.startMemoryTracking();
    }

    // Bind methods for event listeners
    this.trackFrame = this.trackFrame.bind(this);
  }

  /**
   * Start tracking an operation
   */
  startOperation(type, metadata = {}) {
    if (Math.random() > this.options.sampleRate) return null;

    const id = ++this.operationId;
    const startTime = performance.now();
    
    this.activeOperations.set(id, {
      type,
      startTime,
      metadata: {
        url: location.href,
        timestamp: Date.now(),
        ...metadata
      }
    });

    return id;
  }

  /**
   * End tracking an operation and record metrics
   */
  endOperation(id, success = true, additionalData = {}) {
    if (!id || !this.activeOperations.has(id)) return null;

    const operation = this.activeOperations.get(id);
    const endTime = performance.now();
    const duration = endTime - operation.startTime;

    this.activeOperations.delete(id);

    const metric = {
      duration,
      success,
      ...operation.metadata,
      ...additionalData
    };

    // Store in appropriate collector
    if (this.metrics[operation.type]) {
      this.metrics[operation.type].add(metric);
    }

    // Check thresholds
    this.checkThresholds(operation.type, duration, metric);

    // Log if debug mode
    if (this.options.enableLogging) {
      console.log(`[Performance] ${operation.type}: ${duration.toFixed(2)}ms`, metric);
    }

    return metric;
  }

  /**
   * Quick measure wrapper for async functions
   */
  async measure(type, fn, metadata = {}) {
    const id = this.startOperation(type, metadata);
    try {
      const result = await fn();
      this.endOperation(id, true, { resultType: typeof result });
      return result;
    } catch (error) {
      this.endOperation(id, false, { error: error.message });
      throw error;
    }
  }

  /**
   * Measure synchronous operations
   */
  measureSync(type, fn, metadata = {}) {
    const id = this.startOperation(type, metadata);
    try {
      const result = fn();
      this.endOperation(id, true);
      return result;
    } catch (error) {
      this.endOperation(id, false, { error: error.message });
      throw error;
    }
  }

  /**
   * Check performance thresholds and trigger alerts
   */
  checkThresholds(type, duration, metric) {
    const thresholds = this.options.alertThresholds;
    let alert = null;

    switch (type) {
      case 'ocr':
        if (duration > thresholds.ocrLatency) {
          alert = {
            type: 'ocr_slow',
            severity: 'warning',
            message: `OCR took ${duration.toFixed(0)}ms (threshold: ${thresholds.ocrLatency}ms)`,
            metric
          };
        }
        break;
      case 'translation':
        if (duration > thresholds.translationLatency) {
          alert = {
            type: 'translation_slow',
            severity: 'warning',
            message: `Translation took ${duration.toFixed(0)}ms (threshold: ${thresholds.translationLatency}ms)`,
            metric
          };
        }
        break;
      case 'rendering':
        if (duration > 16.67) { // 60fps budget
          alert = {
            type: 'render_slow',
            severity: duration > 33 ? 'error' : 'warning',
            message: `Frame render took ${duration.toFixed(2)}ms`,
            metric
          };
        }
        break;
    }

    if (alert) {
      this.triggerAlert(alert);
    }
  }

  /**
   * Register alert handler
   */
  onAlert(handler) {
    this.alertHandlers.add(handler);
    return () => this.alertHandlers.delete(handler);
  }

  /**
   * Trigger alert to all handlers
   */
  triggerAlert(alert) {
    this.alertHandlers.forEach(handler => {
      try {
        handler(alert);
      } catch (e) {
        console.error('Alert handler failed:', e);
      }
    });
  }

  /**
   * Start memory usage tracking
   */
  startMemoryTracking() {
    setInterval(() => {
      if (!performance.memory) return;
      
      const memory = performance.memory;
      const usedMB = (memory.usedJSHeapSize / 1048576).toFixed(2);
      const totalMB = (memory.totalJSHeapSize / 1048576).toFixed(2);
      const limitMB = (memory.jsHeapSizeLimit / 1048576).toFixed(2);

      this.metrics.memory.add({
        usedMB: parseFloat(usedMB),
        totalMB: parseFloat(totalMB),
        limitMB: parseFloat(limitMB),
        usagePercent: (memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100).toFixed(2),
        timestamp: Date.now()
      });

      // Alert on high memory
      if (parseFloat(usedMB) > this.options.alertThresholds.memoryLimitMB) {
        this.triggerAlert({
          type: 'memory_high',
          severity: 'error',
          message: `Memory usage ${usedMB}MB exceeds ${this.options.alertThresholds.memoryLimitMB}MB`,
          metric: { usedMB, totalMB, limitMB }
        });
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Track frame rendering performance
   */
  trackFrame() {
    const now = performance.now();
    const delta = now - this.frameMetrics.lastFrameTime;
    const targetFrameTime = 1000 / this.frameMetrics.targetFPS;

    this.frameMetrics.lastFrameTime = now;
    this.frameMetrics.frameTimes.push(delta);

    // Keep last 60 frames
    if (this.frameMetrics.frameTimes.length > 60) {
      this.frameMetrics.frameTimes.shift();
    }

    // Detect frame drops
    if (delta > targetFrameTime * 1.5) {
      this.frameMetrics.frameDrops++;
      
      if (this.frameMetrics.frameDrops >= this.options.alertThresholds.frameDropThreshold) {
        this.triggerAlert({
          type: 'frame_drops',
          severity: 'warning',
          message: `${this.frameMetrics.frameDrops} frames dropped`,
          metric: { delta, targetFrameTime }
        });
        this.frameMetrics.frameDrops = 0;
      }
    }
  }

  /**
   * Get current FPS
   */
  getFPS() {
    if (this.frameMetrics.frameTimes.length < 2) return 0;
    
    const avgFrameTime = this.frameMetrics.frameTimes.reduce((a, b) => a + b, 0) 
      / this.frameMetrics.frameTimes.length;
    return Math.round(1000 / avgFrameTime);
  }

  /**
   * Get comprehensive performance report
   */
  getReport() {
    const report = {
      timestamp: Date.now(),
      summary: {},
      bottlenecks: [],
      recommendations: []
    };

    // Aggregate metrics
    Object.entries(this.metrics).forEach(([type, collector]) => {
      const stats = collector.getStats();
      report.summary[type] = stats;

      // Identify bottlenecks
      if (stats.avg > this.options.alertThresholds[`${type}Latency`] || Infinity) {
        report.bottlenecks.push({
          type,
          severity: stats.avg > this.options.alertThresholds[`${type}Latency`] * 2 ? 'critical' : 'warning',
          message: `${type} averaging ${stats.avg.toFixed(0)}ms`
        });
      }
    });

    // Add FPS
    report.summary.fps = this.getFPS();

    // Generate recommendations
    report.recommendations = this.generateRecommendations(report);

    return report;
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations(report) {
    const recs = [];

    if (report.summary.ocr?.avg > 1000) {
      recs.push({
        category: 'ocr',
        priority: 'high',
        action: 'Consider reducing OCR resolution or enabling region-of-interest detection'
      });
    }

    if (report.summary.translation?.avg > 2000) {
      recs.push({
        category: 'translation',
        priority: 'high',
        action: 'Enable translation caching or switch to faster provider'
      });
    }

    if (report.summary.fps < 30) {
      recs.push({
        category: 'rendering',
        priority: 'medium',
        action: 'Reduce overlay complexity or enable hardware acceleration'
      });
    }

    if (report.summary.memory?.usagePercent > 80) {
      recs.push({
        category: 'memory',
        priority: 'critical',
        action: 'Clear image cache and reduce concurrent operations'
      });
    }

    return recs;
  }

  /**
   * Export metrics for debugging
   */
  exportMetrics() {
    return {
      timestamp: Date.now(),
      metrics: Object.fromEntries(
        Object.entries(this.metrics).map(([k, v]) => [k, v.getAll()])
      ),
      frameMetrics: {
        ...this.frameMetrics,
        frameTimes: this.frameMetrics.frameTimes.slice(-10) // Last 10 only
      }
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    Object.values(this.metrics).forEach(collector => collector.clear());
    this.frameMetrics.frameTimes = [];
    this.frameMetrics.frameDrops = 0;
  }

  /**
   * Create performance observer for long tasks
   */
  observeLongTasks() {
    if (!('PerformanceObserver' in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach(entry => {
          if (entry.duration > 50) { // Long task threshold
            this.triggerAlert({
              type: 'long_task',
              severity: entry.duration > 100 ? 'error' : 'warning',
              message: `Long task detected: ${entry.duration.toFixed(0)}ms`,
              metric: {
                duration: entry.duration,
                startTime: entry.startTime,
                entryType: entry.entryType
              }
            });
          }
        });
      });

      observer.observe({ entryTypes: ['longtask'] });
      return observer;
    } catch (e) {
      console.warn('Long task observation not supported');
      return null;
    }
  }
}

/**
 * MetricCollector - Ring buffer for metric storage with statistical analysis
 */
class MetricCollector {
  constructor(name, maxSize = 1000) {
    this.name = name;
    this.maxSize = maxSize;
    this.data = [];
    this.index = 0;
  }

  add(metric) {
    if (this.data.length < this.maxSize) {
      this.data.push(metric);
    } else {
      this.data[this.index] = metric;
      this.index = (this.index + 1) % this.maxSize;
    }
  }

  getStats() {
    if (this.data.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, p95: 0, successRate: 0 };
    }

    const durations = this.data.map(m => m.duration).filter(d => typeof d === 'number');
    const sorted = [...durations].sort((a, b) => a - b);
    
    const sum = durations.reduce((a, b) => a + b, 0);
    const successCount = this.data.filter(m => m.success !== false).length;

    return {
      count: this.data.length,
      avg: sum / durations.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
      successRate: (successCount / this.data.length * 100).toFixed(1)
    };
  }

  getAll() {
    return [...this.data];
  }

  clear() {
    this.data = [];
    this.index = 0;
  }
}

/**
 * Specialized monitors for specific components
 */
export const ComponentMonitors = {
  /**
   * Monitor OCR pipeline specifically
   */
  createOCRMonitor(baseMonitor) {
    return {
      recognize: (imageData, language) => {
        return baseMonitor.measure('ocr', async () => {
          // Actual OCR call would go here
          return { text: '', confidence: 0 };
        }, { language, imageSize: imageData?.byteLength });
      },

      preprocess: (operation) => {
        return baseMonitor.measureSync('ocr_preprocess', operation);
      }
    };
  },

  /**
   * Monitor translation API calls
   */
  createTranslationMonitor(baseMonitor) {
    return {
      translate: (text, sourceLang, targetLang, provider) => {
        return baseMonitor.measure('translation', async () => {
          // Actual translation call
          return '';
        }, { sourceLang, targetLang, provider, textLength: text?.length });
      },

      cacheLookup: (key) => {
        return baseMonitor.measureSync('translation_cache', () => {
          // Cache check
          return null;
        }, { cacheKey: key });
      }
    };
  },

  /**
   * Monitor bubble detection performance
   */
  createDetectionMonitor(baseMonitor) {
    return {
      detect: (imageElement) => {
        return baseMonitor.measure('detection', async () => {
          // Detection logic
          return [];
        }, { imageSize: imageElement?.src?.length });
      },

      classify: (regions) => {
        return baseMonitor.measureSync('detection_classify', () => {
          return regions.map(r => ({ ...r, type: 'text' }));
        }, { regionCount: regions?.length });
      }
    };
  }
};

/**
 * Utility functions for quick performance checks
 */
export const PerformanceUtils = {
  /**
   * Debounce with performance tracking
   */
  debounce: (fn, ms, monitor, name) => {
    let timeout;
    return (...args) => {
      const start = performance.now();
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const waitTime = performance.now() - start;
        if (monitor) {
          monitor.metrics.network.add({ type: 'debounce_wait', duration: waitTime });
        }
        fn(...args);
      }, ms);
    };
  },

  /**
   * Throttle with frame timing
   */
  throttleRAF: (fn) => {
    let rafId = null;
    return (...args) => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        fn(...args);
        rafId = null;
      });
    };
  },

  /**
   * Measure memory impact of an operation
   */
  measureMemory: async (fn) => {
    if (!performance.memory) return { result: await fn(), memoryDelta: 0 };
    
    const before = performance.memory.usedJSHeapSize;
    const result = await fn();
    const after = performance.memory.usedJSHeapSize;
    
    return {
      result,
      memoryDelta: (after - before) / 1048576, // MB
      before,
      after
    };
  },

  /**
   * Create a performance budget checker
   */
  createBudget: (budgetMs) => {
    const start = performance.now();
    return {
      check: (label) => {
        const elapsed = performance.now() - start;
        const remaining = budgetMs - elapsed;
        return {
          elapsed,
          remaining,
          overBudget: remaining < 0,
          label
        };
      }
    };
  }
};

export default PerformanceMonitor;