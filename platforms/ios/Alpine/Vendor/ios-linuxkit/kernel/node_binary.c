#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "kernel/node.h"

#define VERSION_LOOKBEHIND 32
#define SCAN_CHUNK (1024 * 1024)
#define SCAN_OVERLAP 64
#define SCAN_LIMIT ((uint64_t) 512 * 1024 * 1024)
#define ELF_HEADER_SIZE 64
#define ELF_SECTION_SIZE 64
#define ELF_SECTIONS_MAX 4096
#define ELF_NAMES_MAX (64 * 1024)

struct range {
    uint64_t start, end;
};

static const char version_marker[] = "-node.";

static bool rodata_range(node_binary_read read, void *context, uint64_t size, struct range *rodata);
static bool read_exact(node_binary_read read, void *context, void *buffer, size_t length, uint64_t offset);
static uint64_t little_endian(const uint8_t *bytes, size_t length);
static uint32_t scan_range(node_binary_read read, void *context, struct range range);
static size_t fill(node_binary_read read, void *context, uint8_t *buffer, size_t capacity, uint64_t offset);
static uint32_t version_in(const uint8_t *data, size_t length, size_t from);
static uint32_t parse_version(const uint8_t *start, const uint8_t *end);

// Node's V8 identifies itself as "major.minor.build.patch-node.N". In ELF builds
// the string is in .rodata, so only that section is read when it can be found.
uint32_t node_v8_version_scan(node_binary_read read, void *context, uint64_t size) {
    struct range file = {0, size < SCAN_LIMIT ? size : SCAN_LIMIT};
    struct range rodata;
    if (rodata_range(read, context, file.end, &rodata)) {
        uint32_t version = scan_range(read, context, rodata);
        if (version) return version;
    }
    return scan_range(read, context, file);
}

static bool rodata_range(node_binary_read read, void *context, uint64_t size, struct range *rodata) {
    uint8_t header[ELF_HEADER_SIZE];
    if (!read_exact(read, context, header, sizeof(header), 0) ||
        memcmp(header, "\177ELF", 4) != 0 || header[4] != 2 || header[5] != 1)
        return false;
    uint64_t sections = little_endian(header + 40, 8);
    size_t entry_size = little_endian(header + 58, 2);
    size_t count = little_endian(header + 60, 2);
    size_t names_index = little_endian(header + 62, 2);
    if (entry_size != ELF_SECTION_SIZE || !count || count > ELF_SECTIONS_MAX || names_index >= count ||
        sections > size || count * ELF_SECTION_SIZE > size - sections)
        return false;
    uint8_t *table = malloc(count * ELF_SECTION_SIZE);
    if (!table) return false;
    bool found = false;
    char *names = NULL;
    if (!read_exact(read, context, table, count * ELF_SECTION_SIZE, sections))
        goto done;
    const uint8_t *names_section = table + names_index * ELF_SECTION_SIZE;
    uint64_t names_offset = little_endian(names_section + 24, 8);
    uint64_t names_size = little_endian(names_section + 32, 8);
    if (!names_size || names_size > ELF_NAMES_MAX || names_offset > size || names_size > size - names_offset)
        goto done;
    names = malloc(names_size + 1);
    if (!names || !read_exact(read, context, names, names_size, names_offset))
        goto done;
    names[names_size] = '\0';
    for (size_t i = 0; i < count && !found; i++) {
        const uint8_t *section = table + i * ELF_SECTION_SIZE;
        uint64_t name = little_endian(section, 4);
        uint64_t offset = little_endian(section + 24, 8);
        uint64_t length = little_endian(section + 32, 8);
        if (name < names_size && strcmp(names + name, ".rodata") == 0 &&
            offset <= size && length <= size - offset) {
            *rodata = (struct range) {offset, offset + length};
            found = true;
        }
    }
done:
    free(names);
    free(table);
    return found;
}

static bool read_exact(node_binary_read read, void *context, void *buffer, size_t length, uint64_t offset) {
    return fill(read, context, buffer, length, offset) == length;
}

static uint64_t little_endian(const uint8_t *bytes, size_t length) {
    uint64_t value = 0;
    for (size_t i = length; i > 0; i--)
        value = value << 8 | bytes[i - 1];
    return value;
}

static uint32_t scan_range(node_binary_read read, void *context, struct range range) {
    uint8_t *buffer = malloc(SCAN_OVERLAP + SCAN_CHUNK);
    if (!buffer) return 0;
    uint32_t version = 0;
    size_t kept = 0, from = 0;
    for (uint64_t offset = range.start; !version && offset < range.end;) {
        size_t wanted = range.end - offset < SCAN_CHUNK ? range.end - offset : SCAN_CHUNK;
        size_t count = fill(read, context, buffer + kept, wanted, offset);
        if (!count) break;
        offset += count;
        size_t length = kept + count;
        version = version_in(buffer, length, from);
        if (count < wanted) break;
        if (length >= SCAN_OVERLAP) {
            memmove(buffer, buffer + length - SCAN_OVERLAP, SCAN_OVERLAP);
            kept = SCAN_OVERLAP;
            // Markers starting earlier were complete, with their version, in the previous chunk.
            from = SCAN_OVERLAP - (sizeof(version_marker) - 1) + 1;
        }
    }
    free(buffer);
    return version;
}

static size_t fill(node_binary_read read, void *context, uint8_t *buffer, size_t capacity, uint64_t offset) {
    size_t length = 0;
    for (size_t count; length < capacity && (count = read(context, buffer + length, capacity - length, offset + length));)
        length += count;
    return length;
}

static uint32_t version_in(const uint8_t *data, size_t length, size_t from) {
    const size_t marker_length = sizeof(version_marker) - 1;
    if (length < marker_length || from > length - marker_length) return 0;
    const uint8_t *last = data + length - marker_length;
    for (const uint8_t *found = data + from; found <= last; found++) {
        found = memchr(found, '-', last - found + 1);
        if (!found) return 0;
        if (memcmp(found, version_marker, marker_length) != 0) continue;
        const uint8_t *start = found;
        while (start > data && found - start < VERSION_LOOKBEHIND &&
               ((start[-1] >= '0' && start[-1] <= '9') || start[-1] == '.'))
            start--;
        uint32_t version = parse_version(start, found);
        if (version) return version;
    }
    return 0;
}

static uint32_t parse_version(const uint8_t *start, const uint8_t *end) {
    uint32_t parts[4] = {0};
    size_t part = 0, digits = 0;
    for (const uint8_t *c = start; c < end; c++) {
        if (*c == '.') {
            if (!digits || ++part == 4) return 0;
            digits = 0;
        } else {
            if (++digits > 6) return 0;
            parts[part] = parts[part] * 10 + (*c - '0');
        }
    }
    if (part != 3 || !digits || !parts[0] || parts[0] > 99 || parts[1] > 999) return 0;
    return NODE_V8_VERSION(parts[0], parts[1]);
}
