project('ish', 'c',
    default_options: ['default_library=static', 'c_std=gnu11', 'warning_level=2'])
cc = meson.get_compiler('c')

if cc.get_id() == 'clang'
    add_project_arguments('-Wimplicit-fallthrough', '-Wtautological-constant-in-range-compare', language: 'c')
endif

if get_option('b_sanitize').split(',').contains('undefined')
    add_project_arguments('-fno-sanitize=alignment', language: 'c')
endif

log_on = get_option('log').split()
log_off = get_option('nolog').split()
foreach channel : log_on + log_off
    if log_on.contains(channel)
        add_project_arguments('-DDEBUG_' + channel + '=1', language: 'c')
    else
        add_project_arguments('-DDEBUG_' + channel + '=0', language: 'c')
    endif
endforeach
add_project_arguments('-DLOG_HANDLER_' + get_option('log_handler').to_upper() + '=1', language: 'c')
add_project_arguments('-DENGINE_' + get_option('engine').to_upper() + '=1', language: 'c')

guest_arch = get_option('guest_arch')
if guest_arch != 'arm64'
    error('Only the ARM64 guest backend is supported')
endif
add_project_arguments('-DGUEST_ARM64=1', language: 'c')

if get_option('no_crlf')
    add_project_arguments('-DNO_CRLF', language: 'c')
endif

add_project_arguments('-Wno-switch', language: 'c')

includes = [include_directories('.')]

threads = dependency('threads')
librt = cc.find_library('rt', required: false)
libm = cc.find_library('m', required: false)
libdl = cc.find_library('dl', required: false)
sqlite3 = cc.find_library('sqlite3')
dependencies = [librt, libm, libdl, threads, sqlite3]

subdir('vdso/arm64')
vdso_inc = include_directories('vdso/arm64')
includes += vdso_inc

offsets = custom_target('offsets',
    output: 'cpu-offsets.h', input: 'asbestos/offsets.c', depfile: 'cpu-offsets.h.d',
    command: [find_program('tools/staticdefine.sh'), '@OUTDIR@/compile_commands.json', '@INPUT@', '@OUTPUT@', '@DEPFILE@'])

# Common emu sources
emu_src = [
    'emu/tlb.c',
]

gadgets = 'asbestos/guest-arm64/gadgets-' + host_machine.cpu_family()
emu_src += [
    'emu/arch/arm64/fpu.c',
    'asbestos/asbestos.c',
    'asbestos/guest-arm64/gen.c',
    'asbestos/guest-arm64/crypto_helpers.c',
    'asbestos/helpers.c',
    gadgets+'/entry.S',
    gadgets+'/memory.S',
    gadgets+'/control.S',
    gadgets+'/math.S',
    gadgets+'/bits.S',
    gadgets+'/crypto.S',
    offsets,
]

libish_emu = library('ish_emu', emu_src, include_directories: includes)

libfakefs = library('fakefs',
    ['fs/fake-db.c', 'fs/fake-migrate.c', 'fs/fake-rebuild.c'],
    include_directories: includes,
    dependencies: sqlite3)

subdir('deps')

if get_option('kernel') == 'ish'
    if get_option('engine') != 'asbestos'
        error('Only asbestos is supported with ish kernel')
    endif

    arch_kernel_src = ['kernel/arch/arm64/calls.c']

    src = [
        'kernel/init.c',
        'kernel/errno.c',

        'kernel/calls.c',] + arch_kernel_src + [
        'kernel/memory.c',
        'kernel/user.c',
        'kernel/vdso.c', vdso,
        'kernel/task.c',
        'kernel/group.c',
        'kernel/log.c',

        'kernel/fork.c',
        'kernel/exec.c',
        'kernel/exit.c',
        'kernel/time.c',
        'kernel/mmap.c',
        'kernel/uname.c',
        'kernel/tls.c',
        'kernel/futex.c',
        'kernel/getset.c',
        'kernel/signal.c',
        'kernel/resource.c',
        'kernel/random.c',
        'kernel/misc.c',
        'kernel/eventfd.c',
        'kernel/pidfd.c',
        'kernel/inotify.c',
        'kernel/ipc.c',
        'kernel/ptrace.c',
        'kernel/native_offload.c',

        'kernel/fs.c',
        'kernel/fs_info.c',
        'fs/mount.c',
        'fs/fd.c',
        'fs/inode.c',
        'fs/stat.c',
        'fs/dir.c',
        'fs/generic.c',
        'fs/path.c',
        'fs/real.c',
        'fs/fake.c',

        'fs/proc.c',
        'fs/proc/entry.c',
        'fs/proc/ish.c',
        'fs/proc/net.c',
        'fs/proc/root.c',
        'fs/proc/pid.c',

        'fs/dyndev.c',

        'fs/adhoc.c',
        'fs/sock.c',
        'fs/pipe.c',
        'fs/sockrestart.c',
        'fs/lock.c',

        'fs/dev.c',
        'fs/mem.c',
        'fs/tty.c',
        'fs/tty-real.c',
        'fs/pty.c',
        'fs/tmp.c',

        'fs/poll.c',
        'kernel/poll.c',
        'kernel/epoll.c',

        'util/timer.c',
        'util/sync.c',
        'util/fifo.c',
        'util/fchdir.c',

        'platform/' + host_machine.system() + '.c',
    ]

    libish = library('ish', src,
        include_directories: includes)
    ish = declare_dependency(
        link_with: [libish, libish_emu, libfakefs],
        dependencies: dependencies,
        include_directories: includes)

    if not meson.is_cross_build()
        executable('ish', ['main.c'], dependencies: ish)
    endif

else
    error('Only the ish kernel is supported')
endif

if not meson.is_cross_build()
    subdir('tools')
endif

if meson.is_cross_build()
    archive_sources = [
        'deps/libarchive/libarchive/archive_acl.c',
        'deps/libarchive/libarchive/archive_blake2s_ref.c',
        'deps/libarchive/libarchive/archive_blake2sp_ref.c',
        'deps/libarchive/libarchive/archive_check_magic.c',
        'deps/libarchive/libarchive/archive_cmdline.c',
        'deps/libarchive/libarchive/archive_cryptor.c',
        'deps/libarchive/libarchive/archive_digest.c',
        'deps/libarchive/libarchive/archive_disk_acl_darwin.c',
        'deps/libarchive/libarchive/archive_disk_acl_freebsd.c',
        'deps/libarchive/libarchive/archive_disk_acl_linux.c',
        'deps/libarchive/libarchive/archive_disk_acl_sunos.c',
        'deps/libarchive/libarchive/archive_entry.c',
        'deps/libarchive/libarchive/archive_entry_copy_bhfi.c',
        'deps/libarchive/libarchive/archive_entry_copy_stat.c',
        'deps/libarchive/libarchive/archive_entry_link_resolver.c',
        'deps/libarchive/libarchive/archive_entry_sparse.c',
        'deps/libarchive/libarchive/archive_entry_stat.c',
        'deps/libarchive/libarchive/archive_entry_strmode.c',
        'deps/libarchive/libarchive/archive_entry_xattr.c',
        'deps/libarchive/libarchive/archive_getdate.c',
        'deps/libarchive/libarchive/archive_hmac.c',
        'deps/libarchive/libarchive/archive_match.c',
        'deps/libarchive/libarchive/archive_options.c',
        'deps/libarchive/libarchive/archive_pack_dev.c',
        'deps/libarchive/libarchive/archive_pathmatch.c',
        'deps/libarchive/libarchive/archive_ppmd7.c',
        'deps/libarchive/libarchive/archive_ppmd8.c',
        'deps/libarchive/libarchive/archive_random.c',
        'deps/libarchive/libarchive/archive_rb.c',
        'deps/libarchive/libarchive/archive_read.c',
        'deps/libarchive/libarchive/archive_read_add_passphrase.c',
        'deps/libarchive/libarchive/archive_read_append_filter.c',
        'deps/libarchive/libarchive/archive_read_data_into_fd.c',
        'deps/libarchive/libarchive/archive_read_disk_entry_from_file.c',
        'deps/libarchive/libarchive/archive_read_disk_posix.c',
        'deps/libarchive/libarchive/archive_read_disk_set_standard_lookup.c',
        'deps/libarchive/libarchive/archive_read_disk_windows.c',
        'deps/libarchive/libarchive/archive_read_extract.c',
        'deps/libarchive/libarchive/archive_read_extract2.c',
        'deps/libarchive/libarchive/archive_read_open_fd.c',
        'deps/libarchive/libarchive/archive_read_open_file.c',
        'deps/libarchive/libarchive/archive_read_open_filename.c',
        'deps/libarchive/libarchive/archive_read_open_memory.c',
        'deps/libarchive/libarchive/archive_read_set_format.c',
        'deps/libarchive/libarchive/archive_read_set_options.c',
        'deps/libarchive/libarchive/archive_read_support_filter_all.c',
        'deps/libarchive/libarchive/archive_read_support_filter_bzip2.c',
        'deps/libarchive/libarchive/archive_read_support_filter_compress.c',
        'deps/libarchive/libarchive/archive_read_support_filter_grzip.c',
        'deps/libarchive/libarchive/archive_read_support_filter_gzip.c',
        'deps/libarchive/libarchive/archive_read_support_filter_lrzip.c',
        'deps/libarchive/libarchive/archive_read_support_filter_lz4.c',
        'deps/libarchive/libarchive/archive_read_support_filter_lzop.c',
        'deps/libarchive/libarchive/archive_read_support_filter_none.c',
        'deps/libarchive/libarchive/archive_read_support_filter_program.c',
        'deps/libarchive/libarchive/archive_read_support_filter_rpm.c',
        'deps/libarchive/libarchive/archive_read_support_filter_uu.c',
        'deps/libarchive/libarchive/archive_read_support_filter_xz.c',
        'deps/libarchive/libarchive/archive_read_support_filter_zstd.c',
        'deps/libarchive/libarchive/archive_read_support_format_7zip.c',
        'deps/libarchive/libarchive/archive_read_support_format_all.c',
        'deps/libarchive/libarchive/archive_read_support_format_ar.c',
        'deps/libarchive/libarchive/archive_read_support_format_by_code.c',
        'deps/libarchive/libarchive/archive_read_support_format_cab.c',
        'deps/libarchive/libarchive/archive_read_support_format_cpio.c',
        'deps/libarchive/libarchive/archive_read_support_format_empty.c',
        'deps/libarchive/libarchive/archive_read_support_format_iso9660.c',
        'deps/libarchive/libarchive/archive_read_support_format_lha.c',
        'deps/libarchive/libarchive/archive_read_support_format_mtree.c',
        'deps/libarchive/libarchive/archive_read_support_format_rar.c',
        'deps/libarchive/libarchive/archive_read_support_format_rar5.c',
        'deps/libarchive/libarchive/archive_read_support_format_raw.c',
        'deps/libarchive/libarchive/archive_read_support_format_tar.c',
        'deps/libarchive/libarchive/archive_read_support_format_warc.c',
        'deps/libarchive/libarchive/archive_read_support_format_xar.c',
        'deps/libarchive/libarchive/archive_read_support_format_zip.c',
        'deps/libarchive/libarchive/archive_string.c',
        'deps/libarchive/libarchive/archive_string_sprintf.c',
        'deps/libarchive/libarchive/archive_util.c',
        'deps/libarchive/libarchive/archive_version_details.c',
        'deps/libarchive/libarchive/archive_virtual.c',
        'deps/libarchive/libarchive/archive_windows.c',
        'deps/libarchive/libarchive/archive_write.c',
        'deps/libarchive/libarchive/archive_write_add_filter.c',
        'deps/libarchive/libarchive/archive_write_add_filter_b64encode.c',
        'deps/libarchive/libarchive/archive_write_add_filter_by_name.c',
        'deps/libarchive/libarchive/archive_write_add_filter_bzip2.c',
        'deps/libarchive/libarchive/archive_write_add_filter_compress.c',
        'deps/libarchive/libarchive/archive_write_add_filter_grzip.c',
        'deps/libarchive/libarchive/archive_write_add_filter_gzip.c',
        'deps/libarchive/libarchive/archive_write_add_filter_lrzip.c',
        'deps/libarchive/libarchive/archive_write_add_filter_lz4.c',
        'deps/libarchive/libarchive/archive_write_add_filter_lzop.c',
        'deps/libarchive/libarchive/archive_write_add_filter_none.c',
        'deps/libarchive/libarchive/archive_write_add_filter_program.c',
        'deps/libarchive/libarchive/archive_write_add_filter_uuencode.c',
        'deps/libarchive/libarchive/archive_write_add_filter_xz.c',
        'deps/libarchive/libarchive/archive_write_add_filter_zstd.c',
        'deps/libarchive/libarchive/archive_write_disk_posix.c',
        'deps/libarchive/libarchive/archive_write_disk_set_standard_lookup.c',
        'deps/libarchive/libarchive/archive_write_disk_windows.c',
        'deps/libarchive/libarchive/archive_write_open_fd.c',
        'deps/libarchive/libarchive/archive_write_open_file.c',
        'deps/libarchive/libarchive/archive_write_open_filename.c',
        'deps/libarchive/libarchive/archive_write_open_memory.c',
        'deps/libarchive/libarchive/archive_write_set_format.c',
        'deps/libarchive/libarchive/archive_write_set_format_7zip.c',
        'deps/libarchive/libarchive/archive_write_set_format_ar.c',
        'deps/libarchive/libarchive/archive_write_set_format_by_name.c',
        'deps/libarchive/libarchive/archive_write_set_format_cpio.c',
        'deps/libarchive/libarchive/archive_write_set_format_cpio_newc.c',
        'deps/libarchive/libarchive/archive_write_set_format_filter_by_ext.c',
        'deps/libarchive/libarchive/archive_write_set_format_gnutar.c',
        'deps/libarchive/libarchive/archive_write_set_format_iso9660.c',
        'deps/libarchive/libarchive/archive_write_set_format_mtree.c',
        'deps/libarchive/libarchive/archive_write_set_format_pax.c',
        'deps/libarchive/libarchive/archive_write_set_format_raw.c',
        'deps/libarchive/libarchive/archive_write_set_format_shar.c',
        'deps/libarchive/libarchive/archive_write_set_format_ustar.c',
        'deps/libarchive/libarchive/archive_write_set_format_v7tar.c',
        'deps/libarchive/libarchive/archive_write_set_format_warc.c',
        'deps/libarchive/libarchive/archive_write_set_format_xar.c',
        'deps/libarchive/libarchive/archive_write_set_format_zip.c',
        'deps/libarchive/libarchive/archive_write_set_options.c',
        'deps/libarchive/libarchive/archive_write_set_passphrase.c',
        'deps/libarchive/libarchive/filter_fork_posix.c',
        'deps/libarchive/libarchive/filter_fork_windows.c',
        'deps/libarchive/libarchive/xxhash.c',
    ]
    archive = static_library('acode_archive', archive_sources,
        include_directories: [include_directories('deps'), include_directories('deps/libarchive/libarchive')],
        c_args: ['-DHAVE_CONFIG_H', '-I' + meson.get_external_property('sdk_path') + '/usr/include/libxml2', '-w'])
    acode_alpine = static_library('acode_alpine',
        ['../../Bridge/AlpineRuntime.c', '../../Bridge/AlpineTerminal.c', '../../Bridge/AlpineFaults.c',
         '../../Bridge/AlpineArchive.c', 'tools/fakefs.c'],
        include_directories: [includes, include_directories('deps/libarchive/libarchive')],
        c_args: ['-I' + meson.project_source_root() + '/../../include'])
endif
