import { describe, expect, it } from "vitest";
import Path from "utils/Path";

describe("Path.dirname", () => {
	it("returns the parent directory", () => {
		expect(Path.dirname("/foo/bar/baz.txt")).toBe("/foo/bar");
		expect(Path.dirname("/foo/bar")).toBe("/foo");
	});

	it("ignores trailing separators", () => {
		expect(Path.dirname("foo/bar/")).toBe("./foo");
	});

	it("returns root for top-level absolute paths", () => {
		expect(Path.dirname("/foo")).toBe("/");
	});

	it("returns '.' for bare filenames", () => {
		expect(Path.dirname("file.txt")).toBe(".");
	});
});

describe("Path.basename", () => {
	it("returns the last portion of a path", () => {
		expect(Path.basename("/foo/bar.txt")).toBe("bar.txt");
		expect(Path.basename("foo/bar/baz")).toBe("baz");
	});

	it("strips the given extension", () => {
		expect(Path.basename("/foo/bar.txt", ".txt")).toBe("bar");
	});

	it("ignores trailing separators", () => {
		expect(Path.basename("/foo/bar/")).toBe("bar");
	});

	it("handles edge cases", () => {
		expect(Path.basename("/")).toBe("/");
		expect(Path.basename("")).toBe("");
	});
});

describe("Path.extname", () => {
	it("returns the extension including the dot", () => {
		expect(Path.extname("file.txt")).toBe(".txt");
		expect(Path.extname("archive.tar.gz")).toBe(".gz");
	});

	it("returns empty string when there is no extension", () => {
		expect(Path.extname("foo/bar")).toBe("");
	});

	it("returns empty string for dotfiles", () => {
		expect(Path.extname(".gitignore")).toBe("");
	});
});

describe("Path.join / normalize", () => {
	it("joins segments and normalizes", () => {
		expect(Path.join("foo", "bar", "baz")).toBe("foo/bar/baz");
		expect(Path.join("/foo/", "/bar/")).toBe("/foo/bar/");
	});

	it("resolves '..' segments", () => {
		expect(Path.join("foo", "bar", "../baz")).toBe("foo/baz");
	});

	it("collapses duplicate separators and '.' segments", () => {
		expect(Path.normalize("/foo//bar/./baz/../qux")).toBe("/foo/bar/qux");
	});
});

describe("Path.resolve", () => {
	it("resolves relative segments against a base", () => {
		expect(Path.resolve("path/to/some/dir/", "../../dir")).toBe(
			"/path/to/dir",
		);
	});

	it("resets on absolute segments", () => {
		expect(Path.resolve("/foo", "/bar")).toBe("/bar");
	});

	it("throws without arguments", () => {
		expect(() => Path.resolve()).toThrow();
	});
});

describe("Path.parse / format", () => {
	it("parses a path into its parts", () => {
		expect(Path.parse("/foo/bar.txt")).toEqual({
			root: "/",
			dir: "/foo",
			base: "bar.txt",
			ext: ".txt",
			name: "bar",
		});
	});

	it("formats a path object back to a string", () => {
		expect(Path.format({ dir: "/foo", name: "bar", ext: ".txt" })).toBe(
			"/foo/bar.txt",
		);
	});

	it("ignores a malformed extension when formatting", () => {
		expect(Path.format({ root: "/", name: "bar", ext: "txt" })).toBe("/bar");
	});
});

describe("Path.isAbsolute / convertToRelative", () => {
	it("detects absolute paths", () => {
		expect(Path.isAbsolute("/foo")).toBe(true);
		expect(Path.isAbsolute("foo/bar")).toBe(false);
	});

	it("computes a path relative to a base", () => {
		expect(Path.convertToRelative("/foo/bar", "/foo/baz/qux")).toBe(
			"baz/qux",
		);
	});
});
