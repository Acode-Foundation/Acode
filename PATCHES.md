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
