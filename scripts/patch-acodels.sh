#!/bin/sh
set -eu

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_FILE="$SCRIPT_DIR/LS-SERVER-V2.txt"
PKG_NAME="acode-lsp"

command -v node >/dev/null 2>&1 || die "node is not installed or not in PATH."
command -v npm >/dev/null 2>&1 || die "npm is not installed or not in PATH."

[ -f "$SOURCE_FILE" ] || die "Missing patch file: $SOURCE_FILE"

NODE_PATH=$(command -v node)

# Try to find the installed executable first.
TARGET_BIN=$(command -v acode-ls 2>/dev/null || command -v acode-lsp 2>/dev/null || true)

# If not installed, install it globally.
if [ -z "$TARGET_BIN" ]; then
  printf 'acode-ls not found in PATH. Installing %s globally...\n' "$PKG_NAME"
  npm install -g "$PKG_NAME"
  TARGET_BIN=$(command -v acode-ls 2>/dev/null || command -v acode-lsp 2>/dev/null || true)
fi

[ -n "$TARGET_BIN" ] || die "acode-ls/acode-lsp is still not found after installation."

printf 'Found target executable at: %s\n' "$TARGET_BIN"
printf 'Using node at: %s\n' "$NODE_PATH"

BACKUP_FILE="$TARGET_BIN.backup"
if [ -e "$BACKUP_FILE" ]; then
  BACKUP_FILE="$TARGET_BIN.backup.$(date +%Y%m%d%H%M%S)"
fi

cp "$TARGET_BIN" "$BACKUP_FILE"

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT INT HUP TERM

# Replace the first line (shebang) with the current system node path.
first_line=$(head -n 1 "$SOURCE_FILE" || true)
if printf '%s' "$first_line" | grep -q '^#!'; then
  {
    printf '#!%s\n' "$NODE_PATH"
    tail -n +2 "$SOURCE_FILE"
  } > "$TMP_FILE"
else
  {
    printf '#!%s\n' "$NODE_PATH"
    cat "$SOURCE_FILE"
  } > "$TMP_FILE"
fi

cp "$TMP_FILE" "$TARGET_BIN"
chmod +x "$TARGET_BIN"

printf 'Patch applied successfully.\n'
printf 'Backup saved at: %s\n' "$BACKUP_FILE"
printf 'Done :)\\n'
