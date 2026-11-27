#include <time.h>
#include <stdio.h>
#include "emu/cpu.h"

// ARM64 doesn't have CPUID - this is a stub for compatibility
void helper_cpuid(dword_t *a, dword_t *b, dword_t *c, dword_t *d) {
    (void)a; (void)b; (void)c; (void)d;
}

// ARM64 counter register access
void helper_rdtsc(struct cpu_state *cpu) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    uint64_t tsc = now.tv_sec * 1000000000l + now.tv_nsec;
    cpu->regs[0] = tsc;
}

void helper_expand_flags(struct cpu_state *cpu) {
    expand_flags(cpu);
}

void helper_collapse_flags(struct cpu_state *cpu) {
    collapse_flags(cpu);
}
