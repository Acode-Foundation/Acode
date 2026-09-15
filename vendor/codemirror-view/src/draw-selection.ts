import {EditorSelection, Extension, Facet, combineConfig, Prec, EditorState} from "@codemirror/state"
import {ViewUpdate, nativeSelectionHidden} from "./extension"
import {EditorView} from "./editorview"
import {layer, RectangleMarker} from "./layer"
import browser from "./browser"

type SelectionConfig = {
  /// The length of a full cursor blink cycle, in milliseconds.
  /// Defaults to 1200. Can be set to 0 to disable blinking.
  cursorBlinkRate?: number
  /// Whether to show a cursor for non-empty ranges. Defaults to
  /// true.
  drawRangeCursor?: boolean
  /// Because hiding the cursor also hides the selection handles in
  /// the iOS browser, when this is enabled (the default), the
  /// extension draws handles on the side of the selection in iOS.
  iosSelectionHandles?: boolean
}

const selectionConfig = Facet.define<SelectionConfig, Required<SelectionConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      cursorBlinkRate: 1200,
      drawRangeCursor: true,
      iosSelectionHandles: true
    }, {
      cursorBlinkRate: (a, b) => Math.min(a, b),
      drawRangeCursor: (a, b) => a || b
    })
  }
})

/// Returns an extension that hides the browser's native selection and
/// cursor, replacing the selection with a background behind the text
/// (with the `cm-selectionBackground` class), and the
/// cursors with elements overlaid over the code (using
/// `cm-cursor-primary` and `cm-cursor-secondary`).
///
/// This allows the editor to display secondary selection ranges, and
/// tends to produce a type of selection more in line with that users
/// expect in a text editor (the native selection styling will often
/// leave gaps between lines and won't fill the horizontal space after
/// a line when the selection continues past it).
///
/// It does have a performance cost, in that it requires an extra DOM
/// layout cycle for many updates (the selection is drawn based on DOM
/// layout information that's only available after laying out the
/// content).
export function drawSelection(config: SelectionConfig = {}): Extension {
  return [
    selectionConfig.of(config),
    cursorLayer,
    selectionLayer,
    hideNativeSelection,
    nativeSelectionHidden.of(true)
  ]
}

/// Retrieve the [`drawSelection`](#view.drawSelection) configuration
/// for this state. (Note that this will return a set of defaults even
/// if `drawSelection` isn't enabled.)
export function getDrawSelectionConfig(state: EditorState): SelectionConfig {
  return state.facet(selectionConfig)
}

function configChanged(update: ViewUpdate) {
  return update.startState.facet(selectionConfig) != update.state.facet(selectionConfig)
}

const cursorLayer = layer({
  above: true,
  markers(view) {
    let {state} = view, conf = state.facet(selectionConfig)
    let cursors = []
    for (let r of state.selection.ranges) {
      let prim = r == state.selection.main
      if (r.empty || conf.drawRangeCursor && !(prim && browser.ios && conf.iosSelectionHandles)) {
        let className = prim ? "cm-cursor cm-cursor-primary" : "cm-cursor cm-cursor-secondary"
        let cursor = r.empty ? r : EditorSelection.cursor(r.head, r.assoc)
        for (let piece of RectangleMarker.forRange(view, className, cursor)) cursors.push(piece)
      }
    }
    return cursors
  },
  update(update, dom) {
    if (update.transactions.some(tr => tr.selection))
      dom.style.animationName = dom.style.animationName == "cm-blink" ? "cm-blink2" : "cm-blink"
    let confChange = configChanged(update)
    if (confChange) setBlinkRate(update.state, dom)
    return update.docChanged || update.selectionSet || confChange
  },
  mount(dom, view) {
    setBlinkRate(view.state, dom)
  },
  class: "cm-cursorLayer"
})

function setBlinkRate(state: EditorState, dom: HTMLElement) {
  dom.style.animationDuration = state.facet(selectionConfig).cursorBlinkRate + "ms"
}

const selectionLayer = layer({
  above: false,
  markers(view) {
    let markers = [], {main, ranges} = view.state.selection
    for (let r of ranges) if (!r.empty) {
      for (let marker of RectangleMarker.forRange(view, "cm-selectionBackground", r)) markers.push(marker)
    }
    if (browser.ios && !main.empty && view.state.facet(selectionConfig).iosSelectionHandles) {
      for (let piece of RectangleMarker.forRange(view, "cm-selectionHandle cm-selectionHandle-start",
                                                 EditorSelection.cursor(main.from, 1)))
        markers.push(piece)
      for (let piece of RectangleMarker.forRange(view, "cm-selectionHandle cm-selectionHandle-end",
                                                 EditorSelection.cursor(main.to, 1)))
        markers.push(piece)
    }
    return markers
  },
  update(update, dom) {
    return update.docChanged || update.selectionSet || update.viewportChanged || configChanged(update)
  },
  class: "cm-selectionLayer"
})

// https://discuss.codemirror.net/t/firefox-153-ignores-transparent-selection-styling/9838
const selectionBg = browser.gecko && browser.gecko_version == 153 ? "#ffffff01" : "transparent"

const hideNativeSelection = Prec.highest(EditorView.theme({
  ".cm-line": {
    "& ::selection, &::selection": {backgroundColor: `${selectionBg} !important`},
    caretColor: "transparent !important"
  },
  ".cm-content": {
    caretColor: "transparent !important",
    "& :focus": {
      caretColor: "initial !important",
      "&::selection, & ::selection": {
        backgroundColor: "Highlight !important"
      }
    }
  }
}))
