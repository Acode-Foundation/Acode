#ifndef SIGNAL_H
#define SIGNAL_H

#include "misc.h"
#include "util/list.h"
#include "util/sync.h"
struct task;

typedef qword_t sigset_t_;

#define SIG_ERR_ -1
#define SIG_DFL_ 0
#define SIG_IGN_ 1

#define SA_SIGINFO_ 4
#define SA_ONSTACK_ 0x08000000
#define SA_RESTART_ 0x10000000
#define SA_NODEFER_ 0x40000000
#define SA_RESETHAND_ 0x80000000

struct sigaction_ {
    addr_t handler;
    dword_t flags;
    addr_t restorer;
    sigset_t_ mask;
} __attribute__((packed));

#define NUM_SIGS 64

#define	SIGHUP_    1
#define	SIGINT_    2
#define	SIGQUIT_   3
#define	SIGILL_    4
#define	SIGTRAP_   5
#define	SIGABRT_   6
#define	SIGIOT_    6
#define	SIGBUS_    7
#define	SIGFPE_    8
#define	SIGKILL_   9
#define	SIGUSR1_   10
#define	SIGSEGV_   11
#define	SIGUSR2_   12
#define	SIGPIPE_   13
#define	SIGALRM_   14
#define	SIGTERM_   15
#define	SIGSTKFLT_ 16
#define	SIGCHLD_   17
#define	SIGCONT_   18
#define	SIGSTOP_   19
#define	SIGTSTP_   20
#define	SIGTTIN_   21
#define	SIGTTOU_   22
#define	SIGURG_    23
#define	SIGXCPU_   24
#define	SIGXFSZ_   25
#define	SIGVTALRM_ 26
#define	SIGPROF_   27
#define	SIGWINCH_  28
#define	SIGIO_     29
#define	SIGPWR_    30
#define SIGSYS_    31

#define SI_USER_ 0
#define SI_TIMER_ -2
#define SI_TKILL_ -6
#define SI_KERNEL_ 128
#define TRAP_TRACE_ 2
#define SEGV_MAPERR_ 1
#define SEGV_ACCERR_ 2

union sigval_ {
    int_t sv_int;
    addr_t sv_ptr;
};

struct siginfo_ {
    int_t sig;
    int_t sig_errno;
    int_t code;
#if defined(GUEST_ARM64)
    // 64-bit Linux aligns the _sifields union to 8 bytes, so si_pid/si_uid
    // start at offset 16, not offset 12. Signal handlers in runtimes such as
    // JavaScriptCore inspect these fields for thread-directed signals.
    int_t _pad0;
#endif
    union {
        struct {
            pid_t_ pid;
            uid_t_ uid;
        } kill;
        struct {
            pid_t_ pid;
            uid_t_ uid;
            int_t status;
            clock_t_ utime;
            clock_t_ stime;
        } child;
        struct {
            addr_t addr;
        } fault;
        struct {
            addr_t addr;
            int_t syscall;
        } sigsys;
        struct {
            int_t timer;
            int_t overrun;
            union sigval_ value;
            int_t _private;
        } timer;
    };
};

// a reasonable default siginfo
static const struct siginfo_ SIGINFO_NIL = {
    .code = SI_KERNEL_,
};

struct sigqueue {
    struct list queue;
    struct siginfo_ info;
};

struct sigevent_ {
    union sigval_ value;  // offset 0, size 8
    int_t signo;          // offset 8, size 4
    int_t method;         // offset 12, size 4
#ifdef GUEST_ARM64
    // ARM64: struct sigevent is 64 bytes with additional fields
    // sigev_notify_function, sigev_notify_attributes, padding
    union {
        pid_t_ tid;       // for SIGEV_THREAD_ID
        char _pad[48];    // padding to reach 64 bytes total (8+4+4+48=64)
    };
#else
    pid_t_ tid;
#endif
};

// send a signal
// you better make sure the task isn't gonna get freed under me (pids_lock or current)
void send_signal(struct task *task, int sig, struct siginfo_ info);
// send a signal without regard for whether the signal is blocked or ignored
void deliver_signal(struct task *task, int sig, struct siginfo_ info);
// Force a synchronous fault, restoring default handling if blocked or ignored.
void force_signal(struct task *task, int sig, struct siginfo_ info);
// send a signal to current if it's not blocked or ignored, return whether that worked
// exists specifically for sending SIGTTIN/SIGTTOU
bool try_self_signal(int sig);
// send a signal to all processes in a group, could return ESRCH
int send_group_signal(dword_t pgid, int sig, struct siginfo_ info);
// check for and deliver pending signals on current
// must be called without pids_lock, current->group->lock, or current->sighand->lock
void receive_signals(void);
// set the signal mask, restore it to what it was before on the next receive_signals call
void sigmask_set_temp(sigset_t_ mask);

struct sighand {
    atomic_uint refcount;
    struct sigaction_ action[NUM_SIGS];
    lock_t lock;
};
struct sighand *sighand_new(void);
struct sighand *sighand_copy(struct sighand *sighand);
void sighand_release(struct sighand *sighand);

dword_t sys_rt_sigaction(dword_t signum, addr_t action_addr, addr_t oldaction_addr, dword_t sigset_size);
dword_t sys_sigaction(dword_t signum, addr_t action_addr, addr_t oldaction_addr);
int64_t sys_rt_sigreturn(void);
int64_t sys_sigreturn(void);

#define SIG_BLOCK_ 0
#define SIG_UNBLOCK_ 1
#define SIG_SETMASK_ 2
typedef uint64_t sigset_t_;
dword_t sys_rt_sigprocmask(dword_t how, addr_t set, addr_t oldset, dword_t size);
int_t sys_rt_sigpending(addr_t set_addr, dword_t size);

int sigset_size_valid(dword_t size);
int user_get_sigset(addr_t addr, dword_t size, sigset_t_ *out);
int user_put_sigset(addr_t addr, dword_t size, sigset_t_ set);

static inline sigset_t_ sig_mask(int sig) {
    assert(sig >= 1 && sig < NUM_SIGS);
    return 1l << (sig - 1);
}

static inline bool sigset_has(sigset_t_ set, int sig) {
    return !!(set & sig_mask(sig));
}
static inline void sigset_add(sigset_t_ *set, int sig) {
    *set |= sig_mask(sig);
}
static inline void sigset_del(sigset_t_ *set, int sig) {
    *set &= ~sig_mask(sig);
}

#if defined(GUEST_ARM64)
struct stack_t_ {
    uint64_t stack;    // ss_sp: 8 bytes on ARM64
    int32_t flags;     // ss_flags: 4 bytes
    uint32_t _pad;     // padding for alignment
    uint64_t size;     // ss_size: 8 bytes on ARM64
};
#define MINSIGSTKSZ_ 6144
#else
struct stack_t_ {
    addr_t stack;
    dword_t flags;
    dword_t size;
};
#define MINSIGSTKSZ_ 2048
#endif
#define SS_ONSTACK_ 1
#define SS_DISABLE_ 2
dword_t sys_sigaltstack(addr_t ss, addr_t old_ss);

int_t sys_rt_sigsuspend(addr_t mask_addr, uint_t size);
int_t sys_pause(void);
int_t sys_rt_sigtimedwait(addr_t set_addr, addr_t info_addr, addr_t timeout_addr, uint_t set_size);
int_t sys_signalfd4(int_t fd_no, addr_t mask_addr, size_t mask_size, int_t flags);

dword_t sys_kill(pid_t_ pid, dword_t sig);
dword_t sys_tkill(pid_t_ tid, dword_t sig);
dword_t sys_tgkill(pid_t_ tgid, pid_t_ tid, dword_t sig);

// signal frame structs. There's a good chance this should go in its own header file

// thanks kernel for giving me something to copy/paste
#if defined(GUEST_ARM64)
// ARM64 sigcontext matches Linux kernel (arch/arm64/include/uapi/asm/sigcontext.h)
#define FPSIMD_MAGIC 0x46508001
#define ESR_MAGIC    0x45535201

// FPSIMD context within the sigcontext extension area
struct fpsimd_context_ {
    uint32_t magic;
    uint32_t size;
    uint32_t fpsr;
    uint32_t fpcr;
    __uint128_t vregs[32];
};

struct sigcontext_ {
    uint64_t fault_address;  // This was missing!
    uint64_t regs[31];
    uint64_t sp;
    uint64_t pc;
    uint64_t pstate;
    // Extension area for FPSIMD/ESR/SVE records. Linux arm64 aligns this area
    // to 16 bytes, which also makes ucontext.uc_mcontext land at offset 176
    // for musl/glibc aarch64. HotSpot's signal handler relies on that ABI
    // layout for implicit null-check recovery.
    uint8_t __reserved[4096] __attribute__((aligned(16)));
};

struct ucontext_ {
    uint64_t flags;
    uint64_t link;
    struct stack_t_ stack;
    sigset_t_ sigmask;
    uint8_t __padding[128 - sizeof(sigset_t_)];  // Pad to fixed offset
    struct sigcontext_ mcontext;
};

struct sigframe_ {
    addr_t restorer;
    dword_t sig;
    struct sigcontext_ sc;
    dword_t extramask;
    char retcode[8];
};

struct rt_sigframe_ {
    addr_t restorer;
    int_t sig;
    addr_t pinfo;
    addr_t puc;
    union {
        struct siginfo_ info;
        char __pad[128];
    };
    struct ucontext_ uc;
    char retcode[8];
};
#else
struct sigcontext_ {
    word_t gs, __gsh;
    word_t fs, __fsh;
    word_t es, __esh;
    word_t ds, __dsh;
    dword_t di;
    dword_t si;
    dword_t bp;
    dword_t sp;
    dword_t bx;
    dword_t dx;
    dword_t cx;
    dword_t ax;
    dword_t trapno;
    dword_t err;
    dword_t ip;
    word_t cs, __csh;
    dword_t flags;
    dword_t sp_at_signal;
    word_t ss, __ssh;

    dword_t fpstate;
    dword_t oldmask;
    dword_t cr2;
};

struct ucontext_ {
    uint_t flags;
    uint_t link;
    struct stack_t_ stack;
    struct sigcontext_ mcontext;
    sigset_t_ sigmask;
} __attribute__((packed));

struct fpreg_ {
    word_t significand[4];
    word_t exponent;
};

struct fpxreg_ {
    word_t significand[4];
    word_t exponent;
    word_t padding[3];
};

struct xmmreg_ {
    uint32_t element[4];
};

struct fpstate_ {
    /* Regular FPU environment.  */
    dword_t cw;
    dword_t sw;
    dword_t tag;
    dword_t ipoff;
    dword_t cssel;
    dword_t dataoff;
    dword_t datasel;
    struct fpreg_ st[8];
    word_t status;
    word_t magic;

    /* FXSR FPU environment.  */
    dword_t _fxsr_env[6];
    dword_t mxcsr;
    dword_t reserved;
    struct fpxreg_ fxsr_st[8];
    struct xmmreg_ xmm[8];
    dword_t padding[56];
};

struct sigframe_ {
    addr_t restorer;
    dword_t sig;
    struct sigcontext_ sc;
    struct fpstate_ fpstate;
    dword_t extramask;
    char retcode[8];
};

struct rt_sigframe_ {
    addr_t restorer;
    int_t sig;
    addr_t pinfo;
    addr_t puc;
    union {
        struct siginfo_ info;
        char __pad[128];
    };
    struct ucontext_ uc;
    char retcode[8];
};
#endif

// On a 64-bit system with 32-bit emulation, the fpu state is stored in extra
// space at the end of the frame, not in the frame itself. We store the fpu
// state in the frame where it should be, and ptraceomatic will set this. If
// they are set we'll add some padding to the bottom to the frame to make
// everything align.
extern int xsave_extra;
extern int fxsave_extra;

#endif
