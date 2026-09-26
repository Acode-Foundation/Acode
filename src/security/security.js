/**
 * Copyright (C) dev12124 (dev brazilian, João Guilherme da Silva Freitas Lima), 
 * License: MIT license.
 */

/** 
 * Mask key used to obfuscate sensitive Acode credentials.
 * In JavaScript, plain text variables reside unprotected in the RAM, 
 * making them vulnerable to access or modification by malicious plugins.
 */
const MASK_KEY = 0x5A;

// Applies a XOR mask to secure sensitive strings
export function maskCredential(secretString) {
    if (!secretString) return [];
    
    return Array.from(secretString).map(char => char.charCodeAt(0) ^ MASK_KEY);
}

// Removes the XOR mask to restore the original string
export function unmaskCredential(maskedArray) {
    if (!Array.isArray(maskedArray)) return " ";

    return maskedArray
        .map(byte => String.fromCharCode(byte ^ MASK_KEY))
        .join("");
}