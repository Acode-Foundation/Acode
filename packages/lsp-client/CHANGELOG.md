## 6.2.5-acode.1 (2026-08-04)

### New features

Allow multiple LSP clients to bind to one editor, with per-client feature
selection, priority routing, independent document synchronization, and merged
completion and hover providers.

## 6.2.5 (2026-06-09)

### Bug fixes

Strip backslash escapes in snippets in places where CodeMirror doesn't support them.

Support the `extraTextEdits` field in completions.

## 6.2.4 (2026-05-15)

### Bug fixes

Tell the server we prefer Markdown docs over plain text.

Support completion-set-wide `insertTextFormat` options.

Support separate filter and display names for completions.

## 6.2.3 (2026-04-15)

### Bug fixes

Don't crash when trying to jump to a symbol that the server does not provide a location for.

Fix the argument passed to cancel requests.

## 6.2.2 (2026-03-02)

### Bug fixes

In completion snippets from the server, treat `$1` the same as `${1}`.

## 6.2.1 (2025-11-20)

### Bug fixes

Support `sortText` properties on LSP completions.

## 6.2.0 (2025-10-27)

### New features

`serverCompletion` now takes an option `validFor` that can be used to configure the regexp used in the result.

## 6.1.2 (2025-09-10)

### Bug fixes

Fix an issue where snippet completions would display the snippet source as their label.

## 6.1.1 (2025-09-02)

### Bug fixes

Properly declare the @codemirror/lint dependency.

Make sure document changes are eagerly pushed to the server when `serverDiagnostics` is active.

## 6.1.0 (2025-08-23)

### New features

`LSPClient` now accepts an array of extensions directly in its configuration. These can also add behavior (client capabilities and notification handlers) to the client itself.

The new `serverDiagnostics` extension makes the client receive diagnostics from the server, and show them via the CodeMirror linter.

The new `languageServerExtensions` function provides an extension bundle interface, that works for client extensions as well as editor extensions.

`LSPClient` now has a `plugin` method for conveniently creating an editor extension. `LSPPlugin.create` is deprecated in favor of this method.

## 6.0.1 (2025-08-05)

### Bug fixes

Fix a bug that prevented reuse of completions when adding to the completed identifier.

Properly render plain strings included in arrays for a hover tooltip's `content` data as Markdown content.

## 6.0.0 (2025-07-02)

### Breaking changes

First numbered release.
