import select from "dialogs/select";
import escapeStringRegexp from "escape-string-regexp";
import helpers from "utils/helpers";
import Uri from "utils/Uri";
import Url from "utils/Url";

const recents = {
	/**
	 * @returns {Array<String>}
	 */
	get files() {
		const files = helpers.parseJSON(localStorage.recentFiles);
		return Array.isArray(files) ? files : [];
	},
	/**
	 * @returns {{url: String, opts: Map<String, String>}[]}
	 */
	get folders() {
		const folders = helpers.parseJSON(localStorage.recentFolders);
		return Array.isArray(folders) ? folders : [];
	},
	set files(list) {
		if (Array.isArray(list)) localStorage.recentFiles = JSON.stringify(list);
	},
	set folders(list) {
		if (Array.isArray(list)) localStorage.recentFolders = JSON.stringify(list);
	},
	MAX: 10,
	/**
	 *
	 * @param {string} file
	 */
	addFile(file) {
		let files = this.files;
		if (files.length >= this.MAX) files.pop();
		files = files.filter((i) => i !== file);
		files.unshift(file);
		this.files = files;
	},
	addFolder(url, opts) {
		if (url.slice(-1) === "/") {
			url = url.slice(0, -1);
		}

		let folders = this.folders;
		if (folders.length >= this.MAX) folders.pop();
		folders = folders.filter((i) => i.url !== url);
		folders.unshift({
			url,
			opts,
		});
		this.folders = folders;
	},

	removeFolder(url) {
		({ url } = Url.parse(url));
		this.folders = this.folders.filter((folder) => {
			return !new RegExp("^" + escapeStringRegexp(folder.url)).test(url);
		});
	},

	removeFile(url) {
		({ url } = Url.parse(url));
		this.files = this.files.filter((file) => {
			return !new RegExp("^" + escapeStringRegexp(url)).test(file);
		});
	},

	clear() {
		this.files = [];
		this.folders = [];
	},
	/**
	 *
	 * @param {Array<Array<string, any, string>>} [extra]
	 * @param {"file"|"dir"|"all"} [type]
	 * @param {string} [title]
	 * @returns {Promise<RecentPathData>}
	 */
	select(extra, type = "all", title = strings["open recent"]) {
		const all = [];
		const pathDetails = (url) => {
			url = Url.parse(url).url;
			const isSafUri = /^content:/.test(url);
			const displayPath = isSafUri
				? Uri.getDisplayPath(url)
				: helpers.getVirtualPath(url);
			const documentPath = isSafUri ? Uri.getDisplayPath(url, []) : displayPath;
			const name = Url.basename(displayPath) || Url.basename(documentPath);
			const location =
				Url.dirname(isSafUri ? documentPath : displayPath)?.replace(
					/\/$/,
					"",
				) || "/";

			return { name, location, path: documentPath };
		};

		if (type === "dir" || type === "all") {
			let dirs = this.folders;
			for (let dir of dirs) {
				const { url } = dir;
				const { name, location, path } = pathDetails(url);

				const dirValue = {
					type: "dir",
					val: dir,
				};

				const tailElement = tag("span", {
					className: "icon clearclose",
					dataset: {
						action: "clear",
					},
				});

				all.push({
					value: dirValue,
					text: name,
					subText: location,
					title: path,
					icon: "folder",
					className: "recent-entry",
					tailElement: tailElement,
					ontailclick: (e) => {
						const $item = e.currentTarget.closest(".tile");
						if ($item) $item.remove();
						this.removeFolder(dir.url);
					},
				});
			}
		}

		if (type === "file" || type === "all") {
			let files = this.files;
			for (let file of files) {
				if (!file) continue;
				const { name, location, path } = pathDetails(Url.parse(file).url);

				const fileValue = {
					type: "file",
					val: file,
				};
				const tailElement = tag("span", {
					className: "icon clearclose",
					dataset: {
						action: "clear",
					},
				});

				all.push({
					value: fileValue,
					text: name,
					subText: location,
					title: path,
					icon: helpers.getIconForFile(name),
					className: "recent-entry",
					tailElement: tailElement,
					ontailclick: (e) => {
						const $item = e.currentTarget.closest(".tile");
						if ($item) $item.remove();
						this.removeFile(file);
					},
				});
			}
		}

		if (type === "all") {
			all.push({
				value: "clear",
				text: strings.clear,
				icon: "clearclose",
				className: "recent-clear",
			});
		}

		if (extra) {
			all.push(...extra);
		}

		return select(title, all, {
			textTransform: false,
			className: "recent-select",
		});
	},
};

export default recents;
