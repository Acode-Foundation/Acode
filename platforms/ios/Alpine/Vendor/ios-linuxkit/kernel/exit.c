#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "kernel/calls.h"
#include "kernel/mm.h"
#include "kernel/futex.h"
#include "kernel/ptrace.h"
#include "fs/fd.h"
#include "fs/tty.h"
#include "platform/platform.h"

static void halt_system(void);

// Weak default: overridden by main.c in CLI builds.
// In iOS/Xcode builds where main.c is not linked into libish.a,
// this no-op prevents an undefined symbol error.
__attribute__((weak)) void restore_termios(void) {}

static bool exit_tgroup(struct task *task) {
    struct tgroup *group = task->group;
    list_remove(&task->group_links);
    bool group_dead = list_empty(&group->threads);
    if (group_dead) {
        // don't need to lock the group since the only pointers to it come from:
        // - other threads' current->group, but there are none left thanks to that list_empty call
        // - locking pids_lock first, which do_exit did
        if (group->itimer)
            timer_free(group->itimer);

        // The group will be removed from its group and session by reap_if_zombie,
        // because fish tries to set the pgid to that of an exited but not reaped
        // task.
        // https://github.com/Microsoft/WSL/issues/2786
    }
    return group_dead;
}

void (*exit_hook)(struct task *task, int code) = NULL;

#ifdef GUEST_ARM64
extern void arm64_fusion_stats_dump_if_enabled(void);
extern void arm64_block_stats_dump_if_enabled(void);
#endif

static struct task *find_new_parent(struct task *task) {
    struct task *new_parent;
    list_for_each_entry(&task->group->threads, new_parent, group_links) {
        if (!new_parent->exiting)
            return new_parent;
    }
    return pid_get_task(1);
}

noreturn void do_exit(int status) {
#ifdef GUEST_ARM64
    arm64_fusion_stats_dump_if_enabled();
    arm64_block_stats_dump_if_enabled();
#endif
    // If this thread was already marked as leaked by the safety valve,
    // the group leader has finished exiting and the group struct may be
    // freed. Don't touch any shared state — just kill the host thread.
    if (current->exiting) {
        current = NULL;
        pthread_exit(NULL);
    }

    // Block SIGSEGV during exit to prevent cosmetic crashes from host
    // pthread stack unwinding (especially with many threads exiting at once).
    if (current->group->doing_group_exit) {
        sigset_t set;
        sigemptyset(&set);
        sigaddset(&set, SIGSEGV);
        sigaddset(&set, SIGBUS);
        pthread_sigmask(SIG_BLOCK, &set, NULL);
    }

    // has to happen before mm_release
    addr_t clear_tid = current->clear_tid;
    if (clear_tid) {
        pid_t_ zero = 0;
        if (user_put(clear_tid, zero) == 0)
            futex_wake(clear_tid, 1);
    }

    // release all our resources (may already be NULL if force-released by do_exit_group)
    if (current->mm != NULL) {
        mm_release(current->mm);
        current->mm = NULL;
        // [T-ish-mm-leak-refcount-handoff] We just released it, so the pthread
        // cleanup handler must NOT release again.
        current->mm_release_deferred = false;
    }
    if (current->files != NULL) {
        fdtable_release(current->files);
        current->files = NULL;
    }
    if (current->fs != NULL) {
        fs_info_release(current->fs);
        current->fs = NULL;
    }
    // Close per-thread futex wakeup pipe
    if (current->futex_pipe[0] != -1) {
        close(current->futex_pipe[0]);
        current->futex_pipe[0] = -1;
    }
    if (current->futex_pipe[1] != -1) {
        close(current->futex_pipe[1]);
        current->futex_pipe[1] = -1;
    }

    // sighand must be released below so it can be protected by pids_lock
    // since it can be accessed by other threads

    // save things that our parent might be interested in
    current->exit_code = status; // FIXME locking
    struct rusage_ rusage = rusage_get_current();
    lock(&current->group->lock);
    rusage_add(&current->group->rusage, &rusage);
    struct rusage_ group_rusage = current->group->rusage;
    unlock(&current->group->lock);

    // the actual freeing needs pids_lock
    lock(&pids_lock);
    current->exiting = true;
    // release the sighand (may already be NULL if another thread in the group
    // exited concurrently and released it, e.g. after safety-valve SIGUSR1)
    if (current->sighand != NULL) {
        sighand_release(current->sighand);
        current->sighand = NULL;
    }
    struct sigqueue *sigqueue, *sigqueue_tmp;
    list_for_each_entry_safe(&current->queue, sigqueue, sigqueue_tmp, queue) {
        list_remove(&sigqueue->queue);
        free(sigqueue);
    }
    struct task *leader = current->group->leader;

    // reparent children
    struct task *new_parent = find_new_parent(current);
    struct task *child, *tmp;
    list_for_each_entry_safe(&current->children, child, tmp, siblings) {
        child->parent = new_parent;
        list_remove(&child->siblings);
        list_add(&new_parent->children, &child->siblings);
    }

    if (exit_tgroup(current)) {
        // If already marked zombie by do_exit_group force path, skip
        if (leader->zombie)
            goto skip_zombie_notify;

        // notify parent that we died
        struct task *parent = leader->parent;
        if (parent == NULL && current->pid != 1) {
            // Non-init process with no parent - try to find one
            // This can happen during reparenting or if parent exited first
            parent = pid_get_task(1); // Reparent to init
            if (parent != NULL)
                leader->parent = parent;
        }

        if (parent == NULL) {
            // init died
            if (exit_hook != NULL)
                exit_hook(current, status);
            halt_system();
        } else {
            leader->zombie = true;
            notify(&parent->group->child_exit);
            // Wake any pidfd poller waiting on this pid.
            pidfd_notify_exit(leader->pid);
            struct siginfo_ info = {
                .code = SI_KERNEL_,
                .child.pid = current->pid,
                .child.uid = current->uid,
                .child.status = current->exit_code,
                .child.utime = clock_from_timeval(group_rusage.utime),
                .child.stime = clock_from_timeval(group_rusage.stime),
            };
            if (leader->exit_signal != 0)
                send_signal(parent, leader->exit_signal, info);
        }

        if (parent != NULL && exit_hook != NULL)
            exit_hook(current, status);
    skip_zombie_notify: ;
    }

    vfork_notify(current);
    if (current != leader) {
        struct task *self = current;
        current = NULL;  // Clear before destroy to prevent dangling access
        task_destroy(self);
    } else {
        // A parent may reap the leader as soon as pids_lock is released.
        // Its resources are already released; pthread cleanup must not use it.
        current = NULL;
    }
    unlock(&pids_lock);

    pthread_exit(NULL);
}

noreturn void do_exit_group(int status) {
    // Leaked thread woke up after group already exited — bail silently.
    if (current->exiting) {
        current = NULL;
        pthread_exit(NULL);
    }
    struct tgroup *group = current->group;
    lock(&pids_lock);
    lock(&group->lock);
    bool is_group_leader = false;
    if (!group->doing_group_exit) {
        group->doing_group_exit = true;
        group->group_exit_code = status;
        is_group_leader = true;  // First thread to call exit_group
    } else {
        status = group->group_exit_code;
    }

    // kill everyone else in the group
    int thread_count = 0;
    struct task *task;
    list_for_each_entry(&group->threads, task, group_links) {
        thread_count++;
        deliver_signal(task, SIGKILL_, SIGINFO_NIL);
        task->group->stopped = false;
        notify(&task->group->stopped_cond);
    }
    (void)is_group_leader;

    // Only the first thread (group leader) waits for others to exit
    // Other threads exit immediately to avoid deadlock
    if (is_group_leader && thread_count > 1) {
        unlock(&group->lock);
        unlock(&pids_lock);

        // Wait for threads to exit (they're DETACHED so we can't join)
        // Poll the thread count until only current thread remains
        int max_wait_ms = 5000 + thread_count * 10;  // Scale with thread count
        if (max_wait_ms > 10000) max_wait_ms = 10000;  // Cap at 10s
        int wait_interval_ms = 10;  // Check every 10ms
        int waited_ms = 0;
        int last_remaining = -1;

        while (waited_ms < max_wait_ms) {
            lock(&pids_lock);
            lock(&group->lock);

            // Count threads still in the group (excluding current)
            int remaining = 0;
            list_for_each_entry(&group->threads, task, group_links) {
                if (task != current) {
                    remaining++;
                }
            }

            unlock(&group->lock);
            unlock(&pids_lock);

            last_remaining = remaining;

            if (remaining == 0) {
                break;
            }

            // Sleep a bit to let threads exit
            struct timespec ts = {0, wait_interval_ms * 1000000L};
            nanosleep(&ts, NULL);
            waited_ms += wait_interval_ms;
        }

        if (waited_ms >= max_wait_ms) {
            // Threads are stuck in blocking syscalls and won't exit.
            printk("SAFETY-VALVE[exit]: pid=%d do_exit_group waited %dms, %d threads still stuck → force kill\n",
                   current->pid, waited_ms, last_remaining);

            // Signal stuck threads with SIGUSR1 repeatedly.
            // Don't use pthread_cancel — it can corrupt malloc state if the
            // thread is cancelled inside malloc/free.
            for (int attempt = 0; attempt < 3; attempt++) {
                lock(&pids_lock);
                lock(&group->lock);
                int still_alive = 0;
                list_for_each_entry(&group->threads, task, group_links) {
                    if (task != current && !task->exiting) {
                        still_alive++;
                        cpu_poke(&task->cpu);
                        if (task->thread)
                            pthread_kill(task->thread, SIGUSR1);
                    }
                }
                unlock(&group->lock);
                unlock(&pids_lock);
                if (still_alive == 0) break;
                struct timespec ts2 = {0, 50 * 1000000L};  // 50ms
                nanosleep(&ts2, NULL);
            }

            // If threads are truly stuck in uninterruptible host syscalls,
            // we accept the leak rather than risking heap corruption.
            // Mark them as exiting and remove from the thread group list so
            // that exit_tgroup() sees the group as dead and notifies the parent.
            lock(&pids_lock);
            lock(&group->lock);
            int leaked = 0;
            struct task *task_tmp;
            list_for_each_entry_safe(&group->threads, task, task_tmp, group_links) {
                if (task != current && !task->exiting) {
                    task->exiting = true;
                    list_remove(&task->group_links);
                    // Release resources so pipes get EOF and memory is freed.
                    if (task->sighand != NULL) {
                        sighand_release(task->sighand);
                        task->sighand = NULL;
                    }
                    // [T-ish-mem-uaf-user-write / T-ish-mm-leak-refcount-handoff]
                    // DO NOT mm_release() a stuck thread's mm HERE. This thread
                    // is, by definition, still running inside an uninterruptible
                    // host syscall (e.g. sys_read → user_write blocked on a
                    // pipe) and may still hold mem->lock and be about to
                    // dereference task->mem. Freeing the mm now is a
                    // use-after-free (EXC_BAD_ACCESS at 0x38 = offsetof(struct
                    // mem, lock)). So keep task->mm/task->mem intact for now, but
                    // DEFER the release to this thread's own pthread cleanup
                    // handler (task_run_current), which runs only after the
                    // thread has left the read_wrlock critical section — so it
                    // both avoids the UAF and, unlike the old "accept the leak"
                    // path, actually reclaims the whole guest address space once
                    // the host pthread finally terminates. If the thread instead
                    // unblocks and re-enters do_exit(), that mm_release()s and
                    // clears the flag, so cleanup won't double-free.
                    task->mm_release_deferred = true;
                    if (task->files != NULL) {
                        fdtable_release(task->files);
                        task->files = NULL;
                    }
                    if (task->fs != NULL) {
                        fs_info_release(task->fs);
                        task->fs = NULL;
                    }
                    leaked++;
                }
            }
            unlock(&group->lock);
            unlock(&pids_lock);
            if (leaked > 0)
                printk("SAFETY-VALVE[exit]: pid=%d leaked %d stuck host threads\n",
                       current->pid, leaked);
        } else {

            // Give extra time for pthread cleanup on host system
            // This ensures:
            // 1. pthread_exit() completes for all threads
            // 2. TLS destructors run
            // 3. Host malloc/arena cleanup happens
            // 4. Stack unwinding completes (glibc on ARM64)
            struct timespec extra_delay = {0, 50 * 1000000L};  // 50ms for pthread cleanup
            nanosleep(&extra_delay, NULL);

            platform_release_thread_memory_pressure();
        }

        lock(&pids_lock);
        lock(&group->lock);
    }

    unlock(&group->lock);
    unlock(&pids_lock);

    do_exit(status);
}

// always called from init process
static void halt_system(void) {
    int max_iterations = 10; // Timeout: wait maximum 10 seconds
    for (int state = 0; state < 3; state++) {
        int tasks_found = 0;
        for (int i = 2; i < MAX_PID; i++) {
            struct task *task = pid_get_task(i);
            if (task != NULL) {
                tasks_found++;
                switch (state) {
                case 0:
                    deliver_signal(task, SIGTERM_, SIGINFO_NIL);
                    break;
                case 1:
                    deliver_signal(task, SIGKILL_, SIGINFO_NIL);
                    break;
                case 2:
                    pthread_kill(task->thread, SIGTERM);
                }
            }
        }
        if (tasks_found == 0)
            break;
        if (state != 2) {
            sleep(1);
            // Timeout protection: if we've waited too long, force exit
            if (--max_iterations <= 0) {
                printk("halt_system: timeout after 10 seconds, %d tasks remaining\n", tasks_found);
                break;
            }
        }
    }

    // unmount all filesystems
    lock(&mounts_lock);
    struct mount *mount, *tmp;
    list_for_each_entry_safe(&mounts, mount, tmp, mounts) {
        mount_remove(mount);
    }
    unlock(&mounts_lock);

    // Restore host terminal settings before exiting.
    // _exit() does not call atexit handlers, so we must do this explicitly.
    extern void restore_termios(void);
    restore_termios();

    // Force exit the entire host process. Orphaned guest threads
    // (stuck in JIT loops after do_exit_group force cleanup) keep
    // the host process alive indefinitely. _exit is safe here since
    // init dying means we're shutting down completely.
    _exit(0);
}

dword_t sys_exit(dword_t status) {
    STRACE("exit(%d)\n", status);
    do_exit(status << 8);
}

dword_t sys_exit_group(dword_t status) {
    STRACE("exit_group(%d)\n", status);
    do_exit_group(status << 8);
}

#define WNOHANG_ (1 << 0)
#define WUNTRACED_ (1 << 1)
#define WEXITED_ (1 << 2)
#define WCONTINUED_ (1 << 3)
#define WNOWAIT_ (1 << 24)
#define __WALL_ (1 << 30)

#define P_ALL_ 0
#define P_PID_ 1
#define P_PGID_ 2

// returns false if the task cannot be reaped and true if the task was reaped
static bool reap_if_zombie(struct task *task, struct siginfo_ *info_out, struct rusage_ *rusage_out, int options) {
    if (!task->zombie)
        return false;
    lock(&task->group->lock);

    dword_t exit_code = task->exit_code;
    if (task->group->doing_group_exit)
        exit_code = task->group->group_exit_code;
    info_out->child.status = exit_code;

    struct rusage_ rusage = task->group->rusage;
    if (!(options & WNOWAIT_)) {
        lock(&current->group->lock);
        rusage_add(&current->group->children_rusage, &rusage);
        unlock(&current->group->lock);
    }
    if (rusage_out != NULL)
        *rusage_out = rusage;

    unlock(&task->group->lock);

    // WNOWAIT means don't destroy the child, instead leave it so it could be waited for again.
    if (options & WNOWAIT_)
        return true;

    // tear down group
    cond_destroy(&task->group->child_exit);
    task_leave_session(task);
    list_remove(&task->group->pgroup);
    free(task->group);

    task_destroy(task);
    return true;
}

static bool notify_if_stopped(struct task *task, struct siginfo_ *info_out) {
    lock(&task->group->lock);
    bool stopped = task->group->stopped;
    unlock(&task->group->lock);
    if (!stopped || task->group->group_exit_code == 0)
        return false;
    dword_t exit_code = task->group->group_exit_code;
    task->group->group_exit_code = 0;
    info_out->child.status = exit_code;
    return true;
}

static bool reap_if_needed(struct task *task, struct siginfo_ *info_out, struct rusage_ *rusage_out, int options) {
    assert(task_is_leader(task));
    if ((options & WUNTRACED_ && notify_if_stopped(task, info_out)) ||
        (options & WEXITED_ && reap_if_zombie(task, info_out, rusage_out, options))) {
        info_out->sig = SIGCHLD_;
        return true;
    }
    lock(&task->ptrace.lock);
    if (task->ptrace.stopped && task->ptrace.signal) {
        // I had this code here because it made something work, but it's now
        // making GDB think we support events (we don't). I can't remember what
        // it fixed but until then commenting it out for now.
        info_out->child.status = /* task->ptrace.trap_event << 16 |*/ task->ptrace.signal << 8 | 0x7f;
        task->ptrace.signal = 0;
        unlock(&task->ptrace.lock);
        return true;
    }
    unlock(&task->ptrace.lock);
    return false;
}

int do_wait(int idtype, pid_t_ id, struct siginfo_ *info, struct rusage_ *rusage, int options) {
    if (idtype != P_ALL_ && idtype != P_PID_ && idtype != P_PGID_)
        return _EINVAL;
    if (options & ~(WNOHANG_|WUNTRACED_|WEXITED_|WCONTINUED_|WNOWAIT_|__WALL_))
        return _EINVAL;

    lock(&pids_lock);
    int err;
    bool got_signal = false;

retry:
    ;
    if (idtype != P_PID_) {
        // look for a zombie child
        bool no_children = true;
        struct task *parent;
        list_for_each_entry(&current->group->threads, parent, group_links) {
            struct task *task;
            list_for_each_entry(&current->children, task, siblings) {
                if (!task_is_leader(task))
                    continue;
                if (idtype == P_PGID_ && task->group->pgid != id)
                    continue;
                no_children = false;
                info->child.pid = task->pid;
                if (reap_if_needed(task, info, rusage, options))
                    goto found_something;
            }
        }
        if (no_children) {
            err = _ECHILD;
            goto error;
        }
    } else {
        // check if this child is a zombie
        struct task *task = pid_get_task_zombie(id);
        err = _ECHILD;
        if (task == NULL || task->parent == NULL || task->parent->group != current->group)
            goto error;
        task = task->group->leader;
        info->child.pid = id;
        if (reap_if_needed(task, info, rusage, options))
            goto found_something;
    }

    // WNOHANG leaves the info in an implementation-defined state. set the pid
    // to 0 so wait4 can pass that along correctly.
    info->child.pid = 0;
    if (options & WNOHANG_) {
        info->sig = SIGCHLD_;
        goto found_something;
    }

    err = _EINTR;
    if (got_signal)
        goto error;

    // no matching zombie found, wait for one.
    // Use a bounded 1-second timeout to work around macOS condvar issues
    // (pthread_cond_wait can block forever under thread contention).
    current->blocking = true;
    {
        struct timespec waitpid_timeout = {.tv_sec = 1, .tv_nsec = 0};
        int wait_err = wait_for(&current->group->child_exit, &pids_lock, &waitpid_timeout);
        if (wait_err == _EINTR) {
            // Signal received during wait. A timeout is expected here: wait4
            // polls once per second to avoid host condvar stalls and must not
            // be reported to the guest as EINTR.
            got_signal = true;
        }
    }
    current->blocking = false;
    {
        // Update last_progress_ns: waitpid is actively polling for a child,
        // this is real work (not a stuck thread). Prevents the poll_wait
        // safety valve from killing a parent waiting for a long-running child.
        struct timespec _ts;
        clock_gettime(CLOCK_MONOTONIC, &_ts);
        uint64_t now = (uint64_t)_ts.tv_sec * 1000000000ULL + _ts.tv_nsec;
        current->last_unblocked_ns = now;
        atomic_store_explicit(&current->group->last_progress_ns, now,
                              memory_order_relaxed);
    }
    goto retry;

    info->sig = SIGCHLD_;
found_something:
    unlock(&pids_lock);
    return 0;

error:
    unlock(&pids_lock);
    return err;
}

dword_t sys_waitid(int_t idtype, pid_t_ id, addr_t info_addr, int_t options) {
    STRACE("waitid(%d, %d, %#x, %#x)", idtype, id, info_addr, options);
    struct siginfo_ info = {};
    int_t res = do_wait(idtype, id, &info, NULL, options);
    if (res < 0 || (res == 0 && info.child.pid == 0))
        return res;
    if (info_addr != 0 && user_put(info_addr, info))
        return _EFAULT;
    return 0;
}

dword_t sys_wait4(pid_t_ id, addr_t status_addr, dword_t options, addr_t rusage_addr) {
    STRACE("wait4(%d, %#x, %#x, %#x)", id, status_addr, options, rusage_addr);
    if (options & WNOWAIT_)
        return _EINVAL;

    int idtype;
    if (id > 0)
        idtype = P_PID_;
    else if (id == -1)
        idtype = P_ALL_;
    else {
        idtype = P_PGID_;
        if (id == 0)
            id = current->group->pgid;
        else
            id = -id;
    }

    struct siginfo_ info = {.child.pid = 0xbaba};
    struct rusage_ rusage;
    int_t res = do_wait(idtype, id, &info, &rusage, options | WEXITED_);
    if (res < 0 || (res == 0 && info.child.pid == 0))
        return res;
    if (status_addr != 0 && user_put(status_addr, info.child.status))
        return _EFAULT;
    if (rusage_addr != 0 && user_put(rusage_addr, rusage))
        return _EFAULT;
    return info.child.pid;
}

dword_t sys_waitpid(pid_t_ pid, addr_t status_addr, dword_t options) {
    return sys_wait4(pid, status_addr, options, 0);
}
