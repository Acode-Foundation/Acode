#ifndef ISH_NODE_H
#define ISH_NODE_H

#include <stddef.h>
#include <stdint.h>

#define NODE_RUNTIME_ARGS_MAX 8
#define NODE_V8_VERSION(major, minor) ((uint32_t) (major) * 1000 + (minor))

// Reads up to `capacity` bytes at `offset`; returns 0 at the end of the file or on error.
typedef size_t (*node_binary_read)(void *context, uint8_t *buffer, size_t capacity, uint64_t offset);

size_t node_runtime_args(const char *path, const char **args);
size_t node_runtime_args_for(uint32_t v8_version, const char **args);
uint32_t node_v8_version_scan(node_binary_read read, void *context, uint64_t size);

#endif
