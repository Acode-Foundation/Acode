import fsOperation from "fileSystem";
import Page from "components/page";
import helpers from "utils/helpers";
import Url from "utils/Url";
import actionStack from "./actionStack";

export default async function loadPlugin(pluginId, justInstalled = false) {
	const baseUrl = await helpers.toInternalUri(Url.join(PLUGIN_DIR, pluginId));
	const cacheFile = Url.join(CACHE_STORAGE, pluginId);

	// Unmount the old version before loading the new one.
	// This MUST be done here by the framework, not by the new plugin code itself,
	// because once the new script loads, it calls acode.setPluginUnmount(id, newDestroy)
	// which overwrites the old version's destroy callback. At that point the old
	// destroy — which holds references to the old sidebar app, commands, event
	// listeners, etc. — is lost and can never be called. Letting the framework
	// invoke unmountPlugin() first ensures the OLD destroy() runs while it still
	// exists, so all old-version resources are properly cleaned up.
	try {
		acode.unmountPlugin(pluginId);
	} catch (e) {
		// unmountPlugin() itself is safe when no callback is registered (it no-ops),
		// but a plugin's destroy() callback may throw. We catch here so a faulty
		// cleanup in the old version does not block reloading the new one.
		console.error(`Error while unmounting plugin "${pluginId}":`, e);
	}

	// Remove the old <script> tag so the browser fetches the new source.
	const oldScript = document.getElementById(`${pluginId}-mainScript`);
	if (oldScript) oldScript.remove();

	const pluginJson = await fsOperation(
		Url.join(PLUGIN_DIR, pluginId, "plugin.json"),
	).readFile("json");

	let mainUrl;
	if (
		await fsOperation(Url.join(PLUGIN_DIR, pluginId, pluginJson.main)).exists()
	) {
		mainUrl = Url.join(baseUrl, pluginJson.main);
	} else {
		mainUrl = Url.join(baseUrl, "main.js");
	}

	return new Promise((resolve, reject) => {
		const $script = (
			<script id={`${pluginId}-mainScript`} src={mainUrl}></script>
		);

		$script.onerror = (error) => {
			reject(
				new Error(
					`Failed to load script for plugin ${pluginId}: ${error.message || error}`,
				),
			);
		};

		$script.onload = async () => {
			const $page = Page("Plugin");
			$page.show = () => {
				actionStack.push({
					id: pluginId,
					action: $page.hide,
				});

				app.append($page);
			};

			$page.onhide = function () {
				actionStack.remove(pluginId);
			};

			try {
				if (!(await fsOperation(cacheFile).exists())) {
					await fsOperation(CACHE_STORAGE).createFile(pluginId);
				}

				await acode.initPlugin(pluginId, baseUrl, $page, {
					cacheFileUrl: await helpers.toInternalUri(cacheFile),
					cacheFile: fsOperation(cacheFile),
					firstInit: justInstalled,
					ctx: await PluginContext.generate(
						pluginId,
						JSON.stringify(pluginJson),
					),
				});

				resolve();
			} catch (error) {
				reject(error);
			}
		};

		document.head.append($script);
	});
}
