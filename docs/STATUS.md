# STATUS — Current State of Bract

_Last updated: 2026-09-25_

## Where we are

Architecture decided: migrating the app shell from Cordova to Capacitor (ADR-003), with new UI surfaces built in Svelte (ADR-004). This is a one-time harvest-and-port from Acode, not a continuously-rebased fork — see `docs/DECISIONS.md` and `docs/BLUEPRINT.md` section 3. Docs are updated for this plan; the actual migration work is starting now.

## What's built

- Nothing beyond the inherited Acode baseline yet. The Capacitor scaffold is about to be created.

## In progress

- Capacitor project scaffold (own app ID, display name, deep-link scheme).
- Cleanup of Acode-Foundation-specific files (CODEOWNERS, community/release workflows, `fastlane/` metadata, `CODE_OF_CONDUCT.md`, redundant lockfile) — folded into the shell migration rather than done separately, since several of these files are replaced by the migration anyway.

## Known issues / broken

- None tracked yet.

## Next up

See `docs/ROADMAP.md` Phase 0: scaffold the Capacitor project, port CodeMirror/LSP-client/language-files/terminal-plugin, rebuild CI for the Gradle build.

## How to update this file

At the end of any work session or PR that changes project state: update "What's built" / "In progress" / "Known issues", bump the date, and keep it short — this is a snapshot, not a changelog (see `CHANGELOG.md` for history).
