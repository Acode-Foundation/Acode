#pragma once
#include <stdbool.h>
#include <stddef.h>

typedef void (*AlpineExitCallback)(int pid, int status);
typedef struct AlpineTerminal AlpineTerminal;
// `output` and `congested` run on guest threads. `congested` tells blocking writers
// to wait until alpine_terminal_drained; `release` runs once the terminal is gone.
typedef struct {
    void (*output)(void *context, const char *data, size_t length);
    bool (*congested)(void *context);
    void (*release)(void *context);
} AlpineTerminalCallbacks;

// Calls that access guest state are serialized by AlpineRuntime.queue.
int alpine_boot(const char *root, AlpineExitCallback callback);
int alpine_bind(const char *guest, const char *host, bool readOnly);
int alpine_chmod(const char *path, unsigned int mode);
int alpine_start(const char *command, const char *environment, int input, int output, int error);
int alpine_kill(int pid);
bool alpine_running(int pid);
void alpine_reap(void);
void alpine_stop_all(void);
bool alpine_idle(void);
int alpine_unmount(void);
bool alpine_import(const char *archive, const char *root, char *error, size_t capacity);
void alpine_install_fault_handlers(void);
// Recreate guest listening sockets that iOS reclaims while the app is suspended.
void alpine_suspend(void);
void alpine_resume(void);

// Runs a command on a new pseudo-terminal and returns its pid. The context is
// owned by the terminal from this call on, including when starting fails.
int alpine_terminal_start(const char *command, const char *environment, int rows, int cols,
                          void *context, AlpineTerminalCallbacks callbacks, AlpineTerminal **terminal);
// Input, resize, drained and close are thread-safe and do not need AlpineRuntime.queue.
long alpine_terminal_input(AlpineTerminal *terminal, const char *data, size_t length);
void alpine_terminal_resize(AlpineTerminal *terminal, int rows, int cols);
void alpine_terminal_drained(AlpineTerminal *terminal);
// Releases waiting writers, hangs up the session and drops the host's reference;
// the handle is invalid afterwards.
void alpine_terminal_close(AlpineTerminal *terminal);
