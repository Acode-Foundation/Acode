#include <stdatomic.h>
#include "emu/cpu.h"

// keep in sync with asm
#define FIBER_RETURN_CACHE_SIZE 4096
#define FIBER_RETURN_CACHE_HASH(x) ((x) & 0xFFF0) >> 4)

struct fiber_frame {
    struct cpu_state cpu;
    void *bp;
    addr_t value_addr;
    uint64_t value[4]; // buffer for crosspage crap (must hold up to 32 bytes)
    struct fiber_block *last_block;
    uint64_t jit_exit_sp; // host sp value that fiber_exit expects (set by fiber_enter)
    addr_t jit_saved_pc; // precise guest PC to retry after an async JIT host fault
    long ret_cache[FIBER_RETURN_CACHE_SIZE]; // a map of ip to pointer-to-call-gadget-arguments
};
