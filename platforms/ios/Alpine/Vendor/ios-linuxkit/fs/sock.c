#include <fcntl.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include "kernel/calls.h"
#include "fs/fd.h"
#include "fs/inode.h"
#include "fs/path.h"
#include "fs/real.h"
#include "fs/sock.h"
#include "debug.h"

#define SOCKET_TYPE_MASK 0xf

const struct fd_ops socket_fdops;

static lock_t peer_lock = LOCK_INITIALIZER;

static fd_t sock_fd_create(int sock_fd, int domain, int type, int protocol) {
    struct fd *fd = adhoc_fd_create(&socket_fdops);
    if (fd == NULL)
        return _ENOMEM;
    fd->stat.mode = S_IFSOCK | 0666;
    fd->real_fd = sock_fd;
    fd->socket.domain = domain;
    fd->socket.type = type & SOCKET_TYPE_MASK;
    fd->socket.protocol = protocol;
    if (domain == AF_LOCAL_) {
        cond_init(&fd->socket.unix_got_peer);
        list_init(&fd->socket.unix_scm);
    }
    return f_install(fd, type & ~SOCKET_TYPE_MASK);
}

int_t sys_socket(dword_t domain, dword_t type, dword_t protocol) {
    STRACE("socket(%d, %d, %d)", domain, type, protocol);
    int real_domain = sock_family_to_real(domain);
    if (real_domain < 0)
        return _EAFNOSUPPORT;
    int real_type = sock_type_to_real(type, protocol);
    if (real_type < 0)
        return _EINVAL;

    // this hack makes mtr work
    if (type == SOCK_RAW_ && protocol == IPPROTO_RAW)
        protocol = IPPROTO_ICMP;

    int sock = socket(real_domain, real_type, protocol);
    if (sock < 0)
        return errno_map();

#ifdef __APPLE__
    if (domain == AF_INET_ && type == SOCK_DGRAM_) {
        // in some cases, such as ICMP, datagram sockets on mac can default to
        // including the IP header like raw sockets
        int one = 1;
        setsockopt(sock, IPPROTO_IP, IP_STRIPHDR, &one, sizeof(one));
    }
#endif

    fd_t f = sock_fd_create(sock, domain, type, protocol);
    if (f < 0)
        close(sock);
    return f;
}

static void inode_release_if_exist(struct inode_data *inode) {
    if (inode != NULL)
        inode_release(inode);
}

static struct fd *sock_getfd(fd_t sock_fd) {
    struct fd *sock = f_get(sock_fd);
    if (sock == NULL || sock->ops != &socket_fdops)
        return NULL;
    return sock;
}

static uint32_t unix_socket_next_id() {
    static uint32_t next_id = 0;
    static lock_t next_id_lock = LOCK_INITIALIZER;
    lock(&next_id_lock);
    uint32_t id = ++next_id;
    unlock(&next_id_lock);
    return id;
}

static int unix_socket_get(const char *path_raw, struct fd *bind_fd, uint32_t *socket_id) {
    char path[MAX_PATH];
    int err = path_normalize(AT_PWD, path_raw, path, N_SYMLINK_FOLLOW);
    if (err < 0)
        return err;
    struct mount *mount = find_mount_and_trim_path(path);
    struct statbuf stat;
    err = mount->fs->stat(mount, path, &stat);

    // If bind was called, there are some funny semantics.
    if (bind_fd != NULL) {
        // If the file exists, fail.
        if (err == 0) {
            err = _EADDRINUSE;
            goto out;
        }
        // If the file can't be found, try to create it as a socket.
        if (err < 0) {
            mode_t_ mode = 0777;
            struct fs_info *fs = current->fs;
            lock(&fs->lock);
            mode &= ~fs->umask;
            unlock(&fs->lock);
            err = mount->fs->mknod(mount, path, S_IFSOCK | mode, 0);
            if (err < 0)
                goto out;
            err = mount->fs->stat(mount, path, &stat);
            if (err < 0)
                goto out;
        }
    }

    // If something other than bind was called, just do the obvious thing and
    // fail if stat failed.
    if (bind_fd == NULL && err < 0)
        goto out;

    if (!S_ISSOCK(stat.mode)) {
        err = _ENOTSOCK;
        goto out;
    }

    // Look up the socket ID for the inode number.
    struct inode_data *inode = inode_get(mount, stat.inode);
    if (inode == NULL) {
        err = _ENOMEM;
        goto out;
    }
    lock(&inode->lock);
    if (inode->socket_id == 0)
        inode->socket_id = unix_socket_next_id();
    unlock(&inode->lock);
    *socket_id = inode->socket_id;

    mount_release(mount);
    if (bind_fd != NULL)
        bind_fd->socket.unix_name_inode = inode;
    else
        inode_release(inode);
    return 0;

out:
    mount_release(mount);
    return err;
}

// Dan Bernstein's simple and decently effective hash function
static uint32_t str_hash(const char *str) {
    uint32_t hash = 5381;
    for (int i = 0; str[i] != '\0'; i++) {
        hash = 33 * hash ^ str[i];
    }
    return hash;
}

// The abstract socket namespace is a lot simpler than it sounds: if the first
// byte of the path is a null byte, then it gets looked up in this hashtable
// instead of the filesystem.

struct unix_abstract {
    unsigned refcount;
    uint32_t hash;
    uint32_t socket_id;
    struct list links;
};
#define ABSTRACT_HASH_SIZE 1024
static struct list abstract_hash[ABSTRACT_HASH_SIZE];
static lock_t unix_abstract_lock = LOCK_INITIALIZER;

static int unix_abstract_get(const char *name, struct fd *bind_fd, uint32_t *socket_id) {
    uint32_t hash = str_hash(name);
    lock(&unix_abstract_lock);
    struct unix_abstract *sock_tmp;
    struct unix_abstract *sock = NULL;
    struct list *bucket = &abstract_hash[hash % ABSTRACT_HASH_SIZE];
    if (list_null(bucket))
        list_init(bucket);
    list_for_each_entry(bucket, sock_tmp, links) {
        if (sock_tmp->hash == hash) {
            sock = sock_tmp;
            break;
        }
    }

    if (bind_fd != NULL && sock != NULL) {
        unlock(&unix_abstract_lock);
        return _EEXIST;
    }
    if (bind_fd == NULL && sock == NULL) {
        unlock(&unix_abstract_lock);
        return _ENOENT;
    }

    if (sock == NULL) {
        sock = malloc(sizeof(struct unix_abstract));
        if (sock == NULL) {
            unlock(&unix_abstract_lock);
            return _ENOMEM;
        }
        sock->refcount = 0;
        sock->hash = hash;
        sock->socket_id = unix_socket_next_id();
        list_add(bucket, &sock->links);
    }

    sock->refcount++;
    unlock(&unix_abstract_lock);
    *socket_id = sock->socket_id;
    if (bind_fd != NULL)
        bind_fd->socket.unix_name_abstract = sock;
    return 0;
}

static void unix_abstract_release(struct unix_abstract *name) {
    lock(&unix_abstract_lock);
    if (--name->refcount == 0) {
        list_remove(&name->links);
        free(name);
    }
    unlock(&unix_abstract_lock);
}

const char *sock_tmp_prefix = "/tmp/ishsock";

static int sockaddr_read_bind(addr_t sockaddr_addr, void *sockaddr, uint_t *sockaddr_len, struct fd *bind_fd) {
    // Make sure we can read things without overflowing buffers
    if (*sockaddr_len < 2)
        return _EINVAL;
    if (*sockaddr_len > sizeof(struct sockaddr_max_))
        return _EINVAL;

    if (user_read(sockaddr_addr, sockaddr, *sockaddr_len))
        return _EFAULT;
    struct sockaddr *real_addr = sockaddr;
    struct sockaddr_ *fake_addr = sockaddr;
    real_addr->sa_family = sock_family_to_real(fake_addr->family);

    switch (real_addr->sa_family) {
        case PF_INET:
            if (*sockaddr_len < sizeof(struct sockaddr_in))
                return _EINVAL;
            break;
        case PF_INET6:
            if (*sockaddr_len < sizeof(struct sockaddr_in6))
                return _EINVAL;
            break;

        case PF_LOCAL: {
            // First pull out the path, being careful to not overflow anything.
            char path[SOCKADDR_DATA_MAX + 1];
            size_t path_size = *sockaddr_len - offsetof(struct sockaddr_, data);
            memcpy(path, fake_addr->data, path_size);
            path[path_size] = '\0';

            uint32_t socket_id;
            int err;
            if (path_size == 0) {
                return _ENOENT;
            } else if (path[0] != '\0') {
                STRACE(" unix socket %s", path);
                err = unix_socket_get(path, bind_fd, &socket_id);
            } else {
                STRACE(" unix abstract socket %s", path + 1);
                err = unix_abstract_get(path + 1, bind_fd, &socket_id);
            }
            if (err < 0)
                return err;
            if (bind_fd != NULL) {
                bind_fd->socket.unix_name_len = path_size;
                memcpy(bind_fd->socket.unix_name, path, path_size);
            }

            struct sockaddr_un *real_addr_un = sockaddr;
            int path_len = snprintf(real_addr_un->sun_path, sizeof(real_addr_un->sun_path),
                                    "%s%d.%u", sock_tmp_prefix, getpid(), socket_id);
            if (path_len < 0 || (size_t) path_len >= sizeof(real_addr_un->sun_path))
                return _ENAMETOOLONG;
            // The call to real bind will fail if the backing socket already
            // exists from a previous run or something. We already checked that
            // the fake file doesn't exist in unix_socket_get, so try a simple
            // solution.
            if (bind_fd != NULL)
                unlink(real_addr_un->sun_path);
            *sockaddr_len = offsetof(struct sockaddr_un, sun_path) + path_len;
            break;
        }
        default:
            return _EINVAL;
    }
    return 0;
}

static int sockaddr_read(addr_t sockaddr_addr, void *sockaddr, uint_t *sockaddr_len) {
    return sockaddr_read_bind(sockaddr_addr, sockaddr, sockaddr_len, NULL);
}

static int sockaddr_write(addr_t sockaddr_addr, void *sockaddr, uint_t buffer_len, uint_t *sockaddr_len) {
    struct sockaddr *real_addr = sockaddr;
    struct sockaddr_ *fake_addr = sockaddr;
    fake_addr->family = sock_family_from_real(real_addr->sa_family);
    switch (fake_addr->family) {
        case PF_LOCAL_: {
            // Most callers of sockaddr_write use it to return a peer name, and
            // since we don't know the peer name in this case, just return the
            // default peer name, which is the null address.
            static struct sockaddr_ unix_domain_null = {.family = PF_LOCAL_};
            sockaddr = &unix_domain_null;
            *sockaddr_len = sizeof(unix_domain_null);
            break;
        }
        case PF_INET_:
        case PF_INET6_:
            break;
        default:
            return _EINVAL;
    }

    if (buffer_len > *sockaddr_len)
        buffer_len = *sockaddr_len;
    // The address is supposed to be truncated if the specified length is too
    // short, instead of returning an error.
    if (user_write(sockaddr_addr, sockaddr, buffer_len))
        return _EFAULT;
    return 0;
}

int_t sys_bind(fd_t sock_fd, addr_t sockaddr_addr, uint_t sockaddr_len) {
    STRACE("bind(%d, 0x%x, %d)", sock_fd, sockaddr_addr, sockaddr_len);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    struct sockaddr_max_ sockaddr;
    int err = sockaddr_read_bind(sockaddr_addr, &sockaddr, &sockaddr_len, sock);
    if (err < 0)
        return err;

    err = bind(sock->real_fd, (void *) &sockaddr, sockaddr_len);
    if (err < 0) {
        inode_release_if_exist(sock->socket.unix_name_inode);
        sock->socket.unix_name_inode = NULL;
        if (sock->socket.unix_name_abstract != NULL) {
            unix_abstract_release(sock->socket.unix_name_abstract);
            sock->socket.unix_name_abstract = NULL;
        }
        return errno_map();
    }
    return 0;
}

static void fill_cred(struct ucred_ *cred) {
    cred->pid = current->pid;
    cred->uid = current->euid;
    cred->gid = current->egid;
}

int_t sys_connect(fd_t sock_fd, addr_t sockaddr_addr, uint_t sockaddr_len) {
    STRACE("connect(%d, 0x%x, %d)", sock_fd, sockaddr_addr, sockaddr_len);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    struct sockaddr_max_ sockaddr;
    int err = sockaddr_read(sockaddr_addr, &sockaddr, &sockaddr_len);
    if (err < 0)
        return err;

    err = connect(sock->real_fd, (void *) &sockaddr, sockaddr_len);
    if (err < 0) {
        int ce = errno;
        // Log connect failures except the routine nonblock in-progress case,
        // so VPN / routing issues are visible in user-shared logs.
        if (ce != EINPROGRESS && ce != EALREADY) {
            printk("NETDIAG connect(pid=%d comm=%s fd=%d) errno=%d\n",
                   current->pid, current->comm, sock_fd, ce);
        }
        errno = ce;
        return errno_map();
    }

    if (sock->socket.domain == AF_LOCAL_) {
        fill_cred(&sock->socket.unix_cred);
        assert(sock->socket.unix_peer == NULL);
        // Send a pointer to ourselves to the other end so they can set up the peer pointers.
        ssize_t res = write(sock->real_fd, &sock, sizeof(struct fd *));
        if (res == sizeof(struct fd *)) {
            // Wait for acknowledgement that it happened.
            lock(&peer_lock);
            while (sock->socket.unix_peer == NULL)
                wait_for_ignore_signals(&sock->socket.unix_got_peer, &peer_lock, NULL);
            unlock(&peer_lock);
        }
    }

    return err;
}

int_t sys_listen(fd_t sock_fd, int_t backlog) {
    STRACE("listen(%d, %d)", sock_fd, backlog);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    int err = listen(sock->real_fd, backlog);
    if (err < 0)
        return errno_map();
    sockrestart_begin_listen(sock);
    return err;
}

int_t sys_accept(fd_t sock_fd, addr_t sockaddr_addr, addr_t sockaddr_len_addr) {
    STRACE("accept(%d, 0x%x, 0x%x)", sock_fd, sockaddr_addr, sockaddr_len_addr);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    dword_t sockaddr_len = 0;
    dword_t sockaddr_buffer_len = 0;
    if (sockaddr_addr != 0) {
        if (sockaddr_len_addr == 0 || user_get(sockaddr_len_addr, sockaddr_len))
            return _EFAULT;
        if (sockaddr_len > sizeof(struct sockaddr_max_))
            sockaddr_len = sizeof(struct sockaddr_max_);
        sockaddr_buffer_len = sockaddr_len;
    }

    struct sockaddr_max_ sockaddr;
    int client;
    do {
        sockrestart_begin_listen_wait(sock);
        errno = 0;
        client = accept(sock->real_fd,
                sockaddr_addr != 0 ? (void *) &sockaddr : NULL,
                sockaddr_addr != 0 ? &sockaddr_len : NULL);
        sockrestart_end_listen_wait(sock);
    } while (sockrestart_should_restart_listen_wait() && errno == EINTR);
    if (client < 0)
        return errno_map();

    if (sockaddr_addr != 0) {
        int err = sockaddr_write(sockaddr_addr, &sockaddr, sockaddr_buffer_len, &sockaddr_len);
        if (err < 0) {
            close(client);
            return err;
        }
        if (user_put(sockaddr_len_addr, sockaddr_len)) {
            close(client);
            return _EFAULT;
        }
    }

    fd_t client_f = sock_fd_create(client,
            sock->socket.domain, sock->socket.type, sock->socket.protocol);
    if (client_f < 0) {
        close(client);
        return client_f;
    }

    if (sock->socket.domain == AF_LOCAL_) {
        lock(&peer_lock);
        struct fd *client_fd = f_get(client_f);
        fill_cred(&client_fd->socket.unix_cred);
        struct fd *peer;
        ssize_t res = read(client, &peer, sizeof(peer));
        if (res == sizeof(peer)) {
            client_fd->socket.unix_peer = peer;
            peer->socket.unix_peer = client_fd;
            notify(&peer->socket.unix_got_peer);
        }
        unlock(&peer_lock);
    }

    return client_f;
}

int_t sys_accept4(fd_t sock_fd, addr_t sockaddr_addr, addr_t sockaddr_len_addr, int_t flags) {
    STRACE("accept4(%d, 0x%x, 0x%x, 0x%x)", sock_fd, sockaddr_addr, sockaddr_len_addr, flags);
    if (flags & ~(SOCK_NONBLOCK_ | SOCK_CLOEXEC_))
        return _EINVAL;
    int_t client_f = sys_accept(sock_fd, sockaddr_addr, sockaddr_len_addr);
    if (client_f < 0)
        return client_f;
    struct fd *client_fd = f_get(client_f);
    if (client_fd != NULL) {
        if (flags & SOCK_NONBLOCK_)
            fd_setflags(client_fd, O_NONBLOCK_);
        if (flags & SOCK_CLOEXEC_) {
            lock(&current->files->lock);
            bit_set(client_f, current->files->cloexec);
            unlock(&current->files->lock);
        }
    }
    return client_f;
}

static int copy_unix_name(struct sockaddr_max_ *sockaddr, dword_t buffer_len, dword_t *sockaddr_len, struct fd *sock) {
    struct sockaddr_ *fake_addr = (void *) sockaddr;
    size_t name_len_full = sock->socket.unix_name_len;
    if (name_len_full > sizeof(sockaddr->data))
        name_len_full = sizeof(sockaddr->data);
    size_t full_len = offsetof(struct sockaddr_, data) + name_len_full;
    *sockaddr_len = full_len;
    if (buffer_len > sizeof(*sockaddr))
        buffer_len = sizeof(*sockaddr);
    if (buffer_len < offsetof(struct sockaddr_, data))
        return 0;

    fake_addr->family = PF_LOCAL_;
    size_t data_len = buffer_len - offsetof(struct sockaddr_, data);
    size_t name_len = name_len_full;
    if (name_len > data_len)
        name_len = data_len;
    memset(fake_addr->data, 0, data_len);
    memcpy(fake_addr->data, sock->socket.unix_name, name_len);
    return 0;
}

int_t sys_getsockname(fd_t sock_fd, addr_t sockaddr_addr, addr_t sockaddr_len_addr) {
    STRACE("getsockname(%d, 0x%x, 0x%x)", sock_fd, sockaddr_addr, sockaddr_len_addr);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    dword_t sockaddr_len;
    if (user_get(sockaddr_len_addr, sockaddr_len))
        return _EFAULT;
    dword_t sockaddr_buffer_len = sockaddr_len;
    if (sockaddr_len > sizeof(struct sockaddr_max_))
        sockaddr_len = sizeof(struct sockaddr_max_);
    struct sockaddr_max_ sockaddr;

    // if this is a unix socket, return the same string passed to bind
    if (sock->socket.domain == PF_LOCAL_) {
        int err = copy_unix_name(&sockaddr, sockaddr_buffer_len, &sockaddr_len, sock);
        if (err < 0)
            return err;
        size_t write_len = sockaddr_buffer_len < sockaddr_len ? sockaddr_buffer_len : sockaddr_len;
        if (write_len != 0 && user_write(sockaddr_addr, &sockaddr, write_len))
            return _EFAULT;
        if (user_put(sockaddr_len_addr, sockaddr_len))
            return _EFAULT;
        return 0;
    }

    int res = getsockname(sock->real_fd, (void *) &sockaddr, &sockaddr_len);
    if (res < 0)
        return errno_map();

    int err = sockaddr_write(sockaddr_addr, &sockaddr, sockaddr_buffer_len, &sockaddr_len);
    if (err < 0)
        return err;
    if (user_put(sockaddr_len_addr, sockaddr_len))
        return _EFAULT;
    return res;
}

int_t sys_getpeername(fd_t sock_fd, addr_t sockaddr_addr, addr_t sockaddr_len_addr) {
    STRACE("getpeername(%d, 0x%x, 0x%x)", sock_fd, sockaddr_addr, sockaddr_len_addr);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    dword_t sockaddr_len;
    if (user_get(sockaddr_len_addr, sockaddr_len))
        return _EFAULT;
    dword_t sockaddr_buffer_len = sockaddr_len;
    if (sockaddr_len > sizeof(struct sockaddr_max_))
        sockaddr_len = sizeof(struct sockaddr_max_);

    // TODO if this is a unix socket, return the same string the peer passed to
    // bind once the peer pointer is available

    struct sockaddr_max_ sockaddr;
    int res = getpeername(sock->real_fd, (void *) &sockaddr, &sockaddr_len);
    if (res < 0)
        return errno_map();

    int err = sockaddr_write(sockaddr_addr, &sockaddr, sockaddr_buffer_len, &sockaddr_len);
    if (err < 0)
        return err;
    if (user_put(sockaddr_len_addr, sockaddr_len))
        return _EFAULT;
    return res;
}

int_t sys_socketpair(dword_t domain, dword_t type, dword_t protocol, addr_t sockets_addr) {
    STRACE("socketpair(%d, %d, %d, 0x%x)", domain, type, protocol, sockets_addr);
    int real_domain = sock_family_to_real(domain);
    if (real_domain < 0)
        return _EAFNOSUPPORT;
    int real_type = sock_type_to_real(type, protocol);
    if (real_type < 0)
        return _EINVAL;

    int sockets[2];
    int err = socketpair(real_domain, real_type, protocol, sockets);
    if (err < 0)
        return errno_map();

    lock(&peer_lock);
    int fake_sockets[2];
    err = fake_sockets[0] = sock_fd_create(sockets[0], domain, type, protocol);
    if (fake_sockets[0] < 0) {
        unlock(&peer_lock);
        goto close_sockets;
    }
    err = fake_sockets[1] = sock_fd_create(sockets[1], domain, type, protocol);
    if (fake_sockets[1] < 0) {
        unlock(&peer_lock);
        goto close_fake_0;
    }
    struct fd *sock1 = f_get(fake_sockets[0]);
    struct fd *sock2 = f_get(fake_sockets[1]);
    sock1->socket.unix_peer = sock2;
    sock2->socket.unix_peer = sock1;
    unlock(&peer_lock);

    err = _EFAULT;
    if (user_put(sockets_addr, fake_sockets))
        goto close_fake_1;

    STRACE(" [%d, %d]", fake_sockets[0], fake_sockets[1]);
    return 0;

close_fake_1:
    sys_close(fake_sockets[1]);
close_fake_0:
    sys_close(fake_sockets[0]);
close_sockets:
    close(sockets[0]);
    close(sockets[1]);
    return err;
}

int_t sys_sendto(fd_t sock_fd, addr_t buffer_addr, dword_t len, dword_t flags, addr_t sockaddr_addr, dword_t sockaddr_len) {
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    char *buffer = malloc((size_t) len + 1);
    if (buffer == NULL)
        return _ENOMEM;
    if (user_read(buffer_addr, buffer, len)) {
        free(buffer);
        return _EFAULT;
    }
    buffer[len] = '\0';
    STRACE("sendto(%d, \"%.100s\", %d, %d, 0x%x, %d)", sock_fd, buffer, len, flags, sockaddr_addr, sockaddr_len);
    int real_flags = sock_flags_to_real(flags);
    int err = _EINVAL;
    if (real_flags < 0)
        goto error;
    struct sockaddr_max_ sockaddr;
    if (sockaddr_addr) {
        err = sockaddr_read(sockaddr_addr, &sockaddr, &sockaddr_len);
        if (err < 0)
            goto error;
    }

    ssize_t res = sendto(sock->real_fd, buffer, len, real_flags,
            sockaddr_addr ? (void *) &sockaddr : NULL, sockaddr_len);
    free(buffer);
    if (res < 0)
        return errno_map();
    return res;

error:
    free(buffer);
    return err;
}

// Read a socket timeout option as milliseconds. Returns 0 if unset or error.
static long sock_get_timeout_ms(int real_fd, int optname) {
    struct timeval tv = {0, 0};
    socklen_t len = sizeof(tv);
    if (getsockopt(real_fd, SOL_SOCKET, optname, &tv, &len) < 0)
        return 0;
    return (long)tv.tv_sec * 1000L + (long)tv.tv_usec / 1000L;
}

static long monotonic_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long)ts.tv_sec * 1000L + (long)ts.tv_nsec / 1000000L;
}

// Wait for a socket fd to become ready (readable or writable), with a
// bounded per-poll timeout so guest signals can interrupt even if the host
// thread is briefly suspended (iOS). Honors SO_RCVTIMEO / SO_SNDTIMEO as
// an overall deadline when set.
//
// Returns 0 when ready, _EINTR on guest signal, _EAGAIN on timeout expiry,
// or a negative errno on poll() error.
static int sock_wait_for(int real_fd, short events, int timeout_opt) {
    long timeout_ms = sock_get_timeout_ms(real_fd, timeout_opt);
    long start_ms = monotonic_ms();
    long deadline_ms = (timeout_ms > 0) ? (start_ms + timeout_ms) : 0;
    bool slow_logged = false;
    for (;;) {
        if (current->exiting || current->group->doing_group_exit)
            return _EINTR;
        if (current->sighand != NULL) {
            lock(&current->sighand->lock);
            bool pending = !!(current->pending & ~current->blocked);
            unlock(&current->sighand->lock);
            if (pending)
                return _EINTR;
        }

        // Keep this shorter than exit_group's safety-valve window so helper
        // threads blocked in recv/recvmsg can observe SIGKILL/exiting and
        // leave cleanly instead of being detached as leaked host threads.
        int poll_ms = 50;
        if (deadline_ms > 0) {
            long remaining = deadline_ms - monotonic_ms();
            if (remaining <= 0) {
                printk("NETDIAG sock_wait(pid=%d comm=%s fd=%d ev=%#x) deadline-expired after %ldms\n",
                       current->pid, current->comm, real_fd, events, timeout_ms);
                return _EAGAIN;
            }
            if (remaining < poll_ms)
                poll_ms = (int)remaining;
        }

        struct pollfd pfd = { .fd = real_fd, .events = events };
        current->blocking = true;
        int pr = poll(&pfd, 1, poll_ms);
        int saved_errno = errno;
        current->blocking = false;
        if (current->exiting || current->group->doing_group_exit)
            return _EINTR;

        if (pr > 0)
            return 0;
        if (pr == 0) {
            // Log once if we're stuck > 3 seconds without any ready event
            if (!slow_logged && (monotonic_ms() - start_ms) >= 3000) {
                printk("NETDIAG sock_wait(pid=%d comm=%s fd=%d ev=%#x) no-event for 3s (timeout_opt_ms=%ld)\n",
                       current->pid, current->comm, real_fd, events, timeout_ms);
                slow_logged = true;
            }
            continue;
        }
        if (saved_errno == EINTR)
            continue;
        errno = saved_errno;
        printk("NETDIAG sock_wait(pid=%d comm=%s fd=%d ev=%#x) poll err=%d\n",
               current->pid, current->comm, real_fd, events, saved_errno);
        return errno_map();
    }
}

static int sock_wait_readable(int real_fd) {
    return sock_wait_for(real_fd, POLLIN, SO_RCVTIMEO);
}

int_t sys_recvfrom(fd_t sock_fd, addr_t buffer_addr, dword_t len, dword_t flags, addr_t sockaddr_addr, addr_t sockaddr_len_addr) {
    STRACE("recvfrom(%d, 0x%x, %d, %d, 0x%x, 0x%x)", sock_fd, buffer_addr, len, flags, sockaddr_addr, sockaddr_len_addr);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    int real_flags = sock_flags_to_real(flags);
    if (real_flags < 0)
        return _EINVAL;
    uint_t sockaddr_len = 0;
    uint_t sockaddr_buffer_len = 0;
    if (sockaddr_len_addr != 0) {
        if (user_get(sockaddr_len_addr, sockaddr_len))
            return _EFAULT;
        sockaddr_buffer_len = sockaddr_len;
        if (sockaddr_len > sizeof(struct sockaddr_max_))
            sockaddr_len = sizeof(struct sockaddr_max_);
    }

    char *buffer = malloc(len);
    if (len != 0 && buffer == NULL)
        return _ENOMEM;
    struct sockaddr_max_ sockaddr;

    // Determine whether this call should wait for data:
    //   * guest flags MSG_DONTWAIT → never wait (explicit)
    //   * fd has O_NONBLOCK set   → never wait (fd-level nonblock)
    //
    // The second case is critical: musl's res_msend creates UDP sockets
    // with SOCK_NONBLOCK and then calls recv(fd, buf, len, 0). It relies
    // on the kernel returning EAGAIN immediately on empty buffer to
    // terminate its "drain all pending responses" loop. If we wait when
    // the fd itself is nonblock, musl loops forever and DNS resolution
    // appears to hang. We check both the iSH-level fd flags and the host
    // fd's real flags, in case they diverge (e.g. set via fcntl only).
    int host_flags = fcntl(sock->real_fd, F_GETFL, 0);
    bool host_nonblock = (host_flags >= 0) && (host_flags & O_NONBLOCK);
    bool guest_nonblock = (sock->flags & O_NONBLOCK_) != 0;
    bool should_wait = !(real_flags & MSG_DONTWAIT) && !guest_nonblock && !host_nonblock;

    // Try a nonblock recvfrom first (fast path — no host syscall overhead
    // when data is already buffered). Only if it returns EAGAIN and we
    // should wait do we fall back to the bounded-poll wait.
    ssize_t res;
    if (should_wait) {
        for (;;) {
            res = recvfrom(sock->real_fd, buffer, len, real_flags | MSG_DONTWAIT,
                    sockaddr_addr != 0 ? (void *) &sockaddr : NULL,
                    sockaddr_len_addr != 0 ? &sockaddr_len : NULL);
            if (res >= 0)
                break;
            if (errno == EINTR)
                continue;
            if (errno != EAGAIN && errno != EWOULDBLOCK) {
                free(buffer);
                return errno_map();
            }
            // EAGAIN: no data yet. Wait (bounded) for readability or a
            // guest signal, then retry.
            int wr = sock_wait_readable(sock->real_fd);
            if (wr < 0) {
                free(buffer);
                return wr;
            }
        }
    } else {
        res = recvfrom(sock->real_fd, buffer, len, real_flags,
                sockaddr_addr != 0 ? (void *) &sockaddr : NULL,
                sockaddr_len_addr != 0 ? &sockaddr_len : NULL);
        if (res < 0) {
            free(buffer);
            return errno_map();
        }
    }

    if (res > 0 && user_write(buffer_addr, buffer, (size_t) res)) {
        free(buffer);
        return _EFAULT;
    }
    free(buffer);
    if (sockaddr_addr != 0) {
        int err = sockaddr_write(sockaddr_addr, &sockaddr, sockaddr_buffer_len, &sockaddr_len);
        if (err < 0)
            return err;
    }
    if (sockaddr_len_addr != 0)
        if (user_put(sockaddr_len_addr, sockaddr_len))
            return _EFAULT;
    return res;
}

int_t sys_send(fd_t sock_fd, addr_t buf, dword_t len, int_t flags) {
    return sys_sendto(sock_fd, buf, len, flags, 0, 0);
}

int_t sys_recv(fd_t sock_fd, addr_t buf, dword_t len, int_t flags) {
    return sys_recvfrom(sock_fd, buf, len, flags, 0, 0);
}

int_t sys_shutdown(fd_t sock_fd, dword_t how) {
    STRACE("shutdown(%d, %d)", sock_fd, how);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    int err = shutdown(sock->real_fd, how);
    if (err < 0)
        return errno_map();
    return 0;
}

#define DEFAULT_TCP_CONGESTION "cubic"

int_t sys_setsockopt(fd_t sock_fd, dword_t level, dword_t option, addr_t value_addr, dword_t value_len) {
    STRACE("setsockopt(%d, %d, %d, 0x%x, %d)", sock_fd, level, option, value_addr, value_len);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;

    char *value = NULL;
    if (value_len != 0) {
        value = malloc(value_len);
        if (value == NULL)
            return _ENOMEM;
        if (user_read(value_addr, value, value_len)) {
            free(value);
            return _EFAULT;
        }
    }

    int ret = 0;

    // ICMP6_FILTER can only be set on real SOCK_RAW
    if (level == IPPROTO_ICMPV6 && option == ICMP6_FILTER_)
        goto out;
    // IP_MTU_DISCOVER has no equivalent on Darwin
    if (level == IPPROTO_IP && option == IP_MTU_DISCOVER_)
        goto out;
    // TCP_CONGESTION also has no equivalent on Darwin
#if defined(__APPLE__)
    if (level == IPPROTO_TCP && option == TCP_CONGESTION_) {
        size_t default_len = strlen(DEFAULT_TCP_CONGESTION);
        bool has_nul = value_len == default_len + 1 && value[default_len] == '\0';
        bool same_len = value_len == default_len || has_nul;
        if (same_len && memcmp(value, DEFAULT_TCP_CONGESTION, default_len) == 0)
            goto out;
        ret = _ENOENT;
        goto out;
    }
#endif

    int real_opt = sock_opt_to_real(option, level);
    if (real_opt < 0) {
        ret = _EINVAL;
        goto out;
    }
    int real_level = sock_level_to_real(level);
    if (real_level < 0) {
        ret = _EINVAL;
        goto out;
    }

    // 0 means the option is not implemented, but things rely on it, so we
    // should just ignore attempts to set it.
    if (real_opt == 0)
        goto out;

    int err = setsockopt(sock->real_fd, real_level, real_opt, value, value_len);
    if (err < 0)
        ret = errno_map();

out:
    free(value);
    return ret;
}

int_t sys_getsockopt(fd_t sock_fd, dword_t level, dword_t option, addr_t value_addr, addr_t len_addr) {
    STRACE("getsockopt(%d, %d, %d, %#x, %#x)", sock_fd, level, option, value_addr, len_addr);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;
    dword_t value_len;
    if (user_get(len_addr, value_len))
        return _EFAULT;
    dword_t buffer_len = value_len;

    char *value = NULL;
    if (buffer_len != 0) {
        value = malloc(buffer_len);
        if (value == NULL)
            return _ENOMEM;
    }

    int ret = 0;

    if (level == SOL_SOCKET_ && (option == SO_DOMAIN_ || option == SO_TYPE_ || option == SO_PROTOCOL_)) {
        dword_t *value_p = (dword_t *) value;
        if (buffer_len != sizeof(*value_p)) {
            ret = _EINVAL;
            goto out;
        }
        if (option == SO_DOMAIN_)
            *value_p = sock->socket.domain;
        else if (option == SO_TYPE_)
            *value_p = sock->socket.type;
        else if (option == SO_PROTOCOL_)
            *value_p = sock->socket.protocol;
        value_len = sizeof(*value_p);
    } else if (level == SOL_SOCKET_ && option == SO_PEERCRED_) {
        struct ucred_ *cred = (struct ucred_ *) value;
        if (buffer_len != sizeof(*cred)) {
            ret = _EINVAL;
            goto out;
        }
        lock(&peer_lock);
        if (sock->socket.domain != AF_LOCAL_ || sock->socket.unix_peer == NULL) {
            cred->pid = 0;
            cred->uid = cred->gid = -1;
        } else {
            *cred = sock->socket.unix_peer->socket.unix_cred;
        }
        unlock(&peer_lock);
        value_len = sizeof(*cred);
    } else if (level == SOL_SOCKET_ && option == SO_ERROR_) {
        if (buffer_len != sizeof(dword_t)) {
            ret = _EINVAL;
            goto out;
        }
        int real_error;
        socklen_t real_error_len = sizeof(real_error);
        int err = getsockopt(sock->real_fd, SOL_SOCKET, SO_ERROR, &real_error, &real_error_len);
        if (err < 0) {
            ret = errno_map();
            goto out;
        }
        *(dword_t *) value = real_error == 0 ? 0 : -err_map(real_error);
        value_len = sizeof(dword_t);
    } else if (level == IPPROTO_TCP && option == TCP_CONGESTION_) {
        value_len = strlen(DEFAULT_TCP_CONGESTION);
        size_t copy_len = buffer_len < value_len ? buffer_len : value_len;
        if (copy_len != 0)
            memcpy(value, DEFAULT_TCP_CONGESTION, copy_len);
#if defined(__APPLE__)
    } else if (level == IPPROTO_TCP && option == TCP_INFO_) {
        // This one's fun. On Linux, the struct is not ABI dependent, so no
        // special handling is needed. On Darwin, the struct is completely
        // different and has a different sockopt name.
        struct tcp_connection_info conn_info;
        socklen_t conn_info_size = sizeof(conn_info);
        int err = getsockopt(sock->real_fd, IPPROTO_TCP, TCP_CONNECTION_INFO, &conn_info, &conn_info_size);
        if (err < 0) {
            ret = errno_map();
            goto out;
        }

        // The possible keys for this table are in netinet/tcp_fsm.h, but that
        // header isn't available on iOS, only macOS.
        static const uint8_t tcp_state_table[] = {
            7, // TCPS_CLOSED
            10, // TCPS_LISTEN
            2, // TCPS_SYN_SENT
            3, // TCPS_SYN_RECEIVED
            1, // TCPS_ESTABLISHED
            8, // TCPS_CLOSE_WAIT
            4, // TCPS_FIN_WAIT_1
            11, // TCPS_CLOSING
            9, // TCPS_LAST_ACK
            5, // TCPS_FIN_WAIT_2
            6, // TCPS_TIME_WAIT
        };
        struct tcp_info_ info = {
            .state = tcp_state_table[conn_info.tcpi_state],
            .options = conn_info.tcpi_options,
            .snd_wscale = conn_info.tcpi_snd_wscale,
            .rcv_wscale = conn_info.tcpi_rcv_wscale,

            .rto = conn_info.tcpi_rto * 1000,
            .snd_mss = conn_info.tcpi_maxseg,

            .rtt = conn_info.tcpi_srtt * 1000,
            .rttvar = conn_info.tcpi_rttvar * 1000,
            .snd_ssthresh = conn_info.tcpi_snd_ssthresh,
            .snd_cwnd = conn_info.tcpi_snd_cwnd / conn_info.tcpi_maxseg,

            // https://lkml.org/lkml/2017/4/24/923
            .total_retrans = conn_info.tcpi_txretransmitpackets,
        };
        value_len = sizeof(struct tcp_info_);
        size_t copy_len = buffer_len < value_len ? buffer_len : value_len;
        if (copy_len != 0)
            memcpy(value, &info, copy_len);
#endif
    } else {
        int real_opt = sock_opt_to_real(option, level);
        if (real_opt < 0) {
            ret = _EINVAL;
            goto out;
        }
        int real_level = sock_level_to_real(level);
        if (real_level < 0) {
            ret = _EINVAL;
            goto out;
        }

        socklen_t real_value_len = value_len;
        int err = getsockopt(sock->real_fd, real_level, real_opt, value, &real_value_len);
        if (err < 0) {
            ret = errno_map();
            goto out;
        }
        value_len = real_value_len;
    }

    if (user_put(len_addr, value_len)) {
        ret = _EFAULT;
        goto out;
    }
    size_t write_len = buffer_len < value_len ? buffer_len : value_len;
    if (write_len != 0 && user_write(value_addr, value, write_len))
        ret = _EFAULT;

out:
    free(value);
    return ret;
}

#ifdef GUEST_ARM64
#define cmsghdr_guest cmsghdr64_
#define CMSG_NXTHDR_GUEST CMSG_NXTHDR64_
#else
#define cmsghdr_guest cmsghdr_
#define CMSG_NXTHDR_GUEST CMSG_NXTHDR_
#endif

static void scm_free(struct scm *scm) {
    for (unsigned i = 0; i < scm->num_fds; i++)
        fd_close(scm->fds[i]);
    free(scm);
}

int_t sys_sendmsg(fd_t sock_fd, addr_t msghdr_addr, int_t flags) {
    int err;
    STRACE("sendmsg(%d, %#x, %d)", sock_fd, msghdr_addr, flags);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;

    // Read the guest msghdr struct into our internal 32-bit representation
    struct msghdr msg;
    struct msghdr_ msg_fake;
#ifdef GUEST_ARM64
    struct msghdr64_ msg_fake64;
    if (user_get(msghdr_addr, msg_fake64))
        return _EFAULT;
    msg_fake.msg_name = (addr_t)msg_fake64.msg_name;
    msg_fake.msg_namelen = msg_fake64.msg_namelen;
    msg_fake.msg_iov = (addr_t)msg_fake64.msg_iov;
    msg_fake.msg_iovlen = (uint_t)msg_fake64.msg_iovlen;
    msg_fake.msg_control = (addr_t)msg_fake64.msg_control;
    msg_fake.msg_controllen = (uint_t)msg_fake64.msg_controllen;
    msg_fake.msg_flags = msg_fake64.msg_flags;
#else
    if (user_get(msghdr_addr, msg_fake))
        return _EFAULT;
#endif
    if (msg_fake.msg_iovlen > 1024)
        return _EMSGSIZE;
    if (msg_fake.msg_iovlen != 0 && msg_fake.msg_iov == 0)
        return _EFAULT;

    // msg_name
    struct sockaddr_max_ msg_name;
    if (msg_fake.msg_name != 0) {
        int err = sockaddr_read(msg_fake.msg_name, &msg_name, &msg_fake.msg_namelen);
        if (err < 0)
            return err;
        msg.msg_name = &msg_name;
        msg.msg_namelen = msg_fake.msg_namelen;
    } else {
        msg.msg_name = NULL;
    }

    // msg_iovec
#ifdef GUEST_ARM64
    struct iovec64_ msg_iov_fake64[msg_fake.msg_iovlen];
    if (user_read(msg_fake.msg_iov, msg_iov_fake64, sizeof(msg_iov_fake64)))
        return _EFAULT;
    struct iovec msg_iov[msg_fake.msg_iovlen];
    memset(msg_iov, 0, sizeof(msg_iov));
    msg.msg_iov = msg_iov;
    msg.msg_iovlen = msg_fake.msg_iovlen;
    for (size_t i = 0; i < (size_t) msg.msg_iovlen; i++) {
        msg_iov[i].iov_len = (size_t)msg_iov_fake64[i].len;
        msg_iov[i].iov_base = malloc(msg_iov[i].iov_len);
        if (msg_iov[i].iov_len != 0 && msg_iov[i].iov_base == NULL) {
            err = _ENOMEM;
            goto out_free_iov;
        }
        err = _EFAULT;
        if (user_read((addr_t)msg_iov_fake64[i].base, msg_iov[i].iov_base, msg_iov[i].iov_len))
            goto out_free_iov;
    }
#else
    struct iovec_ msg_iov_fake[msg_fake.msg_iovlen];
    if (user_get(msg_fake.msg_iov, msg_iov_fake))
        return _EFAULT;
    struct iovec msg_iov[msg_fake.msg_iovlen];
    memset(msg_iov, 0, sizeof(msg_iov));
    msg.msg_iov = msg_iov;
    msg.msg_iovlen = sizeof(msg_iov) / sizeof(msg_iov[0]);
    for (size_t i = 0; i < (size_t) msg.msg_iovlen; i++) {
        msg_iov[i].iov_len = msg_iov_fake[i].len;
        msg_iov[i].iov_base = malloc(msg_iov_fake[i].len);
        if (msg_iov[i].iov_len != 0 && msg_iov[i].iov_base == NULL) {
            err = _ENOMEM;
            goto out_free_iov;
        }
        err = _EFAULT;
        if (user_read(msg_iov_fake[i].base, msg_iov[i].iov_base, msg_iov_fake[i].len))
            goto out_free_iov;
    }
#endif

    // msg_control
    uint8_t msg_control_buf[2048];
    uint8_t *msg_control = NULL;
    if (msg_fake.msg_control != 0) {
        if (msg_fake.msg_controllen > sizeof(msg_control_buf)) {
            err = _EINVAL;
            goto out_free_iov;
        }
        msg_control = msg_control_buf;
        err = _EFAULT;
        if (user_read(msg_fake.msg_control, msg_control, msg_fake.msg_controllen))
            goto out_free_iov;
    }
    msg.msg_control = NULL;
    msg.msg_controllen = 0;

    struct scm *scm = NULL;
    char real_msg_control[CMSG_SPACE(sizeof(int))]; // only used if actually sending an fd
    if (sock->socket.domain == AF_LOCAL_ && msg_control != NULL && msg_fake.msg_controllen >= sizeof(struct cmsghdr_guest)) {
        // figure out how many file descriptors we're sending
        uint8_t *mhdr_end = msg_control + msg_fake.msg_controllen;
        unsigned num_fds = 0;
        struct cmsghdr_guest *cmsg;
        for (cmsg = (void *) msg_control; cmsg != NULL; cmsg = CMSG_NXTHDR_GUEST(cmsg, mhdr_end)) {
            size_t remaining = (size_t)(mhdr_end - (uint8_t *)cmsg);
            if (cmsg->len < sizeof(struct cmsghdr_guest) || cmsg->len > remaining) {
                err = _EINVAL;
                goto out_free_iov;
            }
            if (cmsg->level != SOL_SOCKET_)
                continue;
            if (cmsg->type != SCM_RIGHTS_) {
                err = _EINVAL;
                goto out_free_iov;
            }
            num_fds += (cmsg->len - sizeof(struct cmsghdr_guest)) / sizeof(fd_t);
        }
        if (num_fds > 253) { // *magic*
            err = _EINVAL;
            goto out_free_iov;
        }

        if (num_fds > 0) {
            // send one (1) real fd and put the rest in a struct scm
            static int real_fd = -1;
            if (real_fd == -1) {
                real_fd = open(".", O_RDONLY);
                if (real_fd < 0)
                    ERRNO_DIE("no");
            }
            msg.msg_control = real_msg_control;
            msg.msg_controllen = sizeof(real_msg_control);
            struct cmsghdr *real_cmsg = CMSG_FIRSTHDR(&msg);
            real_cmsg->cmsg_level = SOL_SOCKET;
            real_cmsg->cmsg_type = SCM_RIGHTS;
            real_cmsg->cmsg_len = CMSG_LEN(sizeof(real_fd));
            memcpy(CMSG_DATA(real_cmsg), &real_fd, sizeof(real_fd));

            scm = malloc(sizeof(struct scm) + num_fds * sizeof(struct fd *));
            if (scm == NULL) {
                err = _ENOMEM;
                goto out_free_iov;
            }
            list_init(&scm->queue);
            scm->num_fds = 0;
            unsigned fd_i = 0;
            for (cmsg = (void *) msg_control; cmsg != NULL; cmsg = CMSG_NXTHDR_GUEST(cmsg, mhdr_end)) {
                size_t remaining = (size_t)(mhdr_end - (uint8_t *)cmsg);
                if (cmsg->len < sizeof(struct cmsghdr_guest) || cmsg->len > remaining) {
                    err = _EINVAL;
                    goto out_free_scm;
                }
                if (cmsg->level != SOL_SOCKET_)
                    continue;
                fd_t *fds = (void *) cmsg->data;
                for (unsigned i = 0; i < (cmsg->len - sizeof(struct cmsghdr_guest)) / sizeof(fd_t); i++) {
                    STRACE(" sending fd %d", fds[i]);
                    struct fd *send_fd = f_get(fds[i]);
                    if (send_fd == NULL) {
                        err = _EBADF;
                        goto out_free_scm;
                    }
                    scm->fds[fd_i++] = fd_retain(send_fd);
                    scm->num_fds = fd_i;
                }
            }
            lock(&peer_lock);
            struct fd *peer = sock->socket.unix_peer;
            if (peer == NULL) {
                unlock(&peer_lock);
                err = _EPIPE;
                goto out_free_scm;
            }
            lock(&peer->lock);
            list_add_tail(&peer->socket.unix_scm, &scm->queue);
            unlock(&peer->lock);
            unlock(&peer_lock);
        }
    }

    msg.msg_flags = sock_flags_to_real(msg_fake.msg_flags);
    err = _EINVAL;
    if (msg.msg_flags < 0)
        goto out_free_scm;
    int real_flags = sock_flags_to_real(flags);
    if (real_flags < 0)
        goto out_free_scm;

    err = sendmsg(sock->real_fd, &msg, real_flags);
    if (err < 0) {
        err = errno_map();
        goto out_free_scm;
    }
    goto out_free_iov;

out_free_scm:
    if (scm != NULL) {
        lock(&peer_lock);
        struct fd *peer = sock->socket.unix_peer;
        if (peer != NULL) {
            lock(&peer->lock);
            list_remove_safe(&scm->queue);
            unlock(&peer->lock);
        }
        unlock(&peer_lock);
        scm_free(scm);
    }
out_free_iov:
    for (size_t i = 0; i < (size_t) msg.msg_iovlen; i++)
        free(msg_iov[i].iov_base);
    return err;
}

int_t sys_recvmsg(fd_t sock_fd, addr_t msghdr_addr, int_t flags) {
    STRACE("recvmsg(%d, %#x, %d)", sock_fd, msghdr_addr, flags);
    struct fd *sock = sock_getfd(sock_fd);
    if (sock == NULL)
        return _EBADF;

    // Read the guest msghdr struct into our internal 32-bit representation
    struct msghdr_ msg_fake;
#ifdef GUEST_ARM64
    struct msghdr64_ msg_fake64;
    if (user_get(msghdr_addr, msg_fake64))
        return _EFAULT;
    msg_fake.msg_name = (addr_t)msg_fake64.msg_name;
    msg_fake.msg_namelen = msg_fake64.msg_namelen;
    msg_fake.msg_iov = (addr_t)msg_fake64.msg_iov;
    msg_fake.msg_iovlen = (uint_t)msg_fake64.msg_iovlen;
    msg_fake.msg_control = (addr_t)msg_fake64.msg_control;
    msg_fake.msg_controllen = (uint_t)msg_fake64.msg_controllen;
    msg_fake.msg_flags = msg_fake64.msg_flags;
#else
    if (user_get(msghdr_addr, msg_fake))
        return _EFAULT;
#endif
    if (msg_fake.msg_iovlen > 1024)
        return _EMSGSIZE;
    if (msg_fake.msg_iovlen != 0 && msg_fake.msg_iov == 0)
        return _EFAULT;

    struct msghdr msg;

    // msg_name
    struct sockaddr_max_ msg_name;
    uint_t msg_name_buffer_len = msg_fake.msg_namelen;
    if (msg_fake.msg_name != 0) {
        msg.msg_name = &msg_name;
        msg.msg_namelen = msg_name_buffer_len;
        if (msg.msg_namelen > sizeof(msg_name))
            msg.msg_namelen = sizeof(msg_name);
    } else {
        msg.msg_name = NULL;
        msg.msg_namelen = 0;
    }

    char real_msg_control[CMSG_SPACE(sizeof(int))] = {}; // only used if needed
    if (msg_fake.msg_controllen != 0) {
        // msg_control, include room for one (1) fd
        msg.msg_control = real_msg_control;
        msg.msg_controllen = sizeof(real_msg_control);
    } else {
        msg.msg_control = NULL;
        msg.msg_controllen = 0;
    }

    int real_flags = sock_flags_to_real(flags);
    if (real_flags < 0)
        return _EINVAL;

    // msg_iovec (no initial content)
#ifdef GUEST_ARM64
    struct iovec64_ msg_iov_fake64[msg_fake.msg_iovlen];
    if (user_read(msg_fake.msg_iov, msg_iov_fake64, sizeof(msg_iov_fake64)))
        return _EFAULT;
    struct iovec msg_iov[msg_fake.msg_iovlen];
    msg.msg_iov = msg_iov;
    msg.msg_iovlen = msg_fake.msg_iovlen;
    addr_t msg_iov_bases[msg_fake.msg_iovlen]; // save guest base addrs for writeback
    for (size_t i = 0; i < (size_t) msg.msg_iovlen; i++) {
        msg_iov_bases[i] = (addr_t)msg_iov_fake64[i].base;
        msg_iov[i].iov_len = (size_t)msg_iov_fake64[i].len;
        msg_iov[i].iov_base = malloc(msg_iov[i].iov_len);
        if (msg_iov[i].iov_len != 0 && msg_iov[i].iov_base == NULL) {
            for (size_t j = 0; j < i; j++)
                free(msg_iov[j].iov_base);
            return _ENOMEM;
        }
    }
#else
    struct iovec_ msg_iov_fake[msg_fake.msg_iovlen];
    if (user_get(msg_fake.msg_iov, msg_iov_fake))
        return _EFAULT;
    struct iovec msg_iov[msg_fake.msg_iovlen];
    msg.msg_iov = msg_iov;
    msg.msg_iovlen = sizeof(msg_iov) / sizeof(msg_iov[0]);
    for (size_t i = 0; i < (size_t) msg.msg_iovlen; i++) {
        msg_iov[i].iov_len = msg_iov_fake[i].len;
        msg_iov[i].iov_base = malloc(msg_iov_fake[i].len);
        if (msg_iov[i].iov_len != 0 && msg_iov[i].iov_base == NULL) {
            for (size_t j = 0; j < i; j++)
                free(msg_iov[j].iov_base);
            return _ENOMEM;
        }
    }
#endif

    // Same iOS-safe wait pattern as sys_recvfrom: avoid unbounded blocking
    // in host recvmsg() so guest signals can always be delivered. But only
    // wait when the caller actually wants blocking behavior — if the fd is
    // nonblock (SOCK_NONBLOCK set by guest or via fcntl), surface EAGAIN
    // immediately instead of waiting. This is critical for musl's
    // res_msend, which creates nonblock sockets and calls
    // recvmsg(fd, &mh, 0) — it relies on EAGAIN on empty buffer to end its
    // "drain pending responses" loop. Same bug that used to affect
    // sys_recvfrom before 76907b86.
    int host_flags_rm = fcntl(sock->real_fd, F_GETFL, 0);
    bool host_nonblock_rm = (host_flags_rm >= 0) && (host_flags_rm & O_NONBLOCK);
    bool guest_nonblock_rm = (sock->flags & O_NONBLOCK_) != 0;
    bool should_wait_rm = !(real_flags & MSG_DONTWAIT) && !guest_nonblock_rm && !host_nonblock_rm;

    ssize_t res = -1;
    int err = 0;
    if (should_wait_rm) {
        for (;;) {
            res = recvmsg(sock->real_fd, &msg, real_flags | MSG_DONTWAIT);
            if (res >= 0)
                break;
            if (errno == EINTR)
                continue;
            if (errno != EAGAIN && errno != EWOULDBLOCK) {
                err = errno_map();
                break;
            }
            int wr = sock_wait_readable(sock->real_fd);
            if (wr < 0) {
                err = wr;
                break;
            }
        }
    } else {
        res = recvmsg(sock->real_fd, &msg, real_flags);
        if (res < 0)
            err = errno_map();
    }
    // don't return err quite yet, there are outstanding mallocs

    // msg_iovec (changed)
    // copy as many bytes as were received, according to the return value
    size_t n = res;
    if (res < 0)
        n = 0;
    for (size_t i = 0; i < (size_t) msg.msg_iovlen; i++) {
        size_t chunk_size = msg_iov[i].iov_len;
        if (chunk_size > n)
            chunk_size = n;
        if (chunk_size > 0) {
#ifdef GUEST_ARM64
            if (user_write(msg_iov_bases[i], msg_iov[i].iov_base, chunk_size))
#else
            if (user_write(msg_iov_fake[i].base, msg_iov[i].iov_base, chunk_size))
#endif
            {
                err = _EFAULT;
                n = chunk_size;
            }
        }
        n -= chunk_size;
        free(msg_iov[i].iov_base);
    }
    if (err < 0 && res >= 0)
        return err;

    // msg_control (changed)
    uint_t msg_control_buffer_len = msg_fake.msg_controllen;
    msg_fake.msg_controllen = 0;
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
    if (sock->socket.domain == AF_LOCAL_ && cmsg != NULL &&
            cmsg->cmsg_level == SOL_SOCKET && cmsg->cmsg_type == SCM_RIGHTS) {
        int dummy_fd = ((int *) CMSG_DATA(cmsg))[0];
        close(dummy_fd);

        lock(&sock->lock);
        if (list_empty(&sock->socket.unix_scm)) {
            unlock(&sock->lock);
            return _EINVAL;
        }
        struct scm *scm = list_first_entry(&sock->socket.unix_scm, struct scm, queue);
        list_remove(&scm->queue);
        unlock(&sock->lock);

        if (res < 0) {
            scm_free(scm);
            return err;
        }

        uint8_t msg_control[sizeof(struct cmsghdr_guest) + scm->num_fds * sizeof(fd_t)];
        struct cmsghdr_guest *cmsg = (void *) msg_control;
        cmsg->len = sizeof(msg_control);
        cmsg->level = SOL_SOCKET_;
        cmsg->type = SCM_RIGHTS_;
        if (msg_fake.msg_control == 0 || msg_control_buffer_len < cmsg->len) {
            scm_free(scm);
            return _EINVAL;
        }
        fd_t installed_fds[253];
        unsigned installed_count = 0;
        fd_t *fds = (void *) cmsg->data;
        for (unsigned i = 0; i < scm->num_fds; i++) {
            fds[i] = f_install(scm->fds[i], 0);
            STRACE(" receiving fd %d", fds[i]);
            if (fds[i] < 0) {
                for (unsigned j = 0; j < installed_count; j++)
                    sys_close(installed_fds[j]);
                for (unsigned j = i + 1; j < scm->num_fds; j++)
                    fd_close(scm->fds[j]);
                int install_err = fds[i];
                free(scm);
                return install_err;
            }
            installed_fds[installed_count++] = fds[i];
        }
        if (user_write(msg_fake.msg_control, cmsg, cmsg->len)) {
            for (unsigned i = 0; i < installed_count; i++)
                sys_close(installed_fds[i]);
            free(scm);
            return _EFAULT;
        }
        free(scm);
        msg_fake.msg_controllen = cmsg->len;
    }

    // by now the iovecs and scm have been freed so we can return
    if (res < 0)
        return err;

    // msg_name (changed)
    if (msg.msg_name != 0) {
        int err = sockaddr_write(msg_fake.msg_name, msg.msg_name, msg_name_buffer_len, &msg.msg_namelen);
        if (err < 0)
            return err;
    }
    msg_fake.msg_namelen = msg.msg_namelen;

    // msg_flags (changed)
    msg_fake.msg_flags = sock_flags_from_real(msg.msg_flags);

    // Write back the updated msghdr to guest memory
#ifdef GUEST_ARM64
    msg_fake64.msg_namelen = msg_fake.msg_namelen;
    msg_fake64.msg_controllen = msg_fake.msg_controllen;
    msg_fake64.msg_flags = msg_fake.msg_flags;
    if (user_put(msghdr_addr, msg_fake64))
        return _EFAULT;
#else
    if (user_put(msghdr_addr, msg_fake))
        return _EFAULT;
#endif
    return res;
}

struct mmsghdr_ {
    struct msghdr_ hdr;
    uint_t len;
};

#ifdef GUEST_ARM64
struct mmsghdr64_ {
    struct msghdr64_ hdr;
    uint32_t len;
    uint32_t _pad;
};
#endif

int_t sys_recvmmsg(fd_t sock_fd, addr_t msg_vec, uint_t vec_len, int_t flags, addr_t timeout_addr) {
    STRACE("recvmmsg(%d, %#x, %d, %d)", sock_fd, msg_vec, vec_len, flags);
    (void) timeout_addr;
    int num_recv = 0;
#ifdef GUEST_ARM64
    size_t mmsghdr_size = sizeof(struct mmsghdr64_);
    size_t len_offset = offsetof(struct mmsghdr64_, len);
#else
    size_t mmsghdr_size = sizeof(struct mmsghdr_);
    size_t len_offset = offsetof(struct mmsghdr_, len);
#endif
    for (unsigned i = 0; i < vec_len; i++) {
        addr_t msghdr = msg_vec + i * mmsghdr_size;
        int_t res = sys_recvmsg(sock_fd, msghdr, flags);
        if (res >= 0) {
            addr_t msg_len_addr = msghdr + len_offset;
            if (user_put(msg_len_addr, res))
                res = _EFAULT;
        }
        if (res < 0) {
            if (num_recv > 0)
                break;
            return res;
        }
        num_recv++;
        if (res == 0)
            break;
    }
    return num_recv;
}

int_t sys_sendmmsg(fd_t sock_fd, addr_t msg_vec, uint_t vec_len, int_t flags) {
    int num_sent = 0;
#ifdef GUEST_ARM64
    size_t mmsghdr_size = sizeof(struct mmsghdr64_);
    size_t len_offset = offsetof(struct mmsghdr64_, len);
#else
    size_t mmsghdr_size = sizeof(struct mmsghdr_);
    size_t len_offset = offsetof(struct mmsghdr_, len);
#endif
    for (unsigned i = 0; i < vec_len; i++) {
        addr_t msghdr = msg_vec + i * mmsghdr_size;
        int_t res = sys_sendmsg(sock_fd, msghdr, flags);
        if (res >= 0) {
            addr_t msg_len_addr = msghdr + len_offset;
            if (user_put(msg_len_addr, res))
                res = _EFAULT;
        }
        if (res < 0) {
            // From the man page:
            // If an error occurs after at least one message has been sent, the
            // call succeeds, and returns the number of messages sent.  The
            // error code is lost.
            if (num_sent > 0)
                break;
            return res;
        }
        num_sent++;
        if (res == 0) {
            // This means the socket is non-blocking and can't be written to anymore.
            break;
        }
    }
    return num_sent;
}

static void sock_translate_err(struct fd *fd, int *err) {
    // on ios, when the device goes to sleep, all connected sockets are killed.
    // reads/writes return ENOTCONN, which I'm pretty sure is a violation of
    // posix. so instead, detect this and return ECONNRESET.
    if (*err == _ENOTCONN) {
        struct sockaddr addr;
        socklen_t len = sizeof(addr);
        if (getpeername(fd->real_fd, &addr, &len) < 0 && errno == EINVAL) {
            *err = _ECONNRESET;
        }
    }
}

// sock_read / sock_write: behave exactly like realfs_read / realfs_write
// (a single host read/write call, with no poll and no flag change), except
// that EINTR is handled specially: if there is a guest signal pending, we
// surface EINTR back to the guest instead of blindly retrying.
//
// The original realfs_read/realfs_write does `while (errno == EINTR) retry`,
// which swallows the SIGUSR1 wake iSH uses to deliver guest signals into
// blocked host syscalls. Combined with iOS occasionally deferring signal
// delivery (thread suspension on backgrounding), this causes indefinite
// hangs on any blocking socket read/write (git HTTPS, nc, telnet, etc.).
//
// We intentionally do NOT poll, do NOT mess with nonblock flags, and do NOT
// switch to recv/send. This minimizes regression risk — the host I/O path
// is byte-for-byte identical to the original implementation for every case
// except "host syscall got EINTR AND guest has a pending signal", which is
// precisely the bug we need to fix.
static ssize_t sock_read(struct fd *fd, void *buf, size_t size) {
    int err;
    int eintr_count = 0;
    for (;;) {
        ssize_t res = read(fd->real_fd, buf, size);
        if (res >= 0) { err = (int)res; break; }
        if (errno != EINTR) { err = errno_map(); break; }
        eintr_count++;
        // EINTR: only surface to guest if there is actually a pending signal
        // that the guest wants to handle. Otherwise retry (matches the
        // original realfs_read behavior for spurious EINTR).
        if (current->sighand != NULL) {
            lock(&current->sighand->lock);
            bool pending = !!(current->pending & ~current->blocked);
            unlock(&current->sighand->lock);
            if (pending) { err = _EINTR; break; }
        }
        // no guest signal — retry the host read
    }
    if (eintr_count >= 3) {
        printk("NETDIAG sock_read-eintr(pid=%d comm=%s fd=%d) count=%d err=%d\n",
               current->pid, current->comm, fd->real_fd, eintr_count, err);
    }
    sock_translate_err(fd, &err);
    return err;
}

static ssize_t sock_write(struct fd *fd, const void *buf, size_t size) {
    int err;
    int eintr_count = 0;
    for (;;) {
        ssize_t res = write(fd->real_fd, buf, size);
        if (res >= 0) { err = (int)res; break; }
        if (errno != EINTR) { err = errno_map(); break; }
        eintr_count++;
        if (current->sighand != NULL) {
            lock(&current->sighand->lock);
            bool pending = !!(current->pending & ~current->blocked);
            unlock(&current->sighand->lock);
            if (pending) { err = _EINTR; break; }
        }
    }
    if (eintr_count >= 3) {
        printk("NETDIAG sock_write-eintr(pid=%d comm=%s fd=%d) count=%d err=%d\n",
               current->pid, current->comm, fd->real_fd, eintr_count, err);
    }
    sock_translate_err(fd, &err);
    return err;
}

static int sock_close(struct fd *fd) {
    sockrestart_end_listen(fd);
    // FIXME next 3 lines should go in a function like release_unix_names
    inode_release_if_exist(fd->socket.unix_name_inode);
    if (fd->socket.unix_name_abstract != NULL)
        unix_abstract_release(fd->socket.unix_name_abstract);
    lock(&peer_lock);
    struct fd *peer = fd->socket.unix_peer;
    if (peer != NULL)
        peer->socket.unix_peer = NULL;
    unlock(&peer_lock);
    if (fd->socket.domain == AF_LOCAL_) {
        lock(&fd->lock);
        struct scm *scm, *tmp;
        list_for_each_entry_safe(&fd->socket.unix_scm, scm, tmp, queue) {
            list_remove(&scm->queue);
            scm_free(scm);
        }
        unlock(&fd->lock);
    }
    return realfs_close(fd);
}

const struct fd_ops socket_fdops = {
    .read = sock_read,
    .write = sock_write,
    .close = sock_close,
    .poll = realfs_poll,
    .getflags = realfs_getflags,
    .setflags = realfs_setflags,
    .ioctl_size = realfs_ioctl_size,
    .ioctl = realfs_ioctl,
};

#if defined(__GNUC__) && __GNUC__ >= 8
#pragma GCC diagnostic ignored "-Wcast-function-type"
#endif
#if defined(__clang__)
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#endif
static struct socket_call {
    syscall_t func;
    int args;
} socket_calls[] = {
    {NULL},
    {(syscall_t) sys_socket, 3},
    {(syscall_t) sys_bind, 3},
    {(syscall_t) sys_connect, 3},
    {(syscall_t) sys_listen, 2},
    {(syscall_t) sys_accept, 3},
    {(syscall_t) sys_getsockname, 3},
    {(syscall_t) sys_getpeername, 3},
    {(syscall_t) sys_socketpair, 4},
    {(syscall_t) sys_send, 4}, // send
    {(syscall_t) sys_recv, 4}, // recv
    {(syscall_t) sys_sendto, 6},
    {(syscall_t) sys_recvfrom, 6},
    {(syscall_t) sys_shutdown, 2},
    {(syscall_t) sys_setsockopt, 5},
    {(syscall_t) sys_getsockopt, 5},
    {(syscall_t) sys_sendmsg, 3},
    {(syscall_t) sys_recvmsg, 3},
    {NULL}, // accept4
    {NULL}, // recvmmsg
    {(syscall_t) sys_sendmmsg, 4},
};

int_t sys_socketcall(dword_t call_num, addr_t args_addr) {
    STRACE("%d ", call_num);
    if (call_num < 1 || call_num >= sizeof(socket_calls)/sizeof(socket_calls[0]))
        return _EINVAL;
    struct socket_call call = socket_calls[call_num];
    if (call.func == NULL) {
        FIXME("socketcall %d", call_num);
        return _ENOSYS;
    }

    dword_t args[6];
    if (user_read(args_addr, args, sizeof(dword_t) * call.args))
        return _EFAULT;
    return call.func(args[0], args[1], args[2], args[3], args[4], args[5]);
}
