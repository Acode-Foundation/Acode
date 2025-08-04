import fsOperation from "fileSystem";
import settingsPage from "components/settingsPage";
import toast from "components/toast";
import alert from "dialogs/alert";
import constants from "lib/constants";
import appSettings from "lib/settings";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";
import Uri from "utils/Uri";
import Url from "utils/Url";

function backupRestore() {
	const title =
		strings.backup.capitalize() + "/" + strings.restore.capitalize();
	const items = [
		{
			key: "backup",
			text: strings.backup.capitalize(),
			icon: "file_downloadget_app",
		},
		{
			key: "restore",
			text: strings.restore.capitalize(),
			icon: "historyrestore",
		},
		{
			note: strings["backup/restore note"],
		},
	];

	return settingsPage(title, items, callback);

	function callback(key) {
		switch (key) {
			case "backup":
				backup();
				return;

			case "restore":
				restore();
				return;

			default:
				break;
		}
	}

	async function backup() {
		try {
			const settings = appSettings.value;
			const keyBindings = await fsOperation(KEYBINDING_FILE).readFile("json");
			const plugins = await fsOperation(window.PLUGIN_DIR).lsDir();
			const installedPlugins = [];
			const installedPluginsWithSource = [];

			for (const plugin of plugins) {
				try {
					const pluginJsonPath = Url.join(
						window.PLUGIN_DIR,
						plugin.name,
						"plugin.json",
					);
					const pluginJson = await fsOperation(pluginJsonPath).readFile("json");

					if (pluginJson.source) {
						installedPluginsWithSource.push(pluginJson.source);
					} else {
						installedPlugins.push(plugin.name);
					}
				} catch (error) {
					installedPlugins.push(plugin.name);
				}
			}

			const { url } = await FileBrowser("folder", strings["select folder"]);

			const backupFilename = "Acode.backup";
			const backupDirname = "Backup";
			const backupDir = Url.join(url, backupDirname);
			const backupFile = Url.join(backupDir, backupFilename);
			const backupStorageFS = fsOperation(url);
			const backupDirFS = fsOperation(backupDir);
			const backupFileFS = fsOperation(backupFile);

			if (!(await backupDirFS.exists())) {
				await backupStorageFS.createDirectory(backupDirname);
			}

			if (!(await backupFileFS.exists())) {
				await backupDirFS.createFile(backupFilename);
			}

			const backupString = JSON.stringify({
				settings,
				keyBindings,
				installedPlugins: [...installedPlugins, ...installedPluginsWithSource],
			});

			await backupFileFS.writeFile(backupString);

			alert(
				strings.success.toUpperCase(),
				`${strings["backup successful"]}\n${Uri.getVirtualAddress(
					backupFile,
				)}.`,
			);
		} catch (error) {
			console.error(error);
			toast(error);
		}
	}

	function restore() {
		sdcard.openDocumentFile(
			(data) => {
				backupRestore.restore(data.uri);
			},
			toast,
			"application/octet-stream",
		);
	}
}

backupRestore.restore = async function (url) {
	try {
		let fs = fsOperation(url);
		let backup = await fs.readFile("utf8");

		try {
			backup = JSON.parse(backup);
		} catch (error) {
			alert(strings.error.toUpperCase(), strings["invalid backup file"]);
			return;
		}

		try {
			const text = JSON.stringify(backup.keyBindings, undefined, 2);
			await fsOperation(window.KEYBINDING_FILE).writeFile(text);
		} catch (error) {
			console.error("Error restoring key bindings:", error);
		}

		const { settings, installedPlugins } = backup;

		const { default: installPlugin } = await import("lib/installPlugin");

		// Restore plugins
		if (Array.isArray(installedPlugins)) {
			for (const id of installedPlugins) {
				try {
					if (!id) continue;
					if (
						id.startsWith("content://") ||
						id.startsWith("file://") ||
						id.includes("/")
					) {
						// Local plugin case - pass URI directly
						toast("Restoring plugins");
						await installPlugin(id);
					} else {
						// Remote plugin case - fetch from API
						const pluginUrl = Url.join(constants.API_BASE, `plugin/${id}`);
						const remotePlugin = await fsOperation(pluginUrl)
							.readFile("json")
							.catch(() => null);

						if (remotePlugin) {
							let purchaseToken = null;
							if (Number.parseFloat(remotePlugin.price) > 0) {
								try {
									const [product] = await helpers.promisify(iap.getProducts, [
										remotePlugin.sku,
									]);
									if (product) {
										async function getPurchase(sku) {
											const purchases = await helpers.promisify(
												iap.getPurchases,
											);
											const purchase = purchases.find((p) =>
												p.productIds.includes(sku),
											);
											return purchase;
										}
										const purchase = await getPurchase(product.productId);
										purchaseToken = purchase?.purchaseToken;
									}
								} catch (error) {
									helpers.error(error);
								}
							}
							toast("Restoring plugins", 3000);
							await installPlugin(id, remotePlugin.name, purchaseToken);
						}
					}
				} catch (error) {
					console.error(`Error restoring plugin ${id}:`, error);
				}
			}
		}

		await appSettings.update(settings);
		location.reload();
	} catch (err) {
		toast(err);
	}
};

export default backupRestore;
