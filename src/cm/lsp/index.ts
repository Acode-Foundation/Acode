export {
	bundles,
	default as lspApi,
	defineBundle,
	defineServer,
	installers,
	register,
	servers,
	upsert,
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
export type { InlayHintsConfig } from "./inlayHints";
export {
	inlayHintsClientExtension,
	inlayHintsEditorExtension,
	inlayHintsExtension,
} from "./inlayHints";
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
	LspServerDefinition,
	Position,
	Range,
	TextEdit,
	TransportDescriptor,
	TransportHandle,
	WorkspaceOptions,
} from "./types";
export { default as AcodeWorkspace } from "./workspace";
