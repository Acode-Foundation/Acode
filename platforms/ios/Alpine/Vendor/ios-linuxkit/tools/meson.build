libarchive = dependency('libarchive', required: false)
if not libarchive.found()
    # homebrew
    libarchive_lib = cc.find_library('archive', dirs: ['/usr/local/opt/libarchive/lib'], required: false)
    if libarchive_lib.found()
        libarchive = declare_dependency(dependencies: [libarchive_lib], include_directories: include_directories(['/usr/local/opt/libarchive/include']))
    else
        # Apple Silicon Homebrew
        libarchive_lib = cc.find_library('archive', dirs: ['/opt/homebrew/opt/libarchive/lib'], required: false)
        if libarchive_lib.found()
            libarchive = declare_dependency(dependencies: [libarchive_lib], include_directories: include_directories(['/opt/homebrew/opt/libarchive/include']))
        endif
    endif
endif

if libarchive.found()
    fakefsify_src = [
        'fakefsify.c',
        'fakefs.c',
        '../util/fchdir.c',
    ]
    fakefsify = executable('fakefsify', fakefsify_src, dependencies: [libarchive], link_with: [libfakefs], include_directories: [includes])
    custom_target('unfakefsify',
        build_by_default: true,
        command: ['ln', '-sf', 'fakefsify', '@OUTPUT@'],
        output: 'unfakefsify')
endif

if host_machine.system() == 'linux'
    sdl2 = dependency('sdl2', required: false)
    sdl2_ttf = dependency('SDL2_ttf', required: false)
    vterm = dependency('vterm', required: false)
    libutil = cc.find_library('util', required: false)
    libvncserver = cc.find_library('vncserver', required: false)
    if sdl2.found() and sdl2_ttf.found() and vterm.found() and libutil.found() and libvncserver.found()
        executable('ish-sdl-vnc', ['ish_sdl_vnc.c'],
            include_directories: includes,
            dependencies: [sdl2, sdl2_ttf, vterm, libutil, libvncserver])
    endif
endif
