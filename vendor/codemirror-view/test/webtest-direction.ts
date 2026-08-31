import ist from "ist"
import {Direction, EditorView, Decoration} from "@codemirror/view"
import {StateEffect} from "@codemirror/state"
import {tempView} from "./tempview.js"

describe("EditorView text direction", () => {
  it("notices the text direction", () => {
    let cm = tempView("hi", [EditorView.theme({".cm-content": {direction: "rtl"}})])
    cm.measure()
    ist(cm.textDirection, Direction.RTL)
  })

  it("can compute direction per-line", () => {
    let cm = tempView("one\ntwo", [
      EditorView.decorations.of(Decoration.set(Decoration.line({attributes: {style: "direction: rtl"}}).range(4))),
      EditorView.perLineTextDirection.of(true)
    ])
    cm.measure()
    ist(cm.textDirectionAt(1), Direction.LTR)
    ist(cm.textDirectionAt(5), Direction.RTL)
    cm.dispatch({effects: StateEffect.appendConfig.of(EditorView.theme({".cm-content": {direction: "rtl"}}))})
    cm.measure()
    ist(cm.textDirectionAt(1), Direction.RTL)
 })
})
