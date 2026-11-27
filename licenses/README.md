# Native source attribution

The Android host was adapted from [Proteus](https://github.com/foxbiz/proteus),
revision `e350d77e0b60c361d93853b23858828200770898`.
The [native source inventory](native-provenance.json) records upstream plugin
identities and versions. These names document source ownership and licensing;
they are not build dependencies or runtime registration.

Apache notices and original license texts are retained in this directory.
Adaptations replace runtime imports, callback handling and native service
registration with the app-owned bridge. Java packages and classes have been
renamed to match their current source locations.

The HTTP MIT license is preserved from the [upstream license](https://github.com/silkimen/cordova-plugin-advanced-http/blob/master/LICENSE).

The iOS Alpine runtime has separate GPL licensing and retained upstream sources. See [the runtime provenance](../platforms/ios/Alpine/README.md) and its GPL and libarchive license texts.
