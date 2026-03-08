import lspApi from "cm/lsp/api";
import {
	checkServerInstallation,
	getInstallCommand,
	getUninstallCommand,
	installServer,
	stopManagedServer,
	uninstallServer,
} from "cm/lsp/serverLauncher";
import settingsPage from "components/settingsPage";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import { getServerOverride, updateServerConfig } from "./lspConfigUtils";

const FEATURE_ITEMS = [
	[
		"ext_hover",
		"hover",
		"Hover Information",
		"Show type information and documentation on hover",
	],
	[
		"ext_completion",
		"completion",
		"Code Completion",
		"Enable autocomplete suggestions from the server",
	],
	[
		"ext_signature",
		"signature",
		"Signature Help",
		"Show function parameter hints while typing",
	],
	[
		"ext_diagnostics",
		"diagnostics",
		"Diagnostics",
		"Show errors and warnings from the language server",
	],
	[
		"ext_inlayHints",
		"inlayHints",
		"Inlay Hints",
		"Show inline type hints in the editor",
	],
	[
		"ext_documentHighlights",
		"documentHighlights",
		"Document Highlights",
		"Highlight all occurrences of the word under cursor",
	],
	[
		"ext_formatting",
		"formatting",
		"Formatting",
		"Enable code formatting from the language server",
	],
];

function clone(value) {
	if (!value || typeof value !== "object") return value;
	return JSON.parse(JSON.stringify(value));
}

function mergeLauncher(base, patch) {
	if (!base && !patch) return undefined;
	return {
		...(base || {}),
		...(patch || {}),
		bridge: {
			...(base?.bridge || {}),
			...(patch?.bridge || {}),
		},
		install: {
			...(base?.install || {}),
			...(patch?.install || {}),
		},
	};
}

function getMergedConfig(server) {
	const override = getServerOverride(server.id);
	return {
		...server,
		enabled: override.enabled ?? server.enabled,
		startupTimeout: override.startupTimeout ?? server.startupTimeout,
		initializationOptions: {
			...(server.initializationOptions || {}),
			...(override.initializationOptions || {}),
		},
		clientConfig: {
			...(server.clientConfig || {}),
			...(override.clientConfig || {}),
			builtinExtensions: {
				...(server.clientConfig?.builtinExtensions || {}),
				...(override.clientConfig?.builtinExtensions || {}),
			},
		},
		launcher: mergeLauncher(server.launcher, override.launcher),
	};
}

function formatInstallStatus(result) {
	switch (result?.status) {
		case "present":
			return result.version ? `Installed (${result.version})` : "Installed";
		case "missing":
			return "Not installed";
		case "failed":
			return "Check failed";
		default:
			return "Unknown";
	}
}

function formatValue(value) {
	if (value === undefined || value === null || value === "") return "";
	let text = String(value);
	if (text.includes("\n")) {
		[text] = text.split("\n");
	}
	if (text.length > 47) {
		text = `${text.slice(0, 47)}...`;
	}
	return text;
}

function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = String(text || "");
	return div.innerHTML;
}

function updateItemDisplay($list, itemsByKey, key, value, extras = {}) {
	const item = itemsByKey.get(key);
	if (!item) return;

	if ("value" in extras) {
		item.value = extras.value;
	} else if (value !== undefined) {
		item.value = value;
	}

	if ("info" in extras) {
		item.info = extras.info;
	}

	if ("checkbox" in extras) {
		item.checkbox = extras.checkbox;
	}

	const $item = $list?.querySelector?.(`[data-key="${key}"]`);
	if (!$item) return;

	const $value = $item.querySelector(".value");
	if ($value) {
		$value.textContent = formatValue(item.value);
	}

	const $checkbox = $item.querySelector(".input-checkbox");
	if ($checkbox && typeof item.checkbox === "boolean") {
		$checkbox.checked = item.checkbox;
	}
}

async function buildSnapshot(serverId) {
	const liveServer = lspApi.servers.get(serverId);
	if (!liveServer) return null;

	const merged = getMergedConfig(liveServer);
	const override = getServerOverride(serverId);
	const installResult = await checkServerInstallation(merged).catch(
		(error) => ({
			status: "failed",
			version: null,
			canInstall: true,
			canUpdate: true,
			message: error instanceof Error ? error.message : String(error),
		}),
	);

	return {
		liveServer,
		merged,
		override,
		installResult,
		builtinExts: merged.clientConfig?.builtinExtensions || {},
		installCommand: getInstallCommand(merged, "install"),
		updateCommand: getInstallCommand(merged, "update"),
		uninstallCommand: getUninstallCommand(merged),
	};
}

function createItems(snapshot) {
	const items = [
		{
			key: "enabled",
			text: "Enabled",
			checkbox: snapshot.merged.enabled !== false,
			info: "Enable or disable this language server",
		},
		{
			key: "install_status",
			text: "Installed",
			value: formatInstallStatus(snapshot.installResult),
			info:
				snapshot.installResult.message ||
				"Current installation state for this language server",
		},
		{
			key: "install_server",
			text: "Install / Repair",
			info: "Install or repair this language server",
		},
		{
			key: "update_server",
			text: "Update Server",
			info: "Update this language server if an update flow exists",
		},
		{
			key: "uninstall_server",
			text: "Uninstall Server",
			info: "Remove installed packages or binaries for this server",
		},
		{
			key: "startup_timeout",
			text: "Startup Timeout",
			value:
				typeof snapshot.merged.startupTimeout === "number"
					? `${snapshot.merged.startupTimeout} ms`
					: "Default (5000 ms)",
			info: "Configure how long Acode waits for the server to start",
		},
		{
			key: "edit_init_options",
			text: "Edit Initialization Options",
			value: Object.keys(snapshot.override.initializationOptions || {}).length
				? "Configured"
				: "Empty",
			info: "Edit initialization options as JSON",
		},
		{
			key: "view_init_options",
			text: "View Initialization Options",
			info: "View the effective initialization options as JSON",
		},
	];

	FEATURE_ITEMS.forEach(([key, extKey, text, info]) => {
		items.push({
			key,
			text,
			checkbox: snapshot.builtinExts[extKey] !== false,
			info,
		});
	});

	return items;
}

async function refreshVisibleState($list, itemsByKey, serverId) {
	if (!$list) return;

	const snapshot = await buildSnapshot(serverId);
	if (!snapshot) return;

	updateItemDisplay($list, itemsByKey, "enabled", undefined, {
		checkbox: snapshot.merged.enabled !== false,
	});
	updateItemDisplay(
		$list,
		itemsByKey,
		"install_status",
		formatInstallStatus(snapshot.installResult),
		{
			info:
				snapshot.installResult.message ||
				"Current installation state for this language server",
		},
	);
	updateItemDisplay($list, itemsByKey, "install_server", "");
	updateItemDisplay($list, itemsByKey, "update_server", "");
	updateItemDisplay($list, itemsByKey, "uninstall_server", "");
	updateItemDisplay(
		$list,
		itemsByKey,
		"startup_timeout",
		typeof snapshot.merged.startupTimeout === "number"
			? `${snapshot.merged.startupTimeout} ms`
			: "Default (5000 ms)",
	);
	updateItemDisplay(
		$list,
		itemsByKey,
		"edit_init_options",
		Object.keys(snapshot.override.initializationOptions || {}).length
			? "Configured"
			: "Empty",
	);

	FEATURE_ITEMS.forEach(([key, extKey]) => {
		updateItemDisplay($list, itemsByKey, key, undefined, {
			checkbox: snapshot.builtinExts[extKey] !== false,
		});
	});
}

async function persistEnabled(serverId, value) {
	await updateServerConfig(serverId, { enabled: value });
	lspApi.servers.update(serverId, (current) => ({
		...current,
		enabled: value,
	}));
}

async function persistClientConfig(serverId, clientConfig) {
	await updateServerConfig(serverId, { clientConfig });
	lspApi.servers.update(serverId, (current) => ({
		...current,
		clientConfig: {
			...(current.clientConfig || {}),
			...clientConfig,
		},
	}));
}

async function persistStartupTimeout(serverId, timeout) {
	await updateServerConfig(serverId, { startupTimeout: timeout });
	lspApi.servers.update(serverId, (current) => ({
		...current,
		startupTimeout: timeout,
	}));
}

async function persistInitOptions(serverId, value) {
	await updateServerConfig(serverId, { initializationOptions: value });
	lspApi.servers.update(serverId, (current) => ({
		...current,
		initializationOptions: value,
	}));
}

export default function lspServerDetail(serverId) {
	const initialServer = lspApi.servers.get(serverId);
	if (!initialServer) {
		toast("Server not found");
		return null;
	}

	const initialSnapshot = {
		liveServer: initialServer,
		merged: getMergedConfig(initialServer),
		override: getServerOverride(serverId),
		installResult: {
			status: "unknown",
			version: null,
			canInstall: true,
			canUpdate: true,
			message: "Checking installation status...",
		},
		builtinExts:
			getMergedConfig(initialServer).clientConfig?.builtinExtensions || {},
		installCommand: getInstallCommand(
			getMergedConfig(initialServer),
			"install",
		),
		updateCommand: getInstallCommand(getMergedConfig(initialServer), "update"),
		uninstallCommand: getUninstallCommand(getMergedConfig(initialServer)),
	};

	const items = createItems(initialSnapshot);
	const itemsByKey = new Map(items.map((item) => [item.key, item]));
	const page = settingsPage(
		initialServer.label || initialServer.id,
		items,
		callback,
		undefined,
		{
			preserveOrder: true,
		},
	);

	const baseShow = page.show.bind(page);

	return {
		...page,
		show(goTo) {
			baseShow(goTo);
			const $list = document.querySelector("#settings .main.list");
			refreshVisibleState($list, itemsByKey, serverId).catch(console.error);
		},
	};

	async function callback(key, value) {
		const $list = this?.parentElement;
		const snapshot = await buildSnapshot(serverId);
		if (!snapshot) {
			toast("Server not found");
			return;
		}

		switch (key) {
			case "enabled":
				await persistEnabled(serverId, value);
				if (!value) {
					stopManagedServer(serverId);
				}
				toast(value ? "Server enabled" : "Server disabled");
				break;

			case "install_status": {
				const result = await checkServerInstallation(snapshot.merged);
				const lines = [
					`Status: ${formatInstallStatus(result)}`,
					result.message ? `Details: ${result.message}` : null,
				].filter(Boolean);
				alert("Installation Status", lines.join("<br>"));
				break;
			}

			case "install_server":
				if (!snapshot.installCommand) {
					toast("Install command not available");
					break;
				}
				await installServer(snapshot.merged, "install");
				break;

			case "update_server":
				if (!snapshot.updateCommand) {
					toast("Update command not available");
					break;
				}
				await installServer(snapshot.merged, "update");
				break;

			case "uninstall_server":
				if (!snapshot.uninstallCommand) {
					toast("Uninstall command not available");
					break;
				}
				if (
					!(await confirm(
						"Uninstall Server",
						`Remove installed files for ${snapshot.liveServer.label || serverId}?`,
					))
				) {
					break;
				}
				await uninstallServer(snapshot.merged);
				toast("Server uninstalled");
				break;

			case "startup_timeout": {
				const currentTimeout =
					snapshot.override.startupTimeout ??
					snapshot.liveServer.startupTimeout ??
					5000;
				const result = await prompt(
					"Startup Timeout (milliseconds)",
					String(currentTimeout),
					"number",
					{
						test: (val) => {
							const timeout = Number.parseInt(String(val), 10);
							return Number.isFinite(timeout) && timeout >= 1000;
						},
					},
				);

				if (result === null) {
					break;
				}

				const timeout = Number.parseInt(String(result), 10);
				if (!Number.isFinite(timeout) || timeout < 1000) {
					toast("Invalid timeout value");
					break;
				}

				await persistStartupTimeout(serverId, timeout);
				toast(`Startup timeout set to ${timeout} ms`);
				break;
			}

			case "edit_init_options": {
				const currentJson = JSON.stringify(
					snapshot.override.initializationOptions || {},
					null,
					2,
				);
				const result = await prompt(
					"Initialization Options (JSON)",
					currentJson || "{}",
					"textarea",
					{
						test: (val) => {
							try {
								JSON.parse(val);
								return true;
							} catch {
								return false;
							}
						},
					},
				);

				if (result === null) {
					break;
				}

				await persistInitOptions(serverId, JSON.parse(result));
				toast("Initialization options updated");
				break;
			}

			case "view_init_options": {
				const json = JSON.stringify(
					snapshot.merged.initializationOptions || {},
					null,
					2,
				);
				alert(
					"Initialization Options",
					`<pre style="overflow: auto; max-height: 60vh; font-size: 12px;">${escapeHtml(json)}</pre>`,
				);
				break;
			}

			case "ext_hover":
			case "ext_completion":
			case "ext_signature":
			case "ext_diagnostics":
			case "ext_inlayHints":
			case "ext_documentHighlights":
			case "ext_formatting": {
				const extKey = key.replace("ext_", "");
				const currentClientConfig = clone(snapshot.override.clientConfig || {});
				const currentBuiltins = currentClientConfig.builtinExtensions || {};

				await persistClientConfig(serverId, {
					...currentClientConfig,
					builtinExtensions: {
						...currentBuiltins,
						[extKey]: value,
					},
				});
				toast(`${extKey} ${value ? "enabled" : "disabled"}`);
				break;
			}

			default:
				break;
		}

		await refreshVisibleState($list, itemsByKey, serverId);
	}
}
