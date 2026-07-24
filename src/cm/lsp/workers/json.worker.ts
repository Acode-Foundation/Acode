import {
	ClientCapabilities,
	getLanguageService,
	type JSONDocument,
	type LanguageService,
} from "vscode-json-languageservice";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	getTextDocument,
	METHOD_NOT_HANDLED,
	startWorkerServer,
} from "./protocol";
import { schemas } from "./jsonSchemas";

interface CachedJsonDocument {
	version: number;
	languageId: string;
	document: JSONDocument;
}

startWorkerServer(({ documents, requestFile }) => {
	async function requestSchema(uri: string): Promise<string> {
		const url = new URL(uri);
		if (url.protocol === "http:" || url.protocol === "https:") {
			const response = await fetch(url.href);
			if (!response.ok) {
				throw new Error(
					`Unable to load JSON schema (${response.status} ${response.statusText})`,
				);
			}
			return response.text();
		}
		return requestFile(uri);
	}

	function createService(allowComments: boolean): LanguageService {
		const service = getLanguageService({
			schemaRequestService: requestSchema,
			workspaceContext: {
				resolveRelativePath(relativePath, resource) {
					return new URL(relativePath, resource).href;
				},
			},
			promiseConstructor: Promise,
			clientCapabilities: ClientCapabilities.LATEST,
		});
		service.configure({
			validate: true,
			allowComments,
			schemas,
		});
		return service;
	}

	const services = {
		json: createService(false),
		jsonc: createService(true),
	};
	const parsedDocuments = new Map<string, CachedJsonDocument>();

	function getService(document: TextDocument): LanguageService {
		return document.languageId === "jsonc" ? services.jsonc : services.json;
	}

	function getParsed(
		document: TextDocument,
		service: LanguageService,
	): JSONDocument {
		const cached = parsedDocuments.get(document.uri);
		if (
			cached?.version === document.version &&
			cached.languageId === document.languageId
		) {
			return cached.document;
		}
		const parsed = service.parseJSONDocument(document);
		parsedDocuments.set(document.uri, {
			version: document.version,
			languageId: document.languageId,
			document: parsed,
		});
		return parsed;
	}

	return {
		capabilities: {
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [" ", ":", '"'],
			},
			hoverProvider: true,
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
			documentSymbolProvider: true,
			definitionProvider: true,
			documentLinkProvider: {
				resolveProvider: false,
			},
			colorProvider: true,
			foldingRangeProvider: true,
			selectionRangeProvider: true,
		},

		validate(document) {
			const service = getService(document);
			return service.doValidation(document, getParsed(document, service), {
				comments: document.languageId === "jsonc" ? "ignore" : "error",
				trailingCommas:
					document.languageId === "jsonc" ? "warning" : "error",
			});
		},

		async request(method, params) {
			if (method === "completionItem/resolve") {
				return services.json.doResolve(
					params as Parameters<LanguageService["doResolve"]>[0],
				);
			}

			const document = getTextDocument(documents, params);
			if (!document) return null;
			const service = getService(document);
			const json = getParsed(document, service);
			const request = params as {
				position: Parameters<LanguageService["doHover"]>[1];
				range?: Parameters<LanguageService["format"]>[1];
				options: Parameters<LanguageService["format"]>[2];
				color: Parameters<LanguageService["getColorPresentations"]>[2];
				positions: Parameters<LanguageService["getSelectionRanges"]>[1];
			};

			switch (method) {
				case "textDocument/completion":
					return service.doComplete(document, request.position, json);
				case "textDocument/hover":
					return service.doHover(document, request.position, json);
				case "textDocument/formatting":
					return service.format(document, undefined, request.options);
				case "textDocument/rangeFormatting":
					return service.format(document, request.range, request.options);
				case "textDocument/documentSymbol":
					return service.findDocumentSymbols2(document, json);
				case "textDocument/definition":
					return service.findDefinition(document, request.position, json);
				case "textDocument/documentLink":
					return service.findLinks(document, json);
				case "textDocument/documentColor":
					return service.findDocumentColors(document, json);
				case "textDocument/colorPresentation":
					return service.getColorPresentations(
						document,
						json,
						request.color,
						request.range!,
					);
				case "textDocument/foldingRange":
					return service.getFoldingRanges(document);
				case "textDocument/selectionRange":
					return service.getSelectionRanges(
						document,
						request.positions,
						json,
					);
				default:
					return METHOD_NOT_HANDLED;
			}
		},

		dispose() {
			parsedDocuments.clear();
			for (const uri of documents.keys()) {
				services.json.resetSchema(uri);
				services.jsonc.resetSchema(uri);
			}
		},

		closeDocument(uri) {
			parsedDocuments.delete(uri);
			services.json.resetSchema(uri);
			services.jsonc.resetSchema(uri);
		},
	};
});
