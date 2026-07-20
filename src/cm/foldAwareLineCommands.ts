import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { foldEffect, foldedRanges } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  Text,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

interface FoldRange {
  from: number;
  to: number;
}

interface IndexedFold extends FoldRange {
  blockFrom: number;
  blockTo: number;
}

interface FoldGroup {
  blockFrom: number;
  blockTo: number;
  folds: IndexedFold[];
}

interface FoldIndex {
  groups: FoldGroup[];
}

interface LineBlock {
  from: number;
  to: number;
  rangeIndexes: number[];
}

interface MoveOperation {
  block: LineBlock;
  neighbor: LineBlock;
  replaceFrom: number;
  replaceTo: number;
  insert: Text;
  blockOffset: number;
  neighborOffset: number;
}

type Direction = -1 | 1;

const lineBreak = Text.of(["", ""]);

function getFoldIndex(state: EditorState): FoldIndex {
  const groups: FoldGroup[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    const fold: IndexedFold = {
      from,
      to,
      blockFrom: state.doc.lineAt(from).from,
      blockTo: state.doc.lineAt(to).to,
    };
    const previous = groups.at(-1);
    if (previous && fold.blockFrom <= previous.blockTo) {
      previous.blockTo = Math.max(previous.blockTo, fold.blockTo);
      previous.folds.push(fold);
    } else {
      groups.push({
        blockFrom: fold.blockFrom,
        blockTo: fold.blockTo,
        folds: [fold],
      });
    }
  });

  return { groups };
}

function firstGroupEndingAtOrAfter(groups: FoldGroup[], position: number) {
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (groups[middle].blockTo < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function expandBlockToFolds(
  block: Pick<LineBlock, "from" | "to">,
  index: FoldIndex,
): Pick<LineBlock, "from" | "to"> {
  let from = block.from;
  let to = block.to;
  const start = firstGroupEndingAtOrAfter(index.groups, from);

  for (let i = start; i < index.groups.length; i++) {
    const group = index.groups[i];
    if (group.blockFrom > to) break;
    from = Math.min(from, group.blockFrom);
    to = Math.max(to, group.blockTo);
  }

  return { from, to };
}

function selectionLineBlock(
  state: EditorState,
  range: SelectionRange,
  rangeIndex: number,
  index: FoldIndex,
): LineBlock {
  const startLine = state.doc.lineAt(range.from);
  let endLine = state.doc.lineAt(range.to);
  if (!range.empty && range.to === endLine.from) {
    endLine = state.doc.lineAt(range.to - 1);
  }
  const expanded = expandBlockToFolds(
    { from: startLine.from, to: endLine.to },
    index,
  );
  return { ...expanded, rangeIndexes: [rangeIndex] };
}

function selectedLineBlocks(state: EditorState, index: FoldIndex): LineBlock[] {
  const blocks = state.selection.ranges
    .map((range, rangeIndex) =>
      selectionLineBlock(state, range, rangeIndex, index),
    )
    .sort((a, b) => a.from - b.from);
  const merged: LineBlock[] = [];

  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous && block.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, block.to);
      previous.rangeIndexes.push(...block.rangeIndexes);
    } else {
      merged.push({ ...block, rangeIndexes: [...block.rangeIndexes] });
    }
  }

  return merged;
}

function foldsInBlock(index: FoldIndex, block: Pick<LineBlock, "from" | "to">) {
  const folds: IndexedFold[] = [];
  const start = firstGroupEndingAtOrAfter(index.groups, block.from);
  for (let i = start; i < index.groups.length; i++) {
    const group = index.groups[i];
    if (group.blockFrom > block.to) break;
    for (const fold of group.folds) {
      if (fold.from >= block.from && fold.to <= block.to) folds.push(fold);
    }
  }
  return folds;
}

function blockHasFolds(
  index: FoldIndex,
  block: Pick<LineBlock, "from" | "to">,
) {
  const start = firstGroupEndingAtOrAfter(index.groups, block.from);
  return (
    start < index.groups.length && index.groups[start].blockFrom <= block.to
  );
}

function uniqueFolds(folds: FoldRange[]) {
  const seen = new Set<string>();
  return folds.filter((fold) => {
    const key = `${fold.from}:${fold.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createFoldEffects(folds: FoldRange[], docLength: number) {
  const validFolds = uniqueFolds(folds).filter(
    (fold) => fold.from >= 0 && fold.to <= docLength && fold.to > fold.from,
  );
  return validFolds.map((fold) => foldEffect.of(fold));
}

function translatedFold(fold: FoldRange, oldFrom: number, newFrom: number) {
  return {
    from: newFrom + fold.from - oldFrom,
    to: newFrom + fold.to - oldFrom,
  };
}

function mapRangeIntoBlock(
  range: SelectionRange,
  block: LineBlock,
  newBlockFrom: number,
) {
  return EditorSelection.range(
    newBlockFrom + range.anchor - block.from,
    newBlockFrom + range.head - block.from,
  );
}

function copyFoldedLines(view: EditorView, direction: Direction): boolean {
  const initialState = view.state;
  if (initialState.readOnly) return false;
  const copyDown = direction > 0;
  const foldIndex = getFoldIndex(initialState);
  const blocks = selectedLineBlocks(initialState, foldIndex);
  if (!blocks.some((block) => blockHasFolds(foldIndex, block))) {
    return copyDown ? copyLineDown(view) : copyLineUp(view);
  }

  const state = initialState;
  const changes = blocks.map((block) => {
    const text = state.doc.slice(block.from, block.to);
    return copyDown
      ? { from: block.from, insert: text.append(lineBreak) }
      : { from: block.to, insert: lineBreak.append(text) };
  });
  const changeSet = state.changes(changes);
  const mappedRanges: SelectionRange[] = new Array(
    state.selection.ranges.length,
  );
  const newFolds: FoldRange[] = [];

  for (const block of blocks) {
    const blockLength = block.to - block.from;
    const topBlockFrom = changeSet.mapPos(block.from, -1);
    const bottomBlockFrom = topBlockFrom + blockLength + 1;
    // Match CodeMirror's native semantics: copy down keeps the selection in
    // the bottom block, while copy up keeps it in the top block.
    const selectedBlockFrom = copyDown ? bottomBlockFrom : topBlockFrom;

    for (const rangeIndex of block.rangeIndexes) {
      mappedRanges[rangeIndex] = mapRangeIntoBlock(
        state.selection.ranges[rangeIndex],
        block,
        selectedBlockFrom,
      );
    }
    for (const fold of foldsInBlock(foldIndex, block)) {
      newFolds.push(
        translatedFold(fold, block.from, topBlockFrom),
        translatedFold(fold, block.from, bottomBlockFrom),
      );
    }
  }

  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(mappedRanges, state.selection.mainIndex),
    effects: createFoldEffects(newFolds, changeSet.newLength),
    scrollIntoView: true,
    userEvent: "input.copyline",
  });
  return true;
}

function neighboringBlock(
  state: EditorState,
  block: LineBlock,
  direction: Direction,
  index: FoldIndex,
): LineBlock | null {
  const line = state.doc.lineAt(direction < 0 ? block.from : block.to);
  const lineNumber = line.number + direction;
  if (lineNumber < 1 || lineNumber > state.doc.lines) return null;
  const neighborLine = state.doc.line(lineNumber);
  const expanded = expandBlockToFolds(
    { from: neighborLine.from, to: neighborLine.to },
    index,
  );
  return { ...expanded, rangeIndexes: [] };
}

function createMoveOperation(
  state: EditorState,
  block: LineBlock,
  neighbor: LineBlock,
  direction: Direction,
): MoveOperation {
  const blockText = state.doc.slice(block.from, block.to);
  const neighborText = state.doc.slice(neighbor.from, neighbor.to);
  if (direction < 0) {
    return {
      block,
      neighbor,
      replaceFrom: neighbor.from,
      replaceTo: block.to,
      insert: blockText.append(lineBreak).append(neighborText),
      blockOffset: 0,
      neighborOffset: block.to - block.from + 1,
    };
  }
  return {
    block,
    neighbor,
    replaceFrom: block.from,
    replaceTo: neighbor.to,
    insert: neighborText.append(lineBreak).append(blockText),
    blockOffset: neighbor.to - neighbor.from + 1,
    neighborOffset: 0,
  };
}

function moveFoldedLines(view: EditorView, direction: Direction): boolean {
  const initialState = view.state;
  if (initialState.readOnly) return false;
  const foldIndex = getFoldIndex(initialState);
  const blocks = selectedLineBlocks(initialState, foldIndex);
  const operations = blocks.flatMap((block) => {
    const neighbor = neighboringBlock(
      initialState,
      block,
      direction,
      foldIndex,
    );
    return neighbor
      ? [createMoveOperation(initialState, block, neighbor, direction)]
      : [];
  });
  if (!operations.length) return false;

  if (
    !operations.some(
      (operation) =>
        blockHasFolds(foldIndex, operation.block) ||
        blockHasFolds(foldIndex, operation.neighbor),
    )
  ) {
    return direction < 0 ? moveLineUp(view) : moveLineDown(view);
  }

  const state = initialState;
  const changeSet = state.changes(
    operations.map((operation) => ({
      from: operation.replaceFrom,
      to: operation.replaceTo,
      insert: operation.insert,
    })),
  );
  const mappedRanges = state.selection.ranges.map((range) =>
    EditorSelection.range(
      changeSet.mapPos(range.anchor),
      changeSet.mapPos(range.head),
    ),
  );
  const newFolds: FoldRange[] = [];

  for (const operation of operations) {
    const replacementFrom = changeSet.mapPos(operation.replaceFrom, -1);
    const newBlockFrom = replacementFrom + operation.blockOffset;
    const newNeighborFrom = replacementFrom + operation.neighborOffset;
    for (const rangeIndex of operation.block.rangeIndexes) {
      mappedRanges[rangeIndex] = mapRangeIntoBlock(
        state.selection.ranges[rangeIndex],
        operation.block,
        newBlockFrom,
      );
    }
    for (const fold of foldsInBlock(foldIndex, operation.block)) {
      newFolds.push(translatedFold(fold, operation.block.from, newBlockFrom));
    }
    for (const fold of foldsInBlock(foldIndex, operation.neighbor)) {
      newFolds.push(
        translatedFold(fold, operation.neighbor.from, newNeighborFrom),
      );
    }
  }

  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(mappedRanges, state.selection.mainIndex),
    effects: createFoldEffects(newFolds, changeSet.newLength),
    scrollIntoView: true,
    userEvent: "move.line",
  });
  return true;
}

export function copyLineUpFoldAware(view: EditorView): boolean {
  return copyFoldedLines(view, -1);
}

export function copyLineDownFoldAware(view: EditorView): boolean {
  return copyFoldedLines(view, 1);
}

export function moveLineUpFoldAware(view: EditorView): boolean {
  return moveFoldedLines(view, -1);
}

export function moveLineDownFoldAware(view: EditorView): boolean {
  return moveFoldedLines(view, 1);
}

export function deleteLineFoldAware(view: EditorView): boolean {
  const initialState = view.state;
  if (initialState.readOnly) return false;
  const foldIndex = getFoldIndex(initialState);
  const blocks = selectedLineBlocks(initialState, foldIndex);
  if (!blocks.some((block) => blockHasFolds(foldIndex, block))) {
    return deleteLine(view);
  }

  const state = initialState;
  const changes = blocks.map((block) => {
    let { from, to } = block;
    if (from > 0) from--;
    else if (to < state.doc.length) to++;
    return { from, to };
  });
  const changeSet = state.changes(changes);
  const cursors = blocks.map((block) =>
    EditorSelection.cursor(
      Math.min(changeSet.newLength, changeSet.mapPos(block.from, -1)),
    ),
  );

  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(cursors, 0),
    scrollIntoView: true,
    userEvent: "delete.line",
  });
  return true;
}
