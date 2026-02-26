import type {
	LSPClient,
	LSPClientConfig,
	LSPClientExtension,
	Transport,
	Workspace,
	WorkspaceFile,
} from "@codemirror/lsp-client";
import type { ChangeSet, Extension, MapMode, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type {
	Diagnostic as LSPDiagnostic,
	FormattingOptions as LSPFormattingOptions,
	Position,
	Range,
	TextEdit,
} from "vscode-languageserver-types";

export type {
	LSPClient,
	LSPClientConfig,
	LSPClientExtension,
	Transport,
	Workspace,
	WorkspaceFile,
	TextEdit,
	LSPFormattingOptions,
	LSPDiagnostic,
	Range,
	Position,
};

export interface WorkspaceFileUpdate {
	file: WorkspaceFile;
	prevDoc: Text;
	changes: ChangeSet;
}

// ============================================================================
// Transport Types
// ============================================================================

export type TransportKind = "websocket" | "stdio" | "external";

export interface WebSocketTransportOptions {
	binary?: boolean;
	timeout?: number;
	reconnect?: boolean;
	maxReconnectAttempts?: number;
}

export interface TransportDescriptor {
	kind: TransportKind;
	url?: string;
	command?: string;
	args?: string[];
	options?: WebSocketTransportOptions;
	protocols?: string[];
	create?: (
		server: LspServerDefinition,
		context: TransportContext,
	) => TransportHandle;
}

export interface TransportHandle {
	transport: Transport;
	dispose: () => Promise<void> | void;
	ready: Promise<void>;
}

export interface TransportContext {
	uri?: string;
	file?: AcodeFile;
	view?: EditorView;
	languageId?: string;
	rootUri?: string | null;
	originalRootUri?: string;
	debugWebSocket?: boolean;
	/** Dynamically discovered port from auto-port discovery */
	dynamicPort?: number;
}

// ============================================================================
// Server Registry Types
// ============================================================================

export interface BridgeConfig {
	kind: "axs";
	/** Optional port - if not provided, auto-port discovery will be used */
	port?: number;
	command: string;
	args?: string[];
	/** Session ID for port file naming (defaults to command name) */
	session?: string;
}

export interface LauncherInstallConfig {
	command: string;
}

export interface LauncherConfig {
	command?: string;
	args?: string[];
	startCommand?: string | string[];
	checkCommand?: string;
	install?: LauncherInstallConfig;
	bridge?: BridgeConfig;
}

export interface BuiltinExtensionsConfig {
	hover?: boolean;
	completion?: boolean;
	signature?: boolean;
	keymaps?: boolean;
	diagnostics?: boolean;
	inlayHints?: boolean;
	documentHighlights?: boolean;
}

export interface AcodeClientConfig {
	useDefaultExtensions?: boolean;
	builtinExtensions?: BuiltinExtensionsConfig;
	extensions?: (Extension | LSPClientExtension)[];
	notificationHandlers?: Record<
		string,
		(client: LSPClient, params: unknown) => boolean
	>;
	workspace?: (client: LSPClient) => Workspace;
	rootUri?: string;
	timeout?: number;
}

export interface LanguageResolverContext {
	languageId: string;
	languageName?: string;
	uri?: string;
	file?: AcodeFile;
}

export interface LspServerDefinition {
	id: string;
	label: string;
	enabled: boolean;
	languages: string[];
	transport: TransportDescriptor;
	initializationOptions?: Record<string, unknown>;
	clientConfig?: AcodeClientConfig;
	startupTimeout?: number;
	capabilityOverrides?: Record<string, unknown>;
	rootUri?: ((uri: string, context: RootUriContext) => string | null) | null;
	resolveLanguageId?:
		| ((context: LanguageResolverContext) => string | null)
		| null;
	launcher?: LauncherConfig;
	/**
	 * When true, uses a single server instance with workspace folders
	 * instead of starting separate servers per project root.
	 * Heavy LSP servers like TypeScript and rust-analyzer should use this.
	 */
	useWorkspaceFolders?: boolean;
}

export interface RootUriContext {
	uri?: string;
	file?: AcodeFile;
	view?: EditorView;
	languageId?: string;
	rootUri?: string;
}

export type RegistryEventType = "register" | "unregister" | "update";

export type RegistryEventListener = (
	event: RegistryEventType,
	server: LspServerDefinition,
) => void;

// ============================================================================
// Client Manager Types
// ============================================================================

export interface FileMetadata {
	uri: string;
	languageId?: string;
	languageName?: string;
	view?: EditorView;
	file?: AcodeFile;
	rootUri?: string;
}

export interface FormattingOptions {
	tabSize?: number;
	insertSpaces?: boolean;
	[key: string]: unknown;
}

export interface ClientManagerOptions {
	diagnosticsUiExtension?: Extension | Extension[];
	clientExtensions?: Extension | Extension[];
	resolveRoot?: (context: RootUriContext) => Promise<string | null>;
	displayFile?: (uri: string) => Promise<EditorView | null>;
	openFile?: (uri: string) => Promise<EditorView | null>;
	resolveLanguageId?: (uri: string) => string | null;
	onClientIdle?: (info: ClientIdleInfo) => void;
}

export interface ClientIdleInfo {
	server: LspServerDefinition;
	client: LSPClient;
	rootUri: string | null;
}

export interface ClientState {
	server: LspServerDefinition;
	client: LSPClient;
	transport: TransportHandle;
	rootUri: string | null;
	attach: (uri: string, view: EditorView) => void;
	detach: (uri: string, view?: EditorView) => void;
	dispose: () => Promise<void>;
}

export interface NormalizedRootUri {
	normalizedRootUri: string | null;
	originalRootUri: string | null;
}

// ============================================================================
// Server Launcher Types
// ============================================================================

export interface ManagedServerEntry {
	uuid: string;
	command: string;
	startedAt: number;
	/** Port number for the axs proxy (for stats endpoint) */
	port?: number;
}

export type InstallStatus = "present" | "declined" | "failed";

/**
 * Port information from auto-port discovery
 */
export interface PortInfo {
	/** The discovered port number */
	port: number;
	/** Path to the port file */
	filePath: string;
	/** Session ID used for the port file */
	session: string;
}

export interface WaitOptions {
	attempts?: number;
	delay?: number;
	probeTimeout?: number;
}

/**
 * Result from ensureServerRunning
 */
export interface EnsureServerResult {
	uuid: string | null;
	/** Port discovered from port file (for auto-port discovery) */
	discoveredPort?: number;
}

/**
 * Stats returned from the axs proxy /status endpoint
 */
export interface LspServerStats {
	program: string;
	processes: Array<{
		pid: number;
		uptime_secs: number;
		memory_bytes: number;
	}>;
}

/**
 * Formatted stats for UI display
 */
export interface LspServerStatsFormatted {
	memoryBytes: number;
	memoryFormatted: string;
	uptimeSeconds: number;
	uptimeFormatted: string;
	pid: number | null;
	processCount: number;
}

// ============================================================================
// Workspace Types
// ============================================================================

export interface WorkspaceOptions {
	displayFile?: (uri: string) => Promise<EditorView | null>;
	openFile?: (uri: string) => Promise<EditorView | null>;
	resolveLanguageId?: (uri: string) => string | null;
}

// ============================================================================
// Diagnostics Types
// ============================================================================

export interface LspDiagnostic {
	from: number;
	to: number;
	severity: "error" | "warning" | "info" | "hint";
	message: string;
	source?: string;
	/** Related diagnostic information (e.g., location of declaration for 'unused' errors) */
	relatedInformation?: DiagnosticRelatedInformation[];
}

/** Related information for a diagnostic (mapped to editor positions) */
export interface DiagnosticRelatedInformation {
	/** Document URI */
	uri: string;
	/** Start position (offset in document) */
	from: number;
	/** End position (offset in document) */
	to: number;
	/** Message describing the relationship */
	message: string;
}

export interface PublishDiagnosticsParams {
	uri: string;
	version?: number;
	diagnostics: RawDiagnostic[];
}

export interface RawDiagnostic {
	range: Range;
	severity?: number;
	code?: number | string;
	source?: string;
	message: string;
	/** Related diagnostic locations from LSP (raw positions) */
	relatedInformation?: RawDiagnosticRelatedInformation[];
}

/** Raw related information from LSP (before position mapping) */
export interface RawDiagnosticRelatedInformation {
	location: {
		uri: string;
		range: Range;
	};
	message: string;
}

// ============================================================================
// Formatter Types
// ============================================================================

export interface AcodeApi {
	registerFormatter: (
		id: string,
		extensions: string[],
		formatter: () => Promise<boolean>,
		label: string,
	) => void;
}

/**
 * Uri utility interface
 */
export interface ParsedUri {
	docId?: string;
	rootUri?: string;
	isFileUri?: boolean;
}

/**
 * Interface representing the LSPPlugin instance API.
 */
export interface LSPPluginAPI {
	/** The document URI this plugin is attached to */
	uri: string;
	/** The LSP client instance */
	client: LSPClient & { sync: () => void; connected?: boolean };
	/** Convert a document offset to an LSP Position */
	toPosition: (offset: number) => { line: number; character: number };
	/** Convert an LSP Position to a document offset */
	fromPosition: (
		pos: { line: number; character: number },
		doc?: unknown,
	) => number;
	/** The currently synced document state */
	syncedDoc: { length: number };
	/** Pending changes that haven't been synced yet */
	unsyncedChanges: {
		mapPos: (pos: number, assoc?: number, mode?: MapMode) => number | null;
		empty: boolean;
	};
	/** Clear pending changes */
	clear: () => void;
}

/**
 * Interface for workspace file with view access
 */
export interface WorkspaceFileWithView {
	version: number;
	getView: () => EditorView | null;
}

/**
 * Interface for workspace with file access
 */
export interface WorkspaceWithFileAccess {
	getFile: (uri: string) => WorkspaceFileWithView | null;
}

/**
 * LSPClient with workspace access (for type casting in notification handlers)
 */
export interface LSPClientWithWorkspace {
	workspace: WorkspaceWithFileAccess;
}

// Extend the LSPClient with Acode-specific properties
declare module "@codemirror/lsp-client" {
	interface LSPClient {
		__acodeLoggedInfo?: boolean;
	}
}
