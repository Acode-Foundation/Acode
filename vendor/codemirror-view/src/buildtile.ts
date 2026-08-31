import {Tile, CompositeTile, DocTile, LineTile, MarkTile, BlockWrapperTile,
        WidgetTile, WidgetBufferTile, TextTile, TileFlag, TilePointer, TileWalker} from "./tile"
import {ChangedRange} from "./extension"
import {Attrs, getAttrs, combineAttrs} from "./attributes"
import {DecorationSet, MarkDecoration, PointDecoration, LineDecoration, WidgetType,
        BlockWrapper} from "./decoration"
import {RangeSet, TextIterator, Text as DocText, RangeCursor} from "@codemirror/state"
import {EditorView} from "./editorview"
import {Composition} from "./docview"
import browser from "./browser"

const LOG_builder = false

// During updates, we track when we reuse tiles or their DOM in order
// to avoid reusing the same node twice. This is also used to call
// destroy on the proper widgets after an update.
export const enum Reused { Full = 1, DOM = 2 }

const enum C { Chunk = 512, Bucket = 6, WrapperReset = 10000 }

// Used to track open block wrappers
class OpenWrapper {
  constructor(readonly from: number, readonly to: number, readonly wrapper: BlockWrapper, readonly rank: number) {}
}

// This class builds up a new document tile using input from either
// iteration over the old tree or iteration over the document +
// decorations. The add* methods emit elements into the tile
// structure. To avoid awkward synchronization issues, marks and block
// wrappers are treated as belonging to to their content, rather than
// opened/closed independently.
//
// All composite tiles that are touched by changes are rebuilt,
// reusing as much of the old tree (either whole nodes or just DOM
// elements) as possible. The new tree is built without the Synced
// flag, and then synced (during which DOM parent/child relations are
// fixed up, text nodes filled in, and attributes added) in a second
// phase.
class TileBuilder {
  curLine: LineTile | null = null
  lastBlock: LineTile | WidgetTile | null = null
  afterWidget: WidgetTile | null = null
  pos = 0
  wrappers: OpenWrapper[] = []
  wrapperPos = 0

  constructor(
    readonly cache: TileCache,
    readonly root: DocTile,
    readonly blockWrappers: RangeCursor<BlockWrapper>
  ) {}

  addText(text: string, marks: MarkDecoration[], openStart: number, tile?: TextTile) {
    this.flushBuffer()
    let parent = this.ensureMarks(marks, openStart)
    let prev = parent.lastChild
    if (prev && prev.isText() && !(prev.flags & TileFlag.Composition) && prev.length + text.length < C.Chunk) {
      this.cache.reused.set(prev, Reused.DOM)
      let tile = parent.children[parent.children.length - 1] = new TextTile(prev.dom, prev.text + text)
      tile.parent = parent
    } else {
      parent.append(tile || TextTile.of(text, this.cache.find(TextTile)?.dom))
    }
    this.pos += text.length
    this.afterWidget = null
  }

  addComposition(composition: Composition, context: {marks: MarkTile[], line: LineTile}) {
    let line = this.curLine!
    if (line.dom != context.line.dom) {
      line.setDOM(this.cache.reused.has(context.line) ? freeNode(context.line.dom) : context.line.dom)
      this.cache.reused.set(context.line, Reused.DOM)
    }

    let head: CompositeTile = line
    for (let i = context.marks.length - 1; i >= 0; i--) {
      let mark = context.marks[i]
      let last: Tile | null = head.lastChild
      if (last instanceof MarkTile && last.mark.eq(mark.mark)) {
        if (last.dom != mark.dom) last.setDOM(freeNode(mark.dom))
        head = last
      } else {
        if (this.cache.reused.get(mark)) {
          let tile = Tile.get(mark.dom)
          if (tile) tile.setDOM(freeNode(mark.dom))
        }
        let nw = MarkTile.of(mark.mark, mark.dom)
        head.append(nw)
        head = nw
      }
      this.cache.reused.set(mark, Reused.DOM)
    }
    let oldTile = Tile.get(composition.text)
    if (oldTile) this.cache.reused.set(oldTile, Reused.DOM)
    let text = new TextTile(composition.text, composition.text.nodeValue!)
    text.flags |= TileFlag.Composition
    this.pos = composition.range.toB
    head.append(text)
  }

  addInlineWidget(widget: WidgetTile, marks: MarkDecoration[], openStart: number) {
    // Adjacent same-side-facing non-replacing widgets don't need buffers between them
    let noSpace = this.afterWidget && (widget.flags & TileFlag.PointWidget) &&
      (this.afterWidget.flags & TileFlag.PointWidget) == (widget.flags & TileFlag.PointWidget)
    if (!noSpace) this.flushBuffer()
    let parent = this.ensureMarks(marks, openStart)
    if (!noSpace && !(widget.flags & TileFlag.Before)) parent.append(this.getBuffer(1))
    parent.append(widget)
    this.pos += widget.length
    this.afterWidget = widget
  }

  addMark(tile: MarkTile, marks: MarkDecoration[], openStart: number) {
    this.flushBuffer()
    let parent = this.ensureMarks(marks, openStart)
    parent.append(tile)
    this.pos += tile.length
    this.afterWidget = null
  }

  addBlockWidget(widget: WidgetTile) {
    this.getBlockPos().append(widget)
    this.pos += widget.length
    this.lastBlock = widget
    this.endLine()
  }

  continueWidget(length: number) {
    let widget = this.afterWidget || this.lastBlock
    widget!.length += length
    this.pos += length
  }

  addLineStart(attrs: Attrs | null, dom?: HTMLElement) {
    if (!attrs) attrs = lineBaseAttrs
    let tile = LineTile.start(attrs, dom || this.cache.find(LineTile)?.dom, !!dom)
    this.getBlockPos().append(this.lastBlock = this.curLine = tile)
  }

  addLine(tile: LineTile) {
    this.getBlockPos().append(tile)
    this.pos += tile.length
    this.lastBlock = tile
    this.endLine()
  }

  addBreak() {
    this.lastBlock!.flags |= TileFlag.BreakAfter
    this.endLine()
    this.pos++
  }

  addLineStartIfNotCovered(attrs: Attrs | null) {
    if (!this.blockPosCovered()) this.addLineStart(attrs)
  }

  ensureLine(attrs: Attrs | null) {
    if (!this.curLine) this.addLineStart(attrs)
  }

  ensureMarks(marks: MarkDecoration[], openStart: number) {
    let parent: CompositeTile | null = this.curLine!
    for (let i = marks.length - 1; i >= 0; i--) {
      let mark = marks[i], last
      if (openStart > 0 && (last = parent.lastChild) && last instanceof MarkTile && last.mark.eq(mark)) {
        parent = last
        openStart--
      } else {
        let tile = MarkTile.of(mark, this.cache.find(MarkTile, m => m.mark.eq(mark))?.dom)
        parent.append(tile)
        parent = tile
        openStart = 0
      }
    }
    return parent
  }

  endLine() {
    if (this.curLine) {
      this.flushBuffer()
      let last = this.curLine.lastChild
      if (!last || !hasContent(this.curLine, false) ||
          last.dom.nodeName != "BR" && last.isWidget() && !(browser.ios && hasContent(this.curLine, true)))
        this.curLine.append(this.cache.findWidget(BreakWidget, 0, TileFlag.After) ||
                            new WidgetTile(BreakWidget.toDOM(), 0, BreakWidget, TileFlag.After))
      this.curLine = this.afterWidget = null
    }
  }

  updateBlockWrappers() {
    if (this.wrapperPos > this.pos + C.WrapperReset) {
      this.blockWrappers.goto(this.pos)
      this.wrappers.length = 0
    }
    for (let i = this.wrappers.length - 1 ; i >= 0; i--)
      if (this.wrappers[i].to < this.pos) this.wrappers.splice(i, 1)
    for (let cur = this.blockWrappers; cur.value && cur.from <= this.pos; cur.next()) if (cur.to >= this.pos) {
      let rank = (cur.rank * 102) + cur.value.rank
      let wrap = new OpenWrapper(cur.from, cur.to, cur.value, rank), i = this.wrappers.length
      while (i > 0 && (this.wrappers[i - 1].rank - wrap.rank || this.wrappers[i - 1].to - wrap.to) < 0) i--
      this.wrappers.splice(i, 0, wrap)
    }
    this.wrapperPos = this.pos
  }

  getBlockPos() {
    this.updateBlockWrappers()
    let parent: CompositeTile = this.root
    for (let wrap of this.wrappers) {
      let last = parent.lastChild
      if (wrap.from < this.pos && last instanceof BlockWrapperTile && last.wrapper.eq(wrap.wrapper)) {
        parent = last
      } else {
        let tile = BlockWrapperTile.of(wrap.wrapper, this.cache.find(BlockWrapperTile, t => t.wrapper.eq(wrap.wrapper))?.dom)
        parent.append(tile)
        parent = tile
      }
    }
    return parent
  }

  blockPosCovered() {
    let last = this.lastBlock
    return last != null && !last.breakAfter && (!last.isWidget() || (last.flags & (TileFlag.After | TileFlag.IncEnd)) > 0)
  }

  getBuffer(side: -1 | 1) {
    let flags = TileFlag.Synced | (side < 0 ? TileFlag.Before : TileFlag.After)
    let found = this.cache.find(WidgetBufferTile, undefined, Reused.Full)
    if (found) found.flags = flags
    return found || new WidgetBufferTile(flags)
  }

  flushBuffer() {
    if (this.afterWidget && !(this.afterWidget.flags & TileFlag.After)) {
      this.afterWidget.parent!.append(this.getBuffer(-1))
      this.afterWidget = null
    }
  }
}

// Helps getting efficient access to the document text.
class TextStream {
  cursor: TextIterator
  skipCount = 0
  text = ""
  textOff = 0

  constructor(doc: DocText) {
    this.cursor = doc.iter()
  }

  skip(len: number) {
    // Advance the iterator past the replaced content
    if (this.textOff + len <= this.text.length) {
      this.textOff += len
    } else {
      this.skipCount += len - (this.text.length - this.textOff)
      this.text = ""
      this.textOff = 0
    }
  }

  next(maxLen: number): null | string { // Null indicates a line break
    if (this.textOff == this.text.length) {
      let {value, lineBreak, done} = this.cursor.next(this.skipCount)
      this.skipCount = 0
      if (done) throw new Error("Ran out of text content when drawing inline views")
      this.text = value
      let len = this.textOff = Math.min(maxLen, value.length)
      return lineBreak ? null : value.slice(0, len)
    }
    let end = Math.min(this.text.length, this.textOff + maxLen)
    let chars = this.text.slice(this.textOff, end)
    this.textOff = end
    return chars
  }
}

// Assign the tile classes bucket numbers for caching.
const buckets = [WidgetTile, LineTile, TextTile, MarkTile, WidgetBufferTile, BlockWrapperTile, DocTile]
for (let i = 0; i < buckets.length; i++) (buckets[i] as any).bucket = i

// Leaf tiles and line tiles may be reused in their entirety. All
// others will get new tiles allocated, using the old DOM when
// possible.
class TileCache {
  // Buckets are circular buffers, using `index` as the current
  // position.
  buckets: Tile[][] = buckets.map(() => [])
  index: number[] = buckets.map(() => 0)
  reused: Map<Tile, Reused> = new Map

  constructor(readonly view: EditorView) {}

  // Put a tile in the cache.
  add(tile: Tile) {
    let i: number = (tile.constructor as any).bucket, bucket = this.buckets[i]
    if (bucket.length < C.Bucket) bucket.push(tile)
    else bucket[this.index[i] = (this.index[i] + 1) % C.Bucket] = tile
  }

  find<Cls extends Tile>(cls: new (...args: any) => Cls, test?: (a: Cls) => boolean, type: Reused = Reused.DOM): Cls | null {
    let i: number = (cls as any).bucket
    let bucket = this.buckets[i], off = this.index[i]
    for (let j = 0; j < bucket.length; j++) {
      // Look at the most oldest items first (first-in, first-out)
      let index = (j + off) % bucket.length, tile = bucket[index] as Cls
      if ((!test || test(tile)) && !this.reused.has(tile)) {
        bucket.splice(index, 1)
        if (index < off) this.index[i]--
        this.reused.set(tile, type)
        return tile
      }
    }
    return null
  }

  findWidget(widget: WidgetType, length: number, flags: TileFlag) {
    let widgets = this.buckets[0] as WidgetTile[]
    if (widgets.length) for (let i = 0, pass = 0;; i++) {
      if (i == widgets.length) {
        if (pass) return null
        pass = 1; i = 0
      }
      let tile = widgets[i]
      if (!this.reused.has(tile) &&
          (pass == 0 ? tile.widget.compare(widget)
            : tile.widget.constructor == widget.constructor && widget.updateDOM(tile.dom, this.view, tile.widget))) {
        widgets.splice(i, 1)
        if (i < this.index[0]) this.index[0]--
        if (tile.widget == widget && tile.length == length && (tile.flags & (TileFlag.Widget | TileFlag.BreakAfter)) == flags) {
          this.reused.set(tile, Reused.Full)
          return tile
        } else {
          this.reused.set(tile, Reused.DOM)
          return new WidgetTile(tile.dom, length, widget, (tile.flags & ~(TileFlag.Widget | TileFlag.BreakAfter)) | flags)
        }
      }
    }
  }

  reuse<T extends Tile>(tile: T) {
    this.reused.set(tile, Reused.Full)
    return tile
  }

  maybeReuse<T extends Tile>(tile: T, type: Reused = Reused.DOM): T["dom"] | undefined {
    if (this.reused.has(tile)) return undefined
    this.reused.set(tile, type)
    return tile.dom
  }

  clear() {
    for (let i = 0; i < this.buckets.length; i++)
      this.buckets[i].length = this.index[i] = 0
  }
}

// This class organizes a pass over the document, guided by the array
// of replaced ranges. For ranges that haven't changed, it iterates
// the old tree and copies its content into the new document. For
// changed ranges, it runs a decoration iterator to guide generation
// of content.
export class TileUpdate {
  text: TextStream
  builder: TileBuilder
  old: TilePointer
  openWidget = false
  openMarks = 0
  cache: TileCache
  reuseWalker: TileWalker

  constructor(
    readonly view: EditorView,
    old: DocTile,
    blockWrappers: readonly RangeSet<BlockWrapper>[],
    readonly decorations: readonly DecorationSet[],
    readonly disallowBlockEffectsFor: boolean[]
  ) {
    this.cache = new TileCache(view)
    this.text = new TextStream(view.state.doc)
    this.builder = new TileBuilder(this.cache, new DocTile(view, view.contentDOM), RangeSet.iter(blockWrappers))
    this.cache.reused.set(old, Reused.DOM)
    this.old = new TilePointer(old)
    this.reuseWalker = {
      skip: (tile, from, to) => {
        this.cache.add(tile)
        if (tile.isComposite()) return false
      },
      enter: tile => this.cache.add(tile),
      leave: () => {},
      break: () => {}
    }
  }

  run(changes: readonly ChangedRange[], composition: Composition | null) {
    LOG_builder && console.log("Build with changes", JSON.stringify(changes))
    LOG_builder && composition && console.log("Composition=", JSON.stringify(composition.range), composition.text.nodeValue)
    LOG_builder && console.log("<<< " + this.old.tile)
    let compositionContext = composition && this.getCompositionContext(composition.text)

    for (let posA = 0, posB = 0, i = 0;;) {
      let next = i < changes.length ? changes[i++] : null
      let skipA = next ? next.fromA : this.old.root.length
      if (skipA > posA) {
        LOG_builder && console.log("Preserve", posA, "to", skipA)
        let len = skipA - posA
        this.preserve(len, !i, !next)
        posA = skipA
        posB += len
      }
      if (!next) break
      // Compositions need to be handled specially, forcing the
      // focused text node and its parent nodes to remain stable at
      // that point in the document.
      if (composition && next.fromA <= composition.range.fromA && next.toA >= composition.range.toA) {
        LOG_builder && console.log("Emit composition", posB, "to", next.toB, "over", posA, "to", next.toA)
        this.forward(next.fromA, composition.range.fromA, composition.range.fromA < composition.range.toA ? 1 : -1)
        this.emit(posB, composition.range.fromB)
        this.builder.flushBuffer()
        this.cache.clear() // Must not reuse DOM across composition
        this.builder.addComposition(composition, compositionContext!)
        this.text.skip(composition.range.toB - composition.range.fromB)
        this.forward(composition.range.fromA, next.toA)
        this.emit(composition.range.toB, next.toB)
      } else {
        LOG_builder && console.log("Emit", posB, "to", next.toB, "over", posA, "to", next.toA)
        this.forward(next.fromA, next.toA)
        this.emit(posB, next.toB)
      }
      posB = next.toB
      posA = next.toA
    }
    if (this.builder.curLine) this.builder.endLine()
    LOG_builder && console.log(">>> " + this.builder.root)
    return this.builder.root
  }

  preserve(length: number, incStart: boolean, incEnd: boolean) {
    let activeMarks = getMarks(this.old), openMarks = this.openMarks

    this.old.advance(length, incEnd ? 1 : -1, {
      skip: (tile, from, to) => {
        if (tile.isWidget()) {
          if (this.openWidget) {
            this.builder.continueWidget(to - from)
          } else {
            let widget = to > 0 || from < tile.length
              ? WidgetTile.of(tile.widget, this.view, to - from, tile.flags & TileFlag.Widget, this.cache.maybeReuse(tile))
              : this.cache.reuse(tile)
            if (widget.flags & TileFlag.Block) {
              widget.flags &= ~TileFlag.BreakAfter
              this.builder.addBlockWidget(widget)
            } else {
              this.builder.ensureLine(null)
              this.builder.addInlineWidget(widget, activeMarks, openMarks)
              openMarks = activeMarks.length
            }
          }
        } else if (tile.isText()) {
          this.builder.ensureLine(null)
          if (!from && to == tile.length && !this.cache.reused.has(tile)) {
            this.builder.addText(tile.text, activeMarks, openMarks, this.cache.reuse(tile))
          } else {
            this.cache.add(tile)
            this.builder.addText(tile.text.slice(from, to), activeMarks, openMarks)
          }
          openMarks = activeMarks.length
        } else if (tile.isLine()) {
          tile.flags &= ~TileFlag.BreakAfter
          this.cache.reused.set(tile, Reused.Full)
          this.builder.addLine(tile)
        } else if (tile instanceof WidgetBufferTile) {
          this.cache.add(tile)
        } else if (tile instanceof MarkTile) {
          this.builder.ensureLine(null)
          this.builder.addMark(tile, activeMarks, openMarks)
          this.cache.reused.set(tile, Reused.Full)
          openMarks = activeMarks.length
        } else {
          return false
        }
        this.openWidget = false
      },
      enter: (tile) => {
        if (tile.isLine()) {
          this.builder.addLineStart(tile.attrs, this.cache.maybeReuse(tile))
        } else {
          this.cache.add(tile)
          if (tile instanceof MarkTile) activeMarks.unshift(tile.mark)
        }
        this.openWidget = false
      },
      leave: (tile) => {
        if (tile.isLine()) {
          if (activeMarks.length) activeMarks.length = openMarks = 0
        } else if (tile instanceof MarkTile) {
          activeMarks.shift()
          openMarks = Math.min(openMarks, activeMarks.length)
        }
      },
      break: () => {
        this.builder.addBreak()
        this.openWidget = false
      },
    })
    this.text.skip(length)
  }

  emit(from: number, to: number) {
    let pendingLineAttrs: Attrs | null = null
    let b = this.builder, markCount = -1

    let openEnd = RangeSet.spans(this.decorations, from, to, {
      point: (from, to, deco, active: MarkDecoration[], openStart, index) => {
        if (deco instanceof PointDecoration) {
          if (this.disallowBlockEffectsFor[index]) {
            if (deco.block)
              throw new RangeError("Block decorations may not be specified via plugins")
            if (to > this.view.state.doc.lineAt(from).to)
              throw new RangeError("Decorations that replace line breaks may not be specified via plugins")
          }
          markCount = active.length
          if (openStart > active.length) {
            b.continueWidget(to - from)
          } else {
            let widget = deco.widget || (deco.block ? NullWidget.block : NullWidget.inline)
            let flags = widgetFlags(deco)
            let tile = this.cache.findWidget(widget, to - from, flags) || WidgetTile.of(widget, this.view, to - from, flags)
            if (deco.block) {
              if (deco.startSide > 0) b.addLineStartIfNotCovered(pendingLineAttrs)
              b.addBlockWidget(tile)
            } else {
              b.ensureLine(pendingLineAttrs)
              b.addInlineWidget(tile, active, openStart)
            }
          }
          pendingLineAttrs = null
        } else {
          pendingLineAttrs = addLineDeco(pendingLineAttrs, deco)
        }

        if (to > from) this.text.skip(to - from)
      },
      span: (from, to, active: MarkDecoration[], openStart) => {
        for (let pos = from; pos < to;) {
          let chars = this.text.next(Math.min(C.Chunk, to - pos))
          if (chars == null) { // Line break
            b.addLineStartIfNotCovered(pendingLineAttrs)
            b.addBreak()
            pos++
          } else {
            b.ensureLine(pendingLineAttrs)
            b.addText(chars, active, pos == from ? openStart : active.length)
            pos += chars.length
          }
          pendingLineAttrs = null
        }
        markCount = active.length
      }
    })
    if (markCount > -1) this.openWidget = openEnd > markCount
    if (!this.openWidget) b.addLineStartIfNotCovered(pendingLineAttrs)
    this.openMarks = openEnd
  }

  forward(from: number, to: number, side: -1 | 1 = 1) {
    if (to - from <= 10) {
      this.old.advance(to - from, side, this.reuseWalker)
    } else {
      this.old.advance(5, -1, this.reuseWalker)
      this.old.advance(to - from - 10, -1)
      this.old.advance(5, side, this.reuseWalker)
    }
  }

  getCompositionContext(text: Text) {
    let marks: MarkTile[] = [], line: LineTile | null = null
    for (let parent = text.parentNode as HTMLElement;; parent = parent.parentNode as HTMLElement) {
      let tile = Tile.get(parent)
      if (parent == this.view.contentDOM) break
      if (tile instanceof MarkTile)
        marks.push(tile)
      else if (tile?.isLine())
        line = tile
      else if (tile instanceof BlockWrapperTile)
        {} // Ignore
      else if (parent.nodeName == "DIV" && !line && parent != this.view.contentDOM)
        line = new LineTile(parent, lineBaseAttrs)
      else if (!line)
        marks.push(MarkTile.of(new MarkDecoration({tagName: parent.nodeName.toLowerCase(), attributes: getAttrs(parent)}), parent))
    }
    return {line: line!, marks}
  }
}

function hasContent(tile: Tile, requireText: boolean) {
  let scan = (tile: Tile) => {
    for (let ch of tile.children)
      if ((requireText ? ch.isText() : ch.length) || scan(ch)) return true
    return false
  }
  return scan(tile)
}

function widgetFlags(deco: PointDecoration) {
  let flags = deco.isReplace ? (deco.startSide < 0 ? TileFlag.IncStart : 0) | (deco.endSide > 0 ? TileFlag.IncEnd : 0)
    : (deco.startSide > 0 ? TileFlag.After : TileFlag.Before)
  if (deco.block) flags |= TileFlag.Block
  return flags
}

const lineBaseAttrs: Attrs = {class: "cm-line"}

function addLineDeco(value: Attrs | null, deco: LineDecoration) {
  let attrs = deco.spec.attributes, cls = deco.spec.class
  if (!attrs && !cls) return value
  if (!value) value = {class: "cm-line"}
  if (attrs) combineAttrs(attrs, value)
  if (cls) value.class += " " + cls
  return value
}

function getMarks(ptr: TilePointer) {
  let found: MarkDecoration[] = []
  for (let i = ptr.parents.length; i > 1; i--) {
    let tile = i == ptr.parents.length ? ptr.tile : ptr.parents[i].tile
    if (tile instanceof MarkTile) found.push(tile.mark)
  }
  return found
}

function freeNode<N extends HTMLElement | Text>(node: N): N {
  let tile = Tile.get(node)
  if (tile) tile.setDOM(node.cloneNode() as any)
  return node
}

class NullWidget extends WidgetType {
  constructor(readonly tag: string) { super() }
  eq(other: NullWidget) { return other.tag == this.tag }
  toDOM() { return document.createElement(this.tag) }
  updateDOM(elt: HTMLElement) { return elt.nodeName.toLowerCase() == this.tag }
  get isHidden() { return true }
  static inline = new NullWidget("span")
  static block = new NullWidget("div")
}

const BreakWidget = new class extends WidgetType {
  toDOM() { return document.createElement("br") }
  get isHidden() { return true }
  get editable() { return true }
}
