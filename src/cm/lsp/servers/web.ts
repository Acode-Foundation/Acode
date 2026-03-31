import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";

export const webServers: LspServerManifest[] = [
	defineServer({
		id: "html",
		label: "HTML",
		languages: ["html", "vue", "svelte"],
		command: "vscode-html-language-server",
		args: ["--stdio"],
		checkCommand: "which vscode-html-language-server",
		installer: installers.npm({
			executable: "vscode-html-language-server",
			packages: ["vscode-langservers-extracted"],
		}),
		clientConfig: {
			builtinExtensions: {
				keymaps: false,
			},
		},
		enabled: true,
	}),
	defineServer({
		id: "css",
		label: "CSS",
		languages: ["css", "scss", "less"],
		command: "vscode-css-language-server",
		args: ["--stdio"],
		checkCommand: "which vscode-css-language-server",
		installer: installers.npm({
			executable: "vscode-css-language-server",
			packages: ["vscode-langservers-extracted"],
		}),
		clientConfig: {
			builtinExtensions: {
				keymaps: false,
			},
		},
		enabled: true,
	}),
	defineServer({
		id: "json",
		label: "JSON",
		languages: ["json", "jsonc"],
		command: "vscode-json-language-server",
		args: ["--stdio"],
		checkCommand: "which vscode-json-language-server",
		installer: installers.npm({
			executable: "vscode-json-language-server",
			packages: ["vscode-langservers-extracted"],
		}),
		clientConfig: {
			builtinExtensions: {
				keymaps: false,
			},
		},
		enabled: true,
	}),
];

export const webBundle: LspServerBundle = defineBundle({
	id: "builtin-web",
	label: "Web",
	servers: webServers,
});
