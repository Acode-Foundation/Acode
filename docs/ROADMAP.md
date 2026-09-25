# ROADMAP

Phased plan, mirrored as a GitHub Projects board. Check items off as they land; keep this in sync with `docs/STATUS.md`.

Each phase is broken into sub-phases, sequenced from easiest/lowest-risk to hardest/highest-risk, so build order roughly follows this list top to bottom. Cross-item dependencies are noted inline.

## Phase 0 — Setup and shell migration

### 0.1 Groundwork and decisions
- [x] Fork Acode into Bract
- [x] Decide architecture: Cordova → Capacitor (ADR-003), new UI in Svelte (ADR-004)
- [x] Clean up Acode-Foundation-specific files (CODEOWNERS, release/community workflows, `fastlane/` metadata, `CODE_OF_CONDUCT.md`, redundant lockfile) — see `PATCHES.md`
- [x] Verify Acode's LICENSE carries forward cleanly (ADR-005 — MIT, confirmed, no blocker)
- [x] Resolve remaining open decisions (BLUEPRINT.md §11: distribution/monetization, team size and device floor, first three model providers) — see ADR-006 through ADR-010

### 0.2 Capacitor scaffold
- [x] Scaffold new Capacitor project (own app ID, display name, deep-link scheme)
- [x] Rebuild CI for the Capacitor/Gradle build (replace Cordova-oriented `ci.yml`)

### 0.3 Harvest and port core systems
- [ ] Port CodeMirror integration and LSP client wiring into the new shell
- [ ] Port language files (`src/lang/`) and plugin-API concept
- [ ] Port terminal/proot plugin to Capacitor's native plugin model — hardest item in this phase; device fragility risk (see BLUEPRINT.md §10)

### 0.4 Eval groundwork
- [ ] Eval harness skeleton for agent tasks (prepares for Phase 1 agent evals, BLUEPRINT.md §9)

**Exit criteria:** Capacitor app builds and installs independently of Acode.

## Phase 1 — Calm and Ready

### 1.1 UI shell foundations
- [ ] Simple/Pro mode toggle (Svelte)
- [ ] Onboarding + templates (static site, Python, Node/Vite)

### 1.2 Native plugin foundations
- [ ] Bundled Git (no manual `apk add git` step)
- [ ] Native HTTP client + Keystore-backed vault (Capacitor plugins)

### 1.3 Agent v1 core loop
- [ ] Agent v1: chat, read/edit/run tools, diff review, checkpoints — depends on 1.2's native HTTP client and vault; biggest new subsystem in this phase

### 1.4 Dials
- [ ] Privacy dial v1 (Local / Cloud-scoped / Full-cloud) — depends on 1.3
- [ ] Autonomy dial v1 (Ask / Auto-edit / Autopilot) — depends on 1.3

**Exit criteria:** time-to-first-run under 90s; agent passes its first eval targets.

## Phase 2 — Real IDE loop

### 2.1 Run foundations
- [ ] Runtimes manager (Python, Node, Java, ...)
- [ ] Auto-detected run tasks

### 2.2 LSP-backed intelligence
- [ ] Problems panel (project-wide LSP diagnostics)
- [ ] Navigation: go to definition, find references, rename, outline
- [ ] Project-wide search & replace with preview

### 2.3 Test and preview tooling
- [ ] Test explorer (pytest, Jest/Vitest)
- [ ] Preview inspector (console, network, device sizes)

### 2.4 Debugger
- [ ] DAP debugger (JS/Node, Python via debugpy) — new protocol client, hardest item in this phase

### 2.5 Agent gains IDE tools
- [ ] Agent gains debug.* and test.run tools — depends on 2.3 and 2.4

**Exit criteria:** debug a Node and a Python bug end to end on-device.

## Phase 3 — Everywhere

### 3.1 Large-screen layouts
- [ ] Split view / multi-window for tablets & foldables

### 3.2 Import and deploy conveniences
- [ ] VS Code theme/snippet/keybinding import
- [ ] One-tap deploy (GitHub Pages, Netlify, Cloudflare Pages)

### 3.3 Remote workspaces
- [ ] Remote workspaces over SSH (file tree, terminal, LSP)

### 3.4 Protocol clients and remote agents
- [ ] MCP client (tools) + ACP client (external agents)
- [ ] Remote agent runners for long jobs — depends on 3.3 and Phase 1's agent v1; hardest item in this phase

**Exit criteria:** remote edit-run-agent loop works over SSH.

## Phase 4 — Launch

### 4.1 Docs pass
- [ ] Docs pass

### 4.2 Plugin API v2
- [ ] Plugin API v2

### 4.3 Public beta
- [ ] Public beta — needs Phases 0–3 code-complete

### 4.4 Hardening
- [ ] Hardening pass (crash rate, perf budgets) — driven by 4.3 beta feedback

### 4.5 Store submissions
- [ ] Store submissions (F-Droid, GitHub releases, Play Store policy review) — depends on 4.4; hardest item in this phase, policy review timelines are outside our control

**Exit criteria:** crash-free target met; beta feedback triaged.

---
Full detail and rationale for every item: `docs/BLUEPRINT.md`. Architecture rationale: `docs/DECISIONS.md`.
