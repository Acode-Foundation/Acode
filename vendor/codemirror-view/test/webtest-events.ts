import {tempView} from "./tempview.js"
import {EditorView, ViewPlugin} from "@codemirror/view"
import {Prec, Compartment, StateEffect} from "@codemirror/state"
import ist from "ist"

function signal(view: EditorView, type: string, props?: {[name: string]: any}) {
  view.contentDOM.dispatchEvent(new Event(type, props))
}

class Log {
  events: string[] = []
  handler(tag?: string, result = false) {
    return (event: Event) => { this.events.push(event.type + (tag ? "-" + tag : "")); return result }
  }
  toString() { return this.events.join(" ") }
}

describe("EditorView events", () => {
  it("runs built-in handlers", () => {
    let cm = tempView()
    signal(cm, "focus")
    ist(cm.inputState.lastFocusTime, 0, ">")
  })

  it("runs custom handlers", () => {
    let log = new Log
    let cm = tempView("", EditorView.domEventHandlers({focus: log.handler()}))
    signal(cm, "focus")
    ist(log.toString(), "focus")
  })

  it("runs handlers in the right order", () => {
    let log = new Log
    let cm = tempView("", [
      EditorView.domEventHandlers({x: log.handler("a"), y: log.handler("?")}),
      EditorView.domEventHandlers({x: log.handler("b")}),
      Prec.high(EditorView.domEventHandlers({x: log.handler("c")}))
    ])
    signal(cm, "x")
    ist(log.toString(), "x-c x-a x-b")
  })

  it("stops running handlers on handled events", () => {
    let log = new Log
    let cm = tempView("", [
      EditorView.domEventHandlers({x: log.handler("a", true)}),
      EditorView.domEventHandlers({x: log.handler("b")})
    ])
    signal(cm, "x")
    ist(log.toString(), "x-a")
  })

  it("runs observers before handlers", () => {
    let log = new Log
    let cm = tempView("", [
      EditorView.domEventHandlers({x: log.handler("a")}),
      EditorView.domEventObservers({x: log.handler("b", true)})
    ])
    signal(cm, "x")
    ist(log.toString(), "x-b x-a")
  })

  it("can dynamically change event handlers", () => {
    let log = new Log, comp = new Compartment
    let cm = tempView("", [
      EditorView.domEventHandlers({x: log.handler("a")}),
      comp.of(EditorView.domEventHandlers({x: log.handler("b")}))
    ])
    signal(cm, "x")
    cm.dispatch({effects: [
      comp.reconfigure([]),
      StateEffect.appendConfig.of(EditorView.domEventHandlers({y: log.handler("c")}))
    ]})
    signal(cm, "x")
    signal(cm, "y")
    signal(cm, "z")
    ist(log.toString(), "x-a x-b x-a y-c")
  })

  it("runs handlers with this bound to the plugin", () => {
    let called, cm = tempView("", [
      ViewPlugin.define(() => ({x: "!"}), {
        eventHandlers: {
          x() { called = "yes " + this?.x }
        }
      })
    ])
    signal(cm, "x")
    ist(called, "yes !")
  })
})
