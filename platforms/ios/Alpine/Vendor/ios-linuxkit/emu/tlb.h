#ifndef TLB_H
#define TLB_H

#include <string.h>
#include "emu/mmu.h"
#include "debug.h"

struct tlb_entry {
    page_t page;
    page_t page_if_writable;
    uintptr_t data_minus_addr;
#ifdef GUEST_ARM64
    // Coherence generation: snapshot of mmu->changes when this entry was
    // populated. Used to detect a stale entry whose page was remapped
    // (CoW/mmap/munmap) by another thread while this thread was mid-block.
    // Occupies the former 32-byte padding slot (JIT indexes entries by lsl #5).
    uintptr_t gen;
#endif
};
#define TLB_BITS 13  // 8192 entries
#define TLB_SIZE (1 << TLB_BITS)
struct fiber_block;
struct fiber_frame;

struct tlb {
    struct mmu *mmu;
    page_t dirty_page;
    unsigned mem_changes;
    // this is basically one of the return values of tlb_handle_miss, tlb_{read,write}, and __tlb_{read,write}_cross_page
    // yes, this sucks
    addr_t segfault_addr;

    struct tlb_entry entries[TLB_SIZE];

    // Persistent block cache across syscalls (avoids re-lookup after every interrupt)
    // Size defined by FIBER_CACHE_SIZE in asbestos.h
    struct fiber_block *block_cache[1 << 12];  // must match FIBER_CACHE_SIZE
    unsigned block_cache_gen; // tracks asbestos->invalidate_gen for invalidation

    // Persistent fiber_frame (avoids malloc/free + ret_cache zeroing per syscall)
    struct fiber_frame *frame;
};

#define TLB_INDEX(addr) ((((addr >> PAGE_BITS) ^ (addr >> (PAGE_BITS + TLB_BITS))) & (TLB_SIZE - 1)))
#ifdef GUEST_ARM64
#define TLB_PAGE(addr) ((addr) & 0xfffffffffffff000ULL)
#else
#define TLB_PAGE(addr) ((addr) & 0xfffff000)
#endif
#define TLB_PAGE_EMPTY 1
void tlb_refresh(struct tlb *tlb, struct mmu *mmu);
void tlb_free(struct tlb *tlb);
void tlb_flush(struct tlb *tlb);
void *tlb_handle_miss(struct tlb *tlb, addr_t addr, int type);

forceinline __no_instrument void *__tlb_read_ptr(struct tlb *tlb, addr_t addr) {
    struct tlb_entry entry = tlb->entries[TLB_INDEX(addr)];
    if (entry.page == TLB_PAGE(addr)
#ifdef GUEST_ARM64
        // Coherence: reject a hit whose page was remapped by another thread
        // since this entry was cached (CoW/mmap advanced mmu->changes). Falling
        // through to tlb_handle_miss re-translates to the current backing.
        && entry.gen == (uintptr_t) __atomic_load_n(&tlb->mmu->changes, __ATOMIC_ACQUIRE)
#endif
    ) {
        void *address = (void *) (entry.data_minus_addr + addr);
        return address;
    }
    return tlb_handle_miss(tlb, addr, MEM_READ);
}
bool __tlb_read_cross_page(struct tlb *tlb, addr_t addr, char *out, unsigned size);
forceinline __no_instrument bool tlb_read(struct tlb *tlb, addr_t addr, void *out, unsigned size) {
    if (PGOFFSET(addr) > PAGE_SIZE - size)
        return __tlb_read_cross_page(tlb, addr, out, size);
    void *ptr = __tlb_read_ptr(tlb, addr);
    if (ptr == NULL)
        return false;
    memcpy(out, ptr, size);
    return true;
}

// C-level write watchpoint: detect stores that bypass assembly write_prep
#define ENABLE_C_WRITE_WATCHPOINT 1
extern volatile addr_t g_watch_page_val;
void c_watch_write_hit(addr_t addr, const char *caller);

forceinline __no_instrument void *__tlb_write_ptr(struct tlb *tlb, addr_t addr) {
#ifdef ENABLE_C_WRITE_WATCHPOINT
    if (g_watch_page_val && (addr & ~0xfffULL) == g_watch_page_val) {
        c_watch_write_hit(addr, __func__);
    }
#endif
    struct tlb_entry entry = tlb->entries[TLB_INDEX(addr)];
    if (entry.page_if_writable == TLB_PAGE(addr)
#ifdef GUEST_ARM64
        && entry.gen == (uintptr_t) __atomic_load_n(&tlb->mmu->changes, __ATOMIC_ACQUIRE)
#endif
    ) {
        tlb->dirty_page = TLB_PAGE(addr);
        void *address = (void *) (entry.data_minus_addr + addr);
        return address;
    }
    return tlb_handle_miss(tlb, addr, MEM_WRITE);
}
bool __tlb_write_cross_page(struct tlb *tlb, addr_t addr, const char *value, unsigned size);
bool __tlb_zero(struct tlb *tlb, addr_t addr, unsigned size);
forceinline __no_instrument bool tlb_write(struct tlb *tlb, addr_t addr, const void *value, unsigned size) {
    if (PGOFFSET(addr) > PAGE_SIZE - size)
        return __tlb_write_cross_page(tlb, addr, value, size);
    void *ptr = __tlb_write_ptr(tlb, addr);
    if (ptr == NULL)
        return false;
    memcpy(ptr, value, size);
    return true;
}

#endif
