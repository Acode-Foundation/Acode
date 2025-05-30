import ajax from "@deadlyjack/ajax";
import internalFs from "fileSystem/internalFs";
import fsOperation from "../fileSystem";
import Url from "../utils/Url";

export default async function checkPluginsUpdate() {
	const plugins = await internalFs.listDir(PLUGIN_DIR);
	const promises = [];
	const updates = [];

	plugins.forEach((pluginDir) => {
		promises.push(
			(async () => {
				try {
					const plugin = await fsOperation(
						Url.join(pluginDir.url, "plugin.json"),
					).readFile("json");

					const res = await ajax({
						url: `https://acode.app/api/plugin/check-update/${plugin.id}/${plugin.version}`,
					});

					if (res && res.update === true) {
						updates.push(plugin.id);
					}
				} catch (e) {
					console.warn(e);
				}
			})(),
		);
	});

	await Promise.allSettled(promises);
	return updates;
}
