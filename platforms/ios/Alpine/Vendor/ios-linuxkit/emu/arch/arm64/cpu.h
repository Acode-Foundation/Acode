#ifndef EMU_ARCH_ARM64_CPU_H
#define EMU_ARCH_ARM64_CPU_H

#include "misc.h"
#include "emu/mmu.h"

#ifdef __KERNEL__
#include <linux/stddef.h>
#else
#include <stddef.h>
#endif

// ARM64 NEON/FP register - 128-bit vector
union arm64_vreg {
    __uint128_t q;      // Full 128-bit quad-word
    uint64_t d[2];      // Two 64-bit double-words
    uint32_t s[4];      // Four 32-bit single-words
    uint16_t h[8];      // Eight 16-bit half-words
    uint8_t b[16];      // Sixteen 8-bit bytes
    float f32[4];       // Four single-precision floats
    double f64[2];      // Two double-precision floats
};
static_assert(sizeof(union arm64_vreg) == 16, "arm64_vreg size");

struct cpu_state {
    struct mmu *mmu;
    long cycle;

    // 31 general-purpose 64-bit registers (X0-X30)
    // X30 is the link register (LR)
    // Note: X31 reads as zero (ZR) or stack pointer (SP) depending on context
    union {
        struct {
            uint64_t x0, x1, x2, x3, x4, x5, x6, x7;
            uint64_t x8, x9, x10, x11, x12, x13, x14, x15;
            uint64_t x16, x17, x18, x19, x20, x21, x22, x23;
            uint64_t x24, x25, x26, x27, x28, x29, x30;
        };
        uint64_t regs[31];
    };

    // Stack pointer (separate from general registers)
    uint64_t sp;

    // Program counter
    uint64_t pc;

    // PSTATE (Process State) - condition flags
    // These are the NZCV flags from the CPSR
    // Stored as individual bytes to allow offsetof() to work
    uint8_t nf;  // Negative flag
    uint8_t zf;  // Zero flag
    uint8_t cf;  // Carry flag
    uint8_t vf;  // Overflow flag

    // Combined NZCV value for JIT use (bits 31:28 as in CPSR)
    // This must be kept in sync with nf/zf/cf/vf
    uint32_t nzcv;

    // NEON/FP: 32 x 128-bit vector registers (V0-V31)
    union arm64_vreg fp[32];

    // Floating-point Control Register
    uint32_t fpcr;

    // Floating-point Status Register
    uint32_t fpsr;

    // Thread Local Storage pointer (TPIDR_EL0)
    uint64_t tls_ptr;

    // Exclusive monitor for LDXR/STXR atomicity
    uint64_t excl_addr;   // Guest address from last LDXR (0xFFFFFFFF = invalid)
    uint64_t excl_val;    // Value loaded by last LDXR

    // For the page fault handler
    addr_t segfault_addr;
    bool segfault_was_write;

    dword_t trapno;

    // Access atomically
    bool *poked_ptr;
    bool _poked;

    // Exclusive monitor for LDXP/STXP pair atomicity.
    // Keep these after the crash-handler-sensitive fields above so the
    // hard-coded crash offsets used in main.c stay stable.
    uint64_t excl_pair_addr;
    uint64_t excl_pair_val_lo;
    uint64_t excl_pair_val_hi;
    uint32_t excl_pair_size;
};

#ifndef CPU_OFFSET
#define CPU_OFFSET(field) offsetof(struct cpu_state, field)
#endif

static_assert(CPU_OFFSET(x0) == CPU_OFFSET(regs[0]), "register order");
static_assert(CPU_OFFSET(x30) == CPU_OFFSET(regs[30]), "register order");
static_assert(sizeof(struct cpu_state) < 0xffff, "cpu struct is too big for vector gadgets");

// PSTATE flag helpers
#define ARM64_NF (cpu->nf)
#define ARM64_ZF (cpu->zf)
#define ARM64_CF (cpu->cf)
#define ARM64_VF (cpu->vf)

// PSTATE packed as NZCV (bits 31:28 in CPSR format)
static inline uint32_t arm64_get_nzcv(struct cpu_state *cpu) {
    return cpu->nzcv;
}

static inline void arm64_set_nzcv(struct cpu_state *cpu, uint32_t nzcv_val) {
    cpu->nzcv = nzcv_val;
    cpu->nf = (uint8_t)((nzcv_val >> 31) & 1);
    cpu->zf = (uint8_t)((nzcv_val >> 30) & 1);
    cpu->cf = (uint8_t)((nzcv_val >> 29) & 1);
    cpu->vf = (uint8_t)((nzcv_val >> 28) & 1);
}

// Sync individual flags to combined nzcv field
static inline void arm64_sync_nzcv(struct cpu_state *cpu) {
    cpu->nzcv = ((cpu->nf & 1) << 31) | ((cpu->zf & 1) << 30) |
                ((cpu->cf & 1) << 29) | ((cpu->vf & 1) << 28);
}

// Collapse flags (no-op for canonical ARM64 NZCV state)
static inline void collapse_flags(struct cpu_state *cpu) {
    // ARM64 flags are always in their canonical form
    (void)cpu;
}

// Expand flags (no-op for canonical ARM64 NZCV state)
static inline void expand_flags(struct cpu_state *cpu) {
    // ARM64 flags are always in their canonical form
    (void)cpu;
}

// Register indices
enum arm64_reg {
    reg_x0 = 0, reg_x1, reg_x2, reg_x3, reg_x4, reg_x5, reg_x6, reg_x7,
    reg_x8, reg_x9, reg_x10, reg_x11, reg_x12, reg_x13, reg_x14, reg_x15,
    reg_x16, reg_x17, reg_x18, reg_x19, reg_x20, reg_x21, reg_x22, reg_x23,
    reg_x24, reg_x25, reg_x26, reg_x27, reg_x28, reg_x29, reg_x30,
    reg_count,
    reg_lr = reg_x30,   // Link register
    reg_fp = reg_x29,   // Frame pointer
    reg_none = reg_count,
};

static inline const char *arm64_reg_name(enum arm64_reg reg) {
    static const char *names[] = {
        "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7",
        "x8", "x9", "x10", "x11", "x12", "x13", "x14", "x15",
        "x16", "x17", "x18", "x19", "x20", "x21", "x22", "x23",
        "x24", "x25", "x26", "x27", "x28", "x29", "x30"
    };
    if (reg < reg_count)
        return names[reg];
    return "?";
}

#endif
