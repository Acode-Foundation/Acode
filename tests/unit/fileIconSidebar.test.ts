// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fileIcons from "lib/fileIcons";

const sidebar = vi.hoisted(() => ({ on: vi.fn() }));
vi.mock("components/sidebar", () => ({ default: sidebar }));
vi.mock("lib/settings", () => ({ default: {} }));

beforeEach(() => {
	vi.stubGlobal("strings", { files: "Files", "open folder": "Open folder" });
	vi.stubGlobal("editorManager", { on: vi.fn() });
});
afterEach(() => {
	fileIcons.resetForTests();
	document.body.innerHTML = "";
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

it("refreshes detached files and expanded folders when the phone sidebar reopens", async () => {
	const { default: filesApp } = await import(
		"../../src/sidebarApps/files/index.js"
	);
	const container = document.createElement("div");
	Object.assign(container, {
		getAll: (selector: string) =>
			Array.from(container.querySelectorAll(selector)),
	});
	const init = filesApp[3] as (element: HTMLElement) => void;
	init(container);
	container.innerHTML =
		'<div class="collapsible"><div data-type="root" data-name="project"><span></span></div><div class="collapsible"><div data-type="dir" data-name="src"><span></span></div><div data-type="file" data-name="app.js"><span></span></div></div></div>';
	const register = (id: string) =>
		fileIcons.register({
			id,
			pluginId: "test.plugin",
			icons: {
				file: { className: `${id}-file` },
				closed: { className: `${id}-closed` },
				open: { className: `${id}-open` },
				root: { className: `${id}-root` },
			},
			file: "file",
			folder: "closed",
			folderExpanded: "open",
			rootFolderExpanded: "root",
		});
	register("first");
	register("second");
	document.body.append(container);
	fileIcons.use("first", { persist: false });
	container.remove(); // hide() removes the phone sidebar from the document
	fileIcons.use("second", { persist: false });
	expect(container.querySelector('[data-type="file"] span')?.className).toBe(
		"first-file",
	);
	document.body.append(container);
	const onShow = sidebar.on.mock.calls.find(([event]) => event === "show")![1];
	onShow();
	expect(container.querySelector('[data-type="file"] span')?.className).toBe(
		"second-file",
	);
	expect(container.querySelector('[data-type="dir"] span')?.className).toBe(
		"second-open",
	);
	expect(container.querySelector('[data-type="root"] span')?.className).toBe(
		"second-root",
	);
	expect(container.querySelector(".hidden")).toBeNull();

	// Selecting the Files tab also refreshes an inactive, detached sidebar app.
	container.remove();
	fileIcons.use("builtin", { persist: false });
	(filesApp[5] as () => void)();
	expect(container.querySelector('[data-type="dir"] span')?.className).toBe(
		"icon folder",
	);
	expect(container.querySelector('[data-type="file"] span')?.className).toBe(
		fileIcons.icon("app.js"),
	);
	expect(fileIcons.active().name).toBe("Builtin");
});

it("replaces fallbacks with loaded assets after reopening without toggling folders", async () => {
	const { default: filesApp } = await import(
		"../../src/sidebarApps/files/index.js"
	);
	const requests: Array<{
		src: string;
		onload: (() => void) | null;
		onerror: (() => void) | null;
	}> = [];
	class ImageStub {
		src = "";
		onload = null;
		onerror = null;
		constructor() {
			requests.push(this);
		}
	}
	vi.stubGlobal("Image", ImageStub);
	vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
		queueMicrotask(fn);
		return 0;
	});
	const container = document.createElement("div");
	Object.assign(container, {
		getAll: (selector: string) =>
			Array.from(container.querySelectorAll(selector)),
	});
	(filesApp[3] as (element: HTMLElement) => void)(container);
	container.innerHTML =
		'<div class="collapsible"><div data-type="dir" data-name="src"><span></span></div><div data-type="file" data-name="app.js"><span></span></div></div>';
	fileIcons.register({
		id: "images",
		pluginId: "test.plugin",
		icons: "file:///icons/",
		file: "file",
		folder: "folder",
		folderExpanded: "folder-open",
	});
	fileIcons.use("images", { persist: false });
	// Match the phone sidebar: it may refresh immediately before being attached.
	const show = sidebar.on.mock.calls.find(([event]) => event === "show")![1];
	show();
	document.body.append(container);
	expect(requests.length).toBeGreaterThan(0);
	for (const request of requests) request.onload?.();
	await Promise.resolve();
	expect(fileIcons.resolve("app.js").themeId).toBe("images");
	expect(container.querySelector('[data-type="file"] span')?.className).toBe(
		fileIcons.icon("app.js"),
	);
	expect(container.querySelector('[data-type="dir"] span')?.className).toBe(
		fileIcons.icon({ name: "src", kind: "folder", expanded: true }),
	);
	expect(container.querySelector(".hidden")).toBeNull();
});
