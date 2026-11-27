// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sidebar = vi.hoisted(() => ({
	show: vi.fn(),
	hide: vi.fn(),
}));

const settings = vi.hoisted(() => ({
	value: { showSponsorSidebarApp: false },
	on: vi.fn(),
}));

const instances = vi.hoisted(() => []);

vi.mock("components/sidebar", () => ({ default: sidebar }));
vi.mock("lib/settings", () => ({ default: settings }));
vi.mock("pages/sponsors", () => ({ default: vi.fn() }));
vi.mock("../../src/sidebarApps/sidebarApp.js", () => ({
	default: class SidebarApp {
		static init = vi.fn();

		constructor(icon, id, title, init, onSelected) {
			this.id = id;
			this.container = document.createElement("div");
			this.install = vi.fn();
			this.remove = vi.fn();
			this.active = false;
			instances.push(this);
		}
	},
}));

let sidebarApps;

beforeEach(async () => {
	vi.resetModules();
	localStorage.clear();
	instances.length = 0;
	sidebarApps = (await import("../../src/sidebarApps/index.js")).default;
	const icons = document.createElement("div");
	sidebarApps.init({
		get: vi.fn(() => icons),
	});
});

afterEach(() => {
	vi.clearAllMocks();
	document.body.replaceChildren();
});

it("opens the sidebar and activates the requested app", () => {
	sidebarApps.add("folder", "files", "Files");
	sidebarApps.add("extension", "extensions", "Extensions");

	expect(sidebarApps.open("extensions")).toBe(true);
	expect(sidebar.show).toHaveBeenCalledOnce();
	expect(instances.map((app) => app.active)).toEqual([false, true]);
	expect(localStorage.getItem("sidebarAppsLastSection")).toBe("extensions");
});

it("opens the current app when no app id is supplied", () => {
	sidebarApps.add("folder", "files", "Files");

	expect(sidebarApps.open()).toBe(true);
	expect(sidebar.show).toHaveBeenCalledOnce();
	expect(instances[0].active).toBe(true);
});

it("does not open the sidebar for an unknown app", () => {
	sidebarApps.add("folder", "files", "Files");

	expect(sidebarApps.open("missing")).toBe(false);
	expect(sidebar.show).not.toHaveBeenCalled();
	expect(instances[0].active).toBe(true);
});

it("closes the sidebar without changing the active app", () => {
	sidebarApps.add("folder", "files", "Files");

	expect(sidebarApps.close()).toBe(true);
	expect(sidebar.hide).toHaveBeenCalledOnce();
	expect(instances[0].active).toBe(true);
});
