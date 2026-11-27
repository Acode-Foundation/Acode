import JSZip from "jszip";
import { expect, it, vi } from "vitest";
import formatDownloadProgress from "../../src/lib/downloadProgress.js";
import { loadSourceModule } from "../helpers/loadSourceModule";

it.each([
	{ price: 0, owned: false },
	{ price: 2, owned: true },
])("installs iOS dependencies without billing: %j", async (manifest) => {
	const fixture = await setup("ios", manifest);
	await fixture.install("file:///parent.zip");
	expect(fixture.loaded.mock.calls).toEqual([
		["dependency", true],
		["parent", true],
	]);
	expect(
		fixture.files.get("file:///plugins/dependency/main.js"),
	).toBeInstanceOf(ArrayBuffer);
	expect(
		JSON.parse(fixture.files.get("file:///plugins/dependency/plugin.json")).id,
	).toBe("dependency");
	expect(fixture.download.mock.calls[0][0]).not.toContain("token=");
	for (const method of Object.values(fixture.iap))
		expect(method).not.toHaveBeenCalled();
});

it("rejects an unowned paid iOS dependency before downloading or billing", async () => {
	const fixture = await setup("ios", { price: 2, owned: false });
	await expect(fixture.install("file:///parent.zip")).rejects.toThrow(
		"product not available",
	);
	expect(fixture.download).not.toHaveBeenCalled();
	expect(fixture.loaded).not.toHaveBeenCalled();
	for (const method of Object.values(fixture.iap))
		expect(method).not.toHaveBeenCalled();
});

it("retains the Android purchase token when installing a paid dependency", async () => {
	const fixture = await setup("android", { price: 2, owned: false });
	await fixture.install("file:///parent.zip");
	expect(fixture.iap.getProducts).toHaveBeenCalledOnce();
	expect(fixture.iap.getPurchases).toHaveBeenCalledOnce();
	expect(fixture.download.mock.calls[0][0]).toContain("&token=android-token");
	expect(fixture.loaded).toHaveBeenCalledWith("parent", true);
});

async function setup(platformId, manifest) {
	const platform = loadSourceModule(
		"src/lib/platform.js",
		{},
		{ Bridge: { platformId } },
	).default;
	const dependency = {
		id: "dependency",
		sku: "dependency",
		name: "Dependency",
		main: "main.js",
		version: "1.0.0",
		...manifest,
	};
	const parentZip = new JSZip();
	parentZip.file(
		"plugin.json",
		JSON.stringify({
			id: "parent",
			main: "main.js",
			dependencies: ["dependency"],
		}),
	);
	parentZip.file("main.js", "");
	const dependencyZip = new JSZip();
	dependencyZip.file("plugin.json", JSON.stringify(dependency));
	dependencyZip.file("main.js", "// dependency fixture");
	const parentBytes = await parentZip.generateAsync({ type: "uint8array" });
	const dependencyBytes = await dependencyZip.generateAsync({
		type: "uint8array",
	});
	const files = new Map([
		["file:///plugins", null],
		["file:///parent.zip", parentBytes],
	]);
	const download = vi.fn(async () => dependencyBytes);
	const join = (...parts) =>
		parts.reduce(
			(parent, child) =>
				`${parent.replace(/\/$/, "")}/${child.replace(/^\/+/, "")}`,
		);
	const fsOperation = (...parts) => {
		const url = join(...parts);
		return {
			exists: async () => files.has(url),
			readFile: async () => {
				if (url === "https://fixture.invalid/plugin/dependency")
					return dependency;
				if (url.startsWith("https://fixture.invalid/plugin/download/"))
					return download(url);
				if (!files.has(url)) throw new Error(`Missing fixture: ${url}`);
				return files.get(url);
			},
			createDirectory: async (name) => files.set(join(url, name), null),
			createFile: async (name) => files.set(join(url, name), ""),
			writeFile: async (data) => files.set(url, data),
			delete: async () => files.delete(url),
			lsDir: async () => [],
		};
	};
	const iap = {
		getProducts: vi.fn((ids, success) =>
			success([{ productId: "dependency" }]),
		),
		getPurchases: vi.fn((success) =>
			success([{ productIds: ["dependency"], purchaseToken: "android-token" }]),
		),
		purchase: vi.fn(),
		setPurchaseUpdatedListener: vi.fn(),
	};
	const loaded = vi.fn();
	const install = loadSourceModule(
		"src/lib/installPlugin.js",
		{
			fileSystem: fsOperation,
			"dialogs/alert": vi.fn(),
			"dialogs/confirm": async () => true,
			"dialogs/loader": {
				create: () => ({ show() {}, setMessage() {}, destroy() {} }),
			},
			"handlers/purchase": vi.fn(),
			jszip: JSZip,
			"utils/helpers": {
				promisify: (method, ...args) =>
					new Promise((resolve, reject) => method(...args, resolve, reject)),
			},
			"utils/Url": { join },
			"utils/version": { isVersionGreater: () => true },
			"./config": { API_BASE: "https://fixture.invalid" },
			"./downloadProgress": formatDownloadProgress,
			"./installState": {
				new: async () => ({
					exists: () => false,
					isUpdated: async () => true,
					save: async () => {},
					clear: async () => {},
				}),
			},
			"./loadPlugins": { loadPluginWithTimeout: loaded },
			"./platform": platform,
		},
		{
			PLUGIN_DIR: "file:///plugins",
			DATA_STORAGE: "file:///",
			iap,
			device: { uuid: "fixture", version: "18.6" },
			BuildInfo: { packageName: "com.foxdebug.acode" },
			window: { log: vi.fn() },
			strings: new Proxy({}, { get: (target, key) => key }),
		},
	).default;
	return { install, files, download, loaded, iap };
}
