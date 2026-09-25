# STATUS — Current State of Bract

_Last updated: 2026-09-25_

## Where we are

Phase 0.1 (groundwork and decisions) is complete. Phase 0.2 (Capacitor scaffold) is **in progress**. Architecture decided: migrating the app shell from Cordova to Capacitor (ADR-003), with new UI surfaces built in Svelte (ADR-004). This is a one-time harvest-and-port from Acode, not a continuously-rebased fork — see `docs/DECISIONS.md` and `docs/BLUEPRINT.md` section 3. `docs/ROADMAP.md` is broken into sub-phases per phase, sequenced easy to tough, to guide build order.

## What's built

- Acode-Foundation-specific files removed: `.github/CODEOWNERS`; the four Acode release workflows (`nightly-build.yml`, `nightly-release.yml`, `on-demand-preview-releases-PR.yml`, `community-release-notifier.yml`) plus the org-gated `congrats.yml`; `fastlane/metadata/android/en-US/**` (Acode's own Play Store listing); `CODE_OF_CONDUCT.md`; the redundant `package-lock.json` (`bun.lock` is canonical). Kept the generic repo-hygiene workflows (`add-pr-labels.yml`, `close-inactive-issues.yml`, `dependabot.yml`, `labeler.yml`). Full list in `PATCHES.md`.
- License verified: Acode's `license.txt` (MIT) carries forward as-is, no changes needed (ADR-005).
- All Phase 0.1 open decisions resolved (ADR-006 through ADR-010): solo, AI-assisted team; distribution via GitHub + F-Droid only, no monetization for now; Android 10 (API 29) minimum, ~4GB RAM tested floor; first model providers Anthropic, OpenAI, Google Gemini; on-device model deferred to Phase 3+.
- **Phase 0.2, item 1 (app identity) — done:** `capacitor.config.ts` added at repo root with `appId: io.github.shashidao.bract`, `appName: Bract` (ADR-011).
- **Phase 0.2, item 2 (CI rebuild) — fix drafted, blocked on repo permissions:** while checking CI, found `ci.yml`'s `unit-tests` and `translation-check` jobs still run `npm ci` and cache `**/package-lock.json` — a bug introduced by the Phase 0.1 cleanup above (that file no longer exists). The fix (switch both to bun, matching `bun.lock`) plus a new gated `android-build` job (JDK 17 + `./gradlew assembleDebug`, no-ops until `android/` exists) is staged at `docs/pending-ci-android-job.yml`. It could not be committed directly to `.github/workflows/ci.yml`: this repo's GitHub connector/App installation lacks the `workflows` permission scope, and GitHub rejects writes to that path with 403 regardless of which API call is used. **Action needed:** either grant that connector the `workflows` write permission (GitHub App installation settings) and have it re-applied, or manually copy `docs/pending-ci-android-job.yml`'s content over `.github/workflows/ci.yml` and delete the staging file.

## In progress

- **Phase 0.2, item 3 (native Android scaffold) — not started, and not completable by an AI agent limited to GitHub's contents API.** `npx cap add android` generates a real native project, most of which is text (build.gradle, settings.gradle, variables.gradle, AndroidManifest.xml, Kotlin/Java sources) but part of which is binary (gradle-wrapper.jar, launcher/splash PNGs across densities) — those can't be transmitted through this connector's text-based file-write calls without corruption. This step needs to run somewhere with a real filesystem: your machine, or an agent with actual disk access (e.g. Claude Code). Commands (unchanged from last session):
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
  Then `git add android/ && git commit -m "Phase 0.2: generate Android platform" && git push` — this also flips the new `android-build` CI job (once staged/applied above) from no-op to actually running.
  For reference, the template scaffold as of Capacitor 8.5.2 pins: AGP 8.13.0, Gradle 8.14.3, compileSdk/targetSdk 36 — no action needed on these, just noting them since they weren't pinned anywhere in the repo before.

## Known issues / broken

- `ci.yml`'s `unit-tests`/`translation-check` jobs have been broken since the Phase 0.1 `package-lock.json` removal (see above) — fix staged, not yet applied.

## Next up

Land the CI fix (see blocker above), then generate and commit the native `android/` scaffold per the steps above. After that, Phase 0.2 is done and Phase 0.3 can start.

## How to update this file

At the end of any work session or PR that changes project state: update "What's built" / "In progress" / "Known issues", bump the date, and keep it short — this is a snapshot, not a changelog (see `CHANGELOG.md` for history).
