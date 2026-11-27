import { describe, expect, it } from "vitest";
import { diagnostics } from "../../src/cm/lsp/workers/typescript/features";
import {
	definitions,
	implementations,
	references,
	typeDefinitions,
} from "../../src/cm/lsp/workers/typescript/navigation";
import { createWorkspace, projectFiles } from "../helpers/typescriptWorkspace";

describe("TypeScript worker project mode", () => {
	it("resolves unopened project files and node_modules types", async () => {
		const { workspace, open, settle, progress } = createWorkspace(projectFiles);
		workspace.addFolder("file:///p");
		const main = open("file:///p/src/main.ts");

		const found = await settle(() => diagnostics(workspace.target(main)));
		const errors = found.filter((item) => item.severity === 1);

		expect(errors.map((item) => item.code)).toEqual([2322]);
		expect(progress[0]).toBe("begin Loading p");
		expect(progress.at(-1)).toBe("end");
		expect(errors[0].range.start).toEqual({ line: 2, character: 6 });
	});

	it("navigates into unopened files and honours tsconfig include", async () => {
		const { workspace, open, settle } = createWorkspace(projectFiles);
		workspace.addFolder("file:///p");
		const main = open("file:///p/src/main.ts");
		const offset = main.getText().indexOf("greet(");

		const links = await settle(() =>
			definitions(workspace.target(main), offset),
		);
		expect(links).toHaveLength(1);
		expect(links[0].targetUri).toBe("file:///p/src/greet.ts");
		expect(links[0].targetSelectionRange.start).toEqual({
			line: 0,
			character: 16,
		});

		const uris = references(workspace.target(main), offset).map(
			(item) => item.uri,
		);
		expect(uris).toContain("file:///p/src/other.ts");
		expect(uris).not.toContain("file:///p/scripts/tool.ts");
	});

	it("finds implementations and type definitions in unopened files", async () => {
		const { workspace, open, settle } = createWorkspace(projectFiles);
		workspace.addFolder("file:///p");
		const use = open("file:///p/src/use.ts");
		const text = use.getText();

		const found = await settle(() =>
			implementations(workspace.target(use), text.indexOf("area()")),
		);
		expect(found.map((item) => [item.uri, item.range.start.line])).toEqual([
			["file:///p/src/circle.ts", 2],
		]);

		const types = typeDefinitions(
			workspace.target(use),
			text.indexOf("shape.area"),
		);
		expect(types.map((item) => [item.uri, item.range.start.line])).toEqual([
			["file:///p/src/shape.ts", 0],
		]);
	});

	it("infers a project from source files when there is no tsconfig", async () => {
		const { workspace, open, settle } = createWorkspace({
			"file:///q/app.js":
				'import { helper } from "./lib/helper.js";\nhelper();\n',
			"file:///q/lib/helper.js": "export function helper() {}\n",
		});
		workspace.addFolder("file:///q/");
		const app = open("file:///q/app.js", "javascript");
		const offset = app.getText().lastIndexOf("helper");

		const links = await settle(() =>
			definitions(workspace.target(app), offset),
		);
		expect(links.map((link) => link.targetUri)).toEqual([
			"file:///q/lib/helper.js",
		]);
	});

	it("keeps single-file analysis for documents outside any folder", async () => {
		const { workspace, open, settle, progress } = createWorkspace(projectFiles);
		workspace.addFolder("file:///p/src/main.ts");
		const loose = open(
			"untitled:scratch.ts",
			"typescript",
			'const value: number = "text";',
		);

		const found = await settle(() => diagnostics(workspace.target(loose)));
		const errors = found.filter((item) => item.severity === 1);

		expect(errors.map((item) => item.code)).toEqual([2322]);
		expect(workspace.target(loose).fileName).toBe("untitled:scratch.ts");
		expect(progress).toEqual([]);
	});
});
