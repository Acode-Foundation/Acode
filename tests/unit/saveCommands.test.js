import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup(files) {
	const manager = {
		files,
		activeFile: files[0],
		getFile: (id) => files.find((file) => file.id === id),
	};
	const toast = vi.fn(),
		error = vi.fn();
	const progress = { setMessage: vi.fn(), destroy: vi.fn() };
	const dependencies = Object.fromEntries(
		[
			"fileSystem",
			"@codemirror/commands",
			"cm/editorReadOnly",
			"components/sidebar",
			"dialogs/prompt",
			"handlers/quickTools",
			"lib/recents",
			"utils/color/regex",
			"utils/Url",
			"./checkFiles",
			"./config",
			"./editorFile",
			"./lazyImports",
			"./openFile",
			"./openFolder",
			"./run",
			"./settings",
			"./showFileInfo",
		].map((id) => [id, {}]),
	);
	const module = loadSourceModule(
		"src/lib/commands.js",
		{
			...dependencies,
			"dialogs/confirm": async () => true,
			"dialogs/select": async () => "save",
			"dialogs/loader": { create: () => progress },
			"./saveState": { deferSaveState: (task) => task() },
			"utils/helpers": { error },
		},
		{ editorManager: manager, strings: {}, toast },
	);
	return { ...module, manager, toast, error, progress };
}
function tab(id, type = "docs") {
	const file = {
		id,
		type,
		canSave: type === "docs" || type === "editor",
		isUnsaved: true,
		remove: vi.fn(async () => true),
	};
	file.save = vi.fn(async () => {
		file.isUnsaved = false;
		return true;
	});
	file.saveAs = vi.fn(async () => true);
	file.hasUnsavedChanges = () => file.isUnsaved;
	return file;
}
it("routes standard Save and Save As to the captured tab and leaves terminals ineligible", async () => {
	const one = tab("one"),
		two = tab("two"),
		code = tab("code", "editor"),
		terminal = tab("terminal", "terminal");
	const f = setup([one, two, code, terminal]);
	for (const file of [one, two, code]) {
		f.manager.activeFile = file;
		expect(f.canSaveFile(file)).toBe(true);
		await f.default.save();
		await f.default["save-as"]();
		expect(file.save).toHaveBeenCalledOnce();
		expect(file.saveAs).toHaveBeenCalledOnce();
	}
	f.manager.activeFile = terminal;
	await f.default.save();
	await f.default["save-as"]();
	expect(terminal.save).not.toHaveBeenCalled();
});
it("does not report custom-tab success on cancellation or failure", async () => {
	const file = tab("one"),
		f = setup([file]);
	file.save.mockResolvedValueOnce(false).mockRejectedValueOnce(Error("full"));
	await f.default.save(true);
	await f.default.save(true);
	expect(f.toast).not.toHaveBeenCalled();
	expect(f.error).toHaveBeenCalledOnce();
	await f.default.save(true);
	expect(f.toast).toHaveBeenCalledOnce();
});
it("does not save pending editors or report a cancelled editor save as successful", async () => {
	const file = tab("pending", "editor"),
		f = setup([file]);
	file.canSave = false;
	await f.default.save(true);
	await f.default["save-as"](true);
	expect(file.save).not.toHaveBeenCalled();
	expect(file.saveAs).not.toHaveBeenCalled();
	file.canSave = true;
	file.save.mockResolvedValue(false);
	file.saveAs.mockResolvedValue(false);
	await f.default.save(true);
	await f.default["save-as"](true);
	expect(f.toast).not.toHaveBeenCalled();
});
it("saves sequentially without clearing flags and keeps going past cancellation or newer edits", async () => {
	const one = tab("one"),
		two = tab("two"),
		code = tab("code", "editor");
	const f = setup([one, two, code]);
	let release;
	one.save.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = () => {
					one.isUnsaved = false;
					resolve(true);
				};
			}),
	);
	const saving = f.default["save-all-changes"]();
	await vi.waitFor(() => expect(one.save).toHaveBeenCalledOnce());
	expect(one.isUnsaved).toBe(true);
	expect(two.save).not.toHaveBeenCalled();
	two.save.mockResolvedValueOnce(false);
	release();
	expect(await saving).toBe(false);
	expect(two.isUnsaved).toBe(true);
	expect(code.save).toHaveBeenCalledOnce();
	expect(code.isUnsaved).toBe(false);
	two.save.mockResolvedValueOnce(true); // A newer edit remains dirty after the write.
	expect(await f.default["save-all-changes"]()).toBe(false);
	expect(two.isUnsaved).toBe(true);
	expect(await f.default["save-all-changes"]()).toBe(true);
	expect(two.isUnsaved).toBe(false);
});

it("saves files with a location concurrently behind a progress dialog", async () => {
	const files = ["a", "b", "c", "d", "e", "f"].map((id) => {
		const file = tab(id, "editor");
		file.uri = `file:///${id}`;
		return file;
	});
	const releases = [];
	for (const file of files) {
		file.save.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releases.push(() => {
						file.isUnsaved = false;
						resolve(true);
					});
				}),
		);
	}
	const f = setup(files);
	const saving = f.default["save-all-changes"]();
	await vi.waitFor(() => expect(releases).toHaveLength(4));
	expect(files[4].save).not.toHaveBeenCalled();
	while (releases.length) {
		releases.shift()();
		await Promise.resolve();
		await Promise.resolve();
	}
	await vi.waitFor(() => expect(files[5].save).toHaveBeenCalled());
	while (releases.length) releases.shift()();
	expect(await saving).toBe(true);
	expect(f.progress.setMessage).toHaveBeenCalledTimes(files.length);
	expect(f.progress.destroy).toHaveBeenCalledOnce();
});
it.each([
	false,
	true,
	"failure",
])("save-and-close keeps edits after an unsuccessful save (%s)", async (outcome) => {
	const file = tab("one"),
		f = setup([file]);
	if (outcome === "failure")
		file.save.mockRejectedValueOnce(Error("disk full"));
	else file.save.mockResolvedValueOnce(outcome);
	expect(await f.default["close-all-tabs"]()).toBe(false);
	expect(f.error).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
	expect(file.remove).not.toHaveBeenCalled();
	expect(file.isUnsaved).toBe(true);
});

it.each([
	"terminal",
	"editor",
])("skips an unsavable dirty %s while saving eligible tabs", async (type) => {
	for (const command of ["save-all-changes", "close-all-tabs"]) {
		const unsupported = tab("unsupported", type),
			one = tab("one"),
			two = tab("two", "editor");
		unsupported.canSave = false;
		const files = [unsupported, one, two];
		const f = setup(files);
		expect(await f.default[command]()).toBe(false);
		expect(unsupported.save).not.toHaveBeenCalled();
		expect(unsupported.remove).not.toHaveBeenCalled();
		expect(unsupported.isUnsaved).toBe(true);
		for (const file of [one, two]) {
			expect(file.save).toHaveBeenCalledOnce();
			expect(file.isUnsaved).toBe(false);
			expect(file.remove).toHaveBeenCalledTimes(
				command === "close-all-tabs" ? 1 : 0,
			);
		}
	}
});

it.each([
	false,
	true,
	"failure",
])("keeps a failed file open and still saves the rest (%s)", async (outcome) => {
	for (const command of ["save-all-changes", "close-all-tabs"]) {
		const unsupported = tab("unsupported", "terminal"),
			failed = tab("failed"),
			later = tab("later", "editor");
		const f = setup([unsupported, failed, later]);
		if (outcome === "failure")
			failed.save.mockRejectedValueOnce(Error("disk full"));
		else failed.save.mockResolvedValueOnce(outcome);
		expect(await f.default[command]()).toBe(false);
		expect(f.error).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
		expect(failed.remove).not.toHaveBeenCalled();
		expect(failed.isUnsaved).toBe(true);
		expect(later.save).toHaveBeenCalledOnce();
		expect(later.isUnsaved).toBe(false);
		expect(later.remove).toHaveBeenCalledTimes(
			command === "close-all-tabs" ? 1 : 0,
		);
	}
});

it("keeps pinned tabs untouched by save-and-close and reports complete success for eligible tabs", async () => {
	const pinned = tab("pinned"),
		file = tab("file");
	pinned.pinned = true;
	const f = setup([pinned, file]);
	expect(await f.default["close-all-tabs"]()).toBe(true);
	expect(pinned.save).not.toHaveBeenCalled();
	expect(pinned.remove).not.toHaveBeenCalled();
	expect(file.remove).toHaveBeenCalledOnce();
});
