import ts from "typescript";
import {
	type Diagnostic,
	type DocumentSymbol,
	type FoldingRange,
	FoldingRangeKind,
	type FormattingOptions,
	type InlayHint,
	InlayHintKind,
	type SelectionRange as LspSelectionRange,
	type Position,
	type Range,
	SelectionRange,
	type TextEdit,
} from "vscode-languageserver-types";
import {
	formatSettings,
	rangeFromSpan,
	symbolKind,
	toDiagnostic,
} from "./convert";
import { isTypeScriptLanguage } from "./scripts";
import type { ServiceTarget } from "./workspace";

export function diagnostics(target: ServiceTarget): Diagnostic[] {
	const { service, document, fileName } = target;
	const found: ts.Diagnostic[] = [
		...service.getSyntacticDiagnostics(fileName),
		...service.getSuggestionDiagnostics(fileName),
	];
	if (isTypeScriptLanguage(document.languageId) || target.checkJs) {
		found.push(...service.getSemanticDiagnostics(fileName));
	}
	return found.map((diagnostic) => toDiagnostic(document, diagnostic));
}
export function format(
	target: ServiceTarget,
	range: Range | undefined,
	options?: FormattingOptions,
): TextEdit[] {
	const { service, document, fileName } = target;
	const settings = formatSettings(options);
	const edits = range
		? service.getFormattingEditsForRange(
				fileName,
				document.offsetAt(range.start),
				document.offsetAt(range.end),
				settings,
			)
		: service.getFormattingEditsForDocument(fileName, settings);
	return edits.map((edit) => ({
		range: rangeFromSpan(document, edit.span),
		newText: edit.newText,
	}));
}

export function documentSymbols(target: ServiceTarget): DocumentSymbol[] {
	const { service, document, fileName } = target;
	const convert = (item: ts.NavigationTree): DocumentSymbol => ({
		name: item.text,
		kind: symbolKind(item.kind),
		range: rangeFromSpan(document, item.spans[0]),
		selectionRange: rangeFromSpan(document, item.spans[0]),
		children: item.childItems?.map(convert),
	});
	return service.getNavigationTree(fileName).childItems?.map(convert) ?? [];
}

export function foldingRanges(target: ServiceTarget): FoldingRange[] {
	const result: FoldingRange[] = [];
	for (const item of target.service.getOutliningSpans(target.fileName)) {
		const range = rangeFromSpan(target.document, item.textSpan);
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

export function selectionRanges(
	target: ServiceTarget,
	positions: Position[],
): LspSelectionRange[] {
	const { service, document, fileName } = target;
	const convert = (selection: ts.SelectionRange): LspSelectionRange =>
		SelectionRange.create(
			rangeFromSpan(document, selection.textSpan),
			selection.parent ? convert(selection.parent) : undefined,
		);
	return positions.map((position) =>
		convert(
			service.getSmartSelectionRange(fileName, document.offsetAt(position)),
		),
	);
}

export function inlayHints(target: ServiceTarget, range: Range): InlayHint[] {
	const { service, document, fileName } = target;
	const start = document.offsetAt(range.start);
	const end = document.offsetAt(range.end);
	return service
		.provideInlayHints(
			fileName,
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
				hint.text || hint.displayParts?.map((part) => part.text).join("") || "",
			kind:
				hint.kind === ts.InlayHintKind.Parameter
					? InlayHintKind.Parameter
					: InlayHintKind.Type,
			paddingLeft: hint.whitespaceBefore,
			paddingRight: hint.whitespaceAfter,
		}));
}
