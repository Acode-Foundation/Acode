#ifndef KERNEL_ARCH_ARM64_SIGNAL_H
#define KERNEL_ARCH_ARM64_SIGNAL_H

#include "misc.h"

/*
 * ARM64 Signal Handling Structures
 *
 * These structures match the Linux kernel's arm64 signal frame layout.
 * See arch/arm64/include/uapi/asm/sigcontext.h in the Linux kernel.
 */

// ARM64 signal context (saved CPU state)
struct sigcontext_arm64 {
    uint64_t fault_address;
    // General purpose registers x0-x30
    uint64_t regs[31];
    // Stack pointer
    uint64_t sp;
    // Program counter
    uint64_t pc;
    // PSTATE (processor state)
    uint64_t pstate;
    // Padding for 16-byte alignment before extension area
    uint8_t __reserved[4096] __attribute__((aligned(16)));
};

// ARM64 ucontext structure
struct ucontext_arm64 {
    unsigned long uc_flags;
    struct ucontext_arm64 *uc_link;
    struct stack_t_ uc_stack;
    struct sigset_t_ uc_sigmask;
    // Padding for alignment
    uint8_t __pad[1024 / 8 - sizeof(struct sigset_t_)];
    // Must be 16-byte aligned
    struct sigcontext_arm64 uc_mcontext;
};

// ARM64 signal frame (pushed onto stack when signal is delivered)
struct rt_sigframe_arm64 {
    struct siginfo_ info;
    struct ucontext_arm64 uc;
    // FPSIMD context follows (optional, indicated by magic in __reserved)
};

// Magic values for the __reserved area (indicates what extra context is present)
#define FPSIMD_MAGIC   0x46508001
#define ESR_MAGIC      0x45535201
#define EXTRA_MAGIC    0x45585401
#define SVE_MAGIC      0x53564501

// FPSIMD context header
struct fpsimd_context {
    uint32_t magic;
    uint32_t size;
    uint32_t fpsr;
    uint32_t fpcr;
    // 32 x 128-bit vector registers
    __uint128_t vregs[32];
};

// Extra context header (for when __reserved isn't big enough)
struct extra_context {
    uint32_t magic;
    uint32_t size;
    uint64_t datap;  // Pointer to extra data
    uint32_t extra_size;
    uint32_t __reserved2[3];
};

// ESR (Exception Syndrome Register) context
struct esr_context {
    uint32_t magic;
    uint32_t size;
    uint64_t esr;
};

// Function to setup signal frame for ARM64
static inline int arm64_setup_sigframe(struct sigcontext_arm64 *ctx, struct cpu_state *cpu) {
#if defined(GUEST_ARM64)
    ctx->fault_address = cpu->segfault_addr;
    for (int i = 0; i < 31; i++) {
        ctx->regs[i] = cpu->regs[i];
    }
    ctx->sp = cpu->sp;
    ctx->pc = cpu->pc;
    ctx->pstate = arm64_get_nzcv(cpu);
    return 0;
#else
    (void)ctx;
    (void)cpu;
    return -1;
#endif
}

// Function to restore CPU state from signal frame
static inline int arm64_restore_sigframe(struct cpu_state *cpu, struct sigcontext_arm64 *ctx) {
#if defined(GUEST_ARM64)
    for (int i = 0; i < 31; i++) {
        cpu->regs[i] = ctx->regs[i];
    }
    cpu->sp = ctx->sp;
    cpu->pc = ctx->pc;
    arm64_set_nzcv(cpu, (uint32_t)ctx->pstate);
    return 0;
#else
    (void)ctx;
    (void)cpu;
    return -1;
#endif
}

#endif
