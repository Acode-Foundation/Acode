#define DEFAULT_CHANNEL instr
#include "debug.h"
#include <signal.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <time.h>
#include <string.h>
#include <stdlib.h>
#include "asbestos/asbestos.h"
#include "asbestos/gen.h"
#include "asbestos/frame.h"
#include "emu/cpu.h"
#include "emu/interrupt.h"
#include "emu/tlb.h"
#include "kernel/memory.h"
#include "util/list.h"

// Thread-local recovery state for JIT crash handling.
// When a host SIGSEGV occurs inside JIT code (due to a stale TLB pointer
// from a concurrent CoW), the signal handler redirects PC to
// jit_crash_trampoline via ucontext, which returns INT_GPF to the
// dispatch loop. handle_interrupt resolves via mem_ptr (CoW/GROWSDOWN).
//
// This avoids the overhead of _setjmp on every block entry (~1.5% of
// total execution time). The signal handler writes crash info directly
// to cpu_state via the _cpu pointer (x1) from ucontext.
__thread volatile sig_atomic_t in_jit;
__thread volatile addr_t jit_saved_pc;  // block start PC, read by signal handler
// Marker set to 1 on iSH execution threads so the signal handler can distinguish
// iSH threads from app threads (Swift async, networking, UI).
__thread int ish_thread_marker;

// Architecture-specific instruction pointer access
#if defined(GUEST_ARM64)
#define CPU_IP(cpu) ((cpu)->pc)
#define CPU_HAS_SINGLE_STEP 0
#else
#define CPU_IP(cpu) ((cpu)->eip)
#define CPU_HAS_SINGLE_STEP ((cpu)->tf)
#endif

extern int current_pid(void);

#ifdef GUEST_ARM64
__attribute__((weak)) void *mem_ptr(struct mem *mem, addr_t addr, int type) {
    (void) mem;
    (void) addr;
    (void) type;
    return NULL;
}
#endif

#ifdef GUEST_ARM64
bool arm64_block_stats_enabled;
static bool arm64_block_stats_dumped;
static bool arm64_eager_prechain_enabled;
static bool arm64_eager_prechain_incoming_enabled;
static _Atomic uint64_t arm64_block_stats_entries;
static _Atomic uint64_t arm64_block_stats_cache_hits;
static _Atomic uint64_t arm64_block_stats_cache_misses;
static _Atomic uint64_t arm64_block_stats_compiled;
static _Atomic uint64_t arm64_block_stats_code_words;
static _Atomic uint64_t arm64_block_stats_guest_bytes;
static _Atomic uint64_t arm64_block_stats_jump0;
static _Atomic uint64_t arm64_block_stats_jump1;
static _Atomic uint64_t arm64_block_stats_chain_attempts;
static _Atomic uint64_t arm64_block_stats_chain_patches;
static _Atomic uint64_t arm64_block_stats_chain_patch_slot0;
static _Atomic uint64_t arm64_block_stats_chain_patch_slot1;
static _Atomic uint64_t arm64_block_stats_chain_patch_same_page;
static _Atomic uint64_t arm64_block_stats_chain_patch_cross_page;
static _Atomic uint64_t arm64_block_stats_chain_entries;
static _Atomic uint64_t arm64_block_stats_chain_entry_slot0;
static _Atomic uint64_t arm64_block_stats_chain_entry_slot1;
static _Atomic uint64_t arm64_block_stats_chain_entry_unknown_slot;
static _Atomic uint64_t arm64_block_stats_chain_entry_same_page;
static _Atomic uint64_t arm64_block_stats_chain_entry_cross_page;
static _Atomic uint64_t arm64_block_stats_prechain_attempts;
static _Atomic uint64_t arm64_block_stats_prechain_patches;
static _Atomic uint64_t arm64_block_stats_prechain_outgoing_attempts;
static _Atomic uint64_t arm64_block_stats_prechain_outgoing_patches;
static _Atomic uint64_t arm64_block_stats_prechain_incoming_attempts;
static _Atomic uint64_t arm64_block_stats_prechain_incoming_patches;

static bool env_enabled(const char *env) {
    return env != NULL && env[0] != '\0' && strcmp(env, "0") != 0;
}

static bool env_enabled_default(const char *env, bool default_enabled) {
    if (env == NULL)
        return default_enabled;
    return env[0] != '\0' && strcmp(env, "0") != 0;
}
void arm64_block_stats_set_enabled_from_env(const char *env) {
    arm64_block_stats_enabled = env_enabled(env);
}

void arm64_eager_prechain_set_enabled_from_env(const char *env) {
    arm64_eager_prechain_enabled = env_enabled_default(env, true);
}

void arm64_eager_prechain_incoming_set_enabled_from_env(const char *env) {
    // Incoming prechain is default-on again after hardening: only still-fake
    // slots are patched, and older-block incoming patching is skipped while
    // multiple guest threads are active. Keep ISH_ARM64_EAGER_PRECHAIN_INCOMING=0
    // as an explicit diagnostic/safety opt-out.
    arm64_eager_prechain_incoming_enabled = env_enabled_default(env, true);
}

void arm64_block_stats_dump_if_enabled(void) {
    if (!arm64_block_stats_enabled || arm64_block_stats_dumped)
        return;
    arm64_block_stats_dumped = true;
    fprintf(stderr,
            "ARM64_BLOCK_STATS entries=%llu cache_hits=%llu cache_misses=%llu compiled=%llu code_words=%llu guest_bytes=%llu jump0=%llu jump1=%llu chain_attempts=%llu chain_patches=%llu chain_patch_slot0=%llu chain_patch_slot1=%llu chain_patch_same_page=%llu chain_patch_cross_page=%llu chain_entries=%llu chain_entry_slot0=%llu chain_entry_slot1=%llu chain_entry_unknown_slot=%llu chain_entry_same_page=%llu chain_entry_cross_page=%llu prechain_attempts=%llu prechain_patches=%llu prechain_outgoing_attempts=%llu prechain_outgoing_patches=%llu prechain_incoming_attempts=%llu prechain_incoming_patches=%llu\n",
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_entries, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_cache_hits, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_cache_misses, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_compiled, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_code_words, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_guest_bytes, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_jump0, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_jump1, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_attempts, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_patches, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_patch_slot0, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_patch_slot1, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_patch_same_page, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_patch_cross_page, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_entries, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_entry_slot0, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_entry_slot1, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_entry_unknown_slot, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_entry_same_page, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_chain_entry_cross_page, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_prechain_attempts, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_prechain_patches, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_prechain_outgoing_attempts, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_prechain_outgoing_patches, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_prechain_incoming_attempts, memory_order_relaxed),
            (unsigned long long)atomic_load_explicit(&arm64_block_stats_prechain_incoming_patches, memory_order_relaxed));
    fflush(stderr);
}

#define ARM64_BLOCK_STAT_INC(counter) do { \
    if (arm64_block_stats_enabled) \
        atomic_fetch_add_explicit(&(counter), 1, memory_order_relaxed); \
} while (0)
#define ARM64_BLOCK_STAT_ADD(counter, value) do { \
    if (arm64_block_stats_enabled) \
        atomic_fetch_add_explicit(&(counter), (uint64_t)(value), memory_order_relaxed); \
} while (0)

void arm64_block_stats_count_chained_entry(struct fiber_block *from, unsigned long to_code) {
    if (!arm64_block_stats_enabled || from == NULL)
        return;

    struct fiber_block *to = (struct fiber_block *)((char *)to_code - offsetof(struct fiber_block, code));
    atomic_fetch_add_explicit(&arm64_block_stats_chain_entries, 1, memory_order_relaxed);
    if (PAGE(from->addr) == PAGE(to->addr))
        atomic_fetch_add_explicit(&arm64_block_stats_chain_entry_same_page, 1, memory_order_relaxed);
    else
        atomic_fetch_add_explicit(&arm64_block_stats_chain_entry_cross_page, 1, memory_order_relaxed);

    bool matched_slot = false;
    for (int i = 0; i <= 1; i++) {
        if (from->jump_ip[i] != NULL && *from->jump_ip[i] == to_code) {
            if (i == 0)
                atomic_fetch_add_explicit(&arm64_block_stats_chain_entry_slot0, 1, memory_order_relaxed);
            else
                atomic_fetch_add_explicit(&arm64_block_stats_chain_entry_slot1, 1, memory_order_relaxed);
            matched_slot = true;
        }
    }
    if (!matched_slot)
        atomic_fetch_add_explicit(&arm64_block_stats_chain_entry_unknown_slot, 1, memory_order_relaxed);
}
#else
#define ARM64_BLOCK_STAT_INC(counter) do {} while (0)
#define ARM64_BLOCK_STAT_ADD(counter, value) do {} while (0)
#endif

// Stubs / debug hooks referenced from assembly/gen.c/tlb.c
// High-bit tracing is an opt-in diagnostic. It is useful when chasing W/X
// register-extension bugs, but it is not a valid invariant for normal AArch64
// execution: the dynamic linker and language runtimes legitimately keep tagged
// and maskable 64-bit values in general-purpose registers.
volatile bool g_trace_highbits = false;
volatile addr_t g_watch_page_val = 0;

#define TRACE_PC_MAX 16
volatile bool g_trace_guest_pc = false;
static addr_t g_trace_pc_vals[TRACE_PC_MAX];
static addr_t g_trace_pc_masks[TRACE_PC_MAX];
static int g_trace_pc_count = 0;

static bool g_trace_gate_enabled = false;
static addr_t g_trace_gate_pc = 0;
static addr_t g_trace_gate_mask = ~(addr_t) 0;
static bool g_trace_gate_x4_enabled = false;
static uint64_t g_trace_gate_x4 = 0;
static int g_trace_gate_budget = 0; // 0 = unlimited after first gate hit

static __thread bool t_trace_gate_open = false;
static __thread int t_trace_gate_left = 0;

bool asbestos_should_trace_guest_pc(addr_t pc) {
    if (!g_trace_guest_pc)
        return false;
    for (int i = 0; i < g_trace_pc_count; i++) {
        if ((pc & g_trace_pc_masks[i]) == (g_trace_pc_vals[i] & g_trace_pc_masks[i]))
            return true;
    }
    return false;
}

void asbestos_set_trace_pcs(const char *spec) {
    g_trace_guest_pc = false;
    g_trace_pc_count = 0;
    if (spec == NULL || spec[0] == '\0')
        return;

    char *copy = strdup(spec);
    if (copy == NULL)
        return;

    for (char *tok = strtok(copy, ", "); tok != NULL; tok = strtok(NULL, ", ")) {
        if (*tok == '\0' || g_trace_pc_count >= TRACE_PC_MAX)
            continue;

        char *slash = strchr(tok, '/');
        addr_t value = 0;
        addr_t mask = ~(addr_t) 0;

        if (slash != NULL) {
            *slash = '\0';
            value = (addr_t) strtoull(tok, NULL, 0);
            mask = (addr_t) strtoull(slash + 1, NULL, 0);
        } else {
            value = (addr_t) strtoull(tok, NULL, 0);
            // Convenience: small values are treated as guest-offset matchers
            // (e.g., 0x170aec matches pc&0xffffff).
            if (value <= 0xffffff)
                mask = 0xffffff;
        }

        g_trace_pc_vals[g_trace_pc_count] = value;
        g_trace_pc_masks[g_trace_pc_count] = mask;
        g_trace_pc_count++;
    }

    free(copy);
    g_trace_guest_pc = g_trace_pc_count > 0;
    if (g_trace_guest_pc) {
        fprintf(stderr, "TRACEPC enabled (%d matchers) via ISH_TRACE_PCS\n", g_trace_pc_count);
    }
}

void asbestos_set_trace_gate(const char *pc_spec, const char *x4_spec, const char *budget_spec) {
    g_trace_gate_enabled = false;
    g_trace_gate_pc = 0;
    g_trace_gate_mask = ~(addr_t) 0;
    g_trace_gate_x4_enabled = false;
    g_trace_gate_x4 = 0;
    g_trace_gate_budget = 0;
    t_trace_gate_open = false;
    t_trace_gate_left = 0;

    if (pc_spec == NULL || pc_spec[0] == '\0')
        return;

    char *copy = strdup(pc_spec);
    if (copy == NULL)
        return;

    char *slash = strchr(copy, '/');
    if (slash != NULL) {
        *slash = '\0';
        g_trace_gate_pc = (addr_t) strtoull(copy, NULL, 0);
        g_trace_gate_mask = (addr_t) strtoull(slash + 1, NULL, 0);
    } else {
        g_trace_gate_pc = (addr_t) strtoull(copy, NULL, 0);
        if (g_trace_gate_pc <= 0xffffff)
            g_trace_gate_mask = 0xffffff;
    }
    free(copy);

    if (x4_spec != NULL && x4_spec[0] != '\0') {
        g_trace_gate_x4 = strtoull(x4_spec, NULL, 0);
        g_trace_gate_x4_enabled = true;
    }

    if (budget_spec != NULL && budget_spec[0] != '\0') {
        long budget = strtol(budget_spec, NULL, 0);
        if (budget > 0)
            g_trace_gate_budget = (int) budget;
    }

    g_trace_gate_enabled = true;
    fprintf(stderr, "TRACEGATE enabled pc=%#llx/%#llx",
            (unsigned long long) g_trace_gate_pc,
            (unsigned long long) g_trace_gate_mask);
    if (g_trace_gate_x4_enabled)
        fprintf(stderr, " x4=%#llx", (unsigned long long) g_trace_gate_x4);
    if (g_trace_gate_budget > 0)
        fprintf(stderr, " budget=%d", g_trace_gate_budget);
    fputc('\n', stderr);
}

static bool trace_gate_allow(struct cpu_state *cpu) {
    if (!g_trace_gate_enabled)
        return true;

    if (t_trace_gate_open && g_trace_gate_budget > 0 && t_trace_gate_left == 0)
        t_trace_gate_open = false;

    if (!t_trace_gate_open) {
        if ((cpu->pc & g_trace_gate_mask) != (g_trace_gate_pc & g_trace_gate_mask))
            return false;
        if (g_trace_gate_x4_enabled && cpu->x4 != g_trace_gate_x4)
            return false;

        t_trace_gate_open = true;
        t_trace_gate_left = g_trace_gate_budget;
        fprintf(stderr, "TRACEGATE open pc=%#llx x4=%#llx\n",
                (unsigned long long) cpu->pc,
                (unsigned long long) cpu->x4);
    }

    if (g_trace_gate_budget > 0 && t_trace_gate_left > 0)
        t_trace_gate_left--;

    return true;
}

static bool trace_read_u64(struct cpu_state *cpu, addr_t addr, uint64_t *out) {
    struct mem *mem = container_of(cpu->mmu, struct mem, mmu);
    void *ptr = mem_ptr(mem, addr, MEM_READ);
    if (ptr == NULL)
        return false;
    memcpy(out, ptr, sizeof(*out));
    return true;
}

static bool trace_read_u32(struct cpu_state *cpu, addr_t addr, uint32_t *out) {
    struct mem *mem = container_of(cpu->mmu, struct mem, mmu);
    void *ptr = mem_ptr(mem, addr, MEM_READ);
    if (ptr == NULL)
        return false;
    memcpy(out, ptr, sizeof(*out));
    return true;
}

static void trace_dump_obj(struct cpu_state *cpu, const char *name, addr_t addr) {
    uint64_t q0 = 0, q1 = 0, q2 = 0, q3 = 0;
    bool ok0 = trace_read_u64(cpu, addr + 0, &q0);
    bool ok1 = trace_read_u64(cpu, addr + 8, &q1);
    bool ok2 = trace_read_u64(cpu, addr + 16, &q2);
    bool ok3 = trace_read_u64(cpu, addr + 24, &q3);
    fprintf(stderr, "TRACEOBJ %s=%#llx +0=%s%#llx +8=%s%#llx +16=%s%#llx +24=%s%#llx\n",
            name,
            (unsigned long long) addr,
            ok0 ? "" : "!", (unsigned long long) q0,
            ok1 ? "" : "!", (unsigned long long) q1,
            ok2 ? "" : "!", (unsigned long long) q2,
            ok3 ? "" : "!", (unsigned long long) q3);
}

void jit_trace_regs(struct cpu_state *cpu) {
    if (!trace_gate_allow(cpu))
        return;

    fprintf(stderr,
            "TRACEPC pc=%#llx x0=%#llx x1=%#llx x2=%#llx x3=%#llx x4=%#llx x5=%#llx x19=%#llx x20=%#llx x21=%#llx x22=%#llx x23=%#llx x24=%#llx x25=%#llx x26=%#llx x27=%#llx x30=%#llx\n",
            (unsigned long long) cpu->pc,
            (unsigned long long) cpu->x0,
            (unsigned long long) cpu->x1,
            (unsigned long long) cpu->x2,
            (unsigned long long) cpu->x3,
            (unsigned long long) cpu->x4,
            (unsigned long long) cpu->x5,
            (unsigned long long) cpu->x19,
            (unsigned long long) cpu->x20,
            (unsigned long long) cpu->x21,
            (unsigned long long) cpu->x22,
            (unsigned long long) cpu->x23,
            (unsigned long long) cpu->x24,
            (unsigned long long) cpu->x25,
            (unsigned long long) cpu->x26,
            (unsigned long long) cpu->x27,
            (unsigned long long) cpu->x30);

    // HotSpot replay triage around libjvm+0x170aec path: dump key objects.
    addr_t off = cpu->pc & 0xffffff;
    if (off == 0x170aec || off == 0x170b50 || off == 0x170b58 ||
            off == 0x170b64 || off == 0x170b70 || off == 0x170b74 ||
            off == 0xe5aaec || off == 0xe5ab50 || off == 0xe5ab58 ||
            off == 0xe5ab64 || off == 0xe5ab70 || off == 0xe5ab74) {
        trace_dump_obj(cpu, "x19", cpu->x19);
        trace_dump_obj(cpu, "x20", cpu->x20);
        trace_dump_obj(cpu, "x1", cpu->x1);
        trace_dump_obj(cpu, "x0", cpu->x0);
    }

    // Replay triage around the libjvm+0x80334c crash sequence (absolute low24
    // around 0x4ed2xx/0x4ed3xx for this mmap layout): inspect the x26 object
    // and the just-loaded x0 pointer chain.
    if (off == 0x24f580 || off == 0x250400 || off == 0x250464 ||
            off == 0x2504b0 || off == 0x2504fc || off == 0x250550 ||
            off == 0x250564 || off == 0x25057c || off == 0x4ebad4 ||
            off == 0x4ed15c || off == 0x4ed220 || off == 0x4ed230 ||
            off == 0x4ed250 || off == 0x4ed344 || off == 0x4ed348) {
        trace_dump_obj(cpu, "x24", cpu->x24);
        trace_dump_obj(cpu, "x26", cpu->x26);
        trace_dump_obj(cpu, "x0", cpu->x0);
        if (off == 0x250400 || off == 0x250464 || off == 0x2504b0 ||
                off == 0x2504fc || off == 0x250550 || off == 0x250564 ||
                off == 0x25057c) {
            uint32_t idx1 = 0, idx19 = 0, idx20 = 0, idx22 = 0;
            bool ok_idx1 = trace_read_u32(cpu, cpu->x1 + 40, &idx1);
            bool ok_idx19 = trace_read_u32(cpu, cpu->x19 + 40, &idx19);
            bool ok_idx20 = trace_read_u32(cpu, cpu->x20 + 40, &idx20);
            bool ok_idx22 = trace_read_u32(cpu, cpu->x22 + 40, &idx22);
            fprintf(stderr,
                    "TRACE566400 pc=%#llx x0=%#llx x1=%#llx(+40=%s%u) x19=%#llx(+40=%s%u) x20=%#llx(+40=%s%u) x22=%#llx(+40=%s%u) x2=%#llx x3=%#llx x4=%#llx\n",
                    (unsigned long long) cpu->pc,
                    (unsigned long long) cpu->x0,
                    (unsigned long long) cpu->x1, ok_idx1 ? "" : "!", ok_idx1 ? idx1 : 0,
                    (unsigned long long) cpu->x19, ok_idx19 ? "" : "!", ok_idx19 ? idx19 : 0,
                    (unsigned long long) cpu->x20, ok_idx20 ? "" : "!", ok_idx20 ? idx20 : 0,
                    (unsigned long long) cpu->x22, ok_idx22 ? "" : "!", ok_idx22 ? idx22 : 0,
                    (unsigned long long) cpu->x2,
                    (unsigned long long) cpu->x3,
                    (unsigned long long) cpu->x4);
            trace_dump_obj(cpu, "f566400_x1", cpu->x1);
            trace_dump_obj(cpu, "f566400_x19", cpu->x19);
            trace_dump_obj(cpu, "f566400_x20", cpu->x20);
            trace_dump_obj(cpu, "f566400_x22", cpu->x22);
        }

        if (off == 0x24f580) {
            uint32_t idx1 = 0, idx3 = 0;
            bool ok_idx1 = trace_read_u32(cpu, cpu->x1 + 40, &idx1);
            bool ok_idx3 = trace_read_u32(cpu, cpu->x3 + 40, &idx3);
            fprintf(stderr,
                    "TRACE565580 x1=%#llx +40=%s%u x3=%#llx +40=%s%u x4=%#llx\n",
                    (unsigned long long) cpu->x1,
                    ok_idx1 ? "" : "!", ok_idx1 ? idx1 : 0,
                    (unsigned long long) cpu->x3,
                    ok_idx3 ? "" : "!", ok_idx3 ? idx3 : 0,
                    (unsigned long long) cpu->x4);
            trace_dump_obj(cpu, "f565580_x1", cpu->x1);
            trace_dump_obj(cpu, "f565580_x3", cpu->x3);
        }

        if (off == 0x4ebad4) {
            uint32_t in_idx40 = 0;
            bool ok_in_idx40 = trace_read_u32(cpu, cpu->x1 + 40, &in_idx40);
            fprintf(stderr, "TRACECALL x1=%#llx +40=%s%u\n",
                    (unsigned long long) cpu->x1,
                    ok_in_idx40 ? "" : "!",
                    ok_in_idx40 ? in_idx40 : 0);
            trace_dump_obj(cpu, "call_x1", cpu->x1);
        }

        if (off == 0x4ed15c) {
            uint32_t idx40 = 0;
            bool ok_idx40 = trace_read_u32(cpu, cpu->x0 + 40, &idx40);
            fprintf(stderr, "TRACERET x0=%#llx +40=%s%u\n",
                    (unsigned long long) cpu->x0,
                    ok_idx40 ? "" : "!",
                    ok_idx40 ? idx40 : 0);
        }

        if (off == 0x4ed220) {
            uint64_t t0 = 0, t1 = 0, t2 = 0;
            bool ok0 = trace_read_u64(cpu, cpu->x0 + 0, &t0);
            bool ok1 = trace_read_u64(cpu, cpu->x0 + 8, &t1);
            bool ok2 = trace_read_u64(cpu, cpu->x0 + 16, &t2);
            fprintf(stderr,
                    "TRACEARR x0=%#llx [0]=%s%#llx [1]=%s%#llx [2]=%s%#llx\n",
                    (unsigned long long) cpu->x0,
                    ok0 ? "" : "!", (unsigned long long) t0,
                    ok1 ? "" : "!", (unsigned long long) t1,
                    ok2 ? "" : "!", (unsigned long long) t2);
            if (ok0 && t0 != 0)
                trace_dump_obj(cpu, "arr0", (addr_t) t0);
            if (ok1 && t1 != 0)
                trace_dump_obj(cpu, "arr1", (addr_t) t1);
            if (ok2 && t2 != 0)
                trace_dump_obj(cpu, "arr2", (addr_t) t2);
        }
    }

    // Hash-slot replay triage around libjvm+0x34710c..+0x3471ec.
    if (off == 0x3110c || off == 0x311e4 || off == 0x311e8 || off == 0x311ec) {
        uint64_t slot_key = 0, table_ptr = 0;
        uint32_t slot_index = 0;
        bool ok_key = trace_read_u64(cpu, cpu->x5 + 928, &slot_key);
        bool ok_idx = trace_read_u32(cpu, cpu->x5 + 936, &slot_index);
        bool ok_tab = trace_read_u64(cpu, cpu->x0 + 912, &table_ptr);
        fprintf(stderr,
                "TRACESLOT pc=%#llx x0=%#llx x1=%#llx x5=%#llx slot_key=%s%#llx slot_idx=%s%u table=%s%#llx\n",
                (unsigned long long) cpu->pc,
                (unsigned long long) cpu->x0,
                (unsigned long long) cpu->x1,
                (unsigned long long) cpu->x5,
                ok_key ? "" : "!", (unsigned long long) slot_key,
                ok_idx ? "" : "!", ok_idx ? slot_index : 0,
                ok_tab ? "" : "!", (unsigned long long) table_ptr);
        if (ok_tab && table_ptr != 0) {
            uint64_t e0 = 0, e1 = 0, e2 = 0;
            bool ok_e0 = trace_read_u64(cpu, table_ptr + 0, &e0);
            bool ok_e1 = trace_read_u64(cpu, table_ptr + 8, &e1);
            bool ok_e2 = trace_read_u64(cpu, table_ptr + 16, &e2);
            fprintf(stderr,
                    "TRACESLOT entries base=%#llx [0]=%s%#llx [1]=%s%#llx [2]=%s%#llx\n",
                    (unsigned long long) table_ptr,
                    ok_e0 ? "" : "!", (unsigned long long) e0,
                    ok_e1 ? "" : "!", (unsigned long long) e1,
                    ok_e2 ? "" : "!", (unsigned long long) e2);
            if (ok_e0 && e0 != 0)
                trace_dump_obj(cpu, "slot_e0", (addr_t) e0);
            if (ok_e1 && e1 != 0)
                trace_dump_obj(cpu, "slot_e1", (addr_t) e1);
            if (ok_e2 && e2 != 0)
                trace_dump_obj(cpu, "slot_e2", (addr_t) e2);
        }
    }
}
void c_watch_write_hit(addr_t addr, const char *caller) { (void)addr; (void)caller; }
void jit_watch_write_hit(struct cpu_state *cpu, addr_t store_addr, unsigned long *code_ptr) {
    (void)cpu; (void)store_addr; (void)code_ptr;
}
void jit_highbit_alert(struct cpu_state *cpu) {
    static int reported = 0;
    if (reported++)
        return;
    fprintf(stderr, "HIGHBITS pc=%#llx sp=%#llx\n",
            (unsigned long long)cpu->pc,
            (unsigned long long)cpu->sp);
    for (int i = 0; i < 31; i++) {
        if ((cpu->regs[i] >> 32) != 0) {
            fprintf(stderr, "  x%d=%#llx\n", i, (unsigned long long)cpu->regs[i]);
        }
    }
}

static void fiber_block_disconnect(struct asbestos *asbestos, struct fiber_block *block);
static void fiber_block_free(struct asbestos *asbestos, struct fiber_block *block);
static void fiber_free_jetsam(struct asbestos *asbestos);
static void fiber_resize_hash(struct asbestos *asbestos, size_t new_size);
static inline size_t fiber_block_hash(addr_t addr, size_t hash_size);

struct asbestos *asbestos_new(struct mmu *mmu) {
    struct asbestos *asbestos = calloc(1, sizeof(struct asbestos));
    asbestos->mmu = mmu;
    fiber_resize_hash(asbestos, FIBER_INITIAL_HASH_SIZE);
    asbestos->page_hash = calloc(FIBER_PAGE_HASH_SIZE, sizeof(*asbestos->page_hash));
    list_init(&asbestos->jetsam);
    lock_init(&asbestos->lock);
    wrlock_init(&asbestos->jetsam_lock);
    atomic_init(&asbestos->invalidate_gen, 0);
    atomic_init(&asbestos->jit_active_threads, 0);
    atomic_init(&asbestos->jetsam_gen, 0);
    return asbestos;
}

void asbestos_free(struct asbestos *asbestos) {
    for (size_t i = 0; i < asbestos->hash_size; i++) {
        struct fiber_block *block, *tmp;
        if (list_null(&asbestos->hash[i]))
            continue;
        list_for_each_entry_safe(&asbestos->hash[i], block, tmp, chain) {
            fiber_block_free(asbestos, block);
        }
    }
    fiber_free_jetsam(asbestos);
    free(asbestos->page_hash);
    free(asbestos->hash);
    free(asbestos);
}

static inline struct list *blocks_list(struct asbestos *asbestos, page_t page, int i) {
    // TODO is this a good hash function?
    return &asbestos->page_hash[page % FIBER_PAGE_HASH_SIZE].blocks[i];
}

void asbestos_invalidate_range(struct asbestos *absestos, page_t start, page_t end) {
    // [T-ish-mm-double-destroy-crash] Under CLONE_VM exit_group races the
    // second cleanup path may run pt_unmap_always after asbestos has already
    // been freed and nulled (see mem_destroy). Treat as no-op — the freed
    // asbestos had already been invalidated by the winning cleanup.
    if (absestos == NULL) return;
    lock(&absestos->lock);
    bool did_invalidate = false;
    struct fiber_block *block, *tmp;
    for (page_t page = start; page < end; page++) {
        for (int i = 0; i <= 1; i++) {
            struct list *blocks = blocks_list(absestos, page, i);
            if (list_null(blocks))
                continue;
            list_for_each_entry_safe(blocks, block, tmp, page[i]) {
                fiber_block_disconnect(absestos, block);
                block->is_jetsam = true;
                list_add(&absestos->jetsam, &block->jetsam);
                did_invalidate = true;
            }
        }
    }
    if (did_invalidate)
        atomic_fetch_add_explicit(&absestos->invalidate_gen, 1, memory_order_release);
    unlock(&absestos->lock);
}

void asbestos_invalidate_page(struct asbestos *asbestos, page_t page) {
    // [T-ish-mm-double-destroy-crash] See asbestos_invalidate_range —
    // a racing exit_group cleanup can reach this after asbestos was freed.
    if (asbestos == NULL) return;
    // Fast path: skip lock if no blocks exist on this page.
    // page_hash is only modified under asbestos->lock, and list_null is a
    // single pointer read, so a racy false-negative just means we take
    // the slow path unnecessarily (safe). A false-positive is impossible
    // because blocks are always added before being linked into page_hash.
    for (int i = 0; i <= 1; i++) {
        struct list *blocks = blocks_list(asbestos, page, i);
        if (!list_null(blocks))
            goto slow_path;
    }
    return;
slow_path:
    asbestos_invalidate_range(asbestos, page, page + 1);
}
void asbestos_invalidate_all(struct asbestos *asbestos) {
    // [T-ish-mm-double-destroy-crash] Safe no-op after cleanup race.
    if (asbestos == NULL) return;
    lock(&asbestos->lock);
    bool did_invalidate = false;
    struct fiber_block *block, *tmp;
    for (size_t bucket = 0; bucket < FIBER_PAGE_HASH_SIZE; bucket++) {
        for (int i = 0; i <= 1; i++) {
            struct list *blocks = &asbestos->page_hash[bucket].blocks[i];
            if (list_null(blocks))
                continue;
            list_for_each_entry_safe(blocks, block, tmp, page[i]) {
                fiber_block_disconnect(asbestos, block);
                block->is_jetsam = true;
                list_add(&asbestos->jetsam, &block->jetsam);
                did_invalidate = true;
            }
        }
    }
    if (did_invalidate)
        atomic_fetch_add_explicit(&asbestos->invalidate_gen, 1, memory_order_release);
    unlock(&asbestos->lock);
}

static struct fiber_block *fiber_lookup(struct asbestos *asbestos, addr_t addr);
#ifdef GUEST_ARM64
static void fiber_prechain_same_page(struct asbestos *asbestos, struct fiber_block *block);
#endif

static void fiber_resize_hash(struct asbestos *asbestos, size_t new_size) {
    TRACE_(verbose, "%d resizing hash to %lu, using %lu bytes for gadgets\n", current_pid(), new_size, asbestos->mem_used);
    struct list *new_hash = calloc(new_size, sizeof(struct list));
    for (size_t i = 0; i < asbestos->hash_size; i++) {
        if (list_null(&asbestos->hash[i]))
            continue;
        struct fiber_block *block, *tmp;
        list_for_each_entry_safe(&asbestos->hash[i], block, tmp, chain) {
            list_remove(&block->chain);
            list_init_add(&new_hash[fiber_block_hash(block->addr, new_size)], &block->chain);
        }
    }
    free(asbestos->hash);
    asbestos->hash = new_hash;
    asbestos->hash_size = new_size;
}

static void fiber_insert(struct asbestos *asbestos, struct fiber_block *block) {
    asbestos->mem_used += block->used;
    asbestos->num_blocks++;
    // target an average hash chain length of 1-2
    if (asbestos->num_blocks >= asbestos->hash_size * 2)
        fiber_resize_hash(asbestos, asbestos->hash_size * 2);

    list_init_add(&asbestos->hash[fiber_block_hash(block->addr, asbestos->hash_size)], &block->chain);
    list_init_add(blocks_list(asbestos, PAGE(block->addr), 0), &block->page[0]);
    if (PAGE(block->addr) != PAGE(block->end_addr))
        list_init_add(blocks_list(asbestos, PAGE(block->end_addr), 1), &block->page[1]);
#ifdef GUEST_ARM64
    if (arm64_eager_prechain_enabled)
        fiber_prechain_same_page(asbestos, block);
#endif
}

static struct fiber_block *fiber_lookup(struct asbestos *asbestos, addr_t addr) {
    struct list *bucket = &asbestos->hash[fiber_block_hash(addr, asbestos->hash_size)];
    if (list_null(bucket))
        return NULL;
    struct fiber_block *block;
    list_for_each_entry(bucket, block, chain) {
        if (block->addr == addr)
            return block;
    }
    return NULL;
}

#ifdef GUEST_ARM64
#define ARM64_FAKE_IP_MASK UINT64_C(0x0000ffffffffffff)
#define ARM64_FAKE_IP_TAG (UINT64_C(1) << 63)
#define ARM64_EAGER_PRECHAIN_INCOMING_SCAN_LIMIT 2

static bool arm64_fake_jump_target(unsigned long jump_ip, addr_t *target_addr) {
    if ((jump_ip & ARM64_FAKE_IP_TAG) == 0)
        return false;
    *target_addr = (addr_t)(jump_ip & ARM64_FAKE_IP_MASK);
    return true;
}

static bool fiber_prechain_patch_slot(struct fiber_block *source, int i, struct fiber_block *target) {
    if (source->jump_ip[i] == NULL || !source->jump_ip_is_fake[i] ||
            source->is_jetsam || target->is_jetsam)
        return false;
    addr_t target_addr;
    if (!arm64_fake_jump_target(*source->jump_ip[i], &target_addr))
        return false;
    if (target_addr != target->addr || PAGE(source->addr) != PAGE(target->addr))
        return false;
    *source->jump_ip[i] = (unsigned long) target->code;
    source->jump_ip_is_fake[i] = false;
    list_add(&target->jumps_from[i], &source->jumps_from_links[i]);
    return true;
}

static void fiber_prechain_outgoing_same_page(struct asbestos *asbestos, struct fiber_block *block) {
    // Patch newly inserted same-page outgoing edges to already-compiled
    // whole-block starts. This deliberately writes only block->code pointers
    // into existing jump_ip slots; it does not create interior targets.
    for (int i = 0; i <= 1; i++) {
        if (block->jump_ip[i] == NULL)
            continue;
        addr_t target_addr;
        if (!arm64_fake_jump_target(*block->jump_ip[i], &target_addr))
            continue;
        if (PAGE(block->addr) != PAGE(target_addr))
            continue;
        ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_attempts);
        ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_outgoing_attempts);
        struct fiber_block *target = fiber_lookup(asbestos, target_addr);
        if (target == NULL)
            continue;
        if (fiber_prechain_patch_slot(block, i, target)) {
            ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_patches);
            ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_outgoing_patches);
        }
    }
}

static void fiber_prechain_incoming_same_page(struct asbestos *asbestos, struct fiber_block *block) {
    // Patch existing same-page source blocks that were compiled before this
    // target. Keep the scan bounded to avoid O(blocks-per-page^2) compile-time
    // behavior on dense code pages; the newest blocks are at the list head and
    // are the most likely direct predecessors. Only still-fake slots are
    // considered, so each source link is owned by at most one target list.
    // Unlike outgoing prechain, this mutates older blocks that another guest
    // thread may already be executing. Keep the opt-in path single-threaded.
    if (__atomic_load_n(&asbestos->active_threads, __ATOMIC_RELAXED) > 1)
        return;
    struct list *sources = blocks_list(asbestos, PAGE(block->addr), 0);
    if (list_null(sources))
        return;
    struct fiber_block *source;
    unsigned scanned = 0;
    list_for_each_entry(sources, source, page[0]) {
        if (source == block)
            continue;
        if (scanned++ >= ARM64_EAGER_PRECHAIN_INCOMING_SCAN_LIMIT)
            break;
        for (int i = 0; i <= 1; i++) {
            if (source->jump_ip[i] == NULL)
                continue;
            addr_t target_addr;
            if (!arm64_fake_jump_target(*source->jump_ip[i], &target_addr))
                continue;
            if (target_addr != block->addr)
                continue;
            ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_attempts);
            ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_incoming_attempts);
            if (fiber_prechain_patch_slot(source, i, block)) {
                ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_patches);
                ARM64_BLOCK_STAT_INC(arm64_block_stats_prechain_incoming_patches);
            }
        }
    }
}

static void fiber_prechain_same_page(struct asbestos *asbestos, struct fiber_block *block) {
    fiber_prechain_outgoing_same_page(asbestos, block);
    if (arm64_eager_prechain_incoming_enabled)
        fiber_prechain_incoming_same_page(asbestos, block);
}
#endif

static struct fiber_block *fiber_block_compile(addr_t ip, struct tlb *tlb) {
    struct gen_state state;
    TRACE("%d %08x --- compiling:\n", current_pid(), ip);
    gen_start(ip, &state);
    while (true) {
        if (!gen_step(&state, tlb))
            break;
        // no block should span more than 2 pages
        // guarantee this by limiting total block size to 1 page
        // TODO refuse to decode implausibly long gadget streams
#ifdef GUEST_ARM64
        if (state.internal_continue_segment_budget != 0 &&
                state.ip - state.internal_continue_segment_start >=
                    state.internal_continue_segment_budget * 4) {
            gen_exit(&state);
            break;
        }
#endif
        if (state.ip - ip >= PAGE_SIZE - 15) {
            gen_exit(&state);
            break;
        }
    }
    gen_end(&state);
    assert(state.ip - ip <= PAGE_SIZE);
#ifdef GUEST_ARM64
    ARM64_BLOCK_STAT_INC(arm64_block_stats_compiled);
    ARM64_BLOCK_STAT_ADD(arm64_block_stats_code_words, state.size);
    ARM64_BLOCK_STAT_ADD(arm64_block_stats_guest_bytes, state.ip - ip);
    if (state.jump_ip[0] != 0)
        ARM64_BLOCK_STAT_INC(arm64_block_stats_jump0);
    if (state.jump_ip[1] != 0)
        ARM64_BLOCK_STAT_INC(arm64_block_stats_jump1);
#endif
    state.block->used = state.capacity;
    return state.block;
}

// Remove all pointers to the block. It can't be freed yet because another
// thread may be executing it.
static void fiber_block_disconnect(struct asbestos *asbestos, struct fiber_block *block) {
    if (asbestos != NULL) {
        asbestos->mem_used -= block->used;
        asbestos->num_blocks--;
    }
    list_remove(&block->chain);
    for (int i = 0; i <= 1; i++) {
        list_remove_safe(&block->page[i]);
        if (!list_null(&block->jumps_from_links[i])) {
            if (block->jump_ip[i] != NULL) {
                *block->jump_ip[i] = block->old_jump_ip[i];
#ifdef GUEST_ARM64
                block->jump_ip_is_fake[i] = true;
#endif
            }
            list_remove(&block->jumps_from_links[i]);
        }

        struct fiber_block *prev_block, *tmp;
        list_for_each_entry_safe(&block->jumps_from[i], prev_block, tmp, jumps_from_links[i]) {
            if (prev_block->jump_ip[i] != NULL) {
                *prev_block->jump_ip[i] = prev_block->old_jump_ip[i];
#ifdef GUEST_ARM64
                prev_block->jump_ip_is_fake[i] = true;
#endif
            }
            list_remove(&prev_block->jumps_from_links[i]);
        }
    }
}

static void fiber_block_free(struct asbestos *asbestos, struct fiber_block *block) {
    fiber_block_disconnect(asbestos, block);
    free(block);
}

static void fiber_free_jetsam(struct asbestos *asbestos) {
    struct fiber_block *block, *tmp;
    list_for_each_entry_safe(&asbestos->jetsam, block, tmp, jetsam) {
        list_remove(&block->jetsam);
        free(block);
    }
}

int fiber_enter(struct fiber_block *block, struct fiber_frame *frame, struct tlb *tlb);
static int cpu_single_step(struct cpu_state *cpu, struct tlb *tlb);

static inline size_t fiber_cache_hash(addr_t ip) {
    return (ip ^ (ip >> 12)) & (FIBER_CACHE_SIZE - 1);
}

static inline unsigned asbestos_invalidate_gen_load(struct asbestos *asbestos) {
    return atomic_load_explicit(&asbestos->invalidate_gen, memory_order_acquire);
}

static int cpu_step_to_interrupt(struct cpu_state *cpu, struct tlb *tlb) {
    struct asbestos *asbestos = cpu->mmu->asbestos;

    // Hold jetsam_lock read during JIT execution.
    // This prevents jetsam cleanup from freeing blocks while we're executing them.
    read_wrlock(&asbestos->jetsam_lock);

    // Use persistent block cache and frame from TLB; invalidate when blocks are jetsam'd.
    unsigned invalidate_gen = asbestos_invalidate_gen_load(asbestos);
    bool caches_stale = (tlb->block_cache_gen != invalidate_gen);
    struct fiber_block **cache = tlb->block_cache;
    if (caches_stale) {
        memset(cache, 0, sizeof(tlb->block_cache));
        tlb->block_cache_gen = invalidate_gen;
    }

    // Use persistent frame from TLB (avoids malloc/free + ret_cache zeroing)
    struct fiber_frame *frame = tlb->frame;
    if (frame == NULL) {
        frame = calloc(1, sizeof(struct fiber_frame));
        tlb->frame = frame;
    } else if (caches_stale) {
        // ret_cache holds pointers into block->code; must clear on invalidation
        memset(frame->ret_cache, 0, sizeof(frame->ret_cache));
    }
    frame->last_block = NULL;
    frame->cpu = *cpu;
    assert(asbestos->mmu == cpu->mmu);

    int interrupt = INT_NONE;
    int crash_retry_count = 0;
    while (interrupt == INT_NONE) {
        // Check if blocks were invalidated since last check (e.g. CoW by another thread).
        // This must be inside the loop, not just at function entry, because invalidation
        // can happen while we're in the JIT cycle (between fiber_enter calls).
        invalidate_gen = asbestos_invalidate_gen_load(asbestos);
        if (tlb->block_cache_gen != invalidate_gen) {
            memset(cache, 0, sizeof(tlb->block_cache));
            tlb->block_cache_gen = invalidate_gen;
            memset(frame->ret_cache, 0, sizeof(frame->ret_cache));
            // Any last_block pointer may now refer to a jetsam'd/stale fiber.
            // Drop it whenever invalidate_gen changes, just like other cache
            // invalidation paths below.
            frame->last_block = NULL;
        }

        addr_t ip = CPU_IP(&frame->cpu);
        // Guard: null guest PC means corrupted state (e.g., branch to unmapped
        // address 0). Return INT_GPF instead of trying to compile/execute.
        if (ip == 0) {
            frame->cpu.segfault_addr = 0;
            interrupt = INT_GPF;
            break;
        }

        // Optional tracepoint at block entry. This complements per-instruction
        // trace gadgets and helps when a targeted PC only appears as a block
        // entry (or when the matching instruction exits the block).
        if (asbestos_should_trace_guest_pc(ip))
            jit_trace_regs(&frame->cpu);
        size_t cache_index = fiber_cache_hash(ip);
        struct fiber_block *block = cache[cache_index];
        ARM64_BLOCK_STAT_INC(arm64_block_stats_entries);
        if (block == NULL || block->addr != ip) {
            ARM64_BLOCK_STAT_INC(arm64_block_stats_cache_misses);
            lock(&asbestos->lock);
            block = fiber_lookup(asbestos, ip);
            if (block == NULL) {
                block = fiber_block_compile(ip, tlb);
                fiber_insert(asbestos, block);
            } else {
                TRACE("%d %08x --- missed cache\n", current_pid(), ip);
            }
            cache[cache_index] = block;
            unlock(&asbestos->lock);
        } else {
            ARM64_BLOCK_STAT_INC(arm64_block_stats_cache_hits);
        }
        struct fiber_block *last_block = frame->last_block;
        if (last_block != NULL &&
                !last_block->is_jetsam && !block->is_jetsam &&
#ifdef GUEST_ARM64
                (last_block->jump_ip_is_fake[0] ||
                 last_block->jump_ip_is_fake[1])
#else
                (last_block->jump_ip[0] != NULL ||
                 last_block->jump_ip[1] != NULL)
#endif
                ) {
            ARM64_BLOCK_STAT_INC(arm64_block_stats_chain_attempts);
            if (trylock(&asbestos->lock) == 0) {
                // can't mint new pointers to a block that has been marked jetsam
                // and is thus assumed to have no pointers left
                if (!last_block->is_jetsam && !block->is_jetsam) {
                    for (int i = 0; i <= 1; i++) {
                        if (last_block->jump_ip[i] == NULL)
                            continue;
#ifdef GUEST_ARM64
                        if (!last_block->jump_ip_is_fake[i])
                            continue;
                        addr_t target_addr;
                        if (!arm64_fake_jump_target(*last_block->jump_ip[i], &target_addr) ||
                                target_addr != block->addr)
                            continue;
#else
                        if ((*last_block->jump_ip[i] & 0xffffffff) != block->addr)
                            continue;
#endif
                        *last_block->jump_ip[i] = (unsigned long) block->code;
#ifdef GUEST_ARM64
                        last_block->jump_ip_is_fake[i] = false;
#endif
                        ARM64_BLOCK_STAT_INC(arm64_block_stats_chain_patches);
                        if (i == 0)
                            ARM64_BLOCK_STAT_INC(arm64_block_stats_chain_patch_slot0);
                        else
                            ARM64_BLOCK_STAT_INC(arm64_block_stats_chain_patch_slot1);
                        if (PAGE(last_block->addr) == PAGE(block->addr))
                            ARM64_BLOCK_STAT_INC(arm64_block_stats_chain_patch_same_page);
                        else
                            ARM64_BLOCK_STAT_INC(arm64_block_stats_chain_patch_cross_page);
                        list_add(&block->jumps_from[i], &last_block->jumps_from_links[i]);
                    }
                }
                unlock(&asbestos->lock);
            }
        }
        frame->last_block = block;

        // block may be jetsam, but that's ok, because it can't be freed until
        // every thread on this asbestos is not executing anything

        TRACE("%d %08x --- cycle %ld\n", current_pid(), ip, frame->cpu.cycle);

        // Save a fallback block-start PC for crash recovery. Memory gadgets
        // update frame->jit_saved_pc to the precise faultable instruction so
        // host SIGSEGV/SIGBUS recovery does not re-run earlier side effects.
        jit_saved_pc = frame->cpu.pc;
        frame->jit_saved_pc = frame->cpu.pc;

        in_jit = 1;
        interrupt = fiber_enter(block, frame, tlb);
        in_jit = 0;

        // Check if fiber_enter returned due to a JIT crash (signal handler
        // redirected PC to jit_crash_trampoline which returns INT_JIT_CRASH).
        // The signal handler already set cpu->segfault_addr, cpu->pc, etc.
        if (interrupt == INT_JIT_CRASH) {
            // Flush all caches to get fresh host pointers.
            tlb_flush(tlb);
            memset(cache, 0, sizeof(tlb->block_cache));
            tlb->block_cache_gen = asbestos_invalidate_gen_load(asbestos);
            memset(frame->ret_cache, 0, sizeof(frame->ret_cache));
            frame->last_block = NULL;

            crash_retry_count++;
            if (crash_retry_count >= 16) {
                // Too many consecutive crashes — escalate to INT_GPF for handle_interrupt
                interrupt = INT_GPF;
                crash_retry_count = 0;
            } else {
                // Retry: convert to INT_NONE so the loop continues
                interrupt = INT_NONE;
            }
        } else {
            crash_retry_count = 0;
        }

        // Guest writes may modify code (HotSpot inline-cache/nmethod patching,
        // JITs, trampolines). Drop compiled blocks for the last written page at
        // block boundaries so later execution sees freshly translated bytes.
        // tlb->dirty_page is page-aligned (not PAGE()-shifted).
        if (tlb->dirty_page != TLB_PAGE_EMPTY) {
            asbestos_invalidate_page(asbestos, PAGE(tlb->dirty_page));
            tlb->dirty_page = TLB_PAGE_EMPTY;
        }

        // (debug trace removed)

        // Check if page table changed (mmap/munmap by another thread) EVERY BLOCK.
        if (tlb->mem_changes != __atomic_load_n(&tlb->mmu->changes, __ATOMIC_ACQUIRE)) {
            tlb_flush(tlb);
            memset(cache, 0, sizeof(tlb->block_cache));
            tlb->block_cache_gen = asbestos_invalidate_gen_load(asbestos);
            memset(frame->ret_cache, 0, sizeof(frame->ret_cache));
            frame->last_block = NULL;
        }

        // Most block boundaries have no pending poke. Avoid an exclusive
        // read/modify/write in that case; the exchange still consumes a real
        // poke with acquire ordering. A poke arriving after a false load stays
        // set for the next boundary, just as one arriving after the exchange.
        if (interrupt == INT_NONE &&
                __atomic_load_n(frame->cpu.poked_ptr, __ATOMIC_RELAXED) &&
                __atomic_exchange_n(frame->cpu.poked_ptr, false, __ATOMIC_ACQUIRE))
            interrupt = INT_TIMER;
        if (interrupt == INT_NONE && (++frame->cpu.cycle & ((1 << 10) - 1)) == 0)
            interrupt = INT_TIMER;
    }
    // _poked is owned by the live poked_ptr channel. Do not restore the stale
    // snapshot captured when this fiber frame was entered.
    bool live_poked = cpu->_poked;
    *cpu = frame->cpu;
    cpu->_poked = live_poked;

    // Release jetsam_lock read. Jetsam cleanup can now proceed.
    read_wrunlock(&asbestos->jetsam_lock);

    return interrupt;
}

static int cpu_single_step(struct cpu_state *cpu, struct tlb *tlb) {
    struct gen_state state;
    gen_start(CPU_IP(cpu), &state);
    gen_step(&state, tlb);
    gen_exit(&state);
    gen_end(&state);

    struct fiber_block *block = state.block;
    struct fiber_frame frame = {.cpu = *cpu};
    int interrupt = fiber_enter(block, &frame, tlb);
    bool live_poked = cpu->_poked;
    *cpu = frame.cpu;
    cpu->_poked = live_poked;
    fiber_block_free(NULL, block);
    if (interrupt == INT_NONE)
        interrupt = INT_DEBUG;
    return interrupt;
}

int cpu_run_to_interrupt(struct cpu_state *cpu, struct tlb *tlb) {
    ish_thread_marker = 1;
    if (cpu->poked_ptr == NULL)
        cpu->poked_ptr = &cpu->_poked;
#ifdef GUEST_ARM64
    // NOTE: Do NOT invalidate exclusive monitor here.
    // This function is called once, but the inner loop (cpu_step_to_interrupt)
    // calls fiber_enter repeatedly. The LDXR/STXR pair may span multiple
    // fiber_enter calls (unchained blocks). Invalidating here would break
    // LDXR/STXR atomicity across block boundaries.
    // The exclusive monitor is invalidated by STXR itself (success or fail)
    // and by context switches / signal delivery.
#endif
    struct asbestos *asbestos = cpu->mmu->asbestos;
    __atomic_add_fetch(&asbestos->active_threads, 1, __ATOMIC_RELAXED);
    tlb_refresh(tlb, cpu->mmu);
    int interrupt = (CPU_HAS_SINGLE_STEP ? cpu_single_step : cpu_step_to_interrupt)(cpu, tlb);
    cpu->trapno = interrupt;
    __atomic_sub_fetch(&asbestos->active_threads, 1, __ATOMIC_RELAXED);

    lock(&asbestos->lock);
    if (!list_empty(&asbestos->jetsam)) {
        unlock(&asbestos->lock);

        // This runs while task_run_current still holds mem->lock for reading.
        // Do not block here: a concurrent page-fault handler may be queued for
        // mem->lock write, which makes new/read re-entry block on glibc's
        // writer-preferred rwlock and can deadlock with JIT fault retry.
        if (write_wrtrylock(&asbestos->jetsam_lock)) {
            lock(&asbestos->lock);
            fiber_free_jetsam(asbestos);
            unlock(&asbestos->lock);
            write_wrunlock(&asbestos->jetsam_lock);
        }
    } else {
        unlock(&asbestos->lock);
    }

    return interrupt;
}

void cpu_poke(struct cpu_state *cpu) {
    __atomic_store_n(cpu->poked_ptr, true, __ATOMIC_SEQ_CST);
}

static inline size_t fiber_block_hash(addr_t addr, size_t hash_size) {
#ifdef GUEST_ARM64
    // Instruction alignment otherwise leaves three quarters of buckets unused.
    addr >>= 2;
#endif
    return addr % hash_size;
}
