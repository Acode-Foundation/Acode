#define _GNU_SOURCE
#include <sys/sysinfo.h>
#include <sys/syscall.h>
#include <sys/resource.h>
#include <errno.h>
#include <linux/random.h>
#include <pthread.h>
#include <unistd.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "platform/platform.h"
#include "debug.h"

static void read_proc_line(const char *file, const char *name, char *buf) {
    FILE *f = fopen(file, "r");
    if (f == NULL) ERRNO_DIE(file);
    do {
        fgets(buf, 1234, f);
        if (feof(f))
            die("could not find proc line %s", name);
    } while (!(strncmp(name, buf, strlen(name)) == 0 && buf[strlen(name)] == ' '));
    fclose(f);
}

struct cpu_usage get_cpu_usage() {
    struct cpu_usage usage = {};
    char buf[1234];
    read_proc_line("/proc/stat", "cpu", buf);
    uint64_t user, nice, system, idle;
    if (sscanf(buf, "cpu %"SCNu64" %"SCNu64" %"SCNu64" %"SCNu64, &user, &nice, &system, &idle) != 4)
        die("could not parse /proc/stat cpu line");
    usage.user_ticks = user;
    usage.nice_ticks = nice;
    usage.system_ticks = system;
    usage.idle_ticks = idle;
    return usage;
}

static uint64_t parse_proc_meminfo_kib(const char *name) {
    char buf[1234];
    uint64_t kib;
    read_proc_line("/proc/meminfo", name, buf);
    if (sscanf(buf + strlen(name), " %"SCNu64" kB", &kib) != 1)
        die("could not parse proc meminfo line %s", name);
    return kib * 1024;
}

struct mem_usage get_mem_usage() {
    return (struct mem_usage) {
        .total = parse_proc_meminfo_kib("MemTotal:"),
        .free = parse_proc_meminfo_kib("MemFree:"),
        .active = parse_proc_meminfo_kib("Active:"),
        .inactive = parse_proc_meminfo_kib("Inactive:"),
    };
}

struct uptime_info get_uptime() {
    struct sysinfo info;
    sysinfo(&info);
    struct uptime_info uptime = {
        .uptime_ticks = info.uptime,
        .load_1m = info.loads[0],
        .load_5m = info.loads[1],
        .load_15m = info.loads[2],
    };
    return uptime;
}

struct platform_sysinfo platform_get_sysinfo(void) {
    struct sysinfo host_info = {};
    sysinfo(&host_info);
    return (struct platform_sysinfo) {
        .totalram = host_info.totalram,
        .freeram = host_info.freeram,
        .sharedram = host_info.sharedram,
        .totalswap = host_info.totalswap,
        .freeswap = host_info.freeswap,
        .totalhigh = host_info.totalhigh,
        .freehigh = host_info.freehigh,
        .procs = host_info.procs,
        .mem_unit = host_info.mem_unit,
    };
}

struct platform_thread_cpu_usage platform_get_thread_cpu_usage(void) {
    struct rusage usage = {};
    int err = getrusage(RUSAGE_THREAD, &usage);
    assert(err == 0);
    return (struct platform_thread_cpu_usage) {
        .user_sec = usage.ru_utime.tv_sec,
        .user_usec = usage.ru_utime.tv_usec,
        .system_sec = usage.ru_stime.tv_sec,
        .system_usec = usage.ru_stime.tv_usec,
    };
}

int platform_fd_get_path(int fd, char *out, size_t out_size) {
    if (out_size == 0)
        return -1;
    char proc_path[64];
    snprintf(proc_path, sizeof(proc_path), "/proc/self/fd/%d", fd);
    ssize_t n = readlink(proc_path, out, out_size - 1);
    if (n < 0)
        return -1;
    out[n] = '\0';
    return 0;
}

uint64_t platform_stat_atime_sec(const struct stat *st) { return st->st_atim.tv_sec; }
uint64_t platform_stat_mtime_sec(const struct stat *st) { return st->st_mtim.tv_sec; }
uint64_t platform_stat_ctime_sec(const struct stat *st) { return st->st_ctim.tv_sec; }
long platform_stat_atime_nsec(const struct stat *st) { return st->st_atim.tv_nsec; }
long platform_stat_mtime_nsec(const struct stat *st) { return st->st_mtim.tv_nsec; }
long platform_stat_ctime_nsec(const struct stat *st) { return st->st_ctim.tv_nsec; }

int platform_get_random_bytes(char *buf, size_t len) {
    while (len > 0) {
        ssize_t n = syscall(SYS_getrandom, buf, len, 0);
        if (n < 0) {
            if (errno == EINTR)
                continue;
            return -1;
        }
        if (n == 0)
            return -1;
        buf += n;
        len -= (size_t)n;
    }
    return 0;
}

int platform_create_shared_memory_fd(size_t size) {
    char path[] = "/tmp/ish-shm-XXXXXX";
    int fd = mkstemp(path);
    if (fd < 0)
        return -1;
    unlink(path);
    if (ftruncate(fd, (off_t) size) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

void platform_set_thread_name(const char *name) {
    char short_name[16];
    snprintf(short_name, sizeof(short_name), "%s", name);
    pthread_setname_np(pthread_self(), short_name);
}

void platform_release_thread_memory_pressure(void) {
    // No portable Linux equivalent; glibc/musl release thread caches during
    // normal pthread teardown.
}
