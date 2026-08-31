import {tempView} from "./tempview.js"
import {Text, EditorState, Compartment} from "@codemirror/state"
import {EditorView, ViewPlugin, ViewUpdate} from "@codemirror/view"
import ist from "ist"

describe("EditorView extension", () => {
  it("calls update when the viewport changes", () => {
    let viewports: {from: number, to: number}[] = []
    let plugin = ViewPlugin.define(view => {
      viewports.push(view.viewport)
      return {
        update(update: ViewUpdate) {
          if (update.viewportChanged) viewports.push(update.view.viewport)
        }
      }
    })
    let cm = tempView("x\n".repeat(500), [plugin])
    ist(viewports.length, 1)
    ist(viewports[0].from, 0)
    cm.dom.style.height = "300px"
    cm.scrollDOM.style.overflow = "auto"
    cm.scrollDOM.scrollTop = 2000
    cm.measure()
    ist(viewports.length, 2, ">=")
    ist(viewports[1].from, 0, ">")
    ist(viewports[1].to, viewports[0].from, ">")
    cm.scrollDOM.scrollTop = 4000
    let curLen = viewports.length
    cm.measure()
    ist(viewports.length, curLen, ">")
  })

  it("calls update on plugins", () => {
    let updates = 0, prevDoc: Text
    let plugin = ViewPlugin.define(view => {
      prevDoc = view.state.doc
      return {
        update(update: ViewUpdate) {
          ist(update.startState.doc, prevDoc)
          ist(update.state.doc, cm.state.doc)
          prevDoc = cm.state.doc
          updates++
        }
      }
    })
    let cm = tempView("xyz", [plugin])
    ist(updates, 0)
    cm.dispatch({changes: {from: 1, to: 2, insert: "u"}})
    ist(updates, 1)
    cm.dispatch({selection: {anchor: 3}})
    ist(updates, 2)
  })

  it("allows content attributes to be changed through effects", () => {
    let cm = tempView("", [EditorView.contentAttributes.of({spellcheck: "true"})])
    ist(cm.contentDOM.spellcheck, true)
  })

  it("allows editor attributes to be changed through effects", () => {
    let cm = tempView("", [EditorView.editorAttributes.of({class: "something"})])
    ist(cm.dom.classList.contains("something"))
    ist(cm.dom.classList.contains("cm-editor"))
  })

  it("redraws the view when phrases change", () => {
    let plugin = ViewPlugin.fromClass(class {
      elt: HTMLElement
      constructor(view: EditorView) {
        let elt = this.elt = view.dom.appendChild(document.createElement("div"))
        elt.textContent = view.state.phrase("Hello")
        elt.style.position = "absolute"
        elt.className = "greeting"
      }
      destroy() { this.elt.remove() }
    })
    let lang = new Compartment
    let cm = tempView("one", [plugin, lang.of([])])
    ist(cm.dom.querySelector(".greeting")!.textContent, "Hello")
    cm.dispatch({effects: lang.reconfigure(EditorState.phrases.of({Hello: "Bonjour"}))})
    ist(cm.dom.querySelector(".greeting")!.textContent, "Bonjour")
  })

  it("supports plugins with arguments", () => {
    let plugin = ViewPlugin.define((v, arg: number) => ({number: arg}))
    let cm = tempView("", plugin.of(20))
    ist(cm.plugin(plugin)?.number, 20)
  })
})
