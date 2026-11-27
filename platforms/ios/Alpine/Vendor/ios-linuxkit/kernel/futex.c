#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include "kernel/calls.h"

#define FUTEX_WAIT_ 0
#define FUTEX_WAKE_ 1
#define FUTEX_REQUEUE_ 3
#define FUTEX_CMP_REQUEUE_ 4
#define FUTEX_WAKE_OP_ 5
#define FUTEX_WAIT_BITSET_ 9
#define FUTEX_WAKE_BITSET_ 10
#define FUTEX_PRIVATE_FLAG_ 128
#define FUTEX_CLOCK_REALTIME_ 256
#define FUTEX_CMD_MASK_ ~(FUTEX_PRIVATE_FLAG_ | FUTEX_CLOCK_REALTIME_)

// FUTEX_WAKE_OP val3 encoding (see Linux kernel futex.h)
#define FUTEX_OP_SET   0
#define FUTEX_OP_ADD   1
#define FUTEX_OP_OR    2
#define FUTEX_OP_ANDN  3
#define FUTEX_OP_XOR   4
#define FUTEX_OP_OPARG_SHIFT 8

#define FUTEX_OP_CMP_EQ 0
#define FUTEX_OP_CMP_NE 1
#define FUTEX_OP_CMP_LT 2
#define FUTEX_OP_CMP_LE 3
#define FUTEX_OP_CMP_GT 4
#define FUTEX_OP_CMP_GE 5

struct futex {
    atomic_uint refcount;
    struct mem *mem;
    addr_t addr;
    struct list queue;
    struct list chain; // locked by futex_hash_lock
};

struct futex_wait {
    cond_t cond;
    struct futex *futex; // will be changed by a requeue
    struct list queue;
    struct task *task;   // owning task (for per-thread futex_pipe wakeup)
};

#define FUTEX_HASH_BITS 12
#define FUTEX_HASH_SIZE (1 << FUTEX_HASH_BITS)
static lock_t futex_lock = LOCK_INITIALIZER;
static struct list futex_hash[FUTEX_HASH_SIZE];

static void __attribute__((constructor)) init_futex_hash() {
    for (int i = 0; i < FUTEX_HASH_SIZE; i++)
        list_init(&futex_hash[i]);
}

static struct futex *futex_get_unlocked(addr_t addr) {
    int hash = (addr ^ (unsigned long) current->mem) % FUTEX_HASH_SIZE;
    struct list *bucket = &futex_hash[hash];
    struct futex *futex;
    list_for_each_entry(bucket, futex, chain) {
        if (futex->addr == addr && futex->mem == current->mem) {
            futex->refcount++;
            return futex;
        }
    }

    futex = malloc(sizeof(struct futex));
    if (futex == NULL) {
        unlock(&futex_lock);
        return NULL;
    }
    futex->refcount = 1;
    futex->mem = current->mem;
    futex->addr = addr;
    list_init(&futex->queue);
    list_add(bucket, &futex->chain);
    return futex;
}

// Returns the futex for the current process at the given addr, and locks it
// Unlocked variant is available for times when you need to get two futexes at once
static struct futex *futex_get(addr_t addr) {
    lock(&futex_lock);
    struct futex *futex = futex_get_unlocked(addr);
    if (futex == NULL)
        unlock(&futex_lock);
    return futex;
}

static void futex_put_unlocked(struct futex *futex) {
    if (--futex->refcount == 0) {
        assert(list_empty(&futex->queue));
        list_remove(&futex->chain);
        free(futex);
    }
}

// Must be called on the result of futex_get when you're done with it
// Also has an unlocked version, for releasing the result of futex_get_unlocked
static void futex_put(struct futex *futex) {
    futex_put_unlocked(futex);
    unlock(&futex_lock);
}

static int futex_load(struct futex *futex, dword_t *out) {
    assert(futex->mem == current->mem);
    read_wrlock(&current->mem->lock);
    dword_t *ptr = mem_ptr(current->mem, futex->addr, MEM_READ);
    read_wrunlock(&current->mem->lock);
    if (ptr == NULL)
        return 1;
    *out = *ptr;
    return 0;
}

static int futex_wait(addr_t uaddr, dword_t val, struct timespec *timeout) {
    struct futex *futex = futex_get(uaddr);
    int err = 0;
    dword_t tmp;
    if (futex_load(futex, &tmp))
        err = _EFAULT;
    else if (tmp != val)
        err = _EAGAIN;
    else {
        // Lazily create per-thread futex pipe (reused across all futex_wait calls)
        if (current->futex_pipe[0] == -1) {
            if (pipe(current->futex_pipe) < 0) {
                futex_put(futex);
                return _ENOMEM;
            }
            fcntl(current->futex_pipe[0], F_SETFL, O_NONBLOCK);
            fcntl(current->futex_pipe[1], F_SETFL, O_NONBLOCK);
        }
        // Drain any stale bytes from previous wakeups
        { char buf[16]; while (read(current->futex_pipe[0], buf, sizeof(buf)) > 0) {} }

        struct futex_wait wait;
        wait.cond = COND_INITIALIZER;
        wait.futex = futex;
        wait.task = current;

        // Stay in queue so futex_wakelike can find us and write to our pipe
        list_add_tail(&futex->queue, &wait.queue);
        unlock(&futex_lock);

        // Calculate deadline for timed waits
        int64_t deadline_ns = 0; // 0 = infinite
        if (timeout) {
            struct timespec now;
            clock_gettime(CLOCK_MONOTONIC, &now);
            deadline_ns = (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec
                        + (int64_t)timeout->tv_sec * 1000000000LL + timeout->tv_nsec;
        }

        current->blocking = true;
        struct pollfd pfd = { .fd = current->futex_pipe[0], .events = POLLIN };
        for (;;) {
            // Compute poll timeout
            int poll_ms;
            if (deadline_ns) {
                struct timespec now;
                clock_gettime(CLOCK_MONOTONIC, &now);
                int64_t now_ns = (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec;
                int64_t remain_ms = (deadline_ns - now_ns) / 1000000LL;
                if (remain_ms <= 0) { err = _ETIMEDOUT; break; }
                poll_ms = remain_ms > 100 ? 100 : (int)remain_ms;
            } else {
                poll_ms = 100; // 100ms safety-net timeout for signal/stall checks
            }

            int ret = poll(&pfd, 1, poll_ms);
            if (ret > 0) {
                // Woken by pipe write — drain it
                char buf[16];
                while (read(current->futex_pipe[0], buf, sizeof(buf)) > 0) {}
                err = 0;
                break;
            }
            // ret == 0 (timeout) or ret < 0 (EINTR from signal) — check conditions

            if (current->group->doing_group_exit) {
                err = _EINTR; break;
            }
            if (current->sighand) {
                lock(&current->sighand->lock);
                bool sig_pending = !!(current->pending & ~current->blocked);
                unlock(&current->sighand->lock);
                if (sig_pending) { err = _EINTR; break; }
            }
            // Check value periodically (every ~100ms instead of every 10ms)
            read_wrlock(&current->mem->lock);
            dword_t *ptr = mem_ptr(current->mem, uaddr, MEM_READ);
            read_wrunlock(&current->mem->lock);
            if (ptr == NULL) { err = _EFAULT; break; }
            if (*ptr != val) { err = 0; break; }
        }
        current->blocking = false;

        // Remove from queue (pipe stays open for reuse)
        lock(&futex_lock);
        list_remove_safe(&wait.queue);
        futex_put_unlocked(wait.futex);
        unlock(&futex_lock);
        goto futex_wait_done;
    }
    futex_put(futex);
futex_wait_done:
    STRACE("%d end futex(FUTEX_WAIT)", current->pid);
    return err;
}

// Wake up to `max` waiters on the given futex. Caller must hold futex_lock.
static unsigned futex_wake_queue(struct futex *futex, dword_t max) {
    struct futex_wait *wait, *tmp;
    unsigned woken = 0;
    list_for_each_entry_safe(&futex->queue, wait, tmp, queue) {
        if (woken >= max)
            break;
        // Wake via per-thread pipe write — waiter is blocked on poll(futex_pipe[0])
        if (wait->task->futex_pipe[1] != -1) {
            char c = 1;
            write(wait->task->futex_pipe[1], &c, 1);
        }
        list_remove(&wait->queue);
        woken++;
    }
    return woken;
}

static int futex_wakelike(int op, addr_t uaddr, dword_t wake_max, dword_t requeue_max, addr_t requeue_addr) {
    struct futex *futex = futex_get(uaddr);

    unsigned woken = futex_wake_queue(futex, wake_max);

    if (op == FUTEX_REQUEUE_) {
        struct futex *futex2 = futex_get_unlocked(requeue_addr);
        struct futex_wait *wait, *tmp;
        unsigned requeued = 0;
        list_for_each_entry_safe(&futex->queue, wait, tmp, queue) {
            if (requeued >= requeue_max)
                break;
            // sketchy as hell
            list_remove(&wait->queue);
            list_add_tail(&futex2->queue, &wait->queue);
            assert(futex->refcount > 1); // should be true because this function keeps a reference
            futex->refcount--;
            futex2->refcount++;
            wait->futex = futex2;
            requeued++;
        }
        futex_put_unlocked(futex2);
        woken += requeued;
    }

    futex_put(futex);
    return woken;
}

int futex_wake(addr_t uaddr, dword_t wake_max) {
    return futex_wakelike(FUTEX_WAKE_, uaddr, wake_max, 0, 0);
}

// FUTEX_CMP_REQUEUE: like FUTEX_REQUEUE, but first atomically check *uaddr == expected.
// Returns total woken+requeued, or _EAGAIN on mismatch, or _EFAULT on bad addr.
static int futex_cmp_requeue(addr_t uaddr, dword_t wake_max, dword_t requeue_max,
                             addr_t requeue_addr, dword_t expected) {
    struct futex *futex = futex_get(uaddr);
    if (futex == NULL)
        return _ENOMEM;

    dword_t cur;
    if (futex_load(futex, &cur)) {
        futex_put(futex);
        return _EFAULT;
    }
    if (cur != expected) {
        futex_put(futex);
        return _EAGAIN;
    }

    unsigned woken = futex_wake_queue(futex, wake_max);

    struct futex *futex2 = futex_get_unlocked(requeue_addr);
    struct futex_wait *wait, *tmp;
    unsigned requeued = 0;
    list_for_each_entry_safe(&futex->queue, wait, tmp, queue) {
        if (requeued >= requeue_max)
            break;
        list_remove(&wait->queue);
        list_add_tail(&futex2->queue, &wait->queue);
        assert(futex->refcount > 1);
        futex->refcount--;
        futex2->refcount++;
        wait->futex = futex2;
        requeued++;
    }
    futex_put_unlocked(futex2);

    futex_put(futex);
    return woken + requeued;
}

// FUTEX_WAKE_OP: atomic RMW on *uaddr2, then wake up to val waiters on uaddr,
// and — if the old value of *uaddr2 satisfies the comparison — wake up to val2
// waiters on uaddr2. val3 encodes the op, oparg, cmp, and cmparg (see Linux).
static int futex_wake_op(addr_t uaddr, dword_t wake_max1, addr_t uaddr2,
                         dword_t wake_max2, dword_t val3) {
    int op_code = (val3 >> 28) & 0xf;
    int cmp_code = (val3 >> 24) & 0xf;
    // oparg/cmparg are 12-bit sign-extended.
    int32_t oparg  = (int32_t)((val3 << 8)) >> 20;  // bits [23:12] sign-extended
    int32_t cmparg = (int32_t)((val3 << 20)) >> 20; // bits [11:0] sign-extended

    bool shift = (op_code & FUTEX_OP_OPARG_SHIFT) != 0;
    op_code &= ~FUTEX_OP_OPARG_SHIFT;
    if (shift) {
        if (oparg < 0 || oparg > 31)
            return _EINVAL;
        oparg = 1 << oparg;
    }

    // Atomic RMW on *uaddr2.
    // We must hold mem->lock across mem_ptr+atomic op so the mapping can't vanish.
    read_wrlock(&current->mem->lock);
    uint32_t *ptr = mem_ptr(current->mem, uaddr2, MEM_WRITE);
    if (ptr == NULL) {
        read_wrunlock(&current->mem->lock);
        return _EFAULT;
    }
    uint32_t oldval;
    switch (op_code) {
        case FUTEX_OP_SET:
            oldval = __atomic_exchange_n(ptr, (uint32_t)oparg, __ATOMIC_SEQ_CST);
            break;
        case FUTEX_OP_ADD:
            oldval = __atomic_fetch_add(ptr, (uint32_t)oparg, __ATOMIC_SEQ_CST);
            break;
        case FUTEX_OP_OR:
            oldval = __atomic_fetch_or(ptr, (uint32_t)oparg, __ATOMIC_SEQ_CST);
            break;
        case FUTEX_OP_ANDN:
            oldval = __atomic_fetch_and(ptr, (uint32_t)~oparg, __ATOMIC_SEQ_CST);
            break;
        case FUTEX_OP_XOR:
            oldval = __atomic_fetch_xor(ptr, (uint32_t)oparg, __ATOMIC_SEQ_CST);
            break;
        default:
            read_wrunlock(&current->mem->lock);
            return _ENOSYS;
    }
    read_wrunlock(&current->mem->lock);

    int32_t sold = (int32_t)oldval;
    bool cmp_true;
    switch (cmp_code) {
        case FUTEX_OP_CMP_EQ: cmp_true = (sold == cmparg); break;
        case FUTEX_OP_CMP_NE: cmp_true = (sold != cmparg); break;
        case FUTEX_OP_CMP_LT: cmp_true = (sold <  cmparg); break;
        case FUTEX_OP_CMP_LE: cmp_true = (sold <= cmparg); break;
        case FUTEX_OP_CMP_GT: cmp_true = (sold >  cmparg); break;
        case FUTEX_OP_CMP_GE: cmp_true = (sold >= cmparg); break;
        default: return _ENOSYS;
    }

    // Wake waiters on both queues. Acquire both futexes under futex_lock.
    lock(&futex_lock);
    struct futex *f1 = futex_get_unlocked(uaddr);
    if (f1 == NULL) { unlock(&futex_lock); return _ENOMEM; }
    unsigned total = futex_wake_queue(f1, wake_max1);
    if (cmp_true) {
        struct futex *f2 = futex_get_unlocked(uaddr2);
        if (f2 != NULL) {
            total += futex_wake_queue(f2, wake_max2);
            futex_put_unlocked(f2);
        }
    }
    futex_put_unlocked(f1);
    unlock(&futex_lock);
    return total;
}

dword_t sys_futex(addr_t uaddr, dword_t op, dword_t val, addr_t timeout_or_val2, addr_t uaddr2, dword_t val3) {
    if (!(op & FUTEX_PRIVATE_FLAG_)) {
        STRACE("!FUTEX_PRIVATE ");
    }
    int cmd = op & FUTEX_CMD_MASK_;
    struct timespec timeout = {0};
    if ((cmd == FUTEX_WAIT_ || cmd == FUTEX_WAIT_BITSET_) && timeout_or_val2) {
        struct timespec_ timeout_;
        if (user_get(timeout_or_val2, timeout_))
            return _EFAULT;
        if (cmd == FUTEX_WAIT_BITSET_) {
            // FUTEX_WAIT_BITSET uses absolute CLOCK_REALTIME timeout;
            // convert to relative for our futex_wait implementation.
            struct timespec now;
            clock_gettime(CLOCK_REALTIME, &now);
            timeout.tv_sec = timeout_.sec - now.tv_sec;
            timeout.tv_nsec = timeout_.nsec - now.tv_nsec;
            if (timeout.tv_nsec < 0) {
                timeout.tv_sec--;
                timeout.tv_nsec += 1000000000;
            }
            if (timeout.tv_sec < 0) {
                timeout.tv_sec = 0;
                timeout.tv_nsec = 0;
            }
        } else {
            timeout.tv_sec = timeout_.sec;
            timeout.tv_nsec = timeout_.nsec;
        }
    }
    switch (cmd) {
        case FUTEX_WAIT_:
            STRACE("futex(FUTEX_WAIT, %#x, %d, 0x%x {%ds %dns}) = ...\n", uaddr, val, timeout_or_val2, timeout.tv_sec, timeout.tv_nsec);
            return futex_wait(uaddr, val, timeout_or_val2 ? &timeout : NULL);
        case FUTEX_WAIT_BITSET_:
            // FUTEX_WAIT_BITSET with MATCH_ANY (0xffffffff) is equivalent to FUTEX_WAIT.
            // We ignore the bitset mask (val3) and treat all bits as matching.
            STRACE("futex(FUTEX_WAIT_BITSET, %#x, %d, mask=%#x) = ...\n", uaddr, val, val3);
            return futex_wait(uaddr, val, timeout_or_val2 ? &timeout : NULL);
        case FUTEX_WAKE_:
            STRACE("futex(FUTEX_WAKE, %#x, %d)", uaddr, val);
            return futex_wakelike(FUTEX_WAKE_, uaddr, val, 0, 0);
        case FUTEX_WAKE_BITSET_:
            // FUTEX_WAKE_BITSET with MATCH_ANY is equivalent to FUTEX_WAKE.
            STRACE("futex(FUTEX_WAKE_BITSET, %#x, %d, mask=%#x)", uaddr, val, val3);
            return futex_wakelike(FUTEX_WAKE_, uaddr, val, 0, 0);
        case FUTEX_REQUEUE_:
            STRACE("futex(FUTEX_REQUEUE, %#x, %d, %#x)", uaddr, val, uaddr2);
            return futex_wakelike(FUTEX_REQUEUE_, uaddr, val, timeout_or_val2, uaddr2);
        case FUTEX_CMP_REQUEUE_:
            STRACE("futex(FUTEX_CMP_REQUEUE, %#x, %d, %#x, expected=%d)", uaddr, val, uaddr2, val3);
            return futex_cmp_requeue(uaddr, val, timeout_or_val2, uaddr2, val3);
        case FUTEX_WAKE_OP_:
            STRACE("futex(FUTEX_WAKE_OP, %#x, %d, %#x, %d, %#x)", uaddr, val, uaddr2, timeout_or_val2, val3);
            return futex_wake_op(uaddr, val, uaddr2, timeout_or_val2, val3);
    }
    STRACE("futex(%#x, %d, %d, timeout=%#x, %#x, %d) ", uaddr, op, val, timeout_or_val2, uaddr2, val3);
    // Loud diagnostic — these should be rare now that CMP_REQUEUE and WAKE_OP are implemented.
    // Returning _EINVAL instead of _ENOSYS lets most userspace libraries fall back to
    // FUTEX_WAKE/WAIT rather than treating it as "kernel too old" and aborting.
    printk("SYS_FUTEX: unsupported op=%d (cmd=%d) uaddr=%#x val=%d uaddr2=%#x val3=%#x pid=%d comm=%s\n",
           op, cmd, uaddr, val, uaddr2, val3, current->pid, current->comm);
    return _EINVAL;
}

struct robust_list_head_ {
    addr_t list;
    dword_t offset;
    addr_t list_op_pending;
};

int_t sys_set_robust_list(addr_t robust_list, dword_t len) {
    STRACE("set_robust_list(%#x, %d)", robust_list, len);
    if (len != sizeof(struct robust_list_head_))
        return _EINVAL;
    current->robust_list = robust_list;
    return 0;
}

int_t sys_get_robust_list(pid_t_ pid, addr_t robust_list_ptr, addr_t len_ptr) {
    STRACE("get_robust_list(%d, %#x, %#x)", pid, robust_list_ptr, len_ptr);

    lock(&pids_lock);
    struct task *task = pid_get_task(pid);
    unlock(&pids_lock);
    if (task != current)
        return _EPERM;

    if (user_put(robust_list_ptr, current->robust_list))
        return _EFAULT;
    if (user_put(len_ptr, (int[]) {sizeof(struct robust_list_head_)}))
        return _EFAULT;
    return 0;
}
