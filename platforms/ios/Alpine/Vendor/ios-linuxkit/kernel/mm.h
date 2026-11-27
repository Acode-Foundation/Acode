#ifndef KERNEL_MM_H
#define KERNEL_MM_H

#include <stdatomic.h>
#include "kernel/memory.h"
#include "misc.h"

// Maximum anonymous mmap pages across ALL processes (host memory cap).
// Prevents iOS app from being killed by jetsam.
// 0 = no limit. Non-zero = hard limit in pages (4KB each).
// Go runtime alone needs ~1.1GB for page summary reservations (PROT_NONE).
// 524288 pages = 2GB.
#define ANON_MMAP_LIMIT_PAGES 1048576

#if ANON_MMAP_LIMIT_PAGES > 0
extern _Atomic long anon_page_count;
#endif

// uses mem.lock instead of having a lock of its own
struct mm {
    atomic_uint refcount;
    struct mem mem;

    addr_t vdso; // immutable
    addr_t start_brk; // immutable
    addr_t brk;

    // crap for procfs
    addr_t argv_start;
    addr_t argv_end;
    addr_t env_start;
    addr_t env_end;
    addr_t auxv_start;
    addr_t auxv_end;
    addr_t stack_start;
    struct fd *exefile;
};

// Create a new address space
struct mm *mm_new(void);
// Clone (COW) the address space
struct mm *mm_copy(struct mm *mm);
// Increment the refcount
void mm_retain(struct mm *mem);
// Decrement the refcount, destroy everything in the space if 0
void mm_release(struct mm *mem);

#endif
