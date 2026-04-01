import { quoteArg } from "cm/lsp/installRuntime";
import serverRegistry from "cm/lsp/serverRegistry";
import settingsPage from "components/settingsPage";
import toast from "components/toast";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import {
	getServerOverride,
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
		servers: strings["settings-category-servers"],
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

		const items = [
			{
				key: "add_custom_server",
				text: strings["lsp-add-custom-server"],
				info: strings["settings-info-lsp-add-custom-server"],
				category: categories.customServers,
				index: 0,
				chevron: true,
			},
		];

		for (const server of sortedServers) {
			const source = server.launcher?.install?.source
				? ` • ${server.launcher.install.source}`
				: "";
			const languagesList =
				Array.isArray(server.languages) && server.languages.length
					? `${server.languages.join(", ")}${source}`
					: source.slice(3);

			items.push({
				key: `server:${server.id}`,
				text: server.label,
				info: languagesList || undefined,
				category: categories.servers,
				chevron: true,
			});
		}

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

	async function callback(key) {
		if (key === "add_custom_server") {
			try {
				const idInput = await prompt(strings["lsp-server-id"], "", "text");
				if (idInput === null) return;

				const serverId = normalizeServerId(idInput);
				if (!serverId) {
					toast(strings["lsp-error-server-id-required"]);
					return;
				}

				const label = await prompt(
					strings["lsp-server-label"],
					serverId,
					"text",
				);
				if (label === null) return;

				const languageInput = await prompt(
					strings["lsp-language-ids"],
					"",
					"text",
				);
				if (languageInput === null) return;
				const languages = normalizeLanguages(languageInput);
				if (!languages.length) {
					toast(strings["lsp-error-language-id-required"]);
					return;
				}

				const transportKind = await select(
					strings.type || "Type",
					getTransportMethods(),
				);
				if (!transportKind) return;

				let transport;
				let launcher;

				if (transportKind === "websocket") {
					const websocketUrlInput = await prompt(
						strings["lsp-websocket-url"] || "WebSocket URL",
						"ws://127.0.0.1:3000/",
						"text",
						{
							test: (value) => {
								try {
									parseWebSocketUrl(value);
									return true;
								} catch {
									return false;
								}
							},
						},
					);
					if (websocketUrlInput === null) return;

					transport = {
						kind: "websocket",
						url: parseWebSocketUrl(websocketUrlInput),
					};
				} else {
					const binaryCommand = await prompt(
						strings["lsp-binary-command"],
						"",
						"text",
					);
					if (binaryCommand === null) return;
					if (!String(binaryCommand).trim()) {
						toast(strings["lsp-error-binary-command-required"]);
						return;
					}

					const argsInput = await prompt(
						strings["lsp-binary-args"],
						"[]",
						"textarea",
						{
							test: (value) => {
								try {
									parseArgsInput(value);
									return true;
								} catch {
									return false;
								}
							},
						},
					);
					if (argsInput === null) return;

					const parsedArgs = parseArgsInput(argsInput);
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
						command: String(binaryCommand).trim(),
						args: parsedArgs,
					};
					launcher = {
						bridge: {
							kind: "axs",
							command: String(binaryCommand).trim(),
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
