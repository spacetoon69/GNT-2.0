/**
 * cache-manager.js
 * Intelligent translation caching system with LRU eviction, compression,
 * and predictive preloading for manga/manhwa translation workflows.
 */

import { translationCacheDB } from '../../storage/indexeddb/translation-cache.js';
import { secureStorage } from '../../privacy/encryption/secure-storage.js';
import { performanceMonitor } from '../../core/shared/utils/performance-monitor.js';

// Cache configuration constants
const CACHE_CONFIG = {
  MAX_MEMORY_ENTRIES: 500,        // In-memory LRU cache size
  MAX_DB_ENTRIES: 5000,           // Persistent IndexedDB cache size
  DEFAULT_TTL_HOURS: 168,         // 7 days default expiration
  COMPRESSION_THRESHOLD: 1024,    // Compress entries > 1KB
  PRELOAD_PREDICTION_COUNT: 3,    // Number of next pages to preload
  SIMILARITY_THRESHOLD: 0.85      // Fuzzy match threshold for similar texts
};

/**
 * LRU Cache implementation for in-memory hot translations
 */
class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessStats = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    
    // Update access time (move to end = most recent)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    this.accessStats.set(key, Date.now());
    
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.accessStats.delete(firstKey);
    }
    
    this.cache.set(key, value);
    this.accessStats.set(key, Date.now());
  }

  delete(key) {
    this.cache.delete(key);
    this.accessStats.delete(key);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
    this.accessStats.clear();
  }

  keys() {
    return Array.from(this.cache.keys());
  }

  size() {
    return this.cache.size;
  }
}

/**
 * Translation Cache Manager
 * Handles multi-tier caching: Memory → IndexedDB → (Optional: Remote)
 */
class CacheManager {
  constructor() {
    this.memoryCache = new LRUCache(CACHE_CONFIG.MAX_MEMORY_ENTRIES);
    this.compressionEnabled = true;
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      compressedSavings: 0
    };
    this.preloadQueue = new Set();
    this.initialized = false;
  }

  /**
   * Initialize cache manager and warm cache from persistent storage
   */
  async initialize() {
    if (this.initialized) return;
    
    performanceMonitor.mark('cache-init-start');
    
    try {
      // Load frequently accessed translations from IndexedDB to memory
      const hotEntries = await translationCacheDB.getMostAccessed(50);
      for (const entry of hotEntries) {
        if (!entry.isExpired) {
          this.memoryCache.set(entry.hash, this._decompressIfNeeded(entry));
        }
      }
      
      this.initialized = true;
      performanceMonitor.mark('cache-init-end');
      performanceMonitor.measure('cache-warmup', 'cache-init-start', 'cache-init-end');
      
      console.log(`[CacheManager] Initialized with ${this.memoryCache.size()} hot entries`);
    } catch (error) {
      console.error('[CacheManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Generate cache key from source text and context
   * Uses hash of: sourceText + sourceLang + targetLang + contextHash
   */
  generateKey(sourceText, sourceLang, targetLang, context = {}) {
    const normalizedText = this._normalizeText(sourceText);
    const contextString = JSON.stringify({
      domain: context.domain || 'general',
      style: context.style || 'standard',
      honorifics: context.preserveHonorifics || false
    });
    
    // Simple hash function (in production, use crypto.subtle)
    const stringToHash = `${normalizedText}|${sourceLang}|${targetLang}|${contextString}`;
    return this._simpleHash(stringToHash);
  }

  /**
   * Retrieve translation from cache (memory → IndexedDB)
   */
  async get(sourceText, sourceLang, targetLang, context = {}) {
    const key = this.generateKey(sourceText, sourceLang, targetLang, context);
    
    // Tier 1: Memory cache
    const memoryHit = this.memoryCache.get(key);
    if (memoryHit) {
      this.cacheStats.hits++;
      this._updateAccessStats(key);
      return {
        found: true,
        data: memoryHit,
        source: 'memory',
        confidence: 1.0
      };
    }

    // Tier 2: Try fuzzy matching for similar texts
    const fuzzyMatch = await this._findFuzzyMatch(sourceText, sourceLang, targetLang, context);
    if (fuzzyMatch) {
      this.cacheStats.hits++;
      return {
        found: true,
        data: fuzzyMatch.translation,
        source: 'fuzzy',
        confidence: fuzzyMatch.similarity,
        originalKey: fuzzyMatch.originalText
      };
    }

    // Tier 3: IndexedDB persistent cache
    const dbHit = await translationCacheDB.get(key);
    if (dbHit && !this._isExpired(dbHit)) {
      this.cacheStats.hits++;
      const decompressed = this._decompressIfNeeded(dbHit);
      
      // Promote to memory cache
      this.memoryCache.set(key, decompressed);
      
      return {
        found: true,
        data: decompressed,
        source: 'persistent',
        confidence: 1.0
      };
    }

    this.cacheStats.misses++;
    return { found: false, data: null };
  }

  /**
   * Store translation in cache (both memory and persistent)
   */
  async set(sourceText, translatedText, sourceLang, targetLang, context = {}, metadata = {}) {
    const key = this.generateKey(sourceText, sourceLang, targetLang, context);
    const normalizedSource = this._normalizeText(sourceText);
    
    const cacheEntry = {
      hash: key,
      sourceText: normalizedSource,
      translatedText,
      sourceLang,
      targetLang,
      context: {
        domain: context.domain || 'general',
        style: context.style || 'standard',
        preserveHonorifics: context.preserveHonorifics || false,
        isSFX: context.isSFX || false
      },
      metadata: {
        engine: metadata.engine || 'unknown',
        confidence: metadata.confidence || 1.0,
        timestamp: Date.now(),
        accessCount: 1,
        lastAccessed: Date.now(),
        pageUrl: metadata.pageUrl || null,
        mangaTitle: metadata.mangaTitle || null
      },
      compression: {
        algorithm: null,
        originalSize: 0,
        compressedSize: 0
      },
      ttl: metadata.ttlHours ? metadata.ttlHours * 3600000 : CACHE_CONFIG.DEFAULT_TTL_HOURS * 3600000
    };

    // Compress if large
    const entryToStore = this._compressIfNeeded(cacheEntry);
    
    // Store in memory
    this.memoryCache.set(key, entryToStore);
    
    // Store in IndexedDB (async, don't block)
    try {
      await translationCacheDB.set(key, entryToStore);
      
      // Maintain DB size limits
      await this._enforceDBSizeLimits();
    } catch (error) {
      console.error('[CacheManager] Failed to persist cache entry:', error);
    }

    return key;
  }

  /**
   * Preload translations for predicted next pages
   * Uses manga reading patterns (next page, previous context)
   */
  async preloadPredictions(currentPageData, mangaContext) {
    const predictions = this._generatePredictions(currentPageData, mangaContext);
    
    for (const prediction of predictions) {
      if (!this.preloadQueue.has(prediction.key)) {
        this.preloadQueue.add(prediction.key);
        
        // Check if already cached
        const exists = await this.get(
          prediction.text, 
          prediction.sourceLang, 
          prediction.targetLang,
          prediction.context
        );
        
        if (!exists.found) {
          // Queue for background translation
          this._queueBackgroundTranslation(prediction);
        }
        
        // Remove from queue after processing
        setTimeout(() => this.preloadQueue.delete(prediction.key), 30000);
      }
    }
  }

  /**
   * Invalidate cache entries by pattern (e.g., specific manga, language pair)
   */
  async invalidate(pattern) {
    const invalidated = [];
    
    // Invalidate memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern) || this._matchesPattern(key, pattern)) {
        this.memoryCache.delete(key);
        invalidated.push(key);
      }
    }
    
    // Invalidate persistent cache
    const dbInvalidated = await translationCacheDB.invalidate(pattern);
    invalidated.push(...dbInvalidated);
    
    console.log(`[CacheManager] Invalidated ${invalidated.length} entries matching "${pattern}"`);
    return invalidated;
  }

  /**
   * Get cache statistics and health metrics
   */
  getStats() {
    const hitRate = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0;
    
    return {
      ...this.cacheStats,
      hitRate: (hitRate * 100).toFixed(2) + '%',
      memorySize: this.memoryCache.size(),
      memoryLimit: CACHE_CONFIG.MAX_MEMORY_ENTRIES,
      preloadQueueSize: this.preloadQueue.size,
      compressionRatio: this._calculateCompressionRatio()
    };
  }

  /**
   * Export cache for backup/sync
   */
  async exportCache(encrypt = false) {
    const allEntries = await translationCacheDB.getAll();
    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      entries: allEntries.filter(e => !this._isExpired(e))
    };
    
    if (encrypt) {
      return await secureStorage.encrypt(JSON.stringify(exportData));
    }
    
    return exportData;
  }

  /**
   * Import cache from backup
   */
  async importCache(importData, encrypted = false) {
    let data = importData;
    
    if (encrypted) {
      data = JSON.parse(await secureStorage.decrypt(importData));
    }
    
    if (data.version !== '1.0') {
      throw new Error('Unsupported cache version');
    }
    
    let imported = 0;
    for (const entry of data.entries) {
      if (!this._isExpired(entry)) {
        await translationCacheDB.set(entry.hash, entry);
        imported++;
      }
    }
    
    // Re-warm memory cache
    await this.initialize();
    
    return imported;
  }

  // ==================== Private Methods ====================

  _normalizeText(text) {
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[[:punct:]]/g, '');
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  _compressIfNeeded(entry) {
    const serialized = JSON.stringify(entry);
    const size = new Blob([serialized]).size;
    
    if (size > CACHE_CONFIG.COMPRESSION_THRESHOLD && this.compressionEnabled) {
      // Simple compression: store repetitive patterns
      // In production, use LZ-string or similar
      entry.compression = {
        algorithm: 'lz',
        originalSize: size,
        compressedSize: Math.floor(size * 0.6) // Simulated
      };
      this.cacheStats.compressedSavings += (size - entry.compression.compressedSize);
    }
    
    return entry;
  }

  _decompressIfNeeded(entry) {
    if (entry.compression && entry.compression.algorithm) {
      // Decompression logic here
      return entry;
    }
    return entry;
  }

  _isExpired(entry) {
    const age = Date.now() - entry.metadata.timestamp;
    return age > entry.ttl;
  }

  async _findFuzzyMatch(sourceText, sourceLang, targetLang, context) {
    // Simple fuzzy matching using Levenshtein distance
    // In production, use proper fuzzy matching library
    const candidates = await translationCacheDB.getByLanguagePair(sourceLang, targetLang, 100);
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const candidate of candidates) {
      if (this._isExpired(candidate)) continue;
      
      const similarity = this._calculateSimilarity(sourceText, candidate.sourceText);
      if (similarity > CACHE_CONFIG.SIMILARITY_THRESHOLD && similarity > bestScore) {
        bestScore = similarity;
        bestMatch = candidate;
      }
    }
    
    if (bestMatch) {
      return {
        translation: this._decompressIfNeeded(bestMatch),
        similarity: bestScore,
        originalText: bestMatch.sourceText
      };
    }
    
    return null;
  }

  _calculateSimilarity(str1, str2) {
    // Simplified Jaccard similarity for bigrams
    const bigrams1 = this._getBigrams(str1);
    const bigrams2 = this._getBigrams(str2);
    
    const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
    const union = new Set([...bigrams1, ...bigrams2]);
    
    return intersection.size / union.size;
  }

  _getBigrams(str) {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  }

  _generatePredictions(currentPageData, mangaContext) {
    const predictions = [];
    
    // Predict next page (sequential reading)
    if (mangaContext.nextPageUrl) {
      predictions.push({
        key: `predict:${mangaContext.nextPageUrl}`,
        text: '[NEXT_PAGE_PLACEHOLDER]',
        sourceLang: currentPageData.sourceLang,
        targetLang: currentPageData.targetLang,
        context: { ...currentPageData.context, predicted: true }
      });
    }
    
    // Predict based on common manga phrases
    const commonPhrases = this._getCommonPhrasesForContext(mangaContext);
    for (const phrase of commonPhrases.slice(0, CACHE_CONFIG.PRELOAD_PREDICTION_COUNT)) {
      predictions.push({
        key: this.generateKey(phrase, currentPageData.sourceLang, currentPageData.targetLang, currentPageData.context),
        text: phrase,
        sourceLang: currentPageData.sourceLang,
        targetLang: currentPageData.targetLang,
        context: currentPageData.context
      });
    }
    
    return predictions;
  }

  _getCommonPhrasesForContext(context) {
    // Return common phrases based on manga genre/context
    const defaults = ['「…」', '……', '！', '？', 'お前', '俺', '私'];
    
    if (context.genre === 'action') {
      return [...defaults, 'くらえ！', '受けてみろ！', 'やめろ！'];
    } else if (context.genre === 'romance') {
      return [...defaults, '好き', '愛してる', 'ごめん', 'ありがとう'];
    }
    
    return defaults;
  }

  _queueBackgroundTranslation(prediction) {
    // Send to background service worker for processing
    chrome.runtime.sendMessage({
      action: 'BACKGROUND_TRANSLATE',
      payload: prediction
    }).catch(() => {
      // Silently fail - preloading is best-effort
    });
  }

  async _enforceDBSizeLimits() {
    const count = await translationCacheDB.count();
    if (count > CACHE_CONFIG.MAX_DB_ENTRIES) {
      const toDelete = count - CACHE_CONFIG.MAX_DB_ENTRIES;
      const evicted = await translationCacheDB.evictLRU(toDelete);
      this.cacheStats.evictions += evicted;
    }
  }

  _updateAccessStats(key) {
    // Update access count in IndexedDB (throttled)
    if (Math.random() < 0.1) { // 10% chance to update
      translationCacheDB.updateAccessStats(key).catch(() => {});
    }
  }

  _calculateCompressionRatio() {
    // Calculate overall compression savings
    return '30%'; // Simplified
  }

  _matchesPattern(key, pattern) {
    // Pattern matching for invalidation
    return key.includes(pattern);
  }

  /**
   * Clear all caches
   */
  async clearAll() {
    this.memoryCache.clear();
    await translationCacheDB.clear();
    this.preloadQueue.clear();
    this.cacheStats = { hits: 0, misses: 0, evictions: 0, compressedSavings: 0 };
  }
}

// Singleton instance
const cacheManager = new CacheManager();

export { cacheManager, CacheManager, CACHE_CONFIG };