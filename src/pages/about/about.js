import "./about.scss";
import Page from "components/page";
import actionStack from "lib/actionStack";
import mustache from "mustache";
import helpers from "utils/helpers";
import _template from "./about.hbs";

export default function AboutInclude() {
	const $page = Page(strings.about.capitalize());

	system.getWebviewInfo(
		(res) => render(res),
		() => render(),
	);

	actionStack.push({
		id: "about",
		action: $page.hide,
	});

	$page.onhide = () => {
		actionStack.remove("about");
		helpers.hideAd();
	};

	app.append($page);
	helpers.showAd();

	function render(webview) {
		const $content = helpers.parseHTML(
			mustache.render(_template, {
				...BuildInfo,
				webview,
			}),
		);

		$page.classList.add("about-us");
		$page.body = $content;
	}
}
