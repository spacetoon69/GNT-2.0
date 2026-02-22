/**
 * recent-history.js
 * 
 * Recent translation history viewer with EMS (Eternal Mangekyo Sharingan) aesthetics.
 * Displays last translated panels, chapters, and pages with quick-retranslate functionality.
 * Optimized for manga reading patterns and privacy-conscious data handling.
 */

class RecentHistory extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.history = [];
    this.maxItems = 10;
    this.currentFilter = 'all';
    this.expandedItem = null;
    
    this.render();
    this.initializeStorage();
  }

  static HISTORY_TYPES = {
    panel: { icon: 'panel', color: '#DC143C', label: 'Panel' },
    page: { icon: 'page', color: '#8B0000', label: 'Page' },
    chapter: { icon: 'chapter', color: '#FF4500', label: 'Chapter' },
    bubble: { icon: 'bubble', color: '#FFD700', label: 'Bubble' }
  };

  render() {
    const styles = `
      :host {
        display: block;
        font-family: 'Segoe UI', system-ui, sans-serif;
        --item-height: 64px;
        --transition-speed: 0.3s;
      }

      .history-container {
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, rgba(20, 20, 20, 0.95), rgba(10, 10, 10, 0.98));
        border-radius: 12px;
        border: 1px solid rgba(139, 0, 0, 0.2);
        overflow: hidden;
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        background: rgba(139, 0, 0, 0.1);
        border-bottom: 1px solid rgba(139, 0, 0, 0.3);
      }

      .section-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #DC143C;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .section-title::before {
        content: '◉';
        color: #8B0000;
        animation: sharinganPulse 3s ease-in-out infinite;
      }

      @keyframes sharinganPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(0.9); }
      }

      .header-actions {
        display: flex;
        gap: 6px;
      }

      .icon-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(139, 0, 0, 0.2);
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        color: #DC143C;
      }

      .icon-btn:hover {
        background: rgba(220, 20, 60, 0.3);
        transform: scale(1.1);
      }

      .icon-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }

      .filter-tabs {
        display: flex;
        gap: 4px;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid rgba(139, 0, 0, 0.2);
      }

      .filter-tab {
        padding: 4px 10px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #666;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .filter-tab:hover {
        color: #999;
        background: rgba(255, 255, 255, 0.05);
      }

      .filter-tab.active {
        color: #DC143C;
        background: rgba(139, 0, 0, 0.2);
        border-color: rgba(220, 20, 60, 0.4);
      }

      .history-list {
        max-height: 300px;
        overflow-y: auto;
        padding: 8px;
      }

      .history-list::-webkit-scrollbar {
        width: 6px;
      }

      .history-list::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }

      .history-list::-webkit-scrollbar-thumb {
        background: rgba(139, 0, 0, 0.4);
        border-radius: 3px;
      }

      .history-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        margin-bottom: 6px;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
        transition: all var(--transition-speed);
        position: relative;
        overflow: hidden;
      }

      .history-item:hover {
        background: rgba(139, 0, 0, 0.08);
        border-color: rgba(139, 0, 0, 0.3);
        transform: translateX(4px);
      }

      .history-item.active {
        background: linear-gradient(90deg, rgba(139, 0, 0, 0.15), transparent);
        border-left: 3px solid var(--item-color, #DC143C);
      }

      .history-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--item-color, #DC143C);
        opacity: 0;
        transition: opacity 0.2s;
      }

      .history-item:hover::before {
        opacity: 1;
      }

      .thumbnail {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        background: linear-gradient(135deg, #1a1a1a, #2a2a2a);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        position: relative;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0.9;
        transition: opacity 0.2s;
      }

      .history-item:hover .thumbnail img {
        opacity: 1;
      }

      .thumbnail-icon {
        position: absolute;
        width: 20px;
        height: 20px;
        fill: var(--item-color, #DC143C);
        filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.8));
      }

      .item-content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .item-title {
        font-size: 12px;
        font-weight: 600;
        color: #e0e0e0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .item-meta {
        font-size: 10px;
        color: #666;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .meta-badge {
        padding: 2px 6px;
        background: rgba(139, 0, 0, 0.2);
        border-radius: 3px;
        color: #DC143C;
        font-weight: 600;
        font-size: 9px;
        text-transform: uppercase;
      }

      .item-time {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .item-actions {
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .history-item:hover .item-actions {
        opacity: 1;
      }

      .action-btn {
        width: 24px;
        height: 24px;
        border: none;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #888;
        transition: all 0.2s;
      }

      .action-btn:hover {
        background: rgba(220, 20, 60, 0.3);
        color: #DC143C;
        transform: scale(1.1);
      }

      .action-btn svg {
        width: 12px;
        height: 12px;
        fill: currentColor;
      }

      .expanded-panel {
        grid-column: 1 / -1;
        padding: 12px;
        background: rgba(0, 0, 0, 0.4);
        border-top: 1px solid rgba(139, 0, 0, 0.2);
        display: none;
        animation: expandIn 0.3s ease;
      }

      .expanded-panel.visible {
        display: block;
      }

      @keyframes expandIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .translation-preview {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 12px;
      }

      .preview-box {
        padding: 10px;
        background: rgba(20, 20, 20, 0.8);
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .preview-label {
        font-size: 9px;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
      }

      .preview-text {
        font-size: 11px;
        color: #ccc;
        line-height: 1.5;
        font-family: 'Noto Sans JP', sans-serif;
      }

      .preview-text.translated {
        color: #DC143C;
        text-shadow: 0 0 10px rgba(220, 20, 60, 0.3);
      }

      .quick-actions {
        display: flex;
        gap: 8px;
      }

      .quick-btn {
        flex: 1;
        padding: 8px;
        background: linear-gradient(135deg, rgba(139, 0, 0, 0.3), rgba(220, 20, 60, 0.2));
        border: 1px solid rgba(220, 20, 60, 0.4);
        color: #DC143C;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }

      .quick-btn:hover {
        background: linear-gradient(135deg, rgba(220, 20, 60, 0.4), rgba(139, 0, 0, 0.3));
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(220, 20, 60, 0.2);
      }

      .quick-btn.secondary {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
        color: #888;
      }

      .quick-btn.secondary:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ccc;
      }

      .empty-state {
        padding: 40px 20px;
        text-align: center;
        color: #555;
      }

      .empty-icon {
        width: 48px;
        height: 48px;
        margin: 0 auto 12px;
        opacity: 0.3;
        fill: currentColor;
      }

      .empty-text {
        font-size: 12px;
        margin-bottom: 4px;
      }

      .empty-subtext {
        font-size: 10px;
        opacity: 0.7;
      }

      .loading-skeleton {
        animation: skeletonPulse 1.5s ease-in-out infinite;
      }

      @keyframes skeletonPulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.8; }
      }

      .privacy-notice {
        padding: 8px 12px;
        background: rgba(255, 193, 7, 0.1);
        border-top: 1px solid rgba(255, 193, 7, 0.2);
        font-size: 10px;
        color: #ffc107;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .delete-confirm {
        position: absolute;
        inset: 0;
        background: rgba(139, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
      }

      .delete-confirm.visible {
        opacity: 1;
        pointer-events: all;
      }

      .confirm-btn {
        padding: 4px 12px;
        border: none;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .confirm-yes {
        background: #DC143C;
        color: white;
      }

      .confirm-no {
        background: rgba(255, 255, 255, 0.1);
        color: #ccc;
      }
    `;

    const html = `
      <div class="history-container">
        <div class="section-header">
          <div class="section-title">Recent Translations</div>
          <div class="header-actions">
            <button class="icon-btn" id="clearAll" title="Clear History">
              <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
            <button class="icon-btn" id="refresh" title="Refresh">
              <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
          </div>
        </div>

        <div class="filter-tabs">
          <button class="filter-tab active" data-filter="all">All</button>
          <button class="filter-tab" data-filter="panel">Panels</button>
          <button class="filter-tab" data-filter="page">Pages</button>
          <button class="filter-tab" data-filter="chapter">Chapters</button>
        </div>

        <div class="history-list" id="historyList">
          <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
            <div class="empty-text">No recent translations</div>
            <div class="empty-subtext">Start reading to build history</div>
          </div>
        </div>

        <div class="privacy-notice">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
          <span>History stored locally only. Auto-deletes after 7 days.</span>
        </div>
      </div>
    `;

    this.shadowRoot.innerHTML = `<style>${styles}</style>${html}`;
    this.attachEventListeners();
  }

  attachEventListeners() {
    // Filter tabs
    this.shadowRoot.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.shadowRoot.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentFilter = e.target.dataset.filter;
        this.renderHistory();
      });
    });

    // Clear all
    this.shadowRoot.getElementById('clearAll').addEventListener('click', () => {
      if (confirm('Clear all translation history?')) {
        this.clearHistory();
      }
    });

    // Refresh
    this.shadowRoot.getElementById('refresh').addEventListener('click', () => {
      this.loadHistory();
    });

    // History list clicks (delegated)
    this.shadowRoot.getElementById('historyList').addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      const action = e.target.closest('.action-btn');
      
      if (action) {
        e.stopPropagation();
        const id = action.closest('.history-item').dataset.id;
        const actionType = action.dataset.action;
        this.handleAction(id, actionType);
      } else if (item) {
        const id = item.dataset.id;
        this.toggleExpand(id);
      }
    });
  }

  async initializeStorage() {
    await this.loadHistory();
    this.startCleanupTimer();
  }

  async loadHistory() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('translationHistory');
        this.history = result.translationHistory || [];
        this.cleanOldEntries();
        this.renderHistory();
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }

  async saveHistory() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ translationHistory: this.history });
      }
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }

  cleanOldEntries() {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const now = Date.now();
    this.history = this.history.filter(item => (now - item.timestamp) < maxAge);
    // Keep only maxItems
    this.history = this.history.slice(0, this.maxItems);
  }

  startCleanupTimer() {
    // Check for old entries every hour
    setInterval(() => {
      this.cleanOldEntries();
      this.saveHistory();
    }, 60 * 60 * 1000);
  }

  addEntry(entry) {
    const newEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: entry.type || 'panel',
      title: entry.title || 'Untitled',
      sourceUrl: entry.sourceUrl,
      thumbnail: entry.thumbnail,
      originalText: entry.originalText,
      translatedText: entry.translatedText,
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      mangaTitle: entry.mangaTitle,
      chapterNum: entry.chapterNum,
      pageNum: entry.pageNum,
      ...entry
    };

    // Remove duplicates (same URL + text)
    this.history = this.history.filter(h => 
      !(h.sourceUrl === newEntry.sourceUrl && h.originalText === newEntry.originalText)
    );

    this.history.unshift(newEntry);
    this.cleanOldEntries();
    this.saveHistory();
    this.renderHistory();

    // Notify
    this.dispatchEvent(new CustomEvent('historyupdate', {
      detail: { action: 'add', entry: newEntry }
    }));
  }

  renderHistory() {
    const container = this.shadowRoot.getElementById('historyList');
    
    if (this.history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
          <div class="empty-text">No recent translations</div>
          <div class="empty-subtext">Start reading to build history</div>
        </div>
      `;
      return;
    }

    const filtered = this.currentFilter === 'all' 
      ? this.history 
      : this.history.filter(h => h.type === this.currentFilter);

    container.innerHTML = filtered.map(item => this.createItemHTML(item)).join('');
  }

  createItemHTML(item) {
    const config = RecentHistory.HISTORY_TYPES[item.type] || RecentHistory.HISTORY_TYPES.panel;
    const timeAgo = this.formatTimeAgo(item.timestamp);
    const isExpanded = this.expandedItem === item.id;

    return `
      <div class="history-item ${isExpanded ? 'active' : ''}" 
           data-id="${item.id}"
           style="--item-color: ${config.color}">
        
        <div class="thumbnail">
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : ''}
          <svg class="thumbnail-icon" viewBox="0 0 24 24">
            ${this.getTypeIcon(config.icon)}
          </svg>
        </div>
        
        <div class="item-content">
          <div class="item-title">
            ${this.escapeHtml(item.title)}
            <span class="meta-badge">${config.label}</span>
          </div>
          <div class="item-meta">
            <span class="item-time">⏱ ${timeAgo}</span>
            ${item.mangaTitle ? `<span>📖 ${this.escapeHtml(item.mangaTitle)}</span>` : ''}
            ${item.chapterNum ? `<span>Ch.${item.chapterNum}</span>` : ''}
          </div>
        </div>
        
        <div class="item-actions">
          <button class="action-btn" data-action="retranslate" title="Retranslate">
            <svg viewBox="0 0 24 24"><path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/></svg>
          </button>
          <button class="action-btn" data-action="delete" title="Delete">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>

        <div class="delete-confirm" id="confirm-${item.id}">
          <button class="confirm-btn confirm-no" data-action="cancel">Cancel</button>
          <button class="confirm-btn confirm-yes" data-action="confirm-delete">Delete</button>
        </div>
      </div>
      
      ${isExpanded ? this.createExpandedPanel(item) : ''}
    `;
  }

  createExpandedPanel(item) {
    return `
      <div class="expanded-panel visible">
        <div class="translation-preview">
          <div class="preview-box">
            <div class="preview-label">Original (${item.sourceLang || 'JP'})</div>
            <div class="preview-text">${this.escapeHtml(item.originalText || 'No text')}</div>
          </div>
          <div class="preview-box">
            <div class="preview-label">Translated (${item.targetLang || 'EN'})</div>
            <div class="preview-text translated">${this.escapeHtml(item.translatedText || 'No translation')}</div>
          </div>
        </div>
        <div class="quick-actions">
          <button class="quick-btn" data-action="copy-original">Copy Original</button>
          <button class="quick-btn" data-action="copy-translated">Copy Translation</button>
          <button class="quick-btn secondary" data-action="goto">Go to Page</button>
        </div>
      </div>
    `;
  }

  getTypeIcon(type) {
    const icons = {
      panel: '<path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
      page: '<path d="M3 3h18v18H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M9 9v12" stroke="currentColor" stroke-width="2"/>',
      chapter: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="none" stroke="currentColor" stroke-width="2"/>',
      bubble: '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="none" stroke="currentColor" stroke-width="2"/>'
    };
    return icons[type] || icons.panel;
  }

  formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  toggleExpand(id) {
    this.expandedItem = this.expandedItem === id ? null : id;
    this.renderHistory();
    
    if (this.expandedItem) {
      this.dispatchEvent(new CustomEvent('itemexpand', {
        detail: { id, item: this.history.find(h => h.id === id) }
      }));
    }
  }

  async handleAction(id, action) {
    const item = this.history.find(h => h.id === id);
    if (!item) return;

    switch(action) {
      case 'retranslate':
        this.dispatchEvent(new CustomEvent('retranslate', { detail: item }));
        break;
        
      case 'delete':
        const confirmEl = this.shadowRoot.getElementById(`confirm-${id}`);
        confirmEl.classList.add('visible');
        break;
        
      case 'confirm-delete':
        this.history = this.history.filter(h => h.id !== id);
        await this.saveHistory();
        this.renderHistory();
        this.dispatchEvent(new CustomEvent('historyupdate', {
          detail: { action: 'delete', id }
        }));
        break;
        
      case 'cancel':
        const cancelConfirm = this.shadowRoot.getElementById(`confirm-${id}`);
        cancelConfirm.classList.remove('visible');
        break;
        
      case 'copy-original':
        await navigator.clipboard.writeText(item.originalText);
        this.showToast('Original text copied');
        break;
        
      case 'copy-translated':
        await navigator.clipboard.writeText(item.translatedText);
        this.showToast('Translation copied');
        break;
        
      case 'goto':
        if (item.sourceUrl) {
          chrome.tabs.create({ url: item.sourceUrl });
        }
        break;
    }
  }

  async clearHistory() {
    this.history = [];
    await this.saveHistory();
    this.renderHistory();
    this.dispatchEvent(new CustomEvent('historyupdate', {
      detail: { action: 'clear' }
    }));
  }

  showToast(message) {
    // Simple toast implementation
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(139, 0, 0, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 10000;
      animation: fadeIn 0.3s;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // Public API
  getHistory() {
    return [...this.history];
  }

  getRecentByManga(mangaTitle) {
    return this.history.filter(h => h.mangaTitle === mangaTitle);
  }

  search(query) {
    const lower = query.toLowerCase();
    return this.history.filter(h => 
      h.originalText?.toLowerCase().includes(lower) ||
      h.translatedText?.toLowerCase().includes(lower) ||
      h.mangaTitle?.toLowerCase().includes(lower)
    );
  }
}

// Register custom element
customElements.define('recent-history', RecentHistory);

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RecentHistory;
}