# Vendored CodeMirror packages

Acode carries narrow forks of `@codemirror/view` and
`@codemirror/language` for Android/WebView rendering behavior that cannot be
implemented through public CodeMirror extensions.

- `codemirror-view` is based on 6.43.9 at
  `d4e1656e1a0060f562695df93cb1775c0cdee24f`.
- `codemirror-language` is based on 6.12.4 at
  `89974ce5d39539ce6c5cfea5278443fa9381cbf2`.

The view fork adds bounded directional buffering and opt-in render-gated
Android touch scrolling with Android spline momentum. Its four-screen render
window rolls through longer flings without committing uncovered positions.
The language fork adds generation-scoped provisional
outer-language highlighting. Both features are absent unless their exported
extensions are installed.

Run `npm run build:codemirror-vendor` after changing either package. Commit
the generated `dist/` output and deterministic package archives with the
source change. Acode installs the archives instead of symlinking the source
directories so every dependency resolves the same CodeMirror module instance.
Licenses, upstream changelogs, and upstream tests are retained inside each
package directory.
