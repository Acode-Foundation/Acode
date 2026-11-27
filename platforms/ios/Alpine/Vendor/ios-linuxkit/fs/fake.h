#ifndef ISH_INTERNAL
#error "for internal use only"
#endif

#ifndef FS_FAKE_H
#define FS_FAKE_H

#include <stdbool.h>
#include <stddef.h>
#include "kernel/fs.h"
#include "fs/fake-db.h"
#include "misc.h"

struct fd *fakefs_open_inode(struct mount *mount, ino_t inode);

/* Bind mount API — redirect a fakefs path to an external host directory.
 * Creates a symlink in data/ and auto-creates meta.db entries on access.
 * Can be called from Swift/ObjC after the kernel has booted.
 *
 * `read_only`: when true, the top-level mount directory's meta.db entry is
 * written with mode 0555 (dr-xr-xr-x) instead of 0755, so iSH's generic
 * N_PARENT_DIR_WRITE check rejects any create/unlink/rename/rmdir with
 * EACCES at the normal access-check layer — no special fakefs plumbing
 * required. Existing writable mounts should pass `false`. */
int fakefs_bind_mount(const char *linux_path, const char *host_path, bool read_only);
int fakefs_bind_unmount(const char *linux_path);

/* Translate a resolved host path back to a Linux path via bind mount table.
 * Returns true and writes to out_path if a match was found. */
bool fakefs_bind_mount_resolve_path(const char *resolved, char *out_path, size_t out_size);

/* Translate a Linux (guest) path to its resolved host path via bind mount
 * table. Returns true and writes to out_path on a match. Used by native
 * offload handlers that execute on the host but receive guest paths. */
bool fakefs_bind_mount_translate_path(const char *path, char *out_path, size_t out_size);

#endif
