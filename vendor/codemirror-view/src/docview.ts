import {ChangeSet, RangeSet, findClusterBreak, SelectionRange} from "@codemirror/state"
import browser from "./browser"
import {Decoration, DecorationSet, addRange, BlockWrapper, WidgetType} from "./decoration"
import {clientRectsFor, isEquivalentPosition, Rect, scrollRectIntoView,
        getSelection, hasSelection, textRange, DOMSelectionState,
        textNodeBefore, textNodeAfter, DOMPos, maxOffset,
        getScrollStack, restoreScrollStack} from "./dom"
import {ViewUpdate, decorations as decorationsFacet, outerDecorations, ChangedRange, editable, blockWrappers,
        ScrollTarget, scrollHandler, getScrollMargins, logException, setEditContextFormatting} from "./extension"
import {EditorView} from "./editorview"
import {Direction} from "./bidi"
import {Tile, LineTile, DocTile, TileFlag, BlockWrapperTile} from "./tile"
import {TileUpdate, Reused} from "./buildtile"

export type Composition = {
  range: ChangedRange,
  text: Text,
}

export class DocView {
  tile: DocTile

  decorations: readonly DecorationSet[] = []
  blockWrappers: readonly RangeSet<BlockWrapper>[] = []
  dynamicDecorationMap: boolean[] = [false]
  domChanged: {newSel: SelectionRange | null} | null = null
  hasComposition: {from: number, to: number} | null = null
  editContextFormatting = Decoration.none
  lastCompositionAfterCursor = false

  // Track a minimum width for the editor. When measuring sizes in
  // measureVisibleLineHeights, this is updated to point at the width
  // of a given element and its extent in the document. When a change
  // happens in that range, these are reset. That way, once we've seen
  // a line/element of a given length, we keep the editor wide enough
  // to fit at least that element, until it is changed, at which point
  // we forget it again.
  minWidth = 0
  minWidthFrom = 0
  minWidthTo = 0

  // Track whether the DOM selection was set in a lossy way, so that
  // we don't mess it up when reading it back it
  impreciseAnchor: DOMPos | null = null
  impreciseHead: DOMPos | null = null
  forceSelection = false

  // Used by the resize observer to ignore resizes that we caused
  // ourselves
  lastUpdate = Date.now()

  constructor(readonly view: EditorView) {
    this.updateDeco()
    this.tile = new DocTile(view, view.contentDOM)
    this.updateInner([new ChangedRange(0, 0, 0, view.state.doc.length)], null)
  }

  // Update the document view to a given state.
  update(update: ViewUpdate) {
    let changedRanges = update.changedRanges
    if (this.minWidth > 0 && changedRanges.length) {
      if (!changedRanges.every(({fromA, toA}) => toA < this.minWidthFrom || fromA > this.minWidthTo)) {
        this.minWidth = this.minWidthFrom = this.minWidthTo = 0
      } else {
        this.minWidthFrom = update.changes.mapPos(this.minWidthFrom, 1)
        this.minWidthTo = update.changes.mapPos(this.minWidthTo, 1)
      }
    }

    this.updateEditContextFormatting(update)

    let readCompositionAt = -1
    if (this.view.inputState.composing >= 0 && !this.view.observer.editContext) {
      if (this.domChanged?.newSel)
        readCompositionAt = this.domChanged.newSel.head
      else if (!touchesComposition(update.changes, this.hasComposition) && !update.selectionSet)
        readCompositionAt = update.state.selection.main.head
    }
    let composition = readCompositionAt > -1 ? findCompositionRange(this.view, update.changes, readCompositionAt) : null
    this.domChanged = null

    if (this.hasComposition) {
      let {from, to} = this.hasComposition
      changedRanges = new ChangedRange(from, to, update.changes.mapPos(from, -1), update.changes.mapPos(to, 1))
        .addToSet(changedRanges.slice())
    }
    this.hasComposition = composition ? {from: composition.range.fromB, to: composition.range.toB} : null

    // When the DOM nodes around the selection are moved to another
    // parent, Chrome sometimes reports a different selection through
    // getSelection than the one that it actually shows to the user.
    // This forces a selection update when lines are joined to work
    // around that. Issue #54
    if ((browser.ie || browser.chrome) && !composition && update &&
        update.state.doc.lines != update.startState.doc.lines)
      this.forceSelection = true

    let prevDeco = this.decorations, prevWrappers = this.blockWrappers
    this.updateDeco()
    let decoDiff = findChangedDeco(prevDeco, this.decorations, update.changes)
    if (decoDiff.length) changedRanges = ChangedRange.extendWithRanges(changedRanges, decoDiff)
    let blockDiff = findChangedWrappers(prevWrappers, this.blockWrappers, update.changes)
    if (blockDiff.length) changedRanges = ChangedRange.extendWithRanges(changedRanges, blockDiff)
    if (composition && !changedRanges.some(r => r.fromA <= composition!.range.fromA && r.toA >= composition!.range.toA))
      changedRanges = composition.range.addToSet(changedRanges.slice())

    if ((this.tile.flags & TileFlag.Synced) && changedRanges.length == 0) {
      return false
    } else {
      this.updateInner(changedRanges, composition)
      if (update.transactions.length) this.lastUpdate = Date.now()
      return true
    }
  }

  // Used by update and the constructor do perform the actual DOM
  // update
  private updateInner(changes: readonly ChangedRange[], composition: Composition | null) {
    this.view.viewState.mustMeasureContent = true

    let {observer} = this.view
    observer.ignore(() => {
      if (composition || changes.length) {
        let oldTile = this.tile
        let builder = new TileUpdate(this.view, oldTile, this.blockWrappers, this.decorations, this.dynamicDecorationMap)
        if (composition && Tile.get(composition.text))
          builder.cache.reused.set(Tile.get(composition.text)!, Reused.DOM)
        this.tile = builder.run(changes, composition)
        destroyDropped(oldTile, builder.cache.reused)
      }

      // Lock the height during redrawing, since Chrome sometimes
      // messes with the scroll position during DOM mutation (though
      // no relayout is triggered and I cannot imagine how it can
      // recompute the scroll position without a layout)
      this.tile.dom.style.height = this.view.viewState.contentHeight / this.view.scaleY + "px"
      this.tile.dom.style.flexBasis = this.minWidth ? this.minWidth + "px" : ""
      // Chrome will sometimes, when DOM mutations occur directly
      // around the selection, get confused and report a different
      // selection from the one it displays (issue #218). This tries
      // to detect that situation.
      let track = browser.chrome || browser.ios ? {node: observer.selectionRange.focusNode!, written: false} : undefined
      this.tile.sync(track)
      if (track && (track.written || observer.selectionRange.focusNode != track.node || !this.tile.dom.contains(track.node)))
        this.forceSelection = true
      this.tile.dom.style.height = ""
    })
    let gaps = []
    if (this.view.viewport.from || this.view.viewport.to < this.view.state.doc.length) for (let child of this.tile.children)
      if (child.isWidget() && child.widget instanceof BlockGapWidget) gaps.push(child.dom!)
    observer.updateGaps(gaps)
  }

  private updateEditContextFormatting(update: ViewUpdate) {
    this.editContextFormatting = this.editContextFormatting.map(update.changes)
    for (let tr of update.transactions) for (let effect of tr.effects) if (effect.is(setEditContextFormatting)) {
      this.editContextFormatting = effect.value
    }
  }

  // Sync the DOM selection to this.state.selection
  updateSelection(mustRead = false, fromPointer = false) {
    if (mustRead || !this.view.observer.selectionRange.focusNode) this.view.observer.readSelectionRange()
    let {dom} = this.tile
    let activeElt = this.view.root.activeElement, focused = activeElt == dom
    let selectionNotFocus = !focused && !(this.view.state.facet(editable) || dom.tabIndex > -1) &&
      hasSelection(dom, this.view.observer.selectionRange) && !(activeElt && dom.contains(activeElt))
    if (!(focused || fromPointer || selectionNotFocus)) return
    let force = this.forceSelection
    this.forceSelection = false

    let main = this.view.state.selection.main, anchor: DOMPos, head: DOMPos
    if (main.empty) {
      head = anchor = this.inlineDOMNearPos(main.anchor, main.assoc || 1)
    } else {
      head = this.inlineDOMNearPos(main.head, main.head == main.from ? 1 : -1)
      anchor = this.inlineDOMNearPos(main.anchor, main.anchor == main.from ? 1 : -1)
    }

    // Always reset on Firefox when next to an uneditable node to
    // avoid invisible cursor bugs (#111)
    if (browser.gecko && main.empty && !this.hasComposition && betweenUneditable(anchor)) {
      let dummy = document.createTextNode("")
      this.view.observer.ignore(() => anchor.node.insertBefore(dummy, anchor.node.childNodes[anchor.offset] || null))
      anchor = head = new DOMPos(dummy, 0)
      force = true
    }

    let domSel = this.view.observer.selectionRange
    // If the selection is already here, or in an equivalent position, don't touch it
    if (force || !domSel.focusNode || (
          !isEquivalentPosition(anchor.node, anchor.offset, domSel.anchorNode, domSel.anchorOffset) ||
          !isEquivalentPosition(head.node, head.offset, domSel.focusNode, domSel.focusOffset)
        ) && !this.suppressWidgetCursorChange(domSel, main)) {
      this.view.observer.ignore(() => {
        // Chrome Android will hide the virtual keyboard when tapping
        // inside an uneditable node, and not bring it back when we
        // move the cursor to its proper position. This tries to
        // restore the keyboard by cycling focus.
        if (browser.android && browser.chrome && dom.contains(domSel.focusNode) &&
            inUneditable(domSel.focusNode, dom)) {
          dom.blur()
          dom.focus({preventScroll: true})
        }
        let rawSel = getSelection(this.view.root)
        if (!rawSel) {
          // No DOM selection for some reason—do nothing
        } else if (main.empty) {
          // Work around https://bugzilla.mozilla.org/show_bug.cgi?id=1612076
          if (browser.gecko) {
            let nextTo = nextToUneditable(anchor.node, anchor.offset)
            if (nextTo && nextTo != (NextTo.Before | NextTo.After)) {
              let text = (nextTo == NextTo.Before ? textNodeBefore : textNodeAfter)(anchor.node, anchor.offset)
              if (text) anchor = new DOMPos(text.node, text.offset)
            }
          }
          rawSel.collapse(anchor.node, anchor.offset)
          if (main.bidiLevel != null && (rawSel as any).caretBidiLevel !== undefined)
            (rawSel as any).caretBidiLevel = main.bidiLevel
        } else if (rawSel.extend) {
          // Selection.extend can be used to create an 'inverted' selection
          // (one where the focus is before the anchor), but not all
          // browsers support it yet.
          rawSel.collapse(anchor.node, anchor.offset)
          // Safari will ignore the call above when the editor is
          // hidden, and then raise an error on the call to extend
          // (#940).
          try { rawSel.extend(head.node, head.offset) }
          catch(_) {}
        } else {
          // Primitive (IE) way
          let range = document.createRange()
          if (main.anchor > main.head) [anchor, head] = [head, anchor]
          range.setEnd(head.node, head.offset)
          range.setStart(anchor.node, anchor.offset)
          rawSel.removeAllRanges()
          rawSel.addRange(range)
        }
        if (selectionNotFocus && this.view.root.activeElement == dom) {
          dom.blur()
          if (activeElt) (activeElt as HTMLElement).focus()
        }
      })
      this.view.observer.setSelectionRange(anchor, head)
    }

    this.impreciseAnchor = anchor.precise ? null : new DOMPos(domSel.anchorNode!, domSel.anchorOffset)
    this.impreciseHead = head.precise ? null: new DOMPos(domSel.focusNode!, domSel.focusOffset)
  }

  // If a zero-length widget is inserted next to the cursor during
  // composition, avoid moving it across it and disrupting the
  // composition.
  suppressWidgetCursorChange(sel: DOMSelectionState, cursor: SelectionRange) {
    return this.hasComposition && cursor.empty &&
      isEquivalentPosition(sel.focusNode!, sel.focusOffset, sel.anchorNode, sel.anchorOffset) &&
      this.posFromDOM(sel.focusNode!, sel.focusOffset) == cursor.head
  }

  enforceCursorAssoc() {
    if (this.hasComposition) return
    let {view} = this, cursor = view.state.selection.main
    let sel = getSelection(view.root)
    let {anchorNode, anchorOffset} = view.observer.selectionRange
    if (!sel || !cursor.empty || !cursor.assoc || !sel.modify) return
    let line = this.lineAt(cursor.head, cursor.assoc)
    if (!line) return
    let lineStart = line.posAtStart
    if (cursor.head == lineStart || cursor.head == lineStart + line.length) return
    let before = this.coordsAt(cursor.head, -1), after = this.coordsAt(cursor.head, 1)
    if (!before || !after || before.bottom > after.top) return
    let dom = this.domAtPos(cursor.head + cursor.assoc, cursor.assoc)
    sel.collapse(dom.node, dom.offset)
    sel.modify("move", cursor.assoc < 0 ? "forward" : "backward", "lineboundary")
    // This can go wrong in corner cases like single-character lines,
    // so check and reset if necessary.
    view.observer.readSelectionRange()
    let newRange = view.observer.selectionRange
    if (view.docView.posFromDOM(newRange.anchorNode!, newRange.anchorOffset) != cursor.from)
      sel.collapse(anchorNode, anchorOffset)
  }

  posFromDOM(node: Node, offset: number): number {
    let tile = this.tile.nearest(node)
    if (!tile) return this.tile.dom.compareDocumentPosition(node) & 2 /* PRECEDING */ ? 0 : this.view.state.doc.length

    let start = tile.posAtStart
    if (tile.isComposite()) {
      let after: Node | null
      if (node == tile.dom) {
        after = tile.dom.childNodes[offset]
      } else {
        let bias = maxOffset(node) == 0 ? 0 : offset == 0 ? -1 : 1
        for (;;) {
          let parent = node.parentNode!
          if (parent == tile.dom) break
          if (bias == 0 && parent.firstChild != parent.lastChild) {
            if (node == parent.firstChild) bias = -1
            else bias = 1
          }
          node = parent
        }
        if (bias < 0) after = node
        else after = node.nextSibling
      }
      if (after == tile.dom!.firstChild) return start
      while (after && !Tile.get(after)) after = after.nextSibling
      if (!after) return start + tile.length
      for (let i = 0, pos = start;; i++) {
        let child = tile.children[i]
        if (child.dom == after) return pos
        pos += child.length + child.breakAfter
      }
    } else if (tile.isText()) {
      return node == tile.dom ? start + offset : start + (offset ? tile.length : 0)
    } else {
      return start
    }
  }

  domAtPos(pos: number, side: number): DOMPos {
    let {tile, offset} = this.tile.resolveBlock(pos, side)
    if (tile.isWidget()) return tile.domPosFor(offset, side)
    return tile.domIn(offset, side)
  }

  inlineDOMNearPos(pos: number, side: number): DOMPos {
    let before: LineTile | undefined | null, beforeOff = -1, beforeBad = false
    let after: LineTile | undefined | null, afterOff = -1, afterBad = false
    this.tile.blockTiles((tile, off) => {
      if (tile.isWidget()) {
        if ((tile.flags & TileFlag.After) && off >= pos) return true
        if (tile.flags & TileFlag.Before) beforeBad = true
      } else {
        let end = off + tile.length
        if (off <= pos) { before = tile; beforeOff = pos - off; beforeBad = end < pos }
        if (end >= pos && !after) { after = tile; afterOff = pos - off; afterBad = off > pos }
        if (off > pos && after) return true
      }
    })
    if (!before && !after) return this.domAtPos(pos, side)
    if (beforeBad && after) before = null
    else if (afterBad && before) after = null
    return before && side < 0 || !after ? before!.domIn(beforeOff, side) : after.domIn(afterOff, side)
  }

  // Get the coord of the element at the given side of the given
  // position. If rtl is given, flatten it using that text direction.
  coordsAt(pos: number, side: -1 | 1, rtl?: boolean): Rect | null {
    let {tile, offset} = this.tile.resolveBlock(pos, side)
    if (tile.isWidget()) {
      if (tile.widget instanceof BlockGapWidget) return null
      return tile.coordsInWidget(offset, side, true)
    }
    return tile.coordsIn(offset, side, rtl)
  }

  lineAt(pos: number, side: number) {
    let {tile} = this.tile.resolveBlock(pos, side)
    return tile.isLine() ? tile : null
  }

  coordsForChar(pos: number) {
    let {tile, offset} = this.tile.resolveBlock(pos, 1)
    if (!tile.isLine()) return null
    function scan(tile: Tile, offset: number): DOMRect | null {
      if (tile.isComposite()) {
        for (let ch of tile.children) {
          if (ch.length >= offset) {
            let found = scan(ch, offset)
            if (found) return found
          }
          offset -= ch.length
          if (offset < 0) break
        }
      } else if (tile.isText() && offset < tile.length) {
        let end = findClusterBreak(tile.text, offset)
        if (end == offset) return null
        let rects = textRange(tile.dom, offset, end).getClientRects()
        for (let i = 0; i < rects.length; i++) {
          let rect = rects[i]
          if (i == rects.length - 1 || rect.top < rect.bottom && rect.left < rect.right) return rect
        }
      }
      return null
    }
    return scan(tile, offset)
  }

  measureVisibleLineHeights(viewport: {from: number, to: number}) {
    let result: number[] = [], {from, to} = viewport
    let contentWidth = this.view.contentDOM.clientWidth
    let isWider = contentWidth > Math.max(this.view.scrollDOM.clientWidth, this.minWidth) + 1
    let widest = -1, ltr = this.view.textDirection == Direction.LTR
    let spaceAbove = 0
    let scan = (tile: DocTile | BlockWrapperTile, pos: number, measureBounds: DOMRect | null) => {
      for (let i = 0; i < tile.children.length; i++) {
        if (pos > to) break
        let child = tile.children[i], end = pos + child.length
        let childRect = (child.dom as HTMLElement).getBoundingClientRect(), {height} = childRect
        if (measureBounds && !i) spaceAbove += childRect.top - measureBounds.top
        if (child instanceof BlockWrapperTile) {
          if (end > from) scan(child, pos, childRect)
        } else if (pos >= from) {
          if (spaceAbove > 0) result.push(-spaceAbove)
          result.push(height + spaceAbove)
          spaceAbove = 0
          if (isWider) {
            let last = child.dom.lastChild
            let rects = last ? clientRectsFor(last) : []
            if (rects.length) {
              let rect = rects[rects.length - 1]
              let width = ltr ? rect.right - childRect.left : childRect.right - rect.left
              if (width > widest) {
                widest = width
                this.minWidth = contentWidth
                this.minWidthFrom = pos
                this.minWidthTo = end
              }
            }
          }
        }
        if (measureBounds && i == tile.children.length - 1) spaceAbove += measureBounds.bottom - childRect.bottom
        pos = end + child.breakAfter
      }
    }
    scan(this.tile, 0, null)
    return result
  }

  textDirectionAt(pos: number) {
    let {tile} = this.tile.resolveBlock(pos, 1)
    return getComputedStyle(tile.dom).direction == "rtl" ? Direction.RTL : Direction.LTR
  }

  measureTextSize(): {lineHeight: number, charWidth: number, textHeight: number} {
    let lineMeasure = this.tile.blockTiles(tile => {
      if (tile.isLine() && tile.children.length && tile.length <= 20) {
        let totalWidth = 0, textHeight!: number
        for (let child of tile.children) {
          if (!child.isText() || /[^ -~]/.test(child.text)) return undefined
          let rects = clientRectsFor(child.dom)
          if (rects.length != 1) return undefined
          totalWidth += rects[0].width
          textHeight = rects[0].height
        }
        if (totalWidth) return {
          lineHeight: tile.dom.getBoundingClientRect().height,
          charWidth: totalWidth / tile.length,
          textHeight
        }
      }
    })
    if (lineMeasure) return lineMeasure
    // If no workable line exists, force a layout of a measurable element
    let dummy = document.createElement("div"), lineHeight!: number, charWidth!: number, textHeight!: number
    dummy.className = "cm-line"
    dummy.style.width = "99999px"
    dummy.style.position = "absolute"
    dummy.textContent = "abc def ghi jkl mno pqr stu"
    this.view.observer.ignore(() => {
      this.tile.dom.appendChild(dummy)
      let rect = clientRectsFor(dummy.firstChild!)[0]
      lineHeight = dummy.getBoundingClientRect().height
      charWidth = rect && rect.width ? rect.width / 27 : 7
      textHeight = rect && rect.height ? rect.height : lineHeight
      dummy.remove()
    })
    return {lineHeight, charWidth, textHeight}
  }

  computeBlockGapDeco(): DecorationSet {
    let deco = [], vs = this.view.viewState
    for (let pos = 0, i = 0;; i++) {
      let next = i == vs.viewports.length ? null : vs.viewports[i]
      let end = next ? next.from - 1 : this.view.state.doc.length
      if (end > pos) {
        let height = (vs.lineBlockAt(end).bottom - vs.lineBlockAt(pos).top) / this.view.scaleY
        deco.push(Decoration.replace({
          widget: new BlockGapWidget(height),
          block: true,
          inclusive: true,
          isBlockGap: true,
        }).range(pos, end))
      }
      if (!next) break
      pos = next.to + 1
    }
    return Decoration.set(deco)
  }

  updateDeco() {
    let i = 1
    let allDeco = this.view.state.facet(decorationsFacet).map(d => {
      let dynamic = this.dynamicDecorationMap[i++] = typeof d == "function"
      return dynamic ? (d as (view: EditorView) => DecorationSet)(this.view) : d as DecorationSet
    })
    let dynamicOuter = false, outerDeco = this.view.state.facet(outerDecorations).map((d, i) => {
      let dynamic = typeof d == "function"
      if (dynamic) dynamicOuter = true
      return dynamic ? (d as (view: EditorView) => DecorationSet)(this.view) : d as DecorationSet
    })
    if (outerDeco.length) {
      this.dynamicDecorationMap[i++] = dynamicOuter
      allDeco.push(RangeSet.join(outerDeco))
    }
    this.decorations = [
      this.editContextFormatting,
      ...allDeco,
      this.computeBlockGapDeco(),
      this.view.viewState.lineGapDeco
    ]
    while (i < this.decorations.length) this.dynamicDecorationMap[i++] = false
    this.blockWrappers = this.view.state.facet(blockWrappers).map(v => typeof v == "function" ? v(this.view) : v)
  }

  scrollIntoView(target: ScrollTarget) {
    if (target.isSnapshot) {
      let ref = this.view.viewState.lineBlockAt(target.range.head)
      this.view.scrollDOM.scrollTop = ref.top - target.yMargin
      this.view.scrollDOM.scrollLeft = target.xMargin
      return
    }

    for (let handler of this.view.state.facet(scrollHandler)) {
      try { if (handler(this.view, target.range, target)) return true }
      catch(e) { logException(this.view.state, e, "scroll handler") }
    }

    let {range} = target
    let rect = this.coordsAt(range.head, range.assoc || (range.head > range.anchor ? -1 : 1)), other
    if (!rect) return
    if (!range.empty && (other = this.coordsAt(range.anchor, range.anchor > range.head ? -1 : 1)))
      rect = {left: Math.min(rect.left, other.left), top: Math.min(rect.top, other.top),
              right: Math.max(rect.right, other.right), bottom: Math.max(rect.bottom, other.bottom)}

    let margins = getScrollMargins(this.view)
    let targetRect = {
      left: rect.left - margins.left, top: rect.top - margins.top,
      right: rect.right + margins.right, bottom: rect.bottom + margins.bottom
    }
    let {offsetWidth, offsetHeight} = this.view.scrollDOM
    scrollRectIntoView(this.view.scrollDOM, targetRect, range.head < range.anchor ? -1 : 1,
                       target.x, target.y,
                       Math.max(Math.min(target.xMargin, offsetWidth), -offsetWidth),
                       Math.max(Math.min(target.yMargin, offsetHeight), -offsetHeight),
                       this.view.textDirection == Direction.LTR)
    // On mobile browsers, the visual viewport may be smaller than the
    // actual reported viewport, causing scrollRectIntoView to fail to
    // scroll properly. Unfortunately, this visual viewport cannot be
    // updated directly, and scrollIntoView is the only way a script
    // can affect it. So this tries to kludge around the problem by
    // calling scrollIntoView on the scroll target's line.
    if (window.visualViewport && window.innerHeight - window.visualViewport.height > 1 &&
        (rect.top > window.visualViewport.offsetTop + window.visualViewport.height ||
         rect.bottom < window.visualViewport.offsetTop)) {
      let line = this.view.docView.lineAt(range.head, 1)
      if (line) {
        let stack = getScrollStack(line.dom)
        line.dom.scrollIntoView({block: "nearest"})
        restoreScrollStack(stack, false)
      }
    }
  }

  lineHasWidget(pos: number) {
    let scan = (child: Tile) => child.isWidget() || child.children.some(scan)
    return scan(this.tile.resolveBlock(pos, 1).tile)
  }

  destroy() {
    destroyDropped(this.tile)
  }
}

function destroyDropped(tile: Tile, reused?: Map<Tile, Reused>) {
  let r = reused?.get(tile)
  if (r != Reused.Full) {
    if (r == null) tile.destroy()
    for (let ch of tile.children) destroyDropped(ch, reused)
  }
}

function betweenUneditable(pos: DOMPos) {
  return pos.node.nodeType == 1 && pos.node.firstChild &&
    (pos.offset == 0 || (pos.node.childNodes[pos.offset - 1] as HTMLElement).contentEditable == "false") &&
    (pos.offset == pos.node.childNodes.length || (pos.node.childNodes[pos.offset] as HTMLElement).contentEditable == "false")
}

export function findCompositionNode(view: EditorView, headPos: number): {from: number, to: number, node: Text} | null {
  let sel = view.observer.selectionRange
  if (!sel.focusNode) return null
  let textBefore = textNodeBefore(sel.focusNode, sel.focusOffset)
  let textAfter = textNodeAfter(sel.focusNode, sel.focusOffset)
  let textNode = textBefore || textAfter
  if (textAfter && textBefore && textAfter.node != textBefore.node) {
    let tileAfter = Tile.get(textAfter.node)
    if (!tileAfter || tileAfter.isText() && tileAfter.text != textAfter.node.nodeValue) {
      textNode = textAfter
    } else if (view.docView.lastCompositionAfterCursor) {
      let tileBefore = Tile.get(textBefore.node)
      if (!(!tileBefore || tileBefore.isText() && tileBefore.text != textBefore.node.nodeValue))
        textNode = textAfter
    }
  }
  view.docView.lastCompositionAfterCursor = textNode != textBefore

  if (!textNode) return null
  let from = headPos - textNode.offset
  return {from, to: from + textNode.node.nodeValue!.length, node: textNode.node}
}

function findCompositionRange(view: EditorView, changes: ChangeSet, headPos: number): Composition | null {
  let found = findCompositionNode(view, headPos)
  if (!found) return null
  let {node: textNode, from, to} = found, text = textNode.nodeValue!
  // Don't try to preserve multi-line compositions
  if (/[\n\r]/.test(text)) return null
  if (view.state.doc.sliceString(found.from, found.to) != text) return null

  let inv = changes.invertedDesc
  return {range: new ChangedRange(inv.mapPos(from), inv.mapPos(to), from, to), text: textNode}
}

const enum NextTo { Before = 1, After = 2 }

function nextToUneditable(node: Node, offset: number) {
  if (node.nodeType != 1) return 0
  return (offset && (node.childNodes[offset - 1] as any).contentEditable == "false" ? NextTo.Before : 0) |
    (offset < node.childNodes.length && (node.childNodes[offset] as any).contentEditable == "false" ? NextTo.After : 0)
}

class DecorationComparator {
  changes: number[] = []
  compareRange(from: number, to: number) { addRange(from, to, this.changes) }
  comparePoint(from: number, to: number) { addRange(from, to, this.changes) }
  boundChange(pos: number) { addRange(pos, pos, this.changes) }
}

function findChangedDeco(a: readonly DecorationSet[], b: readonly DecorationSet[], diff: ChangeSet) {
  let comp = new DecorationComparator
  RangeSet.compare(a, b, diff, comp)
  return comp.changes
}

class WrapperComparator {
  changes: number[] = []
  compareRange(from: number, to: number) { addRange(from, to, this.changes) }
  comparePoint() {}
  boundChange(pos: number) { addRange(pos, pos, this.changes) }
}

function findChangedWrappers(a: readonly RangeSet<BlockWrapper>[], b: readonly RangeSet<BlockWrapper>[], diff: ChangeSet) {
  let comp = new WrapperComparator
  RangeSet.compare(a, b, diff, comp)
  return comp.changes
}

function inUneditable(node: Node | null, inside: HTMLElement) {
  for (let cur = node; cur && cur != inside; cur = (cur as HTMLElement).assignedSlot || cur.parentNode) {
    if (cur.nodeType == 1 && (cur as HTMLElement).contentEditable == 'false') {
      return true;
    }
  }
  return false;
}

function touchesComposition(changes: ChangeSet, composition: null | {from: number, to: number}) {
  let touched = false
  if (composition) changes.iterChangedRanges((from, to) => {
    if (from < composition!.to && to > composition!.from) touched = true
  })
  return touched
}

class BlockGapWidget extends WidgetType {
  constructor(readonly height: number) { super() }

  toDOM() {
    let elt = document.createElement("div")
    elt.className = "cm-gap"
    this.updateDOM(elt)
    return elt
  }

  eq(other: BlockGapWidget) { return other.height == this.height }

  updateDOM(elt: HTMLElement) {
    elt.style.height = this.height + "px"
    return true
  }

  get editable() { return true }

  get estimatedHeight() { return this.height }

  ignoreEvent() { return false }
}
