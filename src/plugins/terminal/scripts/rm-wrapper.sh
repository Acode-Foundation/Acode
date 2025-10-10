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
    
    # Then try to remove the path itself
    if rmdir "$path" 2>/dev/null; then
        :
    elif unlink "$path" 2>/dev/null; then
        :
    else
        :
    fi
}

for target in "$@"; do
    echo "Unlinking broken symlinks..."
    unlink_recursive "$target"
done

busybox rm "$@"