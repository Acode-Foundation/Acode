// libfakefs_redirect.dylib — DYLD interpose library for native offload.
//
// Injected via DYLD_INSERT_LIBRARIES into native processes spawned by
// native_offload. Intercepts filesystem syscalls and transparently redirects
// absolute paths from guest root (/) to the fakefs data directory on host.
//
// Config via environment variables:
//   FAKEFS_ROOT=/path/to/fakefs/data   (required)
//
// Example: guest "/tmp/foo.mp4" → host "/Users/.../fakefs/data/tmp/foo.mp4"

#include <fcntl.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
#include <limits.h>
#include <dlfcn.h>

// --- Configuration ---

static char g_root[PATH_MAX];    // fakefs data root, e.g. "/Users/.../fakefs/data"
static size_t g_root_len;
static int g_initialized;

// Directories to NOT redirect (host-only paths that native binaries need)
static const char *passthrough_prefixes[] = {
    "/dev/",
    "/opt/",
    "/usr/local/",
    "/usr/lib/",
    "/usr/share/",
    "/System/",
    "/Library/",
    "/Applications/",
    "/private/",
    "/Users/",
    "/cores/",
    "/AppleInternal/",
    NULL
};

__attribute__((constructor))
static void fakefs_redirect_init(void) {
    const char *root = getenv("FAKEFS_ROOT");
    if (!root || !root[0])
        return;
    size_t len = strlen(root);
    // Strip trailing slash
    if (len > 1 && root[len - 1] == '/') len--;
    if (len >= PATH_MAX) return;
    memcpy(g_root, root, len);
    g_root[len] = '\0';
    g_root_len = len;
    g_initialized = 1;
}

// Rewrite an absolute guest path to a host fakefs path.
// Returns `buf` if rewritten, or the original `path` if no rewrite needed.
static const char *redirect_path(const char *path, char *buf, size_t bufsz) {
    if (!g_initialized || !path || path[0] != '/')
        return path;

    // Don't redirect paths that are already under the fakefs root
    if (strncmp(path, g_root, g_root_len) == 0)
        return path;

    // Don't redirect host-only paths
    for (const char **pp = passthrough_prefixes; *pp; pp++) {
        size_t plen = strlen(*pp);
        if (strncmp(path, *pp, plen) == 0)
            return path;
    }

    // Also passthrough /usr/bin and /usr/sbin (but NOT /usr — guest has /usr/share etc.)
    if (strncmp(path, "/usr/bin/", 9) == 0 || strncmp(path, "/usr/sbin/", 10) == 0)
        return path;

    // Redirect: prepend fakefs root
    size_t plen = strlen(path);
    if (g_root_len + plen + 1 > bufsz)
        return path;  // too long, skip

    memcpy(buf, g_root, g_root_len);
    memcpy(buf + g_root_len, path, plen + 1);  // includes '\0'
    return buf;
}

// --- Interposed functions ---
// We use the __DATA,__interpose section which is cleaner than dlsym(RTLD_NEXT).
// dyld patches the GOT so all calls from the target binary go through our wrappers.

#define DYLD_INTERPOSE(_replacement, _replacee) \
    __attribute__((used)) static struct { const void *r; const void *e; } \
    _interpose_##_replacee \
    __attribute__((section("__DATA,__interpose,interposing"))) = { \
        (const void *)(unsigned long)&_replacement, \
        (const void *)(unsigned long)&_replacee \
    };

// open
static int my_open(const char *path, int flags, ...) {
    char buf[PATH_MAX];
    path = redirect_path(path, buf, sizeof(buf));
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    return open(path, flags, mode);
}
DYLD_INTERPOSE(my_open, open)

// openat — only redirect if fd == AT_FDCWD and path is absolute
static int my_openat(int fd, const char *path, int flags, ...) {
    char buf[PATH_MAX];
    if (fd == AT_FDCWD)
        path = redirect_path(path, buf, sizeof(buf));
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    return openat(fd, path, flags, mode);
}
DYLD_INTERPOSE(my_openat, openat)

// stat
static int my_stat(const char *path, struct stat *sb) {
    char buf[PATH_MAX];
    return stat(redirect_path(path, buf, sizeof(buf)), sb);
}
DYLD_INTERPOSE(my_stat, stat)

// lstat
static int my_lstat(const char *path, struct stat *sb) {
    char buf[PATH_MAX];
    return lstat(redirect_path(path, buf, sizeof(buf)), sb);
}
DYLD_INTERPOSE(my_lstat, lstat)

// access
static int my_access(const char *path, int mode) {
    char buf[PATH_MAX];
    return access(redirect_path(path, buf, sizeof(buf)), mode);
}
DYLD_INTERPOSE(my_access, access)

// faccessat
static int my_faccessat(int fd, const char *path, int mode, int flag) {
    char buf[PATH_MAX];
    if (fd == AT_FDCWD)
        path = redirect_path(path, buf, sizeof(buf));
    return faccessat(fd, path, mode, flag);
}
DYLD_INTERPOSE(my_faccessat, faccessat)

// opendir
static DIR *my_opendir(const char *path) {
    char buf[PATH_MAX];
    return opendir(redirect_path(path, buf, sizeof(buf)));
}
DYLD_INTERPOSE(my_opendir, opendir)

// realpath
static char *my_realpath(const char *path, char *resolved) {
    char buf[PATH_MAX];
    return realpath(redirect_path(path, buf, sizeof(buf)), resolved);
}
DYLD_INTERPOSE(my_realpath, realpath)

// rename
static int my_rename(const char *old, const char *new) {
    char buf1[PATH_MAX], buf2[PATH_MAX];
    return rename(redirect_path(old, buf1, sizeof(buf1)),
                  redirect_path(new, buf2, sizeof(buf2)));
}
DYLD_INTERPOSE(my_rename, rename)

// unlink
static int my_unlink(const char *path) {
    char buf[PATH_MAX];
    return unlink(redirect_path(path, buf, sizeof(buf)));
}
DYLD_INTERPOSE(my_unlink, unlink)

// mkdir
static int my_mkdir(const char *path, mode_t mode) {
    char buf[PATH_MAX];
    return mkdir(redirect_path(path, buf, sizeof(buf)), mode);
}
DYLD_INTERPOSE(my_mkdir, mkdir)

// rmdir
static int my_rmdir(const char *path) {
    char buf[PATH_MAX];
    return rmdir(redirect_path(path, buf, sizeof(buf)));
}
DYLD_INTERPOSE(my_rmdir, rmdir)

// chdir
static int my_chdir(const char *path) {
    char buf[PATH_MAX];
    return chdir(redirect_path(path, buf, sizeof(buf)));
}
DYLD_INTERPOSE(my_chdir, chdir)

// fopen
static FILE *my_fopen(const char *path, const char *mode) {
    char buf[PATH_MAX];
    return fopen(redirect_path(path, buf, sizeof(buf)), mode);
}
DYLD_INTERPOSE(my_fopen, fopen)

// truncate
static int my_truncate(const char *path, off_t length) {
    char buf[PATH_MAX];
    return truncate(redirect_path(path, buf, sizeof(buf)), length);
}
DYLD_INTERPOSE(my_truncate, truncate)

// readlink
static ssize_t my_readlink(const char *path, char *lbuf, size_t bufsiz) {
    char pbuf[PATH_MAX];
    return readlink(redirect_path(path, pbuf, sizeof(pbuf)), lbuf, bufsiz);
}
DYLD_INTERPOSE(my_readlink, readlink)

// chmod
static int my_chmod(const char *path, mode_t mode) {
    char buf[PATH_MAX];
    return chmod(redirect_path(path, buf, sizeof(buf)), mode);
}
DYLD_INTERPOSE(my_chmod, chmod)
