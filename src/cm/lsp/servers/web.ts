import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";

export const webServers: LspServerManifest[] = [
	defineServer({
		id: "html",
		label: "HTML (Web Worker)",
		languages: ["html", "vue", "svelte"],
		runtimes: ["web-worker"],
		transport: { kind: "external" },
		clientConfig: {
			builtinExtensions: {
				keymaps: false,
			},
		},
		useWorkspaceFolders: true,
		enabled: true,
	}),
	defineServer({
		id: "css",
		label: "CSS (Web Worker)",
		languages: ["css", "scss", "less"],
		runtimes: ["web-worker"],
		transport: { kind: "external" },
		clientConfig: {
			builtinExtensions: {
				keymaps: false,
			},
		},
		useWorkspaceFolders: true,
		enabled: true,
	}),
	defineServer({
		id: "json",
		label: "JSON (Web Worker)",
		languages: ["json", "jsonc"],
		runtimes: ["web-worker"],
		transport: { kind: "external" },
		clientConfig: {
			builtinExtensions: {
				keymaps: false,
			},
		},
		useWorkspaceFolders: true,
		enabled: true,
	}),
	defineServer({
		id: "html-stdio",
		label: "HTML (STDIO)",
		languages: ["html", "vue", "svelte"],
		runtimes: ["builtin-alpine"],
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
		useWorkspaceFolders: true,
		enabled: false,
	}),
	defineServer({
		id: "css-stdio",
		label: "CSS (STDIO)",
		languages: ["css", "scss", "less"],
		runtimes: ["builtin-alpine"],
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
		useWorkspaceFolders: true,
		enabled: false,
	}),
	defineServer({
		id: "json-stdio",
		label: "JSON (STDIO)",
		languages: ["json", "jsonc"],
		runtimes: ["builtin-alpine"],
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
		useWorkspaceFolders: true,
		enabled: false,
	}),
];

export const webBundle: LspServerBundle = defineBundle({
	id: "builtin-web",
	label: "Web",
	servers: webServers,
});
