import fsOperation from "fileSystem";
import toast from "components/toast";
import picomatch from "picomatch/posix";
import Url from "utils/Url";
import { addedFolder } from "./openFolder";
import settings from "./settings";

/**
 * @typedef {import('fileSystem').File} File
 */

const filesTree = {};
const pendingScans = new Set();
const events = {
	"add-file": [],
	"push-file": [],
	"remove-file": [],
	"add-folder": [],
	"remove-folder": [],
	refresh: [],
};

export function initFileList() {
	if (editorManager?.activeFile.loading) {
		editorManager.activeFile.on("loadend", initFileList);
		return;
	}
	// editorManager.on('add-folder', onAddFolder);
	editorManager.on("remove-folder", onRemoveFolder);
	settings.on("update:excludeFolders:after", refresh);
}

/**
 * Add a file to the list
 * @param {string} parent file directory
 * @param {string} child file url
 */
export async function append(parent, child) {
	const tree = getTree(Object.values(filesTree), parent);
	if (!tree || !tree.children) return;

	const childTree = await Tree.create(child);
	tree.children.push(childTree);
	trackScan(getAllFiles(childTree));
	emit("add-file", childTree);
}

/**
 * Remove a file from the list
 * @param {string} item url
 */
export function remove(item) {
	if (filesTree[item]) {
		removeRootTree(item);
		emit("remove-file", item);
		return;
	}

	const tree = getTree(Object.values(filesTree), item);
	if (!tree) return;
	const { parent } = tree;
	const index = parent.children.indexOf(tree);
	parent.children.splice(index, 1);
	emit("remove-file", tree);
}

function removeRootTree(url) {
	const rootUrl = url.endsWith("/") ? url : `${url}/`;
	Object.keys(filesTree).forEach((key) => {
		if (key === url || key.startsWith(rootUrl)) {
			delete filesTree[key];
		}
	});
}

/**
 * Refresh file list
 */
export async function refresh() {
	Object.keys(filesTree).forEach((key) => {
		delete filesTree[key];
	});

	await Promise.all(
		addedFolder.map(async ({ url, title }) => {
			const tree = await Tree.createRoot(url, title);
			filesTree[url] = tree;
			trackScan(getAllFiles(tree));
		}),
	);

	emit("refresh", filesTree);
}

export async function whenReady() {
	await Promise.all([...pendingScans]);
}

/**
 * Renames a tree
 * @param {string} oldUrl
 * @param {string} newUrl
 * @returns
 */
export function rename(oldUrl, newUrl) {
	const tree = getTree(Object.values(filesTree), oldUrl);
	if (!tree) return;

	tree.update(newUrl);
}

/**
 * Get all files in a folder
 * @param {string|()=>object} dir
 * @returns {Tree[]}
 */
export default function files(dir) {
	const listedDirs = [];
	let transform = (item) => item;
	if (typeof dir === "string") {
		for (const item of Object.values(filesTree)) {
			const found = getFile(dir, item);
			if (found) return found;
		}
		return null;
	} else if (typeof dir === "function") {
		transform = dir;
	}

	const allFiles = [];
	Object.values(filesTree).forEach((item) => {
		allFiles.push(...flattenTree(item, transform, listedDirs));
	});
	return allFiles;
}

/**
 * @typedef {'add-file'|'push-file'|'remove-file'|'add-folder'|'remove-folder'|'refresh'} FileListEvent
 */

/**
 * Adds event listener for file list
 * @param {FileListEvent} event - Event name
 * @param {(tree:Tree)=>void} callback - Callback function
 */
files.on = function (event, callback) {
	if (!events[event]) events[event] = [];
	events[event].push(callback);
};

/**
 * Removes event listener for file list
 * @param {FileListEvent} event - Event name
 * @param {(tree:Tree)=>void} callback - Callback function
 */
files.off = function (event, callback) {
	if (!events[event]) return;
	events[event] = events[event].filter((cb) => cb !== callback);
};

/**
 * Get directory tree
 * @param {Tree[]} treeList list of tree
 * @param {string} dir path to find
 * @returns {Tree}
 */
function getTree(treeList, dir) {
	if (!treeList) return;
	let tree = treeList.find(({ url }) => url === dir);
	if (tree) return tree;
	for (const item of treeList) {
		tree = getTree(item.children, dir);
		if (tree) return tree;
	}

	return null;
}

/**
 * Get all files in a folder
 * e.g /dir1/dir2/dir3
 * This function will first test if dir1 exists in the tree,
 * if not, it will return null, otherwise it will traverse the tree
 * and return the files in dir3
 * @param {string} path - Folder path
 * @param {Tree} tree - Files tree
 */
function getFile(path, tree) {
	const { children } = tree;
	let { url } = tree;
	if (url === path) return tree;
	if (!children) return null;
	const len = children.length;
	for (let i = 0; i < len; i++) {
		const item = children[i];
		const result = getFile(path, item);
		if (result) return result;
	}
	return null;
}

/**
 * Get all files
 * @param {Tree} tree
 * @param {(item:Tree)=>object} transform
 */
function flattenTree(tree, transform, listedDirs) {
	const list = [];
	const { children } = tree;
	if (!children) {
		return [transform(tree)];
	}

	if (listedDirs.includes(tree.url)) return list;

	listedDirs.push(tree.url);

	children.forEach((item) => {
		if (item.children) list.push(...flattenTree(item, transform, listedDirs));
		else list.push(transform(item));
	});
	return list;
}

/**
 * Called when a folder is added
 * @param {{url: string, name: string}} folder - Folder path
 */
export async function addRoot({ url, name }) {
	try {
		const TERMUX_STORAGE =
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome::/data/data/com.termux/files/home/storage";
		const TERMUX_SHARED =
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome::/data/data/com.termux/files/home/storage/shared";
		if (url === TERMUX_STORAGE) return;
		if (url === TERMUX_SHARED) return;

		const tree = await Tree.createRoot(url, name);
		filesTree[url] = tree;
		trackScan(getAllFiles(tree, null, { indexContent: false }));
		emit("add-folder", tree);
	} catch (error) {
		// ignore
		window.log("error", error);
	}
}

/**
 * Called when a folder is removed
 * @param {{url: string, name: string}} folder - Folder path
 */
function onRemoveFolder({ url }) {
	const tree = filesTree[url];
	if (!tree) return;
	removeRootTree(url);
	emit("remove-folder", tree);
}

/**
 * Get all file recursively
 * @param {Tree} parent - An array to store files
 * @param {Tree} [root] - Root path
 */
async function getAllFiles(parent, root, options = {}) {
	root = root || parent.root;
	if (!parent.children || !root.isConnected) return;

	if (supportsNativeWorkspace(root.url)) {
		return getAllFilesNative(parent, root, options);
	}

	try {
		const entries = await fsOperation(parent.url).lsDir();
		const promises = [];

		for (const item of entries) {
			promises.push(createChildTree(parent, item, root));
		}

		await Promise.all(promises);
	} catch (error) {
		// retry after 3s
		parent.retriedCount += 1;
		if (parent.retriedCount > settings.value.maxRetryCount) return;
		if (settings.value.showRetryToast) {
			toast(`retrying: ${parent.path}`);
		}

		setTimeout(() => {
			// why not outside? because parent may be removed
			if (!root.isConnected) return;
			parent.children.length = 0;
			getAllFiles(parent, root, options);
		}, 3000);
	}
}

function supportsNativeWorkspace(url = "") {
	return (
		typeof sdcard !== "undefined" &&
		typeof sdcard.workspaceScan === "function" &&
		(/^file:/.test(url) || /^content:/.test(url))
	);
}

async function getAllFilesNative(parent, root, options = {}) {
	const id = `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise((resolve, reject) => {
		let settled = false;

		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			fn(value);
		};

		const cancelIfDisconnected = () => {
			if (root.isConnected) return false;
			try {
				sdcard.workspaceCancel(id);
			} catch (_) {
				// ignore cancellation failures
			}
			finish(resolve);
			return true;
		};

		sdcard.workspaceScan(
			{
				id,
				rootUrl: parent.url,
				title: parent.name,
				excludeFolders: settings.value.excludeFolders,
				showHiddenFiles: !!settings.value.fileBrowser?.showHiddenFiles,
				defaultEncoding: settings.value.defaultFileEncoding,
				indexContent: !!options.indexContent,
			},
			(event) => {
				if (cancelIfDisconnected()) return;
				switch (event?.type || event?.action) {
					case "batch":
						addNativeEntries(root, event.entries || []);
						break;
					case "done":
						finish(resolve);
						break;
					case "error":
						finish(reject, new Error(event.error || "Native scan failed"));
						break;
				}
			},
			(error) => {
				finish(reject, error);
			},
		);
	});
}

function addNativeEntries(root, entries) {
	for (const item of entries) {
		const parentUrl = item.parentUrl || item.parent;
		const parentTree =
			parentUrl === root.url ? root : getTree([root], parentUrl);
		if (!parentTree?.children) continue;
		if (parentTree.children.find(({ url }) => url === item.url)) continue;

		const file = new Tree(
			item.name,
			item.url,
			item.isDirectory,
			item.mime || item.type,
			item.size,
			item.modifiedDate,
		);
		parentTree.children.push(file);

		if (!file.children) {
			emit("push-file", file);
			emit("add-file", file);
		}
	}
}

/**
 * Emit an event
 * @param {string} event
 * @param  {...any} args
 */
function emit(event, ...args) {
	const list = events[event];
	if (!list) return;
	list.forEach((fn) => fn(...args));
}

function trackScan(scan) {
	pendingScans.add(scan);
	scan.finally(() => pendingScans.delete(scan));
	return scan;
}

/**
 * Create a child tree
 * @param {Tree} parent
 * @param {File} item
 * @param {Tree} root
 */
async function createChildTree(parent, item, root) {
	if (!root.isConnected) return;
	const { name, url, isDirectory, mime, type, size, modifiedDate } = item;
	const exists = parent.children.findIndex((child) => child.url === url);
	if (exists > -1) {
		return;
	}

	const file = await Tree.create(
		url,
		name,
		isDirectory,
		mime || type,
		size,
		modifiedDate,
	);
	if (!root.isConnected) return;

	const existingTree = getTree(Object.values(filesTree), file.url);

	if (existingTree) {
		file.children = existingTree.children;
		parent.children.push(file);
		return;
	}

	parent.children.push(file);
	if (isDirectory) {
		const ignore = picomatch.isMatch(
			Url.join(file.path, ""),
			settings.value.excludeFolders,
			{ matchBase: true },
		);
		if (ignore) return;

		await getAllFiles(file, root);
		return;
	}

	emit("push-file", file);
	emit("add-file", file);
}

export class Tree {
	/**@type {string}*/
	#name;
	/**@type {string}*/
	#url;
	/**@type {string}*/
	#path;
	/**@type {Array<Tree>}*/
	#children;
	/**@type {Tree}*/
	#parent;

	retriedCount = 0;

	/**
	 * Create a tree using constructor
	 * @param {string} name
	 * @param {string} root
	 * @param {string} url
	 * @param {boolean} isDirectory
	 */
	constructor(name, url, isDirectory, mime, size, modifiedDate) {
		this.#name = name;
		this.#url = url;
		this.mime = mime || null;
		this.size = size || 0;
		this.modifiedDate = normalizeModifiedDate(modifiedDate);
		this.#children = isDirectory ? this.#childrenArray() : null;
		this.#parent = null;
	}

	#childrenArray() {
		const ar = [];
		const oldPush = ar.push;
		ar.push = (...args) => {
			args.forEach((item) => {
				if (!(item instanceof Tree)) throw new Error("Invalid tree");
				item.parent = this;
				oldPush.call(ar, item);
			});
		};
		return ar;
	}

	/**
	 * Create a tree
	 * @param {string} url file url
	 * @param {string} [name] file name
	 * @param {boolean} [isDirectory] if the file is a directory
	 */
	static async create(url, name, isDirectory, mime, size, modifiedDate) {
		if (!name && !isDirectory) {
			const stat = await fsOperation(url).stat();
			name = stat.name;
			isDirectory = stat.isDirectory;
			mime = stat.mime || stat.type;
			size = stat.size;
			modifiedDate = stat.modifiedDate;
		}

		return new Tree(name, url, isDirectory, mime, size, modifiedDate);
	}

	/**
	 * Create a root tree
	 * @param {string} url
	 * @param {string} name
	 * @returns
	 */
	static async createRoot(url, name) {
		const tree = await Tree.create(url, name, true);
		tree.#path = name;
		return tree;
	}

	/**@returns {string} */
	get name() {
		return this.#name;
	}

	/**@returns {string} */
	get url() {
		return this.#url;
	}

	/**@returns {string} */
	get path() {
		return this.#path;
	}

	/**@returns {Array<Tree>} */
	get children() {
		return this.#children;
	}

	set children(value) {
		if (!Array.isArray(value)) throw new Error("Invalid children");
		this.#children = value;
	}

	/**@returns {Tree} */
	get parent() {
		return this.#parent;
	}

	/**@param {Tree} value */
	set parent(value) {
		if (!(value instanceof Tree)) throw new Error("Invalid parent");
		this.#parent = value;
		if (this.#parent) {
			this.#path = Url.join(this.#parent.path, this.#name);
		}
	}

	/**
	 * Check if the root of the tree is added to the open folder list.
	 * @returns {boolean}
	 */
	get isConnected() {
		const root = this.root;
		return !!addedFolder.find(({ url }) => url === root.url);
	}

	/**
	 * Get the root of the tree
	 * @returns {Tree}
	 */
	get root() {
		let root = this;
		while (root.parent) {
			root = root.parent;
		}
		return root;
	}

	/**
	 * Update tree name and url
	 * @param {string} url
	 * @param {string} [name]
	 */
	update(url, name) {
		if (!name) name = Url.basename(url);
		this.#url = url;
		this.#name = name;
		this.#path = Url.join(this.#parent.path, name);
		trackScan(getAllFiles(this));
	}

	/**
	 * @typedef {object} TreeJson
	 * @property {string} name
	 * @property {string} url
	 * @property {string} path
	 * @property {string} parent
	 * @property {boolean} isDirectory
	 */

	/**
	 * To tree object to json
	 * @returns {TreeJson}
	 */
	toJSON() {
		return {
			name: this.#name,
			url: this.#url,
			path: this.#path,
			parent: this.#parent?.url,
			mime: this.mime,
			size: this.size,
			modifiedDate: this.modifiedDate,
			isDirectory: !!this.#children,
		};
	}

	/**
	 * Create a tree from json
	 * @param {TreeJson} json
	 * @returns {Tree}
	 */
	static fromJSON(json) {
		const { name, url, path, parent, mime, size, modifiedDate, isDirectory } =
			json;
		const tree = new Tree(name, url, isDirectory, mime, size, modifiedDate);
		tree.#parent = getTree(Object.values(filesTree), parent);
		tree.#path = path;
		return tree;
	}
}

function normalizeModifiedDate(value) {
	if (!value) return 0;
	if (typeof value === "number") return value;
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? 0 : time;
}
