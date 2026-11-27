#!/bin/bash
# Check if the provided compiler can target aarch64

CLANG="$1"

if [ -z "$CLANG" ]; then
    echo "Usage: $0 <clang-path>"
    exit 1
fi

# Try to compile and link a simple aarch64 ELF shared object
TMPFILE=$(mktemp /tmp/check-cc-arm64.XXXXXX.c)
TMPOUT=$(mktemp /tmp/check-cc-arm64.XXXXXX.so)

cat > "$TMPFILE" << 'EOF'
void _start(void) {
    __asm__ volatile("svc #0");
}
EOF

"$CLANG" -target aarch64-linux-gnu -fuse-ld=lld -shared -nostdlib -x c "$TMPFILE" -o "$TMPOUT" 2>/dev/null
RESULT=$?

rm -f "$TMPFILE" "$TMPOUT"

if [ $RESULT -ne 0 ]; then
    echo "Error: $CLANG cannot link aarch64-linux-gnu with lld"
    exit 1
fi

echo "ARM64 cross-compiler/linker check passed"
exit 0
