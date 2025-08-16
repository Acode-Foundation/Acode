import "./style.scss";
import fsOperation from "fileSystem";
import Page from "components/page";
import searchBar from "components/searchbar";
import toast from "components/toast";
import alert from "dialogs/alert";
import box from "dialogs/box";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import prompt from "dialogs/prompt";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";
import Url from "utils/Url";

export default function fontManager() {
	const defaultFont = "Roboto Mono";
	const $page = Page(strings.fonts?.capitalize());
	const $search = <span attr-action="search" className="icon search"></span>;
	const $addFont = <span attr-action="add-font" className="icon add"></span>;
	const list = Ref();

	actionStack.push({
		id: "fontManager",
		action: () => {
			$page.hide();
			$page.removeEventListener("click", clickHandler);
		},
	});

	$page.onhide = () => {
		helpers.hideAd();
		actionStack.remove("fontManager");
	};

	$page.body = <div ref={list} className="main list"></div>;

	$page.querySelector("header").append($search, $addFont);

	app.append($page);
	renderFonts();
	helpers.showAd();

	$page.addEventListener("click", clickHandler);

	function renderFonts() {
		const fontNames = fonts.getNames();
		const currentFont = appSettings.value.editorFont || "Roboto Mono";
		let $currentItem;

		const content = fontNames.map((fontName) => {
			const isCurrent = fontName === currentFont;
			const $item = (
				<FontItem
					name={fontName}
					isCurrent={isCurrent}
					onSelect={() => selectFont(fontName)}
					onDelete={() => deleteFont(fontName)}
				/>
			);
			if (isCurrent) $currentItem = $item;
			return $item;
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

	async function selectFont(fontName) {
		try {
			await fonts.setFont(fontName);
			appSettings.update({ editorFont: fontName }, false);
			toast(`Font changed to "${fontName}"`);
			renderFonts(); // Refresh to update current selection
		} catch (error) {
			toast("Failed to set font: " + error.message);
		}
	}

	async function deleteFont(fontName) {
		// Don't allow deleting default fonts
		const defaultFonts = ["Fira Code", "Roboto Mono", "MesloLGS NF Regular"];
		if (defaultFonts.includes(fontName)) {
			toast("Cannot delete default fonts");
			return;
		}

		const shouldDelete = await confirm(
			"Delete Font",
			`Are you sure you want to delete "${fontName}"?`,
		);

		if (shouldDelete) {
			try {
				// Check if we're deleting the currently active font
				const currentFont = appSettings.value.editorFont || "Roboto Mono";
				const isCurrentFont = fontName === currentFont;

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

				// If we deleted the current font, switch to default font (Roboto Mono)
				if (isCurrentFont) {
					await fonts.setFont(defaultFont);
					appSettings.update({ editorFont: defaultFont }, false);
					toast(`Font "${fontName}" deleted, switched to ${defaultFont}`);
				} else {
					toast(`Font "${fontName}" deleted`);
				}

				renderFonts();
			} catch (error) {
				// Font removed from collection even if file deletion fails
				const currentFont = appSettings.value.editorFont || "Roboto Mono";
				const isCurrentFont = fontName === currentFont;

				// If we deleted the current font, switch to default font (Roboto Mono)
				if (isCurrentFont) {
					try {
						await fonts.setFont(defaultFont);
						appSettings.update({ editorFont: defaultFont }, false);
						toast(
							`Font "${fontName}" deleted, switched to ${defaultFont} (file cleanup may have failed)`,
						);
					} catch (setFontError) {
						toast(
							`Font "${fontName}" deleted, but failed to switch to ${defaultFont}`,
						);
					}
				} else {
					toast(`Font "${fontName}" deleted (file cleanup may have failed)`);
				}

				renderFonts();
			}
		}
	}

	function FontItem({ name, isCurrent, onSelect, onDelete }) {
		const defaultFonts = ["Fira Code", "Roboto Mono", "MesloLGS NF Regular"];
		const isDefault = defaultFonts.includes(name);

		const $item = (
			<div
				tabIndex={1}
				className={`list-item ${isCurrent ? "current-font" : ""}`}
				data-key={name}
				data-action="select-font"
			>
				<span className="icon text_format"></span>
				<div className="container">
					<div className="text">{name}</div>
				</div>
				<span
					className={`icon delete ${isDefault ? "disabled" : ""}`}
					data-action="delete"
					title={isDefault ? "Cannot delete default font" : "Delete font"}
				></span>
			</div>
		);

		$item.onclick = (e) => {
			const action = e.target.dataset.action;
			if (action === "delete" && !isDefault) {
				e.stopPropagation();
				onDelete();
			} else if (
				!e.target.classList.contains("icon") ||
				action === "select-font"
			) {
				onSelect();
			}
		};

		return $item;
	}
}
