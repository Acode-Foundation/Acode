import settingsPage from "components/settingsPage";
import constants from "lib/constants";

export default function help() {
	const title = strings.help;
	const items = [
		{
			key: "docs",
			text: strings.documentation,
			link: constants.DOCS_URL,
		},
		{
			key: "help",
			text: strings.help,
			link: constants.TELEGRAM_URL,
		},
		{
			key: "faqs",
			text: strings.faqs,
			link: `${constants.WEBSITE_URL}/faqs`,
		},
		{
			key: "bug_report",
			text: strings.bug_report,
			link: `${constants.GITHUB_URL}/issues`,
		},
	];

	const page = settingsPage(title, items, () => {}, "separate");
	page.show();
}
