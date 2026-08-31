import browser from "./browser"
import {Tile} from "./tile"
import {EditorView} from "./editorview"
import {editable, ViewUpdate, setEditContextFormatting, MeasureRequest} from "./extension"
import {hasSelection, getSelection, DOMSelectionState, isEquivalentPosition, dispatchKey, atElementStart} from "./dom"
import {DOMChange, applyDOMChange, applyDOMChangeInner, findDiff, sameSelPos} from "./domchange"
import type {EditContext} from "./editcontext"
import {Decoration} from "./decoration"
import {Text, EditorSelection, EditorState} from "@codemirror/state"

const observeOptions = {
  childList: true,
  characterData: true,
  subtree: true,
  attributes: true,
  characterDataOldValue: true
}

// IE11 has very broken mutation observers, so we also listen to
// DOMCharacterDataModified there
const useCharData = browser.ie && browser.ie_version <= 11

/// @internal
export function isNativeScrollActivity(touchActive: boolean, lastTouchTime: number,
                                       lastWheelEvent: number, now: number) {
  return touchActive || lastTouchTime > now - 2000 || lastWheelEvent > now - 200
}

export class DOMObserver {
  dom: HTMLElement
  win: Window

  observer: MutationObserver
  active: boolean = false

  editContext: EditContextManager | null = null

  // The known selection. Kept in our own object, as opposed to just
  // directly accessing the selection because:
  //  - Safari doesn't report the right selection in shadow DOM
  //  - Reading from the selection forces a DOM layout
  //  - This way, we can ignore selectionchange events if we have
  //    already seen the 'new' selection
  selectionRange: DOMSelectionState = new DOMSelectionState
  // Set when a selection change is detected, cleared on flush
  selectionChanged = false

  delayedFlush = -1
  resizeTimeout = -1
  queue: MutationRecord[] = []
  delayedAndroidKey: {key: string, keyCode: number, force: boolean} | null = null
  flushingAndroidKey = -1
  lastChange = 0

  onCharData: any

  scrollTargets: HTMLElement[] = []
  intersection: IntersectionObserver | null = null
  resizeScroll: ResizeObserver | null = null
  intersecting: boolean = false
  gapIntersection: IntersectionObserver | null = null
  gaps: readonly HTMLElement[] = []
  printQuery: MediaQueryList | null = null

  // Timeout for scheduling check of the parents that need scroll handlers
  parentCheck = -1
  viewportBufferTimeout = -1

  constructor(private view: EditorView) {
    this.dom = view.contentDOM
    this.observer = new MutationObserver(mutations => {
      for (let mut of mutations) this.queue.push(mut)
      // IE11 will sometimes (on typing over a selection or
      // backspacing out a single character text node) call the
      // observer callback before actually updating the DOM.
      //
      // Unrelatedly, iOS Safari will, when ending a composition,
      // sometimes first clear it, deliver the mutations, and then
      // reinsert the finished text. CodeMirror's handling of the
      // deletion will prevent the reinsertion from happening,
      // breaking composition.
      if ((browser.ie && browser.ie_version <= 11 || browser.ios && view.composing) &&
          mutations.some(m => m.type == "childList" && m.removedNodes.length ||
                         m.type == "characterData" && m.oldValue!.length > m.target.nodeValue!.length))
        this.flushSoon()
      else
        this.flush()
    })

    if (window.EditContext && browser.android && (view.constructor as any).EDIT_CONTEXT !== false &&
        // Chrome <126 doesn't support inverted selections in edit context (#1392)
        !(browser.chrome && browser.chrome_version < 126)) {
      this.editContext = new EditContextManager(view)
      if (view.state.facet(editable))
        view.contentDOM.editContext = this.editContext.editContext
    }

    if (useCharData)
      this.onCharData = (event: any) => {
        this.queue.push({target: event.target,
                         type: "characterData",
                         oldValue: event.prevValue} as MutationRecord)
        this.flushSoon()
      }

    this.onSelectionChange = this.onSelectionChange.bind(this)
    this.onResize = this.onResize.bind(this)
    this.onPrint = this.onPrint.bind(this)
    this.onScroll = this.onScroll.bind(this)

    if (window.matchMedia) this.printQuery = window.matchMedia("print")
    if (typeof ResizeObserver == "function") {
      this.resizeScroll = new ResizeObserver(() => {
        if (this.view.docView?.lastUpdate < Date.now() - 75) this.onResize()
      })
      this.resizeScroll.observe(view.scrollDOM)
    }
    this.addWindowListeners(this.win = view.win)

    this.start()

    if (typeof IntersectionObserver == "function") {
      this.intersection = new IntersectionObserver(entries => {
        if (this.parentCheck < 0) this.parentCheck = setTimeout(this.listenForScroll.bind(this), 1000)
        if (entries.length > 0 && (entries[entries.length - 1].intersectionRatio > 0) != this.intersecting) {
          this.intersecting = !this.intersecting
          if (this.intersecting != this.view.inView)
            this.onScrollChanged(document.createEvent("Event"))
        }
      }, {threshold: [0, .001]})
      this.intersection.observe(this.dom)
      this.gapIntersection = new IntersectionObserver(entries => {
        if (entries.length > 0 && entries[entries.length - 1].intersectionRatio > 0)
          this.onScrollChanged(document.createEvent("Event"));
      }, {})
    }
    this.listenForScroll()
    this.readSelectionRange()
  }

  onScrollChanged(e: Event) {
    this.view.inputState.runHandlers("scroll", e)
    if (this.view.controlledTouchScrollController?.onScrollChanged()) return true
    let input = this.view.inputState, now = Date.now()
    let nativeScroll = isNativeScrollActivity(input.touchActive, input.lastTouchTime,
                                              input.lastWheelEvent, now)
    let settleDelay = nativeScroll ? this.view.viewState.noteScrollActivity() : null
    if (settleDelay != null) {
      clearTimeout(this.viewportBufferTimeout)
      this.viewportBufferTimeout = setTimeout(() => {
        this.viewportBufferTimeout = -1
        this.view.requestMeasure()
      }, settleDelay + 1) as any
    }
    if (this.intersecting) this.view.measure()
    return false
  }

  onScroll(e: Event) {
    if (this.intersecting) this.flush(false)
    let controlled = this.onScrollChanged(e)
    if (this.editContext && !controlled) this.view.requestMeasure(this.editContext.measureReq)
  }

  onResize() {
    this.view.controlledTouchScrollController?.cancel()
    if (this.resizeTimeout < 0) this.resizeTimeout = setTimeout(() => {
      this.resizeTimeout = -1
      this.view.requestMeasure()
    }, 50)
  }

  onPrint(event: Event) {
    if ((event.type == "change" || !event.type) && !(event as MediaQueryListEvent).matches) return
    this.view.controlledTouchScrollController?.cancel()
    this.view.viewState.printing = true
    this.view.measure()
    setTimeout(() => {
      this.view.viewState.printing = false
      this.view.requestMeasure()
    }, 500)
  }

  updateGaps(gaps: readonly HTMLElement[]) {
    if (this.gapIntersection && (gaps.length != this.gaps.length || this.gaps.some((g, i) => g != gaps[i]))) {
      this.gapIntersection.disconnect()
      for (let gap of gaps) this.gapIntersection.observe(gap)
      this.gaps = gaps
    }
  }

  onSelectionChange(event: Event) {
    let wasChanged = this.selectionChanged
    if (!this.readSelectionRange() || this.delayedAndroidKey) return
    let {view} = this, sel = this.selectionRange
    if (view.state.facet(editable) ? view.root.activeElement != this.dom : !hasSelection(this.dom, sel))
      return

    let context = sel.anchorNode && view.docView.tile.nearest(sel.anchorNode)
    if (context && context.isWidget() && context.widget.ignoreEvent(event)) {
      if (!wasChanged) this.selectionChanged = false
      return
    }

    // Deletions on IE11 fire their events in the wrong order, giving
    // us a selection change event before the DOM changes are
    // reported.
    // Chrome Android has a similar issue when backspacing out a
    // selection (#645).
    if ((browser.ie && browser.ie_version <= 11 || browser.android && browser.chrome) && !view.state.selection.main.empty &&
        // (Selection.isCollapsed isn't reliable on IE)
        sel.focusNode && isEquivalentPosition(sel.focusNode, sel.focusOffset, sel.anchorNode, sel.anchorOffset))
      this.flushSoon()
    else
      this.flush(false)
  }

  readSelectionRange() {
    let {view} = this
    // The Selection object is broken in shadow roots in Safari. See
    // issue #414
    let selection = getSelection(view.root)
    if (!selection) return false
    let range = browser.safari && (view.root as any).nodeType == 11 &&
      view.root.activeElement == this.dom &&
      safariSelectionRangeHack(this.view, selection) || selection
    if (!range || this.selectionRange.eq(range)) return false
    let local = hasSelection(this.dom, range)
    // Detect the situation where the browser has, on focus, moved the
    // selection to the start of the content element. Reset it to the
    // position from the editor state.
    if (local && !this.selectionChanged &&
        view.inputState.lastFocusTime > Date.now() - 200 &&
        view.inputState.lastTouchTime < Date.now() - 300 &&
        atElementStart(this.dom, range)) {
      this.view.inputState.lastFocusTime = 0
      view.docView.updateSelection()
      return false
    }
    this.selectionRange.setRange(range)
    if (local) this.selectionChanged = true
    return true
  }

  setSelectionRange(anchor: {node: Node, offset: number}, head: {node: Node, offset: number}) {
    this.selectionRange.set(anchor.node, anchor.offset, head.node, head.offset)
    this.selectionChanged = false
  }

  clearSelectionRange() {
    this.selectionRange.set(null, 0, null, 0)
  }

  listenForScroll() {
    this.parentCheck = -1
    let i = 0, changed: HTMLElement[] | null = null
    for (let dom = this.dom as any; dom;) {
      if (dom.nodeType == 1) {
        if (!changed && i < this.scrollTargets.length && this.scrollTargets[i] == dom) i++
        else if (!changed) changed = this.scrollTargets.slice(0, i)
        if (changed) changed.push(dom)
        dom = dom.assignedSlot || dom.parentNode
      } else if (dom.nodeType == 11) { // Shadow root
        dom = dom.host
      } else {
        break
      }
    }
    if (i < this.scrollTargets.length && !changed) changed = this.scrollTargets.slice(0, i)
    if (changed) {
      for (let dom of this.scrollTargets) dom.removeEventListener("scroll", this.onScroll)
      for (let dom of this.scrollTargets = changed) dom.addEventListener("scroll", this.onScroll)
    }
  }

  ignore<T>(f: () => T): T {
    if (!this.active) return f()
    try {
      this.stop()
      return f()
    } finally {
      this.start()
      this.clear()
    }
  }

  start() {
    if (this.active) return
    this.observer.observe(this.dom, observeOptions)
    if (useCharData)
      this.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.active = true
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.observer.disconnect()
    if (useCharData)
      this.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
  }

  // Throw away any pending changes
  clear() {
    this.processRecords()
    this.queue.length = 0
    this.selectionChanged = false
  }

  // Chrome Android, especially in combination with GBoard, not only
  // doesn't reliably fire regular key events, but also often
  // surrounds the effect of enter or backspace with a bunch of
  // composition events that, when interrupted, cause text duplication
  // or other kinds of corruption. This hack makes the editor back off
  // from handling DOM changes for a moment when such a key is
  // detected (via beforeinput or keydown), and then tries to flush
  // them or, if that has no effect, dispatches the given key.
  delayAndroidKey(key: string, keyCode: number) {
    if (!this.delayedAndroidKey) {
      let flush = () => {
        let key = this.delayedAndroidKey
        if (key) {
          this.clearDelayedAndroidKey()
          this.view.inputState.lastKeyCode = key.keyCode
          this.view.inputState.lastKeyTime = Date.now()
          let flushed = this.flush()
          if (!flushed && key.force)
            dispatchKey(this.dom, key.key, key.keyCode)
        }
      }
      this.flushingAndroidKey = this.view.win.requestAnimationFrame(flush)
    }
    // Since backspace beforeinput is sometimes signalled spuriously,
    // Enter always takes precedence.
    if (!this.delayedAndroidKey || key == "Enter")
      this.delayedAndroidKey = {
        key, keyCode,
        // Only run the key handler when no changes are detected if
        // this isn't coming right after another change, in which case
        // it is probably part of a weird chain of updates, and should
        // be ignored if it returns the DOM to its previous state.
        force: this.lastChange < Date.now() - 50 || !!this.delayedAndroidKey?.force
      }
  }

  clearDelayedAndroidKey() {
    this.win.cancelAnimationFrame(this.flushingAndroidKey)
    this.delayedAndroidKey = null
    this.flushingAndroidKey = -1
  }

  flushSoon() {
    if (this.delayedFlush < 0)
      this.delayedFlush = this.view.win.requestAnimationFrame(() => { this.delayedFlush = -1; this.flush() })
  }

  forceFlush() {
    if (this.delayedFlush >= 0) {
      this.view.win.cancelAnimationFrame(this.delayedFlush)
      this.delayedFlush = -1
    }
    this.flush()
  }

  pendingRecords() {
    for (let mut of this.observer.takeRecords()) this.queue.push(mut)
    return this.queue
  }

  processRecords() {
    let records = this.pendingRecords()
    if (records.length) this.queue = []

    let from = -1, to = -1, typeOver = false
    for (let record of records) {
      let range = this.readMutation(record)
      if (!range) continue
      if (range.typeOver) typeOver = true
      if (from == -1) {
        ;({from, to} = range)
      } else {
        from = Math.min(range.from, from)
        to = Math.max(range.to, to)
      }
    }
    return {from, to, typeOver}
  }

  readChange() {
    let {from, to, typeOver} = this.processRecords()
    let newSel = this.selectionChanged && hasSelection(this.dom, this.selectionRange)
    if (from < 0 && !newSel) return null
    if (from > -1) this.lastChange = Date.now()
    this.view.inputState.lastFocusTime = 0
    this.selectionChanged = false
    let change = new DOMChange(this.view, from, to, typeOver)
    this.view.docView.domChanged = {newSel: change.newSel ? change.newSel.main : null}
    return change
  }

  // Apply pending changes, if any
  flush(readSelection = true) {
    // Completely hold off flushing when pending keys are set—the code
    // managing those will make sure processRecords is called and the
    // view is resynchronized after
    if (this.delayedFlush >= 0 || this.delayedAndroidKey) return false

    if (readSelection) this.readSelectionRange()

    let domChange = this.readChange()
    if (!domChange) {
      this.view.requestMeasure()
      return false
    }
    let startState = this.view.state
    let handled = applyDOMChange(this.view, domChange)
    // The view wasn't updated but DOM/selection changes were seen. Reset the view.
    if (this.view.state == startState &&
        (domChange.domChanged || domChange.newSel && !sameSelPos(this.view.state.selection, domChange.newSel.main)))
      this.view.update([])
    return handled
  }

  readMutation(rec: MutationRecord): {from: number, to: number, typeOver: boolean} | null {
    let tile = this.view.docView.tile.nearest(rec.target)
    if (!tile || tile.isWidget()) return null
    tile.markDirty(rec.type == "attributes")

    if (rec.type == "childList") {
      let childBefore = findChild(tile, rec.previousSibling || rec.target.previousSibling, -1)
      let childAfter = findChild(tile, rec.nextSibling || rec.target.nextSibling, 1)
      return {from: childBefore ? tile.posAfter(childBefore) : tile.posAtStart,
              to: childAfter ? tile.posBefore(childAfter) : tile.posAtEnd, typeOver: false}
    } else if (rec.type == "characterData") {
      return {from: tile.posAtStart, to: tile.posAtEnd, typeOver: rec.target.nodeValue == rec.oldValue}
    } else {
      return null
    }
  }

  setWindow(win: Window) {
    if (win != this.win) {
      this.removeWindowListeners(this.win)
      this.win = win
      this.addWindowListeners(this.win)
    }
  }

  addWindowListeners(win: Window) {
    win.addEventListener("resize", this.onResize)
    if (this.printQuery) { 
      if (this.printQuery.addEventListener) this.printQuery.addEventListener("change", this.onPrint)
      else this.printQuery.addListener(this.onPrint)
    }
    else win.addEventListener("beforeprint", this.onPrint)
    win.addEventListener("scroll", this.onScroll)
    win.document.addEventListener("selectionchange", this.onSelectionChange)
  }

  removeWindowListeners(win: Window) {
    win.removeEventListener("scroll", this.onScroll)
    win.removeEventListener("resize", this.onResize)
    if (this.printQuery) {
      if (this.printQuery.removeEventListener) this.printQuery.removeEventListener("change", this.onPrint)
      else this.printQuery.removeListener(this.onPrint)
    }
    else win.removeEventListener("beforeprint", this.onPrint)
    win.document.removeEventListener("selectionchange", this.onSelectionChange)
  }

  update(update: ViewUpdate) {
    if (this.editContext) {
      this.editContext.update(update)
      if (update.startState.facet(editable) != update.state.facet(editable))
        update.view.contentDOM.editContext = update.state.facet(editable) ? this.editContext.editContext : null
    }
  }

  destroy() {
    this.stop()
    this.intersection?.disconnect()
    this.gapIntersection?.disconnect()
    this.resizeScroll?.disconnect()
    for (let dom of this.scrollTargets) dom.removeEventListener("scroll", this.onScroll)
    this.removeWindowListeners(this.win)
    clearTimeout(this.parentCheck)
    clearTimeout(this.resizeTimeout)
    clearTimeout(this.viewportBufferTimeout)
    this.win.cancelAnimationFrame(this.delayedFlush)
    this.win.cancelAnimationFrame(this.flushingAndroidKey)
    if (this.editContext) {
      this.view.contentDOM.editContext = null
      this.editContext.destroy()
    }
  }
}

function findChild(tile: Tile, dom: Node | null, dir: number): Tile | null {
  while (dom) {
    let curTile = Tile.get(dom)
    if (curTile && curTile.parent == tile) return curTile
    let parent = dom.parentNode
    dom = parent != tile.dom ? parent : dir > 0 ? dom.nextSibling : dom.previousSibling
  }
  return null
}

function buildSelectionRangeFromRange(view: EditorView, range: StaticRange) {
  let anchorNode = range.startContainer, anchorOffset = range.startOffset
  let focusNode = range.endContainer, focusOffset = range.endOffset
  let curAnchor = view.docView.domAtPos(view.state.selection.main.anchor, 1)
  // Since such a range doesn't distinguish between anchor and head,
  // use a heuristic that flips it around if its end matches the
  // current anchor.
  if (isEquivalentPosition(curAnchor.node, curAnchor.offset, focusNode, focusOffset))
    [anchorNode, anchorOffset, focusNode, focusOffset] = [focusNode, focusOffset, anchorNode, anchorOffset]
  return {anchorNode, anchorOffset, focusNode, focusOffset}
}

// Used to work around a Safari Selection/shadow DOM bug (#414)
function safariSelectionRangeHack(view: EditorView, selection: Selection) {
  if ((selection as any).getComposedRanges) {
    let range = (selection as any).getComposedRanges(view.root)[0] as StaticRange
    if (range) return buildSelectionRangeFromRange(view, range)
  }

  let found = null as null | StaticRange
  // Because Safari (at least in 2018-2021) doesn't provide regular
  // access to the selection inside a shadowroot, we have to perform a
  // ridiculous hack to get at it—using `execCommand` to trigger a
  // `beforeInput` event so that we can read the target range from the
  // event.
  function read(event: InputEvent) {
    event.preventDefault()
    event.stopImmediatePropagation()
    found = (event as any).getTargetRanges()[0]
  }
  view.contentDOM.addEventListener("beforeinput", read, true)
  view.dom.ownerDocument.execCommand("indent")
  view.contentDOM.removeEventListener("beforeinput", read, true)
  return found ? buildSelectionRangeFromRange(view, found) : null
}

const enum CxVp {
  Margin = 10000,
  MaxSize = Margin * 3,
  MinMargin = 500
}

class EditContextManager {
  editContext: EditContext
  measureReq: MeasureRequest<void>
  // The document window for which the text in the context is
  // maintained. For large documents, this may be smaller than the
  // editor document. This window always includes the selection head.
  from: number = 0
  to: number = 0
  // When applying a transaction, this is used to compare the change
  // made to the context content to the change in the transaction in
  // order to make the minimal changes to the context (since touching
  // that sometimes breaks series of multiple edits made for a single
  // user action on some Android keyboards)
  pendingContextChange: {from: number, to: number, insert: Text} | null = null
  handlers: {[name: string]: (e: any) => void} = Object.create(null)
  // Kludge to work around the fact that EditContext does not respond
  // well to having its content updated during a composition (see #1472)
  composing: {contextBase: number, editorBase: number, drifted: boolean} | null = null

  constructor(view: EditorView) {
    this.resetRange(view.state)

    let context = this.editContext = new window.EditContext({
      text: view.state.doc.sliceString(this.from, this.to),
      selectionStart: this.toContextPos(Math.max(this.from, Math.min(this.to, view.state.selection.main.anchor))),
      selectionEnd: this.toContextPos(view.state.selection.main.head)
    })
    this.handlers.textupdate = e => {
      let main = view.state.selection.main, {anchor, head} = main
      let from = this.toEditorPos(e.updateRangeStart), to = this.toEditorPos(e.updateRangeEnd)
      if (view.inputState.composing >= 0 && !this.composing)
        this.composing = {contextBase: e.updateRangeStart, editorBase: from, drifted: false}
      let deletes = to - from > e.text.length
      // If the window doesn't include the anchor, assume changes
      // adjacent to a side go up to the anchor.
      if (from == this.from && anchor < this.from) from = anchor
      else if (to == this.to && anchor > this.to) to = anchor

      let diff = findDiff(view.state.sliceDoc(from, to), e.text, (deletes ? main.from : main.to) - from, deletes ? "end" : null)
      // Edit contexts sometimes fire empty changes
      if (!diff) {
        let newSel = EditorSelection.single(this.toEditorPos(e.selectionStart), this.toEditorPos(e.selectionEnd))
        if (!sameSelPos(newSel, main)) view.dispatch({selection: newSel, userEvent: "select"})
        return
      }

      let change = {from: diff.from + from, to: diff.toA + from,
                    insert: Text.of(e.text.slice(diff.from, diff.toB).split("\n"))}
      if ((browser.mac || browser.android) && change.from == head - 1 &&
          /^\. ?$/.test(e.text) && view.contentDOM.getAttribute("autocorrect") == "off")
        change = {from, to, insert: Text.of([e.text.replace(".", " ")])}

      this.pendingContextChange = change
      if (!view.state.readOnly) {
        let newLen = this.to - this.from + (change.to - change.from + change.insert.length)
        applyDOMChangeInner(view, change, EditorSelection.single(this.toEditorPos(e.selectionStart, newLen),
                                                                 this.toEditorPos(e.selectionEnd, newLen)))
      }
      // If the transaction didn't flush our change, revert it so
      // that the context is in sync with the editor state again.
      if (this.pendingContextChange) {
        this.revertPending(view.state)
        this.setSelection(view.state)
      }

      // Work around missed compositionend events. See https://discuss.codemirror.net/t/a/9514
      if (change.from < change.to && !change.insert.length && view.inputState.composing >= 0 &&
          !/[\\p{Alphabetic}\\p{Number}_]/.test(context.text.slice(Math.max(0, e.updateRangeStart - 1),
                                                                   Math.min(context.text.length, e.updateRangeStart + 1))))
        this.handlers.compositionend(e)
    }
    this.handlers.characterboundsupdate = e => {
      let rects: DOMRect[] = [], prev: DOMRect | null = null
      for (let i = this.toEditorPos(e.rangeStart), end = this.toEditorPos(e.rangeEnd); i < end; i++) {
        let rect = view.coordsForChar(i)
        prev = (rect && new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
          || prev || new DOMRect
        rects.push(prev)
      }
      context.updateCharacterBounds(e.rangeStart, rects)
    }
    this.handlers.textformatupdate = e => {
      let deco = []
      for (let format of e.getTextFormats()) {
        let lineStyle = format.underlineStyle, thickness = format.underlineThickness
        if (!/none/i.test(lineStyle) && !/none/i.test(thickness)) {
          let from = this.toEditorPos(format.rangeStart), to = this.toEditorPos(format.rangeEnd)
          if (from < to) {
            // These values changed from capitalized custom strings to lower-case CSS keywords in 2025
            let style = `text-decoration: underline ${
              /^[a-z]/.test(lineStyle) ? lineStyle + " " : lineStyle == "Dashed" ? "dashed " : lineStyle == "Squiggle" ? "wavy " : ""
            }${/thin/i.test(thickness) ? 1 : 2}px`
            deco.push(Decoration.mark({attributes: {style}}).range(from, to))
          }
        }
      }
      view.dispatch({effects: setEditContextFormatting.of(Decoration.set(deco))})
    }
    this.handlers.compositionstart = () => {
      if (view.inputState.composing < 0) {
        view.inputState.composing = 0
        view.inputState.compositionFirstChange = true
      }
    }
    this.handlers.compositionend = () => {
      view.inputState.composing = -1
      view.inputState.compositionFirstChange = null
      if (this.composing) {
        let {drifted} = this.composing
        this.composing = null
        if (drifted) this.reset(view.state)
      }
    }
    for (let event in this.handlers) context.addEventListener(event as any, this.handlers[event])

    this.measureReq = {read: view => {
      let sel = getSelection(view.root)
      if (sel && sel.rangeCount)
        this.editContext.updateSelectionBounds(sel.getRangeAt(0).getBoundingClientRect())
    }}
  }

  applyEdits(update: ViewUpdate) {
    let off = 0, abort = false, pending = this.pendingContextChange
    update.changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
      if (abort) return

      let dLen = insert.length - (toA - fromA)
      if (pending && toA >= pending.to) {
        if (pending.from == fromA && pending.to == toA && pending.insert.eq(insert)) {
          pending = this.pendingContextChange = null // Match
          off += dLen
          this.to += dLen
          return
        } else { // Mismatch, revert
          pending = null
          this.revertPending(update.state)
        }
      }

      fromA += off; toA += off
      if (toA <= this.from) { // Before the window
        this.from += dLen; this.to += dLen
      } else if (fromA < this.to) { // Overlaps with window
        if (fromA < this.from || toA > this.to || (this.to - this.from) + insert.length > CxVp.MaxSize) {
          abort = true
          return
        } 
        this.editContext.updateText(this.toContextPos(fromA), this.toContextPos(toA), insert.toString())
        this.to += dLen
      }
      off += dLen
    })
    if (pending && !abort) this.revertPending(update.state)
    return !abort
  }

  update(update: ViewUpdate) {
    let reverted = this.pendingContextChange, startSel = update.startState.selection.main
    if (this.composing &&
        (this.composing.drifted ||
         (!update.changes.touchesRange(startSel.from, startSel.to) &&
          update.transactions.some(tr => !tr.isUserEvent("input.type") && tr.changes.touchesRange(this.from, this.to))))) {
      this.composing.drifted = true
      this.composing.editorBase = update.changes.mapPos(this.composing.editorBase)
    } else if (!this.applyEdits(update) || !this.rangeIsValid(update.state)) {
      this.pendingContextChange = null
      this.reset(update.state)
    } else if (update.docChanged || update.selectionSet || reverted) {
      this.setSelection(update.state)
    }
    if (update.geometryChanged || update.docChanged || update.selectionSet)
      update.view.requestMeasure(this.measureReq)
  }

  resetRange(state: EditorState) {
    let {head} = state.selection.main
    this.from = Math.max(0, head - CxVp.Margin)
    this.to = Math.min(state.doc.length, head + CxVp.Margin)
  }

  reset(state: EditorState) {
    this.resetRange(state)
    this.editContext.updateText(0, this.editContext.text.length, state.doc.sliceString(this.from, this.to))
    this.setSelection(state)
  }

  revertPending(state: EditorState) {
    let pending = this.pendingContextChange!
    this.pendingContextChange = null
    this.editContext.updateText(this.toContextPos(pending.from),
                                this.toContextPos(pending.from + pending.insert.length),
                                state.doc.sliceString(pending.from, pending.to))
  }

  setSelection(state: EditorState) {
    let {main} = state.selection
    let start = this.toContextPos(Math.max(this.from, Math.min(this.to, main.anchor)))
    let end = this.toContextPos(main.head)
    if (this.editContext.selectionStart != start || this.editContext.selectionEnd != end)
      this.editContext.updateSelection(start, end)
  }

  rangeIsValid(state: EditorState) {
    let {head} = state.selection.main
    return !(this.from > 0 && head - this.from < CxVp.MinMargin ||
             this.to < state.doc.length && this.to - head < CxVp.MinMargin ||
             this.to - this.from > CxVp.Margin * 3)
  }

  toEditorPos(contextPos: number, clipLen = this.to - this.from) {
    contextPos = Math.min(contextPos, clipLen)
    let c = this.composing
    return c && c.drifted ? c.editorBase + (contextPos - c.contextBase) : contextPos + this.from
  }
  toContextPos(editorPos: number) {
    let c = this.composing
    return c && c.drifted ? c.contextBase + (editorPos - c.editorBase) : editorPos - this.from
  }

  destroy() {
    for (let event in this.handlers) this.editContext.removeEventListener(event as any, this.handlers[event])
  }
}
