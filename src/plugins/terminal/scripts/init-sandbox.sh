export LD_LIBRARY_PATH=$PREFIX
export PROOT_TMP_DIR=$PREFIX/tmp
export PROOT_LOADER=$NATIVE_DIR/libproot.so
export PROOT_LOADER32=$NATIVE_DIR/libproot32.so

mkdir -p "$PREFIX/tmp"

if [ -e "$PREFIX/libtalloc.so.2" ] || [ -L "$PREFIX/libtalloc.so.2" ]; then
    rm "$PREFIX/libtalloc.so.2"
fi

ln -s "$NATIVE_DIR/libtalloc.so" "$PREFIX/libtalloc.so.2"


$NATIVE_DIR/libproot-xed.so -b $PREFIX:$PREFIX -b /data:/data -b /system:/system -b /vendor:/vendor -R $PREFIX/alpine sh $PREFIX/init-alpine.sh "$@"