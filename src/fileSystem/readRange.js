import { decode } from "utils/encodings";

// Native bridges return byte arrays, whose length is limited to a signed int.
export const MAX_READ_RANGE_LENGTH = 0x7fffffff;

/**
 * Validate a half-open byte range used by filesystem implementations.
 *
 * @param {number} start Inclusive byte offset
 * @param {number} end Exclusive byte offset
 * @returns {{start: number, end: number, length: number}}
 */
export function validateReadRange(start, end) {
	if (!Number.isSafeInteger(start) || start < 0) {
		throw new RangeError("Range start must be a non-negative safe integer");
	}

	if (!Number.isSafeInteger(end) || end < start) {
		throw new RangeError(
			"Range end must be a safe integer greater than or equal to start",
		);
	}

	const length = end - start;
	if (length > MAX_READ_RANGE_LENGTH) {
		throw new RangeError(
			`Range length must not exceed ${MAX_READ_RANGE_LENGTH} bytes`,
		);
	}

	return { start, end, length };
}

/**
 * Decode range data only after the backend has performed a bounded byte read.
 *
 * @param {ArrayBuffer} data
 * @param {string} [encoding]
 * @returns {Promise<ArrayBuffer|string|object>}
 */
export async function decodeReadRange(data, encoding) {
	return encoding ? decode(data, encoding) : data;
}
