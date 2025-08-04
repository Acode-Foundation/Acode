import fsOperation from "fileSystem";
import Page from "components/page";
import helpers from "utils/helpers";
import Url from "utils/Url";
import actionStack from "./actionStack";

export default async function loadPlugin(pluginId, justInstalled = false) {
	const baseUrl = await helpers.toInternalUri(Url.join(PLUGIN_DIR, pluginId));
	const cacheFile = Url.join(CACHE_STORAGE, pluginId);

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
		const $script = <script src={mainUrl}></script>;

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
				});

				resolve();
			} catch (error) {
				reject(error);
			}
		};

		document.head.append($script);
	});
}
