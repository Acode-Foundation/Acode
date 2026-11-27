import ts from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";
import crawl, { type CrawlOptions, listedSourceFiles } from "./crawl";
import type ProjectFileSystem from "./fileSystem";
import { joinPath } from "./paths";
import ProjectHost from "./projectHost";
import { compilerDefaults, readDirectory, SOURCE_FILE } from "./scripts";

interface ProjectOptions {
	fs: ProjectFileSystem;
	root: string;
	documents: Map<string, TextDocument>;
	documentsVersion(): string;
	libraries: Record<string, string>;
	registry: ts.DocumentRegistry;
	log(message: string): void;
}

const CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
const DEPENDENCY_DIRECTORIES = new Set([
	"node_modules",
	"bower_components",
	"jspm_packages",
]);
const OUTPUT_DIRECTORIES = new Set(["build", "coverage", "dist", "out"]);
const MAX_DIRECTORIES = 1500;
const MAX_FILES = 3000;
const JAVASCRIPT_FILE = /\.[cm]?jsx?$/i;
const JSCONFIG_DEFAULTS: ts.CompilerOptions = {
	allowJs: true,
	maxNodeModuleJsDepth: 2,
	allowSyntheticDefaultImports: true,
	skipLibCheck: true,
};

export default class Project {
	readonly root: string;
	readonly service: ts.LanguageService;
	#options: ProjectOptions;
	#host: ProjectHost;
	#configPath: string | undefined;
	#loaded = false;
	#openDocuments = new Map<string, TextDocument>();
	#openDocumentsKey = "";
	#snapshots = new Map<string, { version: number; document: TextDocument }>();
	#configErrors = "";

	constructor(options: ProjectOptions) {
		this.#options = options;
		this.root = options.root;
		this.#host = new ProjectHost({
			fs: options.fs,
			root: options.root,
			libraries: options.libraries,
			documentsVersion: options.documentsVersion,
			openDocuments: () => this.#documentsByPath(),
		});
		// Inferred defaults until the config is read, so open files work at once.
		this.#host.configure(compilerDefaults(), []);
		this.service = ts.createLanguageService(this.#host, options.registry);
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Inferred projects keep JavaScript to syntax checks, as before. */
	get checksJavaScript(): boolean {
		return (
			!!this.#configPath && this.#host.getCompilationSettings().checkJs === true
		);
	}

	/** Resolves false when the root cannot be listed, e.g. a single file. */
	async load(onProgress: (message: string) => void): Promise<boolean> {
		const { fs } = this.#options;
		const children = await fs.list(this.root);
		if (!children) return false;
		onProgress("Reading configuration");
		const configName = CONFIG_FILES.find(
			(name) => children.has(name) && !children.get(name)!.isDirectory,
		);
		if (configName) {
			this.#configPath = joinPath(this.root, configName);
			await fs.read(this.#configPath);
		}
		this.refresh();
		await crawl(fs, this.root, {
			...this.#scanOptions(),
			onProgress: (directories, files) =>
				onProgress(`Scanned ${directories} folders, ${files} source files`),
		});
		this.#loaded = true;
		this.refresh();
		return true;
	}

	refresh(): void {
		if (!this.#configPath) {
			const { fs } = this.#options;
			const files = listedSourceFiles(fs, this.root, this.#scanOptions());
			this.#host.configure(compilerDefaults(), files);
			return;
		}
		const parsed = this.#parseConfig(this.#configPath);
		this.#host.configure(
			{ ...parsed.options, noEmit: true },
			parsed.fileNames.slice(0, MAX_FILES),
		);
		if (this.#loaded) this.#reportConfigErrors(parsed.errors);
	}

	pathOf(uri: string): string | undefined {
		const path = this.#options.fs.pathOf(uri);
		return path?.startsWith(`${this.root}/`) ? path : undefined;
	}

	/**
	 * A program without JavaScript support cannot hold JavaScript, as in
	 * tsserver. `checkJs` implies `allowJs` unless that is set explicitly.
	 */
	accepts(fileName: string): boolean {
		const { allowJs, checkJs } = this.#host.getCompilationSettings();
		return !JAVASCRIPT_FILE.test(fileName) || (allowJs ?? checkJs === true);
	}

	uriOf(fileName: string): string | undefined {
		for (const [uri, document] of this.#options.documents) {
			if (this.pathOf(uri) === fileName) return document.uri;
		}
		return this.#options.fs.urlOf(fileName);
	}

	/** Text of a project file, for converting offsets in results to positions. */
	documentOf(fileName: string): TextDocument | undefined {
		const open = this.#documentsByPath().get(fileName);
		if (open) return open;
		const uri = this.uriOf(fileName);
		const text = uri && this.#host.readFile(fileName);
		if (!uri || text === undefined) return undefined;
		const version = this.#options.fs.fileVersion(fileName);
		const cached = this.#snapshots.get(fileName);
		if (cached?.version === version) return cached.document;
		const document = TextDocument.create(uri, "typescript", version, text);
		this.#snapshots.set(fileName, { version, document });
		return document;
	}

	dispose(): void {
		this.service.dispose();
	}

	#parseConfig(configPath: string): ts.ParsedCommandLine {
		const { fs } = this.#options;
		const text = fs.readFile(configPath) ?? "{}";
		const { config } = ts.parseConfigFileTextToJson(configPath, text);
		const host: ts.ParseConfigHost = {
			useCaseSensitiveFileNames: true,
			fileExists: (path) => fs.fileExists(path),
			readFile: (path) => fs.readFile(path),
			// Only what the budgeted crawl listed, so include globs cannot
			// enumerate past the directory cap.
			readDirectory: (path, extensions, excludes, includes, depth) =>
				readDirectory(
					(directory) => fs.listedEntries(directory),
					this.root,
					path,
					extensions,
					excludes,
					includes,
					depth,
				),
		};
		const defaults = configPath.endsWith("jsconfig.json")
			? JSCONFIG_DEFAULTS
			: {};
		return ts.parseJsonConfigFileContent(
			config ?? {},
			host,
			this.root,
			defaults,
			configPath,
		);
	}

	#scanOptions(): CrawlOptions {
		const configured = !!this.#configPath;
		return {
			skipDirectory: (name) =>
				name.startsWith(".") ||
				DEPENDENCY_DIRECTORIES.has(name) ||
				(!configured && OUTPUT_DIRECTORIES.has(name)),
			includeFile: (name) =>
				SOURCE_FILE.test(name) && !name.endsWith(".min.js"),
			maxDirectories: MAX_DIRECTORIES,
			maxFiles: MAX_FILES,
		};
	}

	#reportConfigErrors(errors: readonly ts.Diagnostic[]): void {
		const message = errors
			.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
			.join("\n");
		if (message === this.#configErrors) return;
		this.#configErrors = message;
		if (message) this.#options.log(`${this.#configPath}: ${message}`);
	}

	#documentsByPath(): Map<string, TextDocument> {
		const key = `${this.#options.documentsVersion()}:${this.#options.fs.version}`;
		if (key === this.#openDocumentsKey) return this.#openDocuments;
		this.#openDocumentsKey = key;
		this.#openDocuments = new Map();
		for (const [uri, document] of this.#options.documents) {
			const path = this.pathOf(uri);
			if (path && this.accepts(path)) this.#openDocuments.set(path, document);
		}
		return this.#openDocuments;
	}
}
