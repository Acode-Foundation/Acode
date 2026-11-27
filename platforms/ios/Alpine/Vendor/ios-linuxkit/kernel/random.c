#include <fcntl.h>
#include "kernel/calls.h"
#include "platform/platform.h"

int get_random(char *buf, size_t len) {
    return platform_get_random_bytes(buf, len);
}

dword_t sys_getrandom(addr_t buf_addr, dword_t len, dword_t UNUSED(flags)) {
    if (len > 1 << 20)
        return _EIO;
    char *buf = malloc(len);
    if (get_random(buf, len) != 0) {
        free(buf);
        return _EIO;
    }
    if (user_write(buf_addr, buf, len)) {
        free(buf);
        return _EFAULT;
    }
    free(buf);
    return len;
}
