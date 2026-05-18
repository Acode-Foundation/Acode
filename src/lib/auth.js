import toast from "components/toast";
import { addIntentHandler } from "handlers/intent";
import config from "./config";
import customTab from "./customTab";

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
		addIntentHandler(this.onIntentReceiver.bind(this));
		loginEvents.addListener(() => {
			clearImmediate(this.#loginTimeout);
			for (const callback of this.#loginCallbacks) {
				callback.resolve();
			}
			this.#loginCallbacks.clear();
		});
		document.addEventListener("resume", () => {
			this.#loginTimeout = setTimeout(() => {
				for (const callback of this.#loginCallbacks) {
					callback.reject("Login timed out");
				}

				this.#loginCallbacks.clear();
			}, 1000);
		});
	}

	async onIntentReceiver(event) {
		try {
			if (event?.module === "user" && event?.action === "login") {
				if (event?.value) {
					this.#exec("saveToken", [event.value]);
					toast("Logged in successfully");

					setTimeout(() => {
						loginEvents.emit();
					}, 500);
				}
			}
			return null;
		} catch (error) {
			console.error("Failed to parse intent token.", error);
			return null;
		}
	}

	/**
	 * Helper to wrap cordova.exec in a Promise
	 */
	#exec(action, args = []) {
		return new Promise((resolve, reject) => {
			cordova.exec(resolve, reject, "Authenticator", action, args);
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

	/**
	 *
	 * @returns {Promise<User>}
	 */
	async getLoggedInUser() {
		if (loggedInUser) return loggedInUser;

		try {
			const res = await fetch(`${config.API_BASE}/login`);

			if (res.ok) {
				loggedInUser = await res.json();
				localStorage.setItem(CACHE_USER_KEY, JSON.stringify(loggedInUser));
				clearTimeout(cacheTimeout);
				cacheTimeout = setTimeout(() => (loggedInUser = null), 600_000);
				return loggedInUser;
			}

			if (res.status === 401) {
				localStorage.removeItem(CACHE_USER_KEY);
				return null;
			}

			throw new Error("Unable to fetch user Info");
		} catch (error) {
			if (CACHE_USER_KEY in localStorage) {
				try {
					return JSON.parse(localStorage.getItem(CACHE_USER_KEY));
				} catch {}
			}
			toast("Unable to fetch user info");
			throw error;
		}
	}

	async login() {
		return new Promise((resolve, reject) => {
			customTab(`${config.BASE_URL}/login?redirect=app`).catch((err) => {
				console.error("Custom tab error", err);
				reject("Failed to open browser");
			});

			this.#loginCallbacks.add({ resolve, reject });
		});
	}
}

export default new AuthService();
export { loginEvents };
