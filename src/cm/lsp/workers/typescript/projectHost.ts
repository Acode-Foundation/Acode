import ts from "typescript";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type ProjectFileSystem from "./fileSystem";
import { LIB_DIRECTORY, readDirectory, scriptKind } from "./scripts";

interface ProjectHostOptions {
	fs: ProjectFileSystem;
	root: string;
	libraries: Record<string, string>;
	openDocuments(): Map<string, TextDocument>;
	documentsVersion(): string;
}

export default class ProjectHost implements ts.LanguageServiceHost {
	#options: ProjectHostOptions;
	#compilerOptions: ts.CompilerOptions = {};
	#rootFiles: string[] = [];
	#configurationKey = "";
	#configurationVersion = 0;
	#seenFileSystemVersion = -1;
	#resolutionsInvalidated = false;

	constructor(options: ProjectHostOptions) {
		this.#options = options;
	}

	configure(compilerOptions: ts.CompilerOptions, rootFiles: string[]): void {
		const key = JSON.stringify([compilerOptions, rootFiles]);
		if (key === this.#configurationKey) return;
		this.#configurationKey = key;
		this.#compilerOptions = compilerOptions;
		this.#rootFiles = rootFiles;
		this.#configurationVersion++;
	}

	getProjectVersion(): string {
		// Called once per program synchronization: newly fetched files can turn
		// earlier failed module lookups into hits, so resolve everything again.
		const { fs, documentsVersion } = this.#options;
		this.#resolutionsInvalidated = fs.version !== this.#seenFileSystemVersion;
		this.#seenFileSystemVersion = fs.version;
		return `${fs.version}:${documentsVersion()}:${this.#configurationVersion}`;
	}

	// TypeScript calls this detached from the host, so it must not rely on
	// method binding.
	hasInvalidatedResolutions = (): boolean => this.#resolutionsInvalidated;

	getCompilationSettings(): ts.CompilerOptions {
		return this.#compilerOptions;
	}

	getCurrentDirectory(): string {
		return this.#options.root;
	}

	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return `${LIB_DIRECTORY}/${ts.getDefaultLibFileName(options)}`;
	}

	getScriptFileNames(): string[] {
		const names = new Set(this.#rootFiles);
		for (const path of this.#options.openDocuments().keys()) names.add(path);
		return [...names];
	}

	getScriptVersion(fileName: string): string {
		const document = this.#options.openDocuments().get(fileName);
		if (document) return `d${document.version}`;
		return `f${this.#options.fs.fileVersion(fileName)}`;
	}

	getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
		const text = this.readFile(fileName);
		return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
	}

	getScriptKind(fileName: string): ts.ScriptKind {
		const document = this.#options.openDocuments().get(fileName);
		return scriptKind(fileName, document?.languageId);
	}

	readFile(fileName: string): string | undefined {
		const document = this.#options.openDocuments().get(fileName);
		if (document) return document.getText();
		return this.#library(fileName) ?? this.#options.fs.readFile(fileName);
	}

	fileExists(fileName: string): boolean {
		return (
			this.#options.openDocuments().has(fileName) ||
			this.#library(fileName) !== undefined ||
			this.#options.fs.fileExists(fileName)
		);
	}

	directoryExists(directoryName: string): boolean {
		return (
			directoryName === LIB_DIRECTORY ||
			this.#options.fs.directoryExists(directoryName)
		);
	}

	getDirectories(directoryName: string): string[] {
		return this.#options.fs.getEntries(directoryName).directories;
	}

	readDirectory(
		path: string,
		extensions?: readonly string[],
		exclude?: readonly string[],
		include?: readonly string[],
		depth?: number,
	): string[] {
		const { fs, root } = this.#options;
		return readDirectory(
			(directory) => fs.getEntries(directory),
			root,
			path,
			extensions,
			exclude,
			include,
			depth,
		);
	}

	realpath(path: string): string {
		return path;
	}

	useCaseSensitiveFileNames(): boolean {
		return true;
	}

	getNewLine(): string {
		return "\n";
	}

	#library(fileName: string): string | undefined {
		if (!fileName.startsWith(`${LIB_DIRECTORY}/`)) return undefined;
		return this.#options.libraries[fileName.slice(LIB_DIRECTORY.length + 1)];
	}
}
