.text
.global _start
_start:
    ldr x0, [sp]
    cmp x0, #3
    b.ne fail
    ldr x0, [sp, #16]
    ldrb w19, [x0]
    ldr x0, [sp, #24]
    ldrb w0, [x0]
    mov x20, #11
    cmp w0, #'i'
    b.ne configure
    mov x20, #4
configure:
    adr x1, action
    adr x0, handled
    cmp w19, #'i'
    b.ne install
    mov x0, #1
install:
    str x0, [x1]
    mov x0, x20
    mov x2, #0
    mov x3, #8
    mov x8, #134
    svc #0
    cbnz x0, fail

    cmp w19, #'b'
    b.eq block
    cmp w19, #'q'
    b.ne fault
block:
    sub x0, x20, #1
    mov x21, #1
    lsl x21, x21, x0
    adr x1, mask
    str x21, [x1]
    mov x0, #0
    mov x2, #0
    mov x3, #8
    mov x8, #135
    svc #0
    cbnz x0, fail
    cmp w19, #'q'
    b.ne fault

    mov x8, #172
    svc #0
    mov x1, x20
    mov x8, #129
    svc #0
    cbnz x0, fail
    adr x0, pending
    mov x1, #8
    mov x8, #136
    svc #0
    cbnz x0, fail
    adr x0, pending
    ldr x0, [x0]
    cmp x0, x21
    b.ne fail
    mov x0, #1
    adr x1, mask
    mov x2, #0
    mov x3, #8
    mov x8, #135
    svc #0
    b fail
fault:
    cmp x20, #4
    b.eq illegal
    mov x0, #0
    ldrh w1, [x0, #0xba]
    b fail
illegal:
    .inst 0
    b fail
handled:
    mov x0, #42
    b finish
fail:
    mov x0, #1
finish:
    mov x8, #93
    svc #0

.data
.balign 8
action:
    .zero 32
mask:
    .quad 0
pending:
    .quad 0
