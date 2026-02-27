import "./customTheme.scss";

import Page from "components/page";
import color from "dialogs/color";
import confirm from "dialogs/confirm";
import select from "dialogs/select";
import actionStack from "lib/actionStack";
import settings from "lib/settings";
import ThemeBuilder from "theme/builder";
import themes from "theme/list";
import { isValidColor } from "utils/color/regex";
import helpers from "utils/helpers";

export default function CustomThemeInclude() {
	const theme = themes.get("custom");
	const $page = Page(`${strings["custom"]} ${strings["theme"]}`.capitalize());
	$page.header.append(
		<span
			attr-action="reset-theme"
			style={{ color: "red" }}
			className="icon historyrestore"
		></span>,
		<span attr-action="set-theme" className="icon check"></span>,
	);

	render();
	app.append($page);
	helpers.showAd();

	actionStack.push({
		id: "custom-theme",
		action: $page.hide,
	});

	$page.onhide = () => {
		actionStack.remove("custom-theme");
		helpers.hideAd();
	};

	$page.addEventListener("click", handleClick);

	/**
	 * Handle click event
	 * @param {MouseEvent | TouchEvent} e
	 */
	async function handleClick(e) {
		const $target = e.target;
		if ($target instanceof HTMLElement) {
			const action = $target.getAttribute("action");

			if (action === "set-theme") {
				try {
					theme.type = await select(strings["theme type"], [
						["light", strings["light"]],
						["dark", strings["dark"]],
					]);
					applyTheme();
				} catch (error) {
					console.warn("Unable to update custom theme type.", error);
				}
				return;
			}

			if (action === "reset-theme") {
				const confirmation = await confirm(
					strings["info"].toUpperCase(),
					strings["reset warning"],
				);
				if (!confirmation) return;
				settings.reset("customTheme");
				themes.update(ThemeBuilder.fromJSON(settings.value.customTheme));
				applyTheme();
				render();
			}
		}
	}

	function applyTheme() {
		setTimeout(() => {
			themes.apply("custom");
		}, 300);
	}

	function render() {
		const pascalToNormal = (str) =>
			str.replace(/([A-Z])/g, " $1").toLowerCase();
		const customTheme = themes.get("custom");

		$page.body = (
			<div id="custom-theme" className="main">
				<div className="list scroll">
					{Object.keys(customTheme.toJSON())
						.filter((key) => isValidColor(customTheme[key]))
						.map((key) => (
							<div
								className="list-item"
								tabindex={0}
								onclick={async (e) => {
									const newColor = await color(customTheme[key]);
									customTheme[key] = newColor;
									e.target.get(".icon").style.color = newColor;
								}}
							>
								<span
									style={{ color: customTheme[key] }}
									className="icon color"
								></span>
								<div className="container">
									<span className="text">{pascalToNormal(key)}</span>
								</div>
							</div>
						))}
				</div>
			</div>
		);
	}
}
