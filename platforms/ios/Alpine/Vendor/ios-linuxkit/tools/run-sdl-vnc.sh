#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT/build-linux-harness}"
ISH_BIN="${ISH_BIN:-$ROOT/build-arm64-linux/ish}"
HARNESS_BIN="${HARNESS_BIN:-$BUILD_DIR/tools/ish-sdl-vnc}"
ROOTFS_DIR="${ROOTFS_DIR:-$ROOT/alpine-arm64-fakefs}"
FONT_PATH="${FONT_PATH:-/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf}"
VNC_PORT="${VNC_PORT:-5907}"
COLS="${COLS:-120}"
ROWS="${ROWS:-36}"
FONT_SIZE="${FONT_SIZE:-18}"
HEADLESS="${HEADLESS:-0}"

if [[ ! -x "$HARNESS_BIN" ]]; then
  echo "missing harness binary: $HARNESS_BIN" >&2
  exit 1
fi
if [[ ! -x "$ISH_BIN" ]]; then
  echo "missing ish binary: $ISH_BIN" >&2
  exit 1
fi
if [[ ! -d "$ROOTFS_DIR" ]]; then
  echo "missing rootfs dir: $ROOTFS_DIR" >&2
  exit 1
fi

args=(
  "$HARNESS_BIN"
  --ish "$ISH_BIN"
  --rootfs "$ROOTFS_DIR"
  --font "$FONT_PATH"
  --font-size "$FONT_SIZE"
  --cols "$COLS"
  --rows "$ROWS"
  --vnc-port "$VNC_PORT"
)

if [[ "$HEADLESS" != "0" ]]; then
  args+=(--headless)
fi

if [[ "$#" -gt 0 ]]; then
  args+=(-- "$@")
fi

exec "${args[@]}"
