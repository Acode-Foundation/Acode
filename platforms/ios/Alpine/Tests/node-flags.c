#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "kernel/node.h"

#define MEMORY_SIZE (3 * 1024 * 1024)

struct memory {
    const uint8_t *data;
    size_t length, step;
};

static size_t read_file(void *context, uint8_t *buffer, size_t capacity, uint64_t offset);
static size_t read_memory(void *context, uint8_t *buffer, size_t capacity, uint64_t offset);
static uint32_t scan_memory(const uint8_t *data, size_t length, size_t step);
static uint32_t scan_text(const char *text, size_t position, size_t step);
static uint32_t scan_elf(bool with_rodata);
static void put(uint8_t *bytes, uint64_t value, size_t length);
static bool includes(const char **args, size_t count, const char *arg);

int main(int argc, char **argv) {
    assert(argc == 3);
    FILE *binary = fopen(argv[1], "rb");
    assert(binary);
    assert(fseek(binary, 0, SEEK_END) == 0);
    uint32_t version = node_v8_version_scan(read_file, binary, ftell(binary));
    fclose(binary);
    unsigned major, minor;
    assert(sscanf(argv[2], "%u.%u", &major, &minor) == 2);
    assert(version == NODE_V8_VERSION(major, minor));

    const size_t chunk = 1024 * 1024;
    for (size_t shift = 0; shift < 32; shift++) {
        assert(scan_text("13.6.233.17-node.50", chunk - shift, 7777) == NODE_V8_VERSION(13, 6));
        assert(scan_text("12.4.254.21-node.57", chunk + 3 - shift, chunk) == NODE_V8_VERSION(12, 4));
    }
    assert(scan_text("-node.50 713.6.2.1-node.1 .1.2.3.4-node.2 10.2.154.26-node.39", 100, 64) == NODE_V8_VERSION(10, 2));
    assert(scan_text("1.2.3-node.1 v1.2.3.4.5-node.1", 100, 64) == 0);
    assert(scan_elf(true) == NODE_V8_VERSION(12, 4));
    assert(scan_elf(false) == NODE_V8_VERSION(99, 0));

    const char *args[NODE_RUNTIME_ARGS_MAX];
    assert(node_runtime_args_for(NODE_V8_VERSION(13, 6), args) == NODE_RUNTIME_ARGS_MAX);
    size_t count = node_runtime_args_for(0, args);
    assert(!includes(args, count, "--no-maglev") && !includes(args, count, "--no-sparkplug"));
    assert(includes(args, count, "--single-threaded") && includes(args, count, "--no-lazy"));
    count = node_runtime_args_for(NODE_V8_VERSION(10, 2), args);
    assert(count == NODE_RUNTIME_ARGS_MAX - 1 && !includes(args, count, "--no-maglev"));
    count = node_runtime_args_for(NODE_V8_VERSION(9, 0), args);
    assert(!includes(args, count, "--no-sparkplug") && includes(args, count, "--single-threaded"));
    count = node_runtime_args_for(NODE_V8_VERSION(7, 4), args);
    assert(includes(args, count, "--no-lazy") && !includes(args, count, "--regexp-interpret-all"));

    puts("NODE_FLAGS_PASS");
    count = node_runtime_args_for(version, args);
    for (size_t i = 0; i < count; i++)
        puts(args[i]);
}

static size_t read_file(void *context, uint8_t *buffer, size_t capacity, uint64_t offset) {
    if (fseek(context, (long) offset, SEEK_SET) != 0) return 0;
    return fread(buffer, 1, capacity, context);
}

static size_t read_memory(void *context, uint8_t *buffer, size_t capacity, uint64_t offset) {
    const struct memory *memory = context;
    if (offset >= memory->length) return 0;
    size_t count = memory->length - offset;
    if (count > capacity) count = capacity;
    if (count > memory->step) count = memory->step;
    memcpy(buffer, memory->data + offset, count);
    return count;
}

static uint32_t scan_memory(const uint8_t *data, size_t length, size_t step) {
    struct memory memory = {.data = data, .length = length, .step = step};
    return node_v8_version_scan(read_memory, &memory, length);
}

static uint32_t scan_text(const char *text, size_t position, size_t step) {
    uint8_t *data = calloc(MEMORY_SIZE, 1);
    assert(data);
    memcpy(data + position, text, strlen(text));
    uint32_t version = scan_memory(data, MEMORY_SIZE, step);
    free(data);
    return version;
}

// Places a decoy version before .rodata so the result shows which range was read.
static uint32_t scan_elf(bool with_rodata) {
    static const char names[] = "\0.shstrtab\0.rodata\0.text";
    const size_t names_offset = 0x1000, rodata_offset = 0x2000, sections_offset = 0x3000;
    uint8_t *data = calloc(MEMORY_SIZE, 1);
    assert(data);
    memcpy(data, "\177ELF\2\1\1", 7);
    put(data + 40, sections_offset, 8);
    put(data + 58, 64, 2);
    put(data + 60, 3, 2);
    put(data + 62, 1, 2);
    memcpy(data + names_offset, names, sizeof(names));
    memcpy(data + 0x100, "99.0.1.1-node.1", 15);
    memcpy(data + rodata_offset + 40, "12.4.254.21-node.57", 19);
    uint8_t *section = data + sections_offset + 64;
    put(section, 1, 4);
    put(section + 24, names_offset, 8);
    put(section + 32, sizeof(names), 8);
    section += 64;
    put(section, with_rodata ? 11 : 19, 4);
    put(section + 24, rodata_offset, 8);
    put(section + 32, 0x800, 8);
    uint32_t version = scan_memory(data, MEMORY_SIZE, 4096);
    free(data);
    return version;
}

static void put(uint8_t *bytes, uint64_t value, size_t length) {
    for (size_t i = 0; i < length; i++)
        bytes[i] = (uint8_t) (value >> (8 * i));
}

static bool includes(const char **args, size_t count, const char *arg) {
    for (size_t i = 0; i < count; i++)
        if (strcmp(args[i], arg) == 0) return true;
    return false;
}
