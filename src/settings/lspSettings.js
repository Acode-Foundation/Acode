import { quoteArg } from "cm/lsp/installRuntime";
import serverRegistry from "cm/lsp/serverRegistry";
import { builtinServers } from "cm/lsp/servers";
import settingsPage from "components/settingsPage";
import toast from "components/toast";
import multiPrompt from "dialogs/multiPrompt";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import appSettings from "lib/settings";
import {
	getServerOverride,
	isCustomServer,
	normalizeLanguages,
	normalizeServerId,
	upsertCustomServer,
} from "./lspConfigUtils";
import lspServerDetail from "./lspServerDetail";

function parseArgsInput(value) {
	const normalized = String(value || "").trim();
	if (!normalized) return [];

	const parsed = JSON.parse(normalized);
	if (!Array.isArray(parsed)) {
		throw new Error(strings["lsp-error-args-must-be-array"]);
	}
	return parsed.map((entry) => String(entry));
}

function normalizePackages(value) {
	return String(value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getInstallMethods() {
	return [
		{ value: "manual", text: strings["lsp-install-method-manual"] },
		{ value: "apk", text: strings["lsp-install-method-apk"] },
		{ value: "npm", text: strings["lsp-install-method-npm"] },
		{ value: "pip", text: strings["lsp-install-method-pip"] },
		{ value: "cargo", text: strings["lsp-install-method-cargo"] },
		{ value: "shell", text: strings["lsp-install-method-shell"] },
	];
}

function getTransportMethods() {
	return [
		{
			value: "stdio",
			text:
				strings["lsp-transport-method-stdio"] ||
				"STDIO (launch a binary command)",
		},
		{
			value: "websocket",
			text:
				strings["lsp-transport-method-websocket"] ||
				"WebSocket (connect to a ws/wss URL)",
		},
	];
}

function parseWebSocketUrl(value) {
	const normalized = String(value || "").trim();
	if (!normalized) {
		throw new Error(
			strings["lsp-error-websocket-url-required"] ||
				"WebSocket URL is required",
		);
	}
	if (!/^wss?:\/\//i.test(normalized)) {
		throw new Error(
			strings["lsp-error-websocket-url-invalid"] ||
				"WebSocket URL must start with ws:// or wss://",
		);
	}
	return normalized;
}

function buildDefaultCheckCommand(binaryCommand, installer) {
	const executable = String(
		installer?.binaryPath || installer?.executable || binaryCommand || "",
	).trim();
	if (!executable) return "";
	if (installer?.kind === "manual" && installer?.binaryPath) {
		return `test -x ${quoteArg(installer.binaryPath)}`;
	}
	if (executable.includes("/")) {
		return `test -x ${quoteArg(executable)}`;
	}
	return `which ${quoteArg(executable)}`;
}

async function promptInstaller(binaryCommand) {
	const method = await select(
		strings["lsp-install-method-title"],
		getInstallMethods(),
	);
	if (!method) return null;

	switch (method) {
		case "manual": {
			const binaryPath = await prompt(
				strings["lsp-binary-path-optional"],
				String(binaryCommand || "").includes("/") ? String(binaryCommand) : "",
				"text",
			);
			if (binaryPath === null) return null;
			return {
				kind: "manual",
				source: "manual",
				executable: String(binaryCommand || "").trim() || undefined,
				binaryPath: String(binaryPath || "").trim() || undefined,
			};
		}
		case "apk":
		case "npm":
		case "pip":
		case "cargo": {
			const packagesInput = await prompt(
				strings["lsp-packages-prompt"].replace(
					"{method}",
					method.toUpperCase(),
				),
				"",
				"text",
			);
			if (packagesInput === null) return null;
			const packages = normalizePackages(packagesInput);
			if (!packages.length) {
				throw new Error(strings["lsp-error-package-required"]);
			}
			return {
				kind: method,
				source: method,
				executable: String(binaryCommand || "").trim() || undefined,
				packages,
			};
		}
		case "shell": {
			const installCommand = await prompt(
				strings["lsp-install-command"],
				"",
				"textarea",
			);
			if (installCommand === null) return null;
			const updateCommand = await prompt(
				strings["lsp-update-command-optional"],
				String(installCommand || ""),
				"textarea",
			);
			if (updateCommand === null) return null;
			return {
				kind: "shell",
				source: "custom",
				executable: String(binaryCommand || "").trim() || undefined,
				command: String(installCommand || "").trim() || undefined,
				updateCommand: String(updateCommand || "").trim() || undefined,
			};
		}
		default:
			return null;
	}
}

/**
 * LSP Settings page - shows list of all language servers
 * @returns {object} Settings page interface
 */
export default function lspSettings() {
	const title =
		strings?.lsp_settings || strings["language servers"] || "Language Servers";
	const categories = {
		customServers: strings["settings-category-custom-servers"],
		behavior: strings["settings-category-behavior"] || "Behavior",
		builtinServers:
			strings["settings-category-builtin-servers"] || "Built-in servers",
		pluginServers:
			strings["settings-category-plugin-servers"] || "Plugin servers",
	};
	let page = createPage();

	return {
		show(goTo) {
			page = createPage();
			page.show(goTo);
		},
		hide() {
			page.hide();
		},
		search(key) {
			page = createPage();
			return page.search(key);
		},
		restoreList() {
			page.restoreList();
		},
		setTitle(nextTitle) {
			page.setTitle(nextTitle);
		},
	};

	function createPage() {
		const servers = serverRegistry.listServers();

		const sortedServers = servers.sort((a, b) => {
			const aEnabled = getServerOverride(a.id).enabled ?? a.enabled;
			const bEnabled = getServerOverride(b.id).enabled ?? b.enabled;

			if (aEnabled !== bEnabled) {
				return bEnabled ? 1 : -1;
			}
			return a.label.localeCompare(b.label);
		});

		const builtinServersList = [];
		const pluginServersList = [];
		const customServersList = [];

		for (const server of sortedServers) {
			const source = server.launcher?.install?.source
				? ` • ${server.launcher.install.source}`
				: "";
			const languagesList =
				Array.isArray(server.languages) && server.languages.length
					? `${server.languages.join(", ")}${source}`
					: source.slice(3);

			const serverItem = {
				key: `server:${server.id}`,
				text: server.label,
				info: languagesList || undefined,
				chevron: true,
			};

			if (builtinServers.some((s) => s.id === server.id)) {
				serverItem.category = categories.builtinServers;
				builtinServersList.push(serverItem);
			} else if (isCustomServer(server.id)) {
				serverItem.category = categories.customServers;
				customServersList.push(serverItem);
			} else {
				serverItem.category = categories.pluginServers;
				pluginServersList.push(serverItem);
			}
		}

		const items = [
			{
				key: "allow_non_terminal_workspace",
				text: strings["lsp-allow-non-terminal-workspace"],
				checkbox: appSettings.value.lsp?.allowNonTerminalWorkspace === true,
				info: strings["settings-info-lsp-allow-non-terminal-workspace"],
				category: categories.behavior,
			},
			...builtinServersList,
			...pluginServersList,
			{
				key: "add_custom_server",
				text: strings["lsp-add-custom-server"],
				info: strings["settings-info-lsp-add-custom-server"],
				category: categories.customServers,
				chevron: true,
			},
			...customServersList,
		];

		items.push({
			note: strings["settings-note-lsp-settings"],
		});

		return settingsPage(title, items, callback, undefined, {
			preserveOrder: true,
			pageClassName: "detail-settings-page",
			listClassName: "detail-settings-list",
			groupByDefault: true,
		});
	}

	function refreshVisiblePage() {
		page.hide();
		page = createPage();
		page.show();
	}

	async function callback(key, value) {
		if (key === "allow_non_terminal_workspace") {
			await appSettings.update({
				lsp: {
					...(appSettings.value.lsp || {}),
					allowNonTerminalWorkspace: value === true,
				},
			});
			return;
		}

		if (key === "add_custom_server") {
			try {
				const USE_WS = true; // default transport; false = STDIO

				const result = await multiPrompt(strings["lsp-add-custom-server"], [
					{
						id: "serverId",
						placeholder: strings["lsp-server-id"],
						type: "text",
						required: true,
						value: "",
					},
					{
						id: "label",
						placeholder: strings["lsp-server-label"],
						type: "text",
						value: "",
					},
					{
						id: "languages",
						placeholder: strings["lsp-language-ids"],
						type: "text",
						required: true,
						value: "",
					},
					[
						"Transport: ",
						{
							id: "useWebSocket",
							placeholder: "WebSocket",
							name: "transportType",
							type: "radio",
							value: USE_WS,
							onchange() {
								if (!!this.value) {
									this.prompt.$body.get("#websocketUrl").hidden = false;
									this.prompt.$body.get("#binaryCommand").hidden = true;
									this.prompt.$body.get("#binaryArgs").hidden = true;
									this.prompt.$body.get("#binaryCommand").value = "";
								}
							},
						},
						{
							id: "useStdio",
							placeholder: "STDIO",
							name: "transportType",
							type: "radio",
							value: !USE_WS,
							onchange() {
								if (!!this.value) {
									this.prompt.$body.get("#websocketUrl").hidden = true;
									this.prompt.$body.get("#websocketUrl").value = "";
									this.prompt.$body.get("#binaryCommand").hidden = false;
									this.prompt.$body.get("#binaryArgs").hidden = false;
								}
							},
						},
					],
					{
						id: "websocketUrl",
						placeholder: "ws://127.0.0.1:3000/",
						type: "text",
						value: "ws://127.0.0.1:3000/",
						hidden: !USE_WS,
					},
					{
						id: "binaryCommand",
						placeholder: strings["lsp-binary-command"],
						type: "text",
						hidden: USE_WS,
						value: "",
					},
					{
						id: "binaryArgs",
						placeholder: strings["lsp-binary-args"],
						type: "textarea",
						hidden: USE_WS,
						value: "[]",
					},
				]);

				if (!result) return; // user cancelled

				const serverId = normalizeServerId(result.serverId);
				if (!serverId) {
					toast(strings["lsp-error-server-id-required"]);
					return;
				}

				const label = result.label || serverId;
				const languages = normalizeLanguages(result.languages);
				if (!languages.length) {
					toast(strings["lsp-error-language-id-required"]);
					return;
				}

				let transport;
				let launcher;

				if (result.useWebSocket) {
					const url = String(result.websocketUrl || "").trim();
					if (!url) {
						toast(
							strings["lsp-error-websocket-url-required"] ||
								"WebSocket URL is required",
						);
						return;
					}
					transport = {
						kind: "websocket",
						url: parseWebSocketUrl(url),
					};
				} else {
					const binaryCommand = String(result.binaryCommand || "").trim();
					if (!binaryCommand) {
						toast(strings["lsp-error-binary-command-required"]);
						return;
					}

					let parsedArgs;
					try {
						parsedArgs = parseArgsInput(result.binaryArgs);
					} catch (err) {
						toast(err.message);
						return;
					}

					const installer = await promptInstaller(binaryCommand);
					if (installer === null) return;

					const defaultCheckCommand = buildDefaultCheckCommand(
						binaryCommand,
						installer,
					);
					const checkCommand = await prompt(
						strings["lsp-check-command-optional"],
						defaultCheckCommand,
						"text",
						{
							placeholder: defaultCheckCommand || "which my-language-server",
						},
					);
					if (checkCommand === null) return;

					transport = {
						kind: "stdio",
						command: binaryCommand,
						args: parsedArgs,
					};
					launcher = {
						bridge: {
							kind: "axs",
							command: binaryCommand,
							args: parsedArgs,
						},
						checkCommand: String(checkCommand || "").trim() || undefined,
						install: installer,
					};
				}

				await upsertCustomServer(serverId, {
					label: String(label || "").trim() || serverId,
					languages,
					transport,
					launcher,
					enabled: true,
				});

				toast(strings["lsp-custom-server-added"]);
				refreshVisiblePage();
				const detailPage = lspServerDetail(serverId);
				detailPage?.show();
			} catch (error) {
				toast(
					error instanceof Error
						? error.message
						: strings["lsp-error-add-server-failed"],
				);
			}
			return;
		}

		if (key.startsWith("server:")) {
			const id = key.split(":")[1];
			const detailPage = lspServerDetail(id);
			if (detailPage) {
				detailPage.show();
			}
		}
	}
}
