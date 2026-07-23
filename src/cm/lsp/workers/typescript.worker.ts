import ts from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	CompletionItemKind,
	DiagnosticSeverity,
	DiagnosticTag,
	DocumentHighlightKind,
	FoldingRangeKind,
	InlayHintKind,
	Range,
	SelectionRange,
	SymbolKind,
	type CodeAction,
	type CodeActionContext,
	type CompletionItem,
	type Diagnostic,
	type DocumentHighlight,
	type DocumentSymbol,
	type FoldingRange,
	type FormattingOptions,
	type InlayHint,
	type Location,
	type LocationLink,
	type MarkupContent,
	type Position,
	type SelectionRange as LspSelectionRange,
	type SignatureHelp,
	type TextEdit,
	type WorkspaceEdit,
} from "vscode-languageserver-types";
import {
	getTextDocument,
	METHOD_NOT_HANDLED,
	startWorkerServer,
} from "./protocol";
import libraries from "./typescriptLibs";

interface CompletionData {
	uri: string;
	offset: number;
	name: string;
	source?: string;
	entryData?: ts.CompletionEntryData;
}

interface RequestParams {
	position: Position;
	range?: Range;
	options: FormattingOptions;
	newName: string;
	context: CodeActionContext & {
		triggerKind?: number;
		triggerCharacter?: string;
		isRetrigger?: boolean;
	};
}

class TypeScriptHost implements ts.LanguageServiceHost {
	constructor(
		private readonly documents: Map<string, TextDocument>,
		private readonly options: ts.CompilerOptions,
	) {}

	getCompilationSettings(): ts.CompilerOptions {
		return this.options;
	}

	getCurrentDirectory(): string {
		return "/";
	}

	getDefaultLibFileName(): string {
		return "lib.es2022.full.d.ts";
	}

	getScriptFileNames(): string[] {
		return [...this.documents.keys()];
	}

	getScriptVersion(fileName: string): string {
		const document = this.documents.get(fileName);
		return document ? String(document.version) : "1";
	}

	getProjectVersion(): string {
		return [...this.documents]
			.map(([uri, document]) => `${uri}:${document.version}`)
			.join("|");
	}

	getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
		const text = this.readFile(fileName);
		return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
	}

	getScriptKind(fileName: string): ts.ScriptKind {
		const languageId = this.documents.get(fileName)?.languageId;
		if (languageId === "typescriptreact" || languageId === "tsx") {
			return ts.ScriptKind.TSX;
		}
		if (languageId === "javascriptreact" || languageId === "jsx") {
			return ts.ScriptKind.JSX;
		}
		if (languageId === "typescript") return ts.ScriptKind.TS;
		if (languageId === "javascript") return ts.ScriptKind.JS;
		const path = uriPath(fileName).toLowerCase();
		if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
		if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
		if (
			path.endsWith(".ts") ||
			path.endsWith(".mts") ||
			path.endsWith(".cts")
		) {
			return ts.ScriptKind.TS;
		}
		if (
			path.endsWith(".js") ||
			path.endsWith(".mjs") ||
			path.endsWith(".cjs")
		) {
			return ts.ScriptKind.JS;
		}
		if (path.endsWith(".json")) return ts.ScriptKind.JSON;
		return ts.ScriptKind.Unknown;
	}

	fileExists(fileName: string): boolean {
		return this.documents.has(fileName) || fileName in libraries;
	}

	readFile(fileName: string): string | undefined {
		return this.documents.get(fileName)?.getText() ?? libraries[fileName];
	}

	readDirectory(): string[] {
		return [...this.documents.keys()];
	}

	directoryExists(): boolean {
		return true;
	}

	getDirectories(): string[] {
		return [];
	}

	useCaseSensitiveFileNames(): boolean {
		return true;
	}

	getNewLine(): string {
		return "\n";
	}

	resolveModuleNames(
		moduleNames: string[],
		containingFile: string,
	): (ts.ResolvedModule | undefined)[] {
		return moduleNames.map((moduleName) => {
			const openDocument = this.resolveOpenDocument(
				moduleName,
				containingFile,
			);
			if (openDocument) return openDocument;
			return ts.resolveModuleName(
				moduleName,
				containingFile,
				this.options,
				this,
			).resolvedModule;
		});
	}

	private resolveOpenDocument(
		moduleName: string,
		containingFile: string,
	): ts.ResolvedModule | undefined {
		if (!moduleName.startsWith(".") && !/^[a-z]+:/i.test(moduleName)) {
			return undefined;
		}
		let base: string;
		try {
			base = new URL(moduleName, containingFile).href;
		} catch {
			return undefined;
		}
		const candidates = [
			base,
			`${base}.ts`,
			`${base}.tsx`,
			`${base}.js`,
			`${base}.jsx`,
			`${base}/index.ts`,
			`${base}/index.tsx`,
			`${base}/index.js`,
			`${base}/index.jsx`,
		];
		for (const candidate of candidates) {
			if (!this.documents.has(candidate)) continue;
			return {
				resolvedFileName: candidate,
				isExternalLibraryImport: false,
			};
		}
		return undefined;
	}
}

startWorkerServer(async ({ documents, requestFile, rootUri }) => {
	const compilerOptions = await loadCompilerOptions(rootUri, requestFile);
	const host = new TypeScriptHost(documents, compilerOptions);
	const service = ts.createLanguageService(
		host,
		ts.createDocumentRegistry(true, "/"),
	);

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

		validate(document) {
			const diagnostics: ts.Diagnostic[] = [
				...service.getSyntacticDiagnostics(document.uri),
				...service.getSuggestionDiagnostics(document.uri),
			];
			if (isTypeScriptDocument(document)) {
				diagnostics.push(...service.getSemanticDiagnostics(document.uri));
			}
			return diagnostics.map((diagnostic) =>
				toDiagnostic(document, diagnostic),
			);
		},

		request(method, params) {
			if (method === "completionItem/resolve") {
				return resolveCompletion(
					service,
					documents,
					params as CompletionItem,
				);
			}

			const document = getTextDocument(documents, params);
			if (!document) return null;
			const request = params as RequestParams;
			const offset = request.position
				? document.offsetAt(request.position)
				: 0;

			switch (method) {
				case "acode/validate": {
					const diagnostics: ts.Diagnostic[] = [
						...service.getSyntacticDiagnostics(document.uri),
						...service.getSuggestionDiagnostics(document.uri),
					];
					if (isTypeScriptDocument(document)) {
						diagnostics.push(
							...service.getSemanticDiagnostics(document.uri),
						);
					}
					return diagnostics.map((diagnostic) =>
						toDiagnostic(document, diagnostic),
					);
				}
				case "textDocument/completion":
					return completions(service, document, offset);
				case "textDocument/hover":
					return hover(service, document, offset);
				case "textDocument/signatureHelp":
					return signatureHelp(
						service,
						document,
						offset,
						request.context,
					);
				case "textDocument/formatting":
					return format(service, document, undefined, request.options);
				case "textDocument/rangeFormatting":
					return format(
						service,
						document,
						request.range,
						request.options,
					);
				case "textDocument/documentSymbol":
					return documentSymbols(service, document);
				case "textDocument/definition":
					return definitions(service, documents, document, offset);
				case "textDocument/references":
					return references(service, documents, document, offset);
				case "textDocument/prepareRename": {
					const info = service.getRenameInfo(document.uri, offset, {
						allowRenameOfImportPath: true,
					});
					return info.canRename
						? rangeFromSpan(document, info.triggerSpan)
						: null;
				}
				case "textDocument/rename":
					return rename(
						service,
						documents,
						document,
						offset,
						request.newName,
					);
				case "textDocument/documentHighlight":
					return documentHighlights(service, document, offset);
				case "textDocument/codeAction":
					return codeActions(
						service,
						documents,
						document,
						request.range!,
						request.context,
						request.options,
					);
				case "textDocument/foldingRange":
					return foldingRanges(service, document);
				case "textDocument/selectionRange":
					return selectionRanges(
						service,
						document,
						(params as { positions: Position[] }).positions,
					);
				case "textDocument/inlayHint":
					return inlayHints(service, document, request.range!);
				default:
					return METHOD_NOT_HANDLED;
			}
		},

		closeDocument() {
			service.cleanupSemanticCache();
		},

		dispose() {
			service.dispose();
		},
	};
});

async function loadCompilerOptions(
	rootUri: string | null | undefined,
	requestFile: (uri: string) => Promise<string>,
): Promise<ts.CompilerOptions> {
	const defaults: ts.CompilerOptions = {
		allowJs: true,
		checkJs: true,
		allowImportingTsExtensions: true,
		noEmit: true,
		isolatedModules: true,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		moduleDetection: ts.ModuleDetectionKind.Force,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		jsx: ts.JsxEmit.ReactJSX,
		useDefineForClassFields: true,
	};
	(
		defaults as ts.CompilerOptions & {
			allowNonTsExtensions: boolean;
		}
	).allowNonTsExtensions = true;
	if (!rootUri) return defaults;

	try {
		const base = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
		const configUri = new URL("tsconfig.json", base).href;
		const text = await requestFile(configUri);
		const parsed = ts.parseConfigFileTextToJson(configUri, text);
		if (parsed.error || !parsed.config?.compilerOptions) return defaults;
		const converted = ts.convertCompilerOptionsFromJson(
			parsed.config.compilerOptions,
			base,
		);
		return { ...defaults, ...converted.options, noEmit: true };
	} catch {
		return defaults;
	}
}

function completions(
	service: ts.LanguageService,
	document: TextDocument,
	offset: number,
) {
	const result = service.getCompletionsAtPosition(document.uri, offset, {
		allowIncompleteCompletions: true,
		allowRenameOfImportPath: true,
		includeCompletionsForImportStatements: true,
		includeCompletionsForModuleExports: true,
		includeCompletionsWithInsertText: true,
		includeAutomaticOptionalChainCompletions: true,
		includeCompletionsWithClassMemberSnippets: true,
		includeCompletionsWithObjectLiteralMethodSnippets: true,
		includeCompletionsWithSnippetText: true,
		importModuleSpecifierPreference: "shortest",
	});
	if (!result) return { isIncomplete: false, items: [] };
	return {
		isIncomplete: !!result.isIncomplete,
		items: result.entries
			.filter((entry) => entry.name)
			.map((entry): CompletionItem => {
				const item: CompletionItem = {
					label: entry.name,
					kind: completionKind(entry.kind),
					sortText: entry.sortText,
					filterText: entry.filterText,
					insertText: entry.insertText ?? entry.name,
					commitCharacters:
						entry.commitCharacters ?? result.defaultCommitCharacters,
					data: {
						uri: document.uri,
						offset,
						name: entry.name,
						source: entry.source,
						entryData: entry.data,
					} satisfies CompletionData,
				};
				if (entry.replacementSpan) {
					item.textEdit = {
						range: rangeFromSpan(document, entry.replacementSpan),
						newText: entry.insertText ?? entry.name,
					};
				}
				return item;
			}),
	};
}

function resolveCompletion(
	service: ts.LanguageService,
	documents: Map<string, TextDocument>,
	item: CompletionItem,
): CompletionItem {
	const data = item.data as CompletionData | undefined;
	if (!data || !documents.has(data.uri)) return item;
	const details = service.getCompletionEntryDetails(
		data.uri,
		data.offset,
		data.name,
		formatSettings({ tabSize: 4, insertSpaces: true }),
		data.source,
		{
			allowRenameOfImportPath: true,
			importModuleSpecifierPreference: "shortest",
		},
		data.entryData,
	);
	if (!details) return item;

	item.detail = ts.displayPartsToString(details.displayParts);
	const documentation = ts.displayPartsToString(details.documentation);
	const tags = details.tags?.map(jsDocTag).join("\n\n") ?? "";
	item.documentation = markdownContent(
		[documentation, tags].filter(Boolean).join("\n\n"),
	);
	const edits: TextEdit[] = [];
	for (const action of details.codeActions ?? []) {
		for (const change of action.changes) {
			const target = documents.get(change.fileName);
			if (!target || change.fileName !== data.uri) continue;
			for (const textChange of change.textChanges) {
				edits.push({
					range: rangeFromSpan(target, textChange.span),
					newText: textChange.newText,
				});
			}
		}
	}
	if (edits.length) item.additionalTextEdits = edits;
	return item;
}

function hover(
	service: ts.LanguageService,
	document: TextDocument,
	offset: number,
) {
	const info = service.getQuickInfoAtPosition(document.uri, offset);
	if (!info) return null;
	const signature = ts.displayPartsToString(info.displayParts);
	const documentation = ts.displayPartsToString(info.documentation);
	const tags = info.tags?.map(jsDocTag).join("\n\n") ?? "";
	return {
		range: rangeFromSpan(document, info.textSpan),
		contents: [
			{
				language: isTypeScriptDocument(document)
					? "typescript"
					: "javascript",
				value: signature,
			},
			[documentation, tags].filter(Boolean).join("\n\n"),
		],
	};
}

function signatureHelp(
	service: ts.LanguageService,
	document: TextDocument,
	offset: number,
	context: RequestParams["context"],
): SignatureHelp | null {
	const items = service.getSignatureHelpItems(document.uri, offset, {
		triggerReason: signatureTrigger(context),
	});
	if (!items) return null;
	return {
		activeSignature: items.selectedItemIndex,
		activeParameter: items.argumentIndex,
		signatures: items.items.map((item) => ({
			label:
				ts.displayPartsToString(item.prefixDisplayParts) +
				item.parameters
					.map((parameter) =>
						ts.displayPartsToString(parameter.displayParts),
					)
					.join(ts.displayPartsToString(item.separatorDisplayParts)) +
				ts.displayPartsToString(item.suffixDisplayParts),
			documentation: markdownContent(
				ts.displayPartsToString(item.documentation),
			),
			parameters: item.parameters.map((parameter) => ({
				label: ts.displayPartsToString(parameter.displayParts),
				documentation: markdownContent(
					ts.displayPartsToString(parameter.documentation),
				),
			})),
		})),
	};
}

function markdownContent(value: string): MarkupContent | undefined {
	return value ? { kind: "markdown", value } : undefined;
}

function format(
	service: ts.LanguageService,
	document: TextDocument,
	range: Range | undefined,
	options: FormattingOptions,
): TextEdit[] {
	const settings = formatSettings(options);
	const edits = range
		? service.getFormattingEditsForRange(
				document.uri,
				document.offsetAt(range.start),
				document.offsetAt(range.end),
				settings,
			)
		: service.getFormattingEditsForDocument(document.uri, settings);
	return edits.map((edit) => ({
		range: rangeFromSpan(document, edit.span),
		newText: edit.newText,
	}));
}

function documentSymbols(
	service: ts.LanguageService,
	document: TextDocument,
): DocumentSymbol[] {
	const convert = (item: ts.NavigationTree): DocumentSymbol => ({
		name: item.text,
		kind: symbolKind(item.kind),
		range: rangeFromSpan(document, item.spans[0]),
		selectionRange: rangeFromSpan(document, item.spans[0]),
		children: item.childItems?.map(convert),
	});
	return service.getNavigationTree(document.uri).childItems?.map(convert) ?? [];
}

function definitions(
	service: ts.LanguageService,
	documents: Map<string, TextDocument>,
	document: TextDocument,
	offset: number,
): LocationLink[] {
	const result = service.getDefinitionAndBoundSpan(document.uri, offset);
	if (!result?.definitions) return [];
	const links: LocationLink[] = [];
	for (const definition of result.definitions) {
		const target = documents.get(definition.fileName);
		if (!target) continue;
		const selection = rangeFromSpan(target, definition.textSpan);
		links.push({
			targetUri: definition.fileName,
			targetRange: definition.contextSpan
				? rangeFromSpan(target, definition.contextSpan)
				: selection,
			targetSelectionRange: selection,
			originSelectionRange: rangeFromSpan(document, result.textSpan),
		});
	}
	return links;
}

function references(
	service: ts.LanguageService,
	documents: Map<string, TextDocument>,
	document: TextDocument,
	offset: number,
): Location[] {
	const result: Location[] = [];
	for (const reference of
		service.getReferencesAtPosition(document.uri, offset) ?? []) {
		const target = documents.get(reference.fileName);
		if (!target) continue;
		result.push({
			uri: reference.fileName,
			range: rangeFromSpan(target, reference.textSpan),
		});
	}
	return result;
}

function rename(
	service: ts.LanguageService,
	documents: Map<string, TextDocument>,
	document: TextDocument,
	offset: number,
	newName: string,
): WorkspaceEdit | null {
	const locations = service.findRenameLocations(
		document.uri,
		offset,
		false,
		false,
		{ providePrefixAndSuffixTextForRename: false },
	);
	if (!locations) return null;
	const changes: Record<string, TextEdit[]> = {};
	for (const location of locations) {
		const target = documents.get(location.fileName);
		if (!target) continue;
		(changes[location.fileName] ??= []).push({
			range: rangeFromSpan(target, location.textSpan),
			newText: newName,
		});
	}
	return { changes };
}

function documentHighlights(
	service: ts.LanguageService,
	document: TextDocument,
	offset: number,
): DocumentHighlight[] {
	const result: DocumentHighlight[] = [];
	for (const item of
		service.getDocumentHighlights(document.uri, offset, [document.uri]) ??
		[]) {
		for (const highlight of item.highlightSpans) {
			result.push({
				range: rangeFromSpan(document, highlight.textSpan),
				kind:
					highlight.kind === "writtenReference"
						? DocumentHighlightKind.Write
						: DocumentHighlightKind.Text,
			});
		}
	}
	return result;
}

function codeActions(
	service: ts.LanguageService,
	documents: Map<string, TextDocument>,
	document: TextDocument,
	range: Range,
	context: CodeActionContext,
	options: FormattingOptions,
): CodeAction[] {
	const fixes = service.getCodeFixesAtPosition(
		document.uri,
		document.offsetAt(range.start),
		document.offsetAt(range.end),
		context.diagnostics
			.map((diagnostic) => Number(diagnostic.code))
			.filter(Number.isFinite),
		formatSettings(options),
		{},
	);
	return fixes.map((fix) => {
		const changes: Record<string, TextEdit[]> = {};
		for (const change of fix.changes) {
			const target = documents.get(change.fileName);
			if (!target) continue;
			changes[change.fileName] = change.textChanges.map((textChange) => ({
				range: rangeFromSpan(target, textChange.span),
				newText: textChange.newText,
			}));
		}
		return {
			title: fix.description,
			kind: "quickfix",
			edit: Object.keys(changes).length ? { changes } : undefined,
		};
	});
}

function foldingRanges(
	service: ts.LanguageService,
	document: TextDocument,
): FoldingRange[] {
	const result: FoldingRange[] = [];
	for (const item of service.getOutliningSpans(document.uri)) {
		const range = rangeFromSpan(document, item.textSpan);
		if (range.start.line >= range.end.line) continue;
		result.push({
			startLine: range.start.line,
			endLine: range.end.line,
			kind:
				item.kind === ts.OutliningSpanKind.Comment
					? FoldingRangeKind.Comment
					: item.kind === ts.OutliningSpanKind.Region
						? FoldingRangeKind.Region
						: undefined,
		});
	}
	return result;
}

function selectionRanges(
	service: ts.LanguageService,
	document: TextDocument,
	positions: Position[],
): LspSelectionRange[] {
	const convert = (selection: ts.SelectionRange): LspSelectionRange =>
		SelectionRange.create(
			rangeFromSpan(document, selection.textSpan),
			selection.parent ? convert(selection.parent) : undefined,
		);
	return positions.map((position) =>
		convert(
			service.getSmartSelectionRange(
				document.uri,
				document.offsetAt(position),
			),
		),
	);
}

function inlayHints(
	service: ts.LanguageService,
	document: TextDocument,
	range: Range,
): InlayHint[] {
	const start = document.offsetAt(range.start);
	const end = document.offsetAt(range.end);
	return service
		.provideInlayHints(
			document.uri,
			{ start, length: end - start },
			{
				includeInlayParameterNameHints: "all",
				includeInlayParameterNameHintsWhenArgumentMatchesName: true,
				includeInlayFunctionParameterTypeHints: true,
				includeInlayVariableTypeHints: true,
				includeInlayPropertyDeclarationTypeHints: true,
				includeInlayFunctionLikeReturnTypeHints: true,
				includeInlayEnumMemberValueHints: true,
			},
		)
		.map((hint) => ({
			position: document.positionAt(hint.position),
			label:
				hint.text ||
				hint.displayParts?.map((part) => part.text).join("") ||
				"",
			kind:
				hint.kind === ts.InlayHintKind.Parameter
					? InlayHintKind.Parameter
					: InlayHintKind.Type,
			paddingLeft: hint.whitespaceBefore,
			paddingRight: hint.whitespaceAfter,
		}));
}

function toDiagnostic(
	document: TextDocument,
	diagnostic: ts.Diagnostic,
): Diagnostic {
	const tags: DiagnosticTag[] = [];
	if (diagnostic.reportsUnnecessary) tags.push(DiagnosticTag.Unnecessary);
	if (diagnostic.reportsDeprecated) tags.push(DiagnosticTag.Deprecated);
	return {
		range: rangeFromSpan(document, diagnostic),
		code: diagnostic.code,
		severity: diagnosticSeverity(diagnostic.category),
		message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
		source: diagnostic.source ?? "typescript",
		tags,
	};
}

function rangeFromSpan(
	document: TextDocument,
	span: { start?: number; length?: number },
): Range {
	const startOffset = span.start ?? 0;
	return Range.create(
		document.positionAt(startOffset),
		document.positionAt(startOffset + (span.length ?? 0)),
	);
}

function formatSettings(options: FormattingOptions): ts.FormatCodeSettings {
	const tabSize = options.tabSize ?? 4;
	const insertSpaces = options.insertSpaces ?? true;
	return {
		tabSize,
		indentSize: tabSize,
		convertTabsToSpaces: insertSpaces,
		trimTrailingWhitespace: options.trimTrailingWhitespace,
		insertSpaceAfterCommaDelimiter: insertSpaces,
		insertSpaceAfterSemicolonInForStatements: insertSpaces,
		insertSpaceBeforeAndAfterBinaryOperators: insertSpaces,
		insertSpaceAfterKeywordsInControlFlowStatements: insertSpaces,
		insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: insertSpaces,
	};
}

function completionKind(kind: ts.ScriptElementKind): CompletionItemKind {
	switch (kind) {
		case ts.ScriptElementKind.primitiveType:
		case ts.ScriptElementKind.keyword:
			return CompletionItemKind.Keyword;
		case ts.ScriptElementKind.constElement:
		case ts.ScriptElementKind.letElement:
		case ts.ScriptElementKind.variableElement:
		case ts.ScriptElementKind.localVariableElement:
		case ts.ScriptElementKind.alias:
		case ts.ScriptElementKind.parameterElement:
			return CompletionItemKind.Variable;
		case ts.ScriptElementKind.memberVariableElement:
		case ts.ScriptElementKind.memberGetAccessorElement:
		case ts.ScriptElementKind.memberSetAccessorElement:
			return CompletionItemKind.Field;
		case ts.ScriptElementKind.functionElement:
		case ts.ScriptElementKind.localFunctionElement:
			return CompletionItemKind.Function;
		case ts.ScriptElementKind.memberFunctionElement:
		case ts.ScriptElementKind.constructSignatureElement:
		case ts.ScriptElementKind.callSignatureElement:
		case ts.ScriptElementKind.indexSignatureElement:
			return CompletionItemKind.Method;
		case ts.ScriptElementKind.enumElement:
			return CompletionItemKind.Enum;
		case ts.ScriptElementKind.enumMemberElement:
			return CompletionItemKind.EnumMember;
		case ts.ScriptElementKind.moduleElement:
		case ts.ScriptElementKind.externalModuleName:
			return CompletionItemKind.Module;
		case ts.ScriptElementKind.classElement:
		case ts.ScriptElementKind.typeElement:
			return CompletionItemKind.Class;
		case ts.ScriptElementKind.interfaceElement:
			return CompletionItemKind.Interface;
		case ts.ScriptElementKind.scriptElement:
			return CompletionItemKind.File;
		case ts.ScriptElementKind.directory:
			return CompletionItemKind.Folder;
		default:
			return CompletionItemKind.Property;
	}
}

function symbolKind(kind: ts.ScriptElementKind): SymbolKind {
	switch (kind) {
		case ts.ScriptElementKind.memberVariableElement:
			return SymbolKind.Field;
		case ts.ScriptElementKind.functionElement:
		case ts.ScriptElementKind.localFunctionElement:
			return SymbolKind.Function;
		case ts.ScriptElementKind.memberFunctionElement:
			return SymbolKind.Method;
		case ts.ScriptElementKind.enumElement:
			return SymbolKind.Enum;
		case ts.ScriptElementKind.enumMemberElement:
			return SymbolKind.EnumMember;
		case ts.ScriptElementKind.moduleElement:
		case ts.ScriptElementKind.externalModuleName:
			return SymbolKind.Module;
		case ts.ScriptElementKind.classElement:
		case ts.ScriptElementKind.typeElement:
			return SymbolKind.Class;
		case ts.ScriptElementKind.interfaceElement:
			return SymbolKind.Interface;
		case ts.ScriptElementKind.scriptElement:
			return SymbolKind.File;
		default:
			return SymbolKind.Variable;
	}
}

function diagnosticSeverity(
	category: ts.DiagnosticCategory,
): DiagnosticSeverity {
	switch (category) {
		case ts.DiagnosticCategory.Error:
			return DiagnosticSeverity.Error;
		case ts.DiagnosticCategory.Warning:
			return DiagnosticSeverity.Warning;
		case ts.DiagnosticCategory.Suggestion:
			return DiagnosticSeverity.Hint;
		default:
			return DiagnosticSeverity.Information;
	}
}

function signatureTrigger(
	context: RequestParams["context"],
): ts.SignatureHelpTriggerReason {
	if (context?.triggerKind === 2 && context.triggerCharacter) {
		return context.isRetrigger
			? {
					kind: "retrigger",
					triggerCharacter:
						context.triggerCharacter as ts.SignatureHelpTriggerCharacter,
				}
			: {
					kind: "characterTyped",
					triggerCharacter:
						context.triggerCharacter as ts.SignatureHelpTriggerCharacter,
				};
	}
	return context?.isRetrigger ? { kind: "retrigger" } : { kind: "invoked" };
}

function jsDocTag(tag: ts.JSDocTagInfo): string {
	const text = Array.isArray(tag.text)
		? tag.text.map((part) => part.text).join("")
		: (tag.text ?? "");
	return `*@${tag.name}*${text ? ` — ${text}` : ""}`;
}

function isTypeScriptDocument(document: TextDocument): boolean {
	return (
		document.languageId.startsWith("typescript") ||
		document.languageId === "tsx"
	);
}

function uriPath(uri: string): string {
	try {
		return new URL(uri).pathname;
	} catch {
		return uri;
	}
}
