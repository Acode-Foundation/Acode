import serverRegistry from "cm/lsp/serverRegistry";
import settingsPage from "components/settingsPage";
import toast from "components/toast";
import alert from "dialogs/alert";
import prompt from "dialogs/prompt";
import appSettings from "lib/settings";

/**
 * Get the current override settings for a server
 * @param {string} id Server ID
 * @returns {object} Override settings object
 */
function getServerOverride(id) {
	return appSettings.value?.lsp?.servers?.[id] || {};
}

/**
 * Merge server definition with user overrides
 * @param {object} server Server definition from registry
 * @returns {object} Merged server configuration
 */
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
	};
}

/**
 * Update LSP server configuration in app settings
 * @param {string} serverId Server ID
 * @param {object} partial Partial configuration to update
 */
async function updateServerConfig(serverId, partial) {
	const current = JSON.parse(JSON.stringify(appSettings.value.lsp || {}));
	current.servers = current.servers || {};
	const nextServer = {
		...(current.servers[serverId] || {}),
	};

	Object.entries(partial || {}).forEach(([key, value]) => {
		if (value === undefined) {
			delete nextServer[key];
			return;
		}
		nextServer[key] = value;
	});

	if (Object.keys(nextServer).length) {
		current.servers[serverId] = nextServer;
	} else {
		delete current.servers[serverId];
	}

	await appSettings.update({ lsp: current }, false);
}

/**
 * LSP Server detail settings page
 * @param {string} serverId - The server ID to show settings for
 * @returns {import('components/settingsPage').SettingsPage}
 */
export default function lspServerDetail(serverId) {
	const server = serverRegistry.getServer(serverId);
	if (!server) {
		toast("Server not found");
		return null;
	}

	const merged = getMergedConfig(server);
	const title = server.label || server.id;

	const items = [];
	const builtinExts = merged.clientConfig?.builtinExtensions || {};

	// Server enable/disable
	items.push({
		key: "enabled",
		text: "Enabled",
		checkbox: merged.enabled,
		info: "Enable or disable this language server",
	});

	// Feature toggles
	items.push({
		key: "ext_hover",
		text: "Hover Information",
		checkbox: builtinExts.hover !== false,
		info: "Show type information and documentation on hover",
	});

	items.push({
		key: "ext_completion",
		text: "Code Completion",
		checkbox: builtinExts.completion !== false,
		info: "Enable autocomplete suggestions from the server",
	});

	items.push({
		key: "ext_signature",
		text: "Signature Help",
		checkbox: builtinExts.signature !== false,
		info: "Show function parameter hints while typing",
	});

	items.push({
		key: "ext_diagnostics",
		text: "Diagnostics",
		checkbox: builtinExts.diagnostics !== false,
		info: "Show errors and warnings from the language server",
	});

	items.push({
		key: "ext_inlayHints",
		text: "Inlay Hints",
		checkbox: builtinExts.inlayHints !== false,
		info: "Show inline type hints in the editor",
	});

	items.push({
		key: "ext_documentHighlights",
		text: "Document Highlights",
		checkbox: builtinExts.documentHighlights !== false,
		info: "Highlight all occurrences of the word under cursor",
	});

	items.push({
		key: "ext_formatting",
		text: "Formatting",
		checkbox: builtinExts.formatting !== false,
		info: "Enable code formatting from the language server",
	});

	if (server.launcher?.install?.command) {
		items.push({
			key: "view_install",
			text: "View Install Command",
			info: "View the command to install this language server",
		});
	}

	// Advanced options
	items.push({
		key: "view_init_options",
		text: "View Initialization Options",
		info: "View the server initialization options as JSON",
	});

	items.push({
		key: "edit_startup_timeout",
		text: "Startup Timeout",
		info:
			typeof merged.startupTimeout === "number"
				? `${merged.startupTimeout} ms`
				: "Default (5000 ms)",
	});

	items.push({
		key: "edit_init_options",
		text: "Edit Initialization Options",
		info: "Edit custom initialization options (JSON)",
	});

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
	});

	async function callback(key, value) {
		const override = getServerOverride(serverId);

		switch (key) {
			case "enabled":
				await updateServerConfig(serverId, { enabled: value });
				// Update the registry so client manager picks it up
				serverRegistry.updateServer(serverId, (current) => ({
					...current,
					enabled: value,
				}));
				toast(value ? "Server enabled" : "Server disabled");
				break;

			case "ext_hover":
			case "ext_completion":
			case "ext_signature":
			case "ext_diagnostics":
			case "ext_inlayHints":
			case "ext_documentHighlights":
			case "ext_formatting": {
				const extKey = key.replace("ext_", "");
				const currentClientConfig = override.clientConfig || {};
				const currentBuiltins = currentClientConfig.builtinExtensions || {};

				await updateServerConfig(serverId, {
					clientConfig: {
						...currentClientConfig,
						builtinExtensions: {
							...currentBuiltins,
							[extKey]: value,
						},
					},
				});
				toast(`${extKey} ${value ? "enabled" : "disabled"}`);
				break;
			}

			case "view_install":
				if (server.launcher?.install?.command) {
					alert("Install Command", server.launcher.install.command);
				}
				break;

			case "view_init_options": {
				const initOpts = merged.initializationOptions || {};
				const json = JSON.stringify(initOpts, null, 2);
				alert(
					"Initialization Options",
					`<pre style="overflow: auto; max-height: 60vh; font-size: 12px;">${escapeHtml(json)}</pre>`,
				);
				break;
			}

			case "edit_startup_timeout": {
				const currentTimeout =
					override.startupTimeout ?? server.startupTimeout ?? 5000;
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

				if (result !== null) {
					const timeout = Number.parseInt(String(result), 10);
					if (!Number.isFinite(timeout) || timeout < 1000) {
						toast("Invalid timeout value");
						break;
					}

					await updateServerConfig(serverId, {
						startupTimeout: timeout,
					});
					serverRegistry.updateServer(serverId, (current) => ({
						...current,
						startupTimeout: timeout,
					}));
					toast(`Startup timeout set to ${timeout} ms`);
				}
				break;
			}

			case "edit_init_options": {
				const currentInitOpts = override.initializationOptions || {};
				const currentJson = JSON.stringify(currentInitOpts, null, 2);

				try {
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

					if (result !== null) {
						const parsed = JSON.parse(result);
						await updateServerConfig(serverId, {
							initializationOptions: parsed,
						});
						toast("Initialization options updated");
					}
				} catch (error) {
					toast("Invalid JSON");
				}
				break;
			}

			default:
				break;
		}
	}
}

/**
 * Escape HTML entities
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}
