#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#ifdef __APPLE__
#include <net/if_dl.h>
#else
#include <netpacket/packet.h>
#endif
#include "fs/netlink.h"
#include "kernel/errno.h"

struct link_message {
    uint8_t family, padding;
    uint16_t type;
    int32_t index;
    uint32_t flags, change;
};
struct address_message {
    uint8_t family, prefix, flags, scope;
    uint32_t index;
};
struct route_message {
    struct nlmsghdr_ header;
    uint8_t payload[256];
};
struct reply {
    void *data;
    size_t length, capacity;
};

static bool attribute(struct route_message *message, uint16_t type, const void *data, size_t length);
static int append(struct reply *reply, const struct route_message *message);
static const void *ip_address(const struct sockaddr *address);
static uint8_t prefix_length(const struct sockaddr *mask, size_t length);
static bool link_details(const struct ifaddrs *interface, uint32_t *index, size_t *length, const void **hardware);
static uint32_t interface_index(const struct ifaddrs *interfaces, const char *name);
static bool build_link_message(struct route_message *message, const struct ifaddrs *interface);
static bool build_address_message(struct route_message *message, const struct ifaddrs *interface,
                                  const struct ifaddrs *interfaces, uint8_t family);

bool netlink_route_supports(const struct nlmsghdr_ *request) {
    return (request->flags & NLM_F_REQUEST_) &&
        (request->flags & NLM_F_DUMP_) == NLM_F_DUMP_ &&
        (request->type == RTM_GETLINK_ || request->type == RTM_GETADDR_);
}

int netlink_route_dump(const struct nlmsghdr_ *request, uint8_t family,
                      uint32_t port, const struct ifaddrs *interfaces,
                      void **data, size_t *length) {
    *data = NULL;
    *length = 0;
    struct reply reply = {0};
    int error = netlink_route_supports(request) ? 0 : _EOPNOTSUPP;
    for (const struct ifaddrs *interface = interfaces; !error && interface; interface = interface->ifa_next) {
        if (!interface->ifa_addr || !interface->ifa_name)
            continue;
        struct route_message message = {.header = {
            .length = sizeof(struct nlmsghdr_), .flags = NLM_F_MULTI_,
            .sequence = request->sequence, .port = port,
        }};
        bool include = request->type == RTM_GETLINK_
            ? build_link_message(&message, interface)
            : build_address_message(&message, interface, interfaces, family);
        if (include && append(&reply, &message) < 0)
            goto allocation_failed;
    }
    struct route_message done = {.header = {
        .length = sizeof(struct nlmsghdr_) + sizeof(int32_t),
        .type = error ? NLMSG_ERROR_ : NLMSG_DONE_,
        .flags = error ? 0 : NLM_F_MULTI_, .sequence = request->sequence, .port = port,
    }};
    memcpy(done.payload, &error, sizeof(int32_t));
    if (error) {
        memcpy(done.payload + sizeof(int32_t), request, sizeof(*request));
        done.header.length += sizeof(*request);
    }
    if (append(&reply, &done) < 0)
        goto allocation_failed;
    *data = reply.data;
    *length = reply.length;
    return 0;

allocation_failed:
    free(reply.data);
    return _ENOMEM;
}

static bool attribute(struct route_message *message, uint16_t type, const void *data, size_t length) {
    size_t size = (4 + length + 3) & ~(size_t) 3;
    if (size > sizeof(*message) - message->header.length)
        return false;
    uint16_t header[] = {(uint16_t) (4 + length), type};
    uint8_t *destination = (uint8_t *) message + message->header.length;
    memcpy(destination, header, sizeof(header));
    memcpy(destination + sizeof(header), data, length);
    memset(destination + sizeof(header) + length, 0, size - sizeof(header) - length);
    message->header.length += size;
    return true;
}

static int append(struct reply *reply, const struct route_message *message) {
    if (reply->length + message->header.length > reply->capacity) {
        size_t capacity = reply->capacity ? reply->capacity : 4096;
        while (capacity < reply->length + message->header.length)
            capacity *= 2;
        void *next = realloc(reply->data, capacity);
        if (!next)
            return _ENOMEM;
        reply->data = next;
        reply->capacity = capacity;
    }
    memcpy((uint8_t *) reply->data + reply->length, message, message->header.length);
    reply->length += message->header.length;
    return 0;
}

static const void *ip_address(const struct sockaddr *address) {
    if (!address) return NULL;
    if (address->sa_family == AF_INET)
        return &((const struct sockaddr_in *) address)->sin_addr;
    if (address->sa_family == AF_INET6)
        return &((const struct sockaddr_in6 *) address)->sin6_addr;
    return NULL;
}

static uint8_t prefix_length(const struct sockaddr *mask, size_t length) {
    const uint8_t *bytes = ip_address(mask);
    uint8_t prefix = 0;
    if (bytes)
        for (size_t i = 0; i < length; i++)
            for (uint8_t bit = 128; bit; bit >>= 1) {
                if (!(bytes[i] & bit)) return prefix;
                prefix++;
            }
    return prefix;
}

static bool link_details(const struct ifaddrs *interface, uint32_t *index, size_t *length, const void **hardware) {
#ifdef __APPLE__
    if (interface->ifa_addr->sa_family != AF_LINK) return false;
    const struct sockaddr_dl *link = (const void *) interface->ifa_addr;
    *index = link->sdl_index;
    *length = link->sdl_alen;
    *hardware = link->sdl_data + link->sdl_nlen;
#else
    if (interface->ifa_addr->sa_family != AF_PACKET) return false;
    const struct sockaddr_ll *link = (const void *) interface->ifa_addr;
    *index = link->sll_ifindex;
    *length = link->sll_halen;
    *hardware = link->sll_addr;
    if (*length > sizeof(link->sll_addr)) return false;
#endif
    return true;
}

// Link entries already carry the index, which avoids an ioctl per address.
static uint32_t interface_index(const struct ifaddrs *interfaces, const char *name) {
    for (const struct ifaddrs *interface = interfaces; interface; interface = interface->ifa_next) {
        uint32_t index;
        size_t length;
        const void *hardware;
        if (interface->ifa_addr && interface->ifa_name && strcmp(interface->ifa_name, name) == 0 &&
            link_details(interface, &index, &length, &hardware))
            return index;
    }
    return if_nametoindex(name);
}

static bool build_link_message(struct route_message *message, const struct ifaddrs *interface) {
    uint32_t index;
    size_t length;
    const void *hardware;
    if (!link_details(interface, &index, &length, &hardware) || length > 24) return false;
    struct link_message body = {
        .type = interface->ifa_flags & IFF_LOOPBACK ? ARPHRD_LOOPBACK_ : (length == 6 ? ARPHRD_ETHER_ : ARPHRD_NONE_),
        .index = index, .flags = (interface->ifa_flags & 0xff) |
            (interface->ifa_flags & IFF_MULTICAST ? 0x1000 : 0),
    };
    message->header.type = RTM_NEWLINK_;
    memcpy(message->payload, &body, sizeof(body));
    message->header.length += sizeof(body);
    return attribute(message, IFLA_IFNAME_, interface->ifa_name, strnlen(interface->ifa_name, IF_NAMESIZE - 1) + 1) &&
        attribute(message, IFLA_ADDRESS_, hardware, length);
}

static bool build_address_message(struct route_message *message, const struct ifaddrs *interface,
                                  const struct ifaddrs *interfaces, uint8_t family) {
    const void *address = ip_address(interface->ifa_addr);
    if (!address) return false;
    uint8_t guest_family = interface->ifa_addr->sa_family == AF_INET ? 2 : 10;
    if (family && family != guest_family) return false;
    size_t length = guest_family == 2 ? 4 : 16;
    struct address_message body = {
        .family = guest_family, .prefix = prefix_length(interface->ifa_netmask, length),
        .scope = interface->ifa_flags & IFF_LOOPBACK ? RT_SCOPE_HOST_ : 0,
        .index = interface_index(interfaces, interface->ifa_name),
    };
    if (guest_family == 10 && IN6_IS_ADDR_LINKLOCAL((const struct in6_addr *) address))
        body.scope = RT_SCOPE_LINK_;
    message->header.type = RTM_NEWADDR_;
    memcpy(message->payload, &body, sizeof(body));
    message->header.length += sizeof(body);
    const void *peer = interface->ifa_flags & IFF_POINTOPOINT ? ip_address(interface->ifa_dstaddr) : NULL;
    const void *broadcast = guest_family == 2 && (interface->ifa_flags & IFF_BROADCAST)
        ? ip_address(interface->ifa_broadaddr) : NULL;
    return attribute(message, IFA_LOCAL_, address, length) &&
        attribute(message, IFA_ADDRESS_, peer ? peer : address, length) &&
        (!broadcast || attribute(message, IFA_BROADCAST_, broadcast, length));
}
