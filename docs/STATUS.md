# STATUS — Current State of Bract

_Last updated: 2026-09-25_

## Where we are

Phase 0.1 (groundwork and decisions) is complete. Phase 0.2 (Capacitor scaffold) is **in progress** — 2 of 3 items done. Architecture decided: migrating the app shell from Cordova to Capacitor (ADR-003), with new UI surfaces built in Svelte (ADR-004). This is a one-time harvest-and-port from Acode, not a continuously-rebased fork — see `docs/DECISIONS.md` and `docs/BLUEPRINT.md` section 3. `docs/ROADMAP.md` is broken into sub-phases per phase, sequenced easy to tough, to guide build order.

## What's built

- Acode-Foundation-specific files removed: `.github/CODEOWNERS`; the four Acode release workflows (`nightly-build.yml`, `nightly-release.yml`, `on-demand-preview-releases-PR.yml`, `community-release-notifier.yml`) plus the org-gated `congrats.yml`; `fastlane/metadata/android/en-US/**` (Acode's own Play Store listing); `CODE_OF_CONDUCT.md`; the redundant `package-lock.json` (`bun.lock` is canonical). Kept the generic repo-hygiene workflows (`add-pr-labels.yml`, `close-inactive-issues.yml`, `dependabot.yml`, `labeler.yml`). Full list in `PATCHES.md`.
- License verified: Acode's `license.txt` (MIT) carries forward as-is, no changes needed (ADR-005).
- All Phase 0.1 open decisions resolved (ADR-006 through ADR-010): solo, AI-assisted team; distribution via GitHub + F-Droid only, no monetization for now; Android 10 (API 29) minimum, ~4GB RAM tested floor; first model providers Anthropic, OpenAI, Google Gemini; on-device model deferred to Phase 3+.
- **Phase 0.2, item 1 (app identity) — done:** `capacitor.config.ts` added at repo root with `appId: io.github.shashidao.bract`, `appName: Bract` (ADR-011).
- **Phase 0.2, item 2 (CI rebuild) — done:** `.github/workflows/ci.yml` `unit-tests`/`translation-check` switched from `npm ci` (broken since Phase 0.1 deleted `package-lock.json`) to bun. Added a gated `android-build` job (JDK 17, `./gradlew assembleDebug`) that no-ops until `android/` exists — see item 3.

## In progress

- **Phase 0.2, item 3 (native Android scaffold) — not started, and not completable by an AI agent limited to GitHub's contents API.** `npx cap add android` generates a real native project, most of which is text (build.gradle, settings.gradle, variables.gradle, AndroidManifest.xml, Kotlin/Java sources) but part of which is binary (gradle-wrapper.jar, launcher/splash PNGs across densities) — those can't be transmitted through this connector's text-based file-write calls without corruption. This step needs to run somewhere with a real filesystem: your machine, or an agent with actual disk access (e.g. Claude Code). Commands:
  ```
  git checkout main && git pull
  bun add @capacitor/core
  bun add -D @capacitor/cli @capacitor/android
  npx cap add android
  ```
  Two things to apply once `android/` exists, before committing it:
  1. **`android/variables.gradle`**: the current Capacitor template (8.5.2) defaults `minSdkVersion` to 24. Change it to **29** to match ADR-008.
  2. **`android/app/src/main/AndroidManifest.xml`**: add the `bract://` deep-link intent-filter (ADR-011) to the `MainActivity` `<activity>` block, alongside the existing MAIN/LAUNCHER one:
     ```xml
     <intent-filter android:autoVerify="false">
         <action android:name="android.intent.action.VIEW" />
         <category android:name="android.intent.category.DEFAULT" />
         <category android:name="android.intent.category.BROWSABLE" />
         <data android:scheme="bract" />
     </intent-filter>
     ```
  Then `git add android/ && git commit -m "Phase 0.2: generate Android platform" && git push` — this also flips the `android-build` CI job from no-op to actually running.
  For reference, the template scaffold as of Capacitor 8.5.2 pins: AGP 8.13.0, Gradle 8.14.3, compileSdk/targetSdk 36 — no action needed on these, just noting them since they weren't pinned anywhere in the repo before.

## Known issues / broken

- None currently tracked. (The `ci.yml` npm/package-lock.json breakage from Phase 0.1 cleanup is fixed — see item 2 above.)

## Next up

Generate and commit the native `android/` scaffold per the steps above (needs a real filesystem — your machine or Claude Code). That's the last Phase 0.2 item; once it lands, Phase 0.3 can start.

## How to update this file

At the end of any work session or PR that changes project state: update "What's built" / "In progress" / "Known issues", bump the date, and keep it short — this is a snapshot, not a changelog (see `CHANGELOG.md` for history).
