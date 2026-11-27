# Local fixtures

`halfword-lanes.elf` checks all eight ARM64 halfword lanes for loads and stores
with ordinary, immediate post-indexed and register post-indexed addressing.
Rebuild it from the repository root with LLVM and LLD:

```sh
clang --target=aarch64-linux-gnu -c platforms/ios/Alpine/Tests/halfword-lanes.S -o /tmp/halfword-lanes.o
ld.lld -static --strip-all -e _start /tmp/halfword-lanes.o -o platforms/ios/runnerTests/Fixtures/halfword-lanes.elf
```

`fault-signals.elf` checks blocked, ignored and handled synchronous `SIGSEGV` and
`SIGILL`, plus ordinary blocked signals remaining pending until unblocked.
Fatal faults must exit with the signal's status; handlers exit with status 42.
Rebuild it with:

```sh
clang --target=aarch64-linux-gnu -c platforms/ios/Alpine/Tests/fault-signals.S -o /tmp/fault-signals.o
ld.lld -static --strip-all -e _start /tmp/fault-signals.o -o platforms/ios/runnerTests/Fixtures/fault-signals.elf
```

## Plugin fixture

`install-plugin.zip` is a disposable plugin with ID `app.acode.ios-install-fixture`.
It contains its manifest, `main.js`, a short readme, Acode's existing generic plugin
icon, an empty directory and a five-byte binary file with a Unicode filename.
Inspect the readable entries with `unzip -p install-plugin.zip main.js` or
`unzip -p install-plugin.zip plugin.json`.

Its initializer reads the packaged binary asset, calls the legacy Cordova System
checksum API and reads a missing key from its isolated plugin context. It records
results in `window.iosInstalledPlugin`; unmount removes that marker. It does not
make purchases, authenticate, execute remote code or write secrets.

The integration test enters the local archive URL through the Plugins source
prompt, checks the Installed list and removes the plugin, cache and installation
state. It exercises the real installer and loader without exposing test hooks in
the app. A separate paid simulator UI check selected this fixture through Plugins
→ Local → Select document → the native Files picker and verified the same
installation results. Its temporary test and installed fixture were removed.
