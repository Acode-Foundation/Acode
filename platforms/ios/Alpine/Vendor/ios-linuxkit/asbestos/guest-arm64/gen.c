/*
 * ARM64 Guest Instruction Generator
 *
 * This file translates ARM64 guest instructions into gadget sequences
 * that can be executed by the asbestos JIT engine.
 *
 * ARM64 uses fixed-width 32-bit instructions. The instruction encoding
 * follows a consistent pattern based on the top 4 bits (op0 field).
 *
 * Return value convention:
 *   - return 1 (true): instruction compiled, continue with next instruction
 *   - return 0 (false): block ended (branch, syscall, or error)
 *
 * Gadget calling convention:
 *   - _cpu (x1) points to cpu_state
 *   - _tlb (x2) points to TLB
 *   - _pc (x28) is the gadget instruction pointer
 *   - Guest registers are accessed via memory at CPU_x0 + reg * 8
 */

#include <assert.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "asbestos/gen.h"
#include "emu/arch/arm64/decode.h"
#include "emu/interrupt.h"

// Gadget declarations
extern void gadget_interrupt(void);
extern void gadget_exit(void);
extern void gadget_set_pc(void);
extern void gadget_set_jit_saved_pc(void);
extern void gadget_trace(void);
extern void gadget_check_highbits(void);

static bool arm64_fusion_stats_enabled;
static bool arm64_internal_continue_enabled;
static bool arm64_internal_continue_taken_enabled;
static uint64_t arm64_fusion_cmp_bcond_count;
static uint64_t arm64_fusion_subs_bcond_count;
static uint64_t arm64_fusion_adrp_add_count;
static uint64_t arm64_fusion_adrp_ldr64_count;
static uint64_t arm64_fusion_addsub_fast_count;
static uint64_t arm64_fusion_addsub_cbz_count;
static uint64_t arm64_fusion_addsub_ldr64_count;
static uint64_t arm64_fusion_addsub_ldr32_count;
static uint64_t arm64_fusion_addsub_ldr16_count;
static uint64_t arm64_fusion_addsub_ldr8_count;
static uint64_t arm64_fusion_addsub_str64_count;
static uint64_t arm64_fusion_addsub_str32_count;
static uint64_t arm64_fusion_addsub_str16_count;
static uint64_t arm64_fusion_addsub_str8_count;
static uint64_t arm64_fusion_ldr64_cbz64_count;
static uint64_t arm64_fusion_ldr64_sp_cbz64_count;
static uint64_t arm64_fusion_ldr32_sx_cbz64_count;
static uint64_t arm64_fusion_ldr16_sx_cbz_count;
static uint64_t arm64_fusion_ldr8_sx_cbz_count;
static uint64_t arm64_fusion_ldr32_cbz32_count;
static uint64_t arm64_fusion_ldr16_cbz32_count;
static uint64_t arm64_fusion_ldr8_cbz32_count;
static uint64_t arm64_fusion_addsub_ldr_candidate_count;
static uint64_t arm64_fusion_addsub_str_candidate_count;
static uint64_t arm64_fusion_ldr_cbz_candidate_count;
static uint64_t arm64_fusion_ldr64_cbz64_candidate_count;
static uint64_t arm64_fusion_ldr64_sp_cbz64_candidate_count;
static uint64_t arm64_fusion_ldr32_sx_cbz64_candidate_count;
static uint64_t arm64_fusion_ldr16_sx_cbz_candidate_count;
static uint64_t arm64_fusion_ldr8_sx_cbz_candidate_count;
static uint64_t arm64_internal_continue_count;
static uint64_t arm64_internal_continue_bcond_fallthrough_count;
static uint64_t arm64_internal_continue_bcond_taken_count;
static uint64_t arm64_internal_continue_cbz_fallthrough_count;
static uint64_t arm64_internal_continue_cbz_taken_count;
static uint64_t arm64_internal_continue_tbz_fallthrough_count;
static uint64_t arm64_internal_continue_tbz_taken_count;
static bool arm64_fusion_stats_dumped;

void arm64_fusion_stats_dump_if_enabled(void) {
    if (!arm64_fusion_stats_enabled || arm64_fusion_stats_dumped)
        return;
    arm64_fusion_stats_dumped = true;
    fprintf(stderr,
            "ARM64_FUSION_STATS cmp_bcond=%llu subs_bcond=%llu adrp_add=%llu adrp_ldr64=%llu addsub_fast=%llu addsub_cbz=%llu addsub_ldr64=%llu addsub_ldr32=%llu addsub_ldr16=%llu addsub_ldr8=%llu addsub_str64=%llu addsub_str32=%llu addsub_str16=%llu addsub_str8=%llu ldr64_cbz64=%llu ldr64_sp_cbz64=%llu ldr32_sx_cbz64=%llu ldr16_sx_cbz=%llu ldr8_sx_cbz=%llu ldr32_cbz32=%llu ldr16_cbz32=%llu ldr8_cbz32=%llu addsub_ldr_cand=%llu addsub_str_cand=%llu ldr_cbz_cand=%llu ldr64_cbz64_cand=%llu ldr64_sp_cbz64_cand=%llu ldr32_sx_cbz64_cand=%llu ldr16_sx_cbz_cand=%llu ldr8_sx_cbz_cand=%llu internal_continue=%llu internal_continue_bcond_fallthrough=%llu internal_continue_bcond_taken=%llu internal_continue_cbz_fallthrough=%llu internal_continue_cbz_taken=%llu internal_continue_tbz_fallthrough=%llu internal_continue_tbz_taken=%llu\n",
            (unsigned long long)arm64_fusion_cmp_bcond_count,
            (unsigned long long)arm64_fusion_subs_bcond_count,
            (unsigned long long)arm64_fusion_adrp_add_count,
            (unsigned long long)arm64_fusion_adrp_ldr64_count,
            (unsigned long long)arm64_fusion_addsub_fast_count,
            (unsigned long long)arm64_fusion_addsub_cbz_count,
            (unsigned long long)arm64_fusion_addsub_ldr64_count,
            (unsigned long long)arm64_fusion_addsub_ldr32_count,
            (unsigned long long)arm64_fusion_addsub_ldr16_count,
            (unsigned long long)arm64_fusion_addsub_ldr8_count,
            (unsigned long long)arm64_fusion_addsub_str64_count,
            (unsigned long long)arm64_fusion_addsub_str32_count,
            (unsigned long long)arm64_fusion_addsub_str16_count,
            (unsigned long long)arm64_fusion_addsub_str8_count,
            (unsigned long long)arm64_fusion_ldr64_cbz64_count,
            (unsigned long long)arm64_fusion_ldr64_sp_cbz64_count,
            (unsigned long long)arm64_fusion_ldr32_sx_cbz64_count,
            (unsigned long long)arm64_fusion_ldr16_sx_cbz_count,
            (unsigned long long)arm64_fusion_ldr8_sx_cbz_count,
            (unsigned long long)arm64_fusion_ldr32_cbz32_count,
            (unsigned long long)arm64_fusion_ldr16_cbz32_count,
            (unsigned long long)arm64_fusion_ldr8_cbz32_count,
            (unsigned long long)arm64_fusion_addsub_ldr_candidate_count,
            (unsigned long long)arm64_fusion_addsub_str_candidate_count,
            (unsigned long long)arm64_fusion_ldr_cbz_candidate_count,
            (unsigned long long)arm64_fusion_ldr64_cbz64_candidate_count,
            (unsigned long long)arm64_fusion_ldr64_sp_cbz64_candidate_count,
            (unsigned long long)arm64_fusion_ldr32_sx_cbz64_candidate_count,
            (unsigned long long)arm64_fusion_ldr16_sx_cbz_candidate_count,
            (unsigned long long)arm64_fusion_ldr8_sx_cbz_candidate_count,
            (unsigned long long)arm64_internal_continue_count,
            (unsigned long long)arm64_internal_continue_bcond_fallthrough_count,
            (unsigned long long)arm64_internal_continue_bcond_taken_count,
            (unsigned long long)arm64_internal_continue_cbz_fallthrough_count,
            (unsigned long long)arm64_internal_continue_cbz_taken_count,
            (unsigned long long)arm64_internal_continue_tbz_fallthrough_count,
            (unsigned long long)arm64_internal_continue_tbz_taken_count);
    fflush(stderr);
}

void arm64_fusion_stats_set_enabled_from_env(const char *env) {
    arm64_fusion_stats_enabled = env != NULL && env[0] != '\0' && strcmp(env, "0") != 0;
}

void arm64_internal_continue_set_enabled_from_env(const char *env) {
    arm64_internal_continue_enabled = env != NULL && env[0] != '\0' && strcmp(env, "0") != 0;
}

void arm64_internal_continue_taken_set_enabled_from_env(const char *env) {
    arm64_internal_continue_taken_enabled = env != NULL && env[0] != '\0' && strcmp(env, "0") != 0;
}

#define ARM64_FUSION_STAT_INC(counter) do { \
    if (arm64_fusion_stats_enabled) \
        (counter)++; \
} while (0)

#define ARM64_INTERNAL_CONTINUE_STAT_INC(counter) do { \
    ARM64_FUSION_STAT_INC(arm64_internal_continue_count); \
    ARM64_FUSION_STAT_INC(counter); \
} while (0)

// Data processing gadgets
extern void gadget_load_reg(void);
extern void gadget_store_reg(void);
extern void gadget_store_addr_to_reg(void);  // Store _addr to guest register
extern void gadget_movz(void);
extern void gadget_movk(void);
extern void gadget_movn(void);
extern void gadget_add_imm(void);
extern void gadget_sub_imm(void);
extern void gadget_add_reg(void);
extern void gadget_sub_reg(void);
extern void gadget_adc_reg(void);
extern void gadget_sbc_reg(void);
extern void gadget_and_reg(void);
extern void gadget_orr_reg(void);
extern void gadget_orr_reg_shifted(void);
extern void gadget_and_reg_shifted(void);
extern void gadget_eor_reg_shifted(void);
extern void gadget_eor_reg(void);
extern void gadget_mov_reg(void);
extern void gadget_mov_reg32(void);
extern void gadget_and_imm(void);
extern void gadget_orr_imm(void);
extern void gadget_eor_imm(void);
extern void gadget_adr(void);
extern void gadget_adrp(void);
extern void gadget_fused_adrp_ldr64(void);
extern void gadget_sxtw(void);
extern void gadget_sxth(void);
extern void gadget_sxtb(void);
extern void gadget_uxtw(void);
extern void gadget_uxth(void);
extern void gadget_uxtb(void);
extern void gadget_ubfm(void);
extern void gadget_sbfm(void);
extern void gadget_ubfm_fused(void);
extern void gadget_sbfm_fused(void);
extern void gadget_bfm(void);
extern void gadget_extr(void);

// Branch gadgets
extern void gadget_branch(void);
extern void gadget_branch_link(void);
extern void gadget_branch_reg(void);
extern void gadget_branch_link_reg(void);
extern void gadget_ret(void);
extern void gadget_cbz(void);
extern void gadget_cbnz(void);
extern void gadget_cbz_64(void);
extern void gadget_cbz_32(void);
extern void gadget_cbnz_64(void);
extern void gadget_cbnz_32(void);
extern void gadget_cbz_fallthrough_internal(void);
extern void gadget_cbz_taken_internal(void);
extern void gadget_tbz(void);
extern void gadget_tbnz(void);
extern void gadget_tbz_fallthrough_internal(void);
extern void gadget_tbz_taken_internal(void);
extern void gadget_bcond(void);
extern void gadget_svc(void);

// Flag-setting gadgets
extern void gadget_subs_reg(void);
extern void gadget_adds_reg(void);

// Specialized ALU gadgets (64-bit fast paths)
extern void gadget_add_imm_64(void);
extern void gadget_sub_imm_64(void);
extern void gadget_add_imm_sp_src_64(void);
extern void gadget_sub_imm_sp_src_64(void);
extern void gadget_adds_imm_64(void);
extern void gadget_subs_imm_64(void);
extern void gadget_adds_imm_64_sh(void);
extern void gadget_subs_imm_64_sh(void);
extern void gadget_add_imm_64_sh(void);
extern void gadget_sub_imm_64_sh(void);
// 32-bit specialized add/sub immediate gadgets
extern void gadget_add_imm_32(void);
extern void gadget_sub_imm_32(void);
extern void gadget_adds_imm_32(void);
extern void gadget_subs_imm_32(void);
extern void gadget_fused_addsub_cbz(void);
extern void gadget_fused_addsub_cbnz(void);
extern void gadget_fused_addsub_ldr64_imm(void);
extern void gadget_fused_addsub_ldr32_imm(void);
extern void gadget_fused_addsub_ldr16_imm(void);
extern void gadget_fused_addsub_ldr8_imm(void);
extern void gadget_fused_addsub_str64_imm(void);
extern void gadget_fused_addsub_str32_imm(void);
extern void gadget_fused_addsub_str16_imm(void);
extern void gadget_fused_addsub_str8_imm(void);
extern void gadget_fused_ldr64_cbz_imm(void);
extern void gadget_fused_ldr64_cbnz_imm(void);
extern void gadget_fused_ldr64_sp_cbz_imm(void);
extern void gadget_fused_ldr64_sp_cbnz_imm(void);
extern void gadget_fused_ldr32_sx_cbz_imm(void);
extern void gadget_fused_ldr32_sx_cbnz_imm(void);
extern void gadget_fused_ldr_sx_cbz_imm(void);
extern void gadget_fused_ldr_sx_cbnz_imm(void);
extern void gadget_fused_ldr32_cbz_imm(void);
extern void gadget_fused_ldr32_cbnz_imm(void);
extern void gadget_fused_ldr16_cbz_imm(void);
extern void gadget_fused_ldr16_cbnz_imm(void);
extern void gadget_fused_ldr8_cbz_imm(void);
extern void gadget_fused_ldr8_cbnz_imm(void);
extern void gadget_adds_reg_64_nshift(void);
extern void gadget_subs_reg_64_nshift(void);
extern void gadget_add_reg_64_nshift(void);
extern void gadget_sub_reg_64_nshift(void);

// Per-condition bcond gadgets
extern void gadget_bcond_eq(void);
extern void gadget_bcond_ne(void);
extern void gadget_bcond_cs(void);
extern void gadget_bcond_cc(void);
extern void gadget_bcond_mi(void);
extern void gadget_bcond_pl(void);
extern void gadget_bcond_vs(void);
extern void gadget_bcond_vc(void);
extern void gadget_bcond_hi(void);
extern void gadget_bcond_ls(void);
extern void gadget_bcond_ge(void);
extern void gadget_bcond_lt(void);
extern void gadget_bcond_gt(void);
extern void gadget_bcond_le(void);
extern void gadget_bcond_fallthrough_internal(void);
extern void gadget_bcond_taken_internal(void);
extern void gadget_internal_continue(void);

// Fused CMP-imm + B.cond gadgets (rd=31, CMP only sets flags)
extern void gadget_fused_cmp_bcond_eq(void);
extern void gadget_fused_cmp_bcond_ne(void);
extern void gadget_fused_cmp_bcond_cs(void);
extern void gadget_fused_cmp_bcond_cc(void);
extern void gadget_fused_cmp_bcond_mi(void);
extern void gadget_fused_cmp_bcond_pl(void);
extern void gadget_fused_cmp_bcond_vs(void);
extern void gadget_fused_cmp_bcond_vc(void);
extern void gadget_fused_cmp_bcond_hi(void);
extern void gadget_fused_cmp_bcond_ls(void);
extern void gadget_fused_cmp_bcond_ge(void);
extern void gadget_fused_cmp_bcond_lt(void);
extern void gadget_fused_cmp_bcond_gt(void);
extern void gadget_fused_cmp_bcond_le(void);

// Fused SUBS-imm + B.cond gadgets (rd!=31, stores result AND sets flags)
extern void gadget_fused_subs_bcond_eq(void);
extern void gadget_fused_subs_bcond_ne(void);
extern void gadget_fused_subs_bcond_cs(void);
extern void gadget_fused_subs_bcond_cc(void);
extern void gadget_fused_subs_bcond_mi(void);
extern void gadget_fused_subs_bcond_pl(void);
extern void gadget_fused_subs_bcond_vs(void);
extern void gadget_fused_subs_bcond_vc(void);
extern void gadget_fused_subs_bcond_hi(void);
extern void gadget_fused_subs_bcond_ls(void);
extern void gadget_fused_subs_bcond_ge(void);
extern void gadget_fused_subs_bcond_lt(void);
extern void gadget_fused_subs_bcond_gt(void);
extern void gadget_fused_subs_bcond_le(void);

// 32-bit fused CMP-imm + B.cond gadgets (rd=31, 32-bit compare)
extern void gadget_fused_cmp32_bcond_eq(void);
extern void gadget_fused_cmp32_bcond_ne(void);
extern void gadget_fused_cmp32_bcond_cs(void);
extern void gadget_fused_cmp32_bcond_cc(void);
extern void gadget_fused_cmp32_bcond_mi(void);
extern void gadget_fused_cmp32_bcond_pl(void);
extern void gadget_fused_cmp32_bcond_vs(void);
extern void gadget_fused_cmp32_bcond_vc(void);
extern void gadget_fused_cmp32_bcond_hi(void);
extern void gadget_fused_cmp32_bcond_ls(void);
extern void gadget_fused_cmp32_bcond_ge(void);
extern void gadget_fused_cmp32_bcond_lt(void);
extern void gadget_fused_cmp32_bcond_gt(void);
extern void gadget_fused_cmp32_bcond_le(void);

// 32-bit fused SUBS-imm + B.cond gadgets (rd!=31, 32-bit subtract)
extern void gadget_fused_subs32_bcond_eq(void);
extern void gadget_fused_subs32_bcond_ne(void);
extern void gadget_fused_subs32_bcond_cs(void);
extern void gadget_fused_subs32_bcond_cc(void);
extern void gadget_fused_subs32_bcond_mi(void);
extern void gadget_fused_subs32_bcond_pl(void);
extern void gadget_fused_subs32_bcond_vs(void);
extern void gadget_fused_subs32_bcond_vc(void);
extern void gadget_fused_subs32_bcond_hi(void);
extern void gadget_fused_subs32_bcond_ls(void);
extern void gadget_fused_subs32_bcond_ge(void);
extern void gadget_fused_subs32_bcond_lt(void);
extern void gadget_fused_subs32_bcond_gt(void);
extern void gadget_fused_subs32_bcond_le(void);

// Conditional select
extern void gadget_csel(void);
extern void gadget_csinc(void);
extern void gadget_csinv(void);
extern void gadget_csneg(void);

// Conditional compare
extern void gadget_ccmp_reg(void);
extern void gadget_ccmn_reg(void);
extern void gadget_ccmp_imm(void);
extern void gadget_ccmn_imm(void);

// SIMD gadgets (minimal set for memset)
extern void gadget_dup_gpr_to_v16b(void);  // DUP Vd.16B, Wn
extern void gadget_dup_gpr_to_vec(void);   // DUP Vd.<T>, Wn (general - all element sizes)
extern void gadget_dup_elem_vec(void);     // DUP Vd.<T>, Vn.<Ts>[idx] (element to vector)
extern void gadget_dup_elem_scalar(void);  // DUP <V>d, Vn.<T>[idx] (element to scalar)
extern void gadget_ins_elem_vec(void);     // INS Vd.<T>[idx1], Vn.<T>[idx2] (element to element)
extern void gadget_mov_v_to_gpr(void);     // MOV Xd, Vn.D[0]
extern void gadget_umov_vec_to_gpr(void);  // UMOV/MOV Wd, Vn.<T>[idx]
extern void gadget_ins_gpr_to_vec_s(void); // MOV Vd.S[idx], Wn (INS from GPR)
extern void gadget_ins_gpr_to_vec_d(void); // MOV Vd.D[idx], Xn (INS from GPR)
extern void gadget_ins_gpr_to_vec_b(void); // MOV Vd.B[idx], Wn (INS from GPR, byte)
extern void gadget_ins_gpr_to_vec_h(void); // MOV Vd.H[idx], Wn (INS from GPR, halfword)
extern void gadget_str_q(void);            // STR Qn, [addr]
extern void gadget_stur_q(void);           // STUR Qn, [addr, #imm]
extern void gadget_stp_q(void);            // STP Qn, Qm, [addr]
extern void gadget_movi_v(void);           // MOVI/MVNI Vd, #imm
extern void gadget_set_vec_imm(void);      // Set vector immediate (raw 128-bit)
extern void gadget_orr_imm_vec(void);      // ORR Vd, #imm (vector)
extern void gadget_bic_imm_vec(void);      // BIC Vd, #imm (vector)
extern void gadget_ushl_vec(void);         // USHL Vd, Vn, Vm (vector shift left)
extern void gadget_sshl_vec(void);         // SSHL Vd, Vn, Vm (signed shift left)
extern void gadget_sshll_vec_s_to_d(void); // SSHLL Vd.2D, Vn.2S, #imm
extern void gadget_ushll_vec_s_to_d(void); // USHLL Vd.2D, Vn.2S, #imm
extern void gadget_sshll_vec_b_to_h(void); // SSHLL Vd.8H, Vn.8B, #imm
extern void gadget_ushll_vec_b_to_h(void); // USHLL Vd.8H, Vn.8B, #imm
extern void gadget_sshll_vec_h_to_s(void); // SSHLL Vd.4S, Vn.4H, #imm
extern void gadget_ushll_vec_h_to_s(void); // USHLL Vd.4S, Vn.4H, #imm
extern void gadget_sshll2_vec_b_to_h(void); // SSHLL2 Vd.8H, Vn.16B, #imm
extern void gadget_ushll2_vec_b_to_h(void); // USHLL2 Vd.8H, Vn.16B, #imm
extern void gadget_sshll2_vec_h_to_s(void); // SSHLL2 Vd.4S, Vn.8H, #imm
extern void gadget_ushll2_vec_h_to_s(void); // USHLL2 Vd.4S, Vn.8H, #imm
extern void gadget_sshll2_vec_s_to_d(void); // SSHLL2 Vd.2D, Vn.4S, #imm
extern void gadget_ushll2_vec_s_to_d(void); // USHLL2 Vd.2D, Vn.4S, #imm
extern void gadget_shll_vec_b_to_h(void);  // SHLL Vd.8H, Vn.8B, #8
extern void gadget_shll_vec_h_to_s(void);  // SHLL Vd.4S, Vn.4H, #16
extern void gadget_shll_vec_s_to_d(void);  // SHLL Vd.2D, Vn.2S, #32
extern void gadget_shll2_vec_b_to_h(void); // SHLL2 Vd.8H, Vn.16B, #8
extern void gadget_shll2_vec_h_to_s(void); // SHLL2 Vd.4S, Vn.8H, #16
extern void gadget_shll2_vec_s_to_d(void); // SHLL2 Vd.2D, Vn.4S, #32
extern void gadget_shl_imm_vec(void);      // SHL Vd, Vn, #imm (shift left immediate)
extern void gadget_shl_imm_scalar(void);   // SHL Dd, Dn, #imm (scalar shift left immediate)
extern void gadget_sshr_imm_vec(void);     // SSHR Vd, Vn, #imm (signed shift right immediate)
extern void gadget_sshr_imm_scalar(void);  // SSHR Dd, Dn, #imm (scalar signed shift right)
extern void gadget_ushr_imm_vec(void);     // USHR Vd, Vn, #imm (unsigned shift right immediate)
extern void gadget_ushr_imm_scalar(void);  // USHR Dd, Dn, #imm (scalar unsigned shift right)
extern void gadget_ssra_imm_vec(void);     // SSRA Vd, Vn, #imm (signed shift right and accumulate)
extern void gadget_ssra_imm_scalar(void);  // SSRA Dd, Dn, #imm (scalar signed shift right and accumulate)
extern void gadget_usra_imm_vec(void);     // USRA Vd, Vn, #imm (unsigned shift right and accumulate)
extern void gadget_usra_imm_scalar(void);  // USRA Dd, Dn, #imm (scalar unsigned shift right and accumulate)
extern void gadget_srshr_imm_vec(void);    // SRSHR Vd, Vn, #imm (signed rounding shift right)
extern void gadget_urshr_imm_vec(void);    // URSHR Vd, Vn, #imm (unsigned rounding shift right)
extern void gadget_srsra_imm_vec(void);    // SRSRA Vd, Vn, #imm (signed rounding shift right and accumulate)
extern void gadget_ursra_imm_vec(void);    // URSRA Vd, Vn, #imm (unsigned rounding shift right and accumulate)
extern void gadget_scvtf_fixpt_scalar(void);  // SCVTF Dd/Sd, Dn/Sn, #fbits (signed int to FP fixed-point)
extern void gadget_ucvtf_fixpt_scalar(void);  // UCVTF Dd/Sd, Dn/Sn, #fbits (unsigned int to FP fixed-point)
extern void gadget_fcvtzs_fixpt_scalar(void); // FCVTZS Dd/Sd, Dn/Sn, #fbits (FP to signed int fixed-point, SIMD)
extern void gadget_fcvtzu_fixpt_scalar(void); // FCVTZU Dd/Sd, Dn/Sn, #fbits (FP to unsigned int fixed-point, SIMD)
extern void gadget_fcvtzs_fixpt_gpr(void);    // FCVTZS Wd/Xd, Sn/Dn, #fbits (FP to signed int fixed-point, GPR)
extern void gadget_fcvtzu_fixpt_gpr(void);    // FCVTZU Wd/Xd, Sn/Dn, #fbits (FP to unsigned int fixed-point, GPR)
extern void gadget_scvtf_fixpt_gpr(void);     // SCVTF Sd/Dd, Wn/Xn, #fbits (signed int to FP fixed-point, GPR)
extern void gadget_ucvtf_fixpt_gpr(void);     // UCVTF Sd/Dd, Wn/Xn, #fbits (unsigned int to FP fixed-point, GPR)
extern void gadget_add_scalar_i64(void);      // ADD Dd, Dn, Dm (scalar 64-bit integer)
extern void gadget_sub_scalar_i64(void);      // SUB Dd, Dn, Dm (scalar 64-bit integer)
// FP vector three-same
extern void gadget_fp_fadd_vec(void);
extern void gadget_fp_fsub_vec(void);
extern void gadget_fp_fmul_vec(void);
extern void gadget_fp_fdiv_vec(void);
extern void gadget_fp_fmulx_vec(void);
extern void gadget_fp_fmla_vec(void);
extern void gadget_fp_fmls_vec(void);
extern void gadget_fp_fmax_vec(void);
extern void gadget_fp_fmin_vec(void);
extern void gadget_fp_fmaxnm_vec(void);
extern void gadget_fp_fminnm_vec(void);
extern void gadget_fp_faddp_vec(void);
extern void gadget_fp_fmaxp_vec(void);
extern void gadget_fp_fminp_vec(void);
extern void gadget_fp_frecps_vec(void);
extern void gadget_fp_frsqrts_vec(void);
extern void gadget_fp_fcmeq_vec(void);
extern void gadget_fp_fcmge_vec(void);
extern void gadget_fp_fcmgt_vec(void);
extern void gadget_fp_facge_vec(void);
extern void gadget_fp_facgt_vec(void);
extern void gadget_fp_fabd_vec(void);
// Integer vector three-same shifts
extern void gadget_srshl_vec(void);           // SRSHL Vd, Vn, Vm (signed rounding shift left)
extern void gadget_urshl_vec(void);           // URSHL Vd, Vn, Vm (unsigned rounding shift left)
extern void gadget_sqshl_vec(void);           // SQSHL Vd, Vn, Vm (signed saturating shift left)
extern void gadget_uqshl_vec(void);           // UQSHL Vd, Vn, Vm (unsigned saturating shift left)
extern void gadget_sqrshl_vec(void);          // SQRSHL Vd, Vn, Vm (signed saturating rounding shift left)
extern void gadget_uqrshl_vec(void);          // UQRSHL Vd, Vn, Vm (unsigned saturating rounding shift left)
extern void gadget_ushl_scalar_i64(void);     // USHL Dd, Dn, Dm (scalar unsigned shift left)
extern void gadget_sshl_scalar_i64(void);     // SSHL Dd, Dn, Dm (scalar signed shift left)
extern void gadget_cmhi_scalar_i64(void);     // CMHI Dd, Dn, Dm (scalar compare higher unsigned)
extern void gadget_cmhs_scalar_i64(void);     // CMHS Dd, Dn, Dm (scalar compare higher or same)
extern void gadget_cmgt_scalar_i64(void);     // CMGT Dd, Dn, Dm (scalar compare greater than)
extern void gadget_cmge_scalar_i64(void);     // CMGE Dd, Dn, Dm (scalar compare greater or equal)
extern void gadget_cmeq_scalar_i64(void);     // CMEQ Dd, Dn, Dm (scalar compare equal)
extern void gadget_sri_imm_vec(void);      // SRI Vd, Vn, #imm (shift right and insert)
extern void gadget_sli_imm_vec(void);      // SLI Vd, Vn, #imm (shift left and insert)
extern void gadget_cmhi_vec(void);         // CMHI Vd, Vn, Vm (unsigned compare greater)
extern void gadget_cmhs_vec(void);         // CMHS Vd, Vn, Vm (unsigned compare greater or equal)
extern void gadget_cmeq_vec(void);         // CMEQ Vd, Vn, Vm (compare equal)
extern void gadget_cmeq_zero_vec(void);    // CMEQ Vd, Vn, #0 (compare equal to zero)
extern void gadget_ld1r_vec(void);          // LD1R {Vt.T}, [Xn] (load single and replicate)
extern void gadget_ld2r_vec(void);          // LD2R {Vt.T, Vt2.T}, [Xn]
extern void gadget_ld3r_vec(void);          // LD3R {Vt.T, Vt2.T, Vt3.T}, [Xn]
extern void gadget_ld4r_vec(void);          // LD4R {Vt.T, Vt2.T, Vt3.T, Vt4.T}, [Xn]
extern void gadget_shrn_vec(void);          // SHRN/SHRN2 Vd, Vn, #shift (shift right narrow)
extern void gadget_rshrn_vec(void);         // RSHRN/RSHRN2 Vd, Vn, #shift (rounding shift right narrow)
extern void gadget_uqrshrn_vec(void);      // UQRSHRN - unsigned saturating rounding shift right narrow
extern void gadget_sqrshrn_vec(void);      // SQRSHRN - signed saturating rounding shift right narrow
extern void gadget_uqshrn_vec(void);       // UQSHRN - unsigned saturating shift right narrow
extern void gadget_sqshrn_vec(void);       // SQSHRN - signed saturating shift right narrow
extern void gadget_sqshrun_vec(void);      // SQSHRUN - signed saturating shift right unsigned narrow
extern void gadget_sqrshrun_vec(void);     // SQRSHRUN - signed saturating rounding shift right unsigned narrow
extern void gadget_uaddlp_vec(void);       // UADDLP Vd, Vn (unsigned add long pairwise)
extern void gadget_saddlp_vec(void);       // SADDLP Vd, Vn (signed add long pairwise)
extern void gadget_uadalp_vec(void);       // UADALP Vd, Vn (unsigned add and accumulate long pairwise)
extern void gadget_sadalp_vec(void);       // SADALP Vd, Vn (signed add and accumulate long pairwise)
extern void gadget_sqxtun_vec(void);       // SQXTUN Vd, Vn (signed sat extract unsigned narrow)
extern void gadget_sqxtn_vec(void);        // SQXTN Vd, Vn (signed sat extract narrow)
extern void gadget_uqxtn_vec(void);        // UQXTN Vd, Vn (unsigned sat extract narrow)
extern void gadget_cmgt_zero_vec(void);    // CMGT Vd, Vn, #0 (compare greater than zero)
extern void gadget_cmge_zero_vec(void);    // CMGE Vd, Vn, #0 (compare greater or equal zero)
extern void gadget_cmlt_zero_vec(void);    // CMLT Vd, Vn, #0 (compare less than zero)
extern void gadget_cmle_zero_vec(void);    // CMLE Vd, Vn, #0 (compare less or equal zero)
extern void gadget_and_vec(void);          // AND Vd, Vn, Vm (bitwise AND)
extern void gadget_orr_vec(void);          // ORR Vd, Vn, Vm (bitwise OR)
extern void gadget_eor_vec(void);          // EOR Vd, Vn, Vm (bitwise XOR)
extern void gadget_bic_vec(void);          // BIC Vd, Vn, Vm (bit clear)
extern void gadget_bsl_vec(void);          // BSL Vd, Vn, Vm (bitwise select)
extern void gadget_bit_vec(void);          // BIT Vd, Vn, Vm (bitwise insert)
extern void gadget_bif_vec(void);          // BIF Vd, Vn, Vm (bitwise insert if false)
extern void gadget_addp_vec(void);         // ADDP Vd, Vn, Vm (add pairwise)
extern void gadget_umaxp_vec(void);        // UMAXP Vd, Vn, Vm (unsigned max pairwise)
extern void gadget_uminp_vec(void);        // UMINP Vd, Vn, Vm (unsigned min pairwise)
extern void gadget_smaxp_vec(void);        // SMAXP Vd, Vn, Vm (signed max pairwise)
extern void gadget_sminp_vec(void);        // SMINP Vd, Vn, Vm (signed min pairwise)
extern void gadget_sqdmulh_vec(void);      // SQDMULH Vd, Vn, Vm (signed sat doubling mul high)
extern void gadget_sqrdmulh_vec(void);     // SQRDMULH Vd, Vn, Vm (signed sat rounding doubling mul high)
extern void gadget_abs_vec(void);          // ABS Vd, Vn (absolute value)
extern void gadget_neg_vec(void);          // NEG Vd, Vn (negate)
extern void gadget_clz_vec(void);          // CLZ Vd, Vn (count leading zeros)
extern void gadget_cls_vec(void);          // CLS Vd, Vn (count leading sign bits)
extern void gadget_not_vec(void);          // NOT Vd, Vn (bitwise NOT, bytes only)
extern void gadget_rbit_vec(void);         // RBIT Vd, Vn (reverse bits, bytes only)
extern void gadget_mul_vec(void);          // MUL Vd, Vn, Vm (integer multiply)
extern void gadget_pmul_vec(void);         // PMUL Vd.16B, Vn.16B, Vm.16B (polynomial multiply)
extern void gadget_mla_vec(void);          // MLA Vd, Vn, Vm (multiply-accumulate)
extern void gadget_mls_vec(void);          // MLS Vd, Vn, Vm (multiply-subtract)
extern void gadget_smax_vec(void);         // SMAX Vd, Vn, Vm (signed maximum)
extern void gadget_umax_vec(void);         // UMAX Vd, Vn, Vm (unsigned maximum)
extern void gadget_smin_vec(void);         // SMIN Vd, Vn, Vm (signed minimum)
extern void gadget_umin_vec(void);         // UMIN Vd, Vn, Vm (unsigned minimum)
extern void gadget_mul_elem_vec(void);     // MUL Vd, Vn, Vm[idx] (multiply by element)
extern void gadget_mla_elem_vec(void);     // MLA Vd, Vn, Vm[idx] (multiply-accumulate by element)
extern void gadget_mls_elem_vec(void);     // MLS Vd, Vn, Vm[idx] (multiply-subtract by element)
extern void gadget_smull_elem_vec(void);   // SMULL Vd, Vn, Vm[idx] (signed multiply long by element)
extern void gadget_umull_elem_vec(void);   // UMULL Vd, Vn, Vm[idx] (unsigned multiply long by element)
extern void gadget_smlal_elem_vec(void);   // SMLAL Vd, Vn, Vm[idx] (signed multiply-accumulate long by element)
extern void gadget_umlal_elem_vec(void);   // UMLAL Vd, Vn, Vm[idx] (unsigned multiply-accumulate long by element)
extern void gadget_smlsl_elem_vec(void);   // SMLSL Vd, Vn, Vm[idx] (signed multiply-subtract long by element)
extern void gadget_umlsl_elem_vec(void);   // UMLSL Vd, Vn, Vm[idx] (unsigned multiply-subtract long by element)
extern void gadget_fmul_elem_vec(void);    // FMUL Vd, Vn, Vm[idx] (FP multiply by element)
extern void gadget_fmla_elem_vec(void);    // FMLA Vd, Vn, Vm[idx] (FP multiply-accumulate by element)
extern void gadget_fmls_elem_vec(void);    // FMLS Vd, Vn, Vm[idx] (FP multiply-subtract by element)
extern void gadget_fmul_elem_scalar(void); // FMUL Sd/Dd, Sn/Dn, Vm[idx] (scalar FP mul by element)
extern void gadget_fmla_elem_scalar(void); // FMLA Sd/Dd, Sn/Dn, Vm[idx] (scalar FP mul-accum by element)
extern void gadget_fmls_elem_scalar(void); // FMLS Sd/Dd, Sn/Dn, Vm[idx] (scalar FP mul-sub by element)
extern void gadget_fmulx_elem_scalar(void);// FMULX Sd/Dd, Sn/Dn, Vm[idx] (scalar FP mulx by element)
extern void gadget_sqdmulh_elem_vec(void); // SQDMULH Vd, Vn, Vm[idx] (sat doubling mul high by element)
extern void gadget_sqrdmulh_elem_vec(void);// SQRDMULH Vd, Vn, Vm[idx] (sat rounding doubling mul high by element)
extern void gadget_sqdmull_elem_vec(void); // SQDMULL Vd, Vn, Vm[idx] (sat doubling mul long by element)
extern void gadget_sqdmlal_elem_vec(void); // SQDMLAL Vd, Vn, Vm[idx] (sat doubling mul-accum long by element)
extern void gadget_sqdmlsl_elem_vec(void); // SQDMLSL Vd, Vn, Vm[idx] (sat doubling mul-subtract long by element)
extern void gadget_sabd_vec(void);         // SABD Vd, Vn, Vm (signed abs diff)
extern void gadget_uabd_vec(void);         // UABD Vd, Vn, Vm (unsigned abs diff)
extern void gadget_cmtst_vec(void);        // CMTST Vd, Vn, Vm (compare bitwise test)
extern void gadget_aese(void);             // AESE Vd.16B, Vn.16B (AES encrypt)
extern void gadget_aesd(void);             // AESD Vd.16B, Vn.16B (AES decrypt)
extern void gadget_aesmc(void);            // AESMC Vd.16B, Vn.16B (AES mix columns)
extern void gadget_aesimc(void);           // AESIMC Vd.16B, Vn.16B (AES inverse mix columns)
extern void gadget_tbl(void);              // TBL Vd, {Vn..Vn+len}, Vm (table lookup)
extern void gadget_tbx(void);              // TBX Vd, {Vn..Vn+len}, Vm (table lookup extend)
extern void gadget_ext_vec(void);          // EXT Vd, Vn, Vm, #index (extract from pair)
extern void gadget_sha1c(void);            // SHA1C Qd, Sn, Vm.4S
extern void gadget_sha1h(void);            // SHA1H Sd, Sn
extern void gadget_sha1m(void);            // SHA1M Qd, Sn, Vm.4S
extern void gadget_sha1p(void);            // SHA1P Qd, Sn, Vm.4S
extern void gadget_sha1su0(void);          // SHA1SU0 Vd.4S, Vn.4S, Vm.4S
extern void gadget_sha1su1(void);          // SHA1SU1 Vd.4S, Vn.4S
extern void gadget_sha256h(void);          // SHA256H Qd, Qn, Vm.4S
extern void gadget_sha256h2(void);         // SHA256H2 Qd, Qn, Vm.4S
extern void gadget_sha256su0(void);        // SHA256SU0 Vd.4S, Vn.4S
extern void gadget_sha256su1(void);        // SHA256SU1 Vd.4S, Vn.4S, Vm.4S
extern void gadget_sha512su0(void);        // SHA512SU0 Vd.2D, Vn.2D
extern void gadget_sha512su1(void);        // SHA512SU1 Vd.2D, Vn.2D, Vm.2D
extern void gadget_sha512h(void);          // SHA512H Qd, Qn, Vm.2D
extern void gadget_sha512h2(void);         // SHA512H2 Qd, Qn, Vm.2D
extern void gadget_eor3(void);             // EOR3 Vd.16B, Vn.16B, Vm.16B, Va.16B
extern void gadget_sm3partw1(void);        // SM3PARTW1 Vd.4S, Vn.4S, Vm.4S
extern void gadget_sm4e(void);             // SM4E Vd.4S, Vn.4S
extern void gadget_sve_eor_d(void);        // SVE EOR Zd.D, Zn.D, Zm.D (128-bit modeled)
extern void gadget_sve_xar_d(void);        // SVE XAR Zd.D, Zd.D, Zm.D, #imm (128-bit modeled)
extern void gadget_pmull(void);            // PMULL Vd, Vn, Vm (polynomial multiply long)
extern void gadget_xtn_vec(void);          // XTN/XTN2 Vd, Vn (narrow)
extern void gadget_uzp1_vec(void);         // UZP1 Vd, Vn, Vm (unzip even elements)
extern void gadget_uzp2_vec(void);         // UZP2 Vd, Vn, Vm (unzip odd elements)
extern void gadget_trn1_vec(void);         // TRN1 Vd, Vn, Vm (transpose even)
extern void gadget_trn2_vec(void);         // TRN2 Vd, Vn, Vm (transpose odd)
extern void gadget_zip1_vec(void);         // ZIP1 Vd, Vn, Vm (zip lower halves)
extern void gadget_zip2_vec(void);         // ZIP2 Vd, Vn, Vm (zip upper halves)
extern void gadget_rev16_vec(void);        // REV16 Vd, Vn (reverse bytes in 16-bit elements)
extern void gadget_rev32_vec(void);        // REV32 Vd, Vn (reverse bytes in 32-bit elements)
extern void gadget_rev64_vec(void);        // REV64 Vd, Vn (reverse bytes in 64-bit elements)
extern void gadget_rbit_vec(void);         // RBIT Vd.xB, Vn.xB (reverse bits in each byte)
extern void gadget_cnt_vec(void);          // CNT Vd.xB, Vn.xB (count set bits per byte)
extern void gadget_addv_vec(void);         // ADDV Vd, Vn (add across vector lanes)
extern void gadget_saddlv_vec(void);       // SADDLV Vd, Vn (signed add long across vector)
extern void gadget_uaddlv_vec(void);       // UADDLV Vd, Vn (unsigned add long across vector)
extern void gadget_umaxv_vec(void);        // UMAXV Vd, Vn (unsigned max across vector)
extern void gadget_uminv_vec(void);        // UMINV Vd, Vn (unsigned min across vector)
extern void gadget_smaxv_vec(void);        // SMAXV Vd, Vn (signed max across vector)
extern void gadget_sminv_vec(void);        // SMINV Vd, Vn (signed min across vector)
extern void gadget_fmaxv_vec(void);       // FMAXV Sd, Vn.4S (FP max across vector)
extern void gadget_fminv_vec(void);       // FMINV Sd, Vn.4S (FP min across vector)
extern void gadget_fmaxnmv_vec(void);    // FMAXNMV Sd, Vn.4S (FP maxnum across vector)
extern void gadget_fminnmv_vec(void);    // FMINNMV Sd, Vn.4S (FP minnum across vector)
extern void gadget_add_vec(void);          // ADD Vd, Vn, Vm (vector add)
extern void gadget_sub_vec(void);          // SUB Vd, Vn, Vm (vector subtract)
extern void gadget_shadd_vec(void);        // SHADD Vd, Vn, Vm (signed halving add)
extern void gadget_uhadd_vec(void);        // UHADD Vd, Vn, Vm (unsigned halving add)
extern void gadget_srhadd_vec(void);       // SRHADD Vd, Vn, Vm (signed rounding halving add)
extern void gadget_urhadd_vec(void);       // URHADD Vd, Vn, Vm (unsigned rounding halving add)
extern void gadget_saddw_vec(void);        // SADDW Vd, Vn, Vm (signed add wide)
extern void gadget_uaddw_vec(void);        // UADDW Vd, Vn, Vm (unsigned add wide)
extern void gadget_saddl_vec(void);        // SADDL Vd, Vn, Vm (signed add long)
extern void gadget_uaddl_vec(void);        // UADDL Vd, Vn, Vm (unsigned add long)
extern void gadget_ssubl_vec(void);        // SSUBL Vd, Vn, Vm (signed sub long)
extern void gadget_usubl_vec(void);        // USUBL Vd, Vn, Vm (unsigned sub long)
extern void gadget_smull_vec(void);        // SMULL Vd, Vn, Vm (signed multiply long)
extern void gadget_umull_vec(void);        // UMULL Vd, Vn, Vm (unsigned multiply long)
extern void gadget_sabdl_vec(void);        // SABDL Vd, Vn, Vm (signed abs diff long)
extern void gadget_uabdl_vec(void);        // UABDL Vd, Vn, Vm (unsigned abs diff long)
extern void gadget_addhn_vec(void);        // ADDHN Vd, Vn, Vm (add returning high narrow)
extern void gadget_subhn_vec(void);        // SUBHN Vd, Vn, Vm (sub returning high narrow)
extern void gadget_raddhn_vec(void);       // RADDHN Vd, Vn, Vm (rounding add returning high narrow)
extern void gadget_rsubhn_vec(void);       // RSUBHN Vd, Vn, Vm (rounding sub returning high narrow)
extern void gadget_sabal_vec(void);        // SABAL Vd, Vn, Vm (signed abs diff accumulate long)
extern void gadget_uabal_vec(void);        // UABAL Vd, Vn, Vm (unsigned abs diff accumulate long)
extern void gadget_smlal_vec(void);        // SMLAL Vd, Vn, Vm (signed multiply-accumulate long)
extern void gadget_umlal_vec(void);        // UMLAL Vd, Vn, Vm (unsigned multiply-accumulate long)
extern void gadget_smlsl_vec(void);        // SMLSL Vd, Vn, Vm (signed multiply-subtract long)
extern void gadget_umlsl_vec(void);        // UMLSL Vd, Vn, Vm (unsigned multiply-subtract long)
extern void gadget_ssubw_vec(void);        // SSUBW Vd, Vn, Vm (signed subtract wide)
extern void gadget_usubw_vec(void);        // USUBW Vd, Vn, Vm (unsigned subtract wide)
extern void gadget_sqadd_vec(void);        // SQADD Vd, Vn, Vm (signed saturating add)
extern void gadget_uqadd_vec(void);        // UQADD Vd, Vn, Vm (unsigned saturating add)
extern void gadget_sqsub_vec(void);        // SQSUB Vd, Vn, Vm (signed saturating sub)
extern void gadget_uqsub_vec(void);        // UQSUB Vd, Vn, Vm (unsigned saturating sub)
extern void gadget_shsub_vec(void);        // SHSUB Vd, Vn, Vm (signed halving sub)
extern void gadget_uhsub_vec(void);        // UHSUB Vd, Vn, Vm (unsigned halving sub)
extern void gadget_cmgt_reg_vec(void);     // CMGT Vd, Vn, Vm (signed compare greater than)
extern void gadget_cmge_reg_vec(void);     // CMGE Vd, Vn, Vm (signed compare greater or equal)
extern void gadget_orn_vec(void);          // ORN Vd, Vn, Vm (bitwise OR NOT)
extern void gadget_saba_vec(void);         // SABA Vd, Vn, Vm (signed abs diff accumulate)
extern void gadget_uaba_vec(void);         // UABA Vd, Vn, Vm (unsigned abs diff accumulate)

// Vector FP two-register misc conversions
extern void gadget_scvtf_int_vec(void);    // SCVTF Vd.xS/Vd.2D, Vn.xS/Vn.2D (signed int to FP)
extern void gadget_ucvtf_int_vec(void);    // UCVTF Vd.xS/Vd.2D, Vn.xS/Vn.2D (unsigned int to FP)
extern void gadget_fcvtzs_int_vec(void);   // FCVTZS Vd.xS/Vd.2D, Vn.xS/Vn.2D (FP to signed int, toward zero)
extern void gadget_fcvtzu_int_vec(void);   // FCVTZU Vd.xS/Vd.2D, Vn.xS/Vn.2D (FP to unsigned int, toward zero)
extern void gadget_fcvtns_int_vec(void);   // FCVTNS (nearest, ties to even)
extern void gadget_fcvtnu_int_vec(void);   // FCVTNU (nearest, unsigned)
extern void gadget_fcvtms_int_vec(void);   // FCVTMS (toward -inf, signed)
extern void gadget_fcvtmu_int_vec(void);   // FCVTMU (toward -inf, unsigned)
extern void gadget_fcvtps_int_vec(void);   // FCVTPS (toward +inf, signed)
extern void gadget_fcvtpu_int_vec(void);   // FCVTPU (toward +inf, unsigned)
extern void gadget_fcvtas_int_vec(void);   // FCVTAS (ties away, signed)
extern void gadget_fcvtau_int_vec(void);   // FCVTAU (ties away, unsigned)
extern void gadget_frintn_vec_vec(void);   // FRINTN (round to nearest, ties to even)
extern void gadget_frinta_vec_vec(void);   // FRINTA (round to nearest, ties away)
extern void gadget_frintp_vec_vec(void);   // FRINTP (round toward +inf)
extern void gadget_frintm_vec_vec(void);   // FRINTM (round toward -inf)
extern void gadget_frintx_vec_vec(void);   // FRINTX (round to integral, exact)
extern void gadget_frintz_vec_vec(void);   // FRINTZ (round toward zero)
extern void gadget_frinti_vec_vec(void);   // FRINTI (round using FPCR rounding mode)
extern void gadget_fcvtn_vec(void);        // FCVTN/FCVTN2 (narrow FP conversion)
extern void gadget_fcvtl_vec(void);        // FCVTL/FCVTL2 (widen FP conversion)
extern void gadget_fcvtxn_vec(void);       // FCVTXN/FCVTXN2 (round-to-odd narrow conversion)
// Vector FP compare-with-zero
extern void gadget_fcmeq_zero_vec(void);   // FCMEQ Vd, Vn, #0.0
extern void gadget_fcmge_zero_vec(void);   // FCMGE Vd, Vn, #0.0
extern void gadget_fcmgt_zero_vec(void);   // FCMGT Vd, Vn, #0.0
extern void gadget_fcmle_zero_vec(void);   // FCMLE Vd, Vn, #0.0
extern void gadget_fcmlt_zero_vec(void);   // FCMLT Vd, Vn, #0.0
// Vector FP unary ops
extern void gadget_fabs_vec_vec(void);     // FABS Vd, Vn (vector absolute)
extern void gadget_fneg_vec_vec(void);     // FNEG Vd, Vn (vector negate)
extern void gadget_fsqrt_vec_vec(void);    // FSQRT Vd, Vn (vector square root)
extern void gadget_frecpe_vec_vec(void);   // FRECPE Vd, Vn (vector reciprocal estimate)
extern void gadget_frsqrte_vec_vec(void);  // FRSQRTE Vd, Vn (vector rsqrt estimate)
// Integer compare-with-zero
extern void gadget_cmeq_zero_vec(void);    // CMEQ Vd, Vn, #0

// Floating-point conversions
extern void gadget_ucvtf_scalar(void);     // UCVTF Sd, Wn / UCVTF Dd, Xn
extern void gadget_scvtf_scalar(void);     // SCVTF Sd, Wn / SCVTF Dd, Xn
extern void gadget_fcvtzu_scalar(void);    // FCVTZU Wd, Sn / FCVTZU Xd, Dn
extern void gadget_fcvtzs_scalar(void);    // FCVTZS Wd, Sn / FCVTZS Xd, Dn
extern void gadget_fcvtns_scalar(void);    // FCVTNS (round to nearest, ties to even)
extern void gadget_fcvtps_scalar(void);    // FCVTPS (round toward +inf)
extern void gadget_fcvtms_scalar(void);    // FCVTMS (round toward -inf)
extern void gadget_fcvtnu_scalar(void);    // FCVTNU (unsigned, round to nearest)
extern void gadget_fcvtpu_scalar(void);    // FCVTPU (unsigned, round toward +inf)
extern void gadget_fcvtmu_scalar(void);    // FCVTMU (unsigned, round toward -inf)
extern void gadget_fcvtas_scalar(void);    // FCVTAS (round to nearest, ties to away)
extern void gadget_fcvtau_scalar(void);    // FCVTAU (unsigned, ties to away)
extern void gadget_fcvtzs_simd_scalar(void); // FCVTZS Dd, Dn (SIMD scalar)
extern void gadget_fcvtzu_simd_scalar(void); // FCVTZU Dd, Dn (SIMD scalar)
extern void gadget_ucvtf_simd_scalar(void);  // UCVTF Sd, Sn / UCVTF Dd, Dn (SIMD scalar)
extern void gadget_scvtf_simd_scalar(void);  // SCVTF Sd, Sn / SCVTF Dd, Dn (SIMD scalar)
extern void gadget_fmov_gpr_to_fp(void);   // FMOV Sd, Wn / FMOV Dd, Xn
extern void gadget_fmov_gpr_to_fp_hi(void);   // FMOV Vd.D[1], Xn
extern void gadget_fmov_fp_to_gpr(void);   // FMOV Wd, Sn / FMOV Xd, Dn
extern void gadget_fmov_fp_to_gpr_hi(void);   // FMOV Xd, Vn.D[1]
extern void gadget_fmov_fp_to_fp(void);    // FMOV Sd, Sn / FMOV Dd, Dn (scalar reg copy)
extern void gadget_fmov_fp_imm(void);     // FMOV Sd/Dd, #imm (FP immediate)
extern void gadget_fcmp_scalar(void);      // FCMP/FCMPE Sn, Sm / Dn, Dm
extern void gadget_fcmp_zero_scalar(void); // FCMP/FCMPE Sn, #0.0 / Dn, #0.0
extern void gadget_fadd_scalar(void);      // FADD Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fsub_scalar(void);      // FSUB Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fmul_scalar(void);      // FMUL Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fdiv_scalar(void);      // FDIV Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fmax_scalar(void);      // FMAX Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fmin_scalar(void);      // FMIN Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fmaxnm_scalar(void);   // FMAXNM Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fminnm_scalar(void);   // FMINNM Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fnmul_scalar(void);     // FNMUL Sn, Sm, Sd / Dn, Dm, Dd
extern void gadget_fabd_scalar(void);      // FABD Sn, Sm, Sd / Dn, Dm, Dd (scalar)
extern void gadget_faddp_scalar(void);     // FADDP Sd, Vn.2S / Dd, Vn.2D (scalar pairwise add)
extern void gadget_fmaxp_scalar(void);    // FMAXP Sd, Vn.2S / Dd, Vn.2D (scalar pairwise max)
extern void gadget_fminp_scalar(void);    // FMINP Sd, Vn.2S / Dd, Vn.2D (scalar pairwise min)
extern void gadget_fmaxnmp_scalar(void);  // FMAXNMP Sd, Vn.2S / Dd, Vn.2D (scalar pairwise maxnum)
extern void gadget_fminnmp_scalar(void);  // FMINNMP Sd, Vn.2S / Dd, Vn.2D (scalar pairwise minnum)
extern void gadget_addp_scalar(void);      // ADDP Dd, Vn.2D (integer scalar pairwise add)
extern void gadget_cmgt_scalar_zero(void);  // CMGT Dd, Dn, #0 (scalar compare > 0)
extern void gadget_cmge_scalar_zero(void);  // CMGE Dd, Dn, #0 (scalar compare >= 0)
extern void gadget_cmeq_scalar_zero(void);  // CMEQ Dd, Dn, #0 (scalar compare == 0)
extern void gadget_cmle_scalar_zero(void);  // CMLE Dd, Dn, #0 (scalar compare <= 0)
extern void gadget_cmlt_scalar_zero(void);  // CMLT Dd, Dn, #0 (scalar compare < 0)
extern void gadget_abs_scalar(void);        // ABS Dd, Dn (scalar absolute value)
extern void gadget_neg_scalar(void);        // NEG Dd, Dn (scalar negate)
extern void gadget_fcmgt_scalar_zero(void); // FCMGT Sd/Dd, Sn/Dn, #0.0 (FP scalar compare > 0)
extern void gadget_fcmge_scalar_zero(void); // FCMGE Sd/Dd, Sn/Dn, #0.0 (FP scalar compare >= 0)
extern void gadget_fcmeq_scalar_zero(void); // FCMEQ Sd/Dd, Sn/Dn, #0.0 (FP scalar compare == 0)
extern void gadget_fcmle_scalar_zero(void); // FCMLE Sd/Dd, Sn/Dn, #0.0 (FP scalar compare <= 0)
extern void gadget_fcmlt_scalar_zero(void); // FCMLT Sd/Dd, Sn/Dn, #0.0 (FP scalar compare < 0)
extern void gadget_fp_dp1(void);           // FP single-source: FABS/FNEG/FSQRT/FRINT*/FCVT
extern void gadget_fcvt_h_to_s_scalar(void); // FCVT Sd, Hn
extern void gadget_fcvt_h_to_d_scalar(void); // FCVT Dd, Hn
extern void gadget_fccmp_scalar(void);     // FCCMP/FCCMPE (conditional FP compare)
extern void gadget_fcsel_scalar(void);     // FCSEL (conditional FP select)
extern void gadget_fmadd_scalar(void);     // FMADD Fd, Fn, Fm, Fa
extern void gadget_fmsub_scalar(void);     // FMSUB Fd, Fn, Fm, Fa
extern void gadget_fnmadd_scalar(void);    // FNMADD Fd, Fn, Fm, Fa
extern void gadget_fnmsub_scalar(void);    // FNMSUB Fd, Fn, Fm, Fa

// SIMD load/store gadgets (V bit set)
extern void gadget_str_simd_b(void);       // STR Bt, [Xn, #imm]
extern void gadget_str_simd_h(void);       // STR Ht, [Xn, #imm]
extern void gadget_str_simd_s(void);       // STR St, [Xn, #imm]
extern void gadget_str_simd_d(void);       // STR Dt, [Xn, #imm]
extern void gadget_str_simd_q(void);       // STR Qt, [Xn, #imm]
extern void gadget_ldr_simd_b(void);       // LDR Bt, [Xn, #imm]
extern void gadget_ldr_simd_h(void);       // LDR Ht, [Xn, #imm]
extern void gadget_ldr_simd_s(void);       // LDR St, [Xn, #imm]
extern void gadget_ldr_simd_d(void);       // LDR Dt, [Xn, #imm]
extern void gadget_ldr_simd_q(void);       // LDR Qt, [Xn, #imm]
extern void gadget_stp_simd_s(void);       // STP St, St2, [Xn, #imm]
extern void gadget_stp_simd_d(void);       // STP Dt, Dt2, [Xn, #imm]
extern void gadget_stp_simd_q(void);       // STP Qt, Qt2, [Xn, #imm]
extern void gadget_ldp_simd_s(void);       // LDP St, St2, [Xn, #imm]
extern void gadget_ldp_simd_d(void);       // LDP Dt, Dt2, [Xn, #imm]
extern void gadget_ldp_simd_q(void);       // LDP Qt, Qt2, [Xn, #imm]
// LD1/ST1 single structure (single element to/from lane)
extern void gadget_ld1_single_b(void);     // LD1 {Vt.B}[lane], [Xn]
extern void gadget_ld1_single_h(void);     // LD1 {Vt.H}[lane], [Xn]
extern void gadget_ld1_single_s(void);     // LD1 {Vt.S}[lane], [Xn]
extern void gadget_ld1_single_d(void);     // LD1 {Vt.D}[lane], [Xn]
extern void gadget_st1_single_b(void);     // ST1 {Vt.B}[lane], [Xn]
extern void gadget_st1_single_h(void);     // ST1 {Vt.H}[lane], [Xn]
extern void gadget_st1_single_s(void);     // ST1 {Vt.S}[lane], [Xn]
extern void gadget_st1_single_d(void);     // ST1 {Vt.D}[lane], [Xn]
extern void gadget_addr_add_imm(void);    // _addr += imm (for multi-element single structure)

// Decode ARM64 FP immediate encoding to IEEE bits.
// Encoding uses imm8 with bit6 inverted in the instruction encoding.
// Value is: (-1)^sign * (16+frac) * 2^(exp-7)
static uint64_t arm64_fpimm_to_bits(bool is_double, uint8_t imm8) {
    int sign = (imm8 >> 7) & 1;
    int exp = (imm8 >> 4) & 0x7;
    int frac = imm8 & 0xf;
    double value = (double)(16 + frac) / (double)(1 << (7 - exp));
    if (sign)
        value = -value;
    if (is_double) {
        union { double d; uint64_t u; } conv;
        conv.d = value;
        return conv.u;
    } else {
        union { float f; uint32_t u; } conv;
        conv.f = (float)value;
        return (uint64_t)conv.u;
    }
}

// Interleaved SIMD load/store gadgets (LD2/LD3/LD4, ST2/ST3/ST4)
extern void gadget_simd_load_interleaved(void);
extern void gadget_simd_store_interleaved(void);

// Address manipulation gadgets
extern void gadget_advance_addr(void);     // Add immediate to _addr
extern void gadget_update_base_reg(void);  // Update base register from Rm

// Multiply gadgets
extern void gadget_madd(void);
extern void gadget_msub(void);
extern void gadget_smaddl(void);
extern void gadget_smsubl(void);
extern void gadget_umaddl(void);
extern void gadget_umsubl(void);
extern void gadget_umulh(void);
extern void gadget_smulh(void);

// Data processing (2 source)
extern void gadget_udiv(void);
extern void gadget_sdiv(void);
extern void gadget_lslv(void);
extern void gadget_lsrv(void);
extern void gadget_asrv(void);
extern void gadget_rorv(void);
extern void gadget_crc32b(void);
extern void gadget_crc32h(void);
extern void gadget_crc32w(void);
extern void gadget_crc32x(void);
extern void gadget_crc32cb(void);
extern void gadget_crc32ch(void);
extern void gadget_crc32cw(void);
extern void gadget_crc32cx(void);
extern void gadget_lslv_64(void);
extern void gadget_lsrv_64(void);
extern void gadget_asrv_64(void);

// Add/subtract extended register
extern void gadget_add_ext(void);
extern void gadget_sub_ext(void);
extern void gadget_adds_ext(void);
extern void gadget_subs_ext(void);

// System register gadgets
extern void gadget_msr_tpidr(void);
extern void gadget_mrs_tpidr(void);
extern void gadget_mrs_sysreg(void);
extern void gadget_mrs_nzcv(void);
extern void gadget_msr_nzcv(void);
extern void gadget_msr_fpcr(void);
extern void gadget_msr_fpsr(void);
extern void gadget_msr_daif(void);
extern void gadget_dc_zva(void);

// Byte reverse and bit manipulation gadgets
extern void gadget_rev(void);
extern void gadget_rev16(void);
extern void gadget_rev32(void);
extern void gadget_clz(void);
extern void gadget_cls(void);
extern void gadget_rbit(void);

// System register IDs for gadget_mrs_sysreg
#define SYSREG_ID_TPIDR_EL0  0
#define SYSREG_ID_CTR_EL0    1
#define SYSREG_ID_DCZID_EL0  2
#define SYSREG_ID_FPCR       3
#define SYSREG_ID_FPSR       4
#define SYSREG_ID_RNDR       5   // Random Number (ARMv8.5-RNG)
#define SYSREG_ID_RNDRRS     6   // Reseeded Random Number (ARMv8.5-RNG)
#define SYSREG_ID_ID_AA64PFR0_EL1 7
#define SYSREG_ID_ID_AA64PFR1_EL1 8
#define SYSREG_ID_ID_AA64ISAR0_EL1 9
#define SYSREG_ID_ID_AA64ISAR1_EL1 10
#define SYSREG_ID_ID_AA64ZFR0_EL1 11
#define SYSREG_ID_CNTVCT_EL0    12  // Virtual counter timer
#define SYSREG_ID_CNTFRQ_EL0    13  // Counter frequency
#define SYSREG_ID_MIDR_EL1      14  // Main ID Register
#define SYSREG_ID_ZERO          15  // Known-readable feature/debug ID register with no advertised features

// Memory gadgets
extern void gadget_load64(void);
extern void gadget_load32(void);
extern void gadget_load16(void);
extern void gadget_load8(void);
extern void gadget_load32_sx(void);
extern void gadget_load16_sx32(void);
extern void gadget_load16_sx64(void);
extern void gadget_load8_sx32(void);
extern void gadget_load8_sx64(void);
extern void gadget_store64(void);
extern void gadget_store32(void);
extern void gadget_store16(void);
extern void gadget_store8(void);
extern void gadget_calc_addr_imm(void);
extern void gadget_calc_addr_reg(void);
extern void gadget_calc_addr_base(void);
extern void gadget_calc_addr_pc_rel(void);
// Fused load/store gadgets (calc_addr_imm + load/store + reg transfer in one dispatch)
extern void gadget_load64_imm(void);
extern void gadget_load32_imm(void);
extern void gadget_load16_imm(void);
extern void gadget_load8_imm(void);
extern void gadget_load32_sx_imm(void);
extern void gadget_load64_imm_fast(void);
extern void gadget_load32_imm_fast(void);
extern void gadget_load16_imm_fast(void);
extern void gadget_load8_imm_fast(void);
extern void gadget_store64_imm(void);
extern void gadget_store32_imm(void);
extern void gadget_store64_imm_fast(void);
extern void gadget_store32_imm_fast(void);
extern void gadget_store16_imm_fast(void);
extern void gadget_store8_imm_fast(void);
extern void gadget_store16_imm(void);
extern void gadget_store8_imm(void);
// Fused register-offset load/store gadgets (option=3/UXTX only)
extern void gadget_load64_reg(void);
extern void gadget_load32_reg(void);
extern void gadget_load16_reg(void);
extern void gadget_load8_reg(void);
extern void gadget_load32_sx_reg(void);
extern void gadget_store64_reg(void);
extern void gadget_store32_reg(void);
extern void gadget_store16_reg(void);
extern void gadget_store8_reg(void);
// LDXR/STXR exclusive gadgets
extern void gadget_ldxr(void);     // Load exclusive + save to monitor
extern void gadget_stxr(void);     // Store exclusive via atomic CAS
extern void gadget_update_base(void);
extern void gadget_writeback_addr(void);
// Atomic memory operation helpers
extern void gadget_atomic_rmw(void);
extern void gadget_atomic_cas(void);
extern void gadget_atomic_casp(void);

// Memory barrier/system-synchronization gadgets
extern void gadget_dmb(void);
extern void gadget_dsb(void);
extern void gadget_isb(void);
extern void gadget_clrex(void);
extern void gadget_ic_ivau(void); // invalidate translated code for a page (SMC)

// Load/store pair gadgets
extern void gadget_ldp64(void);
extern void gadget_ldp32(void);
extern void gadget_ldpsw(void);
extern void gadget_ldxp_c(void);
extern void gadget_stxp_c(void);
extern void gadget_stp64(void);
extern void gadget_stp32(void);
// Fused load/store pair with signed-offset addressing
extern void gadget_ldp64_imm(void);
extern void gadget_ldp32_imm(void);
extern void gadget_ldpsw_imm(void);
extern void gadget_stp64_imm(void);
extern void gadget_stp32_imm(void);
extern void gadget_ldp64_imm_fast(void);
extern void gadget_stp64_imm_fast(void);
extern void gadget_ldp32_imm_fast(void);
extern void gadget_ldpsw_imm_fast(void);
extern void gadget_stp32_imm_fast(void);
// SP-relative fused load/store gadgets (rn==31, rd/rt!=31)
extern void gadget_load64_sp_imm(void);
extern void gadget_load32_sp_imm(void);
extern void gadget_store64_sp_imm(void);
extern void gadget_store32_sp_imm(void);
// Fused ADRP+ADD gadget
extern void gadget_fused_adrp_add(void);
// Fused CMP_reg + B.cond gadgets (64-bit, rd=31)
extern void gadget_fused_cmp_reg_bcond_eq(void);
extern void gadget_fused_cmp_reg_bcond_ne(void);
extern void gadget_fused_cmp_reg_bcond_cs(void);
extern void gadget_fused_cmp_reg_bcond_cc(void);
extern void gadget_fused_cmp_reg_bcond_mi(void);
extern void gadget_fused_cmp_reg_bcond_pl(void);
extern void gadget_fused_cmp_reg_bcond_vs(void);
extern void gadget_fused_cmp_reg_bcond_vc(void);
extern void gadget_fused_cmp_reg_bcond_hi(void);
extern void gadget_fused_cmp_reg_bcond_ls(void);
extern void gadget_fused_cmp_reg_bcond_ge(void);
extern void gadget_fused_cmp_reg_bcond_lt(void);
extern void gadget_fused_cmp_reg_bcond_gt(void);
extern void gadget_fused_cmp_reg_bcond_le(void);
// Fused SUBS_reg + B.cond gadgets (64-bit, rd!=31)
extern void gadget_fused_subs_reg_bcond_eq(void);
extern void gadget_fused_subs_reg_bcond_ne(void);
extern void gadget_fused_subs_reg_bcond_cs(void);
extern void gadget_fused_subs_reg_bcond_cc(void);
extern void gadget_fused_subs_reg_bcond_mi(void);
extern void gadget_fused_subs_reg_bcond_pl(void);
extern void gadget_fused_subs_reg_bcond_vs(void);
extern void gadget_fused_subs_reg_bcond_vc(void);
extern void gadget_fused_subs_reg_bcond_hi(void);
extern void gadget_fused_subs_reg_bcond_ls(void);
extern void gadget_fused_subs_reg_bcond_ge(void);
extern void gadget_fused_subs_reg_bcond_lt(void);
extern void gadget_fused_subs_reg_bcond_gt(void);
extern void gadget_fused_subs_reg_bcond_le(void);

static void gen(struct gen_state *state, unsigned long thing) {
    assert(state->size <= state->capacity);
    if (state->size >= state->capacity) {
        state->capacity *= 2;
        struct fiber_block *new_block = realloc(state->block,
                sizeof(*new_block) + state->capacity * sizeof(unsigned long));
        if (new_block == NULL) {
            abort();
        }
        state->block = new_block;
    }
    state->block->code[state->size++] = thing;
}

static bool gen_record_internal_continue_patch(struct gen_state *state, unsigned patch_ip, unsigned target_ip) {
    if (state->internal_continue_count >= GEN_INTERNAL_CONTINUE_MAX)
        return false;
    unsigned i = state->internal_continue_count++;
    state->internal_continue_patch_ip[i] = patch_ip;
    state->internal_continue_target_ip[i] = target_ip;
    return true;
}

static bool gen_emit_internal_continue_record(struct gen_state *state, addr_t guest_pc) {
    if (state->internal_continue_count >= GEN_INTERNAL_CONTINUE_MAX)
        return false;
    gen(state, (unsigned long) gadget_internal_continue);
    gen(state, guest_pc);
    unsigned patch_ip = state->size;
    gen(state, 0);
    return gen_record_internal_continue_patch(state, patch_ip, state->size);
}

// Generate interrupt and end the block
static void gen_interrupt(struct gen_state *state, int interrupt_type) {
    // Set guest PC to the faulting instruction so signal handlers see the correct address
    gen(state, (unsigned long) gadget_set_pc);
    gen(state, state->orig_ip);
    gen(state, (unsigned long) gadget_interrupt);
    gen(state, interrupt_type);
}

void gen_start(addr_t addr, struct gen_state *state) {
    state->capacity = FIBER_BLOCK_INITIAL_CAPACITY;
    state->size = 0;
    state->ip = addr;
    state->last_insn = 0;
    state->b_follow_depth = 0;
    for (int i = 0; i <= 1; i++) {
        state->jump_ip[i] = 0;
    }
    state->block_patch_ip = 0;
    state->internal_continue_count = 0;
    state->internal_continue_used = 0;
    state->internal_continue_segment_start = 0;
    state->internal_continue_segment_budget = 0;
    for (int i = 0; i < GEN_INTERNAL_CONTINUE_MAX; i++) {
        state->internal_continue_patch_ip[i] = 0;
        state->internal_continue_target_ip[i] = 0;
    }

    struct fiber_block *block = malloc(sizeof(struct fiber_block) + state->capacity * sizeof(unsigned long));
    state->block = block;
    block->addr = addr;
}

void gen_end(struct gen_state *state) {
    struct fiber_block *block = state->block;
    for (int i = 0; i <= 1; i++) {
        if (state->jump_ip[i] != 0) {
            block->jump_ip[i] = &block->code[state->jump_ip[i]];
            block->old_jump_ip[i] = *block->jump_ip[i];
            block->jump_ip_is_fake[i] = true;
        } else {
            block->jump_ip[i] = NULL;
            block->jump_ip_is_fake[i] = false;
        }

        list_init(&block->jumps_from[i]);
        list_init(&block->jumps_from_links[i]);
    }
    if (state->block_patch_ip != 0) {
        block->code[state->block_patch_ip] = (unsigned long) block;
    }
    for (unsigned i = 0; i < state->internal_continue_count; i++) {
        block->code[state->internal_continue_patch_ip[i]] =
            (unsigned long) &block->code[state->internal_continue_target_ip[i]];
    }
    if (block->addr != state->ip)
        block->end_addr = state->ip - 1;
    else
        block->end_addr = block->addr;
    list_init(&block->chain);
    block->is_jetsam = false;
    for (int i = 0; i <= 1; i++) {
        list_init(&block->page[i]);
    }
}

void gen_exit(struct gen_state *state) {
    gen(state, (unsigned long) gadget_exit);
    gen(state, state->ip);
}

// Forward declarations
static int gen_dp_imm(struct gen_state *state, uint32_t insn);
static int gen_branch(struct gen_state *state, uint32_t insn);
static int gen_ldst(struct gen_state *state, uint32_t insn);
static int gen_dp_reg(struct gen_state *state, uint32_t insn);
static int gen_simd_fp(struct gen_state *state, uint32_t insn);

extern volatile bool g_trace_highbits;
extern bool asbestos_should_trace_guest_pc(addr_t pc);

static void gen_trace_pc(struct gen_state *state) {
    gen(state, (unsigned long)gadget_trace);
    gen(state, (uint64_t)state->orig_ip);
}

static void gen_trace_highbits(struct gen_state *state) {
    gen(state, (unsigned long)gadget_check_highbits);
    gen(state, (uint64_t)state->orig_ip);  // guest PC for this instruction
}

int gen_step(struct gen_state *state, struct tlb *tlb) {
    state->orig_ip = state->ip;
    state->orig_ip_extra = 0;
    state->tlb = tlb;

    uint32_t insn;
    if (!arm64_read_insn(&state->ip, tlb, &insn)) {
        gen_interrupt(state, INT_GPF);
        return 0;
    }
    state->last_insn = insn;

    // Handle a small subset of SVE/SVE2 instructions (modeled as 128-bit vectors).
    // Some PyPI musllinux aarch64 wheels contain unguarded SVE CNT* probes even
    // though the guest does not advertise SVE. Model a conservative 128-bit VL
    // so those probes can continue through baseline code paths.
    // SVE CNTB/CNTH/CNTW/CNTD Xdn, pattern, MUL #imm
    if ((insn & 0xff30e000) == 0x0420e000) {
        uint32_t rd = insn & 0x1f;
        uint32_t size = (insn >> 22) & 0x3; // 0=B, 1=H, 2=W, 3=D
        uint32_t mul = ((insn >> 16) & 0xf) + 1;
        uint32_t count = (16u >> size) * mul;
        if (rd != 31) {
            gen(state, (unsigned long) gadget_movz);
            gen(state, rd | ((uint64_t)count << 16) | (1ULL << 32));
        }
        return 1;
    }
    // SVE EOR Zd.D, Zn.D, Zm.D
    if ((insn & 0xffe0fc00) == 0x04a03000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        gen(state, (unsigned long) gadget_sve_eor_d);
        gen(state, rd | (rn << 8) | (rm << 16));
        return 1;
    }
    // SVE XAR Zd.D, Zd.D, Zm.D, #imm
    if ((insn & 0xffe0fc00) == 0x04e03400 || (insn & 0xffe0fc00) == 0x04a03400) {
        uint32_t rd = insn & 0x1f;
        uint32_t zm = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t imm_low = (32 - rm) & 0x1f;
        if (imm_low == 0) {
            imm_low = 32;
        }
        uint32_t imm = imm_low + (((insn >> 22) & 1) ? 0 : 32);
        gen(state, (unsigned long) gadget_sve_xar_d);
        gen(state, rd | (zm << 8) | (imm << 16));
        return 1;
    }

    enum arm64_insn_type type = arm64_classify_insn(insn);

    int result;
    switch (type) {
        case INSN_DP_IMM:
            result = gen_dp_imm(state, insn); break;
        case INSN_BRANCH:
        case INSN_EXCEPTION:
        case INSN_SYSTEM:
            result = gen_branch(state, insn); break;
        case INSN_LD_ST:
            result = gen_ldst(state, insn); break;
        case INSN_DP_REG:
            result = gen_dp_reg(state, insn); break;
        case INSN_SIMD_FP:
            result = gen_simd_fp(state, insn); break;
        default:
            gen_interrupt(state, INT_UNDEFINED);
            result = 0; break;
    }

    if (result == 1 && asbestos_should_trace_guest_pc(state->orig_ip))
        gen_trace_pc(state);
    if (result == 1 && g_trace_highbits)
        gen_trace_highbits(state);

    return result;
}

/*
 * Helper: Decode bitmask immediate
 * ARM64 uses a complex encoding for bitmask immediates.
 * Returns false if the encoding is invalid.
 */
static bool decode_bitmask_imm(uint32_t n, uint32_t imms, uint32_t immr, bool is64, uint64_t *result) {
    uint32_t len = 0;

    // Find the highest bit set in (n:~imms)
    uint32_t combined = (n << 6) | (~imms & 0x3f);
    for (int i = 6; i >= 0; i--) {
        if (combined & (1 << i)) {
            len = i;
            break;
        }
    }

    if (len < 1) return false;

    uint32_t size = 1 << len;
    uint32_t s = imms & (size - 1);
    uint32_t r = immr & (size - 1);

    if (s == size - 1) return false;

    // Create the base pattern
    uint64_t pattern = (1ULL << (s + 1)) - 1;

    // Rotate right (handle r=0 case to avoid shifting by size bits)
    if (r > 0) {
        pattern = (pattern >> r) | (pattern << (size - r));
        pattern &= (size < 64) ? ((1ULL << size) - 1) : ~0ULL;
    }

    // Replicate to 64 bits
    *result = 0;
    for (uint32_t i = 0; i < 64; i += size) {
        *result |= pattern << i;
    }

    if (!is64) {
        *result &= 0xFFFFFFFF;
    }

    return true;
}

// Expand Advanced SIMD modified immediate (integer) into a 64-bit pattern.
// Returns false if cmode is not supported.
static bool simd_modimm_pattern(uint32_t cmode, uint8_t imm8, uint64_t *pattern) {
    uint64_t elem;
    switch (cmode) {
        // 32-bit elements, shift 0/8/16/24
        case 0x0: case 0x2: case 0x4: case 0x6: {
            uint32_t shift = (cmode >> 1) * 8;
            elem = (uint64_t)imm8 << shift;
            *pattern = elem | (elem << 32);
            return true;
        }
        // 16-bit elements, shift 0/8
        case 0x8: case 0xa: {
            uint32_t shift = ((cmode >> 1) & 1) * 8;
            elem = (uint64_t)imm8 << shift;
            *pattern = elem | (elem << 16) | (elem << 32) | (elem << 48);
            return true;
        }
        // 8-bit elements
        case 0xe:
            elem = imm8;
            *pattern = elem * 0x0101010101010101ULL;
            return true;
        default:
            return false;
    }
}

/*
 * Peek at the next instruction without advancing state->ip.
 * Returns true if successful, false if read fails.
 */
static bool gen_peek_next_insn(struct gen_state *state, uint32_t *next_insn) {
    return tlb_read(state->tlb, state->ip, next_insn, sizeof(*next_insn));
}

/*
 * Fused CMP/SUBS + B.cond gadget tables (initialized lazily)
 */
static void *fused_cmp_bcond_gadgets[14];
static void *fused_subs_bcond_gadgets[14];
static void *fused_cmp32_bcond_gadgets[14];
static void *fused_subs32_bcond_gadgets[14];
static void *fused_cmp_reg_bcond_gadgets[14];
static void *fused_subs_reg_bcond_gadgets[14];
static bool fused_bcond_tables_init = false;

static void init_fused_bcond_tables(void) {
    if (fused_bcond_tables_init) return;
    fused_cmp_bcond_gadgets[0]  = gadget_fused_cmp_bcond_eq;
    fused_cmp_bcond_gadgets[1]  = gadget_fused_cmp_bcond_ne;
    fused_cmp_bcond_gadgets[2]  = gadget_fused_cmp_bcond_cs;
    fused_cmp_bcond_gadgets[3]  = gadget_fused_cmp_bcond_cc;
    fused_cmp_bcond_gadgets[4]  = gadget_fused_cmp_bcond_mi;
    fused_cmp_bcond_gadgets[5]  = gadget_fused_cmp_bcond_pl;
    fused_cmp_bcond_gadgets[6]  = gadget_fused_cmp_bcond_vs;
    fused_cmp_bcond_gadgets[7]  = gadget_fused_cmp_bcond_vc;
    fused_cmp_bcond_gadgets[8]  = gadget_fused_cmp_bcond_hi;
    fused_cmp_bcond_gadgets[9]  = gadget_fused_cmp_bcond_ls;
    fused_cmp_bcond_gadgets[10] = gadget_fused_cmp_bcond_ge;
    fused_cmp_bcond_gadgets[11] = gadget_fused_cmp_bcond_lt;
    fused_cmp_bcond_gadgets[12] = gadget_fused_cmp_bcond_gt;
    fused_cmp_bcond_gadgets[13] = gadget_fused_cmp_bcond_le;
    fused_subs_bcond_gadgets[0]  = gadget_fused_subs_bcond_eq;
    fused_subs_bcond_gadgets[1]  = gadget_fused_subs_bcond_ne;
    fused_subs_bcond_gadgets[2]  = gadget_fused_subs_bcond_cs;
    fused_subs_bcond_gadgets[3]  = gadget_fused_subs_bcond_cc;
    fused_subs_bcond_gadgets[4]  = gadget_fused_subs_bcond_mi;
    fused_subs_bcond_gadgets[5]  = gadget_fused_subs_bcond_pl;
    fused_subs_bcond_gadgets[6]  = gadget_fused_subs_bcond_vs;
    fused_subs_bcond_gadgets[7]  = gadget_fused_subs_bcond_vc;
    fused_subs_bcond_gadgets[8]  = gadget_fused_subs_bcond_hi;
    fused_subs_bcond_gadgets[9]  = gadget_fused_subs_bcond_ls;
    fused_subs_bcond_gadgets[10] = gadget_fused_subs_bcond_ge;
    fused_subs_bcond_gadgets[11] = gadget_fused_subs_bcond_lt;
    fused_subs_bcond_gadgets[12] = gadget_fused_subs_bcond_gt;
    fused_subs_bcond_gadgets[13] = gadget_fused_subs_bcond_le;
    // 32-bit variants
    fused_cmp32_bcond_gadgets[0]  = gadget_fused_cmp32_bcond_eq;
    fused_cmp32_bcond_gadgets[1]  = gadget_fused_cmp32_bcond_ne;
    fused_cmp32_bcond_gadgets[2]  = gadget_fused_cmp32_bcond_cs;
    fused_cmp32_bcond_gadgets[3]  = gadget_fused_cmp32_bcond_cc;
    fused_cmp32_bcond_gadgets[4]  = gadget_fused_cmp32_bcond_mi;
    fused_cmp32_bcond_gadgets[5]  = gadget_fused_cmp32_bcond_pl;
    fused_cmp32_bcond_gadgets[6]  = gadget_fused_cmp32_bcond_vs;
    fused_cmp32_bcond_gadgets[7]  = gadget_fused_cmp32_bcond_vc;
    fused_cmp32_bcond_gadgets[8]  = gadget_fused_cmp32_bcond_hi;
    fused_cmp32_bcond_gadgets[9]  = gadget_fused_cmp32_bcond_ls;
    fused_cmp32_bcond_gadgets[10] = gadget_fused_cmp32_bcond_ge;
    fused_cmp32_bcond_gadgets[11] = gadget_fused_cmp32_bcond_lt;
    fused_cmp32_bcond_gadgets[12] = gadget_fused_cmp32_bcond_gt;
    fused_cmp32_bcond_gadgets[13] = gadget_fused_cmp32_bcond_le;
    fused_subs32_bcond_gadgets[0]  = gadget_fused_subs32_bcond_eq;
    fused_subs32_bcond_gadgets[1]  = gadget_fused_subs32_bcond_ne;
    fused_subs32_bcond_gadgets[2]  = gadget_fused_subs32_bcond_cs;
    fused_subs32_bcond_gadgets[3]  = gadget_fused_subs32_bcond_cc;
    fused_subs32_bcond_gadgets[4]  = gadget_fused_subs32_bcond_mi;
    fused_subs32_bcond_gadgets[5]  = gadget_fused_subs32_bcond_pl;
    fused_subs32_bcond_gadgets[6]  = gadget_fused_subs32_bcond_vs;
    fused_subs32_bcond_gadgets[7]  = gadget_fused_subs32_bcond_vc;
    fused_subs32_bcond_gadgets[8]  = gadget_fused_subs32_bcond_hi;
    fused_subs32_bcond_gadgets[9]  = gadget_fused_subs32_bcond_ls;
    fused_subs32_bcond_gadgets[10] = gadget_fused_subs32_bcond_ge;
    fused_subs32_bcond_gadgets[11] = gadget_fused_subs32_bcond_lt;
    fused_subs32_bcond_gadgets[12] = gadget_fused_subs32_bcond_gt;
    fused_subs32_bcond_gadgets[13] = gadget_fused_subs32_bcond_le;
    // 64-bit register CMP/SUBS + B.cond
    fused_cmp_reg_bcond_gadgets[0]  = gadget_fused_cmp_reg_bcond_eq;
    fused_cmp_reg_bcond_gadgets[1]  = gadget_fused_cmp_reg_bcond_ne;
    fused_cmp_reg_bcond_gadgets[2]  = gadget_fused_cmp_reg_bcond_cs;
    fused_cmp_reg_bcond_gadgets[3]  = gadget_fused_cmp_reg_bcond_cc;
    fused_cmp_reg_bcond_gadgets[4]  = gadget_fused_cmp_reg_bcond_mi;
    fused_cmp_reg_bcond_gadgets[5]  = gadget_fused_cmp_reg_bcond_pl;
    fused_cmp_reg_bcond_gadgets[6]  = gadget_fused_cmp_reg_bcond_vs;
    fused_cmp_reg_bcond_gadgets[7]  = gadget_fused_cmp_reg_bcond_vc;
    fused_cmp_reg_bcond_gadgets[8]  = gadget_fused_cmp_reg_bcond_hi;
    fused_cmp_reg_bcond_gadgets[9]  = gadget_fused_cmp_reg_bcond_ls;
    fused_cmp_reg_bcond_gadgets[10] = gadget_fused_cmp_reg_bcond_ge;
    fused_cmp_reg_bcond_gadgets[11] = gadget_fused_cmp_reg_bcond_lt;
    fused_cmp_reg_bcond_gadgets[12] = gadget_fused_cmp_reg_bcond_gt;
    fused_cmp_reg_bcond_gadgets[13] = gadget_fused_cmp_reg_bcond_le;
    fused_subs_reg_bcond_gadgets[0]  = gadget_fused_subs_reg_bcond_eq;
    fused_subs_reg_bcond_gadgets[1]  = gadget_fused_subs_reg_bcond_ne;
    fused_subs_reg_bcond_gadgets[2]  = gadget_fused_subs_reg_bcond_cs;
    fused_subs_reg_bcond_gadgets[3]  = gadget_fused_subs_reg_bcond_cc;
    fused_subs_reg_bcond_gadgets[4]  = gadget_fused_subs_reg_bcond_mi;
    fused_subs_reg_bcond_gadgets[5]  = gadget_fused_subs_reg_bcond_pl;
    fused_subs_reg_bcond_gadgets[6]  = gadget_fused_subs_reg_bcond_vs;
    fused_subs_reg_bcond_gadgets[7]  = gadget_fused_subs_reg_bcond_vc;
    fused_subs_reg_bcond_gadgets[8]  = gadget_fused_subs_reg_bcond_hi;
    fused_subs_reg_bcond_gadgets[9]  = gadget_fused_subs_reg_bcond_ls;
    fused_subs_reg_bcond_gadgets[10] = gadget_fused_subs_reg_bcond_ge;
    fused_subs_reg_bcond_gadgets[11] = gadget_fused_subs_reg_bcond_lt;
    fused_subs_reg_bcond_gadgets[12] = gadget_fused_subs_reg_bcond_gt;
    fused_subs_reg_bcond_gadgets[13] = gadget_fused_subs_reg_bcond_le;
    fused_bcond_tables_init = true;
}

/*
 * Try to fuse SUBS/CMP imm with a following B.cond.
 * Returns 0 (block ended) if fused, -1 if not fuseable.
 * Handles both 32-bit (sf=0) and 64-bit (sf=1), sh=0, rn!=31
 */
static int try_fuse_subs_bcond(struct gen_state *state, uint32_t sf, uint32_t rd, uint32_t rn, uint32_t imm12) {
    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    // Check if next instruction is B.cond (encoding: 0101 0100 xxxx xxxx xxxx xxxx xxx0 xxxx)
    if ((next_insn & 0xff000010) != 0x54000000)
        return -1;
    uint32_t cond = next_insn & 0xf;
    if (cond >= 14)  // AL/NV — not worth fusing
        return -1;

    init_fused_bcond_tables();

    // Consume the B.cond instruction
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = (state->ip - 4) + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    if (rd == 31) {
        // CMP: no result register, only flags
        ARM64_FUSION_STAT_INC(arm64_fusion_cmp_bcond_count);
        gen(state, (unsigned long)(sf ? fused_cmp_bcond_gadgets[cond] : fused_cmp32_bcond_gadgets[cond]));
        gen(state, rn | ((uint64_t)imm12 << 8));
    } else {
        // SUBS: result register + flags
        ARM64_FUSION_STAT_INC(arm64_fusion_subs_bcond_count);
        gen(state, (unsigned long)(sf ? fused_subs_bcond_gadgets[cond] : fused_subs32_bcond_gadgets[cond]));
        gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
    }
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;  // target
    state->jump_ip[1] = state->size - 1;  // fallthrough
    return 0;  // block ended (branch)
}

/*
 * Try to fuse SUBS/CMP reg (64-bit, no shift) with a following B.cond.
 * Returns 0 (block ended) if fused, -1 if not fuseable.
 * Only for sf=1, imm6=0, rn!=31, rm!=31
 */
static int try_fuse_subs_reg_bcond(struct gen_state *state, uint32_t rd, uint32_t rn, uint32_t rm) {
    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0xff000010) != 0x54000000)
        return -1;
    uint32_t cond = next_insn & 0xf;
    if (cond >= 14)
        return -1;

    init_fused_bcond_tables();

    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = (state->ip - 4) + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    if (rd == 31) {
        // CMP reg: no result, only flags
        ARM64_FUSION_STAT_INC(arm64_fusion_cmp_bcond_count);
        gen(state, (unsigned long)fused_cmp_reg_bcond_gadgets[cond]);
        gen(state, rn | (rm << 8));
    } else {
        // SUBS reg: result + flags
        ARM64_FUSION_STAT_INC(arm64_fusion_subs_bcond_count);
        gen(state, (unsigned long)fused_subs_reg_bcond_gadgets[cond]);
        gen(state, rd | (rn << 8) | (rm << 16));
    }
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

/*
 * Try to fuse ADD/SUB immediate with a following CBZ/CBNZ of the result.
 * This is a pure register/control-flow peephole: it writes the ADD/SUB result,
 * tests that same architectural register, and ends the block at the branch.
 */
static int try_fuse_addsub_cbz(struct gen_state *state, uint32_t sf, uint32_t op,
                               uint32_t rd, uint32_t rn, uint32_t imm12) {
    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    uint32_t test_sf = (next_insn >> 31) & 1;
    uint32_t rt = next_insn & 0x1f;
    if (rt != rd || rt == 31)
        return -1;

    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = (state->ip - 4) + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_cbz_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_addsub_cbnz : gadget_fused_addsub_cbz));
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)sf << 29) | ((uint64_t)test_sf << 30));
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static bool arm64_decode_int_unsigned_imm_ldst(uint32_t insn, bool *is_load,
                                                bool *sign_extend, uint32_t *rn,
                                                uint32_t *rt, uint32_t *size) {
    if ((insn & 0x3b000000) != 0x39000000)
        return false;
    uint32_t V = (insn >> 26) & 1;
    if (V)
        return false;
    uint32_t opc = (insn >> 22) & 0x3;
    uint32_t decoded_size = (insn >> 30) & 0x3;
    if (decoded_size == 3 && opc == 2) // PRFM
        return false;
    *is_load = (opc & 1) == 1 || (opc & 2) == 2;
    *sign_extend = (opc & 2) != 0;
    *rn = (insn >> 5) & 0x1f;
    *rt = insn & 0x1f;
    *size = decoded_size;
    return true;
}

static void count_addsub_ldst_candidates(struct gen_state *state, uint32_t rd) {
    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return;
    if (mem_rn != rd || mem_rt == 31)
        return;

    if (is_load)
        ARM64_FUSION_STAT_INC(arm64_fusion_addsub_ldr_candidate_count);
    else
        ARM64_FUSION_STAT_INC(arm64_fusion_addsub_str_candidate_count);
}

static int try_fuse_addsub_ldr64(struct gen_state *state, uint32_t op, uint32_t rd,
                                 uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (!is_load || sign_extend || mem_size != 3 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t ldr_imm12 = (next_insn >> 10) & 0xfff;
    addr_t ldr_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_ldr64_count);
    gen(state, (unsigned long)gadget_fused_addsub_ldr64_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)ldr_imm12 << 40));
    gen(state, (unsigned long)ldr_pc);
    return 1;
}

static int try_fuse_addsub_ldr32(struct gen_state *state, uint32_t op, uint32_t rd,
                                 uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (!is_load || sign_extend || mem_size != 2 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t ldr_imm12 = (next_insn >> 10) & 0xfff;
    addr_t ldr_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_ldr32_count);
    gen(state, (unsigned long)gadget_fused_addsub_ldr32_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)ldr_imm12 << 40));
    gen(state, (unsigned long)ldr_pc);
    return 1;
}

static int try_fuse_addsub_ldr16(struct gen_state *state, uint32_t op, uint32_t rd,
                                 uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (!is_load || sign_extend || mem_size != 1 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t ldr_imm12 = (next_insn >> 10) & 0xfff;
    addr_t ldr_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_ldr16_count);
    gen(state, (unsigned long)gadget_fused_addsub_ldr16_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)ldr_imm12 << 40));
    gen(state, (unsigned long)ldr_pc);
    return 1;
}

static int try_fuse_addsub_ldr8(struct gen_state *state, uint32_t op, uint32_t rd,
                                uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (!is_load || sign_extend || mem_size != 0 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t ldr_imm12 = (next_insn >> 10) & 0xfff;
    addr_t ldr_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_ldr8_count);
    gen(state, (unsigned long)gadget_fused_addsub_ldr8_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)ldr_imm12 << 40));
    gen(state, (unsigned long)ldr_pc);
    return 1;
}

static int try_fuse_addsub_str64(struct gen_state *state, uint32_t op, uint32_t rd,
                                 uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (is_load || sign_extend || mem_size != 3 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t str_imm12 = (next_insn >> 10) & 0xfff;
    addr_t str_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_str64_count);
    gen(state, (unsigned long)gadget_fused_addsub_str64_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)str_imm12 << 40));
    gen(state, (unsigned long)str_pc);
    return 1;
}

static int try_fuse_addsub_str32(struct gen_state *state, uint32_t op, uint32_t rd,
                                 uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (is_load || sign_extend || mem_size != 2 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t str_imm12 = (next_insn >> 10) & 0xfff;
    addr_t str_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_str32_count);
    gen(state, (unsigned long)gadget_fused_addsub_str32_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)str_imm12 << 40));
    gen(state, (unsigned long)str_pc);
    return 1;
}

static int try_fuse_addsub_str16(struct gen_state *state, uint32_t op, uint32_t rd,
                                 uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (is_load || sign_extend || mem_size != 1 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t str_imm12 = (next_insn >> 10) & 0xfff;
    addr_t str_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_str16_count);
    gen(state, (unsigned long)gadget_fused_addsub_str16_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)str_imm12 << 40));
    gen(state, (unsigned long)str_pc);
    return 1;
}

static int try_fuse_addsub_str8(struct gen_state *state, uint32_t op, uint32_t rd,
                                uint32_t rn, uint32_t imm12) {
    if (PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;

    bool is_load, sign_extend;
    uint32_t mem_rn, mem_rt, mem_size;
    if (!arm64_decode_int_unsigned_imm_ldst(next_insn, &is_load, &sign_extend, &mem_rn, &mem_rt, &mem_size))
        return -1;
    if (is_load || sign_extend || mem_size != 0 || mem_rn != rd || mem_rt == 31)
        return -1;

    uint32_t str_imm12 = (next_insn >> 10) & 0xfff;
    addr_t str_pc = state->ip;
    state->ip += 4;

    ARM64_FUSION_STAT_INC(arm64_fusion_addsub_str8_count);
    gen(state, (unsigned long)gadget_fused_addsub_str8_imm);
    gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16) |
               ((uint64_t)op << 28) | ((uint64_t)mem_rt << 32) |
               ((uint64_t)str_imm12 << 40));
    gen(state, (unsigned long)str_pc);
    return 1;
}

static void count_ldr_cbz_candidate(struct gen_state *state, uint32_t rn, uint32_t rt,
                                     uint32_t size, bool sign_extend) {
    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return;
    if ((next_insn & 0x1f) != rt || rt == 31)
        return;
    ARM64_FUSION_STAT_INC(arm64_fusion_ldr_cbz_candidate_count);
    if (size == 3 && !sign_extend && ((next_insn >> 31) & 1)) {
        ARM64_FUSION_STAT_INC(arm64_fusion_ldr64_cbz64_candidate_count);
        if (rn == 31)
            ARM64_FUSION_STAT_INC(arm64_fusion_ldr64_sp_cbz64_candidate_count);
    }
    if (size == 2 && sign_extend)
        ARM64_FUSION_STAT_INC(arm64_fusion_ldr32_sx_cbz64_candidate_count);
    if (size == 1 && sign_extend)
        ARM64_FUSION_STAT_INC(arm64_fusion_ldr16_sx_cbz_candidate_count);
    if (size == 0 && sign_extend)
        ARM64_FUSION_STAT_INC(arm64_fusion_ldr8_sx_cbz_candidate_count);
}

static int try_fuse_ldr64_cbz64(struct gen_state *state, uint32_t rn, uint32_t rt, uint32_t imm12) {
    if (rn == 31 || rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt || ((next_insn >> 31) & 1) == 0)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_ldr64_cbz64_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr64_cbnz_imm : gadget_fused_ldr64_cbz_imm));
    gen(state, rt | (rn << 8) | ((uint64_t)imm12 << 16));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static int try_fuse_ldr64_sp_cbz64(struct gen_state *state, uint32_t rn, uint32_t rt, uint32_t imm12) {
    if (rn != 31 || rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt || ((next_insn >> 31) & 1) == 0)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_ldr64_sp_cbz64_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr64_sp_cbnz_imm : gadget_fused_ldr64_sp_cbz_imm));
    gen(state, rt | ((uint64_t)imm12 << 16));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static int try_fuse_ldr32_sx_cbz64(struct gen_state *state, uint32_t rn, uint32_t rt, uint32_t imm12) {
    if (rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_ldr32_sx_cbz64_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr32_sx_cbnz_imm : gadget_fused_ldr32_sx_cbz_imm));
    gen(state, rt | (rn << 8) | ((uint64_t)imm12 << 16));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static int try_fuse_ldr32_cbz32(struct gen_state *state, uint32_t rn, uint32_t rt, uint32_t imm12) {
    if (rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt || ((next_insn >> 31) & 1) != 0)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_ldr32_cbz32_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr32_cbnz_imm : gadget_fused_ldr32_cbz_imm));
    gen(state, rt | (rn << 8) | ((uint64_t)imm12 << 16));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static int try_fuse_ldr_sx_cbz(struct gen_state *state, uint32_t rn, uint32_t rt,
                                uint32_t imm12, uint32_t size, bool extend64) {
    if (rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;
    if (size > 1)
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    if (size == 1)
        ARM64_FUSION_STAT_INC(arm64_fusion_ldr16_sx_cbz_count);
    else
        ARM64_FUSION_STAT_INC(arm64_fusion_ldr8_sx_cbz_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr_sx_cbnz_imm : gadget_fused_ldr_sx_cbz_imm));
    gen(state, rt | (rn << 8) | ((uint64_t)imm12 << 16) | ((uint64_t)size << 28) | ((uint64_t)extend64 << 29));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static int try_fuse_ldr16_cbz32(struct gen_state *state, uint32_t rn, uint32_t rt, uint32_t imm12) {
    if (rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt || ((next_insn >> 31) & 1) != 0)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_ldr16_cbz32_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr16_cbnz_imm : gadget_fused_ldr16_cbz_imm));
    gen(state, rt | (rn << 8) | ((uint64_t)imm12 << 16));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

static int try_fuse_ldr8_cbz32(struct gen_state *state, uint32_t rn, uint32_t rt, uint32_t imm12) {
    if (rt == 31 || PAGE(state->orig_ip) != PAGE(state->ip))
        return -1;

    uint32_t next_insn;
    if (!gen_peek_next_insn(state, &next_insn))
        return -1;
    if ((next_insn & 0x7e000000) != 0x34000000)
        return -1;
    if ((next_insn & 0x1f) != rt || ((next_insn >> 31) & 1) != 0)
        return -1;

    bool is_cbnz = (next_insn >> 24) & 1;
    addr_t cbz_pc = state->ip;
    state->ip += 4;

    int64_t offset = arm64_branch_imm19(next_insn);
    addr_t target = cbz_pc + offset;
    unsigned long fake_target = (unsigned long)target | (1UL << 63);
    unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

    ARM64_FUSION_STAT_INC(arm64_fusion_ldr8_cbz32_count);
    gen(state, (unsigned long)(is_cbnz ? gadget_fused_ldr8_cbnz_imm : gadget_fused_ldr8_cbz_imm));
    gen(state, rt | (rn << 8) | ((uint64_t)imm12 << 16));
    gen(state, state->orig_ip);
    gen(state, fake_target);
    gen(state, fake_fallthrough);
    state->jump_ip[0] = state->size - 2;
    state->jump_ip[1] = state->size - 1;
    return 0;
}

/*
 * Data Processing (Immediate)
 */
static int gen_dp_imm(struct gen_state *state, uint32_t insn) {
    uint32_t op0 = (insn >> 23) & 0x7;

    // PC-relative addressing (ADR, ADRP)
    if ((insn & 0x1f000000) == 0x10000000) {
        uint32_t rd = insn & 0x1f;
        bool is_adrp = (insn >> 31) & 1;
        int64_t imm = arm64_adr_imm(insn);

        addr_t target;
        if (is_adrp) {
            target = (state->orig_ip & ~0xFFF) + (imm << 12);
        } else {
            target = state->orig_ip + imm;
        }

        // Try fused ADRP+LDR64: ADRP Xd, #page; LDR Xt, [Xd, #imm]
        if (is_adrp && rd != 31) {
            uint32_t next;
            if (gen_peek_next_insn(state, &next)) {
                // LDR Xt (64-bit, unsigned offset): 1111 1001 01 imm12 Rn Rt
                if ((next & 0xffc00000) == 0xf9400000) {
                    uint32_t ldr_rt = next & 0x1f;
                    uint32_t ldr_rn = (next >> 5) & 0x1f;
                    uint32_t ldr_imm12 = (next >> 10) & 0xfff;
                    uint32_t ldr_offset = ldr_imm12 << 3; // scale by 8 for 64-bit
                    if (ldr_rn == rd && ldr_rt != 31) {
                        // Fuse: emit single gadget, consume the LDR
                        // Param 1: ldr_rt[0:4] | rd[5:9] | ldr_offset[16:31]
                        // Param 2: adrp_target (32-bit, zero-extended)
                        state->ip += 4;
                        ARM64_FUSION_STAT_INC(arm64_fusion_adrp_ldr64_count);
                        gen(state, (unsigned long) gadget_fused_adrp_ldr64);
                        gen(state, ldr_rt | ((uint64_t)rd << 5) | ((uint64_t)ldr_offset << 16));
                        gen(state, target & 0xffffffffffffULL);
                        return 1;
                    }
                }
                // Try fused ADRP+ADD: ADD Xd, Xd, #imm12 (no shift)
                // Encoding: 1001 0001 00 imm12 Rn Rd  (sf=1, op=0, S=0, sh=0)
                if ((next & 0xffc00000) == 0x91000000) {
                    uint32_t add_rd = next & 0x1f;
                    uint32_t add_rn = (next >> 5) & 0x1f;
                    uint32_t add_imm12 = (next >> 10) & 0xfff;
                    if (add_rn == rd && add_rd == rd) {
                        state->ip += 4;
                        ARM64_FUSION_STAT_INC(arm64_fusion_adrp_add_count);
                        gen(state, (unsigned long) gadget_fused_adrp_add);
                        gen(state, rd | ((uint64_t)add_imm12 << 8));
                        gen(state, target & 0xffffffffffffULL);
                        return 1;
                    }
                }
            }
        }

        // Generate: store immediate to register
        // Pack rd(0:4) | target(8:55) in single code-stream word
        gen(state, (unsigned long) gadget_adr);
        gen(state, rd | ((uint64_t)(target & 0xffffffffffffULL) << 8));
        return 1;
    }

    // Add/subtract (immediate)
    if ((op0 & 0x6) == 0x2) {
        uint32_t sf = (insn >> 31) & 1;       // 0=32-bit, 1=64-bit
        uint32_t op = (insn >> 30) & 1;       // 0=ADD, 1=SUB
        uint32_t S = (insn >> 29) & 1;        // Set flags
        uint32_t sh = (insn >> 22) & 1;       // Shift (0=none, 1=LSL #12)
        uint32_t imm12 = (insn >> 10) & 0xfff;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // Don't pre-shift imm12 - pass sh flag to gadget instead
        // This avoids overflow when imm12 << 12 > 12 bits

        // Try fused SUBS/CMP + B.cond peephole for both 32-bit and 64-bit
        // (only for SUB with flags, no shift, rn!=31)
        if (!sh && rn != 31 && S && op == 1) {
            int fused = try_fuse_subs_bcond(state, sf, rd, rn, imm12);
            if (fused == 0) return 0;  // fused and block ended
        }

        // Try ADD/SUB imm + CBZ/CBNZ of the result before the single-insn fast path.
        if (!sh && !S && rd != 31 && rn != 31) {
            int fused = try_fuse_addsub_cbz(state, sf, op, rd, rn, imm12);
            if (fused == 0) return 0;  // fused and block ended
            count_addsub_ldst_candidates(state, rd);
            if (sf && try_fuse_addsub_ldr64(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_ldr32(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_ldr16(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_ldr8(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_str64(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_str32(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_str16(state, op, rd, rn, imm12) == 1)
                return 1;
            if (sf && try_fuse_addsub_str8(state, op, rd, rn, imm12) == 1)
                return 1;
        }

        // Try specialized 64-bit fast paths (no SP/XZR source)
        bool can_specialize_imm = sf && !sh && rn != 31;
        bool can_specialize_imm_sh = sf && sh && rn != 31;
        if (can_specialize_imm && S) {
            // ADDS/SUBS imm 64-bit (rd=31 allowed for CMP/CMN)
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_subs_imm_64 : gadget_adds_imm_64));
            gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
            return 1;
        }
        if (can_specialize_imm_sh && S) {
            // ADDS/SUBS imm 64-bit with LSL#12 (rd=31 allowed for CMP/CMN)
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_subs_imm_64_sh : gadget_adds_imm_64_sh));
            gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
            return 1;
        }
        if (can_specialize_imm && !S && rd != 31) {
            // ADD/SUB imm 64-bit, no flags, no SP
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_sub_imm_64 : gadget_add_imm_64));
            gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
            return 1;
        }
        if (can_specialize_imm_sh && !S && rd != 31) {
            // ADD/SUB imm 64-bit with LSL#12, no flags, no SP
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_sub_imm_64_sh : gadget_add_imm_64_sh));
            gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
            return 1;
        }

        // Try specialized 32-bit fast paths (no SP/XZR source, no shift)
        bool can_specialize_32 = !sf && !sh && rn != 31;
        if (can_specialize_32 && S) {
            // ADDS/SUBS imm 32-bit (rd=31 allowed for CMP/CMN)
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_subs_imm_32 : gadget_adds_imm_32));
            gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
            return 1;
        }
        if (can_specialize_32 && !S && rd != 31) {
            // ADD/SUB imm 32-bit, no flags, no SP
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_sub_imm_32 : gadget_add_imm_32));
            gen(state, rd | (rn << 8) | ((uint64_t)imm12 << 16));
            return 1;
        }

        // SP-source specialization: ADD/SUB Xd, SP, #imm (sf=1, S=0, sh=0, rn==31, rd!=31)
        if (sf && !sh && rn == 31 && !S && rd != 31) {
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_sub_imm_sp_src_64 : gadget_add_imm_sp_src_64));
            gen(state, rd | ((uint64_t)imm12 << 16));
            return 1;
        }

        // Generic path: handles remaining SP cases, LSL#12 with 32-bit, etc.
        if (op == 0) {
            gen(state, (unsigned long) gadget_add_imm);
        } else {
            gen(state, (unsigned long) gadget_sub_imm);
        }
        // Pack parameters: rd, rn, imm12, sf, S, sh
        // Layout: [0:4]=rd, [8:12]=rn, [16:27]=imm12, [28]=sf, [29]=S, [30]=sh
        uint64_t packed = rd | (rn << 8) | ((uint64_t)imm12 << 16) | ((uint64_t)sf << 28) | ((uint64_t)S << 29) | ((uint64_t)sh << 30);
        gen(state, packed);
        return 1;
    }

    // EXTR - Extract register (concatenate and shift)
    // Matches: 0b10010011110xxxxx (64-bit) / 0b00010011110xxxxx (32-bit)
    if ((insn & 0xffe00000) == 0x93c00000 || (insn & 0xffe00000) == 0x13800000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t imm = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        gen(state, (unsigned long) gadget_extr);
        gen(state, rd | (rn << 8) | (rm << 16) | ((uint64_t)imm << 24) | ((uint64_t)sf << 30));
        return 1;
    }

    // Logical (immediate) - only op0 == 0b100
    if (op0 == 0x4) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t opc = (insn >> 29) & 0x3;
        uint32_t N = (insn >> 22) & 1;
        uint32_t immr = (insn >> 16) & 0x3f;
        uint32_t imms = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        uint64_t imm;
        if (!decode_bitmask_imm(N, imms, immr, sf, &imm)) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget;
        switch (opc) {
            case 0: gadget = gadget_and_imm; break;  // AND
            case 1: gadget = gadget_orr_imm; break;  // ORR
            case 2: gadget = gadget_eor_imm; break;  // EOR
            case 3: gadget = gadget_and_imm; break;  // ANDS (sets flags)
            default:
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
        }

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | ((uint64_t)sf << 16) | ((opc == 3) ? (1UL << 17) : 0));
        gen(state, imm);
        return 1;
    }

    // Move wide (immediate) - MOVN, MOVZ, MOVK
    // Pattern: x00x0101xxxxxxxxxxxxxxxxxxxxxxxx
    if ((insn & 0x1f800000) == 0x12800000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t opc = (insn >> 29) & 0x3;
        uint32_t hw = (insn >> 21) & 0x3;
        uint32_t imm16 = (insn >> 5) & 0xffff;
        uint32_t rd = insn & 0x1f;


        if (!sf && hw >= 2) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget;
        switch (opc) {
            case 0: gadget = gadget_movn; break;
            case 2: gadget = gadget_movz; break;
            case 3: gadget = gadget_movk; break;
            default:
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
        }

        gen(state, (unsigned long) gadget);
        gen(state, rd | (hw << 8) | ((uint64_t)imm16 << 16) | ((uint64_t)sf << 32));
        return 1;
    }

    // Bitfield operations (SBFM, BFM, UBFM) - includes LSL, LSR, ASR, SXTB, SXTW, etc.
    // Pattern: x00x0110xxxxxxxxxxxxxxxxxxxxxxxx
    if ((insn & 0x1f800000) == 0x13000000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t opc = (insn >> 29) & 0x3;
        // uint32_t N = (insn >> 22) & 1;  // Not used for common aliases
        uint32_t immr = (insn >> 16) & 0x3f;
        uint32_t imms = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // Fused parameter for UBFM/SBFM: immr | imms<<8 | sf<<16 | rn<<20 | rd<<28
        uint64_t fused_param = immr | (imms << 8) | ((uint64_t)sf << 16)
                              | ((uint64_t)rn << 20) | ((uint64_t)rd << 28);
        bool can_fuse = (rn != 31 && rd != 31 && opc != 1);

        // Handle SBFM (opc=0) and UBFM (opc=2) with fused fast path
        if (opc == 0) {
            if (can_fuse) {
                gen(state, (unsigned long) gadget_sbfm_fused);
                gen(state, fused_param);
                return 1;
            }
            // Fallback: load_reg + alias/generic + store_reg
            gen(state, (unsigned long) gadget_load_reg);
            gen(state, rn);
            if (immr == 0 && imms == 31 && sf == 1)
                gen(state, (unsigned long) gadget_sxtw);
            else if (immr == 0 && imms == 15) {
                gen(state, (unsigned long) gadget_sxth);
                gen(state, sf);
            } else if (immr == 0 && imms == 7) {
                gen(state, (unsigned long) gadget_sxtb);
                gen(state, sf);
            } else {
                gen(state, (unsigned long) gadget_sbfm);
                gen(state, immr | (imms << 8) | ((uint64_t)sf << 16));
            }
        } else if (opc == 2) {
            if (can_fuse) {
                gen(state, (unsigned long) gadget_ubfm_fused);
                gen(state, fused_param);
                return 1;
            }
            gen(state, (unsigned long) gadget_load_reg);
            gen(state, rn);
            if (immr == 0 && imms == 31 && sf == 1)
                gen(state, (unsigned long) gadget_uxtw);
            else if (immr == 0 && imms == 15) {
                gen(state, (unsigned long) gadget_uxth);
                gen(state, sf);
            } else if (immr == 0 && imms == 7) {
                gen(state, (unsigned long) gadget_uxtb);
                gen(state, sf);
            } else {
                gen(state, (unsigned long) gadget_ubfm);
                gen(state, immr | (imms << 8) | ((uint64_t)sf << 16));
            }
        } else if (opc == 1) {
            // BFM needs both source and destination — not fused
            gen(state, (unsigned long) gadget_load_reg);
            gen(state, rn);
            gen(state, (unsigned long) gadget_bfm);
            gen(state, immr | (imms << 8) | ((uint64_t)sf << 16) | ((uint64_t)rd << 24));
        } else {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Store result for non-fused paths
        gen(state, (unsigned long) gadget_store_reg);
        gen(state, rd);
        return 1;
    }

    gen_interrupt(state, INT_UNDEFINED);
    return 0;
}

/*
 * Branches, Exceptions, and System Instructions
 */
static int gen_branch(struct gen_state *state, uint32_t insn) {
    // SVC (system call)
    if ((insn & 0xffe0001f) == 0xd4000001) {
        gen(state, (unsigned long) gadget_svc);
        gen(state, state->ip);  // Next instruction address for resuming after syscall
        gen_interrupt(state, INT_SYSCALL);
        return 0;
    }

    // BRK (breakpoint) - 11010100 001 imm16 000 00
    // Encoding: 0xd4200000 with mask 0xffe0001f
    // This typically signals SIGTRAP. For now, treat as debug breakpoint.
    if ((insn & 0xffe0001f) == 0xd4200000) {
        gen_interrupt(state, INT_BREAKPOINT);
        return 0;
    }

    // Unconditional branch immediate (B, BL)
    if ((insn & 0x7c000000) == 0x14000000) {
        bool is_bl = (insn >> 31) & 1;
        int64_t offset = arm64_branch_imm26(insn);
        addr_t target = state->orig_ip + offset;
        // Use fake_ip (with bit 63 set) so fiber_ret_chain can detect unchained blocks
        unsigned long fake_target = (unsigned long)target | (1UL << 63);

        if (is_bl) {
            // BL: save return address to X30
            // Code stream: [gadget][block_self_ptr][return_addr][fake_return_cont][fake_target]
            unsigned long fake_return = (unsigned long)state->ip | (1UL << 63);
            gen(state, (unsigned long) gadget_branch_link);
            gen(state, 0);                  // block self-pointer (patched by gen_end)
            gen(state, state->ip);          // return address (next instruction)
            gen(state, fake_return);        // return continuation (patched to return-site block)
            gen(state, fake_target);        // call target (patched to callee block)
            state->block_patch_ip = state->size - 4; // patch slot for block self-pointer
            // jump_ip[0] = return continuation, jump_ip[1] = call target
            state->jump_ip[0] = state->size - 2;
            state->jump_ip[1] = state->size - 1;
        } else {
            // Extended basic block: follow unconditional B inline if safe
            // Same-page + forward-only prevents infinite loops and page-tracking issues
            if (PAGE(target) == PAGE(state->block->addr) &&
                target > state->orig_ip &&
                state->b_follow_depth < 3) {
                state->ip = target;
                state->b_follow_depth++;
                return 1;  // continue compiling from target
            }
            gen(state, (unsigned long) gadget_branch);
            gen(state, fake_target);
            state->jump_ip[0] = state->size - 1;
        }

        return 0;
    }

    // Conditional branch (B.cond)
    if ((insn & 0xff000010) == 0x54000000) {
        uint32_t cond = insn & 0xf;
        int64_t offset = arm64_branch_imm19(insn);
        addr_t target = state->orig_ip + offset;
        unsigned long fake_target = (unsigned long)target | (1UL << 63);
        unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

        // Per-condition gadgets eliminate indirect branch through jump table
        static void *bcond_gadgets[16] = {
            [0]  = NULL, [1]  = NULL, [2]  = NULL, [3]  = NULL,
            [4]  = NULL, [5]  = NULL, [6]  = NULL, [7]  = NULL,
            [8]  = NULL, [9]  = NULL, [10] = NULL, [11] = NULL,
            [12] = NULL, [13] = NULL, [14] = NULL, [15] = NULL,
        };
        if (!bcond_gadgets[0]) {
            bcond_gadgets[0]  = gadget_bcond_eq;
            bcond_gadgets[1]  = gadget_bcond_ne;
            bcond_gadgets[2]  = gadget_bcond_cs;
            bcond_gadgets[3]  = gadget_bcond_cc;
            bcond_gadgets[4]  = gadget_bcond_mi;
            bcond_gadgets[5]  = gadget_bcond_pl;
            bcond_gadgets[6]  = gadget_bcond_vs;
            bcond_gadgets[7]  = gadget_bcond_vc;
            bcond_gadgets[8]  = gadget_bcond_hi;
            bcond_gadgets[9]  = gadget_bcond_ls;
            bcond_gadgets[10] = gadget_bcond_ge;
            bcond_gadgets[11] = gadget_bcond_lt;
            bcond_gadgets[12] = gadget_bcond_gt;
            bcond_gadgets[13] = gadget_bcond_le;
            bcond_gadgets[14] = NULL;  // AL
            bcond_gadgets[15] = NULL;  // NV (treat as AL)
        }

        if (cond >= 14) {
            // AL/NV: always taken — emit unconditional branch
            gen(state, (unsigned long) gadget_branch);
            gen(state, fake_target);
            state->jump_ip[0] = state->size - 1;
        } else if (arm64_internal_continue_enabled && !state->internal_continue_used &&
                   state->internal_continue_count + 2 <= GEN_INTERNAL_CONTINUE_MAX &&
                   PAGE(state->ip) == PAGE(state->block->addr) &&
                   ((arm64_internal_continue_taken_enabled && PAGE(target) == PAGE(state->block->addr) &&
                     target > state->ip && target - state->ip <= 8) || target < state->ip)) {
            if (arm64_internal_continue_taken_enabled && PAGE(target) == PAGE(state->block->addr) && target > state->ip && target - state->ip <= 8) {
                // Phase 3B second prototype: taken edge continues through a
                // private internal-continue record; fallthrough exits normally.
                // The only public chain slot remains the external fake fallthrough.
                gen(state, (unsigned long) gadget_bcond_taken_internal);
                gen(state, cond);
                unsigned internal_patch_ip = state->size;
                gen(state, 0);
                gen(state, fake_fallthrough);
                state->jump_ip[0] = state->size - 1;  // external fallthrough
                unsigned internal_continue_ip = state->size;
                if (!gen_record_internal_continue_patch(state, internal_patch_ip, internal_continue_ip) ||
                        !gen_emit_internal_continue_record(state, target)) {
                    abort();
                }
                ARM64_INTERNAL_CONTINUE_STAT_INC(arm64_internal_continue_bcond_taken_count);
                state->internal_continue_used = 1;
                state->internal_continue_segment_start = target;
                state->internal_continue_segment_budget = GEN_INTERNAL_CONTINUE_BUDGET_INSNS;
                state->ip = target;
                return 1;
            }

            // Phase 3B first prototype: taken edge exits normally; fallthrough
            // continues through a private internal-continue record. The only
            // public chain slot remains the external fake target.
            gen(state, (unsigned long) gadget_bcond_fallthrough_internal);
            gen(state, cond);
            gen(state, fake_target);
            state->jump_ip[0] = state->size - 1;  // external taken target
            unsigned internal_patch_ip = state->size;
            gen(state, 0);
            unsigned internal_continue_ip = state->size;
            if (!gen_record_internal_continue_patch(state, internal_patch_ip, internal_continue_ip) ||
                    !gen_emit_internal_continue_record(state, state->ip)) {
                abort();
            }
            ARM64_INTERNAL_CONTINUE_STAT_INC(arm64_internal_continue_bcond_fallthrough_count);
            state->internal_continue_used = 1;
            state->internal_continue_segment_start = state->ip;
            state->internal_continue_segment_budget = GEN_INTERNAL_CONTINUE_BUDGET_INSNS;
            return 1;
        } else {
            // Per-condition gadget: code stream is [gadget][target][fallthrough]
            gen(state, (unsigned long) bcond_gadgets[cond]);
            gen(state, fake_target);
            gen(state, fake_fallthrough);
            state->jump_ip[0] = state->size - 2;  // target
            state->jump_ip[1] = state->size - 1;  // fallthrough
        }
        return 0;
    }

    // Compare and branch (CBZ, CBNZ)
    if ((insn & 0x7e000000) == 0x34000000) {
        bool is_cbnz = (insn >> 24) & 1;
        bool sf = (insn >> 31) & 1;
        uint32_t rt = insn & 0x1f;
        int64_t offset = arm64_branch_imm19(insn);
        addr_t target = state->orig_ip + offset;
        // Use fake_ip for both target and fallthrough
        unsigned long fake_target = (unsigned long)target | (1UL << 63);
        unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

        if (arm64_internal_continue_enabled && !state->internal_continue_used &&
                state->internal_continue_count + 2 <= GEN_INTERNAL_CONTINUE_MAX &&
                PAGE(state->ip) == PAGE(state->block->addr) &&
                ((arm64_internal_continue_taken_enabled && PAGE(target) == PAGE(state->block->addr) &&
                  target > state->ip && target - state->ip <= 8) || target < state->ip)) {
            uint64_t op = rt | ((uint64_t)sf << 8) | ((uint64_t)is_cbnz << 9);
            if (arm64_internal_continue_taken_enabled && PAGE(target) == PAGE(state->block->addr) &&
                    target > state->ip && target - state->ip <= 8) {
                // Taken edge continues through a private internal-continue record;
                // fallthrough exits normally through fake-IP/block dispatch.
                gen(state, (unsigned long) gadget_cbz_taken_internal);
                gen(state, op);
                unsigned internal_patch_ip = state->size;
                gen(state, 0);
                gen(state, fake_fallthrough);
                state->jump_ip[0] = state->size - 1;  // external fallthrough
                unsigned internal_continue_ip = state->size;
                if (!gen_record_internal_continue_patch(state, internal_patch_ip, internal_continue_ip) ||
                        !gen_emit_internal_continue_record(state, target)) {
                    abort();
                }
                ARM64_INTERNAL_CONTINUE_STAT_INC(arm64_internal_continue_cbz_taken_count);
                state->internal_continue_used = 1;
                state->internal_continue_segment_start = target;
                state->internal_continue_segment_budget = GEN_INTERNAL_CONTINUE_BUDGET_INSNS;
                state->ip = target;
                return 1;
            }

            // Taken edge exits normally; fallthrough continues through a private
            // internal-continue record. The only public chain slot is the target.
            gen(state, (unsigned long) gadget_cbz_fallthrough_internal);
            gen(state, op);
            gen(state, fake_target);
            state->jump_ip[0] = state->size - 1;  // external taken target
            unsigned internal_patch_ip = state->size;
            gen(state, 0);
            unsigned internal_continue_ip = state->size;
            if (!gen_record_internal_continue_patch(state, internal_patch_ip, internal_continue_ip) ||
                    !gen_emit_internal_continue_record(state, state->ip)) {
                abort();
            }
            ARM64_INTERNAL_CONTINUE_STAT_INC(arm64_internal_continue_cbz_fallthrough_count);
            state->internal_continue_used = 1;
            state->internal_continue_segment_start = state->ip;
            state->internal_continue_segment_budget = GEN_INTERNAL_CONTINUE_BUDGET_INSNS;
            return 1;
        } else {
            if (rt != 31) {
                // Fast path: specialized gadgets skip XZR check and sf check
                void *gadget;
                if (is_cbnz)
                    gadget = sf ? gadget_cbnz_64 : gadget_cbnz_32;
                else
                    gadget = sf ? gadget_cbz_64 : gadget_cbz_32;
                gen(state, (unsigned long) gadget);
                gen(state, (uint64_t)rt);
            } else {
                // Fallback: generic gadget handles XZR (rt==31)
                gen(state, (unsigned long)(is_cbnz ? gadget_cbnz : gadget_cbz));
                gen(state, rt | ((uint64_t)sf << 8));
            }
            gen(state, fake_target);
            gen(state, fake_fallthrough);

            // Record both jump targets for potential block chaining
            state->jump_ip[0] = state->size - 2;  // target
            state->jump_ip[1] = state->size - 1;  // fallthrough
            return 0;
        }
    }

    // Test and branch (TBZ, TBNZ)
    // Encoding: b5:011011:op:b40:imm14:Rt
    if ((insn & 0x7e000000) == 0x36000000) {
        bool is_tbnz = (insn >> 24) & 1;
        uint32_t b5 = (insn >> 31) & 1;
        uint32_t b40 = (insn >> 19) & 0x1f;
        uint32_t bit_pos = (b5 << 5) | b40;
        uint32_t rt = insn & 0x1f;
        int64_t imm14 = (insn >> 5) & 0x3fff;
        if (imm14 & 0x2000) imm14 |= ~0x3fffLL;  // sign-extend
        int64_t offset = imm14 * 4;
        addr_t target = state->orig_ip + offset;

        unsigned long fake_target = (unsigned long)target | (1UL << 63);
        unsigned long fake_fallthrough = (unsigned long)state->ip | (1UL << 63);

        if (arm64_internal_continue_enabled && !state->internal_continue_used &&
                state->internal_continue_count + 2 <= GEN_INTERNAL_CONTINUE_MAX &&
                PAGE(state->ip) == PAGE(state->block->addr) &&
                ((arm64_internal_continue_taken_enabled && PAGE(target) == PAGE(state->block->addr) &&
                  target > state->ip && target - state->ip <= 8) || target < state->ip)) {
            uint64_t op = rt | ((uint64_t)bit_pos << 8) | ((uint64_t)is_tbnz << 14);
            if (arm64_internal_continue_taken_enabled && PAGE(target) == PAGE(state->block->addr) &&
                    target > state->ip && target - state->ip <= 8) {
                // Taken edge continues through a private internal-continue record;
                // fallthrough exits normally through fake-IP/block dispatch.
                gen(state, (unsigned long) gadget_tbz_taken_internal);
                gen(state, op);
                unsigned internal_patch_ip = state->size;
                gen(state, 0);
                gen(state, fake_fallthrough);
                state->jump_ip[0] = state->size - 1;  // external fallthrough
                unsigned internal_continue_ip = state->size;
                if (!gen_record_internal_continue_patch(state, internal_patch_ip, internal_continue_ip) ||
                        !gen_emit_internal_continue_record(state, target)) {
                    abort();
                }
                ARM64_INTERNAL_CONTINUE_STAT_INC(arm64_internal_continue_tbz_taken_count);
                state->internal_continue_used = 1;
                state->internal_continue_segment_start = target;
                state->internal_continue_segment_budget = GEN_INTERNAL_CONTINUE_BUDGET_INSNS;
                state->ip = target;
                return 1;
            }

            // Taken edge exits normally; fallthrough continues through a private
            // internal-continue record. The only public chain slot is the target.
            gen(state, (unsigned long) gadget_tbz_fallthrough_internal);
            gen(state, op);
            gen(state, fake_target);
            state->jump_ip[0] = state->size - 1;  // external taken target
            unsigned internal_patch_ip = state->size;
            gen(state, 0);
            unsigned internal_continue_ip = state->size;
            if (!gen_record_internal_continue_patch(state, internal_patch_ip, internal_continue_ip) ||
                    !gen_emit_internal_continue_record(state, state->ip)) {
                abort();
            }
            ARM64_INTERNAL_CONTINUE_STAT_INC(arm64_internal_continue_tbz_fallthrough_count);
            state->internal_continue_used = 1;
            state->internal_continue_segment_start = state->ip;
            state->internal_continue_segment_budget = GEN_INTERNAL_CONTINUE_BUDGET_INSNS;
            return 1;
        } else {
            if (is_tbnz) {
                gen(state, (unsigned long) gadget_tbnz);
            } else {
                gen(state, (unsigned long) gadget_tbz);
            }
            gen(state, rt | (bit_pos << 8));
            gen(state, fake_target);
            gen(state, fake_fallthrough);

            state->jump_ip[0] = state->size - 2;  // target
            state->jump_ip[1] = state->size - 1;  // fallthrough
            return 0;
        }
    }

    // Unconditional branch register (BR, BLR, RET)
    if ((insn & 0xfe000000) == 0xd6000000) {
        uint32_t opc = (insn >> 21) & 0xf;
        uint32_t rn = (insn >> 5) & 0x1f;

        switch (opc) {
            case 0:  // BR
                gen(state, (unsigned long) gadget_branch_reg);
                gen(state, rn);
                break;
            case 1:  // BLR
                gen(state, (unsigned long) gadget_branch_link_reg);
                gen(state, rn);
                gen(state, state->ip);  // return address
                break;
            case 2:  // RET
                gen(state, (unsigned long) gadget_ret);
                gen(state, rn);  // usually X30
                break;
            default:
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
        }
        return 0;
    }

    // System instructions (MSR, MRS, HINT, etc.)
    if ((insn & 0xffc00000) == 0xd5000000) {
        // HINT instructions (including NOP)
        // Encoding: 1101 0101 0000 0011 0010 xxxx xxx1 1111
        if ((insn & 0xfffff01f) == 0xd503201f) {
            // NOP, YIELD, WFE, WFI, SEV, SEVL, etc.
            // Just do nothing and continue to next instruction
            return 1;
        }

        // Barrier instructions (DMB, DSB, ISB)
        // DMB: 1101 0101 0000 0011 0011 CRm 1011 1111 = 0xd50330bf | (CRm << 8)
        // DSB: 1101 0101 0000 0011 0011 CRm 1001 1111 = 0xd503309f | (CRm << 8)
        // ISB: 1101 0101 0000 0011 0011 CRm 1101 1111 = 0xd50330df | (CRm << 8)
        // Guest threads run as real host threads sharing host memory, so guest
        // barriers must issue real host barriers. Keep DSB/ISB distinct: DSB
        // is stronger than DMB, and ISB is an instruction-synchronization event.
        if ((insn & 0xfffff0ff) == 0xd50330bf) {  // DMB
            gen(state, (unsigned long) gadget_dmb);
            return 1;
        }
        if ((insn & 0xfffff0ff) == 0xd503309f) {  // DSB
            gen(state, (unsigned long) gadget_dsb);
            return 1;
        }
        if ((insn & 0xfffff0ff) == 0xd50330df) {  // ISB
            gen(state, (unsigned long) gadget_isb);
            return 1;
        }

        // CLREX — Clear Exclusive Monitor
        // Encoding: 1101 0101 0000 0011 0011 CRm 0101 1111 = 0xd503305f | (CRm << 8)
        if ((insn & 0xfffff0ff) == 0xd503305f) {
            // Must clear both single and pair exclusive monitor state.
            // Treating CLREX as NOP lets a subsequent STXR/STXP succeed
            // when architecture requires failure.
            gen(state, (unsigned long) gadget_clrex);
            return 1;
        }

        // Data cache zero by VA. DCZID_EL0 below advertises a 64-byte block.
        if ((insn & 0xffffffe0) == 0xd50b7420) {  // DC ZVA
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_dc_zva);
            gen(state, rt);
            return 1;
        }

        // IC IVAU (Invalidate icache by VA to PoU): d50b752x
        // This is the architectural signal that the guest modified code at
        // the given address (self-modifying code: JIT repatching, inline
        // cache updates, lazy stub linking). It must NOT be a NOP: iSH only
        // invalidates translated blocks on a write-TLB-miss, so a store
        // through an already-writable TLB entry to a page with compiled
        // blocks leaves them stale. JSC/bun repatches JIT code in place and
        // then issues DC CVAU + IC IVAU per cache line; treating IC IVAU as
        // a NOP left the pre-patch translation running (observed: FTL lazy
        // slow path compiled twice -> RELEASE_ASSERT(!m_stub) abort, inline
        // caches returning stale property values).
        if ((insn & 0xffffffe0) == 0xd50b7520) {  // IC IVAU
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_ic_ivau);
            gen(state, rt);
            return 1;
        }

        // Data-cache maintenance (DC) — NOP in emulation (host memory is
        // coherent; only the *instruction* side needs retranslation, which
        // IC IVAU above handles).
        // DC CIVAC (Clean and Invalidate by VA to PoC): d50b7e2x
        // DC CVAU  (Clean by VA to PoU):                d50b7b2x
        // DC CVAC  (Clean by VA to PoC):                d50b7a2x
        if ((insn & 0xffffffe0) == 0xd50b7e20 ||  // DC CIVAC
            (insn & 0xffffffe0) == 0xd50b7b20 ||  // DC CVAU
            (insn & 0xffffffe0) == 0xd50b7a20) {  // DC CVAC
            return 1;  // NOP — no cache to maintain
        }

        // MRS/MSR NZCV (condition flags register)
        // MRS Xt, NZCV: d53b4200 | Rt  (op0=3, op1=3, CRn=4, CRm=2, op2=0)
        // MSR NZCV, Xt: d51b4200 | Rt
        if ((insn & 0xffffffe0) == 0xd53b4200) {
            // MRS Xt, NZCV - read condition flags
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_mrs_nzcv);
            gen(state, rt);
            return 1;
        }
        if ((insn & 0xffffffe0) == 0xd51b4200) {
            // MSR NZCV, Xt - write condition flags
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_msr_nzcv);
            gen(state, rt);
            return 1;
        }

        // MSR FPCR, Xt: d51b4400 (op0=3, op1=3, CRn=4, CRm=4, op2=0)
        if ((insn & 0xffffffe0) == 0xd51b4400) {
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_msr_fpcr);
            gen(state, rt);
            return 1;
        }
        // MSR FPSR, Xt: d51b4420 (op0=3, op1=3, CRn=4, CRm=4, op2=1)
        if ((insn & 0xffffffe0) == 0xd51b4420) {
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_msr_fpsr);
            gen(state, rt);
            return 1;
        }
        // MSR DAIF, Xt: d51b4220 (op0=3, op1=3, CRn=4, CRm=2, op2=1)
        // Go runtime uses this for async preemption control. NOP in emulation.
        if ((insn & 0xffffffe0) == 0xd51b4220) {
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_msr_daif);
            gen(state, rt);
            return 1;
        }

        // MSR/MRS for TPIDR_EL0 (TLS pointer)
        // MSR: d51bd04t (write Xt to TPIDR_EL0)
        // MRS: d53bd04t (read TPIDR_EL0 to Xt)
        // Check for TPIDR_EL0 encoding: op0=3, op1=3, CRn=13, CRm=0, op2=2
        // Bits: L=0/1, op0=11, op1=011, CRn=1101, CRm=0000, op2=010
        if ((insn & 0xffffffe0) == 0xd51bd040) {
            // MSR TPIDR_EL0, Xt - write TLS pointer
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_msr_tpidr);
            gen(state, rt);
            return 1;
        }
        if ((insn & 0xffffffe0) == 0xd53bd040) {
            // MRS Xt, TPIDR_EL0 - read TLS pointer
            uint32_t rt = insn & 0x1f;
            gen(state, (unsigned long) gadget_mrs_tpidr);
            gen(state, rt);
            return 1;
        }

        // General MRS instruction: d53x xxxx
        // Format: 1101 0101 0011 op0 op1 CRn CRm op2 Rt
        if ((insn & 0xfff00000) == 0xd5300000) {
            uint32_t rt = insn & 0x1f;
            // Extract system register encoding
            // op0[20:19], op1[18:16], CRn[15:12], CRm[11:8], op2[7:5]
            uint32_t op0 = (insn >> 19) & 0x3;
            uint32_t op1 = (insn >> 16) & 0x7;
            uint32_t CRn = (insn >> 12) & 0xf;
            uint32_t CRm = (insn >> 8) & 0xf;
            uint32_t op2 = (insn >> 5) & 0x7;

            int sysreg_id = -1;

            // MIDR_EL1: op0=3, op1=0, CRn=0, CRm=0, op2=0
            // User runtimes such as Zig probe this in CPU model detection paths.
            if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 0 && op2 == 0) {
                sysreg_id = SYSREG_ID_MIDR_EL1;
            }
            // CTR_EL0: op0=3, op1=3, CRn=0, CRm=0, op2=1 (insn & 0xffffffe0 == 0xd53b00e0)
            else if (op0 == 3 && op1 == 3 && CRn == 0 && CRm == 0 && op2 == 1) {
                sysreg_id = SYSREG_ID_CTR_EL0;
            }
            // DCZID_EL0: op0=3, op1=3, CRn=0, CRm=0, op2=7 (insn & 0xffffffe0 == 0xd53b00e0)
            else if (op0 == 3 && op1 == 3 && CRn == 0 && CRm == 0 && op2 == 7) {
                sysreg_id = SYSREG_ID_DCZID_EL0;
            }
            // FPCR: op0=3, op1=3, CRn=4, CRm=4, op2=0
            else if (op0 == 3 && op1 == 3 && CRn == 4 && CRm == 4 && op2 == 0) {
                sysreg_id = SYSREG_ID_FPCR;
            }
            // FPSR: op0=3, op1=3, CRn=4, CRm=4, op2=1
            else if (op0 == 3 && op1 == 3 && CRn == 4 && CRm == 4 && op2 == 1) {
                sysreg_id = SYSREG_ID_FPSR;
            }
            // RNDR: op0=3, op1=3, CRn=2, CRm=4, op2=0 (ARMv8.5-RNG Random Number)
            else if (op0 == 3 && op1 == 3 && CRn == 2 && CRm == 4 && op2 == 0) {
                sysreg_id = SYSREG_ID_RNDR;
            }
            // RNDRRS: op0=3, op1=3, CRn=2, CRm=4, op2=1 (ARMv8.5-RNG Reseeded Random Number)
            else if (op0 == 3 && op1 == 3 && CRn == 2 && CRm == 4 && op2 == 1) {
                sysreg_id = SYSREG_ID_RNDRRS;
            }
            // ID_AA64DFR0/DFR1_EL1: op0=3, op1=0, CRn=0, CRm=5, op2=0/1
            // User runtimes probe these for CPU feature models; report no optional debug features.
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 5 && op2 <= 1) {
                sysreg_id = SYSREG_ID_ZERO;
            }
            // ID_AA64PFR0_EL1: op0=3, op1=0, CRn=0, CRm=4, op2=0
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 4 && op2 == 0) {
                sysreg_id = SYSREG_ID_ID_AA64PFR0_EL1;
            }
            // ID_AA64PFR1_EL1: op0=3, op1=0, CRn=0, CRm=4, op2=1
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 4 && op2 == 1) {
                sysreg_id = SYSREG_ID_ID_AA64PFR1_EL1;
            }
            // ID_AA64ZFR0_EL1: op0=3, op1=0, CRn=0, CRm=4, op2=4
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 4 && op2 == 4) {
                sysreg_id = SYSREG_ID_ID_AA64ZFR0_EL1;
            }
            // ID_AA64ISAR0_EL1: op0=3, op1=0, CRn=0, CRm=6, op2=0
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 6 && op2 == 0) {
                sysreg_id = SYSREG_ID_ID_AA64ISAR0_EL1;
            }
            // ID_AA64ISAR1_EL1: op0=3, op1=0, CRn=0, CRm=6, op2=1
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 6 && op2 == 1) {
                sysreg_id = SYSREG_ID_ID_AA64ISAR1_EL1;
            }
            // ID_AA64MMFR0..3_EL1: op0=3, op1=0, CRn=0, CRm=7, op2=0..3
            // Report no optional memory-model extensions beyond the base ABI.
            else if (op0 == 3 && op1 == 0 && CRn == 0 && CRm == 7 && op2 <= 3) {
                sysreg_id = SYSREG_ID_ZERO;
            }
            // CNTVCT_EL0: op0=3, op1=3, CRn=14, CRm=0, op2=2
            else if (op0 == 3 && op1 == 3 && CRn == 14 && CRm == 0 && op2 == 2) {
                sysreg_id = SYSREG_ID_CNTVCT_EL0;
            }
            // CNTFRQ_EL0: op0=3, op1=3, CRn=14, CRm=0, op2=0
            else if (op0 == 3 && op1 == 3 && CRn == 14 && CRm == 0 && op2 == 0) {
                sysreg_id = SYSREG_ID_CNTFRQ_EL0;
            }

            if (sysreg_id >= 0) {
                gen(state, (unsigned long) gadget_mrs_sysreg);
                gen(state, rt);
                gen(state, sysreg_id);
                return 1;
            }

        }

        gen_interrupt(state, INT_UNDEFINED);
        return 0;
    }

    gen_interrupt(state, INT_UNDEFINED);
    return 0;
}

/*
 * Loads and Stores
 */
static int gen_ldst(struct gen_state *state, uint32_t insn) {
    // Normal-register LDR X unsigned-immediate saves its retry PC in the load
    // gadget itself (as does its LDR+CBZ/CBNZ fusion). Avoid a separate gadget
    // dispatch and code-stream pointer for this common case. All other memory
    // instructions retain the standalone precise-PC save.
    bool inline_load64_pc = (insn & 0xffc00000) == 0xf9400000 &&
                           ((insn >> 5) & 0x1f) != 31 && (insn & 0x1f) != 31;
    if (!inline_load64_pc) {
        gen(state, (unsigned long) gadget_set_jit_saved_pc);
        gen(state, state->orig_ip);
    }
    uint32_t op0 = (insn >> 28) & 0xf;

    // Atomic memory operations (LSE): LDADD/LDCLR/LDEOR/LDSET/LDUMAX/LDUMIN/LDSMAX/LDSMIN/SWP
    // Encoding: size:111000:A:R:1:Rs:op:Rn:Rt (bits29-24=111000, bit21=1, bits11-10=00)
    // A=acquire (bit23), R=release (bit22)
    if ((insn & 0x3f200c00) == 0x38200000) {
        uint32_t size = (insn >> 30) & 0x3;
        uint32_t A = (insn >> 23) & 1;    // acquire
        uint32_t R = (insn >> 22) & 1;    // release
        uint32_t rs = (insn >> 16) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;
        uint32_t op = (insn >> 12) & 0xf;

        // Supported ops: 0-8 (LDADD, LDCLR, LDEOR, LDSET, LDSMAX, LDSMIN, LDUMAX, LDUMIN, SWP)
        if (op > 0x8) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Generate address from Rn
        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (0ULL << 8));  // offset = 0

        if (R) gen(state, (unsigned long) gadget_dmb);  // release barrier before
        // Perform atomic RMW (returns old value in _tmp)
        gen(state, (unsigned long) gadget_atomic_rmw);
        gen(state, rs | ((uint64_t)size << 8) | ((uint64_t)op << 16));
        if (A) gen(state, (unsigned long) gadget_dmb);  // acquire barrier after

        // Store old value to Rt
        gen(state, (unsigned long) gadget_store_reg);
        gen(state, rt);
        return 1;
    }

    // Atomic compare-and-swap pair (CASP/CASPA/CASPL/CASPAL)
    // Encoding overlaps single CAS, but bit23 is clear and size selects
    // pair width: 0 = two 32-bit words, 1 = two 64-bit words.
    if ((insn & 0x3f200c00) == 0x08200c00 && ((insn >> 23) & 1) == 0 &&
            ((insn >> 30) & 0x3) <= 1) {
        uint32_t pair_size = ((insn >> 30) & 0x1) + 2;
        uint32_t A = (insn >> 22) & 1;
        uint32_t R = (insn >> 15) & 1;
        uint32_t rs = (insn >> 16) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (0ULL << 8));
        if (R) gen(state, (unsigned long) gadget_dmb);
        gen(state, (unsigned long) gadget_atomic_casp);
        gen(state, rs | ((uint64_t)rt << 8) | ((uint64_t)pair_size << 16));
        if (A) gen(state, (unsigned long) gadget_dmb);
        return 1;
    }

    // Atomic compare-and-swap (CAS/CASA/CASL/CASAL)
    // Encoding: size:001000:1:A:1:Rs:R:11111:Rn:Rt
    // bit23 is fixed 1 for single-register CAS; A=acquire is bit22,
    // R=release is bit15. Pair exclusives (LDXP/STXP) have the same broad
    // opcode mask but bit23=0 and size=2/3, so keep this predicate narrow.
    if ((insn & 0x3f200c00) == 0x08200c00 && ((insn >> 23) & 1) == 1) {
        uint32_t size = (insn >> 30) & 0x3;
        uint32_t A = (insn >> 22) & 1;    // acquire
        uint32_t R = (insn >> 15) & 1;    // release
        uint32_t rs = (insn >> 16) & 0x1f;  // expected value (and result)
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;          // new value

        // Generate address from Rn
        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (0ULL << 8));  // offset = 0

        if (R) gen(state, (unsigned long) gadget_dmb);  // release barrier before
        // Perform CAS (returns old value in _tmp)
        gen(state, (unsigned long) gadget_atomic_cas);
        gen(state, rs | ((uint64_t)rt << 8) | ((uint64_t)size << 16));
        if (A) gen(state, (unsigned long) gadget_dmb);  // acquire barrier after

        // Store old value back to Rs (CAS writes old value to expected register)
        gen(state, (unsigned long) gadget_store_reg);
        gen(state, rs);
        return 1;
    }

    // LDR (literal) - PC-relative load
    // Encoding: opc 011 V 00 imm19 Rt
    // opc=00: LDR Wt (32-bit) - mask 0xff000000, value 0x18000000
    // opc=01: LDR Xt (64-bit) - mask 0xff000000, value 0x58000000
    // opc=10: LDRSW Xt (signed word) - mask 0xff000000, value 0x98000000
    // V=1 means SIMD/FP register
    if ((insn & 0x3b000000) == 0x18000000) {
        uint32_t opc = (insn >> 30) & 0x3;
        uint32_t V = (insn >> 26) & 1;
        uint32_t rt = insn & 0x1f;
        int32_t imm19 = (insn >> 5) & 0x7ffff;
        // Sign-extend imm19 and multiply by 4
        if (imm19 & 0x40000) imm19 |= (int32_t)~0x7ffff;
        int32_t offset = imm19 << 2;
        // Compute target as full-width address
        addr_t target = state->orig_ip + offset;


        if (V) {
            // SIMD/FP literal load
            // opc=00: LDR St (32-bit float)
            // opc=01: LDR Dt (64-bit float)
            // opc=10: LDR Qt (128-bit)
            gen(state, (unsigned long) gadget_calc_addr_pc_rel);
            gen(state, (unsigned long) target);  // 32-bit guest address

            void *gadget;
            switch (opc) {
                case 0: gadget = gadget_ldr_simd_s; break;
                case 1: gadget = gadget_ldr_simd_d; break;
                case 2: gadget = gadget_ldr_simd_q; break;
                default:
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
            }
            gen(state, (unsigned long) gadget);
            gen(state, rt);
            return 1;
        } else {
            // GPR literal load
            gen(state, (unsigned long) gadget_calc_addr_pc_rel);
            gen(state, (unsigned long) target);  // 32-bit guest address

            void *gadget;
            switch (opc) {
                case 0: gadget = gadget_load32; break;      // LDR Wt
                case 1: gadget = gadget_load64; break;      // LDR Xt
                case 2: gadget = gadget_load32_sx; break;   // LDRSW Xt
                default:
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
            }
            gen(state, (unsigned long) gadget);
            gen(state, (unsigned long) gadget_store_reg);
            gen(state, rt);
            return 1;
        }
    }

    // Load/store register (unsigned immediate)
    if ((insn & 0x3b000000) == 0x39000000) {
        uint32_t size = (insn >> 30) & 0x3;
        uint32_t V = (insn >> 26) & 1;
        uint32_t opc = (insn >> 22) & 0x3;
        uint32_t imm12 = (insn >> 10) & 0xfff;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        if (V) {
            // SIMD/FP load/store unsigned immediate
            // For SIMD, size encodes: 00=B, 01=H, 10=S, 11=D
            // But for Q (128-bit), size=00 and opc[1]=1
            uint32_t scale;
            if (size == 0 && (opc & 2)) {
                // 128-bit (Q register)
                scale = 4;  // 16 bytes = 2^4
            } else {
                scale = size;
            }
            uint64_t offset = imm12 << scale;

            // Generate address calculation
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (offset << 8));

            bool is_load = (opc & 1) == 1;

            if (is_load) {
                // LDR Bt/Ht/St/Dt/Qt
                void *gadget;
                if (size == 0 && (opc & 2)) {
                    gadget = gadget_ldr_simd_q;
                } else {
                    switch (size) {
                        case 0: gadget = gadget_ldr_simd_b; break;
                        case 1: gadget = gadget_ldr_simd_h; break;
                        case 2: gadget = gadget_ldr_simd_s; break;
                        case 3: gadget = gadget_ldr_simd_d; break;
                        default: gen_interrupt(state, INT_UNDEFINED); return 0;
                    }
                }
                gen(state, (unsigned long) gadget);
                gen(state, rt);
            } else {
                // STR Bt/Ht/St/Dt/Qt
                void *gadget;
                if (size == 0 && (opc & 2)) {
                    gadget = gadget_str_simd_q;
                } else {
                    switch (size) {
                        case 0: gadget = gadget_str_simd_b; break;
                        case 1: gadget = gadget_str_simd_h; break;
                        case 2: gadget = gadget_str_simd_s; break;
                        case 3: gadget = gadget_str_simd_d; break;
                        default: gen_interrupt(state, INT_UNDEFINED); return 0;
                    }
                }
                gen(state, (unsigned long) gadget);
                gen(state, rt);
            }
            return 1;
        }

        // PRFM (prefetch memory) - treat as NOP
        if (size == 3 && opc == 2 && V == 0)
            return 1;

        // Calculate scaled offset
        uint64_t offset = imm12 << size;

        bool is_load = (opc & 1) == 1 || (opc & 2) == 2;
        bool sign_extend = (opc & 2) != 0;
        bool extend64 = sign_extend && opc == 2;
        if (is_load) {
            count_ldr_cbz_candidate(state, rn, rt, size, sign_extend);
            if (!sign_extend && size == 3 && try_fuse_ldr64_cbz64(state, rn, rt, imm12) == 0)
                return 0;
            if (!sign_extend && size == 3 && try_fuse_ldr64_sp_cbz64(state, rn, rt, imm12) == 0)
                return 0;
            if (sign_extend && size == 2 && try_fuse_ldr32_sx_cbz64(state, rn, rt, imm12) == 0)
                return 0;
            if (sign_extend && size < 2 && try_fuse_ldr_sx_cbz(state, rn, rt, imm12, size, extend64) == 0)
                return 0;
            if (!sign_extend && size == 2 && try_fuse_ldr32_cbz32(state, rn, rt, imm12) == 0)
                return 0;
            if (!sign_extend && size == 1 && try_fuse_ldr16_cbz32(state, rn, rt, imm12) == 0)
                return 0;
            if (!sign_extend && size == 0 && try_fuse_ldr8_cbz32(state, rn, rt, imm12) == 0)
                return 0;
        }

        // Use fused gadgets for non-sign-extending loads and all stores
        // Sign-extending 8/16-bit loads are less common, keep as 3-gadget
        bool use_fused = true;
        if (is_load && sign_extend && size < 2)
            use_fused = false;

        if (use_fused) {
            // Fused gadget: [gadget addr][rd_or_rt | rn<<8 | offset<<16]
            uint64_t fused_param = (is_load ? rt : rt) | ((uint64_t)rn << 8) | ((uint64_t)offset << 16);

            bool fast = (rn != 31 && rt != 31);
            bool sp_fast = (rn == 31 && rt != 31);
            if (is_load) {
                void *gadget;
                switch (size) {
                    case 0: gadget = fast ? gadget_load8_imm_fast : gadget_load8_imm; break;
                    case 1: gadget = fast ? gadget_load16_imm_fast : gadget_load16_imm; break;
                    case 2: gadget = sign_extend ? gadget_load32_sx_imm :
                                     (fast ? gadget_load32_imm_fast :
                                      (sp_fast ? gadget_load32_sp_imm : gadget_load32_imm)); break;
                    case 3: gadget = fast ? gadget_load64_imm_fast :
                                     (sp_fast ? gadget_load64_sp_imm : gadget_load64_imm); break;
                    default: gen_interrupt(state, INT_UNDEFINED); return 0;
                }
                gen(state, (unsigned long) gadget);
                gen(state, fused_param);
                if (gadget == gadget_load64_imm_fast)
                    gen(state, state->orig_ip);
            } else {
                void *gadget;
                switch (size) {
                    case 0: gadget = fast ? gadget_store8_imm_fast : gadget_store8_imm; break;
                    case 1: gadget = fast ? gadget_store16_imm_fast : gadget_store16_imm; break;
                    case 2: gadget = fast ? gadget_store32_imm_fast :
                                     (sp_fast ? gadget_store32_sp_imm : gadget_store32_imm); break;
                    case 3: gadget = fast ? gadget_store64_imm_fast :
                                     (sp_fast ? gadget_store64_sp_imm : gadget_store64_imm); break;
                    default: gen_interrupt(state, INT_UNDEFINED); return 0;
                }
                gen(state, (unsigned long) gadget);
                gen(state, fused_param);
            }
        } else {
            // Fallback 3-gadget path for sign-extending 8/16-bit loads
            gen(state, (unsigned long) gadget_calc_addr_imm);
            uint64_t param = rn | ((uint64_t)offset << 8);
            gen(state, param);

            bool extend_to_64 = (opc == 2);
            void *gadget;
            switch (size) {
                case 0:
                    gadget = extend_to_64 ? gadget_load8_sx64 : gadget_load8_sx32;
                    break;
                case 1:
                    gadget = extend_to_64 ? gadget_load16_sx64 : gadget_load16_sx32;
                    break;
                default:
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
            }
            gen(state, (unsigned long) gadget);
            gen(state, (unsigned long) gadget_store_reg);
            gen(state, rt);
        }
        return 1;
    }

    // Load/store register (register offset)
    // Pattern: xx111000xx1xxxxx1xx10xxxxxxxxxxx
    if ((insn & 0x3b200c00) == 0x38200800) {
        uint32_t size = (insn >> 30) & 0x3;
        uint32_t V = (insn >> 26) & 1;
        uint32_t opc = (insn >> 22) & 0x3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t option = (insn >> 13) & 0x7;
        uint32_t S = (insn >> 12) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        if (V) {
            // SIMD/FP load/store (register offset)
            bool is_load = (opc & 1);
            bool is_128bit = (size == 0 && (opc & 2));  // Q register
            uint32_t size_bytes = is_128bit ? 16 : (1u << size);
            uint32_t shift = S ? (is_128bit ? 4 : size) : 0;

            // Generate address calculation with register offset
            gen(state, (unsigned long) gadget_calc_addr_reg);
            gen(state, rn | (rm << 8) | (option << 16) | (shift << 24));

            void *gadget;
            if (is_load) {
                switch (size_bytes) {
                    case 1: gadget = gadget_ldr_simd_b; break;
                    case 2: gadget = gadget_ldr_simd_h; break;
                    case 4: gadget = gadget_ldr_simd_s; break;
                    case 8: gadget = gadget_ldr_simd_d; break;
                    case 16: gadget = gadget_ldr_simd_q; break;
                    default:
                        gen_interrupt(state, INT_UNDEFINED);
                        return 0;
                }
            } else {
                switch (size_bytes) {
                    case 1: gadget = gadget_str_simd_b; break;
                    case 2: gadget = gadget_str_simd_h; break;
                    case 4: gadget = gadget_str_simd_s; break;
                    case 8: gadget = gadget_str_simd_d; break;
                    case 16: gadget = gadget_str_simd_q; break;
                    default:
                        gen_interrupt(state, INT_UNDEFINED);
                        return 0;
                }
            }

            gen(state, (unsigned long) gadget);
            gen(state, rt);  // SIMD register number
            return 1;
        }

        // PRFM (prefetch memory, register offset) - treat as NOP
        if (size == 3 && opc == 2 && V == 0)
            return 1;

        // Calculate shift amount based on size and S bit
        uint32_t shift = S ? size : 0;

        bool is_load = (opc == 1) || (opc == 2) || (opc == 3);
        bool sign_extend = (opc >= 2);
        bool extend_to_64 = (opc == 2);

        // Use fused reg-offset gadgets for option==3 (UXTX/LSL, no extend)
        // Sign-extending 8/16-bit loads are rare with register offset, keep as 3-gadget
        bool use_fused_reg = (option == 3);
        if (is_load && sign_extend && size < 2)
            use_fused_reg = false;

        if (use_fused_reg) {
            uint64_t fused_param = rt | ((uint64_t)rn << 8) | ((uint64_t)rm << 16) | ((uint64_t)shift << 24);

            if (is_load) {
                void *gadget;
                switch (size) {
                    case 0: gadget = gadget_load8_reg; break;
                    case 1: gadget = gadget_load16_reg; break;
                    case 2: gadget = sign_extend ? gadget_load32_sx_reg : gadget_load32_reg; break;
                    case 3: gadget = gadget_load64_reg; break;
                    default: gen_interrupt(state, INT_UNDEFINED); return 0;
                }
                gen(state, (unsigned long) gadget);
                gen(state, fused_param);
            } else {
                void *gadget;
                switch (size) {
                    case 0: gadget = gadget_store8_reg; break;
                    case 1: gadget = gadget_store16_reg; break;
                    case 2: gadget = gadget_store32_reg; break;
                    case 3: gadget = gadget_store64_reg; break;
                    default: gen_interrupt(state, INT_UNDEFINED); return 0;
                }
                gen(state, (unsigned long) gadget);
                gen(state, fused_param);
            }
        } else {
            // Fallback 3-gadget path for extend types other than UXTX,
            // and for sign-extending 8/16-bit loads
            gen(state, (unsigned long) gadget_calc_addr_reg);
            gen(state, rn | (rm << 8) | (option << 16) | (shift << 24));

            if (is_load) {
                void *gadget;
                switch (size) {
                    case 0:
                        gadget = sign_extend ? (extend_to_64 ? gadget_load8_sx64 : gadget_load8_sx32) : gadget_load8;
                        break;
                    case 1:
                        gadget = sign_extend ? (extend_to_64 ? gadget_load16_sx64 : gadget_load16_sx32) : gadget_load16;
                        break;
                    case 2:
                        gadget = sign_extend ? gadget_load32_sx : gadget_load32;
                        break;
                    case 3:
                        gadget = gadget_load64;
                        break;
                    default:
                        gen_interrupt(state, INT_UNDEFINED);
                        return 0;
                }
                gen(state, (unsigned long) gadget);
                gen(state, (unsigned long) gadget_store_reg);
                gen(state, rt);
            } else {
                gen(state, (unsigned long) gadget_load_reg);
                gen(state, rt);

                void *gadget;
                switch (size) {
                    case 0: gadget = gadget_store8; break;
                    case 1: gadget = gadget_store16; break;
                    case 2: gadget = gadget_store32; break;
                    case 3: gadget = gadget_store64; break;
                    default:
                        gen_interrupt(state, INT_UNDEFINED);
                        return 0;
                }
                gen(state, (unsigned long) gadget);
            }
        }
        return 1;
    }

    // Load/store pair (LDP/STP)
    // Encoding: xx101xxx_xxxxxxxx_xxxxxxxx_xxxxxxxx
    if ((insn & 0x3a000000) == 0x28000000) {
        uint32_t opc = (insn >> 30) & 0x3;  // size: 00=32-bit, 10=64-bit
        uint32_t V = (insn >> 26) & 1;
        uint32_t mode = (insn >> 23) & 0x7;  // 001=post, 010=signed offset, 011=pre
        uint32_t L = (insn >> 22) & 1;       // 0=store, 1=load
        int32_t imm7 = (int32_t)((insn >> 15) & 0x7f);
        if (imm7 & 0x40) imm7 |= ~0x7f;  // sign-extend
        uint32_t rt2 = (insn >> 10) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        // Compute actual offset (scaled by element size).  For GPR pairs,
        // opc=00 is W LDP/STP, opc=10 is X LDP/STP, and opc=01 with L=1
        // is LDPSW (two sign-extending 32-bit loads into X registers).
        // opc=01 stores and opc=11 GPR pairs are unallocated.
        bool is_ldpsw = (!V && L && opc == 1);
        bool is64 = (V && opc == 1) || (!V && opc == 2);  // SIMD D or GPR X pair
        int64_t offset = (int64_t)imm7 * (is64 ? 8 : 4);

        if (!V && (opc == 3 || (opc == 1 && !L))) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        if (V) {
            // SIMD/FP load/store pair
            // opc=00 -> 32-bit (S), opc=01 -> 64-bit (D), opc=10 -> 128-bit (Q)
            uint32_t size_bytes = (opc == 0) ? 4 : (opc == 1) ? 8 : 16;
            int64_t simd_offset = (int64_t)imm7 * size_bytes;

            bool is_pre = (mode == 3);
            bool is_post = (mode == 1);
            bool is_offset = (mode == 2 || mode == 0); // 000=LDNP/STNP, 010=LDP/STP signed offset

            if (!is_pre && !is_post && !is_offset) {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }

            // Calculate address
            if (is_post) {
                gen(state, (unsigned long) gadget_calc_addr_base);
                gen(state, rn);
            } else {
                gen(state, (unsigned long) gadget_calc_addr_imm);
                gen(state, rn | ((uint64_t)simd_offset << 8));
            }

            // Perform load/store
            void *gadget;
            if (L) {
                switch (opc) {
                    case 0: gadget = gadget_ldp_simd_s; break;
                    case 1: gadget = gadget_ldp_simd_d; break;
                    case 2: gadget = gadget_ldp_simd_q; break;
                    default: gen_interrupt(state, INT_UNDEFINED); return 0;
                }
            } else {
                switch (opc) {
                    case 0: gadget = gadget_stp_simd_s; break;
                    case 1: gadget = gadget_stp_simd_d; break;
                    case 2: gadget = gadget_stp_simd_q; break;
                    default: gen_interrupt(state, INT_UNDEFINED); return 0;
                }
            }
            gen(state, (unsigned long) gadget);
            gen(state, rt | (rt2 << 8));

            // Writeback for pre/post-indexed
            if (is_pre || is_post) {
                if (is_post) {
                    gen(state, (unsigned long) gadget_update_base);
                    gen(state, rn | ((uint64_t)simd_offset << 8));
                } else {
                    gen(state, (unsigned long) gadget_writeback_addr);
                    gen(state, rn);
                }
            }

            return 1;
        }

        // For signed offset mode (010), just calculate address
        // For post-indexed (001), use base first, then update
        // For pre-indexed (011), calculate address first, then use and update

        bool is_pre = (mode == 3);
        bool is_post = (mode == 1);
        bool is_offset = (mode == 2 || mode == 0); // 000=LDNP/STNP, 010=LDP/STP signed offset

        if (!is_pre && !is_post && !is_offset) {
            // Unsupported mode
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Fused path for signed-offset mode (most common LDP/STP encoding)
        if (is_offset) {
            int16_t off16 = (int16_t)offset;
            uint64_t param = (uint64_t)(rt & 0x1f)
                           | ((uint64_t)(rt2 & 0x1f) << 8)
                           | ((uint64_t)(rn & 0x1f) << 16)
                           | (((uint64_t)(uint16_t)off16) << 24);
            bool fast_pair = rn != 31 && rt != 31 && rt2 != 31;
            void *gadget;
            if (L) {
                if (is_ldpsw)
                    gadget = fast_pair ? gadget_ldpsw_imm_fast : gadget_ldpsw_imm;
                else
                    gadget = fast_pair ? (is64 ? gadget_ldp64_imm_fast : gadget_ldp32_imm_fast)
                                       : (is64 ? gadget_ldp64_imm : gadget_ldp32_imm);
            } else {
                gadget = fast_pair ? (is64 ? gadget_stp64_imm_fast : gadget_stp32_imm_fast)
                                   : (is64 ? gadget_stp64_imm : gadget_stp32_imm);
            }
            gen(state, (unsigned long) gadget);
            gen(state, param);
            return 1;
        }

        // Pre/post-indexed: use separate calc_addr + ldp/stp + writeback

        // Step 1: Calculate address
        if (is_post) {
            // Post-indexed: use base register directly
            gen(state, (unsigned long) gadget_calc_addr_base);
            gen(state, rn);
        } else {
            // Pre-indexed: add offset to base
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | ((uint64_t)offset << 8));
        }

        // Step 2: Perform the load/store pair
        if (L) {
            gen(state, (unsigned long) (is_ldpsw ? gadget_ldpsw : (is64 ? gadget_ldp64 : gadget_ldp32)));
        } else {
            gen(state, (unsigned long) (is64 ? gadget_stp64 : gadget_stp32));
        }
        gen(state, rt | (rt2 << 8));

        // Step 3: Writeback for pre/post-indexed
        if (is_post) {
            gen(state, (unsigned long) gadget_update_base);
            gen(state, rn | ((uint64_t)offset << 8));
        } else {
            // Pre-indexed: writeback calculated address
            gen(state, (unsigned long) gadget_writeback_addr);
            gen(state, rn);
        }

        return 1;
    }

    // Load/store register (immediate pre/post-indexed)
    // Pattern: xx111000xx0xxxxxxxxx[01|11]xxxxxxxxxx
    if ((insn & 0x3b200000) == 0x38000000) {
        uint32_t size = (insn >> 30) & 0x3;
        uint32_t V = (insn >> 26) & 1;
        uint32_t opc = (insn >> 22) & 0x3;
        int32_t imm9 = (int32_t)((insn >> 12) & 0x1ff);
        // Sign-extend imm9 from 9 bits
        if (imm9 & 0x100) imm9 |= ~0x1ff;
        uint32_t mode = (insn >> 10) & 0x3;  // 01=post-indexed, 11=pre-indexed
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;


        if (V) {
            // SIMD/FP load/store with unscaled immediate or pre/post-indexed
            // size: 00=B, 01=H, 10=S, 11=D
            // opc: 00=store, 01=load, 10=store (128-bit if size=00), 11=load (128-bit if size=00)
            bool is_load = (opc & 1);
            bool is_128bit = (size == 0 && (opc & 2));  // Q register

            uint32_t size_bytes;
            if (is_128bit) {
                size_bytes = 16;
            } else {
                size_bytes = (1 << size);  // 1, 2, 4, or 8 bytes
            }

            // Calculate address (same as GPR case)
            bool is_unscaled = (mode == 0);
            bool is_pre = (mode == 3);

            if (is_pre || is_unscaled) {
                gen(state, (unsigned long) gadget_calc_addr_imm);
                gen(state, rn | ((int64_t)(int32_t)imm9 << 8));
            } else if (mode == 1) {
                // Post-indexed
                gen(state, (unsigned long) gadget_calc_addr_base);
                gen(state, rn);
            } else {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }

            void *gadget;
            if (is_load) {
                switch (size_bytes) {
                    case 1: gadget = gadget_ldr_simd_b; break;
                    case 2: gadget = gadget_ldr_simd_h; break;
                    case 4: gadget = gadget_ldr_simd_s; break;
                    case 8: gadget = gadget_ldr_simd_d; break;
                    case 16: gadget = gadget_ldr_simd_q; break;
                    default:
                        gen_interrupt(state, INT_UNDEFINED);
                        return 0;
                }
            } else {
                switch (size_bytes) {
                    case 1: gadget = gadget_str_simd_b; break;
                    case 2: gadget = gadget_str_simd_h; break;
                    case 4: gadget = gadget_str_simd_s; break;
                    case 8: gadget = gadget_str_simd_d; break;
                    case 16: gadget = gadget_str_simd_q; break;
                    default:
                        gen_interrupt(state, INT_UNDEFINED);
                        return 0;
                }
            }

            gen(state, (unsigned long) gadget);
            gen(state, rt);  // SIMD register number

            // Handle writeback for pre/post-indexed modes
            // Use update_base to preserve full 64-bit register semantics
            if (mode == 1 || mode == 3) {
                gen(state, (unsigned long) gadget_update_base);
                gen(state, rn | ((int64_t)(int32_t)imm9 << 8));
            }

            return 1;
        }

        // mode: 0=unscaled(STUR/LDUR), 1=post-indexed, 2=unprivileged, 3=pre-indexed

        // PRFM (prefetch memory, unscaled/pre/post) - treat as NOP
        if (size == 3 && opc == 2 && V == 0)
            return 1;

        if (mode == 2) {
            // Unprivileged access - not implemented
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        bool is_pre_indexed = (mode == 3);
        bool is_unscaled = (mode == 0);  // STUR/LDUR - offset applied, no writeback
        bool is_load = (opc == 1) || (opc == 2) || (opc == 3);

        // Calculate address:
        // - mode=0 (unscaled): address = base + offset (no writeback)
        // - mode=1 (post-indexed): address = base (base+offset for writeback)
        // - mode=3 (pre-indexed): address = base + offset (same for writeback)
        if (is_pre_indexed || is_unscaled) {
            // Pre-indexed or unscaled: address = base + offset
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | ((int64_t)(int32_t)imm9 << 8));
        } else {
            // Post-indexed: address = base only
            gen(state, (unsigned long) gadget_calc_addr_base);
            gen(state, rn);
        }

        if (is_load) {
            void *gadget;
            bool sign_extend = (opc >= 2);
            bool extend_to_64 = (opc == 2);

            switch (size) {
                case 0:  // Byte
                    gadget = sign_extend ? (extend_to_64 ? gadget_load8_sx64 : gadget_load8_sx32) : gadget_load8;
                    break;
                case 1:  // Halfword
                    gadget = sign_extend ? (extend_to_64 ? gadget_load16_sx64 : gadget_load16_sx32) : gadget_load16;
                    break;
                case 2:  // Word
                    gadget = sign_extend ? gadget_load32_sx : gadget_load32;
                    break;
                case 3:  // Doubleword
                    gadget = gadget_load64;
                    break;
                default:
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
            }
            gen(state, (unsigned long) gadget);
            gen(state, (unsigned long) gadget_store_reg);
            gen(state, rt);
        } else {
            // Store
            gen(state, (unsigned long) gadget_load_reg);
            gen(state, rt);

            void *gadget;
            switch (size) {
                case 0: gadget = gadget_store8; break;
                case 1: gadget = gadget_store16; break;
                case 2: gadget = gadget_store32; break;
                case 3: gadget = gadget_store64; break;
                default:
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
            }
            gen(state, (unsigned long) gadget);
        }

        // Writeback to base register (only for pre/post-indexed, not unscaled)
        if (!is_unscaled) {
            if (is_pre_indexed) {
                // Pre-indexed: base = address (which is base + offset)
                gen(state, (unsigned long) gadget_writeback_addr);
                gen(state, rn);
            } else {
                // Post-indexed: base = base + offset
                gen(state, (unsigned long) gadget_update_base);
                gen(state, rn | ((int64_t)(int32_t)imm9 << 8));
            }
        }

        return 1;
    }

    // Load/store exclusive (LDXR, STXR, LDAXR, STLXR, etc.)
    // Encoding: size:001000:o2:L:o1:Rs:o0:Rt2:Rn:Rt
    // For single-threaded emulation, we can treat these as simple loads/stores
    if ((insn & 0x3f000000) == 0x08000000) {
        uint32_t size = (insn >> 30) & 0x3;
        uint32_t o2 = (insn >> 23) & 1;
        uint32_t L = (insn >> 22) & 1;
        uint32_t o1 = (insn >> 21) & 1;
        uint32_t rs = (insn >> 16) & 0x1f;
        uint32_t o0 = (insn >> 15) & 1;
        uint32_t rt2 = (insn >> 10) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        // o0: acquire/release flag — o0=1 means LDAXR/STLXR (with barrier)

        // o2=1: STLR/LDAR/LDLAR/STLLR — non-exclusive, non-pair load/store with
        // acquire/release semantics (always have barrier).
        // o2=0, o1=1: STXP/LDXP/STLXP/LDAXP — exclusive pair operations.
        // o2=0, o1=0: STXR/LDXR/STLXR/LDAXR — exclusive register operations.

        // Handle pair exclusives (LDXP/STXP/LDAXP/STLXP): o2=0, o1=1
        if (o2 == 0 && o1 == 1) {
            // Generate address from Rn
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));  // offset = 0

            if (L) {
                // LDXP/LDAXP - Load pair via C helper
                if (size != 2 && size != 3) {
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
                }
                gen(state, (unsigned long) gadget_ldxp_c);
                gen(state, rt | ((uint64_t)rt2 << 8) | ((uint64_t)size << 16));
                if (o0) gen(state, (unsigned long) gadget_dmb);  // LDAXP: acquire
            } else {
                if (o0) gen(state, (unsigned long) gadget_dmb);  // STLXP: release
                // STXP/STLXP - Pair store exclusive with status result in Rs
                gen(state, (unsigned long) gadget_stxp_c);
                gen(state, rs | ((uint64_t)rt << 8) | ((uint64_t)rt2 << 16) | ((uint64_t)size << 24));
            }
            return 1;
        }

        // For non-pair operations (o2=0, o1=0 OR o2=1), fall through to
        // load/store handling. Ignore Rt2 field (it should be 11111
        // for non-pair, but some compilers emit non-standard values).

        if (o2 == 1) {
            // STLR/LDAR/LDLAR/STLLR — non-exclusive, non-pair
            // With acquire/release memory ordering via DMB barriers.
            // Guest threads share host memory, so real barriers are required.
            if (L) {
                // LDAR (load-acquire): load + DMB after
                gen(state, (unsigned long) gadget_calc_addr_imm);
                gen(state, rn | (0ULL << 8));
                void (*load_gadget)(void) = NULL;
                switch (size) {
                case 0: load_gadget = gadget_load8; break;
                case 1: load_gadget = gadget_load16; break;
                case 2: load_gadget = gadget_load32; break;
                case 3: load_gadget = gadget_load64; break;
                }
                gen(state, (unsigned long) load_gadget);
                gen(state, (unsigned long) gadget_dmb);
                gen(state, (unsigned long) gadget_store_reg);
                gen(state, rt);
            } else {
                // STLR (store-release): DMB before + store
                gen(state, (unsigned long) gadget_load_reg);
                gen(state, rt);
                gen(state, (unsigned long) gadget_calc_addr_imm);
                gen(state, rn | (0ULL << 8));
                gen(state, (unsigned long) gadget_dmb);
                void (*store_gadget)(void) = NULL;
                switch (size) {
                case 0: store_gadget = gadget_store8; break;
                case 1: store_gadget = gadget_store16; break;
                case 2: store_gadget = gadget_store32; break;
                case 3: store_gadget = gadget_store64; break;
                }
                gen(state, (unsigned long) store_gadget);
                // No Rs writeback for STLR/STLLR (non-exclusive)
            }
        } else if (L) {
            // LDXR/LDAXR - Load exclusive
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));  // offset = 0
            gen(state, (unsigned long) gadget_ldxr);
            gen(state, rt | ((uint64_t)size << 8));
            if (o0) gen(state, (unsigned long) gadget_dmb);  // LDAXR: acquire
        } else {
            // STXR/STLXR - Store exclusive
            if (o0) gen(state, (unsigned long) gadget_dmb);  // STLXR: release
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));  // offset = 0
            gen(state, (unsigned long) gadget_stxr);
            gen(state, rt | ((uint64_t)rs << 8) | ((uint64_t)size << 16));
        }
        return 1;
    }

    // AdvSIMD load/store multiple structures (no post-index)
    // Handles both non-interleaved (LD1/ST1) and interleaved (LD2/ST2/LD3/ST3/LD4/ST4)
    // Pattern: 0 Q 001100 0 L 0 00000 opcode size Rn Rt
    if ((insn & 0xbfbf0000) == 0x0c000000) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t L = (insn >> 22) & 1;
        uint32_t opcode = (insn >> 12) & 0xf;
        uint32_t size = (insn >> 10) & 3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        // Non-interleaved: LD1/ST1
        int num_regs = 0;
        if (opcode == 0x7) num_regs = 1;
        else if (opcode == 0xa) num_regs = 2;
        else if (opcode == 0x6) num_regs = 3;
        else if (opcode == 0x2) num_regs = 4;

        if (num_regs > 0) {
            int bytes_per_reg = Q ? 16 : 8;
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));
            for (int i = 0; i < num_regs; i++) {
                uint32_t vt = (rt + i) & 0x1f;
                if (L) {
                    gen(state, (unsigned long) (Q ? gadget_ldr_simd_q : gadget_ldr_simd_d));
                    gen(state, vt);
                } else {
                    gen(state, (unsigned long) (Q ? gadget_str_simd_q : gadget_str_simd_d));
                    gen(state, vt);
                }
                if (i < num_regs - 1) {
                    gen(state, (unsigned long) gadget_advance_addr);
                    gen(state, bytes_per_reg);
                }
            }
            return 1;
        }

        // Interleaved: LD2/ST2 (opcode=0x8), LD3/ST3 (opcode=0x4), LD4/ST4 (opcode=0x0)
        int interleave_regs = 0;
        if (opcode == 0x8) interleave_regs = 2;
        else if (opcode == 0x4) interleave_regs = 3;
        else if (opcode == 0x0) interleave_regs = 4;

        if (interleave_regs > 0) {
            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));
            uint64_t param = rt | ((uint64_t)interleave_regs << 8) |
                             ((uint64_t)size << 16) | ((uint64_t)Q << 24);
            if (L) {
                gen(state, (unsigned long) gadget_simd_load_interleaved);
            } else {
                gen(state, (unsigned long) gadget_simd_store_interleaved);
            }
            gen(state, param);
            return 1;
        }

        gen_interrupt(state, INT_UNDEFINED);
        return 0;
    }

    // AdvSIMD load/store multiple structures (post-indexed)
    // Handles both non-interleaved (LD1/ST1) and interleaved (LD2-4/ST2-4)
    if ((insn & 0xbfa00000) == 0x0c800000) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t L = (insn >> 22) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 12) & 0xf;
        uint32_t size = (insn >> 10) & 3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        // Non-interleaved: LD1/ST1
        int num_regs = 0;
        if (opcode == 0x7) num_regs = 1;
        else if (opcode == 0xa) num_regs = 2;
        else if (opcode == 0x6) num_regs = 3;
        else if (opcode == 0x2) num_regs = 4;

        int interleave_regs = 0;
        if (opcode == 0x8) interleave_regs = 2;
        else if (opcode == 0x4) interleave_regs = 3;
        else if (opcode == 0x0) interleave_regs = 4;

        int effective_regs = num_regs ? num_regs : interleave_regs;
        if (effective_regs == 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        int bytes_per_reg = Q ? 16 : 8;
        int total_bytes = bytes_per_reg * effective_regs;

        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (0ULL << 8));

        if (num_regs > 0) {
            // Non-interleaved path
            for (int i = 0; i < num_regs; i++) {
                uint32_t vt = (rt + i) & 0x1f;
                if (L) {
                    gen(state, (unsigned long) (Q ? gadget_ldr_simd_q : gadget_ldr_simd_d));
                    gen(state, vt);
                } else {
                    gen(state, (unsigned long) (Q ? gadget_str_simd_q : gadget_str_simd_d));
                    gen(state, vt);
                }
                if (i < num_regs - 1) {
                    gen(state, (unsigned long) gadget_advance_addr);
                    gen(state, bytes_per_reg);
                }
            }
        } else {
            // Interleaved path
            uint64_t param = rt | ((uint64_t)interleave_regs << 8) |
                             ((uint64_t)size << 16) | ((uint64_t)Q << 24);
            if (L) {
                gen(state, (unsigned long) gadget_simd_load_interleaved);
            } else {
                gen(state, (unsigned long) gadget_simd_store_interleaved);
            }
            gen(state, param);
        }

        // Post-index writeback
        if (rm == 31) {
            gen(state, (unsigned long) gadget_update_base);
            gen(state, rn | ((uint64_t)total_bytes << 8));
        } else {
            gen(state, (unsigned long) gadget_update_base_reg);
            gen(state, rn | (rm << 8));
        }
        return 1;
    }

    // LD/ST (single structure) - Advanced SIMD load/store single element
    // Pattern: 0 Q 001101 0 L R 0 xxxx opcode S size Rn Rt
    // Includes LD1/ST1 single element + LDnR (load and replicate)
    // Fixed bits: bit[31]=0, bits[29:24]=001101, bit[23]=0
    // Mask: 0xbf800000, expected: 0x0d000000
    if ((insn & 0xbf800000) == 0x0d000000) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t L = (insn >> 22) & 1;
        uint32_t R = (insn >> 21) & 1;
        uint32_t opcode = (insn >> 13) & 0x7;
        uint32_t S = (insn >> 12) & 1;
        uint32_t size = (insn >> 10) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        // LDnR: Load single element and replicate to all lanes of n registers
        // opcode=6,R=0 → LD1R; opcode=6,R=1 → LD2R
        // opcode=7,R=0 → LD3R; opcode=7,R=1 → LD4R
        if ((opcode == 6 || opcode == 7) && S == 0 && L == 1) {
            void *gadget;
            if (opcode == 6 && R == 0) { gadget = gadget_ld1r_vec; }
            else if (opcode == 6 && R == 1) { gadget = gadget_ld2r_vec; }
            else if (opcode == 7 && R == 0) { gadget = gadget_ld3r_vec; }
            else { gadget = gadget_ld4r_vec; }

            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));
            gen(state, (unsigned long) gadget);
            gen(state, rt | (size << 8) | (Q << 16));
            return 1;
        }

        // Number of registers from R and opcode:
        // R=0, even opcode(0/2/4): LD1/ST1 (1 reg)
        // R=1, even opcode(0/2/4): LD2/ST2 (2 regs)
        // R=0, odd opcode(1/3/5):  LD3/ST3 (3 regs)
        // R=1, odd opcode(1/3/5):  LD4/ST4 (4 regs)
        int num_regs;
        int base_opcode = opcode;
        if (opcode & 1) {
            num_regs = R ? 4 : 3;
            base_opcode = opcode - 1;
        } else {
            num_regs = R ? 2 : 1;
        }

        int elem_size = 0;
        int lane = 0;

        if (base_opcode == 0) {
            elem_size = 1;
            lane = (Q << 3) | (S << 2) | size;
        } else if (base_opcode == 2 && (size & 1) == 0) {
            elem_size = 2;
            lane = (Q << 2) | (S << 1) | (size >> 1);
        } else if (base_opcode == 4 && size == 0) {
            elem_size = 4;
            lane = (Q << 1) | S;
        } else if (base_opcode == 4 && size == 1) {
            elem_size = 8;
            lane = Q;
        } else {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        int lane_offset = lane * elem_size;

        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (0ULL << 8));

        for (int i = 0; i < num_regs; i++) {
            if (i > 0) {
                gen(state, (unsigned long) gadget_addr_add_imm);
                gen(state, (uint64_t)elem_size);
            }
            uint32_t vr = (rt + i) % 32;
            if (L) {
                if (elem_size == 1)
                    gen(state, (unsigned long) gadget_ld1_single_b);
                else if (elem_size == 2)
                    gen(state, (unsigned long) gadget_ld1_single_h);
                else if (elem_size == 4)
                    gen(state, (unsigned long) gadget_ld1_single_s);
                else
                    gen(state, (unsigned long) gadget_ld1_single_d);
            } else {
                if (elem_size == 1)
                    gen(state, (unsigned long) gadget_st1_single_b);
                else if (elem_size == 2)
                    gen(state, (unsigned long) gadget_st1_single_h);
                else if (elem_size == 4)
                    gen(state, (unsigned long) gadget_st1_single_s);
                else
                    gen(state, (unsigned long) gadget_st1_single_d);
            }
            gen(state, vr | (lane_offset << 8));
        }
        return 1;
    }

    // LD/ST (single structure, post-indexed) - with register or immediate post-index
    // Pattern: 0 Q 001101 1 L R Rm opcode S size Rn Rt  (bit23=1)
    // Mask: 0xbf800000, expected: 0x0d800000
    if ((insn & 0xbf800000) == 0x0d800000) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t L = (insn >> 22) & 1;
        uint32_t R = (insn >> 21) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 13) & 0x7;
        uint32_t S = (insn >> 12) & 1;
        uint32_t size = (insn >> 10) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt = insn & 0x1f;

        // LDnR post-indexed: Load single element and replicate to all lanes
        if ((opcode == 6 || opcode == 7) && S == 0 && L == 1) {
            int num_regs;
            void *gadget;
            if (opcode == 6 && R == 0) { num_regs = 1; gadget = gadget_ld1r_vec; }
            else if (opcode == 6 && R == 1) { num_regs = 2; gadget = gadget_ld2r_vec; }
            else if (opcode == 7 && R == 0) { num_regs = 3; gadget = gadget_ld3r_vec; }
            else { num_regs = 4; gadget = gadget_ld4r_vec; }

            int ldnr_elem_size = 1 << size;
            int total_bytes = ldnr_elem_size * num_regs;

            gen(state, (unsigned long) gadget_calc_addr_imm);
            gen(state, rn | (0ULL << 8));
            gen(state, (unsigned long) gadget);
            gen(state, rt | (size << 8) | (Q << 16));

            // Post-index writeback
            if (rm == 31) {
                gen(state, (unsigned long) gadget_update_base);
                gen(state, rn | ((uint64_t)total_bytes << 8));
            } else {
                gen(state, (unsigned long) gadget_update_base_reg);
                gen(state, rn | (rm << 8));
            }
            return 1;
        }

        // Number of registers (same logic as non-post-indexed)
        int num_regs;
        int base_opcode = opcode;
        if (opcode & 1) {
            num_regs = R ? 4 : 3;
            base_opcode = opcode - 1;
        } else {
            num_regs = R ? 2 : 1;
        }

        int elem_size = 0;
        int lane = 0;

        if (base_opcode == 0) {
            elem_size = 1;
            lane = (Q << 3) | (S << 2) | size;
        } else if (base_opcode == 2 && (size & 1) == 0) {
            elem_size = 2;
            lane = (Q << 2) | (S << 1) | (size >> 1);
        } else if (base_opcode == 4 && size == 0) {
            elem_size = 4;
            lane = (Q << 1) | S;
        } else if (base_opcode == 4 && size == 1) {
            elem_size = 8;
            lane = Q;
        } else {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        int lane_offset = lane * elem_size;
        int total_bytes = elem_size * num_regs;

        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (0ULL << 8));

        for (int i = 0; i < num_regs; i++) {
            if (i > 0) {
                gen(state, (unsigned long) gadget_addr_add_imm);
                gen(state, (uint64_t)elem_size);
            }
            uint32_t vr = (rt + i) % 32;
            if (L) {
                if (elem_size == 1)
                    gen(state, (unsigned long) gadget_ld1_single_b);
                else if (elem_size == 2)
                    gen(state, (unsigned long) gadget_ld1_single_h);
                else if (elem_size == 4)
                    gen(state, (unsigned long) gadget_ld1_single_s);
                else
                    gen(state, (unsigned long) gadget_ld1_single_d);
            } else {
                if (elem_size == 1)
                    gen(state, (unsigned long) gadget_st1_single_b);
                else if (elem_size == 2)
                    gen(state, (unsigned long) gadget_st1_single_h);
                else if (elem_size == 4)
                    gen(state, (unsigned long) gadget_st1_single_s);
                else
                    gen(state, (unsigned long) gadget_st1_single_d);
            }
            gen(state, vr | (lane_offset << 8));
        }

        // Post-index writeback
        if (rm == 31) {
            // Immediate: increment by total bytes (num_regs * elem_size)
            gen(state, (unsigned long) gadget_update_base);
            gen(state, rn | ((uint64_t)total_bytes << 8));
        } else {
            // Register: increment by Xm
            gen(state, (unsigned long) gadget_update_base_reg);
            gen(state, rn | (rm << 8));
        }
        return 1;
    }

    (void)op0;
    gen_interrupt(state, INT_UNDEFINED);
    return 0;
}

/*
 * Data Processing (Register)
 */
static int gen_dp_reg(struct gen_state *state, uint32_t insn) {
    uint32_t op0 = (insn >> 30) & 1;
    uint32_t op1 = (insn >> 28) & 1;
    uint32_t op2 = (insn >> 21) & 0xf;

    // Logical (shifted register)
    if (op1 == 0 && (op2 & 0x8) == 0) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t opc = (insn >> 29) & 0x3;
        uint32_t shift = (insn >> 22) & 0x3;
        uint32_t N = (insn >> 21) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t imm6 = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (!sf && imm6 >= 32) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Handle shifted case for logical ops
        if (shift != 0 || imm6 != 0) {
            void *gadget = NULL;
            switch (opc) {
                case 0: gadget = gadget_and_reg_shifted; break; // AND/BIC
                case 1: gadget = gadget_orr_reg_shifted; break; // ORR/ORN
                case 2: gadget = gadget_eor_reg_shifted; break; // EOR/EON
                case 3: gadget = gadget_and_reg_shifted; break; // ANDS/BICS
                default:
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
            }

            gen(state, (unsigned long) gadget);
            // Pack: rd(0-4), rn(8-12), rm(16-20), sf(24), S(25), N(26), shift_type(27-28)
            uint64_t param = rd | (rn << 8) | (rm << 16) | ((uint64_t)sf << 24)
                | ((opc == 3) ? (1UL << 25) : 0) | ((uint64_t)N << 26) | ((uint64_t)shift << 27);
            gen(state, param);
            gen(state, imm6);  // shift amount as second parameter
            return 1;
        }

        // Fast path: MOV Xd, Xm is ORR Xd, XZR, Xm (opc=1, N=0, rn=31)
        if (opc == 1 && N == 0 && rn == 31 && rd != 31 && rm != 31) {
            gen(state, (unsigned long)(sf ? gadget_mov_reg : gadget_mov_reg32));
            gen(state, rd | (rm << 16));
            return 1;
        }

        // Fast path: EOR/ORR/AND Xd, Xn, Xn (rn==rm, N=0) → known result
        // EOR: Xd = Xn ^ Xn = 0 (clear register)
        // ORR: Xd = Xn | Xn = Xn (MOV)
        // AND: Xd = Xn & Xn = Xn (MOV)
        if (rn == rm && N == 0 && opc != 3) {
            if (opc == 2 && rd != 31) {
                // EOR Xd, Xn, Xn → Xd = 0
                gen(state, (unsigned long) gadget_movz);
                gen(state, rd | (0 << 8) | (0ULL << 16) | ((uint64_t)sf << 32));
                return 1;
            }
            if ((opc == 0 || opc == 1) && rd != 31 && rn != 31) {
                // AND/ORR Xd, Xn, Xn → Xd = Xn (MOV)
                gen(state, (unsigned long)(sf ? gadget_mov_reg : gadget_mov_reg32));
                gen(state, rd | (rn << 16));
                return 1;
            }
        }

        void *gadget;
        switch (opc) {
            case 0: gadget = N ? gadget_and_reg : gadget_and_reg; break;  // AND/BIC
            case 1: gadget = N ? gadget_orr_reg : gadget_orr_reg; break;  // ORR/ORN
            case 2: gadget = N ? gadget_eor_reg : gadget_eor_reg; break;  // EOR/EON
            case 3: gadget = N ? gadget_and_reg : gadget_and_reg; break;  // ANDS/BICS
            default:
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
        }

        gen(state, (unsigned long) gadget);
        // Pack: rd(0-4), rn(8-12), rm(16-20), sf(24), S(25), N(26)
        uint64_t param = rd | (rn << 8) | (rm << 16) | ((uint64_t)sf << 24) | ((opc == 3) ? (1UL << 25) : 0) | ((uint64_t)N << 26);
        gen(state, param);
        return 1;
    }

    // Add/subtract (shifted register)
    if (op1 == 0 && (op2 & 0x9) == 0x8) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t op = (insn >> 30) & 1;
        uint32_t S = (insn >> 29) & 1;
        uint32_t shift = (insn >> 22) & 0x3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t imm6 = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (shift == 3) {
            // shift == 3 is reserved for ADD/SUB shifted register
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // imm6 validation: for 32-bit, imm6 must be < 32
        if (!sf && imm6 >= 32) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Try specialized 64-bit fast paths (no shift, no XZR operands)
        bool can_spec_reg = sf && imm6 == 0 && rn != 31 && rm != 31;
        if (can_spec_reg && S && op == 1) {
            // Try fused SUBS_reg + B.cond
            int fused = try_fuse_subs_reg_bcond(state, rd, rn, rm);
            if (fused == 0) return 0;
        }
        if (can_spec_reg && S) {
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_subs_reg_64_nshift : gadget_adds_reg_64_nshift));
            gen(state, rd | (rn << 8) | (rm << 16));
            return 1;
        }
        if (can_spec_reg && !S && rd != 31) {
            ARM64_FUSION_STAT_INC(arm64_fusion_addsub_fast_count);
            gen(state, (unsigned long)(op ? gadget_sub_reg_64_nshift : gadget_add_reg_64_nshift));
            gen(state, rd | (rn << 8) | (rm << 16));
            return 1;
        }

        // Generic path: handles 32-bit, shifted, XZR/SP cases
        void *gadget;
        if (S) {
            // Flag-setting versions (ADDS, SUBS, CMP, CMN)
            gadget = op ? gadget_subs_reg : gadget_adds_reg;
        } else {
            gadget = op ? gadget_sub_reg : gadget_add_reg;
        }
        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | sf<<24 | S<<25 | shift_type<<26 | imm6<<32
        gen(state, rd | (rn << 8) | (rm << 16) | ((uint64_t)sf << 24) | ((uint64_t)S << 25) | ((uint64_t)shift << 26) | ((uint64_t)imm6 << 32));
        return 1;
    }

    // Add/subtract (extended register)
    // Pattern: sf:op:S:01011:00:1:Rm:option:imm3:Rn:Rd
    if ((insn & 0x1f200000) == 0x0b200000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t op = (insn >> 30) & 1;  // 0=ADD, 1=SUB
        uint32_t S = (insn >> 29) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t option = (insn >> 13) & 0x7;
        uint32_t imm3 = (insn >> 10) & 0x7;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // Select gadget based on op and S bits
        void *gadget;
        if (S) {
            // Flag-setting versions (ADDS_ext, SUBS_ext, CMN_ext, CMP_ext)
            gadget = op ? gadget_subs_ext : gadget_adds_ext;
        } else {
            gadget = op ? gadget_sub_ext : gadget_add_ext;
        }
        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | option<<24 | imm3<<27 | sf<<30
        gen(state, rd | (rn << 8) | (rm << 16) | ((uint64_t)option << 24) | ((uint64_t)imm3 << 27) | ((uint64_t)sf << 30));
        return 1;
    }

    // Add/subtract with carry (ADC/ADCS/SBC/SBCS)
    // Pattern: sf:op:S:11010000:Rm:000000:Rn:Rd
    // Mask: bits[28:21]=0xd0 and bits[15:10]=0x00 -> (insn & 0x1fe0fc00) == 0x1a000000
    if ((insn & 0x1fe0fc00) == 0x1a000000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t op = (insn >> 30) & 1;  // 0=ADC/ADCS, 1=SBC/SBCS
        uint32_t S = (insn >> 29) & 1;   // 1=update flags
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        void *gadget = op ? gadget_sbc_reg : gadget_adc_reg;
        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | sf<<24 | S<<25
        gen(state, rd | (rn << 8) | (rm << 16) | ((uint64_t)sf << 24) | ((uint64_t)S << 25));
        return 1;
    }

    // Conditional compare (CCMP, CCMN) register/immediate
    // Pattern: sf:op:S:11010010:Rm/imm5:cond:o2:0:Rn:0:nzcv
    // bits[28:21]=0xd2, bit[29]=1 (S), bit[10]=0, bit[4]=0
    // bit 11 distinguishes register (0) vs immediate (1) form
    if ((insn & 0x3fe00410) == 0x3a400000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t op = (insn >> 30) & 1;  // 0=CCMN, 1=CCMP
        uint32_t is_imm = (insn >> 11) & 1;
        uint32_t rm_or_imm5 = (insn >> 16) & 0x1f;
        uint32_t cond = (insn >> 12) & 0xf;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t nzcv = insn & 0xf;

        void *gadget = NULL;
        if (is_imm) {
            gadget = op ? gadget_ccmp_imm : gadget_ccmn_imm;
        } else {
            gadget = op ? gadget_ccmp_reg : gadget_ccmn_reg;
        }
        gen(state, (unsigned long) gadget);
        // Pack: rn | (rm/imm5)<<8 | cond<<16 | nzcv<<20 | sf<<24
        gen(state, rn | (rm_or_imm5 << 8) | (cond << 16) | (nzcv << 20) | ((uint64_t)sf << 24));
        return 1;
    }

    // Conditional select (CSEL, CSINC, CSINV, CSNEG)
    // Pattern: sf:op:S:11010100:Rm:cond:op2:Rn:Rd
    // Mask out: sf, op, Rm, cond, op2, Rn, Rd - only check S=0 and fixed bits
    if ((insn & 0x1fe00000) == 0x1a800000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t op = (insn >> 30) & 1;
        uint32_t S = (insn >> 29) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t cond = (insn >> 12) & 0xf;
        uint32_t op2_sel = (insn >> 10) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (S != 0) {
            // S must be 0 for conditional select
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        uint32_t variant = (op << 1) | op2_sel;
        switch (variant) {
            case 0: gadget = gadget_csel; break;   // op=0, op2=0: CSEL
            case 1: gadget = gadget_csinc; break;  // op=0, op2=1: CSINC
            case 2: gadget = gadget_csinv; break;  // op=1, op2=0: CSINV
            case 3: gadget = gadget_csneg; break;  // op=1, op2=1: CSNEG
        }

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (rm << 16) | (cond << 24) | ((uint64_t)sf << 28));
        return 1;
    }

    // Data-processing (2 source)
    // Pattern: sf:0:S:11010110:Rm:opcode[5:0]:Rn:Rd
    if ((insn & 0x5fe00000) == 0x1ac00000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t S = (insn >> 29) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (S != 0) {
            // S must be 0 for these instructions
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Try 64-bit fast path for shifts (sf=1, rd/rn/rm != 31)
        bool shift_fast = sf && rd != 31 && rn != 31 && rm != 31;
        if (shift_fast) {
            void *fast = NULL;
            switch (opcode) {
                case 0x08: fast = gadget_lslv_64; break;
                case 0x09: fast = gadget_lsrv_64; break;
                case 0x0a: fast = gadget_asrv_64; break;
            }
            if (fast) {
                gen(state, (unsigned long) fast);
                gen(state, rd | (rn << 8) | (rm << 16));
                return 1;
            }
        }

        // Generic path
        void *gadget = NULL;
        switch (opcode) {
            case 0x02: gadget = gadget_udiv; break;  // UDIV
            case 0x03: gadget = gadget_sdiv; break;  // SDIV
            case 0x08: gadget = gadget_lslv; break;  // LSLV (LSL register)
            case 0x09: gadget = gadget_lsrv; break;  // LSRV (LSR register)
            case 0x0a: gadget = gadget_asrv; break;  // ASRV (ASR register)
            case 0x0b: gadget = gadget_rorv; break;  // RORV (ROR register)
            case 0x10: gadget = gadget_crc32b; break;
            case 0x11: gadget = gadget_crc32h; break;
            case 0x12: gadget = gadget_crc32w; break;
            case 0x13: if (!sf) { gen_interrupt(state, INT_UNDEFINED); return 0; } gadget = gadget_crc32x; break;
            case 0x14: gadget = gadget_crc32cb; break;
            case 0x15: gadget = gadget_crc32ch; break;
            case 0x16: gadget = gadget_crc32cw; break;
            case 0x17: if (!sf) { gen_interrupt(state, INT_UNDEFINED); return 0; } gadget = gadget_crc32cx; break;
            default:
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
        }

        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | sf<<24
        gen(state, rd | (rn << 8) | (rm << 16) | ((uint64_t)sf << 24));
        return 1;
    }

    // Data-processing (1 source)
    // Encoding: sf:1:S:11010110:opcode2:opcode:rn:rd
    // op0 (bit 30) = 1 distinguishes from 2-source (op0=0)
    // bits 28:21 = 11010110 = 0xd6, so op2 (bits 24:21) = 0x6
    if (op0 == 1 && op1 == 1 && op2 == 0x6) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t S = (insn >> 29) & 1;
        uint32_t opcode2 = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // S must be 0 for valid 1-source instructions
        if (S != 0 || opcode2 != 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void (*gadget)(void) = NULL;

        switch (opcode) {
        case 0x00:  // RBIT
            gadget = gadget_rbit;
            break;
        case 0x01:  // REV16
            gadget = gadget_rev16;
            break;
        case 0x02:  // REV (32-bit) / REV32 (64-bit)
            if (sf == 0)
                gadget = gadget_rev;  // REV for 32-bit
            else
                gadget = gadget_rev32; // REV32 for 64-bit (reverses 32-bit halves)
            break;
        case 0x03:  // REV (64-bit only)
            if (sf == 1)
                gadget = gadget_rev;
            break;
        case 0x04:  // CLZ
            gadget = gadget_clz;
            break;
        case 0x05:  // CLS
            gadget = gadget_cls;
            break;
        default:
            break;
        }

        if (gadget == NULL) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | sf<<24
        gen(state, rd | (rn << 8) | ((uint64_t)sf << 24));
        return 1;
    }

    // Data-processing (3 source) - MUL, MADD, MSUB, SMULL, UMULL, etc.
    // Encoding: sf:0:op54:11011:op31:rm:o0:Ra:rn:rd
    if (op1 == 1 && (op2 & 0x8) == 0x8) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t op54 = (insn >> 29) & 0x3;
        uint32_t op31 = (insn >> 21) & 0x7;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t o0 = (insn >> 15) & 1;
        uint32_t ra = (insn >> 10) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        void *gadget = NULL;

        if (op54 == 0) {
            if (sf == 1 && op31 == 0) {
                // 64-bit MADD/MSUB
                gadget = o0 ? gadget_msub : gadget_madd;
            } else if (sf == 0 && op31 == 0) {
                // 32-bit MADD/MSUB
                gadget = o0 ? gadget_msub : gadget_madd;
            } else if (sf == 1 && op31 == 1) {
                // SMADDL/SMSUBL (signed 32x32->64)
                gadget = o0 ? gadget_smsubl : gadget_smaddl;
            } else if (sf == 1 && op31 == 2) {
                // SMULH (signed high multiply)
                gadget = gadget_smulh;
                // For SMULH, ra is not used but we still pack rd, rn, rm
            } else if (sf == 1 && op31 == 5) {
                // UMADDL/UMSUBL (unsigned 32x32->64)
                gadget = o0 ? gadget_umsubl : gadget_umaddl;
            } else if (sf == 1 && op31 == 6) {
                // UMULH (unsigned high multiply)
                gadget = gadget_umulh;
                // For UMULH, ra is not used but we still pack rd, rn, rm
            }
        }

        if (gadget == NULL) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | ra<<24 | sf<<29
        gen(state, rd | (rn << 8) | (rm << 16) | ((uint64_t)ra << 24) | ((uint64_t)sf << 29));
        return 1;
    }

    (void)op0;
    gen_interrupt(state, INT_UNDEFINED);
    return 0;
}

/*
 * SIMD and Floating-Point
 *
 * This implements a minimal subset needed for musl's memset:
 * - DUP Vd.16B, Wn (or Xn)
 * - MOV Xd, Vn.D[0]
 * - STR Qn, [Xbase, #imm]
 * - STUR Qn, [Xbase, #imm]
 * - STP Qn, Qm, [Xbase, #imm]
 */
static int gen_simd_fp(struct gen_state *state, uint32_t insn) {
    // FMOV (immediate) - scalar floating-point immediate
    // Pattern: 0b00011110 0/1 1 0 imm8 10000 Rd
    // Mask 0xffa07fe0 ignores imm8 (bits 20-13), Rd (bits 4-0), and type (bit 22)
    if ((insn & 0xffa07fe0) == 0x1e201000) {
        uint32_t rd = insn & 0x1f;
        bool is_double = (insn & 0x00400000) != 0;  // type bit: 1=double, 0=single
        uint8_t imm8_raw = (insn >> 13) & 0xff;
        uint8_t imm8 = imm8_raw ^ 0x40;  // Invert bit6 per ARM FP immediate encoding
        uint64_t bits = arm64_fpimm_to_bits(is_double, imm8);
        uint64_t lo = is_double ? bits : (uint64_t)(uint32_t)bits;

        gen(state, (unsigned long) gadget_set_vec_imm);
        gen(state, rd);
        gen(state, lo);
        gen(state, 0);
        return 1;
    }

    // FMOV (register) - scalar FP register copy
    // Matches: 0b00011110 type 1 00 0 0 0 0 0 Rn Rd (FMOV scalar)
    // Mask 0xffbffc00 ignores Rn/Rd and type
    if ((insn & 0xffbffc00) == 0x1e204000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        bool is_double = (insn & 0x00400000) != 0;  // type bit: 1=double, 0=single
        gen(state, (unsigned long) gadget_fmov_fp_to_fp);
        gen(state, rd | (rn << 8) | ((uint64_t)is_double << 16));
        return 1;
    }

    // MOV/INS (element) - insert GPR into vector element (D size)
    // Encoding: 0100_1110_000x_1000_0001_1100_Rn_Rd (MOV Vd.D[idx], Xn)
    // imm5 = x1000 for D elements (bit 3 set, bits 2:0 clear), x = index
    // Mask 0xffe0fc00 keeps bits 31:21 and 15:10
    // Also check bits 19:16 = 1000 (0x8) for D size
    if ((insn & 0xffe0fc00) == 0x4e001c00 && ((insn >> 16) & 0xf) == 0x8) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t idx = (insn >> 20) & 0x1;  // D element index (0 or 1)
        gen(state, (unsigned long) gadget_ins_gpr_to_vec_d);
        gen(state, rd | (rn << 8) | (idx << 16));
        return 1;
    }

    // MOV/INS (element) - insert GPR into vector element (S size)
    // Matches: 0b01001110 0001 1xx0 0001 1100 Rn Rd (MOV Vd.S[idx], Wn)
    // Mask 0xffe7fc00 ignores Rd/Rn/index bits
    if ((insn & 0xffe7fc00) == 0x4e041c00) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t idx = (insn >> 19) & 0x3;  // S element index
        gen(state, (unsigned long) gadget_ins_gpr_to_vec_s);
        gen(state, rd | (rn << 8) | (idx << 16));
        return 1;
    }

    // MOV/INS (general) - insert GPR into vector element (H size)
    // imm5 bit pattern: xxx10 for H elements (bit 1 set, bit 0 clear)
    // Encoding: 0100 1110 000 imm5 0 0011 1 Rn Rd, where imm5 & 3 == 2
    if ((insn & 0xffe0fc00) == 0x4e001c00 && ((insn >> 16) & 0x3) == 0x2) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t idx = (imm5 >> 2) & 0x7;  // H element index (0..7)
        gen(state, (unsigned long) gadget_ins_gpr_to_vec_h);
        gen(state, rd | (rn << 8) | (idx << 16));
        return 1;
    }

    // MOV/INS (general) - insert GPR into vector element (B size)
    // imm5 bit pattern: xxxx1 for B elements (bit 0 set)
    if ((insn & 0xffe0fc00) == 0x4e001c00 && ((insn >> 16) & 0x1) == 0x1) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t idx = (imm5 >> 1) & 0xf;  // B element index (0..15)
        gen(state, (unsigned long) gadget_ins_gpr_to_vec_b);
        gen(state, rd | (rn << 8) | (idx << 16));
        return 1;
    }

    // SHL (vector, immediate) - shift left immediate
    // 0 Q U 0 1 1 1 1 0 immh immb 0 1 0 1 0 1 Rn Rd  (U=0 for SHL)
    // immh:immb encodes the shift and element size
    // For 16B/8B (bytes): immh=0001, shift = immh:immb - 8 (0-7)
    // For 8H/4H (halfwords): immh=001x, shift = immh:immb - 16 (0-15)
    // For 4S/2S (words): immh=01xx, shift = immh:immb - 32 (0-31)
    // For 2D/1D (doublewords): immh=1xxx, shift = immh:immb - 64 (0-63)
    // Mask: 0xbf80fc00 keeps bit 31, U, bits 28-23, and opcode; Value: 0x0f005400
    // NOTE: immh must be non-zero for SHL; immh=0 encodes MOVI/MVNI instead
    if ((insn & 0xbf80fc00) == 0x0f005400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            // Determine element size and shift from immh
            uint32_t esize, shift;
            if (immh & 0x8) {           // 64-bit
                esize = 3;
                shift = ((immh << 3) | immb) - 64;
            } else if (immh & 0x4) {    // 32-bit
                esize = 2;
                shift = ((immh << 3) | immb) - 32;
            } else if (immh & 0x2) {    // 16-bit
                esize = 1;
                shift = ((immh << 3) | immb) - 16;
            } else {                    // 8-bit (immh & 0x1)
                esize = 0;
                shift = ((immh << 3) | immb) - 8;
            }

            gen(state, (unsigned long) gadget_shl_imm_vec);
            // Pack: rd | rn<<8 | shift<<16 | esize<<24 | Q<<28
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
        // Fall through to MOVI/MVNI handler when immh=0
    }

    // USHR (vector, immediate) - unsigned shift right immediate
    // 0 Q U 0 1 1 1 1 0 immh immb 0 0 0 0 0 1 Rn Rd  (U=1 for USHR)
    // Mask: 0xbf80fc00, Value: 0x2f000400
    // NOTE: immh must be non-zero for USHR; immh=0 encodes MOVI/MVNI instead
    if ((insn & 0xbf80fc00) == 0x2f000400) {
        uint32_t immh = (insn >> 19) & 0xf;
        // immh=0 is not a valid shift encoding - this is MOVI/MVNI, not USHR
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            uint32_t esize, shift;
            if (immh & 0x8) {
                esize = 3;
                shift = 128 - ((immh << 3) | immb);  // USHR: shift = 2*esize - imm
            } else if (immh & 0x4) {
                esize = 2;
                shift = 64 - ((immh << 3) | immb);
            } else if (immh & 0x2) {
                esize = 1;
                shift = 32 - ((immh << 3) | immb);
            } else {
                esize = 0;
                shift = 16 - ((immh << 3) | immb);
            }

            gen(state, (unsigned long) gadget_ushr_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
        // Fall through to MOVI/MVNI handler when immh=0
    }

    // SSHR (vector, immediate) - signed shift right immediate
    // 0 Q U 0 1 1 1 1 0 immh immb 0 0 0 0 0 1 Rn Rd  (U=0 for SSHR)
    // Mask: 0xbf80fc00, Value: 0x0f000400
    // IMPORTANT: immh must be non-zero for SSHR; immh=0 encodes MOVI/MVNI instead
    if ((insn & 0xbf80fc00) == 0x0f000400) {
        uint32_t immh = (insn >> 19) & 0xf;
        // immh=0 is not a valid shift encoding - this is MOVI/MVNI, not SSHR
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            uint32_t esize, shift;
            if (immh & 0x8) {
                esize = 3;
                shift = 128 - ((immh << 3) | immb);
            } else if (immh & 0x4) {
                esize = 2;
                shift = 64 - ((immh << 3) | immb);
            } else if (immh & 0x2) {
                esize = 1;
                shift = 32 - ((immh << 3) | immb);
            } else {
                esize = 0;
                shift = 16 - ((immh << 3) | immb);
            }

            gen(state, (unsigned long) gadget_sshr_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
        // Fall through to MOVI/MVNI handler when immh=0
    }

    // USRA (vector, immediate) - unsigned shift right and accumulate
    // 0 Q 1 0 1 1 1 1 0 immh immb 0 0 0 1 0 1 Rn Rd  (U=1, opcode=00010)
    // Mask: 0xbf80fc00, Value: 0x2f001400
    // NOTE: immh must be non-zero (immh=0 encodes other instructions)
    if ((insn & 0xbf80fc00) == 0x2f001400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            uint32_t esize, shift;
            if (immh & 0x8) {
                esize = 3;
                shift = 128 - ((immh << 3) | immb);
            } else if (immh & 0x4) {
                esize = 2;
                shift = 64 - ((immh << 3) | immb);
            } else if (immh & 0x2) {
                esize = 1;
                shift = 32 - ((immh << 3) | immb);
            } else {
                esize = 0;
                shift = 16 - ((immh << 3) | immb);
            }

            gen(state, (unsigned long) gadget_usra_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
        // Fall through when immh=0 - might be another instruction
    }

    // SSRA (vector, immediate) - signed shift right and accumulate
    // 0 Q 0 0 1 1 1 1 0 immh immb 0 0 0 1 0 1 Rn Rd  (U=0, opcode=00010)
    // Mask: 0xbf80fc00, Value: 0x0f001400
    // NOTE: Like SSHR, immh must be non-zero (immh=0 encodes other instructions)
    if ((insn & 0xbf80fc00) == 0x0f001400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            uint32_t esize, shift;
            if (immh & 0x8) {
                esize = 3;
                shift = 128 - ((immh << 3) | immb);
            } else if (immh & 0x4) {
                esize = 2;
                shift = 64 - ((immh << 3) | immb);
            } else if (immh & 0x2) {
                esize = 1;
                shift = 32 - ((immh << 3) | immb);
            } else {
                esize = 0;
                shift = 16 - ((immh << 3) | immb);
            }

            gen(state, (unsigned long) gadget_ssra_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // SRSHR (vector, immediate) - signed rounding shift right
    // 0 Q 0 01111 0 immh immb 00100 1 Rn Rd  (U=0, opcode=00100)
    // Mask: 0xbf80fc00, Value: 0x0f002400
    if ((insn & 0xbf80fc00) == 0x0f002400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;
            uint32_t esize, shift;
            if (immh & 0x8) { esize = 3; shift = 128 - ((immh << 3) | immb); }
            else if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
            else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
            else { esize = 0; shift = 16 - ((immh << 3) | immb); }
            gen(state, (unsigned long) gadget_srshr_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // URSHR (vector, immediate) - unsigned rounding shift right
    // 0 Q 1 01111 0 immh immb 00100 1 Rn Rd  (U=1, opcode=00100)
    // Mask: 0xbf80fc00, Value: 0x2f002400
    if ((insn & 0xbf80fc00) == 0x2f002400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;
            uint32_t esize, shift;
            if (immh & 0x8) { esize = 3; shift = 128 - ((immh << 3) | immb); }
            else if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
            else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
            else { esize = 0; shift = 16 - ((immh << 3) | immb); }
            gen(state, (unsigned long) gadget_urshr_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // SRSRA (vector, immediate) - signed rounding shift right and accumulate
    // 0 Q 0 01111 0 immh immb 00110 1 Rn Rd  (U=0, opcode=00110)
    // Mask: 0xbf80fc00, Value: 0x0f003400
    if ((insn & 0xbf80fc00) == 0x0f003400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;
            uint32_t esize, shift;
            if (immh & 0x8) { esize = 3; shift = 128 - ((immh << 3) | immb); }
            else if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
            else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
            else { esize = 0; shift = 16 - ((immh << 3) | immb); }
            gen(state, (unsigned long) gadget_srsra_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // URSRA (vector, immediate) - unsigned rounding shift right and accumulate
    // 0 Q 1 01111 0 immh immb 00110 1 Rn Rd  (U=1, opcode=00110)
    // Mask: 0xbf80fc00, Value: 0x2f003400
    if ((insn & 0xbf80fc00) == 0x2f003400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;
            uint32_t esize, shift;
            if (immh & 0x8) { esize = 3; shift = 128 - ((immh << 3) | immb); }
            else if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
            else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
            else { esize = 0; shift = 16 - ((immh << 3) | immb); }
            gen(state, (unsigned long) gadget_ursra_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // SHRN/SHRN2 (vector, immediate) - shift right narrow
    // 0 Q 0 01111 0 immh immb 10000 1 Rn Rd  (U=0, opcode=10000)
    // Mask: 0xbf80fc00, Value: 0x0f008400
    if ((insn & 0xbf80fc00) == 0x0f008400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;
            uint32_t esize, shift;
            if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
            else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
            else { esize = 0; shift = 16 - ((immh << 3) | immb); }
            gen(state, (unsigned long) gadget_shrn_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // RSHRN/RSHRN2 (vector, immediate) - rounding shift right narrow
    // 0 Q 0 01111 0 immh immb 10001 1 Rn Rd  (U=0, opcode=10001)
    // Mask: 0xbf80fc00, Value: 0x0f008c00
    if ((insn & 0xbf80fc00) == 0x0f008c00) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;
            uint32_t esize, shift;
            if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
            else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
            else { esize = 0; shift = 16 - ((immh << 3) | immb); }
            gen(state, (unsigned long) gadget_rshrn_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // Saturating shift-right-narrow instructions (shift-by-immediate)
    // All use mask 0xbf80fc00, immh != 0
    // UQRSHRN: 0x2f009c00, SQRSHRN: 0x0f009c00
    // UQSHRN: 0x2f009400, SQSHRN: 0x0f009400
    // SQSHRUN: 0x2f008400, SQRSHRUN: 0x2f008c00
    {
        uint32_t masked = insn & 0xbf80fc00;
        void *sat_gadget = NULL;
        if      (masked == 0x2f009c00) sat_gadget = gadget_uqrshrn_vec;
        else if (masked == 0x0f009c00) sat_gadget = gadget_sqrshrn_vec;
        else if (masked == 0x2f009400) sat_gadget = gadget_uqshrn_vec;
        else if (masked == 0x0f009400) sat_gadget = gadget_sqshrn_vec;
        else if (masked == 0x2f008400) sat_gadget = gadget_sqshrun_vec;
        else if (masked == 0x2f008c00) sat_gadget = gadget_sqrshrun_vec;
        if (sat_gadget) {
            uint32_t immh = (insn >> 19) & 0xf;
            if (immh != 0) {
                uint32_t Q = (insn >> 30) & 1;
                uint32_t immb = (insn >> 16) & 0x7;
                uint32_t rd = insn & 0x1f;
                uint32_t rn = (insn >> 5) & 0x1f;
                uint32_t esize, shift;
                if (immh & 0x4) { esize = 2; shift = 64 - ((immh << 3) | immb); }
                else if (immh & 0x2) { esize = 1; shift = 32 - ((immh << 3) | immb); }
                else { esize = 0; shift = 16 - ((immh << 3) | immb); }
                gen(state, (unsigned long) sat_gadget);
                gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
                return 1;
            }
        }
    }

    // SRI (vector, immediate) - shift right and insert
    // 0 Q 1 01111 0 immh immb 01000 1 Rn Rd  (U=1, opcode=01000)
    // Mask: 0xbf80fc00, Value: 0x2f004400
    if ((insn & 0xbf80fc00) == 0x2f004400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            uint32_t esize, shift;
            if (immh & 0x8) {
                esize = 3;
                shift = 128 - ((immh << 3) | immb);
            } else if (immh & 0x4) {
                esize = 2;
                shift = 64 - ((immh << 3) | immb);
            } else if (immh & 0x2) {
                esize = 1;
                shift = 32 - ((immh << 3) | immb);
            } else {
                esize = 0;
                shift = 16 - ((immh << 3) | immb);
            }

            gen(state, (unsigned long) gadget_sri_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // SLI (vector, immediate) - shift left and insert
    // 0 Q 1 01111 0 immh immb 01010 1 Rn Rd  (U=1, opcode=01010)
    // Mask: 0xbf80fc00, Value: 0x2f005400
    if ((insn & 0xbf80fc00) == 0x2f005400) {
        uint32_t immh = (insn >> 19) & 0xf;
        if (immh != 0) {
            uint32_t Q = (insn >> 30) & 1;
            uint32_t immb = (insn >> 16) & 0x7;
            uint32_t rd = insn & 0x1f;
            uint32_t rn = (insn >> 5) & 0x1f;

            uint32_t esize, shift;
            if (immh & 0x8) {
                esize = 3;
                shift = ((immh << 3) | immb) - 64;
            } else if (immh & 0x4) {
                esize = 2;
                shift = ((immh << 3) | immb) - 32;
            } else if (immh & 0x2) {
                esize = 1;
                shift = ((immh << 3) | immb) - 16;
            } else {
                esize = 0;
                shift = ((immh << 3) | immb) - 8;
            }

            gen(state, (unsigned long) gadget_sli_imm_vec);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24) | (Q << 28));
            return 1;
        }
    }

    // SSHLL/USHLL/SSHLL2/USHLL2 (vector, immediate) - signed/unsigned shift left long
    // Encoding: 0 Q U 011110 immh immb 10100 1 Rn Rd
    // Mask 0x8f80fc00 checks bit31=0,bits[28:23]=011110,opcode=10100,bit10=1
    // Q at bit 30: 0=lower half (SSHLL/USHLL), 1=upper half (SSHLL2/USHLL2)
    // U at bit 29 distinguishes signed/unsigned
    // immh determines size: 0001=B->H, 001x=H->S, 01xx=S->D
    if ((insn & 0x8f80fc00) == 0x0f00a400) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t immh = (insn >> 19) & 0xf;
        uint32_t immb = (insn >> 16) & 0x7;
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        int immhb = (immh << 3) | immb;
        int shift = 0;
        void *gadget = NULL;

        if (immh & 0x4) {
            // S->D: immh=01xx
            shift = immhb - 32;
            if (Q == 0)
                gadget = U ? gadget_ushll_vec_s_to_d : gadget_sshll_vec_s_to_d;
            else
                gadget = U ? gadget_ushll2_vec_s_to_d : gadget_sshll2_vec_s_to_d;
        } else if (immh & 0x2) {
            // H->S: immh=001x
            shift = immhb - 16;
            if (Q == 0)
                gadget = U ? gadget_ushll_vec_h_to_s : gadget_sshll_vec_h_to_s;
            else
                gadget = U ? gadget_ushll2_vec_h_to_s : gadget_sshll2_vec_h_to_s;
        } else if (immh & 0x1) {
            // B->H: immh=0001
            shift = immhb - 8;
            if (Q == 0)
                gadget = U ? gadget_ushll_vec_b_to_h : gadget_sshll_vec_b_to_h;
            else
                gadget = U ? gadget_ushll2_vec_b_to_h : gadget_sshll2_vec_b_to_h;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8) | (shift << 16));
            return 1;
        }
    }

    // DUP (element) - duplicate vector element to vector
    // Pattern: 0 Q 0 0 1 1 1 0 0 0 0 imm5 0 0 0 0 0 1 Rn Rd
    // imm5[4:0] determines element size and index:
    //   xxxx1 = B, index = imm5[4:1]
    //   xxx10 = H, index = imm5[4:2]
    //   xx100 = S, index = imm5[4:3]
    //   x1000 = D, index = imm5[4]
    if ((insn & 0xbfe0fc00) == 0x0e000400) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;

        // Determine element size and index from imm5
        int elem_size = -1;
        int index = 0;
        if (imm5 & 0x1) {
            elem_size = 0;  // B
            index = (imm5 >> 1) & 0xf;
        } else if (imm5 & 0x2) {
            elem_size = 1;  // H
            index = (imm5 >> 2) & 0x7;
        } else if (imm5 & 0x4) {
            elem_size = 2;  // S
            index = (imm5 >> 3) & 0x3;
        } else if (imm5 & 0x8) {
            elem_size = 3;  // D
            index = (imm5 >> 4) & 0x1;
        }

        if (elem_size < 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget_dup_elem_vec);
        // Pack: rd | rn<<8 | elem_size<<16 | index<<20 | Q<<24
        gen(state, rd | (rn << 8) | (elem_size << 16) | (index << 20) | (Q << 24));
        return 1;
    }

    // DUP (element, scalar) - duplicate vector element to scalar register
    // Pattern: 01 0 11110 000 imm5 0 00001 Rn Rd
    // Mask 0xffe0fc00 checks fixed bits, ignores imm5, Rn, Rd
    if ((insn & 0xffe0fc00) == 0x5e000400) {
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;

        // Determine element size and index from imm5
        int elem_size = -1;
        int index = 0;
        if (imm5 & 0x1) {
            elem_size = 0;  // B
            index = (imm5 >> 1) & 0xf;
        } else if (imm5 & 0x2) {
            elem_size = 1;  // H
            index = (imm5 >> 2) & 0x7;
        } else if (imm5 & 0x4) {
            elem_size = 2;  // S
            index = (imm5 >> 3) & 0x3;
        } else if (imm5 & 0x8) {
            elem_size = 3;  // D
            index = (imm5 >> 4) & 0x1;
        }

        if (elem_size < 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget_dup_elem_scalar);
        // Pack: rd | rn<<8 | elem_size<<16 | index<<20
        gen(state, rd | (rn << 8) | (elem_size << 16) | (index << 20));
        return 1;
    }

    // INS (element) - insert vector element into another vector element
    // Pattern: 0 1 1 0 1 1 1 0 0 0 0 imm5 0 imm4 1 Rn Rd
    // imm5 determines dst element size and index
    // imm4 determines src element index
    if ((insn & 0xffe08400) == 0x6e000400) {
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t imm4 = (insn >> 11) & 0xf;
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;

        // Determine element size and indices
        int elem_size = -1;
        int dst_idx = 0;
        int src_idx = 0;
        if (imm5 & 0x1) {
            elem_size = 0;  // B
            dst_idx = (imm5 >> 1) & 0xf;
            src_idx = imm4 & 0xf;
        } else if (imm5 & 0x2) {
            elem_size = 1;  // H
            dst_idx = (imm5 >> 2) & 0x7;
            src_idx = (imm4 >> 1) & 0x7;
        } else if (imm5 & 0x4) {
            elem_size = 2;  // S
            dst_idx = (imm5 >> 3) & 0x3;
            src_idx = (imm4 >> 2) & 0x3;
        } else if (imm5 & 0x8) {
            elem_size = 3;  // D
            dst_idx = (imm5 >> 4) & 0x1;
            src_idx = (imm4 >> 3) & 0x1;
        }

        if (elem_size < 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget_ins_elem_vec);
        // Pack: rd | rn<<8 | elem_size<<16 | dst_idx<<20 | src_idx<<24
        gen(state, rd | (rn << 8) | (elem_size << 16) | (dst_idx << 20) | (src_idx << 24));
        return 1;
    }

    // DUP (general) - duplicate general-purpose register to vector
    // Pattern: 0 Q 0 0 1 1 1 0 0 0 0 imm5 0 0 0 0 1 1 Rn Rd
    // imm5[4:0] determines element size:
    //   xxxxx1 = B (byte)
    //   xxxx10 = H (halfword)
    //   xxx100 = S (word)
    //   xx1000 = D (doubleword)
    if ((insn & 0xbfe0fc00) == 0x0e000c00) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;

        // Determine element size from imm5
        int elem_size = -1;
        if (imm5 & 0x1) elem_size = 0;       // B (byte)
        else if (imm5 & 0x2) elem_size = 1;  // H (halfword)
        else if (imm5 & 0x4) elem_size = 2;  // S (word)
        else if (imm5 & 0x8) elem_size = 3;  // D (doubleword)

        if (elem_size < 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Generate a general DUP gadget that takes element size as parameter
        gen(state, (unsigned long) gadget_dup_gpr_to_vec);
        gen(state, rd | (rn << 8) | (elem_size << 16) | (Q << 24));
        return 1;
    }

    // UMOV/MOV (to general) - extract vector element to GPR
    // For MOV Xd, Vn.D[0]: 0x4e083c00 | (Rn << 5) | Rd
    // Pattern: 0Q001110 imm5 0 01111 Rn Rd
    // Q=1, imm5[4:0]=01000 means D[0]
    if ((insn & 0xffe0fc00) == 0x4e083c00) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        gen(state, (unsigned long) gadget_mov_v_to_gpr);
        gen(state, rd | (rn << 8));
        return 1;
    }

    // SMOV (to general) - extract vector element to GPR with sign extension
    // Matches: 0Q001110 0imm5 0 01011 Rn Rd
    if ((insn & 0xbfe0fc00) == 0x0e002c00) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        int elem_size = -1;
        if (imm5 & 0x1) elem_size = 0;       // B
        else if (imm5 & 0x2) elem_size = 1;  // H
        else if (imm5 & 0x4) elem_size = 2;  // S

        if (elem_size < 0 || (elem_size == 2 && !Q)) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        uint32_t index = imm5 >> (elem_size + 1);
        uint32_t max_elems = 16u >> elem_size;
        if (index >= max_elems) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget_umov_vec_to_gpr);
        gen(state, rd | (rn << 8) | (elem_size << 16) | (index << 20));
        gen(state, (unsigned long) gadget_load_reg);
        gen(state, rd);
        if (elem_size == 0) {
            gen(state, (unsigned long) gadget_sxtb);
            gen(state, Q);
        } else if (elem_size == 1) {
            gen(state, (unsigned long) gadget_sxth);
            gen(state, Q);
        } else {
            gen(state, (unsigned long) gadget_sxtw);
        }
        gen(state, (unsigned long) gadget_store_reg);
        gen(state, rd);
        return 1;
    }

    // UMOV/MOV (to general) - extract vector element to GPR
    // Matches: 0Q001110 0imm5 0 01111 Rn Rd (UMOV/MOV scalar from vector)
    if ((insn & 0xbfe0fc00) == 0x0e003c00) {
        uint32_t imm5 = (insn >> 16) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        int elem_size = -1;
        if (imm5 & 0x1) elem_size = 0;       // B
        else if (imm5 & 0x2) elem_size = 1;  // H
        else if (imm5 & 0x4) elem_size = 2;  // S
        else if (imm5 & 0x8) elem_size = 3;  // D

        if (elem_size < 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        uint32_t index = imm5 >> (elem_size + 1);
        uint32_t max_elems = 16u >> elem_size;
        if (index >= max_elems) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget_umov_vec_to_gpr);
        // Pack: rd | rn<<8 | elem_size<<16 | index<<20
        gen(state, rd | (rn << 8) | (elem_size << 16) | (index << 20));
        return 1;
    }

    // STR (vector, immediate) - store 128-bit
    // Pattern: 00111101 10 imm12 Rn Rt (scaled offset)
    // Mask: check bits 31:30=00, 29:22=0x3d8 for Q variant
    if ((insn & 0xffc00000) == 0x3d800000) {
        uint32_t rt = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t imm12 = (insn >> 10) & 0xfff;
        // Offset is imm12 * 16 for Q register
        int64_t offset = (int64_t)imm12 * 16;
        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (offset << 8));
        gen(state, (unsigned long) gadget_str_q);
        gen(state, rt);
        return 1;
    }

    // STUR (vector, unscaled) - store 128-bit with unscaled offset
    // Pattern: 00111100 10 0 imm9 00 Rn Rt
    if ((insn & 0xffe00c00) == 0x3c800000) {
        uint32_t rt = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        int32_t imm9 = ((int32_t)(insn >> 12) << 23) >> 23;  // Sign-extend
        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | ((int64_t)imm9 << 8));
        gen(state, (unsigned long) gadget_str_q);
        gen(state, rt);
        return 1;
    }

    // STP (vector, signed offset) - store pair of 128-bit
    // Pattern: 10101101 opc imm7 Rt2 Rn Rt
    // opc=01 for signed offset
    if ((insn & 0xffc00000) == 0xad000000) {
        uint32_t rt = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rt2 = (insn >> 10) & 0x1f;
        int32_t imm7 = ((int32_t)(insn >> 15) << 25) >> 25;  // Sign-extend
        // Offset is imm7 * 16 for Q registers
        int64_t offset = (int64_t)imm7 * 16;
        gen(state, (unsigned long) gadget_calc_addr_imm);
        gen(state, rn | (offset << 8));
        gen(state, (unsigned long) gadget_stp_q);
        gen(state, rt | (rt2 << 8));
        return 1;
    }

    // MOVI/MVNI - Modified immediate (for zeroing vectors)
    // Pattern: 0 Q op 0111100000 a b c cmode 01 d e f g h Rd
    // For MOVI/MVNI with imm=0: the main variants are:
    // Advanced SIMD modified immediate (MOVI/MVNI/ORR/BIC)
    // Mask: 0x9ff80c00 - preserves bit 31, 28-19, 11-10; ignores Q(30), op(29), abc(18-16), cmode(15-12), defgh(9-5), Rd(4-0)
    if ((insn & 0x9ff80c00) == 0x0f000400) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t op = (insn >> 29) & 1;  // 0=MOVI/ORR, 1=MVNI/BIC (except for cmode=0xe/0xf)
        uint32_t cmode = (insn >> 12) & 0xf;
        uint32_t rd = insn & 0x1f;

        // Extract immediate from abc:defgh
        uint32_t a = (insn >> 18) & 1;
        uint32_t b = (insn >> 17) & 1;
        uint32_t c = (insn >> 16) & 1;
        uint32_t d = (insn >> 9) & 1;
        uint32_t e = (insn >> 8) & 1;
        uint32_t f = (insn >> 7) & 1;
        uint32_t g = (insn >> 6) & 1;
        uint32_t h = (insn >> 5) & 1;
        uint8_t imm8 = (a << 7) | (b << 6) | (c << 5) | (d << 4) | (e << 3) | (f << 2) | (g << 1) | h;

        // Special handling for cmode=0xe/0xf with op=1:
        // - cmode=0xe, op=1: MOVI with 64-bit element (byte expansion)
        // - cmode=0xf, op=0: FMOV (immediate)
        // - cmode=0xf, op=1: Reserved
        if (cmode == 0xe && op == 1) {
            // MOVI (64-bit scalar): Each bit of imm8 is expanded to a byte
            // imm8 bit i (0-7) -> result byte i is 0xFF if set, 0x00 if clear
            uint64_t elem64 = 0;
            for (int i = 0; i < 8; i++) {
                if (imm8 & (1 << i)) {
                    elem64 |= (0xFFULL << (i * 8));
                }
            }
            gen(state, (unsigned long) gadget_set_vec_imm);
            gen(state, rd);
            gen(state, elem64);           // lo = expanded 64-bit value
            gen(state, Q ? elem64 : 0);   // hi = same if Q=1, else 0
            return 1;
        }

        if (cmode == 0xf) {
            // cmode=0xf: FMOV (immediate) for floating-point vectors
            // VFPExpandImm expands imm8 to a FP constant at compile time.
            if (op == 0) {
                // FMOV single-precision: Vd.2S (Q=0) or Vd.4S (Q=1)
                // VFPExpandImm for single: aBBBBBbcdefgh0..0 (32-bit)
                uint32_t a = (imm8 >> 7) & 1;
                uint32_t b = (imm8 >> 6) & 1;
                uint32_t cdefgh = imm8 & 0x3f;
                uint32_t exp = ((1 - b) << 7) | ((b * 0x1f) << 2) | ((cdefgh >> 4) & 3);
                uint32_t frac = (cdefgh & 0xf) << 19;
                uint32_t fp32 = (a << 31) | (exp << 23) | frac;
                uint64_t elem64 = ((uint64_t)fp32 << 32) | fp32;
                gen(state, (unsigned long) gadget_set_vec_imm);
                gen(state, rd);
                gen(state, elem64);
                gen(state, Q ? elem64 : 0);
                return 1;
            } else {
                // op=1: FMOV double-precision: Vd.2D (Q must be 1)
                if (!Q) {
                    gen_interrupt(state, INT_UNDEFINED);
                    return 0;
                }
                // VFPExpandImm for double: aBBBBBBBBbcdefgh0..0 (64-bit)
                uint64_t a = (imm8 >> 7) & 1;
                uint64_t b = (imm8 >> 6) & 1;
                uint64_t cdefgh = imm8 & 0x3f;
                uint64_t exp = ((1 - b) << 10) | ((b * 0xff) << 2) | ((cdefgh >> 4) & 3);
                uint64_t frac = (cdefgh & 0xfULL) << 48;
                uint64_t fp64 = (a << 63) | (exp << 52) | frac;
                gen(state, (unsigned long) gadget_set_vec_imm);
                gen(state, rd);
                gen(state, fp64);
                gen(state, fp64);
                return 1;
            }
        }

        // ORR/BIC use odd cmode values for integer immediates (e.g., 0x1/0x3/0x5/0x7/0x9/0xb).
        // MOVI/MVNI with MSL uses cmode=0xc (MSL #8) and 0xd (MSL #16).
        bool is_orr_bic = ((cmode & 1) != 0) && (cmode != 0xd);
        uint32_t base_cmode = is_orr_bic ? (cmode - 1) : cmode;

        uint64_t pattern = 0;
        bool ok = false;
        if (cmode == 0xc) {
            // MOVI/MVNI (MSL #8): imm8 shifted left 8, low 8 bits set to ones
            uint64_t elem = ((uint64_t)imm8 << 8) | 0xff;
            pattern = elem | (elem << 32);
            ok = true;
        } else if (cmode == 0xd) {
            // MOVI/MVNI (MSL #16): imm8 shifted left 16, low 16 bits set to ones
            uint64_t elem = ((uint64_t)imm8 << 16) | 0xffff;
            pattern = elem | (elem << 32);
            ok = true;
        } else {
            ok = simd_modimm_pattern(base_cmode, imm8, &pattern);
        }
        if (!ok) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        uint64_t lo = pattern;
        uint64_t hi = Q ? pattern : 0;

        if (!is_orr_bic) {
            if (op) {
                // MVNI: invert the pattern
                lo = ~lo;
                if (Q) hi = ~hi;
            }
            gen(state, (unsigned long) gadget_set_vec_imm);
            gen(state, rd);
            gen(state, lo);
            gen(state, hi);
        } else {
            gen(state, (unsigned long) (op ? gadget_bic_imm_vec : gadget_orr_imm_vec));
            gen(state, rd | (Q << 8));
            gen(state, lo);
            gen(state, hi);
        }
        return 1;
    }

    // Note: LD1/ST1 instructions are now handled in gen_ldst() since they
    // are classified as load/store instructions by arm64_classify_insn()

    // Advanced SIMD three same - vector arithmetic operations
    // Pattern: 0 Q U 0 1 1 1 0 size 1 Rm opcode 1 Rn Rd
    // Fixed bits: bit[31]=0, bits[28:24]=01110, bit[21]=1, bit[10]=1
    // Mask 0x9f200400 checks only fixed bits (excludes Q, U, size, Rm, opcode, Rn, Rd)
    if ((insn & 0x9f200400) == 0x0e200400) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 11) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        void *gadget = NULL;
        if (U == 0 && opcode == 0x00) {
            // SHADD - Signed halving add
            gadget = gadget_shadd_vec;
        } else if (U == 1 && opcode == 0x00) {
            // UHADD - Unsigned halving add
            gadget = gadget_uhadd_vec;
        } else if (U == 0 && opcode == 0x02) {
            // SRHADD - Signed rounding halving add
            gadget = gadget_srhadd_vec;
        } else if (U == 1 && opcode == 0x02) {
            // URHADD - Unsigned rounding halving add
            gadget = gadget_urhadd_vec;
        } else if (U == 0 && opcode == 0x08) {
            // SSHL - Signed shift left (by register)
            gadget = gadget_sshl_vec;
        } else if (U == 1 && opcode == 0x08) {
            // USHL - Unsigned shift left (by register)
            gadget = gadget_ushl_vec;
        } else if (U == 0 && opcode == 0x09) {
            // SQSHL - Signed saturating shift left (by register)
            gadget = gadget_sqshl_vec;
        } else if (U == 1 && opcode == 0x09) {
            // UQSHL - Unsigned saturating shift left (by register)
            gadget = gadget_uqshl_vec;
        } else if (U == 0 && opcode == 0x0a) {
            // SRSHL - Signed rounding shift left (by register)
            gadget = gadget_srshl_vec;
        } else if (U == 1 && opcode == 0x0a) {
            // URSHL - Unsigned rounding shift left (by register)
            gadget = gadget_urshl_vec;
        } else if (U == 0 && opcode == 0x0b) {
            // SQRSHL - Signed saturating rounding shift left (by register)
            gadget = gadget_sqrshl_vec;
        } else if (U == 1 && opcode == 0x0b) {
            // UQRSHL - Unsigned saturating rounding shift left (by register)
            gadget = gadget_uqrshl_vec;
        } else if (U == 0 && opcode == 0x10) {
            // ADD - Vector add
            if (size == 3 && Q == 0) {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }
            gadget = gadget_add_vec;
        } else if (U == 1 && opcode == 0x10) {
            // SUB - Vector subtract
            if (size == 3 && Q == 0) {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }
            gadget = gadget_sub_vec;
        } else if (U == 1 && opcode == 0x06) {
            // CMHI - Compare higher (unsigned >)
            gadget = gadget_cmhi_vec;
        } else if (U == 1 && opcode == 0x07) {
            // CMHS - Compare higher or same (unsigned >=)
            gadget = gadget_cmhs_vec;
        } else if (U == 1 && opcode == 0x11) {
            // CMEQ - Compare equal
            gadget = gadget_cmeq_vec;
        } else if (U == 0 && opcode == 0x01) {
            // SQADD - Signed saturating add
            gadget = gadget_sqadd_vec;
        } else if (U == 1 && opcode == 0x01) {
            // UQADD - Unsigned saturating add
            gadget = gadget_uqadd_vec;
        } else if (opcode == 0x03) {
            // Logic group: distinguished by U and size
            if (U == 0) {
                if (size == 0) gadget = gadget_and_vec;      // AND
                else if (size == 1) gadget = gadget_bic_vec;  // BIC
                else if (size == 2) gadget = gadget_orr_vec;  // ORR
                else gadget = gadget_orn_vec;                  // ORN
            } else {
                if (size == 0) gadget = gadget_eor_vec;       // EOR
                else if (size == 1) gadget = gadget_bsl_vec;  // BSL
                else if (size == 2) gadget = gadget_bit_vec;  // BIT
                else gadget = gadget_bif_vec;                  // BIF
            }
        } else if (U == 0 && opcode == 0x04) {
            // SHSUB - Signed halving subtract (not for size=3)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_shsub_vec;
        } else if (U == 1 && opcode == 0x04) {
            // UHSUB - Unsigned halving subtract (not for size=3)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_uhsub_vec;
        } else if (U == 0 && opcode == 0x05) {
            // SQSUB - Signed saturating subtract
            gadget = gadget_sqsub_vec;
        } else if (U == 1 && opcode == 0x05) {
            // UQSUB - Unsigned saturating subtract
            gadget = gadget_uqsub_vec;
        } else if (U == 0 && opcode == 0x06) {
            // CMGT - Signed compare greater than (register)
            gadget = gadget_cmgt_reg_vec;
        } else if (U == 0 && opcode == 0x07) {
            // CMGE - Signed compare greater or equal (register)
            gadget = gadget_cmge_reg_vec;
        } else if (U == 0 && opcode == 0x17) {
            // ADDP - Add pairwise
            gadget = gadget_addp_vec;
        } else if (U == 1 && opcode == 0x14) {
            // UMAXP - Unsigned maximum pairwise
            gadget = gadget_umaxp_vec;
        } else if (U == 1 && opcode == 0x15) {
            // UMINP - Unsigned minimum pairwise
            gadget = gadget_uminp_vec;
        } else if (U == 0 && opcode == 0x14) {
            // SMAXP - Signed maximum pairwise (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_smaxp_vec;
        } else if (U == 0 && opcode == 0x15) {
            // SMINP - Signed minimum pairwise (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sminp_vec;
        } else if (U == 0 && opcode == 0x16) {
            // SQDMULH - Signed saturating doubling multiply high (H/S only)
            if (size == 0 || size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqdmulh_vec;
        } else if (U == 1 && opcode == 0x16) {
            // SQRDMULH - Signed saturating rounding doubling multiply high (H/S only)
            if (size == 0 || size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqrdmulh_vec;
        } else if (U == 0 && opcode == 0x13) {
            // MUL - Integer multiply (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_mul_vec;
        } else if (U == 1 && opcode == 0x13) {
            // PMUL - Polynomial multiply (size must be 0/bytes)
            if (size != 0) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_pmul_vec;
        } else if (U == 0 && opcode == 0x12) {
            // MLA - Multiply-accumulate (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_mla_vec;
        } else if (U == 1 && opcode == 0x12) {
            // MLS - Multiply-subtract (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_mls_vec;
        } else if (U == 0 && opcode == 0x0c) {
            // SMAX - Signed maximum (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_smax_vec;
        } else if (U == 1 && opcode == 0x0c) {
            // UMAX - Unsigned maximum (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_umax_vec;
        } else if (U == 0 && opcode == 0x0d) {
            // SMIN - Signed minimum (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_smin_vec;
        } else if (U == 1 && opcode == 0x0d) {
            // UMIN - Unsigned minimum (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_umin_vec;
        } else if (U == 0 && opcode == 0x0e) {
            // SABD - Signed absolute difference (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sabd_vec;
        } else if (U == 1 && opcode == 0x0e) {
            // UABD - Unsigned absolute difference (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_uabd_vec;
        } else if (U == 0 && opcode == 0x0f) {
            // SABA - Signed absolute difference accumulate (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_saba_vec;
        } else if (U == 1 && opcode == 0x0f) {
            // UABA - Unsigned absolute difference accumulate (not for size=3/D)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_uaba_vec;
        } else if (U == 0 && opcode == 0x11) {
            // CMTST - Compare bitwise test (Vn AND Vm != 0)
            gadget = gadget_cmtst_vec;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            // Pack: rd | rn<<8 | rm<<16 | size<<24 | Q<<26
            gen(state, rd | (rn << 8) | (rm << 16) | (size << 24) | (Q << 26));
            return 1;
        }

        // FP vector three-same: opcodes 0x18-0x1f
        // size[1] (bit[23]) = 'a' selects operation variant
        // size[0] (bit[22]) = sz selects single(0)/double(1) precision
        // Encoding table (ARM ARM C7.2):
        //   opc  | U=0,a=0  | U=0,a=1  | U=1,a=0  | U=1,a=1
        //   0x18 | FMAXNM   | FMINNM   | -        | -
        //   0x19 | FMLA     | FMLS     | -        | -
        //   0x1a | FADD     | FSUB     | FADDP    | FABD
        //   0x1b | FMULX    | -        | FMUL     | -
        //   0x1c | FCMEQ    | -        | FCMGE    | FCMGT
        //   0x1d | -        | -        | FACGE    | FACGT
        //   0x1e | FMAX     | FMIN     | FMAXP    | FMINP
        //   0x1f | FRECPS   | FRSQRTS  | FDIV     | -
        if (opcode >= 0x18) {
            uint32_t sz = size & 1;    // 0=single, 1=double
            uint32_t a = (size >> 1) & 1; // bit[23]
            void *fp_gadget = NULL;

            if (opcode == 0x18 && !U) {
                fp_gadget = a ? gadget_fp_fminnm_vec : gadget_fp_fmaxnm_vec;
            } else if (opcode == 0x19 && !U) {
                fp_gadget = a ? gadget_fp_fmls_vec : gadget_fp_fmla_vec;
            } else if (opcode == 0x1a) {
                if (!U) fp_gadget = a ? gadget_fp_fsub_vec : gadget_fp_fadd_vec;
                else    fp_gadget = a ? gadget_fp_fabd_vec : gadget_fp_faddp_vec;
            } else if (opcode == 0x1b && !a) {
                fp_gadget = U ? gadget_fp_fmul_vec : gadget_fp_fmulx_vec;
            } else if (opcode == 0x1c) {
                if (!U && !a) fp_gadget = gadget_fp_fcmeq_vec;
                else if (U)   fp_gadget = a ? gadget_fp_fcmgt_vec : gadget_fp_fcmge_vec;
            } else if (opcode == 0x1d && U) {
                fp_gadget = a ? gadget_fp_facgt_vec : gadget_fp_facge_vec;
            } else if (opcode == 0x1e) {
                if (!U) fp_gadget = a ? gadget_fp_fmin_vec : gadget_fp_fmax_vec;
                else    fp_gadget = a ? gadget_fp_fminp_vec : gadget_fp_fmaxp_vec;
            } else if (opcode == 0x1f) {
                if (!U) fp_gadget = a ? gadget_fp_frsqrts_vec : gadget_fp_frecps_vec;
                else if (!a) fp_gadget = gadget_fp_fdiv_vec;
            }

            if (fp_gadget) {
                gen(state, (unsigned long) fp_gadget);
                // Pack: rd | rn<<8 | rm<<16 | sz<<24 | Q<<26
                gen(state, rd | (rn << 8) | (rm << 16) | (sz << 24) | (Q << 26));
                return 1;
            }
        }

        // Unimplemented three-same NEON instruction — must not silently fall through
        gen_interrupt(state, INT_UNDEFINED);
        return 0;
    }

    // AdvSIMD three different - widening/narrowing operations
    // Pattern: 0 Q U 01110 size 1 Rm opcode 00 Rn Rd
    // Fixed bits: bit[31]=0, bits[28:24]=01110, bit[21]=1, bits[11:10]=00
    // Mask: 0x9f200c00 checks fixed bits
    if ((insn & 0x9f200c00) == 0x0e200000) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 12) & 0xf;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        void *gadget = NULL;

        // PMULL uses opcode=0xe, U=0 with size=0 (8B→8H) or size=3 (1D→1Q).
        // These must skip three-different and fall through to the PMULL handler.
        if (opcode == 0xe && U == 0 && (size == 0 || size == 3))
            goto skip_three_different;

        // Size 3 is reserved for most three-different instructions
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        if (U == 0) {
            switch (opcode) {
                case 0x0:  gadget = gadget_saddl_vec; break;  // SADDL
                case 0x1:  gadget = gadget_saddw_vec; break;  // SADDW
                case 0x2:  gadget = gadget_ssubl_vec; break;  // SSUBL
                case 0x3:  gadget = gadget_ssubw_vec; break;  // SSUBW
                case 0x4:  gadget = gadget_addhn_vec; break;  // ADDHN
                case 0x5:  gadget = gadget_sabal_vec; break;  // SABAL
                case 0x6:  gadget = gadget_subhn_vec; break;  // SUBHN
                case 0x7:  gadget = gadget_sabdl_vec; break;  // SABDL
                case 0x8:  gadget = gadget_smlal_vec; break;  // SMLAL
                case 0xa:  gadget = gadget_smlsl_vec; break;  // SMLSL
                case 0xc:  gadget = gadget_smull_vec; break;  // SMULL
            }
        } else {
            switch (opcode) {
                case 0x0:  gadget = gadget_uaddl_vec; break;  // UADDL
                case 0x1:  gadget = gadget_uaddw_vec; break;  // UADDW
                case 0x2:  gadget = gadget_usubl_vec; break;  // USUBL
                case 0x3:  gadget = gadget_usubw_vec; break;  // USUBW
                case 0x4:  gadget = gadget_raddhn_vec; break;  // RADDHN
                case 0x5:  gadget = gadget_uabal_vec; break;  // UABAL
                case 0x6:  gadget = gadget_rsubhn_vec; break;  // RSUBHN
                case 0x7:  gadget = gadget_uabdl_vec; break;  // UABDL
                case 0x8:  gadget = gadget_umlal_vec; break;  // UMLAL
                case 0xa:  gadget = gadget_umlsl_vec; break;  // UMLSL
                case 0xc:  gadget = gadget_umull_vec; break;  // UMULL
            }
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            // Pack: rd | rn<<8 | rm<<16 | size<<24 | Q<<26
            gen(state, rd | (rn << 8) | (rm << 16) | (size << 24) | (Q << 26));
            return 1;
        }
        // Unimplemented three-different NEON instruction — must not silently fall through
        gen_interrupt(state, INT_UNDEFINED);
        return 0;
    }
skip_three_different:

    // XTN/XTN2 - narrow (vector)
    // Matches: 0Q0011100ss10000 101000 Rn Rd (XTN/XTN2)
    // Mask ignores Q to cover both XTN and XTN2.
    if ((insn & 0xbf3ffc00) == 0x0e212800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }
        gen(state, (unsigned long) gadget_xtn_vec);
        // Pack: rd | rn<<8 | size<<16 | hi<<18 (hi=Q for XTN2)
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 18));
        return 1;
    }

    // Permute instructions: UZP1, UZP2, TRN1, TRN2, ZIP1, ZIP2
    // Format: 0 Q 0 01110 size 0 Rm 0 op2 10 Rn Rd
    // op2: 001=UZP1, 101=UZP2, 010=TRN1, 110=TRN2, 011=ZIP1, 111=ZIP2
    // Mask: 0xbf208c00, Value: 0x0e000800
    if ((insn & 0xbf208c00) == 0x0e000800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t op2 = (insn >> 12) & 0x7;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // size == 3 (64-bit elements) requires Q == 1
        if (size == 3 && Q == 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        switch (op2) {
            case 1: gadget = gadget_uzp1_vec; break;  // UZP1
            case 5: gadget = gadget_uzp2_vec; break;  // UZP2
            case 2: gadget = gadget_trn1_vec; break;  // TRN1
            case 6: gadget = gadget_trn2_vec; break;  // TRN2
            case 3: gadget = gadget_zip1_vec; break;  // ZIP1
            case 7: gadget = gadget_zip2_vec; break;  // ZIP2
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            // Pack: rd | rn<<8 | rm<<16 | size<<24 | Q<<26
            gen(state, rd | (rn << 8) | (rm << 16) | (size << 24) | (Q << 26));
            return 1;
        }
    }

    // UADDLP/SADDLP/UADALP/SADALP - Pairwise add long (two-reg misc)
    // SADDLP: 0 Q 0 01110 size 10000 00010 10 Rn Rd  (U=0, opcode=0x02)
    // UADDLP: 0 Q 1 01110 size 10000 00010 10 Rn Rd  (U=1, opcode=0x02)
    // SADALP: 0 Q 0 01110 size 10000 00110 10 Rn Rd  (U=0, opcode=0x06)
    // UADALP: 0 Q 1 01110 size 10000 00110 10 Rn Rd  (U=1, opcode=0x06)
    if ((insn & 0xbf3ffc00) == 0x0e202800 ||   // SADDLP
        (insn & 0xbf3ffc00) == 0x2e202800 ||   // UADDLP
        (insn & 0xbf3ffc00) == 0x0e206800 ||   // SADALP
        (insn & 0xbf3ffc00) == 0x2e206800) {   // UADALP
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t opcode = (insn >> 12) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        if (U == 0 && opcode == 0x02) gadget = gadget_saddlp_vec;
        else if (U == 1 && opcode == 0x02) gadget = gadget_uaddlp_vec;
        else if (U == 0 && opcode == 0x06) gadget = gadget_sadalp_vec;
        else if (U == 1 && opcode == 0x06) gadget = gadget_uadalp_vec;

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // SQXTUN/SQXTN/UQXTN - Saturating narrowing instructions (two-reg misc)
    // Note: XTN is already handled by separate decoder above
    // SQXTUN: 0 Q 1 01110 size 10000 10010 10 Rn Rd  (U=1, opcode=0x12)
    // SQXTN:  0 Q 0 01110 size 10000 10100 10 Rn Rd  (U=0, opcode=0x14)
    // UQXTN:  0 Q 1 01110 size 10000 10100 10 Rn Rd  (U=1, opcode=0x14)
    if ((insn & 0xbf3ffc00) == 0x2e212800 ||   // SQXTUN
        (insn & 0xbf3ffc00) == 0x0e214800 ||   // SQXTN
        (insn & 0xbf3ffc00) == 0x2e214800) {   // UQXTN
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t opcode = (insn >> 12) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // size=3 is reserved
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        if (U == 1 && opcode == 0x12) gadget = gadget_sqxtun_vec;
        else if (U == 0 && opcode == 0x14) gadget = gadget_sqxtn_vec;
        else if (U == 1 && opcode == 0x14) gadget = gadget_uqxtn_vec;

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // CMEQ with zero - pattern: 0 Q 0 0 1 1 1 0 size 1 0 0 0 0 0 10011 1 Rn Rd
    // Binary: 0Q0_0111_0ss1_0000_0100_11Rn_nnRd_dddd
    if ((insn & 0xbf3ffc00) == 0x0e209800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_cmeq_zero_vec);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // CMGT/CMLT/CMGE/CMLE with zero - AdvSIMD two-register misc
    // CMGT #0: 0 Q 0 01110 size 10000 01000 10 Rn Rd  (U=0, opcode=01000)
    // CMLT #0: 0 Q 0 01110 size 10000 01010 10 Rn Rd  (U=0, opcode=01010)
    // CMGE #0: 0 Q 1 01110 size 10000 01000 10 Rn Rd  (U=1, opcode=01000)
    // CMLE #0: 0 Q 1 01110 size 10000 01001 10 Rn Rd  (U=1, opcode=01001)
    if ((insn & 0xbf3ffc00) == 0x0e208800 ||   // CMGT #0
        (insn & 0xbf3ffc00) == 0x0e20a800 ||   // CMLT #0
        (insn & 0xbf3ffc00) == 0x2e208800 ||   // CMGE #0
        (insn & 0xbf3ffc00) == 0x2e209800) {   // CMLE #0
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t opcode = (insn >> 12) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // size=3 (D) requires Q=1
        if (size == 3 && Q == 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        if (U == 0 && opcode == 0x08) gadget = gadget_cmgt_zero_vec;
        else if (U == 0 && opcode == 0x0a) gadget = gadget_cmlt_zero_vec;
        else if (U == 1 && opcode == 0x08) gadget = gadget_cmge_zero_vec;
        else if (U == 1 && opcode == 0x09) gadget = gadget_cmle_zero_vec;

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // ABS/NEG (vector) - AdvSIMD two-register misc
    // ABS: 0 Q 0 01110 size 10000 01011 10 Rn Rd  (U=0, opcode=0x0b)
    // NEG: 0 Q 1 01110 size 10000 01011 10 Rn Rd  (U=1, opcode=0x0b)
    if ((insn & 0xbf3ffc00) == 0x0e20b800 ||   // ABS
        (insn & 0xbf3ffc00) == 0x2e20b800) {   // NEG
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (size == 3 && Q == 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = (U == 0) ? gadget_abs_vec : gadget_neg_vec;
        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // CLZ/CLS (vector) - AdvSIMD two-register misc
    // CLS: 0 Q 0 01110 size 10000 00100 10 Rn Rd  (U=0, opcode=0x04)
    // CLZ: 0 Q 1 01110 size 10000 00100 10 Rn Rd  (U=1, opcode=0x04)
    // Only B/H/S sizes supported (size=3 is UNDEF)
    if ((insn & 0xbf3ffc00) == 0x0e204800 ||   // CLS
        (insn & 0xbf3ffc00) == 0x2e204800) {   // CLZ
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = (U == 0) ? gadget_cls_vec : gadget_clz_vec;
        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // NOT/RBIT (vector) - AdvSIMD two-register misc (bytes only)
    // NOT:  0 Q 1 01110 00 10000 00101 10 Rn Rd  (U=1, size=00, opcode=0x05)
    // RBIT: 0 Q 1 01110 01 10000 00101 10 Rn Rd  (U=1, size=01, opcode=0x05)
    if ((insn & 0xbf3ffc00) == 0x2e205800) {   // NOT (size=00)
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_not_vec);
        gen(state, rd | (rn << 8) | (Q << 16));
        return 1;
    }
    if ((insn & 0xbf3ffc00) == 0x2e605800) {   // RBIT (size=01)
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_rbit_vec);
        gen(state, rd | (rn << 8) | (Q << 16));
        return 1;
    }

    // AdvSIMD two-register misc: FP conversions, rounding, unary, compare-with-zero
    // Format: 0 Q U 01110 size 10000 opcode 10 Rn Rd
    // Mask 0xbfbbfc00 ignores Q(bit30) and sz(bit22), matches U+size[1]+opcode
    // For FP ops: size[0]=sz selects precision (0=single, 1=double)
    {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        uint32_t sz = (insn >> 22) & 1;  // precision: 0=single, 1=double
        uint32_t base = insn & 0xbfbbfc00;  // mask out Q and sz (keep size[1]=bit23)
        void *gadget = NULL;

        // Integer to FP conversions (size[1]=0, opcode=0x1b)
        if      (base == 0x0e21d800) gadget = gadget_scvtf_int_vec;
        else if (base == 0x2e21d800) gadget = gadget_ucvtf_int_vec;
        // FP to integer conversions toward zero (size[1]=1, opcode=0x1b)
        else if (base == 0x0ea1b800) gadget = gadget_fcvtzs_int_vec;
        else if (base == 0x2ea1b800) gadget = gadget_fcvtzu_int_vec;
        // FCVTN[SU] - nearest even (size[1]=0, opcode=0x0a)
        else if (base == 0x0e21a800) gadget = gadget_fcvtns_int_vec;
        else if (base == 0x2e21a800) gadget = gadget_fcvtnu_int_vec;
        // FCVTM[SU] - toward -inf (size[1]=0, opcode=0x0b)
        else if (base == 0x0e21b800) gadget = gadget_fcvtms_int_vec;
        else if (base == 0x2e21b800) gadget = gadget_fcvtmu_int_vec;
        // FCVTP[SU] - toward +inf (size[1]=1, opcode=0x0a)
        else if (base == 0x0ea1a800) gadget = gadget_fcvtps_int_vec;
        else if (base == 0x2ea1a800) gadget = gadget_fcvtpu_int_vec;
        // FCVTA[SU] - ties away (size[1]=0, opcode=0x19)
        else if (base == 0x0e21c800) gadget = gadget_fcvtas_int_vec;
        else if (base == 0x2e21c800) gadget = gadget_fcvtau_int_vec;
        // FRINT rounding variants
        else if (base == 0x0e218800) gadget = gadget_frintn_vec_vec;
        else if (base == 0x2e218800) gadget = gadget_frinta_vec_vec;
        else if (base == 0x0ea18800) gadget = gadget_frintp_vec_vec;
        else if (base == 0x0e219800) gadget = gadget_frintm_vec_vec;
        else if (base == 0x2e219800) gadget = gadget_frintx_vec_vec;
        else if (base == 0x0ea19800) gadget = gadget_frintz_vec_vec;
        else if (base == 0x2ea19800) gadget = gadget_frinti_vec_vec;
        // FP unary: FABS, FNEG, FSQRT, FRECPE, FRSQRTE (size[1]=1)
        else if (base == 0x0ea0f800) gadget = gadget_fabs_vec_vec;
        else if (base == 0x2ea0f800) gadget = gadget_fneg_vec_vec;
        else if (base == 0x2ea1f800) gadget = gadget_fsqrt_vec_vec;
        else if (base == 0x0ea1d800) gadget = gadget_frecpe_vec_vec;
        else if (base == 0x2ea1d800) gadget = gadget_frsqrte_vec_vec;
        // FP compare-with-zero (size[1]=1)
        else if (base == 0x0ea0d800) gadget = gadget_fcmeq_zero_vec;
        else if (base == 0x2ea0c800) gadget = gadget_fcmge_zero_vec;
        else if (base == 0x0ea0c800) gadget = gadget_fcmgt_zero_vec;
        else if (base == 0x2ea0d800) gadget = gadget_fcmle_zero_vec;
        else if (base == 0x0ea0e800) gadget = gadget_fcmlt_zero_vec;

        if (gadget) {
            // Double precision (.2d) requires Q=1
            if (sz == 1 && Q == 0) {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8) | (sz << 16) | (Q << 24));
            return 1;
        }
    }

    // FCVTN/FCVTN2 - floating-point narrow (two-register misc)
    // FCVTN:  0 0 0 01110 size 10000 10110 10 Rn Rd
    // FCVTN2: 0 1 0 01110 size 10000 10110 10 Rn Rd
    // size=0: S->H, size=1: D->S; Q selects lower/upper destination half.
    if ((insn & 0xbfbffc00) == 0x0e216800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_fcvtn_vec);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // FCVTL/FCVTL2 - floating-point widen long (two-register misc)
    // FCVTL:  0 0 0 01110 size 10000 10111 10 Rn Rd
    // FCVTL2: 0 1 0 01110 size 10000 10111 10 Rn Rd
    // size=0: H->S, size=1: S->D; size[1] must be 0.
    if ((insn & 0xbfbffc00) == 0x0e217800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_fcvtl_vec);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // FCVTXN/FCVTXN2 - double-to-single round-to-odd narrow conversion.
    // Q=0 writes the lower half and zeros the upper half; Q=1 preserves the
    // lower half and writes the converted lanes to the upper half.
    if ((insn & 0xbffffc00) == 0x2e616800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_fcvtxn_vec);
        gen(state, rd | (rn << 8) | (Q << 24));
        return 1;
    }

    // Integer CMEQ #0 (U=0, opcode=0x09)
    if ((insn & 0xbf3ffc00) == 0x0e209800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        if (size == 3 && Q == 0) { gen_interrupt(state, INT_UNDEFINED); return 0; }
        gen(state, (unsigned long) gadget_cmeq_zero_vec);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // SHLL/SHLL2 - Shift left long (by element size) - AdvSIMD two-register misc
    // SHLL:  0 0 1 01110 size 10000 10011 10 Rn Rd  (Q=0, U=1, opcode=0x13)
    // SHLL2: 0 1 1 01110 size 10000 10011 10 Rn Rd  (Q=1, U=1, opcode=0x13)
    // Shift amount is fixed at element size (8/16/32), unlike USHLL which uses immediate
    if ((insn & 0xbf3ffc00) == 0x2e213800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // size=3 is reserved
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        if (size == 2) {
            gadget = Q ? gadget_shll2_vec_s_to_d : gadget_shll_vec_s_to_d;
        } else if (size == 1) {
            gadget = Q ? gadget_shll2_vec_h_to_s : gadget_shll_vec_h_to_s;
        } else {
            gadget = Q ? gadget_shll2_vec_b_to_h : gadget_shll_vec_b_to_h;
        }

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8));
        return 1;
    }

    // REV16 (vector) - reverse bytes in 16-bit elements
    // 0 Q 0 01110 00 10000 00001 10 Rn Rd
    if ((insn & 0xbf3ffc00) == 0x0e201800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        gen(state, (unsigned long) gadget_rev16_vec);
        gen(state, rd | (rn << 8) | (Q << 16));
        return 1;
    }

    // REV32/REV64 (vector) - AdvSIMD two-register misc
    // REV64: 0 Q 0 01110 size 10000 00000 10 Rn Rd (U=0, opcode=00000)
    // REV32: 0 Q 1 01110 size 10000 00000 10 Rn Rd (U=1, opcode=00000)
    // Binary: 0QuU_0111_0ss1_0000_0000_010R_nnnn_dddd
    // Mask: 0xbf3ffc00 checks Q, U, fixed bits, size, opcode fields
    // REV64: 0x0e200800 (U=0)
    // REV32: 0x2e200800 (U=1)
    if ((insn & 0xbf3ffc00) == 0x0e200800 || (insn & 0xbf3ffc00) == 0x2e200800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        void *gadget = NULL;
        if (U == 0) {
            // REV64 - reverses bytes in 64-bit elements
            // size must be < 3 (64-bit elements don't need REV64)
            if (size >= 3) {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }
            gadget = gadget_rev64_vec;
        } else {
            // REV32 - reverses bytes in 32-bit elements
            // size must be < 2 (32-bit elements need byte or halfword reversal)
            if (size >= 2) {
                gen_interrupt(state, INT_UNDEFINED);
                return 0;
            }
            gadget = gadget_rev32_vec;
        }
        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // RBIT (vector) - reverse bits in each byte
    // 0 Q 1 01110 sz 10000 00101 10 Rn Rd
    // Mask 0xbf3ffc00 checks fixed bits, ignores Q, sz, Rn, Rd
    // Value: sz must be 00 for .8B/.16B
    if ((insn & 0xbf3ffc00) == 0x2e205800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        gen(state, (unsigned long) gadget_rbit_vec);
        gen(state, rd | (rn << 8) | (Q << 16));
        return 1;
    }

    // ADDV (across lanes) - add all vector elements into scalar
    // 0 Q U 01110 size 11000 1 10110 10 Rn Rd  (U=0, opcode=11011)
    // Mask: 0xbf3ffc00 checks fixed bits, Value: 0x0e31b800
    if ((insn & 0xbf3ffc00) == 0x0e31b800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // ADDV is not valid for size=3 (D), and 2S requires Q=1
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) gadget_addv_vec);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // SADDLV/UADDLV (across lanes) - signed/unsigned add long across vector
    // 0 Q U 01110 size 11000 00011 10 Rn Rd
    // SADDLV: U=0, UADDLV: U=1
    // Mask: 0x9f3ffc00 (ignore Q and U), Value: 0x0e303800
    if ((insn & 0x9f3ffc00) == 0x0e303800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // Not valid for size=3 (D)
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        gen(state, (unsigned long) (U ? gadget_uaddlv_vec : gadget_saddlv_vec));
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // UMAXV/UMINV/SMAXV/SMINV (across lanes) - min/max reduction
    // SMAXV: 0 Q 0 01110 size 11000 01010 10 Rn Rd  (U=0, opcode=01010)
    // SMINV: 0 Q 0 01110 size 11000 11010 10 Rn Rd  (U=0, opcode=11010)
    // UMAXV: 0 Q 1 01110 size 11000 01010 10 Rn Rd  (U=1, opcode=01010)
    // UMINV: 0 Q 1 01110 size 11000 11010 10 Rn Rd  (U=1, opcode=11010)
    if ((insn & 0xbf3ffc00) == 0x0e30a800 ||   // SMAXV
        (insn & 0xbf3ffc00) == 0x0e31a800 ||   // SMINV
        (insn & 0xbf3ffc00) == 0x2e30a800 ||   // UMAXV
        (insn & 0xbf3ffc00) == 0x2e31a800) {   // UMINV
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 0x3;
        uint32_t opcode = (insn >> 12) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // Not valid for size=3 (D)
        if (size == 3) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        if (U == 0 && opcode == 0x0a) gadget = gadget_smaxv_vec;
        else if (U == 0 && opcode == 0x1a) gadget = gadget_sminv_vec;
        else if (U == 1 && opcode == 0x0a) gadget = gadget_umaxv_vec;
        else if (U == 1 && opcode == 0x1a) gadget = gadget_uminv_vec;

        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (size << 16) | (Q << 24));
        return 1;
    }

    // FMAXV/FMINV/FMAXNMV/FMINNMV (across lanes) - FP max/min reduction
    // These only exist for .4s (Q=1, single precision)
    // FMAXV:   0 1 1 01110 00 110000 11111 10 Rn Rd  → 0x6e30f800
    // FMINV:   0 1 1 01110 10 110000 11111 10 Rn Rd  → 0x6eb0f800
    // FMAXNMV: 0 1 1 01110 00 110000 01100 10 Rn Rd  → 0x6e30c800
    // FMINNMV: 0 1 1 01110 10 110000 01100 10 Rn Rd  → 0x6eb0c800
    // Mask 0xfffffc00 (exact match since Q=1 always)
    if ((insn & 0xfffffc00) == 0x6e30f800 ||
        (insn & 0xfffffc00) == 0x6eb0f800 ||
        (insn & 0xfffffc00) == 0x6e30c800 ||
        (insn & 0xfffffc00) == 0x6eb0c800) {
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        uint32_t base_val = insn & 0xfffffc00;
        void *gadget = NULL;
        if (base_val == 0x6e30f800) gadget = gadget_fmaxv_vec;
        else if (base_val == 0x6eb0f800) gadget = gadget_fminv_vec;
        else if (base_val == 0x6e30c800) gadget = gadget_fmaxnmv_vec;
        else gadget = gadget_fminnmv_vec;
        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8));
        return 1;
    }

    // CNT (vector) - count set bits per byte
    // 0 Q 0 01110 size 10000 00101 10 Rn Rd  (U=0, opcode=00101)
    // Same as RBIT but U=0 instead of U=1; size must be 00
    // Mask 0xbf3ffc00, Value: 0x0e205800
    if ((insn & 0xbf3ffc00) == 0x0e205800) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        gen(state, (unsigned long) gadget_cnt_vec);
        gen(state, rd | (rn << 8) | (Q << 16));
        return 1;
    }

    // Floating-point/integer conversion (scalar)
    // UCVTF/SCVTF/FCVTZU/FCVTZS
    // Pattern: sf 0 0 1 1 1 1 0 type 1 rmode opcode 0 0 0 0 0 0 Rn Rd
    // Fixed bits: 30-29=00, 28-24=11110, 21=1, 15-10=000000
    // Mask: 0x7f20fc00 checks fixed bits
    if ((insn & 0x7f20fc00) == 0x1e200000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t type = (insn >> 22) & 3;
        uint32_t rmode = (insn >> 19) & 3;
        uint32_t opcode = (insn >> 16) & 7;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;


        void *gadget = NULL;
        if (rmode == 0 && opcode == 3) {
            // UCVTF - unsigned int to float
            gadget = gadget_ucvtf_scalar;
        } else if (rmode == 0 && opcode == 2) {
            // SCVTF - signed int to float
            gadget = gadget_scvtf_scalar;
        } else if (rmode == 3 && opcode == 1) {
            // FCVTZU - float to unsigned int (round toward zero)
            gadget = gadget_fcvtzu_scalar;
        } else if (rmode == 3 && opcode == 0) {
            // FCVTZS - float to signed int (round toward zero)
            gadget = gadget_fcvtzs_scalar;
        } else if (rmode == 0 && opcode == 0) {
            // FCVTNS - float to signed int (round to nearest, ties to even)
            gadget = gadget_fcvtns_scalar;
        } else if (rmode == 0 && opcode == 1) {
            // FCVTNU - float to unsigned int (round to nearest)
            gadget = gadget_fcvtnu_scalar;
        } else if (rmode == 1 && opcode == 0) {
            // FCVTPS - float to signed int (round toward +inf)
            gadget = gadget_fcvtps_scalar;
        } else if (rmode == 1 && opcode == 1) {
            // FCVTPU - float to unsigned int (round toward +inf)
            gadget = gadget_fcvtpu_scalar;
        } else if (rmode == 2 && opcode == 0) {
            // FCVTMS - float to signed int (round toward -inf)
            gadget = gadget_fcvtms_scalar;
        } else if (rmode == 2 && opcode == 1) {
            // FCVTMU - float to unsigned int (round toward -inf)
            gadget = gadget_fcvtmu_scalar;
        } else if (rmode == 0 && opcode == 4) {
            // FCVTAS - float to signed int (round to nearest, ties to away)
            gadget = gadget_fcvtas_scalar;
        } else if (rmode == 0 && opcode == 5) {
            // FCVTAU - float to unsigned int (round to nearest, ties to away)
            gadget = gadget_fcvtau_scalar;
        } else if (rmode == 0 && opcode == 6) {
            // FMOV - move bits from FP register to GPR (opcode bit 0 = 0)
            gadget = gadget_fmov_fp_to_gpr;
        } else if (rmode == 0 && opcode == 7) {
            // FMOV - move bits from GPR to FP register (opcode bit 0 = 1)
            gadget = gadget_fmov_gpr_to_fp;
        } else if (rmode == 1 && opcode == 6 && type == 2 && sf == 1) {
            // FMOV - move bits from vector upper D lane to GPR (Vn.D[1] -> Xd)
            gadget = gadget_fmov_fp_to_gpr_hi;
        } else if (rmode == 1 && opcode == 7 && type == 2 && sf == 1) {
            // FMOV - move bits from GPR to vector upper D lane (Xd -> Vd.D[1])
            gadget = gadget_fmov_gpr_to_fp_hi;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            // Pack: rd | rn<<8 | type<<16 | sf<<18
            gen(state, rd | (rn << 8) | (type << 16) | (sf << 18));
            return 1;
        }
    }

    // FCVTZS/FCVTZU/SCVTF/UCVTF (scalar, fixed-point, GPR <-> FP)
    // Encoding: sf 0 0 11110 type 0 rmode opcode scale Rn Rd
    // This is the GPR-to/from-FP fixed-point conversion (NOT the SIMD scalar form)
    // rmode=11, opcode=000 -> FCVTZS; rmode=11, opcode=001 -> FCVTZU
    // rmode=00, opcode=010 -> SCVTF; rmode=00, opcode=011 -> UCVTF
    // scale = 64 - fbits (sf=1) or 32 - fbits (sf=0)
    // Mask: 0x7f200000 checks bits 30:29=00, 28:24=11110, 21=0
    if ((insn & 0x7f200000) == 0x1e000000) {
        uint32_t sf = (insn >> 31) & 1;
        uint32_t type = (insn >> 22) & 3;
        uint32_t rmode = (insn >> 19) & 3;
        uint32_t opcode = (insn >> 16) & 7;
        uint32_t scale = (insn >> 10) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        if (type <= 1) {
            uint32_t fbits = 64 - scale;
            void *gadget = NULL;
            if (rmode == 3 && opcode == 0) {
                gadget = gadget_fcvtzs_fixpt_gpr;  // FCVTZS Wd/Xd, Sn/Dn, #fbits
            } else if (rmode == 3 && opcode == 1) {
                gadget = gadget_fcvtzu_fixpt_gpr;  // FCVTZU Wd/Xd, Sn/Dn, #fbits
            } else if (rmode == 0 && opcode == 2) {
                gadget = gadget_scvtf_fixpt_gpr;   // SCVTF Sd/Dd, Wn/Xn, #fbits
            } else if (rmode == 0 && opcode == 3) {
                gadget = gadget_ucvtf_fixpt_gpr;   // UCVTF Sd/Dd, Wn/Xn, #fbits
            }

            if (gadget) {
                gen(state, (unsigned long) gadget);
                // Pack: rd | rn<<8 | type<<16 | sf<<18 | fbits<<20
                gen(state, rd | (rn << 8) | (type << 16) | (sf << 18) | (fbits << 20));
                return 1;
            }
        }
    }

    // FMOV (scalar, immediate) - load FP constant
    // Encoding: 000 11110 ftype 1 imm8 100 00000 Rd
    // ftype: 00=S, 01=D
    // Mask 0xff201fe0 checks fixed bits, ignores ftype, imm8, Rd
    if ((insn & 0xff201fe0) == 0x1e201000) {
        uint32_t ftype = (insn >> 22) & 3;
        uint32_t imm8 = (insn >> 13) & 0xff;
        uint32_t rd = insn & 0x1f;
        bool is_double = (ftype == 1);

        uint64_t fpbits = arm64_fpimm_to_bits(is_double, imm8);

        gen(state, (unsigned long) gadget_fmov_fp_imm);
        gen(state, rd | (ftype << 8));
        // Emit the 64-bit FP value as a single unsigned long
        gen(state, (unsigned long) fpbits);
        return 1;
    }

    // FCMP/FCMPE (scalar)
    // Register form: 000 11110 type 1 Rm 00 1000 Rn 0 opc 000 (bit 3 = 0)
    // Zero form:     000 11110 type 1 Rm 00 1000 Rn 1 opc 000 (bit 3 = 1)
    // Mask 0xff20fc17 checks fixed bits including bit 4 (part of opc)
    // Bit 3 distinguishes register (0) from zero (1) comparison
    if ((insn & 0xff20fc00) == 0x1e202000) {
        uint32_t type = (insn >> 22) & 3;
        uint32_t rn = (insn >> 5) & 0x1f;
        if (type > 1) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }
        if (insn & 0x08) {
            // Bit 3 set: FCMP/FCMPE with zero
            gen(state, (unsigned long) gadget_fcmp_zero_scalar);
            // Pack: rn | type<<16
            gen(state, rn | (type << 16));
        } else {
            // Bit 3 clear: FCMP/FCMPE with register
            uint32_t rm = (insn >> 16) & 0x1f;
            gen(state, (unsigned long) gadget_fcmp_scalar);
            // Pack: rn | rm<<8 | type<<16
            gen(state, rn | (rm << 8) | (type << 16));
        }
        return 1;
    }

    // FCCMP/FCCMPE - Floating-point conditional compare
    // Encoding: 0 0 0 11110 ftype 1 Rm cond 01 Rn op nzcv
    // Mask 0xff200c00 checks M,S,fixed,bit21; bits 11:10=01
    if ((insn & 0xff200c00) == 0x1e200400) {
        uint32_t ftype = (insn >> 22) & 3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t cond = (insn >> 12) & 0xf;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t nzcv = insn & 0xf;
        if (ftype > 1) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }
        gen(state, (unsigned long) gadget_fccmp_scalar);
        // Pack: rn | rm<<8 | ftype<<16 | cond<<20 | nzcv<<24
        gen(state, rn | (rm << 8) | (ftype << 16) | (cond << 20) | (nzcv << 24));
        return 1;
    }

    // FCSEL - Floating-point conditional select
    // Encoding: 0 0 0 11110 ftype 1 Rm cond 11 Rn Rd
    // Mask 0xff200c00 checks M,S,fixed,bit21; bits 11:10=11
    if ((insn & 0xff200c00) == 0x1e200c00) {
        uint32_t ftype = (insn >> 22) & 3;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t cond = (insn >> 12) & 0xf;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        if (ftype > 1) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }
        gen(state, (unsigned long) gadget_fcsel_scalar);
        // Pack two words: [rd | rn<<8 | rm<<16 | ftype<<24] [cond]
        gen(state, rd | (rn << 8) | (rm << 16) | (ftype << 24));
        gen(state, cond);
        return 1;
    }

    // Floating-point data-processing (1 source), scalar
    // Pattern: M=0 S=0 1 1 1 1 0 ftype 1 opcode 10000 Rn Rd
    // Mask 0xff207c00: M,S,fixed,ftype,bit21,bits14:10=10000
    if ((insn & 0xff207c00) == 0x1e204000) {
        uint32_t ftype = (insn >> 22) & 3;
        uint32_t opcode = (insn >> 15) & 0x3f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // Validate: ftype 0=single, 1=double; opcode must be valid
        // We handle all common single/double dp1 ops via a generic gadget that
        // re-executes the instruction natively on the host (with emulated FP
        // reg operands). Zig probes scalar FP16 conversion through FCVT Sd,Hn,
        // so keep that one half-precision form explicit.
        if (ftype <= 1 && opcode <= 15) {
            gen(state, (unsigned long) gadget_fp_dp1);
            // Pack: rd | rn<<8 | ftype<<16 | opcode<<20
            gen(state, rd | (rn << 8) | (ftype << 16) | (opcode << 20));
            return 1;
        }
        if (ftype == 3 && opcode == 4) {
            gen(state, (unsigned long) gadget_fcvt_h_to_s_scalar);
            gen(state, rd | (rn << 8));
            return 1;
        }
        if (ftype == 3 && opcode == 5) {
            gen(state, (unsigned long) gadget_fcvt_h_to_d_scalar);
            gen(state, rd | (rn << 8));
            return 1;
        }
    }

    // Floating-point data-processing (2 source), scalar
    // Pattern: M=0 S=0 1 1 1 1 0 type 1 Rm opcode 10 Rn Rd
    // Mask 0xff20c000 checks M,S,fixed,bit21; bits 15:12 = opcode
    if ((insn & 0xff200000) == 0x1e200000 && ((insn >> 10) & 3) == 2) {
        uint32_t type = (insn >> 22) & 3;
        uint32_t opcode = (insn >> 12) & 0xf;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        if (type > 1) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        switch (opcode) {
            case 0x0: gadget = gadget_fmul_scalar; break;    // FMUL
            case 0x1: gadget = gadget_fdiv_scalar; break;    // FDIV
            case 0x2: gadget = gadget_fadd_scalar; break;    // FADD
            case 0x3: gadget = gadget_fsub_scalar; break;    // FSUB
            case 0x4: gadget = gadget_fmax_scalar; break;    // FMAX
            case 0x5: gadget = gadget_fmin_scalar; break;    // FMIN
            case 0x6: gadget = gadget_fmaxnm_scalar; break; // FMAXNM
            case 0x7: gadget = gadget_fminnm_scalar; break; // FMINNM
            case 0x8: gadget = gadget_fnmul_scalar; break;   // FNMUL
            default: break;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            // Pack: rd | rn<<8 | rm<<16 | type<<24
            gen(state, rd | (rn << 8) | (rm << 16) | (type << 24));
            return 1;
        }
    }

    // Floating-point data-processing (3 source) - FMADD/FMSUB/FNMADD/FNMSUB
    // Pattern: M=0 S=0 1 1 1 1 1 ftype o1 Rm o0 Ra Rn Rd
    // ftype: 00=single, 01=double
    // o1:o0 = 00: FMADD  (Fd = Fn * Fm + Fa)
    //       = 01: FMSUB  (Fd = Fn * Fm - Fa)
    //       = 10: FNMADD (Fd = -(Fn * Fm) - Fa)
    //       = 11: FNMSUB (Fd = -(Fn * Fm) + Fa)
    if ((insn & 0x5f000000) == 0x1f000000) {
        uint32_t M = (insn >> 31) & 1;
        uint32_t S = (insn >> 29) & 1;
        uint32_t ftype = (insn >> 22) & 3;
        uint32_t o1 = (insn >> 21) & 1;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t o0 = (insn >> 15) & 1;
        uint32_t ra = (insn >> 10) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        // M and S must be 0 for scalar FP data-processing (3 source)
        if (M != 0 || S != 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        // Only single (ftype=0) and double (ftype=1) precision supported
        if (ftype > 1) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        uint32_t op = (o1 << 1) | o0;
        void *gadget = NULL;
        switch (op) {
            case 0: gadget = gadget_fmadd_scalar; break;
            case 1: gadget = gadget_fmsub_scalar; break;
            case 2: gadget = gadget_fnmadd_scalar; break;
            case 3: gadget = gadget_fnmsub_scalar; break;
        }

        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | ra<<24
        gen(state, rd | (rn << 8) | (rm << 16) | (ra << 24));
        // ftype as second word
        gen(state, ftype);
        return 1;
    }

    // TBL/TBX - Table lookup
    // TBL: 0 Q 00 1110 000 Rm 0 len 0 0 Rn Rd
    // TBX: 0 Q 00 1110 000 Rm 0 len 1 0 Rn Rd
    // Mask: 0xbfe08c00 = 1011_1111_1110_0000_1000_1100_0000_0000
    // Value: 0x0e000000
    if ((insn & 0xbfe08c00) == 0x0e000000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t op = (insn >> 12) & 0x1;  // 0=TBL, 1=TBX
        uint32_t len = (insn >> 13) & 0x3; // table size: 0=1reg, 1=2reg, 2=3reg, 3=4reg
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t Q = (insn >> 30) & 0x1;   // 0=64-bit, 1=128-bit

        void *gadget = op ? gadget_tbx : gadget_tbl;
        gen(state, (unsigned long) gadget);
        // Pack: rd | rn<<8 | rm<<16 | len<<24 | Q<<28
        gen(state, rd | (rn << 8) | (rm << 16) | (len << 24) | (Q << 28));
        return 1;
    }

    // EXT - Extract from pair of vectors
    // 0 Q 10 1110 00 0 Rm 0 imm4 0 Rn Rd
    // Mask: 0xbfe08400 Value: 0x2e000000
    if ((insn & 0xbfe08400) == 0x2e000000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t imm4 = (insn >> 11) & 0xf;  // byte index
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t Q = (insn >> 30) & 0x1;     // 0=8B, 1=16B

        gen(state, (unsigned long) gadget_ext_vec);
        // Pack: rd | rn<<8 | rm<<16 | imm4<<24 | Q<<28
        gen(state, rd | (rn << 8) | (rm << 16) | (imm4 << 24) | (Q << 28));
        return 1;
    }

    // Cryptographic AES instructions
    // AESE/AESD/AESMC/AESIMC: 0100_1110_0010_1000_opcode_10_Rn_Rd
    // AESE:   0x4e284800 (opcode=0100)
    // AESD:   0x4e285800 (opcode=0101)
    // AESMC:  0x4e286800 (opcode=0110)
    // AESIMC: 0x4e287800 (opcode=0111)
    // Mask 0xff3f0c00 keeps bits 31:22, 11:10, ignores opcode (15:12), Rn, Rd
    if ((insn & 0xff3f0c00) == 0x4e280800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t opcode = (insn >> 12) & 0xf;

        void *gadget = NULL;
        switch (opcode) {
            case 4: gadget = gadget_aese; break;   // 0100 -> AESE
            case 5: gadget = gadget_aesd; break;   // 0101 -> AESD
            case 6: gadget = gadget_aesmc; break;  // 0110 -> AESMC
            case 7: gadget = gadget_aesimc; break; // 0111 -> AESIMC
        }
        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8));
            return 1;
        }
    }

    // SHA1 and SHA256 two-register crypto
    // SHA1H:     0101 1110 0010 1000 0000 10 Rn Rd (0x5e280800)
    // SHA1SU1:   0101 1110 0010 1000 0001 10 Rn Rd (0x5e281800)
    // SHA256SU0: 0101 1110 0010 1000 0010 10 Rn Rd (0x5e282800)
    // Mask 0xffffcc00 keeps bits 31:14 and 11:10, ignores opcode (13:12), Rn, Rd
    if ((insn & 0xffffcc00) == 0x5e280800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t opcode = (insn >> 12) & 0x3;

        void *gadget = NULL;
        switch (opcode) {
            case 0: gadget = gadget_sha1h; break;      // SHA1H
            case 1: gadget = gadget_sha1su1; break;    // SHA1SU1
            case 2: gadget = gadget_sha256su0; break;  // SHA256SU0
        }
        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8));
            return 1;
        }
    }

    // SHA1 three-register: SHA1C, SHA1M, SHA1P, SHA1SU0
    // Pattern: 0101 1110 000 Rm 0 opcode 00 Rn Rd (bit 14=0 for SHA1)
    // SHA1C:   0x5e000000  (opcode=00)
    // SHA1P:   0x5e001000  (opcode=01)
    // SHA1M:   0x5e002000  (opcode=10)
    // SHA1SU0: 0x5e003000  (opcode=11)
    // Mask 0xffe04c00 includes bit 14 to distinguish from SHA256 (bit14=1)
    if ((insn & 0xffe04c00) == 0x5e000000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 12) & 0x3;

        void *gadget = NULL;
        switch (opcode) {
            case 0: gadget = gadget_sha1c; break;
            case 1: gadget = gadget_sha1p; break;
            case 2: gadget = gadget_sha1m; break;
            case 3: gadget = gadget_sha1su0; break;
        }
        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8) | (rm << 16));
            return 1;
        }
    }

    // SHA256 three-register: SHA256H, SHA256H2, SHA256SU1
    // Pattern: 0101 1110 000 Rm 0 opcode 00 Rn Rd (opcode in bits 13-12, bit 14=1 for SHA256)
    // SHA256H:   0x5e004000  (opcode=00)
    // SHA256H2:  0x5e005000  (opcode=01)
    // SHA256SU1: 0x5e006000  (opcode=10)
    // Mask 0xffe04c00 includes bit 14 to distinguish from SHA1 (bit14=0)
    if ((insn & 0xffe04c00) == 0x5e004000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 12) & 0x3;

        void *gadget = NULL;
        switch (opcode) {
            case 0: gadget = gadget_sha256h; break;
            case 1: gadget = gadget_sha256h2; break;
            case 2: gadget = gadget_sha256su1; break;
        }
        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8) | (rm << 16));
            return 1;
        }
    }

    // SHA512SU0: SHA512 schedule update 0 (two-register)
    // Pattern: 1100 1110 1100 0000 1000 0 Rn Rd (0xcec08000)
    if ((insn & 0xfffffc00) == 0xcec08000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        gen(state, (unsigned long) gadget_sha512su0);
        gen(state, rd | (rn << 8));
        return 1;
    }

    // SHA512H: SHA512 hash update part 1 (three-register)
    // Pattern: 1100 1110 011 Rm 1000 00 Rn Rd (0xce608000)
    if ((insn & 0xffe0fc00) == 0xce608000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        gen(state, (unsigned long) gadget_sha512h);
        gen(state, rd | (rn << 8) | (rm << 16));
        return 1;
    }

    // SHA512H2: SHA512 hash update part 2 (three-register)
    // Pattern: 1100 1110 011 Rm 1000 01 Rn Rd (0xce608400)
    if ((insn & 0xffe0fc00) == 0xce608400) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        gen(state, (unsigned long) gadget_sha512h2);
        gen(state, rd | (rn << 8) | (rm << 16));
        return 1;
    }

    // SHA512SU1: SHA512 schedule update 1 (three-register)
    // Pattern: 1100 1110 011 Rm 1000 10 Rn Rd (0xce608800)
    if ((insn & 0xffe0fc00) == 0xce608800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        gen(state, (unsigned long) gadget_sha512su1);
        gen(state, rd | (rn << 8) | (rm << 16));
        return 1;
    }

    // SM4E: SM4 round (two-register)
    // Pattern: 1100 1110 1100 0000 1000 01 Rn Rd (0xcec08400)
    if ((insn & 0xfffffc00) == 0xcec08400) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        gen(state, (unsigned long) gadget_sm4e);
        gen(state, rd | (rn << 8));
        return 1;
    }

    // SM3PARTW1: SM3 message schedule update (three-register)
    // Pattern: 1100 1110 0110 0000 1100 00 Rm Rn Rd (0xce60c000)
    if ((insn & 0xffe0fc00) == 0xce60c000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        gen(state, (unsigned long) gadget_sm3partw1);
        gen(state, rd | (rn << 8) | (rm << 16));
        return 1;
    }

    // EOR3: XOR of three vectors (four-register)
    // Pattern: 1100 1110 0000 0000 1000 00 Rm Ra Rn Rd (0xce000000)
    if ((insn & 0xffe08000) == 0xce000000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t ra = (insn >> 10) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        gen(state, (unsigned long) gadget_eor3);
        gen(state, rd | (rn << 8) | (rm << 16) | (ra << 24));
        return 1;
    }

    // PMULL: Polynomial Multiply Long
    // Pattern: 0 Q 00 1110 size 1 Rm 1110 00 Rn Rd
    // PMULL (8B):  0x0e20e000  (Q=0, size=00)
    // PMULL2 (16B): 0x4e20e000 (Q=1, size=00)
    // PMULL (1D):  0x0ee0e000  (Q=0, size=11)
    // PMULL2 (2D): 0x4ee0e000  (Q=1, size=11)
    if ((insn & 0xbf20fc00) == 0x0e20e000) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rm = (insn >> 16) & 0x1f;
        uint32_t Q = (insn >> 30) & 1;
        uint32_t size = (insn >> 22) & 0x3;


        gen(state, (unsigned long) gadget_pmull);
        gen(state, rd | (rn << 8) | (rm << 16) | (Q << 24) | (size << 26));
        return 1;
    }

    // AdvSIMD scalar x indexed element
    // Pattern: 01 op 11111 size L M Rm opcode H 0 Rn Rd
    // Fixed: bits[31:30]=01, bits[28:24]=11111, bit[10]=0
    // Mask: 0xff000400, Value: 0x5f000000
    if ((insn & 0xff000400) == 0x5f000000) {
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 3;
        uint32_t L = (insn >> 21) & 1;
        uint32_t M = (insn >> 20) & 1;
        uint32_t Rm4 = (insn >> 16) & 0xf;
        uint32_t opcode_elem = (insn >> 12) & 0xf;
        uint32_t H = (insn >> 11) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        uint32_t rm, index;
        if (size == 2) {
            rm = (M << 4) | Rm4;
            index = (H << 1) | L;
        } else if (size == 3) {
            rm = (M << 4) | Rm4;
            index = H;
        } else {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        // Pack: rd | rn<<8 | rm<<16 | index<<21 | size<<24
        uint64_t packed = rd | (rn << 8) | (rm << 16) | (index << 21) | (size << 24);

        if (U == 0 && opcode_elem == 0x9) {
            gadget = gadget_fmul_elem_scalar;
        } else if (U == 0 && opcode_elem == 0x1) {
            gadget = gadget_fmla_elem_scalar;
        } else if (U == 0 && opcode_elem == 0x5) {
            gadget = gadget_fmls_elem_scalar;
        } else if (U == 1 && opcode_elem == 0x9) {
            gadget = gadget_fmulx_elem_scalar;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, packed);
            return 1;
        }
    }

    // AdvSIMD vector x indexed element
    // Pattern: 0 Q U 01111 size L M Rm opcode H 0 Rn Rd
    // Fixed: bit[31]=0, bits[28:24]=01111, bit[10]=0
    // Mask: 0x9f000400, Value: 0x0f000000
    if ((insn & 0x9f000400) == 0x0f000000) {
        uint32_t Q = (insn >> 30) & 1;
        uint32_t U = (insn >> 29) & 1;
        uint32_t size = (insn >> 22) & 3;
        uint32_t L = (insn >> 21) & 1;
        uint32_t M = (insn >> 20) & 1;
        uint32_t Rm4 = (insn >> 16) & 0xf;
        uint32_t opcode_elem = (insn >> 12) & 0xf;
        uint32_t H = (insn >> 11) & 1;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;

        uint32_t rm, index;
        if (size == 1) {  // H: index = H:L:M, Rm = Rm4
            rm = Rm4;
            index = (H << 2) | (L << 1) | M;
        } else if (size == 2) {  // S: index = H:L, Rm = M:Rm4
            rm = (M << 4) | Rm4;
            index = (H << 1) | L;
        } else if (size == 3) {  // D: index = H, Rm = M:Rm4
            rm = (M << 4) | Rm4;
            index = H;
        } else {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        // Pack: rd | rn<<8 | rm<<16 | index<<21 | size<<24 | Q<<26
        uint64_t packed = rd | (rn << 8) | (rm << 16) | (index << 21) | (size << 24) | (Q << 26);

        if (U == 0 && opcode_elem == 0x8) {
            // MUL by element (H/S only)
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_mul_elem_vec;
        } else if (U == 1 && opcode_elem == 0x0) {
            // MLA by element (H/S only) — U=1, opcode=0x0
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_mla_elem_vec;
        } else if (U == 1 && opcode_elem == 0x4) {
            // MLS by element (H/S only) — U=1, opcode=0x4
            if (size == 3) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_mls_elem_vec;
        } else if (U == 0 && opcode_elem == 0xa) {
            // SMULL by element
            gadget = gadget_smull_elem_vec;
        } else if (U == 1 && opcode_elem == 0xa) {
            // UMULL by element
            gadget = gadget_umull_elem_vec;
        } else if (U == 0 && opcode_elem == 0x2) {
            // SMLAL by element
            gadget = gadget_smlal_elem_vec;
        } else if (U == 1 && opcode_elem == 0x2) {
            // UMLAL by element
            gadget = gadget_umlal_elem_vec;
        } else if (U == 0 && opcode_elem == 0x6) {
            // SMLSL by element
            gadget = gadget_smlsl_elem_vec;
        } else if (U == 1 && opcode_elem == 0x6) {
            // UMLSL by element
            gadget = gadget_umlsl_elem_vec;
        } else if (U == 0 && opcode_elem == 0x9) {
            // FMUL by element (size=2:S, size=3:D; size<2 is FP16/invalid)
            if (size < 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_fmul_elem_vec;
        } else if (U == 0 && opcode_elem == 0x1) {
            // FMLA by element (size=2:S, size=3:D)
            if (size < 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_fmla_elem_vec;
        } else if (U == 0 && opcode_elem == 0x5) {
            // FMLS by element (size=2:S, size=3:D)
            if (size < 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_fmls_elem_vec;
        } else if (U == 0 && opcode_elem == 0xc) {
            // SQDMULH by element (H/S only)
            if (size < 1 || size > 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqdmulh_elem_vec;
        } else if (U == 0 && opcode_elem == 0xd) {
            // SQRDMULH by element (H/S only)
            if (size < 1 || size > 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqrdmulh_elem_vec;
        } else if (U == 0 && opcode_elem == 0xb) {
            // SQDMULL by element (H→S, S→D widening)
            if (size < 1 || size > 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqdmull_elem_vec;
        } else if (U == 0 && opcode_elem == 0x3) {
            // SQDMLAL by element (widening multiply-accumulate)
            if (size < 1 || size > 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqdmlal_elem_vec;
        } else if (U == 0 && opcode_elem == 0x7) {
            // SQDMLSL by element (widening multiply-subtract)
            if (size < 1 || size > 2) { gen_interrupt(state, INT_UNDEFINED); return 0; }
            gadget = gadget_sqdmlsl_elem_vec;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, packed);
            return 1;
        }
        // Fall through to try other decoders for unimplemented opcodes
    }

    // AdvSIMD scalar three-same: 01 U 11110 sz 1 Rm opcode 1 Rn Rd
    // ADD (scalar, 64-bit integer): U=0, opcode=10000
    // SUB (scalar, 64-bit integer): U=1, opcode=10000
    // Mask: 0xdf200400, Value: 0x5e200400
    if ((insn & 0xdf200400) == 0x5e200400) {
        uint32_t U = (insn >> 29) & 1;
        uint32_t sz = (insn >> 22) & 3;
        uint32_t Rm = (insn >> 16) & 0x1f;
        uint32_t opcode = (insn >> 11) & 0x1f;
        uint32_t Rn = (insn >> 5) & 0x1f;
        uint32_t Rd = insn & 0x1f;

        void *gadget = NULL;
        if (sz == 3 && opcode == 0x10 && U == 0) {
            // ADD d, d, d (64-bit integer)
            gadget = gadget_add_scalar_i64;
        } else if (sz == 3 && opcode == 0x10 && U == 1) {
            // SUB d, d, d (64-bit integer)
            gadget = gadget_sub_scalar_i64;
        } else if (sz == 3 && opcode == 0x08 && U == 1) {
            // USHL d, d, d (unsigned shift left)
            gadget = gadget_ushl_scalar_i64;
        } else if (sz == 3 && opcode == 0x08 && U == 0) {
            // SSHL d, d, d (signed shift left)
            gadget = gadget_sshl_scalar_i64;
        } else if (sz == 3 && opcode == 0x06 && U == 1) {
            // CMHI d, d, d (compare higher unsigned)
            gadget = gadget_cmhi_scalar_i64;
        } else if (sz == 3 && opcode == 0x07 && U == 1) {
            // CMHS d, d, d (compare higher or same unsigned)
            gadget = gadget_cmhs_scalar_i64;
        } else if (sz == 3 && opcode == 0x06 && U == 0) {
            // CMGT d, d, d (compare greater than signed)
            gadget = gadget_cmgt_scalar_i64;
        } else if (sz == 3 && opcode == 0x07 && U == 0) {
            // CMGE d, d, d (compare greater or equal signed)
            gadget = gadget_cmge_scalar_i64;
        } else if (sz == 3 && opcode == 0x11 && U == 1) {
            // CMEQ d, d, d (compare equal)
            gadget = gadget_cmeq_scalar_i64;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, Rd | (Rn << 8) | (Rm << 16));
            return 1;
        }

        // FABD (scalar): U=1, bit23=1, opcode=11010 (0x1A)
        // Floating-point absolute difference: Vd = |Vn - Vm|
        // bit22 = 0: single, bit22 = 1: double
        if (U == 1 && (sz & 2) && opcode == 0x1a) {
            uint32_t type = sz & 1; // bit 22: 0=single, 1=double
            gen(state, (unsigned long) gadget_fabd_scalar);
            gen(state, Rd | (Rn << 8) | (Rm << 16) | (type << 24));
            return 1;
        }
    }

    // FADDP (scalar) - Floating-point Add Pair of elements
    // Encoding: 0111111 0 0 sz 110000 110110 Rn Rd
    // sz=0: single (FADDP Sd, Vn.2S), sz=1: double (FADDP Dd, Vn.2D)
    // Mask: 0xffbffc00, Value: 0x7e30d800
    if ((insn & 0xffbffc00) == 0x7e30d800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        gen(state, (unsigned long) gadget_faddp_scalar);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }

    // FMAXP/FMINP (scalar) - Floating-point Max/Min Pair of elements
    // FMAXP: 0111 1110 0 sz 11000 01111 10 Rn Rd  (U=1, size[1]=0)
    // FMINP: 0111 1110 1 sz 11000 01111 10 Rn Rd  (U=1, size[1]=1)
    // Mask: 0xffbffc00 (ignores sz=bit22)
    if ((insn & 0xffbffc00) == 0x7e30f800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        gen(state, (unsigned long) gadget_fmaxp_scalar);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }
    if ((insn & 0xffbffc00) == 0x7eb0f800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        gen(state, (unsigned long) gadget_fminp_scalar);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }

    // FMAXNMP/FMINNMP (scalar) - Floating-point MaxNum/MinNum Pair of elements
    // FMAXNMP: 0111 1110 0 sz 11000 01100 10 Rn Rd  (bit23=0, opcode=01100)
    // FMINNMP: 0111 1110 1 sz 11000 01100 10 Rn Rd  (bit23=1, opcode=01100)
    if ((insn & 0xffbffc00) == 0x7e30c800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        gen(state, (unsigned long) gadget_fmaxnmp_scalar);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }
    if ((insn & 0xffbffc00) == 0x7eb0c800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        gen(state, (unsigned long) gadget_fminnmp_scalar);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }

    // ADDP (scalar) - Integer Add Pair of elements (64-bit only)
    // Encoding: 0101 1110 1111 0001 1011 1000 Rn Rd
    // Mask: 0xfffffc00, Value: 0x5ef1b800
    if ((insn & 0xfffffc00) == 0x5ef1b800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        gen(state, (unsigned long) gadget_addp_scalar);
        gen(state, rd | (rn << 8));
        return 1;
    }

    // Scalar integer two-register miscellaneous (size=11, 64-bit only)
    // Encoding: 01 U 11110 11 10000 opcode 10 Rn Rd
    // CMGT D,D,#0: U=0, opcode=01000 (0x08)
    // CMGE D,D,#0: U=1, opcode=01000 (0x08)
    // CMEQ D,D,#0: U=0, opcode=01001 (0x09)
    // CMLE D,D,#0: U=1, opcode=01001 (0x09)
    // CMLT D,D,#0: U=0, opcode=01010 (0x0a)
    // ABS D,D:     U=0, opcode=01011 (0x0b)
    // NEG D,D:     U=1, opcode=01011 (0x0b)
    // Mask: 0xdffe0c00, Value: 0x5ee00800
    if ((insn & 0xdffe0c00) == 0x5ee00800) {
        uint32_t U = (insn >> 29) & 1;
        uint32_t opcode = (insn >> 12) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        void *gadget = NULL;

        if (opcode == 0x08 && U == 0) gadget = gadget_cmgt_scalar_zero;
        else if (opcode == 0x08 && U == 1) gadget = gadget_cmge_scalar_zero;
        else if (opcode == 0x09 && U == 0) gadget = gadget_cmeq_scalar_zero;
        else if (opcode == 0x09 && U == 1) gadget = gadget_cmle_scalar_zero;
        else if (opcode == 0x0a && U == 0) gadget = gadget_cmlt_scalar_zero;
        else if (opcode == 0x0b && U == 0) gadget = gadget_abs_scalar;
        else if (opcode == 0x0b && U == 1) gadget = gadget_neg_scalar;

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8));
            return 1;
        }
    }

    // FP scalar two-register miscellaneous — compare against zero
    // Encoding: 01 U 11110 1 sz 10000 opcode 10 Rn Rd
    // bit[23]=1 (FP range), bit[22]=sz (0=single, 1=double)
    // FCMGT: U=0, opcode=01100 (0x0c)
    // FCMGE: U=1, opcode=01100 (0x0c)
    // FCMEQ: U=0, opcode=01101 (0x0d)
    // FCMLE: U=1, opcode=01101 (0x0d)
    // FCMLT: U=0, opcode=01110 (0x0e)
    // Mask: 0xdfbe0c00 (ignores U=bit29, sz=bit22), Value: 0x5ea00800
    if ((insn & 0xdfbe0c00) == 0x5ea00800) {
        uint32_t U = (insn >> 29) & 1;
        uint32_t sz = (insn >> 22) & 1;
        uint32_t opcode = (insn >> 12) & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t rd = insn & 0x1f;
        void *gadget = NULL;

        if (opcode == 0x0c && U == 0) gadget = gadget_fcmgt_scalar_zero;
        else if (opcode == 0x0c && U == 1) gadget = gadget_fcmge_scalar_zero;
        else if (opcode == 0x0d && U == 0) gadget = gadget_fcmeq_scalar_zero;
        else if (opcode == 0x0d && U == 1) gadget = gadget_fcmle_scalar_zero;
        else if (opcode == 0x0e && U == 0) gadget = gadget_fcmlt_scalar_zero;

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8) | (sz << 16));
            return 1;
        }
    }

    // FCVTZS/FCVTZU (scalar, integer) - SIMD scalar form
    // Convert floating-point to integer (result in SIMD register)
    // Encoding: 01 U 11110 1 sz 100001 opcode Rn Rd
    // FCVTZS: U=0, opcode=101110 (0x2e)
    // FCVTZU: U=1, opcode=101110 (0x2e)
    // sz=0: single (S), sz=1: double (D)
    // Mask 0xdfbffc00 checks fixed bits, ignores U (bit29), sz (bit22), Rn, Rd
    if ((insn & 0xdfbffc00) == 0x5ea1b800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        uint32_t U = (insn >> 29) & 1;

        void *gadget = U ? gadget_fcvtzu_simd_scalar : gadget_fcvtzs_simd_scalar;
        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }

    // UCVTF/SCVTF (scalar, integer) - SIMD scalar form
    // Convert integer to floating-point (result in SIMD register)
    // Encoding: 01 U 11110 0 sz 1 00001 110110 Rn Rd
    // SCVTF: U=0 (signed)
    // UCVTF: U=1 (unsigned)
    // sz=0: single (S), sz=1: double (D)
    // Mask 0xdfbffc00 checks fixed bits, ignores U (bit29), sz (bit22), Rn, Rd
    if ((insn & 0xdfbffc00) == 0x5e21d800) {
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;
        uint32_t sz = (insn >> 22) & 1;
        uint32_t U = (insn >> 29) & 1;

        void *gadget = U ? gadget_ucvtf_simd_scalar : gadget_scvtf_simd_scalar;
        gen(state, (unsigned long) gadget);
        gen(state, rd | (rn << 8) | (sz << 16));
        return 1;
    }

    // SHL/SSHR/USHR (scalar, immediate) - Scalar shift by immediate
    // Encoding: 01 U 11111 0 immh immb opcode Rn Rd
    // SHL:  U=0, opcode=01010 (0x0a)
    // SSHR: U=0, opcode=00000 (0x00)
    // USHR: U=1, opcode=00000 (0x00)
    // immh determines element size: 1xxx=64-bit, 01xx=32-bit, 001x=16-bit, 0001=8-bit
    // Mask 0xdf800400 checks bits 31:30, 28:24, 23, 10 (fixed bits)
    if ((insn & 0xdf800400) == 0x5f000400) {
        uint32_t U = (insn >> 29) & 1;
        uint32_t immh = (insn >> 19) & 0xf;
        uint32_t immb = (insn >> 16) & 0x7;
        uint32_t opcode = (insn >> 11) & 0x1f;
        uint32_t rd = insn & 0x1f;
        uint32_t rn = (insn >> 5) & 0x1f;

        // Determine element size and shift amount from immh:immb
        int esize = -1;
        int shift = 0;
        int immhb = (immh << 3) | immb;

        if (immh & 0x8) {
            esize = 3;  // 64-bit
            shift = immhb - 64;  // For SHL: shift = immh:immb - 64
        } else if (immh & 0x4) {
            esize = 2;  // 32-bit
            shift = immhb - 32;
        } else if (immh & 0x2) {
            esize = 1;  // 16-bit
            shift = immhb - 16;
        } else if (immh & 0x1) {
            esize = 0;  // 8-bit
            shift = immhb - 8;
        }

        if (esize < 0) {
            gen_interrupt(state, INT_UNDEFINED);
            return 0;
        }

        void *gadget = NULL;
        if (U == 0 && opcode == 0x0a) {
            // SHL (scalar)
            gadget = gadget_shl_imm_scalar;
        } else if (U == 0 && opcode == 0x00) {
            // SSHR (scalar) - for SSHR, shift = (esize*8*2) - immh:immb
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_sshr_imm_scalar;
        } else if (U == 1 && opcode == 0x00) {
            // USHR (scalar)
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_ushr_imm_scalar;
        } else if (U == 0 && opcode == 0x02) {
            // SSRA (scalar) - signed shift right and accumulate
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_ssra_imm_scalar;
        } else if (U == 1 && opcode == 0x02) {
            // USRA (scalar) - unsigned shift right and accumulate
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_usra_imm_scalar;
        } else if (U == 0 && opcode == 0x1c) {
            // SCVTF (scalar, fixed-point) - signed int to FP
            // fbits = (esize*2*8) - immh:immb
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_scvtf_fixpt_scalar;
        } else if (U == 1 && opcode == 0x1c) {
            // UCVTF (scalar, fixed-point) - unsigned int to FP
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_ucvtf_fixpt_scalar;
        } else if (U == 0 && opcode == 0x1f) {
            // FCVTZS (scalar, fixed-point) - FP to signed int, round toward zero
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_fcvtzs_fixpt_scalar;
        } else if (U == 1 && opcode == 0x1f) {
            // FCVTZU (scalar, fixed-point) - FP to unsigned int, round toward zero
            if (esize == 3) shift = 128 - immhb;
            else if (esize == 2) shift = 64 - immhb;
            else if (esize == 1) shift = 32 - immhb;
            else shift = 16 - immhb;
            gadget = gadget_fcvtzu_fixpt_scalar;
        }

        if (gadget) {
            gen(state, (unsigned long) gadget);
            gen(state, rd | (rn << 8) | (shift << 16) | (esize << 24));
            return 1;
        }
    }

    // SIMD/FP instructions not implemented yet
    gen_interrupt(state, INT_UNDEFINED);
    return 0;
}
