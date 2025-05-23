import ajax from "@deadlyjack/ajax";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import fsOperation from "fileSystem";
import internalFs from "fileSystem/internalFs";
import purchaseListener from "handlers/purchase";
import JSZip from "jszip";
import Url from "utils/Url";
import helpers from "utils/helpers";
import constants from "./constants";
import InstallState from "./installState";
import loadPlugin from "./loadPlugin";

/** @type {import("dialogs/loader").Loader} */
let loaderDialog;
/** @type {Array<() => Promise<void>>} */
let depsLoaders;

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
	console.log(`Installing ${name}`);
	if (!isDependency) {
		loaderDialog = loader.create(name || "Plugin", strings.installing, {
			timeout: 6000,
		});
		depsLoaders = [];
	}

	let pluginDir;
	let pluginUrl;
	let state;

	try {
		if (!(await internalFs.exists(PLUGIN_DIR))) {
			await internalFs.createDir(DATA_STORAGE, "plugins");
		}
	} catch (error) {
		window.log("error", error);
	}

	console.log("installing -------------------------");
	if (!/^(https?|file|content):/.test(id)) {
		pluginUrl = Url.join(
			constants.API_BASE,
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

		console.log("installing ...");

		let plugin;
		if (
			pluginUrl.includes(constants.API_BASE) ||
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
						console.log("Download complete");
					},
					(error) => {
						reject(error);
						console.log("Download failed");
					},
				);
			});
		}

		if (plugin) {
			const zip = new JSZip();
			await zip.loadAsync(plugin);
			console.log("Plugin zip loaded into memory");

			if (!zip.files["plugin.json"]) {
				throw new Error(strings["invalid plugin"]);
			}

			console.log("Plugin Json start");
			const jsonStr = await zip.files["plugin.json"].async("text");
			console.log(jsonStr);
			console.log("Plugin json end");

			/** @type {{ dependencies: string[] }} */
			const pluginJson = JSON.parse(jsonStr);

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
				pluginDir = Url.join(PLUGIN_DIR, id);
			}

			console.log("Begin Install state");
			state = await InstallState.new(id);
			console.log("Install state end");

			if (!(await internalFs.exists(pluginDir))) {
				await internalFs.createDir(PLUGIN_DIR, id);
			}

			const promises = Object.keys(zip.files).map(async (file) => {
				try {
					let correctFile = file;

					if (/\\/.test(correctFile)) {
						correctFile = correctFile.replace(/\\/g, "/");
					}

					console.log(`Correct file ${correctFile}`);
					const fileUrl = Url.join(pluginDir, correctFile);
					console.log("file Url " + fileUrl);

					if (!state.exists(correctFile)) {
						await createFileRecursive(pluginDir, correctFile);
					}

					// Skip directories
					if (correctFile.endsWith("/")) return;

					let data = await zip.files[file].async("ArrayBuffer");

					if (file === "plugin.json") {
						data = JSON.stringify(pluginJson);
					}

					if (!(await state.isUpdated(correctFile, data))) return;
					console.log("writing file");
					await fsOperation(fileUrl).writeFile(data);
					console.log("file written");
					return;
				} catch (error) {
					console.error(`Error processing file ${file}:`, error);
				}
			});

			// Wait for all files to be processed
			await Promise.allSettled(promises);

			console.log("done");

			if (isDependency) {
				depsLoaders.push(async () => {
					await loadPlugin(id, true);
				});
			} else {
				console.log("loaders");
				for (const loader of depsLoaders) {
					console.log("loading loader");
					console.log(loader);
					await loader();
				}
				console.log("loader loading done");
				console.log("loading plugin");
				await loadPlugin(id, true);
				console.log("loading plugin done");
			}

			console.log("successfully loaded");

			await state.save();
			deleteRedundantFiles(pluginDir, state);
		}
	} catch (err) {
		try {
			// Clear the install state if installation fails
			if (state) await state.clear();

			// Delete the plugin directory if it was created
			if (pluginDir && (await fsOperation(pluginDir).exists())) {
				await fsOperation(pluginDir).delete();
			}
		} catch (cleanupError) {
			console.error("Cleanup failed:", cleanupError);
		}
		throw err;
	} finally {
		if (!isDependency) {
			loaderDialog.destroy();
		}
	}
}

/**
 * Create directory recursively
 * @param {string} parent
 * @param {Array<string> | string} dir
 */
async function createFileRecursive(parent, dir) {
	let isDir = false;
	if (typeof dir === "string") {
		if (dir.endsWith("/")) {
			isDir = true;
			dir = dir.slice(0, -1);
		}
		dir = dir.split("/");
	}
	dir = dir.filter((d) => d);
	const cd = dir.shift();
	const newParent = Url.join(parent, cd);
	if (!(await fsOperation(newParent).exists())) {
		if (dir.length || isDir) {
			await fsOperation(parent).createDirectory(cd);
		} else {
			await fsOperation(parent).createFile(cd);
		}
	}
	if (dir.length) {
		await createFileRecursive(newParent, dir);
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
			constants.API_BASE,
			`plugin/${dependency}`,
		)
			.readFile("json")
			.catch(() => null);

		if (!remoteDependency)
			throw new Error(`Unknown plugin dependency: ${dependency}`);

		const version = await getInstalledPluginVersion(remoteDependency.id);
		if (remoteDependency?.version === version) continue;

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
		await helpers.promisify(iap.purchase, product.json);

		async function onpurchase(e) {
			const purchase = await getPurchase(product.productId);
			await ajax.post(Url.join(constants.API_BASE, "plugin/order"), {
				data: {
					id: manifest.id,
					token: purchase?.purchaseToken,
					package: BuildInfo.packageName,
				},
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

/**
 *
 * @param {string} dir
 * @param {Array<string>} files
 */
async function listFileRecursive(dir, files) {
	for (const child of await fsOperation(dir).lsDir()) {
		const fileUrl = Url.join(dir, child.name);
		if (child.isDirectory) {
			await listFileRecursive(fileUrl, files);
		} else {
			files.push(fileUrl);
		}
	}
}

/**
 *
 * @param {Record<string, boolean>} files
 */
async function deleteRedundantFiles(pluginDir, state) {
	/** @type {string[]} */
	let files = [];
	await listFileRecursive(pluginDir, files);

	for (const file of files) {
		if (!state.exists(file.replace(`${pluginDir}/`, ""))) {
			fsOperation(file).delete();
		}
	}
}
