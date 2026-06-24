import { getModeForPath } from "cm/modelist";
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
	pendingKeywords = new Set();
	availabilityCache = new Map();

	async getPluginAvailability(keyword) {
		if (this.availabilityCache.has(keyword)) {
			return this.availabilityCache.get(keyword);
		}

		const availability = fetch(
			withSupportedEditor(
				Url.join(
					config.API_BASE,
					`plugins?name=${encodeURIComponent(`mode:${keyword}`)}`,
				),
			),
		)
			.then((response) => (response.ok ? response.json() : []))
			.then((plugins) => Array.isArray(plugins) && plugins.length > 0)
			.catch(() => false);

		this.availabilityCache.set(keyword, availability);
		return availability;
	}

	recommend(file, modeInfo) {
		if (!file || file.type !== "editor") return;

		const filename = file.filename || "";
		if (!hasPlainTextFallback(modeInfo, filename)) return;

		const keyword = getSearchKeyword(filename);
		if (
			!keyword ||
			this.notifiedKeywords.has(keyword) ||
			this.pendingKeywords.has(keyword)
		) {
			return;
		}

		this.pendingKeywords.add(keyword);
		void this.showRecommendation(keyword, filename)
			.then((shown) => {
				if (shown) this.notifiedKeywords.add(keyword);
			})
			.catch((error) => {
				console.warn("Failed to show extension recommendation.", error);
			})
			.finally(() => {
				this.pendingKeywords.delete(keyword);
			});
	}

	async showRecommendation(keyword, filename) {
		const hasPlugins = await this.getPluginAvailability(keyword);
		// If a plugin registered the mode while the lookup was pending, suppress
		// this stale recommendation and leave the keyword eligible for future checks.
		if (!hasPlainTextFallback(getModeForPath(filename), filename)) return false;

		const displayExt = `.${keyword}`;

		if (hasPlugins) {
			notificationManager.pushNotification({
				title: formatString(strings["extension recommendation title"], {
					extension: displayExt,
					keyword: `mode:${keyword}`,
				}),
				message: formatString(strings["extension recommendation message"], {
					extension: displayExt,
					keyword: `mode:${keyword}`,
				}),
				icon: "extension",
				type: "info",
				action: () => openExtensions(`mode:${keyword}`),
				actions: [
					{
						text: strings["search plugins"],
						icon: "search",
						action: () => openExtensions(`mode:${keyword}`),
					},
				],
			});
			return true;
		}

		const issueUrl = getIssueUrl(keyword);
		notificationManager.pushNotification({
			title: formatString(strings["extension request title"], {
				extension: displayExt,
				keyword,
			}),
			message: formatString(strings["extension request message"], {
				extension: displayExt,
				keyword,
			}),
			icon: "extension",
			type: "warning",
			action: () => openUrl(issueUrl),
			actions: [
				{
					text: strings["request plugin"],
					icon: "open_in_new",
					action: () => openUrl(issueUrl),
				},
			],
		});
		return true;
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
