import sidebarApps from "sidebarApps";
import initColorView, { deactivateColorView } from "ace/colorView";
import { setCommands, setKeyBindings } from "ace/commands";
import touchListeners, { scrollAnimationFrame } from "ace/touchHandler";
import list from "components/collapsableList";
import quickTools from "components/quickTools";
import ScrollBar from "components/scrollbar";
import SideButton, { sideButtonContainer } from "components/sideButton";
import keyboardHandler, { keydownState } from "handlers/keyboard";
import actions from "handlers/quickTools";
import EditorFile from "./editorFile";
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
	const problemButton = SideButton({
		text: strings.problems,
		icon: "warningreport_problem",
		backgroundColor: "var(--danger-color)",
		textColor: "var(--danger-text-color)",
		onclick() {
			acode.exec("open", "problems");
		},
	});
	const editor = ace.edit($container);
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
		addFile,
		editor,
		getFile,
		switchFile,
		hasUnsavedFiles,
		getEditorHeight,
		getEditorWidth,
		header: $header,
		container: $container,
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
	};

	// set mode text
	editor.setSession(ace.createEditSession("", "ace/mode/text"));
	$body.append($container);
	await setupEditor();

	$hScrollbar.onshow = $vScrollbar.onshow = updateFloatingButton.bind(
		{},
		false,
	);
	$hScrollbar.onhide = $vScrollbar.onhide = updateFloatingButton.bind({}, true);

	appSettings.on("update:textWrap", function (value) {
		updateMargin();
		for (let file of manager.files) {
			file.session.setUseWrapMode(value);
			if (!value) file.session.on("changeScrollLeft", onscrollleft);
			else file.session.off("changeScrollLeft", onscrollleft);
		}
	});

	appSettings.on("update:tabSize", function (value) {
		manager.files.forEach((file) => file.session.setTabSize(value));
	});

	appSettings.on("update:softTab", function (value) {
		manager.files.forEach((file) => file.session.setUseSoftTabs(value));
	});

	appSettings.on("update:showSpaces", function (value) {
		editor.setOption("showInvisibles", value);
	});

	appSettings.on("update:fontSize", function (value) {
		editor.setFontSize(value);
	});

	appSettings.on("update:openFileListPos", function (value) {
		initFileTabContainer();
		$vScrollbar.resize();
	});

	appSettings.on("update:showPrintMargin", function (value) {
		editorManager.editor.setOption("showPrintMargin", value);
	});

	appSettings.on("update:scrollbarSize", function (value) {
		$vScrollbar.size = value;
		$hScrollbar.size = value;
	});

	appSettings.on("update:liveAutoCompletion", function (value) {
		editor.setOption("enableLiveAutocompletion", value);
	});

	appSettings.on("update:linenumbers", function (value) {
		updateMargin(true);
		editor.resize(true);
	});

	appSettings.on("update:lineHeight", function (value) {
		editor.container.style.lineHeight = value;
	});

	appSettings.on("update:relativeLineNumbers", function (value) {
		editor.setOption("relativeLineNumbers", value);
	});

	appSettings.on("update:elasticTabstops", function (value) {
		editor.setOption("useElasticTabstops", value);
	});

	appSettings.on("update:rtlText", function (value) {
		editor.setOption("rtlText", value);
	});

	appSettings.on("update:hardWrap", function (value) {
		editor.setOption("hardWrap", value);
	});

	appSettings.on("update:printMargin", function (value) {
		editor.setOption("printMarginColumn", value);
	});

	appSettings.on("update:colorPreview", function (value) {
		if (value) {
			return initColorView(editor, true);
		}

		deactivateColorView();
	});

	appSettings.on("update:showSideButtons", function () {
		updateMargin();
		updateSideButtonContainer();
	});

	appSettings.on("update:showAnnotations", function () {
		updateMargin(true);
	});

	appSettings.on("update:fadeFoldWidgets", function (value) {
		editor.setOption("fadeFoldWidgets", value);
	});

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
	}

	/**
	 * Sets up the editor with various configurations and event listeners.
	 * @returns {Promise<void>} A promise that resolves once the editor is set up.
	 */
	async function setupEditor() {
		const Emmet = ace.require("ace/ext/emmet");
		const textInput = editor.textInput.getElement();
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

		editor.on("focus", async () => {
			const { activeFile } = manager;
			activeFile.focused = true;
			keyboardHandler.on("keyboardShow", scrollCursorIntoView);

			if (isScrolling) return;

			$hScrollbar.hide();
			$vScrollbar.hide();
		});

		editor.on("blur", async () => {
			const { hardKeyboardHidden, keyboardHeight } =
				await getSystemConfiguration();
			const blur = () => {
				const { activeFile } = manager;
				activeFile.focused = false;
				activeFile.focusedBefore = false;
			};

			if (
				hardKeyboardHidden === HARDKEYBOARDHIDDEN_NO &&
				keyboardHeight < 100
			) {
				// external keyboard
				blur();
				return;
			}

			const onKeyboardHide = () => {
				keyboardHandler.off("keyboardHide", onKeyboardHide);
				blur();
			};

			keyboardHandler.on("keyboardHide", onKeyboardHide);
		});

		editor.on("change", (e) => {
			if (checkTimeout) clearTimeout(checkTimeout);
			if (autosaveTimeout) clearTimeout(autosaveTimeout);

			checkTimeout = setTimeout(async () => {
				const { activeFile } = manager;

				if (activeFile.markChanged) {
					const changed = await activeFile.isChanged();
					activeFile.isUnsaved = changed;
					activeFile.writeToCache();
					events.emit("file-content-changed", activeFile);
					manager.onupdate("file-changed");
					manager.emit("update", "file-changed");

					const { autosave } = appSettings.value;
					if (activeFile.uri && changed && autosave) {
						autosaveTimeout = setTimeout(() => {
							acode.exec("save", false);
						}, autosave);
					}
				}
				activeFile.markChanged = true;
			}, TIMEOUT_VALUE);
		});

		editor.on("changeAnnotation", toggleProblemButton);

		editor.on("scroll", () => {
			clearTimeout(scrollTimeout);
			isScrolling = true;
			scrollTimeout = setTimeout(() => {
				isScrolling = false;
			}, 100);
		});

		editor.renderer.on("resize", () => {
			$vScrollbar.resize($vScrollbar.visible);
			$hScrollbar.resize($hScrollbar.visible);
		});

		editor.on("scrolltop", onscrolltop);
		editor.on("scrollleft", onscrollleft);
		textInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				keydownState.esc = { value: true, target: textInput };
			}
		});

		if (colorPreview) {
			initColorView(editor);
		}

		touchListeners(editor);
		setCommands(editor);
		await setKeyBindings(editor);
		Emmet.setCore(window.emmet);
		editor.setFontSize(fontSize);
		editor.setHighlightSelectedWord(true);
		editor.container.style.lineHeight = lineHeight;

		ace.require("ace/ext/language_tools");
		editor.setOption("animatedScroll", false);
		editor.setOption("tooltipFollowsMouse", false);
		editor.setOption("theme", settings.editorTheme);
		editor.setOption(
			"showGutter",
			settings.linenumbers || settings.showAnnotations,
		);
		editor.setOption("showLineNumbers", settings.linenumbers);
		editor.setOption("enableEmmet", true);
		editor.setOption("showInvisibles", settings.showSpaces);
		editor.setOption("indentedSoftWrap", false);
		editor.setOption("scrollPastEnd", 0.5);
		editor.setOption("showPrintMargin", settings.showPrintMargin);
		editor.setOption("relativeLineNumbers", settings.relativeLineNumbers);
		editor.setOption("useElasticTabstops", settings.elasticTabstops);
		editor.setOption("useTextareaForIME", settings.useTextareaForIME);
		editor.setOption("rtlText", settings.rtlText);
		editor.setOption("hardWrap", settings.hardWrap);
		editor.setOption("spellCheck", settings.spellCheck);
		editor.setOption("printMarginColumn", settings.printMargin);
		editor.setOption("enableBasicAutocompletion", true);
		editor.setOption("enableLiveAutocompletion", settings.liveAutoCompletion);
		editor.setOption("copyWithEmptySelection", true);
		editor.setOption("fadeFoldWidgets", settings.fadeFoldWidgets);
		// editor.setOption('enableInlineAutocompletion', settings.inlineAutoCompletion);

		updateMargin(true);
		updateSideButtonContainer();
		editor.renderer.setScrollMargin(
			scrollMarginTop,
			scrollMarginBottom,
			scrollMarginLeft,
			scrollMarginRight,
		);
	}

	/**
	 * Scrolls the cursor into view if it is not currently visible.
	 */
	function scrollCursorIntoView() {
		keyboardHandler.off("keyboardShow", scrollCursorIntoView);
		if (isCursorVisible()) return;
		const { teardropSize } = appSettings.value;
		editor.renderer.scrollCursorIntoView();
		editor.renderer.scrollBy(0, teardropSize + 10);
		editor._emit("scroll-intoview");
	}

	/**
	 * Checks if the cursor is visible within the Ace editor.
	 * @returns {boolean} - True if the cursor is visible, false otherwise.
	 */
	function isCursorVisible() {
		const { editor, container } = editorManager;
		const { teardropSize } = appSettings.value;
		const cursorPos = editor.getCursorPosition();
		const contentTop = container.getBoundingClientRect().top;
		const contentBottom = contentTop + container.clientHeight;
		const cursorTop = editor.renderer.textToScreenCoordinates(
			cursorPos.row,
			cursorPos.column,
		).pageY;
		const cursorBottom = cursorTop + teardropSize + 10;
		return cursorTop >= contentTop && cursorBottom <= contentBottom;
	}

	/**
	 * Sets the vertical scroll value of the editor. This is called when the editor is scrolled horizontally using the scrollbar.
	 * @param {Number} value
	 */
	function onscrollV(value) {
		preventScrollbarV = true;
		const session = editor.getSession();
		const editorHeight = getEditorHeight(editor);
		const scroll = editorHeight * value;

		session.setScrollTop(scroll);
		editor._emit("scroll", editor);
		cancelAnimationFrame(scrollAnimationFrame);
	}

	/**
	 * Handles the onscroll event for the vend element.
	 */
	function onscrollVend() {
		preventScrollbarV = false;
	}

	/**
	 * Sets the horizontal scroll value of the editor. This is called when the editor is scrolled vertically using the scrollbar.
	 * @param {number} value - The scroll value.
	 */
	function onscrollH(value) {
		preventScrollbarH = true;
		const session = editor.getSession();
		const editorWidth = getEditorWidth(editor);
		const scroll = editorWidth * value;

		session.setScrollLeft(scroll);
		editor._emit("scroll", editor);
		cancelAnimationFrame(scrollAnimationFrame);
	}

	/**
	 * Handles the event when the horizontal scrollbar reaches the end.
	 */
	function onscrollHEnd() {
		preventScrollbarH = false;
	}

	/**
	 * Sets scrollbars value based on the editor's scroll position.
	 */
	function setHScrollValue() {
		if (appSettings.value.textWrap || preventScrollbarH) return;
		const session = editor.getSession();
		const scrollLeft = session.getScrollLeft();

		if (scrollLeft === lastScrollLeft) return;

		const editorWidth = getEditorWidth(editor);
		const factor = (scrollLeft / editorWidth).toFixed(2);

		lastScrollLeft = scrollLeft;
		$hScrollbar.value = factor;
		editor._emit("scroll", "horizontal");
	}

	/**
	 * Handles the scroll left event.
	 * Updates the horizontal scroll value and renders the horizontal scrollbar.
	 */
	function onscrollleft() {
		setHScrollValue();
		$hScrollbar.render();
	}

	/**
	 * Sets scrollbars value based on the editor's scroll position.
	 */
	function setVScrollValue() {
		if (preventScrollbarV) return;
		const session = editor.getSession();
		const scrollTop = session.getScrollTop();

		if (scrollTop === lastScrollTop) return;

		const editorHeight = getEditorHeight(editor);
		const factor = (scrollTop / editorHeight).toFixed(2);

		lastScrollTop = scrollTop;
		$vScrollbar.value = factor;
		editor._emit("scroll", "vertical");
	}

	/**
	 * Handles the scroll top event.
	 * Updates the vertical scroll value and renders the vertical scrollbar.
	 */
	function onscrolltop() {
		setVScrollValue();
		$vScrollbar.render();
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
	function toggleProblemButton() {
		const fileWithProblems = manager.files.find((file) => {
			if (file.type !== "editor") return false;
			const annotations = file?.session?.getAnnotations();
			return !!annotations.length;
		});

		if (fileWithProblems) {
			problemButton.show();
		} else {
			problemButton.hide();
		}
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

		editor.renderer.setMargin(top, bottom, left, right);

		if (!updateGutter) return;

		editor.setOptions({
			showGutter: linenumbers || showAnnotations,
			showLineNumbers: linenumbers,
		});
	}

	/**
	 * Switches the active file in the editor.
	 * @param {string} id - The ID of the file to switch to.
	 */
	function switchFile(id) {
		const { id: activeFileId } = manager.activeFile || {};
		if (activeFileId === id) return;

		const file = manager.getFile(id);

		manager.activeFile?.tab.classList.remove("active");

		// Hide previous content if it was non-editor
		if (manager.activeFile?.type !== "editor" && manager.activeFile?.content) {
			manager.activeFile.content.style.display = "none";
		}

		manager.activeFile = file;

		if (file.type === "editor") {
			editor.setSession(file.session);
			editor.setReadOnly(!file.editable || !!file.loading);
			$container.style.display = "block";

			$hScrollbar.hideImmediately();
			$vScrollbar.hideImmediately();

			setVScrollValue();
			if (!appSettings.value.textWrap) {
				setHScrollValue();
			}
		} else {
			$container.style.display = "none";
			if (file.content) {
				file.content.style.display = "block";
				if (!file.content.parentElement) {
					$container.parentElement.appendChild(file.content);
				}
			}
			if (manager.activeFile && manager.activeFile.type === "editor") {
				manager.activeFile.session.selection.clearSelection();
			}
		}

		file.tab.classList.add("active");
		file.tab.scrollIntoView();

		if (file?.hideQuickTools) {
			root.classList.add("hide-floating-button");
			actions("set-height", { height: 0, save: false });
		} else {
			root.classList.remove("hide-floating-button");
			const quickToolsHeight =
				appSettings.value.quickTools !== undefined
					? appSettings.value.quickTools
					: 1;
			actions("set-height", { height: quickToolsHeight, save: true });
		}

		$header.text = file.filename;
		manager.onupdate("switch-file");
		events.emit("switch-file", file);
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
	 * @param {AceAjax.Editor} editor
	 * @returns
	 */
	function getEditorHeight(editor) {
		const { renderer, session } = editor;
		const offset = (renderer.$size.scrollerHeight + renderer.lineHeight) * 0.5;
		const editorHeight =
			session.getScreenLength() * renderer.lineHeight - offset;
		return editorHeight;
	}

	/**
	 * Gets the height of the editor
	 * @param {AceAjax.Editor} editor
	 * @returns
	 */
	function getEditorWidth(editor) {
		const { renderer, session } = editor;
		const offset = renderer.$size.scrollerWidth - renderer.characterWidth;
		const editorWidth =
			session.getScreenWidth() * renderer.characterWidth - offset;
		if (appSettings.value.textWrap) {
			return editorWidth;
		} else {
			return editorWidth + appSettings.value.leftMargin;
		}
	}
}

export default EditorManager;
