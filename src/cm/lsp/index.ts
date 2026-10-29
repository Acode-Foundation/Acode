import "./runtimes/registerBuiltins";

export type {
	LspWorkerHostHandler,
	LspWorkerTransportOptions,
} from "./api";
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
	goToDeclaration,
	goToDefinition,
	goToImplementation,
	goToTypeDefinition,
	jumpToDeclaration,
	jumpToDefinition,
	jumpToImplementation,
	jumpToTypeDefinition,
} from "./definition";
export {
	clearDiagnosticsEffect,
	getLspDiagnostics,
	LSP_DIAGNOSTICS_EVENT,
	lspDiagnosticsClientExtension,
	lspDiagnosticsExtension,
	lspDiagnosticsUiExtension,
} from "./diagnostics";
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
	type LspLogEntry,
	type LspLogLevel,
	onLspLog,
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
	checkRuntimeServerInstallation,
	getRuntimeInstallCommand,
	getRuntimeLabelForServer,
	getRuntimeUninstallCommand,
	installRuntimeServer,
	uninstallRuntimeServer,
} from "./runtimeActions";
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
	AUTO_RUNTIME_ID,
	getDefaultRuntimeSetting,
	getServerRuntimeSetting,
	setDefaultRuntime,
	setServerRuntime,
} from "./runtimeSettings";
export {
	ensureServerRunning,
	resetManagedServers,
	stopManagedServer,
} from "./serverLauncher";
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
	LspClientScope,
	LspDiagnostic,
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
	WorkspaceKind,
	WorkspaceOptions,
} from "./types";
export { createWorkerTransport } from "./workerTransport";
export { default as AcodeWorkspace } from "./workspace";
