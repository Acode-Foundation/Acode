# Generated CodeMirror packages

`npm run build:codemirror-vendor` rebuilds the vendored forks and refreshes
the package archives in this directory. The root project installs these
archives to preserve CodeMirror singleton identity across all dependencies.
Filenames include a content hash so npm cannot reuse an older local build at
the same upstream version. Install after building to refresh the lockfile, and
retain only the archives referenced by the root package manifest.
