#include <errno.h>
#include <ifaddrs.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include "fs/netlink.h"
#include "fs/fd.h"
#include "kernel/calls.h"
#include "kernel/errno.h"

static void discard_queue(struct fd *fd);

int netlink_open(struct fd *fd) {
    int pair[2];
    if (socketpair(AF_UNIX, SOCK_DGRAM, 0, pair) < 0)
        return errno_map();
    // Queue the complete snapshot before returning from send(), as musl reads
    // its dump with MSG_DONTWAIT. Never block a sender on its own receive queue.
    int capacity = 256 * 1024;
    setsockopt(pair[0], SOL_SOCKET, SO_RCVBUF, &capacity, sizeof(capacity));
    setsockopt(pair[1], SOL_SOCKET, SO_SNDBUF, &capacity, sizeof(capacity));
    fd->real_fd = pair[0];
    fd->socket.netlink_peer = pair[1];
    fd->socket.netlink_port = current->pid;
    return 0;
}

int netlink_bind(struct fd *fd, uint64_t address, uint32_t length) {
    struct sockaddr_nl_ name;
    if (length < sizeof(name)) return _EINVAL;
    if (user_read(address, &name, sizeof(name))) return _EFAULT;
    if (name.family != AF_NETLINK_) return _EINVAL;
    if (name.groups) return _EOPNOTSUPP;
    fd->socket.netlink_port = name.port ? name.port : current->pid;
    return 0;
}

int netlink_address(uint64_t address, uint32_t capacity, uint32_t *length, uint32_t port) {
    struct sockaddr_nl_ name = {.family = AF_NETLINK_, .port = port};
    *length = sizeof(name);
    if (capacity > sizeof(name)) capacity = sizeof(name);
    return capacity && user_write(address, &name, capacity) ? _EFAULT : 0;
}

ssize_t netlink_send(struct fd *fd, const void *data, size_t length) {
    struct nlmsghdr_ request;
    if (length < sizeof(request) + 1) return _EINVAL;
    memcpy(&request, data, sizeof(request));
    if (request.length < sizeof(request) + 1 || request.length > length)
        return _EINVAL;
    if (length - request.length > 3) return _EOPNOTSUPP;
    struct ifaddrs *interfaces = NULL;
    if (netlink_route_supports(&request) && getifaddrs(&interfaces) < 0)
        return errno_map();
    void *reply;
    size_t reply_length;
    int error = netlink_route_dump(&request, ((const uint8_t *) data)[sizeof(request)],
                                  fd->socket.netlink_port, interfaces, &reply, &reply_length);
    if (interfaces) freeifaddrs(interfaces);
    if (error < 0) return error;
    lock(&fd->lock);
    for (size_t offset = 0; offset < reply_length;) {
        struct nlmsghdr_ *message = (void *) ((uint8_t *) reply + offset);
        if (send(fd->socket.netlink_peer, message, message->length, MSG_DONTWAIT) < 0) {
            error = errno == EAGAIN || errno == ENOBUFS ? _ENOBUFS : errno_map();
            discard_queue(fd);
            break;
        }
        offset += message->length;
    }
    unlock(&fd->lock);
    free(reply);
    return error < 0 ? error : (ssize_t) length;
}

// musl ignores sequence numbers, so a dump without NLMSG_DONE would be merged
// into the reply to the next request. Unread earlier replies are dropped too;
// netlink callers send one request and read its whole reply before the next.
static void discard_queue(struct fd *fd) {
    uint8_t byte;
    while (recv(fd->real_fd, &byte, sizeof(byte), MSG_DONTWAIT) >= 0);
}
