import {EditorState, Transaction, TransactionSpec, Extension, Prec, ChangeDesc,
        EditorSelection, SelectionRange, StateEffect, Facet, Line, EditorStateConfig} from "@codemirror/state"
import {StyleModule, StyleSpec} from "style-mod"

import {DocView} from "./docview"
import {InputState, focusChangeTransaction, isFocusChange} from "./input"
import {Rect, focusPreventScroll, getRoot, ScrollStrategy,
        isScrolledToBottom, dispatchKey} from "./dom"
import {posAtCoords, moveByChar, moveToLineBoundary, byGroup, moveVertically, skipAtoms} from "./cursor"
import {BlockInfo} from "./heightmap"
import {ViewState} from "./viewstate"
import {ViewUpdate, styleModule,
        contentAttributes, editorAttributes, AttrSource,
        clickAddsSelectionRange, dragMovesSelection, mouseSelectionStyle,
        exceptionSink, updateListener, logException,
        viewPlugin, ViewPlugin, PluginValue, PluginInstance, decorations, outerDecorations, blockWrappers,
        atomicRanges, scrollMargins, MeasureRequest, editable, inputHandler, focusChangeEffect, perLineTextDirection,
        scrollIntoView, UpdateFlag, ScrollTarget, bidiIsolatedRanges, getIsolatedRanges, scrollHandler,
        clipboardInputFilter, clipboardOutputFilter, viewportBuffer, ViewportBufferConfig,
        controlledTouchScroll, ControlledTouchScrollConfig} from "./extension"
import {theme, darkTheme, buildTheme, baseThemeID, baseLightID, baseDarkID, lightDarkIDs, baseTheme} from "./theme"
import {DOMObserver} from "./domobserver"
import {Attrs, updateAttrs, combineAttrs} from "./attributes"
import {Tile} from "./tile"
import browser from "./browser"
import {computeOrder, trivialOrder, BidiSpan, Direction, Isolate, isolatesEq} from "./bidi"
import {applyDOMChange, DOMChange} from "./domchange"
import {ControlledTouchScroll} from "./controlled-scroll"

/// The type of object given to the [`EditorView`](#view.EditorView)
/// constructor.
export interface EditorViewConfig extends EditorStateConfig {
  /// The view's initial state. If not given, a new state is created
  /// by passing this configuration object to
  /// [`EditorState.create`](#state.EditorState^create), using its
  /// `doc`, `selection`, and `extensions` field (if provided).
  state?: EditorState,
  /// When given, the editor is immediately appended to the given
  /// element on creation. (Otherwise, you'll have to place the view's
  /// [`dom`](#view.EditorView.dom) element in the document yourself.)
  parent?: Element | DocumentFragment
  /// If the view is going to be mounted in a shadow root or document
  /// other than the one held by the global variable `document` (the
  /// default), you should pass it here. If you provide `parent`, but
  /// not this option, the editor will automatically look up a root
  /// from the parent.
  root?: Document | ShadowRoot,
  /// Pass an effect created with
  /// [`EditorView.scrollIntoView`](#view.EditorView^scrollIntoView) or
  /// [`EditorView.scrollSnapshot`](#view.EditorView.scrollSnapshot)
  /// here to set an initial scroll position.
  scrollTo?: StateEffect<any>,
  /// Override the way transactions are
  /// [dispatched](#view.EditorView.dispatch) for this editor view.
  /// Your implementation, if provided, should probably call the
  /// view's [`update` method](#view.EditorView.update).
  dispatchTransactions?: (trs: readonly Transaction[], view: EditorView) => void
  /// **Deprecated** single-transaction version of
  /// `dispatchTransactions`. Will force transactions to be dispatched
  /// one at a time when used.
  dispatch?: (tr: Transaction, view: EditorView) => void
}

export const enum UpdateState {
  Idle, // Not updating
  Measuring, // In the layout-reading phase of a layout check
  Updating // Updating/drawing, either directly via the `update` method, or as a result of a layout check
}

// The editor's update state machine looks something like this:
//
//     Idle → Updating ⇆ Idle (unchecked) → Measuring → Idle
//                                         ↑      ↓
//                                         Updating (measure)
//
// The difference between 'Idle' and 'Idle (unchecked)' lies in
// whether a layout check has been scheduled. A regular update through
// the `update` method updates the DOM in a write-only fashion, and
// relies on a check (scheduled with `requestAnimationFrame`) to make
// sure everything is where it should be and the viewport covers the
// visible code. That check continues to measure and then optionally
// update until it reaches a coherent state.

/// An editor view represents the editor's user interface. It holds
/// the editable DOM surface, and possibly other elements such as the
/// line number gutter. It handles events and dispatches state
/// transactions for editing actions.
export class EditorView {
  /// The current editor state.
  get state() { return this.viewState.state }

  /// To be able to display large documents without consuming too much
  /// memory or overloading the browser, CodeMirror only draws the
  /// code that is visible (plus a margin around it) to the DOM. This
  /// property tells you the extent of the current drawn viewport, in
  /// document positions.
  get viewport(): {from: number, to: number} { return this.viewState.viewport }

  /// When there are, for example, large collapsed ranges in the
  /// viewport, its size can be a lot bigger than the actual visible
  /// content. Thus, if you are doing something like styling the
  /// content in the viewport, it is preferable to only do so for
  /// these ranges, which are the subset of the viewport that is
  /// actually drawn.
  get visibleRanges(): readonly {from: number, to: number}[] { return this.viewState.visibleRanges }

  /// Returns false when the editor is entirely scrolled out of view
  /// or otherwise hidden.
  get inView() { return this.viewState.inView }

  /// Indicates whether the user is currently composing text via
  /// [IME](https://en.wikipedia.org/wiki/Input_method), and at least
  /// one change has been made in the current composition.
  get composing() { return !!this.inputState && this.inputState.composing > 0 }

  /// Indicates whether the user is currently in composing state. Note
  /// that on some platforms, like Android, this will be the case a
  /// lot, since just putting the cursor on a word starts a
  /// composition there.
  get compositionStarted() { return !!this.inputState && this.inputState.composing >= 0 }

  private dispatchTransactions: (trs: readonly Transaction[], view: EditorView) => void

  private _root: DocumentOrShadowRoot

  /// The document or shadow root that the view lives in.
  get root() { return this._root }

  /// @internal
  get win(): Window { return this.dom.ownerDocument.defaultView || window }

  /// The DOM element that wraps the entire editor view.
  readonly dom: HTMLElement

  /// The DOM element that can be styled to scroll. (Note that it may
  /// not have been, so you can't assume this is scrollable.)
  readonly scrollDOM: HTMLElement

  /// The editable DOM element holding the editor content. You should
  /// not, usually, interact with this content directly though the
  /// DOM, since the editor will immediately undo most of the changes
  /// you make. Instead, [dispatch](#view.EditorView.dispatch)
  /// [transactions](#state.Transaction) to modify content, and
  /// [decorations](#view.Decoration) to style it.
  readonly contentDOM: HTMLElement

  private announceDOM: HTMLElement

  /// @internal
  declare inputState: InputState

  /// @internal
  public viewState: ViewState
  /// @internal
  public docView: DocView

  private plugins: PluginInstance[] = []
  private pluginMap: Map<ViewPlugin<any, any>, PluginInstance | null> = new Map
  private editorAttrs: Attrs = {}
  private contentAttrs: Attrs = {}
  declare private styleModules: readonly StyleModule[]
  private bidiCache: CachedOrder[] = []

  private destroyed = false;

  /// @internal
  updateState: UpdateState = UpdateState.Updating

  /// @internal
  observer: DOMObserver

  /// @internal
  declare controlledTouchScrollController: ControlledTouchScroll

  /// @internal
  measureScheduled: number = -1
  /// @internal
  measureRequests: MeasureRequest<any>[] = []

  /// Construct a new view. You'll want to either provide a `parent`
  /// option, or put `view.dom` into your document after creating a
  /// view, so that the user can see the editor.
  constructor(config: EditorViewConfig = {}) {
    this.contentDOM = document.createElement("div")

    this.scrollDOM = document.createElement("div")
    this.scrollDOM.tabIndex = -1
    this.scrollDOM.className = "cm-scroller"
    this.scrollDOM.appendChild(this.contentDOM)

    this.announceDOM = document.createElement("div")
    this.announceDOM.className = "cm-announced"
    this.announceDOM.setAttribute("aria-live", "polite")

    this.dom = document.createElement("div")
    this.dom.appendChild(this.announceDOM)
    this.dom.appendChild(this.scrollDOM)

    if (config.parent) config.parent.appendChild(this.dom)

    let {dispatch} = config
    this.dispatchTransactions = config.dispatchTransactions ||
      (dispatch && ((trs: readonly Transaction[]) => trs.forEach(tr => dispatch!(tr, this)))) ||
      ((trs: readonly Transaction[]) => this.update(trs))
    this.dispatch = this.dispatch.bind(this)
    this._root = (config.root || getRoot(config.parent) || document) as DocumentOrShadowRoot

    this.viewState = new ViewState(this, config.state || EditorState.create(config))
    if (config.scrollTo && config.scrollTo.is(scrollIntoView))
      this.viewState.scrollTarget = config.scrollTo.value.clip(this.viewState.state)
    this.plugins = this.state.facet(viewPlugin).map(spec => new PluginInstance(spec))
    for (let plugin of this.plugins) plugin.update(this)
    this.observer = new DOMObserver(this)
    this.inputState = new InputState(this)
    this.inputState.ensureHandlers(this.plugins)
    this.docView = new DocView(this)

    this.mountStyles()
    this.updateAttrs()
    this.updateState = UpdateState.Idle
    this.controlledTouchScrollController = new ControlledTouchScroll(this)

    this.requestMeasure()
    if (document.fonts?.ready) document.fonts.ready.then(() => {
      this.viewState.mustMeasureContent = "refresh"
      this.requestMeasure()
    })
  }

  /// All regular editor state updates should go through this. It
  /// takes a transaction, array of transactions, or transaction spec
  /// and updates the view to show the new state produced by that
  /// transaction. Its implementation can be overridden with an
  /// [option](#view.EditorView.constructor^config.dispatchTransactions).
  /// This function is bound to the view instance, so it does not have
  /// to be called as a method.
  ///
  /// Note that when multiple `TransactionSpec` arguments are
  /// provided, these define a single transaction (the specs will be
  /// merged), not a sequence of transactions.
  dispatch(tr: Transaction): void
  dispatch(trs: readonly Transaction[]): void
  dispatch(...specs: TransactionSpec[]): void
  dispatch(...input: (Transaction | readonly Transaction[] | TransactionSpec)[]) {
    let trs = input.length == 1 && input[0] instanceof Transaction ? input as readonly Transaction[]
      : input.length == 1 && Array.isArray(input[0]) ? input[0] as readonly Transaction[]
      : [this.state.update(...input as TransactionSpec[])]
    this.dispatchTransactions(trs, this)
  }

  /// Update the view for the given array of transactions. This will
  /// update the visible document and selection to match the state
  /// produced by the transactions, and notify view plugins of the
  /// change. You should usually call
  /// [`dispatch`](#view.EditorView.dispatch) instead, which uses this
  /// as a primitive.
  update(transactions: readonly Transaction[]) {
    if (this.updateState != UpdateState.Idle)
      throw new Error("Calls to EditorView.update are not allowed while an update is in progress")

    let redrawn = false, attrsChanged = false, update: ViewUpdate
    let state = this.state
    for (let tr of transactions) {
      if (tr.startState != state)
        throw new RangeError("Trying to update state with a transaction that doesn't start from the previous state.")
      state = tr.state
    }
    if (this.destroyed) {
      this.viewState.state = state
      return
    }

    let focus = this.hasFocus, focusFlag = 0, dispatchFocus: Transaction | null = null
    if (transactions.some(tr => tr.annotation(isFocusChange))) {
      this.inputState.notifiedFocused = focus
      // If a focus-change transaction is being dispatched, set this update flag.
      focusFlag = UpdateFlag.Focus
    } else if (focus != this.inputState.notifiedFocused) {
      this.inputState.notifiedFocused = focus
      // Schedule a separate focus transaction if necessary, otherwise
      // add a flag to this update
      dispatchFocus = focusChangeTransaction(state, focus)
      if (!dispatchFocus) focusFlag = UpdateFlag.Focus
    }

    // If there was a pending DOM change, eagerly read it and try to
    // apply it after the given transactions.
    let pendingKey = this.observer.delayedAndroidKey, domChange: DOMChange | null = null
    if (pendingKey) {
      this.observer.clearDelayedAndroidKey()
      domChange = this.observer.readChange()
      // Only try to apply DOM changes if the transactions didn't
      // change the doc or selection.
      if (domChange && !this.state.doc.eq(state.doc) || !this.state.selection.eq(state.selection))
        domChange = null
    } else {
      this.observer.clear()
    }

    // When the phrases change, redraw the editor
    if (state.facet(EditorState.phrases) != this.state.facet(EditorState.phrases))
      return this.setState(state)

    update = ViewUpdate.create(this, state, transactions)
    update.flags |= focusFlag
    this.controlledTouchScrollController.beforeUpdate(transactions)

    let scrollTarget = this.viewState.scrollTarget
    try {
      this.updateState = UpdateState.Updating
      for (let tr of transactions) {
        if (scrollTarget) scrollTarget = scrollTarget.map(tr.changes)
        if (tr.scrollIntoView) {
          let {main} = tr.state.selection
          let {x, y} = this.state.facet(EditorView.cursorScrollMargin)
          scrollTarget = new ScrollTarget(
            main.empty ? main : EditorSelection.cursor(main.head, main.head > main.anchor ? -1 : 1),
            "nearest", "nearest", y, x)
        }
        for (let e of tr.effects)
          if (e.is(scrollIntoView)) scrollTarget = e.value.clip(this.state)
      }
      this.viewState.update(update, scrollTarget)
      this.bidiCache = CachedOrder.update(this.bidiCache, update.changes)
      if (!update.empty) {
        this.updatePlugins(update)
        this.inputState.update(update)
      }
      redrawn = this.docView.update(update)
      if (this.state.facet(styleModule) != this.styleModules) this.mountStyles()
      attrsChanged = this.updateAttrs()
      this.showAnnouncements(transactions)
      this.docView.updateSelection(redrawn, transactions.some(tr => tr.isUserEvent("select.pointer")))
    } finally { this.updateState = UpdateState.Idle }
    this.controlledTouchScrollController.update(update)
    if (update.startState.facet(theme) != update.state.facet(theme))
      this.viewState.mustMeasureContent = true
    if (redrawn || attrsChanged || scrollTarget || this.viewState.mustEnforceCursorAssoc || this.viewState.mustMeasureContent)
      this.requestMeasure()
    if (redrawn) this.docViewUpdate()
    if (!update.empty) for (let listener of this.state.facet(updateListener)) {
      try { listener(update) }
      catch (e) { logException(this.state, e, "update listener") }
    }

    if (dispatchFocus || domChange) Promise.resolve().then(() => {
      if (dispatchFocus && this.state == dispatchFocus.startState) this.dispatch(dispatchFocus)
      if (domChange) {
        if (!applyDOMChange(this, domChange) && pendingKey!.force)
          dispatchKey(this.contentDOM, pendingKey!.key, pendingKey!.keyCode)
      }
    })
  }

  /// Reset the view to the given state. (This will cause the entire
  /// document to be redrawn and all view plugins to be reinitialized,
  /// so you should probably only use it when the new state isn't
  /// derived from the old state. Otherwise, use
  /// [`dispatch`](#view.EditorView.dispatch) instead.)
  setState(newState: EditorState) {
    if (this.updateState != UpdateState.Idle)
      throw new Error("Calls to EditorView.setState are not allowed while an update is in progress")
    if (this.destroyed) {
      this.viewState.state = newState
      return
    }
    this.controlledTouchScrollController.cancel()
    this.updateState = UpdateState.Updating
    let hadFocus = this.hasFocus
    try {
      for (let plugin of this.plugins) plugin.destroy(this)
      this.viewState = new ViewState(this, newState)
      this.plugins = newState.facet(viewPlugin).map(spec => new PluginInstance(spec))
      this.pluginMap.clear()
      for (let plugin of this.plugins) plugin.update(this)
      this.docView.destroy()
      this.docView = new DocView(this)
      this.inputState.ensureHandlers(this.plugins)
      this.mountStyles()
      this.updateAttrs()
      this.bidiCache = []
    } finally { this.updateState = UpdateState.Idle }
    this.controlledTouchScrollController.setState()
    if (hadFocus) this.focus()
    this.requestMeasure()
  }

  private updatePlugins(update: ViewUpdate) {
    let prevSpecs = update.startState.facet(viewPlugin), specs = update.state.facet(viewPlugin)
    if (prevSpecs != specs) {
      let newPlugins = []
      for (let spec of specs) {
        let found = prevSpecs.indexOf(spec)
        if (found < 0) {
          newPlugins.push(new PluginInstance(spec))
        } else {
          let plugin = this.plugins[found]
          plugin.mustUpdate = update
          newPlugins.push(plugin)
        }
      }
      for (let plugin of this.plugins) if (plugin.mustUpdate != update) plugin.destroy(this)
      this.plugins = newPlugins
      this.pluginMap.clear()
    } else {
      for (let p of this.plugins) p.mustUpdate = update
    }
    for (let i = 0; i < this.plugins.length; i++) this.plugins[i].update(this)
    if (prevSpecs != specs) this.inputState.ensureHandlers(this.plugins)
  }

  private docViewUpdate() {
    for (let plugin of this.plugins) {
      let val = plugin.value
      if (val && val.docViewUpdate) {
        try { val.docViewUpdate(this) }
        catch(e) { logException(this.state, e, "doc view update listener") }
      }
    }
  }

  /// @internal
  measure(flush = true) {
    if (this.destroyed) return
    if (this.measureScheduled > -1) this.win.cancelAnimationFrame(this.measureScheduled)
    if (this.observer.delayedAndroidKey) {
      this.measureScheduled = -1
      this.requestMeasure()
      return
    }
    this.measureScheduled = 0 // Prevent requestMeasure calls from scheduling another animation frame

    if (flush) this.observer.forceFlush()

    let updated: ViewUpdate | null = null
    let scroll = this.viewState.scrollParent, scrollOffset = this.viewState.getScrollOffset()
    let {scrollAnchorPos, scrollAnchorHeight} = this.viewState
    if (Math.abs(scrollOffset - this.viewState.scrollOffset) > 1) scrollAnchorHeight = -1
    this.viewState.scrollAnchorHeight = -1

    try {
      for (let i = 0;; i++) {
        if (scrollAnchorHeight < 0) {
          if (isScrolledToBottom(scroll || this.win)) {
            scrollAnchorPos = -1
            scrollAnchorHeight = this.viewState.heightMap.height
          } else {
            let block = this.viewState.scrollAnchorAt(scrollOffset)
            scrollAnchorPos = block.from
            scrollAnchorHeight = block.top
          }
        }
        this.updateState = UpdateState.Measuring
        let changed = this.viewState.measure()
        if (!changed && !this.measureRequests.length && this.viewState.scrollTarget == null) break
        if (i > 5) {
          console.warn(this.measureRequests.length
            ? "Measure loop restarted more than 5 times"
            : "Viewport failed to stabilize")
          break
        }
        let measuring: MeasureRequest<any>[] = []
        // Only run measure requests in this cycle when the viewport didn't change
        if (!(changed & UpdateFlag.Viewport))
          [this.measureRequests, measuring] = [measuring, this.measureRequests]
        let measured = measuring.map(m => {
          try { return m.read(this) }
          catch(e) { logException(this.state, e); return BadMeasure }
        })
        let update = ViewUpdate.create(this, this.state, []), redrawn = false
        update.flags |= changed
        if (!updated) updated = update
        else updated.flags |= changed
        this.updateState = UpdateState.Updating
        if (!update.empty) {
          this.updatePlugins(update)
          this.inputState.update(update)
          this.updateAttrs()
          redrawn = this.docView.update(update)
          if (redrawn) this.docViewUpdate()
        }
        for (let i = 0; i < measuring.length; i++) if (measured[i] != BadMeasure) {
          try {
            let m = measuring[i]
            if (m.write) m.write(measured[i], this)
          } catch(e) { logException(this.state, e) }
        }
        if (redrawn) this.docView.updateSelection(true)
        if (!update.viewportChanged && this.measureRequests.length == 0) {
          if (this.viewState.editorHeight) {
            if (this.viewState.scrollTarget) {
              this.docView.scrollIntoView(this.viewState.scrollTarget)
              this.viewState.scrollTarget = null
              scrollAnchorHeight = -1
              continue
            } else {
              let newAnchorHeight = scrollAnchorPos < 0 ? this.viewState.heightMap.height :
                this.viewState.lineBlockAt(scrollAnchorPos).top
              let diff = (newAnchorHeight - scrollAnchorHeight) / this.scaleY
              if ((diff > 1 || diff < -1) &&
                  !(browser.ios && this.inputState.lastIOSMomentumScroll > Date.now() - 100) &&
                  (scroll == this.scrollDOM || this.hasFocus ||
                   Math.max(this.inputState.lastWheelEvent, this.inputState.lastTouchTime) > Date.now() - 100)) {
                scrollOffset = scrollOffset + diff
                if (!scroll) this.win.scrollBy(0, diff)
                else {
                  let target = scrollAnchorPos < 0 ? scroll.scrollHeight : scroll.scrollTop + diff
                  scroll.scrollTop = scroll == this.scrollDOM
                    ? this.controlledTouchScrollController?.clampToRenderedOffset(target) ?? target
                    : target
                }
                scrollAnchorHeight = -1
                continue
              }
            }
          }
          break
        }
      }
    } finally {
      this.updateState = UpdateState.Idle
      this.measureScheduled = -1
    }

    if (updated && !updated.empty)
      for (let listener of this.state.facet(updateListener)) listener(updated)
  }

  /// Get the CSS classes for the currently active editor themes.
  get themeClasses() {
    return baseThemeID + " " +
      (this.state.facet(darkTheme) ? baseDarkID : baseLightID) + " " +
      this.state.facet(theme)
  }

  private updateAttrs() {
    let editorAttrs = attrsFromFacet(this, editorAttributes, {
      class: "cm-editor" + (this.hasFocus ? " cm-focused " : " ") + this.themeClasses
    })
    let contentAttrs: Attrs = {
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      writingsuggestions: "false",
      translate: "no",
      contenteditable: !this.state.facet(editable) ? "false" : "true",
      class: "cm-content",
      style: `${browser.tabSize}: ${this.state.tabSize}`,
      role: "textbox",
      "aria-multiline": "true"
    }
    if (this.state.readOnly) contentAttrs["aria-readonly"] = "true"
    attrsFromFacet(this, contentAttributes, contentAttrs)

    let changed = this.observer.ignore(() => {
      let changedContent = updateAttrs(this.contentDOM, this.contentAttrs, contentAttrs)
      let changedEditor = updateAttrs(this.dom, this.editorAttrs, editorAttrs)
      return changedContent || changedEditor
    })
    this.editorAttrs = editorAttrs
    this.contentAttrs = contentAttrs
    return changed
  }

  private showAnnouncements(trs: readonly Transaction[]) {
    let first = true
    for (let tr of trs) for (let effect of tr.effects) if (effect.is(EditorView.announce)) {
      if (first) this.announceDOM.textContent = ""
      first = false
      let div = this.announceDOM.appendChild(document.createElement("div"))
      div.textContent = effect.value
    }
  }

  private mountStyles() {
    this.styleModules = this.state.facet(styleModule)
    let nonce = this.state.facet(EditorView.cspNonce)
    StyleModule.mount(this.root, this.styleModules.concat(baseTheme).reverse(), nonce ? {nonce} : undefined)
  }

  private readMeasured() {
    if (this.updateState == UpdateState.Updating)
      throw new Error("Reading the editor layout isn't allowed during an update")
    if (this.updateState == UpdateState.Idle && this.measureScheduled > -1) this.measure(false)
  }

  /// Schedule a layout measurement, optionally providing callbacks to
  /// do custom DOM measuring followed by a DOM write phase. Using
  /// this is preferable reading DOM layout directly from, for
  /// example, an event handler, because it'll make sure measuring and
  /// drawing done by other components is synchronized, avoiding
  /// unnecessary DOM layout computations.
  requestMeasure<T>(request?: MeasureRequest<T>) {
    if (this.measureScheduled < 0)
      this.measureScheduled = this.win.requestAnimationFrame(() => this.measure())
    if (request) {
      if (this.measureRequests.indexOf(request) > -1) return
      if (request.key != null) for (let i = 0; i < this.measureRequests.length; i++) {
        if (this.measureRequests[i].key === request.key) {
          this.measureRequests[i] = request
          return
        }
      }
      this.measureRequests.push(request)
    }
  }

  /// Get the value of a specific plugin, if present. Note that
  /// plugins that crash can be dropped from a view, so even when you
  /// know you registered a given plugin, it is recommended to check
  /// the return value of this method.
  plugin<T extends PluginValue>(plugin: ViewPlugin<T, any>): T | null {
    let known = this.pluginMap.get(plugin)
    if (known === undefined || known && known.plugin != plugin)
      this.pluginMap.set(plugin, known = this.plugins.find(p => p.plugin == plugin) || null)
    return known && known.update(this).value as T
  }

  /// The top position of the document, in screen coordinates. This
  /// may be negative when the editor is scrolled down. Points
  /// directly to the top of the first line, not above the padding.
  get documentTop() {
    return this.contentDOM.getBoundingClientRect().top + this.viewState.paddingTop
  }

  /// Reports the padding above and below the document.
  get documentPadding() {
    return {top: this.viewState.paddingTop, bottom: this.viewState.paddingBottom}
  }

  /// If the editor is transformed with CSS, this provides the scale
  /// along the X axis. Otherwise, it will just be 1. Note that
  /// transforms other than translation and scaling are not supported.
  get scaleX() { return this.viewState.scaleX }

  /// Provide the CSS transformed scale along the Y axis.
  get scaleY() { return this.viewState.scaleY }

  /// Find the text line or block widget at the given vertical
  /// position (which is interpreted as relative to the [top of the
  /// document](#view.EditorView.documentTop)).
  elementAtHeight(height: number) {
    this.readMeasured()
    return this.viewState.elementAtHeight(height)
  }

  /// Find the line block (see
  /// [`lineBlockAt`](#view.EditorView.lineBlockAt)) at the given
  /// height, again interpreted relative to the [top of the
  /// document](#view.EditorView.documentTop).
  lineBlockAtHeight(height: number): BlockInfo {
    this.readMeasured()
    return this.viewState.lineBlockAtHeight(height)
  }

  /// Get the extent and vertical position of all [line
  /// blocks](#view.EditorView.lineBlockAt) in the viewport. Positions
  /// are relative to the [top of the
  /// document](#view.EditorView.documentTop);
  get viewportLineBlocks() {
    return this.viewState.viewportLines
  }

  /// Find the line block around the given document position. A line
  /// block is a range delimited on both sides by either a
  /// non-[hidden](#view.Decoration^replace) line break, or the
  /// start/end of the document. It will usually just hold a line of
  /// text, but may be broken into multiple textblocks by block
  /// widgets.
  lineBlockAt(pos: number): BlockInfo {
    return this.viewState.lineBlockAt(pos)
  }

  /// The editor's total content height.
  get contentHeight() {
    return this.viewState.contentHeight
  }

  /// Move a cursor position by [grapheme
  /// cluster](#state.findClusterBreak). `forward` determines whether
  /// the motion is away from the line start, or towards it. In
  /// bidirectional text, the line is traversed in visual order, using
  /// the editor's [text direction](#view.EditorView.textDirection).
  /// When the start position was the last one on the line, the
  /// returned position will be across the line break. If there is no
  /// further line, the original position is returned.
  ///
  /// By default, this method moves over a single cluster. The
  /// optional `by` argument can be used to move across more. It will
  /// be called with the first cluster as argument, and should return
  /// a predicate that determines, for each subsequent cluster,
  /// whether it should also be moved over.
  moveByChar(start: SelectionRange, forward: boolean, by?: (initial: string) => (next: string) => boolean) {
    return skipAtoms(this, start, moveByChar(this, start, forward, by))
  }

  /// Move a cursor position across the next group of either
  /// [letters](#state.EditorState.charCategorizer) or non-letter
  /// non-whitespace characters.
  moveByGroup(start: SelectionRange, forward: boolean) {
    return skipAtoms(this, start, moveByChar(this, start, forward, initial => byGroup(this, start.head, initial)))
  }

  /// Get the cursor position visually at the start or end of a line.
  /// Note that this may differ from the _logical_ position at its
  /// start or end (which is simply at `line.from`/`line.to`) if text
  /// at the start or end goes against the line's base text direction.
  visualLineSide(line: Line, end: boolean) {
    let order = this.bidiSpans(line), dir = this.textDirectionAt(line.from)
    let span = order[end ? order.length - 1 : 0]
    return EditorSelection.cursor(span.side(end, dir) + line.from, span.forward(!end, dir) ? 1 : -1)
  }

  /// Move to the next line boundary in the given direction. If
  /// `includeWrap` is true, line wrapping is on, and there is a
  /// further wrap point on the current line, the wrap point will be
  /// returned. Otherwise this function will return the start or end
  /// of the line.
  moveToLineBoundary(start: SelectionRange, forward: boolean, includeWrap = true) {
    return moveToLineBoundary(this, start, forward, includeWrap)
  }

  /// Move a cursor position vertically. When `distance` isn't given,
  /// it defaults to moving to the next line (including wrapped
  /// lines). Otherwise, `distance` should provide a positive distance
  /// in pixels.
  ///
  /// When `start` has a
  /// [`goalColumn`](#state.SelectionRange.goalColumn), the vertical
  /// motion will use that as a target horizontal position. Otherwise,
  /// the cursor's own horizontal position is used. The returned
  /// cursor will have its goal column set to whichever column was
  /// used.
  moveVertically(start: SelectionRange, forward: boolean, distance?: number) {
    return skipAtoms(this, start, moveVertically(this, start, forward, distance))
  }

  /// Find the DOM parent node and offset (child offset if `node` is
  /// an element, character offset when it is a text node) at the
  /// given document position.
  ///
  /// Note that for positions that aren't currently in
  /// `visibleRanges`, the resulting DOM position isn't necessarily
  /// meaningful (it may just point before or after a placeholder
  /// element).
  domAtPos(pos: number, side: -1 | 1 = 1): {node: Node, offset: number} {
    return this.docView.domAtPos(pos, side)
  }

  /// Find the document position at the given DOM node. Can be useful
  /// for associating positions with DOM events. Will raise an error
  /// when `node` isn't part of the editor content.
  posAtDOM(node: Node, offset: number = 0) {
    return this.docView.posFromDOM(node, offset)
  }

  /// Get the document position at the given screen coordinates. For
  /// positions not covered by the visible viewport's DOM structure,
  /// this will return null, unless `false` is passed as second
  /// argument, in which case it'll return an estimated position that
  /// would be near the coordinates if it were rendered.
  posAtCoords(coords: {x: number, y: number}, precise: false): number
  posAtCoords(coords: {x: number, y: number}): number | null
  posAtCoords(coords: {x: number, y: number}, precise = true): number | null {
    this.readMeasured()
    let found = posAtCoords(this, coords, precise)
    return found && found.pos
  }

  /// Like [`posAtCoords`](#view.EditorView.posAtCoords), but also
  /// returns which side of the position the coordinates are closest
  /// to. For example, for coordinates on the left side of a
  /// left-to-right character, the position before that letter is
  /// returned, with `assoc` 1, whereas on the right side, you'd get
  /// the position after the character, with `assoc` -1.
  posAndSideAtCoords(coords: {x: number, y: number}, precise: false): {pos: number, assoc: -1 | 1}
  posAndSideAtCoords(coords: {x: number, y: number}): {pos: number, assoc: -1 | 1} | null
  posAndSideAtCoords(coords: {x: number, y: number}, precise = true): {pos: number, assoc: -1 | 1} | null {
    this.readMeasured()
    return posAtCoords(this, coords, precise)
  }

  /// Get the screen coordinates at the given document position.
  /// `side` determines whether the coordinates are based on the
  /// element before (-1) or after (1) the position (if no element is
  /// available on the given side, the method will transparently use
  /// another strategy to get reasonable coordinates).
  coordsAtPos(pos: number, side: -1 | 1 = 1): Rect | null {
    this.readMeasured()
    let line = this.state.doc.lineAt(pos), order = this.bidiSpans(line)
    let span = order[BidiSpan.find(order, pos - line.from, -1, side)]
    return this.docView.coordsAt(pos, side, span.dir == Direction.RTL)
  }

  /// Return the rectangle around a given character. If `pos` does not
  /// point in front of a character that is in the viewport and
  /// rendered (i.e. not replaced, not a line break), this will return
  /// null. For space characters that are a line wrap point, this will
  /// return the position before the line break.
  coordsForChar(pos: number): Rect | null {
    this.readMeasured()
    return this.docView.coordsForChar(pos)
  }

  /// The default width of a character in the editor. May not
  /// accurately reflect the width of all characters (given variable
  /// width fonts or styling of invididual ranges).
  get defaultCharacterWidth() { return this.viewState.heightOracle.charWidth }

  /// The default height of a line in the editor. May not be accurate
  /// for all lines.
  get defaultLineHeight() { return this.viewState.heightOracle.lineHeight }

  /// The text direction
  /// ([`direction`](https://developer.mozilla.org/en-US/docs/Web/CSS/direction)
  /// CSS property) of the editor's content element.
  get textDirection(): Direction { return this.viewState.defaultTextDirection }

  /// Find the text direction of the block at the given position, as
  /// assigned by CSS. If
  /// [`perLineTextDirection`](#view.EditorView^perLineTextDirection)
  /// isn't enabled, or the given position is outside of the viewport,
  /// this will always return the same as
  /// [`textDirection`](#view.EditorView.textDirection). Note that
  /// this may trigger a DOM layout.
  textDirectionAt(pos: number) {
    let perLine = this.state.facet(perLineTextDirection)
    if (!perLine || pos < this.viewport.from || pos > this.viewport.to) return this.textDirection
    this.readMeasured()
    return this.docView.textDirectionAt(pos)
  }

  /// Whether this editor [wraps lines](#view.EditorView.lineWrapping)
  /// (as determined by the
  /// [`white-space`](https://developer.mozilla.org/en-US/docs/Web/CSS/white-space)
  /// CSS property of its content element).
  get lineWrapping(): boolean { return this.viewState.heightOracle.lineWrapping }

  /// Returns the bidirectional text structure of the given line
  /// (which should be in the current document) as an array of span
  /// objects. The order of these spans matches the [text
  /// direction](#view.EditorView.textDirection)—if that is
  /// left-to-right, the leftmost spans come first, otherwise the
  /// rightmost spans come first.
  bidiSpans(line: Line) {
    if (line.length > MaxBidiLine) return trivialOrder(line.length)
    let dir = this.textDirectionAt(line.from), isolates: readonly Isolate[] | undefined
    for (let entry of this.bidiCache) {
      if (entry.from == line.from && entry.dir == dir &&
          (entry.fresh || isolatesEq(entry.isolates, isolates = getIsolatedRanges(this, line))))
        return entry.order
    }
    if (!isolates) isolates = getIsolatedRanges(this, line)
    let order = computeOrder(line.text, dir, isolates)
    this.bidiCache.push(new CachedOrder(line.from, line.to, dir, isolates, true, order))
    return order
  }

  /// Check whether the editor has focus.
  get hasFocus(): boolean {
    // Safari return false for hasFocus when the context menu is open
    // or closing, which leads us to ignore selection changes from the
    // context menu because it looks like the editor isn't focused.
    // This kludges around that.
    return (this.dom.ownerDocument.hasFocus() || browser.safari && this.inputState?.lastContextMenu > Date.now() - 3e4) &&
      this.root.activeElement == this.contentDOM
  }

  /// Put focus on the editor.
  focus() {
    this.observer.ignore(() => {
      focusPreventScroll(this.contentDOM)
      this.docView.updateSelection()
    })
  }

  /// Update the [root](##view.EditorViewConfig.root) in which the editor lives. This is only
  /// necessary when moving the editor's existing DOM to a new window or shadow root.
  setRoot(root: Document | ShadowRoot) {
    if (this._root != root) {
      this._root = root
      this.observer.setWindow((root.nodeType == 9 ? root as Document : root.ownerDocument!).defaultView || window)
      this.controlledTouchScrollController.setWindow()
      this.mountStyles()
    }
  }

  /// Clean up this editor view, removing its element from the
  /// document, unregistering event handlers, and notifying
  /// plugins. The view instance can no longer be used after
  /// calling this.
  destroy() {
    if (this.root.activeElement == this.contentDOM) this.contentDOM.blur()
    this.controlledTouchScrollController.destroy()
    for (let plugin of this.plugins) plugin.destroy(this)
    this.plugins = []
    this.inputState.destroy()
    this.docView.destroy()
    this.dom.remove()
    this.observer.destroy()
    if (this.measureScheduled > -1) this.win.cancelAnimationFrame(this.measureScheduled)
    this.destroyed = true
  }

  /// Returns an effect that can be
  /// [added](#state.TransactionSpec.effects) to a transaction to
  /// cause it to scroll the given position or range into view.
  static scrollIntoView(pos: number | SelectionRange, options: {
    /// By default (`"nearest"`) the position will be vertically
    /// scrolled only the minimal amount required to move the given
    /// position into view. You can set this to `"start"` to move it
    /// to the top of the view, `"end"` to move it to the bottom, or
    /// `"center"` to move it to the center.
    y?: ScrollStrategy,
    /// Effect similar to
    /// [`y`](#view.EditorView^scrollIntoView^options.y), but for the
    /// horizontal scroll position.
    x?: ScrollStrategy,
    /// Extra vertical distance to add when moving something into
    /// view. Not used with the `"center"` strategy. Defaults to 5.
    /// Must be less than the height of the editor.
    yMargin?: number,
    /// Extra horizontal distance to add. Not used with the `"center"`
    /// strategy. Defaults to 5. Must be less than the width of the
    /// editor.
    xMargin?: number,
  } = {}): StateEffect<unknown> {
    return scrollIntoView.of(new ScrollTarget(typeof pos == "number" ? EditorSelection.cursor(pos) : pos,
                                              options.y ?? "nearest", options.x ?? "nearest",
                                              options.yMargin ?? 5, options.xMargin ?? 5))
  }

  /// Return an effect that resets the editor to its current (at the
  /// time this method was called) scroll position. Note that this
  /// only affects the editor's own scrollable element, not parents.
  /// See also
  /// [`EditorViewConfig.scrollTo`](#view.EditorViewConfig.scrollTo).
  ///
  /// The effect should be used with a document identical to the one
  /// it was created for. Failing to do so is not an error, but may
  /// not scroll to the expected position. You can
  /// [map](#state.StateEffect.map) the effect to account for changes.
  scrollSnapshot() {
    let {scrollTop, scrollLeft} = this.scrollDOM
    let ref = this.viewState.scrollAnchorAt(scrollTop)
    return scrollIntoView.of(new ScrollTarget(EditorSelection.cursor(ref.from), "start", "start",
                                              ref.top - scrollTop, scrollLeft, true))
  }

  /// Enable or disable tab-focus mode, which disables key bindings
  /// for Tab and Shift-Tab, letting the browser's default
  /// focus-changing behavior go through instead. This is useful to
  /// prevent trapping keyboard users in your editor.
  ///
  /// Without argument, this toggles the mode. With a boolean, it
  /// enables (true) or disables it (false). Given a number, it
  /// temporarily enables the mode until that number of milliseconds
  /// have passed or another non-Tab key is pressed.
  setTabFocusMode(to?: boolean | number) {
    if (to == null)
      this.inputState.tabFocusMode = this.inputState.tabFocusMode < 0 ? 0 : -1
    else if (typeof to == "boolean")
      this.inputState.tabFocusMode = to ? 0 : -1
    else if (this.inputState.tabFocusMode != 0)
      this.inputState.tabFocusMode = Date.now() + to
  }

  /// Facet to add a [style
  /// module](https://code.haverbeke.berlin/marijn/style-mod#documentation) to
  /// an editor view. The view will ensure that the module is
  /// mounted in its [document
  /// root](#view.EditorView.constructor^config.root).
  static styleModule = styleModule

  /// Returns an extension that can be used to add DOM event handlers.
  /// The value should be an object mapping event names to handler
  /// functions. For any given event, such functions are ordered by
  /// extension precedence, and the first handler to return true will
  /// be assumed to have handled that event, and no other handlers or
  /// built-in behavior will be activated for it. These are registered
  /// on the [content element](#view.EditorView.contentDOM), except
  /// for `scroll` handlers, which will be called any time the
  /// editor's [scroll element](#view.EditorView.scrollDOM) or one of
  /// its parent nodes is scrolled.
  static domEventHandlers(handlers: DOMEventHandlers<any>): Extension {
    return ViewPlugin.define(() => ({}), {eventHandlers: handlers})
  }

  /// Create an extension that registers DOM event observers. Contrary
  /// to event [handlers](#view.EditorView^domEventHandlers),
  /// observers can't be prevented from running by a higher-precedence
  /// handler returning true. They also don't prevent other handlers
  /// and observers from running when they return true, and should not
  /// call `preventDefault`.
  static domEventObservers(observers: DOMEventHandlers<any>): Extension {
    return ViewPlugin.define(() => ({}), {eventObservers: observers})
  }

  /// An input handler can override the way changes to the editable
  /// DOM content are handled. Handlers are passed the document
  /// positions between which the change was found, and the new
  /// content. When one returns true, no further input handlers are
  /// called and the default behavior is prevented.
  ///
  /// The `insert` argument can be used to get the default transaction
  /// that would be applied for this input. This can be useful when
  /// dispatching the custom behavior as a separate transaction.
  static inputHandler = inputHandler

  /// Functions provided in this facet will be used to transform text
  /// pasted or dropped into the editor.
  static clipboardInputFilter = clipboardInputFilter

  /// Transform text copied or dragged from the editor.
  static clipboardOutputFilter = clipboardOutputFilter

  /// Scroll handlers can override how things are scrolled into view.
  /// If they return `true`, no further handling happens for the
  /// scrolling. If they return false, the default scroll behavior is
  /// applied. Scroll handlers should never initiate editor updates.
  static scrollHandler = scrollHandler

  /// Configure a capped, directional viewport buffer while scrolling.
  static viewportBuffer: Facet<ViewportBufferConfig, any> = viewportBuffer

  /// Configure render-gated vertical touch scrolling on Android Chromium.
  static controlledTouchScroll: Facet<ControlledTouchScrollConfig, any> = controlledTouchScroll

  /// This facet can be used to provide functions that create effects
  /// to be dispatched when the editor's focus state changes.
  static focusChangeEffect = focusChangeEffect

  /// By default, the editor assumes all its content has the same
  /// [text direction](#view.Direction). Configure this with a `true`
  /// value to make it read the text direction of every (rendered)
  /// line separately.
  static perLineTextDirection = perLineTextDirection

  /// Allows you to provide a function that should be called when the
  /// library catches an exception from an extension (mostly from view
  /// plugins, but may be used by other extensions to route exceptions
  /// from user-code-provided callbacks). This is mostly useful for
  /// debugging and logging. See [`logException`](#view.logException).
  static exceptionSink = exceptionSink

  /// A facet that can be used to register a function to be called
  /// every time the view updates.
  static updateListener = updateListener

  /// Facet that controls whether the editor content DOM is editable.
  /// When its highest-precedence value is `false`, the element will
  /// not have its `contenteditable` attribute set. (Note that this
  /// doesn't affect API calls that change the editor content, even
  /// when those are bound to keys or buttons. See the
  /// [`readOnly`](#state.EditorState.readOnly) facet for that.)
  static editable = editable

  /// Allows you to influence the way mouse selection happens. The
  /// functions in this facet will be called for a `mousedown` event
  /// on the editor, and can return an object that overrides the way a
  /// selection is computed from that mouse click or drag.
  static mouseSelectionStyle = mouseSelectionStyle

  /// Facet used to configure whether a given selection drag event
  /// should move or copy the selection. The given predicate will be
  /// called with the `mousedown` event, and can return `true` when
  /// the drag should move the content.
  static dragMovesSelection = dragMovesSelection

  /// Facet used to configure whether a given selecting click adds a
  /// new range to the existing selection or replaces it entirely. The
  /// default behavior is to check `event.metaKey` on macOS, and
  /// `event.ctrlKey` elsewhere.
  static clickAddsSelectionRange = clickAddsSelectionRange

  /// A facet that determines which [decorations](#view.Decoration)
  /// are shown in the view. Decorations can be provided in two
  /// ways—directly, or via a function that takes an editor view.
  ///
  /// Only decoration sets provided directly are allowed to influence
  /// the editor's vertical layout structure. The ones provided as
  /// functions are called _after_ the new viewport has been computed,
  /// and thus **must not** introduce block widgets or replacing
  /// decorations that cover line breaks.
  ///
  /// If you want decorated ranges to behave like atomic units for
  /// cursor motion and deletion purposes, also provide the range set
  /// containing the decorations to
  /// [`EditorView.atomicRanges`](#view.EditorView^atomicRanges).
  static decorations = decorations

  /// [Block wrappers](#view.BlockWrapper) provide a way to add DOM
  /// structure around editor lines and block widgets. Sets of
  /// wrappers are provided in a similar way to decorations, and are
  /// nested in a similar way when they overlap. A wrapper affects all
  /// lines and block widgets that start inside its range.
  static blockWrappers = blockWrappers

  /// Facet that works much like
  /// [`decorations`](#view.EditorView^decorations), but puts its
  /// inputs at the very bottom of the precedence stack, meaning mark
  /// decorations provided here will only be split by other, partially
  /// overlapping `outerDecorations` ranges, and wrap around all
  /// regular decorations. Use this for mark elements that should, as
  /// much as possible, remain in one piece.
  static outerDecorations = outerDecorations

  /// Used to provide ranges that should be treated as atoms as far as
  /// cursor motion is concerned. This causes methods like
  /// [`moveByChar`](#view.EditorView.moveByChar) and
  /// [`moveVertically`](#view.EditorView.moveVertically) (and the
  /// commands built on top of them) to skip across such regions when
  /// a selection endpoint would enter them. This does _not_ prevent
  /// direct programmatic [selection
  /// updates](#state.TransactionSpec.selection) from moving into such
  /// regions.
  static atomicRanges = atomicRanges

  /// When range decorations add a `unicode-bidi: isolate` style, they
  /// should also include a
  /// [`bidiIsolate`](#view.MarkDecorationSpec.bidiIsolate) property
  /// in their decoration spec, and be exposed through this facet, so
  /// that the editor can compute the proper text order. (Other values
  /// for `unicode-bidi`, except of course `normal`, are not
  /// supported.)
  static bidiIsolatedRanges = bidiIsolatedRanges

  /// Can be used to specify the distance that scrolling cursor into
  /// view keeps it away from the sides of the editor, either as a
  /// single pixel number or two different values for the different
  /// axes. Defaults to 5 pixels on both axes.
  static cursorScrollMargin = Facet.define<number | {x: number, y: number}, {x: number, y: number}>({
    combine: inputs => {
      let x = 5, y = 5
      for (let i of inputs) {
        if (typeof i == "number") x = y = i
        else ({x, y} = i)
      }
      return {x, y}
    }
  })

  /// Facet that allows extensions to provide additional scroll
  /// margins (space around the sides of the scrolling element that
  /// should be considered invisible). This can be useful when the
  /// plugin introduces elements that cover part of that element (for
  /// example a horizontally fixed gutter). Not to be confused with
  /// [`cursorScrollMargin`](#view.EditorView^cursorScrollMargin).
  static scrollMargins = scrollMargins

  /// Create a theme extension. The first argument can be a
  /// [`style-mod`](https://code.haverbeke.berlin/marijn/style-mod#documentation)
  /// style spec providing the styles for the theme. These will be
  /// prefixed with a generated class for the style.
  ///
  /// Because the selectors will be prefixed with a scope class, rule
  /// that directly match the editor's [wrapper
  /// element](#view.EditorView.dom)—to which the scope class will be
  /// added—need to be explicitly differentiated by adding an `&` to
  /// the selector for that element—for example
  /// `&.cm-focused`.
  ///
  /// When `dark` is set to true, the theme will be marked as dark,
  /// which will cause the `&dark` rules from [base
  /// themes](#view.EditorView^baseTheme) to be used (as opposed to
  /// `&light` when a light theme is active).
  static theme(spec: {[selector: string]: StyleSpec}, options?: {dark?: boolean}): Extension {
    let prefix = StyleModule.newName()
    let result = [theme.of(prefix), styleModule.of(buildTheme(`.${prefix}`, spec))]
    if (options && options.dark) result.push(darkTheme.of(true))
    return result
  }

  /// This facet records whether a dark theme is active. The extension
  /// returned by [`theme`](#view.EditorView^theme) automatically
  /// includes an instance of this when the `dark` option is set to
  /// true.
  static darkTheme = darkTheme

  /// Create an extension that adds styles to the base theme. Like
  /// with [`theme`](#view.EditorView^theme), use `&` to indicate the
  /// place of the editor wrapper element when directly targeting
  /// that. You can also use `&dark` or `&light` instead to only
  /// target editors with a dark or light theme.
  static baseTheme(spec: {[selector: string]: StyleSpec}): Extension {
    return Prec.lowest(styleModule.of(buildTheme("." + baseThemeID, spec, lightDarkIDs)))
  }

  /// Provides a Content Security Policy nonce to use when creating
  /// the style sheets for the editor. Holds the empty string when no
  /// nonce has been provided.
  static cspNonce = Facet.define<string, string>({combine: values => values.length ? values[0] : ""})

  /// Facet that provides additional DOM attributes for the editor's
  /// editable DOM element.
  static contentAttributes = contentAttributes

  /// Facet that provides DOM attributes for the editor's outer
  /// element.
  static editorAttributes = editorAttributes

  /// An extension that enables line wrapping in the editor (by
  /// setting CSS `white-space` to `pre-wrap` in the content).
  static lineWrapping = EditorView.contentAttributes.of({"class": "cm-lineWrapping"})

  /// State effect used to include screen reader announcements in a
  /// transaction. These will be added to the DOM in a visually hidden
  /// element with `aria-live="polite"` set, and should be used to
  /// describe effects that are visually obvious but may not be
  /// noticed by screen reader users (such as moving to the next
  /// search match).
  static announce = StateEffect.define<string>()

  /// Retrieve an editor view instance from the view's DOM
  /// representation.
  static findFromDOM(dom: HTMLElement): EditorView | null {
    let content = dom.querySelector(".cm-content")
    let tile = content && Tile.get(content) || Tile.get(dom)
    return tile?.root?.view || null
  }
}

/// Helper type that maps event names to event object types, or the
/// `any` type for unknown events.
export interface DOMEventMap extends HTMLElementEventMap {
  [other: string]: any
}

/// Event handlers are specified with objects like this. For event
/// types known by TypeScript, this will infer the event argument type
/// to hold the appropriate event object type. For unknown events, it
/// is inferred to `any`, and should be explicitly set if you want type
/// checking.
export type DOMEventHandlers<This> = {
  [event in keyof DOMEventMap]?: (this: This, event: DOMEventMap[event], view: EditorView) => boolean | void
}

// Maximum line length for which we compute accurate bidi info
const MaxBidiLine = 4096

const BadMeasure = {}

class CachedOrder {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly dir: Direction,
    readonly isolates: readonly Isolate[],
    readonly fresh: boolean,
    readonly order: readonly BidiSpan[]
  ) {}

  static update(cache: CachedOrder[], changes: ChangeDesc) {
    if (changes.empty && !cache.some(c => c.fresh)) return cache
    let result = [], lastDir = cache.length ? cache[cache.length - 1].dir : Direction.LTR
    for (let i = Math.max(0, cache.length - 10); i < cache.length; i++) {
      let entry = cache[i]
      if (entry.dir == lastDir && !changes.touchesRange(entry.from, entry.to))
        result.push(new CachedOrder(changes.mapPos(entry.from, 1), changes.mapPos(entry.to, -1),
                                    entry.dir, entry.isolates, false, entry.order))
    }
    return result
  }
}

function attrsFromFacet(view: EditorView, facet: Facet<AttrSource>, base: Attrs) {
  for (let sources = view.state.facet(facet), i = sources.length - 1; i >= 0; i--) {
    let source = sources[i], value = typeof source == "function" ? source(view) : source
    if (value) combineAttrs(value, base)
  }
  return base
}
