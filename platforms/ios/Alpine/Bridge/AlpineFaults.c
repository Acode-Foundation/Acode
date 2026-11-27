// Guest fault recovery from ios-linuxkit main.c; see Vendor/ios-linuxkit/LICENSE.md.
#include "AcodeAlpine.h"
#include <signal.h>
#include <stddef.h>
#include <unistd.h>
#include "kernel/task.h"
#include "asbestos/frame.h"
#include "platform/host_context_aarch64.h"

static struct sigaction previous_segv, previous_bus;
static void crash_handler(int sig, siginfo_t *info, void *ctx);

void alpine_install_fault_handlers(void) {
    struct sigaction action = {.sa_sigaction = crash_handler, .sa_flags = SA_SIGINFO};
    sigemptyset(&action.sa_mask);
    sigaction(SIGSEGV, &action, &previous_segv);
    sigaction(SIGBUS, &action, &previous_bus);
}

// Thread-local JIT recovery state (defined in asbestos.c)
extern __thread volatile sig_atomic_t in_jit;
extern __thread volatile uint64_t jit_saved_pc;

// Diagnostic: JIT crash info (defined in calls.c)
extern __thread volatile uint64_t jit_last_host_fault;
extern __thread volatile uint64_t jit_last_x7;
extern __thread volatile uint64_t jit_last_x10;
extern __thread volatile int jit_crash_count;
extern volatile bool g_trace_highbits;
extern volatile bool g_trace_faults;

int fakefs_bind_mount(const char *linux_path, const char *host_path, bool read_only);

// Assembly trampoline: returns INT_JIT_CRASH via fiber_exit (defined in entry.S)
extern void jit_crash_trampoline(void);

// Offsets needed by the async crash handler. Keep these derived from the C
// structs instead of hard-coding cpu-offsets.h values; the signal handler runs
// in C, and stale constants here corrupt JIT crash recovery when cpu_state or
// fiber_frame changes.
#define CRASH_CPU_pc offsetof(struct cpu_state, pc)
#define CRASH_CPU_segfault_addr offsetof(struct cpu_state, segfault_addr)
#define CRASH_CPU_segfault_was_write offsetof(struct cpu_state, segfault_was_write)
#define CRASH_LOCAL_jit_exit_sp offsetof(struct fiber_frame, jit_exit_sp)
#define CRASH_LOCAL_jit_saved_pc offsetof(struct fiber_frame, jit_saved_pc)

static void crash_handler(int sig, siginfo_t *info, void *ctx) {
#ifdef __aarch64__
    // If we're inside JIT code and got SIGSEGV/SIGBUS, recover by redirecting
    // execution to jit_crash_trampoline via ucontext PC manipulation.
    // This avoids the overhead of _setjmp on every block entry.
    if ((sig == SIGSEGV || sig == SIGBUS) && in_jit) {
        ucontext_t *uc = (ucontext_t *)ctx;

        // _cpu is in x1 — pointer to cpu_state within fiber_frame
        uint64_t cpu_ptr = host_ctx_aarch64_reg(uc, 1);

        // Reconstruct guest segfault_addr from registers.
        // x7 = _addr (host pointer = data_minus_addr + guest_addr)
        // x10 may hold data_minus_addr from TLB lookup (but only on TLB HIT path)
        uint64_t x7 = host_ctx_aarch64_reg(uc, 7);
        uint64_t x10 = host_ctx_aarch64_reg(uc, 10);
        uint64_t guest_addr = (x7 - x10) & 0xffffffffffffULL;

        // Store diagnostic info for handle_interrupt to read
        jit_last_host_fault = (uint64_t)info->si_addr;
        jit_last_x7 = x7;
        jit_last_x10 = x10;
        jit_crash_count++;

        // Determine read/write from the host signal ABI when available.
        int was_write = host_ctx_aarch64_fault_was_write(uc, info);

        // Write crash info directly to cpu_state via _cpu pointer
        *(uint64_t *)(cpu_ptr + CRASH_CPU_segfault_addr) = guest_addr;
        *(int *)(cpu_ptr + CRASH_CPU_segfault_was_write) = was_write;
        // Restore guest PC to the latest faultable guest instruction for
        // re-execution. This is usually more precise than the block-start TLS
        // fallback and avoids re-running earlier side effects in the block.
        uint64_t retry_pc = *(uint64_t *)(cpu_ptr + CRASH_LOCAL_jit_saved_pc);
        if (retry_pc == 0)
            retry_pc = (uint64_t)jit_saved_pc;
        *(uint64_t *)(cpu_ptr + CRASH_CPU_pc) = retry_pc;

        // Restore SP to the value saved by fiber_enter, so fiber_exit
        // can correctly pop the callee-saved register frame.
        uint64_t exit_sp = *(uint64_t *)(cpu_ptr + CRASH_LOCAL_jit_exit_sp);
        host_ctx_aarch64_set_sp(uc, exit_sp);

        // Redirect execution to crash trampoline (returns INT_JIT_CRASH)
        host_ctx_aarch64_set_pc(uc, (uint64_t)jit_crash_trampoline);

        // Unblock signal so it can fire again on next crash
        sigset_t unblock;
        sigemptyset(&unblock);
        sigaddset(&unblock, sig);
        sigprocmask(SIG_UNBLOCK, &unblock, NULL);

        // Signal handler returns; execution resumes at jit_crash_trampoline
        return;
    }
#endif

    // Faults outside the emulator retain the host application's signal behavior.
    struct sigaction previous = sig == SIGSEGV ? previous_segv : previous_bus;
    if (previous.sa_handler == SIG_IGN) return;
    if (previous.sa_handler == SIG_DFL) {
        sigaction(sig, &previous, NULL);
        raise(sig);
    } else if (previous.sa_flags & SA_SIGINFO) {
        previous.sa_sigaction(sig, info, ctx);
    } else {
        previous.sa_handler(sig);
    }
}
