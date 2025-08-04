import settings from "lib/settings";
import mimeType from "mime-types";
import { decode, encode } from "utils/encodings";
import helpers from "utils/helpers";
import Path from "utils/Path";
import Url from "utils/Url";
import internalFs from "./internalFs";

class FtpClient {
	#MAX_TRY = 3;
	#path = "/";
	#host;
	#username;
	#password;
	#port;
	#security;
	#mode;
	#conId;
	#stat;
	#origin;
	#try = 0;

	constructor(
		host,
		username = "anonymous",
		password = "",
		port = 21,
		security = "ftp",
		mode = "passive",
		path = "/",
	) {
		if (!host) {
			throw new Error("host is required");
		}
		this.#host = host;
		this.#username = username;
		this.#password = password;
		this.#port = port;
		this.#security = security;
		this.#mode = mode;
		this.#path = path;

		this.#origin = Url.formate({
			protocol: "ftp:",
			hostname: this.#host,
			password: this.#password,
			username: this.#username,
			port: this.#port,
			query: {
				security: this.#security,
				mode: this.#mode,
			},
		});
	}

	connect() {
		return new Promise((resolve, reject) => {
			ftp.connect(
				this.#host,
				+this.#port,
				this.#username,
				this.#password,
				{
					securityType: this.#security,
					connectionMode: this.#mode,
					encoding: settings.value.defaultFileEncoding,
				},
				(conId) => {
					this.#conId = conId;
					resolve();
				},
				(err) => {
					if (settings.value.retryRemoteFsAfterFail) {
						if (++this.#try > this.#MAX_TRY) {
							this.#try = 0;
							reject(err);
							return;
						}
						this.connect().then(resolve).catch(reject);
					} else {
						reject(err);
					}
				},
			);
		});
	}

	setPath(val) {
		this.#path = val;
	}

	async listDir() {
		await this.#connectIfNotConnected();
		return new Promise((resolve, reject) => {
			ftp.listDirectory(
				this.#conId,
				this.#path,
				(list) => {
					resolve(
						list.map((i) => {
							i.url = Url.join(this.#origin, i.url);
							if (i.isFile) {
								i.type = mimeType.lookup(i.name);
							}
							return i;
						}),
					);
				},
				reject,
			);
		});
	}

	/**
	 * Read file from ftp server
	 * @returns
	 */
	async readFile() {
		await this.#connectIfNotConnected();
		return new Promise((resolve, reject) => {
			ftp.downloadFile(
				this.#conId,
				this.#path,
				this.#cacheFile,
				async () => {
					const data = await internalFs.readFile(this.#cacheFile);
					resolve(data);
				},
				(error) => {
					reject(error);
					console.error("FTP readFile: ", error);
				},
			);
		});
	}

	/**
	 * Write file to ftp server
	 * @param {string|ArrayBuffer} content
	 * @returns
	 */
	async writeFile(content = "") {
		await this.#connectIfNotConnected();
		const localFile = this.#cacheFile;
		await internalFs.writeFile(localFile, content, true, false);

		return new Promise((resolve, reject) => {
			ftp.uploadFile(
				this.#conId,
				this.#cacheFile,
				this.#path,
				() => {
					resolve(Url.join(this.#origin, this.#path));
				},
				reject,
			);
		});
	}

	async createFile(name, content = "") {
		await this.#connectIfNotConnected();
		const localFile = this.#cacheFile;
		await internalFs.writeFile(localFile, content, true, false);

		return new Promise((resolve, reject) => {
			ftp.uploadFile(
				this.#conId,
				this.#cacheFile,
				Path.join(this.#path, name),
				async () => {
					resolve(Url.join(this.#origin, this.#path, name));
				},
				reject,
			);
		});
	}

	async createDir(name) {
		await this.#connectIfNotConnected();
		return new Promise((resolve, reject) => {
			ftp.createDirectory(
				this.#conId,
				Path.join(this.#path, name),
				async () => {
					resolve(Url.join(this.#origin, this.#path, name));
				},
				reject,
			);
		});
	}

	async delete() {
		await this.#connectIfNotConnected();
		if (!this.#stat) {
			await this.#getStat();
		}
		return new Promise((resolve, reject) => {
			let deleteOperation;

			if (this.#stat.isDirectory) {
				deleteOperation = ftp.deleteDirectory;
			} else {
				deleteOperation = ftp.deleteFile;
			}

			deleteOperation(
				this.#conId,
				this.#path,
				() => {
					resolve(Url.join(this.#origin, this.#path));
				},
				reject,
			);
		});
	}

	async rename(newName) {
		await this.#connectIfNotConnected();
		const path = Path.dirname(this.#path);
		const newPath = Path.join(path, newName);
		return new Promise((resolve, reject) => {
			ftp.rename(
				this.#conId,
				this.#path,
				newPath,
				async () => {
					this.#path = newPath;
					resolve(Url.join(this.#origin, newPath));
				},
				reject,
			);
		});
	}

	async moveTo(newPath) {
		newPath = Path.join(newPath, Path.basename(this.#path));
		await this.#connectIfNotConnected();
		return new Promise((resolve, reject) => {
			ftp.rename(
				this.#conId,
				this.#path,
				newPath,
				async () => {
					this.#path = newPath;
					resolve(Url.join(this.#origin, newPath));
				},
				reject,
			);
		});
	}

	async exists() {
		await this.#connectIfNotConnected();
		return new Promise((resolve, reject) => {
			ftp.exists(this.#conId, this.#path, resolve, (error) => {
				reject(error);
				console.error("FTP error: ", error);
			});
		});
	}

	async stat() {
		if (this.#stat) return this.#stat;
		await this.#connectIfNotConnected();
		await this.#getStat();
		return this.#stat;
	}

	async copyTo() {
		throw new Error("Not supported by FTP.");
	}

	async getWorkingDirectory() {
		await this.#connectIfNotConnected();
		return new Promise((resolve, reject) => {
			ftp.getWorkingDirectory(this.#conId, resolve, reject);
		});
	}

	get localName() {
		return this.#cacheFile;
	}

	async #getStat(url = this.#path) {
		return new Promise((resolve, reject) => {
			ftp.getStat(
				this.#conId,
				url,
				(stat) => {
					this.#stat = stat;
					this.#stat.url = Url.join(this.#origin, url);
					helpers.defineDeprecatedProperty(
						this.#stat,
						"uri",
						function () {
							return this.url;
						},
						function (val) {
							this.url = val;
						},
					);
					if (this.#stat.isFile) {
						this.#stat.type = mimeType.lookup(this.#stat.name);
					}
					resolve(this.#stat);
				},
				(err) => {
					console.error("Error while getting stat", err);
					reject(err);
				},
			);
		});
	}

	get #cacheFile() {
		return Url.join(
			CACHE_STORAGE,
			"ftp" + Url.join(this.#origin, this.#path).hashCode(),
		);
	}

	async #isConnected() {
		if (!this.#conId) return false;
		return new Promise((resolve, reject) => {
			ftp.isConnected(
				this.#conId,
				(isConnected) => {
					resolve(isConnected);
				},
				(error) => {
					reject(error);
					console.error("FTP isConnected: ", error);
				},
			);
		});
	}

	async #connectIfNotConnected() {
		const isConnected = await this.#isConnected();
		if (!isConnected) {
			await this.connect();
		}
	}
}

export default function Ftp(
	path,
	host,
	port,
	username,
	password,
	security,
	mode,
) {
	return new FtpClient(path, host, port, username, password, security, mode);
}

Ftp.fromUrl = (url) => {
	const { username, password, hostname, pathname, port, query } =
		Url.decodeUrl(url);
	const { security, mode } = query;
	const ftp = new FtpClient(
		hostname,
		username,
		password,
		port || 21,
		security,
		mode,
	);
	ftp.setPath(pathname);

	return createFs(ftp);
};

Ftp.test = (url) => /^ftp:/.test(url);

/**
 * Create a fs like interface for the ftp client
 * @param {FtpClient} ftp
 * @returns
 */
function createFs(ftp) {
	return {
		lsDir() {
			return ftp.listDir();
		},
		async readFile(encoding) {
			const { data } = await ftp.readFile();
			if (encoding) {
				return decode(data, encoding);
			}
			return data;
		},
		async writeFile(content, encoding) {
			if (typeof content === "string" && encoding) {
				content = await encode(content, encoding);
			}

			return ftp.writeFile(content);
		},
		createFile(name, data = "") {
			return ftp.createFile(name, data);
		},
		createDirectory(name) {
			return ftp.createDir(name);
		},
		delete() {
			return ftp.delete();
		},
		copyTo(dest) {
			dest = Url.pathname(dest);
			return ftp.copyTo(dest);
		},
		moveTo(dest) {
			dest = Url.pathname(dest);
			return ftp.moveTo(dest);
		},
		renameTo(newname) {
			return ftp.rename(newname);
		},
		exists() {
			return ftp.exists();
		},
		stat() {
			return ftp.stat();
		},
		get localName() {
			return ftp.localName;
		},
	};
}
