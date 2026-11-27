#pragma once

// Runs `/bin/sh -c command` as a new child of PID 1. `attach` runs as the new
// task before exec to install its stdio; a negative result fails the spawn.
int alpine_spawn(const char *command, const char *environment, int (*attach)(void *), void *argument);
