#ifndef EMU_GEN_H
#define EMU_GEN_H

#include <stdint.h>

#include "asbestos/asbestos.h"
#include "emu/tlb.h"

#define GEN_INTERNAL_CONTINUE_MAX 6
#define GEN_INTERNAL_CONTINUE_BUDGET_INSNS 2

struct gen_state {
    addr_t ip;
    addr_t orig_ip;
    unsigned long orig_ip_extra;
    struct fiber_block *block;
    unsigned size;
    unsigned capacity;
    unsigned jump_ip[2];
    unsigned block_patch_ip; // for call/call_indir gadgets
    // Dormant true-superblock scaffold: internal continue operands store code
    // offsets while state->block is reallocatable, then gen_end patches them
    // to final absolute code-stream pointers. These are not normal jump_ip
    // slots and must never be consumed by fiber_ret_chain/block chaining.
    unsigned internal_continue_count;
    unsigned internal_continue_patch_ip[GEN_INTERNAL_CONTINUE_MAX];
    unsigned internal_continue_target_ip[GEN_INTERNAL_CONTINUE_MAX];
    unsigned internal_continue_used;
    addr_t internal_continue_segment_start;
    unsigned internal_continue_segment_budget;
    uint32_t last_insn;
    struct tlb *tlb; // for peephole optimization (peek at next instruction)
    unsigned b_follow_depth; // how many unconditional B's we've followed inline
};

void gen_start(addr_t addr, struct gen_state *state);
void gen_exit(struct gen_state *state);
void gen_end(struct gen_state *state);

int gen_step(struct gen_state *state, struct tlb *tlb);

#endif
