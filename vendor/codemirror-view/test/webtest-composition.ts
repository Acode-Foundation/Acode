import {tempView, requireFocus} from "./tempview.js"
import {EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType} from "@codemirror/view"
import {EditorState, EditorSelection, StateField, Range} from "@codemirror/state"
import ist from "ist"

;(EditorView as any).EDIT_CONTEXT = false

function event(cm: EditorView, type: string) {
  cm.contentDOM.dispatchEvent(new CompositionEvent(type))
}

function up(node: Text, text: string = "", from = node.nodeValue!.length, to = from) {
  let val = node.nodeValue!
  node.nodeValue = val.slice(0, from) + text + val.slice(to)
  document.getSelection()!.collapse(node, from + text.length)
  return node
}

function hasCompositionDeco(cm: EditorView) {
  return !!cm.docView.hasComposition
}

function compose(cm: EditorView, start: () => Text,
                 update: ((node: Text) => void)[],
                 options: {end?: (node: Text) => void, cancel?: boolean} = {}) {
  event(cm, "compositionstart")
  let node!: Text, sel = document.getSelection()!
  for (let i = -1; i < update.length; i++) {
    if (i < 0) node = start()
    else update[i](node)
    let {focusNode, focusOffset} = sel
    let stack = []
    for (let p = node.parentNode; p && p != cm.contentDOM; p = p.parentNode) stack.push(p)
    cm.observer.flush()

    if (options.cancel && i == update.length - 1) {
      ist(!hasCompositionDeco(cm))
    } else {
      for (let p = node.parentNode, i = 0; p && p != cm.contentDOM && i < stack.length; p = p.parentNode, i++)
        ist(p, stack[i])
      ist(node.parentNode && cm.contentDOM.contains(node.parentNode))
      ist(sel.focusNode, focusNode)
      ist(sel.focusOffset, focusOffset)
      ist(hasCompositionDeco(cm))
    }
  }
  event(cm, "compositionend")
  if (options.end) options.end(node)
  cm.observer.flush()
  cm.update([])
  ist(!cm.composing)
  ist(!hasCompositionDeco(cm))
}

function wordDeco(state: EditorState): DecorationSet {
  let re = /\w+/g, m, deco = [], text = state.doc.toString()
  while (m = re.exec(text))
    deco.push(Decoration.mark({class: "word"}).range(m.index, m.index + m[0].length))
  return Decoration.set(deco)
}

const wordHighlighter = EditorView.decorations.compute(["doc"], wordDeco)

function deco(deco: readonly Range<Decoration>[]) {
  return ViewPlugin.define(() => ({
    decorations: Decoration.set(deco),
    update(update: ViewUpdate) { this.decorations = this.decorations.map(update.changes) }
  }), {decorations: v => v.decorations})
}

function widgets(positions: number[], sides: number[]): ViewPlugin<any> {
  let xWidget = new class extends WidgetType {
    toDOM() { let s = document.createElement("var"); s.textContent = "×"; return s }
  }
  return deco(positions.map((p, i) => Decoration.widget({widget: xWidget, side: sides[i]}).range(p)))
}

describe("Composition", () => {
  it("supports composition on an empty line", () => {
    let cm = requireFocus(tempView("foo\n\nbar"))
    compose(cm, () => up(cm.domAtPos(4).node.appendChild(document.createTextNode("a"))), [
      n => up(n, "b"),
      n => up(n, "c")
    ])
    ist(cm.state.doc.toString(), "foo\nabc\nbar")
  })

  it("supports composition at end of line in existing node", () => {
    let cm = requireFocus(tempView("foo"))
    compose(cm, () => up(cm.domAtPos(2).node as Text), [
      n => up(n, "!"),
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "foo!?")
  })

  it("supports composition at end of line in a new node", () => {
    let cm = requireFocus(tempView("foo"))
    compose(cm, () => up(cm.contentDOM.firstChild!.appendChild(document.createTextNode("!"))), [
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "foo!?")
  })

  it("supports composition at start of line in a new node", () => {
    let cm = requireFocus(tempView("foo"))
    compose(cm, () => {
      let l0 = cm.contentDOM.firstChild!
      return up(l0.insertBefore(document.createTextNode("!"), l0.firstChild))
    }, [
      n => up(n, "?")
    ])
    ist(cm.state.doc.toString(), "!?foo")
  })

  it("supports composition inside existing text", () => {
    let cm = requireFocus(tempView("foo"))
    compose(cm, () => up(cm.domAtPos(2).node as Text), [
      n => up(n, "x", 1),
      n => up(n, "y", 2),
      n => up(n, "z", 3)
    ])
    ist(cm.state.doc.toString(), "fxyzoo")
  })

  it("can deal with Android-style newline-after-composition", () => {
    let cm = requireFocus(tempView("abcdef"))
    compose(cm, () => up(cm.domAtPos(2).node as Text), [
      n => up(n, "x", 3),
      n => up(n, "y", 4)
    ], {end: n => {
      let line = n.parentNode!.appendChild(document.createElement("div"))
      line.textContent = "def"
      n.nodeValue = "abcxy"
      document.getSelection()!.collapse(line, 0)
    }})
    ist(cm.state.doc.toString(), "abcxy\ndef")
  })

  it("handles replacement of existing words", () => {
    let cm = requireFocus(tempView("one two three"))
    compose(cm, () => up(cm.domAtPos(1).node as Text, "five", 4, 7), [
      n => up(n, "seven", 4, 8),
      n => up(n, "zero", 4, 9)
    ])
    ist(cm.state.doc.toString(), "one zero three")
  })

  it("doesn't get interrupted by changes in decorations", () => {
    let cm = requireFocus(tempView("foo ...", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(5).node as Text), [
      n => up(n, "hi", 1, 4)
    ])
    ist(cm.state.doc.toString(), "foo hi")
  })

  it("works inside highlighted text", () => {
    let cm = requireFocus(tempView("one two", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(1).node as Text, "x"), [
      n => up(n, "y"),
      n => up(n, ".")
    ])
    ist(cm.state.doc.toString(), "onexy. two")
  })

  it("can handle compositions spanning multiple tokens", () => {
    let cm = requireFocus(tempView("one two", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(5).node as Text, "a"), [
      n => up(n, "b"),
      n => up(n, "c")
    ], {end: n => {
      ;(n.parentNode!.previousSibling! as ChildNode).remove()
      ;(n.parentNode!.previousSibling! as ChildNode).remove()
      return up(n, "xyzone ", 0)
    }})
    ist(cm.state.doc.toString(), "xyzone twoabc")
  })

  it("doesn't overwrite widgets next to the composition", () => {
    let cm = requireFocus(tempView("", [widgets([0, 0], [-1, 1])]))
    compose(cm, () => {
      let l0 = cm.domAtPos(0).node
      return up(l0.insertBefore(document.createTextNode("a"), l0.lastChild))
    }, [n => up(n, "b", 0, 1)], {end: () => {
      ist(cm.contentDOM.querySelectorAll("var").length, 2)
    }})
    ist(cm.state.doc.toString(), "b")
  })

  it("works for composition in the middle of a mark", () => {
    let cm = requireFocus(tempView("one three", [wordHighlighter, deco([Decoration.mark({class: "a"}).range(0, 9)])]))
    compose(cm, () => up(cm.domAtPos(4, -1).node as Text, "-"), [n => {
      let a = n.parentNode as HTMLElement
      ist(a.className, "a")
      ist(a.innerHTML, '<span class="word">one</span> -<span class="word">three</span>')
      return up(n, ".")
    }])
    ist(cm.state.doc.toString(), "one -.three")
  })

  it("works when composition rewraps the middle of a mark", () => {
    let cm = requireFocus(tempView("one three", [wordHighlighter, deco([Decoration.mark({class: "a"}).range(0, 9)])]))
    compose(cm, () => {
      let space = cm.domAtPos(4, -1).node as Text, a = space.parentNode as HTMLElement
      let wrap1 = a.cloneNode(), wrap2 = a.cloneNode()
      wrap2.appendChild(a.lastChild!)
      a.parentNode!.insertBefore(wrap2, a.nextSibling)
      wrap1.appendChild(space)
      a.parentNode!.insertBefore(wrap1, a.nextSibling)
      return up(space, "-")
    }, [n => {
      let a = n.parentNode as HTMLElement
      ist(a.className, "a")
      ist(a.innerHTML, '<span class="word">one</span> -<span class="word">three</span>')
      return up(n, ".")
    }])
    ist(cm.state.doc.toString(), "one -.three")
  })

  it("cancels composition when a change fully overlaps with it", () => {
    let cm = requireFocus(tempView("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5).node as Text, "x"), [
      () => cm.dispatch({changes: {from: 2, to: 10, insert: "---"}})
    ], {cancel: true})
    ist(cm.state.doc.toString(), "on---hree")
  })

  it("cancels composition when a change partially overlaps with it", () => {
    let cm = requireFocus(tempView("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5).node as Text, "x", 0), [
      () => cm.dispatch({changes: {from: 5, to: 12, insert: "---"}})
    ], {cancel: true})
    ist(cm.state.doc.toString(), "one\nx---ee")
  })

  it("cancels composition when a change happens inside of it", () => {
    let cm = requireFocus(tempView("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5).node as Text, "x", 0), [
      () => cm.dispatch({changes: {from: 5, to: 6, insert: "!"}})
    ], {cancel: true})
    ist(cm.state.doc.toString(), "one\nx!wo\nthree")
  })

  it("doesn't cancel composition when a change happens elsewhere", () => {
    let cm = requireFocus(tempView("one\ntwo\nthree"))
    compose(cm, () => up(cm.domAtPos(5).node as Text, "x", 0), [
      n => up(n, "y", 1),
      () => cm.dispatch({changes: {from: 1, to: 2, insert: "!"}}),
      n => up(n, "z", 2)
    ])
    ist(cm.state.doc.toString(), "o!e\nxyztwo\nthree")
  })

  it("doesn't cancel composition when the composition is moved into a new line", () => {
    let cm = requireFocus(tempView("one\ntwo three", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(9).node as Text, "x"), [
      n => up(n, "y"),
      () => cm.dispatch({changes: {from: 4, insert: "\n"}}),
      n => up(n, "z")
    ])
    ist(cm.state.doc.toString(), "one\n\ntwo threexyz")
  })

  it("doesn't cancel composition when a line break is inserted in front of it", () => {
    let cm = requireFocus(tempView("one two three", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(9).node as Text, "x"), [
      n => up(n, "y"),
      () => cm.dispatch({changes: {from: 8, insert: "\n"}}),
      n => up(n, "z")
    ])
    ist(cm.state.doc.toString(), "one two \nthreexyz")
  })

  it("works before a block widget", () => {
    let widget = new class extends WidgetType {
      toDOM() { let d = document.createElement("div"); d.textContent = "---"; return d }
    }
    let cm = requireFocus(tempView("abcd", [deco([Decoration.widget({widget, side: 1}).range(2)])]))
    compose(cm, () => up(cm.domAtPos(1).node as Text, "p"), [n => up(n, "q"), n => up(n, "r")])
    ist(cm.state.doc.toString(), "abpqrcd")
  })

  it("properly handles line break insertion at end of composition", () => {
    let cm = requireFocus(tempView("one two three", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(5).node as Text, "o"), [
      () => cm.dispatch({changes: {from: 8, insert: "\n"}})
    ])
    ist(cm.state.doc.toString(), "one twoo\n three")
  })

  it("can handle browsers inserting new wrapper nodes around the composition", () => {
    let cm = requireFocus(tempView("one two", [wordHighlighter]))
    compose(cm, () => {
      let span = cm.domAtPos(1).node.parentNode!
      let wrap = span.appendChild(document.createElement("font"))
      let text = wrap.appendChild(document.createTextNode(""))
      return up(text, "1")
    }, [n => up(n, "2")])
    ist(cm.state.doc.toString(), "one12 two")
  })

  it("can handle siblings being moved into a new wrapper", () => {
    let cm = requireFocus(tempView("one two", [wordHighlighter]))
    compose(cm, () => {
      let span = cm.domAtPos(1).node.parentNode as HTMLElement
      let wrap = span.parentNode!.insertBefore(document.createElement("font"), span)
      wrap.appendChild(span.cloneNode(true))
      span.remove()
      let text = wrap.appendChild(document.createTextNode(""))
      return up(text, "1")
    }, [n => up(n, "2")])
    ist(cm.state.doc.toString(), "one12 two")
  })

  it("doesn't cancel composition when a newline is added immediately in front", () => {
    let cm = requireFocus(tempView("one\ntwo three", [wordHighlighter]))
    compose(cm, () => up(cm.domAtPos(9).node as Text, "x"), [
      n => up(n, "y"),
      () => cm.dispatch({changes: {from: 7, to: 8, insert: "\n"}}),
      n => up(n, "z")
    ])
    ist(cm.state.doc.toString(), "one\ntwo\nthreexyz")
  })

  it("handles compositions rapidly following each other", () => {
    let cm = requireFocus(tempView("one\ntwo"))
    event(cm, "compositionstart")
    let one = cm.domAtPos(1).node as Text
    up(one, "!")
    cm.observer.flush()
    event(cm, "compositionend")
    one.nodeValue = "one!!"
    let L2 = cm.contentDOM.lastChild
    event(cm, "compositionstart")
    let two = cm.domAtPos(7).node as Text
    ist(cm.contentDOM.lastChild, L2)
    up(two, ".")
    cm.observer.flush()
    ist(hasCompositionDeco(cm))
    ist(getSelection()!.focusNode, two)
    ist(getSelection()!.focusOffset, 4)
    ist(cm.composing)
    event(cm, "compositionend")
    cm.observer.flush()
    ist(cm.state.doc.toString(), "one!!\ntwo.")
  })

  it("applies compositions at secondary cursors", () => {
    let cm = requireFocus(tempView("one\ntwo", EditorState.allowMultipleSelections.of(true)))
    cm.dispatch({selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)], 0)})
    compose(cm, () => up(cm.domAtPos(2).node as Text, "·"), [
      n => up(n, "-", 3, 4),
      n => up(n, "→", 3, 4)
    ])
    ist(cm.state.doc.toString(), "one→\ntwo→")
  })

  it("applies compositions at secondary cursors even when the change is before the cursor", () => {
    let cm = requireFocus(tempView("one\ntwo", EditorState.allowMultipleSelections.of(true)))
    cm.dispatch({selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)], 0)})
    compose(cm, () => up(cm.domAtPos(2).node as Text, "X"), [
      n => up(n, "Y"),
      n => up(n, "Z", 3, 4)
    ])
    ist(cm.state.doc.toString(), "oneZY\ntwoZY")
  })

  it("doesn't try to apply multi-cursor composition in a single node", () => {
    let cm = requireFocus(tempView("onetwo"))
    cm.dispatch({selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(6)], 0)})
    compose(cm, () => up(cm.domAtPos(2).node as Text, "X", 3), [
      n => up(n, "Y", 4),
    ])
    ist(cm.state.doc.toString(), "oneXYtwo")
  })

  it("can handle IME merging spans", () => {
    let field = StateField.define<DecorationSet>({
      create: () => Decoration.set([
        Decoration.mark({class: "a"}).range(0, 1),
        Decoration.mark({class: "b"}).range(1, 6),
      ]),
      update(deco, u) { return deco.map(u.changes) },
      provide: f => EditorView.decorations.from(f)
    })
    let cm = requireFocus(tempView("(hello)", [field]))
    cm.dispatch({selection: {anchor: 1, head: 6}})
    compose(cm, () => up(cm.domAtPos(2).node as Text, "a"), [
      n => {
        let sA = cm.contentDOM.querySelector(".a")!, sB = cm.contentDOM.querySelector(".b")!
        sB.remove()
        ;(sA as HTMLElement).innerText = ""
        sA.appendChild(document.createTextNode("("))
        sA.appendChild(n)
        n.nodeValue = "a b"
        document.getSelection()!.collapse(n, 1)
        document.getSelection()!.extend(n, 3)
      },
      n => up(n, "阿波", 0, 3)
    ])
    ist(cm.state.doc.toString(), "(阿波)")
  })

  it("can handle IME extending text nodes", () => {
    let cm = requireFocus(tempView("x .a.", [wordHighlighter]))
    compose(cm, () => {
      let dot = cm.contentDOM.firstChild!.lastChild! as Text
      dot.textContent = " .a.."
      dot.previousSibling!.remove()
      dot.previousSibling!.remove()
      document.getSelection()!.collapse(dot, 5)
      return dot
    }, [])
    ist(cm.contentDOM.textContent, "x .a..")
  })
})
