# Acode iOS Alpine runtime

The existing Acode xterm UI connects to the same AXS HTTP/WebSocket API used on
Android. ARM64 Linux programs run inside ios-linuxkit's interpreter; they are not
launched as unsigned iOS executables.

On iOS that API is served by the app, not by AXS inside the guest. Only the
shells are emulated:

```
xterm.js ──ws/http──▶ TerminalServer (Swift, 127.0.0.1:8767)
                         └─ TerminalSession ──▶ Bridge/AlpineTerminal.c ──▶ /dev/pts/N ──▶ bash
```

`AlpineTerminal.c` registers a tty driver whose output goes straight to Swift
and whose input, resize and hangup go straight to the guest tty. Terminal I/O
therefore never uses emulated sockets, epoll or threads, and the guest pty still
provides job control, termios and `SIGWINCH`. `init-alpine.sh --prepare` runs
once per boot; each terminal then starts `bash --rcfile /initrc -i` directly.
The AXS binary stays in the guest as `axs` for users and plugins.

The native Executor services use guest processes and pipes. Apple
Network.framework supplies the raw process WebSocket transport for
`Executor.spawnStream`.

## Sources

| Component | Pinned source |
| --- | --- |
| Kernel, ARM64 interpreter, fakefs | [rcarmo/ios-linuxkit](https://github.com/rcarmo/ios-linuxkit/tree/61719f8177499f789fc2f7f421ea919ac7780608), `61719f8177499f789fc2f7f421ea919ac7780608` |
| libarchive | `deps/libarchive` and `deps/config.h` from that same revision; BSD notices retained |
| AXS | [bajrangCoder/acodex_server v0.2.17](https://github.com/bajrangCoder/acodex_server/releases/tag/v0.2.17), asset `axs-musl-android-arm64` |
| Alpine rootfs | The existing Android ARM64 Alpine 3.21.0 asset, copied at build time |
| Shell setup | The existing Android `init-alpine.sh`, with `ALPINE_ROOT=/` on iOS |

AXS SHA-256: `2f2f07e388fd5701eec4d008e67f2a9a2c05564dbd09a3fea96c9dc1cee42765`.
Its upstream Rust source revision is `2fb966607893e3b8f0e243d71c83a505c06951b3`.
To replace it, build the pinned source with `cross build --release --locked
--target aarch64-unknown-linux-musl`, or verify the published asset's checksum.

The vendored runtime includes its GPL attribution and iOS distribution exception.
`GPL-3.0.txt` contains the license text. Distributions linking this runtime must
provide corresponding source under the applicable GPL terms; existing notices
for Acode and other dependencies still apply.

## Build

On an Apple Silicon Mac, install `brew install meson ninja llvm lld`, then use the
normal Acode iOS commands or build in Xcode. The **Build Alpine** phase compiles
the static runtime and Linux VDSO, then copies the existing rootfs and startup
script into the app. No Meson build products or developer paths are committed.
`ACODE_BUILD_TOOLS` and `ACODE_LLD_BIN` can point to alternative tool directories.
ARM64 devices and ARM64 simulators are supported.

Both shared Xcode schemes load `Alpine/lldbinit` for Run and Test. It passes
`SIGUSR1` to the runtime without stopping the debugger; Alpine uses this signal
to wake guest threads. With LLDB's default handling, Xcode pauses the entire app
during installation, and returning to the paused app can show a black screen.
For an already-paused session, run `process handle -p true -s false -n false
SIGUSR1` in Xcode's debug console, then `continue`.

## Local adaptations

- `platform/darwin.c` imports Dispatch for `dispatch_once`.
- `meson.build` builds the selected upstream libarchive sources and Acode bridge;
  command-line utilities and upstream e2e tests are excluded from cross builds.
- `fs/fake.c` releases its host root descriptor and bind table when unmounted.
- `fs/real.c` translates Darwin directory-unlink `EPERM` to Linux `EISDIR`,
  allowing Bun to remove directory locks.
- `/proc/stat` includes all ten CPU counters and `/proc/<pid>/stat` reports
  immutable process start ticks for process inspection and daemon identity checks.
- `kernel/group.c` handles the last terminal session member exiting after its
  session leader has been reaped.
- Synchronous memory and illegal-instruction faults restore default handling if
  their signals are blocked or ignored, preventing infinite fault retries.
- ARM64 halfword lane loads and stores decode the lane index correctly, including
  post-indexed addressing. This fixes Bun's hybrid TLS key exchange failures.
- The code-cache page table has 65,536 buckets to reduce unrelated code
  invalidation during Bun's JIT writes, using 2 MiB per guest address space.
- Block-cache hashing removes ARM64 instruction-alignment bits so all existing
  buckets are used, without increasing cache allocation.
- `kernel/exit.c` clears the exiting leader's thread-local pointer before its
  parent can reap it, preventing pthread cleanup from accessing a freed task.
- `Bridge/AlpineFaults.c` reuses upstream ARM64 fault recovery and delegates faults
  outside the guest to the app's previous signal handlers.
- `Bridge/AlpineRuntime.c` owns guest init, stdio, process cleanup and mounts.
  SIGUSR1 is unblocked only while creating guest threads, then the host worker's
  signal mask is restored.
- `Bridge/AlpineTerminal.c` connects guest pseudo-terminals to Swift through
  `pty_open_fake`, as iSH does for its terminal view.
- `alpine_suspend`/`alpine_resume` run upstream `sockrestart` when the app moves
  to the background and back, so guest servers keep their listening sockets.

The guest root lives at `Library/Alpine`, outside every host bind mount. `/public`,
`/home` and `/root` share Acode's Terminal Public directory. `/acode` maps app data,
and authorized Files roots are also mapped at their native paths for language
servers. Linux filesystem metadata is owned by fakefs; do not edit its `data/`
directory with FileManager. The `alpine://localhost/` filesystem provider performs
guest file operations through the existing Executor API.

## Compatibility limits

This is Linux userspace emulation, not Android proot. APK packages run as ARM64
Linux programs, but support still depends on the emulator's instructions and
syscalls. Upstream forces Node to run without JIT and with a 512 MiB old-space
limit; V8 WebAssembly and packages requiring unsupported syscalls may not work.
The injected `--no-expose-wasm` flag suppresses V8's conflicting-flag warning;
it does not enable WebAssembly.
Bun (including compiled CLIs such as OpenCode) keeps baseline JIT for FFI, while
optimizing/concurrent JIT and concurrent garbage collection are disabled through
`BUN_JSC_` guest settings. iOS shell setup installs
`procps-ng` because daemon-based CLIs require process inspection options missing
from BusyBox `ps`. GNU `tar` and `gzip` replace BusyBox archive extraction to
reduce the CPU cost of unpacking large CLI binaries. The upstream optional
WebAssembly polyfills are not bundled. iOS may suspend or terminate the app in
the background. PRoot debug mode has no effect on iOS.
Physical-device performance, memory pressure and background behavior need their
own validation. iOS backups preserve Linux metadata and exclude host mounts;
Android proot backup archives have a different layout.

### Pi coding agent

The npm package `pi` is a numeric calculator. The coding agent is
`@earendil-works/pi-coding-agent`. Its Node entry point requires WebAssembly,
so launch it explicitly with Bun on iOS:

```sh
npm uninstall -g pi # Only if the unrelated calculator was installed.
npm install -g bun@1.4.2
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.99.1
bun --bun "$(command -v pi)"
```

The published CLI's startup, terminal input, and a local streaming HTTP response
passed simulator checks with the official ARM64 musl Bun binary. Physical-device
authentication, provider requests, and coding tasks still need validation.
