import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory file system. `hold` lets a test keep a stat() pending to
// exercise the window between "folder opened" and "scan finished".
const fakeFs = vi.hoisted(() => {
	const state = {
		dirs: new Set(),
		files: new Map(),
		failing: new Set(),
		unsupported: new Set(),
		holds: new Map(),
		readHolds: new Map(),
		stats: [],
		reads: [],
	};

	state.reset = () => {
		state.dirs.clear();
		state.files.clear();
		state.failing.clear();
		state.unsupported.clear();
		state.holds.clear();
		state.readHolds.clear();
		state.stats.length = 0;
		state.reads.length = 0;
	};

	state.hold = (url) => {
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		state.holds.set(url, gate);
		return release;
	};

	// Delays the answer of readFile() *after* it has captured the content, like a
	// slow network that already read the file but has not delivered it yet.
	state.holdRead = (url) => {
		let release;
		state.readHolds.set(
			url,
			new Promise((resolve) => {
				release = resolve;
			}),
		);
		return release;
	};

	state.fsOperation = (url) => {
		if (state.unsupported.has(url)) return undefined;
		return {
			async stat() {
				state.stats.push(url);
				await state.holds.get(url);
				if (state.failing.has(url)) throw new Error("stat failed");
				if (state.dirs.has(url)) {
					return { url, isDirectory: true, isFile: false, size: 0 };
				}
				if (state.files.has(url)) {
					const content = state.files.get(url);
					return {
						url,
						isDirectory: false,
						isFile: true,
						size: typeof content === "number" ? content : content.length,
					};
				}
				throw new Error("ENOENT");
			},
			async readFile() {
				state.reads.push(url);
				if (!state.files.has(url)) throw new Error("ENOENT");
				const content = state.files.get(url);
				await state.readHolds.get(url);
				return content;
			},
		};
	};

	return state;
});

vi.mock("fileSystem", () => ({ default: fakeFs.fsOperation }));

import workspace, { detectConfigDir, WORKSPACE_DIR } from "lib/workspace";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createManager() {
	const handlers = new Map();
	return {
		on(event, fn) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(fn);
		},
		off(event, fn) {
			handlers.get(event)?.delete(fn);
		},
		emit(event, ...args) {
			for (const fn of [...(handlers.get(event) ?? [])]) fn(...args);
		},
		count(event) {
			return handlers.get(event)?.size ?? 0;
		},
	};
}

const PROJECT = "file:///sdcard/projects/app";
const OTHER = "file:///sdcard/projects/other";

describe("detectConfigDir", () => {
	beforeEach(() => fakeFs.reset());

	it("uses the .acode directory name", () => {
		expect(WORKSPACE_DIR).toBe(".acode");
	});

	it("returns the url of an existing .acode directory", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		expect(await detectConfigDir(PROJECT)).toBe(`${PROJECT}/.acode`);
	});

	it("handles a root url with a trailing slash", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		expect(await detectConfigDir(`${PROJECT}/`)).toBe(`${PROJECT}/.acode`);
	});

	it("returns null when there is no .acode", async () => {
		expect(await detectConfigDir(PROJECT)).toBeNull();
	});

	it("ignores a .acode that is a file", async () => {
		fakeFs.files.set(`${PROJECT}/.acode`, "");
		expect(await detectConfigDir(PROJECT)).toBeNull();
	});

	it("returns null instead of throwing when the file system fails", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		fakeFs.failing.add(`${PROJECT}/.acode`);
		expect(await detectConfigDir(PROJECT)).toBeNull();
	});

	it("returns null when no file system supports the url", async () => {
		fakeFs.unsupported.add(`${PROJECT}/.acode`);
		expect(await detectConfigDir(PROJECT)).toBeNull();
	});
});

describe("workspace tracking", () => {
	let manager;
	let stop;
	let opened;
	let closed;
	let subscriptions;

	// Listeners live on the module, so track them and remove them after each test.
	const listen = (event, fn) => {
		workspace.on(event, fn);
		subscriptions.push([event, fn]);
		return fn;
	};

	beforeEach(() => {
		fakeFs.reset();
		manager = createManager();
		opened = [];
		closed = [];
		subscriptions = [];
		listen("open", (ws) => opened.push(ws));
		listen("close", (ws) => closed.push(ws));
		stop = workspace.init(manager);
	});

	afterEach(() => {
		stop();
		for (const [event, fn] of subscriptions) workspace.off(event, fn);
	});

	const openFolder = (url, name = "app") =>
		manager.emit("add-folder", { url, name });
	const closeFolder = (url, name = "app") =>
		manager.emit("remove-folder", { url, name });

	it("recognises a project that has a .acode directory", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		openFolder(PROJECT, "app");
		await flush();

		const ws = workspace.get(PROJECT);
		expect(ws).toMatchObject({
			url: PROJECT,
			name: "app",
			configUrl: `${PROJECT}/.acode`,
		});
		expect(ws.settings.values).toEqual({});
		expect(ws.settings.problems).toEqual([]);
		expect(workspace.list()).toEqual([ws]);
		expect(opened).toEqual([ws]);
	});

	it("leaves projects without .acode alone", async () => {
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT)).toBeNull();
		expect(workspace.list()).toEqual([]);
		expect(opened).toEqual([]);
	});

	it("forgets a workspace when its folder is closed", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		openFolder(PROJECT);
		await flush();
		const ws = workspace.get(PROJECT);

		closeFolder(PROJECT);

		expect(workspace.get(PROJECT)).toBeNull();
		expect(workspace.list()).toEqual([]);
		expect(closed).toEqual([ws]);
	});

	it("ignores the removal of a folder that was never tracked", () => {
		closeFolder(OTHER);
		expect(closed).toEqual([]);
	});

	it("does not register a workspace whose folder closed during the scan", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		const release = fakeFs.hold(`${PROJECT}/.acode`);

		openFolder(PROJECT);
		closeFolder(PROJECT);
		release();
		await flush();

		expect(workspace.list()).toEqual([]);
		expect(opened).toEqual([]);
		expect(closed).toEqual([]);
	});

	it("reports a reopened folder once, even if the first scan finishes last", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		const release = fakeFs.hold(`${PROJECT}/.acode`);

		openFolder(PROJECT);
		closeFolder(PROJECT);
		openFolder(PROJECT);
		release();
		await flush();

		expect(workspace.list()).toHaveLength(1);
		expect(opened).toHaveLength(1);
	});

	it("scans folders that were already open when tracking started", async () => {
		stop();
		fakeFs.dirs.add(`${PROJECT}/.acode`);

		stop = workspace.init(manager, [
			{ url: PROJECT, title: "app" },
			{ url: OTHER, title: "other" },
		]);
		await flush();

		expect(workspace.list().map((ws) => ws.url)).toEqual([PROJECT]);
		expect(workspace.get(PROJECT).name).toBe("app");
	});

	it("keeps projects isolated from each other", async () => {
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		openFolder(PROJECT);
		openFolder(OTHER, "other");
		await flush();

		expect(workspace.find(`${PROJECT}/src/index.js`)?.url).toBe(PROJECT);
		expect(workspace.find(`${OTHER}/src/index.js`)).toBeNull();
	});

	describe("find", () => {
		it("matches the root itself and anything below it", async () => {
			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();

			expect(workspace.find(PROJECT)?.url).toBe(PROJECT);
			expect(workspace.find(`${PROJECT}/`)?.url).toBe(PROJECT);
			expect(workspace.find(`${PROJECT}/a/b/c.js`)?.url).toBe(PROJECT);
		});

		it("does not match a sibling that shares the same prefix", async () => {
			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();

			expect(workspace.find(`${PROJECT}-two/file.js`)).toBeNull();
		});

		it("prefers the innermost workspace for nested roots", async () => {
			const inner = `${PROJECT}/packages/ui`;
			fakeFs.dirs.add(`${PROJECT}/.acode`);
			fakeFs.dirs.add(`${inner}/.acode`);
			openFolder(PROJECT);
			openFolder(inner, "ui");
			await flush();

			expect(workspace.find(`${inner}/button.js`)?.url).toBe(inner);
			expect(workspace.find(`${PROJECT}/README.md`)?.url).toBe(PROJECT);
		});

		it("returns null for an empty url", () => {
			expect(workspace.find("")).toBeNull();
			expect(workspace.find(undefined)).toBeNull();
		});
	});

	describe("refresh", () => {
		it("picks up a .acode directory created after the folder was opened", async () => {
			openFolder(PROJECT);
			await flush();
			expect(workspace.get(PROJECT)).toBeNull();

			fakeFs.dirs.add(`${PROJECT}/.acode`);
			const ws = await workspace.refresh(PROJECT);

			expect(ws?.configUrl).toBe(`${PROJECT}/.acode`);
			expect(opened).toHaveLength(1);
		});

		it("drops a workspace whose .acode directory was deleted", async () => {
			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();
			const ws = workspace.get(PROJECT);

			fakeFs.dirs.delete(`${PROJECT}/.acode`);
			expect(await workspace.refresh(PROJECT)).toBeNull();

			expect(workspace.list()).toEqual([]);
			expect(closed).toEqual([ws]);
		});

		it("does not announce an unchanged workspace again", async () => {
			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();

			await workspace.refresh(PROJECT);

			expect(opened).toHaveLength(1);
		});

		it("does nothing for a folder that is not open", async () => {
			fakeFs.dirs.add(`${OTHER}/.acode`);
			expect(await workspace.refresh(OTHER)).toBeNull();
			expect(workspace.list()).toEqual([]);
		});
	});

	describe("listeners", () => {
		it("keeps notifying others when a listener throws", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			const after = vi.fn();
			listen("open", () => {
				throw new Error("boom");
			});
			listen("open", after);

			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();

			expect(after).toHaveBeenCalledTimes(1);
			expect(workspace.get(PROJECT)).not.toBeNull();
			error.mockRestore();
		});

		it("stops notifying a listener that was removed", async () => {
			const listener = vi.fn();
			listen("open", listener);
			workspace.off("open", listener);

			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();

			expect(listener).not.toHaveBeenCalled();
		});

		it("ignores unknown event names", () => {
			expect(() => workspace.on("nope", () => {})).not.toThrow();
			expect(() => workspace.off("nope", () => {})).not.toThrow();
		});
	});

	describe("init", () => {
		it("stops tracking and forgets everything when disposed", async () => {
			fakeFs.dirs.add(`${PROJECT}/.acode`);
			openFolder(PROJECT);
			await flush();

			stop();

			expect(workspace.list()).toEqual([]);
			expect(manager.count("add-folder")).toBe(0);
			expect(manager.count("remove-folder")).toBe(0);
			expect(manager.count("save-file")).toBe(0);

			openFolder(OTHER);
			await flush();
			expect(workspace.list()).toEqual([]);
		});

		it("does not subscribe twice when called again", () => {
			stop = workspace.init(manager);
			expect(manager.count("add-folder")).toBe(1);
			expect(manager.count("remove-folder")).toBe(1);
			expect(manager.count("save-file")).toBe(1);
		});
	});
});

describe("project settings", () => {
	let manager;
	let stop;
	let events;
	let subscriptions;

	const SETTINGS = `${PROJECT}/.acode/settings.json`;
	const listen = (event, fn) => {
		workspace.on(event, fn);
		subscriptions.push([event, fn]);
	};
	const openFolder = (url, name = "app") =>
		manager.emit("add-folder", { url, name });
	const save = (uri) => manager.emit("save-file", { uri });
	const writeSettings = (text) => fakeFs.files.set(SETTINGS, text);

	beforeEach(() => {
		fakeFs.reset();
		manager = createManager();
		events = [];
		subscriptions = [];
		for (const event of ["open", "settings", "close"]) {
			listen(event, (ws) => events.push([event, ws]));
		}
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		stop = workspace.init(manager);
	});

	afterEach(() => {
		stop();
		for (const [event, fn] of subscriptions) workspace.off(event, fn);
	});

	it("reads settings.json when the project opens", async () => {
		writeSettings('{"tabSize": 4, "softTab": false}');
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT).settings.values).toEqual({
			tabSize: 4,
			softTab: false,
		});
		expect(events.map(([name]) => name)).toEqual(["open"]);
		// Listeners must see the settings already loaded.
		expect(events[0][1].settings.values.tabSize).toBe(4);
	});

	it("is a workspace even without a settings.json", async () => {
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT)).not.toBeNull();
		expect(workspace.get(PROJECT).settings.values).toEqual({});
		expect(fakeFs.reads).toEqual([]);
	});

	it("keeps the workspace and reports a problem for an invalid file", async () => {
		writeSettings("{ tabSize: 4 ");
		openFolder(PROJECT);
		await flush();

		const { settings } = workspace.get(PROJECT);
		expect(settings.values).toEqual({});
		expect(settings.problems).toHaveLength(1);
	});

	it("does not read a settings.json that is too large", async () => {
		fakeFs.files.set(SETTINGS, 5 * 1024 * 1024);
		openFolder(PROJECT);
		await flush();

		expect(fakeFs.reads).toEqual([]);
		const { settings } = workspace.get(PROJECT);
		expect(settings.values).toEqual({});
		expect(settings.problems[0]).toMatch(/larger than/i);
	});

	it("ignores a settings.json that is a directory", async () => {
		fakeFs.dirs.add(SETTINGS);
		openFolder(PROJECT);
		await flush();

		expect(fakeFs.reads).toEqual([]);
		expect(workspace.get(PROJECT).settings.problems).toEqual([]);
	});

	it("treats an unreadable settings.json as no overrides", async () => {
		writeSettings('{"tabSize": 4}');
		fakeFs.failing.add(SETTINGS);
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT)).not.toBeNull();
		expect(workspace.get(PROJECT).settings.values).toEqual({});
	});

	describe("getSettings", () => {
		it("returns the overrides for files inside the project", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();

			expect(workspace.getSettings(`${PROJECT}/src/a.js`)).toEqual({
				tabSize: 4,
			});
			expect(workspace.getSettings(PROJECT)).toEqual({ tabSize: 4 });
		});

		it("returns nothing for files outside every project", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();

			expect(workspace.getSettings(`${OTHER}/a.js`)).toEqual({});
			expect(workspace.getSettings(`${PROJECT}-two/a.js`)).toEqual({});
			expect(workspace.getSettings("")).toEqual({});
			expect(workspace.getSettings(undefined)).toEqual({});
		});

		it("returns nothing for an open folder that has no .acode", async () => {
			openFolder(OTHER, "other");
			await flush();
			expect(workspace.getSettings(`${OTHER}/a.js`)).toEqual({});
		});

		it("lets the innermost project decide, without inheriting from the outer one", async () => {
			const inner = `${PROJECT}/packages/ui`;
			writeSettings('{"tabSize": 4, "softTab": false}');
			fakeFs.dirs.add(`${inner}/.acode`);
			fakeFs.files.set(`${inner}/.acode/settings.json`, '{"tabSize": 2}');
			const bare = `${PROJECT}/packages/bare`;
			fakeFs.dirs.add(`${bare}/.acode`);

			openFolder(PROJECT);
			openFolder(inner, "ui");
			openFolder(bare, "bare");
			await flush();

			expect(workspace.getSettings(`${inner}/x.js`)).toEqual({ tabSize: 2 });
			// A nested project is its own project: no softTab from the outer one.
			expect(workspace.getSettings(`${bare}/x.js`)).toEqual({});
			expect(workspace.getSettings(`${PROJECT}/README.md`)).toEqual({
				tabSize: 4,
				softTab: false,
			});
		});

		it("returns frozen objects, so callers cannot alter a project's settings", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();

			expect(Object.isFrozen(workspace.getSettings(PROJECT))).toBe(true);
			expect(Object.isFrozen(workspace.getSettings(`${OTHER}/a.js`))).toBe(
				true,
			);
		});

		describe("resolveSettings", () => {
			const user = Object.freeze({
				tabSize: 2,
				softTab: true,
				fontSize: "12px",
			});

			it("puts the project's overrides on top of the user's settings", async () => {
				writeSettings('{"tabSize": 4}');
				openFolder(PROJECT);
				await flush();

				expect(workspace.resolveSettings(user, `${PROJECT}/a.js`)).toEqual({
					tabSize: 4,
					softTab: true,
					fontSize: "12px",
				});
			});

			it("never modifies the user's settings", async () => {
				writeSettings('{"tabSize": 4, "softTab": false}');
				openFolder(PROJECT);
				await flush();

				const mine = { tabSize: 2, softTab: true };
				const merged = workspace.resolveSettings(mine, `${PROJECT}/a.js`);

				expect(merged).not.toBe(mine);
				expect(mine).toEqual({ tabSize: 2, softTab: true });
			});

			it("returns the very same object when there is nothing to override", async () => {
				writeSettings("{}");
				openFolder(PROJECT);
				openFolder(OTHER, "other");
				await flush();

				expect(workspace.resolveSettings(user, `${PROJECT}/a.js`)).toBe(user);
				expect(workspace.resolveSettings(user, `${OTHER}/a.js`)).toBe(user);
				expect(workspace.resolveSettings(user, undefined)).toBe(user);
			});

			it("does not let another project's settings leak across", async () => {
				writeSettings('{"tabSize": 8}');
				openFolder(PROJECT);
				openFolder(OTHER, "other");
				await flush();

				expect(workspace.resolveSettings(user, `${OTHER}/a.js`).tabSize).toBe(
					2,
				);
			});
		});

		it("stops applying once the project closes", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();

			manager.emit("remove-folder", { url: PROJECT });

			expect(workspace.getSettings(`${PROJECT}/src/a.js`)).toEqual({});
		});
	});

	describe("saving files in .acode", () => {
		it("applies an edit to settings.json right away", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();
			events.length = 0;

			writeSettings('{"tabSize": 8}');
			save(SETTINGS);
			await flush();

			expect(workspace.getSettings(PROJECT)).toEqual({ tabSize: 8 });
			expect(events.map(([name]) => name)).toEqual(["settings"]);
			expect(events[0][1].settings.values.tabSize).toBe(8);
		});

		it("reports a problem when a save introduces a mistake, and recovers when fixed", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();

			writeSettings('{"tabSize": 99}');
			save(SETTINGS);
			await flush();
			expect(workspace.get(PROJECT).settings.problems).toHaveLength(1);
			expect(workspace.getSettings(PROJECT)).toEqual({});

			writeSettings('{"tabSize": 3}');
			save(SETTINGS);
			await flush();
			expect(workspace.get(PROJECT).settings.problems).toEqual([]);
			expect(workspace.getSettings(PROJECT)).toEqual({ tabSize: 3 });
		});

		it("does not announce a save that changes nothing", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();
			events.length = 0;

			writeSettings('{ "tabSize": 4 }');
			save(SETTINGS);
			await flush();

			expect(events).toEqual([]);
		});

		it("picks up a .acode created after the folder was opened", async () => {
			fakeFs.dirs.clear();
			openFolder(PROJECT);
			await flush();
			expect(workspace.get(PROJECT)).toBeNull();

			fakeFs.dirs.add(`${PROJECT}/.acode`);
			writeSettings('{"softTab": false}');
			save(SETTINGS);
			await flush();

			expect(workspace.getSettings(PROJECT)).toEqual({ softTab: false });
			expect(events.map(([name]) => name)).toEqual(["open"]);
		});

		it("drops the settings when settings.json is deleted", async () => {
			writeSettings('{"tabSize": 4}');
			openFolder(PROJECT);
			await flush();
			events.length = 0;

			fakeFs.files.delete(SETTINGS);
			await workspace.refresh(PROJECT);

			expect(workspace.getSettings(PROJECT)).toEqual({});
			expect(events.map(([name]) => name)).toEqual(["settings"]);
		});

		it("does not touch the file system for files outside .acode", async () => {
			openFolder(PROJECT);
			await flush();
			fakeFs.stats.length = 0;

			save(`${PROJECT}/src/index.js`);
			save(`${PROJECT}/.acodeignore`);
			save(`${OTHER}/.acode/settings.json`);
			save(undefined);
			await flush();

			expect(fakeFs.stats).toEqual([]);
		});
	});

	describe("races", () => {
		it("does not register a workspace whose folder closed while settings were loading", async () => {
			writeSettings('{"tabSize": 4}');
			const release = fakeFs.hold(SETTINGS);

			openFolder(PROJECT);
			await flush();
			manager.emit("remove-folder", { url: PROJECT });
			release();
			await flush();

			expect(workspace.list()).toEqual([]);
			expect(workspace.getSettings(PROJECT)).toEqual({});
			expect(events).toEqual([]);
		});

		it("lets the newest scan win when an older one delivers late", async () => {
			writeSettings('{"tabSize": 2}');
			openFolder(PROJECT);
			await flush();

			// The older scan has already read tabSize 3 but its answer is slow.
			writeSettings('{"tabSize": 3}');
			const deliverOld = fakeFs.holdRead(SETTINGS);
			save(SETTINGS);
			await flush();

			// A newer save is read and applied in the meantime.
			fakeFs.readHolds.delete(SETTINGS);
			writeSettings('{"tabSize": 6}');
			save(SETTINGS);
			await flush();
			expect(workspace.getSettings(PROJECT)).toEqual({ tabSize: 6 });

			deliverOld();
			await flush();

			expect(workspace.getSettings(PROJECT)).toEqual({ tabSize: 6 });
		});
	});
});

describe("plugin recommendations", () => {
	let manager;
	let stop;
	let events;
	let subscriptions;

	const EXTENSIONS = `${PROJECT}/.acode/extensions.json`;
	const SETTINGS = `${PROJECT}/.acode/settings.json`;
	const listen = (event, fn) => {
		workspace.on(event, fn);
		subscriptions.push([event, fn]);
	};
	const openFolder = (url, name = "app") =>
		manager.emit("add-folder", { url, name });
	const save = (uri) => manager.emit("save-file", { uri });
	const names = () => events.map(([name]) => name);

	beforeEach(() => {
		fakeFs.reset();
		manager = createManager();
		events = [];
		subscriptions = [];
		for (const event of ["open", "settings", "extensions", "close"]) {
			listen(event, (ws) => events.push([event, ws]));
		}
		fakeFs.dirs.add(`${PROJECT}/.acode`);
		stop = workspace.init(manager);
	});

	afterEach(() => {
		stop();
		for (const [event, fn] of subscriptions) workspace.off(event, fn);
	});

	it("reads extensions.json when the project opens, before announcing it", async () => {
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a.b", "c.d"]}');
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT).extensions.recommendations).toEqual([
			"a.b",
			"c.d",
		]);
		expect(names()).toEqual(["open"]);
		expect(events[0][1].extensions.recommendations).toEqual(["a.b", "c.d"]);
	});

	it("has no recommendations without an extensions.json", async () => {
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT).extensions.recommendations).toEqual([]);
		expect(workspace.get(PROJECT).extensions.problems).toEqual([]);
	});

	it("reports a problem for an invalid file and keeps the workspace", async () => {
		fakeFs.files.set(EXTENSIONS, "{ nope");
		openFolder(PROJECT);
		await flush();

		const { extensions } = workspace.get(PROJECT);
		expect(extensions.recommendations).toEqual([]);
		expect(extensions.problems).toHaveLength(1);
	});

	it("does not read a file that is too large", async () => {
		fakeFs.files.set(EXTENSIONS, 5 * 1024 * 1024);
		openFolder(PROJECT);
		await flush();

		expect(fakeFs.reads).not.toContain(EXTENSIONS);
		expect(workspace.get(PROJECT).extensions.problems[0]).toMatch(
			/larger than/i,
		);
	});

	it("ignores an extensions.json that is a directory", async () => {
		fakeFs.dirs.add(EXTENSIONS);
		openFolder(PROJECT);
		await flush();

		expect(fakeFs.reads).not.toContain(EXTENSIONS);
		expect(workspace.get(PROJECT).extensions.problems).toEqual([]);
	});

	it("never hands out a hostile id", async () => {
		fakeFs.files.set(
			EXTENSIONS,
			JSON.stringify({
				recommendations: ["https://evil.example/p.zip", "../x", "good.id"],
			}),
		);
		openFolder(PROJECT);
		await flush();

		expect(workspace.get(PROJECT).extensions.recommendations).toEqual([
			"good.id",
		]);
	});

	it("announces a changed list as 'extensions', and only that", async () => {
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a"]}');
		openFolder(PROJECT);
		await flush();
		events.length = 0;

		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a", "b"]}');
		save(EXTENSIONS);
		await flush();

		expect(names()).toEqual(["extensions"]);
		expect(events[0][1].extensions.recommendations).toEqual(["a", "b"]);
	});

	it("announces changed settings as 'settings', and only that", async () => {
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a"]}');
		openFolder(PROJECT);
		await flush();
		events.length = 0;

		fakeFs.files.set(SETTINGS, '{"tabSize": 4}');
		save(SETTINGS);
		await flush();

		expect(names()).toEqual(["settings"]);
	});

	it("announces both when one scan changes both", async () => {
		openFolder(PROJECT);
		await flush();
		events.length = 0;

		fakeFs.files.set(SETTINGS, '{"tabSize": 4}');
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a"]}');
		await workspace.refresh(PROJECT);

		expect(names().sort()).toEqual(["extensions", "settings"]);
		// Both listeners see the same, complete state.
		expect(events[0][1]).toBe(events[1][1]);
	});

	it("does not announce a save that changes nothing", async () => {
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a"]}');
		openFolder(PROJECT);
		await flush();
		events.length = 0;

		fakeFs.files.set(EXTENSIONS, '{ "recommendations": [ "a" ] }');
		save(EXTENSIONS);
		await flush();

		expect(events).toEqual([]);
	});

	it("keeps settings and recommendations independent of each other", async () => {
		fakeFs.files.set(SETTINGS, '{"tabSize": 4}');
		fakeFs.files.set(EXTENSIONS, "{ broken");
		openFolder(PROJECT);
		await flush();

		const ws = workspace.get(PROJECT);
		expect(ws.settings.values).toEqual({ tabSize: 4 });
		expect(ws.settings.problems).toEqual([]);
		expect(ws.extensions.problems).toHaveLength(1);
	});

	it("does not register a workspace whose folder closed while extensions were loading", async () => {
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a"]}');
		const release = fakeFs.hold(EXTENSIONS);

		openFolder(PROJECT);
		await flush();
		manager.emit("remove-folder", { url: PROJECT });
		release();
		await flush();

		expect(workspace.list()).toEqual([]);
		expect(events).toEqual([]);
	});

	it("drops recommendations when extensions.json is deleted", async () => {
		fakeFs.files.set(EXTENSIONS, '{"recommendations": ["a"]}');
		openFolder(PROJECT);
		await flush();
		events.length = 0;

		fakeFs.files.delete(EXTENSIONS);
		await workspace.refresh(PROJECT);

		expect(workspace.get(PROJECT).extensions.recommendations).toEqual([]);
		expect(names()).toEqual(["extensions"]);
	});
});

describe("pathsChanged", () => {
	let manager;
	let stop;
	let events;
	let subscriptions;

	const CONFIG = `${PROJECT}/.acode`;
	const SETTINGS = `${CONFIG}/settings.json`;
	const listen = (event, fn) => {
		workspace.on(event, fn);
		subscriptions.push([event, fn]);
	};
	const names = () => events.map(([name]) => name);

	beforeEach(async () => {
		fakeFs.reset();
		manager = createManager();
		events = [];
		subscriptions = [];
		for (const event of ["open", "settings", "close"]) {
			listen(event, (ws) => events.push([event, ws]));
		}
		fakeFs.dirs.add(CONFIG);
		fakeFs.files.set(SETTINGS, '{"tabSize": 4}');
		stop = workspace.init(manager);
		manager.emit("add-folder", { url: PROJECT, name: "app" });
		await flush();
		events.length = 0;
	});

	afterEach(() => {
		stop();
		for (const [event, fn] of subscriptions) workspace.off(event, fn);
	});

	it("drops the settings when settings.json is deleted", async () => {
		expect(workspace.getSettings(`${PROJECT}/a.js`)).toEqual({ tabSize: 4 });

		fakeFs.files.delete(SETTINGS);
		workspace.pathsChanged(SETTINGS);
		await flush();

		expect(workspace.getSettings(`${PROJECT}/a.js`)).toEqual({});
		expect(names()).toEqual(["settings"]);
	});

	it("drops the settings when settings.json is renamed away", async () => {
		const renamed = `${CONFIG}/settings.old.json`;
		fakeFs.files.set(renamed, fakeFs.files.get(SETTINGS));
		fakeFs.files.delete(SETTINGS);
		workspace.pathsChanged(SETTINGS, renamed);
		await flush();

		expect(workspace.getSettings(`${PROJECT}/a.js`)).toEqual({});
	});

	it("closes the workspace when the .acode directory is deleted", async () => {
		fakeFs.files.delete(SETTINGS);
		fakeFs.dirs.delete(CONFIG);
		workspace.pathsChanged(CONFIG);
		await flush();

		expect(workspace.get(PROJECT)).toBeNull();
		expect(names()).toEqual(["close"]);
	});

	it("notices a directory renamed to .acode", async () => {
		fakeFs.reset();
		fakeFs.dirs.add(PROJECT);
		manager.emit("remove-folder", { url: PROJECT });
		manager.emit("add-folder", { url: PROJECT, name: "app" });
		await flush();
		events.length = 0;

		fakeFs.dirs.add(CONFIG);
		fakeFs.files.set(SETTINGS, '{"tabSize": 8}');
		workspace.pathsChanged(`${PROJECT}/config`, CONFIG);
		await flush();

		expect(workspace.getSettings(`${PROJECT}/a.js`)).toEqual({ tabSize: 8 });
	});

	it("rescans when a folder above .acode is removed", async () => {
		fakeFs.files.delete(SETTINGS);
		fakeFs.dirs.delete(CONFIG);
		workspace.pathsChanged(PROJECT);
		await flush();

		expect(workspace.get(PROJECT)).toBeNull();
	});

	it("ignores changes elsewhere in the project", async () => {
		fakeFs.stats.length = 0;
		workspace.pathsChanged(
			`${PROJECT}/src/index.js`,
			`${PROJECT}/.acodeignore`,
		);
		await flush();

		expect(fakeFs.stats).toEqual([]);
		expect(events).toEqual([]);
	});

	it("ignores changes in roots that are not open", async () => {
		fakeFs.stats.length = 0;
		workspace.pathsChanged(`${OTHER}/.acode/settings.json`);
		await flush();

		expect(fakeFs.stats).toEqual([]);
	});
});
