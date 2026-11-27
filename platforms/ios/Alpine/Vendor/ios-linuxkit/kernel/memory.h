#ifndef MEMORY_H
#define MEMORY_H

#include <stdatomic.h>
#include <unistd.h>
#include <stdbool.h>
#include "emu/mmu.h"
#include "util/list.h"
#include "util/sync.h"
#include "misc.h"

// ARM64: 4-level page table for 48-bit address space
// L0[512] → L1[512] → L2[512] → L3[512 pt_entry]
// 9+9+9+9 = 36-bit page number + 12-bit offset = 48-bit address
#define PT_LEVELS 4
#define PT_BITS 9
#define PT_ENTRIES (1 << PT_BITS)  // 512

// Extract level index from page number (36-bit page number)
#define PT_INDEX(page, level) (((page) >> (PT_BITS * (3 - (level)))) & (PT_ENTRIES - 1))

// Page table intermediate node (L0, L1, L2)
struct pt_node {
    void *children[PT_ENTRIES]; // pt_node* for L0-L2, pt_entry* array for L3
};

// Lazy reservation for MAP_NORESERVE regions (JSC heap cage, etc.).
// Records address range and permissions without allocating page table entries.
// Pages are materialized on demand when faulted.
struct mem_reservation {
    page_t start;
    pages_t pages;
    unsigned flags;
    struct mem_reservation *next;
};

struct mem {
    struct pt_node *pgdir;  // L0 node (512 entries)
    int pgdir_used;

    struct mmu mmu;

    // Hint for pt_find_hole: start searching just below the last successful
    // allocation instead of always from MMAP_HOLE_START. Reset on munmap
    // when freed pages are above the hint. Avoids O(n) rescanning of already-
    // allocated regions on every mmap(addr=0).
    page_t mmap_hint;

    struct mem_reservation *reservations;

    wrlock_t lock;
    lock_t cow_lock;
};

// Address space layout for ARM64 guest.
// 48-bit address space with 4-level page table and 48-bit JIT masks.
// Keep default stack and mmap allocations in the low 4GB region so that page
// table walks are shallow (L0[0]→L1[0]→L2→L3 — the first two levels are always
// index 0 and stay hot in cache). The 48-bit infrastructure remains available
// for explicit high-address mmap hints (e.g., V8 CodeRange).
#define STACK_TOP_PAGE    0xffffeULL        // guard page at 0xffffe000
#define STACK_INIT_PAGE   0xffffdULL        // initial stack page (growsdown)
#define STACK_TOP_ADDR    0xffffe000ULL     // SP starts here
#define MMAP_HOLE_START   0xefffdULL        // mmap search starts here
#define MMAP_HOLE_END     0x100ULL          // mmap search ends here (above guard pages)
// Upper bound for valid user addresses (page number, 48-bit / 4K = 36-bit)
#define USER_ADDR_MAX_PAGE  0xFFFFFFFFFULL

// Initialize the address space
void mem_init(struct mem *mem);
// Uninitialize the address space
void mem_destroy(struct mem *mem);
// Bump the memory-change generation (for page-backing mutations that bypass
// pt_map/pt_unmap, e.g. madvise MADV_DONTNEED in-place zeroing).
void mem_changed_pub(struct mem *mem);
// Return the pagetable entry for the given page
struct pt_entry *mem_pt(struct mem *mem, page_t page);
// Increment *page, skipping over unallocated page directories. Intended to be
// used as the incremenent in a for loop to traverse mappings.
void mem_next_page(struct mem *mem, page_t *page);

#define BYTES_ROUND_DOWN(bytes) (PAGE(bytes) << PAGE_BITS)
#define BYTES_ROUND_UP(bytes) (PAGE_ROUND_UP(bytes) << PAGE_BITS)

#define LEAK_DEBUG 0

struct data {
    void *data; // immutable
    size_t size; // also immutable
    atomic_uint refcount;

    // for display in /proc/pid/maps
    struct fd *fd;
    size_t file_offset;
    const char *name;
#if LEAK_DEBUG
    int pid;
    addr_t dest;
#endif
};
struct pt_entry {
    struct data *data;
    size_t offset;
    unsigned flags;
    struct list blocks[2];
};
// page flags
// P_READ and P_EXEC are ignored for now
#define P_READ (1 << 0)
#define P_WRITE (1 << 1)
#undef P_EXEC // defined in sys/proc.h on darwin
#define P_EXEC (1 << 2)
#define P_RWX (P_READ | P_WRITE | P_EXEC)
#define P_GROWSDOWN (1 << 3)
#define P_COW (1 << 4)
#define P_WRITABLE(flags) (flags & P_WRITE && !(flags & P_COW))

// mapping was created with pt_map_nothing
#define P_ANONYMOUS (1 << 6)
// mapping was created with MAP_SHARED, should not CoW
#define P_SHARED (1 << 7)

bool pt_is_hole(struct mem *mem, page_t start, pages_t pages);
page_t pt_find_hole(struct mem *mem, pages_t size);

page_t pt_find_hole_high(struct mem *mem, pages_t size);
int pt_map_lazy(struct mem *mem, page_t start, pages_t pages, unsigned flags);
struct mem_reservation *mem_find_reservation(struct mem *mem, page_t page);
bool mem_range_has_reservation(struct mem *mem, page_t start, pages_t pages);
void mem_remove_reservations(struct mem *mem, page_t start, pages_t pages);
int mem_set_reservation_flags(struct mem *mem, page_t start, pages_t pages, unsigned flags);

// Map memory + offset into fake memory, unmapping existing mappings. Takes
// ownership of memory. It will be freed with:
// munmap(memory, pages * PAGE_SIZE)
int pt_map(struct mem *mem, page_t start, pages_t pages, void *memory, size_t offset, unsigned flags);
// Map empty space into fake memory
int pt_map_nothing(struct mem *mem, page_t page, pages_t pages, unsigned flags);
// Unmap fake memory, return -1 if any part of the range isn't mapped and 0 otherwise
int pt_unmap(struct mem *mem, page_t start, pages_t pages);
// like pt_unmap but doesn't care if part of the range isn't mapped
int pt_unmap_always(struct mem *mem, page_t start, pages_t pages);
// Set the flags on memory
int pt_set_flags(struct mem *mem, page_t start, pages_t pages, int flags);
// Copy pages from src memory to dst memory using copy-on-write
int pt_copy_on_write(struct mem *src, struct mem *dst, page_t start, page_t pages);

// Must call with mem read-locked.
void *mem_ptr(struct mem *mem, addr_t addr, int type);
int mem_segv_reason(struct mem *mem, addr_t addr);

extern size_t real_page_size;

#endif
