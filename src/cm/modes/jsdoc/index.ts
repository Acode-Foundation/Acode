import { foldNodeProp, indentNodeProp } from "@codemirror/language";
import {
	type Input,
	NodeSet,
	NodeType,
	Parser,
	type ParseWrapper,
	type PartialParse,
	parseMixed,
	Tree,
	type TreeFragment,
} from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";

/**
 * A tiny JSDoc tokenizer mounted inside JS/TS `/** ... *\/` comments so
 * themes can style block tags, types, parameter names and inline links
 * separately from the comment text. Braces and other punctuation are left
 * as comment text, like VS Code does.
 *
 * The mounted tree replaces the host `BlockComment` node, so its root keeps
 * that name (comment checks in completion and rainbow brackets still match)
 * and the fold/indent behaviour JS gives block comments. It is not a top
 * node, so language data (comment tokens, completions) still resolves to the
 * surrounding JS/TS.
 */

enum Type {
	BlockComment,
	JSDocTag,
	JSDocType,
	JSDocParam,
	JSDocLink,
}

const nodeSet = new NodeSet(
	["BlockComment", "JSDocTag", "JSDocType", "JSDocParam", "JSDocLink"].map(
		(name, id) => NodeType.define({ id, name }),
	),
).extend(
	styleTags({
		BlockComment: t.docComment,
		JSDocTag: t.keyword,
		JSDocType: t.typeName,
		JSDocParam: t.variableName,
		JSDocLink: t.link,
	}),
	foldNodeProp.add({
		BlockComment: (tree) => ({ from: tree.from + 2, to: tree.to - 2 }),
	}),
	indentNodeProp.add({ BlockComment: () => null }),
);

// Tags followed by a parameter/property name, e.g. `@param {T} name`.
const PARAM_TAGS = new Set(["param", "arg", "argument", "property", "prop"]);
// Tags followed by a type name, e.g. `@typedef {Object} Name`.
const TYPE_NAME_TAGS = new Set(["typedef", "callback", "template"]);

const IDENTIFIER = /[A-Za-z_$][\w$]*(?:(?:\[\])?\.[\w$]+)*/y;
const TAG_NAME = /@[A-Za-z][\w-]*/y;
const LINK_TARGET = /[^\s|}]+/y;

function matchAt(re: RegExp, text: string, pos: number): string | null {
	re.lastIndex = pos;
	const match = re.exec(text);
	return match ? match[0] : null;
}

function isSpace(ch: string | undefined): boolean {
	return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/**
 * Index just past the string literal opening at `pos`, honouring backslash
 * escapes, or -1 when it isn't closed on the same line before `limit`.
 */
function skipQuoted(text: string, pos: number, limit: number): number {
	const quote = text[pos];
	for (let i = pos + 1; i < limit; i++) {
		const ch = text[i];
		if (ch === "\\") i++;
		else if (ch === quote) return i + 1;
		else if (ch === "\n") return -1;
	}
	return -1;
}

function tokenize(text: string): number[] {
	// Flat [type, from, to, size] groups, as expected by Tree.build.
	const buffer: number[] = [];
	const push = (type: Type, from: number, to: number) => {
		if (to > from) buffer.push(type, from, to, 4);
	};

	const end = text.endsWith("*/") ? text.length - 2 : text.length;
	let pos = 3; // skip "/**"
	let lineStart = false;
	let typeAllowed = false;
	let pending: "param" | "typeName" | null = null;
	// First `}`, newline or end at or after the last `{@` scan. Every `{@`
	// before it stops at the same place, so it is reused to keep scanning
	// linear when there are many unclosed inline tags.
	let inlineStop = -1;

	while (pos < end) {
		const ch = text[pos];

		if (ch === "\n") {
			lineStart = true;
			typeAllowed = false;
			pending = null;
			pos++;
			continue;
		}
		if (isSpace(ch)) {
			pos++;
			continue;
		}
		if (lineStart && ch === "*") {
			pos++;
			continue;
		}
		lineStart = false;

		const prev = text[pos - 1];
		if (ch === "@" && (isSpace(prev) || prev === "*")) {
			const tag = matchAt(TAG_NAME, text, pos);
			if (tag) {
				const name = tag.slice(1);
				push(Type.JSDocTag, pos, pos + tag.length);
				pos += tag.length;
				typeAllowed = true;
				pending = PARAM_TAGS.has(name)
					? "param"
					: TYPE_NAME_TAGS.has(name)
						? "typeName"
						: null;
				continue;
			}
		}

		if (ch === "{" && text[pos + 1] === "@") {
			if (inlineStop <= pos) {
				inlineStop = pos + 1;
				while (
					inlineStop < end &&
					text[inlineStop] !== "}" &&
					text[inlineStop] !== "\n"
				) {
					inlineStop++;
				}
			}
			pos =
				text[inlineStop] === "}" && inlineStop < end
					? inlineTag(text, pos, inlineStop, push)
					: pos + 1;
			typeAllowed = false;
			pending = null;
			continue;
		}

		if (ch === "{" && typeAllowed) {
			pos = typeExpression(text, pos, end, push);
			typeAllowed = false;
			continue;
		}
		typeAllowed = false;

		if (pending === "param" && ch === "[") {
			pos = optionalParam(text, pos, end, push);
			pending = null;
			continue;
		}

		if (pending) {
			const name = matchAt(IDENTIFIER, text, pos);
			if (name) {
				push(
					pending === "param" ? Type.JSDocParam : Type.JSDocType,
					pos,
					pos + name.length,
				);
				pos += name.length;
				pending = null;
				continue;
			}
		}
		pending = null;

		// Plain description text: covered by the JSDoc root node.
		pos++;
		while (pos < end && !isSpace(text[pos]) && text[pos] !== "{") pos++;
	}

	return buffer;
}

type Push = (type: Type, from: number, to: number) => void;

/** `{@link Target|label}` and friends; `close` is the matching `}`. */
function inlineTag(text: string, pos: number, close: number, push: Push) {
	let i = pos + 1;
	const tag = matchAt(TAG_NAME, text, i);
	if (tag) {
		push(Type.JSDocTag, i, i + tag.length);
		i += tag.length;
		while (i < close && isSpace(text[i])) i++;
		const target = matchAt(LINK_TARGET, text, i);
		if (target && i + target.length <= close) {
			push(Type.JSDocLink, i, i + target.length);
		}
	}
	return close + 1;
}

// Longest type expression scanned before giving up on a missing `}`.
const MAX_TYPE_LENGTH = 500;

/**
 * `{Array<string> | null}`, possibly spanning lines. Tokens are only kept
 * when the closing brace is found, so a stray `{` doesn't colour the rest
 * of the comment as a type.
 */
function typeExpression(text: string, pos: number, end: number, push: Push) {
	const tokens: [Type, number, number][] = [];
	const limit = Math.min(end, pos + MAX_TYPE_LENGTH);
	let depth = 1;
	let i = pos + 1;

	while (i < limit) {
		const ch = text[i];
		if (isSpace(ch) || ch === "*") {
			i++;
			continue;
		}
		// Types never contain `@`; it starts the next tag, so `{` was unclosed.
		if (ch === "@") break;
		if (ch === "{") depth++;
		if (ch === "}" && --depth === 0) {
			for (const [type, from, to] of tokens) push(type, from, to);
			return i + 1;
		}
		const name = matchAt(IDENTIFIER, text, i);
		if (name) {
			tokens.push([Type.JSDocType, i, i + name.length]);
			i += name.length;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const close = skipQuoted(text, i, limit);
			if (close === -1) break;
			tokens.push([Type.JSDocType, i, close]);
			i = close;
			continue;
		}
		i++;
	}
	return pos + 1;
}

/** `[name=default]` after `@param`. */
function optionalParam(text: string, pos: number, end: number, push: Push) {
	let i = pos + 1;
	const name = matchAt(IDENTIFIER, text, i);
	if (name) {
		push(Type.JSDocParam, i, i + name.length);
		i += name.length;
	}

	// Find the closing `]`, ignoring brackets inside quoted defaults.
	let depth = 1;
	while (i < end && text[i] !== "\n") {
		const ch = text[i];
		if (ch === '"' || ch === "'") {
			const close = skipQuoted(text, i, end);
			if (close === -1) return i;
			i = close;
			continue;
		}
		if (ch === "[") depth++;
		if (ch === "]" && --depth === 0) return i + 1;
		i++;
	}
	return i;
}

// Comments are short, so the whole range is tokenized in one step.
class JSDocParse implements PartialParse {
	parsedPos: number;
	stoppedAt: number | null = null;

	constructor(
		private input: Input,
		private from: number,
		private to: number,
	) {
		this.parsedPos = from;
	}

	advance(): Tree {
		const { from, to } = this;
		const buffer = tokenize(this.input.read(from, to)).map((value, index) =>
			index % 4 === 1 || index % 4 === 2 ? value + from : value,
		);
		this.parsedPos = to;
		return Tree.build({
			buffer,
			nodeSet,
			topID: Type.BlockComment,
			start: from,
			length: to - from,
		});
	}

	stopAt(pos: number) {
		this.stoppedAt = pos;
	}
}

class JSDocParser extends Parser {
	createParse(
		input: Input,
		_fragments: readonly TreeFragment[],
		ranges: readonly { from: number; to: number }[],
	): PartialParse {
		return new JSDocParse(input, ranges[0].from, ranges[ranges.length - 1].to);
	}
}

export const jsdocParser = new JSDocParser();

const MAX_COMMENT_LENGTH = 100_000;

/** Mounts the JSDoc parser on `/** ... *\/` block comments. */
export const jsdocWrap: ParseWrapper = parseMixed((node, input) => {
	if (node.name !== "BlockComment") return null;
	// Every edit re-tokenizes the whole comment; leave huge ones plain.
	if (node.to - node.from > MAX_COMMENT_LENGTH) return null;
	// Like TypeScript, only `/**` not followed by `*` or `/` is JSDoc.
	const head = input.read(node.from, Math.min(node.from + 4, node.to));
	if (!head.startsWith("/**") || head[3] === "*" || head[3] === "/") {
		return null;
	}
	return { parser: jsdocParser };
});
