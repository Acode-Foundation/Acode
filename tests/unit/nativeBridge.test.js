import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { rspack } = require("@rspack/core");
const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), "acode-native-bundles-"),
);
const bundles = new Map();
beforeAll(async () => {
	for (const [variant, fdroid] of [
		["paid", false],
		["free", false],
		["paid", true],
	]) {
		const filename = `${variant}-${fdroid}.js`;
		const compiler = rspack({
			mode: "development",
			devtool: false,
			entry: path.resolve("src/native/index.ts"),
			output: { path: directory, filename },
			resolve: { extensions: [".js", ".ts"] },
			module: {
				rules: [
					{
						test: /\.ts$/,
						loader: "builtin:swc-loader",
						options: {
							jsc: { parser: { syntax: "typescript" }, target: "es2015" },
						},
					},
					{
						test: /\.js$/,
						type: "javascript/auto",
						loader: "builtin:swc-loader",
						options: {
							jsc: { parser: { syntax: "ecmascript" }, target: "es2015" },
						},
					},
				],
			},
			plugins: [
				new rspack.DefinePlugin({
					__FREE__: JSON.stringify(variant === "free"),
					__FDROID__: JSON.stringify(fdroid),
				}),
			],
		});
		await new Promise((resolve, reject) =>
			compiler.run((error, stats) =>
				compiler.close(() => {
					if (error || stats.hasErrors())
						reject(error || new Error(stats.toString()));
					else resolve();
				}),
			),
		);
		bundles.set(
			filename,
			fs.readFileSync(path.join(directory, filename), "utf8"),
		);
	}
}, 30000);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const windows = [];
afterEach(() => {
	for (const window of windows.splice(0)) window.happyDOM.abort();
});

describe("Acode bridge", () => {
	test.each([
		"android",
		"ios",
	])("%s reports native callback release independently of a kept billing error", async (platform) => {
		const { window, pending } = await createBridge("paid", false, platform);
		const events = [];
		window.Bridge.exec(
			null,
			(error) => events.push(error),
			"Iap",
			"setPurchaseUpdatedListener",
			[],
			() => events.push("released"),
		);
		const { id } = pending.at(-1);
		const reply = (keep, status, data) => {
			if (platform === "android")
				window.Android.callback({ id, keep, status, data });
			else window.iOS.callback({ id, keep, status, error: data });
		};
		reply(true, 9, -1);
		expect(events).toEqual([-1]);
		reply(false, 9, -1);
		expect(events).toEqual([-1, "released", -1]);
		reply(false, 9, -1);
		expect(events).toEqual([-1, "released", -1]);
	});

	test("defers cold and listening intents until startup is visible, then delivers warm intents synchronously", async () => {
		const { window, pending } = await createBridge();
		window.document.body.classList.add("loading");
		const received = [];
		const receive = (intent) => received.push(intent.data);
		window.system.setIntentHandler(receive, () => {});
		const listener = pending.at(-1);
		window.system.getIntent(receive, () => {});
		respond(window, pending.at(-1), { data: "cold" });
		window.Android.callback({
			id: listener.id,
			status: 1,
			keep: true,
			data: { data: "during startup" },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(received).toEqual([]);
		window.document.body.classList.remove("loading");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(received).toEqual(["cold", "during startup"]);
		window.Android.callback({
			id: listener.id,
			status: 1,
			keep: true,
			data: { data: "warm" },
		});
		expect(received).toEqual(["cold", "during startup", "warm"]);
	});

	test("initializes the actual vendored modules before device readiness and replays readiness to late listeners", async () => {
		const { window, pending } = await createBridge();
		const events = [];
		window.document.addEventListener("deviceready", () => events.push("ready"));
		expect(events).toEqual([]);
		for (const request of pending.splice(0)) {
			const data =
				request.service === "Device"
					? { platform: "Android", sdkVersion: 36 }
					: request.service === "File"
						? {
								dataDirectory: "file:///data/user/0/com.foxdebug.acode/files/",
								applicationDirectory: "file:///android_asset/",
							}
						: {};
			window.Android.callback({ id: request.id, status: 1, keep: false, data });
		}
		window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual(["ready"]);
		expect(window.earlyReadyCount).toBe(1);
		window.document.addEventListener("deviceready", () => events.push("late"));
		expect(events).toEqual(["ready", "late"]);
		expect(window.Bridge.file.dataDirectory).toContain(
			"com.foxdebug.acode/files/",
		);
		expect(window.device.sdkVersion).toBe(36);
		expect(typeof window.resolveLocalFileSystemURL).toBe("function");
		expect(typeof window.Bridge.http.sendRequest).toBe("function");
		expect(window.FileReader).not.toBe(window.browserFileReader);
	});

	test("initializes free and F-Droid bundles with the expected native globals", async () => {
		const free = (await createBridge("free")).window;
		expect(typeof free.admob.BannerAd).toBe("function");
		expect(typeof free.iap).not.toBe("undefined");
		const fdroid = (await createBridge("paid", true)).window;
		expect(fdroid.admob).toBeUndefined();
		expect(fdroid.iap).toBeUndefined();
		expect(typeof fdroid.resolveLocalFileSystemURL).toBe("function");
	});

	test("preserves system theme callbacks and automatic hardware-button subscriptions", async () => {
		const { window, pending } = await createBridge();
		// Happy DOM does not normalize CSS hex colors to computed RGB as WebView does.
		window.getComputedStyle = () => ({
			getPropertyValue: () => "rgb(17, 34, 51)",
		});
		let themed = false;
		window.system.setUiTheme("#112233", {}, () => {
			themed = true;
		});
		const request = pending.at(-1);
		expect(request.service).toBe("System");
		window.Android.callback({
			id: request.id,
			status: 1,
			keep: false,
			data: null,
		});
		expect(themed).toBe(true);
		expect(pending.at(-1).service).toBe("SystemBarPlugin");
		expect(pending.at(-1).action).toBe("setStatusBarBackgroundColor");
		const events = [];
		const listener = () => events.push("volume");
		window.document.addEventListener("volumeupbutton", listener);
		expect(JSON.parse(pending.at(-1).args)).toEqual(["volumeupbutton", true]);
		window.Bridge.fireDocumentEvent("volumeupbutton");
		expect(events).toEqual(["volume"]);
		window.document.removeEventListener("volumeupbutton", listener);
		expect(JSON.parse(pending.at(-1).args)).toEqual(["volumeupbutton", false]);
	});

	test("registers synchronous callbacks first and retains streaming callbacks until completion", async () => {
		const { window } = await createBridge();
		const received = [];
		window.Android.exec = (service, action, args, id) => {
			window.Android.callback({ id, status: 1, keep: true, data: "chunk" });
			window.Android.callback({ id, status: 1, keep: false, data: "done" });
			window.Android.callback({ id, status: 1, keep: false, data: "stale" });
			return true;
		};
		window.Bridge.exec(
			(value) => received.push(value),
			null,
			"System",
			"stream",
			[],
		);
		expect(received).toEqual(["chunk", "done"]);
	});

	test("preserves empty errors, binary buffers and multipart results", async () => {
		const { window, pending } = await createBridge();
		const errors = [];
		const values = [];
		window.Bridge.exec(null, (error) => errors.push(error), "File", "read", []);
		window.Android.callback({
			id: pending.at(-1).id,
			status: 9,
			keep: false,
			data: "",
		});
		expect(errors).toEqual([""]);
		window.Bridge.exec(
			(...data) => values.push(data),
			null,
			"File",
			"read",
			[],
		);
		window.Android.callback({
			id: pending.at(-1).id,
			status: 1,
			keep: false,
			data: {
				kind: "multipart",
				data: [{ kind: "arrayBuffer", data: "AP8=" }, 2],
			},
		});
		expect([...new Uint8Array(values[0][0])]).toEqual([0, 255]);
		expect(values[0][1]).toBe(2);
	});

	test("excludes advertising from paid and billing from F-Droid bridges", async () => {
		expect((await createBridge("paid")).window.admob).toBeUndefined();
		expect(typeof (await createBridge("free")).window.admob.BannerAd).toBe(
			"function",
		);
		expect((await createBridge("paid", true)).window.iap).toBeUndefined();
		expect(bundles.get("paid-false.js")).not.toContain(
			"./src/native/admob/admob.ts",
		);
		expect(bundles.get("paid-true.js")).not.toContain("./src/native/iap.ts");
	});
});

describe("typed native API behavior", () => {
	test("loads polyfills before native modules on older WebViews", async () => {
		const { window } = await createBridge("paid", false, "android", true);
		expect(typeof window.Object.fromEntries).toBe("function");
		expect(window.Bridge.file).toHaveProperty("dataDirectory");
	});
	test("reads file slices across chunks and ignores results after abort", async () => {
		const { window, pending } = await createBridge();
		window.FileReader.READ_CHUNK_SIZE = 3;
		const file = new window.File(
			"test.txt",
			"file:///test.txt",
			"text/plain",
			0,
			8,
		).slice(1, -1);
		const reader = new window.FileReader();
		const events = [];
		for (const type of ["loadstart", "progress", "load", "loadend", "abort"])
			reader[`on${type}`] = (event) => events.push([type, event.loaded]);
		reader.readAsText(file);
		expect([pending.at(-1).action, JSON.parse(pending.at(-1).args)]).toEqual([
			"readAsArrayBuffer",
			[file.localURL, 1, 4],
		]);
		respond(window, pending.at(-1), bytes("abc"));
		expect(JSON.parse(pending.at(-1).args)).toEqual([file.localURL, 4, 7]);
		respond(window, pending.at(-1), bytes("def"));
		expect(reader.result).toBe("abcdef");
		expect(reader.readyState).toBe(window.FileReader.DONE);
		expect(events.map(([type]) => type)).toEqual([
			"loadstart",
			"progress",
			"progress",
			"load",
			"loadend",
		]);
		reader.readAsText(file);
		const aborted = pending.at(-1);
		reader.abort();
		respond(window, aborted, "late");
		expect(reader.result).toBeNull();
		expect(events.slice(-2).map(([type]) => type)).toEqual([
			"abort",
			"loadend",
		]);
	});

	test("decodes text whose characters cross native chunk boundaries", async () => {
		const { window, pending } = await createBridge();
		window.FileReader.READ_CHUNK_SIZE = 3;
		// "a€b" is 61 e2 82 ac 62: the euro sign spans both chunks.
		const file = new window.File("t.txt", "file:///t.txt", "text/plain", 0, 5);
		const reader = new window.FileReader();
		reader.readAsText(file);
		respond(window, pending.at(-1), bytes([0x61, 0xe2, 0x82]));
		respond(window, pending.at(-1), bytes([0xac, 0x62]));
		expect(reader.result).toBe("a€b");

		reader.readAsText(file, "x-unknown-charset");
		expect([pending.at(-1).action, JSON.parse(pending.at(-1).args)]).toEqual([
			"readAsText",
			[file.localURL, "x-unknown-charset", 0, 3],
		]);
	});

	test("delegates Blob reads and preserves writer events, binary data, seeking and truncation", async () => {
		const { window, pending } = await createBridge();
		const reader = new window.FileReader();
		const read = new Promise((resolve, reject) => {
			reader.onload = () => resolve(reader.result);
			reader.onerror = reject;
		});
		reader.readAsText(new window.Blob(["Unicode ✓"]));
		expect(await read).toBe("Unicode ✓");
		const writer = new window.FileWriter(
			new window.File("test", "file:///test", null, 0, 12),
		);
		const events = [];
		for (const type of ["writestart", "write", "writeend"])
			writer[`on${type}`] = () => events.push(type);
		writer.seek(-2);
		writer.write(window.eval("new Uint8Array([0, 255]).buffer"));
		expect(JSON.parse(pending.at(-1).args)).toEqual([
			"file:///test",
			"AP8=",
			10,
			true,
		]);
		respond(window, pending.at(-1), 2);
		expect([writer.position, writer.length]).toEqual([12, 12]);
		writer.truncate(4);
		respond(window, pending.at(-1), 4);
		expect([writer.position, writer.length]).toEqual([4, 4]);
		expect(events).toEqual([
			"writestart",
			"write",
			"writeend",
			"writestart",
			"write",
			"writeend",
		]);
		expect(new window.FileUploadResult(12, 201, "uploaded")).toMatchObject({
			bytesSent: 12,
			responseCode: 201,
			response: "uploaded",
		});
	});

	test("keeps file URL mapping and one-shot directory readers", async () => {
		const { window, pending } = await createBridge();
		const fs = new window.FileSystem("files");
		const file = new window.FileEntry(
			"a #.txt",
			"/a #.txt",
			fs,
			"file:///private/a%20%23.txt",
		);
		expect(file.toInternalURL()).toBe(
			"https://localhost/__cdvfile_files__/a%20%23.txt",
		);
		const reserved = new window.FileEntry(
			"question ? %3F.txt",
			"/folder ?/question ? %3F.txt",
			fs,
			"file:///private/folder%20%3F/question%20%3F%20%253F.txt",
		);
		const reservedURL = new URL(reserved.toInternalURL());
		expect(decodeURIComponent(reservedURL.pathname)).toBe(
			"/__cdvfile_files__/folder ?/question ? %3F.txt",
		);
		expect(reservedURL.search).toBe("");
		expect(reservedURL.hash).toBe("");
		const versioned = new window.FileEntry(
			"worker.js",
			"/worker.js",
			fs,
			"file:///private/worker.js?revision=2",
		);
		expect(versioned.toInternalURL()).toBe(
			"https://localhost/__cdvfile_files__/worker.js?revision=2",
		);
		const content = new window.FileEntry(
			"test",
			"/ignored",
			new window.FileSystem("content"),
			"content://provider/tree/a%3Ab/document/a%3Ab%2Ftest",
		);
		expect(content.toInternalURL()).toBe(
			"https://localhost/__cdvfile_content__/provider/tree/a%3Ab/document/a%3Ab%2Ftest",
		);
		const reader = fs.root.createReader();
		const batches = [];
		reader.readEntries((entries) => batches.push(entries));
		respond(window, pending.at(-1), [
			{
				name: "folder",
				fullPath: "/folder/",
				nativeURL: "file:///folder/",
				isDirectory: true,
				filesystemName: "files",
			},
		]);
		const count = pending.length;
		reader.readEntries((entries) => batches.push(entries));
		expect(batches[0][0].isDirectory).toBe(true);
		expect(batches[1]).toEqual([]);
		expect(pending.length).toBe(count);
	});

	test("retains stored cookies, scopes paths and domains, and accepts expiry commas", async () => {
		const { window } = await createBridge();
		const http = window.Bridge.http;
		window.localStorage.setItem(
			"__advancedHttpCookieStore__",
			JSON.stringify({
				"example.com": {
					"/": {
						legacy: {
							key: "legacy",
							value: "retained",
							domain: "example.com",
							path: "/",
							hostOnly: true,
							creation: "2024-01-01T00:00:00.000Z",
							lastAccessed: "2024-01-01T00:00:00.000Z",
						},
					},
				},
			}),
		);
		expect(http.getCookieString("https://example.com/")).toBe(
			"legacy=retained",
		);
		http.setCookie(
			"https://example.com/private",
			"session=secret; Path=/private; Secure",
		);
		http.setCookieFromString(
			"https://example.com/",
			"future=yes; Expires=Wed, 01 Jan 2031 00:00:00 GMT, second=two; Path=/",
		);
		expect(http.getCookieString("https://example.com/private")).toContain(
			"session=secret",
		);
		expect(http.getCookieString("http://example.com/private")).not.toContain(
			"session=",
		);
		expect(http.getCookieString("https://other.example.com/")).toBe("");
		expect(http.getCookieString("https://example.com/")).toContain(
			"future=yes",
		);
		expect(http.getCookieString("https://example.com/")).toContain(
			"second=two",
		);
		http.setCookie("https://example.com/", "legacy=; Max-Age=0; Path=/");
		expect(http.getCookieString("https://example.com/")).not.toContain(
			"legacy=",
		);
		await new Promise((resolve, reject) =>
			http.removeCookies("https://example.com/", (error) =>
				error ? reject(error) : resolve(),
			),
		);
		expect(http.getCookieString("https://example.com/private")).toBe("");
		// Requests to preview servers must also work when there are no cookies.
		expect(http.getCookieString("http://localhost:48123/")).toBe("");
		expect(http.getCookieString("http://127.0.0.1:48123/")).toBe("");
	});

	test("sends HTTP options and headers, decodes responses and keeps cookies on failures", async () => {
		const { window, pending } = await createBridge();
		const http = window.Bridge.http;
		const received = [],
			failures = [];
		http.setHeader("X-Global", "global");
		http.setHeader("example.com", "X-Host", "host");
		http.setCookie("https://example.com/", "token=one; Path=/");
		const id = http.sendRequest(
			"https://example.com/path",
			{
				responseType: "json",
				params: { q: "a b" },
				followRedirect: false,
				connectTimeout: 0,
				readTimeout: 9,
				headers: { "X-Global": "request" },
			},
			(value) => received.push(value),
			(value) => failures.push(value),
		);
		expect(JSON.parse(pending.at(-1).args)).toEqual([
			"https://example.com/path?q=a%20b",
			{ "X-Global": "request", "X-Host": "host", Cookie: "token=one" },
			0,
			9,
			false,
			"json",
			id,
		]);
		respond(window, pending.at(-1), {
			status: 200,
			url: "https://example.com/path",
			data: '{"ok":true}',
			headers: {},
		});
		expect(received[0].data).toEqual({ ok: true });
		http.sendRequest(
			"https://example.com/",
			{ responseType: "json" },
			(value) => received.push(value),
			(value) => failures.push(value),
		);
		respond(window, pending.at(-1), {
			status: 200,
			url: "https://example.com/",
			data: "invalid json",
			headers: {},
		});
		expect(failures[0].status).toBe(http.ErrorCode.POST_PROCESSING_FAILED);
		http.get(
			"https://example.com/",
			{},
			{},
			() => {},
			(value) => failures.push(value),
		);
		respond(
			window,
			pending.at(-1),
			{
				status: 401,
				url: "https://example.com/",
				error: "denied",
				headers: { "Set-Cookie": "token=two; Path=/" },
			},
			9,
		);
		expect(http.getCookieString("https://example.com/")).toBe("token=two");
		http.abort(
			id,
			() => {},
			() => {},
		);
		expect([pending.at(-1).action, JSON.parse(pending.at(-1).args)]).toEqual([
			"abort",
			[id],
		]);
	});

	test("encodes multipart and binary HTTP bodies and returns download entries", async () => {
		const { window, pending } = await createBridge();
		const http = window.Bridge.http;
		const form = new http.ponyfills.FormData();
		form.append("name", "✓");
		form.append(
			"file",
			new window.Blob(["hello"], { type: "text/plain" }),
			"hello.txt",
		);
		http.sendRequest(
			"https://example.com/",
			{ method: "post", serializer: "multipart", data: form },
			() => {},
			(error) => {
				throw error;
			},
		);
		await window.happyDOM.waitUntilComplete();
		const args = JSON.parse(pending.at(-1).args);
		expect(args[1]).toEqual({
			buffers: ["4pyT", "aGVsbG8="],
			names: ["name", "file"],
			fileNames: [null, "hello.txt"],
			types: ["text/plain", "text/plain"],
		});
		http.sendRequest(
			"https://example.com/",
			{
				method: "post",
				serializer: "raw",
				data: window.eval("new Uint8Array([0,255])"),
			},
			() => {},
			() => {},
		);
		expect(JSON.parse(pending.at(-1).args)[1]).toBe("AP8=");
		const download = new Promise((resolve, reject) =>
			http.downloadFile(
				"https://example.com/file",
				{},
				{},
				"file:///cache/file",
				(...values) => resolve(values),
				reject,
			),
		);
		respond(window, pending.at(-1), {
			status: 200,
			url: "https://example.com/file",
			headers: {},
			file: {
				name: "file",
				fullPath: "/file",
				filesystemName: "cache",
				nativeURL: "file:///cache/file",
				isDirectory: false,
			},
		});
		const [entry, response] = await download;
		expect(entry.toInternalURL()).toBe(
			"https://localhost/__cdvfile_cache__/file",
		);
		expect(response.file).toBe(entry);
	});

	test("registers native WebSocket events and preserves binary views and close state", async () => {
		const { window, pending } = await createBridge();
		const connection = window.Bridge.websocket.connect(
			"ws://localhost/test",
			["test"],
			{ Authorization: "token" },
			"arraybuffer",
		);
		expect(JSON.parse(pending.at(-1).args)).toEqual([
			"ws://localhost/test",
			["test"],
			{ Authorization: "token" },
			"arraybuffer",
		]);
		respond(window, pending.at(-1), "socket-1");
		const socket = await connection;
		const listener = pending.at(-1);
		expect(listener.action).toBe("registerListener");
		window.Android.callback({
			id: listener.id,
			status: 1,
			keep: true,
			data: { type: "open" },
		});
		const messages = [];
		socket.addEventListener("message", (event) => messages.push(event.data));
		window.Android.callback({
			id: listener.id,
			status: 1,
			keep: true,
			data: { type: "message", data: "AP8=", isBinary: true },
		});
		expect([...new Uint8Array(messages[0])]).toEqual([0, 255]);
		socket.send(window.eval("new Uint8Array([1,2,3,4]).subarray(1,3)"));
		expect(JSON.parse(pending.at(-1).args)).toEqual(["socket-1", "AgM=", true]);
		socket.close(1000, "done");
		expect(socket.readyState).toBe(2);
		const closes = [];
		socket.addEventListener("close", (event) =>
			closes.push([event.code, event.reason]),
		);
		window.Android.callback({
			id: listener.id,
			status: 1,
			keep: false,
			data: {
				type: "close",
				data: JSON.stringify({ code: 1000, reason: "done" }),
			},
		});
		expect(closes).toEqual([[1000, "done"]]);
		expect(socket.readyState).toBe(3);
		expect(() => socket.send("late")).toThrow("not open");
	});

	test("restores iOS file references before publishing device readiness", async () => {
		const { window, pending } = await createBridge("paid", false, "ios");
		window.localStorage.recentFiles = JSON.stringify([
			"file:///old/Documents/file.txt",
		]);
		const ready = [];
		window.document.addEventListener("deviceready", () =>
			ready.push(JSON.parse(window.localStorage.recentFiles)),
		);
		for (const request of pending.splice(0)) {
			const success =
				request.service === "File"
					? {
							dataDirectory: "file:///current/Library/NoCloud/",
						}
					: request.service === "Device"
						? { platform: "iOS" }
						: {};
			window.iOS.callback({ id: request.id, success });
		}
		window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ready).toEqual([]);
		const request = pending.find(
			(item) => item.action === "getPathReplacements",
		);
		expect(request?.service).toBe("File");
		window.iOS.callback({
			id: request.id,
			success: [
				{ from: "file:///old/Documents", to: "file:///current/Documents" },
			],
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ready).toEqual([["file:///current/Documents/file.txt"]]);
		expect(window.Bridge.file.pathReplacements).toBeUndefined();
	});

	test("routes iOS callbacks and toast through the retained platform adapter", async () => {
		const { window, pending } = await createBridge("paid", false, "ios");
		expect(window.Bridge.platformId).toBe("ios");
		const values = [],
			errors = [];
		window.Bridge.exec(
			(value) => values.push(value),
			(error) => errors.push(error),
			"Native",
			"test",
			[],
		);
		const id = pending.at(-1).id;
		window.iOS.callback({
			id,
			keep: true,
			success: "\0ÿ",
			isBinary: true,
			length: 2,
		});
		window.iOS.callback({ id, error: "" });
		window.iOS.callback({ id, success: "stale" });
		expect([...new Uint8Array(values[0])]).toEqual([0, 255]);
		expect(errors).toEqual([""]);
		const toasts = [];
		window.toast = (value) => toasts.push(value);
		window.Bridge.exec(
			() => values.push("toast complete"),
			null,
			"Native",
			"showToast",
			["hello"],
		);
		expect(toasts).toEqual(["hello"]);
		expect(values.at(-1)).toBe("toast complete");
	});
});

describe("legacy plugin compatibility", () => {
	test("exposes every former public plugin module through the existing native objects", async () => {
		const { window } = await createBridge("free");
		const legacy = window.cordova;
		expect(legacy).not.toBe(window.Bridge);
		for (const [id, value] of [
			["cordova", legacy],
			["cordova/exec", legacy.exec],
			["cordova/plugin/android/app", window.navigator.app],
			["cordova/plugin/android/statusbar", window.statusbar],
			["cordova/plugin/android/splashscreen", window.navigator.splashscreen],
			["cordova-clipboard.Clipboard", window.Bridge.clipboard],
			["cordova-plugin-device.device", window.device],
			["cordova-plugin-server.CreateServer", window.CreateServer],
			["cordova-plugin-ftp.ftp", window.ftp],
			["cordova-plugin-sdcard.sdcard", window.sdcard],
			["cordova-plugin-websocket.WebSocket", window.Bridge.websocket],
			["cordova-plugin-buildinfo.BuildInfo", window.BuildInfo],
			["cordova-plugin-sftp.sftp", window.sftp],
			["com.foxdebug.acode.rk.exec.terminal.Terminal", window.Terminal],
			["com.foxdebug.acode.rk.exec.terminal.Executor", window.Executor],
			["cordova-plugin-iap.iap", window.iap],
			["com.foxdebug.acode.rk.customtabs.CustomTabs", window.CustomTabs],
			["cordova-plugin-advanced-http.http", window.Bridge.http],
			["cordova-plugin-system.system", window.system],
			["admob-plus-cordova.AdMob", window.admob],
		]) {
			expect(value, id).not.toBeUndefined();
			expect(legacy.require(id), id).toBe(value);
		}
		for (const name of [
			"DirectoryEntry",
			"DirectoryReader",
			"Entry",
			"File",
			"FileEntry",
			"FileError",
			"FileReader",
			"FileSystem",
			"FileUploadOptions",
			"FileUploadResult",
			"FileWriter",
			"Flags",
			"LocalFileSystem",
			"Metadata",
			"ProgressEvent",
			"requestFileSystem",
		])
			expect(legacy.require(`cordova-plugin-file.${name}`)).toBe(window[name]);
		expect(legacy.file).toBe(window.Bridge.file);
		expect(legacy.websocket).toBe(window.Bridge.websocket);
		expect(legacy.plugin.http).toBe(window.Bridge.http);
		expect(legacy.plugins.clipboard).toBe(window.Bridge.clipboard);
		expect(legacy.require("cordova-plugin-file.fileSystemPaths").file).toBe(
			legacy.file,
		);
		expect(
			legacy.require("cordova-plugin-file.resolveLocalFileSystemURI")
				.resolveLocalFileSystemURL,
		).toBe(window.resolveLocalFileSystemURL);
		expect(window.device.cordova).toBe(legacy.version);
		expect(legacy.platformId).toBe("android");
		expect(legacy.platformVersion).toBe(legacy.version);
	});

	test("retains native callbacks, HTTP errors, streaming and clipboard calls through old names", async () => {
		const { window, pending } = await createBridge();
		const values = [],
			errors = [];
		window.cordova.exec(
			(value) => values.push(value),
			(error) => errors.push(error),
			"System",
			"stream",
			["input"],
		);
		const stream = pending.at(-1);
		expect([stream.service, stream.action, JSON.parse(stream.args)]).toEqual([
			"System",
			"stream",
			["input"],
		]);
		window.Android.callback({
			id: stream.id,
			status: 1,
			keep: true,
			data: "first",
		});
		respond(window, stream, "last");
		respond(window, stream, "stale");
		expect(values).toEqual(["first", "last"]);
		window.cordova.plugin.http.sendRequest(
			"https://example.com/token",
			{
				method: "post",
				serializer: "urlencoded",
				data: { code: "a b" },
				followRedirect: false,
			},
			(value) => values.push(value),
			(error) => errors.push(error),
		);
		expect(pending.at(-1).service).toBe("NativeHttpPlugin");
		expect(pending.at(-1).action).toBe("post");
		respond(
			window,
			pending.at(-1),
			{
				status: 401,
				error: "denied",
				headers: {},
				url: "https://example.com/token",
			},
			9,
		);
		expect(errors.at(-1)).toMatchObject({ status: 401, error: "denied" });
		window.cordova.plugins.clipboard.copy(
			"copied",
			() => values.push("copied"),
			(error) => errors.push(error),
		);
		expect([
			pending.at(-1).service,
			pending.at(-1).action,
			JSON.parse(pending.at(-1).args),
		]).toEqual(["Clipboard", "copy", ["copied"]]);
		respond(window, pending.at(-1), null);
		window.cordova.plugins.clipboard.paste(
			(value) => values.push(value),
			(error) => errors.push(error),
		);
		respond(window, pending.at(-1), "pasted");
		expect(values.slice(-2)).toEqual(["copied", "pasted"]);
		expect(Reflect.set(window.cordova, "exec", () => {})).toBe(false);
		expect(
			Object.getOwnPropertyDescriptor(window.cordova, "exec").configurable,
		).toBe(false);
	});

	test("shares readiness, delayed paths and lifecycle events without running startup twice", async () => {
		const { window, pending } = await createBridge();
		const channel = window.cordova.require("cordova/channel");
		const events = [];
		window.cordova.addConstructor(() => events.push("constructor"));
		channel.onCordovaReady.subscribe(() => events.push("bridge"));
		channel.onPluginsReady.subscribe(() => events.push("plugins"));
		window.document.addEventListener("deviceready", () => events.push("ready"));
		expect(events).toEqual(["constructor", "bridge", "plugins"]);
		channel.waitForInitialization("onCordovaReady");
		expect(
			channel.deviceReadyChannelsArray.filter(
				(event) => event.type === "onBridgeReady",
			),
		).toHaveLength(1);
		for (const request of pending.splice(0))
			respond(
				window,
				request,
				request.service === "File"
					? { dataDirectory: "file:///data/files/" }
					: {},
			);
		window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		channel.onDeviceReady.subscribe(() => events.push("late"));
		expect(events.slice(-2)).toEqual(["ready", "late"]);
		expect(window.cordova.file.dataDirectory).toBe("file:///data/files/");
		const resume = (event) => events.push(event.type);
		channel.onResume.subscribe(resume);
		channel.onPause.subscribe((event) => events.push(event.type));
		window.Bridge.fireDocumentEvent("pause");
		window.Bridge.fireDocumentEvent("resume");
		channel.onResume.unsubscribe(resume);
		window.Bridge.fireDocumentEvent("resume");
		expect(events.slice(-2)).toEqual(["pause", "resume"]);
		const custom = window.cordova.addStickyDocumentEventHandler("pluginready");
		window.cordova.fireDocumentEvent("pluginready", { value: 7 });
		custom.subscribe((event) => events.push(event.value));
		expect(events.at(-1)).toBe(7);
		window.cordova.removeDocumentEventHandler("pluginready");
	});

	test("does not expose advertising or billing in editions that exclude them", async () => {
		const paid = (await createBridge()).window;
		expect(() => paid.cordova.require("admob-plus-cordova.AdMob")).toThrow(
			"not found",
		);
		const fdroid = (await createBridge("paid", true)).window;
		expect(() => fdroid.cordova.require("cordova-plugin-iap.iap")).toThrow(
			"not found",
		);
		expect(fdroid.cordova.plugin.http).toBe(fdroid.Bridge.http);
		expect(bundles.get("paid-false.js")).not.toContain(
			"./src/native/admob/admob.ts",
		);
		expect(bundles.get("paid-true.js")).not.toContain("./src/native/iap.ts");
	});

	test("loads plugin-defined modules once and resolves their relative native module imports", async () => {
		const { window } = await createBridge();
		const { define, require } = window.cordova;
		let loads = 0;
		define("example.native", (require, exports, module) => {
			loads++;
			module.exports = require("cordova/exec");
		});
		define("example.client", (require, exports) => {
			exports.exec = require("./native");
		});
		expect(require("example.client").exec).toBe(window.cordova.exec);
		expect(require("example.client")).toBe(require("example.client"));
		expect(loads).toBe(1);
		expect(() => require("missing")).toThrow("not found");
		expect(() => define("cordova/exec", () => {})).toThrow("already defined");
		const base64 = require("cordova/base64");
		expect(base64.fromArrayBuffer(base64.toArrayBuffer("AP8="))).toBe("AP8=");
	});

	test("translates old CoreAndroid actions without changing the internal bridge", async () => {
		const { window, pending } = await createBridge();
		window.cordova.exec(null, null, "CoreAndroid", "overrideBackbutton", [
			true,
		]);
		expect([
			pending.at(-1).service,
			pending.at(-1).action,
			JSON.parse(pending.at(-1).args),
		]).toEqual(["App", "overrideButton", ["backbutton", true]]);
		window.cordova.exec(null, null, "CoreAndroid", "overrideButton", [
			"volumeup",
			true,
		]);
		expect(JSON.parse(pending.at(-1).args)).toEqual(["volumeupbutton", true]);
		window.cordova.exec(null, null, "CoreAndroid", "clearHistory", []);
		expect([pending.at(-1).service, pending.at(-1).action]).toEqual([
			"App",
			"clearHistory",
		]);
		window.cordova.exec(null, null, "CordovaHttpPlugin", "abort", [123]);
		expect([
			pending.at(-1).service,
			pending.at(-1).action,
			JSON.parse(pending.at(-1).args),
		]).toEqual(["NativeHttpPlugin", "abort", [123]]);
		window.cordova.exec(null, null, "Device", "getDeviceInfo", null);
		expect(JSON.parse(pending.at(-1).args)).toEqual([]);
		window.Bridge.exec(null, null, "CoreAndroid", "overrideBackbutton", [true]);
		expect([pending.at(-1).service, pending.at(-1).action]).toEqual([
			"CoreAndroid",
			"overrideBackbutton",
		]);
	});

	test("keeps navigator app navigation and cancellation available to legacy plugins", async () => {
		const { window, pending } = await createBridge();
		const jobs = new Map();
		let nextId = 0;
		window.setTimeout = (callback, delay) => {
			jobs.set(++nextId, { callback, delay });
			return nextId;
		};
		window.clearTimeout = (id) => jobs.delete(id);
		window.navigator.app.loadUrl("https://example.com", { wait: 2000 });
		expect(jobs.get(nextId).delay).toBe(2000);
		window.cordova.exec(null, null, "CoreAndroid", "cancelLoadUrl");
		expect(jobs.size).toBe(0);
		window.cordova.exec(null, null, "CoreAndroid", "loadUrl", [
			"https://example.com",
			{ openExternal: true, clearHistory: true },
		]);
		jobs.get(nextId).callback();
		expect(
			pending
				.slice(-2)
				.map((request) => [
					request.service,
					request.action,
					JSON.parse(request.args),
				]),
		).toEqual([
			["App", "clearHistory", []],
			["System", "open-in-browser", ["https://example.com"]],
		]);
		window.navigator.app.loadUrl("https://localhost/plugin.html", null);
		jobs.get(nextId).callback();
		expect(window.location.href).toBe("https://localhost/plugin.html");
	});
});

function respond(window, request, data, status = 1) {
	window.Android.callback({ id: request.id, status, keep: false, data });
}

function bytes(value) {
	return { kind: "arrayBuffer", data: Buffer.from(value).toString("base64") };
}

async function createBridge(
	variant = "paid",
	fdroid = false,
	platform = "android",
	missingFromEntries = false,
) {
	const window = new Window({ url: "https://localhost/index.html" });
	// Chromium exposes these FileSystem constants as read-only Window properties.
	Object.defineProperty(window, "TEMPORARY", { value: 0, writable: false });
	Object.defineProperty(window, "PERSISTENT", { value: 1, writable: false });
	windows.push(window);
	const pending = [];
	window.browserFileReader = window.FileReader;
	window.earlyReadyCount = 0;
	window.document.addEventListener(
		"deviceready",
		() => window.earlyReadyCount++,
	);
	if (platform === "android")
		window.Android = {
			exec(service, action, args, id) {
				pending.push({ service, action, args, id });
				return true;
			},
		};
	else
		window.webkit = {
			messageHandlers: {
				exec: {
					postMessage(request) {
						pending.push(request);
					},
				},
			},
		};
	if (missingFromEntries) window.eval("Object.fromEntries = undefined");
	window.eval(bundles.get(`${variant}-${fdroid}.js`));
	await window.nativeReady;
	return { window, pending };
}
