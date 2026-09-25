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

- **Phase 0.2, item 3 (native Android scaffold) — workflow landed, not yet triggered.** `.github/workflows/scaffold-android.yml` is committed and ready to run. (The doc that staged its content for copy-paste, `docs/pending-scaffold-android-workflow.yml`, has been deleted — it was only needed until the real workflow file existed.) It's a one-time `workflow_dispatch` Action: run on a real GitHub Actions runner, it does `npx cap add android` (handles the binaries — gradle-wrapper.jar, launcher/splash PNG images — that this agent's contents-API can't write), applies the ADR-008 `minSdkVersion=29` override and the ADR-011 `bract://` deep-link intent-filter automatically, then opens a PR.

  To land it:
  1. Trigger it from the repo's **Actions** tab.
  2. Review the diff in the PR it opens, merge.
  3. Delete `.github/workflows/scaffold-android.yml` — one-time, not regular CI.

  Landing this also flips the `android-build` CI job from no-op to actually running. Note: since the PR is opened using the workflow's own `GITHUB_TOKEN`, GitHub won't auto-run `ci.yml` checks on it — close/reopen the PR or push an empty commit yourself first if you want the check to show green before merging.

## Known issues / broken

- None currently tracked. (The `ci.yml` npm/package-lock.json breakage from Phase 0.1 cleanup is fixed — see item 2 above.)

## Next up

Trigger `scaffold-android.yml` from the Actions tab, merge the PR it opens, then delete the workflow file. That's the last Phase 0.2 item; once it lands, Phase 0.3 can start.

## How to update this file

At the end of any work session or PR that changes project state: update "What's built" / "In progress" / "Known issues", bump the date, and keep it short — this is a snapshot, not a changelog (see `CHANGELOG.md` for history).
