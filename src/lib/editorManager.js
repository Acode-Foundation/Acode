import sidebarApps from "sidebarApps";
import { indentUnit } from "@codemirror/language";
import { search } from "@codemirror/search";
import { Compartment, EditorState, Prec, StateEffect } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
	EditorView,
	highlightActiveLineGutter,
	highlightTrailingWhitespace,
	highlightWhitespace,
	keymap,
	lineNumbers,
	scrollPastEnd,
} from "@codemirror/view";
import {
	abbreviationTracker,
	EmmetKnownSyntax,
	emmetCompletionSource,
	emmetConfig,
	expandAbbreviation,
	wrapWithAbbreviation,
} from "@emmetio/codemirror6-plugin";
import createBaseExtensions from "cm/baseExtensions";
import {
	setKeyBindings as applyKeyBindings,
	executeCommand,
	getCommandKeymapExtension,
	getRegisteredCommands,
	refreshCommandKeymap,
	registerExternalCommand,
	removeExternalCommand,
} from "cm/commandRegistry";
import lspClientManager from "cm/lsp/clientManager";
import {
	getLspDiagnostics,
	LSP_DIAGNOSTICS_EVENT,
	lspDiagnosticsClientExtension,
	lspDiagnosticsUiExtension,
} from "cm/lsp/diagnostics";
import { stopManagedServer } from "cm/lsp/serverLauncher";
import serverRegistry from "cm/lsp/serverRegistry";
// CodeMirror mode management
import {
	getModeForPath,
	getModes,
	getModesByName,
	initModes,
} from "cm/modelist";
import createTouchSelectionMenu from "cm/touchSelectionMenu";
import "cm/supportedModes";
import { autocompletion } from "@codemirror/autocomplete";
import colorView from "cm/colorView";
import {
	getAllFolds,
	restoreFolds,
	restoreSelection,
	setScrollPosition,
} from "cm/editorUtils";
import indentGuides from "cm/indentGuides";
import rainbowBrackets from "cm/rainbowBrackets";
import { getThemeExtensions } from "cm/themes";
import list from "components/collapsableList";
import quickTools from "components/quickTools";
import ScrollBar from "components/scrollbar";
import SideButton, { sideButtonContainer } from "components/sideButton";
import keyboardHandler, { keydownState } from "handlers/keyboard";
import EditorFile from "./editorFile";
import openFile from "./openFile";
import { addedFolder } from "./openFolder";
import appSettings from "./settings";
import {
	getSystemConfiguration,
	HARDKEYBOARDHIDDEN_NO,
} from "./systemConfiguration";

/**
 * Represents an editor manager that handles multiple files and provides various editor configurations and event listeners.
 * @param {HTMLElement} $header - The header element.
 * @param {HTMLElement} $body - The body element.
 * @returns {Promise<Object>} A promise that resolves to the editor manager object.
 */
async function EditorManager($header, $body) {
	/**
	 * @type {Collapsible & HTMLElement}
	 */
	let $openFileList;
	let TIMEOUT_VALUE = 500;
	let preventScrollbarV = false;
	let preventScrollbarH = false;
	let scrollBarVisibilityCount = 0;
	let timeoutQuicktoolsToggler;
	let timeoutHeaderToggler;
	let isScrolling = false;
	let lastScrollTop = 0;
	let lastScrollLeft = 0;

	// Debounce timers for CodeMirror change handling
	let checkTimeout = null;
	let autosaveTimeout = null;
	let touchSelectionController = null;
	let touchSelectionSyncRaf = 0;
	let nativeContextMenuDisabled = null;

	const setNativeContextMenuDisabled = (disabled) => {
		const value = !!disabled;
		if (nativeContextMenuDisabled === value) return;
		nativeContextMenuDisabled = value;
		const api = globalThis.system?.setNativeContextMenuDisabled;
		if (typeof api !== "function") return;
		try {
			api.call(globalThis.system, value);
		} catch (error) {
			console.warn("Failed to update native context menu state", error);
		}
	};

	const { scrollbarSize } = appSettings.value;
	const events = {
		"switch-file": [],
		"rename-file": [],
		"save-file": [],
		"file-loaded": [],
		"file-content-changed": [],
		"add-folder": [],
		"remove-folder": [],
		update: [],
		"new-file": [],
		"remove-file": [],
		"int-open-file-list": [],
		emit(event, ...args) {
			if (!events[event]) return;
			events[event].forEach((fn) => fn(...args));
		},
	};
	const $container = <div className="editor-container"></div>;
	// Ensure the container participates well in flex layouts and can constrain the editor
	$container.style.flex = "1 1 auto";
	$container.style.minHeight = "0"; // allow child scroller to size correctly
	$container.style.height = "100%";
	$container.style.width = "100%";
	const problemButton = SideButton({
		text: strings.problems,
		icon: "warningreport_problem",
		backgroundColor: "var(--danger-color)",
		textColor: "var(--danger-text-color)",
		onclick() {
			acode.exec("open", "problems");
		},
	});

	// Make CodeMirror fill the container height and manage scrolling internally
	const fixedHeightTheme = EditorView.theme({
		"&": { height: "100%" },
		".cm-scroller": { height: "100%", overflow: "auto" },
	});

	const pointerCursorVisibilityExtension = EditorView.updateListener.of(
		(update) => {
			if (!update.selectionSet) return;
			const pointerTriggered = update.transactions.some(
				(tr) =>
					tr.isUserEvent("pointer") ||
					tr.isUserEvent("select") ||
					tr.isUserEvent("select.pointer") ||
					tr.isUserEvent("touch") ||
					tr.isUserEvent("select.touch"),
			);
			if (!pointerTriggered) return;
			requestAnimationFrame(() => {
				if (!isCursorVisible()) scrollCursorIntoView({ behavior: "instant" });
			});
		},
	);

	const touchSelectionUpdateExtension = EditorView.updateListener.of(
		(update) => {
			if (!touchSelectionController) return;
			const pointerTriggered = update.transactions.some(
				(tr) =>
					tr.isUserEvent("pointer") ||
					tr.isUserEvent("select") ||
					tr.isUserEvent("select.pointer") ||
					tr.isUserEvent("touch") ||
					tr.isUserEvent("select.touch"),
			);
			if (
				update.selectionSet ||
				update.docChanged ||
				update.geometryChanged ||
				update.viewportChanged ||
				pointerTriggered
			) {
				cancelAnimationFrame(touchSelectionSyncRaf);
				touchSelectionSyncRaf = requestAnimationFrame(() => {
					touchSelectionController?.onStateChanged({
						pointerTriggered,
						selectionChanged: update.selectionSet,
					});
				});
			}
		},
	);

	// Compartment to swap editor theme dynamically
	const themeCompartment = new Compartment();
	// Compartments to control indentation, tab width, and font styling dynamically
	const indentUnitCompartment = new Compartment();
	const tabSizeCompartment = new Compartment();
	const fontStyleCompartment = new Compartment();
	// Compartment for line wrapping
	const wrapCompartment = new Compartment();
	// Compartment for line numbers
	const lineNumberCompartment = new Compartment();
	// Compartment for text direction (RTL/LTR)
	const rtlCompartment = new Compartment();
	// Compartment for whitespace visualization
	const whitespaceCompartment = new Compartment();
	// Compartment for fold gutter theme (fade)
	const foldThemeCompartment = new Compartment();
	// Compartment for autocompletion behavior
	const completionCompartment = new Compartment();
	// Compartment for rainbow bracket colorizer
	const rainbowCompartment = new Compartment();
	// Compartment for indent guides
	const indentGuidesCompartment = new Compartment();
	// Compartment for read-only toggling
	const readOnlyCompartment = new Compartment();
	// Compartment for language mode (allows async loading/reconfigure)
	const languageCompartment = new Compartment();
	// Compartment for LSP extensions so we can swap per file
	const lspCompartment = new Compartment();
	const diagnosticsClientExt = lspDiagnosticsClientExtension();
	const buildDiagnosticsUiExt = () =>
		lspDiagnosticsUiExtension(appSettings?.value?.lintGutter !== false);
	let lspRequestToken = 0;
	let lastLspUri = null;
	const UNTITLED_URI_PREFIX = "untitled://acode/";

	function getEditorFontFamily() {
		const font = appSettings?.value?.editorFont || "Roboto Mono";
		return `${font}, Noto Mono, Monaco, monospace`;
	}

	function makeFontTheme() {
		const fontSize = appSettings?.value?.fontSize || "12px";
		const lineHeight = appSettings?.value?.lineHeight || 1.6;
		const fontFamily = getEditorFontFamily();
		return EditorView.theme({
			"&": { fontSize, lineHeight: String(lineHeight) },
			".cm-content": { fontFamily },
			".cm-gutter": { fontFamily },
			".cm-tooltip, .cm-tooltip *": { fontFamily },
		});
	}

	function makeWrapExtension() {
		return appSettings?.value?.textWrap ? EditorView.lineWrapping : [];
	}

	function makeLineNumberExtension() {
		const { linenumbers = true, relativeLineNumbers = false } =
			appSettings?.value || {};
		if (!linenumbers)
			return EditorView.theme({
				".cm-gutter": {
					display: "none !important",
					width: "0px !important",
					minWidth: "0px !important",
					border: "none !important",
				},
			});
		if (!relativeLineNumbers)
			return Prec.highest([lineNumbers(), highlightActiveLineGutter()]);
		return Prec.highest([
			lineNumbers({
				formatNumber: (lineNo, state) => {
					try {
						const cur = state.doc.lineAt(state.selection.main.head).number;
						const diff = Math.abs(lineNo - cur);
						return diff === 0 ? String(lineNo) : String(diff);
					} catch (_) {
						return String(lineNo);
					}
				},
			}),
			highlightActiveLineGutter(),
		]);
	}

	function makeIndentExtensions() {
		const { softTab = true, tabSize = 2 } = appSettings?.value || {};
		const unit = softTab ? " ".repeat(Math.max(1, Number(tabSize) || 2)) : "\t";
		return {
			indentExt: indentUnit.of(unit),
			tabSizeExt: EditorState.tabSize.of(Math.max(1, Number(tabSize) || 2)),
		};
	}

	function makeWhitespaceTheme() {
		return EditorView.theme({
			".cm-highlightSpace": {
				backgroundImage:
					"radial-gradient(circle at 50% 54%, var(--cm-space-marker-color) 0.08em, transparent 0.1em)",
				backgroundPosition: "center",
				backgroundRepeat: "no-repeat",
				opacity: "0.5",
			},
			".cm-highlightTab": {
				backgroundSize: "auto 70%",
				backgroundPosition: "right 60%",
				opacity: "0.65",
			},
			".cm-trailingSpace": {
				backgroundColor: "var(--cm-trailing-space-color)",
				borderRadius: "2px",
			},
			"&": {
				"--cm-space-marker-color": "rgba(127, 127, 127, 0.6)",
				"--cm-trailing-space-color": "rgba(255, 77, 77, 0.2)",
			},
		});
	}

	// Centralised CodeMirror options registry for organized configuration
	// Each spec declares related settings keys, its compartment(s), and a builder returning extension(s)
	const cmOptionSpecs = [
		{
			keys: ["linenumbers", "relativeLineNumbers"],
			compartments: [lineNumberCompartment],
			build() {
				return makeLineNumberExtension();
			},
		},
		{
			keys: ["rainbowBrackets"],
			compartments: [rainbowCompartment],
			build() {
				const enabled = appSettings?.value?.rainbowBrackets ?? true;
				if (!enabled) return [];
				return rainbowBrackets();
			},
		},
		{
			keys: ["indentGuides"],
			compartments: [indentGuidesCompartment],
			build() {
				const enabled = appSettings?.value?.indentGuides ?? true;
				if (!enabled) return [];
				return indentGuides({
					highlightActiveGuide: true,
					hideOnBlankLines: false,
				});
			},
		},
		{
			keys: ["fontSize", "editorFont", "lineHeight"],
			compartments: [fontStyleCompartment],
			build() {
				return makeFontTheme();
			},
		},
		{
			keys: ["textWrap"],
			compartments: [wrapCompartment],
			build() {
				return makeWrapExtension();
			},
		},
		{
			keys: ["softTab", "tabSize"],
			compartments: [indentUnitCompartment, tabSizeCompartment],
			build() {
				const { indentExt, tabSizeExt } = makeIndentExtensions();
				return [indentExt, tabSizeExt];
			},
		},
		{
			keys: ["rtlText"],
			compartments: [rtlCompartment],
			build() {
				const rtl = !!appSettings?.value?.rtlText;
				return EditorView.theme({
					"&": { direction: rtl ? "rtl" : "ltr" },
				});
			},
		},
		{
			keys: ["showSpaces"],
			compartments: [whitespaceCompartment],
			build() {
				const show = !!appSettings?.value?.showSpaces;
				return show
					? [
							highlightWhitespace(),
							highlightTrailingWhitespace(),
							makeWhitespaceTheme(),
						]
					: [];
			},
		},
		{
			keys: ["fadeFoldWidgets"],
			compartments: [foldThemeCompartment],
			build() {
				const fade = !!appSettings?.value?.fadeFoldWidgets;
				if (!fade) return [];
				return EditorView.theme({
					".cm-gutter.cm-foldGutter .cm-gutterElement": {
						opacity: 0,
						pointerEvents: "none",
						transition: "opacity .12s ease",
					},
					".cm-gutter.cm-foldGutter:hover .cm-gutterElement, .cm-gutter.cm-foldGutter .cm-gutterElement:hover":
						{
							opacity: 1,
							pointerEvents: "auto",
						},
				});
			},
		},
		{
			keys: ["liveAutoCompletion"],
			compartments: [completionCompartment],
			build() {
				const live = !!appSettings?.value?.liveAutoCompletion;
				return autocompletion({ activateOnTyping: live });
			},
		},
	];

	function getBaseExtensionsFromOptions() {
		/** @type {import("@codemirror/state").Extension[]} */
		const exts = [];
		for (const spec of cmOptionSpecs) {
			const built = spec.build();
			if (spec.compartments.length === 1) {
				exts.push(spec.compartments[0].of(built));
			} else {
				const arr = Array.isArray(built) ? built : [built];
				for (let i = 0; i < spec.compartments.length; i++) {
					const comp = spec.compartments[i];
					const ext = arr[i];
					if (ext !== undefined) exts.push(comp.of(ext));
				}
			}
		}
		return exts;
	}

	function createEmmetExtensionSet({
		syntax,
		tracker = {},
		config: emmetOverrides = {},
	} = {}) {
		const resolvedSyntax =
			syntax === undefined ? EmmetKnownSyntax.html : syntax;
		if (!resolvedSyntax) return [];
		const trackerExtension = abbreviationTracker({
			syntax: resolvedSyntax,
			...tracker,
		});
		const { autocompleteTab = ["markup", "stylesheet"], ...restOverrides } =
			emmetOverrides || {};
		const emmetConfigExtension = emmetConfig.of({
			syntax: resolvedSyntax,
			autocompleteTab,
			...restOverrides,
		});
		return [
			Prec.high(trackerExtension),
			wrapWithAbbreviation(),
			keymap.of([{ key: "Mod-e", run: expandAbbreviation }]),
			emmetConfigExtension,
		];
	}

	function applyOptions(keys) {
		const filter = keys ? new Set(keys) : null;
		for (const spec of cmOptionSpecs) {
			if (filter && !spec.keys.some((k) => filter.has(k))) continue;
			const built = spec.build();
			const effects = [];
			if (spec.compartments.length === 1) {
				effects.push(spec.compartments[0].reconfigure(built));
			} else {
				const arr = Array.isArray(built) ? built : [built];
				for (let i = 0; i < spec.compartments.length; i++) {
					const comp = spec.compartments[i];
					const ext = arr[i] ?? [];
					effects.push(comp.reconfigure(ext));
				}
			}
			editor.dispatch({ effects });
		}
	}

	function buildLspMetadata(file) {
		if (!file || file.type !== "editor") return null;
		const uri = getFileLspUri(file);
		if (!uri) return null;
		const languageId = getFileLanguageId(file);
		return {
			uri,
			languageId,
			languageName: file.currentMode || file.mode || languageId,
			view: editor,
			file,
			rootUri: resolveRootUriForContext({ uri, file }),
		};
	}

	async function configureLspForFile(file) {
		const metadata = buildLspMetadata(file);
		const token = ++lspRequestToken;
		if (!metadata) {
			detachActiveLsp();
			editor.dispatch({ effects: lspCompartment.reconfigure([]) });
			return;
		}
		if (metadata.uri !== lastLspUri) {
			detachActiveLsp();
		}
		try {
			const extensions =
				(await lspClientManager.getExtensionsForFile(metadata)) || [];
			if (token !== lspRequestToken) return;
			if (!extensions.length) {
				lastLspUri = null;
				editor.dispatch({ effects: lspCompartment.reconfigure([]) });
				return;
			}
			lastLspUri = metadata.uri;
			editor.dispatch({
				effects: lspCompartment.reconfigure(extensions),
			});
		} catch (error) {
			if (token !== lspRequestToken) return;
			console.error("Failed to configure LSP", error);
			lastLspUri = null;
			editor.dispatch({ effects: lspCompartment.reconfigure([]) });
		}
	}

	function detachLspForFile(file) {
		if (!file || file.type !== "editor") return;
		const uri = getFileLspUri(file);
		if (!uri) return;
		try {
			lspClientManager.detach(uri);
		} catch (error) {
			console.warn(`Failed to detach LSP client for ${uri}`, error);
		}
		if (uri === lastLspUri && manager.activeFile?.id === file.id) {
			lastLspUri = null;
			editor.dispatch({ effects: lspCompartment.reconfigure([]) });
		}
	}

	// Plugin already wires CSS completions; attach extras for related syntaxes.
	const emmetCompletionSyntaxes = new Set([
		EmmetKnownSyntax.scss,
		EmmetKnownSyntax.less,
		EmmetKnownSyntax.sass,
		EmmetKnownSyntax.sss,
		EmmetKnownSyntax.stylus,
		EmmetKnownSyntax.postcss,
	]);

	function maybeAttachEmmetCompletions(targetExtensions, syntax) {
		if (emmetCompletionSyntaxes.has(syntax)) {
			targetExtensions.push(
				EditorState.languageData.of(() => [
					{ autocomplete: emmetCompletionSource },
				]),
			);
		}
	}

	function getFileLspUri(file) {
		if (!file) return null;
		if (file.uri) return file.uri;
		return `${UNTITLED_URI_PREFIX}${file.id}`;
	}

	function getFileLanguageId(file) {
		if (!file) return "plaintext";
		const mode = file.currentMode || file.mode;
		if (mode) return String(mode).toLowerCase();
		try {
			const guess = getModeForPath(file.filename || file.name || "");
			if (guess?.name) return String(guess.name).toLowerCase();
		} catch (_) {}
		return "plaintext";
	}

	function resolveRootUriForContext(context = {}) {
		const uri = context.uri || context.file?.uri;
		if (!uri) return null;
		for (const folder of addedFolder) {
			try {
				const base = folder?.url;
				if (!base) continue;
				if (uri.startsWith(base)) return base;
			} catch (_) {}
		}
		return uri;
	}

	function detachActiveLsp() {
		if (!lastLspUri) return;
		try {
			lspClientManager.detach(lastLspUri, editor);
		} catch (error) {
			console.warn(`Failed to detach LSP session for ${lastLspUri}`, error);
		}
		lastLspUri = null;
	}

	function applyLspSettings() {
		const { lsp } = appSettings.value || {};
		if (!lsp) return;
		const overrides = lsp.servers || {};
		for (const [id, config] of Object.entries(overrides)) {
			if (!config || typeof config !== "object") continue;
			const key = String(id || "")
				.trim()
				.toLowerCase();
			if (!key) continue;
			const existing = serverRegistry.getServer(key);
			if (existing) {
				serverRegistry.updateServer(key, (current) => {
					const next = { ...current };
					if (Array.isArray(config.languages) && config.languages.length) {
						next.languages = config.languages.map((lang) =>
							String(lang).toLowerCase(),
						);
					}
					if (config.transport && typeof config.transport === "object") {
						next.transport = { ...current.transport, ...config.transport };
						delete next.transport.protocols;
					}
					if (config.clientConfig && typeof config.clientConfig === "object") {
						next.clientConfig = {
							...current.clientConfig,
							...config.clientConfig,
						};
					}
					if (
						config.initializationOptions &&
						typeof config.initializationOptions === "object"
					) {
						next.initializationOptions = {
							...current.initializationOptions,
							...config.initializationOptions,
						};
					}
					if (
						typeof config.startupTimeout === "number" &&
						Number.isFinite(config.startupTimeout) &&
						config.startupTimeout > 0
					) {
						next.startupTimeout = Math.floor(config.startupTimeout);
					}
					if (config.launcher && typeof config.launcher === "object") {
						next.launcher = { ...current.launcher, ...config.launcher };
					}
					if (Object.prototype.hasOwnProperty.call(config, "enabled")) {
						next.enabled = !!config.enabled;
					}
					return next;
				});
				if (config.enabled === false) {
					stopManagedServer(key);
				}
			} else if (
				Array.isArray(config.languages) &&
				config.languages.length &&
				config.transport &&
				typeof config.transport === "object"
			) {
				try {
					serverRegistry.registerServer({
						id: key,
						label: config.label || key,
						languages: config.languages,
						transport: config.transport,
						clientConfig: config.clientConfig,
						initializationOptions: config.initializationOptions,
						startupTimeout: config.startupTimeout,
						launcher: config.launcher,
						enabled: config.enabled !== false,
					});
					serverRegistry.updateServer(key, (current) => {
						if (current.transport?.protocols) {
							const updated = { ...current };
							updated.transport = { ...current.transport };
							delete updated.transport.protocols;
							return updated;
						}
						return current;
					});
					if (config.enabled === false) {
						stopManagedServer(key);
					}
				} catch (error) {
					console.warn(
						`Failed to register LSP server override for ${key}`,
						error,
					);
				}
			}
		}
	}

	// Create minimal CodeMirror editor
	const editorState = EditorState.create({
		doc: "",
		extensions: [
			// Emmet needs highest precedence so place before default keymaps
			...createEmmetExtensionSet({ syntax: EmmetKnownSyntax.html }),
			...createBaseExtensions(),
			getCommandKeymapExtension(),
			// Default theme
			themeCompartment.of(oneDark),
			fixedHeightTheme,
			scrollPastEnd(),
			pointerCursorVisibilityExtension,
			touchSelectionUpdateExtension,
			search(),
			// Ensure read-only can be toggled later via compartment
			readOnlyCompartment.of(EditorState.readOnly.of(false)),
			// Editor options driven by settings via compartments
			...getBaseExtensionsFromOptions(),
		],
	});

	const editor = new EditorView({
		state: editorState,
		parent: $container,
	});

	await applyKeyBindings(editor);

	editor.execCommand = function (commandName, args) {
		if (!commandName) return false;
		return executeCommand(String(commandName), editor, args);
	};

	editor.commands = {
		addCommand(descriptor) {
			const command = registerExternalCommand(descriptor);
			refreshCommandKeymap(editor);
			return command;
		},
		removeCommand(name) {
			if (!name) return;
			removeExternalCommand(name);
			refreshCommandKeymap(editor);
		},
	};

	Object.defineProperty(editor.commands, "commands", {
		get() {
			const map = {};
			getRegisteredCommands().forEach((cmd) => {
				map[cmd.name] = cmd;
			});
			return map;
		},
	});

	// Provide editor.session for Ace API compatibility
	// Returns the active file's session (Proxy with Ace-like methods)
	Object.defineProperty(editor, "session", {
		get() {
			return manager.activeFile?.session ?? null;
		},
	});

	touchSelectionController = createTouchSelectionMenu(editor, {
		container: $container,
		getActiveFile: () => manager?.activeFile || null,
	});

	// Provide minimal Ace-like API compatibility used by plugins
	/**
	 * Insert text at the current selection/cursor in the editor
	 * @param {string} text
	 * @returns {boolean} success
	 */
	editor.insert = function (text) {
		try {
			const { from, to } = editor.state.selection.main;
			const insertText = String(text ?? "");
			// Replace current selection and move cursor to end of inserted text
			editor.dispatch({
				changes: { from, to, insert: insertText },
				selection: {
					anchor: from + insertText.length,
					head: from + insertText.length,
				},
			});
			return true;
		} catch (_) {
			return false;
		}
	};

	// Set CodeMirror theme by id registered in our registry
	editor.setTheme = function (themeId) {
		try {
			const id = String(themeId || "");
			const ext = getThemeExtensions(id, [oneDark]);
			editor.dispatch({ effects: themeCompartment.reconfigure(ext) });
			return true;
		} catch (_) {
			return false;
		}
	};

	/**
	 * Go to a specific line and column in the editor (CodeMirror implementation)
	 * Supports multiple input formats:
	 * - Simple line number: gotoLine(16) or gotoLine(16, 5)
	 * - Relative offsets: gotoLine("+5") or gotoLine("-3")
	 * - Percentages: gotoLine("50%") or gotoLine("25%")
	 * - Line:column format: gotoLine("16:5")
	 * - Mixed formats: gotoLine("+5:10") or gotoLine("50%:5")
	 *
	 * @param {number|string} line - Line number (1-based), or string with special formats
	 * @param {number} column - Column number (0-based) - only used with numeric line parameter
	 * @param {boolean} animate - Whether to animate (not used in CodeMirror, for compatibility)
	 * @returns {boolean} success
	 */
	editor.gotoLine = function (line, column = 0, animate = false) {
		try {
			const { state } = editor;
			const { doc } = state;

			let targetLine,
				targetColumn = column;

			// If line is a string, parse it for special formats
			if (typeof line === "string") {
				const match = /^([+-])?(\d+)?(:\d+)?(%)?$/.exec(line.trim());
				if (!match) {
					console.warn("Invalid gotoLine format:", line);
					return false;
				}

				const currentLine = doc.lineAt(state.selection.main.head);
				const [, sign, lineNum, colonColumn, percent] = match;

				// Parse column if specified in line:column format
				if (colonColumn) {
					targetColumn = Math.max(0, +colonColumn.slice(1) - 1); // Convert to 0-based
				}

				// Parse line number
				let parsedLine = lineNum ? +lineNum : currentLine.number;

				if (lineNum && percent) {
					// Percentage format: "50%" or "+10%"
					let percentage = parsedLine / 100;
					if (sign) {
						percentage =
							percentage * (sign === "-" ? -1 : 1) +
							currentLine.number / doc.lines;
					}
					targetLine = Math.round(doc.lines * percentage);
				} else if (lineNum && sign) {
					// Relative format: "+5" or "-3"
					targetLine =
						parsedLine * (sign === "-" ? -1 : 1) + currentLine.number;
				} else if (lineNum) {
					// Absolute line number
					targetLine = parsedLine;
				} else {
					// No line number specified, stay on current line
					targetLine = currentLine.number;
				}
			} else {
				// Simple numeric line parameter
				targetLine = line;
			}

			// Clamp line number to valid range
			const lineNum = Math.max(1, Math.min(targetLine, doc.lines));
			const docLine = doc.line(lineNum);

			// Clamp column to line length
			const col = Math.max(0, Math.min(targetColumn, docLine.length));
			const pos = docLine.from + col;

			// Move cursor and scroll into view
			editor.dispatch({
				selection: { anchor: pos, head: pos },
				effects: EditorView.scrollIntoView(pos, { y: "center" }),
			});
			editor.focus();
			return true;
		} catch (error) {
			console.error("Error in gotoLine:", error);
			return false;
		}
	};

	/**
	 * Get current cursor position)
	 * @returns {{row: number, column: number}} Cursor position
	 */
	editor.getCursorPosition = function () {
		try {
			const head = editor.state.selection.main.head;
			const cursor = editor.state.doc.lineAt(head);
			const line = cursor.number;
			const col = head - cursor.from;
			return { row: line, column: col };
		} catch (_) {
			return { row: 1, column: 0 };
		}
	};

	/**
	 * Move cursor to specific position
	 * @param {{row: number, column: number}} pos - Position to move to
	 */
	editor.moveCursorToPosition = function (pos) {
		try {
			const lineNum = Math.max(1, pos.row || 1);
			const col = Math.max(0, pos.column || 0);
			editor.gotoLine(lineNum, col);
		} catch (_) {
			// ignore
		}
	};

	/**
	 * Get the entire document value
	 * @returns {string} Document content
	 */
	editor.getValue = function () {
		try {
			return editor.state.doc.toString();
		} catch (_) {
			return "";
		}
	};

	/**
	 * Compatibility object for selection-related methods
	 */
	editor.selection = {
		/**
		 * Get current selection anchor
		 * @returns {number} Anchor position
		 */
		get anchor() {
			try {
				return editor.state.selection.main.anchor;
			} catch (_) {
				return 0;
			}
		},

		/**
		 * Get current selection range
		 * @returns {{start: {row: number, column: number}, end: {row: number, column: number}}} Selection range
		 */
		getRange: function () {
			try {
				const { from, to } = editor.state.selection.main;
				const fromLine = editor.state.doc.lineAt(from);
				const toLine = editor.state.doc.lineAt(to);
				return {
					start: {
						row: fromLine.number,
						column: from - fromLine.from,
					},
					end: {
						row: toLine.number,
						column: to - toLine.from,
					},
				};
			} catch (_) {
				return { start: { row: 1, column: 0 }, end: { row: 1, column: 0 } }; // Default to line 1
			}
		},

		/**
		 * Get cursor position
		 * @returns {{row: number, column: number}} Cursor position
		 */
		getCursor: function () {
			return editor.getCursorPosition();
		},
	};

	/**
	 * Get selected text or text under cursor (CodeMirror implementation)
	 * @returns {string} Selected text
	 */
	editor.getCopyText = function () {
		try {
			const { from, to } = editor.state.selection.main;
			if (from === to) return ""; // No selection
			return editor.state.doc.sliceString(from, to);
		} catch (_) {
			return "";
		}
	};

	editor.setSelection = function (value) {
		touchSelectionController?.setSelection(!!value);
	};

	editor.setMenu = function (value) {
		touchSelectionController?.setMenu(!!value);
	};

	// Helper: apply a file's content and language to the editor view
	function applyFileToEditor(file) {
		if (!file || file.type !== "editor") return;
		const syntax = getEmmetSyntaxForFile(file);
		const baseExtensions = [
			// Emmet needs to precede default keymaps so tracker Tab wins over indent
			...createEmmetExtensionSet({ syntax }),
			...createBaseExtensions(),
			getCommandKeymapExtension(),
			// keep compartment in the state to allow dynamic theme changes later
			themeCompartment.of(oneDark),
			fixedHeightTheme,
			scrollPastEnd(),
			pointerCursorVisibilityExtension,
			touchSelectionUpdateExtension,
			search(),
			// Keep dynamic compartments across state swaps
			...getBaseExtensionsFromOptions(),
		];
		const exts = [...baseExtensions];
		maybeAttachEmmetCompletions(exts, syntax);
		try {
			const langExtFn = file.currentLanguageExtension;
			let initialLang = [];
			if (typeof langExtFn === "function") {
				let result;
				try {
					result = langExtFn();
				} catch (_) {
					result = [];
				}
				// If the loader returns a Promise, reconfigure when it resolves
				if (result && typeof result.then === "function") {
					initialLang = [];
					result
						.then((ext) => {
							try {
								editor.dispatch({
									effects: languageCompartment.reconfigure(ext || []),
								});
							} catch (_) {}
						})
						.catch(() => {
							// ignore load errors; remain in plain text
						});
				} else {
					initialLang = result || [];
				}
			}
			// Ensure language compartment is present (empty -> plain text)
			exts.push(languageCompartment.of(initialLang));
		} catch (e) {
			// ignore language extension errors; fallback to plain text
		}

		// Color preview plugin when enabled
		if (appSettings.value.colorPreview) {
			exts.push(colorView(true));
		}

		// Apply read-only state based on file.editable/loading using Compartment
		try {
			const ro = !file.editable || !!file.loading;
			exts.push(readOnlyCompartment.of(EditorState.readOnly.of(ro)));
		} catch (e) {
			// safe to ignore; editor will remain editable by default
		}

		// Keep file.session in sync and handle caching/autosave
		exts.push(getDocSyncListener());
		exts.push(lspCompartment.of([]));

		// Preserve previous state for restoring selection/folds after swap
		const prevState = file.session || null;

		const doc = prevState ? prevState.doc.toString() : "";
		const state = EditorState.create({ doc, extensions: exts });
		file.session = state;
		editor.setState(state);
		touchSelectionController?.onSessionChanged();
		// Re-apply selected theme after state replacement
		const desiredTheme = appSettings?.value?.editorTheme;
		if (desiredTheme) editor.setTheme(desiredTheme);

		// Ensure dynamic compartments reflect current settings
		applyOptions();

		// Restore selection from previous state if available
		try {
			const sel = prevState?.selection;
			if (sel && Array.isArray(sel.ranges)) {
				const ranges = sel.ranges.map((r) => ({ from: r.from, to: r.to }));
				const mainIndex = sel.mainIndex ?? 0;
				restoreSelection(editor, { ranges, mainIndex });
			}
		} catch (_) {}

		// Restore folds from previous state if available
		try {
			const folds = prevState ? getAllFolds(prevState) : [];
			if (folds && folds.length) {
				restoreFolds(editor, folds);
			}
		} catch (_) {}

		// Restore last known scroll position if present
		if (
			typeof file.lastScrollTop === "number" ||
			typeof file.lastScrollLeft === "number"
		) {
			setScrollPosition(editor, file.lastScrollTop, file.lastScrollLeft);
		}

		void configureLspForFile(file);
	}

	function getEmmetSyntaxForFile(file) {
		const mode = (file?.currentMode || "").toLowerCase();
		const name = (file?.filename || "").toLowerCase();
		const ext = name.includes(".") ? name.split(".").pop() : "";
		if (ext === "tsx" || mode.includes("tsx")) return EmmetKnownSyntax.tsx;
		if (ext === "jsx" || mode.includes("jsx")) return EmmetKnownSyntax.jsx;
		if (mode.includes("javascript") && (ext === "jsx" || ext === "tsx")) {
			return ext === "tsx" ? EmmetKnownSyntax.tsx : EmmetKnownSyntax.jsx;
		}
		if (ext === "css" || mode.includes("css")) return EmmetKnownSyntax.css;
		if (ext === "scss" || mode.includes("scss")) return EmmetKnownSyntax.scss;
		if (ext === "sass" || mode.includes("sass")) return EmmetKnownSyntax.sass;
		if (ext === "less" || mode.includes("less")) return EmmetKnownSyntax.less;
		if (ext === "sss" || mode.includes("sss")) return EmmetKnownSyntax.sss;
		if (ext === "styl" || ext === "stylus" || mode.includes("styl"))
			return EmmetKnownSyntax.stylus;
		if (ext === "postcss" || mode.includes("postcss"))
			return EmmetKnownSyntax.postcss;
		if (ext === "xml" || mode.includes("xml")) return EmmetKnownSyntax.xml;
		if (ext === "xsl" || mode.includes("xsl")) return EmmetKnownSyntax.xsl;
		if (ext === "haml" || mode.includes("haml")) return EmmetKnownSyntax.haml;
		if (
			ext === "pug" ||
			ext === "jade" ||
			mode.includes("pug") ||
			mode.includes("jade")
		)
			return EmmetKnownSyntax.pug;
		if (ext === "slim" || mode.includes("slim")) return EmmetKnownSyntax.slim;
		if (ext === "vue" || mode.includes("vue")) return EmmetKnownSyntax.vue;
		if (ext === "php" || mode.includes("php")) return EmmetKnownSyntax.html;
		if (
			ext === "htm" ||
			ext === "html" ||
			ext === "xhtml" ||
			mode.includes("html")
		)
			return EmmetKnownSyntax.html;
		return null;
	}

	const $vScrollbar = ScrollBar({
		width: scrollbarSize,
		onscroll: onscrollV,
		onscrollend: onscrollVend,
		parent: $body,
	});
	const $hScrollbar = ScrollBar({
		width: scrollbarSize,
		onscroll: onscrollH,
		onscrollend: onscrollHEnd,
		parent: $body,
		placement: "bottom",
	});
	const manager = {
		files: [],
		onupdate: () => {},
		activeFile: null,
		isCodeMirror: true,
		addFile,
		editor,
		readOnlyCompartment,
		getFile,
		switchFile,
		hasUnsavedFiles,
		getEditorHeight,
		getEditorWidth,
		header: $header,
		container: $container,
		getLspMetadata: buildLspMetadata,
		get isScrolling() {
			return isScrolling;
		},
		get openFileList() {
			if (!$openFileList) initFileTabContainer();
			return $openFileList;
		},
		get TIMEOUT_VALUE() {
			return TIMEOUT_VALUE;
		},
		on(types, callback) {
			if (!Array.isArray(types)) types = [types];
			types.forEach((type) => {
				if (!events[type]) events[type] = [];
				events[type].push(callback);
			});
		},
		off(types, callback) {
			if (!Array.isArray(types)) types = [types];
			types.forEach((type) => {
				if (!events[type]) return;
				events[type] = events[type].filter((c) => c !== callback);
			});
		},
		emit(event, ...args) {
			let detailedEvent;
			let detailedEventArgs = args.slice(1);
			if (event === "update") {
				const subEvent = args[0];
				if (subEvent) {
					detailedEvent = `${event}:${subEvent}`;
				}
			}
			events.emit(event, ...args);
			if (detailedEvent) {
				events.emit(detailedEvent, ...detailedEventArgs);
			}
		},
		/**
		 * Restart LSP for the active file
		 * Useful after stopping/restarting language servers
		 */
		restartLsp() {
			const activeFile = manager.activeFile;
			if (activeFile?.type === "editor") {
				void configureLspForFile(activeFile);
			}
		},
	};

	if (typeof document !== "undefined") {
		const globalTarget =
			typeof globalThis !== "undefined" ? globalThis : document;
		const diagnosticsListenerKey = "__acodeDiagnosticsListener";
		const existing = globalTarget?.[diagnosticsListenerKey];
		if (typeof existing === "function") {
			document.removeEventListener(LSP_DIAGNOSTICS_EVENT, existing);
		}
		const listener = () => {
			const active = manager.activeFile;
			if (active?.type === "editor") {
				try {
					active.session = editor.state;
				} catch (_) {}
			}
			toggleProblemButton();
		};
		document.addEventListener(LSP_DIAGNOSTICS_EVENT, listener);
		if (globalTarget) {
			globalTarget[diagnosticsListenerKey] = listener;
		}
	}

	lspClientManager.setOptions({
		resolveRoot: resolveRootUriForContext,
		onClientIdle: ({ server }) => {
			if (server?.id) stopManagedServer(server.id);
		},
		displayFile: async (targetUri) => {
			if (!targetUri) return null;
			// Decode URI components (e.g., %40 -> @) since LSP returns encoded URIs
			const decodedUri = decodeURIComponent(targetUri);
			const existing = manager.getFile(decodedUri, "uri");
			if (existing?.type === "editor") {
				existing.makeActive();
				return editor;
			}
			try {
				await openFile(decodedUri, { render: true });
				const opened = manager.getFile(decodedUri, "uri");
				if (opened?.type === "editor") {
					opened.makeActive();
					return editor;
				}
			} catch (error) {
				console.error("[LSP] Failed to open file", decodedUri, error);
			}
			return null;
		},
		openFile: async (targetUri) => {
			if (!targetUri) return null;
			// Decode URI components (e.g., %40 -> @)
			const decodedUri = decodeURIComponent(targetUri);
			const existing = manager.getFile(decodedUri, "uri");
			if (existing?.type === "editor") {
				existing.makeActive();
				return editor;
			}
			try {
				await openFile(decodedUri, { render: true });
				const opened = manager.getFile(decodedUri, "uri");
				if (opened?.type === "editor") {
					opened.makeActive();
					return editor;
				}
			} catch (error) {
				console.error("[LSP] Failed to open file", decodedUri, error);
			}
			return null;
		},
		resolveLanguageId: (uri) => {
			if (!uri) return "plaintext";
			try {
				const mode = getModeForPath(uri);
				if (mode?.name) return String(mode.name).toLowerCase();
			} catch (_) {}
			return "plaintext";
		},
		clientExtensions: [diagnosticsClientExt],
		diagnosticsUiExtension: buildDiagnosticsUiExt(),
	});
	applyLspSettings();

	$body.append($container);
	initModes(); // Initialize CodeMirror modes
	await setupEditor();

	// Initialize theme from settings or fallback
	try {
		const desired = appSettings?.value?.editorTheme || "one_dark";
		editor.setTheme(desired);
	} catch (_) {}

	// Ensure initial options reflect settings
	applyOptions();

	$hScrollbar.onshow = $vScrollbar.onshow = updateFloatingButton.bind(
		{},
		false,
	);
	$hScrollbar.onhide = $vScrollbar.onhide = updateFloatingButton.bind({}, true);

	appSettings.on("update:textWrap", function () {
		updateMargin();
		applyOptions(["textWrap"]);
	});

	function updateEditorIndentationSettings() {
		applyOptions(["softTab", "tabSize"]);
	}

	function updateEditorStyleFromSettings() {
		applyOptions(["fontSize", "editorFont", "lineHeight"]);
	}

	function updateEditorWrapFromSettings() {
		applyOptions(["textWrap"]);
		if (appSettings.value.textWrap) {
			$hScrollbar.hide();
		}
	}

	function updateEditorLineNumbersFromSettings() {
		applyOptions(["linenumbers", "relativeLineNumbers"]);
	}

	appSettings.on("update:tabSize", function () {
		updateEditorIndentationSettings();
	});

	appSettings.on("update:softTab", function () {
		updateEditorIndentationSettings();
	});

	// Show spaces/tabs and trailing whitespace
	appSettings.on("update:showSpaces", function () {
		applyOptions(["showSpaces"]);
	});

	// Font size update for CodeMirror
	appSettings.on("update:fontSize", function () {
		updateEditorStyleFromSettings();
	});

	// Font family update for CodeMirror
	appSettings.on("update:editorFont", function () {
		updateEditorStyleFromSettings();
	});

	appSettings.on("update:lsp", async function () {
		applyLspSettings();
		const active = manager.activeFile;
		if (active?.type === "editor") {
			void configureLspForFile(active);
		} else {
			detachActiveLsp();
			editor.dispatch({ effects: lspCompartment.reconfigure([]) });
			await lspClientManager.dispose();
		}
	});

	appSettings.on("update:openFileListPos", function (value) {
		initFileTabContainer();
		$vScrollbar.resize();
	});

	// appSettings.on("update:showPrintMargin", function (value) {
	// 	// manager.editor.setOption("showPrintMargin", value);
	// });

	appSettings.on("update:scrollbarSize", function (value) {
		$vScrollbar.size = value;
		$hScrollbar.size = value;
	});

	// Live autocompletion (activateOnTyping)
	appSettings.on("update:liveAutoCompletion", function () {
		applyOptions(["liveAutoCompletion"]);
	});

	appSettings.on("update:linenumbers", function () {
		updateMargin(true);
		updateEditorLineNumbersFromSettings();
	});

	// Line height update for CodeMirror
	appSettings.on("update:lineHeight", function () {
		updateEditorStyleFromSettings();
	});

	appSettings.on("update:relativeLineNumbers", function () {
		updateEditorLineNumbersFromSettings();
	});

	appSettings.on("update:lintGutter", function (value) {
		lspClientManager.setOptions({
			diagnosticsUiExtension: lspDiagnosticsUiExtension(value !== false),
		});
		const active = manager.activeFile;
		if (active?.type === "editor") {
			void configureLspForFile(active);
		}
	});

	// appSettings.on("update:elasticTabstops", function (_value) {
	// 	// Not applicable in CodeMirror (Ace-era). No-op for now.
	// });

	appSettings.on("update:rtlText", function () {
		applyOptions(["rtlText"]);
	});

	// appSettings.on("update:hardWrap", function (_value) {
	// 	// Not applicable in CodeMirror (Ace-era). No-op for now.
	// });

	// appSettings.on("update:printMargin", function (_value) {
	// 	// Not applicable in CodeMirror (Ace-era). No-op for now.
	// });

	appSettings.on("update:colorPreview", function () {
		const file = manager.activeFile;
		if (file?.type === "editor") applyFileToEditor(file);
	});

	appSettings.on("update:showSideButtons", function () {
		updateMargin();
		updateSideButtonContainer();
		toggleProblemButton();
	});

	appSettings.on("update:showAnnotations", function () {
		updateMargin(true);
	});

	appSettings.on("update:fadeFoldWidgets", function () {
		applyOptions(["fadeFoldWidgets"]);
	});

	// Toggle rainbow brackets
	appSettings.on("update:rainbowBrackets", function () {
		applyOptions(["rainbowBrackets"]);
	});

	// Toggle indent guides
	appSettings.on("update:indentGuides", function () {
		applyOptions(["indentGuides"]);
	});

	// Keep file.session and cache in sync on every edit
	function getDocSyncListener() {
		return EditorView.updateListener.of((update) => {
			const file = manager.activeFile;
			if (!file || file.type !== "editor") return;

			// Only run expensive work when the document actually changed
			if (!update.docChanged) return;

			// Mirror latest state only on doc changes to avoid clobbering async loads
			try {
				file.session = update.state;
			} catch (_) {}

			// Debounced change handling (unsaved flag, cache, autosave)
			if (checkTimeout) clearTimeout(checkTimeout);
			if (autosaveTimeout) clearTimeout(autosaveTimeout);

			checkTimeout = setTimeout(async () => {
				const changed = await file.isChanged();
				file.isUnsaved = changed;
				try {
					await file.writeToCache();
				} catch (_) {}

				events.emit("file-content-changed", file);
				manager.onupdate("file-changed");
				manager.emit("update", "file-changed");
				toggleProblemButton();

				const { autosave } = appSettings.value;
				if (file.uri && changed && autosave) {
					autosaveTimeout = setTimeout(() => {
						acode.exec("save", false);
					}, autosave);
				}

				file.markChanged = true;
			}, TIMEOUT_VALUE);
		});
	}

	// Register critical listeners
	manager.on(["file-loaded"], (file) => {
		if (!file) return;
		if (manager.activeFile?.id === file.id && file.type === "editor") {
			applyFileToEditor(file);
		}
	});

	manager.on(["update:read-only"], () => {
		const file = manager.activeFile;
		if (file?.type !== "editor") return;
		try {
			const ro = !file.editable || !!file.loading;
			editor.dispatch({
				effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
			});
			touchSelectionController?.onStateChanged();
		} catch (_) {
			// Fallback: full re-apply
			applyFileToEditor(file);
		}
	});

	manager.on(["remove-file"], (file) => {
		detachLspForFile(file);
		toggleProblemButton();
	});

	manager.on(["rename-file"], (file) => {
		if (file?.type !== "editor") return;
		if (manager.activeFile?.id === file.id) {
			// Re-apply file to editor to update language/syntax highlighting
			applyFileToEditor(file);
			void configureLspForFile(file);
		}
	});

	// Attach doc-sync listener to the current editor instance
	try {
		editor.dispatch({
			effects: StateEffect.appendConfig.of(getDocSyncListener()),
		});
	} catch (_) {}

	return manager;

	/**
	 * Adds a file to the manager's file list and updates the UI.
	 * @param {File} file - The file to be added.
	 */
	function addFile(file) {
		if (manager.files.includes(file)) return;
		manager.files.push(file);
		manager.openFileList.append(file.tab);
		$header.text = file.name;
		toggleProblemButton();
	}

	/**
	 * Sets up the editor with various configurations and event listeners.
	 * @returns {Promise<void>} A promise that resolves once the editor is set up.
	 */
	async function setupEditor() {
		const settings = appSettings.value;
		const { leftMargin, textWrap, colorPreview, fontSize, lineHeight } =
			appSettings.value;
		const scrollMarginTop = 0;
		const scrollMarginLeft = 0;
		const scrollMarginRight = textWrap ? 0 : leftMargin;
		const scrollMarginBottom = 0;

		let checkTimeout = null;
		let autosaveTimeout;
		let scrollTimeout;
		const scroller = editor.scrollDOM;

		function handleEditorScroll() {
			if (!scroller) return;
			onscrolltop();
			onscrollleft();
			touchSelectionController?.onScroll();
			clearTimeout(scrollTimeout);
			isScrolling = true;
			scrollTimeout = setTimeout(() => {
				isScrolling = false;
			}, 100);
		}

		scroller?.addEventListener("scroll", handleEditorScroll, { passive: true });
		handleEditorScroll();

		keyboardHandler.on("keyboardShowStart", () => {
			requestAnimationFrame(() => {
				scrollCursorIntoView({ behavior: "instant" });
			});
		});
		keyboardHandler.on("keyboardShow", scrollCursorIntoView);

		// Attach native DOM event listeners directly to the editor's contentDOM
		const contentDOM = editor.contentDOM;
		const isFocused =
			contentDOM === document.activeElement ||
			contentDOM.contains(document.activeElement);
		setNativeContextMenuDisabled(isFocused);

		contentDOM.addEventListener("focus", (_event) => {
			setNativeContextMenuDisabled(true);
			const { activeFile } = manager;
			if (activeFile) {
				activeFile.focused = true;
			}
			touchSelectionController?.onStateChanged();
		});

		contentDOM.addEventListener("blur", async (_event) => {
			setNativeContextMenuDisabled(false);
			touchSelectionController?.setMenu(false);
			const { hardKeyboardHidden, keyboardHeight } =
				await getSystemConfiguration();
			const blur = () => {
				const { activeFile } = manager;
				if (activeFile) {
					activeFile.focused = false;
					activeFile.focusedBefore = false;
				}
			};
			if (
				hardKeyboardHidden === HARDKEYBOARDHIDDEN_NO &&
				keyboardHeight < 100
			) {
				// external keyboard - blur immediately
				blur();
				return;
			}
			// soft keyboard - wait for keyboard to hide
			const onKeyboardHide = () => {
				keyboardHandler.off("keyboardHide", onKeyboardHide);
				blur();
			};
			keyboardHandler.on("keyboardHide", onKeyboardHide);
		});

		contentDOM.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				keydownState.esc = { value: true, target: contentDOM };
			}
		});

		updateMargin(true);
		updateSideButtonContainer();
		toggleProblemButton();
	}

	/**
	 * Scrolls the cursor into view if it is not currently visible.
	 */
	function scrollCursorIntoView(options = {}) {
		const view = editor;
		const scroller = view?.scrollDOM;
		if (!view || !scroller) return;

		const { behavior = "smooth" } = options;
		const { head } = view.state.selection.main;
		const caret = safeCoordsAtPos(view, head);
		if (!caret) return;

		const scrollerRect = scroller.getBoundingClientRect();
		const relativeTop = caret.top - scrollerRect.top + scroller.scrollTop;
		const relativeBottom = caret.bottom - scrollerRect.top + scroller.scrollTop;
		const topMargin = 16;
		const bottomMargin = (appSettings.value?.teardropSize || 24) + 12;

		const scrollTop = scroller.scrollTop;
		const visibleTop = scrollTop + topMargin;
		const visibleBottom = scrollTop + scroller.clientHeight - bottomMargin;

		if (relativeTop < visibleTop) {
			const nextTop = Math.max(relativeTop - topMargin, 0);
			scroller.scrollTo({ top: nextTop, behavior });
		} else if (relativeBottom > visibleBottom) {
			const delta = relativeBottom - visibleBottom;
			scroller.scrollTo({ top: scrollTop + delta, behavior });
		}
	}

	/**
	 * Checks if the cursor is visible within the CodeMirror viewport.
	 * @returns {boolean} - True if the cursor is visible, false otherwise.
	 */
	function isCursorVisible() {
		const view = editor;
		const scroller = view?.scrollDOM;
		if (!view || !scroller) return true;

		const { head } = view.state.selection.main;
		const caret = safeCoordsAtPos(view, head);
		if (!caret) return true;

		const scrollerRect = scroller.getBoundingClientRect();
		return caret.top >= scrollerRect.top && caret.bottom <= scrollerRect.bottom;
	}

	function safeCoordsAtPos(view, pos) {
		try {
			return view.coordsAtPos(pos);
		} catch (_) {
			return null;
		}
	}

	/**
	 * Sets the vertical scroll value of the editor. This is called when the editor is scrolled horizontally using the scrollbar.
	 * @param {Number} value
	 */
	function onscrollV(value) {
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		const normalized = clamp01(value);
		const maxScroll = Math.max(
			scroller.scrollHeight - scroller.clientHeight,
			0,
		);
		preventScrollbarV = true;
		scroller.scrollTop = normalized * maxScroll;
		lastScrollTop = scroller.scrollTop;
	}

	/**
	 * Handles the onscroll event for the vend element.
	 */
	function onscrollVend() {
		preventScrollbarV = false;
		setVScrollValue();
	}

	/**
	 * Sets the horizontal scroll value of the editor. This is called when the editor is scrolled vertically using the scrollbar.
	 * @param {number} value - The scroll value.
	 */
	function onscrollH(value) {
		if (appSettings.value.textWrap) return;
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		const normalized = clamp01(value);
		const maxScroll = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
		preventScrollbarH = true;
		scroller.scrollLeft = normalized * maxScroll;
		lastScrollLeft = scroller.scrollLeft;
	}

	/**
	 * Handles the event when the horizontal scrollbar reaches the end.
	 */
	function onscrollHEnd() {
		preventScrollbarH = false;
		setHScrollValue();
	}

	/**
	 * Sets scrollbars value based on the editor's scroll position.
	 */
	function setHScrollValue() {
		if (appSettings.value.textWrap || preventScrollbarH) return;
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		const maxScroll = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
		if (maxScroll <= 0) {
			lastScrollLeft = 0;
			$hScrollbar.value = 0;
			return;
		}
		const scrollLeft = scroller.scrollLeft;
		if (scrollLeft === lastScrollLeft) return;
		lastScrollLeft = scrollLeft;
		const factor = scrollLeft / maxScroll;
		$hScrollbar.value = clamp01(factor);
	}

	/**
	 * Handles the scroll left event.
	 * Updates the horizontal scroll value and renders the horizontal scrollbar.
	 */
	function onscrollleft() {
		if (appSettings.value.textWrap) {
			$hScrollbar.hide();
			return;
		}
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		const maxScroll = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
		if (maxScroll <= 0) {
			$hScrollbar.hide();
			lastScrollLeft = 0;
			$hScrollbar.value = 0;
			return;
		}
		setHScrollValue();
		$hScrollbar.render();
	}

	/**
	 * Sets scrollbars value based on the editor's scroll position.
	 */
	function setVScrollValue() {
		if (preventScrollbarV) return;
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		const maxScroll = Math.max(
			scroller.scrollHeight - scroller.clientHeight,
			0,
		);
		if (maxScroll <= 0) {
			lastScrollTop = 0;
			$vScrollbar.value = 0;
			return;
		}
		const scrollTop = scroller.scrollTop;
		if (scrollTop === lastScrollTop) return;
		lastScrollTop = scrollTop;
		const factor = scrollTop / maxScroll;
		$vScrollbar.value = clamp01(factor);
	}

	/**
	 * Handles the scroll top event.
	 * Updates the vertical scroll value and renders the vertical scrollbar.
	 */
	function onscrolltop() {
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		const maxScroll = Math.max(
			scroller.scrollHeight - scroller.clientHeight,
			0,
		);
		if (maxScroll <= 0) {
			$vScrollbar.hide();
			lastScrollTop = 0;
			$vScrollbar.value = 0;
			return;
		}
		setVScrollValue();
		$vScrollbar.render();
	}

	function clamp01(value) {
		if (value <= 0) return 0;
		if (value >= 1) return 1;
		return value;
	}

	/**
	 * Updates the floating button visibility based on the provided show parameter.
	 * @param {boolean} [show=false] - Indicates whether to show the floating button.
	 */
	function updateFloatingButton(show = false) {
		const { $headerToggler } = acode;
		const { $toggler } = quickTools;

		if (show) {
			if (scrollBarVisibilityCount) --scrollBarVisibilityCount;

			if (!scrollBarVisibilityCount) {
				clearTimeout(timeoutHeaderToggler);
				clearTimeout(timeoutQuicktoolsToggler);

				if (appSettings.value.floatingButton) {
					$toggler.classList.remove("hide");
					root.appendOuter($toggler);
				}

				$headerToggler.classList.remove("hide");
				root.appendOuter($headerToggler);
			}

			return;
		}

		if (!scrollBarVisibilityCount) {
			if ($toggler.isConnected) {
				$toggler.classList.add("hide");
				timeoutQuicktoolsToggler = setTimeout(() => $toggler.remove(), 300);
			}
			if ($headerToggler.isConnected) {
				$headerToggler.classList.add("hide");
				timeoutHeaderToggler = setTimeout(() => $headerToggler.remove(), 300);
			}
		}

		++scrollBarVisibilityCount;
	}

	/**
	 * Toggles the visibility of the problem button based on the presence of annotations in the files.
	 */
	function fileHasProblems(file) {
		const state = getDiagnosticStateForFile(file);
		if (!state) return false;

		const session = file.session;
		if (session && typeof session.getAnnotations === "function") {
			try {
				const annotations = session.getAnnotations() || [];
				if (annotations.length) return true;
			} catch (_) {}
		}

		if (typeof state.field !== "function") return false;
		try {
			const diagnostics = getLspDiagnostics(state);
			return diagnostics.length > 0;
		} catch (_) {}

		return false;
	}

	function toggleProblemButton() {
		const { showSideButtons } = appSettings.value;
		if (!showSideButtons) {
			problemButton.hide();
			return;
		}

		const hasProblems = manager.files.some((file) => fileHasProblems(file));
		if (hasProblems) {
			problemButton.show();
		} else {
			problemButton.hide();
		}
	}

	function getDiagnosticStateForFile(file) {
		if (!file || file.type !== "editor") return null;
		if (manager.activeFile?.id === file.id && editor?.state) {
			return editor.state;
		}
		return file.session || null;
	}

	/**
	 * Updates the side button container based on the value of `showSideButtons` in `appSettings`.
	 * If `showSideButtons` is `false`, the side button container is removed from the DOM.
	 * If `showSideButtons` is `true`, the side button container is appended to the body element.
	 */
	function updateSideButtonContainer() {
		const { showSideButtons } = appSettings.value;
		if (!showSideButtons) {
			sideButtonContainer.remove();
			return;
		}

		$body.append(sideButtonContainer);
	}

	/**
	 * Updates the margin of the editor and optionally updates the gutter settings.
	 * @param {boolean} [updateGutter=false] - Whether to update the gutter settings.
	 */
	function updateMargin(updateGutter = false) {
		const { showSideButtons, linenumbers, showAnnotations } = appSettings.value;
		const top = 0;
		const bottom = 0;
		const right = showSideButtons ? 15 : 0;
		const left = linenumbers ? (showAnnotations ? 0 : -16) : 0;
		// TODO
		//editor.renderer.setMargin(top, bottom, left, right);

		if (!updateGutter) return;

		// editor.setOptions({
		// 	showGutter: linenumbers || showAnnotations,
		// 	showLineNumbers: linenumbers,
		// });
	}

	/**
	 * Switches the active file in the editor.
	 * @param {string} id - The ID of the file to switch to.
	 */
	function switchFile(id) {
		const { id: activeFileId } = manager.activeFile || {};
		if (activeFileId === id) return;

		const file = manager.getFile(id);
		if (!file) return;

		manager.activeFile?.tab.classList.remove("active");

		// Hide previous content if it was non-editor
		if (manager.activeFile?.type !== "editor" && manager.activeFile?.content) {
			manager.activeFile.content.style.display = "none";
		}

		// Persist the previous editor's state before switching away
		const prev = manager.activeFile;
		if (prev?.type === "editor") {
			try {
				prev.session = editor.state;
			} catch (_) {}
			try {
				prev.lastScrollTop = editor.scrollDOM?.scrollTop || 0;
				prev.lastScrollLeft = editor.scrollDOM?.scrollLeft || 0;
			} catch (_) {}
		}

		manager.activeFile = file;

		if (file.type === "editor") {
			touchSelectionController?.setEnabled(true);
			// Apply active file content and language to CodeMirror
			applyFileToEditor(file);
			$container.style.display = "block";

			$hScrollbar.hideImmediately();
			$vScrollbar.hideImmediately();

			setVScrollValue();
			if (!appSettings.value.textWrap) {
				setHScrollValue();
			}
		} else {
			touchSelectionController?.setEnabled(false);
			$container.style.display = "none";
			if (file.content) {
				file.content.style.display = "block";
				if (!file.content.parentElement) {
					$container.parentElement.appendChild(file.content);
				}
			}
		}

		file.tab.classList.add("active");
		file.tab.scrollIntoView();

		$header.text = file.filename;
		$header.subText = file.headerSubtitle || "";
		manager.onupdate("switch-file");
		events.emit("switch-file", file);

		toggleProblemButton();
	}

	/**
	 * Initializes the file tab container.
	 */
	function initFileTabContainer() {
		let $list;

		if ($openFileList) {
			if ($openFileList.classList.contains("collapsible")) {
				$list = Array.from($openFileList.$ul.children);
			} else {
				$list = Array.from($openFileList.children);
			}
			$openFileList.remove();
		}

		// show open file list in header
		const { openFileListPos } = appSettings.value;
		if (
			openFileListPos === appSettings.OPEN_FILE_LIST_POS_HEADER ||
			openFileListPos === appSettings.OPEN_FILE_LIST_POS_BOTTOM
		) {
			if (!$openFileList?.classList.contains("open-file-list")) {
				$openFileList = <ul className="open-file-list"></ul>;
			}
			if ($list) $openFileList.append(...$list);

			if (openFileListPos === appSettings.OPEN_FILE_LIST_POS_BOTTOM) {
				$container.parentElement.insertAdjacentElement(
					"afterend",
					$openFileList,
				);
			} else {
				$header.insertAdjacentElement("afterend", $openFileList);
			}

			root.classList.add("top-bar");

			const oldAppend = $openFileList.append;
			$openFileList.append = (...args) => {
				oldAppend.apply($openFileList, args);
			};
		} else {
			$openFileList = list(strings["active files"]);
			$openFileList.classList.add("file-list");
			if ($list) $openFileList.$ul.append(...$list);
			$openFileList.expand();

			const oldAppend = $openFileList.$ul.append;
			$openFileList.append = (...args) => {
				oldAppend.apply($openFileList.$ul, args);
			};

			const files = sidebarApps.get("files");
			files.insertBefore($openFileList, files.firstElementChild);
			root.classList.remove("top-bar");
		}

		root.setAttribute("open-file-list-pos", openFileListPos);
		manager.emit("int-open-file-list", openFileListPos);
	}

	/**
	 * Checks if there are any unsaved files in the manager.
	 * @returns {number} The number of unsaved files.
	 */
	function hasUnsavedFiles() {
		const unsavedFiles = manager.files.filter((file) => file.isUnsaved);
		return unsavedFiles.length;
	}

	/**
	 * Gets a file from the file manager
	 * @param {string|number} checkFor
	 * @param {"id"|"name"|"uri"} [type]
	 * @returns {File}
	 */
	function getFile(checkFor, type = "id") {
		return manager.files.find((file) => {
			switch (type) {
				case "id":
					if (file.id === checkFor) return true;
					return false;
				case "name":
					if (file.filename === checkFor) return true;
					return false;
				case "uri":
					if (file.uri === checkFor) return true;
					return false;
				default:
					return false;
			}
		});
	}

	/**
	 * Gets the height of the editor
	 * @param {object} editor
	 * @returns
	 */
	function getEditorHeight(editor) {
		try {
			const view = editor;
			if (!view || !view.scrollDOM) return 0;

			const total = view.scrollDOM.scrollHeight || 0;
			const viewport = view.scrollDOM.clientHeight || 0;
			return Math.max(total - viewport, 0);
		} catch (_) {
			return 0;
		}
	}

	/**
	 * Gets the height of the editor
	 * @param {object} editor
	 * @returns
	 */
	function getEditorWidth(editor) {
		try {
			const view = editor;
			if (!view || !view.scrollDOM) return 0;

			const total = view.scrollDOM.scrollWidth || 0;
			const viewport = view.scrollDOM.clientWidth || 0;
			let width = Math.max(total - viewport, 0);
			if (!appSettings.value.textWrap) {
				const { leftMargin = 0 } = appSettings.value;
				width += leftMargin || 0;
			}
			return width;
		} catch (_) {
			return 0;
		}
	}
}

export default EditorManager;
