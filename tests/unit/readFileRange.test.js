import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	decode: vi.fn(async (data) => new TextDecoder().decode(data)),
}));

vi.mock("lib/ajax", () => ({ default: vi.fn() }));
vi.mock("dialogs/loader", () => ({ default: { destroy: vi.fn() } }));
vi.mock("utils/encodings", () => ({
	decode: mocks.decode,
	encode: vi.fn(),
	getEncodingName: vi.fn((encoding) => encoding),
}));
vi.mock("utils/helpers", () => ({
	default: {
		defineDeprecatedProperty: vi.fn(),
		parseJSON: JSON.parse,
		uuid: vi.fn(() => "uuid"),
	},
}));
vi.mock("fileSystem/ftp", () => {
	function Ftp() {}
	Ftp.test = () => false;
	Ftp.fromUrl = vi.fn();
	return { default: Ftp };
});
vi.mock("fileSystem/sftp", () => {
	function Sftp() {}
	Sftp.test = () => false;
	Sftp.fromUrl = vi.fn();
	return { default: Sftp };
});

import externalFs from "fileSystem/externalFs";
import fsOperation from "fileSystem/index";
import internalFs from "fileSystem/internalFs";
import {
	MAX_READ_RANGE_LENGTH,
	validateReadRange,
} from "fileSystem/readRange";

describe("filesystem byte-range reads", () => {
	const originalWindow = globalThis.window;
	const originalFileReader = globalThis.FileReader;
	const originalSdcard = globalThis.sdcard;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mocks.decode.mockClear();
	});

	afterEach(() => {
		globalThis.window = originalWindow;
		globalThis.FileReader = originalFileReader;
		globalThis.sdcard = originalSdcard;
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("validates half-open ranges before a backend allocates memory", () => {
		expect(validateReadRange(4, 9)).toEqual({ start: 4, end: 9, length: 5 });
		expect(() => validateReadRange(-1, 2)).toThrow(RangeError);
		expect(() => validateReadRange(3, 2)).toThrow(RangeError);
		expect(() =>
			validateReadRange(0, MAX_READ_RANGE_LENGTH + 1),
		).toThrow(RangeError);
	});

	it("uses Blob.slice for internal files instead of calling the full reader", async () => {
		const requestedData = new TextEncoder().encode("range").buffer;
		const slice = vi.fn(() => ({ requestedData }));
		const fullRead = vi.spyOn(internalFs, "readFile");

		globalThis.window = {
			resolveLocalFileSystemURL: vi.fn((_url, resolve) => {
				resolve({
					file(callback) {
						callback({ slice });
					},
				});
			}),
		};
		globalThis.FileReader = class {
			readAsArrayBuffer(blob) {
				this.result = blob.requestedData;
				queueMicrotask(() => this.onload());
			}
		};

		const result = await internalFs
			.createFs("file:///large.txt")
			.readFileRange(1024, 1029, "utf-8");

		expect(result).toBe("range");
		expect(slice).toHaveBeenCalledOnce();
		expect(slice).toHaveBeenCalledWith(1024, 1029);
		expect(fullRead).not.toHaveBeenCalled();
	});

	it("delegates external ranges to the native bounded-read bridge", async () => {
		const requestedData = new Uint8Array([2, 3, 4]).buffer;
		globalThis.sdcard = {
			formatUri: vi.fn((_url, resolve) => resolve("content://real/file")),
			readRange: vi.fn((_url, _start, _end, resolve) =>
				resolve(requestedData),
			),
			read: vi.fn(),
		};

		const result = await externalFs
			.createFs("content://virtual/file")
			.readFileRange(10, 13);

		expect(result).toBe(requestedData);
		expect(globalThis.sdcard.readRange).toHaveBeenCalledWith(
			"content://real/file",
			10,
			13,
			expect.any(Function),
			expect.any(Function),
		);
		expect(globalThis.sdcard.read).not.toHaveBeenCalled();
	});

	it("sends an HTTP Range request and accepts only partial responses", async () => {
		const requestedData = new TextEncoder().encode("chunk").buffer;
		globalThis.fetch = vi.fn(async () => ({
			status: 206,
			headers: new Headers({
				"content-length": "5",
				"content-range": "bytes 20-24/1000",
			}),
			arrayBuffer: vi.fn(async () => requestedData),
			body: { cancel: vi.fn() },
		}));

		const result = await fsOperation("https://example.com/large.txt")
			.readFileRange(20, 25);

		expect(result).toBe(requestedData);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://example.com/large.txt",
			{ headers: { Range: "bytes=20-24" } },
		);
	});

	it("cancels an HTTP response when the server ignores the range", async () => {
		const cancel = vi.fn(async () => {});
		const arrayBuffer = vi.fn();
		globalThis.fetch = vi.fn(async () => ({
			status: 200,
			headers: new Headers(),
			arrayBuffer,
			body: { cancel },
		}));

		await expect(
			fsOperation("https://example.com/large.txt").readFileRange(20, 25),
		).rejects.toThrow("does not support byte-range reads");
		expect(cancel).toHaveBeenCalledOnce();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});
});
