import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup(files) {
	const manager = { files, activeFile: files[0], getFile: id => files.find(file => file.id === id) };
	const toast = vi.fn(), error = vi.fn();
	const dependencies = Object.fromEntries([
		"fileSystem", "@codemirror/commands", "cm/editorReadOnly", "components/sidebar", "dialogs/prompt", "handlers/quickTools", "lib/recents", "utils/color/regex", "utils/Url", "./checkFiles", "./config", "./editorFile", "./lazyImports", "./openFile", "./openFolder", "./run", "./saveState", "./settings", "./showFileInfo",
	].map(id => [id, {}]));
	const module = loadSourceModule("src/lib/commands.js", {
		...dependencies, "dialogs/confirm": async () => true, "dialogs/select": async () => "save", "utils/helpers": { error },
	}, { editorManager: manager, strings: {}, toast });
	return { ...module, manager, toast, error };
}
function tab(id, type = "docs") {
	const file = { id, type, canSave: type === "docs", isUnsaved: true, remove: vi.fn(async () => true) };
	file.save = vi.fn(async () => { file.isUnsaved = false; return type === "editor" ? [undefined, undefined] : true; });
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
