import serverRegistry from "cm/lsp/serverRegistry";
import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";
import lspServerDetail from "./lspServerDetail";

/**
 * Get the current override settings for a server
 * @param {string} id Server ID
 * @returns {object} Override settings object
 */
function getServerOverride(id) {
	return appSettings.value?.lsp?.servers?.[id] || {};
}

/**
 * LSP Settings page - shows list of all language servers
 * @returns {object} Settings page interface
 */
export default function lspSettings() {
	const title = strings?.lsp_settings || "Language Servers";
	const servers = serverRegistry.listServers();

	// Sort: enabled servers first, then alphabetically
	const sortedServers = servers.sort((a, b) => {
		const aEnabled = getServerOverride(a.id).enabled ?? a.enabled;
		const bEnabled = getServerOverride(b.id).enabled ?? b.enabled;

		if (aEnabled !== bEnabled) {
			return bEnabled ? 1 : -1;
		}
		return a.label.localeCompare(b.label);
	});

	const items = [];

	for (const server of sortedServers) {
		// Languages info
		const languagesList =
			Array.isArray(server.languages) && server.languages.length
				? server.languages.join(", ")
				: "";

		items.push({
			key: `server:${server.id}`,
			text: server.label,
			info: languagesList || undefined,
		});
	}

	// Add note
	items.push({
		note: "Language servers provide IDE features like autocomplete, diagnostics, and hover information. Enable a server for the languages you work with. Make sure the terminal is installed and the server is installed in the proot environment.",
	});

	return settingsPage(title, items, callback);

	function callback(key) {
		if (key.startsWith("server:")) {
			const id = key.split(":")[1];
			const detailPage = lspServerDetail(id);
			if (detailPage) {
				detailPage.show();
			}
		}
	}
}
