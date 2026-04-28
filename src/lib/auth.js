import toast from "components/toast";
import { addIntentHandler } from "handlers/intent";
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
	on(callback) {
		this.listeners.add(callback);
	},
	off(callback) {
		this.listeners.delete(callback);
	},
};

class AuthService {
	constructor() {
		addIntentHandler(this.onIntentReceiver.bind(this));
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
	 * @returns {User}
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
}

export default new AuthService();
export { loginEvents };
