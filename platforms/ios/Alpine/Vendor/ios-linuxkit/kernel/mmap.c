#include <string.h>
#include <stdatomic.h>
#include "debug.h"
#include "kernel/calls.h"
#include "kernel/errno.h"
#include "kernel/task.h"
#include "fs/fd.h"
#include "kernel/memory.h"
#include "kernel/mm.h"

#if ANON_MMAP_LIMIT_PAGES > 0
_Atomic long anon_page_count;
#endif

struct mm *mm_new() {
    struct mm *mm = malloc(sizeof(struct mm));
    if (mm == NULL)
        return NULL;
    mem_init(&mm->mem);
    mm->start_brk = mm->brk = 0; // should get overwritten by exec
    mm->exefile = NULL;
    mm->refcount = 1;
    return mm;
}

struct mm *mm_copy(struct mm *mm) {
    struct mm *new_mm = malloc(sizeof(struct mm));
    if (new_mm == NULL)
        return NULL;
    *new_mm = *mm;
    // Fix wrlock_init failing because it thinks it's reinitializing the same lock
    memset(&new_mm->mem.lock, 0, sizeof(new_mm->mem.lock));
    new_mm->refcount = 1;
    mem_init(&new_mm->mem);
    fd_retain(new_mm->exefile);
    write_wrlock(&mm->mem.lock);
    pt_copy_on_write(&mm->mem, &new_mm->mem, 0, MEM_PAGES);
    write_wrunlock(&mm->mem.lock);
    return new_mm;
}

void mm_retain(struct mm *mm) {
    mm->refcount++;
}

void mm_release(struct mm *mm) {
    if (--mm->refcount == 0) {
        if (mm->exefile != NULL)
            fd_close(mm->exefile);
        mem_destroy(&mm->mem);
        free(mm);
    }
}

static addr_t do_mmap(addr_t addr, uint64_t len, dword_t prot, dword_t flags, fd_t fd_no, dword_t offset) {
    int err;
    pages_t pages = (len + PAGE_SIZE - 1) / PAGE_SIZE;
    if (!pages) return _EINVAL;
    page_t page;
    bool caller_hint_used = false;
    if (addr != 0) {
        if (PGOFFSET(addr) != 0)
            return _EINVAL;
        page = PAGE(addr);
#ifdef GUEST_ARM64
        // ARM64 has a 48-bit guest page table, so high-address hints are
        // legitimate. Bun/JSC in particular reserves heap/cage regions at
        // high random hints and stores pointers derived from the returned
        // address. Falling back to a low address while the runtime still uses
        // high-derived metadata corrupts allocator freelists. Only reject
        // ranges outside the 48-bit user address space, and protect the low
        // 4GB stack gap from low-address hints.
        if (page > USER_ADDR_MAX_PAGE || pages > USER_ADDR_MAX_PAGE - page ||
                (page < 0x100000 && page + pages > STACK_TOP_PAGE)) {
            if (flags & MMAP_FIXED)
                return _ENOMEM;
            addr = 0;
            page = 0;
        }
#endif
        if (addr != 0 && !(flags & MMAP_FIXED) && !pt_is_hole(current->mem, page, pages))
            addr = 0;
#ifdef GUEST_ARM64
        if (addr != 0 && !(flags & MMAP_FIXED) && mem_range_has_reservation(current->mem, page, pages))
            addr = 0;
#endif
        if (addr != 0)
            caller_hint_used = true;
    }
    if (addr == 0) {
#ifdef GUEST_ARM64
        // Large no-reserve arenas (Bun/JSC heap cages, V8 code ranges, etc.)
        // should live in the 48-bit high address space instead of consuming
        // the scarce low 4GB mmap window. They are lazy reservations, so this
        // costs page-table metadata only as pages are touched.
        if ((flags & MMAP_NORESERVE) && pages >= 0x10000)
            page = pt_find_hole_high(current->mem, pages);
        else
#endif
        page = pt_find_hole(current->mem, pages);
        if (page == BAD_PAGE)
            return _ENOMEM;
    }

    if (flags & MMAP_SHARED)
        prot |= P_SHARED;

    if (flags & MMAP_ANONYMOUS) {
        // PROT_NONE mappings (guard regions) don't consume real memory,
        // so don't count them against the anonymous page limit.
        bool is_prot_none = !(prot & P_READ) && !(prot & P_WRITE) && !(prot & P_EXEC);
#ifdef GUEST_ARM64
        if ((flags & MMAP_NORESERVE) && pages >= 0x10000) {
            if (!caller_hint_used) {
                pages_t align_pages = pages;
                if (align_pages > 0x40000) align_pages = 0x40000;
                page_t aligned = (page / align_pages) * align_pages;
                if (aligned >= MMAP_HOLE_END && pt_is_hole(current->mem, aligned, pages) && !mem_range_has_reservation(current->mem, aligned, pages))
                    page = aligned;
            }
            if (!pt_is_hole(current->mem, page, pages) || mem_range_has_reservation(current->mem, page, pages))
                return _ENOMEM;
            if ((err = pt_map_lazy(current->mem, page, pages, prot)) < 0)
                return err;
            return page << PAGE_BITS;
        }
#endif
#if ANON_MMAP_LIMIT_PAGES > 0
        if (!is_prot_none && atomic_load(&anon_page_count) + (long)pages > ANON_MMAP_LIMIT_PAGES)
            return _ENOMEM;
        if (!is_prot_none)
            atomic_fetch_add(&anon_page_count, (long)pages);
#endif
        if ((err = pt_map_nothing(current->mem, page, pages, prot)) < 0) {
#if ANON_MMAP_LIMIT_PAGES > 0
            if (!is_prot_none)
                atomic_fetch_sub(&anon_page_count, (long)pages);
#endif
            return err;
        }
    } else {
        // fd must be valid
        struct fd *fd = f_get(fd_no);
        if (fd == NULL)
            return _EBADF;
        if (fd->ops->mmap == NULL)
            return _ENODEV;
        if ((err = fd->ops->mmap(fd, current->mem, page, pages, offset, prot, flags)) < 0)
            return err;
        mem_pt(current->mem, page)->data->fd = fd_retain(fd);
        mem_pt(current->mem, page)->data->file_offset = offset;
    }
    return page << PAGE_BITS;
}

static addr_t mmap_common(addr_t addr, dword_t len, dword_t prot, dword_t flags, fd_t fd_no, dword_t offset) {
    STRACE("mmap(0x%x, 0x%x, 0x%x, 0x%x, %d, %d)", addr, len, prot, flags, fd_no, offset);
    if (len == 0)
        return _EINVAL;
    if (prot & ~P_RWX)
        return _EINVAL;
    if ((flags & MMAP_PRIVATE) && (flags & MMAP_SHARED))
        return _EINVAL;

    write_wrlock(&current->mem->lock);
    addr_t res = do_mmap(addr, len, prot, flags, fd_no, offset);
    write_wrunlock(&current->mem->lock);
    return res;
}

addr_t sys_mmap2(addr_t addr, dword_t len, dword_t prot, dword_t flags, fd_t fd_no, dword_t offset) {
    return mmap_common(addr, len, prot, flags, fd_no, offset << PAGE_BITS);
}

#if defined(GUEST_ARM64)
// ARM64 mmap syscall: offset is passed directly (not shifted like mmap2)
// and takes 6 direct arguments.
addr_t sys_mmap64(addr_t addr, addr_t len, dword_t prot, dword_t flags, fd_t fd_no, qword_t offset) {
    STRACE("mmap64(0x%llx, 0x%llx, 0x%x, 0x%x, %d, 0x%llx)", (unsigned long long)addr, (unsigned long long)len, prot, flags, fd_no, (unsigned long long)offset);
    if (len == 0)
        return _EINVAL;
    if (prot & ~P_RWX)
        return _EINVAL;
    if ((flags & MMAP_PRIVATE) && (flags & MMAP_SHARED))
        return _EINVAL;

    write_wrlock(&current->mem->lock);
    addr_t res = do_mmap(addr, len, prot, flags, fd_no, (dword_t)offset);
    write_wrunlock(&current->mem->lock);
    return res;
}
#endif

struct mmap_arg_struct {
    dword_t addr, len, prot, flags, fd, offset;
};

addr_t sys_mmap(addr_t args_addr) {
    struct mmap_arg_struct args;
    if (user_get(args_addr, args))
        return _EFAULT;
    return mmap_common(args.addr, args.len, args.prot, args.flags, args.fd, args.offset);
}

int_t sys_munmap(addr_t addr, addr_t len) {
    STRACE("munmap(0x%llx, 0x%llx)", (unsigned long long)addr, (unsigned long long)len);
    pages_t pages = (len + PAGE_SIZE - 1) / PAGE_SIZE;
    if (PGOFFSET(addr) != 0)
        return _EINVAL;
    if (len == 0)
        return _EINVAL;
    write_wrlock(&current->mem->lock);
    int err = pt_unmap_always(current->mem, PAGE(addr), pages);
    write_wrunlock(&current->mem->lock);
    if (err < 0)
        return _EINVAL;
    return 0;
}

#define MREMAP_MAYMOVE_ 1
#define MREMAP_FIXED_ 2

addr_t sys_mremap(addr_t addr, dword_t old_len, dword_t new_len, dword_t flags) {
    STRACE("mremap(%#x, %#x, %#x, %d)", addr, old_len, new_len, flags);
    if (PGOFFSET(addr) != 0)
        return _EINVAL;
    if (old_len == 0 || new_len == 0)
        return _EINVAL;
    if (flags & ~(MREMAP_MAYMOVE_ | MREMAP_FIXED_))
        return _EINVAL;
    if (flags & MREMAP_FIXED_) {
        FIXME("missing MREMAP_FIXED");
        return _EINVAL;
    }

    page_t start = PAGE(addr);
    pages_t old_pages = PAGE_ROUND_UP(old_len);
    pages_t new_pages = PAGE_ROUND_UP(new_len);
    addr_t result = addr;

    write_wrlock(&current->mem->lock);

    if (new_pages <= old_pages) {
        int err = pt_unmap(current->mem, start + new_pages, old_pages - new_pages);
        if (err < 0)
            result = _EFAULT;
        goto out;
    }

    struct pt_entry *entry = mem_pt(current->mem, start);
    if (entry == NULL) {
        result = _EFAULT;
        goto out;
    }
    dword_t pt_flags = entry->flags;
    for (page_t page = start; page < start + old_pages; page++) {
        entry = mem_pt(current->mem, page);
        if (entry == NULL || entry->flags != pt_flags) {
            result = _EFAULT;
            goto out;
        }
    }
    if (!(pt_flags & P_ANONYMOUS)) {
        FIXME("mremap grow on file mappings");
        result = _EFAULT;
        goto out;
    }
    page_t extra_start = start + old_pages;
    pages_t extra_pages = new_pages - old_pages;
    bool is_prot_none = !(pt_flags & (P_READ | P_WRITE | P_EXEC));
    if (pt_is_hole(current->mem, extra_start, extra_pages)) {
#if ANON_MMAP_LIMIT_PAGES > 0
        if (!is_prot_none && atomic_load(&anon_page_count) + (long)extra_pages > ANON_MMAP_LIMIT_PAGES) {
            result = _ENOMEM;
            goto out;
        }
        if (!is_prot_none)
            atomic_fetch_add(&anon_page_count, (long)extra_pages);
#endif
        int err = pt_map_nothing(current->mem, extra_start, extra_pages, pt_flags);
        if (err < 0) {
#if ANON_MMAP_LIMIT_PAGES > 0
            if (!is_prot_none)
                atomic_fetch_sub(&anon_page_count, (long)extra_pages);
#endif
            result = err;
        }
        goto out;
    }

    if (!(flags & MREMAP_MAYMOVE_)) {
        result = _ENOMEM;
        goto out;
    }

    page_t new_start = pt_find_hole(current->mem, new_pages);
    if (new_start == BAD_PAGE) {
        result = _ENOMEM;
        goto out;
    }
#if ANON_MMAP_LIMIT_PAGES > 0
    if (!is_prot_none && atomic_load(&anon_page_count) + (long)new_pages > ANON_MMAP_LIMIT_PAGES) {
        result = _ENOMEM;
        goto out;
    }
    if (!is_prot_none)
        atomic_fetch_add(&anon_page_count, (long)new_pages);
#endif
    int err = pt_map_nothing(current->mem, new_start, new_pages, pt_flags);
    if (err < 0) {
#if ANON_MMAP_LIMIT_PAGES > 0
        if (!is_prot_none)
            atomic_fetch_sub(&anon_page_count, (long)new_pages);
#endif
        result = err;
        goto out;
    }
    if (!is_prot_none) {
        for (pages_t i = 0; i < old_pages; i++) {
            struct pt_entry *src = mem_pt(current->mem, start + i);
            struct pt_entry *dst = mem_pt(current->mem, new_start + i);
            memcpy((char *)dst->data->data + dst->offset,
                   (char *)src->data->data + src->offset,
                   PAGE_SIZE);
        }
    }
    pt_unmap_always(current->mem, start, old_pages);
    result = new_start << PAGE_BITS;

out:
    write_wrunlock(&current->mem->lock);
    return result;
}

int_t sys_mprotect(addr_t addr, addr_t len, int_t prot) {
    STRACE("mprotect(0x%llx, 0x%llx, 0x%x)", (unsigned long long)addr, (unsigned long long)len, prot);
    if (PGOFFSET(addr) != 0)
        return _EINVAL;
    if (prot & ~P_RWX)
        return _EINVAL;
    pages_t pages = PAGE_ROUND_UP(len);
    write_wrlock(&current->mem->lock);
    int err = pt_set_flags(current->mem, PAGE(addr), pages, prot);
    write_wrunlock(&current->mem->lock);
    return err;
}

dword_t sys_madvise(addr_t addr, dword_t len, dword_t advice) {
    STRACE("madvise(0x%llx, 0x%x, %d)", (unsigned long long)addr, len, advice);
    if (PGOFFSET(addr) != 0)
        return _EINVAL;
    // Linux returns ENOMEM if any page in the range is unmapped. Lazy
    // reservations count as mappings because they represent PROT_NONE VMAs.
    read_wrlock(&current->mem->lock);
    for (page_t page = PAGE(addr); page < PAGE(addr) + PAGE_ROUND_UP(len); page++) {
        if (mem_pt(current->mem, page) == NULL &&
                mem_find_reservation(current->mem, page) == NULL) {
            read_wrunlock(&current->mem->lock);
            return _ENOMEM;
        }
    }
    read_wrunlock(&current->mem->lock);

    // MADV_FREE (8) is purely advisory: the kernel MAY reclaim the pages under
    // memory pressure, but until then reads still return the old contents.
    // Eagerly zeroing them is both wrong (a subsequent read that races the
    // reclaim must see either old-or-zero, never a torn mix) and dangerous
    // under threads — another thread aliasing the page via a live TLB entry
    // would observe it turn to zero mid-computation. JSC's scavenger uses
    // MADV_FREE heavily; treat it as a no-op (safe: we just keep the memory).
    if (advice == 8 /* MADV_FREE */)
        return 0;

    if (advice == 4 /* MADV_DONTNEED */) {
        // Anonymous private pages become zero-fill. File-backed private pages
        // must retain their file contents; zeroing those corrupts mapped
        // executables and caches. Walk under a read lock and skip lazy pages so
        // exit cannot hang behind repeated per-page write-lock acquisition.
        addr_t end = addr + len;
        bool any = false;
        read_wrlock(&current->mem->lock);
        for (addr_t p = addr; p < end; p += PAGE_SIZE) {
            struct pt_entry *pt = mem_pt(current->mem, PAGE(p));
            if (pt == NULL || pt->data == NULL)
                continue;
            if (!(pt->flags & P_ANONYMOUS) && pt->data->fd != NULL)
                continue;
            void *ptr = mem_ptr(current->mem, p, MEM_WRITE);
            if (ptr != NULL) {
                memset(ptr, 0, PAGE_SIZE);
                any = true;
            }
        }
        read_wrunlock(&current->mem->lock);
        if (any)
            mem_changed_pub(current->mem);
    }
    return 0;
}

dword_t sys_mbind(addr_t UNUSED(addr), dword_t UNUSED(len), int_t UNUSED(mode),
        addr_t UNUSED(nodemask), dword_t UNUSED(maxnode), uint_t UNUSED(flags)) {
    return 0;
}

int_t sys_mlock(addr_t UNUSED(addr), dword_t UNUSED(len)) {
    return 0;
}

int_t sys_msync(addr_t UNUSED(addr), dword_t UNUSED(len), int_t UNUSED(flags)) {
    return 0;
}

addr_t sys_brk(addr_t new_brk) {
    STRACE("brk(0x%x)", new_brk);
    struct mm *mm = current->mm;
    write_wrlock(&mm->mem.lock);
    if (new_brk < mm->start_brk)
        goto out;
    addr_t old_brk = mm->brk;

    if (new_brk > old_brk) {
        // expand heap: map region from old_brk to new_brk
        // round up because of the definition of brk: "the first location after the end of the uninitialized data segment." (brk(2))
        // if the brk is 0x2000, page 0x2000 shouldn't be mapped, but it should be if the brk is 0x2001.
        page_t start = PAGE_ROUND_UP(old_brk);
        pages_t size = PAGE_ROUND_UP(new_brk) - PAGE_ROUND_UP(old_brk);
        if (!pt_is_hole(&mm->mem, start, size))
            goto out;
#if ANON_MMAP_LIMIT_PAGES > 0
        if (atomic_load(&anon_page_count) + (long)size > ANON_MMAP_LIMIT_PAGES)
            goto out;
        atomic_fetch_add(&anon_page_count, (long)size);
#endif
        int err = pt_map_nothing(&mm->mem, start, size, P_WRITE);
        if (err < 0) {
#if ANON_MMAP_LIMIT_PAGES > 0
            atomic_fetch_sub(&anon_page_count, (long)size);
#endif
            goto out;
        }
    } else if (new_brk < old_brk) {
        // shrink heap: unmap pages that are entirely above new_brk
        // PAGE_ROUND_UP(new_brk) is the first page we can safely unmap
        // (the page containing new_brk may still have live data below new_brk)
        page_t first_unmap = PAGE_ROUND_UP(new_brk);
        page_t last_unmap = PAGE_ROUND_UP(old_brk);
        if (first_unmap < last_unmap)
            pt_unmap_always(&mm->mem, first_unmap, last_unmap - first_unmap);
    }

    mm->brk = new_brk;
out:;
    addr_t brk = mm->brk;
    write_wrunlock(&mm->mem.lock);
    return brk;
}
