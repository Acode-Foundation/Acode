import fsOperation from "fileSystem";
import Url from "utils/Url";

const INSTALL_STATE_STORAGE = Url.join(DATA_STORAGE, ".install-state");

export default class InstallState {
	/** @type Record<string, string> */
	store;
	/** @type Record<string, string> */
	updatedStore;

	/**
	 *
	 * @param {string} id
	 * @returns
	 */
	static async new(id) {
		try {
			const state = new InstallState();
			state.id = await checksumText(id);
			state.updatedStore = {};

			if (!(await fsOperation(INSTALL_STATE_STORAGE).exists())) {
				await fsOperation(DATA_STORAGE).createDirectory(".install-state");
			}

			state.storeUrl = Url.join(INSTALL_STATE_STORAGE, state.id);
			if (await fsOperation(state.storeUrl).exists()) {
				let raw = "{}";
				try {
					raw = await fsOperation(state.storeUrl).readFile("utf-8");
					state.store = JSON.parse(raw);
				} catch (err) {
					console.error(
						"InstallState: Failed to parse state file, deleting:",
						err,
					);
					// Delete corrupted state file to avoid parse errors such as 'Unexpected end of JSON'
					state.store = {};
					try {
						await fsOperation(state.storeUrl).delete();
						// Recreate a fresh empty file to keep invariant
						await fsOperation(INSTALL_STATE_STORAGE).createFile(state.id);
					} catch (writeErr) {
						console.error(
							"InstallState: Failed to recreate state file:",
							writeErr,
						);
					}
				}

				const patchedStore = {};
				for (const [key, value] of Object.entries(state.store)) {
					patchedStore[key.toLowerCase()] = value;
				}

				state.store = patchedStore;
			} else {
				state.store = {};
				await fsOperation(INSTALL_STATE_STORAGE).createFile(state.id);
			}

			return state;
		} catch (e) {
			console.error(e);
		}
	}

	/**
	 *
	 * @param {string} url
	 * @param {ArrayBuffer | string} content
	 * @param {boolean} isString
	 * @returns
	 */
	async isUpdated(url, content) {
		url = url.toLowerCase();
		const current = this.store[url];
		const update =
			typeof content === "string"
				? await checksumText(content)
				: await checksum(content);
		this.updatedStore[url] = update;

		if (current === update) {
			return false;
		} else {
			return true;
		}
	}

	/**
	 *
	 * @param {string} url
	 * @returns
	 */
	exists(url) {
		if (typeof this.store[url.toLowerCase()] !== "undefined") {
			return true;
		} else {
			return false;
		}
	}

	async save() {
		this.store = this.updatedStore;
		await fsOperation(this.storeUrl).writeFile(
			JSON.stringify(this.updatedStore),
		);
	}

	async delete(url) {
		url = url.toLowerCase();
		if (await fsOperation(url).exists()) {
			await fsOperation(url).delete();
		}
	}

	async clear() {
		try {
			this.store = {};
			this.updatedStore = {};
			// Delete the state file entirely to avoid corrupted/partial JSON issues
			if (await fsOperation(this.storeUrl).exists()) {
				try {
					await fsOperation(this.storeUrl).delete();
				} catch (delErr) {
					console.error(
						"InstallState: Failed to delete state file during clear:",
						delErr,
					);
					// As a fallback, overwrite with a valid empty JSON
					await fsOperation(this.storeUrl).writeFile("{}");
				}
			}
		} catch (error) {
			console.error("Failed to clear install state:", error);
		}
	}
}

/**
 * Derives the checksum of a Buffer
 * @param {BufferSource} data
 * @returns the derived checksum
 */
async function checksum(data) {
	const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return hashHex;
}

/**
 *
 * @param {string} text
 * @returns
 */
async function checksumText(text) {
	const textUint8 = new TextEncoder().encode(text);
	return await checksum(textUint8);
}
