# Repository Guidelines

## Project Structure & Module Organization
Core application code lives in `src/`, with UI pieces under `src/components/`, screens in `src/pages/`, shared helpers in `src/lib/` and `src/utils/`, and translations in `src/lang/`. Cordova plugin sources are kept in `src/plugins/`, while generated or bundled web assets land in `www/` (`www/build/`, `www/js/build/`, `www/css/build/`). Build and maintenance scripts live in `utils/` and `utils/scripts/`. Runtime-oriented test files are grouped in `src/test/`.

## Build, Test, and Development Commands
- `bun run setup` — install dependencies and prepare the Cordova project.
- `bun run start android paid d` — build in development mode and launch on a connected Android device/emulator.
- `bun run build paid dev apk` — create a debug APK; output is `platforms/android/app/build/outputs/apk/debug/app-debug.apk`.
- `bun run check` — run Biome formatting, linting, and import organization.
- `bun run typecheck` — run TypeScript checks with `tsc --noEmit`.
- `bun run lang add|remove|search|update` — maintain translation keys in `src/lang/`.

## Coding Style & Naming Conventions
Biome is the primary formatter and linter; use `bun run check` before opening a PR. The repo uses tabs for indentation and prefers small, focused modules. Follow existing naming patterns: kebab-case for many folders and plugin packages, camelCase for most utility files, and descriptive exports over abbreviations. Keep imports organized and match the surrounding style instead of reformatting unrelated code.

## Testing Guidelines
Automated checks are lightweight and repo-specific. Keep `bun run check` and `bu  run typecheck` clean, then validate behavior on a device or emulator when UI, Cordova, or plugin code changes. Test helpers and suites live in `src/test/` with names such as `sanity.tests.js` and `ace.test.js`; follow the same `*.test.js` / `*.tests.js` pattern for new coverage.

## Commit & Pull Request Guidelines
Recent history favors Conventional Commit style such as `feat(acp): ...`, `fix: ...`, `docs: ...`, and `chore(deps): ...`. Keep commits atomic and scoped to one concern. PRs should target `main`, include a clear summary, link related issues when relevant, attach screenshots or GIFs for UI work, and pass CI checks.

## Configuration & Security Notes
Prefer the DevContainer or Docker workflow documented in `CONTRIBUTING.md` for consistent Android builds. Do not commit local secrets, SDK paths, or signing changes unless the task explicitly requires them.
