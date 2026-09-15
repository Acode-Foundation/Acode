import {tempView} from "./tempview.js"
import {EditorView, Decoration, WidgetType} from "@codemirror/view"
import {Range} from "@codemirror/state"
import ist from "ist"

const inline = new class extends WidgetType {
  toDOM() {
    let span = document.createElement("span")
    span.className = "widget"
    span.textContent = "X"
    return span
  }
}
const block = new class extends WidgetType {
  toDOM() {
    let span = document.createElement("div")
    span.className = "widget"
    span.textContent = "X"
    return span
  }
}

function deco(...deco: Range<Decoration>[]) {
  return EditorView.decorations.of(Decoration.set(deco))
}

const cls = Decoration.mark({class: "c"})

describe("EditorView coords", () => {
  it("can find coordinates for simple text", () => {
    let cm = tempView("one two\n\nthree"), prev = null
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsAtPos(i)!
      if (prev) ist(prev.top < coords.top - 5 || prev.left < coords.left)
      prev = coords
      ist(cm.posAtCoords({x: coords.left, y: coords.top + 1}), i)
    }
  })

  it("can find coordinates in text scrolled into view horizontally", () => {
    let cm = tempView("l1\n" + "l2 ".repeat(400))
    let rect = cm.dom.getBoundingClientRect(), line2 = cm.coordsAtPos(3)!.top + 2
    cm.scrollDOM.scrollLeft = 0
    let right = cm.posAtCoords({x: rect.right - 2, y: line2})
    cm.scrollDOM.scrollLeft = (rect.right - rect.left) - 10
    ist(cm.posAtCoords({x: rect.right - 2, y: line2}), right, ">")
  })

  it("can find coordinates in decorated text", () => {
    let cm = tempView("ab cd efg\nkl nop", deco(cls.range(0, 2), cls.range(3, 5), cls.range(6, 9), cls.range(10, 12),
                                                cls.range(13, 16)))
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsAtPos(i)!
      ist(cm.posAtCoords({x: coords.left, y: coords.top + 1}), i)
    }
  })

  const narrow = EditorView.theme({"&": {width: "10em"}})

  it("can find coordinates in line-wrapped text", () => {
    let cm = tempView("abcd ".repeat(30) + "e", [EditorView.lineWrapping, narrow])
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsAtPos(i)!
      ist(cm.posAtCoords({x: coords.left, y: coords.top + 1}), i)
    }
  })

  it("returns the proper position for coordinates past the end of a wrapped line", () => {
    let cm = tempView("abcdef ghijklm nopqr", [EditorView.lineWrapping, narrow])
    let p20 = cm.coordsAtPos(20, -1)!
    ist(cm.posAtCoords({x: p20.left + 30, y: p20.top + 1}), 20)
  })

  it("can find coordinates in decorated line-wrapped text", () => {
    let d: Range<Decoration>[] = []
    for (let i = 0; i < 30; i++) d.push(cls.range(i * 5, i * 5 + 4))
    let cm = tempView("abcd ".repeat(30) + "e", [
      EditorView.lineWrapping,
      narrow,
      deco(...d)
    ])
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsAtPos(i)!
      ist(cm.posAtCoords({x: coords.left, y: coords.top + 1}), i)
    }
  })

  it("can find coordinates in RTL text", () => {
    let cm = tempView("واحد اثنان ثلاثة 444 خمسة\n".repeat(3), [
      EditorView.theme({".cm-content": {direction: "rtl"}}),
      deco(cls.range(0, 4), cls.range(17, 20))
    ])
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsForChar(i)!
      if (coords) {
        let [left, right] = [coords.left + 1, coords.right - 1]
        let [before, after] = cm.state.doc.sliceString(i, i + 1) == "4" ? [left, right] : [right, left]
        ist(cm.posAtCoords({x: before, y: coords.top + 1}), i)
        ist(cm.posAtCoords({x: after, y: coords.top + 1}), i + 1)
      }
    }
  })

  it("can find coordinates in bidi text", () => {
    let cm = tempView("one اثنان three 444 خمسة\n".repeat(3))
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsForChar(i)!
      if (coords) {
        let [left, right] = [coords.left + 1, coords.right - 1]
        let [before, after] = /[a-z\d ]/.test(cm.state.doc.sliceString(i, i + 1)) ? [left, right] : [right, left]
        ist(cm.posAtCoords({x: before, y: coords.top + 1}), i)
        ist(cm.posAtCoords({x: after, y: coords.top + 1}), i + 1)
      }
    }
  })

  it("can find coordinates in wrapped bidi text", () => {
    let cm = tempView("one اثنان three 444 خمسة ".repeat(3), [
      EditorView.lineWrapping,
      narrow,
      deco(cls.range(0, 3), cls.range(20, 25))
    ])
    for (let i = 0; i < cm.state.doc.length; i++) {
      let coords = cm.coordsForChar(i)!
      if (coords) {
        let [left, right] = [coords.left + 1, coords.right - 1]
        let [before, after] = /[a-z\d ]/.test(cm.state.doc.sliceString(i, i + 1)) ? [left, right] : [right, left]
        ist(cm.posAtCoords({x: before, y: coords.top + 1}), i)
        ist(cm.posAtCoords({x: after, y: coords.top + 1}), i + 1)
      }
    }
  })

  function near(a: number, b: any) {
    return Math.abs(a - b) < 5
  }

  it("takes coordinates before side=1 widgets", () => {
    let widget = Decoration.widget({widget: inline, side: 1})
    let cm = tempView("abdefg", [deco(widget.range(0), widget.range(3), widget.range(6))])
    let sides = Array.prototype.map.call(cm.contentDOM.querySelectorAll(".widget"), w => w.getBoundingClientRect().left)
    ist(near(cm.coordsAtPos(0, 1)!.left, sides[0]))
    ist(near(cm.coordsAtPos(0, -1)!.left, sides[0]))
    ist(near(cm.coordsAtPos(3, 1)!.left, sides[1]))
    ist(near(cm.coordsAtPos(3, -1)!.left, sides[1]))
    ist(near(cm.coordsAtPos(6, 1)!.left, sides[2]))
    ist(near(cm.coordsAtPos(6, -1)!.left, sides[2]))
  })

  it("takes coordinates after side=-1 widgets", () => {
    let widget = Decoration.widget({widget: inline, side: -1})
    let cm = tempView("abdefg", [deco(widget.range(0), widget.range(3), widget.range(6))])
    let sides = Array.prototype.map.call(cm.contentDOM.querySelectorAll(".widget"), w => w.getBoundingClientRect().right)
    ist(near(cm.coordsAtPos(0, 1)!.left, sides[0]))
    ist(near(cm.coordsAtPos(0, -1)!.left, sides[0]))
    ist(near(cm.coordsAtPos(3, 1)!.left, sides[1]))
    ist(near(cm.coordsAtPos(3, -1)!.left, sides[1]))
    ist(near(cm.coordsAtPos(6, 1)!.left, sides[2]))
    ist(near(cm.coordsAtPos(6, -1)!.left, sides[2]))
  })

  it("respects sides for widgets wrapped in marks", () => {
    let cm = tempView("a\n\nb\n\nd", [
      deco(Decoration.widget({widget: inline, side: 1}).range(2),
           Decoration.widget({widget: inline, side: -1}).range(5)),
      deco(Decoration.mark({class: "test"}).range(0, 7))
    ])
    let widgets = cm.contentDOM.querySelectorAll(".widget")
    let pos2 = widgets[0].getBoundingClientRect().left
    ist(near(cm.coordsAtPos(2, 1)!.left, pos2))
    ist(near(cm.coordsAtPos(2, -1)!.left, pos2))
    let pos5 = widgets[1].getBoundingClientRect().right
    ist(near(cm.coordsAtPos(5, 1)!.left, pos5))
    ist(near(cm.coordsAtPos(5, -1)!.left, pos5))
  })

  it("takes coordinates between widgets", () => {
    let wb = Decoration.widget({widget: inline, side: -1})
    let wa = Decoration.widget({widget: inline, side: 1})
    let cm = tempView("abdefg", [deco(wb.range(0), wa.range(0), wb.range(3), wa.range(3), wb.range(6), wa.range(6))])
    let sides = Array.prototype.map.call(cm.contentDOM.querySelectorAll(".widget"), w => w.getBoundingClientRect().right)
    ist(near(cm.coordsAtPos(0, 1)!.left, sides[0]))
    ist(near(cm.coordsAtPos(0, -1)!.left, sides[0]))
    ist(near(cm.coordsAtPos(3, 1)!.left, sides[2]))
    ist(near(cm.coordsAtPos(3, -1)!.left, sides[2]))
    ist(near(cm.coordsAtPos(6, 1)!.left, sides[4]))
    ist(near(cm.coordsAtPos(6, -1)!.left, sides[4]))
  })

  it("takes coordinates before side=1 block widgets", () => {
    let widget = Decoration.widget({widget: block, side: 1, block: true})
    let cm = tempView("ab", [deco(widget.range(0), widget.range(1), widget.range(2))])
    let sides = Array.from(cm.contentDOM.querySelectorAll(".widget")).map(w => w.getBoundingClientRect().top)
    ist(near(cm.coordsAtPos(0, -1)!.bottom, sides[0]))
    ist(near(cm.coordsAtPos(0, 1)!.bottom, sides[0]))
    ist(near(cm.coordsAtPos(0, 2 as any)!.bottom, sides[1]))
    ist(near(cm.coordsAtPos(1, -1)!.bottom, sides[1]))
    ist(near(cm.coordsAtPos(1, 1)!.bottom, sides[1]))
    ist(near(cm.coordsAtPos(1, 2 as any)!.bottom, sides[2]))
    ist(near(cm.coordsAtPos(2, -1)!.bottom, sides[2]))
    ist(near(cm.coordsAtPos(2, 1)!.bottom, sides[2]))
  })

  it("takes coordinates after side=-1 block widgets", () => {
    let widget = Decoration.widget({widget: block, side: -1, block: true})
    let cm = tempView("ab", [deco(widget.range(0), widget.range(1), widget.range(2))])
    let sides = Array.prototype.map.call(cm.contentDOM.querySelectorAll(".widget"), w => w.getBoundingClientRect().bottom)
    ist(near(cm.coordsAtPos(0, -1)!.top, sides[0]))
    ist(near(cm.coordsAtPos(0, 1)!.top, sides[0]))
    ist(near(cm.coordsAtPos(1, -1)!.top, sides[1]))
    ist(near(cm.coordsAtPos(1, -2 as any)!.top, sides[0]))
    ist(near(cm.coordsAtPos(1, 1)!.top, sides[1]))
    ist(near(cm.coordsAtPos(2, -1)!.top, sides[2]))
    ist(near(cm.coordsAtPos(2, -2 as any)!.top, sides[1]))
    ist(near(cm.coordsAtPos(2, 1)!.top, sides[2]))
  })

  it("takes coordinates around non-inclusive block widgets", () => {
    let widget = Decoration.replace({widget: block, inclusive: false, block: true})
    let cm = tempView("ab", [deco(widget.range(0, 2))])
    let rect = cm.contentDOM.querySelector(".widget")!.getBoundingClientRect()
    ist(near(cm.coordsAtPos(0, 1)!.bottom, rect.top))
    ist(near(cm.coordsAtPos(2, -1)!.top, rect.bottom))
  })

  it("takes proper coordinates for elements on decoration boundaries", () => {
    let cm = tempView("a b c", [deco(Decoration.mark({attributes: {style: "padding: 0 10px"}}).range(2, 3))])
    ist(near(cm.coordsAtPos(2, 1)!.left, cm.coordsAtPos(2, -1)!.left + 10))
    ist(near(cm.coordsAtPos(3, -1)!.left, cm.coordsAtPos(3, 1)!.left - 10))
  })

  it("can find coordinates around a side=1 block widget", () => {
    let cm = tempView("a\nb", [deco(Decoration.widget({widget: block, side: 1, block: true}).range(2))])
    let c2 = cm.coordsAtPos(2)!, c3 = cm.coordsAtPos(3)!
    ist(c2.top, c3.top, "<")
    ist(cm.posAtCoords({x: c2.left, y: c2.top + 1}), 2)
    ist(cm.posAtCoords({x: c3.left, y: c3.top + 1}), 3)
  })

  it("can find coordinates around a side=-1 block widget", () => {
    let cm = tempView("a\nb", [deco(Decoration.widget({widget: block, side: -1, block: true}).range(1))])
    let c0 = cm.coordsAtPos(0)!, c1 = cm.coordsAtPos(1)!
    ist(c0.top, c1.top, "<")
    ist(cm.posAtCoords({x: c0.left, y: c0.top + 1}), 0)
    ist(cm.posAtCoords({x: c1.left, y: c1.top + 1}), 1)
  })

  it("can handle positions between non-uniform lines", () => {
    let cm = tempView("abcd\nefgh", [deco(Decoration.mark({attributes: {style: "font-size: 150%"}}).range(6, 7)),
                                     EditorView.theme({".cm-line": {padding: "4px"}})])
    let c4 = cm.coordsAtPos(4)!
    ist(cm.posAtCoords({x: c4.left + 5, y: c4.bottom + 7}), 9)
  })

  it("can handle coordinates above small text in a non-uniform line", () => {
    let cm = tempView("abcdefgh", [deco(Decoration.mark({attributes: {style: "font-size: 200%"}}).range(6, 7))])
    let c4 = cm.coordsAtPos(4)!
    ist(cm.posAtCoords({x: c4.left, y: c4.top - 4}), 4)
  })
})

describe("coordsForChar", () => {
  function near(a: number, b: number) {
    return Math.abs(a - b) < 0.01
  }

  it("returns reasonable coords", () => {
    let cm = tempView("abc\ndef")
    let a = cm.coordsForChar(0)!, c = cm.coordsForChar(2)!, d = cm.coordsForChar(4)!, f = cm.coordsForChar(6)!
    ist(a.right, a.left, ">")
    ist(a.bottom, a.top, ">")
    ist(a.top, c.top, near)
    ist(a.bottom, c.bottom, near)
    ist(c.left, a.right, ">")
    ist(a.bottom, d.bottom, "<")
    ist(d.top, f.top, near)
    ist(f.left, c.left, near)
  })

  it("returns null for non-rendered characters", () => {
    let cm = tempView("abc\ndef\n", [deco(Decoration.replace({}).range(1, 2))])
    ist(cm.coordsForChar(1), null)
    ist(cm.coordsForChar(3), null)
    ist(cm.coordsForChar(8), null)
  })

  it("returns proper rectangles in right-to-left text", () => {
    let cm = tempView("شاهد")
    let first = cm.coordsForChar(0)!, last = cm.coordsForChar(cm.state.doc.length - 1)!
    ist(first.left, first.right, "<")
    ist(last.left, last.right, "<")
    ist(first.left, last.right, ">")
  })

  it("doesn't include space taken up by widgets", () => {
    let cm = tempView("abc", [deco(Decoration.widget({widget: inline, side: 1}).range(1),
                                   Decoration.widget({widget: inline, side: -1}).range(2))])
    let a = cm.coordsForChar(0)!, b = cm.coordsForChar(1)!, c = cm.coordsForChar(2)!
    let ws = cm.contentDOM.querySelectorAll(".widget") as NodeListOf<HTMLElement>
    let w1 = ws[0].getBoundingClientRect(), w2 = ws[1].getBoundingClientRect()
    let ε = 0.01
    ist(a.right - ε, w1.left, "<=")
    ist(b.left + ε, w1.right, ">=")
    ist(b.right - ε, w2.left, "<=")
    ist(c.left + ε, w2.right, ">=")
  })

  it("returns positions for wrap points", () => {
    let cm = tempView("aaaaaaaaa bbbbbbbbbbbbb", [EditorView.theme({"&": {maxWidth: "7em"}}), EditorView.lineWrapping])
    let a = cm.coordsForChar(0)!, b = cm.coordsForChar(10)!, wrap = cm.coordsForChar(9)!
    ist(a.top, b.top, "<")
    ist(wrap)
    ist(wrap.top, a.top, near)
    ist(wrap.top, b.top, "<")
    ist(wrap.left, a.right, ">")
  })

  function posSide(view: EditorView, x: number, y: number) {
    let val = view.posAndSideAtCoords({x, y})
    return val ? val.pos + (val.assoc < 0 ? "<" : ">") : "x"
  }

  it("works in right-to-left text", () => {
    let cm = tempView("فرخة")
    let ch0 = cm.coordsForChar(0)!
    ist(posSide(cm, ch0.right - 1, ch0.top + 2), "0>")
    ist(posSide(cm, ch0.right + 1, ch0.top + 2), "0>")
    ist(posSide(cm, ch0.left + 1.5, ch0.top + 2), "1<")
    ist(posSide(cm, ch0.left - 1, ch0.top + 2), "1>")
    let ch3 = cm.coordsForChar(3)!
    ist(posSide(cm, ch3.right + 1, ch3.top + 2), "3<")
    ist(posSide(cm, ch3.right - 1.5, ch3.top + 2), "3>")
    ist(posSide(cm, ch3.left + 1, ch3.top + 2), "4<")
    ist(posSide(cm, ch3.left - 1, ch3.top + 2), "4<")
  })

  it("produces correct results when side points out of an RTL node", () => {
    let cm = tempView("فرخة")
    let s1 = cm.coordsAtPos(0, -1)!, s2 = cm.coordsAtPos(0, 1)!
    ist(Math.abs(s1.left - s2.left), 0.1, "<")
    let e1 = cm.coordsAtPos(4, 1)!, e2 = cm.coordsAtPos(4, -1)!
    ist(Math.abs(e1.left - e2.left), 0.1, "<")
  })

  it("can handle nested elements with direction breaks", () => {
    let cm = tempView("one فرخة", EditorView.decorations.of(Decoration.set(Decoration.mark({class: "foo"}).range(0, 8))))
    let ch4 = cm.coordsForChar(4)!
    ist(posSide(cm, ch4.left + 100, ch4.top + 1), "4>")
  })

  it("doesn't crash on non-rendered content", () => {
    let cm = tempView("abc", [
      EditorView.decorations.of(Decoration.set(Decoration.mark({attributes: {style: "display: none"}}).range(0, 3))),
      EditorView.theme({
        ".cm-line": {height: "30px"}
      })
    ])
    let lineRect = cm.contentDOM.querySelector(".cm-line")!.getBoundingClientRect()
    ist(cm.posAtCoords({x: lineRect.left + 1, y: lineRect.top + 5}), 0)
  })
})
