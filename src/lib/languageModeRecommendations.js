import notificationManager from "lib/notificationManager";
import Path from "utils/Path";
import Url from "utils/Url";
import config from "./config";

let instance = null;

function withSupportedEditor(url) {
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}supported_editor=${config.SUPPORTED_EDITOR}`;
}

function getSearchKeyword(filename) {
	const ext = Path.extname(filename || "")
		.replace(/^\./, "")
		.trim()
		.toLowerCase();

	if (!/^[a-z0-9][a-z0-9._+-]*$/.test(ext)) return "";

	return ext;
}

function getIssueUrl(keyword) {
	const params = new URLSearchParams({
		template: "1_feature_request.yml",
		labels: "new plugin idea,enhancement",
		title: `Plugin request: ${keyword} syntax highlighting`,
	});

	return `${config.GITHUB_URL}/issues/new?${params}`;
}

function formatString(value, replacements) {
	return String(value || "").replace(/\{(\w+)\}/g, (_, key) => {
		return replacements[key] ?? "";
	});
}

async function openUrl(url) {
	if (window.cordova?.exec) {
		const { default: customTab } = await import("./customTab");
		await customTab(url);
		return;
	}

	window.open(url, "_blank", "noopener,noreferrer");
}

async function openExtensions(keyword) {
	const { openWithSearch } = await import("sidebarApps/extensions");
	openWithSearch(keyword);
}

function hasPlainTextFallback(modeInfo, filename) {
	return modeInfo?.name === "text" && !modeInfo.supportsFile(filename);
}

class LanguageModeRecommendations {
	notifiedKeywords = new Set();
	availabilityCache = new Map();

	async getPluginAvailability(keyword) {
		if (this.availabilityCache.has(keyword)) {
			return this.availabilityCache.get(keyword);
		}

		const availability = fetch(
			withSupportedEditor(
				Url.join(
					config.API_BASE,
					`plugins?name=${encodeURIComponent(keyword)}`,
				),
			),
		)
			.then((response) => response.json())
			.then((plugins) => Array.isArray(plugins) && plugins.length > 0)
			.catch(() => true);

		this.availabilityCache.set(keyword, availability);
		return availability;
	}

	recommend(file, modeInfo) {
		if (!file || file.type !== "editor") return;

		const filename = file.filename || "";
		if (!hasPlainTextFallback(modeInfo, filename)) return;

		const keyword = getSearchKeyword(filename);
		if (!keyword || this.notifiedKeywords.has(keyword)) return;

		this.notifiedKeywords.add(keyword);

		void this.showRecommendation(keyword);
	}

	async showRecommendation(keyword) {
		const hasPlugins = await this.getPluginAvailability(keyword);
		const displayExt = `.${keyword}`;

		if (hasPlugins) {
			notificationManager.pushNotification({
				title: formatString(
					strings["extension recommendation title"] ||
						"Extensions available for {extension}",
					{ extension: displayExt, keyword },
				),
				message: formatString(
					strings["extension recommendation message"] ||
						'No syntax mode is installed for {extension}. Search plugins for "{keyword}".',
					{ extension: displayExt, keyword },
				),
				icon: "extension",
				type: "info",
				action: () => openExtensions(keyword),
				actions: [
					{
						text: strings["search plugins"] || "Search plugins",
						icon: "search",
						action: () => openExtensions(keyword),
					},
				],
			});
			return;
		}

		const issueUrl = getIssueUrl(keyword);
		notificationManager.pushNotification({
			title: formatString(
				strings["extension request title"] ||
					"No extension found for {extension}",
				{ extension: displayExt, keyword },
			),
			message: formatString(
				strings["extension request message"] ||
					"Ask for a plugin so Acode can highlight this file type.",
				{ extension: displayExt, keyword },
			),
			icon: "extension",
			type: "warning",
			action: () => openUrl(issueUrl),
			actions: [
				{
					text: strings["request plugin"] || "Request plugin",
					icon: "open_in_new",
					action: () => openUrl(issueUrl),
				},
			],
		});
	}
}

function getLanguageModeRecommendations() {
	if (!instance) {
		instance = new LanguageModeRecommendations();
	}

	return instance;
}

export default function recommendLanguageModeExtension(file, modeInfo) {
	getLanguageModeRecommendations().recommend(file, modeInfo);
}
