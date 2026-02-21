/**
 * text-sanitizer.js
 * 
 * Text sanitization and normalization utilities for manga OCR and translation.
 * Handles Japanese/Korean/Chinese text artifacts, broken sentences, and formatting.
 */

import { MANGA_PATTERNS, HONORIFICS, SFX_PATTERNS } from '../constants.js';

/**
 * TextSanitizer - Main class for text cleaning operations
 */
export class TextSanitizer {
  constructor(options = {}) {
    this.options = {
      preserveHonorifics: true,
      fixBrokenSentences: true,
      removeOCRArtifacts: true,
      normalizeWhitespace: true,
      detectSFX: true,
      ...options
    };

    // Common OCR error patterns for CJK languages
    this.ocrErrorPatterns = {
      japanese: [
        { pattern: /[\u2018\u2019]/g, replacement: '\'' }, // Smart quotes to straight
        { pattern: /[\u201C\u201D]/g, replacement: '"' },
        { pattern: /ー+/g, replacement: 'ー' }, // Normalize long vowel marks
        { pattern: /…+/g, replacement: '…' }, // Normalize ellipsis
        { pattern: /・+/g, replacement: '・' }, // Normalize middle dots
        { pattern: /[ａ-ｚＡ-Ｚ０-９]/g, match => String.fromCharCode(match.charCodeAt(0) - 0xFEE0) }, // Fullwidth to halfwidth
        { pattern: /[“”]/g, replacement: '"' },
        { pattern: /[‘’]/g, replacement: '\'' },
        { pattern: /[—―─]/g, replacement: '—' }, // Normalize dashes
      ],
      korean: [
        { pattern: /[“”]/g, replacement: '"' },
        { pattern: /[‘’]/g, replacement: '\'' },
        { pattern: /…+/g, replacement: '…' },
        { pattern: /·+/g, replacement: '·' },
      ],
      chinese: [
        { pattern: /[“”]/g, replacement: '"' },
        { pattern: /[‘’]/g, replacement: '\'' },
        { pattern: /…+/g, replacement: '…' },
        { pattern: /[—―─]/g, replacement: '—' },
      ]
    };

    // Broken sentence patterns (line breaks mid-word)
    this.brokenPatterns = [
      /(\w+)-\s*\n\s*(\w+)/g,  // Hyphenated words across lines
      /(\w+)\s*\n\s*(\w+)/g,   // Words split without hyphen
    ];

    // Common OCR artifacts in manga
    this.artifactPatterns = [
      /[^\S\n]+/g,  // Multiple spaces (but preserve newlines)
      /^\s+|\s+$/gm, // Leading/trailing whitespace per line
      /\n{3,}/g, '\n\n', // Max 2 consecutive newlines
      /[ \t]+$/gm, // Trailing spaces
      /^[ \t]+/gm, // Leading spaces
    ];
  }

  /**
   * Main sanitization entry point
   * @param {string} text - Raw text from OCR
   * @param {string} sourceLang - Source language code (ja, ko, zh, etc.)
   * @returns {SanitizedText} Cleaned text with metadata
   */
  sanitize(text, sourceLang = 'ja') {
    if (!text || typeof text !== 'string') {
      return {
        text: '',
        original: text || '',
        isEmpty: true,
        isSFX: false,
        confidence: 0,
        modifications: []
      };
    }

    let cleaned = text;
    const modifications = [];
    const original = text;

    // Track changes
    const trackChange = (type, before, after) => {
      if (before !== after) {
        modifications.push({ type, before, after });
      }
    };

    // Step 1: Basic normalization
    if (this.options.normalizeWhitespace) {
      const before = cleaned;
      cleaned = this.normalizeWhitespace(cleaned);
      trackChange('whitespace', before, cleaned);
    }

    // Step 2: Language-specific cleaning
    const beforeLang = cleaned;
    cleaned = this.applyLanguageSpecificCleaning(cleaned, sourceLang);
    trackChange('language_specific', beforeLang, cleaned);

    // Step 3: Fix broken sentences
    if (this.options.fixBrokenSentences) {
      const beforeBroken = cleaned;
      cleaned = this.fixBrokenSentences(cleaned);
      trackChange('broken_sentences', beforeBroken, cleaned);
    }

    // Step 4: Remove OCR artifacts
    if (this.options.removeOCRArtifacts) {
      const beforeArtifacts = cleaned;
      cleaned = this.removeOCRArtifacts(cleaned);
      trackChange('artifacts', beforeArtifacts, cleaned);
    }

    // Step 5: Detect if this is SFX (sound effects)
    const isSFX = this.options.detectSFX ? this.detectSFX(cleaned, sourceLang) : false;

    // Step 6: Extract and preserve honorifics if Japanese
    let honorifics = [];
    if (this.options.preserveHonorifics && sourceLang === 'ja') {
      const honorificResult = this.extractHonorifics(cleaned);
      cleaned = honorificResult.text;
      honorifics = honorificResult.honorifics;
    }

    // Calculate confidence based on modifications
    const confidence = this.calculateConfidence(original, cleaned, modifications);

    return {
      text: cleaned,
      original,
      isEmpty: cleaned.length === 0,
      isSFX,
      honorifics,
      confidence,
      modifications,
      wordCount: this.countWords(cleaned, sourceLang),
      charCount: cleaned.length,
      hasQuestion: /[?？]/.test(cleaned),
      hasExclamation: /[!！]/.test(cleaned),
      isShouting: this.isShouting(cleaned)
    };
  }

  /**
   * Normalize whitespace while preserving intentional line breaks
   */
  normalizeWhitespace(text) {
    return text
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\r/g, '\n')
      .replace(/[^\S\n]+/g, ' ')  // Multiple spaces to single
      .replace(/ \n/g, '\n')  // Remove spaces before newlines
      .replace(/\n /g, '\n')  // Remove spaces after newlines
      .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
      .trim();
  }

  /**
   * Apply language-specific cleaning patterns
   */
  applyLanguageSpecificCleaning(text, lang) {
    const patterns = this.ocrErrorPatterns[lang] || this.ocrErrorPatterns.japanese;
    
    return patterns.reduce((acc, { pattern, replacement }) => {
      if (typeof replacement === 'function') {
        return acc.replace(pattern, replacement);
      }
      return acc.replace(pattern, replacement);
    }, text);
  }

  /**
   * Fix sentences broken across lines or bubbles
   */
  fixBrokenSentences(text) {
    let fixed = text;
    
    // Fix hyphenated breaks
    fixed = fixed.replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2');
    
    // Fix breaks in the middle of words (heuristic)
    fixed = fixed.replace(/(\w{2,})\s*\n\s*(\w{2,})/g, (match, w1, w2) => {
      // If second word starts with lowercase, likely continuation
      if (w2[0] === w2[0].toLowerCase()) {
        return w1 + w2;
      }
      return match;
    });

    // Fix Japanese specific: particles attached to newlines
    fixed = fixed.replace(/(\w+)([はがをにでと])\s*\n\s*/g, '$1$2');
    
    return fixed;
  }

  /**
   * Remove common OCR artifacts
   */
  removeOCRArtifacts(text) {
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control chars
      .replace(/[^\S\n]+/g, ' ')  // Normalize spaces
      .replace(/^[ \t]+|[ \t]+$/gm, '') // Trim lines
      .replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
  }

  /**
   * Detect if text is likely a sound effect (SFX)
   */
  detectSFX(text, lang) {
    const sfxIndicators = {
      japanese: [
        /^[ドバガゴザジデベペカ][ァ-ン]*[!！]*$/,  // Common SFX patterns
        /^[スズツフブプ][ァ-ン]*$/,
        /^[キクケコギグゲゴ][ァ-ン]*$/,
        /^[バビブベボパピプペポ][ァ-ン]*$/,
        /^(ドキ|バタ|ガタ|ゴク|ズキ|ビク)[ッ]?[ドバタクキ]*/,
        /^[アイウエオ][ッ]?[ッアイウエオ]*[!！]*$/,
        /^[ワナタ][ッ][ッ]*$/,
      ],
      korean: [
        /^[쿠쿵쾅쾅쿵][쿠쿵쾅]*$/,
        /^[드르르르][르]*$/,
        /^[와구와구][와구]*$/,
      ],
      chinese: [
        /^[砰啪咚当][砰啪咚当]*$/,
      ]
    };

    const patterns = sfxIndicators[lang] || sfxIndicators.japanese;
    const isSFX = patterns.some(pattern => pattern.test(text));
    
    // Additional heuristic: short length, repetition, all caps (for EN)
    const isShort = text.length <= 10;
    const hasRepetition = /(.)\1{2,}/.test(text);
    const isAllKatakana = /^[\u30A0-\u30FFー！？…]+$/.test(text);
    
    return isSFX || (isShort && (hasRepetition || isAllKatakana));
  }

  /**
   * Extract and preserve Japanese honorifics
   */
  extractHonorifics(text) {
    const honorificPattern = /(さん|くん|君|ちゃん|様|さま|殿|どの|氏|し|先生|せんせい|先輩|せんぱい|後輩|こうはい|ちゃん)$/g;
    const matches = text.match(honorificPattern) || [];
    
    // Remove honorifics for translation but track them
    const withoutHonorifics = text.replace(honorificPattern, '');
    
    return {
      text: withoutHonorifics,
      honorifics: matches
    };
  }

  /**
   * Restore honorifics after translation (approximate)
   */
  static restoreHonorifics(translatedText, honorifics, targetLang = 'en') {
    if (!honorifics.length || targetLang !== 'en') return translatedText;
    
    // Map Japanese honorifics to English approximations
    const honorificMap = {
      'さん': '-san',
      'くん': '-kun',
      '君': '-kun',
      'ちゃん': '-chan',
      '様': '-sama',
      'さま': '-sama',
      '殿': '-dono',
      'どの': '-dono',
      '氏': '-shi',
      'し': '-shi',
      '先生': '-sensei',
      'せんせい': '-sensei',
      '先輩': '-senpai',
      'せんぱい': '-senpai',
      '後輩': '-kouhai',
      'こうはい': '-kouhai',
    };

    // Append honorifics to the last word or end of sentence
    const honorificSuffix = honorifics.map(h => honorificMap[h] || h).join('/');
    return `${translatedText}${honorificSuffix}`;
  }

  /**
   * Check if text appears to be shouting (for styling)
   */
  isShouting(text) {
    const exclamationCount = (text.match(/[!！]/g) || []).length;
    const capsRatio = (text.match(/[A-Z]/g) || []).length / (text.match(/[a-zA-Z]/g) || []).length || 0;
    const hasSizeIndicators = /(大きく|大声|きめ|キメ|ドンドン|バンバン)/.test(text);
    
    return exclamationCount >= 2 || capsRatio > 0.7 || hasSizeIndicators;
  }

  /**
   * Count words (language-aware)
   */
  countWords(text, lang) {
    if (lang === 'ja' || lang === 'zh') {
      // For CJK, count characters excluding punctuation
      return text.replace(/[、。！？…,.!?]/g, '').length;
    }
    // For others, split by whitespace
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Calculate confidence score based on modifications
   */
  calculateConfidence(original, cleaned, modifications) {
    if (!original.length) return 0;
    
    const changeRatio = modifications.length / original.length;
    const heavyModification = modifications.filter(m => 
      m.type === 'artifacts' || m.type === 'broken_sentences'
    ).length;
    
    // Base confidence
    let confidence = 1.0;
    
    // Penalize heavy modifications
    confidence -= (heavyModification * 0.1);
    confidence -= (changeRatio * 0.5);
    
    // Penalize very short results
    if (cleaned.length < 3) confidence -= 0.2;
    
    // Boost for clean results
    if (modifications.length === 0) confidence = 1.0;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Batch sanitize multiple text segments
   */
  sanitizeBatch(texts, sourceLang = 'ja') {
    return texts.map((text, index) => ({
      index,
      ...this.sanitize(text, sourceLang)
    }));
  }

  /**
   * Merge related text segments (e.g., across bubbles)
   */
  mergeRelatedSegments(segments, threshold = 0.8) {
    if (segments.length < 2) return segments;
    
    const merged = [segments[0]];
    
    for (let i = 1; i < segments.length; i++) {
      const current = segments[i];
      const previous = merged[merged.length - 1];
      
      // Check if they should be merged
      const shouldMerge = this.shouldMergeSegments(previous, current, threshold);
      
      if (shouldMerge) {
        merged[merged.length - 1] = {
          ...previous,
          text: `${previous.text} ${current.text}`,
          original: `${previous.original}\n${current.original}`,
          isMerged: true,
          mergeCount: (previous.mergeCount || 1) + 1
        };
      } else {
        merged.push(current);
      }
    }
    
    return merged;
  }

  /**
   * Determine if two text segments should be merged
   */
  shouldMergeSegments(seg1, seg2, threshold) {
    // Check for sentence continuation
    const endsWithParticle = /[はがをにでと]$/.test(seg1.text);
    const startsWithLowercase = /^[a-z]/.test(seg2.text);
    const shortFirst = seg1.text.length < 10;
    const noEndingPunctuation = !/[.。！？!?]$/.test(seg1.text);
    
    return (endsWithParticle || (shortFirst && noEndingPunctuation)) && 
           (startsWithLowercase || noEndingPunctuation);
  }

  /**
   * Post-process translated text for display
   */
  static postProcessTranslation(translated, originalContext = {}) {
    let processed = translated;
    
    // Ensure proper punctuation
    if (originalContext.hasQuestion && !/[?？]$/.test(processed)) {
      processed += '?';
    }
    if (originalContext.hasExclamation && !/[!！]$/.test(processed)) {
      processed += '!';
    }
    
    // Restore shouting style if needed
    if (originalContext.isShouting && !processed.includes('!')) {
      processed += '!';
    }
    
    // Apply font styling hints
    return {
      text: processed,
      style: {
        fontWeight: originalContext.isShouting ? 'bold' : 'normal',
        fontSize: originalContext.isShouting ? '1.1em' : '1em',
        textTransform: originalContext.isShouting ? 'uppercase' : 'none'
      }
    };
  }
}

/**
 * Utility functions for quick access
 */
export const TextUtils = {
  /**
   * Quick sanitize function
   */
  quickSanitize: (text, lang = 'ja') => {
    const sanitizer = new TextSanitizer();
    return sanitizer.sanitize(text, lang).text;
  },

  /**
   * Check if text is likely manga SFX
   */
  isSFX: (text, lang = 'ja') => {
    const sanitizer = new TextSanitizer();
    return sanitizer.detectSFX(text, lang);
  },

  /**
   * Clean OCR output for specific manga sites
   */
  cleanForSite: (text, siteAdapter) => {
    const siteCleaners = {
      'mangadex': (t) => t.replace(/\[note\].*?\[\/note\]/gi, ''),
      'webtoon': (t) => t.replace(/&nbsp;/g, ' ').replace(/<br>/g, '\n'),
      'cubari': (t) => t.replace(/\{\{.*?\}\}/g, ''), // Remove template syntax
      'default': (t) => t
    };
    
    const cleaner = siteCleaners[siteAdapter] || siteCleaners.default;
    return cleaner(text);
  },

  /**
   * Estimate reading time
   */
  estimateReadingTime: (text, lang = 'ja') => {
    const wpm = lang === 'ja' || lang === 'zh' ? 400 : 200; // Characters vs words
    const count = lang === 'ja' || lang === 'zh' ? 
      text.replace(/[、。！？…,.!?]/g, '').length :
      text.trim().split(/\s+/).length;
    return Math.ceil(count / wpm * 60); // Seconds
  }
};

export default TextSanitizer;