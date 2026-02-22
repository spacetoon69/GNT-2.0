/**
 * honorifics-handler.js
 * Japanese honorifics preservation and translation logic
 * Maintains cultural authenticity while ensuring readability
 * 
 * @module core/computer-vision/translation/honorifics-handler
 */

import { ConfigManager } from '../../../shared/config-manager.js';
import { TextSanitizer } from '../../../shared/utils/text-sanitizer.js';

/**
 * Honorifics Handler for Japanese Manga Translation
 * Manages the complex decision-making around honorific preservation vs. adaptation
 */
class HonorificsHandler {
  constructor() {
    this.config = new ConfigManager();
    this.sanitizer = new TextSanitizer();
    
    // User preference settings
    this.settings = {
      mode: 'preserve', // 'preserve' | 'adapt' | 'hybrid' | 'remove'
      targetLanguage: 'en',
      familiarityLevel: 'formal', // 'formal' | 'casual' | 'contextual'
      annotateFirstUse: true,
      useTNotes: false, // Translator notes
      preserveInNarrative: true,
      adaptInDialogue: false,
      characterSpecificRules: new Map()
    };

    // Comprehensive honorific database
    this.HONORIFICS = {
      // Standard honorifics
      'さん': {
        romaji: 'san',
        meaning: 'Mr./Ms./Mx. (neutral respect)',
        formality: 3,
        gender: 'neutral',
        usage: 'general, professional, safe default',
        adaptEn: (name) => this._adaptSan(name),
        context: 'neutral'
      },
      '君': {
        romaji: 'kun',
        meaning: 'boy/young male, or subordinate',
        formality: 2,
        gender: 'male',
        usage: 'boys, young men, male subordinates (sometimes girls in tomboy context)',
        adaptEn: (name, context) => this._adaptKun(name, context),
        context: 'casual-male'
      },
      'ちゃん': {
        romaji: 'chan',
        meaning: 'cute, intimate, childish',
        formality: 1,
        gender: 'neutral',
        usage: 'children, close friends, lovers, pets, cute things',
        adaptEn: (name, context) => this._adaptChan(name, context),
        context: 'intimate'
      },
      '様': {
        romaji: 'sama',
        meaning: 'high respect, customer/god/master',
        formality: 5,
        gender: 'neutral',
        usage: 'customers, masters, deities, extreme respect',
        adaptEn: (name, context) => this._adaptSama(name, context),
        context: 'formal-reverence'
      },
      '殿': {
        romaji: 'dono',
        meaning: 'lord, archaic respect',
        formality: 4,
        gender: 'neutral',
        usage: 'historical, samurai era, formal letters',
        adaptEn: (name) => `Lord ${name}`,
        context: 'archaic-formal'
      },
      '先生': {
        romaji: 'sensei',
        meaning: 'teacher, master, doctor, professional',
        formality: 4,
        gender: 'neutral',
        usage: 'teachers, doctors, artists, writers, masters',
        adaptEn: (name, role) => this._adaptSensei(name, role),
        context: 'professional'
      },
      '先輩': {
        romaji: 'senpai',
        meaning: 'senior, upperclassman',
        formality: 3,
        gender: 'neutral',
        usage: 'workplace/school seniors',
        adaptEn: (name) => `Senpai ${name}`,
        context: 'hierarchical'
      },
      '後輩': {
        romaji: 'kouhai',
        meaning: 'junior, underclassman',
        formality: 2,
        gender: 'neutral',
        usage: 'referring to juniors (rarely used directly)',
        adaptEn: (name) => `${name}-kouhai`,
        context: 'hierarchical'
      },
      
      // Occupational/role-based
      '教授': {
        romaji: 'kyouju',
        meaning: 'professor',
        formality: 5,
        gender: 'neutral',
        usage: 'university professors',
        adaptEn: (name) => `Professor ${name}`,
        context: 'academic'
      },
      '社長': {
        romaji: 'shachou',
        meaning: 'company president',
        formality: 4,
        gender: 'neutral',
        usage: 'company heads',
        adaptEn: (name) => `President ${name}`,
        context: 'business'
      },
      
      // Familial/relational
      'お兄さん': {
        romaji: 'oniisan',
        meaning: 'older brother (respectful)',
        formality: 2,
        gender: 'male',
        usage: 'older brother or young man',
        adaptEn: (name, rel) => this._adaptFamily(name, 'brother', rel),
        context: 'familial'
      },
      'お兄ちゃん': {
        romaji: 'oniichan',
        meaning: 'big brother (cute/intimate)',
        formality: 1,
        gender: 'male',
        usage: 'close older brother',
        adaptEn: (name, rel) => this._adaptFamily(name, 'big-bro', rel),
        context: 'familial-intimate'
      },
      'お姉さん': {
        romaji: 'oneesan',
        meaning: 'older sister (respectful)',
        formality: 2,
        gender: 'female',
        usage: 'older sister or young woman',
        adaptEn: (name, rel) => this._adaptFamily(name, 'sister', rel),
        context: 'familial'
      },
      'お姉ちゃん': {
        romaji: 'oneechan',
        meaning: 'big sister (cute/intimate)',
        formality: 1,
        gender: 'female',
        usage: 'close older sister',
        adaptEn: (name, rel) => this._adaptFamily(name, 'big-sis', rel),
        context: 'familial-intimate'
      },
      
      // Self-deprecating/humble
      '私': {
        romaji: 'watashi',
        meaning: 'I (formal/neutral)',
        formality: 3,
        gender: 'neutral',
        usage: 'standard polite first person',
        adaptEn: () => 'I',
        context: 'self'
      },
      '僕': {
        romaji: 'boku',
        meaning: 'I (boyish/modest)',
        formality: 2,
        gender: 'male',
        usage: 'boys, modest men',
        adaptEn: () => 'I',
        context: 'self-male'
      },
      '俺': {
        romaji: 'ore',
        meaning: 'I (rough/masculine)',
        formality: 1,
        gender: 'male',
        usage: 'casual men, rough characters',
        adaptEn: () => 'I',
        context: 'self-rough'
      },
      'あたし': {
        romaji: 'atashi',
        meaning: 'I (girly/cute)',
        formality: 1,
        gender: 'female',
        usage: 'girly girls',
        adaptEn: () => 'I',
        context: 'self-female'
      },
      
      // Slang/vulgar
      'てめえ': {
        romaji: 'temee',
        meaning: 'you (vulgar/hostile)',
        formality: 0,
        gender: 'neutral',
        usage: 'fights, anger, yakuza',
        adaptEn: (name) => `you bastard`,
        context: 'hostile'
      },
      'お前': {
        romaji: 'omae',
        meaning: 'you (rough/casual)',
        formality: 1,
        gender: 'neutral',
        usage: 'close male friends, condescending',
        adaptEn: (name, context) => this._adaptOmae(name, context),
        context: 'rough-casual'
      },
      '貴様': {
        romaji: 'kisama',
        meaning: 'you (archaic insult)',
        formality: 0,
        gender: 'neutral',
        usage: 'villains, extreme anger, historical',
        adaptEn: (name) => `you wretch`,
        context: 'hostile-archaic'
      }
    };

    // Context patterns for better adaptation decisions
    this.CONTEXT_PATTERNS = {
      business: /会社|仕事|会議|取引|ビジネス|office|business|work/,
      school: /学校|生徒|教室|授業|学校|school|class|student/,
      fantasy: /魔王|勇者|魔法|剣|城|dungeon|dragon|magic|sword/,
      historical: /侍|武士|江戸|幕府|samurai|edo|shogun/,
      modern: /現代|東京|都会|city|modern|tokyo/,
      romance: /恋|愛|デート|キス|love|date|kiss|romance/,
      action: /戦い|バトル|勝負|fight|battle|combat/
    };

    // Name detection patterns
    this.NAME_PATTERNS = {
      japanese: /[一-龠々〆ヵヶ]{1,4}[さんちゃん君様殿]/,
      mixed: /[A-Za-z]+[さんちゃん君様]/,
      reverse: /[さんちゃん君様][一-龠々〆ヵヶ]{1,4}/
    };
  }

  /**
   * Initialize with user preferences
   */
  async initialize(preferences = {}) {
    const stored = await this.config.get('honorifics_settings');
    Object.assign(this.settings, stored, preferences);
    
    console.log(`[HonorificsHandler] Initialized in ${this.settings.mode} mode`);
    return this.settings;
  }

  /**
   * Process text for honorific handling
   * @param {Object} params - Processing parameters
   * @returns {Object} Processed result with options
   */
  process(params) {
    const {
      text,
      context = {},
      character,
      bubbleType,
      targetLang = this.settings.targetLanguage
    } = params;

    if (targetLang !== 'en') {
      // For non-English, generally preserve or transliterate
      return this._handleNonEnglish(text, targetLang, context);
    }

    // Detect honorifics in text
    const detected = this._detectHonorifics(text);
    
    if (detected.length === 0) {
      return {
        original: text,
        processed: text,
        honorifics: [],
        mode: this.settings.mode,
        changes: []
      };
    }

    // Apply processing based on mode
    let processed = text;
    const changes = [];

    switch (this.settings.mode) {
      case 'preserve':
        processed = this._preserveMode(text, detected, context);
        break;
      case 'adapt':
        processed = this._adaptMode(text, detected, context, character);
        break;
      case 'hybrid':
        processed = this._hybridMode(text, detected, context, character);
        break;
      case 'remove':
        processed = this._removeMode(text, detected);
        break;
      default:
        processed = this._preserveMode(text, detected, context);
    }

    // Track changes
    detected.forEach(h => {
      changes.push({
        original: h.fullMatch,
        honorific: h.honorificData,
        position: h.position,
        transformation: this._getTransformation(h, this.settings.mode)
      });
    });

    return {
      original: text,
      processed: processed,
      honorifics: detected.map(h => ({
        type: h.honorificData.romaji,
        target: h.name,
        formality: h.honorificData.formality
      })),
      mode: this.settings.mode,
      changes: changes,
      annotations: this._generateAnnotations(detected, context)
    };
  }

  /**
   * Post-process translation to restore or adapt honorifics
   * @param {Object} translationResult - Raw translation output
   * @param {Object} originalContext - Original honorific context
   * @returns {string} Final processed text
   */
  postProcess(translationResult, originalContext) {
    const { text: translated, engine, confidence } = translationResult;
    const { honorifics, mode, character } = originalContext;

    if (!honorifics || honorifics.length === 0) {
      return translated;
    }

    // Check if honorifics were preserved in translation
    const preserved = this._checkPreservation(translated, honorifics);
    
    if (mode === 'preserve' && !preserved.allKept) {
      // Restore missing honorifics
      return this._restoreHonorifics(translated, honorifics, originalContext);
    }

    if (mode === 'adapt' && preserved.anyKept) {
      // Ensure adaptations are consistent
      return this._standardizeAdaptations(translated, honorifics, character);
    }

    return translated;
  }

  /**
   * Detect all honorifics in text
   * @private
   */
  _detectHonorifics(text) {
    const detected = [];
    
    Object.entries(this.HONORIFICS).forEach(([honorific, data]) => {
      // Pattern: Name + Honorific (most common)
      const pattern1 = new RegExp(`([一-龠々〆ヵヶA-Za-z]+)${honorific}`, 'g');
      // Pattern: Honorific + Name (less common, formal)
      const pattern2 = new RegExp(`${honorific}([一-龠々〆ヵヶA-Za-z]+)`, 'g');
      
      let match;
      while ((match = pattern1.exec(text)) !== null) {
        detected.push({
          fullMatch: match[0],
          name: match[1],
          honorific: honorific,
          honorificData: data,
          position: match.index,
          pattern: 'name-first'
        });
      }
      
      while ((match = pattern2.exec(text)) !== null) {
        detected.push({
          fullMatch: match[0],
          name: match[1],
          honorific: honorific,
          honorificData: data,
          position: match.index,
          pattern: 'honorific-first'
        });
      }
    });

    // Sort by position
    return detected.sort((a, b) => a.position - b.position);
  }

  /**
   * Preserve mode: Keep honorifics as-is (with optional annotations)
   * @private
   */
  _preserveMode(text, detected, context) {
    if (!this.settings.annotateFirstUse) return text;

    let processed = text;
    const annotations = [];

    // Add translator notes for first occurrences
    detected.forEach((h, index) => {
      if (index === 0 || !this._isRecentlySeen(h.name, h.honorific)) {
        const note = this._createTranslatorNote(h);
        if (this.settings.useTNotes) {
          annotations.push(note);
        }
        this._markAsSeen(h.name, h.honorific);
      }
    });

    return {
      text: processed,
      annotations: annotations,
      note: 'Honorifics preserved in original form'
    };
  }

  /**
   * Adapt mode: Convert to English equivalents
   * @private
   */
  _adaptMode(text, detected, context, character) {
    let processed = text;
    const adaptations = [];

    // Process in reverse order to maintain positions
    [...detected].reverse().forEach(h => {
      const adapted = h.honorificData.adaptEn(h.name, {
        character,
        context: this._detectContext(context),
        relationship: this._determineRelationship(h.name, character, context)
      });

      adaptations.push({
        original: h.fullMatch,
        adapted: adapted,
        position: h.position
      });

      // Replace in text
      processed = processed.substring(0, h.position) + 
                  adapted + 
                  processed.substring(h.position + h.fullMatch.length);
    });

    return processed;
  }

  /**
   * Hybrid mode: Smart preservation/adaptation mix
   * @private
   */
  _hybridMode(text, detected, context, character) {
    const sceneContext = this._detectContext(context);
    const adaptations = [];

    detected.forEach(h => {
      const shouldAdapt = this._shouldAdaptInContext(h, sceneContext, character);
      
      if (shouldAdapt) {
        const adapted = h.honorificData.adaptEn(h.name, {
          character,
          context: sceneContext
        });
        adaptations.push({
          original: h.fullMatch,
          replacement: adapted,
          strategy: 'adapt'
        });
      } else {
        adaptations.push({
          original: h.fullMatch,
          replacement: h.fullMatch,
          strategy: 'preserve',
          note: this._createBriefNote(h)
        });
      }
    });

    // Apply adaptations
    let processed = text;
    adaptations.reverse().forEach(a => {
      processed = processed.replace(a.original, a.replacement);
    });

    return processed;
  }

  /**
   * Remove mode: Strip honorifics entirely
   * @private
   */
  _removeMode(text, detected) {
    let processed = text;
    
    [...detected].reverse().forEach(h => {
      processed = processed.substring(0, h.position) + 
                  h.name + 
                  processed.substring(h.position + h.fullMatch.length);
    });

    return processed;
  }

  /**
   * Adaptation strategies for specific honorifics
   * @private
   */
  _adaptSan(name) {
    // Context-aware adaptation for -san
    return `${name}`; // Default: just the name
  }

  _adaptKun(name, context) {
    if (context.relationship === 'superior-to-subordinate') {
      return name; // Just name for subordinate
    }
    if (context.character?.gender === 'female' && context.context === 'tomboy') {
      return `${name}`; // Girl using kun
    }
    return `${name}`; // Generally drop or use first name basis
  }

  _adaptChan(name, context) {
    if (context.relationship === 'sibling-close') {
      return `Li'l ${name}`; // Affectionate
    }
    if (context.relationship === 'romantic') {
      return `${name} dear`; // Intimate
    }
    if (context.context === 'child') {
      return `${name}`; // Just name for kids
    }
    return `${name}`; // Default
  }

  _adaptSama(name, context) {
    if (context.context === 'customer-service') {
      return `${name}-sama`; // Keep for extreme respect
    }
    if (context.context === 'master-servant') {
      return `Master ${name}`;
    }
    if (context.context === 'religious') {
      return `${name}-sama`; // Deities
    }
    return `${name}-sama`; // Generally preserve
  }

  _adaptSensei(name, role) {
    if (role === 'doctor') return `Dr. ${name}`;
    if (role === 'teacher') return `Teacher ${name}`;
    if (role === 'master') return `Master ${name}`;
    return `${name}-sensei`; // Preserve if unclear
  }

  _adaptFamily(name, relation, relationship) {
    if (relationship === 'actual-family') {
      return `Big ${relation === 'brother' ? 'Bro' : 'Sis'} ${name}`;
    }
    if (relationship === 'close-friend') {
      return `${name}-${relation === 'brother' ? 'bro' : 'sis'}`;
    }
    return `${name}`;
  }

  _adaptOmae(name, context) {
    if (context.tone === 'hostile') return `you`;
    if (context.tone === 'friendly-rough') return name; // Close friends
    return `you`;
  }

  /**
   * Context detection for adaptation decisions
   * @private
   */
  _detectContext(context) {
    const { text, setting, character } = context;
    const detected = {
      setting: 'general',
      tone: 'neutral',
      relationship: 'unknown'
    };

    // Check setting patterns
    for (const [settingType, pattern] of Object.entries(this.CONTEXT_PATTERNS)) {
      if (pattern.test(text || '')) {
        detected.setting = settingType;
        break;
      }
    }

    // Determine tone
    if (/[！!]{2,}|[？?]{2,}/.test(text)) {
      detected.tone = 'excited';
    } else if (/[…~〜]/.test(text)) {
      detected.tone = 'contemplative';
    }

    return detected;
  }

  /**
   * Determine relationship between speaker and target
   * @private
   */
  _determineRelationship(targetName, speakerCharacter, context) {
    if (!speakerCharacter || !context.characterRelationships) return 'unknown';
    
    const rel = context.characterRelationships[speakerCharacter.id]?.[targetName];
    return rel || 'unknown';
  }

  /**
   * Decide whether to adapt based on context
   * @private
   */
  _shouldAdaptInContext(honorificData, sceneContext, character) {
    // High formality honorifics generally preserved
    if (honorificData.honorificData.formality >= 4) {
      return false;
    }

    // Family terms often adapted
    if (honorificData.honorificData.context === 'familial') {
      return true;
    }

    // Business context: adapt casual honorifics
    if (sceneContext.setting === 'business' && honorificData.honorificData.formality <= 2) {
      return true;
    }

    // Historical: preserve all
    if (sceneContext.setting === 'historical') {
      return false;
    }

    return false; // Default: preserve
  }

  /**
   * Check if honorifics were preserved in translation
   * @private
   */
  _checkPreservation(translated, originalHonorifics) {
    let allKept = true;
    let anyKept = false;

    originalHonorifics.forEach(h => {
      const romaji = h.honorificData.romaji;
      const kept = translated.includes(romaji) || 
                   translated.includes(h.honorific);
      
      if (kept) anyKept = true;
      else allKept = false;
    });

    return { allKept, anyKept };
  }

  /**
   * Restore honorifics that were lost in translation
   * @private
   */
  _restoreHonorifics(translated, honorifics, context) {
    let restored = translated;
    
    // Simple restoration: append honorific to name mentions
    honorifics.forEach(h => {
      const name = h.name;
      const honorific = h.honorificData.romaji;
      
      // Find bare name and restore honorific
      const bareNamePattern = new RegExp(`\\b${name}\\b(?!-${honorific})`, 'g');
      restored = restored.replace(bareNamePattern, `${name}-${honorific}`);
    });

    return restored;
  }

  /**
   * Standardize adaptations for consistency
   * @private
   */
  _standardizeAdaptations(translated, honorifics, character) {
    // Ensure all instances of same name+honoific combo are treated same way
    return translated;
  }

  /**
   * Create translator notes
   * @private
   */
  _createTranslatorNote(honorificData) {
    const h = honorificData.honorificData;
    return {
      type: 'translator-note',
      reference: honorificData.fullMatch,
      content: `${h.romaji}: ${h.meaning}`,
      position: 'margin'
    };
  }

  _createBriefNote(honorificData) {
    return `[${honorificData.honorificData.romaji}]`;
  }

  /**
   * Track seen honorifics to avoid redundant annotations
   * @private
   */
  _isRecentlySeen(name, honorific) {
    const key = `${name}-${honorific}`;
    // Check session storage or cache
    return false; // Simplified
  }

  _markAsSeen(name, honorific) {
    const key = `${name}-${honorific}`;
    // Add to session cache
  }

  /**
   * Generate contextual annotations
   * @private
   */
  _generateAnnotations(detected, context) {
    if (!this.settings.annotateFirstUse) return [];

    return detected.slice(0, 2).map(h => ({
      term: h.honorificData.romaji,
      meaning: h.honorificData.meaning,
      formality: h.honorificData.formality
    }));
  }

  /**
   * Handle non-English target languages
   * @private
   */
  _handleNonEnglish(text, targetLang, context) {
    // For languages that can use honorifics (Spanish, Portuguese, etc.)
    // or those that need special handling
    const preserveLanguages = ['es', 'pt', 'fr', 'de', 'it'];
    
    if (preserveLanguages.includes(targetLang)) {
      return {
        original: text,
        processed: text,
        strategy: 'preserve-transliterated'
      };
    }

    return {
      original: text,
      processed: text,
      strategy: 'remove' // For languages where they don't make sense
    };
  }

  /**
   * Get transformation description
   * @private
   */
  _getTransformation(honorificData, mode) {
    switch (mode) {
      case 'preserve': return 'kept-original';
      case 'adapt': return 'adapted-to-english';
      case 'hybrid': return 'context-dependent';
      case 'remove': return 'removed';
      default: return 'unchanged';
    }
  }

  /**
   * Update settings dynamically
   */
  async updateSettings(newSettings) {
    Object.assign(this.settings, newSettings);
    await this.config.set('honorifics_settings', this.settings);
    return this.settings;
  }

  /**
   * Get current settings and statistics
   */
  getStatus() {
    return {
      settings: this.settings,
      honorificDatabase: Object.keys(this.HONORIFICS).length,
      supportedModes: ['preserve', 'adapt', 'hybrid', 'remove']
    };
  }

  /**
   * Analyze honorific usage in text batch
   * @param {Array<string>} texts - Array of texts to analyze
   * @returns {Object} Statistics and recommendations
   */
  analyzeBatch(texts) {
    const stats = {
      total: 0,
      byType: {},
      byFormality: { low: 0, medium: 0, high: 0 },
      recommendations: []
    };

    texts.forEach(text => {
      const detected = this._detectHonorifics(text);
      stats.total += detected.length;
      
      detected.forEach(h => {
        const type = h.honorificData.romaji;
        stats.byType[type] = (stats.byType[type] || 0) + 1;
        
        const formality = h.honorificData.formality;
        if (formality <= 2) stats.byFormality.low++;
        else if (formality <= 3) stats.byFormality.medium++;
        else stats.byFormality.high++;
      });
    });

    // Generate recommendations
    if (stats.byFormality.high > stats.byFormality.low) {
      stats.recommendations.push('High formality content detected. Recommend "preserve" mode.');
    }
    if (stats.byType['chan'] > 5) {
      stats.recommendations.push('Heavy use of intimate honorifics. Consider "hybrid" mode.');
    }

    return stats;
  }
}

// Export singleton
export const honorificsHandler = new HonorificsHandler();
export default HonorificsHandler;