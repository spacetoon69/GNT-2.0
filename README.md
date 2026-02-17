# GNT-2.0
Improved with Local AI



📁 Complete Directory Structure

```
mangekyo-translator-extension/
│
├── 📄 manifest.json                    # Extension configuration (MV3)
├── 📄 README.md                        # Documentation & setup guide
├── 📄 LICENSE                          # License file
├── 📄 .gitignore                       # Git ignore rules
├── 📄 package.json                     # Node dependencies & build scripts
├── 📄 webpack.config.js                # Bundler configuration
├── 📄 tsconfig.json                    # TypeScript configuration
│
├── 🔒 security/                        # Anti-reverse engineering layer
│   ├── obfuscation/                    # Code protection
│   │   ├── javascript-obfuscator.json  # Obfuscation rules
│   │   └── custom-encryption.js        # String/algorithm encryption
│   ├── integrity/                      # Code integrity checks
│   │   ├── checksums.json              # File hash verification
│   │   └── tamper-detection.js         # Runtime integrity monitoring
│   ├── license/                        # Licensing system
│   │   ├── license-validator.js        # License key verification
│   │   └── hardware-fingerprint.js     # Machine binding
│   └── wasm/                           # WebAssembly security modules
│       ├── core-crypto.wasm            # Compiled crypto operations
│       ├── ocr-engine.wasm             # Native OCR acceleration
│       └── wasm-loader.js              # Secure WASM loader with CSP
│
├── 🧠 core/                            # Core extension logic
│   ├── background/                     # Service Worker (MV3)
│   │   ├── service-worker.js           # Main background entry
│   │   ├── event-router.js             # Message passing coordinator
│   │   ├── api-manager.js              # External API orchestration
│   │   ├── state-manager.js            # Extension state persistence
│   │   └── lifecycle/                  # Background lifecycle
│   │       ├── install-handler.js      # Installation setup
│   │       ├── update-handler.js       # Update migrations
│   │       └── alarm-scheduler.js      # Periodic tasks
│   │
│   ├── content/                        # Content scripts (page injection)
│   │   ├── manga-scanner.js            # Manga/manhwa page detection
│   │   ├── text-extractor.js           # DOM text extraction
│   │   ├── bubble-detector.js          # Speech bubble detection
│   │   ├── overlay-injector.js         # Translation overlay injection
│   │   ├── canvas-interceptor.js       # Canvas/WebGL capture
│   │   ├── image-processor.js          # Image preprocessing for OCR
│   │   ├── mutation-observer.js        # DOM change detection
│   │   └── site-adapters/              # Site-specific handlers
│   │       ├── mangadex-adapter.js
│   │       ├── webtoon-adapter.js
│   │       ├── cubari-adapter.js
│   │       └── generic-manga-adapter.js
│   │
│   ├── offscreen/                      # Offscreen documents (MV3)
│   │   ├── offscreen.html              # Hidden document container
│   │   ├── offscreen.js                # Offscreen coordinator
│   │   ├── heavy-ocr.html              # OCR processing document
│   │   ├── heavy-ocr.js                # Tesseract.js heavy processing
│   │   ├── translation-bridge.js       # Translation API wrapper
│   │   └── image-analysis.html         # Computer vision document
│   │
│   └── shared/                         # Shared utilities
│       ├── constants.js                  # Global constants
│       ├── config-manager.js             # Settings management
│       ├── i18n/                         # Internationalization
│       │   ├── en.json
│       │   ├── ja.json
│       │   ├── ko.json
│       │   └── zh.json
│       └── utils/
│           ├── dom-helpers.js
│           ├── image-utils.js
│           ├── text-sanitizer.js
│           └── performance-monitor.js
│
├── 👁️ computer-vision/                 # CV & OCR engines
│   ├── ocr/                            # Text recognition
│   │   ├── tesseract-config.js         # Tesseract.js configuration
│   │   ├── language-data/              # Trained language models
│   │   │   ├── eng.traineddata
│   │   │   ├── jpn.traineddata         # Japanese (vertical/horizontal)
│   │   │   ├── jpn_vert.traineddata   # Japanese vertical
│   │   │   ├── kor.traineddata         # Korean
│   │   │   ├── chi_sim.traineddata     # Simplified Chinese
│   │   │   ├── chi_tra.traineddata     # Traditional Chinese
│   │   │   └── osd.traineddata         # Orientation detection
│   │   ├── preprocessors/              # Image preprocessing
│   │   │   ├── denoiser.js             # Noise reduction
│   │   │   ├── binarizer.js            # Black/white conversion
│   │   │   ├── deskewer.js             # Rotation correction
│   │   │   └── panel-segmenter.js      # Manga panel detection
│   │   └── postprocessors/             # Text post-processing
│   │       ├── manga-text-cleaner.js   # Clean OCR artifacts
│   │       ├── bubble-classifier.js    # Text type classification
│   │       └── context-restorer.js     # Fix broken sentences
│   │
│   ├── detection/                        # Object detection
│   │   ├── bubble-detector/            # Speech bubble detection
│   │   │   ├── model/                  # TensorFlow.js model
│   │   │   │   ├── model.json
│   │   │   │   └── weights.bin
│   │   │   ├── bubble-detector.js      # Detection logic
│   │   │   └── bounding-box-utils.js   # Box manipulation
│   │   ├── panel-detector/             # Manga panel layout
│   │   │   └── panel-segmentation.js
│   │   └── text-region/                # Text block detection
│   │       └── text-roi-extractor.js
│   │
│   └── translation/                    # Translation pipeline
│       ├── engines/                      # Translation providers
│       │   ├── google-translate.js
│       │   ├── deepL-adapter.js
│       │   ├── openai-gpt.js           # GPT-4 Vision for context
│       │   └── local-llm.js            # On-device translation (future)
│       ├── context-preserver.js         # Maintain narrative context
│       ├── honorifics-handler.js       # Japanese honorifics logic
│       ├── sfx-translator.js           # Sound effects translation
│       └── cache-manager.js            # Translation caching
│
├── 🎨 ui/                              # User interface components
│   ├── popup/                          # Browser popup
│   │   ├── popup.html
│   │   ├── popup.css
│   │   ├── popup.js
│   │   ├── components/
│   │   │   ├── status-indicator.js     # Connection status
│   │   │   ├── quick-toggles.js        # Feature switches
│   │   │   └── recent-history.js       # Recent translations
│   │   └── assets/
│   │       ├── mangekyo-icon.svg       # Sharingan icon
│   │       └── madara-ems.svg          # EMS active state icon
│   │
│   ├── options/                        # Settings page
│   │   ├── options.html
│   │   ├── options.css
│   │   ├── options.js
│   │   ├── pages/
│   │   │   ├── general-settings.js
│   │   │   ├── translation-settings.js
│   │   │   ├── ocr-settings.js
│   │   │   ├── appearance-settings.js  # Theme customization
│   │   │   ├── hotkey-settings.js
│   │   │   ├── advanced-settings.js    # Performance/security
│   │   │   └── about.js
│   │   └── components/
│   │       ├── setting-card.js
│   │       ├── color-picker.js
│   │       └── language-selector.js
│   │
│   ├── overlays/                       # Floating UI elements
│   │   ├── sharingan-float/            # Idle mode (3 Tomoe)
│   │   │   ├── sharingan.html          # Floating window HTML
│   │   │   ├── sharingan.css           # Animation styles
│   │   │   ├── sharingan.js            # Float behavior
│   │   │   ├── tomoe-animator.js       # Rotation animation
│   │   │   └── assets/
│   │   │       ├── tomoe-sharingan.svg # 3 tomoe design
│   │   │       ├── spinning.css        # CSS keyframes
│   │   │       └── glow-effects.css    # Visual effects
│   │   │
│   │   ├── madara-active/              # Active mode (EMS)
│   │   │   ├── madara-overlay.html     # Active state container
│   │   │   ├── madara-overlay.css      # EMS styling
│   │   │   ├── madara-controller.js    # State management
│   │   │   ├── ems-animator.js         # Eternal Mangekyo animation
│   │   │   ├── translation-hud.js      # Active translation HUD
│   │   │   └── assets/
│   │   │       ├── ems-madara.svg      # Madara EMS design
│   │   │       ├── susanoo-aura.css    # Power-up effects
│   │   │       └── scan-lines.css      # Active scanning FX
│   │   │
│   │   ├── translation-bubble/         # Translated text display
│   │   │   ├── bubble.html
│   │   │   ├── bubble.css              # Smart positioning
│   │   │   ├── bubble-renderer.js      # Render translations
│   │   │   ├── smart-positioner.js     # Avoid overlap logic
│   │   │   ├── font-matcher.js         # Match original font style
│   │   │   └── typesetting-engine.js   # Manga typesetting
│   │   │
│   │   ├── desktop-overlay/            # System-level overlay (advanced)
│   │   │   ├── native-bridge.js        # Native messaging host
│   │   │   ├── overlay-manager.js      # Multi-monitor support
│   │   │   └── electron-wrapper/       # Optional desktop component
│   │   │       ├── main.js
│   │   │       ├── preload.js
│   │   │       └── package.json
│   │   │
│   │   └── shared/
│   │       ├── drag-controller.js      # Floating window drag
│   │       ├── resize-handler.js       # Dynamic sizing
│   │       ├── transparency-manager.js # Opacity controls
│   │       └── focus-tracker.js        # Z-index management
│   │
│   └── components/                     # Reusable UI elements
│       ├── translation-card/
│       ├── loading-spinner/
│       ├── error-boundary/
│       └── toast-notifications/
│
├── 🔌 integration/                     # External integrations
│   ├── apis/                           # Third-party services
│   │   ├── translation-apis.js
│   │   ├── image-hosting.js            # Imgur, etc. for processing
│   │   └── dictionary-apis.js          # Jisho, etc.
│   ├── native-messaging/               # Desktop app communication
│   │   ├── host-manifest.json          # Native messaging manifest
│   │   ├── host-installer.js           # Install native host
│   │   └── protocols/
│   │       ├── screen-capture.proto    # Desktop capture protocol
│   │       └── overlay-control.proto   # Desktop overlay control
│   └── cloud-sync/                     # User data synchronization
│       ├── firebase-config.js
│       └── sync-manager.js
│
├── 💾 storage/                         # Data persistence
│   ├── indexeddb/                      # Browser database
│   │   ├── schema.js                   # Database schema
│   │   ├── translation-cache.js        # Cached translations
│   │   ├── image-cache.js              # Processed image storage
│   │   └── settings-store.js           # User preferences
│   ├── local-storage/                  # Simple key-value
│   │   └── session-manager.js
│   └── sync-storage/                   # Chrome sync
│       └── cross-device-settings.js
│
├── 🛡️ privacy/                         # Privacy & security
│   ├── data-handling/                  # GDPR/CCPA compliance
│   │   ├── data-retention.js           # Auto-delete policies
│   │   ├── anonymizer.js               # Data anonymization
│   │   └── consent-manager.js          # User consent tracking
│   ├── encryption/                     # Local encryption
│   │   ├── aes-gcm.js                  # AES-256-GCM implementation
│   │   ├── key-derivation.js           # PBKDF2/Argon2
│   │   └── secure-storage.js           # Encrypted storage wrapper
│   └── permissions/                    # Permission handling
│       ├── permission-monitor.js
│       └── least-privilege.js          # Minimal permission enforcement
│
├── 🧪 testing/                         # Test suites
│   ├── unit/                           # Unit tests
│   ├── integration/                    # Integration tests
│   ├── e2e/                            # End-to-end tests
│   ├── fixtures/                       # Test data (sample manga pages)
│   └── mocks/                          # API mocks
│
├── 📦 build/                           # Build configuration
│   ├── scripts/                        # Build automation
│   │   ├── obfuscate.js                # Code obfuscation script
│   │   ├── pack-extension.js           # CRX packaging
│   │   └── version-bump.js
│   ├── environments/                   # Env-specific configs
│   │   ├── development.json
│   │   ├── staging.json
│   │   └── production.json
│   └── assets/                         # Static resources
│       ├── icons/                      # Extension icons
│       │   ├── icon16.png
│       │   ├── icon32.png
│       │   ├── icon48.png
│       │   ├── icon128.png
│       │   ├── icon-active.png         # EMS active state
│       │   └── icon-idle.png           # Tomoe idle state
│       ├── fonts/                      # Custom fonts
│       │   ├── noto-sans-jp.woff2
│       │   ├── noto-sans-kr.woff2
│       │   ├── noto-sans-sc.woff2
│       │   └── manga-fonts/            # Manga-style fonts
│       └── sounds/                     # Audio feedback (optional)
│           ├── activate.mp3              # Sharingan activation
│           └── scan-complete.mp3
│
└── 📚 docs/                            # Documentation
    ├── architecture.md                 # System architecture
    ├── api-reference.md                # Internal API docs
    ├── security-whitepaper.md          # Security implementation details
    ├── privacy-policy.md               # User-facing privacy policy
    └── contributing.md                 # Developer guidelines
```

🔧 Key Implementation Details

1. Manifest V3 Configuration (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "Mangekyō Translator",
  "version": "1.0.0",
  "description": "Advanced manga/manhwa translation with computer vision",
  "permissions": [
    "activeTab",
    "storage",
    "offscreen",
    "scripting",
    "sidePanel",
    "declarativeContent"
  ],
  "optional_permissions": [
    "desktopCapture",
    "nativeMessaging"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "core/background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["core/content/manga-scanner.js"],
      "css": ["ui/overlays/shared/overlay-styles.css"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "computer-vision/ocr/language-data/*",
        "ui/overlays/*",
        "security/wasm/*",
        "assets/fonts/*"
      ],
      "matches": ["<all_urls>"]
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    "sandbox": "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; child-src 'self';"
  },
  "action": {
    "default_popup": "ui/popup/popup.html",
    "default_icon": {
      "16": "build/assets/icons/icon-idle.png",
      "48": "build/assets/icons/icon48.png",
      "128": "build/assets/icons/icon128.png"
    }
  },
  "icons": {
    "16": "build/assets/icons/icon16.png",
    "48": "build/assets/icons/icon48.png",
    "128": "build/assets/icons/icon128.png"
  },
  "options_page": "ui/options/options.html",
  "sandbox": {
    "pages": [
      "core/offscreen/offscreen.html",
      "core/offscreen/heavy-ocr.html"
    ]
  }
}
```

2. Security Architecture (Anti-Reverse Engineering)

File: `security/obfuscation/custom-encryption.js`
- String literal encryption using AES-256
- Control flow flattening
- Dead code injection
- Debug protection

File: `security/integrity/tamper-detection.js`
- Runtime checksum verification
- Code signature validation
- Debugger detection
- DOM tampering detection

File: `security/wasm/wasm-loader.js`
- Secure WASM loading with CSP compliance 
- Integrity checks for `.wasm` files
- Sandboxed execution environment

3. Computer Vision Pipeline

OCR Engine: Uses Tesseract.js with custom traineddata for manga-specific fonts and vertical text 

Detection: TensorFlow.js models for:
- Speech bubble detection (YOLO/SSD architecture)
- Panel layout analysis
- Text region extraction

Translation: Multi-engine approach with context preservation for narrative flow

4. UI States (Sharingan Theme)

Idle State (3 Tomoe): Floating, draggable, semi-transparent sharingan that spins slowly
- Activated by: Browser action or hotkey
- Visual: Red iris with 3 comma-shaped tomoe rotating
- Function: Quick access menu, status indicator

Active State (Madara EMS): Full translation interface
- Activated by: Clicking idle state or automatic manga detection
- Visual: Eternal Mangekyō Sharingan (straightened tomoe) with purple susanoo aura effects
- Function: Real-time translation overlay, scan lines animation during OCR

5. Desktop Overlay Capability

For system-level overlay (reading outside browser):
- Native Messaging Host: Communicates with optional Electron wrapper 
- Protocol: Custom protobuf for screen capture and overlay rendering
- Permissions: `desktopCapture` API for full screen access
- Transparency: Click-through capability for non-intrusive overlay

6. Performance Optimizations

- Offscreen Documents: Heavy OCR runs in isolated pages to prevent UI blocking 
- Web Workers: Image preprocessing in background threads
- Caching: IndexedDB for translation results and OCR data
- Lazy Loading: Models loaded on-demand
- Region of Interest: Only processes changed screen regions

7. Missing Critical Components Added

1. Privacy Compliance: GDPR/CCPA data handling with automatic retention policies
2. Translation Context: Maintains narrative context across pages using GPT-4
3. Honorifics Engine: Preserves Japanese nuance (san, kun, chan, senpai, etc.)
4. SFX Translator: Translates sound effects while preserving artistic style
5. Font Matching: Automatically matches original manga font styles
6. Smart Positioning: Prevents translation bubbles from covering important artwork
7. Hardware Fingerprinting: License binding to prevent unauthorized distribution
8. Cross-Device Sync: Cloud synchronization of settings and caches
9. Multi-Monitor Support: Desktop overlay spans multiple displays
10. Accessibility: Screen reader support and keyboard navigation

8. Build & Packaging Script

File: `package.json` scripts section

```json
{
  "scripts": {
    "build:dev": "webpack --mode development",
    "build:prod": "webpack --mode production && npm run obfuscate && npm run pack",
    "obfuscate": "node build/scripts/obfuscate.js",
    "pack": "node build/scripts/pack-extension.js",
    "test": "jest",
    "lint": "eslint src/"
  }
}
```

This architecture provides enterprise-grade security, professional computer vision capabilities, and the specific anime aesthetic you requested while maintaining Chrome Web Store compliance and optimal performance.