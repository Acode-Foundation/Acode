# Contributing to Acode

Thank you for your interest in contributing to Acode! This guide will help you get started with development.

## Quick Start Options

### Option 1: DevContainer (Recommended)

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) in VS Code or other editors that support [DevContainers](https://containers.dev/).

2. Clone and open the repository:
   ```bash
   git clone --recurse-submodules https://github.com/Acode-Foundation/Acode.git
   code Acode
   ```

3. When VS Code prompts "Reopen in Container", click it
   - Or use Command Palette (Cmd/Ctrl+Shift+P) → "Dev Containers: Reopen in Container"

4. Wait for the container to build (~5-10 minutes first time, subsequent opens are instant)

5. Once ready, build the APK:
   ```bash
   npm run build -- dev apk
   ```

   > Use any package manager (pnpm, bun, npm, yarn, etc.)

### Option 2: Docker CLI (For Any Editor)

> [!NOTE]
> If you try to use Podman, Kindly note that it would not work properly until https://github.com/containers/buildah/pull/5845 is merged/implemented in Podman.

If your editor doesn't support DevContainers, you can use Docker directly:

```bash
# Clone the repository
git clone --recurse-submodules https://github.com/Acode-Foundation/Acode.git
cd Acode

# Build the Docker image from our Dockerfile
docker build --target standalone -t acode-dev .devcontainer/

# Run the container with your code mounted
docker run -it --rm \
  -v "$(pwd):/workspaces/acode" \
  -w /workspaces/acode \
  acode-dev \
  bash

# Inside the container, install dependencies and build
npm ci
npm run build -- dev apk
```

**Keep container running for repeated use:**
```bash
# Start container in background
docker run -d --name acode-dev \
  -v "$(pwd):/workspaces/acode" \
  -w /workspaces/acode \
  acode-dev \
  sleep infinity

# Execute commands in the running container
docker exec -it acode-dev bash -c "npm ci"
docker exec -it acode-dev npm run build -- dev apk

# Stop and remove when done
docker stop acode-dev && docker rm acode-dev
```

---

## 🛠️ Manual Setup (Without Docker)

If you prefer not to use Docker at all:

### Prerequisites

| Requirement | Version |
|------------|---------|
| **Node.js** | 24 LTS |
| **npm** | Included with Node.js |
| **Java JDK** | 26 (any vendor) |
| **Android SDK** | API 37 | 
| **Gradle** | 9.8.0-rc-3 (included wrapper) |

### Environment Setup

Add these to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`):

**macOS:**
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

**Linux:**
```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

Set `JAVA_HOME` to any JDK 26 installation and add `$JAVA_HOME/bin` to `PATH`. The checked-in daemon criteria require Java 26 (any vendor), and the Gradle wrapper downloads the required Gradle version automatically. Android Gradle Plugin 9.4.1 supplies built-in Kotlin support.

The wrapper pins and verifies the Gradle 9.8.0-rc-3 distribution. Java and Kotlin still emit Java 21 bytecode for Android compatibility; the build itself runs on Java 26.

### Build Steps

Web sources follow the Proteus layout: `src/index.html` is the entry HTML and
`src/res/` contains static artwork. Rspack writes the complete web bundle to
`platforms/android/app/src/main/assets/bundle/` or `platforms/ios/runner/bundle/`.
These directories are generated and ignored by Git. The dev server serves the
selected platform's bundle; edit source files in `src/`, not generated files.

```bash
# Clone the repository
git clone --recurse-submodules https://github.com/Acode-Foundation/Acode.git
cd Acode

# Install dependencies
npm ci

# Build the APK
npm run build -- dev apk
```

The APK will be at: `platforms/android/app/build/outputs/apk/<edition>/debug/app-<edition>-debug.apk`

> [!NOTE]
> `@codemirror/lsp-client` comes from the `codemirror-lsp-client` git submodule and is installed as a local `file:` dependency, so initialize the submodule before running `npm ci` — see [Troubleshooting](#-troubleshooting).

## iOS development (port in progress)

Use macOS with Xcode 26 and an installed iOS simulator runtime, plus Node.js 24.
Copy `platforms/ios/Config.xcconfig.example` to `platforms/ios/Config.xcconfig`
once on a new checkout. This ignored file is only for local signing settings such
as `DEVELOPMENT_TEAM`; leave the team empty for simulator builds. Version, build
number, display name and bundle ID are synced from `package.json` into the Xcode
project by `dev/sync.js`; keep the icon and other public build settings in the
Xcode project.
Keep `runner/PrivacyInfo.xcprivacy` aligned with native API use: it declares file
metadata, app-local preferences and elapsed-time measurements. Both targets
also declare the local capacity checks used by filesystem requests (`E174.1`).
They include this resource automatically through the template's synchronized folder.
Check the built app's root manifest when changing target resource membership.
Use iOS 18.6 or 26.2 for StoreKit integration tests. iOS 26.3–26.5 has a
[StoreKitTest configuration regression](https://developer.apple.com/forums/thread/826971)
in command-line runs; CI selects an unaffected installed runtime.
Android SDK and Java are not needed for an iOS-only build. Install Java to run the
complete shared test suite, which also checks Android build configuration.

```bash
npm ci
npm run dev:ios
```

Like the Proteus template, this prepares the web bundle and opens Xcode. Select
the `runner` scheme, select your connected iPhone,
and press **Cmd+R** to build, sign and install. Signing uses your local
`Config.xcconfig`. `npm start -- ios` also opens Xcode after preparing the bundle.
`--device` is accepted for this flow; `--target` is reserved for scripted simulator
runs. Keep the Mac and iPhone on the same local network and allow Acode's local
network access for live reload. Swift changes require another **Cmd+R** in Xcode.

For a scripted simulator build, install and launch, pass its UUID explicitly:

```bash
xcrun simctl list devices available
npm run build -- ios dev
npm start -- ios --target=<simulator-UUID>
npm run dev:ios -- --target=<simulator-UUID>
npm run test:ios -- --target=<simulator-UUID>
```

For the SSH/SFTP and FTP/FTPS integration tests, run the same simulator command inside the
local fixture. It uses disposable keys, TLS certificates and files, binds only to loopback, and
does not execute shell commands on your Mac. The wrapper stops it after testing.
Explicit and implicit FTPS use allocated listener ports; native tests route the
port-990 profile to its listener while retaining TLS hostname verification.
These integration cases are skipped when the fixture is absent; CI includes it.

```bash
python3 -m venv .ios-build/ssh-fixture-venv
.ios-build/ssh-fixture-venv/bin/pip install -r tests/fixtures/ssh/requirements.txt
.ios-build/ssh-fixture-venv/bin/python tests/fixtures/ssh/server.py -- npm run test:ios -- --target=<simulator-UUID>
```

The iOS SSH transport uses pinned libssh2 and OpenSSL Swift packages. Xcode
resolves them automatically; keep `Package.resolved` in version control. FTP/FTPS
uses vendored curl source and shares that OpenSSL package. Source provenance,
configuration and update instructions are in
[`platforms/ios/Packages/CCurl/README.md`](platforms/ios/Packages/CCurl/README.md).
FTPS validates the server certificate and hostname; port 990 uses implicit TLS
and other ports use explicit TLS, with encrypted data connections.

`dev:ios` serves the web bundle over HTTP on the Mac's local-network address.
With a simulator `--target`, it binds to loopback and automatically rebuilds
changed Swift sources. Both modes reload JavaScript changes. The app retains its
`acode://localhost` origin. Normal API connections continue to validate TLS.

The native iOS workspace index uses the system SQLite library and the existing
`fileIndex` API. Simulator tests exercise persistent scans, incremental updates,
search/replace events, cancellation and the Search in Files UI. The index lives
in the app's `Library/NoCloud/workspace-index.sqlite`; it is regenerated from
workspaces and is excluded from backups. Remote providers keep their JavaScript
file discovery and search path.

Keep iOS keyboard-mode adaptation in `src/platforms/ios/input.ts`; it restores
field defaults for prompts and preserves input/autofill semantics. Native menu
suppression uses `AppWebView` and UIKit's menu builder. Do not remove or replace
private WebKit input views. Fullscreen tests exercise orientation and restoring
the editor/preview size after WebKit moves the WebView between containers.
Filename prompts keep corrections and suggestions disabled on iOS even in normal
keyboard mode; retain ordinary text defaults and explicit capitalization options.
On iPad, multitasking can prevent programmatic rotation. A rejected orientation
request must leave fullscreen usable and clear the temporary orientation policy.
CI reuses each edition's built tests for focused iPad startup, file-picker, sharing,
Safari, preview and native UI checks. An iPad UUID also works with `test:ios` above.

`PreviewTransferTests` verifies pending-download cancellation, restoring the editor
after closing a preview with an alert, and cache invalidation. Keep asynchronous
navigation and dialog presentation disabled after a preview is closed. For manual
preview smoke tests, serve an attachment link and an HTML file input: cancel once,
download twice, then select the first file from Acode/Downloads and compare its
bytes in the page. `PreviewUploadTests` completes a multi-file multipart upload
through the native picker's public delegate and compares the selected names, file
contents and serialized request bytes. Keep touch selection, interrupted transfers
and external Files providers in manual checks.
`PreviewDownloadTests` verifies that accepted downloads finish after the preview
is closed and released, while broken responses remove partial files. Keep accepted
transfers owned by `PreviewDownloadManager`, separate from preview UI lifetime.
`SSHTransferTests` cancels a throttled download through the public SFTP bridge and
checks reconnection. It also drops server connections during 8 MiB uploads and
downloads, verifies request rejection and disconnected state, and checks that
retries replace partial content. These tests need the loopback fixture above.
`FTPTransferTests` checks disconnecting a throttled download and recovering after
interrupted FTP/FTPS uploads and downloads in active and passive modes. Its
fixture closes disposable connections mid-transfer; keep these checks local.

iOS has one free app: the `runner` target and scheme use the bundle ID from
`package.json.appleAppId`, while `package.json.androidPackageId` selects the
Android edition. iOS always builds the free web bundle and native advertising
implementation. Version, build number and display name are synced from
`package.json` by `dev/sync.js`. Simulator builds use ad-hoc signing so Keychain
services work without a distribution certificate.

The target includes `platforms/ios/ads`, Google Mobile Ads/UMP and advertising
metadata. `ads.json` supplies ad-unit IDs through the web build configuration;
`dev/scripts/iosAds.js` separately writes the app ID and advertising metadata into
`.ios-build/App-Info.plist`. Run the normal script before building `runner` in Xcode
to prepare both the plist and web bundle. The adapted AdMob Plus code retains its
MIT notice in `platforms/ios/ads/AdMobPlus-LICENSE.txt`.

The app gathers UMP consent, then native startup waits for ATT to settle before
starting Mobile Ads; consent is checked again before startup and ad requests.
ATT waits are bounded to 30 seconds. A timeout fails startup without granting
authorization; retry/foreground checks read the OS status, and cancellation never
starts a second prompt while the original OS request is outstanding.
On physical Release builds, a verified StoreKit sandbox/Xcode environment selects
Google demo units. A failed, unverified or timed-out lookup keeps the configured
units; the lookup deadline is three seconds. Verified environments are cached for
the process; failed/unverified lookups retry after a 30-second cooldown, and
concurrent lookups share one request. Debug/simulator selection comes from
the build configuration and SDK test-device behavior. Simulator tests do not
establish TestFlight/App Review environment selection or production ad fill.

The icon picker uses UIKit alternate icons and the existing reward/Pro gates.
`runner.icon` and the fifteen alternate app-icon sets use Acode's existing
`src/res/icons` artwork, rasterized at 1024 pixels. Keep these checked-in resources
aligned when changing the artwork; no generation hook runs during builds.
The scheme includes a Settings interaction test that changes and restores
the icon, including Apple's confirmation and portrait/landscape rotation on
iPhone and iPad. It uses the local StoreKit Pro fixture to unlock the picker.
Native tests cover packaged icons
and the bridge; shared tests cover reward and purchase gates.

Calling `Bridge.setup()` again intentionally invalidates callbacks from the old
navigation and resets its services before rebuilding them for the supplied WebView.
Normal page navigation calls `reset()` and reuses the same WebView and services.

The `System` file utilities retain Android's result shapes, newline semantics and
nonrecursive deletion while restricting paths to the sandbox or granted Files
folders. Reward-pass state uses Keychain. Android file-edit intents and launcher
shortcuts are hidden on iOS; sharing and opening exported copies remain available.
`PluginInstallTests` installs the disposable ZIP in `runnerTests/Fixtures` through
the Plugins source prompt, exercising extraction, script loading, legacy APIs,
plugin context and cleanup. The fixture is test-bundle-only.
`DocumentsPickerTests` checks picker return values, cancellation and reload
cleanup; `ShareTests` checks exported copies and share-sheet cleanup. They drive
the real UIKit controllers through public delegates/completions. Keep native
Files-provider selection and destination sharing in the manual smoke checks.
Include Save to Files, opening the exported copy in Acode, and saving an edit back
to that copy. Existing-file writes must use the file's own grant without resolving
its parent folder; `internalFsWrite.test.js` covers this alongside creation flags
and write failures. Incoming share tabs intentionally do not persist in sessions.
`FilesBrowserTests` opens Documents and reads a selected file through the shared
file-browser UI and filesystem API, including iOS storage capability checks.
Keep iOS root-history restoration before device readiness so saved sessions and
folder-tree paths use the current container. Only recorded roots that remain
authorized may remap an older URL; do not infer ownership from a container UUID.
`FileURLTests` checks encoded native URLs, metadata and binary WebView fetches for
reserved filenames. Use the native `resolveLocalFileSystemURI` alias for encoded
URLs; the app's `resolveLocalFileSystemURL` wrapper encodes raw paths itself.
`FileSymlinkTests` checks that entry paths, deletion and moves preserve symlink
identity and leave targets intact. Keep target authorization on reads even when
entry metadata retains the link's name.
Reuse `FileTransfer` for coordinated copies and moves. Native FileEntry replacement
semantics are covered by `FileTransferTests`; the shared filesystem wrapper keeps
its existing conflict checks. Successful moves notify file presenters using
[`item(at:didMoveTo:)`](https://developer.apple.com/documentation/foundation/nsfilecoordinator/item(at:didmoveto:)).
`FileContentsTests` covers ranged reads, binary-reader chunks, write offsets and
negative truncation. Preserve Android's EOF and error behavior; invalid truncate
lengths must never be converted into a successful zero-length write.
`FileEntryTests` checks filesystem-root boundaries, child paths, creation flags,
invalid names and capacity requests without allocating the requested space.
For upgrade smoke tests, save a file and add it to Recents, reinstall the app
without uninstalling it, then verify editing and Recents after the container moves.

The native `Iap` service uses StoreKit 2 with the existing callback API.
`IapBridgeTests` loads `runnerTests/Iap.storekit` into StoreKitTest; the fixture
ships only in the test bundle and does not configure normal app launches.
Tests make local simulated purchases without an App Store account or real charges.
The service accepts existing SKU strings unchanged. Configure matching products
for the chosen production bundle before App Store testing. Transactions expose
`store: "appstore"` and a signed JWS in `purchaseToken`/`signedTransactionInfo`;
the backend must verify Apple transactions instead of sending them to Google Play.
The Settings page includes an iOS-only Restore purchases action. Neither billing
restrictions nor a missing App Store product enable the Android external checkout.
Until the backend supports Apple orders and refunds, iOS disables new paid-plugin
and sponsorship purchases. Free and account-owned plugins can still be installed
directly, as dependencies and from backups; unowned paid plugins are skipped during
restore. Keep those gates in `src/lib/platform.js` until the corresponding backend
flows are verified. Local Pro purchase and restoration remain enabled.
The Google Play rating action is hidden on iOS until its App Store listing is
configured. `PlatformUITests` covers Settings/About interaction and copied device
information; keep store links and restoration instructions specific to the platform.

`npm run build -- ios prod --device` builds an unsigned device app. Use
`platforms/ios/runner.xcodeproj` in Xcode to configure your team, signing and device
installation. Direct Xcode builds use the version defaults in `project.pbxproj`;
the npm scripts supply the version from `package.json`. Tests and build output are under
`.ios-build/`. `--skip-web` reuses an already-built web bundle.

See [docs/ios-port.md](docs/ios-port.md) before testing feature parity. App Store
products, iOS advertising identifiers, physical-device validation and several
native services are still pending.

## Native Android development

`platforms/android` is checked-in source: edit it directly in Android Studio. There is no platform generation or native plugin installation step.

`FileResourceTest` checks the real WebView request interceptor against local files
whose names contain URI delimiters and percent escapes. Its file IO runs through
the native background pool. Keep decoded filesystem paths as paths when creating
their file URIs; parsing them as URL text loses literal filename characters.

- `platforms/android/app/src/main/java`: Acode runtime and shared native services.
- `platforms/android/app/src/free`: advertising implementation and metadata.
- `platforms/android/app/src/store`: billing and proot assets, excluded by `fdroid`.
- `src/native`: typed native APIs imported by `src/native/index.ts`; `bridge(service)` binds promise-based actions to the shared transport.
- `src/platforms/android` and `src/platforms/ios`: platform transports using the shared callback and binary protocol.
- `platforms/ios`: iOS app, with the template's runtime in `runner` and native services in `runner/lib`. Simulator tests and native dependencies remain alongside the app. See the [port checklist](docs/ios-port.md) for remaining work.
- `platforms/android/app/src/main/java/com/foxdebug/acode/runtime/ServiceRegistry.kt`: native service registration, extended by the `free`/`paid` and `store`/`fdroid` source sets.
- `package.json`: Android package ID (`androidPackageId`), Apple app ID (`appleAppId`), version and version code.

The native APIs are available through `Bridge.exec`, `Bridge.file`, `Bridge.http`, `Bridge.clipboard` and `Bridge.websocket`. App source uses these APIs or ordinary imports. For existing third-party plugins, `src/native/pluginCompatibility.js` exposes the legacy `cordova` namespace and module names for the public native APIs, forwarding to the same implementations. Existing direct globals and `deviceready`, pause/resume and hardware-button events remain available. Keep compatibility aliases in that file; do not use them inside Acode or add Cordova dependencies. Advertising and billing APIs retain their build-edition restrictions.

Set `package.json.androidPackageId` before building or starting development:

| `androidPackageId` | Edition |
| --- | --- |
| `com.foxdebug.acode` | Paid, without AdMob |
| `com.foxdebug.acodefree` | Free, with AdMob |

The scripts and Android Studio read this value; there is no free/paid command argument.
After changing it, restart `npm run dev`. Only the selected Gradle flavor is enabled.
Use `npm run build` to refresh web assets before building directly in Android Studio, which uses the last compiled web bundle.
`npm run dev` hot-reloads JavaScript through Rspack and rebuilds the app when tracked Android source changes.
Startup probes the dev server with Proteus's three-second timeout and loads its
scripts when reachable, or uses the APK's bundled assets when unavailable. The
page stays at `https://localhost` so API CORS permissions, cookies and local
storage keep the same origin. Lazy-loaded assets use the loaded bundle's URL.
Stop and reopen the app after disconnecting the server to use the bundled build.
Gradle only compiles native source and packages the compiled web assets; no Java/Kotlin source is copied or generated by project scripts.
Paid builds exclude the AdMob native sources, Google ads/consent SDKs, manifest entries,
and JavaScript bridge. The editor uses small inactive ads APIs in paid builds, so
AdMob initialization, consent and rewarded-ad implementation are not bundled either.
Shared billing and proot remain available unless `fdroid` is requested.

```bash
npm run build -- dev apk
npm run build -- prod bundle
npm run build -- dev apk fdroid
npm run start -- android d
npm run dev -- android --target=DEVICE_SERIAL
npm test
npm run test:android
npm run typecheck
```

Release signing still reads the ignored `build.json` and keystore. Rspack compiles the native JavaScript APIs alongside the editor; there is no separate plugin build, installation, copying or source-generation command.

The familiar APK/AAB paths remain available under `platforms/android/app/build/outputs/apk/{debug,release}` and `outputs/bundle/release`.

`node dev/storage_manager.mjs y` or `n` toggles all-files access in the tracked Android manifest for the next build. Build scripts read package identity without rewriting it or reinstalling plugins.

## 🔧 Troubleshooting

### Missing local dependency

`@codemirror/lsp-client` comes from the `codemirror-lsp-client` git submodule.
If dependency installation fails because it is missing, initialize it first:

```bash
git submodule update --init --recursive
npm ci
```

## 📝 Contribution Guidelines

### Before Submitting a PR

1. **Fork** the repository and create a branch from `main`
2. **Make changes** - keep commits focused and atomic
3. **Check code quality:**
   ```bash
   npm run check
   ```
4. **Test** on a device or emulator if possible

### Pull Request Checklist

- [ ] Clear description of changes
- [ ] Reference to related issue (if applicable)
- [ ] Screenshots/GIFs for UI changes
- [ ] Passing CI checks

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting:
- Run `npm run check` before committing
- Install the Biome VS Code extension for auto-formatting

### Commit Messages

Use clear, descriptive messages:
```
feat: add dark mode toggle to settings
fix: resolve crash when opening large files
docs: update build instructions
refactor: simplify file loading logic
```

## 🌍 Adding Translations

1. Create a JSON file in `src/lang/` (e.g., `fr-fr.json` for French)
2. Add it to `src/lib/lang.js`
3. Use the translation utilities:
   ```bash
   npm run lang add       # Add new string
   npm run lang remove    # Remove string
   npm run lang search    # Search strings
   npm run lang update    # Update translations
   ```

## ℹ️ Adding New Icons (to the existing font family)
> [!NOTE]
> Acode uses SVG and converts them into a font family, to be used inside the editor and generally for plugin devs.
> 
> **Plugin-specific icons SHOULD NOT be added into the editor. Only generally helpful icons SHOULD BE added**

Many font editing software and web-based tools exist for this purpose. Some of them are listed below.

| Name | Platform |
|------|----------|
| https://icomoon.io/ | Free (Web-Based, PWA-supported, Offline-supported) |
| https://fontforge.org/ | Open-Source (Linux, Mac, Windows) |

### Steps in Icomoon to add new Icons

1. Download the `code-editor-icon.icomoon.json` file from https://github.com/Acode-Foundation/Acode/tree/main/dev
2. Go to https://icomoon.io/ > Import
3. Import the `code-editor-icon.icomoon.json` downloaded (in step 1)
4. All icons will be displayed after importing.
5. Import the SVG icon created/downloaded to be added to the Font Family.
6. On the right side, press **enable Show Characters** & **Show Names** to view the Unicode character & Name for that icon.
7. Provided the newly added SVG icon with a name (in the name box).
8. Repeat Step 5 and Step 7 until all needed new icons are added.
9. Press the export icon from the top left-hand side.
10. Press the download button, and a zip file will be downloaded.
11. Go to the Projects section of [icomoon](https://icomoon.io/new-app), uncollapse/expand the Project named `code-editor-icon`  and press the **save** button (this downloads the project file named: `code-editor-icon.icomoon.json`)

### Updating Project files for Icon Contribution
1. Extract the downloaded zip file; navigate to the `fonts` folder inside it.
2. Rename `code-editor-icon.ttf` to `icons.ttf`.
3. Copy & paste the renamed `icons.ttf` into https://github.com/Acode-Foundation/Acode/tree/main/src/res/icons
4. Copy and paste the `code-editor-icon.icomoon.json` file (downloaded in the adding icons steps) onto https://github.com/Acode-Foundation/Acode/tree/main/dev (yes, replace it with the newer one; we downloaded!)
4. Commit the changes **ON A NEW branch** (by following: [Commit Messages guide](#commit-messages))

## 🔌 Plugin Development

To create plugins for Acode:
- [Plugin Starter Repository](https://github.com/Acode-Foundation/acode-plugin)
- [Plugin Documentation](https://docs.acode.app/)

### iOS Alpine terminal

Install `brew install meson ninja llvm lld` on an Apple Silicon Mac before building iOS. The normal scripts and direct Xcode builds compile the vendored runtime automatically. `Config.xcconfig` remains limited to ignored local signing information. See [Alpine runtime documentation](platforms/ios/Alpine/README.md) for source revisions, local adaptations, licensing, filesystem layout, and compatibility limits.

The `AlpineTerminalTests`, `AlpineInteractionTests`, `AlpinePackageTests`, and `AlpineLspTests` suites exercise the real WebView bridge, installation, filesystem editing, backup/restore, interactive tabs, Node/npm, and the existing JSON language server. Installation and package tests require access to Alpine and npm repositories. Run them on a dedicated simulator because they install packages and restore its terminal filesystem. Keep physical-device performance and background validation separate from simulator results.
