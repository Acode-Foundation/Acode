import {Extension, EditorSelection, EditorState, countColumn, findColumn} from "@codemirror/state"
import {EditorView} from "./editorview"
import {MouseSelectionStyle} from "./input"
import {ViewPlugin} from "./extension"

type Pos = {line: number, col: number, off: number}

// Don't compute precise column positions for line offsets above this
// (since it could get expensive). Assume offset==column for them.
const MaxOff = 2000

function rectangleFor(state: EditorState, a: Pos, b: Pos) {
  let startLine = Math.min(a.line, b.line), endLine = Math.max(a.line, b.line)
  let ranges = []
  if (a.off > MaxOff || b.off > MaxOff || a.col < 0 || b.col < 0) {
    let startOff = Math.min(a.off, b.off), endOff = Math.max(a.off, b.off)
    for (let i = startLine; i <= endLine; i++) {
      let line = state.doc.line(i)
      if (line.length <= endOff)
        ranges.push(EditorSelection.range(line.from + startOff, line.to + endOff))
    }
  } else {
    let startCol = Math.min(a.col, b.col), endCol = Math.max(a.col, b.col)
    for (let i = startLine; i <= endLine; i++) {
      let line = state.doc.line(i)
      let start = findColumn(line.text, startCol, state.tabSize, true)
      if (start < 0) {
        ranges.push(EditorSelection.cursor(line.to))
      } else {
        let end = findColumn(line.text, endCol, state.tabSize)
        ranges.push(EditorSelection.range(line.from + start, line.from + end))
      }
    }
  }
  return ranges
}

function absoluteColumn(view: EditorView, x: number) {
  let ref = view.coordsAtPos(view.viewport.from)
  return ref ? Math.round(Math.abs((ref.left - x) / view.defaultCharacterWidth)) : -1
}

function getPos(view: EditorView, event: MouseEvent) {
  let offset = view.posAtCoords({x: event.clientX, y: event.clientY}, false)
  let line = view.state.doc.lineAt(offset), off = offset - line.from
  let col = off > MaxOff ? -1
    : off == line.length ? absoluteColumn(view, event.clientX)
    : countColumn(line.text, view.state.tabSize, offset - line.from)
  return {line: line.number, col, off}
}

function rectangleSelectionStyle(view: EditorView, event: MouseEvent) {
  let start = getPos(view, event)!, startSel = view.state.selection
  if (!start) return null
  return {
    update(update) {
      if (update.docChanged) {
        let newStart = update.changes.mapPos(update.startState.doc.line(start.line).from)
        let newLine = update.state.doc.lineAt(newStart)
        start = {line: newLine.number, col: start.col, off: Math.min(start.off, newLine.length)}
        startSel = startSel.map(update.changes)
      }
    },
    get(event, _extend, multiple) {
      let cur = getPos(view, event)
      if (!cur) return startSel
      let ranges = rectangleFor(view.state, start, cur)
      if (!ranges.length) return startSel
      if (multiple) return EditorSelection.create(ranges.concat(startSel.ranges))
      else return EditorSelection.create(ranges)
    }
  } as MouseSelectionStyle
}

/// Create an extension that enables rectangular selections. By
/// default, it will react to left mouse drag with the Alt key held
/// down. When such a selection occurs, the text within the rectangle
/// that was dragged over will be selected, as one selection
/// [range](#state.SelectionRange) per line.
export function rectangularSelection(options?: {
  /// A custom predicate function, which takes a `mousedown` event and
  /// returns true if it should be used for rectangular selection.
  eventFilter?: (event: MouseEvent) => boolean
}): Extension {
  let filter = options?.eventFilter || (e => e.altKey && e.button == 0)
  return EditorView.mouseSelectionStyle.of((view, event) => filter(event) ? rectangleSelectionStyle(view, event) : null)
}

const keys: {[key: string]: [number, (event: KeyboardEvent | MouseEvent) => boolean]} = {
  Alt: [18, e => !!e.altKey],
  Control: [17, e => !!e.ctrlKey],
  Shift: [16, e => !!e.shiftKey],
  Meta: [91, e => !!e.metaKey]
}

const showCrosshair = {style: "cursor: crosshair"}

/// Returns an extension that turns the pointer cursor into a
/// crosshair when a given modifier key, defaulting to Alt, is held
/// down. Can serve as a visual hint that rectangular selection is
/// going to happen when paired with
/// [`rectangularSelection`](#view.rectangularSelection).
export function crosshairCursor(options: {
  key?: "Alt" | "Control" | "Shift" | "Meta"
} = {}): Extension {
  let [code, getter] = keys[options.key || "Alt"]
  let plugin = ViewPlugin.fromClass(class {
    isDown = false
    constructor(readonly view: EditorView) {}
    set(isDown: boolean) {
      if (this.isDown != isDown) {
        this.isDown = isDown
        this.view.update([])
      }
    }
  }, {
    eventObservers: {
      keydown(e) {
        this.set(e.keyCode == code || getter(e))
      },
      keyup(e) {
        if (e.keyCode == code || !getter(e)) this.set(false)
      },
      mousemove(e) {
        this.set(getter(e))
      }
    }
  })
  return [
    plugin,
    EditorView.contentAttributes.of(view => view.plugin(plugin)?.isDown ? showCrosshair : null)
  ]
}
