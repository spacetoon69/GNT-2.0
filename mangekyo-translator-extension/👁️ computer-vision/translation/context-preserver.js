/**
 * context-preserver.js
 * Maintains narrative and translation context across manga pages/panels
 * Ensures consistent terminology, character voices, and story continuity
 * 
 * @module core/computer-vision/translation/context-preserver
 */

import { IndexedDBStorage } from '../../../storage/indexeddb/schema.js';
import { ConfigManager } from '../../../shared/config-manager.js';
import { TextSanitizer } from '../../../shared/utils/text-sanitizer.js';

/**
 * Context Preservation System for Manga Translation
 * Tracks narrative elements across panels to maintain translation consistency
 */
class ContextPreserver {
  constructor() {
    this.db = new IndexedDBStorage('translation_context');
    this.config = new ConfigManager();
    this.sanitizer = new TextSanitizer();
    
    // Active session context (in-memory for performance)
    this.activeSession = {
      id: null,
      mangaId: null,
      chapterId: null,
      pageNumber: null,
      panelSequence: [],
      characterProfiles: new Map(),
      terminologyGlossary: new Map(),
      narrativeArc: {
        currentScene: null,
        previousScenes: [],
        emotionalTone: 'neutral',
        setting: null
      },
      translationMemory: new Map(), // term -> consistent translation
      recentBubbles: [], // Last N bubbles for immediate context
      maxRecentBubbles: 10
    };

    // Context weights for relevance scoring
    this.WEIGHTS = {
      RECENCY: 0.4,        // Recent bubbles matter most
      CHARACTER: 0.3,      // Same character continuity
      SCENE: 0.2,          // Same scene context
      GLOBAL: 0.1          // Global terminology
    };

    // Persistence settings
    this.settings = {
      maxStoredSessions: 50,
      maxTerminologyEntries: 1000,
      contextExpiryDays: 30,
      similarityThreshold: 0.85
    };
  }

  /**
   * Initialize a new reading session
   * @param {Object} metadata - Manga/chapter information
   * @returns {Promise<Object>} Session context
   */
  async initializeSession(metadata) {
    const {
      mangaId,
      mangaTitle,
      chapterId,
      chapterNumber,
      sourceUrl,
      totalPages = 0
    } = metadata;

    // Generate session ID
    const sessionId = this._generateSessionId(mangaId, chapterId);
    
    // Check for existing context from previous chapters
    const existingContext = await this._loadPersistentContext(mangaId);
    
    // Initialize new session
    this.activeSession = {
      id: sessionId,
      mangaId,
      mangaTitle,
      chapterId,
      chapterNumber,
      sourceUrl,
      totalPages,
      currentPage: 0,
      panelSequence: [],
      characterProfiles: new Map(existingContext?.characterProfiles || []),
      terminologyGlossary: new Map(existingContext?.terminologyGlossary || []),
      narrativeArc: {
        currentScene: null,
        previousScenes: [],
        emotionalTone: existingContext?.narrativeArc?.emotionalTone || 'neutral',
        setting: existingContext?.narrativeArc?.setting || null
      },
      translationMemory: new Map(existingContext?.translationMemory || []),
      recentBubbles: [],
      maxRecentBubbles: 10,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    };

    // Analyze chapter context if available
    if (metadata.chapterSummary || metadata.previousChapterContext) {
      this._seedNarrativeContext(metadata);
    }

    console.log(`[ContextPreserver] Session initialized: ${mangaTitle} Ch.${chapterNumber}`);
    return this.getCurrentContext();
  }

  /**
   * Process a new page/panel group
   * @param {Object} pageData - Page content and metadata
   * @returns {Promise<Object>} Enriched context for translators
   */
  async processPage(pageData) {
    const {
      pageNumber,
      panels,
      visualContext,
      ocrResults
    } = pageData;

    this.activeSession.currentPage = pageNumber;
    this.activeSession.lastAccessed = Date.now();

    // Extract visual narrative cues
    const sceneContext = this._analyzeVisualContext(visualContext);
    
    // Detect scene transitions
    const sceneChange = this._detectSceneTransition(sceneContext);
    if (sceneChange) {
      this._handleSceneTransition(sceneContext);
    }

    // Update panel sequence
    const panelContext = panels.map((panel, index) => ({
      id: `p${pageNumber}-${index}`,
      pageNumber,
      panelIndex: index,
      characters: panel.detectedCharacters || [],
      textBubbles: panel.bubbles || [],
      visualType: panel.type, // 'speech', 'thought', 'narration', 'sfx'
      sceneContext: sceneContext
    }));

    this.activeSession.panelSequence.push(...panelContext);

    // Build translation context for this page
    const pageContext = {
      session: this.getCurrentContext(),
      page: {
        number: pageNumber,
        scene: this.activeSession.narrativeArc.currentScene,
        emotionalTone: this.activeSession.narrativeArc.emotionalTone
      },
      relevantHistory: this._getRelevantHistory(pageNumber),
      characterContexts: this._getCharacterContextsForPage(panelContext),
      terminologyHints: this._getTerminologyHints(ocrResults),
      continuityMarkers: this._extractContinuityMarkers(ocrResults)
    };

    return pageContext;
  }

  /**
   * Process individual bubble with full context
   * @param {Object} bubble - Bubble data
   * @param {number} bubbleIndex - Index in current page
   * @returns {Object} Context-enriched bubble data
   */
  processBubble(bubble, bubbleIndex) {
    const {
      text,
      character,
      bubbleType,
      boundingBox,
      panelId
    } = bubble;

    // Sanitize text for analysis
    const cleanText = this.sanitizer.sanitize(text);

    // Build bubble-specific context
    const bubbleContext = {
      immediate: this._getImmediateContext(bubbleIndex),
      character: character ? this._getCharacterContext(character) : null,
      scene: this.activeSession.narrativeArc.currentScene,
      narrativeFlow: this._analyzeNarrativeFlow(cleanText, bubbleType),
      terminology: this._extractTerminology(cleanText),
      translationHints: this._generateTranslationHints(cleanText, bubble),
      continuity: this._checkContinuity(cleanText)
    };

    // Update recent bubbles buffer
    this._updateRecentBubbles({
      id: bubble.id || `b-${Date.now()}-${bubbleIndex}`,
      text: cleanText,
      translation: null, // Will be filled after translation
      character,
      bubbleType,
      panelId,
      timestamp: Date.now()
    });

    return bubbleContext;
  }

  /**
   * Store translation result and update context
   * @param {Object} original - Original text data
   * @param {Object} translation - Translation result
   * @param {Object} context - Context used for translation
   */
  async storeTranslation(original, translation, context) {
    const {
      text: originalText,
      character,
      bubbleType,
      panelId
    } = original;

    const {
      text: translatedText,
      engine,
      confidence
    } = translation;

    // Update translation memory for terminology consistency
    if (confidence > 0.8) {
      this._updateTranslationMemory(originalText, translatedText, context);
    }

    // Update character speech patterns
    if (character) {
      this._updateCharacterProfile(character, originalText, translatedText, bubbleType);
    }

    // Update recent bubbles with translation
    const recentIndex = this.activeSession.recentBubbles.findIndex(
      b => b.text === originalText
    );
    if (recentIndex !== -1) {
      this.activeSession.recentBubbles[recentIndex].translation = translatedText;
    }

    // Persist if significant terminology found
    const keyTerms = this._extractKeyTerms(originalText);
    if (keyTerms.length > 0) {
      await this._persistTerminology(keyTerms, translatedText, context);
    }

    // Auto-save session periodically
    if (this.activeSession.panelSequence.length % 10 === 0) {
      await this._saveSession();
    }
  }

  /**
   * Get relevant context for a specific translation task
   * @param {Object} query - Query parameters
   * @returns {Object} Prioritized context elements
   */
  getRelevantContext(query) {
    const {
      text,
      character,
      bubbleType,
      panelId,
      maxContextItems = 5
    } = query;

    const scoredContexts = [];

    // Score recent bubbles by relevance
    this.activeSession.recentBubbles.forEach((bubble, index) => {
      let score = 0;
      const recency = 1 - (index / this.activeSession.recentBubbles.length);
      
      // Recency weight
      score += recency * this.WEIGHTS.RECENCY;

      // Character match
      if (character && bubble.character === character) {
        score += this.WEIGHTS.CHARACTER;
      }

      // Similarity to current text (simple word overlap)
      const similarity = this._calculateSimilarity(text, bubble.text);
      score += similarity * 0.3;

      if (score > 0.3) {
        scoredContexts.push({
          type: 'recent',
          data: bubble,
          score,
          reason: character === bubble.character ? 'same-character' : 'recent-context'
        });
      }
    });

    // Add scene context
    if (this.activeSession.narrativeArc.currentScene) {
      scoredContexts.push({
        type: 'scene',
        data: this.activeSession.narrativeArc.currentScene,
        score: this.WEIGHTS.SCENE,
        reason: 'current-scene'
      });
    }

    // Add terminology hints
    const relevantTerms = this._findRelevantTerminology(text);
    relevantTerms.forEach(term => {
      scoredContexts.push({
        type: 'terminology',
        data: term,
        score: this.WEIGHTS.GLOBAL,
        reason: 'term-consistency'
      });
    });

    // Sort by score and return top N
    scoredContexts.sort((a, b) => b.score - a.score);
    const topContexts = scoredContexts.slice(0, maxContextItems);

    // Format for translator consumption
    return {
      immediateContext: topContexts
        .filter(c => c.type === 'recent')
        .map(c => c.data),
      characterVoice: topContexts.find(c => c.type === 'recent' && c.reason === 'same-character')?.data,
      sceneSetting: topContexts.find(c => c.type === 'scene')?.data,
      terminology: topContexts
        .filter(c => c.type === 'terminology')
        .map(c => c.data),
      narrativeTone: this.activeSession.narrativeArc.emotionalTone,
      suggestedStyle: this._suggestTranslationStyle(query, topContexts)
    };
  }

  /**
   * Ensure terminology consistency across translation
   * @param {string} term - Original term
   * @param {string} proposedTranslation - New translation proposal
   * @returns {Object} Consistency check result
   */
  checkTerminologyConsistency(term, proposedTranslation) {
    const normalizedTerm = this._normalizeTerm(term);
    const existing = this.activeSession.translationMemory.get(normalizedTerm);

    if (!existing) {
      return {
        consistent: true,
        action: 'add',
        existingTranslation: null,
        confidence: 1.0
      };
    }

    const similarity = this._calculateSimilarity(
      proposedTranslation.toLowerCase(),
      existing.toLowerCase()
    );

    if (similarity >= this.settings.similarityThreshold) {
      return {
        consistent: true,
        action: 'accept',
        existingTranslation: existing,
        confidence: similarity
      };
    }

    // Conflict detected - decide which to use
    const context = this._getTermContext(normalizedTerm);
    const shouldOverride = this._shouldOverrideTranslation(
      existing,
      proposedTranslation,
      context
    );

    return {
      consistent: false,
      action: shouldOverride ? 'override' : 'keep-existing',
      existingTranslation: existing,
      proposedTranslation: proposedTranslation,
      confidence: similarity,
      context: context,
      suggestion: shouldOverride ? 
        `Consider updating glossary: "${existing}" → "${proposedTranslation}"` :
        `Use existing: "${existing}" for consistency`
    };
  }

  /**
   * Analyze and update narrative arc
   * @param {Array<Object>} translatedBubbles - Completed translations
   * @returns {Object} Updated narrative state
   */
  updateNarrativeArc(translatedBubbles) {
    // Analyze emotional progression
    const tones = translatedBubbles.map(b => this._detectEmotionalTone(b));
    const dominantTone = this._getDominantTone(tones);

    // Detect plot points
    const plotIndicators = this._detectPlotIndicators(translatedBubbles);
    
    // Update arc
    if (plotIndicators.sceneChange) {
      this._archiveCurrentScene();
      this.activeSession.narrativeArc.currentScene = {
        id: `scene-${Date.now()}`,
        type: plotIndicators.newSceneType,
        startPage: this.activeSession.currentPage,
        emotionalTone: dominantTone,
        keyEvents: []
      };
    }

    // Add key events
    plotIndicators.keyEvents.forEach(event => {
      this.activeSession.narrativeArc.currentScene?.keyEvents.push({
        ...event,
        page: this.activeSession.currentPage,
        timestamp: Date.now()
      });
    });

    // Update emotional tone with smoothing
    this.activeSession.narrativeArc.emotionalTone = this._smoothToneTransition(
      this.activeSession.narrativeArc.emotionalTone,
      dominantTone
    );

    return this.activeSession.narrativeArc;
  }

  /**
   * Get character profile with voice consistency data
   * @param {string} characterId - Character identifier
   * @returns {Object} Character context
   */
  getCharacterProfile(characterId) {
    const profile = this.activeSession.characterProfiles.get(characterId);
    
    if (!profile) {
      return {
        known: false,
        speechPattern: null,
        formalityLevel: 'neutral',
        commonPhrases: [],
        translationNotes: []
      };
    }

    return {
      known: true,
      speechPattern: profile.speechPattern,
      formalityLevel: profile.formalityLevel,
      commonPhrases: profile.commonPhrases.slice(-5),
      typicalSentenceLength: profile.avgSentenceLength,
      favoriteExpressions: profile.expressions.slice(-3),
      translationNotes: profile.translationNotes,
      lastAppearance: profile.lastAppearance,
      appearanceCount: profile.appearances.size
    };
  }

  /**
   * Generate context summary for external translators (API fallback)
   * @returns {string} Serialized context
   */
  generateContextSummary() {
    const summary = {
      manga: this.activeSession.mangaTitle,
      chapter: this.activeSession.chapterNumber,
      page: this.activeSession.currentPage,
      scene: this.activeSession.narrativeArc.currentScene?.type || 'unknown',
      tone: this.activeSession.narrativeArc.emotionalTone,
      activeCharacters: Array.from(this.activeSession.characterProfiles.keys()),
      keyTerminology: Array.from(this.activeSession.terminologyGlossary.entries())
        .slice(-10)
        .map(([k, v]) => `${k}: ${v}`),
      recentDialogue: this.activeSession.recentBubbles
        .slice(-3)
        .map(b => `"${b.text.substring(0, 50)}${b.text.length > 50 ? '...' : ''}"`)
    };

    return JSON.stringify(summary, null, 2);
  }

  /**
   * Export context for cross-device sync
   * @returns {Object} Serializable context
   */
  async exportContext() {
    const exportData = {
      version: '1.0',
      mangaId: this.activeSession.mangaId,
      mangaTitle: this.activeSession.mangaTitle,
      exportedAt: Date.now(),
      characterProfiles: Array.from(this.activeSession.characterProfiles.entries()),
      terminologyGlossary: Array.from(this.activeSession.terminologyGlossary.entries()),
      translationMemory: Array.from(this.activeSession.translationMemory.entries()),
      narrativeArc: {
        emotionalTone: this.activeSession.narrativeArc.emotionalTone,
        setting: this.activeSession.narrativeArc.setting,
        recentScenes: this.activeSession.narrativeArc.previousScenes.slice(-5)
      }
    };

    // Compress for storage
    const compressed = await this._compressContext(exportData);
    return compressed;
  }

  /**
   * Import context from previous session
   * @param {Object} importedContext - Previously exported context
   */
  async importContext(importedContext) {
    try {
      const decompressed = await this._decompressContext(importedContext);
      
      // Merge with current session
      decompressed.characterProfiles?.forEach(([id, profile]) => {
        this.activeSession.characterProfiles.set(id, {
          ...profile,
          imported: true,
          lastMerged: Date.now()
        });
      });

      decompressed.terminologyGlossary?.forEach(([term, translation]) => {
        if (!this.activeSession.terminologyGlossary.has(term)) {
          this.activeSession.terminologyGlossary.set(term, translation);
        }
      });

      decompressed.translationMemory?.forEach(([term, translation]) => {
        this.activeSession.translationMemory.set(term, translation);
      });

      console.log('[ContextPreserver] Context imported successfully');
      return true;
    } catch (error) {
      console.error('[ContextPreserver] Import failed:', error);
      return false;
    }
  }

  /**
   * Clear current session and optionally persist
   * @param {boolean} persist - Whether to save before clearing
   */
  async endSession(persist = true) {
    if (persist) {
      await this._saveSession();
    }

    // Clear sensitive data
    this.activeSession = {
      id: null,
      mangaId: null,
      chapterId: null,
      panelSequence: [],
      characterProfiles: new Map(),
      terminologyGlossary: new Map(),
      narrativeArc: {
        currentScene: null,
        previousScenes: [],
        emotionalTone: 'neutral',
        setting: null
      },
      translationMemory: new Map(),
      recentBubbles: [],
      maxRecentBubbles: 10
    };

    console.log('[ContextPreserver] Session ended');
  }

  // ==================== PRIVATE METHODS ====================

  _generateSessionId(mangaId, chapterId) {
    return `ctx-${mangaId}-${chapterId}-${Date.now()}`;
  }

  async _loadPersistentContext(mangaId) {
    try {
      const stored = await this.db.get('manga_context', mangaId);
      if (stored && (Date.now() - stored.lastUpdated) < (this.settings.contextExpiryDays * 86400000)) {
        return stored.context;
      }
    } catch (e) {
      console.log('[ContextPreserver] No existing context found');
    }
    return null;
  }

  _seedNarrativeContext(metadata) {
    if (metadata.previousChapterContext) {
      this.activeSession.narrativeArc.previousScenes = 
        metadata.previousChapterContext.cliffhanger ? 
        [{ type: 'cliffhanger', summary: metadata.previousChapterContext.summary }] :
        [];
    }

    if (metadata.chapterSummary) {
      this.activeSession.narrativeArc.setting = metadata.chapterSummary.setting;
    }
  }

  _analyzeVisualContext(visualContext) {
    if (!visualContext) return null;

    return {
      setting: visualContext.detectedSetting, // 'indoor', 'outdoor', 'fantasy', etc.
      timeOfDay: visualContext.timeOfDay,
      charactersPresent: visualContext.detectedCharacters || [],
      moodIndicators: visualContext.colorMood,
      actionIntensity: visualContext.motionLevel,
      panelLayout: visualContext.layoutType // 'standard', 'splash', 'montage'
    };
  }

  _detectSceneTransition(newContext) {
    if (!this.activeSession.narrativeArc.currentScene) return true;
    
    const current = this.activeSession.narrativeArc.currentScene;
    
    // Check for setting change
    if (newContext?.setting && current.setting !== newContext.setting) {
      return true;
    }

    // Check for time jump
    if (newContext?.timeOfDay && current.timeOfDay !== newContext.timeOfDay) {
      // Only scene change if significant time passed
      if (['morning', 'night'].includes(current.timeOfDay) && 
          ['morning', 'night'].includes(newContext.timeOfDay)) {
        return true;
      }
    }

    // Check for dramatic mood shift
    if (newContext?.moodIndicators && current.mood) {
      const moodShift = this._calculateMoodShift(current.mood, newContext.moodIndicators);
      if (moodShift > 0.7) return true;
    }

    return false;
  }

  _handleSceneTransition(newContext) {
    // Archive current scene
    if (this.activeSession.narrativeArc.currentScene) {
      this.activeSession.narrativeArc.previousScenes.push({
        ...this.activeSession.narrativeArc.currentScene,
        endPage: this.activeSession.currentPage
      });
    }

    // Initialize new scene
    this.activeSession.narrativeArc.currentScene = {
      id: `scene-${Date.now()}`,
      startPage: this.activeSession.currentPage,
      setting: newContext?.setting,
      timeOfDay: newContext?.timeOfDay,
      mood: newContext?.moodIndicators,
      characters: newContext?.charactersPresent || []
    };

    // Clear recent bubbles (new scene context)
    this.activeSession.recentBubbles = [];
  }

  _getRelevantHistory(pageNumber) {
    // Get bubbles from previous pages that might be relevant
    const historyWindow = 3; // Pages
    
    return this.activeSession.panelSequence
      .filter(p => p.pageNumber >= pageNumber - historyWindow && p.pageNumber < pageNumber)
      .flatMap(p => p.textBubbles)
      .slice(-5); // Last 5 bubbles from previous pages
  }

  _getCharacterContextsForPage(panelContext) {
    const characterIds = new Set();
    panelContext.forEach(p => {
      p.characters.forEach(c => characterIds.add(c));
    });

    return Array.from(characterIds).map(id => ({
      id,
      profile: this.getCharacterProfile(id)
    }));
  }

  _getTerminologyHints(ocrResults) {
    if (!ocrResults) return [];

    const hints = [];
    ocrResults.forEach(result => {
      const terms = this._extractKeyTerms(result.text);
      terms.forEach(term => {
        const translation = this.activeSession.terminologyGlossary.get(term);
        if (translation) {
          hints.push({ term, translation, source: 'glossary' });
        }
      });
    });

    return hints;
  }

  _extractContinuityMarkers(ocrResults) {
    const markers = {
      toBeContinued: false,
      flashback: false,
      narrationShift: false,
      timeSkip: false
    };

    if (!ocrResults) return markers;

    const fullText = ocrResults.map(r => r.text).join(' ');

    // Detect "To be continued"
    if (/続く|つづく|to be continued|continued/i.test(fullText)) {
      markers.toBeContinued = true;
    }

    // Detect flashback indicators
    if (/回想|過去|flashback|memory/i.test(fullText)) {
      markers.flashback = true;
    }

    // Detect narration changes
    if (/ナレーション|narration| narration:/i.test(fullText)) {
      markers.narrationShift = true;
    }

    return markers;
  }

  _getImmediateContext(bubbleIndex) {
    // Get surrounding bubbles for flow continuity
    const recent = this.activeSession.recentBubbles;
    if (recent.length === 0) return null;

    return {
      previous: recent.slice(-2),
      currentSequence: bubbleIndex,
      conversationFlow: this._detectConversationFlow(recent)
    };
  }

  _getCharacterContext(characterId) {
    return this.getCharacterProfile(characterId);
  }

  _analyzeNarrativeFlow(text, bubbleType) {
    return {
      type: bubbleType,
      isQuestion: /\?$|？$/.test(text),
      isExclamation: /!$|！$/.test(text),
      isContinuation: /[…~〜]$/ .test(text),
      referencesPrevious: /それ|あれ|this|that|he|she/i.test(text),
      expectedResponse: this._predictExpectedResponse(text, bubbleType)
    };
  }

  _extractTerminology(text) {
    // Extract potential proper nouns, techniques, locations
    const terms = [];

    // Japanese proper noun patterns
    const properNounPattern = /[一-龠々〆ヵヶ]+{2,}/g;
    let match;
    while ((match = properNounPattern.exec(text)) !== null) {
      terms.push(match[0]);
    }

    // Katakana terms (often special terminology)
    const katakanaPattern = /[ァ-ヴー]+{2,}/g;
    while ((match = katakanaPattern.exec(text)) !== null) {
      terms.push(match[0]);
    }

    return terms.map(t => this._normalizeTerm(t));
  }

  _generateTranslationHints(text, bubble) {
    const hints = [];

    // Check for existing translation
    const existing = this.activeSession.translationMemory.get(
      this._normalizeTerm(text)
    );
    if (existing) {
      hints.push({
        type: 'exact-match',
        translation: existing,
        priority: 'high'
      });
    }

    // Character voice hints
    if (bubble.character) {
      const profile = this.activeSession.characterProfiles.get(bubble.character);
      if (profile) {
        hints.push({
          type: 'character-voice',
          formality: profile.formalityLevel,
          speechPattern: profile.speechPattern,
          priority: 'medium'
        });
      }
    }

    // Scene tone hint
    hints.push({
      type: 'tone',
      emotionalContext: this.activeSession.narrativeArc.emotionalTone,
      priority: 'low'
    });

    return hints;
  }

  _checkContinuity(text) {
    // Check if text continues from previous bubble
    const recent = this.activeSession.recentBubbles;
    if (recent.length === 0) return { continuesFrom: null, continuesTo: null };

    const lastBubble = recent[recent.length - 1];
    
    // Check for sentence continuation
    const lastEndedWithContinuation = /[…~〜－-]$/ .test(lastBubble.text);
    const thisStartsWithLower = /^[a-z]/.test(text);
    
    return {
      continuesFrom: lastEndedWithContinuation ? lastBubble.id : null,
      sentenceCompleted: !/[…~〜－-]$/ .test(text),
      topicContinuation: this._calculateSimilarity(text, lastBubble.text) > 0.3
    };
  }

  _updateRecentBubbles(bubbleData) {
    this.activeSession.recentBubbles.push(bubbleData);
    if (this.activeSession.recentBubbles.length > this.activeSession.maxRecentBubbles) {
      this.activeSession.recentBubbles.shift();
    }
  }

  _updateTranslationMemory(original, translated, context) {
    // Store key phrases for consistency
    const keyPhrases = this._extractKeyPhrases(original);
    
    keyPhrases.forEach(phrase => {
      const normalized = this._normalizeTerm(phrase);
      if (!this.activeSession.translationMemory.has(normalized)) {
        this.activeSession.translationMemory.set(normalized, translated);
      }
    });

    // Update terminology if character/technique name
    if (context.character && !this.activeSession.terminologyGlossary.has(original)) {
      this.activeSession.terminologyGlossary.set(original, {
        translation: translated,
        type: 'character-name',
        firstSeen: Date.now()
      });
    }
  }

  _updateCharacterProfile(character, original, translated, bubbleType) {
    let profile = this.activeSession.characterProfiles.get(character);
    
    if (!profile) {
      profile = {
        id: character,
        appearances: new Set(),
        speechPattern: null,
        formalityLevel: 'neutral',
        commonPhrases: [],
        expressions: [],
        avgSentenceLength: 0,
        translationNotes: [],
        createdAt: Date.now()
      };
    }

    // Update stats
    profile.appearances.add(this.activeSession.currentPage);
    profile.lastAppearance = Date.now();

    // Analyze speech pattern
    const analysis = this._analyzeSpeechPattern(original, translated, bubbleType);
    
    profile.commonPhrases.push({
      original: original.substring(0, 50),
      translated: translated.substring(0, 50),
      type: bubbleType
    });
    if (profile.commonPhrases.length > 20) {
      profile.commonPhrases.shift();
    }

    // Update formality based on Japanese verb forms or honorifics
    if (analysis.detectedFormality) {
      profile.formalityLevel = this._smoothFormality(
        profile.formalityLevel,
        analysis.detectedFormality
      );
    }

    // Track expressions (interjections, etc.)
    const expressions = this._extractExpressions(original);
    profile.expressions.push(...expressions);
    if (profile.expressions.length > 10) {
      profile.expressions = profile.expressions.slice(-10);
    }

    // Update average sentence length
    const wordCount = translated.split(/\s+/).length;
    profile.avgSentenceLength = (profile.avgSentenceLength * 0.8) + (wordCount * 0.2);

    this.activeSession.characterProfiles.set(character, profile);
  }

  _analyzeSpeechPattern(original, translated, bubbleType) {
    const analysis = {
      detectedFormality: null,
      speechStyle: 'neutral',
      emotionalMarkers: []
    };

    // Detect Japanese formality levels
    if (/です|ます|でございます/.test(original)) {
      analysis.detectedFormality = 'formal';
    } else if (/だ|るぞ|ぜ|よ$/.test(original)) {
      analysis.detectedFormality = 'casual';
    } else if (/である|でござる/.test(original)) {
      analysis.detectedFormality = 'archaic';
    }

    // Detect speech style
    if (bubbleType === 'thought') {
      analysis.speechStyle = 'internal-monologue';
    } else if (bubbleType === 'narration') {
      analysis.speechStyle = 'narrative';
    }

    return analysis;
  }

  _smoothFormality(current, detected) {
    const levels = { 'casual': 1, 'neutral': 2, 'formal': 3, 'archaic': 4 };
    const currentVal = levels[current] || 2;
    const detectedVal = levels[detected] || 2;
    
    // Move gradually toward detected level
    const newVal = Math.round(currentVal + (detectedVal - currentVal) * 0.3);
    return Object.keys(levels).find(k => levels[k] === newVal) || 'neutral';
  }

  _extractExpressions(text) {
    // Extract emotional interjections, sound effects, etc.
    const expressions = [];
    const patterns = [
      /[ハヒヘホフ]{2,}/, // Laughter patterns
      /[あー]+/, // Dragged sounds
      /[うお]っ/, // Exclamations
      /[ニコニコ|ムカムカ|イライラ]/ // Emotion mimetic words
    ];

    patterns.forEach(pattern => {
      const match = text.match(pattern);
      if (match) expressions.push(match[0]);
    });

    return expressions;
  }

  _extractKeyPhrases(text) {
    // Extract n-grams and key phrases for memory
    const phrases = [];
    const sentences = text.split(/[。！？.!?]/);
    
    sentences.forEach(sent => {
      const trimmed = sent.trim();
      if (trimmed.length > 5 && trimmed.length < 50) {
        phrases.push(trimmed);
      }
    });

    return phrases;
  }

  _findRelevantTerminology(text) {
    const relevant = [];
    const normalizedText = this._normalizeTerm(text);

    this.activeSession.terminologyGlossary.forEach((value, term) => {
      if (normalizedText.includes(term) || 
          this._calculateSimilarity(normalizedText, term) > 0.6) {
        relevant.push({
          term,
          translation: value.translation,
          type: value.type
        });
      }
    });

    return relevant;
  }

  async _persistTerminology(terms, translation, context) {
    for (const term of terms) {
      const existing = this.activeSession.terminologyGlossary.get(term);
      
      if (!existing) {
        this.activeSession.terminologyGlossary.set(term, {
          translation,
          type: this._categorizeTerm(term, context),
          frequency: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now()
        });
      } else {
        existing.frequency++;
        existing.lastSeen = Date.now();
      }
    }

    // Prune if too large
    if (this.activeSession.terminologyGlossary.size > this.settings.maxTerminologyEntries) {
      this._pruneTerminology();
    }
  }

  _categorizeTerm(term, context) {
    if (context.character) return 'character-speech';
    if (/[一-龠]{2,}/.test(term)) return 'proper-noun';
    if (/[ァ-ヴ]+/.test(term)) return 'foreign-term';
    return 'general';
  }

  _pruneTerminology() {
    // Remove least frequently used terms
    const entries = Array.from(this.activeSession.terminologyGlossary.entries());
    entries.sort((a, b) => (a[1].frequency || 0) - (b[1].frequency || 0));
    
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.2));
    toRemove.forEach(([term]) => {
      this.activeSession.terminologyGlossary.delete(term);
    });
  }

  _getTermContext(term) {
    const entry = this.activeSession.terminologyGlossary.get(term);
    return entry ? {
      frequency: entry.frequency,
      lastSeen: entry.lastSeen,
      type: entry.type
    } : null;
  }

  _shouldOverrideTranslation(existing, proposed, context) {
    // Logic to determine if new translation should replace old
    if (!context) return false;
    
    // Higher frequency terms are harder to change
    if (context.frequency > 10) return false;
    
    // Recent terms can be updated
    if (Date.now() - context.lastSeen < 3600000) return true; // 1 hour
    
    return false;
  }

  _detectEmotionalTone(bubble) {
    const text = bubble.translated || bubble.text;
    
    // Simple sentiment analysis
    const positive = /[happy|glad|joy|wonderful|great|awesome|嬉しい|楽しい|やった]/i;
    const negative = /[sad|angry|hate|terrible|awful|悲しい|怒|嫌|くそ]/i;
    const tense = /[must|need|hurry|danger|run|急げ|逃げろ|危ない]/i;
    
    if (tense.test(text)) return 'tense';
    if (negative.test(text)) return 'negative';
    if (positive.test(text)) return 'positive';
    
    return 'neutral';
  }

  _getDominantTone(tones) {
    const counts = tones.reduce((acc, tone) => {
      acc[tone] = (acc[tone] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
  }

  _smoothToneTransition(current, detected) {
    // Avoid jarring tone shifts
    const transitions = {
      'neutral': ['positive', 'negative', 'tense'],
      'positive': ['neutral', 'tense'],
      'negative': ['neutral', 'tense'],
      'tense': ['negative', 'neutral']
    };

    if (transitions[current]?.includes(detected)) {
      return detected;
    }
    
    // Gradual shift
    return current;
  }

  _detectPlotIndicators(bubbles) {
    const indicators = {
      sceneChange: false,
      newSceneType: null,
      keyEvents: []
    };

    const fullText = bubbles.map(b => b.text).join(' ');

    // Chapter/scene end markers
    if (/[終了|終わり|完|end|fin|to be continued]/i.test(fullText)) {
      indicators.sceneChange = true;
      indicators.newSceneType = 'transition';
    }

    // Flashback markers
    if (/[昔|過去|回想|flashback|memory of]/i.test(fullText)) {
      indicators.sceneChange = true;
      indicators.newSceneType = 'flashback';
    }

    // Revelation markers
    if (/[真相|事実|実は|truth is|actually|the fact is]/i.test(fullText)) {
      indicators.keyEvents.push({ type: 'revelation', importance: 'high' });
    }

    // Conflict markers
    if (/[戦い|勝負|対決|battle|fight|showdown]/i.test(fullText)) {
      indicators.keyEvents.push({ type: 'conflict', importance: 'high' });
    }

    return indicators;
  }

  _detectConversationFlow(recentBubbles) {
    if (recentBubbles.length < 2) return 'new';

    const speakers = recentBubbles.map(b => b.character);
    const uniqueSpeakers = [...new Set(speakers.filter(s => s))];

    if (uniqueSpeakers.length === 1) return 'monologue';
    if (uniqueSpeakers.length === 2) return 'dialogue';
    return 'multi-party';
  }

  _predictExpectedResponse(text, bubbleType) {
    if (bubbleType === 'question') return 'answer';
    if (/[…~〜－-]$/ .test(text)) return 'continuation';
    if (/[!！]$/.test(text)) return 'reaction';
    return 'any';
  }

  _suggestTranslationStyle(query, contexts) {
    const characterContext = contexts.find(c => c.type === 'recent' && c.reason === 'same-character');
    const sceneContext = contexts.find(c => c.type === 'scene');

    let style = {
      formality: 'neutral',
      tone: this.activeSession.narrativeArc.emotionalTone,
      preserveVoice: true
    };

    if (characterContext) {
      const profile = this.activeSession.characterProfiles.get(characterContext.data.character);
      if (profile) {
        style.formality = profile.formalityLevel;
        style.characterVoice = profile.speechPattern;
      }
    }

    if (sceneContext) {
      style.atmosphere = sceneContext.data.mood;
    }

    return style;
  }

  _calculateSimilarity(str1, str2) {
    // Simple Jaccard similarity for quick comparison
    const set1 = new Set(str1.toLowerCase().split(/\s+/));
    const set2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  _normalizeTerm(term) {
    return term.toLowerCase()
      .replace(/[[: punct:]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _calculateMoodShift(currentMood, newMood) {
    if (!currentMood || !newMood) return 0;
    
    const moodValues = {
      'calm': 1, 'neutral': 2, 'tense': 3, 
      'dramatic': 4, 'action': 5, 'climax': 6
    };
    
    const currentVal = moodValues[currentMood] || 2;
    const newVal = moodValues[newMood] || 2;
    
    return Math.abs(newVal - currentVal) / 6;
  }

  _archiveCurrentScene() {
    if (this.activeSession.narrativeArc.currentScene) {
      this.activeSession.narrativeArc.previousScenes.push({
        ...this.activeSession.narrativeArc.currentScene,
        archivedAt: Date.now()
      });
      
      // Keep only last 10 scenes
      if (this.activeSession.narrativeArc.previousScenes.length > 10) {
        this.activeSession.narrativeArc.previousScenes.shift();
      }
    }
  }

  async _saveSession() {
    const data = {
      id: this.activeSession.id,
      mangaId: this.activeSession.mangaId,
      chapterId: this.activeSession.chapterId,
      context: {
        characterProfiles: Array.from(this.activeSession.characterProfiles.entries()),
        terminologyGlossary: Array.from(this.activeSession.terminologyGlossary.entries()),
        translationMemory: Array.from(this.activeSession.translationMemory.entries()),
        narrativeArc: {
          emotionalTone: this.activeSession.narrativeArc.emotionalTone,
          setting: this.activeSession.narrativeArc.setting,
          previousScenes: this.activeSession.narrativeArc.previousScenes
        }
      },
      lastUpdated: Date.now()
    };

    try {
      await this.db.put('manga_context', data);
      console.log('[ContextPreserver] Session saved');
    } catch (error) {
      console.error('[ContextPreserver] Save failed:', error);
    }
  }

  async _compressContext(data) {
    // Simple compression - in production, use proper compression library
    return {
      compressed: true,
      data: JSON.stringify(data),
      size: JSON.stringify(data).length
    };
  }

  async _decompressContext(compressed) {
    if (!compressed.compressed) return compressed;
    return JSON.parse(compressed.data);
  }

  getCurrentContext() {
    return {
      id: this.activeSession.id,
      manga: this.activeSession.mangaTitle,
      chapter: this.activeSession.chapterNumber,
      page: this.activeSession.currentPage,
      characters: Array.from(this.activeSession.characterProfiles.keys()),
      scene: this.activeSession.narrativeArc.currentScene,
      tone: this.activeSession.narrativeArc.emotionalTone,
      recentBubblesCount: this.activeSession.recentBubbles.length,
      terminologyCount: this.activeSession.terminologyGlossary.size
    };
  }
}

// Export singleton
export const contextPreserver = new ContextPreserver();
export default ContextPreserver;