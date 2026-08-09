import fsOperation from "fileSystem";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import purchaseListener from "handlers/purchase";
import JSZip from "jszip";
import helpers from "utils/helpers";
import Url from "utils/Url";
import { isVersionGreater } from "utils/version";
import config from "./config";
import { loadPluginWithTimeout } from "./loadPlugins";

/** @type {import("dialogs/loader").Loader} */
let loaderDialog;
/** @type {Array<() => Promise<void>>} */
let depsLoaders;

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafePluginId(id) {
	if (!PLUGIN_ID_PATTERN.test(String(id || ""))) {
		throw new Error("Invalid plugin id");
	}
}

function extractPluginArchive(archiveUrl, pluginDir, manifest) {
	return new Promise((resolve, reject) => {
		cordova.exec(resolve, reject, "Tee", "extractPluginArchive", [
			archiveUrl,
			pluginDir,
			manifest,
		]);
	});
}

/**
 * Installs a plugin.
 * @param {string} id
 * @param {string} name
 * @param {string} purchaseToken
 * @param {boolean} isDependency
 */
export default async function installPlugin(
	id,
	name,
	purchaseToken,
	isDependency,
) {
	if (!isDependency) {
		loaderDialog = loader.create(name || "Plugin", strings.installing, {
			timeout: 6000,
		});
		depsLoaders = [];
	}

	let pluginDir;
	let pluginUrl;
	let archiveUrl;
	let pluginWasInstalled = false;
	let extractionComplete = false;

	try {
		if (!(await fsOperation(PLUGIN_DIR).exists())) {
			await fsOperation(DATA_STORAGE).createDirectory("plugins");
		}
	} catch (error) {
		window.log("error", error);
	}

	if (!/^(https?|file|content):/.test(id)) {
		pluginUrl = Url.join(
			config.API_BASE,
			"plugin/download/",
			`${id}?device=${device.uuid}`,
		);
		if (purchaseToken) pluginUrl += `&token=${purchaseToken}`;
		pluginUrl += `&package=${BuildInfo.packageName}`;
		pluginUrl += `&version=${device.version}`;

		pluginDir = Url.join(PLUGIN_DIR, id);
	} else {
		pluginUrl = id;
	}

	try {
		if (!isDependency) loaderDialog.show();

		let plugin;
		if (
			pluginUrl.includes(config.API_BASE) ||
			pluginUrl.startsWith("file:") ||
			pluginUrl.startsWith("content:")
		) {
			// Use fsOperation for Acode registry URL
			plugin = await fsOperation(pluginUrl).readFile(
				undefined,
				(loaded, total) => {
					loaderDialog.setMessage(
						`${strings.loading} ${((loaded / total) * 100).toFixed(2)}%`,
					);
				},
			);
		} else {
			// cordova http plugin for others
			plugin = await new Promise((resolve, reject) => {
				cordova.plugin.http.sendRequest(
					pluginUrl,
					{
						method: "GET",
						responseType: "arraybuffer",
					},
					(response) => {
						resolve(response.data);
						loaderDialog.setMessage(`${strings.loading} 100%`);
					},
					(error) => {
						reject(error);
					},
				);
			});
		}

		if (plugin) {
			const zip = new JSZip();
			await zip.loadAsync(plugin);

			if (!zip.files["plugin.json"]) {
				throw new Error(strings["invalid plugin"]);
			}

			/** @type {{ dependencies: string[] }} */
			const pluginJson = JSON.parse(
				await zip.files["plugin.json"].async("text"),
			);

			/** patch main in manifest */
			if (!zip.files[pluginJson.main]) {
				pluginJson.main = "main.js";
			}

			/** patch icon in manifest */
			if (!zip.files[pluginJson.icon]) {
				pluginJson.icon = "icon.png";
			}

			/** patch readme in manifest */
			if (!zip.files[pluginJson.readme]) {
				pluginJson.readme = "readme.md";
			}

			if (!zip.files[pluginJson.main]) {
				throw new Error(strings["invalid plugin"]);
			}

			if (!isDependency && pluginJson.dependencies) {
				const manifests = await resolveDepsManifest(pluginJson.dependencies);

				let titleText;
				if (manifests.length > 1) {
					titleText = "Acode wants to install the following dependencies:";
				} else {
					titleText = "Acode wants to install the following dependency:";
				}

				const shouldInstall = await confirm(
					"Installer Notice",
					titleText +
						"<br /><br />" +
						manifests.map((value) => value.name).join(", "),
					true,
				);

				if (shouldInstall) {
					for (const manifest of manifests) {
						const hasError = await resolveDep(manifest);
						if (hasError) throw new Error(strings.failed);
					}
				} else {
					return;
				}
			}

			if (!pluginDir) {
				pluginJson.source = pluginUrl;
				id = pluginJson.id;
			}

			assertSafePluginId(id);
			pluginDir = Url.join(PLUGIN_DIR, id);
			pluginWasInstalled = await fsOperation(pluginDir).exists();
			archiveUrl = Url.join(
				CACHE_STORAGE,
				`.plugin-install-${helpers.uuid()}.zip`,
			);
			await fsOperation(CACHE_STORAGE).createFile(
				Url.basename(archiveUrl),
				plugin,
			);
			loaderDialog?.setMessage("Extracting plugin files...");
			await extractPluginArchive(archiveUrl, pluginDir, JSON.stringify(pluginJson));
			extractionComplete = true;

			if (isDependency) {
				depsLoaders.push(async () => {
					await loadPluginWithTimeout(id, true);
				});
			} else {
				for (const loader of depsLoaders) {
					await loader();
				}
				await loadPluginWithTimeout(id, true);
			}

		}
	} catch (err) {
		try {
			// A failed extraction leaves the previous plugin untouched. If a brand
			// new plugin fails after activation, remove that incomplete install.
			if (
				extractionComplete &&
				!pluginWasInstalled &&
				pluginDir &&
				(await fsOperation(pluginDir).exists())
			) {
				await fsOperation(pluginDir).delete();
			}
		} catch (cleanupError) {
			console.error("Cleanup failed:", cleanupError);
		}
		throw err;
	} finally {
		if (archiveUrl) {
			try {
				await fsOperation(archiveUrl).delete();
			} catch (_) {}
		}
		if (!isDependency) {
			loaderDialog.destroy();
		}
	}
}

/**
 * Resolves Dependencies Manifest with given ids.
 * @param {string[]} deps dependencies
 */
async function resolveDepsManifest(deps) {
	const resolved = [];
	for (const dependency of deps) {
		const remoteDependency = await fsOperation(
			config.API_BASE,
			`plugin/${dependency}`,
		)
			.readFile("json")
			.catch(() => null);

		if (!remoteDependency)
			throw new Error(`Unknown plugin dependency: ${dependency}`);

		const version = await getInstalledPluginVersion(remoteDependency.id);
		if (version && !isVersionGreater(remoteDependency?.version, version))
			continue;

		if (remoteDependency.dependencies) {
			const manifests = await resolveDepsManifest(
				remoteDependency.dependencies,
			);
			resolved.push(manifests);
		}

		resolved.push(remoteDependency);
	}

	/**
	 *
	 * @param {string} id
	 * @returns {Promise<string>} plugin version
	 */
	async function getInstalledPluginVersion(id) {
		if (await fsOperation(PLUGIN_DIR, id).exists()) {
			const plugin = await fsOperation(PLUGIN_DIR, id, "plugin.json").readFile(
				"json",
			);
			return plugin.version;
		}
	}

	return resolved;
}

/** Resolve dependency
 * @param {object} manifest
 * @returns {Promise<boolean>} has error
 */
async function resolveDep(manifest) {
	let purchaseToken;
	let product;
	let isPaid = false;

	isPaid = manifest.price > 0;
	[product] = await helpers.promisify(iap.getProducts, [manifest.sku]);
	if (product) {
		const purchase = await getPurchase(product.productId);
		purchaseToken = purchase?.purchaseToken;
	}

	if (isPaid && !purchaseToken) {
		if (!product) throw new Error("Product not found");
		const apiStatus = await helpers.checkAPIStatus();

		if (!apiStatus) {
			alert(strings.error, strings.api_error);
			return true;
		}

		iap.setPurchaseUpdatedListener(...purchaseListener(onpurchase, onerror));
		loaderDialog.setMessage(strings["loading..."]);
		await helpers.promisify(iap.purchase, product.productId);

		async function onpurchase(e) {
			const purchase = await getPurchase(product.productId);
			await fetch(Url.join(config.API_BASE, "plugin/order"), {
				method: "POST",
				body: JSON.stringify({
					id: manifest.id,
					token: purchase?.purchaseToken,
					package: BuildInfo.packageName,
				}),
			});
			purchaseToken = purchase?.purchaseToken;
		}

		async function onerror(error) {
			throw error;
		}
	}

	loaderDialog.setMessage(
		`${strings.installing.replace("...", "")} ${manifest.name}...`,
	);
	await installPlugin(manifest.id, undefined, purchaseToken, true);

	async function getPurchase(sku) {
		const purchases = await helpers.promisify(iap.getPurchases);
		const purchase = purchases.find((p) => p.productIds.includes(sku));
		return purchase;
	}
}
