import {combineConfig, MapMode, Facet, Extension, EditorState,
        RangeValue, RangeSet, RangeCursor} from "@codemirror/state"
import {EditorView} from "./editorview"
import {ViewPlugin, ViewUpdate} from "./extension"
import {BlockType, WidgetType} from "./decoration"
import {BlockInfo} from "./heightmap"
import {Direction} from "./bidi"

/// A gutter marker represents a bit of information attached to a line
/// in a specific gutter. Your own custom markers have to extend this
/// class.
export abstract class GutterMarker extends RangeValue {
  /// @internal
  compare(other: GutterMarker) {
    return this == other || this.constructor == other.constructor && this.eq(other)
  }

  /// Compare this marker to another marker of the same type.
  eq(other: GutterMarker): boolean { return false }

  /// Render the DOM node for this marker, if any.
  toDOM?(view: EditorView): Node

  /// This property can be used to add CSS classes to the gutter
  /// element that contains this marker.
  declare elementClass: string

  /// Called if the marker has a `toDOM` method and its representation
  /// was removed from a gutter.
  destroy(dom: Node) {}
}

GutterMarker.prototype.elementClass = ""
GutterMarker.prototype.toDOM = undefined
GutterMarker.prototype.mapMode = MapMode.TrackBefore
GutterMarker.prototype.startSide = GutterMarker.prototype.endSide = -1
GutterMarker.prototype.point = true

/// Facet used to add a class to all gutter elements for a given line.
/// Markers given to this facet should _only_ define an
/// [`elementclass`](#view.GutterMarker.elementClass), not a
/// [`toDOM`](#view.GutterMarker.toDOM) (or the marker will appear
/// in all gutters for the line).
export const gutterLineClass = Facet.define<RangeSet<GutterMarker>>()

/// Facet used to add a class to all gutter elements next to a widget.
/// Should not provide widgets with a `toDOM` method.
export const gutterWidgetClass =
  Facet.define<(view: EditorView, widget: WidgetType, block: BlockInfo) => GutterMarker | null>()

type Handlers = {[event: string]: (view: EditorView, line: BlockInfo, event: Event) => boolean}

interface GutterConfig {
  /// An extra CSS class to be added to the wrapper (`cm-gutter`)
  /// element.
  class?: string
  /// Controls whether empty gutter elements should be rendered.
  /// Defaults to false.
  renderEmptyElements?: boolean
  /// Retrieve a set of markers to use in this gutter.
  markers?: (view: EditorView) => (RangeSet<GutterMarker> | readonly RangeSet<GutterMarker>[])
  /// Can be used to optionally add a single marker to every line.
  lineMarker?: (view: EditorView, line: BlockInfo, otherMarkers: readonly GutterMarker[]) => GutterMarker | null
  /// Associate markers with block widgets in the document.
  widgetMarker?: (view: EditorView, widget: WidgetType, block: BlockInfo) => GutterMarker | null
  /// If line or widget markers depend on additional state, and should
  /// be updated when that changes, pass a predicate here that checks
  /// whether a given view update might change the line markers.
  lineMarkerChange?: null | ((update: ViewUpdate) => boolean)
  /// Add a hidden spacer element that gives the gutter its base
  /// width.
  initialSpacer?: null | ((view: EditorView) => GutterMarker)
  /// Update the spacer element when the view is updated.
  updateSpacer?: null | ((spacer: GutterMarker, update: ViewUpdate) => GutterMarker)
  /// Supply event handlers for DOM events on this gutter.
  domEventHandlers?: Handlers,
  /// By default, gutters are shown horizontally before the editor
  /// content (to the left in a left-to-right layout). Set this to
  /// `"after"` to show a gutter on the other side of the content.
  side?: "before" | "after"
}

const defaults = {
  class: "",
  renderEmptyElements: false,
  elementStyle: "",
  markers: () => RangeSet.empty,
  lineMarker: () => null,
  widgetMarker: () => null,
  lineMarkerChange: null,
  initialSpacer: null,
  updateSpacer: null,
  domEventHandlers: {},
  side: "before" as const
}

const activeGutters = Facet.define<Required<GutterConfig>>()

/// Define an editor gutter. The order in which the gutters appear is
/// determined by their extension priority.
export function gutter(config: GutterConfig): Extension {
  return [gutters(), activeGutters.of({...defaults, ...config})]
}

const unfixGutters = Facet.define<boolean, boolean>({
  combine: values => values.some(x => x)
})

/// The gutter-drawing plugin is automatically enabled when you add a
/// gutter, but you can use this function to explicitly configure it.
///
/// Unless `fixed` is explicitly set to `false`, the gutters are
/// fixed, meaning they don't scroll along with the content
/// horizontally (except on Internet Explorer, which doesn't support
/// CSS [`position:
/// sticky`](https://developer.mozilla.org/en-US/docs/Web/CSS/position#sticky)).
export function gutters(config?: {fixed?: boolean}): Extension {
  let result: Extension[] = [
    gutterView,
  ]
  if (config && config.fixed === false) result.push(unfixGutters.of(true))
  return result
}

const gutterView = ViewPlugin.fromClass(class {
  gutters: SingleGutterView[]
  dom: HTMLElement
  domAfter: HTMLElement | null = null
  fixed: boolean
  prevViewport: {from: number, to: number}

  constructor(readonly view: EditorView) {
    this.prevViewport = view.viewport
    this.dom = document.createElement("div")
    this.dom.className = "cm-gutters cm-gutters-before"
    this.dom.setAttribute("aria-hidden", "true")
    this.dom.style.minHeight = (this.view.contentHeight / this.view.scaleY) + "px"
    this.gutters = view.state.facet(activeGutters).map(conf => new SingleGutterView(view, conf))
    this.fixed = !view.state.facet(unfixGutters)
    for (let gutter of this.gutters) {
      if (gutter.config.side == "after") this.getDOMAfter().appendChild(gutter.dom)
      else this.dom.appendChild(gutter.dom)
    }
    if (this.fixed) {
      // FIXME IE11 fallback, which doesn't support position: sticky,
      // by using position: relative + event handlers that realign the
      // gutter (or just force fixed=false on IE11?)
      this.dom.style.position = "sticky"
    }
    this.syncGutters(false)
    view.scrollDOM.insertBefore(this.dom, view.contentDOM)
  }

  getDOMAfter() {
    if (!this.domAfter) {
      this.domAfter = document.createElement("div")
      this.domAfter.className = "cm-gutters cm-gutters-after"
      this.domAfter.setAttribute("aria-hidden", "true")
      this.domAfter.style.minHeight = (this.view.contentHeight / this.view.scaleY) + "px"
      this.domAfter.style.position = this.fixed ? "sticky" : ""
      this.view.scrollDOM.appendChild(this.domAfter)
    }
    return this.domAfter
  }

  update(update: ViewUpdate) {
    if (this.updateGutters(update)) {
      // Detach during sync when the viewport changed significantly
      // (such as during scrolling), since for large updates that is
      // faster.
      let vpA = this.prevViewport, vpB = update.view.viewport
      let vpOverlap = Math.min(vpA.to, vpB.to) - Math.max(vpA.from, vpB.from)
      this.syncGutters(vpOverlap < (vpB.to - vpB.from) * 0.8)
    }
    if (update.geometryChanged) {
      let min = (this.view.contentHeight / this.view.scaleY) + "px"
      this.dom.style.minHeight = min
      if (this.domAfter) this.domAfter.style.minHeight = min
    }
    if (this.view.state.facet(unfixGutters) != !this.fixed) {
      this.fixed = !this.fixed
      this.dom.style.position = this.fixed ? "sticky" : ""
      if (this.domAfter) this.domAfter.style.position = this.fixed ? "sticky" : ""
    }
    this.prevViewport = update.view.viewport
  }

  syncGutters(detach: boolean) {
    let after = this.dom.nextSibling
    if (detach) {
      this.dom.remove()
      if (this.domAfter) this.domAfter.remove()
    }
    let lineClasses = RangeSet.iter(this.view.state.facet(gutterLineClass), this.view.viewport.from)
    let classSet: GutterMarker[] = []
    let contexts = this.gutters.map(gutter => new UpdateContext(gutter, this.view.viewport, -this.view.documentPadding.top))
    for (let line of this.view.viewportLineBlocks) {
      if (classSet.length) classSet = []
      if (Array.isArray(line.type)) {
        let first = true
        for (let b of line.type) {
          if (b.type == BlockType.Text && first) {
            advanceCursor(lineClasses, classSet, b.from)
            for (let cx of contexts) cx.line(this.view, b, classSet)
            first = false
          } else if (b.widget) {
            for (let cx of contexts) cx.widget(this.view, b)
          }
        }
      } else if (line.type == BlockType.Text) {
        advanceCursor(lineClasses, classSet, line.from)
        for (let cx of contexts) cx.line(this.view, line, classSet)
      } else if (line.widget) {
        for (let cx of contexts) cx.widget(this.view, line)
      }
    }
    for (let cx of contexts) cx.finish()
    if (detach) {
      this.view.scrollDOM.insertBefore(this.dom, after)
      if (this.domAfter) this.view.scrollDOM.appendChild(this.domAfter)
    }
  }

  updateGutters(update: ViewUpdate) {
    let prev = update.startState.facet(activeGutters), cur = update.state.facet(activeGutters)
    let change = update.docChanged || update.heightChanged || update.viewportChanged ||
      !RangeSet.eq(update.startState.facet(gutterLineClass), update.state.facet(gutterLineClass),
                   update.view.viewport.from, update.view.viewport.to)
    if (prev == cur) {
      for (let gutter of this.gutters) if (gutter.update(update)) change = true
    } else {
      change = true
      let gutters = []
      for (let conf of cur) {
        let known = prev.indexOf(conf)
        if (known < 0) {
          gutters.push(new SingleGutterView(this.view, conf))
        } else {
          this.gutters[known].update(update)
          gutters.push(this.gutters[known])
        }
      }
      for (let g of this.gutters) {
        g.dom.remove()
        if (gutters.indexOf(g) < 0) g.destroy()
      }
      for (let g of gutters) {
        if (g.config.side == "after") this.getDOMAfter().appendChild(g.dom)
        else this.dom.appendChild(g.dom)
      }
      this.gutters = gutters
    }
    return change
  }

  destroy() {
    for (let view of this.gutters) view.destroy()
    this.dom.remove()
    if (this.domAfter) this.domAfter.remove()
  }
}, {
  provide: plugin => EditorView.scrollMargins.of(view => {
    let value = view.plugin(plugin)
    if (!value || value.gutters.length == 0 || !value.fixed) return null
    let before = value.dom.offsetWidth * view.scaleX, after = value.domAfter ? value.domAfter.offsetWidth * view.scaleX : 0
    return view.textDirection == Direction.LTR
      ? {left: before, right: after}
      : {right: before, left: after}
  })
})

function asArray<T>(val: T | readonly T[]) { return (Array.isArray(val) ? val : [val]) as readonly T[] }

function advanceCursor(cursor: RangeCursor<GutterMarker>, collect: GutterMarker[], pos: number) {
  while (cursor.value && cursor.from <= pos) {
    if (cursor.from == pos) collect.push(cursor.value)
    cursor.next()
  }
}

class UpdateContext {
  cursor: RangeCursor<GutterMarker>
  i = 0

  constructor(readonly gutter: SingleGutterView, viewport: {from: number, to: number}, public height: number) {
    this.cursor = RangeSet.iter(gutter.markers, viewport.from)
  }

  addElement(view: EditorView, block: BlockInfo, markers: readonly GutterMarker[]) {
    let {gutter} = this, above = (block.top - this.height) / view.scaleY, height = block.height / view.scaleY
    if (this.i == gutter.elements.length) {
      let newElt = new GutterElement(view, height, above, markers)
      gutter.elements.push(newElt)
      gutter.dom.appendChild(newElt.dom)
    } else {
      gutter.elements[this.i].update(view, height, above, markers)
    }
    this.height = block.bottom
    this.i++
  }

  line(view: EditorView, line: BlockInfo, extraMarkers: readonly GutterMarker[]) {
    let localMarkers: GutterMarker[] = []
    advanceCursor(this.cursor, localMarkers, line.from)
    if (extraMarkers.length) localMarkers = localMarkers.concat(extraMarkers)
    let forLine = this.gutter.config.lineMarker(view, line, localMarkers)
    if (forLine) localMarkers.unshift(forLine)

    let gutter = this.gutter
    if (localMarkers.length == 0 && !gutter.config.renderEmptyElements) return
    this.addElement(view, line, localMarkers)
  }

  widget(view: EditorView, block: BlockInfo) {
    let marker = this.gutter.config.widgetMarker(view, block.widget!, block), markers = marker ? [marker] : null
    for (let cls of view.state.facet(gutterWidgetClass)) {
      let marker = cls(view, block.widget!, block)
      if (marker) (markers || (markers = [])).push(marker)
    }
    if (markers) this.addElement(view, block, markers)
  }

  finish() {
    let gutter = this.gutter
    while (gutter.elements.length > this.i) {
      let last = gutter.elements.pop()!
      gutter.dom.removeChild(last.dom)
      last.destroy()
    }
  }
}

class SingleGutterView {
  dom: HTMLElement
  elements: GutterElement[] = []
  markers: readonly RangeSet<GutterMarker>[]
  spacer: GutterElement | null = null

  constructor(public view: EditorView, public config: Required<GutterConfig>) {
    this.dom = document.createElement("div")
    this.dom.className = "cm-gutter" + (this.config.class ? " " + this.config.class : "")
    for (let prop in config.domEventHandlers) {
      this.dom.addEventListener(prop, (event: Event) => {
        let target = event.target as HTMLElement, y
        if (target != this.dom && this.dom.contains(target)) {
          while (target.parentNode != this.dom) target = target.parentNode as HTMLElement
          let rect = target.getBoundingClientRect()
          y = (rect.top + rect.bottom) / 2
        } else {
          y = (event as MouseEvent).clientY
        }
        let line = view.lineBlockAtHeight(y - view.documentTop)
        if (config.domEventHandlers[prop](view, line, event)) event.preventDefault()
      })
    }
    this.markers = asArray(config.markers(view))
    if (config.initialSpacer) {
      this.spacer = new GutterElement(view, 0, 0, [config.initialSpacer(view)])
      this.dom.appendChild(this.spacer.dom)
      this.spacer.dom.style.cssText += "visibility: hidden; pointer-events: none"
    }
  }

  update(update: ViewUpdate) {
    let prevMarkers = this.markers
    this.markers = asArray(this.config.markers(update.view))
    if (this.spacer && this.config.updateSpacer) {
      let updated = this.config.updateSpacer(this.spacer.markers[0], update)
      if (updated != this.spacer.markers[0]) this.spacer.update(update.view, 0, 0, [updated])
    }
    let vp = update.view.viewport
    return !RangeSet.eq(this.markers, prevMarkers, vp.from, vp.to) ||
      (this.config.lineMarkerChange ? this.config.lineMarkerChange(update) : false)
  }

  destroy() {
    for (let elt of this.elements) elt.destroy()
  }
}

class GutterElement {
  dom: HTMLElement
  height: number = -1
  above: number = 0
  markers: readonly GutterMarker[] = []

  constructor(view: EditorView, height: number, above: number, markers: readonly GutterMarker[]) {
    this.dom = document.createElement("div")
    this.dom.className = "cm-gutterElement"
    this.update(view, height, above, markers)
  }

  update(view: EditorView, height: number, above: number, markers: readonly GutterMarker[]) {
    if (this.height != height) {
      this.height = height
      this.dom.style.height = height + "px"
    }
    if (this.above != above)
      this.dom.style.marginTop = (this.above = above) ? above + "px" : ""
    if (!sameMarkers(this.markers, markers)) this.setMarkers(view, markers)
  }

  setMarkers(view: EditorView, markers: readonly GutterMarker[]) {
    let cls = "cm-gutterElement", domPos = this.dom.firstChild
    for (let iNew = 0, iOld = 0;;) {
      let skipTo = iOld, marker = iNew < markers.length ? markers[iNew++] : null, matched = false
      if (marker) {
        let c = marker.elementClass
        if (c) cls += " " + c
        for (let i = iOld; i < this.markers.length; i++)
          if (this.markers[i].compare(marker)) { skipTo = i; matched = true; break }
      } else {
        skipTo = this.markers.length
      }
      while (iOld < skipTo) {
        let next = this.markers[iOld++]
        if (next.toDOM) {
          next.destroy(domPos!)
          let after = domPos!.nextSibling
          domPos!.remove()
          domPos = after
        }
      }
      if (!marker) break
      if (marker.toDOM) {
        if (matched) domPos = domPos!.nextSibling
        else this.dom.insertBefore(marker.toDOM(view), domPos)
      }
      if (matched) iOld++
    }
    this.dom.className = cls
    this.markers = markers
  }

  destroy() {
    this.setMarkers(null as any, []) // First argument not used unless creating markers
  }
}

function sameMarkers(a: readonly GutterMarker[], b: readonly GutterMarker[]): boolean {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].compare(b[i])) return false
  return true
}

interface LineNumberConfig {
  /// How to display line numbers. Defaults to simply converting them
  /// to string.
  formatNumber?: (lineNo: number, state: EditorState) => string
  /// Supply event handlers for DOM events on this gutter.
  domEventHandlers?: Handlers
}

/// Facet used to provide markers to the line number gutter.
export const lineNumberMarkers = Facet.define<RangeSet<GutterMarker>>()

/// Facet used to create markers in the line number gutter next to widgets.
export const lineNumberWidgetMarker = Facet.define<(view: EditorView, widget: WidgetType, block: BlockInfo) => GutterMarker | null>()

const lineNumberConfig = Facet.define<LineNumberConfig, Required<LineNumberConfig>>({
  combine(values) {
    return combineConfig<Required<LineNumberConfig>>(values, {formatNumber: String, domEventHandlers: {}}, {
      domEventHandlers(a: Handlers, b: Handlers) {
        let result: Handlers = Object.assign({}, a)
        for (let event in b) {
          let exists = result[event], add = b[event]
          result[event] = exists ? (view, line, event) => exists(view, line, event) || add(view, line, event) : add
        }
        return result
      }
    })
  }
})

class NumberMarker extends GutterMarker {
  constructor(readonly number: string) { super() }

  eq(other: NumberMarker) { return this.number == other.number }

  toDOM() { return document.createTextNode(this.number) }
}

function formatNumber(view: EditorView, number: number) {
  return view.state.facet(lineNumberConfig).formatNumber(number, view.state)
}

const lineNumberGutter = activeGutters.compute([lineNumberConfig], state => ({
  class: "cm-lineNumbers",
  renderEmptyElements: false,
  markers(view: EditorView) { return view.state.facet(lineNumberMarkers) },
  lineMarker(view, line, others) {
    if (others.some(m => m.toDOM)) return null
    return new NumberMarker(formatNumber(view, view.state.doc.lineAt(line.from).number))
  },
  widgetMarker: (view, widget, block) => {
    for (let m of view.state.facet(lineNumberWidgetMarker)) {
      let result = m(view, widget, block)
      if (result) return result
    }
    return null
  },
  lineMarkerChange: update => update.startState.facet(lineNumberConfig) != update.state.facet(lineNumberConfig),
  initialSpacer(view: EditorView) {
    return new NumberMarker(formatNumber(view, maxLineNumber(view.state.doc.lines)))
  },
  updateSpacer(spacer: GutterMarker, update: ViewUpdate) {
    let max = formatNumber(update.view, maxLineNumber(update.view.state.doc.lines))
    return max == (spacer as NumberMarker).number ? spacer : new NumberMarker(max)
  },
  domEventHandlers: state.facet(lineNumberConfig).domEventHandlers,
  side: "before"
}))

/// Create a line number gutter extension.
export function lineNumbers(config: LineNumberConfig = {}): Extension {
  return [
    lineNumberConfig.of(config),
    gutters(),
    lineNumberGutter
  ]
}

function maxLineNumber(lines: number) {
  let last = 9
  while (last < lines) last = last * 10 + 9
  return last
}

const activeLineGutterMarker = new class extends GutterMarker {
  elementClass = "cm-activeLineGutter"
}

const activeLineGutterHighlighter = gutterLineClass.compute(["selection"], state => {
  let marks = [], last = -1
  for (let range of state.selection.ranges) {
    let linePos = state.doc.lineAt(range.head).from
    if (linePos > last) {
      last = linePos
      marks.push(activeLineGutterMarker.range(linePos))
    }
  }
  return RangeSet.of(marks)
})

/// Returns an extension that adds a `cm-activeLineGutter` class to
/// all gutter elements on the [active
/// line](#view.highlightActiveLine).
export function highlightActiveLineGutter() {
  return activeLineGutterHighlighter
}
