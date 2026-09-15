import {NodeProp, SyntaxNode, NodeIterator} from "@lezer/common"
import {combineConfig, EditorState, StateEffect, ChangeDesc, Facet, StateField, Extension,
        RangeSet, RangeSetBuilder} from "@codemirror/state"
import {EditorView, BlockInfo, Command, Decoration, DecorationSet, WidgetType,
        KeyBinding, ViewPlugin, ViewUpdate, gutter, GutterMarker} from "@codemirror/view"
import {language, syntaxTree} from "./language"

/// A facet that registers a code folding service. When called with
/// the extent of a line, such a function should return a foldable
/// range that starts on that line (but continues beyond it), if one
/// can be found.
export const foldService = Facet.define<
  (state: EditorState, lineStart: number, lineEnd: number) => ({from: number, to: number} | null)
>()

/// This node prop is used to associate folding information with
/// syntax node types. Given a syntax node, it should check whether
/// that tree is foldable and return the range that can be collapsed
/// when it is.
export const foldNodeProp = new NodeProp<(node: SyntaxNode, state: EditorState) => ({from: number, to: number} | null)>()

/// [Fold](#language.foldNodeProp) function that folds everything but
/// the first and the last child of a syntax node. Useful for nodes
/// that start and end with delimiters.
export function foldInside(node: SyntaxNode): {from: number, to: number} | null {
  let first = node.firstChild, last = node.lastChild
  return first && first.to < last!.from ? {from: first.to, to: last!.type.isError ? node.to : last!.from} : null
}

function syntaxFolding(state: EditorState, start: number, end: number) {
  let tree = syntaxTree(state)
  if (tree.length < end) return null
  let stack = tree.resolveStack(end, 1)
  let found: null | {from: number, to: number} = null
  for (let iter: NodeIterator | null = stack; iter; iter = iter.next) {
    let cur = iter.node
    if (cur.to <= end || cur.from > end) continue
    if (found && cur.from < start) break
    let prop = cur.type.prop(foldNodeProp)
    if (prop && (cur.to < tree.length - 50 || tree.length == state.doc.length || !isUnfinished(cur))) {
      let value = prop(cur, state)
      if (value && value.from <= end && value.from >= start && value.to > end) found = value
    }
  }
  return found
}

function isUnfinished(node: SyntaxNode) {
  let ch = node.lastChild
  return ch && ch.to == node.to && ch.type.isError
}

/// Check whether the given line is foldable. First asks any fold
/// services registered through
/// [`foldService`](#language.foldService), and if none of them return
/// a result, tries to query the [fold node
/// prop](#language.foldNodeProp) of syntax nodes that cover the end
/// of the line.
export function foldable(state: EditorState, lineStart: number, lineEnd: number) {
  for (let service of state.facet(foldService)) {
    let result = service(state, lineStart, lineEnd)
    if (result) return result
  }
  return syntaxFolding(state, lineStart, lineEnd)
}

type DocRange = {from: number, to: number}

function mapRange(range: DocRange, mapping: ChangeDesc) {
  let from = mapping.mapPos(range.from, 1), to = mapping.mapPos(range.to, -1)
  return from >= to ? undefined : {from, to}
}

/// State effect that can be attached to a transaction to fold the
/// given range. (You probably only need this in exceptional
/// circumstances—usually you'll just want to let
/// [`foldCode`](#language.foldCode) and the [fold
/// gutter](#language.foldGutter) create the transactions.)
export const foldEffect = StateEffect.define<DocRange>({map: mapRange})

/// State effect that unfolds the given range (if it was folded).
export const unfoldEffect = StateEffect.define<DocRange>({map: mapRange})

function selectedLines(view: EditorView) {
  let lines: BlockInfo[] = []
  for (let {head} of view.state.selection.ranges) {
    if (lines.some(l => l.from <= head && l.to >= head)) continue
    lines.push(view.lineBlockAt(head))
  }
  return lines
}

/// The state field that stores the folded ranges (as a [decoration
/// set](#view.DecorationSet)). Can be passed to
/// [`EditorState.toJSON`](#state.EditorState.toJSON) and
/// [`fromJSON`](#state.EditorState^fromJSON) to serialize the fold
/// state.
export const foldState = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(folded, tr) {
    if (tr.isUserEvent("delete"))
      tr.changes.iterChangedRanges((fromA, toA) => folded = clearTouchedFolds(folded, fromA, toA))
    folded = folded.map(tr.changes)
    let rangesToFold = []
    for (let e of tr.effects) {
      if (e.is(foldEffect) && !foldExists(folded, e.value.from, e.value.to)) {
        rangesToFold.push(e.value)
      } else if (e.is(unfoldEffect)) {
        folded = folded.update({filter: (from, to) => e.value.from != from || e.value.to != to,
                                filterFrom: e.value.from, filterTo: e.value.to})
      }
    }
    if (rangesToFold.length) {
      let {preparePlaceholder} = tr.state.facet(foldConfig)
      let decorations = rangesToFold.map(value => {
        let widget = !preparePlaceholder ? foldWidget :
          Decoration.replace({widget: new PreparedFoldWidget(preparePlaceholder(tr.state, value))})
        return widget.range(value.from, value.to)
      })
      folded = folded.update({add: decorations})
    }
    // Clear folded ranges that cover the selection head
    if (tr.selection) folded = clearTouchedFolds(folded, tr.selection.main.head)
    return folded
  },
  provide: f => EditorView.decorations.from(f),
  toJSON(folded, state) {
    let ranges: number[] = []
    folded.between(0, state.doc.length, (from, to) => {ranges.push(from, to)})
    return ranges
  },
  fromJSON(value) {
    if (!Array.isArray(value) || value.length % 2) throw new RangeError("Invalid JSON for fold state")
    let ranges = []
    for (let i = 0; i < value.length;) {
      let from = value[i++], to = value[i++]
      if (typeof from != "number" || typeof to != "number") throw new RangeError("Invalid JSON for fold state")
      ranges.push(foldWidget.range(from, to))
    }
    return Decoration.set(ranges, true)
  }
})

function clearTouchedFolds(folded: DecorationSet, from: number, to = from) {
  let touched = false
  folded.between(from, to, (a, b) => { if (a < to && b > from) touched = true })
  return !touched ? folded : folded.update({
    filterFrom: from,
    filterTo: to,
    filter: (a, b) => a >= to || b <= from
  })
}

/// Get a [range set](#state.RangeSet) containing the folded ranges
/// in the given state.
export function foldedRanges(state: EditorState): DecorationSet {
  return state.field(foldState, false) || RangeSet.empty
}

function findFold(state: EditorState, from: number, to: number) {
  let found: {from: number, to: number} | null = null
  state.field(foldState, false)?.between(from, to, (from, to) => {
    if (!found || found.from > from) found = {from, to}
  })
  return found
}

function foldExists(folded: DecorationSet, from: number, to: number) {
  let found = false
  folded.between(from, from, (a, b) => { if (a == from && b == to) found = true })
  return found
}

function maybeEnable(state: EditorState, other: readonly StateEffect<unknown>[]) {
  return state.field(foldState, false) ? other : other.concat(StateEffect.appendConfig.of(codeFolding()))
}

/// Fold the lines that are selected, if possible.
export const foldCode: Command = view => {
  for (let line of selectedLines(view)) {
    let range = foldable(view.state, line.from, line.to)
    if (range) {
      view.dispatch({effects: maybeEnable(view.state, [foldEffect.of(range), announceFold(view, range)])})
      return true
    }
  }
  return false
}

/// Unfold folded ranges on selected lines.
export const unfoldCode: Command = view => {
  if (!view.state.field(foldState, false)) return false
  let effects = []
  for (let line of selectedLines(view)) {
    let folded = findFold(view.state, line.from, line.to)
    if (folded) effects.push(unfoldEffect.of(folded), announceFold(view, folded, false))
  }
  if (effects.length) view.dispatch({effects})
  return effects.length > 0
}

function announceFold(view: EditorView, range: {from: number, to: number}, fold = true) {
  let lineFrom = view.state.doc.lineAt(range.from).number, lineTo = view.state.doc.lineAt(range.to).number
  return EditorView.announce.of(`${view.state.phrase(fold ? "Folded lines" : "Unfolded lines")} ${lineFrom} ${
    view.state.phrase("to")} ${lineTo}.`)
}

/// Fold all top-level foldable ranges. Note that, in most cases,
/// folding information will depend on the [syntax
/// tree](#language.syntaxTree), and folding everything may not work
/// reliably when the document hasn't been fully parsed (either
/// because the editor state was only just initialized, or because the
/// document is so big that the parser decided not to parse it
/// entirely).
export const foldAll: Command = view => {
  let {state} = view, effects = []
  for (let pos = 0; pos < state.doc.length;) {
    let line = view.lineBlockAt(pos), range = foldable(state, line.from, line.to)
    if (range) effects.push(foldEffect.of(range))
    pos = (range ? view.lineBlockAt(range.to) : line).to + 1
  }
  if (effects.length) view.dispatch({effects: maybeEnable(view.state, effects)})
  return !!effects.length
}

/// Unfold all folded code.
export const unfoldAll: Command = view => {
  let field = view.state.field(foldState, false)
  if (!field || !field.size) return false
  let effects: StateEffect<any>[] = []
  field.between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({from, to})) })
  view.dispatch({effects})
  return true
}

// Find the foldable region containing the given line, if one exists
function foldableContainer(view: EditorView, lineBlock: BlockInfo) {
  // Look backwards through line blocks until we find a foldable region that
  // intersects with the line
  for (let line = lineBlock;;) {
    let foldableRegion = foldable(view.state, line.from, line.to)
    if (foldableRegion && foldableRegion.to > lineBlock.from) return foldableRegion
    if (!line.from) return null
    line = view.lineBlockAt(line.from - 1)
  }
}

/// Toggle folding at cursors. Unfolds if there is an existing fold
/// starting in that line, tries to find a foldable range around it
/// otherwise.
export const toggleFold: Command = (view) => {
  let effects: StateEffect<any>[] = []
  for (let line of selectedLines(view)) {
    let folded = findFold(view.state, line.from, line.to)
    if (folded) {
      effects.push(unfoldEffect.of(folded), announceFold(view, folded, false))
    } else {
      let foldRange = foldableContainer(view, line)
      if (foldRange) effects.push(foldEffect.of(foldRange), announceFold(view, foldRange))
    }
  }
  if (effects.length > 0) view.dispatch({effects: maybeEnable(view.state, effects)})
  return !!effects.length
}

/// Default fold-related key bindings.
///
///  - Ctrl-Shift-[ (Cmd-Alt-[ on macOS): [`foldCode`](#language.foldCode).
///  - Ctrl-Shift-] (Cmd-Alt-] on macOS): [`unfoldCode`](#language.unfoldCode).
///  - Ctrl-Alt-[: [`foldAll`](#language.foldAll).
///  - Ctrl-Alt-]: [`unfoldAll`](#language.unfoldAll).
export const foldKeymap: readonly KeyBinding[] = [
  {key: "Ctrl-Shift-[", mac: "Cmd-Alt-[", run: foldCode},
  {key: "Ctrl-Shift-]", mac: "Cmd-Alt-]", run: unfoldCode},
  {key: "Ctrl-Alt-[", run: foldAll},
  {key: "Ctrl-Alt-]", run: unfoldAll}
]

interface FoldConfig {
  /// A function that creates the DOM element used to indicate the
  /// position of folded code. The `onclick` argument is the default
  /// click event handler, which toggles folding on the line that
  /// holds the element, and should probably be added as an event
  /// handler to the returned element. If
  /// [`preparePlaceholder`](#language.FoldConfig.preparePlaceholder)
  /// is given, its result will be passed as 3rd argument. Otherwise,
  /// this will be null.
  ///
  /// When this option isn't given, the `placeholderText` option will
  /// be used to create the placeholder element.
  placeholderDOM?: ((view: EditorView, onclick: (event: Event) => void, prepared: any) => HTMLElement) | null,
  /// Text to use as placeholder for folded text. Defaults to `"…"`.
  /// Will be styled with the `"cm-foldPlaceholder"` class.
  placeholderText?: string
  /// Given a range that is being folded, create a value that
  /// describes it, to be used by `placeholderDOM` to render a custom
  /// widget that, for example, indicates something about the folded
  /// range's size or type.
  preparePlaceholder?: (state: EditorState, range: {from: number, to: number}) => any
}

const defaultConfig: Required<FoldConfig> = {
  placeholderDOM: null,
  preparePlaceholder: null as any,
  placeholderText: "…"
}

const foldConfig = Facet.define<FoldConfig, Required<FoldConfig>>({
  combine(values) { return combineConfig(values, defaultConfig) }
})

/// Create an extension that configures code folding.
export function codeFolding(config?: FoldConfig): Extension {
  let result = [foldState, baseTheme]
  if (config) result.push(foldConfig.of(config))
  return result
}

function widgetToDOM(view: EditorView, prepared: any) {
  let {state} = view, conf = state.facet(foldConfig)
  let onclick = (event: Event) => {
    let line = view.lineBlockAt(view.posAtDOM(event.target as HTMLElement))
    let folded = findFold(view.state, line.from, line.to)
    if (folded) view.dispatch({effects: unfoldEffect.of(folded)})
    event.preventDefault()
  }
  if (conf.placeholderDOM) return conf.placeholderDOM(view, onclick, prepared)
  let element = document.createElement("span")
  element.textContent = conf.placeholderText
  element.setAttribute("aria-label", state.phrase("folded code"))
  element.title = state.phrase("unfold")
  element.className = "cm-foldPlaceholder"
  element.onclick = onclick
  return element
}

const foldWidget = Decoration.replace({widget: new class extends WidgetType {
  toDOM(view: EditorView) { return widgetToDOM(view, null) }
}})

class PreparedFoldWidget extends WidgetType {
  constructor(readonly value: any) { super() }
  eq(other: PreparedFoldWidget) { return this.value == other.value }
  toDOM(view: EditorView) { return widgetToDOM(view, this.value) }
}

type Handlers = {[event: string]: (view: EditorView, line: BlockInfo, event: Event) => boolean}

interface FoldGutterConfig {
  /// A function that creates the DOM element used to indicate a
  /// given line is folded or can be folded. 
  /// When not given, the `openText`/`closeText` option will be used instead.
  markerDOM?: ((open: boolean) => HTMLElement) | null
  /// Text used to indicate that a given line can be folded. 
  /// Defaults to `"⌄"`.
  openText?: string
  /// Text used to indicate that a given line is folded. 
  /// Defaults to `"›"`.
  closedText?: string
  /// Supply event handlers for DOM events on this gutter.
  domEventHandlers?: Handlers
  /// When given, if this returns true for a given view update,
  /// recompute the fold markers.
  foldingChanged?: (update: ViewUpdate) => boolean
}

const foldGutterDefaults: Required<FoldGutterConfig> = {
  openText: "⌄",
  closedText: "›",
  markerDOM: null,
  domEventHandlers: {},
  foldingChanged: () => false
}

class FoldMarker extends GutterMarker {
  constructor(readonly config: Required<FoldGutterConfig>,
              readonly open: boolean) { super() }

  eq(other: FoldMarker) { return this.config == other.config && this.open == other.open }

  toDOM(view: EditorView) {
    if (this.config.markerDOM) return this.config.markerDOM(this.open)

    let span = document.createElement("span")
    span.textContent = this.open ? this.config.openText : this.config.closedText
    span.title = view.state.phrase(this.open ? "Fold line" : "Unfold line")
    return span
  }
}

/// Create an extension that registers a fold gutter, which shows a
/// fold status indicator before foldable lines (which can be clicked
/// to fold or unfold the line).
export function foldGutter(config: FoldGutterConfig = {}): Extension {
  let fullConfig = {...foldGutterDefaults, ...config}
  let canFold = new FoldMarker(fullConfig, true), canUnfold = new FoldMarker(fullConfig, false)

  let markers = ViewPlugin.fromClass(class {
    markers: RangeSet<FoldMarker>
    from: number

    constructor(view: EditorView) {
      this.from = view.viewport.from
      this.markers = this.buildMarkers(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged ||
          update.startState.facet(language) != update.state.facet(language) ||
          update.startState.field(foldState, false) != update.state.field(foldState, false) ||
          syntaxTree(update.startState) != syntaxTree(update.state) ||
          fullConfig.foldingChanged(update))
        this.markers = this.buildMarkers(update.view)
    }

    buildMarkers(view: EditorView) {
      let builder = new RangeSetBuilder<FoldMarker>()
      for (let line of view.viewportLineBlocks) {
        let mark = findFold(view.state, line.from, line.to) ? canUnfold
          : foldable(view.state, line.from, line.to) ? canFold : null
        if (mark) builder.add(line.from, line.from, mark)
      }
      return builder.finish()
    }
  })

  let { domEventHandlers } = fullConfig;

  return [
    markers,
    gutter({
      class: "cm-foldGutter",
      markers(view) { return view.plugin(markers)?.markers || RangeSet.empty },
      initialSpacer() {
        return new FoldMarker(fullConfig, false)
      },
      domEventHandlers: {
        ...domEventHandlers,
        click: (view, line, event) => {
          if (domEventHandlers.click && domEventHandlers.click(view, line, event)) return true

          let folded = findFold(view.state, line.from, line.to)
          if (folded) {
            view.dispatch({effects: unfoldEffect.of(folded)})
            return true
          }
          let range = foldable(view.state, line.from, line.to)
          if (range) {
            view.dispatch({effects: foldEffect.of(range)})
            return true
          }
          return false
        }
      }
    }),
    codeFolding()
  ]
}

const baseTheme = EditorView.baseTheme({
  ".cm-foldPlaceholder": {
    backgroundColor: "#eee",
    border: "1px solid #ddd",
    color: "#888",
    borderRadius: ".2em",
    margin: "0 1px",
    padding: "0 1px",
    cursor: "pointer"
  },

  ".cm-foldGutter span": {
    padding: "0 1px",
    cursor: "pointer"
  }
})
