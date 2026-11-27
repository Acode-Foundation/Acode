import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup() {
	const scripts = [];
	const eruda = {
		init: vi.fn(),
		destroy: vi.fn(),
		get: () => null,
		_shadowRoot: { querySelector: () => ({ style: {} }) },
	};
	const window = { toast: vi.fn() };
	const document = {
		createElement: () => {
			const script = { remove: vi.fn() };
			scripts.push(script);
			return script;
		},
		head: { appendChild: () => {} },
		getElementById: () => null,
	};
	const discardStartupLogs = vi.fn();
	const { default: devTools } = loadSourceModule(
		"src/lib/devTools.js",
		{
			fileSystem: {
				__esModule: true,
				default: () => ({ exists: async () => true }),
			},
			"dialogs/loader": { __esModule: true, default: {} },
			"utils/helpers": {
				__esModule: true,
				default: { toInternalUri: async (url) => url },
			},
			"utils/Url": {
				__esModule: true,
				default: { join: (...p) => p.join("/") },
			},
			"./config": { __esModule: true, default: {} },
			"./startupLogBuffer": {
				discardStartupLogs,
				takeStartupLogs: () => [],
			},
		},
		{ window, document, DATA_STORAGE: "data", strings: {} },
	);
	const waitForScript = async () => {
		for (let i = 0; i < 100 && !scripts.at(-1)?.onload; i++) {
			await new Promise((resolve) => setTimeout(resolve));
		}
	};
	/** Finishes loading the latest eruda script. */
	const finishScript = async () => {
		await waitForScript();
		window.eruda = eruda;
		scripts.at(-1).onload();
		await new Promise((resolve) => setTimeout(resolve));
	};
	return {
		devTools,
		eruda,
		window,
		scripts,
		waitForScript,
		finishScript,
		discardStartupLogs,
	};
}

it("does not activate Eruda when developer mode is turned off while it loads", async () => {
	const f = setup();
	const pending = f.devTools.init();
	await f.waitForScript();
	f.devTools.destroy();
	await f.finishScript();
	await pending;

	expect(f.eruda.init).not.toHaveBeenCalled();
	expect(f.devTools.isInitialized).toBe(false);
	expect(f.scripts[0].remove).toHaveBeenCalled();
	expect(f.discardStartupLogs).toHaveBeenCalled();
	await f.devTools.show();
	expect(f.window.toast).toHaveBeenCalledWith("Developer mode is not enabled");
});

it("can be enabled again after a cancelled initialization", async () => {
	const f = setup();
	const cancelled = f.devTools.init();
	f.devTools.destroy();
	const enabled = f.devTools.init();
	await f.finishScript();
	await Promise.all([cancelled, enabled]);

	// The cancelled run stops before loading a script of its own.
	expect(f.scripts).toHaveLength(1);
	expect(f.eruda.init).toHaveBeenCalledOnce();
	expect(f.devTools.isInitialized).toBe(true);
});
