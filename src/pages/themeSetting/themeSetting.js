import "./themeSetting.scss";
import { javascript } from "@codemirror/lang-javascript";
// For CodeMirror preview
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { getThemeConfig, getThemeExtensions, getThemes } from "cm/themes";
import { basicSetup, EditorView } from "codemirror";
import Page from "components/page";
import searchBar from "components/searchbar";
import TabView from "components/tabView";
import { TerminalThemeManager } from "components/terminal";
import alert from "dialogs/alert";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import config from "lib/config";
import removeAds from "lib/removeAds";
import appSettings from "lib/settings";
import { hideAd } from "lib/startAd";
import CustomTheme from "pages/customTheme";
import { updateActiveTerminals } from "settings/terminalSettings";
import ThemeBuilder from "theme/builder";
import themes from "theme/list";
import helpers from "utils/helpers";

export default function () {
	const $page = Page(strings.theme.capitalize());
	const $search = <span attr-action="search" className="icon search"></span>;
	const $themePreview = (
		<div
			id="theme-preview"
			style="min-height:120px;height:30vh;display:flex;"
		></div>
	);
	const list = new Ref();
	let cmPreview = null;
	const previewDoc = `// Acode is awesome!\nconst message = "Welcome to Acode";\nconsole.log(message);`;

	function destroyPreview(context) {
		if (!cmPreview) return;
		try {
			cmPreview.destroy();
		} catch (error) {
			console.warn(`Failed to destroy theme preview (${context}).`, error);
		} finally {
			cmPreview = null;
		}
	}

	function createPreview(themeId) {
		destroyPreview("create");
		$themePreview.innerHTML = "";
		const theme = getThemeExtensions(themeId, [oneDark]);
		const fixedHeightTheme = EditorView.theme({
			"&": { height: "100%", flex: "1 1 auto" },
			".cm-scroller": { height: "100%", overflow: "auto" },
		});
		const state = EditorState.create({
			doc: previewDoc,
			extensions: [basicSetup, javascript(), fixedHeightTheme, ...theme],
		});
		cmPreview = new EditorView({ state, parent: $themePreview });
		cmPreview.contentDOM.setAttribute("aria-readonly", "true");
	}

	actionStack.push({
		id: "appTheme",
		action: () => {
			destroyPreview("close");
			$page.hide();
			$page.removeEventListener("click", clickHandler);
		},
	});

	$page.onhide = () => {
		hideAd();
		actionStack.remove("appTheme");
	};

	$page.body = (
		<TabView id="theme-setting">
			<div className="options">
				<span className="active" onclick={renderAppThemes} tabindex={0}>
					App
				</span>
				<span onclick={renderEditorThemes} tabindex={0}>
					Editor
				</span>
				<span onclick={renderTerminalThemes} tabindex={0}>
					Terminal
				</span>
			</div>
			<div ref={list} id="theme-list" className="list scroll"></div>
		</TabView>
	);
	$page.querySelector("header").append($search);

	app.append($page);
	renderAppThemes();
	helpers.showAd();

	$page.addEventListener("click", clickHandler);

	function renderAppThemes() {
		// Remove and destroy CodeMirror preview when showing app themes
		destroyPreview("switch-tab");
		$themePreview.remove();
		const content = [];

		if (!DOES_SUPPORT_THEME) {
			content.push(
				<div className="list-item">
					<span className="icon warningreport_problem"></span>
					<div className="container">
						<span className="text">{strings["unsupported device"]}</span>
					</div>
				</div>,
			);
		}

		const currentTheme = appSettings.value.appTheme;
		let $currentItem;
		themes.list().forEach((themeSummary) => {
			const theme = themes.get(themeSummary.id);
			const isCurrentTheme = theme.id === currentTheme;
			const isPremium = theme.version === "paid" && !config.HAS_PRO;
			const $item = (
				<Item
					name={themeSummary.name}
					isPremium={isPremium}
					isCurrent={isCurrentTheme}
					swatches={getAppThemeSwatches(theme)}
					onclick={() => setAppTheme(theme, isPremium)}
				/>
			);
			content.push($item);
			if (isCurrentTheme) $currentItem = $item;
		});

		list.el.content = content;
		$currentItem?.scrollIntoView();
	}

	function renderEditorThemes() {
		const currentTheme = (
			appSettings.value.editorTheme || "one_dark"
		).toLowerCase();
		if (innerHeight * 0.3 >= 120) {
			$page.body.append($themePreview);
			createPreview(currentTheme);
		} else {
			$themePreview.remove();
		}

		const themeList = getThemes();
		let $currentItem;
		list.el.content = themeList.map((t) => {
			const isCurrent = t.id === currentTheme;
			const $item = (
				<Item
					name={t.caption}
					isCurrent={isCurrent}
					swatches={getEditorThemeSwatches(t.id)}
					onclick={() => setEditorTheme({ caption: t.caption, theme: t.id })}
				/>
			);
			if (isCurrent) $currentItem = $item;
			return $item;
		});
		$currentItem?.scrollIntoView();
	}

	function renderTerminalThemes() {
		destroyPreview("switch-tab");
		$themePreview.innerHTML = "";
		const currentTheme = appSettings.value.terminalSettings?.theme || "dark";

		if (innerHeight * 0.3 >= 120) {
			if (!$themePreview.parentElement) {
				$page.body.append($themePreview);
			}
			createTerminalPreview(currentTheme);
		} else {
			$themePreview.remove();
		}

		const themeNames = TerminalThemeManager.getThemeNames();
		let $currentItem;
		list.el.content = themeNames.map((name) => {
			const isCurrent = name === currentTheme;
			const themeObj = TerminalThemeManager.getTheme(name);
			const label = name.charAt(0).toUpperCase() + name.slice(1);
			const $item = (
				<Item
					name={label}
					isCurrent={isCurrent}
					swatches={[themeObj.background, themeObj.foreground, themeObj.cursor]}
					onclick={() => setTerminalTheme(name)}
				/>
			);
			if (isCurrent) $currentItem = $item;
			return $item;
		});
		$currentItem?.scrollIntoView();
	}

	function setTerminalTheme(name) {
		if (appSettings.value.appTheme?.toLowerCase() === "system") {
			alert(
				strings.info,
				"App theme is set to 'System'. Changing the terminal theme will not affect the terminal appearance.",
			);
			return;
		}

		const currentSettings = appSettings.value.terminalSettings || {};
		appSettings.update({
			terminalSettings: {
				...currentSettings,
				theme: name,
			},
		});
		if (editorManager != null) {
			updateActiveTerminals("theme", name);
		}
		if ($themePreview.parentElement) {
			createTerminalPreview(name);
		}
		const label = name.charAt(0).toUpperCase() + name.slice(1);
		updateCheckedItem(label);
	}

	function createTerminalPreview(themeName) {
		destroyPreview("create");
		const theme = TerminalThemeManager.getTheme(themeName);
		const ansiKeys = [
			"black",
			"red",
			"green",
			"yellow",
			"blue",
			"magenta",
			"cyan",
			"white",
			"brightBlack",
			"brightRed",
			"brightGreen",
			"brightYellow",
			"brightBlue",
			"brightMagenta",
			"brightCyan",
			"brightWhite",
		];
		const swatches = ansiKeys
			.map(
				(k) =>
					`<span class="ansi-swatch" style="background:${theme[k]};" title="${k}"></span>`,
			)
			.join("");

		$themePreview.innerHTML = `
			<div class="terminal-preview-content" style="background:${theme.background};color:${theme.foreground};">
				<div class="ansi-colors">${swatches}</div>
				<div class="terminal-line terminal-prompt">
					<span style="color:${theme.green}">user</span>
					<span style="color:${theme.foreground}">@</span>
					<span style="color:${theme.blue}">acode</span>
					<span style="color:${theme.foreground}">:~$ </span>
					<span>echo "Hello, Acode!"</span>
				</div>
				<div class="terminal-line terminal-output">Hello, Acode!</div>
				<div class="terminal-line terminal-prompt">
					<span style="color:${theme.green}">user</span>
					<span style="color:${theme.foreground}">@</span>
					<span style="color:${theme.blue}">acode</span>
					<span style="color:${theme.foreground}">:~$ </span>
					<span class="terminal-cursor" style="background:${theme.cursor};"></span>
				</div>
			</div>
		`;
	}

	/**
	 *
	 * @param {MouseEvent} e
	 */
	function clickHandler(e) {
		const $target = e.target;
		if (!($target instanceof HTMLElement)) return;
		const action = $target.getAttribute("action");
		if (!action) return;

		switch (action) {
			case "search":
				searchBar(list.el);
				break;

			default:
				break;
		}
	}

	/**
	 * Sets the selected theme
	 * @param {ThemeBuilder} theme
	 */
	async function setAppTheme(theme, buy) {
		if (!DOES_SUPPORT_THEME) return;

		if (buy) {
			try {
				await removeAds();
				renderAppThemes();
			} catch (e) {
				return;
			}
		}

		if (theme.id === "custom") {
			CustomTheme();
			return;
		}

		themes.apply(theme.id, true);
		updateCheckedItem(theme.name);
	}

	/**
	 * Sets the selected editor theme
	 * @param {object} param0
	 * @param {string} param0.theme
	 */
	function setEditorTheme({ caption, theme }) {
		if (appSettings.value.appTheme.toLowerCase() === "system") {
			alert(
				"Info",
				"App theme is set to 'System'. Changing the editor theme will not affect the editor appearance.",
			);
			return;
		}
		const ok = editorManager.editor.setTheme(theme);
		if (!ok) {
			alert(
				"Invalid theme",
				"This editor theme is not compatible with Acode's CodeMirror runtime.",
			);
			return;
		}
		if (cmPreview) createPreview(theme);
		appSettings.update(
			{
				editorTheme: theme,
			},
			false,
		);
		updateCheckedItem(caption);
	}

	/**
	 * Updates the checked item
	 * @param {string} theme
	 */
	function updateCheckedItem(theme) {
		list.get('[checked="true"]')?.uncheck();
		list.get(`[theme="${theme}"]`)?.check();
	}

	function Item({ name, swatches, onclick, isCurrent, isPremium }) {
		const check = <span className="icon check"></span>;
		const star = <span className="icon stars"></span>;

		const $el = (
			<div
				attr-checked={isCurrent}
				attr-theme={name}
				className="list-item"
				onclick={onclick}
			>
				{createSwatchPreview(swatches)}
				<div className="container">
					<span className="text">{name}</span>
				</div>
				{isCurrent && check}
				{isPremium && star}
			</div>
		);

		$el.uncheck = () => {
			check.remove();
			$el.removeAttribute("checked");
		};
		$el.check = () => {
			$el.append(check);
			$el.setAttribute("checked", true);
		};
		return $el;
	}

	function createSwatchPreview(swatches) {
		const colors = [...new Set((swatches || []).filter(Boolean))].slice(0, 3);
		while (colors.length < 3) {
			colors.push(colors[colors.length - 1] || "var(--border-color)");
		}

		return (
			<div className="theme-swatch-slot" aria-hidden="true">
				<div className="theme-swatch-preview">
					<span
						className="theme-swatch theme-swatch-main"
						style={{ backgroundColor: colors[0] }}
					></span>
					<span
						className="theme-swatch"
						style={{ backgroundColor: colors[1] }}
					></span>
					<span
						className="theme-swatch"
						style={{ backgroundColor: colors[2] }}
					></span>
				</div>
			</div>
		);
	}

	function getAppThemeSwatches(theme) {
		if (!theme) {
			return [
				"var(--primary-color)",
				"var(--secondary-color)",
				"var(--active-color)",
			];
		}

		return [theme.primaryColor, theme.secondaryColor, theme.activeColor];
	}

	function getEditorThemeSwatches(themeId) {
		const config = getThemeConfig(themeId);
		return [
			config.background,
			config.keyword || config.function || config.foreground,
			config.string || config.variable || config.foreground,
		];
	}
}
