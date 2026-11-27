import ts from "typescript";
import type {
	CompletionItem,
	SignatureHelp,
	TextEdit,
} from "vscode-languageserver-types";
import {
	completionKind,
	formatSettings,
	jsDocTag,
	markdownContent,
	rangeFromSpan,
	type SignatureContext,
	signatureTrigger,
} from "./convert";
import { isTypeScriptLanguage } from "./scripts";
import type { ServiceTarget } from "./workspace";

export interface CompletionData {
	acodeLspProvider: "typescript";
	uri: string;
	offset: number;
	name: string;
	source?: string;
	entryData?: ts.CompletionEntryData;
}
export function completions(target: ServiceTarget, offset: number) {
	const { service, document, fileName } = target;
	const result = service.getCompletionsAtPosition(fileName, offset, {
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
						acodeLspProvider: "typescript",
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

export function resolveCompletion(
	target: ServiceTarget,
	item: CompletionItem,
	data: CompletionData,
): CompletionItem {
	const { service, document, fileName } = target;
	const details = service.getCompletionEntryDetails(
		fileName,
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
			if (change.fileName !== fileName) continue;
			for (const textChange of change.textChanges) {
				edits.push({
					range: rangeFromSpan(document, textChange.span),
					newText: textChange.newText,
				});
			}
		}
	}
	if (edits.length) item.additionalTextEdits = edits;
	return item;
}

export function hover(target: ServiceTarget, offset: number) {
	const { service, document, fileName } = target;
	const info = service.getQuickInfoAtPosition(fileName, offset);
	if (!info) return null;
	const signature = ts.displayPartsToString(info.displayParts);
	const documentation = ts.displayPartsToString(info.documentation);
	const tags = info.tags?.map(jsDocTag).join("\n\n") ?? "";
	return {
		range: rangeFromSpan(document, info.textSpan),
		contents: [
			{
				language: isTypeScriptLanguage(document.languageId)
					? "typescript"
					: "javascript",
				value: signature,
			},
			[documentation, tags].filter(Boolean).join("\n\n"),
		],
	};
}

export function signatureHelp(
	target: ServiceTarget,
	offset: number,
	context: SignatureContext | undefined,
): SignatureHelp | null {
	const items = target.service.getSignatureHelpItems(target.fileName, offset, {
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
					.map((parameter) => ts.displayPartsToString(parameter.displayParts))
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
