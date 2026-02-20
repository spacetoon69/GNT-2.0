// core/background/lifecycle/alarm-scheduler.js

import { CONFIG } from '../../shared/constants.js';
import { ConfigManager } from '../../shared/config-manager.js';
import { PerformanceMonitor } from '../../shared/utils/performance-monitor.js';
import { DataRetention } from '../../../privacy/data-handling/data-retention.js';
import { TranslationCache } from '../../../storage/indexeddb/translation-cache.js';
import { ImageCache } from '../../../storage/indexeddb/image-cache.js';
import { LicenseValidator } from '../../../security/license/license-validator.js';

/**
 * Alarm Scheduler - Manages periodic background tasks in MV3
 * Handles cache maintenance, license validation, data retention,
 * and performance monitoring within service worker constraints
 */
class AlarmScheduler {
  constructor() {
    this.configManager = new ConfigManager();
    this.performanceMonitor = new PerformanceMonitor();
    this.dataRetention = new DataRetention();
    this.licenseValidator = new LicenseValidator();
    
    this.alarms = new Map();
    this.taskRegistry = new Map();
    this.runningTasks = new Set();
    this.metrics = {
      totalExecutions: 0,
      failedExecutions: 0,
      lastMaintenance: null
    };

    this.initializeTaskRegistry();
    this.setupAlarmListeners();
  }

  /**
   * Initialize all scheduled tasks
   */
  initializeTaskRegistry() {
    // Cache maintenance - every 6 hours
    this.registerTask('cache-maintenance', {
      interval: 6 * 60, // 6 hours in minutes
      handler: this.performCacheMaintenance.bind(this),
      priority: 'high',
      timeout: 5 * 60 * 1000, // 5 minutes
      conditions: ['licenseActive']
    });

    // License validation - every 24 hours
    this.registerTask('license-check', {
      interval: 24 * 60, // 24 hours
      handler: this.performLicenseValidation.bind(this),
      priority: 'critical',
      timeout: 30 * 1000, // 30 seconds
      conditions: ['online']
    });

    // Data retention enforcement - daily at 3 AM
    this.registerTask('data-retention', {
      schedule: { hour: 3, minute: 0 }, // 3:00 AM daily
      handler: this.performDataRetention.bind(this),
      priority: 'medium',
      timeout: 10 * 60 * 1000, // 10 minutes
      conditions: ['idle']
    });

    // Performance metrics collection - every hour
    this.registerTask('metrics-collection', {
      interval: 60, // 1 hour
      handler: this.collectPerformanceMetrics.bind(this),
      priority: 'low',
      timeout: 60 * 1000, // 1 minute
      persist: false // Don't wake system
    });

    // Translation cache sync - every 30 minutes
    this.registerTask('translation-sync', {
      interval: 30, // 30 minutes
      handler: this.syncTranslationCache.bind(this),
      priority: 'medium',
      timeout: 2 * 60 * 1000, // 2 minutes
      conditions: ['licenseActive', 'online']
    });

    // Image cache cleanup - every 2 hours
    this.registerTask('image-cleanup', {
      interval: 2 * 60, // 2 hours
      handler: this.cleanupImageCache.bind(this),
      priority: 'low',
      timeout: 3 * 60 * 1000, // 3 minutes
      conditions: ['storagePressure']
    });

    // Preload language models - weekly on Sunday at 2 AM
    this.registerTask('language-preload', {
      schedule: { dayOfWeek: 0, hour: 2, minute: 0 }, // Sunday 2 AM
      handler: this.preloadLanguageModels.bind(this),
      priority: 'low',
      timeout: 10 * 60 * 1000, // 10 minutes
      conditions: ['online', 'unmetered']
    });

    // Health check - every 15 minutes
    this.registerTask('health-check', {
      interval: 15, // 15 minutes
      handler: this.performHealthCheck.bind(this),
      priority: 'high',
      timeout: 30 * 1000, // 30 seconds
      persist: true
    });

    // Update check - every 6 hours
    this.registerTask('update-check', {
      interval: 6 * 60, // 6 hours
      handler: this.checkForUpdates.bind(this),
      priority: 'low',
      timeout: 60 * 1000, // 1 minute
      conditions: ['online']
    });

    // Post-update optimization (one-time, scheduled by update handler)
    this.registerTask('post-update-optimization', {
      once: true,
      handler: this.performPostUpdateOptimization.bind(this),
      priority: 'medium',
      timeout: 15 * 60 * 1000 // 15 minutes
    });
  }

  /**
   * Register a task in the scheduler
   */
  registerTask(name, config) {
    this.taskRegistry.set(name, {
      name,
      lastRun: null,
      executionCount: 0,
      failureCount: 0,
      status: 'registered',
      ...config
    });
  }

  /**
   * Initialize all periodic alarms
   */
  async initialize() {
    console.log('⏰ Initializing Alarm Scheduler...');

    // Clear any existing alarms first
    await this.clearAllAlarms();

    // Create alarms for registered tasks
    for (const [name, task] of this.taskRegistry) {
      if (task.once) continue; // Skip one-time tasks, created on demand
      
      await this.createAlarm(name, task);
    }

    // Restore persisted alarm state if any
    await this.restoreAlarmState();

    console.log('✅ Alarm Scheduler initialized');
  }

  /**
   * Create Chrome alarm for a task
   */
  async createAlarm(name, task) {
    let alarmInfo;

    if (task.schedule) {
      // Scheduled time (whenInMinutes or specific time)
      const now = new Date();
      const scheduled = new Date();
      scheduled.setHours(task.schedule.hour || 0);
      scheduled.setMinutes(task.schedule.minute || 0);
      scheduled.setSeconds(0);

      if (task.schedule.dayOfWeek !== undefined) {
        // Weekly schedule
        const daysUntil = (task.schedule.dayOfWeek - now.getDay() + 7) % 7;
        scheduled.setDate(now.getDate() + daysUntil);
        if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 7);
      }

      if (scheduled <= now) {
        scheduled.setDate(scheduled.getDate() + 1);
      }

      const delayInMinutes = Math.ceil((scheduled - now) / (1000 * 60));
      alarmInfo = { delayInMinutes, periodInMinutes: task.interval || 24 * 60 };
    } else if (task.interval) {
      // Interval-based
      alarmInfo = { periodInMinutes: task.interval };
    }

    if (alarmInfo) {
      await chrome.alarms.create(name, alarmInfo);
      this.alarms.set(name, { ...task, ...alarmInfo });
      
      console.log(`📅 Scheduled: ${name}`, alarmInfo);
    }
  }

  /**
   * Setup Chrome alarm event listeners
   */
  setupAlarmListeners() {
    // Main alarm handler
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      await this.handleAlarm(alarm.name);
    });

    // Handle system wake (resume from sleep)
    if ('onSystemWake' in chrome.alarms) {
      chrome.alarms.onSystemWake.addListener(async () => {
        console.log('System wake detected, resuming scheduled tasks...');
        await this.handleSystemWake();
      });
    }
  }

  /**
   * Handle alarm trigger
   */
  async handleAlarm(name) {
    const task = this.taskRegistry.get(name);
    if (!task) {
      console.warn(`Unknown alarm: ${name}`);
      return;
    }

    // Check if task is already running
    if (this.runningTasks.has(name)) {
      console.warn(`Task ${name} already running, skipping...`);
      return;
    }

    // Check conditions
    const canRun = await this.checkConditions(task.conditions || []);
    if (!canRun) {
      console.log(`Conditions not met for ${name}, rescheduling...`);
      await this.rescheduleTask(name);
      return;
    }

    // Execute task with timeout and error handling
    this.runningTasks.add(name);
    task.status = 'running';

    const startTime = performance.now();

    try {
      await this.executeWithTimeout(task.handler, task.timeout);
      
      const duration = performance.now() - startTime;
      task.lastRun = Date.now();
      task.executionCount++;
      task.status = 'completed';
      
      this.metrics.totalExecutions++;
      
      console.log(`✅ Task completed: ${name} (${Math.round(duration)}ms)`);

    } catch (error) {
      task.failureCount++;
      task.status = 'failed';
      this.metrics.failedExecutions++;
      
      console.error(`❌ Task failed: ${name}`, error);
      
      // Handle failure based on priority
      await this.handleTaskFailure(task, error);
    } finally {
      this.runningTasks.delete(name);
      await this.persistTaskState(name, task);
    }
  }

  /**
   * Execute task with timeout protection
   */
  executeWithTimeout(handler, timeout) {
    return Promise.race([
      handler(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Task timeout')), timeout)
      )
    ]);
  }

  /**
   * Check if task conditions are met
   */
  async checkConditions(conditions) {
    for (const condition of conditions) {
      switch (condition) {
        case 'online':
          if (!navigator.onLine) return false;
          break;
        case 'licenseActive':
          const licenseStatus = await this.configManager.get('licenseStatus');
          if (licenseStatus !== 'active' && licenseStatus !== 'trial') return false;
          break;
        case 'idle':
          // Check if user has been idle (requires idle API permission)
          try {
            const state = await chrome.idle.queryState(60);
            if (state !== 'idle' && state !== 'locked') return false;
          } catch (e) {
            // Idle API not available, skip
          }
          break;
        case 'storagePressure':
          const estimate = await navigator.storage.estimate();
          const usage = (estimate.usage / estimate.quota) * 100;
          if (usage < 80) return false; // Only run when >80% full
          break;
        case 'unmetered':
          const connection = navigator.connection;
          if (connection && connection.saveData) return false;
          break;
        default:
          // Unknown condition, assume pass
          break;
      }
    }
    return true;
  }

  // ==================== TASK HANDLERS ====================

  /**
   * Cache maintenance: cleanup expired entries, compact storage
   */
  async performCacheMaintenance() {
    console.log('🧹 Performing cache maintenance...');

    const results = {
      translationCache: await TranslationCache.cleanupExpired(),
      imageCache: await ImageCache.cleanupExpired(),
      storage: await this.compactStorage()
    };

    // Update last maintenance timestamp
    this.metrics.lastMaintenance = Date.now();
    
    await this.configManager.set('lastCacheMaintenance', Date.now());
    
    console.log('Cache maintenance complete:', results);
    return results;
  }

  /**
   * License validation: check expiration, refresh tokens
   */
  async performLicenseValidation() {
    console.log('🔑 Performing license validation...');

    const licenseKey = await this.secureStorage.get('licenseKey', { encrypted: true });
    
    if (!licenseKey) {
      // Trial mode - check expiration
      const trialData = await this.configManager.get('licenseData');
      if (trialData && trialData.expiresAt < Date.now()) {
        await this.handleTrialExpiration();
      }
      return;
    }

    const validation = await this.licenseValidator.validate(licenseKey);
    
    if (!validation.valid) {
      await this.handleInvalidLicense(validation);
    } else {
      // Refresh license data
      await this.configManager.set('licenseData', {
        ...validation,
        lastValidated: Date.now()
      });
    }
  }

  /**
   * Data retention: enforce privacy policies
   */
  async performDataRetention() {
    console.log('🛡️ Enforcing data retention policies...');

    const policy = await this.configManager.get('dataRetentionPolicy') || {
      translations: 30,
      images: 7,
      logs: 90
    };

    const results = await this.dataRetention.enforce(policy);
    
    console.log('Data retention enforcement complete:', results);
    return results;
  }

  /**
   * Collect performance metrics
   */
  async collectPerformanceMetrics() {
    const metrics = this.performanceMonitor.collect();
    
    // Store locally (respecting privacy settings)
    const analyticsEnabled = await this.configManager.get('privacy.analyticsEnabled');
    
    if (analyticsEnabled) {
      // Aggregate and send to analytics endpoint
      await this.sendMetricsToServer(metrics);
    } else {
      // Store locally only
      await this.storeMetricsLocally(metrics);
    }
  }

  /**
   * Sync translation cache with cloud (if enabled)
   */
  async syncTranslationCache() {
    const cloudSyncEnabled = await this.configManager.get('privacy.allowCloudSync');
    if (!cloudSyncEnabled) return;

    console.log('☁️ Syncing translation cache...');

    // Get pending sync items
    const pending = await TranslationCache.getPendingSync();
    
    if (pending.length === 0) return;

    try {
      // Batch upload
      await this.uploadToCloud(pending);
      
      // Mark as synced
      for (const item of pending) {
        await TranslationCache.markSynced(item.id);
      }
    } catch (error) {
      console.error('Cloud sync failed:', error);
      // Retry on next schedule
    }
  }

  /**
   * Cleanup image cache based on LRU and size limits
   */
  async cleanupImageCache() {
    console.log('🖼️ Cleaning up image cache...');

    const maxSizeMB = await this.configManager.get('performance.cacheSizeMB') || 100;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    const stats = await ImageCache.getStats();
    
    if (stats.size > maxSizeBytes) {
      // Remove oldest items until under limit (80% threshold)
      const targetSize = maxSizeBytes * 0.8;
      const removed = await ImageCache.trimToSize(targetSize);
      
      console.log(`Removed ${removed.count} images, freed ${removed.bytes} bytes`);
    }
  }

  /**
   * Preload essential language models
   */
  async preloadLanguageModels() {
    console.log('📚 Preloading language models...');

    const languages = await this.configManager.get('ocr.languages') || ['eng'];
    const baseUrl = CONFIG.TESSDATA_URL;

    for (const lang of languages) {
      const filename = `${lang}.traineddata`;
      const cacheKey = `lang_${filename}`;

      // Check if already cached
      const cached = await ImageCache.get(cacheKey);
      if (cached) continue;

      try {
        const response = await fetch(`${baseUrl}/${filename}`, {
          credentials: 'omit'
        });
        
        if (response.ok) {
          const data = await response.arrayBuffer();
          await ImageCache.set(cacheKey, data, {
            expiration: 30 * 24 * 60 * 60 * 1000 // 30 days
          });
          console.log(`Preloaded: ${filename}`);
        }
      } catch (error) {
        console.warn(`Failed to preload ${filename}:`, error);
      }
    }
  }

  /**
   * Health check: verify system integrity
   */
  async performHealthCheck() {
    console.log('🏥 Performing health check...');

    const checks = {
      storage: await this.checkStorageHealth(),
      database: await this.checkDatabaseHealth(),
      memory: this.checkMemoryPressure(),
      license: await this.checkLicenseHealth()
    };

    const issues = Object.entries(checks)
      .filter(([_, status]) => !status.healthy)
      .map(([name, status]) => ({ component: name, ...status }));

    if (issues.length > 0) {
      console.warn('Health check issues detected:', issues);
      await this.handleHealthIssues(issues);
    }

    return checks;
  }

  /**
   * Check for extension updates
   */
  async checkForUpdates() {
    try {
      const updateCheck = await chrome.runtime.requestUpdateCheck();
      
      if (updateCheck.status === 'update_available') {
        console.log('Update available:', updateCheck.version);
        
        // Notify user or auto-update based on settings
        const autoUpdate = await this.configManager.get('advanced.autoUpdate');
        
        if (autoUpdate) {
          chrome.runtime.reload();
        } else {
          await this.notifyUpdateAvailable(updateCheck.version);
        }
      }
    } catch (error) {
      // Update check failed (offline or error)
      console.log('Update check failed:', error);
    }
  }

  /**
   * Post-update optimization tasks
   */
  async performPostUpdateOptimization() {
    console.log('🔧 Running post-update optimization...');

    // Compact databases
    await this.compactStorage();

    // Rebuild indexes
    const schema = new Schema();
    await schema.optimize();

    // Clear temporary migration data
    await chrome.storage.local.remove([
      'system_backup_pre_migration',
      'update_error'
    ]);

    console.log('Post-update optimization complete');
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Reschedule a task (used when conditions not met)
   */
  async rescheduleTask(name, delayMinutes = 5) {
    await chrome.alarms.create(name, {
      delayInMinutes: delayMinutes
    });
  }

  /**
   * Handle task failure based on priority
   */
  async handleTaskFailure(task, error) {
    if (task.priority === 'critical') {
      // Critical task failure - notify user
      await this.notifyCriticalFailure(task, error);
    }

    // Exponential backoff for retries
    if (task.failureCount < 5) {
      const backoffMinutes = Math.pow(2, task.failureCount);
      await this.rescheduleTask(task.name, backoffMinutes);
    }
  }

  /**
   * Handle system wake from sleep
   */
  async handleSystemWake() {
    // Run health check immediately
    await this.handleAlarm('health-check');

    // Check if any scheduled tasks were missed
    const now = Date.now();
    
    for (const [name, task] of this.taskRegistry) {
      if (task.lastRun && (now - task.lastRun) > (task.interval * 2 * 60 * 1000)) {
        // Task missed multiple intervals, run now if critical
        if (task.priority === 'critical' || task.priority === 'high') {
          await this.handleAlarm(name);
        }
      }
    }
  }

  /**
   * Compact storage to free space
   */
  async compactStorage() {
    // Chrome storage doesn't support explicit compaction,
    // but we can clean up old entries
    const keys = await chrome.storage.local.get(null);
    const removable = Object.keys(keys).filter(key => 
      key.startsWith('temp_') || key.startsWith('cache_old_')
    );
    
    if (removable.length > 0) {
      await chrome.storage.local.remove(removable);
      return { removed: removable.length };
    }
    return { removed: 0 };
  }

  /**
   * Persist task state for recovery
   */
  async persistTaskState(name, task) {
    const state = {
      lastRun: task.lastRun,
      executionCount: task.executionCount,
      failureCount: task.failureCount
    };
    
    await chrome.storage.local.set({ [`task_state_${name}`]: state });
  }

  /**
   * Restore alarm state from storage
   */
  async restoreAlarmState() {
    const states = await chrome.storage.local.get(null);
    
    for (const [key, value] of Object.entries(states)) {
      if (key.startsWith('task_state_')) {
        const name = key.replace('task_state_', '');
        const task = this.taskRegistry.get(name);
        
        if (task) {
          task.lastRun = value.lastRun;
          task.executionCount = value.executionCount || 0;
          task.failureCount = value.failureCount || 0;
        }
      }
    }
  }

  /**
   * Clear all active alarms
   */
  async clearAllAlarms() {
    const alarms = await chrome.alarms.getAll();
    
    for (const alarm of alarms) {
      await chrome.alarms.clear(alarm.name);
    }
    
    this.alarms.clear();
  }

  /**
   * Schedule a one-time task
   */
  async scheduleOnce(name, delayMinutes) {
    const task = this.taskRegistry.get(name);
    if (!task || !task.once) {
      throw new Error(`Unknown one-time task: ${name}`);
    }

    await chrome.alarms.create(name, {
      delayInMinutes: delayMinutes
    });
  }

  /**
   * Get scheduler statistics
   */
  async getStats() {
    const alarms = await chrome.alarms.getAll();
    
    return {
      activeAlarms: alarms.length,
      registeredTasks: this.taskRegistry.size,
      runningTasks: Array.from(this.runningTasks),
      metrics: this.metrics,
      tasks: Array.from(this.taskRegistry.entries()).map(([name, task]) => ({
        name,
        status: task.status,
        lastRun: task.lastRun,
        executionCount: task.executionCount,
        failureCount: task.failureCount
      }))
    };
  }

  // Placeholder methods for health checks
  async checkStorageHealth() { return { healthy: true }; }
  async checkDatabaseHealth() { return { healthy: true }; }
  checkMemoryPressure() { return { healthy: true, usage: 0 }; }
  async checkLicenseHealth() { return { healthy: true }; }
  async handleHealthIssues(issues) {}
  async handleTrialExpiration() {}
  async handleInvalidLicense(validation) {}
  async sendMetricsToServer(metrics) {}
  async storeMetricsLocally(metrics) {}
  async uploadToCloud(items) {}
  async notifyUpdateAvailable(version) {}
  async notifyCriticalFailure(task, error) {}

  // MV2 to MV3 migration helper
  async migrateFromMV2(schedules) {
    console.log('Migrating schedules from MV2...');
    // Convert old schedule format if needed
    await this.initialize();
  }

  // Reschedule all alarms (used after browser update)
  async rescheduleAll() {
    await this.clearAllAlarms();
    await this.initialize();
  }
}

// Export singleton
export const alarmScheduler = new AlarmScheduler();

// Initialize on module load
alarmScheduler.initialize().catch(console.error);