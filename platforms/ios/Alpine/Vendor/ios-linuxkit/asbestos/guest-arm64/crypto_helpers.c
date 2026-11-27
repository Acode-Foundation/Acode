/*
 * ARM64 Cryptographic Extension Helper Functions
 *
 * These are software implementations of the ARMv8 crypto instructions.
 * They're called from the gadgets in crypto.S.
 */

#include <stdint.h>
#include <string.h>
#include <stdio.h>

/* AES S-box */
static const uint8_t aes_sbox[256] = {
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
};

/* AES inverse S-box */
static const uint8_t aes_inv_sbox[256] = {
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
    0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
    0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
    0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
    0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
    0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
    0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
    0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
    0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
    0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
    0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
    0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
    0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
    0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
    0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d
};

/* SM4 S-box */
static const uint8_t sm4_sbox[256] = {
    0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
    0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
    0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
    0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
    0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
    0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
    0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
    0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
    0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
    0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
    0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
    0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
    0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
    0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
    0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
    0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48
};

/*
 * AES ShiftRows transformation
 * Row 0: no shift
 * Row 1: shift left by 1
 * Row 2: shift left by 2
 * Row 3: shift left by 3
 */
static void aes_shiftrows(uint8_t *state) {
    uint8_t tmp;

    // Row 1: shift left by 1
    tmp = state[1];
    state[1] = state[5];
    state[5] = state[9];
    state[9] = state[13];
    state[13] = tmp;

    // Row 2: shift left by 2
    tmp = state[2];
    state[2] = state[10];
    state[10] = tmp;
    tmp = state[6];
    state[6] = state[14];
    state[14] = tmp;

    // Row 3: shift left by 3 (= right by 1)
    tmp = state[15];
    state[15] = state[11];
    state[11] = state[7];
    state[7] = state[3];
    state[3] = tmp;
}

/*
 * AES Inverse ShiftRows transformation
 */
static void aes_inv_shiftrows(uint8_t *state) {
    uint8_t tmp;

    // Row 1: shift right by 1
    tmp = state[13];
    state[13] = state[9];
    state[9] = state[5];
    state[5] = state[1];
    state[1] = tmp;

    // Row 2: shift right by 2
    tmp = state[2];
    state[2] = state[10];
    state[10] = tmp;
    tmp = state[6];
    state[6] = state[14];
    state[14] = tmp;

    // Row 3: shift right by 3 (= left by 1)
    tmp = state[3];
    state[3] = state[7];
    state[7] = state[11];
    state[11] = state[15];
    state[15] = tmp;
}

/* Galois field multiplication */
static uint8_t gmul(uint8_t a, uint8_t b) {
    uint8_t p = 0;
    for (int i = 0; i < 8; i++) {
        if (b & 1)
            p ^= a;
        int hi_bit = a & 0x80;
        a <<= 1;
        if (hi_bit)
            a ^= 0x1b; // x^8 + x^4 + x^3 + x + 1
        b >>= 1;
    }
    return p;
}

/*
 * AESE: ShiftRows + SubBytes
 * Called from gadget after XOR with round key
 *
 * ARM specification order (from QEMU and ARM pseudocode):
 * 1. AddRoundKey (done in gadget before calling this)
 * 2. ShiftRows
 * 3. SubBytes
 */
void aes_subbytes_shiftrows(uint8_t *state) {
    // ShiftRows FIRST (per ARM specification)
    aes_shiftrows(state);
    // SubBytes SECOND
    for (int i = 0; i < 16; i++) {
        state[i] = aes_sbox[state[i]];
    }
}

/*
 * AESD: InvShiftRows + InvSubBytes
 * Called from gadget after XOR with round key
 *
 * ARM specification order (from QEMU and ARM pseudocode):
 * 1. AddRoundKey (done in gadget before calling this)
 * 2. InvShiftRows
 * 3. InvSubBytes
 */
void aes_inv_subbytes_shiftrows(uint8_t *state) {
    // InvShiftRows FIRST (per ARM specification)
    aes_inv_shiftrows(state);
    // InvSubBytes SECOND
    for (int i = 0; i < 16; i++) {
        state[i] = aes_inv_sbox[state[i]];
    }
}

/*
 * AESMC: MixColumns
 */
void aes_mixcolumns(uint8_t *state) {
    for (int c = 0; c < 4; c++) {
        uint8_t *col = &state[c * 4];
        uint8_t a0 = col[0], a1 = col[1], a2 = col[2], a3 = col[3];

        col[0] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
        col[1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
        col[2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
        col[3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
    }
}

/*
 * AESIMC: Inverse MixColumns
 */
void aes_inv_mixcolumns(uint8_t *state) {
    for (int c = 0; c < 4; c++) {
        uint8_t *col = &state[c * 4];
        uint8_t a0 = col[0], a1 = col[1], a2 = col[2], a3 = col[3];

        col[0] = gmul(a0, 0x0e) ^ gmul(a1, 0x0b) ^ gmul(a2, 0x0d) ^ gmul(a3, 0x09);
        col[1] = gmul(a0, 0x09) ^ gmul(a1, 0x0e) ^ gmul(a2, 0x0b) ^ gmul(a3, 0x0d);
        col[2] = gmul(a0, 0x0d) ^ gmul(a1, 0x09) ^ gmul(a2, 0x0e) ^ gmul(a3, 0x0b);
        col[3] = gmul(a0, 0x0b) ^ gmul(a1, 0x0d) ^ gmul(a2, 0x09) ^ gmul(a3, 0x0e);
    }
}

/*
 * SHA-1 helper functions
 */

static inline uint32_t rotl32(uint32_t x, int n) {
    return (x << n) | (x >> (32 - n));
}

static inline uint64_t ror64(uint64_t x, unsigned n) {
    n &= 63;
    if (n == 0)
        return x;
    return (x >> n) | (x << (64 - n));
}

static inline uint32_t rol32(uint32_t x, unsigned n) {
    return (x << n) | (x >> (32 - n));
}

/* SHA1 Choose function: (B & C) | (~B & D) */
static uint32_t sha1_choose(uint32_t b, uint32_t c, uint32_t d) {
    return (b & c) | (~b & d);
}

/* SHA1 Parity function: B ^ C ^ D */
static uint32_t sha1_parity(uint32_t b, uint32_t c, uint32_t d) {
    return b ^ c ^ d;
}

/* SHA1 Majority function: (B & C) | (B & D) | (C & D) */
static uint32_t sha1_majority(uint32_t b, uint32_t c, uint32_t d) {
    return (b & c) | (b & d) | (c & d);
}

/*
 * SHA1C: SHA1 hash update with Choose function
 * Qd = SHA1 update using Choose
 * Sn = hash value (e rotated)
 * Vm.4S = working variables and message schedule
 */
void sha1c_helper(uint32_t *qd, uint32_t sn, uint32_t *vm) {
    // ARM layout: qd[0]=a (bits 31:0), qd[1]=b (bits 63:32), qd[2]=c (bits 95:64), qd[3]=d (bits 127:96)
    // Note: vm[] contains W[i]+K already combined, K is NOT added here
    uint32_t a = qd[0], b = qd[1], c = qd[2], d = qd[3];
    uint32_t e = sn;

    for (int i = 0; i < 4; i++) {
        uint32_t f = sha1_choose(b, c, d);
        uint32_t t = rotl32(a, 5) + f + e + vm[i];  // vm[i] = W[i] + K[i]
        e = d;
        d = c;
        c = rotl32(b, 30);
        b = a;
        a = t;
    }

    qd[0] = a;
    qd[1] = b;
    qd[2] = c;
    qd[3] = d;
}

/*
 * SHA1M: SHA1 hash update with Majority function
 */
void sha1m_helper(uint32_t *qd, uint32_t sn, uint32_t *vm) {
    // ARM layout: qd[0]=a (bits 31:0), qd[1]=b (bits 63:32), qd[2]=c (bits 95:64), qd[3]=d (bits 127:96)
    // Note: vm[] contains W[i]+K already combined, K is NOT added here
    uint32_t a = qd[0], b = qd[1], c = qd[2], d = qd[3];
    uint32_t e = sn;

    for (int i = 0; i < 4; i++) {
        uint32_t f = sha1_majority(b, c, d);
        uint32_t t = rotl32(a, 5) + f + e + vm[i];  // vm[i] = W[i] + K[i]
        e = d;
        d = c;
        c = rotl32(b, 30);
        b = a;
        a = t;
    }

    qd[0] = a;
    qd[1] = b;
    qd[2] = c;
    qd[3] = d;
}

/*
 * SHA1P: SHA1 hash update with Parity function
 */
void sha1p_helper(uint32_t *qd, uint32_t sn, uint32_t *vm) {
    // ARM layout: qd[0]=a (bits 31:0), qd[1]=b (bits 63:32), qd[2]=c (bits 95:64), qd[3]=d (bits 127:96)
    // Note: vm[] contains W[i]+K already combined, K is NOT added here
    uint32_t a = qd[0], b = qd[1], c = qd[2], d = qd[3];
    uint32_t e = sn;

    for (int i = 0; i < 4; i++) {
        uint32_t f = sha1_parity(b, c, d);
        uint32_t t = rotl32(a, 5) + f + e + vm[i];  // vm[i] = W[i] + K[i]
        e = d;
        d = c;
        c = rotl32(b, 30);
        b = a;
        a = t;
    }

    qd[0] = a;
    qd[1] = b;
    qd[2] = c;
    qd[3] = d;
}

/*
 * SHA1SU0: SHA1 schedule update 0
 * result = (Vn[1]:Vn[0]:Vd[3]:Vd[2]) XOR Vd XOR Vm
 * Where the rearranged value has:
 *   bits 127:96 = Vn[1], bits 95:64 = Vn[0], bits 63:32 = Vd[3], bits 31:0 = Vd[2]
 */
void sha1su0_helper(uint32_t *vd, uint32_t *vn, uint32_t *vm) {
    uint32_t r0 = vd[2] ^ vd[0] ^ vm[0];
    uint32_t r1 = vd[3] ^ vd[1] ^ vm[1];
    uint32_t r2 = vn[0] ^ vd[2] ^ vm[2];
    uint32_t r3 = vn[1] ^ vd[3] ^ vm[3];

    vd[0] = r0;
    vd[1] = r1;
    vd[2] = r2;
    vd[3] = r3;
}

/*
 * SHA1SU1: SHA1 schedule update 1
 * T = Vd XOR (Vn >> 32)
 * Result[i] = ROL(T[i], 1), except Result[3] also XORed with ROL(T[0], 2)
 */
void sha1su1_helper(uint32_t *vd, uint32_t *vn) {
    // Vn >> 32 gives us: [0, vn[3], vn[2], vn[1]] in lanes [3,2,1,0]
    uint32_t t0 = vd[0] ^ vn[1];  // d0 XOR n1
    uint32_t t1 = vd[1] ^ vn[2];  // d1 XOR n2
    uint32_t t2 = vd[2] ^ vn[3];  // d2 XOR n3
    uint32_t t3 = vd[3];          // d3 XOR 0

    vd[0] = rotl32(t0, 1);
    vd[1] = rotl32(t1, 1);
    vd[2] = rotl32(t2, 1);
    // T[3] rotated by 1, then XORed with T[0] rotated by 1+2=3
    vd[3] = rotl32(t3, 1) ^ rotl32(t0, 3);
}

/*
 * SHA-256 helper functions
 */

static inline uint32_t rotr32(uint32_t x, int n) {
    return (x >> n) | (x << (32 - n));
}

/* SHA256 Sigma0 */
static uint32_t sha256_sigma0(uint32_t x) {
    return rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22);
}

/* SHA256 Sigma1 */
static uint32_t sha256_sigma1(uint32_t x) {
    return rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25);
}

/* SHA256 sigma0 (message schedule) */
static uint32_t sha256_sig0(uint32_t x) {
    return rotr32(x, 7) ^ rotr32(x, 18) ^ (x >> 3);
}

/* SHA256 sigma1 (message schedule) */
static uint32_t sha256_sig1(uint32_t x) {
    return rotr32(x, 17) ^ rotr32(x, 19) ^ (x >> 10);
}

/* SHA256 Choose: (E & F) ^ (~E & G) */
static uint32_t sha256_ch(uint32_t e, uint32_t f, uint32_t g) {
    return (e & f) ^ (~e & g);
}

/* SHA256 Majority: (A & B) ^ (A & C) ^ (B & C) */
static uint32_t sha256_maj(uint32_t a, uint32_t b, uint32_t c) {
    return (a & b) ^ (a & c) ^ (b & c);
}

/*
 * SHA256H: SHA256 hash update (part 1)
 */
void sha256h_helper(uint32_t *qd, uint32_t *qn, uint32_t *vm) {
    // ARM layout: lane 0 = bits 31:0, lane 3 = bits 127:96
    // qd[0..3] maps to lanes 0..3 = a,b,c,d
    // qn[0..3] maps to lanes 0..3 = e,f,g,h
    // vm contains 4 words of (W[i] + K[i])

    uint32_t a = qd[0], b = qd[1], c = qd[2], d = qd[3];
    uint32_t e = qn[0], f = qn[1], g = qn[2], h = qn[3];

    for (int i = 0; i < 4; i++) {
        uint32_t t1 = h + sha256_sigma1(e) + sha256_ch(e, f, g) + vm[i];
        uint32_t t2 = sha256_sigma0(a) + sha256_maj(a, b, c);
        h = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }

    qd[0] = a;
    qd[1] = b;
    qd[2] = c;
    qd[3] = d;
}

/*
 * SHA256H2: SHA256 hash update (part 2)
 */
void sha256h2_helper(uint32_t *qd, uint32_t *qn, uint32_t *vm) {
    // Similar to SHA256H but updates the other half (e,f,g,h)
    // ARM layout: qn holds (a,b,c,d), qd holds (e,f,g,h)
    uint32_t a = qn[0], b = qn[1], c = qn[2], d = qn[3];
    uint32_t e = qd[0], f = qd[1], g = qd[2], h = qd[3];

    for (int i = 0; i < 4; i++) {
        uint32_t t1 = h + sha256_sigma1(e) + sha256_ch(e, f, g) + vm[i];
        uint32_t t2 = sha256_sigma0(a) + sha256_maj(a, b, c);
        h = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }

    qd[0] = e;
    qd[1] = f;
    qd[2] = g;
    qd[3] = h;
}

/*
 * SHA256SU0: SHA256 schedule update 0
 * Vd[i] = Vd[i] + sigma0(Vd[i+1])  (with wrap around)
 */
void sha256su0_helper(uint32_t *vd, uint32_t *vn) {
    uint32_t t[4];
    t[0] = vd[0] + sha256_sig0(vd[1]);
    t[1] = vd[1] + sha256_sig0(vd[2]);
    t[2] = vd[2] + sha256_sig0(vd[3]);
    t[3] = vd[3] + sha256_sig0(vn[0]);

    vd[0] = t[0];
    vd[1] = t[1];
    vd[2] = t[2];
    vd[3] = t[3];
}

/*
 * SHA256SU1: SHA256 schedule update 1
 * Vd[i] = Vd[i] + sigma1(Vm[i-2]) + Vn[i-7]  (with appropriate indexing)
 */
void sha256su1_helper(uint32_t *vd, uint32_t *vn, uint32_t *vm) {
    vd[0] = vd[0] + sha256_sig1(vm[2]) + vn[1];
    vd[1] = vd[1] + sha256_sig1(vm[3]) + vn[2];
    vd[2] = vd[2] + sha256_sig1(vd[0]) + vn[3];
    vd[3] = vd[3] + sha256_sig1(vd[1]) + vm[0];
}

/*
 * SHA512SU0: SHA-512 schedule update 0
 * Vd[0] = Vd[0] + s0(Vd[1])
 * Vd[1] = Vd[1] + s0(Vn[0])
 */
static inline uint64_t sha512_s0(uint64_t x) {
    return ror64(x, 1) ^ ror64(x, 8) ^ (x >> 7);
}

void sha512su0_helper(uint64_t *vd, uint64_t *vn) {
    uint64_t d0 = vd[0];
    uint64_t d1 = vd[1];
    uint64_t n0 = vn[0];
    vd[0] = d0 + sha512_s0(d1);
    vd[1] = d1 + sha512_s0(n0);
}

/*
 * SHA512SU1: SHA-512 schedule update 1
 * Vd[0] = Vd[0] + s1(Vn[0]) + Vm[0]
 * Vd[1] = Vd[1] + s1(Vn[1]) + Vm[1]
 */
static inline uint64_t sha512_s1(uint64_t x) {
    return ror64(x, 19) ^ ror64(x, 61) ^ (x >> 6);
}

void sha512su1_helper(uint64_t *vd, uint64_t *vn, uint64_t *vm) {
    uint64_t d0 = vd[0];
    uint64_t d1 = vd[1];
    vd[0] = d0 + sha512_s1(vn[0]) + vm[0];
    vd[1] = d1 + sha512_s1(vn[1]) + vm[1];
}

/*
 * SHA512H: SHA-512 hash update (part 1)
 * Qd = Qd + Sum1(Qn[1]) + Ch(Qn[1], Vm[0], Vm[1]) + Qn[0]
 *
 * Where:
 * - Sum1(x) = ROR(x,14) XOR ROR(x,18) XOR ROR(x,41)
 * - Ch(x,y,z) = (x AND y) XOR (NOT x AND z)
 */
static inline uint64_t sha512_sum1(uint64_t x) {
    return ror64(x, 14) ^ ror64(x, 18) ^ ror64(x, 41);
}

static inline uint64_t sha512_ch(uint64_t x, uint64_t y, uint64_t z) {
    return (x & y) ^ (~x & z);
}

void sha512h_helper(uint64_t *vd, uint64_t *vn, uint64_t *vm) {
    // SHA512H performs two SHA-512 hash rounds
    // x = Vn (in ARM terminology: x<127:64>=Vn[1], x<63:0>=Vn[0])
    // y = Vm (y<127:64>=Vm[1], y<63:0>=Vm[0])
    // w = Vd (w<127:64>=Vd[1], w<63:0>=Vd[0])

    uint64_t x0 = vn[0];  // x<63:0>
    uint64_t x1 = vn[1];  // x<127:64>
    uint64_t y0 = vm[0];  // y<63:0>
    uint64_t y1 = vm[1];  // y<127:64>
    uint64_t w0 = vd[0];  // w<63:0>
    uint64_t w1 = vd[1];  // w<127:64>

    // First round:
    // MSigma1 = Sum1(y<127:64>) = Sum1(y1)
    // Vtmp<127:64> = Ch(y1, x0, x1) + MSigma1 + w<127:64>
    // tmp = Vtmp<127:64> + y<63:0>
    uint64_t msigma1 = sha512_sum1(y1);
    uint64_t vtmp1 = sha512_ch(y1, x0, x1) + msigma1 + w1;
    uint64_t tmp = vtmp1 + y0;

    // Second round:
    // MSigma1 = Sum1(tmp)
    // Vtmp<63:0> = Ch(tmp, y1, x0) + MSigma1 + w<63:0>
    msigma1 = sha512_sum1(tmp);
    uint64_t vtmp0 = sha512_ch(tmp, y1, x0) + msigma1 + w0;

    vd[0] = vtmp0;
    vd[1] = vtmp1;
}

/*
 * SHA512H2: SHA-512 hash update (part 2)
 * Qd = Qd + Sum0(Vm[1]) + Maj(Vm[1], Vn[0], Vn[1])
 *
 * Where:
 * - Sum0(x) = ROR(x,28) XOR ROR(x,34) XOR ROR(x,39)
 * - Maj(x,y,z) = (x AND y) XOR (x AND z) XOR (y AND z)
 */
static inline uint64_t sha512_sum0(uint64_t x) {
    return ror64(x, 28) ^ ror64(x, 34) ^ ror64(x, 39);
}

static inline uint64_t sha512_maj(uint64_t x, uint64_t y, uint64_t z) {
    return (x & y) ^ (x & z) ^ (y & z);
}

void sha512h2_helper(uint64_t *vd, uint64_t *vn, uint64_t *vm) {
    // SHA512H2 performs two SHA-512 hash rounds
    // x = Vn (x<127:64>=Vn[1], x<63:0>=Vn[0])
    // y = Vm (y<127:64>=Vm[1], y<63:0>=Vm[0])
    // w = Vd (w<127:64>=Vd[1], w<63:0>=Vd[0])

    uint64_t x0 = vn[0];  // x<63:0>
    uint64_t y0 = vm[0];  // y<63:0>
    uint64_t y1 = vm[1];  // y<127:64>
    uint64_t w0 = vd[0];  // w<63:0>
    uint64_t w1 = vd[1];  // w<127:64>

    // First round (produces Vtmp<127:64>):
    // NSigma0 = Sum0(y<63:0>) = Sum0(y0)
    // Vtmp<127:64> = Maj(x0, y1, y0) + NSigma0 + w1
    uint64_t nsigma0 = sha512_sum0(y0);
    uint64_t vtmp1 = sha512_maj(x0, y1, y0) + nsigma0 + w1;

    // Second round (produces Vtmp<63:0>):
    // NSigma0 = Sum0(Vtmp<127:64>) = Sum0(vtmp1)
    // Vtmp<63:0> = Maj(vtmp1, y0, y1) + NSigma0 + w0
    nsigma0 = sha512_sum0(vtmp1);
    uint64_t vtmp0 = sha512_maj(vtmp1, y0, y1) + nsigma0 + w0;

    vd[0] = vtmp0;
    vd[1] = vtmp1;
}

/*
 * EOR3: bitwise XOR of three vectors
 * Vd = Vn ^ Vm ^ Va
 */
void eor3_helper(uint8_t *vd, uint8_t *vn, uint8_t *vm, uint8_t *va) {
    for (int i = 0; i < 16; i++) {
        vd[i] = vn[i] ^ vm[i] ^ va[i];
    }
}

/*
 * SM3PARTW1: SM3 message schedule update (part 1)
 */
void sm3partw1_helper(uint32_t *vd, uint32_t *vn, uint32_t *vm) {
    uint32_t t0 = vd[0] ^ vn[0];
    uint32_t t1 = vd[1] ^ vn[1];
    uint32_t t2 = vd[2] ^ vn[2];
    uint32_t t3 = vd[3] ^ vn[3];

    uint32_t r0 = t0 ^ rol32(vm[1], 15);
    uint32_t r1 = t1 ^ rol32(vm[2], 15);
    uint32_t r2 = t2 ^ rol32(vm[3], 15);
    uint32_t r3 = t3 ^ rol32(r0, 15);

    r0 = r0 ^ rol32(r0, 15) ^ rol32(r0, 23);
    r1 = r1 ^ rol32(r1, 15) ^ rol32(r1, 23);
    r2 = r2 ^ rol32(r2, 15) ^ rol32(r2, 23);
    r3 = r3 ^ rol32(r3, 15) ^ rol32(r3, 23);

    vd[0] = r0;
    vd[1] = r1;
    vd[2] = r2;
    vd[3] = r3;
}

static inline uint32_t sm4_sbox_sub(uint32_t x) {
    uint32_t y = 0;
    y |= (uint32_t)sm4_sbox[x & 0xff];
    y |= (uint32_t)sm4_sbox[(x >> 8) & 0xff] << 8;
    y |= (uint32_t)sm4_sbox[(x >> 16) & 0xff] << 16;
    y |= (uint32_t)sm4_sbox[(x >> 24) & 0xff] << 24;
    return y;
}

/*
 * SM4E: SM4 round (4 rounds at once on vector lanes)
 */
void sm4e_helper(uint32_t *vd, uint32_t *vn) {
    uint32_t r0 = vd[0];
    uint32_t r1 = vd[1];
    uint32_t r2 = vd[2];
    uint32_t r3 = vd[3];

    for (int i = 0; i < 4; i++) {
        uint32_t rk = vn[i];
        uint32_t x = r1 ^ r2 ^ r3 ^ rk;
        x = sm4_sbox_sub(x);
        x = x ^ rol32(x, 2) ^ rol32(x, 10) ^ rol32(x, 18) ^ rol32(x, 24);
        x ^= r0;
        r0 = r1;
        r1 = r2;
        r2 = r3;
        r3 = x;
    }

    vd[0] = r0;
    vd[1] = r1;
    vd[2] = r2;
    vd[3] = r3;
}

/*
 * SVE helpers (modeled as 128-bit vectors)
 */
void sve_eor_d_helper(uint64_t *vd, uint64_t *vn, uint64_t *vm) {
    vd[0] = vn[0] ^ vm[0];
    vd[1] = vn[1] ^ vm[1];
}

void sve_xar_d_helper(uint64_t *vd, uint64_t *vn, uint64_t *vm, uint32_t imm) {
    // XAR: Vd = ROR(Vn XOR Vm, imm) - XOR first, then rotate
    unsigned n = imm & 63;
    vd[0] = ror64(vn[0] ^ vm[0], n);
    vd[1] = ror64(vn[1] ^ vm[1], n);
}

/*
 * PMULL: Polynomial Multiply Long
 * Performs carry-less multiplication (used in GCM mode of AES)
 *
 * For size=0 (8-bit elements): multiplies 8 pairs of bytes
 * For size=3 (64-bit elements): multiplies one pair of 64-bit values
 */
static __uint128_t pmull64_full(uint64_t a, uint64_t b) {
    __uint128_t result = 0;
    for (int i = 0; i < 64; i++) {
        if (b & (1ULL << i)) {
            result ^= ((__uint128_t)a) << i;
        }
    }
    return result;
}

void pmull_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, uint32_t Q, uint32_t size) {
    if (size == 0) {
        // 8-bit polynomial multiply: 8 pairs of bytes -> 8 halfwords
        uint16_t *dst = (uint16_t *)rd;
        uint8_t *src_n = Q ? &rn[8] : rn;
        uint8_t *src_m = Q ? &rm[8] : rm;

        for (int i = 0; i < 8; i++) {
            uint16_t a = src_n[i];
            uint16_t b = src_m[i];
            uint16_t result = 0;
            for (int j = 0; j < 8; j++) {
                if (b & (1 << j)) {
                    result ^= a << j;
                }
            }
            dst[i] = result;
        }
    } else if (size == 3) {
        // 64-bit polynomial multiply: 1 pair of 64-bit -> 128-bit
        uint64_t *src_n = (uint64_t *)rn;
        uint64_t *src_m = (uint64_t *)rm;
        __uint128_t *dst = (__uint128_t *)rd;

        uint64_t a = Q ? src_n[1] : src_n[0];
        uint64_t b = Q ? src_m[1] : src_m[0];

        *dst = pmull64_full(a, b);
    }
}

/*
 * TBL - Table lookup
 *
 * Each byte of the index vector (rm) is used as an index into the table
 * formed by concatenating 1-4 consecutive vector registers starting at rn.
 * If the index is out of range, 0 is written to the destination.
 *
 * len: 0=1 register (16 bytes), 1=2 regs (32 bytes), 2=3 regs (48 bytes), 3=4 regs (64 bytes)
 * Q: 0=8-byte operation, 1=16-byte operation
 */
void tbl_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int len, int Q, uint8_t *fp_base) {
    int num_elements = Q ? 16 : 8;
    int table_size = (len + 1) * 16;  // 16, 32, 48, or 64 bytes

    uint8_t result[16];

    for (int i = 0; i < num_elements; i++) {
        uint8_t index = rm[i];
        if (index < table_size) {
            // Calculate which register and offset within that register
            int reg_offset = index / 16;
            int byte_offset = index % 16;
            // Handle register wrap-around (V31 + 1 = V0)
            uint8_t *table_reg = rn + (reg_offset * 16);
            // Check if we've wrapped around the register file
            // fp_base points to V0, so check if we've gone past V31
            if (table_reg >= fp_base + 32 * 16) {
                table_reg -= 32 * 16;  // Wrap to V0
            }
            result[i] = table_reg[byte_offset];
        } else {
            result[i] = 0;
        }
    }

    // Copy result to destination
    for (int i = 0; i < num_elements; i++) {
        rd[i] = result[i];
    }
    // Clear upper bytes if 8-byte operation
    if (!Q) {
        for (int i = 8; i < 16; i++) {
            rd[i] = 0;
        }
    }
}

/*
 * TBX - Table lookup with extend
 *
 * Same as TBL, but out-of-range indices preserve the original destination value
 * instead of being set to 0.
 */
void tbx_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int len, int Q, uint8_t *fp_base) {
    int num_elements = Q ? 16 : 8;
    int table_size = (len + 1) * 16;

    uint8_t result[16];

    // Copy original destination first (for TBX, out-of-range keeps original)
    for (int i = 0; i < 16; i++) {
        result[i] = rd[i];
    }

    for (int i = 0; i < num_elements; i++) {
        uint8_t index = rm[i];
        if (index < table_size) {
            int reg_offset = index / 16;
            int byte_offset = index % 16;
            uint8_t *table_reg = rn + (reg_offset * 16);
            if (table_reg >= fp_base + 32 * 16) {
                table_reg -= 32 * 16;
            }
            result[i] = table_reg[byte_offset];
        }
        // For TBX, if index >= table_size, we keep the original rd[i]
    }

    // Copy result to destination
    for (int i = 0; i < num_elements; i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) {
            rd[i] = 0;
        }
    }
}

/*
 * SHL immediate helper for 32-bit and 64-bit element sizes
 */
void shl_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 2) {
        // 32-bit elements
        uint32_t *src = (uint32_t *)rn;
        uint32_t *dst = (uint32_t *)rd;
        int count = Q ? 4 : 2;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] << shift;
        }
        if (!Q) {
            dst[2] = 0;
            dst[3] = 0;
        }
    } else if (esize == 3) {
        // 64-bit elements
        uint64_t *src = (uint64_t *)rn;
        uint64_t *dst = (uint64_t *)rd;
        int count = Q ? 2 : 1;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] << shift;
        }
        if (!Q) {
            dst[1] = 0;
        }
    }
}

/*
 * USHR immediate helper - unsigned shift right
 */
void ushr_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 0) {
        // 8-bit elements
        int count = Q ? 16 : 8;
        for (int i = 0; i < count; i++) {
            rd[i] = rn[i] >> shift;
        }
        if (!Q) {
            for (int i = 8; i < 16; i++) rd[i] = 0;
        }
    } else if (esize == 1) {
        // 16-bit elements
        uint16_t *src = (uint16_t *)rn;
        uint16_t *dst = (uint16_t *)rd;
        int count = Q ? 8 : 4;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            for (int i = 4; i < 8; i++) dst[i] = 0;
        }
    } else if (esize == 2) {
        // 32-bit elements
        uint32_t *src = (uint32_t *)rn;
        uint32_t *dst = (uint32_t *)rd;
        int count = Q ? 4 : 2;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            dst[2] = 0;
            dst[3] = 0;
        }
    } else if (esize == 3) {
        // 64-bit elements
        uint64_t *src = (uint64_t *)rn;
        uint64_t *dst = (uint64_t *)rd;
        int count = Q ? 2 : 1;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            dst[1] = 0;
        }
    }
}

/*
 * SSHR immediate helper - signed shift right
 */
void sshr_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 0) {
        // 8-bit signed elements
        int8_t *src = (int8_t *)rn;
        int8_t *dst = (int8_t *)rd;
        int count = Q ? 16 : 8;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            for (int i = 8; i < 16; i++) ((uint8_t *)rd)[i] = 0;
        }
    } else if (esize == 1) {
        // 16-bit signed elements
        int16_t *src = (int16_t *)rn;
        int16_t *dst = (int16_t *)rd;
        int count = Q ? 8 : 4;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            for (int i = 4; i < 8; i++) ((uint16_t *)rd)[i] = 0;
        }
    } else if (esize == 2) {
        // 32-bit signed elements
        int32_t *src = (int32_t *)rn;
        int32_t *dst = (int32_t *)rd;
        int count = Q ? 4 : 2;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            ((uint32_t *)rd)[2] = 0;
            ((uint32_t *)rd)[3] = 0;
        }
    } else if (esize == 3) {
        // 64-bit signed elements
        int64_t *src = (int64_t *)rn;
        int64_t *dst = (int64_t *)rd;
        int count = Q ? 2 : 1;
        for (int i = 0; i < count; i++) {
            dst[i] = src[i] >> shift;
        }
        if (!Q) {
            ((uint64_t *)rd)[1] = 0;
        }
    }
}

/*
 * USRA (vector, immediate) - Unsigned Shift Right and Accumulate
 * rd = rd + (rn >> shift) (unsigned)
 */
void usra_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 0) {
        // 8-bit elements
        int count = Q ? 16 : 8;
        for (int i = 0; i < count; i++) {
            rd[i] = rd[i] + (rn[i] >> shift);
        }
    } else if (esize == 1) {
        // 16-bit elements
        uint16_t *src = (uint16_t *)rn;
        uint16_t *dst = (uint16_t *)rd;
        int count = Q ? 8 : 4;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    } else if (esize == 2) {
        // 32-bit elements
        uint32_t *src = (uint32_t *)rn;
        uint32_t *dst = (uint32_t *)rd;
        int count = Q ? 4 : 2;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    } else if (esize == 3) {
        // 64-bit elements
        uint64_t *src = (uint64_t *)rn;
        uint64_t *dst = (uint64_t *)rd;
        int count = Q ? 2 : 1;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    }
}

/*
 * SSRA (vector, immediate) - Signed Shift Right and Accumulate
 * rd = rd + (rn >> shift) (signed)
 */
void ssra_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 0) {
        // 8-bit signed elements
        int8_t *src = (int8_t *)rn;
        int8_t *dst = (int8_t *)rd;
        int count = Q ? 16 : 8;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    } else if (esize == 1) {
        // 16-bit signed elements
        int16_t *src = (int16_t *)rn;
        int16_t *dst = (int16_t *)rd;
        int count = Q ? 8 : 4;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    } else if (esize == 2) {
        // 32-bit signed elements
        int32_t *src = (int32_t *)rn;
        int32_t *dst = (int32_t *)rd;
        int count = Q ? 4 : 2;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    } else if (esize == 3) {
        // 64-bit signed elements
        int64_t *src = (int64_t *)rn;
        int64_t *dst = (int64_t *)rd;
        int count = Q ? 2 : 1;
        for (int i = 0; i < count; i++) {
            dst[i] = dst[i] + (src[i] >> shift);
        }
    }
}

/*
 * USRA (scalar) - Unsigned Shift Right and Accumulate (scalar D register)
 */
void usra_scalar_helper(uint64_t *rd, uint64_t *rn, int shift) {
    *rd = *rd + (*rn >> shift);
}

/*
 * SSRA (scalar) - Signed Shift Right and Accumulate (scalar D register)
 */
void ssra_scalar_helper(int64_t *rd, int64_t *rn, int shift) {
    *rd = *rd + (*rn >> shift);
}

/*
 * SRI (vector, immediate) - Shift Right and Insert
 * For each element: rd = (rd & ~mask) | ((rn >> shift) & mask)
 * where mask = (1 << (element_bits - shift)) - 1
 * i.e., the lower (element_bits - shift) bits are inserted from the shifted source
 */
void sri_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 0) {
        // 8-bit elements
        int count = Q ? 16 : 8;
        uint8_t mask = (1 << (8 - shift)) - 1;  // Mask for inserted bits
        for (int i = 0; i < count; i++) {
            uint8_t shifted = rn[i] >> shift;
            rd[i] = (rd[i] & ~mask) | (shifted & mask);
        }
    } else if (esize == 1) {
        // 16-bit elements
        uint16_t *src = (uint16_t *)rn;
        uint16_t *dst = (uint16_t *)rd;
        int count = Q ? 8 : 4;
        uint16_t mask = (1 << (16 - shift)) - 1;
        for (int i = 0; i < count; i++) {
            uint16_t shifted = src[i] >> shift;
            dst[i] = (dst[i] & ~mask) | (shifted & mask);
        }
    } else if (esize == 2) {
        // 32-bit elements
        uint32_t *src = (uint32_t *)rn;
        uint32_t *dst = (uint32_t *)rd;
        int count = Q ? 4 : 2;
        uint32_t mask = (1UL << (32 - shift)) - 1;
        for (int i = 0; i < count; i++) {
            uint32_t shifted = src[i] >> shift;
            dst[i] = (dst[i] & ~mask) | (shifted & mask);
        }
    } else if (esize == 3) {
        // 64-bit elements
        uint64_t *src = (uint64_t *)rn;
        uint64_t *dst = (uint64_t *)rd;
        int count = Q ? 2 : 1;
        uint64_t mask = (1ULL << (64 - shift)) - 1;
        for (int i = 0; i < count; i++) {
            uint64_t shifted = src[i] >> shift;
            dst[i] = (dst[i] & ~mask) | (shifted & mask);
        }
    }
}

/*
 * SLI (vector, immediate) - Shift Left and Insert
 * For each element: rd = (rd & ~mask) | ((rn << shift) & mask)
 * where mask = ~((1 << shift) - 1)
 * i.e., the upper (element_bits - shift) bits are inserted from the shifted source
 */
void sli_imm_helper(uint8_t *rd, uint8_t *rn, int shift, int esize, int Q) {
    if (esize == 0) {
        // 8-bit elements
        int count = Q ? 16 : 8;
        uint8_t mask = ~((1 << shift) - 1);  // Mask for inserted bits (upper bits)
        for (int i = 0; i < count; i++) {
            uint8_t shifted = rn[i] << shift;
            rd[i] = (rd[i] & ~mask) | (shifted & mask);
        }
    } else if (esize == 1) {
        // 16-bit elements
        uint16_t *src = (uint16_t *)rn;
        uint16_t *dst = (uint16_t *)rd;
        int count = Q ? 8 : 4;
        uint16_t mask = ~((1 << shift) - 1);
        for (int i = 0; i < count; i++) {
            uint16_t shifted = src[i] << shift;
            dst[i] = (dst[i] & ~mask) | (shifted & mask);
        }
    } else if (esize == 2) {
        // 32-bit elements
        uint32_t *src = (uint32_t *)rn;
        uint32_t *dst = (uint32_t *)rd;
        int count = Q ? 4 : 2;
        uint32_t mask = ~((1UL << shift) - 1);
        for (int i = 0; i < count; i++) {
            uint32_t shifted = src[i] << shift;
            dst[i] = (dst[i] & ~mask) | (shifted & mask);
        }
    } else if (esize == 3) {
        // 64-bit elements
        uint64_t *src = (uint64_t *)rn;
        uint64_t *dst = (uint64_t *)rd;
        int count = Q ? 2 : 1;
        uint64_t mask = ~((1ULL << shift) - 1);
        for (int i = 0; i < count; i++) {
            uint64_t shifted = src[i] << shift;
            dst[i] = (dst[i] & ~mask) | (shifted & mask);
        }
    }
}

/*
 * Permute instruction helpers (UZP1, UZP2, TRN1, TRN2, ZIP1, ZIP2)
 * These interleave/deinterleave elements from two source vectors.
 *
 * size: 0=8-bit, 1=16-bit, 2=32-bit, 3=64-bit elements
 * Q: 0=8-byte operation, 1=16-byte operation
 */

// UZP1: Unzip even elements (deinterleave, selecting elements at even indices)
void uzp1_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int size, int Q) {
    uint8_t result[16] = {0};
    int esize = 1 << size;  // Element size in bytes
    int elements = (Q ? 16 : 8) / esize;

    // Take even-indexed elements from Vn and Vm
    for (int i = 0; i < elements / 2; i++) {
        for (int b = 0; b < esize; b++) {
            result[i * esize + b] = rn[(i * 2) * esize + b];
            result[(elements / 2 + i) * esize + b] = rm[(i * 2) * esize + b];
        }
    }

    for (int i = 0; i < (Q ? 16 : 8); i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) rd[i] = 0;
    }
}

// UZP2: Unzip odd elements (deinterleave, selecting elements at odd indices)
void uzp2_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int size, int Q) {
    uint8_t result[16] = {0};
    int esize = 1 << size;
    int elements = (Q ? 16 : 8) / esize;

    // Take odd-indexed elements from Vn and Vm
    for (int i = 0; i < elements / 2; i++) {
        for (int b = 0; b < esize; b++) {
            result[i * esize + b] = rn[(i * 2 + 1) * esize + b];
            result[(elements / 2 + i) * esize + b] = rm[(i * 2 + 1) * esize + b];
        }
    }

    for (int i = 0; i < (Q ? 16 : 8); i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) rd[i] = 0;
    }
}

// TRN1: Transpose even pairs (interleave even-indexed elements)
void trn1_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int size, int Q) {
    uint8_t result[16] = {0};
    int esize = 1 << size;
    int elements = (Q ? 16 : 8) / esize;

    // For each pair, take even element from Vn and even element from Vm
    for (int i = 0; i < elements / 2; i++) {
        for (int b = 0; b < esize; b++) {
            result[(i * 2) * esize + b] = rn[(i * 2) * esize + b];
            result[(i * 2 + 1) * esize + b] = rm[(i * 2) * esize + b];
        }
    }

    for (int i = 0; i < (Q ? 16 : 8); i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) rd[i] = 0;
    }
}

// TRN2: Transpose odd pairs (interleave odd-indexed elements)
void trn2_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int size, int Q) {
    uint8_t result[16] = {0};
    int esize = 1 << size;
    int elements = (Q ? 16 : 8) / esize;

    // For each pair, take odd element from Vn and odd element from Vm
    for (int i = 0; i < elements / 2; i++) {
        for (int b = 0; b < esize; b++) {
            result[(i * 2) * esize + b] = rn[(i * 2 + 1) * esize + b];
            result[(i * 2 + 1) * esize + b] = rm[(i * 2 + 1) * esize + b];
        }
    }

    for (int i = 0; i < (Q ? 16 : 8); i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) rd[i] = 0;
    }
}

// ZIP1: Interleave elements from lower halves
void zip1_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int size, int Q) {
    uint8_t result[16] = {0};
    int esize = 1 << size;
    int elements = (Q ? 16 : 8) / esize;

    // Interleave lower half elements
    for (int i = 0; i < elements / 2; i++) {
        for (int b = 0; b < esize; b++) {
            result[(i * 2) * esize + b] = rn[i * esize + b];
            result[(i * 2 + 1) * esize + b] = rm[i * esize + b];
        }
    }

    for (int i = 0; i < (Q ? 16 : 8); i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) rd[i] = 0;
    }
}

// ZIP2: Interleave elements from upper halves
void zip2_helper(uint8_t *rd, uint8_t *rn, uint8_t *rm, int size, int Q) {
    uint8_t result[16] = {0};
    int esize = 1 << size;
    int elements = (Q ? 16 : 8) / esize;
    int half = elements / 2;

    // Interleave upper half elements
    for (int i = 0; i < elements / 2; i++) {
        for (int b = 0; b < esize; b++) {
            result[(i * 2) * esize + b] = rn[(half + i) * esize + b];
            result[(i * 2 + 1) * esize + b] = rm[(half + i) * esize + b];
        }
    }

    for (int i = 0; i < (Q ? 16 : 8); i++) {
        rd[i] = result[i];
    }
    if (!Q) {
        for (int i = 8; i < 16; i++) rd[i] = 0;
    }
}
