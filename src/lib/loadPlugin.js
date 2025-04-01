import Page from "components/page";
import fsOperation from "fileSystem";
import Url from "utils/Url";
import helpers from "utils/helpers";
import actionStack from "./actionStack";

export default async function loadPlugin(pluginId, justInstalled = false) {
	const baseUrl = await helpers.toInternalUri(Url.join(PLUGIN_DIR, pluginId));
	const cacheFile = Url.join(CACHE_STORAGE, pluginId);

	return new Promise((resolve, reject) => {
		const $script = <script src={Url.join(baseUrl, "main.js")}></script>;

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

			$page.onhide = () => {
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
