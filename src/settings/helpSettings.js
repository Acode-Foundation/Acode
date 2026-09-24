import settingsPage from "components/settingsPage";
import config from "lib/config";

/**
 * Build a prefilled GitHub issue URL for support tickets / bug reports.
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
export function buildTicketUrl(title, body) {
	const params = new URLSearchParams({ title, body });
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

function bugReportBody() {
	return [
		"### Describe the bug",
		"",
		"A clear description of what went wrong.",
		"",
		"### Steps to reproduce",
		"",
		"1.",
		"2.",
		"3.",
		"",
		"### Expected behavior",
		"",
		"",
		"### Environment",
		"",
		"```",
		getTicketEnvironment(),
		"```",
		"",
		"### Additional context",
		"",
		"Logs, screenshots, or a screen recording (optional).",
	].join("\n");
}

function featureRequestBody() {
	return [
		"### Feature request",
		"",
		"Describe the feature and why it would help.",
		"",
		"### Proposed solution",
		"",
		"",
		"### Alternatives considered",
		"",
		"",
		"### Environment",
		"",
		"```",
		getTicketEnvironment(),
		"```",
	].join("\n");
}

function questionBody() {
	return [
		"### Question",
		"",
		"Ask anything about using Acode.",
		"",
		"### What you already tried",
		"",
		"",
		"### Environment",
		"",
		"```",
		getTicketEnvironment(),
		"```",
	].join("\n");
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
			link: buildTicketUrl("", ""),
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
			key: "feature_request",
			text: strings["support-feature-request"] || "Request a feature",
			info:
				strings["support-feature-request-info"] ||
				"Suggest an improvement for Acode.",
			link: buildTicketUrl("[Feature]: ", featureRequestBody()),
			chevron: true,
		},
		{
			key: "question",
			text: strings["support-question"] || "Ask a question",
			info:
				strings["support-question-info"] ||
				"Get help from the community and maintainers.",
			link: buildTicketUrl("[Question]: ", questionBody()),
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
			key: "bug_report",
			text: strings.bug_report,
			link: buildTicketUrl("[Bug]: ", bugReportBody()),
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
