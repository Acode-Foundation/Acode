import {EditorSelection, EditorState, SelectionRange, RangeSet, Annotation, Text, Facet} from "@codemirror/state"
import {EditorView, UpdateState} from "./editorview"
import {ViewUpdate, PluginValue, clickAddsSelectionRange, dragMovesSelection as dragBehavior, atomicRanges,
        logException, mouseSelectionStyle, PluginInstance, focusChangeEffect, getScrollMargins,
        clipboardInputFilter, clipboardOutputFilter} from "./extension"
import {Tile} from "./tile"
import browser from "./browser"
import {groupAt, skipAtomsForSelection} from "./cursor"
import {getSelection, focusPreventScroll, dispatchKey, scrollableParents, hasSelection} from "./dom"
import {applyDOMChangeInner} from "./domchange"

export class InputState {
  lastKeyCode: number = 0
  lastKeyTime: number = 0
  touchActive = false
  lastTouchTime = 0
  lastTouchX = 0
  lastTouchY = 0
  lastFocusTime = 0
  lastScrollTop = 0
  lastScrollLeft = 0
  lastWheelEvent = 0

  // On iOS, some keys need to have their default behavior happen
  // (after which we retroactively handle them and reset the DOM) to
  // avoid messing up the virtual keyboard state.
  pendingIOSKey: {
    key: string,
    keyCode: number,
    mods: {ctrlKey: boolean, altKey: boolean, metaKey: boolean, shiftKey: boolean}
  } | undefined = undefined
  // Set to a time stap by scroll events when touch isn't active on
  // iOS, to work around an issue where Safari will abort the scroll
  // momentum if we set scrollTop
  lastIOSMomentumScroll = 0

  // When enabled (>-1), tab presses are not given to key handlers,
  // leaving the browser's default behavior. If >0, the mode expires
  // at that timestamp, and any other keypress clears it.
  // Esc enables temporary tab focus mode for two seconds when not
  // otherwise handled.
  tabFocusMode: number = -1

  lastSelectionOrigin: string | null = null
  lastSelectionTime: number = 0
  lastContextMenu: number = 0
  scrollHandlers: ((event: Event) => boolean | void)[] = []

  handlers: {[event: string]: {
    observers: readonly HandlerFunction[],
    handlers: readonly HandlerFunction[]
  }} = Object.create(null)

  // -1 means not in a composition. Otherwise, this counts the number
  // of changes made during the composition. The count is used to
  // avoid treating the start state of the composition, before any
  // changes have been made, as part of the composition.
  composing = -1
  // Tracks whether the next change should be marked as starting the
  // composition (null means no composition, true means next is the
  // first, false means first has already been marked for this
  // composition)
  compositionFirstChange: boolean | null = null
  // End time of the previous composition
  compositionEndedAt = 0
  // Used in a kludge to detect when an Enter keypress should be
  // considered part of the composition on Safari, which fires events
  // in the wrong order
  compositionPendingKey = false
  // Used to categorize changes as part of a composition, even when
  // the mutation events fire shortly after the compositionend event
  compositionPendingChange = false

  // Set by beforeinput, used in DOM change reader
  insertingText = ""
  insertingTextAt = 0

  mouseSelection: MouseSelection | null = null
  // When a drag from the editor is active, this points at the range
  // being dragged.
  draggedContent: SelectionRange | null = null

  notifiedFocused: boolean

  setSelectionOrigin(origin: string) {
    this.lastSelectionOrigin = origin
    this.lastSelectionTime = Date.now()
  }

  constructor(readonly view: EditorView) {
    this.handleEvent = this.handleEvent.bind(this)
    this.notifiedFocused = view.hasFocus
    // On Safari adding an input event handler somehow prevents an
    // issue where the composition vanishes when you press enter.
    if (browser.safari) view.contentDOM.addEventListener("input", () => null)
    if (browser.gecko) firefoxCopyCutHack(view.contentDOM.ownerDocument)
  }

  handleEvent(event: Event) {
    if (!eventBelongsToEditor(this.view, event) || this.ignoreDuringComposition(event)) return
    if (event.type == "keydown" && this.keydown(event as KeyboardEvent)) return
    if (this.view.updateState != UpdateState.Idle) Promise.resolve().then(() => this.runHandlers(event.type, event))
    else this.runHandlers(event.type, event)
  }

  runHandlers(type: string, event: Event) {
    let handlers = this.handlers[type]
    if (handlers) {
      for (let observer of handlers.observers) observer(this.view, event)
      for (let handler of handlers.handlers) {
        if (event.defaultPrevented) break
        if (handler(this.view, event)) { event.preventDefault(); break }
      }
    }
  }

  ensureHandlers(plugins: readonly PluginInstance[]) {
    let handlers = computeHandlers(plugins), prev = this.handlers, dom = this.view.contentDOM
    for (let type in handlers) if (type != "scroll") {
      let passive = !handlers[type].handlers.length
      let exists: (typeof prev)["type"] | null = prev[type]
      if (exists && passive != !exists.handlers.length) {
        dom.removeEventListener(type, this.handleEvent)
        exists = null
      }
      if (!exists) dom.addEventListener(type, this.handleEvent, {passive})
    }
    for (let type in prev) if (type != "scroll" && !handlers[type])
      dom.removeEventListener(type, this.handleEvent)
    this.handlers = handlers
  }

  keydown(event: KeyboardEvent) {
    // Must always run, even if a custom handler handled the event
    this.lastKeyCode = event.keyCode
    this.lastKeyTime = Date.now()

    if (event.keyCode == 9 && this.tabFocusMode > -1 && (!this.tabFocusMode || Date.now() <= this.tabFocusMode))
      return true
    if (this.tabFocusMode > 0 && event.keyCode != 27 && modifierCodes.indexOf(event.keyCode) < 0)
      this.tabFocusMode = -1

    // Chrome for Android usually doesn't fire proper key events, but
    // occasionally does, usually surrounded by a bunch of complicated
    // composition changes. When an enter or backspace key event is
    // seen, hold off on handling DOM events for a bit, and then
    // dispatch it.
    if (browser.android && browser.chrome && !(event as any).synthetic &&
        (event.keyCode == 13 || event.keyCode == 8)) {
      this.view.observer.delayAndroidKey(event.key, event.keyCode)
      return true
    }
    // Preventing the default behavior of Enter on iOS makes the
    // virtual keyboard get stuck in the wrong (lowercase)
    // state. So we let it go through, and then, in
    // applyDOMChange, notify key handlers of it and reset to
    // the state they produce.
    if (browser.ios && !(event as any).synthetic && !event.altKey && !event.metaKey &&
        (PendingKeys.some(key => key.keyCode == event.keyCode) && !event.ctrlKey ||
         EmacsyPendingKeys.indexOf(event.key) > -1 && event.ctrlKey)) {
      let mods = {ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey}
      // On iOS with autocapitalize, drop the shift modifier for these
      // keys, since it will be set at the start of every sentence.
      if (mods.shiftKey && browser.ios && !/^(off|none)$/.test(this.view.contentDOM.autocapitalize) &&
          iosVirtualKeyboardOpen(this.view.win))
        mods.shiftKey = false
      this.pendingIOSKey = {key: event.key, keyCode: event.keyCode, mods}
      setTimeout(() => this.flushIOSKey(), 250)
      return true
    }
    if (event.keyCode != 229) this.view.observer.forceFlush()
    return false
  }

  flushIOSKey(change?: {from: number, to: number, insert: Text}) {
    let key = this.pendingIOSKey
    if (!key) return false
    // This looks like an autocorrection before Enter
    if (key.key == "Enter" && change && change.from < change.to && /^\S+$/.test(change.insert.toString())) return false
    this.pendingIOSKey = undefined
    return dispatchKey(this.view.contentDOM, key.key, key.keyCode, key.mods)
  }

  ignoreDuringComposition(event: Event): boolean {
    if (!/^key/.test(event.type) || (event as any).synthetic) return false
    if (this.composing > 0) return true
    // See https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/.
    // On some input method editors (IMEs), the Enter key is used to
    // confirm character selection. On Safari, when Enter is pressed,
    // compositionend and keydown events are sometimes emitted in the
    // wrong order. The key event should still be ignored, even when
    // it happens after the compositionend event.
    if (browser.safari && !browser.ios && this.compositionPendingKey && Date.now() - this.compositionEndedAt < 100) {
      this.compositionPendingKey = false
      return true
    }
    return false
  }

  startMouseSelection(mouseSelection: MouseSelection) {
    if (this.mouseSelection) this.mouseSelection.destroy()
    this.mouseSelection = mouseSelection
  }

  update(update: ViewUpdate) {
    this.view.observer.update(update)
    if (this.mouseSelection) this.mouseSelection.update(update)
    if (this.draggedContent && update.docChanged) this.draggedContent = this.draggedContent.map(update.changes)
    if (update.transactions.length) this.lastKeyCode = this.lastSelectionTime = 0
  }

  destroy() {
    if (this.mouseSelection) this.mouseSelection.destroy()
  }
}

function iosVirtualKeyboardOpen(win: Window) {
  if (!win.visualViewport) return false
  return win.visualViewport.height * win.visualViewport.scale / win.document.documentElement.clientHeight < 0.85
}

type HandlerFunction = (view: EditorView, event: Event) => boolean | void

function bindHandler(
  plugin: PluginValue,
  handler: (this: PluginValue, event: Event, view: EditorView) => boolean | void
): HandlerFunction {
  return (view, event) => {
    try {
      return handler.call(plugin, event, view)
    } catch (e) {
      logException(view.state, e)
    }
  }
}

function computeHandlers(plugins: readonly PluginInstance[]) {
  let result: {[event: string]: {
    observers: HandlerFunction[],
    handlers: HandlerFunction[]
  }} = Object.create(null)
  function record(type: string) {
    return result[type] || (result[type] = {observers: [], handlers: []})
  }
  for (let plugin of plugins) {
    let spec = plugin.spec, handlers = spec && spec.plugin.domEventHandlers, observers = spec && spec.plugin.domEventObservers
    if (handlers) for (let type in handlers) {
      let f = handlers[type]
      if (f) record(type).handlers.push(bindHandler(plugin.value!, f))
    }
    if (observers) for (let type in observers) {
      let f = observers[type]
      if (f) record(type).observers.push(bindHandler(plugin.value!, f))
    }
  }
  for (let type in handlers) record(type).handlers.push(handlers[type])
  for (let type in observers) record(type).observers.push(observers[type])
  return result
}

const PendingKeys = [
  {key: "Backspace", keyCode: 8, inputType: "deleteContentBackward"},
  {key: "Enter", keyCode: 13, inputType: "insertParagraph"},
  {key: "Enter", keyCode: 13, inputType: "insertLineBreak"},
  {key: "Delete", keyCode: 46, inputType: "deleteContentForward"}
]

const EmacsyPendingKeys = "dthko"

// Key codes for modifier keys
export const modifierCodes = [16, 17, 18, 20, 91, 92, 224, 225]

const dragScrollMargin = 6

/// Interface that objects registered with
/// [`EditorView.mouseSelectionStyle`](#view.EditorView^mouseSelectionStyle)
/// must conform to.
export interface MouseSelectionStyle {
  /// Return a new selection for the mouse gesture that starts with
  /// the event that was originally given to the constructor, and ends
  /// with the event passed here. In case of a plain click, those may
  /// both be the `mousedown` event, in case of a drag gesture, the
  /// latest `mousemove` event will be passed.
  ///
  /// When `extend` is true, that means the new selection should, if
  /// possible, extend the start selection. If `multiple` is true, the
  /// new selection should be added to the original selection.
  get: (curEvent: MouseEvent, extend: boolean, multiple: boolean) => EditorSelection
  /// Called when the view is updated while the gesture is in
  /// progress. When the document changes, it may be necessary to map
  /// some data (like the original selection or start position)
  /// through the changes.
  ///
  /// This may return `true` to indicate that the `get` method should
  /// get queried again after the update, because something in the
  /// update could change its result. Be wary of infinite loops when
  /// using this (where `get` returns a new selection, which will
  /// trigger `update`, which schedules another `get` in response).
  update: (update: ViewUpdate) => boolean | void
}

export type MakeSelectionStyle = (view: EditorView, event: MouseEvent) => MouseSelectionStyle | null

function dragScrollSpeed(dist: number) {
  return Math.max(0, dist) * 0.7 + 8
}

function dist(a: MouseEvent, b: MouseEvent) {
  return Math.max(Math.abs(a.clientX - b.clientX), Math.abs(a.clientY - b.clientY))
}

class MouseSelection {
  dragging: null | boolean
  extend: boolean
  multiple: boolean
  lastEvent: MouseEvent
  scrollParents: {x: HTMLElement | null, y: HTMLElement | null}
  scrollSpeed = {x: 0, y: 0}
  scrolling = -1
  atoms: readonly RangeSet<any>[]

  constructor(private view: EditorView,
              private startEvent: MouseEvent,
              private style: MouseSelectionStyle,
              private mustSelect: boolean) {
    this.lastEvent = startEvent
    this.scrollParents = scrollableParents(view.contentDOM)
    this.atoms = view.state.facet(atomicRanges).map(f => f(view))
    let doc = view.contentDOM.ownerDocument!
    doc.addEventListener("mousemove", this.move = this.move.bind(this))
    doc.addEventListener("mouseup", this.up = this.up.bind(this))

    this.extend = startEvent.shiftKey
    this.multiple = view.state.facet(EditorState.allowMultipleSelections) && addsSelectionRange(view, startEvent)
    this.dragging = isInPrimarySelection(view, startEvent) && getClickType(startEvent) == 1 ? null : false
  }

  start(event: MouseEvent) {
    // When clicking outside of the selection, immediately apply the
    // effect of starting the selection
    if (this.dragging === false) this.select(event)
  }

  move(event: MouseEvent) {
    if (event.buttons == 0) return this.destroy()
    if (this.dragging || this.dragging == null && dist(this.startEvent, event) < 10) return
    this.select(this.lastEvent = event)

    let sx = 0, sy = 0
    let left = 0, top = 0, right = this.view.win.innerWidth, bottom = this.view.win.innerHeight
    if (this.scrollParents.x) ({left, right} = this.scrollParents.x.getBoundingClientRect())
    if (this.scrollParents.y) ({top, bottom} = this.scrollParents.y.getBoundingClientRect())
    let margins = getScrollMargins(this.view)

    if (event.clientX - margins.left <= left + dragScrollMargin)
      sx = -dragScrollSpeed(left - event.clientX)
    else if (event.clientX + margins.right >= right - dragScrollMargin)
      sx = dragScrollSpeed(event.clientX - right)
    if (event.clientY - margins.top <= top + dragScrollMargin)
      sy = -dragScrollSpeed(top - event.clientY)
    else if (event.clientY + margins.bottom >= bottom - dragScrollMargin)
      sy = dragScrollSpeed(event.clientY - bottom)
    this.setScrollSpeed(sx, sy)
  }

  up(event: MouseEvent) {
    if (this.dragging == null) this.select(this.lastEvent)
    if (!this.dragging) event.preventDefault()
    this.destroy()
  }

  destroy() {
    this.setScrollSpeed(0, 0)
    let doc = this.view.contentDOM.ownerDocument!
    doc.removeEventListener("mousemove", this.move)
    doc.removeEventListener("mouseup", this.up)
    this.view.inputState.mouseSelection = this.view.inputState.draggedContent = null
  }

  setScrollSpeed(sx: number, sy: number) {
    this.scrollSpeed = {x: sx, y: sy}
    if (sx || sy) {
      if (this.scrolling < 0) this.scrolling = setInterval(() => this.scroll(), 50)
    } else if (this.scrolling > -1) {
      clearInterval(this.scrolling)
      this.scrolling = -1
    }
  }

  scroll() {
    let {x, y} = this.scrollSpeed
    if (x && this.scrollParents.x) {
      this.scrollParents.x.scrollLeft += x
      x = 0
    }
    if (y && this.scrollParents.y) {
      this.scrollParents.y.scrollTop += y
      y = 0
    }
    if (x || y) this.view.win.scrollBy(x, y)
    if (this.dragging === false) this.select(this.lastEvent)
  }

  select(event: MouseEvent) {
    let {view} = this, selection = skipAtomsForSelection(this.atoms, this.style.get(event, this.extend, this.multiple))
    if (this.mustSelect || !selection.eq(view.state.selection, this.dragging === false))
      this.view.dispatch({
        selection,
        userEvent: "select.pointer"
      })
    this.mustSelect = false
  }

  update(update: ViewUpdate) {
    if (update.transactions.some(tr => tr.isUserEvent("input.type")))
      this.destroy()
    else if (this.style.update(update))
      setTimeout(() => this.select(this.lastEvent), 20)
  }
}

function addsSelectionRange(view: EditorView, event: MouseEvent) {
  let facet = view.state.facet(clickAddsSelectionRange)
  return facet.length ? facet[0](event) : browser.mac ? event.metaKey : event.ctrlKey
}

function dragMovesSelection(view: EditorView, event: MouseEvent) {
  let facet = view.state.facet(dragBehavior)
  return facet.length ? facet[0](event) : browser.mac ? !event.altKey : !event.ctrlKey
}

function isInPrimarySelection(view: EditorView, event: MouseEvent) {
  let {main} = view.state.selection
  if (main.empty) return false
  // On boundary clicks, check whether the coordinates are inside the
  // selection's client rectangles
  let sel = getSelection(view.root)
  if (!sel || sel.rangeCount == 0) return true
  let rects = sel.getRangeAt(0).getClientRects()
  for (let i = 0; i < rects.length; i++) {
    let rect = rects[i]
    if (rect.left <= event.clientX && rect.right >= event.clientX &&
        rect.top <= event.clientY && rect.bottom >= event.clientY) return true
  }
  return false
}

function eventBelongsToEditor(view: EditorView, event: Event): boolean {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  for (let node: Node | null = event.target as Node, tile; node != view.contentDOM; node = node.parentNode)
    if (!node || node.nodeType == 11 ||
        ((tile = Tile.get(node)) && tile.isWidget() && !tile.isHidden && tile.widget.ignoreEvent(event)))
      return false
  return true
}

const handlers: {[key: string]: (view: EditorView, event: any) => boolean} = Object.create(null)
const observers: {[key: string]: (view: EditorView, event: any) => undefined} = Object.create(null)

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) ||
  (browser.ios && browser.webkit_version < 604)

function capturePaste(view: EditorView) {
  let parent = view.dom.parentNode
  if (!parent) return
  let target = parent.appendChild(document.createElement("textarea"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.focus()
  setTimeout(() => {
    view.focus()
    target.remove()
    doPaste(view, target.value)
  }, 50)
}

function textFilter(state: EditorState, facet: Facet<(value: string, state: EditorState) => string>, text: string) {
  for (let filter of state.facet(facet)) text = filter(text, state)
  return text
}

function doPaste(view: EditorView, input: string) {
  input = textFilter(view.state, clipboardInputFilter, input)
  let {state} = view, changes, i = 1, text = state.toText(input)
  let byLine = text.lines == state.selection.ranges.length
  let linewise = lastLinewiseCopy != null && state.selection.ranges.every(r => r.empty) && lastLinewiseCopy == text.toString()
  if (linewise) {
    let lastLine = -1
    changes = state.changeByRange(range => {
      let line = state.doc.lineAt(range.from)
      if (line.from == lastLine) return {range}
      lastLine = line.from
      let insert = state.toText((byLine ? text.line(i++).text : input) + state.lineBreak)
      return {changes: {from: line.from, insert},
              range: EditorSelection.cursor(range.from + insert.length)}
    })
  } else if (byLine) {
    changes = state.changeByRange(range => {
      let line = text.line(i++)
      return {changes: {from: range.from, to: range.to, insert: line.text},
              range: EditorSelection.cursor(range.from + line.length)}
    })
  } else {
    changes = state.replaceSelection(text)
  }
  view.dispatch(changes, {
    userEvent: "input.paste",
    scrollIntoView: true
  })
}

observers.scroll = view => {
  let iState = view.inputState
  iState.lastScrollTop = view.scrollDOM.scrollTop
  iState.lastScrollLeft = view.scrollDOM.scrollLeft
  if (browser.ios && !iState.touchActive) iState.lastIOSMomentumScroll = Date.now()
}

observers.wheel = observers.mousewheel = view => {
  view.inputState.lastWheelEvent = Date.now()
}

handlers.keydown = (view, event: KeyboardEvent) => {
  view.inputState.setSelectionOrigin("select")
  if (event.keyCode == 27 && view.inputState.tabFocusMode != 0) view.inputState.tabFocusMode = Date.now() + 2000
  return false
}

observers.touchstart = (view, e: TouchEvent) => {
  let iState = view.inputState, touch = e.targetTouches[0]
  iState.touchActive = true
  iState.lastTouchTime = Date.now()
  if (touch) {
    iState.lastTouchX = touch.clientX
    iState.lastTouchY = touch.clientY
  }
  iState.setSelectionOrigin("select.pointer")
}

observers.touchmove = view => {
  view.inputState.lastTouchTime = Date.now()
  view.inputState.setSelectionOrigin("select.pointer")
}

observers.touchend = (view, e: TouchEvent) => {
  view.inputState.touchActive = false
  view.inputState.lastTouchTime = Date.now()
}

handlers.mousedown = (view, event: MouseEvent) => {
  view.observer.flush()
  if (view.inputState.lastTouchTime > Date.now() - 2000) return false // Ignore touch interaction
  let style: MouseSelectionStyle | null = null
  for (let makeStyle of view.state.facet(mouseSelectionStyle)) {
    style = makeStyle(view, event)
    if (style) break
  }
  if (!style && event.button == 0) style = basicMouseSelection(view, event)
  if (style) {
    let mustFocus = !view.hasFocus
    view.inputState.startMouseSelection(new MouseSelection(view, event, style, mustFocus))
    if (mustFocus) view.observer.ignore(() => {
      focusPreventScroll(view.contentDOM)
      let active = view.root.activeElement
      if (active && !active.contains(view.contentDOM)) (active as HTMLElement).blur()
    })
    let mouseSel = view.inputState.mouseSelection
    if (mouseSel) {
      mouseSel.start(event)
      return mouseSel.dragging === false
    }
  } else {
    view.inputState.setSelectionOrigin("select.pointer")
  }
  return false
}

function rangeForClick(view: EditorView, pos: number, bias: -1 | 1, type: number): SelectionRange {
  if (type == 1) { // Single click
    return EditorSelection.cursor(pos, bias)
  } else if (type == 2) { // Double click
    return groupAt(view.state, pos, bias)
  } else { // Triple click
    let visual = view.docView.lineAt(pos, bias), line = view.state.doc.lineAt(visual ? visual.posAtEnd : pos)
    let from = visual ? visual.posAtStart : line.from, to = visual ? visual.posAtEnd : line.to
    if (to < view.state.doc.length && to == line.to) to++
    return EditorSelection.undirectionalRange(from, to)
  }
}

const BadMouseDetail = browser.ie && browser.ie_version <= 11
let lastMouseDown: MouseEvent | null = null, lastMouseDownCount = 0, lastMouseDownTime = 0

function getClickType(event: MouseEvent) {
  if (!BadMouseDetail) return event.detail
  let last = lastMouseDown, lastTime = lastMouseDownTime
  lastMouseDown = event
  lastMouseDownTime = Date.now()
  return lastMouseDownCount = !last || (lastTime > Date.now() - 400 && Math.abs(last.clientX - event.clientX) < 2 &&
                                        Math.abs(last.clientY - event.clientY) < 2) ? (lastMouseDownCount + 1) % 3 : 1
}

function basicMouseSelection(view: EditorView, event: MouseEvent) {
  let start = view.posAndSideAtCoords({x: event.clientX, y: event.clientY}, false), type = getClickType(event)
  let startSel = view.state.selection
  return {
    update(update) {
      if (update.docChanged) {
        start.pos = update.changes.mapPos(start.pos)
        startSel = startSel.map(update.changes)
      }
    },
    get(event, extend, multiple) {
      let cur = view.posAndSideAtCoords({x: event.clientX, y: event.clientY}, false), removed
      let range = rangeForClick(view, cur.pos, cur.assoc, type)
      if (start.pos != cur.pos && !extend) {
        let startRange = rangeForClick(view, start.pos, start.assoc, type)
        let from = Math.min(startRange.from, range.from), to = Math.max(startRange.to, range.to)
        range = from < range.from ? EditorSelection.range(from, to, range.assoc) : EditorSelection.range(to, from, range.assoc)
      }
      if (extend)
        return startSel.replaceRange(startSel.main.extend(range.from, range.to, range.assoc))
      else if (multiple && type == 1 && startSel.ranges.length > 1 && (removed = removeRangeAround(startSel, cur.pos)))
        return removed
      else if (multiple)
        return startSel.addRange(range)
      else
        return EditorSelection.create([range])
    }
  } as MouseSelectionStyle
}

function removeRangeAround(sel: EditorSelection, pos: number) {
  for (let i = 0; i < sel.ranges.length; i++) {
    let {from, to} = sel.ranges[i]
    if (from <= pos && to >= pos)
      return EditorSelection.create(sel.ranges.slice(0, i).concat(sel.ranges.slice(i + 1)),
                                    sel.mainIndex == i ? 0 : sel.mainIndex - (sel.mainIndex > i ? 1 : 0))
  }
  return null
}

handlers.dragstart = (view, event: DragEvent) => {
  let {selection: {main: range}} = view.state
  if ((event.target as HTMLElement).draggable) {
    let tile = view.docView.tile.nearest(event.target as HTMLElement)
    if (tile && tile.isWidget()) {
      let from = tile.posAtStart, to = from + tile.length
      if (from >= range.to || to <= range.from) range = EditorSelection.undirectionalRange(from, to)
    }
  }
  let {inputState} = view
  if (inputState.mouseSelection) inputState.mouseSelection.dragging = true
  inputState.draggedContent = range

  if (event.dataTransfer) {
    event.dataTransfer.setData("Text", textFilter(view.state, clipboardOutputFilter,
                                                  view.state.sliceDoc(range.from, range.to)))
    event.dataTransfer.effectAllowed = "copyMove"
  }
  return false
}

handlers.dragend = view => {
  view.inputState.draggedContent = null
  return false
}

function dropText(view: EditorView, event: DragEvent, text: string, direct: boolean) {
  text = textFilter(view.state, clipboardInputFilter, text)
  if (!text) return
  let dropPos = view.posAtCoords({x: event.clientX, y: event.clientY}, false)

  let {draggedContent} = view.inputState
  let del = direct && draggedContent && dragMovesSelection(view, event)
    ? {from: draggedContent.from, to: draggedContent.to} : null
  let ins = {from: dropPos, insert: text}
  let changes = view.state.changes(del ? [del, ins] : ins)

  view.focus()
  view.dispatch({
    changes,
    selection: {anchor: changes.mapPos(dropPos, -1), head: changes.mapPos(dropPos, 1)},
    userEvent: del ? "move.drop" : "input.drop"
  })
  view.inputState.draggedContent = null
}

handlers.drop = (view, event: DragEvent) => {
  if (!event.dataTransfer) return false
  if (view.state.readOnly) return true

  let files = event.dataTransfer.files
  if (files && files.length) { // For a file drop, read the file's text.
    let text = Array(files.length), read = 0
    let finishFile = () => {
      if (++read == files.length)
        dropText(view, event, text.filter(s => s != null).join(view.state.lineBreak), false)
    }
    for (let i = 0; i < files.length; i++) {
      let reader = new FileReader
      reader.onerror = finishFile
      reader.onload = () => {
        if (!/[\x00-\x08\x0e-\x1f]{2}/.test(reader.result as string)) text[i] = reader.result
        finishFile()
      }
      reader.readAsText(files[i])
    }
    return true
  } else {
    let text = event.dataTransfer.getData("Text")
    if (text) {
      dropText(view, event, text, true)
      return true
    }
  }
  return false
}

handlers.paste = (view: EditorView, event: ClipboardEvent) => {
  if (view.state.readOnly) return true
  view.observer.flush()
  let data = brokenClipboardAPI ? null : event.clipboardData
  if (data) {
    doPaste(view, data.getData("text/plain") || data.getData("text/uri-list"))
    return true
  } else {
    capturePaste(view)
    return false
  }
}

function captureCopy(view: EditorView, text: string) {
  // The extra wrapper is somehow necessary on IE/Edge to prevent the
  // content from being mangled when it is put onto the clipboard
  let parent = view.dom.parentNode
  if (!parent) return
  let target = parent.appendChild(document.createElement("textarea"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.value = text
  target.focus()
  target.selectionEnd = text.length
  target.selectionStart = 0
  setTimeout(() => {
    target.remove()
    view.focus()
  }, 50)
}

function copiedRange(state: EditorState) {
  let content = [], ranges: {from: number, to: number}[] = [], linewise = false
  for (let range of state.selection.ranges) if (!range.empty) {
    content.push(state.sliceDoc(range.from, range.to))
    ranges.push(range)
  }
  if (!content.length) {
    // Nothing selected, do a line-wise copy
    let upto = -1
    for (let {from} of state.selection.ranges) {
      let line = state.doc.lineAt(from)
      if (line.number > upto) {
        content.push(line.text)
        ranges.push({from: line.from, to: Math.min(state.doc.length, line.to + 1)})
      }
      upto = line.number
    }
    linewise = true
  }

  return {text: textFilter(state, clipboardOutputFilter, content.join(state.lineBreak)), ranges, linewise}
}

let lastLinewiseCopy: string | null = null

handlers.copy = handlers.cut = (view, event: ClipboardEvent) => {
  // If the DOM selection is outside this editor, don't intercept.
  // This happens when a parent editor (like ProseMirror) selects content that
  // spans multiple elements including this CodeMirror. The copy event may
  // bubble through CodeMirror (e.g. when CodeMirror is the first or the last
  // element in the selection), but we should let the parent handle it.
  if (!hasSelection(view.contentDOM, view.observer.selectionRange)) return false

  let {text, ranges, linewise} = copiedRange(view.state)
  if (!text && !linewise) return false
  lastLinewiseCopy = linewise ? text : null

  if (event.type == "cut" && !view.state.readOnly)
    view.dispatch({
      changes: ranges,
      scrollIntoView: true,
      userEvent: "delete.cut"
    })
  let data = brokenClipboardAPI ? null : event.clipboardData
  if (data) {
    data.clearData()
    data.setData("text/plain", text)
    return true
  } else {
    captureCopy(view, text)
    return false
  }
}

export const isFocusChange = Annotation.define<boolean>()

export function focusChangeTransaction(state: EditorState, focus: boolean) {
  let effects = []
  for (let getEffect of state.facet(focusChangeEffect)) {
    let effect = getEffect(state, focus)
    if (effect) effects.push(effect)
  }
  return effects.length ? state.update({effects, annotations: isFocusChange.of(true)}) : null
}

function updateForFocusChange(view: EditorView) {
  setTimeout(() => {
    let focus = view.hasFocus
    if (focus != view.inputState.notifiedFocused) {
      let tr = focusChangeTransaction(view.state, focus)
      if (tr) view.dispatch(tr)
      else view.update([])
    }
  }, 10)
}

observers.focus = view => {
  view.inputState.lastFocusTime = Date.now()
  // When focusing reset the scroll position, move it back to where it was
  if (!view.scrollDOM.scrollTop && (view.inputState.lastScrollTop || view.inputState.lastScrollLeft)) {
    view.scrollDOM.scrollTop = view.inputState.lastScrollTop
    view.scrollDOM.scrollLeft = view.inputState.lastScrollLeft
  }
  updateForFocusChange(view)
}

observers.blur = view => {
  view.observer.clearSelectionRange()
  updateForFocusChange(view)
}

observers.compositionstart = observers.compositionupdate = view => {
  if (view.observer.editContext) return // Composition handled by edit context
  if (view.inputState.compositionFirstChange == null)
    view.inputState.compositionFirstChange = true
  if (view.inputState.composing < 0) {
    // FIXME possibly set a timeout to clear it again on Android
    view.inputState.composing = 0
  }
}

observers.compositionend = view => {
  if (view.observer.editContext) return // Composition handled by edit context
  view.inputState.composing = -1
  view.inputState.compositionEndedAt = Date.now()
  view.inputState.compositionPendingKey = true
  view.inputState.compositionPendingChange = view.observer.pendingRecords().length > 0
  view.inputState.compositionFirstChange = null
  if (browser.chrome && browser.android) {
    // Delay flushing for a bit on Android because it'll often fire a
    // bunch of contradictory changes in a row at end of composition
    view.observer.flushSoon()
  } else if (view.inputState.compositionPendingChange) {
    // If we found pending records, schedule a flush.
    Promise.resolve().then(() => view.observer.flush())
  } else {
    // Otherwise, make sure that, if no changes come in soon, the
    // composition view is cleared.
    setTimeout(() => {
      if (view.inputState.composing < 0 && view.docView.hasComposition)
        view.update([])
    }, 50)
  }
}

observers.contextmenu = view => {
  view.inputState.lastContextMenu = Date.now()
}

handlers.beforeinput = (view, event: InputEvent) => {
  if (event.inputType == "insertText" || event.inputType == "insertCompositionText") {
    view.inputState.insertingText = event.data!
    view.inputState.insertingTextAt = Date.now()
  }

  // In EditContext mode, we must handle insertReplacementText events
  // directly, to make spell checking corrections work
  if (event.inputType == "insertReplacementText" && view.observer.editContext) {
    let text = event.dataTransfer?.getData("text/plain"), ranges = event.getTargetRanges()
    if (text && ranges.length) {
      let r = ranges[0]
      let from = view.posAtDOM(r.startContainer, r.startOffset), to = view.posAtDOM(r.endContainer, r.endOffset)
      applyDOMChangeInner(view, {from, to, insert: view.state.toText(text)}, null)
      return true
    }
  }

  // Because Chrome Android doesn't fire useful key events, use
  // beforeinput to detect backspace (and possibly enter and delete,
  // but those usually don't even seem to fire beforeinput events at
  // the moment) and fake a key event for it.
  //
  // (preventDefault on beforeinput, though supported in the spec,
  // seems to do nothing at all on Chrome).
  let pending
  if (browser.chrome && browser.android && (pending = PendingKeys.find(key => key.inputType == event.inputType))) {
    view.observer.delayAndroidKey(pending.key, pending.keyCode)
    if (pending.key == "Backspace" || pending.key == "Delete") {
      let startViewHeight = window.visualViewport?.height || 0
      setTimeout(() => {
        // Backspacing near uneditable nodes on Chrome Android sometimes
        // closes the virtual keyboard. This tries to crudely detect
        // that and refocus to get it back.
        if ((window.visualViewport?.height || 0) > startViewHeight + 10 && view.hasFocus) {
          view.contentDOM.blur()
          view.focus()
        }
      }, 100)
    }
  }
  if (browser.ios && event.inputType == "deleteContentForward") {
    // For some reason, DOM changes (and beforeinput) happen _before_
    // the key event for ctrl-d on iOS when using an external
    // keyboard.
    view.observer.flushSoon()
  }
  // Safari will occasionally forget to fire compositionend at the end of a dead-key composition
  if (browser.safari && event.inputType == "insertText" && view.inputState.composing >= 0) {
    setTimeout(() => observers.compositionend(view, event), 20)
  }

  return false
}

const appliedFirefoxHack: Set<Document> = new Set

// In Firefox, when cut/copy handlers are added to the document, that
// somehow avoids a bug where those events aren't fired when the
// selection is empty. See issue #1082 and
// https://bugzilla.mozilla.org/show_bug.cgi?id=995961
function firefoxCopyCutHack(doc: Document) {
  if (!appliedFirefoxHack.has(doc)) {
    appliedFirefoxHack.add(doc)
    doc.addEventListener("copy", () => {})
    doc.addEventListener("cut", () => {})
  }
}
