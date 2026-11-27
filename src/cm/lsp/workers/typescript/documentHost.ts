import ts from "typescript";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { compilerDefaults, scriptKind } from "./scripts";

const RELATIVE_CANDIDATES = [
	"",
	".ts",
	".tsx",
	".js",
	".jsx",
	"/index.ts",
	"/index.tsx",
	"/index.js",
	"/index.jsx",
];

/**
 * Single-file mode: open editor documents, keyed by URI, plus the bundled
 * lib files. Serves every document that no project folder can claim.
 */
export default class DocumentHost implements ts.LanguageServiceHost {
	#options = compilerDefaults();
	#documents: Map<string, TextDocument>;
	#libraries: Record<string, string>;
	#isProjectDocument: (uri: string) => boolean;
	#projectVersion: () => string;

	constructor(
		documents: Map<string, TextDocument>,
		libraries: Record<string, string>,
		isProjectDocument: (uri: string) => boolean,
		projectVersion: () => string,
	) {
		this.#documents = documents;
		this.#libraries = libraries;
		this.#isProjectDocument = isProjectDocument;
		this.#projectVersion = projectVersion;
	}

	getCompilationSettings(): ts.CompilerOptions {
		return this.#options;
	}

	getCurrentDirectory(): string {
		return "/";
	}

	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return ts.getDefaultLibFileName(options);
	}

	getScriptFileNames(): string[] {
		return [...this.#documents.keys()].filter(
			(uri) => !this.#isProjectDocument(uri),
		);
	}

	getScriptVersion(fileName: string): string {
		const document = this.#documents.get(fileName);
		return document ? String(document.version) : "1";
	}

	getProjectVersion(): string {
		return this.#projectVersion();
	}

	getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
		const text = this.readFile(fileName);
		return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
	}

	getScriptKind(fileName: string): ts.ScriptKind {
		return scriptKind(fileName, this.#documents.get(fileName)?.languageId);
	}

	fileExists(fileName: string): boolean {
		return this.#documents.has(fileName) || fileName in this.#libraries;
	}

	readFile(fileName: string): string | undefined {
		return (
			this.#documents.get(fileName)?.getText() ?? this.#libraries[fileName]
		);
	}

	readDirectory(): string[] {
		return this.getScriptFileNames();
	}

	directoryExists(): boolean {
		return true;
	}

	getDirectories(): string[] {
		return [];
	}

	useCaseSensitiveFileNames(): boolean {
		return true;
	}

	getNewLine(): string {
		return "\n";
	}

	resolveModuleNames(
		moduleNames: string[],
		containingFile: string,
	): (ts.ResolvedModule | undefined)[] {
		return moduleNames.map(
			(moduleName) =>
				this.#resolveOpenDocument(moduleName, containingFile) ??
				ts.resolveModuleName(moduleName, containingFile, this.#options, this)
					.resolvedModule,
		);
	}

	#resolveOpenDocument(
		moduleName: string,
		containingFile: string,
	): ts.ResolvedModule | undefined {
		if (!moduleName.startsWith(".") && !/^[a-z]+:/i.test(moduleName)) {
			return undefined;
		}
		let base: string;
		try {
			base = new URL(moduleName, containingFile).href;
		} catch {
			return undefined;
		}
		const resolvedFileName = RELATIVE_CANDIDATES.map(
			(suffix) => `${base}${suffix}`,
		).find((candidate) => this.#documents.has(candidate));
		return resolvedFileName
			? { resolvedFileName, isExternalLibraryImport: false }
			: undefined;
	}
}
