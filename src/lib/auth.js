import config from "./config";
import { maskCredential, unmaskCredential } from "../security/security";

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

/** 
 * Clones the user object structure and masks sensitive string properties
 * to protect them in memory.
 */
function secureUserObject(user) {
	if (!user) return null;
    
	const secured = { ...user }; 
	
	// Array with String Properties of Object
    const textProperties = [
		"name", "role", "email", "github", "website",
		"avatar_url", "pro_purchased_at", "created_at", "updated_at"
	];

	// Apply the Mask
	textProperties.forEach(prop => {
		if (typeof secured[prop] === "string") {
			secured[prop] = maskCredential(secured[prop]);
		}
	});

	return secured;
}



/** Function to unmask the user object properties
 * so the interface can read them safely without crashing.
 */
export function getDecryptedUser(user) {
	if (!user) return null;
	const decrypted = { ...user };

	const textProperties = [
		"name", "role", "email", "github", "website",
		"avatar_url", "pro_purchased_at", "created_at", "updated_at"
	];

	textProperties.forEach(prop => {
		if (Array.isArray(decrypted[prop])) {
			decrypted[prop] = unmaskCredential(decrypted[prop]);
		}
	});

	return decrypted;
}

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
		document.addEventListener("resume", () => {
			clearTimeout(this.#loginTimeout);
			this.#loginTimeout = setTimeout(() => {
				for (const callback of this.#loginCallbacks) {
					callback.reject("Login timed out");
				}

				this.#loginCallbacks.clear();
			}, LOGIN_RESUME_TIMEOUT_MS);
		});
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
	 * @param {boolean} forceFetch
	 * @returns {Promise<User>}
	 */
	async getLoggedInUser(forceFetch = false) {
		if (loggedInUser && !forceFetch) return getDecryptedUser(loggedInUser);

		try {
			const res = await fetch(`${config.API_BASE}/login`);

			if (res.ok) {
		       const rawuser = await res.json();
			   loggedInUser = secureUserObject(rawuser);
			   localStorage.setItem(CACHE_USER_KEY, JSON.stringify(loggedInUser));
			   clearTimeout(cacheTimeout);
			   cacheTimeout = setTimeout(() => (loggedInUser = null), 600_000);
			   return getDecryptedUser(loggedInUser);
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
			console.error("Unable to fetch user info:", error);
			throw error;
		}
	}

	async login() {
		return new Promise((resolve, reject) => {
			const callback = { resolve, reject };
			this.#loginCallbacks.add(callback);
			this.#exec("login", [
				{
					baseUrl: config.BASE_URL,
					appVersionCode: window.BuildInfo?.versionCode || 0,
				},
			])
				.then(() => {
					loginEvents.emit();
				})
				.catch((err) => {
					console.error("Native login error", err);
					this.#loginCallbacks.delete(callback);
					reject("Failed to login");
				});
		});
	}
}

export default new AuthService();
export { loginEvents };
