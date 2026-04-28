import settingsPage from "components/settingsPage";
import config from "lib/config";

export default function help() {
	const title = strings.help;
	const items = [
		{
			key: "docs",
			text: strings.documentation,
			link: config.DOCS_URL,
			chevron: true,
		},
		{
			key: "help",
			text: strings.help,
			link: config.TELEGRAM_URL,
			chevron: true,
		},
		{
			key: "faqs",
			text: strings.faqs,
			link: `${config.BASE_URL}/faqs`,
			chevron: true,
		},
		{
			key: "bug_report",
			text: strings.bug_report,
			link: `${config.GITHUB_URL}/issues`,
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
