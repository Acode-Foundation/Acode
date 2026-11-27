#ifndef KERNEL_VDSO_H
#define KERNEL_VDSO_H

#define VVAR_PAGES 4
#define VDSO_PAGES 2

extern const char vdso_data[VDSO_PAGES * (1 << 12)] __asm__("vdso_data");
int vdso_symbol(const char *name);

#endif
