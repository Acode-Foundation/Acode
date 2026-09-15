import {Text, EditorState, ChangeSet, ChangeDesc, RangeSet, EditorSelection} from "@codemirror/state"
import {Rect, isScrolledToBottom, getScale, scrollableParents} from "./dom"
import {HeightMap, HeightOracle, BlockInfo, MeasuredHeights, QueryType, heightRelevantDecoChanges,
        clearHeightChangeFlag, heightChangeFlag} from "./heightmap"
import {decorations, outerDecorations, ViewUpdate, UpdateFlag, ChangedRange, ScrollTarget, nativeSelectionHidden,
        contentAttributes, viewportBuffer} from "./extension"
import {WidgetType, Decoration, DecorationSet, BlockType} from "./decoration"
import {EditorView} from "./editorview"
import {Direction} from "./bidi"

function visiblePixelRange(dom: HTMLElement, paddingTop: number): Rect {
  let rect = dom.getBoundingClientRect()
  let doc = dom.ownerDocument, win = doc.defaultView || window
  let left = Math.max(0, rect.left), right = Math.min(win.innerWidth, rect.right)
  let top = Math.max(0, rect.top), bottom = Math.min(win.innerHeight, rect.bottom)
  for (let parent = dom.parentNode as Node | null; parent && parent != doc.body;) {
    if (parent.nodeType == 1) {
      let elt = parent as HTMLElement
      let style = window.getComputedStyle(elt)
      if ((elt.scrollHeight > elt.clientHeight || elt.scrollWidth > elt.clientWidth) &&
          style.overflow != "visible") {
        let parentRect = elt.getBoundingClientRect()
        left = Math.max(left, parentRect.left)
        right = Math.min(right, parentRect.right)
        top = Math.max(top, parentRect.top)
        bottom = Math.min(parent == dom.parentNode ? win.innerHeight : bottom, parentRect.bottom)
      }
      parent = style.position == "absolute" || style.position == "fixed" ? elt.offsetParent : elt.parentNode
    } else if (parent.nodeType == 11) { // Shadow root
      parent = (parent as ShadowRoot).host
    } else {
      break
    }
  }

  return {left: left - rect.left, right: Math.max(left, right) - rect.left,
          top: top - (rect.top + paddingTop), bottom: Math.max(top, bottom) - (rect.top + paddingTop)}
}

function inWindow(elt: HTMLElement) {
  let rect = elt.getBoundingClientRect(), win = elt.ownerDocument.defaultView || window
  return rect.left < win.innerWidth && rect.right > 0 &&
    rect.top < win.innerHeight && rect.bottom > 0
}

function fullPixelRange(dom: HTMLElement, paddingTop: number): Rect {
  let rect = dom.getBoundingClientRect()
  return {left: 0, right: rect.right - rect.left,
          top: paddingTop, bottom: rect.bottom - (rect.top + paddingTop)}
}

const enum VP {
  Margin = 1000,
  // coveredBy requires at least this many extra pixels to be covered
  MinCoverMargin = 10,
  MaxCoverMargin = VP.Margin / 4,
  // Beyond this size, DOM layout starts to break down in browsers
  // because they use fixed-precision numbers to store dimensions.
  MaxDOMHeight = 7e6,
  MaxHorizGap = 2e6
}

// Line gaps are placeholder widgets used to hide pieces of overlong
// lines within the viewport, as a kludge to keep the editor
// responsive when a ridiculously long line is loaded into it.
export class LineGap {
  constructor(readonly from: number, readonly to: number, readonly size: number, readonly displaySize: number) {}

  static same(a: readonly LineGap[], b: readonly LineGap[]) {
    if (a.length != b.length) return false
    for (let i = 0; i < a.length; i++) {
      let gA = a[i], gB = b[i]
      if (gA.from != gB.from || gA.to != gB.to || gA.size != gB.size) return false
    }
    return true
  }

  draw(viewState: ViewState, wrapping: boolean) {
    return Decoration.replace({
      widget: new LineGapWidget(this.displaySize * (wrapping ? viewState.scaleY : viewState.scaleX), wrapping)
    }).range(this.from, this.to)
  }
}

class LineGapWidget extends WidgetType {
  constructor(readonly size: number,
              readonly vertical: boolean) { super() }

  eq(other: LineGapWidget) { return other.size == this.size && other.vertical == this.vertical }

  toDOM() {
    let elt = document.createElement("div")
    if (this.vertical) {
      elt.style.height = this.size + "px"
    } else {
      elt.style.width = this.size + "px"
      elt.style.height = "2px"
      elt.style.display = "inline-block"
    }
    return elt
  }

  get estimatedHeight() { return this.vertical ? this.size : -1 }
}

const enum LG {
  Margin = 2000,
  MarginWrap = 10000,
  SelectionMargin = 10,
}

/// @internal
export function applyViewportBuffer(marginTop: number, marginBottom: number, maxAhead: number,
                                    direction: number, active: boolean, editorHeight: number, scaleY: number) {
  if (active && direction) {
    let ahead = Math.max(VP.Margin / 2, editorHeight * maxAhead * scaleY)
    if (direction < 0) marginTop = Math.max(marginTop, ahead)
    else marginBottom = Math.max(marginBottom, ahead)
  }
  return {top: marginTop, bottom: marginBottom}
}

export class ViewState {
  // These are contentDOM-local coordinates
  pixelViewport: Rect = {left: 0, right: window.innerWidth, top: 0, bottom: 0}
  inView = true
  private scrollDirection = 0
  private viewportBufferUntil = 0
  private controlledScrollCorridor: {from: number, to: number} | null = null

  paddingTop = 0 // Padding above the document, scaled
  paddingBottom = 0 // Padding below the document, scaled
  contentDOMWidth = 0 // contentDOM.getBoundingClientRect().width
  contentDOMHeight = 0 // contentDOM.getBoundingClientRect().height
  editorHeight = 0 // scrollDOM.clientHeight, unscaled
  editorWidth = 0 // scrollDOM.clientWidth, unscaled
  // The CSS-transformation scale of the editor (transformed size /
  // concrete size)
  scaleX = 1
  scaleY = 1

  // The nearest vertically-scrollable parent. null means window is nearest
  scrollParent: HTMLElement | null
  // Last seen vertical offset of the element at the top of the scroll
  // container, or top of the window if there's no wrapping scroller
  scrollOffset = 0
  scrolledToBottom = false
  // The vertical position (document-relative) to which to anchor the
  // scroll position. -1 means anchor to the end of the document.
  scrollAnchorPos = 0
  // The height at the anchor position. Set by the DOM update phase.
  // -1 means no height available.
  scrollAnchorHeight = -1

  heightOracle: HeightOracle
  heightMap: HeightMap
  // See VP.MaxDOMHeight
  scaler = IdScaler

  scrollTarget: ScrollTarget | null = null
  // Briefly set to true when printing, to disable viewport limiting
  printing = false
  // Flag set when editor content was redrawn, so that the next
  // measure stage knows it must read DOM layout
  mustMeasureContent: boolean | "refresh" = true

  stateDeco: readonly DecorationSet[]
  declare viewportLines: BlockInfo[]
  defaultTextDirection: Direction = Direction.LTR

  // The main viewport for the visible part of the document
  declare viewport: Viewport
  // If the main selection starts or ends outside of the main
  // viewport, extra single-line viewports are created for these
  // points, so that the DOM selection doesn't fall in a gap.
  declare viewports: readonly Viewport[]
  visibleRanges: readonly {from: number, to: number}[] = []
  lineGaps: readonly LineGap[]
  lineGapDeco: DecorationSet

  // Cursor 'assoc' is only significant when the cursor is on a line
  // wrap point, where it must stick to the character that it is
  // associated with. Since browsers don't provide a reasonable
  // interface to set or query this, when a selection is set that
  // might cause this to be significant, this flag is set. The next
  // measure phase will check whether the cursor is on a line-wrapping
  // boundary and, if so, reset it to make sure it is positioned in
  // the right place.
  mustEnforceCursorAssoc = false

  constructor(public view: EditorView, public state: EditorState) {
    let guessWrapping = state.facet(contentAttributes).some(v => typeof v != "function" && v.class == "cm-lineWrapping")
    this.heightOracle = new HeightOracle(guessWrapping)
    this.stateDeco = staticDeco(state)
    this.heightMap = HeightMap.empty().applyChanges(this.stateDeco, Text.empty, this.heightOracle.setDoc(state.doc),
                                                    [new ChangedRange(0, 0, 0, state.doc.length)])
    for (let i = 0; i < 2; i++) {
      this.viewport = this.getViewport(0, null)
      if (!this.updateForViewport()) break
    }
    this.updateViewportLines()
    this.lineGaps = this.ensureLineGaps([])
    this.lineGapDeco = Decoration.set(this.lineGaps.map(gap => gap.draw(this, false)))
    this.scrollParent = view.scrollDOM
    this.computeVisibleRanges()
  }

  updateForViewport() {
    let viewports = [this.viewport], {main} = this.state.selection
    for (let i = 0; i <= 1; i++) {
      let pos = i ? main.head : main.anchor
      if (!viewports.some(({from, to}) => pos >= from && pos <= to)) {
        let {from, to} = this.lineBlockAt(pos)
        viewports.push(new Viewport(from, to))
      }
    }
    this.viewports = viewports.sort((a, b) => a.from - b.from)
    return this.updateScaler()
  }

  updateScaler() {
    let scaler = this.scaler
    this.scaler = this.heightMap.height <= VP.MaxDOMHeight ? IdScaler :
      new BigScaler(this.heightOracle, this.heightMap, this.viewports)
    return scaler.eq(this.scaler) ? 0 : UpdateFlag.Height
  }

  updateViewportLines() {
    this.viewportLines = []
    this.heightMap.forEachLine(this.viewport.from, this.viewport.to, this.heightOracle.setDoc(this.state.doc),
                               0, 0, block => {
      this.viewportLines.push(scaleBlock(block, this.scaler))
    })
  }

  update(update: ViewUpdate, scrollTarget: ScrollTarget | null = null) {
    this.state = update.state
    if (!this.state.facet(viewportBuffer)) {
      this.scrollDirection = 0
      this.viewportBufferUntil = 0
    }
    let prevDeco = this.stateDeco
    this.stateDeco = staticDeco(this.state)
    let contentChanges = update.changedRanges

    let heightChanges = ChangedRange.extendWithRanges(contentChanges, heightRelevantDecoChanges(
      prevDeco, this.stateDeco, update ? update.changes : ChangeSet.empty(this.state.doc.length)))
    let prevHeight = this.heightMap.height
    let scrollAnchor = this.scrolledToBottom ? null : this.scrollAnchorAt(this.scrollOffset)
    clearHeightChangeFlag()
    this.heightMap = this.heightMap.applyChanges(this.stateDeco, update.startState.doc,
                                                 this.heightOracle.setDoc(this.state.doc), heightChanges)
    if (this.heightMap.height != prevHeight || heightChangeFlag)
      update.flags |= UpdateFlag.Height
    if (scrollAnchor) {
      this.scrollAnchorPos = update.changes.mapPos(scrollAnchor.from, -1)
      this.scrollAnchorHeight = scrollAnchor.top
    } else {
      this.scrollAnchorPos = -1
      this.scrollAnchorHeight = prevHeight
    }

    let viewport = heightChanges.length ? this.mapViewport(this.viewport, update.changes) : this.viewport
    if (scrollTarget && (scrollTarget.range.head < viewport.from || scrollTarget.range.head > viewport.to) ||
        !this.viewportIsAppropriate(viewport))
      viewport = this.getViewport(0, scrollTarget)

    let viewportChange = viewport.from != this.viewport.from || viewport.to != this.viewport.to
    this.viewport = viewport
    update.flags |= this.updateForViewport()
    if (viewportChange || !update.changes.empty || (update.flags & UpdateFlag.Height)) this.updateViewportLines()

    if (this.lineGaps.length || this.viewport.to - this.viewport.from > (LG.Margin << 1))
      this.updateLineGaps(this.ensureLineGaps(this.mapLineGaps(this.lineGaps, update.changes)))
    update.flags |= this.computeVisibleRanges(update.changes)

    if (scrollTarget) this.scrollTarget = scrollTarget

    if (!this.mustEnforceCursorAssoc && (update.selectionSet || update.focusChanged) && update.view.lineWrapping &&
        update.state.selection.main.empty && update.state.selection.main.assoc &&
        !update.state.facet(nativeSelectionHidden))
      this.mustEnforceCursorAssoc = true
  }

  measure() {
    let {view} = this, dom = view.contentDOM, style = window.getComputedStyle(dom)
    let oracle = this.heightOracle
    let whiteSpace = style.whiteSpace!
    this.defaultTextDirection = style.direction == "rtl" ? Direction.RTL : Direction.LTR

    let refresh = this.heightOracle.mustRefreshForWrapping(whiteSpace) || this.mustMeasureContent === "refresh"
    let domRect = dom.getBoundingClientRect()
    let measureContent = refresh || this.mustMeasureContent || this.contentDOMHeight != domRect.height
    this.contentDOMHeight = domRect.height
    this.mustMeasureContent = false
    let result = 0, bias = 0

    if (domRect.width && domRect.height) {
      let {scaleX, scaleY} = getScale(dom, domRect)
      if (scaleX > .005 && Math.abs(this.scaleX - scaleX) > .005 ||
          scaleY > .005 && Math.abs(this.scaleY - scaleY) > .005) {
        this.scaleX = scaleX; this.scaleY = scaleY
        result |= UpdateFlag.Geometry
        refresh = measureContent = true
      }
    }

    // Vertical padding
    let paddingTop = (parseInt(style.paddingTop!) || 0) * this.scaleY
    let paddingBottom = (parseInt(style.paddingBottom!) || 0) * this.scaleY
    if (this.paddingTop != paddingTop || this.paddingBottom != paddingBottom) {
      this.paddingTop = paddingTop
      this.paddingBottom = paddingBottom
      result |= UpdateFlag.Geometry | UpdateFlag.Height
    }
    if (this.editorWidth != view.scrollDOM.clientWidth) {
      if (oracle.lineWrapping) measureContent = true
      this.editorWidth = view.scrollDOM.clientWidth
      result |= UpdateFlag.Geometry
    }
    let scrollParent = scrollableParents(this.view.contentDOM, false).y
    if (scrollParent != this.scrollParent) {
      this.scrollParent = scrollParent
      this.scrollAnchorHeight = -1
      this.scrollOffset = 0
    }
    let scrollOffset = this.getScrollOffset()
    if (this.scrollOffset != scrollOffset) {
      this.scrollAnchorHeight = -1
      this.scrollOffset = scrollOffset
    }
    this.scrolledToBottom = isScrolledToBottom(this.scrollParent || view.win)

    // Pixel viewport
    let pixelViewport = (this.printing ? fullPixelRange : visiblePixelRange)(dom, this.paddingTop)
    let dTop = pixelViewport.top - this.pixelViewport.top, dBottom = pixelViewport.bottom - this.pixelViewport.bottom
    this.pixelViewport = pixelViewport
    let inView = this.pixelViewport.bottom > this.pixelViewport.top && this.pixelViewport.right > this.pixelViewport.left
    if (inView != this.inView) {
      this.inView = inView
      if (inView) measureContent = true
    }
    if (!this.inView && !this.scrollTarget && !inWindow(view.dom)) return 0

    let contentWidth = domRect.width
    if (this.contentDOMWidth != contentWidth || this.editorHeight != view.scrollDOM.clientHeight) {
      this.contentDOMWidth = domRect.width
      this.editorHeight = view.scrollDOM.clientHeight
      result |= UpdateFlag.Geometry
    }

    if (measureContent) {
      let lineHeights = view.docView.measureVisibleLineHeights(this.viewport)
      if (oracle.mustRefreshForHeights(lineHeights)) refresh = true
      if (refresh || oracle.lineWrapping && Math.abs(contentWidth - this.contentDOMWidth) > oracle.charWidth) {
        let {lineHeight, charWidth, textHeight} = view.docView.measureTextSize()
        refresh = lineHeight > 0 && oracle.refresh(whiteSpace, lineHeight, charWidth, textHeight,
                                                   Math.max(5, contentWidth / charWidth), lineHeights)
        if (refresh) {
          view.docView.minWidth = 0
          result |= UpdateFlag.Geometry
        }
      }

      if (dTop > 0 && dBottom > 0) bias = Math.max(dTop, dBottom)
      else if (dTop < 0 && dBottom < 0) bias = Math.min(dTop, dBottom)

      clearHeightChangeFlag()
      for (let vp of this.viewports) {
        let heights = vp.from == this.viewport.from ? lineHeights : view.docView.measureVisibleLineHeights(vp)
        this.heightMap = (
          refresh ? HeightMap.empty().applyChanges(this.stateDeco, Text.empty, this.heightOracle,
                                                   [new ChangedRange(0, 0, 0, view.state.doc.length)]) : this.heightMap
        ).updateHeight(oracle, 0, refresh, new MeasuredHeights(vp.from, heights))
      }
      if (heightChangeFlag) result |= UpdateFlag.Height
    }

    let viewportChange = !this.viewportIsAppropriate(this.viewport, bias) ||
      this.scrollTarget && (this.scrollTarget.range.head < this.viewport.from ||
                            this.scrollTarget.range.head > this.viewport.to)
    if (viewportChange) {
      if (result & UpdateFlag.Height) result |= this.updateScaler()
      this.viewport = this.getViewport(bias, this.scrollTarget)
      result |= this.updateForViewport()
    }
    if ((result & UpdateFlag.Height) || viewportChange)
      this.updateViewportLines()

    if (this.lineGaps.length || this.viewport.to - this.viewport.from > (LG.Margin << 1))
      this.updateLineGaps(this.ensureLineGaps(refresh ? [] : this.lineGaps, view))
    result |= this.computeVisibleRanges()

    if (this.mustEnforceCursorAssoc) {
      this.mustEnforceCursorAssoc = false
      // This is done in the read stage, because moving the selection
      // to a line end is going to trigger a layout anyway, so it
      // can't be a pure write. It should be rare that it does any
      // writing.
      view.docView.enforceCursorAssoc()
    }

    return result
  }

  get visibleTop() { return this.scaler.fromDOM(this.pixelViewport.top) }
  get visibleBottom() { return this.scaler.fromDOM(this.pixelViewport.bottom) }

  activateViewportBuffer(delta: number) {
    let config = this.state.facet(viewportBuffer)
    if (!config || Math.abs(delta) <= 1) return null
    this.scrollDirection = delta < 0 ? -1 : 1
    this.viewportBufferUntil = Date.now() + config.settleDelay
    return config.settleDelay
  }

  noteScrollActivity() {
    return this.activateViewportBuffer(this.getScrollOffset() - this.scrollOffset)
  }

  setControlledScrollCorridor(from: number, to: number) {
    let corridor = {
      from: Math.max(0, Math.min(from, this.docHeight)),
      to: Math.max(0, Math.min(to, this.docHeight))
    }
    if (corridor.to < corridor.from) [corridor.from, corridor.to] = [corridor.to, corridor.from]
    let current = this.controlledScrollCorridor
    if (current && Math.abs(current.from - corridor.from) < 1 && Math.abs(current.to - corridor.to) < 1)
      return false
    this.controlledScrollCorridor = corridor
    return true
  }

  clearControlledScrollCorridor() {
    if (!this.controlledScrollCorridor) return false
    this.controlledScrollCorridor = null
    return true
  }

  get controlledScrollActive() { return !!this.controlledScrollCorridor }

  controlledScrollBounds() {
    let lines = this.viewportLines, scale = this.scaleY || 1
    if (!lines.length) return {from: 0, to: 0}
    let maxScroll = Math.max(0, this.view.scrollDOM.scrollHeight - this.view.scrollDOM.clientHeight)
    let from = this.viewport.from == 0 ? 0 : Math.ceil(lines[0].top / scale + 2)
    let to = this.viewport.to == this.state.doc.length ? maxScroll
      : Math.floor(lines[lines.length - 1].bottom / scale - this.view.scrollDOM.clientHeight - 2)
    return {from: Math.max(0, Math.min(from, maxScroll)),
            to: Math.max(0, Math.min(Math.max(from, to), maxScroll))}
  }

  private viewportMargins(bias: number) {
    let marginTop = (0.5 - Math.max(-0.5, Math.min(0.5, bias / VP.Margin / 2))) * VP.Margin
    let marginBottom = VP.Margin - marginTop
    let config = this.state.facet(viewportBuffer)
    let margins = applyViewportBuffer(marginTop, marginBottom, config?.maxAhead || 0, this.scrollDirection,
                                      !!config && Date.now() < this.viewportBufferUntil,
                                      this.editorHeight, this.scaleY)
    if (this.controlledScrollCorridor) {
      margins.top = Math.max(margins.top, this.visibleTop - this.controlledScrollCorridor.from)
      margins.bottom = Math.max(margins.bottom, this.controlledScrollCorridor.to - this.visibleBottom)
    }
    return margins
  }

  getViewport(bias: number, scrollTarget: ScrollTarget | null): Viewport {
    // This will divide VP.Margin between the top and the
    // bottom, depending on the bias (the change in viewport position
    // since the last update). It'll hold a number between 0 and 1
    let map = this.heightMap, oracle = this.heightOracle
    let {visibleTop, visibleBottom} = this
    let margins = this.viewportMargins(bias)
    let viewport = new Viewport(map.lineAt(visibleTop - margins.top, QueryType.ByHeight, oracle, 0, 0).from,
                                map.lineAt(visibleBottom + margins.bottom, QueryType.ByHeight, oracle, 0, 0).to)
    // If scrollTarget is given, make sure the viewport includes that position
    if (scrollTarget) {
      let {head} = scrollTarget.range
      if (head < viewport.from || head > viewport.to) {
        let viewHeight = Math.min(this.editorHeight, this.pixelViewport.bottom - this.pixelViewport.top)
        let block = map.lineAt(head, QueryType.ByPos, oracle, 0, 0), topPos
        if (scrollTarget.y == "center")
          topPos = (block.top + block.bottom) / 2 - viewHeight / 2
        else if (scrollTarget.y == "start" || scrollTarget.y == "nearest" && head < viewport.from)
          topPos = block.top
        else
          topPos = block.bottom - viewHeight
        viewport = new Viewport(map.lineAt(topPos - margins.top, QueryType.ByHeight, oracle, 0, 0).from,
                                map.lineAt(topPos + viewHeight + margins.bottom, QueryType.ByHeight, oracle, 0, 0).to)
      }
    }
    return viewport
  }

  mapViewport(viewport: Viewport, changes: ChangeDesc) {
    let from = changes.mapPos(viewport.from, -1), to = changes.mapPos(viewport.to, 1)
    return new Viewport(this.heightMap.lineAt(from, QueryType.ByPos, this.heightOracle, 0, 0).from,
                        this.heightMap.lineAt(to, QueryType.ByPos, this.heightOracle, 0, 0).to)
  }

  // Checks if a given viewport covers the visible part of the
  // document and not too much beyond that.
  viewportIsAppropriate({from, to}: Viewport, bias = 0) {
    if (!this.inView) return true
    let {top} = this.heightMap.lineAt(from, QueryType.ByPos, this.heightOracle, 0, 0)
    let {bottom} = this.heightMap.lineAt(to, QueryType.ByPos, this.heightOracle, 0, 0)
    let {visibleTop, visibleBottom} = this
    let margins = this.viewportMargins(bias)
    let active = Date.now() < this.viewportBufferUntil
    let topCover = active && this.scrollDirection < 0 ? margins.top : Math.max(VP.MinCoverMargin, Math.min(-bias, VP.MaxCoverMargin))
    let bottomCover = active && this.scrollDirection > 0 ? margins.bottom : Math.max(VP.MinCoverMargin, Math.min(bias, VP.MaxCoverMargin))
    return (from == 0 || top <= visibleTop - topCover) &&
      (to == this.state.doc.length ||
       bottom >= visibleBottom + bottomCover) &&
      (top > visibleTop - 2 * Math.max(VP.Margin, margins.top) &&
       bottom < visibleBottom + 2 * Math.max(VP.Margin, margins.bottom))
  }

  mapLineGaps(gaps: readonly LineGap[], changes: ChangeSet) {
    if (!gaps.length || changes.empty) return gaps
    let mapped = []
    for (let gap of gaps) if (!changes.touchesRange(gap.from, gap.to))
      mapped.push(new LineGap(changes.mapPos(gap.from), changes.mapPos(gap.to), gap.size, gap.displaySize))
    return mapped
  }

  // Computes positions in the viewport where the start or end of a
  // line should be hidden, trying to reuse existing line gaps when
  // appropriate to avoid unneccesary redraws.
  // Uses crude character-counting for the positioning and sizing,
  // since actual DOM coordinates aren't always available and
  // predictable. Relies on generous margins (see LG.Margin) to hide
  // the artifacts this might produce from the user.
  ensureLineGaps(current: readonly LineGap[], mayMeasure?: EditorView) {
    let wrapping = this.heightOracle.lineWrapping
    let margin = wrapping ? LG.MarginWrap : LG.Margin, halfMargin = margin >> 1, doubleMargin = margin << 1
    // The non-wrapping logic won't work at all in predominantly right-to-left text.
    if (this.defaultTextDirection != Direction.LTR && !wrapping) return []
    let gaps: LineGap[] = []
    let addGap = (from: number, to: number, line: BlockInfo, structure: LineStructure) => {
      if (to - from < halfMargin) return
      let sel = this.state.selection.main, avoid = [sel.from]
      if (!sel.empty) avoid.push(sel.to)
      for (let pos of avoid) {
        if (pos > from && pos < to) {
          addGap(from, pos - LG.SelectionMargin, line, structure)
          addGap(pos + LG.SelectionMargin, to, line, structure)
          return
        }
      }
      let gap = find(current, gap => gap.from >= line.from && gap.to <= line.to &&
        Math.abs(gap.from - from) < halfMargin && Math.abs(gap.to - to) < halfMargin &&
        !avoid.some(pos => gap.from < pos && gap.to > pos))
      if (!gap) {
        // When scrolling down, snap gap ends to line starts to avoid shifts in wrapping
        if (to < line.to && mayMeasure && wrapping &&
          mayMeasure.visibleRanges.some(r => r.from <= to && r.to >= to)) {
          let lineStart = mayMeasure.moveToLineBoundary(EditorSelection.cursor(to), false, true).head
          if (lineStart > from) to = lineStart
        }
        let size = this.gapSize(line, from, to, structure)
        let displaySize = wrapping || size < VP.MaxHorizGap ? size : VP.MaxHorizGap
        gap = new LineGap(from, to, size, displaySize)
      }
      gaps.push(gap)
    }

    let checkLine = (line: BlockInfo) => {
      if (line.length < doubleMargin || line.type != BlockType.Text) return
      let structure = lineStructure(line.from, line.to, this.stateDeco)
      if (structure.total < doubleMargin) return
      let target = this.scrollTarget ? this.scrollTarget.range.head : null
      let viewFrom, viewTo
      if (wrapping) {
        let marginHeight = (margin / this.heightOracle.lineLength) * this.heightOracle.lineHeight
        let top, bot
        if (target != null) {
          let targetFrac = findFraction(structure, target)
          let spaceFrac = ((this.visibleBottom - this.visibleTop) / 2 + marginHeight) / line.height
          top = targetFrac - spaceFrac
          bot = targetFrac + spaceFrac
        } else {
          top = (this.visibleTop - line.top - marginHeight) / line.height
          bot = (this.visibleBottom - line.top + marginHeight) / line.height
        }
        viewFrom = findPosition(structure, top)
        viewTo = findPosition(structure, bot)
      } else {
        let totalWidth = structure.total * this.heightOracle.charWidth
        let marginWidth = margin * this.heightOracle.charWidth
        let horizOffset = 0
        if (totalWidth > VP.MaxHorizGap) for (let old of current) {
          if (old.from >= line.from && old.from < line.to && old.size != old.displaySize &&
              old.from * this.heightOracle.charWidth + horizOffset < this.pixelViewport.left)
            horizOffset = old.size - old.displaySize
        }
        let pxLeft = this.pixelViewport.left + horizOffset, pxRight = this.pixelViewport.right + horizOffset
        let left, right
        if (target != null) {
          let targetFrac = findFraction(structure, target)
          let spaceFrac = ((pxRight - pxLeft) / 2 + marginWidth) / totalWidth
          left = targetFrac - spaceFrac
          right = targetFrac + spaceFrac
        } else {
          left = (pxLeft - marginWidth) / totalWidth
          right = (pxRight + marginWidth) / totalWidth
        }
        viewFrom = findPosition(structure, left)
        viewTo = findPosition(structure, right)
      }

      if (viewFrom > line.from) addGap(line.from, viewFrom, line, structure)
      if (viewTo < line.to) addGap(viewTo, line.to, line, structure)
    }

    for (let line of this.viewportLines) {
      if (Array.isArray(line.type)) line.type.forEach(checkLine)
      else checkLine(line)
    }
    return gaps
  }

  gapSize(line: BlockInfo, from: number, to: number, structure: LineStructure) {
    let fraction = findFraction(structure, to) - findFraction(structure, from)
    if (this.heightOracle.lineWrapping) {
      return line.height * fraction
    } else {
      return structure.total * this.heightOracle.charWidth * fraction
    }
  }

  updateLineGaps(gaps: readonly LineGap[]) {
    if (!LineGap.same(gaps, this.lineGaps)) {
      this.lineGaps = gaps
      this.lineGapDeco = Decoration.set(gaps.map(gap => gap.draw(this, this.heightOracle.lineWrapping)))
    }
  }

  computeVisibleRanges(changes?: ChangeDesc) {
    let deco = this.stateDeco
    if (this.lineGaps.length) deco = deco.concat(this.lineGapDeco)
    let ranges: {from: number, to: number}[] = []
    RangeSet.spans(deco, this.viewport.from, this.viewport.to, {
      span(from, to) { ranges.push({from, to}) },
      point() {}
    }, 20)
    let changed = 0
    if (ranges.length != this.visibleRanges.length) {
      changed = UpdateFlag.ViewportMoved | UpdateFlag.Viewport
    } else {
      for (let i = 0; i < ranges.length && !(changed & UpdateFlag.ViewportMoved); i++) {
        let old = this.visibleRanges[i], nw = ranges[i]
        if (old.from != nw.from || old.to != nw.to) {
          changed |= UpdateFlag.Viewport
          if (!(changes && changes.mapPos(old.from, -1) == nw.from && changes.mapPos(old.to, 1) == nw.to))
            changed |= UpdateFlag.ViewportMoved
        }
      }
    }
    this.visibleRanges = ranges
    return changed
  }

  lineBlockAt(pos: number): BlockInfo {
    return (pos >= this.viewport.from && pos <= this.viewport.to &&
            this.viewportLines.find(b => b.from <= pos && b.to >= pos)) ||
      scaleBlock(this.heightMap.lineAt(pos, QueryType.ByPos, this.heightOracle, 0, 0), this.scaler)
  }

  lineBlockAtHeight(height: number): BlockInfo {
    return (height >= this.viewportLines[0].top && height <= this.viewportLines[this.viewportLines.length - 1].bottom &&
            this.viewportLines.find(l => l.top <= height && l.bottom >= height)) ||
      scaleBlock(this.heightMap.lineAt(this.scaler.fromDOM(height), QueryType.ByHeight, this.heightOracle, 0, 0),
                 this.scaler)
  }

  getScrollOffset() {
    let base = this.scrollParent == this.view.scrollDOM ? this.scrollParent.scrollTop
      : (this.scrollParent ? this.scrollParent.getBoundingClientRect().top : 0) - this.view.contentDOM.getBoundingClientRect().top
    return base * this.scaleY
  }

  scrollAnchorAt(scrollOffset: number) {
    let block = this.lineBlockAtHeight(scrollOffset + 8)
    return block.from >= this.viewport.from || this.viewportLines[0].top - scrollOffset > 200 ? block : this.viewportLines[0]
  }

  elementAtHeight(height: number): BlockInfo {
    return scaleBlock(this.heightMap.blockAt(this.scaler.fromDOM(height), this.heightOracle, 0, 0), this.scaler)
  }

  get docHeight() {
    return this.scaler.toDOM(this.heightMap.height)
  }

  get contentHeight() {
    return this.docHeight + this.paddingTop + this.paddingBottom
  }
}

export class Viewport {
  constructor(readonly from: number, readonly to: number) {}
}

type LineStructure = {total: number, ranges: {from: number, to: number}[]}

function lineStructure(from: number, to: number, stateDeco: readonly DecorationSet[]): LineStructure {
  let ranges = [], pos = from, total = 0
  RangeSet.spans(stateDeco, from, to, {
    span() {},
    point(from, to) {
      if (from > pos) { ranges.push({from: pos, to: from}); total += from - pos }
      pos = to
    }
  }, 20) // We're only interested in collapsed ranges of a significant size
  if (pos < to) { ranges.push({from: pos, to}); total += to - pos }
  return {total, ranges}
}

function findPosition({total, ranges}: LineStructure, ratio: number): number {
  if (ratio <= 0) return ranges[0].from
  if (ratio >= 1) return ranges[ranges.length - 1].to
  let dist = Math.floor(total * ratio)
  for (let i = 0;; i++) {
    let {from, to} = ranges[i], size = to - from
    if (dist <= size) return from + dist
    dist -= size
  }
}

function findFraction(structure: LineStructure, pos: number) {
  let counted = 0
  for (let {from, to} of structure.ranges) {
    if (pos <= to) {
      counted += pos - from
      break
    }
    counted += to - from
  }
  return counted / structure.total
}

function find<T>(array: readonly T[], f: (value: T) => boolean): T | undefined {
  for (let val of array) if (f(val)) return val
  return undefined
}

// Convert between heightmap heights and DOM heights (see
// VP.MaxDOMHeight)
type YScaler = {
  toDOM(n: number): number
  fromDOM(n: number): number
  scale: number,
  eq(other: YScaler): boolean
}

// Don't scale when the document height is within the range of what
// the DOM can handle.
const IdScaler: YScaler = {
  toDOM(n: number) { return n },
  fromDOM(n: number) { return n },
  scale: 1,
  eq(other: YScaler) { return other == this }
}

function staticDeco(state: EditorState) {
  let deco = state.facet(decorations).filter(d => typeof d != "function") as DecorationSet[]
  let outer = state.facet(outerDecorations).filter(d => typeof d != "function") as DecorationSet[]
  if (outer.length) deco.push(RangeSet.join(outer))
  return deco
}

// When the height is too big (> VP.MaxDOMHeight), scale down the
// regions outside the viewports so that the total height is
// VP.MaxDOMHeight.
class BigScaler implements YScaler {
  scale: number
  viewports: {from: number, to: number, top: number, bottom: number, domTop: number, domBottom: number}[]

  constructor(oracle: HeightOracle, heightMap: HeightMap, viewports: readonly Viewport[]) {
    let vpHeight = 0, base = 0, domBase = 0
    this.viewports = viewports.map(({from, to}) => {
      let top = heightMap.lineAt(from, QueryType.ByPos, oracle, 0, 0).top
      let bottom = heightMap.lineAt(to, QueryType.ByPos, oracle, 0, 0).bottom
      vpHeight += bottom - top
      return {from, to, top, bottom, domTop: 0, domBottom: 0}
    })
    this.scale = (VP.MaxDOMHeight - vpHeight) / (heightMap.height - vpHeight)
    for (let obj of this.viewports) {
      obj.domTop = domBase + (obj.top - base) * this.scale
      domBase = obj.domBottom = obj.domTop + (obj.bottom - obj.top)
      base = obj.bottom
    }
  }

  toDOM(n: number) {
    for (let i = 0, base = 0, domBase = 0;; i++) {
      let vp = i < this.viewports.length ? this.viewports[i] : null
      if (!vp || n < vp.top) return domBase + (n - base) * this.scale
      if (n <= vp.bottom) return vp.domTop + (n - vp.top)
      base = vp.bottom; domBase = vp.domBottom
    }
  }
  
  fromDOM(n: number) {
    for (let i = 0, base = 0, domBase = 0;; i++) {
      let vp = i < this.viewports.length ? this.viewports[i] : null
      if (!vp || n < vp.domTop) return base + (n - domBase) / this.scale
      if (n <= vp.domBottom) return vp.top + (n - vp.domTop)
      base = vp.bottom; domBase = vp.domBottom
    }
  }

  eq(other: YScaler) {
    if (!(other instanceof BigScaler)) return false
    return this.scale == other.scale && this.viewports.length == other.viewports.length &&
      this.viewports.every((vp, i) => vp.from == other.viewports[i].from && vp.to == other.viewports[i].to)
  }
}

function scaleBlock(block: BlockInfo, scaler: YScaler): BlockInfo {
  if (scaler.scale == 1) return block
  let bTop = scaler.toDOM(block.top), bBottom = scaler.toDOM(block.bottom)
  return new BlockInfo(block.from, block.length, bTop, bBottom - bTop,
                       Array.isArray(block._content) ? block._content.map(b => scaleBlock(b, scaler)) : block._content)
}
