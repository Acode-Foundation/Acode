import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { addMode } from "./modelist";

type FilenameMatcher = string | RegExp;

interface LanguageDescription {
	name?: string;
	alias?: readonly string[];
	extensions?: readonly string[];
	filenames?: readonly FilenameMatcher[];
	filename?: FilenameMatcher;
	load?: () => Promise<Extension>;
}

function normalizeModeKey(value: string): string {
	return String(value ?? "")
		.trim()
		.toLowerCase();
}

function isSafeModeId(value: string): boolean {
	return /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

function slugifyModeId(value: string): string {
	return normalizeModeKey(value)
		.replace(/\+\+/g, "pp")
		.replace(/#/g, "sharp")
		.replace(/&/g, "and")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function collectAliases(
	name: string,
	aliases: readonly string[] | undefined,
): string[] {
	return [
		...new Set(
			[name, ...(aliases || [])].map(normalizeModeKey).filter(Boolean),
		),
	];
}

function getModeId(name: string, aliases: string[]): string {
	const normalizedName = normalizeModeKey(name);
	if (isSafeModeId(normalizedName)) return normalizedName;

	const safeAlias = aliases.find(
		(alias) => alias !== normalizedName && isSafeModeId(alias),
	);
	return safeAlias || slugifyModeId(name) || normalizedName || "text";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 1) Always register a plain text fallback
addMode("Text", "txt|text|log|plain", "Plain Text", () => []);

// 2) Register all languages provided by @codemirror/language-data
//    We convert extensions like [".js", ".mjs"] into a modelist pattern: "js|mjs"
//    and preserve aliases and filename regexes for languages like C++ and Dockerfile.
for (const lang of languages as readonly LanguageDescription[]) {
	try {
		const name = String(lang?.name || "").trim();
		if (!name) continue;

		const aliases = collectAliases(name, lang.alias);
		const modeId = getModeId(name, aliases);
		const parts: string[] = [];
		const filenameMatchers: RegExp[] = [];

		// File extensions
		if (Array.isArray(lang.extensions)) {
			for (const e of lang.extensions) {
				if (typeof e !== "string") continue;
				const cleaned = e.replace(/^\./, "").trim();
				if (cleaned) parts.push(cleaned);
			}
		}

		// Exact filenames / filename regexes (Dockerfile, PKGBUILD, nginx*.conf, etc.)
		const filenames = Array.isArray(lang.filenames)
			? lang.filenames
			: lang.filename
				? [lang.filename]
				: [];
		for (const fn of filenames) {
			if (typeof fn === "string") {
				const cleaned = fn.trim();
				if (cleaned) {
					filenameMatchers.push(new RegExp(`^${escapeRegExp(cleaned)}$`, "i"));
				}
				continue;
			}

			if (fn instanceof RegExp) {
				filenameMatchers.push(new RegExp(fn.source, fn.flags));
			}
		}

		const pattern = parts.join("|");

		// Wrap language-data loader as our modelist language provider
		// lang.load() returns a Promise<Extension>; we let the editor handle async loading
		const loader = typeof lang.load === "function" ? () => lang.load!() : null;

		addMode(modeId, pattern, name, loader, {
			aliases,
			filenameMatchers,
		});
	} catch (_) {
		// Ignore faulty entries to avoid breaking the whole registration
	}
}

// Luau isn't bundled in @codemirror/language-data, so register it explicitly.
addMode("Luau", "luau", "Luau", async () => {
	const { luau } = await import("./modes/luau");
	return luau();
});
