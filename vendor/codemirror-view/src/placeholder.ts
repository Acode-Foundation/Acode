import {Extension} from "@codemirror/state"
import {ViewPlugin} from "./extension"
import {Decoration, DecorationSet, WidgetType} from "./decoration"
import {EditorView} from "./editorview"
import {clientRectsFor, flattenRect} from "./dom"

class Placeholder extends WidgetType {
  constructor(readonly content: string | HTMLElement | ((view: EditorView) => HTMLElement)) { super() }

  toDOM(view: EditorView) {
    let wrap = document.createElement("span")
    wrap.className = "cm-placeholder"
    wrap.style.pointerEvents = "none"
    wrap.appendChild(
      typeof this.content == "string" ? document.createTextNode(this.content) :
      typeof this.content == "function" ? this.content(view) :
      this.content.cloneNode(true))
    wrap.setAttribute("aria-hidden", "true")
    return wrap
  }

  coordsAt(dom: HTMLElement) {
    let rects = dom.firstChild ? clientRectsFor(dom.firstChild) : []
    if (!rects.length) return null
    let style = window.getComputedStyle(dom.parentNode as HTMLElement)
    let rect = flattenRect(rects[0], style.direction != "rtl")
    let lineHeight = parseInt(style.lineHeight)
    if (rect.bottom - rect.top > lineHeight * 1.5)
      return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.top + lineHeight}
    return rect
  }

  ignoreEvent() { return false }
}

/// Extension that enables a placeholder—a piece of example content
/// to show when the editor is empty.
export function placeholder(content: string | HTMLElement | ((view: EditorView) => HTMLElement)): Extension {
  let plugin = ViewPlugin.fromClass(class {
    placeholder: DecorationSet

    constructor(readonly view: EditorView) {
      this.placeholder = content
        ? Decoration.set([Decoration.widget({widget: new Placeholder(content), side: 1}).range(0)])
        : Decoration.none
    }

    declare update: () => void // Kludge to convince TypeScript that this is a plugin value

    get decorations() { return this.view.state.doc.length ? Decoration.none : this.placeholder }
  }, {decorations: v => v.decorations})
  return typeof content == "string" ? [
    plugin, EditorView.contentAttributes.of({"aria-placeholder": content})
  ] : plugin
}
