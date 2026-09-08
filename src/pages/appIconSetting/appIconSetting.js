import "./appIconSetting.scss";
import Page from "components/page";
import loader from "dialogs/loader";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import createAppIconSelection from "lib/appIconSelection";
import { APP_ICONS } from "lib/appIcons";
import appSettings from "lib/settings";
import helpers from "utils/helpers";

export default function appIconSetting() {
	const title = strings["app icon"] || "App icon";
	const $page = Page(title);
	const $list = Ref();
	const controller = new AbortController();
	let busy = false;
	const selectIcon = createAppIconSelection({
		signal: controller.signal,
		onBusy(value) {
			busy = value;
			if (value) loader.showTitleLoader();
			else loader.removeTitleLoader();
			$list.el.setAttribute("aria-busy", String(value));
			for (const button of $list.el.querySelectorAll("button")) {
				button.disabled = value;
			}
		},
		onChange: renderIcons,
	});
	let resolve;
	$page.classList.add("app-icon-page");

	actionStack.push({
		id: "appIcon",
		action: () => {
			$page.hide();
		},
	});

	$page.onhide = () => {
		controller.abort();
		loader.removeTitleLoader();
		$page.removeEventListener("click", clickHandler);
		actionStack.remove("appIcon");
		resolve();
	};

	$page.body = <div ref={$list} className="app-icon-list list scroll"></div>;

	app.append($page);
	renderIcons();
	helpers.showAd();

	$page.addEventListener("click", clickHandler);

	return new Promise((res) => {
		resolve = res;
	});

	function renderIcons() {
		const current = appSettings.value.appIcon || "default";
		$list.el.content = APP_ICONS.map((icon) => {
			const isCurrent = icon.id === current;
			return (
				<button
					className={`app-icon-item ${isCurrent ? "current" : ""}`}
					data-icon={icon.id}
					type="button"
					disabled={busy}
					aria-pressed={String(isCurrent)}
				>
					<span className="app-icon-preview">
						<img src={icon.image} alt={icon.label} loading="lazy" />
					</span>
					<span className="app-icon-name">{icon.label}</span>
				</button>
			);
		});
	}

	async function clickHandler(e) {
		const $target = e.target.closest("[data-icon]");
		if (!$target) return;
		const iconId = $target.dataset.icon;
		await selectIcon(iconId);
	}
}
