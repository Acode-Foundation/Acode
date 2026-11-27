#ifndef TASK_H
#define TASK_H

#include <pthread.h>
#include "emu/cpu.h"
#include "kernel/mm.h"
#include "kernel/fs.h"
#include "kernel/signal.h"
#include "kernel/resource.h"
#include "fs/sockrestart.h"
#include "util/list.h"
#include "util/timer.h"
#include "util/sync.h"

// everything here is private to the thread executing this task and needs no
// locking, unless otherwise specified
struct task {
    struct cpu_state cpu;
    struct mm *mm; // locked by general_lock
    struct mem *mem; // pointer to mm.mem, for convenience
    pthread_t thread;
    uint64_t threadid;

    struct tgroup *group; // immutable
    struct list group_links;
    pid_t_ pid, tgid; // immutable
    uint64_t start_time_ticks; // immutable, Linux USER_HZ (100 ticks/second)
    uid_t_ uid, gid;
    uid_t_ euid, egid;
    uid_t_ suid, sgid;
#define MAX_GROUPS 32
    unsigned ngroups;
    uid_t_ groups[MAX_GROUPS];
    char comm[16] __strncpy_safe; // locked by general_lock
    bool did_exec; // for that one annoying setsid edge case

    struct fdtable *files;
    struct fs_info *fs;

    // locked by sighand->lock
    struct sighand *sighand;
    // Linux sigaltstack state is per-thread, not shared with the signal-action
    // table. Runtimes such as Go install one alternate signal stack per M/thread;
    // sharing this through sighand corrupts signal delivery between threads.
    addr_t altstack;
    dword_t altstack_size;
    sigset_t_ blocked;
    sigset_t_ pending;
    sigset_t_ waiting; // if nonzero, an ongoing call to sigtimedwait is waiting on these
    struct list queue;
    cond_t pause; // please don't signal this
    // private
    sigset_t_ saved_mask;
    bool has_saved_mask;

    // Set when thread is in a blocking syscall (futex_wait, poll_wait, etc.)
    // Used for deadlock detection: if all threads are blocking, it's a hang.
    bool blocking;
    // Per-thread pipe for futex_wait wakeup (reused across calls to avoid
    // pipe creation overhead in Go runtime spin loops)
    int futex_pipe[2]; // [0]=read, [1]=write; -1 if not yet created
    // Timestamp (CLOCK_MONOTONIC ns) of last time blocking became false.
    // Used by deadlock detector to check how long ALL threads have been stuck.
    uint64_t last_unblocked_ns;

    struct {
        // Locks all ptrace-related things
        lock_t lock;
        cond_t cond;

        bool traced;
        bool stopped;
        int signal;
        struct siginfo_ info;
        int trap_event;
    } ptrace;

    // locked by pids_lock
    struct task *parent;
    struct list children;
    struct list siblings;

    addr_t clear_tid;
    addr_t robust_list;
    addr_t rseq_addr;
    dword_t rseq_len;
    dword_t rseq_sig;
    bool rseq_registered;

    // SA_RESTART support: on each syscall entry we snapshot the number and the
    // first arg (x0/ebx), which the return value overwrites. If the syscall is
    // interrupted (returns EINTR) and a signal with SA_RESTART is then
    // delivered, receive_signals rewinds PC to the syscall instruction and
    // restores the original first arg so the syscall re-executes — matching
    // Linux. Without it, JSC's SIGPWR-based GC safepoint handshake (which
    // registers SA_RESTART) livelocks on a futex that keeps returning EINTR.
    unsigned syscall_restart_num;
    uint64_t syscall_restart_arg0;
    uint64_t syscall_restart_pc; // cpu.pc at syscall entry (== svc_addr+4); the
                                 // SA_RESTART rewind only fires when cpu.pc still
                                 // equals this, so a stale syscall_restartable
                                 // flag can't corrupt PC on a later interrupt.
    bool syscall_restartable; // this syscall returned EINTR and may restart

    // locked by pids_lock
    dword_t exit_code;
    bool zombie;
    bool exiting;
    // [T-ish-mm-leak-refcount-handoff] Set by the do_exit_group safety valve
    // when it orphans a thread stuck in an uninterruptible host syscall: the
    // valve can't mm_release() now (the thread may still hold mem->lock inside
    // user_write → UAF, see T-ish-mem-uaf-user-write), so it hands the release
    // off to this thread's own pthread cleanup handler, which runs only after
    // the thread has left the read_wrlock critical section. Prevents the mm
    // (whole guest address space) from leaking forever when the thread never
    // re-enters do_exit(). Cleared once released so it never double-frees.
    bool mm_release_deferred;

    // this structure is allocated on the stack of the parent's clone() call
    struct vfork_info {
        bool done;
        cond_t cond;
        lock_t lock;
    } *vfork;
    int exit_signal;

    // lock for anything that needs locking but is not covered by some other lock
    // specifically: comm, mm
    lock_t general_lock;

    struct task_sockrestart sockrestart;

    // Native offload: when is_native_proxy is true, this task is waiting
    // for a host-native process instead of running emulated code.
    pid_t native_pid;
    bool is_native_proxy;

    // current condition/lock, so it can be notified in case of a signal
    cond_t *waiting_cond;
    lock_t *waiting_lock;
    lock_t waiting_cond_lock;
};

// current will always give the process that is currently executing
// if I have to stop using __thread, current will become a macro
extern __thread struct task *current;

static inline void task_set_mm(struct task *task, struct mm *mm) {
    task->mm = mm;
    task->mem = &task->mm->mem;
    task->cpu.mmu = &task->mem->mmu;
}

// Creates a new process, initializes most fields from the parent. Specify
// parent as NULL to create the init process. Returns NULL if out of memory.
// Ends with an underscore because there's a mach function by the same name
struct task *task_create_(struct task *parent);
// Removes the process from the process table and frees it. Must be called with pids_lock.
void task_destroy(struct task *task);

// misc
void vfork_notify(struct task *task);
pid_t_ task_setsid(struct task *task);
void task_leave_session(struct task *task);

struct posix_timer {
    struct timer *timer;
    int_t timer_id;
    struct tgroup *tgroup;
    pid_t_ thread_pid;
    int_t signal;
    union sigval_ sig_value;
};

// struct thread_group is way too long to type comfortably
struct tgroup {
    struct list threads; // locked by pids_lock, by majority vote
    struct task *leader; // immutable
    struct rusage_ rusage;

    // locked by pids_lock
    pid_t_ sid, pgid;
    struct list session;
    struct list pgroup;

    bool stopped;
    cond_t stopped_cond;

    struct tty *tty;
    struct timer *itimer;
#define TIMERS_MAX 16
    struct posix_timer posix_timers[TIMERS_MAX];

    struct rlimit_ limits[RLIMIT_NLIMITS_];

    // From https://twitter.com/tblodt/status/957706819236904960
    // > there are two distinct ways for a p̶r̶o̶c̶e̶s̶s̶ thread group to exit:
    // > 
    // > - each thread calls exit
    // > wait will return the exit code for the group leader
    // > 
    // > - any thread calls exit_group
    // > the SIGNAL_GROUP_EXIT flag will be set and wait will return the status passed to exit_group
    //
    // TODO locking
    bool doing_group_exit;
    dword_t group_exit_code;

    struct rusage_ children_rusage;
    cond_t child_exit;

    dword_t personality;

    // Monotonically increasing syscall counter for deadlock detection.
    atomic_uint syscall_count;

    // Timestamp of last real progress (non-blocking syscall completion).
    // Updated atomically. Used by futex/poll safety valves to detect
    // process-wide hangs where all threads are idle.
    _Atomic uint64_t last_progress_ns;

    // for everything in this struct not locked by something else
    lock_t lock;
};

static inline bool task_is_leader(struct task *task) {
    return task->group->leader == task;
}

struct pid {
    dword_t id;
    struct task *task;
    struct list session;
    struct list pgroup;
};

// synchronizes obtaining a pointer to a task and freeing that task
extern lock_t pids_lock;
// these functions must be called with pids_lock
struct pid *pid_get(dword_t pid);
struct task *pid_get_task(dword_t pid);
struct task *pid_get_task_zombie(dword_t id); // don't return null if the task exists as a zombie

#define MAX_PID (1 << 15) // oughta be enough

// TODO document
void task_start(struct task *task);
void task_run_current(void);

extern void (*exit_hook)(struct task *task, int code);

#define superuser() (current != NULL && current->euid == 0)

// Update the thread name to match the current task, in the format "comm-pid".
// Will ensure that the -pid part always fits, then will fit as much of comm as possible.
void update_thread_name(void);

#endif
