# DECISIONS — Architecture Decision Records

Short, dated records of non-obvious choices: what we chose, what we rejected, and why. Add a new entry per decision; never delete old ones (mark superseded instead).

## Format

```
## ADR-000: <title>
- **Date:** YYYY-MM-DD
- **Status:** proposed | accepted | superseded by ADR-XXX
- **Decision:** what we're doing
- **Alternatives considered:** what we didn't pick
- **Why:** reasoning
```

## Log

## ADR-001: Fork via GitHub's native fork feature, not a fresh copy
- **Date:** 2026-09-25
- **Status:** accepted; partially superseded by ADR-003 (the "stay mergeable via continuous rebase" assumption no longer applies to the app-shell layer)
- **Decision:** Bract is a GitHub fork of `Acode-Foundation/Acode` (main branch only), not a freshly initialized repo with copied files.
- **Alternatives considered:** Fresh repo with manually copied source (loses git history and the upstream link).
- **Why:** Preserves full commit history and GitHub's upstream comparison/PR tooling, and still gives us a clean base to harvest mature parts from (see ADR-003).

## ADR-002: Repo name "Bract"
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Project and repo are named "Bract".
- **Alternatives considered:** Nimbis, Basecode, Forgeon/Forj, Ampcode.
- **Why:** Short, distinctive, available as a name; "small but essential" metaphor fits the calm/lean product positioning better than a literal descriptive name.

## ADR-003: Migrate app shell from Cordova to Capacitor; harvest, don't rebase, upstream Acode
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Replace Cordova with Capacitor as the native app shell. This is a one-time port, not a continuously-rebased fork of the shell layer: we harvest the mature, reusable parts of Acode (CodeMirror integration, LSP client wiring, language files, plugin API concepts, terminal/proot logic, icons/themes) into a new Capacitor project structure, rather than tracking Acode's git history line-for-line going forward. We can still selectively cherry-pick specific upstream improvements (new language modes, LSP client fixes, security patches) after the port.
- **Alternatives considered:** Stay on Cordova (aging maintenance pace, weaker plugin ecosystem, worse Android 14+/edge-to-edge support out of the box); Tauri Mobile (Rust-based, lighter in theory, but less mature on Android as of early 2026, smaller plugin ecosystem); a fully native Kotlin/Compose shell hosting a manual WebView (maximum control, but reinvents what Capacitor already solves, with no real upside for us).
- **Why:** Capacitor keeps nearly all existing investment in `src/`/`www/` and the CodeMirror integration (same "web app in a native shell" model as Cordova), while giving a real first-class native Gradle project instead of Cordova's hook-based abstraction, a more actively maintained plugin ecosystem, and better modern-Android support. It's the best match for the lightweight + independent-app-building goals: no heavier runtime than what we already carry, and a native project we fully own rather than one shaped by Cordova's platform-add tooling.
- **Consequence:** `config.xml`, `hooks/`, most of `gradle/`, and the Cordova-oriented parts of `.github/workflows/ci.yml` become obsolete and get replaced as part of this migration, not just cleaned up separately. App identity (package/appId, display name, deep-link scheme) is set fresh as part of Capacitor init rather than renamed after the fact.

## ADR-004: New UI surfaces built in Svelte; existing editor chrome left as-is
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** The existing CodeMirror-integration DOM code stays as-is where it's already mature. New UI surfaces going forward — the Simple/Pro mode shell, agent review panels, bottom sheets, command palette — are built in Svelte rather than extending Acode's vanilla-DOM/`html-tag-js` pattern.
- **Alternatives considered:** Preact (small but still ships a runtime and virtual-DOM diffing); SolidJS (also compiles away reactivity, but smaller ecosystem/tooling maturity than Svelte); staying with the existing vanilla pattern (slower to build in, and explicitly not "the best possible framework" for this piece).
- **Why:** Svelte compiles away at build time — no shipped framework runtime, smallest bundle size of the realistic options, and faster to build UI in than the existing imperative pattern. This is the best fit for the stated lightweight priority: every KB matters more on a phone-hosted IDE than it would on desktop.

## ADR-005: Acode's MIT license carries forward as-is
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Keep `license.txt` (MIT, © 2020 Foxdebug/Ajit Kumar) unmodified at the repo root. Bract remains MIT-licensed; no relicensing needed.
- **Alternatives considered:** Relicense Bract under a different license — rejected, unnecessary and would require stripping/replacing all retained Acode code first.
- **Why:** MIT is maximally permissive: it allows use, copy, modify, merge, publish, distribute, sublicense, and sell, with the only condition being that the copyright and permission notice ships with the software. This resolves BLUEPRINT.md §11 item 1 ("verify the Acode LICENSE terms carry correctly into the new Capacitor project") — confirmed compatible, no blocker for the harvest-and-port plan in ADR-003. The three other §11 items (distribution/monetization, team size and device floor, first model providers) are product/business calls for the project owner, not something to resolve unilaterally here — tracked as still open.
