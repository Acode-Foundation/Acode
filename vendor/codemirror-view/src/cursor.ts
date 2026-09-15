import {EditorState, EditorSelection, SelectionRange, RangeSet,
        CharCategory, findColumn, findClusterBreak, Line} from "@codemirror/state"
import {EditorView} from "./editorview"
import {BlockType} from "./decoration"
import {atomicRanges} from "./extension"
import {textRange, Rect} from "./dom"
import {moveVisually, movedOver, Direction, BidiSpan} from "./bidi"
import {BlockInfo} from "./heightmap"
import {TileFlag, CompositeTile, TextTile} from "./tile"

declare global {
  interface Selection { modify(action: string, direction: string, granularity: string): void }
}

export function groupAt(state: EditorState, pos: number, bias: 1 | -1 = 1) {
  let categorize = state.charCategorizer(pos)
  let line = state.doc.lineAt(pos), linePos = pos - line.from
  if (line.length == 0) return EditorSelection.cursor(pos)
  if (linePos == 0) bias = 1
  else if (linePos == line.length) bias = -1
  let from = linePos, to = linePos
  if (bias < 0) from = findClusterBreak(line.text, linePos, false)
  else to = findClusterBreak(line.text, linePos)
  let cat = categorize(line.text.slice(from, to))
  while (from > 0) {
    let prev = findClusterBreak(line.text, from, false)
    if (categorize(line.text.slice(prev, from)) != cat) break
    from = prev
  }
  while (to < line.length) {
    let next = findClusterBreak(line.text, to)
    if (categorize(line.text.slice(to, next)) != cat) break
    to = next
  }
  return EditorSelection.undirectionalRange(from + line.from, to + line.from)
}

function posAtCoordsImprecise(view: EditorView, contentRect: Rect, block: BlockInfo, x: number, y: number) {
  let into = Math.round((x - contentRect.left) * view.defaultCharacterWidth)
  if (view.lineWrapping && block.height > view.defaultLineHeight * 1.5) {
    let textHeight = view.viewState.heightOracle.textHeight
    let line = Math.floor((y - block.top - (view.defaultLineHeight - textHeight) * 0.5) / textHeight)
    into += line * view.viewState.heightOracle.lineLength
  }
  let content = view.state.sliceDoc(block.from, block.to)
  return block.from + findColumn(content, into, view.state.tabSize)
}

export function blockAt(view: EditorView, pos: number, side: -1 | 1): BlockInfo {
  let line = view.lineBlockAt(pos)
  if (Array.isArray(line.type)) {
    let best: BlockInfo | undefined
    for (let l of line.type) {
      if (l.from > pos) break
      if (l.to < pos) continue
      if (l.from < pos && l.to > pos) return l
      if (!best || (l.type == BlockType.Text && (best.type != l.type || (side < 0 ? l.from < pos : l.to > pos))))
        best = l
    }
    return best || line
  }
  return line
}

export function moveToLineBoundary(view: EditorView, start: SelectionRange, forward: boolean, includeWrap: boolean) {
  let line = blockAt(view, start.head, start.assoc || -1)
  let coords = !includeWrap || line.type != BlockType.Text || !(view.lineWrapping || line.widgetLineBreaks) ? null
    : view.coordsAtPos(start.assoc < 0 && start.head > line.from ? start.head - 1 : start.head)
  if (coords) {
    let editorRect = view.dom.getBoundingClientRect()
    let direction = view.textDirectionAt(line.from)
    let pos = view.posAtCoords({x: forward == (direction == Direction.LTR) ? editorRect.right - 1 : editorRect.left + 1,
                                y: (coords.top + coords.bottom) / 2})
    if (pos != null) return EditorSelection.cursor(pos, forward ? -1 : 1)
  }
  return EditorSelection.cursor(forward ? line.to : line.from, forward ? -1 : 1)
}

export function moveByChar(view: EditorView, start: SelectionRange, forward: boolean,
                           by?: (initial: string) => (next: string) => boolean) {
  let line = view.state.doc.lineAt(start.head), spans = view.bidiSpans(line)
  let direction = view.textDirectionAt(line.from)
  for (let cur = start, check: null | ((next: string) => boolean) = null;;) {
    let next = moveVisually(line, spans, direction, cur, forward), char = movedOver
    if (!next) {
      if (line.number == (forward ? view.state.doc.lines : 1)) return cur
      char = "\n"
      line = view.state.doc.line(line.number + (forward ? 1 : -1))
      spans = view.bidiSpans(line)
      next = view.visualLineSide(line, !forward)
    }
    if (!check) {
      if (!by) return next
      check = by(char)
    } else if (!check(char)) {
      return cur
    }
    cur = next
  }
}

export function byGroup(view: EditorView, pos: number, start: string) {
  let categorize = view.state.charCategorizer(pos)
  let cat = categorize(start)
  return (next: string) => {
    let nextCat = categorize(next)
    if (cat == CharCategory.Space) cat = nextCat
    return cat == nextCat
  }
}

export function moveVertically(view: EditorView, start: SelectionRange, forward: boolean, distance?: number) {
  let startPos = start.head, dir: -1 | 1 = forward ? 1 : -1
  if (startPos == (forward ? view.state.doc.length : 0)) return EditorSelection.cursor(startPos, start.assoc)
  let goal = start.goalColumn, startY
  let rect = view.contentDOM.getBoundingClientRect()
  let startCoords = view.coordsAtPos(startPos, start.assoc || ((start.empty ? forward : start.head == start.from) ? 1 : -1))
  let docTop = view.documentTop
  if (startCoords) {
    if (goal == null) goal = startCoords.left - rect.left
    startY = dir < 0 ? startCoords.top : startCoords.bottom
  } else {
    let line = view.viewState.lineBlockAt(startPos)
    if (goal == null) goal = Math.min(rect.right - rect.left, view.defaultCharacterWidth * (startPos - line.from))
    startY = (dir < 0 ? line.top : line.bottom) + docTop
  }
  let resolvedGoal = rect.left + goal
  let halfText = view.viewState.heightOracle.textHeight >> 1, dist = distance ?? halfText
  for (let scan = 0;; scan += halfText) {
    let y = startY + (dist + scan) * dir
    let pos = posAtCoords(view, {x: resolvedGoal, y}, false, dir)!
    if (forward ? y > rect.bottom : y < rect.top)
      return EditorSelection.cursor(pos.pos, pos.assoc)
    let posCoords = view.coordsAtPos(pos.pos, pos.assoc), mid = posCoords ? (posCoords.top + posCoords.bottom) / 2 : 0
    if (!posCoords || (forward ? mid > startY : mid < startY))
      return EditorSelection.cursor(pos.pos, pos.assoc, undefined, goal)
  }
}

export function skipAtomicRanges(atoms: readonly RangeSet<any>[], pos: number, bias: -1 | 0 | 1) {
  for (;;) {
    let moved = 0
    for (let set of atoms) {
      set.between(pos - 1, pos + 1, (from, to, value) => {
        if (pos > from && pos < to) {
          let side = moved || bias || (pos - from < to - pos ? -1 : 1)
          pos = side < 0 ? from : to
          moved = side
        }
      })
    }
    if (!moved) return pos
  }
}

export function skipAtomsForSelection(atoms: readonly RangeSet<any>[], sel: EditorSelection) {
  let ranges = null
  for (let i = 0; i < sel.ranges.length; i++) {
    let range = sel.ranges[i], updated = null
    if (range.empty) {
      let pos = skipAtomicRanges(atoms, range.from, 0)
      if (pos != range.from) updated = EditorSelection.cursor(pos, -1)
    } else {
      let from = skipAtomicRanges(atoms, range.from, -1)
      let to = skipAtomicRanges(atoms, range.to, 1)
      if (from != range.from || to != range.to) {
        if (range.undirectional)
          updated = EditorSelection.undirectionalRange(range.from, range.to)
        else
          updated = EditorSelection.range(range.from == range.anchor ? from : to, range.from == range.head ? from : to)
      }
    }
    if (updated) {
      if (!ranges) ranges = sel.ranges.slice()
      ranges[i] = updated
    }
  }
  return ranges ? EditorSelection.create(ranges, sel.mainIndex) : sel
}

export function skipAtoms(view: EditorView, oldPos: SelectionRange, pos: SelectionRange) {
  let newPos = skipAtomicRanges(view.state.facet(atomicRanges).map(f => f(view)), pos.from, oldPos.head > pos.from ? -1 : 1)
  return newPos == pos.from ? pos : EditorSelection.cursor(newPos, newPos < pos.from ? 1 : -1)
}

export class PosAssoc {
  constructor(readonly pos: number, readonly assoc: -1 | 1) {}
}

export function posAtCoords(view: EditorView, coords: {x: number, y: number}, precise: boolean, scanY?: 1 | -1): PosAssoc | null {
  let content = view.contentDOM.getBoundingClientRect(), docTop = content.top + view.viewState.paddingTop
  let {x, y} = coords, yOffset = y - docTop, block
  // First find the block at the given Y position, if any. If scanY is
  // given (used for vertical cursor motion), try to skip widgets and
  // line padding.
  for (;;) {
    if (yOffset < 0) return new PosAssoc(0, 1)
    if (yOffset > view.viewState.docHeight) return new PosAssoc(view.state.doc.length, -1)
    block = view.elementAtHeight(yOffset)
    if (scanY == null) break
    if (block.type == BlockType.Text) {
      if (scanY < 0 ? block.to < view.viewport.from : block.from > view.viewport.to) break
      // Check whether we aren't landing on the top/bottom padding of the line
      let rect = view.docView.coordsAt(scanY < 0 ? block.from : block.to, scanY > 0 ? -1 : 1)
      if (rect && (scanY < 0 ? rect.top <= yOffset + docTop : rect.bottom >= yOffset + docTop)) break
    }
    let halfLine = view.viewState.heightOracle.textHeight / 2
    yOffset = scanY > 0 ? block.bottom + halfLine : block.top - halfLine
  }
  // If outside the viewport, return null if precise==true, an
  // estimate otherwise.
  if (view.viewport.from >= block.to || view.viewport.to <= block.from) {
    if (precise) return null
    if (block.type == BlockType.Text) {
      let pos = posAtCoordsImprecise(view, content, block, x, y)
      return new PosAssoc(pos, pos == block.from ? 1 : -1)
    }
  }
  if (block.type != BlockType.Text)
    return yOffset < (block.top + block.bottom) / 2 ? new PosAssoc(block.from, 1) : new PosAssoc(block.to, -1)

  // Here we know we're in a line, so run the logic for inline layout
  let line = view.docView.lineAt(block.from, 2)
  if (!line || line.length != block.length) line = view.docView.lineAt(block.from, -2)!
  return new InlineCoordsScan(view, x, y, view.textDirectionAt(block.from)).scanTile(line, block.from)
}

class InlineCoordsScan {
  // Cached bidi info
  line: Line | null = null
  spans: readonly BidiSpan[] | null = null

  constructor(readonly view: EditorView, readonly x: number, public y: number, readonly baseDir: Direction) {}

  bidiSpansAt(pos: number): {line: Line, spans: readonly BidiSpan[]} {
    if (!this.line || this.line.from > pos || this.line.to < pos) {
      this.line = this.view.state.doc.lineAt(pos)
      this.spans = this.view.bidiSpans(this.line)
    }
    return this as any
  }

  baseDirAt(pos: number, side: -1 | 1) {
    let {line, spans} = this.bidiSpansAt(pos)
    let level = spans[BidiSpan.find(spans, pos - line.from, -1, side)].level
    return level == this.baseDir
  }

  dirAt(pos: number, side: -1 | 1) {
    let {line, spans} = this.bidiSpansAt(pos)
    return spans[BidiSpan.find(spans, pos - line.from, -1, side)].dir
  }

  // Used to short-circuit bidi tests for content with a uniform direction
  bidiIn(from: number, to: number) {
    let {spans, line} = this.bidiSpansAt(from)
    return spans.length > 1 || spans.length && (spans[0].level != this.baseDir || spans[0].to + line.from < to)
  }

  // Scan through the rectangles for the content of a tile with inline
  // content, looking for one that overlaps the queried position
  // vertically and is closest horizontally. The caller is responsible
  // for dividing its content into N pieces, and pass an array with
  // N+1 positions (including the position after the last piece). For
  // a text tile, these will be character clusters, for a composite
  // tile, these will be child tiles.
  scan(
    positions: readonly number[],
    getRects: (i: number) => DOMRectList | null,
    recursed = false
  ): {i: number, after: boolean} {
    let lo = 0, hi = positions.length - 1, seen = new Set<number>()
    let bidi = this.bidiIn(positions[0], positions[hi])

    let above: DOMRect | undefined, below: DOMRect | undefined
    let closestI = -1, closestDx = 1e9, closestRect: DOMRect | undefined
    // Because, when the content is bidirectional, a regular binary
    // search is hard to perform (the content order does not
    // correspond to visual order), this loop does something between a
    // regular binary search and a full scan, depending on what it can
    // get away with. The outer hi/lo bounds are only adjusted for
    // elements that are part of the base order.
    //
    // To make sure all elements inside those bounds are visited,
    // eventually, we keep a set of seen indices, and if the midpoint
    // has already been handled, we start in a random index within the
    // current bounds and scan forward until we find an index that
    // hasn't been seen yet.
    search: while (lo < hi) {
      let dist = hi - lo, mid = (lo + hi) >> 1
      adjust: if (seen.has(mid)) {
        for (let i = 1; i < dist; i++) {
          let scan = mid + i
          if (scan >= hi) scan -= dist
          if (!seen.has(scan)) {
            mid = scan
            break adjust
          }
        }
        break search // No index found, we're done
      }
      seen.add(mid)
      let rects = getRects(mid), side = 0
      if (rects) for (let i = 0; i < rects.length; i++) {
        let rect = rects[i]
        // Ignore empty rectangles when there are other rectangles
        if (rect.width == 0 && rects.length > 1) continue
        if (rect.bottom < this.y) {
          if (!above || above.bottom < rect.bottom) above = rect
          side = 1
        } else if (rect.top > this.y) {
          if (!below || below.top > rect.top) below = rect
          side = -1
        } else {
          let off = rect.left > this.x ? this.x - rect.left : rect.right < this.x ? this.x - rect.right : 0
          let dx = Math.abs(off)
          if (dx < closestDx) {
            closestI = mid
            closestDx = dx
            closestRect = rect
          }
          if (off) side = (off < 0) == (this.baseDir == Direction.LTR) ? -1 : 1
        }
      }
      // Narrow binary search when it is safe to do so
      if (side == -1 && (!bidi || this.baseDirAt(positions[mid], 1))) hi = mid
      else if (side == 1 && (!bidi || this.baseDirAt(positions[mid + 1], -1))) lo = mid + 1
    }
    // If no element with y overlap is found, find the nearest element
    // on the y axis, move this.y into it, and retry the scan.
    if (!closestRect) {
      if (!below && !above) return {i: positions[0], after: false}
      let side = above && (!below || (this.y - above.bottom < below.top - this.y)) ? above : below!
      this.y = (side.top + side.bottom) / 2
      return this.scan(positions, getRects, true)
    }
    // Handle the case where closest matched a higher element on the
    // same line as an element below/above the coords
    if (closestDx && !recursed) {
      let {top, bottom} = closestRect
      if (above && above.bottom > (top + top + bottom) / 3) {
        this.y = above.bottom - 1
        return this.scan(positions, getRects, true)
      }
      if (below && below.top < (top + bottom + bottom) / 3) {
        this.y = below.top + 1
        return this.scan(positions, getRects, true)
      }
    }
    let ltr = (bidi ? this.dirAt(positions[closestI], 1) : this.baseDir) == Direction.LTR
    return {
      i: closestI,
      // Test whether x is closes to the start or end of this element
      after: (this.x > (closestRect.left + closestRect.right) / 2) == ltr
    }
  }

  scanText(tile: TextTile, offset: number): PosAssoc {
    let positions: number[] = []
    for (let i = 0; i < tile.length; i = findClusterBreak(tile.text, i)) positions.push(offset + i)
    positions.push(offset + tile.length)
    let scan = this.scan(positions, i => {
      let off = positions[i] - offset, end = positions[i + 1] - offset
      return textRange(tile.dom, off, end).getClientRects()
    })
    return scan.after ? new PosAssoc(positions[scan.i + 1], -1) : new PosAssoc(positions[scan.i], 1)
  }

  scanTile(tile: CompositeTile, offset: number): PosAssoc {
    if (!tile.length) return new PosAssoc(offset, 1)
    if (tile.children.length == 1) { // Short-circuit single-child tiles
      let child = tile.children[0]
      if (child.isText()) return this.scanText(child, offset)
      else if (child.isComposite()) return this.scanTile(child, offset)
    }
    let positions = [offset]
    for (let i = 0, pos = offset; i < tile.children.length; i++)
      positions.push(pos += tile.children[i].length)
    let scan = this.scan(positions, i => {
      let child = tile.children[i]
      if (child.flags & TileFlag.PointWidget) return null
      return (child.dom.nodeType == 1 ? child.dom as HTMLElement : textRange(child.dom as Text, 0, child.length)).getClientRects()
    })
    let child = tile.children[scan.i], pos = positions[scan.i]
    if (child.isText()) return this.scanText(child, pos)
    if (child.isComposite()) return this.scanTile(child, pos)
    return scan.after ? new PosAssoc(positions[scan.i + 1], -1) : new PosAssoc(pos, 1)
  }
}
