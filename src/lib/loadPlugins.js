import fsOperation from "../fileSystem";
import Url from "../utils/Url";
import loadPlugin from "./loadPlugin";
import settings from "./settings";

// theme-related keywords for determining theme plugins
const THEME_IDENTIFIERS = new Set([
	"theme",
	"catppuccin",
	"pine",
	"githubdark",
	"radiant",
	"rdtheme",
	"ayumirage",
	"dust",
	"synthwave",
	"dragon",
	"mint",
	"monokai",
	"lumina_code",
	"sweet",
	"moonlight",
	"bluloco",
	"acode.plugin.extra_syntax_highlights",
	"documentsviewer",
]);

export const onPluginLoadCallback = Symbol("onPluginLoadCallback");
export const onPluginsLoadCompleteCallback = Symbol(
	"onPluginsLoadCompleteCallback",
);

export const LOADED_PLUGINS = new Set();
export const BROKEN_PLUGINS = new Map();

export default async function loadPlugins(loadOnlyTheme = false) {
	const plugins = await fsOperation(PLUGIN_DIR).lsDir();
	const results = [];
	const failedPlugins = [];

	if (plugins.length > 0) {
		toast(strings["loading plugins"]);
	}

	let pluginsToLoad = [];
	const currentTheme = settings.value.appTheme;
	const enabledMap = settings.value.pluginsDisabled || {};

	if (loadOnlyTheme) {
		// Only load theme plugins matching current theme
		pluginsToLoad = plugins.filter((pluginDir) => {
			const pluginId = Url.basename(pluginDir.url);
			// Skip already loaded and plugins that were previously marked broken
			return (
				isThemePlugin(pluginId) &&
				!LOADED_PLUGINS.has(pluginId) &&
				!BROKEN_PLUGINS.has(pluginId)
			);
		});
	} else {
		// Load non-theme plugins that aren't loaded yet and are enabled
		pluginsToLoad = plugins.filter((pluginDir) => {
			const pluginId = Url.basename(pluginDir.url);
			// Skip theme plugins, already loaded, disabled or previously marked broken
			return (
				!isThemePlugin(pluginId) &&
				!LOADED_PLUGINS.has(pluginId) &&
				enabledMap[pluginId] !== true &&
				!BROKEN_PLUGINS.has(pluginId)
			);
		});
	}

	// Load plugins concurrently
	const LOAD_TIMEOUT = 15000; // ms per plugin
	const loadPromises = pluginsToLoad.map(async (pluginDir) => {
		const pluginId = Url.basename(pluginDir.url);

		if (loadOnlyTheme && currentTheme) {
			const pluginIdLower = pluginId.toLowerCase();
			const currentThemeLower = currentTheme.toLowerCase();
			const matchFound = pluginIdLower.includes(currentThemeLower);
			// Skip if:
			// 1. No match found with current theme AND
			// 2. It's not a theme plugin at all
			if (!matchFound && !isThemePlugin(pluginId)) {
				return;
			}
		}

		try {
			// ensure loadPlugin doesn't hang: timeout wrapper
			await Promise.race([
				loadPlugin(pluginId),
				new Promise((_, rej) =>
					setTimeout(() => rej(new Error("Plugin load timeout")), LOAD_TIMEOUT),
				),
			]);
			LOADED_PLUGINS.add(pluginId);

			acode[onPluginLoadCallback](pluginId);

			results.push(true);
			// clear broken mark if present
			if (BROKEN_PLUGINS.has(pluginId)) {
				BROKEN_PLUGINS.delete(pluginId);
			}
		} catch (error) {
			console.error(`Error loading plugin ${pluginId}:`, error);
			// mark plugin as broken to avoid repeated attempts until user intervenes
			BROKEN_PLUGINS.set(pluginId, {
				error: String(error.message || error),
				timestamp: Date.now(),
			});
			failedPlugins.push(pluginId);
			results.push(false);
		}
	});

	await Promise.allSettled(loadPromises);

	acode[onPluginsLoadCompleteCallback]();

	if (failedPlugins.length > 0) {
		setTimeout(() => {
			cleanupFailedPlugins(failedPlugins).catch((error) => {
				console.error("Failed to cleanup plugins:", error);
			});
		}, 1000);
	}
	return results.filter(Boolean).length;
}

function isThemePlugin(pluginId) {
	// Convert to lowercase for case-insensitive matching
	const id = pluginId.toLowerCase();
	// Check if any theme identifier is present in the plugin ID
	return Array.from(THEME_IDENTIFIERS).some((theme) => id.includes(theme));
}

async function cleanupFailedPlugins(pluginIds) {
	for (const pluginId of pluginIds) {
		try {
			const pluginDir = Url.join(PLUGIN_DIR, pluginId);
			if (await fsOperation(pluginDir).exists()) {
				await fsOperation(pluginDir).delete();
			}
		} catch (error) {
			console.error(`Failed to cleanup plugin ${pluginId}:`, error);
		}
	}
}
