import fsOperation from "fileSystem";
import sidebarApps from "sidebarApps";
import fileSelection from "sidebarApps/files/selection";
import collapsableList from "components/collapsableList";
import FileTree from "components/fileTree";
import Sidebar from "components/sidebar";
import tile from "components/tile";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import escapeStringRegexp from "escape-string-regexp";
import tag from "html-tag-js";
import fileIcons from "lib/fileIcons";
import copyEntry from "utils/copyEntry";
import { isExcludedFileOperationPath } from "utils/fileOperationExclusions";
import helpers from "utils/helpers";
import Path from "utils/Path";
import Uri from "utils/Uri";
import Url from "utils/Url";
import config from "./config";
import * as FileList from "./fileList";
import { loadFileBrowser } from "./lazyImports";
import openFile from "./openFile";
import recents from "./recents";
import appSettings from "./settings";

const isTermuxSafUri = (value = "") =>
	value.startsWith("content://com.termux.documents/tree/");
const isAcodeTerminalPublicSafUri = (value = "") =>
	value.startsWith("content://com.foxdebug.acode.documents/tree/");
const isTerminalSafUri = (value = "") =>
	isTermuxSafUri(value) || isAcodeTerminalPublicSafUri(value);

const getTerminalPaths = () => {
	const packageName = window.BuildInfo?.packageName || "com.foxdebug.acode";
	const dataDir = `/data/user/0/${packageName}`;
	const alpineRoot = `${dataDir}/files/alpine`;
	const publicDir = `${dataDir}/files/public`;
	return { alpineRoot, publicDir, dataDir };
};

const isTerminalAccessiblePath = (url = "") => {
	if (isAcodeTerminalPublicSafUri(url)) return true;
	const { alpineRoot, publicDir } = getTerminalPaths();
	const cleanUrl = url.replace(/^file:\/\//, "");
	if (cleanUrl.startsWith(alpineRoot) || cleanUrl.startsWith(publicDir)) {
		return true;
	}
	return false;
};

const convertToProotPath = (url = "") => {
	const { alpineRoot, publicDir } = getTerminalPaths();
	if (isAcodeTerminalPublicSafUri(url)) {
		try {
			const { docId } = Uri.parse(url);
			const cleanDocId = /::/.test(url)
				? decodeURIComponent(docId || "")
				: docId || "";
			if (!cleanDocId) return "/public";
			if (cleanDocId.startsWith(publicDir)) {
				return cleanDocId.replace(publicDir, "/public") || "/public";
			}
			if (cleanDocId.startsWith("/public")) {
				return cleanDocId;
			}
			if (cleanDocId.startsWith("public:")) {
				const relativePath = cleanDocId.slice("public:".length);
				return relativePath ? Path.join("/public", relativePath) : "/public";
			}
			const relativePath = cleanDocId
				.replace(/^\/+/, "")
				.replace(/^public\//, "");
			return relativePath ? Path.join("/public", relativePath) : "/public";
		} catch (error) {
			console.warn(
				`Failed to parse public SAF URI for terminal conversion: ${url}`,
			);
			return "/public";
		}
	}
	const cleanUrl = url.replace(/^file:\/\//, "");
	if (cleanUrl.startsWith(publicDir)) {
		return cleanUrl.replace(publicDir, "/public");
	}
	if (cleanUrl.startsWith(alpineRoot)) {
		return cleanUrl.replace(alpineRoot, "") || "/";
	}
	console.warn(`Unrecognized path for terminal conversion: ${url}`);
	return cleanUrl;
};

/**
 * @typedef {import('../components/collapsableList').Collapsible} Collapsible
 */

/**
 * @typedef {object} ClipBoardItem
 * @property {string} url
 * @property {"file"|"dir"} type
 */

/**
 * @typedef {object} ClipBoard
 * @property {ClipBoardItem[]} items
 * @property {"cut"|"copy"|null} action
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
/**
 * Shared by every open folder so entries can be pasted across roots.
 * @type {ClipBoard}
 */
const clipBoard = { items: [], action: null };
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
		tail: createRootActions(() => $root),
		ontoggle: () => {
			setFolderLeadIcon($root, title, { isRoot: true });
			expandList($root);
			// Folders also expand without a header tap (saved state, header
			// actions, drag hover), so size them here rather than on click only.
			// Only on expand: sizing collapses the other folders, and doing it on
			// collapse would undo the folder that just opened.
			// Imported lazily: the files app reads `strings` when it loads.
			if ($root.unclasped) {
				import("sidebarApps/files")
					.then(({ fixHeight }) => {
						// It may have closed again while the module loaded.
						if ($root.unclasped) fixHeight($root);
					})
					.catch(console.error);
			}
		},
	});
	setFolderLeadIcon($root, title, { isRoot: true });
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
		clipBoard,
		reload() {
			$root.collapse();
			$root.expand();
		},
	};

	if (typeof listFiles !== "boolean") {
		listFiles = appSettings.value.fileBrowser?.listFiles ?? true;
	}

	folder.listFiles = listFiles;
	addedFolder.push(folder);

	editorManager.emit("update", "add-folder");
	editorManager.onupdate("add-folder", event);
	editorManager.emit("add-folder", event);

	if (listFiles) {
		FileList.addRoot({ url: _path, name: title }).catch((err) => {
			console.error("Failed to add root to FileList:", err);
		});
	}

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

		FileList.remove(_path);
		const index = addedFolder.findIndex((folder) => folder.url === _path);
		if (index !== -1) addedFolder.splice(index, 1);
		editorManager.emit("update", "remove-folder");
		editorManager.onupdate("remove-folder", event);
		editorManager.emit("remove-folder", event);
	}
}

/**
 * Quick actions on an open folder's header. With a mouse they appear on
 * hover; on touch a single button opens the folder's menu (the same one as a
 * long press), so idle headers stay clean.
 * @param {() => Collapsible} getRoot
 * @returns {HTMLElement}
 */
function createRootActions(getRoot) {
	const $actions = tag("span", { className: "root-actions" });
	const buttons = [
		["new file", "document-add", strings["new file"]],
		["new folder", "folder-add", strings["new folder"]],
		["refresh", "autorenew", strings.refresh],
		["collapse-all", "expand_less", strings["collapse all"] || "Collapse all"],
		["menu", "more_vert more-actions", strings.more],
	];

	for (const [action, icon, title] of buttons) {
		// tile children only receive clicks when they carry data-action.
		const $button = tag("span", { className: `icon ${icon}`, title });
		$button.dataset.action = action;
		$actions.append($button);
	}

	$actions.addEventListener("click", (e) => {
		const $button = e.target.closest("[data-action]");
		if (!$button) return;
		e.preventDefault();
		e.stopPropagation();

		const $root = getRoot();
		const { action } = $button.dataset;
		if (action === "menu") {
			const { url, name } = $root.$title.dataset;
			handleContextmenu("root", url, name, $root.$title);
			return;
		}

		runRootAction($root, action, $button).catch(helpers.error);
	});

	return $actions;
}

/**
 * @param {Collapsible} $root
 * @param {string} action
 * @param {HTMLElement} [$button]
 */
async function runRootAction($root, action, $button) {
	const { url, name } = $root.$title.dataset;

	switch (action) {
		case "new file":
		case "new folder":
			if ($root.collapsed) $root.expand();
			return execOperation("root", action, url, $root.$title, name);

		case "refresh": {
			if ($root.collapsed) {
				$root.expand();
				return;
			}
			$button?.classList.add("spinning");
			try {
				await getLoadedFileTree($root.$title)?.refresh();
			} finally {
				$button?.classList.remove("spinning");
			}
			return;
		}

		case "collapse-all": {
			// Deepest first, so each folder records its own collapsed state.
			const $open = Array.from(
				$root.$ul.querySelectorAll(".list.collapsible:not(.hidden)"),
			).reverse();
			for (const $list of $open) $list.collapse();
			return;
		}
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

	// Cleanup existing file tree, including one still loading: toggling while
	// it loads would otherwise render both trees into the same list.
	for (const tree of [$ul._fileTree, $ul._pendingFileTree]) tree?.destroy();
	$ul._fileTree = null;
	$ul._pendingFileTree = null;
	$ul.innerHTML = "";

	if (saveState) listState[url] = $list.unclasped;
	if (!$list.unclasped) return;

	let fileTree;
	try {
		startLoading();

		fileTree = new FileTree($ul, {
			getEntries: (dirUrl) => fsOperation(dirUrl).lsDir(),
			expandedState: listState,
			onExpandedChange: (folderUrl, isExpanded) => {
				if (saveState) listState[folderUrl] = isExpanded;
			},
			onFileClick: (fileUrl) => {
				handleClick("file", fileUrl);
			},
			onContextMenu: (type, itemUrl, name, $target) => {
				handleContextmenu(type, itemUrl, name, $target);
			},
		});

		$ul._pendingFileTree = fileTree;
		await fileTree.load(url);
		// A later toggle replaced this tree while it loaded.
		if ($ul._pendingFileTree !== fileTree) return;
		$ul._pendingFileTree = null;
		$ul._fileTree = fileTree;
	} catch (err) {
		// A newer toggle owns the list now; don't collapse it.
		if ($ul._pendingFileTree !== fileTree) return;
		$ul._pendingFileTree = null;
		$list.collapse();
		if (err?.includes?.("Invalid message length")) {
			console.error(err);
			toast("SFTP connection broken. Restart the app");
			return;
		}
		helpers.error(err);
	} finally {
		// Leave the loading bar to a newer load that is still running.
		if (!$ul._pendingFileTree) stopLoading();
	}
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
		navigator.vibrate(config.VIBRATION_TIME);
	}
	const { $node } = openFolder.find(url);
	const hasClipboard = clipBoard.items.length > 0;
	const cancel = `${strings.cancel}${hasClipboard ? ` (${strings[clipBoard.action]})` : ""}`;
	const SELECT = ["select", strings.select, "check_circle_outline"];
	const COPY = ["copy", strings.copy, "copy"];
	const CUT = ["cut", strings.cut, "cut"];
	const COPY_RELATIVE_PATH = [
		"copy-relative-path",
		strings["copy relative path"],
		"attach_file",
	];
	const REMOVE = ["delete", strings.delete, "delete"];
	const RENAME = ["rename", strings.rename, "edit"];
	const PASTE = ["paste", strings.paste, "paste", hasClipboard];
	const NEW_FILE = ["new file", strings["new file"], "document-add"];
	const NEW_FOLDER = ["new folder", strings["new folder"], "folder-add"];
	const CANCEL = ["cancel", cancel, "clearclose"];
	const OPEN_FOLDER = ["open-folder", strings["open folder"], "folder"];
	const INSERT_FILE = ["insert-file", strings["insert file"], "file_copy"];
	const CLOSE_FOLDER = ["close", strings["close"], "folder-remove"];
	const REFRESH = ["refresh", strings.refresh, "autorenew"];
	const COLLAPSE_ALL = [
		"collapse-all",
		strings["collapse all"] || "Collapse all",
		"expand_less",
	];
	const INSTALL_PLUGIN = [
		"install-plugin",
		strings["install as plugin"] || "Install as Plugin",
		"extension",
	];
	const OPEN_SSH_TERMINAL = [
		"open-ssh-terminal",
		strings["open ssh terminal"] || "Open SSH Terminal",
		"terminal",
	];

	let options;

	if (helpers.isFile(type)) {
		options = [SELECT, COPY, CUT, COPY_RELATIVE_PATH, RENAME, REMOVE];
		if (
			url.toLowerCase().endsWith(".zip") &&
			(await fsOperation(
				Url.dirname(url) + ACODE_PLUGIN_MANIFEST_FILE,
			).exists())
		) {
			options.push(INSTALL_PLUGIN);
		}
	} else if (helpers.isDir(type)) {
		options = [SELECT, COPY, CUT, COPY_RELATIVE_PATH, REMOVE, RENAME];

		if (hasClipboard) {
			options.push(PASTE);
		}

		options.push(NEW_FILE, NEW_FOLDER, OPEN_FOLDER, INSERT_FILE);

		if (isTerminalAccessiblePath(url)) {
			const OPEN_IN_TERMINAL = [
				"open-in-terminal",
				strings["open in terminal"] || "Open in Terminal",
				"terminal",
			];
			options.push(OPEN_IN_TERMINAL);
		} else if (/^sftp:/.test(url)) {
			options.push(OPEN_SSH_TERMINAL);
		}
	} else if (type === "root") {
		options = [];

		if (hasClipboard) {
			options.push(PASTE);
		}

		options.push(NEW_FILE, NEW_FOLDER, INSERT_FILE);

		if (isTerminalAccessiblePath(url)) {
			const OPEN_IN_TERMINAL = [
				"open-in-terminal",
				strings["open in terminal"] || "Open in Terminal",
				"terminal",
			];
			options.push(OPEN_IN_TERMINAL);
		} else if (/^sftp:/.test(url)) {
			options.push(OPEN_SSH_TERMINAL);
		}

		options.push(REFRESH, COLLAPSE_ALL, CLOSE_FOLDER);
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
 * @param {"select"|"copy"|"cut"|"delete"|"rename"|"paste"|"new file"|"new folder"|"cancel"|"open-folder"|"install-plugin"|"open-in-terminal"|"open-ssh-terminal"|"copy-relative-path"} action
 * @param {string} url target url
 * @param {HTMLElement} $target target element
 * @param {string} name Name of file or folder
 */
function execOperation(type, action, url, $target, name) {
	const { $node, remove, url: rootUrl } = openFolder.find(url);
	const startLoading = () => $node.$title.classList.add("loading");
	const stopLoading = () => $node.$title.classList.remove("loading");

	switch (action) {
		case "select":
			return fileSelection.start($target);

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

		case "open-in-terminal":
			return openInTerminal();

		case "open-ssh-terminal":
			return openSshTerminal();

		case "refresh":
		case "collapse-all":
			return runRootAction($node, action);

		case "copy-relative-path":
			return copyRelativePath();
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

	async function copyRelativePath() {
		try {
			// Validate inputs
			if (!url) {
				console.error("File path not available");
				return;
			}

			if (!rootUrl) {
				console.error("Root folder not found");
				return;
			}

			const relativePath = getRelativePath(url, rootUrl);

			if (!relativePath) {
				console.error("Unable to calculate relative path");
				return;
			}

			copyText(relativePath);
		} catch (error) {
			console.error("Failed to copy relative path:", error);
		}
	}

	async function openInTerminal() {
		try {
			const { TerminalManager } = await import(
				/* webpackChunkName: "terminal" */ "components/terminal"
			);
			const prootPath = convertToProotPath(url);
			const terminal = await TerminalManager.createTerminal({
				name: `Terminal - ${name}`,
				render: true,
			});
			if (terminal?.component) {
				const waitForConnection = (timeoutMs = 5000) =>
					new Promise((resolve, reject) => {
						const startTime = Date.now();
						const check = () => {
							if (terminal.component.isConnected) {
								resolve();
							} else if (Date.now() - startTime > timeoutMs) {
								reject(new Error("Terminal connection timeout"));
							} else {
								setTimeout(check, 50);
							}
						};
						check();
					});
				await waitForConnection();
				terminal.component.write(`cd ${JSON.stringify(prootPath)}\n`);
				Sidebar.hide();
			}
		} catch (error) {
			console.error("Failed to open terminal:", error);
			const errorMsg = error.message || "Unknown error occurred";
			toast(`Failed to open terminal: ${errorMsg}`);
		}
	}

	async function openSshTerminal() {
		try {
			const { TerminalManager } = await import(
				/* webpackChunkName: "terminal" */ "components/terminal"
			);
			await TerminalManager.createRemoteTerminal({ url, name });
			Sidebar.hide();
		} catch (error) {
			console.error("Failed to open SSH terminal:", error);
			toast(`Failed to open SSH terminal: ${error.message || "Unknown error"}`);
		}
	}

	async function deleteFile() {
		const msg = strings["delete entry"].replace("{name}", name);
		const confirmation = await confirm(strings.warning, msg);
		if (!confirmation) return;
		startLoading();
		if (!(await deleteEntry(url, type))) return;
		toast(strings.success);
	}

	async function renameFile() {
		if (isTermuxSafUri(url) && !helpers.isFile(type)) {
			alert(strings.warning, strings["rename not supported"]);
			return;
		}
		let newName = await prompt(
			strings.rename,
			name,
			helpers.isFile(type) ? "filename" : "text",
			{
				match: config.FILE_NAME_REGEX,
				required: true,
			},
		);

		newName = helpers.fixFilename(newName);
		if (!newName || newName === name) return;

		startLoading();
		const fs = fsOperation(url);
		let newUrl;

		if (isTermuxSafUri(url) && helpers.isFile(type)) {
			// Special handling for Termux SAF content files
			const newFilePath = Url.join(Url.dirname(url), newName);
			const content = await fs.readFile();
			await fsOperation(Url.dirname(url)).createFile(newName, content);
			await fs.delete();
			newUrl = newFilePath;
		} else {
			newUrl = await fs.renameTo(newName);
		}

		newName = Url.basename(newUrl);
		if (helpers.isFile(type)) {
			let file = editorManager.getFile(url, "uri");
			if (file) {
				file.uri = newUrl;
				file.filename = newName;
			}
		} else {
			helpers.updateUriOfAllActiveFiles(url, newUrl);
		}
		FileList.rename(url, newUrl);
		await refreshRenamedEntryInOpenFolders(url, newUrl);
		toast(strings.success);
	}

	async function createNew() {
		const msg =
			action === "new file"
				? strings["enter file name"]
				: strings["enter folder name"];

		let newName = await prompt(msg, "", "text", {
			match: config.FILE_NAME_REGEX,
			required: true,
		});

		newName = helpers.fixFilename(newName);
		if (!newName) return;
		startLoading();
		try {
			const isNestedPath = newName.split("/").filter(Boolean).length > 1;
			let newUrl;

			if (action === "new file") {
				newUrl = await helpers.createFileStructure(url, newName);
			} else {
				newUrl = await helpers.createFileStructure(url, newName, false);
			}
			if (!newUrl.created) return;

			if (isNestedPath) {
				await refreshOpenFolder(url);
				FileList.append(newUrl.parentUri, newUrl.uri);
				toast(strings.success);
				return;
			}

			newName = Url.basename(newUrl.uri);
			appendEntryToOpenFolder(url, newUrl.uri, newUrl.type);

			FileList.append(url, newUrl.uri);
			toast(strings.success);
		} catch (error) {
			helpers.error(error);
		} finally {
			stopLoading();
		}
	}

	async function paste() {
		if (!clipBoard.items.length) {
			alert(strings.warning, "Nothing to paste");
			return;
		}

		const { action: pasteAction, items } = clipBoard;

		startLoading();
		try {
			const { pasted, remaining, error } = await pasteEntries(
				items,
				url,
				pasteAction,
			);

			// Keep skipped or failed entries so the paste can be retried.
			if (remaining.length) setClipboard(remaining, pasteAction);
			else clearClipboard();

			if (error) helpers.error(error);
			else if (pasted) toast(strings.success);
		} finally {
			stopLoading();
		}
	}

	async function insertFile() {
		startLoading();
		try {
			const FileBrowser = await loadFileBrowser();
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
		setClipboard([{ url, type }], action);
	}

	async function open() {
		const FileBrowser = await loadFileBrowser();
		FileBrowser.openFolder({
			url,
			name,
		});
	}

	function cancelAction() {
		clearClipboard();
	}
}

/**
 * Delete a file or folder and update every view that references it.
 * @param {string} url
 * @param {"file"|"dir"} type
 * @returns {Promise<boolean>} false when the entry no longer exists
 */
async function deleteEntry(url, type) {
	if (!(await fsOperation(url).exists())) return false;
	recents.removeFile(url);
	await deleteFromDisk(url, type);
	if (helpers.isFile(type)) {
		removeEntryFromOpenFolder(url);
		const file = editorManager.getFile(url, "uri");
		if (file) file.uri = null;
		editorManager.onupdate("delete-file");
		editorManager.emit("update", "delete-file");
	} else {
		recents.removeFolder(url);
		helpers.updateUriOfAllActiveFiles(url, null);
		removeEntryFromOpenFolder(url);
		editorManager.onupdate("delete-folder");
		editorManager.emit("update", "delete-folder");
	}

	FileList.remove(url);
	return true;
}

/**
 * Remove a file or folder from its file system without touching any views.
 * @param {string} url
 * @param {"file"|"dir"} type
 */
async function deleteFromDisk(url, type) {
	if (!helpers.isDir(type) || !isTerminalSafUri(url)) {
		await fsOperation(url).delete();
		return;
	}

	// Terminal SAF providers can't delete non-empty folders.
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

/**
 * Paste entries one by one so a failure doesn't stop the rest.
 * @param {ClipBoardItem[]} items
 * @param {string} targetUrl
 * @param {"cut"|"copy"} action
 * @returns {Promise<{pasted: number, remaining: ClipBoardItem[], error?: Error}>}
 * `remaining` holds the entries that were skipped or failed.
 */
async function pasteEntries(items, targetUrl, action) {
	const remaining = [];
	let pasted = 0;
	let error;

	for (const item of items) {
		try {
			if (await pasteEntry(item, targetUrl, action)) {
				pasted++;
				continue;
			}
		} catch (err) {
			console.error(err);
			error = err;
		}
		remaining.push(item);
	}

	return { pasted, remaining, error };
}

/**
 * Identify the connection a url belongs to. Providers can only move or copy
 * within their own connection (e.g. one SFTP server or one SAF tree).
 * @param {string} url
 * @returns {string}
 */
function getConnectionKey(url) {
	const { url: parsedUrl } = Url.parse(url);
	const protocol = Url.getProtocol(parsedUrl);

	if (!protocol || protocol === "file:") return "file:";

	if (protocol === "content:") {
		try {
			return `content:${Uri.parse(parsedUrl).rootUri}`;
		} catch (error) {
			return parsedUrl;
		}
	}

	const { username, hostname, port } = Url.decodeUrl(parsedUrl);
	return `${protocol}//${username || ""}@${hostname}:${port || ""}`;
}

/**
 * Paste a clipboard entry into a folder.
 * @param {ClipBoardItem} item
 * @param {string} targetUrl
 * @param {"cut"|"copy"} action
 * @returns {Promise<string|null>} New url, or null when skipped
 */
async function pasteEntry({ url: srcUrl, type: srcType }, targetUrl, action) {
	const IS_FILE = helpers.isFile(srcType);
	const IS_DIR = helpers.isDir(srcType);

	// Prevent pasting a folder into itself or its subdirectories
	if (IS_DIR) {
		const sourcePath = Url.parse(srcUrl).url;
		const targetPath = Url.parse(targetUrl).url;

		if (sourcePath === targetPath) {
			alert(strings.warning, "Cannot paste a folder into itself");
			return null;
		}

		if (
			targetPath.startsWith(sourcePath + "/") ||
			targetPath.startsWith(sourcePath + "\\")
		) {
			alert(strings.warning, "Cannot paste a folder into its subdirectory");
			return null;
		}
	}

	const fs = fsOperation(srcUrl);
	const itemName = Url.basename(srcUrl);
	const possibleConflictUrl = Url.join(targetUrl, itemName);
	const doesExist = await fsOperation(possibleConflictUrl).exists();
	if (doesExist) {
		const confirmation = await confirm(
			strings.warning,
			strings["already exists"]
				? strings["already exists"].replace("{name}", itemName)
				: `"${itemName}" already exists in this location.`,
		);
		if (!confirmation) return null;
	}

	const excludePatterns =
		action === "copy" && appSettings.value.useFileOperationExclusions
			? appSettings.value.excludeFolders
			: null;

	let newUrl;
	if (getConnectionKey(srcUrl) !== getConnectionKey(targetUrl)) {
		// Different servers or storage: read from the source and write to the
		// target, since the source provider can't reach the target.
		// Check exclusions first so a skipped entry never replaces anything.
		if (
			excludePatterns &&
			isExcludedFileOperationPath(srcUrl, excludePatterns)
		) {
			toast(strings.skipped);
			return null;
		}

		if (doesExist && IS_FILE) {
			// copyEntry only creates new files, so overwrite the confirmed one.
			await fsOperation(possibleConflictUrl).writeFile(await fs.readFile());
			newUrl = possibleConflictUrl;
		} else {
			if (doesExist) {
				// The user confirmed replacing what's there.
				const { isDirectory } = await fsOperation(possibleConflictUrl).stat();
				await deleteFromDisk(possibleConflictUrl, isDirectory ? "dir" : "file");
			}
			const result = await copyEntry(srcUrl, targetUrl, {
				excludePatterns: excludePatterns || [],
			});
			newUrl = result.url;
		}
		if (newUrl && action === "cut") await deleteFromDisk(srcUrl, srcType);
	} else if (action === "cut") {
		// Special handling for SAF folders backed by terminal providers - move manually due to SAF limitations
		if (isTerminalSafUri(srcUrl) && IS_DIR) {
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

			newUrl = await moveRecursively(srcUrl, targetUrl);
		} else {
			newUrl = await fs.moveTo(targetUrl);
		}
	} else if (excludePatterns) {
		const result = await copyEntry(srcUrl, targetUrl, { excludePatterns });
		newUrl = result.url;
	} else {
		newUrl = await fs.copyTo(targetUrl);
	}

	if (!newUrl) {
		toast(strings.skipped);
		return null;
	}

	if (action === "cut") {
		if (IS_FILE) {
			const file = editorManager.getFile(srcUrl, "uri");
			if (file) file.uri = newUrl;
		} else if (IS_DIR) {
			helpers.updateUriOfAllActiveFiles(srcUrl, newUrl);
			migrateOpenFolderStateUrls(srcUrl, newUrl);
		}
		removeEntryFromOpenFolder(srcUrl);
		FileList.rename(srcUrl, newUrl);
	} else {
		FileList.append(targetUrl, newUrl);
	}

	appendEntryToOpenFolder(targetUrl, newUrl, IS_DIR ? "folder" : "file");
	return newUrl;
}

/**
 * Get the elements currently rendered for an entry.
 * @param {string} url
 * @returns {HTMLElement[]}
 */
function getRenderedEntries(url) {
	const filesApp = sidebarApps.get("files");
	return Array.from(filesApp.getAll(`[data-url="${CSS.escape(url)}"]`));
}

/**
 * @param {ClipBoardItem[]} items
 * @param {"cut"|"copy"} action
 */
function setClipboard(items, action) {
	clearClipboard();
	clipBoard.items = items.map(({ url, type }) => ({ url, type }));
	clipBoard.action = action;

	if (action !== "cut") return;
	for (const { url } of clipBoard.items) {
		for (const $el of getRenderedEntries(url)) $el.classList.add("cut");
	}
}

function clearClipboard() {
	for (const { url } of clipBoard.items) {
		for (const $el of getRenderedEntries(url)) $el.classList.remove("cut");
	}
	clipBoard.items = [];
	clipBoard.action = null;
}

/**
 * Get the path of an entry relative to its open folder.
 * @param {string} url
 * @param {string} rootUrl
 * @returns {string}
 */
function getRelativePath(url, rootUrl) {
	// Try using Url.pathname for protocol-based URLs
	const rootPath = Url.pathname(rootUrl);
	const targetPath = Url.pathname(url);

	if (rootPath && targetPath) {
		// Both pathnames extracted successfully
		return Path.convertToRelative(rootPath, targetPath);
	}

	// Fallback: Use simple string comparison for URIs where pathname extraction fails
	const cleanRoot = rootUrl.endsWith("/") ? rootUrl.slice(0, -1) : rootUrl;
	const cleanTarget = url.endsWith("/") ? url.slice(0, -1) : url;

	// Check if target URL starts with root URL
	if (cleanTarget.startsWith(cleanRoot)) {
		return cleanTarget.slice(cleanRoot.length + 1);
	}

	// If not a child path, just use basename
	return Url.basename(url);
}

/**
 * @param {string} text
 * @returns {boolean} Whether the text was copied
 */
function copyText(text) {
	if (cordova.plugins.clipboard) {
		cordova.plugins.clipboard.copy(text);
		return true;
	}

	console.error("Clipboard not available");
	toast("Clipboard not available");
	return false;
}

/**
 * Drop entries that are already covered by a selected parent folder.
 * @template {ClipBoardItem} T
 * @param {T[]} items
 * @returns {T[]}
 */
function removeNestedItems(items) {
	return items.filter(
		(item) =>
			!items.some(
				(other) =>
					other !== item &&
					helpers.isDir(other.type) &&
					!areSameOpenFolderUrl(other.url, item.url) &&
					isInsideOpenFolder(item.url, other.url),
			),
	);
}

/**
 * Run an action from the file selection bar.
 * @param {import("sidebarApps/files/selection").SelectionAction} action
 * @param {import("sidebarApps/files/selection").SelectedEntry[]} items
 * @param {string} [targetUrl] Destination folder for "move"
 * @returns {Promise<boolean|void>} false keeps the selection open
 */
async function handleSelectionAction(action, items, targetUrl) {
	// Entries inside a selected folder are handled with the folder, but open
	// and copy path still act on everything that was picked.
	if (["copy", "cut", "delete", "move"].includes(action)) {
		items = removeNestedItems(items);
	}

	switch (action) {
		case "copy":
		case "cut":
			setClipboard(items, action);
			return;

		case "delete":
			return deleteEntries(items);

		case "move":
			return moveEntries(items, targetUrl);

		case "copy-path": {
			const paths = items.map(({ url }) =>
				getRelativePath(url, openFolder.find(url)?.url || url),
			);
			if (copyText(paths.join("\n"))) toast(strings["copied to clipboard"]);
			return;
		}

		case "rename": {
			const [{ type, url, $el, name }] = items;
			return execOperation(type, "rename", url, $el, name);
		}

		case "open": {
			const files = items.filter(({ type }) => helpers.isFile(type));
			for (const [index, { url }] of files.entries()) {
				await openFile(url, { render: index === files.length - 1 });
			}
			Sidebar.hide();
			return;
		}
	}
}

/**
 * @param {ClipBoardItem[]} items
 * @returns {Promise<boolean>} false when cancelled
 */
async function deleteEntries(items) {
	const msg = strings["delete entries"].replace("{count}", items.length);
	const confirmation = await confirm(strings.warning, msg);
	if (!confirmation) return false;

	const $titles = new Set(
		items.map(({ url }) => openFolder.find(url)?.$node.$title).filter(Boolean),
	);
	for (const $title of $titles) $title.classList.add("loading");

	let failed = 0;
	let lastError;
	try {
		for (const { url, type } of items) {
			try {
				await deleteEntry(url, type);
			} catch (error) {
				console.error(error);
				failed++;
				lastError = error;
			}
		}
	} finally {
		for (const $title of $titles) $title.classList.remove("loading");
	}

	if (failed) helpers.error(lastError);
	else toast(strings.success);
	return true;
}

/**
 * Move entries into a folder, skipping those already there.
 * @param {ClipBoardItem[]} items
 * @param {string} targetUrl
 */
async function moveEntries(items, targetUrl) {
	const movable = items.filter(
		({ url }) => !areSameOpenFolderUrl(getParentUrl(url), targetUrl),
	);
	if (!movable.length) return;

	const $title = openFolder.find(targetUrl)?.$node.$title;
	$title?.classList.add("loading");
	try {
		const { pasted, error } = await pasteEntries(movable, targetUrl, "cut");
		if (error) helpers.error(error);
		else if (pasted) toast(strings.success);
	} finally {
		$title?.classList.remove("loading");
	}
}

fileSelection.onAction(handleSelectionAction);

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
 * Get the active file tree for a folder element, if it has been loaded.
 * @param {HTMLElement} $el
 * @returns {FileTree|null}
 */
function getLoadedFileTree($el) {
	return (
		$el?.$ul?._fileTree || $el?.fileTree || $el?.nextElementSibling?._fileTree
	);
}

function normalizeUrlPathKey(url) {
	if (!url) return url;
	const { url: parsedUrl } = Url.parse(url);

	if (Url.getProtocol(parsedUrl) === "content:") {
		try {
			const { rootUri, docId } = Uri.parse(parsedUrl);
			const normalizedDocId = docId.endsWith("/") ? docId.slice(0, -1) : docId;
			return `${rootUri}::${normalizedDocId}`;
		} catch (error) {
			return parsedUrl;
		}
	}

	if (parsedUrl.endsWith("/") && Url.pathname(parsedUrl) !== "/") {
		return parsedUrl.slice(0, -1);
	}

	return parsedUrl;
}

function areSameOpenFolderUrl(leftUrl, rightUrl) {
	return normalizeUrlPathKey(leftUrl) === normalizeUrlPathKey(rightUrl);
}

function isInsideOpenFolder(url, folderUrl) {
	const urlKey = normalizeUrlPathKey(url);
	const folderKey = normalizeUrlPathKey(folderUrl);
	if (!urlKey || !folderKey) return false;

	return urlKey === folderKey || urlKey.startsWith(`${folderKey}/`);
}

function appendUrlPathSuffix(url, suffix) {
	if (!suffix) return url;
	const { url: parsedUrl, query } = Url.parse(url);
	if (parsedUrl.endsWith("/") && suffix.startsWith("/")) {
		return parsedUrl.slice(0, -1) + suffix + query;
	}
	return parsedUrl + suffix + query;
}

function preserveTrailingSlashShape(url, sourceUrl) {
	const { url: sourcePath } = Url.parse(sourceUrl);
	if (!sourcePath.endsWith("/")) return url;

	const { url: targetPath, query } = Url.parse(url);
	if (targetPath.endsWith("/")) return url;

	return `${targetPath}/${query}`;
}

function getListStateEntries(listState) {
	if (!listState) return [];
	if (listState instanceof Map) return Array.from(listState.entries());
	return Object.entries(listState);
}

function setListStateEntry(listState, key, value) {
	if (listState instanceof Map) {
		listState.set(key, value);
		return;
	}

	listState[key] = value;
}

function deleteListStateEntry(listState, key) {
	if (listState instanceof Map) {
		listState.delete(key);
		return;
	}

	delete listState[key];
}

/**
 * Move saved expanded-state keys after a folder rename.
 * @param {string} oldUrl
 * @param {string} newUrl
 */
function migrateOpenFolderStateUrls(oldUrl, newUrl) {
	if (!oldUrl || !newUrl || areSameOpenFolderUrl(oldUrl, newUrl)) return;

	const oldKey = normalizeUrlPathKey(oldUrl);

	addedFolder.forEach(({ listState }) => {
		const matchingEntries = getListStateEntries(listState).filter(
			([folderUrl]) => {
				return isInsideOpenFolder(folderUrl, oldUrl);
			},
		);

		matchingEntries.forEach(([folderUrl, isExpanded]) => {
			const suffix = normalizeUrlPathKey(folderUrl).slice(oldKey.length);
			const migratedUrl = preserveTrailingSlashShape(
				appendUrlPathSuffix(newUrl, suffix),
				folderUrl,
			);
			deleteListStateEntry(listState, folderUrl);
			setListStateEntry(listState, migratedUrl, isExpanded);
		});
	});
}

function getParentUrl(url) {
	return Url.dirname(url);
}

/**
 * Remove matching rendered entries from expanded folder views.
 * This keeps FileTree's in-memory state aligned with the rendered tree.
 * @param {string} entryUrl
 */
function removeEntryFromOpenFolder(entryUrl) {
	const filesApp = sidebarApps.get("files");
	const $els = Array.from(
		filesApp.getAll(`[data-url="${CSS.escape(entryUrl)}"]`),
	);

	$els.forEach(($el) => {
		const ownerTree =
			$el?.parentElement?._fileTree ||
			$el?.parentElement?.parentElement?._fileTree;

		if (ownerTree) {
			ownerTree.removeEntry(entryUrl);
			return;
		}

		const type = $el.dataset.type;
		if (helpers.isFile(type)) {
			$el.remove();
		} else {
			$el.parentElement?.remove();
		}
	});
}

/**
 * Update matching expanded folder views with a new entry.
 * @param {string} parentUrl
 * @param {string} entryUrl
 * @param {"file"|"folder"} type
 */
function appendEntryToOpenFolder(parentUrl, entryUrl, type) {
	const filesApp = sidebarApps.get("files");
	const $els = filesApp.getAll(`[data-url="${parentUrl}"]`);
	const isDirectory = type === "folder";
	const name = Url.basename(entryUrl);

	Array.from($els).forEach(($el) => {
		if (!(helpers.isDir($el.dataset.type) || $el.dataset.type === "root")) {
			return;
		}

		if (!$el.unclasped) return;

		const fileTree = getLoadedFileTree($el);
		if (fileTree) {
			fileTree.appendEntry(name, entryUrl, isDirectory);
			return;
		}

		if (isDirectory) {
			appendList($el, createFolderTile(name, entryUrl));
		} else {
			appendTile($el, createFileTile(name, entryUrl));
		}
	});
}

/**
 * Refresh matching expanded folder views.
 * @param {string} folderUrl
 */
async function refreshOpenFolder(folderUrl) {
	const folder = openFolder.find(folderUrl);
	if (!folder) return;

	const fileTree = getLoadedFileTree(folder.$node.$title);
	if (!fileTree) return;

	await fileTree.refreshFolder(folderUrl, areSameOpenFolderUrl);
}

/**
 * Refresh affected folder trees after a rename/move.
 * @param {string} oldUrl
 * @param {string} newUrl
 */
async function refreshRenamedEntryInOpenFolders(
	oldUrl,
	newUrl,
	oldParentUrl = getParentUrl(oldUrl),
	newParentUrl = getParentUrl(newUrl),
) {
	if (!oldUrl || !newUrl || areSameOpenFolderUrl(oldUrl, newUrl)) return;

	migrateOpenFolderStateUrls(oldUrl, newUrl);

	const parentUrls = [oldParentUrl, newParentUrl].filter(Boolean);
	const refreshUrls = parentUrls.filter((parentUrl, index) => {
		return !parentUrls.some((otherUrl, otherIndex) => {
			return otherIndex < index && areSameOpenFolderUrl(otherUrl, parentUrl);
		});
	});

	await Promise.all(refreshUrls.map(refreshOpenFolder));
}

/**
 * Create a folder tile
 * @param {string} name
 * @param {string} url
 * @returns {HTMLElement}
 */
function createFolderTile(name, url) {
	const $list = collapsableList(name, "folder", {
		ontoggle: () => {
			setFolderLeadIcon($list, name);
			expandList($list);
		},
	});
	const { $title } = $list;
	$title.dataset.url = url;
	$title.dataset.name = name;
	$title.dataset.type = "dir";
	setFolderLeadIcon($list, name);

	return $list;
}

function setFolderLeadIcon($list, name, options = {}) {
	const $icon = $list.$title?.firstElementChild;
	if (!$icon) return;
	$icon.className = helpers.getIconForFolder(name, {
		expanded: $list.unclasped,
		isRoot: options.isRoot,
	});
}

fileIcons.onChange(() => {
	for (const folder of addedFolder) {
		const $list = folder.$node;
		const name = $list?.$title?.dataset?.name;
		if (!$list || !name) continue;
		setFolderLeadIcon($list, name, { isRoot: true });
	}
});

/**
 * Create a file tile
 * @param {string} name
 * @param {string} url
 * @returns {HTMLElement}
 */
function createFileTile(name, url) {
	const $tile = tile({
		lead: tag("span", { className: helpers.getIconForFile(name) }),
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
	appendEntryToOpenFolder(parent, url, type);
};

openFolder.renameItem = (oldFile, newFile) => {
	FileList.rename(oldFile, newFile);

	helpers.updateUriOfAllActiveFiles(oldFile, newFile);
	refreshRenamedEntryInOpenFolders(oldFile, newFile).catch(helpers.error);
};

openFolder.removeItem = (url) => {
	FileList.remove(url);
	const folder = addedFolder.find(({ url: fUrl }) => url === fUrl);

	if (folder) {
		folder.remove();
		return;
	}

	removeEntryFromOpenFolder(url);
};

openFolder.removeFolders = (url) => {
	({ url } = Url.parse(url));
	// remove() mutates addedFolder, so iterate over a snapshot to avoid skipping
	// adjacent folders that belong to the same remote storage.
	[...addedFolder].forEach((folder) => {
		if (Url.isSameOrDescendant(folder.url, url)) {
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
	const found = addedFolder.find((folder) =>
		areSameOpenFolderUrl(folder.url, url),
	);
	if (found) return found;
	return addedFolder.find((folder) => isInsideOpenFolder(url, folder.url));
};

export default openFolder;
