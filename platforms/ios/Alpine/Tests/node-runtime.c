#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "kernel/calls.h"
#include "kernel/errno.h"
#include "kernel/node.h"
#include "fs/fd.h"

static int fixture_stat(struct fd *fd, struct statbuf *stat);
static ssize_t fixture_read(struct fd *fd, void *buffer, size_t capacity);
static off_t_ fixture_seek(struct fd *fd, off_t_ offset, int whence);
static void expect_scan(bool known, bool reads);
static void expect_retry(bool *failure);

static const struct fd_ops operations = {.read = fixture_read, .lseek = fixture_seek};
static const struct fs_ops filesystem = {.fstat = fixture_stat};
static struct mount mount = {.fs = &filesystem};
static struct fd descriptor = {.ops = &operations, .mount = &mount};
static struct statbuf metadata = {.dev = 1, .inode = 1, .mode = S_IFREG | 0755, .mtime = 1};
static FILE *fixture;
static bool open_failed, stat_failed, seek_failed, read_failed;
static unsigned reads, seeks, opens, closes, interrupts;

int main(void) {
    fixture = tmpfile();
    assert(fixture);
    const char version[] = "12.4.254.21-node.57";
    assert(fwrite(version, 1, sizeof(version), fixture) == sizeof(version));
    metadata.size = sizeof(version);

    expect_retry(&open_failed);
    expect_retry(&stat_failed);
    expect_retry(&seek_failed);
    expect_retry(&read_failed);

    for (size_t i = 0; i < 3; i++) {
        const mode_t modes[] = {S_IFCHR, S_IFIFO, S_IFDIR};
        metadata.inode++;
        metadata.mode = modes[i] | 0755;
        unsigned previous_seeks = seeks;
        expect_scan(false, false);
        assert(seeks == previous_seeks);
        metadata.mode = S_IFREG | 0755;
        expect_scan(true, true);
    }

    expect_scan(true, false);
    metadata.dev++;
    expect_scan(true, true);
    metadata.inode++;
    expect_scan(true, true);
    metadata.size--;
    expect_scan(true, true);
    metadata.mtime++;
    expect_scan(true, true);
    metadata.mtime_nsec++;
    expect_scan(true, true);

    metadata.inode++;
    interrupts = 2;
    expect_scan(true, true);
    assert(interrupts == 0);
    metadata.inode++;
    interrupts = 100;
    unsigned previous_reads = reads;
    expect_scan(false, true);
    assert(reads - previous_reads == 8);
    interrupts = 0;
    expect_scan(true, true);
    expect_scan(true, false);

    // A successful markerless scan is cached; replacing it invalidates the entry.
    rewind(fixture);
    char empty[sizeof(version)] = {0};
    assert(fwrite(empty, 1, sizeof(empty), fixture) == sizeof(empty));
    metadata.mtime++;
    expect_scan(false, true);
    expect_scan(false, false);
    rewind(fixture);
    assert(fwrite(version, 1, sizeof(version), fixture) == sizeof(version));
    metadata.mtime++;
    expect_scan(true, true);

    assert(opens == closes);
    fclose(fixture);
    puts("NODE_RUNTIME_PASS");
}

struct fd *generic_open(const char *path, int flags, int mode) {
    assert(strcmp(path, "/fixture/node") == 0);
    assert(flags == O_RDONLY_ && mode == 0);
    if (open_failed) return ERR_PTR(_ENOENT);
    opens++;
    return &descriptor;
}

int fd_close(struct fd *fd) {
    assert(fd == &descriptor);
    closes++;
    return 0;
}

static int fixture_stat(struct fd *fd, struct statbuf *stat) {
    assert(fd == &descriptor);
    if (stat_failed) return _EIO;
    *stat = metadata;
    return 0;
}

static ssize_t fixture_read(struct fd *fd, void *buffer, size_t capacity) {
    assert(fd == &descriptor);
    reads++;
    if (interrupts) {
        interrupts--;
        return _EINTR;
    }
    if (read_failed) return _EIO;
    return fread(buffer, 1, capacity, fixture);
}

static off_t_ fixture_seek(struct fd *fd, off_t_ offset, int whence) {
    assert(fd == &descriptor && whence == SEEK_SET);
    seeks++;
    if (seek_failed) return _ESPIPE;
    assert(fseek(fixture, offset, whence) == 0);
    return offset;
}

static void expect_scan(bool known, bool reads_expected) {
    unsigned previous_reads = reads;
    const char *args[NODE_RUNTIME_ARGS_MAX];
    size_t count = node_runtime_args("/fixture/node", args);
    assert(count == (known ? NODE_RUNTIME_ARGS_MAX : NODE_RUNTIME_ARGS_MAX - 2));
    assert((reads > previous_reads) == reads_expected);
}

static void expect_retry(bool *failure) {
    metadata.inode++;
    *failure = true;
    expect_scan(false, failure == &read_failed);
    *failure = false;
    expect_scan(true, true);
    expect_scan(true, false);
}
