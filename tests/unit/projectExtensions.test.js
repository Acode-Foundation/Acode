import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import english from "../../src/lang/en-us.json";

const PLUGIN_DIR = "file:///data/plugins";
const PROJECT = "file:///sdcard/projects/app";

// One fake file system serves both the workspace scan (.acode files) and the
// "is this plugin installed" check, which is just `exists()` on a plugin folder.
const fake = vi.hoisted(() => {
	const state = {
		files: new Map(),
		dirs: new Set(),
		installed: new Set(),
		existsFailing: new Set(),
		existsCalls: [],
		existsHolds: new Map(),
	};
	state.reset = () => {
		state.files.clear();
		state.dirs.clear();
		state.installed.clear();
		state.existsFailing.clear();
		state.existsCalls.length = 0;
		state.existsHolds.clear();
	};
	state.fsOperation = (...parts) => {
		const url = parts.length > 1 ? parts.join("/") : parts[0];
		return {
			async exists() {
				state.existsCalls.push(url);
				await state.existsHolds.get(url);
				if (state.existsFailing.has(url)) throw new Error("exists failed");
				return state.installed.has(url);
			},
			async stat() {
				if (state.dirs.has(url))
					return { isDirectory: true, isFile: false, size: 0 };
				if (state.files.has(url)) {
					return {
						isDirectory: false,
						isFile: true,
						size: state.files.get(url).length,
					};
				}
				throw new Error("ENOENT");
			},
			async readFile() {
				return state.files.get(url);
			},
		};
	};
	return state;
});

const ui = vi.hoisted(() => ({
	pushNotification: vi.fn(),
	select: vi.fn(),
	openPlugin: vi.fn(),
	settings: { value: { recommendExtensions: true } },
}));

vi.mock("fileSystem", () => ({ default: fake.fsOperation }));
vi.mock("lib/notificationManager", () => ({
	default: { pushNotification: ui.pushNotification },
}));
vi.mock("lib/settings", () => ({ default: ui.settings }));
vi.mock("dialogs/select", () => ({ default: ui.select }));
vi.mock("pages/plugin", () => ({ default: ui.openPlugin }));

import projectExtensions, { findMissing, review } from "lib/projectExtensions";
import workspace from "lib/workspace";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
	for (let i = 0; i < 6; i++) await flush();
};

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
	};
}

describe("project plugin recommendations", () => {
	let manager;
	let stopWorkspace;
	let stopRecommender;

	const EXTENSIONS = `${PROJECT}/.acode/extensions.json`;
	const write = (value) =>
		fake.files.set(
			EXTENSIONS,
			typeof value === "string" ? value : JSON.stringify(value),
		);
	const recommend = (...ids) => write({ recommendations: ids });
	const installed = (...ids) =>
		ids.forEach((id) => fake.installed.add(`${PLUGIN_DIR}/${id}`));
	const openProject = async (name = "app") => {
		manager.emit("add-folder", { url: PROJECT, name });
		await settle();
	};
	const notification = () => ui.pushNotification.mock.calls[0]?.[0];

	beforeEach(() => {
		fake.reset();
		ui.pushNotification.mockReset();
		ui.select.mockReset();
		ui.openPlugin.mockReset();
		ui.settings.value = { recommendExtensions: true };
		globalThis.PLUGIN_DIR = PLUGIN_DIR;
		globalThis.strings = { ...english };
		fake.dirs.add(`${PROJECT}/.acode`);

		manager = createManager();
		stopWorkspace = workspace.init(manager);
		stopRecommender = projectExtensions.init();
	});

	afterEach(() => {
		stopRecommender();
		stopWorkspace();
		delete globalThis.PLUGIN_DIR;
		delete globalThis.strings;
	});

	it("uses strings that exist in the English language file", () => {
		for (const key of [
			"project extensions title",
			"project extensions message",
			"review recommendations",
			"plugins",
		]) {
			expect(english[key], key).toBeTruthy();
		}
	});

	describe("announcing", () => {
		it("tells the user which project recommends which missing plugins", async () => {
			recommend("a.one", "b.two");
			await openProject("my-app");

			expect(ui.pushNotification).toHaveBeenCalledTimes(1);
			const n = notification();
			expect(n.title).toBe("Plugins recommended by my-app");
			expect(n.message).toBe("my-app recommends: a.one, b.two");
			expect(n.icon).toBe("extension");
			expect(n.type).toBe("info");
			expect(n.actions).toHaveLength(1);
			expect(n.actions[0].text).toBe("Review");
		});

		it("names the project's url when it has no name", async () => {
			recommend("a.one");
			await openProject(null);
			expect(notification().message).toContain(PROJECT);
		});

		it("leaves out plugins that are already installed", async () => {
			recommend("a.one", "b.two");
			installed("a.one");
			await openProject();

			expect(notification().message).toBe("app recommends: b.two");
		});

		it("stays quiet when everything is installed", async () => {
			recommend("a.one", "b.two");
			installed("a.one", "b.two");
			await openProject();

			expect(ui.pushNotification).not.toHaveBeenCalled();
		});

		it("stays quiet when the project recommends nothing", async () => {
			recommend();
			await openProject();
			expect(ui.pushNotification).not.toHaveBeenCalled();
			expect(fake.existsCalls).toEqual([]);
		});

		it("stays quiet for a project without extensions.json", async () => {
			await openProject();
			expect(ui.pushNotification).not.toHaveBeenCalled();
		});

		it("respects the user's choice to turn recommendations off, and checks nothing", async () => {
			ui.settings.value.recommendExtensions = false;
			recommend("a.one");
			await openProject();

			expect(ui.pushNotification).not.toHaveBeenCalled();
			expect(fake.existsCalls).toEqual([]);
		});

		it("treats an unset preference as on, like the existing language recommendations", async () => {
			delete ui.settings.value.recommendExtensions;
			recommend("a.one");
			await openProject();
			expect(ui.pushNotification).toHaveBeenCalledTimes(1);
		});

		it("does not nag about a plugin it cannot check", async () => {
			recommend("a.one", "b.two");
			fake.existsFailing.add(`${PLUGIN_DIR}/a.one`);
			await openProject();

			expect(notification().message).toBe("app recommends: b.two");
		});
	});

	describe("not repeating itself", () => {
		it("announces the same advice only once per session", async () => {
			recommend("a.one");
			await openProject();
			await workspace.refresh(PROJECT);
			await settle();
			manager.emit("save-file", { uri: EXTENSIONS });
			await settle();

			expect(ui.pushNotification).toHaveBeenCalledTimes(1);
		});

		it("does not repeat when only the file's mistakes change", async () => {
			write({ recommendations: ["a.one", "bad/id"] });
			await openProject();
			write({ recommendations: ["a.one", "other/bad"] });
			manager.emit("save-file", { uri: EXTENSIONS });
			await settle();

			expect(ui.pushNotification).toHaveBeenCalledTimes(1);
		});

		it("announces again when the project recommends something new", async () => {
			recommend("a.one");
			await openProject();

			recommend("a.one", "b.two");
			manager.emit("save-file", { uri: EXTENSIONS });
			await settle();

			expect(ui.pushNotification).toHaveBeenCalledTimes(2);
			expect(ui.pushNotification.mock.calls[1][0].message).toBe(
				"app recommends: a.one, b.two",
			);
		});

		it("forgets what it announced once stopped and restarted", async () => {
			recommend("a.one");
			await openProject();
			stopRecommender();
			stopRecommender = projectExtensions.init();
			await workspace.refresh(PROJECT);
			manager.emit("remove-folder", { url: PROJECT });
			await openProject();

			expect(ui.pushNotification).toHaveBeenCalledTimes(2);
		});

		it("stops reacting once stopped", async () => {
			stopRecommender();
			recommend("a.one");
			await openProject();
			expect(ui.pushNotification).not.toHaveBeenCalled();
		});
	});

	describe("hostile input", () => {
		it("never lets a path- or URL-like id near the file system", async () => {
			recommend(
				"https://evil.example/p.zip",
				"../../x",
				"file:///data/data/com.foxdebug.acode",
				"a/b",
				"ok.id",
			);
			await openProject();

			expect(fake.existsCalls).toEqual([`${PLUGIN_DIR}/ok.id`]);
			expect(notification().message).toBe("app recommends: ok.id");
		});

		it("checks ids again before building a path, in case a caller skips the parser", async () => {
			const missing = await findMissing([
				"https://evil.example/x",
				"../x",
				"a/b",
				"fine.id",
				"",
				null,
			]);
			expect(fake.existsCalls).toEqual([`${PLUGIN_DIR}/fine.id`]);
			expect(missing).toEqual(["fine.id"]);
		});

		it("says nothing when every id is bad", async () => {
			recommend("https://evil.example/p.zip", "../x");
			await openProject();
			expect(ui.pushNotification).not.toHaveBeenCalled();
			expect(fake.existsCalls).toEqual([]);
		});
	});

	describe("races", () => {
		it("says nothing if the project closed while plugins were being checked", async () => {
			recommend("a.one");
			const release = (() => {
				let r;
				fake.existsHolds.set(
					`${PLUGIN_DIR}/a.one`,
					new Promise((resolve) => {
						r = resolve;
					}),
				);
				return r;
			})();

			manager.emit("add-folder", { url: PROJECT, name: "app" });
			await settle();
			manager.emit("remove-folder", { url: PROJECT });
			release();
			await settle();

			expect(ui.pushNotification).not.toHaveBeenCalled();
		});

		it("says nothing if the list changed while plugins were being checked", async () => {
			recommend("a.one");
			let release;
			fake.existsHolds.set(
				`${PLUGIN_DIR}/a.one`,
				new Promise((resolve) => {
					release = resolve;
				}),
			);

			manager.emit("add-folder", { url: PROJECT, name: "app" });
			await settle();
			// The user removes the recommendation before the first check finishes.
			recommend();
			manager.emit("save-file", { uri: EXTENSIONS });
			await settle();
			release();
			await settle();

			expect(ui.pushNotification).not.toHaveBeenCalled();
		});
	});

	describe("reviewing a recommendation", () => {
		it("opens the plugin's page, without installing it", async () => {
			recommend("a.one");
			await openProject();

			notification().action();
			await settle();

			expect(ui.openPlugin).toHaveBeenCalledTimes(1);
			// Exactly the id: an `install` flag would install the plugin on arrival.
			expect(ui.openPlugin.mock.calls[0]).toEqual([{ id: "a.one" }]);
			expect(ui.select).not.toHaveBeenCalled();
		});

		it("does the same from the Review button", async () => {
			recommend("a.one");
			await openProject();

			notification().actions[0].action();
			await settle();

			expect(ui.openPlugin.mock.calls[0]).toEqual([{ id: "a.one" }]);
		});

		it("lets the user pick one when there are several", async () => {
			recommend("a.one", "b.two", "c.three");
			await openProject();
			ui.select.mockResolvedValue("b.two");

			notification().action();
			await settle();

			expect(ui.select).toHaveBeenCalledWith("Plugins", [
				"a.one",
				"b.two",
				"c.three",
			]);
			expect(ui.openPlugin.mock.calls).toEqual([[{ id: "b.two" }]]);
		});

		it("opens nothing when the user cancels the choice", async () => {
			recommend("a.one", "b.two");
			await openProject();
			ui.select.mockResolvedValue(null);

			notification().action();
			await settle();

			expect(ui.openPlugin).not.toHaveBeenCalled();
		});

		it("refuses to open an id that is not a plain plugin id", async () => {
			ui.select.mockResolvedValue("https://evil.example/p.zip");
			await review(["a.one", "b.two"]);
			expect(ui.openPlugin).not.toHaveBeenCalled();

			await review(["../x"]);
			expect(ui.openPlugin).not.toHaveBeenCalled();
		});

		it("survives a failure while opening the page", async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			recommend("a.one");
			await openProject();
			ui.openPlugin.mockImplementation(() => {
				throw new Error("page failed");
			});

			expect(() => notification().action()).not.toThrow();
			await settle();
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		});
	});

	it("never installs anything", async () => {
		recommend("a.one", "b.two");
		await openProject();
		ui.select.mockResolvedValue("a.one");

		notification().action();
		await settle();

		// The page was opened, so the check below is not vacuous...
		expect(ui.openPlugin).toHaveBeenCalledTimes(1);
		// ...and it was given the id and nothing else: an `install` flag would
		// install the plugin the moment the page opens.
		expect(Object.keys(ui.openPlugin.mock.calls[0][0])).toEqual(["id"]);
		// The plugin folders were only ever looked at, never created.
		expect(fake.installed.size).toBe(0);
	});
});
