import fsOperation from "fileSystem";
import sidebarApps from "sidebarApps";
import collapsableList from "components/collapsableList";
import Sidebar from "components/sidebar";
import tile from "components/tile";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import escapeStringRegexp from "escape-string-regexp";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";
import Path from "utils/Path";
import Url from "utils/Url";
import constants from "./constants";
import * as FileList from "./fileList";
import openFile from "./openFile";
import recents from "./recents";
import appSettings from "./settings";

/**
 * @typedef {import('../components/collapsableList').Collapsible} Collapsible
 */

/**
 * @typedef {object} ClipBoard
 * @property {string} url
 * @property {HTMLElement} $el
 * @property {"cut"|"copy"} action
 */

/**
 * @typedef {object} Folder
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {boolean} listFiles Weather to list all files recursively
 * @property {boolean} saveState
 * @property {Collapsible} $node
 * @property {ClipBoard} clipBoard
 * @property {function(): void} remove
 * @property {function(): void} reload
 * @property {Map<string, boolean>} listState
 */

/**@type {Folder[]} */
export const addedFolder = [];
const ACODE_PLUGIN_MANIFEST_FILE = "plugin.json";
/**
 * Open a folder in the sidebar
 * @param {string} _path
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} [opts.id]
 * @param {boolean} [opts.saveState]
 * @param {boolean} [opts.listFiles]
 * @param {Map<string, boolean>} [opts.listState]
 */
function openFolder(_path, opts = {}) {
	if (addedFolder.find((folder) => folder.url === _path)) {
		return;
	}

	const saveState = opts.saveState ?? true;
	const listState = opts.listState || {};
	const title = opts.name;
	let listFiles = opts.listFiles;

	if (!title) {
		throw new Error("Folder name is required");
	}

	const $root = collapsableList(title, "folder", {
		allCaps: true,
		ontoggle: () => expandList($root),
	});
	const $text = $root.$title.get(":scope>span.text");

	$root.id = "r" + _path.hashCode();
	$text.style.overflow = "hidden";
	$text.style.whiteSpace = "nowrap";
	$text.style.textOverflow = "ellipsis";
	$root.$title.dataset.type = "root";
	$root.$title.dataset.url = _path;
	$root.$title.dataset.name = title;

	$root.$ul.onclick =
		$root.$ul.oncontextmenu =
		$root.$title.onclick =
		$root.$title.oncontextmenu =
			handleItems;

	recents.addFolder(_path, opts);
	sidebarApps.get("files").append($root);

	const event = {
		url: _path,
		name: title,
	};

	const folder = {
		title,
		remove,
		listFiles,
		saveState,
		listState,
		url: _path,
		$node: $root,
		id: opts.id,
		clipBoard: {},
		reload() {
			$root.collapse();
			$root.expand();
		},
	};

	editorManager.emit("update", "add-folder");
	editorManager.onupdate("add-folder", event);
	editorManager.emit("add-folder", event);

	(async () => {
		if (typeof listFiles !== "boolean") {
			const protocol = Url.getProtocol(_path).slice(0, -1);
			const type = /^(content|file)$/.test(protocol) ? "" : ` (${protocol})`;
			const message = strings["list files"].replace(
				"{name}",
				`${title}${type}`,
			);
			listFiles = await confirm(strings.confirm, message, true);
		}

		if (listFiles) {
			FileList.addRoot({ url: _path, name: title });
		}

		folder.listFiles = listFiles;
		addedFolder.push(folder);
	})();

	if (listState[_path]) {
		$root.expand();
	}

	function remove(e) {
		if (e) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		}

		if ($root.parentElement) {
			$root.remove();
		}

		const index = addedFolder.findIndex((folder) => folder.url === _path);
		if (index !== -1) addedFolder.splice(index, 1);
		editorManager.emit("update", "remove-folder");
		editorManager.onupdate("remove-folder", event);
		editorManager.emit("remove-folder", event);
	}
}

/**
 * Expand the list
 * @param {Collapsible} $list
 */
async function expandList($list) {
	const { $ul, $title } = $list;
	const { url } = $title.dataset;

	const { saveState, listState, $node } = openFolder.find(url);
	const startLoading = () => $node.$title.classList.add("loading");
	const stopLoading = () => $node.$title.classList.remove("loading");

	if (!$ul) return;

	$ul.textContent = null;
	if (saveState) listState[url] = $list.unclasped;
	if (!$list.unclasped) return;

	try {
		startLoading();
		const entries = await fsOperation(url).lsDir();
		helpers
			.sortDir(entries, {
				sortByName: true,
				showHiddenFiles: true,
			})
			.map((entry) => {
				const name = entry.name || Path.basename(entry.url);
				if (entry.isDirectory) {
					const $list = createFolderTile(name, entry.url);
					$ul.appendChild($list);

					if (listState[entry.url]) {
						$list.expand();
					}
				} else {
					const $item = createFileTile(name, entry.url);
					$ul.append($item);
				}
			});
	} catch (err) {
		$list.collapse();
		if (err?.includes("Invalid message length")) {
			console.error(err);
			toast("SFTP connection broken. Restart the app");
			return;
		}
		helpers.error(err);
	} finally {
		stopLoading();
	}
}

/**
 * Gets weather the folder is collapsed or not
 * @param {HTMLElement} $el
 * @param {boolean} isFile
 * @returns
 */
function collapsed($el, isFile) {
	if (!$el.isConnected) return true;
	$el = $el.parentElement;
	if (!isFile) {
		$el = $el.parentElement;
	}

	return $el.previousElementSibling.collapsed;
}

/**
 * Handle click event
 * @param {Event} e
 */
function handleItems(e) {
	const mode = e.type;
	const $target = e.target;
	if (!($target instanceof HTMLElement)) return;
	const type = $target.dataset.type;
	if (!type) return;
	const url = $target.dataset.url;
	const name = $target.dataset.name;

	if (mode === "click") {
		handleClick(type, url, name, $target);
	} else if (mode === "contextmenu") {
		handleContextmenu(type, url, name, $target);
	}
}

/**
 * Handle contextmenu
 * @param {"file"|"dir"|"root"} type
 * @param {string} url
 * @param {string} name
 * @param {HTMLElement} $target
 */
async function handleContextmenu(type, url, name, $target) {
	if (appSettings.value.vibrateOnTap) {
		navigator.vibrate(constants.VIBRATION_TIME);
	}
	const { clipBoard, $node } = openFolder.find(url);
	const cancel = `${strings.cancel}${clipBoard ? ` (${strings[clipBoard.action]})` : ""}`;
	const COPY = ["copy", strings.copy, "copy"];
	const CUT = ["cut", strings.cut, "cut"];
	const REMOVE = ["delete", strings.delete, "delete"];
	const RENAME = ["rename", strings.rename, "edit"];
	const PASTE = ["paste", strings.paste, "paste", !!clipBoard];
	const NEW_FILE = ["new file", strings["new file"], "document-add"];
	const NEW_FOLDER = ["new folder", strings["new folder"], "folder-add"];
	const CANCEL = ["cancel", cancel, "clearclose"];
	const OPEN_FOLDER = ["open-folder", strings["open folder"], "folder"];
	const INSERT_FILE = ["insert-file", strings["insert file"], "file_copy"];
	const CLOSE_FOLDER = ["close", strings["close"], "folder-remove"];
	const INSTALL_PLUGIN = [
		"install-plugin",
		strings["install as plugin"] || "Install as Plugin",
		"extension",
	];

	let options;

	if (helpers.isFile(type)) {
		options = [COPY, CUT, RENAME, REMOVE];
		if (
			url.toLowerCase().endsWith(".zip") &&
			(await fsOperation(
				Url.dirname(url) + ACODE_PLUGIN_MANIFEST_FILE,
			).exists())
		) {
			options.push(INSTALL_PLUGIN);
		}
	} else if (helpers.isDir(type)) {
		options = [COPY, CUT, REMOVE, RENAME];

		if (clipBoard.url != null) {
			options.push(PASTE);
		}

		options.push(NEW_FILE, NEW_FOLDER, OPEN_FOLDER, INSERT_FILE);
	} else if (type === "root") {
		options = [];

		if (clipBoard.url != null) {
			options.push(PASTE);
		}

		options.push(NEW_FILE, NEW_FOLDER, INSERT_FILE, CLOSE_FOLDER);
	}

	if (clipBoard.action) options.push(CANCEL);

	try {
		const option = await select(name, options);
		await execOperation(type, option, url, $target, name);
	} catch (error) {
		console.error(error);
		helpers.error(error);
	} finally {
		$node.$title.classList.remove("loading");
	}
}

/**
 * @param {"dir"|"file"|"root"} type
 * @param {"copy"|"cut"|"delete"|"rename"|"paste"|"new file"|"new folder"|"cancel"|"open-folder"|"install-plugin"} action
 * @param {string} url target url
 * @param {HTMLElement} $target target element
 * @param {string} name Name of file or folder
 */
function execOperation(type, action, url, $target, name) {
	const { clipBoard, $node, remove } = openFolder.find(url);
	const startLoading = () => $node.$title.classList.add("loading");
	const stopLoading = () => $node.$title.classList.remove("loading");

	switch (action) {
		case "copy":
		case "cut":
			return clipBoardAction();

		case "delete":
			return deleteFile();

		case "rename":
			return renameFile();

		case "paste":
			return paste();

		case "new file":
		case "new folder":
			return createNew();

		case "cancel":
			return cancelAction();

		case "open-folder":
			return open();

		case "insert-file":
			return insertFile();

		case "close":
			return remove();

		case "install-plugin":
			return installPlugin();
	}

	async function installPlugin() {
		try {
			const manifest = JSON.parse(
				await fsOperation(
					Url.dirname(url) + ACODE_PLUGIN_MANIFEST_FILE,
				).readFile("utf8"),
			);
			const { default: installPlugin } = await import("lib/installPlugin");
			await installPlugin(url, manifest.name);
			toast(strings["success"], 3000);
		} catch (error) {
			helpers.error(error);
			console.error(error);
		}
	}

	async function deleteFile() {
		const msg = strings["delete entry"].replace("{name}", name);
		const confirmation = await confirm(strings.warning, msg);
		if (!confirmation) return;
		startLoading();
		if (!(await fsOperation(url).exists())) return;
		// await fsOperation(url).delete();
		recents.removeFile(url);
		if (helpers.isFile(type)) {
			await fsOperation(url).delete();
			$target.remove();
			const file = editorManager.getFile(url, "uri");
			if (file) file.uri = null;
			editorManager.onupdate("delete-file");
			editorManager.emit("update", "delete-file");
		} else {
			if (url.startsWith("content://com.termux.documents/tree/")) {
				const fs = fsOperation(url);
				const entries = await fs.lsDir();
				if (entries.length === 0) {
					await fs.delete();
				} else {
					const deleteRecursively = async (currentUrl) => {
						const currentFs = fsOperation(currentUrl);
						const currentEntries = await currentFs.lsDir();
						for (const entry of currentEntries) {
							if (entry.isDirectory) {
								await deleteRecursively(entry.url);
							} else {
								await fsOperation(entry.url).delete();
							}
						}
						await currentFs.delete();
					};
					await deleteRecursively(url);
				}
			} else {
				await fsOperation(url).delete();
			}
			recents.removeFolder(url);
			helpers.updateUriOfAllActiveFiles(url, null);
			$target.parentElement.remove();
			editorManager.onupdate("delete-folder");
			editorManager.emit("update", "delete-folder");
		}

		toast(strings.success);
		FileList.remove(url);
	}

	async function renameFile() {
		if (
			url.startsWith("content://com.termux.documents/tree/") &&
			!helpers.isFile(type)
		) {
			alert(strings.warning, strings["rename not supported"]);
			return;
		}
		let newName = await prompt(strings.rename, name, "text", {
			match: constants.FILE_NAME_REGEX,
			required: true,
		});

		newName = helpers.fixFilename(newName);
		if (!newName || newName === name) return;

		startLoading();
		const fs = fsOperation(url);
		let newUrl;

		if (
			url.startsWith("content://com.termux.documents/tree/") &&
			helpers.isFile(type)
		) {
			// Special handling for Termux content files
			const newFilePath = Url.join(Url.dirname(url), newName);
			const content = await fs.readFile();
			await fsOperation(Url.dirname(url)).createFile(newName, content);
			await fs.delete();
			newUrl = newFilePath;
		} else {
			newUrl = await fs.renameTo(newName);
		}

		newName = Url.basename(newUrl);
		$target.querySelector(":scope>.text").textContent = newName;
		$target.dataset.url = newUrl;
		$target.dataset.name = newName;
		if (helpers.isFile(type)) {
			$target.querySelector(":scope>span").className =
				helpers.getIconForFile(newName);
			let file = editorManager.getFile(url, "uri");
			if (file) {
				file.uri = newUrl;
				file.filename = newName;
			}
		} else {
			helpers.updateUriOfAllActiveFiles(url, newUrl);
			//Reloading the folder by collapsing and expanding the folder
			$target.click(); //collapse
			$target.click(); //expand
		}
		toast(strings.success);
		FileList.rename(url, newUrl);
	}

	async function createNew() {
		const msg =
			action === "new file"
				? strings["enter file name"]
				: strings["enter folder name"];

		let newName = await prompt(msg, "", "text", {
			match: constants.FILE_NAME_REGEX,
			required: true,
		});

		newName = helpers.fixFilename(newName);
		if (!newName) return;
		startLoading();
		let newUrl;

		if (action === "new file") {
			newUrl = await helpers.createFileStructure(url, newName);
		} else {
			newUrl = await helpers.createFileStructure(url, newName, false);
		}
		if (!newUrl) return;
		newName = Url.basename(newUrl.uri);
		if ($target.unclasped) {
			if (newUrl.type === "file") {
				appendTile($target, createFileTile(newName, newUrl.uri));
			} else if (newUrl.type === "folder") {
				appendList($target, createFolderTile(newName, newUrl.uri));
			}
		}

		FileList.append(url, newUrl.uri);
		toast(strings.success);
	}

	async function paste() {
		if (clipBoard.url == null) {
			alert(strings.warning, "Nothing to paste");
			return;
		}

		// Prevent pasting a folder into itself or its subdirectories
		if (helpers.isDir(clipBoard.$el.dataset.type)) {
			const sourceUrl = Url.parse(clipBoard.url).url;
			const targetUrl = Url.parse(url).url;

			// Check if trying to paste folder into itself
			if (sourceUrl === targetUrl) {
				alert(strings.warning, "Cannot paste a folder into itself");
				return;
			}

			// Check if trying to paste folder into one of its subdirectories
			if (
				targetUrl.startsWith(sourceUrl + "/") ||
				targetUrl.startsWith(sourceUrl + "\\")
			) {
				alert(strings.warning, "Cannot paste a folder into its subdirectory");
				return;
			}
		}

		let CASE = "";
		const $src = clipBoard.$el;
		const srcType = $src.dataset.type;
		const IS_FILE = helpers.isFile(srcType);
		const IS_DIR = helpers.isDir(srcType);
		const srcCollapsed = collapsed($src, IS_FILE);

		CASE += IS_FILE ? 1 : 0;
		CASE += srcCollapsed ? 1 : 0;
		CASE += $target.collapsed ? 1 : 0;

		startLoading();
		try {
			const fs = fsOperation(clipBoard.url);
			const itemName = Url.basename(clipBoard.url);
			const possibleConflictUrl = Url.join(url, itemName);
			const doesExist = await fsOperation(possibleConflictUrl).exists();
			if (doesExist) {
				let confirmation = await confirm(
					strings.warning,
					strings["already exists"]
						? strings["already exists"].replace("{name}", itemName)
						: `"${itemName}" already exists in this location.`,
				);
				if (!confirmation) return;
			}
			let newUrl;
			if (clipBoard.action === "cut") {
				// Special handling for Termux SAF folders - move manually due to SAF limitations
				if (
					clipBoard.url.startsWith("content://com.termux.documents/tree/") &&
					IS_DIR
				) {
					const moveRecursively = async (sourceUrl, targetParentUrl) => {
						const sourceFs = fsOperation(sourceUrl);
						const sourceName = Url.basename(sourceUrl);
						const targetUrl = Url.join(targetParentUrl, sourceName);

						// Create target folder
						await fsOperation(targetParentUrl).createDirectory(sourceName);

						// Get all entries in source folder
						const entries = await sourceFs.lsDir();

						// Move all files and folders recursively
						for (const entry of entries) {
							if (entry.isDirectory) {
								await moveRecursively(entry.url, targetUrl);
							} else {
								const fileContent = await fsOperation(entry.url).readFile();
								const fileName = entry.name || Url.basename(entry.url);
								await fsOperation(targetUrl).createFile(fileName, fileContent);
								await fsOperation(entry.url).delete();
							}
						}

						// Delete the now-empty source folder
						await sourceFs.delete();
						return targetUrl;
					};

					newUrl = await moveRecursively(clipBoard.url, url);
				} else {
					newUrl = await fs.moveTo(url);
				}
			} else {
				newUrl = await fs.copyTo(url);
			}
			const { name: newName } = await fsOperation(newUrl).stat();
			stopLoading();
			/**
			 * CASES:
			 * CASE 111: src is file and parent is collapsed where target is also collapsed
			 * CASE 110: src is file and parent is collapsed where target is unclasped
			 * CASE 101: src is file and parent is unclasped where target is collapsed
			 * CASE 100: src is file and parent is unclasped where target is also unclasped
			 * CASE 011: src is directory and parent is collapsed where target is also collapsed
			 * CASE 001: src is directory and parent is unclasped where target is also collapsed
			 * CASE 010: src is directory and parent is collapsed where target is also unclasped
			 * CASE 000: src is directory and parent is unclasped where target is also unclasped
			 */

			if (clipBoard.action === "cut") {
				//move

				if (IS_FILE) {
					const file = editorManager.getFile(clipBoard.url, "uri");
					if (file) file.uri = newUrl;
				} else if (IS_DIR) {
					helpers.updateUriOfAllActiveFiles(clipBoard.url, newUrl);
				}

				switch (CASE) {
					case "111":
					case "011":
						break;

					case "110":
						appendTile($target, createFileTile(newName, newUrl));
						break;

					case "101":
						$src.remove();
						break;

					case "100":
						appendTile($target, createFileTile(newName, newUrl));
						$src.remove();
						break;

					case "001":
						$src.parentElement.remove();
						break;

					case "010":
						appendList($target, createFolderTile(newName, newUrl));
						break;

					case "000":
						appendList($target, createFolderTile(newName, newUrl));
						$src.parentElement.remove();
						break;

					default:
						break;
				}
				FileList.remove(clipBoard.url);
			} else {
				//copy

				switch (CASE) {
					case "111":
					case "101":
					case "011":
					case "001":
						break;

					case "110":
					case "100":
						appendTile($target, createFileTile(newName, newUrl));
						break;

					case "010":
					case "000":
						appendList($target, createFolderTile(newName, newUrl));
						break;

					default:
						break;
				}
			}

			FileList.append(url, newUrl);
			toast(strings.success);
			clearClipboard();
		} catch (error) {
			console.error(error);
			helpers.error(error);
		} finally {
			stopLoading();
		}
	}

	async function insertFile() {
		startLoading();
		try {
			const file = await FileBrowser("file", strings["insert file"]);
			const sourceFs = fsOperation(file.url);
			const data = await sourceFs.readFile();
			const sourceStats = await sourceFs.stat();
			const insertedFile = await fsOperation(url).createFile(
				sourceStats.name,
				data,
			);
			appendTile($target, createFileTile(sourceStats.name, insertedFile));
			FileList.append(url, insertedFile);
		} catch (error) {
		} finally {
			stopLoading();
		}
	}

	async function clipBoardAction() {
		clipBoard.url = url;
		clipBoard.action = action;
		clipBoard.$el = $target;

		if (action === "cut") $target.classList.add("cut");
		else $target.classList.remove("cut");
	}

	async function open() {
		FileBrowser.openFolder({
			url,
			name,
		});
	}

	function cancelAction() {
		clipBoard.$el.classList.remove("cut");
		clearClipboard();
	}

	function clearClipboard() {
		clipBoard.$el = null;
		clipBoard.url = null;
		clipBoard.action = null;
	}
}

/**
 *
 * @param {"file"|"dir"|"root"} type
 * @param {string} url
 */
function handleClick(type, uri) {
	if (!helpers.isFile(type)) return;
	openFile(uri, { render: true });
	Sidebar.hide();
}

/**
 * Insert a file into the list
 * @param {HTMLElement} $target
 * @param {HTMLElement} $tile
 */
function appendTile($target, $tile) {
	$target = $target.nextElementSibling;
	const $firstTile = $target.get(":scope>[type=file]");
	if ($firstTile) $target.insertBefore($tile, $firstTile);
	else $target.append($tile);
}

/**
 * Insert folder into the list
 * @param {HTMLElement} $target The target element
 * @param {HTMLElement} $list The tile to be inserted
 */
function appendList($target, $list) {
	$target = $target.nextElementSibling;
	const $firstList = $target.firstElementChild;
	if ($firstList) $target.insertBefore($list, $firstList);
	else $target.append($list);
}

/**
 * Create a folder tile
 * @param {string} name
 * @param {string} url
 * @returns {HTMLElement}
 */
function createFolderTile(name, url) {
	const $list = collapsableList(name, "folder", {
		ontoggle: () => expandList($list),
	});
	const { $title } = $list;
	$title.dataset.url = url;
	$title.dataset.name = name;
	$title.dataset.type = "dir";

	return $list;
}

/**
 * Create a file tile
 * @param {string} name
 * @param {string} url
 * @returns {HTMLElement}
 */
function createFileTile(name, url) {
	const $tile = tile({
		lead: <span className={helpers.getIconForFile(name)}></span>,
		text: name,
	});
	$tile.dataset.url = url;
	$tile.dataset.name = name;
	$tile.dataset.type = "file";

	return $tile;
}

/**
 * Add file or folder to the list if expanded
 * @param {string} url Url of file or folder to add
 * @param {'file'|'folder'} type is file or folder
 */
openFolder.add = async (url, type) => {
	const { url: parent } = await fsOperation(Url.dirname(url)).stat();
	FileList.append(parent, url);

	const filesApp = sidebarApps.get("files");
	const $els = filesApp.getAll(`[data-url="${parent}"]`);
	Array.from($els).forEach(($el) => {
		if ($el.dataset.type !== "dir") return;

		if (type === "file") {
			appendTile($el, createFileTile(Url.basename(url), url));
		} else {
			appendList($el, createFolderTile(Url.basename(url), url));
		}
	});
};

openFolder.renameItem = (oldFile, newFile, newFilename) => {
	FileList.rename(oldFile, newFile);

	helpers.updateUriOfAllActiveFiles(oldFile, newFile);

	const filesApp = sidebarApps.get("files");
	const $els = filesApp.getAll(`[data-url="${oldFile}"]`);
	Array.from($els).forEach(($el) => {
		if ($el.dataset.type === "dir") {
			$el = $el.$title;
			setTimeout(() => {
				$el.collapse();
				$el.expand();
			}, 0);
		} else {
			$el.querySelector(":scope>span").className =
				helpers.getIconForFile(newFilename);
		}

		$el.dataset.url = newFile;
		$el.dataset.name = newFilename;
		$el.querySelector(":scope>.text").textContent = newFilename;
	});
};

openFolder.removeItem = (url) => {
	FileList.remove(url);
	const folder = addedFolder.find(({ url: fUrl }) => url === fUrl);

	if (folder) {
		folder.remove();
		return;
	}

	const filesApp = sidebarApps.get("files");
	const $el = filesApp.getAll(`[data-url="${url}"]`);
	Array.from($el).forEach(($el) => {
		const type = $el.dataset.type;
		if (helpers.isFile(type)) {
			$el.remove();
		} else {
			$el.parentElement.remove();
		}
	});
};

openFolder.removeFolders = (url) => {
	({ url } = Url.parse(url));
	const regex = new RegExp("^" + escapeStringRegexp(url));
	addedFolder.forEach((folder) => {
		if (regex.test(folder.url)) {
			folder.remove();
		}
	});
};

/**
 * Find the folder that contains the url
 * @param {String} url
 * @returns {Folder}
 */
openFolder.find = (url) => {
	const found = addedFolder.find((folder) => folder.url === url);
	if (found) return found;
	return addedFolder.find((folder) => {
		const { url: furl } = Url.parse(folder.url);
		const regex = new RegExp("^" + escapeStringRegexp(furl));
		return regex.test(url);
	});
};

export default openFolder;
