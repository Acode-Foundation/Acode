import {
	getCSSLanguageService,
	getLESSLanguageService,
	getSCSSLanguageService,
	type LanguageService,
	type Stylesheet,
} from "vscode-css-languageservice";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	getTextDocument,
	METHOD_NOT_HANDLED,
	resolveReference,
	startWorkerServer,
} from "./protocol";

interface CachedStylesheet {
	version: number;
	languageId: string;
	stylesheet: Stylesheet;
}

startWorkerServer(({ documents }) => {
	const services = {
		css: getCSSLanguageService(),
		less: getLESSLanguageService(),
		scss: getSCSSLanguageService(),
	};
	const parsedDocuments = new Map<string, CachedStylesheet>();
	const documentContext = { resolveReference };

	function getService(document: TextDocument): LanguageService {
		if (document.languageId === "less") return services.less;
		if (document.languageId === "scss") return services.scss;
		return services.css;
	}

	function getStylesheet(
		document: TextDocument,
		service: LanguageService,
	): Stylesheet {
		const cached = parsedDocuments.get(document.uri);
		if (
			cached?.version === document.version &&
			cached.languageId === document.languageId
		) {
			return cached.stylesheet;
		}
		const stylesheet = service.parseStylesheet(document);
		parsedDocuments.set(document.uri, {
			version: document.version,
			languageId: document.languageId,
			stylesheet,
		});
		return stylesheet;
	}

	return {
		capabilities: {
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ["/", "-", ":", "("],
			},
			hoverProvider: true,
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
			documentSymbolProvider: true,
			definitionProvider: true,
			referencesProvider: true,
			renameProvider: {
				prepareProvider: true,
			},
			documentHighlightProvider: true,
			documentLinkProvider: {
				resolveProvider: false,
			},
			codeActionProvider: true,
			colorProvider: true,
			foldingRangeProvider: true,
			selectionRangeProvider: true,
		},

		validate(document) {
			const service = getService(document);
			return service.doValidation(
				document,
				getStylesheet(document, service),
			);
		},

		async request(method, params) {
			const document = getTextDocument(documents, params);
			if (!document) return null;
			const service = getService(document);
			const stylesheet = getStylesheet(document, service);
			const request = params as {
				position: Parameters<LanguageService["doHover"]>[1];
				range?: Parameters<LanguageService["format"]>[1];
				options: Parameters<LanguageService["format"]>[2];
				newName: string;
				context: Parameters<LanguageService["doCodeActions2"]>[2];
				color: Parameters<LanguageService["getColorPresentations"]>[2];
				positions: Parameters<LanguageService["getSelectionRanges"]>[1];
			};

			switch (method) {
				case "textDocument/completion":
					return service.doComplete2(
						document,
						request.position,
						stylesheet,
						documentContext,
					);
				case "textDocument/hover":
					return service.doHover(document, request.position, stylesheet);
				case "textDocument/formatting":
					return service.format(document, undefined, request.options);
				case "textDocument/rangeFormatting":
					return service.format(document, request.range, request.options);
				case "textDocument/documentSymbol":
					return service.findDocumentSymbols2(document, stylesheet);
				case "textDocument/definition": {
					const definition = service.findDefinition(
						document,
						request.position,
						stylesheet,
					);
					return definition ? [definition] : null;
				}
				case "textDocument/references":
					return service.findReferences(
						document,
						request.position,
						stylesheet,
					);
				case "textDocument/prepareRename":
					return (
						service.prepareRename(document, request.position, stylesheet) ??
						null
					);
				case "textDocument/rename":
					return service.doRename(
						document,
						request.position,
						request.newName,
						stylesheet,
					);
				case "textDocument/documentHighlight":
					return service.findDocumentHighlights(
						document,
						request.position,
						stylesheet,
					);
				case "textDocument/documentLink":
					return service.findDocumentLinks2(
						document,
						stylesheet,
						documentContext,
					);
				case "textDocument/codeAction":
					return service.doCodeActions2(
						document,
						request.range!,
						request.context,
						stylesheet,
					);
				case "textDocument/documentColor":
					return service.findDocumentColors(document, stylesheet);
				case "textDocument/colorPresentation":
					return service.getColorPresentations(
						document,
						stylesheet,
						request.color,
						request.range!,
					);
				case "textDocument/foldingRange":
					return service.getFoldingRanges(document);
				case "textDocument/selectionRange":
					return service.getSelectionRanges(
						document,
						request.positions,
						stylesheet,
					);
				default:
					return METHOD_NOT_HANDLED;
			}
		},

		configure(settings) {
			const languageSettings = settings as
				| {
						css?: Parameters<LanguageService["configure"]>[0];
						less?: Parameters<LanguageService["configure"]>[0];
						scss?: Parameters<LanguageService["configure"]>[0];
				  }
				| undefined;
			services.css.configure(languageSettings?.css);
			services.less.configure(languageSettings?.less);
			services.scss.configure(languageSettings?.scss);
		},

		dispose() {
			parsedDocuments.clear();
		},

		closeDocument(uri) {
			parsedDocuments.delete(uri);
		},
	};
});
