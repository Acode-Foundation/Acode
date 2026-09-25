# PATCHES.md — Provenance: what came from Acode, what was rebuilt, what was dropped

Originally scoped to track divergence for continuous rebasing. Per ADR-003, Bract is now a one-time harvest-and-port from Acode rather than a continuously-rebased fork, so this file's job has expanded: it's the record of what we kept, adapted, rebuilt, or dropped from the original Acode codebase, and why. It's also still where we log any one-off cherry-picks we later pull from upstream Acode.

Update this file in the same PR that makes the change.

## Format

For each item:

```
### <short title>
- **File(s)/area:** path(s) or subsystem
- **Type:** ported as-is | ported and adapted | rebuilt from scratch | dropped | cherry-picked from upstream
- **Reason:** why
- **Date:** YYYY-MM-DD
```

## Log

### Shell migration begins: Cordova → Capacitor
- **File(s)/area:** app shell (`config.xml`, `hooks/`, most of `gradle/`, Cordova-oriented CI)
- **Type:** rebuilt from scratch (in progress)
- **Reason:** ADR-003 — Cordova replaced with Capacitor as the native shell. See `docs/BLUEPRINT.md` section 3 for what's harvested vs. rebuilt vs. dropped.
- **Date:** 2026-09-25

### Acode-Foundation-specific files dropped
- **File(s)/area:** `.github/CODEOWNERS`; `.github/workflows/nightly-build.yml`, `nightly-release.yml`, `on-demand-preview-releases-PR.yml`, `community-release-notifier.yml`, `congrats.yml`; `fastlane/metadata/android/en-US/**` (title, descriptions, icon, 8 screenshots); `CODE_OF_CONDUCT.md`; `package-lock.json`
- **Type:** dropped
- **Reason:** ROADMAP.md Phase 0.1 cleanup. The five dropped workflows are all release/community automation scoped to the `Acode-Foundation` org and its Play Store listing — `CODEOWNERS` names `@Acode-Foundation/acode` and `@unschooledgamer` as owners of exactly the four release workflows; `congrats.yml` is separately gated on `github.repository_owner == 'acode-foundation'` and posts to an Acode-specific Discord webhook; `nightly-build.yml`/`nightly-release.yml` also build with Cordova (`npm install -g cordova`), which is being replaced per ADR-003 regardless. `fastlane/metadata` is Acode's own Play Store store listing (title "Acode", Acode screenshots/icon) — not reusable for Bract's own listing. `CODE_OF_CONDUCT.md` was Acode-Foundation's contributor conduct policy. `package-lock.json` was a redundant second lockfile — `bun.lock` is the project's canonical lockfile per `AGENTS.md`.
- **Kept, not dropped:** `.github/workflows/ci.yml` (build CI — superseded in Phase 0.2 when it's rebuilt for Capacitor/Gradle, not deleted now), `add-pr-labels.yml`, `close-inactive-issues.yml`, `dependabot.yml`, `labeler.yml` — generic repo-hygiene automation, not Acode-Foundation-branded or org-gated; can be reused as-is or lightly reworded later.
- **Date:** 2026-09-25

### License verification
- **File(s)/area:** `license.txt`
- **Type:** ported as-is
- **Reason:** ADR-005 — Acode's MIT license is maximally permissive and requires no changes to carry forward; kept unmodified.
- **Date:** 2026-09-25
