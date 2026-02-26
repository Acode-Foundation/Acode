import "./themeSetting.scss";
import { javascript } from "@codemirror/lang-javascript";
// For CodeMirror preview
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { getThemeExtensions, getThemes } from "cm/themes";
import { basicSetup, EditorView } from "codemirror";
import Page from "components/page";
import searchBar from "components/searchbar";
import TabView from "components/tabView";
import alert from "dialogs/alert";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import removeAds from "lib/removeAds";
import appSettings from "lib/settings";
import CustomTheme from "pages/customTheme";
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
	function createPreview(themeId) {
		if (cmPreview) {
			cmPreview.destroy();
			cmPreview = null;
		}
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
			try {
				cmPreview?.destroy();
			} catch (_) {}
			$page.hide();
			$page.removeEventListener("click", clickHandler);
		},
	});

	$page.onhide = () => {
		helpers.hideAd();
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
		try {
			cmPreview?.destroy();
		} catch (_) {}
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
		themes.list().forEach((theme) => {
			const isCurrentTheme = theme.id === currentTheme;
			const isPremium = theme.version === "paid" && IS_FREE_VERSION;
			const $item = (
				<Item
					name={theme.name}
					isPremium={isPremium}
					isCurrent={isCurrentTheme}
					color={theme.primaryColor}
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
					isDark={t.isDark}
					onclick={() => setEditorTheme({ caption: t.caption, theme: t.id })}
				/>
			);
			if (isCurrent) $currentItem = $item;
			return $item;
		});
		$currentItem?.scrollIntoView();
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

	function Item({ name, color, isDark, onclick, isCurrent, isPremium }) {
		const check = <span className="icon check"></span>;
		const star = <span className="icon stars"></span>;
		let style = {};
		let className = "icon color";

		if (color) {
			style = { color };
		} else if (isDark) {
			className += " dark";
		} else {
			className += " light";
		}

		const $el = (
			<div
				attr-checked={isCurrent}
				attr-theme={name}
				className="list-item"
				onclick={onclick}
			>
				<span style={style} className={className}></span>
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
}
