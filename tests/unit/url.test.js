import { describe, expect, it } from "vitest";
import Url from "utils/Url";

describe("Url.getProtocol", () => {
	it("extracts the protocol", () => {
		expect(Url.getProtocol("ftp://localhost/foo")).toBe("ftp:");
		expect(Url.getProtocol("https://example.com")).toBe("https:");
		expect(Url.getProtocol("file:///sdcard")).toBe("file:");
	});

	it("returns empty string when there is no protocol", () => {
		expect(Url.getProtocol("/sdcard/foo")).toBe("");
	});
});

describe("Url.basename / extname", () => {
	it("returns the last segment of a url", () => {
		expect(Url.basename("ftp://localhost/foo/bar/index.html")).toBe(
			"index.html",
		);
	});

	it("ignores trailing slashes", () => {
		expect(Url.basename("https://example.com/foo/")).toBe("foo");
	});

	it("resolves basenames of content uris", () => {
		expect(
			Url.basename(
				"content://com.android.externalstorage.documents/tree/primary%3ADCIM::primary:DCIM/file.txt",
			),
		).toBe("file.txt");
	});

	it("returns the extension of the basename", () => {
		expect(Url.extname("ftp://host/a/b.txt")).toBe(".txt");
		expect(Url.extname("https://example.com/foo")).toBe("");
	});
});

describe("Url.join", () => {
	it("joins path segments keeping the protocol", () => {
		expect(Url.join("ftp://localhost/foo/", "bar", "baz.txt")).toBe(
			"ftp://localhost/foo/bar/baz.txt",
		);
		expect(Url.join("https://example.com", "/a/b")).toBe(
			"https://example.com/a/b",
		);
	});

	it("requires at least two arguments", () => {
		expect(() => Url.join("ftp://localhost")).toThrow();
	});
});

describe("Url.parse / pathname / dirname", () => {
	it("splits url and query", () => {
		expect(Url.parse("ftp://host/a?x=1")).toEqual({
			url: "ftp://host/a",
			query: "?x=1",
		});
		expect(Url.parse("ftp://host/a")).toEqual({
			url: "ftp://host/a",
			query: "",
		});
	});

	it("extracts the pathname", () => {
		expect(Url.pathname("ftp://myhost.com/foo/bar")).toBe("/foo/bar");
		expect(Url.pathname("file:///sdcard/foo")).toBe("/sdcard/foo");
	});

	it("returns the parent url", () => {
		expect(Url.dirname("ftp://localhost/foo/bar")).toBe(
			"ftp://localhost/foo/",
		);
	});
});

describe("Url.safe", () => {
	it("encodes path segments but leaves the query untouched", () => {
		expect(Url.safe("https://ex.com/a b/c?x=1 2")).toBe(
			"https://ex.com/a%20b/c?x=1 2",
		);
	});
});

describe("Url.formate", () => {
	it("builds a url from its parts", () => {
		expect(
			Url.formate({
				protocol: "ftp:",
				hostname: "host",
				username: "u",
				password: "p",
				path: "a/b",
				port: 21,
				query: { x: "1" },
			}),
		).toBe("ftp://u:p@host:21/a/b?x=1");
	});

	it("builds a minimal url", () => {
		expect(Url.formate({ protocol: "https:", hostname: "x.com" })).toBe(
			"https://x.com",
		);
	});

	it("throws when protocol or hostname are missing", () => {
		expect(() => Url.formate({ hostname: "x.com" })).toThrow();
		expect(() => Url.formate({ protocol: "ftp:" })).toThrow();
	});
});

describe("Url.hidePassword / decodeUrl", () => {
	it("strips the password from a url", () => {
		expect(Url.hidePassword("ftp://user:secret@host.com/a")).toBe(
			"ftp://user@host.com/a",
		);
	});

	it("leaves file urls untouched", () => {
		expect(Url.hidePassword("file:///sdcard/x")).toBe("file:///sdcard/x");
	});

	it("decodes credentials, port, path and query", () => {
		// NOTE: url-parse only splits the port for special protocols
		// (http/https/ws/...), so an http url is used to exercise the
		// port decoding branch of decodeUrl.
		expect(
			Url.decodeUrl("http://user:p%40ss@host.com:8080/a%20b?x=1"),
		).toEqual({
			username: "user",
			password: "p@ss",
			hostname: "host.com",
			pathname: "/a b",
			port: 8080,
			query: { x: "1" },
		});
	});

	it("decodes credentials for ftp urls", () => {
		const decoded = Url.decodeUrl("ftp://user:p%40ss@host.com/a%20b");
		expect(decoded.username).toBe("user");
		expect(decoded.password).toBe("p@ss");
		expect(decoded.hostname).toBe("host.com");
		expect(decoded.pathname).toBe("/a b");
	});
});

describe("Url.areSame", () => {
	it("ignores trailing slashes", () => {
		expect(Url.areSame("ftp://a/", "ftp://a", "ftp://a/")).toBe(true);
	});

	it("detects different urls", () => {
		expect(Url.areSame("ftp://a", "ftp://b")).toBe(false);
	});
});
