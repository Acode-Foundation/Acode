#include "../../gadgets-generic.h"
#include "cpu-offsets.h"

// === DEBUG ISOLATION SWITCHES ===
// Uncomment to disable specific JIT optimizations for debugging:
// #define DISABLE_RET_CACHE       1    // RET always returns to main loop
// #define DISABLE_BLOCK_CHAINING  1    // All branches return to main loop
// #define ENABLE_HIGHBIT_CHECK    1    // Check for dirty bits 32-63 after each insn
// #define ENABLE_WRITE_WATCHPOINT  1    // Check every store against watched page
// =================================

// Interrupt types (from emu/interrupt.h)
#define INT_NONE -1
#define INT_DIV 0
#define INT_DEBUG 1
#define INT_NMI 2
#define INT_BREAKPOINT 3
#define INT_OVERFLOW 4
#define INT_BOUND 5
#define INT_UNDEFINED 6
#define INT_FPU 7
#define INT_DOUBLE 8
#define INT_GPF 13
#define INT_TIMER 32
#define INT_SYSCALL 0x80

/*
 * ARM64-on-ARM64 Register Mapping
 *
 * When running ARM64 guest code on an ARM64 host, we can use a near-direct
 * mapping of registers. However, we still need to reserve some registers
 * for internal use:
 *
 * Host registers:
 *   x0-x7    - Scratch / function arguments
 *   x8       - Indirect result location (scratch for us)
 *   x9-x15   - Caller-saved temporaries
 *   x16-x17  - IP0/IP1, linker scratch
 *   x18      - Platform register (reserved on some platforms)
 *   x19-x28  - Callee-saved (we use these for guest state)
 *   x29      - Frame pointer
 *   x30      - Link register
 *   sp       - Stack pointer
 *
 * Guest register mapping:
 *   Since we need to preserve guest x0-x30 plus SP and PC, we use
 *   a combination of in-memory storage and cached hot registers.
 */

// CPU state pointer (always in x1 for ARM64 guest gadgets)
_cpu    .req x1
_tlb    .req x2

// Current instruction pointer (guest PC)
_pc     .req x28

// Temporary registers for gadget use
_tmp    .req x0
_tmp2   .req x8
_addr   .req x7    // Changed from x3/x4 to x7 to avoid conflict with guest low registers

// For compatibility, we use memory-based access for most guest registers
// Only a few hot registers are cached in host registers

.extern fiber_exit

.macro .gadget name
    .global NAME(gadget_\()\name)
    .align 4
    NAME(gadget_\()\name) :
.endm

.macro gret pop=0
.if \pop == 0
    ldr x8, [_pc], #8
.else
    ldr x8, [_pc, \pop*8]!
    add _pc, _pc, 8
.endif
    br x8
.endm

/*
 * Memory Access Helpers
 *
 * These macros handle TLB lookups and memory access for the guest.
 */
.irp type, read,write

.macro \type\()_prep size, id
#ifdef ENABLE_WRITE_WATCHPOINT
    .ifc \type,write
    // Write watchpoint: compare guest page against watched page
    // x7 = guest address at this point (before TLB translation)
    // g_watch_page_val is loaded from a nearby literal pool
    adrp x8, NAME(g_watch_page_val)@PAGE
    ldr x8, [x8, NAME(g_watch_page_val)@PAGEOFF]
    cbz x8, 9f                        // skip if no watchpoint set
    and x9, x7, #0xfffffffffffff000   // guest page
    cmp x9, x8
    b.eq watch_hit_\id
9:
    .endif
#endif
    // Cross-page check: if page offset > (0x1000 - access_size), need special handling
    and w8, w7, #0xfff
    cmp x8, #(0x1000-(\size/8))
    .ifc \type,read
        b.hi crosspage_load_\id
    .else
        b.hi crosspage_write_prep_\id
    .endif

    // Extract page-aligned address (48-bit address space, clear low 12 bits)
    and x8, x7, #0xfffffffffffff000
    .ifc \type,write
        str x8, [_tlb, #(-TLB_entries+TLB_dirty_page)]
    .endif

    // TLB index calculation: (addr >> 12) ^ (addr >> 26) masked to TLB_SIZE-1
    ubfx x9, x7, #12, #13       // (addr >> 12) & 0x1fff (TLB_BITS=13)
    eor x9, x9, x7, lsr #25    // XOR with (addr >> 25) = (addr >> (12+13))
    and w9, w9, #0x1fff          // mask to TLB_SIZE-1
    lsl x9, x9, #5
    add x9, x9, _tlb

    .ifc \type,read
        ldr x10, [x9, #TLB_ENTRY_page]
    .else
        ldr x10, [x9, #TLB_ENTRY_page_if_writable]
    .endif

    cmp x8, x10
    b.ne handle_miss_\id

    // Coherence check: this cached entry's host pointer is only valid while
    // mmu->changes still equals the generation captured when it was filled.
    // If another thread remapped the page (CoW/mmap/munmap) mmu->changes has
    // advanced and data_minus_addr points at the stale host backing — treat
    // it as a miss and re-translate. Fixes JSC reading a null methodTable /
    // stale Structure after a concurrent GC/allocator remap.
    ldr x10, [x9, #TLB_ENTRY_gen]
    ldr x8, [_tlb, #(-TLB_entries+TLB_mmu)]
    ldr x8, [x8, #MMU_changes]
    cmp x10, x8
    b.ne handle_miss_\id

    ldr x10, [x9, #TLB_ENTRY_data_minus_addr]

    // NOTE: segfault_addr is NOT stored here for performance.
    // On JIT crash (stale TLB SIGSEGV), crash_handler reconstructs
    // guest_addr = (x7 - x10) & 0xffffffffffff from ucontext registers.
    add x7, x10, x7                // host_addr = data_minus_addr + guest_addr
back_\id:
.endm

.macro \type\()_bullshit size, id
handle_miss_\id :
    bl NAME(handle_\type\()_miss)
    cbz x0, segfault_\type\()_\id
    mov _addr, x0
    b back_\id
segfault_\type\()_\id :
    ldr x8, [_tlb, #(-TLB_entries+TLB_segfault_addr)]
    str x8, [_cpu, #CPU_segfault_addr]
    .ifc \type,read
        strb wzr, [_cpu, #CPU_segfault_was_write]
    .else
        mov w9, #1
        strb w9, [_cpu, #CPU_segfault_was_write]
    .endif
    // Retry the faulting guest memory instruction, not the containing block
    // start. Earlier gadgets in the block may already have mutated registers.
    ldr x8, [_cpu, #LOCAL_jit_saved_pc]
    str x8, [_cpu, #CPU_pc]
    str _pc, [_cpu, #LOCAL_value]
    mov w0, #INT_GPF
    b fiber_exit
crosspage_load_\id :
    mov x19, #(\size/8)
    bl NAME(crosspage_load)
    b back_\id
.ifc \type,write
crosspage_write_prep_\id :
    str x7, [_cpu, #LOCAL_value_addr]
    add _addr, _cpu, #LOCAL_value
    b back_\id
crosspage_store_\id :
    mov x19, #(\size/8)
    bl NAME(crosspage_store)
    b back_write_done_\id
.endif
#ifdef ENABLE_WRITE_WATCHPOINT
.ifc \type,write
watch_hit_\id :
    // Write watchpoint hit: guest addr in x7 matches watched page
    // Save all state and call C handler
    // x24 = saved guest addr (set by caller before write_prep)
    // _pc = current position in code stream
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]
    save_c
    mov x0, _cpu               // arg0: cpu_state
    mov x1, x7                 // arg1: guest store address (still in x7)
    mov x2, _pc                // arg2: code stream pointer (for PC recovery)
    bl NAME(jit_watch_write_hit)
    restore_c
    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    // Fall through to the normal write_prep path (re-do the cross-page check)
    and w8, w7, #0xfff
    cmp x8, #(0x1000-(\size/8))
    b.hi crosspage_write_prep_\id
    and x8, x7, #0xfffffffffffff000
    str x8, [_tlb, #(-TLB_entries+TLB_dirty_page)]
    ubfx x9, x7, #12, #13
    eor x9, x9, x7, lsr #25
    and w9, w9, #0x1fff
    lsl x9, x9, #5
    add x9, x9, _tlb
    ldr x10, [x9, #TLB_ENTRY_page_if_writable]
    cmp x8, x10
    b.ne handle_miss_\id
    ldr x10, [x9, #TLB_ENTRY_data_minus_addr]
    add x7, x10, x7
    b back_\id
.endif
#endif
.endm

.endr

.macro write_done size, id
    add x8, _cpu, #LOCAL_value
    cmp x8, x7
    b.eq crosspage_store_\id
back_write_done_\id :
.endm

/*
 * Guest Register Access Macros
 *
 * For ARM64 guest, we access registers directly from the cpu_state structure.
 */
.macro load_guest_reg host_reg, guest_idx
    ldr \host_reg, [_cpu, #(CPU_x0 + \guest_idx * 8)]
.endm

.macro store_guest_reg host_reg, guest_idx
    str \host_reg, [_cpu, #(CPU_x0 + \guest_idx * 8)]
.endm

.macro load_guest_sp host_reg
    ldr \host_reg, [_cpu, #CPU_sp]
.endm

.macro store_guest_sp host_reg
    str \host_reg, [_cpu, #CPU_sp]
.endm

.macro load_guest_pc host_reg
    ldr \host_reg, [_cpu, #CPU_pc]
.endm

.macro store_guest_pc host_reg
    str \host_reg, [_cpu, #CPU_pc]
.endm

/*
 * Flag manipulation
 * Note: These must not use x8-x15 as they might be in use by calling code
 */
.macro load_flags
    ldr w17, [_cpu, #CPU_nzcv]
    msr nzcv, x17
.endm

.macro store_flags
    mrs x17, nzcv
    str w17, [_cpu, #CPU_nzcv]
.endm

/*
 * Context save/restore for calling C functions
 * Must save all caller-saved registers (x0-x18) + LR
 */
.macro save_c
    stp x0, x1, [sp, -0xa0]!
    stp x2, x3, [sp, 0x10]
    stp x4, x5, [sp, 0x20]
    stp x6, x7, [sp, 0x30]
    stp x8, x9, [sp, 0x40]
    stp x10, x11, [sp, 0x50]
    stp x12, x13, [sp, 0x60]
    stp x14, x15, [sp, 0x70]
    stp x16, x17, [sp, 0x80]
    stp x18, lr, [sp, 0x90]
.endm

.macro restore_c
    ldp x18, lr, [sp, 0x90]
    ldp x16, x17, [sp, 0x80]
    ldp x14, x15, [sp, 0x70]
    ldp x12, x13, [sp, 0x60]
    ldp x10, x11, [sp, 0x50]
    ldp x8, x9, [sp, 0x40]
    ldp x6, x7, [sp, 0x30]
    ldp x4, x5, [sp, 0x20]
    ldp x2, x3, [sp, 0x10]
    ldp x0, x1, [sp], 0xa0
.endm

# vim: ft=gas
