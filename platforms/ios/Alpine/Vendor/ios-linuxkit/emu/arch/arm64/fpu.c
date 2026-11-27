/*
 * ARM64 NEON/FP support
 *
 * This provides basic floating-point and SIMD operations for ARM64 emulation.
 * ARM64 has 32 128-bit vector registers (V0-V31) which can be accessed as:
 *   - Q0-Q31: 128-bit quad-word
 *   - D0-D31: 64-bit double-word (low 64 bits of V registers)
 *   - S0-S31: 32-bit single-word (low 32 bits of V registers)
 *   - H0-H31: 16-bit half-word (low 16 bits of V registers)
 *   - B0-B31: 8-bit byte (low 8 bits of V registers)
 */

#include <math.h>
#include <string.h>
#include "emu/cpu.h"

// FPCR (Floating-point Control Register) bits
#define FPCR_FZ     (1 << 24)   // Flush-to-zero mode
#define FPCR_DN     (1 << 25)   // Default NaN mode
#define FPCR_AHP    (1 << 26)   // Alternative half-precision
#define FPCR_RMODE_SHIFT 22     // Rounding mode bits 23:22
#define FPCR_RMODE_MASK  0x3

// FPSR (Floating-point Status Register) bits
#define FPSR_IOC    (1 << 0)    // Invalid Operation cumulative
#define FPSR_DZC    (1 << 1)    // Division by Zero cumulative
#define FPSR_OFC    (1 << 2)    // Overflow cumulative
#define FPSR_UFC    (1 << 3)    // Underflow cumulative
#define FPSR_IXC    (1 << 4)    // Inexact cumulative
#define FPSR_IDC    (1 << 7)    // Input Denormal cumulative
#define FPSR_QC     (1 << 27)   // Cumulative saturation (SIMD)
#define FPSR_V      (1 << 28)   // Overflow flag
#define FPSR_C      (1 << 29)   // Carry flag
#define FPSR_Z      (1 << 30)   // Zero flag
#define FPSR_N      (1 << 31)   // Negative flag

// Rounding modes
enum arm64_rounding_mode {
    ROUND_TIEEVEN = 0,  // Round to nearest, ties to even
    ROUND_POSINF  = 1,  // Round towards +infinity
    ROUND_NEGINF  = 2,  // Round towards -infinity
    ROUND_ZERO    = 3,  // Round towards zero
};

// Get current rounding mode from FPCR
static inline enum arm64_rounding_mode arm64_get_rounding_mode(struct cpu_state *cpu) {
    return (cpu->fpcr >> FPCR_RMODE_SHIFT) & FPCR_RMODE_MASK;
}

// Initialize FP state
void arm64_fp_init(struct cpu_state *cpu) {
    memset(cpu->fp, 0, sizeof(cpu->fp));
    cpu->fpcr = 0;
    cpu->fpsr = 0;
}

// Clear all exception flags
void arm64_fp_clear_exceptions(struct cpu_state *cpu) {
    cpu->fpsr &= ~(FPSR_IOC | FPSR_DZC | FPSR_OFC | FPSR_UFC | FPSR_IXC | FPSR_IDC);
}

// Single-precision operations
void arm64_fadd_s(struct cpu_state *cpu, int rd, int rn, int rm) {
    float a = cpu->fp[rn].f32[0];
    float b = cpu->fp[rm].f32[0];
    float result = a + b;
    cpu->fp[rd].q = 0;  // Clear upper bits
    cpu->fp[rd].f32[0] = result;
}

void arm64_fsub_s(struct cpu_state *cpu, int rd, int rn, int rm) {
    float a = cpu->fp[rn].f32[0];
    float b = cpu->fp[rm].f32[0];
    float result = a - b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = result;
}

void arm64_fmul_s(struct cpu_state *cpu, int rd, int rn, int rm) {
    float a = cpu->fp[rn].f32[0];
    float b = cpu->fp[rm].f32[0];
    float result = a * b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = result;
}

void arm64_fdiv_s(struct cpu_state *cpu, int rd, int rn, int rm) {
    float a = cpu->fp[rn].f32[0];
    float b = cpu->fp[rm].f32[0];
    float result = a / b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = result;
}

void arm64_fsqrt_s(struct cpu_state *cpu, int rd, int rn) {
    float a = cpu->fp[rn].f32[0];
    float result = sqrtf(a);
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = result;
}

void arm64_fabs_s(struct cpu_state *cpu, int rd, int rn) {
    float a = cpu->fp[rn].f32[0];
    float result = fabsf(a);
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = result;
}

void arm64_fneg_s(struct cpu_state *cpu, int rd, int rn) {
    float a = cpu->fp[rn].f32[0];
    float result = -a;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = result;
}

// Double-precision operations
void arm64_fadd_d(struct cpu_state *cpu, int rd, int rn, int rm) {
    double a = cpu->fp[rn].f64[0];
    double b = cpu->fp[rm].f64[0];
    double result = a + b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

void arm64_fsub_d(struct cpu_state *cpu, int rd, int rn, int rm) {
    double a = cpu->fp[rn].f64[0];
    double b = cpu->fp[rm].f64[0];
    double result = a - b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

void arm64_fmul_d(struct cpu_state *cpu, int rd, int rn, int rm) {
    double a = cpu->fp[rn].f64[0];
    double b = cpu->fp[rm].f64[0];
    double result = a * b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

void arm64_fdiv_d(struct cpu_state *cpu, int rd, int rn, int rm) {
    double a = cpu->fp[rn].f64[0];
    double b = cpu->fp[rm].f64[0];
    double result = a / b;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

void arm64_fsqrt_d(struct cpu_state *cpu, int rd, int rn) {
    double a = cpu->fp[rn].f64[0];
    double result = sqrt(a);
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

void arm64_fabs_d(struct cpu_state *cpu, int rd, int rn) {
    double a = cpu->fp[rn].f64[0];
    double result = fabs(a);
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

void arm64_fneg_d(struct cpu_state *cpu, int rd, int rn) {
    double a = cpu->fp[rn].f64[0];
    double result = -a;
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = result;
}

// Floating-point compare and set flags
void arm64_fcmp_s(struct cpu_state *cpu, int rn, int rm) {
    float a = cpu->fp[rn].f32[0];
    float b = cpu->fp[rm].f32[0];

    if (isnan(a) || isnan(b)) {
        // Unordered
        cpu->nf = 0;
        cpu->zf = 0;
        cpu->cf = 1;
        cpu->vf = 1;
    } else if (a == b) {
        cpu->nf = 0;
        cpu->zf = 1;
        cpu->cf = 1;
        cpu->vf = 0;
    } else if (a < b) {
        cpu->nf = 1;
        cpu->zf = 0;
        cpu->cf = 0;
        cpu->vf = 0;
    } else {
        cpu->nf = 0;
        cpu->zf = 0;
        cpu->cf = 1;
        cpu->vf = 0;
    }
    arm64_sync_nzcv(cpu);
}

void arm64_fcmp_d(struct cpu_state *cpu, int rn, int rm) {
    double a = cpu->fp[rn].f64[0];
    double b = cpu->fp[rm].f64[0];

    if (isnan(a) || isnan(b)) {
        cpu->nf = 0;
        cpu->zf = 0;
        cpu->cf = 1;
        cpu->vf = 1;
    } else if (a == b) {
        cpu->nf = 0;
        cpu->zf = 1;
        cpu->cf = 1;
        cpu->vf = 0;
    } else if (a < b) {
        cpu->nf = 1;
        cpu->zf = 0;
        cpu->cf = 0;
        cpu->vf = 0;
    } else {
        cpu->nf = 0;
        cpu->zf = 0;
        cpu->cf = 1;
        cpu->vf = 0;
    }
    arm64_sync_nzcv(cpu);
}

// Conversions
void arm64_fcvtzs_s_w(struct cpu_state *cpu, int rd, int rn) {
    float a = cpu->fp[rn].f32[0];
    cpu->regs[rd] = (int32_t)truncf(a);
}

void arm64_fcvtzs_d_w(struct cpu_state *cpu, int rd, int rn) {
    double a = cpu->fp[rn].f64[0];
    cpu->regs[rd] = (int32_t)trunc(a);
}

void arm64_fcvtzs_s_x(struct cpu_state *cpu, int rd, int rn) {
    float a = cpu->fp[rn].f32[0];
    cpu->regs[rd] = (int64_t)truncf(a);
}

void arm64_fcvtzs_d_x(struct cpu_state *cpu, int rd, int rn) {
    double a = cpu->fp[rn].f64[0];
    cpu->regs[rd] = (int64_t)trunc(a);
}

void arm64_scvtf_w_s(struct cpu_state *cpu, int rd, int rn) {
    int32_t a = (int32_t)cpu->regs[rn];
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = (float)a;
}

void arm64_scvtf_x_s(struct cpu_state *cpu, int rd, int rn) {
    int64_t a = (int64_t)cpu->regs[rn];
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f32[0] = (float)a;
}

void arm64_scvtf_w_d(struct cpu_state *cpu, int rd, int rn) {
    int32_t a = (int32_t)cpu->regs[rn];
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = (double)a;
}

void arm64_scvtf_x_d(struct cpu_state *cpu, int rd, int rn) {
    int64_t a = (int64_t)cpu->regs[rn];
    cpu->fp[rd].q = 0;
    cpu->fp[rd].f64[0] = (double)a;
}

// Move between GP and FP registers
void arm64_fmov_s_w(struct cpu_state *cpu, int rd, int rn) {
    cpu->fp[rd].q = 0;
    cpu->fp[rd].s[0] = (uint32_t)cpu->regs[rn];
}

void arm64_fmov_d_x(struct cpu_state *cpu, int rd, int rn) {
    cpu->fp[rd].q = 0;
    cpu->fp[rd].d[0] = cpu->regs[rn];
}

void arm64_fmov_w_s(struct cpu_state *cpu, int rd, int rn) {
    cpu->regs[rd] = cpu->fp[rn].s[0];
}

void arm64_fmov_x_d(struct cpu_state *cpu, int rd, int rn) {
    cpu->regs[rd] = cpu->fp[rn].d[0];
}
