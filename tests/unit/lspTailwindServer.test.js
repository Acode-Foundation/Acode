import { describe, expect, it } from "vitest";
import { tailwindServers } from "cm/lsp/servers/tailwind";

describe("built-in Tailwind CSS language server", () => {
	it("is available but disabled by default", () => {
		const server = tailwindServers.find(({ id }) => id === "tailwindcss");

		expect(server).toBeDefined();
		expect(server.enabled).toBe(false);
		expect(server.useWorkspaceFolders).toBe(true);
		expect(server.launcher.bridge).toMatchObject({
			command: "tailwindcss-language-server",
			args: ["--stdio"],
		});
		expect(server.launcher.install).toMatchObject({
			kind: "npm",
			executable: "tailwindcss-language-server",
			packages: ["@tailwindcss/language-server"],
		});
		expect(
			server.resolveLanguageId({ languageId: "tsx", languageName: "TSX" }),
		).toBe("typescriptreact");
	});
});
