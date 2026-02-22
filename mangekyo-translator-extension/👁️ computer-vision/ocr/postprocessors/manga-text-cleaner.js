/**
 * manga-text-cleaner.js
 * 
 * Post-processor for OCR output specifically optimized for manga/manhwa text.
 * Handles vertical text artifacts, furigana removal, sound effect filtering,
 * and Japanese/Korean/Chinese text normalization.
 * 
 * @module computer-vision/ocr/postprocessors/manga-text-cleaner
 */

import { TextSanitizer } from '../../../core/shared/utils/text-sanitizer.js';

/**
 * Configuration for text cleaning behaviors
 */
const CLEANER_CONFIG = {
  // Furigana detection patterns
  FURIGANA_PATTERNS: {
    // Matches hiragana/katakana floating above kanji (ruby text artifacts)
    RUBY_ARTIFACTS: /[\u3040-\u309F\u30A0-\u30FF]{1,3}(?=[\u4E00-\u9FAF])/g,
    // Parenthesized readings that appear inline
    PAREN_READINGS: /（[\u3040-\u309F\u30A0-\u30FF]+）/g,
    // Small text artifacts from vertical layout
    VERTICAL_NOISE: /^[\u3040-\u309F\u30A0-\u30FF]{1,2}$/,
  },
  
  // Sound effects (擬音語/擬態語) to optionally filter
  SFX_PATTERNS: {
    // Common manga sound effect categories
    IMPACT: /^(ドゴ|バコ|ゴゴ|ドカ|バキ|ズバ|ガキ|ボコ)/,
    MOTION: /^(サラ|ヒラ|フワ|スル|ノロ|ユラ|フラ)/,
    EMOTION: /^(ドキ|ワク|ハラ|イラ|メソ|シク)/,
    ATMOSPHERE: /^(シーン|ポカ|ガヤ|ザワ)/,
    // Repeated character patterns (ドキドキ, ワクワク)
    REPETITION: /^(.)\1{1,3}$/,
  },
  
  // OCR artifact patterns
  ARTIFACT_PATTERNS: {
    // Broken vertical text lines
    VERTICAL_BREAKS: /(\w)\s+(\w)/g,
    // Misrecognized punctuation
    PUNCT_NOISE: /[｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ]/g,
    // Mixed script noise (Latin chars in CJK text)
    LATIN_NOISE: /[a-zA-Z]{1,2}(?![a-zA-Z])/g,
    // Box drawing characters from panel borders
    BOX_CHARS: /[┌┐└┘│─├┤┬┴┼╔╗╚╝║═╠╣╦╩╬]/g,
  },
  
  // Context restoration markers
  CONTEXT_MARKERS: {
    SENTENCE_END: /[。！？.!?]+/,
    DIALOGUE_START: /^[「『（"\'「]/,
    DIALOGUE_END: /[」』）"\'」]$/,
    ELLIPSIS: /…+/g,
  }
};

/**
 * Main text cleaner class for manga OCR post-processing
 */
export class MangaTextCleaner {
  constructor(options = {}) {
    this.config = {
      removeFurigana: options.removeFurigana !== false,
      filterSoundEffects: options.filterSoundEffects || false,
      preserveHonorifics: options.preserveHonorifics !== false,
      fixVerticalArtifacts: options.fixVerticalArtifacts !== false,
      targetLanguage: options.targetLanguage || 'auto',
      confidenceThreshold: options.confidenceThreshold || 0.7,
      ...options
    };
    
    this.sanitizer = new TextSanitizer();
    this.processingStats = {
      furiganaRemoved: 0,
      sfxFiltered: 0,
      artifactsCleaned: 0,
      verticalFixed: 0,
    };
  }

  /**
   * Primary entry point: Clean raw OCR output
   * @param {string} rawText - Raw OCR output
   * @param {Object} metadata - OCR metadata (bounding box, confidence, etc.)
   * @returns {CleanedTextResult}
   */
  clean(rawText, metadata = {}) {
    if (!rawText || typeof rawText !== 'string') {
      return this._createResult('', rawText, metadata, ['empty_input']);
    }

    let cleaned = rawText;
    const appliedRules = [];

    // Phase 1: Normalize unicode and encoding artifacts
    cleaned = this._normalizeEncoding(cleaned);
    appliedRules.push('unicode_normalize');

    // Phase 2: Remove furigana/ruby text artifacts
    if (this.config.removeFurigana) {
      const before = cleaned;
      cleaned = this._removeFurigana(cleaned);
      if (before !== cleaned) appliedRules.push('furigana_removal');
    }

    // Phase 3: Fix vertical text reading order artifacts
    if (this.config.fixVerticalArtifacts && metadata.isVertical) {
      const before = cleaned;
      cleaned = this._fixVerticalArtifacts(cleaned);
      if (before !== cleaned) appliedRules.push('vertical_fix');
    }

    // Phase 4: Clean OCR noise characters
    const beforeNoise = cleaned;
    cleaned = this._cleanArtifacts(cleaned);
    if (beforeNoise !== cleaned) appliedRules.push('artifact_removal');

    // Phase 5: Handle sound effects (optional filtering)
    if (this.config.filterSoundEffects && this._isSoundEffect(cleaned)) {
      this.processingStats.sfxFiltered++;
      return this._createResult(null, rawText, metadata, [...appliedRules, 'sfx_filtered']);
    }

    // Phase 6: Context restoration (fix broken sentences)
    cleaned = this._restoreContext(cleaned, metadata);
    appliedRules.push('context_restore');

    // Phase 7: Final normalization
    cleaned = this._finalNormalize(cleaned);
    
    return this._createResult(cleaned, rawText, metadata, appliedRules);
  }

  /**
   * Batch process multiple OCR results
   * @param {Array<{text: string, metadata: Object}>} ocrResults
   * @returns {Array<CleanedTextResult>}
   */
  cleanBatch(ocrResults) {
    // Sort by reading order (top-to-bottom, right-to-left for vertical)
    const sorted = this._sortReadingOrder(ocrResults);
    
    return sorted.map(({ text, metadata }) => this.clean(text, metadata));
  }

  /**
   * Remove furigana (ruby text) artifacts from OCR output
   * @private
   */
  _removeFurigana(text) {
    let cleaned = text;
    const patterns = CLEANER_CONFIG.FURIGANA_PATTERNS;
    
    // Remove parenthesized readings
    cleaned = cleaned.replace(patterns.PAREN_READINGS, '');
    
    // Remove ruby text artifacts (small kana above kanji that got read inline)
    // Strategy: Look for kana-kanji sequences where kana likely represents reading
    const rubyRegex = /([\u3040-\u309F\u30A0-\u30FF]{1,3})([\u4E00-\u9FAF])/g;
    cleaned = cleaned.replace(rubyRegex, (match, kana, kanji) => {
      // Heuristic: If kana length is 1-3 and followed by kanji, likely furigana
      this.processingStats.furiganaRemoved++;
      return kanji;
    });

    // Clean up any remaining isolated small kana blocks
    cleaned = cleaned.split('\n').map(line => {
      return line.replace(new RegExp(patterns.VERTICAL_NOISE, 'g'), '').trim();
    }).join('\n');

    return cleaned.replace(/\s+/g, ' ').trim();
  }

  /**
   * Fix artifacts from vertical text OCR (top-to-bottom, right-to-left)
   * @private
   */
  _fixVerticalArtifacts(text) {
    let fixed = text;
    
    // Fix line break issues in vertical text
    // OCR often reads vertical columns as horizontal lines
    fixed = fixed.replace(/(\S)\s+(\S)/g, (match, char1, char2) => {
      // Check if this looks like a broken vertical line
      if (this._isCJK(char1) && this._isCJK(char2)) {
        this.processingStats.verticalFixed++;
        return char1 + char2; // Remove space between CJK chars
      }
      return match;
    });

    // Fix rotated punctuation
    const verticalPunctMap = {
      '⸺': '——', '︱': '|', '︳': '|', '︴': '|',
      '︰': ':', '︵': '(', '︶': ')', '︷': '{',
      '︸': '}', '︹': '〔', '︺': '〕', '︻': '【',
      '︼': '】', '︽': '《', '︾': '》', '︿': '〈',
      '﹀': '〉', '﹁': '「', '﹂': '」', '﹃': '『',
      '﹄': '』', '﹇': '[', '﹈': ']', '｡': '。',
      '｢': '「', '｣': '」', '､': '、', '･': '・',
    };

    fixed = fixed.replace(/[⸺︱︳︴︰︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈｡｢｣､･]/g, 
      char => verticalPunctMap[char] || char
    );

    return fixed;
  }

  /**
   * Clean general OCR artifacts and noise
   * @private
   */
  _cleanArtifacts(text) {
    let cleaned = text;
    const patterns = CLEANER_CONFIG.ARTIFACT_PATTERNS;

    // Remove box drawing characters (panel borders)
    cleaned = cleaned.replace(patterns.BOX_CHARS, '');
    
    // Clean half-width katakana (common OCR error)
    cleaned = cleaned.replace(patterns.PUNCT_NOISE, match => {
      // Convert half-width to full-width where appropriate
      const fullWidth = String.fromCharCode(match.charCodeAt(0) + 0xFEE0);
      return fullWidth;
    });

    // Remove isolated Latin characters in CJK text (noise)
    cleaned = cleaned.replace(patterns.LATIN_NOISE, '');

    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    this.processingStats.artifactsCleaned++;
    return cleaned;
  }

  /**
   * Detect if text is a sound effect (SFX) rather than dialogue/narration
   * @private
   */
  _isSoundEffect(text) {
    const cleanText = text.trim();
    const patterns = CLEANER_CONFIG.SFX_PATTERNS;
    
    // Check against known SFX patterns
    if (patterns.IMPACT.test(cleanText)) return true;
    if (patterns.MOTION.test(cleanText)) return true;
    if (patterns.EMOTION.test(cleanText)) return true;
    if (patterns.ATMOSPHERE.test(cleanText)) return true;
    
    // Check for repetition pattern (ドキドキ, etc.)
    if (patterns.REPETITION.test(cleanText)) return true;
    
    // Heuristic: All katakana with length 2-6 is likely SFX
    if (/^[\u30A0-\u30FF]{2,6}$/.test(cleanText)) return true;
    
    // Heuristic: Mixed scripts with symbols (*, ☆, ♪, etc.)
    if (/[☆★♪‼⁉♡♥]/.test(cleanText)) return true;
    
    return false;
  }

  /**
   * Restore broken sentence context
   * @private
   */
  _restoreContext(text, metadata) {
    let restored = text;
    const markers = CLEANER_CONFIG.CONTEXT_MARKERS;

    // Fix broken ellipsis
    restored = restored.replace(/\.{3,}/g, '…');
    restored = restored.replace(/。{3,}/g, '…');

    // Ensure proper quotation mark closure
    const openQuotes = (restored.match(/[「『（]/g) || []).length;
    const closeQuotes = (restored.match(/[」』）]/g) || []).length;
    
    if (openQuotes > closeQuotes) {
      restored += '」'; // Auto-close
    }

    // Fix spacing around punctuation
    restored = restored.replace(/\s*([。！？、,.])\s*/g, '$1');

    return restored;
  }

  /**
   * Normalize unicode encoding
   * @private
   */
  _normalizeEncoding(text) {
    // NFC normalization for composed characters
    let normalized = text.normalize('NFC');
    
    // Convert full-width alphanumerics to half-width for consistency
    normalized = normalized.replace(/[\uFF10-\uFF19]/g, char => 
      String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
    );
    
    return normalized;
  }

  /**
   * Final normalization pass
   * @private
   */
  _finalNormalize(text) {
    return text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Control chars
      .replace(/\u200B/g, '') // Zero-width spaces
      .replace(/ {2,}/g, ' ') // Multiple spaces
      .trim();
  }

  /**
   * Sort OCR results by manga reading order (right-to-left, top-to-bottom)
   * @private
   */
  _sortReadingOrder(results) {
    return results.sort((a, b) => {
      const metaA = a.metadata || {};
      const metaB = b.metadata || {};
      
      // Primary: Right-to-left (higher x first)
      const xDiff = (metaB.x || 0) - (metaA.x || 0);
      if (Math.abs(xDiff) > 50) return xDiff; // Significant horizontal difference
      
      // Secondary: Top-to-bottom (lower y first)
      return (metaA.y || 0) - (metaB.y || 0);
    });
  }

  /**
   * Check if character is CJK
   * @private
   */
  _isCJK(char) {
    const code = char.charCodeAt(0);
    return (
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified
      (code >= 0x3040 && code <= 0x309F) || // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) || // Katakana
      (code >= 0xAC00 && code <= 0xD7AF) || // Korean
      (code >= 0xFF00 && code <= 0xFFEF)    // Full-width
    );
  }

  /**
   * Create standardized result object
   * @private
   */
  _createResult(cleaned, original, metadata, rules) {
    return {
      text: cleaned,
      original,
      metadata: {
        ...metadata,
        processingRules: rules,
        isSoundEffect: this._isSoundEffect(original),
        confidence: this._calculateConfidence(cleaned, metadata),
      },
      stats: { ...this.processingStats },
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate confidence score for cleaned text
   * @private
   */
  _calculateConfidence(text, originalMetadata) {
    let score = originalMetadata.confidence || 0.8;
    
    // Penalize very short results
    if (text && text.length < 2) score *= 0.5;
    
    // Penalize high character deletion ratio
    if (originalMetadata.originalLength) {
      const deletionRatio = 1 - (text.length / originalMetadata.originalLength);
      if (deletionRatio > 0.5) score *= 0.7;
    }
    
    // Boost for proper sentence ending
    if (/[。！？.!?]$/.test(text)) score *= 1.1;
    
    return Math.min(1.0, score);
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return { ...this.processingStats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.processingStats = {
      furiganaRemoved: 0,
      sfxFiltered: 0,
      artifactsCleaned: 0,
      verticalFixed: 0,
    };
  }
}

/**
 * Convenience factory function
 */
export function createMangaTextCleaner(options) {
  return new MangaTextCleaner(options);
}

// Default export
export default MangaTextCleaner;