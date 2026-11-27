#ifndef CALLS_H
#define CALLS_H

#include "kernel/task.h"
#include "kernel/errno.h"
#include "fs/fd.h"
#include "fs/dev.h"
#include "kernel/fs.h"
#include "misc.h"

#include "kernel/signal.h"
#include "fs/sock.h"
#include "kernel/time.h"
#include "kernel/resource.h"
#include "kernel/ptrace.h"

void handle_interrupt(int interrupt);

int must_check user_read(addr_t addr, void *buf, size_t count);
int must_check user_write(addr_t addr, const void *buf, size_t count);
int must_check user_read_task(struct task *task, addr_t addr, void *buf, size_t count);
int must_check user_write_task(struct task *task, addr_t addr, const void *buf, size_t count);
int must_check user_write_task_ptrace(struct task *task, addr_t addr, const void *buf, size_t count);
int must_check user_read_string(addr_t addr, char *buf, size_t max);
int must_check user_write_string(addr_t addr, const char *buf);
#define user_get(addr, var) user_read(addr, &(var), sizeof(var))
#define user_put(addr, var) user_write(addr, &(var), sizeof(var))
#define user_get_task(task, addr, var) user_read_task(task, addr, &(var), sizeof(var))
#define user_put_task(task, addr, var) user_write_task(task, addr, &(var), sizeof(var))

// process lifecycle
dword_t sys_clone(dword_t flags, addr_t stack, addr_t ptid, addr_t tls, addr_t ctid);
dword_t sys_clone3(addr_t args, size_t size);
dword_t sys_fork(void);
dword_t sys_vfork(void);
dword_t sys_execve(addr_t file, addr_t argv, addr_t envp);
int do_execve(const char *file, size_t argc, const char *argv, const char *envp);
dword_t sys_exit(dword_t status);
noreturn void do_exit(int status);
noreturn void do_exit_group(int status);
dword_t sys_exit_group(dword_t status);
dword_t sys_wait4(pid_t_ pid, addr_t status_addr, dword_t options, addr_t rusage_addr);
dword_t sys_waitid(int_t idtype, pid_t_ id, addr_t info_addr, int_t options);
dword_t sys_waitpid(pid_t_ pid, addr_t status_addr, dword_t options);

// memory management
addr_t sys_brk(addr_t new_brk);

#define MMAP_SHARED 0x1
#define MMAP_PRIVATE 0x2
#define MMAP_FIXED 0x10
#define MMAP_ANONYMOUS 0x20
#define MMAP_NORESERVE 0x4000
addr_t sys_mmap(addr_t args_addr);
addr_t sys_mmap2(addr_t addr, dword_t len, dword_t prot, dword_t flags, fd_t fd_no, dword_t offset);
addr_t sys_mmap64(addr_t addr, addr_t len, dword_t prot, dword_t flags, fd_t fd_no, qword_t offset);
int_t sys_munmap(addr_t addr, addr_t len);
int_t sys_mprotect(addr_t addr, addr_t len, int_t prot);
addr_t sys_mremap(addr_t addr, dword_t old_len, dword_t new_len, dword_t flags);
dword_t sys_madvise(addr_t addr, dword_t len, dword_t advice);
dword_t sys_mbind(addr_t addr, dword_t len, int_t mode, addr_t nodemask, dword_t maxnode, uint_t flags);
int_t sys_mlock(addr_t addr, dword_t len);
int_t sys_msync(addr_t addr, dword_t len, int_t flags);

// ARM64-specific memory management syscalls
dword_t sys_fadvise64(fd_t f, uint64_t offset, uint64_t len, dword_t advice);
dword_t sys_mincore(addr_t addr, dword_t length, addr_t vec_addr);

// file descriptor things
#define LOCK_SH_ 1
#define LOCK_EX_ 2
#define LOCK_NB_ 4
#define LOCK_UN_ 8
struct iovec_ {
    addr_t base;
    uint_t len;
};

// ARM64 uses 64-bit pointers and size_t in iovec
struct iovec64_ {
    uint64_t base;
    uint64_t len;
};
dword_t sys_read(fd_t fd_no, addr_t buf_addr, dword_t size);
dword_t sys_readv(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count);
dword_t sys_preadv(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off);
dword_t sys_preadv2(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off, dword_t flags);
dword_t sys_write(fd_t fd_no, addr_t buf_addr, dword_t size);
dword_t sys_writev(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count);
dword_t sys_pwritev(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off);
dword_t sys_pwritev2(fd_t fd_no, addr_t iovec_addr, dword_t iovec_count, off_t_ off, dword_t flags);
dword_t sys__llseek(fd_t f, dword_t off_high, dword_t off_low, addr_t res_addr, dword_t whence);
dword_t sys_lseek(fd_t f, dword_t off, dword_t whence);
qword_t sys_lseek64(fd_t f, sqword_t off, dword_t whence);
dword_t sys_pread(fd_t f, addr_t buf_addr, dword_t buf_size, off_t_ off);
dword_t sys_pwrite(fd_t f, addr_t buf_addr, dword_t size, off_t_ off);
dword_t sys_ioctl(fd_t f, dword_t cmd, addr_t arg);
dword_t sys_fcntl(fd_t f, dword_t cmd, addr_t arg);
dword_t sys_fcntl32(fd_t fd, dword_t cmd, addr_t arg);
dword_t sys_dup(fd_t fd);
dword_t sys_dup2(fd_t fd, fd_t new_fd);
dword_t sys_dup3(fd_t f, fd_t new_f, int_t flags);
dword_t sys_close(fd_t fd);
dword_t sys_close_range(uint_t first, uint_t last, uint_t flags);
dword_t sys_fsync(fd_t f);
dword_t sys_flock(fd_t fd, dword_t operation);
int_t sys_pipe(addr_t pipe_addr);
int_t sys_pipe2(addr_t pipe_addr, int_t flags);
struct pollfd_ {
    fd_t fd;
    word_t events;
    word_t revents;
};
dword_t sys_poll(addr_t fds, dword_t nfds, int_t timeout);
dword_t sys_select(fd_t nfds, addr_t readfds_addr, addr_t writefds_addr, addr_t exceptfds_addr, addr_t timeout_addr);
dword_t sys_pselect(fd_t nfds, addr_t readfds_addr, addr_t writefds_addr, addr_t exceptfds_addr, addr_t timeout_addr, addr_t sigmask_addr);
dword_t sys_ppoll(addr_t fds, dword_t nfds, addr_t timeout_addr, addr_t sigmask_addr, dword_t sigsetsize);
fd_t sys_epoll_create(int_t flags);
fd_t sys_epoll_create0(void);
int_t sys_epoll_ctl(fd_t epoll, int_t op, fd_t fd, addr_t event_addr);
int_t sys_epoll_wait(fd_t epoll, addr_t events_addr, int_t max_events, int_t timeout);
int_t sys_epoll_pwait(fd_t epoll_f, addr_t events_addr, int_t max_events, int_t timeout, addr_t sigmask_addr, dword_t sigsetsize);

int_t sys_eventfd2(uint_t initval, int_t flags);
int_t sys_pidfd_open(pid_t_ pid, uint_t flags);
void pidfd_notify_exit(pid_t_ pid);
int_t sys_eventfd(uint_t initval);

fd_t sys_inotify_init1(int_t flags);
fd_t sys_inotify_init(void);
int_t sys_inotify_add_watch(fd_t fd, addr_t path_addr, uint_t mask);
int_t sys_inotify_rm_watch(fd_t fd, int_t wd);

// file management
fd_t sys_open(addr_t path_addr, dword_t flags, mode_t_ mode);
fd_t sys_openat(fd_t at, addr_t path_addr, dword_t flags, mode_t_ mode);
fd_t sys_openat2(fd_t at, addr_t path_addr, addr_t how_addr, size_t size);
dword_t sys_close(fd_t fd);
dword_t sys_link(addr_t src_addr, addr_t dst_addr);
dword_t sys_linkat(fd_t src_at_f, addr_t src_addr, fd_t dst_at_f, addr_t dst_addr);
dword_t sys_unlink(addr_t path_addr);
dword_t sys_unlinkat(fd_t at_f, addr_t path_addr, int_t flags);
dword_t sys_rmdir(addr_t path_addr);
dword_t sys_rename(addr_t src_addr, addr_t dst_addr);
dword_t sys_renameat(fd_t src_at_f, addr_t src_addr, fd_t dst_at_f, addr_t dst_addr);
dword_t sys_renameat2(fd_t src_at_f, addr_t src_addr, fd_t dst_at_f, addr_t dst_addr, int_t flags);
dword_t sys_symlink(addr_t target_addr, addr_t link_addr);
dword_t sys_symlinkat(addr_t target_addr, fd_t at_f, addr_t link_addr);
dword_t sys_mknod(addr_t path_addr, mode_t_ mode, dev_t_ dev);
dword_t sys_mknodat(fd_t at_f, addr_t path_addr, mode_t_ mode, dev_t_ dev);
dword_t sys_access(addr_t path_addr, dword_t mode);
dword_t sys_faccessat(fd_t at_f, addr_t path, mode_t_ mode, dword_t flags);
dword_t sys_faccessat2(fd_t at_f, addr_t path, mode_t_ mode, dword_t flags);
dword_t sys_readlink(addr_t path, addr_t buf, dword_t bufsize);
dword_t sys_readlinkat(fd_t at_f, addr_t path, addr_t buf, dword_t bufsize);
int_t sys_getdents(fd_t f, addr_t dirents, dword_t count);
int_t sys_getdents64(fd_t f, addr_t dirents, dword_t count);
dword_t sys_stat64(addr_t path_addr, addr_t statbuf_addr);
dword_t sys_lstat64(addr_t path_addr, addr_t statbuf_addr);
dword_t sys_fstat64(fd_t fd_no, addr_t statbuf_addr);
dword_t sys_fstatat64(fd_t at, addr_t path_addr, addr_t statbuf_addr, dword_t flags);
dword_t sys_fchmod(fd_t f, dword_t mode);
dword_t sys_fchmodat(fd_t at_f, addr_t path_addr, dword_t mode);
dword_t sys_fchmodat2(fd_t at_f, addr_t path_addr, dword_t mode, dword_t flags);
dword_t sys_chmod(addr_t path_addr, dword_t mode);
dword_t sys_fchown32(fd_t f, dword_t owner, dword_t group);
dword_t sys_fchownat(fd_t at_f, addr_t path_addr, dword_t owner, dword_t group, int flags);
dword_t sys_chown32(addr_t path_addr, uid_t_ owner, uid_t_ group);
dword_t sys_lchown(addr_t path_addr, uid_t_ owner, uid_t_ group);
dword_t sys_truncate64(addr_t path_addr, off_t_ size);
dword_t sys_ftruncate64(fd_t f, off_t_ size);
dword_t sys_fallocate(fd_t f, dword_t mode, off_t_ offset, off_t_ len);
dword_t sys_mkdir(addr_t path_addr, mode_t_ mode);
dword_t sys_mkdirat(fd_t at_f, addr_t path_addr, mode_t_ mode);
dword_t sys_utimensat(fd_t at_f, addr_t path_addr, addr_t times_addr, dword_t flags);
dword_t sys_utimes(addr_t path_addr, addr_t times_addr);
dword_t sys_utime(addr_t path_addr, addr_t times_addr);
dword_t sys_times( addr_t tbuf);
dword_t sys_umask(dword_t mask);

dword_t sys_sendfile(fd_t out_fd, fd_t in_fd, addr_t offset_addr, dword_t count);
dword_t sys_sendfile64(fd_t out_fd, fd_t in_fd, addr_t offset_addr, dword_t count);
dword_t sys_splice(fd_t in_fd, addr_t in_off_addr, fd_t out_fd, addr_t out_off_addr, dword_t count, dword_t flags);
dword_t sys_copy_file_range(fd_t in_fd, addr_t in_off, fd_t out_fd, addr_t out_off, dword_t len, uint_t flags);

int_t sys_memfd_create(addr_t name_addr, uint_t flags);
ssize_t sys_process_vm_readv(pid_t_ pid, addr_t local_iov_addr, dword_t local_iovcnt, addr_t remote_iov_addr, dword_t remote_iovcnt, dword_t flags);
ssize_t sys_process_vm_writev(pid_t_ pid, addr_t local_iov_addr, dword_t local_iovcnt, addr_t remote_iov_addr, dword_t remote_iovcnt, dword_t flags);

int_t sys_msgget(int_t key, int_t msgflg);
int_t sys_msgctl(int_t msqid, int_t cmd, addr_t buf_addr);
int_t sys_msgsnd(int_t msqid, addr_t msgp, size_t msgsz, int_t msgflg);
ssize_t sys_msgrcv(int_t msqid, addr_t msgp, size_t msgsz, int64_t msgtyp, int_t msgflg);
int_t sys_semget(int_t key, int_t nsems, int_t semflg);
int_t sys_semctl(int_t semid, int_t semnum, int_t cmd, addr_t arg);
int_t sys_semtimedop(int_t semid, addr_t sops_addr, size_t nsops, addr_t timeout_addr);
int_t sys_semop(int_t semid, addr_t sops_addr, size_t nsops);

int_t sys_mq_open(addr_t name_addr, int_t oflag, mode_t_ mode, addr_t attr_addr);
int_t sys_mq_unlink(addr_t name_addr);
int_t sys_mq_timedsend(fd_t mqdes, addr_t msg_ptr, size_t msg_len, uint_t msg_prio, addr_t abs_timeout_addr);
ssize_t sys_mq_timedreceive(fd_t mqdes, addr_t msg_ptr, size_t msg_len, addr_t msg_prio_addr, addr_t abs_timeout_addr);
int_t sys_mq_notify(fd_t mqdes, addr_t notification_addr);
int_t sys_mq_getsetattr(fd_t mqdes, addr_t newattr_addr, addr_t oldattr_addr);

int_t sys_shmget(int_t key, size_t size, int_t shmflg);
int_t sys_shmctl(int_t shmid, int_t cmd, addr_t buf_addr);
addr_t sys_shmat(int_t shmid, addr_t shmaddr, int_t shmflg);
int_t sys_shmdt(addr_t shmaddr);

dword_t sys_statfs(addr_t path_addr, addr_t buf_addr);
dword_t sys_statfs64(addr_t path_addr, dword_t buf_size, addr_t buf_addr);
dword_t sys_fstatfs(fd_t f, addr_t buf_addr);
dword_t sys_fstatfs64(fd_t f, addr_t buf_addr);
dword_t sys_statfs_arm64(addr_t path_addr, addr_t buf_addr);
dword_t sys_fstatfs_arm64(fd_t f, addr_t buf_addr);
dword_t sys_statx(fd_t at_f, addr_t path_addr, int_t flags, uint_t mask, addr_t statx_addr);

#define MS_READONLY_ (1 << 0)
#define MS_NOSUID_ (1 << 1)
#define MS_NODEV_ (1 << 2)
#define MS_NOEXEC_ (1 << 3)
#define MS_SILENT_ (1 << 15)
dword_t sys_mount(addr_t source_addr, addr_t target_addr, addr_t type_addr, dword_t flags, addr_t data_addr);
dword_t sys_umount2(addr_t target_addr, dword_t flags);

dword_t sys_xattr_stub(addr_t path_addr, addr_t name_addr, addr_t value_addr, dword_t size, dword_t flags);

// process information
pid_t_ sys_getpid(void);
pid_t_ sys_gettid(void);
pid_t_ sys_getppid(void);
pid_t_ sys_getpgid(pid_t_ pid);
dword_t sys_setpgid(pid_t_ pid, pid_t_ pgid);
pid_t_ sys_getpgrp(void);
dword_t sys_setpgrp(void);
uid_t_ sys_getuid32(void);
uid_t_ sys_getuid(void);
int_t sys_setuid(uid_t uid);
uid_t_ sys_geteuid32(void);
uid_t_ sys_geteuid(void);
int_t sys_setgid(uid_t gid);
uid_t_ sys_getgid32(void);
uid_t_ sys_getgid(void);
uid_t_ sys_getegid32(void);
uid_t_ sys_getegid(void);
dword_t sys_setresuid(uid_t_ ruid, uid_t_ euid, uid_t_ suid);
dword_t sys_setresgid(uid_t_ rgid, uid_t_ egid, uid_t_ sgid);
int_t sys_setreuid(uid_t_ ruid, uid_t_ euid);
int_t sys_setregid(uid_t_ rgid, uid_t_ egid);
int_t sys_getresuid(addr_t ruid_addr, addr_t euid_addr, addr_t suid_addr);
int_t sys_getresgid(addr_t rgid_addr, addr_t egid_addr, addr_t sgid_addr);
int_t sys_getgroups(dword_t size, addr_t list);
int_t sys_setgroups(dword_t size, addr_t list);
int_t sys_capget(addr_t header_addr, addr_t data_addr);
int_t sys_capset(addr_t header_addr, addr_t data_addr);
dword_t sys_getcwd(addr_t buf_addr, dword_t size);
dword_t sys_chdir(addr_t path_addr);
dword_t sys_chroot(addr_t path_addr);
dword_t sys_fchdir(fd_t f);
int_t sys_personality(dword_t pers);
int task_set_thread_area(struct task *task, addr_t u_info);
int sys_set_thread_area(addr_t u_info);
int sys_set_tid_address(addr_t blahblahblah);
dword_t sys_setsid(void);
dword_t sys_getsid(void);

int_t sys_sched_yield(void);
int_t sys_prctl(dword_t option, addr_t arg2, addr_t arg3, addr_t arg4, addr_t arg5);
int_t sys_arch_prctl(int_t code, addr_t addr);
int_t sys_membarrier(int_t cmd, dword_t flags, int_t cpu_id);
int_t sys_rseq(addr_t rseq_addr, dword_t rseq_len, int_t flags, dword_t sig);
int_t sys_reboot(int_t magic, int_t magic2, int_t cmd);

// system information
#define UNAME_LENGTH 65
struct uname {
    char system[UNAME_LENGTH];   // Linux
    char hostname[UNAME_LENGTH]; // my-compotar
    char release[UNAME_LENGTH];  // 1.2.3-linuxkit
    char version[UNAME_LENGTH];  // Block Emulation
    char arch[UNAME_LENGTH];     // aarch64
    char domain[UNAME_LENGTH];   // lol
};
void do_uname(struct uname *uts);
dword_t sys_uname(addr_t uts_addr);
dword_t sys_sethostname(addr_t hostname_addr, dword_t hostname_len);

// ARM64 sysinfo struct: uses 64-bit long types (112 bytes total with padding)
struct sys_info {
    uint64_t uptime;
    uint64_t loads[3];
    uint64_t totalram;
    uint64_t freeram;
    uint64_t sharedram;
    uint64_t bufferram;
    uint64_t totalswap;
    uint64_t freeswap;
    uint16_t procs;
    uint16_t _pad1;          // padding
    uint32_t _pad2;          // padding
    uint64_t totalhigh;
    uint64_t freehigh;
    uint32_t mem_unit;
    uint32_t _pad3;          // padding for alignment
};
dword_t sys_sysinfo(addr_t info_addr);

// futexes
dword_t sys_futex(addr_t uaddr, dword_t op, dword_t val, addr_t timeout_or_val2, addr_t uaddr2, dword_t val3);
int_t sys_set_robust_list(addr_t robust_list, dword_t len);
int_t sys_get_robust_list(pid_t_ pid, addr_t robust_list_ptr, addr_t len_ptr);

// misc
dword_t sys_getrandom(addr_t buf_addr, dword_t len, dword_t flags);
int_t sys_syslog(int_t type, addr_t buf_addr, int_t len);
int_t sys_ipc(uint_t call, int_t first, int_t second, int_t third, addr_t ptr, int_t fifth);

// ARM64 syscalls pass 64-bit register values; functions taking dword_t
// will implicitly truncate, while those taking off_t_/qword_t get full values.
// Returns int64_t so addr_t-returning syscalls (mmap, brk) can pass 48-bit values.
typedef int64_t (*syscall_t)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);

// Stub for unimplemented syscalls
dword_t syscall_stub(void);
dword_t syscall_silent_stub(void);
dword_t syscall_success_stub(void);


#endif
