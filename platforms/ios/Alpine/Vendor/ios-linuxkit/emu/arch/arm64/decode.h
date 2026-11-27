#ifndef EMU_ARCH_ARM64_DECODE_H
#define EMU_ARCH_ARM64_DECODE_H

#include "misc.h"
#include "emu/cpu.h"
#include "emu/tlb.h"

/*
 * ARM64 Instruction Decoding
 *
 * ARM64 uses fixed 4-byte (32-bit) instructions with regular top-level
 * encoding groups.
 *
 * Top-level encoding groups (bits 28:25):
 *   0000 - Reserved
 *   100x - Data processing (immediate)
 *   101x - Branches, exceptions, system
 *   x1x0 - Loads and stores
 *   x101 - Data processing (register)
 *   x111 - Data processing (SIMD and FP)
 */

// Instruction group extraction
#define ARM64_OP0(insn) (((insn) >> 25) & 0xf)

// Common field extractions
#define ARM64_RD(insn)  (((insn) >>  0) & 0x1f)  // Destination register
#define ARM64_RN(insn)  (((insn) >>  5) & 0x1f)  // First source register
#define ARM64_RM(insn)  (((insn) >> 16) & 0x1f)  // Second source register
#define ARM64_RT(insn)  (((insn) >>  0) & 0x1f)  // Transfer register (load/store)
#define ARM64_RT2(insn) (((insn) >> 10) & 0x1f)  // Second transfer register

// Instruction size (sf bit, bit 31)
#define ARM64_SF(insn)  (((insn) >> 31) & 0x1)   // 0=32-bit, 1=64-bit

// Condition codes (used in conditional branches, select, etc.)
enum arm64_cond {
    COND_EQ = 0,   // Equal (Z==1)
    COND_NE = 1,   // Not equal (Z==0)
    COND_CS = 2,   // Carry set / unsigned higher or same (C==1)
    COND_CC = 3,   // Carry clear / unsigned lower (C==0)
    COND_MI = 4,   // Minus / negative (N==1)
    COND_PL = 5,   // Plus / positive or zero (N==0)
    COND_VS = 6,   // Overflow (V==1)
    COND_VC = 7,   // No overflow (V==0)
    COND_HI = 8,   // Unsigned higher (C==1 && Z==0)
    COND_LS = 9,   // Unsigned lower or same (C==0 || Z==1)
    COND_GE = 10,  // Signed greater or equal (N==V)
    COND_LT = 11,  // Signed less than (N!=V)
    COND_GT = 12,  // Signed greater than (Z==0 && N==V)
    COND_LE = 13,  // Signed less or equal (Z==1 || N!=V)
    COND_AL = 14,  // Always
    COND_NV = 15,  // Always (same as AL)
};

// Evaluate a condition code against the current flags
static inline bool arm64_cond_check(struct cpu_state *cpu, enum arm64_cond cond) {
    bool result;
    switch (cond >> 1) {
        case 0: result = cpu->zf; break;                    // EQ/NE
        case 1: result = cpu->cf; break;                    // CS/CC
        case 2: result = cpu->nf; break;                    // MI/PL
        case 3: result = cpu->vf; break;                    // VS/VC
        case 4: result = cpu->cf && !cpu->zf; break;        // HI/LS
        case 5: result = cpu->nf == cpu->vf; break;         // GE/LT
        case 6: result = !cpu->zf && (cpu->nf == cpu->vf); break;  // GT/LE
        case 7: result = true; break;                       // AL/NV
        default: result = false; break;
    }
    // Invert result for odd condition codes (except AL/NV)
    if ((cond & 1) && cond != COND_AL && cond != COND_NV)
        result = !result;
    return result;
}

// Instruction type classification
enum arm64_insn_type {
    INSN_UNKNOWN = 0,
    INSN_DP_IMM,        // Data processing (immediate)
    INSN_BRANCH,        // Branches
    INSN_EXCEPTION,     // Exception generation
    INSN_SYSTEM,        // System instructions
    INSN_LD_ST,         // Loads and stores
    INSN_DP_REG,        // Data processing (register)
    INSN_SIMD_FP,       // SIMD and floating-point
};

// Classify an instruction by its top-level encoding
static inline enum arm64_insn_type arm64_classify_insn(uint32_t insn) {
    uint32_t op0 = ARM64_OP0(insn);

    switch (op0) {
        case 0b1000: case 0b1001:
            return INSN_DP_IMM;
        case 0b1010: case 0b1011:
            // Need to check bits 31-22 for specific type
            // System instructions: 1101_0101_00 (bits 31-22 = 0x354)
            if ((insn >> 22) == 0x354)
                return INSN_SYSTEM;
            // Exception generation: 1101_0100 (bits 31-24 = 0xd4)
            if ((insn >> 24) == 0xd4)
                return INSN_EXCEPTION;
            // Everything else is a branch
            return INSN_BRANCH;
        case 0b0100: case 0b0110: case 0b1100: case 0b1110:
            return INSN_LD_ST;
        case 0b0101: case 0b1101:
            return INSN_DP_REG;
        case 0b0111: case 0b1111:
            return INSN_SIMD_FP;
        default:
            return INSN_UNKNOWN;
    }
}

// Read a 32-bit instruction from memory
static inline bool arm64_read_insn(addr_t *ip, struct tlb *tlb, uint32_t *insn) {
    if (!tlb_read(tlb, *ip, insn, sizeof(*insn)))
        return false;
    *ip += 4;
    return true;
}

// Sign-extend a value
static inline int64_t arm64_sign_extend(uint64_t val, unsigned bits) {
    uint64_t sign_bit = 1ULL << (bits - 1);
    if (val & sign_bit)
        return (int64_t)(val | (~0ULL << bits));
    return (int64_t)val;
}

// Extract immediate from PC-relative branch instructions (26-bit signed offset)
static inline int64_t arm64_branch_imm26(uint32_t insn) {
    return arm64_sign_extend((insn & 0x03ffffff) << 2, 28);
}

// Extract immediate from conditional branch instructions (19-bit signed offset)
static inline int64_t arm64_branch_imm19(uint32_t insn) {
    return arm64_sign_extend(((insn >> 5) & 0x7ffff) << 2, 21);
}

// Extract immediate from test/compare-and-branch instructions (14-bit signed offset)
static inline int64_t arm64_branch_imm14(uint32_t insn) {
    return arm64_sign_extend(((insn >> 5) & 0x3fff) << 2, 16);
}

// Extract immediate from ADR/ADRP instructions
static inline int64_t arm64_adr_imm(uint32_t insn) {
    uint64_t immlo = (insn >> 29) & 0x3;
    uint64_t immhi = (insn >> 5) & 0x7ffff;
    return arm64_sign_extend((immhi << 2) | immlo, 21);
}

#endif
