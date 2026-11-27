#include "AcodeAlpine.h"
#include <stdio.h>
#include <stdlib.h>
#include "tools/fakefs.h"

bool alpine_import(const char *archive, const char *root, char *error, size_t capacity) {
    struct fakefsify_error failure = {0};
    bool result = fakefs_import(archive, root, &failure, (struct progress){0});
    if (!result) {
        snprintf(error, capacity, "%s", failure.message ? failure.message : "Could not extract Alpine");
        free(failure.message);
    }
    return result;
}

