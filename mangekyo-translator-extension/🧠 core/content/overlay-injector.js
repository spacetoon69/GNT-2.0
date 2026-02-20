/**
 * Overlay Injector - UI Presentation Layer
 * Injects translated text overlays onto manga images with smart positioning
 * Handles rendering, styling, animations, and user interactions
 */

import { CONFIG } from '../shared/constants.js';
import { DOMHelpers } from '../shared/utils/dom-helpers.js';
import { TextSanitizer } from '../shared/utils/text-sanitizer.js';
import { PerformanceMonitor } from '../shared/utils/performance-monitor.js';

class OverlayInjector {
  constructor(config = {}) {
    this.config = {
      // Positioning
      smartPositioning: true,
      avoidOverlap: true,
      padding: 8,
      minFontSize: 10,
      maxFontSize: 32,
      defaultFontSize: 14,
      
      // Styling
      theme: 'default', // default, dark, minimal, manga-style
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      textColor: '#1a1a1a',
      borderRadius: 8,
      borderWidth: 2,
      borderColor: '#333',
      shadowBlur: 10,
      shadowColor: 'rgba(0, 0, 0, 0.3)',
      
      // Animation
      animateIn: true,
      animationDuration: 300,
      hoverEffects: true,
      
      // Behavior
      clickToToggle: true,
      showOriginalOnHover: true,
      draggable: false,
      resizable: false,
      persistent: true,
      
      // Font matching
      matchOriginalFont: true,
      fontFamily: "'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC', sans-serif",
      
      ...config
    };

    this.sanitizer = new TextSanitizer();
    this.performanceMonitor = new PerformanceMonitor('overlay-injector');
    
    // State
    this.activeOverlays = new Map(); // imageElement -> overlayData[]
    this.overlayCounter = 0;
    this.stylesInjected = false;
    
    // Theme definitions
    this.themes = this.initThemes();
  }

  /**
   * Initialize theme presets
   */
  initThemes() {
    return {
      default: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        textColor: '#1a1a1a',
        borderColor: '#333',
        shadowColor: 'rgba(0, 0, 0, 0.3)'
      },
      dark: {
        backgroundColor: 'rgba(30, 30, 30, 0.95)',
        textColor: '#f0f0f0',
        borderColor: '#555',
        shadowColor: 'rgba(0, 0, 0, 0.5)'
      },
      minimal: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        textColor: '#000',
        borderColor: 'transparent',
        shadowColor: 'rgba(0, 0, 0, 0.1)',
        borderRadius: 4
      },
      'manga-style': {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        textColor: '#000',
        borderColor: '#000',
        borderWidth: 3,
        borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
        fontFamily: "'Comic Sans MS', 'Chalkboard SE', sans-serif"
      }
    };
  }

  /**
   * Main injection entry point
   * @param {HTMLElement} imageElement - Target manga image
   * @param {Array} translations - Translation objects from text-extractor
   * @returns {Promise<Array>} Created overlay elements
   */
  async inject(imageElement, translations) {
    const perfMark = this.performanceMonitor.start('inject');
    
    try {
      // Ensure styles are injected
      this.injectGlobalStyles();
      
      // Get or create container for this image
      const container = this.getOrCreateContainer(imageElement);
      
      // Clear existing overlays for this image if any
      this.clearImageOverlays(imageElement);
      
      // Calculate positions
      const positions = this.calculatePositions(imageElement, translations);
      
      // Create overlays
      const overlays = [];
      for (let i = 0; i < translations.length; i++) {
        const translation = translations[i];
        const position = positions[i];
        
        const overlay = await this.createOverlay(
          imageElement, 
          translation, 
          position,
          container
        );
        
        overlays.push(overlay);
      }

      // Store reference
      this.activeOverlays.set(imageElement, {
        overlays,
        container,
        translations,
        timestamp: Date.now()
      });

      // Animate in
      if (this.config.animateIn) {
        this.animateOverlaysIn(overlays);
      }

      this.performanceMonitor.end(perfMark);
      return overlays;

    } catch (error) {
      this.performanceMonitor.end(perfMark, { error: true });
      console.error('[OverlayInjector] Injection failed:', error);
      throw error;
    }
  }

  /**
   * Get or create overlay container for an image
   */
  getOrCreateContainer(imageElement) {
    // Check if already has container
    let container = imageElement.parentElement.querySelector('.manga-overlay-container');
    
    if (!container) {
      // Ensure image has positioned parent
      const parent = imageElement.parentElement;
      const parentStyle = window.getComputedStyle(parent);
      
      if (parentStyle.position === 'static') {
        parent.style.position = 'relative';
      }
      
      // Create container
      container = document.createElement('div');
      container.className = 'manga-overlay-container';
      container.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483646;
        overflow: visible;
      `;
      
      // Insert after image
      if (imageElement.nextSibling) {
        parent.insertBefore(container, imageElement.nextSibling);
      } else {
        parent.appendChild(container);
      }
    }
    
    return container;
  }

  /**
   * Calculate optimal positions for all overlays
   */
  calculatePositions(imageElement, translations) {
    const imgRect = imageElement.getBoundingClientRect();
    const positions = [];
    const placedBoxes = [];
    
    // Sort by reading order (top-to-bottom, then left-to-right or RTL)
    const sorted = [...translations].sort((a, b) => {
      const rowDiff = a.boundingBox.y - b.boundingBox.y;
      if (Math.abs(rowDiff) > 20) return rowDiff;
      return this.config.readingDirection === 'rtl' 
        ? b.boundingBox.x - a.boundingBox.x 
        : a.boundingBox.x - b.boundingBox.x;
    });

    for (const translation of sorted) {
      const box = translation.boundingBox;
      
      // Base position relative to image
      let pos = {
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        originalBox: box
      };

      // Smart positioning to avoid overlap
      if (this.config.smartPositioning && this.config.avoidOverlap) {
        pos = this.adjustForOverlap(pos, placedBoxes, imgRect);
      }

      // Ensure within image bounds
      pos = this.constrainToImage(pos, imgRect);
      
      placedBoxes.push(pos);
      positions.push(pos);
    }

    return positions;
  }

  /**
   * Adjust position to avoid overlapping other overlays
   */
  adjustForOverlap(pos, placedBoxes, imgRect) {
    const padding = this.config.padding;
    let adjusted = { ...pos };
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      let hasOverlap = false;
      
      for (const placed of placedBoxes) {
        if (this.boxesOverlap(adjusted, placed, padding)) {
          hasOverlap = true;
          
          // Try shifting down first
          adjusted.top = placed.top + placed.height + padding;
          
          // If goes off bottom, try shifting right/left
          if (adjusted.top + adjusted.height > imgRect.height) {
            adjusted.top = pos.top;
            
            if (this.config.readingDirection === 'rtl') {
              adjusted.left = placed.left - adjusted.width - padding;
            } else {
              adjusted.left = placed.left + placed.width + padding;
            }
          }
          
          break;
        }
      }

      if (!hasOverlap) break;
      attempts++;
    }

    return adjusted;
  }

  /**
   * Check if two boxes overlap
   */
  boxesOverlap(a, b, padding = 0) {
    return !(a.left + a.width + padding < b.left - padding ||
             b.left + b.width + padding < a.left - padding ||
             a.top + a.height + padding < b.top - padding ||
             b.top + b.height + padding < a.top - padding);
  }

  /**
   * Constrain position to image bounds
   */
  constrainToImage(pos, imgRect) {
    const margin = 5;
    
    return {
      ...pos,
      left: Math.max(margin, Math.min(pos.left, imgRect.width - pos.width - margin)),
      top: Math.max(margin, Math.min(pos.top, imgRect.height - pos.height - margin)),
      width: Math.min(pos.width, imgRect.width - margin * 2),
      height: Math.min(pos.height, imgRect.height - margin * 2)
    };
  }

  /**
   * Create individual overlay element
   */
  async createOverlay(imageElement, translation, position, container) {
    const id = `overlay_${++this.overlayCounter}_${Date.now()}`;
    const theme = this.themes[this.config.theme] || this.themes.default;
    
    // Create wrapper
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'manga-translation-overlay';
    overlay.dataset.translationId = translation.id;
    overlay.dataset.originalText = translation.originalText;
    overlay.dataset.translatedText = translation.text;
    
    // Calculate optimal font size
    const fontSize = this.calculateFontSize(translation, position);
    
    // Apply styles
    overlay.style.cssText = this.buildOverlayStyles(position, fontSize, theme);
    
    // Create content
    const content = this.createOverlayContent(translation, fontSize);
    overlay.appendChild(content);
    
    // Add tail for speech bubbles
    if (translation.bubbleType === 'speech' && this.config.theme !== 'minimal') {
      const tail = this.createBubbleTail(translation, position);
      if (tail) overlay.appendChild(tail);
    }
    
    // Add interactions
    this.addInteractions(overlay, translation);
    
    // Add to container
    container.appendChild(overlay);
    
    // Fine-tune size after render
    await this.adjustToContent(overlay, position);
    
    return {
      element: overlay,
      id,
      translation,
      position,
      fontSize
    };
  }

  /**
   * Build CSS styles for overlay
   */
  buildOverlayStyles(position, fontSize, theme) {
    const baseStyles = `
      position: absolute;
      left: ${position.left}px;
      top: ${position.top}px;
      min-width: ${Math.min(position.width, 50)}px;
      max-width: ${position.width * 1.5}px;
      min-height: ${Math.min(position.height, 30)}px;
      padding: ${this.config.padding}px;
      background: ${theme.backgroundColor || this.config.backgroundColor};
      color: ${theme.textColor || this.config.textColor};
      border-radius: ${theme.borderRadius || this.config.borderRadius};
      border: ${theme.borderWidth || this.config.borderWidth}px solid ${theme.borderColor || this.config.borderColor};
      box-shadow: 0 4px ${this.config.shadowBlur}px ${theme.shadowColor || this.config.shadowColor};
      font-family: ${theme.fontFamily || this.config.fontFamily};
      font-size: ${fontSize}px;
      line-height: 1.4;
      text-align: center;
      word-wrap: break-word;
      overflow-wrap: break-word;
      hyphens: auto;
      pointer-events: auto;
      cursor: pointer;
      opacity: 0;
      transform: scale(0.9);
      transition: all 0.2s ease;
      z-index: 2147483647;
    `;
    
    // Vertical text support
    if (translation.isVertical) {
      return baseStyles + `
        writing-mode: vertical-rl;
        text-orientation: mixed;
      `;
    }
    
    return baseStyles;
  }

  /**
   * Calculate optimal font size to fit bubble
   */
  calculateFontSize(translation, position) {
    if (!this.config.matchOriginalFont) {
      return this.config.defaultFontSize;
    }
    
    // Base calculation on bubble size and text length
    const area = position.width * position.height;
    const charCount = translation.text.length;
    const isCJK = /[\u4E00-\u9FAF\u3040-\u309F\u30A0-\u30FF]/.test(translation.text);
    
    // CJK characters need more space
    const charWidth = isCJK ? 1.5 : 0.6;
    const estimatedCharsPerLine = position.width / (translation.originalFontSize || 14);
    const lines = Math.ceil(charCount / Math.max(estimatedCharsPerLine, 1));
    
    // Calculate font size to fill ~70% of bubble area
    let fontSize = Math.sqrt((area * 0.7) / (charCount * charWidth * 1.4));
    
    // Constrain to limits
    fontSize = Math.max(this.config.minFontSize, 
               Math.min(this.config.maxFontSize, fontSize));
    
    // Adjust for very long text
    if (lines > 3) {
      fontSize *= 0.9;
    }
    
    return Math.round(fontSize);
  }

  /**
   * Create overlay content structure
   */
  createOverlayContent(translation, fontSize) {
    const wrapper = document.createElement('div');
    wrapper.className = 'overlay-content';
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
    `;
    
    // Translated text
    const textEl = document.createElement('span');
    textEl.className = 'translated-text';
    textEl.textContent = translation.text;
    textEl.style.cssText = `
      font-weight: ${translation.isBold ? 'bold' : 'normal'};
      font-style: ${translation.isItalic ? 'italic' : 'normal'};
    `;
    wrapper.appendChild(textEl);
    
    // Original text (hidden by default, shown on hover if enabled)
    if (this.config.showOriginalOnHover) {
      const originalEl = document.createElement('span');
      originalEl.className = 'original-text';
      originalEl.textContent = translation.originalText;
      originalEl.style.cssText = `
        display: none;
        font-size: ${Math.max(fontSize * 0.8, 10)}px;
        color: #666;
        margin-top: 4px;
        font-style: italic;
        border-top: 1px solid rgba(0,0,0,0.1);
        padding-top: 4px;
      `;
      wrapper.appendChild(originalEl);
    }
    
    // SFX indicator
    if (translation.isSFX) {
      const sfxBadge = document.createElement('span');
      sfxBadge.className = 'sfx-badge';
      sfxBadge.textContent = 'SFX';
      sfxBadge.style.cssText = `
        position: absolute;
        top: -8px;
        right: -8px;
        background: #ff6b6b;
        color: white;
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 10px;
        font-weight: bold;
      `;
      wrapper.appendChild(sfxBadge);
    }
    
    return wrapper;
  }

  /**
   * Create tail for speech bubble pointing to character
   */
  createBubbleTail(translation, position) {
    if (!translation.tailDirection) return null;
    
    const tail = document.createElement('div');
    tail.className = 'bubble-tail';
    
    const direction = translation.tailDirection; // 'top', 'bottom', 'left', 'right'
    const size = 12;
    
    let borderStyle = '';
    let positionStyle = '';
    
    switch(direction) {
      case 'bottom':
        borderStyle = `${size}px solid transparent; border-top-color: ${this.config.borderColor};`;
        positionStyle = `bottom: -${size * 2}px; left: 50%; transform: translateX(-50%);`;
        break;
      case 'top':
        borderStyle = `${size}px solid transparent; border-bottom-color: ${this.config.borderColor};`;
        positionStyle = `top: -${size * 2}px; left: 50%; transform: translateX(-50%);`;
        break;
      case 'left':
        borderStyle = `${size}px solid transparent; border-right-color: ${this.config.borderColor};`;
        positionStyle = `left: -${size * 2}px; top: 50%; transform: translateY(-50%);`;
        break;
      case 'right':
        borderStyle = `${size}px solid transparent; border-left-color: ${this.config.borderColor};`;
        positionStyle = `right: -${size * 2}px; top: 50%; transform: translateY(-50%);`;
        break;
    }
    
    tail.style.cssText = `
      position: absolute;
      width: 0;
      height: 0;
      ${positionStyle}
      border: ${borderStyle}
      filter: drop-shadow(0 2px 2px ${this.config.shadowColor});
    `;
    
    return tail;
  }

  /**
   * Adjust overlay size after content render
   */
  async adjustToContent(overlay, position) {
    // Wait for render
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    const content = overlay.querySelector('.overlay-content');
    const rect = content.getBoundingClientRect();
    
    // Ensure minimum dimensions but allow expansion if needed
    const minWidth = Math.min(position.width, 50);
    const minHeight = Math.min(position.height, 30);
    
    if (rect.width > position.width * 1.2 || rect.height > position.height * 1.2) {
      // Content too large, allow expansion but mark as overflow
      overlay.dataset.overflow = 'true';
      overlay.style.maxWidth = `${position.width * 1.5}px`;
    }
  }

  /**
   * Add interaction handlers
   */
  addInteractions(overlay, translation) {
    // Click to toggle original/translated
    if (this.config.clickToToggle) {
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleTranslation(overlay);
      });
    }
    
    // Hover effects
    if (this.config.hoverEffects) {
      overlay.addEventListener('mouseenter', () => {
        overlay.style.transform = 'scale(1.02)';
        overlay.style.zIndex = '2147483647';
        
        if (this.config.showOriginalOnHover) {
          const original = overlay.querySelector('.original-text');
          const translated = overlay.querySelector('.translated-text');
          if (original && translated) {
            original.style.display = 'block';
            translated.style.opacity = '0.7';
          }
        }
      });
      
      overlay.addEventListener('mouseleave', () => {
        overlay.style.transform = 'scale(1)';
        overlay.style.zIndex = '2147483646';
        
        if (this.config.showOriginalOnHover) {
          const original = overlay.querySelector('.original-text');
          const translated = overlay.querySelector('.translated-text');
          if (original && translated) {
            original.style.display = 'none';
            translated.style.opacity = '1';
          }
        }
      });
    }
    
    // Context menu
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e, overlay, translation);
    });
    
    // Draggable
    if (this.config.draggable) {
      this.makeDraggable(overlay);
    }
    
    // Resizable
    if (this.config.resizable) {
      this.makeResizable(overlay);
    }
  }

  /**
   * Toggle between translated and original text
   */
  toggleTranslation(overlay) {
    const translated = overlay.querySelector('.translated-text');
    const original = overlay.querySelector('.original-text');
    
    if (!original) return;
    
    const isShowingOriginal = translated.style.display === 'none';
    
    if (isShowingOriginal) {
      translated.style.display = 'block';
      original.style.display = 'none';
      overlay.dataset.mode = 'translated';
    } else {
      translated.style.display = 'none';
      original.style.display = 'block';
      overlay.dataset.mode = 'original';
    }
  }

  /**
   * Show context menu for overlay
   */
  showContextMenu(event, overlay, translation) {
    // Remove existing menu
    document.querySelector('.manga-overlay-context-menu')?.remove();
    
    const menu = document.createElement('div');
    menu.className = 'manga-overlay-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${event.clientX}px;
      top: ${event.clientY}px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      padding: 4px 0;
      z-index: 2147483647;
      min-width: 150px;
    `;
    
    const items = [
      { label: 'Copy Translation', action: () => navigator.clipboard.writeText(translation.text) },
      { label: 'Copy Original', action: () => navigator.clipboard.writeText(translation.originalText) },
      { label: 'Report Issue', action: () => this.reportIssue(translation) },
      { label: 'Hide Overlay', action: () => overlay.remove() },
      { label: 'Reset Position', action: () => this.resetPosition(overlay), disabled: !this.config.draggable }
    ];
    
    items.forEach(item => {
      if (item.disabled) return;
      
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.style.cssText = `
        display: block;
        width: 100%;
        padding: 8px 16px;
        border: none;
        background: none;
        text-align: left;
        cursor: pointer;
        font-size: 14px;
      `;
      btn.addEventListener('mouseenter', () => btn.style.background = '#f0f0f0');
      btn.addEventListener('mouseleave', () => btn.style.background = 'none');
      btn.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
      menu.appendChild(btn);
    });
    
    document.body.appendChild(menu);
    
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  }

  /**
   * Make overlay draggable
   */
  makeDraggable(overlay) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    
    overlay.addEventListener('mousedown', (e) => {
      if (e.target.closest('.resize-handle')) return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = parseFloat(overlay.style.left);
      initialTop = parseFloat(overlay.style.top);
      overlay.style.cursor = 'grabbing';
      overlay.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      overlay.style.left = `${initialLeft + dx}px`;
      overlay.style.top = `${initialTop + dy}px`;
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        overlay.style.cursor = 'pointer';
        overlay.style.userSelect = '';
      }
    });
  }

  /**
   * Make overlay resizable
   */
  makeResizable(overlay) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.style.cssText = `
      position: absolute;
      bottom: 0;
      right: 0;
      width: 15px;
      height: 15px;
      cursor: se-resize;
      background: linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.3) 50%);
      border-radius: 0 0 0 4px;
    `;
    
    overlay.appendChild(handle);
    
    let isResizing = false;
    let startX, startY, initialWidth, initialHeight;
    
    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      initialWidth = overlay.offsetWidth;
      initialHeight = overlay.offsetHeight;
      e.stopPropagation();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const width = initialWidth + (e.clientX - startX);
      const height = initialHeight + (e.clientY - startY);
      
      overlay.style.width = `${Math.max(50, width)}px`;
      overlay.style.height = `${Math.max(30, height)}px`;
    });
    
    document.addEventListener('mouseup', () => {
      isResizing = false;
    });
  }

  /**
   * Animate overlays appearing
   */
  animateOverlaysIn(overlays) {
    overlays.forEach((overlayData, index) => {
      const el = overlayData.element;
      
      setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'scale(1)';
      }, index * 50); // Stagger animations
    });
  }

  /**
   * Clear overlays for specific image
   */
  clearImageOverlays(imageElement) {
    const existing = this.activeOverlays.get(imageElement);
    if (existing) {
      existing.overlays.forEach(o => o.element.remove());
      this.activeOverlays.delete(imageElement);
    }
  }

  /**
   * Clear all overlays
   */
  clearAll() {
    this.activeOverlays.forEach((data, imageElement) => {
      data.overlays.forEach(o => o.element.remove());
      data.container?.remove();
    });
    this.activeOverlays.clear();
  }

  /**
   * Update theme
   */
  setTheme(themeName) {
    if (this.themes[themeName]) {
      this.config.theme = themeName;
      this.refreshAllOverlays();
    }
  }

  /**
   * Refresh all existing overlays with new styles
   */
  refreshAllOverlays() {
    const theme = this.themes[this.config.theme] || this.themes.default;
    
    this.activeOverlays.forEach(data => {
      data.overlays.forEach(overlayData => {
        const el = overlayData.element;
        el.style.background = theme.backgroundColor || this.config.backgroundColor;
        el.style.color = theme.textColor || this.config.textColor;
        el.style.borderColor = theme.borderColor || this.config.borderColor;
        el.style.borderRadius = theme.borderRadius || this.config.borderRadius;
        el.style.fontFamily = theme.fontFamily || this.config.fontFamily;
      });
    });
  }

  /**
   * Inject global styles
   */
  injectGlobalStyles() {
    if (this.stylesInjected) return;
    
    const style = document.createElement('style');
    style.id = 'manga-overlay-styles';
    style.textContent = `
      .manga-overlay-container {
        font-family: ${this.config.fontFamily};
      }
      
      .manga-translation-overlay:hover {
        filter: brightness(1.05);
      }
      
      .manga-translation-overlay[data-mode="original"] {
        background: rgba(240, 240, 240, 0.95) !important;
        border-style: dashed !important;
      }
      
      @keyframes overlayPulse {
        0%, 100% { box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        50% { box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
      }
      
      .manga-translation-overlay.highlight {
        animation: overlayPulse 1s ease infinite;
      }
    `;
    
    document.head.appendChild(style);
    this.stylesInjected = true;
  }

  /**
   * Get all active overlays
   */
  getActiveOverlays() {
    const result = [];
    this.activeOverlays.forEach((data, imageElement) => {
      result.push({
        imageElement,
        overlays: data.overlays,
        container: data.container
      });
    });
    return result;
  }

  /**
   * Report translation issue
   */
  reportIssue(translation) {
    chrome.runtime.sendMessage({
      type: 'REPORT_TRANSLATION',
      payload: {
        translationId: translation.id,
        originalText: translation.originalText,
        translatedText: translation.text,
        url: window.location.href,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Reset overlay position
   */
  resetPosition(overlay) {
    const data = this.activeOverlays.get(overlay.closest('.manga-overlay-container')?.previousElementSibling);
    if (!data) return;
    
    const overlayData = data.overlays.find(o => o.element === overlay);
    if (overlayData) {
      overlay.style.left = `${overlayData.position.left}px`;
      overlay.style.top = `${overlayData.position.top}px`;
      overlay.style.width = `${overlayData.position.width}px`;
      overlay.style.height = `${overlayData.position.height}px`;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.refreshAllOverlays();
  }

  /**
   * Destroy injector and cleanup
   */
  destroy() {
    this.clearAll();
    document.getElementById('manga-overlay-styles')?.remove();
    this.stylesInjected = false;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OverlayInjector;
}

export default OverlayInjector;