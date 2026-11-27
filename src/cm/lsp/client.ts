/**
 * The language-server client and the editor features built on it. Loaded on
 * demand through clientLoader, so editors without a language server never
 * parse it.
 */
export {
	formatDocument,
	LSPPlugin,
	serverCompletionSource,
} from "@codemirror/lsp-client";
export {
	default as clientManager,
	lspCompletionEnabled,
} from "./clientManager";
export {
	jumpToDeclaration,
	jumpToDefinition,
	jumpToImplementation,
	jumpToTypeDefinition,
	nextSignature,
	prevSignature,
	renameSymbol,
	showSignatureHelp,
} from "./index";
export {
	closeReferencesPanel,
	findAllReferences,
	findAllReferencesInTab,
} from "./references";
