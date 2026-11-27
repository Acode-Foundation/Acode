/*
 * ARM64 VDSO assembly code
 *
 * This provides the low-level entry points for the VDSO functions.
 * The actual implementations are in vdso.c, but we need assembly
 * wrappers to ensure the correct ABI is used.
 */

    .text

/*
 * Signal return trampolines
 *
 * These are used by the kernel to return from signal handlers.
 * The sigreturn call restores the process state that was saved
 * when the signal was delivered.
 */

    .globl __kernel_rt_sigreturn
    .type __kernel_rt_sigreturn, @function
    .align 4
__kernel_rt_sigreturn:
    mov x8, #139        // __NR_rt_sigreturn
    svc #0
    // Never returns
    .size __kernel_rt_sigreturn, . - __kernel_rt_sigreturn

/*
 * Simple syscall wrappers
 * These are fallback implementations if the C versions can't be used
 */

    .globl __vdso_clock_gettime_asm
    .type __vdso_clock_gettime_asm, @function
    .align 4
__vdso_clock_gettime_asm:
    // x0 = clockid, x1 = timespec*
    mov x8, #113        // __NR_clock_gettime
    svc #0
    ret
    .size __vdso_clock_gettime_asm, . - __vdso_clock_gettime_asm

    .globl __vdso_gettimeofday_asm
    .type __vdso_gettimeofday_asm, @function
    .align 4
__vdso_gettimeofday_asm:
    // x0 = timeval*, x1 = timezone*
    mov x8, #169        // __NR_gettimeofday
    svc #0
    ret
    .size __vdso_gettimeofday_asm, . - __vdso_gettimeofday_asm

    .globl __vdso_clock_getres_asm
    .type __vdso_clock_getres_asm, @function
    .align 4
__vdso_clock_getres_asm:
    // x0 = clockid, x1 = timespec*
    mov x8, #114        // __NR_clock_getres
    svc #0
    ret
    .size __vdso_clock_getres_asm, . - __vdso_clock_getres_asm
