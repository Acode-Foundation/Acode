#ifndef FS_STAT_H
#define FS_STAT_H

#include "misc.h"

struct statbuf {
    qword_t dev;
    qword_t inode;
    dword_t mode;
    dword_t nlink;
    dword_t uid;
    dword_t gid;
    qword_t rdev;
    qword_t size;
    dword_t blksize;
    qword_t blocks;
    dword_t atime;
    dword_t atime_nsec;
    dword_t mtime;
    dword_t mtime_nsec;
    dword_t ctime;
    dword_t ctime_nsec;
};

// ARM64 stat struct (128 bytes)
// Based on Linux kernel include/uapi/asm-generic/stat.h
// Used by fstatat (syscall 79) on ARM64
// Note: Using atime_/mtime_/ctime_ to avoid macOS macro conflicts
struct stat_arm64 {
    qword_t dev;                // Device (offset 0)
    qword_t ino;                // File serial number (offset 8)
    dword_t mode;               // File mode (offset 16)
    dword_t nlink;              // Link count (offset 20)
    dword_t uid;                // User ID of file's owner (offset 24)
    dword_t gid;                // Group ID of file's group (offset 28)
    qword_t rdev;               // Device number, if device (offset 32)
    qword_t __pad1;             // padding (offset 40)
    sqword_t size;              // Size of file, in bytes (offset 48)
    sdword_t blksize;           // Optimal block size for I/O (offset 56)
    sdword_t __pad2;            // padding (offset 60)
    sqword_t blocks;            // Number 512-byte blocks allocated (offset 64)
    sqword_t atime_;            // Time of last access (offset 72)
    qword_t atime_nsec;         // (offset 80)
    sqword_t mtime_;            // Time of last modification (offset 88)
    qword_t mtime_nsec;         // (offset 96)
    sqword_t ctime_;            // Time of last status change (offset 104)
    qword_t ctime_nsec;         // (offset 112)
    dword_t __unused4;          // (offset 120)
    dword_t __unused5;          // (offset 124)
};  // Total: 128 bytes

struct statfsbuf {
    long type;
    long bsize;
    uint64_t blocks;
    uint64_t bfree;
    uint64_t bavail;
    uint64_t files;
    uint64_t ffree;
    uint64_t fsid;
    long namelen;
    long frsize;
    long flags;
    long spare[4];
};

struct statfs_ {
    uint_t type;
    uint_t bsize;
    uint_t blocks;
    uint_t bfree;
    uint_t bavail;
    uint_t files;
    uint_t ffree;
    uint64_t fsid;
    uint_t namelen;
    uint_t frsize;
    uint_t flags;
    uint_t spare[4];
} __attribute__((packed));

struct statfs64_ {
    uint_t type;
    uint_t bsize;
    uint64_t blocks;
    uint64_t bfree;
    uint64_t bavail;
    uint64_t files;
    uint64_t ffree;
    uint64_t fsid;
    uint_t namelen;
    uint_t frsize;
    uint_t flags;
    uint_t pad[4];
} __attribute__((packed));

// ARM64 statfs structure - uses 64-bit fields throughout
// This matches the kernel's statfs structure for LP64 architectures
// Note: fsid_t is still { int val[2]; } = 8 bytes, not 16
struct statfs_arm64_ {
    uint64_t type;      // f_type
    uint64_t bsize;     // f_bsize
    uint64_t blocks;    // f_blocks
    uint64_t bfree;     // f_bfree
    uint64_t bavail;    // f_bavail
    uint64_t files;     // f_files
    uint64_t ffree;     // f_ffree
    int32_t fsid[2];    // f_fsid - __kernel_fsid_t is struct { int val[2]; } = 8 bytes
    uint64_t namelen;   // f_namelen
    uint64_t frsize;    // f_frsize
    uint64_t flags;     // f_flags
    uint64_t spare[4];  // f_spare
};

struct statx_timestamp_ {
    int64_t sec;
    uint32_t nsec;
    uint32_t _pad;
};

struct statx_ {
    uint32_t mask;
    uint32_t blksize;
    uint64_t attributes;
    uint32_t nlink;
    uint32_t uid;
    uint32_t gid;
    uint16_t mode;
    uint16_t _pad1;
    uint64_t ino;
    uint64_t size;
    uint64_t blocks;
    uint64_t attributes_mask;
    struct statx_timestamp_ atime;
    struct statx_timestamp_ btime;
    struct statx_timestamp_ ctime;
    struct statx_timestamp_ mtime;
    uint32_t rdev_major;
    uint32_t rdev_minor;
    uint32_t dev_major;
    uint32_t dev_minor;
    uint64_t mnt_id;
    uint32_t dio_mem_align;
    uint32_t dio_offset_align;
    uint32_t _pad2[24];
} __attribute__((packed));

#define STATX_BASIC_STATS_ 0x7ff

#endif
