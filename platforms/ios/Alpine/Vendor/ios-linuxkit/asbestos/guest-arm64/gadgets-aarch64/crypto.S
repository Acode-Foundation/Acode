/*
 * ARM64 Cryptographic Extension Gadgets
 *
 * AES, SHA1, SHA256, and SHA512 gadgets use native .inst instructions
 * for near-native performance. Other crypto gadgets (EOR3, SM3, SM4,
 * PMULL, TBL/TBX, SVE) still use C helper functions.
 */

#include "gadgets.h"

.text

/*
 * AESE - AES single round encryption
 * Performs AddRoundKey, SubBytes, and ShiftRows
 * Code stream: [gadget addr][rd | rn<<8]
 *
 * Native AESE does XOR(Vd,Vn) then SubBytes+ShiftRows in one instruction
 */
.gadget aese
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn (round key)

    // Native AESE: v0 = SubBytes(ShiftRows(v0 XOR v1))
    .inst 0x4e284820         // aese v0.16b, v1.16b

    str q0, [x12, x13]

    gret

/*
 * AESD - AES single round decryption
 * Performs AddRoundKey, InvSubBytes, and InvShiftRows
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget aesd
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn

    // Native AESD: v0 = InvSubBytes(InvShiftRows(v0 XOR v1))
    .inst 0x4e285820         // aesd v0.16b, v1.16b

    str q0, [x12, x13]

    gret

/*
 * AESMC - AES MixColumns
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget aesmc
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    lsl x14, x10, #4
    ldr q0, [x12, x14]      // q0 = Vn

    // Native AESMC: v0 = MixColumns(v0)
    .inst 0x4e286800         // aesmc v0.16b, v0.16b

    str q0, [x12, x13]      // store to Vd

    gret

/*
 * AESIMC - AES Inverse MixColumns
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget aesimc
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    lsl x14, x10, #4
    ldr q0, [x12, x14]      // q0 = Vn

    // Native AESIMC: v0 = InvMixColumns(v0)
    .inst 0x4e287800         // aesimc v0.16b, v0.16b

    str q0, [x12, x13]      // store to Vd

    gret

/*
 * SHA1 instructions - native .inst implementations
 */

// SHA1H Sd, Sn - SHA1 fixed rotate
// Code stream: [gadget addr][rd | rn<<8]
.gadget sha1h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x14, x10, #4
    ldr s0, [x12, x14]      // s0 = Sn (32-bit scalar)

    // Native SHA1H: s0 = FixedRotate(s1)
    // Encoding: SHA1H Sd, Sn = 0101_1110_0010_1000_0000_10nn_nnnd_dddd
    // sha1h s0, s0 → 0x5e280800
    .inst 0x5e280800         // sha1h s0, s0

    // Store s0 to Sd and clear upper bits
    lsl x13, x9, #4
    add x15, x12, x13
    str s0, [x15]            // store 32-bit result
    str xzr, [x15, #4]      // clear bits 32-63
    str xzr, [x15, #8]      // clear bits 64-127

    gret

// SHA1C Qd, Sn, Vm.4S - SHA1 hash update (Choose)
// Code stream: [gadget addr][rd | rn<<8 | rm<<16]
.gadget sha1c
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Qd
    lsl x14, x10, #4
    ldr s1, [x12, x14]      // s1 = Sn (32-bit hash state)
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm.4S

    .inst 0x5e020020         // sha1c q0, s1, v2.4s

    str q0, [x12, x13]      // store result to Qd

    gret

// SHA1M Qd, Sn, Vm.4S - SHA1 hash update (Majority)
.gadget sha1m
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Qd
    lsl x14, x10, #4
    ldr s1, [x12, x14]      // s1 = Sn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm.4S

    .inst 0x5e022020         // sha1m q0, s1, v2.4s

    str q0, [x12, x13]

    gret

// SHA1P Qd, Sn, Vm.4S - SHA1 hash update (Parity)
.gadget sha1p
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Qd
    lsl x14, x10, #4
    ldr s1, [x12, x14]      // s1 = Sn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm.4S

    .inst 0x5e021020         // sha1p q0, s1, v2.4s

    str q0, [x12, x13]

    gret

// SHA1SU0 Vd.4S, Vn.4S, Vm.4S - SHA1 schedule update 0
.gadget sha1su0
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm

    .inst 0x5e023020         // sha1su0 v0.4s, v1.4s, v2.4s

    str q0, [x12, x13]

    gret

// SHA1SU1 Vd.4S, Vn.4S - SHA1 schedule update 1
.gadget sha1su1
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn

    .inst 0x5e281820         // sha1su1 v0.4s, v1.4s

    str q0, [x12, x13]

    gret

/*
 * SHA256 instructions
 */

// SHA256H Qd, Qn, Vm.4S
.gadget sha256h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Qd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Qn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm.4S

    .inst 0x5e024020         // sha256h q0, q1, v2.4s

    str q0, [x12, x13]

    gret

// SHA256H2 Qd, Qn, Vm.4S
.gadget sha256h2
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Qd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Qn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm.4S

    .inst 0x5e025020         // sha256h2 q0, q1, v2.4s

    str q0, [x12, x13]

    gret

// SHA256SU0 Vd.4S, Vn.4S
.gadget sha256su0
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn

    .inst 0x5e282820         // sha256su0 v0.4s, v1.4s

    str q0, [x12, x13]

    gret

// SHA256SU1 Vd.4S, Vn.4S, Vm.4S
.gadget sha256su1
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm

    .inst 0x5e026020         // sha256su1 v0.4s, v1.4s, v2.4s

    str q0, [x12, x13]

    gret

/*
 * SHA512SU0 Vd.2D, Vn.2D
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget sha512su0
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn

    add x12, _cpu, #CPU_fp

    // Load Vd, Vn from emulated register file
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn

    // Execute native SHA512SU0 instruction
    // SHA512SU0 V0.2D, V1.2D
    .inst 0xcec08020         // sha512su0 v0.2d, v1.2d

    // Store result back to Vd
    str q0, [x12, x13]

    gret

/*
 * SHA512SU1 Vd.2D, Vn.2D, Vm.2D
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sha512su1
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp

    // Load Vd, Vn, Vm from emulated register file
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm

    // Execute native SHA512SU1 instruction
    // SHA512SU1 V0.2D, V1.2D, V2.2D
    .inst 0xce628820         // sha512su1 v0.2d, v1.2d, v2.2d

    // Store result back to Vd
    str q0, [x12, x13]

    gret

/*
 * SHA512H Qd, Qn, Vm.2D
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sha512h
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp

    // Load Vd, Vn, Vm from emulated register file
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm

    // Execute native SHA512H instruction
    // SHA512H Qd, Qn, Vm.2D -> SHA512H Q0, Q1, V2.2D
    .inst 0xce628020         // sha512h q0, q1, v2.2d

    // Store result back to Vd
    str q0, [x12, x13]

    gret

/*
 * SHA512H2 Qd, Qn, Vm.2D
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sha512h2
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm

    add x12, _cpu, #CPU_fp

    // Load Vd, Vn, Vm from emulated register file
    lsl x13, x9, #4
    ldr q0, [x12, x13]      // q0 = Vd
    lsl x14, x10, #4
    ldr q1, [x12, x14]      // q1 = Vn
    lsl x15, x11, #4
    ldr q2, [x12, x15]      // q2 = Vm

    // Execute native SHA512H2 instruction
    // SHA512H2 Q0, Q1, V2.2D
    .inst 0xce628420         // sha512h2 q0, q1, v2.2d

    // Store result back to Vd
    str q0, [x12, x13]

    gret

/*
 * EOR3 Vd.16B, Vn.16B, Vm.16B, Va.16B
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | ra<<24]
 */
.gadget eor3
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5
    ubfx x12, x8, #24, #5

    add x13, _cpu, #CPU_fp

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    lsl x0, x9, #4
    add x0, x13, x0         // rd_ptr
    lsl x1, x10, #4
    add x1, x13, x1         // rn_ptr
    lsl x2, x11, #4
    add x2, x13, x2         // rm_ptr
    lsl x3, x12, #4
    add x3, x13, x3         // ra_ptr
    bl NAME(eor3_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * SM3PARTW1 Vd.4S, Vn.4S, Vm.4S
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sm3partw1
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5

    add x12, _cpu, #CPU_fp

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    lsl x0, x9, #4
    add x0, x12, x0         // rd_ptr
    lsl x1, x10, #4
    add x1, x12, x1         // rn_ptr
    lsl x2, x11, #4
    add x2, x12, x2         // rm_ptr
    bl NAME(sm3partw1_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * SM4E Vd.4S, Vn.4S
 * Code stream: [gadget addr][rd | rn<<8]
 */
.gadget sm4e
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5

    add x12, _cpu, #CPU_fp

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    lsl x0, x9, #4
    add x0, x12, x0         // rd_ptr
    lsl x1, x10, #4
    add x1, x12, x1         // rn_ptr
    bl NAME(sm4e_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * SVE EOR ZD.D, ZN.D, ZM.D (modeled as 128-bit vectors)
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16]
 */
.gadget sve_eor_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #5

    add x12, _cpu, #CPU_fp

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    lsl x0, x9, #4
    add x0, x12, x0         // rd_ptr
    lsl x1, x10, #4
    add x1, x12, x1         // rn_ptr
    lsl x2, x11, #4
    add x2, x12, x2         // rm_ptr
    bl NAME(sve_eor_d_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * SVE XAR ZD.D, ZD.D, ZM.D, #imm (modeled as 128-bit vectors)
 * Code stream: [gadget addr][rd | rn<<8 | imm<<16]
 */
.gadget sve_xar_d
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f
    ubfx x10, x8, #8, #5
    ubfx x11, x8, #16, #8   // imm

    add x12, _cpu, #CPU_fp

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    lsl x0, x9, #4
    add x0, x12, x0         // rd_ptr (also zn)
    lsl x1, x9, #4
    add x1, x12, x1         // zn_ptr (same as rd)
    lsl x2, x10, #4
    add x2, x12, x2         // zm_ptr
    mov w3, w11             // imm
    bl NAME(sve_xar_d_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * PMULL - Polynomial Multiply Long
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | Q<<24 | size<<26]
 */
.gadget pmull
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn
    ubfx x11, x8, #16, #5   // rm
    ubfx x21, x8, #24, #1   // Q
    ubfx x22, x8, #26, #2   // size

    add x12, _cpu, #CPU_fp

    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    save_c
    lsl x0, x9, #4
    add x0, x12, x0         // rd_ptr
    lsl x1, x10, #4
    add x1, x12, x1         // rn_ptr
    lsl x2, x11, #4
    add x2, x12, x2         // rm_ptr
    mov w3, w21             // Q
    mov w4, w22             // size
    bl NAME(pmull_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * TBL - Table lookup
 * TBL Vd.<Ta>, {Vn.16B...Vn+len.16B}, Vm.<Ta>
 *
 * Each byte of Vm is used as an index into the table formed by
 * Vn..Vn+len (concatenated). If index < table_size, the corresponding
 * byte is placed in Vd. Otherwise, 0 is placed in Vd.
 *
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | len<<24 | Q<<28]
 */
.gadget tbl
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn (first table register)
    ubfx x11, x8, #16, #5   // rm (indices)
    ubfx x20, x8, #24, #3   // len (0-3 means 1-4 registers)
    ubfx x21, x8, #28, #1   // Q (0=8B, 1=16B)

    add x12, _cpu, #CPU_fp

    // Save callee-saved registers
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    // Recalculate from saved x8 (clobbered by saves)
    and x19, x8, #0x1f       // rd
    ubfx x20, x8, #8, #5     // rn
    ubfx x21, x8, #16, #5    // rm
    ubfx x22, x8, #24, #3    // len
    ubfx x23, x8, #28, #1    // Q

    save_c
    // tbl_helper(rd_ptr, rn_ptr, rm_ptr, len, Q, fp_base)
    lsl x0, x19, #4
    add x0, x12, x0         // rd_ptr
    lsl x1, x20, #4
    add x1, x12, x1         // rn_ptr (table start)
    lsl x2, x21, #4
    add x2, x12, x2         // rm_ptr (indices)
    mov w3, w22             // len
    mov w4, w23             // Q
    mov x5, x12             // fp_base (for register wrap)
    bl NAME(tbl_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret

/*
 * TBX - Table lookup with extend
 * Same as TBL but out-of-range indices preserve the original Vd value
 * instead of being set to 0.
 *
 * Code stream: [gadget addr][rd | rn<<8 | rm<<16 | len<<24 | Q<<28]
 */
.gadget tbx
    ldr x8, [_pc]
    add _pc, _pc, #8

    and x9, x8, #0x1f       // rd
    ubfx x10, x8, #8, #5    // rn (first table register)
    ubfx x11, x8, #16, #5   // rm (indices)
    ubfx x20, x8, #24, #3   // len (0-3 means 1-4 registers)
    ubfx x21, x8, #28, #1   // Q (0=8B, 1=16B)

    add x12, _cpu, #CPU_fp

    // Save callee-saved registers
    stp x19, x20, [sp, #-0x60]!
    stp x21, x22, [sp, #0x10]
    stp x23, x24, [sp, #0x20]
    stp x25, x26, [sp, #0x30]
    stp x27, x28, [sp, #0x40]
    str lr, [sp, #0x50]

    // Recalculate from saved x8 (clobbered by saves)
    and x19, x8, #0x1f       // rd
    ubfx x20, x8, #8, #5     // rn
    ubfx x21, x8, #16, #5    // rm
    ubfx x22, x8, #24, #3    // len
    ubfx x23, x8, #28, #1    // Q

    save_c
    // tbx_helper(rd_ptr, rn_ptr, rm_ptr, len, Q, fp_base)
    lsl x0, x19, #4
    add x0, x12, x0         // rd_ptr
    lsl x1, x20, #4
    add x1, x12, x1         // rn_ptr (table start)
    lsl x2, x21, #4
    add x2, x12, x2         // rm_ptr (indices)
    mov w3, w22             // len
    mov w4, w23             // Q
    mov x5, x12             // fp_base (for register wrap)
    bl NAME(tbx_helper)
    restore_c

    ldr lr, [sp, #0x50]
    ldp x27, x28, [sp, #0x40]
    ldp x25, x26, [sp, #0x30]
    ldp x23, x24, [sp, #0x20]
    ldp x21, x22, [sp, #0x10]
    ldp x19, x20, [sp], #0x60

    gret
