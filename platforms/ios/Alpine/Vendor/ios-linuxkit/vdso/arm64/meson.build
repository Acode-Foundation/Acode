# ARM64 VDSO Build Configuration
#
# The VDSO gets inserted into the address space of emulated processes, so it
# needs to be compiled as an aarch64 ELF shared library. This requires a cross
# compiler and linker.
#
# On macOS, you need an aarch64 cross-compiler toolchain.
# On Linux, you can use the native compiler if running on arm64, or a cross compiler.

# Try to find an aarch64 compiler
clang = find_program('/usr/local/opt/llvm/bin/clang', '/opt/homebrew/opt/llvm/bin/clang', '/opt/local/bin/clang', 'clang', required: false)
has_vdso_compiler = false

if clang.found()
    # Check if the compiler supports aarch64 target
    check_cc = find_program('./check-cc-arm64.sh', required: false)
    if check_cc.found()
        result = run_command(check_cc, clang, check: false)
        if result.returncode() == 0
            has_vdso_compiler = true
        else
            message('ARM64 VDSO: Cross-compiler check failed')
            message(result.stdout() + result.stderr())
        endif
    endif
endif

if has_vdso_compiler
    vdso_compiler = [clang, '-target', 'aarch64-linux-gnu', '-fuse-ld=lld']

    vdso = custom_target('vdso-arm64',
        input: ['vdso.S', 'vdso.c', 'vdso.lds'],
        output: 'libvdso.so.elf',
        command: vdso_compiler + [
            '-o', '@OUTPUT@', '@INPUT0@', '@INPUT1@',
            '-nostdlib', '-Wl,-T,@INPUT2@', '-Wl,--hash-style,sysv',
            '-shared', '-fPIC', '-ffreestanding'
        ] + get_option('vdso_c_args').split())
else
    # Create a dummy vdso target if no complete compiler/linker is available
    # This allows building for ARM64 guest even without a vdso
    message('ARM64 VDSO: No suitable cross-compiler/linker found, VDSO will not be built')
    # Create an empty file as placeholder
    vdso = custom_target('vdso-arm64-stub',
        output: 'libvdso.so.elf',
        command: ['touch', '@OUTPUT@'])
endif
