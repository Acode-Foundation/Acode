import settings from "lib/settings";
import mimeType from "mime-types";
import { decode, encode } from "utils/encodings";
import helpers from "utils/helpers";
import Path from "utils/Path";
import Url from "utils/Url";
import internalFs from "./internalFs";

class SftpClient {
	#MAX_TRY = 3;
	#hostname;
	#port;
	#username;
	#authenticationType;
	#password;
	#keyFile;
	#passPhrase;
	#base;
	#connectionID;
	#path;
	#stat;
	#retry = 0;

	/**
	 *
	 * @param {String} hostname
	 * @param {Number} port
	 * @param {String} username
	 * @param {{password?: String, passPhrase?: String, keyFile?: String}} authentication
	 */
	constructor(hostname, port = 22, username, authentication) {
		this.#hostname = hostname;
		this.#port = port;
		this.#username = username;
		this.#authenticationType = !!authentication.keyFile ? "key" : "password";
		this.#keyFile = authentication.keyFile;
		this.#passPhrase = authentication.passPhrase;
		this.#password = authentication.password;
		this.#base = Url.formate({
			protocol: "sftp:",
			hostname: this.#hostname,
			port: this.#port,
			username: this.#username,
			password: this.#password,
			query: {
				passPhrase: this.#passPhrase,
				keyFile: this.#keyFile,
			},
		});

		this.#connectionID = `${this.#username}@${this.#hostname}`;
	}

	setPath(path) {
		this.#path = path;
	}

	/**
	 * List directory or get file info
	 * @param {String} filename
	 * @param {boolean} stat
	 */
	lsDir(filename = this.#path) {
		return new Promise((resolve, reject) => {
			sftp.isConnected(async (connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}

					const path = this.#safeName(filename);

					sftp.lsDir(
						path,
						(res) => {
							res.forEach((file) => {
								file.url = Url.join(this.#base, file.url);
								file.type = mimeType.lookup(filename);
								if (file.isLink) {
									file.linkTarget = Url.join(this.#base, file.linkTarget);
								}
							});
							resolve(res);
						},
						(err) => {
							reject(err);
						},
					);
				})();
			}, reject);
		});
	}

	/**
	 *
	 * @param {String} filename
	 * @param {String} content
	 */
	createFile(filename, content) {
		filename = Path.join(this.#path, filename);
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}
					sftp.createFile(
						filename,
						content ? content : "",
						async (_res) => {
							resolve(Url.join(this.#base, filename));
						},
						(err) => {
							reject(err);
						},
					);
				})();
			});
		});
	}

	/**
	 *
	 * @param {String} dirname
	 */
	createDir(dirname) {
		dirname = Path.join(this.#path, dirname);
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}

					sftp.mkdir(
						this.#safeName(dirname),
						async (_res) => {
							resolve(Url.join(this.#base, this.#safeName(dirname)));
						},
						(err) => {
							reject(err);
						},
					);
				})();
			});
		});
	}

	/**
	 * Write to a file on server
	 * @param {String|ArrayBuffer} content
	 * @param {String} remotefile
	 */
	writeFile(content, remotefile) {
		const filename = remotefile || this.#path;
		const localFilename = this.#getLocalname(filename);
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					try {
						if (this.#notConnected(connectionID)) {
							await this.connect();
						}

						await internalFs.writeFile(localFilename, content, true, false);
						const remoteFile = this.#safeName(filename);
						sftp.putFile(remoteFile, localFilename, resolve, reject);
					} catch (err) {
						reject(err);
					}
				})();
			}, reject);
		});
	}

	/**
	 * Read the file from server
	 */
	readFile() {
		const filename = this.#path;
		const localFilename = this.#getLocalname(filename);
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}

					sftp.getFile(
						this.#safeName(filename),
						localFilename,
						async () => {
							try {
								const data = await internalFs.readFile(localFilename);
								resolve(data);
							} catch (error) {
								reject(error);
							}
						},
						(err) => {
							reject(err);
						},
					);
				})();
			});
		});
	}

	async copyTo(dest) {
		const src = this.#path;
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					try {
						if (this.#notConnected(connectionID)) {
							await this.connect();
						}

						const srcStat = await this.stat();

						if (srcStat.isDirectory) {
							await this.#copyDirectory(src, dest);
						} else {
							await this.#copyFile(src, dest);
						}

						const finalPath = Path.join(dest, Path.basename(src));
						resolve(Url.join(this.#base, finalPath));
					} catch (error) {
						reject(error);
					}
				})();
			}, reject);
		});
	}

	async #copyFile(src, dest) {
		const destPath = Path.join(dest, Path.basename(src));
		const tempFile = this.#getLocalname(src);

		// Download source file
		await new Promise((resolve, reject) => {
			sftp.getFile(this.#safeName(src), tempFile, resolve, reject);
		});

		// Upload
		await new Promise((resolve, reject) => {
			sftp.putFile(this.#safeName(destPath), tempFile, resolve, reject);
		});

		// Clean up temp file
		try {
			await internalFs.delete(tempFile);
		} catch (error) {
			console.warn("Failed to cleanup temp file:", error);
		}
	}

	async #copyDirectory(src, dest) {
		// Create destination directory
		const destDir = Path.join(dest, Path.basename(src));
		await new Promise((resolve, reject) => {
			sftp.mkdir(this.#safeName(destDir), resolve, reject);
		});

		// Get contents of source directory
		const contents = await this.lsDir(src);

		// Copy all items
		for (const item of contents) {
			const itemSrc = Path.join(src, item.name);
			if (item.isDirectory) {
				await this.#copyDirectory(itemSrc, destDir);
			} else {
				await this.#copyFile(itemSrc, destDir);
			}
		}
	}

	moveTo(dest) {
		return this.rename(dest, true);
	}

	/**
	 * Renames file and directory, it can also be use to move directory or file
	 * @param {String} newname
	 * @param {Boolean} move
	 */
	rename(newname, move) {
		const src = this.#path;
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}

					newname = move ? newname : Path.join(Path.dirname(src), newname);
					sftp.rename(
						this.#safeName(src),
						this.#safeName(newname),
						async (_res) => {
							const url = move ? Url.join(newname, Url.basename(src)) : newname;
							resolve(Url.join(this.#base, url));
						},
						(err) => {
							reject(err);
						},
					);
				})();
			}, reject);
		});
	}

	/**
	 * Delete file or directory
	 */
	delete() {
		const filename = this.#path;
		const fullFilename = Url.join(this.#base, filename);
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}
					await this.#setStat();
					sftp.rm(
						this.#safeName(filename),
						this.#stat.isDirectory ? true : false,
						this.#stat.isDirectory ? true : false,
						(_res) => {
							resolve(fullFilename);
						},
						(err) => {
							reject(err);
						},
					);
				})();
			}, reject);
		});
	}

	pwd() {
		return new Promise((resolve, reject) => {
			sftp.isConnected((connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}

					sftp.pwd(
						(res) => {
							resolve(res);
						},
						(err) => {
							reject(err);
						},
					);
				})();
			}, reject);
		});
	}

	async connect() {
		await new Promise((resolve, reject) => {
			const retry = (err) => {
				if (settings.value.retryRemoteFsAfterFail) {
					if (++this.#retry > this.#MAX_TRY) {
						this.#retry = 0;
						reject(err);
					} else {
						this.connect().then(resolve).catch(reject);
					}
				} else {
					reject(err);
				}
			};

			if (this.#authenticationType === "key") {
				sftp.connectUsingKeyFile(
					this.#hostname,
					this.#port,
					this.#username,
					this.#keyFile,
					this.#passPhrase,
					resolve,
					retry,
				);
				return;
			}

			sftp.connectUsingPassword(
				this.#hostname,
				this.#port,
				this.#username,
				this.#password,
				resolve,
				retry,
			);
		});
	}

	async exists() {
		return (await this.stat()).exists;
	}

	async stat() {
		if (this.#stat) return this.#stat;

		return new Promise((resolve, reject) => {
			sftp.isConnected(async (connectionID) => {
				(async () => {
					if (this.#notConnected(connectionID)) {
						try {
							await this.connect();
						} catch (error) {
							reject(error);
							return;
						}
					}

					const path = this.#safeName(this.#path);

					sftp.stat(
						path,
						(res) => {
							res.url = Url.join(this.#base, res.url);
							res.type = mimeType.lookup(path);
							if (res.isLink) {
								res.linkTarget = Url.join(this.#base, res.linkTarget);
							}
							helpers.defineDeprecatedProperty(
								res,
								"uri",
								function () {
									return this.url;
								},
								function (val) {
									this.url = val;
								},
							);
							resolve(res);
						},
						(err) => {
							reject(err);
						},
					);
				})();
			}, reject);
		});
	}

	get localName() {
		return this.#getLocalname(this.#path);
	}

	/**
	 *
	 * @param {String} name
	 */
	#safeName(name) {
		const escapeCh = (str) => str.replace(/\\([\s\S])|([`"])/g, "\\$1$2");
		const ar = name.split("/");
		return ar.map((dirname) => escapeCh(dirname)).join("/");
	}

	// #errorCodes(code, defaultMessage = strings["an error occurred"]) {
	// 	switch (code) {
	// 		case 0:
	// 			return strings["success"];
	// 		case 1:
	// 			return strings["operation not permitted"];
	// 		case 2:
	// 			return strings["no such file or directory"];
	// 		case 5:
	// 			return strings["input/output error"];
	// 		case 13:
	// 			return strings["permission denied"];
	// 		case 14:
	// 			return strings["bad address"];
	// 		case 17:
	// 			return strings["file exists"];
	// 		case 20:
	// 			return strings["not a directory"];
	// 		case 21:
	// 			return strings["is a directory"];
	// 		case 22:
	// 			return strings["invalid argument"];
	// 		case 23:
	// 			return strings["too many open files in system"];
	// 		case 24:
	// 			return strings["too many open files"];
	// 		case 26:
	// 			return strings["text file busy"];
	// 		case 27:
	// 			return strings["file too large"];
	// 		case 28:
	// 			return strings["no space left on device"];
	// 		case 30:
	// 			return strings["read-only file system"];
	// 		case 37:
	// 			return strings["too many users"];
	// 		case 110:
	// 			return strings["connection timed out"];
	// 		case 111:
	// 			return strings["connection refused"];
	// 		case 130:
	// 			return strings["owner died"];

	// 		default:
	// 			return defaultMessage;
	// 	}
	// }

	/**
	 *
	 * @param {String} connectionID
	 * @returns {Boolean}
	 */
	#notConnected(connectionID) {
		return !connectionID || connectionID !== this.#connectionID;
	}

	/**
	 *
	 * @param {String} filename
	 * @returns {String}
	 */
	#getLocalname(filename) {
		return Url.join(
			CACHE_STORAGE,
			"sftp" + Url.join(this.#base, filename).hashCode(),
		);
	}

	async #setStat() {
		if (!this.#stat) {
			this.#stat = await this.stat();
		}
	}
}

/**
 *
 * @param {String} host
 * @param {Number} port
 * @param {String} username
 * @param {{password?: String, passPhrase?: String, keyFile?: String}} authentication
 */
function Sftp(host, port, username, authentication) {
	return new SftpClient(host, port, username, authentication);
}

Sftp.fromUrl = (url) => {
	const { username, password, hostname, pathname, port, query } =
		Url.decodeUrl(url);
	const { keyFile, passPhrase } = query;

	const sftp = new SftpClient(hostname, port || 22, username, {
		password,
		keyFile,
		passPhrase,
	});

	sftp.setPath(pathname);
	return createFs(sftp);
};

Sftp.test = (url) => /^sftp:/.test(url);

/**
 *
 * @param {SftpClient} sftp
 */
function createFs(sftp) {
	return {
		lsDir() {
			return sftp.lsDir();
		},
		async readFile(encoding) {
			const { data } = await sftp.readFile();

			if (encoding) {
				return decode(data, encoding);
			}

			return data;
		},
		async writeFile(content, encoding) {
			if (typeof content === "string" && encoding) {
				content = await encode(content, encoding);
			}

			return sftp.writeFile(content, null);
		},
		createFile(name, data) {
			return sftp.createFile(name, data);
		},
		createDirectory(name) {
			return sftp.createDir(name);
		},
		delete() {
			return sftp.delete();
		},
		copyTo(dest) {
			dest = Url.pathname(dest);
			return sftp.copyTo(dest);
		},
		moveTo(dest) {
			dest = Url.pathname(dest);
			return sftp.moveTo(dest);
		},
		renameTo(newname) {
			return sftp.rename(newname);
		},
		exists() {
			return sftp.exists();
		},
		stat() {
			return sftp.stat();
		},
		get localName() {
			return sftp.localName;
		},
	};
}

export default Sftp;
