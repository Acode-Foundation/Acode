#include "kernel/node.h"

// Node exits with "bad option" for V8 flags its engine does not define, so each
// setting is only passed to V8 releases known to accept it. Without a readable
// version, settings every supported Node (14 and later) accepts are passed.
#define UNKNOWN_V8_FALLBACK NODE_V8_VERSION(8, 0)

static const struct {
    const char *arg;
    uint32_t minimum;
} node_settings[NODE_RUNTIME_ARGS_MAX] = {
    // Keep JavaScript and regular expressions interpreted. Unlike --jitless, this
    // permits Liftoff's WebAssembly code, which runs inside the ARM64 emulator.
    {"--no-opt", 0},
    {"--no-sparkplug", NODE_V8_VERSION(9, 1)},
    {"--no-maglev", NODE_V8_VERSION(11, 0)},
    {"--regexp-interpret-all", NODE_V8_VERSION(8, 0)},
    // Background compilation and GC threads race with the emulated scheduler.
    {"--single-threaded", NODE_V8_VERSION(8, 0)},
    {"--no-wasm-tier-up", NODE_V8_VERSION(8, 0)},
    // Lazy compilation reuses Zone memory in patterns that corrupt scopes here.
    {"--no-lazy", 0},
    {"--max-old-space-size=512", 0},
};

size_t node_runtime_args_for(uint32_t v8_version, const char **args) {
    uint32_t version = v8_version ? v8_version : UNKNOWN_V8_FALLBACK;
    size_t count = 0;
    for (size_t i = 0; i < NODE_RUNTIME_ARGS_MAX; i++)
        if (version >= node_settings[i].minimum)
            args[count++] = node_settings[i].arg;
    return count;
}
