#include <assert.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "fs/netlink.h"
#include "kernel/errno.h"

static void check_dump(const struct ifaddrs *interfaces, uint16_t type, uint8_t family);

int main(void) {
    struct ifaddrs *interfaces;
    assert(getifaddrs(&interfaces) == 0);
    check_dump(interfaces, RTM_GETLINK_, 0);
    check_dump(interfaces, RTM_GETADDR_, 0);
    check_dump(interfaces, RTM_GETADDR_, 2);
    check_dump(interfaces, RTM_GETADDR_, 10);
    struct nlmsghdr_ request = {.type = 17, .sequence = 7, .flags = NLM_F_REQUEST_};
    assert(!netlink_route_supports(&request));
    void *data;
    size_t length;
    assert(netlink_route_dump(&request, 0, 42, NULL, &data, &length) == 0);
    struct nlmsghdr_ *error = data;
    assert(error->type == NLMSG_ERROR_ && error->sequence == 7 && error->port == 42);
    int32_t code;
    memcpy(&code, error + 1, sizeof(code));
    assert(code == _EOPNOTSUPP);
    assert(length == sizeof(*error) + sizeof(code) + sizeof(request));
    free(data);
    freeifaddrs(interfaces);
    puts("NETLINK_ROUTE_PASS");
}

static void check_dump(const struct ifaddrs *interfaces, uint16_t type, uint8_t family) {
    struct nlmsghdr_ request = {
        .type = type, .sequence = 123, .flags = NLM_F_REQUEST_ | NLM_F_DUMP_,
    };
    assert(netlink_route_supports(&request));
    void *data;
    size_t length;
    assert(netlink_route_dump(&request, family, 42, interfaces, &data, &length) == 0);
    unsigned count = 0, expected = 0;
    bool loopback = false;
    for (const struct ifaddrs *interface = interfaces; interface; interface = interface->ifa_next) {
        if (!interface->ifa_addr) continue;
        int af = interface->ifa_addr->sa_family;
        if (type == RTM_GETADDR_ &&
            ((af == AF_INET && (!family || family == 2)) || (af == AF_INET6 && (!family || family == 10))))
            expected++;
    }
    for (size_t offset = 0; offset < length;) {
        struct nlmsghdr_ *message = (void *) ((uint8_t *) data + offset);
        assert(message->sequence == 123 && message->port == 42);
        assert(message->length >= sizeof(*message) && message->length % 4 == 0);
        assert(message->length <= length - offset);
        assert(message->flags == NLM_F_MULTI_);
        if (message->type == NLMSG_DONE_) {
            assert(offset + message->length == length);
            break;
        }
        count++;
        assert(message->type == (type == RTM_GETLINK_ ? RTM_NEWLINK_ : RTM_NEWADDR_));
        uint8_t *body = (void *) (message + 1);
        size_t body_length = type == RTM_GETLINK_ ? 16 : 8;
        uint32_t index;
        memcpy(&index, body + 4, sizeof(index));
        assert(index > 0);
        bool name = false, address = false;
        for (size_t pos = sizeof(*message) + body_length; pos < message->length;) {
            uint16_t header[2];
            memcpy(header, (uint8_t *) message + pos, sizeof(header));
            assert(header[0] >= 4 && header[0] <= message->length - pos);
            const uint8_t *value = (uint8_t *) message + pos + 4;
            if (type == RTM_GETLINK_ && header[1] == 3) {
                assert(header[0] > 4 && value[header[0] - 5] == 0);
                name = true;
            }
            if (type == RTM_GETADDR_ && header[1] == 2) {
                assert(body[0] == 2 || body[0] == 10);
                assert(!family || body[0] == family);
                assert(header[0] == (body[0] == 2 ? 8 : 20));
                if (body[0] == 2 && value[0] == 127) {
                    assert(body[1] == 8 && body[3] == 254);
                    loopback = true;
                }
                address = true;
            }
            pos += (header[0] + 3) & ~3;
        }
        assert(type == RTM_GETLINK_ ? name : address);
        offset += message->length;
    }
    assert(count > 0);
    if (type == RTM_GETADDR_) {
        assert(count == expected);
        if (family != 10) assert(loopback);
    }
    free(data);
}
