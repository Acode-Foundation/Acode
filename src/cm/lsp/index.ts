import "./runtimes/registerBuiltins";

export {
	bundles,
	default as lspApi,
	defineBundle,
	defineServer,
	installers,
	register,
	registerRuntime,
	runtimes,
	servers,
	unregisterRuntime,
	upsert,
	workers,
} from "./api";
export type {
	LspWorkerHostHandler,
	LspWorkerTransportOptions,
} from "./api";
export { createWorkerTransport } from "./workerTransport";
export { default as clientManager, LspClientManager } from "./clientManager";
export type { CodeActionItem } from "./codeActions";
export {
	CODE_ACTION_KINDS,
	executeCodeAction,
	fetchCodeActions,
	formatCodeActionKind,
	getCodeActionIcon,
	performQuickFix,
	showCodeActionsMenu,
	supportsCodeActions,
} from "./codeActions";
export {
	clearDiagnosticsEffect,
	getLspDiagnostics,
	LSP_DIAGNOSTICS_EVENT,
	lspDiagnosticsClientExtension,
	lspDiagnosticsExtension,
	lspDiagnosticsUiExtension,
} from "./diagnostics";
export type {
	DocumentSymbolsResult,
	FlatSymbol,
	ProcessedSymbol,
} from "./documentSymbols";
export {
	fetchDocumentSymbols,
	getDocumentSymbols,
	getDocumentSymbolsFlat,
	getSymbolKindIcon,
	getSymbolKindName,
	navigateToSymbol,
	SymbolKind,
	supportsDocumentSymbols,
} from "./documentSymbols";
export { registerLspFormatter } from "./formatter";
export type {
	DocumentColorsConfig,
	LspDocumentColor,
} from "./documentColors";
export {
	cssToLspColor,
	didReplaceLspDocumentColors,
	documentColorsClientExtension,
	documentColorsEditorExtension,
	documentColorsExtension,
	hasColorProvider,
	lspColorToCss,
	lspColorToHex,
	lspDocumentColorsField,
} from "./documentColors";
export type { InlayHintsConfig } from "./inlayHints";
export {
	inlayHintsClientExtension,
	inlayHintsEditorExtension,
	inlayHintsExtension,
} from "./inlayHints";
export {
	addLspLog,
	clearLspLogs,
	getLspLogs,
	onLspLog,
	type LspLogEntry,
	type LspLogLevel,
} from "./logs";
export {
	closeReferencesPanel,
	findAllReferences,
	findAllReferencesInTab,
} from "./references";
export {
	acodeRenameExtension,
	acodeRenameKeymap,
	renameSymbol,
} from "./rename";
export {
	ensureServerRunning,
	resetManagedServers,
	stopManagedServer,
} from "./serverLauncher";
export {
	BUILTIN_ALPINE_RUNTIME_ID,
	EXTERNAL_WEBSOCKET_RUNTIME_ID,
	getRuntimeProvider,
	inferWorkspaceKind,
	isBuiltinAlpineAccessible,
	listRuntimeProviders,
	registerRuntimeProvider,
	selectRuntimeProvider,
	unregisterRuntimeProvider,
	WEB_WORKER_RUNTIME_ID,
} from "./runtimeProviders";
export {
	checkRuntimeServerInstallation,
	getRuntimeInstallCommand,
	getRuntimeLabelForServer,
	getRuntimeUninstallCommand,
	installRuntimeServer,
	uninstallRuntimeServer,
} from "./runtimeActions";
export {
	AUTO_RUNTIME_ID,
	getDefaultRuntimeSetting,
	getServerRuntimeSetting,
	setDefaultRuntime,
	setServerRuntime,
} from "./runtimeSettings";
export { default as serverRegistry } from "./serverRegistry";
export {
	nextSignature,
	prevSignature,
	showSignatureHelp,
} from "./tooltipExtensions";
export { createTransport } from "./transport";

export type {
	BuiltinExtensionsConfig,
	ClientManagerOptions,
	ClientState,
	DiagnosticRelatedInformation,
	DocumentUriContext,
	FileMetadata,
	FormattingOptions,
	LSPClientWithWorkspace,
	LSPDiagnostic,
	LSPFormattingOptions,
	LSPPluginAPI,
	LspDiagnostic,
	LspClientScope,
	LspRuntimeConnection,
	LspRuntimeContext,
	LspRuntimeProvider,
	LspRuntimeUriResolution,
	LspRuntimeUriResolutionContext,
	LspServerDefinition,
	Position,
	Range,
	TextEdit,
	TransportDescriptor,
	TransportHandle,
	WorkspaceOptions,
	WorkspaceKind,
} from "./types";
export { default as AcodeWorkspace } from "./workspace";
