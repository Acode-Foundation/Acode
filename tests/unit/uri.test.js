import { describe, expect, it } from "vitest";
import Uri from "utils/Uri";

const TREE_URI =
	"content://com.android.externalstorage.documents/tree/primary%3ADCIM";
const SINGLE_URI =
	"content://com.android.externalstorage.documents/document/primary%3ADCIM%2Ffile.txt";

describe("Uri.parse", () => {
	it("splits a tree uri containing '::'", () => {
		expect(Uri.parse(`${TREE_URI}::primary:DCIM/file.txt`)).toEqual({
			rootUri: TREE_URI,
			docId: "primary:DCIM/file.txt",
			isFileUri: false,
		});
	});

	it("derives the docId from the last segment of a bare tree uri", () => {
		expect(Uri.parse(TREE_URI)).toEqual({
			rootUri: TREE_URI,
			docId: "primary:DCIM",
			isFileUri: false,
		});
	});

	it("converts a single document uri into tree form", () => {
		expect(Uri.parse(SINGLE_URI)).toEqual({
			rootUri:
				"content://com.android.externalstorage.documents/tree/primary%3A",
			docId: "primary:DCIM/file.txt",
			isFileUri: false,
		});
	});

	it("throws on non-content uris", () => {
		expect(() => Uri.parse("file:///sdcard/x")).toThrow("Invalid uri format");
		expect(() => Uri.parse("ftp://host/x")).toThrow("Invalid uri format");
	});
});

describe("Uri.format", () => {
	it("joins rootUri and docId with '::'", () => {
		expect(Uri.format(TREE_URI, "primary:DCIM/file.txt")).toBe(
			`${TREE_URI}::primary:DCIM/file.txt`,
		);
	});

	it("accepts an object", () => {
		expect(
			Uri.format({ rootUri: TREE_URI, docId: "primary:DCIM/file.txt" }),
		).toBe(`${TREE_URI}::primary:DCIM/file.txt`);
	});

	it("returns the rootUri when there is no docId", () => {
		expect(Uri.format(TREE_URI)).toBe(TREE_URI);
	});
});

describe("Uri.getPrimaryAddress", () => {
	it("returns the path after '::primary:'", () => {
		expect(Uri.getPrimaryAddress(`${TREE_URI}::primary:DCIM/foo`)).toBe(
			"DCIM/foo",
		);
	});
});

describe("Uri.getVirtualAddress", () => {
	it("returns the url unchanged when no storage list is available", () => {
		const url = `${TREE_URI}::primary:DCIM/foo`;
		expect(Uri.getVirtualAddress(url)).toBe(url);
	});
});
