import { ExternalTokenizer } from "@lezer/lr";
import {
	ExpressionClose,
	ExpressionContent,
	ExpressionOpen,
	FrontmatterClose,
	FrontmatterContent,
	FrontmatterOpen,
	HtmlContent,
} from "./parser.terms";

type Input = {
	next: number;
	pos: number;
	peek(offset: number): number;
	acceptTokenTo(token: number, endPos: number): void;
};

const bom = 0xfeff;
const eof = -1;
const newline = 10;
const carriageReturn = 13;
const space = 32;
const tab = 9;
const lessThan = 60;
const greaterThan = 62;
const slash = 47;
const singleQuote = 39;
const doubleQuote = 34;
const backtick = 96;
const backslash = 92;
const openBrace = 123;
const closeBrace = 125;
const dash = 45;
const asterisk = 42;

interface TagEnd {
	end: number;
	selfClosing: boolean;
}

function lower(code: number): number {
	return code >= 65 && code <= 90 ? code + 32 : code;
}

function isWhitespace(code: number): boolean {
	return code === space || code === tab || code === carriageReturn;
}

function isNameBoundary(code: number): boolean {
	return (
		code === eof ||
		code === space ||
		code === tab ||
		code === newline ||
		code === carriageReturn ||
		code === slash ||
		code === greaterThan
	);
}

function atLineStart(input: Input): boolean {
	const pos = input.pos;
	if (pos === 0) return true;
	if (pos === 1 && input.peek(-1) === bom) return true;
	return input.peek(-1) === newline;
}

function lineHasOnlyFrontmatterFence(
	input: Input,
	offset = 0,
): boolean {
	if (
		input.peek(offset) !== dash ||
		input.peek(offset + 1) !== dash ||
		input.peek(offset + 2) !== dash
	) {
		return false;
	}

	for (let i = offset + 3; ; i++) {
		const next = input.peek(i);
		if (next === eof || next === newline) return true;
		if (!isWhitespace(next)) return false;
	}
}

function lineEndPosition(input: Input, offset = 0): number {
	for (let i = offset; ; i++) {
		const next = input.peek(i);
		if (next === eof) return input.pos + i;
		if (next === newline) return input.pos + i + 1;
	}
}

function startsWithTagName(
	input: Input,
	offset: number,
	name: string,
): boolean {
	if (input.peek(offset) !== lessThan || input.peek(offset + 1) === slash) {
		return false;
	}

	for (let i = 0; i < name.length; i++) {
		if (lower(input.peek(offset + 1 + i)) !== name.charCodeAt(i)) {
			return false;
		}
	}

	return isNameBoundary(input.peek(offset + 1 + name.length));
}

function tagEnd(
	input: Input,
	offset: number,
): TagEnd {
	let quote = 0;
	let lastNonWhitespace = 0;

	for (let i = offset; ; i++) {
		const next = input.peek(i);
		if (next === eof) return { end: i, selfClosing: false };

		if (quote) {
			if (next === quote) quote = 0;
			continue;
		}

		if (next === singleQuote || next === doubleQuote) {
			quote = next;
			continue;
		}

		if (next === greaterThan) {
			return { end: i + 1, selfClosing: lastNonWhitespace === slash };
		}

		if (!isWhitespace(next)) lastNonWhitespace = next;
	}
}

function tagEndOffset(input: Input, offset: number): number {
	return tagEnd(input, offset).end;
}

function closeTagEndOffset(
	input: Input,
	offset: number,
	name: string,
): number {
	const nameLength = name.length;

	for (let i = offset; ; i++) {
		const next = input.peek(i);
		if (next === eof) return i;
		if (next !== lessThan || input.peek(i + 1) !== slash) continue;

		let matched = true;
		for (let j = 0; j < nameLength; j++) {
			if (lower(input.peek(i + 2 + j)) !== name.charCodeAt(j)) {
				matched = false;
				break;
			}
		}

		if (!matched || !isNameBoundary(input.peek(i + 2 + nameLength))) continue;

		return tagEndOffset(input, i);
	}
}

function rawTextElementEndOffset(
	input: Input,
	offset: number,
): number | null {
	if (startsWithTagName(input, offset, "script")) {
		const openTag = tagEnd(input, offset);
		if (openTag.selfClosing) return openTag.end;
		return closeTagEndOffset(input, openTag.end, "script");
	}

	if (startsWithTagName(input, offset, "style")) {
		const openTag = tagEnd(input, offset);
		if (openTag.selfClosing) return openTag.end;
		return closeTagEndOffset(input, openTag.end, "style");
	}

	return null;
}

function expressionEndOffset(
	input: Input,
	offset: number,
): number {
	let depth = 0;
	let quote = 0;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;
	const templateExpressionDepths: number[] = [];

	for (let i = offset; ; i++) {
		const char = input.peek(i);
		const next = input.peek(i + 1);

		if (char === eof) return -1;

		if (lineComment) {
			if (char === newline) lineComment = false;
			continue;
		}

		if (blockComment) {
			if (char === asterisk && next === slash) {
				blockComment = false;
				i++;
			}
			continue;
		}

		if (quote) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === backslash) {
				escaped = true;
				continue;
			}
			if (char === quote) {
				quote = 0;
				continue;
			}
			if (quote === backtick && char === 36 && next === openBrace) {
				depth++;
				templateExpressionDepths.push(depth);
				quote = 0;
				i++;
			}
			continue;
		}

		if (char === slash && next === slash) {
			lineComment = true;
			i++;
			continue;
		}

		if (char === slash && next === asterisk) {
			blockComment = true;
			i++;
			continue;
		}

		if (char === singleQuote || char === doubleQuote || char === backtick) {
			quote = char;
			continue;
		}

		if (char === openBrace) {
			depth++;
			continue;
		}

		if (char === closeBrace) {
			const templateExpressionDepth =
				templateExpressionDepths[templateExpressionDepths.length - 1];
			if (templateExpressionDepth === depth) {
				depth--;
				templateExpressionDepths.pop();
				quote = backtick;
				continue;
			}

			depth--;
			if (depth === 0) return i;
		}
	}
}

function htmlContentEndOffset(
	input: Input,
): number {
	for (let offset = 0; ; offset++) {
		const next = input.peek(offset);
		if (next === eof) return offset;

		if (next === lessThan) {
			const rawTextEnd = rawTextElementEndOffset(input, offset);
			if (rawTextEnd !== null) {
				offset = rawTextEnd - 1;
				continue;
			}
		}

		if (next === openBrace && expressionEndOffset(input, offset) > -1) {
			return offset;
		}
	}
}

function frontmatterContentEndOffset(
	input: Input,
): number {
	for (let offset = 0; ; offset++) {
		const next = input.peek(offset);
		if (next === eof) return offset;

		if (
			(offset === 0 || input.peek(offset - 1) === newline) &&
			lineHasOnlyFrontmatterFence(input, offset)
		) {
			return offset;
		}
	}
}

export const astroTokens = new ExternalTokenizer(
	(input, stack) => {
		const startOffset = input.next === bom ? 1 : 0;

		if (
			stack.canShift(FrontmatterOpen) &&
			(input.pos === 0 || (input.pos === 1 && input.peek(-1) === bom)) &&
			lineHasOnlyFrontmatterFence(input, startOffset)
		) {
			input.acceptTokenTo(FrontmatterOpen, lineEndPosition(input));
			return;
		}

		if (
			stack.canShift(FrontmatterClose) &&
			atLineStart(input) &&
			lineHasOnlyFrontmatterFence(input)
		) {
			input.acceptTokenTo(FrontmatterClose, lineEndPosition(input));
			return;
		}

		if (stack.canShift(FrontmatterContent)) {
			const endOffset = frontmatterContentEndOffset(input);
			if (endOffset > 0) {
				input.acceptTokenTo(FrontmatterContent, input.pos + endOffset);
				return;
			}
		}

		if (stack.canShift(ExpressionOpen) && input.next === openBrace) {
			input.acceptTokenTo(ExpressionOpen, input.pos + 1);
			return;
		}

		if (stack.canShift(ExpressionClose) && input.next === closeBrace) {
			input.acceptTokenTo(ExpressionClose, input.pos + 1);
			return;
		}

		if (stack.canShift(ExpressionContent)) {
			const endOffset = expressionEndOffset(input, -1);
			if (endOffset > 0) {
				input.acceptTokenTo(ExpressionContent, input.pos + endOffset);
				return;
			}
		}

		if (stack.canShift(HtmlContent)) {
			const endOffset = htmlContentEndOffset(input);
			if (endOffset > 0) {
				input.acceptTokenTo(HtmlContent, input.pos + endOffset);
			}
		}
	},
	{ contextual: true },
);
