import fsOperation from "fileSystem";
import toast from "components/toast";
import { addIntentHandler } from "handlers/intent";
import constants from "./constants";

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

async function checkTokenFileExists() {
	return await fsOperation(`${DATA_STORAGE}.acode_token`).exists();
}

async function saveToken(token) {
	try {
		if (await checkTokenFileExists()) {
			await fsOperation(`${DATA_STORAGE}.acode_token`).writeFile(token);
		} else {
			await fsOperation(DATA_STORAGE).createFile(".acode_token", token);
		}
		return true;
	} catch (error) {
		console.error("Failed to save token", error);
		return false;
	}
}

async function getToken() {
	try {
		if (await checkTokenFileExists()) {
			const token = await fsOperation(`${DATA_STORAGE}.acode_token`).readFile(
				"utf8",
			);
			return token;
		}
		return null;
	} catch (error) {
		console.error("Failed to get token", error);
		return null;
	}
}

async function deleteToken() {
	try {
		if (await checkTokenFileExists()) {
			await fsOperation(`${DATA_STORAGE}.acode_token`).delete();
			return true;
		}
		return false;
	} catch (error) {
		console.error("Failed to delete token", error);
		return false;
	}
}

class AuthService {
	constructor() {
		addIntentHandler(this.onIntentReceiver.bind(this));
	}

	openLoginUrl() {
		try {
			system.openInBrowser("https://acode.app/login?redirect=app");
		} catch (error) {
			console.error("Failed while opening login page.", error);
		}
	}

	async onIntentReceiver(event) {
		try {
			if (event?.module === "user" && event?.action === "login") {
				if (event?.value) {
					saveToken(event.value);
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

	async logout() {
		try {
			const result = await deleteToken();
			return result;
		} catch (error) {
			console.error("Failed to logout.", error);
			return false;
		}
	}

	async isLoggedIn() {
		try {
			const token = await getToken();
			if (!token) return false;

			return new Promise((resolve, reject) => {
				cordova.plugin.http.sendRequest(
					`${constants.API_BASE}/login`,
					{
						method: "GET",
						headers: {
							"x-auth-token": token,
						},
					},
					(response) => {
						resolve(true);
					},
					async (error) => {
						if (error.status === 401) {
							await deleteToken();
							resolve(false);
						} else {
							console.error("Failed to check login status.", error);
							resolve(false);
						}
					},
				);
			});
		} catch (error) {
			console.error("Failed to check login status.", error);
			return false;
		}
	}

	async getUserInfo() {
		try {
			const token = await getToken();
			if (!token) return null;

			return new Promise((resolve, reject) => {
				cordova.plugin.http.sendRequest(
					`${constants.API_BASE}/login`,
					{
						method: "GET",
						headers: {
							"x-auth-token": token,
						},
					},
					async (response) => {
						if (response.status === 200) {
							resolve(JSON.parse(response.data));
						}
						resolve(null);
					},
					async (error) => {
						if (error.status === 401) {
							await deleteToken();
							resolve(null);
						} else {
							console.error("Failed to fetch user data.", error);
							resolve(null);
						}
					},
				);
			});
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
				const nameParts = userData.name.split(" ");
				let initials = "";

				if (nameParts.length >= 2) {
					initials = `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
				} else {
					initials = nameParts[0][0].toUpperCase();
				}

				// Create a data URL for text-based avatar
				const canvas = document.createElement("canvas");
				canvas.width = 100;
				canvas.height = 100;
				const ctx = canvas.getContext("2d");

				// Set background
				// Array of colors to choose from
				const colors = [
					"#2196F3",
					"#9C27B0",
					"#E91E63",
					"#009688",
					"#4CAF50",
					"#FF9800",
				];
				ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
				ctx.fillRect(0, 0, 100, 100);

				// Add text
				ctx.fillStyle = "#ffffff";
				ctx.font = "bold 40px Arial";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(initials, 50, 50);

				return canvas.toDataURL();
			}

			return null;
		} catch (error) {
			console.error("Failed to get avatar", error);
			return null;
		}
	}
}

export default new AuthService();
export { loginEvents };
