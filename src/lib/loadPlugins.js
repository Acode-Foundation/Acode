import fsOperation from "../fileSystem";
import Url from "../utils/Url";
import loadPlugin from "./loadPlugin";

export default async function loadPlugins() {
	const plugins = await fsOperation(PLUGIN_DIR).lsDir();
	const results = [];
	const failedPlugins = [];

	if (plugins.length > 0) {
		toast(strings["loading plugins"]);
	}

	// Load plugins concurrently
	const loadPromises = plugins.map(async (pluginDir) => {
		const pluginId = Url.basename(pluginDir.url);
		try {
			await loadPlugin(pluginId);
			results.push(true);
		} catch (error) {
			window.log("error", `Failed to load plugin: ${pluginId}`);
			window.log("error", error);
			toast(`Failed to load plugin: ${pluginId}`);
			failedPlugins.push(pluginId);
			results.push(false);
		}
	});

	await Promise.allSettled(loadPromises);
	if (failedPlugins.length > 0) {
		setTimeout(() => {
			cleanupFailedPlugins(failedPlugins).catch((error) => {
				console.error("Failed to cleanup plugins:", error);
			});
		}, 1000);
	}
	return results.filter(Boolean).length;
}

async function cleanupFailedPlugins(pluginIds) {
	for (const pluginId of pluginIds) {
		try {
			const pluginDir = Url.join(PLUGIN_DIR, pluginId);
			if (await fsOperation(pluginDir).exists()) {
				await fsOperation(pluginDir).delete();
			}
		} catch (error) {
			window.log("error", `Failed to cleanup plugin ${pluginId}:`, error);
		}
	}
}
