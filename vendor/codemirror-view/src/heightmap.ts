import {Text, ChangeSet, RangeSet, RangeComparator, SpanIterator} from "@codemirror/state"
import {DecorationSet, PointDecoration, Decoration, BlockType, addRange, WidgetType} from "./decoration"
import {ChangedRange} from "./extension"

const wrappingWhiteSpace = ["pre-wrap", "normal", "pre-line", "break-spaces"]

// Used to track, during updateHeight, if any actual heights changed
export let heightChangeFlag = false

export function clearHeightChangeFlag() { heightChangeFlag = false }

export class HeightOracle {
  doc: Text = Text.empty
  heightSamples: {[key: number]: boolean} = {}
  lineHeight: number = 14 // The height of an entire line (line-height)
  charWidth: number = 7
  textHeight: number = 14 // The height of the actual font (font-size)
  lineLength: number = 30

  constructor(public lineWrapping: boolean) {}

  heightForGap(from: number, to: number): number {
    let lines = this.doc.lineAt(to).number - this.doc.lineAt(from).number + 1
    if (this.lineWrapping)
      lines += Math.max(0, Math.ceil(((to - from) - (lines * this.lineLength * 0.5)) / this.lineLength))
    return this.lineHeight * lines
  }

  heightForLine(length: number): number {
    if (!this.lineWrapping) return this.lineHeight
    let lines = 1 + Math.max(0, Math.ceil((length - this.lineLength) / Math.max(1, this.lineLength - 5)))
    return lines * this.lineHeight
  }

  setDoc(doc: Text): this { this.doc = doc; return this }

  mustRefreshForWrapping(whiteSpace: string): boolean {
    return (wrappingWhiteSpace.indexOf(whiteSpace) > -1) != this.lineWrapping
  }

  mustRefreshForHeights(lineHeights: number[]): boolean {
    let newHeight = false
    for (let i = 0; i < lineHeights.length; i++) {
      let h = lineHeights[i]
      if (h < 0) {
        i++
      } else if (!this.heightSamples[Math.floor(h * 10)]) { // Round to .1 pixels
        newHeight = true
        this.heightSamples[Math.floor(h * 10)] = true
      }
    }
    return newHeight
  }

  refresh(whiteSpace: string, lineHeight: number, charWidth: number, textHeight: number,
          lineLength: number, knownHeights: number[]): boolean {
    let lineWrapping = wrappingWhiteSpace.indexOf(whiteSpace) > -1
    let changed = Math.abs(lineHeight - this.lineHeight) > 0.3 || this.lineWrapping != lineWrapping
    this.lineWrapping = lineWrapping
    this.lineHeight = lineHeight
    this.charWidth = charWidth
    this.textHeight = textHeight
    this.lineLength = lineLength
    if (changed) {
      this.heightSamples = {}
      for (let i = 0; i < knownHeights.length; i++) {
        let h = knownHeights[i]
        if (h < 0) i++
        else this.heightSamples[Math.floor(h * 10)] = true
      }
    }
    return changed
  }
}

// This object is used by `updateHeight` to make DOM measurements
// arrive at the right nodes. The `heights` array is a sequence of
// block heights, starting from position `from`.
export class MeasuredHeights {
  public index = 0
  constructor(readonly from: number, readonly heights: number[]) {}
  get more() { return this.index < this.heights.length }
}

/// Record used to represent information about a block-level element
/// in the editor view.
export class BlockInfo {
  /// @internal
  constructor(
    /// The start of the element in the document.
    readonly from: number,
    /// The length of the element.
    readonly length: number,
    /// The top position of the element (relative to the top of the
    /// document).
    readonly top: number,
    /// Its height.
    readonly height: number,
    /// @internal Weird packed field that holds an array of children
    /// for composite blocks, a decoration for block widgets, and a
    /// number indicating the amount of widget-created line breaks for
    /// text blocks.
    readonly _content: readonly BlockInfo[] | PointDecoration | number
  ) {}

  /// The type of element this is. When querying lines, this may be
  /// an array of all the blocks that make up the line.
  get type(): BlockType | readonly BlockInfo[] {
    return typeof this._content == "number" ? BlockType.Text :
      Array.isArray(this._content) ? this._content : (this._content as PointDecoration).type
  }

  /// The end of the element as a document position.
  get to() { return this.from + this.length }
  /// The bottom position of the element.
  get bottom() { return this.top + this.height }

  /// If this is a widget block, this will return the widget
  /// associated with it.
  get widget(): WidgetType | null {
    return this._content instanceof PointDecoration ? this._content.widget : null
  }

  /// If this is a textblock, this holds the number of line breaks
  /// that appear in widgets inside the block.
  get widgetLineBreaks(): number {
    return typeof this._content == "number" ? this._content : 0
  }

  /// @internal
  join(other: BlockInfo) {
    let content = (Array.isArray(this._content) ? this._content : [this])
                    .concat(Array.isArray(other._content) ? other._content : [other])
    return new BlockInfo(this.from, this.length + other.length,
                         this.top, this.height + other.height, content)
  }
}

export enum QueryType { ByPos, ByHeight, ByPosNoHeight }

const enum Flag { Break = 1, Outdated = 2, SingleLine = 4 }

const Epsilon = 1e-3

export abstract class HeightMap {
  constructor(
    public length: number, // The number of characters covered
    public height: number, // Height of this part of the document
    public flags: number = Flag.Outdated
  ) {}

  declare size: number

  get outdated() { return (this.flags & Flag.Outdated) > 0 }
  set outdated(value) { this.flags = (value ? Flag.Outdated : 0) | (this.flags & ~Flag.Outdated) }

  abstract blockAt(height: number, oracle: HeightOracle, top: number, offset: number): BlockInfo
  abstract lineAt(value: number, type: QueryType, oracle: HeightOracle, top: number, offset: number): BlockInfo
  abstract forEachLine(from: number, to: number, oracle: HeightOracle, top: number, offset: number, f: (line: BlockInfo) => void): void

  abstract updateHeight(oracle: HeightOracle, offset?: number, force?: boolean, measured?: MeasuredHeights): HeightMap
  abstract toString(): void

  setHeight(height: number) {
    if (this.height != height) {
      if (Math.abs(this.height - height) > Epsilon) heightChangeFlag = true
      this.height = height
    }
  }

  // Base case is to replace a leaf node, which simply builds a tree
  // from the new nodes and returns that (HeightMapBranch and
  // HeightMapGap override this to actually use from/to)
  replace(_from: number, _to: number, nodes: (HeightMap | null)[]): HeightMap {
    return HeightMap.of(nodes)
  }

  // Again, these are base cases, and are overridden for branch and gap nodes.
  decomposeLeft(_to: number, result: (HeightMap | null)[]) { result.push(this) }
  decomposeRight(_from: number, result: (HeightMap | null)[]) { result.push(this) }

  applyChanges(decorations: readonly DecorationSet[], oldDoc: Text, oracle: HeightOracle,
               changes: readonly ChangedRange[]): HeightMap {
    let me: HeightMap = this, doc = oracle.doc
    for (let i = changes.length - 1; i >= 0; i--) {
      let {fromA, toA, fromB, toB} = changes[i]
      let start = me.lineAt(fromA, QueryType.ByPosNoHeight, oracle.setDoc(oldDoc), 0, 0)
      let end = start.to >= toA ? start : me.lineAt(toA, QueryType.ByPosNoHeight, oracle, 0, 0)
      toB += end.to - toA; toA = end.to
      while (i > 0 && start.from <= changes[i - 1].toA) {
        fromA = changes[i - 1].fromA
        fromB = changes[i - 1].fromB
        i--
        if (fromA < start.from) start = me.lineAt(fromA, QueryType.ByPosNoHeight, oracle, 0, 0)
      }
      fromB += start.from - fromA; fromA = start.from
      let nodes = NodeBuilder.build(oracle.setDoc(doc), decorations, fromB, toB)
      me = replace(me, me.replace(fromA, toA, nodes))
    }
    return me.updateHeight(oracle, 0)
  }

  static empty(): HeightMap { return new HeightMapText(0, 0, 0) }

  // nodes uses null values to indicate the position of line breaks.
  // There are never line breaks at the start or end of the array, or
  // two line breaks next to each other, and the array isn't allowed
  // to be empty (same restrictions as return value from the builder).
  static of(nodes: (HeightMap | null)[]): HeightMap {
    if (nodes.length == 1) return nodes[0] as HeightMap

    let i = 0, j = nodes.length, before = 0, after = 0
    for (;;) {
      if (i == j) {
        if (before > after * 2) {
          let split = nodes[i - 1] as HeightMapBranch
          if (split.break) nodes.splice(--i, 1, split.left, null, split.right)
          else nodes.splice(--i, 1, split.left, split.right)
          j += 1 + split.break
          before -= split.size
        } else if (after > before * 2) {
          let split = nodes[j] as HeightMapBranch
          if (split.break) nodes.splice(j, 1, split.left, null, split.right)
          else nodes.splice(j, 1, split.left, split.right)
          j += 2 + split.break
          after -= split.size
        } else {
          break
        }
      } else if (before < after) {
        let next = nodes[i++]
        if (next) before += next.size
      } else {
        let next = nodes[--j]
        if (next) after += next.size
      }
    }

    let brk = 0
    if (nodes[i - 1] == null) { brk = 1; i-- }
    else if (nodes[i] == null) { brk = 1; j++ }
    return new HeightMapBranch(HeightMap.of(nodes.slice(0, i)), brk, HeightMap.of(nodes.slice(j)))
  }
}

function replace(old: HeightMap, val: HeightMap) {
  if (old == val) return old
  if (old.constructor != val.constructor) heightChangeFlag = true
  return val
}

HeightMap.prototype.size = 1

const SpaceDeco = Decoration.replace({}) as PointDecoration

class HeightMapBlock extends HeightMap {
  spaceAbove = 0

  constructor(length: number, height: number, readonly deco: PointDecoration | null) { super(length, height) }

  mainBlock(top: number, offset: number) {
    return new BlockInfo(offset, this.length, top + this.spaceAbove, this.height - this.spaceAbove, this.deco || 0)
  }

  blockAt(height: number, _oracle: HeightOracle, top: number, offset: number) {
    return this.spaceAbove && height < top + this.spaceAbove ? new BlockInfo(offset, 0, top, this.spaceAbove, SpaceDeco)
      : this.mainBlock(top, offset)
  }

  lineAt(_value: number, _type: QueryType, oracle: HeightOracle, top: number, offset: number) {
    let main = this.mainBlock(top, offset)
    return this.spaceAbove ? this.blockAt(0, oracle, top, offset).join(main) : main
  }

  forEachLine(from: number, to: number, oracle: HeightOracle, top: number, offset: number, f: (line: BlockInfo) => void) {
    if (from <= offset + this.length && to >= offset) f(this.lineAt(0, QueryType.ByPos, oracle, top, offset))
  }

  setMeasuredHeight(measured: MeasuredHeights) {
    let next = measured.heights[measured.index++]
    if (next < 0) {
      this.spaceAbove = -next
      next = measured.heights[measured.index++]
    } else {
      this.spaceAbove = 0
    }
    this.setHeight(next)
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, _force: boolean = false, measured?: MeasuredHeights) {
    if (measured && measured.from <= offset && measured.more)
      this.setMeasuredHeight(measured)
    this.outdated = false
    return this
  }

  toString() { return `block(${this.length})` }
}

class HeightMapText extends HeightMapBlock {
  public collapsed = 0 // Amount of collapsed content in the line
  public widgetHeight = 0 // Maximum inline widget height
  public breaks = 0 // Number of widget-introduced line breaks on the line

  constructor(length: number, height: number, above: number) {
    super(length, height, null)
    this.spaceAbove = above
  }

  mainBlock(top: number, offset: number) {
    return new BlockInfo(offset, this.length, top + this.spaceAbove, this.height - this.spaceAbove, this.breaks)
  }

  replace(_from: number, _to: number, nodes: (HeightMap | null)[]): HeightMap {
    let node = nodes[0]
    if (nodes.length == 1 && (node instanceof HeightMapText || node instanceof HeightMapGap && (node.flags & Flag.SingleLine)) &&
        Math.abs(this.length - node.length) < 10) {
      if (node instanceof HeightMapGap) node = new HeightMapText(node.length, this.height, this.spaceAbove)
      else node.height = this.height
      if (!this.outdated) node.outdated = false
      return node
    } else {
      return HeightMap.of(nodes)
    }
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights) {
    if (measured && measured.from <= offset && measured.more) {
      this.setMeasuredHeight(measured)
    } else if (force || this.outdated) {
      this.spaceAbove = 0
      this.setHeight(Math.max(this.widgetHeight, oracle.heightForLine(this.length - this.collapsed)) +
        this.breaks * oracle.lineHeight)
    }
    this.outdated = false
    return this
  }

  toString() {
    return `line(${this.length}${this.collapsed ? -this.collapsed : ""}${this.widgetHeight ? ":" + this.widgetHeight : ""})`
  }
}

class HeightMapGap extends HeightMap {
  constructor(length: number) { super(length, 0) }

  private heightMetrics(oracle: HeightOracle, offset: number): {
    firstLine: number, lastLine: number, perLine: number, perChar: number
  } {
    let firstLine = oracle.doc.lineAt(offset).number, lastLine = oracle.doc.lineAt(offset + this.length).number
    let lines = lastLine - firstLine + 1
    let perLine, perChar = 0
    if (oracle.lineWrapping) {
      let totalPerLine = Math.min(this.height, oracle.lineHeight * lines)
      perLine = totalPerLine / lines
      if (this.length > lines + 1)
        perChar = (this.height - totalPerLine) / (this.length - lines - 1)
    } else {
      perLine = this.height / lines
    }
    return {firstLine, lastLine, perLine, perChar}
  }

  blockAt(height: number, oracle: HeightOracle, top: number, offset: number) {
    let {firstLine, lastLine, perLine, perChar} = this.heightMetrics(oracle, offset)
    if (oracle.lineWrapping) {
      let guess = offset + (height < oracle.lineHeight ? 0
        : Math.round(Math.max(0, Math.min(1, (height - top) / this.height)) * this.length))
      let line = oracle.doc.lineAt(guess), lineHeight = perLine + line.length * perChar
      let lineTop = Math.max(top, height - lineHeight / 2)
      return new BlockInfo(line.from, line.length, lineTop, lineHeight, 0)
    } else {
      let line = Math.max(0, Math.min(lastLine - firstLine, Math.floor((height - top) / perLine)))
      let {from, length} = oracle.doc.line(firstLine + line)
      return new BlockInfo(from, length, top + perLine * line, perLine, 0)
    }
  }

  lineAt(value: number, type: QueryType, oracle: HeightOracle, top: number, offset: number) {
    if (type == QueryType.ByHeight) return this.blockAt(value, oracle, top, offset)
    if (type == QueryType.ByPosNoHeight) {
      let {from, to} = oracle.doc.lineAt(value)
      return new BlockInfo(from, to - from, 0, 0, 0)
    }
    let {firstLine, perLine, perChar} = this.heightMetrics(oracle, offset)
    let line = oracle.doc.lineAt(value), lineHeight = perLine + line.length * perChar
    let linesAbove = line.number - firstLine
    let lineTop = top + perLine * linesAbove + perChar * (line.from - offset - linesAbove)
    return new BlockInfo(line.from, line.length, Math.max(top, Math.min(lineTop, top + this.height - lineHeight)),
                         lineHeight, 0)
  }

  forEachLine(from: number, to: number, oracle: HeightOracle, top: number, offset: number, f: (line: BlockInfo) => void) {
    from = Math.max(from, offset); to = Math.min(to, offset + this.length)
    let {firstLine, perLine, perChar} = this.heightMetrics(oracle, offset)
    for (let pos = from, lineTop = top; pos <= to;) {
      let line = oracle.doc.lineAt(pos)
      if (pos == from) {
        let linesAbove = line.number - firstLine
        lineTop += perLine * linesAbove + perChar * (from - offset - linesAbove)
      }
      let lineHeight = perLine + perChar * line.length
      f(new BlockInfo(line.from, line.length, lineTop, lineHeight, 0))
      lineTop += lineHeight
      pos = line.to + 1
    }
  }

  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    let after = this.length - to
    if (after > 0) {
      let last = nodes[nodes.length - 1]
      if (last instanceof HeightMapGap) nodes[nodes.length - 1] = new HeightMapGap(last.length + after)
      else nodes.push(null, new HeightMapGap(after - 1))
    }
    if (from > 0) {
      let first = nodes[0]
      if (first instanceof HeightMapGap) nodes[0] = new HeightMapGap(from + first.length)
      else nodes.unshift(new HeightMapGap(from - 1), null)
    }
    return HeightMap.of(nodes)
  }

  decomposeLeft(to: number, result: (HeightMap | null)[]) {
    result.push(new HeightMapGap(to - 1), null)
  }

  decomposeRight(from: number, result: (HeightMap | null)[]) {
    result.push(null, new HeightMapGap(this.length - from - 1))
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights): HeightMap {
    let end = offset + this.length
    if (measured && measured.from <= offset + this.length && measured.more) {
      // Fill in part of this gap with measured lines. We know there
      // can't be widgets or collapsed ranges in those lines, because
      // they would already have been added to the heightmap (gaps
      // only contain plain text).
      let nodes = [], pos = Math.max(offset, measured.from), singleHeight = -1
      if (measured.from > offset) nodes.push(new HeightMapGap(measured.from - offset - 1).updateHeight(oracle, offset))
      while (pos <= end && measured.more) {
        let len = oracle.doc.lineAt(pos).length
        if (nodes.length) nodes.push(null)
        let height = measured.heights[measured.index++], above = 0
        if (height < 0) {
          above = -height
          height = measured.heights[measured.index++]
        }
        if (singleHeight == -1) singleHeight = height
        else if (Math.abs(height - singleHeight) >= Epsilon) singleHeight = -2
        let line = new HeightMapText(len, height, above)
        line.outdated = false
        nodes.push(line)
        pos += len + 1
      }
      if (pos <= end) nodes.push(null, new HeightMapGap(end - pos).updateHeight(oracle, pos))
      let result = HeightMap.of(nodes)
      if (singleHeight < 0 || Math.abs(result.height - this.height) >= Epsilon ||
          Math.abs(singleHeight - this.heightMetrics(oracle, offset).perLine) >= Epsilon)
        heightChangeFlag = true
      return replace(this, result)
    } else if (force || this.outdated) {
      this.setHeight(oracle.heightForGap(offset, offset + this.length))
      this.outdated = false
    }
    return this
  }

  toString() { return `gap(${this.length})` }
}

class HeightMapBranch extends HeightMap {
  size: number

  constructor(public left: HeightMap, brk: number, public right: HeightMap) {
    super(left.length + brk + right.length, left.height + right.height, brk | (left.outdated || right.outdated ? Flag.Outdated : 0))
    this.size = left.size + right.size
  }

  get break() { return this.flags & Flag.Break }

  blockAt(height: number, oracle: HeightOracle, top: number, offset: number) {
    let mid = top + this.left.height
    return height < mid ? this.left.blockAt(height, oracle, top, offset)
      : this.right.blockAt(height, oracle, mid, offset + this.left.length + this.break)
  }

  lineAt(value: number, type: QueryType, oracle: HeightOracle, top: number, offset: number) {
    let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break
    let left = type == QueryType.ByHeight ? value < rightTop : value < rightOffset
    let base = left ? this.left.lineAt(value, type, oracle, top, offset)
      : this.right.lineAt(value, type, oracle, rightTop, rightOffset)
    if (this.break || (left ? base.to < rightOffset : base.from > rightOffset)) return base
    let subQuery = type == QueryType.ByPosNoHeight ? QueryType.ByPosNoHeight : QueryType.ByPos
    if (left)
      return base.join(this.right.lineAt(rightOffset, subQuery, oracle, rightTop, rightOffset))
    else
      return this.left.lineAt(rightOffset, subQuery, oracle, top, offset).join(base)
  }

  forEachLine(from: number, to: number, oracle: HeightOracle, top: number, offset: number, f: (line: BlockInfo) => void) {
    let rightTop = top + this.left.height, rightOffset = offset + this.left.length + this.break
    if (this.break) {
      if (from < rightOffset) this.left.forEachLine(from, to, oracle, top, offset, f)
      if (to >= rightOffset) this.right.forEachLine(from, to, oracle, rightTop, rightOffset, f)
    } else {
      let mid = this.lineAt(rightOffset, QueryType.ByPos, oracle, top, offset)
      if (from < mid.from) this.left.forEachLine(from, mid.from - 1, oracle, top, offset, f)
      if (mid.to >= from && mid.from <= to) f(mid)
      if (to > mid.to) this.right.forEachLine(mid.to + 1, to, oracle, rightTop, rightOffset, f)
    }
  }

  replace(from: number, to: number, nodes: (HeightMap | null)[]): HeightMap {
    let rightStart = this.left.length + this.break
    if (to < rightStart)
      return this.balanced(this.left.replace(from, to, nodes), this.right)
    if (from > this.left.length)
      return this.balanced(this.left, this.right.replace(from - rightStart, to - rightStart, nodes))

    let result: (HeightMap | null)[] = []
    if (from > 0) this.decomposeLeft(from, result)
    let left = result.length
    for (let node of nodes) result.push(node)
    if (from > 0) mergeGaps(result, left - 1)
    if (to < this.length) {
      let right = result.length
      this.decomposeRight(to, result)
      mergeGaps(result, right)
    }
    return HeightMap.of(result)
  }

  decomposeLeft(to: number, result: (HeightMap | null)[]) {
    let left = this.left.length
    if (to <= left) return this.left.decomposeLeft(to, result)
    result.push(this.left)
    if (this.break) {
      left++
      if (to >= left) result.push(null)
    }
    if (to > left) this.right.decomposeLeft(to - left, result)
  }

  decomposeRight(from: number, result: (HeightMap | null)[]) {
    let left = this.left.length, right = left + this.break
    if (from >= right) return this.right.decomposeRight(from - right, result)
    if (from < left) this.left.decomposeRight(from, result)
    if (this.break && from < right) result.push(null)
    result.push(this.right)
  }

  balanced(left: HeightMap, right: HeightMap): HeightMap {
    if (left.size > 2 * right.size || right.size > 2 * left.size)
      return HeightMap.of(this.break ? [left, null, right] : [left, right])
    this.left = replace(this.left, left)
    this.right = replace(this.right, right)
    this.setHeight(left.height + right.height)
    this.outdated = left.outdated || right.outdated
    this.size = left.size + right.size
    this.length = left.length + this.break + right.length
    return this
  }

  updateHeight(oracle: HeightOracle, offset: number = 0, force: boolean = false, measured?: MeasuredHeights): HeightMap {
    let {left, right} = this, rightStart = offset + left.length + this.break, rebalance: any = null
    if (measured && measured.from <= offset + left.length && measured.more)
      rebalance = left = left.updateHeight(oracle, offset, force, measured)
    else
      left.updateHeight(oracle, offset, force)
    if (measured && measured.from <= rightStart + right.length && measured.more)
      rebalance = right = right.updateHeight(oracle, rightStart, force, measured)
    else
      right.updateHeight(oracle, rightStart, force)
    if (rebalance) return this.balanced(left, right)
    this.height = this.left.height + this.right.height
    this.outdated = false
    return this
  }

  toString() { return this.left + (this.break ? " " : "-") + this.right }
}

function mergeGaps(nodes: (HeightMap | null)[], around: number) {
  let before, after
  if (nodes[around] == null &&
      (before = nodes[around - 1]) instanceof HeightMapGap &&
      (after = nodes[around + 1]) instanceof HeightMapGap)
    nodes.splice(around - 1, 3, new HeightMapGap(before.length + 1 + after.length))
}

const relevantWidgetHeight = 5

class NodeBuilder implements SpanIterator<Decoration> {
  nodes: (HeightMap | null)[] = []
  writtenTo: number
  lineStart = -1
  lineEnd = -1
  covering: HeightMapBlock | null = null

  constructor(public pos: number, public oracle: HeightOracle) {
    this.writtenTo = pos
  }

  get isCovered() {
    return this.covering && this.nodes[this.nodes.length - 1] == this.covering
  }

  span(_from: number, to: number) {
    if (this.lineStart > -1) {
      let end = Math.min(to, this.lineEnd), last = this.nodes[this.nodes.length - 1]
      if (last instanceof HeightMapText)
        last.length += end - this.pos
      else if (end > this.pos || !this.isCovered)
        this.nodes.push(new HeightMapText(end - this.pos, -1, 0))
      this.writtenTo = end
      if (to > end) {
        this.nodes.push(null)
        this.writtenTo++
        this.lineStart = -1
      }
    }
    this.pos = to
  }

  point(from: number, to: number, deco: PointDecoration) {
    if (from < to || deco.heightRelevant) {
      let height = deco.widget ? deco.widget.estimatedHeight : 0
      let breaks = deco.widget ? deco.widget.lineBreaks : 0
      if (height < 0) height = this.oracle.lineHeight
      let len = to - from
      if (deco.block) {
        this.addBlock(new HeightMapBlock(len, height, deco))
      } else if (len || breaks || height >= relevantWidgetHeight) {
        this.addLineDeco(height, breaks, len)
      }
    } else if (to > from) {
      this.span(from, to)
    }
    if (this.lineEnd > -1 && this.lineEnd < this.pos)
      this.lineEnd = this.oracle.doc.lineAt(this.pos).to
  }

  enterLine() {
    if (this.lineStart > -1) return
    let {from, to} = this.oracle.doc.lineAt(this.pos)
    this.lineStart = from; this.lineEnd = to
    if (this.writtenTo < from) {
      if (this.writtenTo < from - 1 || this.nodes[this.nodes.length - 1] == null)
        this.nodes.push(this.blankContent(this.writtenTo, from - 1))
      this.nodes.push(null)
    }
    if (this.pos > from)
      this.nodes.push(new HeightMapText(this.pos - from, -1, 0))
    this.writtenTo = this.pos
  }

  blankContent(from: number, to: number) {
    let gap = new HeightMapGap(to - from)
    if (this.oracle.doc.lineAt(from).to == to) gap.flags |= Flag.SingleLine
    return gap
  }

  ensureLine() {
    this.enterLine()
    let last = this.nodes.length ? this.nodes[this.nodes.length - 1] : null
    if (last instanceof HeightMapText) return last
    let line = new HeightMapText(0, -1, 0)
    this.nodes.push(line)
    return line
  }

  addBlock(block: HeightMapBlock) {
    this.enterLine()
    let deco = block.deco
    if (deco && deco.startSide > 0 && !this.isCovered) this.ensureLine()
    this.nodes.push(block)
    this.writtenTo = this.pos = this.pos + block.length
    if (deco && deco.endSide > 0) this.covering = block
  }

  addLineDeco(height: number, breaks: number, length: number) {
    let line = this.ensureLine()
    line.length += length
    line.collapsed += length
    line.widgetHeight = Math.max(line.widgetHeight, height)
    line.breaks += breaks
    this.writtenTo = this.pos = this.pos + length
  }

  finish(from: number) {
    let last = this.nodes.length == 0 ? null : this.nodes[this.nodes.length - 1]
    if (this.lineStart > -1 && !(last instanceof HeightMapText) && !this.isCovered)
      this.nodes.push(new HeightMapText(0, -1, 0))
    else if (this.writtenTo < this.pos || last == null)
      this.nodes.push(this.blankContent(this.writtenTo, this.pos))
    let pos = from
    for (let node of this.nodes) {
      if (node instanceof HeightMapText) node.updateHeight(this.oracle, pos)
      pos += node ? node.length : 1
    }
    return this.nodes
  }

  // Always called with a region that on both sides either stretches
  // to a line break or the end of the document.
  // The returned array uses null to indicate line breaks, but never
  // starts or ends in a line break, or has multiple line breaks next
  // to each other.
  static build(oracle: HeightOracle, decorations: readonly DecorationSet[],
               from: number, to: number): (HeightMap | null)[] {
    let builder = new NodeBuilder(from, oracle)
    RangeSet.spans(decorations, from, to, builder, 0)
    return builder.finish(from)
  }
}

export function heightRelevantDecoChanges(a: readonly DecorationSet[], b: readonly DecorationSet[], diff: ChangeSet) {
  let comp = new DecorationComparator
  RangeSet.compare(a, b, diff, comp, 0)
  return comp.changes
}

class DecorationComparator implements RangeComparator<Decoration> {
  changes: number[] = []

  compareRange() {}

  comparePoint(from: number, to: number, a: Decoration | null, b: Decoration | null) {
    if (from < to || a && a.heightRelevant || b && b.heightRelevant) addRange(from, to, this.changes, 5)
  }
}
