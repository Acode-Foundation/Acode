// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import tag from "html-tag-js";
import { loadSourceModule } from "../helpers/loadSourceModule";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup() {
	const write = vi.fn(async () => true);
	const manager = { files: [], getFile: () => null, addFile: file => manager.files.push(file), emit: vi.fn(), onupdate: vi.fn(), activeFile: null };
	const defaults = Object.fromEntries([
		"fileSystem", "components/quickTools", "components/sidebar", "components/toast", "dialogs/confirm", "handlers/editorFileTab", "handlers/quickTools", "lib/quickToolsAdapter", "handlers/tabContextMenu", "dompurify", "mime-types", "utils/codeHighlight", "utils/Path", "utils/remoteFilePreview", "utils/Url", "./loadPlugins", "./openFolder", "./run", "cm/editorReadOnly",
	].map(id => [id, {}]));
	const { default: EditorFile } = loadSourceModule("src/lib/editorFile.js", {
		...defaults,
		"components/sidebar": { hide: vi.fn() },
		"@codemirror/state": { EditorState, EditorSelection },
		"cm/editorUtils": { getDocText: doc => doc.toString() },
		"cm/modelist": { getModeForPath: () => "text", getMode: () => ({ name: "text", extensions: [], getExtension: () => [] }) },
		"html-tag-js": tag,
		"components/tile": options => {
			const element = document.createElement("li");
			element.innerHTML = '<span class="text"></span>';
			element.tail = vi.fn();
			element.text = options.text;
			return element;
		},
		"utils/helpers": { normalizeMtime: () => null, getIconForFile: () => "file" },
		"./config": { DEFAULT_FILE_SESSION: "default" },
		"./settings": { value: {}, on: vi.fn(), off: vi.fn() },
		"./saveFile": write,
	}, { document, window, tag, editorManager: manager });
	EditorFile.prototype.setMode = vi.fn(); // Language setup is unrelated to save routing.
	const file = (type = "docs") => new EditorFile("test.txt", {
		id: String(manager.files.length), type, content: document.createElement("div"), render: false, text: "original",
	});
	return { file, write, manager };
}
afterEach(() => document.body.replaceChildren());

it("enables only custom tabs with listeners or onsave, and never uses the text writer", async () => {
	const f = setup(), doc = f.file(), terminal = f.file("terminal");
	expect(doc.canSave).toBe(false);
	expect(await doc.save()).toBe(false);
	expect(await terminal.saveAs()).toBe(false);
	const handler = e => e.respondWith(Promise.resolve(true));
	doc.on("save", handler);
	expect(doc.canSave).toBe(true);
	expect(await doc.save()).toBe(true);
	doc.off("save", handler);
	expect(doc.canSave).toBe(false);
	doc.onsave = handler;
	expect(await doc.saveAs()).toBe(true);
	doc.onsave = undefined;
	expect(doc.canSave).toBe(false);
	expect(f.write).not.toHaveBeenCalled();
});
it("awaits one response, distinguishes Save As and shares repeated requests per tab", async () => {
	const f = setup(), one = f.file(), two = f.file(), hold = deferred();
	const events = [], handler = vi.fn(e => { events.push(e); e.respondWith(hold.promise); });
	one.on("save", handler);
	two.on("save", e => e.respondWith(Promise.resolve(false)));
	const saving = one.saveAs();
	expect(one.save()).toBe(saving);
	await Promise.resolve();
	expect(handler).toHaveBeenCalledOnce();
	expect(events[0].saveAs).toBe(true);
	expect(events[0].target).toBe(one);
	expect(await two.save()).toBe(false);
	hold.resolve(true);
	expect(await saving).toBe(true);
	await one.save();
	expect(events[1].saveAs).toBe(false);
});
it("rejects failures, duplicate and late responses, and releases pending requests", async () => {
	const f = setup(), file = f.file();
	let event;
	const fail = e => { event = e; e.respondWith(Promise.reject(Error("disk full"))); };
	file.on("save", fail);
	await expect(file.save()).rejects.toThrow("disk full");
	expect(() => event.respondWith(Promise.resolve(true))).toThrow(/once/);
	file.off("save", fail);
	const duplicate = e => { e.respondWith(Promise.resolve(true)); e.respondWith(Promise.resolve(true)); };
	file.on("save", duplicate);
	await expect(file.save()).rejects.toThrow(/once/);
	file.off("save", duplicate);
	file.on("save", e => { event = e; });
	expect(await file.save()).toBe(false);
	expect(() => event.respondWith(Promise.resolve(true))).toThrow(/during/);
});
it("preserves text fallback and existing cancellation/listener ordering", async () => {
	const f = setup(), file = f.file("editor");
	file.flushCacheWrite = vi.fn(async () => {});
	expect(file.canSave).toBe(true);
	await file.saveAs();
	expect(f.write).toHaveBeenCalledWith(file, true);
	const cancel = e => e.preventDefault(), observe = vi.fn();
	file.onsave = cancel;
	file.on("save", observe);
	expect(await file.save()).toBe(false);
	expect(observe).toHaveBeenCalledOnce();
	expect(f.write).toHaveBeenCalledOnce();
	file.onsave = e => { e.preventDefault(); e.stopPropagation(); };
	await file.save();
	expect(observe).toHaveBeenCalledOnce();
	file.onsave = e => e.respondWith(Promise.resolve(true));
	expect(await file.save()).toBe(true);
	expect(f.write).toHaveBeenCalledOnce();
});

	it("drops completion notifications after closing the captured custom tab", async () => {
	const f = setup(), file = f.file(), hold = deferred();
	f.file();
	file.on("save", e => e.respondWith(hold.promise));
	const saving = file.save();
	await Promise.resolve();
	await file.remove(true);
	expect(file.canSave).toBe(false);
	hold.resolve(true);
	expect(await saving).toBe(false);
	expect(f.manager.emit.mock.calls.some(([name]) => name === "save-file")).toBe(false);
});
