import { snippet, snippetCompletion } from "@codemirror/autocomplete";
import appSettings from "lib/settings";

const SUPPORTED_LANGUAGES = [
	"html",
	"css",
	"javascript",
	"typescript",
	"python",
	"java",
	"c",
	"cpp",
	"csharp",
	"php",
	"ruby",
	"go",
	"kotlin",
	"swift",
	"dart",
	"rust",
	"sql",
	"bash",
	"json",
	"yaml",
	"xml",
	"markdown",
	"lua",
	"perl",
	"r",
	"scala",
	"haskell",
	"elixir",
	"clojure",
	"objectivec",
	"groovy",
	"powershell",
	"shellscript",
	"vbscript",
	"assembly",
	"matlab",
	"julia",
	"cobol",
	"fortran",
];

const LANGUAGE_ALIASES = {
	html: "html",
	css: "css",
	javascript: "javascript",
	js: "javascript",
	typescript: "typescript",
	ts: "typescript",
	python: "python",
	py: "python",
	java: "java",
	c: "c",
	cpp: "cpp",
	"c++": "cpp",
	c_cpp: "cpp",
	csharp: "csharp",
	"c#": "csharp",
	cs: "csharp",
	php: "php",
	ruby: "ruby",
	rb: "ruby",
	go: "go",
	golang: "go",
	kotlin: "kotlin",
	swift: "swift",
	dart: "dart",
	rust: "rust",
	sql: "sql",
	bash: "bash",
	sh: "bash",
	shell: "shellscript",
	shellscript: "shellscript",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	xml: "xml",
	markdown: "markdown",
	md: "markdown",
	lua: "lua",
	perl: "perl",
	pl: "perl",
	r: "r",
	scala: "scala",
	haskell: "haskell",
	hs: "haskell",
	elixir: "elixir",
	ex: "elixir",
	clojure: "clojure",
	objectivec: "objectivec",
	"objective-c": "objectivec",
	objc: "objectivec",
	groovy: "groovy",
	powershell: "powershell",
	ps1: "powershell",
	vbscript: "vbscript",
	assembly: "assembly",
	asm: "assembly",
	matlab: "matlab",
	julia: "julia",
	cobol: "cobol",
	fortran: "fortran",
};

const BUILTIN_SNIPPETS = {
	html: [
		{
			prefix: "html5",
			body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\t<title>${1:Document}</title>\n</head>\n<body>\n\t$0\n</body>\n</html>',
			description: "HTML5 base",
		},
	],
	css: [
		{
			prefix: "flexc",
			body: "display: flex;\njustify-content: ${1:center};\nalign-items: ${2:center};\n$0",
			description: "Flex center",
		},
	],
	javascript: [
		{
			prefix: "fn",
			body: "function ${1:name}(${2:params}) {\n\t$0\n}",
			description: "Function",
		},
	],
	typescript: [
		{
			prefix: "iface",
			body: "interface ${1:Name} {\n\t${2:key}: ${3:string};\n}\n$0",
			description: "Interface",
		},
	],
	python: [
		{
			prefix: "def",
			body: "def ${1:function_name}(${2:args}):\n\t$0",
			description: "Function",
		},
	],
	java: [
		{
			prefix: "main",
			body: "public static void main(String[] args) {\n\t$0\n}",
			description: "Main method",
		},
	],
	c: [
		{
			prefix: "main",
			body: "int main(void) {\n\t$0\n\treturn 0;\n}",
			description: "Main function",
		},
	],
	cpp: [
		{
			prefix: "main",
			body: "int main() {\n\t$0\n\treturn 0;\n}",
			description: "Main function",
		},
	],
	csharp: [
		{
			prefix: "prop",
			body: "public ${1:string} ${2:Name} { get; set; }$0",
			description: "Auto property",
		},
	],
	php: [
		{
			prefix: "fn",
			body: "function ${1:name}(${2:$args}) {\n\t$0\n}",
			description: "Function",
		},
	],
	ruby: [
		{
			prefix: "def",
			body: "def ${1:method_name}(${2:args})\n\t$0\nend",
			description: "Method",
		},
	],
	go: [
		{
			prefix: "fn",
			body: "func ${1:name}(${2:args}) ${3:error} {\n\t$0\n}",
			description: "Function",
		},
	],
	kotlin: [
		{
			prefix: "fun",
			body: "fun ${1:name}(${2:args}) {\n\t$0\n}",
			description: "Function",
		},
	],
	swift: [
		{
			prefix: "func",
			body: "func ${1:name}(${2:params}) {\n\t$0\n}",
			description: "Function",
		},
	],
	dart: [
		{
			prefix: "main",
			body: "void main() {\n\t$0\n}",
			description: "Main function",
		},
	],
	rust: [
		{
			prefix: "fn",
			body: "fn ${1:name}(${2:args}) {\n\t$0\n}",
			description: "Function",
		},
	],
	sql: [
		{
			prefix: "sel",
			body: "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};\n$0",
			description: "Select query",
		},
	],
	bash: [
		{
			prefix: "if",
			body: "if [ ${1:condition} ]; then\n\t$0\nfi",
			description: "If block",
		},
	],
	json: [
		{
			prefix: "obj",
			body: '{\n\t"${1:key}": "${2:value}"\n}$0',
			description: "JSON object",
		},
	],
	yaml: [
		{
			prefix: "kv",
			body: "${1:key}: ${2:value}\n$0",
			description: "Key value",
		},
	],
	xml: [
		{
			prefix: "tag",
			body: "<${1:tag}>${0}</${1:tag}>",
			description: "XML tag",
		},
	],
	markdown: [
		{
			prefix: "link",
			body: "[${1:text}](${2:url})$0",
			description: "Markdown link",
		},
	],
	lua: [
		{
			prefix: "fn",
			body: "function ${1:name}(${2:args})\n\t$0\nend",
			description: "Function",
		},
	],
	perl: [
		{
			prefix: "sub",
			body: "sub ${1:name} {\n\tmy (${2:@args}) = @_;\n\t$0\n}",
			description: "Subroutine",
		},
	],
	r: [
		{
			prefix: "fn",
			body: "${1:name} <- function(${2:args}) {\n\t$0\n}",
			description: "Function",
		},
	],
	scala: [
		{
			prefix: "def",
			body: "def ${1:name}(${2:args}): ${3:Unit} = {\n\t$0\n}",
			description: "Method",
		},
	],
	haskell: [
		{
			prefix: "fn",
			body: "${1:name} :: ${2:a -> b}\n${1:name} ${3:x} = $0",
			description: "Function",
		},
	],
	elixir: [
		{
			prefix: "def",
			body: "def ${1:name}(${2:args}) do\n\t$0\nend",
			description: "Function",
		},
	],
	clojure: [
		{
			prefix: "defn",
			body: "(defn ${1:name} [${2:args}]\n\t$0)",
			description: "Function",
		},
	],
	objectivec: [
		{
			prefix: "meth",
			body: "- (${1:void})${2:methodName} {\n\t$0\n}",
			description: "Method",
		},
	],
	groovy: [
		{
			prefix: "def",
			body: "def ${1:name}(${2:args}) {\n\t$0\n}",
			description: "Method",
		},
	],
	powershell: [
		{
			prefix: "fn",
			body: "function ${1:Name} {\n\tparam(${2:$value})\n\t$0\n}",
			description: "Function",
		},
	],
	shellscript: [
		{
			prefix: "main",
			body: 'main() {\n\t$0\n}\n\nmain "$@"',
			description: "Main wrapper",
		},
	],
	vbscript: [
		{
			prefix: "sub",
			body: "Sub ${1:Name}()\n\t$0\nEnd Sub",
			description: "Subroutine",
		},
	],
	assembly: [
		{
			prefix: "proc",
			body: "${1:label}:\n\t$0\n\tret",
			description: "Procedure",
		},
	],
	matlab: [
		{
			prefix: "fn",
			body: "function ${1:out} = ${2:name}(${3:in})\n\t$0\nend",
			description: "Function",
		},
	],
	julia: [
		{
			prefix: "fn",
			body: "function ${1:name}(${2:args})\n\t$0\nend",
			description: "Function",
		},
	],
	cobol: [
		{
			prefix: "prog",
			body: "IDENTIFICATION DIVISION.\nPROGRAM-ID. ${1:HELLO}.\nPROCEDURE DIVISION.\n\t$0\n\tSTOP RUN.",
			description: "Program skeleton",
		},
	],
	fortran: [
		{
			prefix: "prog",
			body: "program ${1:main}\n\timplicit none\n\t$0\nend program ${1:main}",
			description: "Program skeleton",
		},
	],
};

function normalizeSnippetLanguage(languageId) {
	if (!languageId) return "plaintext";
	return (
		LANGUAGE_ALIASES[String(languageId).toLowerCase()] ||
		String(languageId).toLowerCase()
	);
}

function normalizeSnippetsArray(value) {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => ({
			prefix: String(item?.prefix || "").trim(),
			body: String(item?.body || ""),
			description: String(item?.description || ""),
		}))
		.filter((item) => item.prefix && item.body);
}

export function getSnippetSettings() {
	const current = appSettings.value?.snippets;
	if (!current || typeof current !== "object") {
		return { enabled: true, user: {} };
	}
	return {
		enabled: current.enabled !== false,
		user: current.user && typeof current.user === "object" ? current.user : {},
	};
}

export function getSupportedSnippetLanguages() {
	return [...SUPPORTED_LANGUAGES];
}

export function getSnippetsForLanguage(languageId) {
	const normalized = normalizeSnippetLanguage(languageId);
	const builtin = normalizeSnippetsArray(BUILTIN_SNIPPETS[normalized]);
	const { user } = getSnippetSettings();
	const custom = normalizeSnippetsArray(user[normalized]);
	return [...builtin, ...custom];
}

export function getUserSnippetsForLanguage(languageId) {
	const normalized = normalizeSnippetLanguage(languageId);
	const { user } = getSnippetSettings();
	return normalizeSnippetsArray(user[normalized]);
}

export function setUserSnippetsForLanguage(languageId, snippets) {
	const normalized = normalizeSnippetLanguage(languageId);
	const settings = getSnippetSettings();
	appSettings.update({
		snippets: {
			...settings,
			user: {
				...settings.user,
				[normalized]: normalizeSnippetsArray(snippets),
			},
		},
	});
}

export function setSnippetSystemEnabled(enabled) {
	const settings = getSnippetSettings();
	appSettings.update({
		snippets: {
			...settings,
			enabled: !!enabled,
		},
	});
}

export function exportUserSnippetsAsJson() {
	const settings = getSnippetSettings();
	return JSON.stringify(
		{
			version: 1,
			languages: settings.user,
		},
		null,
		2,
	);
}

export function importUserSnippetsFromJson(jsonString) {
	const parsed = JSON.parse(jsonString);
	const languages = parsed?.languages;
	if (!languages || typeof languages !== "object") {
		throw new Error("Invalid snippets JSON. Expected: { languages: { ... } }");
	}
	const normalized = {};
	for (const [lang, snippets] of Object.entries(languages)) {
		const key = normalizeSnippetLanguage(lang);
		normalized[key] = normalizeSnippetsArray(snippets);
	}
	const settings = getSnippetSettings();
	appSettings.update({
		snippets: {
			...settings,
			user: normalized,
		},
	});
}

function getApplicableSnippets(languageId) {
	const settings = getSnippetSettings();
	if (!settings.enabled) return [];
	return getSnippetsForLanguage(languageId);
}

export function createSnippetCompletionSource(languageId) {
	return (context) => {
		const snippets = getApplicableSnippets(languageId);
		if (!snippets.length) return null;
		const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_-]*/);
		if (!context.explicit && !word) return null;
		const from = word ? word.from : context.pos;
		const typed = word ? word.text.toLowerCase() : "";
		const options = snippets
			.filter((item) => !typed || item.prefix.toLowerCase().startsWith(typed))
			.map((item) =>
				snippetCompletion(item.body, {
					label: item.prefix,
					detail: item.description || "Snippet",
					type: "keyword",
				}),
			);
		if (!options.length) return null;
		return {
			from,
			options,
			validFor: /[A-Za-z0-9_-]*/,
		};
	};
}

export function expandSnippetShortcut(view, languageId) {
	const snippets = getApplicableSnippets(languageId);
	if (!snippets.length) return false;
	const { from, to, empty } = view.state.selection.main;
	if (!empty || from !== to) return false;
	const pos = from;
	const line = view.state.doc.lineAt(pos);
	const leftText = line.text.slice(0, pos - line.from);
	const match = leftText.match(/([A-Za-z_][A-Za-z0-9_-]*)$/);
	if (!match) return false;
	const token = match[1];
	const snippetDef = snippets.find((item) => item.prefix === token);
	if (!snippetDef) return false;
	const applySnippet = snippet(snippetDef.body);
	applySnippet(view, null, pos - token.length, pos);
	return true;
}
