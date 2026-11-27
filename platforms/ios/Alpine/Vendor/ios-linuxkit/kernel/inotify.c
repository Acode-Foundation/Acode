#include "kernel/calls.h"
#include "kernel/fs.h"

static struct fd_ops inotify_ops;

#define IN_CLOEXEC_ O_CLOEXEC_
#define IN_NONBLOCK_ O_NONBLOCK_

fd_t sys_inotify_init1(int_t flags) {
    STRACE("inotify_init1(%#x)", flags);
    if (flags & ~(IN_CLOEXEC_|IN_NONBLOCK_))
        return _EINVAL;

    struct fd *fd = adhoc_fd_create(&inotify_ops);
    if (fd == NULL)
        return _ENOMEM;
    return f_install(fd, flags);
}

fd_t sys_inotify_init(void) {
    return sys_inotify_init1(0);
}

int_t sys_inotify_add_watch(fd_t inotify_f, addr_t path_addr, uint_t mask) {
    STRACE("inotify_add_watch(%d, 0x%x, %#x)", inotify_f, path_addr, mask);
    struct fd *fd = f_get(inotify_f);
    if (fd == NULL)
        return _EBADF;
    if (fd->ops != &inotify_ops)
        return _EINVAL;
    // Return a dummy watch descriptor. We don't actually monitor anything.
    return 1;
}

int_t sys_inotify_rm_watch(fd_t inotify_f, int_t wd) {
    STRACE("inotify_rm_watch(%d, %d)", inotify_f, wd);
    struct fd *fd = f_get(inotify_f);
    if (fd == NULL)
        return _EBADF;
    if (fd->ops != &inotify_ops)
        return _EINVAL;
    return 0;
}

static ssize_t inotify_read(struct fd *fd, void *buf, size_t bufsize) {
    // No events are ever generated, so block (or return EAGAIN if nonblocking)
    if (fd->flags & O_NONBLOCK_)
        return _EAGAIN;
    // Block forever — caller would need a signal to break out
    lock(&fd->lock);
    wait_for(&fd->cond, &fd->lock, NULL);
    unlock(&fd->lock);
    return _EINTR;
}

static int inotify_poll(struct fd *fd) {
    // Never readable (no events), always writable is wrong for inotify.
    // inotify fds are only readable when events are pending.
    return 0;
}

static struct fd_ops inotify_ops = {
    .read = inotify_read,
    .poll = inotify_poll,
};
