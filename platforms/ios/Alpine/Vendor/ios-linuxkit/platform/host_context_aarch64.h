#ifndef HOST_CONTEXT_AARCH64_H
#define HOST_CONTEXT_AARCH64_H

#include <signal.h>
#include <stdint.h>
#include <ucontext.h>

#if defined(__linux__) && defined(__aarch64__)
#include <asm/sigcontext.h>
#endif

#if defined(__aarch64__)

static inline uint64_t host_ctx_aarch64_reg(const ucontext_t *uc, unsigned reg)
{
#if defined(__APPLE__)
    return uc->uc_mcontext->__ss.__x[reg];
#elif defined(__linux__)
    return uc->uc_mcontext.regs[reg];
#else
    (void)uc;
    (void)reg;
    return 0;
#endif
}

static inline uint64_t host_ctx_aarch64_pc(const ucontext_t *uc)
{
#if defined(__APPLE__)
    return uc->uc_mcontext->__ss.__pc;
#elif defined(__linux__)
    return uc->uc_mcontext.pc;
#else
    (void)uc;
    return 0;
#endif
}

static inline uint64_t host_ctx_aarch64_sp(const ucontext_t *uc)
{
#if defined(__APPLE__)
    return uc->uc_mcontext->__ss.__sp;
#elif defined(__linux__)
    return uc->uc_mcontext.sp;
#else
    (void)uc;
    return 0;
#endif
}

static inline uint64_t host_ctx_aarch64_lr(const ucontext_t *uc)
{
#if defined(__APPLE__)
    return uc->uc_mcontext->__ss.__lr;
#elif defined(__linux__)
    return uc->uc_mcontext.regs[30];
#else
    (void)uc;
    return 0;
#endif
}

static inline void host_ctx_aarch64_set_pc(ucontext_t *uc, uint64_t pc)
{
#if defined(__APPLE__)
    uc->uc_mcontext->__ss.__pc = pc;
#elif defined(__linux__)
    uc->uc_mcontext.pc = pc;
#else
    (void)uc;
    (void)pc;
#endif
}

static inline void host_ctx_aarch64_set_sp(ucontext_t *uc, uint64_t sp)
{
#if defined(__APPLE__)
    uc->uc_mcontext->__ss.__sp = sp;
#elif defined(__linux__)
    uc->uc_mcontext.sp = sp;
#else
    (void)uc;
    (void)sp;
#endif
}

static inline uint64_t host_ctx_aarch64_esr(const ucontext_t *uc)
{
#if defined(__APPLE__)
    return uc->uc_mcontext->__es.__esr;
#elif defined(__linux__)
    const char *ptr = (const char *)uc->uc_mcontext.__reserved;
    size_t remaining = sizeof(uc->uc_mcontext.__reserved);
    while (remaining >= sizeof(struct _aarch64_ctx)) {
        const struct _aarch64_ctx *head = (const struct _aarch64_ctx *)ptr;
        if (head->magic == 0 || head->size == 0)
            break;
        if (head->size < sizeof(struct _aarch64_ctx) || head->size > remaining)
            break;
        if (head->magic == ESR_MAGIC && head->size >= sizeof(struct esr_context))
            return ((const struct esr_context *)head)->esr;
        ptr += head->size;
        remaining -= head->size;
    }
    return 0;
#else
    (void)uc;
    return 0;
#endif
}

static inline int host_ctx_aarch64_fault_was_write(const ucontext_t *uc, const siginfo_t *info)
{
    const uint64_t esr = host_ctx_aarch64_esr(uc);
    if (esr)
        return (esr & 0x40) != 0;
    (void)info;
    return 0;
}

#endif /* __aarch64__ */

#endif /* HOST_CONTEXT_AARCH64_H */
