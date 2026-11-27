import ts from "typescript";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	CompletionItemKind,
	type Diagnostic,
	DiagnosticSeverity,
	DiagnosticTag,
	type FormattingOptions,
	type MarkupContent,
	Range,
	SymbolKind,
} from "vscode-languageserver-types";

export interface SignatureContext {
	triggerKind?: number;
	triggerCharacter?: string;
	isRetrigger?: boolean;
}

export function toDiagnostic(
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

export function rangeFromSpan(
	document: TextDocument,
	span: { start?: number; length?: number },
): Range {
	const startOffset = span.start ?? 0;
	return Range.create(
		document.positionAt(startOffset),
		document.positionAt(startOffset + (span.length ?? 0)),
	);
}

export function formatSettings(
	options?: FormattingOptions | null,
): ts.FormatCodeSettings {
	const tabSize = options?.tabSize ?? 4;
	const insertSpaces = options?.insertSpaces ?? true;
	return {
		tabSize,
		indentSize: tabSize,
		convertTabsToSpaces: insertSpaces,
		trimTrailingWhitespace: options?.trimTrailingWhitespace,
		insertSpaceAfterCommaDelimiter: insertSpaces,
		insertSpaceAfterSemicolonInForStatements: insertSpaces,
		insertSpaceBeforeAndAfterBinaryOperators: insertSpaces,
		insertSpaceAfterKeywordsInControlFlowStatements: insertSpaces,
		insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: insertSpaces,
	};
}

export function markdownContent(value: string): MarkupContent | undefined {
	return value ? { kind: "markdown", value } : undefined;
}

export function jsDocTag(tag: ts.JSDocTagInfo): string {
	const text = Array.isArray(tag.text)
		? tag.text.map((part) => part.text).join("")
		: (tag.text ?? "");
	return `*@${tag.name}*${text ? ` — ${text}` : ""}`;
}

export function signatureTrigger(
	context: SignatureContext | undefined,
): ts.SignatureHelpTriggerReason {
	if (context?.triggerKind === 2 && context.triggerCharacter) {
		const triggerCharacter =
			context.triggerCharacter as ts.SignatureHelpTriggerCharacter;
		return context.isRetrigger
			? { kind: "retrigger", triggerCharacter }
			: { kind: "characterTyped", triggerCharacter };
	}
	return context?.isRetrigger ? { kind: "retrigger" } : { kind: "invoked" };
}

export function completionKind(kind: ts.ScriptElementKind): CompletionItemKind {
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

export function symbolKind(kind: ts.ScriptElementKind): SymbolKind {
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
