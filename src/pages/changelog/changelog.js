import "./style.scss";
import Page from "components/page";
import actionStack from "lib/actionStack";
import markdownIt from "markdown-it";
import markdownItTaskLists from "markdown-it-task-lists";
import helpers from "utils/helpers";

export default async function Changelog() {
	const CHANGELOG_URL =
		"https://raw.githubusercontent.com/deadlyjack/Acode/main/CHANGELOG.md";
	const $page = Page(strings["changelog"]);
	const $content = <div className="md" id="changelog"></div>;

	$content.innerHTML = '<div class="loading">Loading changelog...</div>';

	$page.content = $content;
	app.append($page);

	try {
		const changeLog = await fetch(CHANGELOG_URL);
		const changeLogText = await changeLog.text();

		const cleanedText = changeLogText.replace(/^#\s*Change\s*Log\s*\n*/i, "");

		const htmlContent = markdownIt({ html: true })
			.use(markdownItTaskLists)
			.render(cleanedText);

		$content.innerHTML = htmlContent;
	} catch (error) {
		$content.innerHTML = '<div class="error">Failed to load changelog</div>';
	}

	$page.onhide = () => {
		actionStack.remove("changelog");
	};

	actionStack.push({
		id: "changelog",
		action: $page.hide,
	});
}
