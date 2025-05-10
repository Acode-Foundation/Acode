import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import ajax from "@deadlyjack/ajax";
import { data } from "autoprefixer";
import fsOperation from "fileSystem";
import path from "path-browserify";
import Url from "utils/Url";
import { decode, encode } from "utils/encodings";
import helpers from "utils/helpers";

const internalFs = {
	/**
	 * List files from a Directory (not recursive)
	 * @param {string} url
	 * @returns {Promise}
	 */
	listDir(url) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);

			Filesystem.readdir({ path: url })
				.then((result) => {
					console.log(
						`Listed files/directories successfully for url: ${url}, Result: `,
						result,
					);
					resolve(
						result.files.map((file) => ({
							name: file.name,
							url: file.uri,
							size: file.size,
							ctime: file.ctime,
							mtime: file.mtime,
							isFile: file.type === "file",
							isDirectory: file.type === "directory",
							isLink: false,
						})),
					);
				})
				.catch((error) => {
					console.log(
						`Error while listing Directory for url: ${url}, error:`,
						error,
					);
				});
		});
	},

	/**
	 *
	 * @param {string} filename
	 * @param {any} data
	 * @param {boolean} create If this property is true, and the requested file or
	 * directory doesn't exist, the user agent should create it.
	 * The default is false. The parent directory must already exist.
	 * @param {boolean} exclusive If true, and the create option is also true,
	 * the file must not exist prior to issuing the call.
	 * Instead, it must be possible for it to be created newly at call time. The default is true.
	 * @returns {Promise<string>} URL where the file was written into.
	 */
	writeFile(filename, udata, create = false, exclusive = true) {
		exclusive = create ? exclusive : false;
		const name = filename.split("/").pop();

		return new Promise((resolve, reject) => {
			if (udata === undefined || udata == null) {
				reject("udata is null");
			}

			let options = {
				path: filename,
				recursive: create,
			};

			reject = setMessage(reject);

			if (
				udata instanceof ArrayBuffer ||
				Object.prototype.toString.call(udata) === "[object ArrayBuffer]"
			) {
				// Binary data — store as base64
				options.data = btoa(String.fromCharCode(...new Uint8Array(udata)));
				options.encoding = Encoding.BASE64;
			} else if (typeof udata === "string") {
				// Text data — store as UTF-8
				options.data = udata;
				options.encoding = Encoding.UTF8;
			} else {
				reject("Unsupported udata type");
				return;
			}

			Filesystem.writeFile(options)
				.then((file) => {
					console.log(
						`Successfully written into (name: ${name}) ${filename} file`,
					);
					resolve(file.uri);
				})
				.catch((error) => {
					console.error(
						`Failed to write into (name: ${name}) ${filename} file, error: `,
						error,
					);
					reject(error);
				});
		});
	},

	/**
	 * Delete a file or directory
	 * @param {string} filename
	 * @returns {Promise}
	 */

	delete(filename) {
		return new Promise((resolve, reject) => {
			console.log("Deleting " + filename);

			Filesystem.stat({ path: filename })
				.then((stats) => {
					if (stats.type === "directory") {
						return Filesystem.rmdir({ path: filename, recursive: true });
					} else {
						return Filesystem.deleteFile({ path: filename });
					}
				})
				.then(() => {
					console.log("Deleted successfully!");
					resolve();
				})
				.catch((error) => {
					console.error("Error while deleting:", error);
					reject(error);
				});
		});
	},

	/**
	 * Read a file
	 * @param {string} filename
	 * @param {string} encoding
	 * @returns {Promise}
	 */
	readFile(filename) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			Filesystem.readFile({ path: filename, encoding: Encoding.UTF8 })
				.then((readFileResult) => {
					const encoder = new TextEncoder();
					const buffer = encoder.encode(readFileResult.data).buffer;

					resolve({ data: buffer });
				})
				.catch((error) => {
					console.error(
						`Failed to Read File contents of "${filename}", error: `,
						error,
					);
					reject(error);
				});
		});
	},

	readStringFile(filename) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			Filesystem.readFile({ path: filename, encoding: Encoding.UTF8 })
				.then((readFileResult) => {
					resolve({ data: readFileResult.data });
				})
				.catch((error) => {
					console.error(
						`Failed to Read File contents of "${filename}", error: `,
						error,
					);
					reject(error);
				});
		});
	},

	/**
	 * Rename a file or directory
	 * @param {string} url
	 * @param {string} newname
	 * @returns {Promise}
	 */
	renameFile(url, newname) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			window.resolveLocalFileSystemURL(
				url,
				(fs) => {
					fs.getParent((parent) => {
						fs.moveTo(
							parent,
							newname,
							async (entry) => {
								const newUrl = Url.join(Url.dirname(url), entry.name);
								resolve(newUrl);
							},
							reject,
						);
					}, reject);
				},
				reject,
			);
		});
	},

	/**
	 * Create a directory
	 * @param {string} path
	 * @param {string} dirname
	 * @returns {Promise}
	 */
	createDir(path, dirname) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			// TODO!: ask about `recursive` option
			Filesystem.mkdir({
				path: `${path}/${dirname}`,
				recursive: true,
			})
				.then(() => {
					console.log(`Created  ${path}/${dirname}`);
					Filesystem.stat({ path: `${path}/${dirname}` })
						.then((stats) => resolve(stats.url))
						.catch(reject);
				})
				.catch((error) => {
					console.error(
						`Failed to create ${dirname} directory in path: ${path}, error:`,
						error,
					);
					reject(error);
				});
		});
	},

	/**
	 * Copy a file or directory to another location
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<string>} The new location of the file or directory
	 */
	copy(src, dest) {
		return moveOrCopy("copyTo", src, dest);
	},

	/**
	 * Move a file or directory to another location
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<string>} The new location of the file or directory
	 */
	move(src, dest) {
		return moveOrCopy("moveTo", src, dest);
	},

	/**
	 * Move or copy a file or directory to another location
	 * @param {"copyTO"|"moveTo"} action
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<string>} The new location of the file or directory
	 */
	moveOrCopy(action, src, dest) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			this.verify(src, dest)
				.then((res) => {
					if (action === "copyTO") {
						Filesystem.copy({
							from: src,
							to: dest,
						})
							.then((copyResult) => {
								console.log(`Successfully copied from "${src}" to "${dest}"`);
								resolve(copyResult.uri);
							})
							.catch((error) => {
								console.error(`Failed to copy from "${src}" to "${dest}"`);
								reject(error);
							});
					} else if (action === "moveTO") {
						Filesystem.rename({
							from: src,
							to: dest,
						})
							.then((moveResult) => {
								console.log(`Successfully moved from "${src}" to "${dest}"`);
								resolve(dest);
							})
							.catch((error) => {
								console.error(`Failed to move from "${src}" to "${dest}"`);
								reject(error);
							});
					}
				})
				.catch(reject);
		});
	},

	/**
	 * Return the stats of a file or directory
	 * @param {string} filename
	 * @returns {object}
	 */
	stats(filename) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			Filesystem.stat({ path: filename })
				.then((entry) => {
					console.log(
						`Successfully returned stats for "${filename}", Result: `,
						entry,
					);
					sdcard.stats(
						entry.uri,
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
							stats.url = filename;
							resolve(stats);
						},
						reject,
					);
				})
				.catch((error) => {
					console.error(
						`Failed to show stats for "${filename}", error:`,
						error,
					);
					reject(error);
				});
		});
	},

	/**
	 * TODO: check this function with Rohit.
	 * Verify if a file or directory exists
	 * @param {string} src
	 * @param {string} dest
	 * @returns {Promise<{src:Entry, dest:Entry}>}
	 */
	verify(src, dest) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);

			// check if source exists
			Filesystem.stat({
				path: src,
			})
				.then((srcStat) => {
					console.log(
						`"${src}" source dir/file verified successful, checking if source dir/file already exists in "${dest}" destination file/dir`,
					);
					// Check if file/folder already exists at the destination
					Filesystem.stat({
						path: `${dest}/${srcStat.name}`,
					})
						.then(() => {
							// File already exists error.
							reject({
								code: 12,
							});
						})
						.catch((fileExistsErr) => {
							console.error(
								"Failed to verify source in destination, error: ",
								error,
							);
							// if we get a "not found" error (code 1), that's good - we can copy
							if (fileExistsErr.code === 1) {
								resolve({
									src: { path: src },
									dest: { path: dest },
								});
							} else {
								reject(fileExistsErr);
							}
						});
				})
				.catch((error) => {
					console.error(
						`Failed to verify "${src}" source dir/file, error: `,
						error,
					);
					reject(error);
				});
		});
	},

	/**
	 * Check if a file or directory exists
	 * @param {Promise<Boolean>} url
	 */
	exists(url) {
		return new Promise((resolve, reject) => {
			reject = setMessage(reject);
			Filesystem.stat({
				path: url,
			})
				.then((stats) => {
					if (!stats.uri) return resolve(false);
					console.log(
						`Successfully found (name: ${stats.name || "name not found"}) "${url}" existing`,
					);
					resolve(true);
				})
				.catch((err) => {
					// on-error defaulting to false,
					// as capacitor doesn't emit error codes, for error types(file not found, etc)
					resolve(false);
				});
		});
	},

	/**
	 * Test if url supports this file system
	 * @param {string} url
	 * @returns
	 */
	test(url) {
		return /^file:/.test(url);
	},

	createFs,
	getErrorMessage,
};

function setMessage(reject) {
	return function (err) {
		if (err.code) {
			const message = getErrorMessage(err.code);
			err.message = message;
			return reject(err);
		}
		reject(err);
	};
}

/**
 * Get error message for file error code
 * @param {number} code
 * @returns {string}
 */
function getErrorMessage(code) {
	switch (code) {
		case 1:
			return "Path not found";
		case 2:
			return "Security error";
		case 3:
			return "Action aborted";
		case 4:
			return "File not readable";
		case 5:
			return "File encoding error";
		case 6:
			return "Modification not allowed";
		case 7:
			return "Invalid state";
		case 8:
			return "Syntax error";
		case 9:
			return "Invalid modification";
		case 10:
			return "Quota exceeded";
		case 11:
			return "Type mismatch";
		case 12:
			return "Path already exists";
		default:
			return "Uncaught error";
	}
}

/**
 * Initialize file system
 * @param {string} url
 * @this {object}
 */
function createFs(url) {
	return {
		async lsDir() {
			const files = [];
			const entries = await internalFs.listDir(url);

			entries.map((entry) => {
				const url = decodeURIComponent(entry.nativeURL);
				const name = Url.basename(url);
				files.push({
					name,
					url,
					isDirectory: entry.isDirectory,
					isFile: entry.isFile,
				});
			});

			return files;
		},
		async readFile(encoding) {
			console.log("fs read " + url);
			let { data } = await internalFs.readFile(url, encoding);

			if (encoding) {
				data = await decode(data, encoding);
			}

			return data;
		},
		async writeFile(content, encoding) {
			if (typeof content === "string" && encoding) {
				content = await encode(content, encoding);
			}
			return internalFs.writeFile(url, content, false, false);
		},
		createFile(name, data) {
			return internalFs.writeFile(Url.join(url, name), data || "", true, true);
		},
		createDirectory(name) {
			return internalFs.createDir(url, name);
		},
		delete() {
			return internalFs.delete(url);
		},
		copyTo(dest) {
			return internalFs.moveOrCopy("copyTo", url, dest);
		},
		moveTo(dest) {
			return internalFs.moveOrCopy("moveTo", url, dest);
		},
		async renameTo(newname) {
			const name = Url.basename(url).toLowerCase();

			if (name === newname.toLowerCase()) {
				const uuid = helpers.uuid();
				let newUrl = await this.renameTo(uuid);
				newUrl = await fsOperation(newUrl).renameTo(newname);
				return newUrl;
			}

			return internalFs.renameFile(url, newname);
		},
		exists() {
			return internalFs.exists(url);
		},
		stat() {
			return internalFs.stats(url);
		},
	};
}

export default internalFs;
