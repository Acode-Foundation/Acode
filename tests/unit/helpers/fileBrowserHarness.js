import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import mustache from "mustache";
import { vi } from "vitest";

const browserSource = readFileSync(
	path.resolve("src/pages/fileBrowser/fileBrowser.js"),
	"utf8",
);
const compiledBrowser = transformSync(browserSource, {
	filename: "fileBrowser.js",
	babelrc: false,
	configFile: false,
	presets: [
		[
			"@babel/preset-env",
			{ targets: { node: "current" }, modules: "commonjs" },
		],
	],
	plugins: [
		"html-tag-js/jsx/syntax-parser.js",
		"html-tag-js/jsx/jsx-to-tag.js",
	],
}).code;

function readTemplate(name) {
	return readFileSync(path.resolve(`src/pages/fileBrowser/${name}`), "utf8");
}

function makeTag(name, properties = {}) {
	const element = document.createElement(name);
	for (const [key, value] of Object.entries(properties)) {
		if (key === "className") element.className = value;
		else if (key === "ariaLabel") element.setAttribute("aria-label", value);
		else if (key === "attr-text") element.textContent = value;
		else if (key === "style") Object.assign(element.style, value);
		else if (key.startsWith("on") && typeof value === "function") {
			element[key] = value;
		} else if (key.startsWith("data-")) {
			element.setAttribute(key, value);
		} else if (key in element) {
			element[key] = value;
		} else if (value != null) {
			element.setAttribute(key, value);
		}
	}
	return element;
}
makeTag.get = (selector) => document.querySelector(selector);

function addElementHelpers(element) {
	element.get = function (selector) {
		return this.querySelector(selector);
	};
	for (const child of element.querySelectorAll("*")) {
		child.get = element.get;
	}
	return element;
}

function makePage(title, { lead } = {}) {
	const page = document.createElement("section");
	const header = document.createElement("header");
	page.append(header);
	if (lead) header.append(lead);
	page.header = header;
	Object.defineProperty(page, "body", {
		set(body) {
			page.append(body);
		},
	});
	page.title = title;
	page.hide = () => {
		page.onhide?.();
		page.remove();
	};
	page.on = vi.fn();
	page.off = vi.fn();
	return page;
}

export default function setupFileBrowser() {
	localStorage.clear();
	document.body.replaceChildren();

	const app = document.createElement("main");
	document.body.append(app);
	const createdUri = "content://provider/created-document";
	const folderUri = "content://provider/tree/primary%3AProjects";
	const selectedUri = "content://provider/selected-document";
	const externalFs = {
		createDocument: vi.fn(async () => ({
			uri: createdUri,
			filename: "New.ts",
			persistedUriPermission: true,
		})),
		getStorageAccessPermission: vi.fn(async () => folderUri),
		listStorages: vi.fn(async () => []),
	};
	const fsOperation = vi.fn((url) => ({
		exists: vi.fn(async () => true),
		lsDir: vi.fn(async () => []),
		stat: vi.fn(async () => ({ name: "Projects", isDirectory: true, url })),
	}));
	const sdcard = {
		createDocument: vi.fn(),
		openDocumentFile: vi.fn((onSuccess) =>
			onSuccess({ uri: selectedUri, filename: "Picked.ts" }),
		),
		getStorageAccessPermission: vi.fn(),
	};
	const strings = new Proxy(
		{
			"file browser": "File browser",
			"open folder": "Open folder",
			"open file": "Open file",
			"select folder": "Select folder",
			"create document on device": "Create document on device",
			"choose folder on device": "Choose folder on device",
			"empty folder message": "This folder is empty",
			"new file": "New file",
		},
		{
			get(target, property) {
				return target[property] ?? String(property);
			},
		},
	);
	const util = {
		pushFolder(list, name, url, extra = {}) {
			list.push({
				url,
				name,
				isDirectory: true,
				parent: true,
				type: "dir",
				...extra,
			});
		},
		addPath: vi.fn(),
	};
	const helpers = {
		parseHTML(html) {
			const template = document.createElement("template");
			template.innerHTML = html;
			return addElementHelpers(template.content.firstElementChild);
		},
		parseJSON(value) {
			try {
				return JSON.parse(value);
			} catch {
				return null;
			}
		},
		sortDir: (list) => list,
		showAd: vi.fn(),
		uuid: () => "test-id",
		error: vi.fn(),
	};
	const page = makePage;
	const contextMenu = () => {
		const menu = document.createElement("ul");
		menu.hide = vi.fn();
		return menu;
	};
	const actionStack = {
		setMark: vi.fn(),
		push: vi.fn(),
		remove: vi.fn(),
		clearFromMark: vi.fn(),
		has: vi.fn(() => false),
	};
	const dependencies = {
		"./fileBrowser.scss": {},
		fileSystem: fsOperation,
		"fileSystem/externalFs": externalFs,
		"components/checkbox": () => document.createElement("input"),
		"components/contextmenu": contextMenu,
		"components/page": page,
		"components/searchbar": vi.fn(),
		"components/terminal/terminalManager": {},
		"dialogs/alert": vi.fn(),
		"dialogs/confirm": vi.fn(async () => false),
		"dialogs/loader": { create: vi.fn(), destroy: vi.fn(), hide: vi.fn() },
		"dialogs/prompt": vi.fn(),
		"dialogs/select": vi.fn(),
		jszip: {},
		"lib/actionStack": actionStack,
		"lib/checkFiles": { check: true },
		"lib/config": { FILE_NAME_REGEX: /.*/, VIBRATION_TIME: 0 },
		"lib/openFolder": { add: vi.fn(), find: vi.fn(), removeItem: vi.fn() },
		"lib/projects": {},
		"lib/recents": {
			addFile: vi.fn(),
			addFolder: vi.fn(),
			removeFile: vi.fn(),
		},
		"lib/remoteStorage": {},
		"lib/settings": {
			value: {
				fileBrowser: { sortByName: false, showHiddenFiles: false },
				vibrateOnTap: false,
			},
		},
		"lib/sftpProfiles": {
			deleteSftpProfile: vi.fn(),
			getSftpProfileId: vi.fn(),
		},
		"mime-types": { lookup: () => "text/typescript" },
		mustache,
		"settings/filesSettings": vi.fn(),
		"url-parse": vi.fn(),
		"utils/copyEntry": vi.fn(),
		"utils/helpers": helpers,
		"utils/Url": {
			join: (base, child) => `${base.replace(/\/$/, "")}/${child}`,
			basename: (url) => url.split("/").filter(Boolean).pop() || "",
			getProtocol: () => "",
			parse: (url) => ({ url, query: "" }),
		},
		"./add-menu.hbs": readTemplate("add-menu.hbs"),
		"./add-menu-home.hbs": readTemplate("add-menu-home.hbs"),
		"./fileBrowser.hbs": readTemplate("fileBrowser.hbs"),
		"./list.hbs": readTemplate("list.hbs"),
		"./util": util,
	};
	const exports = {};
	const context = vm.createContext({
		exports,
		Promise,
		console,
		setTimeout,
		clearTimeout,
		document,
		window,
		localStorage,
		app,
		cordova: {
			file: {
				externalRootDirectory: "/storage/",
				dataDirectory: "file:///data/",
			},
		},
		ANDROID_SDK_INT: 35,
		isStorageManager: false,
		sdcard,
		strings,
		tag: makeTag,
		editorManager: { getFile: vi.fn(), activeFile: null },
		acode: { exec: vi.fn() },
		system: {},
		ftp: {},
		sftp: {},
		require(id) {
			if (!(id in dependencies)) throw Error(`Unexpected import: ${id}`);
			return dependencies[id];
		},
	});
	vm.runInContext(
		`String.prototype.capitalize = function () { return this.charAt(0).toUpperCase() + this.slice(1); };
		String.prototype.hashCode = function () { let hash = 0; for (let i = 0; i < this.length; i++) hash = (hash << 5) - hash + this.charCodeAt(i) | 0; return hash; };`,
		context,
	);
	vm.runInContext(compiledBrowser, context, { filename: "fileBrowser.js" });

	return {
		FileBrowser: exports.default,
		app,
		externalFs,
		fsOperation,
		sdcard,
		createdUri,
		folderUri,
		selectedUri,
	};
}
