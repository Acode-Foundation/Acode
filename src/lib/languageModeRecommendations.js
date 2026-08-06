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

export function getLanguageModeRecommendationSearchKeyword(filename) {
	const basename = Path.basename(filename || "")
		.trim()
		.toLowerCase();
	const ext = Path.extname(basename).replace(/^\./, "").trim().toLowerCase();
	const keyword = ext || (basename.startsWith(".") ? basename.slice(1) : "");

	if (!/^[a-z0-9][a-z0-9._+-]*$/.test(keyword)) return "";

	return keyword;
}

function formatString(value, replacements) {
	return String(value || "").replace(/\{(\w+)\}/g, (_, key) => {
		return replacements[key] ?? "";
	});
}

async function openExtensions(keyword) {
	const { openWithSearch } = await import("sidebarApps/extensions");
	openWithSearch(keyword);
}

function hasPlainTextFallback(modeInfo, filename) {
	return modeInfo?.name === "text" && !modeInfo.supportsFile(filename);
}

export function shouldRecommendLanguageModeExtension(filename, modeInfo) {
	if (!hasPlainTextFallback(modeInfo, filename)) return false;

	const keyword = getLanguageModeRecommendationSearchKeyword(filename);
	if (!keyword) return false;

	// Probe the normalized extension independently of the original filename.
	// This prevents a strangely formatted path from producing requests for core
	// modes such as HTML or Python.
	const probeFilename = `file.${keyword}`;
	return hasPlainTextFallback(getModeForPath(probeFilename), probeFilename);
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
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Plugin registry request failed: ${response.status}`);
				}
				return response.json();
			})
			.then((plugins) => Array.isArray(plugins) && plugins.length > 0)
			.catch(() => {
				// Do not let a temporary network or server failure suppress this
				// recommendation for the rest of the app session.
				if (this.availabilityCache.get(keyword) === availability) {
					this.availabilityCache.delete(keyword);
				}
				return false;
			});

		this.availabilityCache.set(keyword, availability);
		return availability;
	}

	recommend(file, modeInfo) {
		if (!file || file.type !== "editor") return;

		const filename = file.filename || "";
		if (!shouldRecommendLanguageModeExtension(filename, modeInfo)) return;

		const keyword = getLanguageModeRecommendationSearchKeyword(filename);
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
		if (
			!shouldRecommendLanguageModeExtension(filename, getModeForPath(filename))
		) {
			return false;
		}

		// An unknown extension is not enough evidence that the file contains a
		// programming language. Stay silent unless the registry has a matching
		// language-mode plugin to recommend.
		if (!hasPlugins) return false;

		const displayExt = `.${keyword}`;
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
