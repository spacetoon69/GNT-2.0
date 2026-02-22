/**
 * sfx-translator.js
 * Japanese sound effect (SFX) translation and localization
 * Handles giongo (sounds) and gitaigo (states/feelings) with cultural adaptation
 * 
 * @module core/computer-vision/translation/sfx-translator
 */

import { ConfigManager } from '../../../shared/config-manager.js';
import { ImageUtils } from '../../../shared/utils/image-utils.js';

/**
 * SFX Translator for Manga Sound Effects
 * Translates Japanese onomatopoeia while preserving visual and narrative impact
 */
class SFXTranslator {
  constructor() {
    this.config = new ConfigManager();
    this.imageUtils = new ImageUtils();
    
    // Translation strategy settings
    this.settings = {
      mode: 'adaptive', // 'direct', 'adaptive', 'visual', 'hybrid'
      targetLanguage: 'en',
      preserveVisuals: true, // Keep original SFX visually, translate nearby
      useAnnotations: false,
      localizeCulturally: true, // Adapt to culturally familiar sounds
      maintainIntensity: true, // Preserve emotional weight
      fontMatching: true, // Match original typography style
      positionStrategy: 'replace' // 'replace' | 'parallel' | 'annotation'
    };

    // Comprehensive SFX database with cultural mappings
    this.SFX_DATABASE = {
      // Physical impacts and hits
      'ドン': {
        romaji: 'don',
        category: 'impact',
        meaning: 'heavy thud, impact, gunshot',
        intensity: 4,
        visualStyle: 'bold, heavy',
        adaptations: {
          en: ['BAM', 'BOOM', 'THUD', 'WHAM'],
          es: ['BUM', 'PUM', 'ZAS'],
          fr: ['BOUM', 'BADABOUM', 'VLAN']
        },
        context: ['punch', 'explosion', 'slam', 'gunshot'],
        emotion: 'violent, sudden'
      },
      'バン': {
        romaji: 'ban',
        category: 'impact',
        meaning: 'bang, sudden impact',
        intensity: 3,
        visualStyle: 'sharp, explosive',
        adaptations: {
          en: ['BANG', 'POW', 'CRACK'],
          es: ['PUM', 'ZAS'],
          fr: ['PAN', 'POUM']
        },
        context: ['gun', 'door slam', 'slap'],
        emotion: 'sharp, startling'
      },
      'ゴゴゴ': {
        romaji: 'gogogo',
        category: 'atmosphere',
        meaning: 'ominous rumbling, menacing presence',
        intensity: 5,
        visualStyle: 'heavy, vibrating, large',
        adaptations: {
          en: ['*rumble*', '*tremble*', 'RUMBLE RUMBLE', 'THOOM THOOM THOOM'],
          es: ['*retumbar*', 'BRUM BRUM'],
          fr: ['*grondement*', 'GROUM GROUM']
        },
        context: ['villain entrance', 'earthquake', 'heavy machinery', 'tension'],
        emotion: 'ominous, threatening',
        notes: 'Often used for dramatic villain presence (JoJo style)'
      },
      'ドキドキ': {
        romaji: 'dokidoki',
        category: 'physiological',
        meaning: 'heartbeat, nervous excitement',
        intensity: 2,
        visualStyle: 'soft, rhythmic, rounded',
        adaptations: {
          en: ['*thump thump*', 'ba-dump ba-dump', 'pitter-patter', '*heartbeat*'],
          es: ['*latido*', 'pum-pum'],
          fr: ['*battement*', 'poum-poum']
        },
        context: ['nervousness', 'love', 'excitement', 'fear'],
        emotion: 'anxious, excited',
        notes: 'Very common in romance/shoujo manga'
      },
      'ガタガタ': {
        romaji: 'gatagata',
        category: 'vibration',
        meaning: 'rattling, shaking, clattering',
        intensity: 3,
        visualStyle: 'jagged, repetitive',
        adaptations: {
          en: ['*rattle*', '*clatter*', 'RATTLE RATTLE', 'shake shake'],
          es: ['*traqueteo*', 'cataclan'],
          fr: ['*claquement*', 'claquetis']
        },
        context: ['teeth chattering', 'shaking with fear/cold', 'old machinery'],
        emotion: 'fear, cold, instability'
      },
      'ピカピカ': {
        romaji: 'pikapika',
        category: 'visual-state',
        meaning: 'sparkling, shining, gleaming',
        intensity: 1,
        visualStyle: 'bright, star-like, clean',
        adaptations: {
          en: ['*sparkle*', '*shine*', 'bling bling', 'twinkle twinkle'],
          es: ['*brillo*', 'brillante'],
          fr: ['*brillant*', 'scintillement']
        },
        context: ['cleanliness', 'newness', 'stars', 'eyes shining', 'treasure'],
        emotion: 'positive, admiration, cleanliness'
      },
      'メラメラ': {
        romaji: 'meramera',
        category: 'visual-state',
        meaning: 'flames blazing, intense burning',
        intensity: 4,
        visualStyle: 'flame-like, rising, intense',
        adaptations: {
          en: ['*crackle*', '*roar*', 'CRACKLE CRACKLE', 'blaze blaze'],
          es: ['*crepitar*', 'fuego fuego'],
          fr: ['*crépitement*', 'flamboiement']
        },
        context: ['fire', 'passion', 'anger', 'intense heat'],
        emotion: 'intense, destructive, passionate'
      },
      'ニコニコ': {
        romaji: 'nikoniko',
        category: 'expression',
        meaning: 'smiling, grinning happily',
        intensity: 1,
        visualStyle: 'soft, curved, friendly',
        adaptations: {
          en: ['*grin*', '*smile*', 'hehe', ':)'],
          es: ['*sonrisa*', 'jeje'],
          fr: ['*sourire*', 'héhé']
        },
        context: ['happiness', 'friendliness', 'satisfaction'],
        emotion: 'happy, content, friendly'
      },
      'イライラ': {
        romaji: 'iraira',
        category: 'emotional-state',
        meaning: 'irritated, annoyed, frustrated',
        intensity: 3,
        visualStyle: 'spiky, tense, scratchy',
        adaptations: {
          en: ['*grr*', '*annoyed*', 'tch', 'grumble grumble'],
          es: ['*irritado*', 'grr'],
          fr: ['*agacé*', 'grr']
        },
        context: ['annoyance', 'impatience', 'frustration'],
        emotion: 'irritated, tense'
      },
      'ムカムカ': {
        romaji: 'mukamuka',
        category: 'physiological',
        meaning: 'nauseous, sick feeling, angry rising',
        intensity: 3,
        visualStyle: 'wavy, rising, uneasy',
        adaptations: {
          en: ['*queasy*', '*retch*', 'ugh ugh', 'urk'],
          es: ['*náuseas*', 'ulp'],
          fr: ['*nausée*', 'beurk']
        },
        context: ['nausea', 'disgust', 'anger rising', 'motion sickness'],
        emotion: 'sick, disgusted, angry'
      },
      'キラキラ': {
        romaji: 'kirakira',
        category: 'visual-state',
        meaning: 'sparkling, glittering, twinkling',
        intensity: 2,
        visualStyle: 'star-like, scattered, magical',
        adaptations: {
          en: ['*sparkle*', '*glitter*', 'twinkle', 'shimmer'],
          es: ['*destello*', 'centelleo'],
          fr: ['*scintillement*', 'brillant']
        },
        context: ['stars', 'jewelry', 'magic', 'eyes', 'clean water'],
        emotion: 'magical, beautiful, dreamy'
      },
      'グニャグニャ': {
        romaji: 'gunyagunya',
        category: 'texture',
        meaning: 'squishy, soft, floppy, melting',
        intensity: 2,
        visualStyle: 'wavy, soft, droopy',
        adaptations: {
          en: ['*squish*', '*wobble*', 'squash', 'flop'],
          es: ['*blando*', 'crujiente suave'],
          fr: ['*mou*', 'gauche']
        },
        context: ['soft food', 'tired body', 'melting', 'slime'],
        emotion: 'soft, weak, exhausted'
      },
      'ザワザワ': {
        romaji: 'zawazawa',
        category: 'atmosphere',
        meaning: 'restless, uneasy atmosphere, murmuring crowd',
        intensity: 3,
        visualStyle: 'wavy, scattered, nervous',
        adaptations: {
          en: ['*murmur*', '*rustle*', 'murmur murmur', 'buzz buzz'],
          es: ['*murmullo*', 'zumbido'],
          fr: ['*murmure*', 'bourdonnement']
        },
        context: ['crowd unrest', 'nervous atmosphere', 'leaves rustling', 'tension'],
        emotion: 'uneasy, restless, tense'
      },
      'ペコペコ': {
        romaji: 'pekopeko',
        category: 'action',
        meaning: 'bowing repeatedly, hungry stomach',
        intensity: 2,
        visualStyle: 'repetitive, humble, rhythmic',
        adaptations: {
          en: ['*bow*', '*grovel*', 'bow bow', 'rumble rumble (stomach)'],
          es: ['*reverencia*', 'gruñido'],
          fr: ['*courbette*', 'gargouillis']
        },
        context: ['apologizing', 'begging', 'hungry stomach', 'humble'],
        emotion: 'submissive, hungry, apologetic'
      },
      'フワフワ': {
        romaji: 'fuwafuwa',
        category: 'texture',
        meaning: 'fluffy, light, floating, soft',
        intensity: 1,
        visualStyle: 'cloud-like, soft, floating',
        adaptations: {
          en: ['*fluff*', '*float*', 'fluffy', 'soft soft'],
          es: ['*suave*', 'flotante'],
          fr: ['*doux*', 'flottant']
        },
        context: ['clouds', 'cotton', 'hair', 'dreamy feeling', 'floating'],
        emotion: 'soft, light, dreamy, comfortable'
      },
      'バタバタ': {
        romaji: 'batabata',
        category: 'action',
        meaning: 'flapping, panicking, running around',
        intensity: 3,
        visualStyle: 'chaotic, repetitive, hurried',
        adaptations: {
          en: ['*flap*', '*panic*', 'flap flap', 'scramble scramble'],
          es: ['*aletear*', 'pánico'],
          fr: ['*battement*', 'panique']
        },
        context: ['bird wings', 'panic', 'busy activity', 'falling papers'],
        emotion: 'panic, chaos, hurried'
      },
      'ジロジロ': {
        romaji: 'jirojiro',
        category: 'action',
        meaning: 'staring intently, glaring',
        intensity: 3,
        visualStyle: 'sharp, focused, uncomfortable',
        adaptations: {
          en: ['*stare*', '*glare*', 'stare stare', 'intense look'],
          es: ['*mirada fija*', 'mirón'],
          fr: ['*regard fixe*', 'fixement']
        },
        context: ['staring', 'suspicious look', 'intense observation', 'judging'],
        emotion: 'uncomfortable, intense, suspicious'
      },
      'ウロウロ': {
        romaji: 'urouro',
        category: 'action',
        meaning: 'wandering aimlessly, loitering',
        intensity: 2,
        visualStyle: 'circular, lost, uncertain',
        adaptations: {
          en: ['*wander*', '*pace*', 'wander wander', 'pace pace'],
          es: ['*deambular*', 'vagar'],
          fr: ['*errer*', 'roder']
        },
        context: ['lost', 'waiting anxiously', 'boredom', 'searching'],
        emotion: 'lost, anxious, bored'
      },
      'ブルブル': {
        romaji: 'buruburu',
        category: 'physiological',
        meaning: 'shivering, trembling (cold/fear)',
        intensity: 3,
        visualStyle: 'vibrating, wavy, cold',
        adaptations: {
          en: ['*shiver*', '*tremble*', 'brrr', 'shake shake'],
          es: ['*temblar*', 'brrr'],
          fr: ['*trembler*', 'brrr']
        },
        context: ['cold', 'fear', 'excitement', 'fever'],
        emotion: 'cold, scared, nervous'
      },
      'ゴク': {
        romaji: 'goku',
        category: 'physiological',
        meaning: 'gulp, swallowing hard',
        intensity: 2,
        visualStyle: 'sudden, throat motion',
        adaptations: {
          en: ['*gulp*', 'gulp', 'swallow'],
          es: ['*tragar*', 'glup'],
          fr: ['*gloups*', 'déglutir']
        },
        context: ['nervous swallow', 'eating', 'surprise', 'fear'],
        emotion: 'nervous, surprised, anticipating'
      },
      'ニヤニヤ': {
        romaji: 'niyaniya',
        category: 'expression',
        meaning: 'grinning slyly, smirking',
        intensity: 2,
        visualStyle: 'sly, mischievous, curved',
        adaptations: {
          en: ['*smirk*', '*grin*', 'heh heh', 'sly grin'],
          es: ['*sonrisa pícara*', 'jeje'],
          fr: ['*sourire en coin*', 'héhé']
        },
        context: ['mischief', 'secret knowledge', 'teasing', 'evil plan'],
        emotion: 'mischievous, sly, knowing'
      },
      'ポカポカ': {
        romaji: 'pokapoka',
        category: 'atmospheric',
        meaning: 'warm, sunny, comfortable heat',
        intensity: 1,
        visualStyle: 'soft, warm, sun-like',
        adaptations: {
          en: ['*warm*', '*sunny*', 'warm and cozy', 'toasty'],
          es: ['*calorcito*', 'soleado'],
          fr: ['*douce chaleur*', 'ensoleillé']
        },
        context: ['sunshine', 'warm weather', 'comfortable warmth', 'relaxation'],
        emotion: 'comfortable, relaxed, warm'
      },
      'ガーン': {
        romaji: 'gaan',
        category: 'emotional-impact',
        meaning: 'shock, devastating realization, depression',
        intensity: 4,
        visualStyle: 'heavy, dark, downward',
        adaptations: {
          en: ['*shock*', '*devastated*', 'Nooo...', 'WHAM (emotional)'],
          es: ['*shock*', 'nooo'],
          fr: ['*choc*', 'nonnn']
        },
        context: ['bad news', 'rejection', 'failure', 'sudden depression'],
        emotion: 'devastated, shocked, depressed'
      },
      'パチパチ': {
        romaji: 'pachipachi',
        category: 'action',
        meaning: 'clapping, crackling, sparking',
        intensity: 2,
        visualStyle: 'sharp, rhythmic, electric',
        adaptations: {
          en: ['*clap*', '*crackle*', 'clap clap', 'spark spark'],
          es: ['*aplauso*', 'chasquido'],
          fr: ['*applaudissement*', 'crépitement']
        },
        context: ['applause', 'electricity', 'fire crackling', 'clapping hands'],
        emotion: 'positive, energetic, electric'
      },
      'チラチラ': {
        romaji: 'chirachira',
        category: 'action',
        meaning: 'glancing repeatedly, flickering',
        intensity: 2,
        visualStyle: 'flickering, side-glance, quick',
        adaptations: {
          en: ['*glance*', '*peek*', 'peek peek', 'glance glance'],
          es: ['*mirada rápida*', 'vistazo'],
          fr: ['*coup d\'œil*', 'regard furtif']
        },
        context: ['secret looking', 'checking repeatedly', 'flickering light', 'nervous glances'],
        emotion: 'secretive, nervous, curious'
      }
    };

    // Cultural context mappings
    this.CULTURAL_CONTEXTS = {
      'shonen-battle': {
        preferredStyle: 'bold, intense',
        commonSFX: ['ドン', 'バン', 'ゴゴゴ', 'メラメラ', 'ガーン'],
        translationApproach: 'emphasize impact and intensity'
      },
      'shoujo-romance': {
        preferredStyle: 'soft, emotional',
        commonSFX: ['ドキドキ', 'キラキラ', 'ニコニコ', 'フワフワ', 'チラチラ'],
        translationApproach: 'preserve emotional subtlety'
      },
      'horror': {
        preferredStyle: 'disturbing, atmospheric',
        commonSFX: ['ザワザワ', 'ブルブル', 'ジロジロ', 'ガタガタ'],
        translationApproach: 'maintain unease and tension'
      },
      'comedy': {
        preferredStyle: 'exaggerated, playful',
        commonSFX: ['ペコペコ', 'ニヤニヤ', 'バタバタ', 'グニャグニャ'],
        translationApproach: 'amplify humor and exaggeration'
      },
      'slice-of-life': {
        preferredStyle: 'subtle, realistic',
        commonSFX: ['ポカポカ', 'イライラ', 'ウロウロ', 'パチパチ'],
        translationApproach: 'natural, understated'
      }
    };

    // Visual style mappings for font generation
    this.VISUAL_STYLES = {
      'bold-heavy': {
        fontFamily: 'Impact, sans-serif',
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      },
      'sharp-explosive': {
        fontFamily: 'Arial Black, sans-serif',
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        skew: '-5deg'
      },
      'soft-rhythmic': {
        fontFamily: 'Comic Sans MS, cursive',
        fontWeight: '400',
        letterSpacing: '0.02em'
      },
      'jagged-tense': {
        fontFamily: 'Impact, sans-serif',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        rough: true
      },
      'bright-clean': {
        fontFamily: 'Arial Rounded MT Bold, sans-serif',
        fontWeight: '600',
        letterSpacing: '0.03em'
      },
      'flame-like': {
        fontFamily: 'Impact, sans-serif',
        fontWeight: '800',
        textTransform: 'uppercase',
        gradient: 'fire',
        letterSpacing: '0.05em'
      },
      'wavy-soft': {
        fontFamily: 'Comic Sans MS, cursive',
        fontWeight: '400',
        letterSpacing: '0.02em',
        wavy: true
      }
    };
  }

  /**
   * Initialize with settings
   */
  async initialize(settings = {}) {
    const stored = await this.config.get('sfx_settings');
    Object.assign(this.settings, stored, settings);
    return this.settings;
  }

  /**
   * Detect if text is primarily SFX
   * @param {string} text - Text to analyze
   * @returns {Object} Detection result with confidence
   */
  detectSFX(text) {
    if (!text || text.trim().length === 0) {
      return { isSFX: false, confidence: 0 };
    }

    const cleanText = text.trim();
    const indicators = {
      katakanaRatio: 0,
      repetitionPattern: false,
      knownMatch: null,
      lengthScore: 0,
      visualIndicators: false
    };

    // Calculate katakana ratio (SFX are usually katakana)
    const katakanaCount = (cleanText.match(/[\u30A0-\u30FF]/g) || []).length;
    const totalLength = cleanText.length;
    indicators.katakanaRatio = katakanaCount / totalLength;

    // Check for repetition pattern (ドキドキ, ガタガタ)
    indicators.repetitionPattern = /^(\w{2,})\1+$/.test(cleanText) || 
                                    /^(.{2,})\1+$/.test(cleanText);

    // Check against known database
    indicators.knownMatch = this.SFX_DATABASE[cleanText];

    // Length heuristic (SFX usually 2-6 characters repeated)
    indicators.lengthScore = totalLength >= 2 && totalLength <= 12 ? 1 : 0;

    // Calculate confidence
    let confidence = 0;
    if (indicators.knownMatch) confidence += 0.5;
    if (indicators.katakanaRatio > 0.8) confidence += 0.3;
    if (indicators.repetitionPattern) confidence += 0.2;
    confidence += (indicators.lengthScore * 0.1);

    return {
      isSFX: confidence > 0.6,
      confidence: Math.min(confidence, 1),
      details: indicators,
      matchedEntry: indicators.knownMatch
    };
  }

  /**
   * Translate SFX with full context
   * @param {Object} params - Translation parameters
   * @returns {Object} Translation result with visual metadata
   */
  translate(params) {
    const {
      text,
      context = {},
      bubbleType,
      visualContext,
      targetLang = this.settings.targetLanguage
    } = params;

    const detection = this.detectSFX(text);
    
    if (!detection.isSFX) {
      return {
        original: text,
        isSFX: false,
        translation: text,
        strategy: 'passthrough'
      };
    }

    const entry = detection.matchedEntry;
    const strategy = this._determineStrategy(context, entry);

    // Get base translation
    let translation = this._getTranslation(entry, targetLang, strategy, context);

    // Apply intensity modifications
    if (this.settings.maintainIntensity && entry) {
      translation = this._applyIntensity(translation, entry.intensity, context);
    }

    // Generate visual metadata
    const visualMeta = this._generateVisualMetadata(entry, strategy, text);

    // Determine positioning strategy
    const positioning = this._determinePositioning(strategy, visualContext);

    return {
      original: text,
      romaji: entry?.romaji || this._generateRomaji(text),
      isSFX: true,
      confidence: detection.confidence,
      category: entry?.category || 'unknown',
      meaning: entry?.meaning || 'sound effect',
      translation: translation,
      strategy: strategy,
      visual: visualMeta,
      positioning: positioning,
      alternatives: entry ? this._getAlternatives(entry, targetLang) : [],
      culturalNote: this._generateCulturalNote(entry, context)
    };
  }

  /**
   * Batch translate multiple SFX with scene consistency
   */
  translateBatch(sfxArray, sceneContext = {}) {
    const results = [];
    const usedAdaptations = new Map(); // Track for consistency

    sfxArray.forEach((sfx, index) => {
      const result = this.translate({
        ...sfx,
        context: {
          ...sfx.context,
          sceneContext,
          index,
          previousSFX: index > 0 ? results[index - 1] : null
        }
      });

      // Ensure consistency for repeated SFX
      if (usedAdaptations.has(sfx.text)) {
        result.translation = usedAdaptations.get(sfx.text);
        result.consistentWithPrevious = true;
      } else {
        usedAdaptations.set(sfx.text, result.translation);
      }

      results.push(result);
    });

    return results;
  }

  /**
   * Generate visual overlay data for SFX replacement
   */
  generateVisualOverlay(translationResult, originalBoundingBox) {
    const { visual, positioning, original } = translationResult;

    return {
      type: 'sfx-overlay',
      text: translationResult.translation,
      originalText: original,
      boundingBox: originalBoundingBox,
      style: {
        fontFamily: visual.fontFamily,
        fontWeight: visual.fontWeight,
        fontSize: this._calculateFontSize(originalBoundingBox, visual.style),
        color: visual.color || '#000',
        textTransform: visual.textTransform,
        letterSpacing: visual.letterSpacing,
        rotation: positioning.rotation || 0,
        effects: visual.effects || []
      },
      positioning: {
        strategy: positioning.strategy,
        anchor: positioning.anchor || 'center',
        offset: positioning.offset || { x: 0, y: 0 }
      },
      background: {
        type: visual.backgroundType || 'none',
        color: visual.backgroundColor,
        shape: visual.shape || 'speech-bubble'
      },
      animation: visual.animation || null
    };
  }

  /**
   * Determine translation strategy based on context
   * @private
   */
  _determineStrategy(context, entry) {
    const { genre, intensity, bubbleType } = context;

    // Check for cultural context match
    if (genre && this.CULTURAL_CONTEXTS[genre]) {
      const genrePref = this.CULTURAL_CONTEXTS[genre];
      if (genrePref.commonSFX.includes(entry?.romaji)) {
        return 'genre-authentic';
      }
    }

    // High intensity SFX in action contexts
    if (entry?.intensity >= 4 && bubbleType === 'action') {
      return 'emphasized';
    }

    // Emotional/atmospheric SFX
    if (entry?.category === 'emotional-state' || entry?.category === 'atmosphere') {
      return 'atmospheric';
    }

    // Default based on settings
    return this.settings.mode;
  }

  /**
   * Get appropriate translation
   * @private
   */
  _getTranslation(entry, targetLang, strategy, context) {
    if (!entry) {
      // Unknown SFX - transliterate
      return this._generateRomaji(context.text);
    }

    const adaptations = entry.adaptations[targetLang] || entry.adaptations['en'];
    
    switch (strategy) {
      case 'direct':
        return entry.romaji;
      
      case 'adaptive':
      case 'genre-authentic':
        // Select based on intensity and context
        if (entry.intensity >= 4 && adaptations.length > 1) {
          return adaptations[0]; // Most intense version
        }
        return adaptations[adaptations.length - 1]; // Softer version
      
      case 'visual':
        return `[${entry.meaning}]`;
      
      case 'hybrid':
        return `${adaptations[0]} (${entry.romaji})`;
      
      case 'emphasized':
        return adaptations[0].toUpperCase();
      
      case 'atmospheric':
        return adaptations[adaptations.length - 1]; // Subtle version
      
      default:
        return adaptations[0];
    }
  }

  /**
   * Apply intensity modifications
   * @private
   */
  _applyIntensity(translation, intensity, context) {
    if (!this.settings.maintainIntensity) return translation;

    // Modify based on context intensity
    const contextIntensity = context.emotionalIntensity || 3;
    const combinedIntensity = (intensity + contextIntensity) / 2;

    if (combinedIntensity >= 4) {
      // Add emphasis
      return translation.toUpperCase().replace(/\*/g, '');
    } else if (combinedIntensity <= 2) {
      // Soften
      return translation.toLowerCase();
    }

    return translation;
  }

  /**
   * Generate visual metadata for rendering
   * @private
   */
  _generateVisualMetadata(entry, strategy, originalText) {
    if (!entry) {
      return {
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        style: 'unknown-sfx'
      };
    }

    const visualStyle = this.VISUAL_STYLES[entry.visualStyle] || this.VISUAL_STYLES['bold-heavy'];
    
    // Determine color based on category
    const colorMap = {
      'impact': '#FF0000',
      'atmosphere': '#800080',
      'physiological': '#FF69B4',
      'emotional-state': '#FFA500',
      'visual-state': '#00BFFF',
      'action': '#FF4500',
      'texture': '#90EE90'
    };

    return {
      ...visualStyle,
      color: colorMap[entry.category] || '#000000',
      effects: this._determineEffects(entry, strategy),
      backgroundType: entry.intensity > 3 ? 'burst' : 'none',
      shape: this._determineShape(entry.category),
      animation: entry.intensity > 4 ? 'pulse' : null
    };
  }

  /**
   * Determine positioning strategy
   * @private
   */
  _determinePositioning(strategy, visualContext) {
    const strategies = {
      'replace': {
        strategy: 'replace',
        anchor: 'center',
        rotation: visualContext?.rotation || 0
      },
      'parallel': {
        strategy: 'parallel',
        anchor: 'bottom',
        offset: { x: 0, y: 10 },
        rotation: 0
      },
      'annotation': {
        strategy: 'annotation',
        anchor: 'margin',
        offset: { x: 0, y: 0 },
        rotation: 0
      }
    };

    return strategies[this.settings.positionStrategy] || strategies['replace'];
  }

  /**
   * Get alternative translations
   * @private
   */
  _getAlternatives(entry, targetLang) {
    const adaptations = entry.adaptations[targetLang] || entry.adaptations['en'];
    return adaptations.slice(1); // All except the primary
  }

  /**
   * Generate cultural context note
   * @private
   */
  _generateCulturalNote(entry, context) {
    if (!entry || !this.settings.useAnnotations) return null;

    return {
      meaning: entry.meaning,
      emotion: entry.emotion,
      notes: entry.notes,
      category: entry.category
    };
  }

  /**
   * Calculate appropriate font size
   * @private
   */
  _calculateFontSize(boundingBox, style) {
    const area = boundingBox.width * boundingBox.height;
    const baseSize = Math.sqrt(area) / 2;
    
    // Adjust based on style
    if (style === 'bold-heavy') return baseSize * 1.2;
    if (style === 'soft-rhythmic') return baseSize * 0.9;
    
    return baseSize;
  }

  /**
   * Determine visual effects
   * @private
   */
  _determineEffects(entry, strategy) {
    const effects = [];
    
    if (entry.intensity >= 4) {
      effects.push('shadow');
    }
    if (entry.category === 'impact') {
      effects.push('motion-lines');
    }
    if (entry.category === 'visual-state' && entry.romaji === 'kirakira') {
      effects.push('sparkle');
    }
    
    return effects;
  }

  /**
   * Determine bubble shape
   * @private
   */
  _determineShape(category) {
    const shapes = {
      'impact': 'burst',
      'atmosphere': 'cloud',
      'thought': 'bubble',
      'action': 'spiky',
      'default': 'rounded'
    };
    
    return shapes[category] || shapes['default'];
  }

  /**
   * Generate romaji for unknown SFX
   * @private
   */
  _generateRomaji(text) {
    // Simple katakana to romaji mapping
    const katakanaMap = {
      'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
      'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
      'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
      'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
      'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
      'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
      'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
      'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
      'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
      'ワ': 'wa', 'ヲ': 'wo', 'ン': 'n',
      'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
      'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
      'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
      'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
      'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
      'ー': '-', 'ッ': 'tsu', 'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo',
      'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o'
    };

    let romaji = '';
    for (let char of text) {
      romaji += katakanaMap[char] || char;
    }

    return romaji;
  }

  /**
   * Analyze SFX usage across a page/chapter
   */
  analyzeUsage(sfxArray) {
    const stats = {
      total: sfxArray.length,
      byCategory: {},
      byIntensity: { low: 0, medium: 0, high: 0 },
      unique: new Set(),
      repeated: [],
      genreIndicators: []
    };

    sfxArray.forEach(sfx => {
      const detected = this.detectSFX(sfx);
      if (!detected.isSFX) return;

      const entry = detected.matchedEntry;
      if (entry) {
        // Category stats
        stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
        
        // Intensity
        if (entry.intensity <= 2) stats.byIntensity.low++;
        else if (entry.intensity <= 3) stats.byIntensity.medium++;
        else stats.byIntensity.high++;
        
        // Unique tracking
        if (stats.unique.has(entry.romaji)) {
          stats.repeated.push(entry.romaji);
        } else {
          stats.unique.add(entry.romaji);
        }

        // Genre detection
        for (const [genre, context] of Object.entries(this.CULTURAL_CONTEXTS)) {
          if (context.commonSFX.includes(entry.romaji)) {
            stats.genreIndicators.push(genre);
          }
        }
      }
    });

    // Determine likely genre
    const genreCounts = {};
    stats.genreIndicators.forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    stats.likelyGenre = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    return stats;
  }

  /**
   * Update settings
   */
  async updateSettings(newSettings) {
    Object.assign(this.settings, newSettings);
    await this.config.set('sfx_settings', this.settings);
    return this.settings;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      settings: this.settings,
      databaseSize: Object.keys(this.SFX_DATABASE).length,
      supportedLanguages: ['en', 'es', 'fr'],
      categories: [...new Set(Object.values(this.SFX_DATABASE).map(e => e.category))]
    };
  }
}

// Export singleton
export const sfxTranslator = new SFXTranslator();
export default SFXTranslator;