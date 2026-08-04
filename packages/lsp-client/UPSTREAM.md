# Upstream

- Repository: https://code.haverbeke.berlin/codemirror/lsp-client
- Imported package: `@codemirror/lsp-client@6.2.5`
- License: MIT; the original notice is preserved in `LICENSE`
- Imported on: 2026-08-04

This directory is an in-tree Acode fork. Its primary change is support for
attaching multiple independent LSP clients to one CodeMirror `EditorView`.

Keep upstream imports and Acode changes in separate commits when practical.

To sync a release:

1. Download or clone the new upstream version into a temporary directory.
2. Diff its `src`, `test`, `README.md`, `CHANGELOG.md`, `LICENSE`, and
   `package.json` against this directory.
3. Apply upstream-only changes first, keeping this package's local metadata and
   the multi-client changes described in the Acode changelog.
4. Run Acode's typecheck, `tests/unit/lspMultiClient.test.js`, full unit suite,
   and production build.

The local implementation is deliberately confined to this package and Acode's
`src/cm/lsp` integration, so an upstream comparison does not require searching
generated bundles or patched files under `node_modules`.
