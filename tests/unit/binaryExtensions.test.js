import {
	hasBinaryContent,
	isBinaryFile,
	isBinaryMime,
	isBinaryPath,
	isTextFile,
	isTextPath,
} from "utils/binaryExtensions";
import { describe, expect, it } from "vitest";

describe("isBinaryPath", () => {
	it("detects binary extensions", () => {
		expect(isBinaryPath("photo.jpg")).toBe(true);
		expect(isBinaryPath("downloads/app.apk")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isBinaryPath("IMAGE.PNG")).toBe(true);
	});

	it("detects compound extensions", () => {
		expect(isBinaryPath("archive.tar.gz")).toBe(true);
	});

	it("ignores query strings and hashes", () => {
		expect(isBinaryPath("https://x.com/a.zip?dl=1")).toBe(true);
	});

	it("returns false for text or extensionless paths", () => {
		expect(isBinaryPath("script.js")).toBe(false);
		expect(isBinaryPath("README")).toBe(false);
	});
});

describe("isTextPath", () => {
	it("detects text extensions", () => {
		expect(isTextPath("notes.txt")).toBe(true);
		expect(isTextPath("src/main.js")).toBe(true);
	});

	it("returns false for binary or extensionless paths", () => {
		expect(isTextPath("app.apk")).toBe(false);
		expect(isTextPath("Makefile")).toBe(false);
	});
});

describe("isBinaryMime", () => {
	it("detects binary mime types", () => {
		expect(isBinaryMime("application/zip")).toBe(true);
		expect(isBinaryMime("application/octet-stream")).toBe(true);
	});

	it("returns false for text mime types", () => {
		expect(isBinaryMime("text/plain")).toBe(false);
		expect(isBinaryMime("text/html; charset=utf-8")).toBe(false);
	});

	it("returns false for empty input", () => {
		expect(isBinaryMime("")).toBe(false);
		expect(isBinaryMime(null)).toBe(false);
	});
});

describe("isBinaryFile", () => {
	it("accepts a plain path string", () => {
		expect(isBinaryFile("x.png")).toBe(true);
		expect(isBinaryFile("x.txt")).toBe(false);
	});

	it("returns false for falsy input", () => {
		expect(isBinaryFile(null)).toBe(false);
		expect(isBinaryFile(undefined)).toBe(false);
	});

	it("detects binary files by extension", () => {
		expect(isBinaryFile({ name: "photo.jpg" })).toBe(true);
	});

	it("gives text mime types precedence over the extension", () => {
		expect(isBinaryFile({ mime: "text/csv", url: "file.apk" })).toBe(false);
		expect(isBinaryFile({ type: "text/plain", name: "x.png" })).toBe(false);
	});

	it("treats application/octet-stream as an unknown type", () => {
		// Providers report octet-stream for extensions missing from Android's
		// MIME table, so it must not hide text files from search.
		const octet = "application/octet-stream";
		expect(isBinaryFile({ mime: octet, name: "session.jsonl" })).toBe(false);
		expect(isBinaryFile({ mime: octet, name: "notes.unknownext" })).toBe(false);
		expect(isBinaryFile({ mime: `${octet}; charset=binary`, name: "x" })).toBe(
			false,
		);
	});

	it("still detects binary extensions when the mime type is generic", () => {
		const octet = "application/octet-stream";
		expect(isBinaryFile({ mime: octet, name: "app.apk" })).toBe(true);
		expect(isBinaryFile({ mime: octet, name: "data.db" })).toBe(true);
	});

	it("keeps specific binary mime types authoritative", () => {
		expect(isBinaryFile({ mime: "application/zip", name: "x.unknown" })).toBe(
			true,
		);
		expect(isBinaryFile({ mime: "image/png", name: "x" })).toBe(true);
	});
});

describe("isTextPath line-based formats", () => {
	it("recognizes jsonl, ndjson, log and ini as text", () => {
		expect(isTextPath("session.jsonl")).toBe(true);
		expect(isTextPath("events.ndjson")).toBe(true);
		expect(isTextPath("app.log")).toBe(true);
		expect(isTextPath("config.ini")).toBe(true);
	});
});

describe("hasBinaryContent", () => {
	it("returns false for ordinary text", () => {
		expect(hasBinaryContent('{"a":1}\n{"b":2}\n')).toBe(false);
		expect(hasBinaryContent("tab\tcr\r\nformfeed\f")).toBe(false);
		expect(hasBinaryContent("中文 ✓ émoji 🎉")).toBe(false);
		expect(hasBinaryContent("")).toBe(false);
	});

	it("detects NUL and other control characters", () => {
		expect(hasBinaryContent("abc\u0000def")).toBe(true);
		expect(hasBinaryContent("\u0001\u0002\u0003")).toBe(true);
		expect(hasBinaryContent("x\u007f")).toBe(true);
	});

	it("allows ANSI escape sequences", () => {
		expect(hasBinaryContent("\u001b[31mred\u001b[0m plain")).toBe(false);
	});

	it("only samples the beginning of the text", () => {
		expect(hasBinaryContent(`${"a".repeat(4096)}\u0000`)).toBe(false);
	});

	it("returns false for non-string input", () => {
		expect(hasBinaryContent(null)).toBe(false);
		expect(hasBinaryContent(undefined)).toBe(false);
	});
});

describe("isTextFile", () => {
	it("detects text by extension or mime type", () => {
		expect(isTextFile("app.log")).toBe(true);
		expect(isTextFile({ name: "session.jsonl" })).toBe(true);
		expect(isTextFile({ mime: "text/plain", name: "x.unknownext" })).toBe(true);
	});

	it("returns false when the type is unknown or binary", () => {
		expect(
			isTextFile({ mime: "application/octet-stream", name: "x.unknownext" }),
		).toBe(false);
		expect(isTextFile({ name: "photo.png" })).toBe(false);
		expect(isTextFile(null)).toBe(false);
	});
});
