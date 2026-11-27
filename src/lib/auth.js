import config from "./config";

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} name
 * @property {string} role
 * @property {string} email
 * @property {string} github
 * @property {string} website
 * @property {number} verified
 * @property {number} threshold
 * @property {number} acode_pro
 * @property {number} github_id
 * @property {number} google_id
 * @property {string} avatar_url
 * @property {string} pro_purchased_at
 * @property {string} created_at
 * @property {string} updated_at
 * @property {boolean} isAdmin
 */

/**@type {User|null} */
let loggedInUser = null;
/**@type {number} */
let cacheTimeout = null;

const CACHE_USER_KEY = "cached-logged-in-user";
const LOGIN_RESUME_TIMEOUT_MS = 60_000;

const loginEvents = {
	listeners: new Set(),
	emit(data) {
		for (const listener of this.listeners) {
			listener(data);
		}
	},
	addListener(callback) {
		this.listeners.add(callback);
	},
	removeListener(callback) {
		this.listeners.delete(callback);
	},
};

class AuthService {
	#loginCallbacks = new Set();
	#loginTimeout = null;

	constructor() {
		loginEvents.addListener(() => {
			clearTimeout(this.#loginTimeout);
			for (const callback of this.#loginCallbacks) {
				callback.resolve();
			}
			this.#loginCallbacks.clear();
		});
		document.addEventListener("pause", () => {
			clearTimeout(this.#loginTimeout);
		});
		document.addEventListener("resume", () => {
			clearTimeout(this.#loginTimeout);
			if (!this.#loginCallbacks.size) return;
			// Browser sign-in can take minutes; only bound the handoff back to Acode.
			this.#loginTimeout = setTimeout(() => {
				for (const callback of this.#loginCallbacks) {
					callback.reject(new Error("Sign-in timed out. Please try again."));
				}

				this.#loginCallbacks.clear();
			}, LOGIN_RESUME_TIMEOUT_MS);
		});
	}

	/**
	 * Helper to wrap Bridge.exec in a Promise
	 */
	#exec(action, args = []) {
		return new Promise((resolve, reject) => {
			Bridge.exec(resolve, reject, "Authenticator", action, args);
		});
	}

	async logout() {
		try {
			const res = await fetch(`${config.API_BASE}/login`, {
				method: "DELETE",
			});
			if (!res.ok) {
				throw new Error("Unable to logout.");
			}
		} catch (error) {
			console.error("Error during logout:", error);
		}

		loggedInUser = null;
		localStorage.removeItem(CACHE_USER_KEY);

		try {
			await this.#exec("logout");
			return true;
		} catch (error) {
			console.error("Failed to logout.", error);
			return false;
		}
	}

	async openAccount() {
		await this.#exec("openAccount", [{ baseUrl: config.BASE_URL }]);
		return this.getLoggedInUser(true).catch(() => undefined);
	}

	/**
	 * @param {boolean} forceFetch
	 * @returns {Promise<User>}
	 */
	async getLoggedInUser(forceFetch = false) {
		if (loggedInUser && !forceFetch) return loggedInUser;

		try {
			const res = await fetch(`${config.API_BASE}/login`, {
				cache: "no-store",
			});

			if (res.ok) {
				loggedInUser = await res.json();
				localStorage.setItem(CACHE_USER_KEY, JSON.stringify(loggedInUser));
				clearTimeout(cacheTimeout);
				cacheTimeout = setTimeout(() => (loggedInUser = null), 600_000);
				return loggedInUser;
			}

			if (res.status === 401) {
				loggedInUser = null;
				clearTimeout(cacheTimeout);
				localStorage.removeItem(CACHE_USER_KEY);
				return null;
			}

			throw new Error("Unable to fetch user Info");
		} catch (error) {
			if (!forceFetch && CACHE_USER_KEY in localStorage) {
				try {
					return JSON.parse(localStorage.getItem(CACHE_USER_KEY));
				} catch {}
			}
			console.error("Unable to fetch user info:", error);
			throw error;
		}
	}

	async login() {
		return new Promise((resolve, reject) => {
			const callback = { resolve, reject };
			this.#loginCallbacks.add(callback);
			if (this.#loginCallbacks.size > 1) return;
			this.#exec("login", [
				{
					baseUrl: config.BASE_URL,
					appVersionCode: window.BuildInfo?.versionCode || 0,
				},
			])
				.then(() => {
					if (!this.#loginCallbacks.has(callback)) return;
					loggedInUser = null;
					clearTimeout(cacheTimeout);
					localStorage.removeItem(CACHE_USER_KEY);
					loginEvents.emit();
				})
				.catch((err) => {
					if (!this.#loginCallbacks.has(callback)) return;
					console.error("Native login error", err);
					clearTimeout(this.#loginTimeout);
					const error =
						err instanceof Error
							? err
							: new Error(String(err || "Sign-in failed. Please try again."));
					for (const pending of this.#loginCallbacks) pending.reject(error);
					this.#loginCallbacks.clear();
				});
		});
	}
}

export default new AuthService();
export { loginEvents };
