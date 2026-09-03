// `cordova.exec` is mapped asynchronously while Cordova starts. Importing this
// module can happen before that mapping completes, so use Cordova's internal
// module loader, which is available as soon as cordova.js has been evaluated.
const cordovaExec = cordova.require("cordova/exec");

const exec = (resolve, reject, action, args) =>
	cordovaExec(resolve, reject, "Tee", action, args);

let bridgeHardened = false;

function hardenBridge() {
	if (bridgeHardened) return;
	bridgeHardened = true;

	for (const prop of [
		"exec",
		"callbackFromNative",
		"callbackSuccess",
		"callbackError",
		"callbacks",
	]) {
		const value = cordova[prop];
		if (value === undefined) continue;
		try {
			Object.defineProperty(cordova, prop, {
				writable: false,
				configurable: false,
			});
		} catch {
			// ignore
		}
	}
}

class PluginContext {
	#token;

	constructor(token) {
		this.#token = token;
		this.date = Date.now();
		Object.freeze(this);
	}

	toString() {
		return this.#token;
	}

	[Symbol.toPrimitive](hint) {
		if (hint === "number") {
			return Number.NaN; // prevent numeric coercion
		}
		return this.#token;
	}

	grantedPermission(permission) {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "grantedPermission", [this.#token, permission]);
		});
	}

	listAllPermissions() {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "listAllPermissions", [this.#token]);
		});
	}

	getSecret(key, defaultValue = "") {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "get_secret", [this.#token, key, defaultValue]);
		});
	}

	setSecret(key, value) {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "set_secret", [this.#token, key, value]);
		});
	}

	deleteSecret(key) {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "delete_secret", [this.#token, key]);
		});
	}

	clearAllSecrets() {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "clear_all_secrets", [this.#token]);
		});
	}

	//plugins dont need to call this
	invalidate() {
		return new Promise((resolve, reject) => {
			exec(resolve, reject, "invalidate", [this.#token]);
		});
	}
}

Object.freeze(PluginContext.prototype);

// Encapsulates the trusted native session.
class TrustedSession {
	#session = null;
	#sessionPromise = null;

	// Establishes the connection (once) and resolves to a boolean. The session
	// secret is deliberately never returned to callers.
	connectInternal() {
		hardenBridge();

		if (!this.#sessionPromise) {
			this.#sessionPromise = new Promise((resolve) => {
				cordovaExec(
					(session) => {
						this.#session = session;
						resolve(true);
					},
					() => resolve(false),
					"Tee",
					"establishConnection",
					[],
				);
			});
		}
		return this.#sessionPromise;
	}

	async generateInternal(pluginId, pluginJson) {
		try {
			const connected = await this.connectInternal();
			if (!connected || !this.#session) {
				console.warn(
					`PluginContext creation failed for pluginId ${pluginId}: no trusted session`,
				);
				return null;
			}

			//requesting a token with our session since we are in a privileged context
			const uuid = await new Promise((resolve, reject) => {
				cordovaExec(resolve, reject, "Tee", "requestToken", [
					this.#session,
					pluginId,
					pluginJson,
				]);
			});
			return new PluginContext(uuid);
		} catch (err) {
			console.warn(
				`PluginContext creation failed for pluginId ${pluginId}:`,
				err,
			);
			return null;
		}
	}
}

const trustedSession = new TrustedSession();

export function connect() {
	return trustedSession.connectInternal();
}

export default function generate(pluginId, pluginJson) {
	return trustedSession.generateInternal(pluginId, pluginJson);
}
