// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
	addJsTsLanguageAliases,
	isTailwindCssServer,
	resolveJsTsLanguageId,
} from "cm/lsp/servers/shared";

describe("Tailwind document language IDs", () => {
	it("recognizes a custom server and supplies its standard aliases", () => {
		const server = {
			id: "custom-tailwind-test",
			languages: ["tsx"],
			transport: {
				kind: "stdio",
				command: "tailwindcss-language-server",
			},
		};

		expect(isTailwindCssServer(server)).toBe(true);
		expect(addJsTsLanguageAliases(server.languages)).toEqual(
			expect.arrayContaining(["tsx", "typescriptreact"]),
		);
		expect(resolveJsTsLanguageId("tsx", "TSX")).toBe("typescriptreact");
	});
});

describe("workspace folder initialization", () => {
	it("does not notify the server twice for the initial folder", async () => {
		const { default: AcodeWorkspace } = await import("cm/lsp/workspace");
		const workspace = new AcodeWorkspace(
			{ connected: false },
			{ initialFolders: ["file:///data/user/0/app/project/"] },
		);

		expect(
			workspace.hasWorkspaceFolder("file:///data/user/0/app/project/"),
		).toBe(true);
		expect(
			workspace.addWorkspaceFolder("file:///data/user/0/app/project/"),
		).toBe(false);
	});
});
