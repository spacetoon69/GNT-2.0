/**
 * context-restorer.js
 * 
 * Restores broken sentences and narrative context across manga panels.
 * Handles text split across bubbles, OCR fragmentation, line breaks in 
 * vertical text, and cross-panel continuity for translation coherence.
 * 
 * @module computer-vision/ocr/postprocessors/context-restorer
 */

import { TextType } from './bubble-classifier.js';

/**
 * Fragment relationship types
 */
export const FragmentRelation = Object.freeze({
  CONTINUATION: 'continuation',       // Direct sentence continuation
  NEW_SENTENCE: 'new_sentence',       // Fresh start, unrelated
  RESPONSE: 'response',               // Dialogue response to previous
  PARALLEL: 'parallel',               // Simultaneous speech/thought
  INTERRUPTED: 'interrupted',         // Cut off mid-sentence
  FLASHBACK: 'flashback',             // Temporal shift
  NARRATION_SHIFT: 'narration_shift', // Narrator to dialogue or vice versa
  SAME_SPEAKER: 'same_speaker',       // Same person, new bubble
  UNKNOWN: 'unknown'
});

/**
 * Sentence boundary markers by language
 */
const BOUNDARY_MARKERS = {
  ja: {
    terminal: /[。！？.!?]+$/,
    pause: /[、，,]$/,
    ellipsis: /…+$/,
    trailing: /[ー〜]$/,
    particles: /[てでにをがはもしがけどけれどからので]/,
    openQuotes: /[「『（【［〈《]$/,
    closeQuotes: /^[」』）】］〉》]/,
    honorifics: /(さん|くん|ちゃん|様|殿|先生|先輩)$/
  },
  ko: {
    terminal: /[.!?！？]+$/,
    pause: /[,，、]$/,
    ellipsis: /…+$/,
    trailing: /[ㅏㅓㅗㅜㅡㅣ]$/,
    particles: /[은는이가을를에의로와과]$/,
    openQuotes: /[「『（【［〈《]$/,
    closeQuotes: /^[」』）】］〉》]/
  },
  zh: {
    terminal: /[。！？.!?；;]+$/,
    pause: /[，、,]$/,
    ellipsis: /…+$/,
    openQuotes: /[「『（【［〈《“‘]$/,
    closeQuotes: /^[」』）】］〉》”’]/
  },
  en: {
    terminal: /[.!?]+$/,
    pause: /[,;:]$/,
    ellipsis: /…+$/,
    lowercaseStart: /^[a-z]/,
    uppercaseStart: /^[A-Z]/
  }
};

/**
 * Main context restorer for narrative coherence
 */
export class ContextRestorer {
  constructor(options = {}) {
    this.config = {
      language: options.language || 'ja',
      maxContextWindow: options.maxContextWindow || 5, // Bubbles to remember
      enableCrossPanel: options.enableCrossPanel !== false,
      enableSpeakerTracking: options.enableSpeakerTracking !== false,
      confidenceThreshold: options.confidenceThreshold || 0.7,
      ...options
    };
    
    this.contextHistory = [];
    this.speakerRegistry = new Map();
    this.panelSequence = [];
    this.sessionId = this._generateSessionId();
  }

  /**
   * Restore context for a single text fragment
   * @param {TextFragment} fragment - Current text fragment
   * @param {Array<TextFragment>} contextWindow - Recent fragments
   * @returns {RestorationResult}
   */
  restore(fragment, contextWindow = null) {
    const window = contextWindow || this.contextHistory.slice(-this.config.maxContextWindow);
    
    // Analyze fragment properties
    const analysis = this._analyzeFragment(fragment);
    
    // Determine relationship to previous context
    const relation = this._determineRelation(fragment, analysis, window);
    
    // Attempt restoration
    const restoration = this._performRestoration(fragment, analysis, relation, window);
    
    // Update history
    this._updateHistory(fragment, restoration);
    
    return {
      original: fragment.text,
      restored: restoration.text,
      wasModified: restoration.wasModified,
      relation: relation.type,
      confidence: relation.confidence,
      changes: restoration.changes,
      context: {
        precedingSpeaker: relation.precedingSpeaker,
        sentenceCompleted: restoration.sentenceCompleted,
        narrativeFlow: restoration.flow
      },
      metadata: {
        timestamp: Date.now(),
        sessionId: this.sessionId,
        fragmentId: fragment.id || this._generateId()
      }
    };
  }

  /**
   * Restore context across multiple fragments (batch processing)
   * @param {Array<TextFragment>} fragments - Ordered list of fragments
   * @param {Object} options - Processing options
   * @returns {Array<RestorationResult>}
   */
  restoreBatch(fragments, options = {}) {
    const results = [];
    const tempHistory = [];
    
    // First pass: individual analysis
    const analyzed = fragments.map((frag, idx) => ({
      ...frag,
      _index: idx,
      _analysis: this._analyzeFragment(frag)
    }));

    // Second pass: relationship detection
    for (let i = 0; i < analyzed.length; i++) {
      const current = analyzed[i];
      const window = tempHistory.slice(-this.config.maxContextWindow);
      
      // Look ahead for split sentences
      const lookahead = options.lookahead !== false ? 
        analyzed.slice(i + 1, i + 3) : [];
      
      const relation = this._determineRelation(current, current._analysis, window, lookahead);
      const restoration = this._performRestoration(current, current._analysis, relation, window, lookahead);
      
      // Cross-reference with lookahead if this might be incomplete
      if (restoration.mayContinue && lookahead.length > 0) {
        const merged = this._attemptMerge(current, lookahead, relation);
        if (merged) {
          restoration.text = merged.text;
          restoration.wasModified = true;
          restoration.changes.push('lookahead_merge');
          restoration.mergedWith = merged.indices;
          i += merged.skip; // Skip merged fragments
        }
      }

      const result = {
        original: current.text,
        restored: restoration.text,
        wasModified: restoration.wasModified,
        relation: relation.type,
        confidence: relation.confidence,
        changes: restoration.changes,
        context: {
          precedingSpeaker: relation.precedingSpeaker,
          sentenceCompleted: restoration.sentenceCompleted,
          narrativeFlow: restoration.flow,
          panelContinuity: relation.crossPanel
        },
        metadata: {
          fragmentId: current.id || `frag-${i}`,
          batchIndex: i,
          sessionId: this.sessionId
        }
      };

      results.push(result);
      tempHistory.push({
        original: current.text,
        restored: restoration.text,
        type: current.type,
        speaker: current.speaker,
        analysis: current._analysis
      });
    }

    // Update instance history if not in isolated mode
    if (!options.isolated) {
      this.contextHistory = tempHistory;
    }

    return results;
  }

  /**
   * Analyze a text fragment for structural properties
   * @private
   */
  _analyzeFragment(fragment) {
    const text = fragment.text || '';
    const lang = this.config.language;
    const markers = BOUNDARY_MARKERS[lang] || BOUNDARY_MARKERS.ja;
    
    return {
      // Boundary analysis
      hasTerminal: markers.terminal.test(text),
      endsWithPause: markers.pause.test(text),
      endsWithEllipsis: markers.ellipsis.test(text),
      endsWithTrailing: markers.trailing ? markers.trailing.test(text) : false,
      startsWithLower: markers.lowercaseStart ? markers.lowercaseStart.test(text) : false,
      startsWithUpper: markers.uppercaseStart ? markers.uppercaseStart.test(text) : false,
      
      // Quote analysis
      hasOpenQuote: markers.openQuotes ? markers.openQuotes.test(text) : false,
      hasCloseQuote: markers.closeQuotes ? markers.closeQuotes.test(text) : false,
      quoteBalance: this._checkQuoteBalance(text, markers),
      
      // Structural
      wordCount: this._estimateWordCount(text, lang),
      isFragment: text.length < 10 && !markers.terminal.test(text),
      isComplete: markers.terminal.test(text) && !markers.openQuotes?.test(text),
      
      // Content type
      startsWithParticle: markers.particles ? markers.particles.test(text.slice(0, 3)) : false,
      endsWithParticle: markers.particles ? markers.particles.test(text.slice(-3)) : false,
      hasHonorifics: markers.honorifics ? markers.honorifics.test(text) : false,
      
      // OCR confidence indicators
      hasGaps: /\s{2,}/.test(text),
      hasArtifacts: /[□■▲▼◆◇]/.test(text),
      mixedScripts: /[a-zA-Z]/.test(text) && /[\u4E00-\u9FAF]/.test(text)
    };
  }

  /**
   * Determine relationship between current fragment and context
   * @private
   */
  _determineRelation(current, analysis, window, lookahead = []) {
    if (window.length === 0) {
      return {
        type: FragmentRelation.NEW_SENTENCE,
        confidence: 1.0,
        precedingSpeaker: null,
        crossPanel: false
      };
    }

    const previous = window[window.length - 1];
    const prevAnalysis = previous.analysis || this._analyzeFragment(previous);
    
    let relation = FragmentRelation.UNKNOWN;
    let confidence = 0.5;
    let crossPanel = false;

    // Check for same speaker continuation
    if (this.config.enableSpeakerTracking && current.speaker && previous.speaker) {
      if (current.speaker === previous.speaker) {
        // Same speaker, check if continuing thought
        if (!prevAnalysis.hasTerminal && !analysis.hasOpenQuote) {
          relation = FragmentRelation.SAME_SPEAKER;
          confidence = 0.8;
        }
      }
    }

    // Check for sentence continuation (grammatical)
    if (!prevAnalysis.hasTerminal && !prevAnalysis.hasCloseQuote) {
      // Previous didn't end properly
      
      if (analysis.startsWithLower || analysis.startsWithParticle) {
        // Current starts with lowercase or particle = likely continuation
        relation = FragmentRelation.CONTINUATION;
        confidence = 0.85;
      } else if (prevAnalysis.endsWithEllipsis && !analysis.hasOpenQuote) {
        // Ellipsis often indicates pause then continuation
        relation = FragmentRelation.INTERRUPTED;
        confidence = 0.7;
      } else if (prevAnalysis.endsWithTrailing) {
        // Trailing vowel (Japanese) = definitely continuing
        relation = FragmentRelation.CONTINUATION;
        confidence = 0.9;
      }
    }

    // Check for dialogue response
    if (current.type === TextType.DIALOGUE && previous.type === TextType.DIALOGUE) {
      if (prevAnalysis.hasTerminal && !analysis.hasOpenQuote) {
        // Previous ended, current is new but might be response
        if (this._isResponsePattern(previous.restored || previous.original, current.text)) {
          relation = FragmentRelation.RESPONSE;
          confidence = 0.6;
        }
      }
    }

    // Check for parallel speech (simultaneous)
    if (lookahead.length > 0 && window.length >= 2) {
      const parallelCheck = this._checkParallelSpeech(current, previous, lookahead[0]);
      if (parallelCheck.isParallel) {
        relation = FragmentRelation.PARALLEL;
        confidence = parallelCheck.confidence;
      }
    }

    // Check for narration shifts
    if (current.type !== previous.type) {
      if ((current.type === TextType.NARRATION && previous.type === TextType.DIALOGUE) ||
          (current.type === TextType.DIALOGUE && previous.type === TextType.NARRATION)) {
        relation = FragmentRelation.NARRATION_SHIFT;
        confidence = 0.75;
      }
    }

    // Cross-panel detection
    if (current.panelId && previous.panelId && current.panelId !== previous.panelId) {
      crossPanel = true;
      // Reduce confidence for cross-panel continuations unless strong indicators
      if (relation === FragmentRelation.CONTINUATION) {
        confidence *= 0.8;
      }
    }

    return {
      type: relation,
      confidence,
      precedingSpeaker: previous.speaker,
      crossPanel
    };
  }

  /**
   * Perform actual text restoration
   * @private
   */
  _performRestoration(fragment, analysis, relation, window, lookahead = []) {
    let text = fragment.text;
    const changes = [];
    let wasModified = false;
    let sentenceCompleted = false;
    let mayContinue = false;
    let flow = 'coherent';

    const previous = window.length > 0 ? window[window.length - 1] : null;

    // Handle continuations
    if (relation.type === FragmentRelation.CONTINUATION && previous) {
      const prevText = previous.restored || previous.original;
      
      // Check if we need to merge
      if (!analysis.hasOpenQuote && !prevText.match(/[」』）】]$/)) {
        // Previous didn't close quotes, current doesn't open = likely same sentence
        
        // Remove redundant particles at boundary
        if (analysis.startsWithParticle && prevText.match(/[、，,]$/)) {
          text = text.replace(/^[はがをにでとも]/, '');
          changes.push('removed_redundant_particle');
          wasModified = true;
        }

        // Handle trailing ellipses
        if (prevText.match(/…+$/)) {
          // Keep ellipsis but ensure spacing
          text = text.replace(/^\s*/, ' ');
          changes.push('ellipsis_spacing');
          wasModified = true;
        }

        // Merge if previous ended mid-word (Japanese trailing ー)
        if (previous.analysis?.endsWithTrailing && text.match(/^[ー〜]/)) {
          text = text.replace(/^[ー〜]+/, '');
          changes.push('merged_trailing_vowel');
          wasModified = true;
        }
      }
    }

    // Fix quote imbalances
    if (analysis.quoteBalance.unbalanced) {
      if (analysis.quoteBalance.openers > analysis.quoteBalance.closers) {
        // Missing closing quote
        text += '」';
        changes.push('added_closing_quote');
        wasModified = true;
      } else if (analysis.quoteBalance.closers > analysis.quoteBalance.openers) {
        // Missing opening quote
        text = '「' + text;
        changes.push('added_opening_quote');
        wasModified = true;
      }
    }

    // Handle interrupted speech
    if (relation.type === FragmentRelation.INTERRUPTED) {
      if (!text.match(/[—―]$/)) {
        text += '—';
        changes.push('added_interruption_mark');
        wasModified = true;
      }
      mayContinue = true;
      flow = 'interrupted';
    }

    // Fix sentence fragments
    if (analysis.isFragment && lookahead.length === 0) {
      // Last fragment in sequence, try to complete
      if (!analysis.hasTerminal && !analysis.endsWithEllipsis) {
        // Check if it looks like a complete thought despite length
        if (analysis.wordCount >= 3 && !analysis.endsWithParticle) {
          text += '。';
          changes.push('added_terminal');
          wasModified = true;
          sentenceCompleted = true;
        } else {
          mayContinue = true;
          flow = 'incomplete';
        }
      }
    }

    // Clean up OCR artifacts that break flow
    if (analysis.hasGaps) {
      text = text.replace(/\s{2,}/g, ' ');
      changes.push('fixed_spacing');
      wasModified = true;
    }

    // Handle flashback indicators
    if (fragment.type === TextType.FLASHBACK || 
        (previous?.type === TextType.FLASHBACK && relation.crossPanel)) {
      flow = 'flashback';
      if (!text.startsWith('（過去）') && !text.startsWith('(Past)')) {
        // Optional: Add flashback marker for translator context
        // text = '[Flashback] ' + text;
      }
    }

    // Detect and fix mixed script issues (OCR confusion)
    if (analysis.mixedScripts) {
      const cleaned = this._separateMixedScripts(text);
      if (cleaned !== text) {
        text = cleaned;
        changes.push('separated_mixed_scripts');
        wasModified = true;
      }
    }

    return {
      text,
      wasModified,
      changes,
      sentenceCompleted: sentenceCompleted || analysis.isComplete,
      mayContinue,
      flow
    };
  }

  /**
   * Attempt to merge with lookahead fragments
   * @private
   */
  _attemptMerge(current, lookahead, relation) {
    if (lookahead.length === 0) return null;
    
    const currentText = current.text;
    const next = lookahead[0];
    const nextAnalysis = this._analyzeFragment(next);
    
    // Strong merge indicators
    const mergeIndicators = [
      // Current ends with open quote, next closes it
      currentText.match(/[「『（]$/) && nextAnalysis.hasCloseQuote,
      
      // Current ends with particle/connector, next starts lowercase
      currentText.match(/[てでにをがはの]$/) && nextAnalysis.startsWithLower,
      
      // Current is clearly incomplete (ends with verb stem)
      currentText.match(/[いきしちにひみりえけせてねへめれ]$/) && !nextAnalysis.hasOpenQuote,
      
      // Trailing ellipsis with immediate continuation
      currentText.match(/…$/) && !next.text.match(/^[。！？]/)
    ];

    const score = mergeIndicators.filter(Boolean).length;
    
    if (score >= 2) {
      // Perform merge
      const mergedText = currentText.replace(/[…—]+$/, '') + ' ' + next.text;
      return {
        text: mergedText,
        indices: [next.id || 0],
        skip: 1
      };
    }

    // Check for three-way merge
    if (lookahead.length >= 2 && score >= 1) {
      const second = lookahead[1];
      const combined = currentText + next.text + second.text;
      
      // If combined looks like a complete sentence, merge all three
      if (combined.match(/[。！？.]$/)) {
        return {
          text: combined,
          indices: [next.id, second.id],
          skip: 2
        };
      }
    }

    return null;
  }

  /**
   * Check if current text is a response to previous
   * @private
   */
  _isResponsePattern(prevText, currentText) {
    const responseStarters = /^(なに|何|だって|でも|しかし|けど|だけど|でも|はい|いいえ|うん|ううん|ええ)/;
    const questionIndicators = /[かな？?]$/;
    
    // Previous was question, current starts with response word
    if (prevText.match(questionIndicators) && currentText.match(responseStarters)) {
      return true;
    }
    
    // Turn-taking indicators
    if (currentText.match(/^(僕|私|俺|あたし).{0,5}(は|が)/)) {
      return true; // New speaker self-reference
    }
    
    return false;
  }

  /**
   * Check for parallel speech (simultaneous characters)
   * @private
   */
  _checkParallelSpeech(current, previous, next) {
    // Parallel indicators: same timestamp, different speakers, similar length
    const samePanel = current.panelId === previous.panelId;
    const differentSpeakers = current.speaker !== previous.speaker;
    const similarLength = Math.abs(current.text.length - previous.text.length) < 10;
    
    // Check if both are short reactions
    const shortReaction = current.text.length < 15 && previous.text.length < 15;
    
    if (samePanel && differentSpeakers && (similarLength || shortReaction)) {
      return {
        isParallel: true,
        confidence: similarLength ? 0.7 : 0.5
      };
    }
    
    return { isParallel: false };
  }

  /**
   * Separate mixed scripts (Latin in CJK or vice versa)
   * @private
   */
  _separateMixedScripts(text) {
    // Often OCR confuses similar looking characters between scripts
    // e.g., 'o' vs 'о' (Cyrillic), 'l' vs 'I', etc.
    
    // Fix common confusions in Japanese context
    let cleaned = text
      // Latin 'o' in katakana context -> オ or ォ
      .replace(/([ァ-ン])o/, '$1ォ')
      .replace(/o([ァ-ン])/, 'ォ$1')
      // Latin 'a' -> ァ
      .replace(/([ァ-ン])a/, '$1ァ')
      // Latin 'i' -> ィ
      .replace(/([ァ-ン])i/, '$1ィ')
      // Latin 'e' -> ェ
      .replace(/([ァ-ン])e/, '$1ェ')
      // Latin 'u' -> ゥ
      .replace(/([ァ-ン])u/, '$1ゥ');
    
    return cleaned;
  }

  /**
   * Check quote balance in text
   * @private
   */
  _checkQuoteBalance(text, markers) {
    const openers = (text.match(markers.openQuotes) || []).length;
    const closers = (text.match(markers.closeQuotes) || []).length;
    return { openers, closers, unbalanced: openers !== closers };
  }

  /**
   * Estimate word count (language-aware)
   * @private
   */
  _estimateWordCount(text, lang) {
    if (lang === 'ja' || lang === 'zh') {
      // Count CJK characters as words roughly
      return text.replace(/[^\u4E00-\u9FAF]/g, '').length + 
             text.split(/[\s、，。！？]/).filter(w => w.trim()).length;
    }
    return text.split(/\s+/).filter(w => w.trim()).length;
  }

  /**
   * Update internal history
   * @private
   */
  _updateHistory(fragment, restoration) {
    this.contextHistory.push({
      id: fragment.id || this._generateId(),
      original: fragment.text,
      restored: restoration.text,
      type: fragment.type,
      speaker: fragment.speaker,
      panelId: fragment.panelId,
      analysis: this._analyzeFragment(fragment),
      timestamp: Date.now()
    });

    // Trim history
    if (this.contextHistory.length > this.config.maxContextWindow * 2) {
      this.contextHistory = this.contextHistory.slice(-this.config.maxContextWindow);
    }
  }

  /**
   * Register a speaker for tracking
   */
  registerSpeaker(id, attributes) {
    this.speakerRegistry.set(id, {
      id,
      ...attributes,
      firstSeen: Date.now(),
      utteranceCount: 0
    });
  }

  /**
   * Clear context history
   */
  clearContext() {
    this.contextHistory = [];
    this.panelSequence = [];
  }

  /**
   * Get current narrative context summary
   */
  getContextSummary() {
    const recent = this.contextHistory.slice(-3);
    return {
      recentSpeakers: [...new Set(recent.map(h => h.speaker).filter(Boolean))],
      currentFlow: recent.length > 0 ? 'active' : 'none',
      pendingCompletion: recent.some(h => !h.analysis?.hasTerminal),
      speakerCount: this.speakerRegistry.size
    };
  }

  /**
   * Generate unique ID
   * @private
   */
  _generateId() {
    return `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate session ID
   * @private
   */
  _generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function
 */
export function createContextRestorer(options) {
  return new ContextRestorer(options);
}

export default ContextRestorer;