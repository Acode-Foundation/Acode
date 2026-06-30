import sidebarApps from "sidebarApps";
import { indentUnit, language as languageFacet } from "@codemirror/language";
import { search } from "@codemirror/search";
import { Compartment, EditorState, Prec, StateEffect } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
	closeHoverTooltips,
	EditorView,
	hasHoverTooltips,
	highlightActiveLineGutter,
	highlightTrailingWhitespace,
	highlightWhitespace,
	keymap,
	lineNumbers,
	placeholder,
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
import { handleLineNumberClick } from "cm/lineNumberSelection";
import localWordCompletions, {
	localWordCompletionSource,
} from "cm/localWordCompletions";
import lspApi from "cm/lsp/api";
import lspClientManager, { lspCompletionEnabled } from "cm/lsp/clientManager";
import {
	getLspDiagnostics,
	LSP_DIAGNOSTICS_EVENT,
	lspDiagnosticsClientExtension,
	lspDiagnosticsUiExtension,
} from "cm/lsp/diagnostics";
import { stopManagedServer } from "cm/lsp/serverLauncher";
import createMainEditorExtensions from "cm/mainEditorExtensions";
// CodeMirror mode management
import {
	getMode,
	getModeForPath,
	getModes,
	getModesByName,
	initModes,
} from "cm/modelist";
import createTouchSelectionMenu from "cm/touchSelectionMenu";
import "cm/supportedModes";
import { autocompletion } from "@codemirror/autocomplete";
import { serverCompletionSource } from "@codemirror/lsp-client";
import colorView from "cm/colorView";
import {
	getAllFolds,
	restoreFolds,
	restoreSelection,
	setScrollPosition,
} from "cm/editorUtils";
import indentGuides from "cm/indentGuides";
import { lineBreakMarker } from "cm/lineBreakMarker";
import rainbowBrackets, { getRainbowBracketColors } from "cm/rainbowBrackets";
import scrollPastEndCustom from "cm/scrollPastEnd";
import tagAutoRename from "cm/tagAutoRename";
import { getThemeConfig, getThemeExtensions } from "cm/themes";
import list from "components/collapsableList";
import quickTools from "components/quickTools";
import ScrollBar from "components/scrollbar";
import SideButton, { sideButtonContainer } from "components/sideButton";
import keyboardHandler, { keydownState } from "handlers/keyboard";
import { animate } from "motion";
import config from "./config";
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
	let suppressCursorRevealUntil = 0;
	let scrollbarScrollLockUntil = 0;
	let scrollbarScrollLockTop = null;
	let scrollbarScrollLockLeft = null;
	let scrollRestoreFrame = 0;
	let scrollRestoreNestedFrame = 0;
	let scrollRestoreTimeout = 0;
	const MIN_PANE_WIDTH = 360;
	const MIN_PANE_HEIGHT = 220;
	const MIN_RESIZED_PANE_WIDTH = 280;
	const MIN_RESIZED_PANE_HEIGHT = 180;
	const PANE_SPLIT_HORIZONTAL = "horizontal";
	const PANE_SPLIT_VERTICAL = "vertical";

	const docSyncTimers = new WeakMap();
	let touchSelectionController = null;
	let touchSelectionSyncRaf = 0;
	let nativeContextMenuDisabled = null;
	const recoverableWarningKeys = new Set();

	function warnRecoverable(message, error, key) {
		if (key) {
			if (recoverableWarningKeys.has(key)) return;
			recoverableWarningKeys.add(key);
		}
		console.warn(message, error);
	}

	function getDocSyncTimers(file) {
		let timers = docSyncTimers.get(file);
		if (!timers) {
			timers = {
				checkTimeout: null,
				autosaveTimeout: null,
			};
			docSyncTimers.set(file, timers);
		}
		return timers;
	}

	function clearDocSyncTimers(file) {
		const timers = docSyncTimers.get(file);
		if (!timers) return;
		if (timers.checkTimeout) clearTimeout(timers.checkTimeout);
		if (timers.autosaveTimeout) clearTimeout(timers.autosaveTimeout);
		docSyncTimers.delete(file);
	}

	function isCoarsePointerDevice() {
		if (typeof window !== "undefined") {
			try {
				if (window.matchMedia?.("(pointer: coarse)").matches) {
					return true;
				}
			} catch (_) {
				// Ignore matchMedia capability errors and fall through.
			}
		}
		return (
			typeof navigator !== "undefined" &&
			Number(navigator.maxTouchPoints || 0) > 0
		);
	}

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

	const { scrollbarSize, scrollbarHeight } = appSettings.value;
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
	let manager;
	let paneIdCounter = 0;
	let activePane = null;
	let editor = null;
	const panes = [];
	const $paneRoot = <div className="editor-pane-root"></div>;
	const $globalOpenFileList = (
		<ul className="open-file-list editor-global-open-file-list"></ul>
	);
	const globalOpenFileListNative = {
		append: $globalOpenFileList.append.bind($globalOpenFileList),
		appendChild: $globalOpenFileList.appendChild.bind($globalOpenFileList),
		insertBefore: $globalOpenFileList.insertBefore.bind($globalOpenFileList),
		prepend: $globalOpenFileList.prepend.bind($globalOpenFileList),
		replaceChildren:
			$globalOpenFileList.replaceChildren.bind($globalOpenFileList),
	};
	const $paneAwareOpenFileList =
		createPaneAwareOpenFileListProxy($globalOpenFileList);
	let $container = createEditorContainer();
	let paneLayoutRoot = null;
	const primaryPane = createPaneShell($container);
	paneLayoutRoot = createPaneNode(primaryPane);
	$paneRoot.append(paneLayoutRoot.element);
	const problemButton = SideButton({
		text: strings.problems,
		icon: "warningreport_problem",
		backgroundColor: "var(--danger-color)",
		textColor: "var(--danger-text-color)",
		onclick() {
			acode.exec("open", "problems");
		},
	});

	function createEditorContainer() {
		const $el = <div className="editor-container"></div>;
		// Ensure the container participates well in flex layouts and can constrain the editor.
		$el.style.flex = "1 1 auto";
		$el.style.minHeight = "0";
		$el.style.height = "100%";
		$el.style.width = "100%";
		return $el;
	}

	function createPaneAwareOpenFileListProxy(target) {
		return new Proxy(target, {
			get(target, prop) {
				if (prop === "children" || prop === "childNodes") {
					return toDomCollection(getOpenFileListChildren());
				}
				if (prop === "childElementCount")
					return getOpenFileListChildren().length;
				if (prop === "firstChild" || prop === "firstElementChild") {
					return getOpenFileListChildren()[0] || null;
				}
				if (prop === "lastChild" || prop === "lastElementChild") {
					const children = getOpenFileListChildren();
					return children[children.length - 1] || null;
				}
				if (prop === "append" || prop === "appendChild" || prop === "prepend") {
					return (...args) => mutateVisibleOpenFileList(prop, args);
				}
				if (prop === "insertBefore") {
					return (node, child) =>
						mutateVisibleOpenFileList("insertBefore", [node, child]);
				}
				if (prop === "contains") {
					return (node) =>
						getOpenFileListChildren().some(
							(child) => child === node || child.contains(node),
						) || target.contains(node);
				}
				if (prop === "querySelector") {
					return (selector) => queryOpenFileList(selector)[0] || null;
				}
				if (prop === "querySelectorAll") {
					return (selector) => toDomCollection(queryOpenFileList(selector));
				}
				if (prop === "getElementsByClassName") {
					return (className) =>
						toDomCollection(
							collectFromOpenFileListChildren((child) => [
								...(child.classList.contains(className) ? [child] : []),
								...child.getElementsByClassName(className),
							]),
						);
				}
				if (prop === "getElementsByTagName") {
					return (tagName) => {
						const selector = tagName === "*" ? "*" : tagName;
						return toDomCollection(queryOpenFileList(selector));
					};
				}
				if (prop === "getClientRects" || prop === "getBoundingClientRect") {
					return (...args) => {
						const targetList = getOpenFileListMutationTarget();
						return targetList[prop](...args);
					};
				}
				if (typeof prop === "string" && /^\d+$/.test(prop)) {
					return getOpenFileListChildren()[Number(prop)];
				}

				const value = Reflect.get(target, prop, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}

	function createPaneShell(editorContainer = createEditorContainer()) {
		const pane = {
			id: `pane-${++paneIdCounter}`,
			files: [],
			activeFile: null,
			editor: null,
			editorContainer,
			touchSelectionController: null,
			element: <section className="editor-pane"></section>,
			tabList: <ul className="open-file-list editor-pane-tabs"></ul>,
			content: <div className="editor-pane-content"></div>,
			layoutNode: null,
		};

		pane.element.dataset.paneId = pane.id;
		pane.tabList.dataset.paneId = pane.id;
		pane.element.__editorPane = pane;
		pane.tabList.__editorPane = pane;
		pane.content.__editorPane = pane;
		pane.editorContainer.__editorPane = pane;
		pane.content.append(pane.editorContainer);
		pane.element.append(pane.tabList, pane.content);
		pane.element.addEventListener(
			"pointerdown",
			() => {
				activatePane(pane);
			},
			true,
		);
		panes.push(pane);
		return pane;
	}

	function createPaneNode(pane) {
		const node = {
			type: "pane",
			pane,
			parent: null,
			element: pane.element,
		};
		pane.layoutNode = node;
		return node;
	}

	function createSplitNode(direction) {
		const node = {
			type: "split",
			direction: normalizePaneDirection(direction),
			children: [],
			parent: null,
			element: <div className="editor-pane-split"></div>,
		};
		node.element.dataset.direction = node.direction;
		return node;
	}

	function normalizePaneDirection(direction) {
		return direction === PANE_SPLIT_VERTICAL ||
			direction === "down" ||
			direction === "below"
			? PANE_SPLIT_VERTICAL
			: PANE_SPLIT_HORIZONTAL;
	}

	function renderPaneLayout(node = paneLayoutRoot) {
		if (!node || node.type !== "split") return;

		node.element.dataset.direction = node.direction;
		node.element.replaceChildren();
		node.children.forEach((child, index) => {
			if (index > 0) {
				node.element.append(createPaneSplitHandle(node, index));
			}
			node.element.append(child.element);
			renderPaneLayout(child);
		});
	}

	function createPaneSplitHandle(splitNode, childIndex) {
		const $handle = <div className="editor-pane-split-handle"></div>;
		$handle.dataset.direction = splitNode.direction;
		$handle.addEventListener("pointerdown", (event) => {
			startPaneResize(event, splitNode, childIndex, $handle);
		});
		return $handle;
	}

	function replacePaneLayoutNode(oldNode, nextNode) {
		const parent = oldNode?.parent || null;
		if (parent) {
			const index = parent.children.indexOf(oldNode);
			if (index >= 0) {
				parent.children[index] = nextNode;
				nextNode.parent = parent;
				oldNode.parent = null;
				renderPaneLayout(parent);
			}
			return;
		}

		paneLayoutRoot = nextNode;
		nextNode.parent = null;
		$paneRoot.replaceChildren(nextNode.element);
		renderPaneLayout(nextNode);
	}

	function insertPaneIntoLayout(sourcePane, pane, direction) {
		const sourceNode = sourcePane?.layoutNode || paneLayoutRoot;
		const paneNode = createPaneNode(pane);
		const splitDirection = normalizePaneDirection(direction);

		if (!sourceNode) {
			paneLayoutRoot = paneNode;
			$paneRoot.replaceChildren(paneNode.element);
			return paneNode;
		}

		if (
			sourceNode.parent &&
			sourceNode.parent.type === "split" &&
			sourceNode.parent.direction === splitDirection
		) {
			const parent = sourceNode.parent;
			const index = parent.children.indexOf(sourceNode);
			parent.children.splice(index + 1, 0, paneNode);
			paneNode.parent = parent;
			renderPaneLayout(parent);
			return paneNode;
		}

		const splitNode = createSplitNode(splitDirection);
		const oldParent = sourceNode.parent;
		const previousFlex = sourceNode.element.style.flex;
		splitNode.children = [sourceNode, paneNode];
		splitNode.element.style.flex = previousFlex;
		sourceNode.element.style.flex = "";
		paneNode.element.style.flex = "";
		sourceNode.parent = splitNode;
		paneNode.parent = splitNode;

		if (oldParent) {
			const index = oldParent.children.indexOf(sourceNode);
			if (index >= 0) {
				oldParent.children[index] = splitNode;
				splitNode.parent = oldParent;
				renderPaneLayout(oldParent);
			}
		} else {
			paneLayoutRoot = splitNode;
			splitNode.parent = null;
			$paneRoot.replaceChildren(splitNode.element);
			renderPaneLayout(splitNode);
		}
		return paneNode;
	}

	function removePaneFromLayout(pane) {
		const node = pane?.layoutNode;
		if (!node) {
			pane?.element?.remove();
			return;
		}

		const parent = node.parent;
		if (!parent) {
			paneLayoutRoot = null;
			node.element.remove();
			pane.layoutNode = null;
			return;
		}

		const index = parent.children.indexOf(node);
		if (index >= 0) {
			parent.children.splice(index, 1);
		}
		node.parent = null;
		pane.layoutNode = null;

		if (parent.children.length === 1) {
			const onlyChild = parent.children[0];
			onlyChild.element.style.flex = parent.parent
				? parent.element.style.flex || "1 1 0"
				: "1 1 0";
			replacePaneLayoutNode(parent, onlyChild);
			parent.children = [];
			parent.element.remove();
			return;
		}

		renderPaneLayout(parent);
	}

	function getOrderedPanes(node = paneLayoutRoot) {
		if (!node) return panes.slice();
		if (node.type === "pane") return node.pane ? [node.pane] : [];
		return node.children.flatMap((child) => getOrderedPanes(child));
	}

	function getVisiblePaneRect(pane) {
		const element = pane?.element;
		if (!element?.isConnected || element.getClientRects().length === 0) {
			return null;
		}

		const rect = element.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return null;
		return rect;
	}

	function updatePaneLayoutState() {
		$paneRoot.classList.toggle("multi-pane", panes.length > 1);
		renderPaneLayout();
		updateActivePaneLayoutPath(activePane);
	}

	function animatePaneEntry(pane) {
		if (!pane?.element || document.body.classList.contains("no-animation")) {
			return;
		}

		pane.element.style.opacity = "0";
		pane.element.style.transform = "scale(0.985)";
		const element = pane.element;
		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			element.style.opacity = "";
			element.style.transform = "";
		};
		animate(
			element,
			{ opacity: 1, transform: "scale(1)" },
			{ type: "spring", stiffness: 360, damping: 32 },
		)
			.then(cleanup)
			.catch(cleanup);
	}

	function startPaneResize(event, splitNode, childIndex, handle) {
		const previousNode = splitNode.children[childIndex - 1];
		const nextNode = splitNode.children[childIndex];
		if (!previousNode || !nextNode) return;

		event.preventDefault();
		event.stopPropagation();

		const isVertical = splitNode.direction === PANE_SPLIT_VERTICAL;
		const axis = isVertical ? "y" : "x";
		const start = isVertical ? event.clientY : event.clientX;
		const previousRect = previousNode.element.getBoundingClientRect();
		const nextRect = nextNode.element.getBoundingClientRect();
		const previousSize = isVertical ? previousRect.height : previousRect.width;
		const nextSize = isVertical ? nextRect.height : nextRect.width;
		const totalSize = previousSize + nextSize;
		const minSize = Math.min(
			isVertical ? MIN_RESIZED_PANE_HEIGHT : MIN_RESIZED_PANE_WIDTH,
			totalSize / 2,
		);
		let pendingDelta = 0;
		let resizeFrame = 0;

		document.body.classList.add("resizing-editor-pane");
		document.body.dataset.editorPaneResizeAxis = axis;
		handle.setPointerCapture?.(event.pointerId);

		const resize = (moveEvent) => {
			pendingDelta =
				(isVertical ? moveEvent.clientY : moveEvent.clientX) - start;
			if (resizeFrame) return;
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = 0;
				const nextPreviousSize = Math.max(
					minSize,
					Math.min(totalSize - minSize, previousSize + pendingDelta),
				);
				const nextCurrentSize = totalSize - nextPreviousSize;
				previousNode.element.style.flex = `1 1 ${nextPreviousSize}px`;
				nextNode.element.style.flex = `1 1 ${nextCurrentSize}px`;
			});
		};

		const refreshEditors = () => {
			getOrderedPanes().forEach((pane) => {
				pane.editor?.requestMeasure?.();
			});
			updateActivePaneScrollbars();
		};

		const stop = () => {
			if (resizeFrame) {
				cancelAnimationFrame(resizeFrame);
				resizeFrame = 0;
			}
			document.removeEventListener("pointermove", resize);
			document.removeEventListener("pointerup", stop);
			document.removeEventListener("pointercancel", stop);
			document.body.classList.remove("resizing-editor-pane");
			delete document.body.dataset.editorPaneResizeAxis;
			handle.releasePointerCapture?.(event.pointerId);
			requestAnimationFrame(refreshEditors);
		};

		document.addEventListener("pointermove", resize, { passive: true });
		document.addEventListener("pointerup", stop);
		document.addEventListener("pointercancel", stop);
	}

	function getActivePane() {
		return activePane || panes[0] || null;
	}

	function setActivePane(pane, options = {}) {
		if (!pane || activePane === pane) return pane;

		activePane?.element.classList.remove("active");
		activePane = pane;
		editor = pane.editor || editor;
		$container = pane.editorContainer || $container;
		touchSelectionController = pane.touchSelectionController || null;
		pane.element.classList.add("active");
		updateActivePaneLayoutPath(pane);

		if (manager) {
			manager.activeFile = pane.activeFile || null;
			updateHeaderForFile(manager.activeFile);
			if (isPaneTabLayout()) syncGlobalOpenFileListMirror();
			updateActivePaneScrollbars();
			toggleProblemButton();
			if (options.emitSwitch !== false && manager.activeFile) {
				manager.onupdate("switch-file");
				events.emit("switch-file", manager.activeFile);
			}
			if (options.configureLsp !== false) {
				if (manager.activeFile?.type === "editor") {
					void configureLspForFile(manager.activeFile);
				} else {
					detachActiveLsp();
				}
			}
		}

		return pane;
	}

	function activatePane(pane, options = {}) {
		if (!pane) return null;
		if (activePane === pane) {
			if (options.focusEditor !== false) pane.editor?.focus?.();
			return pane;
		}

		const fileToActivate = pane.activeFile || null;
		if (fileToActivate) {
			fileToActivate.makeActive();
			return pane;
		}

		setActivePane(pane, { emitSwitch: false });
		if (options.focusEditor !== false) pane.editor?.focus?.();
		return pane;
	}

	function updateActivePaneLayoutPath(pane) {
		$paneRoot
			.querySelectorAll(".editor-pane-split.active-path")
			.forEach(($split) => $split.classList.remove("active-path"));

		let node = pane?.layoutNode?.parent || null;
		while (node) {
			node.element?.classList.add("active-path");
			node = node.parent;
		}
	}

	function updateHeaderForFile(file) {
		if (!$header) return;
		$header.text = file?.filename || "";
		$header.subText = file?.headerSubtitle || "";
	}

	function updateActivePaneScrollbars() {
		$hScrollbar?.hideImmediately?.();
		$vScrollbar?.hideImmediately?.();
		setVScrollValue();
		if (!appSettings.value.textWrap) {
			setHScrollValue();
		}
	}

	const pointerCursorVisibilityExtension = EditorView.updateListener.of(
		(update) => {
			if (!update.transactions.length) return;
			const pointerTriggered = update.transactions.some(
				(tr) =>
					tr.isUserEvent("pointer") ||
					tr.isUserEvent("select") ||
					tr.isUserEvent("select.pointer") ||
					tr.isUserEvent("touch") ||
					tr.isUserEvent("select.touch"),
			);
			if (!pointerTriggered) {
				clearScrollbarScrollLock();
				return;
			}
			if (!update.selectionSet) return;
			requestAnimationFrame(() => {
				if (isCursorRevealSuppressed()) return;
				if (!isCursorVisible()) scrollCursorIntoView({ behavior: "instant" });
			});
		},
	);
	const isShiftSelectionActive = (event) => {
		if (!appSettings.value.shiftClickSelection) return false;
		return !!event?.shiftKey || quickTools?.$footer?.dataset?.shift != null;
	};
	const shiftClickSelectionExtension = EditorView.domEventHandlers({
		click(event) {
			if (!touchSelectionController?.consumePendingShiftSelectionClick(event)) {
				return false;
			}
			event.preventDefault();
			return true;
		},
	});
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
			if (update.selectionSet || pointerTriggered) {
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
	const baseExtensionDefaults = {
		autoIndent: true,
		codeFolding: true,
		autoCloseBrackets: true,
		bracketMatching: true,
		highlightActiveLine: true,
		highlightSelectionMatches: true,
	};
	const baseExtensionSettings = Object.keys(baseExtensionDefaults);

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
	// Compartment for local document word completions
	const localWordCompletionCompartment = new Compartment();
	// Compartment for rainbow bracket colorizer
	const rainbowCompartment = new Compartment();
	// Compartment for indent guides
	const indentGuidesCompartment = new Compartment();
	// Compartment for line break marker
	const lineBreakMarkerCompartment = new Compartment();
	// Compartment for cursor appearance
	const cursorThemeCompartment = new Compartment();
	// Compartment for HTML-like tag auto rename
	const tagAutoRenameCompartment = new Compartment();
	// Compartment for read-only toggling
	const readOnlyCompartment = new Compartment();
	// Compartment for scrolling past the end of the file
	const scrollPastEndCompartment = new Compartment();
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

	function getLspCompletionSource(context) {
		if (!context.state.facet(lspCompletionEnabled)) return null;
		return serverCompletionSource(context);
	}

	function getEmmetCompletionSource(context) {
		try {
			return emmetCompletionSource(context);
		} catch {
			return null;
		}
	}

	function getAutocompleteConfig() {
		const live = !!appSettings?.value?.liveAutoCompletion;
		const config = {
			activateOnTyping: live,
			activateOnTypingDelay: isCoarsePointerDevice() ? 220 : 100,
		};

		if (appSettings?.value?.languageCompletion === false) {
			// CodeMirror override mode bypasses normal completion discovery,
			// including plugin-provided sources. Re-add the sources that should
			// survive this setting explicitly.
			config.override = [getLspCompletionSource];

			if (appSettings?.value?.localWordCompletion) {
				config.override.push(localWordCompletionSource);
			}

			if (appSettings?.value?.useEmmet !== false) {
				config.override.push(getEmmetCompletionSource);
			}
		}

		return config;
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

	function makeCursorTheme() {
		const width = Number(appSettings?.value?.cursorWidth);
		const cursorWidth =
			Number.isFinite(width) && width > 0 ? Math.min(width, 10) : 2;
		return EditorView.theme({
			".cm-cursor": {
				borderLeftWidth: `${cursorWidth}px`,
			},
		});
	}

	function getConfiguredThemeExtension() {
		const desiredTheme = appSettings?.value?.editorTheme;
		return getThemeExtensions(desiredTheme, [oneDark]);
	}

	function makeWrapExtension() {
		return appSettings?.value?.textWrap ? EditorView.lineWrapping : [];
	}

	function makeLineNumberExtension() {
		const { linenumbers = true, relativeLineNumbers = false } =
			appSettings?.value || {};
		const activeLineGutter =
			appSettings?.value?.highlightActiveLine !== false
				? [highlightActiveLineGutter()]
				: [];
		const lineNumberConfig = {
			domEventHandlers: {
				click(view, line, event) {
					return handleLineNumberClick(view, line, event);
				},
			},
		};
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
			return Prec.highest([lineNumbers(lineNumberConfig), ...activeLineGutter]);
		return Prec.highest([
			lineNumbers({
				...lineNumberConfig,
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
			...activeLineGutter,
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

	function getBaseExtensionOptions() {
		const values = appSettings?.value || {};
		return Object.fromEntries(
			Object.entries(baseExtensionDefaults).map(([key, defaultValue]) => [
				key,
				values[key] ?? defaultValue,
			]),
		);
	}

	function createConfiguredBaseExtensions() {
		return createBaseExtensions(getBaseExtensionOptions());
	}

	function getBaseExtensionSignature() {
		const options = getBaseExtensionOptions();
		return JSON.stringify(
			baseExtensionSettings.map((key) => [key, options[key]]),
		);
	}

	function makeRainbowBracketExtension() {
		const enabled = appSettings?.value?.rainbowBrackets ?? true;
		if (!enabled) return [];

		const themeId = appSettings?.value?.editorTheme || "one_dark";
		return rainbowBrackets({
			colors: getRainbowBracketColors(getThemeConfig(themeId)),
		});
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
				return makeRainbowBracketExtension();
			},
		},
		{
			keys: ["indentGuides"],
			compartments: [indentGuidesCompartment],
			build() {
				const enabled = appSettings?.value?.indentGuides ?? false;
				if (!enabled) return [];
				return indentGuides({
					highlightActiveGuide: false,
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
			keys: ["cursorWidth"],
			compartments: [cursorThemeCompartment],
			build() {
				return makeCursorTheme();
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
			keys: ["showSpaces"],
			compartments: [lineBreakMarkerCompartment],
			build() {
				const showSpaces = !!appSettings?.value?.showSpaces;
				return showSpaces ? lineBreakMarker : [];
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
			keys: ["liveAutoCompletion", "localWordCompletion", "languageCompletion"],
			compartments: [completionCompartment],
			build() {
				return autocompletion(getAutocompleteConfig());
			},
		},
		{
			keys: ["localWordCompletion"],
			compartments: [localWordCompletionCompartment],
			build() {
				const enabled = !!appSettings?.value?.localWordCompletion;
				return enabled ? localWordCompletions() : [];
			},
		},
		{
			keys: ["autoRenameTags"],
			compartments: [tagAutoRenameCompartment],
			build() {
				// Default-on for older settings files that do not have this key yet.
				const enabled = appSettings?.value?.autoRenameTags !== false;
				return enabled ? tagAutoRename() : [];
			},
		},
		{
			keys: ["scrollPastEnd"],
			compartments: [scrollPastEndCompartment],
			build() {
				const value = appSettings?.value?.scrollPastEnd || "medium";
				if (value === "none") {
					return [];
				}
				const factorMap = {
					small: 0.25,
					medium: 0.5,
					full: 1.0,
				};
				const factor = factorMap[value] ?? 1.0;
				return scrollPastEndCustom(factor);
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
		if (appSettings.value.useEmmet === false) return [];
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

	function applyOptions(keys, targetEditor = null) {
		const filter = keys ? new Set(keys) : null;
		const targetEditors = targetEditor
			? [targetEditor]
			: panes.map((pane) => pane.editor).filter(Boolean);

		for (const target of targetEditors) {
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
				target.dispatch({ effects });
			}
		}
	}

	function setThemeForEditors(themeId) {
		panes.forEach((pane) => {
			if (pane.editor) {
				applyThemeToEditor(pane.editor, themeId);
			}
		});
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
		if (appSettings.value.useEmmet === false) return;
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
		if (mode) {
			const modeInfo = getMode(String(mode));
			if (modeInfo?.name) return String(modeInfo.name).toLowerCase();
			return String(mode).toLowerCase();
		}
		try {
			const guess = getModeForPath(file.filename || file.name || "");
			if (guess?.name) return String(guess.name).toLowerCase();
		} catch (error) {
			warnRecoverable(
				`Failed to resolve language id for ${file.filename || file.name || "untitled file"}`,
				error,
				"language-id-resolution",
			);
		}
		return "plaintext";
	}

	function resolveRootUriForContext(context = {}) {
		const uri = context.uri || context.file?.uri;
		if (!uri) return null;
		for (const folder of addedFolder) {
			const base = typeof folder?.url === "string" ? folder.url : "";
			if (!base) continue;
			if (uri.startsWith(base)) return base;
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
		lspClientManager.setOptions({
			allowNonTerminalWorkspace: lsp.allowNonTerminalWorkspace === true,
		});
		const overrides = lsp.servers || {};
		for (const [id, config] of Object.entries(overrides)) {
			if (!config || typeof config !== "object") continue;
			const key = String(id || "")
				.trim()
				.toLowerCase();
			if (!key) continue;
			const existing = lspApi.servers.get(key);
			if (existing) {
				lspApi.servers.update(key, (current) => {
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
					lspApi.upsert({
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
					lspApi.servers.update(key, (current) => {
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
	function createEmptyEditorState() {
		return EditorState.create({
			doc: "",
			extensions: createMainEditorExtensions({
				// Emmet needs highest precedence so place before default keymaps
				emmetExtensions: createEmmetExtensionSet({
					syntax: EmmetKnownSyntax.html,
				}),
				baseExtensions: createConfiguredBaseExtensions(),
				commandKeymapExtension: getCommandKeymapExtension(),
				themeExtension: themeCompartment.of(getConfiguredThemeExtension()),
				pointerCursorVisibilityExtension,
				shiftClickSelectionExtension,
				touchSelectionUpdateExtension,
				searchExtension: search(),
				// Ensure read-only can be toggled later via compartment
				readOnlyExtension: readOnlyCompartment.of(
					EditorState.readOnly.of(false),
				),
				// Editor options driven by settings via compartments
				optionExtensions: getBaseExtensionsFromOptions(),
			}),
		});
	}

	const editorState = createEmptyEditorState();

	editor = new EditorView({
		state: editorState,
		parent: $container,
	});
	editor.__editorPane = primaryPane;
	primaryPane.editor = editor;
	activePane = primaryPane;
	primaryPane.element.classList.add("active");

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
		configurable: true,
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
		configurable: true,
		get() {
			return editor.__editorPane?.activeFile?.session ?? null;
		},
	});

	touchSelectionController = createTouchSelectionMenu(editor, {
		container: $container,
		getActiveFile: () => manager?.activeFile || null,
		isShiftSelectionActive,
	});
	primaryPane.touchSelectionController = touchSelectionController;

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
	function applyThemeToEditor(targetEditor, themeId) {
		try {
			const id = String(themeId || "");
			const ext = getThemeExtensions(id, [oneDark]);
			targetEditor.dispatch({ effects: themeCompartment.reconfigure(ext) });
			return true;
		} catch (_) {
			return false;
		}
	}

	editor.setTheme = function (themeId) {
		return applyThemeToEditor(editor, themeId);
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
	 * Ace-compatible selection range getter with 0-based rows.
	 * @returns {{start: {row: number, column: number}, end: {row: number, column: number}}}
	 */
	editor.getSelectionRange = function () {
		try {
			const { from, to } = editor.state.selection.main;
			const fromLine = editor.state.doc.lineAt(from);
			const toLine = editor.state.doc.lineAt(to);
			return {
				start: {
					row: Math.max(0, fromLine.number - 1),
					column: from - fromLine.from,
				},
				end: {
					row: Math.max(0, toLine.number - 1),
					column: to - toLine.from,
				},
			};
		} catch (_) {
			return { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
		}
	};

	/**
	 * Ace-compatible row scrolling helper.
	 * @param {number} row - 0-based row index, supports Infinity to jump to end.
	 * @returns {boolean}
	 */
	editor.scrollToRow = function (row) {
		try {
			const scroller = editor.scrollDOM;
			if (!scroller) return false;

			if (row === Number.POSITIVE_INFINITY) {
				clearScrollbarScrollLock();
				scroller.scrollTop = Math.max(
					scroller.scrollHeight - scroller.clientHeight,
					0,
				);
				return true;
			}

			const parsedRow = Number(row);
			if (!Number.isFinite(parsedRow)) return false;
			const aceRow = Math.max(0, Math.floor(parsedRow));
			const lineNum = Math.min(editor.state.doc.lines, aceRow + 1);
			const line = editor.state.doc.line(lineNum);
			editor.dispatch({
				effects: EditorView.scrollIntoView(line.from, { y: "start" }),
			});
			return true;
		} catch (_) {
			return false;
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

	function getEditorCompatibilityPane(targetEditor) {
		return targetEditor?.__editorPane || getActivePane();
	}

	function refreshPaneCommandKeymaps() {
		panes.forEach((pane) => {
			if (pane.editor) refreshCommandKeymap(pane.editor);
		});
	}

	function createEditorCommands() {
		const commands = {
			addCommand(descriptor) {
				const command = registerExternalCommand(descriptor);
				refreshPaneCommandKeymaps();
				return command;
			},
			removeCommand(name) {
				if (!name) return;
				removeExternalCommand(name);
				refreshPaneCommandKeymaps();
			},
		};

		Object.defineProperty(commands, "commands", {
			configurable: true,
			get() {
				const map = {};
				getRegisteredCommands().forEach((cmd) => {
					map[cmd.name] = cmd;
				});
				return map;
			},
		});

		return commands;
	}

	function createEditorCompatibilityDescriptors(targetEditor) {
		const getState = () => targetEditor.state;
		const getDoc = () => getState().doc;
		const getSelection = () => getState().selection.main;
		const getTouchSelectionController = () =>
			getEditorCompatibilityPane(targetEditor)?.touchSelectionController ||
			touchSelectionController;

		return {
			execCommand: {
				configurable: true,
				writable: true,
				value(commandName, args) {
					if (!commandName) return false;
					return executeCommand(String(commandName), targetEditor, args);
				},
			},
			commands: {
				configurable: true,
				writable: true,
				value: createEditorCommands(),
			},
			session: {
				configurable: true,
				get() {
					return (
						getEditorCompatibilityPane(targetEditor)?.activeFile?.session ??
						null
					);
				},
			},
			insert: {
				configurable: true,
				writable: true,
				value(text) {
					try {
						const { from, to } = getSelection();
						const insertText = String(text ?? "");
						targetEditor.dispatch({
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
				},
			},
			setTheme: {
				configurable: true,
				writable: true,
				value(themeId) {
					return applyThemeToEditor(targetEditor, themeId);
				},
			},
			gotoLine: {
				configurable: true,
				writable: true,
				value(line, column = 0, animate = false) {
					try {
						const state = getState();
						const { doc } = state;

						let targetLine;
						let targetColumn = column;

						if (typeof line === "string") {
							const match = /^([+-])?(\d+)?(:\d+)?(%)?$/.exec(line.trim());
							if (!match) {
								console.warn("Invalid gotoLine format:", line);
								return false;
							}

							const currentLine = doc.lineAt(state.selection.main.head);
							const [, sign, lineNum, colonColumn, percent] = match;

							if (colonColumn) {
								targetColumn = Math.max(0, +colonColumn.slice(1) - 1);
							}

							const parsedLine = lineNum ? +lineNum : currentLine.number;

							if (lineNum && percent) {
								let percentage = parsedLine / 100;
								if (sign) {
									percentage =
										percentage * (sign === "-" ? -1 : 1) +
										currentLine.number / doc.lines;
								}
								targetLine = Math.round(doc.lines * percentage);
							} else if (lineNum && sign) {
								targetLine =
									parsedLine * (sign === "-" ? -1 : 1) + currentLine.number;
							} else if (lineNum) {
								targetLine = parsedLine;
							} else {
								targetLine = currentLine.number;
							}
						} else {
							targetLine = line;
						}

						const lineNum = Math.max(1, Math.min(targetLine, doc.lines));
						const docLine = doc.line(lineNum);
						const col = Math.max(0, Math.min(targetColumn, docLine.length));
						const pos = docLine.from + col;

						targetEditor.dispatch({
							selection: { anchor: pos, head: pos },
							effects: EditorView.scrollIntoView(pos, { y: "center" }),
						});
						targetEditor.focus();
						return true;
					} catch (error) {
						console.error("Error in gotoLine:", error);
						return false;
					}
				},
			},
			getCursorPosition: {
				configurable: true,
				writable: true,
				value() {
					try {
						const head = getSelection().head;
						const cursor = getDoc().lineAt(head);
						return { row: cursor.number, column: head - cursor.from };
					} catch (_) {
						return { row: 1, column: 0 };
					}
				},
			},
			getSelectionRange: {
				configurable: true,
				writable: true,
				value() {
					try {
						const { from, to } = getSelection();
						const doc = getDoc();
						const fromLine = doc.lineAt(from);
						const toLine = doc.lineAt(to);
						return {
							start: {
								row: Math.max(0, fromLine.number - 1),
								column: from - fromLine.from,
							},
							end: {
								row: Math.max(0, toLine.number - 1),
								column: to - toLine.from,
							},
						};
					} catch (_) {
						return { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
					}
				},
			},
			scrollToRow: {
				configurable: true,
				writable: true,
				value(row) {
					try {
						const scroller = targetEditor.scrollDOM;
						if (!scroller) return false;

						if (row === Number.POSITIVE_INFINITY) {
							clearScrollbarScrollLock();
							scroller.scrollTop = Math.max(
								scroller.scrollHeight - scroller.clientHeight,
								0,
							);
							return true;
						}

						const parsedRow = Number(row);
						if (!Number.isFinite(parsedRow)) return false;
						const aceRow = Math.max(0, Math.floor(parsedRow));
						const lineNum = Math.min(getDoc().lines, aceRow + 1);
						const line = getDoc().line(lineNum);
						targetEditor.dispatch({
							effects: EditorView.scrollIntoView(line.from, { y: "start" }),
						});
						return true;
					} catch (_) {
						return false;
					}
				},
			},
			moveCursorToPosition: {
				configurable: true,
				writable: true,
				value(pos) {
					try {
						const lineNum = Math.max(1, pos.row || 1);
						const col = Math.max(0, pos.column || 0);
						targetEditor.gotoLine(lineNum, col);
					} catch (_) {
						// ignore
					}
				},
			},
			getValue: {
				configurable: true,
				writable: true,
				value() {
					try {
						return getDoc().toString();
					} catch (_) {
						return "";
					}
				},
			},
			selection: {
				configurable: true,
				writable: true,
				value: {
					get anchor() {
						try {
							return getSelection().anchor;
						} catch (_) {
							return 0;
						}
					},
					getRange() {
						try {
							const { from, to } = getSelection();
							const doc = getDoc();
							const fromLine = doc.lineAt(from);
							const toLine = doc.lineAt(to);
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
							return {
								start: { row: 1, column: 0 },
								end: { row: 1, column: 0 },
							};
						}
					},
					getCursor() {
						return targetEditor.getCursorPosition();
					},
				},
			},
			getCopyText: {
				configurable: true,
				writable: true,
				value() {
					try {
						const { from, to } = getSelection();
						if (from === to) return "";
						return getDoc().sliceString(from, to);
					} catch (_) {
						return "";
					}
				},
			},
			setSelection: {
				configurable: true,
				writable: true,
				value(value) {
					getTouchSelectionController()?.setSelection(!!value);
				},
			},
			setMenu: {
				configurable: true,
				writable: true,
				value(value) {
					getTouchSelectionController()?.setMenu(!!value);
				},
			},
		};
	}

	function applyEditorCompatibility(targetEditor) {
		Object.defineProperties(
			targetEditor,
			createEditorCompatibilityDescriptors(targetEditor),
		);
	}

	applyEditorCompatibility(editor);

	function canCreatePane(
		direction = PANE_SPLIT_HORIZONTAL,
		sourcePane = getActivePane(),
	) {
		const normalizedDirection = normalizePaneDirection(direction);
		const rect = sourcePane?.element?.getBoundingClientRect?.() ||
			$paneRoot.getBoundingClientRect?.() || {
				width: $body.clientWidth || 0,
				height: $body.clientHeight || 0,
			};
		if (normalizedDirection === PANE_SPLIT_VERTICAL) {
			if (!rect.height) return true;
			return rect.height / 2 >= MIN_PANE_HEIGHT;
		}
		if (!rect.width) return true;
		return rect.width / 2 >= MIN_PANE_WIDTH;
	}

	function createUntitledPaneFile(pane) {
		const existingPlaceholder = pane?.files?.find(
			(file) => file.isPanePlaceholder && !file.isUnsaved,
		);
		if (existingPlaceholder) {
			if (!pane.activeFile) existingPlaceholder.makeActive();
			return existingPlaceholder;
		}

		return new EditorFile(config.DEFAULT_FILE_NAME, {
			paneId: pane.id,
			text: "",
			isUnsaved: false,
			isPanePlaceholder: true,
		});
	}

	function removePanePlaceholders(pane, exceptFile = null) {
		const placeholders = [...(pane?.files || [])].filter(
			(file) =>
				file !== exceptFile && file.isPanePlaceholder && !file.isUnsaved,
		);
		placeholders.forEach((file) => {
			file.remove(true, {
				ignorePinned: true,
				suppressPanePlaceholder: true,
			});
		});
	}

	async function createPaneEditor(pane) {
		const paneEditor = new EditorView({
			state: createEmptyEditorState(),
			parent: pane.editorContainer,
		});
		pane.editor = paneEditor;
		paneEditor.__editorPane = pane;
		applyEditorCompatibility(paneEditor);
		await applyKeyBindings(paneEditor);
		pane.touchSelectionController = createTouchSelectionMenu(paneEditor, {
			container: pane.editorContainer,
			getActiveFile: () => pane.activeFile || null,
			isShiftSelectionActive,
		});
		try {
			paneEditor.dispatch({
				effects: StateEffect.appendConfig.of(getDocSyncListener()),
			});
		} catch (error) {
			warnRecoverable(
				"Failed to attach document sync listener to split editor.",
				error,
				`doc-sync-listener-${pane.id}`,
			);
		}
		await setupEditor(pane);
		return paneEditor;
	}

	async function createPane(options = {}) {
		const direction = normalizePaneDirection(options.direction);
		const sourcePane = options.sourcePane || getActivePane() || primaryPane;
		if (!canCreatePane(direction, sourcePane)) {
			window.toast?.(
				strings["not enough space"] ||
					"Not enough space to create another editor pane.",
			);
			return null;
		}

		const pane = createPaneShell();
		insertPaneIntoLayout(sourcePane, pane, direction);
		updatePaneLayoutState();
		animatePaneEntry(pane);
		await createPaneEditor(pane);
		updatePaneLayoutState();
		syncOpenFileList();

		if (options.moveFile) {
			moveFileToPane(options.moveFile, pane, { activate: true });
		} else if (options.createUntitled !== false) {
			createUntitledPaneFile(pane);
		} else if (options.activate !== false) {
			setActivePane(pane);
			pane.editor?.focus();
		}

		return pane;
	}

	function splitPane(direction = PANE_SPLIT_HORIZONTAL) {
		return createPane({ direction });
	}

	function splitPaneRight() {
		return splitPane(PANE_SPLIT_HORIZONTAL);
	}

	function splitPaneDown() {
		return splitPane(PANE_SPLIT_VERTICAL);
	}

	async function moveActiveFileToNewPane(direction = PANE_SPLIT_HORIZONTAL) {
		const file = manager.activeFile;
		if (!file) return null;
		return createPane({ moveFile: file, direction });
	}

	function closeActivePane() {
		const pane = getActivePane();
		if (!pane || panes.length <= 1) return false;
		const preferredFile = pane.activeFile;

		const orderedPanes = getOrderedPanes();
		const paneIndex = orderedPanes.indexOf(pane);
		const targetPane =
			orderedPanes[paneIndex - 1] ||
			orderedPanes[paneIndex + 1] ||
			orderedPanes[0] ||
			null;
		if (!targetPane) return false;

		for (const file of [...pane.files]) {
			if (file.isPanePlaceholder && !file.isUnsaved) {
				file.remove(true, {
					ignorePinned: true,
					suppressPanePlaceholder: true,
				});
				continue;
			}

			moveFileToPane(file, targetPane, {
				activate: false,
				createSourcePlaceholder: false,
				activateSourceFallback: false,
			});
		}

		pane.touchSelectionController?.destroy?.();
		pane.touchSelectionController = null;
		pane.editor?.destroy?.();
		removePaneFromLayout(pane);
		const storedPaneIndex = panes.indexOf(pane);
		if (storedPaneIndex >= 0) panes.splice(storedPaneIndex, 1);
		updatePaneLayoutState();
		rebuildFileListFromPanes();
		const fileToActivate = targetPane.files.includes(preferredFile)
			? preferredFile
			: targetPane.activeFile;
		if (fileToActivate) {
			fileToActivate.makeActive();
		} else {
			activatePane(targetPane);
		}
		syncOpenFileList();
		return true;
	}

	function focusPaneByOffset(offset) {
		if (panes.length <= 1) return false;
		const orderedPanes = getOrderedPanes();
		const index = Math.max(0, orderedPanes.indexOf(getActivePane()));
		const nextPane =
			orderedPanes[
				(index + offset + orderedPanes.length) % orderedPanes.length
			];
		if (!nextPane) return false;
		activatePane(nextPane);
		return true;
	}

	function focusNextPane() {
		return focusPaneByOffset(1);
	}

	function focusPreviousPane() {
		return focusPaneByOffset(-1);
	}

	function focusPaneByDirection(direction) {
		const active = getActivePane();
		if (!active || panes.length <= 1) return false;

		const orderedPanes = getOrderedPanes();
		const visiblePanes = orderedPanes
			.map((pane) => ({ pane, rect: getVisiblePaneRect(pane) }))
			.filter((entry) => entry.rect);
		const activeEntry = visiblePanes.find((entry) => entry.pane === active);

		if (!activeEntry || visiblePanes.length <= 1) {
			if (direction === "left" || direction === "up") {
				return focusPaneByOffset(-1);
			}
			if (direction === "right" || direction === "down") {
				return focusPaneByOffset(1);
			}
			return false;
		}

		const activeRect = activeEntry.rect;
		const activeCenterX = activeRect.left + activeRect.width / 2;
		const activeCenterY = activeRect.top + activeRect.height / 2;
		let bestPane = null;
		let bestScore = Number.POSITIVE_INFINITY;

		for (const { pane, rect } of visiblePanes) {
			if (pane === active) continue;
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			let axisDistance = 0;
			let crossDistance = 0;

			if (direction === "left") {
				if (centerX >= activeCenterX) continue;
				axisDistance = activeRect.left - rect.right;
				crossDistance = Math.abs(centerY - activeCenterY);
			} else if (direction === "right") {
				if (centerX <= activeCenterX) continue;
				axisDistance = rect.left - activeRect.right;
				crossDistance = Math.abs(centerY - activeCenterY);
			} else if (direction === "up") {
				if (centerY >= activeCenterY) continue;
				axisDistance = activeRect.top - rect.bottom;
				crossDistance = Math.abs(centerX - activeCenterX);
			} else if (direction === "down") {
				if (centerY <= activeCenterY) continue;
				axisDistance = rect.top - activeRect.bottom;
				crossDistance = Math.abs(centerX - activeCenterX);
			} else {
				return false;
			}

			const score = Math.max(0, axisDistance) * 1000 + crossDistance;
			if (score < bestScore) {
				bestScore = score;
				bestPane = pane;
			}
		}

		if (!bestPane) return false;
		activatePane(bestPane);
		return true;
	}

	function getEditorExtensionSignature(file) {
		return JSON.stringify({
			syntax: getEmmetSyntaxForFile(file),
			useEmmet: appSettings.value.useEmmet !== false,
			colorPreview: !!appSettings.value.colorPreview,
			autoCloseTags: appSettings.value.autoCloseTags !== false,
			baseExtensions: getBaseExtensionSignature(),
		});
	}

	function getEditorOptionsSignature() {
		const values = appSettings?.value || {};
		const keys = new Set(["editorTheme"]);
		for (const spec of cmOptionSpecs) {
			spec.keys.forEach((key) => keys.add(key));
		}

		return JSON.stringify([...keys].sort().map((key) => [key, values[key]]));
	}

	function getRawEditorState(state) {
		return state?.__rawState || state || null;
	}

	function isReusableEditorState(file, signature) {
		const session = getRawEditorState(file?.session);
		return (
			!!session &&
			!!file.__cmSessionReady &&
			file.__cmExtensionSignature === signature &&
			!!session.doc &&
			typeof session.update === "function" &&
			typeof session.facet === "function"
		);
	}

	function getFileLanguageSignature(file, extensionSignature) {
		return JSON.stringify({
			mode: file?.currentMode || "text",
			extensions: extensionSignature,
		});
	}

	function hasLanguageSupport(state) {
		try {
			return !!state?.facet?.(languageFacet);
		} catch (_) {
			return false;
		}
	}

	function shouldApplyLanguage(file, state, languageSignature) {
		const langExtFn = file?.currentLanguageExtension;
		if (typeof langExtFn !== "function") return false;
		const isPlainText =
			String(file?.currentMode || "").toLowerCase() === "text";
		return (
			file.__cmLanguageSignature !== languageSignature ||
			!file.__cmLanguageReady ||
			(!isPlainText && !hasLanguageSupport(state))
		);
	}

	function markLanguageReady(file, languageSignature, ready) {
		file.__cmLanguageSignature = languageSignature;
		file.__cmLanguageReady = ready;
	}

	function dispatchLanguageExtension(file, languageSignature, ext, warnKey) {
		try {
			editor.dispatch({
				effects: languageCompartment.reconfigure(ext || []),
			});
			file.session = editor.state;
			markLanguageReady(file, languageSignature, true);
		} catch (error) {
			warnRecoverable("Failed to apply language extensions.", error, warnKey);
		}
	}

	function resolveLanguageExtension(file, languageSignature, warnKey) {
		const langExtFn = file.currentLanguageExtension;
		if (typeof langExtFn !== "function") {
			markLanguageReady(file, languageSignature, true);
			return [];
		}

		let result;
		try {
			result = langExtFn();
		} catch (_) {
			markLanguageReady(file, languageSignature, true);
			return [];
		}

		if (result && typeof result.then === "function") {
			const fileId = file.id;
			markLanguageReady(file, languageSignature, false);
			result
				.then((ext) => {
					const pane = getFilePane(file);
					const isGlobalActive = manager.activeFile?.id === fileId;
					const isPaneActive = pane?.activeFile?.id === fileId;
					if (
						(!isGlobalActive && !isPaneActive) ||
						file.__cmLanguageSignature !== languageSignature
					) {
						return;
					}

					if (isPaneActive && pane !== getActivePane()) {
						withPaneEditorContext(pane, () => {
							dispatchLanguageExtension(file, languageSignature, ext, warnKey);
						});
						return;
					}

					dispatchLanguageExtension(file, languageSignature, ext, warnKey);
				})
				.catch(() => {
					markLanguageReady(file, languageSignature, true);
				});
			return [];
		}

		markLanguageReady(file, languageSignature, true);
		return result || [];
	}

	function scheduleLspForFile(file) {
		const fileId = file?.id;
		window.setTimeout(() => {
			if (!fileId || manager.activeFile?.id !== fileId) return;
			void configureLspForFile(file);
		}, 80);
	}

	function applyCurrentEditorOptions(file, { forceOptions = false } = {}) {
		touchSelectionController?.onSessionChanged();
		const optionsSignature = getEditorOptionsSignature();
		if (forceOptions || file.__cmOptionsSignature !== optionsSignature) {
			const desiredTheme = appSettings?.value?.editorTheme;
			if (desiredTheme) editor.setTheme(desiredTheme);
			applyOptions();
			file.__cmOptionsSignature = optionsSignature;
		}
		try {
			const ro = !file.editable || !!file.loading;
			editor.dispatch({
				effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
			});
			file.session = editor.state;
		} catch (error) {
			warnRecoverable(
				"Failed to apply read-only compartment update.",
				error,
				"readonly-reconfigure",
			);
		}
	}

	function showLoadingEditor(file) {
		const loadingState = EditorState.create({
			doc: "",
			extensions: [
				themeCompartment.of(getConfiguredThemeExtension()),
				...getBaseExtensionsFromOptions(),
				languageCompartment.of([]),
				lspCompartment.of([]),
				readOnlyCompartment.of(EditorState.readOnly.of(true)),
				EditorView.editable.of(false),
				placeholder(`Loading ${file.filename || "file"}...`),
			],
		});
		editor.setState(loadingState);
		touchSelectionController?.onSessionChanged();
	}

	function withPaneEditorContext(pane, callback) {
		if (!pane?.editor) return callback();

		const previousEditor = editor;
		const previousContainer = $container;
		const previousTouchSelectionController = touchSelectionController;

		editor = pane.editor;
		$container = pane.editorContainer || $container;
		touchSelectionController = pane.touchSelectionController || null;

		try {
			return callback();
		} finally {
			editor = previousEditor;
			$container = previousContainer;
			touchSelectionController = previousTouchSelectionController;
		}
	}

	function applyFileToPaneEditor(file, pane, options = {}) {
		if (!file || file.type !== "editor") return false;
		if (!pane?.editor || pane.activeFile?.id !== file.id) return false;
		const isCurrentPane = pane === getActivePane();
		const paneOptions = {
			...options,
			restoreScroll: options.restoreScroll ?? isCurrentPane,
			scheduleLsp: options.scheduleLsp ?? isCurrentPane,
		};
		if (isCurrentPane) {
			applyFileToEditor(file, paneOptions);
		} else {
			withPaneEditorContext(pane, () => applyFileToEditor(file, paneOptions));
		}
		return true;
	}

	// Helper: apply a file's content and language to the editor view
	function applyFileToEditor(file, options = {}) {
		if (!file || file.type !== "editor") return;
		const {
			forceRecreate = false,
			restoreScroll = true,
			scheduleLsp = true,
		} = options;
		const extensionSignature = getEditorExtensionSignature(file);
		const languageSignature = getFileLanguageSignature(
			file,
			extensionSignature,
		);

		if (!forceRecreate && isReusableEditorState(file, extensionSignature)) {
			const reusedState = getRawEditorState(file.session);
			editor.setState(reusedState);
			applyCurrentEditorOptions(file);

			if (shouldApplyLanguage(file, reusedState, languageSignature)) {
				const ext = resolveLanguageExtension(
					file,
					languageSignature,
					"reused-language-reconfigure",
				);
				if (file.__cmLanguageReady) {
					dispatchLanguageExtension(
						file,
						languageSignature,
						ext,
						"reused-language-reconfigure",
					);
				}
			}

			if (restoreScroll) restoreFileScrollPosition(file);
			if (scheduleLsp) scheduleLspForFile(file);
			return;
		}

		const syntax = getEmmetSyntaxForFile(file);
		const baseExtensions = createMainEditorExtensions({
			// Emmet needs to precede default keymaps so tracker Tab wins over indent
			emmetExtensions: createEmmetExtensionSet({ syntax }),
			baseExtensions: createConfiguredBaseExtensions(),
			commandKeymapExtension: getCommandKeymapExtension(),
			// keep compartment in the state to allow dynamic theme changes later
			themeExtension: themeCompartment.of(getConfiguredThemeExtension()),
			pointerCursorVisibilityExtension,
			shiftClickSelectionExtension,
			touchSelectionUpdateExtension,
			searchExtension: search(),
			// Keep dynamic compartments across state swaps
			optionExtensions: getBaseExtensionsFromOptions(),
		});
		const exts = [...baseExtensions];
		maybeAttachEmmetCompletions(exts, syntax);
		try {
			const initialLang = resolveLanguageExtension(
				file,
				languageSignature,
				"async-language-reconfigure",
			);
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
		const prevState = getRawEditorState(file.session);

		const doc = prevState ? prevState.doc : "";
		const state = EditorState.create({ doc, extensions: exts });
		file.session = state;
		file.__cmSessionReady = true;
		file.__cmExtensionSignature = extensionSignature;
		if (file.__cmLanguageReady) {
			markLanguageReady(file, languageSignature, true);
		}
		editor.setState(state);
		applyCurrentEditorOptions(file);

		// Restore selection from previous state if available
		try {
			const sel = prevState?.selection;
			if (sel && Array.isArray(sel.ranges)) {
				const ranges = sel.ranges.map((r) => ({ from: r.from, to: r.to }));
				const mainIndex = sel.mainIndex ?? 0;
				restoreSelection(editor, { ranges, mainIndex });
			}
		} catch (error) {
			warnRecoverable(
				"Failed to restore selection from previous session state.",
				error,
				"restore-selection",
			);
		}

		// Restore folds from previous state if available
		try {
			const folds = prevState ? getAllFolds(prevState) : [];
			if (folds && folds.length) {
				restoreFolds(editor, folds);
			}
		} catch (error) {
			warnRecoverable(
				"Failed to restore folded regions from previous session state.",
				error,
				"restore-folds",
			);
		}

		if (restoreScroll) restoreFileScrollPosition(file);
		if (scheduleLsp) scheduleLspForFile(file);
	}

	function restoreFileScrollPosition(file) {
		cancelPendingScrollRestore();
		if (!file || file.type !== "editor") return;
		const hasTop = typeof file.lastScrollTop === "number";
		const hasLeft = typeof file.lastScrollLeft === "number";
		if (!hasTop && !hasLeft) return;

		const fileId = file.id;
		const top = hasTop ? file.lastScrollTop : undefined;
		const left = hasLeft ? file.lastScrollLeft : undefined;

		const apply = () => {
			if (manager.activeFile?.id !== fileId) return;
			suppressCursorReveal(450);
			setScrollPosition(editor, top, left);

			const scroller = editor?.scrollDOM;
			if (scroller) {
				if (hasTop) lastScrollTop = scroller.scrollTop;
				if (hasLeft) lastScrollLeft = scroller.scrollLeft;
				lockScrollbarScrollPosition(
					{
						top: hasTop ? scroller.scrollTop : undefined,
						left: hasLeft ? scroller.scrollLeft : undefined,
					},
					450,
				);
			}
		};

		apply();
		scrollRestoreFrame = requestAnimationFrame(() => {
			scrollRestoreFrame = 0;
			apply();
			scrollRestoreNestedFrame = requestAnimationFrame(() => {
				scrollRestoreNestedFrame = 0;
				apply();
			});
		});
		scrollRestoreTimeout = setTimeout(() => {
			scrollRestoreTimeout = 0;
			apply();
		}, 120);
	}

	function cancelPendingScrollRestore() {
		if (scrollRestoreFrame) {
			cancelAnimationFrame(scrollRestoreFrame);
			scrollRestoreFrame = 0;
		}
		if (scrollRestoreNestedFrame) {
			cancelAnimationFrame(scrollRestoreNestedFrame);
			scrollRestoreNestedFrame = 0;
		}
		if (scrollRestoreTimeout) {
			clearTimeout(scrollRestoreTimeout);
			scrollRestoreTimeout = 0;
		}
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
		thumbHeight: scrollbarHeight,
		onscroll: onscrollV,
		onscrollend: onscrollVend,
		parent: $body,
	});
	const $hScrollbar = ScrollBar({
		width: scrollbarSize,
		thumbHeight: scrollbarHeight,
		onscroll: onscrollH,
		onscrollend: onscrollHEnd,
		parent: $body,
		placement: "bottom",
	});
	manager = {
		files: [],
		onupdate: () => {},
		activeFile: null,
		isCodeMirror: true,
		addFile,
		readOnlyCompartment,
		getFile,
		getFilePane,
		getPaneFiles,
		getPaneTabList,
		setActivePane,
		reapplyActiveFile,
		switchFile,
		createPane,
		splitPane,
		splitPaneRight,
		splitPaneDown,
		closeActivePane,
		focusNextPane,
		focusPreviousPane,
		focusPaneByDirection,
		moveActiveFileToNewPane,
		moveFileToPane,
		removeFileFromPane,
		moveFileByPinnedState,
		normalizePinnedTabOrder,
		updatePaneFileOrderFromTabs,
		syncOpenFileList,
		hasUnsavedFiles,
		getEditorHeight,
		getEditorWidth,
		header: $header,
		getLspMetadata: buildLspMetadata,
		get editor() {
			return getActivePane()?.editor || editor;
		},
		get activePane() {
			return getActivePane();
		},
		get panes() {
			return panes.slice();
		},
		get activePaneTabList() {
			return getPaneTabList();
		},
		get container() {
			return getActivePane()?.editorContainer || $container;
		},
		get isScrolling() {
			return isScrolling;
		},
		get openFileList() {
			if (isPaneTabLayout()) {
				syncGlobalOpenFileListMirror();
				return $paneAwareOpenFileList;
			}
			if (!$openFileList || $openFileList === $globalOpenFileList) {
				initFileTabContainer();
			}
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
		flushCacheWrites() {
			return Promise.all(
				manager.files
					.filter((file) => file?.type === "editor")
					.map((file) => file.flushCacheWrite?.()),
			);
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
		let diagnosticsButtonSyncRaf = 0;
		const listener = () => {
			cancelAnimationFrame(diagnosticsButtonSyncRaf);
			diagnosticsButtonSyncRaf = requestAnimationFrame(() => {
				diagnosticsButtonSyncRaf = 0;
				const active = manager.activeFile;
				if (active?.type === "editor") {
					active.session = editor.state;
				}
				toggleProblemButton();
			});
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
			} catch (error) {
				warnRecoverable(
					`Failed to resolve language id for URI: ${uri}`,
					error,
					"lsp-language-id-resolution",
				);
			}
			return "plaintext";
		},
		clientExtensions: [diagnosticsClientExt],
		diagnosticsUiExtension: buildDiagnosticsUiExt(),
	});
	applyLspSettings();

	$body.append($paneRoot);
	initModes(); // Initialize CodeMirror modes
	await setupEditor(primaryPane);

	// Initialize theme from settings or fallback
	try {
		const desired = appSettings?.value?.editorTheme || "one_dark";
		editor.setTheme(desired);
	} catch (error) {
		warnRecoverable(
			"Failed to apply configured editor theme. Falling back to one_dark.",
			error,
			"initial-editor-theme",
		);
		editor.setTheme("one_dark");
	}

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

	function recreateActiveEditorState() {
		const file = manager.activeFile;
		if (file?.type !== "editor") return;

		file.session = editor.state;
		file.lastScrollTop = editor.scrollDOM?.scrollTop ?? 0;
		file.lastScrollLeft = editor.scrollDOM?.scrollLeft ?? 0;
		applyFileToEditor(file, { forceRecreate: true });
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

	appSettings.on("update:scrollbarHeight", function (value) {
		$vScrollbar.thumbHeight = value;
		$hScrollbar.thumbHeight = value;
	});

	// Live autocompletion (activateOnTyping)
	appSettings.on("update:liveAutoCompletion", function () {
		applyOptions(["liveAutoCompletion"]);
	});

	appSettings.on("update:localWordCompletion", function () {
		applyOptions(["localWordCompletion"]);
	});

	appSettings.on("update:languageCompletion", function () {
		applyOptions(["languageCompletion"]);
	});

	appSettings.on("update:useEmmet", function () {
		recreateActiveEditorState();
	});

	appSettings.on("update:autoRenameTags", function () {
		applyOptions(["autoRenameTags"]);
	});

	appSettings.on("update:scrollPastEnd", function () {
		applyOptions(["scrollPastEnd"]);
	});

	appSettings.on("update:autoCloseTags", function () {
		recreateActiveEditorState();
	});

	appSettings.on("update:linenumbers", function () {
		updateMargin(true);
		updateEditorLineNumbersFromSettings();
	});

	// Line height update for CodeMirror
	appSettings.on("update:lineHeight", function () {
		updateEditorStyleFromSettings();
	});

	appSettings.on("update:cursorWidth", function () {
		applyOptions(["cursorWidth"]);
	});

	appSettings.on("update:relativeLineNumbers", function () {
		updateEditorLineNumbersFromSettings();
	});

	appSettings.on("update:editorTheme", function () {
		const desiredTheme = appSettings?.value?.editorTheme || "one_dark";
		setThemeForEditors(desiredTheme);
		applyOptions(["rainbowBrackets"]);
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
		recreateActiveEditorState();
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
			const pane = update.view.__editorPane || getActivePane();
			const file = pane?.activeFile || manager.activeFile;
			if (!file || file.type !== "editor") return;

			if (update.docChanged) {
				events.emit("editor-state-changed", update.view);
			}

			// Only run expensive work when the document actually changed
			if (!update.docChanged) return;

			// Mirror latest state only on doc changes to avoid clobbering async loads
			file.session = update.state;

			if (file.markChanged === false) {
				return;
			}

			file.markEdited();

			// Debounced change handling (unsaved flag, cache, autosave)
			const timers = getDocSyncTimers(file);
			if (timers.checkTimeout) clearTimeout(timers.checkTimeout);
			if (timers.autosaveTimeout) clearTimeout(timers.autosaveTimeout);

			timers.checkTimeout = setTimeout(async () => {
				timers.checkTimeout = null;
				try {
					file.scheduleCacheWrite();
				} catch (error) {
					warnRecoverable(
						`Failed to write cache for ${file.filename || file.uri}`,
						error,
						`cache-write-${file.id}`,
					);
				}

				events.emit("file-content-changed", file);
				manager.onupdate("file-changed");
				manager.emit("update", "file-changed");
				toggleProblemButton();

				const { autosave } = appSettings.value;
				if (file.uri && file.isUnsaved && autosave) {
					timers.autosaveTimeout = setTimeout(() => {
						timers.autosaveTimeout = null;
						file.save()?.catch?.((error) => {
							warnRecoverable(
								`Failed to autosave ${file.filename || file.uri}`,
								error,
								`autosave-${file.id}`,
							);
						});
					}, autosave);
				}

				file.markChanged = true;
			}, TIMEOUT_VALUE);
		});
	}

	// Register critical listeners
	manager.on(["file-loaded"], (file) => {
		if (!file || file.type !== "editor") return;
		const pane = getFilePane(file);
		if (pane?.activeFile?.id === file.id) {
			applyFileToPaneEditor(file, pane);
		} else if (manager.activeFile?.id === file.id) {
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
		} catch (error) {
			warnRecoverable(
				"Failed to apply read-only compartment update. Recreating editor state.",
				error,
				"readonly-reconfigure",
			);
			// Fallback: full re-apply
			applyFileToEditor(file, { forceRecreate: true });
		}
	});

	manager.on(["remove-file"], (file) => {
		clearDocSyncTimers(file);
		detachLspForFile(file);
		toggleProblemButton();
	});

	manager.on(["rename-file"], (file) => {
		if (file?.type !== "editor") return;
		if (manager.activeFile?.id === file.id) {
			// Re-apply file to editor to update language/syntax highlighting
			applyFileToEditor(file, { forceRecreate: true });
		}
	});

	// Attach doc-sync listener to the current editor instance
	try {
		editor.dispatch({
			effects: StateEffect.appendConfig.of(getDocSyncListener()),
		});
	} catch (error) {
		warnRecoverable(
			"Failed to attach document sync listener to editor.",
			error,
			"doc-sync-listener",
		);
	}

	return manager;

	/**
	 * Adds a file to the manager's file list and updates the UI.
	 * @param {File} file - The file to be added.
	 */
	function addFile(file) {
		if (manager.files.includes(file)) return;
		const pane = getPaneById(file.paneId) || getActivePane() || primaryPane;
		insertFileIntoPane(file, pane);
		if (!pane.activeFile) pane.activeFile = file;
		rebuildFileListFromPanes();
		syncOpenFileList();
		if (!manager.activeFile) {
			$header.text = file.name;
		}
		toggleProblemButton();
	}

	function getPinnedInsertIndex(files, skipFile = null) {
		return files.reduce((count, file) => {
			if (file === skipFile) return count;
			return count + (file.pinned ? 1 : 0);
		}, 0);
	}

	function insertFileIntoPane(file, pane, index = null) {
		if (!file || !pane) return;
		const oldPane = getFilePane(file);
		if (oldPane) {
			oldPane.files = oldPane.files.filter((paneFile) => paneFile !== file);
		}
		file.paneId = pane.id;
		const insertAt =
			Number.isInteger(index) && index >= 0
				? Math.min(index, pane.files.length)
				: file.pinned
					? getPinnedInsertIndex(pane.files)
					: pane.files.length;
		pane.files.splice(insertAt, 0, file);
	}

	function rebuildFileListFromPanes() {
		manager.files = getOrderedPanes().flatMap((pane) => pane.files);
		return manager.files;
	}

	function toDomCollection(nodes) {
		const collection = [...nodes].filter(Boolean);
		collection.item = (index) => collection[index] || null;
		return collection;
	}

	function getOpenFileListChildren() {
		if (!isPaneTabLayout()) {
			const list = $openFileList?.$ul || $openFileList;
			return list ? [...list.children] : [];
		}

		return getOrderedPanes().flatMap((pane) => [...pane.tabList.children]);
	}

	function collectFromOpenFileListChildren(collector) {
		const result = [];
		getOpenFileListChildren().forEach((child) => {
			result.push(...collector(child));
		});
		return result;
	}

	function queryOpenFileList(selector) {
		return collectFromOpenFileListChildren((child) => [
			...(child.matches?.(selector) ? [child] : []),
			...child.querySelectorAll(selector),
		]);
	}

	function getOpenFileListMutationTarget(referenceNode = null) {
		if (!isPaneTabLayout()) {
			if (!$openFileList || $openFileList === $globalOpenFileList) {
				initFileTabContainer();
			}
			return $openFileList?.$ul || $openFileList || $globalOpenFileList;
		}

		if (referenceNode?.parentElement?.classList?.contains("editor-pane-tabs")) {
			return referenceNode.parentElement;
		}

		return getPaneTabList() || getActivePane()?.tabList || $globalOpenFileList;
	}

	function mutateVisibleOpenFileList(method, args) {
		const target = getOpenFileListMutationTarget(
			method === "insertBefore" ? args[1] : null,
		);
		if (!target || target === $globalOpenFileList) {
			return globalOpenFileListNative[method]?.(...args);
		}

		if (method === "insertBefore") {
			const [node, referenceNode] = args;
			return target.insertBefore(
				node,
				referenceNode?.parentElement === target ? referenceNode : null,
			);
		}

		return target[method](...args);
	}

	function syncGlobalOpenFileListMirror() {
		globalOpenFileListNative.replaceChildren(
			...manager.files.map((file) => {
				const tab = file.tab.cloneNode(true);
				tab.dataset.fileId = file.id;
				tab.dataset.paneId = file.paneId || "";
				tab.classList.toggle("active", manager.activeFile?.id === file.id);
				return tab;
			}),
		);
	}

	function isDraggingFileTab(file) {
		return file?.tab?.dataset.editorTabDragging === "true";
	}

	function syncOpenFileList() {
		if (isPaneTabLayout()) {
			$paneRoot.classList.remove("hide-pane-tabs");
			panes.forEach((pane) => {
				const preserveCurrentTabOrder = !!pane.tabList.querySelector(
					'[data-editor-tab-dragging="true"]',
				);
				pane.files.forEach((file) => {
					file.tab.classList.toggle("active", pane.activeFile?.id === file.id);
					if (isDraggingFileTab(file) || preserveCurrentTabOrder) return;
					pane.tabList.append(file.tab);
				});
				pane.element.classList.toggle("empty", pane.files.length === 0);
			});
			syncGlobalOpenFileListMirror();
			return;
		}

		$paneRoot.classList.add("hide-pane-tabs");
		if (!$openFileList || $openFileList === $globalOpenFileList) {
			initFileTabContainer();
		}
		const $list = $openFileList;
		manager.files.forEach((file) => {
			$list.append(file.tab);
		});
	}

	function moveFileByPinnedState(file) {
		const pane = getFilePane(file);
		if (!pane) return;
		pane.files = normalizePinnedFiles(pane.files);
		rebuildFileListFromPanes();
		syncOpenFileList();
		if (manager.activeFile?.id === file.id) {
			file.tab.scrollIntoView();
		}
	}

	function normalizePinnedTabOrder(nextFiles = manager.files) {
		const pane =
			nextFiles.length &&
			nextFiles.every((file) => getFilePane(file) === getFilePane(nextFiles[0]))
				? getFilePane(nextFiles[0])
				: null;

		if (pane) {
			pane.files = normalizePinnedFiles(nextFiles);
			rebuildFileListFromPanes();
			syncOpenFileList();
			return pane.files;
		}

		panes.forEach((pane) => {
			pane.files = normalizePinnedFiles(pane.files);
		});
		rebuildFileListFromPanes();
		syncOpenFileList();

		return manager.files;
	}

	function normalizePinnedFiles(files) {
		const pinnedFiles = [];
		const regularFiles = [];

		files.forEach((file) => {
			if (file.pinned) {
				pinnedFiles.push(file);
				return;
			}
			regularFiles.push(file);
		});

		return [...pinnedFiles, ...regularFiles];
	}

	function getPaneById(id) {
		if (!id) return null;
		return panes.find((pane) => pane.id === id) || null;
	}

	function getFilePane(fileOrId) {
		const id = typeof fileOrId === "string" ? fileOrId : fileOrId?.id || null;
		if (!id) return null;
		return (
			panes.find((pane) => pane.files.some((file) => file.id === id)) || null
		);
	}

	function getPaneFiles(fileOrPane = getActivePane()) {
		const pane = fileOrPane?.files ? fileOrPane : getFilePane(fileOrPane);
		return pane?.files || manager.files;
	}

	function getPaneTabList(fileOrPane = getActivePane()) {
		const pane = fileOrPane?.tabList
			? fileOrPane
			: typeof fileOrPane === "string"
				? getPaneById(fileOrPane) || getFilePane(fileOrPane)
				: getFilePane(fileOrPane);
		return pane?.tabList || null;
	}

	function getPaneFallbackFile(pane) {
		if (!pane?.files?.length) return null;
		for (let i = pane.files.length - 1; i >= 0; i--) {
			const file = pane.files[i];
			if (!isDraggingFileTab(file)) return file;
		}
		return null;
	}

	function moveFileToPane(file, targetPane, options = {}) {
		if (!file || !targetPane) return false;
		const {
			activate = true,
			index = null,
			createSourcePlaceholder = true,
			activateSourceFallback = true,
		} = options;
		const sourcePane = getFilePane(file);
		if (sourcePane === targetPane) {
			if (activate) file.makeActive();
			return true;
		}

		if (sourcePane?.activeFile?.id === file.id && file.type === "editor") {
			const sourceEditor = sourcePane.editor;
			file.session = getRawEditorState(sourceEditor?.state);
			file.lastScrollTop = sourceEditor?.scrollDOM?.scrollTop || 0;
			file.lastScrollLeft = sourceEditor?.scrollDOM?.scrollLeft || 0;
		}

		insertFileIntoPane(file, targetPane, index);
		if (!file.isPanePlaceholder || file.isUnsaved) {
			removePanePlaceholders(targetPane, file);
		}
		if (!targetPane.activeFile && !activate) {
			targetPane.activeFile = file;
		}
		rebuildFileListFromPanes();
		syncOpenFileList();

		if (sourcePane?.activeFile?.id === file.id) {
			const nextSourceFile = getPaneFallbackFile(sourcePane);
			sourcePane.activeFile = null;
			file.tab?.classList.remove("active");
			if (nextSourceFile && activateSourceFallback) {
				nextSourceFile.makeActive();
			} else if (createSourcePlaceholder) {
				sourcePane.editor?.setState(createEmptyEditorState());
				sourcePane.editorContainer.style.display = "block";
				createUntitledPaneFile(sourcePane);
			}
			syncOpenFileList();
		}

		if (activate) {
			file.makeActive();
		}
		return true;
	}

	function removeFileFromPane(file) {
		const pane = getFilePane(file);
		if (!pane) return null;
		const wasPaneActive = pane.activeFile?.id === file.id;
		pane.files = pane.files.filter((paneFile) => paneFile !== file);
		let nextFile = pane.activeFile;
		if (wasPaneActive) {
			nextFile = pane.files[pane.files.length - 1] || null;
			pane.activeFile = null;
			if (!nextFile) {
				pane.editor?.setState(createEmptyEditorState());
				pane.editorContainer.style.display = "block";
			}
		}
		rebuildFileListFromPanes();
		syncOpenFileList();
		return { pane, wasPaneActive, nextFile };
	}

	function updatePaneFileOrderFromTabs($tabList, options = {}) {
		const pane = $tabList?.__editorPane;
		if (!pane) return false;

		const nextFiles = [...$tabList.children]
			.map(($tab) => pane.files.find((file) => file.tab === $tab))
			.filter(Boolean);
		if (!nextFiles.length) return false;

		pane.files = nextFiles;
		const pinnedCount = pane.files.filter((file) => file.pinned).length;
		const draggedFile = pane.files.includes(options.draggedFile)
			? options.draggedFile
			: pane.files.find(
					(file) => file.tab?.dataset.editorTabDragging === "true",
				);
		if (draggedFile) {
			const draggedIndex = pane.files.indexOf(draggedFile);
			let nextPinnedState;

			if (!draggedFile.pinned && draggedIndex < pinnedCount) {
				nextPinnedState = true;
			} else if (draggedFile.pinned && draggedIndex >= pinnedCount) {
				nextPinnedState = false;
			}

			if (nextPinnedState !== undefined) {
				draggedFile.setPinnedState(nextPinnedState, { reorder: false });
				pane.files = normalizePinnedFiles(pane.files);
			}
		}

		rebuildFileListFromPanes();
		syncOpenFileList();
		return true;
	}

	function isPaneTabLayout() {
		const { openFileListPos } = appSettings.value;
		// Sidebar mode keeps the global sidebar list, so pane-local tab bars stay hidden.
		return (
			openFileListPos === appSettings.OPEN_FILE_LIST_POS_HEADER ||
			openFileListPos === appSettings.OPEN_FILE_LIST_POS_BOTTOM
		);
	}

	/**
	 * Sets up the editor with various configurations and event listeners.
	 * @returns {Promise<void>} A promise that resolves once the editor is set up.
	 */
	async function setupEditor(pane = getActivePane()) {
		const editor = pane?.editor;
		const touchSelectionController = pane?.touchSelectionController;
		if (!pane || !editor) return;
		const settings = appSettings.value;
		const { leftMargin, textWrap, colorPreview, fontSize, lineHeight } =
			appSettings.value;
		const scrollMarginTop = 0;
		const scrollMarginLeft = 0;
		const scrollMarginRight = textWrap ? 0 : leftMargin;
		const scrollMarginBottom = 0;

		let scrollTimeout;
		let scrollSyncRaf = 0;
		const scroller = editor.scrollDOM;

		function syncScrollUi() {
			if (pane !== activePane) return;
			scrollSyncRaf = 0;
			editor.requestMeasure({
				read: () => readScrollMetrics(),
				write: updateScrollbarsFromMetrics,
			});
		}

		function handleEditorScroll() {
			if (pane !== activePane) return;
			if (!scroller) return;
			if (restoreScrollbarScrollLock()) return;
			if (!isScrolling) {
				isScrolling = true;
				if (hasHoverTooltips(editor.state)) {
					editor.dispatch({ effects: closeHoverTooltips });
				}
				touchSelectionController?.onScrollStart();
			}
			if (!scrollSyncRaf) {
				scrollSyncRaf = requestAnimationFrame(syncScrollUi);
			}
			clearTimeout(scrollTimeout);
			scrollTimeout = setTimeout(() => {
				isScrolling = false;
				touchSelectionController?.onScrollEnd();
			}, 100);
		}

		scroller?.addEventListener("scroll", handleEditorScroll, { passive: true });
		scroller?.addEventListener("pointerdown", clearScrollbarScrollLock, {
			passive: true,
		});
		scroller?.addEventListener("touchstart", clearScrollbarScrollLock, {
			passive: true,
		});
		scroller?.addEventListener("wheel", clearScrollbarScrollLock, {
			passive: true,
		});
		syncScrollUi();

		keyboardHandler.on("keyboardShowStart", () => {
			requestAnimationFrame(() => {
				if (isCursorRevealSuppressed()) return;
				scrollCursorIntoView({ behavior: "instant" });
			});
		});
		keyboardHandler.on("keyboardShow", () => {
			if (isCursorRevealSuppressed()) return;
			scrollCursorIntoView();
		});
		keyboardHandler.on("keyboardHide", () => {
			requestAnimationFrame(() => {
				if (isCursorRevealSuppressed()) return;
				scrollCursorIntoView({ behavior: "instant" });
			});
		});

		// Attach native DOM event listeners directly to the editor's contentDOM
		const contentDOM = editor.contentDOM;
		const isFocused =
			contentDOM === document.activeElement ||
			contentDOM.contains(document.activeElement);
		setNativeContextMenuDisabled(isFocused);

		contentDOM.addEventListener("focus", (_event) => {
			setActivePane(pane);
			setNativeContextMenuDisabled(true);
			const activeFile = pane.activeFile;
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
				const activeFile = pane.activeFile;
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
		const bottomMargin = 24;

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

	function suppressCursorReveal(duration = 500) {
		suppressCursorRevealUntil = Date.now() + duration;
	}

	function isCursorRevealSuppressed() {
		return Date.now() < suppressCursorRevealUntil;
	}

	function lockScrollbarScrollPosition({ top, left }, duration = 1200) {
		const scroller = editor?.scrollDOM;
		if (!scroller) return;
		scrollbarScrollLockUntil = Date.now() + duration;
		if (typeof top === "number") scrollbarScrollLockTop = top;
		if (typeof left === "number") scrollbarScrollLockLeft = left;
	}

	function clearScrollbarScrollLock() {
		scrollbarScrollLockUntil = 0;
		scrollbarScrollLockTop = null;
		scrollbarScrollLockLeft = null;
	}

	function restoreScrollbarScrollLock() {
		if (Date.now() >= scrollbarScrollLockUntil) {
			clearScrollbarScrollLock();
			return false;
		}

		const scroller = editor?.scrollDOM;
		if (!scroller) return false;

		let restored = false;
		if (
			typeof scrollbarScrollLockTop === "number" &&
			Math.abs(scroller.scrollTop - scrollbarScrollLockTop) > 1
		) {
			scroller.scrollTop = scrollbarScrollLockTop;
			lastScrollTop = scroller.scrollTop;
			restored = true;
		}
		if (
			typeof scrollbarScrollLockLeft === "number" &&
			Math.abs(scroller.scrollLeft - scrollbarScrollLockLeft) > 1
		) {
			scroller.scrollLeft = scrollbarScrollLockLeft;
			lastScrollLeft = scroller.scrollLeft;
			restored = true;
		}
		return restored;
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
		suppressCursorReveal();
		const normalized = clamp01(value);
		const maxScroll = Math.max(
			scroller.scrollHeight - scroller.clientHeight,
			0,
		);
		preventScrollbarV = true;
		scroller.scrollTop = normalized * maxScroll;
		lastScrollTop = scroller.scrollTop;
		lockScrollbarScrollPosition({ top: lastScrollTop });
	}

	/**
	 * Handles the onscroll event for the vend element.
	 */
	function onscrollVend() {
		suppressCursorReveal(1200);
		lockScrollbarScrollPosition({ top: editor?.scrollDOM?.scrollTop }, 1200);
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
		suppressCursorReveal();
		const normalized = clamp01(value);
		const maxScroll = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
		preventScrollbarH = true;
		scroller.scrollLeft = normalized * maxScroll;
		lastScrollLeft = scroller.scrollLeft;
		lockScrollbarScrollPosition({ left: lastScrollLeft });
	}

	/**
	 * Handles the event when the horizontal scrollbar reaches the end.
	 */
	function onscrollHEnd() {
		suppressCursorReveal(1200);
		lockScrollbarScrollPosition({ left: editor?.scrollDOM?.scrollLeft }, 1200);
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

	function readScrollMetrics() {
		const scroller = editor?.scrollDOM;
		if (!scroller) return null;
		return {
			scrollTop: scroller.scrollTop,
			scrollLeft: scroller.scrollLeft,
			scrollHeight: scroller.scrollHeight,
			scrollWidth: scroller.scrollWidth,
			clientHeight: scroller.clientHeight,
			clientWidth: scroller.clientWidth,
		};
	}

	function updateScrollbarsFromMetrics(metrics) {
		if (!metrics) return;

		const maxScrollTop = Math.max(
			metrics.scrollHeight - metrics.clientHeight,
			0,
		);
		if (maxScrollTop <= 0) {
			$vScrollbar.hide();
			lastScrollTop = 0;
			$vScrollbar.value = 0;
		} else {
			if (!preventScrollbarV && metrics.scrollTop !== lastScrollTop) {
				lastScrollTop = metrics.scrollTop;
				$vScrollbar.value = clamp01(metrics.scrollTop / maxScrollTop);
			}
			$vScrollbar.render();
		}

		if (appSettings.value.textWrap) {
			$hScrollbar.hide();
			return;
		}

		const maxScrollLeft = Math.max(
			metrics.scrollWidth - metrics.clientWidth,
			0,
		);
		if (maxScrollLeft <= 0) {
			$hScrollbar.hide();
			lastScrollLeft = 0;
			$hScrollbar.value = 0;
			return;
		}

		if (!preventScrollbarH && metrics.scrollLeft !== lastScrollLeft) {
			lastScrollLeft = metrics.scrollLeft;
			$hScrollbar.value = clamp01(metrics.scrollLeft / maxScrollLeft);
		}
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
			} catch (error) {
				warnRecoverable(
					"Failed to read editor annotations while checking problems.",
					error,
					"read-annotations",
				);
			}
		}

		if (typeof state.field !== "function") return false;
		try {
			const diagnostics = getLspDiagnostics(state);
			return diagnostics.length > 0;
		} catch (error) {
			warnRecoverable(
				"Failed to read LSP diagnostics while checking problems.",
				error,
				"read-lsp-diagnostics",
			);
		}

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
		const pane = getFilePane(file);
		if (pane?.activeFile?.id === file.id && pane.editor?.state) {
			return pane.editor.state;
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
	function switchFile(id, targetPane = null) {
		const pane = targetPane || getFilePane(id) || getActivePane();
		if (!pane) return;
		const paneActiveFile = pane.activeFile;
		if (paneActiveFile?.id === id && activePane === pane) return;

		const file = manager.getFile(id);
		if (!file) return;

		setActivePane(pane, { emitSwitch: false });

		// Hide previous content if it was non-editor
		if (paneActiveFile?.type !== "editor" && paneActiveFile?.content) {
			paneActiveFile.content.style.display = "none";
		}

		// Persist the previous editor's state before switching away
		const prev = paneActiveFile;
		if (prev?.type === "editor") {
			prev.session = getRawEditorState(pane.editor.state);
			prev.lastScrollTop = pane.editor.scrollDOM?.scrollTop || 0;
			prev.lastScrollLeft = pane.editor.scrollDOM?.scrollLeft || 0;
			window.setTimeout(() => {
				prev.flushCacheWrite?.().catch((error) => {
					warnRecoverable(
						`Failed to flush cache for ${prev.filename || prev.uri}`,
						error,
						`cache-flush-${prev.id}`,
					);
				});
			}, 1000);
		}

		paneActiveFile?.tab.classList.remove("active");
		pane.activeFile = file;
		manager.activeFile = file;
		file.tab.classList.add("active");
		file.tab.scrollIntoView();
		updateHeaderForFile(file);
		if (isPaneTabLayout()) syncGlobalOpenFileListMirror();

		if (file.type === "editor") {
			pane.touchSelectionController?.setEnabled(true);
			if (!file.loaded && !file.loading) {
				showLoadingEditor(file);
			} else {
				// Apply active file content and language to CodeMirror
				applyFileToEditor(file);
			}
			pane.editorContainer.style.display = "block";

			$hScrollbar.hideImmediately();
			$vScrollbar.hideImmediately();

			setVScrollValue();
			if (!appSettings.value.textWrap) {
				setHScrollValue();
			}
		} else {
			pane.touchSelectionController?.setEnabled(false);
			pane.editorContainer.style.display = "none";
			if (file.content) {
				file.content.style.display = "block";
				if (file.content.parentElement !== pane.content) {
					pane.content.appendChild(file.content);
				}
			}
		}
		manager.onupdate("switch-file");
		events.emit("switch-file", file);

		toggleProblemButton();
	}

	function reapplyActiveFile() {
		const file = manager.activeFile;
		if (!file || file.type !== "editor" || !file.loaded || file.loading) return;
		applyFileToEditor(file, { forceRecreate: true });
	}

	/**
	 * Initializes the file tab container.
	 */
	function initFileTabContainer() {
		let $list;

		if (
			$openFileList &&
			$openFileList !== $globalOpenFileList &&
			!$openFileList.classList.contains("editor-pane-tabs")
		) {
			if ($openFileList.classList.contains("collapsible")) {
				$list = Array.from($openFileList.$ul.children);
			} else {
				$list = Array.from($openFileList.children);
			}
			$openFileList.remove();
		}

		// show open file list in header
		const { openFileListPos } = appSettings.value;
		if (isPaneTabLayout()) {
			$openFileList = $globalOpenFileList;
			$paneRoot.dataset.tabsPosition =
				openFileListPos === appSettings.OPEN_FILE_LIST_POS_BOTTOM
					? "bottom"
					: "top";
			root.classList.remove("top-bar");
			syncOpenFileList();
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
			syncOpenFileList();
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
