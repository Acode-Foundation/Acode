import type ts from "typescript";
import {
	type CodeAction,
	type CodeActionContext,
	type DocumentHighlight,
	DocumentHighlightKind,
	type FormattingOptions,
	type Location,
	type LocationLink,
	type Range,
	type TextEdit,
	type WorkspaceEdit,
} from "vscode-languageserver-types";
import { formatSettings, rangeFromSpan } from "./convert";
import type { ServiceTarget } from "./workspace";

export function definitions(
	target: ServiceTarget,
	offset: number,
): LocationLink[] {
	const { service, document, fileName } = target;
	const result = service.getDefinitionAndBoundSpan(fileName, offset);
	if (!result?.definitions) return [];
	const links: LocationLink[] = [];
	for (const definition of result.definitions) {
		const location = locate(target, definition.fileName, definition.textSpan);
		if (!location) continue;
		links.push({
			targetUri: location.uri,
			targetRange: definition.contextSpan
				? (locate(target, definition.fileName, definition.contextSpan)?.range ??
					location.range)
				: location.range,
			targetSelectionRange: location.range,
			originSelectionRange: rangeFromSpan(document, result.textSpan),
		});
	}
	return links;
}

export function references(target: ServiceTarget, offset: number): Location[] {
	const { service, fileName } = target;
	return locations(target, service.getReferencesAtPosition(fileName, offset));
}

export function implementations(
	target: ServiceTarget,
	offset: number,
): Location[] {
	const { service, fileName } = target;
	return locations(
		target,
		service.getImplementationAtPosition(fileName, offset),
	);
}

export function typeDefinitions(
	target: ServiceTarget,
	offset: number,
): Location[] {
	const { service, fileName } = target;
	return locations(
		target,
		service.getTypeDefinitionAtPosition(fileName, offset),
	);
}

export function prepareRename(
	target: ServiceTarget,
	offset: number,
): Range | null {
	const info = target.service.getRenameInfo(target.fileName, offset, {
		allowRenameOfImportPath: true,
	});
	return info.canRename
		? rangeFromSpan(target.document, info.triggerSpan)
		: null;
}

export function rename(
	target: ServiceTarget,
	offset: number,
	newName: string,
): WorkspaceEdit | null {
	const locations = target.service.findRenameLocations(
		target.fileName,
		offset,
		false,
		false,
		{ providePrefixAndSuffixTextForRename: false },
	);
	if (!locations) return null;
	const changes: Record<string, TextEdit[]> = {};
	for (const location of locations) {
		const found = locate(target, location.fileName, location.textSpan);
		if (!found) continue;
		(changes[found.uri] ??= []).push({ range: found.range, newText: newName });
	}
	return { changes };
}

export function documentHighlights(
	target: ServiceTarget,
	offset: number,
): DocumentHighlight[] {
	const { service, document, fileName } = target;
	const result: DocumentHighlight[] = [];
	for (const item of service.getDocumentHighlights(fileName, offset, [
		fileName,
	]) ?? []) {
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

export function codeActions(
	target: ServiceTarget,
	range: Range,
	context: CodeActionContext,
	options?: FormattingOptions,
): CodeAction[] {
	const { service, document, fileName } = target;
	const fixes = service.getCodeFixesAtPosition(
		fileName,
		document.offsetAt(range.start),
		document.offsetAt(range.end),
		context.diagnostics
			.map((diagnostic) => Number(diagnostic.code))
			.filter(Number.isFinite),
		formatSettings(options),
		{},
	);
	return fixes.map((fix) => {
		const changes = textChanges(target, fix.changes);
		return {
			title: fix.description,
			kind: "quickfix",
			edit: Object.keys(changes).length ? { changes } : undefined,
		};
	});
}

export function textChanges(
	target: ServiceTarget,
	fileChanges: readonly ts.FileTextChanges[],
): Record<string, TextEdit[]> {
	const changes: Record<string, TextEdit[]> = {};
	for (const change of fileChanges) {
		const uri = target.uriOf(change.fileName);
		const document = target.documentOf(change.fileName);
		if (!uri || !document) continue;
		changes[uri] = change.textChanges.map((textChange) => ({
			range: rangeFromSpan(document, textChange.span),
			newText: textChange.newText,
		}));
	}
	return changes;
}

function locations(
	target: ServiceTarget,
	spans: readonly { fileName: string; textSpan: ts.TextSpan }[] | undefined,
): Location[] {
	const result: Location[] = [];
	for (const span of spans ?? []) {
		const location = locate(target, span.fileName, span.textSpan);
		if (location) result.push(location);
	}
	return result;
}

function locate(
	target: ServiceTarget,
	fileName: string,
	span: ts.TextSpan,
): Location | undefined {
	const uri = target.uriOf(fileName);
	const document = uri && target.documentOf(fileName);
	if (!uri || !document) return undefined;
	return { uri, range: rangeFromSpan(document, span) };
}
