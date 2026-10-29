import {
	ensureSyntaxTree,
	foldable,
	getIndentation,
	highlightingFor,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { highlightTree, type Tag, tags as t } from "@lezer/highlight";
import { memberProperty } from "cm/highlightTags";
import { javascriptSupport } from "cm/modes/javascript";
import { getThemeExtensions, getThemes } from "cm/themes";
import { describe, expect, it } from "vitest";

type Config = { jsx?: boolean; typescript?: boolean };

function createState(doc: string, config: Config = {}) {
	return EditorState.create({ doc, extensions: javascriptSupport(config) });
}

/** Highlighted ranges as `[tags, text, from]`, skipping whitespace. */
function highlights(state: EditorState) {
	const doc = state.doc.toString();
	const tree = ensureSyntaxTree(state, doc.length, 5000);
	if (!tree) throw new Error("parse did not finish");
	const out: [string, string, number][] = [];
	highlightTree(
		tree,
		{ style: (tags) => tags.map(String).join(" ") },
		(from, to, tags) => {
			const text = doc.slice(from, to);
			if (text.trim()) out.push([tags, text, from]);
		},
	);
	return out;
}

/** Texts highlighted with exactly `tags`. */
function textsWith(state: EditorState, tags: string) {
	return highlights(state)
		.filter(([style]) => style === tags)
		.map(([, text]) => text);
}

const jsdoc = `const before = 1;
/**
 * Adds numbers, mail me@example.com.
 * @param {number} a - first
 * @param {Array<{
 *   id: string
 * }> | null} list - multiline type
 * @param {string} [text="["] quoted bracket, see {@link Foo.bar|bar}
 * @param {'don\\'t' | "a\\"b"} quoted escaped quotes
 * @returns {Promise<void>}
 * @typedef {Object} Shape
 * @template T
 */
function add(a, list, text, quoted) {}`;

describe.each([
	["JavaScript", { jsx: true }],
	["TypeScript", { typescript: true }],
])("JSDoc highlighting in %s", (_name, config) => {
	const state = createState(jsdoc, config);

	it("highlights block tags, types, parameter names and links", () => {
		expect(textsWith(state, "keyword")).toEqual([
			"@param",
			"@param",
			"@param",
			"@link",
			"@param",
			"@returns",
			"@typedef",
			"@template",
		]);
		expect(textsWith(state, "typeName")).toEqual([
			"number",
			"Array",
			"id",
			"string",
			"null",
			"string",
			"'don\\'t'",
			'"a\\"b"',
			"Promise",
			"void",
			"Object",
			"Shape",
			"T",
		]);
		expect(textsWith(state, "variableName")).toEqual([
			"a",
			"list",
			"text",
			"quoted",
		]);
		expect(textsWith(state, "link")).toEqual(["Foo.bar"]);
	});

	it("places ranges at the right document positions", () => {
		const doc = state.doc.toString();
		for (const [, text, from] of highlights(state)) {
			expect(doc.slice(from, from + text.length)).toBe(text);
		}
		const param = highlights(state).find(([, text]) => text === "@param");
		expect(param?.[2]).toBe(doc.indexOf("@param"));
	});

	it("leaves braces, punctuation and prose as doc comment text", () => {
		const docText = textsWith(state, "docComment").join(" ");
		expect(docText).toContain("me@example.com");
		expect(docText).toContain("{");
		expect(docText).toContain("[");

		const doc = state.doc.toString();
		const commentEnd = doc.indexOf("*/") + 2;
		const inComment = highlights(state).filter(
			([, , from]) => from >= doc.indexOf("/**") && from < commentEnd,
		);
		const commentTags = new Set(inComment.map(([tags]) => tags));
		expect([...commentTags].sort()).toEqual([
			"docComment",
			"keyword",
			"link",
			"typeName",
			"variableName",
		]);
	});

	it("keeps comment behaviour from the host language", () => {
		const inside = state.doc.toString().indexOf("@returns");
		expect(state.languageDataAt("commentTokens", inside)).toEqual([
			{ line: "//", block: { open: "/*", close: "*/" } },
		]);
		expect(getIndentation(state, state.doc.line(4).from)).toBeNull();
		const line = state.doc.line(2);
		expect(foldable(state, line.from, line.to)).toEqual({
			from: line.from + 2,
			to: state.doc.toString().indexOf("*/", line.from),
		});
	});
});

describe("JSDoc highlighting edge cases", () => {
	it("leaves plain block comments alone", () => {
		const state = createState(
			"/* @param {T} a */ /**/ /*** @param {T} b */ let x;",
		);
		expect(textsWith(state, "keyword")).toEqual([]);
		expect(textsWith(state, "blockComment")).toEqual([
			"/* @param {T} a */",
			"/**/",
			"/*** @param {T} b */",
		]);
	});

	it("does not colour the rest of the comment after an unclosed type", () => {
		const state = createState("/** @returns { unclosed\n * prose words */");
		expect(textsWith(state, "keyword")).toEqual(["@returns"]);
		expect(textsWith(state, "typeName")).toEqual([]);
	});

	it("updates highlighting after an edit", () => {
		let state = createState("/**\n * @param {string} a\n */\nlet x;");
		expect(textsWith(state, "typeName")).toEqual(["string"]);

		const at = state.doc.toString().indexOf("string");
		state = state.update({
			changes: { from: at, to: at + "string".length, insert: "number" },
		}).state;
		expect(textsWith(state, "typeName")).toEqual(["number"]);

		state = state.update({
			changes: { from: 0, insert: "/** @see {@link Q} */\n" },
		}).state;
		expect(textsWith(state, "link")).toEqual(["Q"]);
		expect(textsWith(state, "typeName")).toEqual(["number"]);
	});
});

describe("method names", () => {
	const fnDefProp = "function(definition(propertyName))";

	it("tags class and interface methods as function definitions", () => {
		const state = createState(
			`class A {
	constructor(a) {}
	get size() { return 1 }
	static create() {}
	#secret() {}
	field = 1;
}
interface I { draw(): void; area: number }`,
			{ typescript: true },
		);
		expect(textsWith(state, fnDefProp)).toEqual([
			"constructor",
			"size",
			"create",
			"#secret",
			"draw",
		]);
		expect(textsWith(state, "definition(memberProperty)")).toEqual([
			"field",
			"area",
		]);
	});

	it("keeps method calls tagged as function properties", () => {
		const state = createState("options.uri.hashCode(); const { a: b } = o;");
		expect(textsWith(state, "function(propertyName)")).toEqual(["hashCode"]);
		expect(textsWith(state, "memberProperty")).toEqual(["uri", "a"]);
	});
});

describe("built-in theme function colours", () => {
	const functionTags = [
		t.function(t.propertyName),
		t.function(t.definition(t.propertyName)),
		t.function(t.definition(t.variableName)),
	];

	/** The CSS colour a theme gives `tag`. */
	function colorOf(state: EditorState, tag: Tag) {
		const classes = highlightingFor(state, [tag]);
		if (!classes) return null;
		const rules = state
			.facet(EditorView.styleModule)
			.map((module) => module.getRules())
			.join("\n");
		for (const cls of classes.split(" ")) {
			const rule = rules.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
			const color = rule?.[1].match(/(?:^|;)\s*color:\s*([^;]+)/);
			if (color) return color[1].trim();
		}
		return null;
	}

	it.each(
		getThemes().map((theme) => [theme.id]),
	)("%s colours methods like functions", (id) => {
		const state = EditorState.create({ extensions: getThemeExtensions(id) });
		const expected = colorOf(state, t.function(t.variableName));
		expect(expected).toBeTruthy();
		for (const tag of functionTags) {
			expect(colorOf(state, tag)).toBe(expected);
		}
	});

	it.each(
		getThemes().map((theme) => [theme.id]),
	)("%s colours JS properties differently from methods", (id) => {
		// VS Code's Solarized colours them alike too.
		if (id.startsWith("solarized")) return;
		const state = EditorState.create({ extensions: getThemeExtensions(id) });
		const method = colorOf(state, t.function(t.propertyName));
		expect(colorOf(state, memberProperty)).not.toBe(method);
		expect(colorOf(state, t.definition(memberProperty))).not.toBe(method);
	});
});
