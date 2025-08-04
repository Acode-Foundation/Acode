import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import alert from "dialogs/alert";
import escapeStringRegexp from "escape-string-regexp";
import constants from "lib/constants";
import path from "./Path";
import Uri from "./Uri";
import Url from "./Url";

/**
 * Gets programming language name according to filename
 * @param {String} filename
 * @returns
 */
function getFileType(filename) {
	const regex = {
		babel: /\.babelrc$/i,
		jsmap: /\.js\.map$/i,
		yarn: /^yarn\.lock$/i,
		testjs: /\.test\.js$/i,
		testts: /\.test\.ts$/i,
		cssmap: /\.css\.map$/i,
		typescriptdef: /\.d\.ts$/i,
		clojurescript: /\.cljs$/i,
		cppheader: /\.(hh|hpp)$/i,
		jsconfig: /^jsconfig.json$/i,
		tsconfig: /^tsconfig.json$/i,
		android: /\.(apk|aab|slim)$/i,
		jsbeautify: /^\.jsbeautifyrc$/i,
		webpack: /^webpack\.config\.js$/i,
		audio: /\.(mp3|wav|ogg|flac|aac)$/i,
		git: /(^\.gitignore$)|(^\.gitmodules$)/i,
		video: /\.(mp4|m4a|mov|3gp|wmv|flv|avi)$/i,
		image: /\.(png|jpg|jpeg|gif|bmp|ico|webp)$/i,
		npm: /(^package\.json$)|(^package\-lock\.json$)/i,
		compressed: /\.(zip|rar|7z|tar|gz|gzip|dmg|iso)$/i,
		eslint:
			/(^\.eslintrc(\.(json5?|ya?ml|toml))?$|eslint\.config\.(c?js|json)$)/i,
		postcssconfig:
			/(^\.postcssrc(\.(json5?|ya?ml|toml))?$|postcss\.config\.(c?js|json)$)/i,
		prettier:
			/(^\.prettierrc(\.(json5?|ya?ml|toml))?$|prettier\.config\.(c?js|json)$)/i,
	};

	const fileType = Object.keys(regex).find((type) =>
		regex[type].test(filename),
	);
	if (fileType) return fileType;

	return Url.extname(filename).substring(1);
}

export default {
	/**
	 * @deprecated This method is deprecated, use 'encodings.decode' instead.
	 * Decodes arrayBuffer to String according given encoding type
	 * @param {ArrayBuffer} arrayBuffer
	 * @param {String} [encoding='utf-8']
	 */
	decodeText(arrayBuffer, encoding = "utf-8") {
		const isJson = encoding === "json";
		if (isJson) encoding = "utf-8";

		const uint8Array = new Uint8Array(arrayBuffer);
		const result = new TextDecoder(encoding).decode(uint8Array);
		if (isJson) {
			return this.parseJSON(result);
		}
		return result;
	},
	/**
	 * Gets icon according to filename
	 * @param {string} filename
	 */
	getIconForFile(filename) {
		const { getModeForPath } = ace.require("ace/ext/modelist");
		const type = getFileType(filename);
		const { name } = getModeForPath(filename);

		const iconForMode = `file_type_${name}`;
		const iconForType = `file_type_${type}`;

		return `file file_type_default ${iconForMode} ${iconForType}`;
	},
	/**
	 *
	 * @param {FileEntry[]} list
	 * @param {object} fileBrowser settings
	 * @param {'both'|'file'|'folder'}
	 */
	sortDir(list, fileBrowser, mode = "both") {
		const dir = [];
		const file = [];
		const sortByName = fileBrowser.sortByName;
		const showHiddenFile = fileBrowser.showHiddenFiles;

		list.forEach((item) => {
			let hidden;

			item.name = item.name || path.basename(item.url || "");
			hidden = item.name[0] === ".";

			if (typeof item.isDirectory !== "boolean") {
				if (this.isDir(item.type)) item.isDirectory = true;
			}
			if (!item.type) item.type = item.isDirectory ? "dir" : "file";
			if (!item.url) item.url = item.url || item.uri;
			if ((hidden && showHiddenFile) || !hidden) {
				if (item.isDirectory) {
					dir.push(item);
				} else if (item.isFile) {
					file.push(item);
				}
			}
			if (item.isDirectory) {
				item.icon = "folder";
			} else {
				if (mode === "folder") {
					item.disabled = true;
				}
				item.icon = this.getIconForFile(item.name);
			}
		});

		if (sortByName) {
			dir.sort(compare);
			file.sort(compare);
		}

		return dir.concat(file);

		function compare(a, b) {
			return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
		}
	},
	/**
	 * Gets error message from error object
	 * @param {Error} err
	 * @param  {...string} args
	 */
	errorMessage(err, ...args) {
		args.forEach((arg, i) => {
			if (/^(content|file|ftp|sftp|https?):/.test(arg)) {
				args[i] = this.getVirtualPath(arg);
			}
		});

		const extra = args.join("<br>");
		let msg;

		if (typeof err === "string" && err) {
			msg = err;
		} else if (err instanceof Error) {
			msg = err.message;
		} else {
			msg = strings["an error occurred"];
		}

		return msg + (extra ? "<br>" + extra : "");
	},
	/**
	 *
	 * @param {Error} err
	 * @param  {...string} args
	 * @returns {PromiseLike<void>}
	 */
	error(err, ...args) {
		if (err.code === 0) {
			toast(err);
			return;
		}

		let hide = null;
		const onhide = () => {
			if (hide) hide();
		};

		const msg = this.errorMessage(err, ...args);
		alert(strings.error, msg, onhide);

		return new Promise((resolve) => {
			hide = resolve;
		});
	},
	/**
	 * Returns unique ID
	 * @returns {string}
	 */
	uuid() {
		return (
			new Date().getTime() + Number.parseInt(Math.random() * 100000000000)
		).toString(36);
	},
	/**
	 * Parses JSON string, if fails returns null
	 * @param {Object|Array} string
	 */
	parseJSON(string) {
		if (!string) return null;
		try {
			return JSON.parse(string);
		} catch (e) {
			return null;
		}
	},
	/**
	 * Checks whether given type is directory or not
	 * @param {'dir'|'directory'|'folder'} type
	 * @returns {Boolean}
	 */
	isDir(type) {
		return /^(dir|directory|folder)$/.test(type);
	},
	/**
	 * Checks whether given type is file or not
	 * @param {'file'|'link'} type
	 * @returns {Boolean}
	 */
	isFile(type) {
		return /^(file|link)$/.test(type);
	},
	/**
	 * Replace matching part of url to alias name by which storage is added
	 * @param {String} url
	 * @returns {String}
	 */
	getVirtualPath(url) {
		url = Url.parse(url).url;

		if (/^content:/.test(url)) {
			const primary = Uri.getPrimaryAddress(url);
			if (primary) {
				return primary;
			}
		}

		/**@type {string[]} */
		const storageList = JSON.parse(localStorage.storageList || "[]");
		const storageListLen = storageList.length;

		for (let i = 0; i < storageListLen; ++i) {
			const uuid = storageList[i];
			let storageUrl = Url.parse(uuid.uri || uuid.url || "").url;
			if (!storageUrl) continue;
			if (storageUrl.endsWith("/")) {
				storageUrl = storageUrl.slice(0, -1);
			}
			const regex = new RegExp("^" + escapeStringRegexp(storageUrl));
			if (regex.test(url)) {
				url = url.replace(regex, uuid.name);
				break;
			}
		}

		return url;
	},
	/**
	 * Updates uri of all active which matches the oldUrl as location
	 * of the file
	 * @param {String} oldUrl
	 * @param {String} newUrl
	 */
	updateUriOfAllActiveFiles(oldUrl, newUrl) {
		const files = editorManager.files;
		const { url } = Url.parse(oldUrl);

		for (let file of files) {
			if (!file.uri) continue;
			const fileUrl = Url.parse(file.uri).url;
			if (new RegExp("^" + escapeStringRegexp(url)).test(fileUrl)) {
				if (newUrl) {
					file.uri = Url.join(newUrl, file.filename);
				} else {
					file.uri = null;
				}
			}
		}

		editorManager.onupdate("file-delete");
		editorManager.emit("update", "file-delete");
	},
	/**
	 * Displays ad on the current page
	 */
	showAd() {
		const { ad } = window;
		if (IS_FREE_VERSION && innerHeight * devicePixelRatio > 600 && ad) {
			const $page = tag.getAll("wc-page:not(#root)").pop();
			if ($page) {
				ad.active = true;
				ad.show();
			}
		}
	},
	/**
	 * Hides the ad
	 * @param {Boolean} [force=false]
	 */
	hideAd(force = false) {
		const { ad } = window;
		if (IS_FREE_VERSION && ad?.active) {
			const $pages = tag.getAll(".page-replacement");
			const hide = $pages.length === 1;

			if (force || hide) {
				ad.active = false;
				ad.hide();
			}
		}
	},
	async toInternalUri(uri) {
		return new Promise((resolve, reject) => {
			window.resolveLocalFileSystemURL(
				uri,
				(entry) => {
					resolve(entry.toInternalURL());
				},
				reject,
			);
		});
	},
	promisify(func, ...args) {
		return new Promise((resolve, reject) => {
			func(...args, resolve, reject);
		});
	},
	async checkAPIStatus() {
		try {
			const { status } = await ajax.get(Url.join(constants.API_BASE, "status"));
			return status === "ok";
		} catch (error) {
			window.log("error", error);
			return false;
		}
	},
	fixFilename(name) {
		if (!name) return name;
		return name.replace(/(\r\n)+|\r+|\n+|\t+/g, "").trim();
	},
	/**
	 * Creates a debounced function that delays invoking the input function until after 'wait' milliseconds have elapsed
	 * since the last time the debounced function was invoked. Useful for implementing behavior that should only happen
	 * after the input is complete.
	 *
	 * @param {Function} func - The function to debounce.
	 * @param {number} wait - The number of milliseconds to delay.
	 * @returns {Function} The new debounced function.
	 * @example
	 * window.addEventListener('resize', debounce(myFunction, 200));
	 */
	debounce(func, wait) {
		let timeout;
		return function debounced(...args) {
			const later = () => {
				clearTimeout(timeout);
				func.apply(this, args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		};
	},
	defineDeprecatedProperty(obj, name, getter, setter) {
		Object.defineProperty(obj, name, {
			get: function () {
				console.warn(`Property '${name}' is deprecated.`);
				return getter.call(this);
			},
			set: function (value) {
				console.warn(`Property '${name}' is deprecated.`);
				setter.call(this, value);
			},
		});
	},
	parseHTML(html) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");
		const children = doc.body.children;
		if (children.length === 1) {
			return children[0];
		}
		return Array.from(children);
	},
	async createFileStructure(uri, pathString, isFile = true) {
		const parts = pathString.split("/").filter(Boolean);
		let currentUri = uri;

		// Determine if it's a special case URI
		const isSpecialCase = currentUri.includes("::");
		let baseFolder;

		if (currentUri.includes("com.android.externalstorage.documents")) {
			baseFolder = decodeURIComponent(currentUri.split("%3A")[1].split("/")[0]);
		} else if (
			!(
				currentUri.includes("com.android.externalstorage.documents") ||
				currentUri.includes("com.termux.documents")
			)
		) {
			// Handle nested paths for regular file:// URIs
			const pathParts = pathString.split("/").filter(Boolean);
			let currentPath = uri;
			let firstCreatedPath = null;
			let firstCreatedType = null;

			for (let i = 0; i < pathParts.length; i++) {
				const isLastPart = i === pathParts.length - 1;
				const partName = pathParts[i];
				const newPath = Url.join(currentPath, partName);

				if (isLastPart && isFile) {
					// Create file if it's the last part and we're creating a file
					if (!(await fsOperation(newPath).exists())) {
						await fsOperation(currentPath).createFile(partName);
						if (firstCreatedPath === null) {
							firstCreatedPath = newPath;
							firstCreatedType = "file";
						}
					}
				} else {
					// Create directory for intermediate parts or when creating a folder
					if (!(await fsOperation(newPath).exists())) {
						await fsOperation(currentPath).createDirectory(partName);
						if (firstCreatedPath === null) {
							firstCreatedPath = newPath;
							firstCreatedType = "folder";
						}
					}
				}
				currentPath = newPath;
			}

			return {
				uri: firstCreatedPath || Url.join(uri, pathParts[0]),
				type:
					firstCreatedType ||
					(isFile && pathParts.length === 1 ? "file" : "folder"),
			};
		}

		for (let i = 0; i < parts.length; i++) {
			const isLastElement = i === parts.length - 1;
			const name = parts[i];
			let fullUri = currentUri;

			// Adjust URI for special cases
			if (currentUri.includes("com.android.externalstorage.documents")) {
				if (!isSpecialCase && i === 0) {
					fullUri += `::primary:${baseFolder}/${name}`;
				} else {
					fullUri += `/${name}`;
				}
			} else if (currentUri.includes("com.termux.documents")) {
				if (!isSpecialCase && i === 0) {
					fullUri += `::/data/data/com.termux/files/home/${name}`;
				} else {
					fullUri += `/${name}`;
				}
			}

			if (isLastElement && isFile) {
				// Create file if it's the last element and isFile is true
				if (!(await fsOperation(fullUri).exists())) {
					await fsOperation(currentUri).createFile(name);
				} else {
					return;
				}
			} else {
				// Create directory
				if (!(await fsOperation(fullUri).exists())) {
					await fsOperation(currentUri).createDirectory(name);
				} else {
					return;
				}
			}
			currentUri = fullUri;
		}
		let tileType;
		if (isFile && parts.length === 1) {
			tileType = "file";
		} else {
			const urlParts = currentUri.split("/");
			const pathParts = pathString.split("/");
			const pathStartIndex = urlParts.findIndex(
				(part) => part === pathParts[0],
			);
			if (pathStartIndex !== -1) {
				const pathEndIndex = pathStartIndex + pathParts.length;
				urlParts.splice(pathStartIndex + 1, pathEndIndex - pathStartIndex - 1);
			}
			currentUri = urlParts.join("/");
			tileType = "folder";
		}
		return { uri: currentUri, type: tileType };
	},
	formatDownloadCount(downloadCount) {
		const units = ["", "K", "M", "B", "T"];
		let index = 0;

		while (downloadCount >= 1000 && index < units.length - 1) {
			downloadCount /= 1000;
			index++;
		}

		const countStr =
			downloadCount < 10 ? downloadCount.toFixed(2) : downloadCount.toFixed(1);
		const trimmedCountStr = countStr.replace(/\.?0+$/, "");

		return `${trimmedCountStr}${units[index]}`;
	},
	isBinary(file) {
		// binary file extensions
		const binaryExtensions = [
			"exe",
			"dll",
			"so",
			"dylib",
			"bin",
			"o",
			"apk",
			"aab",
			"zip",
			"rar",
			"7z",
			"gz",
			"tar",
			"tgz",
			"jpg",
			"jpeg",
			"png",
			"gif",
			"bmp",
			"ico",
			"mp3",
			"mp4",
			"wav",
			"avi",
			"mov",
			"dds",
			"tga",
			"swf",
			"ttf",
			"eot",
			"otf",
			"woff",
			"woff2",
			"pdf",
			"doc",
			"docx",
			"xls",
			"xlsx",
			"class",
			"pyc",
			"jar",
			"war",
		];

		const extension = Url.basename(file)?.split(".")?.pop()?.toLowerCase();

		if (extension && binaryExtensions.includes(extension)) {
			return true;
		}
		return false;
	},
};
