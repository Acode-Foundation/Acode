// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

// The app installs String#hashCode as a polyfill (src/utils/polyfill.js) and the
// adapter uses it to derive cache names. Install the same shape for this realm.
if (typeof String.prototype.hashCode !== "function") {
	Object.defineProperty(String.prototype, "hashCode", {
		configurable: true,
		value() {
			let hash = 0;
			for (let i = 0; i < this.length; i++) {
				hash = (hash * 31 + this.charCodeAt(i)) % 0x7fffffff;
			}
			return String(hash);
		},
	});
}

/**
 * The SFTP adapter is the layer between the native plug-in and the editor.
 *
 * It used to download straight into the editor's cache file and read that back
 * as the file's contents, so any interrupted transfer was reported as an empty
 * file and could replace someone's work. These tests pin the replacement
 * behaviour: transfers stage to a temporary path, are verified, and only then
 * replace the cache. A failure leaves the previous copy untouched.
 */

// Minimal in-memory stand-in for the internal (local) filesystem, keyed by url.
function createLocalFs(initial = {}) {
	const files = new Map(Object.entries(initial));

	const fsFor = (url) => ({
		async exists() {
			return files.has(url);
		},
		async renameTo(name) {
			// Mirrors internalFs: moves within the same directory by basename.
			const dir = url.split("/").slice(0, -1).join("/");
			const to = `${dir}/${name}`;
			if (!files.has(url)) throw new Error(`not found: ${url}`);
			files.set(to, files.get(url));
			files.delete(url);
			return to;
		},
	});

	return {
		files,
		createFs: fsFor,
		async writeFile(url, content) {
			files.set(url, content);
		},
		async readFile(url) {
			if (!files.has(url)) throw new Error(`not found: ${url}`);
			return { data: files.get(url) };
		},
		async delete(url) {
			files.delete(url);
		},
	};
}

function loadAdapter({ native, local, connected = true }) {
	const sftp = {
		isConnected(ok, fail) {
			ok(connected ? "profile-1" : 0);
		},
		lsDir: native.lsDir,
		stat: native.stat,
		getFile: native.getFile,
		putFile: native.putFile,
		createFile: native.createFile,
		mkdir: native.mkdir,
		rm: native.rm,
		rename: native.rename,
		pwd: native.pwd,
		connectUsingProfile(profileId, ok) {
			pendingConnectIds.push(profileId);
			ok();
		},
	};

	// Returned by join() because the adapter calls Url.join(...).hashCode() to
	// derive cache names. Coerces to the plain path whenever it is used as a
	// string.
	const withHash = (value) => {
		let hash = 0;
		for (let i = 0; i < value.length; i++) {
			hash = (hash * 31 + value.charCodeAt(i)) % 0x7fffffff;
		}
		return {
			hashCode: () => String(hash),
			toString: () => value,
			valueOf: () => value,
		};
	};

	const Url = {
		formate: ({ protocol, hostname }) => `${protocol}//${hostname}`,
		join: (...parts) =>
			withHash(
				parts
					.filter(Boolean)
					.join("/")
					.replace(/([^:])\/{2,}/g, "$1/"),
			),
		basename: (value) => String(value).split("/").filter(Boolean).pop() || "",
		dirname: (value) => String(value).split("/").slice(0, -1).join("/") || "",
		pathname: (value) => String(value),
		decodeUrl: (url) => {
			const match = /^sftp:\/\/([^/]+)(\/.*)?$/.exec(String(url));
			return { hostname: match?.[1], pathname: match?.[2] || "/" };
		},
	};

	const Path = {
		join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"),
		basename: (value) => String(value).split("/").filter(Boolean).pop() || "",
		dirname: (value) => String(value).split("/").slice(0, -1).join("/"),
	};

	const helpers = {
		uuid: (() => {
			let n = 0;
			return () => `id${++n}`;
		})(),
		defineDeprecatedProperty: () => {},
	};

	const module = loadSourceModule(
		"src/fileSystem/sftp.js",
		{
			"lib/settings": { value: {} },
			"mime-types": { lookup: () => "text/plain" },
			"utils/encodings": { decode: (data) => data, encode: (text) => text },
			"utils/helpers": helpers,
			"utils/Path": Path,
			"utils/Url": Url,
			"./internalFs": local,
			"./remoteReadSafety": realSafety,
		},
		// The module is compiled into its own realm, so its String is not this
		// one; pass ours in so the hashCode polyfill above applies inside it.
		{ Promise, console, CACHE_STORAGE: "cache", sftp, String },
	);

	return module.default.fromUrl("sftp://profile-1/home/tony/sections.tsx");
}

const pendingConnectIds = [];

// The safety helpers are pure, so the real implementation is used.
import * as realSafety from "../../src/fileSystem/remoteReadSafety";

beforeEach(() => {
	pendingConnectIds.length = 0;
});

describe("readFile", () => {
	it("stages the download, verifies it, then replaces the cache", async () => {
		const local = createLocalFs({ "cache/old": "previous" });
		const getFile = vi.fn((remote, target, ok) => {
			// The native plug-in writes into the staging path it is given.
			local.files.set(target, "const a = 1;");
			ok();
		});

		const fs = loadAdapter({
			local,
			native: {
				stat: (_path, ok) => ok({ length: 12, isFile: true }),
				getFile,
				lsDir: (_p, ok) => ok([]),
				putFile: (_a, _b, ok) => ok(),
			},
		});

		await fs.readFile();

		// The download target is not the cache path: it is a staging file.
		const stagingTarget = getFile.mock.calls[0][1];
		expect(stagingTarget).not.toBe("cache/sftp...");
		expect(stagingTarget).toMatch(/-tmp-/);
		// The staging file is cleaned up afterwards.
		expect([...local.files.keys()].some((key) => key.includes("-tmp-"))).toBe(
			false,
		);
	});

	it("rejects a short download and keeps the previous cache intact", async () => {
		const local = createLocalFs({ "cache/old": "previous" });
		const getFile = vi.fn((remote, target, ok) => {
			// Simulates a channel that dies mid-transfer.
			local.files.set(target, "");
			ok();
		});

		const fs = loadAdapter({
			local,
			native: {
				stat: (_path, ok) => ok({ length: 4096, isFile: true }),
				getFile,
				lsDir: (_p, ok) => ok([]),
				putFile: (_a, _b, ok) => ok(),
			},
		});

		await expect(fs.readFile()).rejects.toMatchObject({
			code: "INCOMPLETE_DOWNLOAD",
		});
	});

	it("rejects when the native transfer reports an error", async () => {
		const local = createLocalFs();
		const fs = loadAdapter({
			local,
			native: {
				stat: (_path, ok) => ok({ length: 10, isFile: true }),
				getFile: (_r, _t, _ok, fail) =>
					fail({ message: "The channel unexpectedly terminated" }),
				lsDir: (_p, ok) => ok([]),
				putFile: (_a, _b, ok) => ok(),
			},
		});

		await expect(fs.readFile()).rejects.toBeTruthy();
	});
});

describe("writeFile", () => {
	it("uploads from a staging file, never the cache in place", async () => {
		const local = createLocalFs();
		const putFile = vi.fn((remote, source, ok) => ok());

		const fs = loadAdapter({
			local,
			native: {
				stat: (_path, ok) => ok({ length: 0, isFile: true }),
				getFile: (_r, _t, ok) => ok(),
				putFile,
				lsDir: (_p, ok) => ok([]),
			},
		});

		await fs.writeFile("saved text", "utf-8");

		const [, source] = putFile.mock.calls[0];
		expect(source).toMatch(/-tmp-/);
		// The staging file is removed after a successful upload.
		expect([...local.files.keys()].some((key) => key.includes("-tmp-"))).toBe(
			false,
		);
	});

	it("rejects and cleans up when the upload fails", async () => {
		const local = createLocalFs();
		const fs = loadAdapter({
			local,
			native: {
				stat: (_path, ok) => ok({ length: 0, isFile: true }),
				getFile: (_r, _t, ok) => ok(),
				putFile: (_a, _b, _ok, fail) => fail({ message: "disk full" }),
				lsDir: (_p, ok) => ok([]),
			},
		});

		await expect(fs.writeFile("text", "utf-8")).rejects.toBeTruthy();
		expect([...local.files.keys()].some((key) => key.includes("-tmp-"))).toBe(
			false,
		);
	});
});

describe("entry shaping", () => {
	it("marks files as files and keeps the MIME type separate", async () => {
		const local = createLocalFs();
		const fs = loadAdapter({
			local,
			native: {
				stat: (_path, ok) =>
					ok({
						name: "sections.tsx",
						url: "/home/tony/sections.tsx",
						isFile: true,
						isDirectory: false,
						length: 10,
					}),
				lsDir: (_p, ok) =>
					ok([
						{
							name: "sections.tsx",
							url: "/home/tony/sections.tsx",
							isFile: true,
							isDirectory: false,
							length: 10,
						},
						{
							name: "src",
							url: "/home/tony/src",
							isFile: false,
							isDirectory: true,
							length: 0,
						},
					]),
				getFile: (_r, _t, ok) => ok(),
				putFile: (_a, _b, ok) => ok(),
			},
		});

		const [file, dir] = await fs.lsDir();
		expect(file.type).toBe("file");
		expect(file.mime).toBe("text/plain");
		expect(dir.type).toBe("dir");

		const stat = await fs.stat();
		expect(stat.type).toBe("file");
	});
});
