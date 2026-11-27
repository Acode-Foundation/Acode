/*
 * ARM64 Guest Control Flow Gadgets
 *
 * These gadgets handle branches, calls, and returns for ARM64 guest code.
 *
 * Block chaining works by storing a fake_ip (guest PC with bit 63 set) in the
 * code stream. When a block is chained, this value is replaced with a pointer
 * to the target block's code. The fiber_ret_chain routine checks bit 63 to
 * determine whether to continue executing gadgets or return to the main loop.
 */

#include "gadgets.h"
#include "emu/interrupt.h"

// External symbols from entry.S
.extern fiber_ret_chain
.extern fiber_ret
.extern fiber_exit

.text

/*
 * Macro: inline_chain reg
 * Inlines the fiber_ret_chain fast path for a chained block pointer in \reg.
 * Avoids the overhead of branching to fiber_ret_chain and its redundant tbnz check.
 *
 * \reg must contain either:
 *   - A chained block->code pointer (bit 63 clear)
 *   - A fake_ip (bit 63 set) — handled by branching to unchained label
 *
 * Uses labels: \@ generates unique labels via local label suffix.
 * CPU_pc is set from block->addr (not truncated pointer).
 */
.macro inline_chain reg, unchained_label
#ifdef DISABLE_BLOCK_CHAINING
    // Block chaining disabled — always go through main loop
    b \unchained_label
#else
    tbnz \reg, #63, \unchained_label
    // Chained fast path — poke check + periodic timer
    ldr x11, [\reg, #(-FIBER_BLOCK_code + FIBER_BLOCK_addr)]
    str x11, [_cpu, #CPU_pc]
    // Increment cycle counter; exit to main loop every 1024 cycles for timer check
    ldr w8, [_cpu, #CPU_cycle]
    add w8, w8, #1
    str w8, [_cpu, #CPU_cycle]
    tst w8, #0x3ff
    b.eq 7778f
    // Check poke flag
    ldr x8, [_cpu, #CPU_poked_ptr]
    ldrb w8, [x8]
    cbnz w8, 7778f
    sub x8, \reg, #FIBER_BLOCK_code
    str x8, [_cpu, #LOCAL_last_block]
    mov _pc, \reg
    gret
7778:   // poke or timer — exit to main loop
    mov _pc, \reg
    b fiber_ret
#endif
.endm

/*
 * Internal continue for future true-superblock segments.
 * Code stream: [gadget addr][guest_pc (64-bit)][internal_code_ptr (64-bit)]
 *
 * This is deliberately not a normal chained pointer path: the continuation
 * pointer is consumed only by this gadget, is never stored in jump_ip, and is
 * never passed to fiber_ret_chain. The generator should store an offset while
 * the block is reallocatable and patch this operand to a final code pointer in
 * gen_end.
 */
.gadget internal_continue
    ldr x8, [_pc], #8       // guest PC for observability/timer exits
    ldr x9, [_pc]           // internal continuation code-stream pointer
    str x8, [_cpu, #CPU_pc]
    mov _pc, x9
    gret

/*
 * Unconditional branch (B)
 * Code stream: [gadget addr][fake_target (64-bit)]
 *
 * The target is stored as (guest_pc | (1<<63)) initially.
 * When chained, it becomes a pointer to the target block's code.
 */
.gadget branch
    // Load the target (either fake_ip or block->code pointer)
    ldr x9, [_pc]
    inline_chain x9, 1f
1:  // Unchained: guest PC is low 32 bits of fake_ip
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * Branch with link (BL)
 * Code stream: [gadget addr][block_self_ptr][return_addr][fake_return_cont][fake_target]
 *
 * _pc layout after gret:
 *   _pc[0] = block self-pointer (for RET to set last_block)
 *   _pc[1] = return address (next instruction after BL)
 *   _pc[2] = return continuation (fake_ip or chained return-site block->code)
 *   _pc[3] = call target (fake_ip or chained callee block->code)
 *
 * ret_cache stores _pc so RET can find all fields.
 */
.gadget branch_link
    // Load return address from _pc[1]
    ldr x8, [_pc, #8]
    // Save return address to X30
    str x8, [_cpu, #(CPU_x0 + 30*8)]
#ifndef DISABLE_RET_CACHE
    // Store _pc in ret_cache keyed by return address
    ubfx w12, w8, #4, #12
    add x13, _cpu, #LOCAL_ret_cache
    str _pc, [x13, x12, lsl #3]
#endif
    // Load call target from _pc[3]
    ldr x9, [_pc, #24]
    inline_chain x9, 1f
1:  // Unchained: guest PC is low 32 bits of fake_ip
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * Branch to register (BR)
 * Code stream: [gadget addr][rn (64-bit)]
 *
 * Indirect branch - always returns to main loop since we don't know the target.
 */
.gadget branch_reg
    ldr x8, [_pc]           // rn
    and x8, x8, #0x1f
    add x9, _cpu, #CPU_x0
    ldr x10, [x9, x8, lsl #3]

    // Store guest PC (full 48-bit address)
    str x10, [_cpu, #CPU_pc]
    // Indirect branch: always return to main loop
    b fiber_ret

/*
 * Branch to register with link (BLR)
 * Code stream: [gadget addr][rn (64-bit)][return addr (64-bit)]
 */
.gadget branch_link_reg
    ldr x8, [_pc]           // rn
    add _pc, _pc, #8
    ldr x11, [_pc]          // return address

    and x8, x8, #0x1f
    add x9, _cpu, #CPU_x0
    ldr x10, [x9, x8, lsl #3]

    // Save return address to X30
    str x11, [_cpu, #(CPU_x0 + 30*8)]

    // Store guest PC (full 48-bit address)
    str x10, [_cpu, #CPU_pc]
    // Indirect branch: always return to main loop
    b fiber_ret

/*
 * Return (RET)
 * Code stream: [gadget addr][rn (64-bit, usually 30)]
 *
 * Uses return address cache to stay in JIT when possible.
 * BL stores _pc in ret_cache, where:
 *   _pc[0] = block_self_ptr  (BL's block, for last_block when unchained)
 *   _pc[1] = return_addr     (for validation)
 *   _pc[2] = return_cont     (return-site block->code or fake_ip)
 */
.gadget ret
    ldr x8, [_pc]           // rn
    and x8, x8, #0x1f
    add x9, _cpu, #CPU_x0
    ldr x10, [x9, x8, lsl #3]   // x10 = return address (guest PC)
    // Always set CPU_pc first (full 48-bit address)
    str x10, [_cpu, #CPU_pc]
#ifndef DISABLE_RET_CACHE
    // Look up return address in ret_cache
    ubfx w12, w10, #4, #12
    add x13, _cpu, #LOCAL_ret_cache
    ldr x14, [x13, x12, lsl #3]  // x14 = saved _pc from BL
    // Cache miss?
    cbz x14, ret_no_cache
    // Validate: saved return_addr must match actual return address
    ldr x9, [x14, #8]            // x14[1] = return_addr
    cmp x10, x9
    b.ne ret_no_cache
    // Cache hit — load return continuation
    ldr _pc, [x14, #16]          // x14[2] = return_cont (block->code or fake_ip)
    // Check if return_cont is chained (bit 63 clear = valid block->code)
    tbnz _pc, #63, ret_unchained
    // Chained cache hit — continue immediately (no poke check)
    // Poke will be caught at the next branch via inline_chain
    sub x8, _pc, #FIBER_BLOCK_code
    str x8, [_cpu, #LOCAL_last_block]
    gret
ret_unchained:
    // Return continuation not yet chained — set last_block to BL's block
    // so main loop can patch the return_cont on next dispatch
    ldr x8, [x14]                // x14[0] = block_self_ptr
    str x8, [_cpu, #LOCAL_last_block]
    b fiber_ret
ret_no_cache:
#endif
    b fiber_ret

/*
 * Compare and branch if zero (CBZ)
 * Code stream: [gadget addr][rt | sf<<8 (64-bit)][fake_target (64-bit)][fake_fallthrough (64-bit)]
 */
.gadget cbz
    ldr x8, [_pc]           // rt | sf<<8
    add _pc, _pc, #8
    ldr x9, [_pc]           // target (fake_ip or chained)
    add _pc, _pc, #8
    ldr x10, [_pc]          // fallthrough (fake_ip or chained)

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #1    // sf

    // Load register value
    add x13, _cpu, #CPU_x0
    cmp x11, #31
    b.eq 1f
    ldr x14, [x13, x11, lsl #3]
    b 2f
1:  mov x14, #0
2:
    // For 32-bit, only check low 32 bits
    cbz x12, 3f
    b 4f
3:  and x14, x14, #0xffffffff
4:
    // Check if zero and select target
    cbz x14, cbz_taken
    // Not zero - use fallthrough (x10)
    inline_chain x10, cbz_nt_unchained
cbz_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbz_taken:
    // Zero - use target (x9)
    inline_chain x9, cbz_t_unchained
cbz_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * Compare and branch if not zero (CBNZ)
 * Code stream: [gadget addr][rt | sf<<8 (64-bit)][fake_target (64-bit)][fake_fallthrough (64-bit)]
 */
.gadget cbnz
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]           // target
    add _pc, _pc, #8
    ldr x10, [_pc]          // fallthrough

    and x11, x8, #0x1f
    ubfx x12, x8, #8, #1

    add x13, _cpu, #CPU_x0
    cmp x11, #31
    b.eq 1f
    ldr x14, [x13, x11, lsl #3]
    b 2f
1:  mov x14, #0
2:
    cbz x12, 3f
    b 4f
3:  and x14, x14, #0xffffffff
4:
    cbnz x14, cbnz_taken
    // Zero - use fallthrough (x10)
    inline_chain x10, cbnz_nt_unchained
cbnz_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbnz_taken:
    // Not zero - use target (x9)
    inline_chain x9, cbnz_t_unchained
cbnz_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * Specialized CBZ/CBNZ gadgets (rt!=31, sf known at compile time)
 *
 * Saves ~8 instructions vs generic by eliminating XZR check and sf check.
 * Code stream: [gadget addr][rt (64-bit)][fake_target (64-bit)][fake_fallthrough (64-bit)]
 * gen.c emits these when rt!=31, falls back to generic gadget_cbz/gadget_cbnz for rt==31.
 */

// CBZ Xt, target (64-bit, rt!=31)
.gadget cbz_64
    ldr x8, [_pc]              // rt
    add _pc, _pc, #8
    ldr x9, [_pc]              // target
    add _pc, _pc, #8
    ldr x10, [_pc]             // fallthrough
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x8, lsl #3] // load 64-bit register value
    cbz x14, cbz_64_taken
    inline_chain x10, cbz_64_nt_unchained
cbz_64_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbz_64_taken:
    inline_chain x9, cbz_64_t_unchained
cbz_64_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

// CBZ Wt, target (32-bit, rt!=31)
.gadget cbz_32
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8
    ldr x10, [_pc]
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x8, lsl #3] // load 64-bit, check only low 32
    cbz w14, cbz_32_taken       // w14 tests only lower 32 bits
    inline_chain x10, cbz_32_nt_unchained
cbz_32_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbz_32_taken:
    inline_chain x9, cbz_32_t_unchained
cbz_32_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

// CBNZ Xt, target (64-bit, rt!=31)
.gadget cbnz_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8
    ldr x10, [_pc]
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x8, lsl #3]
    cbnz x14, cbnz_64_taken
    inline_chain x10, cbnz_64_nt_unchained
cbnz_64_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbnz_64_taken:
    inline_chain x9, cbnz_64_t_unchained
cbnz_64_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

// CBNZ Wt, target (32-bit, rt!=31)
.gadget cbnz_32
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8
    ldr x10, [_pc]
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x8, lsl #3]
    cbnz w14, cbnz_32_taken
    inline_chain x10, cbnz_32_nt_unchained
cbnz_32_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbnz_32_taken:
    inline_chain x9, cbnz_32_t_unchained
cbnz_32_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * CBZ/CBNZ with external taken edge and internal fallthrough edge.
 * Code stream: [gadget addr][rt | sf<<8 | is_cbnz<<9]
 *              [fake_target][internal_continue_ptr]
 *
 * The taken edge uses the normal external fake-IP/block->code chain path.
 * The not-taken edge jumps to a private internal-continue record and never
 * passes the interior pointer to fiber_ret_chain.
 */
.gadget cbz_fallthrough_internal
    ldr x8, [_pc], #8       // rt | sf<<8 | is_cbnz<<9
    ldr x9, [_pc], #8       // taken target (fake_ip or chained)
    ldr x10, [_pc]          // internal_continue record pointer

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #1    // sf
    ubfx x13, x8, #9, #1    // is_cbnz
    add x14, _cpu, #CPU_x0
    cmp x11, #31
    b.eq cbz_fi_xzr
    ldr x15, [x14, x11, lsl #3]
    b cbz_fi_test
cbz_fi_xzr:
    mov x15, #0
cbz_fi_test:
    cbnz x12, cbz_fi_test64
    cmp w15, #0
    b cbz_fi_select
cbz_fi_test64:
    cmp x15, #0
cbz_fi_select:
    cset w16, ne            // nonzero = 1, zero = 0
    cmp w16, w13            // CBNZ takes when nonzero; CBZ takes when zero
    b.eq cbz_fi_taken
cbz_fi_not_taken:
    mov _pc, x10
    gret
cbz_fi_taken:
    inline_chain x9, cbz_fi_taken_unchained
cbz_fi_taken_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * CBZ/CBNZ with internal taken edge and external fallthrough edge.
 * Code stream: [gadget addr][rt | sf<<8 | is_cbnz<<9]
 *              [internal_continue_ptr][fake_fallthrough]
 *
 * The taken edge jumps to a private internal-continue record and never passes
 * the interior pointer to fiber_ret_chain. The not-taken edge uses the normal
 * external fake-IP/block->code chain path.
 */
.gadget cbz_taken_internal
    ldr x8, [_pc], #8       // rt | sf<<8 | is_cbnz<<9
    ldr x9, [_pc], #8       // internal_continue record pointer
    ldr x10, [_pc]          // fallthrough target (fake_ip or chained)

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #1    // sf
    ubfx x13, x8, #9, #1    // is_cbnz
    add x14, _cpu, #CPU_x0
    cmp x11, #31
    b.eq cbz_ti_xzr
    ldr x15, [x14, x11, lsl #3]
    b cbz_ti_test
cbz_ti_xzr:
    mov x15, #0
cbz_ti_test:
    cbnz x12, cbz_ti_test64
    cmp w15, #0
    b cbz_ti_select
cbz_ti_test64:
    cmp x15, #0
cbz_ti_select:
    cset w16, ne            // nonzero = 1, zero = 0
    cmp w16, w13            // CBNZ takes when nonzero; CBZ takes when zero
    b.eq cbz_ti_taken
cbz_ti_not_taken:
    inline_chain x10, cbz_ti_not_taken_unchained
cbz_ti_not_taken_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
cbz_ti_taken:
    mov _pc, x9
    gret

/*
 * Fused ADD/SUB immediate + CBZ/CBNZ of the result.
 * Code stream: [gadget addr][rd | rn<<8 | imm12<<16 | op<<28 | sf<<29 | test_sf<<30]
 *              [fake_target][fake_fallthrough]
 * op=0 ADD, op=1 SUB. sf is the ADD/SUB width; test_sf is the CBZ/CBNZ width.
 */
.gadget fused_addsub_cbz
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8
    ldr x10, [_pc]
    and x12, x8, #0x1f           // rd
    ubfx x13, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x13, lsl #3]
    tbnz x8, #29, fused_addsub_cbz_64
    tbnz x8, #28, fused_addsub_cbz_sub32
    add w16, w15, w11
    b fused_addsub_cbz_store
fused_addsub_cbz_sub32:
    sub w16, w15, w11
    b fused_addsub_cbz_store
fused_addsub_cbz_64:
    tbnz x8, #28, fused_addsub_cbz_sub64
    add x16, x15, x11
    b fused_addsub_cbz_store
fused_addsub_cbz_sub64:
    sub x16, x15, x11
fused_addsub_cbz_store:
    str x16, [x14, x12, lsl #3]
    tbnz x8, #30, fused_addsub_cbz_test64
    cbz w16, fused_addsub_cbz_taken
    b fused_addsub_cbz_not_taken
fused_addsub_cbz_test64:
    cbz x16, fused_addsub_cbz_taken
fused_addsub_cbz_not_taken:
    inline_chain x10, fused_addsub_cbz_nt_unchained
fused_addsub_cbz_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
fused_addsub_cbz_taken:
    inline_chain x9, fused_addsub_cbz_t_unchained
fused_addsub_cbz_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

.gadget fused_addsub_cbnz
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8
    ldr x10, [_pc]
    and x12, x8, #0x1f
    ubfx x13, x8, #8, #5
    ubfx x11, x8, #16, #12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x13, lsl #3]
    tbnz x8, #29, fused_addsub_cbnz_64
    tbnz x8, #28, fused_addsub_cbnz_sub32
    add w16, w15, w11
    b fused_addsub_cbnz_store
fused_addsub_cbnz_sub32:
    sub w16, w15, w11
    b fused_addsub_cbnz_store
fused_addsub_cbnz_64:
    tbnz x8, #28, fused_addsub_cbnz_sub64
    add x16, x15, x11
    b fused_addsub_cbnz_store
fused_addsub_cbnz_sub64:
    sub x16, x15, x11
fused_addsub_cbnz_store:
    str x16, [x14, x12, lsl #3]
    tbnz x8, #30, fused_addsub_cbnz_test64
    cbnz w16, fused_addsub_cbnz_taken
    b fused_addsub_cbnz_not_taken
fused_addsub_cbnz_test64:
    cbnz x16, fused_addsub_cbnz_taken
fused_addsub_cbnz_not_taken:
    inline_chain x10, fused_addsub_cbnz_nt_unchained
fused_addsub_cbnz_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
fused_addsub_cbnz_taken:
    inline_chain x9, fused_addsub_cbnz_t_unchained
fused_addsub_cbnz_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * Conditional branch (B.cond)
 * Code stream: [gadget addr][cond (64-bit)][fake_target (64-bit)][fake_fallthrough (64-bit)]
 *
 * Condition codes (cond field):
 *   0000 (0)  EQ - Equal (Z==1)
 *   0001 (1)  NE - Not equal (Z==0)
 *   0010 (2)  CS/HS - Carry set / Unsigned higher or same (C==1)
 *   0011 (3)  CC/LO - Carry clear / Unsigned lower (C==0)
 *   0100 (4)  MI - Minus / Negative (N==1)
 *   0101 (5)  PL - Plus / Positive or zero (N==0)
 *   0110 (6)  VS - Overflow set (V==1)
 *   0111 (7)  VC - Overflow clear (V==0)
 *   1000 (8)  HI - Unsigned higher (C==1 && Z==0)
 *   1001 (9)  LS - Unsigned lower or same (C==0 || Z==1)
 *   1010 (10) GE - Signed greater or equal (N==V)
 *   1011 (11) LT - Signed less than (N!=V)
 *   1100 (12) GT - Signed greater than (Z==0 && N==V)
 *   1101 (13) LE - Signed less than or equal (Z==1 || N!=V)
 *   1110 (14) AL - Always (unconditional)
 *   1111 (15) NV - (reserved, treated as AL)
 */
.gadget bcond
    ldr x8, [_pc]           // cond
    add _pc, _pc, #8
    ldr x9, [_pc]           // target (fake_ip or chained)
    add _pc, _pc, #8
    ldr x10, [_pc]          // fallthrough (fake_ip or chained)

    // Extract condition code BEFORE loading flags
    and x8, x8, #0xf
    adr x11, bcond_table
    add x11, x11, x8, lsl #2    // Each branch is 4 bytes

    // Load NZCV flags from cpu state into host NZCV register
    // This must be the LAST thing before the conditional branch
    load_flags

    br x11

    .align 2
bcond_table:
    b bcond_eq      // 0: EQ
    b bcond_ne      // 1: NE
    b bcond_cs      // 2: CS/HS
    b bcond_cc      // 3: CC/LO
    b bcond_mi      // 4: MI
    b bcond_pl      // 5: PL
    b bcond_vs      // 6: VS
    b bcond_vc      // 7: VC
    b bcond_hi      // 8: HI
    b bcond_ls      // 9: LS
    b bcond_ge      // 10: GE
    b bcond_lt      // 11: LT
    b bcond_gt      // 12: GT
    b bcond_le      // 13: LE
    b bcond_al      // 14: AL
    b bcond_al      // 15: NV (treat as AL)

bcond_eq:
    b.eq bcond_taken
    b bcond_not_taken
bcond_ne:
    b.ne bcond_taken
    b bcond_not_taken
bcond_cs:
    b.cs bcond_taken
    b bcond_not_taken
bcond_cc:
    b.cc bcond_taken
    b bcond_not_taken
bcond_mi:
    b.mi bcond_taken
    b bcond_not_taken
bcond_pl:
    b.pl bcond_taken
    b bcond_not_taken
bcond_vs:
    b.vs bcond_taken
    b bcond_not_taken
bcond_vc:
    b.vc bcond_taken
    b bcond_not_taken
bcond_hi:
    b.hi bcond_taken
    b bcond_not_taken
bcond_ls:
    b.ls bcond_taken
    b bcond_not_taken
bcond_ge:
    b.ge bcond_taken
    b bcond_not_taken
bcond_lt:
    b.lt bcond_taken
    b bcond_not_taken
bcond_gt:
    b.gt bcond_taken
    b bcond_not_taken
bcond_le:
    b.le bcond_taken
    b bcond_not_taken
bcond_al:
    b bcond_taken

bcond_taken:
    // x9 = target (fake_ip or chained block->code)
    inline_chain x9, bcond_taken_unchained
bcond_taken_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

bcond_not_taken:
    // x10 = fallthrough (fake_ip or chained block->code)
    inline_chain x10, bcond_not_taken_unchained
bcond_not_taken_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain

/*
 * Conditional branch with external taken edge and internal fallthrough edge.
 * Code stream: [gadget addr][cond][fake_target][internal_continue_ptr]
 *
 * The taken edge uses the normal external fake-IP/block->code chain path.
 * The not-taken edge jumps to a private internal-continue record and never
 * passes the interior pointer to fiber_ret_chain.
 */
.gadget bcond_fallthrough_internal
    ldr x8, [_pc], #8       // cond
    ldr x9, [_pc], #8       // taken target (fake_ip or chained)
    ldr x10, [_pc]          // internal_continue record pointer

    and x8, x8, #0xf
    adr x11, bcond_fallthrough_internal_table
    add x11, x11, x8, lsl #2
    load_flags
    br x11

    .align 2
bcond_fallthrough_internal_table:
    b bcond_fi_eq
    b bcond_fi_ne
    b bcond_fi_cs
    b bcond_fi_cc
    b bcond_fi_mi
    b bcond_fi_pl
    b bcond_fi_vs
    b bcond_fi_vc
    b bcond_fi_hi
    b bcond_fi_ls
    b bcond_fi_ge
    b bcond_fi_lt
    b bcond_fi_gt
    b bcond_fi_le
    b bcond_fi_taken
    b bcond_fi_taken
bcond_fi_eq:
    b.eq bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_ne:
    b.ne bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_cs:
    b.cs bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_cc:
    b.cc bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_mi:
    b.mi bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_pl:
    b.pl bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_vs:
    b.vs bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_vc:
    b.vc bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_hi:
    b.hi bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_ls:
    b.ls bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_ge:
    b.ge bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_lt:
    b.lt bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_gt:
    b.gt bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_le:
    b.le bcond_fi_taken
    b bcond_fi_not_taken
bcond_fi_taken:
    inline_chain x9, bcond_fi_taken_unchained
bcond_fi_taken_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain
bcond_fi_not_taken:
    mov _pc, x10
    gret

/*
 * Conditional branch with internal taken edge and external fallthrough edge.
 * Code stream: [gadget addr][cond][internal_continue_ptr][fake_fallthrough]
 *
 * The taken edge jumps to a private internal-continue record and never passes
 * the interior pointer to fiber_ret_chain. The not-taken edge uses the normal
 * external fake-IP/block->code chain path.
 */
.gadget bcond_taken_internal
    ldr x8, [_pc], #8       // cond
    ldr x9, [_pc], #8       // internal_continue record pointer
    ldr x10, [_pc]          // fallthrough target (fake_ip or chained)

    and x8, x8, #0xf
    adr x11, bcond_taken_internal_table
    add x11, x11, x8, lsl #2
    load_flags
    br x11

    .align 2
bcond_taken_internal_table:
    b bcond_ti_eq
    b bcond_ti_ne
    b bcond_ti_cs
    b bcond_ti_cc
    b bcond_ti_mi
    b bcond_ti_pl
    b bcond_ti_vs
    b bcond_ti_vc
    b bcond_ti_hi
    b bcond_ti_ls
    b bcond_ti_ge
    b bcond_ti_lt
    b bcond_ti_gt
    b bcond_ti_le
    b bcond_ti_taken
    b bcond_ti_taken
bcond_ti_eq:
    b.eq bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_ne:
    b.ne bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_cs:
    b.cs bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_cc:
    b.cc bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_mi:
    b.mi bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_pl:
    b.pl bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_vs:
    b.vs bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_vc:
    b.vc bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_hi:
    b.hi bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_ls:
    b.ls bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_ge:
    b.ge bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_lt:
    b.lt bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_gt:
    b.gt bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_le:
    b.le bcond_ti_taken
    b bcond_ti_not_taken
bcond_ti_taken:
    mov _pc, x9
    gret
bcond_ti_not_taken:
    inline_chain x10, bcond_ti_not_taken_unchained
bcond_ti_not_taken_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain

/*
 * System call (SVC)
 * Code stream: [gadget addr][next_pc (64-bit)]
 *
 * Sets guest PC to next instruction before exiting.
 */
.gadget svc
    ldr x8, [_pc]           // Load next instruction address
    str x8, [_cpu, #CPU_pc] // Store as guest PC
    mov w0, #INT_SYSCALL
    b fiber_exit

/*
 * Conditional select (CSEL)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | cond<<24 | sf<<28]
 *
 * CSEL Xd, Xn, Xm, cond
 * If condition is true: Xd = Xn
 * If condition is false: Xd = Xm
 */
.gadget csel
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #4   // cond
    ubfx x13, x8, #28, #1   // sf

    add x14, _cpu, #CPU_x0

    // Load rn value
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load rm value
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Build jump table address for condition
    // Use x3 (was x18) for jump address since load_flags uses x17
    adr x3, csel_table
    add x3, x3, x12, lsl #2

    // Load NZCV flags - MUST be last thing before conditional
    load_flags

    br x3

    .align 2
csel_table:
    b csel_eq       // 0: EQ
    b csel_ne       // 1: NE
    b csel_cs       // 2: CS/HS
    b csel_cc       // 3: CC/LO
    b csel_mi       // 4: MI
    b csel_pl       // 5: PL
    b csel_vs       // 6: VS
    b csel_vc       // 7: VC
    b csel_hi       // 8: HI
    b csel_ls       // 9: LS
    b csel_ge       // 10: GE
    b csel_lt       // 11: LT
    b csel_gt       // 12: GT
    b csel_le       // 13: LE
    b csel_al       // 14: AL
    b csel_al       // 15: NV

csel_eq:
    csel x17, x15, x16, eq
    b csel_store
csel_ne:
    csel x17, x15, x16, ne
    b csel_store
csel_cs:
    csel x17, x15, x16, cs
    b csel_store
csel_cc:
    csel x17, x15, x16, cc
    b csel_store
csel_mi:
    csel x17, x15, x16, mi
    b csel_store
csel_pl:
    csel x17, x15, x16, pl
    b csel_store
csel_vs:
    csel x17, x15, x16, vs
    b csel_store
csel_vc:
    csel x17, x15, x16, vc
    b csel_store
csel_hi:
    csel x17, x15, x16, hi
    b csel_store
csel_ls:
    csel x17, x15, x16, ls
    b csel_store
csel_ge:
    csel x17, x15, x16, ge
    b csel_store
csel_lt:
    csel x17, x15, x16, lt
    b csel_store
csel_gt:
    csel x17, x15, x16, gt
    b csel_store
csel_le:
    csel x17, x15, x16, le
    b csel_store
csel_al:
    mov x17, x15
    b csel_store

csel_store:
    // For 32-bit, truncate result
    cbz x13, 5f
    b 6f
5:  and x17, x17, #0xffffffff
6:
    // Store result
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

/*
 * Test bit and branch if zero (TBZ)
 * Code stream: [gadget addr][rt | bit<<8 (64-bit)][fake_target (64-bit)][fake_fallthrough (64-bit)]
 *
 * TBZ Rt, #imm, label
 * If bit[imm] of Rt is 0: branch to label
 * Otherwise: continue to next instruction
 */
.gadget tbz
    ldr x8, [_pc]           // rt | bit<<8
    add _pc, _pc, #8
    ldr x9, [_pc]           // target (fake_ip or chained)
    add _pc, _pc, #8
    ldr x10, [_pc]          // fallthrough (fake_ip or chained)

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #6    // bit position (0-63)

    // Load register value
    add x13, _cpu, #CPU_x0
    cmp x11, #31
    b.eq 1f
    ldr x14, [x13, x11, lsl #3]
    b 2f
1:  mov x14, #0
2:
    // Create mask for the bit position
    mov x15, #1
    lsl x15, x15, x12       // x15 = 1 << bit_position

    // Test the bit
    tst x14, x15
    b.ne tbz_not_taken      // bit is set (1) - not zero, fall through
    // Bit is zero - take branch (x9)
    inline_chain x9, tbz_t_unchained
tbz_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

tbz_not_taken:
    // bit is set - fall through (x10)
    inline_chain x10, tbz_nt_unchained
tbz_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain

/*
 * Test bit and branch if not zero (TBNZ)
 * Code stream: [gadget addr][rt | bit<<8 (64-bit)][fake_target (64-bit)][fake_fallthrough (64-bit)]
 *
 * TBNZ Rt, #imm, label
 * If bit[imm] of Rt is 1: branch to label
 * Otherwise: continue to next instruction
 */
.gadget tbnz
    ldr x8, [_pc]           // rt | bit<<8
    add _pc, _pc, #8
    ldr x9, [_pc]           // target
    add _pc, _pc, #8
    ldr x10, [_pc]          // fallthrough

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #6    // bit position

    add x13, _cpu, #CPU_x0
    cmp x11, #31
    b.eq 1f
    ldr x14, [x13, x11, lsl #3]
    b 2f
1:  mov x14, #0
2:
    mov x15, #1
    lsl x15, x15, x12

    tst x14, x15
    b.eq tbnz_not_taken     // bit is zero - fall through
    // Bit is set - take branch (x9)
    inline_chain x9, tbnz_t_unchained
tbnz_t_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

tbnz_not_taken:
    // bit is zero - fall through (x10)
    inline_chain x10, tbnz_nt_unchained
tbnz_nt_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain

/*
 * TBZ/TBNZ with external taken edge and internal fallthrough edge.
 * Code stream: [gadget addr][rt | bit<<8 | is_tbnz<<14]
 *              [fake_target][internal_continue_ptr]
 *
 * The taken edge uses the normal external fake-IP/block->code chain path.
 * The not-taken edge jumps to a private internal-continue record and never
 * passes the interior pointer to fiber_ret_chain.
 */
.gadget tbz_fallthrough_internal
    ldr x8, [_pc], #8       // rt | bit<<8 | is_tbnz<<14
    ldr x9, [_pc], #8       // taken target (fake_ip or chained)
    ldr x10, [_pc]          // internal_continue record pointer

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #6    // bit position (0-63)
    ubfx x13, x8, #14, #1   // is_tbnz
    add x14, _cpu, #CPU_x0
    cmp x11, #31
    b.eq tbz_fi_xzr
    ldr x15, [x14, x11, lsl #3]
    b tbz_fi_test
tbz_fi_xzr:
    mov x15, #0
tbz_fi_test:
    mov x16, #1
    lsl x16, x16, x12
    tst x15, x16
    cset w17, ne            // bit set = 1, bit clear = 0
    cmp w17, w13            // TBNZ takes when set; TBZ takes when clear
    b.eq tbz_fi_taken
tbz_fi_not_taken:
    mov _pc, x10
    gret
tbz_fi_taken:
    inline_chain x9, tbz_fi_taken_unchained
tbz_fi_taken_unchained:
    and x11, x9, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x9
    b fiber_ret_chain

/*
 * TBZ/TBNZ with internal taken edge and external fallthrough edge.
 * Code stream: [gadget addr][rt | bit<<8 | is_tbnz<<14]
 *              [internal_continue_ptr][fake_fallthrough]
 *
 * The taken edge jumps to a private internal-continue record and never passes
 * the interior pointer to fiber_ret_chain. The not-taken edge uses the normal
 * external fake-IP/block->code chain path.
 */
.gadget tbz_taken_internal
    ldr x8, [_pc], #8       // rt | bit<<8 | is_tbnz<<14
    ldr x9, [_pc], #8       // internal_continue record pointer
    ldr x10, [_pc]          // fallthrough target (fake_ip or chained)

    and x11, x8, #0x1f      // rt
    ubfx x12, x8, #8, #6    // bit position (0-63)
    ubfx x13, x8, #14, #1   // is_tbnz
    add x14, _cpu, #CPU_x0
    cmp x11, #31
    b.eq tbz_ti_xzr
    ldr x15, [x14, x11, lsl #3]
    b tbz_ti_test
tbz_ti_xzr:
    mov x15, #0
tbz_ti_test:
    mov x16, #1
    lsl x16, x16, x12
    tst x15, x16
    cset w17, ne            // bit set = 1, bit clear = 0
    cmp w17, w13            // TBNZ takes when set; TBZ takes when clear
    b.eq tbz_ti_taken
tbz_ti_not_taken:
    inline_chain x10, tbz_ti_not_taken_unchained
tbz_ti_not_taken_unchained:
    and x11, x10, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x10
    b fiber_ret_chain
tbz_ti_taken:
    mov _pc, x9
    gret

/*
 * CSINC - Conditional Select Increment
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | cond<<24 | sf<<28]
 *
 * CSINC Xd, Xn, Xm, cond
 * If condition is true: Xd = Xn
 * If condition is false: Xd = Xm + 1
 *
 * Common aliases:
 *   CINC Xd, Xn, cond  -> CSINC Xd, Xn, Xn, invert(cond)
 *   CSET Xd, cond      -> CSINC Xd, XZR, XZR, invert(cond)
 */
.gadget csinc
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #4   // cond
    ubfx x13, x8, #28, #1   // sf

    add x14, _cpu, #CPU_x0

    // Load rn value
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load rm value
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // rm + 1 for false case
    add x16, x16, #1

    adr x3, csinc_table
    add x3, x3, x12, lsl #2

    load_flags
    br x3

    .align 2
csinc_table:
    b csinc_eq
    b csinc_ne
    b csinc_cs
    b csinc_cc
    b csinc_mi
    b csinc_pl
    b csinc_vs
    b csinc_vc
    b csinc_hi
    b csinc_ls
    b csinc_ge
    b csinc_lt
    b csinc_gt
    b csinc_le
    b csinc_al
    b csinc_al

csinc_eq:
    csel x17, x15, x16, eq
    b csinc_store
csinc_ne:
    csel x17, x15, x16, ne
    b csinc_store
csinc_cs:
    csel x17, x15, x16, cs
    b csinc_store
csinc_cc:
    csel x17, x15, x16, cc
    b csinc_store
csinc_mi:
    csel x17, x15, x16, mi
    b csinc_store
csinc_pl:
    csel x17, x15, x16, pl
    b csinc_store
csinc_vs:
    csel x17, x15, x16, vs
    b csinc_store
csinc_vc:
    csel x17, x15, x16, vc
    b csinc_store
csinc_hi:
    csel x17, x15, x16, hi
    b csinc_store
csinc_ls:
    csel x17, x15, x16, ls
    b csinc_store
csinc_ge:
    csel x17, x15, x16, ge
    b csinc_store
csinc_lt:
    csel x17, x15, x16, lt
    b csinc_store
csinc_gt:
    csel x17, x15, x16, gt
    b csinc_store
csinc_le:
    csel x17, x15, x16, le
    b csinc_store
csinc_al:
    mov x17, x15
    b csinc_store

csinc_store:
    cbz x13, 5f
    b 6f
5:  and x17, x17, #0xffffffff
6:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

/*
 * CSINV - Conditional Select Invert
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | cond<<24 | sf<<28]
 *
 * If condition is true: Xd = Xn
 * If condition is false: Xd = NOT(Xm)
 */
.gadget csinv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #4
    ubfx x13, x8, #28, #1

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // NOT(rm) for false case
    mvn x16, x16

    adr x3, csinv_table
    add x3, x3, x12, lsl #2

    load_flags
    br x3

    .align 2
csinv_table:
    b csinv_eq
    b csinv_ne
    b csinv_cs
    b csinv_cc
    b csinv_mi
    b csinv_pl
    b csinv_vs
    b csinv_vc
    b csinv_hi
    b csinv_ls
    b csinv_ge
    b csinv_lt
    b csinv_gt
    b csinv_le
    b csinv_al
    b csinv_al

csinv_eq:
    csel x17, x15, x16, eq
    b csinv_store
csinv_ne:
    csel x17, x15, x16, ne
    b csinv_store
csinv_cs:
    csel x17, x15, x16, cs
    b csinv_store
csinv_cc:
    csel x17, x15, x16, cc
    b csinv_store
csinv_mi:
    csel x17, x15, x16, mi
    b csinv_store
csinv_pl:
    csel x17, x15, x16, pl
    b csinv_store
csinv_vs:
    csel x17, x15, x16, vs
    b csinv_store
csinv_vc:
    csel x17, x15, x16, vc
    b csinv_store
csinv_hi:
    csel x17, x15, x16, hi
    b csinv_store
csinv_ls:
    csel x17, x15, x16, ls
    b csinv_store
csinv_ge:
    csel x17, x15, x16, ge
    b csinv_store
csinv_lt:
    csel x17, x15, x16, lt
    b csinv_store
csinv_gt:
    csel x17, x15, x16, gt
    b csinv_store
csinv_le:
    csel x17, x15, x16, le
    b csinv_store
csinv_al:
    mov x17, x15
    b csinv_store

csinv_store:
    cbz x13, 5f
    b 6f
5:  and x17, x17, #0xffffffff
6:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

/*
 * CSNEG - Conditional Select Negate
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | cond<<24 | sf<<28]
 *
 * If condition is true: Xd = Xn
 * If condition is false: Xd = -Xm
 */
.gadget csneg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #4
    ubfx x13, x8, #28, #1

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // NEG(rm) for false case
    neg x16, x16

    adr x3, csneg_table
    add x3, x3, x12, lsl #2

    load_flags
    br x3

    .align 2
csneg_table:
    b csneg_eq
    b csneg_ne
    b csneg_cs
    b csneg_cc
    b csneg_mi
    b csneg_pl
    b csneg_vs
    b csneg_vc
    b csneg_hi
    b csneg_ls
    b csneg_ge
    b csneg_lt
    b csneg_gt
    b csneg_le
    b csneg_al
    b csneg_al

csneg_eq:
    csel x17, x15, x16, eq
    b csneg_store
csneg_ne:
    csel x17, x15, x16, ne
    b csneg_store
csneg_cs:
    csel x17, x15, x16, cs
    b csneg_store
csneg_cc:
    csel x17, x15, x16, cc
    b csneg_store
csneg_mi:
    csel x17, x15, x16, mi
    b csneg_store
csneg_pl:
    csel x17, x15, x16, pl
    b csneg_store
csneg_vs:
    csel x17, x15, x16, vs
    b csneg_store
csneg_vc:
    csel x17, x15, x16, vc
    b csneg_store
csneg_hi:
    csel x17, x15, x16, hi
    b csneg_store
csneg_ls:
    csel x17, x15, x16, ls
    b csneg_store
csneg_ge:
    csel x17, x15, x16, ge
    b csneg_store
csneg_lt:
    csel x17, x15, x16, lt
    b csneg_store
csneg_gt:
    csel x17, x15, x16, gt
    b csneg_store
csneg_le:
    csel x17, x15, x16, le
    b csneg_store
csneg_al:
    mov x17, x15
    b csneg_store

csneg_store:
    cbz x13, 5f
    b 6f
5:  and x17, x17, #0xffffffff
6:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

/*
 * ============================================================
 * Per-condition bcond gadgets
 *
 * Each gadget handles one specific condition code, eliminating the
 * indirect branch (br x11) through the jump table in the generic bcond.
 * Code stream: [gadget addr][target][fallthrough] — no condition word.
 * Reuses existing bcond_taken / bcond_not_taken shared tails.
 * ============================================================
 */

.macro make_bcond name, cond
.gadget bcond_\name
    ldr x9, [_pc]               // target (fake_ip or chained)
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough (fake_ip or chained)
    load_flags
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_bcond eq, eq
make_bcond ne, ne
make_bcond cs, cs
make_bcond cc, cc
make_bcond mi, mi
make_bcond pl, pl
make_bcond vs, vs
make_bcond vc, vc
make_bcond hi, hi
make_bcond ls, ls
make_bcond ge, ge
make_bcond lt, lt
make_bcond gt, gt
make_bcond le, le

/*
 * ============================================================
 * Fused CMP-imm + B.cond gadgets (OP-4)
 *
 * Combines SUBS(64-bit, rd=31, no-shift) + B.cond into a single
 * gadget dispatch, eliminating 1 gret (2 host insns) per iteration
 * of compare-and-branch loops.
 *
 * Code stream: [gadget addr][rn | imm12<<8][fake_target][fake_fallthrough]
 *   rn: bits 0-4 (base register, must not be 31)
 *   imm12: bits 8-19 (12-bit unsigned immediate)
 *
 * Also handles SUBS with result register (rd != 31):
 *   Code stream: [gadget addr][rd | rn<<8 | imm12<<16][fake_target][fake_fallthrough]
 * ============================================================
 */

/*
 * Fused CMP Xn, #imm + B.cond (rd=31, result discarded)
 * Only sets flags, no result stored.
 */
.macro make_fused_cmp_bcond name, cond
.gadget fused_cmp_bcond_\name
    ldr x8, [_pc]               // rn | imm12<<8
    add _pc, _pc, #8
    ldr x9, [_pc]               // target (fake_ip or chained)
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough (fake_ip or chained)
    and x11, x8, #0x1f          // rn
    ubfx x12, x8, #8, #12       // imm12
    // Load rn value
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x11, lsl #3]
    // Compare: SUBS with result discarded (CMP)
    subs x15, x14, x12
    // Store flags (N, Z, C, V from host NZCV)
    mrs x16, nzcv
    str w16, [_cpu, #CPU_nzcv]
    // Now do conditional branch using host flags (still live)
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_fused_cmp_bcond eq, eq
make_fused_cmp_bcond ne, ne
make_fused_cmp_bcond cs, cs
make_fused_cmp_bcond cc, cc
make_fused_cmp_bcond mi, mi
make_fused_cmp_bcond pl, pl
make_fused_cmp_bcond vs, vs
make_fused_cmp_bcond vc, vc
make_fused_cmp_bcond hi, hi
make_fused_cmp_bcond ls, ls
make_fused_cmp_bcond ge, ge
make_fused_cmp_bcond lt, lt
make_fused_cmp_bcond gt, gt
make_fused_cmp_bcond le, le

/*
 * Fused SUBS Xd, Xn, #imm + B.cond (rd != 31, result stored)
 * Stores result AND sets flags, then conditional branch.
 * Code stream: [gadget addr][rd | rn<<8 | imm12<<16][fake_target][fake_fallthrough]
 */
.macro make_fused_subs_bcond name, cond
.gadget fused_subs_bcond_\name
    ldr x8, [_pc]               // rd | rn<<8 | imm12<<16
    add _pc, _pc, #8
    ldr x9, [_pc]               // target
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough
    and x11, x8, #0x1f          // rd
    ubfx x12, x8, #8, #5        // rn
    lsr x13, x8, #16            // imm12
    // Load rn value
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x12, lsl #3]
    // SUBS: subtract and set flags
    subs x15, x15, x13
    // Store result to rd (before mrs clobbers flags info is preserved)
    str x15, [x14, x11, lsl #3]
    // Store flags (subs flags still live, mrs/str don't affect NZCV)
    mrs x15, nzcv
    str w15, [_cpu, #CPU_nzcv]
    // Conditional branch using host flags (still live from subs)
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_fused_subs_bcond eq, eq
make_fused_subs_bcond ne, ne
make_fused_subs_bcond cs, cs
make_fused_subs_bcond cc, cc
make_fused_subs_bcond mi, mi
make_fused_subs_bcond pl, pl
make_fused_subs_bcond vs, vs
make_fused_subs_bcond vc, vc
make_fused_subs_bcond hi, hi
make_fused_subs_bcond ls, ls
make_fused_subs_bcond ge, ge
make_fused_subs_bcond lt, lt
make_fused_subs_bcond gt, gt
make_fused_subs_bcond le, le

/*
 * ============================================================
 * 32-bit Fused CMP/SUBS + B.cond gadgets (OP-9)
 *
 * Same as 64-bit versions but uses w-register (32-bit) SUBS.
 * Code stream layout is identical to 64-bit variants.
 * ============================================================
 */

/*
 * Fused CMP Wn, #imm + B.cond (32-bit, rd=31, result discarded)
 * Code stream: [gadget addr][rn | imm12<<8][fake_target][fake_fallthrough]
 */
.macro make_fused_cmp32_bcond name, cond
.gadget fused_cmp32_bcond_\name
    ldr x8, [_pc]               // rn | imm12<<8
    add _pc, _pc, #8
    ldr x9, [_pc]               // target
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough
    and x11, x8, #0x1f          // rn
    ubfx x12, x8, #8, #12       // imm12
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x11, lsl #3]
    // 32-bit CMP
    subs w15, w14, w12
    mrs x16, nzcv
    str w16, [_cpu, #CPU_nzcv]
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_fused_cmp32_bcond eq, eq
make_fused_cmp32_bcond ne, ne
make_fused_cmp32_bcond cs, cs
make_fused_cmp32_bcond cc, cc
make_fused_cmp32_bcond mi, mi
make_fused_cmp32_bcond pl, pl
make_fused_cmp32_bcond vs, vs
make_fused_cmp32_bcond vc, vc
make_fused_cmp32_bcond hi, hi
make_fused_cmp32_bcond ls, ls
make_fused_cmp32_bcond ge, ge
make_fused_cmp32_bcond lt, lt
make_fused_cmp32_bcond gt, gt
make_fused_cmp32_bcond le, le

/*
 * Fused SUBS Wd, Wn, #imm + B.cond (32-bit, rd!=31, result stored)
 * Code stream: [gadget addr][rd | rn<<8 | imm12<<16][fake_target][fake_fallthrough]
 */
.macro make_fused_subs32_bcond name, cond
.gadget fused_subs32_bcond_\name
    ldr x8, [_pc]               // rd | rn<<8 | imm12<<16
    add _pc, _pc, #8
    ldr x9, [_pc]               // target
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough
    and x11, x8, #0x1f          // rd
    ubfx x12, x8, #8, #5        // rn
    lsr x13, x8, #16            // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x12, lsl #3]
    // 32-bit SUBS
    subs w15, w15, w13
    // Store zero-extended 32-bit result
    // (w-register SUBS already zero-extends to x15)
    str x15, [x14, x11, lsl #3]
    mrs x15, nzcv
    str w15, [_cpu, #CPU_nzcv]
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_fused_subs32_bcond eq, eq
make_fused_subs32_bcond ne, ne
make_fused_subs32_bcond cs, cs
make_fused_subs32_bcond cc, cc
make_fused_subs32_bcond mi, mi
make_fused_subs32_bcond pl, pl
make_fused_subs32_bcond vs, vs
make_fused_subs32_bcond vc, vc
make_fused_subs32_bcond hi, hi
make_fused_subs32_bcond ls, ls
make_fused_subs32_bcond ge, ge
make_fused_subs32_bcond lt, lt
make_fused_subs32_bcond gt, gt
make_fused_subs32_bcond le, le

/*
 * ============================================================
 * Fused CMP_reg + B.cond gadgets (64-bit, rd=31)
 *
 * Combines SUBS X31, Xn, Xm (CMP) + B.cond into a single dispatch.
 * Code stream: [gadget addr][rn | rm<<8][fake_target][fake_fallthrough]
 * ============================================================
 */
.macro make_fused_cmp_reg_bcond name, cond
.gadget fused_cmp_reg_bcond_\name
    ldr x8, [_pc]               // rn | rm<<8
    add _pc, _pc, #8
    ldr x9, [_pc]               // target
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough
    and x11, x8, #0x1f          // rn
    ubfx x12, x8, #8, #5        // rm
    add x13, _cpu, #CPU_x0
    ldr x14, [x13, x11, lsl #3]
    ldr x15, [x13, x12, lsl #3]
    subs xzr, x14, x15
    mrs x16, nzcv
    str w16, [_cpu, #CPU_nzcv]
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_fused_cmp_reg_bcond eq, eq
make_fused_cmp_reg_bcond ne, ne
make_fused_cmp_reg_bcond cs, cs
make_fused_cmp_reg_bcond cc, cc
make_fused_cmp_reg_bcond mi, mi
make_fused_cmp_reg_bcond pl, pl
make_fused_cmp_reg_bcond vs, vs
make_fused_cmp_reg_bcond vc, vc
make_fused_cmp_reg_bcond hi, hi
make_fused_cmp_reg_bcond ls, ls
make_fused_cmp_reg_bcond ge, ge
make_fused_cmp_reg_bcond lt, lt
make_fused_cmp_reg_bcond gt, gt
make_fused_cmp_reg_bcond le, le

/*
 * Fused SUBS Xd, Xn, Xm + B.cond (64-bit, rd!=31, result stored)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16][fake_target][fake_fallthrough]
 */
.macro make_fused_subs_reg_bcond name, cond
.gadget fused_subs_reg_bcond_\name
    ldr x8, [_pc]               // rd | rn<<8 | rm<<16
    add _pc, _pc, #8
    ldr x9, [_pc]               // target
    add _pc, _pc, #8
    ldr x10, [_pc]              // fallthrough
    and x11, x8, #0x1f          // rd
    ubfx x12, x8, #8, #5        // rn
    ubfx x13, x8, #16, #5       // rm
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x12, lsl #3]
    ldr x16, [x14, x13, lsl #3]
    subs x15, x15, x16
    str x15, [x14, x11, lsl #3]
    mrs x15, nzcv
    str w15, [_cpu, #CPU_nzcv]
    b.\cond bcond_taken
    b bcond_not_taken
.endm

make_fused_subs_reg_bcond eq, eq
make_fused_subs_reg_bcond ne, ne
make_fused_subs_reg_bcond cs, cs
make_fused_subs_reg_bcond cc, cc
make_fused_subs_reg_bcond mi, mi
make_fused_subs_reg_bcond pl, pl
make_fused_subs_reg_bcond vs, vs
make_fused_subs_reg_bcond vc, vc
make_fused_subs_reg_bcond hi, hi
make_fused_subs_reg_bcond ls, ls
make_fused_subs_reg_bcond ge, ge
make_fused_subs_reg_bcond lt, lt
make_fused_subs_reg_bcond gt, gt
make_fused_subs_reg_bcond le, le
