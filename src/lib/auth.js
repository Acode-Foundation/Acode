import toast from "components/toast";
import { addIntentHandler } from "handlers/intent";

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
					this._exec("saveToken", [event.value]);
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
	_exec(action, args = []) {
		return new Promise((resolve, reject) => {
			cordova.exec(resolve, reject, "Authenticator", action, args);
		});
	}

	async openLoginUrl() {
		const url = "https://acode.app/login?redirect=app";

		try {
			await new Promise((resolve, reject) => {
				CustomTabs.open(url, { showTitle: true }, resolve, reject);
			});
		} catch (error) {
			console.error("CustomTabs failed, opening system browser.", error);
			system.openInBrowser(url);
		}
	}

	async logout() {
		try {
			await this._exec("logout");
			return true;
		} catch (error) {
			console.error("Failed to logout.", error);
			return false;
		}
	}

	async isLoggedIn() {
		try {
			// Native checks EncryptedPrefs and validates with API internally
			await this._exec("isLoggedIn");
			return true;
		} catch (error) {
			console.error(error);
			// error is typically the status code (0 if no token, 401 if invalid)
			return false;
		}
	}

	async getUserInfo() {
		try {
			const data = await this._exec("getUserInfo");
			return typeof data === "string" ? JSON.parse(data) : data;
		} catch (error) {
			console.error("Failed to fetch user data.", error);
			return null;
		}
	}

	async getAvatar() {
		try {
			const userData = await this.getUserInfo();
			if (!userData) return null;

			if (userData.github) {
				return `https://avatars.githubusercontent.com/${userData.github}`;
			}

			if (userData.name) {
				return this._generateInitialsAvatar(userData.name);
			}

			return null;
		} catch (error) {
			console.error("Failed to get avatar", error);
			return null;
		}
	}

	_generateInitialsAvatar(name) {
		const nameParts = name.split(" ");
		const initials =
			nameParts.length >= 2
				? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
				: nameParts[0][0].toUpperCase();

		const canvas = document.createElement("canvas");
		canvas.width = 100;
		canvas.height = 100;
		const ctx = canvas.getContext("2d");

		const colors = [
			"#2196F3",
			"#9C27B0",
			"#E91E63",
			"#009688",
			"#4CAF50",
			"#FF9800",
		];
		ctx.fillStyle =
			colors[
				name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
					colors.length
			];
		ctx.fillRect(0, 0, 100, 100);

		ctx.fillStyle = "#ffffff";
		ctx.font = "bold 40px Arial";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(initials, 50, 50);

		return canvas.toDataURL();
	}
}

export default new AuthService();
export { loginEvents };
