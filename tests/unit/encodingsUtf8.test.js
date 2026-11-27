import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

const NATIVE_TEXT = "decoded natively";
const NATIVE_BYTES = new Uint8Array([1, 2, 3]).buffer;

async function setup({ isIOS = false } = {}) {
	const exec = vi.fn((success, error, service, action, args) => {
		if (action === "get-available-encodings") {
			success({
				"UTF-8": { name: "UTF-8", label: "UTF-8", aliases: ["utf8"] },
				"ISO-8859-1": { name: "ISO-8859-1", label: "ISO-8859-1", aliases: [] },
			});
		} else if (action === "decode") success(NATIVE_TEXT);
		else if (action === "encode") success(NATIVE_BYTES);
	});
	const storage = new Map();
	const encodings = loadSourceModule(
		"src/utils/encodings.js",
		{
			"dialogs/alert": { __esModule: true, default: vi.fn() },
			"lib/platform": { __esModule: true, default: { isIOS } },
			"lib/settings": {
				__esModule: true,
				default: { value: { defaultFileEncoding: "UTF-8" } },
			},
		},
		{
			Bridge: { exec },
			TextDecoder,
			TextEncoder,
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => storage.set(key, value),
			},
		},
	);
	await encodings.initEncodings();
	exec.mockClear();
	const nativeCalls = (action) =>
		exec.mock.calls.filter((call) => call[3] === action).length;
	return { ...encodings, nativeCalls };
}

const bytes = (...values) => new Uint8Array(values).buffer;
const utf8 = (text) => new TextEncoder().encode(text).buffer;

it("decodes valid UTF-8 without the native bridge", async () => {
	const { decode, nativeCalls } = await setup();

	expect(await decode(utf8("héllo ✓ 😀"), "utf-8")).toBe("héllo ✓ 😀");
	expect(await decode(utf8('{"a":[1]}'), "json")).toEqual({ a: [1] });
	expect(nativeCalls("decode")).toBe(0);
});

it("keeps the UTF-8 BOM on Android and strips it on iOS, like native", async () => {
	const withBom = bytes(0xef, 0xbb, 0xbf, 0x68, 0x69);

	expect(await (await setup()).decode(withBom, "UTF-8")).toBe("﻿hi");
	expect(await (await setup({ isIOS: true })).decode(withBom, "UTF-8")).toBe(
		"hi",
	);
});

it("leaves invalid UTF-8 and other charsets to the native decoder", async () => {
	const { decode, nativeCalls } = await setup();

	expect(await decode(bytes(0x68, 0xff, 0x69), "UTF-8")).toBe(NATIVE_TEXT);
	expect(await decode(utf8("abc"), "ISO-8859-1")).toBe(NATIVE_TEXT);
	expect(nativeCalls("decode")).toBe(2);
});

it("encodes UTF-8 locally into an exactly sized buffer", async () => {
	const { encode, nativeCalls } = await setup();

	const buffer = await encode("héllo ✓ 😀", "UTF-8");

	expect(buffer).toBeInstanceOf(ArrayBuffer);
	expect(new TextDecoder().decode(buffer)).toBe("héllo ✓ 😀");
	expect(buffer.byteLength).toBe(utf8("héllo ✓ 😀").byteLength);
	expect(nativeCalls("encode")).toBe(0);
});

it("leaves lone surrogates and other charsets to the native encoder", async () => {
	const { encode, nativeCalls } = await setup();

	expect(await encode("a\uD800b", "UTF-8")).toBe(NATIVE_BYTES);
	expect(await encode("a\uDC00", "UTF-8")).toBe(NATIVE_BYTES);
	expect(await encode("abc", "ISO-8859-1")).toBe(NATIVE_BYTES);
	expect(nativeCalls("encode")).toBe(3);
	// A valid surrogate pair stays local.
	await encode("😀", "UTF-8");
	expect(nativeCalls("encode")).toBe(3);
});
