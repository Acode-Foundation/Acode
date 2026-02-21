type LanguageMap = { [key: string]: string };
declare const strings: LanguageMap;
declare const ASSETS_DIRECTORY: string;
declare const DATA_STORAGE: string;
declare const CACHE_STORAGE: string;
declare const PLUGIN_DIR: string;
declare const KEYBINDING_FILE: string;
declare const IS_FREE_VERSION: string;
declare const ANDROID_SDK_INT: number;
declare const DOES_SUPPORT_THEME: boolean;
declare const acode: object;

interface Window {
	ASSETS_DIRECTORY: string;
	DATA_STORAGE: string;
	CACHE_STORAGE: string;
	PLUGIN_DIR: string;
	KEYBINDING_FILE: string;
	IS_FREE_VERSION: string;
	ANDROID_SDK_INT: number;
	DOES_SUPPORT_THEME: boolean;
	acode: object;
}

interface String {
	/**
	 * Capitalize the first letter of a string
	 */
	capitalize(): string;
	/**
	 * Generate a hash from a string
	 */
	hash(): string;
}

type ExecutorCallback = (
	type: "stdout" | "stderr" | "exit",
	data: string,
) => void;

interface Executor {
	execute: (command: string, alpine: boolean) => Promise<string>;
	start: (
		command: string,
		callback: ExecutorCallback,
		alpine: boolean,
	) => Promise<string>;
	write: (uuid: string, input: string) => Promise<void>;
	stop: (uuid: string) => Promise<void>;
	isRunning: (uuid: string) => Promise<boolean>;
	/** Move the executor service to the foreground (shows notification) */
	moveToForeground: () => Promise<void>;
	/** Move the executor service to the background (hides notification) */
	moveToBackground: () => Promise<void>;
	/** Stop the executor service completely */
	stopService: () => Promise<void>;
	/**
	 * Background executor
	 */
	BackgroundExecutor: Executor;
}

declare const Executor: Executor | undefined;

interface Window {
	Executor?: Executor;
	editorManager?: EditorManager;
}

interface EditorManager {
	editor?: import("@codemirror/view").EditorView;
	isCodeMirror?: boolean;
	activeFile?: AcodeFile;
	getLspMetadata?: (file: AcodeFile) => LspFileMetadata | null;
}

interface LspFileMetadata {
	uri: string;
	languageId?: string;
	languageName?: string;
	view?: import("@codemirror/view").EditorView;
	file?: AcodeFile;
	rootUri?: string;
}

/**
 * Acode file object
 */
interface AcodeFile {
	uri?: string;
	name?: string;
	session?: unknown;
	cacheFile?: string;
	[key: string]: unknown;
}

// Extend globalThis with Executor
declare global {
	var Executor: Executor | undefined;
}
