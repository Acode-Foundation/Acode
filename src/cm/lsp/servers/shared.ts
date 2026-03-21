export function normalizeServerLanguageKey(
	value: string | undefined | null,
): string {
	return String(value ?? "")
		.trim()
		.toLowerCase();
}

export function resolveJsTsLanguageId(
	languageId: string | undefined,
	languageName: string | undefined,
): string | null {
	const lang = normalizeServerLanguageKey(languageId ?? languageName);
	switch (lang) {
		case "tsx":
		case "typescriptreact":
			return "typescriptreact";
		case "jsx":
		case "javascriptreact":
			return "javascriptreact";
		case "ts":
			return "typescript";
		case "js":
			return "javascript";
		default:
			return lang || null;
	}
}
