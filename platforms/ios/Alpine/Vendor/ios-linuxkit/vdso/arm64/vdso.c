/*
 * ARM64 VDSO (Virtual Dynamic Shared Object)
 *
 * The VDSO is a small shared library that the kernel maps into the address
 * space of all user processes. It provides fast implementations of certain
 * system calls that don't require a full context switch.
 *
 * For ARM64 Linux, the VDSO provides:
 * - __kernel_gettimeofday
 * - __kernel_clock_gettime
 * - __kernel_clock_getres
 * - __kernel_rt_sigreturn
 *
 * In iSH, we implement these as simple wrappers that invoke the SVC #0
 * instruction to perform the actual system call.
 */

#include <stddef.h>
#include <stdint.h>

// ARM64 uses SVC #0 for system calls
// Syscall number goes in x8, arguments in x0-x5, return value in x0

// ARM64 Linux syscall numbers
#define __NR_clock_gettime  113
#define __NR_clock_getres   114
#define __NR_gettimeofday   169
#define __NR_rt_sigreturn   139

// Clock IDs
#define CLOCK_REALTIME      0
#define CLOCK_MONOTONIC     1

struct timespec {
    long tv_sec;
    long tv_nsec;
};

struct timeval {
    long tv_sec;
    long tv_usec;
};

struct timezone {
    int tz_minuteswest;
    int tz_dsttime;
};

// Inline syscall helper
static inline long syscall0(long n) {
    register long x8 __asm__("x8") = n;
    register long x0 __asm__("x0");
    __asm__ volatile("svc #0" : "=r"(x0) : "r"(x8) : "memory");
    return x0;
}

static inline long syscall1(long n, long a0) {
    register long x8 __asm__("x8") = n;
    register long x0 __asm__("x0") = a0;
    __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8) : "memory");
    return x0;
}

static inline long syscall2(long n, long a0, long a1) {
    register long x8 __asm__("x8") = n;
    register long x0 __asm__("x0") = a0;
    register long x1 __asm__("x1") = a1;
    __asm__ volatile("svc #0" : "+r"(x0) : "r"(x1), "r"(x8) : "memory");
    return x0;
}

// VDSO function implementations
int __vdso_clock_gettime(int clk, struct timespec *ts) {
    return syscall2(__NR_clock_gettime, clk, (long)ts);
}

int __vdso_gettimeofday(struct timeval *tv, struct timezone *tz) {
    return syscall2(__NR_gettimeofday, (long)tv, (long)tz);
}

int __vdso_clock_getres(int clk, struct timespec *res) {
    return syscall2(__NR_clock_getres, clk, (long)res);
}

void __vdso_rt_sigreturn(void) {
    syscall0(__NR_rt_sigreturn);
    __builtin_unreachable();
}

// Version symbol (required by glibc)
const char vdso_version[] __attribute__((section(".data"))) = "LINUX_2.6.39";

// Weak aliases for the kernel entry points
__attribute__((weak, alias("__vdso_clock_gettime")))
int __kernel_clock_gettime(int clk, struct timespec *ts);

__attribute__((weak, alias("__vdso_gettimeofday")))
int __kernel_gettimeofday(struct timeval *tv, struct timezone *tz);

__attribute__((weak, alias("__vdso_clock_getres")))
int __kernel_clock_getres(int clk, struct timespec *res);

__attribute__((weak, alias("__vdso_rt_sigreturn")))
void __kernel_rt_sigreturn(void);
