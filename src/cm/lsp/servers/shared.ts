import type { LspServerManifest } from "../types";

export function normalizeServerLanguageKey(
	value: string | undefined | null,
): string {
	return String(value ?? "")
		.trim()
		.toLowerCase();
}

export function isTailwindCssServer(server: LspServerManifest): boolean {
	const identifiers = [
		server.id,
		server.label,
		server.transport?.command,
		...(server.transport?.args ?? []),
		server.launcher?.command,
		...(server.launcher?.args ?? []),
		server.launcher?.bridge?.command,
		...(server.launcher?.bridge?.args ?? []),
	];
	return identifiers.some((value) =>
		normalizeServerLanguageKey(value).includes("tailwindcss"),
	);
}

export function addJsTsLanguageAliases(languages: string[]): string[] {
	const aliases = new Set(languages.map(normalizeServerLanguageKey));
	const pairs = [
		["js", "javascript"],
		["jsx", "javascriptreact"],
		["ts", "typescript"],
		["tsx", "typescriptreact"],
	];
	for (const [short, standard] of pairs) {
		if (!aliases.has(short) && !aliases.has(standard)) continue;
		aliases.add(short);
		aliases.add(standard);
	}
	return [...aliases].filter(Boolean);
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
