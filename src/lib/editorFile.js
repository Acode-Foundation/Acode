import fsOperation from "fileSystem";
// CodeMirror imports for document state management
import { EditorState, Text } from "@codemirror/state";
import {
	clearSelection,
	restoreFolds,
	restoreSelection,
	setScrollPosition,
} from "cm/editorUtils";
import { getModeForPath } from "cm/modelist";
import Sidebar from "components/sidebar";
import tile from "components/tile";
import confirm from "dialogs/confirm";
import DOMPurify from "dompurify";
import startDrag from "handlers/editorFileTab";
import actions from "handlers/quickTools";
import tag from "html-tag-js";
import mimeTypes from "mime-types";
import helpers from "utils/helpers";
import Path from "utils/Path";
import Url from "utils/Url";
import constants from "./constants";
import openFolder from "./openFolder";
import run from "./run";
import saveFile from "./saveFile";
import appSettings from "./settings";

/**
 * Creates a Proxy around an EditorState that provides Ace-compatible methods.
 * @param {EditorState} state - The raw CodeMirror EditorState
 * @param {EditorFile} file - The parent EditorFile instance
 * @returns {Proxy} Proxied state with Ace-compatible methods
 */
function createSessionProxy(state, file) {
	if (!state) return null;

	/**
	 * Convert Ace position {row, column} to CodeMirror offset
	 */
	function positionToOffset(pos, doc) {
		if (!pos || !doc) return 0;
		try {
			const lineNum = Math.max(1, Math.min((pos.row ?? 0) + 1, doc.lines));
			const line = doc.line(lineNum);
			const col = Math.max(0, Math.min(pos.column ?? 0, line.length));
			return line.from + col;
		} catch (_) {
			return 0;
		}
	}

	/**
	 * Convert CodeMirror offset to Ace position {row, column}
	 */
	function offsetToPosition(offset, doc) {
		if (!doc) return { row: 0, column: 0 };
		try {
			const line = doc.lineAt(offset);
			return { row: line.number - 1, column: offset - line.from };
		} catch (_) {
			return { row: 0, column: 0 };
		}
	}

	return new Proxy(state, {
		get(target, prop) {
			// Ace-compatible method: getValue()
			if (prop === "getValue") {
				return () => target.doc.toString();
			}

			// Ace-compatible method: setValue(text)
			if (prop === "setValue") {
				return (text) => {
					const newText = String(text ?? "");
					const { activeFile, editor } = editorManager;
					if (activeFile?.id === file.id && editor) {
						// Active file: dispatch to live EditorView
						editor.dispatch({
							changes: {
								from: 0,
								to: editor.state.doc.length,
								insert: newText,
							},
						});
					} else {
						// Inactive file: update stored state
						file._setRawSession(
							target.update({
								changes: { from: 0, to: target.doc.length, insert: newText },
							}).state,
						);
					}
				};
			}

			// Ace-compatible method: getLine(row)
			if (prop === "getLine") {
				return (row) => {
					try {
						return target.doc.line(row + 1).text;
					} catch (_) {
						return "";
					}
				};
			}

			// Ace-compatible method: getLength()
			if (prop === "getLength") {
				return () => target.doc.lines;
			}

			// Ace-compatible method: getTextRange(range)
			if (prop === "getTextRange") {
				return (range) => {
					if (!range) return "";
					try {
						const from = positionToOffset(range.start, target.doc);
						const to = positionToOffset(range.end, target.doc);
						return target.doc.sliceString(from, to);
					} catch (_) {
						return "";
					}
				};
			}

			// Ace-compatible method: insert(position, text)
			if (prop === "insert") {
				return (position, text) => {
					const { activeFile, editor } = editorManager;
					const offset = positionToOffset(position, target.doc);
					if (activeFile?.id === file.id && editor) {
						editor.dispatch({
							changes: { from: offset, insert: String(text ?? "") },
						});
					} else {
						file._setRawSession(
							target.update({
								changes: { from: offset, insert: String(text ?? "") },
							}).state,
						);
					}
				};
			}

			// Ace-compatible method: remove(range)
			if (prop === "remove") {
				return (range) => {
					if (!range) return "";
					const from = positionToOffset(range.start, target.doc);
					const to = positionToOffset(range.end, target.doc);
					const removed = target.doc.sliceString(from, to);
					const { activeFile, editor } = editorManager;
					if (activeFile?.id === file.id && editor) {
						editor.dispatch({ changes: { from, to, insert: "" } });
					} else {
						file._setRawSession(
							target.update({ changes: { from, to, insert: "" } }).state,
						);
					}
					return removed;
				};
			}

			// Ace-compatible method: replace(range, text)
			if (prop === "replace") {
				return (range, text) => {
					if (!range) return;
					const from = positionToOffset(range.start, target.doc);
					const to = positionToOffset(range.end, target.doc);
					const { activeFile, editor } = editorManager;
					if (activeFile?.id === file.id && editor) {
						editor.dispatch({
							changes: { from, to, insert: String(text ?? "") },
						});
					} else {
						file._setRawSession(
							target.update({
								changes: { from, to, insert: String(text ?? "") },
							}).state,
						);
					}
				};
			}

			// Ace-compatible method: getWordRange(row, column)
			if (prop === "getWordRange") {
				return (row, column) => {
					const offset = positionToOffset({ row, column }, target.doc);
					const word = target.wordAt(offset);
					if (word) {
						return {
							start: offsetToPosition(word.from, target.doc),
							end: offsetToPosition(word.to, target.doc),
						};
					}
					return { start: { row, column }, end: { row, column } };
				};
			}

			// Pass through all other properties to the real EditorState
			const value = target[prop];
			if (typeof value === "function") {
				return value.bind(target);
			}
			return value;
		},
	});
}

/**
 * @typedef {'run'|'save'|'change'|'focus'|'blur'|'close'|'rename'|'load'|'loadError'|'loadStart'|'loadEnd'|'changeMode'|'changeEncoding'|'changeReadOnly'} FileEvents
 */

/**
 * @typedef {object}  FileOptions new file options
 * @property {boolean} [isUnsaved] weather file needs to saved
 * @property {render} [render] make file active
 * @property {string} [id] ID for the file
 * @property {string} [uri] uri of the file
 * @property {string} [text] session text
 * @property {boolean} [editable] enable file to edit or not
 * @property {boolean} [deletedFile] file do not exists at source
 * @property {'single' | 'tree'} [SAFMode] storage access framework mode
 * @property {string} [encoding] text encoding
 * @property {object} [cursorPos] cursor position
 * @property {number} [scrollLeft] scroll left
 * @property {number} [scrollTop] scroll top
 * @property {Array<Fold>} [folds] folds
 */

export default class EditorFile {
	/**
	 * Type of content this file represents but use page in case of custom pages etc
	 */
	#type = "editor";
	#tabIcon = "file file_type_default";
	/**
	 * Custom content element
	 * @type {HTMLElement}
	 */
	#content = null;
	/**
	 * Whether to hide quicktools for this tab
	 * @type {boolean}
	 */
	hideQuickTools = false;

	/**
	 * Custom stylesheets for tab
	 * @type {string|string[]}
	 */
	stylesheets;

	/**
	 * Custom title function for special tab types
	 * @type {function}
	 */
	#customTitleFn = null;

	/**
	 * If editor was focused before resize
	 */
	focusedBefore = false;
	/**
	 * State of the editor for this file.
	 */
	focused = false;
	/**
	 * Weather the file has completed loading text or not
	 * @type {boolean}
	 */
	loaded = true;
	/**
	 * Weather file is still loading the text from the source
	 * @type {boolean}
	 */
	loading = false;
	/**
	 * Weather file is deleted from source.
	 * @type {boolean}
	 */
	deletedFile = false;
	/**
	 * Raw CodeMirror EditorState. Use session getter to access with Ace-compatible methods.
	 * @type {EditorState}
	 */
	#rawSession = null;
	/**
	 * Encoding of the text e.g. 'gbk'
	 * @type {string}
	 */
	encoding = appSettings.value.defaultFileEncoding;
	/**
	 * Weather file is readonly
	 * @type {boolean}
	 */
	readOnly = false;
	/**
	 * mark change when session text is changed
	 * @type {boolean}
	 */
	markChanged = true;
	/**
	 * Storage access framework file mode
	 * @type {'single' | 'tree' | null}
	 */
	#SAFMode = null;
	/**
	 * Name of the file
	 * @type {string}
	 */
	#name = constants.DEFAULT_FILE_NAME;
	/**
	 * Location of the file
	 * @type {string}
	 */
	#uri;
	/**
	 * Unique ID of the file, changed when file is renamed or location/uri is changed.
	 * @type {string}
	 */
	#id = constants.DEFAULT_FILE_SESSION;
	/**
	 * Associated tile for the file, that is append in the open file list,
	 * when clicked make the file active.
	 * @type {HTMLElement}
	 */
	#tab;
	/**
	 * Weather file can be edited or not
	 * @type {boolean}
	 */
	#editable = true;
	/**
	 * contains information about cursor position, scroll left, scroll top, folds.
	 */
	#loadOptions;
	/**
	 * Weather file is changed and needs to be saved
	 * @type {boolean}
	 */
	#isUnsaved = false;
	/**
	 * Whether to show run button or not
	 */
	#canRun = Promise.resolve(false);
	/**
	 * @type {function} event handler
	 */
	#onFilePosChange;
	#events = {
		save: [],
		change: [],
		focus: [],
		blur: [],
		close: [],
		rename: [],
		load: [],
		loaderror: [],
		loadstart: [],
		loadend: [],
		changemode: [],
		run: [],
		canrun: [],
	};

	onsave;
	onchange;
	onfocus;
	onblur;
	onclose;
	onrename;
	onload;
	onloaderror;
	onloadstart;
	onloadend;
	onchangemode;
	onrun;
	oncanrun;

	/**
	 *
	 * @param {string} [filename] name of file.
	 * @param {FileOptions} [options]  file create options
	 */
	constructor(filename, options) {
		const { addFile, getFile } = editorManager;
		let doesExists = null;

		this.hideQuickTools = options?.hideQuickTools || false;

		// if options are passed
		if (options) {
			// if options doesn't contains id, and provide a new id
			if (!options.id) {
				if (options.uri) this.#id = options.uri.hashCode();
				else this.#id = helpers.uuid();
			} else this.#id = options.id;
		} else if (!options) {
			// if options aren't passed, that means default file is being created
			this.#id = constants.DEFAULT_FILE_SESSION;
		}

		if (options?.type) {
			this.#type = options.type;
			if (this.#type !== "editor") {
				let container;
				let shadow;

				if (this.#type === "terminal") {
					container = tag("div", {
						className: "tab-page-container",
					});
					const content = tag("div", {
						className: "tab-page-content",
					});
					content.appendChild(options?.content);
					container.appendChild(content);
					this.#content = container;
				} else {
					container = <div className="tab-page-container" />;

					// shadow dom
					shadow = container.attachShadow({ mode: "open" });

					// Add base styles to shadow DOM first
					shadow.appendChild(<link rel="stylesheet" href="build/main.css" />);

					// Handle custom stylesheets if provided
					if (options.stylesheets) {
						this.#addCustomStyles(options.stylesheets, shadow);
					}

					const content = <div className="tab-page-content" />;

					if (typeof options.content === "string") {
						content.innerHTML = DOMPurify.sanitize(options.content);
					} else {
						content.appendChild(options.content);
					}

					// Append content container to shadow DOM
					shadow.appendChild(content);

					this.#content = container;
				}
			} else {
				this.#content = options.content;
			}
			if (options.tabIcon) {
				this.#tabIcon = options.tabIcon;
			}
		}

		this.#uri = options?.uri;

		if (this.#id) doesExists = getFile(this.#id, "id");
		else if (this.#uri) doesExists = getFile(this.#uri, "uri");

		if (doesExists) {
			doesExists.makeActive();
			return;
		}

		if (filename) this.#name = filename;

		this.#tab = tile({
			text: this.#name,
			...(this.#type !== "editor" && {
				lead: (
					<span className={this.icon} style={{ paddingRight: "5px" }}></span>
				),
			}),
			tail: tag("span", {
				className: "icon cancel",
				dataset: {
					action: "close-file",
				},
			}),
		});

		const editable = options?.editable ?? true;

		this.#SAFMode = options?.SAFMode;
		this.isUnsaved = options?.isUnsaved ?? false;

		if (options?.encoding) {
			this.encoding = options.encoding;
		}

		// if options contains text property then there is no need to load
		// set loaded true

		if (this.#id !== constants.DEFAULT_FILE_SESSION) {
			this.loaded = options?.text !== undefined;
		}

		// if not loaded then create load options
		if (!this.loaded) {
			this.#loadOptions = {
				cursorPos: options?.cursorPos,
				scrollLeft: options?.scrollLeft,
				scrollTop: options?.scrollTop,
				folds: options?.folds,
				editable,
			};
		} else {
			this.editable = editable;
		}

		this.#onFilePosChange = () => {
			const { openFileListPos } = appSettings.value;
			if (
				openFileListPos === appSettings.OPEN_FILE_LIST_POS_HEADER ||
				openFileListPos === appSettings.OPEN_FILE_LIST_POS_BOTTOM
			) {
				this.#tab.oncontextmenu = startDrag;
			} else {
				this.#tab.oncontextmenu = null;
			}
		};

		this.#onFilePosChange();
		this.#tab.addEventListener("click", tabOnclick.bind(this));
		appSettings.on("update:openFileListPos", this.#onFilePosChange);

		addFile(this);
		editorManager.emit("new-file", this);

		if (this.#type === "editor") {
			this.#rawSession = EditorState.create({
				doc: options?.text || "",
			});
			this.setMode();
			this.#setupSession();
		}

		if (options?.render ?? true) this.render();
	}

	get type() {
		return this.#type;
	}

	get tabIcon() {
		return this.#tabIcon;
	}

	get content() {
		return this.#content;
	}

	/**
	 * Session with Ace-compatible methods
	 * Returns a Proxy over the raw EditorState.
	 * @returns {Proxy<EditorState>}
	 */
	get session() {
		return createSessionProxy(this.#rawSession, this);
	}

	/**
	 * Set the session
	 * @param {EditorState} value
	 */
	set session(value) {
		this.#rawSession = value;
	}

	/**
	 * Internal method to update the raw session state.
	 * Used by the Proxy for inactive file updates.
	 * @param {EditorState} state
	 */
	_setRawSession(state) {
		this.#rawSession = state;
	}

	/**
	 * File unique id.
	 */
	get id() {
		return this.#id;
	}

	/**
	 * File unique id.
	 * @param {string} value
	 */
	set id(value) {
		this.#renameCacheFile(value);
		this.#id = value;
	}

	/**
	 * File name
	 */
	get filename() {
		return this.#name;
	}

	/**
	 * File name
	 * @param {string} value
	 */
	set filename(value) {
		if (!value || this.#SAFMode === "single") return;
		if (this.#name === value) return;

		const event = createFileEvent(this);
		this.#emit("rename", event);

		if (event.defaultPrevented) return;

		(async () => {
			if (this.id === constants.DEFAULT_FILE_SESSION) {
				this.id = helpers.uuid();
			}

			if (editorManager.activeFile.id === this.id) {
				editorManager.header.text = value;
			}

			// const oldExt = helpers.extname(this.#name);
			const oldExt = Url.extname(this.#name);
			// const newExt = helpers.extname(value);
			const newExt = Url.extname(value);

			this.#tab.text = value;
			this.#name = value;

			if (oldExt !== newExt) this.setMode();

			editorManager.onupdate("rename-file");
			editorManager.emit("rename-file", this);
		})();
	}

	/**
	 * Location of the file i.e. dirname
	 */
	get location() {
		if (this.#SAFMode === "single") return null;
		if (this.#uri) {
			try {
				return Url.dirname(this.#uri);
			} catch (error) {
				return null;
			}
		}
		return null;
	}

	/**
	 * Location of the file i.e. dirname
	 * @param {string} value
	 */
	set location(value) {
		if (!value) return;
		if (this.#SAFMode === "single") return;
		if (this.location === value) return;

		const event = createFileEvent(this);
		this.#emit("rename", event);
		if (event.defaultPrevented) return;

		this.uri = Url.join(value, this.filename);
		this.readOnly = false;
	}

	/**
	 * File location on the device
	 */
	get uri() {
		return this.#uri;
	}

	/**
	 *  File location on the device
	 * @param {string} value
	 */
	set uri(value) {
		if (this.#uri === value) return;
		if (!value) {
			this.deletedFile = true;
			this.isUnsaved = true;
			this.#uri = null;
			this.id = helpers.uuid();
		} else {
			this.#uri = value;
			this.deletedFile = false;
			this.readOnly = false;
			this.id = value.hashCode();
		}

		editorManager.onupdate("rename-file");
		editorManager.emit("rename-file", this);

		// if this file is active set sub text of header
		if (editorManager.activeFile.id === this.id) {
			editorManager.header.subText = this.#getTitle();
		}
	}

	/**
	 * End of line
	 */
	get eol() {
		return /\r/.test(this.session.doc.toString()) ? "windows" : "unix";
	}

	/**
	 * End of line
	 * @param {'windows'|'unit'} value
	 */
	set eol(value) {
		if (this.type !== "editor") return;
		if (this.eol === value) return;
		let text = this.session.doc.toString();

		if (value === "windows") {
			text = text.replace(/(?<!\r)\n/g, "\r\n");
		} else {
			text = text.replace(/\r/g, "");
		}

		// Update the document in the session
		this.session.setValue(text);
	}

	/**
	 * Weather file can be edit.
	 */
	get editable() {
		return this.#editable;
	}

	/**
	 * Weather file can be edit.
	 * @param {boolean} value
	 */
	set editable(value) {
		if (this.#editable === value) return;
		this.setReadOnly(!value);
		editorManager.onupdate("read-only");
		editorManager.emit("update", "read-only");
		this.#editable = value;
	}

	get isUnsaved() {
		return this.#isUnsaved;
	}

	set isUnsaved(value) {
		if (this.#isUnsaved === value) return;
		this.#isUnsaved = value;

		this.#updateTab();
	}

	/**
	 * DON'T remove, plugin need this property to get filename.
	 */
	get name() {
		return this.#name;
	}

	/**
	 * Readonly, cache file url
	 */
	get cacheFile() {
		return Url.join(CACHE_STORAGE, this.#id);
	}

	/**
	 * File icon
	 */
	get icon() {
		if (this.#type !== "editor") {
			return this.#tabIcon;
		}
		return helpers.getIconForFile(this.filename);
	}

	get tab() {
		return this.#tab;
	}

	get SAFMode() {
		return this.#SAFMode;
	}

	async writeToCache() {
		const text = this.session.doc.toString();
		const fs = fsOperation(this.cacheFile);

		try {
			if (!(await fs.exists())) {
				await fsOperation(CACHE_STORAGE).createFile(this.id, text);
				return;
			}

			await fs.writeFile(text);
		} catch (error) {
			window.log("error", "Writing to cache failed:");
			window.log("error", error);
		}
	}

	async isChanged() {
		if (this.type !== "editor") return false;
		// if file is not loaded or is loading then it is not changed.
		if (!this.loaded || this.loading) {
			return false;
		}
		// is changed is called when session text is changed
		// if file has no uri or is readonly that means file is change
		// and need to saved to a location.
		// here readonly means file has uri but has no write permission.
		if (!this.uri || this.readOnly) {
			// if file is default file and text is changed
			if (this.id === constants.DEFAULT_FILE_SESSION) {
				// change id when text is changed
				this.id = helpers.uuid();
			}
			return true;
		}

		const protocol = Url.getProtocol(this.#uri);
		const text = this.session.doc.toString();

		// Helper for JS-based comparison (used as fallback)
		const jsCompare = async (fileUri) => {
			const fs = fsOperation(fileUri);
			const oldText = await fs.readFile(this.encoding);
			return await system.compareTexts(oldText, text);
		};

		if (/s?ftp:/.test(protocol)) {
			// FTP/SFTP files use cached local file
			const cacheFilename = protocol.slice(0, -1) + this.id;
			const cacheFileUri = Url.join(CACHE_STORAGE, cacheFilename);

			try {
				return await system.compareFileText(cacheFileUri, this.encoding, text);
			} catch (error) {
				console.error(
					"Native compareFileText failed, using JS fallback:",
					error,
				);
				try {
					return await jsCompare(cacheFileUri);
				} catch (fallbackError) {
					console.error(fallbackError);
					return false;
				}
			}
		}

		if (/^(file|content):/.test(protocol)) {
			// file:// and content:// URIs - try native first, fallback to JS
			try {
				return await system.compareFileText(this.uri, this.encoding, text);
			} catch (error) {
				console.error(
					"Native compareFileText failed, using JS fallback:",
					error,
				);
				try {
					return await jsCompare(this.uri);
				} catch (fallbackError) {
					console.error(fallbackError);
					return false;
				}
			}
		}

		// Other protocols - JS reads file, native compares strings
		try {
			return await jsCompare(this.uri);
		} catch (error) {
			console.error(error);
			return false;
		}
	}

	async canRun() {
		if (!this.loaded || this.loading) return false;
		await this.readCanRun();
		return this.#canRun;
	}

	async readCanRun() {
		try {
			const event = createFileEvent(this);
			this.#emit("canrun", event);
			if (event.defaultPrevented) return;

			const folder = openFolder.find(this.uri);
			if (folder) {
				const url = Url.join(folder.url, "index.html");
				const fs = fsOperation(url);
				if (await fs.exists()) {
					this.#canRun = Promise.resolve(true);
					return;
				}
			}

			const runnableFile = /\.((html?)|(md)|(js)|(svg))$/;
			if (runnableFile.test(this.filename)) {
				this.#canRun = Promise.resolve(true);
				return;
			}
			this.#canRun = Promise.resolve(false);
		} catch (error) {
			if (err instanceof Error) throw err;
			else throw new Error(err);
		}
	}

	/**
	 * Set weather to show run button or not
	 * @param {()=>(boolean|Promise<boolean>)} cb callback function that return true if file can run
	 */
	async writeCanRun(cb) {
		if (!cb || typeof cb !== "function") return;
		const res = cb();
		if (res instanceof Promise) {
			this.#canRun = res;
			return;
		}

		this.#canRun = Promise.resolve(res);
	}

	/**
	 * Remove and closes the file.
	 * @param {boolean} force if true, will prompt to save the file
	 */
	async remove(force = false) {
		if (
			this.id === constants.DEFAULT_FILE_SESSION &&
			!editorManager.files.length
		)
			return;
		if (!force && this.isUnsaved) {
			const confirmation = await confirm(
				strings.warning.toUpperCase(),
				strings["unsaved file"],
			);
			if (!confirmation) return;
		}

		this.#destroy();

		editorManager.files = editorManager.files.filter(
			(file) => file.id !== this.id,
		);
		const { files, activeFile } = editorManager;
		if (activeFile.id === this.id) {
			editorManager.activeFile = null;
		}
		if (!files.length) {
			Sidebar.hide();
			editorManager.activeFile = null;
			new EditorFile();
		} else {
			files[files.length - 1].makeActive();
		}
		editorManager.onupdate("remove-file");
		editorManager.emit("remove-file", this);
	}

	/**
	 * Saves the file.
	 * @returns {Promise<boolean>} true if file is saved, false if not.
	 */
	save() {
		if (this.type !== "editor") return Promise.resolve(false);
		return this.#save(false);
	}

	/**
	 * Saves the file to a new location.
	 * @returns {Promise<boolean>} true if file is saved, false if not.
	 */
	saveAs() {
		if (this.type !== "editor") return Promise.resolve(false);
		return this.#save(true);
	}

	setReadOnly(value) {
		try {
			const { editor, readOnlyCompartment } = editorManager;
			if (!editor) return;
			if (!readOnlyCompartment) return;
			editor.dispatch({
				effects: readOnlyCompartment.reconfigure(
					EditorState.readOnly.of(!!value),
				),
			});
		} catch (_) {}

		// Sync internal flags and header
		this.readOnly = !!value;
		this.#editable = !this.readOnly;
		if (editorManager.activeFile?.id === this.id) {
			editorManager.header.subText = this.#getTitle();
		}
	}

	/**
	 * Sets syntax highlighting of the file.
	 * @param {string} [mode]
	 */
	setMode(mode) {
		if (this.type !== "editor") return;
		const event = createFileEvent(this);
		this.#emit("changemode", event);
		if (event.defaultPrevented) return;

		if (!mode) {
			const ext = Path.extname(this.filename);
			const modes = helpers.parseJSON(localStorage.modeassoc);
			if (modes?.[ext]) {
				mode = modes[ext];
			} else {
				const modeInfo = getModeForPath(this.filename);
				mode = modeInfo?.name || "text";
			}
		}

		// Store mode info for later use when creating editor view
		this.currentMode = mode;
		this.currentLanguageExtension = getModeForPath(
			this.filename,
		)?.getExtension();

		// sets file icon
		this.#tab.lead(
			<span className={this.icon} style={{ paddingRight: "5px" }}></span>,
		);
	}

	/**
	 * Makes this file active
	 */
	makeActive() {
		const { activeFile, editor, switchFile } = editorManager;

		if (activeFile) {
			if (activeFile.id === this.id) return;
			activeFile.focusedBefore = activeFile.focused;
			activeFile.removeActive();

			// Hide previous content if it exists
			if (activeFile.type !== "editor" && activeFile.content) {
				activeFile.content.style.display = "none";
			}
		}

		switchFile(this.id);

		// Show/hide appropriate content
		if (this.type === "editor") {
			editorManager.container.style.display = "block";
			if (this.focused) {
				editor.focus();
			} else {
				editor.contentDOM.blur();
				// Ensure any native DOM selection is cleared on blur to avoid sticky selection handles
				try {
					document.getSelection()?.removeAllRanges();
				} catch (_) {}
			}
		} else {
			editorManager.container.style.display = "none";
			if (this.content) {
				this.content.style.display = "block";
				if (!this.content.parentElement) {
					editorManager.container.parentElement.appendChild(this.content);
				}
			}

			if (activeFile && activeFile.type === "editor") {
				clearSelection(editorManager.editor);
			}
		}

		this.#tab.classList.add("active");
		this.#tab.scrollIntoView();

		if (this.type === "editor" && !this.loaded && !this.loading) {
			this.#loadText();
		}

		// Handle quicktools visibility based on hideQuickTools property
		if (this.hideQuickTools) {
			root.classList.add("hide-floating-button");
			actions("set-height", { height: 0, save: false });
		} else {
			root.classList.remove("hide-floating-button");
			const quickToolsHeight =
				appSettings.value.quickTools !== undefined
					? appSettings.value.quickTools
					: 1;
			actions("set-height", { height: quickToolsHeight, save: false });
		}

		editorManager.header.subText = this.#getTitle();

		this.#emit("focus", createFileEvent(this));
	}

	removeActive() {
		this.#emit("blur", createFileEvent(this));
	}

	openWith() {
		this.#fileAction("VIEW");
	}

	editWith() {
		this.#fileAction("EDIT", "text/plain");
	}

	share() {
		this.#fileAction("SEND");
	}

	runAction() {
		this.#fileAction("RUN");
	}

	run() {
		this.#run(false);
	}

	runFile() {
		this.#run(true);
	}

	render() {
		this.makeActive();

		if (this.id !== constants.DEFAULT_FILE_SESSION) {
			const defaultFile = editorManager.getFile(
				constants.DEFAULT_FILE_SESSION,
				"id",
			);
			defaultFile?.remove();
		}

		// Show/hide editor based on content type
		if (this.#type === "editor") {
			editorManager.container.style.display = "block";
			if (this.#content) this.#content.style.display = "none";
		} else {
			editorManager.container.style.display = "none";
			if (this.#content) {
				this.#content.style.display = "block";
				editorManager.container.parentElement.appendChild(this.#content);
			}
		}
	}

	/**
	 * Add event listener
	 * @param {string} event
	 * @param {(this:File, e:Event)=>void} callback
	 */
	on(event, callback) {
		this.#events[event.toLowerCase()]?.push(callback);
	}

	/**
	 * Remove event listener
	 * @param {string} event
	 * @param {(this:File, e:Event)=>void} callback
	 */
	off(event, callback) {
		const events = this.#events[event.toLowerCase()];
		if (!events) return;
		const index = events.indexOf(callback);
		if (index > -1) events.splice(index, 1);
	}

	/**
	 * Add custom stylesheets to shadow DOM
	 * @param {string|string[]} styles URLs or CSS strings
	 * @param {ShadowRoot} shadow Shadow DOM root
	 */
	#addCustomStyles(styles, shadow) {
		if (typeof styles === "string") {
			styles = [styles];
		}

		styles.forEach((style) => {
			if (style.startsWith("http") || style.startsWith("/")) {
				// External stylesheet
				const link = tag("link", {
					rel: "stylesheet",
					href: style,
				});
				shadow.appendChild(link);
			} else {
				// Inline CSS
				const styleElement = tag("style", {
					textContent: style,
				});
				shadow.appendChild(styleElement);
			}
		});
	}

	/**
	 * Add stylesheet to tab's shadow DOM
	 * @param {string} style URL or CSS string
	 */
	addStyle(style) {
		if (this.#type === "editor" || !this.#content) return;

		const shadow = this.#content.shadowRoot;
		this.#addCustomStyles(style, shadow);
	}

	/**
	 * Set custom title function for special tab types
	 * @param {function} titleFn Function that returns the title string
	 */
	setCustomTitle(titleFn) {
		this.#customTitleFn = titleFn;
		// Update header if this file is currently active
		if (editorManager.activeFile && editorManager.activeFile.id === this.id) {
			editorManager.header.subText = this.#getTitle();
		}
	}

	get headerSubtitle() {
		return this.#getTitle();
	}

	/**
	 *
	 * @param {FileAction} action
	 */
	async #fileAction(action, mimeType) {
		try {
			const uri = await this.#getShareableUri();
			if (!mimeType) mimeType = mimeTypes.lookup(this.name) || "text/plain";
			system.fileAction(
				uri,
				this.filename,
				action,
				mimeType,
				this.#showNoAppError,
			);
		} catch (error) {
			toast(strings.error);
		}
	}

	async #getShareableUri() {
		if (!this.uri) return null;

		const fs = fsOperation(this.uri);

		if (/^s?ftp:/.test(this.uri)) return fs.localName;

		const { url } = await fs.stat();
		return url;
	}

	/**
	 * Rename cache file.
	 * @param {String} newId
	 */
	async #renameCacheFile(newId) {
		try {
			const fs = fsOperation(this.cacheFile);
			if (!(await fs.exists())) return;
			fs.renameTo(newId);
		} catch (error) {
			window.log("error", "renameCacheFile");
			window.log("error", error);
		}
	}

	/**
	 * Removes cache file
	 */
	async #removeCache() {
		try {
			const fs = fsOperation(this.cacheFile);
			if (!(await fs.exists())) return;
			await fs.delete();
		} catch (error) {
			window.log("error", error);
		}
	}

	async #loadText() {
		if (this.#type !== "editor") return;
		let value = "";

		const { cursorPos, scrollLeft, scrollTop, folds, editable } =
			this.#loadOptions;
		const { editor } = editorManager;

		this.#loadOptions = null;

		this.setReadOnly(true);
		this.loading = true;
		this.markChanged = false;
		this.#emit("loadstart", createFileEvent(this));
		this.session.setValue(strings["loading..."]);

		// Immediately reflect "loading..." in the visible editor if this tab is active
		try {
			const { activeFile, emit } = editorManager;
			if (activeFile?.id === this.id) {
				emit("file-loaded", this);
			}
		} catch (_) {}

		try {
			const cacheFs = fsOperation(this.cacheFile);
			const cacheExists = await cacheFs.exists();

			if (cacheExists) {
				value = await cacheFs.readFile(this.encoding);
			}

			if (this.uri) {
				const file = fsOperation(this.uri);
				const fileExists = await file.exists();
				if (!fileExists && cacheExists) {
					this.deletedFile = true;
					this.isUnsaved = true;
				} else if (!cacheExists && fileExists) {
					value = await file.readFile(this.encoding);
				} else if (!cacheExists && !fileExists) {
					window.log("error", "unable to load file");
					throw new Error("Unable to load file");
				}
			}

			this.markChanged = false;
			this.session.setValue(value);
			this.loaded = true;
			this.loading = false;

			const { activeFile, emit } = editorManager;
			if (activeFile.id === this.id) {
				this.setReadOnly(false);
			}

			setTimeout(() => {
				this.#emit("load", createFileEvent(this));
				emit("file-loaded", this);
				if (cursorPos) {
					restoreSelection(editor, cursorPos);
				}
				if (scrollTop || scrollLeft) {
					setScrollPosition(editor, scrollTop, scrollLeft);
				}
				if (editable !== undefined) this.editable = editable;
				restoreFolds(editor, folds);
			}, 0);
		} catch (error) {
			this.#emit("loaderror", createFileEvent(this));
			this.remove();
			toast(`Unable to load: ${this.filename}`);
			window.log("error", "Unable to load: " + this.filename);
			window.log("error", error);
		} finally {
			this.#emit("loadend", createFileEvent(this));
		}
	}

	// TODO: Implement CodeMirror equivalents for folding and scroll events
	// static #onfold(e) {
	// 	editorManager.editor._emit("fold", e);
	// }

	// static #onscrolltop(e) {
	// 	editorManager.editor._emit("scrolltop", e);
	// }

	// static #onscrollleft(e) {
	// 	editorManager.editor._emit("scrollleft", e);
	// }

	#save(as) {
		const event = createFileEvent(this);
		this.#emit("save", event);

		if (event.defaultPrevented) return Promise.resolve(false);
		return Promise.all([this.writeToCache(), saveFile(this, as)]);
	}

	#run(file) {
		const event = createFileEvent(this);
		this.#emit("run", event);
		if (event.defaultPrevented) return;
		run(false, appSettings.value.previewMode, file);
	}

	#updateTab() {
		if (this.#isUnsaved) {
			this.tab.classList.add("notice");
		} else {
			this.tab.classList.remove("notice");
		}
	}

	/**
	 * Setup CodeMirror EditorState for the file
	 */
	#setupSession() {
		if (this.type !== "editor") return;
		// CodeMirror configuration will be handled in the EditorView
		// Store settings for when the editor view is created
		this.editorSettings = {
			tabSize: appSettings.value.tabSize,
			softTab: appSettings.value.softTab,
			textWrap: appSettings.value.textWrap,
		};
	}

	#destroy() {
		this.#emit("close", createFileEvent(this));
		appSettings.off("update:openFileListPos", this.#onFilePosChange);
		if (this.type === "editor") {
			this.#removeCache();
			// CodeMirror EditorState doesn't need explicit cleanup
			this.session = null;
		} else if (this.content) {
			this.content.remove();
		}

		this.#tab.remove();
		this.#tab = null;
	}

	#showNoAppError() {
		toast(strings["no app found to handle this file"]);
	}

	#getTitle() {
		// Use custom title function if provided
		if (this.#customTitleFn) {
			return this.#customTitleFn();
		}

		let text = this.location || this.uri;

		if (text && !this.readOnly) {
			text = helpers.getVirtualPath(text);
			if (text.length > 30) text = "..." + text.slice(text.length - 27);
		} else if (this.readOnly) {
			text = strings["read only"];
		} else if (this.deletedFile) {
			text = strings["deleted file"];
		} else {
			text = strings["new file"];
		}
		return text;
	}

	/**
	 * Emits an event
	 * @param {FileEvents} eventName
	 * @param {FileEvent} event
	 */
	#emit(eventName, event) {
		this[`on${eventName}`]?.(event);
		if (!event.BUBBLING_PHASE) return;
		this.#events[eventName]?.some((fn) => {
			fn(event);
			return !event.BUBBLING_PHASE;
		});
	}
}

/**
 *
 * @param {MouseEvent} e
 * @returns
 */
function tabOnclick(e) {
	e.preventDefault();
	const { action } = e.target.dataset;
	if (action === "close-file") {
		this.remove();
		return;
	}
	this.makeActive();
}

function createFileEvent(file) {
	return new FileEvent(file);
}

class FileEvent {
	#bubblingPhase = true;
	#defaultPrevented = false;
	target;
	constructor(file) {
		this.target = file;
	}
	stopPropagation() {
		this.#bubblingPhase = false;
	}
	preventDefault() {
		this.#defaultPrevented = true;
	}
	get BUBBLING_PHASE() {
		return this.#bubblingPhase;
	}
	get defaultPrevented() {
		return this.#defaultPrevented;
	}
}
