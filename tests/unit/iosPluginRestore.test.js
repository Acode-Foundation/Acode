import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

it("restores free and account-owned iOS plugins while reporting unavailable paid plugins", async () => {
	const fixture = setup("ios");
	await fixture.restore("file:///backup.json");
	expect(fixture.install.mock.calls).toEqual([
		["free", "Free", null],
		["owned", "Owned", null],
	]);
	expect(fixture.confirm).toHaveBeenCalledTimes(2);
	const summary = fixture.confirm.mock.calls[1][1];
	expect(summary).toContain("restored: 2");
	expect(summary).toContain("skipped: 1");
	expect(summary).toContain("unowned: paid plugin skipped");
	expect(fixture.alert).not.toHaveBeenCalled();
	expect(fixture.iap.getProducts).not.toHaveBeenCalled();
	expect(fixture.iap.getPurchases).not.toHaveBeenCalled();
});

it("keeps Android restore using store ownership even when the account reports ownership", async () => {
	const fixture = setup("android");
	await fixture.restore("file:///backup.json");
	expect(fixture.install.mock.calls).toEqual([
		["free", "Free", null],
		["owned", "Owned", "android-token"],
	]);
	expect(fixture.iap.getProducts).toHaveBeenCalledTimes(2);
	expect(fixture.iap.getPurchases).toHaveBeenCalledTimes(2);
	expect(fixture.confirm.mock.calls[1][1]).toContain(
		"unowned: paid plugin skipped",
	);
	expect(fixture.alert).not.toHaveBeenCalled();
});

function setup(platformId) {
	const platform = loadSourceModule(
		"src/lib/platform.js",
		{},
		{ Bridge: { platformId } },
	).default;
	const plugins = {
		free: { name: "Free", price: "0", sku: "free" },
		owned: { name: "Owned", price: "2", sku: "owned", owned: true },
		unowned: { name: "Unowned", price: "2", sku: "unowned", owned: false },
	};
	const install = vi.fn();
	const confirm = vi
		.fn()
		.mockResolvedValueOnce(true)
		.mockResolvedValueOnce(false);
	const alert = vi.fn();
	const iap = {
		getProducts: vi.fn((ids, success) =>
			success(ids.map((productId) => ({ productId }))),
		),
		getPurchases: vi.fn((success) =>
			success([{ productIds: ["owned"], purchaseToken: "android-token" }]),
		),
	};
	const backup = loadSourceModule(
		"src/settings/backupRestore.js",
		{
			fileSystem: (url) => ({
				readFile: async () => {
					if (url === "file:///backup.json")
						return JSON.stringify({ installedPlugins: Object.keys(plugins) });
					const id = url.replace("https://fixture.invalid/plugin/", "");
					if (!plugins[id]) throw new Error(`Unexpected file: ${url}`);
					return plugins[id];
				},
			}),
			"components/settingsPage": vi.fn(),
			"components/toast": vi.fn(),
			"dialogs/alert": alert,
			"dialogs/confirm": confirm,
			"dialogs/loader": {
				create: () => ({ show() {}, hide() {}, destroy() {}, setMessage() {} }),
			},
			"lib/config": { API_BASE: "https://fixture.invalid" },
			"lib/platform": platform,
			"lib/settings": {},
			"lib/installPlugin": install,
			"pages/fileBrowser": vi.fn(),
			"utils/helpers": {
				promisify: (method, ...args) =>
					new Promise((resolve, reject) => method(...args, resolve, reject)),
			},
			"utils/Uri": {},
			"utils/Url": { join: (...parts) => parts.join("/") },
		},
		{
			iap,
			strings: new Proxy(
				{ restore: { capitalize: () => "Restore" } },
				{ get: (target, key) => target[key] ?? key },
			),
		},
	).default;
	return { restore: backup.restore, install, confirm, alert, iap };
}
