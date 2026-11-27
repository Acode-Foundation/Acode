#include "AcodeAlpine.h"
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "kernel/calls.h"
#include "kernel/init.h"
#include "kernel/task.h"
#include "fs/dev.h"
#include "fs/devices.h"
#include "fs/path.h"
#include "fs/real.h"
#include "fs/sockrestart.h"
#include "AlpineSpawn.h"

extern int fakefs_bind_mount(const char *, const char *, bool);
extern int do_wait(int, pid_t_, struct siginfo_ *, struct rusage_ *, int);
static struct task *init_task;
static AlpineExitCallback on_exit;
static int attach_descriptors(void *argument);
static void process_exit(struct task *task, int status);
static struct fd *host_descriptor(int number);
static void *failed_process(void *task);
static void *idle_init(void *task);

int alpine_boot(const char *root, AlpineExitCallback callback) {
    int result = mount_root(&fakefs, root);
    if (result < 0) return result;
    if (init_task == NULL) {
        result = become_first_process();
        if (result < 0) return result;
        init_task = current;
        int thread_error = pthread_create(&init_task->thread, NULL, idle_init, init_task);
        if (thread_error != 0) return -thread_error;
        pthread_detach(init_task->thread);
        alpine_install_fault_handlers();
    } else {
        current = init_task;
        current->fs->root = generic_open("/", O_RDONLY_, 0);
        if (IS_ERR(current->fs->root)) return (int) PTR_ERR(current->fs->root);
        current->fs->pwd = fd_retain(current->fs->root);
    }
    on_exit = callback;
    exit_hook = process_exit;
    generic_mkdirat(AT_PWD, "/dev", 0755);
    generic_mkdirat(AT_PWD, "/dev/pts", 0755);
    generic_mkdirat(AT_PWD, "/dev/shm", 01777);
    generic_mkdirat(AT_PWD, "/proc", 0755);
    generic_mkdirat(AT_PWD, "/tmp", 01777);
    generic_mkdirat(AT_PWD, "/run", 0755);
    generic_mkdirat(AT_PWD, "/sys", 0755);
    const struct { const char *path; int major; int minor; } devices[] = {
        {"/dev/null", MEM_MAJOR, DEV_NULL_MINOR},
        {"/dev/zero", MEM_MAJOR, DEV_ZERO_MINOR},
        {"/dev/full", MEM_MAJOR, DEV_FULL_MINOR},
        {"/dev/random", MEM_MAJOR, DEV_RANDOM_MINOR},
        {"/dev/urandom", MEM_MAJOR, DEV_URANDOM_MINOR},
        {"/dev/tty", TTY_ALTERNATE_MAJOR, DEV_TTY_MINOR},
        {"/dev/console", TTY_ALTERNATE_MAJOR, DEV_CONSOLE_MINOR},
        {"/dev/ptmx", TTY_ALTERNATE_MAJOR, DEV_PTMX_MINOR},
    };
    for (size_t index = 0; index < sizeof(devices) / sizeof(devices[0]); index++) {
        generic_mknodat(AT_PWD, devices[index].path, S_IFCHR | 0666,
                       dev_make(devices[index].major, devices[index].minor));
    }
    result = do_mount(&procfs, "proc", "/proc", "", 0);
    if (result >= 0) result = do_mount(&devptsfs, "devpts", "/dev/pts", "", 0);
    current = NULL;
    return result;
}

int alpine_bind(const char *guest, const char *host, bool readOnly) {
    current = init_task;
    char *parent = strdup(guest);
    for (char *slash = strchr(parent + 1, '/'); slash != NULL; slash = strchr(slash + 1, '/')) {
        *slash = '\0';
        int result = generic_mkdirat(AT_PWD, parent, 0755);
        *slash = '/';
        if (result < 0 && result != _EEXIST) { free(parent); current = NULL; return result; }
    }
    free(parent);
    int result = fakefs_bind_mount(guest, host, readOnly);
    current = NULL;
    return result;
}

int alpine_chmod(const char *path, unsigned int mode) {
    current = init_task;
    int result = generic_setattrat(AT_PWD, path, (struct attr) {.type = attr_mode, .mode = mode}, true);
    current = NULL;
    return result;
}

int alpine_start(const char *command, const char *environment, int input, int output, int error) {
    int descriptors[] = {input, output, error};
    return alpine_spawn(command, environment, attach_descriptors, descriptors);
}

int alpine_spawn(const char *command, const char *environment, int (*attach)(void *), void *argument) {
    current = init_task;
    int result = become_new_init_child();
    if (result < 0) { current = NULL; return result; }
    result = attach(argument);
    if (result >= 0) {
        size_t length = strlen(command);
        char *arguments = calloc(1, length + 14);
        memcpy(arguments, "/bin/sh\0-c\0", 11);
        memcpy(arguments + 11, command, length);
        result = do_execve("/bin/sh", 3, arguments, environment);
        free(arguments);
    }
    int pid = current->pid;
    sigset_t wake, previous;
    sigemptyset(&wake);
    sigaddset(&wake, SIGUSR1);
    // GCD workers block SIGUSR1; guest threads must inherit an unblocked mask.
    pthread_sigmask(SIG_UNBLOCK, &wake, &previous);
    if (result < 0) {
        pthread_t thread;
        pthread_create(&thread, NULL, failed_process, current);
        pthread_detach(thread);
    } else {
        task_start(current);
    }
    pthread_sigmask(SIG_SETMASK, &previous, NULL);
    current = NULL;
    return result < 0 ? result : pid;
}

int alpine_kill(int pid) {
    if (pid <= 1) return -22;
    lock(&pids_lock);
    struct task *task = pid_get_task(pid);
    bool group = task != NULL && task->group->pgid == pid;
    if (task != NULL && !group) send_signal(task, SIGKILL_, SIGINFO_NIL);
    unlock(&pids_lock);
    if (task == NULL) return _ESRCH;
    return group ? send_group_signal(pid, SIGKILL_, SIGINFO_NIL) : 0;
}

bool alpine_running(int pid) {
    lock(&pids_lock);
    struct task *task = pid_get_task(pid);
    bool running = task != NULL && !task->exiting;
    unlock(&pids_lock);
    return running;
}

void alpine_reap(void) {
    if (init_task == NULL) return;
    current = init_task;
    struct siginfo_ info = {0};
    // P_ALL=0, WNOHANG=1, WEXITED=4 (Linux wait ABI).
    while (do_wait(0, 0, &info, NULL, 5) == 0 && info.child.pid != 0) {
        memset(&info, 0, sizeof(info));
    }
    current = NULL;
}

void alpine_stop_all(void) {
    lock(&pids_lock);
    for (int pid = 2; pid < MAX_PID; pid++) {
        struct task *task = pid_get_task(pid);
        if (task != NULL && !task->exiting) send_signal(task, SIGKILL_, SIGINFO_NIL);
    }
    unlock(&pids_lock);
}

bool alpine_idle(void) {
    bool idle = true;
    lock(&pids_lock);
    for (int pid = 2; pid < MAX_PID; pid++) {
        struct task *task = pid_get_task(pid);
        if (task != NULL && !task->exiting) { idle = false; break; }
    }
    unlock(&pids_lock);
    return idle;
}

int alpine_unmount(void) {
    if (!alpine_idle()) return -16;
    alpine_reap();
    current = init_task;
    fd_close(current->fs->pwd);
    fd_close(current->fs->root);
    current->fs->pwd = current->fs->root = NULL;
    int result = do_umount("/dev/pts");
    if (result == 0) result = do_umount("/proc");
    if (result == 0) result = do_umount("");
    current = NULL;
    return result;
}

void alpine_suspend(void) {
    sockrestart_on_suspend();
}

void alpine_resume(void) {
    sockrestart_on_resume();
}

static int attach_descriptors(void *argument) {
    int *descriptors = argument;
    for (int index = 0; index < 3; index++) {
        current->files->files[index] = host_descriptor(descriptors[index]);
    }
    return 0;
}

static void process_exit(struct task *task, int status) {
    if (on_exit != NULL) on_exit(task->tgid, (status & 0x7f) ? 128 + (status & 0x7f) : status >> 8);
}

static struct fd *host_descriptor(int number) {
    struct fd *descriptor = adhoc_fd_create(&realfs_fdops);
    descriptor->real_fd = dup(number);
    descriptor->dir = NULL;
    descriptor->flags = O_RDWR_;
    struct stat info;
    fstat(number, &info);
    descriptor->stat.mode = info.st_mode;
    descriptor->stat.inode = info.st_ino;
    return descriptor;
}

static void *failed_process(void *task) {
    current = task;
    do_exit(127 << 8);
}

static void *idle_init(void *task) {
    current = task;
    // Keep a stable signal target for PID 1; Swift's serial queue reaps its
    // orphaned children after exit notifications without running a guest init.
    sigset_t mask;
    sigfillset(&mask);
    sigdelset(&mask, SIGUSR1);
    for (;;) sigsuspend(&mask);
}
