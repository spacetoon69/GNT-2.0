// core/background/lifecycle/install-handler.js

import { CONFIG } from '../../shared/constants.js';
import { ConfigManager } from '../../shared/config-manager.js';
import { SecureStorage } from '../../../privacy/encryption/secure-storage.js';
import { LicenseValidator } from '../../../security/license/license-validator.js';
import { HardwareFingerprint } from '../../../security/license/hardware-fingerprint.js';
import { TranslationCache } from '../../../storage/indexeddb/translation-cache.js';
import { ImageCache } from '../../../storage/indexeddb/image-cache.js';
import { Schema } from '../../../storage/indexeddb/schema.js';
import { ConsentManager } from '../../../privacy/data-handling/consent-manager.js';

/**
 * Install Handler - Manages extension installation and initialization
 * Handles first-run setup, database initialization, license validation,
 * and onboarding flow for the Mangekyo extension
 */
class InstallHandler {
  constructor() {
    this.configManager = new ConfigManager();
    this.secureStorage = new SecureStorage();
    this.licenseValidator = new LicenseValidator();
    this.hardwareFingerprint = new HardwareFingerprint();
    this.consentManager = new ConsentManager();
    
    this.installationState = {
      phase: 'pending', // pending, initializing, validating, configuring, complete
      progress: 0,
      errors: [],
      warnings: []
    };
  }

  /**
   * Main entry point - called on extension install/update
   */
  async handleInstall(details) {
    console.log('🌟 Mangekyo Extension Install Handler Initiated', {
      reason: details.reason,
      previousVersion: details.previousVersion,
      currentVersion: chrome.runtime.getManifest().version
    });

    try {
      // Determine install type
      const installType = this.determineInstallType(details);
      
      switch (installType) {
        case 'fresh_install':
          await this.handleFreshInstall();
          break;
        case 'update':
          await this.handleUpdate(details.previousVersion);
          break;
        case 'chrome_update':
          await this.handleBrowserUpdate();
          break;
        default:
          throw new Error(`Unknown install type: ${installType}`);
      }

      // Log successful initialization
      await this.logInstallationEvent('success', { installType });
      
    } catch (error) {
      console.error('❌ Installation failed:', error);
      await this.handleInstallFailure(error);
      throw error;
    }
  }

  /**
   * Determine type of installation event
   */
  determineInstallType(details) {
    if (details.reason === 'install') return 'fresh_install';
    if (details.reason === 'update') return 'update';
    if (details.reason === 'chrome_update') return 'chrome_update';
    return 'unknown';
  }

  /**
   * Handle fresh installation - full setup sequence
   */
  async handleFreshInstall() {
    console.log('🆕 Starting fresh installation sequence...');
    this.installationState.phase = 'initializing';

    // Phase 1: Initialize storage infrastructure
    await this.initializeStorage();
    this.updateProgress(20);

    // Phase 2: Generate or validate hardware fingerprint
    await this.initializeHardwareBinding();
    this.updateProgress(35);

    // Phase 3: License validation (if applicable)
    await this.validateLicenseStatus();
    this.updateProgress(50);

    // Phase 4: Setup default configuration
    await this.setupDefaultConfiguration();
    this.updateProgress(65);

    // Phase 5: Preload language data for OCR
    await this.preloadLanguageModels();
    this.updateProgress(80);

    // Phase 6: Privacy consent and GDPR compliance
    await this.initializePrivacyConsent();
    this.updateProgress(90);

    // Phase 7: Open onboarding page
    await this.launchOnboarding();
    this.updateProgress(100);

    this.installationState.phase = 'complete';
    console.log('✅ Fresh installation completed successfully');
  }

  /**
   * Handle extension update - migration and compatibility
   */
  async handleUpdate(previousVersion) {
    console.log(`⬆️ Updating from ${previousVersion} to ${CONFIG.VERSION}`);
    this.installationState.phase = 'updating';

    const currentVersion = CONFIG.VERSION;
    const migrationChain = this.buildMigrationChain(previousVersion, currentVersion);

    // Execute migrations in sequence
    for (const migration of migrationChain) {
      console.log(`Running migration: ${migration.name}`);
      await migration.execute();
    }

    // Clear caches that might be incompatible
    await this.invalidateStaleCaches();

    // Update version marker
    await this.configManager.set('lastInstalledVersion', currentVersion);
    await this.configManager.set('updatedAt', Date.now());

    console.log('✅ Update completed successfully');
  }

  /**
   * Handle Chrome browser update
   */
  async handleBrowserUpdate() {
    console.log('🔄 Browser updated - checking compatibility...');
    
    // Verify MV3 APIs are still available
    const mv3Check = await this.verifyManifestV3Compatibility();
    if (!mv3Check.compatible) {
      this.installationState.warnings.push(mv3Check.warning);
    }

    // Re-register service worker alarms if needed
    await this.reenablePeriodicTasks();
  }

  /**
   * Initialize IndexedDB and storage schemas
   */
  async initializeStorage() {
    console.log('💾 Initializing storage infrastructure...');
    
    const schema = new Schema();
    
    try {
      // Initialize database with version tracking
      await schema.initialize({
        name: CONFIG.DB_NAME,
        version: CONFIG.DB_VERSION,
        stores: [
          'translations',
          'imageCache',
          'settings',
          'licenseData',
          'consentRecords',
          'performanceMetrics'
        ]
      });

      // Initialize cache managers
      await TranslationCache.initialize();
      await ImageCache.initialize();

      // Setup secure storage keys
      await this.secureStorage.initializeKeys();

    } catch (error) {
      throw new Error(`Storage initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate hardware fingerprint for license binding
   */
  async initializeHardwareBinding() {
    console.log('🔐 Initializing hardware fingerprint...');
    
    try {
      const fingerprint = await this.hardwareFingerprint.generate();
      await this.secureStorage.set('hardwareFingerprint', fingerprint, { encrypted: true });
      
      // Store hash for tamper detection
      const fingerprintHash = await this.hardwareFingerprint.hash(fingerprint);
      await chrome.storage.local.set({ 'fp_hash': fingerprintHash });

    } catch (error) {
      // Non-fatal: Continue with reduced security mode
      this.installationState.warnings.push('Hardware binding unavailable');
      console.warn('Hardware fingerprint failed:', error);
    }
  }

  /**
   * Validate license or setup trial
   */
  async validateLicenseStatus() {
    console.log('🔑 Validating license status...');
    
    const storedLicense = await this.secureStorage.get('licenseKey', { encrypted: true });
    
    if (storedLicense) {
      // Validate existing license
      const validation = await this.licenseValidator.validate(storedLicense);
      
      if (validation.valid) {
        await this.configManager.set('licenseStatus', 'active');
        await this.configManager.set('licenseTier', validation.tier);
      } else {
        await this.handleInvalidLicense(validation.reason);
      }
    } else {
      // Setup trial mode
      await this.initializeTrialMode();
    }
  }

  /**
   * Initialize trial period for new users
   */
  async initializeTrialMode() {
    console.log('🎁 Setting up trial mode...');
    
    const trialConfig = {
      type: 'trial',
      startedAt: Date.now(),
      expiresAt: Date.now() + (CONFIG.TRIAL_DAYS * 24 * 60 * 60 * 1000),
      features: ['basic_ocr', 'basic_translation', 'standard_ui'],
      limitations: {
        maxPagesPerDay: 50,
        maxTranslationsCached: 100,
        apiPriority: 'low'
      }
    };

    await this.configManager.set('licenseStatus', 'trial');
    await this.configManager.set('licenseData', trialConfig);
    await this.secureStorage.set('trialId', crypto.randomUUID(), { encrypted: true });
  }

  /**
   * Setup default user configuration
   */
  async setupDefaultConfiguration() {
    console.log('⚙️ Setting up default configuration...');
    
    const defaults = {
      // OCR Settings
      ocr: {
        engine: 'tesseract',
        languages: ['eng', 'jpn'],
        preprocess: true,
        confidenceThreshold: 0.75,
        verticalTextDetection: true
      },
      
      // Translation Settings
      translation: {
        primaryEngine: 'google_translate',
        fallbackEngine: 'deepL',
        targetLanguage: navigator.language.split('-')[0] || 'en',
        preserveHonorifics: true,
        translateSFX: false,
        contextAwareness: true
      },
      
      // UI Settings
      ui: {
        theme: 'dark',
        sharinganPosition: 'bottom-right',
        sharinganSize: 'medium',
        overlayOpacity: 0.95,
        fontFamily: 'Noto Sans JP',
        autoHideDelay: 5000
      },
      
      // Privacy Settings
      privacy: {
        localProcessingOnly: false,
        allowCloudSync: false,
        dataRetentionDays: 30,
        analyticsEnabled: false
      },
      
      // Performance Settings
      performance: {
        maxConcurrentOCR: 2,
        imageCompression: 'medium',
        cacheSizeMB: 100,
        hardwareAcceleration: true
      },
      
      // Site-specific settings
      sites: {
        mangadex: { enabled: true, autoTranslate: false },
        webtoon: { enabled: true, autoTranslate: false },
        cubari: { enabled: true, autoTranslate: false }
      }
    };

    await this.configManager.setMultiple(defaults);
    
    // Mark first run complete
    await this.configManager.set('firstRunCompleted', false); // Will be true after onboarding
    await this.configManager.set('installedAt', Date.now());
  }

  /**
   * Preload critical language data for OCR
   */
  async preloadLanguageModels() {
    console.log('📚 Preloading language models...');
    
    const essentialLanguages = ['eng.traineddata', 'osd.traineddata'];
    const optionalLanguages = ['jpn.traineddata', 'jpn_vert.traineddata', 'kor.traineddata'];
    
    // Preload essential languages immediately
    for (const lang of essentialLanguages) {
      try {
        await this.downloadLanguageModel(lang, { priority: 'high' });
      } catch (error) {
        this.installationState.warnings.push(`Failed to preload ${lang}`);
      }
    }

    // Schedule optional languages for background download
    for (const lang of optionalLanguages) {
      this.scheduleBackgroundDownload(lang);
    }
  }

  /**
   * Download language model with progress tracking
   */
  async downloadLanguageModel(filename, options = {}) {
    const baseUrl = CONFIG.TESSDATA_URL;
    const url = `${baseUrl}/${filename}`;
    
    // Check cache first
    const cached = await ImageCache.get(`lang_${filename}`);
    if (cached) return cached;

    // Download with retry logic
    const response = await fetch(url, {
      priority: options.priority || 'auto',
      credentials: 'omit'
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${filename}: ${response.status}`);
    }

    const data = await response.arrayBuffer();
    await ImageCache.set(`lang_${filename}`, data, {
      expiration: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    return data;
  }

  /**
   * Initialize privacy consent management (GDPR/CCPA)
   */
  async initializePrivacyConsent() {
    console.log('🛡️ Initializing privacy consent...');
    
    const consentRequired = this.consentManager.isConsentRequired();
    
    if (consentRequired) {
      await this.consentManager.initializeConsentFramework({
        regions: ['EU', 'EEA', 'CA', 'BR'], // GDPR, CCPA, LGPD
        purposes: [
          'essential', // Core functionality
          'functional', // OCR/Translation processing
          'analytics', // Optional usage analytics
          'marketing' // Optional feature announcements
        ]
      });
    }

    // Set default minimal data retention
    await this.configManager.set('dataRetentionPolicy', {
      translations: 30, // days
      images: 7, // days
      logs: 90 // days
    });
  }

  /**
   * Launch onboarding page for first-time users
   */
  async launchOnboarding() {
    console.log('🚀 Launching onboarding...');
    
    const onboardingUrl = chrome.runtime.getURL('ui/onboarding/onboarding.html');
    
    // Open in new tab
    await chrome.tabs.create({
      url: onboardingUrl,
      active: true
    });

    // Store onboarding start time
    await this.configManager.set('onboardingStartedAt', Date.now());
  }

  /**
   * Build migration chain for version updates
   */
  buildMigrationChain(fromVersion, toVersion) {
    const migrations = [];
    
    // Version comparison helper
    const v = (str) => str.split('.').map(Number);
    
    // Define migrations
    const migrationRegistry = [
      {
        name: '1.0.0_to_1.1.0',
        condition: () => v(fromVersion) < v('1.1.0'),
        execute: async () => {
          // Migrate old translation cache format
          await this.migrateTranslationCacheV1();
        }
      },
      {
        name: '1.1.0_to_1.2.0',
        condition: () => v(fromVersion) < v('1.2.0'),
        execute: async () => {
          // Add new OCR preprocessing settings
          await this.addOCRPreprocessingConfig();
        }
      },
      {
        name: '1.2.0_to_2.0.0',
        condition: () => v(fromVersion) < v('2.0.0'),
        execute: async () => {
          // Major version: reset certain caches
          await this.resetIncompatibleCaches();
        }
      }
    ];

    for (const migration of migrationRegistry) {
      if (migration.condition()) {
        migrations.push(migration);
      }
    }

    return migrations;
  }

  /**
   * Invalidate caches that may be incompatible with new version
   */
  async invalidateStaleCaches() {
    const cacheNames = ['translation-cache', 'image-cache', 'model-cache'];
    
    for (const name of cacheNames) {
      try {
        await caches.delete(name);
      } catch (e) {
        console.warn(`Failed to delete cache ${name}:`, e);
      }
    }
  }

  /**
   * Re-enable periodic tasks after browser update
   */
  async reenablePeriodicTasks() {
    const { AlarmScheduler } = await import('./alarm-scheduler.js');
    const scheduler = new AlarmScheduler();
    await scheduler.rescheduleAll();
  }

  /**
   * Verify MV3 API compatibility
   */
  async verifyManifestV3Compatibility() {
    const checks = {
      serviceWorker: 'serviceWorker' in navigator,
      offscreenDocument: 'createDocument' in chrome.offscreen || 
                        !!chrome.offscreen?.createDocument,
      storage: !!chrome.storage,
      alarms: !!chrome.alarms
    };

    const allPassed = Object.values(checks).every(v => v);
    
    return {
      compatible: allPassed,
      checks,
      warning: allPassed ? null : 'Some MV3 APIs unavailable after browser update'
    };
  }

  /**
   * Handle installation failure
   */
  async handleInstallFailure(error) {
    this.installationState.phase = 'failed';
    this.installationState.errors.push({
      message: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });

    // Store error for debugging
    await chrome.storage.local.set({
      'install_error': {
        message: error.message,
        state: this.installationState,
        timestamp: Date.now()
      }
    });

    // Attempt graceful degradation
    await this.attemptGracefulDegradation(error);
  }

  /**
   * Attempt to continue with reduced functionality
   */
  async attemptGracefulDegradation(error) {
    console.log('Attempting graceful degradation...');
    
    // Set minimal safe configuration
    await chrome.storage.local.set({
      'emergency_mode': true,
      'minimal_config': {
        ocrEnabled: false,
        translationEnabled: false,
        error: error.message
      }
    });
  }

  /**
   * Update installation progress
   */
  updateProgress(percent) {
    this.installationState.progress = percent;
    
    // Broadcast progress to any listening UI
    chrome.runtime.sendMessage({
      type: 'INSTALL_PROGRESS',
      data: this.installationState
    }).catch(() => {
      // No listeners, ignore
    });
  }

  /**
   * Log installation event for analytics/debugging
   */
  async logInstallationEvent(event, data = {}) {
    const logEntry = {
      event,
      timestamp: Date.now(),
      version: CONFIG.VERSION,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      data
    };

    // Store locally (respect privacy settings)
    const logs = await chrome.storage.local.get('install_logs') || { logs: [] };
    logs.push(logEntry);
    
    // Keep only last 10 logs
    if (logs.length > 10) logs.shift();
    
    await chrome.storage.local.set({ 'install_logs': logs });
  }

  /**
   * Schedule background download for non-critical resources
   */
  scheduleBackgroundDownload(resource) {
    chrome.alarms.create(`download_${resource}`, {
      delayInMinutes: 5 // Download after 5 minutes
    });
  }

  // Migration implementations
  async migrateTranslationCacheV1() {
    // Implementation for cache format migration
    console.log('Migrating translation cache to v1 format...');
  }

  async addOCRPreprocessingConfig() {
    const config = await this.configManager.get('ocr');
    config.preprocessing = {
      denoise: true,
      binarize: true,
      deskew: true
    };
    await this.configManager.set('ocr', config);
  }

  async resetIncompatibleCaches() {
    await this.invalidateStaleCaches();
  }

  async handleInvalidLicense(reason) {
    console.warn('License invalid:', reason);
    await this.configManager.set('licenseStatus', 'invalid');
    await this.configManager.set('licenseInvalidReason', reason);
    // Will trigger re-license flow in onboarding
  }
}

// Export singleton instance
export const installHandler = new InstallHandler();

// Chrome event listener
chrome.runtime.onInstalled.addListener((details) => {
  installHandler.handleInstall(details);
});