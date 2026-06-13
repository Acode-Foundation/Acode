# Acode iOS Port — Master Plan

> **Status:** Planning  
> **Last Updated:** 2026-06-11  
> **Target:** Cordova iOS (cordova-ios ~7.x)

---

## Overview

Acode is currently an Android-only Cordova app (18 plugins, 15 are Android-specific). Porting to iOS requires adding the iOS platform and implementing native Swift/ObjC equivalents for every Android-specific plugin.

### Technology Stack (unchanged)

| Layer | Technology |
|-------|-----------|
| Framework | Apache Cordova 13 |
| Editor | CodeMirror 6 |
| Terminal UI | xterm.js |
| Bundler | Rspack |
| UI | html-tag-js, Mustache, Custom Elements |
| Lang | TypeScript, SCSS, Handlebars |

---

## Phase 0: Foundation — iOS Platform Setup

**Goal:** Get a basic iOS build compiling and running with the web app shell.

### 0.1 iOS Platform Addition
- Add `cordova-ios` to `devDependencies` in `package.json`
- Run `cordova platform add ios`
- Update `config.xml` with `<platform name="ios">` block
- Add `"ios"` to `package.json` → `cordova.platforms`

### 0.2 config.xml — iOS Configuration
```xml
<platform name="ios">
  <preference name="fullscreen" value="false" />
  <preference name="SplashScreen" value="none" />
  <preference name="DisallowOverscroll" value="true" />
  <preference name="BackgroundColor" value="0xFF313131" />
  <preference name="BackupWebStorage" value="none" />
  <preference name="EnableViewportScale" value="false" />
  <preference name="AllowInlineMediaPlayback" value="true" />
  <preference name="SuppressesIncrementalRendering" value="true" />
  <preference name="deployment-target" value="15.0" />
  <preference name="orientation" value="all" />
  <preference name="StatusBarOverlaysWebView" value="false" />
  <preference name="StatusBarStyle" value="lightcontent" />

  <!-- URL scheme: acode:// -->
  <config-file parent="CFBundleURLTypes" target="*-Info.plist">
    <array>
      <dict>
        <key>CFBundleURLName</key>
        <string>com.foxdebug.acode</string>
        <key>CFBundleURLSchemes</key>
        <array>
          <string>acode</string>
        </array>
      </dict>
    </array>
  </config-file>

  <!-- Allow arbitrary loads for dev mode -->
  <config-file parent="NSAppTransportSecurity" target="*-Info.plist">
    <dict>
      <key>NSAllowsArbitraryLoads</key>
      <true/>
    </dict>
  </config-file>
</platform>
```

### 0.3 URL Scheme Handling (acode://)
- iOS doesn't support `https://` scheme handling the way Android intent filters do — use `acode://` custom URL scheme
- Implement `handleOpenURL()` in AppDelegate to catch `acode://` URLs
- Bridge URL data to JS via WebView message handler

### 0.4 Build Scripts
- Add `dev:ios` script to `package.json`
- Update `utils/scripts/dev.js` to support `ios` platform
- Update `utils/scripts/build.sh` for iOS builds
- Update `utils/scripts/clean.sh` for iOS platform
- Make hooks conditional — skip Android-specific patches on iOS:
```js
// hooks/modify-java-files.js - add at top
if (!process.env.CORDOVA_PLATFORMS?.includes('android')) return;
```

### 0.5 App Icons & Resources
- Create `res/ios/` directory with iOS app icon sizes
- Configure Launch Screen storyboard
- Add `Assets.xcassets`

### Deliverables
- [ ] iOS app builds and launches on simulator
- [ ] `acode://` URL scheme registered
- [ ] Dev mode works (hot-reload from dev server)
- [ ] App icons appear correctly
- [ ] Safe area / notch handled in CSS

---

## Phase 1: Cross-Platform Plugins (Quick Wins)

**Goal:** Enable plugins that already have iOS support or have trivial implementations.

| Plugin | iOS Status | Work Needed |
|--------|-----------|-------------|
| `cordova-plugin-device` | Ready | None — already cross-platform |
| `cordova-plugin-file` | Ready | None — already cross-platform |
| `cordova-plugin-buildinfo` | Ready | ObjC source already exists (`src/plugins/cordova-plugin-buildinfo/src/ios/`) |
| `cordova-plugin-advanced-http` | Ready | Already has iOS WKWebView handler |
| `cordova-clipboard` | Needs impl | ~20 lines Swift: `UIPasteboard.general.string` |

### Deliverables
- [ ] All 5 plugins functional on iOS
- [ ] Device info, file system, HTTP requests, clipboard, build info all work

---

## Phase 2: File System & Storage

**Goal:** Port Android-specific file system plugins to iOS.

### 2.1 cordova-plugin-sdcard → iOS
**JS API:** `copy`, `createDir`, `createFile`, `delete`, `exists`, `formatUri`, `getPath`, `getStorageAccessPermission`, `listStorages`, `listDir`, `move`, `openDocumentFile`, `getImage`, `rename`, `read`, `write`, `stats`, `watchFile`, `listEncodings`

**iOS Native Implementation:**
- File ops → `FileManager` (Foundation)
- File picker → `UIDocumentPickerViewController`
- File watching → `DispatchSource.makeFileSystemObjectSource`
- Storage listing → Documents, iCloud Drive, etc.
- Persistent access → `BookmarkData` for user-selected directories

### 2.2 cordova-plugin-system → Partial iOS Port
| Android Method | iOS Equivalent |
|---------------|---------------|
| `fileExists` | `FileManager.fileExists(atPath:)` |
| `writeText` | `Data.write(to:)` |
| `deleteFile` | `FileManager.removeItem(atPath:)` |
| `getParentPath` | `(path as NSString).deletingLastPathComponent` |
| `listChildren` | `FileManager.contentsOfDirectory(atPath:)` |
| `mkdirs` | `FileManager.createDirectory(atPath:withIntermediateDirectories:)` |
| `shareText` | `UIActivityViewController` |
| `setExec` | `FileManager.setAttributes` (posixPermissions) |
| `getFilesDir` | `NSSearchPathForDirectoriesInDomains(.documentDirectory, ...)` |
| **Skip:** | `isManageExternalStorage`, `hasGrantedStorageManager`, `requestStorageManager`, `copyToUri`, `createSymlink`, `getNativeLibraryPath`, `getRewardStatus`, `redeemReward` |

### Deliverables
- [ ] Full file browser works on iOS
- [ ] User can pick files from iOS Files app
- [ ] File watching works for external changes
- [ ] Share sheet integration works

---

## Phase 3: In-App Browser

**Goal:** Port browser and custom-tabs plugins to iOS.

### 3.1 cordova-plugin-browser → iOS (WKWebView)
- WKWebView in modal `UIViewController` with custom theme support
- API: `Browser.open(url, theme, isConsole)` 
- Navigation controls: back, forward, reload, close
- Handle console/preview mode used internally by Acode

### 3.2 custom-tabs → iOS (SFSafariViewController)
- Simple wrapper: `SFSafariViewController(url: URL)`
- API: `CustomTabs.open(url, options)`
- Supports tint color for theming
- Dismissal callback

### Deliverables
- [ ] In-app browser opens URLs with navigation controls
- [ ] Browser respects app theme (dark/light)
- [ ] `acode://` links open from browser back to app
- [ ] SFSafariViewController for external links

---

## Phase 4: Networking Plugins

**Goal:** Port FTP, SFTP, WebSocket, and HTTP Server plugins.

### 4.1 cordova-plugin-websocket → iOS
- **Android:** OkHttp WebSocket client
- **iOS:** `URLSessionWebSocketTask` (native, iOS 13+)
- **API:** `connect(url, protocols, headers, binaryType) → WebSocketInstance` with `send`, `close`, events
- Manage active connections in a dictionary keyed by instanceId

### 4.2 cordova-plugin-ftp → iOS
- **Android:** Apache Commons Net (Java)
- **iOS:** Wrap `libcurl` via C bridging for full FTP/FTPS support (active/passive modes, FTPS)
- **API:** `connect`, `listDirectory`, `downloadFile`, `uploadFile`, `deleteFile`, etc.

### 4.3 cordova-plugin-sftp → iOS
- **Android:** JSch (Java SSH)
- **iOS:** `Shout` (pure Swift, wraps libssh2) or `NMSSH` (ObjC)
- **API:** `connectUsingPassword`, `connectUsingKeyFile`, `getFile`, `putFile`, `lsDir`, etc.

### 4.4 cordova-plugin-server → iOS
- **Android:** NanoHTTPD (Java)
- **iOS:** `GCDWebServer` (lightweight embedded HTTP server for iOS)
- **API:** `server(port, onRequest, onError) → { stop, send(req_id, data) }`

### Deliverables
- [ ] WebSocket connections work (LSP, dev mode reload, terminal streaming)
- [ ] FTP connections work (connect, browse, upload, download)
- [ ] SFTP connections work (connect, browse, upload, download)
- [ ] HTTP server works (preview mode, sharing)

---

## Phase 5: App Services

**Goal:** Port IAP, auth, and plugin context systems.

### 5.1 cordova-plugin-iap → iOS (StoreKit)
- **Android:** Google Play Billing Library
- **iOS:** StoreKit 2 (iOS 15+) / SKPaymentQueue fallback
- **API:** `getProducts`, `purchase`, `getPurchases`, `acknowledgePurchase`, `consume`
- Map response codes to Android-equivalent constants
- Handle `Transaction.updates` async stream for purchase listeners

### 5.2 auth Plugin → iOS (Keychain)
- **Android:** EncryptedSharedPreferences (AES-256 GCM)
- **iOS:** Keychain Services (`SecItemAdd/CopyMatching/Update/Delete`)
- **API:** `setItem(key, value)`, `getItem(key)`, `removeItem(key)`, `clear()`
- Enable biometric protection (`kSecAccessControlBiometryAny`)

### 5.3 pluginContext Plugin → iOS
- **Android:** TEE-based permission management and secret storage
- **iOS:** Per-plugin Keychain storage (scoped by UUID), permission checks via iOS APIs
- **API:** `generate(pluginId, pluginJson) → PluginContext` with `grantedPermission`, `getSecret`, `setSecret`

### Deliverables
- [ ] In-app purchases work (fetch, purchase, restore, receipt validation)
- [ ] Auth/secure storage works via Keychain
- [ ] Plugins can store secrets and check permissions
- [ ] Biometric auth support (FaceID/TouchID)

---

## Phase 6: Terminal

**Goal:** Provide terminal/shell access on iOS — with major platform limitations.

### 6.1 iOS Reality Check
| Capability | Android | iOS |
|-----------|---------|-----|
| Fork/exec processes | ✅ | ❌ Sandbox prevents |
| Background service | ✅ (ForegroundService) | ❌ |
| PRoot / chroot | ✅ (ptrace) | ❌ Requires jailbreak |
| Linux integration | ✅ Alpine Linux | ❌ |

### 6.2 Recommended Approach: WebAssembly Shell + SSH Client

**Primary: WebAssembly Shell**
- Compile a lightweight shell (dash) to WebAssembly via Emscripten
- Run entirely in WebView's JS context
- Integrate with existing xterm.js
- Full sandbox — App Store compliant
- File system commands work on cordova-plugin-file's virtual FS

**Secondary: SSH Client**
- Connect to remote servers for full terminal
- Reuse SFTP plugin's SSH infrastructure
- xterm.js + WebSocket streaming

### 6.3 Terminal Plugin Adaptation
- `Executor.spawnStream(cmd, callback)`: WebAssembly-based or limited `Process` class (iOS 14+)
- `Executor.start(command, onData, alpine=false)`: WASM commands; `alpine=true` → error
- PRoot plugin: Completely omitted on iOS

### Deliverables
- [ ] xterm.js terminal UI rendered and functional
- [ ] WASM shell provides basic Unix commands (ls, cd, cat, grep, mkdir, rm)
- [ ] File system commands work on app sandbox
- [ ] SSH client connects to remote servers
- [ ] PRoot gracefully disabled on iOS

---

## Phase 7: iOS Polish & Release

### 7.1 UI Adaptations
- Safe area insets: `env(safe-area-inset-*)` CSS variables for notch/home indicator
- Keyboard avoidance: observe `keyboardWillShow/Hide`, adjust editor viewport
- iOS momentum scrolling: `-webkit-overflow-scrolling: touch`, `overscroll-behavior`
- Native text selection: test with CodeMirror's custom selection system
- Haptic feedback: `UIImpactFeedbackGenerator` for key interactions

### 7.2 Performance (No JIT in WKWebView)
- WKWebView lacks JIT compilation (only Safari has it)
- Mitigation: optimize CodeMirror viewport, reduce DOM updates, use Web Workers
- Monitor memory warnings, handle `didReceiveMemoryWarning`

### 7.3 Build & CI
- Add iOS build job to GitHub Actions (requires macOS runner)
- Fastlane lanes for iOS: build, test, TestFlight upload
- Code signing: dev cert, distribution cert, provisioning profiles

### 7.4 App Store Compliance
- Privacy Manifest (`PrivacyInfo.xcprivacy`) for iOS 17+ SDK
- Plugin downloads must be JS-only (no native code loading)
- IAP must use StoreKit exclusively
- No executable code download (App Store §2.5.2)

### Deliverables
- [ ] UI renders correctly on all iPhone/iPad sizes
- [ ] Keyboard behavior matches iOS expectations
- [ ] CI builds iOS on every push
- [ ] App passes App Store Review
- [ ] TestFlight distribution works

---

## Plugin Status Matrix

| # | Plugin | Android | iOS | Phase | Complexity |
|---|--------|---------|-----|-------|-----------|
| 1 | cordova-clipboard | ✅ | 🔧 | P1 | Low |
| 2 | cordova-plugin-device | ✅ | ✅ | P1 | None |
| 3 | cordova-plugin-file | ✅ | ✅ | P1 | None |
| 4 | cordova-plugin-server | ✅ | 🔧 | P4 | Medium |
| 5 | cordova-plugin-ftp | ✅ | 🔧 | P4 | High |
| 6 | cordova-plugin-sdcard | ✅ | 🔧 | P2 | High |
| 7 | cordova-plugin-advanced-http | ✅ | ✅ | P1 | None |
| 8 | cordova-plugin-websocket | ✅ | 🔧 | P4 | Medium |
| 9 | cordova-plugin-buildinfo | ✅ | ✅ | P1 | None |
| 10 | cordova-plugin-browser | ✅ | 🔧 | P3 | Medium |
| 11 | cordova-plugin-sftp | ✅ | 🔧 | P4 | High |
| 12 | terminal (exec) | ✅ | ⚠️ | P6 | Very High |
| 13 | pluginContext | ✅ | 🔧 | P5 | Medium |
| 14 | auth | ✅ | 🔧 | P5 | Low |
| 15 | proot | ✅ | ❌ | P6 | N/A |
| 16 | cordova-plugin-iap | ✅ | 🔧 | P5 | Medium |
| 17 | custom-tabs | ✅ | 🔧 | P3 | Low |
| 18 | cordova-plugin-system | ✅ | 🔧 Partial | P2 | High |

---

## JS Code Changes Needed

### Platform Detection (in `src/lib/config.js` or similar)
```js
const isIOS = device.platform === 'iOS';
```

### Conditional Feature Flags
```js
if (device.platform === 'iOS') {
  // Disable PRoot, use SFSafariViewController, skip Android storage dialogs
  // Handle iOS-specific file URI formats
}
```

### File System (`src/fileSystem/`)
- `internalFs.js` → App sandbox Documents
- `externalFs.js` → User-selected directories via bookmarks
- Ensure `cordova.file.dataDirectory` maps correctly

### Keyboard/Input
- Android hooks patch WebView for keyboard suggestions — not needed on iOS
- Use `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"` HTML attrs

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| No JIT in WKWebView | Slower CodeMirror | Optimize viewport, Web Workers, limit DOM |
| No fork/exec | No real terminal | WASM shell + SSH client |
| No PRoot | No Linux sandbox | Feature flag off, graceful degradation |
| App Store rejection | Plugin system flagged | JS-only plugins, no native code loading |
| WKWebView memory | Crashes on large files | Memory monitoring, lazy loading |
| IAP migration | Cross-platform purchase sync | Server-side receipt validation |
| SFTP/FTP complexity | High effort | Ship FTP first, SFTP as update |

---

## Open Questions

1. **Cordova vs Capacitor?** Capacitor has better iOS tooling but requires significant refactoring. Stay with Cordova for now.
2. **Minimum iOS version?** iOS 15 seems right — supports StoreKit 2, Swift concurrency, URLSessionWebSocketTask.
3. **iPad multi-window?** Nice-to-have, not critical for MVP.
4. **iCloud sync?** Can leverage native iOS file provider integration.
5. **Apple Silicon Mac?** iPad app runs automatically on M-series Macs — test for keyboard/mouse UX.
6. **Terminal scope?** SSH client is practical; WASM shell is ambitious but App Store safe.
7. **Free vs Paid?** Same two-product strategy: `com.foxdebug.acode` + `com.foxdebug.acodefree`.

---

## Estimated Effort

| Phase | Description | Est. |
|-------|-------------|------|
| P0 | Foundation & iOS Setup | 1-2 weeks |
| P1 | Cross-Platform Plugins | 1 week |
| P2 | File System & Storage | 2-3 weeks |
| P3 | In-App Browser | 1 week |
| P4 | Networking (FTP, SFTP, WS, Server) | 3-4 weeks |
| P5 | App Services (IAP, Auth, PluginContext) | 2-3 weeks |
| P6 | Terminal | 2-4 weeks |
| P7 | Polish & Release | 2-3 weeks |
| **Total** | | **14-21 weeks** |
