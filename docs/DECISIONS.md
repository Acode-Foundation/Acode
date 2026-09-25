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
- **Why:** MIT is maximally permissive: it allows use, copy, modify, merge, publish, distribute, sublicense, and sell, with the only condition being that the copyright and permission notice ships with the software. This resolves BLUEPRINT.md §11 item 1 ("verify the Acode LICENSE terms carry correctly into the new Capacitor project") — confirmed compatible, no blocker for the harvest-and-port plan in ADR-003.

## ADR-006: Team composition — solo, AI-assisted, multi-assistant workflow
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Bract is built by a single developer working AI-assisted, rotating between different AI assistants (Claude and others) as usage limits require. This is not a 4–6 person team.
- **Alternatives considered:** n/a — this records actual project resourcing rather than a choice between options.
- **Why:** `AGENTS.md`'s "any AI agent, Claude, GPT, or otherwise" framing already anticipated this workflow. `docs/BLUEPRINT.md` section 8's week-based roadmap table assumed a 4–6 person team; it now stands as a rough relative-effort reference only, not a solo timeline.

## ADR-007: Distribution and monetization — GitHub + F-Droid, no monetization for now
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Distribute via GitHub Releases and F-Droid only, for now. No Play Store. No monetization — Bract stays fully free.
- **Alternatives considered:** An earlier, unmerged draft (branch `docs/phase-0.1-decisions`, its own ADR-006) proposed Play Store + F-Droid + GitHub with a freemium Pro tier and an Android 13 (API 33) floor. That draft was never merged to `main` and is superseded by this entry and by ADR-008.
- **Why:** Project owner's explicit call. Keeps distribution simple for a solo maintainer; F-Droid's build-from-source requirements are already satisfied by the MIT license (ADR-005).

## ADR-008: Minimum device floor — Android 10 (API 29), ~4GB RAM tested floor
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Minimum supported Android version is 10 (API 29); target/compile against current API. No hard RAM gate, but ~4GB RAM is the tested/supported floor — below that, proot toolchains and any on-device model are disabled rather than blocking install.
- **Alternatives considered:** Android 13 (API 33) / modern-only floor, from the unmerged `docs/phase-0.1-decisions` draft — rejected as excluding too much of the active device base for a solo-maintained, non-Play-Store app. A lower floor such as Android 8 — rejected, fits poorly with the scoped-storage/SAF import model already committed to in section 4 of `docs/BLUEPRINT.md`.
- **Why:** Balances device coverage against realistic support burden for a solo maintainer; matches the already-chosen app-private-storage-plus-SAF-import model.

## ADR-009: First three model providers — Anthropic, OpenAI, Google Gemini
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Support Anthropic, OpenAI, and Google (Gemini) as the first three BYOK model providers.
- **Alternatives considered:** Other providers (Mistral, local-only-first, etc.) — not rejected, just deferred; providers are pluggable via BYOK so more can be added later without a decision record.
- **Why:** Covers the most-used coding-capable APIs with strong streaming support; Gemini's free tier matters for a BYOK, non-Play-Store audience.

## ADR-010: On-device model deferred to Phase 3+
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** On-device (on-phone) model inference is out of scope for Phase 1. Ship BYOK cloud + LAN Ollama first; revisit on-device support no earlier than Phase 3.
- **Alternatives considered:** Building on-device support in Phase 1 alongside cloud — rejected as disproportionate effort (model packaging, quantization, per-chipset variance) for a solo, AI-assisted build.
- **Why:** Keeps Phase 1 scope achievable solo. `docs/BLUEPRINT.md` section 5.3 already hedges on-device as "where hardware allows"; this just fixes the timing.

## ADR-011: App identity — application ID, display name, deep-link scheme
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Application ID `io.github.shashidao.bract`; display name "Bract"; deep-link scheme `bract://`.
- **Alternatives considered:** A custom-domain-based app ID (e.g. `app.bract.*`) — rejected for now, no domain is owned yet and one isn't needed to ship.
- **Why:** `io.github.<owner>.<repo>` is F-Droid's own recommended fallback convention for developers without a domain — collision-free, requires no purchase, and stable even if a domain is added later. This needs to be set correctly once at Capacitor init (ADR-003) rather than renamed after the fact: changing an applicationId after real installs exist breaks update continuity and signing identity.
