#ifndef ISH_NETLINK_H
#define ISH_NETLINK_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define AF_NETLINK_ 16
#define NETLINK_ROUTE_ 0
#define NLM_F_REQUEST_ 1
#define NLM_F_MULTI_ 2
#define NLM_F_DUMP_ 0x300
#define NLMSG_ERROR_ 2
#define NLMSG_DONE_ 3
#define RTM_NEWLINK_ 16
#define RTM_GETLINK_ 18
#define RTM_NEWADDR_ 20
#define RTM_GETADDR_ 22
#define IFLA_ADDRESS_ 1
#define IFLA_IFNAME_ 3
#define IFA_ADDRESS_ 1
#define IFA_LOCAL_ 2
#define IFA_BROADCAST_ 4
#define ARPHRD_ETHER_ 1
#define ARPHRD_LOOPBACK_ 772
#define ARPHRD_NONE_ 65534
#define RT_SCOPE_LINK_ 253
#define RT_SCOPE_HOST_ 254

struct nlmsghdr_ {
    uint32_t length;
    uint16_t type, flags;
    uint32_t sequence, port;
};

struct sockaddr_nl_ {
    uint16_t family, padding;
    uint32_t port, groups;
};

struct fd;
struct ifaddrs;
int netlink_open(struct fd *fd);
int netlink_bind(struct fd *fd, uint64_t address, uint32_t length);
int netlink_address(uint64_t address, uint32_t capacity, uint32_t *length, uint32_t port);
ssize_t netlink_send(struct fd *fd, const void *data, size_t length);
bool netlink_route_supports(const struct nlmsghdr_ *request);
int netlink_route_dump(const struct nlmsghdr_ *request, uint8_t family,
                      uint32_t port, const struct ifaddrs *interfaces,
                      void **data, size_t *length);

#endif
