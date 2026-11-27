#ifndef PLATFORM_H
#define PLATFORM_H
#include <stddef.h>
#include <sys/stat.h>
#include "misc.h"

// CPU counters are USER_HZ-style jiffies. Uptime is seconds, matching the
// Linux sysinfo ABI; /proc formats it as decimal seconds at presentation time.
struct cpu_usage {
    uint64_t user_ticks;
    uint64_t system_ticks;
    uint64_t idle_ticks;
    uint64_t nice_ticks;
};
struct cpu_usage get_cpu_usage(void);

struct mem_usage {
    uint64_t total;
    uint64_t free;
    uint64_t active;
    uint64_t inactive;
};
struct mem_usage get_mem_usage(void);

struct uptime_info {
    uint64_t uptime_ticks;
    uint64_t load_1m, load_5m, load_15m;
};
struct uptime_info get_uptime(void);

struct platform_sysinfo {
    uint64_t totalram;
    uint64_t freeram;
    uint64_t sharedram;
    uint64_t totalswap;
    uint64_t freeswap;
    uint64_t totalhigh;
    uint64_t freehigh;
    uint32_t procs;
    uint32_t mem_unit;
};
struct platform_sysinfo platform_get_sysinfo(void);

struct platform_thread_cpu_usage {
    uint64_t user_sec;
    uint64_t user_usec;
    uint64_t system_sec;
    uint64_t system_usec;
};
struct platform_thread_cpu_usage platform_get_thread_cpu_usage(void);

// Guest-visible CPU topology. Keep this deterministic instead of mirroring the
// host CPU count: exposing all host cores makes modern runtimes (Bun/JSC/V8) fan
// out too aggressively for the emulator.
#ifndef PLATFORM_GUEST_CPU_COUNT
#define PLATFORM_GUEST_CPU_COUNT 4
#endif

// Host OS shims. Keep Linux/macOS/iOS API differences behind platform/* so
// emulator/kernel code can include one stable interface.
int platform_fd_get_path(int fd, char *out, size_t out_size);
uint64_t platform_stat_atime_sec(const struct stat *st);
uint64_t platform_stat_mtime_sec(const struct stat *st);
uint64_t platform_stat_ctime_sec(const struct stat *st);
long platform_stat_atime_nsec(const struct stat *st);
long platform_stat_mtime_nsec(const struct stat *st);
long platform_stat_ctime_nsec(const struct stat *st);
int platform_get_random_bytes(char *buf, size_t len);
int platform_create_shared_memory_fd(size_t size);
void platform_set_thread_name(const char *name);
void platform_release_thread_memory_pressure(void);

#endif
