import {Tile} from "./tile"
import {domIndex, maxOffset, isBlockElement} from "./dom"
import {EditorView} from "./editorview"
import {EditorState} from "@codemirror/state"

export const LineBreakPlaceholder = "\uffff"

export class DOMReader {
  text: string = ""
  lineSeparator: string | undefined

  constructor(private points: DOMPoint[], private view: EditorView) {
    this.lineSeparator = view.state.facet(EditorState.lineSeparator)
  }

  append(text: string) {
    this.text += text
  }

  lineBreak() {
    this.text += LineBreakPlaceholder
  }

  readRange(start: Node | null, end: Node | null) {
    if (!start) return this
    let parent = start.parentNode!
    for (let cur = start;;) {
      this.findPointBefore(parent, cur)
      let oldLen = this.text.length
      this.readNode(cur)
      let tile = Tile.get(cur), next: Node | null = cur.nextSibling
      if (next == end) {
        if (tile?.breakAfter && !next && parent != this.view.contentDOM) this.lineBreak()
        break
      }
      let nextTile = Tile.get(next!)
      if ((tile && nextTile ? tile.breakAfter :
           (tile ? tile.breakAfter : isBlockElement(cur)) ||
           (isBlockElement(next!) && (cur.nodeName != "BR" || tile?.isWidget()) && this.text.length > oldLen)) &&
          !isEmptyToEnd(next, end))
        this.lineBreak()
      cur = next!
    }
    this.findPointBefore(parent, end)
    return this
  }

  readTextNode(node: Text) {
    let text = node.nodeValue!
    for (let point of this.points)
      if (point.node == node)
        point.pos = this.text.length + Math.min(point.offset, text.length)

    for (let off = 0, re = this.lineSeparator ? null : /\r\n?|\n/g;;) {
      let nextBreak = -1, breakSize = 1, m
      if (this.lineSeparator) {
        nextBreak = text.indexOf(this.lineSeparator, off)
        breakSize = this.lineSeparator.length
      } else if (m = re!.exec(text)) {
        nextBreak = m.index
        breakSize = m[0].length
      }
      this.append(text.slice(off, nextBreak < 0 ? text.length : nextBreak))
      if (nextBreak < 0) break
      this.lineBreak()
      if (breakSize > 1) for (let point of this.points)
        if (point.node == node && point.pos > this.text.length) point.pos -= breakSize - 1
      off = nextBreak + breakSize
    }
  }

  readNode(node: Node) {
    let tile = Tile.get(node)
    let fromView = tile && tile.overrideDOMText
    if (fromView != null) {
      this.findPointInside(node, fromView.length)
      for (let i = fromView.iter(); !i.next().done;) {
        if (i.lineBreak) this.lineBreak()
        else this.append(i.value)
      }
    } else if (node.nodeType == 3) {
      this.readTextNode(node as Text)
    } else if (node.nodeName == "BR") {
      if (node.nextSibling) this.lineBreak()
    } else if (node.nodeType == 1) {
      this.readRange(node.firstChild, null)
    }
  }

  findPointBefore(node: Node, next: Node | null) {
    for (let point of this.points)
      if (point.node == node && node.childNodes[point.offset] == next)
        point.pos = this.text.length
  }

  findPointInside(node: Node, length: number) {
    for (let point of this.points)
      if (node.nodeType == 3 ? point.node == node : node.contains(point.node))
        point.pos = this.text.length + (isAtEnd(node, point.node, point.offset) ? length : 0)
  }
}

function isAtEnd(parent: Node, node: Node | null, offset: number) {
  for (;;) {
    if (!node || offset < maxOffset(node)) return false
    if (node == parent) return true
    offset = domIndex(node) + 1
    node = node.parentNode
  }
}

function isEmptyToEnd(node: Node | null, end: Node | null) {
  let widgets: Tile[] | undefined
  for (;; node = node.nextSibling) {
    if (node == end || !node) break
    let view = Tile.get(node)
    if (!view?.isWidget()) return false
    if (view) (widgets || (widgets = [])).push(view)
  }
  if (widgets) for (let w of widgets) {
    let override = w.overrideDOMText
    if (override?.length) return false
  }
  return true
}

export class DOMPoint {
  pos: number = -1
  constructor(readonly node: Node, readonly offset: number) {}
}
