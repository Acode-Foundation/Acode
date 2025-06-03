import Page from "components/page";
import fsOperation from "fileSystem";
import internalFs from "fileSystem/internalFs";
import Url from "utils/Url";
import helpers from "utils/helpers";
import actionStack from "./actionStack";

export default async function loadPlugin(pluginId, justInstalled = false) {
	const baseUrl = Url.join(PLUGIN_DIR, pluginId);

	console.log("Base url " + baseUrl);

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

	console.log(`main url ${mainUrl}`);

	return new Promise(async (resolve, reject) => {
		if (pluginId === undefined) {
			console.error("Skipping loading plugin with undefined id");
			reject("Skipping loading plugin with undefined id");
			return;
		}

		const result = await internalFs.readStringFile(mainUrl);

		console.log(`result ${result}`);

		const data = result.data;

		const blob = new Blob([data], { type: "text/javascript" });
		const url = URL.createObjectURL(blob);

		const $script = document.createElement("script");
		$script.src = url;
		$script.type = "text/javascript";

		console.log("script created");

		$script.onerror = (error) => {
			URL.revokeObjectURL(url);
			reject(
				new Error(
					`Failed to load script for plugin ${pluginId}: ${error.message || error}`,
				),
			);
		};

		console.log("on error registered");

		$script.onload = async () => {
			URL.revokeObjectURL(url);
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
				console.log("trying");
				if (!(await fsOperation(cacheFile).exists())) {
					await fsOperation(CACHE_STORAGE).createFile(pluginId);
				}

				await acode.initPlugin(
					pluginId,
					Capacitor.convertFileSrc(baseUrl),
					$page,
					{
						cacheFileUrl: Capacitor.convertFileSrc(cacheFile),
						cacheFile: fsOperation(cacheFile),
						firstInit: justInstalled,
					},
				);

				resolve();
			} catch (error) {
				reject(error);
			}
		};

		console.log("attaching script");
		document.head.append($script);
		console.log("script attached");
	});
}
