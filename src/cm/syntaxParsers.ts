import { type LanguageSupport, StreamLanguage } from "@codemirror/language";
import type { Parser } from "@lezer/common";

/**
 * Parsers for the canvas renderer's syntax worker (src/cm/syntaxWorker.ts),
 * configured like supportedModes.ts configures the editor's languages: the
 * worker only parses a document whose parser matches the editor's (same
 * node set, dialect and nested-language wrappers), and the editor parses
 * it itself otherwise. Several configurations share a name (Acode's
 * JavaScript mode uses the JSX dialect, which is named "javascript" too),
 * so all of them are returned and the worker picks the matching one.
 */

// Languages from @codemirror/language-data parsed in the worker, by the
// Language's name, with the descriptions that load them. Only Lezer
// grammars: stream modes parse with the editor's state, and SQL's dialects
// differ in their tokenizers while sharing one node set.
const DATA_LANGUAGES: Record<string, readonly string[]> = {
	css: ["css"],
	less: ["less"],
	sass: ["sass", "scss"],
	json: ["json"],
	python: ["python"],
	java: ["java"],
	cpp: ["c++", "c"],
	rust: ["rust"],
	go: ["go"],
	yaml: ["yaml"],
	wast: ["webassembly"],
};

const parserOf = (support: LanguageSupport) => support.language.parser;

async function htmlParsers(): Promise<Parser[]> {
	const { html } = await import("@codemirror/lang-html");
	// The plain mode, PHP's base (no closing tag matching) and Angular's
	// (self-closing tags).
	return [
		html(),
		html({ matchClosingTags: false }),
		html({ selfClosingTags: true }),
	].map(parserOf);
}

async function load(name: string): Promise<Parser[]> {
	switch (name) {
		case "javascript":
		case "typescript": {
			const { javascriptSupport } = await import("./modes/javascript");
			const configs =
				name === "javascript"
					? [{ jsx: true }, {}]
					: [{ typescript: true }, { jsx: true, typescript: true }];
			return configs.map((config) => parserOf(javascriptSupport(config)));
		}
		case "html":
			return htmlParsers();
		case "xml": {
			const { xml } = await import("@codemirror/lang-xml");
			return [parserOf(xml())];
		}
		case "markdown": {
			const { markdown, markdownLanguage } = await import(
				"@codemirror/lang-markdown"
			);
			return [parserOf(markdown({ base: markdownLanguage }))];
		}
		case "php": {
			const [{ php }, { html }] = await Promise.all([
				import("@codemirror/lang-php"),
				import("@codemirror/lang-html"),
			]);
			const base = html({ matchClosingTags: false }).language;
			return [parserOf(php({ baseLanguage: base }))];
		}
		case "vue": {
			const [{ vue }, { html }] = await Promise.all([
				import("@codemirror/lang-vue"),
				import("@codemirror/lang-html"),
			]);
			return [parserOf(vue({ base: html() }))];
		}
		case "angular": {
			const [{ angular }, { html }] = await Promise.all([
				import("@codemirror/lang-angular"),
				import("@codemirror/lang-html"),
			]);
			// supportedModes.ts's Angular configuration, and @codemirror/language-data's
			// (its mode is named "Angular Template", which that switch doesn't match).
			return [
				angular({ base: html({ selfClosingTags: true }) }),
				angular(),
			].map(parserOf);
		}
	}
	const names = DATA_LANGUAGES[name];
	if (!names) return [];
	const { languages } = await import("@codemirror/language-data");
	const found = languages.filter((desc) =>
		[desc.name, ...desc.alias].some((n) => names.includes(n.toLowerCase())),
	);
	const supports = await Promise.all(found.map((desc) => desc.load()));
	return supports
		.filter(
			(support) =>
				support.language.name === name &&
				!(support.language instanceof StreamLanguage),
		)
		.map(parserOf);
}

const cache = new Map<string, Promise<Parser[]>>();

/** The parsers for a Language's name (empty when the worker doesn't parse it). */
export function syntaxParsers(name: string): Promise<Parser[]> {
	let parsers = cache.get(name);
	if (!parsers) {
		parsers = load(name).catch(() => []);
		cache.set(name, parsers);
	}
	return parsers;
}
