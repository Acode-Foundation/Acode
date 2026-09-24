import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeBridge } = vi.hoisted(() => ({
	nativeBridge: {
		setMessageCallback: vi.fn(),
		capabilities: vi.fn(),
		create: vi.fn(),
		loadURL: vi.fn(),
		loadHTML: vi.fn(),
		evaluate: vi.fn(),
		postMessage: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		reload: vi.fn(),
		stopLoading: vi.fn(),
		goBack: vi.fn(),
		goForward: vi.fn(),
		canGoBack: vi.fn(),
		canGoForward: vi.fn(),
		clearCache: vi.fn(),
		clearHistory: vi.fn(),
		clearFormData: vi.fn(),
		setUserAgent: vi.fn(),
		getUserAgent: vi.fn(),
		updateSettings: vi.fn(),
		getSettings: vi.fn(),
		getInfo: vi.fn(),
		destroy: vi.fn(),
	},
}));

vi.mock("../../src/plugins/webview/www/webview", () => ({
	default: nativeBridge,
}));

const CAPABILITIES = {
	version: "2.0.0",
	multiProfile: true,
	deleteBrowsingData: true,
	documentStartScript: true,
	safeBrowsing: true,
	algorithmicDarkening: true,
};

const DEFAULT_OPTIONS = {
	mode: "hidden",
	title: "",
	visible: true,
	incognito: false,
	allowNavigation: true,
	allowDownloads: false,
	userAgent: null,
	userAgentMode: "default",
	javaScript: true,
	domStorage: true,
	databaseStorage: false,
	cacheMode: "default",
	mediaPlaybackRequiresUserGesture: true,
	loadImages: true,
	mixedContentMode: "never-allow",
	textZoom: 100,
	initialScale: 0,
	useWideViewPort: true,
	loadWithOverviewMode: true,
	supportZoom: true,
	builtInZoomControls: false,
	displayZoomControls: false,
	geolocation: false,
	safeBrowsing: true,
	algorithmicDarkening: "auto",
	acceptThirdPartyCookies: null,
	backgroundColor: null,
};

let webviewAPI;
let WebViewEvents;
let AcodeWebView;

/** Fresh module state per test: the registry is module-level. */
async function loadModule() {
	vi.resetModules();
	const module = await import("lib/webview");
	webviewAPI = module.default;
	WebViewEvents = module.WebViewEvents;
	AcodeWebView = module.AcodeWebView;
}

async function createInstance(options) {
	const instance = await webviewAPI.create(options);
	return instance;
}

function dispatch(payload) {
	const callback = nativeBridge.setMessageCallback.mock.calls.at(-1)?.[0];
	if (!callback) throw new Error("message callback was never registered");
	callback(payload);
}

beforeEach(async () => {
	vi.clearAllMocks();

	nativeBridge.capabilities.mockResolvedValue(CAPABILITIES);
	nativeBridge.create.mockImplementation(async (options = {}) => ({
		id: "wv_test",
		isolated: options.incognito === true,
		ready: true,
		options: { ...DEFAULT_OPTIONS, ...options },
		capabilities: CAPABILITIES,
	}));
	nativeBridge.evaluate.mockResolvedValue("result");
	nativeBridge.getUserAgent.mockResolvedValue("Agent/1.0");
	nativeBridge.getSettings.mockResolvedValue({ ...DEFAULT_OPTIONS });
	nativeBridge.getInfo.mockResolvedValue({
		id: "wv_test",
		mode: "hidden",
		incognito: false,
		isolated: false,
		destroyed: false,
		ready: true,
		url: "https://example.com",
		title: "Example",
		progress: 100,
		loading: false,
		canGoBack: true,
		canGoForward: false,
		userAgent: "Agent/1.0",
	});
	nativeBridge.updateSettings.mockImplementation(async (id, settings) => ({
		...DEFAULT_OPTIONS,
		...settings,
	}));
	nativeBridge.setUserAgent.mockImplementation(async (id, userAgent, mode) => ({
		...DEFAULT_OPTIONS,
		userAgent,
		userAgentMode: mode || DEFAULT_OPTIONS.userAgentMode,
	}));
	nativeBridge.goBack.mockResolvedValue(true);
	nativeBridge.goForward.mockResolvedValue(false);
	nativeBridge.canGoBack.mockResolvedValue(true);
	nativeBridge.canGoForward.mockResolvedValue(false);
	nativeBridge.destroy.mockResolvedValue(undefined);

	await loadModule();
});

describe("webview create", () => {
	it("resolves an instance with native defaults merged in", async () => {
		const instance = await createInstance({ mode: "fullscreen" });

		expect(instance).toBeInstanceOf(AcodeWebView);
		expect(instance.id).toBe("wv_test");
		expect(instance.options.mode).toBe("fullscreen");
		expect(instance.options.incognito).toBe(false);
		expect(instance.options.userAgentMode).toBe("default");
	});

	it("forwards only known options to the native layer", async () => {
		await createInstance({
			incognito: true,
			userAgentMode: "desktop",
			cacheMode: "no-cache",
			textZoom: 140,
			unknownOption: "ignored",
		});

		expect(nativeBridge.create).toHaveBeenCalledWith({
			incognito: true,
			userAgentMode: "desktop",
			cacheMode: "no-cache",
			textZoom: 140,
		});
	});

	it("rejects invalid enum options before touching native code", async () => {
		await expect(createInstance({ mode: "floating" })).rejects.toThrow(
			/Unsupported WebView mode/,
		);
		await expect(createInstance({ cacheMode: "sometimes" })).rejects.toThrow(
			/Unsupported WebView cacheMode/,
		);
		await expect(
			createInstance({ userAgentMode: "tablet" }),
		).rejects.toThrow(/Unsupported WebView userAgentMode/);
		await expect(createInstance({ mixedContentMode: "maybe" })).rejects.toThrow(
			/Unsupported WebView mixedContentMode/,
		);
		expect(nativeBridge.create).not.toHaveBeenCalled();
	});

	it("rejects non-canonical or reserved profile names instead of rewriting them", async () => {
		for (const profileName of [
			"foo bar",
			"foo+bar",
			"foo.bar",
			"a".repeat(65),
			"",
		]) {
			await expect(createInstance({ profileName })).rejects.toThrow(
				/Unsupported WebView profileName/,
			);
		}
		await expect(
			createInstance({ profileName: "acode_incognito_wv_test" }),
		).rejects.toThrow(/reserved/);
		expect(nativeBridge.create).not.toHaveBeenCalled();
	});

	it("forwards canonical profile names verbatim", async () => {
		await createInstance({ incognito: true, profileName: "my-profile_1" });

		expect(nativeBridge.create).toHaveBeenCalledWith({
			incognito: true,
			profileName: "my-profile_1",
		});
	});

	it("reports isolation metadata for fullscreen instances immediately", async () => {
		nativeBridge.create.mockResolvedValueOnce({
			id: "wv_fs",
			isolated: true,
			profileName: "acode_incognito_wv_fs",
			options: { ...DEFAULT_OPTIONS, mode: "fullscreen", incognito: true },
			capabilities: CAPABILITIES,
		});

		const instance = await createInstance({
			mode: "fullscreen",
			incognito: true,
		});

		expect(instance.isIsolated).toBe(true);
		expect(instance.profileName).toBe("acode_incognito_wv_fs");
	});

	it("clamps numeric settings", async () => {
		await createInstance({ textZoom: 9000, initialScale: -5 });

		expect(nativeBridge.create).toHaveBeenCalledWith({
			textZoom: 500,
			initialScale: 0,
		});
	});

	it("rejects non-object options", async () => {
		await expect(webviewAPI.create("nope")).rejects.toThrow(TypeError);
	});

	it("tolerates a native layer that returns just an id", async () => {
		nativeBridge.create.mockResolvedValueOnce("wv_legacy");

		const instance = await createInstance({ mode: "hidden" });

		expect(instance.id).toBe("wv_legacy");
		expect(instance.options.mode).toBe("hidden");
	});
});

describe("incognito", () => {
	it("exposes incognito and isolation state", async () => {
		const instance = await createInstance({ incognito: true });

		expect(instance.isIncognito).toBe(true);
		expect(instance.isIsolated).toBe(true);
	});

	it("reports when isolation is unavailable", async () => {
		nativeBridge.create.mockResolvedValueOnce({
			id: "wv_x",
			isolated: false,
			options: { ...DEFAULT_OPTIONS, incognito: true },
			capabilities: { ...CAPABILITIES, multiProfile: false },
		});

		const instance = await createInstance({ incognito: true });

		expect(instance.isIncognito).toBe(true);
		expect(instance.isIsolated).toBe(false);
		expect(instance.capabilities.multiProfile).toBe(false);
	});

	it("exposes the resolved profile name", async () => {
		nativeBridge.create.mockResolvedValueOnce({
			id: "wv_p",
			isolated: true,
			profileName: "acode_incognito_wv_p",
			options: { ...DEFAULT_OPTIONS, incognito: true },
			capabilities: CAPABILITIES,
		});

		const instance = await createInstance({ incognito: true });

		expect(instance.profileName).toBe("acode_incognito_wv_p");
	});
});

describe("user agent and settings", () => {
	it("sets a custom user agent", async () => {
		const instance = await createInstance();

		const settings = await instance.setUserAgent("Custom/2.0", "mobile");

		expect(nativeBridge.setUserAgent).toHaveBeenCalledWith(
			"wv_test",
			"Custom/2.0",
			"mobile",
		);
		expect(settings.userAgent).toBe("Custom/2.0");
	});

	it("reads the user agent", async () => {
		const instance = await createInstance();

		await expect(instance.getUserAgent()).resolves.toBe("Agent/1.0");
	});

	it("applies a validated batch of settings", async () => {
		const instance = await createInstance();

		const settings = await instance.configure({
			javaScript: false,
			cacheMode: "cache-only",
			textZoom: 300,
		});

		expect(nativeBridge.updateSettings).toHaveBeenCalledWith("wv_test", {
			javaScript: false,
			cacheMode: "cache-only",
			textZoom: 300,
		});
		expect(settings.textZoom).toBe(300);
	});

	it("rejects invalid settings values", async () => {
		const instance = await createInstance();

		await expect(instance.configure({ cacheMode: "whenever" })).rejects.toThrow(
			/Unsupported WebView cacheMode/,
		);
		expect(nativeBridge.updateSettings).not.toHaveBeenCalled();
	});
});

describe("navigation helpers", () => {
	it("passes headers and html options through", async () => {
		const instance = await createInstance();

		await instance.loadURL("https://example.com", { Authorization: "x" });
		await instance.loadHTML("<h1>hi</h1>", { baseUrl: "https://example.com" });

		expect(nativeBridge.loadURL).toHaveBeenCalledWith("wv_test", "https://example.com", {
			Authorization: "x",
		});
		expect(nativeBridge.loadHTML).toHaveBeenCalledWith("wv_test", "<h1>hi</h1>", {
			baseUrl: "https://example.com",
		});
	});

	it("returns whether goBack/goForward navigated", async () => {
		const instance = await createInstance();

		await expect(instance.goBack()).resolves.toBe(true);
		await expect(instance.goForward()).resolves.toBe(false);
	});

	it("refreshes history flags", async () => {
		const instance = await createInstance();

		await expect(instance.refreshHistory()).resolves.toEqual({
			canGoBack: true,
			canGoForward: false,
		});
		expect(instance.canGoBack).toBe(true);
		expect(instance.canGoForward).toBe(false);
	});

	it("passes includeDiskFiles to clearCache", async () => {
		const instance = await createInstance();

		await instance.clearCache(false);
		await instance.clearHistory();

		expect(nativeBridge.clearCache).toHaveBeenCalledWith("wv_test", false);
		expect(instance.canGoBack).toBe(false);
	});

	it("forwards a null user agent so presets can take over", async () => {
		const instance = await createInstance();

		await instance.setUserAgent(null, "desktop");

		expect(nativeBridge.setUserAgent).toHaveBeenCalledWith(
			"wv_test",
			null,
			"desktop",
		);
	});
});

describe("waitForLoad", () => {
	it("resolves when the main frame finishes", async () => {
		const instance = await createInstance();
		const loaded = instance.waitForLoad(1000);

		dispatch({
			id: "wv_test",
			event: "pageFinished",
			data: { url: "https://acode.app", title: "Acode" },
		});

		await expect(loaded).resolves.toEqual({
			url: "https://acode.app",
			title: "Acode",
		});
	});

	it("rejects on a main-frame load error but ignores subresources", async () => {
		const instance = await createInstance();
		const loaded = instance.waitForLoad(1000);

		dispatch({
			id: "wv_test",
			event: "resourceError",
			data: { url: "https://acode.app/x.png", isForMainFrame: false },
		});
		dispatch({
			id: "wv_test",
			event: "resourceError",
			data: { url: "https://acode.app", description: "net::ERR_FAILED" },
		});

		await expect(loaded).rejects.toThrow(/failed to load/);
	});

	it("rejects when the instance is destroyed while loading", async () => {
		const instance = await createInstance();
		const loaded = instance.waitForLoad(1000);

		await instance.destroy();

		await expect(loaded).rejects.toThrow(/closed before it finished loading/);
	});
});

describe("waitForReady", () => {
	it("is immediately ready when creation reported ready", async () => {
		const instance = await createInstance();

		expect(instance.ready).toBe(true);
		await expect(instance.waitForReady(50)).resolves.toBeUndefined();
	});

	it("waits for the ready event on a fullscreen instance", async () => {
		nativeBridge.create.mockResolvedValueOnce({
			id: "wv_fs_ready",
			ready: false,
			options: { ...DEFAULT_OPTIONS, mode: "fullscreen" },
			capabilities: CAPABILITIES,
		});
		nativeBridge.getInfo.mockResolvedValueOnce({
			id: "wv_fs_ready",
			mode: "fullscreen",
			ready: false,
			destroyed: false,
		});

		const instance = await createInstance({ mode: "fullscreen" });
		expect(instance.ready).toBe(false);

		const ready = instance.waitForReady(1000);
		dispatch({ id: "wv_fs_ready", event: "ready", data: { mode: "fullscreen" } });

		await expect(ready).resolves.toBeUndefined();
		expect(instance.ready).toBe(true);
	});

	it("rejects when the instance is destroyed before it is ready", async () => {
		nativeBridge.create.mockResolvedValueOnce({
			id: "wv_fs_dead",
			ready: false,
			options: { ...DEFAULT_OPTIONS, mode: "fullscreen" },
			capabilities: CAPABILITIES,
		});
		nativeBridge.getInfo.mockResolvedValueOnce({
			id: "wv_fs_dead",
			ready: false,
			destroyed: false,
		});

		const instance = await createInstance({ mode: "fullscreen" });
		const ready = instance.waitForReady(1000);

		await instance.destroy();

		await expect(ready).rejects.toThrow(/closed before it became ready/);
	});
});

describe("events", () => {
	it("dispatches events with (data, event) and updates state", async () => {
		const instance = await createInstance();
		const seen = [];
		instance.on(WebViewEvents.PAGE_FINISHED, (data, event) => {
			seen.push([data, event]);
		});

		dispatch({
			id: "wv_test",
			event: "pageFinished",
			data: { url: "https://acode.app", title: "Acode" },
		});

		expect(seen).toEqual([
			[{ url: "https://acode.app", title: "Acode" }, "pageFinished"],
		]);
		expect(instance.url).toBe("https://acode.app");
		expect(instance.title).toBe("Acode");
		expect(instance.loading).toBe(false);
	});

	it("tracks progress and history events", async () => {
		const instance = await createInstance();

		dispatch({ id: "wv_test", event: "progressChanged", data: { progress: 40 } });
		expect(instance.progress).toBe(40);
		expect(instance.loading).toBe(true);

		dispatch({
			id: "wv_test",
			event: "historyChanged",
			data: { canGoBack: true, canGoForward: true },
		});
		expect(instance.canGoBack).toBe(true);
		expect(instance.canGoForward).toBe(true);
	});

	it("supports once, off, wildcard and onAny listeners", async () => {
		const instance = await createInstance();
		const once = vi.fn();
		const specific = vi.fn();
		const any = vi.fn();

		instance.once(WebViewEvents.TITLE_CHANGED, once);
		instance.on(WebViewEvents.TITLE_CHANGED, specific);
		instance.onAny(any);

		dispatch({ id: "wv_test", event: "titleChanged", data: { title: "one" } });
		dispatch({ id: "wv_test", event: "titleChanged", data: { title: "two" } });

		expect(once).toHaveBeenCalledTimes(1);
		expect(specific).toHaveBeenCalledTimes(2);
		expect(any).toHaveBeenCalledTimes(2);
		expect(any).toHaveBeenLastCalledWith("titleChanged", { title: "two" });

		instance.off(WebViewEvents.TITLE_CHANGED, specific);
		instance.offAny(any);
		dispatch({ id: "wv_test", event: "titleChanged", data: { title: "three" } });

		expect(specific).toHaveBeenCalledTimes(2);
		expect(any).toHaveBeenCalledTimes(2);
	});

	it("removes a pending once listener by its original callback", async () => {
		const instance = await createInstance();
		const pending = vi.fn();

		instance.once(WebViewEvents.TITLE_CHANGED, pending);
		instance.off(WebViewEvents.TITLE_CHANGED, pending);
		dispatch({ id: "wv_test", event: "titleChanged", data: { title: "x" } });

		expect(pending).not.toHaveBeenCalled();
	});

	it("delivers parsed page messages", async () => {
		const instance = await createInstance();
		const messages = [];
		instance.onMessage((message) => messages.push(message));

		dispatch({ id: "wv_test", message: JSON.stringify({ hello: "world" }) });
		dispatch({ id: "wv_test", message: "plain text" });

		expect(messages).toEqual([{ hello: "world" }, "plain text"]);
	});

	it("emits local shown/hidden events", async () => {
		const instance = await createInstance({ mode: "fullscreen" });
		const shown = vi.fn();
		const hidden = vi.fn();
		instance.on(WebViewEvents.SHOWN, shown);
		instance.on(WebViewEvents.HIDDEN, hidden);

		await instance.show();
		await instance.hide();

		expect(shown).toHaveBeenCalledTimes(1);
		expect(hidden).toHaveBeenCalledTimes(1);
	});

	it("ignores events for unknown instances", async () => {
		await createInstance();

		expect(() =>
			dispatch({ id: "nope", event: "pageFinished", data: {} }),
		).not.toThrow();
	});
});

describe("closed and destroyed", () => {
	it("marks the instance destroyed on closed and notifies listeners first", async () => {
		const instance = await createInstance();
		const closed = vi.fn();
		instance.on(WebViewEvents.CLOSED, closed);

		dispatch({ id: "wv_test", event: "closed" });

		expect(closed).toHaveBeenCalledTimes(1);
		expect(instance.isDestroyed).toBe(true);
		expect(webviewAPI.get("wv_test")).toBe(null);
		await expect(instance.evaluate("1")).rejects.toThrow(
			"WebView has been destroyed",
		);
	});

	it("keeps the instance usable when native destruction fails", async () => {
		const instance = await createInstance();
		nativeBridge.destroy.mockRejectedValueOnce(new Error("native failure"));

		await expect(instance.destroy()).rejects.toThrow("native failure");
		await expect(instance.evaluate("1 + 1")).resolves.toBe("result");
		expect(nativeBridge.evaluate).toHaveBeenCalledWith("wv_test", "1 + 1");

		await expect(instance.destroy()).resolves.toBeUndefined();
		expect(nativeBridge.destroy).toHaveBeenCalledTimes(2);
	});

	it("marks the instance destroyed only after native destruction succeeds", async () => {
		const instance = await createInstance();

		await instance.destroy();

		await expect(instance.evaluate("1 + 1")).rejects.toThrow(
			"WebView has been destroyed",
		);
	});

	it("shares native destruction between concurrent callers", async () => {
		let resolveDestroy;
		nativeBridge.destroy.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveDestroy = resolve;
				}),
		);
		const instance = await createInstance();

		const firstDestroy = instance.destroy();
		const secondDestroy = instance.destroy();

		expect(nativeBridge.destroy).toHaveBeenCalledTimes(1);
		resolveDestroy();
		await expect(Promise.all([firstDestroy, secondDestroy])).resolves.toEqual([
			undefined,
			undefined,
		]);
		await expect(instance.evaluate("1 + 1")).rejects.toThrow(
			"WebView has been destroyed",
		);
	});
});

describe("registry", () => {
	it("lists, gets and destroys every instance", async () => {
		nativeBridge.create
			.mockResolvedValueOnce({
				id: "wv_a",
				options: { ...DEFAULT_OPTIONS },
				capabilities: CAPABILITIES,
			})
			.mockResolvedValueOnce({
				id: "wv_b",
				options: { ...DEFAULT_OPTIONS },
				capabilities: CAPABILITIES,
			});

		await createInstance();
		await createInstance();

		expect(webviewAPI.list()).toEqual(["wv_a", "wv_b"]);
		expect(webviewAPI.get("wv_a")).toBeInstanceOf(AcodeWebView);
		expect(webviewAPI.get("missing")).toBe(null);

		await webviewAPI.destroyAll();

		expect(nativeBridge.destroy).toHaveBeenCalledTimes(2);
		expect(webviewAPI.list()).toEqual([]);
	});

	it("caches plugin capabilities", async () => {
		const first = await webviewAPI.getCapabilities();
		const second = await webviewAPI.getCapabilities();

		expect(first.multiProfile).toBe(true);
		expect(second).toBe(first);
		expect(nativeBridge.capabilities).toHaveBeenCalledTimes(1);
	});
});
