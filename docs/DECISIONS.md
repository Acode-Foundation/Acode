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
- **Status:** accepted
- **Decision:** Bract is a GitHub fork of `Acode-Foundation/Acode` (main branch only), not a freshly initialized repo with copied files.
- **Alternatives considered:** Fresh repo with manually copied source (loses git history and the upstream link).
- **Why:** Preserves full commit history and GitHub's upstream comparison/PR tooling, which we rely on for the weekly-rebase strategy in `docs/BLUEPRINT.md` section 3.

## ADR-002: Repo name "Bract"
- **Date:** 2026-09-25
- **Status:** accepted
- **Decision:** Project and repo are named "Bract".
- **Alternatives considered:** Nimbis, Basecode, Forgeon/Forj, Ampcode.
- **Why:** Short, distinctive, available as a name; "small but essential" metaphor fits the calm/lean product positioning better than a literal descriptive name.
