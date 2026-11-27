/*
 * ARM64 Guest Bit Manipulation Gadgets
 *
 * These gadgets implement bit manipulation and shift operations.
 */

#include "gadgets.h"

.text

/*
 * Shift operations (64-bit)
 */

// LSL Xd, Xn, Xm - Logical shift left
.gadget lsl64
    lsl _tmp, _tmp, _tmp2
    gret

// LSR Xd, Xn, Xm - Logical shift right
.gadget lsr64
    lsr _tmp, _tmp, _tmp2
    gret

// ASR Xd, Xn, Xm - Arithmetic shift right
.gadget asr64
    asr _tmp, _tmp, _tmp2
    gret

// ROR Xd, Xn, Xm - Rotate right
.gadget ror64
    ror _tmp, _tmp, _tmp2
    gret

/*
 * Shift operations (32-bit)
 */

.gadget lsl32
    lsl w0, w0, w8
    mov _tmp, x0
    gret

.gadget lsr32
    lsr w0, w0, w8
    mov _tmp, x0
    gret

.gadget asr32
    asr w0, w0, w8
    mov _tmp, x0
    gret

.gadget ror32
    ror w0, w0, w8
    mov _tmp, x0
    gret

/*
 * Bit field operations
 */

// BFM Xd, Xn, #immr, #imms - Bitfield move
.gadget bfm64
    // Complex operation, needs immediate encoding
    // TODO: Implement properly
    gret

// SBFM Xd, Xn, #immr, #imms - Signed bitfield move
.gadget sbfm64
    gret

// UBFM Xd, Xn, #immr, #imms - Unsigned bitfield move
.gadget ubfm64
    gret

// EXTR Xd, Xn, Xm, #lsb - Extract register
.gadget extr64
    // Concatenate Xn:Xm and extract bits
    gret

/*
 * Sign/zero extension
 */

// SXTB Xd, Wn - Sign extend byte
.gadget sxtb64
    sxtb _tmp, w0
    gret

.gadget sxtb32
    sxtb w0, w0
    mov _tmp, x0
    gret

// SXTH Xd, Wn - Sign extend halfword
.gadget sxth64
    sxth _tmp, w0
    gret

.gadget sxth32
    sxth w0, w0
    mov _tmp, x0
    gret

// SXTW Xd, Wn - Sign extend word
.gadget sxtw
    sxtw _tmp, w0
    gret

// UXTB Xd, Wn - Zero extend byte
.gadget uxtb
    uxtb w0, w0
    mov _tmp, x0
    gret

// UXTH Xd, Wn - Zero extend halfword
.gadget uxth
    uxth w0, w0
    mov _tmp, x0
    gret

/*
 * Bit counting operations
 */

// CLZ Xd, Xn - Count leading zeros
.gadget clz64
    clz _tmp, _tmp
    gret

.gadget clz32
    clz w0, w0
    mov _tmp, x0
    gret

// CLS Xd, Xn - Count leading sign bits
.gadget cls64
    cls _tmp, _tmp
    gret

.gadget cls32
    cls w0, w0
    mov _tmp, x0
    gret

// RBIT Xd, Xn - Reverse bits
.gadget rbit64
    rbit _tmp, _tmp
    gret

.gadget rbit32
    rbit w0, w0
    mov _tmp, x0
    gret

// REV Xd, Xn - Reverse bytes
.gadget rev64
    rev _tmp, _tmp
    gret

.gadget rev32
    rev w0, w0
    mov _tmp, x0
    gret

// REV16 Xd, Xn - Reverse bytes in halfwords
.gadget rev16_64
    rev16 _tmp, _tmp
    gret

.gadget rev16_32
    rev16 w0, w0
    mov _tmp, x0
    gret

// REV32 Xd, Xn - Reverse bytes in words (64-bit only)
.gadget rev32_64
    rev32 _tmp, _tmp
    gret
