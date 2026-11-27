import { describe, expect, it } from "vitest";
import { diagnostics } from "../../src/cm/lsp/workers/typescript/features";
import {
	references,
	rename,
} from "../../src/cm/lsp/workers/typescript/navigation";
import {
	createWorkspace,
	OPAQUE_ROOT,
	opaqueHost,
	opaqueUrl,
} from "../helpers/typescriptWorkspace";

const MAIN = "export function greet() {}\n";
const NEW = 'import { greet } from "./main";\ngreet();\n';

describe("TypeScript project membership", () => {
	it("keeps a new file in an inferred project after its tab closes", async () => {
		const files: Record<string, string> = { "file:///q/main.ts": MAIN };
		const { workspace, open, close, settle } = createWorkspace(files);
		workspace.addFolder("file:///q");
		const main = open("file:///q/main.ts");
		await settle(() => diagnostics(workspace.target(main)));

		files["file:///q/new.ts"] = NEW;
		open("file:///q/new.ts");
		await settle(() => diagnostics(workspace.target(main)));
		close("file:///q/new.ts");

		const offset = main.getText().indexOf("greet");
		const uris = await settle(() =>
			references(workspace.target(main), offset).map((item) => item.uri),
		);
		expect(uris).toContain("file:///q/new.ts");
		const edits = rename(workspace.target(main), offset, "hello");
		expect(edits?.changes?.["file:///q/new.ts"]).toHaveLength(2);
	});

	it("keeps a new file in an inferred project on opaque providers", async () => {
		const files: Record<string, string> = { "app/main.ts": MAIN };
		const { workspace, open, close, settle } = createWorkspace(
			files,
			opaqueHost(files),
		);
		workspace.addFolder(OPAQUE_ROOT);
		const main = open(opaqueUrl("app/main.ts"), "typescript", MAIN);
		await settle(() => diagnostics(workspace.target(main)));

		files["app/new.ts"] = NEW;
		open(opaqueUrl("app/new.ts"), "typescript", NEW);
		await settle(() => diagnostics(workspace.target(main)));
		close(opaqueUrl("app/new.ts"));

		const uris = await settle(() =>
			references(workspace.target(main), main.getText().indexOf("greet")).map(
				(item) => item.uri,
			),
		);
		expect(uris).toContain(opaqueUrl("app/new.ts"));
	});

	it("treats checkJs as enabling JavaScript unless allowJs is false", async () => {
		const script = '/** @type {number} */\nexport const value = "text";\n';
		const errorsFor = async (compilerOptions: Record<string, boolean>) => {
			const files = {
				"file:///j/tsconfig.json": JSON.stringify({ compilerOptions }),
				"file:///j/app.js": script,
			};
			const { workspace, open, settle } = createWorkspace(files);
			workspace.addFolder("file:///j");
			const app = open("file:///j/app.js", "javascript");
			return settle(() =>
				diagnostics(workspace.target(app))
					.filter((item) => item.severity === 1)
					.map((item) => item.code),
			);
		};

		expect(await errorsFor({ checkJs: true })).toEqual([2322]);
		expect(await errorsFor({ checkJs: true, allowJs: false })).toEqual([]);
	});

	it("uses the deepest folder's config whatever the order added", async () => {
		const files = {
			"file:///n/tsconfig.json": JSON.stringify({
				compilerOptions: { strict: false },
			}),
			"file:///n/child/tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true },
			}),
			"file:///n/child/main.ts":
				"export function echo(value) {\n\treturn value;\n}\n",
		};
		const { workspace, open, settle } = createWorkspace(files);
		workspace.addFolder("file:///n");
		workspace.addFolder("file:///n/child");
		const main = open("file:///n/child/main.ts");

		const errors = await settle(() =>
			diagnostics(workspace.target(main))
				.filter((item) => item.severity === 1)
				.map((item) => item.code),
		);
		expect(errors).toEqual([7006]);
	});

	it("loads folders whose decoded names contain percent signs", async () => {
		const files = {
			"file:///100%done/main.ts": 'export const value: number = "text";\n',
		};
		const { workspace, open, settle, progress } = createWorkspace(files);
		workspace.addFolder("file:///100%done");
		const main = open("file:///100%done/main.ts");

		const errors = await settle(() =>
			diagnostics(workspace.target(main)).filter((item) => item.severity === 1),
		);
		expect(progress[0]).toBe("begin Loading 100%done");
		expect(workspace.target(main).fileName).toBe("/100%done/main.ts");
		expect(errors.map((item) => item.code)).toEqual([2322]);
	});
});
