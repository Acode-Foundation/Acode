import {tempView, requireFocus} from "./tempview.js"
import ist from "ist"

function setDOMSel(node: Node, offset: number) {
  let range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  let sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function textNode(node: Node, text: string): Text | null {
  if (node.nodeType == 3) {
    if (node.nodeValue == text) return node as Text
  } else if (node.nodeType == 1) {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      let found = textNode(ch, text)
      if (found) return found
    }
  }
  return null
}

function domIndex(node: Node): number {
  for (var index = 0;; index++) {
    node = node.previousSibling!
    if (!node) return index
  }
}

describe("EditorView selection", () => {
  it("can read the DOM selection", () => {
    let cm = requireFocus(tempView("one\n\nthree"))

    function test(node: Node, offset: number, expected: number) {
      setDOMSel(node, offset)
      cm.contentDOM.focus()
      cm.observer.flush()
      ist(cm.state.selection.main.head, expected)
    }
    let one = textNode(cm.contentDOM, "one")!
    let three = textNode(cm.contentDOM, "three")!
    test(one, 0, 0)
    test(one, 1, 1)
    test(one, 3, 3)
    test(one.parentNode!, domIndex(one), 0)
    test(one.parentNode!, domIndex(one) + 1, 3)
    test(cm.contentDOM.childNodes[1], 0, 4)
    test(three, 0, 5)
    test(three, 2, 7)
    test(three.parentNode!, domIndex(three), 5)
    test(three.parentNode!, domIndex(three) + 1, 10)
  })

  it("syncs the DOM selection with the editor selection", () => {
    let cm = requireFocus(tempView("abc\n\ndef"))
    function test(pos: number, node: Node, offset: number) {
      cm.dispatch({selection: {anchor: pos}})
      let sel = window.getSelection()!
      ist(isEquivalentPosition(node, offset, sel.focusNode, sel.focusOffset))
    }
    let abc = textNode(cm.contentDOM, "abc")!
    let def = textNode(cm.contentDOM, "def")!
    test(0, abc.parentNode!, domIndex(abc))
    test(1, abc, 1)
    test(2, abc, 2)
    test(3, abc.parentNode!, domIndex(abc) + 1)
    test(4, cm.contentDOM.childNodes[1], 0)
    test(5, def.parentNode!, domIndex(def))
    test(6, def, 1)
    test(8, def.parentNode!, domIndex(def) + 1)
  })
})

function isEquivalentPosition(node: Node, off: number, targetNode: Node | null, targetOff: number): boolean {
  function scanFor(node: Node, off: number, targetNode: Node, targetOff: number, dir: -1 | 1): boolean {
    for (;;) {
      if (node == targetNode && off == targetOff) return true
      if (off == (dir < 0 ? 0 : maxOffset(node))) {
        if (node.nodeName == "DIV") return false
        let parent = node.parentNode
        if (!parent || parent.nodeType != 1) return false
        off = domIndex(node) + (dir < 0 ? 0 : 1)
        node = parent
      } else if (node.nodeType == 1) {
        node = node.childNodes[off + (dir < 0 ? -1 : 0)]
        off = dir < 0 ? maxOffset(node) : 0
      } else {
        return false
      }
    }
  }

  function domIndex(node: Node): number {
    for (var index = 0;; index++) {
      node = node.previousSibling!
      if (!node) return index
    }
  }

  function maxOffset(node: Node): number {
    return node.nodeType == 3 ? node.nodeValue!.length : node.childNodes.length
  }

  return targetNode ? (scanFor(node, off, targetNode, targetOff, -1) ||
                       scanFor(node, off, targetNode, targetOff, 1)) : false
}
