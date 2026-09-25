# ROADMAP

Phased plan, mirrored as a GitHub Projects board. Check items off as they land; keep this in sync with `docs/STATUS.md`.

## Phase 0 — Setup
- [x] Fork Acode into Bract
- [ ] Rebrand (name, icon, package ID)
- [ ] CI baseline audit (confirm existing tests/build pass as-is)
- [ ] Eval harness skeleton for agent tasks
- [ ] Resolve open decisions (see `docs/BLUEPRINT.md` section 11)

## Phase 1 — Calm and Ready
- [ ] Simple/Pro mode toggle
- [ ] Onboarding + templates (static site, Python, Node/Vite)
- [ ] Bundled Git (no manual `apk add git` step)
- [ ] Native HTTP client + Keystore-backed vault
- [ ] Agent v1: chat, read/edit/run tools, diff review, checkpoints
- [ ] Privacy dial v1 (Local / Cloud-scoped / Full-cloud) + Autonomy dial v1 (Ask / Auto-edit / Autopilot)

## Phase 2 — Real IDE loop
- [ ] Runtimes manager (Python, Node, Java, ...)
- [ ] Auto-detected run tasks
- [ ] Problems panel (project-wide LSP diagnostics)
- [ ] Test explorer (pytest, Jest/Vitest)
- [ ] Navigation: go to definition, find references, rename, outline
- [ ] Project-wide search & replace with preview
- [ ] Preview inspector (console, network, device sizes)
- [ ] DAP debugger (JS/Node, Python via debugpy)
- [ ] Agent gains debug.* and test.run tools

## Phase 3 — Everywhere
- [ ] Remote workspaces over SSH (file tree, terminal, LSP)
- [ ] MCP client (tools) + ACP client (external agents)
- [ ] Remote agent runners for long jobs
- [ ] Split view / multi-window for tablets & foldables
- [ ] VS Code theme/snippet/keybinding import
- [ ] One-tap deploy (GitHub Pages, Netlify, Cloudflare Pages)

## Phase 4 — Launch
- [ ] Public beta
- [ ] Hardening pass (crash rate, perf budgets)
- [ ] Docs pass
- [ ] Plugin API v2
- [ ] Store submissions (F-Droid, GitHub releases, Play Store policy review)

---
Full detail and rationale for every item: `docs/BLUEPRINT.md`.
