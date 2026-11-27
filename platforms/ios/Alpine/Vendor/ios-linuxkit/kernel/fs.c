#include "debug.h"
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "kernel/calls.h"
#include "kernel/errno.h"
#include "kernel/task.h"
#include "kernel/fs.h"
#include "fs/fd.h"
#include "fs/path.h"
#include "fs/dev.h"
#include "fs/real.h"
#include "platform/platform.h"

static struct fd *at_fd(fd_t f) {
    if (f == AT_FDCWD_)
        return AT_PWD;
    return f_get(f);
}

static void apply_umask(mode_t_ *mode) {
    struct fs_info *fs = current->fs;
    lock(&fs->lock);
    *mode &= ~fs->umask;
    unlock(&fs->lock);
}

int access_check(struct statbuf *stat, int check) {
    if (superuser()) return 0;
    if (check == 0) return 0;
    // Align check with the correct bits in mode
    if (current->euid == stat->uid) {
        check <<= 6;
    } else if (current->egid == stat->gid) {
        check <<= 3;
    }
    if (!(stat->mode & check))
        return _EACCES;
    return 0;
}

// TODO ENAMETOOLONG

#define AT_EACCESS_ 0x200
dword_t sys_access(addr_t path_addr, dword_t mode) {
    return sys_faccessat(AT_FDCWD_, path_addr, mode, 0);
}
dword_t sys_faccessat(fd_t at_f, addr_t path_addr, mode_t_ mode, dword_t flags) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    STRACE("faccessat(%d, \"%s\", 0x%x, %d)", at_f, path, mode, flags);

    if (flags & AT_EACCESS_)
        return generic_accessat(at, path, mode);

    uid_t_ uid_tmp = current->euid;
    uid_t_ gid_tmp = current->egid;
    current->euid = current->uid;
    current->egid = current->gid;
    int err = generic_accessat(at, path, mode);
    current->euid = uid_tmp;
    current->egid = gid_tmp;
    return err;
}

fd_t sys_openat(fd_t at_f, addr_t path_addr, dword_t flags, mode_t_ mode) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("openat(%d, \"%s\", 0x%x, 0x%x)", at_f, path, flags, mode);

    if (flags & O_CREAT_)
        apply_umask(&mode);

    struct fd *at = at_fd(at_f);
    if (at == NULL) {
        return _EBADF;
    }
    struct fd *fd = generic_openat(at, path, flags, mode);
    if (IS_ERR(fd)) {
        return PTR_ERR(fd);
    }
    return f_install(fd, flags);
}

fd_t sys_open(addr_t path_addr, dword_t flags, mode_t_ mode) {
    return sys_openat(AT_FDCWD_, path_addr, flags, mode);
}

struct open_how_ {
    uint64_t flags;
    uint64_t mode;
    uint64_t resolve;
};

fd_t sys_openat2(fd_t at_f, addr_t path_addr, addr_t how_addr, size_t size) {
    STRACE("openat2(%d, %#x, %#x, %#zx)", at_f, path_addr, how_addr, size);
    if (size < sizeof(struct open_how_))
        return _EINVAL;
    struct open_how_ how;
    if (user_read(how_addr, &how, sizeof(how)))
        return _EFAULT;
    // Resolve flags are stricter path-walk constraints. Treat unsupported
    // constraints as EINVAL rather than silently ignoring security semantics.
    if (how.resolve != 0)
        return _EINVAL;
    return sys_openat(at_f, path_addr, (dword_t)how.flags, (mode_t_)how.mode);
}

dword_t sys_faccessat2(fd_t at_f, addr_t path_addr, mode_t_ mode, dword_t flags) {
    return sys_faccessat(at_f, path_addr, mode, flags);
}

#define MFD_CLOEXEC_ 0x0001U
#define MFD_ALLOW_SEALING_ 0x0002U

int_t sys_memfd_create(addr_t name_addr, uint_t flags) {
    char name[256];
    if (name_addr != 0 && user_read_string(name_addr, name, sizeof(name)))
        return _EFAULT;
    STRACE("memfd_create(\"%s\", %#x)", name_addr ? name : "", flags);
    if (flags & ~(MFD_CLOEXEC_ | MFD_ALLOW_SEALING_))
        return _EINVAL;
    int host_fd = platform_create_shared_memory_fd(0);
    if (host_fd < 0)
        return errno_map();
    struct fd *fd = adhoc_fd_create(&realfs_fdops);
    if (fd == NULL) {
        close(host_fd);
        return _ENOMEM;
    }
    fd->real_fd = host_fd;
    fd->stat.mode = S_IFREG | 0600;
    return f_install(fd, (flags & MFD_CLOEXEC_) ? O_CLOEXEC_ : 0);
}

dword_t sys_readlinkat(fd_t at_f, addr_t path_addr, addr_t buf_addr, dword_t bufsize) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("readlinkat(%d, \"%s\", %#x, %#x)", at_f, path, buf_addr, bufsize);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    char buf[bufsize];
    ssize_t size = generic_readlinkat(at, path, buf, bufsize);
    if (size >= 0) {
        STRACE(" \"%.*s\"", size, buf);
        if (user_write(buf_addr, buf, size))
            return _EFAULT;
    }
    return size;
}

dword_t sys_readlink(addr_t path_addr, addr_t buf_addr, dword_t bufsize) {
    return sys_readlinkat(AT_FDCWD_, path_addr, buf_addr, bufsize);
}

dword_t sys_linkat(fd_t src_at_f, addr_t src_addr, fd_t dst_at_f, addr_t dst_addr) {
    char src[MAX_PATH];
    if (user_read_string(src_addr, src, sizeof(src)))
        return _EFAULT;
    char dst[MAX_PATH];
    if (user_read_string(dst_addr, dst, sizeof(dst)))
        return _EFAULT;
    STRACE("linkat(%d, \"%s\", %d, \"%s\")", src_at_f, src, dst_at_f, dst);
    struct fd *src_at = at_fd(src_at_f);
    if (src_at == NULL)
        return _EBADF;
    struct fd *dst_at = at_fd(dst_at_f);
    if (dst_at == NULL)
        return _EBADF;
    return generic_linkat(src_at, src, dst_at, dst);
}

dword_t sys_link(addr_t src_addr, addr_t dst_addr) {
    return sys_linkat(AT_FDCWD_, src_addr, AT_FDCWD_, dst_addr);
}

#define AT_REMOVEDIR_ 0x200
dword_t sys_unlinkat(fd_t at_f, addr_t path_addr, int_t flags) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("unlinkat(%d, \"%s\", %d)", at_f, path, flags);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    if (flags & AT_REMOVEDIR_)
        return generic_rmdirat(at, path);
    else
        return generic_unlinkat(at, path);
}

dword_t sys_unlink(addr_t path_addr) {
    return sys_unlinkat(AT_FDCWD_, path_addr, 0);
}

dword_t sys_renameat2(fd_t src_at_f, addr_t src_addr, fd_t dst_at_f, addr_t dst_addr, int_t flags) {
    if (flags != 0)
        return _EINVAL;
    char src[MAX_PATH];
    if (user_read_string(src_addr, src, sizeof(src)))
        return _EFAULT;
    char dst[MAX_PATH];
    if (user_read_string(dst_addr, dst, sizeof(dst)))
        return _EFAULT;
    STRACE("renameat(%d, \"%s\", %d, \"%s\")", src_at_f, src, dst_at_f, dst);
    struct fd *src_at = at_fd(src_at_f);
    if (src_at == NULL)
        return _EBADF;
    struct fd *dst_at = at_fd(dst_at_f);
    if (dst_at == NULL)
        return _EBADF;
    return generic_renameat(src_at, src, dst_at, dst);
}

dword_t sys_renameat(fd_t src_at_f, addr_t src_addr, fd_t dst_at_f, addr_t dst_addr) {
    return sys_renameat2(src_at_f, src_addr, dst_at_f, dst_addr, 0);
}

dword_t sys_rename(addr_t src_addr, addr_t dst_addr) {
    return sys_renameat2(AT_FDCWD_, src_addr, AT_FDCWD_, dst_addr, 0);
}

dword_t sys_symlinkat(addr_t target_addr, fd_t at_f, addr_t link_addr) {
    char target[MAX_PATH];
    if (user_read_string(target_addr, target, sizeof(target)))
        return _EFAULT;
    char link[MAX_PATH];
    if (user_read_string(link_addr, link, sizeof(link)))
        return _EFAULT;
    STRACE("symlinkat(\"%s\", %d, \"%s\")", target, at_f, link);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    return generic_symlinkat(target, at, link);
}

dword_t sys_symlink(addr_t target_addr, addr_t link_addr) {
    return sys_symlinkat(target_addr, AT_FDCWD_, link_addr);
}

dword_t sys_mknodat(fd_t at_f, addr_t path_addr, mode_t_ mode, dev_t_ dev) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("mknodat(%d, \"%s\", %#x, %#x)", at_f, path, mode, dev);
    apply_umask(&mode);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    return generic_mknodat(at, path, mode, dev);
}

dword_t sys_mknod(addr_t path_addr, mode_t_ mode, dev_t_ dev) {
    return sys_mknodat(AT_FDCWD_, path_addr, mode, dev);
}

static ssize_t sys_read_buf(fd_t fd_no, void *buf, size_t size) {
    struct fd *fd = f_get(fd_no);
    if (fd == NULL)
        return _EBADF;
    if (S_ISDIR(fd->type))
        return _EISDIR;

    ssize_t res;
    if (fd->ops->read) {
        res = fd->ops->read(fd, buf, size);
    } else if (fd->ops->pread) {
        res = fd->ops->pread(fd, buf, size, fd->offset);
        if (res > 0) {
            fd->ops->lseek(fd, res, LSEEK_CUR);
        }
    } else {
        return _EBADF;
    }

    if (res >= 0) {
        size_t print_size = res;
        if (print_size > 100) print_size = 100;
        STRACE(" \"%.*s\"", print_size, buf);
    }
    return res;
}

dword_t sys_read(fd_t fd_no, addr_t buf_addr, dword_t size) {
    STRACE("read(%d, 0x%x, %d)", fd_no, buf_addr, size);
    char *buf = (char *) malloc(size);
    if (buf == NULL)
        return _ENOMEM;
    int_t res = sys_read_buf(fd_no, buf, size);
    if (res >= 0) {
        if (user_write(buf_addr, buf, res))
            res = _EFAULT;
    }
    free(buf);
    return res;
}

static ssize_t sys_write_buf(fd_t fd_no, void *buf, size_t size) {
    struct fd *fd = f_get(fd_no);
    if (fd == NULL)
        return _EBADF;

    ssize_t res;
    if (fd->ops->write) {
        res = fd->ops->write(fd, buf, size);
    } else if (fd->ops->pwrite) {
        res = fd->ops->pwrite(fd, buf, size, fd->offset);
        if (res > 0) {
            fd->ops->lseek(fd, res, LSEEK_CUR);
        }
    } else {
        return _EBADF;
    }
    return res;
}

dword_t sys_write(fd_t fd_no, addr_t buf_addr, dword_t size) {
    // FIXME this is a DOS vector, should ideally use vectorized I/O
    char *buf = malloc(size);
    if (buf == NULL)
        return _ENOMEM;
    dword_t res = _EFAULT;
    if (user_read(buf_addr, buf, size))
        goto out;

    size_t print_size = size;
    if (print_size > 100) print_size = 100;
    STRACE("write(%d, \"%.*s\", %d)", fd_no, print_size, buf, size);

    res = sys_write_buf(fd_no, buf, size);

out:
    free(buf);
    return res;
}

// The vector operations work by flattening the vector into a malloc buffer.
// This at least isn't much worse than what it was before, which copied each
// element of the vector into a malloc buffer. The perfect solution would be to
// construct a vector with an entry for each page of the buffer. I haven't done
// that yet because it's more work and the efficiency gain from that is dwarfed
// by the inefficiency of the emulator.

static struct iovec_ *read_iovec(addr_t iovec_addr, unsigned iovec_count) {
#ifdef GUEST_ARM64
    // ARM64 uses 64-bit iovec structure (16 bytes per entry)
    // We read the 64-bit version and convert to 32-bit for internal use
    size_t iovec64_size = sizeof(struct iovec64_) * iovec_count;
    struct iovec64_ *iovec64 = malloc(iovec64_size);
    if (iovec64 == NULL)
        return ERR_PTR(_ENOMEM);
    if (user_read(iovec_addr, iovec64, iovec64_size)) {
        free(iovec64);
        return ERR_PTR(_EFAULT);
    }

    // Convert to 32-bit iovec for internal processing
    struct iovec_ *iovec = malloc(sizeof(struct iovec_) * iovec_count);
    if (iovec == NULL) {
        free(iovec64);
        return ERR_PTR(_ENOMEM);
    }
    for (unsigned i = 0; i < iovec_count; i++) {
        iovec[i].base = (addr_t)iovec64[i].base;
        iovec[i].len = (uint_t)iovec64[i].len;
    }
    free(iovec64);
    return iovec;
#else
    dword_t iovec_size = sizeof(struct iovec_) * iovec_count;
    struct iovec_ *iovec = malloc(iovec_size);
    if (iovec == NULL)
        return ERR_PTR(_ENOMEM);
    if (user_read(iovec_addr, iovec, iovec_size)) {
        free(iovec);
        return ERR_PTR(_EFAULT);
    }
    return iovec;
#endif
}

static ssize_t iovec_size(struct iovec_ *iovec, unsigned iovec_count) {
    size_t size = 0;
    for (unsigned i = 0; i < iovec_count; i++)
        size += iovec[i].len;
    return size;
}

dword_t sys_readv(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count) {
    STRACE("readv(%d, %#x, %d)", fd_no, iovec_addr, iovec_count);
    struct iovec_ *iovec = read_iovec(iovec_addr, iovec_count);
    if (IS_ERR(iovec))
        return PTR_ERR(iovec);
    size_t io_size = iovec_size(iovec, iovec_count);
    char *buf = malloc(io_size);
    if (buf == NULL) {
        free(iovec);
        return _ENOMEM;
    }
    ssize_t res = sys_read_buf(fd_no, buf, io_size);
    if (res < 0)
        goto error;

    size_t offset = 0;
    for (unsigned i = 0; i < iovec_count; i++) {
        size_t print_size = iovec[i].len;
        if (print_size > 100) print_size = 100;
        STRACE(" {\"%.*s\", %u}", print_size, buf + offset, iovec[i].len);

        if (user_write(iovec[i].base, buf + offset, iovec[i].len)) {
            res = _EFAULT;
            goto error;
        }
        offset += iovec[i].len;
    }

error:
    free(buf);
    free(iovec);
    return res;
}

static dword_t read_iovec_to_buf(addr_t iovec_addr, dword_t iovec_count,
                                  struct iovec_ **iovec_out, char **buf_out,
                                  size_t *size_out) {
    struct iovec_ *iovec = read_iovec(iovec_addr, iovec_count);
    if (IS_ERR(iovec))
        return PTR_ERR(iovec);
    size_t io_size = iovec_size(iovec, iovec_count);
    char *buf = malloc(io_size ? io_size : 1);
    if (buf == NULL) {
        free(iovec);
        return _ENOMEM;
    }

    size_t offset = 0;
    for (unsigned i = 0; i < iovec_count; i++) {
        if (user_read(iovec[i].base, buf + offset, iovec[i].len)) {
            free(buf);
            free(iovec);
            return _EFAULT;
        }

        size_t print_size = iovec[i].len;
        if (print_size > 100) print_size = 100;
        STRACE(" {\"%.*s\", %u}", print_size, buf + offset, iovec[i].len);
        offset += iovec[i].len;
    }

    *iovec_out = iovec;
    *buf_out = buf;
    *size_out = io_size;
    return 0;
}

dword_t sys_writev(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count) {
    STRACE("writev(%d, %#x, %d)", fd_no, iovec_addr, iovec_count);
    struct iovec_ *iovec;
    char *buf;
    size_t io_size;
    dword_t err = read_iovec_to_buf(iovec_addr, iovec_count, &iovec, &buf, &io_size);
    if (err != 0)
        return err;

    ssize_t res = sys_write_buf(fd_no, buf, io_size);
    free(buf);
    free(iovec);
    return res;
}

dword_t sys__llseek(fd_t f, dword_t off_high, dword_t off_low, addr_t res_addr, dword_t whence) {
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    if (!fd->ops->lseek)
        return _ESPIPE;
    lock(&fd->lock);
    off_t_ off = ((qword_t) off_high << 32) | off_low;
    STRACE("llseek(%d, %lu, %#x, %d)", f, off, res_addr, whence);
    off_t_ res = fd->ops->lseek(fd, off, whence);
    STRACE(" -> %lu", res);
    unlock(&fd->lock);
    if (res < 0)
        return res;
    if (user_put(res_addr, res))
        return _EFAULT;
    return 0;
}

dword_t sys_lseek(fd_t f, dword_t off, dword_t whence) {
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    if (!fd->ops->lseek)
        return _ESPIPE;
    lock(&fd->lock);
    off_t res = fd->ops->lseek(fd, off, whence);
    unlock(&fd->lock);
    if ((dword_t) res != res)
        return _EOVERFLOW;
    return res;
}

// 64-bit lseek for ARM64
// Returns the new file position directly (not via pointer like _llseek)
qword_t sys_lseek64(fd_t f, sqword_t off, dword_t whence) {
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    if (!fd->ops->lseek)
        return _ESPIPE;
    lock(&fd->lock);
    STRACE("lseek64(%d, %lld, %d)", f, (long long)off, whence);
    off_t_ res = fd->ops->lseek(fd, off, whence);
    STRACE(" -> %lld", (long long)res);
    unlock(&fd->lock);
    return res;
}

dword_t sys_pread(fd_t f, addr_t buf_addr, dword_t size, off_t_ off) {
    STRACE("pread(%d, 0x%x, %d, %d)", f, buf_addr, size, off);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    char *buf = malloc(size+1);
    if (buf == NULL)
        return _ENOMEM;
    lock(&fd->lock);
    ssize_t res;
    if (fd->ops->pread) {
        res = fd->ops->pread(fd, buf, size, off);
    } else {
        off_t_ saved_off = fd->ops->lseek(fd, 0, LSEEK_CUR);
        if ((res = fd->ops->lseek(fd, off, LSEEK_SET)) < 0) {
            goto out;
        }
        res = fd->ops->read(fd, buf, size);
        // This really shouldn't fail. The lseek man page lists these reasons:
        // EBADF, ESPIPE: can't happen because the last lseek wouldn't have succeeded.
        // EOVERFLOW: can't happen for LSEEK_SET.
        // EINVAL: can't happen other than typoing LSEEK_SET, because we know saved_off is not negative.
        off_t_ lseek_res = fd->ops->lseek(fd, saved_off, LSEEK_SET);
        assert(lseek_res >= 0);
    }
    if (res >= 0) {
        buf[res] = '\0';
        STRACE(" \"%.99s\"", buf);
        if (user_write(buf_addr, buf, res))
            res = _EFAULT;
    }
out:
    unlock(&fd->lock);
    free(buf);
    return res;
}

dword_t sys_pwrite(fd_t f, addr_t buf_addr, dword_t size, off_t_ off) {
    STRACE("pwrite(%d, 0x%x, %d, %d)", f, buf_addr, size, off);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    char *buf = malloc(size+1);
    if (buf == NULL)
        return _ENOMEM;
    if (user_read(buf_addr, buf, size)) {
        free(buf);
        return _EFAULT;
    }
    lock(&fd->lock);
    ssize_t res;
    if (fd->ops->pwrite) {
        res = fd->ops->pwrite(fd, buf, size, off);
    } else {
        off_t_ saved_off = fd->ops->lseek(fd, 0, LSEEK_CUR);
        if ((res = fd->ops->lseek(fd, off, LSEEK_SET)) >= 0) {
            res = fd->ops->write(fd, buf, size);
            // This really shouldn't fail. The lseek man page lists these reasons:
            // EBADF, ESPIPE: can't happen because the last lseek wouldn't have succeeded.
            // EOVERFLOW: can't happen for LSEEK_SET.
            // EINVAL: can't happen other than typoing LSEEK_SET, because we know saved_off is not negative.
            off_t_ lseek_res = fd->ops->lseek(fd, saved_off, LSEEK_SET);
            assert(lseek_res >= 0);
        }
    }
    unlock(&fd->lock);
    free(buf);
    return res;
}

static ssize_t fd_pwrite_buf(struct fd *fd, char *buf, size_t size, off_t_ off) {
    if (fd->ops->pwrite)
        return fd->ops->pwrite(fd, buf, size, off);
    if (!fd->ops->lseek || !fd->ops->write)
        return _ESPIPE;
    off_t_ saved_off = fd->ops->lseek(fd, 0, LSEEK_CUR);
    ssize_t res;
    if ((res = fd->ops->lseek(fd, off, LSEEK_SET)) >= 0) {
        res = fd->ops->write(fd, buf, size);
        off_t_ lseek_res = fd->ops->lseek(fd, saved_off, LSEEK_SET);
        assert(lseek_res >= 0);
    }
    return res;
}

static ssize_t fd_pread_buf(struct fd *fd, char *buf, size_t size, off_t_ off) {
    if (fd->ops->pread)
        return fd->ops->pread(fd, buf, size, off);
    if (!fd->ops->lseek || !fd->ops->read)
        return _ESPIPE;
    off_t_ saved_off = fd->ops->lseek(fd, 0, LSEEK_CUR);
    ssize_t res;
    if ((res = fd->ops->lseek(fd, off, LSEEK_SET)) >= 0) {
        res = fd->ops->read(fd, buf, size);
        off_t_ lseek_res = fd->ops->lseek(fd, saved_off, LSEEK_SET);
        assert(lseek_res >= 0);
    }
    return res;
}

dword_t sys_pwritev(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off) {
    STRACE("pwritev(%d, %#x, %d, %lld)", fd_no, iovec_addr, iovec_count, (long long)off);
    struct fd *fd = f_get(fd_no);
    if (fd == NULL)
        return _EBADF;

    struct iovec_ *iovec;
    char *buf;
    size_t io_size;
    dword_t err = read_iovec_to_buf(iovec_addr, iovec_count, &iovec, &buf, &io_size);
    if (err != 0)
        return err;

    lock(&fd->lock);
    ssize_t res = fd_pwrite_buf(fd, buf, io_size, off);
    unlock(&fd->lock);

    free(buf);
    free(iovec);
    return res;
}

dword_t sys_pwritev2(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off, dword_t flags) {
    STRACE("pwritev2(%d, %#x, %d, %lld, %#x)", fd_no, iovec_addr, iovec_count, (long long)off, flags);
    if (flags != 0)
        return _EOPNOTSUPP;
    return sys_pwritev(fd_no, iovec_addr, iovec_count, off);
}

dword_t sys_preadv(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off) {
    STRACE("preadv(%d, %#x, %d, %lld)", fd_no, iovec_addr, iovec_count, (long long)off);
    struct fd *fd = f_get(fd_no);
    if (fd == NULL)
        return _EBADF;

    struct iovec_ *iovec = read_iovec(iovec_addr, iovec_count);
    if (IS_ERR(iovec))
        return PTR_ERR(iovec);
    size_t io_size = iovec_size(iovec, iovec_count);
    char *buf = malloc(io_size ? io_size : 1);
    if (buf == NULL) {
        free(iovec);
        return _ENOMEM;
    }

    lock(&fd->lock);
    ssize_t res = fd_pread_buf(fd, buf, io_size, off);
    unlock(&fd->lock);
    if (res < 0)
        goto out;

    size_t offset = 0;
    for (unsigned i = 0; i < iovec_count && offset < (size_t)res; i++) {
        size_t chunk = iovec[i].len;
        if (chunk > (size_t)res - offset)
            chunk = (size_t)res - offset;
        if (user_write(iovec[i].base, buf + offset, chunk)) {
            res = _EFAULT;
            goto out;
        }
        offset += chunk;
    }
out:
    free(buf);
    free(iovec);
    return res;
}

dword_t sys_preadv2(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off, dword_t flags) {
    STRACE("preadv2(%d, %#x, %d, %lld, %#x)", fd_no, iovec_addr, iovec_count, (long long)off, flags);
    if (flags != 0)
        return _EOPNOTSUPP;
    return sys_preadv(fd_no, iovec_addr, iovec_count, off);
}

static ssize_t process_vm_copy(pid_t_ pid, addr_t local_iov_addr, dword_t local_iovcnt,
                               addr_t remote_iov_addr, dword_t remote_iovcnt,
                               dword_t flags, bool write_remote) {
    if (flags != 0)
        return _EINVAL;
    struct iovec_ *local = read_iovec(local_iov_addr, local_iovcnt);
    if (IS_ERR(local))
        return PTR_ERR(local);
    struct iovec_ *remote = read_iovec(remote_iov_addr, remote_iovcnt);
    if (IS_ERR(remote)) {
        free(local);
        return PTR_ERR(remote);
    }

    lock(&pids_lock);
    struct task *task = pid_get_task(pid);
    unlock(&pids_lock);
    if (task == NULL) {
        free(local);
        free(remote);
        return _ESRCH;
    }
    if (!superuser() && current->euid != task->uid && current->uid != task->uid) {
        free(local);
        free(remote);
        return _EPERM;
    }

    char buf[4096];
    size_t li = 0, ri = 0, lo = 0, ro = 0;
    ssize_t done = 0;
    while (li < local_iovcnt && ri < remote_iovcnt) {
        size_t lrem = local[li].len - lo;
        size_t rrem = remote[ri].len - ro;
        size_t chunk = lrem < rrem ? lrem : rrem;
        if (chunk > sizeof(buf))
            chunk = sizeof(buf);
        if (chunk == 0) {
            if (lrem == 0) { li++; lo = 0; }
            if (rrem == 0) { ri++; ro = 0; }
            continue;
        }
        if (write_remote) {
            if (user_read(local[li].base + lo, buf, chunk))
                break;
            if (user_write_task(task, remote[ri].base + ro, buf, chunk))
                break;
        } else {
            if (user_read_task(task, remote[ri].base + ro, buf, chunk))
                break;
            if (user_write(local[li].base + lo, buf, chunk))
                break;
        }
        done += chunk;
        lo += chunk;
        ro += chunk;
        if (lo == local[li].len) { li++; lo = 0; }
        if (ro == remote[ri].len) { ri++; ro = 0; }
    }

    free(local);
    free(remote);
    return done > 0 ? done : _EFAULT;
}

ssize_t sys_process_vm_readv(pid_t_ pid, addr_t local_iov_addr, dword_t local_iovcnt,
                             addr_t remote_iov_addr, dword_t remote_iovcnt, dword_t flags) {
    STRACE("process_vm_readv(%d, %#x, %d, %#x, %d, %#x)", pid, local_iov_addr, local_iovcnt, remote_iov_addr, remote_iovcnt, flags);
    return process_vm_copy(pid, local_iov_addr, local_iovcnt, remote_iov_addr, remote_iovcnt, flags, false);
}

ssize_t sys_process_vm_writev(pid_t_ pid, addr_t local_iov_addr, dword_t local_iovcnt,
                              addr_t remote_iov_addr, dword_t remote_iovcnt, dword_t flags) {
    STRACE("process_vm_writev(%d, %#x, %d, %#x, %d, %#x)", pid, local_iov_addr, local_iovcnt, remote_iov_addr, remote_iovcnt, flags);
    return process_vm_copy(pid, local_iov_addr, local_iovcnt, remote_iov_addr, remote_iovcnt, flags, true);
}

static int fd_ioctl(struct fd *fd, dword_t cmd, addr_t arg) {
    ssize_t size = -1;
    if (fd->ops->ioctl_size)
        size = fd->ops->ioctl_size(cmd);
    if (size < 0)
        return _ENOTTY;
    if (size == 0)
        return fd->ops->ioctl(fd, cmd, (void *) (long) arg);

    // praying that this won't break
    char buf[size];
    if (user_read(arg, buf, size))
        return _EFAULT;
    int res = fd->ops->ioctl(fd, cmd, buf);
    if (res < 0)
        return res;
    if (user_write(arg, buf, size))
        return _EFAULT;
    return res;
}

static int set_nonblock(struct fd *fd, addr_t nb_addr) {
    dword_t nonblock;
    if (user_get(nb_addr, nonblock))
        return _EFAULT;
    int flags = fd_getflags(fd);
    if (nonblock)
        flags |= O_NONBLOCK_;
    else
        flags &= ~O_NONBLOCK_;
    return fd_setflags(fd, flags);
}

dword_t sys_ioctl(fd_t f, dword_t cmd, addr_t arg) {
    STRACE("ioctl(%d, 0x%x, 0x%llx)", f, cmd, (unsigned long long)arg);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;

    switch (cmd) {
        case FIONBIO_:
            return set_nonblock(fd, arg);
        case FIOCLEX_:
            bit_set(f, current->files->cloexec);
            return 0;
        case FIONCLEX_:
            bit_clear(f, current->files->cloexec);
            return 0;
    }
    return fd_ioctl(fd, cmd, arg);
}

dword_t sys_getcwd(addr_t buf_addr, dword_t size) {
    STRACE("getcwd(%#x, %#x)", buf_addr, size);
    lock(&current->fs->lock);
    struct fd *wd = current->fs->pwd;
    char pwd[MAX_PATH + 1];
    int err = generic_getpath(wd, pwd);
    unlock(&current->fs->lock);
    if (err < 0)
        return err;

    if (strlen(pwd) + 1 > size)
        return _ERANGE;
    size = strlen(pwd) + 1;
    char *buf = malloc(size);
    if (buf == NULL)
        return _ENOMEM;
    strcpy(buf, pwd);
    STRACE(" \"%.*s\"", size, buf);
    dword_t res = size;
    if (user_write(buf_addr, buf, size))
        res = _EFAULT;
    free(buf);
    return res;
}

static struct fd *open_dir(const char *path) {
    struct statbuf stat;
    int err = generic_statat(AT_PWD, path, &stat, true);
    if (err < 0)
        return ERR_PTR(err);
    if (!(stat.mode & S_IFDIR))
        return ERR_PTR(_ENOTDIR);

    return generic_open(path, O_RDONLY_, 0);
}

void fs_chdir(struct fs_info *fs, struct fd *fd) {
    lock(&fs->lock);
    fd_close(fs->pwd);
    fs->pwd = fd;
    unlock(&fs->lock);
}

dword_t sys_chdir(addr_t path_addr) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("chdir(\"%s\")", path);

    struct fd *dir = open_dir(path);
    if (IS_ERR(dir))
        return PTR_ERR(dir);
    fs_chdir(current->fs, dir);
    return 0;
}

dword_t sys_fchdir(fd_t f) {
    STRACE("fchdir(%d)", f);
    struct fd *dir = f_get(f);
    if (dir == NULL)
        return _EBADF;
    dir->refcount++;
    fs_chdir(current->fs, dir);
    return 0;
}

dword_t sys_chroot(addr_t path_addr) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("chroot(\"%s\")", path);

    struct fd *dir = open_dir(path);
    if (IS_ERR(dir))
        return PTR_ERR(dir);
    lock(&current->fs->lock);
    fd_close(current->fs->root);
    current->fs->root = dir;
    unlock(&current->fs->lock);
    return 0;
}

dword_t sys_umask(dword_t mask) {
    STRACE("umask(0%o)", mask);
    struct fs_info *fs = current->fs;
    lock(&fs->lock);
    mode_t_ old_umask = fs->umask;
    fs->umask = ((mode_t_) mask) & 0777;
    unlock(&fs->lock);
    return old_umask;
}

static int mount_statfs(struct mount *mount, struct statfsbuf *stat) {
    int err = 0;
    if (mount->fs->statfs)
        err = mount->fs->statfs(mount, stat);
    if (stat->type == 0)
        stat->type = mount->fs->magic;
    return err;
}

static int_t statfs_mount(struct mount *mount, addr_t buf_addr) {
    struct statfsbuf buf = {};
    int err = mount_statfs(mount, &buf);
    if (err < 0)
        return err;
    struct statfs_ out_buf = {
        .type = buf.type,
        .bsize = buf.bsize,
        .blocks = buf.blocks,
        .bfree = buf.bfree,
        .bavail = buf.bavail,
        .files = buf.files,
        .ffree = buf.ffree,
        .fsid = buf.fsid,
        .namelen = buf.namelen,
        .frsize = buf.frsize,
        .flags = buf.flags,
    };
    if (user_put(buf_addr, out_buf))
        return _EFAULT;
    return 0;
}

static int_t statfs64_mount(struct mount *mount, addr_t buf_addr) {
    struct statfsbuf buf = {};
    int err = mount_statfs(mount, &buf);
    if (err < 0)
        return err;
    struct statfs64_ out_buf = {
        .type = buf.type,
        .bsize = buf.bsize,
        .blocks = buf.blocks,
        .bfree = buf.bfree,
        .bavail = buf.bavail,
        .files = buf.files,
        .ffree = buf.ffree,
        .fsid = buf.fsid,
        .namelen = buf.namelen,
        .frsize = buf.frsize,
        .flags = buf.flags,
    };
    if (user_put(buf_addr, out_buf))
        return _EFAULT;
    return 0;
}

dword_t sys_statfs(addr_t path_addr, addr_t buf_addr) {
    char path_raw[MAX_PATH];
    if (user_read_string(path_addr, path_raw, sizeof(path_raw)))
        return _EFAULT;
    STRACE("statfs(\"%s\", %#x)", path_raw, buf_addr);
    char path[MAX_PATH];
    int err = path_normalize(AT_PWD, path_raw, path, N_SYMLINK_NOFOLLOW);
    if (err < 0)
        return err;
    struct mount *mount = mount_find(path);
    err = statfs_mount(mount, buf_addr);
    mount_release(mount);
    return err;
}

dword_t sys_statfs64(addr_t path_addr, dword_t buf_size, addr_t buf_addr) {
    char path_raw[MAX_PATH];
    if (user_read_string(path_addr, path_raw, sizeof(path_raw)))
        return _EFAULT;
    STRACE("statfs64(\"%s\", %d, %#x)", path_raw, buf_size, buf_addr);
    if (buf_size != sizeof(struct statfs64_))
        return _EINVAL;
    char path[MAX_PATH];
    int err = path_normalize(AT_PWD, path_raw, path, N_SYMLINK_NOFOLLOW);
    if (err < 0)
        return err;
    struct mount *mount = mount_find(path);
    err = statfs64_mount(mount, buf_addr);
    mount_release(mount);
    return err;
}

dword_t sys_fstatfs(fd_t f, addr_t buf_addr) {
    return statfs_mount(f_get(f)->mount, buf_addr);
}

dword_t sys_fstatfs64(fd_t f, addr_t buf_addr) {
    return statfs64_mount(f_get(f)->mount, buf_addr);
}

#if defined(GUEST_ARM64)
// ARM64 uses statfs (not statfs64) with a different structure layout
// The structure uses 64-bit fields throughout (LP64 ABI)
static int_t statfs_arm64_mount(struct mount *mount, addr_t buf_addr) {
    struct statfsbuf buf = {};
    int err = mount_statfs(mount, &buf);
    if (err < 0)
        return err;
    struct statfs_arm64_ out_buf = {
        .type = buf.type,
        .bsize = buf.bsize,
        .blocks = buf.blocks,
        .bfree = buf.bfree,
        .bavail = buf.bavail,
        .files = buf.files,
        .ffree = buf.ffree,
        .fsid = {buf.fsid & 0xFFFFFFFF, buf.fsid >> 32},
        .namelen = buf.namelen,
        .frsize = buf.frsize,
        .flags = buf.flags,
    };
    if (user_put(buf_addr, out_buf))
        return _EFAULT;
    return 0;
}

dword_t sys_statfs_arm64(addr_t path_addr, addr_t buf_addr) {
    char path_raw[MAX_PATH];
    if (user_read_string(path_addr, path_raw, sizeof(path_raw)))
        return _EFAULT;
    STRACE("statfs(\"%s\", %#llx)", path_raw, (unsigned long long)buf_addr);
    char path[MAX_PATH];
    int err = path_normalize(AT_PWD, path_raw, path, N_SYMLINK_NOFOLLOW);
    if (err < 0)
        return err;
    struct mount *mount = mount_find(path);
    err = statfs_arm64_mount(mount, buf_addr);
    mount_release(mount);
    return err;
}

dword_t sys_fstatfs_arm64(fd_t f, addr_t buf_addr) {
    STRACE("fstatfs(%d, %#llx)", f, (unsigned long long)buf_addr);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    return statfs_arm64_mount(fd->mount, buf_addr);
}
#endif

dword_t sys_flock(fd_t f, dword_t operation) {
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    // TODO: POSIX doesn't allow flock to fail in this way. The check is here
    // because a segfault is worse.
    if (fd->mount->fs->flock == NULL)
        return _EBADF;
    return fd->mount->fs->flock(fd, operation);
}

static dword_t sys_utime_common(fd_t at_f, addr_t path_addr, struct timespec atime, struct timespec mtime, dword_t flags) {
    char path[MAX_PATH];
    if (path_addr != 0)
        if (user_read_string(path_addr, path, sizeof(path)))
            return _EFAULT;
    STRACE("utimensat(%d, %s, {{%lld, %lld}, {%lld, %lld}}, %d)", at_f, path,
            (long long)atime.tv_sec, (long long)atime.tv_nsec,
            (long long)mtime.tv_sec, (long long)mtime.tv_nsec, flags);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;

    bool follow_links = flags & AT_SYMLINK_NOFOLLOW_ ? false : true;
    return generic_utime(at, path_addr != 0 ? path : ".", atime, mtime, follow_links);
}

dword_t sys_utimensat(fd_t at_f, addr_t path_addr, addr_t times_addr, dword_t flags) {
    struct timespec atime;
    struct timespec mtime;
    if (times_addr == 0) {
        atime = mtime = timespec_now(CLOCK_REALTIME);
    } else {
        struct timespec_ times[2];
        if (user_get(times_addr, times))
            return _EFAULT;
        atime = convert_timespec(times[0]);
        mtime = convert_timespec(times[1]);
    }
    return sys_utime_common(at_f, path_addr, atime, mtime, flags);
}

dword_t sys_utimes(addr_t path_addr, addr_t times_addr) {
    struct timespec atime;
    struct timespec mtime;
    if (times_addr == 0) {
        atime = mtime = timespec_now(CLOCK_REALTIME);
    } else {
        struct timeval_ times[2];
        if (user_get(times_addr, times))
            return _EFAULT;
        atime = convert_timeval(times[0]);
        mtime = convert_timeval(times[1]);
    }
    return sys_utime_common(AT_FDCWD_, path_addr, atime, mtime, 0);
}

dword_t sys_utime(addr_t path_addr, addr_t times_addr) {
    struct timespec atime;
    struct timespec mtime;
    if (times_addr == 0) {
        atime = mtime = timespec_now(CLOCK_REALTIME);
    } else {
        struct utimbuf_ {
            time_t_ actime;
            time_t_ modtime;
        } times;
        if (user_get(times_addr, times))
            return _EFAULT;
        atime.tv_sec = times.actime;
        atime.tv_nsec = 0;
        mtime.tv_sec = times.modtime;
        mtime.tv_nsec = 0;
    }
    return sys_utime_common(AT_FDCWD_, path_addr, atime, mtime, 0);
}

static int generic_fsetattr(struct fd *fd, struct attr attr) {
    if (fd->mount->fs->fsetattr == NULL)
        return _EPERM;
    return fd->mount->fs->fsetattr(fd, attr);
}

dword_t sys_fchmod(fd_t f, dword_t mode) {
    STRACE("fchmod(%d, %o)", f, mode);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    mode &= ~S_IFMT;
    return generic_fsetattr(fd, make_attr(mode, mode));
}

static dword_t do_fchmodat(fd_t at_f, addr_t path_addr, dword_t mode, dword_t flags) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("fchmodat(%d, \"%s\", %o, %#x)", at_f, path, mode, flags);
    if (flags & ~(AT_SYMLINK_NOFOLLOW_ | AT_EMPTY_PATH_))
        return _EINVAL;
    mode &= ~S_IFMT;
    if ((flags & AT_EMPTY_PATH_) && path[0] == '\0') {
        if (at_f == AT_FDCWD_)
            return generic_setattrat(AT_PWD, ".", make_attr(mode, mode), true);
        struct fd *fd = f_get(at_f);
        if (fd == NULL)
            return _EBADF;
        return generic_fsetattr(fd, make_attr(mode, mode));
    }
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    return generic_setattrat(at, path, make_attr(mode, mode), !(flags & AT_SYMLINK_NOFOLLOW_));
}

dword_t sys_fchmodat(fd_t at_f, addr_t path_addr, dword_t mode) {
    return do_fchmodat(at_f, path_addr, mode, 0);
}

dword_t sys_fchmodat2(fd_t at_f, addr_t path_addr, dword_t mode, dword_t flags) {
    return do_fchmodat(at_f, path_addr, mode, flags);
}

dword_t sys_chmod(addr_t path_addr, dword_t mode) {
    return sys_fchmodat(AT_FDCWD_, path_addr, mode);
}

dword_t sys_fchown32(fd_t f, uid_t_ owner, uid_t_ group) {
    STRACE("fchown(%d, %d, %d)", f, owner, group);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    // realfs can't change ownership on host, silently succeed
    if (fd->mount->fs == &realfs)
        return 0;
    int err;
    if (owner != (uid_t) -1) {
        err = generic_fsetattr(fd, make_attr(uid, owner));
        if (err < 0)
            return err;
    }
    if (group != (uid_t) -1) {
        err = generic_fsetattr(fd, make_attr(gid, group));
        if (err < 0)
            return err;
    }
    return 0;
}

dword_t sys_fchownat(fd_t at_f, addr_t path_addr, dword_t owner, dword_t group, int flags) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("fchownat(%d, \"%s\", %d, %d, %d)", at_f, path, owner, group, flags);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    // realfs can't change ownership on host, silently succeed
    if (at != AT_PWD && at->mount->fs == &realfs)
        return 0;
    int err;
    bool follow_links = flags & AT_SYMLINK_NOFOLLOW_ ? false : true;
    if (owner != (uid_t) -1) {
        err = generic_setattrat(at, path, make_attr(uid, owner), follow_links);
        if (err < 0)
            return err;
    }
    if (group != (uid_t) -1) {
        err = generic_setattrat(at, path, make_attr(gid, group), follow_links);
        if (err < 0)
            return err;
    }
    return 0;
}

dword_t sys_chown32(addr_t path_addr, uid_t_ owner, uid_t_ group) {
    return sys_fchownat(AT_FDCWD_, path_addr, owner, group, 0);
}

dword_t sys_lchown(addr_t path_addr, uid_t_ owner, uid_t_ group) {
    return sys_fchownat(AT_FDCWD_, path_addr, owner, group, AT_SYMLINK_NOFOLLOW_);
}

// ARM64: 64-bit values passed in single registers
dword_t sys_truncate64(addr_t path_addr, off_t_ size) {
    STRACE("truncate64(%#x, %lld [0x%llx])", path_addr, (long long)size, (unsigned long long)size);
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    return generic_setattrat(NULL, path, make_attr(size, size), true);
}

dword_t sys_ftruncate64(fd_t f, off_t_ size) {
    STRACE("ftruncate64(%d, %lld [0x%llx])", f, (long long)size, (unsigned long long)size);
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    return generic_fsetattr(fd, make_attr(size, size));
}

dword_t sys_fallocate(fd_t f, dword_t UNUSED(mode), off_t_ offset, off_t_ len) {
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    struct statbuf statbuf;
    int err = fd->mount->fs->fstat(fd, &statbuf);
    if (err < 0)
        return err;
    if ((uint64_t) offset + (uint64_t) len > statbuf.size)
        return generic_fsetattr(fd, make_attr(size, offset + len));
    return 0;
}

dword_t sys_mkdirat(fd_t at_f, addr_t path_addr, mode_t_ mode) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("mkdirat(%d, %s, 0%o)", at_f, path, mode);
    struct fd *at = at_fd(at_f);
    if (at == NULL)
        return _EBADF;
    apply_umask(&mode);
    mode &= 0777;
    return generic_mkdirat(at, path, mode);
}

dword_t sys_mkdir(addr_t path_addr, mode_t_ mode) {
    return sys_mkdirat(AT_FDCWD_, path_addr, mode);
}

dword_t sys_rmdir(addr_t path_addr) {
    char path[MAX_PATH];
    if (user_read_string(path_addr, path, sizeof(path)))
        return _EFAULT;
    STRACE("rmdir(%s)", path);
    return generic_rmdirat(AT_PWD, path);
}

dword_t sys_fsync(fd_t f) {
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;
    int err = 0;
    if (fd->ops->fsync)
        err = fd->ops->fsync(fd);
    return err;
}

// a few stubs
dword_t sys_sendfile(fd_t out_fd, fd_t in_fd, addr_t offset_addr, dword_t count) {
    return sys_sendfile64(out_fd, in_fd, offset_addr, count);
}
dword_t sys_sendfile64(fd_t out_fd, fd_t in_fd, addr_t offset_addr, dword_t count) {
    STRACE("sendfile64(%d, %d, 0x%x, %d)", out_fd, in_fd, offset_addr, count);
    struct fd *in = f_get(in_fd);
    if (in == NULL)
        return _EBADF;
    struct fd *out = f_get(out_fd);
    if (out == NULL)
        return _EBADF;
    if (!in->ops->read && !in->ops->pread)
        return _EINVAL;
    if (!out->ops->write)
        return _EINVAL;

    off_t_ offset = -1;
    if (offset_addr != 0) {
        if (user_get(offset_addr, offset))
            return _EFAULT;
    }

    size_t remaining = count;
    size_t total = 0;
    char buf[4096];
    while (remaining > 0) {
        size_t chunk = remaining < sizeof(buf) ? remaining : sizeof(buf);
        ssize_t nread;
        if (offset_addr != 0) {
            if (!in->ops->pread)
                return _EINVAL;
            nread = in->ops->pread(in, buf, chunk, offset);
        } else {
            if (in->ops->read) {
                nread = in->ops->read(in, buf, chunk);
            } else {
                nread = in->ops->pread(in, buf, chunk, in->offset);
                if (nread > 0)
                    in->offset += nread;
            }
        }
        if (nread < 0)
            return total > 0 ? (dword_t) total : (dword_t) nread;
        if (nread == 0)
            break;

        ssize_t nwritten = out->ops->write(out, buf, nread);
        if (nwritten < 0)
            return total > 0 ? (dword_t) total : (dword_t) nwritten;

        total += nwritten;
        remaining -= nwritten;
        if (offset_addr != 0)
            offset += nwritten;

        if (nwritten < nread)
            break;
    }

    if (offset_addr != 0) {
        if (user_put(offset_addr, offset))
            return _EFAULT;
    }
    return total;
}
dword_t sys_splice(fd_t UNUSED(in_fd), addr_t UNUSED(in_off_addr), fd_t UNUSED(out_fd), addr_t UNUSED(out_off_addr), dword_t UNUSED(count), dword_t UNUSED(flags)) {
    return _EINVAL;
}
dword_t sys_copy_file_range(fd_t in_fd, addr_t in_off_addr, fd_t out_fd,
        addr_t out_off_addr, dword_t len, uint_t flags) {
    STRACE("copy_file_range(%d, 0x%x, %d, 0x%x, %d, %d)", in_fd, in_off_addr, out_fd, out_off_addr, len, flags);
    if (flags != 0)
        return _EINVAL;
    struct fd *in = f_get(in_fd);
    if (in == NULL)
        return _EBADF;
    struct fd *out = f_get(out_fd);
    if (out == NULL)
        return _EBADF;
    if (!in->ops->read && !in->ops->pread)
        return _EINVAL;
    if (!out->ops->write && !out->ops->pwrite)
        return _EINVAL;

    off_t_ in_off = -1, out_off = -1;
    if (in_off_addr != 0) {
        if (user_get(in_off_addr, in_off))
            return _EFAULT;
    }
    if (out_off_addr != 0) {
        if (user_get(out_off_addr, out_off))
            return _EFAULT;
    }

    char buf[4096];
    dword_t remaining = len, total = 0;
    while (remaining > 0) {
        size_t chunk = remaining < sizeof(buf) ? remaining : sizeof(buf);
        ssize_t nread;
        if (in_off >= 0) {
            if (in->ops->pread) {
                do { nread = in->ops->pread(in, buf, chunk, in_off); } while (nread == _EINTR);
            } else {
                do { nread = in->ops->read(in, buf, chunk); } while (nread == _EINTR);
            }
            if (nread > 0) in_off += nread;
        } else {
            if (in->ops->read) {
                do { nread = in->ops->read(in, buf, chunk); } while (nread == _EINTR);
            } else {
                do { nread = in->ops->pread(in, buf, chunk, in->offset); } while (nread == _EINTR);
                if (nread > 0) in->offset += nread;
            }
        }
        if (nread <= 0) {
            if (nread < 0 && total == 0) return nread;
            break;
        }

        ssize_t nwritten;
        if (out_off >= 0) {
            if (out->ops->pwrite) {
                do { nwritten = out->ops->pwrite(out, buf, nread, out_off); } while (nwritten == _EINTR);
            } else {
                do { nwritten = out->ops->write(out, buf, nread); } while (nwritten == _EINTR);
            }
            if (nwritten > 0) out_off += nwritten;
        } else {
            if (out->ops->write) {
                do { nwritten = out->ops->write(out, buf, nread); } while (nwritten == _EINTR);
            } else {
                do { nwritten = out->ops->pwrite(out, buf, nread, out->offset); } while (nwritten == _EINTR);
                if (nwritten > 0) out->offset += nwritten;
            }
        }
        if (nwritten <= 0) {
            if (nwritten < 0 && total == 0) return nwritten;
            break;
        }
        total += nwritten;
        remaining -= nwritten;
        if (nwritten < nread)
            break;
    }

    if (in_off_addr != 0) {
        if (user_put(in_off_addr, in_off))
            return _EFAULT;
    }
    if (out_off_addr != 0) {
        if (user_put(out_off_addr, out_off))
            return _EFAULT;
    }
    return total;
}

dword_t sys_xattr_stub(addr_t UNUSED(path_addr), addr_t UNUSED(name_addr),
        addr_t UNUSED(value_addr), dword_t UNUSED(size), dword_t UNUSED(flags)) {
    return _ENOTSUP;
}

// ARM64: posix_fadvise64 (syscall 223)
// Advises the kernel about file access patterns.
// Since we don't do kernel I/O optimization, we can safely ignore these hints.
dword_t sys_fadvise64(fd_t f, uint64_t offset, uint64_t len, dword_t advice) {
    STRACE("fadvise64(%d, %llu, %llu, %d)", f, offset, len, advice);

    // Validate file descriptor
    struct fd *fd = f_get(f);
    if (fd == NULL)
        return _EBADF;

    // All advice values are valid hints that we simply ignore
    // POSIX_FADV_NORMAL, POSIX_FADV_SEQUENTIAL, POSIX_FADV_RANDOM,
    // POSIX_FADV_NOREUSE, POSIX_FADV_WILLNEED, POSIX_FADV_DONTNEED

    return 0;  // Success - hint acknowledged (and ignored)
}

// ARM64: mincore (syscall 232)
// Determines which pages of a memory mapping are currently in RAM.
// For our emulator, we just pretend all pages are in memory.
dword_t sys_mincore(addr_t addr, dword_t length, addr_t vec_addr) {
    STRACE("mincore(%#x, %u, %#x)", addr, length, vec_addr);

    // Page size is 4096
    size_t page_size = 4096;
    size_t pages = (length + page_size - 1) / page_size;

    // Write 1 (page in memory) for each page
    for (size_t i = 0; i < pages; i++) {
        unsigned char in_mem = 1;
        if (user_put(vec_addr + i, in_mem))
            return _EFAULT;
    }

    return 0;  // Success
}
