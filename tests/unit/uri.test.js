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

describe("Uri.getDisplayPath", () => {
	it("uses the storage name and a path relative to its SAF root", () => {
		const url = `${TREE_URI}::primary:DCIM/Camera/photo.jpg`;
		expect(
			Uri.getDisplayPath(url, [{ name: "Pictures", url: TREE_URI }]),
		).toBe("Pictures/Camera/photo.jpg");
	});

	it("does not match aliases from a prefix-sharing SAF root", () => {
		const codesRoot =
			"content://com.android.externalstorage.documents/tree/primary%3ACodes";
		const codesBackupRoot =
			"content://com.android.externalstorage.documents/tree/primary%3ACodesBackup";

		expect(
			Uri.getDisplayPath(codesBackupRoot, [
				{ name: "Codes", url: codesRoot },
			]),
		).toBe("primary/CodesBackup");
	});

	it("keeps direct children of a volume-root storage", () => {
		const rootUri =
			"content://com.android.externalstorage.documents/tree/primary%3A";
		const url = `${rootUri}::primary/file.txt`;
		expect(
			Uri.getDisplayPath(url, [{ name: "Internal", url: rootUri }]),
		).toBe("Internal/file.txt");
	});

	it("falls back to a readable volume and document path", () => {
		expect(Uri.getDisplayPath(SINGLE_URI, [])).toBe(
			"primary/DCIM/file.txt",
		);
	});

	it("includes the selected folder in a bare primary tree path", () => {
		const url =
			"content://com.android.externalstorage.documents/tree/primary%3ACodes";
		expect(Uri.getDisplayPath(url, [])).toBe("primary/Codes");
	});

	it("preserves an absolute Termux tree path", () => {
		const url =
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome";
		expect(Uri.getDisplayPath(url, [])).toBe(
			"/data/data/com.termux/files/home",
		);
	});

	it("preserves an absolute path appended to a Termux tree", () => {
		const root =
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome";
		const url = `${root}::/data/data/com.termux/files/home/acode-site-ui`;
		expect(Uri.getDisplayPath(url, [])).toBe(
			"/data/data/com.termux/files/home/acode-site-ui",
		);
	});
});

describe("Uri.getVirtualAddress", () => {
	it("returns the url unchanged when no storage list is available", () => {
		const url = `${TREE_URI}::primary:DCIM/foo`;
		expect(Uri.getVirtualAddress(url)).toBe(url);
	});
});
