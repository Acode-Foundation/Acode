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
		throw new Error("Arguments must be a JSON array");
	}
	return parsed.map((entry) => String(entry));
}

function normalizePackages(value) {
	return String(value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

const INSTALL_METHODS = [
	{ value: "manual", text: "Manual binary" },
	{ value: "apk", text: "APK package" },
	{ value: "npm", text: "npm package" },
	{ value: "pip", text: "pip package" },
	{ value: "cargo", text: "cargo crate" },
	{ value: "shell", text: "Custom shell" },
];

async function promptInstaller(binaryCommand) {
	const method = await select("Install Method", INSTALL_METHODS);
	if (!method) return null;

	switch (method) {
		case "manual": {
			const binaryPath = await prompt(
				"Binary Path (optional)",
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
				`${method.toUpperCase()} Packages (comma separated)`,
				"",
				"text",
			);
			if (packagesInput === null) return null;
			const packages = normalizePackages(packagesInput);
			if (!packages.length) {
				throw new Error("At least one package is required");
			}
			return {
				kind: method,
				source: method,
				executable: String(binaryCommand || "").trim() || undefined,
				packages,
			};
		}
		case "shell": {
			const installCommand = await prompt("Install Command", "", "textarea");
			if (installCommand === null) return null;
			const updateCommand = await prompt(
				"Update Command (optional)",
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
	const title = strings?.lsp_settings || "Language Servers";
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
			text: "Add Custom Server",
			info: "Register a user-defined language server with install, update, and launch commands",
			index: 0,
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
		});
	}

	items.push({
		note: "Language servers provide IDE features like autocomplete, diagnostics, and hover information. You can now install, update, and define custom servers from these settings. Managed installers still run inside the terminal/proot environment.",
	});

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
	});

	async function callback(key) {
		if (key === "add_custom_server") {
			try {
				const idInput = await prompt("Server ID", "", "text");
				if (idInput === null) return;

				const serverId = normalizeServerId(idInput);
				if (!serverId) {
					toast("Server id is required");
					return;
				}

				const label = await prompt("Server Label", serverId, "text");
				if (label === null) return;

				const languageInput = await prompt(
					"Language IDs (comma separated)",
					"",
					"text",
				);
				if (languageInput === null) return;
				const languages = normalizeLanguages(languageInput);
				if (!languages.length) {
					toast("At least one language id is required");
					return;
				}

				const binaryCommand = await prompt("Binary Command", "", "text");
				if (binaryCommand === null) return;
				if (!String(binaryCommand).trim()) {
					toast("Binary command is required");
					return;
				}

				const argsInput = await prompt(
					"Binary Args (JSON array)",
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

				const installer = await promptInstaller(binaryCommand);
				if (installer === null) return;

				const checkCommand = await prompt(
					"Check Command (optional override)",
					"",
					"text",
				);
				if (checkCommand === null) return;

				await upsertCustomServer(serverId, {
					label: String(label || "").trim() || serverId,
					languages,
					transport: { kind: "websocket" },
					launcher: {
						bridge: {
							kind: "axs",
							command: String(binaryCommand).trim(),
							args: parseArgsInput(argsInput),
						},
						checkCommand: String(checkCommand || "").trim() || undefined,
						install: installer,
					},
					enabled: true,
				});

				toast("Custom server added");
				const detailPage = lspServerDetail(serverId);
				detailPage?.show();
			} catch (error) {
				toast(error instanceof Error ? error.message : "Failed to add server");
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
