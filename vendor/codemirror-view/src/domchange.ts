import {EditorView} from "./editorview"
import {inputHandler, editable, atomicRanges} from "./extension"
import {contains, dispatchKey} from "./dom"
import browser from "./browser"
import {DOMReader, DOMPoint, LineBreakPlaceholder} from "./domreader"
import {findCompositionNode} from "./docview"
import {EditorSelection, SelectionRange, Text, Transaction, TransactionSpec} from "@codemirror/state"
import {skipAtomsForSelection, skipAtomicRanges} from "./cursor"
import {Tile} from "./tile"

export class DOMChange {
  bounds: {
    startDOM: Node | null,
    endDOM: Node | null,
    from: number,
    to: number
  } | null = null
  text: string = ""
  newSel: EditorSelection | null
  domChanged: boolean

  constructor(view: EditorView, start: number, end: number, readonly typeOver: boolean) {
    this.domChanged = start > -1
    let {impreciseHead: iHead, impreciseAnchor: iAnchor} = view.docView, curSel = view.state.selection
    if (view.state.readOnly && start > -1) {
      // Ignore changes when the editor is read-only
      this.newSel = null
    } else if (start > -1 && (this.bounds = domBoundsAround(view.docView.tile, start, end, 0))) {
      let selPoints = iHead || iAnchor ? [] : selectionPoints(view)
      let reader = new DOMReader(selPoints, view)
      reader.readRange(this.bounds.startDOM, this.bounds.endDOM)
      this.text = reader.text
      this.newSel = selectionFromPoints(selPoints, this.bounds.from)
    } else {
      let domSel = view.observer.selectionRange
      let head = iHead && iHead.node == domSel.focusNode && iHead.offset == domSel.focusOffset ||
        !contains(view.contentDOM, domSel.focusNode)
        ? curSel.main.head
        : view.docView.posFromDOM(domSel.focusNode!, domSel.focusOffset)
      let anchor = iAnchor && iAnchor.node == domSel.anchorNode && iAnchor.offset == domSel.anchorOffset ||
        !contains(view.contentDOM, domSel.anchorNode)
        ? curSel.main.anchor
        : view.docView.posFromDOM(domSel.anchorNode!, domSel.anchorOffset)
      // iOS will refuse to select the block gaps when doing
      // select-all.
      // Chrome will put the selection *inside* them, confusing
      // posFromDOM
      let vp = view.viewport
      if ((browser.ios || browser.chrome) && head != anchor &&
          Math.min(head, anchor) <= curSel.main.from && Math.max(head, anchor) >= curSel.main.to &&
          (vp.from > 0 || vp.to < view.state.doc.length)) {
        let from = Math.min(head, anchor), to = Math.max(head, anchor)
        let offFrom = vp.from - from, offTo = vp.to - to
        if ((offFrom == 0 || offFrom == 1 || from == 0) && (offTo == 0 || offTo == -1 || to == view.state.doc.length)) {
          head = 0
          anchor = view.state.doc.length
        }
      }
      if (view.inputState.composing > -1 && curSel.ranges.length > 1) {
        this.newSel = curSel.replaceRange(EditorSelection.range(anchor, head))
      } else if (view.lineWrapping && anchor == head && !(curSel.main.empty && curSel.main.head == head) &&
                 view.inputState.lastTouchTime > Date.now() - 100) {
        // If this is a cursor selection change in a line-wrapping
        // editor that may have been a touch, use the last touch
        // position to assign a side to the cursor.
        let before = view.coordsAtPos(head, -1), assoc = 0
        if (before) assoc = view.inputState.lastTouchY <= before.bottom ? -1 : 1
        this.newSel = EditorSelection.create([EditorSelection.cursor(head, assoc)])
      } else {
        this.newSel = EditorSelection.single(anchor, head)
      }
    }
  }
}

function domBoundsAround(tile: Tile, from: number, to: number, offset: number): {
  startDOM: Node | null,
  endDOM: Node | null,
  from: number,
  to: number
} | null {
  if (tile.isComposite()) {
    let fromI = -1, fromStart = -1, toI = -1, toEnd = -1
    for (let i = 0, pos = offset, prevEnd = offset; i < tile.children.length; i++) {
      let child = tile.children[i], end = pos + child.length
      if (pos < from && end > to) return domBoundsAround(child, from, to, pos)
      if (end >= from && fromI == -1) {
        fromI = i
        fromStart = pos
      }
      if (pos > to && child.dom!.parentNode == tile.dom) {
        toI = i
        toEnd = prevEnd
        break
      }
      prevEnd = end
      pos = end + child.breakAfter
    }
    return {from: fromStart, to: toEnd < 0 ? offset + tile.length : toEnd,
            startDOM: (fromI ? tile.children[fromI - 1].dom.nextSibling : null) || tile.dom.firstChild,
            endDOM: toI < tile.children.length && toI >= 0 ? tile.children[toI].dom : null}
  } else if (tile.isText()) {
    return {from: offset, to: offset + tile.length, startDOM: tile.dom, endDOM: tile.dom.nextSibling}
  } else {
    return null
  }
}

export function applyDOMChange(view: EditorView, domChange: DOMChange): boolean {
  let change: undefined | {from: number, to: number, insert: Text}
  let {newSel} = domChange, {state} = view, sel = state.selection.main
  let lastKey = view.inputState.lastKeyTime > Date.now() - 100 ? view.inputState.lastKeyCode : -1
  if (domChange.bounds) {
    let {from, to} = domChange.bounds
    let preferredPos = sel.from, preferredSide = null
    // Prefer anchoring to end when Backspace is pressed (or, on
    // Android, when something was deleted)
    if (lastKey === 8 || browser.android && domChange.text.length < to - from) {
      preferredPos = sel.to
      preferredSide = "end"
    }
    let cmp = state.doc.sliceString(from, to, LineBreakPlaceholder), selEnd, diff
    if (!sel.empty && sel.from >= from && sel.to <= to && (domChange.typeOver || cmp != domChange.text) &&
        cmp.slice(0, sel.from - from) == domChange.text.slice(0, sel.from - from) &&
        cmp.slice(sel.to - from) == domChange.text.slice(selEnd = domChange.text.length - (cmp.length - (sel.to - from)))) {
      // This looks like a selection replacement
      change = {from: sel.from, to: sel.to,
                insert: Text.of(domChange.text.slice(sel.from - from, selEnd).split(LineBreakPlaceholder))}
    } else if (diff = findDiff(cmp, domChange.text, preferredPos - from, preferredSide)) {
      // Chrome inserts two newlines when pressing shift-enter at the
      // end of a line. DomChange drops one of those.
      if (browser.chrome && lastKey == 13 &&
          diff.toB == diff.from + 2 && domChange.text.slice(diff.from, diff.toB) == LineBreakPlaceholder + LineBreakPlaceholder)
        diff.toB--

      change = {from: from + diff.from, to: from + diff.toA,
                insert: Text.of(domChange.text.slice(diff.from, diff.toB).split(LineBreakPlaceholder))}
    }
  } else if (newSel && (!view.hasFocus && state.facet(editable) || sameSelPos(newSel, sel))) {
    newSel = null
  }

  if (!change && !newSel) return false

  if ((browser.mac || browser.android) && change && change.from == change.to && change.from == sel.head - 1 &&
             /^\. ?$/.test(change.insert.toString()) && view.contentDOM.getAttribute("autocorrect") == "off") {
    // Detect insert-period-on-double-space Mac and Android behavior,
    // and transform it into a regular space insert.
    if (newSel && change.insert.length == 2) newSel = EditorSelection.single(newSel.main.anchor - 1, newSel.main.head - 1)
    change = {from: change.from, to: change.to, insert: Text.of([change.insert.toString().replace(".", " ")])}
  } else if (state.doc.lineAt(sel.from).to < sel.to && view.docView.lineHasWidget(sel.to) &&
             view.inputState.insertingTextAt > Date.now() - 50) {
    // For a cross-line insertion, Chrome and Safari will crudely take
    // the text of the line after the selection, flattening any
    // widgets, and move it into the joined line. This tries to detect
    // such a situation, and replaces the change with a selection
    // replace of the text provided by the beforeinput event.
    change = {
      from: sel.from, to: sel.to,
      insert: state.toText(view.inputState.insertingText)
    }
  } else if (browser.chrome && change && change.from == change.to && change.from == sel.head &&
             change.insert.toString() == "\n " && view.lineWrapping) {
    // In Chrome, if you insert a space at the start of a wrapped
    // line, it will actually insert a newline and a space, causing a
    // bogus new line to be created in CodeMirror (#968)
    if (newSel) newSel = EditorSelection.single(newSel.main.anchor - 1, newSel.main.head - 1)
    change = {from: sel.from, to: sel.to, insert: Text.of([" "])}
  }

  if (change) {
    return applyDOMChangeInner(view, change, newSel, lastKey)
  } else if (newSel && !sameSelPos(newSel, sel)) {
    let scrollIntoView = false, userEvent = "select"
    if (view.inputState.lastSelectionTime > Date.now() - 50) {
      if (view.inputState.lastSelectionOrigin == "select") scrollIntoView = true
      userEvent = view.inputState.lastSelectionOrigin!
      if (userEvent == "select.pointer")
        newSel = skipAtomsForSelection(state.facet(atomicRanges).map(f => f(view)), newSel)
    }
    view.dispatch({selection: newSel, scrollIntoView, userEvent})
    return true
  } else {
    return false
  }
}

export function applyDOMChangeInner(
  view: EditorView,
  change: {from: number, to: number, insert: Text},
  newSel: EditorSelection | null,
  lastKey: number = -1
): boolean {
  if (browser.ios && view.inputState.flushIOSKey(change)) return true
  let sel = view.state.selection.main
  // Android browsers don't fire reasonable key events for enter,
  // backspace, or delete. So this detects changes that look like
  // they're caused by those keys, and reinterprets them as key
  // events. (Some of these keys are also handled by beforeinput
  // events and the pendingAndroidKey mechanism, but that's not
  // reliable in all situations.)
  if (browser.android &&
      ((change.to == sel.to &&
        // GBoard will sometimes remove a space it just inserted
        // after a completion when you press enter
        (change.from == sel.from || change.from == sel.from - 1 && view.state.sliceDoc(change.from, sel.from) == " ") &&
        change.insert.length == 1 && change.insert.lines == 2 &&
        dispatchKey(view.contentDOM, "Enter", 13)) ||
      ((change.from == sel.from - 1 && change.to == sel.to && change.insert.length == 0 ||
        lastKey == 8 && change.insert.length < change.to - change.from && change.to > sel.head) &&
        dispatchKey(view.contentDOM, "Backspace", 8)) ||
      (change.from == sel.from && change.to == sel.to + 1 && change.insert.length == 0 &&
        dispatchKey(view.contentDOM, "Delete", 46))))
    return true

  let text = change.insert.toString()
  if (view.inputState.composing >= 0) view.inputState.composing++

  let defaultTr: Transaction | null
  let defaultInsert = () => defaultTr || (defaultTr = applyDefaultInsert(view, change!, newSel))
  if (!view.state.facet(inputHandler).some(h => h(view, change!.from, change!.to, text, defaultInsert)))
    view.dispatch(defaultInsert())
  return true
}

function applyDefaultInsert(view: EditorView, change: {from: number, to: number, insert: Text},
                            newSel: EditorSelection | null): Transaction {
  let tr: TransactionSpec, startState = view.state, sel = startState.selection.main, inAtomic = -1
  if (change.from == change.to && change.from < sel.from || change.from > sel.to) {
    let side: -1 | 1 = change.from < sel.from ? -1 : 1, pos = side < 0 ? sel.from : sel.to
    let moved = skipAtomicRanges(startState.facet(atomicRanges).map(f => f(view)), pos, side)
    if (change.from == moved) inAtomic = moved
  }
  if (inAtomic > -1) {
    tr = {
      changes: change,
      selection: EditorSelection.cursor(change.from + change.insert.length, -1)
    }
  } else if (change.from >= sel.from && change.to <= sel.to && change.to - change.from >= (sel.to - sel.from) / 3 &&
             (!newSel || newSel.main.empty && newSel.main.from == change.from + change.insert.length) &&
             view.inputState.composing < 0) {
    let before = sel.from < change.from ? startState.sliceDoc(sel.from, change.from) : ""
    let after = sel.to > change.to ? startState.sliceDoc(change.to, sel.to) : ""
    tr = startState.replaceSelection(view.state.toText(
      before + change.insert.sliceString(0, undefined, view.state.lineBreak) + after))
  } else {
    let changes = startState.changes(change)
    let mainSel = newSel && newSel.main.to <= changes.newLength ? newSel.main : undefined
    // Try to apply a composition change to all cursors
    if (startState.selection.ranges.length > 1 && (view.inputState.composing >= 0 || view.inputState.compositionPendingChange) &&
        change.to <= sel.to + 10 && change.to >= sel.to - 10) {
      let replaced = view.state.sliceDoc(change.from, change.to)
      let compositionRange: {from: number, to: number}, composition = newSel && findCompositionNode(view, newSel.main.head)
      if (composition) {
        let dLen = change.insert.length - (change.to - change.from)
        compositionRange = {from: composition.from, to: composition.to - dLen}
      } else {
        compositionRange = view.state.doc.lineAt(sel.head)
      }
      let offset = sel.to - change.to
      tr = startState.changeByRange(range => {
        if (range.from == sel.from && range.to == sel.to)
          return {changes, range: mainSel || range.map(changes)}
        let to = range.to - offset, from = to - replaced.length
        if (view.state.sliceDoc(from, to) != replaced ||
            // Unfortunately, there's no way to make multiple
            // changes in the same node work without aborting
            // composition, so cursors in the composition range are
            // ignored.
            to >= compositionRange.from && from <= compositionRange.to)
          return {range}
        let rangeChanges = startState.changes({from, to, insert: change!.insert}), selOff = range.to - sel.to
        return {
          changes: rangeChanges,
          range: !mainSel ? range.map(rangeChanges) :
            EditorSelection.range(Math.max(0, mainSel.anchor + selOff), Math.max(0, mainSel.head + selOff))
        }
      })
    } else {
      tr = {
        changes,
        selection: mainSel && startState.selection.replaceRange(mainSel)
      }
    }
  }
  let userEvent = "input.type"
  if (view.composing ||
      view.inputState.compositionPendingChange && view.inputState.compositionEndedAt > Date.now() - 50) {
    view.inputState.compositionPendingChange = false
    userEvent += ".compose"
    if (view.inputState.compositionFirstChange) {
      userEvent += ".start"
      view.inputState.compositionFirstChange = false
    }
  }
  return startState.update(tr, {userEvent, scrollIntoView: true})
}

export function findDiff(a: string, b: string, preferredPos: number, preferredSide: string | null):
    {from: number, toA: number, toB: number} | null {
  let minLen = Math.min(a.length, b.length)
  let from = 0
  while (from < minLen && a.charCodeAt(from) == b.charCodeAt(from)) from++
  if (from == minLen && a.length == b.length) return null
  let toA = a.length, toB = b.length
  while (toA > 0 && toB > 0 && a.charCodeAt(toA - 1) == b.charCodeAt(toB - 1)) { toA--; toB-- }

  if (preferredSide == "end") {
    let adjust = Math.max(0, from - Math.min(toA, toB))
    preferredPos -= toA + adjust - from
  }
  if (toA < from && a.length < b.length) {
    let move = preferredPos <= from && preferredPos >= toA ? from - preferredPos : 0
    from -= move
    toB = from + (toB - toA)
    toA = from
  } else if (toB < from) {
    let move = preferredPos <= from && preferredPos >= toB ? from - preferredPos : 0
    from -= move
    toA = from + (toA - toB)
    toB = from
  }
  return {from, toA, toB}
}

function selectionPoints(view: EditorView) {
  let result: DOMPoint[] = []
  if (view.root.activeElement != view.contentDOM) return result
  let {anchorNode, anchorOffset, focusNode, focusOffset} = view.observer.selectionRange
  if (anchorNode) {
    result.push(new DOMPoint(anchorNode, anchorOffset))
    if (focusNode != anchorNode || focusOffset != anchorOffset)
      result.push(new DOMPoint(focusNode!, focusOffset))
  }
  return result
}

function selectionFromPoints(points: DOMPoint[], base: number): EditorSelection | null {
  if (points.length == 0) return null
  let anchor = points[0].pos, head = points.length == 2 ? points[1].pos : anchor
  return anchor > -1 && head > -1 ? EditorSelection.single(anchor + base, head + base) : null
}

export function sameSelPos(selection: EditorSelection, range: SelectionRange) {
  return range.head == selection.main.head && range.anchor == selection.main.anchor
}
