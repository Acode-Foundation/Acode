/**
 * Copyright (C) dev12124 (dev brazilian, João Guilherme da Silva Freitas Lima), 
 * License: MIT license.
 */

/** 
 * Mask key used to obfuscate sensitive Acode credentials.
 * In JavaScript, plain text variables (e.g., let key = "secret password") 
 * reside in the RAM unprotected, making them vulnerable to access or modification 
 * by malicious installed plugins.
 */
const MASK_KEY = 0x5A;

// Applies a XOR mask to secure sensitive strings
export function maskCredential(secretString) {
    if (!secretString) return [];
    
    // Transforms the string into a masked array of bytes (numbers)
    return Array.from(secretString).map(char => char.charCodeAt(0) ^ MASK_KEY);
}

// Removes the XOR mask to restore the original string
export function unmaskCredential(maskedArray) {
    if (!Array.isArray(maskedArray)) return " ";

    // Removes the mask
    return maskedArray
        .map(byte => String.fromCharCode(byte ^ MASK_KEY))
        .join("");
}