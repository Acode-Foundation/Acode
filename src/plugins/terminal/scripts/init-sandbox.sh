export LD_LIBRARY_PATH=$PREFIX
export PROOT_TMP_DIR=$PREFIX/tmp


if [ -f "$NATIVE_DIR/libproot.so" ]; then
    export PROOT_LOADER="$NATIVE_DIR/libproot.so"
fi

if [ -f "$NATIVE_DIR/libproot32.so" ]; then
    export PROOT_LOADER32="$NATIVE_DIR/libproot32.so"
fi

mkdir -p "$PREFIX/tmp"

if [ "$FDROID" = "true" ]; then
    export PROOT="$PREFIX/libproot-xed.so"
    chmod +x $PROOT
    chmod +x $PREFIX/libtalloc.so.2
else
    if [ -e "$PREFIX/libtalloc.so.2" ] || [ -L "$PREFIX/libtalloc.so.2" ]; then
        rm "$PREFIX/libtalloc.so.2"
    fi
    ln -s "$NATIVE_DIR/libtalloc.so" "$PREFIX/libtalloc.so.2"
    export PROOT="$NATIVE_DIR/libproot-xed.so"
fi


$PROOT -b $PREFIX:$PREFIX -b /data:/data -b /system:/system -b /vendor:/vendor -S $PREFIX/alpine /bin/sh $PREFIX/init-alpine.sh "$@"