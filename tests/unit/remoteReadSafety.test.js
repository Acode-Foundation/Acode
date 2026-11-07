import {
	assertDownloadIsComplete,
	byteLengthOf,
	errorMessageOf,
	isMissingFileError,
} from "fileSystem/remoteReadSafety";
import { describe, expect, it } from "vitest";

describe("assertDownloadIsComplete", () => {
	it("accepts a download that matches the reported size", () => {
		expect(() =>
			assertDownloadIsComplete({ byteLength: 120 }, 120, "sections.tsx"),
		).not.toThrow();
	});

	it("accepts a download longer than reported, e.g. after a text conversion", () => {
		expect(() =>
			assertDownloadIsComplete({ byteLength: 130 }, 120, "sections.tsx"),
		).not.toThrow();
	});

	it("rejects an empty download for a file the server says is non-empty", () => {
		// This is the case that blanked a file: a dropped connection left an empty
		// cache, and the empty result was treated as the file's contents.
		expect(() =>
			assertDownloadIsComplete({ byteLength: 0 }, 4096, "sections.tsx"),
		).toThrow(/not downloaded completely/);
	});

	it("rejects a truncated download", () => {
		expect(() =>
			assertDownloadIsComplete({ byteLength: 10 }, 4096, "sections.tsx"),
		).toThrow(/10 of 4096 bytes/);
	});

	it("skips the check when the size is unknown", () => {
		for (const expected of [0, null, undefined, Number.NaN]) {
			expect(() =>
				assertDownloadIsComplete({ byteLength: 0 }, expected, "a.txt"),
			).not.toThrow();
		}
	});

	it("treats a genuinely empty file as valid when the server reports zero", () => {
		expect(() =>
			assertDownloadIsComplete({ byteLength: 0 }, 0, "empty.txt"),
		).not.toThrow();
	});

	it("marks the failure so it is not retried like a network error", () => {
		try {
			assertDownloadIsComplete({ byteLength: 0 }, 10, "a.txt");
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error.code).toBe("INCOMPLETE_DOWNLOAD");
			expect(error.nonRetryable).toBe(true);
			expect(error.message).toMatch(/left untouched/);
		}
	});
});

describe("byteLengthOf", () => {
	it("reads the length of the shapes a download can produce", () => {
		expect(byteLengthOf(new ArrayBuffer(8))).toBe(8);
		expect(byteLengthOf(new Uint8Array(5))).toBe(5);
		expect(byteLengthOf({ length: 3 })).toBe(3);
		expect(byteLengthOf(null)).toBe(0);
		expect(byteLengthOf(undefined)).toBe(0);
	});
});

describe("isMissingFileError", () => {
	it("recognises the ways a provider reports a deleted file", () => {
		for (const error of [
			"No such file",
			"SFTPStatusException: no such file or directory",
			{ message: "ENOENT: no such file" },
			{ code: "ENOENT" },
		]) {
			expect(isMissingFileError(error)).toBe(true);
		}
	});

	it("does not confuse a dropped connection with a missing file", () => {
		for (const error of [
			"Connection lost",
			"The channel unexpectedly terminated",
			{ code: "HOST_KEY_CHANGED", message: "host key changed" },
			null,
		]) {
			expect(isMissingFileError(error)).toBe(false);
		}
	});
});

describe("errorMessageOf", () => {
	it("reads a string, an Error, or a rejected native payload", () => {
		expect(errorMessageOf("plain")).toBe("plain");
		// An Error carries its own message; only native payloads need the code.
		expect(errorMessageOf(new Error("boom"))).toBe("boom");
		expect(errorMessageOf({ code: "ENOENT", message: "missing" })).toBe(
			"ENOENT: missing",
		);
		expect(errorMessageOf(null)).toBe("");
	});
});
