.text
.global _start
_start:
    adr x0, values
    adr x1, result
    mov x8, #2

.macro check_result
    ldp x10, x11, [x0]
    ldp x12, x13, [x1]
    cmp x10, x12
    b.ne fail
    cmp x11, x13
    b.ne fail
.endm

.macro load_lanes mode
    movi v0.16b, #0
    mov x9, x0
    .irp lane, 0, 1, 2, 3, 4, 5, 6, 7
        .if \mode == 0
            ld1 {v0.h}[\lane], [x9]
            add x9, x9, #2
        .elseif \mode == 1
            ld1 {v0.h}[\lane], [x9], #2
        .else
            ld1 {v0.h}[\lane], [x9], x8
        .endif
    .endr
    str q0, [x1]
    check_result
.endm

.macro store_lanes mode
    ldr q0, [x0]
    stp xzr, xzr, [x1]
    mov x9, x1
    .irp lane, 0, 1, 2, 3, 4, 5, 6, 7
        .if \mode == 0
            st1 {v0.h}[\lane], [x9]
            add x9, x9, #2
        .elseif \mode == 1
            st1 {v0.h}[\lane], [x9], #2
        .else
            st1 {v0.h}[\lane], [x9], x8
        .endif
    .endr
    check_result
.endm

    load_lanes 0
    load_lanes 1
    load_lanes 2
    store_lanes 0
    store_lanes 1
    store_lanes 2

    adr x1, pass_text
    mov x2, #9
    mov x3, #0
    b finish
fail:
    adr x1, fail_text
    mov x2, #9
    mov x3, #1
finish:
    mov x0, #1
    mov x8, #64
    svc #0
    mov x0, x3
    mov x8, #93
    svc #0

.data
.balign 16
values:
    .hword 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x8888
result:
    .zero 16
pass_text:
    .ascii "SIMD_PASS"
fail_text:
    .ascii "SIMD_FAIL"
