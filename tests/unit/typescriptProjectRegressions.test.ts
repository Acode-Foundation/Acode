import { describe, expect, it } from "vitest";
import { diagnostics } from "../../src/cm/lsp/workers/typescript/features";
import {
	definitions,
	rename,
} from "../../src/cm/lsp/workers/typescript/navigation";
import {
	createWorkspace,
	OPAQUE_ROOT,
	opaqueHost,
	opaqueUrl,
	projectFiles,
} from "../helpers/typescriptWorkspace";

const GREET = "file:///p/src/greet.ts";

describe("TypeScript project regressions", () => {
	it("reports current positions after a file is edited, saved and closed", async () => {
		const files: Record<string, string> = { ...projectFiles };
		const { workspace, open, change, close, settle } = createWorkspace(files);
		workspace.addFolder("file:///p");
		const main = open("file:///p/src/main.ts");
		const offset = main.getText().indexOf("greet(");
		const before = await settle(() =>
			definitions(workspace.target(main), offset),
		);
		expect(before[0].targetSelectionRange.start).toEqual({
			line: 0,
			character: 16,
		});

		const saved = `// one\n// two\n// three\n${files[GREET]}`;
		change(open(GREET), saved);
		files[GREET] = saved;
		close(GREET);

		const after = await settle(() =>
			definitions(workspace.target(main), offset),
		);
		const declaration = { line: 3, character: 16 };
		expect(after[0].targetSelectionRange.start).toEqual(declaration);
		const edits = rename(workspace.target(main), offset, "hello");
		expect(edits?.changes?.[GREET]?.[0].range.start).toEqual(declaration);
	});

	it("adds a file created after loading to its project", async () => {
		const files: Record<string, string> = {
			...projectFiles,
			"file:///p/src/helper.ts": "export const helper = 1;\n",
		};
		const { workspace, open, settle } = createWorkspace(files);
		workspace.addFolder("file:///p");
		const main = open("file:///p/src/main.ts");
		await settle(() => diagnostics(workspace.target(main)));

		files["file:///p/src/new.ts"] =
			'import { helper } from "./helper";\nexport const value: string = helper;\n';
		const created = open("file:///p/src/new.ts");
		const errors = await settle(() =>
			diagnostics(workspace.target(created)).filter(
				(item) => item.severity === 1,
			),
		);

		expect(workspace.target(created).fileName).toBe("/p/src/new.ts");
		expect(errors.map((item) => item.code)).toEqual([2322]);
	});

	it("maps new files under opaque provider URIs from fresh listings", async () => {
		const files: Record<string, string> = {
			"app/tsconfig.json": "{}",
			"app/src/main.ts": "export const main = 1;\n",
			"app/src/helper.ts": "export const helper = 1;\n",
		};
		const { workspace, open, settle } = createWorkspace(
			files,
			opaqueHost(files),
		);
		workspace.addFolder(OPAQUE_ROOT);
		const main = open(
			opaqueUrl("app/src/main.ts"),
			"typescript",
			files["app/src/main.ts"],
		);
		await settle(() => diagnostics(workspace.target(main)));

		const source =
			'import { helper } from "./helper";\nexport const value: string = helper;\n';
		files["app/src/new.ts"] = source;
		files["app/top.ts"] = "export const top = 1;\n";
		const nested = open(opaqueUrl("app/src/new.ts"), "typescript", source);
		const topLevel = open(
			opaqueUrl("app/top.ts"),
			"typescript",
			files["app/top.ts"],
		);
		const errors = await settle(() =>
			diagnostics(workspace.target(nested)).filter(
				(item) => item.severity === 1,
			),
		);

		expect(workspace.target(nested).fileName).toMatch(
			/^\/ws\d+\/src\/new\.ts$/,
		);
		expect(workspace.target(topLevel).fileName).toMatch(/^\/ws\d+\/top\.ts$/);
		expect(errors.map((item) => item.code)).toEqual([2322]);
	});

	it("inherits compiler options from a parent folder config", async () => {
		const files = {
			"file:///m/tsconfig.base.json": JSON.stringify({
				compilerOptions: { strict: true },
			}),
			"file:///m/app/tsconfig.json": JSON.stringify({
				extends: "../tsconfig.base.json",
			}),
			"file:///m/app/index.ts":
				"export function echo(value) {\n\treturn value;\n}\n",
		};
		const { workspace, open, settle, logs } = createWorkspace(files);
		workspace.addFolder("file:///m/app");
		const index = open("file:///m/app/index.ts");

		const errors = await settle(() =>
			diagnostics(workspace.target(index)).filter(
				(item) => item.severity === 1,
			),
		);

		expect(errors.map((item) => item.code)).toEqual([7006]);
		expect(logs.filter((line) => line.includes("tsconfig"))).toEqual([]);
	});

	it("logs a config that extends an unreadable file", async () => {
		const files = {
			"file:///m/app/tsconfig.json": JSON.stringify({
				extends: "../missing.json",
			}),
			"file:///m/app/index.ts": "export const value = 1;\n",
		};
		const { workspace, open, settle, logs } = createWorkspace(files);
		workspace.addFolder("file:///m/app");
		const index = open("file:///m/app/index.ts");

		await settle(() => diagnostics(workspace.target(index)));

		expect(logs.some((line) => line.includes("missing.json"))).toBe(true);
	});

	it("keeps configured projects within the directory budget", async () => {
		const files: Record<string, string> = {
			"file:///big/tsconfig.json": "{}",
			"file:///big/main.ts": "export const main = 1;\n",
		};
		for (let index = 0; index < 1505; index++) {
			files[`file:///big/d${index}/f.ts`] = `export const f${index} = 1;\n`;
		}
		const { workspace, open, settle, host } = createWorkspace(files);
		workspace.addFolder("file:///big");
		const main = open("file:///big/main.ts");

		await settle(() => diagnostics(workspace.target(main)));
		const inside = host.listings.filter(
			(url) => url === "file:///big" || url.startsWith("file:///big/"),
		);
		const program = workspace.target(main).service.getProgram();
		const sources = program
			?.getRootFileNames()
			.filter((name) => name.startsWith("/big/"));

		expect(inside.length).toBeLessThanOrEqual(1500);
		expect(sources?.length).toBeLessThanOrEqual(1500);
	});
});
