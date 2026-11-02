import settings from "lib/settings";
import mimeType from "mime-types";
import { decode, encode } from "utils/encodings";
import helpers from "utils/helpers";
import Path from "utils/Path";
import Url from "utils/Url";
import internalFs from "./internalFs";
import {
	assertDownloadIsComplete,
	isMissingFileError,
} from "./remoteReadSafety";

// Covers a whole connect attempt, which may pause on an SSH host key prompt the
// person has to read. The native side clamps this to its own maximum.
const CONNECTION_ATTEMPT_TIMEOUT_MS = 120000;

// One connection attempt at a time, shared by every client instance, because the
// plugin holds a single connection.
let pendingConnection = null;
let pendingConnectionID = null;

/**
 * Bind a promise's resolve/reject into a single-outcome pair.
 *
 * Callbacks from the native layer can arrive more than once, and a late success
 * after a failure would otherwise resolve a promise that already rejected.
 * @returns {{resolve: (value?: any) => void, reject: (error?: any) => void, settled: () => boolean}}
 */
function deferred() {
	let settled = false;
	let resolvePromise;
	let rejectPromise;
	const promise = new Promise((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});

	return {
		promise,
		resolve(value) {
			if (settled) return;
			settled = true;
			resolvePromise(value);
		},
		reject(error) {
			if (settled) return;
			settled = true;
			rejectPromise(error);
		},
	};
}

/**
 * Native listings report `length` and `lastModified`; the rest of the app reads
 * `size` and `modifiedDate`. Fill in the aliases once, here, so sorting, the
 * file info dialog and the browser rows all see the same values.
 * @param {object} entry
 */
function normalizeEntry(entry) {
	if (!entry) return entry;
	if (entry.size == null) entry.size = Number(entry.length ?? 0);
	if (entry.modifiedDate == null && entry.lastModified != null) {
		entry.modifiedDate = entry.lastModified;
	}
	return entry;
}

/**
 * Turn a raw native stat/listing entry into the shape the app expects.
 * @param {object} entry
 * @param {string} base sftp base url
 * @returns {object}
 */
function toFileEntry(entry, base) {
	const file = entry || {};
	file.url = Url.join(base, file.url);
	// `type` is the app's entry kind, not a MIME type: helpers.isFile() only
	// accepts "file"/"link", so a MIME string here makes the row inert.
	file.type = file.isDirectory ? "dir" : "file";
	file.mime = mimeType.lookup(file.name || file.url) || undefined;
	normalizeEntry(file);
	if (file.isLink && file.linkTarget) {
		file.linkTarget = Url.join(base, file.linkTarget);
	}
	return file;
}

class SftpClient {
	#MAX_TRY = 3;
	#profileID;
	#base;
	#connectionID;
	#path;
	#stat;

	/**
	 * @param {String} hostname unused; the native profile identifies the host
	 * @param {Number} port unused
	 * @param {String} username unused
	 * @param {{profileID: String}} authentication
	 */
	constructor(hostname, port = 22, username, authentication) {
		authentication ||= {};
		this.#profileID = authentication.profileID;
		if (!this.#profileID) {
			throw new Error("A native SFTP profile is required");
		}
		this.#base = Url.formate({ protocol: "sftp:", hostname: this.#profileID });
		this.#connectionID = this.#profileID;
	}

	setPath(path) {
		this.#path = path;
	}

	/**
	 * Run `work` once a connection is known to be live.
	 *
	 * Every operation goes through here, so the "is it connected?" dance and its
	 * error handling exist in exactly one place.
	 * @param {(connected: boolean) => Promise<void>} work
	 * @returns {Promise<void>}
	 */
	#withConnection(work) {
		const result = deferred();
		const run = () => {
			Promise.resolve().then(work).then(result.resolve, result.reject);
		};

		sftp.isConnected((connectionID) => {
			if (!this.#notConnected(connectionID)) {
				run();
				return;
			}
			this.connect().then(run, result.reject);
		}, result.reject);

		return result.promise;
	}

	/**
	 * List a directory.
	 * @param {String} [filename]
	 * @returns {Promise<object[]>}
	 */
	lsDir(filename = this.#path) {
		return this.#withConnection(async () => {
			const path = this.#safeName(filename);
			const result = await new Promise((resolve, reject) => {
				sftp.lsDir(path, resolve, reject);
			});
			return (result || []).map((file) => toFileEntry(file, this.#base));
		});
	}

	/**
	 * Create a file in this directory.
	 * @param {String} filename
	 * @param {String} [content]
	 * @returns {Promise<String>} url of the created file
	 */
	createFile(filename, content) {
		const target = Path.join(this.#path, filename);
		return this.#withConnection(async () => {
			await new Promise((resolve, reject) => {
				sftp.createFile(target, content || "", resolve, reject);
			});
			return Url.join(this.#base, target);
		});
	}

	/**
	 * Create a directory in this directory.
	 * @param {String} dirname
	 * @returns {Promise<String>} url of the created directory
	 */
	createDir(dirname) {
		const target = Path.join(this.#path, dirname);
		return this.#withConnection(async () => {
			await new Promise((resolve, reject) => {
				sftp.mkdir(this.#safeName(target), resolve, reject);
			});
			return Url.join(this.#base, this.#safeName(target));
		});
	}

	/**
	 * Write a file's contents to the server.
	 *
	 * The content is staged to a unique temporary file and only that file is
	 * uploaded, so a failed save can never leave the canonical cache holding a
	 * partial document that a later read would mistake for the file.
	 *
	 * @param {String|ArrayBuffer} content
	 * @param {String} [remotefile]
	 * @returns {Promise<void>}
	 */
	writeFile(content, remotefile) {
		const filename = remotefile || this.#path;
		return this.#withConnection(async () => {
			const staged = this.#stagingPath(filename);
			try {
				await internalFs.writeFile(staged, content, true, false);
				await new Promise((resolve, reject) => {
					sftp.putFile(this.#safeName(filename), staged, resolve, reject);
				});
				// The upload succeeded, so the cache now holds exactly this content.
				await this.#replaceCache(filename, staged);
			} finally {
				await this.#removeQuietly(staged);
			}
		});
	}

	/**
	 * Read a file from the server.
	 *
	 * Downloads into a staging file, verifies its length, and only then moves it
	 * into place. A failed or short download throws and leaves the previous cache
	 * untouched, so a dropped connection can no longer be reported as an empty
	 * file.
	 *
	 * @returns {Promise<object>} the internal filesystem read result
	 */
	readFile() {
		const filename = this.#path;
		const staged = this.#stagingPath(filename);

		return this.#withConnection(async () => {
			try {
				const expectedLength = await this.#remoteLength();
				await new Promise((resolve, reject) => {
					sftp.getFile(this.#safeName(filename), staged, resolve, reject);
				});

				const raw = await internalFs.readFile(staged);
				assertDownloadIsComplete(raw?.data, expectedLength, filename);
				await this.#replaceCache(filename, staged);
				return raw;
			} finally {
				await this.#removeQuietly(staged);
			}
		});
	}

	/**
	 * Size the server reports for this entry.
	 *
	 * Read fresh from the server, never from the cached `stat`: a stale size
	 * would let a short download look complete. Resolves 0 when the server cannot
	 * be asked, which disables the check rather than failing the read.
	 * @returns {Promise<number>}
	 */
	#remoteLength() {
		return new Promise((resolve, reject) => {
			sftp.stat(
				this.#safeName(this.#path),
				(res) => resolve(Number(res?.length ?? res?.size) || 0),
				(error) => {
					// A missing file is worth surfacing; anything else only
					// disables the size check.
					if (isMissingFileError(error)) reject(error);
					else resolve(0);
				},
			);
		});
	}

	/**
	 * Copy this entry to a destination directory.
	 * @param {String} dest
	 * @returns {Promise<String>} url of the copy
	 */
	async copyTo(dest) {
		return this.#withConnection(async () => {
			const srcStat = await this.stat();
			if (srcStat.isDirectory) {
				await this.#copyDirectory(this.#path, dest);
			} else {
				await this.#copyFile(this.#path, dest);
			}
			const finalPath = Path.join(dest, Path.basename(this.#path));
			return Url.join(this.#base, finalPath);
		});
	}

	async #copyFile(src, dest) {
		// A copy gets its own scratch file. Sharing the editor's cache path meant
		// copying deleted the cache of an open file.
		const localTemp = this.#stagingPath(src, "copy");
		const destPath = Path.join(dest, Path.basename(src));

		try {
			await new Promise((resolve, reject) => {
				sftp.getFile(this.#safeName(src), localTemp, resolve, reject);
			});
			await new Promise((resolve, reject) => {
				sftp.putFile(this.#safeName(destPath), localTemp, resolve, reject);
			});
		} finally {
			await this.#removeQuietly(localTemp);
		}
	}

	async #copyDirectory(src, dest) {
		const destDir = Path.join(dest, Path.basename(src));
		await new Promise((resolve, reject) => {
			sftp.mkdir(this.#safeName(destDir), resolve, reject);
		});

		const contents = await this.lsDir(src);
		for (const item of contents) {
			if (item.isDirectory) {
				await this.#copyDirectory(Path.join(src, item.name), destDir);
			} else {
				await this.#copyFile(Path.join(src, item.name), destDir);
			}
		}
	}

	moveTo(dest) {
		return this.rename(dest, true);
	}

	/**
	 * Rename this entry, or move it when `move` is true.
	 * @param {String} newname
	 * @param {Boolean} [move]
	 * @returns {Promise<String>} the new url
	 */
	rename(newname, move) {
		const src = this.#path;
		return this.#withConnection(async () => {
			const target = move ? newname : Path.join(Path.dirname(src), newname);
			await new Promise((resolve, reject) => {
				sftp.rename(
					this.#safeName(src),
					this.#safeName(target),
					resolve,
					reject,
				);
			});
			const url = move ? Url.join(target, Url.basename(src)) : target;
			return Url.join(this.#base, url);
		});
	}

	/**
	 * Delete this entry, recursively when it is a directory.
	 * @returns {Promise<String>} url of the deleted entry
	 */
	delete() {
		const filename = this.#path;
		const fullFilename = Url.join(this.#base, filename);
		return this.#withConnection(async () => {
			const stat = await this.stat();
			await new Promise((resolve, reject) => {
				sftp.rm(
					this.#safeName(filename),
					Boolean(stat.isDirectory),
					Boolean(stat.isDirectory),
					resolve,
					reject,
				);
			});
			this.#stat = null;
			return fullFilename;
		});
	}

	pwd() {
		return this.#withConnection(
			() =>
				new Promise((resolve, reject) => {
					sftp.pwd(resolve, reject);
				}),
		);
	}

	async connect() {
		if (pendingConnection) {
			if (pendingConnectionID === this.#connectionID) {
				return pendingConnection;
			}
			try {
				await pendingConnection;
			} catch {
				// The next profile should still get its own attempt.
			}
			return this.connect();
		}

		pendingConnectionID = this.#connectionID;
		pendingConnection = this.#connectWithRetry();

		try {
			return await pendingConnection;
		} finally {
			if (pendingConnectionID === this.#connectionID) {
				pendingConnection = null;
				pendingConnectionID = null;
			}
		}
	}

	/**
	 * Test a profile once, without the retry policy used for file operations.
	 * @param {string} requestID native request id, used for cancellation
	 * @returns {Promise<string>} the remote working directory
	 */
	testConnection(requestID) {
		return new Promise((resolve, reject) => {
			sftp.testProfile(
				this.#profileID,
				requestID,
				CONNECTION_ATTEMPT_TIMEOUT_MS,
				resolve,
				reject,
			);
		});
	}

	/** Cancel an in-flight profile test. */
	cancelConnection(requestID) {
		return new Promise((resolve) => {
			sftp.cancelConnection(requestID, resolve, resolve);
		});
	}

	async #connectWithRetry() {
		const attempts = settings.value.retryRemoteFsAfterFail
			? this.#MAX_TRY + 1
			: 1;
		let lastError;

		for (let attempt = 0; attempt < attempts; attempt++) {
			try {
				return await this.#connectOnce();
			} catch (error) {
				if (error?.nonRetryable) throw error;
				lastError = error;
			}
		}

		throw lastError;
	}

	#connectOnce() {
		return new Promise((resolve, reject) => {
			sftp.connectUsingProfile(
				this.#profileID,
				resolve,
				reject,
				CONNECTION_ATTEMPT_TIMEOUT_MS,
			);
		});
	}

	async exists() {
		return (await this.stat()).exists;
	}

	async stat() {
		if (this.#stat) return this.#stat;

		const entry = await this.#withConnection(async () => {
			const path = this.#safeName(this.#path);
			const raw = await new Promise((resolve, reject) => {
				sftp.stat(path, resolve, reject);
			});
			const file = toFileEntry(raw, this.#base);
			helpers.defineDeprecatedProperty(
				file,
				"uri",
				function () {
					return this.url;
				},
				function (val) {
					this.url = val;
				},
			);
			return file;
		});

		this.#stat = entry;
		return entry;
	}

	get localName() {
		return this.#getLocalname(this.#path);
	}

	/**
	 * Escape a path for the native layer.
	 * @param {String} name
	 */
	#safeName(name) {
		const escapeCh = (str) => str.replace(/\\([^])|([`"])/g, "\\$1$2");
		const ar = name.split("/");
		return ar.map((dirname) => escapeCh(dirname)).join("/");
	}

	/**
	 * The stable cache path for a remote file. This is what the editor reads
	 * from, and it only ever holds a complete copy.
	 * @param {String} filename
	 * @returns {String}
	 */
	#getLocalname(filename) {
		return Url.join(
			CACHE_STORAGE,
			"sftp" + Url.join(this.#base, filename).hashCode(),
		);
	}

	/**
	 * A unique temporary path next to the cache file.
	 * @param {String} filename
	 * @param {String} [tag]
	 * @returns {String}
	 */
	#stagingPath(filename, tag = "tmp") {
		return `${this.#getLocalname(filename)}-${tag}-${helpers.uuid()}`;
	}

	/**
	 * Move a completed staging file into the cache position.
	 * @param {String} filename
	 * @param {String} staged
	 */
	async #replaceCache(filename, staged) {
		const target = this.#getLocalname(filename);
		const targetName = Url.basename(target);
		const parked = `${targetName}.old`;
		const parkedPath = Url.join(Url.dirname(target), parked);
		let parkedOldCopy = false;

		try {
			// renameTo moves within the same directory and takes a basename, so
			// this parks the old copy instead of deleting it: if the move below
			// fails, the previous good copy is still there.
			if (await internalFs.createFs(target).exists()) {
				await internalFs.createFs(target).renameTo(parked);
				parkedOldCopy = true;
			}
		} catch {
			// Nothing to replace.
		}

		try {
			await internalFs.createFs(staged).renameTo(targetName);
		} catch (error) {
			// Put the parked copy back. Leaving only "<name>.old" kept the bytes
			// but pointed localName at a file that no longer existed, which broke
			// sharing and every later cache read.
			if (parkedOldCopy) {
				try {
					await internalFs.createFs(parkedPath).renameTo(targetName);
				} catch (restoreError) {
					console.warn(
						"Could not restore the previous cached copy",
						restoreError,
					);
				}
			}
			throw error;
		}

		await this.#removeQuietly(parkedPath);
	}

	async #removeQuietly(path) {
		try {
			await internalFs.delete(path);
		} catch {
			// Best effort: a leftover staging file is harmless.
		}
	}

	#notConnected(connectionID) {
		return !connectionID || connectionID !== this.#connectionID;
	}
}

/**
 * @param {String} host
 * @param {Number} port
 * @param {String} username
 * @param {{profileID: String}} authentication
 */
function Sftp(host, port, username, authentication) {
	return new SftpClient(host, port, username, authentication);
}

Sftp.fromUrl = (url) => {
	const { hostname, pathname } = Url.decodeUrl(url);
	if (hostname?.startsWith("profile-")) {
		const sftp = new SftpClient(null, 22, null, { profileID: hostname });
		sftp.setPath(pathname);
		return createFs(sftp);
	}
	throw new Error(
		"Legacy SFTP credentials must be migrated to a native profile",
	);
};

Sftp.test = (url) => /^sftp:/.test(url);

/**
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
			return sftp.copyTo(Url.pathname(dest));
		},
		moveTo(dest) {
			return sftp.moveTo(Url.pathname(dest));
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
