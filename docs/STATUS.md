# STATUS — Current State of Bract

_Last updated: 2026-09-25_

## Where we are

Phase 0.1 (groundwork and decisions) and Phase 0.2 (Capacitor scaffold) are complete. The Android project, Bract identity, and Capacitor/Gradle CI path are now checked in. The remaining Phase 0 work is the core-system harvest.

## What's built

- Acode-Foundation-specific files removed; MIT license carried forward as-is.
- Phase 0.1 decisions resolved (solo AI-assisted development, GitHub/F-Droid distribution, Android 10/API 29 floor, and initial model-provider direction).
- Capacitor configuration at the repository root with `appId: io.github.shashidao.bract`, `appName: Bract`, `webDir: www`, and HTTPS Android WebView scheme.
- Native Android scaffold checked in under `android/`, using package `io.github.shashidao.bract` and API 29 minimum.
- CI uses Bun, runs the web unit tests, and builds the Android debug APK with `npx cap sync android` followed by Gradle.
- Build scripts use the Capacitor sync/Gradle path rather than `cordova build`.

## In progress

- Phase 0.3: porting the existing editor, language, LSP, terminal, and plugin concepts into the Capacitor shell. The current web code still contains Cordova compatibility dependencies; these must be ported incrementally rather than removed blindly.

## Known issues / broken

- The legacy web runtime still references Cordova globals and Cordova plugins. This is expected during the staged harvest, but the app is not yet Cordova-independent.
- App metadata in the inherited `package.json` and some legacy UI strings still say Acode; these are cleanup items and must not override the native Capacitor identity.

## Next up

Start Phase 0.3 with an inventory and port of the CodeMirror/LSP integration, preserving a buildable Android app after each plugin migration. Do not begin Phase 1 until the Capacitor app can run the editor shell without relying on the old Cordova project lifecycle.

## How to update this file

At the end of any work session or PR that changes project state: update "What's built" / "In progress" / "Known issues", bump the date, and keep it short — this is a snapshot, not a changelog.
