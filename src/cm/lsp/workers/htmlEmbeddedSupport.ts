import {
	type LanguageService,
	type Position,
	type TextDocument,
	TokenType,
} from "vscode-html-languageservice";

export interface EmbeddedRegion {
	start: number;
	end: number;
	languageId?: string;
	attributeValue?: boolean;
}

export interface ImportedScript {
	start: number;
	end: number;
	src: string;
}

export interface HTMLDocumentRegions {
	readonly regions: readonly EmbeddedRegion[];
	readonly importedScripts: readonly ImportedScript[];
	getEmbeddedDocument(
		languageId: string,
		ignoreAttributeValues: boolean,
	): string | null;
	getEmbeddedLanguages(ignoreAttributeValues?: boolean): string[];
	getEmbeddedLanguageAtPosition(position: Position): string | undefined;
	hasEmbeddedLanguage(
		languageId: string,
		ignoreAttributeValues?: boolean,
	): boolean;
}

interface CachedRegions {
	regions: EmbeddedRegion[];
	importedScripts: ImportedScript[];
	version: number;
	expires: number;
}

const cache = new Map<string, CachedRegions>();

export function clearDocumentRegions(uri?: string): void {
	if (uri) cache.delete(uri);
	else cache.clear();
}

export function getDocumentRegions(
	languageService: LanguageService,
	document: TextDocument,
): HTMLDocumentRegions {
	const regions: EmbeddedRegion[] = [];
	const importedScripts: ImportedScript[] = [];
	const cached = cache.get(document.uri);

	if (
		cached &&
		cached.version === document.version &&
		cached.expires > Date.now()
	) {
		regions.push(...cached.regions);
		importedScripts.push(...cached.importedScripts);
	} else {
		const scanner = languageService.createScanner(document.getText());
		let lastTagName = "";
		let lastAttributeName: string | null = null;
		let lastLanguageId: string | undefined;
		let token = scanner.scan();

		while (token !== TokenType.EOS) {
			switch (token) {
				case TokenType.StartTag:
					lastTagName = scanner.getTokenText();
					lastAttributeName = null;
					lastLanguageId = "javascript";
					break;
				case TokenType.Styles:
					regions.push({
						languageId: "css",
						start: scanner.getTokenOffset(),
						end: scanner.getTokenEnd(),
					});
					break;
				case TokenType.Script:
					regions.push({
						languageId: lastLanguageId,
						start: scanner.getTokenOffset(),
						end: scanner.getTokenEnd(),
					});
					break;
				case TokenType.AttributeName:
					lastAttributeName = scanner.getTokenText();
					break;
				case TokenType.AttributeValue:
					if (
						lastAttributeName === "src" &&
						lastTagName.toLowerCase() === "script"
					) {
						let src = scanner.getTokenText();
						if (src[0] === "'" || src[0] === '"') {
							src = src.slice(1, -1);
						}
						importedScripts.push({
							start: scanner.getTokenOffset(),
							end: scanner.getTokenEnd(),
							src,
						});
					} else if (
						lastAttributeName === "type" &&
						lastTagName.toLowerCase() === "script"
					) {
						const tokenText = scanner.getTokenText();
						if (
							/["'](module|(text|application)\/(java|ecma)script|text\/babel)["']/.test(
								tokenText,
							)
						) {
							lastLanguageId = "javascript";
						} else if (/["']importmap["']/.test(tokenText)) {
							lastLanguageId = "importmap";
						} else {
							lastLanguageId = undefined;
						}
					} else if (lastAttributeName) {
						const languageId = getAttributeLanguage(lastAttributeName);
						if (languageId) {
							let start = scanner.getTokenOffset();
							let end = scanner.getTokenEnd();
							const firstChar = document.getText()[start];
							if (firstChar === "'" || firstChar === '"') {
								start++;
								end--;
							}
							regions.push({
								languageId,
								start,
								end,
								attributeValue: true,
							});
						}
					}
					lastAttributeName = null;
					break;
			}
			token = scanner.scan();
		}

		cache.set(document.uri, {
			regions,
			importedScripts,
			version: document.version,
			expires: Date.now() + 30000,
		});
	}

	return {
		regions,
		importedScripts,
		getEmbeddedDocument: (languageId, ignoreAttributeValues) =>
			getEmbeddedDocument(
				document,
				regions,
				languageId,
				ignoreAttributeValues,
			),
		getEmbeddedLanguages: (ignoreAttributeValues) =>
			getEmbeddedLanguages(regions, ignoreAttributeValues),
		getEmbeddedLanguageAtPosition: (position) =>
			getEmbeddedLanguageAtPosition(document, regions, position),
		hasEmbeddedLanguage: (languageId, ignoreAttributeValues) =>
			regions.some(
				(region) =>
					region.languageId === languageId &&
					(!ignoreAttributeValues || !region.attributeValue),
			),
	};
}

function getEmbeddedLanguages(
	regions: EmbeddedRegion[],
	ignoreAttributeValues?: boolean,
): string[] {
	const result: string[] = [];
	for (const { languageId, attributeValue } of regions) {
		if (
			languageId &&
			(!ignoreAttributeValues || !attributeValue) &&
			!result.includes(languageId)
		) {
			result.push(languageId);
		}
	}
	return result;
}

function getEmbeddedLanguageAtPosition(
	document: TextDocument,
	regions: EmbeddedRegion[],
	position: Position,
): string | undefined {
	const offset = document.offsetAt(position);
	for (const region of regions) {
		if (region.start > offset) break;
		if (offset <= region.end) return region.languageId;
	}
	return undefined;
}

function getEmbeddedDocument(
	document: TextDocument,
	regions: EmbeddedRegion[],
	languageId: string,
	ignoreAttributeValues: boolean,
): string | null {
	const documentText = document.getText();
	let currentPosition = 0;
	let result = "";
	let lastSuffix = "";
	let hasAny = false;

	for (const region of regions) {
		if (
			region.languageId === languageId &&
			(!ignoreAttributeValues || !region.attributeValue)
		) {
			result = substituteWithWhitespace(
				result,
				currentPosition,
				region.start,
				documentText,
				lastSuffix,
				getPrefix(region),
			);
			result += updateContent(
				region,
				documentText.substring(region.start, region.end),
			);
			currentPosition = region.end;
			lastSuffix = getSuffix(region);
			hasAny = true;
		}
	}

	return hasAny ? result + lastSuffix : null;
}

function getPrefix(region: EmbeddedRegion): string {
	if (region.attributeValue && region.languageId === "css") return "__{";
	return "";
}

function getSuffix(region: EmbeddedRegion): string {
	if (!region.attributeValue) return "";
	if (region.languageId === "css") return "}";
	if (region.languageId === "javascript") return ";";
	return "";
}

function updateContent(region: EmbeddedRegion, content: string): string {
	if (!region.attributeValue && region.languageId === "javascript") {
		return content.replace("<!--", "/* ").replace("-->", " */");
	}
	return content;
}

function substituteWithWhitespace(
	result: string,
	start: number,
	end: number,
	oldContent: string,
	before: string,
	after: string,
): string {
	result += before;
	let accumulatedWhitespace = -before.length;
	for (let index = start; index < end; index++) {
		const character = oldContent[index];
		if (character === "\n" || character === "\r") {
			accumulatedWhitespace = 0;
			result += character;
		} else {
			accumulatedWhitespace++;
		}
	}
	result = append(result, " ", accumulatedWhitespace - after.length);
	return result + after;
}

function append(result: string, value: string, count: number): string {
	let repeatedValue = value;
	let remaining = count;
	while (remaining > 0) {
		if (remaining & 1) result += repeatedValue;
		remaining >>= 1;
		repeatedValue += repeatedValue;
	}
	return result;
}

function getAttributeLanguage(attributeName: string): string | null {
	if (attributeName === "style") return "css";
	if (
		attributeName.startsWith("on") &&
		/^[a-z]+$/.test(attributeName.slice(2))
	) {
		return "javascript";
	}
	return null;
}
