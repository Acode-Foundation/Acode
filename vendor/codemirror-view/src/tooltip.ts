import {EditorState, Transaction, StateEffect, StateEffectType,
        Facet, StateField, Extension, MapMode, FacetReader} from "@codemirror/state"
import {EditorView} from "./editorview"
import {ViewPlugin, ViewUpdate, logException, getScrollMargins} from "./extension"
import {Direction} from "./bidi"
import {Rect} from "./dom"
import browser from "./browser"

type Measured = {
  visible: Rect,
  parent: DOMRect,
  pos: (Rect | null)[],
  size: DOMRect[],
  space: Rect,
  scaleX: number, scaleY: number,
  makeAbsolute: boolean
}

const Outside = "-10000px"

const enum Arrow { Size = 7, Offset = 14 }

class TooltipViewManager {
  private input: readonly (Tooltip | null)[]
  tooltips: readonly Tooltip[]
  tooltipViews: readonly TooltipView[]

  constructor(
    view: EditorView,
    private readonly facet: FacetReader<readonly (Tooltip | null)[]>,
    private readonly createTooltipView: (tooltip: Tooltip, after: TooltipView | null) => TooltipView,
    private readonly removeTooltipView: (tooltipView: TooltipView) => void
  ) {
    this.input = view.state.facet(facet)
    this.tooltips = this.input.filter(t => t) as Tooltip[]
    let prev: TooltipView | null = null
    this.tooltipViews = this.tooltips.map(t => prev = createTooltipView(t, prev))
  }

  update(update: ViewUpdate, above?: boolean[]) {
    let input = update.state.facet(this.facet)
    let tooltips = input.filter(x => x) as Tooltip[]
    if (input === this.input) {
      for (let t of this.tooltipViews) if (t.update) t.update(update)
      return false
    }

    let tooltipViews: TooltipView[] = [], newAbove: boolean[] | null = above ? [] : null
    for (let i = 0; i < tooltips.length; i++) {
      let tip = tooltips[i], known = -1
      if (!tip) continue
      for (let i = 0; i < this.tooltips.length; i++) {
        let other = this.tooltips[i]
        if (other && other.create == tip.create) known = i
      }
      if (known < 0) {
        tooltipViews[i] = this.createTooltipView(tip, i ? tooltipViews[i - 1] : null)
        if (newAbove) newAbove[i] = !!tip.above
      } else {
        let tooltipView = tooltipViews[i] = this.tooltipViews[known]
        if (newAbove) newAbove[i] = above![known]
        if (tooltipView.update) tooltipView.update(update)
      }
    }
    for (let t of this.tooltipViews) if (tooltipViews.indexOf(t) < 0) {
      this.removeTooltipView(t)
      t.destroy?.()
    }
    if (above) {
      newAbove!.forEach((val, i) => above[i] = val)
      above.length = newAbove!.length
    }

    this.input = input
    this.tooltips = tooltips
    this.tooltipViews = tooltipViews
    return true
  }
}

/// Creates an extension that configures tooltip behavior.
export function tooltips(config: {
  /// By default, tooltips use `"fixed"`
  /// [positioning](https://developer.mozilla.org/en-US/docs/Web/CSS/position),
  /// which has the advantage that tooltips don't get cut off by
  /// scrollable parent elements. However, CSS rules like `contain:
  /// layout` can break fixed positioning in child nodes, which can be
  /// worked about by using `"absolute"` here.
  ///
  /// On iOS, which at the time of writing still doesn't properly
  /// support fixed positioning, the library always uses absolute
  /// positioning.
  ///
  /// If the tooltip parent element sits in a transformed element, the
  /// library also falls back to absolute positioning.
  position?: "fixed" | "absolute",
  /// The element to put the tooltips into. By default, they are put
  /// in the editor (`cm-editor`) element, and that is usually what
  /// you want. But in some layouts that can lead to positioning
  /// issues, and you need to use a different parent to work around
  /// those.
  parent?: HTMLElement
  /// By default, when figuring out whether there is room for a
  /// tooltip at a given position, the extension considers the entire
  /// space between 0,0 and
  /// `documentElement.clientWidth`/`clientHeight` to be available for
  /// showing tooltips. You can provide a function here that returns
  /// an alternative rectangle.
  tooltipSpace?: (view: EditorView) => Rect
} = {}): Extension {
  return tooltipConfig.of(config)
}

type TooltipConfig = {
  position: "fixed" | "absolute",
  parent: HTMLElement | null,
  tooltipSpace: (view: EditorView) => Rect
}

function windowSpace(view: EditorView) {
  let docElt = view.dom.ownerDocument.documentElement
  return {top: 0, left: 0, bottom: docElt.clientHeight, right: docElt.clientWidth}
}

const tooltipConfig = Facet.define<Partial<TooltipConfig>, TooltipConfig>({
  combine: values => ({
    position: browser.ios ? "absolute" : values.find(conf => conf.position)?.position || "fixed",
    parent: values.find(conf => conf.parent)?.parent || null,
    tooltipSpace: values.find(conf => conf.tooltipSpace)?.tooltipSpace || windowSpace,
  })
})

const knownHeight = new WeakMap<TooltipView, number>()

const tooltipPlugin = ViewPlugin.fromClass(class {
  manager: TooltipViewManager
  above: boolean[] = []
  measureReq: {read: () => Measured, write: (m: Measured) => void, key: any}
  inView = true
  position: "fixed" | "absolute"
  madeAbsolute = false
  parent: HTMLElement | null
  declare container: HTMLElement
  classes: string
  intersectionObserver: IntersectionObserver | null
  resizeObserver: ResizeObserver | null
  lastTransaction = 0
  measureTimeout = -1

  constructor(readonly view: EditorView) {
    let config = view.state.facet(tooltipConfig)
    this.position = config.position
    this.parent = config.parent
    this.classes = view.themeClasses
    this.createContainer()
    this.measureReq = {read: this.readMeasure.bind(this), write: this.writeMeasure.bind(this), key: this}
    this.resizeObserver = typeof ResizeObserver == "function" ? new ResizeObserver(() => this.measureSoon()) : null
    this.manager = new TooltipViewManager(view, showTooltip, (t, p) => this.createTooltip(t, p), t => {
      if (this.resizeObserver) this.resizeObserver.unobserve(t.dom)
      t.dom.remove()
    })
    this.above = this.manager.tooltips.map(t => !!t.above)
    this.intersectionObserver = typeof IntersectionObserver == "function" ? new IntersectionObserver(entries => {
      if (Date.now() > this.lastTransaction - 50 &&
          entries.length > 0 && entries[entries.length - 1].intersectionRatio < 1)
        this.measureSoon()
    }, {threshold: [1]}) : null
    this.observeIntersection()
    view.win.addEventListener("resize", this.measureSoon = this.measureSoon.bind(this))
    this.maybeMeasure()
  }

  createContainer() {
    if (this.parent) {
      this.container = document.createElement("div")
      this.container.style.position = "relative"
      this.container.className = this.view.themeClasses
      this.parent.appendChild(this.container)
    } else {
      this.container = this.view.dom
    }
  }

  observeIntersection() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect()
      for (let tooltip of this.manager.tooltipViews)
        this.intersectionObserver.observe(tooltip.dom)
    }
  }

  measureSoon() {
    if (this.measureTimeout < 0) this.measureTimeout = setTimeout(() => {
      this.measureTimeout = -1
      this.maybeMeasure()
    }, 50)
  }

  update(update: ViewUpdate) {
    if (update.transactions.length) this.lastTransaction = Date.now()
    let updated = this.manager.update(update, this.above)
    if (updated) this.observeIntersection()
    let shouldMeasure = updated || update.geometryChanged
    let newConfig = update.state.facet(tooltipConfig)
    if (newConfig.position != this.position && !this.madeAbsolute) {
      this.position = newConfig.position
      for (let t of this.manager.tooltipViews) t.dom.style.position = this.position
      shouldMeasure = true
    }
    if (newConfig.parent != this.parent) {
      if (this.parent) this.container.remove()
      this.parent = newConfig.parent
      this.createContainer()
      for (let t of this.manager.tooltipViews) this.container.appendChild(t.dom)
      shouldMeasure = true
    } else if (this.parent && this.view.themeClasses != this.classes) {
      this.classes = this.container.className = this.view.themeClasses
    }
    if (shouldMeasure) this.maybeMeasure()
  }

  createTooltip(tooltip: Tooltip, prev: TooltipView | null) {
    let tooltipView = tooltip.create(this.view)
    let before = prev ? prev.dom : null
    tooltipView.dom.classList.add("cm-tooltip")
    if (tooltip.arrow && !tooltipView.dom.querySelector(".cm-tooltip > .cm-tooltip-arrow")) {
      let arrow = document.createElement("div")
      arrow.className = "cm-tooltip-arrow"
      tooltipView.dom.appendChild(arrow)
    }
    tooltipView.dom.style.position = this.position
    tooltipView.dom.style.top = Outside
    tooltipView.dom.style.left = "0px"
    this.container.insertBefore(tooltipView.dom, before)
    if (tooltipView.mount) tooltipView.mount(this.view)
    if (this.resizeObserver) this.resizeObserver.observe(tooltipView.dom)
    return tooltipView
  }

  destroy() {
    this.view.win.removeEventListener("resize", this.measureSoon)
    for (let tooltipView of this.manager.tooltipViews) {
      tooltipView.dom.remove()
      tooltipView.destroy?.()
    }
    if (this.parent) this.container.remove()
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    clearTimeout(this.measureTimeout)
  }

  readMeasure(): Measured {
    let scaleX = 1, scaleY = 1, makeAbsolute = false
    if (this.position == "fixed" && this.manager.tooltipViews.length) {
      let {dom} = this.manager.tooltipViews[0]
      if (browser.safari) {
        // Safari always sets offsetParent to null, even if a fixed
        // element is positioned relative to a transformed parent. So
        // we use this kludge to try and detect this.
        let rect = dom.getBoundingClientRect()
        makeAbsolute = Math.abs(rect.top + 10000) > 1 || Math.abs(rect.left) > 1
      } else {
        // More conforming browsers will set offsetParent to the
        // transformed element.
        makeAbsolute = !!dom.offsetParent && dom.offsetParent != this.container.ownerDocument.body
      }
    }
    if (makeAbsolute || this.position == "absolute") {
      if (this.parent) {
        let rect = this.parent.getBoundingClientRect()
        if (rect.width && rect.height) {
          scaleX = rect.width / this.parent.offsetWidth
          scaleY = rect.height / this.parent.offsetHeight
        }
      } else {
        ;({scaleX, scaleY} = this.view.viewState)
      }
    }
    let visible = this.view.scrollDOM.getBoundingClientRect(), margins = getScrollMargins(this.view)
    return {
      visible: {
        left: visible.left + margins.left, top: visible.top + margins.top,
        right: visible.right - margins.right, bottom: visible.bottom - margins.bottom
      },
      parent: this.parent ? this.container.getBoundingClientRect() : this.view.dom.getBoundingClientRect(),
      pos: this.manager.tooltips.map((t, i) => {
        let tv = this.manager.tooltipViews[i]
        return tv.getCoords ? tv.getCoords(t.pos) : this.view.coordsAtPos(t.pos)
      }),
      size: this.manager.tooltipViews.map(({dom}) => dom.getBoundingClientRect()),
      space: this.view.state.facet(tooltipConfig).tooltipSpace(this.view),
      scaleX, scaleY, makeAbsolute
    }
  }

  writeMeasure(measured: Measured) {
    if (measured.makeAbsolute) {
      this.madeAbsolute = true
      this.position = "absolute"
      for (let t of this.manager.tooltipViews) t.dom.style.position = "absolute"
    }

    let {visible, space, scaleX, scaleY} = measured
    let others = []
    for (let i = 0; i < this.manager.tooltips.length; i++) {
      let tooltip = this.manager.tooltips[i], tView = this.manager.tooltipViews[i], {dom} = tView
      let pos = measured.pos[i], size = measured.size[i]
      // Hide tooltips that are outside of the editor.
      if (!pos || tooltip.clip !== false && (
            pos.bottom <= Math.max(visible.top, space.top) ||
            pos.top >= Math.min(visible.bottom, space.bottom) ||
            pos.right < Math.max(visible.left, space.left) - .1 ||
            pos.left > Math.min(visible.right, space.right) + .1)) {
        dom.style.top = Outside
        continue
      }
      let arrow: HTMLElement | null = tooltip.arrow ? tView.dom.querySelector(".cm-tooltip-arrow") : null
      let arrowHeight = arrow ? Arrow.Size : 0
      let width = size.right - size.left, height = knownHeight.get(tView) ?? size.bottom - size.top
      let offset = tView.offset || noOffset, ltr = this.view.textDirection == Direction.LTR
      let left = size.width > space.right - space.left
        ? (ltr ? space.left : space.right - size.width)
        : ltr ? Math.max(space.left, Math.min(pos.left - (arrow ? Arrow.Offset : 0) + offset.x, space.right - width))
        : Math.min(Math.max(space.left, pos.left - width + (arrow ? Arrow.Offset : 0) - offset.x), space.right - width)
      let above = this.above[i]
      if (!tooltip.strictSide && (above
            ? pos.top - height - arrowHeight - offset.y < space.top
            : pos.bottom + height + arrowHeight + offset.y > space.bottom) &&
          above == (space.bottom - pos.bottom > pos.top - space.top))
        above = this.above[i] = !above
      let spaceVert = (above ? pos.top - space.top : space.bottom - pos.bottom) - arrowHeight
      if (spaceVert < height && tView.resize !== false) {
        if (spaceVert < this.view.defaultLineHeight) { dom.style.top = Outside; continue }
        knownHeight.set(tView, height)
        dom.style.height = (height = spaceVert) / scaleY + "px"
      } else if (dom.style.height) {
        dom.style.height = ""
      }
      let top = above ? pos.top - height - arrowHeight - offset.y : pos.bottom + arrowHeight + offset.y
      let right = left + width
      if (tView.overlap !== true) for (let r of others)
        if (r.left < right && r.right > left && r.top < top + height && r.bottom > top)
          top = above ? r.top - height - 2 - arrowHeight : r.bottom + arrowHeight + 2
      if (this.position == "absolute") {
        dom.style.top = (top - measured.parent.top) / scaleY + "px"
        setLeftStyle(dom, (left - measured.parent.left) / scaleX)
      } else {
        dom.style.top = top / scaleY + "px"
        setLeftStyle(dom, left / scaleX)
      }
      if (arrow) {
        let arrowLeft = pos.left + (ltr ? offset.x : -offset.x) - (left + Arrow.Offset - Arrow.Size)
        arrow.style.left = arrowLeft / scaleX + "px"
      }

      if (tView.overlap !== true)
        others.push({left, top, right, bottom: top + height})
      dom.classList.toggle("cm-tooltip-above", above)
      dom.classList.toggle("cm-tooltip-below", !above)
      if (tView.positioned) tView.positioned(measured.space)
    }
  }

  maybeMeasure() {
    if (this.manager.tooltips.length) {
      if (this.view.inView) this.view.requestMeasure(this.measureReq)
      if (this.inView != this.view.inView) {
        this.inView = this.view.inView
        if (!this.inView) for (let tv of this.manager.tooltipViews) tv.dom.style.top = Outside
      }
    }
  }
}, {
  eventObservers: {
    scroll() { this.maybeMeasure() }
  }
})

function setLeftStyle(elt: HTMLElement, value: number) {
  let current = parseInt(elt.style.left, 10)
  if (isNaN(current) || Math.abs(value - current) > 1) elt.style.left = value + "px"
}

const baseTheme = EditorView.baseTheme({
  ".cm-tooltip": {
    zIndex: 500,
    boxSizing: "border-box"
  },
  "&light .cm-tooltip": {
    border: "1px solid #bbb",
    backgroundColor: "#f5f5f5"
  },
  "&light .cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid #bbb",
  },
  "&dark .cm-tooltip": {
    backgroundColor: "#333338",
    color: "white"
  },
  ".cm-tooltip-arrow": {
    height: `${Arrow.Size}px`,
    width: `${Arrow.Size * 2}px`,
    position: "absolute",
    zIndex: -1,
    overflow: "hidden",
    "&:before, &:after": {
      content: "''",
      position: "absolute",
      width: 0,
      height: 0,
      borderLeft: `${Arrow.Size}px solid transparent`,
      borderRight: `${Arrow.Size}px solid transparent`,
    },
    ".cm-tooltip-above &": {
      bottom: `-${Arrow.Size}px`,
      "&:before": {
        borderTop: `${Arrow.Size}px solid #bbb`,
      },
      "&:after": {
        borderTop: `${Arrow.Size}px solid #f5f5f5`,
        bottom: "1px"
      }
    },
    ".cm-tooltip-below &": {
      top: `-${Arrow.Size}px`,
      "&:before": {
        borderBottom: `${Arrow.Size}px solid #bbb`,
      },
      "&:after": {
        borderBottom: `${Arrow.Size}px solid #f5f5f5`,
        top: "1px"
      }
    },
  },
  "&dark .cm-tooltip .cm-tooltip-arrow": {
    "&:before": {
      borderTopColor: "#333338",
      borderBottomColor: "#333338"
    },
    "&:after": {
      borderTopColor: "transparent",
      borderBottomColor: "transparent"
    }
  }
})

/// Describes a tooltip. Values of this type, when provided through
/// the [`showTooltip`](#view.showTooltip) facet, control the
/// individual tooltips on the editor.
export interface Tooltip {
  /// The document position at which to show the tooltip.
  pos: number
  /// The end of the range annotated by this tooltip, if different
  /// from `pos`.
  end?: number
  /// A constructor function that creates the tooltip's [DOM
  /// representation](#view.TooltipView).
  create(view: EditorView): TooltipView
  /// Whether the tooltip should be shown above or below the target
  /// position. Not guaranteed to be respected for hover tooltips
  /// since all hover tooltips for the same range are always
  /// positioned together. Defaults to false.
  above?: boolean
  /// Whether the `above` option should be honored when there isn't
  /// enough space on that side to show the tooltip inside the
  /// viewport. Defaults to false.
  strictSide?: boolean,
  /// When set to true, show a triangle connecting the tooltip element
  /// to position `pos`.
  arrow?: boolean
  /// By default, tooltips are hidden when their position is outside
  /// of the visible editor content. Set this to false to turn that
  /// off.
  clip?: boolean
}

/// Describes the way a tooltip is displayed.
export interface TooltipView {
  /// The DOM element to position over the editor.
  dom: HTMLElement
  /// Adjust the position of the tooltip relative to its anchor
  /// position. A positive `x` value will move the tooltip
  /// horizontally along with the text direction (so right in
  /// left-to-right context, left in right-to-left). A positive `y`
  /// will move the tooltip up when it is above its anchor, and down
  /// otherwise.
  offset?: {x: number, y: number}
  /// By default, a tooltip's screen position will be based on the
  /// text position of its `pos` property. This method can be provided
  /// to make the tooltip view itself responsible for finding its
  /// screen position.
  getCoords?: (pos: number) => Rect
  /// By default, tooltips are moved when they overlap with other
  /// tooltips. Set this to `true` to disable that behavior for this
  /// tooltip.
  overlap?: boolean
  /// Called after the tooltip is added to the DOM for the first time.
  mount?(view: EditorView): void
  /// Update the DOM element for a change in the view's state.
  update?(update: ViewUpdate): void
  /// Called when the tooltip is removed from the editor or the editor
  /// is destroyed.
  destroy?(): void
  /// Called when the tooltip has been (re)positioned. The argument is
  /// the [space](#view.tooltips^config.tooltipSpace) available to the
  /// tooltip.
  positioned?(space: Rect): void,
  /// By default, the library will restrict the size of tooltips so
  /// that they don't stick out of the available space. Set this to
  /// false to disable that.
  resize?: boolean
}

const noOffset = {x: 0, y: 0}

/// Facet to which an extension can add a value to show a tooltip.
export const showTooltip = Facet.define<Tooltip | null>({
  enables: [tooltipPlugin, baseTheme]
})

const showHoverTooltip = Facet.define<readonly Tooltip[], readonly Tooltip[]>({
  combine: inputs => inputs.reduce((a, i) => a.concat(i), [])
})

class HoverTooltipHost implements TooltipView {
  private readonly manager: TooltipViewManager
  dom: HTMLElement
  mounted: boolean = false

  // Needs to be static so that host tooltip instances always match
  static create(view: EditorView) {
    return new HoverTooltipHost(view)
  }

  private constructor(readonly view: EditorView) {
    this.dom = document.createElement("div")
    this.dom.classList.add("cm-tooltip-hover")
    this.manager = new TooltipViewManager(view, showHoverTooltip, (t, p) => this.createHostedView(t, p), t => t.dom.remove())
  }

  createHostedView(tooltip: Tooltip, prev: TooltipView | null) {
    let hostedView = tooltip.create(this.view)
    hostedView.dom.classList.add("cm-tooltip-section")
    this.dom.insertBefore(hostedView.dom, prev ? prev.dom.nextSibling : this.dom.firstChild)
    if (this.mounted && hostedView.mount)
      hostedView.mount(this.view)
    return hostedView
  }

  mount(view: EditorView) {
    for (let hostedView of this.manager.tooltipViews) {
      if (hostedView.mount) hostedView.mount(view)
    }
    this.mounted = true
  }

  positioned(space: Rect) {
    for (let hostedView of this.manager.tooltipViews) {
      if (hostedView.positioned) hostedView.positioned(space)
    }
  }

  update(update: ViewUpdate) {
    this.manager.update(update)
  }

  destroy() {
    for (let t of this.manager.tooltipViews) t.destroy?.()
  }

  passProp<Key extends keyof TooltipView>(name: Key): TooltipView[Key] | undefined {
    let value: TooltipView[Key] | undefined = undefined
    for (let view of this.manager.tooltipViews) {
      let given = view[name]
      if (given !== undefined) {
        if (value === undefined) value = given
        else if (value !== given) return undefined
      }
    }
    return value
  }

  get offset() { return this.passProp("offset") }

  get getCoords() { return this.passProp("getCoords") }

  get overlap() { return this.passProp("overlap") }

  get resize() { return this.passProp("resize") }
}

const showHoverTooltipHost = showTooltip.compute([showHoverTooltip], state => {
  let tooltips = state.facet(showHoverTooltip)
  if (tooltips.length === 0) return null

  return {
    pos: Math.min(...tooltips.map(t => t.pos)),
    end: Math.max(...tooltips.map(t => t.end ?? t.pos)),
    create: HoverTooltipHost.create,
    above: tooltips[0].above,
    arrow: tooltips.some(t => t.arrow),
  }
})

const enum Hover { Time = 300, MaxDist = 6 }

/// The type of function that can be used as a [hover tooltip
/// source](#view.hoverTooltip^source).
export type HoverTooltipSource = (view: EditorView, pos: number, side: -1 | 1) => Tooltip | readonly Tooltip[] | null | Promise<Tooltip | readonly Tooltip[] | null>

const hoverPlugin = Facet.define<ViewPlugin<HoverPlugin>>()

class HoverPlugin {
  lastMove: {x: number, y: number, target: HTMLElement, time: number}
  hoverTimeout = -1
  restartTimeout = -1
  pending: {pos: number} | null = null

  constructor(readonly view: EditorView,
              readonly source: HoverTooltipSource,
              readonly field: StateField<readonly Tooltip[]>,
              readonly locked: WeakMap<readonly Tooltip[], (tr: Transaction) => boolean>,
              readonly setHover: StateEffectType<readonly Tooltip[]>,
              readonly hoverTime: number) {
    this.lastMove = {x: 0, y: 0, target: view.dom, time: 0}
    this.checkHover = this.checkHover.bind(this)
    view.dom.addEventListener("mouseleave", this.mouseleave = this.mouseleave.bind(this))
    view.dom.addEventListener("mousemove", this.mousemove = this.mousemove.bind(this))
  }

  update(update: ViewUpdate) {
    if (this.pending) {
      this.pending = null
      clearTimeout(this.restartTimeout)
      this.restartTimeout = setTimeout(() => this.startHover(), 20)
    }
  }

  get active() {
    return this.view.state.field(this.field)
  }

  checkHover() {
    this.hoverTimeout = -1
    if (this.active.length) return
    let hovered = Date.now() - this.lastMove.time
    if (hovered < this.hoverTime)
      this.hoverTimeout = setTimeout(this.checkHover, this.hoverTime - hovered)
    else
      this.startHover()
  }

  startHover() {
    clearTimeout(this.restartTimeout)
    let {view, lastMove} = this
    let tile = view.docView.tile.nearest(lastMove.target)
    if (!tile) return
    let pos: number, side: -1 | 1 = 1
    if (tile.isWidget()) {
      pos = tile.posAtStart
    } else {
      pos = view.posAtCoords(lastMove)!
      if (pos == null) return
      let posCoords = view.coordsAtPos(pos)
      if (!posCoords ||
          lastMove.y < posCoords.top || lastMove.y > posCoords.bottom ||
          lastMove.x < posCoords.left - view.defaultCharacterWidth ||
          lastMove.x > posCoords.right + view.defaultCharacterWidth) return
      let bidi = view.bidiSpans(view.state.doc.lineAt(pos)).find(s => s.from <= pos! && s.to >= pos!)
      let rtl = bidi && bidi.dir == Direction.RTL ? -1 : 1
      side = (lastMove.x < posCoords.left ? -rtl : rtl) as -1 | 1
    }
    this.activateHover(view, pos, side)
  }

  activateHover(view: EditorView, pos: number, side: -1 | 1, locked?: (tr: Transaction) => boolean) {
    let open = this.source(view, pos, side)

    let done = (value: Tooltip | readonly Tooltip[] | null) => {
      if (value && !(Array.isArray(value) && !value.length)) {
        let tooltips = Array.isArray(value) ? value : [value]
        if (locked) this.locked.set(tooltips, locked)
        view.dispatch({effects: this.setHover.of(tooltips)})
      }
    }
    if (open && "then" in open) {
      let pending = this.pending = {pos}
      ;(open as Promise<Tooltip | null>).then(result => {
        if (this.pending == pending) {
          this.pending = null
          done(result)
        }
      }, e => logException(view.state, e, "hover tooltip"))
    } else {
      done(open)
    }
  }

  get tooltip() {
    let plugin = this.view.plugin(tooltipPlugin)
    let index = plugin ? plugin.manager.tooltips.findIndex(t => t.create == HoverTooltipHost.create) : -1
    return index > -1 ? plugin!.manager.tooltipViews[index] : null
  }

  mousemove(event: MouseEvent) {
    this.lastMove = {x: event.clientX, y: event.clientY, target: event.target as HTMLElement, time: Date.now()}
    if (this.hoverTimeout < 0) this.hoverTimeout = setTimeout(this.checkHover, this.hoverTime)
    let {active, tooltip} = this
    if (active.length && !this.locked.has(active) && tooltip && !isInTooltip(tooltip.dom, event) || this.pending) {
      let {pos} = active[0] || this.pending!, end = active[0]?.end ?? pos
      if ((pos == end ? this.view.posAtCoords(this.lastMove) != pos
           : !isOverRange(this.view, pos, end, event.clientX, event.clientY, Hover.MaxDist))) {
        this.view.dispatch({effects: this.setHover.of([])})
        this.pending = null
      }
    }
  }

  mouseleave(event: MouseEvent) {
    clearTimeout(this.hoverTimeout)
    this.hoverTimeout = -1
    let {active} = this
    if (active.length && !this.locked.has(active)) {
      let {tooltip} = this
      let inTooltip = tooltip && tooltip.dom.contains(event.relatedTarget as HTMLElement)
      if (!inTooltip)
        this.view.dispatch({effects: this.setHover.of([])})
      else
        this.watchTooltipLeave(tooltip!.dom)
    }
  }

  watchTooltipLeave(tooltip: HTMLElement) {
    let watch = (event: MouseEvent) => {
      tooltip.removeEventListener("mouseleave", watch)
      let {active} = this
      if (active.length && !this.locked.has(active) && !this.view.dom.contains(event.relatedTarget as HTMLElement))
        this.view.dispatch({effects: this.setHover.of([])})
    }
    tooltip.addEventListener("mouseleave", watch)
  }

  destroy() {
    clearTimeout(this.hoverTimeout)
    clearTimeout(this.restartTimeout)
    this.view.dom.removeEventListener("mouseleave", this.mouseleave)
    this.view.dom.removeEventListener("mousemove", this.mousemove)
  }
}

const tooltipMargin = 4

function isInTooltip(tooltip: HTMLElement, event: MouseEvent) {
  let {left, right, top, bottom} = tooltip.getBoundingClientRect(), arrow
  if (arrow = tooltip.querySelector(".cm-tooltip-arrow")) {
    let arrowRect = arrow.getBoundingClientRect()
    top = Math.min(arrowRect.top, top)
    bottom = Math.max(arrowRect.bottom, bottom)
  }
  return event.clientX >= left - tooltipMargin && event.clientX <= right + tooltipMargin &&
    event.clientY >= top - tooltipMargin && event.clientY <= bottom + tooltipMargin
}

function isOverRange(view: EditorView, from: number, to: number, x: number, y: number, margin: number) {
  let rect = view.scrollDOM.getBoundingClientRect()
  let docBottom = view.documentTop + view.documentPadding.top + view.contentHeight
  if (rect.left > x || rect.right < x || rect.top > y || Math.min(rect.bottom, docBottom) < y) return false
  let pos = view.posAtCoords({x, y}, false)
  return pos >= from && pos <= to
}

/// Set up a hover tooltip, which shows up when the pointer hovers
/// over ranges of text. The callback is called when the mouse hovers
/// over the document text. It should, if there is a tooltip
/// associated with position `pos`, return the tooltip description
/// (either directly or in a promise). The `side` argument indicates
/// on which side of the position the pointer is—it will be -1 if the
/// pointer is before the position, 1 if after the position.
///
/// Note that all hover tooltips are hosted within a single tooltip
/// container element. This allows multiple tooltips over the same
/// range to be "merged" together without overlapping.
///
/// The return value is a valid [editor extension](#state.Extension)
/// but also provides an `active` property holding a state field that
/// can be used to read the currently active tooltips produced by this
/// extension.
export function hoverTooltip(
  source: HoverTooltipSource,
  options: {
    /// Controls whether a transaction hides the tooltip. The default
    /// is to not hide.
    hideOn?: (tr: Transaction, tooltip: Tooltip) => boolean,
    /// When enabled (this defaults to false), close the tooltip
    /// whenever the document changes or the selection is set.
    hideOnChange?: boolean | "touch",
    /// Hover time after which the tooltip should appear, in
    /// milliseconds. Defaults to 300ms.
    hoverTime?: number
  } = {}
): Extension & {active: StateField<readonly Tooltip[]>} {
  let setHover = StateEffect.define<readonly Tooltip[]>()
  // This would be better stored in the state field, but we've set
  // down the type of the field in our interface, so it's indirectly
  // stored by array identity.
  let locked = new WeakMap<readonly Tooltip[], (tr: Transaction) => boolean>()
  let hoverState = StateField.define<readonly Tooltip[]>({
    create() { return [] },

    update(value, tr) {
      let lock = locked.get(value)
      if (value.length) {
        if (options.hideOnChange && (tr.docChanged || tr.selection)) value = []
        else if (lock && lock(tr)) value = []
        else if (options.hideOn) value = value.filter(v => !options.hideOn!(tr, v))
      }
      if (tr.docChanged && value.length) {
        let mapped = []
        for (let tooltip of value) {
          let newPos = tr.changes.mapPos(tooltip.pos, -1, MapMode.TrackDel)
          if (newPos != null) {
            let copy: Tooltip = Object.assign(Object.create(null), tooltip)
            copy.pos = newPos
            if (copy.end != null) copy.end = tr.changes.mapPos(copy.end)
            mapped.push(copy)
          }
        }
        value = mapped
      }
      for (let effect of tr.effects) {
        if (effect.is(setHover)) { value = effect.value; lock = undefined }
        if (effect.is(closeHoverTooltipEffect) && !effect.value || effect.value == hoverState) value = []
      }
      if (value.length && lock) locked.set(value, lock)
      return value
    },

    provide: f => showHoverTooltip.from(f)
  })

  const plugin = ViewPlugin.define(view => new HoverPlugin(view, source, hoverState, locked, setHover,
                                                           options.hoverTime || Hover.Time))
  return {
    active: hoverState,
    extension: [
      hoverState,
      plugin,
      hoverPlugin.of(plugin),
      showHoverTooltipHost
    ]
  }
}

/// Activate hover tooltips for the given position and side. If you
/// provide a specific hover tooltip (the value returned from
/// [`hoverTooltip`](#view.hoverTooltip)), only that one will be
/// activated. If not given, all hover tooltips at the given position
/// are triggered.
///
/// Note that tooltips opened this way don't close automatically, and
/// you'll want to pass an `until` callback or use
/// [`closeHoverTooltip`](#view.closeHoverTooltip)/[`closeHoverTooltips`](#view.closeHoverTooltips)
/// to deactivate them.
export function activateHover(view: EditorView, pos: number, side: -1 | 1, options: {
  tooltip?: Extension,
  until?: (tr: Transaction) => boolean
} = {}) {
  let plugins = view.state.facet(hoverPlugin).map(p => view.plugin(p)).filter((p): p is HoverPlugin => !!p)
  if (options.tooltip && (options.tooltip as any).active) {
    let found = plugins.find(p => p.field == (options.tooltip as any).active)
    if (found) plugins = [found]
  }
  for (let plugin of plugins) plugin.activateHover(view, pos, side, options.until ?? (() => false))
}

/// Get the active tooltip view for a given tooltip, if available.
export function getTooltip(view: EditorView, tooltip: Tooltip): TooltipView | null {
  let plugin = view.plugin(tooltipPlugin)
  if (!plugin) return null
  let found = plugin.manager.tooltips.indexOf(tooltip)
  return found < 0 ? null : plugin.manager.tooltipViews[found]
}

/// Returns true if any hover tooltips are currently active.
export function hasHoverTooltips(state: EditorState) {
  return state.facet(showHoverTooltip).some(x => x)
}

const closeHoverTooltipEffect = StateEffect.define<StateField<any> | null>()

/// Transaction effect that closes all hover tooltips.
export const closeHoverTooltips: StateEffect<unknown> = closeHoverTooltipEffect.of(null)

/// Transaction effect that closes a specific hover tooltip.
export function closeHoverTooltip(tooltip: Extension & {active: StateField<readonly Tooltip[]>}): StateEffect<unknown> {
  return closeHoverTooltipEffect.of(tooltip.active)
}

/// Tell the tooltip extension to recompute the position of the active
/// tooltips. This can be useful when something happens (such as a
/// re-positioning or CSS change affecting the editor) that could
/// invalidate the existing tooltip positions.
export function repositionTooltips(view: EditorView) {
  let plugin = view.plugin(tooltipPlugin)
  if (plugin) plugin.maybeMeasure()
}
