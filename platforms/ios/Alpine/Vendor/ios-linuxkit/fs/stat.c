#include <string.h>
#include <sys/stat.h>
#include <limits.h>

#include "kernel/calls.h"
#include "kernel/errno.h"
#include "kernel/fs.h"
#include "fs/fd.h"
#include "fs/path.h"

// ARM64 stat conversion (128 bytes struct)
struct stat_arm64 stat_convert_arm64(struct statbuf stat) {
    struct stat_arm64 arm64stat = {};
    arm64stat.dev = stat.dev;
    arm64stat.ino = stat.inode;
    arm64stat.mode = stat.mode;
    arm64stat.nlink = stat.nlink;
    arm64stat.uid = stat.uid;
    arm64stat.gid = stat.gid;
    arm64stat.rdev = stat.rdev;
    arm64stat.__pad1 = 0;
    arm64stat.size = stat.size;
    arm64stat.blksize = stat.blksize;
    arm64stat.__pad2 = 0;
    arm64stat.blocks = stat.blocks;
    arm64stat.atime_ = stat.atime;
    arm64stat.atime_nsec = stat.atime_nsec;
    arm64stat.mtime_ = stat.mtime;
    arm64stat.mtime_nsec = stat.mtime_nsec;
    arm64stat.ctime_ = stat.ctime;
    arm64stat.ctime_nsec = stat.ctime_nsec;
    arm64stat.__unused4 = 0;
    arm64stat.__unused5 = 0;
    return arm64stat;
}

int generic_statat(struct fd *at, const char *path_raw, struct statbuf *stat, bool follow_links) {
    char path[MAX_PATH];
    int err = path_normalize(at, path_raw, path, follow_links ? N_SYMLINK_FOLLOW : N_SYMLINK_NOFOLLOW);
    if (err < 0)
        return err;
    struct mount *mount = find_mount_and_trim_path(path);
    memset(stat, 0, sizeof(*stat));
    err = mount->fs->stat(mount, path, stat);
    mount_release(mount);
    return err;
}

// TODO get rid of this and maybe everything else in the file
static struct fd *at_fd(fd_t f) {
    if (f == AT_FDCWD_)
        return AT_PWD;
    return f_get(f);
}

static dword_t sys_stat_path(fd_t at_f, addr_t path_addr, addr_t statbuf_addr, bool follow_links) {
    int err;
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("stat(at=%d, path=\"%s\", statbuf=0x%x, follow_links=%d)", at_f, path, statbuf_addr, follow_links);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    struct statbuf stat = {};
    if ((err = generic_statat(at, path, &stat, follow_links)) < 0)
        return err;
    struct stat_arm64 arm64stat = stat_convert_arm64(stat);
    if (user_put(statbuf_addr, arm64stat))
        return _EFAULT;
    return 0;
}

dword_t sys_stat64(addr_t path_addr, addr_t statbuf_addr) {
    return sys_stat_path(AT_FDCWD_, path_addr, statbuf_addr, true);
}

dword_t sys_lstat64(addr_t path_addr, addr_t statbuf_addr) {
    return sys_stat_path(AT_FDCWD_, path_addr, statbuf_addr, false);
}

dword_t sys_fstatat64(fd_t at, addr_t path_addr, addr_t statbuf_addr, dword_t flags) {
    return sys_stat_path(at, path_addr, statbuf_addr, !(flags & AT_SYMLINK_NOFOLLOW_));
}

dword_t sys_fstat64(fd_t fd_no, addr_t statbuf_addr) {
    STRACE("fstat64(%d, 0x%x)", fd_no, statbuf_addr);
    struct fd *fd = f_get(fd_no);
    if (fd == NULL)
        return _EBADF;
    struct statbuf stat = {};
    int err = fd->mount->fs->fstat(fd, &stat);
    if (err < 0)
        return err;
    struct stat_arm64 arm64stat = stat_convert_arm64(stat);
    if (user_put(statbuf_addr, arm64stat))
        return _EFAULT;
    return 0;
}

dword_t sys_statx(fd_t at_f, addr_t path_addr, int_t flags, uint_t mask, addr_t statx_addr) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;

    STRACE("statx(at=%d, path=\"%s\", flags=%d, mask=%d, statx=0x%x)", at_f, path, flags, mask, statx_addr);

    struct statbuf stat = {};

    if ((flags & AT_EMPTY_PATH_) && strcmp(path, "") == 0) {
        struct fd *fd = at;
        int err = fd->mount->fs->fstat(fd, &stat);
        if (err < 0)
            return err;
    } else {
        bool follow_links = !(flags & AT_SYMLINK_NOFOLLOW_);
        int err = generic_statat(at, path, &stat, follow_links);
        if (err < 0)
            return err;
    }

    // for now, ignore the requested mask and just fill in the same fields as stat returns
    struct statx_ statx = {};
    statx.mask = STATX_BASIC_STATS_;
    statx.blksize = stat.blksize;
    statx.nlink = stat.nlink;
    statx.uid = stat.uid;
    statx.gid = stat.gid;
    statx.mode = stat.mode;
    statx.ino = stat.inode;
    statx.size = stat.size;
    statx.blocks = stat.blocks;
    statx.atime.sec = stat.atime;
    statx.atime.nsec = stat.atime_nsec;
    statx.mtime.sec = stat.mtime;
    statx.mtime.nsec = stat.mtime_nsec;
    statx.ctime.sec = stat.ctime;
    statx.ctime.nsec = stat.ctime_nsec;
    statx.rdev_major = dev_major(stat.rdev);
    statx.rdev_minor = dev_minor(stat.rdev);
    statx.dev_major = dev_major(stat.dev);
    statx.dev_minor = dev_minor(stat.dev);

    if (user_put(statx_addr, statx))
        return _EFAULT;
    return 0;
}
