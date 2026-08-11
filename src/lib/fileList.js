import fsOperation from "fileSystem";
import toast from "components/toast";
import picomatch from "picomatch/posix";
import Url from "utils/Url";
import fileIndex from "./fileIndex";
import { addedFolder } from "./openFolder";
import settings from "./settings";

/**
 * @deprecated Native SAF and file:// workspaces are available through fileIndex.
 * This module now maintains the compatibility index for non-native providers.
 *
 * @typedef {import('fileSystem').File} File
 */

const filesTree = {};
const pendingScans = new Set();
const activeChildUrls = new WeakMap();
const FALLBACK_SCAN_BATCH_SIZE = 64;
let fallbackScanTail = Promise.resolve();
const events = {
	"add-file": [],
	"push-file": [],
	"remove-file": [],
	"add-folder": [],
	"remove-folder": [],
	refresh: [],
};

export function initFileList() {
	if (editorManager?.activeFile?.loading) {
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
	const nativeRoot = findNativeRoot(parent);
	if (nativeRoot) {
		fileIndex
			.update(nativeRoot, {
				added: [{ url: child, parentUrl: parent }],
			})
			.catch(logNativeIndexError);
		return;
	}

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
	const nativeRoot = findNativeRoot(item);
	if (nativeRoot) {
		if (nativeRoot.url === item) {
			fileIndex.clear([item]).then(
				() => emit("remove-folder", { url: item, native: true }),
				(error) => {
					logNativeIndexError(error);
					emit("remove-folder", { url: item, native: true });
				},
			);
		} else {
			fileIndex
				.update(nativeRoot, { removed: [item] })
				.catch(logNativeIndexError);
		}
		return;
	}

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
		addedFolder
			.filter(({ listFiles }) => listFiles)
			.map(async ({ url, title }) => {
				if (fileIndex.supports(url)) {
					await fileIndex.scan({ url, name: title });
					return;
				}
				const tree = await Tree.createRoot(url, title);
				filesTree[url] = tree;
				trackScan(getAllFiles(tree));
			}),
	);

	emit("refresh", filesTree);
}

export async function whenReady() {
	await Promise.allSettled([...pendingScans, fileIndex.whenReady()]);
}

/**
 * Renames a tree
 * @param {string} oldUrl
 * @param {string} newUrl
 * @returns
 */
export function rename(oldUrl, newUrl) {
	const nativeRoot = findNativeRoot(oldUrl) || findNativeRoot(newUrl);
	if (nativeRoot) {
		fileIndex
			.update(nativeRoot, {
				removed: [oldUrl],
				added: [{ url: newUrl, parentUrl: Url.dirname(newUrl) }],
			})
			.catch(logNativeIndexError);
		return;
	}

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
	const listedDirs = new Set();
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
		flattenTree(item, transform, listedDirs, allFiles);
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
	const pending = [...treeList];
	while (pending.length) {
		const tree = pending.pop();
		if (tree.url === dir) return tree;
		if (tree.children?.length) {
			for (const child of tree.children) pending.push(child);
		}
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
	const pending = [tree];
	while (pending.length) {
		const item = pending.pop();
		if (item.url === path) return item;
		if (item.children?.length) {
			for (const child of item.children) pending.push(child);
		}
	}
	return null;
}

/**
 * Get all files
 * @param {Tree} tree
 * @param {(item:Tree)=>object} transform
 */
function flattenTree(tree, transform, listedDirs, list = []) {
	const pending = [tree];
	while (pending.length) {
		const item = pending.pop();
		if (!item.children) {
			list.push(transform(item));
			continue;
		}
		if (listedDirs.has(item.url)) continue;
		listedDirs.add(item.url);
		for (let i = item.children.length - 1; i >= 0; i -= 1) {
			pending.push(item.children[i]);
		}
	}
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
		if (fileIndex.supports(url)) {
			await fileIndex.scan({ url, name });
			emit("add-folder", { url, name, native: true });
			return;
		}

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
	const previousScan = fallbackScanTail;
	let releaseScan;
	fallbackScanTail = new Promise((resolve) => {
		releaseScan = resolve;
	});

	await previousScan.catch(() => {});
	try {
		return await scanAllFiles(parent, root, options);
	} finally {
		releaseScan();
	}
}

async function scanAllFiles(parent, root, options = {}) {
	root = root || parent.root;
	if (!parent.children || !isFallbackScanActive(root)) return;

	// Compatibility providers such as FTP and SFTP are indexed in JavaScript.
	// Keep one directory request in flight and periodically yield so a large
	// remote workspace cannot monopolize the WebView event loop.
	const directories = [parent];
	const queuedDirectories = new Set([parent.url]);
	let directoryIndex = 0;
	let processedSinceYield = 0;

	while (directoryIndex < directories.length && isFallbackScanActive(root)) {
		const directory = directories[directoryIndex++];
		const entries = await listDirectoryWithRetry(directory, root);
		if (!entries) continue;
		const knownChildren = new Set(directory.children.map((child) => child.url));
		activeChildUrls.set(directory, knownChildren);

		try {
			for (const item of entries) {
				if (!isFallbackScanActive(root)) return;
				const child = await createChildTree(directory, item, root, {
					...options,
					deferDirectories: true,
					knownChildren,
				});
				if (child?.children && !queuedDirectories.has(child.url)) {
					queuedDirectories.add(child.url);
					directories.push(child);
				}

				processedSinceYield += 1;
				if (processedSinceYield >= FALLBACK_SCAN_BATCH_SIZE) {
					processedSinceYield = 0;
					await yieldToMainThread();
				}
			}
		} finally {
			if (activeChildUrls.get(directory) === knownChildren) {
				activeChildUrls.delete(directory);
			}
		}

		await yieldToMainThread();
	}
}

async function listDirectoryWithRetry(parent, root) {
	while (isFallbackScanActive(root)) {
		try {
			const entries = await fsOperation(parent.url).lsDir();
			parent.retriedCount = 0;
			return entries || [];
		} catch (error) {
			parent.retriedCount += 1;
			if (parent.retriedCount > settings.value.maxRetryCount) return null;
			if (settings.value.showRetryToast) {
				toast(`retrying: ${parent.path}`);
			}
			await waitForRetry(root, 3000);
		}
	}
	return null;
}

async function waitForRetry(root, duration) {
	const deadline = Date.now() + duration;
	while (isFallbackScanActive(root) && Date.now() < deadline) {
		await delay(Math.min(250, deadline - Date.now()));
	}
}

function isFallbackScanActive(root) {
	return root.isConnected && filesTree[root.url] === root;
}

function delay(duration) {
	return new Promise((resolve) => setTimeout(resolve, duration));
}

function yieldToMainThread() {
	return delay(0);
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
	const cleanup = () => pendingScans.delete(scan);
	scan.then(cleanup, cleanup);
	return scan;
}

/**
 * Create a child tree
 * @param {Tree} parent
 * @param {File} item
 * @param {Tree} root
 */
async function createChildTree(parent, item, root, options = {}) {
	if (!isFallbackScanActive(root)) return;
	const { name, url, isDirectory, isLink, mime, type, size, modifiedDate } =
		item;
	const knownChildren =
		options.knownChildren || activeChildUrls.get(parent) || null;
	const exists = knownChildren
		? knownChildren.has(url)
		: parent.children.some((child) => child.url === url);
	if (exists) {
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
	if (!isFallbackScanActive(root)) return;

	const existingTree = filesTree[file.url];

	if (existingTree) {
		file.children = existingTree.children;
		parent.children.push(file);
		knownChildren?.add(file.url);
		return;
	}

	parent.children.push(file);
	knownChildren?.add(file.url);
	if (isDirectory) {
		// Keep links visible in the tree, but do not recursively index them. Remote
		// links can point back to an ancestor and otherwise create an endless scan.
		if (isLink) return;
		const ignore = picomatch.isMatch(
			Url.join(file.path, ""),
			settings.value.excludeFolders,
			{ matchBase: true },
		);
		if (ignore) return;

		if (!options.deferDirectories) {
			await getAllFiles(file, root, options);
		}
		return file;
	}

	emit("push-file", file);
	emit("add-file", file);
	return file;
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

function findNativeRoot(url) {
	if (!url) return null;
	return addedFolder.find(({ url: rootUrl, listFiles }) => {
		if (!listFiles) return false;
		if (!fileIndex.supports(rootUrl)) return false;
		const prefix = rootUrl.endsWith("/") ? rootUrl : `${rootUrl}/`;
		return (
			url === rootUrl ||
			url.startsWith(prefix) ||
			url.startsWith(`${rootUrl}::`)
		);
	});
}

function logNativeIndexError(error) {
	console.error("Native workspace index update failed:", error);
}
