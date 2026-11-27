import fsOperation from "fileSystem";
import Page from "components/page";
import helpers from "utils/helpers";
import Url from "utils/Url";
import actionStack from "./actionStack";
import fileIcons from "./fileIcons";
import generatePluginContext, { connect } from "./pluginContext";

export default async function loadPlugin(pluginId, justInstalled = false) {
	// Establish the trusted native session BEFORE any plugin script is appended
	// and run. Plugin main.js runs as soon as its <script> is appended below, so
	// this must happen first, otherwise a malicious plugin could race us and
	// steal the session, then request tokens for other plugins. This is the
	// single choke point through which all plugin loads flow.
	await connect();

	const pluginDir = Url.join(PLUGIN_DIR, pluginId);
	const baseUrl = await toInternalUri(pluginDir, true);
	const cacheFile = Url.join(CACHE_STORAGE, pluginId);

	// Unmount the old version before loading the new one.
	// This MUST be done here by the framework, not by the new plugin code itself,
	// because once the new script loads, it calls acode.setPluginUnmount(id, newDestroy)
	// which overwrites the old version's destroy callback. At that point the old
	// destroy — which holds references to the old sidebar app, commands, event
	// listeners, etc. — is lost and can never be called. Letting the framework
	// invoke unmountPlugin() first ensures the OLD destroy() runs while it still
	// exists, so all old-version resources are properly cleaned up.
	acode.unmountPlugin(pluginId);

	// Remove the old <script> tag so the browser fetches the new source.
	const oldScript = document.getElementById(`${pluginId}-mainScript`);
	if (oldScript) oldScript.remove();

	const pluginJson = await fsOperation(
		Url.join(pluginDir, "plugin.json"),
	).readFile("json");

	// Neither is needed until init, so prepare them while the script loads.
	const initInputs = Promise.all([
		prepareCacheFile(cacheFile, pluginId),
		generatePluginContext(pluginId, JSON.stringify(pluginJson)),
	]);
	initInputs.catch(() => {});

	// A missing `main` falls back to main.js, as the old exists() check did.
	const mainFiles = [...new Set([pluginJson.main, "main.js"].filter(Boolean))];

	await new Promise((resolve, reject) => {
		const load = (index) => {
			const $script = (
				<script
					id={`${pluginId}-mainScript`}
					src={Url.join(baseUrl, mainFiles[index])}
				></script>
			);

			const iconApi = fileIcons.bindPlugin($script, pluginId);

			$script.onerror = (error) => {
				fileIcons.unregisterByPlugin(pluginId);
				if (index + 1 < mainFiles.length) {
					$script.remove();
					load(index + 1);
					return;
				}
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
					const [cacheFileUrl, ctx] = await initInputs;
					await acode.initPlugin(pluginId, baseUrl, $page, {
						fileIcons: iconApi,
						cacheFileUrl,
						cacheFile: fsOperation(cacheFile),
						firstInit: justInstalled,
						ctx,
					});

					resolve();
				} catch (error) {
					fileIcons.unregisterByPlugin(pluginId);
					reject(error);
				}
			};

			document.head.append($script);
		};
		load(0);
	});
}

/**
 * Creates the plugin's cache file if needed.
 * @returns {Promise<string>} its WebView URL
 */
async function prepareCacheFile(cacheFile, pluginId) {
	if (!(await fsOperation(cacheFile).exists())) {
		await fsOperation(CACHE_STORAGE).createFile(pluginId);
	}
	return toInternalUri(cacheFile);
}

/**
 * The WebView URL of an existing local path, without a native round trip when
 * the native file layer can format it directly.
 */
async function toInternalUri(url, isDirectory = false) {
	return (
		Bridge.file?.toInternalURL?.(url, isDirectory) ??
		(await helpers.toInternalUri(url))
	);
}
