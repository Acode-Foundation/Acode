import nativeBridge from "../plugins/webview/www/webview";

let initialized = false;
const instances = new Map();

function ensureInit() {
	if (!initialized) {
		nativeBridge.setMessageCallback((payload) => {
			const { id, message, event, data } = payload;
			const instance = instances.get(id);
			if (!instance) return;

			if (event) {
				// Iterate a copy so callbacks can unsubscribe during dispatch.
				for (const entry of instance._eventCallbacks.slice()) {
					if (entry.event === event) {
						try {
							entry.callback(event, data);
						} catch (e) {
							console.error("WebView event callback error:", e);
						}
					}
				}

				// A fullscreen WebView closed by the user (or by hide()) is
				// gone natively; mark it destroyed so later calls fail fast
				// and its listeners can be garbage collected.
				if (event === "closed") {
					instance._destroyed = true;
					instances.delete(id);
					instance._messageCallbacks = [];
					instance._eventCallbacks = [];
				}
				return;
			}

			if (message !== undefined) {
				let parsed = message;
				try {
					parsed = JSON.parse(message);
				} catch (_) {}
				for (const cb of instance._messageCallbacks.slice()) {
					try {
						cb(parsed);
					} catch (e) {
						console.error("WebView message callback error:", e);
					}
				}
			}
		});
		initialized = true;
	}
}

class WebView {
	constructor(id, options = {}) {
		this.id = id;
		this.options = options;
		this._messageCallbacks = [];
		this._eventCallbacks = [];
		this._destroyed = false;

		instances.set(id, this);
	}

	async loadURL(url) {
		this._checkDestroyed();
		await nativeBridge.loadURL(this.id, url);
	}

	async loadHTML(html) {
		this._checkDestroyed();
		await nativeBridge.loadHTML(this.id, html);
	}

	async evaluate(js) {
		this._checkDestroyed();
		return await nativeBridge.evaluate(this.id, js);
	}

	onMessage(callback) {
		this._checkDestroyed();
		if (typeof callback === "function") {
			this._messageCallbacks.push(callback);
		}
	}

	offMessage(callback) {
		this._messageCallbacks = this._messageCallbacks.filter(
			(cb) => cb !== callback,
		);
	}

	on(event, callback) {
		this._checkDestroyed();
		if (typeof callback === "function") {
			this._eventCallbacks.push({ event, callback });
		}
	}

	off(event, callback) {
		this._eventCallbacks = this._eventCallbacks.filter(
			(entry) => !(entry.event === event && entry.callback === callback),
		);
	}

	async postMessage(message) {
		this._checkDestroyed();
		await nativeBridge.postMessage(this.id, message);
	}

	async show() {
		this._checkDestroyed();
		await nativeBridge.show(this.id);
	}

	async hide() {
		this._checkDestroyed();
		await nativeBridge.hide(this.id);
	}

	async reload() {
		this._checkDestroyed();
		await nativeBridge.reload(this.id);
	}

	async destroy() {
		this._checkDestroyed();
		await nativeBridge.destroy(this.id);
		this._destroyed = true;
		instances.delete(this.id);
		this._messageCallbacks = [];
		this._eventCallbacks = [];
	}

	_checkDestroyed() {
		if (this._destroyed) {
			throw new Error("WebView has been destroyed");
		}
	}
}

const webviewAPI = {
	async create(options = {}) {
		ensureInit();

		const mode = options.mode || "hidden";
		if (mode !== "fullscreen" && mode !== "hidden") {
			throw new Error(
				`Unsupported WebView mode: "${mode}". Use "fullscreen" or "hidden".`,
			);
		}

		const id = await nativeBridge.create({
			title: options.title || "",
			mode,
			allowNavigation: options.allowNavigation !== false,
			allowDownloads: options.allowDownloads === true,
			visible: options.visible !== false,
		});

		return new WebView(id, options);
	},
};

export default webviewAPI;
