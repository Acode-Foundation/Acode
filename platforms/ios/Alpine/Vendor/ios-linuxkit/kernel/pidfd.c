#include "kernel/calls.h"
#include "kernel/task.h"
#include "kernel/fs.h"
#include "fs/fd.h"
#include "fs/poll.h"
#include "util/sync.h"

// pidfd_open(2): a file descriptor that refers to a process. poll() returns
// POLLIN once the process has terminated (become a zombie / been reaped).
// bun uses pidfd to reap the helper processes it spawns (e.g. the `git` it
// runs at startup); with the old ENOSYS stub it fell back to a path that
// deadlocked its worker pool under iSH.

static struct fd_ops pidfd_ops;

// Registry of live pidfds so process exit can wake any poller waiting on them.
static struct list pidfd_list = LIST_INITIALIZER(pidfd_list);
static lock_t pidfd_lock = LOCK_INITIALIZER;

int_t sys_pidfd_open(pid_t_ pid, uint_t flags) {
    STRACE("pidfd_open(%d, %#x)", pid, flags);
    // Only PIDFD_NONBLOCK (== O_NONBLOCK) is defined; iSH pidfds never block on
    // read anyway, so accept it and ignore.
    if (flags & ~(O_NONBLOCK_))
        return _EINVAL;

    lock(&pids_lock);
    struct task *task = pid_get_task(pid);
    if (task == NULL) {
        unlock(&pids_lock);
        return _ESRCH;
    }
    // Linux restricts pidfd_open to thread-group leaders.
    bool is_leader = (task->group != NULL && task->group->leader == task);
    unlock(&pids_lock);
    if (!is_leader)
        return _EINVAL;

    struct fd *fd = adhoc_fd_create(&pidfd_ops);
    if (fd == NULL)
        return _ENOMEM;
    fd->pidfd.pid = pid;
    atomic_store_explicit(&fd->pidfd.exited, false, memory_order_relaxed);
    fd->flags = flags;

    lock(&pidfd_lock);
    list_add(&pidfd_list, &fd->pidfd_links);
    unlock(&pidfd_lock);

    // Linux always creates pidfds with O_CLOEXEC (there is no way to get a
    // non-cloexec pidfd from pidfd_open). PIDFD_NONBLOCK does not change that.
    return f_install(fd, O_CLOEXEC_);
}

static int pidfd_poll(struct fd *fd) {
    // Lock-free: read the exit flag published by pidfd_notify_exit. Must NOT
    // take pids_lock here — poll_wait() calls this with poll->lock held, and
    // the exit path takes pids_lock then wakes pidfd pollers (which grabs
    // poll->lock), so a pids_lock acquisition here would close an ABBA cycle.
    return atomic_load_explicit(&fd->pidfd.exited, memory_order_acquire)
               ? POLL_READ : 0;
}

static int pidfd_close(struct fd *fd) {
    lock(&pidfd_lock);
    list_remove(&fd->pidfd_links);
    unlock(&pidfd_lock);
    return 0;
}

// Called from the exit path when `pid` has become a zombie: wake any pidfd
// poller referencing it so a blocked poll()/epoll returns POLLIN.
void pidfd_notify_exit(pid_t_ pid) {
    extern char *getenv(const char *);
    int trace = getenv("ISH_PIDFD_TRACE") ? 1 : 0;
    int matched = 0, total = 0;
    lock(&pidfd_lock);
    struct fd *fd;
    list_for_each_entry(&pidfd_list, fd, pidfd_links) {
        total++;
        if (fd->pidfd.pid == pid) {
            // Publish the exit before waking, so a poll that races the wakeup
            // still observes POLL_READ. poll_wakeup takes fd->poll_lock and
            // poll->lock but NOT pids_lock, so calling it here (under pids_lock
            // via the exit path) does not reintroduce the ABBA — pidfd_poll no
            // longer takes pids_lock.
            atomic_store_explicit(&fd->pidfd.exited, true, memory_order_release);
            poll_wakeup(fd, POLL_READ);
            matched++;
        }
    }
    unlock(&pidfd_lock);
    if (trace)
        fprintf(stderr, "[pidfd] notify_exit(pid=%d): %d/%d pidfds matched+woken\n",
                pid, matched, total);
}

static struct fd_ops pidfd_ops = {
    .poll = pidfd_poll,
    .close = pidfd_close,
};
