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

function getFeatureItems() {
	return [
		[
			"ext_hover",
			"hover",
			strings["lsp-feature-hover"],
			strings["lsp-feature-hover-info"],
		],
		[
			"ext_completion",
			"completion",
			strings["lsp-feature-completion"],
			strings["lsp-feature-completion-info"],
		],
		[
			"ext_signature",
			"signature",
			strings["lsp-feature-signature"],
			strings["lsp-feature-signature-info"],
		],
		[
			"ext_diagnostics",
			"diagnostics",
			strings["lsp-feature-diagnostics"],
			strings["lsp-feature-diagnostics-info"],
		],
		[
			"ext_inlayHints",
			"inlayHints",
			strings["lsp-feature-inlay-hints"],
			strings["lsp-feature-inlay-hints-info"],
		],
		[
			"ext_documentHighlights",
			"documentHighlights",
			strings["lsp-feature-document-highlights"],
			strings["lsp-feature-document-highlights-info"],
		],
		[
			"ext_formatting",
			"formatting",
			strings["lsp-feature-formatting"],
			strings["lsp-feature-formatting-info"],
		],
	];
}

function fillTemplate(template, replacements) {
	return Object.entries(replacements).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		String(template || ""),
	);
}

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
			return result.version
				? fillTemplate(strings["lsp-status-installed-version"], {
						version: result.version,
					})
				: strings["lsp-status-installed"];
		case "missing":
			return strings["lsp-status-not-installed"];
		case "failed":
			return strings["lsp-status-check-failed"];
		default:
			return strings["lsp-status-unknown"];
	}
}

function formatStartupTimeoutValue(timeout) {
	return typeof timeout === "number"
		? fillTemplate(strings["lsp-timeout-ms"], { timeout })
		: strings["lsp-default"];
}

function sanitizeInstallMessage(message) {
	const lines = String(message || "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter(
			(line) =>
				!/^proot warning:/i.test(line) &&
				!line.includes(`"/proc/self/fd/0"`) &&
				!line.includes(`"/proc/self/fd/1"`) &&
				!line.includes(`"/proc/self/fd/2"`),
		);

	return lines.join(" ");
}

function formatInstallInfo(result) {
	const cleanedMessage = sanitizeInstallMessage(result?.message);

	switch (result?.status) {
		case "present":
			return result.version
				? fillTemplate(strings["lsp-install-info-version-available"], {
						version: result.version,
					})
				: strings["lsp-install-info-ready"];
		case "missing":
			return strings["lsp-install-info-missing"];
		case "failed":
			return cleanedMessage || strings["lsp-install-info-check-failed"];
		default:
			return cleanedMessage || strings["lsp-install-info-unknown"];
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

	const $subtitle = $item.querySelector(".value");
	if ($subtitle) {
		$subtitle.textContent = $subtitle.classList.contains("setting-info")
			? String(item.info || "")
			: formatValue(item.value);
	}

	const $trailingValue = $item.querySelector(".setting-trailing-value");
	if ($trailingValue) {
		$trailingValue.textContent = formatValue(item.value);
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
	const featureItems = getFeatureItems();
	const categories = {
		general: strings["settings-category-general"],
		installation: strings["settings-category-installation"],
		advanced: strings["settings-category-advanced"],
		features: strings["settings-category-features"],
	};
	const items = [
		{
			key: "enabled",
			text: strings["lsp-enabled"],
			checkbox: snapshot.merged.enabled !== false,
			info: strings["settings-info-lsp-server-enabled"],
			category: categories.general,
		},
		{
			key: "install_status",
			text: strings["lsp-installed"],
			value: formatInstallStatus(snapshot.installResult),
			info: formatInstallInfo(snapshot.installResult),
			category: categories.installation,
			chevron: true,
		},
		{
			key: "install_server",
			text: strings["lsp-install-repair"],
			info: strings["settings-info-lsp-install-server"],
			category: categories.installation,
			chevron: true,
		},
		{
			key: "update_server",
			text: strings["lsp-update-server"],
			info: strings["settings-info-lsp-update-server"],
			category: categories.installation,
			chevron: true,
		},
		{
			key: "uninstall_server",
			text: strings["lsp-uninstall-server"],
			info: strings["settings-info-lsp-uninstall-server"],
			category: categories.installation,
			chevron: true,
		},
		{
			key: "startup_timeout",
			text: strings["lsp-startup-timeout"],
			value: formatStartupTimeoutValue(snapshot.merged.startupTimeout),
			info: strings["settings-info-lsp-startup-timeout"],
			category: categories.advanced,
			chevron: true,
		},
		{
			key: "edit_init_options",
			text: strings["lsp-edit-initialization-options"],
			value: Object.keys(snapshot.override.initializationOptions || {}).length
				? strings["lsp-configured"]
				: strings["lsp-empty"],
			info: strings["settings-info-lsp-edit-init-options"],
			category: categories.advanced,
			chevron: true,
		},
		{
			key: "view_init_options",
			text: strings["lsp-view-initialization-options"],
			info: strings["settings-info-lsp-view-init-options"],
			category: categories.advanced,
			chevron: true,
		},
	];

	featureItems.forEach(([key, extKey, text, info]) => {
		items.push({
			key,
			text,
			checkbox: snapshot.builtinExts[extKey] !== false,
			info,
			category: categories.features,
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
			info: formatInstallInfo(snapshot.installResult),
		},
	);
	updateItemDisplay($list, itemsByKey, "install_server", "");
	updateItemDisplay($list, itemsByKey, "update_server", "");
	updateItemDisplay($list, itemsByKey, "uninstall_server", "");
	updateItemDisplay(
		$list,
		itemsByKey,
		"startup_timeout",
		formatStartupTimeoutValue(snapshot.merged.startupTimeout),
	);
	updateItemDisplay(
		$list,
		itemsByKey,
		"edit_init_options",
		Object.keys(snapshot.override.initializationOptions || {}).length
			? strings["lsp-configured"]
			: strings["lsp-empty"],
	);

	getFeatureItems().forEach(([key, extKey]) => {
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
		toast(strings["lsp-server-not-found"]);
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
			message: strings["lsp-checking-installation-status"],
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
			pageClassName: "detail-settings-page",
			listClassName: "detail-settings-list",
			valueInTail: true,
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
			toast(strings["lsp-server-not-found"]);
			return;
		}

		switch (key) {
			case "enabled":
				await persistEnabled(serverId, value);
				if (!value) {
					stopManagedServer(serverId);
				}
				toast(
					value
						? strings["lsp-server-enabled-toast"]
						: strings["lsp-server-disabled-toast"],
				);
				break;

			case "install_status": {
				const result = await checkServerInstallation(snapshot.merged);
				const lines = [
					fillTemplate(strings["lsp-status-line"], {
						status: formatInstallStatus(result),
					}),
					result.version
						? fillTemplate(strings["lsp-version-line"], {
								version: result.version,
							})
						: null,
					fillTemplate(strings["lsp-details-line"], {
						details: formatInstallInfo(result),
					}),
				].filter(Boolean);
				alert(strings["lsp-installation-status"], lines.join("<br>"));
				break;
			}

			case "install_server":
				if (!snapshot.installCommand) {
					toast(strings["lsp-install-command-unavailable"]);
					break;
				}
				await installServer(snapshot.merged, "install");
				break;

			case "update_server":
				if (!snapshot.updateCommand) {
					toast(strings["lsp-update-command-unavailable"]);
					break;
				}
				await installServer(snapshot.merged, "update");
				break;

			case "uninstall_server":
				if (!snapshot.uninstallCommand) {
					toast(strings["lsp-uninstall-command-unavailable"]);
					break;
				}
				if (
					!(await confirm(
						strings["lsp-uninstall-server"],
						fillTemplate(strings["lsp-remove-installed-files"], {
							server: snapshot.liveServer.label || serverId,
						}),
					))
				) {
					break;
				}
				await uninstallServer(snapshot.merged, { promptConfirm: false });
				toast(strings["lsp-server-uninstalled"]);
				break;

			case "startup_timeout": {
				const currentTimeout =
					snapshot.override.startupTimeout ??
					snapshot.liveServer.startupTimeout ??
					5000;
				const result = await prompt(
					strings["lsp-startup-timeout-ms"],
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
					toast(strings["lsp-invalid-timeout"]);
					break;
				}

				await persistStartupTimeout(serverId, timeout);
				toast(
					fillTemplate(strings["lsp-startup-timeout-set"], {
						timeout,
					}),
				);
				break;
			}

			case "edit_init_options": {
				const currentJson = JSON.stringify(
					snapshot.override.initializationOptions || {},
					null,
					2,
				);
				const result = await prompt(
					strings["lsp-initialization-options-json"],
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
				toast(strings["lsp-initialization-options-updated"]);
				break;
			}

			case "view_init_options": {
				const json = JSON.stringify(
					snapshot.merged.initializationOptions || {},
					null,
					2,
				);
				alert(
					strings["lsp-initialization-options"],
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
				const feature = getFeatureItems().find(
					([featureKey]) => featureKey === key,
				);
				const currentClientConfig = clone(snapshot.override.clientConfig || {});
				const currentBuiltins = currentClientConfig.builtinExtensions || {};

				await persistClientConfig(serverId, {
					...currentClientConfig,
					builtinExtensions: {
						...currentBuiltins,
						[extKey]: value,
					},
				});
				toast(
					fillTemplate(strings["lsp-feature-state-toast"], {
						feature: feature?.[2] || extKey,
						state: value
							? strings["lsp-state-enabled"]
							: strings["lsp-state-disabled"],
					}),
				);
				break;
			}

			default:
				break;
		}

		await refreshVisibleState($list, itemsByKey, serverId);
	}
}
