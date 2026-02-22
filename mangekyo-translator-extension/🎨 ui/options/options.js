/**
 * Mangekyo Translator - Options Page Controller
 * Handles settings management, UI interactions, and Chrome storage sync
 */

class OptionsController {
    constructor() {
        this.currentPage = 'general';
        this.settings = {};
        this.defaultSettings = {
            extensionEnabled: true,
            autoTranslate: false,
            targetLanguage: 'en',
            detectionSensitivity: 75,
            translationEngine: 'google',
            honorifics: true,
            sfxTranslation: false,
            ocrLanguages: ['jpn'],
            preprocessing: {
                denoise: true,
                deskew: true,
                binarize: false
            },
            ocrQuality: 2,
            theme: 'sharingan',
            overlayStyle: 'bubble',
            fontSize: 16,
            opacity: 90,
            hotkeys: {
                toggle: 'Ctrl+Shift+M',
                translate: 'Ctrl+Shift+T',
                clear: 'Ctrl+Shift+C',
                ems: 'Ctrl+Shift+E'
            },
            privacyMode: false
        };
        
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.setupEventListeners();
        this.setupNavigation();
        this.updateUIFromSettings();
        this.startPowerLevelAnimation();
    }

    // Load settings from Chrome storage
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get('mangekyoSettings');
            this.settings = { ...this.defaultSettings, ...result.mangekyoSettings };
            console.log('Settings loaded:', this.settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = { ...this.defaultSettings };
        }
    }

    // Save settings to Chrome storage
    async saveSettings() {
        try {
            await chrome.storage.sync.set({ mangekyoSettings: this.settings });
            this.showToast('Settings saved successfully');
            this.animateSaveButton();
            
            // Notify background script of settings change
            chrome.runtime.sendMessage({ 
                action: 'settingsUpdated', 
                settings: this.settings 
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showToast('Failed to save settings', 'error');
        }
    }

    // Setup all event listeners
    setupEventListeners() {
        // Save and Reset buttons
        document.getElementById('saveBtn').addEventListener('click', () => this.saveSettings());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetSettings());
        
        // General settings
        this.bindToggle('extEnabled', 'extensionEnabled');
        this.bindToggle('autoTranslate', 'autoTranslate');
        this.bindSelect('targetLang', 'targetLanguage');
        this.bindRange('sensitivity', 'detectionSensitivity', (val) => {
            document.getElementById('sensitivityValue').textContent = val + '%';
        });

        // Translation settings
        this.bindRadioGroup('engine', 'translationEngine');
        this.bindToggle('honorifics', 'honorifics');
        this.bindToggle('sfxTranslate', 'sfxTranslation');

        // OCR settings
        this.bindCheckboxGroup('.lang-checkbox input', 'ocrLanguages');
        this.bindToggle('denoise', 'preprocessing.denoise');
        this.bindToggle('deskew', 'preprocessing.deskew');
        this.bindToggle('binarize', 'preprocessing.binarize');
        this.bindRange('ocrQuality', 'ocrQuality');

        // Appearance settings
        this.bindRadioGroup('theme', 'theme', (val) => this.updateTheme(val));
        this.bindSelect('overlayStyle', 'overlayStyle');
        this.bindRange('fontSize', 'fontSize', (val) => {
            document.getElementById('fontPreview').style.fontSize = val + 'px';
        });
        this.bindRange('opacity', 'opacity');

        // Advanced settings
        this.bindToggle('privacyMode', 'privacyMode');
        document.getElementById('clearCache').addEventListener('click', () => this.clearCache());
        document.getElementById('factoryReset').addEventListener('click', () => this.factoryReset());

        // Hotkey editing
        document.querySelectorAll('.hotkey-input').forEach(el => {
            el.addEventListener('click', (e) => this.editHotkey(e.target));
        });
    }

    // Navigation handling
    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                this.switchPage(page);
                
                // Update active states
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    switchPage(page) {
        // Hide all pages
        document.querySelectorAll('.settings-page').forEach(p => p.classList.remove('active'));
        
        // Show selected page
        const targetPage = document.getElementById(`page-${page}`);
        if (targetPage) {
            targetPage.classList.add('active');
            this.currentPage = page;
            
            // Update title
            const titles = {
                general: 'General Settings',
                translation: 'Translation Settings',
                ocr: 'OCR Engine Settings',
                appearance: 'Appearance Settings',
                hotkeys: 'Keyboard Shortcuts',
                advanced: 'Advanced Settings',
                about: 'About'
            };
            document.getElementById('pageTitle').textContent = titles[page];
        }
    }

    // Update UI from loaded settings
    updateUIFromSettings() {
        // Update toggles
        document.getElementById('extEnabled').checked = this.settings.extensionEnabled;
        document.getElementById('autoTranslate').checked = this.settings.autoTranslate;
        document.getElementById('honorifics').checked = this.settings.honorifics;
        document.getElementById('sfxTranslate').checked = this.settings.sfxTranslation;
        document.getElementById('privacyMode').checked = this.settings.privacyMode;

        // Update selects
        document.getElementById('targetLang').value = this.settings.targetLanguage;
        document.getElementById('overlayStyle').value = this.settings.overlayStyle;

        // Update ranges
        document.getElementById('sensitivity').value = this.settings.detectionSensitivity;
        document.getElementById('sensitivityValue').textContent = this.settings.detectionSensitivity + '%';
        document.getElementById('fontSize').value = this.settings.fontSize;
        document.getElementById('fontPreview').style.fontSize = this.settings.fontSize + 'px';
        document.getElementById('opacity').value = this.settings.opacity;
        document.getElementById('ocrQuality').value = this.settings.ocrQuality;

        // Update radio buttons
        document.querySelector(`input[name="engine"][value="${this.settings.translationEngine}"]`).checked = true;
        document.querySelector(`input[name="theme"][value="${this.settings.theme}"]`).checked = true;

        // Update checkboxes
        document.querySelectorAll('.lang-checkbox input').forEach(cb => {
            cb.checked = this.settings.ocrLanguages.includes(cb.value);
        });

        // Update preprocessing
        document.getElementById('denoise').checked = this.settings.preprocessing.denoise;
        document.getElementById('deskew').checked = this.settings.preprocessing.deskew;
        document.getElementById('binarize').checked = this.settings.preprocessing.binarize;

        // Update hotkeys
        document.querySelectorAll('.hotkey-input').forEach(el => {
            const action = el.dataset.action || this.inferAction(el);
            if (this.settings.hotkeys[action]) {
                el.textContent = this.settings.hotkeys[action];
            }
        });

        // Update cache size
        this.updateCacheSize();
    }

    // Helper: Bind toggle switch
    bindToggle(id, settingPath) {
        const el = document.getElementById(id);
        if (!el) return;
        
        el.addEventListener('change', (e) => {
            this.setNestedSetting(settingPath, e.target.checked);
        });
    }

    // Helper: Bind select dropdown
    bindSelect(id, settingKey) {
        const el = document.getElementById(id);
        if (!el) return;
        
        el.addEventListener('change', (e) => {
            this.settings[settingKey] = e.target.value;
        });
    }

    // Helper: Bind range slider
    bindRange(id, settingKey, callback) {
        const el = document.getElementById(id);
        if (!el) return;
        
        el.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            this.setNestedSetting(settingKey, val);
            if (callback) callback(val);
        });
    }

    // Helper: Bind radio group
    bindRadioGroup(name, settingKey, callback) {
        document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.settings[settingKey] = e.target.value;
                    if (callback) callback(e.target.value);
                }
            });
        });
    }

    // Helper: Bind checkbox group
    bindCheckboxGroup(selector, settingKey) {
        const checkboxes = document.querySelectorAll(selector);
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const values = Array.from(checkboxes)
                    .filter(c => c.checked)
                    .map(c => c.value);
                this.settings[settingKey] = values;
            });
        });
    }

    // Helper: Set nested object property
    setNestedSetting(path, value) {
        const keys = path.split('.');
        let obj = this.settings;
        for (let i = 0; i < keys.length - 1; i++) {
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
    }

    // Theme update with visual feedback
    updateTheme(theme) {
        const logoImg = document.getElementById('logoImage');
        const dots = document.querySelectorAll('.dot');
        
        const themeImages = {
            sharingan: '../build/assets/icons/tomoe-sharingan.png',
            ems: '../build/assets/icons/ems-madara.png',
            rinnegan: '../build/assets/icons/rinnegan.png'
        };

        if (logoImg && themeImages[theme]) {
            logoImg.style.transform = 'rotate(360deg)';
            setTimeout(() => {
                logoImg.src = themeImages[theme];
                logoImg.style.transform = 'rotate(0deg)';
            }, 300);
        }

        // Update power level dots
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index < this.getThemeLevel(theme));
        });

        // Update license status
        this.updateLicenseStatus(theme);
    }

    getThemeLevel(theme) {
        const levels = { sharingan: 1, ems: 2, rinnegan: 3 };
        return levels[theme] || 1;
    }

    updateLicenseStatus(theme) {
        const statusEl = document.getElementById('licenseStatus');
        const configs = {
            sharingan: { icon: 'tomoe-sharingan.png', text: 'Free Tier' },
            ems: { icon: 'ems-madara.png', text: 'Eternal Premium' },
            rinnegan: { icon: 'rinnegan.png', text: 'Rinnegan Dev' }
        };
        
        const config = configs[theme];
        if (config && statusEl) {
            statusEl.innerHTML = `
                <img src="../build/assets/icons/${config.icon}" alt="License" class="status-icon">
                <span>${config.text}</span>
            `;
        }
    }

    // Power level animation
    startPowerLevelAnimation() {
        const logo = document.querySelector('.logo-container');
        if (!logo) return;

        let rotation = 0;
        const animate = () => {
            if (this.settings.theme === 'ems') {
                rotation += 0.5;
                logo.style.transform = `rotate(${rotation}deg)`;
            } else if (this.settings.theme === 'rinnegan') {
                rotation += 1;
                logo.style.transform = `rotate(${rotation}deg) scale(${1 + Math.sin(rotation * 0.05) * 0.1})`;
            }
            requestAnimationFrame(animate);
        };
        animate();
    }

    // Hotkey editing
    async editHotkey(element) {
        const originalText = element.textContent;
        element.textContent = 'Press keys...';
        element.classList.add('recording');
        
        const keys = new Set();
        
        const handler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (e.type === 'keydown') {
                if (e.key === 'Escape') {
                    cleanup();
                    return;
                }
                
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                    keys.add(e.key);
                } else {
                    keys.add(e.key.toUpperCase());
                }
                
                const combo = Array.from(keys).join('+');
                element.textContent = combo;
            } else if (e.type === 'keyup') {
                if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                    cleanup();
                }
            }
        };
        
        const cleanup = () => {
            document.removeEventListener('keydown', handler);
            document.removeEventListener('keyup', handler);
            element.classList.remove('recording');
            
            const finalCombo = element.textContent;
            if (finalCombo !== 'Press keys...' && finalCombo !== originalText) {
                const action = element.dataset.action || this.inferAction(element);
                this.settings.hotkeys[action] = finalCombo;
                this.showToast('Hotkey updated');
            } else {
                element.textContent = originalText;
            }
        };
        
        document.addEventListener('keydown', handler);
        document.addEventListener('keyup', handler);
        
        // Timeout after 5 seconds
        setTimeout(cleanup, 5000);
    }

    inferAction(element) {
        const text = element.previousElementSibling?.textContent || '';
        const map = {
            'Toggle Extension': 'toggle',
            'Translate Page': 'translate',
            'Clear Overlays': 'clear',
            'Activate EMS Mode': 'ems'
        };
        return map[text] || 'toggle';
    }

    // Cache management
    async updateCacheSize() {
        try {
            // Query storage usage
            const bytes = await chrome.storage.local.getBytesInUse();
            const mb = (bytes / 1024 / 1024).toFixed(1);
            document.getElementById('cacheSize').textContent = mb + ' MB';
        } catch (error) {
            console.error('Failed to get cache size:', error);
        }
    }

    async clearCache() {
        try {
            await chrome.storage.local.clear();
            this.showToast('Cache cleared');
            this.updateCacheSize();
        } catch (error) {
            this.showToast('Failed to clear cache', 'error');
        }
    }

    // Reset functions
    async resetSettings() {
        if (confirm('Reset all settings to default?')) {
            this.settings = { ...this.defaultSettings };
            this.updateUIFromSettings();
            await this.saveSettings();
        }
    }

    async factoryReset() {
        if (confirm('WARNING: This will reset everything including cached data. Continue?')) {
            await chrome.storage.sync.clear();
            await chrome.storage.local.clear();
            this.settings = { ...this.defaultSettings };
            this.updateUIFromSettings();
            this.showToast('Factory reset complete');
        }
    }

    // UI Feedback
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const msgEl = toast.querySelector('.toast-message');
        msgEl.textContent = message;
        
        if (type === 'error') {
            toast.style.borderColor = 'var(--danger-color)';
            msgEl.style.color = 'var(--danger-color)';
        } else {
            toast.style.borderColor = 'var(--primary-color)';
            msgEl.style.color = 'var(--text-primary)';
        }
        
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    animateSaveButton() {
        const btn = document.getElementById('saveBtn');
        btn.classList.add('saved');
        setTimeout(() => btn.classList.remove('saved'), 2000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new OptionsController();
});