#!/bin/sh

unlink_recursive() {
    path="$1"

    # Try to recurse into it as a directory first
    for entry in "$path"/* "$path"/.[!.]* "$path"/..?*; do
        case "$entry" in
            *'*'*|*'?'*) continue ;;
        esac
        unlink_recursive "$entry"
    done 2>/dev/null
    
    unlink "$path" 2>/dev/null || :
}

for target in "$@"; do
    unlink_recursive "$target"
done

busybox rm "$@"