import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";

export const pythonServers: LspServerManifest[] = [
	defineServer({
		id: "python",
		label: "Python (pylsp)",
		languages: ["python"],
		command: "pylsp",
		checkCommand: "which pylsp",
		installer: installers.pip({
			executable: "pylsp",
			packages: ["python-lsp-server[all]"],
		}),
		initializationOptions: {
			pylsp: {
				plugins: {
					pyflakes: { enabled: true },
					pycodestyle: { enabled: true },
					mccabe: { enabled: true },
				},
			},
		},
		enabled: true,
	}),
];

export const pythonBundle: LspServerBundle = defineBundle({
	id: "builtin-python",
	label: "Python",
	servers: pythonServers,
});
