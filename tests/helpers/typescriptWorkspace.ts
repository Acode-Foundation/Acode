import fs from "node:fs";
import path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { FileSystemHost } from "../../src/cm/lsp/workers/typescript/fileSystem";
import TypeScriptWorkspace from "../../src/cm/lsp/workers/typescript/workspace";

interface ListingHost extends FileSystemHost {
	listings: string[];
}

const libDirectory = path.dirname(
	require.resolve("typescript/lib/lib.es5.d.ts"),
);
const libraries = Object.fromEntries(
	fs
		.readdirSync(libDirectory)
		.filter((name) => /^lib\..+\.d\.ts$/.test(name))
		.map((name) => [
			name,
			fs.readFileSync(path.join(libDirectory, name), "utf8"),
		]),
);

/** A tsconfig project with an unopened sibling, a package and an excluded file. */
export const projectFiles = {
	"file:///p/tsconfig.json": JSON.stringify({
		compilerOptions: {
			strict: true,
			target: "es2022",
			moduleResolution: "bundler",
			module: "esnext",
		},
		include: ["src"],
	}),
	"file:///p/src/main.ts": [
		'import { greet } from "./greet";',
		'import { pad } from "padder";',
		'const total: number = greet("x");',
		"export const padded = pad(1);",
	].join("\n"),
	"file:///p/src/greet.ts":
		"export function greet(name: string): string {\n\treturn name;\n}\n",
	"file:///p/src/other.ts":
		'import { greet } from "./greet";\nexport const other = greet("y");\n',
	"file:///p/src/shape.ts": "export interface Shape {\n\tarea(): number;\n}\n",
	"file:///p/src/circle.ts":
		'import type { Shape } from "./shape";\nexport class Circle implements Shape {\n\tarea() {\n\t\treturn 1;\n\t}\n}\n',
	"file:///p/src/use.ts":
		'import type { Shape } from "./shape";\nexport function size(shape: Shape) {\n\treturn shape.area();\n}\n',
	"file:///p/scripts/tool.ts":
		'import { greet } from "../src/greet";\ngreet("z");\n',
	"file:///p/node_modules/padder/package.json": JSON.stringify({
		name: "padder",
		types: "index.d.ts",
	}),
	"file:///p/node_modules/padder/index.d.ts":
		"export declare function pad(value: number): string;\n",
};

/** A TypeScript workspace over in-memory files, driven like the worker. */
export function createWorkspace(
	files: Record<string, string>,
	host: ListingHost = memoryHost(files),
) {
	const documents = new Map<string, TextDocument>();
	const progress: string[] = [];
	const logs: string[] = [];
	let version = 0;
	let changes = 0;
	const workspace = new TypeScriptWorkspace({
		documents,
		documentsVersion: () => String(version),
		libraries,
		host,
		onChange: () => changes++,
		log: (message) => logs.push(message),
		progress: (title) => {
			progress.push(`begin ${title}`);
			return {
				report: () => progress.push("report"),
				end: () => progress.push("end"),
			};
		},
	});
	const open = (uri: string, languageId = "typescript", text = files[uri]) => {
		const document = TextDocument.create(uri, languageId, 1, text ?? "");
		documents.set(uri, document);
		version++;
		workspace.documentOpened(uri);
		return document;
	};
	const change = (document: TextDocument, text: string) => {
		TextDocument.update(document, [{ text }], document.version + 1);
		version++;
	};
	const close = (uri: string) => {
		documents.delete(uri);
		version++;
		workspace.documentClosed(uri);
	};
	/** Repeat a query until background file loading stops producing changes. */
	const settle = async <T>(query: () => T): Promise<T> => {
		for (let attempt = 0; attempt < 40; attempt++) {
			const before = changes;
			const result = query();
			await new Promise((resolve) => setTimeout(resolve, 400));
			if (changes === before) return result;
		}
		throw new Error("TypeScript project did not settle");
	};
	return { workspace, open, change, close, settle, progress, logs, host };
}

/** `file:` URLs listed like the internal filesystem: decoded, slash-joined. */
export function memoryHost(files: Record<string, string>): ListingHost {
	const listings: string[] = [];
	return {
		listings,
		async readDirectory(url) {
			listings.push(url);
			const prefix = url.endsWith("/") ? url : `${url}/`;
			const entries = new Map<
				string,
				{ name: string; url: string; isDirectory: boolean }
			>();
			for (const file of Object.keys(files)) {
				if (!file.startsWith(prefix)) continue;
				const [name, ...rest] = file.slice(prefix.length).split("/");
				entries.set(name, {
					name,
					url: prefix + name,
					isDirectory: rest.length > 0,
				});
			}
			if (!entries.size) throw new Error(`${url} is not a directory`);
			return [...entries.values()];
		},
		async readFile(url) {
			if (!(url in files)) throw new Error(`${url} does not exist`);
			return files[url];
		},
	};
}

/**
 * Storage-access-framework style URIs: the tree root and its documents have
 * unrelated shapes (`tree/app` vs `tree/app::app/src`), so paths can only
 * come from listings. `files` is keyed by the document path (`app/src/a.ts`).
 */
export function opaqueHost(files: Record<string, string>): ListingHost {
	const listings: string[] = [];
	return {
		listings,
		async readDirectory(url) {
			listings.push(url);
			const directory = opaqueDocument(url);
			const entries = new Map<
				string,
				{ name: string; url: string; isDirectory: boolean }
			>();
			for (const file of Object.keys(files)) {
				if (!file.startsWith(`${directory}/`)) continue;
				const [name, ...rest] = file.slice(directory.length + 1).split("/");
				entries.set(name, {
					name,
					url: opaqueUrl(`${directory}/${name}`),
					isDirectory: rest.length > 0,
				});
			}
			if (!entries.size) throw new Error(`${url} is not a directory`);
			return [...entries.values()];
		},
		async readFile(url) {
			const document = opaqueDocument(url);
			if (!(document in files)) throw new Error(`${url} does not exist`);
			return files[document];
		},
	};
}

export const OPAQUE_ROOT = "content://docs/tree/app";

export function opaqueUrl(document: string): string {
	return `${OPAQUE_ROOT}::${document}`;
}

function opaqueDocument(url: string): string {
	return url === OPAQUE_ROOT ? "app" : url.slice(OPAQUE_ROOT.length + 2);
}
