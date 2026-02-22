// ui/options/components/language-selector.js

/**
 * Language Selector Component
 * Specialized selector for manga translation languages with visual indicators
 * for text direction, vertical support, and translation availability.
 */

import { SUPPORTED_LANGUAGES, LANGUAGE_METADATA } from '../../../core/shared/constants.js';
import { i18n } from '../../../core/shared/i18n/i18n-manager.js';

export class LanguageSelector extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open', delegatesFocus: true });
    this._selected = [];
    this._mode = 'single'; // 'single' | 'multiple' | 'pair' (source/target)
    this._type = 'source'; // 'source' | 'target'
    this._searchable = true;
    this._disabled = false;
  }

  static get observedAttributes() {
    return ['mode', 'type', 'value', 'disabled', 'searchable'];
  }

  get value() {
    if (this._mode === 'multiple') {
      return [...this._selected];
    }
    return this._selected[0] || null;
  }

  set value(val) {
    if (this._mode === 'multiple') {
      this._selected = Array.isArray(val) ? [...val] : val ? [val] : [];
    } else {
      this._selected = val ? [val] : [];
    }
    this._renderSelection();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    
    switch(name) {
      case 'mode':
        this._mode = newVal || 'single';
        break;
      case 'type':
        this._type = newVal || 'source';
        break;
      case 'searchable':
        this._searchable = newVal !== 'false';
        break;
      case 'disabled':
        this._disabled = newVal !== null;
        this._updateDisabledState();
        break;
      case 'value':
        this.value = newVal ? JSON.parse(newVal) : null;
        break;
    }
  }

  connectedCallback() {
    this._render();
    this._attachEventListeners();
    
    // Announce to screen readers
    this._announceToScreenReader('Language selector loaded');
  }

  disconnectedCallback() {
    this._removeEventListeners();
  }

  _render() {
    const styles = `
      :host {
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --primary-color: #3b82f6;
        --primary-hover: #2563eb;
        --bg-primary: #ffffff;
        --bg-secondary: #f3f4f6;
        --bg-tertiary: #e5e7eb;
        --text-primary: #111827;
        --text-secondary: #6b7280;
        --border-color: #d1d5db;
        --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        --radius-sm: 6px;
        --radius-md: 8px;
        --radius-lg: 12px;
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --bg-primary: #1f2937;
          --bg-secondary: #111827;
          --bg-tertiary: #374151;
          --text-primary: #f9fafb;
          --text-secondary: #9ca3af;
          --border-color: #4b5563;
        }
      }

      .language-selector {
        position: relative;
        width: 100%;
      }

      .trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: var(--bg-primary);
        border: 2px solid var(--border-color);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all 0.2s ease;
        min-height: 44px;
      }

      .trigger:hover:not(:disabled) {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .trigger:focus-visible {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
      }

      .trigger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--bg-secondary);
      }

      .trigger-content {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        overflow: hidden;
      }

      .flag {
        font-size: 20px;
        line-height: 1;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));
      }

      .language-info {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .language-name {
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .language-meta {
        font-size: 12px;
        color: var(--text-secondary);
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .badge--vertical {
        background: #dbeafe;
        color: #1e40af;
      }

      .badge--rtl {
        background: #fce7f3;
        color: #be185d;
      }

      .badge--manga {
        background: #fef3c7;
        color: #92400e;
      }

      .chevron {
        width: 20px;
        height: 20px;
        color: var(--text-secondary);
        transition: transform 0.2s ease;
      }

      .chevron.open {
        transform: rotate(180deg);
      }

      .dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        z-index: 1000;
        max-height: 400px;
        display: flex;
        flex-direction: column;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: all 0.2s ease;
      }

      .dropdown.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .search-box {
        padding: 12px;
        border-bottom: 1px solid var(--border-color);
      }

      .search-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
        box-sizing: border-box;
      }

      .search-input:focus {
        outline: none;
        border-color: var(--primary-color);
      }

      .language-list {
        overflow-y: auto;
        max-height: 300px;
        padding: 4px;
      }

      .language-group {
        margin-bottom: 8px;
      }

      .group-label {
        padding: 8px 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        position: sticky;
        top: 0;
        background: var(--bg-primary);
        z-index: 10;
      }

      .language-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.15s ease;
        margin: 2px 0;
      }

      .language-option:hover {
        background: var(--bg-secondary);
      }

      .language-option:focus-visible {
        outline: none;
        background: var(--bg-secondary);
        box-shadow: inset 0 0 0 2px var(--primary-color);
      }

      .language-option.selected {
        background: rgba(59, 130, 246, 0.1);
        border-left: 3px solid var(--primary-color);
      }

      .language-option.disabled {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: none;
      }

      .checkbox {
        width: 18px;
        height: 18px;
        border: 2px solid var(--border-color);
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }

      .language-option.selected .checkbox {
        background: var(--primary-color);
        border-color: var(--primary-color);
      }

      .checkmark {
        width: 12px;
        height: 12px;
        color: white;
        opacity: 0;
        transform: scale(0.8);
        transition: all 0.15s ease;
      }

      .language-option.selected .checkmark {
        opacity: 1;
        transform: scale(1);
      }

      .radio {
        width: 18px;
        height: 18px;
        border: 2px solid var(--border-color);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }

      .language-option.selected .radio {
        border-color: var(--primary-color);
      }

      .radio-dot {
        width: 10px;
        height: 10px;
        background: var(--primary-color);
        border-radius: 50%;
        opacity: 0;
        transform: scale(0);
        transition: all 0.15s ease;
      }

      .language-option.selected .radio-dot {
        opacity: 1;
        transform: scale(1);
      }

      .empty-state {
        padding: 24px;
        text-align: center;
        color: var(--text-secondary);
      }

      .empty-state-icon {
        font-size: 32px;
        margin-bottom: 8px;
      }

      .selection-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }

      .selection-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        font-size: 13px;
        color: var(--text-primary);
        animation: tagIn 0.2s ease;
      }

      @keyframes tagIn {
        from {
          opacity: 0;
          transform: scale(0.9);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .remove-tag {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: var(--text-secondary);
        transition: all 0.15s ease;
      }

      .remove-tag:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      .quick-select {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }

      .quick-chip {
        padding: 6px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .quick-chip:hover {
        background: var(--bg-tertiary);
        border-color: var(--primary-color);
      }

      .quick-chip.active {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      /* Manga-specific indicators */
      .ocr-indicator {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: #059669;
        font-weight: 500;
      }

      .ocr-indicator::before {
        content: "👁";
        font-size: 10px;
      }

      .script-type {
        display: inline-block;
        padding: 1px 4px;
        background: var(--bg-tertiary);
        border-radius: 3px;
        font-size: 10px;
        font-family: monospace;
        color: var(--text-secondary);
      }

      /* Accessibility */
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }

      /* Loading state */
      .skeleton {
        background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: var(--radius-sm);
      }

      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;

    const languages = this._getFilteredLanguages();
    
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="language-selector" role="combobox" aria-expanded="false" aria-haspopup="listbox">
        ${this._mode === 'multiple' ? this._renderQuickSelect() : ''}
        
        <button class="trigger" ?disabled="${this._disabled}" aria-label="${this._getAriaLabel()}">
          <div class="trigger-content">
            ${this._renderTriggerContent()}
          </div>
          <svg class="chevron" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <div class="dropdown" role="listbox" aria-multiselectable="${this._mode === 'multiple'}">
          ${this._searchable ? `
            <div class="search-box">
              <input 
                type="text" 
                class="search-input" 
                placeholder="${i18n.t('languageSelector.searchPlaceholder')}" 
                aria-label="${i18n.t('languageSelector.searchAriaLabel')}"
              >
            </div>
          ` : ''}
          
          <div class="language-list">
            ${this._renderLanguageList(languages)}
          </div>
        </div>

        ${this._mode === 'multiple' ? `<div class="selection-summary" aria-live="polite"></div>` : ''}
      </div>
    `;

    this._renderSelection();
  }

  _renderTriggerContent() {
    if (this._selected.length === 0) {
      return `
        <span class="language-name" style="color: var(--text-secondary);">
          ${i18n.t(`languageSelector.placeholder.${this._type}`)}
        </span>
      `;
    }

    if (this._mode === 'multiple') {
      return `
        <span class="language-name">
          ${this._selected.length} ${i18n.t('languageSelector.languagesSelected')}
        </span>
      `;
    }

    const lang = LANGUAGE_METADATA[this._selected[0]];
    return `
      <span class="flag" aria-hidden="true">${lang?.flag || '🌐'}</span>
      <div class="language-info">
        <span class="language-name">${lang?.nativeName || this._selected[0]}</span>
        <span class="language-meta">
          ${lang?.vertical ? '<span class="badge badge--vertical">Vertical</span>' : ''}
          ${lang?.rtl ? '<span class="badge badge--rtl">RTL</span>' : ''}
          ${lang?.mangaOptimized ? '<span class="badge badge--manga">Manga</span>' : ''}
        </span>
      </div>
    `;
  }

  _renderQuickSelect() {
    const quickLanguages = this._type === 'source' 
      ? ['ja', 'ko', 'zh', 'zh-Hant', 'en']
      : ['en', 'es', 'fr', 'de', 'pt', 'ru', 'id', 'vi', 'th'];
    
    return `
      <div class="quick-select" role="group" aria-label="${i18n.t('languageSelector.quickSelect')}">
        ${quickLanguages.map(code => {
          const lang = LANGUAGE_METADATA[code];
          const isSelected = this._selected.includes(code);
          return `
            <button 
              class="quick-chip ${isSelected ? 'active' : ''}" 
              data-value="${code}"
              aria-pressed="${isSelected}"
            >
              <span>${lang?.flag || '🌐'}</span>
              <span>${lang?.name || code}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderLanguageList(languages) {
    if (languages.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div>${i18n.t('languageSelector.noResults')}</div>
        </div>
      `;
    }

    // Group languages by region/script type for better organization
    const groups = this._groupLanguages(languages);
    
    return Object.entries(groups).map(([groupName, groupLangs]) => `
      <div class="language-group">
        <div class="group-label">${groupName}</div>
        ${groupLangs.map(lang => this._renderLanguageOption(lang)).join('')}
      </div>
    `).join('');
  }

  _renderLanguageOption(lang) {
    const isSelected = this._selected.includes(lang.code);
    const isDisabled = this._isLanguageDisabled(lang);
    const inputType = this._mode === 'multiple' ? 'checkbox' : 'radio';
    
    return `
      <div 
        class="language-option ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
        data-value="${lang.code}"
        role="option"
        aria-selected="${isSelected}"
        aria-disabled="${isDisabled}"
        tabindex="${isDisabled ? '-1' : '0'}"
      >
        <div class="${inputType}">
          ${inputType === 'checkbox' 
            ? `<svg class="checkmark" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>`
            : `<div class="radio-dot"></div>`
          }
        </div>
        <span class="flag" aria-hidden="true">${lang.flag || '🌐'}</span>
        <div class="language-info" style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="language-name">${lang.nativeName}</span>
            ${lang.mangaOptimized ? '<span class="badge badge--manga">Manga</span>' : ''}
          </div>
          <div class="language-meta">
            <span>${lang.name}</span>
            ${lang.vertical ? '<span class="badge badge--vertical">Vertical</span>' : ''}
            ${lang.rtl ? '<span class="badge badge--rtl">RTL</span>' : ''}
            ${lang.ocrQuality > 0.9 ? '<span class="ocr-indicator">High OCR</span>' : ''}
            <span class="script-type">${lang.script}</span>
          </div>
        </div>
      </div>
    `;
  }

  _getFilteredLanguages() {
    // Filter based on source/target type
    const langs = Object.entries(LANGUAGE_METADATA)
      .filter(([code, meta]) => {
        if (this._type === 'source') {
          return meta.availableForOCR !== false;
        }
        return meta.availableForTranslation !== false;
      })
      .map(([code, meta]) => ({ code, ...meta }));
    
    return langs;
  }

  _groupLanguages(languages) {
    // Group by manga relevance first, then by script family
    const groups = {
      'Manga & Manhwa': [],
      'East Asian': [],
      'European': [],
      'Middle Eastern': [],
      'South Asian': [],
      'Other': []
    };

    languages.forEach(lang => {
      if (lang.mangaOptimized) {
        groups['Manga & Manhwa'].push(lang);
      } else if (['Japanese', 'Korean', 'Chinese', 'Cantonese'].includes(lang.family)) {
        groups['East Asian'].push(lang);
      } else if (['Latin', 'Cyrillic', 'Greek'].includes(lang.script)) {
        groups['European'].push(lang);
      } else if (lang.rtl) {
        groups['Middle Eastern'].push(lang);
      } else if (['Devanagari', 'Bengali', 'Tamil', 'Thai'].includes(lang.script)) {
        groups['South Asian'].push(lang);
      } else {
        groups['Other'].push(lang);
      }
    });

    // Remove empty groups
    return Object.fromEntries(Object.entries(groups).filter(([_, arr]) => arr.length > 0));
  }

  _isLanguageDisabled(lang) {
    // Prevent selecting same language for source and target in pair mode
    if (this._mode === 'pair') {
      const pairSelect = this._type === 'source' 
        ? this.closest('form')?.querySelector('[type="target"]')
        : this.closest('form')?.querySelector('[type="source"]');
      if (pairSelect && pairSelect.value === lang.code) {
        return true;
      }
    }
    return false;
  }

  _attachEventListeners() {
    const trigger = this.shadowRoot.querySelector('.trigger');
    const dropdown = this.shadowRoot.querySelector('.dropdown');
    const searchInput = this.shadowRoot.querySelector('.search-input');
    const languageList = this.shadowRoot.querySelector('.language-list');

    // Toggle dropdown
    trigger?.addEventListener('click', () => this._toggleDropdown());

    // Search functionality
    searchInput?.addEventListener('input', (e) => this._handleSearch(e.target.value));

    // Keyboard navigation
    this.addEventListener('keydown', (e) => this._handleKeydown(e));

    // Language selection
    languageList?.addEventListener('click', (e) => {
      const option = e.target.closest('.language-option');
      if (option && !option.classList.contains('disabled')) {
        this._selectLanguage(option.dataset.value);
      }
    });

    // Quick select chips
    this.shadowRoot.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleQuickSelect(chip.dataset.value);
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target)) {
        this._closeDropdown();
      }
    });

    // Prevent closing when clicking inside dropdown
    dropdown?.addEventListener('click', (e) => {
      if (!e.target.closest('.language-option')) {
        e.stopPropagation();
      }
    });
  }

  _removeEventListeners() {
    // Cleanup handled by garbage collection due to shadow DOM encapsulation
  }

  _toggleDropdown() {
    if (this._disabled) return;
    
    const dropdown = this.shadowRoot.querySelector('.dropdown');
    const chevron = this.shadowRoot.querySelector('.chevron');
    const isOpen = dropdown.classList.contains('open');
    
    if (isOpen) {
      this._closeDropdown();
    } else {
      dropdown.classList.add('open');
      chevron.classList.add('open');
      this.setAttribute('aria-expanded', 'true');
      
      // Focus search input
      setTimeout(() => {
        this.shadowRoot.querySelector('.search-input')?.focus();
      }, 0);
    }
  }

  _closeDropdown() {
    const dropdown = this.shadowRoot.querySelector('.dropdown');
    const chevron = this.shadowRoot.querySelector('.chevron');
    dropdown?.classList.remove('open');
    chevron?.classList.remove('open');
    this.setAttribute('aria-expanded', 'false');
  }

  _handleSearch(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const languages = this._getFilteredLanguages();
    
    const filtered = languages.filter(lang => 
      lang.name.toLowerCase().includes(normalizedQuery) ||
      lang.nativeName.toLowerCase().includes(normalizedQuery) ||
      lang.code.toLowerCase().includes(normalizedQuery) ||
      lang.aliases?.some(alias => alias.toLowerCase().includes(normalizedQuery))
    );

    const listContainer = this.shadowRoot.querySelector('.language-list');
    listContainer.innerHTML = this._renderLanguageList(filtered);
  }

  _selectLanguage(code) {
    if (this._mode === 'multiple') {
      const index = this._selected.indexOf(code);
      if (index > -1) {
        this._selected.splice(index, 1);
      } else {
        this._selected.push(code);
      }
    } else {
      this._selected = [code];
      this._closeDropdown();
    }

    this._renderSelection();
    this._dispatchChangeEvent();
  }

  _toggleQuickSelect(code) {
    const index = this._selected.indexOf(code);
    if (index > -1) {
      this._selected.splice(index, 1);
    } else {
      this._selected.push(code);
    }
    this._renderSelection();
    this._dispatchChangeEvent();
  }

  _renderSelection() {
    // Update trigger content
    const triggerContent = this.shadowRoot.querySelector('.trigger-content');
    if (triggerContent) {
      triggerContent.innerHTML = this._renderTriggerContent();
    }

    // Update dropdown selections
    this.shadowRoot.querySelectorAll('.language-option').forEach(option => {
      const isSelected = this._selected.includes(option.dataset.value);
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-selected', isSelected);
    });

    // Update quick select chips
    this.shadowRoot.querySelectorAll('.quick-chip').forEach(chip => {
      const isSelected = this._selected.includes(chip.dataset.value);
      chip.classList.toggle('active', isSelected);
      chip.setAttribute('aria-pressed', isSelected);
    });

    // Update selection summary for multiple mode
    if (this._mode === 'multiple') {
      const summary = this.shadowRoot.querySelector('.selection-summary');
      if (summary) {
        summary.innerHTML = this._selected.map(code => {
          const lang = LANGUAGE_METADATA[code];
          return `
            <span class="selection-tag">
              <span>${lang?.flag || '🌐'} ${lang?.name || code}</span>
              <button class="remove-tag" data-value="${code}" aria-label="${i18n.t('languageSelector.remove', { lang: lang?.name })}">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </span>
          `;
        }).join('');

        // Attach remove handlers
        summary.querySelectorAll('.remove-tag').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectLanguage(btn.dataset.value);
          });
        });
      }
    }
  }

  _handleKeydown(e) {
    const dropdown = this.shadowRoot.querySelector('.dropdown');
    const isOpen = dropdown?.classList.contains('open');
    const options = Array.from(this.shadowRoot.querySelectorAll('.language-option:not(.disabled)'));
    const currentIndex = options.findIndex(opt => opt === this.shadowRoot.activeElement);

    switch(e.key) {
      case 'Escape':
        if (isOpen) {
          this._closeDropdown();
          this.shadowRoot.querySelector('.trigger')?.focus();
        }
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          this._toggleDropdown();
        } else {
          const nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
          options[nextIndex]?.focus();
        }
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
          options[prevIndex]?.focus();
        }
        break;
      
      case 'Enter':
      case ' ':
        if (e.target.classList.contains('language-option')) {
          e.preventDefault();
          this._selectLanguage(e.target.dataset.value);
        }
        break;
      
      case 'Tab':
        if (isOpen && e.target.classList.contains('language-option')) {
          e.preventDefault();
          this._closeDropdown();
        }
        break;
    }
  }

  _dispatchChangeEvent() {
    this.dispatchEvent(new CustomEvent('change', {
      detail: {
        value: this.value,
        type: this._type,
        mode: this._mode
      },
      bubbles: true,
      composed: true
    }));
  }

  _updateDisabledState() {
    const trigger = this.shadowRoot.querySelector('.trigger');
    if (trigger) {
      trigger.disabled = this._disabled;
    }
  }

  _getAriaLabel() {
    const key = this._mode === 'multiple' ? 'selectLanguages' : 'selectLanguage';
    return i18n.t(`languageSelector.${key}`, { type: this._type });
  }

  _announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'visually-hidden';
    announcement.textContent = message;
    this.shadowRoot.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
  }

  // Public API
  open() {
    this._toggleDropdown();
  }

  close() {
    this._closeDropdown();
  }

  focus() {
    this.shadowRoot.querySelector('.trigger')?.focus();
  }

  validate() {
    if (this._mode === 'multiple') {
      return this._selected.length > 0;
    }
    return this._selected.length === 1;
  }

  clear() {
    this._selected = [];
    this._renderSelection();
    this._dispatchChangeEvent();
  }

  getSelectedLanguages() {
    return this._selected.map(code => ({
      code,
      ...LANGUAGE_METADATA[code]
    }));
  }
}

// Define the custom element
customElements.define('language-selector', LanguageSelector);

// Export for module usage
export default LanguageSelector;