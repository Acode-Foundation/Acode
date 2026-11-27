/*
 * ARM64 Guest Entry/Exit Code
 *
 * This file contains the entry and exit points for transitioning between
 * the host (native) code and the emulated ARM64 guest code.
 *
 * Calling convention used by the ARM64 guest backend:
 *   fiber_enter(block, frame, tlb)
 *   - x0 = block (pointer to fiber_block)
 *   - x1 = frame (pointer to fiber_frame, contains cpu_state)
 *   - x2 = tlb
 *
 * Register assignments during gadget execution:
 *   _cpu (x1) = pointer to cpu_state within fiber_frame
 *   _tlb (x2) = pointer to tlb entries
 *   _pc (x28) = instruction pointer (gadget stream)
 *   _tmp (x0) = return value / scratch
 */

#include "gadgets.h"
#include "emu/interrupt.h"

.text

/*
 * fiber_enter - Enter the fiber (guest) execution context
 *
 * Arguments:
 *   x0 - Pointer to fiber_block
 *   x1 - Pointer to fiber_frame (contains cpu_state at offset 0)
 *   x2 - Pointer to tlb
 *
 * Returns (in x0):
 *   Interrupt number (reason for returning to caller)
 */
.global NAME(fiber_enter)
.type_compat fiber_enter,function
NAME(fiber_enter):
    // Save callee-saved registers
    stp x18, x19, [sp, #-0x80]!      // 0x80 to make room for original _cpu
    stp x20, x21, [sp, #0x10]
    stp x22, x23, [sp, #0x20]
    stp x24, x25, [sp, #0x30]
    stp x26, x27, [sp, #0x40]
    stp x28, x29, [sp, #0x50]
    str lr, [sp, #0x60]
    str x1, [sp, #0x70]              // Save original _cpu for verification

    // Save SP for crash recovery: signal handler restores SP to this value
    // so fiber_exit can correctly pop the callee-saved register frame.
    mov x8, sp
    str x8, [x1, #LOCAL_jit_exit_sp]

    // Setup gadget instruction pointer from block
    add _pc, x0, #FIBER_BLOCK_code

    // _cpu is already x1 (frame pointer, cpu_state is at offset 0)
    // _tlb needs to point to TLB_entries
    add _tlb, x2, #TLB_entries

    // Jump to first gadget (gret equivalent)
    gret

/*
 * fiber_ret_chain - Return from a block that wants to chain to another
 *
 * _pc contains either:
 *   - A fake_ip (bit 63 set): unchained, must return to main loop for dispatch
 *   - A block->code pointer (bit 63 clear): chained, can continue in JIT
 *
 * This is the hot path for block transitions. Staying in JIT avoids the
 * expensive fiber_exit → main loop → fiber_enter round-trip.
 */
.global fiber_ret_chain
fiber_ret_chain:
#ifdef DISABLE_BLOCK_CHAINING
    // Block chaining disabled — always return to main loop
    // Clear last_block so the C main loop doesn't patch fake_ip values
    // (patched values are host code pointers, not guest PCs)
    str xzr, [_cpu, #LOCAL_last_block]
    b fiber_ret
#else
    // Check bit 63: if set, it's a fake_ip (unchained) → return to main loop
    tbnz _pc, #63, fiber_ret
    // Check if we've been poked (timer interrupt pending)
    ldr x8, [_cpu, #CPU_poked_ptr]
    ldrb w8, [x8]
    cbnz w8, poke
    // Adjacent-block fast path: if the target block immediately follows the
    // source block in guest memory (target->addr == from->end_addr + 4) and
    // both are on the same 4 KB page, the TLB mapping for the page cannot
    // have changed since the source block was compiled (any mmap/munmap would
    // have invalidated both blocks). Skip the mem_changes check and go
    // directly to execution. This covers ~69 % of chained forward transitions.
    ldr x9, [_cpu, #LOCAL_last_block]        // x9 = from fiber_block*
    cbz x9, fiber_ret_chain_memcheck         // no prior block → full check
    ldr x10, [x9, #FIBER_BLOCK_end_addr]     // x10 = from->end_addr
    sub x11, _pc, #FIBER_BLOCK_code          // x11 = target fiber_block*
    ldr x12, [x11, #FIBER_BLOCK_addr]        // x12 = target->addr
    // Adjacent: target->addr == from->end_addr + 4
    sub x12, x12, x10
    cmp x12, #4
    b.ne fiber_ret_chain_memcheck
    // Same page: PAGE(from->end_addr) == PAGE(target->addr)
    ldr x12, [x11, #FIBER_BLOCK_addr]        // reload target->addr
    eor x10, x10, x12                        // XOR end_addr ^ target->addr
    lsr x10, x10, #12                        // non-zero iff different pages
    cbnz x10, fiber_ret_chain_memcheck
    // Adjacent same-page: safe to skip mem_changes, fall to execute
    b fiber_ret_chain_execute
fiber_ret_chain_memcheck:
    // Check if page table changed (mem_changes mismatch).
    // On macOS, munmap+mmap reuses host virtual addresses, so stale TLB entries
    // silently read/write wrong data (no SIGSEGV). Must return to main loop
    // for TLB flush when the page table has changed.
    ldr x8, [_tlb, #(-TLB_entries + 16)]   // tlb->mem_changes (unsigned, at offset 16)
    ldr x9, [_tlb, #-TLB_entries]           // tlb->mmu
    ldr x9, [x9, #16]                       // mmu->changes (uint64_t, at offset 16)
    cmp w8, w9                              // compare as 32-bit (mem_changes is unsigned)
    b.ne poke                               // if changed, return to main loop for flush
fiber_ret_chain_execute:
    // Optional block-stats probe for chained block-entry execution. This is
    // measurement-only and runs only when ISH_ARM64_BLOCK_STATS is enabled.
#if __APPLE__
    adrp x8, NAME(arm64_block_stats_enabled)@GOTPAGE
    ldr x8, [x8, NAME(arm64_block_stats_enabled)@GOTPAGEOFF]
    ldrb w8, [x8]
#else
    adrp x8, NAME(arm64_block_stats_enabled)
    ldrb w8, [x8, #:lo12:NAME(arm64_block_stats_enabled)]
#endif
    cbz w8, 1f
    save_c
    ldr x0, [_cpu, #LOCAL_last_block]
    mov x1, _pc
    bl NAME(arm64_block_stats_count_chained_entry)
    restore_c
1:
    // Record last_block for block chaining in main loop
    sub x8, _pc, #FIBER_BLOCK_code
    str x8, [_cpu, #LOCAL_last_block]
    // Continue executing in JIT — this is the fast path
    // Guard: check that the next gadget pointer is not null (stale/freed block)
    ldr x8, [_pc], #8
    cbz x8, chain_null_gadget
    br x8
#endif

chain_null_gadget:
    // Null gadget pointer detected in chained block — the block was likely
    // freed/jetsammed and its memory zeroed. Return to main loop safely.
    // _pc was already incremented past the null entry by the post-index load.
    // Recompute block pointer and load guest PC from block->addr.
    sub x8, _pc, #(FIBER_BLOCK_code + 8)  // undo post-increment to get block base
    ldr x9, [x8, #FIBER_BLOCK_addr]
    str x9, [_cpu, #CPU_pc]
    str xzr, [_cpu, #LOCAL_last_block]     // clear last_block to prevent further chaining
    mov w0, #INT_GPF
    b fiber_exit

poke:
    // Timer interrupt pending — load guest PC from block->addr and return
    ldr x8, [_pc, #(-FIBER_BLOCK_code + FIBER_BLOCK_addr)]
    str x8, [_cpu, #CPU_pc]
    sub x8, _pc, #FIBER_BLOCK_code
    str x8, [_cpu, #LOCAL_last_block]
    // fallthrough to fiber_ret

/*
 * fiber_ret - Return from fiber with INT_NONE
 */
.global fiber_ret
fiber_ret:
    mvn w0, wzr       // w0 = -1 (INT_NONE)
    // fallthrough to fiber_exit

/*
 * fiber_exit - Exit the fiber execution context
 *
 * Expected state:
 *   _tmp (x0) = interrupt number to return
 *   _cpu = pointer to cpu_state (already saved if needed)
 *
 * DEBUG: Store a marker value to help debug PC issues
 * We store the _pc value (from control flow gadgets) to LOCAL_value
 * so we can see what _pc was when we returned
 */
.global fiber_exit
fiber_exit:
    // Restore callee-saved registers
    ldr lr, [sp, #0x60]
    ldp x28, x29, [sp, #0x50]
    ldp x26, x27, [sp, #0x40]
    ldp x24, x25, [sp, #0x30]
    ldp x22, x23, [sp, #0x20]
    ldp x20, x21, [sp, #0x10]
    ldp x18, x19, [sp], #0x80       // 0x80 to match fiber_enter (includes saved _cpu)

    // x0 (_tmp) already contains return value
    ret

/*
 * handle_read_miss - Handle a TLB read miss
 * Returns: translated host address in x0 (0 = segfault)
 *
 * IMPORTANT: Save and restore callee-saved registers x19-x28 because
 * the C code we call might use them. Our gadget code uses these registers
 * to hold data across the TLB miss call.
 */
.global NAME(handle_read_miss)
NAME(handle_read_miss):
    // Save callee-saved registers that gadgets might be using
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    sub x0, _tlb, #TLB_entries   // pass tlb base, not tlb+entries
    mov x1, x7                    // guest address (64-bit) from _addr (x7)
    mov x2, #0                    // MEM_READ
    bl NAME(tlb_handle_miss)
    mov x20, x0                   // save result in a callee-saved register
    restore_c
    mov x0, x20                   // return result in x0

    // Restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    ret

/*
 * handle_write_miss - Handle a TLB write miss
 * Returns: translated host address in x0 (0 = segfault)
 *
 * IMPORTANT: Save and restore callee-saved registers x19-x28 because
 * the C code we call might use them. Our gadget code uses these registers
 * to hold data across the TLB miss call.
 */
.global NAME(handle_write_miss)
NAME(handle_write_miss):
    // Save callee-saved registers that gadgets might be using
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    // Store current JIT code stream pointer for watchpoint debugging
    str _pc, [_cpu, #LOCAL_value]
    save_c
    sub x0, _tlb, #TLB_entries   // pass tlb base, not tlb+entries
    mov x1, x7                    // guest address (64-bit) from _addr (x7)
    mov x2, #1                    // MEM_WRITE
    bl NAME(tlb_handle_miss)
    mov x20, x0                   // save result in a callee-saved register
    restore_c
    mov x0, x20                   // return result

    // Restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    ret

/*
 * crosspage_load - Handle a load that crosses a page boundary
 *
 * Entry: x19 = size in bytes, _addr (x7) = guest address
 * Exit: _addr (x7) points to LOCAL_value buffer with data loaded
 *
 * Calls __tlb_read_cross_page(tlb, addr, buf, size) to do the actual work.
 *
 * IMPORTANT: Save and restore callee-saved registers.
 */
.global NAME(crosspage_load)
NAME(crosspage_load):
    // Save callee-saved registers (x19 has size, save it first to temp)
    mov x8, x19                      // save size to temp
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    sub x0, _tlb, #TLB_entries       // x0 = tlb base
    add x2, _cpu, #LOCAL_value       // x2 = buffer for data
    mov x1, x7                        // x1 = guest address (64-bit)
    mov x3, x8                        // x3 = size (from temp)
    bl NAME(__tlb_read_cross_page)
    mov x20, x0                       // save result
    restore_c

    cbz x20, segfault_read_cp
    str x7, [_cpu, #LOCAL_value_addr] // save guest address (64-bit)
    add _addr, _cpu, #LOCAL_value    // _addr points to buffer

    // Restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    ret

segfault_read_cp:
    // Handle segfault for cross-page read
    // First restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    ldr x8, [_tlb, #(-TLB_entries+TLB_segfault_addr)]
    str x8, [_cpu, #CPU_segfault_addr]
    strb wzr, [_cpu, #CPU_segfault_was_write]
    ldr x8, [_cpu, #LOCAL_jit_saved_pc]
    str x8, [_cpu, #CPU_pc]
    mov w0, #INT_GPF
    b fiber_exit

/*
 * crosspage_store - Handle a store that crosses a page boundary
 *
 * Entry: x19 = size in bytes, _addr (x7) = LOCAL_value buffer
 * Exit: data from LOCAL_value written to guest memory
 *
 * Note: The guest address is in LOCAL_value_addr (saved earlier)
 *
 * IMPORTANT: Save and restore callee-saved registers.
 */
.global NAME(crosspage_store)
NAME(crosspage_store):
    // Save callee-saved registers (x19 has size, save it first to temp)
    mov x8, x19                      // save size to temp
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    sub x0, _tlb, #TLB_entries       // x0 = tlb base
    add x2, _cpu, #LOCAL_value       // x2 = buffer with data
    ldr x1, [_cpu, #LOCAL_value_addr] // x1 = guest address (64-bit, saved earlier)
    mov x3, x8                        // x3 = size (from temp)
    bl NAME(__tlb_write_cross_page)
    mov x20, x0
    restore_c

    cbz x20, segfault_write_cp

    // Restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    ret

segfault_write_cp:
    // Handle segfault for cross-page write
    // First restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    ldr x8, [_tlb, #(-TLB_entries+TLB_segfault_addr)]
    str x8, [_cpu, #CPU_segfault_addr]
    mov w9, #1
    strb w9, [_cpu, #CPU_segfault_was_write]
    ldr x8, [_cpu, #LOCAL_jit_saved_pc]
    str x8, [_cpu, #CPU_pc]
    mov w0, #INT_GPF
    b fiber_exit

/*
 * Debug gadget: record guest PC for crash diagnosis
 * Code stream: [gadget_set_pc addr][guest_pc (64-bit)]
 */
.gadget set_pc
    ldr x8, [_pc]
    str x8, [_cpu, #CPU_pc]
    add _pc, _pc, #8
    gret

/*
 * Record the precise guest PC to retry if a host SIGSEGV/SIGBUS is raised while
 * executing a faultable JIT memory access. This intentionally does not update
 * CPU_pc, because normal successful block execution should keep CPU_pc at the
 * block/branch dispatch PC.
 * Code stream: [gadget_set_jit_saved_pc addr][guest_pc (64-bit)]
 */
.gadget set_jit_saved_pc
    ldr x8, [_pc]
    str x8, [_cpu, #LOCAL_jit_saved_pc]
    add _pc, _pc, #8
    gret

/*
 * Gadgets for block termination
 */

// gadget_interrupt - Generate an interrupt and exit
// Code stream: [gadget_interrupt addr][interrupt type (32-bit)]
.gadget interrupt
    ldr w0, [_pc]          // Load interrupt type from code stream
    b fiber_exit

// gadget_exit - Exit the block and return to dispatcher
// Code stream: [gadget_exit addr][next IP (64-bit)]
.gadget exit
    ldr x8, [_pc]          // Load next IP from code stream (64-bit)
    str x8, [_cpu, #CPU_pc] // Store as guest PC
    mvn w0, wzr            // Return INT_NONE (-1)
    b fiber_exit

// Debug: trace gadget - calls C function to log registers at specific PCs
// Code stream: [gadget_trace addr][guest_pc (64-bit)]
.gadget trace
    ldr x8, [_pc]              // Load guest PC from stream
    str x8, [_cpu, #CPU_pc]    // Update guest PC for the trace function

    // Save callee-saved registers (gadgets use x19-x28)
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    mov x0, _cpu               // arg0: cpu_state pointer
    bl NAME(jit_trace_regs)
    restore_c

    // Restore callee-saved registers
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    add _pc, _pc, #8           // Skip past the 64-bit guest PC data
    gret

/*
 * gadget_check_highbits - Fast check for dirty bits 32-63 in guest registers
 *
 * All guest register values should fit in 32 bits in the current memory layout.
 * If any register has bits 32+ set, it indicates an emulation bug.
 *
 * Fast path (~35 cycles): OR together bits 32-63 of all 32 GP regs (x0-x30 + SP).
 * If all zero, skip ahead. No function call overhead.
 *
 * Slow path (detection only): Call jit_highbit_alert(cpu) to log the offender.
 *
 * Code stream: [gadget_check_highbits addr][guest_pc (64-bit)]
 */
.gadget check_highbits
    // Fast path: OR bits 32-63 of all guest registers
    // x0-x30 are at [_cpu + CPU_x0] through [_cpu + CPU_x0 + 30*8]
    // SP is at [_cpu + CPU_sp]
    // Load pairs and accumulate high bits via OR
    ldp x9, x10, [_cpu, #CPU_x0]          // x0, x1
    orr x9, x9, x10
    ldp x10, x11, [_cpu, #(CPU_x0 + 16)]  // x2, x3
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 32)]  // x4, x5
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 48)]  // x6, x7
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 64)]  // x8, x9
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 80)]  // x10, x11
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 96)]  // x12, x13
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 112)] // x14, x15
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 128)] // x16, x17
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 144)] // x18, x19
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 160)] // x20, x21
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 176)] // x22, x23
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 192)] // x24, x25
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 208)] // x26, x27
    orr x9, x9, x10
    orr x9, x9, x11
    ldp x10, x11, [_cpu, #(CPU_x0 + 224)] // x28, x29
    orr x9, x9, x10
    orr x9, x9, x11
    ldr x10, [_cpu, #(CPU_x0 + 240)]      // x30
    orr x9, x9, x10
    ldr x10, [_cpu, #CPU_sp]               // SP
    orr x9, x9, x10

    // Check if any bit 32+ is set
    lsr x9, x9, #32
    cbnz x9, check_highbits_alert

    // Fast path: no dirty bits, skip past the 64-bit guest PC data
    add _pc, _pc, #8
    gret

check_highbits_alert:
    // Slow path: save state and call C function
    ldr x8, [_pc]
    str x8, [_cpu, #CPU_pc]    // Set guest PC for the alert function

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    mov x0, _cpu
    bl NAME(jit_highbit_alert)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    add _pc, _pc, #8
    gret

// Convenience gadgets for specific interrupts
.gadget syscall
    mov w0, #INT_SYSCALL
    b fiber_exit

.gadget undefined
    mov w0, #INT_UNDEFINED
    b fiber_exit

/*
 * jit_crash_trampoline - Signal handler redirects PC here after JIT SIGSEGV
 *
 * The crash_handler has already:
 *   1. Written segfault_addr and segfault_was_write to cpu_state via _cpu (x1)
 *   2. Restored cpu->pc to the block start PC (from jit_saved_pc TLS)
 *   3. Restored SP from frame->jit_exit_sp so fiber_exit can pop correctly
 *   4. Set x0 to a crash marker value
 *
 * We just need to return INT_GPF to the dispatch loop via fiber_exit.
 */
.global NAME(jit_crash_trampoline)
NAME(jit_crash_trampoline):
    mov w0, #0x100           // INT_JIT_CRASH
    b fiber_exit
