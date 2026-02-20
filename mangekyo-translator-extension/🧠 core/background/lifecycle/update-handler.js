// core/background/lifecycle/update-handler.js

import { CONFIG } from '../../shared/constants.js';
import { ConfigManager } from '../../shared/config-manager.js';
import { SecureStorage } from '../../../privacy/encryption/secure-storage.js';
import { Schema } from '../../../storage/indexeddb/schema.js';
import { TranslationCache } from '../../../storage/indexeddb/translation-cache.js';
import { ImageCache } from '../../../storage/indexeddb/image-cache.js';
import { ConsentManager } from '../../../privacy/data-handling/consent-manager.js';

/**
 * Update Handler - Manages version migrations and data transformation
 * Ensures seamless transitions between extension versions with
 * schema migrations, config updates, and cache management
 */
class UpdateHandler {
  constructor() {
    this.configManager = new ConfigManager();
    this.secureStorage = new SecureStorage();
    this.migrationRegistry = new Map();
    this.rollbackStack = [];
    
    this.state = {
      currentVersion: null,
      previousVersion: null,
      targetVersion: CONFIG.VERSION,
      phase: 'idle',
      completedMigrations: [],
      failedMigrations: [],
      startTime: null,
      endTime: null
    };

    this.initializeMigrationRegistry();
  }

  /**
   * Main entry point for update handling
   */
  async handleUpdate(details) {
    this.state.previousVersion = details.previousVersion;
    this.state.currentVersion = chrome.runtime.getManifest().version;
    this.state.startTime = Date.now();
    this.state.phase = 'analyzing';

    console.log(`🔄 Update Handler: ${this.state.previousVersion} → ${this.state.currentVersion}`);

    try {
      // Pre-flight checks
      await this.performPreflightChecks();

      // Build and execute migration plan
      const migrationPlan = this.buildMigrationPlan();
      await this.executeMigrationPlan(migrationPlan);

      // Post-update cleanup
      await this.performPostUpdateTasks();

      this.state.phase = 'complete';
      this.state.endTime = Date.now();
      
      await this.logUpdateEvent('success');
      
      console.log('✅ Update completed successfully', {
        duration: this.state.endTime - this.state.startTime,
        migrations: this.state.completedMigrations.length
      });

    } catch (error) {
      await this.handleUpdateFailure(error);
      throw error;
    }
  }

  /**
   * Initialize all available migrations in registry
   */
  initializeMigrationRegistry() {
    // Schema migrations
    this.registerMigration('1.0.0', '1.1.0', {
      name: 'schema_v1_to_v2',
      description: 'Migrate to new IndexedDB schema with compression',
      type: 'schema',
      execute: this.migrateSchemaV1ToV2.bind(this),
      rollback: this.rollbackSchemaV1ToV2.bind(this)
    });

    this.registerMigration('1.1.0', '1.2.0', {
      name: 'config_ocr_enhancement',
      description: 'Add OCR preprocessing configuration',
      type: 'config',
      execute: this.migrateOCRConfigV1_2.bind(this),
      rollback: this.rollbackOCRConfigV1_2.bind(this)
    });

    this.registerMigration('1.2.0', '1.3.0', {
      name: 'translation_cache_optimization',
      description: 'Reorganize translation cache with hash indexing',
      type: 'data',
      execute: this.migrateTranslationCacheV1_3.bind(this),
      rollback: this.rollbackTranslationCacheV1_3.bind(this),
      estimatedDuration: 5000 // 5 seconds for large caches
    });

    this.registerMigration('1.3.0', '1.4.0', {
      name: 'security_encryption_upgrade',
      description: 'Upgrade encryption from AES-128 to AES-256-GCM',
      type: 'security',
      execute: this.migrateEncryptionV1_4.bind(this),
      rollback: this.rollbackEncryptionV1_4.bind(this),
      requiresUserInteraction: true
    });

    this.registerMigration('1.4.0', '2.0.0', {
      name: 'mv3_migration',
      description: 'Migrate to Manifest V3 architecture',
      type: 'architecture',
      execute: this.migrateToMV3.bind(this),
      rollback: null, // Cannot rollback MV3 migration
      critical: true,
      backupRequired: true
    });

    this.registerMigration('2.0.0', '2.1.0', {
      name: 'wasm_optimization',
      description: 'Migrate WASM modules to new format',
      type: 'performance',
      execute: this.migrateWASMModulesV2_1.bind(this),
      rollback: this.rollbackWASMModulesV2_1.bind(this)
    });

    this.registerMigration('2.1.0', '2.2.0', {
      name: 'privacy_consent_v2',
      description: 'Update privacy consent framework for new regulations',
      type: 'compliance',
      execute: this.migratePrivacyConsentV2_2.bind(this),
      rollback: this.rollbackPrivacyConsentV2_2.bind(this)
    });

    this.registerMigration('2.2.0', '3.0.0', {
      name: 'major_architecture_rewrite',
      description: 'Complete architecture overhaul with new CV engine',
      type: 'major',
      execute: this.migrateToV3Architecture.bind(this),
      rollback: null,
      critical: true,
      estimatedDuration: 30000,
      requiresUserInteraction: true
    });
  }

  /**
   * Register a migration in the registry
   */
  registerMigration(fromVersion, toVersion, migrationConfig) {
    const key = `${fromVersion}_${toVersion}`;
    this.migrationRegistry.set(key, {
      fromVersion,
      toVersion,
      ...migrationConfig,
      id: key
    });
  }

  /**
   * Pre-flight checks before starting migrations
   */
  async performPreflightChecks() {
    console.log('🔍 Running pre-flight checks...');

    const checks = {
      storageAvailable: await this.checkStorageAvailability(),
      schemaCompatible: await this.checkSchemaCompatibility(),
      permissionsValid: await this.checkPermissions(),
      diskSpace: await this.checkAvailableSpace()
    };

    const failed = Object.entries(checks).filter(([_, passed]) => !passed);
    
    if (failed.length > 0) {
      throw new Error(`Pre-flight checks failed: ${failed.map(([name]) => name).join(', ')}`);
    }

    // Create backup if critical migrations are pending
    const plan = this.buildMigrationPlan();
    const hasCritical = plan.some(m => m.critical);
    
    if (hasCritical) {
      await this.createSystemBackup();
    }
  }

  /**
   * Build ordered migration plan based on version path
   */
  buildMigrationPlan() {
    const from = this.parseVersion(this.state.previousVersion);
    const to = this.parseVersion(this.state.currentVersion);
    
    const plan = [];
    let current = { ...from };

    // Simple semver migration chain
    while (this.compareVersions(current, to) < 0) {
      const next = this.incrementVersion(current);
      const key = `${this.versionToString(current)}_${this.versionToString(next)}`;
      
      const migration = this.migrationRegistry.get(key);
      
      if (migration) {
        plan.push(migration);
      } else {
        // No specific migration, assume compatible
        console.log(`No migration found for ${key}, assuming compatibility`);
      }
      
      current = next;
    }

    // Sort by priority: critical first, then by order
    return plan.sort((a, b) => {
      if (a.critical && !b.critical) return -1;
      if (!a.critical && b.critical) return 1;
      return 0;
    });
  }

  /**
   * Execute migration plan with transaction safety
   */
  async executeMigrationPlan(plan) {
    console.log(`📋 Executing ${plan.length} migrations...`);
    
    this.state.phase = 'migrating';

    for (const migration of plan) {
      console.log(`⏳ Migration: ${migration.name}`);
      
      const migrationStart = Date.now();
      
      try {
        // Pre-migration validation
        await this.validateMigrationPrerequisites(migration);
        
        // Execute migration with timeout
        await this.executeWithTimeout(migration.execute, migration.estimatedDuration || 10000);
        
        // Record success
        this.state.completedMigrations.push({
          ...migration,
          executedAt: migrationStart,
          duration: Date.now() - migrationStart
        });

        // Add to rollback stack (for non-critical migrations)
        if (migration.rollback && !migration.critical) {
          this.rollbackStack.push(migration);
        }

        console.log(`✅ Completed: ${migration.name}`);

      } catch (error) {
        console.error(`❌ Migration failed: ${migration.name}`, error);
        
        this.state.failedMigrations.push({
          ...migration,
          error: error.message,
          failedAt: Date.now()
        });

        if (migration.critical) {
          // Critical migration failure - initiate rollback
          await this.initiateRollback();
          throw new Error(`Critical migration failed: ${migration.name} - ${error.message}`);
        } else {
          // Non-critical failure - log and continue with degradation
          await this.handleDegradedMigration(migration, error);
        }
      }
    }
  }

  /**
   * Execute function with timeout protection
   */
  executeWithTimeout(fn, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Migration timeout after ${timeout}ms`));
      }, timeout);

      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Post-update cleanup and optimization
   */
  async performPostUpdateTasks() {
    console.log('🧹 Performing post-update cleanup...');
    this.state.phase = 'cleanup';

    // Clear obsolete caches
    await this.clearObsoleteCaches();

    // Update version markers
    await this.updateVersionMarkers();

    // Rebuild indexes if needed
    await this.rebuildDatabaseIndexes();

    // Notify components of update
    await this.notifyUpdateCompletion();

    // Schedule optimization tasks
    this.schedulePostOptimization();
  }

  /**
   * Handle update failure with rollback capability
   */
  async handleUpdateFailure(error) {
    console.error('💥 Update failed:', error);
    
    this.state.phase = 'failed';
    this.state.endTime = Date.now();

    // Attempt rollback if possible
    if (this.rollbackStack.length > 0) {
      await this.initiateRollback();
    }

    // Store error state
    await chrome.storage.local.set({
      'update_error': {
        error: error.message,
        state: this.state,
        timestamp: Date.now()
      }
    });

    await this.logUpdateEvent('failure', { error: error.message });

    // Notify user if critical
    await this.notifyUpdateFailure(error);
  }

  /**
   * Initiate rollback of completed migrations
   */
  async initiateRollback() {
    console.warn('⏪ Initiating rollback...');
    
    this.state.phase = 'rolling_back';

    // Rollback in reverse order
    while (this.rollbackStack.length > 0) {
      const migration = this.rollbackStack.pop();
      
      try {
        console.log(`Rolling back: ${migration.name}`);
        await migration.rollback();
      } catch (rollbackError) {
        console.error(`Rollback failed for ${migration.name}:`, rollbackError);
        // Continue with other rollbacks
      }
    }
  }

  // ==================== MIGRATION IMPLEMENTATIONS ====================

  /**
   * Migration 1.0.0 → 1.1.0: Schema v1 to v2
   */
  async migrateSchemaV1ToV2() {
    const db = await new Schema().open();
    
    // Add compression support to image cache
    const transaction = db.transaction(['imageCache'], 'readwrite');
    const store = transaction.objectStore('imageCache');
    
    // Migrate existing entries
    const entries = await store.getAll();
    
    for (const entry of entries) {
      if (!entry.compressed) {
        entry.compressed = false;
        entry.compressionVersion = 1;
        await store.put(entry);
      }
    }
  }

  async rollbackSchemaV1ToV2() {
    // Remove compression metadata
    const db = await new Schema().open();
    const transaction = db.transaction(['imageCache'], 'readwrite');
    const store = transaction.objectStore('imageCache');
    
    const entries = await store.getAll();
    for (const entry of entries) {
      delete entry.compressed;
      delete entry.compressionVersion;
      await store.put(entry);
    }
  }

  /**
   * Migration 1.1.0 → 1.2.0: OCR Config Enhancement
   */
  async migrateOCRConfigV1_2() {
    const config = await this.configManager.get('ocr');
    
    const newConfig = {
      ...config,
      preprocessing: {
        denoise: true,
        binarize: true,
        deskew: true,
        contrastEnhancement: 1.2
      },
      advanced: {
        psm: 6, // Page segmentation mode
        oem: 3, // OCR engine mode
        tessjs_create_pdf: '0'
      }
    };
    
    await this.configManager.set('ocr', newConfig);
    
    // Backup old config
    await this.configManager.set('ocr_v1_backup', config);
  }

  async rollbackOCRConfigV1_2() {
    const backup = await this.configManager.get('ocr_v1_backup');
    if (backup) {
      await this.configManager.set('ocr', backup);
      await this.configManager.remove('ocr_v1_backup');
    }
  }

  /**
   * Migration 1.2.0 → 1.3.0: Translation Cache Optimization
   */
  async migrateTranslationCacheV1_3() {
    const oldCache = await TranslationCache.getAllLegacy();
    const newCache = new Map();

    // Reorganize with content-based hashing
    for (const [key, value] of oldCache) {
      const hash = await this.hashContent(value.sourceText);
      const newKey = `v2_${hash}_${value.targetLanguage}`;
      
      newCache.set(newKey, {
        ...value,
        hash,
        version: 2,
        migratedAt: Date.now()
      });
    }

    // Clear and repopulate
    await TranslationCache.clear();
    
    for (const [key, value] of newCache) {
      await TranslationCache.set(key, value);
    }

    // Store migration metadata
    await this.configManager.set('cache_migration_v1_3', {
      migrated: oldCache.size,
      timestamp: Date.now()
    });
  }

  async rollbackTranslationCacheV1_3() {
    // Restore from backup if exists, otherwise clear
    await TranslationCache.clear();
    await this.configManager.remove('cache_migration_v1_3');
  }

  /**
   * Migration 1.3.0 → 1.4.0: Encryption Upgrade
   */
  async migrateEncryptionV1_4() {
    // Re-encrypt all sensitive data with new algorithm
    const sensitiveKeys = ['licenseKey', 'apiKeys', 'userTokens'];
    
    for (const key of sensitiveKeys) {
      const value = await this.secureStorage.getLegacy(key);
      if (value) {
        await this.secureStorage.set(key, value, { 
          algorithm: 'AES-256-GCM',
          migrate: true 
        });
      }
    }

    // Update encryption marker
    await this.configManager.set('encryptionVersion', 2);
  }

  async rollbackEncryptionV1_4() {
    // Restore legacy encryption
    await this.configManager.set('encryptionVersion', 1);
  }

  /**
   * Migration 1.4.0 → 2.0.0: MV3 Architecture Migration
   */
  async migrateToMV3() {
    // Convert background page to service worker compatibility
    const legacyStorage = await chrome.storage.local.get(null);
    
    // Migrate alarm-based schedules
    const { AlarmScheduler } = await import('./alarm-scheduler.js');
    const scheduler = new AlarmScheduler();
    await scheduler.migrateFromMV2(legacyStorage.schedules || []);

    // Update content script injection patterns
    await this.updateContentScriptRegistration();

    // Migrate offscreen document settings
    await this.configManager.set('mv3MigrationComplete', true);
  }

  /**
   * Migration 2.0.0 → 2.1.0: WASM Module Optimization
   */
  async migrateWASMModulesV2_1() {
    // Clear old WASM cache
    await caches.delete('wasm-cache-v1');
    
    // Preload new WASM modules
    const wasmModules = [
      'core-crypto.wasm',
      'ocr-engine.wasm',
      'cv-detection.wasm'
    ];

    for (const module of wasmModules) {
      await this.prefetchWASM(module);
    }

    await this.configManager.set('wasmVersion', 2);
  }

  async rollbackWASMModulesV2_1() {
    await caches.delete('wasm-cache-v2');
    await this.configManager.set('wasmVersion', 1);
  }

  /**
   * Migration 2.1.0 → 2.2.0: Privacy Consent v2
   */
  async migratePrivacyConsentV2_2() {
    const consentManager = new ConsentManager();
    
    // Migrate old consent to new format
    const oldConsent = await this.configManager.get('privacyConsent');
    
    if (oldConsent) {
      const newConsent = {
        version: 2,
        timestamp: Date.now(),
        purposes: {
          essential: true,
          functional: oldConsent.functional || false,
          analytics: oldConsent.analytics || false,
          marketing: false // New purpose, default false
        },
        region: oldConsent.region || 'unknown',
        migrated: true
      };
      
      await consentManager.setConsent(newConsent);
    }
  }

  async rollbackPrivacyConsentV2_2() {
    // Cannot fully rollback consent, but can mark as legacy
    await this.configManager.set('privacyConsentLegacy', true);
  }

  /**
   * Migration 2.2.0 → 3.0.0: Major Architecture Rewrite
   */
  async migrateToV3Architecture() {
    // Export all user data
    const userData = await this.exportUserData();
    
    // Store backup
    await this.secureStorage.set('v2_backup', userData, { encrypted: true });

    // Clear incompatible caches
    await TranslationCache.clear();
    await ImageCache.clear();

    // Reset CV model cache
    await caches.delete('tfjs-models');

    // Reinitialize with new architecture
    const schema = new Schema();
    await schema.upgradeToV3();

    // Restore user settings (compatible ones only)
    const compatibleSettings = this.filterCompatibleSettings(userData.settings);
    await this.configManager.setMultiple(compatibleSettings);
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Create system backup before critical migrations
   */
  async createSystemBackup() {
    console.log('💾 Creating system backup...');
    
    const backup = {
      version: this.state.previousVersion,
      timestamp: Date.now(),
      settings: await this.configManager.getAll(),
      storage: await chrome.storage.local.get(null)
    };

    await this.secureStorage.set('system_backup_pre_migration', backup, {
      encrypted: true,
      expiration: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }

  /**
   * Clear obsolete caches after update
   */
  async clearObsoleteCaches() {
    const obsoleteCaches = [
      'temp-ocr-cache',
      'legacy-translations',
      'deprecated-models'
    ];

    for (const cacheName of obsoleteCaches) {
      try {
        await caches.delete(cacheName);
      } catch (e) {
        console.warn(`Failed to delete cache ${cacheName}:`, e);
      }
    }
  }

  /**
   * Update version markers in storage
   */
  async updateVersionMarkers() {
    await this.configManager.setMultiple({
      'previousVersion': this.state.previousVersion,
      'currentVersion': this.state.currentVersion,
      'lastUpdated': Date.now(),
      'updateCount': (await this.configManager.get('updateCount') || 0) + 1
    });
  }

  /**
   * Rebuild database indexes if schema changed
   */
  async rebuildDatabaseIndexes() {
    const schema = new Schema();
    await schema.rebuildIndexes();
  }

  /**
   * Notify components of update completion
   */
  async notifyUpdateCompletion() {
    // Notify all extension pages
    chrome.runtime.sendMessage({
      type: 'UPDATE_COMPLETED',
      data: {
        from: this.state.previousVersion,
        to: this.state.currentVersion,
        migrations: this.state.completedMigrations.length
      }
    }).catch(() => {});

    // Show update notification if major version
    if (this.isMajorVersionChange()) {
      await this.showUpdateNotification();
    }
  }

  /**
   * Schedule post-update optimization tasks
   */
  schedulePostOptimization() {
    // Schedule cache compaction
    chrome.alarms.create('post_update_optimization', {
      delayInMinutes: 60 // Run 1 hour after update
    });
  }

  /**
   * Parse version string to object
   */
  parseVersion(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    return { major, minor, patch };
  }

  /**
   * Convert version object to string
   */
  versionToString(v) {
    return `${v.major}.${v.minor}.${v.patch}`;
  }

  /**
   * Compare two version objects
   */
  compareVersions(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  }

  /**
   * Increment version (helper for migration chain)
   */
  incrementVersion(v) {
    const next = { ...v };
    next.patch++;
    if (next.patch > 9) {
      next.patch = 0;
      next.minor++;
    }
    if (next.minor > 9) {
      next.minor = 0;
      next.major++;
    }
    return next;
  }

  /**
   * Check if this is a major version change
   */
  isMajorVersionChange() {
    const from = this.parseVersion(this.state.previousVersion);
    const to = this.parseVersion(this.state.currentVersion);
    return from.major !== to.major;
  }

  /**
   * Hash content for cache keys
   */
  async hashContent(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Export all user data for backup
   */
  async exportUserData() {
    return {
      settings: await this.configManager.getAll(),
      timestamp: Date.now(),
      version: this.state.previousVersion
    };
  }

  /**
   * Filter compatible settings for major migration
   */
  filterCompatibleSettings(settings) {
    const compatibleKeys = [
      'ocr.languages',
      'translation.targetLanguage',
      'ui.theme',
      'privacy.dataRetentionDays'
    ];
    
    const filtered = {};
    for (const key of compatibleKeys) {
      if (settings[key] !== undefined) {
        filtered[key] = settings[key];
      }
    }
    return filtered;
  }

  /**
   * Show update notification to user
   */
  async showUpdateNotification() {
    await chrome.notifications.create('update-complete', {
      type: 'basic',
      iconUrl: 'build/assets/icons/icon128.png',
      title: 'Mangekyo Updated',
      message: `Updated to v${this.state.currentVersion}. Click to see what's new.`,
      priority: 1
    });
  }

  /**
   * Log update event
   */
  async logUpdateEvent(status, details = {}) {
    const logEntry = {
      type: 'update',
      status,
      from: this.state.previousVersion,
      to: this.state.currentVersion,
      duration: this.state.endTime - this.state.startTime,
      migrations: this.state.completedMigrations.length,
      failed: this.state.failedMigrations.length,
      timestamp: Date.now(),
      ...details
    };

    const logs = await chrome.storage.local.get('update_logs') || { logs: [] };
    logs.logs = logs.logs || [];
    logs.logs.push(logEntry);
    
    if (logs.logs.length > 20) logs.logs.shift();
    
    await chrome.storage.local.set({ 'update_logs': logs });
  }

  // Placeholder methods for checks
  async checkStorageAvailability() { return true; }
  async checkSchemaCompatibility() { return true; }
  async checkPermissions() { return true; }
  async checkAvailableSpace() { return true; }
  async validateMigrationPrerequisites(migration) { return true; }
  async handleDegradedMigration(migration, error) { 
    console.warn(`Degraded mode for ${migration.name}:`, error);
  }
  async updateContentScriptRegistration() {}
  async prefetchWASM(module) {}
}

// Export singleton
export const updateHandler = new UpdateHandler();

// Chrome event listener
chrome.runtime.onUpdateAvailable.addListener((details) => {
  console.log('Update available:', details.version);
  // Optionally prompt user or auto-update
});