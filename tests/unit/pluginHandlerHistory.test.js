import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * @param {Record<string, number | null>} plugins load time in ms per plugin,
 * or null for one that never finishes
 */
function setup(plugins) {
	const markHandledExtensionsKnown = vi.fn();
	const module = loadSourceModule(
		"src/lib/loadPlugins.js",
		{
			"../fileSystem": {
				__esModule: true,
				default: () => ({
					lsDir: async () => Object.keys(plugins).map((id) => ({ url: id })),
				}),
			},
			"../utils/Url": {
				__esModule: true,
				default: { basename: (url) => url },
			},
			"./fileTypeHandler": {
				__esModule: true,
				default: { markHandledExtensionsKnown },
			},
			"./loadPlugin": {
				__esModule: true,
				default: (id) =>
					new Promise((resolve) => {
						if (plugins[id] !== null) setTimeout(resolve, plugins[id]);
					}),
			},
			"./settings": {
				__esModule: true,
				default: {
					value: { appTheme: "dark", pluginsDisabled: {} },
					update: async () => {},
				},
			},
		},
		{
			setTimeout,
			// Every acode hook used by the loader is a no-op here.
			acode: new Proxy({}, { get: () => () => {} }),
			toast: () => {},
			strings: {},
			PLUGIN_DIR: "plugins",
			window: { log: () => {} },
		},
	);
	return { loadPlugins: module.default, markHandledExtensionsKnown };
}

it("records handler history once every plugin has loaded", async () => {
	const f = setup({ fast: 100, other: 300 });
	const loading = f.loadPlugins();
	await vi.advanceTimersByTimeAsync(300);
	await loading;
	expect(f.markHandledExtensionsKnown).toHaveBeenCalledOnce();
});

it("waits for a plugin that outlives the load timeout before recording", async () => {
	const f = setup({ fast: 100, slow: 20000 });
	const loading = f.loadPlugins();
	await vi.advanceTimersByTimeAsync(15000);
	await loading;
	// Startup moved on, but the slow plugin may still register a handler.
	expect(f.markHandledExtensionsKnown).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(5000);
	expect(f.markHandledExtensionsKnown).toHaveBeenCalledOnce();
});

it("leaves the history unset while a plugin never finishes loading", async () => {
	const f = setup({ fast: 100, stuck: null });
	const loading = f.loadPlugins();
	await vi.advanceTimersByTimeAsync(15000);
	await loading;
	await vi.advanceTimersByTimeAsync(120000);
	expect(f.markHandledExtensionsKnown).not.toHaveBeenCalled();
});
