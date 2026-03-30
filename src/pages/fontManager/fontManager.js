import "./style.scss";
import fsOperation from "fileSystem";
import Page from "components/page";
import searchBar from "components/searchbar";
import { DEFAULT_TERMINAL_SETTINGS } from "components/terminal";
import toast from "components/toast";
import box from "dialogs/box";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import { hideAd } from "lib/startAd";
import FileBrowser from "pages/fileBrowser";
import { updateActiveTerminals } from "settings/terminalSettings";
import helpers from "utils/helpers";
import Url from "utils/Url";

export default function fontManager() {
	const defaultEditorFont = "Roboto Mono";
	const defaultTerminalFont = DEFAULT_TERMINAL_SETTINGS.fontFamily;
	const defaultAppFontLabel = strings.default || "Default";
	const targetLabels = {
		app: "App",
		editor: "Editor",
		terminal: "Terminal",
		all: "All",
	};
	const $page = Page(strings.fonts?.capitalize());
	const $search = <span attr-action="search" className="icon search"></span>;
	const $addFont = <span attr-action="add-font" className="icon add"></span>;
	const list = Ref();
	$page.classList.add("font-manager-page");

	actionStack.push({
		id: "fontManager",
		action: () => {
			$page.hide();
			$page.removeEventListener("click", clickHandler);
		},
	});

	$page.onhide = () => {
		hideAd();
		actionStack.remove("fontManager");
	};

	$page.body = <div ref={list} className="main list font-manager-list"></div>;

	$page.querySelector("header").append($search, $addFont);

	app.append($page);
	renderFonts();
	helpers.showAd();

	$page.addEventListener("click", clickHandler);

	function renderFonts() {
		const fontNames = fonts.getNames();
		let $currentItem;
		const content = [];
		const defaultAppliedTargets = getAppliedTargets("");

		const $defaultItem = (
			<FontItem
				name={defaultAppFontLabel}
				appliedTargets={defaultAppliedTargets}
				subtitle="System default app font"
				deletable={false}
				onSelect={() => chooseApplyTarget("")}
			/>
		);
		if (defaultAppliedTargets.length) $currentItem = $defaultItem;
		content.push($defaultItem);

		fontNames.forEach((fontName) => {
			const appliedTargets = getAppliedTargets(fontName);
			const $item = (
				<FontItem
					name={fontName}
					appliedTargets={appliedTargets}
					deletable={fonts.isCustom(fontName)}
					onSelect={() => chooseApplyTarget(fontName)}
					onDelete={() => deleteFont(fontName)}
				/>
			);
			if (!$currentItem && appliedTargets.length) $currentItem = $item;
			content.push($item);
		});

		list.el.content = content;
		$currentItem?.scrollIntoView();
	}

	async function clickHandler(e) {
		const $target = e.target;
		if (!($target instanceof HTMLElement)) return;
		const action = $target.getAttribute("action") || $target.dataset.action;
		if (!action) return;

		switch (action) {
			case "search":
				searchBar(list.el);
				break;
			case "add-font":
				await addNewFont();
				break;
		}
	}

	async function addNewFont() {
		try {
			const { url, name } = await FileBrowser(
				"file",
				"Select font file (.ttf, .otf, .woff)",
				false,
			);

			// Check if file is a font file
			const ext = name.toLowerCase().split(".").pop();
			if (!["ttf", "otf", "woff", "woff2"].includes(ext)) {
				toast("Please select a valid font file (.ttf, .otf, .woff)");
				return;
			}

			const fontName = await prompt(
				"Font Name",
				name.replace(/\.(ttf|otf|woff|woff2)$/i, ""),
			);
			if (!fontName) return;

			// Check if font already exists
			if (fonts.get(fontName)) {
				toast("Font with this name already exists");
				return;
			}

			await addFontFromFile(fontName, url);
		} catch (error) {
			if (error.message !== "User cancelled") {
				toast("Failed to add font: " + error.message);
			}
		}
	}

	async function addFontFromFile(fontName, fontUrl) {
		try {
			// Download the font to local storage first
			loader.showTitleLoader();
			const FONT_DIR = Url.join(DATA_STORAGE, "fonts");
			const fontFileName = `${fontName.replace(/[^a-zA-Z0-9]/g, "_")}.ttf`;
			const FONT_FILE = Url.join(FONT_DIR, fontFileName);

			// Create fonts directory if it doesn't exist
			if (!(await fsOperation(FONT_DIR).exists())) {
				await fsOperation(DATA_STORAGE).createDirectory("fonts");
			}

			// Read and save the font file
			const fontData = await fsOperation(fontUrl).readFile();
			await fsOperation(FONT_DIR).createFile(fontFileName, fontData);

			// Get internal URI for the saved font
			const internalUrl = await helpers.toInternalUri(FONT_FILE);

			// Generate CSS for the font
			let css = `@font-face {
  font-family: '${fontName}';
  src: url(${internalUrl}) format('truetype');
  font-weight: normal;
  font-style: normal;
}`;

			loader.removeTitleLoader();

			// Show CSS preview/edit dialog
			const editedCSS = await showCSSEditor(css, fontName);
			if (editedCSS === null) return; // User cancelled

			// Add the font
			fonts.addCustom(fontName, editedCSS);
			renderFonts();
			toast(`Font "${fontName}" added successfully`);
		} catch (error) {
			loader.removeTitleLoader();
			toast("Failed to add font: " + error.message);
		}
	}

	async function showCSSEditor(css, fontName) {
		return new Promise((resolve) => {
			const htmlContent = `
				<div style="margin-bottom: 10px; font-size: 0.9em; opacity: 0.8;">
					Edit the CSS @font-face rule below:
				</div>
				<textarea 
					class="input font-css-editor" 
					placeholder="Enter CSS @font-face rule..."
					rows="8"
					style="font-family: ${appSettings.value.editorFont}, monospace; font-size: 0.85em; line-height: 1.4; resize: vertical;"
				>${css}</textarea>
			`;

			const dialog = box(
				`Edit CSS - ${fontName}`,
				htmlContent,
				"Save",
				"Cancel",
			)
				.then((children) => {
					const textarea = children[0].querySelector(".font-css-editor");
					if (textarea) {
						textarea.focus();
						textarea.select();
					}
				})
				.ok(() => {
					const textarea = document.querySelector(".font-css-editor");
					const value = textarea ? textarea.value : css;
					resolve(value);
					dialog.hide();
				})
				.cancel(() => {
					resolve(null);
					dialog.hide();
				});
		});
	}

	function getAppliedTargets(fontName) {
		const appFont = appSettings.value.appFont || "";
		const editorFont = appSettings.value.editorFont || defaultEditorFont;
		const terminalFont =
			appSettings.value.terminalSettings?.fontFamily || defaultTerminalFont;
		const appliedTargets = [];

		if (fontName) {
			if (appFont === fontName) appliedTargets.push("app");
			if (editorFont === fontName) appliedTargets.push("editor");
			if (terminalFont === fontName) appliedTargets.push("terminal");
			return appliedTargets;
		}

		if (!appFont) appliedTargets.push("app");
		return appliedTargets;
	}

	function getTargetOptionText(fontName, target) {
		if (fontName) {
			return `Apply to ${targetLabels[target]}`;
		}

		switch (target) {
			case "app":
				return "Reset App font";
			case "editor":
				return "Reset Editor font";
			case "terminal":
				return "Reset Terminal font";
			case "all":
				return "Reset all fonts";
			default:
				return "Reset font";
		}
	}

	async function chooseApplyTarget(fontName) {
		const title = fontName
			? `Apply "${fontName}"`
			: `${defaultAppFontLabel} font`;

		const target = await select(
			title,
			[
				["app", getTargetOptionText(fontName, "app")],
				["editor", getTargetOptionText(fontName, "editor")],
				["terminal", getTargetOptionText(fontName, "terminal")],
				["all", getTargetOptionText(fontName, "all")],
			],
			true,
		).catch(() => null);

		if (!target) return;

		await applyFontToTarget(fontName, target);
	}

	async function applyFontToTarget(fontName, target) {
		try {
			const nextEditorFont = fontName || defaultEditorFont;
			const nextTerminalFont = fontName || defaultTerminalFont;
			const nextTerminalSettings = {
				...(appSettings.value.terminalSettings || DEFAULT_TERMINAL_SETTINGS),
			};
			const nextSettings = {};

			switch (target) {
				case "app":
					await fonts.setAppFont(fontName);
					nextSettings.appFont = fontName;
					break;

				case "editor":
					await fonts.setEditorFont(nextEditorFont);
					nextSettings.editorFont = nextEditorFont;
					break;

				case "terminal":
					nextTerminalSettings.fontFamily = nextTerminalFont;
					nextSettings.terminalSettings = nextTerminalSettings;
					await updateActiveTerminals("fontFamily", nextTerminalFont);
					break;

				case "all":
					await fonts.setAppFont(fontName);
					await fonts.setEditorFont(nextEditorFont);
					nextTerminalSettings.fontFamily = nextTerminalFont;
					await updateActiveTerminals("fontFamily", nextTerminalFont);
					nextSettings.appFont = fontName;
					nextSettings.editorFont = nextEditorFont;
					nextSettings.terminalSettings = nextTerminalSettings;
					break;

				default:
					return;
			}

			await appSettings.update(nextSettings, false);
			toast(getApplyToast(fontName, target));
			renderFonts();
		} catch (error) {
			toast("Failed to apply font: " + error.message);
		}
	}

	function getApplyToast(fontName, target) {
		const label = fontName ? `"${fontName}"` : "default font";
		switch (target) {
			case "app":
				return `${label} applied to app`;
			case "editor":
				return `${label} applied to editor`;
			case "terminal":
				return `${label} applied to terminal`;
			case "all":
				return `${label} applied to app, editor, and terminal`;
			default:
				return "Font applied";
		}
	}

	async function deleteFont(fontName) {
		// Don't allow deleting default fonts
		if (!fonts.isCustom(fontName)) {
			toast("Cannot delete default fonts");
			return;
		}

		const shouldDelete = await confirm(
			"Delete Font",
			`Are you sure you want to delete "${fontName}"?`,
		);

		if (shouldDelete) {
			try {
				const currentEditorFont =
					appSettings.value.editorFont || defaultEditorFont;
				const currentAppFont = appSettings.value.appFont || "";
				const currentTerminalFont =
					appSettings.value.terminalSettings?.fontFamily || defaultTerminalFont;
				const isCurrentEditorFont = fontName === currentEditorFont;
				const isCurrentAppFont = fontName === currentAppFont;
				const isCurrentTerminalFont = fontName === currentTerminalFont;

				// Remove from fonts collection
				fonts.remove(fontName);

				// Try to delete the font file from storage
				const FONT_DIR = Url.join(DATA_STORAGE, "fonts");
				const fontFileName = `${fontName.replace(/[^a-zA-Z0-9]/g, "_")}.ttf`;
				const FONT_FILE = Url.join(FONT_DIR, fontFileName);

				const fs = fsOperation(FONT_FILE);
				if (await fs.exists()) {
					await fs.delete();
				}

				if (isCurrentAppFont) {
					await fonts.setAppFont("");
				}

				if (isCurrentEditorFont) {
					await fonts.setEditorFont(defaultEditorFont);
				}

				if (isCurrentTerminalFont) {
					await updateActiveTerminals("fontFamily", defaultTerminalFont);
				}

				if (isCurrentAppFont || isCurrentEditorFont || isCurrentTerminalFont) {
					await appSettings.update(
						{
							...(isCurrentAppFont ? { appFont: "" } : {}),
							...(isCurrentEditorFont ? { editorFont: defaultEditorFont } : {}),
							...(isCurrentTerminalFont
								? {
										terminalSettings: {
											...(appSettings.value.terminalSettings ||
												DEFAULT_TERMINAL_SETTINGS),
											fontFamily: defaultTerminalFont,
										},
									}
								: {}),
						},
						false,
					);
				}

				if (isCurrentAppFont || isCurrentEditorFont || isCurrentTerminalFont) {
					const restoredTargets = [
						isCurrentAppFont ? "app" : null,
						isCurrentEditorFont ? "editor" : null,
						isCurrentTerminalFont ? "terminal" : null,
					].filter(Boolean);
					toast(
						`Font "${fontName}" deleted, restored ${restoredTargets.join(", ")} font defaults`,
					);
				} else {
					toast(`Font "${fontName}" deleted`);
				}

				renderFonts();
			} catch (error) {
				// Font removed from collection even if file deletion fails
				const currentEditorFont =
					appSettings.value.editorFont || defaultEditorFont;
				const currentAppFont = appSettings.value.appFont || "";
				const currentTerminalFont =
					appSettings.value.terminalSettings?.fontFamily || defaultTerminalFont;
				const isCurrentEditorFont = fontName === currentEditorFont;
				const isCurrentAppFont = fontName === currentAppFont;
				const isCurrentTerminalFont = fontName === currentTerminalFont;

				if (isCurrentAppFont || isCurrentEditorFont || isCurrentTerminalFont) {
					try {
						if (isCurrentAppFont) {
							await fonts.setAppFont("");
						}
						if (isCurrentEditorFont) {
							await fonts.setEditorFont(defaultEditorFont);
						}
						if (isCurrentTerminalFont) {
							await updateActiveTerminals("fontFamily", defaultTerminalFont);
						}
						await appSettings.update(
							{
								...(isCurrentAppFont ? { appFont: "" } : {}),
								...(isCurrentEditorFont
									? { editorFont: defaultEditorFont }
									: {}),
								...(isCurrentTerminalFont
									? {
											terminalSettings: {
												...(appSettings.value.terminalSettings ||
													DEFAULT_TERMINAL_SETTINGS),
												fontFamily: defaultTerminalFont,
											},
										}
									: {}),
							},
							false,
						);
						toast(`Font "${fontName}" deleted (file cleanup may have failed)`);
					} catch (setFontError) {
						toast(
							`Font "${fontName}" deleted, but failed to restore a fallback font`,
						);
					}
				} else {
					toast(`Font "${fontName}" deleted (file cleanup may have failed)`);
				}

				renderFonts();
			}
		}
	}

	function FontItem({
		name,
		appliedTargets,
		subtitle,
		deletable = true,
		onSelect,
		onDelete,
	}) {
		const isBuiltIn = name !== defaultAppFontLabel && !fonts.isCustom(name);
		const isApplied = appliedTargets.length > 0;
		const resolvedSubtitle =
			subtitle ||
			(isApplied
				? "Applied font"
				: isBuiltIn
					? "Built-in font"
					: "Custom font");

		const $item = (
			<div
				tabIndex={1}
				className={`list-item has-subtitle ${isApplied ? "current-font" : ""}`}
				data-key={name}
				data-action="select-font"
			>
				<span className="icon text_format"></span>
				<div className="container">
					<div className="text">{name}</div>
					<small className="value">{resolvedSubtitle}</small>
				</div>
				{appliedTargets.length || deletable ? (
					<div className="setting-tail">
						{appliedTargets.map((target) => (
							<span
								key={`${name}-${target}`}
								className={`font-manager-badge font-manager-badge-${target}`}
							>
								{targetLabels[target]}
							</span>
						))}
						{deletable ? (
							<span
								className="icon delete font-manager-action"
								data-action="delete"
								title="Delete font"
							></span>
						) : null}
					</div>
				) : null}
			</div>
		);

		$item.onclick = (e) => {
			const $target = e.target;
			const action = $target.dataset.action;
			if (action === "delete" && deletable) {
				e.stopPropagation();
				onDelete();
			} else if (
				!$target.classList.contains("font-manager-action") ||
				action === "select-font"
			) {
				onSelect();
			}
		};

		return $item;
	}
}
