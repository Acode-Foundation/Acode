import {EditorView, Decoration, BlockWrapper, DecorationSet, WidgetType,
        ViewPlugin, BlockInfo, BlockType, highlightActiveLine} from "@codemirror/view"
import {tempView, requireFocus} from "./tempview.js"
import {EditorSelection, StateEffect, StateField, Range, RangeSet, Text} from "@codemirror/state"
import ist from "ist"

const filterDeco = StateEffect.define<(from: number, to: number, spec: any) => boolean>()
const addDeco = StateEffect.define<Range<Decoration>[]>()

function text(node: Node) {
  return (node.textContent || "").replace(/\u200b/g, "")
}

function decos(startState: DecorationSet = Decoration.none) {
  let field = StateField.define<DecorationSet>({
    create() { return startState },
    update(value, tr) {
      value = value.map(tr.changes)
      for (let effect of tr.effects) {
        if (effect.is(addDeco)) value = value.update({add: effect.value})
        else if (effect.is(filterDeco)) value = value.update({filter: effect.value})
      }
      return value
    },
    provide: f => EditorView.decorations.from(f)
  })
  return [field]
}

function d(from: number, to: any, spec: any = null) {
  return Decoration.mark(typeof spec == "string" ? {attributes: {[spec]: "y"}} : spec).range(from, to)
}

function w(pos: number, widget: WidgetType, side: number = 0) {
  return Decoration.widget({widget, side}).range(pos)
}

function l(pos: number, attrs: any) {
  return Decoration.line(typeof attrs == "string" ? {attributes: {class: attrs}} : attrs).range(pos)
}

function decoEditor(doc: string, decorations: any = []) {
  return tempView(doc, decos(Decoration.set(decorations, true)))
}

function near(a: number, b: number) { return Math.abs(a - b) < 0.1 }

describe("EditorView decoration", () => {
  it("renders tag names", () => {
    let cm = decoEditor("one\ntwo", d(2, 5, {tagName: "em"}))
    ist(cm.contentDOM.innerHTML.replace(/<\/?div.*?>/g, "|"),
        "|on<em>e</em>||<em>t</em>wo|")
  })

  it("renders attributes", () => {
    let cm = decoEditor("foo bar", [d(0, 3, {attributes: {title: "t"}}),
                                    d(4, 7, {attributes: {lang: "nl"}})])
    ist(cm.contentDOM.querySelectorAll("[title]").length, 1)
    ist((cm.contentDOM.querySelector("[title]") as any).title, "t")
    ist(cm.contentDOM.querySelectorAll("[lang]").length, 1)
  })

  it("updates for added decorations", () => {
    let cm = decoEditor("hello\ngoodbye")
    cm.dispatch({effects: addDeco.of([d(2, 8, {class: "c"})])})
    let spans = cm.contentDOM.querySelectorAll(".c")
    ist(spans.length, 2)
    ist(text(spans[0]), "llo")
    ist(text(spans[0].previousSibling!), "he")
    ist(text(spans[1]), "go")
    ist(text(spans[1].nextSibling!), "odbye")
  })

  it("updates for removed decorations", () => {
    let cm = decoEditor("one\ntwo\nthree", [d(1, 12, {class: "x"}),
                                            d(4, 7, {tagName: "strong"})])
    cm.dispatch({effects: filterDeco.of((from: number) => from == 4)})
    ist(cm.contentDOM.querySelectorAll(".x").length, 0)
    ist(cm.contentDOM.querySelectorAll("strong").length, 1)
  })

  it("doesn't update DOM that doesn't need to change", () => {
    let cm = decoEditor("one\ntwo", [d(0, 3, {tagName: "em"})])
    let secondLine = cm.contentDOM.lastChild!, secondLineText = secondLine.firstChild
    cm.dispatch({effects: filterDeco.of(() => false)})
    ist(cm.contentDOM.lastChild, secondLine)
    ist(secondLine.firstChild, secondLineText)
  })

  it("nests decoration elements", () => {
    let cm = tempView("abcdef", [decos(Decoration.set([d(2, 6, {class: "b"})])),
                                 decos(Decoration.set([d(0, 4, {class: "a"})]))])
    let a = cm.contentDOM.querySelectorAll(".a"), b = cm.contentDOM.querySelectorAll(".b")
    ist(a.length, 1)
    ist(b.length, 2)
    ist(text(a[0]), "abcd")
    ist(text(b[0]), "cd")
    ist(b[0].parentNode, a[0])
    ist(text(b[1]), "ef")
  })

  it("drops entirely deleted decorations", () => {
    let cm = decoEditor("abc", [d(1, 2, {inclusiveStart: true, inclusiveEnd: true, tagName: "strong"})])
    cm.dispatch({changes: {from: 0, to: 3, insert: "a"}})
    ist(cm.contentDOM.querySelector("strong"), null)
  })

  it("doesn't merge separate decorations", () => {
    let cm = decoEditor("abcd", [d(0, 2, {class: "a"}), d(2, 4, {class: "a"})])
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
    cm.dispatch({changes: {from: 1, to: 3}})
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
  })

  it("merges joined decorations", () => {
    let cm = decoEditor("ab cd", [d(0, 2, {class: "a"}), d(3, 5, {class: "a"})])
    cm.dispatch({changes: {from: 2, to: 3, insert: "x"},
                 effects: [filterDeco.of(() => false), addDeco.of([d(0, 5, {class: "a"})])]})
    ist(cm.contentDOM.querySelectorAll(".a").length, 1)
  })

  it("properly joins decorations when partially reusing them", () => {
    let mkDeco = (doc: Text) => {
      let deco: Range<Decoration>[] = []
      deco.push(Decoration.mark({class: "w"}).range(0, doc.length))
      for (let i = 0; i < doc.length - 1; i += 2)
        deco.push(Decoration.mark({class: "l"}).range(i, i + 1))
      return Decoration.set(deco)
    }
    let cm = tempView("Start", EditorView.decorations.of(v => mkDeco(v.state.doc)))
    cm.dispatch({changes: {from: 3, insert: "x"}})
    ist(cm.contentDOM.querySelectorAll(".w").length, 1)
  })

  it("keeps identical but separate decorations separate", () => {
    let m = Decoration.mark({tagName: "em"})
    let cm = decoEditor("aaabbb", [m.range(0, 3), m.range(3, 6)])
    cm.dispatch({changes: {from: 6, insert: "!"}})
    ist(cm.contentDOM.children[0].innerHTML, '<em>aaa</em><em>bbb</em>!')
  })

  it("merges stacked decorations", () => {
    let cm = tempView("one", [
      decos(Decoration.set([], true)),
      EditorView.decorations.of(Decoration.set(d(0, 3, {class: "a"})))
    ])
    cm.dispatch({effects: [addDeco.of([d(1, 2, {class: "b"})])]})
    ist(cm.contentDOM.querySelectorAll(".a").length, 1)
  })

  it("keeps decorations together when deleting inside of them", () => {
    let cm = decoEditor("one\ntwo", [d(1, 6, {class: "a"})])
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
    cm.dispatch({changes: {from: 2, to: 5}})
    ist(cm.contentDOM.querySelectorAll(".a").length, 1)
  })

  it("does merge recreated decorations", () => {
    let cm = decoEditor("abcde", [d(1, 4, {class: "c"})])
    cm.dispatch({changes: {from: 2, to: 5, insert: "CDE"},
                 effects: [filterDeco.of(() => false),
                           addDeco.of([d(1, 4, {class: "c"})])]})
    let a = cm.contentDOM.querySelectorAll(".c")
    ist(a.length, 1)
    ist(text(a[0]), "bCD")
  })

  it("breaks high-precedence ranges for low-precedence wrappers", () => {
    let cm = tempView("abc", [decos(Decoration.set([d(1, 3, {class: "b"})])),
                              decos(Decoration.set([d(0, 2, {class: "a"})]))])
    let a = cm.contentDOM.querySelectorAll(".a")
    let b = cm.contentDOM.querySelectorAll(".b")
    ist(a.length, 1)
    ist(b.length, 2)
    ist(b[0].parentNode, a[0])
  })

  it("draws outer decorations around others", () => {
    let cm = tempView("abcde", [
      decos(Decoration.set([d(1, 2, {class: "a"}), d(3, 4, {class: "a"})])),
      EditorView.outerDecorations.of(Decoration.set(Decoration.mark({tagName: "strong"}).range(1, 4))),
      EditorView.outerDecorations.of(Decoration.set(Decoration.mark({tagName: "var"}).range(0, 5))),
      EditorView.outerDecorations.of(Decoration.set(Decoration.mark({tagName: "em"}).range(2, 3)))
    ])
    ist((cm.contentDOM.firstChild as HTMLElement).innerHTML,
        `<var>a<strong><span class="a">b</span><em>c</em><span class="a">d</span></strong>e</var>`)
  })

  it("properly updates the viewport gap when changes fall inside it", () => {
    let doc = "a\n".repeat(500)
    let cm = decoEditor(doc, [d(600, 601, "x")])
    cm.dom.style.height = "100px"
    cm.scrollDOM.style.overflow = "auto"
    cm.scrollDOM.scrollTop = 0
    cm.measure()
    cm.dispatch({
      changes: {from: 500, insert: "  "},
      selection: EditorSelection.single(0, doc.length + 2)
    })
  })

  it("reuses mark nodes", () => {
    let cm = decoEditor("one two three", [d(0, 3, {tagName: "strong"}), d(8, 13, {tagName: "strong", inclusive: true})])
    let marks = Array.from(cm.contentDOM.querySelectorAll("strong"))
    cm.dispatch({changes: [{from: 0, to: 1}, {from: 8, insert: "!"}]})
    ist(marks.every(m => cm.contentDOM.contains(m)))
    cm.dispatch({changes: [{from: 1, to: 3}, {from: 6, to: 7, insert: "-"}]})
    ist(marks.every(m => cm.contentDOM.contains(m)))
  })

  it("doesn't get confused by marked sections that don't draw anything", () => {
    let mark = Decoration.mark({class: "c", inclusiveEnd: true})
    let cm = tempView(`abc\n\ndef\nghi\njkl\n\nmno\npqr\n`, [
      EditorView.decorations.of(v => Decoration.set(mark.range(0, v.state.doc.length))),
      highlightActiveLine()
    ])
    cm.dispatch({selection: {anchor: 5, head: 17}})
    cm.dispatch({selection: {anchor: 18}})
    ist(cm.docView.tile.length, cm.state.doc.length)
  })

  it("properly handles random decorations and changes", () => {
    let r = (n: number) => Math.floor(Math.random() * n)
    let marks = [Decoration.mark({tagName: "a"}), Decoration.mark({tagName: "b"}), Decoration.mark({tagName: "c"})]
    let doc = "abcd efgh ijkl mnopq rstu vwxy z"
    let cm = decoEditor(doc, [])
    for (let i = 0; i < 50; i++) {
      let changes = [], deco: Range<Decoration>[] = []
      if (r(5) < 3) {
        let from = r(Math.max(0, doc.length - 3))
        let to = from + r(Math.min(3, doc.length - from))
        let insert = "#".repeat(r(4))
        changes.push({from, to, insert})
        doc = doc.slice(0, from) + insert + doc.slice(to)
      }
      for (let j = 0, c = r(marks.length); j < c; j++) {
        let from = r(doc.length - 3)
        let to = from + 1 + r(doc.length - 1 - from)
        if (!deco.some(r => r.from == from && r.to == to))
          deco.push(marks[j].range(from, to))
      }
      deco.sort((a, b) => a.from - b.from || b.to - a.to || (a.value.spec.tagName < b.value.spec.tagName ? -1 : 1))
      cm.dispatch({changes, effects: [filterDeco.of(() => false), addDeco.of(deco)]})
      let expect = "", pos = 0
      for (let j = 0, active: Range<Decoration>[] = [];;) {
        let next = j == deco.length ? null : deco[j]
        let nextStop = active.reduce((min, mark) => Math.min(min, mark.to), 1e9)
        let nextPos = Math.min(nextStop, next ? next.from : doc.length)
        if (nextPos > pos) {
          expect += doc.slice(pos, nextPos)
          pos = nextPos
        }
        let reopen: Range<Decoration>[] = []
        if (nextStop <= pos || next && active.some(a => a.to < next!.to)) {
          let closeTo = active.findIndex(mark => mark.to == pos || next && mark.to < next.to)
          while (active.length > closeTo) {
            let close = active.pop()!
            expect += `</${close.value.spec.tagName}>`
            if (close.to > pos) reopen.unshift(close)
          }
        }
        if (next && next.from == pos) {
          j++
          expect += `<${next.value.spec.tagName}>`
          active.push(next)
        }
        for (let mark of reopen) {
          expect += `<${mark.value.spec.tagName}>`
          active.push(mark)
        }
        if (pos == doc.length) break
      }
      ist((cm.contentDOM.firstChild as HTMLElement).innerHTML, expect)
    }
  })

  class WordWidget extends WidgetType {
    constructor(readonly word: string) { super() }
    eq(other: WordWidget) { return this.word.toLowerCase() == other.word.toLowerCase() }
    toDOM() {
      let dom = document.createElement("strong")
      dom.textContent = this.word
      return dom
    }
  }

  describe("widget", () => {
    class OtherWidget extends WidgetType {
      toDOM() { return document.createElement("img") }
    }

    it("draws widgets", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      let elt = cm.contentDOM.querySelector("strong")!
      ist(elt)
      ist(text(elt), "hi")
      ist(elt.contentEditable, "false")
      ist(text(cm.contentDOM), "hellhio")
    })

    it("supports editing around widgets", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      cm.dispatch({changes: {from: 3, to: 4}})
      cm.dispatch({changes: {from: 3, to: 4}})
      ist(cm.contentDOM.querySelector("strong"))
    })

    it("compares widgets with their eq method", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      let elt = cm.contentDOM.querySelector("strong")
      cm.dispatch({
        effects: [filterDeco.of(() => false),
                  addDeco.of([w(4, new WordWidget("HI"))])]
      })
      ist(elt, cm.contentDOM.querySelector("strong"))
    })

    it("notices replaced replacement decorations", () => {
      let cm = decoEditor("abc", [Decoration.replace({widget: new WordWidget("X")}).range(1, 2)])
      cm.dispatch({effects: [filterDeco.of(() => false),
                             addDeco.of([Decoration.replace({widget: new WordWidget("Y")}).range(1, 2)])]})
      ist(text(cm.contentDOM), "aYc")
    })

    it("allows replacements to shadow inner replacements", () => {
      let cm = decoEditor("one\ntwo\nthree\nfour", [
        Decoration.replace({widget: new WordWidget("INNER")}).range(5, 12)
      ])
      cm.dispatch({effects: addDeco.of([Decoration.replace({widget: new WordWidget("OUTER")}).range(1, 17)])})
      ist(text(cm.contentDOM), "oOUTERr")
    })

    it("doesn't consider different widgets types equivalent", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      let elt = cm.contentDOM.querySelector("strong")
      cm.dispatch({effects: [
        filterDeco.of(() => false),
        addDeco.of([w(4, new OtherWidget)])
      ]})
      ist(elt, cm.contentDOM.querySelector("strong"), "!=")
    })

    it("orders widgets by side", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("A"), -1),
                                    w(4, new WordWidget("B")),
                                    w(4, new WordWidget("C"), 10)])
      let widgets = cm.contentDOM.querySelectorAll("strong")
      ist(widgets.length, 3)
      ist(text(widgets[0]), "A")
      ist(text(widgets[1]), "B")
      ist(text(widgets[2]), "C")
    })

    it("places the cursor based on side", () => {
      let cm = requireFocus(
        decoEditor("abc", [w(2, new WordWidget("A"), -1),
                           w(2, new WordWidget("B"), 1)]))
      cm.dispatch({selection: {anchor: 2}})
      let selRange = document.getSelection()!.getRangeAt(0)
      let widgets = cm.contentDOM.querySelectorAll("strong")
      ist(text(widgets[0]), "A")
      ist(text(widgets[1]), "B")
      ist(selRange.comparePoint(widgets[0], 0), -1)
      ist(selRange.comparePoint(widgets[1], 0), 1)
    })

    it("preserves widgets alongside edits regardless of side", () => {
      let cm = decoEditor("abc", [w(1, new WordWidget("x"), -1), w(1, new WordWidget("y"), 1),
                                  w(2, new WordWidget("z"), -1), w(2, new WordWidget("q"), 1)])
      let nodes = Array.from(cm.contentDOM.querySelectorAll("strong"))
      cm.dispatch({changes: {from: 1, to: 2, insert: "B"}})
      ist(text(cm.contentDOM), "axyBzqc")
      ist(nodes.every(n => cm.contentDOM.contains(n)))
    })

    it("reuses widgets on empty lines", () => {
      let cm = decoEditor("a\n\nb", [w(2, new WordWidget("x"))])
      let dom = cm.contentDOM.querySelector("strong")
      cm.dispatch({effects: [filterDeco.of(() => false), addDeco.of([w(2, new WordWidget("x"))])]})
      ist(cm.contentDOM.querySelector("strong"), dom)
    })

    it("can update widgets in an empty document", () => {
      let cm = decoEditor("", [w(0, new WordWidget("A"))])
      cm.dispatch({effects: addDeco.of([w(0, new WordWidget("B"))])})
      ist(cm.contentDOM.querySelectorAll("strong").length, 2)
    })

    it("doesn't duplicate widgets on line splitting", () => {
      let cm = decoEditor("a", [w(1, new WordWidget("W"), 1)])
      cm.dispatch({changes: {from: 1, insert: "\n"}})
      ist(cm.contentDOM.querySelectorAll("strong").length, 1)
    })

    it("can remove widgets at the end of a line", () => { // Issue #139
      let cm = decoEditor("one\ntwo", [w(3, new WordWidget("A"))])
      cm.dispatch({effects: [filterDeco.of(() => false), addDeco.of([w(5, new WordWidget("B"))])]})
      ist(cm.contentDOM.querySelectorAll("strong").length, 1)
    })

    it("can wrap widgets in marks", () => {
      let cm = tempView("abcd", [decos(Decoration.set([d(1, 3, {class: "b"})])),
                                 decos(Decoration.set([w(2, new WordWidget("hi"))])),
                                 decos(Decoration.set([d(0, 4, {class: "a"})]))])
      let a = cm.contentDOM.querySelectorAll(".a")
      let b = cm.contentDOM.querySelectorAll(".b")
      let wordElt = cm.contentDOM.querySelector("strong")
      ist(a.length, 1)
      ist(b.length, 2)
      ist(wordElt)
      ist(wordElt!.parentNode, a[0])
      ist(b[0].parentNode, a[0])
      ist(text(b[0]), "b")
      ist(text(b[1]), "c")
      cm.dispatch({effects: [filterDeco.of(from => from != 2)]})
      ist(cm.contentDOM.querySelectorAll(".b").length, 1)
    })

    it("includes negative-side widgets in marks that end at their position", () => {
      let cm = tempView("123", [decos(Decoration.set([w(2, new WordWidget("x"), -1)])),
                                decos(Decoration.set([d(0, 2, {tagName: "em", inclusive: true})]))])
      ist(cm.contentDOM.querySelector("em")!.textContent, "12x")
    })

    it("includes positive-side widgets in marks that start at their position", () => {
      let cm = tempView("123", [decos(Decoration.set([w(1, new WordWidget("x"), 1)])),
                                decos(Decoration.set([d(1, 3, {tagName: "em", inclusive: true})]))])
      ist(cm.contentDOM.querySelector("em")!.textContent, "x23")
    })

    it("wraps widgets even when the mark starts at the same offset", () => {
      let repl = Decoration.replace({widget: new WordWidget("X"),
                                     inclusive: false})
      let cm = tempView("abcd", [decos(Decoration.set([repl.range(1, 3)])),
                                 decos(Decoration.set([d(1, 3, {class: "a", inclusive: true})]))])
      let a = cm.contentDOM.querySelectorAll(".a")
      let w = cm.contentDOM.querySelectorAll("strong")
      ist(a.length, 1)
      ist(w.length, 1)
      ist(w[0].parentNode, a[0])
    })

    it("merges text around a removed widget", () => {
      let cm = tempView("1234", [decos(Decoration.set([w(2, new WordWidget("x"))]))])
      cm.dispatch({effects: filterDeco.of(() => false)})
      ist(cm.domAtPos(2).node.nodeValue, "1234")
    })

    it("draws buffers around widgets", () => {
      let cm = tempView("1234", [decos(Decoration.set([w(1, new WordWidget("x"), 1), w(3, new WordWidget("y"), -1)]))])
      ist(cm.contentDOM.innerHTML.replace(/<img.*?>/g, "#").replace(/<\/?\w+[^>]*>/g, ""), "1#x23y#4")
    })

    it("doesn't draw unnecessary buffers between adjacent widgets", () => {
      let cm = tempView("1234", [decos(Decoration.set([w(1, new WordWidget("x"), 1), w(1, new WordWidget("x"), 1),
                                                       w(3, new WordWidget("x"), -1), w(3, new WordWidget("x"), -1)]))])
      ist(cm.contentDOM.innerHTML.replace(/<img.*?>/g, "#").replace(/<\/?\w+[^>]*>/g, ""), "1#xx23xx#4")
    })

    it("doesn't wrap buffers at the start of a mark in the mark", () => {
      let cm = tempView("abc", [decos(Decoration.set([w(1, new WordWidget("x")), d(1, 2, "m")]))])
      ist(cm.contentDOM.querySelectorAll("[m]").length, 1)
    })

    it("puts a buffer in front of widgets spanned by marks", () => {
      let cm = tempView("a\n\nc", [
        decos(Decoration.set([d(0, 4, "m")])),
        decos(Decoration.set([w(2, new WordWidget("Q"), 1)])),
      ])
      ist(cm.contentDOM.querySelectorAll("img").length, 1)
    })

    it("reuses buffers on redraw", () => {
      let cm = decoEditor("abcd", [r(1, 2)])
      let buffers = cm.contentDOM.querySelectorAll("img")
      ist(buffers.length, 2)
      cm.dispatch({changes: {from: 1, insert: ".."}})
      ist(Array.from(buffers).every(n => cm.contentDOM.contains(n)))
    })

    it("calls the destroy method on destroyed widgets", () => {
      let destroyed: string[] = []
      class W extends WordWidget {
        destroy() { destroyed.push(this.word) }
      }
      let w1 = new W("A"), w2 = new W("B")
      let cm = tempView("abcde", [decos(Decoration.set([w(1, w1), w(2, w2), w(4, w2)]))])
      cm.dispatch({changes: {from: 0, to: 3}})
      ist(destroyed.sort().join(), "A,B")
      cm.dispatch({changes: {from: 0, to: 2}})
      ist(destroyed.sort().join(), "A,B,B")
    })

    it("calls the destroy method widgets when the editor is destroyed", () => {
      let destroyed: string[] = []
      class W extends WordWidget {
        destroy() { destroyed.push(this.word) }
      }
      let cm = tempView("abcde", [decos(Decoration.set([w(1, new W("A")), w(2, new W("B"))]))])
      cm.destroy()
      ist(destroyed.sort().join(), "A,B")
    })

    it("calls destroy on updated widgets", () => {
      let destroyed: string[] = []
      class W extends WordWidget {
        destroy() { destroyed.push(this.word) }
      }
      let cm = tempView("abcde", [decos(Decoration.set([w(1, new W("A"))]))])
      cm.dispatch({effects: [
        filterDeco.of(() => false),
        addDeco.of([w(1, new W("B"))])
      ]})
      ist(destroyed.sort().join(), "A")
    })

    it("can show inline and block widgets next to each other after a position", () => {
      let cm = tempView("xy", [decos(Decoration.set([
        w(1, new WordWidget("A"), 1),
        Decoration.widget({widget: new BlockWidget("B"), block: true, side: 2, inlineOrder: true}).range(1),
        w(1, new WordWidget("C"), 3),
      ]))])
      let [a, c] = Array.from(cm.contentDOM.querySelectorAll("strong"))
      let b = cm.contentDOM.querySelector("hr")!
      ist(a.parentNode, cm.contentDOM.firstChild)
      ist(c.parentNode, cm.contentDOM.lastChild)
      ist(b.previousSibling, a.parentNode)
      ist(b.nextSibling, c.parentNode)
    })

    it("can show inline and block widgets next to each other before a position", () => {
      let cm = tempView("xy", [decos(Decoration.set([
        w(1, new WordWidget("A"), -3),
        Decoration.widget({widget: new BlockWidget("B"), block: true, side: -2, inlineOrder: true}).range(1),
        w(1, new WordWidget("C"), -2),
      ]))])
      let [a, c] = Array.from(cm.contentDOM.querySelectorAll("strong"))
      let b = cm.contentDOM.querySelector("hr")!
      ist(a.parentNode, cm.contentDOM.firstChild)
      ist(c.parentNode, cm.contentDOM.lastChild)
      ist(b.previousSibling, a.parentNode)
      ist(b.nextSibling, c.parentNode)
    })

    it("updates widgets when appropriate", () => {
      class ColorWidget extends WidgetType {
        constructor(readonly color: string) { super() }
        eq(other: ColorWidget) { return this.color == other.color }
        toDOM() { let d = document.createElement("span"); d.setAttribute("color", this.color); return d }
        updateDOM(dom: HTMLElement) { dom.setAttribute("color", this.color); return true }
      }
      let cm = decoEditor("ab", [Decoration.widget({widget: new ColorWidget("red")}).range(1)])
      let w = cm.contentDOM.querySelector("span")!
      cm.dispatch({effects: [
        filterDeco.of(() => false),
        addDeco.of([Decoration.widget({widget: new ColorWidget("blue")}).range(1)])
      ]})
      ist(cm.contentDOM.contains(w))
      ist(w.getAttribute("color"), "blue")
    })
  })

  function r(from: number, to: number, spec: any = {}) { return Decoration.replace(spec).range(from, to) }

  describe("replaced", () => {
    it("omits replaced content", () => {
      let cm = decoEditor("foobar", [r(1, 4)])
      ist(text(cm.contentDOM), "far")
    })

    it("can replace across lines", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [r(1, 14)])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(text(cm.contentDOM.firstChild!), "fg")
    })

    it("draws replacement widgets", () => {
      let cm = decoEditor("foo\nbar\nbaz", [r(6, 9, {widget: new WordWidget("X")})])
      ist(text(cm.contentDOM), "foobaXaz")
    })

    it("can handle multiple overlapping replaced ranges", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [r(1, 6), r(6, 9), r(8, 14)])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(text(cm.contentDOM.firstChild!), "fg")
    })

    it("allows splitting a replaced range", () => {
      let cm = decoEditor("1234567890", [r(1, 9)])
      cm.dispatch({
        changes: {from: 2, to: 8, insert: "abcdef"},
        effects: [filterDeco.of(_ => false), addDeco.of([r(1, 3), r(7, 9)])]
      })
      ist(text(cm.contentDOM.firstChild!), "1bcde0")
    })

    it("allows replacing a single replaced range with two adjacent ones", () => {
      let cm = decoEditor("1234567890", [r(1, 9)])
      cm.dispatch({
        changes: {from: 2, to: 8, insert: "cdefgh"},
        effects: [filterDeco.of(_ => false), addDeco.of([r(1, 5), r(5, 9)])]
      })
      ist(text(cm.contentDOM.firstChild!), "10")
      ist((cm.contentDOM.firstChild as HTMLElement).querySelectorAll("span").length, 2)
    })

    it("can handle changes inside replaced content", () => {
      let cm = decoEditor("abcdefghij", [r(2, 8)])
      cm.dispatch({changes: {from: 4, to: 6, insert: "n"}})
      ist(text(cm.contentDOM), "abij")
    })

    it("preserves selection endpoints inside replaced ranges", () => {
      let cm = requireFocus(decoEditor("abcdefgh", [r(0, 4)]))
      cm.dispatch({selection: {anchor: 2, head: 6}})
      let sel = document.getSelection()!, range = document.createRange()
      range.setEnd(sel.focusNode!, sel.focusOffset + 1)
      range.setStart(sel.anchorNode!, sel.anchorOffset)
      sel.removeAllRanges()
      sel.addRange(range)
      cm.observer.flush()
      let {anchor, head} = cm.state.selection.main
      ist(head, 7)
      ist(anchor, 2)
    })

    it("draws buffers around replacements", () => {
      let cm = tempView("12345", [decos(Decoration.set([r(0, 1, {widget: new WordWidget("a")}),
                                                        r(2, 3, {widget: new WordWidget("b")}),
                                                        r(4, 5, {widget: new WordWidget("c")})]))])
      ist(cm.contentDOM.innerHTML.replace(/<img.*?>/g, "#").replace(/<\/?\w+[^>]*>/g, ""), "#a#2#b#4#c#")
    })

    it("properly handles marks growing to include replaced ranges", () => {
      let cm = tempView("1\n2\n3\n4", [
        EditorView.decorations.of(Decoration.set(r(4, 5, {widget: new WordWidget("×")}))),
        decos(Decoration.none),
      ])
      cm.dispatch({effects: addDeco.of([d(4, 6, {class: "a"})])})
      cm.dispatch({effects: [filterDeco.of(() => false), addDeco.of([d(2, 6, {class: "a"})])]})
      ist(cm.contentDOM.querySelectorAll("strong").length, 1)
    })

    it("covers block ranges at the end of a replaced range", () => {
      let cm = tempView("1\n2\n3\n4", [
        EditorView.decorations.of(Decoration.set([r(4, 5, {widget: new WordWidget("B"), block: true})])),
        EditorView.decorations.of(Decoration.set([r(1, 5, {widget: new WordWidget("F")})])),
      ])
      ist(cm.contentDOM.querySelectorAll("strong").length, 1)
    })

    it("raises errors for replacing decorations from plugins if they cross lines", () => {
      ist.throws(() => {
        tempView("one\ntwo", [ViewPlugin.fromClass(class {
          update!: () => void
          deco = Decoration.set(Decoration.replace({widget: new WordWidget("ay")}).range(2, 5))
        }, {
          decorations: o => o.deco
        })])
      }, "Decorations that replace line breaks may not be specified via plugins")
    })

    it("doesn't get confused by replaced ranges changing length", () => {
      let collapse = Decoration.replace({})
      let cm = tempView("## abc\n\n## abc", EditorView.decorations.of(view => {
        let len = view.state.doc.length, mark = len == 14 ? 3 : 4
        return Decoration.set([collapse.range(0, mark),
                               collapse.range(len - 3 - mark, len - 3)])
      }))
      cm.dispatch({changes: [
        {from: 0, to: 2, insert: "###"},
        {from: 8, to: 10, insert: "###"}
      ]})
      ist(cm.contentDOM.querySelectorAll(".cm-line").length, 3)
    })
  })

  describe("line attributes", () => {
    function classes(cm: EditorView, ...lines: string[]) {
      for (let i = 0; i < lines.length; i++) {
        let className = (cm.contentDOM.childNodes[i] as HTMLElement).className.split(" ")
          .filter(c => c != "cm-line" && !/ͼ/.test(c)).sort().join(" ")
        ist(className, lines[i])
      }
    }

    it("adds line attributes", () => {
      let cm = decoEditor("abc\ndef\nghi", [l(0, "a"), l(0, "b"), l(1, "c"), l(8, "d")])
      classes(cm, "a b", "", "d")
    })

    it("updates when line attributes are added", () => {
      let cm = decoEditor("foo\nbar", [l(0, "a")])
      let line1 = cm.contentDOM.firstChild, line2 = cm.contentDOM.lastChild
      cm.dispatch({effects: addDeco.of([l(0, "b"), l(4, "c")])})
      classes(cm, "a b", "c")
      ist(cm.contentDOM.firstChild, line1)
      ist(cm.contentDOM.lastChild, line2)
    })

    it("updates when line attributes are removed", () => {
      let ds = [l(0, "a"), l(0, "b"), l(4, "c")]
      let cm = decoEditor("foo\nbar", ds)
      cm.dispatch({effects: filterDeco.of(
        (_f: number, _t: number, deco: Decoration) => !ds.slice(1).some(r => r.value == deco))})
      classes(cm, "a", "")
    })

    it("handles line joining properly", () => {
      let cm = decoEditor("x\ny\nz", [l(0, "a"), l(2, "b"), l(4, "c")])
      cm.dispatch({changes: {from: 1, to: 4}})
      classes(cm, "a")
    })

    it("handles line splitting properly", () => {
      let cm = decoEditor("abc", [l(0, "a")])
      cm.dispatch({changes: {from: 1, to: 2, insert: "\n"}})
      classes(cm, "a", "")
    })

    it("can handle insertion", () => {
      let cm = decoEditor("x\ny\nz", [l(2, "a"), l(4, "b")])
      cm.dispatch({changes: {from: 2, insert: "hi"}})
      classes(cm, "", "a", "b")
    })
  })

  class BlockWidget extends WidgetType {
    constructor(readonly name: string) { super() }
    eq(other: BlockWidget) { return this.name == other.name }
    toDOM() {
      let elt = document.createElement("hr")
      elt.setAttribute("data-name", this.name)
      return elt
    }
  }

  function bw(pos: number, side = -1, name = "n") {
    return Decoration.widget({widget: new BlockWidget(name), side, block: true}).range(pos)
  }

  function br(from: number, to: number, name = "r", inclusive?: boolean) {
    return Decoration.replace({widget: new BlockWidget(name), inclusive, block: true}).range(from, to)
  }

  function widgets(cm: EditorView, ...groups: string[][]) {
    let found: string[][] = [[]]
    for (let n: Node | null = cm.contentDOM.firstChild; n; n = n.nextSibling) {
      if ((n as HTMLElement).nodeName == "HR") found[found.length - 1].push((n as HTMLElement).getAttribute("data-name")!)
      else found.push([])
    }
    ist(JSON.stringify(found), JSON.stringify(groups))
  }

  describe("block widgets", () => {
    it("draws block widgets in the right place", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(3, 1, "B"), bw(3, 2, "C"), bw(4, -2, "D"), bw(4, -1, "E"), bw(7, 1, "F")])
      widgets(cm, ["A"], ["B", "C", "D", "E"], ["F"])
    })

    it("adds widgets when they appear", () => {
      let cm = decoEditor("foo\nbar", [bw(7, 1, "Y")])
      cm.dispatch({effects: addDeco.of([bw(0, -1, "X"), bw(7, 2, "Z")])})
      widgets(cm, ["X"], [], ["Y", "Z"])
    })

    it("removes widgets when they vanish", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(3, 1, "B"), bw(4, -1, "C"), bw(7, 1, "D")])
      widgets(cm, ["A"], ["B", "C"], ["D"])
      cm.dispatch({effects: filterDeco.of((_f: number, _t: number, deco: any) => deco.spec.side < 0)})
      widgets(cm, ["A"], ["C"], [])
    })

    it("draws block ranges", () => {
      let cm = decoEditor("one\ntwo\nthr\nfou", [br(4, 11, "A")])
      widgets(cm, [], ["A"], [])
    })

    it("can add widgets at the end and start of the doc", () => {
      let cm = decoEditor("one\ntwo")
      cm.dispatch({effects: addDeco.of([bw(0, -1, "X"), bw(7, 1, "Y")])})
      widgets(cm, ["X"], [], ["Y"])
    })

    it("can add widgets around inner lines", () => {
      let cm = decoEditor("one\ntwo")
      cm.dispatch({effects: addDeco.of([bw(3, 1, "X"), bw(4, -1, "Y")])})
      widgets(cm, [], ["X", "Y"], [])
    })

    it("can replace an empty line with a range", () => {
      let cm = decoEditor("one\n\ntwo", [br(4, 4, "A")])
      widgets(cm, [], ["A"], [])
    })

    it("can put a block range in the middle of a line", () => {
      let cm = decoEditor("hello", [br(2, 3, "X")])
      widgets(cm, [], ["X"], [])
      cm.dispatch({changes: {from: 1, to: 2, insert: "u"}, effects: addDeco.of([br(2, 3, "X")])})
      widgets(cm, [], ["X"], [])
      cm.dispatch({changes: {from: 3, to: 4, insert: "i"}, effects: addDeco.of([br(2, 3, "X")])})
      widgets(cm, [], ["X"], [])
    })

    it("can draw a block range that partially overlaps with a collapsed range", () => {
      let cm = decoEditor("hello", [Decoration.replace({widget: new WordWidget("X")}).range(0, 3),
                                    br(1, 4, "Y")])
      widgets(cm, [], ["Y"], [])
      ist(cm.contentDOM.querySelector("strong"))
    })

    it("doesn't redraw unchanged widgets", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(7, 1, "B")])
      let ws = cm.contentDOM.querySelectorAll("hr")
      cm.dispatch({effects: [
        filterDeco.of((_f: number, _t: number, deco: any) => deco.spec.side < 0),
        addDeco.of([bw(7, 1, "B")])
      ]})
      widgets(cm, ["A"], [], ["B"])
      let newWs = cm.contentDOM.querySelectorAll("hr")
      ist(newWs[0], ws[0])
      ist(newWs[1], ws[1])
    })

    it("does redraw changed widgets", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(7, 1, "B")])
      cm.dispatch({effects: [
        filterDeco.of((_f: number, _t: number, deco: any) => deco.spec.side < 0),
        addDeco.of([bw(7, 1, "C")])
      ]})
      widgets(cm, ["A"], [], ["C"])
    })

    it("allows splitting a block widget", () => {
      let cm = decoEditor("1234567890", [br(1, 9, "X")])
      cm.dispatch({
        changes: {from: 2, to: 8, insert: "abcdef"},
        effects: [filterDeco.of(_ => false), addDeco.of([br(1, 3, "X"), br(7, 9, "X")])]
      })
      widgets(cm, [], ["X"], ["X"], [])
    })

    it("block replacements cover inline widgets but not block widgets on their sides", () => {
      let cm = decoEditor("1\n2\n3", [
        br(2, 3, "X"),
        w(2, new WordWidget("I1"), -1), w(3, new WordWidget("I1"), 1),
        bw(2, -1, "B1"), bw(3, 1, "B2")
      ])
      ist(!cm.contentDOM.querySelector("strong"))
      widgets(cm, [], ["B1", "X", "B2"], [])
    })

    it("block replacements cover inline replacements at their sides", () => {
      let cm = decoEditor("1\n234\n5", [
        br(2, 5, "X"),
        r(2, 3, {widget: new WordWidget("I1"), inclusive: true}),
        r(4, 5, {widget: new WordWidget("I1"), inclusive: true}),
      ])
      ist(!cm.contentDOM.querySelector("strong"))
    })

    it("doesn't draw replaced lines even when decorated", () => {
      let cm = decoEditor("1\n234\n5", [
        br(2, 5, "X"),
        l(2, {class: "line"})
      ])
      ist(!cm.contentDOM.querySelector(".line"))
    })

    it("draws lines around non-inclusive block widgets", () => {
      let cm = decoEditor("1\n23\n4", [
        br(0, 1, "X", false),
        br(2, 4, "Y", false),
        br(5, 6, "Z", false)
      ])
      ist(cm.contentDOM.querySelectorAll(".cm-line").length, 6)
    })

    it("raises an error when providing block widgets from plugins", () => {
      ist.throws(() => {
        tempView("abc", [ViewPlugin.fromClass(class {
          update!: () => void
          deco = Decoration.set(Decoration.replace({widget: new BlockWidget("oh"), block: true}).range(1, 2))
        }, {
          decorations: o => o.deco
        })])
      }, "Block decorations may not be specified via plugins")
    })
  })

  describe("block wrappers", () => {
    const addBlock = StateEffect.define<Range<BlockWrapper>>()
    const clearBlocks = StateEffect.define<null>()
    const blockField = StateField.define<RangeSet<BlockWrapper>>({
      create() { return RangeSet.empty },
      update(value, tr) {
        value = value.map(tr.changes)
        for (let effect of tr.effects) {
          if (effect.is(addBlock)) value = value.update({add: [effect.value]})
          else if (effect.is(clearBlocks)) value = RangeSet.empty
        }
        return value
      },
      provide: f => EditorView.blockWrappers.from(f)
    })

    let section = BlockWrapper.create({tagName: "section"})
    let navi = BlockWrapper.create({tagName: "navigation"})

    let html = (cm: EditorView) =>
      cm.contentDOM.innerHTML.replace(/ (class|contenteditable)=[^>]*/g, "").replace(/<img[^>]*>/g, "")

    function wrapEditor(doc: string, blocks: readonly Range<BlockWrapper>[]) {
      return tempView(doc, blockField.init(() => RangeSet.of(blocks)))
    }

    it("can wrap a line", () => {
      let cm = wrapEditor("a\nb\nc", [section.range(2)])
      ist(html(cm), `<div>a</div><section><div>b</div></section><div>c</div>`)
    })

    it("can wrap multiple lines", () => {
      let cm = wrapEditor("a\nb\nc", [section.range(0, 2)])
      ist(html(cm), `<section><div>a</div><div>b</div></section><div>c</div>`)
    })

    it("only takes effect at the start of a line", () => {
      let cm = wrapEditor("ab\ncd", [section.range(1)])
      ist(!cm.contentDOM.querySelector("section"))
    })

    it("can nest wrappers", () => {
      let cm = wrapEditor("a\nb\nc", [navi.range(0, 5), section.range(2)])
      ist(html(cm), `<navigation><div>a</div><section><div>b</div></section><div>c</div></navigation>`)
      cm.dispatch({changes: {from: 2, insert: "?"}})
      ist(html(cm), `<navigation><div>a</div><section><div>?b</div></section><div>c</div></navigation>`)
    })

    it("uses precedence to determine nesting order", () => {
      let cm = tempView("ab\ncd\nef", [
        EditorView.blockWrappers.of(RangeSet.of(navi.range(0, 8))),
        EditorView.blockWrappers.of(RangeSet.of(section.range(3, 5))),
      ])
      ist(html(cm), `<navigation><div>ab</div></navigation><section><navigation><div>cd</div></navigation></section><navigation><div>ef</div></navigation>`)
    })

    it("uses rank to determine nesting order within a source", () => {
      let cm = tempView("a\nb\nc", [
        EditorView.blockWrappers.of(RangeSet.of([BlockWrapper.create({tagName: "wrap-a", rank: 2}).range(2, 3),
                                                 BlockWrapper.create({tagName: "wrap-b", rank: 1}).range(2, 3),
                                                 BlockWrapper.create({tagName: "wrap-c", rank: 3}).range(2, 3)]))
      ])
      ist(html(cm), `<div>a</div><wrap-c><wrap-a><wrap-b><div>b</div></wrap-b></wrap-a></wrap-c><div>c</div>`)
    })

    it("doesn't join individual wrappers", () => {
      let cm = wrapEditor("a\nb\nc", [navi.range(0, 5), section.range(2)])
      ist(html(cm), `<navigation><div>a</div><section><div>b</div></section><div>c</div></navigation>`)
    })

    it("can handle changes in wrappers", () => {
      let cm = wrapEditor("ab\ncd\nef", [navi.range(0, 8), section.range(3, 5)])
      cm.dispatch({changes: [{from: 0, to: 1}, {from: 3, insert: "."}, {from: 4, to: 7}]})
      ist(html(cm), `<navigation><div>b</div><section><div>.cf</div></section></navigation>`)
    })

    it("can handle replacements at end of wrappers", () => {
      let cm = wrapEditor("ab\ncd\nef", [section.range(0, 5)])
      cm.dispatch({changes: [{from: 4, to: 7}]})
      ist(html(cm), `<section><div>ab</div><div>cf</div></section>`)
    })

    it("can skip large distances correctly", () => {
      let cm = tempView("-\n".repeat(12000), [
        EditorView.blockWrappers.of(RangeSet.of(section.range(0, 24000))),
        EditorView.decorations.of(RangeSet.of(Decoration.replace({}).range(1, 24000 - 1))),
      ])
      ist(html(cm), "<section><div>-<span></span></div><div><br></div></section>")
    })

    it("represents wrapper padding and borders as ghost widgets", () => {
      let cm = wrapEditor("a\nb\nc\nd", [
        BlockWrapper.create({tagName: "div", attributes: {style: "padding: 3px"}}).range(2, 5)
      ])
      cm.measure()
      let wrapRect = cm.contentDOM.children[1].getBoundingClientRect()
      let eltTop = cm.elementAtHeight(wrapRect.top + 1 - cm.documentTop)
      ist(eltTop.type, BlockType.WidgetRange)
      ist(eltTop.from, 2)
      ist(eltTop.height, 3, near)
      let elt2 = cm.elementAtHeight(cm.coordsAtPos(2)!.top + 1 - cm.documentTop)
      ist(elt2.type, BlockType.Text)
      ist(elt2.from, 2)
      ist(elt2.top, eltTop.bottom, near)
      let eltBot = cm.elementAtHeight(wrapRect.bottom - 1 - cm.documentTop)
      ist(eltBot.type, BlockType.WidgetRange)
      let blocks = cm.viewportLineBlocks
      ist(blocks.length, 4)
      ist(Array.isArray(blocks[1].type))
      ist(Array.isArray(blocks[3].type))
    })

    it("properly measures nested wrapper padding", () => {
      let cm = wrapEditor("a\nb\nc\nd", [
        BlockWrapper.create({tagName: "div", attributes: {style: "padding: 2px"}}).range(2, 5),
        BlockWrapper.create({tagName: "div", attributes: {style: "padding: 3px"}}).range(2, 2),
        BlockWrapper.create({tagName: "div", attributes: {style: "padding: 1px"}}).range(4, 4)
      ])
      cm.measure()
      let gapAbove = (line: BlockInfo) => Array.isArray(line.type) ? line.type[0].height : 0
      ist(gapAbove(cm.viewportLineBlocks[1]), 5, near)
      ist(gapAbove(cm.viewportLineBlocks[2]), 4, near)
      ist(gapAbove(cm.viewportLineBlocks[3]), 3, near)
    })
  })
})
