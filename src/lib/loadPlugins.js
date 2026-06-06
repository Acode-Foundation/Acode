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
const AUTO_DISABLED_PLUGINS = new Set();
const PLUGIN_LOAD_TIMEOUT = 15000;
const PLUGIN_DISABLE_TIMEOUT = 60000;

export default async function loadPlugins(loadOnlyTheme = false) {
	const plugins = await fsOperation(PLUGIN_DIR).lsDir();
	const results = [];

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

		const pluginState = { settled: false };

		try {
			const pluginLoadPromise = loadPlugin(pluginId)
				.then(() => {
					pluginState.settled = true;
					return markPluginLoaded(pluginId);
				})
				.catch(async (error) => {
					pluginState.settled = true;
					await markPluginBroken(pluginId, error);
					throw error;
				});

			// Let app startup continue if a plugin is slow, but keep loading it in
			// the background so good plugins on slower devices can still recover.
			await Promise.race([
				pluginLoadPromise,
				new Promise((_, rej) =>
					setTimeout(
						() => rej(new Error("Plugin load timeout")),
						PLUGIN_LOAD_TIMEOUT,
					),
				),
			]);
			results.push(true);
		} catch (error) {
			console.error(`Error loading plugin ${pluginId}:`, error);
			if (String(error.message || error) === "Plugin load timeout") {
				markPluginTimedOut(pluginId, pluginState);
			}
			results.push(false);
		}
	});

	await Promise.allSettled(loadPromises);

	acode[onPluginsLoadCompleteCallback]();
	return results.filter(Boolean).length;
}

async function markPluginLoaded(pluginId) {
	LOADED_PLUGINS.add(pluginId);
	acode[onPluginLoadCallback](pluginId);

	// clear broken mark if present
	if (BROKEN_PLUGINS.has(pluginId)) {
		BROKEN_PLUGINS.delete(pluginId);
	}

	if (AUTO_DISABLED_PLUGINS.has(pluginId)) {
		AUTO_DISABLED_PLUGINS.delete(pluginId);
		const disabledMap = { ...(settings.value.pluginsDisabled || {}) };
		delete disabledMap[pluginId];
		await settings.update({ pluginsDisabled: disabledMap }, false);
	}
}

async function markPluginBroken(pluginId, error) {
	// mark plugin as broken to avoid repeated attempts until user intervenes
	BROKEN_PLUGINS.set(pluginId, {
		error: String(error.message || error),
		timestamp: Date.now(),
	});

	const disabledMap = { ...(settings.value.pluginsDisabled || {}) };
	if (disabledMap[pluginId] === true) return;

	disabledMap[pluginId] = true;
	AUTO_DISABLED_PLUGINS.add(pluginId);
	await settings.update({ pluginsDisabled: disabledMap }, false);
}

function markPluginTimedOut(pluginId, pluginState) {
	BROKEN_PLUGINS.set(pluginId, {
		error: "Plugin load timeout",
		timestamp: Date.now(),
	});

	setTimeout(async () => {
		if (pluginState.settled || LOADED_PLUGINS.has(pluginId)) return;
		await markPluginBroken(pluginId, new Error("Plugin load timeout"));
	}, PLUGIN_DISABLE_TIMEOUT - PLUGIN_LOAD_TIMEOUT);
}

function isThemePlugin(pluginId) {
	// Convert to lowercase for case-insensitive matching
	const id = pluginId.toLowerCase();
	// Check if any theme identifier is present in the plugin ID
	return Array.from(THEME_IDENTIFIERS).some((theme) => id.includes(theme));
}
