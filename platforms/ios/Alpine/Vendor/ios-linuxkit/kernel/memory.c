#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <errno.h>
#include <stdatomic.h>
#include <sched.h>

#define DEFAULT_CHANNEL memory
#include "debug.h"
#include "kernel/errno.h"
#include "kernel/signal.h"
#include "kernel/memory.h"
#include "asbestos/asbestos.h"
#include "kernel/vdso.h"
#include "kernel/task.h"
#include "kernel/resource.h"
#include "fs/fd.h"

// increment the change count
static void mem_changed(struct mem *mem);
static struct mmu_ops mem_mmu_ops;

#include "kernel/mm.h"

static void reacquire_read_after_failed_jit_upgrade(wrlock_t *lock) {
    // glibc rwlocks are writer-preferred in util/sync.h. If a JIT thread
    // releases its read lock, fails trywrlock, then blocks in rdlock while a
    // non-JIT fault handler is queued for write, both sides can deadlock. Spin
    // with tryrdlock instead so the queued writer can acquire and release.
    while (!read_wrtrylock(lock))
        sched_yield();
}



// ============================================================
// ARM64: 4-level page table for 48-bit address space
// ============================================================

void mem_init(struct mem *mem) {
    mem->pgdir = calloc(1, sizeof(struct pt_node));
    mem->pgdir_used = 0;
    mem->mmap_hint = 0;
    mem->reservations = NULL;
    mem->mmu.ops = &mem_mmu_ops;
    mem->mmu.asbestos = asbestos_new(&mem->mmu);
    mem->mmu.changes = 0;
    wrlock_init(&mem->lock);
    lock_init(&mem->cow_lock);
}

static page_t page_range_end(page_t start, pages_t pages) {
    if (pages == 0)
        return start;
    if (start >= MEM_PAGES || pages > MEM_PAGES - start)
        return MEM_PAGES;
    return start + pages;
}

struct mem_reservation *mem_find_reservation(struct mem *mem, page_t page) {
    for (struct mem_reservation *r = mem->reservations; r; r = r->next) {
        if (r->pages != 0 && page >= r->start && page < page_range_end(r->start, r->pages))
            return r;
    }
    return NULL;
}

int pt_map_lazy(struct mem *mem, page_t start, pages_t pages, unsigned flags) {
    struct mem_reservation *res = malloc(sizeof(struct mem_reservation));
    if (res == NULL)
        return _ENOMEM;
    res->start = start;
    res->pages = pages;
    res->flags = flags | P_ANONYMOUS;
    res->next = mem->reservations;
    mem->reservations = res;
    mem_changed(mem);
    return 0;
}

void mem_remove_reservations(struct mem *mem, page_t start, pages_t pages) {
    if (pages == 0)
        return;
    struct mem_reservation **pp = &mem->reservations;
    page_t u_end = page_range_end(start, pages);
    while (*pp) {
        struct mem_reservation *r = *pp;
        page_t r_end = page_range_end(r->start, r->pages);
        if (r->start >= u_end || r_end <= start) {
            pp = &r->next;
            continue;
        }
        if (r->start >= start && r_end <= u_end) {
            *pp = r->next;
            free(r);
            continue;
        }
        if (r->start < start && r_end > u_end) {
            struct mem_reservation *tail = malloc(sizeof(struct mem_reservation));
            if (tail) {
                tail->start = u_end;
                tail->pages = r_end - u_end;
                tail->flags = r->flags;
                tail->next = r->next;
                r->pages = start - r->start;
                r->next = tail;
            }
            pp = &(tail ? tail : r)->next;
            continue;
        }
        if (r->start < start) {
            r->pages = start - r->start;
        } else {
            r->start = u_end;
            r->pages = r_end - u_end;
        }
        pp = &r->next;
    }
}

int mem_set_reservation_flags(struct mem *mem, page_t start, pages_t pages, unsigned flags) {
    if (pages == 0)
        return 0;

    page_t end = page_range_end(start, pages);
    for (struct mem_reservation *r = mem->reservations; r; r = r->next) {
        page_t r_end = page_range_end(r->start, r->pages);
        if (r->start >= end || r_end <= start)
            continue;

        page_t overlap_start = r->start > start ? r->start : start;
        page_t overlap_end = r_end < end ? r_end : end;
        pages_t before = overlap_start - r->start;
        pages_t overlap = overlap_end - overlap_start;
        pages_t after = r_end - overlap_end;
        unsigned old_flags = r->flags;
        unsigned new_flags = flags | (old_flags & P_ANONYMOUS);

        if (before && after) {
            struct mem_reservation *middle = malloc(sizeof(struct mem_reservation));
            struct mem_reservation *tail = malloc(sizeof(struct mem_reservation));
            if (middle == NULL || tail == NULL) {
                free(middle);
                free(tail);
                return _ENOMEM;
            }
            tail->start = overlap_end;
            tail->pages = after;
            tail->flags = old_flags;
            tail->next = r->next;

            middle->start = overlap_start;
            middle->pages = overlap;
            middle->flags = new_flags;
            middle->next = tail;

            r->pages = before;
            r->next = middle;
            r = tail;
        } else if (before) {
            struct mem_reservation *middle = malloc(sizeof(struct mem_reservation));
            if (middle == NULL)
                return _ENOMEM;
            middle->start = overlap_start;
            middle->pages = overlap;
            middle->flags = new_flags;
            middle->next = r->next;

            r->pages = before;
            r->next = middle;
            r = middle;
        } else if (after) {
            struct mem_reservation *tail = malloc(sizeof(struct mem_reservation));
            if (tail == NULL)
                return _ENOMEM;
            tail->start = overlap_end;
            tail->pages = after;
            tail->flags = old_flags;
            tail->next = r->next;

            r->start = overlap_start;
            r->pages = overlap;
            r->flags = new_flags;
            r->next = tail;
        } else {
            r->flags = new_flags;
        }
    }
    return 0;
}

// Recursively free page table nodes at given level
static void pt_node_free(void *node, int level) {
    if (node == NULL)
        return;
    if (level == 3) {
        // L3: array of pt_entry — just free the array
        free(node);
        return;
    }
    struct pt_node *n = node;
    for (int i = 0; i < PT_ENTRIES; i++) {
        pt_node_free(n->children[i], level + 1);
    }
    free(n);
}

void mem_destroy(struct mem *mem) {
    write_wrlock(&mem->lock);
    pt_unmap_always(mem, 0, MEM_PAGES);
    while (mem->reservations) {
        struct mem_reservation *r = mem->reservations;
        mem->reservations = r->next;
        free(r);
    }
    asbestos_free(mem->mmu.asbestos);
    mem->mmu.asbestos = NULL;
    pt_node_free(mem->pgdir, 0);
    mem->pgdir = NULL;
    write_wrunlock(&mem->lock);
    wrlock_destroy(&mem->lock);
}

// Navigate 4-level page table to find L3 entry, creating intermediate nodes as needed
static struct pt_entry *mem_pt_new(struct mem *mem, page_t page) {
    struct pt_node *l0 = mem->pgdir;
    int i0 = PT_INDEX(page, 0);
    struct pt_node *l1 = l0->children[i0];
    if (l1 == NULL) {
        l1 = l0->children[i0] = calloc(1, sizeof(struct pt_node));
        mem->pgdir_used++;
    }

    int i1 = PT_INDEX(page, 1);
    struct pt_node *l2 = l1->children[i1];
    if (l2 == NULL)
        l2 = l1->children[i1] = calloc(1, sizeof(struct pt_node));

    int i2 = PT_INDEX(page, 2);
    struct pt_entry *l3 = l2->children[i2];
    if (l3 == NULL)
        l3 = l2->children[i2] = calloc(PT_ENTRIES, sizeof(struct pt_entry));

    int i3 = PT_INDEX(page, 3);
    return &l3[i3];
}

struct pt_entry *mem_pt(struct mem *mem, page_t page) {
    struct pt_node *l0 = mem->pgdir;
    if (l0 == NULL) return NULL;

    struct pt_node *l1 = l0->children[PT_INDEX(page, 0)];
    if (l1 == NULL) return NULL;

    struct pt_node *l2 = l1->children[PT_INDEX(page, 1)];
    if (l2 == NULL) return NULL;

    struct pt_entry *l3 = l2->children[PT_INDEX(page, 2)];
    if (l3 == NULL) return NULL;

    struct pt_entry *entry = &l3[PT_INDEX(page, 3)];
    if (entry->data == NULL) return NULL;
    return entry;
}

static void mem_pt_del(struct mem *mem, page_t page) {
    struct pt_entry *entry = mem_pt(mem, page);
    if (entry != NULL)
        entry->data = NULL;
}

// Skip over large unallocated regions efficiently by checking intermediate levels
void mem_next_page(struct mem *mem, page_t *page) {
    (*page)++;
    if (*page >= MEM_PAGES)
        return;

    struct pt_node *l0 = mem->pgdir;
    if (l0 == NULL) { *page = MEM_PAGES; return; }

    while (*page < MEM_PAGES) {
        int i0 = PT_INDEX(*page, 0);
        struct pt_node *l1 = l0->children[i0];
        if (l1 == NULL) {
            // Skip entire L0 region (2^27 pages)
            *page = (((*page >> (PT_BITS * 3)) + 1) << (PT_BITS * 3));
            continue;
        }

        int i1 = PT_INDEX(*page, 1);
        struct pt_node *l2 = l1->children[i1];
        if (l2 == NULL) {
            // Skip entire L1 region (2^18 pages)
            *page = (((*page >> (PT_BITS * 2)) + 1) << (PT_BITS * 2));
            continue;
        }

        int i2 = PT_INDEX(*page, 2);
        struct pt_entry *l3 = l2->children[i2];
        if (l3 == NULL) {
            // Skip entire L2 region (2^9 = 512 pages)
            *page = (((*page >> PT_BITS) + 1) << PT_BITS);
            continue;
        }
        // Found a populated L3 array — page might exist here
        return;
    }
}

bool mem_range_has_reservation(struct mem *mem, page_t start, pages_t size) {
    if (size == 0)
        return false;
    page_t end = page_range_end(start, size);
    if (end <= start)
        return true;
    for (struct mem_reservation *r = mem->reservations; r; r = r->next) {
        if (r->pages == 0)
            continue;
        page_t r_end = page_range_end(r->start, r->pages);
        if (r_end <= r->start || (r->start < end && r_end > start))
            return true;
    }
    return false;
}

// Scan downward from 'start' to MMAP_HOLE_END, skipping unallocated page table
// subtrees for efficiency (L0 covers 2^27 pages, L1 2^18, L2 2^9).
static page_t pt_find_hole_from(struct mem *mem, pages_t size, page_t start) {
    struct pt_node *l0 = mem->pgdir;
    page_t hole_end = 0;
    bool in_hole = false;

    page_t page = start;
    while (page > MMAP_HOLE_END) {
        // Fast-skip unallocated L0 subtrees
        int i0 = PT_INDEX(page, 0);
        struct pt_node *l1 = l0 ? l0->children[i0] : NULL;
        if (l1 == NULL) {
            page_t l0_base = (page_t)i0 << (PT_BITS * 3);
            if (!in_hole) { in_hole = true; hole_end = page + 1; }
            page_t effective_base = (l0_base > MMAP_HOLE_END) ? l0_base : MMAP_HOLE_END + 1;
            if (in_hole && hole_end - effective_base >= size)
                return hole_end - size;
            if (l0_base == 0) break;
            page = l0_base - 1;
            continue;
        }

        // Fast-skip unallocated L1 subtrees
        int i1 = PT_INDEX(page, 1);
        struct pt_node *l2 = l1->children[i1];
        if (l2 == NULL) {
            page_t l1_base = ((page_t)i0 << (PT_BITS * 3)) | ((page_t)i1 << (PT_BITS * 2));
            if (!in_hole) { in_hole = true; hole_end = page + 1; }
            page_t effective_base = (l1_base > MMAP_HOLE_END) ? l1_base : MMAP_HOLE_END + 1;
            if (in_hole && hole_end - effective_base >= size)
                return hole_end - size;
            if (l1_base == 0) break;
            page = l1_base - 1;
            continue;
        }

        // Fast-skip unallocated L2 subtrees
        int i2 = PT_INDEX(page, 2);
        struct pt_entry *l3 = l2->children[i2];
        if (l3 == NULL) {
            page_t l2_base = ((page_t)i0 << (PT_BITS * 3)) | ((page_t)i1 << (PT_BITS * 2)) | ((page_t)i2 << PT_BITS);
            if (!in_hole) { in_hole = true; hole_end = page + 1; }
            page_t effective_base = (l2_base > MMAP_HOLE_END) ? l2_base : MMAP_HOLE_END + 1;
            if (in_hole && hole_end - effective_base >= size)
                return hole_end - size;
            if (l2_base == 0) break;
            page = l2_base - 1;
            continue;
        }

        // L3 exists — check individual pages
        if (mem_pt(mem, page) != NULL) {
            in_hole = false;
        } else {
            if (!in_hole) { in_hole = true; hole_end = page + 1; }
            if (hole_end - page >= size)
                return page;
        }
        if (page == 0) break;
        page--;
    }
    return BAD_PAGE;
}

// Scan upward in the high address space (above 4GB) for large allocations
// that don't fit in the low region. Used for Wasm guard regions etc.
page_t pt_find_hole_high(struct mem *mem, pages_t size) {
    // Search from 0x100000 (4GB) upward to USER_ADDR_MAX_PAGE. Large
    // MAP_NORESERVE arenas are represented as reservations without allocating
    // page-table nodes, so an empty L0 subtree is not necessarily free. Walk
    // reservations inside each empty subtree before accepting a high hole.
    page_t page = 0x100000; // Start at 4GB

    while (page < USER_ADDR_MAX_PAGE) {
        int i0 = PT_INDEX(page, 0);
        struct pt_node *l0 = mem->pgdir;
        struct pt_node *l1 = l0 ? l0->children[i0] : NULL;
        page_t l0_size = (page_t)1 << (PT_BITS * 3);
        page_t l0_base = (page_t)i0 << (PT_BITS * 3);
        page_t subtree_end = l0_base + l0_size;
        if (subtree_end > USER_ADDR_MAX_PAGE)
            subtree_end = USER_ADDR_MAX_PAGE;

        if (l1 == NULL) {
            page_t candidate = l0_base < page ? page : l0_base;
            while (candidate < subtree_end) {
                struct mem_reservation *first = NULL;
                for (struct mem_reservation *r = mem->reservations; r; r = r->next) {
                    page_t r_end = r->start + r->pages;
                    if (r_end <= candidate || r->start >= subtree_end)
                        continue;
                    if (r->start <= candidate) {
                        candidate = r_end;
                        first = r;
                        break;
                    }
                    if (first == NULL || r->start < first->start)
                        first = r;
                }
                if (first == NULL) {
                    if (subtree_end - candidate >= size)
                        return candidate;
                    break;
                }
                if (first->start > candidate) {
                    if (first->start - candidate >= size)
                        return candidate;
                    candidate = first->start + first->pages;
                }
            }
            page = subtree_end;
            continue;
        }

        // L1 exists — something is mapped here, skip the whole subtree.
        page = subtree_end;
    }
    return BAD_PAGE;
}

page_t pt_find_hole(struct mem *mem, pages_t size) {
    page_t start = mem->mmap_hint;
    if (start == 0 || start > MMAP_HOLE_START || start <= MMAP_HOLE_END + size)
        start = MMAP_HOLE_START;

    // Try low address space with reservation awareness.
    // If a candidate overlaps a reservation, retry below the reservation.
    for (int attempt = 0; attempt < 10; attempt++) {
        page_t result = pt_find_hole_from(mem, size, start);
        if (result == BAD_PAGE)
            break;
        if (!mem_range_has_reservation(mem, result, size)) {
            mem->mmap_hint = (result > 0) ? result - 1 : 0;
            return result;
        }
        // Skip below the overlapping reservation
        for (struct mem_reservation *r = mem->reservations; r; r = r->next) {
            if (r->start < result + size && r->start + r->pages > result) {
                start = (r->start > 0) ? r->start - 1 : 0;
                break;
            }
        }
    }

    // Wrap around from top
    if (start < MMAP_HOLE_START) {
        start = MMAP_HOLE_START;
        for (int attempt = 0; attempt < 10; attempt++) {
            page_t result = pt_find_hole_from(mem, size, start);
            if (result == BAD_PAGE)
                break;
            if (!mem_range_has_reservation(mem, result, size)) {
                mem->mmap_hint = (result > 0) ? result - 1 : 0;
                return result;
            }
            for (struct mem_reservation *r = mem->reservations; r; r = r->next) {
                if (r->start < result + size && r->start + r->pages > result) {
                    start = (r->start > 0) ? r->start - 1 : 0;
                    break;
                }
            }
        }
    }

    // Low 4GB exhausted — try high address space (above 4GB).
    page_t result = pt_find_hole_high(mem, size);
    if (result != BAD_PAGE && !mem_range_has_reservation(mem, result, size))
        return result;

    return BAD_PAGE;
}


bool pt_is_hole(struct mem *mem, page_t start, pages_t pages) {
    for (page_t page = start; page < start + pages; page++) {
        if (mem_pt(mem, page) != NULL)
            return false;
    }
    if (mem_range_has_reservation(mem, start, pages))
        return false;
    return true;
}

int pt_map(struct mem *mem, page_t start, pages_t pages, void *memory, size_t offset, unsigned flags) {
    if (memory == MAP_FAILED)
        return errno_map();

    // If this fails, the munmap in pt_unmap would probably fail.
    assert((uintptr_t) memory % real_page_size == 0 || memory == vdso_data);

    struct data *data = malloc(sizeof(struct data));
    if (data == NULL)
        return _ENOMEM;
    *data = (struct data) {
        .data = memory,
        .size = pages * PAGE_SIZE + offset,

#if LEAK_DEBUG
        .pid = current ? current->pid : 0,
        .dest = start << PAGE_BITS,
#endif
    };

    for (page_t page = start; page < start + pages; page++) {
        if (mem_pt(mem, page) != NULL)
            pt_unmap(mem, page, 1);
        data->refcount++;
        struct pt_entry *pt = mem_pt_new(mem, page);
        pt->data = data;
        pt->offset = ((page - start) << PAGE_BITS) + offset;
        pt->flags = flags;

    }
    mem_changed(mem);
    return 0;
}

int pt_unmap(struct mem *mem, page_t start, pages_t pages) {
    for (page_t page = start; page < start + pages; page++)
        if (mem_pt(mem, page) == NULL)
            return -1;
    return pt_unmap_always(mem, start, pages);
}

int pt_unmap_always(struct mem *mem, page_t start, pages_t pages) {
    // Reset mmap_hint if freed region is above it, so pt_find_hole can
    // reuse the freed space on the next mmap(addr=0).
    if (start + pages - 1 > mem->mmap_hint)
        mem->mmap_hint = start + pages - 1;

    mem_remove_reservations(mem, start, pages);

    for (page_t page = start; page < start + pages; mem_next_page(mem, &page)) {
        struct pt_entry *pt = mem_pt(mem, page);
        if (pt == NULL)
            continue;

        asbestos_invalidate_page(mem->mmu.asbestos, page);
        struct data *data = pt->data;
#if ANON_MMAP_LIMIT_PAGES > 0
        // Decrement per-page for anonymous mappings. This correctly handles
        // partial unmaps (munmap of subset of original mmap region) where the
        // data object's refcount doesn't reach 0 but the guest page is gone.
        if (pt->flags & P_ANONYMOUS)
            atomic_fetch_sub(&anon_page_count, 1);
#endif
        mem_pt_del(mem, page);
        if (--data->refcount == 0) {
            // vdso wasn't allocated with mmap, it's just in our data segment
            if (data->data != vdso_data) {
                munmap(data->data, data->size);
            }
            if (data->fd != NULL) {
                fd_close(data->fd);
            }
            free(data);
        }
    }
    mem_changed(mem);
    return 0;
}

int pt_map_nothing(struct mem *mem, page_t start, pages_t pages, unsigned flags) {
    if (pages == 0) return 0;
    // Use host PROT_NONE for guest PROT_NONE mappings. Go runtime reserves
    // ~1.1GB of PROT_NONE address space for page summaries; allocating real
    // memory for these wastes physical RAM and causes iOS jetsam kills.
    int host_prot = PROT_READ | PROT_WRITE;
    if (!(flags & P_READ) && !(flags & P_WRITE) && !(flags & P_EXEC))
        host_prot = PROT_NONE;
    size_t map_size = (size_t)pages * PAGE_SIZE;
    void *memory = mmap(NULL, map_size, host_prot, MAP_PRIVATE | MAP_ANONYMOUS, 0, 0);
    if (memory == MAP_FAILED)
        return _ENOMEM;
    return pt_map(mem, start, pages, memory, 0, flags | P_ANONYMOUS);
}

// Metadata flags that must be preserved across mprotect — they track
// allocation type and state, not user-visible protection bits.
#define P_META_FLAGS (P_ANONYMOUS | P_GROWSDOWN | P_COW | P_SHARED)

int pt_set_flags(struct mem *mem, page_t start, pages_t pages, int flags) {
    for (page_t page = start; page < start + pages; page++) {
        if (mem_pt(mem, page) == NULL) {
            if (mem_find_reservation(mem, page) != NULL)
                continue;
            return _ENOMEM;
        }
    }
    for (page_t page = start; page < start + pages; page++) {
        struct pt_entry *entry = mem_pt(mem, page);
        if (entry == NULL)
            continue;
        int old_flags = entry->flags;
        entry->flags = flags | (old_flags & P_META_FLAGS);

        // check if protection is increasing
        if ((flags & ~old_flags) & (P_READ|P_WRITE)) {
            void *data = (char *) entry->data->data + entry->offset;
            // force to be page aligned
            data = (void *) ((uintptr_t) data & ~(real_page_size - 1));
            int prot = PROT_READ;
            if (flags & P_WRITE) prot |= PROT_WRITE;
            if (mprotect(data, real_page_size, prot) < 0)
                return errno_map();
        }
    }
    int err = mem_set_reservation_flags(mem, start, pages, flags);
    if (err < 0)
        return err;
    mem_changed(mem);
    return 0;
}

int pt_copy_on_write(struct mem *src, struct mem *dst, page_t start, page_t pages) {
#if ANON_MMAP_LIMIT_PAGES > 0
    long anon_copied = 0;
#endif
    for (page_t page = start; page < start + pages; mem_next_page(src, &page)) {
        struct pt_entry *entry = mem_pt(src, page);
        if (entry == NULL)
            continue;
        if (pt_unmap_always(dst, page, 1) < 0)
            return -1;
        if (!(entry->flags & P_SHARED))
            entry->flags |= P_COW;
        entry->data->refcount++;
        struct pt_entry *dst_entry = mem_pt_new(dst, page);
        dst_entry->data = entry->data;
        dst_entry->offset = entry->offset;
        dst_entry->flags = entry->flags;
#if ANON_MMAP_LIMIT_PAGES > 0
        if (entry->flags & P_ANONYMOUS)
            anon_copied++;
#endif
    }
#if ANON_MMAP_LIMIT_PAGES > 0
    // The child process now has its own set of anonymous pages.
    // These will be decremented per-page when the child's mm is freed.
    atomic_fetch_add(&anon_page_count, anon_copied);
#endif
    for (struct mem_reservation *r = src->reservations; r; r = r->next) {
        struct mem_reservation *copy = malloc(sizeof(struct mem_reservation));
        if (copy) {
            *copy = *r;
            copy->next = dst->reservations;
            dst->reservations = copy;
        }
    }
    mem_changed(src);
    mem_changed(dst);
    return 0;
}

static void mem_changed(struct mem *mem) {
    __atomic_add_fetch(&mem->mmu.changes, 1, __ATOMIC_RELEASE);
}

// Public wrapper: bump the memory-change generation so other threads' TLB
// coherence checks force a re-translate. Used by paths that mutate page
// backing without going through pt_map/pt_unmap (e.g. madvise MADV_DONTNEED
// zeroing a page in place).
void mem_changed_pub(struct mem *mem) {
    mem_changed(mem);
}

// This version will return NULL instead of making necessary pagetable changes.
// Used by the emulator to avoid deadlocks.
static void *mem_ptr_nofault(struct mem *mem, addr_t addr, int type) {
    struct pt_entry *entry = mem_pt(mem, PAGE(addr));
    if (entry == NULL)
        return NULL;
    if (type == MEM_WRITE && !P_WRITABLE(entry->flags))
        return NULL;
    return entry->data->data + entry->offset + PGOFFSET(addr);
}

void *mem_ptr(struct mem *mem, addr_t addr, int type) {
#ifndef NDEBUG
    void *old_ptr = mem_ptr_nofault(mem, addr, type); // just for an assert
#endif

    page_t page = PAGE(addr);
    struct pt_entry *entry = mem_pt(mem, page);
    extern __thread volatile sig_atomic_t in_jit;

    if (entry == NULL) {
        // page does not exist
        // look to see if the next VM region is willing to grow down
        page_t p = page;
        mem_next_page(mem, &p);
        while (p < MEM_PAGES && mem_pt(mem, p) == NULL)
            mem_next_page(mem, &p);
        if (p >= MEM_PAGES)
            goto check_reservation;
        if (!(mem_pt(mem, p)->flags & P_GROWSDOWN))
            goto check_reservation;

        // Enforce RLIMIT_STACK: don't grow stack beyond the limit.
        // Stack top is at STACK_TOP_PAGE (guard page), stack grows down from STACK_INIT_PAGE.
        pages_t guard_page = STACK_TOP_PAGE;
        rlim_t_ stack_limit = rlimit(RLIMIT_STACK_);
        if (stack_limit != RLIM_INFINITY_) {
            pages_t stack_pages = guard_page - page;
            if ((uint64_t)stack_pages * PAGE_SIZE > stack_limit)
                return NULL;
        }

        // Lock upgrade: release read, acquire write.
        // In JIT context (inside fiber_enter), other threads hold mem->lock
        // READ from their task_run_current, so write_wrlock deadlocks.
        // Use trylock: if contended, return NULL for INT_GPF retry from
        // handle_interrupt where the lock upgrade is safe.
        read_wrunlock(&mem->lock);
        if (in_jit) {
            if (!write_wrtrylock(&mem->lock)) {
                // Can't get write lock — other threads hold/read-wait on this
                // writer-preferred rwlock. Re-acquire read without blocking a
                // queued writer, then return NULL for GPF retry outside JIT.
                reacquire_read_after_failed_jit_upgrade(&mem->lock);
                return NULL;
            }
        } else {
            write_wrlock(&mem->lock);
        }
        // Re-check after acquiring write lock (another thread may have grown it)
        entry = mem_pt(mem, page);
        if (entry != NULL) {
            // Already mapped by another thread
            write_wrunlock(&mem->lock);
            read_wrlock(&mem->lock);
            goto have_entry;
        }
#if ANON_MMAP_LIMIT_PAGES > 0
        atomic_fetch_add(&anon_page_count, 1);
#endif
        if (pt_map_nothing(mem, page, 1, P_READ | P_WRITE | P_GROWSDOWN) >= 0)
            mem_changed(mem);
        write_wrunlock(&mem->lock);
        read_wrlock(&mem->lock);

        entry = mem_pt(mem, page);
        goto have_entry;

check_reservation: ;
        struct mem_reservation *res = mem_find_reservation(mem, page);
        if (res == NULL)
            return NULL;
        read_wrunlock(&mem->lock);
        if (in_jit) {
            if (!write_wrtrylock(&mem->lock)) {
                reacquire_read_after_failed_jit_upgrade(&mem->lock);
                return NULL;
            }
        } else {
            write_wrlock(&mem->lock);
        }
        entry = mem_pt(mem, page);
        if (entry == NULL) {
#if ANON_MMAP_LIMIT_PAGES > 0
            atomic_fetch_add(&anon_page_count, 1);
#endif
            if (pt_map_nothing(mem, page, 1, res->flags & ~P_GROWSDOWN) >= 0)
                mem_changed(mem);
        }
        write_wrunlock(&mem->lock);
        read_wrlock(&mem->lock);
        entry = mem_pt(mem, page);
    }

have_entry:
    if (entry != NULL && (type == MEM_WRITE || type == MEM_WRITE_PTRACE)) {
        // if page is unwritable, well tough luck
        if (type != MEM_WRITE_PTRACE && !(entry->flags & P_WRITE))
            return NULL;
        if (type == MEM_WRITE_PTRACE) {
            // TODO: Is P_WRITE really correct? The page shouldn't be writable without ptrace.
            entry->flags |= P_WRITE | P_COW;
        }
        // get rid of any compiled blocks in this page
        asbestos_invalidate_page(mem->mmu.asbestos, page);
        // if page is cow, ~~milk~~ copy it
        if (entry->flags & P_COW) {
            void *copy = mmap(NULL, PAGE_SIZE, PROT_READ | PROT_WRITE,
                    MAP_PRIVATE | MAP_ANONYMOUS, 0, 0);

            read_wrunlock(&mem->lock);
            write_wrlock(&mem->lock);
            // Re-fetch entry after lock upgrade — another thread may have
            // already resolved this CoW while we were waiting for the lock.
            entry = mem_pt(mem, page);
            if (entry != NULL && (entry->flags & P_COW)) {
                void *data = (char *) entry->data->data + entry->offset;
                memcpy(copy, data, PAGE_SIZE);
#if ANON_MMAP_LIMIT_PAGES > 0
                // pt_map will unmap the old page (decrementing anon_page_count),
                // so pre-increment for the new CoW copy to keep balance.
                if (entry->flags & P_ANONYMOUS)
                    atomic_fetch_add(&anon_page_count, 1);
#endif
                pt_map(mem, page, 1, copy, 0, entry->flags &~ P_COW);
                mem_changed(mem);
            } else {
                munmap(copy, PAGE_SIZE);
            }
            write_wrunlock(&mem->lock);
            read_wrlock(&mem->lock);
        }
    }

    void *ptr = mem_ptr_nofault(mem, addr, type);
#ifndef NDEBUG
    assert(old_ptr == NULL || old_ptr == ptr || type == MEM_WRITE_PTRACE);
#endif
    return ptr;
}

static void *mem_mmu_translate(struct mmu *mmu, addr_t addr, int type) {
    // Use mem_ptr instead of mem_ptr_nofault to properly handle:
    // 1. Copy-on-write (COW) pages - need to copy before write
    // 2. Growing stack pages (P_GROWSDOWN)
    return mem_ptr(container_of(mmu, struct mem, mmu), addr, type);
}

static void *mem_mmu_translate_write_nofault(struct mmu *mmu, addr_t addr) {
    return mem_ptr_nofault(container_of(mmu, struct mem, mmu), addr, MEM_WRITE);
}

static struct mmu_ops mem_mmu_ops = {
    .translate = mem_mmu_translate,
    .translate_write_nofault = mem_mmu_translate_write_nofault,
};

int mem_segv_reason(struct mem *mem, addr_t addr) {
    struct pt_entry *pt = mem_pt(mem, PAGE(addr));
    if (pt == NULL)
        return SEGV_MAPERR_;
    return SEGV_ACCERR_;
}

size_t real_page_size;
__attribute__((constructor)) static void get_real_page_size() {
    real_page_size = sysconf(_SC_PAGESIZE);
}

void mem_coredump(struct mem *mem, const char *file) {
    int fd = open(file, O_CREAT | O_RDWR | O_TRUNC, 0666);
    if (fd < 0) {
        perror("open");
        return;
    }
    if (ftruncate(fd, 0xffffffff) < 0) {
        perror("ftruncate");
        return;
    }

    int pages = 0;
    for (page_t page = 0; page < MEM_PAGES; mem_next_page(mem, &page)) {
        struct pt_entry *entry = mem_pt(mem, page);
        if (entry == NULL)
            continue;
        pages++;
        if (lseek(fd, (off_t)(page << PAGE_BITS), SEEK_SET) < 0) {
            perror("lseek");
            return;
        }
        if (write(fd, entry->data->data, PAGE_SIZE) < 0) {
            perror("write");
            return;
        }
    }
    printk("dumped %d pages\n", pages);
    close(fd);
}
