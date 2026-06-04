import { syntaxTree } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import type { ChangeSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const skipTagAutoRename = Annotation.define<boolean>();
const tagNamePattern = /^[^\s<>/="'`]+$/;

interface RenameTarget {
	tagName: SyntaxNode;
	pairedTagName: SyntaxNode;
}

interface ChangedRange {
	fromA: number;
	toA: number;
}

function getTagNameNode(state: EditorState, from: number, to: number): SyntaxNode | null {
	const tree = syntaxTree(state);
	const positions = from === to ? [from, from - 1] : [from, to, to - 1];

	for (const pos of positions) {
		if (pos < 0 || pos > state.doc.length) continue;

		for (const assoc of [-1, 1] as const) {
			let node: SyntaxNode | null = tree.resolveInner(pos, assoc);
			for (; node; node = node.parent) {
				if (node.name === "TagName") return node;
				if (
					node.name === "OpenTag" ||
					node.name === "CloseTag" ||
					node.name === "SelfClosingTag" ||
					node.name === "Element" ||
					node.type.isTop
				) {
					break;
				}
			}
		}
	}

	return null;
}

function readNode(doc: Text, node: SyntaxNode): string {
	return doc.sliceString(node.from, node.to);
}

function getRenameTarget(
	state: EditorState,
	from: number,
	to: number,
): RenameTarget | null {
	const tagName = getTagNameNode(state, from, to);
	const tag = tagName?.parent;
	const element = tag?.parent;

	if (
		!tagName ||
		!tag ||
		!element ||
		element.name !== "Element" ||
		(tag.name !== "OpenTag" && tag.name !== "CloseTag")
	) {
		return null;
	}

	const openTag = element.firstChild;
	const closeTag = element.lastChild;
	if (openTag?.name !== "OpenTag" || closeTag?.name !== "CloseTag") {
		return null;
	}

	const openName = openTag.getChild("TagName");
	const closeName = closeTag.getChild("TagName");
	if (!openName || !closeName) return null;

	const oldOpenName = readNode(state.doc, openName);
	const oldCloseName = readNode(state.doc, closeName);
	if (oldOpenName !== oldCloseName) return null;

	return {
		tagName,
		pairedTagName: tag.name === "OpenTag" ? closeName : openName,
	};
}

function getChangedRanges(transaction: Transaction): ChangedRange[] {
	const ranges: ChangedRange[] = [];
	transaction.changes.iterChanges((fromA, toA) => {
		ranges.push({ fromA, toA });
	});
	return ranges;
}

function touchesRange(change: ChangedRange, from: number, to: number): boolean {
	if (change.fromA === change.toA) {
		return change.fromA >= from && change.fromA <= to;
	}
	return change.fromA < to && change.toA > from;
}

function mapEditedRange(transaction: Transaction, from: number, to: number) {
	return {
		from: transaction.changes.mapPos(from, -1),
		to: transaction.changes.mapPos(to, 1),
	};
}

function createPairedRename(transaction: Transaction): ChangeSpec | null {
	if (
		!transaction.docChanged ||
		transaction.annotation(skipTagAutoRename) ||
		transaction.annotation(Transaction.remote)
	) {
		return null;
	}

	const ranges = getChangedRanges(transaction);
	if (ranges.length !== 1) return null;

	const [change] = ranges;
	const target = getRenameTarget(
		transaction.startState,
		change.fromA,
		change.toA,
	);
	if (!target || !touchesRange(change, target.tagName.from, target.tagName.to)) {
		return null;
	}
	if (
		touchesRange(
			change,
			target.pairedTagName.from,
			target.pairedTagName.to,
		)
	) {
		return null;
	}

	const editedRange = mapEditedRange(
		transaction,
		target.tagName.from,
		target.tagName.to,
	);
	const newName = transaction.newDoc.sliceString(
		editedRange.from,
		editedRange.to,
	);
	if (newName && !tagNamePattern.test(newName)) return null;

	return {
		from: target.pairedTagName.from,
		to: target.pairedTagName.to,
		insert: newName,
	};
}

export default function tagAutoRename(): Extension {
	return EditorState.transactionFilter.of((transaction) => {
		const pairedRename = createPairedRename(transaction);
		if (!pairedRename) return transaction;

		return [
			transaction,
			{
				changes: pairedRename,
				annotations: [
					skipTagAutoRename.of(true),
					Transaction.userEvent.of("input.tag-rename"),
				],
			},
		];
	});
}
