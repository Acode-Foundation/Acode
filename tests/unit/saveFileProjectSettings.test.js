import { Text } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

// The workspace module scans a fake `.acode` folder; saveFile itself is the real source.
const fakeFs = vi.hoisted(() => {
	const files = new Map();
	const dirs = new Set();
	return {
		files,
		dirs,
		fsOperation: (url) => ({
			async stat() {
				if (dirs.has(url)) return { isDirectory: true, isFile: false, size: 0 };
				if (files.has(url)) {
					return {
						isDirectory: false,
						isFile: true,
						size: files.get(url).length,
					};
				}
				throw new Error("ENOENT");
			},
			async readFile() {
				return files.get(url);
			},
		}),
	};
});
vi.mock("fileSystem", () => ({ default: fakeFs.fsOperation }));

import workspace from "lib/workspace";

const PROJECT = "file:///sdcard/projects/app";
const OUTSIDE = "file:///sdcard/notes";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createManager() {
	const handlers = new Map();
	return {
		TIMEOUT_VALUE: 0,
		activeFile: null,
		getFile: () => null,
		emit: vi.fn(),
		onupdate: vi.fn(),
		on(event, fn) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(fn);
		},
		off(event, fn) {
			handlers.get(event)?.delete(fn);
		},
		fire(event, ...args) {
			for (const fn of [...(handlers.get(event) ?? [])]) fn(...args);
		},
	};
}

function setup(globalSettings) {
	const manager = createManager();
	const exec = vi.fn();
	const userSettings = { ...globalSettings };

	const { default: saveFile } = loadSourceModule(
		"src/lib/saveFile.js",
		{
			fileSystem: {
				__esModule: true,
				default: () => ({
					readFile: async () => "content",
					writeFile: vi.fn(async () => true),
					stat: async () => ({}),
				}),
				hasProvider: () => true,
			},
			"@codemirror/state": { Text },
			"cm/editorUtils": { getDocText: (doc) => doc.toString() },
			"components/toast": vi.fn(),
			"dialogs/confirm": vi.fn(),
			"dialogs/prompt": vi.fn(),
			"dialogs/select": {},
			"lib/recents": { select: vi.fn(), addFolder: vi.fn(), addFile: vi.fn() },
			"pages/fileBrowser": {},
			"utils/helpers": {
				getStatMtime: () => null,
				error: vi.fn(),
				fixFilename: (name) => name,
			},
			"utils/Url": { join: (...parts) => parts.join("/") },
			"./config": {},
			"./editorFile": {},
			"./openFolder": {},
			"./settings": { value: userSettings },
			// The real workspace module, not a stub.
			"./workspace": { __esModule: true, default: workspace },
		},
		{ editorManager: manager, strings: {}, acode: { exec } },
	);

	const createFile = (uri) => {
		const file = {
			uri,
			filename: "index.js",
			encoding: "utf8",
			loaded: true,
			loading: false,
			readOnly: false,
			markChanged: true,
			tab: { querySelector: () => ({ textContent: "" }) },
			session: { doc: Text.of(["content"]) },
			markSaved: vi.fn(),
		};
		manager.activeFile = file;
		return file;
	};

	return { manager, exec, userSettings, createFile, saveFile };
}

describe("format on save per project", () => {
	let ctx;
	let stop;

	const openProject = async (settingsText) => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		if (settingsText !== undefined) {
			fakeFs.files.set(`${PROJECT}/.acode/settings.json`, settingsText);
		}
		ctx.manager.fire("add-folder", { url: PROJECT, name: "app" });
		await flush();
	};

	beforeEach(() => {
		fakeFs.files.clear();
		fakeFs.dirs.clear();
	});

	afterEach(() => stop?.());

	const start = (globalSettings) => {
		ctx = setup(globalSettings);
		stop = workspace.init(ctx.manager);
	};

	it("formats files in a project that turns it on, though the user has it off", async () => {
		start({ formatOnSave: false });
		await openProject('{"formatOnSave": true}');

		const file = ctx.createFile(`${PROJECT}/src/index.js`);
		expect(await ctx.saveFile(file)).toBe(true);

		expect(ctx.exec).toHaveBeenCalledTimes(1);
		expect(ctx.exec).toHaveBeenCalledWith("format", false);
		expect(file.markChanged).toBe(true);
	});

	it("does not format files in a project that turns it off, though the user has it on", async () => {
		start({ formatOnSave: true });
		await openProject('{"formatOnSave": false}');

		await ctx.saveFile(ctx.createFile(`${PROJECT}/src/index.js`));

		expect(ctx.exec).not.toHaveBeenCalled();
	});

	it("leaves files outside the project to the user's own setting", async () => {
		start({ formatOnSave: false });
		await openProject('{"formatOnSave": true}');

		await ctx.saveFile(ctx.createFile(`${OUTSIDE}/todo.js`));
		expect(ctx.exec).not.toHaveBeenCalled();

		ctx.userSettings.formatOnSave = true;
		await ctx.saveFile(ctx.createFile(`${OUTSIDE}/todo.js`));
		expect(ctx.exec).toHaveBeenCalledTimes(1);
	});

	it("uses the user's setting when the project does not mention it", async () => {
		start({ formatOnSave: true });
		await openProject('{"tabSize": 4}');

		await ctx.saveFile(ctx.createFile(`${PROJECT}/src/index.js`));

		expect(ctx.exec).toHaveBeenCalledTimes(1);
	});

	it("uses the user's setting when the project's value is invalid", async () => {
		start({ formatOnSave: false });
		await openProject('{"formatOnSave": "yes"}');

		await ctx.saveFile(ctx.createFile(`${PROJECT}/src/index.js`));

		expect(ctx.exec).not.toHaveBeenCalled();
	});

	it("only formats the file being shown, even in a project that turns it on", async () => {
		start({ formatOnSave: false });
		await openProject('{"formatOnSave": true}');

		const background = ctx.createFile(`${PROJECT}/src/other.js`);
		ctx.createFile(`${PROJECT}/src/index.js`); // now the active file

		await ctx.saveFile(background);

		expect(ctx.exec).not.toHaveBeenCalled();
	});

	it("never changes the user's own settings", async () => {
		start({ formatOnSave: false, tabSize: 2 });
		await openProject('{"formatOnSave": true, "tabSize": 8}');

		await ctx.saveFile(ctx.createFile(`${PROJECT}/src/index.js`));

		expect(ctx.userSettings).toEqual({ formatOnSave: false, tabSize: 2 });
	});

	it("follows an edit to settings.json without reopening the project", async () => {
		start({ formatOnSave: false });
		await openProject('{"formatOnSave": false}');
		await ctx.saveFile(ctx.createFile(`${PROJECT}/src/index.js`));
		expect(ctx.exec).not.toHaveBeenCalled();

		fakeFs.files.set(
			`${PROJECT}/.acode/settings.json`,
			'{"formatOnSave": true}',
		);
		ctx.manager.fire("save-file", { uri: `${PROJECT}/.acode/settings.json` });
		await flush();
		await ctx.saveFile(ctx.createFile(`${PROJECT}/src/index.js`));

		expect(ctx.exec).toHaveBeenCalledTimes(1);
	});
});
