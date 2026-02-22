// ============================================
// STATE MANAGEMENT
// ============================================
const state = {
    isActive: false,
    isReading: false,
    currentState: 'tomoe', // 'tomoe', 'ems', 'rinnegan'
    autoDetect: true,
    liveTranslate: false,
    overlay: true,
    engine: 'google',
    currentSite: null,
    stats: {
        translated: 0,
        cached: 0,
        accuracy: 0
    },
    irisPosition: { x: window.innerWidth - 100, y: 100 },
    isDragging: false
};

// ============================================
// DOM ELEMENTS CACHE
// ============================================
const elements = {
    // Sharingan states
    sharinganContainer: document.getElementById('sharinganToggle'),
    tomoeState: document.getElementById('tomoeState'),
    emsState: document.getElementById('emsState'),
    rinneganState: document.getElementById('rinneganState'),
    
    // Status elements
    mainStatus: document.getElementById('mainStatus'),
    siteDot: document.getElementById('siteDot'),
    siteText: document.getElementById('siteText'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    
    // Buttons
    btnActivate: document.getElementById('btnActivate'),
    btnSettings: document.getElementById('btnSettings'),
    
    // Stats
    translatedCount: document.getElementById('translatedCount'),
    cachedCount: document.getElementById('cachedCount'),
    accuracyRate: document.getElementById('accuracyRate'),
    
    // Overlays
    loadingOverlay: document.getElementById('loadingOverlay'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    
    // Floating iris
    floatingIris: document.getElementById('floatingIris'),
    irisImage: document.getElementById('irisImage'),
    
    // Lists
    recentList: document.getElementById('recentList')
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initializePopup();
    setupEventListeners();
    setupFloatingIris();
    loadSavedState();
    checkCurrentSite();
    loadStats();
    checkConnection();
});

function initializePopup() {
    // Set initial state class
    updateSharinganState('tomoe');
    
    // Initialize floating iris position
    chrome.storage.local.get(['irisPosition'], (result) => {
        if (result.irisPosition) {
            state.irisPosition = result.irisPosition;
            updateIrisPosition();
        }
    });
}

function loadSavedState() {
    chrome.storage.local.get([
        'autoDetect', 
        'liveTranslate', 
        'overlay', 
        'translationEngine',
        'isActive',
        'isReading'
    ], (result) => {
        if (result.autoDetect !== undefined) state.autoDetect = result.autoDetect;
        if (result.liveTranslate !== undefined) state.liveTranslate = result.liveTranslate;
        if (result.overlay !== undefined) state.overlay = result.overlay;
        if (result.translationEngine) state.engine = result.translationEngine;
        
        // Restore toggle states
        updateToggleUI('toggleAutoDetect', 'switchAutoDetect', state.autoDetect);
        updateToggleUI('toggleLiveTranslate', 'switchLiveTranslate', state.liveTranslate);
        updateToggleUI('toggleOverlay', 'switchOverlay', state.overlay);
        
        // Restore engine selection
        document.querySelectorAll('.engine-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.engine === state.engine);
        });
        
        // Restore active state if it was saved
        if (result.isActive) {
            // Don't auto-activate, just restore UI state
            state.isActive = true;
            updateSharinganState('ems');
        }
    });
}

// ============================================
// EVENT LISTENERS SETUP
// ============================================
function setupEventListeners() {
    // Main Sharingan click (Tomoe -> EMS)
    elements.sharinganContainer.addEventListener('click', handleSharinganClick);
    
    // Activate button
    elements.btnActivate.addEventListener('click', handleSharinganClick);
    
    // Settings button
    elements.btnSettings.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
    
    // Toggle switches
    setupToggle('toggleAutoDetect', 'switchAutoDetect', 'autoDetect');
    setupToggle('toggleLiveTranslate', 'switchLiveTranslate', 'liveTranslate');
    setupToggle('toggleOverlay', 'switchOverlay', 'overlay');
    
    // Engine selection
    document.querySelectorAll('.engine-btn').forEach(btn => {
        btn.addEventListener('click', () => selectEngine(btn));
    });
    
    // Recent items click
    document.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            chrome.tabs.create({ url: url });
        });
    });
    
    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleRuntimeMessages);
    
    // Listen for scroll events from content script to trigger reading mode
    setupScrollListener();
}

function setupToggle(itemId, switchId, stateKey) {
    const item = document.getElementById(itemId);
    const switchEl = document.getElementById(switchId);
    
    item.addEventListener('click', () => {
        state[stateKey] = !state[stateKey];
        updateToggleUI(itemId, switchId, state[stateKey]);
        
        // Save to storage
        chrome.storage.local.set({ [stateKey]: state[stateKey] });
        
        // Notify content script
        notifyContentScript('updateSettings', { [stateKey]: state[stateKey] });
    });
}

function updateToggleUI(itemId, switchId, isActive) {
    const item = document.getElementById(itemId);
    const switchEl = document.getElementById(switchId);
    
    switchEl.classList.toggle('active', isActive);
    item.classList.toggle('active', isActive);
}

// ============================================
// SHARINGAN STATE MANAGEMENT
// ============================================
function handleSharinganClick() {
    if (!state.currentSite) {
        showToast('No manga reader detected on this page');
        return;
    }

    if (state.currentState === 'tomoe') {
        // Transition to EMS (Activate)
        transitionToEMS();
    } else if (state.currentState === 'ems') {
        // Transition back to Tomoe (Deactivate)
        transitionToTomoe();
    } else if (state.currentState === 'rinnegan') {
        // From Rinnegan, go back to EMS
        transitionToEMS();
    }
}

function transitionToEMS() {
    if (state.isTransitioning) return;
    state.isTransitioning = true;
    
    // Show loading
    elements.loadingOverlay.classList.add('active');
    
    setTimeout(() => {
        elements.loadingOverlay.classList.remove('active');
        
        // Add spinning class to Tomoe
        elements.tomoeState.classList.add('spinning');
        
        // Wait for spin to complete before switching
        setTimeout(() => {
            updateSharinganState('ems');
            
            // Add spinning-in to EMS
            elements.emsState.classList.add('spinning-in');
            
            // Activate in content script
            activateInContentScript();
            
            // Clean up animation classes
            setTimeout(() => {
                elements.tomoeState.classList.remove('spinning');
                elements.emsState.classList.remove('spinning-in');
                state.isTransitioning = false;
            }, 1000);
            
        }, 400); // Halfway through tomoe spin
        
    }, 800);
}

function transitionToTomoe() {
    if (state.isTransitioning) return;
    state.isTransitioning = true;
    
    // Spin out EMS
    elements.emsState.classList.add('spinning-out');
    
    setTimeout(() => {
        updateSharinganState('tomoe');
        state.isTransitioning = false;
        
        // Clean up
        setTimeout(() => {
            elements.emsState.classList.remove('spinning-out');
        }, 100);
        
        deactivateInContentScript();
        
    }, 600);
}

function transitionToRinnegan() {
    if (state.isTransitioning || state.currentState === 'rinnegan') return;
    state.isTransitioning = true;
    
    // Spin out current state
    if (state.currentState === 'ems') {
        elements.emsState.classList.add('spinning-out');
    }
    
    setTimeout(() => {
        updateSharinganState('rinnegan');
        
        // Spin in Rinnegan
        elements.rinneganState.classList.add('spinning-in');
        
        // Show floating iris
        showFloatingIris();
        
        setTimeout(() => {
            elements.rinneganState.classList.remove('spinning-in');
            elements.rinneganState.classList.add('active');
            if (state.currentState === 'ems') {
                elements.emsState.classList.remove('spinning-out');
            }
            state.isTransitioning = false;
        }, 1200);
        
    }, 600);
}

function updateSharinganState(newState) {
    state.currentState = newState;
    state.isActive = (newState === 'ems' || newState === 'rinnegan');
    state.isReading = (newState === 'rinnegan');
    
    // Update container class
    elements.sharinganContainer.className = `sharingan-container state-${newState}`;
    
    // Update status text
    updateStatusText(newState);
    
    // Update button
    updateActivateButton(newState);
    
    // Save state
    chrome.storage.local.set({ 
        isActive: state.isActive,
        isReading: state.isReading,
        currentState: newState
    });
}

function updateStatusText(state) {
    const statusMap = {
        'tomoe': { text: 'DORMANT', class: 'idle' },
        'ems': { text: 'ACTIVE', class: 'active' },
        'rinnegan': { text: 'READING', class: 'reading' }
    };
    
    const status = statusMap[state];
    elements.mainStatus.textContent = status.text;
    elements.mainStatus.className = `status-text ${status.class}`;
}

function updateActivateButton(state) {
    const config = {
        'tomoe': { text: 'Activate', class: '' },
        'ems': { text: 'Deactivate', class: 'state-ems' },
        'rinnegan': { text: 'Stop Reading', class: 'state-rinnegan' }
    };
    
    const cfg = config[state];
    elements.btnActivate.textContent = cfg.text;
    elements.btnActivate.className = `btn btn-primary ${cfg.class}`;
}

// ============================================
// FLOATING IRIS (READING MODE)
// ============================================
function setupFloatingIris() {
    let startX, startY, initialX, initialY;
    
    elements.floatingIris.addEventListener('mousedown', startDrag);
    elements.floatingIris.addEventListener('touchstart', startDrag, { passive: false });
    
    function startDrag(e) {
        if (!state.isReading) return;
        
        state.isDragging = true;
        elements.floatingIris.classList.add('dragging');
        elements.floatingIris.classList.remove('visible'); // Pause float animation
        
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        
        startX = clientX;
        startY = clientY;
        
        const rect = elements.floatingIris.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);
    }
    
    function drag(e) {
        if (!state.isDragging) return;
        e.preventDefault();
        
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        state.irisPosition.x = initialX + deltaX;
        state.irisPosition.y = initialY + deltaY;
        
        updateIrisPosition();
    }
    
    function endDrag() {
        state.isDragging = false;
        elements.floatingIris.classList.remove('dragging');
        elements.floatingIris.classList.add('visible'); // Resume float animation
        
        // Save position
        chrome.storage.local.set({ irisPosition: state.irisPosition });
        
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('touchmove', drag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchend', endDrag);
    }
}

function updateIrisPosition() {
    elements.floatingIris.style.left = `${state.irisPosition.x}px`;
    elements.floatingIris.style.top = `${state.irisPosition.y}px`;
}

function showFloatingIris() {
    updateIrisPosition();
    elements.floatingIris.classList.add('visible');
    
    // Add click handler for iris to toggle back to EMS
    elements.floatingIris.onclick = (e) => {
        if (!state.isDragging) {
            e.stopPropagation();
            // Spin and return to EMS
            elements.floatingIris.classList.add('spinning');
            setTimeout(() => {
                hideFloatingIris();
                transitionToEMS();
            }, 500);
        }
    };
}

function hideFloatingIris() {
    elements.floatingIris.classList.remove('visible', 'spinning');
}

// ============================================
// CONTENT SCRIPT COMMUNICATION
// ============================================
function activateInContentScript() {
    notifyContentScript('activate', {
        autoDetect: state.autoDetect,
        liveTranslate: state.liveTranslate,
        overlay: state.overlay,
        engine: state.engine
    });
    
    showToast('Mangekyō Sharingan Activated');
}

function deactivateInContentScript() {
    notifyContentScript('deactivate', {});
    hideFloatingIris();
    showToast('Sharingan Deactivated');
}

function notifyContentScript(action, data) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        
        const message = { action, ...data };
        
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {
            // Content script not loaded, inject it
            if (action === 'activate') {
                injectContentScript(tabs[0].id);
            }
        });
    });
}

function injectContentScript(tabId) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content/manga-scanner.js']
    }).then(() => {
        // Retry sending message after injection
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { 
                action: 'activate',
                autoDetect: state.autoDetect,
                liveTranslate: state.liveTranslate,
                overlay: state.overlay,
                engine: state.engine
            }).catch(console.error);
        }, 100);
    });
}

// ============================================
// SCROLL DETECTION FOR READING MODE
// ============================================
function setupScrollListener() {
    // Listen for scroll events from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'userScrolling' && state.currentState === 'ems') {
            // Auto-transition to Rinnegan when user starts scrolling
            transitionToRinnegan();
        } else if (request.action === 'userStoppedScrolling' && state.currentState === 'rinnegan') {
            // Optional: Auto-return to EMS after stopped scrolling for a while
            // transitionToEMS();
        }
        sendResponse({ received: true });
    });
}

// ============================================
// SITE DETECTION & STATS
// ============================================
function checkCurrentSite() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        
        const url = tabs[0].url;
        const supportedSites = [
            'mangadex.org', 
            'webtoons.com', 
            'mangafox', 
            'readmanganato',
            'mangakakalot',
            'bato.to'
        ];
        
        const isSupported = supportedSites.some(site => url.includes(site));
        
        if (isSupported) {
            elements.siteDot.classList.add('detected');
            elements.siteText.textContent = 'Manga reader detected';
            state.currentSite = url;
        } else {
            elements.siteDot.classList.remove('detected');
            elements.siteText.textContent = 'No manga detected';
            state.currentSite = null;
        }
    });
}

function loadStats() {
    chrome.storage.local.get(['stats'], (result) => {
        if (result.stats) {
            state.stats = result.stats;
            updateStatsDisplay();
        }
    });
    
    // Also get real-time stats from content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getStats' })
            .then(response => {
                if (response && response.stats) {
                    state.stats = response.stats;
                    updateStatsDisplay();
                }
            })
            .catch(() => {});
    });
}

function updateStatsDisplay() {
    elements.translatedCount.textContent = state.stats.translated;
    elements.cachedCount.textContent = state.stats.cached;
    elements.accuracyRate.textContent = state.stats.accuracy > 0 ? 
        state.stats.accuracy + '%' : '--';
}

function checkConnection() {
    const isOnline = navigator.onLine;
    if (!isOnline) {
        elements.statusDot.classList.add('offline');
        elements.statusText.textContent = 'Offline';
    }
    
    // Check API status
    chrome.runtime.sendMessage({ action: 'checkConnection' })
        .then(response => {
            if (response && !response.connected) {
                elements.statusDot.classList.add('offline');
                elements.statusText.textContent = 'API Error';
            }
        })
        .catch(() => {});
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function selectEngine(btn) {
    document.querySelectorAll('.engine-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.engine = btn.dataset.engine;
    
    chrome.storage.local.set({ translationEngine: state.engine });
    notifyContentScript('updateEngine', { engine: state.engine });
    showToast(`Switched to ${btn.textContent}`);
}

function showToast(message) {
    elements.toastMessage.textContent = message;
    elements.toast.classList.add('show');
    
    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}

function handleRuntimeMessages(request, sender, sendResponse) {
    switch(request.action) {
        case 'updateStats':
            state.stats = request.stats;
            updateStatsDisplay();
            break;
            
        case 'detectionUpdate':
            if (request.detected) {
                elements.siteDot.classList.add('detected');
                elements.siteText.textContent = 'Manga detected';
            }
            break;
            
        case 'requestRinnegan':
            // Content script requesting reading mode
            if (state.currentState === 'ems') {
                transitionToRinnegan();
            }
            break;
            
        case 'error':
            showToast(`Error: ${request.message}`);
            break;
    }
    sendResponse({ received: true });
    return true;
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Shift + S to toggle activation
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        handleSharinganClick();
    }
    
    // Escape to deactivate from any state
    if (e.key === 'Escape' && state.isActive) {
        if (state.currentState === 'rinnegan') {
            transitionToEMS();
        } else if (state.currentState === 'ems') {
            transitionToTomoe();
        }
    }
});

// ============================================
// VISIBILITY HANDLING
// ============================================
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Refresh state when popup reopens
        checkCurrentSite();
        loadStats();
    }
});