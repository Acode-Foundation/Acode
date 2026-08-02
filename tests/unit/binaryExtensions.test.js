import { describe, expect, it } from "vitest";
import {
	isBinaryFile,
	isBinaryMime,
	isBinaryPath,
	isTextPath,
} from "utils/binaryExtensions";

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
});
