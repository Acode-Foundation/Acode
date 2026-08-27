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
	/** Directory extraction writes into; only swapped into pluginDir on full success. */
	let stagingDir;
	/** Whether pluginDir already held a working install before this call started. */
	let isUpdate = false;
	/** Whether the staged install has been swapped into pluginDir. */
	let swapCompleted = false;
	/**
	 * Where the previous version was parked during an update's directory
	 * swap, if it hasn't been deleted yet. Non-null exactly while both the
	 * old version (here) and the new one (at pluginDir) exist side by
	 * side - i.e. after the swap but before the replacement has actually
	 * been confirmed working.
	 */
	let backupDir = null;

	/**
	 * If a previous version is currently parked at backupDir (following an
	 * update's directory swap), restores it over whatever - if anything -
	 * is now at pluginDir, and clears backupDir either way. Used both when
	 * the replacement fails to load (see commitOrRollback below) and as a
	 * safety net in the outer catch block for any other post-swap failure.
	 * @param {string} reason short, human-readable cause for the log message
	 */
	async function restoreBackupIfAny(reason) {
		if (!backupDir) return;
		const failedBackupDir = backupDir;
		backupDir = null;
		try {
			if (await fsOperation(pluginDir).exists()) {
				await fsOperation(pluginDir).delete();
			}
			await fsOperation(failedBackupDir).renameTo(id);
			// Back to the pre-swap (old, working) version.
			swapCompleted = false;
		} catch (rollbackError) {
			console.error(
				`Plugin installer: failed to roll back "${id}" after ${reason}; ` +
					`the previous working copy may still be recoverable at ` +
					`"${failedBackupDir}".`,
				rollbackError,
			);
		}
	}

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

	if (pluginDir) {
		isUpdate = await fsOperation(pluginDir).exists();
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
				isUpdate = await fsOperation(pluginDir).exists();
			}

			state = await InstallState.new(id);

			// Manifest parsing and any dependency-confirmation dialog above
			// can take a while (waiting on the user); re-check here so a
			// cancel during that window stops us before we touch disk.
			throwIfCancelled();

			// Extract into a fresh staging directory - a sibling of
			// pluginDir under PLUGIN_DIR - rather than into pluginDir
			// itself. That way a failed, cancelled, or partially-failed
			// extraction never touches an existing working install: the
			// staged result is only swapped into place once extraction has
			// fully succeeded (see the swap step below). Since staging
			// always starts empty, every file is written fresh - there is
			// no previous-install state to diff against here.
			const stagingName = `.${id}.staging-${Date.now()}`;
			stagingDir = Url.join(PLUGIN_DIR, stagingName);
			await fsOperation(PLUGIN_DIR).createDirectory(stagingName);

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
					stagingDir,
					JSON.stringify(pluginJson),
					{},
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
			// persisting a checksum store that's missing those entries -
			// since extraction happened into stagingDir (not pluginDir
			// itself), throwing here simply routes to the catch block
			// below, which discards the incomplete staging directory
			// without ever touching the existing pluginDir.
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

			// Extraction into stagingDir fully succeeded (no failed
			// entries) - swap it into pluginDir now. For an update, the
			// previous install is moved aside first and only removed once
			// the new one is confirmed to actually load below, so a
			// failure during the swap itself - or a replacement that loads
			// broken - can both be rolled back instead of leaving the
			// plugin missing, half-updated, or silently broken with no way
			// back to the working version.
			if (isUpdate) {
				const backupName = `.${id}.bak-${Date.now()}`;
				await fsOperation(pluginDir).renameTo(backupName);
				backupDir = Url.join(PLUGIN_DIR, backupName);

				try {
					await fsOperation(stagingDir).renameTo(id);
				} catch (swapError) {
					await restoreBackupIfAny("a failed update swap");
					throw swapError;
				}
				swapCompleted = true;
				// backupDir is intentionally left set (not deleted yet) -
				// the previous version stays recoverable until the
				// replacement has actually been loaded and saved below.
			} else {
				await fsOperation(stagingDir).renameTo(id);
				swapCompleted = true;
			}
			// The directory that used to live at stagingDir is now pluginDir
			// itself (renamed in place) - nothing left to clean up there.
			stagingDir = null;

			/**
			 * Runs `loadFn` (the actual `loadPluginWithTimeout` call) and,
			 * only once it succeeds, drops the backup of the previous
			 * version - this is the one thing that actually proves the
			 * replacement works. If it fails instead, restores the backup
			 * so the previous working version comes back instead of being
			 * left gone alongside a plugin that doesn't load.
			 *
			 * Defined per-call (closing over this call's own `backupDir` /
			 * `pluginDir` / `id`) so it works the same whether the load
			 * happens inline (the root plugin) or later, deferred via
			 * `depsLoaders` (a dependency) - each dependency's own
			 * `installPlugin()` call gets its own independent closure over
			 * its own backup, so nothing here is shared across plugins.
			 */
			async function commitOrRollback(loadFn) {
				try {
					await loadFn();
					if (backupDir) {
						const finishedBackupDir = backupDir;
						backupDir = null;
						fsOperation(finishedBackupDir)
							.delete()
							.catch(() => {});
					}
				} catch (loadError) {
					await restoreBackupIfAny("it failed to load");
					throw loadError;
				}
			}

			if (isDependency) {
				depsLoaders.push(() =>
					commitOrRollback(() => loadPluginWithTimeout(id, true)),
				);
			} else {
				for (const loader of depsLoaders) {
					await loader();
				}
				await commitOrRollback(() => loadPluginWithTimeout(id, true));
			}

			await state.save();
			deleteRedundantFiles(pluginDir, state);
		}
	} catch (err) {
		try {
			// Post-swap rollback: the directory swap itself succeeded, but
			// a step after it (loading the replacement, saving state)
			// failed. Put the previous working version back rather than
			// leaving a broken replacement installed with the old copy
			// already gone. (A no-op if commitOrRollback above already
			// handled this - backupDir is cleared either way it settles.)
			await restoreBackupIfAny("a post-install step failed");

			// Fresh installs have no prior state worth protecting. Updates
			// keep whatever state file corresponds to whatever is actually
			// on disk (the new version if state.save() already ran, or the
			// restored old version after a successful rollback above).
			if (state && !isUpdate) await state.clear();

			// The staging directory never held anything but this (possibly
			// incomplete/failed) attempt, so it's always safe to remove.
			if (stagingDir && (await fsOperation(stagingDir).exists())) {
				await fsOperation(stagingDir).delete();
			}

			// pluginDir itself is only safe to delete when this was a
			// fresh install (nothing valuable to lose) that never reached
			// the swap step. For an update, pluginDir at this point either
			// still holds the original, untouched working version (failure
			// happened before or during extraction, which only ever
			// touched stagingDir), or was just restored by the rollback
			// above, or - if that rollback itself failed - is left alone
			// rather than guessed at further; the error logged above
			// points to where the previous version may still be found.
			if (
				!isUpdate &&
				!swapCompleted &&
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
