# iOS port tracking

## Current iOS app identity

iOS now has one free app: bundle ID from `package.json.appleAppId`, Xcode
target/scheme `runner`, and test target `runnerTests`. Both native code and the
web bundle include the free advertising implementation regardless of Android's
`androidPackageId` selection.
Build commands and configuration are in [CONTRIBUTING.md](../CONTRIBUTING.md).
The validation history below includes runs made before this consolidation;
references to separate paid/free builds describe those earlier runs.


The iOS port aims to preserve Acode's editor and public native/plugin APIs.
Android remains supported. This checklist records unfinished work; a successful build alone does
not establish feature parity.

`CustomTabs.open` options `authTabId` and `reportLifecycle`, and the native
`CustomTabs` action `close`, are iOS-only. Android ignores those options and
rejects `close`. Call `Bridge.exec(success, error, "CustomTabs", "close", [authTabId])`
to dismiss a matching tab; a stale ID leaves the active tab open. With
`reportLifecycle: true`, the callback receives `opened` and `closed` events;
the `lib/customTab` promise resolves on the first event only.

The template runtime stays in `platforms/ios/runner`, with native services under
`runner/lib`. `Config.xcconfig` is ignored and reserved for local signing settings;
public icon settings live in `runner.xcodeproj/project.pbxproj`, while version,
build number, display name and bundle ID are synced into it from `package.json`
by `dev/sync.js`.
The shared `runner/PrivacyInfo.xcprivacy` declares file metadata access in the
sandbox and user-selected folders (`C617.1`, `3B52.1`), app-local preferences
(`CA92.1`), elapsed-time measurements for search deadlines (`35F9.1`) and requested
filesystem capacity checks (`E174.1`), following
[Apple's required-reason API categories](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype).
Both app targets package it at the bundle root. Bundled SDKs retain their own
privacy manifests; production privacy disclosures still need review alongside
the configured account and advertising services.

- [ ] Build, run and development scripts; Xcode resources and app metadata
- [ ] Startup, lifecycle, keyboard, safe areas, orientation and native UI
- [ ] Sandbox file operations, encodings, file watching and workspace search
- [ ] Files picker, persistent folder access, incoming files and sharing
- [ ] Native HTTP, streaming, downloads, cookies, TLS and WebSockets
- [ ] Local preview server, browser, custom tabs and embedded WebViews
- [ ] FTP/FTPS, SFTP, saved credentials, host-key verification and remote shells
- [ ] Authentication and plugin contexts with Keychain-backed secrets
- [ ] StoreKit purchases/restoration and supported advertising APIs
- [ ] iOS capability checks in menus, settings, commands and runtime providers
- [ ] Regression tests, simulator smoke tests, CI and contributor documentation

Android intents/package launching, APK updates, all-files access permissions
and Android battery controls remain platform exclusions. The main menu offers
Exit on iOS through `exit(0)`; Apple discourages programmatic termination, so
App Review may flag it.
Local terminals and native language-server processes use the ARM64 Alpine
runtime described in [platforms/ios/Alpine/README.md](../platforms/ios/Alpine/README.md).
It preserves Acode's terminal UI, AXS protocol and shell initialization script;
Linux package compatibility is bounded by the emulator, Node JIT restrictions,
and iOS process lifetime. Browser-based and remote language servers remain available.

The native registration audit matches 22 of Android's 23 services to iOS services.
`Executor` and `BackgroundExecutor` now execute inside Alpine. `CrashHandler`
only installs Android's uncaught-exception handler and starts its crash activity,
with no public bridge actions. Launcher-shortcut, package-launch and
storage-manager controls remain gated in commands, menus and settings. Of the
54 Android `System` dispatch actions, the eight absent from the iOS service and
JavaScript proxy are the four launcher-shortcut actions, `launch-app`,
`getNativeLibraryPath`, `setExec` and `requestStorageManager`. These are deliberate
platform exclusions. `set-input-type` is handled by the iOS JavaScript proxy.
This checks registration and dispatch coverage; behavior validation is recorded
below and still has the device and production gaps listed at the end.

The navigation stack also respects the app-exit capability: an empty stack on iOS
does not offer an exit confirmation or invoke exit callbacks. Stacked pages and
dialogs still dismiss normally, and Android retains its existing confirmation and
close-callback behavior. Three regression cases reproduced the missing guard;
60 shared navigation, app-icon and quick-tools tests pass after the fix. Four
focused native checks pass per edition, covering real dialog dismissal, iOS
settings, file-context-menu events with tap feedback, and quick-tools saving.

External documents use Apple's document picker and security-scoped bookmarks;
there is no unrestricted filesystem permission on iOS. Services unavailable on a
platform must reject calls promptly instead of leaving promises pending.
`App.overrideButton` and `App.clearHistory` reject on iOS through both
`Bridge.exec` and the legacy `CoreAndroid` compatibility entry point. App bridge
regressions cover those error callbacks alongside shared editor startup.

## Verified locally

The default iOS start/dev flow follows Proteus by preparing the web bundle and
opening Xcode for device selection, signing and installation. An explicit
simulator `--target` retains scripted build/install/launch. This fixes the default
flow attempting `simctl install booted` and failing with exit 148 when no simulator
was running. Device live reload uses the Mac's LAN address; explicit simulator
development continues to use loopback.

The last full contributor runs passed 100 paid native tests plus one paid UI
test, and 105 free native tests on iOS 18.6, including local SSH, FTP/FTPS and
StoreKit fixtures. Neither run skipped tests. Both targets also rebuild with the
app privacy manifest verified in their packaged resources. The latest full shared
JavaScript run passed 793 tests across 99 files; its one conditional Java
native-search test passed separately with Android Studio's JDK on `PATH` (794
tests in total). The earlier 784-test baseline also passed TypeScript and
translation checks. Later focused native checks are recorded below.
StoreKit coverage uses local simulated transactions; it does not verify production
products or the purchase backend. Advertising checks verify the free bridge,
consent gating, load cancellation, banner layout and paid-impression payloads;
the paid app excludes the SDK classes, resources and metadata.

The simulator suite currently exercises editor startup, safe-area layout, reading,
editing and saving files, watching coordinated writes, worker loading, incoming
files with Unicode and reserved characters, sandbox traversal protection,
encodings, HTTP and WebSocket payloads, streaming backpressure, API cookies and
uploads, sign-in challenge/state validation, callback isolation, and Keychain
namespace isolation. These are simulator checks, not physical-device coverage.

Native file URLs escape literal `?` characters in paths, preserving real query
parameters and Android content-provider URLs. Focused checks pass 27 shared tests
and seven iOS tests per edition, including binary WebView fetches from nested
reserved-character paths and worker scripts with `#`, `?`, percent and Unicode
names. Encoded native URLs use `resolveLocalFileSystemURI`; the app's
`resolveLocalFileSystemURL` wrapper expects raw paths and applies `Url.safe`.

File entries preserve symlink names and paths. A native regression reproduced
deletion and renaming affecting the target instead of the link. Removal and moves
now act on the link, while reads still validate the target against authorized
roots. Tests cover direct bridge calls, public entry resolution, child lookup,
directory listing, metadata, WebView reads, destination collisions, dangling
relative links and denied access to ungranted targets. The 24 affected native
checks pass per edition, including file-picker, sharing, archive and plugin
installation flows. The full runs above include these filesystem regressions.

The native `FileEntry.copyTo` and `moveTo` APIs replace existing files and empty
directories, matching Android's native contract. Nonempty directories, mismatched
types, copying an item onto itself and copying a directory into itself reject
without changing contents. `FileTransfer` coordinates both paths and stages
replacement copies before replacing the destination; the existing System copy
utilities reuse it. Regression checks compare 2 MB binary transfers, verify an
unreadable source leaves the existing destination intact, and receive file-watch
notifications after moves. The shared `fsOperation` wrapper retains its separate
policy of rejecting existing destinations before calling these native APIs.
All 20 focused transfer, symlink, file-service, System utility and editor checks
pass in both editions.

Native reads treat a negative end offset as EOF and bound ranges to the file's
size. Writes beyond EOF append without introducing zero-filled gaps, and negative
truncation rejects with Android's error code instead of emptying the file.
`FileContentsTests` reproduces those mismatches and checks recovery after a failed
truncate. It also verifies all byte values through array-buffer, binary-string
and data-URL reads, including sliced files spanning the default native chunks.
All 14 focused content, file-service, URL and editor checks pass in both editions.

Directory entries interpret absolute child paths from their filesystem root and
normalize relative parent traversal within that root. A root's parent is itself.
Creation, copy and move reject colon-containing names with Android's encoding
error. Filesystem requests check positive size requirements against available
space and report quota errors without allocating storage. `FileEntryTests`
exercises these contracts through the public API, including exclusive creation,
type mismatches and preserving existing contents after rejected operations.

Android regression checks passed native unit tests, production web bundling and
debug APK builds for paid, free and paid F-Droid. An isolated API 37 emulator ran
all three APKs and verified startup, editor save/read, internal file URLs, and
retained terminal, running-process, exit, edit-with, shortcut and sharing actions.
This exposed a decoded-path bug in Android's file resource handler: `#` and other
reserved filename characters were reparsed as URI syntax, causing a 404. Local
paths now use `Uri.fromFile`; a native regression test checks exact binary bytes
for plain names, reserved characters and a literal `%23` name. Content-provider
URI handling is unchanged. These checks do not replace Android physical-device
or minimum-API validation.

Native text comparisons use exact UTF-16 code units, matching Android and
JavaScript. Unicode-normalization changes must count as edits even when the text
looks identical. A bridge regression reproduced missed changes with Swift's
canonical-equivalence comparison, then passed after the fix for composed and
decomposed accents, Hangul, reordered combining marks and UTF-8/UTF-16 files.
The comparison, existing System utilities and editor-save checks pass in both
editions; the free run also covers the archive round trip described below.

Files pickers preserve the existing API result types: image and folder selection
return a URI, while document selection returns metadata. Cancellation, concurrent
requests and WebView reloads resolve or release the pending request, and stale
picker callbacks cannot complete a newer request. Security-scoped access is owned
by the shared file service; repeated selection refreshes the same bookmark, and
sandbox selections do not create redundant bookmarks. Native integration tests
cover these contracts using the picker's delegate; a separate simulator UI check
selected a folder, created an HTML file and opened it in the editor. Third-party
providers and iCloud still need verification.

Saved file references survive app-container relocation. iOS records previously
authorized root paths, resolves older native file URLs against the current grant,
and updates Acode's sessions, Recents, saved storages and expanded-tree paths before
device readiness. Missing grants are not restored by path history. Native tests
cover several relocations, nested roots, boundary checks and unavailable grants;
shared tests cover startup ordering, encoded paths and storage-write failures.
A two-install simulator check reproduced the original permission error and then
verified both the retained native URL and the updated Recents entry with the fix.
External-provider moves/revocation and signed-device upgrades remain unverified.
The relocation lookup uses a separate internal bridge action; the original
`File.requestAllPaths` response and public filesystem API shapes are retained.

Sharing exports an isolated temporary copy with the requested filename. The
native test checks binary content, concurrent presentation rejection and cleanup
after cancellation or WebView reload. Reload dismisses the old sheet as well.
An iOS 18.6 interaction check exported a document through Save to Files, previewed
it in Files, then opened and edited that copy in both Acode editions. The original
28-byte document stayed unchanged; the external copy contained the exact 63 bytes
expected after both edits. This reproduced a save failure caused by requesting the
ungranted parent folder of an individually granted document. Existing-file writes
now resolve the file directly; new-file creation still requires its parent folder.
The 49 focused shared tests cover grant boundaries, writer errors and creation
flags; 19 affected native checks pass per edition, with the final six startup/editor
checks also verifying directory type errors. Incoming share tabs retain Android's
temporary-session behavior. Other share destinations, third-party providers,
iCloud and physical-device grants remain unverified. The file browser omits
unavailable Android storage roots on iOS. Terminal Public is shared with Alpine. Acode's Documents
folder opens directly; a simulator test browses it and reads a selected file
through the shared filesystem API.

A separate normal-app check created an On My iPhone folder through Files, granted
that folder to Acode, then created, edited and renamed a project file. The renamed
tab and project restored after force quit; another edit saved through the restored
folder grant. The final external file matched all 43 expected bytes. This covers
the local Files provider on the iOS 18.6 simulator, not iCloud or other providers.

SSH/SFTP uses libssh2 through a pinned Swift package, with credentials and host
keys stored in Keychain. The existing JavaScript file browser and remote-terminal
APIs are retained. Tests cover password authentication, encrypted RSA PEM and
Ed25519 OpenSSH private keys, redacted profile metadata, preserving saved secrets
during edits, unknown-host prompt cancellation, persisted host trust, changed-key
rejection, cancellation of a stalled handshake, and timeout invalidation. SFTP tests cover Unicode and
reserved filenames, directory creation/listing/stat/rename/removal, relative and
broken symlinks, permission errors, and streamed binary uploads/downloads. Shell
tests verify PTY resize, Unicode input/output, combined command output, and exit
status and quiet commands that outlive the connection deadline. Connection
timeouts retain Android's 10-second default and 1–30-second range; running commands
have no fixed deadline and can be stopped by closing the connection. These checks
use a disposable loopback server; real remote servers and reconnects after iOS
background suspension need further coverage.

A throttled 8 MiB SFTP fixture also checks closing a connection after data has
started arriving. The original bridge request must report cancellation within
five seconds, `isConnected` must clear, and reconnecting must download the next
file without returning stale partial content. Both editions pass this check.

A separate server-disconnect check interrupts both an 8 MiB SFTP download and
upload after transferring a real file prefix. Each public bridge request must
reject within five seconds and `isConnected` must clear. Reconnecting downloads
the next file over the partial local file and retries an upload over the partial
remote file, verifying the recovered contents exactly. Nine focused SSH/SFTP
checks pass in each edition without app-code changes. The loopback fixture
confines these failures to dedicated filenames and disposable connections; it
does not simulate iOS process suspension or a physical-device network change.

Both editions also passed a manual Home-screen round trip on the iPad iOS 18.6
simulator with an SSH shell open and an 8 MiB SFTP download in progress. The app
entered the background before the full file arrived, emitted pause/resume events,
and returned with the SFTP connection intact. Shell input/output worked before
and after the transition, and every downloaded byte matched the fixture. The
free edition returned to its existing Split View session with Files. A temporary
native harness verified these outcomes while the simulator UI drove app switching;
it is not part of the unattended suite. This checks app switching, not physical
device suspension, process termination or network changes.

FTP/FTPS uses vendored curl 8.22.0 source with the existing OpenSSL dependency.
The public `Ftp` bridge and JavaScript file-browser API are retained. Tests cover
active and passive connections, Unicode/reserved filenames, hidden files, empty
directories, file metadata and symlinks, working-directory changes and connection
reuse, raw command replies, recursive deletion, binary uploads/downloads,
reconnects, cancelled handshakes, invalid credentials, and command-injection
rejection. FTPS tests require encryption on both control and data channels and
verify trusted certificates, untrusted certificates and hostname mismatches.
Normal connections use Apple's certificate trust store; tests supply a
disposable CA only to the internal native client. Port 990 selects implicit TLS.
The fixture exercises both TLS modes with active and passive binary transfers,
untrusted certificates and hostname mismatches. Its implicit listener uses an
allocated loopback port; an internal client override routes the port-990 profile
there without changing its TLS mode or certificate hostname. All seven focused
FTP bridge, transport and transfer-lifecycle tests pass in both editions.
An 8 MiB throttled download is interrupted through the public `disconnect` action;
the original request rejects within five seconds and reconnecting replaces the
partial local file with the next download. Separate fixture failures drop a
download's data connection and an upload's control/data connections before
completion. FTP, explicit FTPS and implicit FTPS all reject those transfers and
recover for subsequent uploads/downloads in active and passive modes. Actual
remote servers, background suspension and physical-device LAN access remain to
be checked.

Dependency revisions are recorded in Xcode's `Package.resolved`; third-party
license notices ship in `runner/SSH-Licenses.txt` and `runner/FTP-Licenses.txt`.
Curl source provenance and build configuration are documented in
`Packages/CCurl/README.md`. The contributor guide describes the optional local
remote-server fixtures, which CI starts for the iOS test suite.

The preview tests exercise an unsaved editor file through the existing JavaScript
request handler, console events, responsive viewport sizing, parallel binary
responses, UTF-8 text, HEAD, ETags, byte ranges and server restart. Preview pages
use a separate WebKit store and cannot call the app's native bridge. Plugin
WebViews retain hidden/fullscreen modes, document-start messaging, restricted
navigation, HTML reloads and state across hide/show; closing destroys the instance.
The HTTP parser is shared with Proteus's embedded proxy. Request bodies currently
have a 64 MiB limit, with 64 concurrent connections and a 60-second idle timeout.

Preview restarts preserve the new request handler while the old iOS listener is
still shutting down. The shared Run action sends stop, start and handler
registration without waiting for each callback; rejecting registration during
shutdown left the next preview unable to load. An automated regression reproduces
that sequence across four server generations and verifies each response comes
from the replacement handler. Five focused server, parser and editor-preview
checks pass in each edition.

Both editions also passed a manual preview-to-Safari round trip on the iPad iOS
18.6 simulator, including the free app's Split View session. Safari visibly loaded
the unsaved HTML page through Acode's actual preview server. Returning to Acode
preserved the unsaved editor text, closed the original preview and successfully
opened a fresh preview. This interaction exposed the restart bug above and
passed after its fix. The temporary native harness and Safari fixture tabs were
removed afterward. Long-running external previews and physical-device suspension
remain unverified.

Additional preview regressions cover closing an unanswered download prompt,
restoring the editor after dismissing the preview and its alert together, and
cancelling navigation queued behind asynchronous cache removal. Closed hidden
WebViews cannot reuse the app's presenter for late dialogs. A resource-cache test
verifies cache reuse before refresh and fresh content after disabling the cache.
The six focused preview and plugin-WebView tests pass in both paid and free builds.
Accepted downloads use an app-owned `PreviewDownloadManager` with Apple's
[`WKDownload`](https://developer.apple.com/documentation/webkit/wkdownload), so they
retain their original request and continue after the preview closes, matching
Android's download ownership. Closing still cancels an unanswered confirmation.
An integration test holds a 16 MiB response open, closes and releases the preview,
then verifies the completed file byte for byte and its completion alert in the
editor. A truncated response reports failure and removes its partial file. These
checks run alongside the existing prompt, cache and upload tests in both editions.
A simulator UI check cancelled a download, saved the same binary attachment twice
without overwriting it, then selected the first download through the native Files
picker. Both saved files and the page's `File.arrayBuffer()` matched the original
bytes. The temporary interactive test and its files were removed afterward.
A further paid simulator UI check selected two files and sent a multipart POST to
a loopback server; its response matched the full serialized request byte for byte.
`PreviewUploadTests` now automates the complete round trip in both editions through
the native document picker's public delegate. It verifies multiple selection,
binary and UTF-8 file contents, exact on-disk filenames and the complete multipart
request body. Filename assertions use the on-disk spelling because iOS can normalize
Unicode during file creation. The test removes its disposable files afterward.
Both editions passed a further manual Home-screen round trip on the iPad iOS 18.6
simulator during a 16 MiB WebKit download. A temporary native harness held the
HTTP response open until the app entered the background, then completed it before
the app returned. After resuming, it verified the completion alert, every saved
byte, retained preview page state and a fresh HTTP request. The simulator UI drove
the Home/app-switcher transitions; the harness used the existing in-app HTTP
fixture under XCTest. The temporary harness was removed from the test target
afterward. This does not establish physical-device suspension or background
execution behavior.
Provider-backed files, app suspension/termination and physical-device background
downloads remain unverified.

On iOS, file workspaces now use the public native `fileIndex` API and the existing
Search in Files UI. The SQLite-backed index preserves streamed scan events,
paginated queries, incremental subtree updates, cached text, dirty invalidation,
unsaved editor overlays, search options and literal replacement events. Remote
providers retain their JavaScript discovery/search fallback; Android SAF URLs
remain Android-only. Replacement produces editor text and does not write files.

Tests cover a 1,200-file workspace, persistence across index instances, cancelled
scan rollback, exclusions/hidden files, symlink cycles, Unicode and reserved
filenames, SQL wildcard escaping, UTF-16/BOM detection and match positions,
searching open `.env` files, binary detection, large files without truncation,
and cancellation through the public bridge. Search retains the 200-match batch,
5,000-match-per-file cap, two-second regex deadline, 512-Ki-character text cache,
and 16 MiB direct/128 MiB explicitly included file read limits. Larger real
projects, external Files providers, iCloud materialization and physical-device
performance still need validation.

Testing on iOS 18.6 exposed an unbounded ancestor walk in workspace scans.
Traversal now stops at the filesystem root or a non-shortening parent path and
checks cancellation while walking ancestors. The existing scan, symlink-cycle,
rollback and search tests pass on the minimum supported runtime.

ZIP browsing, extraction, creation and plugin installation use the existing
JSZip implementation. A simulator integration test in both editions selects files and a folder
in Acode's file browser, compresses them and imports the ZIP through the native
picker delegate. It verifies a 32 MiB binary payload, Unicode/reserved filenames,
empty files/directories and a second extraction that preserves the first. It also
uses the normal Cancel button after a real native write and verifies that only the
partial import is removed. The fixture delays that write's completion callback
until Cancel appears; compression, native I/O and cleanup use the actual app path.
The expanded workflow passes in both editions on the iOS 18.6 iPhone simulator.
Plugin installation tests install a local archive through the Plugins source
prompt, verify nested binary assets and an empty directory, load its script and
legacy Cordova API calls, check its isolated plugin context and Installed-list
entry, then unmount and remove it. A separate paid simulator UI check installed
the same disposable fixture through Plugins → Local → Select document and the
native Files picker, with the same content and API assertions. Its temporary test
and installed fixture were removed afterward. External-provider archives,
process interruption and physical-device memory limits remain unverified.

The remaining supported `System` file utilities preserve Android's public return
types, newline-appending text writes, nonrecursive deletion and relative symlinks.
Binary copy and asset extraction use coordinated writes and preserve an existing
destination when reading the source fails. Checks cover dangling links, sandbox
escapes, Unicode paths and the JavaScript wrappers. Legacy SHA-256 text checksums
and cache clearing are supported; clearing the WebView cache keeps app storage.

All sixteen existing app icons are packaged for iPhone and iPad, including Acode's
default artwork. UIKit changes the launcher icon in place. The shared picker
retains reward/Pro requirements and persistence, and omits Android's app-exit
warning on iOS. New ad-free passes are discontinued. Existing earned time remains
active until its stored expiry, with native Keychain state preserved.
Native tests verify packaged icon metadata and actual DOM hit targets after
startup. A paid-edition UI test changes and restores the icon through Settings,
acknowledging Apple's confirmation. An iOS-only centering rule keeps WebKit's
accessibility bounds aligned with the picker; Android retains its original CSS.

Android edit-in-place intents and pinned launcher file shortcuts are absent from
iOS menus and commands. Direct unsupported intent calls reject explicitly; Share
and Open with still export copies through the system share sheet. Android's
uncaught-Java-exception crash activity has no iOS equivalent; native fatal crashes
use Apple's crash reports rather than attempting to open UI during a crash.

About shows WebKit information without an Android store link, and copied device
reports identify iOS. Plugin minimum-version warnings retain the installation
restriction without linking to Google Play. The Google Play rating action is hidden
until an iOS App Store listing is configured. Pro purchase instructions describe
restoring with the same Apple Account. The two new translation keys have English
defaults across locales. `PlatformUITests` verifies Settings, About and diagnostics
in both editions, including delegated clicks and hidden-setting search results.

Custom tabs use Safari and external links use the system URL handler. Safari owns
its title and toolbar appearance; iOS 26 deprecates the toolbar tint preference.
See [Apple's API documentation](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller/preferredbartintcolor).

The paid build also passed a manual iPhone simulator check for startup, the live
plugin catalogue, keyboard touch input, editor resizing, and portrait/landscape
safe areas. `dev:ios` was verified to install the app, reload JavaScript edits,
and rebuild/relaunch for Swift edits.

Focused iPad Pro 13-inch (M4), iPadOS 18.6 runs passed 18 native tests per edition:
startup, safe areas, editor/file operations, Files browsing, document-picker
contracts, share-sheet cleanup, Safari, preview/console/viewport controls, input
attributes, fullscreen policy, iOS navigation and quick-tools touch/click saving.
The file-menu fixture waits for loading and dismissal overlays to finish before
the next interaction. CI includes the expanded native set for the unified iOS app.
The earlier paid Settings touch test also changes and
restores the app icon while rotating between portrait and landscape. CI runs
these focused checks after the iPhone suite, reusing its existing build.
The paid edition passed the earlier 15 native checks and rotation/icon interaction
test on a separate iPadOS 26.5 simulator as well.

Manual free-edition checks on iPadOS 18.6 cover tracking denial, software-keyboard
typing, simulated hardware-keyboard input, and editor rotation in Split View with
Files. Switching back to the software keyboard initially left the caret below the
visible editor until another keystroke. The shared handler now uses iOS's native
keyboard height, including when a hardware keyboard is reported, and recognizes
dismissal after rotation without relying on the largest previous window height.
The same Split View interaction now reveals the caret without typing. Five shared
regression cases cover these transitions, the compact keyboard toolbar, and
unchanged Android behavior; 40 focused shared tests pass. A native WebKit resize
fixture verifies the keyboard event and visible caret, alongside the three system
UI tests in both iPad editions. The keyboard fixture also passes on iPhone in both
editions. CI includes the new keyboard fixture for iPad.
Divider dragging did not respond to the automation, so arbitrary window resizing
and physical-keyboard behavior remain unverified.

The iOS input adapter implements the existing keyboard-mode APIs with WebKit's
`autocorrect`, `spellcheck` and `writingsuggestions` attributes. Both no-suggestion
modes use the same iOS policy; normal mode restores each field's own attributes.
Dynamic fields are included without changing their input type, autofill, value or
selection. This replaces the template's success-only keyboard handler and private
WebKit subview removal. See [WebKit's writing-suggestions documentation](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/).

Filename prompts disable automatic capitalization, correction and suggestions on
iOS. An interactive check reproduced `ios-` becoming `iOS-`; after the fix, a new
lowercase filename and two-line editor content saved exactly, verified from the
simulator's Documents directory. The focused native prompt test passes in both
editions, including ordinary text defaults and explicit capitalization overrides;
all three shared input-adapter tests also pass.

Tap feedback reuses Proteus's existing `Native.haptic` service on iOS. The shared
helper retains Android vibration durations and safely skips unavailable browser
feedback. Quick tools, tab dragging, file context menus and terminal selection
use it. A native regression reproduced quick-tools Save throwing on the absent
`navigator.vibrate` API, then verified exact file saves through both touch and
click handlers with feedback enabled. Eight focused editor, file-browser and
haptic checks pass per edition; the normal-app project check above also used the
quick-tools Save button. Physical haptic sensation remains unverified.

The main WebView implements element fullscreen using a manual
popover and edge-to-edge native layout, preserving iframe state and touch
coordinates without WebKit's browser fullscreen presentation. Fullscreen styles
apply to the owner and its shadow hosts; inline layout overrides are restored on
exit. Iframe documents and preview WebViews retain WebKit fullscreen. The existing `orientation` plugin API applies
portrait/landscape requests only during foreground fullscreen, releases its policy
on exit, reload or unlock, and temporarily restores normal rotation while inactive.
A completed downward swipe (at least 40 points) starting anywhere across the top
(within 44 points below the top safe-area inset)
reveals the native Back button in main-app fullscreen. It hides after three seconds,
on backgrounding or on exit; tapping restarts its hide timer. A completed left-edge
swipe (at least 60 points) delivers Back directly. `fullscreen.setBackHandler(callback | null)`
receives these actions through `fullscreenbackbutton`; without a handler they exit
fullscreen. A visible modal within the fullscreen owner gets the first opportunity
to handle Escape, regardless of focus; native dialogs receive a cancellable close
request that consumes Back. Back closes Astray's open pause menu and
resumes the game even after interacting with the menu or revealing the native button.
Registration clears on exit or reload, survives orientation unlock, and delivery
is disabled while inactive. Games such as Astray can open their pause menu while
remaining in landscape, then restore the editor through Exit. Simulator tests cover
ownership, callback failure, Back controls, touch coordinates, rotation and restoration.
Motion sensor readings require a physical device; simulated inputs are test fixtures.
On iPadOS 18.6 and 26.5 with multitasking enabled, UIKit rejects programmatic
orientation changes. The API rejects its promise and clears the requested policy;
fullscreen entry/exit and normal device rotation remain available. Keep iPad
multitasking enabled rather than adding the deprecated
[`UIRequiresFullScreen`](https://developer.apple.com/documentation/bundleresources/information-property-list/uirequiresfullscreen)
compatibility mode. The integration test verifies the denial and cleanup on iPad
while retaining the successful rotation checks on iPhone.

Native selection-menu suppression clears the contextual menu through UIKit's
public menu builder; keyboard shortcuts and text interaction remain enabled.
Tests verify the bridge flag, DOM selection and status-bar visibility. Actual
long-press/right-click menu presentation and third-party keyboard suggestions
still need manual checks; calling UIKit's edit interaction programmatically did
not reproduce normal menu presentation in the simulator.

The account API uses an iOS-only fetch/XHR URL adapter because the app's custom
scheme has an opaque browser origin. The native handler restricts requests to
the Acode API origin, retains TLS verification, honors credential omission and
keeps HttpOnly cookies out of JavaScript. Blob/FormData bodies are normalized to
bytes before WebKit forwarding. Synchronous XHR uploads of Blob/FormData cannot
be normalized asynchronously and currently reject explicitly.

Authentication uses the existing one-time app-code protocol in a system web
authentication session, with the verifier and token in Keychain. Automated tests
do not log in to a real account. A complete interactive login/logout and account
purchase flow still needs validation.

The `Iap` bridge now uses StoreKit 2, preserving product lookup, launch callbacks,
persistent purchase updates, purchase states and numeric errors. Only verified,
active transactions are returned as owned. Purchases remain unfinished until the
existing acknowledgement/consume calls; unfinished purchases survive WebView
reloads. Tokens carry Apple's signed JWS, with `store: "appstore"`, transaction
IDs, environment and `signedTransactionInfo` also included. Acknowledgement looks
up the token's reference in verified local ownership because StoreKit can re-sign
the same transaction. Decoded token claims alone never establish ownership.

The iOS Settings page adds Restore purchases using `AppStore.sync()`. Shared
purchase listeners now match the requested product, preventing another product's
update from unlocking Pro or completing a plugin purchase. Unavailable billing
on iOS does not enable the existing Android external-checkout fallback.

StoreKit integration tests cover product metadata, purchase acknowledgement,
restoration, refunds, consumables, reload recovery, cancellation, deferred
approval, listener persistence, and rejection of invalid signatures. The fixture
catalogue lives only in the test bundle. The installed iOS 26.5 simulator failed
to configure StoreKitTest, matching Apple's reported
[command-line testing issue](https://developer.apple.com/forums/thread/826971);
CI selects iOS 18.6 or 26.2 and does not silently skip billing tests.

Production billing is still incomplete. Existing SKU strings are passed through
unchanged, so matching App Store products and production bundle IDs must be
configured. The sibling backend's paid-plugin and sponsorship routes currently
validate Google Play tokens only. They cannot accept these Apple transactions
until Apple verification and store-aware order/refund handling are implemented.
Until then, iOS hides new paid-plugin and sponsorship purchases and Google Play
refund links. Free and account-owned plugins remain installable, including as
dependencies and during backup restore; installed plugins retain update/removal
actions. An unowned paid dependency stops installation and backup restore reports
unowned paid plugins as skipped. The sponsor list remains available. Shared tests
exercise these paths and retain Android's store-token behavior. Local Pro purchase
and restoration still use StoreKit. No backend or production account changes have
been made.

The normal free app also displayed Google's live banner and rewarded test
creatives on the iPad iOS 18.6 simulator. The banner handled Split View, portrait
rotation and software-keyboard hiding/restoration. Completing and dismissing one
rewarded test ad granted exactly one Quick pass, showed one hour remaining and
1/3 redemptions, and suppressed the Settings banner. A temporary manual bridge
check also passed interstitial loading, presentation, impression and dismissal
callbacks on the iPad, preserving editor content, layout and the existing reward
pass. Ad requests now include the presenting window's scene; the regression
reproduced the missing scene for all six native formats, and all six AdMob bridge
tests pass with the correction. Live portrait and landscape Split View checks
displayed the full interstitial test image and passed dismissal, though other
landscape runs had an unexplained black creative. The iPhone rendered the full
test image, but its dismissal check timed out after desktop UI targeting failures.
These test-ad checks do not establish production delivery, consent variants or
physical-device behavior.

## Remaining native work

Both Debug device builds compile and pass deep signature verification with the
existing local development profiles. The profiles include the currently paired
iPhone 15, which has Developer Mode enabled. The free build uses Google's sample
advertising app ID; the paid build omits it. Both editions also compile with
`build-for-testing`; their signed native test bundles and device `.xctestrun`
manifests have been verified locally. The paid UI-test runner is signed as well.
Separate installation apps without test bundles are preserved under
`.ios-build/DeviceApps`. A subsequent read-only device check confirmed the paid
`app.acode` app is installed on the iPhone as version 1.13.5, build 1011. Xcode
reports a completed `runner` run on that phone, with the WebView finishing
`acode://localhost/`. This establishes device installation and native WebView
startup, not editor or native-service parity. The free `app.acode.free` app is
not installed. Automated physical-device tests have not been run; their installation
and execution approval remains pending.

- Production StoreKit configuration, Apple verification for paid plugins and
  sponsorships, account purchase flows, and production AdMob/consent/ATT validation.
  Production bundle, product, App Store listing and advertising identifiers are
  pending.
- Remaining remote-connection lifecycle/device checks, external
  provider indexing and large-workspace performance on physical devices.
- Physical-device background preview transfers and external browser lifecycle, LAN access,
  process-interrupted archives and external-provider archive operations.
- Native context-menu and third-party keyboard touch checks, other share
  destinations and Files-provider persistence, revocation and app-upgrade paths.
  Acode's notification UI remains in shared JavaScript; the template
  scanner/notification services are not part of its Android native API surface.
- Additional iPad window resizing and floating-keyboard checks, physical keyboard,
  accessibility, broader manual checks on the oldest supported iOS, signed physical-device
  testing and Android physical-device/minimum-API regression validation.

Build, start and simulator-test commands are documented in CONTRIBUTING.md.
The iOS CI jobs build and test both package editions without release credentials;
the workflow has not been run on GitHub yet. Build success does not establish
parity for the native services still listed above.
