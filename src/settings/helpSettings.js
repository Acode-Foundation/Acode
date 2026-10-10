import settingsPage from "components/settingsPage";
import config from "lib/config";

const BUG_TEMPLATE = "0_bug_report.yml";
const FEATURE_TEMPLATE = "1_feature_request.yml";
const DISCUSSIONS_URL = `${config.GITHUB_URL}/discussions`;
const CHOOSE_ISSUE_URL = `${config.GITHUB_URL}/issues/new/choose`;

/**
 * Build a GitHub issue URL that opens a repository issue-form template.
 * Blank issues are disabled on this repo, so links must select a template.
 * @param {string} template - Issue template file name under .github/ISSUE_TEMPLATE
 * @param {Record<string, string>} [fields] - Prefilled form fields (by id/title)
 * @returns {string}
 */
export function buildTicketUrl(template, fields = {}) {
	const params = new URLSearchParams({ template });
	for (const [key, value] of Object.entries(fields)) {
		if (value) params.set(key, value);
	}
	return `${config.GITHUB_URL}/issues/new?${params.toString()}`;
}

/**
 * Device/app details appended to support tickets so maintainers can debug faster.
 * @param {string} eol
 * @returns {string}
 */
export function getTicketEnvironment(eol = "\n") {
	const buildInfo = window.BuildInfo || {};
	const device = window.device || {};
	return [
		`Version: ${buildInfo.version || "?"} (${buildInfo.versionCode || "?"})`,
		`Device: ${device.model || "unknown"}`,
		`Manufacturer: ${device.manufacturer || "unknown"}`,
		`Android: ${device.version || "unknown"}`,
	].join(eol);
}

export default function help() {
	const title = strings.support || "Support";
	const items = [
		{
			key: "new_ticket",
			text: strings["support-new-ticket"] || "Open a support ticket",
			info:
				strings["support-new-ticket-info"] ||
				"Report a bug or request a feature on GitHub.",
			link: CHOOSE_ISSUE_URL,
			chevron: true,
		},
		{
			key: "bug_report",
			text: strings.bug_report,
			info:
				strings["support-new-ticket-info"] ||
				"Report a bug or request a feature on GitHub.",
			link: buildTicketUrl(BUG_TEMPLATE, {
				environment: getTicketEnvironment("\n"),
			}),
			chevron: true,
		},
		{
			key: "feature_request",
			text: strings["support-feature-request"] || "Request a feature",
			info:
				strings["support-feature-request-info"] ||
				"Suggest an improvement for Acode.",
			link: buildTicketUrl(FEATURE_TEMPLATE),
			chevron: true,
		},
		{
			key: "view_tickets",
			text: strings["support-view-tickets"] || "View existing tickets",
			info:
				strings["support-view-tickets-info"] ||
				"Browse open and closed issues on GitHub.",
			link: `${config.GITHUB_URL}/issues`,
			chevron: true,
		},
		{
			key: "question",
			text: strings["support-question"] || "Ask a question",
			info:
				strings["support-question-info"] ||
				"Get help from the community and maintainers.",
			link: DISCUSSIONS_URL,
			chevron: true,
		},
		{
			key: "contact_support",
			text: strings["support-contact"] || "Contact support",
			info:
				strings["support-contact-info"] ||
				"Email the team for private or account issues.",
			link: `mailto:${config.FEEDBACK_EMAIL}?subject=${encodeURIComponent(
				"support - Acode editor",
			)}&body=${encodeURIComponent(getTicketEnvironment("\n"))}`,
			chevron: true,
		},
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
	];

	const page = settingsPage(title, items, () => {}, "separate", {
		preserveOrder: true,
		pageClassName: "detail-settings-page support-settings-page",
		listClassName: "detail-settings-list",
		groupByDefault: true,
	});
	page.show();
}
