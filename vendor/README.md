# Vendored CodeMirror packages

Acode carries narrow forks of `@codemirror/view` and
`@codemirror/language` for Android/WebView rendering behavior that cannot be
implemented through public CodeMirror extensions.

- `codemirror-view` is based on 6.43.9 at
  `d4e1656e1a0060f562695df93cb1775c0cdee24f`.
- `codemirror-language` is based on 6.12.4 at
  `89974ce5d39539ce6c5cfea5278443fa9381cbf2`.

The view fork adds bounded directional buffering and Android touch scrolling
with Android spline momentum. Acode uses `waitForRendering: false`: drag
distance follows the finger immediately, release velocity uses touch-event
timestamps, and normal viewport rendering runs independently. Near-diagonal
swipes retain vertical scrolling; only clearly horizontal swipes are handed
to native pan-x scrolling. Two screens of
directional buffering limit render work. The old four-screen coverage gate is
available with `waitForRendering: true` for diagnostic comparisons.
Unrestricted momentum follows elapsed spline time through slow frames; the
120 ms blocked-render cutoff applies only to the coverage-gated mode.
The language fork adds generation-scoped provisional
outer-language highlighting in stable 128-line windows. It retains up to 12
completed windows and prepares two windows beyond each viewport edge. Scrolling
reuses published colors while missing windows parse; document/language changes
invalidate the cache. These visual trees never replace canonical syntax state.
Both features are absent unless their exported
extensions are installed.

The controlled scroller releases ownership for taps, focus/blur, composition,
selection/navigation and external scroll changes. Keyboard viewport resizing
releases momentum and stale geometry but preserves an active finger drag.
A recognized scroll still consumes its touch release after cancellation, so
it cannot become a native tap that reopens the keyboard.
In this mode, selection repair never cycles DOM focus, including when an
offscreen caret lands inside a virtualized block gap. The delayed Android
Delete/Backspace focus-recovery workaround is also disabled so it cannot
reopen a dismissed keyboard. Explicit user-driven focus remains available.
Plain text or a removed highlighter clears stale coverage requirements.
Read-only editor content can scroll; nested interactive widgets retain their
own gestures. Provisional highlighting can run
during gestures (a 2 ms cooperative slice), while canonical background work
yields. The configured 4 ms budget also applies to initial/edit/background
parsing. A parser's individual `advance()` or tree finalization can exceed the
budget; this is not a hard frame-time guarantee.

The app's `keyboardScroll` extension records browsing intent per editor.
Keyboard close cancels pending reveals. Keyboard open preserves a browsed
viewport until an explicit selection or edit resumes caret following. Geometry
reads and scroll writes run in separate CodeMirror measurement phases.

These remain experimental changes. The historical Android measurements in
`utils/benchmarks/README.md` describe the original experiment, not this revision.
They must be rerun before release. `createMainEditorExtensions` accepts
`renderingExtensions: []` for comparisons with upstream rendering behavior.

## Building local changes

Run these after changing either package:

```sh
npm run build:codemirror-vendor
npm install --ignore-scripts
npm run test:codemirror
npm run typecheck
```

The build writes deterministic archives with a content hash in the filename
and updates the root dependency paths. This prevents npm from retaining a stale
local package with the same upstream version. Commit `dist/`, the referenced
archives, `package.json`, and `package-lock.json`. Remove superseded archives
once validation passes. Dependencies and overrides ensure every consumer uses
the same CodeMirror module instance. Licenses and upstream tests are retained.

## Updating upstream

`upstream.json` records the exact upstream revisions. `patches/view.patch` and
`patches/language.patch` contain only Acode's differences; the source receipts
detect edits that have not been saved in those patches. Generated `dist/` and
archives are deliberately excluded from patches.

Clone the canonical repositories once. Their GitHub mirrors may lag releases:

```sh
git clone https://code.haverbeke.berlin/codemirror/view.git /tmp/cm-view
git clone https://code.haverbeke.berlin/codemirror/language.git /tmp/cm-language
git -C /tmp/cm-view checkout d4e1656e1a0060f562695df93cb1775c0cdee24f
git -C /tmp/cm-language checkout 89974ce5d39539ce6c5cfea5278443fa9381cbf2
npm run codemirror:upstream -- check view /tmp/cm-view
npm run codemirror:upstream -- check language /tmp/cm-language
```

After editing vendored source, use `refresh` instead of `check` against the
recorded baseline, then run `check`. It saves the full local delta, including
added files and package metadata, without changing the upstream checkout.

For an upstream release, fetch and check out its npm `gitHead` in the matching
clean upstream checkout. Then run, for example:

```sh
npm run codemirror:upstream -- upgrade view /tmp/cm-view
npm run codemirror:upstream -- check view /tmp/cm-view
npm run build:codemirror-vendor
npm install --ignore-scripts
npm run test:codemirror
npm run typecheck
```

Upgrade applies all patches in a disposable copy before replacing source,
tests, metadata, or dependency paths. Conflicts stop the operation with the
current vendor files untouched. Resolve conflicting changes in a separate
checkout, port the resolved source into the vendor directory, update
`upstream.json` and `UPSTREAM.md` to that release, then `refresh`, `check`, and
rebuild. Read the patch diff and upstream changelog; patch application alone
does not prove behavioral compatibility. Run upstream tests as well as Acode's
regressions and Android benchmarks for each upgrade.

Only `view` and `language` need this process. Other CodeMirror packages keep
their normal npm update workflow, subject to compatible dependency versions.
