import settingsPage from "components/settingsPage";
import toast from "components/toast";
import defaultStrings from "lang/en-us.json";
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
			chevron: true,
		},
		{
			key: "bug_report",
			text: strings.bug_report,
			link: `${config.GITHUB_URL}/issues`,
			chevron: true,
		},
	];

	const page = settingsPage(title, items, onSelect, "separate", {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		groupByDefault: true,
	});
	let openingFaqs = false;
	let closed = false;
	page.onClose(() => {
		closed = true;
	});
	page.show();

	async function onSelect(key) {
		if (key !== "faqs" || openingFaqs || closed) return;
		openingFaqs = true;
		try {
			const { default: FAQs } = await import("pages/faqs/faqs");
			if (closed || !page.getListElement().isConnected) return;
			FAQs();
		} catch (error) {
			if (closed || !page.getListElement().isConnected) return;
			console.error("Unable to open FAQs", error);
			toast(strings["faqs load failed"] || defaultStrings["faqs load failed"]);
		} finally {
			openingFaqs = false;
		}
	}
}
