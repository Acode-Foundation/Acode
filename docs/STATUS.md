# STATUS — Current State of Bract

_Last updated: 2026-09-25_

## Where we are

Phase 0.1 (groundwork and decisions) is complete. Architecture decided: migrating the app shell from Cordova to Capacitor (ADR-003), with new UI surfaces built in Svelte (ADR-004). This is a one-time harvest-and-port from Acode, not a continuously-rebased fork — see `docs/DECISIONS.md` and `docs/BLUEPRINT.md` section 3. `docs/ROADMAP.md` is broken into sub-phases per phase, sequenced easy to tough, to guide build order. Phase 0.2 (Capacitor scaffold) is next.

## What's built

- Acode-Foundation-specific files removed: `.github/CODEOWNERS`; the four Acode release workflows (`nightly-build.yml`, `nightly-release.yml`, `on-demand-preview-releases-PR.yml`, `community-release-notifier.yml`) plus the org-gated `congrats.yml`; `fastlane/metadata/android/en-US/**` (Acode's own Play Store listing); `CODE_OF_CONDUCT.md`; the redundant `package-lock.json` (`bun.lock` is canonical). Kept `ci.yml` (still in use until Phase 0.2 replaces it) and the generic repo-hygiene workflows (`add-pr-labels.yml`, `close-inactive-issues.yml`, `dependabot.yml`, `labeler.yml`). Full list in `PATCHES.md`.
- License verified: Acode's `license.txt` (MIT) carries forward as-is, no changes needed (ADR-005).
- All Phase 0.1 open decisions resolved (ADR-006 through ADR-010): solo, AI-assisted team (not the originally-assumed 4–6 people); distribution via GitHub + F-Droid only, no monetization for now; Android 10 (API 29) minimum, ~4GB RAM tested floor; first model providers Anthropic, OpenAI, Google Gemini; on-device model deferred to Phase 3+.

## In progress

- Nothing — Phase 0.1 is closed. Phase 0.2 (Capacitor scaffold) has not started.

## Known issues / broken

- None tracked yet.

## Next up

Start Phase 0.2: scaffold the Capacitor project (own app ID, display name, deep-link scheme) and rebuild CI for the Gradle build.

## How to update this file

At the end of any work session or PR that changes project state: update "What's built" / "In progress" / "Known issues", bump the date, and keep it short — this is a snapshot, not a changelog (see `CHANGELOG.md` for history).
