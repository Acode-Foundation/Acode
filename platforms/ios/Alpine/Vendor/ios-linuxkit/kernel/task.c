#define _GNU_SOURCE
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "kernel/calls.h"
#include "kernel/task.h"
#include "kernel/memory.h"
#include "emu/tlb.h"
#include "platform/platform.h"

__thread struct task *current;

static struct pid pids[MAX_PID + 1] = {};
lock_t pids_lock = LOCK_INITIALIZER;

static bool pid_empty(struct pid *pid) {
    return pid->task == NULL && list_empty(&pid->session) && list_empty(&pid->pgroup);
}

struct pid *pid_get(dword_t id) {
    if (id > sizeof(pids)/sizeof(pids[0]))
        return NULL;
    struct pid *pid = &pids[id];
    if (pid_empty(pid))
        return NULL;
    return pid;
}

struct task *pid_get_task_zombie(dword_t id) {
    struct pid *pid = pid_get(id);
    if (pid == NULL)
        return NULL;
    struct task *task = pid->task;
    return task;
}

struct task *pid_get_task(dword_t id) {
    struct task *task = pid_get_task_zombie(id);
    if (task != NULL && task->zombie)
        return NULL;
    return task;
}

struct task *task_create_(struct task *parent) {
    lock(&pids_lock);
    static int cur_pid = 0;
    do {
        cur_pid++;
        if (cur_pid > MAX_PID) cur_pid = 1;
    } while (!pid_empty(&pids[cur_pid]));
    struct pid *pid = &pids[cur_pid];
    pid->id = cur_pid;
    list_init(&pid->session);
    list_init(&pid->pgroup);

    struct task *task = malloc(sizeof(struct task));
    if (task == NULL)
        return NULL;
    *task = (struct task) {};
    if (parent != NULL)
        *task = *parent;
    task->pid = pid->id;
    pid->task = task;

#ifdef GUEST_ARM64
    // Invalidate exclusive monitor after copying parent state.
    // Child must not inherit parent's reservation, as any context switch or
    // interrupt (including fork/clone) invalidates exclusive state.
    task->cpu.excl_addr = UINT64_MAX;
    task->cpu.excl_pair_addr = UINT64_MAX;
    task->cpu.excl_pair_size = 0;
#endif

    // The poke flag must not be inherited: poked_ptr would alias the parent's
    // _poked byte (cross-task pokes), and a copied _poked=true seeds a
    // permanent one-interrupt-per-block storm in the child.
    task->cpu.poked_ptr = &task->cpu._poked;
    task->cpu._poked = false;

    // Initialize blocking state for deadlock detection.
    task->blocking = false;
    {
        struct timespec start_time;
        clock_gettime(CLOCK_MONOTONIC, &start_time);
        task->last_unblocked_ns = (uint64_t)start_time.tv_sec * 1000000000ULL + start_time.tv_nsec;
        task->start_time_ticks = (uint64_t)start_time.tv_sec * 100 + start_time.tv_nsec / 10000000;
    }
    list_init(&task->children);
    list_init(&task->siblings);
    if (parent != NULL) {
        task->parent = parent;
        list_add(&parent->children, &task->siblings);
    }
    unlock(&pids_lock);

    task->pending = 0;
    list_init(&task->queue);
    task->clear_tid = 0;
    task->robust_list = 0;
    task->rseq_addr = 0;
    task->rseq_len = 0;
    task->rseq_sig = 0;
    task->rseq_registered = false;
    task->futex_pipe[0] = -1;
    task->futex_pipe[1] = -1;
    task->did_exec = false;
    lock_init(&task->general_lock);

    task->sockrestart = (struct task_sockrestart) {};
    list_init(&task->sockrestart.listen);

    task->waiting_cond = NULL;
    task->waiting_lock = NULL;
    lock_init(&task->waiting_cond_lock);
    cond_init(&task->pause);

    lock_init(&task->ptrace.lock);
    cond_init(&task->ptrace.cond);
    return task;
}

// Deferred-free list for task structs.
// When a task is destroyed, its struct is not immediately freed — instead it's
// placed on this list. The NEXT call to task_destroy will free previously
// deferred structs. This gives leaked/exiting pthreads time to finish accessing
// `current` before the memory is recycled by malloc, preventing use-after-free
// heap corruption.
#define DEFERRED_FREE_MAX 64
static struct task *deferred_free_list[DEFERRED_FREE_MAX];
static int deferred_free_count = 0;
// Must be called with pids_lock held (task_destroy already requires this).
static void flush_deferred_frees(void) {
    for (int i = 0; i < deferred_free_count; i++) {
        free(deferred_free_list[i]);
        deferred_free_list[i] = NULL;
    }
    deferred_free_count = 0;
}

void task_destroy(struct task *task) {
    list_remove(&task->siblings);
    pid_get(task->pid)->task = NULL;

    // Flush old deferred frees first — they've had time to quiesce.
    flush_deferred_frees();

    // Zero the struct to poison stale `current` references, then defer the
    // actual free. This way if a leaked pthread is still running, it will
    // hit zeroed fields (NULL group, NULL mem) and crash cleanly rather than
    // silently corrupting a newly-allocated task at the same address.
    memset(task, 0, sizeof(struct task));

    if (deferred_free_count < DEFERRED_FREE_MAX) {
        deferred_free_list[deferred_free_count++] = task;
    } else {
        // Overflow — free immediately (rare, only with 64+ concurrent exits)
        free(task);
    }
}

static void task_run_tlb_cleanup(void *arg) {
    tlb_free((struct tlb *)arg);
    // [T-ish-mm-leak-refcount-handoff] If the do_exit_group safety valve
    // orphaned this thread (stuck in an uninterruptible host syscall) it
    // deferred the mm_release to here — this runs only when the host pthread
    // actually terminates, i.e. AFTER the thread has left the read_wrlock
    // critical section, so releasing now can't UAF the mem lock. This reclaims
    // the whole guest address space instead of leaking it forever. `current`
    // is a __thread TLS pointer, still valid inside pthread cleanup.
    struct task *self = current;
    if (self != NULL && self->mm_release_deferred && self->mm != NULL) {
        self->mm_release_deferred = false;
        mm_release(self->mm);
        self->mm = NULL;
        self->mem = NULL;
    }
}

void task_run_current() {
    struct cpu_state *cpu = &current->cpu;
    struct tlb *tlb = calloc(1, sizeof(struct tlb));
    if (!tlb) die("could not allocate TLB");

    // Register cleanup so the TLB (and its fiber_frame) is freed even when
    // the thread exits via pthread_exit() from deep in handle_interrupt()
    // (e.g. do_exit() after a native-offloaded execve, or SIGKILL path).
    // Without this, every guest process leaks ~304KB of TLB + ~48KB of
    // fiber_frame, dominating app memory after repeated ffmpeg invocations.
    pthread_cleanup_push(task_run_tlb_cleanup, tlb);

    while (true) {
        // Check for group exit before entering JIT — this catches threads
        // returning from blocking host syscalls (futex, nanosleep, etc.)
        // that were interrupted by SIGUSR1 from do_exit_group.
        // Also bail if our task struct was destroyed (current zeroed or NULLed).
        struct task *self = current;
        if (self == NULL || self->group == NULL) {
            // Task struct was destroyed under us (leaked thread).
            // Exit the host thread silently; cleanup handler frees tlb.
            pthread_exit(NULL);
        }
        if (self->group->doing_group_exit) {
            do_exit(self->group->group_exit_code);
        }
        if (self->mem == NULL) {
            pthread_exit(NULL);
        }
        read_wrlock(&self->mem->lock);
        tlb_refresh(tlb, &self->mem->mmu);
        int interrupt = cpu_run_to_interrupt(cpu, tlb);
        read_wrunlock(&self->mem->lock);
        handle_interrupt(interrupt);
    }

    // Never reached in practice (loop only exits via pthread_exit/do_exit),
    // but the pop is required for pthread_cleanup_push/pop balance.
    pthread_cleanup_pop(1);
}

static void *task_thread(void *vtask) {
    current = vtask;
    update_thread_name();
    task_run_current();
    die("task_thread returned"); // above function call should never return
}

static pthread_attr_t task_thread_attr;
__attribute__((constructor)) static void create_attr() {
    pthread_attr_init(&task_thread_attr);
    pthread_attr_setdetachstate(&task_thread_attr, PTHREAD_CREATE_DETACHED);
}

void task_start(struct task *task) {
    if (pthread_create(&task->thread, &task_thread_attr, task_thread, task) < 0)
        die("could not create thread");
}

int_t sys_sched_yield() {
    STRACE("sched_yield()");
    sched_yield();
    return 0;
}

void update_thread_name() {
    char name[16]; // As long as Linux will let us make this
    snprintf(name, sizeof(name), "-%d", current->pid);
    size_t pid_width = strlen(name);
    size_t name_width = snprintf(name, sizeof(name), "%s", current->comm);
    sprintf(name + (name_width < sizeof(name) - 1 - pid_width ? name_width : sizeof(name) - 1 - pid_width), "-%d", current->pid);
    platform_set_thread_name(name);
}
