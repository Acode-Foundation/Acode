import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";
import { resolveJsTsLanguageId } from "./shared";

export const tailwindServers: LspServerManifest[] = [
	defineServer({
		id: "tailwindcss",
		label: "Tailwind CSS",
		languages: [
			"html",
			"css",
			"scss",
			"less",
			"javascript",
			"javascriptreact",
			"typescript",
			"typescriptreact",
			"jsx",
			"tsx",
			"vue",
			"svelte",
			"astro",
			"php",
			"mdx",
		],
		runtimes: ["builtin-alpine"],
		command: "tailwindcss-language-server",
		args: ["--stdio"],
		checkCommand: "which tailwindcss-language-server",
		installer: installers.npm({
			executable: "tailwindcss-language-server",
			packages: ["@tailwindcss/language-server"],
		}),
		clientConfig: {
			builtinExtensions: {
				formatting: false,
				signature: false,
			},
		},
		resolveLanguageId: ({ languageId, languageName }) =>
			resolveJsTsLanguageId(languageId, languageName),
		useWorkspaceFolders: true,
		enabled: false,
	}),
];

export const tailwindBundle: LspServerBundle = defineBundle({
	id: "builtin-tailwindcss",
	label: "Tailwind CSS",
	servers: tailwindServers,
});
