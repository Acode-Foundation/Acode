export LD_LIBRARY_PATH=$PREFIX

mkdir -p "$PREFIX/tmp"
mkdir -p "$PREFIX/alpine/tmp"
mkdir -p "$PREFIX/public"

export PROOT_TMP_DIR=$PREFIX/tmp

if [ "$FDROID" = "true" ]; then

    if [ -f "$PREFIX/libproot.so" ]; then
        export PROOT_LOADER="$PREFIX/libproot.so"
    fi

    if [ -f "$PREFIX/libproot32.so" ]; then
        export PROOT_LOADER32="$PREFIX/libproot32.so"
    fi


    export PROOT="$PREFIX/libproot-xed.so"
    chmod +x $PREFIX/*
else
    if [ -f "$NATIVE_DIR/libproot.so" ]; then
        export PROOT_LOADER="$NATIVE_DIR/libproot.so"
    fi

    if [ -f "$NATIVE_DIR/libproot32.so" ]; then
        export PROOT_LOADER32="$NATIVE_DIR/libproot32.so"
    fi


    if [ -e "$PREFIX/libtalloc.so.2" ] || [ -L "$PREFIX/libtalloc.so.2" ]; then
        rm "$PREFIX/libtalloc.so.2"
    fi

    ln -s "$NATIVE_DIR/libtalloc.so" "$PREFIX/libtalloc.so.2"
    export PROOT="$NATIVE_DIR/libproot-xed.so"
fi

ARGS="--kill-on-exit"



for system_mnt in /apex /odm /product /system /system_ext /vendor /linkerconfig/ld.config.txt /linkerconfig/com.android.art/ld.config.txt /plat_property_contexts /property_contexts; do

 if [ -e "$system_mnt" ]; then
  system_mnt=$(realpath "$system_mnt")
  ARGS="$ARGS -b ${system_mnt}"
 fi
done




unset system_mnt

ARGS="$ARGS -b /sdcard"
ARGS="$ARGS -b /storage"
ARGS="$ARGS -b /dev"
ARGS="$ARGS -b /data"
ARGS="$ARGS -b /dev/urandom:/dev/random"
ARGS="$ARGS -b /proc"
ARGS="$ARGS -b /sys"
ARGS="$ARGS -b $PREFIX"
ARGS="$ARGS -b $NATIVE_DIR"
ARGS="$ARGS -b $PREFIX/public:/public"
ARGS="$ARGS -b $PREFIX/public:/home"
ARGS="$ARGS -b $PREFIX/public:/root"
ARGS="$ARGS -b $PREFIX/alpine/tmp:/dev/shm"


# PRoot canonicalizes every -b host path with realpath(3).  The magic links
# under /proc/self/fd only resolve when the descriptor points at a real file:
# for pipes, sockets, anon inodes or memfds the link target is not a path
# ("pipe:[123]"), so realpath(3) fails with ENOENT, proot drops the binding and
# prints `can't sanitize binding "/proc/self/fd/N"`.  `[ -e ]` follows the magic
# link to the underlying inode and therefore returns true for those descriptors,
# which is why it does not filter them out.  Test the link target the same way
# realpath(3) does instead.
#
# Probe through this shell's own pid ($$), not /proc/self: readlink(1) runs as a
# child process, so for fd 2 its /proc/self/fd/2 is the /dev/null of the
# `2>/dev/null` redirect below rather than the stderr proot inherits.  $$ is
# unchanged by the exec at the end of this script, so it always names the
# process proot will run as.
SELF_PID=$$

can_bind() {
    # Directories (e.g. /proc/self/fd) are canonicalizable as-is.
    if [ -d "$1" ]; then
        return 0
    fi

    # A /proc/self/fd/N magic link is only canonicalizable when it resolves to
    # an existing absolute path; "pipe:[N]", "socket:[N]" and friends are not.
    target=$(readlink "$1" 2>/dev/null) || return 1

    case "$target" in
        /*) [ -e "$target" ] ;;
        *) return 1 ;;
    esac
}

if can_bind "/proc/$SELF_PID/fd"; then
  ARGS="$ARGS -b /proc/self/fd:/dev/fd"
fi

if can_bind "/proc/$SELF_PID/fd/0"; then
  ARGS="$ARGS -b /proc/self/fd/0:/dev/stdin"
fi

if can_bind "/proc/$SELF_PID/fd/1"; then
  ARGS="$ARGS -b /proc/self/fd/1:/dev/stdout"
fi

if can_bind "/proc/$SELF_PID/fd/2"; then
  ARGS="$ARGS -b /proc/self/fd/2:/dev/stderr"
fi


ARGS="$ARGS -r $PREFIX/alpine"
ARGS="$ARGS -0"
ARGS="$ARGS --link2symlink"
ARGS="$ARGS --sysvipc"
ARGS="$ARGS -L"


FAILSAFE=false
INSTALLING=false

for arg in "$@"; do
    case "$arg" in
        --failsafe)
            FAILSAFE=true
            ;;
        --installing)
            INSTALLING=true
            ;;
    esac
done

if [ "$FAILSAFE" = true ] && [ "$INSTALLING" != true ]; then
    echo "$$" > "$PREFIX/pid"

    LINKER="/system/bin/linker64"
    ARCH="$(uname -m)"
    if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "x86_64" ]; then
        LINKER="/system/bin/linker"
    fi

    exec "$LINKER" "$PREFIX/axs" -c "sh"
else
    exec "$PROOT" $ARGS /bin/sh "$PREFIX/init-alpine.sh" "$@"
fi