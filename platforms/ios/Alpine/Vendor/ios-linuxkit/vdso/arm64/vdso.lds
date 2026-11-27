/*
 * ARM64 VDSO Linker Script
 *
 * This script controls the layout of the VDSO shared library.
 * The VDSO is mapped into the guest process's address space
 * and provides fast paths for certain system calls.
 */

SECTIONS
{
    . = SIZEOF_HEADERS;

    .hash           : { *(.hash) }          :text
    .gnu.hash       : { *(.gnu.hash) }
    .dynsym         : { *(.dynsym) }
    .dynstr         : { *(.dynstr) }
    .gnu.version    : { *(.gnu.version) }
    .gnu.version_d  : { *(.gnu.version_d) }
    .gnu.version_r  : { *(.gnu.version_r) }

    .dynamic        : { *(.dynamic) }       :text   :dynamic

    .rodata         : { *(.rodata*) }       :text

    .note           : { *(.note*) }         :text   :note

    .eh_frame_hdr   : { *(.eh_frame_hdr) }  :text   :eh_frame_hdr
    .eh_frame       : { KEEP(*(.eh_frame)) } :text

    .text           : {
        *(.text*)
    }                                       :text   =0xd503201f

    .data           : {
        *(.data*)
        *(.sdata*)
        *(.got.plt)
        *(.got)
        *(.bss*)
    }                                       :text

    /DISCARD/       : {
        *(.note.GNU-stack)
        *(.interp)
    }
}

/*
 * Program headers
 */
PHDRS
{
    /* Include ELF/PHDR in the load segment so p_vaddr starts at 0 */
    text            PT_LOAD     FLAGS(5) FILEHDR PHDRS;   /* PF_R|PF_X */
    dynamic         PT_DYNAMIC  FLAGS(4);                /* PF_R */
    note            PT_NOTE     FLAGS(4);                /* PF_R */
    eh_frame_hdr    PT_GNU_EH_FRAME;
}

/*
 * Version script - defines the symbols exported by the VDSO
 */
VERSION
{
    LINUX_2.6.39 {
        global:
            __kernel_rt_sigreturn;
            __kernel_clock_gettime;
            __kernel_clock_getres;
            __kernel_gettimeofday;
        local:
            *;
    };
}
