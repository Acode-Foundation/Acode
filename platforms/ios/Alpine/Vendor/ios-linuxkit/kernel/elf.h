#ifndef ELF_H
#define ELF_H

#include "misc.h"

#define ELF_MAGIC "\177ELF"
#define ELF_64BIT 2
#define ELF_LITTLEENDIAN 1
#define ELF_BIGENDIAN 2
#define ELF_LINUX_ABI 3
#define ELF_EXECUTABLE 2
#define ELF_DYNAMIC 3

// Machine types
#define ELF_AARCH64 183     // EM_AARCH64
#define ELF_MACHINE ELF_AARCH64
#define ELF_CLASS   ELF_64BIT

// 64-bit ELF header (for ARM64)
struct elf_header64 {
    uint32_t magic;
    byte_t bitness;
    byte_t endian;
    byte_t elfversion1;
    byte_t abi;
    byte_t abi_version;
    byte_t padding[7];
    uint16_t type;
    uint16_t machine;
    uint32_t elfversion2;
    uint64_t entry_point;
    uint64_t prghead_off;
    uint64_t secthead_off;
    uint32_t flags;
    uint16_t header_size;
    uint16_t phent_size;
    uint16_t phent_count;
    uint16_t shent_size;
    uint16_t shent_count;
    uint16_t sectname_index;
};

typedef struct elf_header64 elf_header;

#define PT_NULL 0
#define PT_LOAD 1
#define PT_DYNAMIC 2
#define PT_INTERP 3
#define PT_NOTE 4
#define PT_SHLIB 5
#define PT_PHDR 6
#define PT_TLS 7
#define PT_NUM 8

// 64-bit program header (for ARM64)
// Note: field order is different from 32-bit!
struct prg_header64 {
    uint32_t type;
    uint32_t flags;      // flags moved here in 64-bit
    uint64_t offset;
    uint64_t vaddr;
    uint64_t paddr;
    uint64_t filesize;
    uint64_t memsize;
    uint64_t alignment;
};

#define PH_R (1 << 2)
#define PH_W (1 << 1)
#define PH_X (1 << 0)

struct aux_ent {
    uint64_t type;
    uint64_t value;
};
#define ELF_PTR_SIZE 8

#define AX_PHDR 3
#define AX_PHENT 4
#define AX_PHNUM 5
#define AX_PAGESZ 6
#define AX_BASE 7
#define AX_FLAGS 8
#define AX_ENTRY 9
#define AX_UID 11
#define AX_EUID 12
#define AX_GID 13
#define AX_EGID 14
#define AX_PLATFORM 15
#define AX_HWCAP 16
#define AX_CLKTCK 17
#define AX_SECURE 23
#define AX_RANDOM 25
#define AX_HWCAP2 26
#define AX_EXECFN 31
#define AX_SYSINFO 32
#define AX_SYSINFO_EHDR 33

// 64-bit dynamic entry (for ARM64)
struct dyn_ent64 {
    uint64_t tag;
    uint64_t val;
};

#define DT_NULL 0
#define DT_NEEDED 1
#define DT_PLTRELSZ 2
#define DT_PLTGOT 3
#define DT_HASH 4
#define DT_STRTAB 5
#define DT_SYMTAB 6
#define DT_RELA 7
#define DT_RELASZ 8
#define DT_RELAENT 9
#define DT_STRSZ 10
#define DT_SYMENT 11
#define DT_JMPREL 23
#define DT_PLTREL 20

// 64-bit ELF symbol (for ARM64)
struct elf_sym64 {
    uint32_t name;      // Offset in string table
    byte_t info;        // Type and binding
    byte_t other;       // Visibility
    uint16_t shndx;     // Section index
    uint64_t value;     // Symbol value
    uint64_t size;      // Symbol size
};

// ARM64 relocation entry (Rela format with addend)
struct elf_rela64 {
    uint64_t offset;    // Location to apply relocation
    uint64_t info;      // Relocation type and symbol index
    int64_t addend;     // Addend value
};

// ARM64 relocation types
#define R_AARCH64_NONE          0
#define R_AARCH64_ABS64         257
#define R_AARCH64_GLOB_DAT      1025
#define R_AARCH64_JUMP_SLOT     1026
#define R_AARCH64_RELATIVE      1027

// Macros for extracting relocation info (ARM64)
#define ELF64_R_SYM(i)   ((uint32_t)((i) >> 32))
#define ELF64_R_TYPE(i)  ((uint32_t)((i) & 0xffffffff))

// Symbol binding values
#define STB_LOCAL  0
#define STB_GLOBAL 1
#define STB_WEAK   2

// Symbol type values
#define STT_NOTYPE  0
#define STT_OBJECT  1
#define STT_FUNC    2
#define STT_SECTION 3
#define STT_FILE    4

// Macros for symbol info
#define ELF_ST_BIND(i)   ((i) >> 4)
#define ELF_ST_TYPE(i)   ((i) & 0xf)

#endif
