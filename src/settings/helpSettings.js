import settingsPage from "components/settingsPage";
import constants from "lib/constants";

export default function help() {
	const title = strings.help;
	const items = [
		{
			key: "docs",
			text: strings.documentation,
			link: constants.DOCS_URL,
			chevron: true,
		},
		{
			key: "help",
			text: strings.help,
			link: constants.TELEGRAM_URL,
			chevron: true,
		},
		{
			key: "faqs",
			text: strings.faqs,
			link: `${constants.WEBSITE_URL}/faqs`,
			chevron: true,
		},
		{
			key: "bug_report",
			text: strings.bug_report,
			link: `${constants.GITHUB_URL}/issues`,
			chevron: true,
		},
	];

	const page = settingsPage(title, items, () => {}, "separate", {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		groupByDefault: true,
	});
	page.show();
}
