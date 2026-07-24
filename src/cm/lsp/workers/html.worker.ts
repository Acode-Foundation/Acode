import {
	getCSSLanguageService,
	type LanguageService as CssLanguageService,
	type Stylesheet,
} from "vscode-css-languageservice";
import {
	getLanguageService as getHtmlLanguageService,
	type HTMLDocument,
	type LanguageService as HtmlLanguageService,
} from "vscode-html-languageservice";
import {
	ClientCapabilities,
	getLanguageService as getJsonLanguageService,
	type JSONDocument,
	type LanguageService as JsonLanguageService,
} from "vscode-json-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
	Diagnostic,
	DocumentSymbol,
	FoldingRange,
	Position,
} from "vscode-languageserver-types";
import {
	clearDocumentRegions,
	getDocumentRegions,
	type HTMLDocumentRegions,
} from "./htmlEmbeddedSupport";
import { importMapSchema } from "./jsonSchemas";
import { NestedLspClient } from "./nestedLspClient";
import {
	getTextDocument,
	METHOD_NOT_HANDLED,
	resolveReference,
	startWorkerServer,
} from "./protocol";

interface CachedHtmlDocument {
	version: number;
	document: HTMLDocument;
}

interface EmbeddedDocuments {
	regions: HTMLDocumentRegions;
	css: TextDocument | null;
	importmap: TextDocument | null;
	javascript: TextDocument | null;
}

interface CachedEmbeddedDocuments extends EmbeddedDocuments {
	version: number;
}

interface RequestParams {
	position: Position;
	range?: Parameters<HtmlLanguageService["format"]>[1];
	options: Parameters<HtmlLanguageService["format"]>[2];
	newName: string;
	context: Parameters<CssLanguageService["doCodeActions2"]>[2];
	color: Parameters<CssLanguageService["getColorPresentations"]>[2];
	positions: Parameters<HtmlLanguageService["getSelectionRanges"]>[1];
}

startWorkerServer(({ documents, requestFile, rootUri }) => {
	const htmlService = getHtmlLanguageService();
	const cssService = getCSSLanguageService();
	const jsonService = createImportMapService();
	const parsedHtml = new Map<string, CachedHtmlDocument>();
	const embeddedDocuments = new Map<string, CachedEmbeddedDocuments>();
	const parsedCss = new Map<string, { version: number; document: Stylesheet }>();
	const parsedJson = new Map<string, { version: number; document: JSONDocument }>();
	const documentContext = { resolveReference };
	let typescriptClient: NestedLspClient | null | undefined;

	function getTypeScriptClient(): NestedLspClient | null {
		if (typescriptClient !== undefined) return typescriptClient;
		if (typeof Worker === "undefined") {
			typescriptClient = null;
			return null;
		}
		typescriptClient = new NestedLspClient(
			"typescriptLspWorker.js",
			{
				serverId: "typescript",
				rootUri,
			},
			requestFile,
		);
		return typescriptClient;
	}

	async function requestTypeScript(
		method: string,
		params: unknown,
		document: TextDocument | null,
	): Promise<unknown> {
		const client = getTypeScriptClient();
		if (!client) return null;
		return client.request(method, params, document ?? undefined);
	}

	function getHtml(document: TextDocument): HTMLDocument {
		const cached = parsedHtml.get(document.uri);
		if (cached?.version === document.version) return cached.document;
		const parsed = htmlService.parseHTMLDocument(document);
		parsedHtml.set(document.uri, {
			version: document.version,
			document: parsed,
		});
		return parsed;
	}

	function getEmbedded(document: TextDocument): EmbeddedDocuments {
		const cached = embeddedDocuments.get(document.uri);
		if (cached?.version === document.version) return cached;
		const regions = getDocumentRegions(htmlService, document);
		const cssText = regions.getEmbeddedDocument("css", false);
		const importMapText = regions.getEmbeddedDocument("importmap", false);
		const javascriptText = regions.getEmbeddedDocument("javascript", false);
		const result: CachedEmbeddedDocuments = {
			version: document.version,
			regions,
			css: cssText
				? TextDocument.create(
						document.uri,
						"css",
						document.version,
						cssText,
					)
				: null,
			importmap: importMapText
				? TextDocument.create(
						document.uri,
						"json",
						document.version,
						importMapText,
					)
				: null,
			javascript: javascriptText
				? TextDocument.create(
						document.uri,
						"javascript",
						document.version,
						javascriptText,
					)
				: null,
		};
		embeddedDocuments.set(document.uri, result);
		return result;
	}

	function getCss(document: TextDocument): Stylesheet {
		const cached = parsedCss.get(document.uri);
		if (cached?.version === document.version) return cached.document;
		const parsed = cssService.parseStylesheet(document);
		parsedCss.set(document.uri, {
			version: document.version,
			document: parsed,
		});
		return parsed;
	}

	function getJson(document: TextDocument): JSONDocument {
		const cached = parsedJson.get(document.uri);
		if (cached?.version === document.version) return cached.document;
		const parsed = jsonService.parseJSONDocument(document);
		parsedJson.set(document.uri, {
			version: document.version,
			document: parsed,
		});
		return parsed;
	}

	function embeddedLanguageAt(
		embedded: EmbeddedDocuments,
		position?: Position,
	): string | undefined {
		return position
			? embedded.regions.getEmbeddedLanguageAtPosition(position)
			: undefined;
	}

	return {
		capabilities: {
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ["<", " ", ":", '"', "=", "/", "-", "("],
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
			referencesProvider: true,
			renameProvider: true,
			documentHighlightProvider: true,
			documentLinkProvider: {
				resolveProvider: false,
			},
			codeActionProvider: true,
			colorProvider: true,
			foldingRangeProvider: true,
			selectionRangeProvider: true,
			linkedEditingRangeProvider: true,
			inlayHintProvider: true,
		},

		async validate(document) {
			const diagnostics: Diagnostic[] = [];
			const embedded = getEmbedded(document);
			const importMapRegion = embedded.regions.regions.find(
				(region) => region.languageId === "importmap",
			);

			if (importMapRegion) {
				const addOrderingDiagnostic = (range: {
					start: number;
					end: number;
				}) => {
					diagnostics.push({
						severity: 1,
						range: {
							start: document.positionAt(range.start),
							end: document.positionAt(range.end),
						},
						message: "Scripts are not allowed before the import map.",
						source: "html",
					});
				};
				for (const script of embedded.regions.importedScripts) {
					if (script.end < importMapRegion.start) {
						addOrderingDiagnostic(script);
					}
				}
				for (const region of embedded.regions.regions) {
					if (
						region.languageId === "javascript" &&
						region.end < importMapRegion.start
					) {
						addOrderingDiagnostic(region);
					}
				}
			}

			if (embedded.css) {
				diagnostics.push(
					...cssService.doValidation(
						embedded.css,
						getCss(embedded.css),
					),
				);
			}
			if (embedded.importmap) {
				diagnostics.push(
					...(await jsonService.doValidation(
						embedded.importmap,
						getJson(embedded.importmap),
						undefined,
						importMapSchema.schema,
					)),
				);
			}
			if (embedded.javascript) {
				const javascriptDiagnostics = await requestTypeScript(
					"acode/validate",
					{
						textDocument: { uri: embedded.javascript.uri },
					},
					embedded.javascript,
				);
				if (Array.isArray(javascriptDiagnostics)) {
					diagnostics.push(...(javascriptDiagnostics as Diagnostic[]));
				}
			}
			return diagnostics;
		},

		async request(method, params) {
			if (method === "completionItem/resolve") {
				if (
					params &&
					typeof params === "object" &&
					(params as { data?: { uri?: unknown } }).data?.uri
				) {
					return requestTypeScript(method, params, null);
				}
				return jsonService.doResolve(
					params as Parameters<JsonLanguageService["doResolve"]>[0],
				);
			}

			const document = getTextDocument(documents, params);
			if (!document) return null;
			const html = getHtml(document);
			const embedded = getEmbedded(document);
			const request = params as RequestParams;
			const languageId = embeddedLanguageAt(
				embedded,
				request.position ?? request.range?.start,
			);
			const css = embedded.css;
			const importmap = embedded.importmap;
			const javascript = embedded.javascript;

			switch (method) {
				case "textDocument/completion":
					if (languageId === "css" && css) {
						return cssService.doComplete2(
							css,
							request.position,
							getCss(css),
							documentContext,
						);
					}
					if (languageId === "importmap" && importmap) {
						return jsonService.doComplete(
							importmap,
							request.position,
							getJson(importmap),
						);
					}
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					return htmlService.doComplete2(
						document,
						request.position,
						html,
						documentContext,
					);
				case "textDocument/hover":
					if (languageId === "css" && css) {
						return cssService.doHover(css, request.position, getCss(css));
					}
					if (languageId === "importmap" && importmap) {
						return jsonService.doHover(
							importmap,
							request.position,
							getJson(importmap),
						);
					}
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					return htmlService.doHover(document, request.position, html);
				case "textDocument/signatureHelp":
					return languageId === "javascript"
						? requestTypeScript(method, params, javascript)
						: null;
				case "textDocument/formatting":
					return htmlService.format(document, undefined, {
						...request.options,
						contentUnformatted: "script",
					});
				case "textDocument/rangeFormatting":
					if (languageId === "css" && css) {
						return cssService.format(css, request.range, request.options);
					}
					if (languageId === "importmap" && importmap) {
						return jsonService.format(
							importmap,
							request.range,
							{
								tabSize: request.options.tabSize ?? 4,
								insertSpaces: request.options.insertSpaces ?? true,
							},
						);
					}
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					return htmlService.format(
						document,
						request.range,
						request.options,
					);
				case "textDocument/documentSymbol": {
					const symbols: DocumentSymbol[] =
						htmlService.findDocumentSymbols2(document, html);
					if (css) {
						symbols.push(
							...cssService.findDocumentSymbols2(css, getCss(css)),
						);
					}
					if (importmap) {
						symbols.push(
							...jsonService.findDocumentSymbols2(
								importmap,
								getJson(importmap),
							),
						);
					}
					if (javascript) {
						const javascriptSymbols = await requestTypeScript(
							method,
							params,
							javascript,
						);
						if (Array.isArray(javascriptSymbols)) {
							symbols.push(...(javascriptSymbols as DocumentSymbol[]));
						}
					}
					return symbols;
				}
				case "textDocument/definition":
					if (languageId === "css" && css) {
						const definition = cssService.findDefinition(
							css,
							request.position,
							getCss(css),
						);
						return definition ? [definition] : null;
					}
					if (languageId === "importmap" && importmap) {
						return jsonService.findDefinition(
							importmap,
							request.position,
							getJson(importmap),
						);
					}
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					return null;
				case "textDocument/references":
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					return languageId === "css" && css
						? cssService.findReferences(
								css,
								request.position,
								getCss(css),
							)
						: null;
				case "textDocument/rename":
					if (languageId === "css" && css) {
						return cssService.doRename(
							css,
							request.position,
							request.newName,
							getCss(css),
						);
					}
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					if (languageId) return null;
					return htmlService.doRename(
						document,
						request.position,
						request.newName,
						html,
					);
				case "textDocument/documentHighlight":
					if (languageId === "css" && css) {
						return cssService.findDocumentHighlights(
							css,
							request.position,
							getCss(css),
						);
					}
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					if (languageId) return null;
					return htmlService.findDocumentHighlights(
						document,
						request.position,
						html,
					);
				case "textDocument/documentLink": {
					const links = htmlService.findDocumentLinks(
						document,
						documentContext,
					);
					if (css) {
						links.push(
							...(await cssService.findDocumentLinks2(
								css,
								getCss(css),
								documentContext,
							)),
						);
					}
					if (importmap) {
						links.push(
							...(await jsonService.findLinks(
								importmap,
								getJson(importmap),
							)),
						);
					}
					return links;
				}
				case "textDocument/codeAction":
					if (languageId === "javascript") {
						return requestTypeScript(method, params, javascript);
					}
					return languageId === "css" && css
						? cssService.doCodeActions2(
								css,
								request.range!,
								request.context,
								getCss(css),
							)
						: [];
				case "textDocument/documentColor":
					return css
						? cssService.findDocumentColors(css, getCss(css))
						: [];
				case "textDocument/colorPresentation":
					return languageId === "css" && css
						? cssService.getColorPresentations(
								css,
								getCss(css),
								request.color,
								request.range!,
							)
						: [];
				case "textDocument/foldingRange": {
					const ranges: FoldingRange[] =
						htmlService.getFoldingRanges(document);
					if (css) ranges.push(...cssService.getFoldingRanges(css));
					if (importmap) {
						ranges.push(...jsonService.getFoldingRanges(importmap));
					}
					if (javascript) {
						const javascriptRanges = await requestTypeScript(
							method,
							params,
							javascript,
						);
						if (Array.isArray(javascriptRanges)) {
							ranges.push(...(javascriptRanges as FoldingRange[]));
						}
					}
					return ranges.sort((a, b) => a.startLine - b.startLine);
				}
				case "textDocument/selectionRange":
					if (
						embeddedLanguageAt(embedded, request.positions?.[0]) === "css" &&
						css
					) {
						return cssService.getSelectionRanges(
							css,
							request.positions,
							getCss(css),
						);
					}
					if (
						embeddedLanguageAt(embedded, request.positions?.[0]) ===
							"importmap" &&
						importmap
					) {
						return jsonService.getSelectionRanges(
							importmap,
							request.positions,
							getJson(importmap),
						);
					}
					if (
						embeddedLanguageAt(embedded, request.positions?.[0]) ===
							"javascript" &&
						javascript
					) {
						return requestTypeScript(method, params, javascript);
					}
					return htmlService.getSelectionRanges(
						document,
						request.positions,
					);
				case "textDocument/linkedEditingRange": {
					if (languageId) return null;
					const ranges = htmlService.findLinkedEditingRanges(
						document,
						request.position,
						html,
					);
					return ranges ? { ranges } : null;
				}
				case "textDocument/inlayHint":
					return languageId === "javascript"
						? requestTypeScript(method, params, javascript)
						: [];
				default:
					return METHOD_NOT_HANDLED;
			}
		},

		closeDocument(uri) {
			parsedHtml.delete(uri);
			embeddedDocuments.delete(uri);
			parsedCss.delete(uri);
			parsedJson.delete(uri);
			clearDocumentRegions(uri);
			jsonService.resetSchema(uri);
			typescriptClient?.closeDocument(uri);
		},

		dispose() {
			parsedHtml.clear();
			embeddedDocuments.clear();
			parsedCss.clear();
			parsedJson.clear();
			clearDocumentRegions();
			typescriptClient?.dispose();
			typescriptClient = null;
		},
	};
});

function createImportMapService(): JsonLanguageService {
	const service = getJsonLanguageService({
		promiseConstructor: Promise,
		clientCapabilities: ClientCapabilities.LATEST,
	});
	service.configure({
		validate: true,
		allowComments: false,
		schemas: [
			{
				...importMapSchema,
				fileMatch: ["*"],
			},
		],
	});
	return service;
}
