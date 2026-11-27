import type {
	CodeActionContext,
	CompletionItem,
	FormattingOptions,
	Position,
	Range,
} from "vscode-languageserver-types";
import {
	getTextDocument,
	METHOD_NOT_HANDLED,
	startWorkerServer,
} from "./protocol";
import {
	type CompletionData,
	completions,
	hover,
	resolveCompletion,
	signatureHelp,
} from "./typescript/assist";
import type { SignatureContext } from "./typescript/convert";
import {
	diagnostics,
	documentSymbols,
	foldingRanges,
	format,
	inlayHints,
	selectionRanges,
} from "./typescript/features";
import {
	codeActions,
	definitions,
	documentHighlights,
	implementations,
	prepareRename,
	references,
	rename,
	typeDefinitions,
} from "./typescript/navigation";
import TypeScriptWorkspace from "./typescript/workspace";
import libraries from "./typescriptLibs";

interface RequestParams {
	position?: Position;
	positions: Position[];
	range: Range;
	options?: FormattingOptions;
	newName: string;
	context: CodeActionContext & SignatureContext;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

startWorkerServer(
	({
		documents,
		rootUri,
		getProjectVersion,
		requestFile,
		requestDirectory,
		revalidate,
		log,
		progress,
	}) => {
		const workspace = new TypeScriptWorkspace({
			documents,
			documentsVersion: getProjectVersion,
			libraries,
			host: {
				readDirectory: requestDirectory,
				readFile: (uri) => requestFile(uri, MAX_FILE_BYTES),
			},
			onChange: revalidate,
			log: (message) => log("info", message),
			progress,
		});
		if (rootUri) workspace.addFolder(rootUri);

		return {
			capabilities: {
				completionProvider: {
					resolveProvider: true,
					triggerCharacters: [".", "/", '"', "'", "<"],
				},
				hoverProvider: true,
				signatureHelpProvider: {
					triggerCharacters: ["(", ",", "<"],
					retriggerCharacters: [")"],
				},
				documentFormattingProvider: true,
				documentRangeFormattingProvider: true,
				documentSymbolProvider: true,
				definitionProvider: true,
				typeDefinitionProvider: true,
				implementationProvider: true,
				referencesProvider: true,
				renameProvider: {
					prepareProvider: true,
				},
				documentHighlightProvider: true,
				codeActionProvider: true,
				foldingRangeProvider: true,
				selectionRangeProvider: true,
				inlayHintProvider: true,
			},

			validate: (document) => diagnostics(workspace.target(document)),

			request(method, params) {
				if (method === "completionItem/resolve") {
					const item = params as CompletionItem;
					const data = item.data as CompletionData | undefined;
					const document = data && documents.get(data.uri);
					return document
						? resolveCompletion(workspace.target(document), item, data)
						: item;
				}

				const document = getTextDocument(documents, params);
				if (!document) return null;
				const request = params as RequestParams;
				const target = workspace.target(document);
				const offset = request.position
					? document.offsetAt(request.position)
					: 0;

				switch (method) {
					case "acode/validate":
						return diagnostics(target);
					case "textDocument/completion":
						return completions(target, offset);
					case "textDocument/hover":
						return hover(target, offset);
					case "textDocument/signatureHelp":
						return signatureHelp(target, offset, request.context);
					case "textDocument/formatting":
						return format(target, undefined, request.options);
					case "textDocument/rangeFormatting":
						return format(target, request.range, request.options);
					case "textDocument/documentSymbol":
						return documentSymbols(target);
					case "textDocument/definition":
						return definitions(target, offset);
					case "textDocument/typeDefinition":
						return typeDefinitions(target, offset);
					case "textDocument/implementation":
						return implementations(target, offset);
					case "textDocument/references":
						return references(target, offset);
					case "textDocument/prepareRename":
						return prepareRename(target, offset);
					case "textDocument/rename":
						return rename(target, offset, request.newName);
					case "textDocument/documentHighlight":
						return documentHighlights(target, offset);
					case "textDocument/codeAction":
						return codeActions(
							target,
							request.range,
							request.context,
							request.options,
						);
					case "textDocument/foldingRange":
						return foldingRanges(target);
					case "textDocument/selectionRange":
						return selectionRanges(target, request.positions);
					case "textDocument/inlayHint":
						return inlayHints(target, request.range);
					default:
						return METHOD_NOT_HANDLED;
				}
			},

			openDocument: (uri) => workspace.documentOpened(uri),
			closeDocument: (uri) => workspace.documentClosed(uri),
			addWorkspaceFolder: (uri) => workspace.addFolder(uri),
			removeWorkspaceFolder: (uri) => workspace.removeFolder(uri),
			dispose: () => workspace.dispose(),
		};
	},
);
