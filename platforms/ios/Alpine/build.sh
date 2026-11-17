#!/bin/bash
set -euo pipefail

alpine_dir=$(cd "$(dirname "$0")" && pwd)
printf '%s  %s\n' '2f2f07e388fd5701eec4d008e67f2a9a2c05564dbd09a3fea96c9dc1cee42765' "$alpine_dir/Assets/axs" | shasum -a 256 -c -
export PATH="${ACODE_BUILD_TOOLS:-/opt/homebrew/bin}:/usr/local/bin:$PATH"
export PATH="${ACODE_LLD_BIN:-/opt/homebrew/opt/lld/bin}:$PATH"
for tool in meson ninja ld.lld; do
    command -v "$tool" >/dev/null || { echo "error: Install Alpine build tools: brew install meson ninja llvm lld"; exit 1; }
done

sdk=${SDKROOT:-$(xcrun --sdk iphonesimulator --show-sdk-path)}
platform=${PLATFORM_NAME:-iphonesimulator}
build_dir=${DERIVED_FILE_DIR:-"$alpine_dir/../../../.ios-build/alpine"}/Alpine-$platform
mkdir -p "$build_dir"
target="arm64-apple-ios${IPHONEOS_DEPLOYMENT_TARGET:-18.6}"
if [[ "$platform" == iphonesimulator ]]; then target="$target-simulator"; fi
if [[ "${ARCHS:-arm64}" != arm64 ]]; then
    echo "error: The Alpine runtime requires an ARM64 device or Apple Silicon simulator."
    exit 1
fi

crossfile="$build_dir.cross.ini"
cat > "$crossfile.tmp" <<EOF
[binaries]
c = '/usr/bin/clang'
ar = '/usr/bin/ar'
[host_machine]
system = 'darwin'
cpu_family = 'aarch64'
cpu = 'arm64'
endian = 'little'
[built-in options]
c_args = ['-target', '$target', '-isysroot', '$sdk', '-D_XOPEN_SOURCE=700', '-D_DARWIN_C_SOURCE']
c_link_args = ['-target', '$target', '-isysroot', '$sdk']
[properties]
needs_exe_wrapper = true
sdk_path = '$sdk'
EOF
# Preserve timestamps so an unchanged Xcode build remains incremental.
if ! cmp -s "$crossfile.tmp" "$crossfile"; then mv "$crossfile.tmp" "$crossfile"; else rm "$crossfile.tmp"; fi
export CC_FOR_BUILD=/usr/bin/clang
# Meson caches compiler flags separately; rewriting the cross file is not enough
# after an SDK or deployment-target change. Keep it outside the directory wiped.
if [[ ! -f "$build_dir/build.ninja" ]] || ! cmp -s "$crossfile" "$build_dir/configured-cross.ini"; then
    setup_options=(setup)
    if [[ -d "$build_dir/meson-private" ]]; then setup_options+=(--wipe); fi
    meson "${setup_options[@]}" "$build_dir" "$alpine_dir/Vendor/ios-linuxkit" --cross-file "$crossfile" -Dbuildtype=release
    cp "$crossfile" "$build_dir/configured-cross.ini"
fi
ninja -C "$build_dir" libish.a libish_emu.a libfakefs.a libacode_alpine.a libacode_archive.a
test -s "$build_dir/vdso/arm64/libvdso.so.elf" || { echo "error: ARM64 Linux VDSO was not built. Install llvm and lld."; exit 1; }
archives=("$build_dir/libacode_alpine.a" "$build_dir/libish.a" "$build_dir/libish_emu.a" "$build_dir/libfakefs.a" "$build_dir/libacode_archive.a")
for archive in "${archives[@]}"; do
    if [[ "$archive" -nt "$build_dir/libAcodeAlpine.a" ]]; then
        /usr/bin/libtool -static -o "$build_dir/libAcodeAlpine.a" "${archives[@]}"
        break
    fi
done

if [[ -n "${TARGET_BUILD_DIR:-}" ]]; then
    resources="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Alpine"
    mkdir -p "$resources"
    cp "$alpine_dir/../../android/app/src/store/assets/alpine_assets/arm64/alpine.rootfs" "$resources/alpine.rootfs"
    cp "$alpine_dir/../../android/app/src/main/assets/init-alpine.sh" "$resources/init-alpine.sh"
    cp "$alpine_dir/Assets/axs" "$resources/axs"
    cp "$alpine_dir/Vendor/ios-linuxkit/LICENSE.md" "$resources/ios-linuxkit-LICENSE.md"
    cp "$alpine_dir/Vendor/ios-linuxkit/LICENSE.IOS" "$resources/LICENSE.IOS"
    cp "$alpine_dir/GPL-3.0.txt" "$resources/GPL-3.0.txt"
    cp "$alpine_dir/Vendor/ios-linuxkit/deps/libarchive/COPYING" "$resources/libarchive-COPYING"
    cp "$alpine_dir/README.md" "$resources/README.md"
fi
