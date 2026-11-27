#ifndef EMU_CPU_H
#define EMU_CPU_H

#include "misc.h"
#include "emu/mmu.h"

#ifdef __KERNEL__
#include <linux/stddef.h>
#else
#include <stddef.h>
#endif

// Include architecture-specific CPU state definition
#if !defined(GUEST_ARM64)
#error "Only the ARM64 guest backend is supported"
#endif
#include "emu/arch/arm64/cpu.h"

// Common CPU interface
struct cpu_state;
struct tlb;
int cpu_run_to_interrupt(struct cpu_state *cpu, struct tlb *tlb);
void cpu_poke(struct cpu_state *cpu);

#define CPU_OFFSET(field) offsetof(struct cpu_state, field)

#endif
