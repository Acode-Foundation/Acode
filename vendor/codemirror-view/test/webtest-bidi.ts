import {tempView} from "./tempview.js"
import ist from "ist"
import {__test, BidiSpan, Direction, Decoration, DecorationSet, EditorView} from "@codemirror/view"
import {Text, EditorSelection, SelectionRange, Range, StateField, Extension} from "@codemirror/state"

function queryBrowserOrder(strings: readonly string[]) {
  let scratch = document.body.appendChild(document.createElement("div"))
  for (let str of strings) {
    let wrap = scratch.appendChild(document.createElement("div"))
    wrap.style.whiteSpace = "pre"
    if (/Mac/.test(navigator.platform)) wrap.style.fontFamily = "Al Bayan"
    for (let ch of str) {
      let span = document.createElement("span")
      span.textContent = ch
      wrap.appendChild(span)
    }
  }
  let ltr: (readonly number[])[] = [], rtl: (readonly number[])[] = []
  for (let i = 0; i < 2; i++) {
    let dest = i ? rtl : ltr
    scratch.style.direction = i ? "rtl" : "ltr"
    for (let cur = scratch.firstChild; cur; cur = cur.nextSibling) {
      let positions = []
      for (let sp = cur.firstChild, i = 0; sp; sp = sp.nextSibling) positions.push([i++, (sp as HTMLElement).offsetLeft])
      dest.push(positions.sort((a, b) => a[1] - b[1]).map(x => x[0]))
    }
  }
  scratch.remove()
  return {ltr, rtl}
}

const cases = [
  "codemirror",
  "كودالمرآة",
  "codeمرآة",
  "الشفرةmirror",
  "codeمرآةabc",
  "كود1234المرآة",
  "كودabcالمرآة",
  "كو,",
  "code123مرآة157abc",
  "  foo  ",
  "  مرآة  ",
  "ab12-34%م",
  "م1234%bc",
  "ر12:34ر",
  "xyאהxyאהxyאהxyאהxyאהxyאהxyאה",
  "ab مرآة10 cde 20مرآة!",
  "(ء)و)",
  "(([^ء-ي]|^)و)",
  "ء(و)",
  "[foo(barء)]"
]

let queried: {ltr: (readonly number[])[], rtl: (readonly number[])[]} | null = null
function getOrder(i: number, dir: Direction) {
  if (!queried) queried = queryBrowserOrder(cases)
  return queried[dir == Direction.LTR ? "ltr" : "rtl"][i]
}

function ourOrder(order: readonly BidiSpan[], dir: Direction) {
  let result = []
  for (let span of dir == Direction.LTR ? order : order.slice().reverse()) {
    if (span.level % 2) for (let i = span.to - 1; i >= span.from; i--) result.push(i)
    else for (let i = span.from; i < span.to; i++) result.push(i)
  }
  return result
}

function tests(dir: Direction) {
  describe(Direction[dir] + " context", () => {
    for (let i = 0; i < cases.length; i++) it(cases[i], () => {
      ist(ourOrder(__test.computeOrder(cases[i], dir, []), dir).join("-"), getOrder(i, dir).join("-"))
    })
  })

  describe(Direction[dir] + " motion", () => {
    for (let i = 0; i < cases.length; i++) {
      for (let forward = true;; forward = false) {
        it(cases[i] + (forward ? " forward" : " backward"), () => {
          let order = __test.computeOrder(cases[i], dir, [])
          let line = Text.of([cases[i]]).line(1)
          let seen = new Set<number>()
          let span = order[forward ? 0 : order.length - 1]
          let pos = EditorSelection.cursor(span.side(!forward, dir), span.forward(forward, dir) ? 1 : -1)
          for (;;) {
            let id = pos.head * (pos.assoc < 0 ? -1 : 1)
            ist(!seen.has(id))
            seen.add(id)
            let next = __test.moveVisually(line, order, dir, pos, forward)
            if (!next) break
            pos = next
          }
          ist(seen.size, cases[i].length + 1)
        })
        if (!forward) break
      }
    }

    it("handles extending characters", () => {
      let str = "aé̠őx 😎🙉 👨‍🎤💪🏽👩‍👩‍👧‍👦 🇩🇪🇫🇷"
      let points = [0, 1, 4, 6, 7, 8, 10, 12, 13, 18, 22, 33, 34, 38, 42]
      let line = Text.of([str]).line(1)
      let order = __test.computeOrder(str, Direction.LTR, [])
      for (let i = 1; i < points.length; i++) {
        ist(__test.moveVisually(line, order, Direction.LTR, EditorSelection.cursor(points[i - 1], 0, 0), true)!.from, points[i])
        ist(__test.moveVisually(line, order, Direction.LTR, EditorSelection.cursor(points[i], 0, 0), false)!.from, points[i - 1])
      }
    })

    it("handles a misplaced non-joiner without going in a loop", () => {
      let doc = "ءAB\u200cء", line = Text.of([doc]).line(1)
      let order = __test.computeOrder(doc, Direction.RTL, [])
      for (let pos: SelectionRange | null = EditorSelection.cursor(0), count = 0; count++;) {
        ist(count, 6, "<")
        pos = __test.moveVisually(line, order, Direction.RTL, pos, true)
        if (!pos) break
      }
      for (let pos: SelectionRange | null = EditorSelection.cursor(doc.length), count = 0; count++;) {
        ist(count, 6, "<")
        pos = __test.moveVisually(line, order, Direction.RTL, pos, false)
        if (!pos) break
      }
    })
  })
}

const rtlTheme = EditorView.theme({"&": {direction: "rtl"}})
const rtlIso = Decoration.mark({
  attributes: {style: "direction: rtl; unicode-bidi: isolate"},
  bidiIsolate: Direction.RTL
})
const ltrIso = Decoration.mark({
  attributes: {style: "direction: ltr; unicode-bidi: isolate"},
  bidiIsolate: Direction.LTR
})

function deco(...decorations: Range<Decoration>[]) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.set(decorations),
    update: (s, tr) => s.map(tr.changes),
    provide: f => [EditorView.decorations.from(f), EditorView.bidiIsolatedRanges.from(f)]
  })
}

function testIsolates(doc: string, extensions: Extension, expected: string) {
  let cm = tempView(doc, [extensions])
  cm.measure()
  ist(cm.bidiSpans(cm.state.doc.line(1)).map(s => s.from + "-" + s.to + ":" + s.level).join(" "), expected)
}

describe("bidi", () => {
  tests(Direction.LTR)
  tests(Direction.RTL)

  it("properly handles isolates in RTL", () => {
    testIsolates("אחת -hello- שתיים", [rtlTheme, deco(ltrIso.range(4, 11))],
                 "0-4:1 4-11:2 11-17:1")
  })

  it("properly handles isolates in LTR", () => {
    testIsolates("one -שלום- two", deco(rtlIso.range(4, 10)),
                 "0-4:0 4-10:1 10-14:0")
  })

  it("properly handles isolates in RTL text in LTR context", () => {
    testIsolates("אחת -hello- שתיים", [deco(ltrIso.range(4, 11))],
                 "11-17:1 4-11:2 0-4:1")
  })

  it("handles LTR isolates in nested numerals", () => {
    testIsolates("كود12ab34المرآة", [rtlTheme, deco(ltrIso.range(5, 7))],
                 "0-3:1 3-5:2 5-7:2 7-9:2 9-15:1")
  })

  it("handles RTL isolates in nested numerals", () => {
    testIsolates("كود12مر34المرآة", [rtlTheme, deco(rtlIso.range(5, 7))],
                 "0-3:1 3-5:2 5-7:1 7-9:2 9-15:1")
  })

  it("works for multiple isolates", () => {
    testIsolates("one -שלום- two .אחת. three", [deco(rtlIso.range(4, 10), rtlIso.range(15, 20))],
                 "0-4:0 4-10:1 10-15:0 15-20:1 20-26:0")
  })

  it("handles multiple isolates in a row", () => {
    testIsolates("one -שלום- two", deco(rtlIso.range(4, 7), rtlIso.range(7, 10)),
                 "0-4:0 4-7:1 7-10:1 10-14:0")
  })

  it("supports nested isolates", () => {
    testIsolates("one -אחת .two. שתיים- three", [
      deco(ltrIso.range(9, 14)),
      deco(rtlIso.range(4, 21))
    ], "0-4:0 14-21:1 9-14:2 4-9:1 21-27:0")
  })

  it("includes isolates at the end of spans in the base direction", () => {
    testIsolates("oneאחת -", deco(ltrIso.range(6, 7), ltrIso.range(7, 8)),
                 "0-3:0 3-6:1 6-7:0 7-8:0")
  })

  it("normalizes neutrals between isolates", () => {
    testIsolates("שלa-bום", deco(ltrIso.range(2, 3), ltrIso.range(4, 5)),
                 "5-7:1 4-5:2 3-4:1 2-3:2 0-2:1")
  })

  it("matches brackets across isolates", () => {
    testIsolates("one(אחת)שתיים", deco(rtlIso.range(4, 5)),
                 "0-4:0 4-5:1 5-7:1 7-8:0 8-13:1")
  })
})
