import "./themeSetting.scss";
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
	const $themePreview = <div id="theme-preview"></div>;
	const list = new Ref();
	const editor = ace.edit($themePreview);

	const session = ace.createEditSession("");
	const activeFile = editorManager.activeFile;

	if (activeFile && activeFile.type === "editor") {
		const currentSession = activeFile.session;
		session.setMode(currentSession.getMode());
		session.setValue(currentSession.getValue());
	} else {
		// Fallback content for preview
		session.setMode("ace/mode/javascript");
		session.setValue(`// Acode is awesome!
const message = "Welcome to Acode";
console.log(message);`);
	}

	editor.setReadOnly(true);
	editor.setSession(session);
	editor.renderer.setMargin(0, 0, -16, 0);

	actionStack.push({
		id: "appTheme",
		action: () => {
			editor.destroy();
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
		const currentTheme = appSettings.value.editorTheme;
		const themePrefix = "ace/theme/";
		const fullThemePath = currentTheme.startsWith(themePrefix)
			? currentTheme
			: themePrefix + currentTheme;

		editor.setTheme(fullThemePath);
		if (innerHeight * 0.3 >= 120) {
			$page.body.append($themePreview);
			editor.resize();
		} else {
			$themePreview.remove();
		}

		const themeList = ace.require("ace/ext/themelist");
		let $currentItem;
		list.el.content = themeList.themes.map((theme) => {
			const isCurrent = theme.theme === fullThemePath;
			const $item = (
				<Item
					name={theme.caption}
					isCurrent={isCurrent}
					isDark={theme.isDark}
					onclick={() => setEditorTheme(theme)}
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
		editorManager.editor.setTheme(theme);
		editor.setTheme(theme); // preview
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
		const check = <span ref={check} className="icon check"></span>;
		const star = <span ref={star} className="icon stars"></span>;
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
