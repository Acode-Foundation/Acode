/**
 * Copyright (C) dev12124 (dev brazilian, João Guilherme da Silva Freitas Lima), 
 * License: MIT license.
 */

/** Variable for mask the Sensible Credentials of Acode,
 * in JavaScript: Create a Variable (e.g: let key = "secret password"),
 * this Variable is in the RAM (Random Access Memory) and a Malware-Plugin installed
 * have access and modify the Variable. */
const MASK_KEY = 0x5A;

// The function to he apply a Mask
export function maskCredential(secretString) {
    if (!secretString) return [];
    
    // Transforms the String in a Numbers Array (bytes) maskareds
    return Array.from(secretString).map(char => char.charCodeAt(0) ^ MASK_KEY);
}

// The Function to remove the Mask
export function unmaskCredential(maskedArray) {
    if (!Array.isArray(maskedArray)) return " ";

    // Remove the Mask
    return maskedArray
        .map(byte => String.fromCharCode(byte ^ MASK_KEY))
        .join("");
}
