import {Text as DocText} from "@codemirror/state"
import {WidgetType, BlockWrapper, MarkDecoration} from "./decoration"
import {Attrs, setAttrs} from "./attributes"
import {type EditorView} from "./editorview"
import {Rect, textRange, maxOffset, domIndex, flattenRect, clientRectsFor, DOMPos} from "./dom"
import browser from "./browser"

// The editor view keeps a tree of 'tiles', objects that represent a
// DOM node with some meaning in the content model, to represent its
// visible content. These are double-linked to their DOM nodes via a
// `cmTile` expando property, so that lookup can happen both from tile
// tree to DOM, and from DOM node to tile position.
//
// This structure is used to map between document positions and DOM
// positions, to find screen coordinates for a position, and to
// support incrementally updating the DOM.

export const enum TileFlag {
  // Encodes that there's a line break (taking up one position) after this tile
  BreakAfter = 1,
  // Set when a tile's DOM has been synced
  Synced = 2,
  // Set when DOM mutations to the node's attributes were seen
  AttrsDirty = 4,
  // Set on composition text tiles to prevent text merging
  Composition = 8,

  // Widget flags
  Before = 16, // Single-point widget before cursor position
  After = 32,  // Single-point widget after cursor position
  PointWidget = Before | After,
  IncStart = 64, // For replace widgets, IncStart/IncEnd encode inclusivity
  IncEnd = 128,
  Block = 256, // Distinguishes block widgets from non-block widgets
  Widget = Before | After | IncStart | IncEnd | Block
}

const noChildren: readonly Tile[] = []

export abstract class Tile {
  parent: CompositeTile | null = null

  constructor(
    public dom: HTMLElement | Text,
    public length: number,
    public flags: TileFlag = 0 as TileFlag
  ) {
    ;(dom as any).cmTile = this
  }

  get breakAfter(): 0 | 1 { return (this.flags & TileFlag.BreakAfter) as 0 | 1 }

  get children() { return noChildren }

  isWidget(): this is WidgetTile { return false }

  get isHidden() { return false }

  isComposite(): this is CompositeTile { return false }

  isLine(): this is LineTile { return false }

  isText(): this is TextTile { return false }

  isBlock() { return false }

  get domAttrs(): Attrs | null { return null }

  sync(track?: {node: Node, written: boolean}) {
    this.flags |= TileFlag.Synced
    if (this.flags & TileFlag.AttrsDirty) {
      this.flags &= ~TileFlag.AttrsDirty
      let attrs = this.domAttrs
      if (attrs) setAttrs(this.dom as HTMLElement, attrs)
    }
  }

  toString() {
    return this.constructor.name + (this.children.length ? `(${this.children})` : "") + (this.breakAfter ? "#" : "")
  }

  destroy() { this.parent = null }

  setDOM(dom: this["dom"]) {
    this.dom = dom
    ;(dom as any).cmTile = this
  }

  get posAtStart(): number {
    return this.parent ? this.parent.posBefore(this) : 0
  }

  get posAtEnd(): number {
    return this.posAtStart + this.length
  }

  posBefore(tile: Tile, start = this.posAtStart): number {
    let pos = start
    for (let child of this.children) {
      if (child == tile) return pos
      pos += child.length + child.breakAfter
    }
    throw new RangeError("Invalid child in posBefore")
  }

  posAfter(tile: Tile): number {
    return this.posBefore(tile) + tile.length
  }

  covers(side: -1 | 1) { return true }

  coordsIn(pos: number, side: number, rtl?: boolean): Rect | null { return null }

  domPosFor(off: number, side: number) {
    let index = domIndex(this.dom)
    let after = this.length ? off > 0 : side > 0
    return new DOMPos(this.parent!.dom, index + (after ? 1 : 0), off == 0 || off == this.length)
  }

  markDirty(attrs: boolean) {
    this.flags &= ~TileFlag.Synced
    if (attrs) this.flags |= TileFlag.AttrsDirty
    if (this.parent && (this.parent.flags & TileFlag.Synced)) this.parent.markDirty(false)
  }

  get overrideDOMText(): DocText | null { return null }

  get root(): DocTile | null {
    for (let t: Tile | null = this; t; t = t.parent) if (t instanceof DocTile) return t
    return null
  }

  static get(dom: Node) {
    return (dom as any).cmTile as Tile | undefined
  }
}

export abstract class CompositeTile extends Tile {
  declare dom: HTMLElement
  _children: Tile[] = []

  constructor(dom: HTMLElement) {
    super(dom, 0)
  }

  isComposite(): this is CompositeTile { return true }

  get children() { return this._children }

  get lastChild() { return this.children.length ? this.children[this.children.length - 1] : null }

  append(child: Tile) {
    this.children.push(child)
    child.parent = this
  }

  sync(track?: {node: Node, written: boolean}) {
    if (this.flags & TileFlag.Synced) return
    super.sync(track)
    let parent = this.dom, prev: Node | null = null, next
    let tracking = track?.node == parent ? track : null
    let length = 0
    for (let child of this.children) {
      child.sync(track)
      length += child.length + child.breakAfter
      next = prev ? prev.nextSibling : parent.firstChild
      if (tracking && next != child.dom) tracking.written = true
      if (child.dom.parentNode == parent) {
        while (next && next != child.dom) next = rm(next)
      } else {
        parent.insertBefore(child.dom, next)
      }
      prev = child.dom
    }
    next = prev ? prev.nextSibling : parent.firstChild
    if (tracking && next) tracking.written = true
    while (next) next = rm(next)
    this.length = length
  }
}

// Remove a DOM node and return its next sibling.
function rm(dom: Node): Node | null {
  let next = dom.nextSibling
  dom.parentNode!.removeChild(dom)
  return next
}

// The top-level tile. Its dom property equals view.contentDOM.
export class DocTile extends CompositeTile {
  constructor(readonly view: EditorView, dom: HTMLElement) {
    super(dom)
  }

  owns(tile: Tile | null) {
    for (; tile; tile = tile.parent) if (tile == this) return true
    return false
  }

  isBlock() { return true }

  nearest(dom: Node | null): Tile | null {
    for (;;) {
      if (!dom) return null
      let tile = Tile.get(dom)
      if (tile && this.owns(tile)) return tile
      dom = dom.parentNode
    }
  }

  blockTiles<T>(f: (tile: WidgetTile | LineTile, pos: number) => T | undefined) {
    for (let stack: number[] = [], cur: CompositeTile = this, i = 0, pos = 0;;) {
      if (i == cur.children.length) {
        if (!stack.length) return
        cur = cur.parent!
        if (cur.breakAfter) pos++
        i = stack.pop()!
      } else {
        let next = cur.children[i++]
        if (next instanceof BlockWrapperTile) {
          stack.push(i)
          cur = next
          i = 0
        } else {
          let end = pos + next.length
          let result = f(next as WidgetTile | LineTile, pos)
          if (result !== undefined) return result
          pos = end + next.breakAfter
        }
      }
    }
  }

  // Find the block at the given position. If side < -1, make sure to
  // stay before block widgets at that position, if side > 1, after
  // such widgets (used for selection drawing, which needs to be able
  // to get coordinates for positions that aren't valid cursor positions).
  resolveBlock(pos: number, side: number): {tile: LineTile | WidgetTile, offset: number} {
    let before: LineTile | WidgetTile | undefined, beforeOff = -1, after: LineTile | WidgetTile | undefined, afterOff = -1
    this.blockTiles((tile, off) => {
      let end = off + tile.length
      if (pos >= off && pos <= end) {
        if (tile.isWidget() && side >= -1 && side <= 1) {
          if (tile.flags & TileFlag.After) return true
          if (tile.flags & TileFlag.Before) before = undefined
        }
        if ((off < pos || pos == end && (side < -1 ? tile.length : tile.covers(1))) &&
            (!before || !tile.isWidget() && before.isWidget())) {
          before = tile
          beforeOff = pos - off
        }
        if ((end > pos || pos == off && (side > 1 ? tile.length : tile.covers(-1))) &&
            (!after || !tile.isWidget() && after.isWidget())) {
          after = tile
          afterOff = pos - off
        }
      }
    })
    if (!before && !after) throw new Error("No tile at position " + pos)
    return before && side < 0 || !after ? {tile: before!, offset: beforeOff} : {tile: after, offset: afterOff}
  }
}

export class BlockWrapperTile extends CompositeTile {
  declare dom: HTMLElement
  constructor(dom: HTMLElement, readonly wrapper: BlockWrapper) {
    super(dom)
  }

  isBlock() { return true }

  covers(side: -1 | 1) {
    if (!this.children.length) return false
    return side < 0 ? this.children[0].covers(-1) : this.lastChild!.covers(1)
  }

  get domAttrs() { return this.wrapper.attributes }

  static of(wrapper: BlockWrapper, dom?: HTMLElement) {
    let tile = new BlockWrapperTile(dom || document.createElement(wrapper.tagName), wrapper)
    if (!dom) tile.flags |= TileFlag.AttrsDirty
    return tile
  }
}

export class LineTile extends CompositeTile {
  constructor(dom: HTMLElement, public attrs: Attrs) {
    super(dom)
  }

  isLine(): this is LineTile { return true }

  static start(attrs: Attrs, dom?: HTMLElement, keepAttrs?: boolean) {
    let line = new LineTile(dom || document.createElement("div"), attrs)
    if (!dom || !keepAttrs) line.flags |= TileFlag.AttrsDirty
    return line
  }

  get domAttrs() { return this.attrs }

  // Find the tile associated with a given position in this line.
  // Side -2/2 is handled specially, in that it allows the position
  // returned to be before (-2) or after (2) widgets that would always
  // be after/before a cursor position.
  resolveInline(pos: number, side: number, forCoords?: boolean): {
    tile: TextTile | WidgetTile | WidgetBufferTile,
    offset: number
  } | null {
    let before: Tile | null = null, beforeOff = -1, after: Tile | null = null, afterOff = -1
    function scan(tile: Tile, pos: number) {
      for (let i = 0, off = 0; i < tile.children.length && off <= pos; i++) {
        let child = tile.children[i], end = off + child.length
        if (end >= pos) {
          if (child.isComposite()) {
            scan(child, pos - off)
          } else if ((!after || after.isHidden && (
                      side > 0 && !(after.flags & TileFlag.After) || forCoords && onSameLine(after, child))) &&
                     (end > pos || (child.flags & TileFlag.After) && side <= 1)) {
            after = child
            afterOff = pos - off
          } else if (off < pos || (child.flags & TileFlag.Before) && !child.isHidden && side >= -1) {
            before = child
            beforeOff = pos - off
          }
        }
        off = end
      }
    }
    scan(this, pos)
    let target = ((side < 0 ? before : after) || before || after) as TextTile | WidgetTile | WidgetBufferTile | null
    return target ? {tile: target, offset: target == before ? beforeOff : afterOff} : null
  }

  coordsIn(pos: number, side: -1 | 1, rtl?: boolean): Rect | null {
    let found = this.resolveInline(pos, side, true)
    if (!found) return fallbackRect(this)
    return found.tile.coordsIn(Math.max(0, found.offset), side, rtl)
  }

  domIn(pos: number, side: number) {
    let found = this.resolveInline(pos, side)
    if (found) {
      let {tile, offset} = found
      if (this.dom.contains(tile.dom)) {
        if (tile.isText()) return new DOMPos(tile.dom, Math.min(tile.dom.nodeValue!.length, offset))
        return tile.domPosFor(offset, tile.flags & TileFlag.Before ? 1 : tile.flags & TileFlag.After ? -1 : side)
      }
      let parent = found.tile.parent!, saw = false, last: Tile | undefined
      for (let ch of parent.children) {
        if (saw) return new DOMPos(ch.dom, 0)
        if (ch == found.tile) {
          if (last) return new DOMPos(last.dom, maxOffset(last.dom))
          else saw = true
        }
      }
    }
    return new DOMPos(this.dom, 0)
  }
}

function fallbackRect(tile: Tile) {
  let last = tile.dom.lastChild
  if (!last) return (tile.dom as HTMLElement).getBoundingClientRect()
  let rects = clientRectsFor(last)
  return rects[rects.length - 1] || null
}

function onSameLine(a: Tile, b: Tile) {
  let posA = a.coordsIn(0, 1), posB = b.coordsIn(0, 1)
  return posA && posB && posB.top < posA.bottom
}

export class MarkTile extends CompositeTile {
  constructor(dom: HTMLElement, readonly mark: MarkDecoration) {
    super(dom)
  }

  get domAttrs() { return this.mark.attrs }

  static of(mark: MarkDecoration, dom?: HTMLElement) {
    let tile = new MarkTile(dom || document.createElement(mark.tagName), mark)
    if (!dom) tile.flags |= TileFlag.AttrsDirty
    return tile
  }
}

export class TextTile extends Tile {
  declare dom: Text
  constructor(dom: Text, readonly text: string) {
    super(dom, text.length)
  }

  sync(track?: {node: Node, written: boolean}) {
    if (this.flags & TileFlag.Synced) return
    super.sync(track)
    if (this.dom.nodeValue != this.text) {
      if (track && track.node == this.dom) track.written = true
      this.dom.nodeValue = this.text
    }
  }

  isText(): this is TextTile { return true }

  toString() { return JSON.stringify(this.text) }

  coordsIn(pos: number, side: number, rtl?: boolean) {
    let length = this.dom.nodeValue!.length
    if (pos > length) pos = length
    let from = pos, to = pos, flatten = 0
    if (pos == 0 && side < 0 || pos == length && side >= 0) {
      if (!(browser.chrome || browser.gecko)) { // These browsers reliably return valid rectangles for empty ranges
        if (pos) { from--; flatten = 1 }
        else if (to < length) { to++; flatten = -1 }
      }
    } else {
      if (side < 0) from--; else if (to < length) to++
    }
    let rects = textRange(this.dom, from, to).getClientRects()
    if (!rects.length) return null
    let rect = rects[(flatten ? flatten < 0 : side >= 0) ? 0 : rects.length - 1]
    if (browser.safari && !flatten && rect.width == 0) rect = Array.prototype.find.call(rects, r => r.width) || rect
    return rtl == null ? rect : flattenRect(rect, (flatten ? flatten > 0 : side < 0) == rtl)
  }

  static of(text: string, dom?: Text) {
    let tile = new TextTile(dom || document.createTextNode(text), text)
    if (!dom) tile.flags |= TileFlag.Synced
    return tile
  }
}

export class WidgetTile extends Tile {
  declare dom: HTMLElement

  constructor(dom: HTMLElement, length: number, readonly widget: WidgetType, flags: TileFlag) {
    super(dom, length, flags)
  }

  isWidget(): this is WidgetTile { return true }

  get isHidden() { return this.widget.isHidden }
  
  covers(side: -1 | 1) {
    if (this.flags & TileFlag.PointWidget) return false
    return (this.flags & (side < 0 ? TileFlag.IncStart : TileFlag.IncEnd)) > 0
  }

  coordsIn(pos: number, side: number) { return this.coordsInWidget(pos, side, false) }

  coordsInWidget(pos: number, side: number, block: boolean) {
    let custom = this.widget.coordsAt(this.dom, pos, side)
    if (custom) return custom
    if (block) {
      return flattenRect(this.dom.getBoundingClientRect(), this.length ? pos == 0 : side <= 0)
    } else {
      let rects = this.dom.getClientRects(), rect: Rect | null = null
      if (!rects.length) return null
      let fromBack = (this.flags & TileFlag.Before) ? true : (this.flags & TileFlag.After) ? false : pos > 0
      for (let i = fromBack ? rects.length - 1 : 0;; i += (fromBack ? -1 : 1)) {
        rect = rects[i]
        if (pos > 0 ? i == 0 : i == rects.length - 1 || rect.top < rect.bottom) break
      }
      return flattenRect(rect, !fromBack)
    }
  }

  get overrideDOMText() {
    if (!this.length) return DocText.empty
    let {root} = this
    if (!root) return DocText.empty
    let start = this.posAtStart
    return root.view.state.doc.slice(start, start + this.length)
  }

  destroy() {
    super.destroy()
    this.widget.destroy(this.dom)
  }

  static of(widget: WidgetType, view: EditorView, length: number, flags: TileFlag, dom?: HTMLElement | null) {
    if (!dom) {
      dom = widget.toDOM(view)
      if (!widget.editable) dom.contentEditable = "false"
    }
    return new WidgetTile(dom, length, widget, flags)
  }
}

// These are drawn around uneditable widgets to avoid a number of
// browser bugs that show up when the cursor is directly next to
// uneditable inline content.
export class WidgetBufferTile extends Tile {
  declare dom: HTMLElement

  constructor(flags: TileFlag) {
    let img = document.createElement("img")
    img.className = "cm-widgetBuffer"
    img.setAttribute("aria-hidden", "true")
    super(img, 0, flags)
  }

  get isHidden() { return true }

  get overrideDOMText() { return DocText.empty }

  coordsIn(pos: number, side: -1 | 1, rtl?: boolean): Rect | null {
    let rect = this.dom.getBoundingClientRect()
    return rtl == null ? rect : flattenRect(rect, (side > 0) == rtl)
  }
}

// Represents a position in the tile tree.
export class TilePointer {
  public tile: Tile
  public index: number = 0
  public beforeBreak: boolean = false
  readonly parents: {tile: CompositeTile, index: number}[] = []

  constructor(top: DocTile) {
    this.tile = top
  }

  // Advance by the given distance. If side is -1, stop leaving or
  // entering tiles, or skipping zero-length tiles, once the distance
  // has been traversed. When side is 1, leave, enter, or skip
  // everything at the end position.
  advance(dist: number, side: -1 | 1, walker?: TileWalker) {
    let {tile, index, beforeBreak, parents} = this
    while (dist || side > 0) {
      if (!tile.isComposite()) {
        let len = tile.length
        if (index < len && dist) {
          let take = Math.min(dist, len - index)
          if (walker) walker.skip(tile, index, index + take)
          dist -= take
          index += take
        }
        if (index == len) {
          beforeBreak = !!tile.breakAfter
          ;({tile, index} = parents.pop()!)
          index++
        } else if (!dist) {
          break
        }
      } else if (beforeBreak) {
        if (!dist) break
        if (walker) walker.break()
        dist--
        beforeBreak = false
      } else if (index == tile.children.length) {
        if (!dist && !parents.length) break
        if (walker) walker.leave(tile)
        beforeBreak = !!tile.breakAfter
        ;({tile, index} = parents.pop()!)
        index++
      } else {
        let next = tile.children[index], brk = next.breakAfter
        if ((side > 0 ? next.length <= dist : next.length < dist) &&
            (!walker || walker.skip(next, 0, next.length) !== false || !next.isComposite)) {
          beforeBreak = !!brk
          index++
          dist -= next.length
        } else {
          parents.push({tile, index})
          tile = next
          index = 0
          if (walker && next.isComposite()) walker.enter(next)
        }
      }
    }
    this.tile = tile
    this.index = index
    this.beforeBreak = beforeBreak
    return this
  }

  get root() { return (this.parents.length ? this.parents[0].tile : this.tile) as DocTile }
}

export interface TileWalker {
  enter(tile: CompositeTile): void
  leave(tile: CompositeTile): void
  skip(tile: Tile, from: number, to: number): boolean | void
  break(): void
}
