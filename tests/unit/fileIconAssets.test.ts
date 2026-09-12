// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fileIcons from "lib/fileIcons";

const requests: FakeImage[] = [];
class FakeImage {
	src = "";
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() {
		requests.push(this);
	}
}
beforeEach(() => {
	vi.stubGlobal("Image", FakeImage);
	vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
		queueMicrotask(fn);
		return 0;
	});
});
afterEach(() => {
	fileIcons.resetForTests();
	requests.length = 0;
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const pack = (id = "pack") => ({
	id,
	pluginId: "test.plugin",
	icons: "file:///icons/",
	fileExtensions: { js: "js" },
	folder: "closed",
	folderExpanded: "open",
});

describe("icon assets", () => {
	it("loads only resolved assets of the active theme, sharing requests", () => {
		fileIcons.register(pack());
		expect(document.querySelector("style[data-file-icon]")).toBeNull();
		expect(requests).toHaveLength(0);
		fileIcons.use("pack", { persist: false });
		expect(requests).toHaveLength(0);
		expect(fileIcons.resolve("a.js").themeId).toBe("builtin");
		fileIcons.resolve("b.js");
		expect(requests).toHaveLength(1);
		requests[0].onload?.();
		expect(fileIcons.resolve("a.js").themeId).toBe("pack");
	});

	it("keeps a visible fallback after failure and reports it once", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		fileIcons.register(pack());
		fileIcons.use("pack", { persist: false });
		fileIcons.resolve("a.js");
		requests[0].onerror?.();
		expect(fileIcons.resolve("a.js").themeId).toBe("builtin");
		fileIcons.resolve("a.js");
		expect(requests).toHaveLength(1);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("uses the closed asset when the expanded asset fails", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		fileIcons.register(pack());
		fileIcons.use("pack", { persist: false });
		fileIcons.resolve({ kind: "folder", name: "src", expanded: true });
		requests.find((r) => r.src.endsWith("open.svg"))!.onerror?.();
		requests.find((r) => r.src.endsWith("closed.svg"))!.onload?.();
		expect(
			fileIcons.resolve({ kind: "folder", name: "src", expanded: true }).iconId,
		).toBe("closed");
	});

	it("ignores stale asset completion after theme replacement", () => {
		fileIcons.register(pack());
		fileIcons.use("pack", { persist: false });
		fileIcons.resolve("a.js");
		const old = requests[0];
		fileIcons.register({ ...pack(), icons: "file:///replacement/" });
		old.onload?.();
		expect(fileIcons.resolve("a.js").themeId).toBe("builtin");
		expect(requests.at(-1)?.src).toBe("file:///replacement/js.svg");
	});

	it("updates a recycled row using its current filename", async () => {
		fileIcons.register(pack());
		fileIcons.use("pack", { persist: false });
		document.body.innerHTML =
			'<div data-type="file" data-name="a.js"><span></span></div>';
		fileIcons.refreshRenderedIcons();
		const tile = document.body.firstElementChild as HTMLElement;
		tile.dataset.name = "notes.txt";
		requests[0].onload?.();
		await Promise.resolve();
		expect(tile.firstElementChild?.className).toBe(fileIcons.icon("notes.txt"));
	});

	it("uses distinct CSS classes for IDs that previously collided", () => {
		fileIcons.register({
			id: "ids",
			pluginId: "test.plugin",
			icons: {
				"foo.bar": { src: "file:///a.svg" },
				"foo-bar": { src: "file:///b.svg" },
			},
			fileNames: { a: "foo.bar", b: "foo-bar" },
		});
		fileIcons.use("ids", { persist: false });
		fileIcons.resolve("a");
		fileIcons.resolve("b");
		for (const request of requests) request.onload?.();
		expect(fileIcons.icon("a")).not.toBe(fileIcons.icon("b"));
	});

	it("exposes only the supported plugin surface", () => {
		expect(
			Object.keys(
				fileIcons.bindPlugin(document.createElement("script"), "test.plugin"),
			),
		).toEqual(["register", "icon", "onChange"]);
	});
});
