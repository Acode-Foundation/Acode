// Native offload: run registered guest binaries as native host processes.
// Mappings are configured via CLI: -n ffmpeg -n ffprobe=/usr/local/bin/ffprobe
// Phase 1: macOS only via posix_spawn.
//
// Path redirection is handled transparently by libfakefs_redirect.dylib,
// injected into the native process via DYLD_INSERT_LIBRARIES. This intercepts
// all filesystem calls (open, stat, access, etc.) and redirects absolute guest
// paths to the fakefs data directory. No argv-level path rewriting needed.

#include <unistd.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <libgen.h>
#include <limits.h>
#include <fcntl.h>
#include <dirent.h>
#include <pthread.h>
#ifdef __APPLE__
#include <TargetConditionals.h>
#if TARGET_OS_OSX
#include <spawn.h>
#include <mach-o/dyld.h>
#define HAS_POSIX_SPAWN 1
#endif
#endif

#include "kernel/calls.h"
#include "kernel/task.h"
#include "kernel/native_offload.h"
#include "kernel/fs.h"
#include "fs/fd.h"
#include "fs/fake-db.h"
#ifdef ISH_INTERNAL
#include "fs/fake.h"
#else
#define ISH_INTERNAL
#include "fs/fake.h"
#undef ISH_INTERNAL
#endif

#if !__APPLE__
int native_offload_add(const char *spec) { (void)spec; return -1; }
const char *native_offload_lookup(const char *guest_path) { (void)guest_path; return NULL; }
int native_offload_exec(const char *native_path, const char *guest_file,
                        size_t argc, const char *argv, const char *envp) {
    (void)native_path; (void)guest_file; (void)argc; (void)argv; (void)envp;
    return _ENOSYS;
}
bool native_offload_forward_signal(struct task *task, int sig) {
    (void)task; (void)sig; return false;
}
#else

// --- Dynamic registry ---

struct offload_entry {
    char *guest_name;
    char *native_path;           // NULL if using handler
    native_handler_func handler; // non-NULL for in-process execution
};

static struct offload_entry offload_entries[NATIVE_OFFLOAD_MAX];
static int offload_count = 0;

#ifdef HAS_POSIX_SPAWN
// Path to the redirect dylib (resolved once at startup)
static char dylib_path[PATH_MAX];
static bool dylib_found = false;

static char *auto_detect_host_path(const char *name) {
    static const char *search_dirs[] = {
        "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", NULL
    };
    char path[PATH_MAX];
    for (const char **dir = search_dirs; *dir; dir++) {
        snprintf(path, sizeof(path), "%s/%s", *dir, name);
        if (access(path, X_OK) == 0)
            return strdup(path);
    }
    return NULL;
}

// Find the redirect dylib next to the ish binary
static void resolve_dylib_path(void) {
    char exe[PATH_MAX];
    uint32_t size = sizeof(exe);
    if (_NSGetExecutablePath(exe, &size) != 0)
        return;
    char *real = realpath(exe, NULL);
    if (!real) return;
    char *dir = dirname(real);
    snprintf(dylib_path, sizeof(dylib_path), "%s/libfakefs_redirect.dylib", dir);
    free(real);
    if (access(dylib_path, F_OK) == 0)
        dylib_found = true;
    else
        fprintf(stderr, "native_offload: warning: %s not found, path redirection disabled\n",
                dylib_path);
}

int native_offload_add(const char *spec) {
    if (offload_count >= NATIVE_OFFLOAD_MAX) {
        fprintf(stderr, "native_offload: too many entries (max %d)\n", NATIVE_OFFLOAD_MAX);
        return -1;
    }

    // Resolve dylib path on first call
    if (offload_count == 0)
        resolve_dylib_path();

    const char *eq = strchr(spec, '=');
    char *guest_name, *native_path;

    if (eq) {
        guest_name = strndup(spec, eq - spec);
        const char *path = eq + 1;
        if (access(path, X_OK) != 0) {
            fprintf(stderr, "native_offload: %s: not found or not executable\n", path);
            free(guest_name);
            return -1;
        }
        native_path = strdup(path);
    } else {
        guest_name = strdup(spec);
        native_path = auto_detect_host_path(spec);
        if (!native_path) {
            fprintf(stderr, "native_offload: %s: not found in host PATH\n", spec);
            free(guest_name);
            return -1;
        }
    }

    struct offload_entry *e = &offload_entries[offload_count++];
    e->guest_name = guest_name;
    e->native_path = native_path;
    fprintf(stderr, "native_offload: %s → %s\n", guest_name, native_path);
    return 0;
}
#else
int native_offload_add(const char *spec) {
    (void)spec;
    fprintf(stderr, "native_offload: posix_spawn not available on this platform\n");
    return -1;
}
#endif // HAS_POSIX_SPAWN

int native_offload_add_handler(const char *guest_name, native_handler_func handler) {
    if (offload_count >= NATIVE_OFFLOAD_MAX) return -1;
    struct offload_entry *e = &offload_entries[offload_count++];
    e->guest_name = strdup(guest_name);
    e->native_path = NULL;
    e->handler = handler;
    fprintf(stderr, "native_offload: %s → [builtin]\n", guest_name);
    return 0;
}

// Internal: find entry by guest binary basename
static struct offload_entry *offload_find(const char *guest_path) {
    if (offload_count == 0)
        return NULL;
    const char *base = strrchr(guest_path, '/');
    base = base ? base + 1 : guest_path;
    for (int i = 0; i < offload_count; i++) {
        if (strcmp(base, offload_entries[i].guest_name) == 0)
            return &offload_entries[i];
    }
    return NULL;
}

const char *native_offload_lookup(const char *guest_path) {
    struct offload_entry *e = offload_find(guest_path);
    if (!e) return NULL;
    // Return non-NULL to signal "offload this". For handler-only entries
    // (no native_path), return a sentinel so the caller proceeds to exec.
    return e->native_path ? e->native_path : "[builtin]";
}

// --- Shared helpers ---

extern struct mount *g_fakefs_mount;

// Get the root mount source path (works for both realfs and fakefs)
static const char *get_root_source(void) {
    if (g_fakefs_mount && g_fakefs_mount->source)
        return g_fakefs_mount->source;
    // realfs: get source from the root fd's mount
    if (current->fs && current->fs->root && current->fs->root->mount)
        return current->fs->root->mount->source;
    return NULL;
}

// Translate a guest absolute path to the real host path, honoring bind
// mounts. iSH bind-mounts guest directories (e.g. /var/minis/workspace) to
// real host locations outside the fakefs data/ tree; native offload
// handlers that execute on the host must follow those bind mounts, or
// they'll read/write the wrong files and the guest will see a ghost
// filesystem divergence. Falls back to fakefs->source + guest_path when
// no bind-mount rule matches. Returns true on success.
static bool build_host_path_for_guest(const char *guest_path,
                                      char *out, size_t out_size) {
    if (!guest_path || !out || out_size == 0) return false;
    // 1) bind-mount wins: /var/minis/... → /Users/.../Library/MinisChat/...
    if (guest_path[0] == '/' &&
        fakefs_bind_mount_translate_path(guest_path, out, out_size))
        return true;
    // 2) fall back to fakefs source directory
    const char *root = get_root_source();
    if (!root) return false;
    const char *rel = guest_path;
    if (rel[0] == '/') rel++;
    int n = snprintf(out, out_size, "%s/%s", root, rel);
    return n > 0 && (size_t)n < out_size;
}

static void native_free_string_array(char **arr) {
    if (!arr) return;
    for (char **p = arr; *p; p++) free(*p);
    free(arr);
}

#ifdef HAS_POSIX_SPAWN
static char **build_native_argv(const char *native_path, size_t argc,
                                const char *packed_argv) {
    char **argv = calloc(argc + 1, sizeof(char *));
    if (!argv) return NULL;

    argv[0] = strdup(native_path);
    const char *p = packed_argv;
    p += strlen(p) + 1; // skip guest argv[0]
    for (size_t i = 1; i < argc; i++) {
        argv[i] = strdup(p);
        p += strlen(p) + 1;
    }
    argv[argc] = NULL;
    return argv;
}

static char **build_native_envp(const char *packed_envp) {
    // Count original entries
    size_t count = 0;
    const char *p = packed_envp;
    while (*p) { count++; p += strlen(p) + 1; }

    // +2 for DYLD_INSERT_LIBRARIES and FAKEFS_ROOT
    char **envp = calloc(count + 3, sizeof(char *));
    if (!envp) return NULL;

    static const char *skip_prefixes[] = {
        "OPENSSL_armcap=", "PYTHONMALLOC=", "PYTHONDONTWRITEBYTECODE=",
        "DYLD_INSERT_LIBRARIES=", "FAKEFS_ROOT=", // don't pass guest values
        NULL
    };

    size_t j = 0;
    p = packed_envp;
    while (*p) {
        bool skip = false;
        for (const char **sp = skip_prefixes; *sp; sp++) {
            if (strncmp(p, *sp, strlen(*sp)) == 0) { skip = true; break; }
        }
        if (!skip) envp[j++] = strdup(p);
        p += strlen(p) + 1;
    }

    // Inject DYLD_INSERT_LIBRARIES + FAKEFS_ROOT for path redirection.
    // Both fakefs and realfs need this: guest absolute paths must be
    // redirected to the rootfs directory on host.
    const char *root_source = get_root_source();
    if (root_source && dylib_found) {
        char buf[PATH_MAX + 32];
        snprintf(buf, sizeof(buf), "DYLD_INSERT_LIBRARIES=%s", dylib_path);
        envp[j++] = strdup(buf);
        snprintf(buf, sizeof(buf), "FAKEFS_ROOT=%s", root_source);
        envp[j++] = strdup(buf);
    }

    envp[j] = NULL;
    return envp;
}
#endif // HAS_POSIX_SPAWN

// --- Signal mapping ---

static int guest_to_host_signal(int guest_sig) {
    switch (guest_sig) {
        case 1:  return SIGHUP;    case 2:  return SIGINT;
        case 3:  return SIGQUIT;   case 6:  return SIGABRT;
        case 9:  return SIGKILL;   case 13: return SIGPIPE;
        case 14: return SIGALRM;   case 15: return SIGTERM;
        case 17: return SIGCHLD;   case 18: return SIGCONT;
        case 19: return SIGSTOP;   case 20: return SIGTSTP;
        default: return guest_sig;
    }
}

bool native_offload_forward_signal(struct task *task, int sig) {
    if (!task->is_native_proxy || task->native_pid <= 0)
        return false;
    int host_sig = guest_to_host_signal(sig);
    if (host_sig > 0)
        kill(task->native_pid, host_sig);
    return true;
}

// --- Post-exec: scan for new files and register in fakefs DB ---
// Since the dylib redirects all paths transparently, we don't know exactly
// which files were created. We scan directories mentioned in argv for any
// files not yet in the DB.

static void register_file_if_new(struct fakefs_db *fs, const char *guest_path,
                                 const char *host_path) {
    struct stat st;
    if (stat(host_path, &st) != 0)
        return;
    if (!S_ISREG(st.st_mode))
        return;

    db_begin_write(fs);
    inode_t existing = path_get_inode(fs, guest_path);
    if (existing != 0) {
        db_commit(fs);
        return;
    }

    struct ish_stat ishstat = {
        .mode = S_IFREG | (st.st_mode & 0777),
        .uid  = current->euid,
        .gid  = current->egid,
        .rdev = 0,
    };
    path_create(fs, guest_path, &ishstat);
    db_commit(fs);
    printk("native_offload: registered %s in fakefs\n", guest_path);
}

// Scan a single directory (non-recursive) for unregistered files
static void scan_dir_for_new_files(struct fakefs_db *fs, const char *guest_dir) {
    if (!g_fakefs_mount || !g_fakefs_mount->source)
        return;

    // Follow bind mounts: guest_dir may live under a bind-mounted prefix
    // whose real content is outside the fakefs data/ tree.
    char host_dir[PATH_MAX];
    if (!build_host_path_for_guest(guest_dir, host_dir, sizeof(host_dir)))
        return;

    DIR *d = opendir(host_dir);
    if (!d) return;

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (ent->d_name[0] == '.') continue; // skip . and ..
        if (ent->d_type != DT_REG && ent->d_type != DT_UNKNOWN) continue;

        char host_path[PATH_MAX], guest_path[PATH_MAX];
        snprintf(host_path, sizeof(host_path), "%s/%s", host_dir, ent->d_name);
        snprintf(guest_path, sizeof(guest_path), "%s/%s", guest_dir, ent->d_name);
        register_file_if_new(fs, guest_path, host_path);
    }
    closedir(d);
}

// Get guest CWD path (returns static buffer or NULL)
static const char *get_guest_cwd(void) {
    if (!current->fs || !current->fs->pwd)
        return NULL;
    static char guest_cwd[MAX_PATH];
    int err = current->fs->pwd->mount->fs->getpath(current->fs->pwd, guest_cwd);
    if (err < 0) return NULL;
    return guest_cwd;
}

// Extract directories from argv that might contain new output files,
// plus always scan CWD (native processes often write to CWD with relative paths).
static void register_new_files(size_t argc, const char *packed_argv) {
    if (!g_fakefs_mount) return;
    struct fakefs_db *fs = &g_fakefs_mount->fakefs;

    // Always scan CWD — native processes commonly write to CWD via relative paths
    // (e.g., yt-dlp calls ffmpeg with relative output filename)
    const char *guest_cwd = get_guest_cwd();
    if (guest_cwd)
        scan_dir_for_new_files(fs, guest_cwd);

    const char *p = packed_argv;
    p += strlen(p) + 1; // skip argv[0]

    for (size_t i = 1; i < argc; i++) {
        if ((p[0] == '/' || (p[0] == '.' && p[1] == '/')) && !strstr(p, "://")) {
            // It's a path — check both as file and scan its parent dir.
            // Use bind-mount-aware translation so we register the file at
            // the real host location the handler actually wrote to.
            char host_path[PATH_MAX];
            if (build_host_path_for_guest(p, host_path, sizeof(host_path)))
                register_file_if_new(fs, p, host_path);

            // Also scan parent directory for pattern-generated files
            char parent[PATH_MAX];
            strncpy(parent, p, sizeof(parent) - 1);
            parent[sizeof(parent) - 1] = '\0';
            char *slash = strrchr(parent, '/');
            if (slash && slash != parent) {
                *slash = '\0';
                // Skip if same as CWD (already scanned)
                if (!guest_cwd || strcmp(parent, guest_cwd) != 0)
                    scan_dir_for_new_files(fs, parent);
            }
        }
        p += strlen(p) + 1;
    }
}

// --- CWD resolution ---

static char *get_host_cwd(void) {
    if (!current->fs || !current->fs->pwd)
        return NULL;
    char guest_cwd[MAX_PATH];
    int err = current->fs->pwd->mount->fs->getpath(current->fs->pwd, guest_cwd);
    if (err < 0) return NULL;

    char *host_cwd = malloc(PATH_MAX);
    if (!host_cwd) return NULL;

    // Handle empty guest cwd ("/" after stripping leading slash) by falling
    // back directly to the fakefs source — bind-mount translation is only
    // meaningful for subpaths of a mounted prefix.
    if (guest_cwd[0] == '\0' || (guest_cwd[0] == '/' && guest_cwd[1] == '\0')) {
        const char *root = get_root_source();
        if (!root) { free(host_cwd); return NULL; }
        snprintf(host_cwd, PATH_MAX, "%s", root);
        return host_cwd;
    }

    if (!build_host_path_for_guest(guest_cwd, host_cwd, PATH_MAX)) {
        free(host_cwd);
        return NULL;
    }
    return host_cwd;
}

// --- Pipe forwarding for stdout/stderr ---
// Two modes:
// 1. Guest fd mode (iOS): reads from pipe, writes via fd->ops->write (TTY driver)
// 2. Host fd mode (macOS posix_spawn): reads from pipe, writes to host real_fd

struct pipe_fwd {
    int pipe_rd;
    int dest_fd;        // host fd (macOS posix_spawn path)
    struct fd *guest_fd; // guest fd (iOS handler path), NULL if using dest_fd
};

static void *pipe_forward_thread(void *arg) {
    struct pipe_fwd *fwd = arg;
    char buf[4096];
    ssize_t n;
    while ((n = read(fwd->pipe_rd, buf, sizeof(buf))) > 0) {
        // Replace \r not followed by \n with \n (progress bar lines)
        for (ssize_t i = 0; i < n; i++) {
            if (buf[i] == '\r') {
                if (i + 1 < n && buf[i + 1] == '\n')
                    continue; // \r\n is fine, keep both
                buf[i] = '\n';
            }
        }
        if (fwd->guest_fd && fwd->guest_fd->ops->write) {
            // iOS path: write through guest fd ops (TTY driver → Terminal UI)
            ssize_t written = 0;
            while (written < n) {
                ssize_t w = fwd->guest_fd->ops->write(fwd->guest_fd,
                                                       buf + written, n - written);
                if (w <= 0) break;
                written += w;
            }
        } else {
            // macOS path: write to host real_fd
            ssize_t written = 0;
            while (written < n) {
                ssize_t w = write(fwd->dest_fd, buf + written, n - written);
                if (w < 0) {
                    if (errno == EINTR) continue;
                    break;
                }
                written += w;
            }
        }
    }
    close(fwd->pipe_rd);
    if (fwd->guest_fd)
        fd_close(fwd->guest_fd);
    free(fwd);
    return NULL;
}

// Start forwarding with host fd destination (macOS posix_spawn)
static pthread_t start_pipe_forward(int pipe_rd, int dest_fd) {
    struct pipe_fwd *fwd = malloc(sizeof(*fwd));
    fwd->pipe_rd = pipe_rd;
    fwd->dest_fd = dest_fd;
    fwd->guest_fd = NULL;
    pthread_t tid;
    pthread_create(&tid, NULL, pipe_forward_thread, fwd);
    return tid;
}

// Start forwarding with guest fd destination (iOS handler)
static pthread_t start_pipe_forward_guest(int pipe_rd, struct fd *guest_fd) {
    struct pipe_fwd *fwd = malloc(sizeof(*fwd));
    fwd->pipe_rd = pipe_rd;
    fwd->dest_fd = -1;
    fwd->guest_fd = fd_retain(guest_fd);
    pthread_t tid;
    pthread_create(&tid, NULL, pipe_forward_thread, fwd);
    return tid;
}

// --- Exec semantics (shared by posix_spawn and in-process handler) ---

static void apply_exec_semantics(const char *guest_file) {
    lock(&current->general_lock);
    const char *base = strrchr(guest_file, '/');
    base = base ? base + 1 : guest_file;
    strncpy(current->comm, base, sizeof(current->comm));
    unlock(&current->general_lock);
    update_thread_name();

    current->did_exec = true;
    vfork_notify(current);
    fdtable_do_cloexec(current->files);

    if (current->sighand) {
        lock(&current->sighand->lock);
        for (int sig = 0; sig < NUM_SIGS; sig++) {
            struct sigaction_ *action = &current->sighand->action[sig];
            if (action->handler != SIG_IGN_)
                action->handler = SIG_DFL_;
        }
        current->altstack = 0;
        current->altstack_size = 0;
        unlock(&current->sighand->lock);
    }
}

// --- In-process handler execution (works on both macOS and iOS) ---

static int exec_handler(native_handler_func handler, const char *guest_file,
                        size_t argc, const char *argv, const char *envp) {
    (void)envp;
    const char *root_source = get_root_source();

    // Build argc/argv for the handler, translating guest paths to host paths.
    // Unlike posix_spawn path (which uses DYLD interpose for transparent
    // redirection), in-process handlers need explicit path translation.
    char **handler_argv = calloc(argc + 1, sizeof(char *));
    if (!handler_argv) return _ENOMEM;

    const char *p = argv;
    for (size_t i = 0; i < argc; i++) {
        // Absolute guest path → host path, honoring bind mounts first.
        // Skip URLs (anything containing "://") which are not filesystem paths.
        if (root_source && p[0] == '/' && !strstr(p, "://")) {
            char host_path[PATH_MAX];
            if (build_host_path_for_guest(p, host_path, sizeof(host_path)))
                handler_argv[i] = strdup(host_path);
            else
                handler_argv[i] = strdup(p);
        } else {
            handler_argv[i] = strdup(p);
        }
        p += strlen(p) + 1;
    }
    handler_argv[argc] = NULL;

    printk("native_offload: [builtin] %s (pid %d)\n", guest_file, current->pid);

    // Get guest stdio fds (retain for forwarding threads)
    struct fd *guest_stdin = NULL, *guest_stdout = NULL, *guest_stderr = NULL;
    lock(&current->files->lock);
    if (current->files->files[0]) guest_stdin  = fd_retain(current->files->files[0]);
    if (current->files->files[1]) guest_stdout = fd_retain(current->files->files[1]);
    if (current->files->files[2]) guest_stderr = fd_retain(current->files->files[2]);
    unlock(&current->files->lock);

    // Create pipes: handler writes to pipe write-end, forwarding thread reads
    // from pipe read-end and writes through guest fd ops (TTY driver on iOS).
    int stdout_pipe[2] = {-1, -1}, stderr_pipe[2] = {-1, -1};
    int handler_stdin = -1, handler_stdout = -1, handler_stderr = -1;

    if (guest_stdin && guest_stdin->real_fd >= 0)
        handler_stdin = guest_stdin->real_fd;

    if (guest_stdout && pipe(stdout_pipe) == 0)
        handler_stdout = stdout_pipe[1];
    else
        stdout_pipe[0] = stdout_pipe[1] = -1;

    if (guest_stderr && pipe(stderr_pipe) == 0)
        handler_stderr = stderr_pipe[1];
    else
        stderr_pipe[0] = stderr_pipe[1] = -1;

    apply_exec_semantics(guest_file);

    // Start pipe forwarding threads — write through guest fd ops
    // so data reaches iOS Terminal UI (via TTY driver)
    pthread_t stdout_tid = 0, stderr_tid = 0;
    if (stdout_pipe[0] >= 0 && guest_stdout)
        stdout_tid = start_pipe_forward_guest(stdout_pipe[0], guest_stdout);
    if (stderr_pipe[0] >= 0 && guest_stderr)
        stderr_tid = start_pipe_forward_guest(stderr_pipe[0], guest_stderr);

    // Resolve host paths for handler: it may need to read/write files
    // in the fakefs data directory. Set cwd to host CWD.
    char *host_cwd = get_host_cwd();
    char saved_cwd[PATH_MAX];
    bool cwd_changed = false;
    if (host_cwd) {
        if (getcwd(saved_cwd, sizeof(saved_cwd)) && chdir(host_cwd) == 0)
            cwd_changed = true;
        free(host_cwd);
    }

    // Call the handler in-process
    int ret = handler((int)argc, handler_argv, handler_stdin, handler_stdout, handler_stderr);

    // Close write ends so forwarding threads see EOF
    if (stdout_pipe[1] >= 0) close(stdout_pipe[1]);
    if (stderr_pipe[1] >= 0) close(stderr_pipe[1]);
    if (stdout_tid) pthread_join(stdout_tid, NULL);
    if (stderr_tid) pthread_join(stderr_tid, NULL);

    // Restore cwd
    if (cwd_changed)
        (void)chdir(saved_cwd);

    // Release guest fd references (forwarding threads already released theirs)
    if (guest_stdin) fd_close(guest_stdin);
    if (guest_stdout) fd_close(guest_stdout);
    if (guest_stderr) fd_close(guest_stderr);

    native_free_string_array(handler_argv);

    int exit_code = ret << 8;
    printk("native_offload: [builtin] %s exited with code %d\n", guest_file, ret);

    register_new_files(argc, argv);
    do_exit(exit_code);
    __builtin_unreachable();
}

// --- posix_spawn execution (macOS only) ---

#ifdef HAS_POSIX_SPAWN
static int exec_posix_spawn(const char *native_path, const char *guest_file,
                            size_t argc, const char *argv, const char *envp) {
    char **native_argv = build_native_argv(native_path, argc, argv);
    if (!native_argv)
        return _ENOMEM;

    char **native_envp = build_native_envp(envp);
    if (!native_envp) {
        native_free_string_array(native_argv);
        return _ENOMEM;
    }

    printk("native_offload: exec:");
    for (size_t i = 0; native_argv[i]; i++)
        printk(" %s", native_argv[i]);
    printk("\n");

    // Get stdio fds
    int stdin_fd = -1, stdout_fd = -1, stderr_fd = -1;
    lock(&current->files->lock);
    if (current->files->files[0]) stdin_fd  = current->files->files[0]->real_fd;
    if (current->files->files[1]) stdout_fd = current->files->files[1]->real_fd;
    if (current->files->files[2]) stderr_fd = current->files->files[2]->real_fd;
    unlock(&current->files->lock);

    // Pipes for stdout/stderr (\r → \n conversion)
    int stdout_pipe[2] = {-1, -1}, stderr_pipe[2] = {-1, -1};
    int stdout_dest = stdout_fd, stderr_dest = stderr_fd;

    if (stdout_fd >= 0 && pipe(stdout_pipe) == 0) {} else stdout_pipe[0] = stdout_pipe[1] = -1;
    if (stderr_fd >= 0 && pipe(stderr_pipe) == 0) {} else stderr_pipe[0] = stderr_pipe[1] = -1;

    // posix_spawn setup
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    if (stdin_fd >= 0)
        posix_spawn_file_actions_adddup2(&actions, stdin_fd, STDIN_FILENO);
    else
        posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    if (stdout_pipe[1] >= 0) {
        posix_spawn_file_actions_adddup2(&actions, stdout_pipe[1], STDOUT_FILENO);
        posix_spawn_file_actions_addclose(&actions, stdout_pipe[0]);
    } else if (stdout_fd >= 0) {
        posix_spawn_file_actions_adddup2(&actions, stdout_fd, STDOUT_FILENO);
    }
    if (stderr_pipe[1] >= 0) {
        posix_spawn_file_actions_adddup2(&actions, stderr_pipe[1], STDERR_FILENO);
        posix_spawn_file_actions_addclose(&actions, stderr_pipe[0]);
    } else if (stderr_fd >= 0) {
        posix_spawn_file_actions_adddup2(&actions, stderr_fd, STDERR_FILENO);
    }

    posix_spawnattr_t attrs;
    posix_spawnattr_init(&attrs);

    char *host_cwd = get_host_cwd();
    if (host_cwd)
        posix_spawn_file_actions_addchdir(&actions, host_cwd);

    pid_t native_pid;
    int spawn_err = posix_spawn(&native_pid, native_path, &actions, &attrs,
                                native_argv, native_envp);

    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attrs);
    native_free_string_array(native_argv);
    native_free_string_array(native_envp);
    free(host_cwd);

    if (stdout_pipe[1] >= 0) close(stdout_pipe[1]);
    if (stderr_pipe[1] >= 0) close(stderr_pipe[1]);

    if (spawn_err != 0) {
        if (stdout_pipe[0] >= 0) close(stdout_pipe[0]);
        if (stderr_pipe[0] >= 0) close(stderr_pipe[0]);
        printk("native_offload: posix_spawn failed: %s\n", strerror(spawn_err));
        return _ENOEXEC;
    }

    pthread_t stdout_tid = 0, stderr_tid = 0;
    if (stdout_pipe[0] >= 0)
        stdout_tid = start_pipe_forward(stdout_pipe[0], stdout_dest);
    if (stderr_pipe[0] >= 0)
        stderr_tid = start_pipe_forward(stderr_pipe[0], stderr_dest);

    printk("native_offload: spawned host pid %d for guest pid %d\n",
           native_pid, current->pid);

    current->native_pid = native_pid;
    current->is_native_proxy = true;

    apply_exec_semantics(guest_file);

    // Wait for native process
    int status;
    while (true) {
        pid_t ret = waitpid(native_pid, &status, 0);
        if (ret == native_pid) break;
        if (ret < 0 && errno == EINTR) continue;
        if (ret < 0) {
            printk("native_offload: waitpid failed: %s\n", strerror(errno));
            status = 1 << 8;
            break;
        }
    }

    if (stdout_tid) pthread_join(stdout_tid, NULL);
    if (stderr_tid) pthread_join(stderr_tid, NULL);

    int exit_code;
    if (WIFEXITED(status)) {
        exit_code = WEXITSTATUS(status) << 8;
        printk("native_offload: host pid %d exited with code %d\n",
               native_pid, WEXITSTATUS(status));
    } else if (WIFSIGNALED(status)) {
        exit_code = WTERMSIG(status);
        printk("native_offload: host pid %d killed by signal %d\n",
               native_pid, WTERMSIG(status));
    } else {
        exit_code = 1 << 8;
    }

    register_new_files(argc, argv);
    current->is_native_proxy = false;
    current->native_pid = 0;
    do_exit(exit_code);
    __builtin_unreachable();
}
#endif // HAS_POSIX_SPAWN

// --- Main exec dispatcher ---

int native_offload_exec(const char *native_path,
                        const char *guest_file,
                        size_t argc, const char *argv,
                        const char *envp) {
    // Check for in-process handler first (works on iOS and macOS)
    struct offload_entry *entry = offload_find(guest_file);
    if (entry && entry->handler)
        return exec_handler(entry->handler, guest_file, argc, argv, envp);

#ifdef HAS_POSIX_SPAWN
    // posix_spawn path (macOS only, native_path must be valid)
    if (!native_path || strcmp(native_path, "[builtin]") == 0)
        return _ENOEXEC;

    return exec_posix_spawn(native_path, guest_file, argc, argv, envp);
#else
    (void)native_path;
    return _ENOEXEC;
#endif
}

#endif // __APPLE__
