import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

it("indexes iOS file workspaces and keeps unsupported providers on the fallback", async () => {
	const { index, sdcard } = setup(true);
	expect(index.supports("file:///Documents/project/")).toBe(true);
	expect(index.supports("ftp://host/project/")).toBe(false);
	expect(index.supports("content://provider/project/")).toBe(false);
	await index.markDirty(["file:///Documents/project/a.js"]);
	await index.clear(["file:///Documents/project/"]);
	expect(sdcard.workspaceScan).not.toHaveBeenCalled();
	expect(sdcard.workspaceMarkDirty).toHaveBeenCalled();
	expect(sdcard.workspaceClear).toHaveBeenCalled();
});

it("preserves Android native indexing and remote-provider fallback", async () => {
	const { index, sdcard } = setup(false);
	expect(index.supports("file:///project/")).toBe(true);
	expect(index.supports("content://provider/project/")).toBe(true);
	expect(index.supports("sftp://remote/project/")).toBe(false);
	await index.markDirty(["file:///project/a.js"]);
	expect(sdcard.workspaceMarkDirty).toHaveBeenCalledWith(
		["file:///project/a.js"],
		expect.any(Function),
		expect.any(Function),
	);
});

function setup(isIOS) {
	const sdcard = {
		workspaceScan: vi.fn(),
		workspaceMarkDirty: vi.fn((urls, resolve) => resolve()),
		workspaceClear: vi.fn((roots, resolve) => resolve()),
	};
	const { default: index } = loadSourceModule(
		"src/lib/fileIndex.js",
		{
			"./settings": { value: {} },
			"./platform": { isIOS },
		},
		{ sdcard },
	);
	return { index, sdcard };
}
