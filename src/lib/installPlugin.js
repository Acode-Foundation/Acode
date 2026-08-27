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
import InstallState from "./installState";
import { loadPluginWithTimeout } from "./loadPlugins";

/** @type {import("dialogs/loader").Loader} */
let loaderDialog;
/** @type {Array<() => Promise<void>>} */
let depsLoaders;
/** Set by the loader's cancel button; checked at a few safe checkpoints. */
let installCancelled = false;
/** The in-flight PluginInstaller.extractZip() promise, if extraction is running. */
let activeExtraction = null;
/** The in-flight cordova.plugin.http request id, if an external download is running. */
let activeHttpReqId = null;

/**
 * Throws a clearly-labeled cancellation error if the user has hit "Cancel"
 * on the install loader. Called at points between slow operations
 * (download, extraction) so the install stops promptly instead of only
 * noticing after everything has already finished.
 */
function throwIfCancelled() {
	if (installCancelled) {
		const error = new Error(`${strings.install} ${strings.cancelled}`);
		error.cancelled = true;
		throw error;
	}
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
		installCancelled = false;
		activeExtraction = null;
		activeHttpReqId = null;
		loaderDialog = loader.create(name || "Plugin", strings.installing, {
			timeout: 6000,
			oncancel: () => {
				installCancelled = true;
				if (activeHttpReqId != null) {
					cordova.plugin.http.abort(
						activeHttpReqId,
						() => {},
						() => {},
					);
				}
				activeExtraction?.cancel?.();
			},
		});
		depsLoaders = [];
	}

	let pluginDir;
	let pluginUrl;
	let state;

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
		try {
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
				try {
					plugin = await new Promise((resolve, reject) => {
						activeHttpReqId = cordova.plugin.http.sendRequest(
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
				} finally {
					activeHttpReqId = null;
				}
			}
		} catch (downloadError) {
			// If cancellation is why this failed (e.g. the http request was
			// aborted), surface our own clean message instead of whatever
			// low-level error the abort produced.
			throwIfCancelled();
			throw downloadError;
		}
		// The fsOperation download path above has no abort hook, so a cancel
		// requested mid-download can't interrupt it - but we stop here,
		// before any extraction/writes happen, as soon as it settles.
		throwIfCancelled();

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
				pluginDir = Url.join(PLUGIN_DIR, id);
			}

			state = await InstallState.new(id);

			if (!(await fsOperation(pluginDir).exists())) {
				await fsOperation(PLUGIN_DIR).createDirectory(id);
			}

			// Manifest parsing and any dependency-confirmation dialog above
			// can take a while (waiting on the user); re-check here so a
			// cancel during that window stops us before we touch disk.
			throwIfCancelled();

			// Extract the archive natively instead of looping through zip
			// entries on the JS thread in hardcoded batches of 2. The
			// PluginInstaller Java plugin (src/plugins/pluginInstaller) does
			// the unzip + disk I/O on Cordova's background thread pool, so
			// there's no UI thread to babysit and therefore no need for an
			// arbitrary batch-size limit - the whole archive is extracted in
			// a single native call.
			//
			// The downloaded bytes are staged as a temp file first rather
			// than base64-encoded through the bridge: that avoids ~33% size
			// bloat plus holding multiple full copies of a potentially
			// multi-MB archive in memory at once (ArrayBuffer + base64
			// string + bridge JSON + decoded native byte[]).
			const tempZipName = `plugin-install-${state.id}-${Date.now()}.zip`;
			const tempZipUrl = Url.join(CACHE_STORAGE, tempZipName);
			if (!(await fsOperation(tempZipUrl).exists())) {
				await fsOperation(CACHE_STORAGE).createFile(tempZipName, plugin);
			} else {
				await fsOperation(tempZipUrl).writeFile(plugin);
			}

			let extraction;
			try {
				// Stashed on the module so the loader's `oncancel` handler
				// (set up when this install started) can call `.cancel()`
				// on it and have the native side stop mid-extraction.
				activeExtraction = PluginInstaller.extractZip(
					tempZipUrl,
					pluginDir,
					JSON.stringify(pluginJson),
					state.store,
					(done, total) => {
						if (isDependency || !total) return;
						loaderDialog.setMessage(
							`${strings.installing} ${Math.round((done / total) * 100)}%`,
						);
					},
				);
				extraction = await activeExtraction;
			} finally {
				activeExtraction = null;
				fsOperation(tempZipUrl)
					.delete()
					.catch(() => {});
			}

			const {
				store: updatedStore,
				skippedUnsafe,
				failed: failedEntries,
			} = extraction;

			// Any entry that failed to read/write makes this an incomplete
			// extraction. Fail the whole install here rather than silently
			// persisting a checksum store that's missing those entries:
			// `state.save()` below would record that partial store, and
			// `deleteRedundantFiles()` would then treat any *previously
			// installed* copy of that same file as obsolete (since it's no
			// longer in the store) and delete it - so a single failed file
			// during an update could silently destroy a working plugin
			// instead of just leaving it un-updated. Throwing here routes
			// through the existing catch block below, which clears state
			// and removes the (incomplete) plugin directory instead.
			if (failedEntries?.length) {
				throw new Error(
					`Failed to extract ${failedEntries.length} file${
						failedEntries.length === 1 ? "" : "s"
					} from the plugin archive: ${failedEntries.slice(0, 5).join(", ")}${
						failedEntries.length > 5 ? ", ..." : ""
					}`,
				);
			}

			state.updatedStore = updatedStore || {};

			// Track unsafe absolute entries that were skipped natively
			const ignoredUnsafeEntries = new Set(skippedUnsafe || []);

			// Emit a non-blocking warning if any unsafe entries were skipped
			if (!isDependency && ignoredUnsafeEntries.size) {
				const sample = Array.from(ignoredUnsafeEntries).slice(0, 3).join(", ");
				loaderDialog.setMessage(
					`Skipped ${ignoredUnsafeEntries.size} unsafe archive entr${
						ignoredUnsafeEntries.size === 1 ? "y" : "ies"
					} (e.g., ${sample})`,
				);
				console.warn(
					"Plugin installer: skipped unsafe absolute paths in archive:",
					Array.from(ignoredUnsafeEntries),
				);
			}

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
			installCancelled = false;
			activeExtraction = null;
			activeHttpReqId = null;
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
