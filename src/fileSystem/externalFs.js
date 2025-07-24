import loader from "dialogs/loader";
import { decode, encode } from "utils/encodings";
import helpers from "utils/helpers";
import Url from "utils/Url";

const externalFs = {
	async readFile(url) {
		url = await this.formatUri(url);
		return new Promise((resolve, reject) => {
			sdcard.read(url, (data) => resolve({ data }), reject);
		});
	},

	async writeFile(filename, data) {
		return new Promise(async (resolve, reject) => {
			sdcard.write(filename, data, resolve, reject);
		});
	},

	async copy(src, dest) {
		return new Promise((resolve, reject) => {
			sdcard.copy(src, dest, resolve, reject);
		});
	},

	async move(src, dest) {
		return new Promise((resolve, reject) => {
			sdcard.move(src, dest, resolve, reject);
		});
	},

	async delete(name) {
		return new Promise((resolve, reject) => {
			sdcard.delete(name, resolve, reject);
		});
	},

	async createFile(parent, filename, data) {
		return new Promise((resolve, reject) => {
			sdcard.createFile(
				parent,
				filename,
				async (res) => {
					if (data) {
						await this.writeFile(res, data);
					}
					resolve(res);
				},
				reject,
			);
		});
	},

	async createDir(parent, dirname) {
		return new Promise((resolve, reject) => {
			sdcard.createDir(parent, dirname, resolve, reject);
		});
	},

	async listDir(pathname) {
		return new Promise((resolve, reject) => {
			sdcard.listDir(pathname, resolve, reject);
		});
	},

	async renameFile(src, newname) {
		return new Promise((resolve, reject) => {
			sdcard.rename(src, newname, resolve, reject);
		});
	},

	getStorageAccessPermission(uuid, name) {
		return new Promise((resolve, reject) => {
			setTimeout(() => {
				loader.destroy();
			}, 100);
			sdcard.getStorageAccessPermission(uuid, resolve, reject);
		});
	},

	listStorages() {
		return new Promise((resolve, reject) => {
			sdcard.listStorages(resolve, reject);
		});
	},

	getPath(uri, filename) {
		return new Promise((resolve, reject) => {
			sdcard.getPath(uri, filename, resolve, reject);
		});
	},

	async stats(uri) {
		const storageList = helpers.parseJSON(localStorage.getItem("storageList"));

		if (Array.isArray(storageList)) {
			const storage = storageList.find((s) => s.uri === uri);
			if (storage) {
				const stat = {
					size: 0,
					name: storage.name,
					type: "dir",
					canRead: true,
					canWrite: true,
					modifiedDate: new Date(),
					isDirectory: true,
					isFile: false,
					url: uri,
				};

				helpers.defineDeprecatedProperty(
					stat,
					"uri",
					function () {
						return this.url;
					},
					function (val) {
						this.url = val;
					},
				);

				return stat;
			}
		}

		uri = await this.formatUri(uri);
		return new Promise((resolve, reject) => {
			sdcard.stats(
				uri,
				(stats) => {
					helpers.defineDeprecatedProperty(
						stats,
						"uri",
						function () {
							return this.url;
						},
						function (val) {
							this.url = val;
						},
					);
					resolve(stats);
				},
				reject,
			);
		});
	},

	/**
	 * Format the virtual uri to a real uri
	 * @param {string} uri
	 * @returns
	 */
	formatUri(uri) {
		return new Promise((resolve, reject) => {
			sdcard.formatUri(uri, resolve, reject);
		});
	},

	/**
	 * Test if url supports this file system
	 * @param {string} url
	 * @returns
	 */
	test(url) {
		return /^content:/.test(url);
	},

	createFs,
};

/**
 * Initialize external file system
 * @param {string} url
 */
function createFs(url) {
	return {
		lsDir() {
			return externalFs.listDir(url);
		},
		async readFile(encoding) {
			let { data } = await externalFs.readFile(url, encoding);

			if (encoding) {
				data = await decode(data, encoding);
			}

			return data;
		},
		async writeFile(content, encoding) {
			if (typeof content === "string" && encoding) {
				content = await encode(content, encoding);
			}
			return externalFs.writeFile(url, content);
		},
		createFile(name, data) {
			data = data || "";
			return externalFs.createFile(url, name, data);
		},
		createDirectory(name) {
			return externalFs.createDir(url, name);
		},
		delete() {
			return externalFs.delete(url);
		},
		copyTo(dest) {
			return externalFs.copy(url, dest);
		},
		moveTo(dest) {
			const src = Url.dirname(url);
			if (Url.areSame(src, dest)) return Promise.resolve(url);
			return externalFs.move(url, dest);
		},
		renameTo(newname) {
			return externalFs.renameFile(url, newname);
		},
		async exists() {
			try {
				const stats = await externalFs.stats(url);
				return stats.exists;
			} catch (error) {
				return false;
			}
		},
		stat() {
			return externalFs.stats(url);
		},
	};
}

export default externalFs;
