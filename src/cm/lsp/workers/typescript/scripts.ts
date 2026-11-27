import ts from "typescript";

interface FileSystemEntries {
	files: readonly string[];
	directories: readonly string[];
}

type MatchFiles = (
	path: string,
	extensions: readonly string[] | undefined,
	excludes: readonly string[] | undefined,
	includes: readonly string[] | undefined,
	useCaseSensitiveFileNames: boolean,
	currentDirectory: string,
	depth: number | undefined,
	getFileSystemEntries: (path: string) => FileSystemEntries,
	realpath: (path: string) => string,
) => string[];

export const LIB_DIRECTORY = "/__lib__";
export const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;

// Internal but long-stable; it is what tsserver uses to apply tsconfig
// include/exclude globs to a file system.
const matchFiles = (ts as unknown as { matchFiles?: MatchFiles }).matchFiles;

export function compilerDefaults(): ts.CompilerOptions {
	return {
		allowJs: true,
		checkJs: true,
		allowImportingTsExtensions: true,
		noEmit: true,
		isolatedModules: true,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		moduleDetection: ts.ModuleDetectionKind.Force,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		jsx: ts.JsxEmit.ReactJSX,
		useDefineForClassFields: true,
		allowNonTsExtensions: true,
	} as ts.CompilerOptions;
}

export function readDirectory(
	getEntries: (path: string) => FileSystemEntries,
	currentDirectory: string,
	path: string,
	extensions?: readonly string[],
	excludes?: readonly string[],
	includes?: readonly string[],
	depth?: number,
): string[] {
	if (!matchFiles) return [];
	return matchFiles(
		path,
		extensions,
		excludes,
		includes,
		true,
		currentDirectory,
		depth,
		getEntries,
		(file) => file,
	);
}

export function scriptKind(
	fileName: string,
	languageId?: string,
): ts.ScriptKind {
	if (languageId === "typescriptreact" || languageId === "tsx") {
		return ts.ScriptKind.TSX;
	}
	if (languageId === "javascriptreact" || languageId === "jsx") {
		return ts.ScriptKind.JSX;
	}
	if (languageId === "typescript") return ts.ScriptKind.TS;
	if (languageId === "javascript") return ts.ScriptKind.JS;
	const path = uriPath(fileName).toLowerCase();
	if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
	if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
	if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
	if (path.endsWith(".json")) return ts.ScriptKind.JSON;
	return ts.ScriptKind.Unknown;
}

export function isTypeScriptLanguage(languageId: string): boolean {
	return languageId.startsWith("typescript") || languageId === "tsx";
}

function uriPath(uri: string): string {
	try {
		return new URL(uri).pathname;
	} catch {
		return uri;
	}
}
