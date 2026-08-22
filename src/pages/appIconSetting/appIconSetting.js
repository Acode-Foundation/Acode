import "./appIconSetting.scss";
import Page from "components/page";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import { APP_ICONS, getAppIconLabel } from "lib/appIcons";
import appSettings from "lib/settings";
import helpers from "utils/helpers";

export default function appIconSetting() {
	const title = strings["app icon"] || "App icon";
	const $page = Page(title);
	const $list = Ref();
	let resolve;
	$page.classList.add("app-icon-page");

	actionStack.push({
		id: "appIcon",
		action: () => {
			$page.hide();
			$page.removeEventListener("click", clickHandler);
		},
	});

	$page.onhide = () => {
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

	async function selectIcon(iconId) {
		const current = appSettings.value.appIcon || "default";

		if (iconId === current) return;

		try {
			await new Promise((resolve, reject) => {
				system.setAppIcon(
					iconId,
					async () => {
						try {
							await appSettings.update({ appIcon: iconId });
							renderIcons();
							resolve();
						} catch (error) {
							reject(error);
						}
					},
					(error) => {
						reject(error);
					},
				);
			});
		} catch (error) {
			helpers.error(error);
		}
	}
}
