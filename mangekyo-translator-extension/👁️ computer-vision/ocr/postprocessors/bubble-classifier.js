/**
 * bubble-classifier.js
 * 
 * Classifies text content within manga speech bubbles into semantic categories.
 * Determines translation strategy based on text type: dialogue, narration, 
 * thought, sound effect, sign/label, or special typography.
 * 
 * @module computer-vision/ocr/postprocessors/bubble-classifier
 */

import { MangaTextCleaner } from './manga-text-cleaner.js';

/**
 * Text type categories for manga translation
 */
export const TextType = Object.freeze({
  DIALOGUE: 'dialogue',           // Character speech (「」)
  NARRATION: 'narration',         // Story text, boxes, exposition
  THOUGHT: 'thought',             // Internal monologue (『』or bubble style)
  SFX: 'sfx',                     // Sound effects (擬音語/擬態語)
  SIGN_LABEL: 'sign_label',       // Background signs, labels, UI elements
  WHISPER: 'whisper',             // Small text, dotted lines, faint text
  SHOUT: 'shout',                 // Large, bold, jagged bubble text
  FLASHBACK: 'flashback',         // Black background, specific font treatment
  FOREIGN: 'foreign',             // Foreign language text (Chinese, Korean, etc.)
  HANDWRITTEN: 'handwritten',     // Notes, letters, non-standard fonts
  META: 'meta',                   // Chapter titles, author notes, volume info
  UNKNOWN: 'unknown'
});

/**
 * Visual bubble characteristics
 */
export const BubbleStyle = Object.freeze({
  STANDARD: 'standard',           // Normal round/oval bubble
  SHOUT: 'shout',                 // Jagged/spiky edges
  THOUGHT: 'thought',             // Cloud-like, rounded puffs
  NARRATION: 'narration',         // Rectangular, no tail
  WHISPER: 'whisper',             // Dotted outline, small
  RADIO_PHONE: 'radio_phone',     // Dashed lines, mechanical look
  DREAM_FLASHBACK: 'dream_flashback', // Black background, white text
  NARRATOR_BOX: 'narrator_box',   // Black bar, white text
  FLOATING: 'floating',           // No container, free text
  SIGN: 'sign',                   // Rectangular, sharp edges
  INVERTED: 'inverted'            // Black bubble, white text (dark scenes)
});

/**
 * Classification confidence levels
 */
export const ConfidenceLevel = Object.freeze({
  HIGH: 0.85,     // Strong indicators, reliable classification
  MEDIUM: 0.65,   // Some ambiguity, reasonable guess
  LOW: 0.45,      // Weak signals, fallback to generic handling
  UNCERTAIN: 0.0  // Cannot determine
});

/**
 * Main bubble classifier for manga text analysis
 */
export class BubbleClassifier {
  constructor(options = {}) {
    this.config = {
      language: options.language || 'ja',
      detectHonorifics: options.detectHonorifics !== false,
      detectDialect: options.detectDialect || false,
      useVisualFeatures: options.useVisualFeatures !== false,
      confidenceThreshold: options.confidenceThreshold || 0.6,
      ...options
    };
    
    this.textCleaner = new MangaTextCleaner({
      removeFurigana: false, // Keep for classification analysis
      filterSoundEffects: false
    });
    
    // Classification rules cache
    this._initClassificationRules();
  }

  /**
   * Initialize regex patterns and classification heuristics
   * @private
   */
  _initClassificationRules() {
    this.rules = {
      // Dialogue indicators
      dialogue: {
        // Quotation marks (Japanese)
        quotes: /[「『](.+)[」』]/s,
        // Speech particles (spoken Japanese)
        speechParticles: /[だよね|です[かね]?|ます[か]?|って|じゃん|でしょ|かな|わよ|ぜよ|ぞな]$/,
        // First person pronouns (spoken)
        firstPerson: /^(俺|僕|私|わたし|あたし|うち|わし|おれ|ぼく)/,
        // Question/exclamation (spoken tone)
        spokenEnding: /[？！?!!?]$/,
        // Honorifics indicate character interaction
        honorifics: /(さん|くん|ちゃん|様|さま|殿|どの|先生|先輩|後輩)/
      },
      
      // Thought/internal monologue indicators
      thought: {
        // Thought bubble quotes
        thoughtQuotes: /[『（](.+)[）』]/s,
        // Internal particles
        internalParticles: /[かも|だろう|であろう|ではないか|と思う|と感じる]$/,
        // Self-reflection markers
        reflection: /(自分|わたし|僕|俺).{0,3}(思う|考える|感じる|疑問)/,
        // No speech particles but cognitive verbs
        cognitive: /(考え|思案|疑問|迷い|葛藤)/
      },
      
      // Narration indicators
      narration: {
        // Past tense narrative
        pastTense: /[た|だった|であった|ていた]$/,
        // Descriptive without subject (omniscient narrator)
        descriptive: /^(その|この|あの|こんな|そんな|あんな).{3,20}[で|に|を]/,
        // Literary particles
        literary: /[であり|であった|なのだ|という|のような]/,
        // No quotes, formal style
        formal: /^[一-龠]{2,8}[は|が|で|に]/
      },
      
      // Sound effect patterns (already defined in text-cleaner, expanded here)
      sfx: {
        // Pure katakana (2-6 chars typical for SFX)
        pureKatakana: /^[\u30A0-\u30FF]{2,6}$/,
        // Repetition pattern
        repetition: /^(.)\1{1,3}$/,
        // Symbol inclusion
        symbols: /[☆★♪‼⁉♡♥※＊◇◆□■]/,
        // Onomatopoeia categories
        impact: /^(ドゴ|バコ|ゴゴ|ドカ|バキ|ズバ|ガキ|ボコ|ガン|バン|ドン)/,
        motion: /^(サラ|ヒラ|フワ|スル|ノロ|ユラ|フラ|スー|ヒュ|ビュ)/,
        emotion: /^(ドキ|ワク|ハラ|イラ|メソ|シク|ムカ|ゾク|ヒヤ)/
      },
      
      // Whisper indicators
      whisper: {
        // Small text markers (would come from OCR font size metadata)
        smallText: /^(小|ちい)さい/,
        // Dotted content (ellipse-heavy)
        elliptical: /…{2,}/,
        // Parenthetical aside
        aside: /[（(].+[）)]/,
        // Small particles
        faint: /[かも|ねえ|でしょ|かな|っけ|よね]$/
      },
      
      // Shout indicators
      shout: {
        // Multiple exclamation
        intense: /[!！]{2,}/,
        // Elongated vowels (katakana long vowel mark or repeated chars)
        elongation: /[ー]{2,}|(.)\1{3,}/,
        // Imperative/aggressive
        imperative: /(やめろ|くたばれ|黙れ|うるさい|殺す|死ね)[!！]*/,
        // Large font indicators (from metadata)
        sizeMarkers: /[大|おお]きい/
      },
      
      // Sign/label indicators
      sign: {
        // Building/location names
        location: /(学校|病院|駅|店|屋|銀行|警察署|神社|寺)/,
        // Directional
        directional: /(入口|出口|非常口|案内|地図)/,
        // Product/brand-like
        brand: /^[A-Z0-9\u30A0-\u30FF]{2,8}[-・][A-Z0-9\u30A0-\u30FF]{2,8}$/,
        // Price/time
        numeric: /[￥¥$€]\d{3,6}|\d{1,2}:\d{2}/
      },
      
      // Foreign language indicators
      foreign: {
        // Korean hangul
        korean: /[\uAC00-\uD7AF]/,
        // Chinese hanzi (simplified variants not in Japanese)
        chinese: /[\u4E00-\u9FA5]/, // Overlap, but context helps
        // English/Latin script
        english: /[a-zA-Z]{3,}/,
        // Russian/Cyrillic
        cyrillic: /[\u0400-\u04FF]/
      },
      
      // Handwritten indicators
      handwritten: {
        // Informal particles
        casual: /[っす|っけ|わよ|ぜよ|だべ|やんす]/,
        // Grammatical errors/child speech
        childlike: /(ちて|ちた|るの|ちゃう|ちゃった)/,
        // Cursive markers (from font analysis)
        irregular: /[～〜]{2,}/
      },
      
      // Meta content
      meta: {
        // Chapter/episode markers
        chapter: /(第[一二三四五六七八九十0-9]+[話章回]|Episode|Chapter)\s*\d+/i,
        // Author notes
        authorNote: /(作者|描き下ろし|おまけ|番外編)/,
        // Copyright
        copyright: /(©|copyright|all rights reserved)/i,
        // Volume info
        volume: /(Vol\.|Volume|巻|単行本)/
      }
    };
  }

  /**
   * Main classification entry point
   * @param {string} text - OCR text content
   * @param {Object} visualFeatures - Bubble visual characteristics
   * @param {Object} context - Surrounding panel/bubble context
   * @returns {ClassificationResult}
   */
  classify(text, visualFeatures = {}, context = {}) {
    if (!text || typeof text !== 'string') {
      return this._createUnknownResult(text);
    }

    const cleaned = this.textCleaner.clean(text, { isVertical: visualFeatures.isVertical });
    const content = cleaned.text || text;
    
    // Gather evidence from multiple sources
    const evidence = {
      textual: this._analyzeTextualFeatures(content),
      visual: this.config.useVisualFeatures ? this._analyzeVisualFeatures(visualFeatures) : null,
      contextual: this._analyzeContext(context),
      structural: this._analyzeStructure(content, visualFeatures)
    };

    // Score each text type
    const scores = this._calculateScores(evidence, content);
    
    // Determine primary and secondary types
    const classification = this._determineType(scores, evidence);
    
    // Determine translation strategy
    const strategy = this._determineStrategy(classification, evidence);

    return {
      primaryType: classification.primary,
      secondaryType: classification.secondary,
      confidence: classification.confidence,
      bubbleStyle: evidence.visual?.bubbleStyle || BubbleStyle.STANDARD,
      evidence,
      scores,
      strategy,
      metadata: {
        hasHonorifics: evidence.textual.hasHonorifics,
        isDialect: evidence.textual.isDialect,
        politenessLevel: evidence.textual.politenessLevel,
        speakerGender: this._inferGender(evidence),
        emotionalTone: this._determineTone(evidence)
      }
    };
  }

  /**
   * Analyze textual features for classification clues
   * @private
   */
  _analyzeTextualFeatures(text) {
    const features = {
      hasQuotes: false,
      quoteType: null,
      hasHonorifics: false,
      isDialect: false,
      politenessLevel: 'neutral', // polite, casual, rough, honorific
      verbEnding: null,
      particleUsage: [],
      containsSFX: false,
      formalityScore: 0
    };

    const r = this.rules;

    // Quote analysis
    if (r.dialogue.quotes.test(text)) {
      features.hasQuotes = true;
      features.quoteType = 'dialogue';
    } else if (r.thought.thoughtQuotes.test(text)) {
      features.hasQuotes = true;
      features.quoteType = 'thought';
    }

    // Honorifics detection
    if (r.dialogue.honorifics.test(text)) {
      features.hasHonorifics = true;
      features.formalityScore += 2;
    }

    // Politeness level
    if (r.dialogue.speechParticles.test(text)) {
      features.politenessLevel = 'polite';
      features.formalityScore += 1;
    } else if (/[だ|る|よ|ぜ|ぞ]$/.test(text)) {
      features.politenessLevel = 'casual';
      features.formalityScore -= 1;
    } else if (/[っす|っけ]$/.test(text)) {
      features.politenessLevel = 'rough';
      features.isDialect = true;
    }

    // SFX check
    if (r.sfx.pureKatakana.test(text) || r.sfx.symbols.test(text)) {
      features.containsSFX = true;
    }

    // First person pronoun (gender/speech style hint)
    if (r.dialogue.firstPerson.test(text)) {
      const match = text.match(r.dialogue.firstPerson);
      features.firstPerson = match[1];
    }

    return features;
  }

  /**
   * Analyze visual bubble characteristics
   * @private
   */
  _analyzeVisualFeatures(features) {
    const analysis = {
      bubbleStyle: BubbleStyle.STANDARD,
      fontSize: features.fontSize || 'medium',
      fontWeight: features.fontWeight || 'normal',
      colorScheme: features.colorScheme || 'black_on_white',
      tailDirection: features.tailDirection || null,
      tailCount: features.tailCount || 0,
      isJagged: features.isJagged || false,
      isCloudLike: features.isCloudLike || false,
      isDotted: features.isDotted || false,
      isRectangular: features.isRectangular || false,
      opacity: features.opacity || 1.0
    };

    // Determine bubble style from visual features
    if (features.isJagged) {
      analysis.bubbleStyle = BubbleStyle.SHOUT;
    } else if (features.isCloudLike) {
      analysis.bubbleStyle = BubbleStyle.THOUGHT;
    } else if (features.isDotted) {
      analysis.bubbleStyle = BubbleStyle.WHISPER;
    } else if (features.isRectangular && !features.tailDirection) {
      analysis.bubbleStyle = BubbleStyle.NARRATION;
    } else if (features.colorScheme === 'white_on_black') {
      analysis.bubbleStyle = BubbleStyle.INVERTED;
    } else if (features.dashedLine) {
      analysis.bubbleStyle = BubbleStyle.RADIO_PHONE;
    }

    // Font size classification
    if (features.fontSize) {
      if (features.fontSize > 24) analysis.fontSize = 'large';
      else if (features.fontSize < 12) analysis.fontSize = 'small';
    }

    return analysis;
  }

  /**
   * Analyze contextual information (surrounding bubbles, panel position)
   * @private
   */
  _analyzeContext(context) {
    return {
      panelPosition: context.panelPosition || 'center',
      surroundingBubbles: context.surroundingBubbles || [],
      isFirstBubble: context.isFirstBubble || false,
      isLastBubble: context.isLastBubble || false,
      speakerKnown: context.speakerKnown || false,
      speakerRole: context.speakerRole || null, // protagonist, antagonist, side
      sceneType: context.sceneType || 'standard', // action, flashback, dream
      previousBubbleType: context.previousBubbleType || null
    };
  }

  /**
   * Analyze structural features (length, formatting)
   * @private
   */
  _analyzeStructure(text, visualFeatures) {
    return {
      length: text.length,
      lineCount: (text.match(/\n/g) || []).length + 1,
      hasNewlines: /\n/.test(text),
      isVertical: visualFeatures.isVertical || false,
      charDensity: text.length / (visualFeatures.area || 100),
      punctuationDensity: (text.match(/[。！？、,.]/g) || []).length / text.length,
      bracketBalance: this._checkBracketBalance(text)
    };
  }

  /**
   * Calculate classification scores for each text type
   * @private
   */
  _calculateScores(evidence, text) {
    const scores = {};
    const r = this.rules;
    const t = evidence.textual;
    const v = evidence.visual;
    const s = evidence.structural;

    // DIALOGUE scoring
    scores[TextType.DIALOGUE] = this._scoreDialogue(t, v, s, r, text);
    
    // NARRATION scoring
    scores[TextType.NARRATION] = this._scoreNarration(t, v, s, r, text);
    
    // THOUGHT scoring
    scores[TextType.THOUGHT] = this._scoreThought(t, v, s, r, text);
    
    // SFX scoring
    scores[TextType.SFX] = this._scoreSFX(t, v, s, r, text);
    
    // WHISPER scoring
    scores[TextType.WHISPER] = this._scoreWhisper(t, v, s, r, text);
    
    // SHOUT scoring
    scores[TextType.SHOUT] = this._scoreShout(t, v, s, r, text);
    
    // SIGN/LABEL scoring
    scores[TextType.SIGN_LABEL] = this._scoreSign(t, v, s, r, text);
    
    // FOREIGN scoring
    scores[TextType.FOREIGN] = this._scoreForeign(t, v, s, r, text);
    
    // HANDWRITTEN scoring
    scores[TextType.HANDWRITTEN] = this._scoreHandwritten(t, v, s, r, text);
    
    // META scoring
    scores[TextType.META] = this._scoreMeta(t, v, s, r, text);

    return scores;
  }

  // Individual scoring methods
  _scoreDialogue(t, v, s, r, text) {
    let score = 0.5;
    
    if (t.hasQuotes && t.quoteType === 'dialogue') score += 0.3;
    if (t.hasHonorifics) score += 0.1;
    if (r.dialogue.speechParticles.test(text)) score += 0.15;
    if (r.dialogue.spokenEnding.test(text)) score += 0.1;
    if (v?.bubbleStyle === BubbleStyle.STANDARD && v.tailCount > 0) score += 0.1;
    if (s.lineCount === 1 || s.lineCount === 2) score += 0.05;
    
    // Penalize if looks like narration
    if (r.narration.literary.test(text)) score -= 0.2;
    if (s.isVertical && s.length > 50) score -= 0.1;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreNarration(t, v, s, r, text) {
    let score = 0.3;
    
    if (!t.hasQuotes) score += 0.2;
    if (r.narration.pastTense.test(text)) score += 0.2;
    if (r.narration.descriptive.test(text)) score += 0.25;
    if (r.narration.literary.test(text)) score += 0.15;
    if (v?.bubbleStyle === BubbleStyle.NARRATION) score += 0.2;
    if (s.isVertical && s.length > 30) score += 0.1;
    if (s.lineCount >= 3) score += 0.1;
    
    // Penalize speech indicators
    if (t.hasHonorifics) score -= 0.15;
    if (r.dialogue.speechParticles.test(text)) score -= 0.2;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreThought(t, v, s, r, text) {
    let score = 0.3;
    
    if (t.hasQuotes && t.quoteType === 'thought') score += 0.3;
    if (v?.bubbleStyle === BubbleStyle.THOUGHT) score += 0.35;
    if (r.thought.internalParticles.test(text)) score += 0.2;
    if (r.thought.reflection.test(text)) score += 0.15;
    if (r.thought.cognitive.test(text)) score += 0.1;
    if (!r.dialogue.speechParticles.test(text) && r.thought.internalParticles.test(text)) {
      score += 0.1;
    }
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreSFX(t, v, s, r, text) {
    let score = 0.1;
    
    if (t.containsSFX) score += 0.4;
    if (r.sfx.pureKatakana.test(text)) score += 0.3;
    if (r.sfx.repetition.test(text)) score += 0.2;
    if (r.sfx.symbols.test(text)) score += 0.15;
    if (r.sfx.impact.test(text) || r.sfx.motion.test(text) || r.sfx.emotion.test(text)) {
      score += 0.2;
    }
    if (text.length <= 6) score += 0.1;
    if (!/[。！？]/.test(text)) score += 0.05; // SFX rarely has sentence endings
    
    // Visual cues
    if (v?.fontSize === 'large') score += 0.1;
    if (v?.fontWeight === 'bold') score += 0.1;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreWhisper(t, v, s, r, text) {
    let score = 0.2;
    
    if (v?.bubbleStyle === BubbleStyle.WHISPER) score += 0.4;
    if (v?.fontSize === 'small') score += 0.2;
    if (r.whisper.elliptical.test(text)) score += 0.15;
    if (r.whisper.aside.test(text)) score += 0.1;
    if (r.whisper.faint.test(text)) score += 0.1;
    if (v?.opacity && v.opacity < 0.8) score += 0.1;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreShout(t, v, s, r, text) {
    let score = 0.2;
    
    if (v?.bubbleStyle === BubbleStyle.SHOUT) score += 0.4;
    if (r.shout.intense.test(text)) score += 0.25;
    if (r.shout.elongation.test(text)) score += 0.15;
    if (r.shout.imperative.test(text)) score += 0.2;
    if (v?.fontSize === 'large') score += 0.1;
    if (v?.fontWeight === 'bold') score += 0.1;
    if (t.politenessLevel === 'rough') score += 0.1;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreSign(t, v, s, r, text) {
    let score = 0.15;
    
    if (r.sign.location.test(text)) score += 0.3;
    if (r.sign.directional.test(text)) score += 0.25;
    if (r.sign.brand.test(text)) score += 0.2;
    if (r.sign.numeric.test(text)) score += 0.15;
    if (v?.bubbleStyle === BubbleStyle.SIGN) score += 0.25;
    if (!t.hasQuotes && !r.dialogue.speechParticles.test(text)) score += 0.1;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreForeign(t, v, s, r, text) {
    let score = 0.1;
    
    if (r.foreign.korean.test(text)) score += 0.4;
    if (r.foreign.english.test(text)) score += 0.3;
    if (r.foreign.cyrillic.test(text)) score += 0.4;
    // Chinese detection is tricky due to kanji overlap, use context
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreHandwritten(t, v, s, r, text) {
    let score = 0.15;
    
    if (r.handwritten.casual.test(text)) score += 0.2;
    if (r.handwritten.childlike.test(text)) score += 0.25;
    if (r.handwritten.irregular.test(text)) score += 0.15;
    if (t.isDialect) score += 0.1;
    if (v?.fontWeight === 'irregular') score += 0.2;
    
    return Math.min(1.0, Math.max(0, score));
  }

  _scoreMeta(t, v, s, r, text) {
    let score = 0.1;
    
    if (r.meta.chapter.test(text)) score += 0.4;
    if (r.meta.authorNote.test(text)) score += 0.35;
    if (r.meta.copyright.test(text)) score += 0.3;
    if (r.meta.volume.test(text)) score += 0.25;
    if (s.lineCount === 1 && text.length < 20) score += 0.1;
    
    return Math.min(1.0, Math.max(0, score));
  }

  /**
   * Determine final type from scores
   * @private
   */
  _determineType(scores, evidence) {
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [primary, primaryScore] = sorted[0];
    const [secondary, secondaryScore] = sorted[1];
    
    // Calculate confidence based on score gap
    const gap = primaryScore - secondaryScore;
    let confidence;
    if (gap > 0.3 && primaryScore > 0.7) confidence = ConfidenceLevel.HIGH;
    else if (gap > 0.15 && primaryScore > 0.5) confidence = ConfidenceLevel.MEDIUM;
    else if (primaryScore > 0.4) confidence = ConfidenceLevel.LOW;
    else confidence = ConfidenceLevel.UNCERTAIN;

    // Override based on strong visual cues
    const visualStyle = evidence.visual?.bubbleStyle;
    if (visualStyle === BubbleStyle.THOUGHT && primary !== TextType.THOUGHT) {
      if (scores[TextType.THOUGHT] > 0.3) {
        return { primary: TextType.THOUGHT, secondary: primary, confidence };
      }
    }

    return {
      primary: primary || TextType.UNKNOWN,
      secondary: secondaryScore > 0.3 ? secondary : null,
      confidence
    };
  }

  /**
   * Determine translation strategy based on classification
   * @private
   */
  _determineStrategy(classification, evidence) {
    const strategies = {
      [TextType.DIALOGUE]: {
        approach: 'natural_speech',
        honorifics: this.config.detectHonorifics ? 'preserve' : 'adapt',
        register: evidence.textual.politenessLevel,
        notes: 'Maintain character voice and speech patterns'
      },
      [TextType.NARRATION]: {
        approach: 'literary',
        honorifics: 'none',
        register: 'formal',
        notes: 'Smooth, flowing prose style'
      },
      [TextType.THOUGHT]: {
        approach: 'internal_monologue',
        honorifics: 'optional',
        register: 'intimate',
        notes: 'Personal, stream-of-consciousness style'
      },
      [TextType.SFX]: {
        approach: 'sound_effect',
        localization: true,
        preserveOriginal: true,
        notes: 'Translate meaning while keeping visual impact'
      },
      [TextType.WHISPER]: {
        approach: 'subdued',
        register: 'soft',
        formatting: 'small_text',
        notes: 'Quiet, intimate tone'
      },
      [TextType.SHOUT]: {
        approach: 'emphatic',
        register: 'intense',
        formatting: 'bold_large',
        notes: 'High energy, possible ALL CAPS'
      },
      [TextType.SIGN_LABEL]: {
        approach: 'functional',
        context: 'background_element',
        notes: 'Clear, concise translation'
      },
      [TextType.FOREIGN]: {
        approach: 'preserve_or_translate',
        notes: 'Keep foreign script or provide translation note'
      },
      [TextType.HANDWRITTEN]: {
        approach: 'character_voice',
        register: 'personal',
        notes: 'Maintain idiosyncrasies and personality'
      },
      [TextType.META]: {
        approach: 'transliterate',
        notes: 'Translate literally, preserve formatting'
      },
      [TextType.UNKNOWN]: {
        approach: 'standard',
        notes: 'Generic translation with context awareness'
      }
    };

    return strategies[classification.primary] || strategies[TextType.UNKNOWN];
  }

  /**
   * Infer speaker gender from linguistic cues
   * @private
   */
  _inferGender(evidence) {
    const t = evidence.textual;
    
    // Japanese gendered speech patterns
    if (t.firstPerson) {
      if (['僕', 'ぼく', '俺', 'おれ'].includes(t.firstPerson)) return 'male';
      if (['あたし', 'わたし', '私'].includes(t.firstPerson)) return 'female';
    }
    
    // Sentence-ending particles
    const text = evidence.text; // Would need to pass original text
    if (/[わよ|なの|かしら]$/.test(text)) return 'female';
    if (/[ぜよ|ぞ|だろ]$/.test(text)) return 'male';
    
    return 'unknown';
  }

  /**
   * Determine emotional tone
   * @private
   */
  _determineTone(evidence) {
    const t = evidence.textual;
    const v = evidence.visual;
    
    if (v?.bubbleStyle === BubbleStyle.SHOUT || t.politenessLevel === 'rough') {
      return 'aggressive';
    }
    if (v?.bubbleStyle === BubbleStyle.WHISPER) return 'intimate';
    if (v?.bubbleStyle === BubbleStyle.THOUGHT) return 'contemplative';
    if (t.politenessLevel === 'polite') return 'respectful';
    if (t.containsSFX) return 'dynamic';
    
    return 'neutral';
  }

  /**
   * Check bracket/quote balance
   * @private
   */
  _checkBracketBalance(text) {
    const openers = (text.match(/[「『（【［〈《]/g) || []).length;
    const closers = (text.match(/[」』）】］〉》]/g) || []).length;
    return { balanced: openers === closers, openers, closers };
  }

  /**
   * Create result for unknown/invalid input
   * @private
   */
  _createUnknownResult(text) {
    return {
      primaryType: TextType.UNKNOWN,
      secondaryType: null,
      confidence: ConfidenceLevel.UNCERTAIN,
      bubbleStyle: BubbleStyle.STANDARD,
      evidence: null,
      scores: {},
      strategy: {
        approach: 'standard',
        notes: 'Unable to classify input'
      },
      metadata: {
        hasHonorifics: false,
        isDialect: false,
        politenessLevel: 'neutral',
        speakerGender: 'unknown',
        emotionalTone: 'neutral'
      }
    };
  }

  /**
   * Batch classify multiple bubbles
   */
  classifyBatch(bubbles) {
    return bubbles.map((bubble, index) => {
      const context = {
        ...bubble.context,
        isFirstBubble: index === 0,
        isLastBubble: index === bubbles.length - 1,
        previousBubbleType: index > 0 ? bubbles[index - 1].type : null
      };
      
      return this.classify(bubble.text, bubble.visualFeatures, context);
    });
  }
}

/**
 * Factory function
 */
export function createBubbleClassifier(options) {
  return new BubbleClassifier(options);
}

// Exports
export default BubbleClassifier;