import fsOperation from "fileSystem";
import Url from "utils/Url";
import { isVersionGreater } from "utils/version";
import config from "./config";

export default async function checkPluginsUpdate() {
	const plugins = await fsOperation(PLUGIN_DIR).lsDir();
	const promises = [];
	const updates = [];

	plugins.forEach((pluginDir) => {
		promises.push(
			(async () => {
				const plugin = await fsOperation(
					Url.join(pluginDir.url, "plugin.json"),
				).readFile("json");

				const res = await fetch(
					`${config.API_BASE}/plugin/check-update/${plugin.id}/${plugin.version}`,
				);

				if (res.ok) {
					const json = await res.json();
					if (!json.update) return;

					if (json.version) {
						if (isVersionGreater(json.version, plugin.version)) {
							updates.push(plugin.id);
						}
						return;
					}

					const remotePlugin = await fsOperation(
						config.API_BASE,
						`plugin/${plugin.id}`,
					)
						.readFile("json")
						.catch(() => null);

					if (isVersionGreater(remotePlugin?.version, plugin.version)) {
						updates.push(plugin.id);
					}
				}
			})(),
		);
	});

	await Promise.allSettled(promises);
	return updates;
}
