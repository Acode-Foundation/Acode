import { describe, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

describe("local file writes", () => {
	it("saves an individually granted file without requesting its parent folder", async () => {
		const fixture = setup(false);
		const bytes = new Uint8Array([0, 127, 128, 255]).buffer;
		await expect(fixture.fs.writeFile(fixture.url, bytes)).resolves.toBe(
			fixture.url,
		);
		expect(fixture.written).toEqual([bytes]);
		expect(fixture.resolve.mock.calls.map(([url]) => url)).toEqual([
			fixture.url,
		]);
	});

	it("retains exclusive creation and explicit replacement flags", async () => {
		const fixture = setup(true);
		await expect(fixture.fs.writeFile(fixture.url, "new", true)).resolves.toBe(
			fixture.url,
		);
		await expect(
			fixture.fs.writeFile(fixture.url, "replace", true, false),
		).resolves.toBe(fixture.url);
		expect(
			fixture.getFile.mock.calls.map(([name, flags]) => [name, flags]),
		).toEqual([
			["test # 日本語.txt", { create: true, exclusive: true }],
			["test # 日本語.txt", { create: true, exclusive: false }],
		]);
		expect(fixture.written).toEqual(["new", "replace"]);
		fixture.getFile.mockImplementation((name, flags, success, failure) =>
			failure({ code: 12 }),
		);
		await expect(
			fixture.fs.writeFile(fixture.url, "collision", true),
		).rejects.toMatchObject({ code: 12 });
		expect(fixture.written).toEqual(["new", "replace"]);
	});

	it("does not create a missing file during an ordinary save", async () => {
		const fixture = setup(true);
		fixture.resolve.mockImplementation((url, success, failure) =>
			failure({ code: 1 }),
		);
		await expect(
			fixture.fs.writeFile(fixture.url, "missing"),
		).rejects.toMatchObject({ code: 1 });
		expect(fixture.written).toEqual([]);
	});

	it("retains the type-mismatch error when the path is a directory", async () => {
		const fixture = setup(true);
		fixture.resolve.mockImplementation((url, success) =>
			success({ isDirectory: true }),
		);
		await expect(
			fixture.fs.writeFile(fixture.url, "directory"),
		).rejects.toMatchObject({ code: 11 });
		expect(fixture.written).toEqual([]);
	});

	it("reports writer creation errors instead of leaving the save pending", async () => {
		const fixture = setup(true);
		fixture.file.createWriter.mockImplementation((success, failure) =>
			failure({ code: 2 }),
		);
		await expect(
			fixture.fs.writeFile(fixture.url, "denied"),
		).rejects.toMatchObject({ code: 2 });
		expect(fixture.written).toEqual([]);
	});

	it("does not report success when a failed write also emits writeend", async () => {
		const fixture = setup(true);
		fixture.file.createWriter.mockImplementation((success) => {
			const writer = {
				write() {
					writer.onerror({ target: { error: { code: 10 } } });
					writer.onwriteend();
				},
			};
			success(writer);
		});
		await expect(
			fixture.fs.writeFile(fixture.url, "full"),
		).rejects.toMatchObject({ code: 10 });
	});
});

function setup(folderAllowed) {
	const parent = "file:///provider";
	const url = `${parent}/test # 日本語.txt`;
	const written = [];
	const file = {
		createWriter: vi.fn((success) => {
			const writer = {
				write(data) {
					written.push(data);
					writer.onwriteend();
				},
			};
			success(writer);
		}),
	};
	const getFile = vi.fn((name, flags, success) => success(file));
	const resolve = vi.fn((path, success, failure) => {
		if (path === url) success(file);
		else if (path === parent && folderAllowed) success({ getFile });
		else failure({ code: 2 });
	});
	const { default: fs } = loadSourceModule(
		"src/fileSystem/internalFs.js",
		{
			fileSystem: {},
			"lib/ajax": {},
			"utils/encodings": {},
			"utils/helpers": {},
			"utils/Url": { dirname: (path) => path.slice(0, path.lastIndexOf("/")) },
		},
		{ window: { resolveLocalFileSystemURL: resolve } },
	);
	return { fs, url, file, getFile, resolve, written };
}
