import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup(files) {
	const manager = { files, activeFile: files[0], getFile: id => files.find(file => file.id === id) };
	const toast = vi.fn(), error = vi.fn();
	const dependencies = Object.fromEntries([
		"fileSystem", "@codemirror/commands", "cm/editorReadOnly", "components/sidebar", "dialogs/prompt", "handlers/quickTools", "lib/recents", "utils/color/regex", "utils/Url", "./checkFiles", "./config", "./editorFile", "./lazyImports", "./openFile", "./openFolder", "./runLazily", "./saveState", "./settings", "./showFileInfo",
	].map(id => [id, {}]));
	const module = loadSourceModule("src/lib/commands.js", {
		...dependencies, "dialogs/confirm": async () => true, "dialogs/select": async () => "save", "utils/helpers": { error },
	}, { editorManager: manager, strings: {}, toast });
	return { ...module, manager, toast, error };
}
function tab(id, type = "docs") {
	const file = { id, type, canSave: type === "docs" || type === "editor", isUnsaved: true, remove: vi.fn(async () => true) };
	file.save = vi.fn(async () => { file.isUnsaved = false; return true; });
	file.saveAs = vi.fn(async () => true);
	file.hasUnsavedChanges = () => file.isUnsaved;
	return file;
}
it("routes standard Save and Save As to the captured tab and leaves terminals ineligible", async () => {
	const one = tab("one"), two = tab("two"), code = tab("code", "editor"), terminal = tab("terminal", "terminal");
	const f = setup([one, two, code, terminal]);
	for (const file of [one, two, code]) {
		f.manager.activeFile = file;
		expect(f.canSaveFile(file)).toBe(true);
		await f.default.save(); await f.default["save-as"]();
		expect(file.save).toHaveBeenCalledOnce(); expect(file.saveAs).toHaveBeenCalledOnce();
	}
	f.manager.activeFile = terminal;
	await f.default.save(); await f.default["save-as"]();
	expect(terminal.save).not.toHaveBeenCalled();
});
it("does not report custom-tab success on cancellation or failure", async () => {
	const file = tab("one"), f = setup([file]);
	file.save.mockResolvedValueOnce(false).mockRejectedValueOnce(Error("full"));
	await f.default.save(true); await f.default.save(true);
	expect(f.toast).not.toHaveBeenCalled(); expect(f.error).toHaveBeenCalledOnce();
	await f.default.save(true); expect(f.toast).toHaveBeenCalledOnce();
});
it("does not save pending editors or report a cancelled editor save as successful", async () => {
	const file = tab("pending", "editor"), f = setup([file]);
	file.canSave = false;
	await f.default.save(true); await f.default["save-as"](true);
	expect(file.save).not.toHaveBeenCalled(); expect(file.saveAs).not.toHaveBeenCalled();
	file.canSave = true;
	file.save.mockResolvedValue(false); file.saveAs.mockResolvedValue(false);
	await f.default.save(true); await f.default["save-as"](true);
	expect(f.toast).not.toHaveBeenCalled();
});
it("saves sequentially without clearing flags and stops at cancellation or newer edits", async () => {
	const one = tab("one"), two = tab("two"), code = tab("code", "editor");
	const f = setup([one, two, code]);
	let release;
	one.save.mockImplementationOnce(() => new Promise(resolve => { release = () => { one.isUnsaved = false; resolve(true); }; }));
	const saving = f.default["save-all-changes"]();
	await vi.waitFor(() => expect(one.save).toHaveBeenCalledOnce());
	expect(one.isUnsaved).toBe(true); expect(two.save).not.toHaveBeenCalled();
	two.save.mockResolvedValueOnce(false);
	release(); expect(await saving).toBe(false);
	expect(two.isUnsaved).toBe(true); expect(code.save).not.toHaveBeenCalled();
	two.save.mockResolvedValueOnce(true); // A newer edit remains dirty after the write.
	expect(await f.default["save-all-changes"]()).toBe(false);
	expect(code.save).not.toHaveBeenCalled();
	expect(await f.default["save-all-changes"]()).toBe(true);
	expect(code.isUnsaved).toBe(false);
});
it.each([false, true, "failure"])("save-and-close keeps edits after an unsuccessful save (%s)", async outcome => {
	const file = tab("one"), f = setup([file]);
	if (outcome === "failure") file.save.mockRejectedValueOnce(Error("disk full"));
	else file.save.mockResolvedValueOnce(outcome);
	const result = f.default["close-all-tabs"]();
	if (outcome === "failure") await expect(result).rejects.toThrow("disk full");
	else await result;
	expect(file.remove).not.toHaveBeenCalled();
	expect(file.isUnsaved).toBe(true);
});

it.each(["terminal", "editor"])("skips an unsavable dirty %s while saving eligible tabs", async type => {
	for (const command of ["save-all-changes", "close-all-tabs"]) {
		const unsupported = tab("unsupported", type), one = tab("one"), two = tab("two", "editor");
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
			expect(file.remove).toHaveBeenCalledTimes(command === "close-all-tabs" ? 1 : 0);
		}
	}
});

it.each([false, true, "failure"])("still stops after a savable write fails or remains dirty (%s)", async outcome => {
	for (const command of ["save-all-changes", "close-all-tabs"]) {
		const unsupported = tab("unsupported", "terminal"), failed = tab("failed"), later = tab("later", "editor");
		const f = setup([unsupported, failed, later]);
		if (outcome === "failure") failed.save.mockRejectedValueOnce(Error("disk full"));
		else failed.save.mockResolvedValueOnce(outcome);
		const saving = f.default[command]();
		if (outcome === "failure") await expect(saving).rejects.toThrow("disk full");
		else expect(await saving).toBe(false);
		expect(failed.remove).not.toHaveBeenCalled();
		expect(later.save).not.toHaveBeenCalled();
		expect(later.remove).not.toHaveBeenCalled();
	}
});

it("keeps pinned tabs untouched by save-and-close and reports complete success for eligible tabs", async () => {
	const pinned = tab("pinned"), file = tab("file");
	pinned.pinned = true;
	const f = setup([pinned, file]);
	expect(await f.default["close-all-tabs"]()).toBe(true);
	expect(pinned.save).not.toHaveBeenCalled();
	expect(pinned.remove).not.toHaveBeenCalled();
	expect(file.remove).toHaveBeenCalledOnce();
});
