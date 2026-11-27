/*
 * ARM64 Guest Memory Access Gadgets
 *
 * These gadgets handle memory load and store operations for ARM64 guest code.
 * Address is calculated and stored in _addr (x7) before load/store gadgets.
 *
 * Most operations use inline TLB lookup for fast-path performance.
 * Cross-page accesses and TLB misses fall through to C helpers.
 */

#include "gadgets.h"

.text

/*
 * Address calculation gadgets
 */

// Calculate address from base register + immediate offset
// Code stream: [gadget addr][rn | offset<<8]
// offset is a signed immediate starting at bit 8
// The width varies: imm9 for pre/post-indexed, larger for LDP/STP
// Using 16-bit signed extraction to handle all cases (max ±32K)
.gadget calc_addr_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    // Extract offset from bits 8+ (arithmetic shift right preserves sign for negative offsets,
    // and handles large unsigned offsets like SIMD Q-class up to 65520)
    asr x10, x8, #8

    // Load base register (or SP if rn == 31)
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:
    // Calculate address (64-bit for 48-bit address space)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff

    // Save guest address for writeback_addr (read_prep will clobber _addr
    // with a host pointer, but pre-indexed LDP/STP need the guest address)
    str _addr, [_cpu, #LOCAL_value_addr]

    gret

// Calculate address for PC-relative literal loads
// Code stream: [gadget addr][64-bit target address]
// Used for LDR (literal) instructions
.gadget calc_addr_pc_rel
    ldr _addr, [_pc]
    add _pc, _pc, #8
    gret

// Calculate address from base register + register offset
// Code stream: [gadget addr][rn | rm<<8 | extend<<16 | shift<<24]
.gadget calc_addr_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    ubfx x10, x8, #8, #5    // rm
    ubfx x11, x8, #16, #3   // extend type
    ubfx x12, x8, #24, #3   // shift amount

    // Load base register (or SP if rn == 31)
    add x13, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x14, [x13, x9, lsl #3]
    b 2f
1:  ldr x14, [_cpu, #CPU_sp]
2:
    // Load index register
    cmp x10, #31
    b.eq 3f
    ldr x15, [x13, x10, lsl #3]
    b 4f
3:  mov x15, #0
4:
    // Apply extend based on option
    // option values: 0=UXTB,1=UXTH,2=UXTW,3=UXTX,4=SXTB,5=SXTH,6=SXTW,7=SXTX
    cmp x11, #4
    b.ge 6f
    cmp x11, #0
    b.eq 5f
    cmp x11, #1
    b.eq 7f
    cmp x11, #2
    b.eq 8f
    b 9f        // option==3 (UXTX) no-op
5:  and x15, x15, #0xff
    b 9f
7:  and x15, x15, #0xffff
    b 9f
8:  and x15, x15, #0xffffffff
    b 9f
6:  cmp x11, #4
    b.eq 10f
    cmp x11, #5
    b.eq 11f
    cmp x11, #6
    b.eq 12f
    b 9f        // option==7 (SXTX) no-op
10: sxtb x15, w15
    b 9f
11: sxth x15, w15
    b 9f
12: sxtw x15, w15
9:
    // Apply shift
    lsl x15, x15, x12

    // Calculate address (64-bit for 48-bit address space)
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    gret

/*
 * Load gadgets with inline TLB lookup
 * Address should be in _addr (x7)
 * Result goes to _tmp (x0)
 *
 * Fast path: inline TLB lookup (~12 instructions on TLB hit)
 * Slow path: call handle_read_miss on TLB miss, crosspage_load on page crossing
 */

// LDR Xn, [addr] - 64-bit load (inline TLB)
.gadget load64
    mov x24, _addr
    read_prep 64, load64_1
    ldr _tmp, [_addr]
    mov _addr, x24
    gret
    read_bullshit 64, load64_1

// LDR Wn, [addr] - 32-bit load (inline TLB)
.gadget load32
    mov x24, _addr
    read_prep 32, load32_1
    ldr w0, [_addr]
    mov _addr, x24
    gret
    read_bullshit 32, load32_1

// LDRH Wn, [addr] - 16-bit load (inline TLB)
.gadget load16
    mov x24, _addr
    read_prep 16, load16_1
    ldrh w0, [_addr]
    mov _addr, x24
    gret
    read_bullshit 16, load16_1

// LDRB Wn, [addr] - 8-bit load (inline TLB)
.gadget load8
    mov x24, _addr
    read_prep 8, load8_1
    ldrb w0, [_addr]
    mov _addr, x24
    gret
    read_bullshit 8, load8_1

// LDRSW Xn, [addr] - 32-bit load with sign-extend to 64 (inline TLB)
.gadget load32_sx
    mov x24, _addr
    read_prep 32, load32_sx_1
    ldrsw _tmp, [_addr]
    mov _addr, x24
    gret
    read_bullshit 32, load32_sx_1

// LDRSH Wn, [addr] - 16-bit load with sign-extend to 32 (inline TLB)
.gadget load16_sx32
    mov x24, _addr
    read_prep 16, load16_sx32_1
    ldrsh w0, [_addr]
    mov _addr, x24
    gret
    read_bullshit 16, load16_sx32_1

// LDRSH Xn, [addr] - 16-bit load with sign-extend to 64 (inline TLB)
.gadget load16_sx64
    mov x24, _addr
    read_prep 16, load16_sx64_1
    ldrsh _tmp, [_addr]
    mov _addr, x24
    gret
    read_bullshit 16, load16_sx64_1

// LDRSB Wn, [addr] - 8-bit load with sign-extend to 32 (inline TLB)
.gadget load8_sx32
    mov x24, _addr
    read_prep 8, load8_sx32_1
    ldrsb w0, [_addr]
    mov _addr, x24
    gret
    read_bullshit 8, load8_sx32_1

// LDRSB Xn, [addr] - 8-bit load with sign-extend to 64 (inline TLB)
.gadget load8_sx64
    mov x24, _addr
    read_prep 8, load8_sx64_1
    ldrsb _tmp, [_addr]
    mov _addr, x24
    gret
    read_bullshit 8, load8_sx64_1

/*
 * Store gadgets with inline TLB lookup
 * Address should be in _addr (x7), value in _tmp (x0)
 * write_prep uses x8-x10, preserving x0 (the value) and x11+
 */

// STR Xn, [addr] - 64-bit store (inline TLB)
.gadget store64
    mov x24, _addr
    mov x11, x0              // save 64-bit value (x11 not clobbered by write_prep)
    write_prep 64, store64_1
    str x11, [_addr]
    write_done 64, store64_1
    mov _addr, x24
    gret
    write_bullshit 64, store64_1

// STR Wn, [addr] - 32-bit store (inline TLB)
.gadget store32
    mov x24, _addr
    mov w11, w0
    write_prep 32, store32_1
    str w11, [_addr]
    write_done 32, store32_1
    mov _addr, x24
    gret
    write_bullshit 32, store32_1

// STRH Wn, [addr] - 16-bit store (inline TLB)
.gadget store16
    mov x24, _addr
    mov w11, w0
    write_prep 16, store16_1
    strh w11, [_addr]
    write_done 16, store16_1
    mov _addr, x24
    gret
    write_bullshit 16, store16_1

// STRB Wn, [addr] - 8-bit store (inline TLB)
.gadget store8
    mov x24, _addr
    mov w11, w0
    write_prep 8, store8_1
    strb w11, [_addr]
    write_done 8, store8_1
    mov _addr, x24
    gret
    write_bullshit 8, store8_1

/*
 * Fused load/store gadgets for unsigned-offset addressing
 *
 * These combine calc_addr_imm + load/store + store_reg/load_reg into a single
 * gadget dispatch, eliminating 2 gret calls (4 host instructions) per operation.
 *
 * Code stream: [gadget addr][rd_or_rt | rn<<8 | offset<<16]
 *   bits 0-4:   rd (load dest) or rt (store source)
 *   bits 8-12:  rn (base register)
 *   bits 16-31: offset (unsigned, already scaled by gen.c)
 *
 * Register usage:
 *   x22: packed parameter (callee-saved, survives TLB miss)
 *   x23: store value (callee-saved, survives TLB miss)
 *   x24: saved guest _addr (callee-saved, survives TLB miss)
 *   x11: _cpu + CPU_x0 (scratch, used before TLB macros)
 *   x8-x10, x12: scratch (used before TLB macros)
 */

// LDR Xd, [Xn, #imm] - fused 64-bit load with unsigned offset
.gadget load64_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5       // rn
    lsr x10, x22, #16           // offset (unsigned)
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, load64_imm_1
    ldr _tmp, [_addr]
    and x8, x22, #0x1f          // rd
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str _tmp, [x11, x8, lsl #3]
3:  mov _addr, x24
    gret
    read_bullshit 64, load64_imm_1

// LDR Wd, [Xn, #imm] - fused 32-bit load with unsigned offset
.gadget load32_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 32, load32_imm_1
    ldr w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str x0, [x11, x8, lsl #3]   // zero-extended 32→64
3:  mov _addr, x24
    gret
    read_bullshit 32, load32_imm_1

// LDRH Wd, [Xn, #imm] - fused 16-bit load with unsigned offset
.gadget load16_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 16, load16_imm_1
    ldrh w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str x0, [x11, x8, lsl #3]   // zero-extended 16→64
3:  mov _addr, x24
    gret
    read_bullshit 16, load16_imm_1

// LDRB Wd, [Xn, #imm] - fused 8-bit load with unsigned offset
.gadget load8_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 8, load8_imm_1
    ldrb w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str x0, [x11, x8, lsl #3]   // zero-extended 8→64
3:  mov _addr, x24
    gret
    read_bullshit 8, load8_imm_1

// LDRSW Xd, [Xn, #imm] - fused 32-bit sign-extending load with unsigned offset
.gadget load32_sx_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 32, load32_sx_imm_1
    ldrsw _tmp, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str _tmp, [x11, x8, lsl #3]
3:  mov _addr, x24
    gret
    read_bullshit 32, load32_sx_imm_1

// STR Xt, [Xn, #imm] - fused 64-bit store with unsigned offset
.gadget store64_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt (source register)
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0                 // XZR
2:  ubfx x9, x22, #8, #5       // rn
    lsr x10, x22, #16           // offset
    cmp x9, #31
    b.eq 3f
    ldr x12, [x11, x9, lsl #3]
    b 4f
3:  ldr x12, [_cpu, #CPU_sp]
4:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 64, store64_imm_1
    str x23, [_addr]
    write_done 64, store64_imm_1
    mov _addr, x24
    gret
    write_bullshit 64, store64_imm_1

// STR Wt, [Xn, #imm] - fused 32-bit store with unsigned offset
.gadget store32_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    cmp x9, #31
    b.eq 3f
    ldr x12, [x11, x9, lsl #3]
    b 4f
3:  ldr x12, [_cpu, #CPU_sp]
4:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 32, store32_imm_1
    str w23, [_addr]
    write_done 32, store32_imm_1
    mov _addr, x24
    gret
    write_bullshit 32, store32_imm_1

// STRH Wt, [Xn, #imm] - fused 16-bit store with unsigned offset
.gadget store16_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    cmp x9, #31
    b.eq 3f
    ldr x12, [x11, x9, lsl #3]
    b 4f
3:  ldr x12, [_cpu, #CPU_sp]
4:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 16, store16_imm_1
    strh w23, [_addr]
    write_done 16, store16_imm_1
    mov _addr, x24
    gret
    write_bullshit 16, store16_imm_1

// STRB Wt, [Xn, #imm] - fused 8-bit store with unsigned offset
.gadget store8_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    cmp x9, #31
    b.eq 3f
    ldr x12, [x11, x9, lsl #3]
    b 4f
3:  ldr x12, [_cpu, #CPU_sp]
4:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 8, store8_imm_1
    strb w23, [_addr]
    write_done 8, store8_imm_1
    mov _addr, x24
    gret
    write_bullshit 8, store8_imm_1

/*
 * Fast-path fused load/store gadgets (no SP/XZR checks)
 *
 * gen.c guarantees rn!=31 (not SP) and rd/rt!=31 (not XZR/WZR).
 * Saves ~4 instructions per operation by skipping the cmp+b.eq pairs.
 * Same code-stream format: [gadget addr][rd_or_rt | rn<<8 | offset<<16]
 */

// LDR Xd, [Xn, #imm] - fast path (rn!=31, rd!=31)
// Stream: [gadget addr][rd | rn<<8 | offset<<16][precise LDR guest PC].
// Save the retry PC here instead of dispatching a separate PC-save gadget.
.gadget load64_imm_fast
    ldp x22, x8, [_pc], #16
    str x8, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5       // rn (guaranteed != 31)
    lsr x10, x22, #16           // offset (unsigned)
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]  // load base (no SP check)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr               // save for crosspage slow path
    read_prep 64, load64_imm_fast_1
    ldr _tmp, [_addr]
    and x8, x22, #0x1f          // rd (guaranteed != 31)
    add x11, _cpu, #CPU_x0      // read miss calls C and may clobber x11
    str _tmp, [x11, x8, lsl #3]
    gret
    read_bullshit 64, load64_imm_fast_1

// LDR Wd, [Xn, #imm] - fast path (rn!=31, rd!=31)
.gadget load32_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr32_cbz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr32_cbz_have_base
fused_ldr32_cbz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr32_cbz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 32, load32_imm_fast_1
    ldr w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0      // read miss calls C and may clobber x11
    str x0, [x11, x8, lsl #3]
    gret
    read_bullshit 32, load32_imm_fast_1

// STR Xt, [Xn, #imm] - fast path (rn!=31, rt!=31)
.gadget store64_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt (guaranteed != 31)
    add x11, _cpu, #CPU_x0
    ldr x23, [x11, x8, lsl #3]  // load value (no XZR check)
    ubfx x9, x22, #8, #5       // rn (guaranteed != 31)
    lsr x10, x22, #16           // offset
    ldr x12, [x11, x9, lsl #3]  // load base (no SP check)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 64, store64_imm_fast_1
    str x23, [_addr]
    write_done 64, store64_imm_fast_1
    gret
    write_bullshit 64, store64_imm_fast_1

// STR Wt, [Xn, #imm] - fast path (rn!=31, rt!=31)
.gadget store32_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt (guaranteed != 31)
    add x11, _cpu, #CPU_x0
    ldr x23, [x11, x8, lsl #3]
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 32, store32_imm_fast_1
    str w23, [_addr]
    write_done 32, store32_imm_fast_1
    gret
    write_bullshit 32, store32_imm_fast_1

// LDRH Wd, [Xn, #imm] - fast path (rn!=31, rd!=31)
.gadget load16_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5       // rn (guaranteed != 31)
    lsr x10, x22, #16           // offset (unsigned)
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]  // load base (no SP check)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 16, load16_imm_fast_1
    ldrh w0, [_addr]
    and x8, x22, #0x1f          // rd (guaranteed != 31)
    add x11, _cpu, #CPU_x0      // read miss calls C and may clobber x11
    str x0, [x11, x8, lsl #3]
    gret
    read_bullshit 16, load16_imm_fast_1

// LDRB Wd, [Xn, #imm] - fast path (rn!=31, rd!=31)
.gadget load8_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr32_cbnz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr32_cbnz_have_base
fused_ldr32_cbnz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr32_cbnz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 8, load8_imm_fast_1
    ldrb w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0      // read miss calls C and may clobber x11
    str x0, [x11, x8, lsl #3]
    gret
    read_bullshit 8, load8_imm_fast_1

// STRH Wt, [Xn, #imm] - fast path (rn!=31, rt!=31)
.gadget store16_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt (guaranteed != 31)
    add x11, _cpu, #CPU_x0
    ldr x23, [x11, x8, lsl #3]  // load value (no XZR check)
    ubfx x9, x22, #8, #5       // rn (guaranteed != 31)
    lsr x10, x22, #16           // offset
    ldr x12, [x11, x9, lsl #3]  // load base (no SP check)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 16, store16_imm_fast_1
    strh w23, [_addr]
    write_done 16, store16_imm_fast_1
    gret
    write_bullshit 16, store16_imm_fast_1

// STRB Wt, [Xn, #imm] - fast path (rn!=31, rt!=31)
.gadget store8_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    ldr x23, [x11, x8, lsl #3]
    ubfx x9, x22, #8, #5
    lsr x10, x22, #16
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 8, store8_imm_fast_1
    strb w23, [_addr]
    write_done 8, store8_imm_fast_1
    gret
    write_bullshit 8, store8_imm_fast_1

/*
 * SP-relative fused load/store gadgets
 *
 * For rn==31 (SP-relative) with rd/rt!=31, we skip both the rn==31 branch
 * and the rd==31 check. Directly loads SP from CPU_sp.
 * Same code-stream format: [gadget addr][rd_or_rt | rn<<8 | offset<<16]
 * (rn field is always 31, but we ignore it and load SP directly)
 */

// LDR Xd, [SP, #imm] - SP-relative 64-bit load (rd!=31)
.gadget load64_sp_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    lsr x10, x22, #16           // offset (unsigned)
    ldr x12, [_cpu, #CPU_sp]    // direct SP load
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, load64_sp_imm_1
    ldr _tmp, [_addr]
    and x8, x22, #0x1f          // rd (guaranteed != 31)
    add x11, _cpu, #CPU_x0      // read miss calls C and may clobber x11
    str _tmp, [x11, x8, lsl #3]
    gret
    read_bullshit 64, load64_sp_imm_1

// LDR Wd, [SP, #imm] - SP-relative 32-bit load (rd!=31)
.gadget load32_sp_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    lsr x10, x22, #16
    ldr x12, [_cpu, #CPU_sp]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 32, load32_sp_imm_1
    ldr w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0      // read miss calls C and may clobber x11
    str x0, [x11, x8, lsl #3]   // zero-extended 32→64
    gret
    read_bullshit 32, load32_sp_imm_1

// STR Xt, [SP, #imm] - SP-relative 64-bit store (rt!=31)
.gadget store64_sp_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt (guaranteed != 31)
    add x11, _cpu, #CPU_x0
    ldr x23, [x11, x8, lsl #3]  // load value (no XZR check)
    lsr x10, x22, #16           // offset
    ldr x12, [_cpu, #CPU_sp]    // direct SP load
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 64, store64_sp_imm_1
    str x23, [_addr]
    write_done 64, store64_sp_imm_1
    gret
    write_bullshit 64, store64_sp_imm_1

// STR Wt, [SP, #imm] - SP-relative 32-bit store (rt!=31)
.gadget store32_sp_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    ldr x23, [x11, x8, lsl #3]
    lsr x10, x22, #16
    ldr x12, [_cpu, #CPU_sp]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 32, store32_sp_imm_1
    str w23, [_addr]
    write_done 32, store32_sp_imm_1
    gret
    write_bullshit 32, store32_sp_imm_1

/*
 * Fused register-offset load/store gadgets
 *
 * Combine calc_addr_reg + load/store + store_reg/load_reg into a single dispatch
 * for the common case: option=3 (UXTX/LSL, no extend on index register).
 *
 * Code stream: [gadget addr][rd_or_rt | rn<<8 | rm<<16 | shift<<24]
 *   bits 0-4:   rd (load dest) or rt (store source)
 *   bits 8-12:  rn (base register)
 *   bits 16-20: rm (index register)
 *   bits 24-26: shift amount (0-4)
 *
 * Register usage:
 *   x22: packed parameter (callee-saved)
 *   x23: store value (callee-saved)
 *   x24: saved guest _addr (callee-saved)
 *   x11: scratch (base of CPU_x0), used before TLB macros
 *   x8-x10, x12-x15: scratch, used before TLB macros
 */

// LDRSW Xd, [Xn, Xm{, LSL #shift}] - fused sign-extending 32-bit load, register offset
.gadget load32_sx_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5        // rn
    ubfx x10, x22, #16, #5      // rm
    ubfx x12, x22, #24, #3      // shift
    add x11, _cpu, #CPU_x0
    // Load base register (or SP if rn == 31)
    cmp x9, #31
    b.eq 1f
    ldr x14, [x11, x9, lsl #3]
    b 2f
1:  ldr x14, [_cpu, #CPU_sp]
2:  // Load index as 32-bit (auto zero-extends)
    cmp x10, #31
    b.eq 3f
    ldr x15, [x11, x10, lsl #3]
    b 4f
3:  mov x15, #0
4:  lsl x15, x15, x12           // apply shift
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 32, load32_sx_reg_1
    ldrsw _tmp, [_addr]
    and x8, x22, #0x1f          // rd
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 5f
    str _tmp, [x11, x8, lsl #3]
5:  mov _addr, x24
    gret
    read_bullshit 32, load32_sx_reg_1

// LDR Xd, [Xn, Xm{, LSL #shift}] - fused 64-bit load, register offset
.gadget load64_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x14, [x11, x9, lsl #3]
    b 2f
1:  ldr x14, [_cpu, #CPU_sp]
2:  cmp x10, #31
    b.eq 3f
    ldr x15, [x11, x10, lsl #3]
    b 4f
3:  mov x15, #0
4:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, load64_reg_1
    ldr _tmp, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 5f
    str _tmp, [x11, x8, lsl #3]
5:  mov _addr, x24
    gret
    read_bullshit 64, load64_reg_1

// LDR Wd, [Xn, Xm{, LSL #shift}] - fused 32-bit load, register offset
.gadget load32_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x14, [x11, x9, lsl #3]
    b 2f
1:  ldr x14, [_cpu, #CPU_sp]
2:  cmp x10, #31
    b.eq 3f
    ldr x15, [x11, x10, lsl #3]
    b 4f
3:  mov x15, #0
4:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 32, load32_reg_1
    ldr w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 5f
    str x0, [x11, x8, lsl #3]   // zero-extended 32→64
5:  mov _addr, x24
    gret
    read_bullshit 32, load32_reg_1

// LDRH Wd, [Xn, Xm{, LSL #shift}] - fused 16-bit load, register offset
.gadget load16_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x14, [x11, x9, lsl #3]
    b 2f
1:  ldr x14, [_cpu, #CPU_sp]
2:  cmp x10, #31
    b.eq 3f
    ldr x15, [x11, x10, lsl #3]
    b 4f
3:  mov x15, #0
4:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 16, load16_reg_1
    ldrh w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 5f
    str x0, [x11, x8, lsl #3]
5:  mov _addr, x24
    gret
    read_bullshit 16, load16_reg_1

// LDRB Wd, [Xn, Xm{, LSL #shift}] - fused 8-bit load, register offset
.gadget load8_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x14, [x11, x9, lsl #3]
    b 2f
1:  ldr x14, [_cpu, #CPU_sp]
2:  cmp x10, #31
    b.eq 3f
    ldr x15, [x11, x10, lsl #3]
    b 4f
3:  mov x15, #0
4:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 8, load8_reg_1
    ldrb w0, [_addr]
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 5f
    str x0, [x11, x8, lsl #3]
5:  mov _addr, x24
    gret
    read_bullshit 8, load8_reg_1

// STR Xt, [Xn, Xm{, LSL #shift}] - fused 64-bit store, register offset
.gadget store64_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt (source register)
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5       // rn
    ubfx x10, x22, #16, #5      // rm
    ubfx x12, x22, #24, #3      // shift
    cmp x9, #31
    b.eq 3f
    ldr x14, [x11, x9, lsl #3]
    b 4f
3:  ldr x14, [_cpu, #CPU_sp]
4:  cmp x10, #31
    b.eq 5f
    ldr x15, [x11, x10, lsl #3]
    b 6f
5:  mov x15, #0
6:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 64, store64_reg_1
    str x23, [_addr]
    write_done 64, store64_reg_1
    mov _addr, x24
    gret
    write_bullshit 64, store64_reg_1

// STR Wt, [Xn, Xm{, LSL #shift}] - fused 32-bit store, register offset
.gadget store32_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    cmp x9, #31
    b.eq 3f
    ldr x14, [x11, x9, lsl #3]
    b 4f
3:  ldr x14, [_cpu, #CPU_sp]
4:  cmp x10, #31
    b.eq 5f
    ldr x15, [x11, x10, lsl #3]
    b 6f
5:  mov x15, #0
6:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 32, store32_reg_1
    str w23, [_addr]
    write_done 32, store32_reg_1
    mov _addr, x24
    gret
    write_bullshit 32, store32_reg_1

// STRH Wt, [Xn, Xm{, LSL #shift}] - fused 16-bit store, register offset
.gadget store16_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    cmp x9, #31
    b.eq 3f
    ldr x14, [x11, x9, lsl #3]
    b 4f
3:  ldr x14, [_cpu, #CPU_sp]
4:  cmp x10, #31
    b.eq 5f
    ldr x15, [x11, x10, lsl #3]
    b 6f
5:  mov x15, #0
6:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 16, store16_reg_1
    strh w23, [_addr]
    write_done 16, store16_reg_1
    mov _addr, x24
    gret
    write_bullshit 16, store16_reg_1

// STRB Wt, [Xn, Xm{, LSL #shift}] - fused 8-bit store, register offset
.gadget store8_reg
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x11, x8, lsl #3]
    b 2f
1:  mov x23, #0
2:  ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #5
    ubfx x12, x22, #24, #3
    cmp x9, #31
    b.eq 3f
    ldr x14, [x11, x9, lsl #3]
    b 4f
3:  ldr x14, [_cpu, #CPU_sp]
4:  cmp x10, #31
    b.eq 5f
    ldr x15, [x11, x10, lsl #3]
    b 6f
5:  mov x15, #0
6:  lsl x15, x15, x12
    add _addr, x14, x15
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 8, store8_reg_1
    strb w23, [_addr]
    write_done 8, store8_reg_1
    mov _addr, x24
    gret
    write_bullshit 8, store8_reg_1

/*
 * Atomic memory operations (LSE)
 * Address should be in _addr (x7)
 *
 * atomic_rmw code stream: [gadget addr][rs | size<<8 | op<<16]
 *   size: 0=8-bit, 1=16-bit, 2=32-bit, 3=64-bit
 *   op:   0=LDADD, 1=LDCLR, 2=LDEOR, 3=LDSET, 4=LDSMAX, 5=LDSMIN, 6=LDUMAX, 7=LDUMIN, 8=SWP
 *
 * atomic_cas code stream: [gadget addr][rs | rt<<8 | size<<16]
 *   rs: expected (and result) register
 *   rt: new value register
 */

.gadget atomic_rmw
    mov x23, _addr              // save address
    ldr x22, [_pc]              // load params
    add _pc, _pc, #8

    and x9, x22, #0x1f          // rs
    ubfx x10, x22, #8, #2       // size
    ubfx x11, x22, #16, #4      // op

    // Load Rs value (or zero for XZR)
    add x12, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x13, [x12, x9, lsl #3]
    b 2f
1:  mov x13, #0
2:
    // Call C helper: c_atomic_rmw(tlb, addr, value, size, op, &old)
    sub sp, sp, #16
    save_c
    sub x0, _tlb, #TLB_entries
    mov x1, x23                 // address (64-bit)
    mov x2, x13                 // value
    mov w3, w10                 // size
    mov w4, w11                 // op
    add x5, sp, #0xa0           // &old (adjust for save_c)
    bl NAME(c_atomic_rmw)
    mov w19, w0
    restore_c
    mov _addr, x23              // restore _addr (restore_c clobbers x7)

    cbnz w19, atomic_rmw_segfault
    ldr _tmp, [sp]              // old value
    add sp, sp, #16
    gret

atomic_rmw_segfault:
    add sp, sp, #16
    str x23, [_cpu, #CPU_segfault_addr]  // 64-bit address for ARM64 guest
    mov w8, #1
    strb w8, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

.gadget atomic_cas
    mov x23, _addr              // save address
    ldr x22, [_pc]              // load params
    add _pc, _pc, #8

    and x9, x22, #0x1f          // rs (expected/result)
    ubfx x10, x22, #8, #5       // rt (new value)
    ubfx x11, x22, #16, #2      // size

    add x12, _cpu, #CPU_x0
    // Load expected value (rs)
    cmp x9, #31
    b.eq 3f
    ldr x13, [x12, x9, lsl #3]
    b 4f
3:  mov x13, #0
4:
    // Load desired value (rt)
    cmp x10, #31
    b.eq 5f
    ldr x14, [x12, x10, lsl #3]
    b 6f
5:  mov x14, #0
6:
    // Call C helper: c_atomic_cas(tlb, addr, expected, desired, size, &old)
    sub sp, sp, #16
    save_c
    sub x0, _tlb, #TLB_entries
    mov x1, x23                 // address (64-bit)
    mov x2, x13                 // expected
    mov x3, x14                 // desired
    mov w4, w11                 // size
    add x5, sp, #0xa0           // &old
    bl NAME(c_atomic_cas)
    mov w19, w0
    restore_c
    mov _addr, x23              // restore _addr (restore_c clobbers x7)

    cbnz w19, atomic_cas_segfault
    ldr _tmp, [sp]              // old value
    add sp, sp, #16
    gret

atomic_cas_segfault:
    add sp, sp, #16
    str x23, [_cpu, #CPU_segfault_addr]  // 64-bit address for ARM64 guest
    mov w8, #1
    strb w8, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

.gadget atomic_casp
    mov x23, _addr              // save address
    ldr x22, [_pc]              // rs | rt<<8 | size<<16 (size 2=32-pair, 3=64-pair)
    add _pc, _pc, #8

    and x9, x22, #0x1f          // rs (expected/result lo; hi is rs+1)
    ubfx x10, x22, #8, #5       // rt (desired lo; hi is rt+1)
    ubfx x11, x22, #16, #2      // element size
    add x12, _cpu, #CPU_x0

    // Load expected pair from Rs/Rs+1
    cmp x9, #31
    b.eq 1f
    ldr x13, [x12, x9, lsl #3]
    add x15, x9, #1
    cmp x15, #31
    b.eq 2f
    ldr x14, [x12, x15, lsl #3]
    b 3f
1:  mov x13, #0
2:  mov x14, #0
3:
    // Load desired pair from Rt/Rt+1
    cmp x10, #31
    b.eq 4f
    ldr x20, [x12, x10, lsl #3]
    add x15, x10, #1
    cmp x15, #31
    b.eq 5f
    ldr x21, [x12, x15, lsl #3]
    b 6f
4:  mov x20, #0
5:  mov x21, #0
6:
    sub sp, sp, #16
    str x13, [sp]
    str x14, [sp, #8]
    save_c
    sub x0, _tlb, #TLB_entries
    mov x1, x23
    add x2, sp, #0xa0           // &old_lo / expected_lo
    add x3, sp, #0xa8           // &old_hi / expected_hi
    mov x4, x20
    mov x5, x21
    mov w6, w11
    bl NAME(c_casp_pair)
    mov w19, w0
    restore_c
    mov _addr, x23

    cbnz w19, atomic_casp_segfault

    ldr x13, [sp]
    ldr x14, [sp, #8]
    add sp, sp, #16
    add x12, _cpu, #CPU_x0
    and x9, x22, #0x1f
    cmp x9, #31
    b.eq 7f
    str x13, [x12, x9, lsl #3]
    add x15, x9, #1
    cmp x15, #31
    b.eq 7f
    str x14, [x12, x15, lsl #3]
7:  gret

atomic_casp_segfault:
    add sp, sp, #16
    str x23, [_cpu, #CPU_segfault_addr]
    mov w8, #1
    strb w8, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

/*
 * Memory barrier/system-synchronization gadgets.
 * Since guest threads run as real host threads sharing the same physical
 * memory, guest memory ordering must be enforced with real host barriers.
 */
.gadget dmb
    // Decode currently folds all DMB CRm domains into one gadget; use the
    // strongest host domain so DMB SY/LD/ST are never under-serialized.
    dmb sy
    gret

.gadget dsb
    // Decode currently folds all DSB CRm domains into one gadget; use the
    // strongest host domain so DSB SY/LD/ST are never under-serialized.
    dsb sy
    gret

.gadget isb
    isb
    gret

/*
 * CLREX — clear single/pair exclusive monitor state.
 */
.gadget clrex
    movn x8, #0
    str x8, [_cpu, #CPU_excl_addr]
    str x8, [_cpu, #CPU_excl_pair_addr]
    str wzr, [_cpu, #CPU_excl_pair_size]
    str xzr, [_cpu, #CPU_excl_val]
    str xzr, [_cpu, #CPU_excl_pair_val_lo]
    str xzr, [_cpu, #CPU_excl_pair_val_hi]
    gret

/*
 * IC IVAU — guest invalidates its instruction cache after modifying code.
 * The architectural contract is "code at [Xt] changed; refetch it", so we
 * must drop any translated blocks for that page or the JIT keeps running
 * the stale pre-patch translation (JSC repatches its JIT code in place).
 * Code stream: [gadget addr][rt]
 */
.gadget ic_ivau
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f          // rt
    add x10, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x11, [x10, x9, lsl #3]
    b 2f
1:  mov x11, #0
2:
    save_c
    sub x0, _tlb, #TLB_entries
    mov x1, x11                // VA to invalidate
    bl NAME(c_ic_ivau)
    restore_c
    gret

/*
 * Base register update gadget for post/pre-indexed addressing
 * Code stream: [gadget addr][rn | offset<<8]
 * Updates: Rn = Rn + offset
 * The offset can be imm9 for pre/post load/store or imm7*scale for LDP/STP
 * Using 16-bit signed extraction to handle all cases
 */
.gadget update_base
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    asr x10, x8, #8         // offset (sign-extended from gen.c packing)

    // Load current base register and update with offset
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    add x12, x12, x10
    and x12, x12, #0xffffffffffff
    str x12, [x11, x9, lsl #3]
    gret
1:  // SP update
    ldr x12, [_cpu, #CPU_sp]
    add x12, x12, x10
    and x12, x12, #0xffffffffffff
    str x12, [_cpu, #CPU_sp]
    gret

/*
 * Writeback address to base register (for pre-indexed)
 * Code stream: [gadget addr][rn]
 *
 * Uses the guest address saved in LOCAL_value_addr by calc_addr_imm,
 * NOT _addr which has been transformed to a host pointer by read_prep.
 */
.gadget writeback_addr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    ldr x10, [_cpu, #LOCAL_value_addr]  // guest address from calc_addr_imm

    // Store guest address to register
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    str x10, [x11, x9, lsl #3]
    gret
1:  // SP writeback
    str x10, [_cpu, #CPU_sp]
    gret

/*
 * Calculate address from base register only (for pre/post-indexed)
 * Code stream: [gadget addr][rn]
 */
.gadget calc_addr_base
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn

    // Load base register (or SP if rn == 31)
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr _addr, [x11, x9, lsl #3]
    gret
1:  ldr _addr, [_cpu, #CPU_sp]
    gret

/*
 * Load/Store Pair gadgets (LDP/STP) with inline TLB lookup
 * Address should be in _addr (x7)
 * Code stream: [gadget addr][rt | rt2<<8]
 * Single TLB lookup covers both values when on same page.
 */

// LDP Xn, Xm, [addr] - 64-bit load pair (inline TLB)
.gadget ldp64
    ldr x22, [_pc]              // rt | rt2<<8
    add _pc, _pc, #8
    mov x24, _addr
    read_prep 128, ldp64_1      // 16 bytes: cross-page if offset > 0xff0
    ldr x23, [_addr]            // val1
    ldr x25, [_addr, #8]        // val2
    and x8, x22, #0x1f          // rt
    ubfx x9, x22, #8, #5        // rt2
    add x10, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    str x23, [x10, x8, lsl #3]
1:  cmp x9, #31
    b.eq 2f
    str x25, [x10, x9, lsl #3]
2:  mov _addr, x24
    gret
    read_bullshit 128, ldp64_1

// LDP Wn, Wm, [addr] - 32-bit load pair (inline TLB)
.gadget ldp32
    ldr x22, [_pc]
    add _pc, _pc, #8
    mov x24, _addr
    read_prep 64, ldp32_1       // 8 bytes total (2x4): cross-page if offset > 0xff8
    ldr w23, [_addr]            // val1 (32-bit, zero-extended to x23)
    ldr w25, [_addr, #4]        // val2 (32-bit, zero-extended to x25)
    and x8, x22, #0x1f          // rt
    ubfx x9, x22, #8, #5        // rt2
    add x10, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    str x23, [x10, x8, lsl #3]  // store zero-extended 64-bit
1:  cmp x9, #31
    b.eq 2f
    str x25, [x10, x9, lsl #3]
2:  mov _addr, x24
    gret
    read_bullshit 64, ldp32_1

// LDPSW Xt, Xt2, [addr] - load pair of signed words into X registers (inline TLB)
.gadget ldpsw
    ldr x22, [_pc]
    add _pc, _pc, #8
    mov x24, _addr
    read_prep 64, ldpsw_1       // 8 bytes total (2x4): cross-page if offset > 0xff8
    ldrsw x23, [_addr]          // val1 (32-bit sign-extended to x23)
    ldrsw x25, [_addr, #4]      // val2 (32-bit sign-extended to x25)
    and x8, x22, #0x1f          // rt
    ubfx x9, x22, #8, #5        // rt2
    add x10, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    str x23, [x10, x8, lsl #3]
1:  cmp x9, #31
    b.eq 2f
    str x25, [x10, x9, lsl #3]
2:  mov _addr, x24
    gret
    read_bullshit 64, ldpsw_1

// STP Xn, Xm, [addr] - 64-bit store pair (inline TLB)
.gadget stp64
    ldr x22, [_pc]
    add _pc, _pc, #8
    // Load register values before write_prep (which clobbers x8-x10)
    and x8, x22, #0x1f          // rt
    ubfx x9, x22, #8, #5        // rt2
    add x10, _cpu, #CPU_x0
    mov x23, #0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x10, x8, lsl #3]
1:  mov x25, #0
    cmp x9, #31
    b.eq 2f
    ldr x25, [x10, x9, lsl #3]
2:  mov x24, _addr
    write_prep 128, stp64_1     // 16 bytes
    str x23, [_addr]
    str x25, [_addr, #8]
    write_done 128, stp64_1
    mov _addr, x24
    gret
    write_bullshit 128, stp64_1

// STP Wn, Wm, [addr] - 32-bit store pair (inline TLB)
.gadget stp32
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f          // rt
    ubfx x9, x22, #8, #5        // rt2
    add x10, _cpu, #CPU_x0
    mov x23, #0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x10, x8, lsl #3]  // load full 64-bit (upper 32 bits zero for W-reg ops)
1:  mov x25, #0
    cmp x9, #31
    b.eq 2f
    ldr x25, [x10, x9, lsl #3]
2:  mov x24, _addr
    write_prep 64, stp32_1      // 8 bytes total (2x4)
    str w23, [_addr]             // store only low 32 bits
    str w25, [_addr, #4]
    write_done 64, stp32_1
    mov _addr, x24
    gret
    write_bullshit 64, stp32_1

/*
 * Fused LDP/STP with signed-offset addressing (mode==2)
 *
 * Combines calc_addr_imm + ldp/stp into a single gadget dispatch.
 * Used for the most common LDP/STP encoding: signed offset mode.
 *
 * Code stream: [gadget addr][rt | rt2<<8 | rn<<16 | offset<<24]
 *   bits 0-4:   rt  (5 bits)
 *   bits 8-12:  rt2 (5 bits)
 *   bits 16-20: rn  (5 bits)
 *   bits 24-39: signed offset in bytes (16-bit, sign-extracted via sbfx)
 *
 * Register usage:
 *   x22: packed parameter (callee-saved)
 *   x23, x25: load/store values (callee-saved)
 *   x24: saved _addr (callee-saved)
 *   x8-x12: scratch
 */

// Fast-path LDP Xt, Xt2, [Xn, #imm] (rn!=31, rt!=31, rt2!=31)
.gadget ldp64_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #16, #5          // rn
    sbfx x10, x22, #24, #16        // signed offset
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]     // base (no SP check)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 128, ldp64_imm_fast_1
    ldr x23, [_addr]
    ldr x25, [_addr, #8]
    and x8, x22, #0x1f              // rt
    ubfx x9, x22, #8, #5            // rt2
    add x11, _cpu, #CPU_x0          // read miss calls C and may clobber x11
    str x23, [x11, x8, lsl #3]
    str x25, [x11, x9, lsl #3]
    gret
    read_bullshit 128, ldp64_imm_fast_1

// Fast-path STP Xt, Xt2, [Xn, #imm] (rn!=31, rt!=31, rt2!=31)
.gadget stp64_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f              // rt
    ubfx x9, x22, #8, #5            // rt2
    add x10, _cpu, #CPU_x0
    ldr x23, [x10, x8, lsl #3]     // no XZR check
    ldr x25, [x10, x9, lsl #3]
    ubfx x9, x22, #16, #5           // rn
    sbfx x10, x22, #24, #16         // signed offset
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]     // no SP check
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 128, stp64_imm_fast_1
    str x23, [_addr]
    str x25, [_addr, #8]
    write_done 128, stp64_imm_fast_1
    gret
    write_bullshit 128, stp64_imm_fast_1

// Fast-path LDP Wt, Wt2, [Xn, #imm] (rn!=31, rt!=31, rt2!=31)
.gadget ldp32_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #16, #5          // rn
    sbfx x10, x22, #24, #16        // signed offset
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]     // base (no SP check)
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, ldp32_imm_fast_1   // 8 bytes (2x4)
    ldr w23, [_addr]
    ldr w25, [_addr, #4]
    and x8, x22, #0x1f              // rt
    ubfx x9, x22, #8, #5            // rt2
    add x11, _cpu, #CPU_x0          // read miss calls C and may clobber x11
    str x23, [x11, x8, lsl #3]
    str x25, [x11, x9, lsl #3]
    gret
    read_bullshit 64, ldp32_imm_fast_1

// Fast-path LDPSW Xt, Xt2, [Xn, #imm] (rn!=31, rt!=31, rt2!=31)
.gadget ldpsw_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #16, #5          // rn
    ubfx x10, x22, #24, #16
    sxth x10, w10                  // sign-extend offset
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, ldpsw_imm_fast_1 // 8 bytes (2x4)
    ldrsw x23, [_addr]
    ldrsw x25, [_addr, #4]
    and x8, x22, #0x1f             // rt
    ubfx x9, x22, #8, #5           // rt2
    str x23, [x11, x8, lsl #3]
    str x25, [x11, x9, lsl #3]
    gret
    read_bullshit 64, ldpsw_imm_fast_1

// Fast-path STP Wt, Wt2, [Xn, #imm] (rn!=31, rt!=31, rt2!=31)
.gadget stp32_imm_fast
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f              // rt
    ubfx x9, x22, #8, #5            // rt2
    add x10, _cpu, #CPU_x0
    ldr x23, [x10, x8, lsl #3]     // no XZR check
    ldr x25, [x10, x9, lsl #3]
    ubfx x9, x22, #16, #5           // rn
    sbfx x10, x22, #24, #16         // signed offset
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]     // no SP check
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 64, stp32_imm_fast_1  // 8 bytes (2x4)
    str w23, [_addr]
    str w25, [_addr, #4]
    write_done 64, stp32_imm_fast_1
    gret
    write_bullshit 64, stp32_imm_fast_1

// Fused LDP Xt, Xt2, [Xn, #imm] - 64-bit load pair with signed offset
.gadget ldp64_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    // Unpack parameters
    ubfx x9, x22, #16, #5          // rn
    sbfx x10, x22, #24, #16        // signed offset in bytes
    // Load base register or SP
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 128, ldp64_imm_1      // 16 bytes
    ldr x23, [_addr]                // val1
    ldr x25, [_addr, #8]            // val2
    and x8, x22, #0x1f              // rt
    ubfx x9, x22, #8, #5            // rt2
    add x10, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str x23, [x10, x8, lsl #3]
3:  cmp x9, #31
    b.eq 4f
    str x25, [x10, x9, lsl #3]
4:  mov _addr, x24
    gret
    read_bullshit 128, ldp64_imm_1

// Fused LDP Wt, Wt2, [Xn, #imm] - 32-bit load pair with signed offset
.gadget ldp32_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #16, #5
    sbfx x10, x22, #24, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, ldp32_imm_1       // 8 bytes (2x4)
    ldr w23, [_addr]                // val1 (zero-extended)
    ldr w25, [_addr, #4]            // val2 (zero-extended)
    and x8, x22, #0x1f
    ubfx x9, x22, #8, #5
    add x10, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 3f
    str x23, [x10, x8, lsl #3]     // store zero-extended 64-bit
3:  cmp x9, #31
    b.eq 4f
    str x25, [x10, x9, lsl #3]
4:  mov _addr, x24
    gret
    read_bullshit 64, ldp32_imm_1

// Fused LDPSW Xt, Xt2, [Xn, #imm] - sign-extending word load pair with signed offset
.gadget ldpsw_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    ubfx x9, x22, #16, #5
    ubfx x10, x22, #24, #16
    sxth x10, w10
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x12, [x11, x9, lsl #3]
    b 2f
1:  ldr x12, [_cpu, #CPU_sp]
2:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    read_prep 64, ldpsw_imm_1      // 8 bytes (2x4)
    ldrsw x23, [_addr]             // val1 (sign-extended)
    ldrsw x25, [_addr, #4]         // val2 (sign-extended)
    and x8, x22, #0x1f
    ubfx x9, x22, #8, #5
    cmp x8, #31
    b.eq 3f
    str x23, [x11, x8, lsl #3]
3:  cmp x9, #31
    b.eq 4f
    str x25, [x11, x9, lsl #3]
4:  mov _addr, x24
    gret
    read_bullshit 64, ldpsw_imm_1

// Fused STP Xt, Xt2, [Xn, #imm] - 64-bit store pair with signed offset
.gadget stp64_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    // Load register values before write_prep (which clobbers x8-x10)
    and x8, x22, #0x1f              // rt
    ubfx x9, x22, #8, #5            // rt2
    add x10, _cpu, #CPU_x0
    mov x23, #0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x10, x8, lsl #3]
1:  mov x25, #0
    cmp x9, #31
    b.eq 2f
    ldr x25, [x10, x9, lsl #3]
2:  // Calculate address
    ubfx x9, x22, #16, #5           // rn
    sbfx x10, x22, #24, #16         // signed offset
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 3f
    ldr x12, [x11, x9, lsl #3]
    b 4f
3:  ldr x12, [_cpu, #CPU_sp]
4:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 128, stp64_imm_1     // 16 bytes
    str x23, [_addr]
    str x25, [_addr, #8]
    write_done 128, stp64_imm_1
    mov _addr, x24
    gret
    write_bullshit 128, stp64_imm_1

// Fused STP Wt, Wt2, [Xn, #imm] - 32-bit store pair with signed offset
.gadget stp32_imm
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x8, x22, #0x1f
    ubfx x9, x22, #8, #5
    add x10, _cpu, #CPU_x0
    mov x23, #0
    cmp x8, #31
    b.eq 1f
    ldr x23, [x10, x8, lsl #3]
1:  mov x25, #0
    cmp x9, #31
    b.eq 2f
    ldr x25, [x10, x9, lsl #3]
2:  ubfx x9, x22, #16, #5
    sbfx x10, x22, #24, #16
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 3f
    ldr x12, [x11, x9, lsl #3]
    b 4f
3:  ldr x12, [_cpu, #CPU_sp]
4:  add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr
    write_prep 64, stp32_imm_1      // 8 bytes (2x4)
    str w23, [_addr]
    str w25, [_addr, #4]
    write_done 64, stp32_imm_1
    mov _addr, x24
    gret
    write_bullshit 64, stp32_imm_1

/*
 * Fused ADRP+LDR64 gadget
 * When ADRP Xd, #page is immediately followed by LDR Xt, [Xd, #offset],
 * we can compute the final address directly and do a single TLB lookup.
 * Code stream: [gadget addr][ldr_rt(0:4) | rd(5:9) | ldr_offset(16:31)][adrp_target (48-bit)]
 */
.gadget fused_adrp_ldr64
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // adrp_target (48-bit address in 64-bit word)
    add _pc, _pc, #16

    // Store ADRP result to rd (so subsequent code can use it)
    ubfx x9, x22, #5, #5        // rd (ADRP destination register)
    add x11, _cpu, #CPU_x0
    str x23, [x11, x9, lsl #3]  // cpu->x[rd] = adrp_target

    // Compute final address = adrp_target + ldr_offset
    ubfx x10, x22, #16, #16     // ldr_offset (unsigned, scaled)
    add _addr, x23, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    // TLB read lookup + load 64-bit
    read_prep 64, fused_adrp_ldr64_1
    ldr _tmp, [_addr]

    // Store to guest ldr_rt
    and x8, x22, #0x1f          // ldr_rt
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    gret
    read_bullshit 64, fused_adrp_ldr64_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + LDR Xt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | ldr_rt<<32 | ldr_imm12<<40]
 *              [ldr_guest_pc]
 * Stores the ADD/SUB result before the load, matching architectural ordering
 * if the load faults. The LDR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise LDR PC.
 */
.gadget fused_addsub_ldr64_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and LDR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_ldr64_sub
    add x16, x15, x11
    b fused_addsub_ldr64_store_base
fused_addsub_ldr64_sub:
    sub x16, x15, x11
fused_addsub_ldr64_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before LDR

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x10, x22, #40, #12     // LDR imm12, scaled by 8
    lsl x10, x10, #3
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 64, fused_addsub_ldr64_imm_1
    ldr _tmp, [_addr]

    ubfx x8, x22, #32, #5       // ldr_rt
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    gret
    read_bullshit 64, fused_addsub_ldr64_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + LDR Wt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | ldr_rt<<32 | ldr_imm12<<40]
 *              [ldr_guest_pc]
 * Stores the ADD/SUB result before the load, matching architectural ordering
 * if the load faults. The LDR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise LDR PC. The
 * 32-bit load result is zero-extended into the architectural X register.
 */
.gadget fused_addsub_ldr32_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and LDR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_ldr32_sub
    add x16, x15, x11
    b fused_addsub_ldr32_store_base
fused_addsub_ldr32_sub:
    sub x16, x15, x11
fused_addsub_ldr32_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before LDR

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x10, x22, #40, #12     // LDR imm12, scaled by 4
    lsl x10, x10, #2
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 32, fused_addsub_ldr32_imm_1
    ldr w0, [_addr]

    ubfx x8, x22, #32, #5       // ldr_rt
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]   // zero-extended 32→64
    mov _addr, x24
    gret
    read_bullshit 32, fused_addsub_ldr32_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + LDRH Wt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | ldr_rt<<32 | ldr_imm12<<40]
 *              [ldr_guest_pc]
 * Stores the ADD/SUB result before the load, matching architectural ordering
 * if the load faults. The LDR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise LDR PC. The
 * 16-bit load result is zero-extended into the architectural X register.
 */
.gadget fused_addsub_ldr16_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and LDR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_ldr16_sub
    add x16, x15, x11
    b fused_addsub_ldr16_store_base
fused_addsub_ldr16_sub:
    sub x16, x15, x11
fused_addsub_ldr16_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before LDR

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x10, x22, #40, #12     // LDRH imm12, scaled by 2
    lsl x10, x10, #1
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 16, fused_addsub_ldr16_imm_1
    ldrh w0, [_addr]

    ubfx x8, x22, #32, #5       // ldr_rt
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]   // zero-extended 16→64
    mov _addr, x24
    gret
    read_bullshit 16, fused_addsub_ldr16_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + LDRB Wt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | ldr_rt<<32 | ldr_imm12<<40]
 *              [ldr_guest_pc]
 * Stores the ADD/SUB result before the load, matching architectural ordering
 * if the load faults. The LDR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise LDR PC. The
 * 8-bit load result is zero-extended into the architectural X register.
 */
.gadget fused_addsub_ldr8_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and LDR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_ldr8_sub
    add x16, x15, x11
    b fused_addsub_ldr8_store_base
fused_addsub_ldr8_sub:
    sub x16, x15, x11
fused_addsub_ldr8_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before LDR

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x10, x22, #40, #12     // LDRB imm12, scaled by 1
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 8, fused_addsub_ldr8_imm_1
    ldrb w0, [_addr]

    ubfx x8, x22, #32, #5       // ldr_rt
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]   // zero-extended 8→64
    mov _addr, x24
    gret
    read_bullshit 8, fused_addsub_ldr8_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + STR Xt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | str_rt<<32 | str_imm12<<40]
 *              [str_guest_pc]
 * Stores the ADD/SUB result before the store, matching architectural ordering
 * if the store faults. The STR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise STR PC.
 */
.gadget fused_addsub_str64_imm
    ldr x22, [_pc]
    ldr x25, [_pc, #8]          // precise STR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and STR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_str64_sub
    add x16, x15, x11
    b fused_addsub_str64_store_base
fused_addsub_str64_sub:
    sub x16, x15, x11
fused_addsub_str64_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before STR

    str x25, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x8, x22, #32, #5       // str_rt
    ldr x23, [x14, x8, lsl #3]  // store value after ADD/SUB, so rt==rd is correct
    ubfx x10, x22, #40, #12     // STR imm12, scaled by 8
    lsl x10, x10, #3
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    write_prep 64, fused_addsub_str64_imm_1
    str x23, [_addr]
    write_done 64, fused_addsub_str64_imm_1
    mov _addr, x24
    gret
    write_bullshit 64, fused_addsub_str64_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + STR Wt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | str_rt<<32 | str_imm12<<40]
 *              [str_guest_pc]
 * Stores the ADD/SUB result before the store, matching architectural ordering
 * if the store faults. The STR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise STR PC. The
 * store source is read after the ADD/SUB side effect so rt==rd is correct.
 */
.gadget fused_addsub_str32_imm
    ldr x22, [_pc]
    ldr x25, [_pc, #8]          // precise STR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and STR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_str32_sub
    add x16, x15, x11
    b fused_addsub_str32_store_base
fused_addsub_str32_sub:
    sub x16, x15, x11
fused_addsub_str32_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before STR

    str x25, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x8, x22, #32, #5       // str_rt
    ldr x23, [x14, x8, lsl #3]  // store value after ADD/SUB, so rt==rd is correct
    ubfx x10, x22, #40, #12     // STR imm12, scaled by 4
    lsl x10, x10, #2
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    write_prep 32, fused_addsub_str32_imm_1
    str w23, [_addr]
    write_done 32, fused_addsub_str32_imm_1
    mov _addr, x24
    gret
    write_bullshit 32, fused_addsub_str32_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + STRH Wt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | str_rt<<32 | str_imm12<<40]
 *              [str_guest_pc]
 * Stores the ADD/SUB result before the store, matching architectural ordering
 * if the store faults. The STR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise STR PC. The
 * store source is read after the ADD/SUB side effect so rt==rd is correct.
 */
.gadget fused_addsub_str16_imm
    ldr x22, [_pc]
    ldr x25, [_pc, #8]          // precise STR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and STR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_str16_sub
    add x16, x15, x11
    b fused_addsub_str16_store_base
fused_addsub_str16_sub:
    sub x16, x15, x11
fused_addsub_str16_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before STR

    str x25, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x8, x22, #32, #5       // str_rt
    ldr x23, [x14, x8, lsl #3]  // store value after ADD/SUB, so rt==rd is correct
    ubfx x10, x22, #40, #12     // STRH imm12, scaled by 2
    lsl x10, x10, #1
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    write_prep 16, fused_addsub_str16_imm_1
    strh w23, [_addr]
    write_done 16, fused_addsub_str16_imm_1
    mov _addr, x24
    gret
    write_bullshit 16, fused_addsub_str16_imm_1

/*
 * Fused ADD/SUB (immediate, 64-bit, no flags) + STRB Wt, [Xd, #imm]
 * Code stream: [gadget addr]
 *              [rd | add_rn<<8 | add_imm12<<16 | op<<28 | str_rt<<32 | str_imm12<<40]
 *              [str_guest_pc]
 * Stores the ADD/SUB result before the store, matching architectural ordering
 * if the store faults. The STR guest PC is written to LOCAL_jit_saved_pc before
 * the faultable memory access so guest signals report the precise STR PC. The
 * store source is read after the ADD/SUB side effect so rt==rd is correct.
 */
.gadget fused_addsub_str8_imm
    ldr x22, [_pc]
    ldr x25, [_pc, #8]          // precise STR guest PC for fault recovery
    add _pc, _pc, #16

    and x9, x22, #0x1f          // rd = ADD/SUB destination and STR base
    ubfx x10, x22, #8, #5       // add/sub rn
    ubfx x11, x22, #16, #12     // add/sub imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    tbnz x22, #28, fused_addsub_str8_sub
    add x16, x15, x11
    b fused_addsub_str8_store_base
fused_addsub_str8_sub:
    sub x16, x15, x11
fused_addsub_str8_store_base:
    str x16, [x14, x9, lsl #3]  // ADD/SUB side effect is visible before STR

    str x25, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x8, x22, #32, #5       // str_rt
    ldr x23, [x14, x8, lsl #3]  // store value after ADD/SUB, so rt==rd is correct
    ubfx x10, x22, #40, #12     // STRB imm12, scaled by 1
    add _addr, x16, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    write_prep 8, fused_addsub_str8_imm_1
    strb w23, [_addr]
    write_done 8, fused_addsub_str8_imm_1
    mov _addr, x24
    gret
    write_bullshit 8, fused_addsub_str8_imm_1

/*
 * Fused LDR Xt, [Xn, #imm] + CBZ/CBNZ Xt.
 * Code stream: [gadget addr][rt | rn<<8 | ldr_imm12<<16][ldr_guest_pc][target][fallthrough]
 * The loaded register is stored before branching. LOCAL_jit_saved_pc is set to
 * the LDR PC before the faultable access so guest signals report the load.
 */
.gadget fused_ldr64_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5        // rn
    ubfx x10, x22, #16, #12     // imm12, scaled by 8
    lsl x10, x10, #3
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 64, fused_ldr64_cbz_imm_1
    ldr _tmp, [_addr]

    and x8, x22, #0x1f          // rt
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbz _tmp, fused_ldr64_cbz_taken
fused_ldr64_cbz_not_taken:
    tbnz x26, #63, fused_ldr64_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_cbz_taken:
    tbnz x25, #63, fused_ldr64_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr64_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 64, fused_ldr64_cbz_imm_1

.gadget fused_ldr64_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #12
    lsl x10, x10, #3
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 64, fused_ldr64_cbnz_imm_1
    ldr _tmp, [_addr]

    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz _tmp, fused_ldr64_cbnz_taken
fused_ldr64_cbnz_not_taken:
    tbnz x26, #63, fused_ldr64_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_cbnz_taken:
    tbnz x25, #63, fused_ldr64_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr64_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 64, fused_ldr64_cbnz_imm_1

/*
 * Fused LDR Xt, [SP, #imm] + CBZ/CBNZ Xt.
 * Code stream: [gadget addr][rt | ldr_imm12<<16][ldr_guest_pc][target][fallthrough]
 * This is the SP-base counterpart to the non-SP LDR64+CBZ/CBNZ fusion. The
 * loaded register is stored before branching. LOCAL_jit_saved_pc is set to the
 * LDR PC before the faultable access so guest signals report the load.
 */
.gadget fused_ldr64_sp_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x10, x22, #16, #12     // imm12, scaled by 8
    lsl x10, x10, #3
    ldr x12, [_cpu, #CPU_sp]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 64, fused_ldr64_sp_cbz_imm_1
    ldr _tmp, [_addr]

    and x8, x22, #0x1f          // rt, guaranteed != 31
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbz _tmp, fused_ldr64_sp_cbz_taken
fused_ldr64_sp_cbz_not_taken:
    tbnz x26, #63, fused_ldr64_sp_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_sp_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_sp_cbz_taken:
    tbnz x25, #63, fused_ldr64_sp_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr64_sp_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 64, fused_ldr64_sp_cbz_imm_1

.gadget fused_ldr64_sp_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x10, x22, #16, #12
    lsl x10, x10, #3
    ldr x12, [_cpu, #CPU_sp]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 64, fused_ldr64_sp_cbnz_imm_1
    ldr _tmp, [_addr]

    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz _tmp, fused_ldr64_sp_cbnz_taken
fused_ldr64_sp_cbnz_not_taken:
    tbnz x26, #63, fused_ldr64_sp_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_sp_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr64_sp_cbnz_taken:
    tbnz x25, #63, fused_ldr64_sp_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr64_sp_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 64, fused_ldr64_sp_cbnz_imm_1

/*
 * Fused LDR Wt, [Xn, #imm] + CBZ/CBNZ Wt.
 * Code stream: [gadget addr][rt | rn<<8 | ldr_imm12<<16][ldr_guest_pc][target][fallthrough]
 * The loaded register is zero-extended and stored before branching.
 * LOCAL_jit_saved_pc is set to the LDR PC before the faultable access so guest
 * signals report the load.
 */
.gadget fused_ldr32_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5        // rn
    ubfx x10, x22, #16, #12     // imm12, scaled by 4
    lsl x10, x10, #2
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 32, fused_ldr32_cbz_imm_1
    ldr w0, [_addr]

    and x8, x22, #0x1f          // rt
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]
    mov _addr, x24
    cbz x0, fused_ldr32_cbz_taken
fused_ldr32_cbz_not_taken:
    tbnz x26, #63, fused_ldr32_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_cbz_taken:
    tbnz x25, #63, fused_ldr32_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr32_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 32, fused_ldr32_cbz_imm_1

.gadget fused_ldr32_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #12
    lsl x10, x10, #2
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x9, lsl #3]
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 32, fused_ldr32_cbnz_imm_1
    ldr w0, [_addr]

    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz x0, fused_ldr32_cbnz_taken
fused_ldr32_cbnz_not_taken:
    tbnz x26, #63, fused_ldr32_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_cbnz_taken:
    tbnz x25, #63, fused_ldr32_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr32_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 32, fused_ldr32_cbnz_imm_1

/*
 * Fused LDRSW Xt, [Xn/SP, #imm] + CBZ/CBNZ Xt.
 * Code stream: [gadget addr][rt | rn<<8 | ldr_imm12<<16][ldr_guest_pc][target][fallthrough]
 * The loaded register is sign-extended to 64 bits and stored before branching.
 * LOCAL_jit_saved_pc is set to the LDRSW PC before the faultable access so
 * guest signals report the load.
 */
.gadget fused_ldr32_sx_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDRSW guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5        // rn, 31 means SP
    ubfx x10, x22, #16, #12     // imm12, scaled by 4
    lsl x10, x10, #2
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr32_sx_cbz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr32_sx_cbz_have_base
fused_ldr32_sx_cbz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr32_sx_cbz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 32, fused_ldr32_sx_cbz_imm_1
    ldrsw _tmp, [_addr]

    and x8, x22, #0x1f          // rt, guaranteed != 31
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbz _tmp, fused_ldr32_sx_cbz_taken
fused_ldr32_sx_cbz_not_taken:
    tbnz x26, #63, fused_ldr32_sx_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_sx_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_sx_cbz_taken:
    tbnz x25, #63, fused_ldr32_sx_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr32_sx_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 32, fused_ldr32_sx_cbz_imm_1

.gadget fused_ldr32_sx_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #12
    lsl x10, x10, #2
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr32_sx_cbnz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr32_sx_cbnz_have_base
fused_ldr32_sx_cbnz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr32_sx_cbnz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 32, fused_ldr32_sx_cbnz_imm_1
    ldrsw _tmp, [_addr]

    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz _tmp, fused_ldr32_sx_cbnz_taken
fused_ldr32_sx_cbnz_not_taken:
    tbnz x26, #63, fused_ldr32_sx_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_sx_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr32_sx_cbnz_taken:
    tbnz x25, #63, fused_ldr32_sx_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr32_sx_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 32, fused_ldr32_sx_cbnz_imm_1

/*
 * Fused LDRSB/LDRSH Xt/Wt, [Xn/SP, #imm] + matching CBZ/CBNZ Xt/Wt.
 * Code stream: [gadget addr]
 *              [rt | rn<<8 | ldr_imm12<<16 | size<<28 | extend64<<29]
 *              [ldr_guest_pc][target][fallthrough]
 * size 0 = byte, size 1 = halfword. extend64 selects Xt vs Wt sign-extension
 * and must match the branch width. LOCAL_jit_saved_pc is set to the load PC
 * before the faultable access so guest signals report the load.
 */
.gadget fused_ldr_sx_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDRSB/LDRSH guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5        // rn, 31 means SP
    ubfx x10, x22, #16, #12     // imm12, scaled by size
    tbz x22, #28, fused_ldr_sx_cbz_unscaled
    lsl x10, x10, #1
fused_ldr_sx_cbz_unscaled:
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr_sx_cbz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr_sx_cbz_have_base
fused_ldr_sx_cbz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr_sx_cbz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    tbnz x22, #28, fused_ldr_sx_cbz_load16
fused_ldr_sx_cbz_load8:
    read_prep 8, fused_ldr_sx_cbz_imm_8
    tbnz x22, #29, fused_ldr_sx_cbz_load8_64
    ldrsb w0, [_addr]
    b fused_ldr_sx_cbz_after_load
fused_ldr_sx_cbz_load8_64:
    ldrsb _tmp, [_addr]
    b fused_ldr_sx_cbz_after_load
fused_ldr_sx_cbz_load16:
    read_prep 16, fused_ldr_sx_cbz_imm_16
    tbnz x22, #29, fused_ldr_sx_cbz_load16_64
    ldrsh w0, [_addr]
    b fused_ldr_sx_cbz_after_load
fused_ldr_sx_cbz_load16_64:
    ldrsh _tmp, [_addr]

fused_ldr_sx_cbz_after_load:
    and x8, x22, #0x1f          // rt, guaranteed != 31
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbz _tmp, fused_ldr_sx_cbz_taken
fused_ldr_sx_cbz_not_taken:
    tbnz x26, #63, fused_ldr_sx_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr_sx_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr_sx_cbz_taken:
    tbnz x25, #63, fused_ldr_sx_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr_sx_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 8, fused_ldr_sx_cbz_imm_8
    read_bullshit 16, fused_ldr_sx_cbz_imm_16

.gadget fused_ldr_sx_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #12
    tbz x22, #28, fused_ldr_sx_cbnz_unscaled
    lsl x10, x10, #1
fused_ldr_sx_cbnz_unscaled:
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr_sx_cbnz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr_sx_cbnz_have_base
fused_ldr_sx_cbnz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr_sx_cbnz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    tbnz x22, #28, fused_ldr_sx_cbnz_load16
fused_ldr_sx_cbnz_load8:
    read_prep 8, fused_ldr_sx_cbnz_imm_8
    tbnz x22, #29, fused_ldr_sx_cbnz_load8_64
    ldrsb w0, [_addr]
    b fused_ldr_sx_cbnz_after_load
fused_ldr_sx_cbnz_load8_64:
    ldrsb _tmp, [_addr]
    b fused_ldr_sx_cbnz_after_load
fused_ldr_sx_cbnz_load16:
    read_prep 16, fused_ldr_sx_cbnz_imm_16
    tbnz x22, #29, fused_ldr_sx_cbnz_load16_64
    ldrsh w0, [_addr]
    b fused_ldr_sx_cbnz_after_load
fused_ldr_sx_cbnz_load16_64:
    ldrsh _tmp, [_addr]

fused_ldr_sx_cbnz_after_load:
    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str _tmp, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz _tmp, fused_ldr_sx_cbnz_taken
fused_ldr_sx_cbnz_not_taken:
    tbnz x26, #63, fused_ldr_sx_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr_sx_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr_sx_cbnz_taken:
    tbnz x25, #63, fused_ldr_sx_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr_sx_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 8, fused_ldr_sx_cbnz_imm_8
    read_bullshit 16, fused_ldr_sx_cbnz_imm_16

/*
 * Fused LDRH Wt, [Xn, #imm] + CBZ/CBNZ Wt.
 * Code stream: [gadget addr][rt | rn<<8 | ldr_imm12<<16][ldr_guest_pc][target][fallthrough]
 * The loaded register is zero-extended and stored before branching.
 * LOCAL_jit_saved_pc is set to the LDRH PC before the faultable access so
 * guest signals report the load.
 */
.gadget fused_ldr16_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5        // rn
    ubfx x10, x22, #16, #12     // imm12, scaled by 2
    lsl x10, x10, #1
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr16_cbz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr16_cbz_have_base
fused_ldr16_cbz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr16_cbz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 16, fused_ldr16_cbz_imm_1
    ldrh w0, [_addr]

    and x8, x22, #0x1f          // rt
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]
    mov _addr, x24
    cbz x0, fused_ldr16_cbz_taken
fused_ldr16_cbz_not_taken:
    tbnz x26, #63, fused_ldr16_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr16_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr16_cbz_taken:
    tbnz x25, #63, fused_ldr16_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr16_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 16, fused_ldr16_cbz_imm_1

.gadget fused_ldr16_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #12
    lsl x10, x10, #1
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr16_cbnz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr16_cbnz_have_base
fused_ldr16_cbnz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr16_cbnz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 16, fused_ldr16_cbnz_imm_1
    ldrh w0, [_addr]

    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz x0, fused_ldr16_cbnz_taken
fused_ldr16_cbnz_not_taken:
    tbnz x26, #63, fused_ldr16_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr16_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr16_cbnz_taken:
    tbnz x25, #63, fused_ldr16_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr16_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 16, fused_ldr16_cbnz_imm_1

/*
 * Fused LDRB Wt, [Xn, #imm] + CBZ/CBNZ Wt.
 * Code stream: [gadget addr][rt | rn<<8 | ldr_imm12<<16][ldr_guest_pc][target][fallthrough]
 * The loaded register is zero-extended and stored before branching.
 * LOCAL_jit_saved_pc is set to the LDRB PC before the faultable access so
 * guest signals report the load.
 */
.gadget fused_ldr8_cbz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // precise LDR guest PC
    ldr x25, [_pc, #16]         // target (fake_ip or chained)
    ldr x26, [_pc, #24]         // fallthrough (fake_ip or chained)
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5        // rn
    ubfx x10, x22, #16, #12     // imm12, scaled by 1
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr8_cbz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr8_cbz_have_base
fused_ldr8_cbz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr8_cbz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 8, fused_ldr8_cbz_imm_1
    ldrb w0, [_addr]

    and x8, x22, #0x1f          // rt
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]
    mov _addr, x24
    cbz x0, fused_ldr8_cbz_taken
fused_ldr8_cbz_not_taken:
    tbnz x26, #63, fused_ldr8_cbz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr8_cbz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr8_cbz_taken:
    tbnz x25, #63, fused_ldr8_cbz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr8_cbz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 8, fused_ldr8_cbz_imm_1

.gadget fused_ldr8_cbnz_imm
    ldr x22, [_pc]
    ldr x23, [_pc, #8]
    ldr x25, [_pc, #16]
    ldr x26, [_pc, #24]
    add _pc, _pc, #32

    str x23, [_cpu, #LOCAL_jit_saved_pc]
    ubfx x9, x22, #8, #5
    ubfx x10, x22, #16, #12
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq fused_ldr8_cbnz_sp_base
    ldr x12, [x11, x9, lsl #3]
    b fused_ldr8_cbnz_have_base
fused_ldr8_cbnz_sp_base:
    ldr x12, [_cpu, #CPU_sp]
fused_ldr8_cbnz_have_base:
    add _addr, x12, x10
    and _addr, _addr, #0xffffffffffff
    mov x24, _addr

    read_prep 8, fused_ldr8_cbnz_imm_1
    ldrb w0, [_addr]

    and x8, x22, #0x1f
    add x11, _cpu, #CPU_x0
    str x0, [x11, x8, lsl #3]
    mov _addr, x24
    cbnz x0, fused_ldr8_cbnz_taken
fused_ldr8_cbnz_not_taken:
    tbnz x26, #63, fused_ldr8_cbnz_nt_unchained
    mov _pc, x26
    b fiber_ret_chain
fused_ldr8_cbnz_nt_unchained:
    and x11, x26, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x26
    b fiber_ret_chain
fused_ldr8_cbnz_taken:
    tbnz x25, #63, fused_ldr8_cbnz_t_unchained
    mov _pc, x25
    b fiber_ret_chain
fused_ldr8_cbnz_t_unchained:
    and x11, x25, #0xffffffffffff
    str x11, [_cpu, #CPU_pc]
    mov _pc, x25
    b fiber_ret_chain
    read_bullshit 8, fused_ldr8_cbnz_imm_1

/*
 * Fused ADRP+ADD gadget
 * When ADRP Xd, #page is immediately followed by ADD Xd, Xd, #imm12,
 * we compute the final address directly without intermediate register writes.
 * Code stream: [gadget addr][rd(0:4) | imm12(8:19)][adrp_target (48-bit)]
 */
.gadget fused_adrp_add
    ldr x22, [_pc]
    ldr x23, [_pc, #8]          // adrp_target (48-bit)
    add _pc, _pc, #16

    // Compute final address = adrp_target + imm12
    ubfx x10, x22, #8, #12      // imm12
    add x8, x23, x10
    and x8, x8, #0xffffffffffff

    // Store to rd
    and x9, x22, #0x1f          // rd
    add x11, _cpu, #CPU_x0
    str x8, [x11, x9, lsl #3]
    gret

/*
 * Interleaved SIMD load/store gadgets (LD2/LD3/LD4, ST2/ST3/ST4)
 * These call C helper functions for the deinterleaving/interleaving logic.
 * Code stream: [gadget addr][rt | (num_regs<<8) | (elem_size<<16) | (Q<<24)]
 * _addr must contain the guest base address.
 */

.gadget simd_load_interleaved
    ldr x22, [_pc]
    add _pc, _pc, #8
    mov x23, _addr              // save address

    save_c
    mov x0, _cpu                // cpu
    sub x1, _tlb, #TLB_entries  // tlb (base pointer)
    mov x2, x23                 // addr
    and w3, w22, #0xff          // rt
    ubfx w4, w22, #8, #8        // num_regs
    ubfx w5, w22, #16, #8       // elem_size
    ubfx w6, w22, #24, #8       // Q
    bl NAME(c_simd_load_interleaved)
    mov w19, w0
    restore_c
    mov _addr, x23              // restore _addr

    cbnz w19, simd_interleaved_read_segfault
    gret

simd_interleaved_read_segfault:
    str x23, [_cpu, #CPU_segfault_addr]
    strb wzr, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

.gadget simd_store_interleaved
    ldr x22, [_pc]
    add _pc, _pc, #8
    mov x23, _addr              // save address

    save_c
    mov x0, _cpu                // cpu
    sub x1, _tlb, #TLB_entries  // tlb (base pointer)
    mov x2, x23                 // addr
    and w3, w22, #0xff          // rt
    ubfx w4, w22, #8, #8        // num_regs
    ubfx w5, w22, #16, #8       // elem_size
    ubfx w6, w22, #24, #8       // Q
    bl NAME(c_simd_store_interleaved)
    mov w19, w0
    restore_c
    mov _addr, x23              // restore _addr

    cbnz w19, simd_interleaved_write_segfault
    gret

simd_interleaved_write_segfault:
    str x23, [_cpu, #CPU_segfault_addr]
    mov w8, #1
    strb w8, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

/*
 * Address manipulation gadgets
 */

// Advance _addr by immediate value
// Code stream: [gadget addr][imm]
.gadget advance_addr
    ldr x8, [_pc]
    add _pc, _pc, #8
    add _addr, _addr, x8
    gret

// Update base register from another register (for post-indexed addressing)
// Code stream: [gadget addr][rn | rm<<8]
.gadget update_base_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn (base register to update)
    ubfx x10, x8, #8, #5    // rm (offset register)

    // Load offset from Rm
    add x11, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x12, [x11, x10, lsl #3]
    b 2f
1:  mov x12, #0
2:
    // Load current base and update
    cmp x9, #31
    b.eq 3f
    ldr x13, [x11, x9, lsl #3]
    add x13, x13, x12
    and x13, x13, #0xffffffffffff
    str x13, [x11, x9, lsl #3]
    gret
3:  // Update SP
    ldr x13, [_cpu, #CPU_sp]
    add x13, x13, x12
    and x13, x13, #0xffffffffffff
    str x13, [_cpu, #CPU_sp]
    gret

/*
 * Advance _addr by immediate
 * Code stream: [gadget addr][imm]
 * Used between multi-element single-structure load/stores (LD2/ST2/LD3/ST3/LD4/ST4)
 */
.gadget addr_add_imm
    ldr x8, [_pc]
    add _pc, _pc, #8
    add _addr, _addr, x8
    and _addr, _addr, #0xffffffffffff
    gret

/*
 * LD1/ST1 Single Structure Gadgets
 *
 * These load/store a single element from memory to/from a specific lane
 * within a vector register.
 *
 * Code stream: [gadget addr][rt | (lane_offset << 8)]
 *   rt: vector register index (0-31)
 *   lane_offset: byte offset within the vector (0-15)
 *
 * Address should already be in _addr (x7)
 */

/*
 * LD1 {Vt.B}[lane], [Xn] - Load single byte to vector lane
 */
.gadget ld1_single_b
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt (vector reg index)
    ubfx x25, x22, #8, #8       // lane_offset (byte offset)

    mov x24, _addr              // Save guest address
    read_prep 8, ld1_single_b_1
    ldrb w11, [_addr]

    // Calculate address of byte within vector
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4            // each V reg is 16 bytes
    add x9, x9, x10             // base of vector
    add x9, x9, x25             // add lane offset
    strb w11, [x9]              // store byte to lane
    mov _addr, x24
    gret
    read_bullshit 8, ld1_single_b_1

/*
 * LD1 {Vt.H}[lane], [Xn] - Load single halfword to vector lane
 */
.gadget ld1_single_h
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f
    ubfx x25, x22, #8, #8

    mov x24, _addr
    read_prep 16, ld1_single_h_1
    ldrh w11, [_addr]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    strh w11, [x9]
    mov _addr, x24
    gret
    read_bullshit 16, ld1_single_h_1

/*
 * LD1 {Vt.S}[lane], [Xn] - Load single word to vector lane
 */
.gadget ld1_single_s
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f
    ubfx x25, x22, #8, #8

    mov x24, _addr
    read_prep 32, ld1_single_s_1
    ldr w11, [_addr]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    str w11, [x9]
    mov _addr, x24
    gret
    read_bullshit 32, ld1_single_s_1

/*
 * LD1 {Vt.D}[lane], [Xn] - Load single doubleword to vector lane
 */
.gadget ld1_single_d
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f
    ubfx x25, x22, #8, #8

    mov x24, _addr
    read_prep 64, ld1_single_d_1
    ldr x11, [_addr]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    str x11, [x9]
    mov _addr, x24
    gret
    read_bullshit 64, ld1_single_d_1

/*
 * LD1R {Vt.T}, [Xn] - Load single element and replicate to all lanes
 *
 * Code stream: [gadget addr][rt | (size << 8) | (Q << 16)]
 *   rt: vector register index (0-31)
 *   size: element size (0=B, 1=H, 2=S, 3=D)
 *   Q: 0=64-bit (lower half), 1=128-bit (full vector)
 *
 * Address should already be in _addr (x7) from calc_addr_imm
 */
.gadget ld1r_vec
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt (vector reg index)
    ubfx x25, x22, #8, #8       // size (0=B, 1=H, 2=S, 3=D)
    ubfx x26, x22, #16, #8      // Q

    mov x24, _addr              // Save guest address

    // Dispatch on element size for read_prep and load
    cmp x25, #0
    b.eq ld1r_byte
    cmp x25, #1
    b.eq ld1r_half
    cmp x25, #2
    b.eq ld1r_word
    // else: doubleword

ld1r_dword:
    read_prep 64, ld1r_dword_1
    ldr x11, [_addr]
    dup v0.2d, x11
    b ld1r_store

    read_bullshit 64, ld1r_dword_1

ld1r_word:
    read_prep 32, ld1r_word_1
    ldr w11, [_addr]
    dup v0.4s, w11
    b ld1r_store

    read_bullshit 32, ld1r_word_1

ld1r_half:
    read_prep 16, ld1r_half_1
    ldrh w11, [_addr]
    dup v0.8h, w11
    b ld1r_store

    read_bullshit 16, ld1r_half_1

ld1r_byte:
    read_prep 8, ld1r_byte_1
    ldrb w11, [_addr]
    dup v0.16b, w11
    b ld1r_store

    read_bullshit 8, ld1r_byte_1

ld1r_store:
    // Store replicated vector to cpu->fp[rt]
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4            // each V reg is 16 bytes
    add x9, x9, x10

    cbz x26, ld1r_store_64
    // Q=1: store full 128-bit vector
    str q0, [x9]
    mov _addr, x24
    gret

ld1r_store_64:
    // Q=0: store lower 64 bits, zero upper 64 bits
    str d0, [x9]
    str xzr, [x9, #8]           // zero upper 64 bits
    mov _addr, x24
    gret

/*
 * LD2R {Vt.T, Vt2.T}, [Xn] - Load 2 elements and replicate to all lanes
 *
 * Code stream: [gadget addr][rt | (size << 8) | (Q << 16)]
 * Reads 2 consecutive elements, replicates each to Vt and V(t+1) mod 32
 */
.gadget ld2r_vec
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt
    ubfx x25, x22, #8, #8       // size
    ubfx x26, x22, #16, #8      // Q

    mov x24, _addr

    cmp x25, #0
    b.eq ld2r_byte
    cmp x25, #1
    b.eq ld2r_half
    cmp x25, #2
    b.eq ld2r_word

ld2r_dword:
    read_prep 128, ld2r_dword_1
    ldr x11, [_addr]
    ldr x12, [_addr, #8]
    dup v0.2d, x11
    dup v1.2d, x12
    b ld2r_store
    read_bullshit 128, ld2r_dword_1

ld2r_word:
    read_prep 64, ld2r_word_1
    ldr w11, [_addr]
    ldr w12, [_addr, #4]
    dup v0.4s, w11
    dup v1.4s, w12
    b ld2r_store
    read_bullshit 64, ld2r_word_1

ld2r_half:
    read_prep 32, ld2r_half_1
    ldrh w11, [_addr]
    ldrh w12, [_addr, #2]
    dup v0.8h, w11
    dup v1.8h, w12
    b ld2r_store
    read_bullshit 32, ld2r_half_1

ld2r_byte:
    read_prep 16, ld2r_byte_1
    ldrb w11, [_addr]
    ldrb w12, [_addr, #1]
    dup v0.16b, w11
    dup v1.16b, w12
    b ld2r_store
    read_bullshit 16, ld2r_byte_1

ld2r_store:
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    // rt2 = (rt + 1) % 32
    add x14, x23, #1
    and x14, x14, #0x1f
    add x15, _cpu, #CPU_fp
    lsl x14, x14, #4
    add x15, x15, x14

    cbz x26, ld2r_store_64
    str q0, [x9]
    str q1, [x15]
    mov _addr, x24
    gret

ld2r_store_64:
    str d0, [x9]
    str xzr, [x9, #8]
    str d1, [x15]
    str xzr, [x15, #8]
    mov _addr, x24
    gret

/*
 * LD3R {Vt.T, Vt2.T, Vt3.T}, [Xn] - Load 3 elements and replicate
 */
.gadget ld3r_vec
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt
    ubfx x25, x22, #8, #8       // size
    ubfx x26, x22, #16, #8      // Q

    mov x24, _addr

    cmp x25, #0
    b.eq ld3r_byte
    cmp x25, #1
    b.eq ld3r_half
    cmp x25, #2
    b.eq ld3r_word

ld3r_dword:
    read_prep 192, ld3r_dword_1
    ldr x11, [_addr]
    ldr x12, [_addr, #8]
    ldr x13, [_addr, #16]
    dup v0.2d, x11
    dup v1.2d, x12
    dup v2.2d, x13
    b ld3r_store
    read_bullshit 192, ld3r_dword_1

ld3r_word:
    read_prep 96, ld3r_word_1
    ldr w11, [_addr]
    ldr w12, [_addr, #4]
    ldr w13, [_addr, #8]
    dup v0.4s, w11
    dup v1.4s, w12
    dup v2.4s, w13
    b ld3r_store
    read_bullshit 96, ld3r_word_1

ld3r_half:
    read_prep 48, ld3r_half_1
    ldrh w11, [_addr]
    ldrh w12, [_addr, #2]
    ldrh w13, [_addr, #4]
    dup v0.8h, w11
    dup v1.8h, w12
    dup v2.8h, w13
    b ld3r_store
    read_bullshit 48, ld3r_half_1

ld3r_byte:
    read_prep 24, ld3r_byte_1
    ldrb w11, [_addr]
    ldrb w12, [_addr, #1]
    ldrb w13, [_addr, #2]
    dup v0.16b, w11
    dup v1.16b, w12
    dup v2.16b, w13
    b ld3r_store
    read_bullshit 24, ld3r_byte_1

ld3r_store:
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10

    // Calculate rt2 and rt3 offsets
    add x14, x23, #1
    and x14, x14, #0x1f
    add x15, x23, #2
    and x15, x15, #0x1f

    add x16, _cpu, #CPU_fp
    add x17, _cpu, #CPU_fp
    lsl x14, x14, #4
    lsl x15, x15, #4
    add x16, x16, x14
    add x17, x17, x15

    cbz x26, ld3r_store_64
    str q0, [x9]
    str q1, [x16]
    str q2, [x17]
    mov _addr, x24
    gret

ld3r_store_64:
    str d0, [x9]
    str xzr, [x9, #8]
    str d1, [x16]
    str xzr, [x16, #8]
    str d2, [x17]
    str xzr, [x17, #8]
    mov _addr, x24
    gret

/*
 * LD4R {Vt.T, Vt2.T, Vt3.T, Vt4.T}, [Xn] - Load 4 elements and replicate
 */
.gadget ld4r_vec
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt
    ubfx x25, x22, #8, #8       // size
    ubfx x26, x22, #16, #8      // Q

    mov x24, _addr

    cmp x25, #0
    b.eq ld4r_byte
    cmp x25, #1
    b.eq ld4r_half
    cmp x25, #2
    b.eq ld4r_word

ld4r_dword:
    read_prep 256, ld4r_dword_1
    ldr x11, [_addr]
    ldr x12, [_addr, #8]
    ldr x13, [_addr, #16]
    ldr x14, [_addr, #24]
    dup v0.2d, x11
    dup v1.2d, x12
    dup v2.2d, x13
    dup v3.2d, x14
    b ld4r_store
    read_bullshit 256, ld4r_dword_1

ld4r_word:
    read_prep 128, ld4r_word_1
    ldr w11, [_addr]
    ldr w12, [_addr, #4]
    ldr w13, [_addr, #8]
    ldr w14, [_addr, #12]
    dup v0.4s, w11
    dup v1.4s, w12
    dup v2.4s, w13
    dup v3.4s, w14
    b ld4r_store
    read_bullshit 128, ld4r_word_1

ld4r_half:
    read_prep 64, ld4r_half_1
    ldrh w11, [_addr]
    ldrh w12, [_addr, #2]
    ldrh w13, [_addr, #4]
    ldrh w14, [_addr, #6]
    dup v0.8h, w11
    dup v1.8h, w12
    dup v2.8h, w13
    dup v3.8h, w14
    b ld4r_store
    read_bullshit 64, ld4r_half_1

ld4r_byte:
    read_prep 32, ld4r_byte_1
    ldrb w11, [_addr]
    ldrb w12, [_addr, #1]
    ldrb w13, [_addr, #2]
    ldrb w14, [_addr, #3]
    dup v0.16b, w11
    dup v1.16b, w12
    dup v2.16b, w13
    dup v3.16b, w14
    b ld4r_store
    read_bullshit 32, ld4r_byte_1

ld4r_store:
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10

    // Calculate rt2, rt3, rt4 offsets
    add x10, x23, #1
    and x10, x10, #0x1f
    add x11, x23, #2
    and x11, x11, #0x1f
    add x12, x23, #3
    and x12, x12, #0x1f

    lsl x10, x10, #4
    lsl x11, x11, #4
    lsl x12, x12, #4
    add x10, x10, _cpu
    add x11, x11, _cpu
    add x12, x12, _cpu
    add x10, x10, #CPU_fp
    add x11, x11, #CPU_fp
    add x12, x12, #CPU_fp

    cbz x26, ld4r_store_64
    str q0, [x9]
    str q1, [x10]
    str q2, [x11]
    str q3, [x12]
    mov _addr, x24
    gret

ld4r_store_64:
    str d0, [x9]
    str xzr, [x9, #8]
    str d1, [x10]
    str xzr, [x10, #8]
    str d2, [x11]
    str xzr, [x11, #8]
    str d3, [x12]
    str xzr, [x12, #8]
    mov _addr, x24
    gret

/*
 * ST1 {Vt.B}[lane], [Xn] - Store single byte from vector lane
 */
.gadget st1_single_b
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt
    ubfx x25, x22, #8, #8       // lane_offset

    // Load byte from vector lane
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    ldrb w11, [x9]

    mov x24, _addr
    write_prep 8, st1_single_b_1
    strb w11, [_addr]
    write_done 8, st1_single_b_1
    mov _addr, x24
    gret
    write_bullshit 8, st1_single_b_1

/*
 * ST1 {Vt.H}[lane], [Xn] - Store single halfword from vector lane
 */
.gadget st1_single_h
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f
    ubfx x25, x22, #8, #8

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    ldrh w11, [x9]

    mov x24, _addr
    write_prep 16, st1_single_h_1
    strh w11, [_addr]
    write_done 16, st1_single_h_1
    mov _addr, x24
    gret
    write_bullshit 16, st1_single_h_1

/*
 * ST1 {Vt.S}[lane], [Xn] - Store single word from vector lane
 */
.gadget st1_single_s
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f
    ubfx x25, x22, #8, #8

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    ldr w11, [x9]

    mov x24, _addr
    write_prep 32, st1_single_s_1
    str w11, [_addr]
    write_done 32, st1_single_s_1
    mov _addr, x24
    gret
    write_bullshit 32, st1_single_s_1

/*
 * ST1 {Vt.D}[lane], [Xn] - Store single doubleword from vector lane
 */
.gadget st1_single_d
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f
    ubfx x25, x22, #8, #8

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    add x9, x9, x25
    ldr x11, [x9]

    mov x24, _addr
    write_prep 64, st1_single_d_1
    str x11, [_addr]
    write_done 64, st1_single_d_1
    mov _addr, x24
    gret
    write_bullshit 64, st1_single_d_1

/*
 * LDXR — Load exclusive with exclusive monitor save
 * Code stream: [gadget addr][rt | (size << 8)]
 * Expects _addr = guest address (from calc_addr_imm)
 * Loads value, saves addr+value to cpu excl_addr/excl_val, stores to Rt
 */
.gadget ldxr
    ldr x22, [_pc]
    add _pc, _pc, #8

    and x23, x22, #0x1f        // rt
    ubfx x11, x22, #8, #2      // size (0=8b, 1=16b, 2=32b, 3=64b)

    mov x24, _addr

    // Use an access-size-matched TLB prep/cross-page path.
    cmp x11, #3
    b.eq ldxr_load64
    cmp x11, #2
    b.eq ldxr_load32
    cmp x11, #1
    b.eq ldxr_load16

    // size 0: 8-bit
    read_prep 8, ldxr_8
    ldrb w0, [_addr]
    b ldxr_done

ldxr_load16:
    read_prep 16, ldxr_16
    ldrh w0, [_addr]
    b ldxr_done

ldxr_load32:
    read_prep 32, ldxr_32
    ldr w0, [_addr]
    b ldxr_done

ldxr_load64:
    read_prep 64, ldxr_64
    ldr x0, [_addr]

ldxr_done:
    mov _addr, x24              // restore _addr

    // Save to exclusive monitor
    str _addr, [_cpu, #CPU_excl_addr]
    str _tmp, [_cpu, #CPU_excl_val]    // _tmp = x0 = loaded value
    movn x8, #0
    str x8, [_cpu, #CPU_excl_pair_addr]
    str wzr, [_cpu, #CPU_excl_pair_size]

    // Store to Rt (unless Rt == 31 / XZR)
    cmp x23, #31
    b.eq 1f
    add x9, _cpu, #CPU_x0
    str _tmp, [x9, x23, lsl #3]
1:  gret

    read_bullshit 8, ldxr_8
    read_bullshit 16, ldxr_16
    read_bullshit 32, ldxr_32
    read_bullshit 64, ldxr_64

/*
 * STXR — Store exclusive via atomic CAS
 * Code stream: [gadget addr][rt | (rs << 8) | (size << 16)]
 * Expects _addr = guest address (from calc_addr_imm)
 * Checks excl_addr match, does atomic CAS, stores result to Rs
 */
.gadget stxr
    ldr x22, [_pc]
    add _pc, _pc, #8

    and x23, x22, #0x1f         // rt (new value register)
    ubfx x25, x22, #8, #5       // rs (status result register)
    ubfx x26, x22, #16, #2      // size

    mov x24, _addr               // save guest address

    // Check exclusive monitor: does excl_addr match current address?
    ldr x8, [_cpu, #CPU_excl_addr]
    cmp x8, _addr
    b.ne stxr_fail               // mismatch -> fail

    // Load the new value from Rt
    add x12, _cpu, #CPU_x0
    cmp x23, #31
    b.eq 1f
    ldr x13, [x12, x23, lsl #3]
    b 2f
1:  mov x13, #0                  // XZR
2:
    // Load expected value from exclusive monitor
    ldr x14, [_cpu, #CPU_excl_val]

    // Call C helper: c_stxr_cas(tlb, addr, expected_val, new_val, size)
    save_c
    sub x0, _tlb, #TLB_entries   // tlb struct pointer
    mov x1, x24                  // guest address
    mov x2, x14                  // expected value (from LDXR)
    mov x3, x13                  // new value (from Rt)
    mov w4, w26                  // size
    bl NAME(c_stxr_cas)
    mov w19, w0                  // save result (0=success, 1=fail, -1=segfault)
    restore_c
    mov _addr, x24               // restore _addr

    // Check for segfault
    cmn w19, #1
    b.eq stxr_segfault

    // Invalidate exclusive monitor
    movn x8, #0
    str x8, [_cpu, #CPU_excl_addr]

    // Store result to Rs (w19 = 0 or 1)
    cmp x25, #31
    b.eq 3f                      // Rs == XZR, discard
    add x9, _cpu, #CPU_x0
    and x8, x19, #0xff          // zero-extend w19 to 64-bit
    str x8, [x9, x25, lsl #3]   // store to Rs
3:  gret

stxr_fail:
    // Exclusive monitor mismatch — store failed
    movn x8, #0
    str x8, [_cpu, #CPU_excl_addr]
    cmp x25, #31
    b.eq 4f
    add x9, _cpu, #CPU_x0
    mov x8, #1
    str x8, [x9, x25, lsl #3]   // Rs = 1 (failure)
4:  gret

stxr_segfault:
    // Invalidate exclusive monitor
    movn x8, #0
    str x8, [_cpu, #CPU_excl_addr]
    str x24, [_cpu, #CPU_segfault_addr]
    mov w8, #1
    strb w8, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

/*
 * LDXP via C helper — avoids assembly TLB for pair exclusive loads.
 * Code stream: [gadget addr][rt | (rt2 << 8) | (size << 16)]
 * Expects _addr = guest address (from calc_addr_imm)
 */
.gadget ldxp_c
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rt
    ubfx x25, x22, #8, #5       // rt2
    ubfx x26, x22, #16, #2      // size
    mov x24, _addr               // save guest address

    save_c
    sub sp, sp, #16              // allocate stack space for outputs
    sub x0, _tlb, #TLB_entries   // tlb struct pointer
    mov x1, x24                  // guest address
    mov x2, sp                   // val1 output
    add x3, sp, #8               // val2 output
    cmp x26, #3
    b.eq ldxp_c_64
    bl NAME(c_ldp32)
    mov w19, w0                  // save result
    ldr w20, [sp]                // val1 (32-bit LDXP zero-extends)
    ldr w21, [sp, #8]            // val2 (32-bit LDXP zero-extends)
    b ldxp_c_done
ldxp_c_64:
    bl NAME(c_ldp64)
    mov w19, w0                  // save result
    ldr x20, [sp]                // val1
    ldr x21, [sp, #8]            // val2
ldxp_c_done:
    add sp, sp, #16
    restore_c
    mov _addr, x24               // restore _addr

    // Check for segfault
    cmn w19, #1
    b.eq ldxp_c_segfault

    // Save pair exclusive monitor state
    str x24, [_cpu, #CPU_excl_pair_addr]
    str x20, [_cpu, #CPU_excl_pair_val_lo]
    str x21, [_cpu, #CPU_excl_pair_val_hi]
    str w26, [_cpu, #CPU_excl_pair_size]
    movn x8, #0
    str x8, [_cpu, #CPU_excl_addr]

    // Store to Rt
    add x9, _cpu, #CPU_x0
    cmp x23, #31
    b.eq 1f
    str x20, [x9, x23, lsl #3]
1:  cmp x25, #31
    b.eq 2f
    str x21, [x9, x25, lsl #3]
2:  gret

ldxp_c_segfault:
    str x24, [_cpu, #CPU_segfault_addr]
    strb wzr, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

/*
 * STXP/STLXP via C helper.
 * Code stream: [gadget addr][rs | (rt << 8) | (rt2 << 16) | (size << 24)]
 * Expects _addr = guest address (from calc_addr_imm)
 */
.gadget stxp_c
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rs (status result)
    ubfx x24, x22, #8, #5       // rt (new lo)
    ubfx x25, x22, #16, #5      // rt2 (new hi)
    ubfx x26, x22, #24, #2      // size
    mov x27, _addr              // save guest address

    // Load new values from guest regs
    add x9, _cpu, #CPU_x0
    cmp x24, #31
    b.eq 1f
    ldr x20, [x9, x24, lsl #3]
    b 2f
1:  mov x20, #0
2:  cmp x25, #31
    b.eq 3f
    ldr x21, [x9, x25, lsl #3]
    b 4f
3:  mov x21, #0
4:
    // Check exclusive monitor state from the preceding LDXP/LDAXP
    ldr x10, [_cpu, #CPU_excl_pair_addr]
    ldr w11, [_cpu, #CPU_excl_pair_size]
    cmp x10, x27
    b.ne stxp_c_fail
    cmp w11, w26
    b.ne stxp_c_fail

    // Call C helper: c_stxp_pair(tlb, addr, old_lo, old_hi, new_lo, new_hi, size)
    ldr x19, [_cpu, #CPU_excl_pair_val_lo]
    ldr x22, [_cpu, #CPU_excl_pair_val_hi]
    save_c
    sub x0, _tlb, #TLB_entries
    mov x1, x27
    mov x2, x19
    mov x3, x22
    mov x4, x20
    mov x5, x21
    mov w6, w26
    bl NAME(c_stxp_pair)
    mov w19, w0
    restore_c
    mov _addr, x27

    // Invalidate pair exclusive monitor after the attempt
    movn x8, #0
    str x8, [_cpu, #CPU_excl_pair_addr]
    str wzr, [_cpu, #CPU_excl_pair_size]

    cmn w19, #1
    b.eq stxp_c_segfault

    // Store status to Rs (0=success, 1=failure)
    add x9, _cpu, #CPU_x0
    cmp x23, #31
    b.eq 6f
    and x8, x19, #0xffffffff
    str x8, [x9, x23, lsl #3]
6:  gret

stxp_c_fail:
    movn x8, #0
    str x8, [_cpu, #CPU_excl_pair_addr]
    str wzr, [_cpu, #CPU_excl_pair_size]
    add x9, _cpu, #CPU_x0
    cmp x23, #31
    b.eq 7f
    mov x8, #1
    str x8, [x9, x23, lsl #3]
7:  gret

stxp_c_segfault:
    str x27, [_cpu, #CPU_segfault_addr]
    mov w8, #1
    strb w8, [_cpu, #CPU_segfault_was_write]
    mov w0, #INT_GPF
    b fiber_exit

// 32-bit CASP (sz=0): an 8-byte atomic over the {Ws,W(s+1)} / {Wt,W(t+1)}
// register pairs. Ws is the low word, W(s+1) the high word of a 64-bit value.
// We assemble the two 32-bit halves into 64-bit expected/desired words and do
// a single 8-byte CAS via c_atomic_cas (size=3), then split the old value back
// into Ws / W(s+1). This is NOT a 128-bit op (that would be the 64-bit CASP).
.gadget atomic_casp32
    ldr x22, [_pc]
    add _pc, _pc, #8
    and x23, x22, #0x1f         // rs
    ubfx x25, x22, #8, #5       // rt
    mov x24, _addr              // save guest address

    add x12, _cpu, #CPU_x0
    // expected = W(s+1):Ws  (Rs=31 => WZR pair = 0). The register file is
    // 8-byte strided, so compute each element's byte address (reg<<3) and do a
    // 32-bit load — `ldr w, [base, reg, lsl #3]` is not a legal addressing mode.
    cmp x23, #31
    b.eq 1f
    add x9, x12, x23, lsl #3      // &Ws
    ldr w13, [x9]                 // exp_lo (Ws, zero-extended)
    ldr w15, [x9, #8]            // exp_hi (W(s+1))
    orr x13, x13, x15, lsl #32
    b 2f
1:  mov x13, #0
2:
    // desired = W(t+1):Wt  (Rt=31 => WZR pair = 0)
    cmp x25, #31
    b.eq 3f
    add x10, x12, x25, lsl #3     // &Wt
    ldr w14, [x10]               // des_lo (Wt)
    ldr w15, [x10, #8]          // des_hi (W(t+1))
    orr x14, x14, x15, lsl #32
    b 4f
3:  mov x14, #0
4:
    sub sp, sp, #16
    save_c
    sub x0, _tlb, #TLB_entries    // tlb
    mov x1, x24                   // guest address
    mov x2, x13                   // expected (packed 64-bit)
    mov x3, x14                   // desired  (packed 64-bit)
    mov w4, #3                    // size = 3 (8 bytes)
    add x5, sp, #0xa0             // &old
    bl NAME(c_atomic_cas)
    mov w19, w0
    restore_c
    mov _addr, x24
    cbnz w19, atomic_casp_segfault
    ldr x20, [sp]                 // old packed value
    add sp, sp, #16

    // Write old value back into Ws, W(s+1) (32-bit writes zero the top half)
    cmp x23, #31
    b.eq 5f
    add x9, _cpu, #CPU_x0
    add x9, x9, x23, lsl #3       // &Ws
    str w20, [x9]                 // Ws = old_lo
    lsr x20, x20, #32
    str w20, [x9, #8]           // W(s+1) = old_hi
5:  gret

