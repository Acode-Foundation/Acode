import {tempView} from "./tempview.js"
import {EditorSelection, Prec, StateField} from "@codemirror/state"
import {EditorView, ViewPlugin, Decoration, DecorationSet, WidgetType} from "@codemirror/view"
import ist from "ist"

function domText(view: EditorView) {
  let text = "", eol = false
  function scan(node: Node) {
    if (node.nodeType == 1) {
      if (node.nodeName == "BR" || (node as HTMLElement).contentEditable == "false" ||
          (node as HTMLElement).className == "cm-gap") return
      if (eol) { text += "\n"; eol = false }
      for (let ch = node.firstChild as (Node | null); ch; ch = ch.nextSibling) scan(ch)
      eol = true
    } else if (node.nodeType == 3) {
      text += node.nodeValue
    }
  }
  scan(view.contentDOM)
  return text
}

function scroll(height: number) {
  return [
    EditorView.contentAttributes.of({style: "overflow: auto"}),
    EditorView.editorAttributes.of({style: `height: ${height}px`}),
    ViewPlugin.define(view => {
      view.scrollDOM.scrollTop = 0
      return {}
    })
  ]
}

describe("EditorView drawing", () => {
  it("follows updates to the document", () => {
    let cm = tempView("one\ntwo")
    ist(domText(cm), "one\ntwo")
    cm.dispatch({changes: {from: 1, to: 2, insert: "x"}})
    ist(domText(cm), "oxe\ntwo")
    cm.dispatch({changes: {from: 2, to: 5, insert: "1\n2\n3"}})
    ist(domText(cm), "ox1\n2\n3wo")
    cm.dispatch({changes: {from: 1, to: 8}})
    ist(domText(cm), "oo")
  })

  it("works in multiple lines", () => {
    let doc = "abcdefghijklmnopqrstuvwxyz\n".repeat(10)
    let cm = tempView("")
    cm.dispatch({changes: {from: 0, insert: doc}})
    ist(domText(cm), doc)
    cm.dispatch({changes: {from: 0, insert: "/"}})
    doc = "/" + doc
    ist(domText(cm), doc)
    cm.dispatch({changes: {from: 100, to: 104, insert: "$"}})
    doc = doc.slice(0, 100) + "$" + doc.slice(104)
    ist(domText(cm), doc)
    cm.dispatch({changes: {from: 200, to: 268}})
    doc = doc.slice(0, 200)
    ist(domText(cm), doc)
  })

  it("can split a line", () => {
    let cm = tempView("abc\ndef\nghi")
    cm.dispatch({changes: {from: 4, insert: "xyz\nk"}})
    ist(domText(cm), "abc\nxyz\nkdef\nghi")
  })

  it("redraws lazily", () => {
    let cm = tempView("one\ntwo\nthree")
    let line0 = cm.contentDOM.firstChild!, line1 = line0.nextSibling!, line2 = line1.nextSibling!
    let text0 = line0.firstChild!, text2 = line2.firstChild!
    cm.dispatch({changes: {from: 5, insert: "x"}})
    ist(text0.parentElement, line0)
    ist(cm.contentDOM.contains(line0))
    ist(cm.contentDOM.contains(line1))
    ist(text2.parentElement, line2)
    ist(cm.contentDOM.contains(line2))
  })

  it("notices the doc needs to be redrawn when only inserting empty lines", () => {
    let cm = tempView("")
    cm.dispatch({changes: {from: 0, insert: "\n\n\n"}})
    ist(domText(cm), "\n\n\n")
  })

  it("draws BR nodes on empty lines", () => {
    let cm = tempView("one\n\ntwo")
    let emptyLine = cm.domAtPos(4).node
    ist(emptyLine.childNodes.length, 1)
    ist(emptyLine.firstChild!.nodeName, "BR")
    cm.dispatch({changes: {from: 4, insert: "x"}})
    ist(!Array.from(cm.domAtPos(4).node.childNodes).some(n => (n as any).nodeName == "BR"))
  })

  it("only draws visible content", () => {
    let cm = tempView("a\n".repeat(500) + "b\n".repeat(500), [scroll(300)])
    cm.scrollDOM.scrollTop = 3000
    cm.measure()
    ist(cm.contentDOM.childNodes.length, 500, "<")
    ist(cm.contentDOM.scrollHeight, 10000, ">")
    ist(!cm.contentDOM.textContent!.match(/b/))
    let gap = cm.contentDOM.lastChild
    cm.dispatch({changes: {from: 2000, insert: "\n\n"}})
    ist(cm.contentDOM.lastChild, gap) // Make sure gap nodes are reused when resized
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight / 2
    cm.measure()
    ist(cm.contentDOM.textContent!.match(/b/))
  })

  it("scrolls the selection into view when asked", () => {
    let cm = tempView("\n".repeat(500), [scroll(150)])
    cm.scrollDOM.scrollTop = 0
    cm.measure()
    cm.dispatch({selection: {anchor: 250}, scrollIntoView: true})
    let box = cm.scrollDOM.getBoundingClientRect(), pos = cm.coordsAtPos(250)
    ist(box.top, pos?.top, "<=")
    ist(box.bottom, pos?.bottom, ">=")
  })

  it("can scroll ranges into view", () => {
    let cm = tempView("\n".repeat(500), [scroll(150)])
    cm.scrollDOM.scrollTop = 0
    cm.measure()
    cm.dispatch({effects: EditorView.scrollIntoView(250)})
    let box = cm.scrollDOM.getBoundingClientRect(), pos = cm.coordsAtPos(250)
    ist(box.top, pos?.top, "<=")
    ist(box.bottom, pos?.bottom, ">=")
    cm.dispatch({effects: EditorView.scrollIntoView(EditorSelection.range(403, 400))})
    let top = cm.coordsAtPos(400), bot = cm.coordsAtPos(403)
    ist(box.top, top?.top, "<=")
    ist(box.bottom, bot?.bottom, ">=")
    cm.dispatch({effects: EditorView.scrollIntoView(EditorSelection.range(300, 400))})
    let pos400 = cm.coordsAtPos(400)
    ist(box.top, pos400?.top, "<=")
    ist(box.bottom, pos400?.bottom, ">=")
    cm.dispatch({effects: EditorView.scrollIntoView(EditorSelection.range(150, 100))})
    let pos100 = cm.coordsAtPos(100)
    ist(box.top, pos100?.top, "<=")
    ist(box.bottom, pos100?.bottom, ">=")
  })

  it("keeps a drawn area around selection ends", () => {
    let cm = tempView("\nsecond\n" + "x\n".repeat(500) + "last", [scroll(300)])
    cm.dispatch({selection: EditorSelection.single(1, cm.state.doc.length)})
    cm.focus()
    let text = cm.contentDOM.textContent!
    ist(text.length, 500, "<")
    ist(/second/.test(text))
    ist(/last/.test(text))
  })

  it("can handle replace-all like events", () => {
    let content = "", chars = "abcdefghijklmn    \n"
    for (let i = 0; i < 5000; i++) content += chars[Math.floor(Math.random() * chars.length)]
    let cm = tempView(content), changes = []
    for (let i = Math.floor(content.length / 100); i >= 0; i--) {
      let from = Math.floor(Math.random() * (cm.state.doc.length - 10)), to = from + Math.floor(Math.random() * 10)
      changes.push({from, to, insert: "XYZ"})
    }
    cm.dispatch({changes})
    ist(domText(cm), cm.state.sliceDoc(cm.viewport.from, cm.viewport.to))
  })

  it("can replace across line boundaries", () => {
    let cm = tempView("ab\ncd\nef")
    cm.dispatch({changes: {from: 1, to: 4, insert: "XYZ"}})
    ist(domText(cm), cm.state.doc.toString())
  })

  it("can handle deleting a line's content", () => {
    let cm = tempView("foo\nbaz")
    cm.dispatch({changes: {from: 4, to: 7}})
    ist(domText(cm), "foo\n")
  })

  it("can insert blank lines at the end of the document", () => {
    let cm = tempView("foo")
    cm.dispatch({changes: {from: 3, insert: "\n\nx"}})
    ist(domText(cm), "foo\n\nx")
  })

  it("can handle deleting the end of a line", () => {
    let cm = tempView("a\nbc\n")
    cm.dispatch({changes: {from: 3, to: 4}})
    cm.dispatch({changes: {from: 3, insert: "d"}})
    ist(domText(cm), "a\nbd\n")
  })

  it("correctly handles very complicated transactions", () => {
    let doc = "foo\nbar\nbaz", chars = "abcdef  \n"
    let cm = tempView(doc)
    for (let i = 0; i < 10; i++) {
      let changes = [], pos = Math.min(20, doc.length)
      for (let j = 0; j < 1; j++) {
        let choice = Math.random(), r = Math.random()
        if (choice < 0.15) {
          pos = Math.min(doc.length, Math.max(0, pos + 5 - Math.floor(r * 10)))
        } else if (choice < 0.5) {
          let from = Math.max(0, pos - Math.floor(r * 2)), to = Math.min(doc.length, pos + Math.floor(r * 4))
          changes.push({from, to})
          pos = from
        } else {
          let text = ""
          for (let k = Math.floor(r * 6); k >= 0; k--) text += chars[Math.floor(chars.length * Math.random())]
          changes.push({from: pos, insert: text})
        }
      }
      cm.dispatch({changes})
      doc = cm.state.doc.toString()
      ist(domText(cm), doc.slice(cm.viewport.from, cm.viewport.to))
    }
  })

  function later(t = 50) {
    return new Promise(resolve => setTimeout(resolve, t))
  }

  it("notices it is added to the DOM even if initially detached", () => {
    if (!(window as any).IntersectionObserver) return // Only works with intersection observer support
    let cm = new EditorView({doc: "a\nb\nc\nd"})
    let defaultHeight = cm.contentHeight
    ;(document.querySelector("#workspace") as HTMLElement).appendChild(cm.dom)
    return later().then(() => {
      ist(cm.contentHeight, defaultHeight, "!=")
      cm.destroy()
    })
  })

  it("hides parts of long lines that are horizontally out of view", () => {
    let cm = tempView("one\ntwo\n?" + "three ".repeat(3333) + "!\nfour")
    let {node} = cm.domAtPos(9)
    ist(node.nodeValue!.length, 2e4, "<")
    ist(node.nodeValue!.indexOf("!"), -1)
    ist(cm.scrollDOM.scrollWidth, cm.defaultCharacterWidth * 1.6e4, ">")
    cm.scrollDOM.scrollLeft = cm.scrollDOM.scrollWidth
    cm.measure()
    ;({node} = cm.domAtPos(20007)!)
    ist(node.nodeValue!.length, 2e4, "<")
    ist(node.nodeValue!.indexOf("!"), -1, ">")
    ist(cm.scrollDOM.scrollWidth, cm.defaultCharacterWidth * 1.6e4, ">")
  })

  const bigText = Decoration.line({attributes: {style: "font-size: 300%"}})

  it("stabilizes the scroll position in the middle", () => {
    let cm = tempView("\n".repeat(400), [scroll(100), EditorView.decorations.of(Decoration.set(
      Array.from(new Array(10), (_, i) => bigText.range(100 + i))))])
    cm.scrollDOM.scrollTop = cm.lineBlockAt(300).top
    cm.measure()
    ist(Math.abs(cm.lineBlockAt(300).top - cm.scrollDOM.scrollTop), 2, "<")
  })

  it("stabilizes the scroll position at the end", () => {
    let cm = tempView("\n".repeat(400), [scroll(100), EditorView.decorations.of(Decoration.set(
      Array.from(new Array(10), (_, i) => bigText.range(100 + i))))])
    cm.scrollDOM.scrollTop = 1e9
    cm.measure()
    ist(Math.abs(cm.scrollDOM.scrollHeight - cm.scrollDOM.clientHeight - cm.scrollDOM.scrollTop), 2, "<")
  })

  it("doesn't overcompensate scroll position for poorly estimated height", () => {
    let deco = () => {
      let widget = new class extends WidgetType {
        get estimatedHeight() { return 1 }
        toDOM() {
          let elt = document.createElement("div")
          elt.style.height = "100px"
          return elt
        }
      }
      return Decoration.set(Decoration.widget({widget, block: true}).range(200))
    }

    let cm = tempView("\n".repeat(400), [scroll(100), StateField.define<DecorationSet>({
      create: deco,
      update: deco,
      provide: f => EditorView.decorations.from(f)
    })])
    cm.dispatch({effects: EditorView.scrollIntoView(205, {y: "start"})})
    cm.measure()
    let prev = cm.scrollDOM.scrollTop
    cm.dispatch({selection: {anchor: 205}})
    cm.measure()
    ist(prev, cm.scrollDOM.scrollTop)
  })

  it("hides parts of long lines that are vertically out of view", () => {
    let cm = tempView("<" + "long line ".repeat(10e3) + ">", [scroll(100), EditorView.lineWrapping])
    cm.measure()
    let text = cm.contentDOM.textContent!
    ist(text.length, cm.state.doc.length, "<")
    ist(text.indexOf("<"), -1, ">")
    ist(cm.visibleRanges.reduce((s, r) => s + r.to - r.from, 0), cm.viewport.to - cm.viewport.from, "<")
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight / 2 + 100
    cm.dispatch({selection: {anchor: cm.state.doc.length >> 1}})
    cm.measure()
    text = cm.contentDOM.textContent!
    ist(text.length, cm.state.doc.length, "<")
    ist(text.indexOf("<"), -1)
    ist(text.indexOf(">"), -1)
    cm.scrollDOM.scrollTop = cm.scrollDOM.scrollHeight
    cm.measure()
    text = cm.contentDOM.textContent!
    ist(text.length, cm.state.doc.length, "<")
    ist(text.indexOf(">"), -1, ">")
  })

  it("properly attaches styles in shadow roots", () => {
    let ws = document.querySelector("#workspace")!
    let wrap = ws.appendChild(document.createElement("div"))
    if (!wrap.attachShadow) return
    let shadow = wrap.attachShadow({mode: "open"})
    let editor = new EditorView({root: shadow})
    shadow.appendChild(editor.dom)
    editor.measure()
    ist(getComputedStyle(editor.dom).display, "flex")
    wrap.remove()
  })

  it("allows editor attributes to override each other", () => {
    let cm = tempView("", [
      EditorView.contentAttributes.of({"data-x": "x"}),
      EditorView.contentAttributes.of({"data-x": "y"}),
      Prec.highest(EditorView.contentAttributes.of({"data-x": "z"})),
    ])
    ist(cm.contentDOM.getAttribute("data-x"), "z")
  })

  it("updates height info when a widget changes size", async () => {
    let widget = new class extends WidgetType {
      toDOM() {
        let d = document.createElement("div")
        d.style.height = "10px"
        setTimeout(() => d.style.height = "30px", 5)
        return d
      }
    }
    let cm = tempView("a\nb\nc\nd", [
      EditorView.decorations.of(Decoration.set(Decoration.widget({widget, block: true, side: 1}).range(1)))
    ])
    cm.measure()
    await later(75)
    let line2 = cm.viewportLineBlocks[1], dom2 = cm.contentDOM.querySelectorAll(".cm-line")[1]
    ist(Math.abs(cm.documentTop + line2.top - (dom2 as HTMLElement).getBoundingClientRect().top), 1, "<")
  })

  it("reuses line nodes", () => {
    let cm = tempView("ab\ncd")
    let line1 = cm.contentDOM.firstChild, line2 = cm.contentDOM.lastChild
    cm.dispatch({changes: [{from: 0, insert: "!"}, {from: 5, insert: "?"}]})
    ist(cm.contentDOM.firstChild, line1)
    ist(cm.contentDOM.lastChild, line2)
    cm.dispatch({changes: {from: 0, to: 3}})
    ist(cm.contentDOM.firstChild, line1)
    cm.dispatch({changes: {from: 0, to: 1}})
    ist(cm.contentDOM.firstChild, line1)
  })

  it("splits long stretches of text into chunks", () => {
    let cm = tempView("a".repeat(800), [
      EditorView.decorations.of(Decoration.set(Decoration.mark({class: "x"}).range(0, 800)))
    ])
    let spans = cm.contentDOM.querySelectorAll("span")
    ist(spans.length, 1)
    ist(spans[0].childNodes.length, 2)
  })
})
