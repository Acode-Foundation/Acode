#include "asbestos/asbestos.h"
#include "asbestos/frame.h"
#include "emu/cpu.h"
#include "emu/tlb.h"

void cpu() {
    // ARM64 register offsets
    OFFSET(CPU, cpu_state, x0);
    OFFSET(CPU, cpu_state, x1);
    OFFSET(CPU, cpu_state, x2);
    OFFSET(CPU, cpu_state, x3);
    OFFSET(CPU, cpu_state, x4);
    OFFSET(CPU, cpu_state, x5);
    OFFSET(CPU, cpu_state, x6);
    OFFSET(CPU, cpu_state, x7);
    OFFSET(CPU, cpu_state, x8);
    OFFSET(CPU, cpu_state, x9);
    OFFSET(CPU, cpu_state, x10);
    OFFSET(CPU, cpu_state, x11);
    OFFSET(CPU, cpu_state, x12);
    OFFSET(CPU, cpu_state, x13);
    OFFSET(CPU, cpu_state, x14);
    OFFSET(CPU, cpu_state, x15);
    OFFSET(CPU, cpu_state, x16);
    OFFSET(CPU, cpu_state, x17);
    OFFSET(CPU, cpu_state, x18);
    OFFSET(CPU, cpu_state, x19);
    OFFSET(CPU, cpu_state, x20);
    OFFSET(CPU, cpu_state, x21);
    OFFSET(CPU, cpu_state, x22);
    OFFSET(CPU, cpu_state, x23);
    OFFSET(CPU, cpu_state, x24);
    OFFSET(CPU, cpu_state, x25);
    OFFSET(CPU, cpu_state, x26);
    OFFSET(CPU, cpu_state, x27);
    OFFSET(CPU, cpu_state, x28);
    OFFSET(CPU, cpu_state, x29);
    OFFSET(CPU, cpu_state, x30);
    OFFSET(CPU, cpu_state, sp);
    OFFSET(CPU, cpu_state, pc);
    OFFSET(CPU, cpu_state, tls_ptr);

    // ARM64 flags (NZCV)
    OFFSET(CPU, cpu_state, nf);
    OFFSET(CPU, cpu_state, zf);
    OFFSET(CPU, cpu_state, cf);
    OFFSET(CPU, cpu_state, vf);
    OFFSET(CPU, cpu_state, nzcv);

    // FP registers
    OFFSET(CPU, cpu_state, fp);
    OFFSET(CPU, cpu_state, fpcr);
    OFFSET(CPU, cpu_state, fpsr);

    // Exclusive monitor
    OFFSET(CPU, cpu_state, excl_addr);
    OFFSET(CPU, cpu_state, excl_val);
    OFFSET(CPU, cpu_state, excl_pair_addr);
    OFFSET(CPU, cpu_state, excl_pair_val_lo);
    OFFSET(CPU, cpu_state, excl_pair_val_hi);
    OFFSET(CPU, cpu_state, excl_pair_size);

    // Cycle counter (for timer interrupts in chained blocks)
    OFFSET(CPU, cpu_state, cycle);

    // Common offsets
    OFFSET(LOCAL, fiber_frame, bp);
    OFFSET(LOCAL, fiber_frame, value);
    OFFSET(LOCAL, fiber_frame, value_addr);
    OFFSET(LOCAL, fiber_frame, last_block);
    OFFSET(LOCAL, fiber_frame, jit_exit_sp);
    OFFSET(LOCAL, fiber_frame, jit_saved_pc);
    OFFSET(LOCAL, fiber_frame, ret_cache);
    OFFSET(CPU, cpu_state, segfault_addr);
    OFFSET(CPU, cpu_state, segfault_was_write);
    OFFSET(CPU, cpu_state, poked_ptr);
    OFFSET(CPU, cpu_state, cycle);
    MACRO(MEM_READ);
    MACRO(MEM_WRITE);

    OFFSET(FIBER_BLOCK, fiber_block, addr);
    OFFSET(FIBER_BLOCK, fiber_block, end_addr);
    OFFSET(FIBER_BLOCK, fiber_block, code);

    OFFSET(TLB, tlb, entries);
    OFFSET(TLB, tlb, mmu);
    OFFSET(TLB, tlb, dirty_page);
    OFFSET(TLB, tlb, segfault_addr);
    OFFSET(TLB, tlb, block_cache);      // inline indirect-branch target cache
    OFFSET(TLB, tlb, block_cache_gen);
    OFFSET(TLB_ENTRY, tlb_entry, page);
    OFFSET(TLB_ENTRY, tlb_entry, page_if_writable);
    OFFSET(TLB_ENTRY, tlb_entry, data_minus_addr);
#ifdef GUEST_ARM64
    OFFSET(TLB_ENTRY, tlb_entry, gen);
    OFFSET(MMU, mmu, changes);
#endif
}
