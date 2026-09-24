import nativeBridge from "../plugins/webview/www/webview";

/**
 * Event names emitted by a WebView instance.
 *
 * Native events are asynchronous and carry a plain data object. The two
 * JS-local events ("shown", "hidden") are emitted after show()/hide() resolve.
 */
export const WebViewEvents = Object.freeze({
	// Page lifecycle
	PAGE_STARTED: "pageStarted",
	PAGE_COMMIT_VISIBLE: "pageCommitVisible",
	PAGE_FINISHED: "pageFinished",
	PROGRESS: "progressChanged",
	TITLE_CHANGED: "titleChanged",
	FAVICON_CHANGED: "faviconChanged",
	HISTORY_CHANGED: "historyChanged",
	SCROLL_CHANGED: "scrollChanged",
	RENDER_PROCESS_GONE: "renderProcessGone",
	READY: "ready",
	CLOSED: "closed",
	// Navigation
	NAVIGATION_REQUESTED: "navigationRequested",
	NAVIGATION_BLOCKED: "navigationBlocked",
	// Errors
	RESOURCE_ERROR: "resourceError",
	HTTP_ERROR: "httpError",
	SSL_ERROR: "sslError",
	// Page interaction
	CONSOLE_MESSAGE: "consoleMessage",
	JS_ALERT: "jsAlert",
	JS_CONFIRM: "jsConfirm",
	JS_PROMPT: "jsPrompt",
	JS_BEFORE_UNLOAD: "jsBeforeUnload",
	PERMISSION_REQUEST: "permissionRequest",
	GEOLOCATION_PERMISSION: "geolocationPermissionRequest",
	FULLSCREEN_CHANGED: "fullscreenChanged",
	WINDOW_REQUESTED: "windowRequested",
	// Downloads
	DOWNLOAD_REQUESTED: "downloadRequested",
	DOWNLOAD_STARTED: "downloadStarted",
	DOWNLOAD_FAILED: "downloadFailed",
	// JS-local
	SHOWN: "shown",
	HIDDEN: "hidden",
	DESTROYED: "destroyed",
});

export const WebViewModes = Object.freeze({
	FULLSCREEN: "fullscreen",
	HIDDEN: "hidden",
});

export const CacheModes = Object.freeze({
	DEFAULT: "default",
	NO_CACHE: "no-cache",
	CACHE_ONLY: "cache-only",
	CACHE_ELSE_NETWORK: "cache-else-network",
});

export const MixedContentModes = Object.freeze({
	NEVER_ALLOW: "never-allow",
	COMPATIBILITY: "compatibility",
	ALWAYS_ALLOW: "always-allow",
});

export const UserAgentModes = Object.freeze({
	DEFAULT: "default",
	MOBILE: "mobile",
	DESKTOP: "desktop",
});

export const AlgorithmicDarkeningModes = Object.freeze({
	AUTO: "auto",
	ON: "on",
	OFF: "off",
});

/** Events after which the native instance is gone and cannot be reused. */
const TERMINAL_EVENTS = new Set([
	WebViewEvents.CLOSED,
	WebViewEvents.RENDER_PROCESS_GONE,
]);

/** Settings accepted by create()/configure(). */
const SETTING_KEYS = [
	"userAgent",
	"userAgentMode",
	"javaScript",
	"domStorage",
	"databaseStorage",
	"cacheMode",
	"mediaPlaybackRequiresUserGesture",
	"loadImages",
	"mixedContentMode",
	"textZoom",
	"initialScale",
	"useWideViewPort",
	"loadWithOverviewMode",
	"supportZoom",
	"builtInZoomControls",
	"displayZoomControls",
	"geolocation",
	"safeBrowsing",
	"algorithmicDarkening",
	"acceptThirdPartyCookies",
	"backgroundColor",
];

/** Behavioural options accepted by create(). */
const BEHAVIOUR_KEYS = [
	"mode",
	"title",
	"visible",
	"incognito",
	"profileName",
	"allowNavigation",
	"allowDownloads",
];

const CREATE_KEYS = [...BEHAVIOUR_KEYS, ...SETTING_KEYS];

const MODES = Object.values(WebViewModes);
const CACHE_MODES = Object.values(CacheModes);
const MIXED_CONTENT_MODES = Object.values(MixedContentModes);
const USER_AGENT_MODES = Object.values(UserAgentModes);
const DARKENING_MODES = Object.values(AlgorithmicDarkeningModes);

const instances = new Map();
let messageCallbackRegistered = false;
let cachedCapabilities = null;

function ensureInit() {
	if (messageCallbackRegistered) return;
	messageCallbackRegistered = true;
	nativeBridge.setMessageCallback(dispatchNativePayload);
}

function dispatchNativePayload(payload) {
	if (!payload || typeof payload !== "object") return;

	const instance = instances.get(payload.id);
	if (!instance) return;

	if (payload.event) {
		instance._handleEvent(payload.event, payload.data);
		return;
	}

	if (payload.message !== undefined) {
		instance._handleMessage(payload.message);
	}
}

function assertOneOf(value, allowed, label) {
	if (allowed.includes(value)) return;
	throw new Error(
		`Unsupported WebView ${label}: "${value}". Use one of: ${allowed
			.map((entry) => `"${entry}"`)
			.join(", ")}.`,
	);
}

function clamp(value, min, max) {
	const number = Number(value);
	if (!Number.isFinite(number)) return min;
	return Math.min(max, Math.max(min, Math.round(number)));
}

/** Validates user input and keeps only options the native layer understands. */
function normalizeOptions(options) {
	if (options == null) return {};
	if (typeof options !== "object") {
		throw new TypeError("WebView options must be an object");
	}

	const normalized = {};
	for (const key of CREATE_KEYS) {
		if (options[key] !== undefined) normalized[key] = options[key];
	}

	if (normalized.mode !== undefined) {
		assertOneOf(normalized.mode, MODES, "mode");
	}
	if (normalized.userAgentMode !== undefined) {
		assertOneOf(normalized.userAgentMode, USER_AGENT_MODES, "userAgentMode");
	}
	if (normalized.cacheMode !== undefined) {
		assertOneOf(normalized.cacheMode, CACHE_MODES, "cacheMode");
	}
	if (normalized.mixedContentMode !== undefined) {
		assertOneOf(
			normalized.mixedContentMode,
			MIXED_CONTENT_MODES,
			"mixedContentMode",
		);
	}
	if (normalized.algorithmicDarkening !== undefined) {
		assertOneOf(
			normalized.algorithmicDarkening,
			DARKENING_MODES,
			"algorithmicDarkening",
		);
	}
	if (normalized.textZoom !== undefined) {
		normalized.textZoom = clamp(normalized.textZoom, 25, 500);
	}
	if (normalized.initialScale !== undefined) {
		normalized.initialScale = clamp(normalized.initialScale, 0, 1000);
	}
	if (normalized.profileName !== undefined && normalized.profileName !== null) {
		normalized.profileName = normalizeProfileName(normalized.profileName);
	}

	return normalized;
}

/**
 * Profile names are passed to the WebView provider verbatim. Rewriting them
 * would let distinct requests collide onto one shared profile, so invalid
 * names are rejected instead.
 */
function normalizeProfileName(profileName) {
	const name = String(profileName);
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
		throw new Error(
			`Unsupported WebView profileName: "${name}". Use 1-64 characters from A-Z, a-z, 0-9, "_" or "-".`,
		);
	}
	if (name.startsWith("acode_incognito_")) {
		throw new Error(
			`Unsupported WebView profileName: "${name}" uses the reserved "acode_incognito_" prefix.`,
		);
	}
	return name;
}

/** Normalizes a partial settings update passed to configure(). */
function normalizeSettings(settings) {
	if (settings == null) return {};
	if (typeof settings !== "object") {
		throw new TypeError("WebView settings must be an object");
	}

	const normalized = {};
	for (const key of SETTING_KEYS) {
		if (settings[key] !== undefined) normalized[key] = settings[key];
	}

	if (normalized.userAgentMode !== undefined) {
		assertOneOf(normalized.userAgentMode, USER_AGENT_MODES, "userAgentMode");
	}
	if (normalized.cacheMode !== undefined) {
		assertOneOf(normalized.cacheMode, CACHE_MODES, "cacheMode");
	}
	if (normalized.mixedContentMode !== undefined) {
		assertOneOf(
			normalized.mixedContentMode,
			MIXED_CONTENT_MODES,
			"mixedContentMode",
		);
	}
	if (normalized.algorithmicDarkening !== undefined) {
		assertOneOf(
			normalized.algorithmicDarkening,
			DARKENING_MODES,
			"algorithmicDarkening",
		);
	}
	if (normalized.textZoom !== undefined) {
		normalized.textZoom = clamp(normalized.textZoom, 25, 500);
	}
	if (normalized.initialScale !== undefined) {
		normalized.initialScale = clamp(normalized.initialScale, 0, 1000);
	}

	return normalized;
}

function parseMessage(message) {
	if (typeof message !== "string") return message;
	try {
		return JSON.parse(message);
	} catch (_) {
		return message;
	}
}

export class AcodeWebView {
	constructor(id, options = {}, capabilities = {}) {
		this.id = id;
		this.options = Object.freeze({ ...options });
		this.capabilities = Object.freeze({ ...capabilities });

		this._messageCallbacks = [];
		this._eventCallbacks = [];
		this._anyCallbacks = [];
		this._destroyed = false;
		this._destroyPromise = null;
		this._ready = false;
		this._settings = { ...options };
		this._state = {
			url: "",
			title: "",
			progress: 0,
			loading: false,
			canGoBack: false,
			canGoForward: false,
		};

		instances.set(id, this);
	}

	get isDestroyed() {
		return this._destroyed;
	}

	/** True once the native WebView exists (see waitForReady). */
	get ready() {
		return this._ready;
	}

	get isIncognito() {
		return this.options.incognito === true;
	}

	/** True when the instance runs in its own isolated WebView profile. */
	get isIsolated() {
		return this.options.isolated === true;
	}

	get profileName() {
		return this.options.profileName || null;
	}

	get url() {
		return this._state.url;
	}

	get title() {
		return this._state.title;
	}

	get progress() {
		return this._state.progress;
	}

	get loading() {
		return this._state.loading;
	}

	get canGoBack() {
		return this._state.canGoBack;
	}

	get canGoForward() {
		return this._state.canGoForward;
	}

	// ------------------------------------------------------------------
	// Navigation / content
	// ------------------------------------------------------------------

	async loadURL(url, headers) {
		this._checkDestroyed();
		await nativeBridge.loadURL(this.id, url, headers);
	}

	async loadHTML(html, options) {
		this._checkDestroyed();
		await nativeBridge.loadHTML(this.id, html, options);
	}

	async evaluate(js) {
		this._checkDestroyed();
		return await nativeBridge.evaluate(this.id, js);
	}

	async postMessage(message) {
		this._checkDestroyed();
		await nativeBridge.postMessage(this.id, message);
	}

	async reload() {
		this._checkDestroyed();
		await nativeBridge.reload(this.id);
	}

	async stopLoading() {
		this._checkDestroyed();
		await nativeBridge.stopLoading(this.id);
	}

	async goBack() {
		this._checkDestroyed();
		return await nativeBridge.goBack(this.id);
	}

	async goForward() {
		this._checkDestroyed();
		return await nativeBridge.goForward(this.id);
	}

	/** Re-reads history flags from the native WebView and updates state. */
	async refreshHistory() {
		this._checkDestroyed();
		const [back, forward] = await Promise.all([
			nativeBridge.canGoBack(this.id),
			nativeBridge.canGoForward(this.id),
		]);
		this._state.canGoBack = !!back;
		this._state.canGoForward = !!forward;
		return {
			canGoBack: this._state.canGoBack,
			canGoForward: this._state.canGoForward,
		};
	}

	/**
	 * Resolves once the native WebView exists. Hidden instances are ready by
	 * the time create() resolves; fullscreen instances become ready when their
	 * activity builds the WebView (which may be after show()). Rejects on
	 * close/destroy or timeout.
	 */
	async waitForReady(timeout = 15000) {
		this._checkDestroyed();
		if (this._ready) return;

		return new Promise((resolve, reject) => {
			let timer = null;

			const cleanup = () => {
				this.off(WebViewEvents.READY, onReady);
				this.off(WebViewEvents.CLOSED, onClosed);
				this.off(WebViewEvents.DESTROYED, onClosed);
				if (timer) clearTimeout(timer);
			};

			const settle = (error) => {
				cleanup();
				if (error) reject(error);
				else resolve();
			};

			const onReady = () => {
				this._ready = true;
				settle(null);
			};
			const onClosed = () =>
				settle(new Error("WebView closed before it became ready"));

			// Subscribe before the native probe: a "ready" event may already be
			// in flight, and it must not be lost between the check and the wait.
			this.on(WebViewEvents.READY, onReady);
			this.on(WebViewEvents.CLOSED, onClosed);
			this.on(WebViewEvents.DESTROYED, onClosed);

			if (timeout > 0) {
				timer = setTimeout(
					() =>
						settle(
							new Error("Timed out waiting for the WebView to become ready"),
						),
					timeout,
				);
			}

			// Hidden instances emit "ready" before the JS instance exists, so
			// the event above is not enough on its own.
			this.getInfo()
				.then((info) => {
					if (info && info.ready) {
						this._ready = true;
						settle(null);
					}
				})
				.catch(() => {
					// Destroyed while probing; the CLOSED/DESTROYED listener or
					// the timeout will settle the promise.
				});
		});
	}

	/**
	 * Resolves when the main frame finishes loading (the "pageFinished" event),
	 * or rejects on a main-frame load error, close/destroy, or timeout.
	 *
	 * Attach it *before* starting the navigation, because loadURL()/loadHTML()
	 * resolve as soon as the load is initiated:
	 *
	 *   const loaded = wv.waitForLoad();
	 *   await wv.loadURL("https://example.com");
	 *   await loaded; // now evaluate() sees the real document
	 */
	waitForLoad(timeout = 15000) {
		this._checkDestroyed();

		return new Promise((resolve, reject) => {
			let timer = null;

			const cleanup = () => {
				this.off(WebViewEvents.PAGE_FINISHED, onFinished);
				this.off(WebViewEvents.RESOURCE_ERROR, onError);
				this.off(WebViewEvents.CLOSED, onClosed);
				this.off(WebViewEvents.DESTROYED, onClosed);
				if (timer) clearTimeout(timer);
			};

			const settle = (error, value) => {
				cleanup();
				if (error) reject(error);
				else resolve(value);
			};

			const onFinished = (data) => settle(null, data);
			const onError = (data) => {
				// Ignore subresource failures (images, scripts, …).
				if (data && data.isForMainFrame === false) return;
				const detail = data?.description ? `: ${data.description}` : "";
				settle(new Error(`WebView failed to load${detail}`));
			};
			const onClosed = () =>
				settle(new Error("WebView closed before it finished loading"));

			this.on(WebViewEvents.PAGE_FINISHED, onFinished);
			this.on(WebViewEvents.RESOURCE_ERROR, onError);
			this.on(WebViewEvents.CLOSED, onClosed);
			this.on(WebViewEvents.DESTROYED, onClosed);

			if (timeout > 0) {
				timer = setTimeout(
					() =>
						settle(
							new Error("Timed out waiting for the WebView to finish loading"),
						),
					timeout,
				);
			}
		});
	}

	// ------------------------------------------------------------------
	// Visibility
	// ------------------------------------------------------------------

	async show() {
		this._checkDestroyed();
		await nativeBridge.show(this.id);
		this._dispatch(WebViewEvents.SHOWN);
	}

	async hide() {
		this._checkDestroyed();
		await nativeBridge.hide(this.id);
		this._dispatch(WebViewEvents.HIDDEN);
	}

	// ------------------------------------------------------------------
	// Data / settings
	// ------------------------------------------------------------------

	async clearCache(includeDiskFiles = true) {
		this._checkDestroyed();
		await nativeBridge.clearCache(this.id, includeDiskFiles);
	}

	async clearHistory() {
		this._checkDestroyed();
		await nativeBridge.clearHistory(this.id);
		this._state.canGoBack = false;
		this._state.canGoForward = false;
	}

	async clearFormData() {
		this._checkDestroyed();
		await nativeBridge.clearFormData(this.id);
	}

	/** Sets a custom user agent, or a preset via userAgentMode. */
	async setUserAgent(userAgent, mode) {
		this._checkDestroyed();
		this._settings = await nativeBridge.setUserAgent(this.id, userAgent, mode);
		return this._settings;
	}

	async getUserAgent() {
		this._checkDestroyed();
		return await nativeBridge.getUserAgent(this.id);
	}

	/** Applies a partial batch of WebSettings and resolves to the result. */
	async configure(settings) {
		this._checkDestroyed();
		this._settings = await nativeBridge.updateSettings(
			this.id,
			normalizeSettings(settings),
		);
		return this._settings;
	}

	async getSettings() {
		this._checkDestroyed();
		this._settings = await nativeBridge.getSettings(this.id);
		return this._settings;
	}

	/** Live snapshot: url, title, progress, history, isolation, UA, … */
	async getInfo() {
		this._checkDestroyed();
		const info = await nativeBridge.getInfo(this.id);
		if (info && typeof info === "object") {
			this._state.url = info.url ?? this._state.url;
			this._state.title = info.title ?? this._state.title;
			this._state.progress = info.progress ?? this._state.progress;
			this._state.loading = info.loading ?? this._state.loading;
			this._state.canGoBack = info.canGoBack ?? this._state.canGoBack;
			this._state.canGoForward = info.canGoForward ?? this._state.canGoForward;
		}
		return info;
	}

	// ------------------------------------------------------------------
	// Events
	// ------------------------------------------------------------------

	/**
	 * Subscribes to an event. The callback receives (data, eventName), and
	 * passing "*" subscribes to every event. Returns the instance for chaining.
	 */
	on(event, callback) {
		this._checkDestroyed();
		if (typeof callback !== "function") {
			throw new TypeError("WebView event callback must be a function");
		}
		this._eventCallbacks.push({ event, callback });
		return this;
	}

	off(event, callback) {
		this._eventCallbacks = this._eventCallbacks.filter(
			(entry) =>
				!(
					entry.event === event &&
					(entry.callback === callback || entry.callback._original === callback)
				),
		);
		return this;
	}

	/** Subscribes to a single dispatch of an event. */
	once(event, callback) {
		const wrapper = (data, name) => {
			this.off(event, wrapper);
			callback(data, name);
		};
		// Allow off(event, originalCallback) to remove a pending once listener.
		wrapper._original = callback;
		return this.on(event, wrapper);
	}

	/** Subscribes to every event; the callback receives (eventName, data). */
	onAny(callback) {
		this._checkDestroyed();
		if (typeof callback !== "function") {
			throw new TypeError("WebView event callback must be a function");
		}
		this._anyCallbacks.push(callback);
		return this;
	}

	offAny(callback) {
		this._anyCallbacks = this._anyCallbacks.filter((cb) => cb !== callback);
		return this;
	}

	/** Removes listeners for one event, or every listener when omitted. */
	removeAllListeners(event) {
		if (event === undefined) {
			this._eventCallbacks = [];
			this._anyCallbacks = [];
		} else {
			this._eventCallbacks = this._eventCallbacks.filter(
				(entry) => entry.event !== event,
			);
		}
		return this;
	}

	/** Receives messages posted by the hosted page via window.webview.postMessage. */
	onMessage(callback) {
		this._checkDestroyed();
		if (typeof callback === "function") {
			this._messageCallbacks.push(callback);
		}
		return this;
	}

	offMessage(callback) {
		this._messageCallbacks = this._messageCallbacks.filter(
			(cb) => cb !== callback,
		);
		return this;
	}

	// ------------------------------------------------------------------
	// Teardown
	// ------------------------------------------------------------------

	async destroy() {
		this._checkDestroyed();
		if (!this._destroyPromise) {
			this._destroyPromise = (async () => {
				await nativeBridge.destroy(this.id);
				this._destroyed = true;
				instances.delete(this.id);
				this._dispatch(WebViewEvents.DESTROYED);
				this._clearListeners();
			})();
		}

		try {
			await this._destroyPromise;
		} finally {
			this._destroyPromise = null;
		}
	}

	// ------------------------------------------------------------------
	// Internals
	// ------------------------------------------------------------------

	_handleEvent(event, data) {
		if (event === WebViewEvents.READY) {
			this._ready = true;
		}
		this._applyState(event, data);
		this._dispatch(event, data);

		if (TERMINAL_EVENTS.has(event)) {
			this._destroyed = true;
			instances.delete(this.id);
			this._clearListeners();
		}
	}

	_handleMessage(message) {
		const parsed = parseMessage(message);
		for (const callback of this._messageCallbacks.slice()) {
			try {
				callback(parsed);
			} catch (error) {
				console.error("WebView message callback error:", error);
			}
		}
	}

	_applyState(event, data) {
		const payload = data && typeof data === "object" ? data : {};
		switch (event) {
			case WebViewEvents.PAGE_STARTED:
				if (payload.url !== undefined) this._state.url = payload.url;
				this._state.loading = true;
				break;
			case WebViewEvents.PAGE_COMMIT_VISIBLE:
				if (payload.url !== undefined) this._state.url = payload.url;
				break;
			case WebViewEvents.PAGE_FINISHED:
				if (payload.url !== undefined) this._state.url = payload.url;
				if (payload.title !== undefined) this._state.title = payload.title;
				this._state.loading = false;
				this._state.progress = 100;
				break;
			case WebViewEvents.PROGRESS: {
				const progress = Number(payload.progress);
				if (Number.isFinite(progress)) {
					this._state.progress = progress;
					this._state.loading = progress < 100;
				}
				break;
			}
			case WebViewEvents.TITLE_CHANGED:
				if (payload.title !== undefined) this._state.title = payload.title;
				break;
			case WebViewEvents.HISTORY_CHANGED:
				if (payload.canGoBack !== undefined) {
					this._state.canGoBack = !!payload.canGoBack;
				}
				if (payload.canGoForward !== undefined) {
					this._state.canGoForward = !!payload.canGoForward;
				}
				break;
			case WebViewEvents.NAVIGATION_REQUESTED:
				if (payload.allowed && payload.url !== undefined) {
					this._state.url = payload.url;
				}
				break;
			default:
				break;
		}
	}

	_dispatch(event, data) {
		for (const entry of this._eventCallbacks.slice()) {
			if (entry.event !== event && entry.event !== "*") continue;
			try {
				entry.callback(data, event);
			} catch (error) {
				console.error("WebView event callback error:", error);
			}
		}

		for (const callback of this._anyCallbacks.slice()) {
			try {
				callback(event, data);
			} catch (error) {
				console.error("WebView event callback error:", error);
			}
		}
	}

	_clearListeners() {
		this._messageCallbacks = [];
		this._eventCallbacks = [];
		this._anyCallbacks = [];
	}

	_checkDestroyed() {
		if (this._destroyed) {
			throw new Error("WebView has been destroyed");
		}
	}
}

/**
 * Creates a WebView. Options are validated up front; the resolved set of
 * options (including native defaults) is available as instance.options.
 */
async function create(options = {}) {
	ensureInit();

	const normalized = normalizeOptions(options);
	const result = await nativeBridge.create(normalized);
	const resolved = typeof result === "string" ? { id: result } : result || {};
	const id = resolved.id;
	if (!id) {
		throw new Error("Native WebView creation did not return an id");
	}

	const nativeOptions = { ...normalized, ...(resolved.options || {}) };
	if (resolved.isolated !== undefined) {
		nativeOptions.isolated = resolved.isolated;
	}
	if (resolved.profileName) {
		nativeOptions.profileName = resolved.profileName;
	}

	const instance = new AcodeWebView(
		id,
		nativeOptions,
		resolved.capabilities || {},
	);
	instance._ready = resolved.ready === true;
	return instance;
}

/** Resolves the plugin's feature support (multi-profile, document-start, …). */
async function getCapabilities() {
	ensureInit();
	if (!cachedCapabilities) {
		cachedCapabilities = await nativeBridge.capabilities();
	}
	return cachedCapabilities;
}

const webviewAPI = {
	create,
	getCapabilities,
	/** Live instance for an id, or null when it no longer exists. */
	get(id) {
		return instances.get(id) || null;
	},
	/** Ids of all live instances. */
	list() {
		return Array.from(instances.keys());
	},
	/** Destroys every live instance, ignoring individual failures. */
	async destroyAll() {
		await Promise.allSettled(
			Array.from(instances.values()).map((instance) => instance.destroy()),
		);
	},
	AcodeWebView,
	events: WebViewEvents,
	modes: WebViewModes,
	cacheModes: CacheModes,
	mixedContentModes: MixedContentModes,
	userAgentModes: UserAgentModes,
	algorithmicDarkeningModes: AlgorithmicDarkeningModes,
};

export default webviewAPI;
