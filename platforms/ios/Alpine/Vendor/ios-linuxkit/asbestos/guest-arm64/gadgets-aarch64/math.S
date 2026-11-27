/*
 * ARM64 Guest Data Processing Gadgets
 *
 * These gadgets implement arithmetic, logical, and move operations.
 * Parameters are packed in the code stream following the gadget address.
 */

#include "gadgets.h"

.text

/*
 * Register load/store helpers
 * These load/store guest registers from/to cpu_state
 */

// Load a guest register into _tmp (x0)
// Code stream: [gadget addr][reg_index]
.gadget load_reg
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f
    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr _tmp, [x9, x8, lsl #3]
    gret
1:  mov _tmp, #0            // XZR
    gret

// Store _tmp (x0) to a guest register
// Code stream: [gadget addr][reg_index]
.gadget store_reg
    ldr x8, [_pc]
    and x8, x8, #0x1f
    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f                 // XZR - discard
    str _tmp, [x9, x8, lsl #3]
1:  add _pc, _pc, #8
    gret

// Store _addr (x7) to guest register - used for writeback in pre/post-indexed addressing
.gadget store_addr_to_reg
    ldr x8, [_pc]
    and x8, x8, #0x1f
    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f                 // XZR/SP - handle specially
    // For regular registers, store 64-bit address (ARM64 guest uses 64-bit addresses)
    str _addr, [x9, x8, lsl #3]
    b 2f
1:  // For x31, update SP (mask to 48 bits)
    and x9, _addr, #0xffffffffffff
    str x9, [_cpu, #CPU_sp]
2:  add _pc, _pc, #8
    gret

/*
 * Move wide immediate (MOVZ, MOVK, MOVN)
 * Code stream: [gadget addr][rd | hw<<8 | imm16<<16 | sf<<32]
 */

// MOVZ - Move wide with zeros
.gadget movz
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #2    // hw
    ubfx x11, x8, #16, #16  // imm16
    ubfx x12, x8, #32, #1   // sf

    // Shift imm16 by hw*16
    lsl x10, x10, #4        // hw * 16
    lsl x11, x11, x10       // imm16 << (hw*16)

    // For 32-bit, zero-extend
    cbz x12, 1f
    b 2f
1:  and x11, x11, #0xffffffff
2:
    // Store to register
    add x13, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 3f
    str x11, [x13, x9, lsl #3]
3:  gret

// MOVK - Move wide with keep
.gadget movk
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #2    // hw
    ubfx x11, x8, #16, #16  // imm16
    ubfx x12, x8, #32, #1   // sf

    // Load current value
    add x13, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 3f
    ldr x14, [x13, x9, lsl #3]

    // For 32-bit operations, only keep lower 32 bits of current value
    cbz x12, 1f
    b 2f
1:  and x14, x14, #0xffffffff
2:

    // Create mask for the 16-bit field
    lsl x10, x10, #4        // hw * 16
    mov x15, #0xffff
    lsl x15, x15, x10       // mask at position
    lsl x11, x11, x10       // value at position

    // Clear and insert
    bic x14, x14, x15
    orr x14, x14, x11

    // For 32-bit, zero-extend result (clear upper 32 bits)
    cbz x12, 4f
    b 5f
4:  and x14, x14, #0xffffffff
5:

    // Store back
    str x14, [x13, x9, lsl #3]
3:  gret

// MOVN - Move wide with NOT
.gadget movn
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #2    // hw
    ubfx x11, x8, #16, #16  // imm16
    ubfx x12, x8, #32, #1   // sf

    lsl x10, x10, #4
    lsl x11, x11, x10
    mvn x11, x11            // NOT

    cbz x12, 1f
    b 2f
1:  and x11, x11, #0xffffffff
2:
    add x13, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 3f
    str x11, [x13, x9, lsl #3]
3:  gret

/*
 * ADR/ADRP - PC-relative address
 * Code stream: [gadget addr][rd(0:4) | target(8:55)]
 * Target is a 48-bit guest address packed in bits 8-55.
 */
.gadget adr
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f          // rd
    ubfx x10, x8, #8, #48      // target (48-bit)
    add x11, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    str x10, [x11, x9, lsl #3]
    gret
1:  gret

/*
 * ADD/SUB immediate
 * Code stream: [gadget addr][rd | rn<<8 | imm12<<16 | sf<<28 | S<<29]
 */
.gadget add_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #12  // imm12
    ubfx x12, x8, #28, #1   // sf (0=32-bit, 1=64-bit)
    ubfx x13, x8, #29, #1   // S (set flags)
    ubfx x17, x8, #30, #1   // sh (0=no shift, 1=LSL #12)

    // Apply shift if sh=1
    cbz x17, 0f
    lsl x11, x11, #12
0:
    // Load Rn (or SP if rn == 31)
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  ldr x15, [_cpu, #CPU_sp]
2:
    // Check if we need to set flags
    cbz x13, add_imm_no_flags

    // ADDS - set flags. Use adds to generate correct NZCV
    cbz x12, add_imm_adds_32
    // 64-bit ADDS
    adds x16, x15, x11
    b add_imm_store_flags

add_imm_adds_32:
    // 32-bit ADDS
    adds w16, w15, w11
    // Result is already zero-extended

add_imm_store_flags:
    store_flags
    b add_imm_store_result

add_imm_no_flags:
    // ADD without flags
    add x16, x15, x11
    cbz x12, 3f
    b add_imm_store_result
3:  and x16, x16, #0xffffffff

add_imm_store_result:
    cmp x9, #31
    b.eq 5f
    str x16, [x14, x9, lsl #3]
    gret
5:  // rd == 31 (XZR or SP)
    cbz x13, 7f             // If not setting flags, write to SP
    gret                    // If setting flags (CMN), discard result
7:  // Mask to 48 bits before writing to SP
    and x16, x16, #0xffffffffffff
    str x16, [_cpu, #CPU_sp]
    gret

.gadget sub_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #12  // imm12
    ubfx x12, x8, #28, #1   // sf (0=32-bit, 1=64-bit)
    ubfx x13, x8, #29, #1   // S (set flags)
    ubfx x17, x8, #30, #1   // sh (0=no shift, 1=LSL #12)

    // Apply shift if sh=1
    cbz x17, 0f
    lsl x11, x11, #12
0:
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  ldr x15, [_cpu, #CPU_sp]
2:
    // Check if we need to set flags
    cbz x13, sub_imm_no_flags

    // SUBS - set flags. Use subs to generate correct NZCV
    cbz x12, sub_imm_subs_32
    // 64-bit SUBS
    subs x16, x15, x11
    b sub_imm_store_flags

sub_imm_subs_32:
    // 32-bit SUBS
    subs w16, w15, w11
    // Result is already zero-extended

sub_imm_store_flags:
    store_flags
    b sub_imm_store_result

sub_imm_no_flags:
    // SUB without flags
    sub x16, x15, x11
    cbz x12, 3f
    b sub_imm_store_result
3:  and x16, x16, #0xffffffff

sub_imm_store_result:
    cmp x9, #31
    b.eq 5f
    str x16, [x14, x9, lsl #3]
    gret
5:  // rd == 31 (XZR or SP)
    cbz x13, 7f             // If not setting flags, write to SP
    gret                    // If setting flags (CMP), discard result
7:  // Mask to 48 bits before writing to SP
    and x16, x16, #0xffffffffffff
    str x16, [_cpu, #CPU_sp]
    gret

/*
 * ADD/SUB register
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25]
 */
// ADD (register, with optional shift)
// Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25 | shift_type<<26 | imm6<<32]
.gadget add_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    // ubfx x13, x8, #25, #1   // S (not used yet for flag setting)
    ubfx x17, x8, #26, #2   // shift_type
    lsr x3, x8, #32        // imm6 (shift amount)
    and x3, x3, #0x3f

    add x14, _cpu, #CPU_x0

    // Load Rn (XZR if rn == 31)
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load Rm
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Apply shift to Rm
    // For 32-bit ops (sf=0), ASR must use w-register to sign-extend correctly
    cbz x3, 5f             // No shift if imm6 == 0
    cmp x17, #0             // LSL
    b.eq shift_lsl
    cmp x17, #1             // LSR
    b.eq shift_lsr
    cmp x17, #2             // ASR
    b.eq shift_asr
    b 5f                    // ROR not valid for ADD
shift_lsl:
    cbz x12, add_shift_lsl32
    lsl x16, x16, x3
    b 5f
add_shift_lsl32:
    lsl w16, w16, w3
    b 5f
shift_lsr:
    cbz x12, add_shift_lsr32
    lsr x16, x16, x3
    b 5f
add_shift_lsr32:
    lsr w16, w16, w3
    b 5f
shift_asr:
    cbz x12, add_shift_asr32
    asr x16, x16, x3
    b 5f
add_shift_asr32:
    asr w16, w16, w3
5:
    // Add
    add x17, x15, x16

    // 32-bit
    cbz x12, 6f
    b 7f
6:  and x17, x17, #0xffffffff
7:
    // Store
    cmp x9, #31
    b.eq 8f
    str x17, [x14, x9, lsl #3]
    gret
8:  // rd == 31 (SP)
    cbz x12, 9f
    b 10f
9:  and x17, x17, #0xffffffff
10: // Mask to 48 bits before writing to SP
    and x17, x17, #0xffffffffffff
    str x17, [_cpu, #CPU_sp]
    gret

// SUB (register, with optional shift)
// Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25 | shift_type<<26 | imm6<<32]
.gadget sub_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    // ubfx x13, x8, #25, #1   // S (not used yet for flag setting)
    ubfx x17, x8, #26, #2   // shift_type
    lsr x3, x8, #32        // imm6 (shift amount)
    and x3, x3, #0x3f

    add x14, _cpu, #CPU_x0

    // Load Rn (XZR if rn == 31)
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load Rm
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Apply shift to Rm
    // For 32-bit ops (sf=0), ASR must use w-register to sign-extend correctly
    cbz x3, 5f             // No shift if imm6 == 0
    cmp x17, #0             // LSL
    b.eq sub_shift_lsl
    cmp x17, #1             // LSR
    b.eq sub_shift_lsr
    cmp x17, #2             // ASR
    b.eq sub_shift_asr
    b 5f                    // ROR not valid for SUB
sub_shift_lsl:
    cbz x12, sub_shift_lsl32
    lsl x16, x16, x3
    b 5f
sub_shift_lsl32:
    lsl w16, w16, w3
    b 5f
sub_shift_lsr:
    cbz x12, sub_shift_lsr32
    lsr x16, x16, x3
    b 5f
sub_shift_lsr32:
    lsr w16, w16, w3
    b 5f
sub_shift_asr:
    cbz x12, sub_shift_asr32
    asr x16, x16, x3
    b 5f
sub_shift_asr32:
    asr w16, w16, w3
5:
    // Subtract
    sub x17, x15, x16

    // 32-bit
    cbz x12, 6f
    b 7f
6:  and x17, x17, #0xffffffff
7:
    // Store
    cmp x9, #31
    b.eq 8f
    str x17, [x14, x9, lsl #3]
    gret
8:  // rd == 31 (SP)
    cbz x12, 9f
    b 10f
9:  and x17, x17, #0xffffffff
10: // Mask to 48 bits before writing to SP
    and x17, x17, #0xffffffffffff
    str x17, [_cpu, #CPU_sp]
    gret

/*
 * ADDS (register with shift) - sets NZCV flags
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25 | shift_type<<26 | imm6<<32]
 * Used for: ADDS, CMN (when rd=XZR)
 */
.gadget adds_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    ubfx x17, x8, #26, #2   // shift_type
    lsr x3, x8, #32
    and x3, x3, #0x3f     // imm6

    add x14, _cpu, #CPU_x0

    // Load Rn (XZR if rn == 31, NOT SP - ADDS uses zero register)
    // Note: For ADDS/SUBS with S flag set, x31 is XZR, not SP
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0             // XZR for ADDS (not SP)
2:
    // Load Rm (XZR if rm == 31)
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Apply shift
    // For 32-bit ops (sf=0), ASR must use w-register to sign-extend correctly
    cbz x3, 5f
    cmp x17, #0
    b.eq adds_shift_lsl
    cmp x17, #1
    b.eq adds_shift_lsr
    cmp x17, #2
    b.eq adds_shift_asr
    b 5f
adds_shift_lsl:
    cbz x12, adds_shift_lsl32
    lsl x16, x16, x3
    b 5f
adds_shift_lsl32:
    lsl w16, w16, w3
    b 5f
adds_shift_lsr:
    cbz x12, adds_shift_lsr32
    lsr x16, x16, x3
    b 5f
adds_shift_lsr32:
    lsr w16, w16, w3
    b 5f
adds_shift_asr:
    cbz x12, adds_shift_asr32
    asr x16, x16, x3
    b 5f
adds_shift_asr32:
    asr w16, w16, w3
5:
    // Perform add and set flags - use x3 for result since store_flags clobbers x17
    cbz x12, adds_32bit
    // 64-bit: adds sets flags directly
    adds x3, x15, x16
    b adds_store_flags

adds_32bit:
    // 32-bit: need to use 32-bit operands for correct flag generation
    adds w3, w15, w16
    // Result is already zero-extended

adds_store_flags:
    // Store NZCV flags
    store_flags

    // Store result
    cmp x9, #31
    b.eq 6f
    str x3, [x14, x9, lsl #3]
6:  gret

/*
 * SUBS (register with shift) - sets NZCV flags
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25 | shift_type<<26 | imm6<<32]
 * Used for: SUBS, CMP (when rd=XZR)
 */
.gadget subs_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    ubfx x17, x8, #26, #2   // shift_type
    lsr x3, x8, #32
    and x3, x3, #0x3f     // imm6

    add x14, _cpu, #CPU_x0

    // Load Rn (XZR if rn == 31, NOT SP - SUBS uses zero register)
    // Note: For SUBS/ADDS with S flag set, x31 is XZR, not SP
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0             // XZR for SUBS (not SP)
2:
    // Load Rm (XZR if rm == 31)
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Apply shift
    // For 32-bit ops (sf=0), ASR must use w-register to sign-extend correctly
    cbz x3, 5f
    cmp x17, #0
    b.eq subs_shift_lsl
    cmp x17, #1
    b.eq subs_shift_lsr
    cmp x17, #2
    b.eq subs_shift_asr
    b 5f
subs_shift_lsl:
    cbz x12, subs_shift_lsl32
    lsl x16, x16, x3
    b 5f
subs_shift_lsl32:
    lsl w16, w16, w3
    b 5f
subs_shift_lsr:
    cbz x12, subs_shift_lsr32
    lsr x16, x16, x3
    b 5f
subs_shift_lsr32:
    lsr w16, w16, w3
    b 5f
subs_shift_asr:
    cbz x12, subs_shift_asr32
    asr x16, x16, x3
    b 5f
subs_shift_asr32:
    asr w16, w16, w3
5:
    // Perform sub and set flags - use x3 for result since store_flags clobbers x17
    cbz x12, subs_32bit
    // 64-bit: subs sets flags directly
    subs x3, x15, x16
    b subs_store_flags

subs_32bit:
    // 32-bit: need to use 32-bit operands for correct flag generation
    subs w3, w15, w16
    // Result is already zero-extended

subs_store_flags:
    store_flags

    // Store result
    cmp x9, #31
    b.eq 6f
    str x3, [x14, x9, lsl #3]
6:  gret

/*
 * ADC (register) - add with carry, optional flag update
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25]
 * Used for: ADC, ADCS
 */
.gadget adc_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    ubfx x13, x8, #25, #1   // S (update flags)

    add x14, _cpu, #CPU_x0

    // Load Rn
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load Rm
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Load NZCV for carry-in
    load_flags

    cbz x12, adc_32bit
    // 64-bit
    cbz x13, adc_64_noflags
    adcs x3, x15, x16
    b adc_store_flags
adc_64_noflags:
    adc x3, x15, x16
    b adc_store

adc_32bit:
    cbz x13, adc_32_noflags
    adcs w3, w15, w16
    b adc_store_flags
adc_32_noflags:
    adc w3, w15, w16

adc_store_flags:
    // Store NZCV flags if updated
    cbz x13, adc_store
    store_flags

adc_store:
    cmp x9, #31
    b.eq adc_done
    str x3, [x14, x9, lsl #3]
adc_done:
    gret

/*
 * SBC (register) - subtract with carry, optional flag update
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25]
 * Used for: SBC, SBCS
 */
.gadget sbc_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    ubfx x13, x8, #25, #1   // S (update flags)

    add x14, _cpu, #CPU_x0

    // Load Rn
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load Rm
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // Load NZCV for carry-in
    load_flags

    cbz x12, sbc_32bit
    // 64-bit
    cbz x13, sbc_64_noflags
    sbcs x3, x15, x16
    b sbc_store_flags
sbc_64_noflags:
    sbc x3, x15, x16
    b sbc_store

sbc_32bit:
    cbz x13, sbc_32_noflags
    sbcs w3, w15, w16
    b sbc_store_flags
sbc_32_noflags:
    sbc w3, w15, w16

sbc_store_flags:
    // Store NZCV flags if updated
    cbz x13, sbc_store
    store_flags

sbc_store:
    cmp x9, #31
    b.eq sbc_done
    str x3, [x14, x9, lsl #3]
sbc_done:
    gret

/*
 * Logical register operations
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24 | S<<25]
 */
.gadget and_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf
    ubfx x13, x8, #25, #1   // S (set flags)
    ubfx x19, x8, #26, #1   // N (invert rm for BIC)

    add x14, _cpu, #CPU_x0

    // Load rn (or 0 if rn==31)
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load rm (or 0 if rm==31)
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // If N=1 (BIC/BICS), invert rm
    cbz x19, and_reg_no_invert
    mvn x16, x16
and_reg_no_invert:

    // Check S flag - if set, use ands to set flags
    cbz x13, and_reg_no_flags

    // ANDS/BICS - set flags (use x3 for result since store_flags clobbers x17)
    cbz x12, and_reg_ands_32
    ands x3, x15, x16
    b and_reg_store_flags
and_reg_ands_32:
    ands w3, w15, w16
and_reg_store_flags:
    store_flags
    mov x17, x3
    b and_reg_store_result

and_reg_no_flags:
    // AND/BIC - no flags
    and x17, x15, x16
    cbz x12, 5f
    b and_reg_store_result
5:  and x17, x17, #0xffffffff

and_reg_store_result:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

// AND/ANDS (shifted register)
// param[0]: rd(0-4), rn(8-12), rm(16-20), sf(24), S(25), N(26), shift_type(27-28)
// param[1]: shift_amount (imm6)
.gadget and_reg_shifted
    ldr x8, [_pc]
    ldr x20, [_pc, #8]       // shift_amount
    add _pc, _pc, #16

    and x9, x8, #0x1f        // rd
    ubfx x10, x8, #8, #5     // rn
    ubfx x11, x8, #16, #5    // rm
    ubfx x12, x8, #24, #1    // sf
    ubfx x13, x8, #25, #1    // S (set flags)
    ubfx x19, x8, #26, #1    // N (invert rm for BIC)
    ubfx x21, x8, #27, #2    // shift_type

    add x14, _cpu, #CPU_x0

    // Load rn (or 0 if rn==31)
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load rm (or 0 if rm==31)
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    // If 32-bit, use W operations for shifts
    cbz x12, and_shifted_32

    // 64-bit shift
    cbz x20, and_shifted_no_shift64
    cmp x21, #0
    b.eq and_shift_lsl64
    cmp x21, #1
    b.eq and_shift_lsr64
    cmp x21, #2
    b.eq and_shift_asr64
    ror x16, x16, x20
    b and_shifted_no_shift64
and_shift_lsl64:
    lsl x16, x16, x20
    b and_shifted_no_shift64
and_shift_lsr64:
    lsr x16, x16, x20
    b and_shifted_no_shift64
and_shift_asr64:
    asr x16, x16, x20

and_shifted_no_shift64:
    // If N=1 (BIC/BICS), invert rm
    cbz x19, and_shifted_no_invert64
    mvn x16, x16
and_shifted_no_invert64:
    cbz x13, and_shifted_no_flags64
    ands x3, x15, x16
    store_flags
    mov x17, x3
    b and_shifted_store
and_shifted_no_flags64:
    and x17, x15, x16
    b and_shifted_store

and_shifted_32:
    cbz x20, and_shifted_no_shift32
    cmp x21, #0
    b.eq and_shift_lsl32
    cmp x21, #1
    b.eq and_shift_lsr32
    cmp x21, #2
    b.eq and_shift_asr32
    ror w16, w16, w20
    b and_shifted_no_shift32
and_shift_lsl32:
    lsl w16, w16, w20
    b and_shifted_no_shift32
and_shift_lsr32:
    lsr w16, w16, w20
    b and_shifted_no_shift32
and_shift_asr32:
    asr w16, w16, w20

and_shifted_no_shift32:
    cbz x19, and_shifted_no_invert32
    mvn w16, w16
and_shifted_no_invert32:
    cbz x13, and_shifted_no_flags32
    ands w3, w15, w16
    store_flags
    mov w17, w3
    b and_shifted_store
and_shifted_no_flags32:
    and w17, w15, w16

and_shifted_store:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

// ORR (shifted register)
// param[0]: rd(0-4), rn(8-12), rm(16-20), sf(24), N(26), shift_type(27-28)
// param[1]: shift_amount (imm6)
.gadget orr_reg_shifted
    ldr x8, [_pc]
    ldr x20, [_pc, #8]       // shift_amount
    add _pc, _pc, #16

    and x9, x8, #0x1f        // rd
    ubfx x10, x8, #8, #5     // rn
    ubfx x11, x8, #16, #5    // rm
    ubfx x12, x8, #24, #1    // sf
    ubfx x19, x8, #26, #1    // N
    ubfx x21, x8, #27, #2    // shift_type

    add x14, _cpu, #CPU_x0

    // Load Rn (or 0 if XZR)
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load Rm (or 0 if XZR)
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    cbz x12, orr_shifted_32

    // 64-bit shift
    cbz x20, orr_shifted_no_shift64
    cmp x21, #0
    b.eq orr_shift_lsl64
    cmp x21, #1
    b.eq orr_shift_lsr64
    cmp x21, #2
    b.eq orr_shift_asr64
    ror x16, x16, x20
    b orr_shifted_no_shift64
orr_shift_lsl64:
    lsl x16, x16, x20
    b orr_shifted_no_shift64
orr_shift_lsr64:
    lsr x16, x16, x20
    b orr_shifted_no_shift64
orr_shift_asr64:
    asr x16, x16, x20

orr_shifted_no_shift64:
    cbz x19, orr_shifted_no_invert64
    mvn x16, x16
orr_shifted_no_invert64:
    orr x17, x15, x16
    b orr_shifted_store

orr_shifted_32:
    cbz x20, orr_shifted_no_shift32
    cmp x21, #0
    b.eq orr_shift_lsl32
    cmp x21, #1
    b.eq orr_shift_lsr32
    cmp x21, #2
    b.eq orr_shift_asr32
    ror w16, w16, w20
    b orr_shifted_no_shift32
orr_shift_lsl32:
    lsl w16, w16, w20
    b orr_shifted_no_shift32
orr_shift_lsr32:
    lsr w16, w16, w20
    b orr_shifted_no_shift32
orr_shift_asr32:
    asr w16, w16, w20

orr_shifted_no_shift32:
    cbz x19, orr_shifted_no_invert32
    mvn w16, w16
orr_shifted_no_invert32:
    orr w17, w15, w16

orr_shifted_store:
    // Store result (unless rd is XZR)
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

// EOR (shifted register)
// param[0]: rd(0-4), rn(8-12), rm(16-20), sf(24), N(26), shift_type(27-28)
// param[1]: shift_amount (imm6)
.gadget eor_reg_shifted
    ldr x8, [_pc]
    ldr x20, [_pc, #8]       // shift_amount
    add _pc, _pc, #16

    and x9, x8, #0x1f        // rd
    ubfx x10, x8, #8, #5     // rn
    ubfx x11, x8, #16, #5    // rm
    ubfx x12, x8, #24, #1    // sf
    ubfx x19, x8, #26, #1    // N (invert rm for EON)
    ubfx x21, x8, #27, #2    // shift_type

    add x14, _cpu, #CPU_x0

    // Load rn (or 0 if rn==31)
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load rm (or 0 if rm==31)
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    cbz x12, eor_shifted_32

    // 64-bit shift
    cbz x20, eor_shifted_no_shift64
    cmp x21, #0
    b.eq eor_shift_lsl64
    cmp x21, #1
    b.eq eor_shift_lsr64
    cmp x21, #2
    b.eq eor_shift_asr64
    ror x16, x16, x20
    b eor_shifted_no_shift64
eor_shift_lsl64:
    lsl x16, x16, x20
    b eor_shifted_no_shift64
eor_shift_lsr64:
    lsr x16, x16, x20
    b eor_shifted_no_shift64
eor_shift_asr64:
    asr x16, x16, x20

eor_shifted_no_shift64:
    cbz x19, eor_shifted_no_invert64
    mvn x16, x16
eor_shifted_no_invert64:
    eor x17, x15, x16
    b eor_shifted_store

eor_shifted_32:
    cbz x20, eor_shifted_no_shift32
    cmp x21, #0
    b.eq eor_shift_lsl32
    cmp x21, #1
    b.eq eor_shift_lsr32
    cmp x21, #2
    b.eq eor_shift_asr32
    ror w16, w16, w20
    b eor_shifted_no_shift32
eor_shift_lsl32:
    lsl w16, w16, w20
    b eor_shifted_no_shift32
eor_shift_lsr32:
    lsr w16, w16, w20
    b eor_shifted_no_shift32
eor_shift_asr32:
    asr w16, w16, w20

eor_shifted_no_shift32:
    cbz x19, eor_shifted_no_invert32
    mvn w16, w16
eor_shifted_no_invert32:
    eor w17, w15, w16

eor_shifted_store:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

// Legacy unshifted ORR
.gadget orr_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #1
    ubfx x19, x8, #26, #1   // N (invert rm for ORN)

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
    // If N=1 (ORN), invert rm
    cbz x19, orr_reg_no_invert
    mvn x16, x16
orr_reg_no_invert:
    orr x17, x15, x16

    cbz x12, 5f
    b 6f
5:  and x17, x17, #0xffffffff
6:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

// MOV Xd, Xm (64-bit) — fast path for ORR Xd, XZR, Xm
// gen.c guarantees rd!=31 and rm!=31, so no SP/XZR checks needed
// Code stream: [gadget addr][rd | rm<<16]
.gadget mov_reg
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f          // rd
    ubfx x11, x8, #16, #5     // rm
    add x14, _cpu, #CPU_x0
    ldr x16, [x14, x11, lsl #3]
    str x16, [x14, x9, lsl #3]
    gret

// MOV Wd, Wm (32-bit) — fast path for ORR Wd, WZR, Wm
// Code stream: [gadget addr][rd | rm<<16]
.gadget mov_reg32
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f          // rd
    ubfx x11, x8, #16, #5     // rm
    add x14, _cpu, #CPU_x0
    ldr x16, [x14, x11, lsl #3]  // load full 64-bit reg
    and x16, x16, #0xffffffff    // zero-extend 32→64
    str x16, [x14, x9, lsl #3]
    gret

.gadget eor_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #1
    ubfx x19, x8, #26, #1   // N (invert rm for EON)

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
    // If N=1 (EON), invert rm
    cbz x19, eor_reg_no_invert
    mvn x16, x16
eor_reg_no_invert:
    eor x17, x15, x16

    cbz x12, 5f
    b 6f
5:  and x17, x17, #0xffffffff
6:
    cmp x9, #31
    b.eq 7f
    str x17, [x14, x9, lsl #3]
7:  gret

/*
 * Logical immediate operations
 * Code stream: [gadget addr][rd | rn<<8 | sf<<16 | S<<17][imm64]
 *
 * AND/ANDS - if S=1 (bit 17), set NZCV flags based on result:
 *   N = result[63] for 64-bit, result[31] for 32-bit
 *   Z = (result == 0) ? 1 : 0
 *   C = 0
 *   V = 0
 */
.gadget and_imm
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]           // imm64
    add _pc, _pc, #8

    and x10, x8, #0x1f      // rd
    ubfx x11, x8, #8, #5    // rn
    ubfx x12, x8, #16, #1   // sf
    ubfx x13, x8, #17, #1   // S (set flags?)

    add x14, _cpu, #CPU_x0

    cmp x11, #31
    b.eq 1f
    ldr x15, [x14, x11, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // If S=1, use ands to set flags correctly
    cbz x13, and_imm_no_flags

    // ANDS with flag setting - use x16 for result since store_flags clobbers x17
    cbz x12, and_imm_ands_32
    // 64-bit ANDS
    ands x16, x15, x9
    b and_imm_store_flags

and_imm_ands_32:
    // 32-bit ANDS
    ands w16, w15, w9
    // Result in w16 is already zero-extended to x16

and_imm_store_flags:
    store_flags
    mov x17, x16            // save result immediately before any function calls
    b and_imm_store_result

and_imm_no_flags:
    // AND without flags
    and x17, x15, x9
    cbz x12, 3f
    b and_imm_store_result
3:  and x17, x17, #0xffffffff

and_imm_store_result:
    // Store result
    cmp x10, #31
    b.eq 4f
    str x17, [x14, x10, lsl #3]
    gret
4:  // rd=31: For AND/ANDS, rd=31 has different meanings:
    // ANDS (S=1) with rd=31 → discard result (TST instruction), rd=31 means XZR
    // AND (S=0) with rd=31 → write to SP
    cbnz x13, 5f             // If S=1 (ANDS/TST), discard result
    // AND with rd=31: write to SP
    and x17, x17, #0xffffffffffff   // Mask to 48-bit address space
    str x17, [_cpu, #CPU_sp]
5:  gret

.gadget orr_imm
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8

    and x10, x8, #0x1f
    ubfx x11, x8, #8, #5
    ubfx x12, x8, #16, #1

    add x14, _cpu, #CPU_x0

    cmp x11, #31
    b.eq 1f
    ldr x15, [x14, x11, lsl #3]
    b 2f
1:  mov x15, #0
2:
    orr x17, x15, x9

    cbz x12, 3f
    b 4f
3:  and x17, x17, #0xffffffff
4:
    cmp x10, #31
    b.eq 6f
    str x17, [x14, x10, lsl #3]
    gret
6:  // rd=31 for ORR (immediate): writes SP, not XZR (only ANDS uses XZR).
    and x17, x17, #0xffffffffffff   // Mask to 48-bit address space
    str x17, [_cpu, #CPU_sp]
    gret

.gadget eor_imm
    ldr x8, [_pc]
    add _pc, _pc, #8
    ldr x9, [_pc]
    add _pc, _pc, #8

    and x10, x8, #0x1f
    ubfx x11, x8, #8, #5
    ubfx x12, x8, #16, #1

    add x14, _cpu, #CPU_x0

    cmp x11, #31
    b.eq 1f
    ldr x15, [x14, x11, lsl #3]
    b 2f
1:  mov x15, #0
2:
    eor x17, x15, x9

    cbz x12, 3f
    b 4f
3:  and x17, x17, #0xffffffff
4:
    cmp x10, #31
    b.eq 6f
    str x17, [x14, x10, lsl #3]
    gret
6:  // rd=31 for EOR (immediate): writes SP, not XZR (only ANDS uses XZR).
    and x17, x17, #0xffffffffffff   // Mask to 48-bit address space
    str x17, [_cpu, #CPU_sp]
    gret

/*
 * EXTR - Extract register (concatenate and shift)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | imm<<24 | sf<<30]
 */
.gadget extr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #6   // imm
    ubfx x13, x8, #30, #1   // sf (0=32, 1=64)

    // Load Rn
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
    b 2f
1:  mov x15, #0
2:
    // Load Rm
    cmp x11, #31
    b.eq 3f
    ldr x16, [x14, x11, lsl #3]
    b 4f
3:  mov x16, #0
4:
    cbz x13, .Lextr_32

    // 64-bit EXTR
    cbz x12, .Lextr_64_store_rm
    lsr x17, x16, x12
    mov x3, #64
    sub x3, x3, x12
    lsl x19, x15, x3
    orr x17, x17, x19
    b .Lextr_store
.Lextr_64_store_rm:
    mov x17, x16
    b .Lextr_store

.Lextr_32:
    // 32-bit EXTR
    and x15, x15, #0xffffffff
    and x16, x16, #0xffffffff
    cbz x12, .Lextr_32_store_rm
    lsr w17, w16, w12
    mov w3, #32
    sub w3, w3, w12
    lsl w19, w15, w3
    orr w17, w17, w19
    and x17, x17, #0xffffffff
    b .Lextr_store
.Lextr_32_store_rm:
    mov w17, w16
    and x17, x17, #0xffffffff

.Lextr_store:
    cmp x9, #31
    b.eq .Lextr_done
    str x17, [x14, x9, lsl #3]
.Lextr_done:
    gret

/*
 * Sign-extend operations
 * These operate on _tmp (x0) which should already have the source value loaded
 */

// SXTW: Sign-extend word (32-bit) to doubleword (64-bit)
// _tmp = sign_extend(_tmp[31:0])
.gadget sxtw
    sxtw _tmp, w0
    gret

// SXTH: Sign-extend halfword (16-bit) to 32 or 64-bit
// Code stream: [gadget addr][sf] (0=32-bit dest, 1=64-bit dest)
.gadget sxth
    ldr x8, [_pc]
    add _pc, _pc, #8
    cbz x8, 1f
    sxth _tmp, w0       // 64-bit
    gret
1:  sxth w0, w0         // 32-bit
    gret

// SXTB: Sign-extend byte (8-bit) to 32 or 64-bit
// Code stream: [gadget addr][sf]
.gadget sxtb
    ldr x8, [_pc]
    add _pc, _pc, #8
    cbz x8, 1f
    sxtb _tmp, w0       // 64-bit
    gret
1:  sxtb w0, w0         // 32-bit
    gret

// UXTW: Zero-extend word (32-bit) to doubleword (64-bit)
.gadget uxtw
    // Clear upper 32 bits explicitly
    and x0, x0, #0xffffffff
    gret

// UXTH: Zero-extend halfword (16-bit)
// Code stream: [gadget addr][sf]
.gadget uxth
    ldr x8, [_pc]
    add _pc, _pc, #8
    cbz x8, 1f
    uxth _tmp, w0       // to 64-bit (x0)
    gret
1:  uxth w0, w0         // to 32-bit (w0)
    gret

// UXTB: Zero-extend byte (8-bit)
// Code stream: [gadget addr][sf]
.gadget uxtb
    ldr x8, [_pc]
    add _pc, _pc, #8
    cbz x8, 1f
    uxtb _tmp, w0       // to 64-bit
    gret
1:  uxtb w0, w0         // to 32-bit
    gret

/*
 * CCMP/CCMN - Conditional Compare (register)
 * Code stream: [gadget addr][rn | rm<<8 | cond<<16 | nzcv<<20 | sf<<24]
 *
 * If condition is true: performs CMP/CMN and sets flags from result
 * If condition is false: sets flags to the immediate nzcv value
 */

// CCMP: Conditional Compare (subtracts rm from rn)
.gadget ccmp_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    ubfx x10, x8, #8, #5    // rm
    ubfx x11, x8, #16, #4   // cond
    ubfx x12, x8, #20, #4   // nzcv (flags if condition false)
    ubfx x13, x8, #24, #1   // sf

    // Load current flags
    ldr w14, [_cpu, #CPU_nzcv]

    // Check condition
    // We need to evaluate the condition based on current flags
    // x14 has NZCV in bits 31:28
    // x11 has condition code (0-15)

    // Extract individual flags from x14
    // N = bit 31, Z = bit 30, C = bit 29, V = bit 28
    lsr x15, x14, #28       // x15 = bits 31:28 in low 4 bits

    // Load Rn value
    add x16, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x17, [x16, x9, lsl #3]
    b 2f
1:  mov x17, #0
2:
    // Load Rm value
    cmp x10, #31
    b.eq 3f
    ldr x3, [x16, x10, lsl #3]
    b 4f
3:  mov x3, #0
4:
    // Evaluate condition
    // Set NZCV from x14 and use conditional branches
    msr nzcv, x14

    // Use bcond to check the condition
    // cond is in x11 (0-15)
    // We'll use a jump table

    adr x16, ccmp_cond_table
    add x16, x16, x11, lsl #3   // each entry is 8 bytes (2 instructions)
    br x16

.align 3
ccmp_cond_table:
    b.eq ccmp_do_compare        // 0: EQ
    b ccmp_set_nzcv
    b.ne ccmp_do_compare        // 1: NE
    b ccmp_set_nzcv
    b.cs ccmp_do_compare        // 2: CS/HS
    b ccmp_set_nzcv
    b.cc ccmp_do_compare        // 3: CC/LO
    b ccmp_set_nzcv
    b.mi ccmp_do_compare        // 4: MI
    b ccmp_set_nzcv
    b.pl ccmp_do_compare        // 5: PL
    b ccmp_set_nzcv
    b.vs ccmp_do_compare        // 6: VS
    b ccmp_set_nzcv
    b.vc ccmp_do_compare        // 7: VC
    b ccmp_set_nzcv
    b.hi ccmp_do_compare        // 8: HI
    b ccmp_set_nzcv
    b.ls ccmp_do_compare        // 9: LS
    b ccmp_set_nzcv
    b.ge ccmp_do_compare        // 10: GE
    b ccmp_set_nzcv
    b.lt ccmp_do_compare        // 11: LT
    b ccmp_set_nzcv
    b.gt ccmp_do_compare        // 12: GT
    b ccmp_set_nzcv
    b.le ccmp_do_compare        // 13: LE
    b ccmp_set_nzcv
    b ccmp_do_compare           // 14: AL (always)
    nop
    b ccmp_do_compare           // 15: NV (AArch64 treats NV as always true here)
    nop

ccmp_do_compare:
    // Condition true: perform CMP (Rn - Rm) and set flags
    cbz x13, ccmp_cmp_32
    // 64-bit compare
    subs xzr, x17, x3
    b ccmp_store_flags
ccmp_cmp_32:
    // 32-bit compare
    subs wzr, w17, w3

ccmp_store_flags:
    store_flags
    gret

ccmp_set_nzcv:
    // Condition false: set flags to immediate nzcv value
    lsl x12, x12, #28           // Move nzcv to bits 31:28
    str w12, [_cpu, #CPU_nzcv]
    gret

/*
 * CCMP - Conditional Compare (immediate)
 * Code stream: [gadget addr][rn | imm5<<8 | cond<<16 | nzcv<<20 | sf<<24]
 *
 * If condition is true: performs CMP (Rn - imm) and sets flags from result
 * If condition is false: sets flags to the immediate nzcv value
 */
.gadget ccmp_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    ubfx x10, x8, #8, #5    // imm5
    ubfx x11, x8, #16, #4   // cond
    ubfx x12, x8, #20, #4   // nzcv (flags if condition false)
    ubfx x13, x8, #24, #1   // sf

    // Load current flags
    ldr w14, [_cpu, #CPU_nzcv]

    // Load Rn value
    add x16, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x17, [x16, x9, lsl #3]
    b 2f
1:  mov x17, #0
2:
    // Evaluate condition based on current flags
    msr nzcv, x14

    adr x16, ccmpi_cond_table
    add x16, x16, x11, lsl #3
    br x16

.align 3
ccmpi_cond_table:
    b.eq ccmpi_do_compare        // 0: EQ
    b ccmpi_set_nzcv
    b.ne ccmpi_do_compare        // 1: NE
    b ccmpi_set_nzcv
    b.cs ccmpi_do_compare        // 2: CS/HS
    b ccmpi_set_nzcv
    b.cc ccmpi_do_compare        // 3: CC/LO
    b ccmpi_set_nzcv
    b.mi ccmpi_do_compare        // 4: MI
    b ccmpi_set_nzcv
    b.pl ccmpi_do_compare        // 5: PL
    b ccmpi_set_nzcv
    b.vs ccmpi_do_compare        // 6: VS
    b ccmpi_set_nzcv
    b.vc ccmpi_do_compare        // 7: VC
    b ccmpi_set_nzcv
    b.hi ccmpi_do_compare        // 8: HI
    b ccmpi_set_nzcv
    b.ls ccmpi_do_compare        // 9: LS
    b ccmpi_set_nzcv
    b.ge ccmpi_do_compare        // 10: GE
    b ccmpi_set_nzcv
    b.lt ccmpi_do_compare        // 11: LT
    b ccmpi_set_nzcv
    b.gt ccmpi_do_compare        // 12: GT
    b ccmpi_set_nzcv
    b.le ccmpi_do_compare        // 13: LE
    b ccmpi_set_nzcv
    b ccmpi_do_compare           // 14: AL (always)
    nop
    b ccmpi_do_compare           // 15: NV (AArch64 treats NV as always true here)
    nop

ccmpi_do_compare:
    // Condition true: perform CMP (Rn - imm) and set flags
    cbz x13, ccmpi_cmp_32
    subs xzr, x17, x10
    b ccmpi_store_flags
ccmpi_cmp_32:
    subs wzr, w17, w10

ccmpi_store_flags:
    store_flags
    gret

ccmpi_set_nzcv:
    lsl x12, x12, #28
    str w12, [_cpu, #CPU_nzcv]
    gret

// CCMN: Conditional Compare Negative (adds rm to rn)
.gadget ccmn_reg
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    ubfx x10, x8, #8, #5    // rm
    ubfx x11, x8, #16, #4   // cond
    ubfx x12, x8, #20, #4   // nzcv (flags if condition false)
    ubfx x13, x8, #24, #1   // sf

    // Load current flags
    ldr w14, [_cpu, #CPU_nzcv]

    // Load Rn value
    add x16, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x17, [x16, x9, lsl #3]
    b 2f
1:  mov x17, #0
2:
    // Load Rm value
    cmp x10, #31
    b.eq 3f
    ldr x3, [x16, x10, lsl #3]
    b 4f
3:  mov x3, #0
4:
    // Evaluate condition
    msr nzcv, x14

    adr x16, ccmn_cond_table
    add x16, x16, x11, lsl #3
    br x16

.align 3
ccmn_cond_table:
    b.eq ccmn_do_compare        // 0: EQ
    b ccmn_set_nzcv
    b.ne ccmn_do_compare        // 1: NE
    b ccmn_set_nzcv
    b.cs ccmn_do_compare        // 2: CS/HS
    b ccmn_set_nzcv
    b.cc ccmn_do_compare        // 3: CC/LO
    b ccmn_set_nzcv
    b.mi ccmn_do_compare        // 4: MI
    b ccmn_set_nzcv
    b.pl ccmn_do_compare        // 5: PL
    b ccmn_set_nzcv
    b.vs ccmn_do_compare        // 6: VS
    b ccmn_set_nzcv
    b.vc ccmn_do_compare        // 7: VC
    b ccmn_set_nzcv
    b.hi ccmn_do_compare        // 8: HI
    b ccmn_set_nzcv
    b.ls ccmn_do_compare        // 9: LS
    b ccmn_set_nzcv
    b.ge ccmn_do_compare        // 10: GE
    b ccmn_set_nzcv
    b.lt ccmn_do_compare        // 11: LT
    b ccmn_set_nzcv
    b.gt ccmn_do_compare        // 12: GT
    b ccmn_set_nzcv
    b.le ccmn_do_compare        // 13: LE
    b ccmn_set_nzcv
    b ccmn_do_compare           // 14: AL (always)
    nop
    b ccmn_do_compare           // 15: NV (AArch64 treats NV as always true here)
    nop

ccmn_do_compare:
    // Condition true: perform CMN (Rn + Rm) and set flags
    cbz x13, ccmn_cmn_32
    // 64-bit compare
    adds xzr, x17, x3
    b ccmn_store_flags
ccmn_cmn_32:
    // 32-bit compare
    adds wzr, w17, w3

ccmn_store_flags:
    store_flags
    gret

ccmn_set_nzcv:
    // Condition false: set flags to immediate nzcv value
    lsl x12, x12, #28           // Move nzcv to bits 31:28
    str w12, [_cpu, #CPU_nzcv]
    gret

/*
 * CCMN - Conditional Compare Negative (immediate)
 * Code stream: [gadget addr][rn | imm5<<8 | cond<<16 | nzcv<<20 | sf<<24]
 *
 * If condition is true: performs CMN (Rn + imm) and sets flags from result
 * If condition is false: sets flags to the immediate nzcv value
 */
.gadget ccmn_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn
    ubfx x10, x8, #8, #5    // imm5
    ubfx x11, x8, #16, #4   // cond
    ubfx x12, x8, #20, #4   // nzcv (flags if condition false)
    ubfx x13, x8, #24, #1   // sf

    // Load current flags
    ldr w14, [_cpu, #CPU_nzcv]

    // Load Rn value
    add x16, _cpu, #CPU_x0
    cmp x9, #31
    b.eq 1f
    ldr x17, [x16, x9, lsl #3]
    b 2f
1:  mov x17, #0
2:
    // Evaluate condition based on current flags
    msr nzcv, x14

    adr x16, ccmni_cond_table
    add x16, x16, x11, lsl #3
    br x16

.align 3
ccmni_cond_table:
    b.eq ccmni_do_compare        // 0: EQ
    b ccmni_set_nzcv
    b.ne ccmni_do_compare        // 1: NE
    b ccmni_set_nzcv
    b.cs ccmni_do_compare        // 2: CS/HS
    b ccmni_set_nzcv
    b.cc ccmni_do_compare        // 3: CC/LO
    b ccmni_set_nzcv
    b.mi ccmni_do_compare        // 4: MI
    b ccmni_set_nzcv
    b.pl ccmni_do_compare        // 5: PL
    b ccmni_set_nzcv
    b.vs ccmni_do_compare        // 6: VS
    b ccmni_set_nzcv
    b.vc ccmni_do_compare        // 7: VC
    b ccmni_set_nzcv
    b.hi ccmni_do_compare        // 8: HI
    b ccmni_set_nzcv
    b.ls ccmni_do_compare        // 9: LS
    b ccmni_set_nzcv
    b.ge ccmni_do_compare        // 10: GE
    b ccmni_set_nzcv
    b.lt ccmni_do_compare        // 11: LT
    b ccmni_set_nzcv
    b.gt ccmni_do_compare        // 12: GT
    b ccmni_set_nzcv
    b.le ccmni_do_compare        // 13: LE
    b ccmni_set_nzcv
    b ccmni_do_compare           // 14: AL (always)
    nop
    b ccmni_do_compare           // 15: NV (AArch64 treats NV as always true here)
    nop

ccmni_do_compare:
    // Condition true: perform CMN (Rn + imm) and set flags
    cbz x13, ccmni_cmn_32
    adds xzr, x17, x10
    b ccmni_store_flags
ccmni_cmn_32:
    adds wzr, w17, w10

ccmni_store_flags:
    store_flags
    gret

ccmni_set_nzcv:
    lsl x12, x12, #28
    str w12, [_cpu, #CPU_nzcv]
    gret

/*
 * Fast-path variable shifts (sf=1, rd/rn/rm != 31)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */

// LSLV 64-bit fast path
.gadget lslv_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    ldr x16, [x14, x11, lsl #3]
    and x16, x16, #63
    lsl x17, x15, x16
    str x17, [x14, x9, lsl #3]
    gret

// LSRV 64-bit fast path
.gadget lsrv_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    ldr x16, [x14, x11, lsl #3]
    and x16, x16, #63
    lsr x17, x15, x16
    str x17, [x14, x9, lsl #3]
    gret

// ASRV 64-bit fast path
.gadget asrv_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3]
    ldr x16, [x14, x11, lsl #3]
    and x16, x16, #63
    asr x17, x15, x16
    str x17, [x14, x9, lsl #3]
    gret

/*
 * Data Processing (2 source) - Variable shifts and divides
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sf<<24]
 */

// LSLV: Logical Shift Left Variable
.gadget lslv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf

    add x14, _cpu, #CPU_x0

    // Load Rn
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    // Load Rm (shift amount)
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    // Perform shift - only low 6 bits of Rm matter for 64-bit, 5 bits for 32-bit
    cbz x12, lslv_32
    // 64-bit
    and x16, x16, #63
    lsl x17, x15, x16
    b lslv_store
lslv_32:
    and x16, x16, #31
    lsl w17, w15, w16
    // w-reg operations implicitly zero-extend to 64 bits

lslv_store:
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// LSRV: Logical Shift Right Variable
.gadget lsrv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cbz x12, lsrv_32
    and x16, x16, #63
    lsr x17, x15, x16
    b lsrv_store
lsrv_32:
    // w15 is already the lower 32 bits when using w-register form
    and x16, x16, #31
    lsr w17, w15, w16

lsrv_store:
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// ASRV: Arithmetic Shift Right Variable
.gadget asrv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cbz x12, asrv_32
    and x16, x16, #63
    asr x17, x15, x16
    b asrv_store
asrv_32:
    and x16, x16, #31
    asr w17, w15, w16

asrv_store:
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// RORV: Rotate Right Variable
.gadget rorv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cbz x12, rorv_32
    and x16, x16, #63
    ror x17, x15, x16
    b rorv_store
rorv_32:
    and x16, x16, #31
    ror w17, w15, w16

rorv_store:
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// UDIV: Unsigned Divide
.gadget udiv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cbz x12, udiv_32
    udiv x17, x15, x16
    b udiv_store
udiv_32:
    udiv w17, w15, w16

udiv_store:
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// SDIV: Signed Divide
.gadget sdiv
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #1   // sf

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cbz x12, sdiv_32
    sdiv x17, x15, x16
    b sdiv_store
sdiv_32:
    sdiv w17, w15, w16

sdiv_store:
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32 instructions
// All CRC32 variants: result is always 32-bit (stored in w-reg)
// Packing: rd | rn<<8 | rm<<16 | sf<<24
// sf is only relevant for CRC32X/CRC32CX (64-bit source operand)
//
// CRC is an optional ARMv8.0 extension — gate with .arch_extension so the
// assembler accepts these mnemonics regardless of the build's -march setting.
// Apple clang defaults include +crc on Apple Silicon; GNU as on armv8-a does not.
.arch_extension crc

// CRC32B
.gadget crc32b
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32b w17, w15, w16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32H
.gadget crc32h
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32h w17, w15, w16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32W
.gadget crc32w
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32w w17, w15, w16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32X (64-bit source, sf=1 only)
.gadget crc32x
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32x w17, w15, x16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32CB
.gadget crc32cb
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32cb w17, w15, w16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32CH
.gadget crc32ch
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32ch w17, w15, w16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32CW
.gadget crc32cw
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32cw w17, w15, w16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

// CRC32CX (64-bit source, sf=1 only)
.gadget crc32cx
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:  cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:  crc32cx w17, w15, x16
    cmp x9, #31
    b.eq 3f
    str x17, [x14, x9, lsl #3]
3:  gret

.arch_extension nocrc

/*
 * UBFM - Unsigned Bitfield Move
 * Code stream: [gadget addr][immr | imms<<8 | sf<<16]
 * Input: value in _tmp (x0)
 * Output: result in _tmp (x0)
 *
 * UBFM performs: Rd = ROR(Rn, R) AND mask(s)
 * Where R is immr and the mask is derived from imms
 * This handles LSL, LSR, UBFX, UBFIZ aliases
 */
.gadget ubfm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x3f       // immr
    ubfx x10, x8, #8, #6    // imms
    ubfx x11, x8, #16, #1   // sf

    // _tmp (x0) already has the source value

    // For sf=1 (64-bit):
    //   datasize = 64, R = immr, S = imms
    //   if imms >= immr: result = (src >> R) & mask(S-R+1 bits)  (LSR/UBFX)
    //   else: result = (src << (64-R)) & mask(S+1 bits)  (LSL/UBFIZ)
    // For sf=0 (32-bit):
    //   datasize = 32, similar but with 32-bit values

    cbz x11, ubfm_32

    // 64-bit
    cmp x10, x9
    b.lt ubfm_64_insert

    // UBFX/LSR case: imms >= immr
    // result = (src >> immr) with bits [imms-immr:0] kept
    sub x12, x10, x9        // width - 1
    add x12, x12, #1        // width
    lsr x0, x0, x9          // shift right by immr
    // If width == 64, mask should be all-ones (no masking needed)
    cmp x12, #64
    b.eq ubfm_64_fullwidth
    // Create mask of 'width' bits: (1 << width) - 1 = ~((-1) << width)
    mov x13, #-1
    lsl x13, x13, x12       // -1 << width
    mvn x13, x13            // x13 = (1 << width) - 1
    and x0, x0, x13
    gret

ubfm_64_fullwidth:
    // width == 64: result already in x0 after shift
    gret

ubfm_64_insert:
    // UBFIZ/LSL case: imms < immr
    // result = (src & ((1 << width) - 1)) << (64 - immr)
    // where width = imms + 1, lsb = 64 - immr
    mov x12, #64
    sub x12, x12, x9        // shift amount = 64 - immr
    add x13, x10, #1        // width = imms + 1
    // Create mask of 'width' bits: (1 << width) - 1 = ~((-1) << width)
    mov x14, #-1
    lsl x14, x14, x13       // -1 << width
    mvn x14, x14            // (1 << width) - 1
    and x0, x0, x14         // mask source to keep only width bits
    lsl x0, x0, x12         // shift left to final position
    gret

ubfm_32:
    // 32-bit version
    cmp x10, x9
    b.lt ubfm_32_insert

    // UBFX/LSR for 32-bit
    sub w12, w10, w9
    add w12, w12, #1
    lsr w0, w0, w9
    // If width == 32, mask should be all-ones (no masking needed)
    cmp w12, #32
    b.eq ubfm_32_fullwidth
    // Create mask of 'width' bits: (1 << width) - 1 = ~((-1) << width)
    mov w13, #-1
    lsl w13, w13, w12
    mvn w13, w13
    and w0, w0, w13
    gret

ubfm_32_fullwidth:
    // width == 32: result already in w0 after shift
    gret

ubfm_32_insert:
    // UBFIZ/LSL for 32-bit
    mov w12, #32
    sub w12, w12, w9
    add w13, w10, #1
    // Create mask of 'width' bits: (1 << width) - 1 = ~((-1) << width)
    mov w14, #-1
    lsl w14, w14, w13
    mvn w14, w14
    and w0, w0, w14
    lsl w0, w0, w12
    gret

/*
 * Fused UBFM - loads rn and stores to rd internally (no load_reg/store_reg dispatch)
 * Code stream: [gadget addr][immr(0:5) | imms(8:13) | sf(16) | rn(20:24) | rd(28:32)]
 * gen.c emits this when rn!=31 and rd!=31.
 */
.gadget ubfm_fused
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x3f       // immr
    ubfx x10, x8, #8, #6    // imms
    ubfx x11, x8, #16, #1   // sf
    ubfx x3, x8, #20, #5    // rn
    ubfx x4, x8, #28, #5    // rd
    // Load source register rn
    add x14, _cpu, #CPU_x0
    ldr x0, [x14, x3, lsl #3]
    // Execute UBFM logic (same as gadget_ubfm)
    cbz x11, ubfm_f_32
    // 64-bit
    cmp x10, x9
    b.lt ubfm_f_64_insert
    sub x12, x10, x9
    add x12, x12, #1
    lsr x0, x0, x9
    cmp x12, #64
    b.eq ubfm_f_store
    mov x13, #-1
    lsl x13, x13, x12
    mvn x13, x13
    and x0, x0, x13
    b ubfm_f_store
ubfm_f_64_insert:
    mov x12, #64
    sub x12, x12, x9
    add x13, x10, #1
    mov x5, #-1
    lsl x5, x5, x13
    mvn x5, x5
    and x0, x0, x5
    lsl x0, x0, x12
    b ubfm_f_store
ubfm_f_32:
    cmp x10, x9
    b.lt ubfm_f_32_insert
    sub w12, w10, w9
    add w12, w12, #1
    lsr w0, w0, w9
    cmp w12, #32
    b.eq ubfm_f_store
    mov w13, #-1
    lsl w13, w13, w12
    mvn w13, w13
    and w0, w0, w13
    b ubfm_f_store
ubfm_f_32_insert:
    mov w12, #32
    sub w12, w12, w9
    add w13, w10, #1
    mov w5, #-1
    lsl w5, w5, w13
    mvn w5, w5
    and w0, w0, w5
    lsl w0, w0, w12
ubfm_f_store:
    str x0, [x14, x4, lsl #3]
    gret

/*
 * Fused SBFM - loads rn and stores to rd internally
 * Code stream: [gadget addr][immr(0:5) | imms(8:13) | sf(16) | rn(20:24) | rd(28:32)]
 */
.gadget sbfm_fused
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x3f       // immr
    ubfx x10, x8, #8, #6    // imms
    ubfx x11, x8, #16, #1   // sf
    ubfx x3, x8, #20, #5    // rn
    ubfx x4, x8, #28, #5    // rd
    add x14, _cpu, #CPU_x0
    ldr x0, [x14, x3, lsl #3]
    cbz x11, sbfm_f_32
    // 64-bit
    cmp x10, x9
    b.lt sbfm_f_64_insert
    sub x12, x10, x9
    add x12, x12, #1
    asr x0, x0, x9
    mov x13, #64
    sub x13, x13, x12
    lsl x0, x0, x13
    asr x0, x0, x13
    b sbfm_f_store
sbfm_f_64_insert:
    mov x12, #64
    sub x12, x12, x9
    add x13, x10, #1
    mov x5, #64
    sub x5, x5, x13
    lsl x0, x0, x5
    asr x0, x0, x5
    lsl x0, x0, x12
    b sbfm_f_store
sbfm_f_32:
    cmp x10, x9
    b.lt sbfm_f_32_insert
    sub w12, w10, w9
    add w12, w12, #1
    asr w0, w0, w9
    mov w13, #32
    sub w13, w13, w12
    lsl w0, w0, w13
    asr w0, w0, w13
    b sbfm_f_store
sbfm_f_32_insert:
    mov w12, #32
    sub w12, w12, w9
    add w13, w10, #1
    mov w5, #32
    sub w5, w5, w13
    lsl w0, w0, w5
    asr w0, w0, w5
    lsl w0, w0, w12
sbfm_f_store:
    str x0, [x14, x4, lsl #3]
    gret

/*
 * SBFM - Signed Bitfield Move
 * Code stream: [gadget addr][immr | imms<<8 | sf<<16]
 * Input: value in _tmp (x0)
 * Output: result in _tmp (x0)
 *
 * SBFM is similar to UBFM but with sign extension
 * Handles ASR, SBFX, SBFIZ aliases
 */
.gadget sbfm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x3f       // immr
    ubfx x10, x8, #8, #6    // imms
    ubfx x11, x8, #16, #1   // sf

    cbz x11, sbfm_32

    // 64-bit
    cmp x10, x9
    b.lt sbfm_64_insert

    // SBFX/ASR case: imms >= immr
    // Extract field and sign-extend
    sub x12, x10, x9        // width - 1
    add x12, x12, #1        // width
    // Shift right to position, then sign-extend
    asr x0, x0, x9          // arithmetic shift right by immr
    // Now shift left then asr to sign extend the width-bit field
    mov x13, #64
    sub x13, x13, x12       // 64 - width
    lsl x0, x0, x13
    asr x0, x0, x13
    gret

sbfm_64_insert:
    // SBFIZ case: imms < immr
    // For SBFIZ Xd, Xn, #lsb, #width:
    //   immr = (-lsb) MOD 64
    //   imms = width - 1
    // We need to:
    //   1. Extract bits [0:width-1] from source
    //   2. Sign-extend to 64 bits
    //   3. Shift left by lsb (= 64 - immr for 64-bit)
    mov x12, #64
    sub x12, x12, x9        // x12 = lsb = 64 - immr
    add x13, x10, #1        // x13 = width = imms + 1

    // Sign-extend the lower 'width' bits
    // Shift left to move MSB of field to bit 63, then ASR back
    mov x14, #64
    sub x14, x14, x13       // x14 = 64 - width
    lsl x0, x0, x14         // Move MSB of field to bit 63
    asr x0, x0, x14         // Arithmetic shift right to sign-extend

    // Now shift left by lsb
    lsl x0, x0, x12
    gret

sbfm_32:
    cmp x10, x9
    b.lt sbfm_32_insert

    // SBFX/ASR for 32-bit
    sub w12, w10, w9
    add w12, w12, #1
    asr w0, w0, w9
    mov w13, #32
    sub w13, w13, w12
    lsl w0, w0, w13
    asr w0, w0, w13
    gret

sbfm_32_insert:
    // SBFIZ 32-bit case: imms < immr
    // Sign-extend then shift left
    mov w12, #32
    sub w12, w12, w9        // w12 = lsb = 32 - immr (for 32-bit encoding)
    add w13, w10, #1        // w13 = width = imms + 1

    // Sign-extend the lower 'width' bits
    mov w14, #32
    sub w14, w14, w13       // w14 = 32 - width
    lsl w0, w0, w14         // Move MSB of field to bit 31
    asr w0, w0, w14         // Arithmetic shift right to sign-extend

    // Now shift left by lsb
    lsl w0, w0, w12
    gret

/*
 * BFM - Bitfield Move (preserves destination bits outside the field)
 * Code stream: [gadget addr][immr | imms<<8 | sf<<16 | rd<<24]
 * Input: source value in _tmp (x0)
 * Output: result in _tmp (x0) = destination with bitfield from source inserted
 *
 * BFM copies a bitfield from Rn to Rd, preserving other bits in Rd.
 * Uses ROR(src, immr) & wmask to extract field, inserts into dest.
 * If imms >= immr (BFXIL): extract bits [imms:immr] from Rn, insert at bits [imms-immr:0] of Rd
 * If imms < immr (BFI):   copy bits [imms:0] of Rn to bits [datasize-1-immr+imms:datasize-immr] of Rd
 *                          (wrap around behavior)
 */
.gadget bfm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x3f       // immr
    ubfx x10, x8, #8, #6    // imms
    ubfx x11, x8, #16, #1   // sf
    ubfx x12, x8, #24, #5   // rd

    // Save source value
    mov x13, x0             // x13 = source (Rn value)

    // Load destination register value (Rd)
    add x14, _cpu, #CPU_x0
    cmp x12, #31
    b.eq bfm_rd_zero
    ldr x15, [x14, x12, lsl #3]
    b bfm_have_dest
bfm_rd_zero:
    mov x15, #0             // XZR is always zero
bfm_have_dest:
    // x15 = current destination (Rd) value

    cbz x11, bfm_32

    // 64-bit BFM
    cmp x10, x9
    b.lt bfm_64_wrap

    // Case: imms >= immr (BFXIL)
    // Extract bits [imms:immr] from src, insert at bits [imms-immr:0] of dest
    // width = imms - immr + 1
    sub x16, x10, x9        // width - 1
    add x16, x16, #1        // width
    // If width == 64, result is just the source value
    cmp x16, #64
    b.eq bfm_64_fullwidth
    // Create mask of 'width' bits at position 0
    mov x17, #-1
    lsl x17, x17, x16       // -1 << width
    mvn x17, x17            // (1 << width) - 1 = mask for width bits

    // Extract field from source: src_field = (src >> immr) & mask
    lsr x13, x13, x9        // src >> immr
    and x13, x13, x17       // src_field = (src >> immr) & mask

    // Clear low 'width' bits of destination and insert source field
    bic x15, x15, x17       // dest & ~mask (clear low width bits)
    orr x0, x15, x13        // result = (dest & ~mask) | src_field
    gret

bfm_64_fullwidth:
    // width == 64: full-field move -> result is source
    mov x0, x13
    gret

bfm_64_wrap:
    // Case: imms < immr (wrap around)
    // Copy bits [imms:0] from src to bits [datasize-1-immr+imms:datasize-immr] in dest
    // width = imms + 1, dst_lsb = 64 - immr
    add x16, x10, #1        // width = imms + 1
    mov x17, #64
    sub x3, x17, x9        // dst_lsb = 64 - immr

    // Create mask of 'width' bits
    mov x17, #-1
    lsl x17, x17, x16       // -1 << width
    mvn x17, x17            // mask for width bits

    // Extract field from source
    and x13, x13, x17       // src_field = source & mask

    // Create dest_mask at destination position
    lsl x17, x17, x3       // dest_mask = mask << dst_lsb

    // Clear destination bits and insert source field
    bic x15, x15, x17
    lsl x13, x13, x3       // src_field << dst_lsb
    orr x0, x15, x13
    gret

bfm_32:
    // 32-bit BFM
    cmp w10, w9
    b.lt bfm_32_wrap

    // Case: imms >= immr (BFXIL)
    // Extract bits [imms:immr] from src, insert at bits [imms-immr:0] of dest
    sub w16, w10, w9
    add w16, w16, #1
    // If width == 32, result is just the source value
    cmp w16, #32
    b.eq bfm_32_fullwidth
    mov w17, #-1
    lsl w17, w17, w16
    mvn w17, w17

    // Extract field from source: src_field = (src >> immr) & mask
    lsr w13, w13, w9
    and w13, w13, w17
    // Clear low 'width' bits of dest and insert
    bic w15, w15, w17
    orr w0, w15, w13
    gret

bfm_32_fullwidth:
    // width == 32: full-field move -> result is source
    mov w0, w13
    gret

bfm_32_wrap:
    // Case: imms < immr (wrap around)
    add w16, w10, #1
    mov w17, #32
    sub w3, w17, w9

    mov w17, #-1
    lsl w17, w17, w16
    mvn w17, w17

    and w13, w13, w17
    lsl w17, w17, w3
    bic w15, w15, w17
    lsl w13, w13, w3
    orr w0, w15, w13
    gret

/*
 * ADD/SUB (extended register)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | option<<24 | imm3<<27 | sf<<30 | S<<31]
 *
 * option encodes the extension type:
 *   000 = UXTB  (zero-extend byte)
 *   001 = UXTH  (zero-extend halfword)
 *   010 = UXTW  (zero-extend word) / LSL if sf=0 or rm=WSP
 *   011 = UXTX  (64-bit, no extension) / LSL if sf=1
 *   100 = SXTB  (sign-extend byte)
 *   101 = SXTH  (sign-extend halfword)
 *   110 = SXTW  (sign-extend word)
 *   111 = SXTX  (sign-extend doubleword)
 */
.gadget add_ext
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #3   // option
    ubfx x13, x8, #27, #3   // imm3 (shift amount)
    ubfx x14, x8, #30, #1   // sf
    ubfx x15, x8, #31, #1   // S

    add x16, _cpu, #CPU_x0

    // Load Rn (or SP if rn == 31)
    cmp x10, #31
    b.eq add_ext_load_sp_rn
    ldr x17, [x16, x10, lsl #3]
    b add_ext_load_rm
add_ext_load_sp_rn:
    ldr x17, [_cpu, #CPU_sp]

add_ext_load_rm:
    // Load Rm (or XZR if rm == 31)
    cmp x11, #31
    mov x3, #0
    b.eq add_ext_apply
    ldr x3, [x16, x11, lsl #3]

add_ext_apply:
    // Apply extension based on option
    // Jump table for extension type
    adr x19, add_ext_option_table
    add x19, x19, x12, lsl #3   // 8 bytes per entry (2 instructions)
    br x19

.align 3
add_ext_option_table:
    uxtb w3, w3                // 0: UXTB
    b add_ext_shift
    uxth w3, w3                // 1: UXTH
    b add_ext_shift
    mov w3, w3                 // 2: UXTW (32-bit, or same as LSL for sf=0)
    b add_ext_shift
    b add_ext_shift              // 3: UXTX (no extension needed for 64-bit)
    nop
    sxtb x3, w3                // 4: SXTB
    b add_ext_shift
    sxth x3, w3                // 5: SXTH
    b add_ext_shift
    sxtw x3, w3                // 6: SXTW
    b add_ext_shift
    b add_ext_shift              // 7: SXTX (no extension needed)
    nop

add_ext_shift:
    // Apply shift (imm3)
    lsl x3, x3, x13

    // Add
    add x19, x17, x3

    // Handle 32-bit
    cbz x14, add_ext_32
    b add_ext_store
add_ext_32:
    and x19, x19, #0xffffffff

add_ext_store:
    // Store result
    cmp x9, #31
    b.eq add_ext_store_sp
    str x19, [x16, x9, lsl #3]
    gret
add_ext_store_sp:
    // Mask to 48 bits before writing to SP
    and x19, x19, #0xffffffffffff
    str x19, [_cpu, #CPU_sp]
    gret

.gadget sub_ext
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #3   // option
    ubfx x13, x8, #27, #3   // imm3 (shift amount)
    ubfx x14, x8, #30, #1   // sf
    ubfx x15, x8, #31, #1   // S

    add x16, _cpu, #CPU_x0

    // Load Rn (or SP if rn == 31)
    cmp x10, #31
    b.eq sub_ext_load_sp_rn
    ldr x17, [x16, x10, lsl #3]
    b sub_ext_load_rm
sub_ext_load_sp_rn:
    ldr x17, [_cpu, #CPU_sp]

sub_ext_load_rm:
    // Load Rm
    cmp x11, #31
    mov x3, #0
    b.eq sub_ext_apply
    ldr x3, [x16, x11, lsl #3]

sub_ext_apply:
    // Apply extension
    adr x19, sub_ext_option_table
    add x19, x19, x12, lsl #3
    br x19

.align 3
sub_ext_option_table:
    uxtb w3, w3                // 0: UXTB
    b sub_ext_shift
    uxth w3, w3                // 1: UXTH
    b sub_ext_shift
    mov w3, w3                 // 2: UXTW
    b sub_ext_shift
    b sub_ext_shift              // 3: UXTX
    nop
    sxtb x3, w3                // 4: SXTB
    b sub_ext_shift
    sxth x3, w3                // 5: SXTH
    b sub_ext_shift
    sxtw x3, w3                // 6: SXTW
    b sub_ext_shift
    b sub_ext_shift              // 7: SXTX
    nop

sub_ext_shift:
    lsl x3, x3, x13

    // Subtract
    sub x19, x17, x3

    // Handle 32-bit
    cbz x14, sub_ext_32
    b sub_ext_store
sub_ext_32:
    and x19, x19, #0xffffffff

sub_ext_store:
    cmp x9, #31
    b.eq sub_ext_store_sp
    str x19, [x16, x9, lsl #3]
    gret
sub_ext_store_sp:
    // Mask to 48 bits before writing to SP
    and x19, x19, #0xffffffffffff
    str x19, [_cpu, #CPU_sp]
    gret

/*
 * SUBS (extended register) - with flag setting
 * Used for CMP with extended register operand
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | option<<24 | imm3<<27 | sf<<30]
 */
.gadget subs_ext
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #3   // option
    ubfx x13, x8, #27, #3   // imm3 (shift amount)
    ubfx x14, x8, #30, #1   // sf

    add x16, _cpu, #CPU_x0

    // Load Rn (or SP if rn == 31)
    cmp x10, #31
    b.eq subs_ext_load_sp_rn
    ldr x17, [x16, x10, lsl #3]
    b subs_ext_load_rm
subs_ext_load_sp_rn:
    ldr x17, [_cpu, #CPU_sp]

subs_ext_load_rm:
    // Load Rm
    cmp x11, #31
    mov x3, #0
    b.eq subs_ext_apply
    ldr x3, [x16, x11, lsl #3]

subs_ext_apply:
    // Apply extension based on option field
    adr x19, subs_ext_option_table
    add x19, x19, x12, lsl #3
    br x19

.align 3
subs_ext_option_table:
    uxtb w3, w3                // 0: UXTB
    b subs_ext_shift
    uxth w3, w3                // 1: UXTH
    b subs_ext_shift
    mov w3, w3                 // 2: UXTW
    b subs_ext_shift
    b subs_ext_shift             // 3: UXTX
    nop
    sxtb x3, w3                // 4: SXTB
    b subs_ext_shift
    sxth x3, w3                // 5: SXTH
    b subs_ext_shift
    sxtw x3, w3                // 6: SXTW
    b subs_ext_shift
    b subs_ext_shift             // 7: SXTX
    nop

subs_ext_shift:
    lsl x3, x3, x13

    // Subtract with flag setting
    cbz x14, subs_ext_32
    // 64-bit
    subs x19, x17, x3
    b subs_ext_store_flags

subs_ext_32:
    // 32-bit: use 32-bit subs for correct flag generation
    subs w19, w17, w3
    // Result is already zero-extended

subs_ext_store_flags:
    // Store NZCV flags
    store_flags

    // Store result (only if rd != 31, i.e., not CMP)
    cmp x9, #31
    b.eq subs_ext_done      // rd=31 means ZR (CMP), discard result
    str x19, [x16, x9, lsl #3]
subs_ext_done:
    gret

/*
 * ADDS (extended register) - with flag setting
 * Used for CMN with extended register operand
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | option<<24 | imm3<<27 | sf<<30]
 */
.gadget adds_ext
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #3   // option
    ubfx x13, x8, #27, #3   // imm3 (shift amount)
    ubfx x14, x8, #30, #1   // sf

    add x16, _cpu, #CPU_x0

    // Load Rn (or SP if rn == 31)
    cmp x10, #31
    b.eq adds_ext_load_sp_rn
    ldr x17, [x16, x10, lsl #3]
    b adds_ext_load_rm
adds_ext_load_sp_rn:
    ldr x17, [_cpu, #CPU_sp]

adds_ext_load_rm:
    // Load Rm
    cmp x11, #31
    mov x3, #0
    b.eq adds_ext_apply
    ldr x3, [x16, x11, lsl #3]

adds_ext_apply:
    // Apply extension based on option field
    adr x19, adds_ext_option_table
    add x19, x19, x12, lsl #3
    br x19

.align 3
adds_ext_option_table:
    uxtb w3, w3                // 0: UXTB
    b adds_ext_shift
    uxth w3, w3                // 1: UXTH
    b adds_ext_shift
    mov w3, w3                 // 2: UXTW
    b adds_ext_shift
    b adds_ext_shift             // 3: UXTX
    nop
    sxtb x3, w3                // 4: SXTB
    b adds_ext_shift
    sxth x3, w3                // 5: SXTH
    b adds_ext_shift
    sxtw x3, w3                // 6: SXTW
    b adds_ext_shift
    b adds_ext_shift             // 7: SXTX
    nop

adds_ext_shift:
    lsl x3, x3, x13

    // Add with flag setting
    cbz x14, adds_ext_32
    // 64-bit
    adds x19, x17, x3
    b adds_ext_store_flags

adds_ext_32:
    // 32-bit: use 32-bit adds for correct flag generation
    adds w19, w17, w3
    // Result is already zero-extended

adds_ext_store_flags:
    // Store NZCV flags
    store_flags

    // Store result (only if rd != 31, i.e., not CMN)
    cmp x9, #31
    b.eq adds_ext_done
    str x19, [x16, x9, lsl #3]
adds_ext_done:
    gret

/*
 * Multiply instructions (3-source)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | ra<<24 | sf<<29]
 */

// MADD: Xd = Xa + (Xn * Xm)
// MUL is MADD with Ra=XZR (31)
.gadget madd
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra
    ubfx x13, x8, #29, #1   // sf

    add x14, _cpu, #CPU_x0

    // Load Rn
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    // Load Rm
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    // Load Ra
    cmp x12, #31
    mov x17, #0
    b.eq 3f
    ldr x17, [x14, x12, lsl #3]
3:
    // Compute: result = Ra + (Rn * Rm)
    cbz x13, madd_32
    // 64-bit
    madd x3, x15, x16, x17
    b madd_store

madd_32:
    // 32-bit
    madd w3, w15, w16, w17
    // Result already zero-extended

madd_store:
    cmp x9, #31
    b.eq 4f
    str x3, [x14, x9, lsl #3]
4:  gret

// MSUB: Xd = Xa - (Xn * Xm)
// MNEG is MSUB with Ra=XZR (31)
.gadget msub
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra
    ubfx x13, x8, #29, #1   // sf

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cmp x12, #31
    mov x17, #0
    b.eq 3f
    ldr x17, [x14, x12, lsl #3]
3:
    // Compute: result = Ra - (Rn * Rm)
    cbz x13, msub_32
    // 64-bit
    msub x3, x15, x16, x17
    b msub_store

msub_32:
    // 32-bit
    msub w3, w15, w16, w17

msub_store:
    cmp x9, #31
    b.eq 4f
    str x3, [x14, x9, lsl #3]
4:  gret

// SMADDL: Xd = Xa + (sign_extend(Wn) * sign_extend(Wm))
// SMULL is SMADDL with Ra=XZR (31)
.gadget smaddl
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    add x14, _cpu, #CPU_x0

    // Load Rn (use full register, smaddl will take low 32 bits)
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    // Load Rm
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    // Load Xa (64-bit)
    cmp x12, #31
    mov x17, #0
    b.eq 3f
    ldr x17, [x14, x12, lsl #3]
3:
    // Compute: result = Xa + (sign_extend(Wn) * sign_extend(Wm))
    smaddl x3, w15, w16, x17

    cmp x9, #31
    b.eq 4f
    str x3, [x14, x9, lsl #3]
4:  gret

// SMSUBL: Xd = Xa - (sign_extend(Wn) * sign_extend(Wm))
// SMNEGL is SMSUBL with Ra=XZR (31)
.gadget smsubl
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cmp x12, #31
    mov x17, #0
    b.eq 3f
    ldr x17, [x14, x12, lsl #3]
3:
    smsubl x3, w15, w16, x17

    cmp x9, #31
    b.eq 4f
    str x3, [x14, x9, lsl #3]
4:  gret

// UMADDL: Xd = Xa + (zero_extend(Wn) * zero_extend(Wm))
// UMULL is UMADDL with Ra=XZR (31)
.gadget umaddl
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cmp x12, #31
    mov x17, #0
    b.eq 3f
    ldr x17, [x14, x12, lsl #3]
3:
    umaddl x3, w15, w16, x17

    cmp x9, #31
    b.eq 4f
    str x3, [x14, x9, lsl #3]
4:  gret

// UMSUBL: Xd = Xa - (zero_extend(Wn) * zero_extend(Wm))
// UMNEGL is UMSUBL with Ra=XZR (31)
.gadget umsubl
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    add x14, _cpu, #CPU_x0

    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    cmp x12, #31
    mov x17, #0
    b.eq 3f
    ldr x17, [x14, x12, lsl #3]
3:
    umsubl x3, w15, w16, x17

    cmp x9, #31
    b.eq 4f
    str x3, [x14, x9, lsl #3]
4:  gret


/*
 * Byte reverse gadgets (REV, REV16, REV32)
 * Code stream: [gadget addr][rd | rn<<8 | sf<<24]
 */

// REV - Reverse bytes (64-bit or 32-bit)
.gadget rev
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #24, #1   // sf

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr _tmp, [x13, x10, lsl #3]
    b 2f
1:  mov _tmp, #0
2:
    // Byte reverse using rev instruction
    cbz x12, .Lrev_32
    rev _tmp, _tmp
    b .Lrev_store
.Lrev_32:
    rev w0, w0              // _tmp is x0
.Lrev_store:
    cmp x9, #31
    b.eq 3f
    str _tmp, [x13, x9, lsl #3]
3:  gret

// REV16 - Reverse bytes in each 16-bit halfword
.gadget rev16
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #24, #1   // sf

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr _tmp, [x13, x10, lsl #3]
    b 2f
1:  mov _tmp, #0
2:
    cbz x12, .Lrev16_32
    rev16 _tmp, _tmp
    b .Lrev16_store
.Lrev16_32:
    rev16 w0, w0
.Lrev16_store:
    cmp x9, #31
    b.eq 3f
    str _tmp, [x13, x9, lsl #3]
3:  gret

// REV32 - Reverse bytes in each 32-bit word (64-bit only)
.gadget rev32
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr _tmp, [x13, x10, lsl #3]
    b 2f
1:  mov _tmp, #0
2:
    rev32 _tmp, _tmp
    cmp x9, #31
    b.eq 3f
    str _tmp, [x13, x9, lsl #3]
3:  gret

// CLZ - Count Leading Zeros
.gadget clz
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #24, #1   // sf

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr _tmp, [x13, x10, lsl #3]
    b 2f
1:  mov _tmp, #0
2:
    cbz x12, .Lclz_32
    clz _tmp, _tmp
    b .Lclz_store
.Lclz_32:
    clz w0, w0
.Lclz_store:
    cmp x9, #31
    b.eq 3f
    str _tmp, [x13, x9, lsl #3]
3:  gret

// CLS - Count Leading Sign bits
.gadget cls
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #24, #1   // sf

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr _tmp, [x13, x10, lsl #3]
    b 2f
1:  mov _tmp, #0
2:
    cbz x12, .Lcls_32
    cls _tmp, _tmp
    b .Lcls_store
.Lcls_32:
    cls w0, w0
.Lcls_store:
    cmp x9, #31
    b.eq 3f
    str _tmp, [x13, x9, lsl #3]
3:  gret

// RBIT - Reverse Bits
.gadget rbit
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #24, #1   // sf

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr _tmp, [x13, x10, lsl #3]
    b 2f
1:  mov _tmp, #0
2:
    cbz x12, .Lrbit_32
    rbit _tmp, _tmp
    b .Lrbit_store
.Lrbit_32:
    rbit w0, w0
.Lrbit_store:
    cmp x9, #31
    b.eq 3f
    str _tmp, [x13, x9, lsl #3]
3:  gret

/*
 * System register gadgets
 */

// MSR TPIDR_EL0, Xt - write TLS pointer
// Code stream: [gadget addr][rt]
.gadget msr_tpidr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x8, x8, #0x1f       // rt

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x10, [x9, x8, lsl #3]
    b 2f
1:  mov x10, #0
2:
    str x10, [_cpu, #CPU_tls_ptr]
    gret

// MRS Xt, TPIDR_EL0 - read TLS pointer
// Code stream: [gadget addr][rt]
.gadget mrs_tpidr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x8, x8, #0x1f       // rt

    ldr x10, [_cpu, #CPU_tls_ptr]

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    str x10, [x9, x8, lsl #3]
1:  gret

// MRS Xt, NZCV - read condition flags register
// Code stream: [gadget addr][rt]
// NZCV value is in bits [31:28] of the word
.gadget mrs_nzcv
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f       // rt

    ldr w10, [_cpu, #CPU_nzcv]

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    // Zero-extend to 64-bit and store
    mov x11, x10
    str x11, [x9, x8, lsl #3]
1:  gret

// MSR NZCV, Xt - write condition flags register
// Code stream: [gadget addr][rt]
.gadget msr_nzcv
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f       // rt

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x10, [x9, x8, lsl #3]
    b 2f
1:  mov x10, #0
2:
    str w10, [_cpu, #CPU_nzcv]
    gret

// MSR FPCR, Xt - write floating-point control register
// Code stream: [gadget addr][rt]
.gadget msr_fpcr
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f       // rt

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x10, [x9, x8, lsl #3]
    b 2f
1:  mov x10, #0
2:
    str w10, [_cpu, #CPU_fpcr]
    gret

// MSR FPSR, Xt - write floating-point status register
// Code stream: [gadget addr][rt]
.gadget msr_fpsr
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f       // rt

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x10, [x9, x8, lsl #3]
    b 2f
1:  mov x10, #0
2:
    str w10, [_cpu, #CPU_fpsr]
    gret

// MSR DAIF, Xt - write interrupt mask register (NOP in emulation)
// Go runtime uses this for async preemption control.
// Code stream: [gadget addr][rt]
.gadget msr_daif
    ldr x8, [_pc]
    add _pc, _pc, #8
    // NOP — we don't emulate interrupt masking
    gret

// DC ZVA, Xt - zero a 64-byte naturally aligned data-cache block.
// Code stream: [gadget addr][rt]
.gadget dc_zva
    ldr x8, [_pc]           // rt
    add _pc, _pc, #8
    and x8, x8, #0x1f

    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    ldr x12, [x9, x8, lsl #3]
    b 2f
1:  mov x12, #0             // XZR as the address operand if rt==31
2:  and x12, x12, #0xffffffffffff
    and x12, x12, #0xffffffffffffffc0

    stp x19, x20, [sp, #-16]!
    mov x19, x12
    save_c
    sub x0, _tlb, #TLB_entries
    mov x1, x19
    mov x2, #64
    bl NAME(__tlb_zero)
    mov x20, x0
    restore_c
    cbz x20, 3f
    ldp x19, x20, [sp], #16
    gret

3:  ldp x19, x20, [sp], #16
    ldr x8, [_tlb, #(-TLB_entries+TLB_segfault_addr)]
    str x8, [_cpu, #CPU_segfault_addr]
    mov w9, #1
    strb w9, [_cpu, #CPU_segfault_was_write]
    ldr x8, [_cpu, #LOCAL_jit_saved_pc]
    str x8, [_cpu, #CPU_pc]
    mov w0, #INT_GPF
    b fiber_exit

// MRS Xt, <sysreg> - generic system register read
// Code stream: [gadget addr][rt][sysreg_id]
// sysreg_id values:
//   0 = TPIDR_EL0 (TLS pointer)
//   1 = CTR_EL0 (Cache Type Register)
//   2 = DCZID_EL0 (Data Cache Zero ID)
//   3 = FPCR (Floating-Point Control Register)
//   4 = FPSR (Floating-Point Status Register)
//   5 = RNDR (Random Number register)
//   6 = RNDRRS (Reseeded Random Number register)
//   7 = ID_AA64PFR0_EL1
//   8 = ID_AA64PFR1_EL1
//   9 = ID_AA64ISAR0_EL1
//  10 = ID_AA64ISAR1_EL1
//  11 = ID_AA64ZFR0_EL1
//  12 = CNTVCT_EL0
//  13 = CNTFRQ_EL0
//  14 = MIDR_EL1
//  15 = zero-valued feature/debug ID register
.gadget mrs_sysreg
    ldr x8, [_pc]           // rt
    ldr x11, [_pc, #8]      // sysreg_id
    add _pc, _pc, #16

    and x8, x8, #0x1f       // rt

    // Load value based on sysreg_id
    cmp x11, #0
    b.eq .Lmrs_tpidr_el0
    cmp x11, #1
    b.eq .Lmrs_ctr_el0
    cmp x11, #2
    b.eq .Lmrs_dczid_el0
    cmp x11, #3
    b.eq .Lmrs_fpcr
    cmp x11, #4
    b.eq .Lmrs_fpsr
    cmp x11, #5
    b.eq .Lmrs_rndr
    cmp x11, #6
    b.eq .Lmrs_rndrrs
    cmp x11, #7
    b.eq .Lmrs_id_aa64pfr0
    cmp x11, #8
    b.eq .Lmrs_id_aa64pfr1
    cmp x11, #9
    b.eq .Lmrs_id_aa64isar0
    cmp x11, #10
    b.eq .Lmrs_id_aa64isar1
    cmp x11, #11
    b.eq .Lmrs_id_aa64zfr0
    cmp x11, #12
    b.eq .Lmrs_cntvct_el0
    cmp x11, #13
    b.eq .Lmrs_cntfrq_el0
    cmp x11, #14
    b.eq .Lmrs_midr_el1
    cmp x11, #15
    b.eq .Lmrs_zero
    // Unknown sysreg - return 0
    mov x10, #0
    b .Lmrs_store

.Lmrs_tpidr_el0:
    ldr x10, [_cpu, #CPU_tls_ptr]
    b .Lmrs_store

.Lmrs_ctr_el0:
    // Cache Type Register - return typical ARM64 values
    // IminLine = 4 (2^4 = 16 words = 64 bytes)
    // DminLine = 4 (same)
    // L1Ip = 3 (PIPT)
    // ERG = 4 (64 bytes)
    // CWG = 4 (64 bytes)
    // Format: L1Ip[31:28]=3, ERG[27:24]=4, CWG[23:20]=4, DminLine[19:16]=4, IminLine[3:0]=4
    movz x10, #0x8444, lsl #16
    movk x10, #0x8004
    b .Lmrs_store

.Lmrs_dczid_el0:
    // Advertise DC ZVA with a 64-byte block (BS=4 => 4 << 4).
    // HotSpot probes this register during startup and emits DC ZVA stubs when
    // block zeroing is available; gadget_dc_zva implements the zeroing.
    mov x10, #0x4
    b .Lmrs_store

.Lmrs_fpcr:
    ldr w10, [_cpu, #CPU_fpcr]
    b .Lmrs_store

.Lmrs_fpsr:
    ldr w10, [_cpu, #CPU_fpsr]
    b .Lmrs_store

.Lmrs_rndr:
    // RNDR - Random Number register (ARMv8.5-RNG)
    // Return 0 and set Z=1 to indicate failure (no RNG available).
    mov x10, #0
    movz w17, #0x4000, lsl #16
    msr nzcv, x17
    b .Lmrs_store

.Lmrs_rndrrs:
    // RNDRRS - Reseeded Random Number register (ARMv8.5-RNG)
    // Return 0 and set Z=1 to indicate failure (no RNG available).
    mov x10, #0
    movz w17, #0x4000, lsl #16
    msr nzcv, x17
    b .Lmrs_store

.Lmrs_id_aa64pfr0:
    // ID_AA64PFR0_EL1:
    // EL0/EL1 AArch64 supported (bits [3:0]=1, [7:4]=1), SVE=0.
    mov x10, #0x11
    b .Lmrs_store

.Lmrs_id_aa64pfr1:
    // ID_AA64PFR1_EL1: report no optional features.
    mov x10, #0
    b .Lmrs_store

.Lmrs_id_aa64isar0:
    // ID_AA64ISAR0_EL1: report no optional crypto/SVE-related extensions.
    mov x10, #0
    b .Lmrs_store

.Lmrs_id_aa64isar1:
    // ID_AA64ISAR1_EL1: report no optional extensions.
    mov x10, #0
    b .Lmrs_store

.Lmrs_id_aa64zfr0:
    // ID_AA64ZFR0_EL1: SVE not supported.
    mov x10, #0
    b .Lmrs_store

.Lmrs_cntvct_el0:
    // CNTVCT_EL0 - Virtual counter timer
    // Read the host's virtual counter directly (same hardware)
    mrs x10, cntvct_el0
    b .Lmrs_store

.Lmrs_cntfrq_el0:
    // CNTFRQ_EL0 - Counter-timer frequency
    mrs x10, cntfrq_el0
    b .Lmrs_store

.Lmrs_midr_el1:
    // MIDR_EL1 - expose a generic ARMv8 Cortex-A53-class ID. Optional
    // features remain governed by HWCAP/ID_AA64* registers above.
    movz x10, #0xd034
    movk x10, #0x410f, lsl #16
    b .Lmrs_store

.Lmrs_zero:
    mov x10, #0
    b .Lmrs_store

.Lmrs_store:
    add x9, _cpu, #CPU_x0
    cmp x8, #31
    b.eq 1f
    str x10, [x9, x8, lsl #3]
1:  gret

/*
 * SIMD Gadgets (minimal set for musl memset)
 *
 * These implement just enough SIMD to support musl's optimized memset.
 */

/*
 * DUP Vd.16B, Wn - Duplicate byte from GPR to all 16 lanes
 * Code stream: [gadget addr][rd | rn<<8]
 *
 * This duplicates the low 8 bits of GPR Rn to all 16 bytes of vector Vd.
 */
.gadget dup_gpr_to_v16b
    ldr x8, [_pc]
    add _pc, _pc, #8
    
    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (gpr)
    
    // Load GPR value
    add x11, _cpu, #CPU_x0
    ldr x12, [x11, x10, lsl #3]
    
    // Extract low byte and replicate to all 16 bytes
    and x12, x12, #0xff
    // Create pattern: 0x0101010101010101 * byte_value
    mov x13, #0x0101010101010101
    mul x14, x12, x13
    
    // Store to vector register (both 64-bit halves)
    add x15, _cpu, #CPU_fp
    lsl x16, x9, #4         // each V reg is 16 bytes
    add x15, x15, x16       // x15 = base of vector register
    str x14, [x15]
    str x14, [x15, #8]
    gret

/*
 * DUP Vd.<T>, Wn - Duplicate element from GPR to all vector lanes (general)
 * Code stream: [gadget addr][rd | rn<<8 | elem_size<<16 | Q<<24]
 *
 * elem_size: 0=B (byte), 1=H (halfword), 2=S (word), 3=D (doubleword)
 * Q: 0=64-bit vector (lower half only), 1=128-bit vector
 */
.gadget dup_gpr_to_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #4   // elem_size
    ubfx x17, x8, #24, #1   // Q

    // Load GPR value
    add x12, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x13, [x12, x10, lsl #3]
    b 2f
1:  mov x13, #0             // XZR
2:
    // Get vector register base
    add x15, _cpu, #CPU_fp
    lsl x16, x9, #4         // each V reg is 16 bytes
    add x15, x15, x16       // x15 = base of vector register

    // Branch based on element size
    cmp x11, #0
    b.eq .Ldup_byte
    cmp x11, #1
    b.eq .Ldup_halfword
    cmp x11, #2
    b.eq .Ldup_word
    b .Ldup_doubleword

.Ldup_byte:
    // Replicate byte to all 8 bytes in a 64-bit word
    and x13, x13, #0xff
    mov x14, #0x0101010101010101
    mul x14, x13, x14
    str x14, [x15]          // low 64 bits
    cbz x17, .Ldup_clear_high
    str x14, [x15, #8]      // high 64 bits (only if Q=1)
    gret

.Ldup_halfword:
    // Replicate halfword to all 4 halfwords in a 64-bit word
    and x13, x13, #0xffff
    mov x14, #0x0001000100010001
    mul x14, x13, x14
    str x14, [x15]
    cbz x17, .Ldup_clear_high
    str x14, [x15, #8]
    gret

.Ldup_word:
    // Replicate word to both words in a 64-bit value
    and x13, x13, #0xffffffff
    orr x14, x13, x13, lsl #32
    str x14, [x15]
    cbz x17, .Ldup_clear_high
    str x14, [x15, #8]
    gret

.Ldup_doubleword:
    // Just duplicate the 64-bit value
    str x13, [x15]
    cbz x17, .Ldup_clear_high
    str x13, [x15, #8]
    gret

.Ldup_clear_high:
    // For Q=0, clear the high 64 bits
    str xzr, [x15, #8]
    gret

/*
 * DUP Vd.<T>, Vn.<Ts>[idx] - Duplicate element from vector to all lanes
 * Code stream: [gadget addr][rd | rn<<8 | elem_size<<16 | index<<20 | Q<<24]
 *
 * elem_size: 0=B (byte), 1=H (halfword), 2=S (word), 3=D (doubleword)
 * index: element index to duplicate
 * Q: 0=64-bit vector (lower half only), 1=128-bit vector
 */
.gadget dup_elem_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (vector)
    ubfx x11, x8, #16, #4   // elem_size
    ubfx x12, x8, #20, #4   // index
    ubfx x17, x8, #24, #1   // Q

    // Get source and destination vector register bases
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4        // source offset
    add x14, x13, x14       // x14 = &Vn
    lsl x15, x9, #4         // dest offset
    add x15, x13, x15       // x15 = &Vd

    // Load the source vector into v0
    ldr q0, [x14]

    // Branch based on element size
    cmp x11, #0
    b.eq .Ldup_elem_byte
    cmp x11, #1
    b.eq .Ldup_elem_half
    cmp x11, #2
    b.eq .Ldup_elem_word
    b .Ldup_elem_dword

.Ldup_elem_byte:
    // DUP Vd.xB, Vn.B[idx]
    // Use native dup instruction by loading index into vector and using TBL
    // Simpler: extract byte and broadcast manually
    // x12 = index (0-15)
    // Extract the byte at index into x13
    and x12, x12, #0xf
    lsr x16, x12, #3        // which 64-bit half (0 or 1)
    and x12, x12, #7        // byte offset within half
    cbz x16, .Ldup_elem_byte_lo
    mov x13, v0.d[1]
    b .Ldup_elem_byte_extract
.Ldup_elem_byte_lo:
    mov x13, v0.d[0]
.Ldup_elem_byte_extract:
    lsl x12, x12, #3        // bit offset
    lsr x13, x13, x12
    and x13, x13, #0xff
    // Broadcast byte to all lanes
    mov x14, #0x0101010101010101
    mul x14, x13, x14
    str x14, [x15]
    cbz x17, .Ldup_elem_clear_high
    str x14, [x15, #8]
    gret

.Ldup_elem_half:
    // DUP Vd.xH, Vn.H[idx]
    and x12, x12, #0x7
    lsr x16, x12, #2        // which 64-bit half
    and x12, x12, #3        // halfword offset within half
    cbz x16, .Ldup_elem_half_lo
    mov x13, v0.d[1]
    b .Ldup_elem_half_extract
.Ldup_elem_half_lo:
    mov x13, v0.d[0]
.Ldup_elem_half_extract:
    lsl x12, x12, #4        // bit offset (16 bits per element)
    lsr x13, x13, x12
    and x13, x13, #0xffff
    mov x14, #0x0001000100010001
    mul x14, x13, x14
    str x14, [x15]
    cbz x17, .Ldup_elem_clear_high
    str x14, [x15, #8]
    gret

.Ldup_elem_word:
    // DUP Vd.xS, Vn.S[idx]
    and x12, x12, #0x3
    lsr x16, x12, #1        // which 64-bit half
    and x12, x12, #1        // word offset within half
    cbz x16, .Ldup_elem_word_lo
    mov x13, v0.d[1]
    b .Ldup_elem_word_extract
.Ldup_elem_word_lo:
    mov x13, v0.d[0]
.Ldup_elem_word_extract:
    cbz x12, .Ldup_elem_word_done
    lsr x13, x13, #32       // get high word
.Ldup_elem_word_done:
    and x13, x13, #0xffffffff
    orr x14, x13, x13, lsl #32
    str x14, [x15]
    cbz x17, .Ldup_elem_clear_high
    str x14, [x15, #8]
    gret

.Ldup_elem_dword:
    // DUP Vd.2D, Vn.D[idx]
    and x12, x12, #0x1
    cbz x12, .Ldup_elem_dword_lo
    mov x13, v0.d[1]
    b .Ldup_elem_dword_store
.Ldup_elem_dword_lo:
    mov x13, v0.d[0]
.Ldup_elem_dword_store:
    str x13, [x15]
    cbz x17, .Ldup_elem_clear_high
    str x13, [x15, #8]
    gret

.Ldup_elem_clear_high:
    str xzr, [x15, #8]
    gret

/*
 * DUP <V>d, Vn.<T>[idx] - Duplicate element from vector to scalar register
 * Code stream: [gadget addr][rd | rn<<8 | elem_size<<16 | index<<20]
 *
 * elem_size: 0=B (byte), 1=H (halfword), 2=S (word), 3=D (doubleword)
 * index: element index to duplicate
 * Result is stored in a scalar register (B/H/S/D) with upper bits cleared
 */
.gadget dup_elem_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (scalar dest)
    ubfx x10, x8, #8, #5    // rn (vector source)
    ubfx x11, x8, #16, #4   // elem_size
    ubfx x12, x8, #20, #4   // index

    // Get source vector register base
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // x14 = &Vn

    // Get destination register base
    lsl x15, x9, #4
    add x15, x13, x15       // x15 = &Vd

    // Load the source vector into v0
    ldr q0, [x14]

    // Branch based on element size
    cmp x11, #0
    b.eq .Ldup_scalar_byte
    cmp x11, #1
    b.eq .Ldup_scalar_half
    cmp x11, #2
    b.eq .Ldup_scalar_word
    b .Ldup_scalar_dword

.Ldup_scalar_byte:
    // DUP Bd, Vn.B[idx]
    and x12, x12, #0xf
    lsr x16, x12, #3        // which 64-bit half (0 or 1)
    and x12, x12, #7        // byte offset within half
    cbz x16, .Ldup_scalar_byte_lo
    mov x13, v0.d[1]
    b .Ldup_scalar_byte_extract
.Ldup_scalar_byte_lo:
    mov x13, v0.d[0]
.Ldup_scalar_byte_extract:
    lsl x12, x12, #3        // bit offset
    lsr x13, x13, x12
    and x13, x13, #0xff
    // Store byte to scalar, clear rest
    str x13, [x15]
    str xzr, [x15, #8]
    gret

.Ldup_scalar_half:
    // DUP Hd, Vn.H[idx]
    and x12, x12, #0x7
    lsr x16, x12, #2        // which 64-bit half
    and x12, x12, #3        // halfword offset within half
    cbz x16, .Ldup_scalar_half_lo
    mov x13, v0.d[1]
    b .Ldup_scalar_half_extract
.Ldup_scalar_half_lo:
    mov x13, v0.d[0]
.Ldup_scalar_half_extract:
    lsl x12, x12, #4        // bit offset (16 bits per element)
    lsr x13, x13, x12
    and x13, x13, #0xffff
    str x13, [x15]
    str xzr, [x15, #8]
    gret

.Ldup_scalar_word:
    // DUP Sd, Vn.S[idx]
    and x12, x12, #0x3
    lsr x16, x12, #1        // which 64-bit half
    and x12, x12, #1        // word offset within half
    cbz x16, .Ldup_scalar_word_lo
    mov x13, v0.d[1]
    b .Ldup_scalar_word_extract
.Ldup_scalar_word_lo:
    mov x13, v0.d[0]
.Ldup_scalar_word_extract:
    cbz x12, .Ldup_scalar_word_done
    lsr x13, x13, #32       // get high word
.Ldup_scalar_word_done:
    and x13, x13, #0xffffffff
    str x13, [x15]
    str xzr, [x15, #8]
    gret

.Ldup_scalar_dword:
    // DUP Dd, Vn.D[idx]
    and x12, x12, #0x1
    cbz x12, .Ldup_scalar_dword_lo
    mov x13, v0.d[1]
    b .Ldup_scalar_dword_store
.Ldup_scalar_dword_lo:
    mov x13, v0.d[0]
.Ldup_scalar_dword_store:
    str x13, [x15]
    str xzr, [x15, #8]
    gret

/*
 * INS Vd.<T>[dst_idx], Vn.<T>[src_idx] - Insert element from one vector to another
 * Code stream: [gadget addr][rd | rn<<8 | elem_size<<16 | dst_idx<<20 | src_idx<<24]
 *
 * elem_size: 0=B, 1=H, 2=S, 3=D
 */
.gadget ins_elem_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (vector)
    ubfx x11, x8, #16, #4   // elem_size
    ubfx x12, x8, #20, #4   // dst_idx
    ubfx x13, x8, #24, #4   // src_idx

    // Get source and destination vector register bases
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x15, x14, x15       // x15 = &Vn (source)
    lsl x16, x9, #4
    add x16, x14, x16       // x16 = &Vd (destination)

    // Load source vector
    ldr q0, [x15]
    // Load destination vector (we'll modify one element)
    ldr q1, [x16]

    // Branch based on element size
    cmp x11, #0
    b.eq .Lins_elem_byte
    cmp x11, #1
    b.eq .Lins_elem_half
    cmp x11, #2
    b.eq .Lins_elem_word
    b .Lins_elem_dword

.Lins_elem_byte:
    // Extract source byte at src_idx
    and x13, x13, #0xf
    lsr x17, x13, #3        // which half
    and x13, x13, #7        // byte within half
    cbz x17, .Lins_byte_src_lo
    mov x3, v0.d[1]
    b .Lins_byte_src_done
.Lins_byte_src_lo:
    mov x3, v0.d[0]
.Lins_byte_src_done:
    lsl x13, x13, #3
    lsr x3, x3, x13
    and x3, x3, #0xff     // x3 = source byte

    // Insert into destination at dst_idx
    and x12, x12, #0xf
    lsr x17, x12, #3        // which half
    and x12, x12, #7        // byte within half
    lsl x12, x12, #3        // bit offset

    mov x19, #0xff
    lsl x19, x19, x12       // mask for target byte
    lsl x3, x3, x12       // shift source to position

    cbz x17, .Lins_byte_dst_lo
    mov x20, v1.d[1]
    bic x20, x20, x19       // clear target byte
    orr x20, x20, x3       // insert source
    mov v1.d[1], x20
    b .Lins_byte_store
.Lins_byte_dst_lo:
    mov x20, v1.d[0]
    bic x20, x20, x19
    orr x20, x20, x3
    mov v1.d[0], x20
.Lins_byte_store:
    str q1, [x16]
    gret

.Lins_elem_half:
    // Extract source halfword at src_idx
    and x13, x13, #0x7
    lsr x17, x13, #2
    and x13, x13, #3
    cbz x17, .Lins_half_src_lo
    mov x3, v0.d[1]
    b .Lins_half_src_done
.Lins_half_src_lo:
    mov x3, v0.d[0]
.Lins_half_src_done:
    lsl x13, x13, #4
    lsr x3, x3, x13
    and x3, x3, #0xffff

    and x12, x12, #0x7
    lsr x17, x12, #2
    and x12, x12, #3
    lsl x12, x12, #4

    mov x19, #0xffff
    lsl x19, x19, x12
    lsl x3, x3, x12

    cbz x17, .Lins_half_dst_lo
    mov x20, v1.d[1]
    bic x20, x20, x19
    orr x20, x20, x3
    mov v1.d[1], x20
    b .Lins_half_store
.Lins_half_dst_lo:
    mov x20, v1.d[0]
    bic x20, x20, x19
    orr x20, x20, x3
    mov v1.d[0], x20
.Lins_half_store:
    str q1, [x16]
    gret

.Lins_elem_word:
    // Extract source word at src_idx
    and x13, x13, #0x3
    lsr x17, x13, #1
    and x13, x13, #1
    cbz x17, .Lins_word_src_lo
    mov x3, v0.d[1]
    b .Lins_word_src_done
.Lins_word_src_lo:
    mov x3, v0.d[0]
.Lins_word_src_done:
    cbz x13, .Lins_word_src_shifted
    lsr x3, x3, #32
.Lins_word_src_shifted:
    and x3, x3, #0xffffffff

    and x12, x12, #0x3
    lsr x17, x12, #1
    and x12, x12, #1

    cbz x17, .Lins_word_dst_lo
    mov x20, v1.d[1]
    cbz x12, .Lins_word_dst_hi_lo
    // Insert into high word of high half
    and x20, x20, #0xffffffff
    orr x20, x20, x3, lsl #32
    b .Lins_word_dst_hi_done
.Lins_word_dst_hi_lo:
    // Insert into low word of high half
    and x20, x20, #0xffffffff00000000
    orr x20, x20, x3
.Lins_word_dst_hi_done:
    mov v1.d[1], x20
    b .Lins_word_store
.Lins_word_dst_lo:
    mov x20, v1.d[0]
    cbz x12, .Lins_word_dst_lo_lo
    // Insert into high word of low half
    and x20, x20, #0xffffffff
    orr x20, x20, x3, lsl #32
    b .Lins_word_dst_lo_done
.Lins_word_dst_lo_lo:
    // Insert into low word of low half
    and x20, x20, #0xffffffff00000000
    orr x20, x20, x3
.Lins_word_dst_lo_done:
    mov v1.d[0], x20
.Lins_word_store:
    str q1, [x16]
    gret

.Lins_elem_dword:
    // Extract source doubleword at src_idx
    and x13, x13, #0x1
    cbz x13, .Lins_dword_src_lo
    mov x3, v0.d[1]
    b .Lins_dword_src_done
.Lins_dword_src_lo:
    mov x3, v0.d[0]
.Lins_dword_src_done:

    and x12, x12, #0x1
    cbz x12, .Lins_dword_dst_lo
    mov v1.d[1], x3
    b .Lins_dword_store
.Lins_dword_dst_lo:
    mov v1.d[0], x3
.Lins_dword_store:
    str q1, [x16]
    gret

/*
 * MOV Xd, Vn.D[0] - Move low 64 bits of vector to GPR
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget mov_v_to_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (vector)

    // Load low 64 bits of vector
    add x11, _cpu, #CPU_fp
    lsl x12, x10, #4        // each V reg is 16 bytes
    ldr x13, [x11, x12]

    // Store to GPR (check for XZR)
    cmp x9, #31
    b.eq 1f                 // XZR - discard
    add x14, _cpu, #CPU_x0
    str x13, [x14, x9, lsl #3]
1:  gret

/*
 * UMOV/MOV - Move vector element to GPR (zero-extend)
 * Code stream: [gadget addr][rd | rn<<8 | elem_size<<16 | index<<20]
 *
 * elem_size: 0=B, 1=H, 2=S, 3=D
 * index: element index within 128-bit vector
 */
.gadget umov_vec_to_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #2   // elem_size
    ubfx x12, x8, #20, #4   // index

    // Load vector register
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    ldr x15, [x14]          // low 64
    ldr x16, [x14, #8]      // high 64

    // Extract element based on size/index
    cmp x11, #0
    b.eq .Lumov_b
    cmp x11, #1
    b.eq .Lumov_h
    cmp x11, #2
    b.eq .Lumov_s
    // size == 3 (D)
    b .Lumov_d

.Lumov_b:
    cmp x12, #8
    b.lt .Lumov_b_low
    sub x12, x12, #8
    lsl x17, x12, #3
    lsr x3, x16, x17
    and x3, x3, #0xff
    b .Lumov_store
.Lumov_b_low:
    lsl x17, x12, #3
    lsr x3, x15, x17
    and x3, x3, #0xff
    b .Lumov_store

.Lumov_h:
    cmp x12, #4
    b.lt .Lumov_h_low
    sub x12, x12, #4
    lsl x17, x12, #4
    lsr x3, x16, x17
    and x3, x3, #0xffff
    b .Lumov_store
.Lumov_h_low:
    lsl x17, x12, #4
    lsr x3, x15, x17
    and x3, x3, #0xffff
    b .Lumov_store

.Lumov_s:
    cmp x12, #2
    b.lt .Lumov_s_low
    sub x12, x12, #2
    lsl x17, x12, #5
    lsr x3, x16, x17
    and x3, x3, #0xffffffff
    b .Lumov_store
.Lumov_s_low:
    lsl x17, x12, #5
    lsr x3, x15, x17
    and x3, x3, #0xffffffff
    b .Lumov_store

.Lumov_d:
    cbz x12, .Lumov_d_low
    mov x3, x16
    b .Lumov_store
.Lumov_d_low:
    mov x3, x15

.Lumov_store:
    add x14, _cpu, #CPU_x0
    cmp x9, #31
    b.eq .Lumov_done
    str x3, [x14, x9, lsl #3]
.Lumov_done:
    gret

/*
 * MOV/INS - Insert GPR into vector element (S size)
 * Code stream: [gadget addr][rd | rn<<8 | index<<16]
 *
 * rd: destination vector register
 * rn: source GPR (Wn)
 * index: S element index (0..3)
 */
.gadget ins_gpr_to_vec_s
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #2   // index

    // Load 32-bit value from GPR
    add x12, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x13, [x12, x10, lsl #3]
    b 2f
1:  mov w13, #0
2:
    // Compute address of destination vector element
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15
    add x14, x14, x11, lsl #2

    // Store element
    str w13, [x14]
    gret

/*
 * MOV/INS - Insert GPR into vector element (D size)
 * Code stream: [gadget addr][rd | rn<<8 | index<<16]
 *
 * rd: destination vector register
 * rn: source GPR (Xn)
 * index: D element index (0..1)
 */
.gadget ins_gpr_to_vec_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #1   // index (0 or 1)

    // Load 64-bit value from GPR
    add x12, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x13, [x12, x10, lsl #3]
    b 2f
1:  mov x13, #0
2:
    // Compute address of destination vector element
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15
    add x14, x14, x11, lsl #3   // D element is 8 bytes

    // Store element
    str x13, [x14]
    gret

/*
 * MOV/INS - Insert GPR into vector element (H/halfword size)
 * Code stream: [gadget addr][rd | rn<<8 | index<<16]
 */
.gadget ins_gpr_to_vec_h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #3   // index (0..7)

    add x12, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x13, [x12, x10, lsl #3]
    b 2f
1:  mov w13, #0
2:
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15
    add x14, x14, x11, lsl #1   // H element is 2 bytes

    strh w13, [x14]
    gret

/*
 * MOV/INS - Insert GPR into vector element (B/byte size)
 * Code stream: [gadget addr][rd | rn<<8 | index<<16]
 */
.gadget ins_gpr_to_vec_b
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #4   // index (0..15)

    add x12, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x13, [x12, x10, lsl #3]
    b 2f
1:  mov w13, #0
2:
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15
    add x14, x14, x11           // B element is 1 byte

    strb w13, [x14]
    gret

/*
 * SSHLL - Signed shift left long (B->H)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 * Extends 8 bytes to 8 halfwords (sign-extend), then shift left
 */
.gadget sshll_vec_b_to_h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #4   // shift (0..7)

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13       // &Vn

    // Load 8 source bytes
    ldr x14, [x12]

    // Sign-extend each byte to halfword and shift
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3        // &Vd

    // Element 0
    sbfx x15, x14, #0, #8
    lsl x15, x15, x11
    strh w15, [x17, #0]
    // Element 1
    sbfx x15, x14, #8, #8
    lsl x15, x15, x11
    strh w15, [x17, #2]
    // Element 2
    sbfx x15, x14, #16, #8
    lsl x15, x15, x11
    strh w15, [x17, #4]
    // Element 3
    sbfx x15, x14, #24, #8
    lsl x15, x15, x11
    strh w15, [x17, #6]
    // Element 4
    sbfx x15, x14, #32, #8
    lsl x15, x15, x11
    strh w15, [x17, #8]
    // Element 5
    sbfx x15, x14, #40, #8
    lsl x15, x15, x11
    strh w15, [x17, #10]
    // Element 6
    sbfx x15, x14, #48, #8
    lsl x15, x15, x11
    strh w15, [x17, #12]
    // Element 7
    sbfx x15, x14, #56, #8
    lsl x15, x15, x11
    strh w15, [x17, #14]
    gret

/*
 * USHLL - Unsigned shift left long (B->H)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 */
.gadget ushll_vec_b_to_h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13

    ldr x14, [x12]

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    // Zero-extend each byte to halfword and shift
    ubfx x15, x14, #0, #8
    lsl x15, x15, x11
    strh w15, [x17, #0]
    ubfx x15, x14, #8, #8
    lsl x15, x15, x11
    strh w15, [x17, #2]
    ubfx x15, x14, #16, #8
    lsl x15, x15, x11
    strh w15, [x17, #4]
    ubfx x15, x14, #24, #8
    lsl x15, x15, x11
    strh w15, [x17, #6]
    ubfx x15, x14, #32, #8
    lsl x15, x15, x11
    strh w15, [x17, #8]
    ubfx x15, x14, #40, #8
    lsl x15, x15, x11
    strh w15, [x17, #10]
    ubfx x15, x14, #48, #8
    lsl x15, x15, x11
    strh w15, [x17, #12]
    ubfx x15, x14, #56, #8
    lsl x15, x15, x11
    strh w15, [x17, #14]
    gret

/*
 * SSHLL - Signed shift left long (H->S)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 * Extends 4 halfwords to 4 words (sign-extend), then shift left
 */
.gadget sshll_vec_h_to_s
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4   // shift (0..15)

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13

    ldr x14, [x12]          // 4 halfwords in 64 bits

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    // Sign-extend each halfword to word and shift
    sbfx x15, x14, #0, #16
    lsl w15, w15, w11
    str w15, [x17, #0]
    sbfx x15, x14, #16, #16
    lsl w15, w15, w11
    str w15, [x17, #4]
    sbfx x15, x14, #32, #16
    lsl w15, w15, w11
    str w15, [x17, #8]
    sbfx x15, x14, #48, #16
    lsl w15, w15, w11
    str w15, [x17, #12]
    gret

/*
 * USHLL - Unsigned shift left long (H->S)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 */
.gadget ushll_vec_h_to_s
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13

    ldr x14, [x12]

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    // Zero-extend each halfword to word and shift
    ubfx x15, x14, #0, #16
    lsl w15, w15, w11
    str w15, [x17, #0]
    ubfx x15, x14, #16, #16
    lsl w15, w15, w11
    str w15, [x17, #4]
    ubfx x15, x14, #32, #16
    lsl w15, w15, w11
    str w15, [x17, #8]
    ubfx x15, x14, #48, #16
    lsl w15, w15, w11
    str w15, [x17, #12]
    gret

/*
 * SSHLL2 - Signed shift left long (B->H, upper half)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 * Reads bytes 8..15, sign-extends to 8 halfwords
 */
.gadget sshll2_vec_b_to_h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]      // upper 8 bytes

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    sbfx x15, x14, #0, #8
    lsl x15, x15, x11
    strh w15, [x17, #0]
    sbfx x15, x14, #8, #8
    lsl x15, x15, x11
    strh w15, [x17, #2]
    sbfx x15, x14, #16, #8
    lsl x15, x15, x11
    strh w15, [x17, #4]
    sbfx x15, x14, #24, #8
    lsl x15, x15, x11
    strh w15, [x17, #6]
    sbfx x15, x14, #32, #8
    lsl x15, x15, x11
    strh w15, [x17, #8]
    sbfx x15, x14, #40, #8
    lsl x15, x15, x11
    strh w15, [x17, #10]
    sbfx x15, x14, #48, #8
    lsl x15, x15, x11
    strh w15, [x17, #12]
    sbfx x15, x14, #56, #8
    lsl x15, x15, x11
    strh w15, [x17, #14]
    gret

.gadget ushll2_vec_b_to_h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    ubfx x15, x14, #0, #8
    lsl x15, x15, x11
    strh w15, [x17, #0]
    ubfx x15, x14, #8, #8
    lsl x15, x15, x11
    strh w15, [x17, #2]
    ubfx x15, x14, #16, #8
    lsl x15, x15, x11
    strh w15, [x17, #4]
    ubfx x15, x14, #24, #8
    lsl x15, x15, x11
    strh w15, [x17, #6]
    ubfx x15, x14, #32, #8
    lsl x15, x15, x11
    strh w15, [x17, #8]
    ubfx x15, x14, #40, #8
    lsl x15, x15, x11
    strh w15, [x17, #10]
    ubfx x15, x14, #48, #8
    lsl x15, x15, x11
    strh w15, [x17, #12]
    ubfx x15, x14, #56, #8
    lsl x15, x15, x11
    strh w15, [x17, #14]
    gret

.gadget sshll2_vec_h_to_s
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]      // upper 4 halfwords

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    sbfx x15, x14, #0, #16
    lsl w15, w15, w11
    str w15, [x17, #0]
    sbfx x15, x14, #16, #16
    lsl w15, w15, w11
    str w15, [x17, #4]
    sbfx x15, x14, #32, #16
    lsl w15, w15, w11
    str w15, [x17, #8]
    sbfx x15, x14, #48, #16
    lsl w15, w15, w11
    str w15, [x17, #12]
    gret

.gadget ushll2_vec_h_to_s
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #4

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    ubfx x15, x14, #0, #16
    lsl w15, w15, w11
    str w15, [x17, #0]
    ubfx x15, x14, #16, #16
    lsl w15, w15, w11
    str w15, [x17, #4]
    ubfx x15, x14, #32, #16
    lsl w15, w15, w11
    str w15, [x17, #8]
    ubfx x15, x14, #48, #16
    lsl w15, w15, w11
    str w15, [x17, #12]
    gret

.gadget sshll2_vec_s_to_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]      // upper 2 words

    sxtw x15, w14
    asr x16, x14, #32

    lsl x15, x15, x11
    lsl x16, x16, x11

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    str x15, [x17]
    str x16, [x17, #8]
    gret

.gadget ushll2_vec_s_to_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]

    uxtw x15, w14
    lsr x16, x14, #32

    lsl x15, x15, x11
    lsl x16, x16, x11

    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    str x15, [x17]
    str x16, [x17, #8]
    gret

/*
 * SSHLL - Signed shift left long (S->D)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 *
 * rd: destination vector register (Vd.2D)
 * rn: source vector register (Vn.2S)
 * shift: immediate shift (0..31)
 */
.gadget sshll_vec_s_to_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // shift

    // Load source vector low 64 bits (two 32-bit elements)
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12]

    // Sign-extend each 32-bit element
    sxtw x15, w14           // element 0
    asr x16, x14, #32       // element 1 (sign-extended)

    // Shift left by immediate
    lsl x15, x15, x11
    lsl x16, x16, x11

    // Store to destination vector
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    str x15, [x17]
    str x16, [x17, #8]
    gret

/*
 * USHLL - Unsigned shift left long (S->D)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16]
 *
 * rd: destination vector register (Vd.2D)
 * rn: source vector register (Vn.2S)
 * shift: immediate shift (0..31)
 */
.gadget ushll_vec_s_to_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // shift

    // Load source vector low 64 bits (two 32-bit elements)
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12]

    // Zero-extend each 32-bit element
    uxtw x15, w14           // element 0
    lsr x16, x14, #32       // element 1

    // Shift left by immediate
    lsl x15, x15, x11
    lsl x16, x16, x11

    // Store to destination vector
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    str x15, [x17]
    str x16, [x17, #8]
    gret

/*
 * SHLL/SHLL2 - Shift left long by element size (two-reg misc)
 * Code stream: [gadget addr][rd | rn<<8]
 * Shift is fixed at element size (8 for B->H, 16 for H->S, 32 for S->D)
 */

// SHLL B->H: each byte << 8, result is halfword
.gadget shll_vec_b_to_h
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12]           // lower 8 bytes
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    ubfx x15, x14, #0, #8
    lsl x15, x15, #8
    strh w15, [x17, #0]
    ubfx x15, x14, #8, #8
    lsl x15, x15, #8
    strh w15, [x17, #2]
    ubfx x15, x14, #16, #8
    lsl x15, x15, #8
    strh w15, [x17, #4]
    ubfx x15, x14, #24, #8
    lsl x15, x15, #8
    strh w15, [x17, #6]
    ubfx x15, x14, #32, #8
    lsl x15, x15, #8
    strh w15, [x17, #8]
    ubfx x15, x14, #40, #8
    lsl x15, x15, #8
    strh w15, [x17, #10]
    ubfx x15, x14, #48, #8
    lsl x15, x15, #8
    strh w15, [x17, #12]
    ubfx x15, x14, #56, #8
    lsl x15, x15, #8
    strh w15, [x17, #14]
    gret

// SHLL2 B->H: upper 8 bytes << 8
.gadget shll2_vec_b_to_h
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]       // upper 8 bytes
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    ubfx x15, x14, #0, #8
    lsl x15, x15, #8
    strh w15, [x17, #0]
    ubfx x15, x14, #8, #8
    lsl x15, x15, #8
    strh w15, [x17, #2]
    ubfx x15, x14, #16, #8
    lsl x15, x15, #8
    strh w15, [x17, #4]
    ubfx x15, x14, #24, #8
    lsl x15, x15, #8
    strh w15, [x17, #6]
    ubfx x15, x14, #32, #8
    lsl x15, x15, #8
    strh w15, [x17, #8]
    ubfx x15, x14, #40, #8
    lsl x15, x15, #8
    strh w15, [x17, #10]
    ubfx x15, x14, #48, #8
    lsl x15, x15, #8
    strh w15, [x17, #12]
    ubfx x15, x14, #56, #8
    lsl x15, x15, #8
    strh w15, [x17, #14]
    gret

// SHLL H->S: each halfword << 16
.gadget shll_vec_h_to_s
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12]
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    ubfx x15, x14, #0, #16
    lsl w15, w15, #16
    str w15, [x17, #0]
    ubfx x15, x14, #16, #16
    lsl w15, w15, #16
    str w15, [x17, #4]
    ubfx x15, x14, #32, #16
    lsl w15, w15, #16
    str w15, [x17, #8]
    ubfx x15, x14, #48, #16
    lsl w15, w15, #16
    str w15, [x17, #12]
    gret

// SHLL2 H->S: upper 4 halfwords << 16
.gadget shll2_vec_h_to_s
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    ubfx x15, x14, #0, #16
    lsl w15, w15, #16
    str w15, [x17, #0]
    ubfx x15, x14, #16, #16
    lsl w15, w15, #16
    str w15, [x17, #4]
    ubfx x15, x14, #32, #16
    lsl w15, w15, #16
    str w15, [x17, #8]
    ubfx x15, x14, #48, #16
    lsl w15, w15, #16
    str w15, [x17, #12]
    gret

// SHLL S->D: each word << 32
.gadget shll_vec_s_to_d
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12]
    uxtw x15, w14
    lsl x15, x15, #32
    lsr x16, x14, #32
    lsl x16, x16, #32
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    str x15, [x17]
    str x16, [x17, #8]
    gret

// SHLL2 S->D: upper 2 words << 32
.gadget shll2_vec_s_to_d
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13
    ldr x14, [x12, #8]
    uxtw x15, w14
    lsl x15, x15, #32
    lsr x16, x14, #32
    lsl x16, x16, #32
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3
    str x15, [x17]
    str x16, [x17, #8]
    gret

/*
 * XTN/XTN2 - Narrow vector elements
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | hi<<18]
 *
 * size: 0=B (8-bit), 1=H (16-bit), 2=S (32-bit)
 * hi: 0=XTN (write low half, clear high), 1=XTN2 (write high half)
 */
.gadget xtn_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #2   // size
    ubfx x12, x8, #18, #1   // hi (xtn2)

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source vector into v1
    ldr q1, [x15]

    // For XTN2, preserve low half of destination in v0
    cbz x12, .Lxtn_no_preserve
    ldr q0, [x14]
.Lxtn_no_preserve:

    cmp x11, #0
    b.eq .Lxtn_size_b
    cmp x11, #1
    b.eq .Lxtn_size_h
    // size == 2
    b .Lxtn_size_s

.Lxtn_size_b:
    cbz x12, .Lxtn_b_low
    xtn2 v0.16b, v1.8h
    b .Lxtn_store_q
.Lxtn_b_low:
    xtn v0.8b, v1.8h
    b .Lxtn_store_low

.Lxtn_size_h:
    cbz x12, .Lxtn_h_low
    xtn2 v0.8h, v1.4s
    b .Lxtn_store_q
.Lxtn_h_low:
    xtn v0.4h, v1.4s
    b .Lxtn_store_low

.Lxtn_size_s:
    cbz x12, .Lxtn_s_low
    xtn2 v0.4s, v1.2d
    b .Lxtn_store_q
.Lxtn_s_low:
    xtn v0.2s, v1.2d
    b .Lxtn_store_low

.Lxtn_store_q:
    str q0, [x14]
    gret

.Lxtn_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * UZP1 - Unzip even elements
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * size: 0=B, 1=H, 2=S, 3=D
 * Q: 0=64-bit vector, 1=128-bit vector
 */
.gadget uzp1_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    // Load vectors into v0 (Vn) and v1 (Vm)
    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Luzp1_size_b
    cmp x12, #1
    b.eq .Luzp1_size_h
    cmp x12, #2
    b.eq .Luzp1_size_s
    // size == 3 (D)
    b .Luzp1_size_d

.Luzp1_size_b:
    cbz x17, .Luzp1_b_q0
    uzp1 v0.16b, v0.16b, v1.16b
    b .Luzp1_store_q
.Luzp1_b_q0:
    uzp1 v0.8b, v0.8b, v1.8b
    b .Luzp1_store_low

.Luzp1_size_h:
    cbz x17, .Luzp1_h_q0
    uzp1 v0.8h, v0.8h, v1.8h
    b .Luzp1_store_q
.Luzp1_h_q0:
    uzp1 v0.4h, v0.4h, v1.4h
    b .Luzp1_store_low

.Luzp1_size_s:
    cbz x17, .Luzp1_s_q0
    uzp1 v0.4s, v0.4s, v1.4s
    b .Luzp1_store_q
.Luzp1_s_q0:
    uzp1 v0.2s, v0.2s, v1.2s
    b .Luzp1_store_low

.Luzp1_size_d:
    cbz x17, .Luzp1_invalid
    uzp1 v0.2d, v0.2d, v1.2d
    b .Luzp1_store_q

.Luzp1_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Luzp1_store_q:
    str q0, [x14]
    gret

.Luzp1_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * UZP2 - Unzip odd elements
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget uzp2_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Luzp2_size_b
    cmp x12, #1
    b.eq .Luzp2_size_h
    cmp x12, #2
    b.eq .Luzp2_size_s
    b .Luzp2_size_d

.Luzp2_size_b:
    cbz x17, .Luzp2_b_q0
    uzp2 v0.16b, v0.16b, v1.16b
    b .Luzp2_store_q
.Luzp2_b_q0:
    uzp2 v0.8b, v0.8b, v1.8b
    b .Luzp2_store_low

.Luzp2_size_h:
    cbz x17, .Luzp2_h_q0
    uzp2 v0.8h, v0.8h, v1.8h
    b .Luzp2_store_q
.Luzp2_h_q0:
    uzp2 v0.4h, v0.4h, v1.4h
    b .Luzp2_store_low

.Luzp2_size_s:
    cbz x17, .Luzp2_s_q0
    uzp2 v0.4s, v0.4s, v1.4s
    b .Luzp2_store_q
.Luzp2_s_q0:
    uzp2 v0.2s, v0.2s, v1.2s
    b .Luzp2_store_low

.Luzp2_size_d:
    cbz x17, .Luzp2_invalid
    uzp2 v0.2d, v0.2d, v1.2d
    b .Luzp2_store_q

.Luzp2_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Luzp2_store_q:
    str q0, [x14]
    gret

.Luzp2_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * TRN1 - Transpose even pairs
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget trn1_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Ltrn1_size_b
    cmp x12, #1
    b.eq .Ltrn1_size_h
    cmp x12, #2
    b.eq .Ltrn1_size_s
    b .Ltrn1_size_d

.Ltrn1_size_b:
    cbz x17, .Ltrn1_b_q0
    trn1 v0.16b, v0.16b, v1.16b
    b .Ltrn1_store_q
.Ltrn1_b_q0:
    trn1 v0.8b, v0.8b, v1.8b
    b .Ltrn1_store_low

.Ltrn1_size_h:
    cbz x17, .Ltrn1_h_q0
    trn1 v0.8h, v0.8h, v1.8h
    b .Ltrn1_store_q
.Ltrn1_h_q0:
    trn1 v0.4h, v0.4h, v1.4h
    b .Ltrn1_store_low

.Ltrn1_size_s:
    cbz x17, .Ltrn1_s_q0
    trn1 v0.4s, v0.4s, v1.4s
    b .Ltrn1_store_q
.Ltrn1_s_q0:
    trn1 v0.2s, v0.2s, v1.2s
    b .Ltrn1_store_low

.Ltrn1_size_d:
    cbz x17, .Ltrn1_invalid
    trn1 v0.2d, v0.2d, v1.2d
    b .Ltrn1_store_q

.Ltrn1_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Ltrn1_store_q:
    str q0, [x14]
    gret

.Ltrn1_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * TRN2 - Transpose odd pairs
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget trn2_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Ltrn2_size_b
    cmp x12, #1
    b.eq .Ltrn2_size_h
    cmp x12, #2
    b.eq .Ltrn2_size_s
    b .Ltrn2_size_d

.Ltrn2_size_b:
    cbz x17, .Ltrn2_b_q0
    trn2 v0.16b, v0.16b, v1.16b
    b .Ltrn2_store_q
.Ltrn2_b_q0:
    trn2 v0.8b, v0.8b, v1.8b
    b .Ltrn2_store_low

.Ltrn2_size_h:
    cbz x17, .Ltrn2_h_q0
    trn2 v0.8h, v0.8h, v1.8h
    b .Ltrn2_store_q
.Ltrn2_h_q0:
    trn2 v0.4h, v0.4h, v1.4h
    b .Ltrn2_store_low

.Ltrn2_size_s:
    cbz x17, .Ltrn2_s_q0
    trn2 v0.4s, v0.4s, v1.4s
    b .Ltrn2_store_q
.Ltrn2_s_q0:
    trn2 v0.2s, v0.2s, v1.2s
    b .Ltrn2_store_low

.Ltrn2_size_d:
    cbz x17, .Ltrn2_invalid
    trn2 v0.2d, v0.2d, v1.2d
    b .Ltrn2_store_q

.Ltrn2_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Ltrn2_store_q:
    str q0, [x14]
    gret

.Ltrn2_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * ZIP1 - Interleave lower halves
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget zip1_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lzip1_size_b
    cmp x12, #1
    b.eq .Lzip1_size_h
    cmp x12, #2
    b.eq .Lzip1_size_s
    b .Lzip1_size_d

.Lzip1_size_b:
    cbz x17, .Lzip1_b_q0
    zip1 v0.16b, v0.16b, v1.16b
    b .Lzip1_store_q
.Lzip1_b_q0:
    zip1 v0.8b, v0.8b, v1.8b
    b .Lzip1_store_low

.Lzip1_size_h:
    cbz x17, .Lzip1_h_q0
    zip1 v0.8h, v0.8h, v1.8h
    b .Lzip1_store_q
.Lzip1_h_q0:
    zip1 v0.4h, v0.4h, v1.4h
    b .Lzip1_store_low

.Lzip1_size_s:
    cbz x17, .Lzip1_s_q0
    zip1 v0.4s, v0.4s, v1.4s
    b .Lzip1_store_q
.Lzip1_s_q0:
    zip1 v0.2s, v0.2s, v1.2s
    b .Lzip1_store_low

.Lzip1_size_d:
    cbz x17, .Lzip1_invalid
    zip1 v0.2d, v0.2d, v1.2d
    b .Lzip1_store_q

.Lzip1_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Lzip1_store_q:
    str q0, [x14]
    gret

.Lzip1_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * ZIP2 - Interleave upper halves
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget zip2_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lzip2_size_b
    cmp x12, #1
    b.eq .Lzip2_size_h
    cmp x12, #2
    b.eq .Lzip2_size_s
    b .Lzip2_size_d

.Lzip2_size_b:
    cbz x17, .Lzip2_b_q0
    zip2 v0.16b, v0.16b, v1.16b
    b .Lzip2_store_q
.Lzip2_b_q0:
    zip2 v0.8b, v0.8b, v1.8b
    b .Lzip2_store_low

.Lzip2_size_h:
    cbz x17, .Lzip2_h_q0
    zip2 v0.8h, v0.8h, v1.8h
    b .Lzip2_store_q
.Lzip2_h_q0:
    zip2 v0.4h, v0.4h, v1.4h
    b .Lzip2_store_low

.Lzip2_size_s:
    cbz x17, .Lzip2_s_q0
    zip2 v0.4s, v0.4s, v1.4s
    b .Lzip2_store_q
.Lzip2_s_q0:
    zip2 v0.2s, v0.2s, v1.2s
    b .Lzip2_store_low

.Lzip2_size_d:
    cbz x17, .Lzip2_invalid
    zip2 v0.2d, v0.2d, v1.2d
    b .Lzip2_store_q

.Lzip2_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Lzip2_store_q:
    str q0, [x14]
    gret

.Lzip2_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * REV16 - Reverse bytes in 16-bit elements (vector)
 * Code stream: [gadget addr][rd | rn<<8 | Q<<16]
 * Q: 0=64-bit vector (.8B), 1=128-bit vector (.16B)
 */
.gadget rev16_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #1   // Q

    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x13, x12, x13       // &Vn
    lsl x14, x9, #4
    add x14, x12, x14       // &Vd

    ldr q0, [x13]
    cbz x11, .Lrev16_vec_8b
    rev16 v0.16b, v0.16b
    str q0, [x14]
    gret
.Lrev16_vec_8b:
    rev16 v0.8b, v0.8b
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * REV32 - Reverse bytes in 32-bit elements (vector)
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 *
 * size: 0=B (reverse bytes), 1=H (reverse halfwords)
 * Q: 0=64-bit vector, 1=128-bit vector
 */
.gadget rev32_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #2   // size
    ubfx x12, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source vector
    ldr q0, [x15]

    // size=0: REV32 (reverse bytes within each 32-bit element)
    // size=1: REV32 (reverse halfwords within each 32-bit element)
    cmp x11, #0
    b.eq .Lrev32_size_b
    // size == 1
    b .Lrev32_size_h

.Lrev32_size_b:
    cbz x12, .Lrev32_b_low
    rev32 v0.16b, v0.16b
    b .Lrev32_store_q
.Lrev32_b_low:
    rev32 v0.8b, v0.8b
    b .Lrev32_store_low

.Lrev32_size_h:
    cbz x12, .Lrev32_h_low
    rev32 v0.8h, v0.8h
    b .Lrev32_store_q
.Lrev32_h_low:
    rev32 v0.4h, v0.4h
    b .Lrev32_store_low

.Lrev32_store_q:
    str q0, [x14]
    gret

.Lrev32_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * REV64 - Reverse bytes in 64-bit elements (vector)
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 *
 * size: 0=B (reverse bytes), 1=H (reverse halfwords), 2=S (reverse words)
 * Q: 0=64-bit vector, 1=128-bit vector
 */
.gadget rev64_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #2   // size
    ubfx x12, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source vector
    ldr q0, [x15]

    cmp x11, #0
    b.eq .Lrev64_size_b
    cmp x11, #1
    b.eq .Lrev64_size_h
    // size == 2
    b .Lrev64_size_s

.Lrev64_size_b:
    cbz x12, .Lrev64_b_low
    rev64 v0.16b, v0.16b
    b .Lrev64_store_q
.Lrev64_b_low:
    rev64 v0.8b, v0.8b
    b .Lrev64_store_low

.Lrev64_size_h:
    cbz x12, .Lrev64_h_low
    rev64 v0.8h, v0.8h
    b .Lrev64_store_q
.Lrev64_h_low:
    rev64 v0.4h, v0.4h
    b .Lrev64_store_low

.Lrev64_size_s:
    cbz x12, .Lrev64_s_low
    rev64 v0.4s, v0.4s
    b .Lrev64_store_q
.Lrev64_s_low:
    rev64 v0.2s, v0.2s
    b .Lrev64_store_low

.Lrev64_store_q:
    str q0, [x14]
    gret

.Lrev64_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * RBIT (vector) - reverse bits in each byte
 * Code stream: [gadget addr][rd | rn<<8 | Q<<16]
 *
 * Q: 0=8-byte (.8B), 1=16-byte (.16B)
 */
.gadget rbit_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x17, x8, #16, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source vector
    ldr q0, [x15]

    // Use native RBIT instruction
    cbz x17, .Lrbit_vec_8b
    rbit v0.16b, v0.16b
    str q0, [x14]
    gret

.Lrbit_vec_8b:
    rbit v0.8b, v0.8b
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * Vector FP two-register misc conversion instructions
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16 | Q<<24]
 * sz: 0=single, 1=double
 * Q: 0=lower half, 1=full
 *
 * Macro: generates gadgets for FP conversions (pass-through to native NEON)
 */
.macro make_fp_vec_two_reg_misc name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cbnz x11, .L\name\()_double
    // Single-precision
    cbz x17, .L\name\()_2s
    \insn v0.4s, v0.4s
    str q0, [x14]
    gret
.L\name\()_2s:
    \insn v0.2s, v0.2s
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_double:
    // Double-precision (always Q=1 for .2d)
    \insn v0.2d, v0.2d
    str q0, [x14]
    gret
.endm

make_fp_vec_two_reg_misc scvtf_int, scvtf
make_fp_vec_two_reg_misc ucvtf_int, ucvtf
make_fp_vec_two_reg_misc fcvtzs_int, fcvtzs
make_fp_vec_two_reg_misc fcvtzu_int, fcvtzu
make_fp_vec_two_reg_misc fcvtns_int, fcvtns
make_fp_vec_two_reg_misc fcvtnu_int, fcvtnu
make_fp_vec_two_reg_misc fcvtms_int, fcvtms
make_fp_vec_two_reg_misc fcvtmu_int, fcvtmu
make_fp_vec_two_reg_misc fcvtps_int, fcvtps
make_fp_vec_two_reg_misc fcvtpu_int, fcvtpu
make_fp_vec_two_reg_misc fcvtas_int, fcvtas
make_fp_vec_two_reg_misc fcvtau_int, fcvtau
make_fp_vec_two_reg_misc frintn_vec, frintn
make_fp_vec_two_reg_misc frinta_vec, frinta
make_fp_vec_two_reg_misc frintp_vec, frintp
make_fp_vec_two_reg_misc frintm_vec, frintm
make_fp_vec_two_reg_misc frintx_vec, frintx
make_fp_vec_two_reg_misc frintz_vec, frintz
make_fp_vec_two_reg_misc frinti_vec, frinti

/*
 * Run a native FP instruction under the guest FPCR/FPSR, then restore the
 * host thread's state. The conversion gadgets below can round, quiet NaNs and
 * raise cumulative exceptions, so using the process FP state is incorrect.
 */
.macro fp_guest_enter host_fpcr, host_fpsr, scratch_x, scratch_w
    mrs \host_fpcr, fpcr
    mrs \host_fpsr, fpsr
    ldr \scratch_w, [_cpu, #CPU_fpcr]
    msr fpcr, \scratch_x
    ldr \scratch_w, [_cpu, #CPU_fpsr]
    msr fpsr, \scratch_x
.endm

.macro fp_guest_leave host_fpcr, host_fpsr, scratch_x, scratch_w
    mrs \scratch_x, fpsr
    str \scratch_w, [_cpu, #CPU_fpsr]
    msr fpcr, \host_fpcr
    msr fpsr, \host_fpsr
.endm

/*
 * FCVTN/FCVTN2 - floating-point narrowing conversion.
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0 = single->half, 1 = double->single
 * Q: 0 = FCVTN (write lower half, zero upper), 1 = FCVTN2 (preserve lower)
 */
.gadget fcvtn_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #1   // size
    ubfx x17, x8, #24, #1   // Q / upper destination half

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load the source before Vd so rn==rd works for both lower and upper forms.
    ldr q0, [x15]
    fp_guest_enter x12, x16, x8, w8
    cbnz x11, .Lfcvtn_d_to_s

    // Single -> half.
    cbnz x17, .Lfcvtn2_s_to_h
    fcvtn v0.4h, v0.4s
    fp_guest_leave x12, x16, x8, w8
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lfcvtn2_s_to_h:
    ldr q1, [x14]
    fcvtn2 v1.8h, v0.4s
    fp_guest_leave x12, x16, x8, w8
    str q1, [x14]
    gret

.Lfcvtn_d_to_s:
    cbnz x17, .Lfcvtn2_d_to_s
    fcvtn v0.2s, v0.2d
    fp_guest_leave x12, x16, x8, w8
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lfcvtn2_d_to_s:
    ldr q1, [x14]
    fcvtn2 v1.4s, v0.2d
    fp_guest_leave x12, x16, x8, w8
    str q1, [x14]
    gret

/*
 * FCVTL/FCVTL2 - floating-point widening conversion.
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0 = half->single, 1 = single->double
 * Q: 0 = FCVTL (lower half), 1 = FCVTL2 (upper half)
 */
.gadget fcvtl_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #1   // size
    ubfx x17, x8, #24, #1   // Q / upper half

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]
    fp_guest_enter x12, x16, x8, w8

    cbnz x11, .Lfcvtl_s_to_d
    cbnz x17, .Lfcvtl2_h_to_s
    fcvtl v0.4s, v0.4h
    fp_guest_leave x12, x16, x8, w8
    str q0, [x14]
    gret
.Lfcvtl2_h_to_s:
    fcvtl2 v0.4s, v0.8h
    fp_guest_leave x12, x16, x8, w8
    str q0, [x14]
    gret
.Lfcvtl_s_to_d:
    cbnz x17, .Lfcvtl2_s_to_d
    fcvtl v0.2d, v0.2s
    fp_guest_leave x12, x16, x8, w8
    str q0, [x14]
    gret
.Lfcvtl2_s_to_d:
    fcvtl2 v0.2d, v0.4s
    fp_guest_leave x12, x16, x8, w8
    str q0, [x14]
    gret

/*
 * FCVTXN/FCVTXN2 - double-to-single round-to-odd narrowing conversion.
 * Code stream: [gadget addr][rd | rn<<8 | Q<<24]
 * Q: 0 = FCVTXN (write lower half, zero upper), 1 = FCVTXN2 (preserve lower)
 */
.gadget fcvtxn_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x17, x8, #24, #1   // Q / upper destination half

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]           // source first for rn==rd
    fp_guest_enter x12, x16, x8, w8
    cbnz x17, .Lfcvtxn2_d_to_s
    fcvtxn v0.2s, v0.2d
    fp_guest_leave x12, x16, x8, w8
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lfcvtxn2_d_to_s:
    ldr q1, [x14]
    fcvtxn2 v1.4s, v0.2d
    fp_guest_leave x12, x16, x8, w8
    str q1, [x14]
    gret

/*
 * Vector FP compare-with-zero instructions
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16 | Q<<24]
 */
.macro make_fp_vec_cmp_zero name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cbnz x11, .L\name\()_double
    cbz x17, .L\name\()_2s
    \insn v0.4s, v0.4s, #0.0
    str q0, [x14]
    gret
.L\name\()_2s:
    \insn v0.2s, v0.2s, #0.0
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_double:
    \insn v0.2d, v0.2d, #0.0
    str q0, [x14]
    gret
.endm

make_fp_vec_cmp_zero fcmeq_zero, fcmeq
make_fp_vec_cmp_zero fcmge_zero, fcmge
make_fp_vec_cmp_zero fcmgt_zero, fcmgt
make_fp_vec_cmp_zero fcmle_zero, fcmle
make_fp_vec_cmp_zero fcmlt_zero, fcmlt

/*
 * Vector FP absolute value / negate
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16 | Q<<24]
 */
.macro make_fp_vec_unary name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cbnz x11, .L\name\()_double
    cbz x17, .L\name\()_2s
    \insn v0.4s, v0.4s
    str q0, [x14]
    gret
.L\name\()_2s:
    \insn v0.2s, v0.2s
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_double:
    \insn v0.2d, v0.2d
    str q0, [x14]
    gret
.endm

make_fp_vec_unary fabs_vec, fabs
make_fp_vec_unary fneg_vec, fneg
make_fp_vec_unary fsqrt_vec, fsqrt
make_fp_vec_unary frecpe_vec, frecpe
make_fp_vec_unary frsqrte_vec, frsqrte

/*
 * Integer vector compare-with-zero instructions
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 */
.macro make_int_vec_cmp_zero name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cmp x11, #0
    b.eq .L\name\()_b
    cmp x11, #1
    b.eq .L\name\()_h
    cmp x11, #2
    b.eq .L\name\()_s
    // size == 3 (.2d, always Q=1)
    \insn v0.2d, v0.2d, #0
    str q0, [x14]
    gret
.L\name\()_b:
    cbz x17, .L\name\()_8b
    \insn v0.16b, v0.16b, #0
    str q0, [x14]
    gret
.L\name\()_8b:
    \insn v0.8b, v0.8b, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_h:
    cbz x17, .L\name\()_4h
    \insn v0.8h, v0.8h, #0
    str q0, [x14]
    gret
.L\name\()_4h:
    \insn v0.4h, v0.4h, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_s:
    cbz x17, .L\name\()_2s
    \insn v0.4s, v0.4s, #0
    str q0, [x14]
    gret
.L\name\()_2s:
    \insn v0.2s, v0.2s, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_int_vec_cmp_zero cmgt_zero, cmgt
make_int_vec_cmp_zero cmge_zero, cmge
make_int_vec_cmp_zero cmlt_zero, cmlt
make_int_vec_cmp_zero cmle_zero, cmle
make_int_vec_cmp_zero cmeq_zero, cmeq

// CLZ/CLS/ABS/NEG/NOT/RBIT vector gadgets use make_twomis_native macro (defined later in this file)

/*
 * CNT - Vector population count (count set bits per byte)
 * Code stream: [gadget addr][rd | rn<<8 | Q<<16]
 * Only valid for .8B (Q=0) and .16B (Q=1)
 */
.gadget cnt_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x17, x8, #16, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source vector
    ldr q0, [x15]

    // Use native CNT instruction
    cbz x17, .Lcnt_vec_8b
    cnt v0.16b, v0.16b
    str q0, [x14]
    gret

.Lcnt_vec_8b:
    cnt v0.8b, v0.8b
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * ADDV - Add across vector (sum all elements into scalar)
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0=B, 1=H, 2=S (no 3=D for ADDV)
 * Q: 0=64-bit vector, 1=128-bit vector
 * Result is scalar: Vd.element = sum of all Vn elements
 */
.gadget addv_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source vector
    ldr q0, [x15]

    // Use native ADDV instruction, dispatch by size and Q
    cmp x12, #2
    b.eq .Laddv_32
    cmp x12, #1
    b.eq .Laddv_16
    // size=0 (bytes)
    cbz x17, .Laddv_8b
    addv b1, v0.16b
    b .Laddv_store_b
.Laddv_8b:
    addv b1, v0.8b
.Laddv_store_b:
    stp xzr, xzr, [x14]     // zero destination
    st1 {v1.b}[0], [x14]    // store scalar byte result
    gret

.Laddv_16:
    cbz x17, .Laddv_4h
    addv h1, v0.8h
    b .Laddv_store_h
.Laddv_4h:
    addv h1, v0.4h
.Laddv_store_h:
    stp xzr, xzr, [x14]
    st1 {v1.h}[0], [x14]
    gret

.Laddv_32:
    cbz x17, .Laddv_2s
    addv s1, v0.4s
    b .Laddv_store_s
.Laddv_2s:
    // ADDV doesn't exist for 2S, use ADDP instead
    addp v1.2s, v0.2s, v0.2s
.Laddv_store_s:
    stp xzr, xzr, [x14]
    str s1, [x14]
    gret

/*
 * SADDLV/UADDLV - Signed/Unsigned Add Long Across Vector
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0=B→H, 1=H→S, 2=S→D (result is one size wider)
 * Q: 0=64-bit vector, 1=128-bit vector
 */
.macro make_across_addlv name, insn_b_16, insn_b_8, insn_h_8, insn_h_4, insn_s_4
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cmp x12, #2
    b.eq .L\name\()_32
    cmp x12, #1
    b.eq .L\name\()_16
    // size=0 (bytes → halfword result)
    cbz x17, .L\name\()_8b
    \insn_b_16
    b .L\name\()_store_h
.L\name\()_8b:
    \insn_b_8
.L\name\()_store_h:
    stp xzr, xzr, [x14]
    st1 {v1.h}[0], [x14]
    gret

.L\name\()_16:
    // size=1 (halfwords → word result)
    cbz x17, .L\name\()_4h
    \insn_h_8
    b .L\name\()_store_s
.L\name\()_4h:
    \insn_h_4
.L\name\()_store_s:
    stp xzr, xzr, [x14]
    str s1, [x14]
    gret

.L\name\()_32:
    // size=2 (words → doubleword result)
    // SADDLV/UADDLV for 4S only (Q=1); 2S not encodable
    \insn_s_4
    stp xzr, xzr, [x14]
    str d1, [x14]
    gret
.endm

make_across_addlv saddlv, "saddlv h1, v0.16b", "saddlv h1, v0.8b", "saddlv s1, v0.8h", "saddlv s1, v0.4h", "saddlv d1, v0.4s"
make_across_addlv uaddlv, "uaddlv h1, v0.16b", "uaddlv h1, v0.8b", "uaddlv s1, v0.8h", "uaddlv s1, v0.4h", "uaddlv d1, v0.4s"

/*
 * UMAXV/UMINV/SMAXV/SMINV - Min/Max across vector lanes
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0=B, 1=H, 2=S (no 3=D)
 * Q: 0=64-bit vector, 1=128-bit vector
 * Result is scalar: Vd.element = min/max of all Vn elements
 */
.macro make_across_minmax name, insn_b_16, insn_b_8, insn_h_8, insn_h_4, insn_s_4, insn_s_2
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]
    cmp x12, #2
    b.eq .L\name\()_32
    cmp x12, #1
    b.eq .L\name\()_16
    // size=0 (bytes)
    cbz x17, .L\name\()_8b
    \insn_b_16
    b .L\name\()_store_b
.L\name\()_8b:
    \insn_b_8
.L\name\()_store_b:
    stp xzr, xzr, [x14]
    st1 {v1.b}[0], [x14]
    gret
.L\name\()_16:
    cbz x17, .L\name\()_4h
    \insn_h_8
    b .L\name\()_store_h
.L\name\()_4h:
    \insn_h_4
.L\name\()_store_h:
    stp xzr, xzr, [x14]
    st1 {v1.h}[0], [x14]
    gret
.L\name\()_32:
    cbz x17, .L\name\()_2s
    \insn_s_4
    b .L\name\()_store_s
.L\name\()_2s:
    \insn_s_2
.L\name\()_store_s:
    stp xzr, xzr, [x14]
    str s1, [x14]
    gret
.endm

make_across_minmax umaxv, "umaxv b1, v0.16b", "umaxv b1, v0.8b", "umaxv h1, v0.8h", "umaxv h1, v0.4h", "umaxv s1, v0.4s", "umaxp v1.2s, v0.2s, v0.2s"
make_across_minmax uminv, "uminv b1, v0.16b", "uminv b1, v0.8b", "uminv h1, v0.8h", "uminv h1, v0.4h", "uminv s1, v0.4s", "uminp v1.2s, v0.2s, v0.2s"
make_across_minmax smaxv, "smaxv b1, v0.16b", "smaxv b1, v0.8b", "smaxv h1, v0.8h", "smaxv h1, v0.4h", "smaxv s1, v0.4s", "smaxp v1.2s, v0.2s, v0.2s"
make_across_minmax sminv, "sminv b1, v0.16b", "sminv b1, v0.8b", "sminv h1, v0.8h", "sminv h1, v0.4h", "sminv s1, v0.4s", "sminp v1.2s, v0.2s, v0.2s"

/*
 * FMAXV/FMINV/FMAXNMV/FMINNMV - FP max/min across vector lanes
 * Only valid for .4s (Q=1, single precision)
 * Code stream: [gadget addr][rd | rn<<8]
 */
.macro make_fp_across name, op
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]
    \op s1, v0.4s
    stp xzr, xzr, [x14]
    str s1, [x14]
    gret
.endm

make_fp_across fmaxv, fmaxv
make_fp_across fminv, fminv
make_fp_across fmaxnmv, fmaxnmv
make_fp_across fminnmv, fminnmv

/*
 * ADD - Vector add
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * size: 0=B, 1=H, 2=S, 3=D
 * Q: 0=64-bit vector, 1=128-bit vector
 */
.gadget add_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    // Load vectors into v0 (Vn) and v1 (Vm)
    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Ladd_size_b
    cmp x12, #1
    b.eq .Ladd_size_h
    cmp x12, #2
    b.eq .Ladd_size_s
    // size == 3 (D)
    b .Ladd_size_d

.Ladd_size_b:
    cbz x17, .Ladd_b_q0
    add v0.16b, v0.16b, v1.16b
    b .Ladd_store_q
.Ladd_b_q0:
    add v0.8b, v0.8b, v1.8b
    b .Ladd_store_low

.Ladd_size_h:
    cbz x17, .Ladd_h_q0
    add v0.8h, v0.8h, v1.8h
    b .Ladd_store_q
.Ladd_h_q0:
    add v0.4h, v0.4h, v1.4h
    b .Ladd_store_low

.Ladd_size_s:
    cbz x17, .Ladd_s_q0
    add v0.4s, v0.4s, v1.4s
    b .Ladd_store_q
.Ladd_s_q0:
    add v0.2s, v0.2s, v1.2s
    b .Ladd_store_low

.Ladd_size_d:
    cbz x17, .Ladd_invalid
    add v0.2d, v0.2d, v1.2d
    b .Ladd_store_q

.Ladd_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Ladd_store_q:
    str q0, [x14]
    gret

.Ladd_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SUB - Vector subtract
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget sub_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lsub_size_b
    cmp x12, #1
    b.eq .Lsub_size_h
    cmp x12, #2
    b.eq .Lsub_size_s
    b .Lsub_size_d

.Lsub_size_b:
    cbz x17, .Lsub_b_q0
    sub v0.16b, v0.16b, v1.16b
    b .Lsub_store_q
.Lsub_b_q0:
    sub v0.8b, v0.8b, v1.8b
    b .Lsub_store_low

.Lsub_size_h:
    cbz x17, .Lsub_h_q0
    sub v0.8h, v0.8h, v1.8h
    b .Lsub_store_q
.Lsub_h_q0:
    sub v0.4h, v0.4h, v1.4h
    b .Lsub_store_low

.Lsub_size_s:
    cbz x17, .Lsub_s_q0
    sub v0.4s, v0.4s, v1.4s
    b .Lsub_store_q
.Lsub_s_q0:
    sub v0.2s, v0.2s, v1.2s
    b .Lsub_store_low

.Lsub_size_d:
    cbz x17, .Lsub_invalid
    sub v0.2d, v0.2d, v1.2d
    b .Lsub_store_q

.Lsub_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Lsub_store_q:
    str q0, [x14]
    gret

.Lsub_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SHADD - Signed halving add
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * result = (Vn + Vm) >> 1 (signed, no overflow)
 */
.gadget shadd_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lshadd_size_b
    cmp x12, #1
    b.eq .Lshadd_size_h
    cmp x12, #2
    b.eq .Lshadd_size_s
    b .Lshadd_invalid

.Lshadd_size_b:
    cbz x17, .Lshadd_b_q0
    shadd v0.16b, v0.16b, v1.16b
    b .Lshadd_store_q
.Lshadd_b_q0:
    shadd v0.8b, v0.8b, v1.8b
    b .Lshadd_store_low

.Lshadd_size_h:
    cbz x17, .Lshadd_h_q0
    shadd v0.8h, v0.8h, v1.8h
    b .Lshadd_store_q
.Lshadd_h_q0:
    shadd v0.4h, v0.4h, v1.4h
    b .Lshadd_store_low

.Lshadd_size_s:
    cbz x17, .Lshadd_s_q0
    shadd v0.4s, v0.4s, v1.4s
    b .Lshadd_store_q
.Lshadd_s_q0:
    shadd v0.2s, v0.2s, v1.2s
    b .Lshadd_store_low

.Lshadd_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Lshadd_store_q:
    str q0, [x14]
    gret

.Lshadd_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * UHADD - Unsigned halving add
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget uhadd_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Luhadd_size_b
    cmp x12, #1
    b.eq .Luhadd_size_h
    cmp x12, #2
    b.eq .Luhadd_size_s
    b .Luhadd_invalid

.Luhadd_size_b:
    cbz x17, .Luhadd_b_q0
    uhadd v0.16b, v0.16b, v1.16b
    b .Luhadd_store_q
.Luhadd_b_q0:
    uhadd v0.8b, v0.8b, v1.8b
    b .Luhadd_store_low

.Luhadd_size_h:
    cbz x17, .Luhadd_h_q0
    uhadd v0.8h, v0.8h, v1.8h
    b .Luhadd_store_q
.Luhadd_h_q0:
    uhadd v0.4h, v0.4h, v1.4h
    b .Luhadd_store_low

.Luhadd_size_s:
    cbz x17, .Luhadd_s_q0
    uhadd v0.4s, v0.4s, v1.4s
    b .Luhadd_store_q
.Luhadd_s_q0:
    uhadd v0.2s, v0.2s, v1.2s
    b .Luhadd_store_low

.Luhadd_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Luhadd_store_q:
    str q0, [x14]
    gret

.Luhadd_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SRHADD - Signed rounding halving add
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget srhadd_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lsrhadd_size_b
    cmp x12, #1
    b.eq .Lsrhadd_size_h
    cmp x12, #2
    b.eq .Lsrhadd_size_s
    b .Lsrhadd_invalid

.Lsrhadd_size_b:
    cbz x17, .Lsrhadd_b_q0
    srhadd v0.16b, v0.16b, v1.16b
    b .Lsrhadd_store_q
.Lsrhadd_b_q0:
    srhadd v0.8b, v0.8b, v1.8b
    b .Lsrhadd_store_low

.Lsrhadd_size_h:
    cbz x17, .Lsrhadd_h_q0
    srhadd v0.8h, v0.8h, v1.8h
    b .Lsrhadd_store_q
.Lsrhadd_h_q0:
    srhadd v0.4h, v0.4h, v1.4h
    b .Lsrhadd_store_low

.Lsrhadd_size_s:
    cbz x17, .Lsrhadd_s_q0
    srhadd v0.4s, v0.4s, v1.4s
    b .Lsrhadd_store_q
.Lsrhadd_s_q0:
    srhadd v0.2s, v0.2s, v1.2s
    b .Lsrhadd_store_low

.Lsrhadd_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Lsrhadd_store_q:
    str q0, [x14]
    gret

.Lsrhadd_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * URHADD - Unsigned rounding halving add
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.gadget urhadd_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lurhadd_size_b
    cmp x12, #1
    b.eq .Lurhadd_size_h
    cmp x12, #2
    b.eq .Lurhadd_size_s
    b .Lurhadd_invalid

.Lurhadd_size_b:
    cbz x17, .Lurhadd_b_q0
    urhadd v0.16b, v0.16b, v1.16b
    b .Lurhadd_store_q
.Lurhadd_b_q0:
    urhadd v0.8b, v0.8b, v1.8b
    b .Lurhadd_store_low

.Lurhadd_size_h:
    cbz x17, .Lurhadd_h_q0
    urhadd v0.8h, v0.8h, v1.8h
    b .Lurhadd_store_q
.Lurhadd_h_q0:
    urhadd v0.4h, v0.4h, v1.4h
    b .Lurhadd_store_low

.Lurhadd_size_s:
    cbz x17, .Lurhadd_s_q0
    urhadd v0.4s, v0.4s, v1.4s
    b .Lurhadd_store_q
.Lurhadd_s_q0:
    urhadd v0.2s, v0.2s, v1.2s
    b .Lurhadd_store_low

.Lurhadd_invalid:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.Lurhadd_store_q:
    str q0, [x14]
    gret

.Lurhadd_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * STR Qn, [addr] - Store 128-bit vector (address in _addr)
 * Code stream: [gadget addr][rt]
 *
 * Note: Address must already be computed in _addr by calc_addr_imm
 */
.gadget str_q
    ldr x8, [_pc]
    add _pc, _pc, #8
    
    and x9, x8, #0x1f       // rt (vector register index)
    
    // Load vector value
    add x10, _cpu, #CPU_fp
    lsl x11, x9, #4         // each V reg is 16 bytes
    add x10, x10, x11       // x10 = base of vector register
    ldr x12, [x10]          // low 64 bits
    ldr x13, [x10, #8]      // high 64 bits

    // Translate address for write. Preserve the guest address in _addr so
    // pre-indexed writeback (and callers following the load/store convention)
    // do not see the translated host pointer left by write_prep.
    mov x23, _addr
    mov x24, x12
    mov x25, x13
    write_prep 128, str_q_1
    mov x12, x24
    mov x13, x25

    // Store both halves
    str x12, [_addr]
    str x13, [_addr, #8]

    write_done 128, str_q_1
    mov _addr, x23
    gret
    write_bullshit 128, str_q_1

/*
 * STUR Qn, [addr] - Same as STR Q but address already includes offset
 * This is just an alias for str_q since we pre-compute the address
 */
.gadget stur_q
    b NAME(gadget_str_q)

/*
 * STP Qn, Qm, [addr] - Store pair of 128-bit vectors
 * Code stream: [gadget addr][rt | rt2<<8]
 */
.gadget stp_q
    ldr x8, [_pc]
    add _pc, _pc, #8
    
    and x9, x8, #0x1f       // rt (first vector)
    ubfx x10, x8, #8, #5    // rt2 (second vector)
    
    // Load first vector
    add x11, _cpu, #CPU_fp
    lsl x12, x9, #4
    add x12, x11, x12       // x12 = base of first vector
    ldr x13, [x12]          // rt low
    ldr x14, [x12, #8]      // rt high

    // Load second vector
    lsl x15, x10, #4
    add x15, x11, x15       // x15 = base of second vector
    ldr x16, [x15]          // rt2 low
    ldr x17, [x15, #8]      // rt2 high
    
    // Save guest address and values (write_prep may destroy _addr/x0-x3).
    mov x23, _addr
    mov x19, x13
    mov x20, x14
    mov x21, x16
    mov x22, x17

    write_prep 256, stp_q_1

    // Restore and store first vector
    str x19, [_addr]
    str x20, [_addr, #8]
    // Store second vector
    str x21, [_addr, #16]
    str x22, [_addr, #24]

    write_done 256, stp_q_1
    mov _addr, x23
    gret
    write_bullshit 256, stp_q_1

/*
 * ==========================================================================
 * SIMD/FP Load/Store Gadgets
 * ==========================================================================
 * These implement SIMD register loads/stores (V bit = 1)
 * Address must already be computed in _addr by calc_addr_imm/reg
 * Code stream: [gadget addr][rt (vector reg index)]
 */

/*
 * STR Bt, [Xn, #imm] - Store byte from SIMD register
 * Stores low 8 bits of Vt
 */
.gadget str_simd_b
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f       // rt (vector reg index)

    // Get low 64 bits of vector register
    add x9, _cpu, #CPU_fp
    lsl x10, x8, #4         // each V reg is 16 bytes
    ldr x11, [x9, x10]      // load low 64 bits
    and x11, x11, #0xff     // keep only low byte

    mov x24, _addr          // Save guest address for writeback
    write_prep 8, str_simd_b_1
    strb w11, [_addr]
    write_done 8, str_simd_b_1
    mov _addr, x24          // Restore guest address
    gret
    write_bullshit 8, str_simd_b_1

/*
 * STR Ht, [Xn, #imm] - Store halfword from SIMD register
 * Stores low 16 bits of Vt
 */
.gadget str_simd_h
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f

    add x9, _cpu, #CPU_fp
    lsl x10, x8, #4
    ldr x11, [x9, x10]
    and x11, x11, #0xffff

    mov x24, _addr          // Save guest address for writeback
    write_prep 16, str_simd_h_1
    strh w11, [_addr]
    write_done 16, str_simd_h_1
    mov _addr, x24          // Restore guest address
    gret
    write_bullshit 16, str_simd_h_1

/*
 * STR St, [Xn, #imm] - Store single (32-bit) from SIMD register
 */
.gadget str_simd_s
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f

    add x9, _cpu, #CPU_fp
    lsl x10, x8, #4
    ldr x11, [x9, x10]      // load low 64 bits

    mov x24, _addr          // Save guest address for writeback
    write_prep 32, str_simd_s_1
    str w11, [_addr]
    write_done 32, str_simd_s_1
    mov _addr, x24          // Restore guest address
    gret
    write_bullshit 32, str_simd_s_1

/*
 * STR Dt, [Xn, #imm] - Store double (64-bit) from SIMD register
 */
.gadget str_simd_d
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f

    add x9, _cpu, #CPU_fp
    lsl x10, x8, #4
    ldr x11, [x9, x10]

    mov x24, _addr          // Save guest address for writeback
    write_prep 64, str_simd_d_1
    str x11, [_addr]
    write_done 64, str_simd_d_1
    mov _addr, x24          // Restore guest address
    gret
    write_bullshit 64, str_simd_d_1

/*
 * STR Qt, [Xn, #imm] - Store quad (128-bit) from SIMD register
 */
.gadget str_simd_q
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x8, x8, #0x1f

    add x9, _cpu, #CPU_fp
    lsl x10, x8, #4
    add x9, x9, x10
    ldr x11, [x9]           // low 64 bits
    ldr x12, [x9, #8]       // high 64 bits

    mov x23, _addr          // Save guest address for writeback
    mov x24, x11
    mov x25, x12
    write_prep 128, str_simd_q_1
    str x24, [_addr]
    str x25, [_addr, #8]
    write_done 128, str_simd_q_1
    mov _addr, x23          // Restore guest address
    gret
    write_bullshit 128, str_simd_q_1

/*
 * LDR Bt, [Xn, #imm] - Load byte into SIMD register
 * Note: read_prep destroys x8-x10, so save rt to x23 (callee-saved)
 */
.gadget ldr_simd_b
    ldr x23, [_pc]
    add _pc, _pc, #8
    and x23, x23, #0x1f       // rt saved in x23

    mov x24, _addr              // Save guest address for writeback
    read_prep 8, ldr_simd_b_1
    ldrb w11, [_addr]

    // Store to vector register (zero extend to 128 bits)
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    str x11, [x9]
    str xzr, [x9, #8]
    mov _addr, x24              // Restore guest address
    gret
    read_bullshit 8, ldr_simd_b_1

/*
 * LDR Ht, [Xn, #imm] - Load halfword into SIMD register
 */
.gadget ldr_simd_h
    ldr x23, [_pc]
    add _pc, _pc, #8
    and x23, x23, #0x1f

    mov x24, _addr              // Save guest address for writeback
    read_prep 16, ldr_simd_h_1
    ldrh w11, [_addr]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    str x11, [x9]
    str xzr, [x9, #8]
    mov _addr, x24              // Restore guest address
    gret
    read_bullshit 16, ldr_simd_h_1

/*
 * LDR St, [Xn, #imm] - Load single into SIMD register
 */
.gadget ldr_simd_s
    ldr x23, [_pc]
    add _pc, _pc, #8
    and x23, x23, #0x1f

    mov x24, _addr              // Save guest address for writeback
    read_prep 32, ldr_simd_s_1
    ldr w11, [_addr]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    str x11, [x9]
    str xzr, [x9, #8]
    mov _addr, x24              // Restore guest address
    gret
    read_bullshit 32, ldr_simd_s_1

/*
 * LDR Dt, [Xn, #imm] - Load double into SIMD register
 */
.gadget ldr_simd_d
    ldr x23, [_pc]
    add _pc, _pc, #8
    and x23, x23, #0x1f

    mov x24, _addr              // Save guest address for writeback
    read_prep 64, ldr_simd_d_1
    ldr x11, [_addr]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    str x11, [x9]
    str xzr, [x9, #8]
    mov _addr, x24              // Restore guest address
    gret
    read_bullshit 64, ldr_simd_d_1

/*
 * LDR Qt, [Xn, #imm] - Load quad into SIMD register
 */
.gadget ldr_simd_q
    ldr x23, [_pc]
    add _pc, _pc, #8
    and x23, x23, #0x1f

    mov x24, _addr              // Save guest address for writeback
    read_prep 128, ldr_simd_q_1
    ldr x11, [_addr]
    ldr x12, [_addr, #8]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x9, x9, x10
    str x11, [x9]
    str x12, [x9, #8]

#if 0  // Debug: detect all-ones pattern
    // Check if this is loading all 1s (both lo and hi are -1)
    adds xzr, x11, #1       // check if lo == -1
    b.ne .Lldr_simd_q_done
    adds xzr, x12, #1       // check if hi == -1
    b.ne .Lldr_simd_q_done
    // Both are all 1s - call helper
    sub sp, sp, #96
    stp x0, x1, [sp]
    stp x2, x3, [sp, #16]
    stp x11, x12, [sp, #32]
    stp x23, x24, [sp, #48]
    str x30, [sp, #64]
    stp _cpu, _pc, [sp, #72]
    mov x0, x23             // rd
    mov x1, x11             // lo
    mov x2, x12             // hi
    mov x3, #3              // op_type = LDR_Q
    bl NAME(helper_check_all_ones)
    ldp x0, x1, [sp]
    ldp x2, x3, [sp, #16]
    ldp x11, x12, [sp, #32]
    ldp x23, x24, [sp, #48]
    ldr x30, [sp, #64]
    ldp _cpu, _pc, [sp, #72]
    add sp, sp, #96
.Lldr_simd_q_done:
#endif

    mov _addr, x24              // Restore guest address
    gret
    read_bullshit 128, ldr_simd_q_1

/*
 * ==========================================================================
 * SIMD Load/Store Pair Gadgets
 * ==========================================================================
 * Code stream: [gadget addr][rt | rt2<<8]
 * Address must already be computed in _addr
 */

/*
 * STP St, St2, [addr] - Store pair of 32-bit SIMD registers
 */
.gadget stp_simd_s
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x23, x8, #0x1f       // rt
    ubfx x24, x8, #8, #5     // rt2

    // Save guest address for possible writeback
    mov x25, _addr

    // Load first S register (low 32 bits of V register)
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    ldr w11, [x9, x10]       // rt value

    // Load second S register
    lsl x10, x24, #4
    ldr w12, [x9, x10]       // rt2 value

    write_prep 64, stp_simd_s_1
    str w11, [_addr]
    str w12, [_addr, #4]
    write_done 64, stp_simd_s_1
    mov _addr, x25
    gret
    write_bullshit 64, stp_simd_s_1

/*
 * STP Dt, Dt2, [addr] - Store pair of 64-bit SIMD registers
 */
.gadget stp_simd_d
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x23, x8, #0x1f
    ubfx x24, x8, #8, #5

    // Save guest address for possible writeback
    mov x25, _addr

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    ldr x11, [x9, x10]

    lsl x10, x24, #4
    ldr x12, [x9, x10]

    write_prep 128, stp_simd_d_1
    str x11, [_addr]
    str x12, [_addr, #8]
    write_done 128, stp_simd_d_1
    mov _addr, x25
    gret
    write_bullshit 128, stp_simd_d_1


/*
 * STP Qt, Qt2, [addr] - Store pair of 128-bit SIMD registers
 * Each Q register is 16 bytes, so total is 32 bytes
 */
.gadget stp_simd_q
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x23, x8, #0x1f       // rt
    ubfx x24, x8, #8, #5     // rt2

    // Save guest address for possible writeback (write_prep destroys _addr)
    mov x25, _addr

    // Load first Q register (both halves)
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x10, x9, x10
    ldr x19, [x10]           // rt low
    ldr x20, [x10, #8]       // rt high

    // Load second Q register
    lsl x10, x24, #4
    add x10, x9, x10
    ldr x21, [x10]           // rt2 low
    ldr x22, [x10, #8]       // rt2 high

    write_prep 256, stp_simd_q_1
    str x19, [_addr]
    str x20, [_addr, #8]
    str x21, [_addr, #16]
    str x22, [_addr, #24]
    write_done 256, stp_simd_q_1

    // Restore guest address for writeback
    mov _addr, x25
    gret
    write_bullshit 256, stp_simd_q_1

/*
 * LDP St, St2, [addr] - Load pair of 32-bit SIMD registers
 */
.gadget ldp_simd_s
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x23, x8, #0x1f       // rt
    ubfx x24, x8, #8, #5     // rt2

    // Preserve guest address for pre-indexed pair writeback; read_prep
    // translates _addr to a host pointer.
    mov x25, _addr
    read_prep 64, ldp_simd_s_1
    ldr w11, [_addr]
    ldr w12, [_addr, #4]

    // Store to first S register (zero-extend to 128 bits)
    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x10, x9, x10
    str x11, [x10]
    str xzr, [x10, #8]

    // Store to second S register
    lsl x10, x24, #4
    add x10, x9, x10
    str x12, [x10]
    str xzr, [x10, #8]
    mov _addr, x25
    gret
    read_bullshit 64, ldp_simd_s_1

/*
 * LDP Dt, Dt2, [addr] - Load pair of 64-bit SIMD registers
 */
.gadget ldp_simd_d
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x23, x8, #0x1f
    ubfx x24, x8, #8, #5

    mov x25, _addr
    read_prep 128, ldp_simd_d_1
    ldr x11, [_addr]
    ldr x12, [_addr, #8]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x10, x9, x10
    str x11, [x10]
    str xzr, [x10, #8]

    lsl x10, x24, #4
    add x10, x9, x10
    str x12, [x10]
    str xzr, [x10, #8]
    mov _addr, x25
    gret
    read_bullshit 128, ldp_simd_d_1

/*
 * LDP Qt, Qt2, [addr] - Load pair of 128-bit SIMD registers
 */
.gadget ldp_simd_q
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x23, x8, #0x1f
    ubfx x24, x8, #8, #5

    mov x25, _addr
    read_prep 256, ldp_simd_q_1
    ldr x11, [_addr]
    ldr x12, [_addr, #8]
    ldr x13, [_addr, #16]
    ldr x14, [_addr, #24]

    add x9, _cpu, #CPU_fp
    lsl x10, x23, #4
    add x10, x9, x10
    str x11, [x10]
    str x12, [x10, #8]

    lsl x10, x24, #4
    add x10, x9, x10
    str x13, [x10]
    str x14, [x10, #8]
    mov _addr, x25
    gret
    read_bullshit 256, ldp_simd_q_1

/*
 * MOVI/MVNI - Move immediate to vector
 * Code stream: [gadget][rd | Q<<8 | op<<9 | imm8<<16 | cmode<<24]
 * 
 * For simplicity, we implement the common cases:
 * - imm8=0, cmode=0, op=0 -> MOVI Vd, #0 (zeros)
 * - imm8=0, cmode=0, op=1 -> MVNI Vd, #0 (all ones)
 */
.gadget movi_v
    ldr x8, [_pc]
    add _pc, _pc, #8
    
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #1    // Q
    ubfx x11, x8, #9, #1    // op (0=MOVI, 1=MVNI)
    ubfx x12, x8, #16, #8   // imm8
    ubfx x13, x8, #24, #4   // cmode
    
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4         // offset = rd * 16
    add x14, x14, x15       // address of Vd
    
    // For now, just handle the simple cases
    // MOVI with imm8=0 -> zeros
    // MVNI with imm8=0 -> all ones
    cbz x11, movi_zero

    // MVNI: fill with ones
    mov x16, #-1
    str x16, [x14]
    // Check Q bit: Q=0 means 64-bit vector, Q=1 means 128-bit
    cbz x10, movi_mvni_clear_high
    str x16, [x14, #8]
    gret
movi_mvni_clear_high:
    str xzr, [x14, #8]      // Clear upper 64 bits for 64-bit vectors
    gret

movi_zero:
    // MOVI with imm8=0: fill with zeros (or expand imm8 based on cmode)
    // For simplicity, if imm8=0, just zero the register
    cbz x12, movi_really_zero

    // TODO: implement proper immediate expansion based on cmode
    // For now, treat any non-zero imm8 as undefined
    mov w0, #INT_UNDEFINED
    b fiber_exit

movi_really_zero:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SET_VEC_IMM - Load immediate vector value
 * Code stream: [gadget][rd][imm_lo][imm_hi]
 */
.gadget set_vec_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ldr x10, [_pc]          // imm_lo
    add _pc, _pc, #8
    ldr x11, [_pc]          // imm_hi
    add _pc, _pc, #8

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    add x12, x12, x13
    str x10, [x12]
    str x11, [x12, #8]

#if 0  // Debug: detect all-ones pattern
    // Check if this is setting all 1s (both lo and hi are -1)
    adds xzr, x10, #1       // check if lo == -1
    b.ne .Lset_vec_imm_done
    adds xzr, x11, #1       // check if hi == -1
    b.ne .Lset_vec_imm_done
    // Both are all 1s - call helper
    sub sp, sp, #96
    stp x0, x1, [sp]
    stp x2, x3, [sp, #16]
    stp x9, x10, [sp, #32]
    stp x11, x12, [sp, #48]
    str x30, [sp, #64]
    stp _cpu, _pc, [sp, #72]
    mov x0, x9              // rd
    mov x1, x10             // lo
    mov x2, x11             // hi
    mov x3, #1              // op_type = SET_VEC_IMM
    bl NAME(helper_check_all_ones)
    ldp x0, x1, [sp]
    ldp x2, x3, [sp, #16]
    ldp x9, x10, [sp, #32]
    ldp x11, x12, [sp, #48]
    ldr x30, [sp, #64]
    ldp _cpu, _pc, [sp, #72]
    add sp, sp, #96
.Lset_vec_imm_done:
#endif
    gret

/*
 * ORR (immediate) - Bitwise OR with immediate vector
 * Code stream: [gadget][rd | Q<<8][imm_lo][imm_hi]
 */
.gadget orr_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x17, x8, #8, #1    // Q
    ldr x10, [_pc]          // imm_lo
    add _pc, _pc, #8
    ldr x11, [_pc]          // imm_hi
    add _pc, _pc, #8

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    add x12, x12, x13

    ldr x14, [x12]
    orr x14, x14, x10
    str x14, [x12]

    cbz x17, .Lorr_imm_clear_high

    ldr x15, [x12, #8]
    orr x15, x15, x11
    str x15, [x12, #8]
    gret

.Lorr_imm_clear_high:
    str xzr, [x12, #8]
    gret

/*
 * BIC (immediate) - Bit clear with immediate vector
 * Code stream: [gadget][rd | Q<<8][imm_lo][imm_hi]
 */
.gadget bic_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x17, x8, #8, #1    // Q
    ldr x10, [_pc]          // imm_lo
    add _pc, _pc, #8
    ldr x11, [_pc]          // imm_hi
    add _pc, _pc, #8

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    add x12, x12, x13

    ldr x14, [x12]
    bic x14, x14, x10
    str x14, [x12]

    cbz x17, .Lbic_imm_clear_high

    ldr x15, [x12, #8]
    bic x15, x15, x11
    str x15, [x12, #8]
    gret

.Lbic_imm_clear_high:
    str xzr, [x12, #8]
    gret

/*
 * USHL - Unsigned shift left (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * For each element: Vd[i] = Vn[i] << Vm[i] (if Vm[i] >= 0)
 *                           Vn[i] >> -Vm[i] (if Vm[i] < 0, unsigned right shift)
 *
 * For simplicity, we implement element-by-element operations.
 */
.gadget ushl_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (vector dest)
    ubfx x10, x8, #8, #5    // rn (vector src1)
    ubfx x11, x8, #16, #5   // rm (vector shift amounts)
    ubfx x12, x8, #24, #2   // size (0=8b, 1=16b, 2=32b, 3=64b)
    ubfx x17, x8, #26, #1   // Q (0=64-bit vec, 1=128-bit vec)

    // Get vector register base addresses
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4         // Vd offset
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4        // Vn offset
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4        // Vm offset
    add x16, x13, x16       // &Vm

    // Branch based on element size
    cmp x12, #3
    b.eq .Lushl_64
    cmp x12, #2
    b.eq .Lushl_32
    cmp x12, #1
    b.eq .Lushl_16
    b .Lushl_8

.Lushl_8:
    // 8-bit elements: 8 or 16 elements
    ldr x20, [x15]           // Vn low 64 bits
    ldr x21, [x16]           // Vm low 64 bits
    mov x22, #0              // result low
    mov x23, #8              // loop count
    mov x24, #0              // bit position

.Lushl_8_loop:
    lsr x25, x20, x24          // shift to get element at bit position x24
    and x25, x25, #0xff       // extract byte from Vn
    lsr x26, x21, x24
    sbfx x26, x26, #0, #8     // extract signed shift amount from Vm
    cmp x26, #0
    b.lt .Lushl_8_right
    lsl x25, x25, x26          // left shift
    and x25, x25, #0xff
    b .Lushl_8_store
.Lushl_8_right:
    neg x26, x26
    lsr x25, x25, x26          // right shift
.Lushl_8_store:
    lsl x25, x25, x24          // position in result
    orr x22, x22, x25
    add x24, x24, #8
    subs x23, x23, #1
    b.ne .Lushl_8_loop

    str x22, [x14]           // store low result
    cbz x17, .Lushl_clear_high

    // Process high 64 bits if Q=1
    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    mov x22, #0
    mov x23, #8
    mov x24, #0

.Lushl_8_hi_loop:
    lsr x25, x20, x24
    and x25, x25, #0xff
    lsr x26, x21, x24
    sbfx x26, x26, #0, #8
    cmp x26, #0
    b.lt .Lushl_8_hi_right
    lsl x25, x25, x26
    and x25, x25, #0xff
    b .Lushl_8_hi_store
.Lushl_8_hi_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_8_hi_store:
    lsl x25, x25, x24
    orr x22, x22, x25
    add x24, x24, #8
    subs x23, x23, #1
    b.ne .Lushl_8_hi_loop

    str x22, [x14, #8]
    gret

.Lushl_16:
    // 16-bit elements: 4 or 8 elements
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0
    mov x23, #4
    mov x24, #0

.Lushl_16_loop:
    lsr x25, x20, x24
    and x25, x25, #0xffff
    lsr x26, x21, x24
    sbfx x26, x26, #0, #16
    cmp x26, #0
    b.lt .Lushl_16_right
    lsl x25, x25, x26
    and x25, x25, #0xffff
    b .Lushl_16_store
.Lushl_16_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_16_store:
    lsl x25, x25, x24
    orr x22, x22, x25
    add x24, x24, #16
    subs x23, x23, #1
    b.ne .Lushl_16_loop

    str x22, [x14]
    cbz x17, .Lushl_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    mov x22, #0
    mov x23, #4
    mov x24, #0

.Lushl_16_hi_loop:
    lsr x25, x20, x24
    and x25, x25, #0xffff
    lsr x26, x21, x24
    sbfx x26, x26, #0, #16
    cmp x26, #0
    b.lt .Lushl_16_hi_right
    lsl x25, x25, x26
    and x25, x25, #0xffff
    b .Lushl_16_hi_store
.Lushl_16_hi_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_16_hi_store:
    lsl x25, x25, x24
    orr x22, x22, x25
    add x24, x24, #16
    subs x23, x23, #1
    b.ne .Lushl_16_hi_loop

    str x22, [x14, #8]
    gret

.Lushl_32:
    // 32-bit elements: 2 or 4 elements
    ldr x20, [x15]
    ldr x21, [x16]

    // First 32-bit element
    and x25, x20, #0xffffffff
    sbfx x26, x21, #0, #32
    cmp x26, #0
    b.lt .Lushl_32_0_right
    lsl x25, x25, x26
    and x25, x25, #0xffffffff
    b .Lushl_32_0_done
.Lushl_32_0_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_32_0_done:
    mov x22, x25

    // Second 32-bit element
    lsr x25, x20, #32
    sbfx x26, x21, #32, #32
    cmp x26, #0
    b.lt .Lushl_32_1_right
    lsl x25, x25, x26
    and x25, x25, #0xffffffff
    b .Lushl_32_1_done
.Lushl_32_1_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_32_1_done:
    orr x22, x22, x25, lsl #32

    str x22, [x14]
    cbz x17, .Lushl_clear_high

    // High 64 bits if Q=1
    ldr x20, [x15, #8]
    ldr x21, [x16, #8]

    and x25, x20, #0xffffffff
    sbfx x26, x21, #0, #32
    cmp x26, #0
    b.lt .Lushl_32_2_right
    lsl x25, x25, x26
    and x25, x25, #0xffffffff
    b .Lushl_32_2_done
.Lushl_32_2_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_32_2_done:
    mov x22, x25

    lsr x25, x20, #32
    sbfx x26, x21, #32, #32
    cmp x26, #0
    b.lt .Lushl_32_3_right
    lsl x25, x25, x26
    and x25, x25, #0xffffffff
    b .Lushl_32_3_done
.Lushl_32_3_right:
    neg x26, x26
    lsr x25, x25, x26
.Lushl_32_3_done:
    orr x22, x22, x25, lsl #32

    str x22, [x14, #8]
    gret

.Lushl_64:
    // 64-bit elements: 1 or 2 elements
    ldr x20, [x15]
    ldr x21, [x16]
    sbfx x26, x21, #0, #8     // shift amount (signed, only 8 bits matter)
    cmp x26, #0
    b.lt .Lushl_64_right
    lsl x22, x20, x26
    b .Lushl_64_done
.Lushl_64_right:
    neg x26, x26
    lsr x22, x20, x26
.Lushl_64_done:
    str x22, [x14]
    cbz x17, .Lushl_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    sbfx x26, x21, #0, #8
    cmp x26, #0
    b.lt .Lushl_64_hi_right
    lsl x22, x20, x26
    b .Lushl_64_hi_done
.Lushl_64_hi_right:
    neg x26, x26
    lsr x22, x20, x26
.Lushl_64_hi_done:
    str x22, [x14, #8]
    gret

.Lushl_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * Macro for NEON three-same register shift instructions.
 * All of SRSHL, URSHL, SQSHL, UQSHL, SQRSHL, UQRSHL are native NEON instructions
 * and support all element sizes including 64-bit (2D with Q=1).
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.macro make_vec_shift_three_same name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .L\name\()_size_b
    cmp x12, #1
    b.eq .L\name\()_size_h
    cmp x12, #2
    b.eq .L\name\()_size_s
    // size == 3: 64-bit elements (only valid with Q=1)
    \insn v0.2d, v0.2d, v1.2d
    b .L\name\()_store_q

.L\name\()_size_b:
    cbz x17, .L\name\()_b_q0
    \insn v0.16b, v0.16b, v1.16b
    b .L\name\()_store_q
.L\name\()_b_q0:
    \insn v0.8b, v0.8b, v1.8b
    b .L\name\()_store_low

.L\name\()_size_h:
    cbz x17, .L\name\()_h_q0
    \insn v0.8h, v0.8h, v1.8h
    b .L\name\()_store_q
.L\name\()_h_q0:
    \insn v0.4h, v0.4h, v1.4h
    b .L\name\()_store_low

.L\name\()_size_s:
    cbz x17, .L\name\()_s_q0
    \insn v0.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \insn v0.2s, v0.2s, v1.2s
    b .L\name\()_store_low

.L\name\()_store_q:
    str q0, [x14]
    gret

.L\name\()_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

// SSHL - Signed shift left (uses arithmetic right shift for negative shift values)
make_vec_shift_three_same sshl, sshl
make_vec_shift_three_same srshl, srshl
make_vec_shift_three_same urshl, urshl
make_vec_shift_three_same sqshl, sqshl
make_vec_shift_three_same uqshl, uqshl
make_vec_shift_three_same sqrshl, sqrshl
make_vec_shift_three_same uqrshl, uqrshl

// Saturating add/sub (support B/H/S/D)
make_vec_shift_three_same sqadd, sqadd
make_vec_shift_three_same uqadd, uqadd
make_vec_shift_three_same sqsub, sqsub
make_vec_shift_three_same uqsub, uqsub

// Halving sub (B/H/S only — no D variant; gen.c rejects size=3)
// Use a dedicated macro that omits the .2d path
.macro make_vec_three_same_noD name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16
    ldr q0, [x15]
    ldr q1, [x16]
    cmp x12, #0
    b.eq .L\name\()_size_b
    cmp x12, #1
    b.eq .L\name\()_size_h
    // size == 2: 32-bit
    cbz x17, .L\name\()_s_q0
    \insn v0.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \insn v0.2s, v0.2s, v1.2s
    b .L\name\()_store_low
.L\name\()_size_b:
    cbz x17, .L\name\()_b_q0
    \insn v0.16b, v0.16b, v1.16b
    b .L\name\()_store_q
.L\name\()_b_q0:
    \insn v0.8b, v0.8b, v1.8b
    b .L\name\()_store_low
.L\name\()_size_h:
    cbz x17, .L\name\()_h_q0
    \insn v0.8h, v0.8h, v1.8h
    b .L\name\()_store_q
.L\name\()_h_q0:
    \insn v0.4h, v0.4h, v1.4h
    b .L\name\()_store_low
.L\name\()_store_q:
    str q0, [x14]
    gret
.L\name\()_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_vec_three_same_noD shsub, shsub
make_vec_three_same_noD uhsub, uhsub

// Compare register (B/H/S/D)
make_vec_shift_three_same cmgt_reg, cmgt
make_vec_shift_three_same cmge_reg, cmge

/*
 * Macro for FP vector three-same instructions.
 * These use sz (0=single, 1=double) instead of integer size field.
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | sz<<24 | Q<<26]
 * Single: .2s (Q=0) or .4s (Q=1)
 * Double: .2d (Q=1 only; Q=0 is undefined for most)
 */
.macro make_fp_vec_three_same name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // sz (0=single, 1=double)
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cbnz x12, .L\name\()_double
    // Single precision
    cbz x17, .L\name\()_s_q0
    \insn v0.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \insn v0.2s, v0.2s, v1.2s
    b .L\name\()_store_low

.L\name\()_double:
    // Double precision (Q must be 1)
    \insn v0.2d, v0.2d, v1.2d
    b .L\name\()_store_q

.L\name\()_store_q:
    str q0, [x14]
    gret

.L\name\()_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

// FP vector three-same operations
make_fp_vec_three_same fp_fadd, fadd
make_fp_vec_three_same fp_fsub, fsub
make_fp_vec_three_same fp_fmul, fmul
make_fp_vec_three_same fp_fdiv, fdiv
make_fp_vec_three_same fp_fmulx, fmulx
/*
 * FMLA/FMLS need a separate macro because they accumulate into Vd:
 *   FMLA Vd, Vn, Vm => Vd = Vd + Vn*Vm
 * The standard make_fp_vec_three_same macro loads Vn→v0, Vm→v1 and
 * stores v0, which computes Vn + Vn*Vm (wrong).
 */
.macro make_fp_vec_three_same_accum name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // sz (0=single, 1=double)
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]           // Vn
    ldr q1, [x16]           // Vm
    ldr q2, [x14]           // Vd (accumulator)

    cbnz x12, .L\name\()_double
    // Single precision
    cbz x17, .L\name\()_s_q0
    \insn v2.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \insn v2.2s, v0.2s, v1.2s
    b .L\name\()_store_low

.L\name\()_double:
    // Double precision (Q must be 1)
    \insn v2.2d, v0.2d, v1.2d
    b .L\name\()_store_q

.L\name\()_store_q:
    str q2, [x14]
    gret

.L\name\()_store_low:
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_fp_vec_three_same_accum fp_fmla, fmla
make_fp_vec_three_same_accum fp_fmls, fmls
make_fp_vec_three_same fp_fmax, fmax
make_fp_vec_three_same fp_fmin, fmin
make_fp_vec_three_same fp_fmaxnm, fmaxnm
make_fp_vec_three_same fp_fminnm, fminnm
make_fp_vec_three_same fp_faddp, faddp
make_fp_vec_three_same fp_fmaxp, fmaxp
make_fp_vec_three_same fp_fminp, fminp
make_fp_vec_three_same fp_frecps, frecps
make_fp_vec_three_same fp_frsqrts, frsqrts
make_fp_vec_three_same fp_fcmeq, fcmeq
make_fp_vec_three_same fp_fcmge, fcmge
make_fp_vec_three_same fp_fcmgt, fcmgt
make_fp_vec_three_same fp_facge, facge
make_fp_vec_three_same fp_facgt, facgt
make_fp_vec_three_same fp_fabd, fabd

/*
 * CMHI - Compare higher (unsigned greater than)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * For each element: Vd[i] = (Vn[i] > Vm[i]) ? -1 : 0
 */
.gadget cmhi_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    cmp x12, #3
    b.eq .Lcmhi_64
    cmp x12, #2
    b.eq .Lcmhi_32
    cmp x12, #1
    b.eq .Lcmhi_16
    b .Lcmhi_8

.Lcmhi_8:
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0
    mov x23, #8
    mov x24, #0

.Lcmhi_8_loop:
    lsr x25, x20, x24
    and x25, x25, #0xff
    lsr x26, x21, x24
    and x26, x26, #0xff
    cmp x25, x26
    cset x19, hi            // set 1 if Vn > Vm (use x19 to avoid clobbering _addr/x7)
    neg x19, x19            // -1 if true, 0 if false
    and x19, x19, #0xff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #8
    subs x23, x23, #1
    b.ne .Lcmhi_8_loop

    str x22, [x14]
    cbz x17, .Lcmhi_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    mov x22, #0
    mov x23, #8
    mov x24, #0

.Lcmhi_8_hi_loop:
    lsr x25, x20, x24
    and x25, x25, #0xff
    lsr x26, x21, x24
    and x26, x26, #0xff
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x19, x19, #0xff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #8
    subs x23, x23, #1
    b.ne .Lcmhi_8_hi_loop

    str x22, [x14, #8]
    gret

.Lcmhi_16:
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0
    mov x23, #4
    mov x24, #0

.Lcmhi_16_loop:
    lsr x25, x20, x24
    and x25, x25, #0xffff
    lsr x26, x21, x24
    and x26, x26, #0xffff
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x19, x19, #0xffff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #16
    subs x23, x23, #1
    b.ne .Lcmhi_16_loop

    str x22, [x14]
    cbz x17, .Lcmhi_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    mov x22, #0
    mov x23, #4
    mov x24, #0

.Lcmhi_16_hi_loop:
    lsr x25, x20, x24
    and x25, x25, #0xffff
    lsr x26, x21, x24
    and x26, x26, #0xffff
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x19, x19, #0xffff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #16
    subs x23, x23, #1
    b.ne .Lcmhi_16_hi_loop

    str x22, [x14, #8]
    gret

.Lcmhi_32:
    ldr x20, [x15]
    ldr x21, [x16]

    // First element
    and x25, x20, #0xffffffff
    and x26, x21, #0xffffffff
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x22, x19, #0xffffffff

    // Second element
    lsr x25, x20, #32
    lsr x26, x21, #32
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x19, x19, #0xffffffff
    orr x22, x22, x19, lsl #32

    str x22, [x14]
    cbz x17, .Lcmhi_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]

    and x25, x20, #0xffffffff
    and x26, x21, #0xffffffff
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x22, x19, #0xffffffff

    lsr x25, x20, #32
    lsr x26, x21, #32
    cmp x25, x26
    cset x19, hi
    neg x19, x19
    and x19, x19, #0xffffffff
    orr x22, x22, x19, lsl #32

    str x22, [x14, #8]
    gret

.Lcmhi_64:
    ldr x20, [x15]
    ldr x21, [x16]
    cmp x20, x21
    cset x22, hi
    neg x22, x22
    str x22, [x14]
    cbz x17, .Lcmhi_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    cmp x20, x21
    cset x22, hi
    neg x22, x22
    str x22, [x14, #8]
    gret

.Lcmhi_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * CMHS - Compare higher or same (unsigned greater or equal)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * For each element: Vd[i] = (Vn[i] >= Vm[i]) ? -1 : 0
 */
.gadget cmhs_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    cmp x12, #3
    b.eq .Lcmhs_64
    cmp x12, #2
    b.eq .Lcmhs_32
    cmp x12, #1
    b.eq .Lcmhs_16
    b .Lcmhs_8

.Lcmhs_8:
    // Use x20-x27 to avoid clobbering _cpu (x1) and _tlb (x2)
    ldr x20, [x15]          // Vn low
    ldr x21, [x16]          // Vm low
    mov x22, #0             // result
    mov x23, #8             // loop count
    mov x24, #0             // bit position

.Lcmhs_8_loop:
    lsr x25, x20, x24
    and x25, x25, #0xff
    lsr x26, x21, x24
    and x26, x26, #0xff
    cmp x25, x26
    cset x19, hs            // set 1 if Vn >= Vm (unsigned)
    neg x19, x19            // -1 if true, 0 if false
    and x19, x19, #0xff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #8
    subs x23, x23, #1
    b.ne .Lcmhs_8_loop

    str x22, [x14]
    cbz x17, .Lcmhs_clear_high

    ldr x20, [x15, #8]      // Vn high
    ldr x21, [x16, #8]      // Vm high
    mov x22, #0
    mov x23, #8
    mov x24, #0

.Lcmhs_8_hi_loop:
    lsr x25, x20, x24
    and x25, x25, #0xff
    lsr x26, x21, x24
    and x26, x26, #0xff
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x19, x19, #0xff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #8
    subs x23, x23, #1
    b.ne .Lcmhs_8_hi_loop

    str x22, [x14, #8]
    gret

.Lcmhs_16:
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0
    mov x23, #4
    mov x24, #0

.Lcmhs_16_loop:
    lsr x25, x20, x24
    and x25, x25, #0xffff
    lsr x26, x21, x24
    and x26, x26, #0xffff
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x19, x19, #0xffff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #16
    subs x23, x23, #1
    b.ne .Lcmhs_16_loop

    str x22, [x14]
    cbz x17, .Lcmhs_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    mov x22, #0
    mov x23, #4
    mov x24, #0

.Lcmhs_16_hi_loop:
    lsr x25, x20, x24
    and x25, x25, #0xffff
    lsr x26, x21, x24
    and x26, x26, #0xffff
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x19, x19, #0xffff
    lsl x19, x19, x24
    orr x22, x22, x19
    add x24, x24, #16
    subs x23, x23, #1
    b.ne .Lcmhs_16_hi_loop

    str x22, [x14, #8]
    gret

.Lcmhs_32:
    ldr x20, [x15]
    ldr x21, [x16]

    // First element
    and x25, x20, #0xffffffff
    and x26, x21, #0xffffffff
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x22, x19, #0xffffffff

    // Second element
    lsr x25, x20, #32
    lsr x26, x21, #32
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x19, x19, #0xffffffff
    orr x22, x22, x19, lsl #32

    str x22, [x14]
    cbz x17, .Lcmhs_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]

    and x25, x20, #0xffffffff
    and x26, x21, #0xffffffff
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x22, x19, #0xffffffff

    lsr x25, x20, #32
    lsr x26, x21, #32
    cmp x25, x26
    cset x19, hs
    neg x19, x19
    and x19, x19, #0xffffffff
    orr x22, x22, x19, lsl #32

    str x22, [x14, #8]
    gret

.Lcmhs_64:
    ldr x20, [x15]
    ldr x21, [x16]
    cmp x20, x21
    cset x22, hs
    neg x22, x22
    str x22, [x14]
    cbz x17, .Lcmhs_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    cmp x20, x21
    cset x22, hs
    neg x22, x22
    str x22, [x14, #8]
    gret

.Lcmhs_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * CMEQ - Compare equal (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * For each element: Vd[i] = (Vn[i] == Vm[i]) ? -1 : 0
 */
.gadget cmeq_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    cmp x12, #3
    b.eq .Lcmeq_64
    cmp x12, #2
    b.eq .Lcmeq_32
    cmp x12, #1
    b.eq .Lcmeq_16
    b .Lcmeq_8

.Lcmeq_8:
    ldr x20, [x15]
    ldr x21, [x16]
    // XOR to check equality - each byte is 0 if equal
    eor x22, x20, x21
    mov x23, #0
    mov x24, #8
    mov x25, #0

.Lcmeq_8_loop:
    lsr x26, x22, x25
    and x26, x26, #0xff
    cmp x26, #0
    cset x19, eq
    neg x19, x19
    and x19, x19, #0xff
    lsl x19, x19, x25
    orr x23, x23, x19
    add x25, x25, #8
    subs x24, x24, #1
    b.ne .Lcmeq_8_loop

    str x23, [x14]
    cbz x17, .Lcmeq_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    eor x22, x20, x21
    mov x23, #0
    mov x24, #8
    mov x25, #0

.Lcmeq_8_hi_loop:
    lsr x26, x22, x25
    and x26, x26, #0xff
    cmp x26, #0
    cset x19, eq
    neg x19, x19
    and x19, x19, #0xff
    lsl x19, x19, x25
    orr x23, x23, x19
    add x25, x25, #8
    subs x24, x24, #1
    b.ne .Lcmeq_8_hi_loop

    str x23, [x14, #8]
    gret

.Lcmeq_16:
    ldr x20, [x15]
    ldr x21, [x16]
    eor x22, x20, x21
    mov x23, #0
    mov x24, #4
    mov x25, #0

.Lcmeq_16_loop:
    lsr x26, x22, x25
    and x26, x26, #0xffff
    cmp x26, #0
    cset x19, eq
    neg x19, x19
    and x19, x19, #0xffff
    lsl x19, x19, x25
    orr x23, x23, x19
    add x25, x25, #16
    subs x24, x24, #1
    b.ne .Lcmeq_16_loop

    str x23, [x14]
    cbz x17, .Lcmeq_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    eor x22, x20, x21
    mov x23, #0
    mov x24, #4
    mov x25, #0

.Lcmeq_16_hi_loop:
    lsr x26, x22, x25
    and x26, x26, #0xffff
    cmp x26, #0
    cset x19, eq
    neg x19, x19
    and x19, x19, #0xffff
    lsl x19, x19, x25
    orr x23, x23, x19
    add x25, x25, #16
    subs x24, x24, #1
    b.ne .Lcmeq_16_hi_loop

    str x23, [x14, #8]
    gret

.Lcmeq_32:
    ldr x20, [x15]
    ldr x21, [x16]

    and x25, x20, #0xffffffff
    and x26, x21, #0xffffffff
    cmp x25, x26
    cset x19, eq
    neg x19, x19
    and x22, x19, #0xffffffff

    lsr x25, x20, #32
    lsr x26, x21, #32
    cmp x25, x26
    cset x19, eq
    neg x19, x19
    and x19, x19, #0xffffffff
    orr x22, x22, x19, lsl #32

    str x22, [x14]
    cbz x17, .Lcmeq_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]

    and x25, x20, #0xffffffff
    and x26, x21, #0xffffffff
    cmp x25, x26
    cset x19, eq
    neg x19, x19
    and x22, x19, #0xffffffff

    lsr x25, x20, #32
    lsr x26, x21, #32
    cmp x25, x26
    cset x19, eq
    neg x19, x19
    and x19, x19, #0xffffffff
    orr x22, x22, x19, lsl #32

    str x22, [x14, #8]
    gret

.Lcmeq_64:
    ldr x20, [x15]
    ldr x21, [x16]
    cmp x20, x21
    cset x22, eq
    neg x22, x22
    str x22, [x14]
    cbz x17, .Lcmeq_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    cmp x20, x21
    cset x22, eq
    neg x22, x22
    str x22, [x14, #8]
    gret

.Lcmeq_clear_high:
    str xzr, [x14, #8]
    gret

// Old manual cmeq_zero_vec replaced by native NEON macro (make_int_vec_cmp_zero) above

/*
 * XTN/SQXTUN/SQXTN/UQXTN - Narrowing instructions
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0=8H→8B, 1=4S→4H, 2=2D→2S
 * Q: 0=lower half (XTN), 1=upper half (XTN2)
 * Uses native NEON narrowing instructions.
 */
.macro make_narrow_vec name, insn_b_lo, insn_b_hi, insn_h_lo, insn_h_hi, insn_s_lo, insn_s_hi
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source (wide)
    ldr q1, [x14]           // load dest (for Q=1, preserve lower half)
    cmp x12, #2
    b.eq .L\name\()_2d
    cmp x12, #1
    b.eq .L\name\()_4s
    // size=0: 8H→8B
    cbz x17, .L\name\()_8h_lo
    \insn_b_hi                // XTN2/etc: narrow into upper half of v1
    b .L\name\()_store128
.L\name\()_8h_lo:
    \insn_b_lo                // XTN: narrow into lower half of v1
    b .L\name\()_store64
.L\name\()_4s:
    cbz x17, .L\name\()_4s_lo
    \insn_h_hi
    b .L\name\()_store128
.L\name\()_4s_lo:
    \insn_h_lo
    b .L\name\()_store64
.L\name\()_2d:
    cbz x17, .L\name\()_2d_lo
    \insn_s_hi
    b .L\name\()_store128
.L\name\()_2d_lo:
    \insn_s_lo
.L\name\()_store64:
    stp xzr, xzr, [x14]     // clear destination
    str d1, [x14]            // store lower 64 bits only
    gret
.L\name\()_store128:
    str q1, [x14]            // store full 128 bits (upper half inserted)
    gret
.endm

/*
 * UADDLP/SADDLP/UADALP/SADALP - Pairwise add long
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 * size: 0=B→H, 1=H→S, 2=S→D
 * Uses native NEON pairwise instructions.
 */
.macro make_pairwise_addl name, insn_b_8, insn_b_16, insn_h_4, insn_h_8, insn_s_2, insn_s_4
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source
    ldr q2, [x14]           // load dest (for accumulate variants)
    cmp x12, #2
    b.eq .L\name\()_s
    cmp x12, #1
    b.eq .L\name\()_h
    cbz x17, .L\name\()_b8
    \insn_b_16
    str q1, [x14]
    gret
.L\name\()_b8:
    \insn_b_8
    str d1, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_h:
    cbz x17, .L\name\()_h4
    \insn_h_8
    str q1, [x14]
    gret
.L\name\()_h4:
    \insn_h_4
    str d1, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_s:
    cbz x17, .L\name\()_s2
    \insn_s_4
    str q1, [x14]
    gret
.L\name\()_s2:
    \insn_s_2
    str d1, [x14]
    str xzr, [x14, #8]
    gret
.endm

/*
 * SHRN/RSHRN - Shift Right Narrow (and rounding variant)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * esize: 0=8H→8B, 1=4S→4H, 2=2D→2S (source element size code, not actual)
 * Q=0: write lower half, Q=1: write upper half (SHRN2/RSHRN2)
 * Uses urshl/srshl (variable shift with negative amount) + xtn to narrow.
 */
.macro make_shrn_vec name, sh8h, sh4s, sh2d
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // shift amount
    ubfx x12, x8, #24, #4   // esize (0=B, 1=H, 2=S - narrow target)
    ubfx x17, x8, #28, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source (wide elements)
    ldr q2, [x14]           // load dest (for Q=1 preserve lower)
    neg x11, x11             // negative shift for right shift
    cmp x12, #2
    b.eq .L\name\()_2d
    cmp x12, #1
    b.eq .L\name\()_4s
    // esize=0: 8H→8B
    dup v1.8h, w11
    \sh8h
    cbz x17, .L\name\()_8h_lo
    xtn2 v2.16b, v0.8h
    str q2, [x14]
    gret
.L\name\()_8h_lo:
    xtn v2.8b, v0.8h
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_4s:
    dup v1.4s, w11
    \sh4s
    cbz x17, .L\name\()_4s_lo
    xtn2 v2.8h, v0.4s
    str q2, [x14]
    gret
.L\name\()_4s_lo:
    xtn v2.4h, v0.4s
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_2d:
    dup v1.2d, x11
    \sh2d
    cbz x17, .L\name\()_2d_lo
    xtn2 v2.4s, v0.2d
    str q2, [x14]
    gret
.L\name\()_2d_lo:
    xtn v2.2s, v0.2d
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

// SHRN: unsigned shift right (truncate) then narrow — ushl (non-rounding)
make_shrn_vec shrn, "ushl v0.8h, v0.8h, v1.8h", "ushl v0.4s, v0.4s, v1.4s", "ushl v0.2d, v0.2d, v1.2d"
// RSHRN: unsigned rounding shift right then narrow — urshl (unsigned rounding)
make_shrn_vec rshrn, "urshl v0.8h, v0.8h, v1.8h", "urshl v0.4s, v0.4s, v1.4s", "urshl v0.2d, v0.2d, v1.2d"

make_pairwise_addl uaddlp, "uaddlp v1.4h, v0.8b", "uaddlp v1.8h, v0.16b", "uaddlp v1.2s, v0.4h", "uaddlp v1.4s, v0.8h", "uaddlp v1.1d, v0.2s", "uaddlp v1.2d, v0.4s"
make_pairwise_addl saddlp, "saddlp v1.4h, v0.8b", "saddlp v1.8h, v0.16b", "saddlp v1.2s, v0.4h", "saddlp v1.4s, v0.8h", "saddlp v1.1d, v0.2s", "saddlp v1.2d, v0.4s"

// For accumulate variants, load dest into v1 first (native insn accumulates into v1)
.macro make_pairwise_accl name, insn_b_8, insn_b_16, insn_h_4, insn_h_8, insn_s_2, insn_s_4
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source
    ldr q1, [x14]           // load dest into v1 (accumulate target)
    cmp x12, #2
    b.eq .L\name\()_s
    cmp x12, #1
    b.eq .L\name\()_h
    cbz x17, .L\name\()_b8
    \insn_b_16
    str q1, [x14]
    gret
.L\name\()_b8:
    \insn_b_8
    str d1, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_h:
    cbz x17, .L\name\()_h4
    \insn_h_8
    str q1, [x14]
    gret
.L\name\()_h4:
    \insn_h_4
    str d1, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_s:
    cbz x17, .L\name\()_s2
    \insn_s_4
    str q1, [x14]
    gret
.L\name\()_s2:
    \insn_s_2
    str d1, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_pairwise_accl uadalp, "uadalp v1.4h, v0.8b", "uadalp v1.8h, v0.16b", "uadalp v1.2s, v0.4h", "uadalp v1.4s, v0.8h", "uadalp v1.1d, v0.2s", "uadalp v1.2d, v0.4s"
make_pairwise_accl sadalp, "sadalp v1.4h, v0.8b", "sadalp v1.8h, v0.16b", "sadalp v1.2s, v0.4h", "sadalp v1.4s, v0.8h", "sadalp v1.1d, v0.2s", "sadalp v1.2d, v0.4s"

make_narrow_vec sqxtun, "sqxtun v1.8b, v0.8h", "sqxtun2 v1.16b, v0.8h", "sqxtun v1.4h, v0.4s", "sqxtun2 v1.8h, v0.4s", "sqxtun v1.2s, v0.2d", "sqxtun2 v1.4s, v0.2d"
make_narrow_vec sqxtn, "sqxtn v1.8b, v0.8h", "sqxtn2 v1.16b, v0.8h", "sqxtn v1.4h, v0.4s", "sqxtn2 v1.8h, v0.4s", "sqxtn v1.2s, v0.2d", "sqxtn2 v1.4s, v0.2d"
make_narrow_vec uqxtn, "uqxtn v1.8b, v0.8h", "uqxtn2 v1.16b, v0.8h", "uqxtn v1.4h, v0.4s", "uqxtn2 v1.8h, v0.4s", "uqxtn v1.2s, v0.2d", "uqxtn2 v1.4s, v0.2d"

// Old make_cmpzero_vec cmgt/cmge/cmlt/cmle removed — replaced by make_int_vec_cmp_zero above

/*
 * Vector Logical Operations
 * These operate on the entire 64-bit or 128-bit vector as a bitwise operation.
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 * Note: size is ignored for logical ops (they work on the whole vector)
 */

/*
 * AND - Bitwise AND vector
 */
.gadget and_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    // Low 64 bits
    ldr x20, [x15]
    ldr x21, [x16]
    and x22, x20, x21
    str x22, [x14]

    cbz x17, .Land_clear_high

    // High 64 bits if Q=1
    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    and x22, x20, x21
    str x22, [x14, #8]
    gret

.Land_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * ORR - Bitwise OR vector
 */
.gadget orr_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    ldr x20, [x15]
    ldr x21, [x16]
    orr x22, x20, x21
    str x22, [x14]

    cbz x17, .Lorr_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    orr x22, x20, x21
    str x22, [x14, #8]
    gret

.Lorr_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * EOR - Bitwise exclusive OR vector
 */
.gadget eor_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    ldr x20, [x15]
    ldr x21, [x16]
    eor x22, x20, x21
    str x22, [x14]

    cbz x17, .Leor_clear_high

    ldr x20, [x15, #8]
    ldr x21, [x16, #8]
    eor x22, x20, x21
    str x22, [x14, #8]
    gret

.Leor_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * BSL - Bitwise select
 * Vd = (Vn & Vd) | (Vm & ~Vd)
 */
.gadget bsl_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    // Low 64 bits
    ldr x20, [x14]          // Vd (mask)
    ldr x21, [x15]          // Vn
    ldr x22, [x16]          // Vm
    and x23, x21, x20       // Vn & Vd
    mvn x24, x20            // ~Vd
    and x24, x22, x24       // Vm & ~Vd
    orr x23, x23, x24
    str x23, [x14]

    cbz x17, .Lbsl_clear_high

    // High 64 bits
    ldr x20, [x14, #8]
    ldr x21, [x15, #8]
    ldr x22, [x16, #8]
    and x23, x21, x20
    mvn x24, x20
    and x24, x22, x24
    orr x23, x23, x24
    str x23, [x14, #8]
    gret

.Lbsl_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * BIT - Bitwise insert
 * Vd = (Vn & Vm) | (Vd & ~Vm)
 */
.gadget bit_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    // Low 64 bits
    ldr x20, [x14]          // Vd
    ldr x21, [x15]          // Vn
    ldr x22, [x16]          // Vm (mask)
    and x23, x21, x22       // Vn & Vm
    mvn x24, x22            // ~Vm
    and x24, x20, x24       // Vd & ~Vm
    orr x23, x23, x24
    str x23, [x14]

    cbz x17, .Lbit_clear_high

    // High 64 bits
    ldr x20, [x14, #8]
    ldr x21, [x15, #8]
    ldr x22, [x16, #8]
    and x23, x21, x22
    mvn x24, x22
    and x24, x20, x24
    orr x23, x23, x24
    str x23, [x14, #8]
    gret

.Lbit_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * BIF - Bitwise insert if false
 * Vd = (Vn & ~Vm) | (Vd & Vm)
 */
.gadget bif_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    // Low 64 bits
    ldr x20, [x14]          // Vd
    ldr x21, [x15]          // Vn
    ldr x22, [x16]          // Vm (mask)
    mvn x24, x22            // ~Vm
    and x23, x21, x24       // Vn & ~Vm
    and x24, x20, x22       // Vd & Vm
    orr x23, x23, x24
    str x23, [x14]

    cbz x17, .Lbif_clear_high

    // High 64 bits
    ldr x20, [x14, #8]
    ldr x21, [x15, #8]
    ldr x22, [x16, #8]
    mvn x24, x22
    and x23, x21, x24
    and x24, x20, x22
    orr x23, x23, x24
    str x23, [x14, #8]
    gret

.Lbif_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * BIC - Bit clear (Vn AND NOT Vm)
 */
.gadget bic_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    ldr x0, [x15]
    ldr x3, [x16]
    bic x19, x0, x3         // x19 = x0 AND NOT x3 (NOT x2 — x2 is _tlb!)
    str x19, [x14]

    cbz x17, .Lbic_clear_high

    ldr x0, [x15, #8]
    ldr x3, [x16, #8]
    bic x19, x0, x3
    str x19, [x14, #8]
    gret

.Lbic_clear_high:
    str xzr, [x14, #8]
    gret

// ORN - Bitwise OR NOT (Vd = Vn OR NOT Vm)
.gadget orn_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    lsl x16, x11, #4
    add x16, x13, x16

    ldr x0, [x15]
    ldr x3, [x16]
    orn x4, x0, x3          // x4 = x0 OR NOT x3
    str x4, [x14]

    cbz x17, .Lorn_clear_high

    ldr x0, [x15, #8]
    ldr x3, [x16, #8]
    orn x4, x0, x3
    str x4, [x14, #8]
    gret

.Lorn_clear_high:
    str xzr, [x14, #8]
    gret

// SABA/UABA - Signed/Unsigned absolute difference accumulate
// Vd = Vd + |Vn - Vm|  (accumulate into Vd, so must read Vd first)
.macro make_vec_aba name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]           // Vn
    ldr q1, [x16]           // Vm
    ldr q2, [x14]           // Vd (accumulator)

    cmp x12, #0
    b.eq .L\name\()_size_b
    cmp x12, #1
    b.eq .L\name\()_size_h
    // size == 2: 32-bit (no 64-bit for saba/uaba)
    cbz x17, .L\name\()_s_q0
    \insn v2.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \insn v2.2s, v0.2s, v1.2s
    b .L\name\()_store_low

.L\name\()_size_b:
    cbz x17, .L\name\()_b_q0
    \insn v2.16b, v0.16b, v1.16b
    b .L\name\()_store_q
.L\name\()_b_q0:
    \insn v2.8b, v0.8b, v1.8b
    b .L\name\()_store_low

.L\name\()_size_h:
    cbz x17, .L\name\()_h_q0
    \insn v2.8h, v0.8h, v1.8h
    b .L\name\()_store_q
.L\name\()_h_q0:
    \insn v2.4h, v0.4h, v1.4h
    b .L\name\()_store_low

.L\name\()_store_q:
    str q2, [x14]
    gret
.L\name\()_store_low:
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_vec_aba saba, saba
make_vec_aba uaba, uaba

/*
 * EXT - Extract from pair of vectors
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | imm4<<24 | Q<<28]
 *
 * Conceptually concatenates Vm:Vn (Vm is high, Vn is low) and extracts
 * a vector starting at byte position imm4.
 *
 * For Q=1 (128-bit): result[i] = concat[imm4+i] for i=0..15
 * For Q=0 (64-bit):  result[i] = concat[imm4+i] for i=0..7, imm4 must be 0-7
 */
.gadget ext_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #4   // imm4 (byte index)
    ubfx x17, x8, #28, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    // Load Vn and Vm
    ldr q0, [x15]           // Vn (low part of concatenation)
    ldr q1, [x16]           // Vm (high part of concatenation)

    // Branch on Q: 8B and 16B use different native EXT arrangements
    cbnz x17, .Lext_16b

    // Q=0 (8B): must use ext .8b to only consider lower 8 bytes of each reg
    adr x3, .Lext_table_8b
    add x3, x3, x12, lsl #3   // each case is 8 bytes (2 instructions)
    br x3

    .align 3
.Lext_table_8b:
    ext v2.8b, v0.8b, v1.8b, #0
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #1
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #2
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #3
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #4
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #5
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #6
    b .Lext_store_8b
    ext v2.8b, v0.8b, v1.8b, #7
    b .Lext_store_8b

.Lext_store_8b:
    str d2, [x14]
    str xzr, [x14, #8]
    gret

.Lext_16b:
    // Q=1 (16B): use ext .16b
    adr x3, .Lext_table_16b
    add x3, x3, x12, lsl #3   // each case is 8 bytes (2 instructions)
    br x3

    .align 3
.Lext_table_16b:
    ext v2.16b, v0.16b, v1.16b, #0
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #1
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #2
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #3
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #4
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #5
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #6
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #7
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #8
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #9
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #10
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #11
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #12
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #13
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #14
    b .Lext_store_16b
    ext v2.16b, v0.16b, v1.16b, #15
    b .Lext_store_16b

.Lext_store_16b:
    str q2, [x14]
    gret

/*
 * SHL (vector, immediate) - shift left immediate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 *
 * Each element is shifted left by the immediate value.
 */
.gadget shl_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // shift amount
    ubfx x12, x8, #24, #4   // esize (0=8, 1=16, 2=32, 3=64)
    ubfx x17, x8, #28, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    // Load source
    ldr q0, [x15]

    // Dispatch based on element size
    cmp x12, #3
    b.eq .Lshl_imm_64
    cmp x12, #2
    b.eq .Lshl_imm_32
    cmp x12, #1
    b.eq .Lshl_imm_16
    b .Lshl_imm_8

.Lshl_imm_8:
    // Use a jump table for 8-bit SHL (0-7 shift values)
    adr x3, .Lshl8_table
    and x19, x11, #7        // shift & 7
    add x3, x3, x19, lsl #3
    br x3
    .align 3
.Lshl8_table:
    shl v0.16b, v0.16b, #0
    b .Lshl_store
    shl v0.16b, v0.16b, #1
    b .Lshl_store
    shl v0.16b, v0.16b, #2
    b .Lshl_store
    shl v0.16b, v0.16b, #3
    b .Lshl_store
    shl v0.16b, v0.16b, #4
    b .Lshl_store
    shl v0.16b, v0.16b, #5
    b .Lshl_store
    shl v0.16b, v0.16b, #6
    b .Lshl_store
    shl v0.16b, v0.16b, #7
    b .Lshl_store

.Lshl_imm_16:
    adr x3, .Lshl16_table
    and x19, x11, #15
    add x3, x3, x19, lsl #3
    br x3
    .align 3
.Lshl16_table:
    shl v0.8h, v0.8h, #0
    b .Lshl_store
    shl v0.8h, v0.8h, #1
    b .Lshl_store
    shl v0.8h, v0.8h, #2
    b .Lshl_store
    shl v0.8h, v0.8h, #3
    b .Lshl_store
    shl v0.8h, v0.8h, #4
    b .Lshl_store
    shl v0.8h, v0.8h, #5
    b .Lshl_store
    shl v0.8h, v0.8h, #6
    b .Lshl_store
    shl v0.8h, v0.8h, #7
    b .Lshl_store
    shl v0.8h, v0.8h, #8
    b .Lshl_store
    shl v0.8h, v0.8h, #9
    b .Lshl_store
    shl v0.8h, v0.8h, #10
    b .Lshl_store
    shl v0.8h, v0.8h, #11
    b .Lshl_store
    shl v0.8h, v0.8h, #12
    b .Lshl_store
    shl v0.8h, v0.8h, #13
    b .Lshl_store
    shl v0.8h, v0.8h, #14
    b .Lshl_store
    shl v0.8h, v0.8h, #15
    b .Lshl_store

.Lshl_imm_32:
    // For 32-bit elements, use C helper due to many shift values
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14            // save rd ptr
    mov x20, x11            // save shift
    mov x21, x17            // save Q

    save_c
    mov x0, x14             // rd_ptr
    mov x1, x15             // rn_ptr
    mov w2, w20             // shift
    mov w3, #2              // esize (32-bit)
    mov w4, w21             // Q
    bl NAME(shl_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

.Lshl_imm_64:
    // For 64-bit elements, use C helper
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x17

    save_c
    mov x0, x14
    mov x1, x15
    mov w2, w20
    mov w3, #3              // esize (64-bit)
    mov w4, w21
    bl NAME(shl_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

.Lshl_store:
    cbnz x17, .Lshl_store_16b
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lshl_store_16b:
    str q0, [x14]
    gret

/*
 * USHR (vector, immediate) - unsigned shift right immediate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 */
.gadget ushr_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4
    ubfx x17, x8, #28, #1

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    // Use C helper for all sizes
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x12
    mov x22, x17

    save_c
    mov x0, x14             // rd_ptr
    mov x1, x15             // rn_ptr
    mov w2, w20             // shift
    mov w3, w21             // esize
    mov w4, w22             // Q
    bl NAME(ushr_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

/*
 * SSHR (vector, immediate) - signed shift right immediate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 */
.gadget sshr_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4
    ubfx x17, x8, #28, #1

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    // Use C helper
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x12
    mov x22, x17

    save_c
    mov x0, x14
    mov x1, x15
    mov w2, w20
    mov w3, w21
    mov w4, w22
    bl NAME(sshr_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

/*
 * SRSHR/URSHR/SRSRA/URSRA (vector, immediate) - Rounding shift right (and accumulate)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * Uses native NEON srshl/urshl with negative shift vector for efficiency.
 *
 * srshl/urshl Vd, Vn, Vm does: Vd[i] = round_shift(Vn[i], Vm[i])
 * where positive Vm = left shift, negative Vm = right shift with rounding
 */
.macro make_rounding_shift name, insn_b_8, insn_b_16, insn_h_4, insn_h_8, insn_s_2, insn_s_4, insn_d_2, accumulate=0
.gadget \name\()_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // shift amount
    ubfx x12, x8, #24, #4   // esize
    ubfx x17, x8, #28, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source
.if \accumulate
    ldr q2, [x14]           // load existing dest for accumulate
.endif
    // Create shift vector with -shift replicated to all elements
    neg x11, x11
    dup v1.16b, w11          // replicate -shift as bytes (works for all sizes since
                             // srshl/urshl reads shift per element as signed byte-sized)
    cmp x12, #3
    b.eq .L\name\()_64
    cmp x12, #2
    b.eq .L\name\()_32
    cmp x12, #1
    b.eq .L\name\()_16
    // size=0 (bytes): shift vector is already correct
    cbz x17, .L\name\()_8b
    \insn_b_16
    b .L\name\()_store
.L\name\()_8b:
    \insn_b_8
    b .L\name\()_store_lo
.L\name\()_16:
    // For 16-bit elements, need shift replicated per 16-bit lane
    dup v1.8h, w11
    cbz x17, .L\name\()_4h
    \insn_h_8
    b .L\name\()_store
.L\name\()_4h:
    \insn_h_4
    b .L\name\()_store_lo
.L\name\()_32:
    dup v1.4s, w11
    cbz x17, .L\name\()_2s
    \insn_s_4
    b .L\name\()_store
.L\name\()_2s:
    \insn_s_2
    b .L\name\()_store_lo
.L\name\()_64:
    dup v1.2d, x11
    \insn_d_2
.L\name\()_store:
.if \accumulate
    // For accumulate variants, we computed shifted result in v3, now add to dest
    // The caller macros put result in v3 for accumulate, v3 for non-accumulate
    add_placeholder_\name:
.endif
    str q3, [x14]
    gret
.L\name\()_store_lo:
.if \accumulate
    add_placeholder2_\name:
.endif
    str d3, [x14]
    str xzr, [x14, #8]
    gret
.endm

// SRSHR: Signed Rounding Shift Right
// srshl does signed rounding shift by variable amount (negative = right)
make_rounding_shift srshr, "srshl v3.8b, v0.8b, v1.8b", "srshl v3.16b, v0.16b, v1.16b", "srshl v3.4h, v0.4h, v1.4h", "srshl v3.8h, v0.8h, v1.8h", "srshl v3.2s, v0.2s, v1.2s", "srshl v3.4s, v0.4s, v1.4s", "srshl v3.2d, v0.2d, v1.2d"

// URSHR: Unsigned Rounding Shift Right
make_rounding_shift urshr, "urshl v3.8b, v0.8b, v1.8b", "urshl v3.16b, v0.16b, v1.16b", "urshl v3.4h, v0.4h, v1.4h", "urshl v3.8h, v0.8h, v1.8h", "urshl v3.2s, v0.2s, v1.2s", "urshl v3.4s, v0.4s, v1.4s", "urshl v3.2d, v0.2d, v1.2d"

/*
 * SRSRA/URSRA (vector, immediate) - Rounding shift right and accumulate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * rd = rd + rounding_shift_right(rn, shift)
 */
.macro make_rounding_sra name, shift_insn_b_8, shift_insn_b_16, shift_insn_h_4, shift_insn_h_8, shift_insn_s_2, shift_insn_s_4, shift_insn_d_2
.gadget \name\()_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // shift amount
    ubfx x12, x8, #24, #4   // esize
    ubfx x17, x8, #28, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source
    ldr q2, [x14]           // load existing dest for accumulate
    neg x11, x11
    cmp x12, #3
    b.eq .L\name\()_64
    cmp x12, #2
    b.eq .L\name\()_32
    cmp x12, #1
    b.eq .L\name\()_16
    // size=0 (bytes)
    dup v1.16b, w11
    cbz x17, .L\name\()_8b
    \shift_insn_b_16
    add v3.16b, v3.16b, v2.16b
    str q3, [x14]
    gret
.L\name\()_8b:
    \shift_insn_b_8
    add v3.8b, v3.8b, v2.8b
    str d3, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_16:
    dup v1.8h, w11
    cbz x17, .L\name\()_4h
    \shift_insn_h_8
    add v3.8h, v3.8h, v2.8h
    str q3, [x14]
    gret
.L\name\()_4h:
    \shift_insn_h_4
    add v3.4h, v3.4h, v2.4h
    str d3, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_32:
    dup v1.4s, w11
    cbz x17, .L\name\()_2s
    \shift_insn_s_4
    add v3.4s, v3.4s, v2.4s
    str q3, [x14]
    gret
.L\name\()_2s:
    \shift_insn_s_2
    add v3.2s, v3.2s, v2.2s
    str d3, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_64:
    dup v1.2d, x11
    \shift_insn_d_2
    add v3.2d, v3.2d, v2.2d
    str q3, [x14]
    gret
.endm

make_rounding_sra srsra, "srshl v3.8b, v0.8b, v1.8b", "srshl v3.16b, v0.16b, v1.16b", "srshl v3.4h, v0.4h, v1.4h", "srshl v3.8h, v0.8h, v1.8h", "srshl v3.2s, v0.2s, v1.2s", "srshl v3.4s, v0.4s, v1.4s", "srshl v3.2d, v0.2d, v1.2d"
make_rounding_sra ursra, "urshl v3.8b, v0.8b, v1.8b", "urshl v3.16b, v0.16b, v1.16b", "urshl v3.4h, v0.4h, v1.4h", "urshl v3.8h, v0.8h, v1.8h", "urshl v3.2s, v0.2s, v1.2s", "urshl v3.4s, v0.4s, v1.4s", "urshl v3.2d, v0.2d, v1.2d"

/*
 * SHL (scalar, immediate) - Scalar shift left immediate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24]
 *
 * For scalar, we only support 64-bit (D register) as that's what TLS uses.
 * Result is stored in scalar register with upper bits cleared.
 */
.gadget shl_imm_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // shift amount
    // esize at bits 24:27, but we only support 64-bit

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Dd
    lsl x15, x10, #4
    add x15, x13, x15       // &Dn

    // Load source value (64-bit)
    ldr x16, [x15]

    // Shift left by variable amount
    lsl x16, x16, x11

    // Store result and clear upper bits
    str x16, [x14]
    str xzr, [x14, #8]
    gret

/*
 * USHR (scalar, immediate) - Scalar unsigned shift right immediate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24]
 */
.gadget ushr_imm_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    ldr x16, [x15]
    lsr x16, x16, x11
    str x16, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SSHR (scalar, immediate) - Scalar signed shift right immediate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24]
 */
.gadget sshr_imm_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    ldr x16, [x15]
    asr x16, x16, x11       // arithmetic (signed) shift right
    str x16, [x14]
    str xzr, [x14, #8]
    gret

/*
 * USRA (vector, immediate) - Unsigned shift right and accumulate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * rd = rd + (rn >> shift) (unsigned)
 */
.gadget usra_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4
    ubfx x17, x8, #28, #1

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    // Use C helper
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x12
    mov x22, x17

    save_c
    mov x0, x14             // rd_ptr
    mov x1, x15             // rn_ptr
    mov w2, w20             // shift
    mov w3, w21             // esize
    mov w4, w22             // Q
    bl NAME(usra_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

/*
 * SSRA (vector, immediate) - Signed shift right and accumulate
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * rd = rd + (rn >> shift) (signed)
 */
.gadget ssra_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4
    ubfx x17, x8, #28, #1

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    // Use C helper
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x12
    mov x22, x17

    save_c
    mov x0, x14
    mov x1, x15
    mov w2, w20
    mov w3, w21
    mov w4, w22
    bl NAME(ssra_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

/*
 * USRA (scalar, immediate) - Unsigned shift right and accumulate (scalar D)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24]
 * rd = rd + (rn >> shift)
 */
.gadget usra_imm_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Dd
    lsl x15, x10, #4
    add x15, x13, x15       // &Dn

    ldr x16, [x14]          // current Dd value
    ldr x17, [x15]          // Dn value
    lsr x17, x17, x11       // unsigned shift right
    add x16, x16, x17       // accumulate
    str x16, [x14]
    // Don't clear upper bits - accumulate preserves scalar nature
    gret

/*
 * SSRA (scalar, immediate) - Signed shift right and accumulate (scalar D)
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24]
 * rd = rd + (rn >> shift) (signed)
 */
.gadget ssra_imm_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    ldr x16, [x14]
    ldr x17, [x15]
    asr x17, x17, x11       // arithmetic (signed) shift right
    add x16, x16, x17
    str x16, [x14]
    gret

/*
 * ADD (scalar, 64-bit integer) - Add two 64-bit integers in SIMD registers
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget add_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4    // &Dn
    add x16, x13, x11, lsl #4    // &Dm
    ldr x17, [x15]               // Dn
    ldr x3, [x16]                // Dm
    add x17, x17, x3
    add x14, x13, x9, lsl #4     // &Dd
    str x17, [x14]               // store result
    str xzr, [x14, #8]           // clear upper 64 bits
    gret

/*
 * SUB (scalar, 64-bit integer) - Subtract two 64-bit integers in SIMD registers
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sub_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5

    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr x17, [x15]
    ldr x3, [x16]
    sub x17, x17, x3
    add x14, x13, x9, lsl #4
    str x17, [x14]
    str xzr, [x14, #8]
    gret

/*
 * USHL (scalar, 64-bit) - Unsigned shift left D = Dn << Dm (mod 64)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget ushl_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    ushl d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SSHL (scalar, 64-bit) - Signed shift left D = Dn << Dm (mod 64)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sshl_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    sshl d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * CMHI (scalar, 64-bit) - Compare higher unsigned
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget cmhi_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    cmhi d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * CMHS (scalar, 64-bit) - Compare higher or same unsigned
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget cmhs_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    cmhs d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * CMGT (scalar, 64-bit) - Compare greater than signed
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget cmgt_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    cmgt d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * CMGE (scalar, 64-bit) - Compare greater or equal signed
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget cmge_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    cmge d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * CMEQ (scalar, 64-bit) - Compare equal
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget cmeq_scalar_i64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    add x13, _cpu, #CPU_fp
    add x15, x13, x10, lsl #4
    add x16, x13, x11, lsl #4
    ldr d0, [x15]
    ldr d1, [x16]
    cmeq d0, d0, d1
    add x14, x13, x9, lsl #4
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SCVTF (scalar, fixed-point) - Signed integer to FP with fractional bits
 * Code stream: [gadget addr][rd | rn<<8 | fbits<<16 | esize<<24]
 * Converts signed int in Dn/Sn to FP in Dd/Sd, dividing by 2^fbits
 */
.gadget scvtf_fixpt_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // fbits
    ubfx x12, x8, #24, #4   // esize

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Dd/Sd
    lsl x15, x10, #4
    add x15, x13, x15       // &Dn/Sn

    cmp x12, #3
    b.eq 1f
    // 32-bit: SCVTF Sd, Sn, #fbits
    ldr s0, [x15]
    // We need to build the SCVTF instruction dynamically since fbits is variable
    // Instead, convert integer to float then divide by 2^fbits
    fmov w16, s0
    scvtf s0, w16
    // Now divide by 2^fbits: multiply by 2^(-fbits)
    mov w17, #1
    lsl w17, w17, w11
    scvtf s1, w17
    fdiv s0, s0, s1
    str s0, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

1:  // 64-bit: SCVTF Dd, Dn, #fbits
    ldr x16, [x15]
    scvtf d0, x16
    // Divide by 2^fbits
    mov x17, #1
    lsl x17, x17, x11
    ucvtf d1, x17
    fdiv d0, d0, d1
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * UCVTF (scalar, fixed-point) - Unsigned integer to FP with fractional bits
 * Code stream: [gadget addr][rd | rn<<8 | fbits<<16 | esize<<24]
 */
.gadget ucvtf_fixpt_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    cmp x12, #3
    b.eq 1f
    // 32-bit
    ldr w16, [x15]
    ucvtf s0, w16
    mov w17, #1
    lsl w17, w17, w11
    scvtf s1, w17
    fdiv s0, s0, s1
    str s0, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

1:  // 64-bit
    ldr x16, [x15]
    ucvtf d0, x16
    mov x17, #1
    lsl x17, x17, x11
    ucvtf d1, x17
    fdiv d0, d0, d1
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * FCVTZS (scalar, fixed-point) - FP to signed integer with fractional bits
 * Code stream: [gadget addr][rd | rn<<8 | fbits<<16 | esize<<24]
 * Multiplies FP value by 2^fbits, then converts to signed int (round toward zero)
 */
.gadget fcvtzs_fixpt_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    cmp x12, #3
    b.eq 1f
    // 32-bit
    ldr s0, [x15]
    mov w17, #1
    lsl w17, w17, w11
    scvtf s1, w17
    fmul s0, s0, s1
    fcvtzs w16, s0
    str w16, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

1:  // 64-bit
    ldr d0, [x15]
    mov x17, #1
    lsl x17, x17, x11
    ucvtf d1, x17
    fmul d0, d0, d1
    fcvtzs x16, d0
    str x16, [x14]
    str xzr, [x14, #8]
    gret

/*
 * FCVTZU (scalar, fixed-point) - FP to unsigned integer with fractional bits
 * Code stream: [gadget addr][rd | rn<<8 | fbits<<16 | esize<<24]
 */
.gadget fcvtzu_fixpt_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    cmp x12, #3
    b.eq 1f
    // 32-bit
    ldr s0, [x15]
    mov w17, #1
    lsl w17, w17, w11
    scvtf s1, w17
    fmul s0, s0, s1
    fcvtzu w16, s0
    str w16, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

1:  // 64-bit
    ldr d0, [x15]
    mov x17, #1
    lsl x17, x17, x11
    ucvtf d1, x17
    fmul d0, d0, d1
    fcvtzu x16, d0
    str x16, [x14]
    str xzr, [x14, #8]
    gret

/*
 * SRI (vector, immediate) - Shift right and insert
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * For each element: rd = (rd & highmask) | (rn >> shift)
 */
.gadget sri_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4
    ubfx x17, x8, #28, #1

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x12
    mov x22, x17

    save_c
    mov x0, x14             // rd_ptr
    mov x1, x15             // rn_ptr
    mov w2, w20             // shift
    mov w3, w21             // esize
    mov w4, w22             // Q
    bl NAME(sri_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

/*
 * SLI (vector, immediate) - Shift left and insert
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 * For each element: rd = (rd & lowmask) | (rn << shift)
 */
.gadget sli_imm_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8
    ubfx x12, x8, #24, #4
    ubfx x17, x8, #28, #1

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    mov x19, x14
    mov x20, x11
    mov x21, x12
    mov x22, x17

    save_c
    mov x0, x14             // rd_ptr
    mov x1, x15             // rn_ptr
    mov w2, w20             // shift
    mov w3, w21             // esize
    mov w4, w22             // Q
    bl NAME(sli_imm_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60
    gret

/*
 * ADDP - Add pairwise
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * For each pair of adjacent elements, add them and place result in destination.
 * Result[i] = Vn[2i] + Vn[2i+1]  for first half
 * Result[i] = Vm[2i] + Vm[2i+1]  for second half
 */
.gadget addp_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    cmp x12, #3
    b.eq .Laddp_64
    cmp x12, #2
    b.eq .Laddp_32
    cmp x12, #1
    b.eq .Laddp_16
    b .Laddp_8

.Laddp_8:
    cbnz x17, .Laddp_8_q1

    // Q=0: 4 pairs from Vn low -> result[0..3], 4 pairs from Vm low -> result[4..7]
    ldr x20, [x15]           // Vn low
    mov x22, #0              // result

    // Process pairs 0,1 and 2,3 from Vn low
    ubfx x23, x20, #0, #8     // byte 0
    ubfx x24, x20, #8, #8     // byte 1
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23          // result[0]

    ubfx x23, x20, #16, #8    // byte 2
    ubfx x24, x20, #24, #8    // byte 3
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #8  // result[1]

    ubfx x23, x20, #32, #8    // byte 4
    ubfx x24, x20, #40, #8    // byte 5
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #16 // result[2]

    ubfx x23, x20, #48, #8    // byte 6
    ubfx x24, x20, #56, #8    // byte 7
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #24 // result[3]

    // Process pairs from Vm low
    ldr x21, [x16]           // Vm low
    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #32 // result[4]

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #40 // result[5]

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #48 // result[6]

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #56 // result[7]

    str x22, [x14]
    b .Laddp_clear_high

.Laddp_8_q1:
    // Q=1: 8 pairs from Vn (low+high) -> result[0..7]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing, e.g. vpaddq(x,x))
    ldr x3, [x16]            // Vm low (pre-loaded before Vd write)
    ldr x4, [x16, #8]        // Vm high (pre-loaded before Vd write)
    ldr x20, [x15]           // Vn low
    ldr x21, [x15, #8]       // Vn high
    mov x22, #0

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #24

    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #56

    str x22, [x14]

    // Q=1: 8 pairs from Vm (low+high) -> result[8..15]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)
    mov x22, #0

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #24

    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    add x23, x23, x24
    and x23, x23, #0xff
    orr x22, x22, x23, lsl #56

    str x22, [x14, #8]
    gret

.Laddp_16:
    cbnz x17, .Laddp_16_q1

    // Q=0: 2 pairs from Vn low -> result[0..1], 2 pairs from Vm low -> result[2..3]
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0

    // Pairs from Vn
    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #16

    // Pairs from Vm
    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #48

    str x22, [x14]
    b .Laddp_clear_high

.Laddp_16_q1:
    // Q=1: 4 pairs from Vn (low+high) -> result[0..3]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]
    ldr x21, [x15, #8]
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #48

    str x22, [x14]

    // Q=1: 4 pairs from Vm (low+high) -> result[4..7]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    add x23, x23, x24
    and x23, x23, #0xffff
    orr x22, x22, x23, lsl #48

    str x22, [x14, #8]
    gret

.Laddp_32:
    cbnz x17, .Laddp_32_q1

    // Q=0: Vn low pair -> result[0], Vm low pair -> result[1]
    ldr x20, [x15]
    ldr x21, [x16]

    // Pair 0,1 from Vn -> result[0]
    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    add x23, x23, x24
    and x22, x23, #0xffffffff

    // Pair 0,1 from Vm -> result[1]
    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    add x23, x23, x24
    and x23, x23, #0xffffffff
    orr x22, x22, x23, lsl #32

    str x22, [x14]
    b .Laddp_clear_high

.Laddp_32_q1:
    // Q=1: Vn low pair -> result[0], Vn high pair -> result[1]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]
    ldr x21, [x15, #8]

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    add x23, x23, x24
    and x22, x23, #0xffffffff

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    add x23, x23, x24
    and x23, x23, #0xffffffff
    orr x22, x22, x23, lsl #32

    str x22, [x14]

    // Q=1: Vm low pair -> result[2], Vm high pair -> result[3]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    add x23, x23, x24
    and x22, x23, #0xffffffff

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    add x23, x23, x24
    and x23, x23, #0xffffffff
    orr x22, x22, x23, lsl #32

    str x22, [x14, #8]
    gret

.Laddp_64:
    // 64-bit elements - only valid for Q=1 (128-bit vectors)
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm[0] (pre-loaded)
    ldr x4, [x16, #8]        // Vm[1] (pre-loaded)
    ldr x20, [x15]           // Vn[0]
    ldr x23, [x15, #8]       // Vn[1]
    add x22, x20, x23          // result[0] = Vn[0] + Vn[1]
    str x22, [x14]

    mov x20, x3              // Vm[0] (from pre-load)
    mov x23, x4              // Vm[1] (from pre-load)
    add x22, x20, x23          // result[1] = Vm[0] + Vm[1]
    str x22, [x14, #8]
    gret

.Laddp_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * UMAXP - Unsigned Maximum Pairwise (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * Result[i] = MAX(A[2i], A[2i+1]) where A is concatenation of Vn and Vm
 */
.gadget umaxp_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    cmp x12, #3
    b.eq .Lumaxp_64
    cmp x12, #2
    b.eq .Lumaxp_32
    cmp x12, #1
    b.eq .Lumaxp_16
    b .Lumaxp_8

.Lumaxp_8:
    cbnz x17, .Lumaxp_8_q1

    // Q=0: 4 pairs from Vn low -> result[0..3], 4 pairs from Vm low -> result[4..7]
    ldr x20, [x15]           // Vn low
    mov x22, #0              // result

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    cmp x23, x24
    csel x23, x23, x24, hs   // max(x23, x24)
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #24

    // Process pairs from Vm low: result[4..7]
    ldr x21, [x16]           // Vm low
    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #56

    str x22, [x14]
    b .Lumaxp_clear_high

.Lumaxp_8_q1:
    // Q=1: 8 pairs from Vn (low+high) -> result[0..7]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]           // Vn low
    ldr x21, [x15, #8]       // Vn high
    mov x22, #0

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #24

    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #56

    str x22, [x14]

    // Q=1: 8 pairs from Vm (low+high) -> result[8..15]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)
    mov x22, #0

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #24

    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #56

    str x22, [x14, #8]
    gret

.Lumaxp_16:
    cbnz x17, .Lumaxp_16_q1

    // Q=0: 2 pairs from Vn low -> result[0..1], 2 pairs from Vm low -> result[2..3]
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #48

    str x22, [x14]
    b .Lumaxp_clear_high

.Lumaxp_16_q1:
    // Q=1: 4 pairs from Vn (low+high) -> result[0..3]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]
    ldr x21, [x15, #8]
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #48

    str x22, [x14]

    // Q=1: 4 pairs from Vm (low+high) -> result[4..7]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #48

    str x22, [x14, #8]
    gret

.Lumaxp_32:
    cbnz x17, .Lumaxp_32_q1

    // Q=0: Vn low pair -> result[0], Vm low pair -> result[1]
    ldr x20, [x15]
    ldr x21, [x16]

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    cmp x23, x24
    csel x22, x23, x24, hs

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    str x22, [x14]
    b .Lumaxp_clear_high

.Lumaxp_32_q1:
    // Q=1: Vn low pair -> result[0], Vn high pair -> result[1]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]
    ldr x21, [x15, #8]

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    cmp x23, x24
    csel x22, x23, x24, hs

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    str x22, [x14]

    // Q=1: Vm low pair -> result[2], Vm high pair -> result[3]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    cmp x23, x24
    csel x22, x23, x24, hs

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    cmp x23, x24
    csel x23, x23, x24, hs
    orr x22, x22, x23, lsl #32

    str x22, [x14, #8]
    gret

.Lumaxp_64:
    // 64-bit elements (only valid for Q=1)
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm[0] (pre-loaded)
    ldr x4, [x16, #8]        // Vm[1] (pre-loaded)
    ldr x20, [x15]           // Vn[0]
    ldr x23, [x15, #8]       // Vn[1]
    cmp x20, x23
    csel x22, x20, x23, hs   // result[0] = max(Vn[0], Vn[1])
    str x22, [x14]

    mov x20, x3              // Vm[0] (from pre-load)
    mov x23, x4              // Vm[1] (from pre-load)
    cmp x20, x23
    csel x22, x20, x23, hs   // result[1] = max(Vm[0], Vm[1])
    str x22, [x14, #8]
    gret

.Lumaxp_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * UMINP - Unsigned Minimum Pairwise (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * Result[i] = MIN(A[2i], A[2i+1]) where A is concatenation of Vn and Vm
 */
.gadget uminp_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    cmp x12, #3
    b.eq .Luminp_64
    cmp x12, #2
    b.eq .Luminp_32
    cmp x12, #1
    b.eq .Luminp_16
    b .Luminp_8

.Luminp_8:
    cbnz x17, .Luminp_8_q1

    // Q=0: 4 pairs from Vn low -> result[0..3], 4 pairs from Vm low -> result[4..7]
    ldr x20, [x15]           // Vn low
    mov x22, #0              // result

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    cmp x23, x24
    csel x23, x23, x24, lo   // min(x23, x24)
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #24

    // Process pairs from Vm low: result[4..7]
    ldr x21, [x16]           // Vm low
    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #56

    str x22, [x14]
    b .Luminp_clear_high

.Luminp_8_q1:
    // Q=1: 8 pairs from Vn (low+high) -> result[0..7]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]           // Vn low
    ldr x21, [x15, #8]       // Vn high
    mov x22, #0

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #24

    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #56

    str x22, [x14]

    // Q=1: 8 pairs from Vm (low+high) -> result[8..15]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)
    mov x22, #0

    ubfx x23, x20, #0, #8
    ubfx x24, x20, #8, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23

    ubfx x23, x20, #16, #8
    ubfx x24, x20, #24, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #8

    ubfx x23, x20, #32, #8
    ubfx x24, x20, #40, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #16

    ubfx x23, x20, #48, #8
    ubfx x24, x20, #56, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #24

    ubfx x23, x21, #0, #8
    ubfx x24, x21, #8, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #16, #8
    ubfx x24, x21, #24, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #40

    ubfx x23, x21, #32, #8
    ubfx x24, x21, #40, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #48

    ubfx x23, x21, #48, #8
    ubfx x24, x21, #56, #8
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #56

    str x22, [x14, #8]
    gret

.Luminp_16:
    cbnz x17, .Luminp_16_q1

    // Q=0: 2 pairs from Vn low -> result[0..1], 2 pairs from Vm low -> result[2..3]
    ldr x20, [x15]
    ldr x21, [x16]
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #48

    str x22, [x14]
    b .Luminp_clear_high

.Luminp_16_q1:
    // Q=1: 4 pairs from Vn (low+high) -> result[0..3]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]
    ldr x21, [x15, #8]
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #48

    str x22, [x14]

    // Q=1: 4 pairs from Vm (low+high) -> result[4..7]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)
    mov x22, #0

    ubfx x23, x20, #0, #16
    ubfx x24, x20, #16, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23

    ubfx x23, x20, #32, #16
    ubfx x24, x20, #48, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #16

    ubfx x23, x21, #0, #16
    ubfx x24, x21, #16, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    ubfx x23, x21, #32, #16
    ubfx x24, x21, #48, #16
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #48

    str x22, [x14, #8]
    gret

.Luminp_32:
    cbnz x17, .Luminp_32_q1

    // Q=0: Vn low pair -> result[0], Vm low pair -> result[1]
    ldr x20, [x15]
    ldr x21, [x16]

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    cmp x23, x24
    csel x22, x23, x24, lo

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    str x22, [x14]
    b .Luminp_clear_high

.Luminp_32_q1:
    // Q=1: Vn low pair -> result[0], Vn high pair -> result[1]
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm low (pre-loaded)
    ldr x4, [x16, #8]        // Vm high (pre-loaded)
    ldr x20, [x15]
    ldr x21, [x15, #8]

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    cmp x23, x24
    csel x22, x23, x24, lo

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    str x22, [x14]

    // Q=1: Vm low pair -> result[2], Vm high pair -> result[3]
    // Use pre-loaded Vm values (x3/x4) instead of re-reading from [x16]
    mov x20, x3              // Vm low (from pre-load)
    mov x21, x4              // Vm high (from pre-load)

    and x23, x20, #0xffffffff
    lsr x24, x20, #32
    cmp x23, x24
    csel x22, x23, x24, lo

    and x23, x21, #0xffffffff
    lsr x24, x21, #32
    cmp x23, x24
    csel x23, x23, x24, lo
    orr x22, x22, x23, lsl #32

    str x22, [x14, #8]
    gret

.Luminp_64:
    // 64-bit elements (only valid for Q=1)
    // Pre-load Vm before writing Vd (handles Vd==Vm aliasing)
    ldr x3, [x16]            // Vm[0] (pre-loaded)
    ldr x4, [x16, #8]        // Vm[1] (pre-loaded)
    ldr x20, [x15]           // Vn[0]
    ldr x23, [x15, #8]       // Vn[1]
    cmp x20, x23
    csel x22, x20, x23, lo   // result[0] = min(Vn[0], Vn[1])
    str x22, [x14]

    mov x20, x3              // Vm[0] (from pre-load)
    mov x23, x4              // Vm[1] (from pre-load)
    cmp x20, x23
    csel x22, x20, x23, lo   // result[1] = min(Vm[0], Vm[1])
    str x22, [x14, #8]
    gret

.Luminp_clear_high:
    str xzr, [x14, #8]
    gret

/*
 * Floating-point / Integer Conversion (scalar)
 *
 * These convert between integer GPRs and floating-point registers.
 * We store FP values in the cpu_state fp array.
 *
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18]
 * type: 00=single (32-bit), 01=double (64-bit)
 * sf: 0=32-bit int (W reg), 1=64-bit int (X reg)
 */

/*
 * UCVTF - Unsigned integer to floating-point
 * UCVTF Sd, Wn / UCVTF Dd, Xn
 */
.gadget ucvtf_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #2   // type (0=single, 1=double)
    ubfx x12, x8, #18, #1   // sf (0=32-bit, 1=64-bit)

    // Load integer value from GPR
    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x14, [x13, x10, lsl #3]
    b 2f
1:  mov x14, #0             // XZR
2:
    // If sf=0, zero-extend to 32-bit
    cbz x12, .Lucvtf_32bit_int
    // 64-bit integer -> convert to float
    b .Lucvtf_convert

.Lucvtf_32bit_int:
    and x14, x14, #0xffffffff

.Lucvtf_convert:
    // Convert unsigned integer to float
    // We use the host's UCVTF instruction
    ucvtf d0, x14           // convert to double first

    // Store result to FP register
    add x15, _cpu, #CPU_fp
    lsl x16, x9, #4         // each V reg is 16 bytes
    add x15, x15, x16

    cbz x11, .Lucvtf_single
    // type=1: double
    str d0, [x15]
    str xzr, [x15, #8]      // clear upper
    gret

.Lucvtf_single:
    // type=0: single - convert double to single
    fcvt s0, d0
    str s0, [x15]
    str xzr, [x15, #4]      // clear rest of 128-bit reg
    str xzr, [x15, #8]
    gret

/*
 * SCVTF - Signed integer to floating-point
 */
.gadget scvtf_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #1   // sf

    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x14, [x13, x10, lsl #3]
    b 2f
1:  mov x14, #0
2:
    cbz x12, .Lscvtf_32bit_int
    b .Lscvtf_convert

.Lscvtf_32bit_int:
    // Sign-extend 32-bit to 64-bit
    sxtw x14, w14

.Lscvtf_convert:
    scvtf d0, x14

    add x15, _cpu, #CPU_fp
    lsl x16, x9, #4
    add x15, x15, x16

    cbz x11, .Lscvtf_single
    str d0, [x15]
    str xzr, [x15, #8]
    gret

.Lscvtf_single:
    fcvt s0, d0
    str s0, [x15]
    str xzr, [x15, #4]
    str xzr, [x15, #8]
    gret

/*
 * FCVTZU - Floating-point to unsigned integer (round toward zero)
 */
.gadget fcvtzu_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #1   // sf

    // Load FP value
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lfcvtzu_single
    // type=1: double
    ldr d0, [x13]
    b .Lfcvtzu_convert

.Lfcvtzu_single:
    ldr s0, [x13]
    fcvt d0, s0             // convert to double for uniform handling

.Lfcvtzu_convert:
    fcvtzu x14, d0          // convert to unsigned 64-bit

    cbz x12, .Lfcvtzu_32bit
    b .Lfcvtzu_store

.Lfcvtzu_32bit:
    and x14, x14, #0xffffffff

.Lfcvtzu_store:
    cmp x9, #31
    b.eq .Lfcvtzu_done      // XZR - discard
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.Lfcvtzu_done:
    gret

// Macro for FCVT (FP->int) with different rounding modes
// \name: gadget name suffix, \cvt_x_d: 64-bit convert insn, \cvt_w_d: 32-bit convert insn
.macro make_fcvt_to_int name, cvt_x_d, cvt_w_d, cvt_x_s, cvt_w_s
.gadget \name\()_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #1   // sf
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14
    cbz x12, .L\name\()_32
    // 64-bit result
    cbz x11, .L\name\()_x_s
    ldr d0, [x13]
    \cvt_x_d x14, d0
    b .L\name\()_store
.L\name\()_x_s:
    ldr s0, [x13]
    \cvt_x_s x14, s0
    b .L\name\()_store
.L\name\()_32:
    // 32-bit result
    cbz x11, .L\name\()_w_s
    ldr d0, [x13]
    \cvt_w_d w14, d0
    b .L\name\()_store32
.L\name\()_w_s:
    ldr s0, [x13]
    \cvt_w_s w14, s0
.L\name\()_store32:
    // Zero-extend 32-bit to 64-bit
    mov w14, w14
.L\name\()_store:
    cmp x9, #31
    b.eq .L\name\()_done
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.L\name\()_done:
    gret
.endm

make_fcvt_to_int fcvtns, fcvtns, fcvtns, fcvtns, fcvtns
make_fcvt_to_int fcvtps, fcvtps, fcvtps, fcvtps, fcvtps
make_fcvt_to_int fcvtms, fcvtms, fcvtms, fcvtms, fcvtms
make_fcvt_to_int fcvtnu, fcvtnu, fcvtnu, fcvtnu, fcvtnu
make_fcvt_to_int fcvtpu, fcvtpu, fcvtpu, fcvtpu, fcvtpu
make_fcvt_to_int fcvtmu, fcvtmu, fcvtmu, fcvtmu, fcvtmu
make_fcvt_to_int fcvtas, fcvtas, fcvtas, fcvtas, fcvtas
make_fcvt_to_int fcvtau, fcvtau, fcvtau, fcvtau, fcvtau

/*
 * FCVTZS - Floating-point to signed integer (round toward zero)
 * (kept for backward compatibility — same as make_fcvt_to_int but uses fcvtzs)
 */
.gadget fcvtzs_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #1   // sf

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lfcvtzs_single
    ldr d0, [x13]
    b .Lfcvtzs_convert

.Lfcvtzs_single:
    ldr s0, [x13]
    fcvt d0, s0

.Lfcvtzs_convert:
    fcvtzs x14, d0

    cbz x12, .Lfcvtzs_32bit
    b .Lfcvtzs_store

.Lfcvtzs_32bit:
    // Truncate to 32-bit signed
    sxtw x14, w14

.Lfcvtzs_store:
    cmp x9, #31
    b.eq .Lfcvtzs_done
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.Lfcvtzs_done:
    gret

/*
 * FCVTZS (GPR, fixed-point) - FP to signed int with scale factor (result in GPR)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18 | fbits<<20]
 * Computes: Rd = (int)(Fn * 2^fbits) truncated toward zero
 */
.gadget fcvtzs_fixpt_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #2   // type (0=S, 1=D)
    ubfx x12, x8, #18, #2   // sf (0=32-bit, 1=64-bit)
    ubfx x13, x8, #20, #7   // fbits

    // Load FP source
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x14, x14, x15

    cbz x11, .Lfcvtzs_fg_single
    ldr d0, [x14]            // double source
    b .Lfcvtzs_fg_scale
.Lfcvtzs_fg_single:
    ldr s0, [x14]
    fcvt d0, s0              // convert single to double for uniform handling

.Lfcvtzs_fg_scale:
    // Multiply by 2^fbits: convert fbits to double, use scvtf then fmul
    // Actually: use fcvtzs with shift directly
    // ARM64 has: fcvtzs x0, d0, #fbits — but we can't use variable fbits directly
    // Instead: scale the double by 2^fbits, then convert
    // Build 2^fbits as a double: exponent = fbits + 1023
    add x16, x13, #1023     // biased exponent
    lsl x16, x16, #52       // shift to exponent position
    fmov d1, x16             // d1 = 2^fbits
    fmul d0, d0, d1          // d0 = d0 * 2^fbits

    cbz x12, .Lfcvtzs_fg_32bit
    // 64-bit result
    fcvtzs x14, d0
    b .Lfcvtzs_fg_store
.Lfcvtzs_fg_32bit:
    fcvtzs w14, d0
    sxtw x14, w14

.Lfcvtzs_fg_store:
    cmp x9, #31
    b.eq .Lfcvtzs_fg_done
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.Lfcvtzs_fg_done:
    gret

/*
 * FCVTZU (GPR, fixed-point) - FP to unsigned int with scale factor (result in GPR)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18 | fbits<<20]
 * Computes: Rd = (uint)(Fn * 2^fbits) truncated toward zero
 */
.gadget fcvtzu_fixpt_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #2   // sf
    ubfx x13, x8, #20, #7   // fbits

    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x14, x14, x15

    cbz x11, .Lfcvtzu_fg_single
    ldr d0, [x14]
    b .Lfcvtzu_fg_scale
.Lfcvtzu_fg_single:
    ldr s0, [x14]
    fcvt d0, s0

.Lfcvtzu_fg_scale:
    add x16, x13, #1023
    lsl x16, x16, #52
    fmov d1, x16
    fmul d0, d0, d1

    cbz x12, .Lfcvtzu_fg_32bit
    fcvtzu x14, d0
    b .Lfcvtzu_fg_store
.Lfcvtzu_fg_32bit:
    fcvtzu w14, d0
    mov w14, w14             // zero-extend

.Lfcvtzu_fg_store:
    cmp x9, #31
    b.eq .Lfcvtzu_fg_done
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.Lfcvtzu_fg_done:
    gret

/*
 * SCVTF (GPR, fixed-point) - Signed int to FP with scale factor (source in GPR)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18 | fbits<<20]
 * Computes: Fd = (double)Rn / 2^fbits
 */
.gadget scvtf_fixpt_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #2   // type (0=S, 1=D)
    ubfx x12, x8, #18, #2   // sf
    ubfx x13, x8, #20, #7   // fbits

    // Load GPR source
    add x14, _cpu, #CPU_x0
    cmp x10, #31
    b.eq .Lscvtf_fg_zero
    ldr x15, [x14, x10, lsl #3]
    b .Lscvtf_fg_convert
.Lscvtf_fg_zero:
    mov x15, #0

.Lscvtf_fg_convert:
    cbz x12, .Lscvtf_fg_32bit
    scvtf d0, x15
    b .Lscvtf_fg_scale
.Lscvtf_fg_32bit:
    scvtf d0, w15

.Lscvtf_fg_scale:
    // Divide by 2^fbits: multiply by 2^(-fbits)
    mov x16, #1023
    sub x16, x16, x13       // biased exponent = 1023 - fbits
    lsl x16, x16, #52
    fmov d1, x16             // d1 = 2^(-fbits)
    fmul d0, d0, d1

    // Store to FP register
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15

    cbz x11, .Lscvtf_fg_store_single
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lscvtf_fg_store_single:
    fcvt s0, d0
    str s0, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

/*
 * UCVTF (GPR, fixed-point) - Unsigned int to FP with scale factor (source in GPR)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18 | fbits<<20]
 * Computes: Fd = (double)(uint)Rn / 2^fbits
 */
.gadget ucvtf_fixpt_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #2   // sf
    ubfx x13, x8, #20, #7   // fbits

    add x14, _cpu, #CPU_x0
    cmp x10, #31
    b.eq .Lucvtf_fg_zero
    ldr x15, [x14, x10, lsl #3]
    b .Lucvtf_fg_convert
.Lucvtf_fg_zero:
    mov x15, #0

.Lucvtf_fg_convert:
    cbz x12, .Lucvtf_fg_32bit
    ucvtf d0, x15
    b .Lucvtf_fg_scale
.Lucvtf_fg_32bit:
    ucvtf d0, w15

.Lucvtf_fg_scale:
    mov x16, #1023
    sub x16, x16, x13
    lsl x16, x16, #52
    fmov d1, x16
    fmul d0, d0, d1

    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15

    cbz x11, .Lucvtf_fg_store_single
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lucvtf_fg_store_single:
    fcvt s0, d0
    str s0, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

/*
 * FCVTZS (SIMD scalar) - Floating-point to signed integer (result in SIMD register)
 * FCVTZS Dd, Dn (sz=1) or FCVTZS Sd, Sn (sz=0)
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 */
.gadget fcvtzs_simd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)

    // Load source FP value
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lfcvtzs_simd_single
    // sz=1: double -> 64-bit signed int stored in D register
    ldr d0, [x13]
    fcvtzs x15, d0
    b .Lfcvtzs_simd_store

.Lfcvtzs_simd_single:
    // sz=0: single -> 32-bit signed int stored in S register
    ldr s0, [x13]
    fcvtzs w15, s0
    // Result needs to be zero-extended (already in w15)

.Lfcvtzs_simd_store:
    // Store result to destination FP register
    add x16, _cpu, #CPU_fp
    lsl x17, x9, #4
    add x16, x16, x17

    cbz x11, .Lfcvtzs_simd_store_single
    // 64-bit result
    str x15, [x16]
    str xzr, [x16, #8]       // clear upper 64 bits
    gret

.Lfcvtzs_simd_store_single:
    // 32-bit result
    str w15, [x16]
    str xzr, [x16, #4]       // clear upper 96 bits
    str xzr, [x16, #8]
    gret

/*
 * FCVTZU (SIMD scalar) - Floating-point to unsigned integer (result in SIMD register)
 * FCVTZU Dd, Dn (sz=1) or FCVTZU Sd, Sn (sz=0)
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 */
.gadget fcvtzu_simd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)

    // Load source FP value
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lfcvtzu_simd_single
    // sz=1: double -> 64-bit unsigned int stored in D register
    ldr d0, [x13]
    fcvtzu x15, d0
    b .Lfcvtzu_simd_store

.Lfcvtzu_simd_single:
    // sz=0: single -> 32-bit unsigned int stored in S register
    ldr s0, [x13]
    fcvtzu w15, s0

.Lfcvtzu_simd_store:
    // Store result to destination FP register
    add x16, _cpu, #CPU_fp
    lsl x17, x9, #4
    add x16, x16, x17

    cbz x11, .Lfcvtzu_simd_store_single
    // 64-bit result
    str x15, [x16]
    str xzr, [x16, #8]
    gret

.Lfcvtzu_simd_store_single:
    // 32-bit result
    str w15, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

/*
 * UCVTF (SIMD scalar) - Unsigned integer to floating-point (SIMD to SIMD)
 * UCVTF Dd, Dn (sz=1) or UCVTF Sd, Sn (sz=0)
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 */
.gadget ucvtf_simd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)

    // Load source integer value from FP register
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lucvtf_simd_single
    // sz=1: 64-bit unsigned int -> double
    ldr x15, [x13]
    ucvtf d0, x15
    b .Lucvtf_simd_store

.Lucvtf_simd_single:
    // sz=0: 32-bit unsigned int -> single
    ldr w15, [x13]
    ucvtf s0, w15

.Lucvtf_simd_store:
    // Store result to destination FP register
    add x16, _cpu, #CPU_fp
    lsl x17, x9, #4
    add x16, x16, x17

    cbz x11, .Lucvtf_simd_store_single
    // 64-bit result (double)
    str d0, [x16]
    str xzr, [x16, #8]       // clear upper 64 bits
    gret

.Lucvtf_simd_store_single:
    // 32-bit result (single)
    str s0, [x16]
    str xzr, [x16, #4]       // clear upper 96 bits
    str xzr, [x16, #8]
    gret

/*
 * SCVTF (SIMD scalar) - Signed integer to floating-point (SIMD to SIMD)
 * SCVTF Dd, Dn (sz=1) or SCVTF Sd, Sn (sz=0)
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 */
.gadget scvtf_simd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #1   // sz (0=single, 1=double)

    // Load source integer value from FP register
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lscvtf_simd_single
    // sz=1: 64-bit signed int -> double
    ldr x15, [x13]
    scvtf d0, x15
    b .Lscvtf_simd_store

.Lscvtf_simd_single:
    // sz=0: 32-bit signed int -> single
    ldr w15, [x13]
    scvtf s0, w15

.Lscvtf_simd_store:
    // Store result to destination FP register
    add x16, _cpu, #CPU_fp
    lsl x17, x9, #4
    add x16, x16, x17

    cbz x11, .Lscvtf_simd_store_single
    // 64-bit result (double)
    str d0, [x16]
    str xzr, [x16, #8]       // clear upper 64 bits
    gret

.Lscvtf_simd_store_single:
    // 32-bit result (single)
    str s0, [x16]
    str xzr, [x16, #4]       // clear upper 96 bits
    str xzr, [x16, #8]
    gret

/*
 * FMOV - Move bits from GPR to FP register (no conversion)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18]
 */
.gadget fmov_gpr_to_fp
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (gpr)
    ubfx x11, x8, #16, #2   // type (0=single, 1=double)
    ubfx x12, x8, #18, #1   // sf

    // Load integer value from GPR
    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x14, [x13, x10, lsl #3]
    b 2f
1:  mov x14, #0
2:

#if 0 // DEBUG FMOV GPR->FP
    stp x0, x1, [sp, #-96]!
    stp x2, x3, [sp, #16]
    stp x9, x10, [sp, #32]
    stp x11, x14, [sp, #48]
    str x30, [sp, #64]
    stp _cpu, _pc, [sp, #72]

    mov x0, #6          // op = FMOV_G2F
    mov x1, x9          // rd (fp)
    mov x2, x10         // rn (gpr)
    mov x3, #0          // rm (unused)
    mov x4, x14         // val1 (gpr value)
    mov x5, x11         // val2 (type)
    bl NAME(helper_debug_fp)

    ldp x0, x1, [sp]
    ldp x2, x3, [sp, #16]
    ldp x9, x10, [sp, #32]
    ldp x11, x14, [sp, #48]
    ldr x30, [sp, #64]
    ldp _cpu, _pc, [sp, #72]
    add sp, sp, #96
#endif

    // Store to FP register as bits (no conversion)
    add x15, _cpu, #CPU_fp
    lsl x16, x9, #4
    add x15, x15, x16

    cbz x11, .Lfmov_g2f_single
    // type=1: 64-bit (double)
    str x14, [x15]
    str xzr, [x15, #8]      // clear upper
    gret

.Lfmov_g2f_single:
    // type=0: 32-bit (single)
    str w14, [x15]
    str xzr, [x15, #4]
    str xzr, [x15, #8]
    gret

/*
 * FMOV - Move bits from GPR to vector upper D lane (no conversion)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18]
 * Only X registers and Vd.D[1] supported here.
 */
.gadget fmov_gpr_to_fp_hi
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (gpr)

    // Load integer value from GPR
    add x13, _cpu, #CPU_x0
    cmp x10, #31
    b.eq 1f
    ldr x14, [x13, x10, lsl #3]
    b 2f
1:  mov x14, #0
2:
    // Store to upper 64 bits of vector register
    add x15, _cpu, #CPU_fp
    lsl x16, x9, #4
    add x15, x15, x16
    str x14, [x15, #8]
    gret

/*
 * FMOV - Move bits from FP register to GPR (no conversion)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18]
 */
.gadget fmov_fp_to_gpr
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #2   // type
    ubfx x12, x8, #18, #1   // sf

    // Load from FP register
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    cbz x11, .Lfmov_f2g_single
    // type=1: 64-bit
    ldr x14, [x13]
    b .Lfmov_f2g_store

.Lfmov_f2g_single:
    // type=0: 32-bit
    ldr w14, [x13]
    // zero-extend to 64-bit
    and x14, x14, #0xffffffff

.Lfmov_f2g_store:
    cmp x9, #31
    b.eq .Lfmov_f2g_done    // XZR - discard
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.Lfmov_f2g_done:
    gret

/*
 * FMOV - Move bits from vector upper D lane to GPR (no conversion)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16 | sf<<18]
 * Only X registers and Vn.D[1] supported here.
 */
.gadget fmov_fp_to_gpr_hi
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (gpr)
    ubfx x10, x8, #8, #5    // rn (fp reg)

    // Load from upper 64 bits of FP register
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14
    ldr x14, [x13, #8]

    cmp x9, #31
    b.eq .Lfmov_f2g_hi_done // XZR - discard
    add x15, _cpu, #CPU_x0
    str x14, [x15, x9, lsl #3]
.Lfmov_f2g_hi_done:
    gret

/*
 * FMOV - Move scalar FP register to FP register (no conversion)
 * Code stream: [gadget addr][rd | rn<<8 | type<<16]
 * type: 0=single, 1=double
 */
.gadget fmov_fp_to_fp
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #1   // type

    // Load source FP register
    add x12, _cpu, #CPU_fp
    lsl x13, x10, #4
    add x12, x12, x13

    cbz x11, .Lfmov_f2f_single
    ldr d0, [x12]
    b .Lfmov_f2f_store
.Lfmov_f2f_single:
    ldr s0, [x12]

.Lfmov_f2f_store:
    // Store to destination FP register, zero upper lanes
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15

    cbz x11, .Lfmov_f2f_store_single
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.Lfmov_f2f_store_single:
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret

/*
 * FMOV (scalar, immediate) - Load FP constant into register
 * Code stream: [gadget addr][rd | ftype<<8][fpbits_lo][fpbits_hi]
 * ftype: 0=single, 1=double
 */
.gadget fmov_fp_imm
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x11, x8, #8, #2    // ftype

    // Load the 64-bit immediate from code stream
    ldr x16, [_pc]
    add _pc, _pc, #8

    // Store to destination FP register
    add x14, _cpu, #CPU_fp
    lsl x15, x9, #4
    add x14, x14, x15

    cbz x11, .Lfmov_imm_single
    // Double: store full 64 bits
    str x16, [x14]
    str xzr, [x14, #8]
    gret
.Lfmov_imm_single:
    // Single: store lower 32 bits, zero rest
    str w16, [x14]
    str wzr, [x14, #4]
    str xzr, [x14, #8]
    gret

/*
 * FCMP/FCMPE - Floating-point compare (scalar)
 *
 * Code stream: [gadget addr][rn | rm<<8 | type<<16]
 * type: 0=single (32-bit), 1=double (64-bit)
 */
.gadget fcmp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn (fp reg)
    ubfx x10, x8, #8, #5    // rm (fp reg)
    ubfx x11, x8, #16, #2   // type

    // Load Rn
    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    add x12, x12, x13

    cbz x11, .Lfcmp_rn_single
    ldr d0, [x12]
    b .Lfcmp_load_rm
.Lfcmp_rn_single:
    ldr s0, [x12]

.Lfcmp_load_rm:
    // Load Rm
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x14, x14, x15

    cbz x11, .Lfcmp_rm_single
    ldr d1, [x14]
    b .Lfcmp_do
.Lfcmp_rm_single:
    ldr s1, [x14]

.Lfcmp_do:
    cbz x11, .Lfcmp_do_single
    fcmp d0, d1
    b .Lfcmp_store
.Lfcmp_do_single:
    fcmp s0, s1

.Lfcmp_store:
    mrs x17, nzcv
    str w17, [_cpu, #CPU_nzcv]
    gret

/*
 * FCMP/FCMPE - Floating-point compare with zero (scalar)
 *
 * Code stream: [gadget addr][rn | type<<16]
 * type: 0=single (32-bit), 1=double (64-bit)
 */
.gadget fcmp_zero_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rn (fp reg)
    ubfx x11, x8, #16, #2   // type

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    add x12, x12, x13

    cbz x11, .Lfcmp_zero_single
    ldr d0, [x12]
    fcmp d0, #0.0
    b .Lfcmp_zero_store
.Lfcmp_zero_single:
    ldr s0, [x12]
    fcmp s0, #0.0

.Lfcmp_zero_store:
    mrs x17, nzcv
    str w17, [_cpu, #CPU_nzcv]
    gret

/*
 * Floating-point arithmetic (scalar)
 *
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | type<<24]
 * type: 0=single (32-bit), 1=double (64-bit)
 */
.gadget fmul_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd (fp reg)
    ubfx x10, x8, #8, #5    // rn (fp reg)
    ubfx x11, x8, #16, #5   // rm (fp reg)
    ubfx x12, x8, #24, #2   // type

    // Load Rn and Rm
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    add x15, _cpu, #CPU_fp
    lsl x16, x11, #4
    add x15, x15, x16

    cbz x12, .Lfmul_single
    ldr d0, [x13]
    ldr d1, [x15]
    fmul d0, d0, d1
    b .Lfmul_store
.Lfmul_single:
    ldr s0, [x13]
    ldr s1, [x15]
    fmul s0, s0, s1

.Lfmul_store:
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    cbz x12, .Lfmul_store_single
    str d0, [x17]
    str xzr, [x17, #8]
    gret
.Lfmul_store_single:
    str s0, [x17]
    str xzr, [x17, #4]
    str xzr, [x17, #8]
    gret

.gadget fdiv_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #2

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    add x15, _cpu, #CPU_fp
    lsl x16, x11, #4
    add x15, x15, x16

    cbz x12, .Lfdiv_single
    ldr d0, [x13]
    ldr d1, [x15]
    fdiv d0, d0, d1
    b .Lfdiv_store
.Lfdiv_single:
    ldr s0, [x13]
    ldr s1, [x15]
    fdiv s0, s0, s1

.Lfdiv_store:
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    cbz x12, .Lfdiv_store_single
    str d0, [x17]
    str xzr, [x17, #8]
    gret
.Lfdiv_store_single:
    str s0, [x17]
    str xzr, [x17, #4]
    str xzr, [x17, #8]
    gret

.gadget fadd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #2

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    add x15, _cpu, #CPU_fp
    lsl x16, x11, #4
    add x15, x15, x16

    cbz x12, .Lfadd_single
    ldr d0, [x13]
    ldr d1, [x15]

#if 0 // DEBUG FADD double
    stp x0, x1, [sp, #-128]!
    stp x2, x3, [sp, #16]
    stp x9, x10, [sp, #32]
    stp x11, x12, [sp, #48]
    stp x13, x15, [sp, #64]
    str x30, [sp, #80]
    str d0, [sp, #88]
    str d1, [sp, #96]
    stp _cpu, _pc, [sp, #104]

    // Print debug info: op=2 (FADD), rd=x9, rn=x10, rm=x11, val1=d0, val2=d1
    mov x0, #2          // op = FADD
    mov x1, x9          // rd
    mov x2, x10         // rn
    mov x3, x11         // rm
    fmov x4, d0         // val1
    fmov x5, d1         // val2
    bl NAME(helper_debug_fp)

    ldp x0, x1, [sp]
    ldp x2, x3, [sp, #16]
    ldp x9, x10, [sp, #32]
    ldp x11, x12, [sp, #48]
    ldp x13, x15, [sp, #64]
    ldr x30, [sp, #80]
    ldr d0, [sp, #88]
    ldr d1, [sp, #96]
    ldp _cpu, _pc, [sp, #104]
    add sp, sp, #128
#endif

    fadd d0, d0, d1
    b .Lfadd_store
.Lfadd_single:
    ldr s0, [x13]
    ldr s1, [x15]

#if 0 // DEBUG FADD single
    stp x0, x1, [sp, #-128]!
    stp x2, x3, [sp, #16]
    stp x9, x10, [sp, #32]
    stp x11, x12, [sp, #48]
    stp x13, x15, [sp, #64]
    str x30, [sp, #80]
    str s0, [sp, #88]
    str s1, [sp, #96]
    stp _cpu, _pc, [sp, #104]

    // Print debug info for single
    mov x0, #2          // op = FADD
    mov x1, x9          // rd
    mov x2, x10         // rn
    mov x3, x11         // rm
    fmov w4, s0
    mov x4, x4          // val1 (bits)
    fmov w5, s1
    mov x5, x5          // val2 (bits)
    bl NAME(helper_debug_fp)

    ldp x0, x1, [sp]
    ldp x2, x3, [sp, #16]
    ldp x9, x10, [sp, #32]
    ldp x11, x12, [sp, #48]
    ldp x13, x15, [sp, #64]
    ldr x30, [sp, #80]
    ldr s0, [sp, #88]
    ldr s1, [sp, #96]
    ldp _cpu, _pc, [sp, #104]
    add sp, sp, #128
#endif

    fadd s0, s0, s1

.Lfadd_store:
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    cbz x12, .Lfadd_store_single
    str d0, [x17]
    str xzr, [x17, #8]
    gret
.Lfadd_store_single:
    str s0, [x17]
    str xzr, [x17, #4]
    str xzr, [x17, #8]
    gret

/*
 * FMADD - Fused multiply-add scalar
 * Code stream: [gadget][rd | rn<<8 | rm<<16 | ra<<24][ftype (0=single, 1=double)]
 * Computes: Fd = Fn * Fm + Fa
 */
.gadget fmadd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    ldr x13, [_pc]          // ftype
    add _pc, _pc, #8

    // Load operands
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x15, x14, x15       // &Vn

    lsl x16, x11, #4
    add x16, x14, x16       // &Vm

    lsl x17, x12, #4
    add x17, x14, x17       // &Va

    cbz x13, .Lfmadd_single
    // Double precision
    ldr d0, [x15]           // Fn
    ldr d1, [x16]           // Fm
    ldr d2, [x17]           // Fa
    fmadd d0, d0, d1, d2    // d0 = d0 * d1 + d2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str d0, [x3]
    str xzr, [x3, #8]      // Clear upper half
    gret

.Lfmadd_single:
    // Single precision
    ldr s0, [x15]           // Fn
    ldr s1, [x16]           // Fm
    ldr s2, [x17]           // Fa
    fmadd s0, s0, s1, s2    // s0 = s0 * s1 + s2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str s0, [x3]
    str xzr, [x3, #4]      // Clear upper 32 bits of low half
    str xzr, [x3, #8]      // Clear upper half
    gret

/*
 * FMSUB - Fused multiply-subtract scalar
 * Code stream: [gadget][rd | rn<<8 | rm<<16 | ra<<24][ftype (0=single, 1=double)]
 * Computes: Fd = Fn * Fm - Fa
 */
.gadget fmsub_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    ldr x13, [_pc]          // ftype
    add _pc, _pc, #8

    // Load operands
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x15, x14, x15       // &Vn

    lsl x16, x11, #4
    add x16, x14, x16       // &Vm

    lsl x17, x12, #4
    add x17, x14, x17       // &Va

    cbz x13, .Lfmsub_single
    // Double precision
    ldr d0, [x15]           // Fn
    ldr d1, [x16]           // Fm
    ldr d2, [x17]           // Fa
    fmsub d0, d0, d1, d2    // d0 = d0 * d1 - d2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str d0, [x3]
    str xzr, [x3, #8]      // Clear upper half
    gret

.Lfmsub_single:
    // Single precision
    ldr s0, [x15]           // Fn
    ldr s1, [x16]           // Fm
    ldr s2, [x17]           // Fa
    fmsub s0, s0, s1, s2    // s0 = s0 * s1 - s2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str s0, [x3]
    str xzr, [x3, #4]      // Clear upper 32 bits of low half
    str xzr, [x3, #8]      // Clear upper half
    gret

/*
 * FNMADD - Fused negate multiply-add scalar
 * Code stream: [gadget][rd | rn<<8 | rm<<16 | ra<<24][ftype (0=single, 1=double)]
 * Computes: Fd = -(Fn * Fm) - Fa = -(Fn * Fm + Fa)
 */
.gadget fnmadd_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    ldr x13, [_pc]          // ftype
    add _pc, _pc, #8

    // Load operands
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x15, x14, x15       // &Vn

    lsl x16, x11, #4
    add x16, x14, x16       // &Vm

    lsl x17, x12, #4
    add x17, x14, x17       // &Va

    cbz x13, .Lfnmadd_single
    // Double precision
    ldr d0, [x15]           // Fn
    ldr d1, [x16]           // Fm
    ldr d2, [x17]           // Fa
    fnmadd d0, d0, d1, d2   // d0 = -(d0 * d1) - d2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str d0, [x3]
    str xzr, [x3, #8]      // Clear upper half
    gret

.Lfnmadd_single:
    // Single precision
    ldr s0, [x15]           // Fn
    ldr s1, [x16]           // Fm
    ldr s2, [x17]           // Fa
    fnmadd s0, s0, s1, s2   // s0 = -(s0 * s1) - s2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str s0, [x3]
    str xzr, [x3, #4]      // Clear upper 32 bits of low half
    str xzr, [x3, #8]      // Clear upper half
    gret

/*
 * FNMSUB - Fused negate multiply-subtract scalar
 * Code stream: [gadget][rd | rn<<8 | rm<<16 | ra<<24][ftype (0=single, 1=double)]
 * Computes: Fd = -(Fn * Fm) + Fa = Fa - Fn * Fm
 */
.gadget fnmsub_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #5   // ra

    ldr x13, [_pc]          // ftype
    add _pc, _pc, #8

    // Load operands
    add x14, _cpu, #CPU_fp
    lsl x15, x10, #4
    add x15, x14, x15       // &Vn

    lsl x16, x11, #4
    add x16, x14, x16       // &Vm

    lsl x17, x12, #4
    add x17, x14, x17       // &Va

    cbz x13, .Lfnmsub_single
    // Double precision
    ldr d0, [x15]           // Fn
    ldr d1, [x16]           // Fm
    ldr d2, [x17]           // Fa
    fnmsub d0, d0, d1, d2   // d0 = -(d0 * d1) + d2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str d0, [x3]
    str xzr, [x3, #8]      // Clear upper half
    gret

.Lfnmsub_single:
    // Single precision
    ldr s0, [x15]           // Fn
    ldr s1, [x16]           // Fm
    ldr s2, [x17]           // Fa
    fnmsub s0, s0, s1, s2   // s0 = -(s0 * s1) + s2

    // Store result
    lsl x3, x9, #4
    add x3, x14, x3       // &Vd
    str s0, [x3]
    str xzr, [x3, #4]      // Clear upper 32 bits of low half
    str xzr, [x3, #8]      // Clear upper half
    gret

.gadget fsub_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #2

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x13, x13, x14

    add x15, _cpu, #CPU_fp
    lsl x16, x11, #4
    add x15, x15, x16

    cbz x12, .Lfsub_single
    ldr d0, [x13]
    ldr d1, [x15]
    fsub d0, d0, d1
    b .Lfsub_store
.Lfsub_single:
    ldr s0, [x13]
    ldr s1, [x15]
    fsub s0, s0, s1

.Lfsub_store:
    add x17, _cpu, #CPU_fp
    lsl x3, x9, #4
    add x17, x17, x3

    cbz x12, .Lfsub_store_single
    str d0, [x17]
    str xzr, [x17, #8]
    gret
.Lfsub_store_single:
    str s0, [x17]
    str xzr, [x17, #4]
    str xzr, [x17, #8]
    gret
/*
 * FCCMP - Floating-point conditional compare
 * Code stream: [gadget addr][rn | rm<<8 | ftype<<16 | cond<<20 | nzcv<<24]
 * If cond is true: compare Vn vs Vm and set NZCV from result
 * If cond is false: set NZCV to immediate nzcv value
 */
.gadget fccmp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rn
    ubfx x10, x8, #8, #5    // rm
    ubfx x12, x8, #16, #4   // ftype
    ubfx x17, x8, #20, #4   // cond
    ubfx x20, x8, #24, #4   // nzcv (immediate)

    // Read current NZCV flags from memory (not hardware, which may be
    // clobbered by TLB lookups in intervening load/store gadgets)
    ldr w21, [_cpu, #CPU_nzcv]

    // Check if condition is true
    // We need to test the condition. Use a conditional branch trick:
    // Branch over the "set immediate" path if condition is met
    // Encode condition check using csel
    cmp x17, #0
    b.eq .Lfccmp_check_eq
    cmp x17, #1
    b.eq .Lfccmp_check_ne
    cmp x17, #2
    b.eq .Lfccmp_check_cs
    cmp x17, #3
    b.eq .Lfccmp_check_cc
    cmp x17, #4
    b.eq .Lfccmp_check_mi
    cmp x17, #5
    b.eq .Lfccmp_check_pl
    cmp x17, #8
    b.eq .Lfccmp_check_hi
    cmp x17, #9
    b.eq .Lfccmp_check_ls
    cmp x17, #10
    b.eq .Lfccmp_check_ge
    cmp x17, #11
    b.eq .Lfccmp_check_lt
    cmp x17, #12
    b.eq .Lfccmp_check_gt
    cmp x17, #13
    b.eq .Lfccmp_check_le
    cmp x17, #14
    b.eq .Lfccmp_check_al
    // VS(6), VC(7) and AL(14)/NV(15)
    cmp x17, #6
    b.eq .Lfccmp_check_vs
    cmp x17, #7
    b.eq .Lfccmp_check_vc
    b .Lfccmp_check_al       // default: always

    // Each check: restore NZCV, test condition, branch
.Lfccmp_check_eq:
    msr nzcv, x21
    b.eq .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_ne:
    msr nzcv, x21
    b.ne .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_cs:
    msr nzcv, x21
    b.cs .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_cc:
    msr nzcv, x21
    b.cc .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_mi:
    msr nzcv, x21
    b.mi .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_pl:
    msr nzcv, x21
    b.pl .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_vs:
    msr nzcv, x21
    b.vs .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_vc:
    msr nzcv, x21
    b.vc .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_hi:
    msr nzcv, x21
    b.hi .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_ls:
    msr nzcv, x21
    b.ls .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_ge:
    msr nzcv, x21
    b.ge .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_lt:
    msr nzcv, x21
    b.lt .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_gt:
    msr nzcv, x21
    b.gt .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_le:
    msr nzcv, x21
    b.le .Lfccmp_do_compare
    b .Lfccmp_set_imm
.Lfccmp_check_al:
    b .Lfccmp_do_compare

.Lfccmp_set_imm:
    // Condition was false: set NZCV from immediate
    lsl x20, x20, #28       // shift nzcv into position
    str w20, [_cpu, #CPU_nzcv]
    gret

.Lfccmp_do_compare:
    // Condition was true: do the actual FP compare
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vn
    lsl x15, x10, #4
    add x15, x13, x15       // &Vm

    cbz x12, .Lfccmp_single
    ldr d0, [x14]
    ldr d1, [x15]
    fcmp d0, d1
    store_flags
    gret
.Lfccmp_single:
    ldr s0, [x14]
    ldr s1, [x15]
    fcmp s0, s1
    store_flags
    gret

/*
 * FCSEL - Floating-point conditional select
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | ftype<<24][cond]
 * Rd = cond ? Rn : Rm
 */
.gadget fcsel_scalar
    ldr x8, [_pc]
    ldr x20, [_pc, #8]      // cond (save in x20, callee-saved won't be clobbered)
    add _pc, _pc, #16
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #4   // ftype

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x15, x11, #4
    add x15, x13, x15       // &Vm
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd

    // Load both operands
    cbz x12, .Lfcsel_single
    ldr d0, [x14]           // Vn (double)
    ldr d1, [x15]           // Vm (double)
    b .Lfcsel_select
.Lfcsel_single:
    ldr s0, [x14]           // Vn (single)
    ldr s1, [x15]           // Vm (single)

.Lfcsel_select:
    // Load guest NZCV from memory (not hardware, which may be clobbered by
    // TLB lookups in intervening load/store gadgets).
    // The dispatch uses cmp which also clobbers hardware flags, so we restore
    // guest NZCV from x17 at each condition label before testing.
    ldr w17, [_cpu, #CPU_nzcv]

    cmp x20, #0
    b.eq .Lfcsel_eq
    cmp x20, #1
    b.eq .Lfcsel_ne
    cmp x20, #10
    b.eq .Lfcsel_ge
    cmp x20, #11
    b.eq .Lfcsel_lt
    cmp x20, #12
    b.eq .Lfcsel_gt
    cmp x20, #13
    b.eq .Lfcsel_le
    cmp x20, #2
    b.eq .Lfcsel_cs
    cmp x20, #3
    b.eq .Lfcsel_cc
    cmp x20, #4
    b.eq .Lfcsel_mi
    cmp x20, #5
    b.eq .Lfcsel_pl
    cmp x20, #6
    b.eq .Lfcsel_vs
    cmp x20, #7
    b.eq .Lfcsel_vc
    cmp x20, #8
    b.eq .Lfcsel_hi
    cmp x20, #9
    b.eq .Lfcsel_ls
    b .Lfcsel_true           // AL/NV: always true

    // Each label: restore guest NZCV, test condition, branch to true/false
.Lfcsel_eq:
    msr nzcv, x17
    b.eq .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_ne:
    msr nzcv, x17
    b.ne .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_cs:
    msr nzcv, x17
    b.cs .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_cc:
    msr nzcv, x17
    b.cc .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_mi:
    msr nzcv, x17
    b.mi .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_pl:
    msr nzcv, x17
    b.pl .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_vs:
    msr nzcv, x17
    b.vs .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_vc:
    msr nzcv, x17
    b.vc .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_hi:
    msr nzcv, x17
    b.hi .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_ls:
    msr nzcv, x17
    b.ls .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_ge:
    msr nzcv, x17
    b.ge .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_lt:
    msr nzcv, x17
    b.lt .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_gt:
    msr nzcv, x17
    b.gt .Lfcsel_true
    b .Lfcsel_false
.Lfcsel_le:
    msr nzcv, x17
    b.le .Lfcsel_true
    b .Lfcsel_false

.Lfcsel_true:
    // Condition met: Rd = Rn (d0/s0)
    cbz x12, .Lfcsel_store_s_true
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.Lfcsel_store_s_true:
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

.Lfcsel_false:
    // Condition not met: Rd = Rm (d1/s1)
    cbz x12, .Lfcsel_store_s_false
    str d1, [x16]
    str xzr, [x16, #8]
    gret
.Lfcsel_store_s_false:
    str s1, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

/*
 * FP data-processing (1 source) - generic dispatcher
 * Code stream: [gadget addr][rd | rn<<8 | ftype<<16 | opcode<<20]
 * ftype: 0=single, 1=double
 * opcode: 0=FMOV, 1=FABS, 2=FNEG, 3=FSQRT, 4=FCVT(->S), 5=FCVT(->D),
 *         8=FRINTN, 9=FRINTP, 10=FRINTM, 11=FRINTZ, 12=FRINTA, 14=FRINTX, 15=FRINTI
 */
.gadget fp_dp1
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #4   // ftype
    ubfx x17, x8, #20, #6   // opcode

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x15, x9, #4
    add x15, x13, x15       // &Vd

    // Load source (always load as Q to cover both S and D)
    ldr q0, [x14]

    // Dispatch on opcode
    cmp x17, #1
    b.eq .Lfp_dp1_fabs
    cmp x17, #2
    b.eq .Lfp_dp1_fneg
    cmp x17, #3
    b.eq .Lfp_dp1_fsqrt
    cmp x17, #5
    b.eq .Lfp_dp1_fcvt_to_d
    cmp x17, #4
    b.eq .Lfp_dp1_fcvt_to_s
    cmp x17, #8
    b.eq .Lfp_dp1_frintn
    cmp x17, #9
    b.eq .Lfp_dp1_frintp
    cmp x17, #10
    b.eq .Lfp_dp1_frintm
    cmp x17, #11
    b.eq .Lfp_dp1_frintz
    cmp x17, #12
    b.eq .Lfp_dp1_frinta
    cmp x17, #14
    b.eq .Lfp_dp1_frintx
    cmp x17, #15
    b.eq .Lfp_dp1_frinti
    // opcode 0 = FMOV (same type copy) - just store source to dest
    b .Lfp_dp1_store

.Lfp_dp1_fabs:
    cbz x12, 1f
    fabs d0, d0
    b .Lfp_dp1_store
1:  fabs s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_fneg:
    cbz x12, 1f
    fneg d0, d0
    b .Lfp_dp1_store
1:  fneg s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_fsqrt:
    cbz x12, 1f
    fsqrt d0, d0
    b .Lfp_dp1_store
1:  fsqrt s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_fcvt_to_d:
    // FCVT Dd, Sn (single to double)
    fcvt d0, s0
    mov w12, #1              // result is double
    b .Lfp_dp1_store

.Lfp_dp1_fcvt_to_s:
    // FCVT Sd, Dn (double to single)
    fcvt s0, d0
    mov w12, #0              // result is single
    b .Lfp_dp1_store

.Lfp_dp1_frintn:
    cbz x12, 1f
    frintn d0, d0
    b .Lfp_dp1_store
1:  frintn s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_frintp:
    cbz x12, 1f
    frintp d0, d0
    b .Lfp_dp1_store
1:  frintp s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_frintm:
    cbz x12, 1f
    frintm d0, d0
    b .Lfp_dp1_store
1:  frintm s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_frintz:
    cbz x12, 1f
    frintz d0, d0
    b .Lfp_dp1_store
1:  frintz s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_frinta:
    cbz x12, 1f
    frinta d0, d0
    b .Lfp_dp1_store
1:  frinta s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_frintx:
    cbz x12, 1f
    frintx d0, d0
    b .Lfp_dp1_store
1:  frintx s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_frinti:
    cbz x12, 1f
    frinti d0, d0
    b .Lfp_dp1_store
1:  frinti s0, s0
    b .Lfp_dp1_store

.Lfp_dp1_store:
    cbz x12, .Lfp_dp1_store_s
    str d0, [x15]
    str xzr, [x15, #8]
    gret
.Lfp_dp1_store_s:
    str s0, [x15]
    str xzr, [x15, #4]
    str xzr, [x15, #8]
    gret

/*
 * FCVT Sd, Hn / FCVT Dd, Hn - scalar FP16 to FP32/FP64 conversion.
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget fcvt_h_to_s_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14
    ldr h0, [x14]
    fcvt s0, h0

    lsl x15, x9, #4
    add x15, x13, x15
    str s0, [x15]
    str xzr, [x15, #4]
    str xzr, [x15, #8]
    gret

.gadget fcvt_h_to_d_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14
    ldr h0, [x14]
    fcvt d0, h0

    lsl x15, x9, #4
    add x15, x13, x15
    str d0, [x15]
    str xzr, [x15, #8]
    gret

// Macro for FP two-source scalar operations
// All have same structure: load Vn and Vm, do op, store to Vd
.macro make_fp2_scalar name, op_d, op_s
.gadget \name\()_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // type (0=single, 1=double)
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x15, x11, #4
    add x15, x13, x15       // &Vm
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    cbz x12, .L\name\()_single
    ldr d0, [x14]
    ldr d1, [x15]
    \op_d d0, d0, d1
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.L\name\()_single:
    ldr s0, [x14]
    ldr s1, [x15]
    \op_s s0, s0, s1
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret
.endm

make_fp2_scalar fmax, fmax, fmax
make_fp2_scalar fmin, fmin, fmin
make_fp2_scalar fmaxnm, fmaxnm, fmaxnm
make_fp2_scalar fminnm, fminnm, fminnm
make_fp2_scalar fnmul, fnmul, fnmul
make_fp2_scalar fabd, fabd, fabd

/*
 * FADDP (scalar) - Floating-point Add Pair of elements
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 * sz=0: FADDP Sd, Vn.2S  (add two single-precision elements)
 * sz=1: FADDP Dd, Vn.2D  (add two double-precision elements)
 */
.gadget faddp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // sz (0=single, 1=double)
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    cbz x12, .Lfaddp_scalar_single
    // Double: add pair from 128-bit register
    ldr q0, [x14]
    faddp d0, v0.2d
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.Lfaddp_scalar_single:
    // Single: add pair from low 64 bits
    ldr d0, [x14]
    faddp s0, v0.2s
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

/*
 * FMAXP (scalar) - Floating-point Maximum Pair of elements
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 * sz=0: FMAXP Sd, Vn.2S, sz=1: FMAXP Dd, Vn.2D
 */
.gadget fmaxp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // sz
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    cbz x12, .Lfmaxp_scalar_single
    ldr q0, [x14]
    fmaxp d0, v0.2d
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.Lfmaxp_scalar_single:
    ldr d0, [x14]
    fmaxp s0, v0.2s
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

/*
 * FMINP (scalar) - Floating-point Minimum Pair of elements
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 * sz=0: FMINP Sd, Vn.2S, sz=1: FMINP Dd, Vn.2D
 */
.gadget fminp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // sz
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    cbz x12, .Lfminp_scalar_single
    ldr q0, [x14]
    fminp d0, v0.2d
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.Lfminp_scalar_single:
    ldr d0, [x14]
    fminp s0, v0.2s
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

/*
 * FMAXNMP (scalar) - Floating-point Maximum Number Pair of elements
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 */
.gadget fmaxnmp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // sz
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    cbz x12, .Lfmaxnmp_scalar_single
    ldr q0, [x14]
    fmaxnmp d0, v0.2d
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.Lfmaxnmp_scalar_single:
    ldr d0, [x14]
    fmaxnmp s0, v0.2s
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

/*
 * FMINNMP (scalar) - Floating-point Minimum Number Pair of elements
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 */
.gadget fminnmp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // sz
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    cbz x12, .Lfminnmp_scalar_single
    ldr q0, [x14]
    fminnmp d0, v0.2d
    str d0, [x16]
    str xzr, [x16, #8]
    gret
.Lfminnmp_scalar_single:
    ldr d0, [x14]
    fminnmp s0, v0.2s
    str s0, [x16]
    str xzr, [x16, #4]
    str xzr, [x16, #8]
    gret

// ADDP (scalar, integer) - Add pair of 64-bit elements to scalar
// ADDP Dd, Vn.2D: adds two 64-bit elements of Vn, stores in Dd
// Code stream: [gadget addr][rd | rn<<8]
.gadget addp_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    add x13, _cpu, #CPU_fp
    lsl x14, x10, #4
    add x14, x13, x14       // &Vn
    lsl x16, x9, #4
    add x16, x13, x16       // &Vd
    ldr q0, [x14]
    addp d0, v0.2d
    str d0, [x16]
    str xzr, [x16, #8]
    gret

// UMULH: Xd = (Xn * Xm) >> 64 (unsigned high multiply)
.gadget umulh
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x14, _cpu, #CPU_x0

    // Load Rn
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    // Load Rm
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    // Compute: result = (Rn * Rm) >> 64 (high bits)
    umulh x3, x15, x16

    // Store result
    cmp x9, #31
    b.eq 3f
    str x3, [x14, x9, lsl #3]
3:  gret

// SMULH: Xd = (Xn * Xm) >> 64 (signed high multiply)
.gadget smulh
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x14, _cpu, #CPU_x0

    // Load Rn
    cmp x10, #31
    mov x15, #0
    b.eq 1f
    ldr x15, [x14, x10, lsl #3]
1:
    // Load Rm
    cmp x11, #31
    mov x16, #0
    b.eq 2f
    ldr x16, [x14, x11, lsl #3]
2:
    // Compute: result = (Xn * Xm) >> 64 (signed high bits)
    smulh x3, x15, x16

    // Store result
    cmp x9, #31
    b.eq 3f
    str x3, [x14, x9, lsl #3]
3:  gret

/*
 * SADDW - Signed add wide (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * SADDW{2} Vd.<Ta>, Vn.<Ta>, Vm.<Tb>
 * Adds wide vector Vn (2x element size) to narrow vector Vm, producing wide result
 *
 * size: 0=B->H, 1=H->S, 2=S->D (narrow source size)
 * Q: 0=lower half (SADDW), 1=upper half (SADDW2)
 */
.gadget saddw_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn (wide)
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm (narrow)

    // Load wide vector Vn into v0
    ldr q0, [x15]
    // Load narrow vector Vm into v1
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lsaddw_size_b
    cmp x12, #1
    b.eq .Lsaddw_size_h
    // size == 2 (S->D)
    b .Lsaddw_size_s

.Lsaddw_size_b:
    // B->H: Vn.8H + Vm.8B (or .16B upper half)
    cbz x17, .Lsaddw_b_lo
    // SADDW2: upper half
    saddw2 v0.8h, v0.8h, v1.16b
    b .Lsaddw_store
.Lsaddw_b_lo:
    // SADDW: lower half
    saddw v0.8h, v0.8h, v1.8b
    b .Lsaddw_store

.Lsaddw_size_h:
    // H->S: Vn.4S + Vm.4H (or .8H upper half)
    cbz x17, .Lsaddw_h_lo
    // SADDW2: upper half
    saddw2 v0.4s, v0.4s, v1.8h
    b .Lsaddw_store
.Lsaddw_h_lo:
    // SADDW: lower half
    saddw v0.4s, v0.4s, v1.4h
    b .Lsaddw_store

.Lsaddw_size_s:
    // S->D: Vn.2D + Vm.2S (or .4S upper half)
    cbz x17, .Lsaddw_s_lo
    // SADDW2: upper half
    saddw2 v0.2d, v0.2d, v1.4s
    b .Lsaddw_store
.Lsaddw_s_lo:
    // SADDW: lower half
    saddw v0.2d, v0.2d, v1.2s
    b .Lsaddw_store

.Lsaddw_store:
    str q0, [x14]
    gret

/*
 * UADDW - Unsigned add wide (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * UADDW{2} Vd.<Ta>, Vn.<Ta>, Vm.<Tb>
 * Adds wide vector Vn (2x element size) to narrow vector Vm, producing wide result
 *
 * size: 0=B->H, 1=H->S, 2=S->D (narrow source size)
 * Q: 0=lower half (UADDW), 1=upper half (UADDW2)
 */
.gadget uaddw_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn (wide)
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm (narrow)

    // Load wide vector Vn into v0
    ldr q0, [x15]
    // Load narrow vector Vm into v1
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Luaddw_size_b
    cmp x12, #1
    b.eq .Luaddw_size_h
    // size == 2 (S->D)
    b .Luaddw_size_s

.Luaddw_size_b:
    // B->H: Vn.8H + Vm.8B (or .16B upper half)
    cbz x17, .Luaddw_b_lo
    // UADDW2: upper half
    uaddw2 v0.8h, v0.8h, v1.16b
    b .Luaddw_store
.Luaddw_b_lo:
    // UADDW: lower half
    uaddw v0.8h, v0.8h, v1.8b
    b .Luaddw_store

.Luaddw_size_h:
    // H->S: Vn.4S + Vm.4H (or .8H upper half)
    cbz x17, .Luaddw_h_lo
    // UADDW2: upper half
    uaddw2 v0.4s, v0.4s, v1.8h
    b .Luaddw_store
.Luaddw_h_lo:
    // UADDW: lower half
    uaddw v0.4s, v0.4s, v1.4h
    b .Luaddw_store

.Luaddw_size_s:
    // S->D: Vn.2D + Vm.2S (or .4S upper half)
    cbz x17, .Luaddw_s_lo
    // UADDW2: upper half
    uaddw2 v0.2d, v0.2d, v1.4s
    b .Luaddw_store
.Luaddw_s_lo:
    // UADDW: lower half
    uaddw v0.2d, v0.2d, v1.2s
    b .Luaddw_store

.Luaddw_store:
    str q0, [x14]
    gret

/*
 * SSUBW - Signed subtract wide (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * SSUBW{2} Vd.<Ta>, Vn.<Ta>, Vm.<Tb>
 * Subtracts sign-extended narrow vector Vm from wide vector Vn
 * Vd[i] = Vn[i] - sext(Vm[i])
 *
 * size: 0=B->H, 1=H->S, 2=S->D (narrow source size)
 * Q: 0=lower half (SSUBW), 1=upper half (SSUBW2)
 */
.gadget ssubw_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn (wide)
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm (narrow)

    // Load wide vector Vn into v0
    ldr q0, [x15]
    // Load narrow vector Vm into v1
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lssubw_size_b
    cmp x12, #1
    b.eq .Lssubw_size_h
    // size == 2 (S->D)
    b .Lssubw_size_s

.Lssubw_size_b:
    // B->H: Vn.8H - sext(Vm.8B) (or .16B upper half)
    cbz x17, .Lssubw_b_lo
    // SSUBW2: upper half
    ssubw2 v0.8h, v0.8h, v1.16b
    b .Lssubw_store
.Lssubw_b_lo:
    // SSUBW: lower half
    ssubw v0.8h, v0.8h, v1.8b
    b .Lssubw_store

.Lssubw_size_h:
    // H->S: Vn.4S - sext(Vm.4H) (or .8H upper half)
    cbz x17, .Lssubw_h_lo
    // SSUBW2: upper half
    ssubw2 v0.4s, v0.4s, v1.8h
    b .Lssubw_store
.Lssubw_h_lo:
    // SSUBW: lower half
    ssubw v0.4s, v0.4s, v1.4h
    b .Lssubw_store

.Lssubw_size_s:
    // S->D: Vn.2D - sext(Vm.2S) (or .4S upper half)
    cbz x17, .Lssubw_s_lo
    // SSUBW2: upper half
    ssubw2 v0.2d, v0.2d, v1.4s
    b .Lssubw_store
.Lssubw_s_lo:
    // SSUBW: lower half
    ssubw v0.2d, v0.2d, v1.2s
    b .Lssubw_store

.Lssubw_store:
    str q0, [x14]
    gret

/*
 * USUBW - Unsigned subtract wide (vector)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 *
 * USUBW{2} Vd.<Ta>, Vn.<Ta>, Vm.<Tb>
 * Subtracts zero-extended narrow vector Vm from wide vector Vn
 * Vd[i] = Vn[i] - zext(Vm[i])
 *
 * size: 0=B->H, 1=H->S, 2=S->D (narrow source size)
 * Q: 0=lower half (USUBW), 1=upper half (USUBW2)
 */
.gadget usubw_vec
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn (wide)
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm (narrow)

    // Load wide vector Vn into v0
    ldr q0, [x15]
    // Load narrow vector Vm into v1
    ldr q1, [x16]

    cmp x12, #0
    b.eq .Lusubw_size_b
    cmp x12, #1
    b.eq .Lusubw_size_h
    // size == 2 (S->D)
    b .Lusubw_size_s

.Lusubw_size_b:
    // B->H: Vn.8H - zext(Vm.8B) (or .16B upper half)
    cbz x17, .Lusubw_b_lo
    // USUBW2: upper half
    usubw2 v0.8h, v0.8h, v1.16b
    b .Lusubw_store
.Lusubw_b_lo:
    // USUBW: lower half
    usubw v0.8h, v0.8h, v1.8b
    b .Lusubw_store

.Lusubw_size_h:
    // H->S: Vn.4S - zext(Vm.4H) (or .8H upper half)
    cbz x17, .Lusubw_h_lo
    // USUBW2: upper half
    usubw2 v0.4s, v0.4s, v1.8h
    b .Lusubw_store
.Lusubw_h_lo:
    // USUBW: lower half
    usubw v0.4s, v0.4s, v1.4h
    b .Lusubw_store

.Lusubw_size_s:
    // S->D: Vn.2D - zext(Vm.2S) (or .4S upper half)
    cbz x17, .Lusubw_s_lo
    // USUBW2: upper half
    usubw2 v0.2d, v0.2d, v1.4s
    b .Lusubw_store
.Lusubw_s_lo:
    // USUBW: lower half
    usubw v0.2d, v0.2d, v1.2s
    b .Lusubw_store

.Lusubw_store:
    str q0, [x14]
    gret

/*
 * ============================================================
 * Specialized ALU gadgets for common 64-bit cases
 *
 * These eliminate runtime conditional branches by handling only
 * the most common case: 64-bit, no shift, no SP, no XZR operands.
 * gen.c selects these at decode time when conditions are met;
 * all other cases fall through to the generic gadgets above.
 *
 * Param packing: rd | rn<<8 | imm12_or_rm<<16
 * ============================================================
 */

// ADD (immediate, 64-bit, no flags, no SP, no LSL#12)
// Condition: sf=1, S=0, sh=0, rd!=31, rn!=31
.gadget add_imm_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    add x16, x15, x11
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// SUB (immediate, 64-bit, no flags, no SP, no LSL#12)
// Condition: sf=1, S=0, sh=0, rd!=31, rn!=31
.gadget sub_imm_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    sub x16, x15, x11
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// ADD (immediate, 64-bit, no flags, SP source, no LSL#12)
// Condition: sf=1, S=0, sh=0, rn==31, rd!=31
// Code stream: [gadget addr][rd | imm12<<16]
.gadget add_imm_sp_src_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x11, x8, #16, #12      // imm12
    ldr x15, [_cpu, #CPU_sp]     // load SP directly
    add x16, x15, x11
    add x14, _cpu, #CPU_x0
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// SUB (immediate, 64-bit, no flags, SP source, no LSL#12)
// Condition: sf=1, S=0, sh=0, rn==31, rd!=31
.gadget sub_imm_sp_src_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x11, x8, #16, #12
    ldr x15, [_cpu, #CPU_sp]
    sub x16, x15, x11
    add x14, _cpu, #CPU_x0
    str x16, [x14, x9, lsl #3]
    gret

// ADDS (immediate, 64-bit, flag-setting, no SP source, no LSL#12)
// Condition: sf=1, S=1, sh=0, rn!=31 (rd=31 allowed for CMN)
.gadget adds_imm_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    adds x16, x15, x11
    store_flags
    cmp x9, #31
    b.eq 1f
    str x16, [x14, x9, lsl #3]  // Rd
1:  gret

// SUBS (immediate, 64-bit, flag-setting, no SP source, no LSL#12)
// Condition: sf=1, S=1, sh=0, rn!=31 (rd=31 allowed for CMP)
.gadget subs_imm_64
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    subs x16, x15, x11
    store_flags
    cmp x9, #31
    b.eq 1f
    str x16, [x14, x9, lsl #3]  // Rd
1:  gret

// ADDS (immediate, 64-bit, flag-setting, LSL#12)
// Condition: sf=1, S=1, sh=1, rn!=31
// Param: rd | rn<<8 | imm12<<16
.gadget adds_imm_64_sh
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    lsl x11, x11, #12           // apply LSL#12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    adds x16, x15, x11
    store_flags
    cmp x9, #31
    b.eq 1f
    str x16, [x14, x9, lsl #3]  // Rd
1:  gret

// SUBS (immediate, 64-bit, flag-setting, LSL#12)
// Condition: sf=1, S=1, sh=1, rn!=31
// Param: rd | rn<<8 | imm12<<16
.gadget subs_imm_64_sh
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    lsl x11, x11, #12           // apply LSL#12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    subs x16, x15, x11
    store_flags
    cmp x9, #31
    b.eq 1f
    str x16, [x14, x9, lsl #3]  // Rd
1:  gret

// ADD (immediate, 64-bit, no flags, LSL#12)
// Condition: sf=1, S=0, sh=1, rd!=31, rn!=31
// Param: rd | rn<<8 | imm12<<16
.gadget add_imm_64_sh
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    lsl x11, x11, #12           // apply LSL#12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    add x16, x15, x11
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// SUB (immediate, 64-bit, no flags, LSL#12)
// Condition: sf=1, S=0, sh=1, rd!=31, rn!=31
// Param: rd | rn<<8 | imm12<<16
.gadget sub_imm_64_sh
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    lsl x11, x11, #12           // apply LSL#12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    sub x16, x15, x11
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// ============================================================
// 32-bit specialized add/sub immediate gadgets (OP-10)
// ============================================================

// ADD (immediate, 32-bit, no flags, no SP, no LSL#12)
// Condition: sf=0, S=0, sh=0, rd!=31, rn!=31
// Param: rd | rn<<8 | imm12<<16
.gadget add_imm_32
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    add w16, w15, w11            // 32-bit add (zero-extends result)
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// SUB (immediate, 32-bit, no flags, no SP, no LSL#12)
// Condition: sf=0, S=0, sh=0, rd!=31, rn!=31
// Param: rd | rn<<8 | imm12<<16
.gadget sub_imm_32
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    sub w16, w15, w11            // 32-bit sub (zero-extends result)
    str x16, [x14, x9, lsl #3]  // Rd
    gret

// ADDS (immediate, 32-bit, flag-setting, no SP source, no LSL#12)
// Condition: sf=0, S=1, sh=0, rn!=31 (rd=31 allowed for CMN)
// Param: rd | rn<<8 | imm12<<16
.gadget adds_imm_32
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    adds w16, w15, w11           // 32-bit adds (zero-extends, sets 32-bit flags)
    store_flags
    cmp x9, #31
    b.eq 1f
    str x16, [x14, x9, lsl #3]  // Rd (already zero-extended by w-reg op)
1:  gret

// SUBS (immediate, 32-bit, flag-setting, no SP source, no LSL#12)
// Condition: sf=0, S=1, sh=0, rn!=31 (rd=31 allowed for CMP)
// Param: rd | rn<<8 | imm12<<16
.gadget subs_imm_32
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #12      // imm12
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    subs w16, w15, w11           // 32-bit subs (zero-extends, sets 32-bit flags)
    store_flags
    cmp x9, #31
    b.eq 1f
    str x16, [x14, x9, lsl #3]  // Rd (already zero-extended by w-reg op)
1:  gret

// ADDS (register, 64-bit, flag-setting, no shift, no XZR)
// Condition: sf=1, S=1, imm6=0, rn!=31, rm!=31
// Param: rd | rn<<8 | rm<<16 (rd=31 allowed for CMN)
.gadget adds_reg_64_nshift
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #5       // rm
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    ldr x16, [x14, x11, lsl #3] // Rm
    adds x3, x15, x16
    store_flags
    cmp x9, #31
    b.eq 1f
    str x3, [x14, x9, lsl #3]   // Rd
1:  gret

// SUBS (register, 64-bit, flag-setting, no shift, no XZR)
// Condition: sf=1, S=1, imm6=0, rn!=31, rm!=31
// Param: rd | rn<<8 | rm<<16 (rd=31 allowed for CMP)
.gadget subs_reg_64_nshift
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #5       // rm
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    ldr x16, [x14, x11, lsl #3] // Rm
    subs x3, x15, x16
    store_flags
    cmp x9, #31
    b.eq 1f
    str x3, [x14, x9, lsl #3]   // Rd
1:  gret

// ADD (register, 64-bit, no flags, no shift, no XZR/SP)
// Condition: sf=1, S=0, imm6=0, rn!=31, rm!=31, rd!=31
// Param: rd | rn<<8 | rm<<16
.gadget add_reg_64_nshift
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #5       // rm
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    ldr x16, [x14, x11, lsl #3] // Rm
    add x17, x15, x16
    str x17, [x14, x9, lsl #3]  // Rd
    gret

// SUB (register, 64-bit, no flags, no shift, no XZR/SP)
// Condition: sf=1, S=0, imm6=0, rn!=31, rm!=31, rd!=31
// Param: rd | rn<<8 | rm<<16
.gadget sub_reg_64_nshift
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #5       // rm
    add x14, _cpu, #CPU_x0
    ldr x15, [x14, x10, lsl #3] // Rn
    ldr x16, [x14, x11, lsl #3] // Rm
    sub x17, x15, x16
    str x17, [x14, x9, lsl #3]  // Rd
    gret

/*
 * Three-same NEON ops using native instructions (MUL, PMUL, MLA, MLS,
 * SMAX, UMAX, SMIN, UMIN).
 *
 * Macro: make_threesame_native  name, op, has_d
 *   name: gadget name (e.g. mul)
 *   op:   native instruction mnemonic
 *   has_d: 1 if D-size supported, 0 if not (B/H/S only)
 *
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.macro make_threesame_native name, op, has_d=0
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .L\name\()_b
    cmp x12, #1
    b.eq .L\name\()_h
    cmp x12, #2
    b.eq .L\name\()_s
.if \has_d
    b .L\name\()_d
.else
    b .L\name\()_inv
.endif

.L\name\()_b:
    cbz x17, .L\name\()_b_q0
    \op v0.16b, v0.16b, v1.16b
    b .L\name\()_store_q
.L\name\()_b_q0:
    \op v0.8b, v0.8b, v1.8b
    b .L\name\()_store_low

.L\name\()_h:
    cbz x17, .L\name\()_h_q0
    \op v0.8h, v0.8h, v1.8h
    b .L\name\()_store_q
.L\name\()_h_q0:
    \op v0.4h, v0.4h, v1.4h
    b .L\name\()_store_low

.L\name\()_s:
    cbz x17, .L\name\()_s_q0
    \op v0.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \op v0.2s, v0.2s, v1.2s
    b .L\name\()_store_low

.if \has_d
.L\name\()_d:
    cbz x17, .L\name\()_inv
    \op v0.2d, v0.2d, v1.2d
    b .L\name\()_store_q
.endif

.L\name\()_inv:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.L\name\()_store_q:
    str q0, [x14]
    gret

.L\name\()_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

/*
 * Three-same accumulate ops (MLA, MLS). Rd = Rd op Vn * Vm.
 * Need to load Vd into v2 first.
 *
 * Macro: make_threesame_accum  name, op
 */
.macro make_threesame_accum name, op
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]            // Vn
    ldr q1, [x16]            // Vm
    ldr q2, [x14]            // Vd (accumulator)

    cmp x12, #0
    b.eq .L\name\()_b
    cmp x12, #1
    b.eq .L\name\()_h
    // size=2: S
    cbz x17, .L\name\()_s_q0
    \op v2.4s, v0.4s, v1.4s
    str q2, [x14]
    gret
.L\name\()_s_q0:
    \op v2.2s, v0.2s, v1.2s
    str d2, [x14]
    str xzr, [x14, #8]
    gret

.L\name\()_b:
    cbz x17, .L\name\()_b_q0
    \op v2.16b, v0.16b, v1.16b
    str q2, [x14]
    gret
.L\name\()_b_q0:
    \op v2.8b, v0.8b, v1.8b
    str d2, [x14]
    str xzr, [x14, #8]
    gret

.L\name\()_h:
    cbz x17, .L\name\()_h_q0
    \op v2.8h, v0.8h, v1.8h
    str q2, [x14]
    gret
.L\name\()_h_q0:
    \op v2.4h, v0.4h, v1.4h
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

// Integer multiply (B/H/S only, no D)
make_threesame_native mul, mul, 0

// Polynomial multiply (B only — special gadget, gen.c validates size=0)
.gadget pmul_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cbz x17, .Lpmul_q0
    pmul v0.16b, v0.16b, v1.16b
    str q0, [x14]
    gret
.Lpmul_q0:
    pmul v0.8b, v0.8b, v1.8b
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// Signed/unsigned max/min (B/H/S only, no D)
make_threesame_native smax, smax, 0
make_threesame_native umax, umax, 0
make_threesame_native smin, smin, 0
make_threesame_native umin, umin, 0

// Signed max/min pairwise (B/H/S only, no D)
make_threesame_native smaxp, smaxp, 0
make_threesame_native sminp, sminp, 0

/*
 * Macro: make_threesame_native_hs  name, op
 * Like make_threesame_native but only H (size=1) and S (size=2) are valid.
 * Used for SQDMULH/SQRDMULH which have no byte or doubleword variants.
 */
.macro make_threesame_native_hs name, op
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #1
    b.eq .L\name\()_h
    cmp x12, #2
    b.eq .L\name\()_s
    // size 0 (B) and 3 (D) are invalid
    b .L\name\()_inv

.L\name\()_h:
    cbz x17, .L\name\()_h_q0
    \op v0.8h, v0.8h, v1.8h
    b .L\name\()_store_q
.L\name\()_h_q0:
    \op v0.4h, v0.4h, v1.4h
    b .L\name\()_store_low

.L\name\()_s:
    cbz x17, .L\name\()_s_q0
    \op v0.4s, v0.4s, v1.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \op v0.2s, v0.2s, v1.2s
    b .L\name\()_store_low

.L\name\()_inv:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.L\name\()_store_q:
    str q0, [x14]
    gret

.L\name\()_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

// Signed saturating doubling multiply high (H/S only)
make_threesame_native_hs sqdmulh, sqdmulh
make_threesame_native_hs sqrdmulh, sqrdmulh

// Signed/unsigned absolute difference (B/H/S only, no D)
make_threesame_native sabd, sabd, 0
make_threesame_native uabd, uabd, 0

// Compare bitwise test (B/H/S/D)
make_threesame_native cmtst, cmtst, 1

// Multiply-accumulate and multiply-subtract (B/H/S only)
make_threesame_accum mla, mla
make_threesame_accum mls, mls

/*
 * Two-reg misc native ops (ABS, NEG, CLS, CLZ, etc.)
 *
 * Macro: make_twomis_native  name, op, has_d
 *   name: gadget name
 *   op:   native instruction mnemonic
 *   has_d: 1 if D-size supported, 0 if not
 *
 * Code stream: [gadget addr][rd | rn<<8 | size<<16 | Q<<24]
 */
.macro make_twomis_native name, op, has_d=1
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #2   // size
    ubfx x17, x8, #24, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cmp x12, #0
    b.eq .L\name\()_b
    cmp x12, #1
    b.eq .L\name\()_h
    cmp x12, #2
    b.eq .L\name\()_s
.if \has_d
    b .L\name\()_d
.else
    b .L\name\()_inv
.endif

.L\name\()_b:
    cbz x17, .L\name\()_b_q0
    \op v0.16b, v0.16b
    b .L\name\()_store_q
.L\name\()_b_q0:
    \op v0.8b, v0.8b
    b .L\name\()_store_low

.L\name\()_h:
    cbz x17, .L\name\()_h_q0
    \op v0.8h, v0.8h
    b .L\name\()_store_q
.L\name\()_h_q0:
    \op v0.4h, v0.4h
    b .L\name\()_store_low

.L\name\()_s:
    cbz x17, .L\name\()_s_q0
    \op v0.4s, v0.4s
    b .L\name\()_store_q
.L\name\()_s_q0:
    \op v0.2s, v0.2s
    b .L\name\()_store_low

.if \has_d
.L\name\()_d:
    cbz x17, .L\name\()_inv
    \op v0.2d, v0.2d
    b .L\name\()_store_q
.endif

.L\name\()_inv:
    str xzr, [x14]
    str xzr, [x14, #8]
    gret

.L\name\()_store_q:
    str q0, [x14]
    gret

.L\name\()_store_low:
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_twomis_native abs, abs, 1
make_twomis_native neg, neg, 1
make_twomis_native clz, clz, 0
make_twomis_native cls, cls, 0

/*
 * NOT/RBIT vector (bytes only: .8B/.16B)
 * Code stream: [gadget addr][rd | rn<<8 | Q<<16]
 */
.macro make_byte_vec_unary name, insn
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x17, x8, #16, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn

    ldr q0, [x15]

    cbz x17, .L\name\()_8b
    \insn v0.16b, v0.16b
    str q0, [x14]
    gret
.L\name\()_8b:
    \insn v0.8b, v0.8b
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

make_byte_vec_unary not, not
// rbit_vec already defined above (line ~5408)

/*
 * Three-different widening "long" ops (UADDL, SADDL, USUBL, SSUBL, UMULL, SMULL, UABDL, SABDL).
 * Both Vn and Vm are narrow; Vd is wide.
 * Q=0: lower half, Q=1: upper half (op2 variant).
 *
 * Macro: make_widening_long  name, op
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 */
.macro make_widening_long name, op
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]
    ldr q1, [x16]

    cmp x12, #0
    b.eq .L\name\()_b
    cmp x12, #1
    b.eq .L\name\()_h
    // size == 2 (S->D)
    cbz x17, .L\name\()_s_lo
    \op\()2 v0.2d, v0.4s, v1.4s
    b .L\name\()_store
.L\name\()_s_lo:
    \op v0.2d, v0.2s, v1.2s
    b .L\name\()_store

.L\name\()_b:
    cbz x17, .L\name\()_b_lo
    \op\()2 v0.8h, v0.16b, v1.16b
    b .L\name\()_store
.L\name\()_b_lo:
    \op v0.8h, v0.8b, v1.8b
    b .L\name\()_store

.L\name\()_h:
    cbz x17, .L\name\()_h_lo
    \op\()2 v0.4s, v0.8h, v1.8h
    b .L\name\()_store
.L\name\()_h_lo:
    \op v0.4s, v0.4h, v1.4h
    // fall through

.L\name\()_store:
    str q0, [x14]
    gret
.endm

/*
 * Saturating shift-right-and-narrow instructions (UQRSHRN, SQRSHRN, etc.)
 * Similar to SHRN but uses saturating narrowing (uqxtn/sqxtn/sqxtun).
 *
 * Macro: make_sat_shrn  name, shift_op_prefix, narrow_8b, narrow_16b, narrow_4h, narrow_8h, narrow_2s, narrow_4s
 *   name: gadget name
 *   shift_op_prefix: urshl or srshl (for rounding) or ushl/sshl (non-rounding)
 *   narrow_*: native saturating narrow instruction for each size
 *
 * Code stream: [gadget addr][rd | rn<<8 | shift<<16 | esize<<24 | Q<<28]
 */
.macro make_sat_shrn name, sop, n8b, n16b, n4h, n8h, n2s, n4s
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #8   // shift amount
    ubfx x12, x8, #24, #4   // esize (0=B, 1=H, 2=S - narrow target)
    ubfx x17, x8, #28, #1   // Q
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr q0, [x15]           // load source (wide elements)
    ldr q2, [x14]           // load dest (for Q=1 preserve lower)
    neg x11, x11             // negative shift for right shift
    cmp x12, #2
    b.eq .L\name\()_2d
    cmp x12, #1
    b.eq .L\name\()_4s
    // esize=0: 8H→8B
    dup v1.8h, w11
    \sop v0.8h, v0.8h, v1.8h
    cbz x17, .L\name\()_8h_lo
    \n16b
    str q2, [x14]
    gret
.L\name\()_8h_lo:
    \n8b
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_4s:
    dup v1.4s, w11
    \sop v0.4s, v0.4s, v1.4s
    cbz x17, .L\name\()_4s_lo
    \n8h
    str q2, [x14]
    gret
.L\name\()_4s_lo:
    \n4h
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_2d:
    dup v1.2d, x11
    \sop v0.2d, v0.2d, v1.2d
    cbz x17, .L\name\()_2d_lo
    \n4s
    str q2, [x14]
    gret
.L\name\()_2d_lo:
    \n2s
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

// UQRSHRN: unsigned rounding shift right + unsigned saturating narrow
make_sat_shrn uqrshrn, urshl, "uqxtn v2.8b, v0.8h", "uqxtn2 v2.16b, v0.8h", "uqxtn v2.4h, v0.4s", "uqxtn2 v2.8h, v0.4s", "uqxtn v2.2s, v0.2d", "uqxtn2 v2.4s, v0.2d"
// SQRSHRN: signed rounding shift right + signed saturating narrow
make_sat_shrn sqrshrn, srshl, "sqxtn v2.8b, v0.8h", "sqxtn2 v2.16b, v0.8h", "sqxtn v2.4h, v0.4s", "sqxtn2 v2.8h, v0.4s", "sqxtn v2.2s, v0.2d", "sqxtn2 v2.4s, v0.2d"
// UQSHRN: unsigned shift right (truncate) + unsigned saturating narrow
make_sat_shrn uqshrn, ushl, "uqxtn v2.8b, v0.8h", "uqxtn2 v2.16b, v0.8h", "uqxtn v2.4h, v0.4s", "uqxtn2 v2.8h, v0.4s", "uqxtn v2.2s, v0.2d", "uqxtn2 v2.4s, v0.2d"
// SQSHRN: signed shift right (truncate) + signed saturating narrow
make_sat_shrn sqshrn, sshl, "sqxtn v2.8b, v0.8h", "sqxtn2 v2.16b, v0.8h", "sqxtn v2.4h, v0.4s", "sqxtn2 v2.8h, v0.4s", "sqxtn v2.2s, v0.2d", "sqxtn2 v2.4s, v0.2d"
// SQSHRUN: signed rounding shift right + unsigned saturating narrow from signed
make_sat_shrn sqshrun, sshl, "sqxtun v2.8b, v0.8h", "sqxtun2 v2.16b, v0.8h", "sqxtun v2.4h, v0.4s", "sqxtun2 v2.8h, v0.4s", "sqxtun v2.2s, v0.2d", "sqxtun2 v2.4s, v0.2d"
// SQRSHRUN: signed rounding shift right + unsigned saturating narrow from signed
make_sat_shrn sqrshrun, srshl, "sqxtun v2.8b, v0.8h", "sqxtun2 v2.16b, v0.8h", "sqxtun v2.4h, v0.4s", "sqxtun2 v2.8h, v0.4s", "sqxtun v2.2s, v0.2d", "sqxtun2 v2.4s, v0.2d"

/*
 * Indexed-element helpers: extract element[index] from Vm and DUP to v1.
 *
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | index<<21 | size<<24 | Q<<26]
 *
 * Helper macro: elem_setup  name
 *   Parses code stream, loads Vn→v0, extracts Vm[index]→v1 (dup'd).
 *   Sets x14→&Vd, x17=Q, x12=size.
 */
.macro elem_setup name
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #5       // rm
    ubfx x20, x8, #21, #3       // index
    ubfx x12, x8, #24, #2       // size
    ubfx x17, x8, #26, #1       // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14           // &Vd
    lsl x15, x10, #4
    add x15, x13, x15           // &Vn
    lsl x16, x11, #4
    add x16, x13, x16           // &Vm

    ldr q0, [x15]               // Vn
    ldr q1, [x16]               // Vm (will be replaced by dup of element)

    // DUP element from v1 based on size and index
    cmp x12, #1
    b.eq .L\name\()_dup_h
    cmp x12, #2
    b.eq .L\name\()_dup_s
    // size=3: D
    cbnz x20, .L\name\()_dup_d1
    dup v1.2d, v1.d[0]
    b .L\name\()_op
.L\name\()_dup_d1:
    dup v1.2d, v1.d[1]
    b .L\name\()_op
.L\name\()_dup_h:
    cmp x20, #0
    b.eq .L\name\()_dup_h0
    cmp x20, #1
    b.eq .L\name\()_dup_h1
    cmp x20, #2
    b.eq .L\name\()_dup_h2
    cmp x20, #3
    b.eq .L\name\()_dup_h3
    cmp x20, #4
    b.eq .L\name\()_dup_h4
    cmp x20, #5
    b.eq .L\name\()_dup_h5
    cmp x20, #6
    b.eq .L\name\()_dup_h6
    dup v1.8h, v1.h[7]
    b .L\name\()_op
.L\name\()_dup_h0:
    dup v1.8h, v1.h[0]
    b .L\name\()_op
.L\name\()_dup_h1:
    dup v1.8h, v1.h[1]
    b .L\name\()_op
.L\name\()_dup_h2:
    dup v1.8h, v1.h[2]
    b .L\name\()_op
.L\name\()_dup_h3:
    dup v1.8h, v1.h[3]
    b .L\name\()_op
.L\name\()_dup_h4:
    dup v1.8h, v1.h[4]
    b .L\name\()_op
.L\name\()_dup_h5:
    dup v1.8h, v1.h[5]
    b .L\name\()_op
.L\name\()_dup_h6:
    dup v1.8h, v1.h[6]
    b .L\name\()_op
.L\name\()_dup_s:
    cmp x20, #0
    b.eq .L\name\()_dup_s0
    cmp x20, #1
    b.eq .L\name\()_dup_s1
    cmp x20, #2
    b.eq .L\name\()_dup_s2
    dup v1.4s, v1.s[3]
    b .L\name\()_op
.L\name\()_dup_s0:
    dup v1.4s, v1.s[0]
    b .L\name\()_op
.L\name\()_dup_s1:
    dup v1.4s, v1.s[1]
    b .L\name\()_op
.L\name\()_dup_s2:
    dup v1.4s, v1.s[2]
    b .L\name\()_op
.endm

/*
 * Macro: elem_op_store  name, op  — perform the operation and store
 * v0=Vn, v1=Vm[idx] dup'd, x14=&Vd, x12=size, x17=Q
 */
.macro elem_op_store name, op
.L\name\()_op:
    cmp x12, #1
    b.eq .L\name\()_op_h
    // size=2: S
    cbz x17, .L\name\()_op_s_q0
    \op v0.4s, v0.4s, v1.4s
    str q0, [x14]
    gret
.L\name\()_op_s_q0:
    \op v0.2s, v0.2s, v1.2s
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_op_h:
    cbz x17, .L\name\()_op_h_q0
    \op v0.8h, v0.8h, v1.8h
    str q0, [x14]
    gret
.L\name\()_op_h_q0:
    \op v0.4h, v0.4h, v1.4h
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

// MUL by element
elem_setup mul_elem
elem_op_store mul_elem, mul

/*
 * MLA/MLS by element — accumulate variants need Vd loaded into v2.
 */
.macro elem_accum_op_store name, op
.L\name\()_op:
    ldr q2, [x14]               // Vd (accumulator)
    cmp x12, #1
    b.eq .L\name\()_op_h
    cbz x17, .L\name\()_op_s_q0
    \op v2.4s, v0.4s, v1.4s
    str q2, [x14]
    gret
.L\name\()_op_s_q0:
    \op v2.2s, v0.2s, v1.2s
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_op_h:
    cbz x17, .L\name\()_op_h_q0
    \op v2.8h, v0.8h, v1.8h
    str q2, [x14]
    gret
.L\name\()_op_h_q0:
    \op v2.4h, v0.4h, v1.4h
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

elem_setup mla_elem
elem_accum_op_store mla_elem, mla

elem_setup mls_elem
elem_accum_op_store mls_elem, mls

/*
 * FP multiply by element (FMUL/FMLA/FMLS by element)
 * Uses elem_setup for parameter parsing and element DUP.
 * size=2: float (S), size=3: double (D)
 */
.macro elem_fp_op_store name, op
.L\name\()_op:
    cmp x12, #3
    b.eq .L\name\()_op_d
    // size=2: S (float)
    cbz x17, .L\name\()_op_s_q0
    \op v0.4s, v0.4s, v1.4s
    str q0, [x14]
    gret
.L\name\()_op_s_q0:
    \op v0.2s, v0.2s, v1.2s
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_op_d:
    // size=3: D (double), Q must be 1 for 2D
    \op v0.2d, v0.2d, v1.2d
    str q0, [x14]
    gret
.endm

.macro elem_fp_accum_op_store name, op
.L\name\()_op:
    ldr q2, [x14]               // Vd (accumulator)
    cmp x12, #3
    b.eq .L\name\()_op_d
    // size=2: S (float)
    cbz x17, .L\name\()_op_s_q0
    \op v2.4s, v0.4s, v1.4s
    str q2, [x14]
    gret
.L\name\()_op_s_q0:
    \op v2.2s, v0.2s, v1.2s
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_op_d:
    // size=3: D (double), Q must be 1 for 2D
    \op v2.2d, v0.2d, v1.2d
    str q2, [x14]
    gret
.endm

// FMUL by element
elem_setup fmul_elem
elem_fp_op_store fmul_elem, fmul

// FMLA by element
elem_setup fmla_elem
elem_fp_accum_op_store fmla_elem, fmla

// FMLS by element
elem_setup fmls_elem
elem_fp_accum_op_store fmls_elem, fmls

/*
 * Scalar FP multiply by element (FMUL/FMLA/FMLS/FMULX Sd/Dd, Sn/Dn, Vm[idx])
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | index<<21 | size<<24]
 * size=2: single, size=3: double
 */
.macro scalar_elem_setup name
.gadget \name\()_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f           // rd
    ubfx x10, x8, #8, #5        // rn
    ubfx x11, x8, #16, #5       // rm
    ubfx x20, x8, #21, #3       // index
    ubfx x12, x8, #24, #2       // size

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14           // &Vd
    lsl x15, x10, #4
    add x15, x13, x15           // &Vn
    lsl x16, x11, #4
    add x16, x13, x16           // &Vm

    cmp x12, #3
    b.eq .L\name\()_scalar_d

    // size=2: single precision
    ldr s0, [x15]               // Sn
    // Extract Vm.s[index]
    ldr q1, [x16]
    cmp x20, #0
    b.eq .L\name\()_scalar_s_idx0
    cmp x20, #1
    b.eq .L\name\()_scalar_s_idx1
    cmp x20, #2
    b.eq .L\name\()_scalar_s_idx2
    mov s1, v1.s[3]
    b .L\name\()_scalar_s_op
.L\name\()_scalar_s_idx0:
    // s1 already has v1.s[0] from ldr q1
    mov s1, v1.s[0]
    b .L\name\()_scalar_s_op
.L\name\()_scalar_s_idx1:
    mov s1, v1.s[1]
    b .L\name\()_scalar_s_op
.L\name\()_scalar_s_idx2:
    mov s1, v1.s[2]
    b .L\name\()_scalar_s_op

.L\name\()_scalar_d:
    // size=3: double precision
    ldr d0, [x15]               // Dn
    ldr q1, [x16]
    cbz x20, .L\name\()_scalar_d_idx0
    mov d1, v1.d[1]
    b .L\name\()_scalar_d_op
.L\name\()_scalar_d_idx0:
    mov d1, v1.d[0]
    b .L\name\()_scalar_d_op
.endm

.macro scalar_elem_fp_op name, op
.L\name\()_scalar_s_op:
    \op s0, s0, s1
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.L\name\()_scalar_d_op:
    \op d0, d0, d1
    str d0, [x14]
    str xzr, [x14, #8]
    gret
.endm

.macro scalar_elem_fp_fmadd_op name
.L\name\()_scalar_s_op:
    ldr s2, [x14]               // Sd (accumulator)
    fmadd s2, s0, s1, s2        // Sd = Sn * Sm[idx] + Sd
    str s2, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.L\name\()_scalar_d_op:
    ldr d2, [x14]               // Dd (accumulator)
    fmadd d2, d0, d1, d2        // Dd = Dn * Dm[idx] + Dd
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

.macro scalar_elem_fp_fmsub_op name
.L\name\()_scalar_s_op:
    ldr s2, [x14]               // Sd (accumulator)
    fmsub s2, s0, s1, s2        // Sd = -(Sn * Sm[idx]) + Sd = Sd - Sn*Sm[idx]
    str s2, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.L\name\()_scalar_d_op:
    ldr d2, [x14]               // Dd (accumulator)
    fmsub d2, d0, d1, d2        // Dd = -(Dn * Dm[idx]) + Dd
    str d2, [x14]
    str xzr, [x14, #8]
    gret
.endm

// FMUL scalar by element
scalar_elem_setup fmul_elem
scalar_elem_fp_op fmul_elem, fmul

// FMLA scalar by element: Sd += Sn * Vm.s[idx]
scalar_elem_setup fmla_elem
scalar_elem_fp_fmadd_op fmla_elem

// FMLS scalar by element: Sd -= Sn * Vm.s[idx]
scalar_elem_setup fmls_elem
scalar_elem_fp_fmsub_op fmls_elem

// FMULX scalar by element
scalar_elem_setup fmulx_elem
scalar_elem_fp_op fmulx_elem, fmulx

/*
 * Widening multiply by element (SMULL/UMULL/SMLAL/UMLAL/SMLSL/UMLSL by element)
 * v0=Vn (narrow), v1=Vm[idx] dup'd, x14=&Vd (wide result), x12=size, x17=Q
 */
.macro elem_widen_op_store name, op
.L\name\()_op:
    cmp x12, #1
    b.eq .L\name\()_op_h
    cmp x12, #2
    b.eq .L\name\()_op_s
    // size=3 not valid for widening
    str xzr, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_op_h:
    cbz x17, .L\name\()_op_h_lo
    \op\()2 v0.4s, v0.8h, v1.8h
    b .L\name\()_op_store
.L\name\()_op_h_lo:
    \op v0.4s, v0.4h, v1.4h
    b .L\name\()_op_store
.L\name\()_op_s:
    cbz x17, .L\name\()_op_s_lo
    \op\()2 v0.2d, v0.4s, v1.4s
    b .L\name\()_op_store
.L\name\()_op_s_lo:
    \op v0.2d, v0.2s, v1.2s
.L\name\()_op_store:
    str q0, [x14]
    gret
.endm

elem_setup smull_elem
elem_widen_op_store smull_elem, smull

elem_setup umull_elem
elem_widen_op_store umull_elem, umull

/*
 * Widening multiply-accumulate by element (SMLAL/UMLAL/SMLSL/UMLSL by element)
 * Need to load Vd (wide accumulator) into v2 first.
 */
.macro elem_widen_accum_op_store name, op
.L\name\()_op:
    ldr q2, [x14]               // Vd (wide accumulator)
    cmp x12, #1
    b.eq .L\name\()_op_h
    cmp x12, #2
    b.eq .L\name\()_op_s
    str xzr, [x14]
    str xzr, [x14, #8]
    gret
.L\name\()_op_h:
    cbz x17, .L\name\()_op_h_lo
    \op\()2 v2.4s, v0.8h, v1.8h
    b .L\name\()_op_store
.L\name\()_op_h_lo:
    \op v2.4s, v0.4h, v1.4h
    b .L\name\()_op_store
.L\name\()_op_s:
    cbz x17, .L\name\()_op_s_lo
    \op\()2 v2.2d, v0.4s, v1.4s
    b .L\name\()_op_store
.L\name\()_op_s_lo:
    \op v2.2d, v0.2s, v1.2s
.L\name\()_op_store:
    str q2, [x14]
    gret
.endm

elem_setup smlal_elem
elem_widen_accum_op_store smlal_elem, smlal

elem_setup umlal_elem
elem_widen_accum_op_store umlal_elem, umlal

elem_setup smlsl_elem
elem_widen_accum_op_store smlsl_elem, smlsl

elem_setup umlsl_elem
elem_widen_accum_op_store umlsl_elem, umlsl

// SQDMULH by element (H/S only, non-widening)
elem_setup sqdmulh_elem
elem_op_store sqdmulh_elem, sqdmulh

// SQRDMULH by element (H/S only, non-widening)
elem_setup sqrdmulh_elem
elem_op_store sqrdmulh_elem, sqrdmulh

// SQDMULL by element (widening: H→S, S→D)
elem_setup sqdmull_elem
elem_widen_op_store sqdmull_elem, sqdmull

// SQDMLAL by element (widening accumulate)
elem_setup sqdmlal_elem
elem_widen_accum_op_store sqdmlal_elem, sqdmlal

// SQDMLSL by element (widening subtract-accumulate)
elem_setup sqdmlsl_elem
elem_widen_accum_op_store sqdmlsl_elem, sqdmlsl

make_widening_long saddl, saddl
make_widening_long uaddl, uaddl
make_widening_long ssubl, ssubl
make_widening_long usubl, usubl
make_widening_long smull, smull
make_widening_long umull, umull
make_widening_long sabdl, sabdl
make_widening_long uabdl, uabdl

/*
 * Macro: make_narrowing_high  name, op
 * ADDHN/SUBHN/RADDHN/RSUBHN - add/sub wide operands, return high narrow result
 * Direction: Vn(wide) op Vm(wide) → Vd(narrow, high half)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 * size: narrow target element size (0=B, 1=H, 2=S)
 * Q: 0=lower half, 1=upper half (writes to upper half of Vd)
 */
.macro make_narrowing_high name, op
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size (narrow target)
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x15]           // Vn (wide)
    ldr q1, [x16]           // Vm (wide)
    ldr q2, [x14]           // Vd (preserve for Q=1)

    cmp x12, #0
    b.eq .L\name\()_b
    cmp x12, #1
    b.eq .L\name\()_h
    // size == 2: S narrow (D+D→S)
    cbz x17, .L\name\()_s_lo
    \op\()2 v2.4s, v0.2d, v1.2d
    b .L\name\()_store
.L\name\()_s_lo:
    \op v2.2s, v0.2d, v1.2d
    b .L\name\()_store_lo

.L\name\()_b:
    // size == 0: B narrow (H+H→B)
    cbz x17, .L\name\()_b_lo
    \op\()2 v2.16b, v0.8h, v1.8h
    b .L\name\()_store
.L\name\()_b_lo:
    \op v2.8b, v0.8h, v1.8h
    b .L\name\()_store_lo

.L\name\()_h:
    // size == 1: H narrow (S+S→H)
    cbz x17, .L\name\()_h_lo
    \op\()2 v2.8h, v0.4s, v1.4s
    b .L\name\()_store
.L\name\()_h_lo:
    \op v2.4h, v0.4s, v1.4s
    // fall through

.L\name\()_store_lo:
    str d2, [x14]
    str xzr, [x14, #8]
    gret

.L\name\()_store:
    str q2, [x14]
    gret
.endm

make_narrowing_high addhn, addhn
make_narrowing_high subhn, subhn
make_narrowing_high raddhn, raddhn
make_narrowing_high rsubhn, rsubhn

/*
 * Macro: make_widening_accum  name, op
 * SABAL/UABAL/SMLAL/UMLAL/SMLSL/UMLSL (three-different accumulating)
 * Accumulate: Vd += op(Vn, Vm) with widening
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | size<<24 | Q<<26]
 * size: narrow source element size (0=B, 1=H, 2=S)
 * Q: 0=lower half, 1=upper half of narrow source
 */
.macro make_widening_accum name, op
.gadget \name\()_vec
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x12, x8, #24, #2   // size
    ubfx x17, x8, #26, #1   // Q

    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    lsl x16, x11, #4
    add x16, x13, x16       // &Vm

    ldr q0, [x14]           // Vd (accumulator, wide)
    ldr q1, [x15]           // Vn (narrow source)
    ldr q2, [x16]           // Vm (narrow source)

    cmp x12, #0
    b.eq .L\name\()_b
    cmp x12, #1
    b.eq .L\name\()_h
    // size == 2 (S->D)
    cbz x17, .L\name\()_s_lo
    \op\()2 v0.2d, v1.4s, v2.4s
    b .L\name\()_store
.L\name\()_s_lo:
    \op v0.2d, v1.2s, v2.2s
    b .L\name\()_store

.L\name\()_b:
    cbz x17, .L\name\()_b_lo
    \op\()2 v0.8h, v1.16b, v2.16b
    b .L\name\()_store
.L\name\()_b_lo:
    \op v0.8h, v1.8b, v2.8b
    b .L\name\()_store

.L\name\()_h:
    cbz x17, .L\name\()_h_lo
    \op\()2 v0.4s, v1.8h, v2.8h
    b .L\name\()_store
.L\name\()_h_lo:
    \op v0.4s, v1.4h, v2.4h
    // fall through

.L\name\()_store:
    str q0, [x14]
    gret
.endm

make_widening_accum sabal, sabal
make_widening_accum uabal, uabal
make_widening_accum smlal, smlal
make_widening_accum umlal, umlal
make_widening_accum smlsl, smlsl
make_widening_accum umlsl, umlsl

/*
 * Scalar two-register miscellaneous (integer, 64-bit only)
 * Compare-against-zero and unary operations on a single D register.
 * Code stream: [gadget addr][rd | rn<<8]
 */

// CMGT D, D, #0 — each element set to all-ones if > 0, else all-zeros
.gadget cmgt_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    ldr d0, [x15]
    cmgt d0, d0, #0
    str d0, [x14]
    str xzr, [x14, #8]      // clear upper 64 bits
    gret

// CMGE D, D, #0
.gadget cmge_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    ldr d0, [x15]
    cmge d0, d0, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// CMEQ D, D, #0
.gadget cmeq_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    ldr d0, [x15]
    cmeq d0, d0, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// CMLE D, D, #0
.gadget cmle_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    ldr d0, [x15]
    cmle d0, d0, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// CMLT D, D, #0
.gadget cmlt_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    ldr d0, [x15]
    cmlt d0, d0, #0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// ABS D, D — absolute value
.gadget abs_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    ldr d0, [x15]
    abs d0, d0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// NEG D, D — negate
.gadget neg_scalar
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    ldr d0, [x15]
    neg d0, d0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

/*
 * FP scalar two-register miscellaneous — compare against zero
 * Code stream: [gadget addr][rd | rn<<8 | sz<<16]
 * sz=0: single precision, sz=1: double precision
 */

// FCMGT S/D, S/D, #0.0
.gadget fcmgt_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x12, x8, #16, #1   // sz (0=single, 1=double)
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14       // &Vd
    lsl x15, x10, #4
    add x15, x13, x15       // &Vn
    cbnz x12, .Lfcmgt_scalar_zero_double
    ldr s0, [x15]
    fcmgt s0, s0, #0.0
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.Lfcmgt_scalar_zero_double:
    ldr d0, [x15]
    fcmgt d0, d0, #0.0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// FCMGE S/D, S/D, #0.0
.gadget fcmge_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x12, x8, #16, #1
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    cbnz x12, .Lfcmge_scalar_zero_double
    ldr s0, [x15]
    fcmge s0, s0, #0.0
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.Lfcmge_scalar_zero_double:
    ldr d0, [x15]
    fcmge d0, d0, #0.0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// FCMEQ S/D, S/D, #0.0
.gadget fcmeq_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x12, x8, #16, #1
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    cbnz x12, .Lfcmeq_scalar_zero_double
    ldr s0, [x15]
    fcmeq s0, s0, #0.0
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.Lfcmeq_scalar_zero_double:
    ldr d0, [x15]
    fcmeq d0, d0, #0.0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// FCMLE S/D, S/D, #0.0
.gadget fcmle_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x12, x8, #16, #1
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    cbnz x12, .Lfcmle_scalar_zero_double
    ldr s0, [x15]
    fcmle s0, s0, #0.0
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.Lfcmle_scalar_zero_double:
    ldr d0, [x15]
    fcmle d0, d0, #0.0
    str d0, [x14]
    str xzr, [x14, #8]
    gret

// FCMLT S/D, S/D, #0.0
.gadget fcmlt_scalar_zero
    ldr x8, [_pc]
    add _pc, _pc, #8
    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x12, x8, #16, #1
    add x13, _cpu, #CPU_fp
    lsl x14, x9, #4
    add x14, x13, x14
    lsl x15, x10, #4
    add x15, x13, x15
    cbnz x12, .Lfcmlt_scalar_zero_double
    ldr s0, [x15]
    fcmlt s0, s0, #0.0
    str s0, [x14]
    str xzr, [x14, #4]
    str xzr, [x14, #8]
    gret
.Lfcmlt_scalar_zero_double:
    ldr d0, [x15]
    fcmlt d0, d0, #0.0
    str d0, [x14]
    str xzr, [x14, #8]
    gret
