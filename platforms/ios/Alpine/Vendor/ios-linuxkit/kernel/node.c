#include <stdbool.h>
#include "kernel/node.h"
#include "kernel/calls.h"
#include "kernel/errno.h"
#include "fs/fd.h"

#define CACHE_SIZE 8
#define READ_RETRIES 8

struct cached_binary {
    qword_t dev, inode, size;
    dword_t mtime, mtime_nsec;
    uint32_t v8_version;
    bool used;
};

struct binary_reader {
    struct fd *fd;
    bool failed;
};

static lock_t cache_lock = LOCK_INITIALIZER;
static struct cached_binary cache[CACHE_SIZE];
static size_t cache_next;

static uint32_t binary_v8_version(const char *path);
static bool cached_version(const struct statbuf *stat, uint32_t *version);
static bool same_binary(const struct cached_binary *entry, const struct statbuf *stat);
static void remember_version(const struct statbuf *stat, uint32_t version);
static size_t read_binary(void *context, uint8_t *buffer, size_t capacity, uint64_t offset);

size_t node_runtime_args(const char *path, const char **args) {
    return node_runtime_args_for(binary_v8_version(path), args);
}

static uint32_t binary_v8_version(const char *path) {
    struct fd *fd = generic_open(path, O_RDONLY_, 0);
    if (IS_ERR(fd)) return 0;
    uint32_t version = 0;
    struct statbuf stat;
    // Devices such as /dev/zero never reach end of file.
    if (fd->mount->fs->fstat(fd, &stat) == 0 && S_ISREG(stat.mode) && !cached_version(&stat, &version)) {
        struct binary_reader reader = {.fd = fd};
        version = node_v8_version_scan(read_binary, &reader, stat.size);
        if (!reader.failed)
            remember_version(&stat, version);
    }
    fd_close(fd);
    return version;
}

static bool cached_version(const struct statbuf *stat, uint32_t *version) {
    bool found = false;
    lock(&cache_lock);
    for (size_t i = 0; i < CACHE_SIZE && !found; i++) {
        if (same_binary(&cache[i], stat)) {
            *version = cache[i].v8_version;
            found = true;
        }
    }
    unlock(&cache_lock);
    return found;
}

static bool same_binary(const struct cached_binary *entry, const struct statbuf *stat) {
    return entry->used && entry->dev == stat->dev && entry->inode == stat->inode &&
        entry->size == stat->size && entry->mtime == stat->mtime && entry->mtime_nsec == stat->mtime_nsec;
}

static void remember_version(const struct statbuf *stat, uint32_t version) {
    lock(&cache_lock);
    cache[cache_next] = (struct cached_binary) {
        .dev = stat->dev, .inode = stat->inode, .size = stat->size,
        .mtime = stat->mtime, .mtime_nsec = stat->mtime_nsec,
        .v8_version = version, .used = true,
    };
    cache_next = (cache_next + 1) % CACHE_SIZE;
    unlock(&cache_lock);
}

static size_t read_binary(void *context, uint8_t *buffer, size_t capacity, uint64_t offset) {
    struct binary_reader *reader = context;
    if (reader->failed || reader->fd->ops->lseek(reader->fd, offset, SEEK_SET) != (off_t_) offset) {
        reader->failed = true;
        return 0;
    }
    ssize_t count = _EINTR;
    for (int attempt = 0; count == _EINTR && attempt < READ_RETRIES; attempt++)
        count = reader->fd->ops->read(reader->fd, buffer, capacity);
    if (count < 0) reader->failed = true;
    return count > 0 ? (size_t) count : 0;
}
