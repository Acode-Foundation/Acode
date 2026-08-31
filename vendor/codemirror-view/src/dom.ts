import browser from "./browser"

export function getSelection(root: DocumentOrShadowRoot): Selection | null {
  let target
  // Browsers differ on whether shadow roots have a getSelection
  // method. If it exists, use that, otherwise, call it on the
  // document.
  if ((root as any).nodeType == 11) { // Shadow root
    target = (root as any).getSelection ? root as Document : (root as ShadowRoot).ownerDocument
  } else {
    target = root as Document
  }
  return target.getSelection()
}

export function contains(dom: Node, node: Node | null) {
  return node ? dom == node || dom.contains(node.nodeType != 1 ? node.parentNode : node) : false
}

export function hasSelection(dom: HTMLElement, selection: SelectionRange): boolean {
  if (!selection.anchorNode) return false
  try {
    // Firefox will raise 'permission denied' errors when accessing
    // properties of `sel.anchorNode` when it's in a generated CSS
    // element.
    return contains(dom, selection.anchorNode)
  } catch(_) {
    return false
  }
}

export function clientRectsFor(dom: Node) {
  if (dom.nodeType == 3)
    return textRange(dom as Text, 0, dom.nodeValue!.length).getClientRects()
  else if (dom.nodeType == 1)
    return (dom as HTMLElement).getClientRects()
  else
    return [] as any as DOMRectList
}

// Scans forward and backward through DOM positions equivalent to the
// given one to see if the two are in the same place (i.e. after a
// text node vs at the end of that text node)
export function isEquivalentPosition(node: Node, off: number, targetNode: Node | null, targetOff: number): boolean {
  return targetNode ? (scanFor(node, off, targetNode, targetOff, -1) ||
                       scanFor(node, off, targetNode, targetOff, 1)) : false
}

export function domIndex(node: Node): number {
  for (var index = 0;; index++) {
    node = node.previousSibling!
    if (!node) return index
  }
}

export function isBlockElement(node: Node): boolean {
  return node.nodeType == 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|DD|DT|H\d|SECTION|PRE)$/.test(node.nodeName)
}

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
      if (node.nodeType == 1 && (node as HTMLElement).contentEditable == "false") return false
      off = dir < 0 ? maxOffset(node) : 0
    } else {
      return false
    }
  }
}

export function maxOffset(node: Node): number {
  return node.nodeType == 3 ? node.nodeValue!.length : node.childNodes.length
}

/// Basic rectangle type.
export interface Rect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export function flattenRect(rect: Rect, toLeft: boolean) {
  let {left, right} = rect
  if (left == right) return rect
  let x = toLeft ? left : right
  return {left: x, right: x, top: rect.top, bottom: rect.bottom}
}

function windowRect(win: Window): Rect {
  let vp = win.visualViewport
  if (vp) return {
    left: 0, right: vp.width,
    top: 0, bottom: vp.height
  }
  return {left: 0, right: win.innerWidth,
          top: 0, bottom: win.innerHeight}
}

export type ScrollStrategy = "nearest" | "start" | "end" | "center"

export function getScale(elt: HTMLElement, rect: DOMRect) {
  let scaleX = rect.width / elt.offsetWidth
  let scaleY = rect.height / elt.offsetHeight
  if (scaleX > 0.995 && scaleX < 1.005 || !isFinite(scaleX) || Math.abs(rect.width - elt.offsetWidth) < 1) scaleX = 1
  if (scaleY > 0.995 && scaleY < 1.005 || !isFinite(scaleY) || Math.abs(rect.height - elt.offsetHeight) < 1) scaleY = 1
  return {scaleX, scaleY}
}

export function scrollRectIntoView(dom: HTMLElement, rect: Rect, side: -1 | 1,
                                   x: ScrollStrategy, y: ScrollStrategy,
                                   xMargin: number, yMargin: number, ltr: boolean) {
  let doc = dom.ownerDocument!, win = doc.defaultView || window

  for (let cur: any = dom, stop = false; cur && !stop;) {
    if (cur.nodeType == 1) { // Element
      let bounding: Rect, top = cur == doc.body
      let scaleX = 1, scaleY = 1
      if (top) {
        bounding = windowRect(win)
      } else {
        if (/^(fixed|sticky)$/.test(getComputedStyle(cur).position)) stop = true
        if (cur.scrollHeight <= cur.clientHeight && cur.scrollWidth <= cur.clientWidth) {
          cur = cur.assignedSlot || cur.parentNode
          continue
        }
        let rect = cur.getBoundingClientRect()
        ;({scaleX, scaleY} = getScale(cur, rect))
        // Make sure scrollbar width isn't included in the rectangle
        bounding = {left: rect.left, right: rect.left + cur.clientWidth * scaleX,
                    top: rect.top, bottom: rect.top + cur.clientHeight * scaleY}
      }

      let moveX = 0, moveY = 0
      if (y == "nearest") {
        if (rect.top < bounding.top + yMargin) {
          moveY = rect.top - (bounding.top + yMargin)
          if (side > 0 && rect.bottom > bounding.bottom + moveY)
            moveY = rect.bottom - bounding.bottom + yMargin
        } else if (rect.bottom > bounding.bottom - yMargin) {
          moveY = rect.bottom - bounding.bottom + yMargin
          if (side < 0 && (rect.top - moveY) < bounding.top)
            moveY = rect.top - (bounding.top + yMargin)
        }
      } else {
        let rectHeight = rect.bottom - rect.top, boundingHeight = bounding.bottom - bounding.top
        let targetTop =
          y == "center" && rectHeight <= boundingHeight ? rect.top + rectHeight / 2 - boundingHeight / 2 :
          y == "start" || y == "center" && side < 0 ? rect.top - yMargin :
          rect.bottom - boundingHeight + yMargin
        moveY = targetTop - bounding.top
      }
      if (x == "nearest") {
        if (rect.left < bounding.left + xMargin) {
          moveX = rect.left - (bounding.left + xMargin)
          if (side > 0 && rect.right > bounding.right + moveX)
            moveX = rect.right - bounding.right + xMargin
        } else if (rect.right > bounding.right - xMargin) {
          moveX = rect.right - bounding.right + xMargin
          if (side < 0 && rect.left < bounding.left + moveX)
            moveX = rect.left - (bounding.left + xMargin)
        }
      } else {
        let targetLeft =
          x == "center" ? rect.left + (rect.right - rect.left) / 2 - (bounding.right - bounding.left) / 2 :
          (x == "start") == ltr ? rect.left - xMargin :
          rect.right - (bounding.right - bounding.left) + xMargin
        moveX = targetLeft - bounding.left
      }
      if (moveX || moveY) {
        if (top) {
          win.scrollBy(moveX, moveY)
        } else {
          let movedX = 0, movedY = 0
          if (moveY) {
            let start = cur.scrollTop
            cur.scrollTop += moveY / scaleY
            movedY = (cur.scrollTop - start) * scaleY
          }
          if (moveX) {
            let start = cur.scrollLeft
            cur.scrollLeft += moveX / scaleX
            movedX = (cur.scrollLeft - start) * scaleX
          }
          rect = {left: rect.left - movedX, top: rect.top - movedY,
                  right: rect.right - movedX, bottom: rect.bottom - movedY} as ClientRect
          if (movedX && Math.abs(movedX - moveX) < 1) x = "nearest"
          if (movedY && Math.abs(movedY - moveY) < 1) y = "nearest"
        }
      }
      if (top) break
      if (rect.top < bounding.top || rect.bottom > bounding.bottom ||
          rect.left < bounding.left || rect.right > bounding.right)
        rect = {left: Math.max(rect.left, bounding.left), right: Math.min(rect.right, bounding.right),
                top: Math.max(rect.top, bounding.top), bottom: Math.min(rect.bottom, bounding.bottom)}
      cur = cur.assignedSlot || cur.parentNode
    } else if (cur.nodeType == 11) { // A shadow root
      cur = cur.host
    } else {
      break
    }
  }
}

export function scrollableParents(dom: HTMLElement, getX = true) {
  let doc = dom.ownerDocument, x: HTMLElement | null = null, y: HTMLElement | null = null
  for (let cur = dom.parentNode as HTMLElement | null; cur;) {
    if (cur == doc.body || ((!getX || x) && y)) {
      break
    } else if (cur.nodeType == 1) {
      if (!y && cur.scrollHeight > cur.clientHeight) y = cur
      if (getX && !x && cur.scrollWidth > cur.clientWidth) x = cur
      cur = cur.assignedSlot || cur.parentNode as HTMLElement | null
    } else if (cur.nodeType == 11) {
      cur = (cur as any).host
    } else {
      break
    }
  }
  return {x, y}
}

export interface SelectionRange {
  focusNode: Node | null, focusOffset: number,
  anchorNode: Node | null, anchorOffset: number
}

export class DOMSelectionState implements SelectionRange {
  anchorNode: Node | null = null
  anchorOffset: number = 0
  focusNode: Node | null = null
  focusOffset: number = 0

  eq(domSel: SelectionRange): boolean {
    return this.anchorNode == domSel.anchorNode && this.anchorOffset == domSel.anchorOffset &&
      this.focusNode == domSel.focusNode && this.focusOffset == domSel.focusOffset
  }

  setRange(range: SelectionRange) {
    let {anchorNode, focusNode} = range
    // Clip offsets to node size to avoid crashes when Safari reports bogus offsets (#1152)
    this.set(anchorNode, Math.min(range.anchorOffset, anchorNode ? maxOffset(anchorNode) : 0),
             focusNode, Math.min(range.focusOffset, focusNode ? maxOffset(focusNode) : 0))
  }

  set(anchorNode: Node | null, anchorOffset: number, focusNode: Node | null, focusOffset: number) {
    this.anchorNode = anchorNode; this.anchorOffset = anchorOffset
    this.focusNode = focusNode; this.focusOffset = focusOffset
  }
}

export function getScrollStack(target: Element | null) {
  let stack: {node: Element, left: number, top: number}[] = []
  for (let cur: Node | null = target; cur; cur = cur.nodeType == 11 ? (cur as ShadowRoot).host : cur.parentNode) {
    if (cur.nodeType == 1)
      stack.push({node: cur as Element, left: (cur as Element).scrollLeft, top: (cur as Element).scrollTop})
  }
  return stack
}

export function restoreScrollStack(stack: {node: Element, left: number, top: number}[], vert = true) {
  for (let {node, left, top} of stack) {
    if (vert && node.scrollTop != top) node.scrollTop = top
    if (node.scrollLeft != left) node.scrollLeft = left
  }
}

let preventScrollSupported: null | false | {preventScroll: boolean} = null
// Safari 26 breaks preventScroll support
if (browser.safari && browser.safari_version >= 26) preventScrollSupported = false
// Feature-detects support for .focus({preventScroll: true}), and uses
// a fallback kludge when not supported.
export function focusPreventScroll(dom: HTMLElement) {
  if ((dom as any).setActive) return (dom as any).setActive() // in IE
  if (preventScrollSupported) return dom.focus(preventScrollSupported)

  let stack = getScrollStack(dom)
  dom.focus(preventScrollSupported == null ? {
    get preventScroll() {
      preventScrollSupported = {preventScroll: true}
      return true
    }
  } : undefined)
  if (!preventScrollSupported) {
    preventScrollSupported = false
    restoreScrollStack(stack)
  }
}

let scratchRange: Range | null

export function textRange(node: Text, from: number, to = from) {
  let range = scratchRange || (scratchRange = document.createRange())
  range.setEnd(node, to)
  range.setStart(node, from)
  return range
}

export function dispatchKey(
  elt: HTMLElement, name: string, code: number,
  mods?: {ctrlKey: boolean, altKey: boolean, shiftKey: boolean, metaKey: boolean}
): boolean {
  let options: KeyboardEventInit = {key: name, code: name, keyCode: code, which: code, cancelable: true}
  if (mods)
    ({altKey: options.altKey, ctrlKey: options.ctrlKey, shiftKey: options.shiftKey, metaKey: options.metaKey} = mods)
  let down = new KeyboardEvent("keydown", options)
  ;(down as any).synthetic = true
  elt.dispatchEvent(down)
  let up = new KeyboardEvent("keyup", options)
  ;(up as any).synthetic = true
  elt.dispatchEvent(up)
  return down.defaultPrevented || up.defaultPrevented
}

export function getRoot(node: Node | null | undefined): DocumentOrShadowRoot | null {
  while (node) {
    if (node && (node.nodeType == 9 || node.nodeType == 11 && (node as ShadowRoot).host))
      return node as unknown as DocumentOrShadowRoot
    node = (node as HTMLElement).assignedSlot || node.parentNode
  }
  return null
}

export function clearAttributes(node: HTMLElement) {
  while (node.attributes.length) node.removeAttributeNode(node.attributes[0])
}

export function atElementStart(doc: HTMLElement, selection: SelectionRange) {
  let node = selection.focusNode, offset = selection.focusOffset
  if (!node || selection.anchorNode != node || selection.anchorOffset != offset) return false
  // Safari can report bogus offsets (#1152)
  offset = Math.min(offset, maxOffset(node))
  for (;;) {
    if (offset) {
      if (node.nodeType != 1) return false
      let prev: Node = node.childNodes[offset - 1]
      if ((prev as HTMLElement).contentEditable == "false") offset--
      else { node = prev; offset = maxOffset(node) }
    } else if (node == doc) {
      return true
    } else {
      offset = domIndex(node)
      node = node.parentNode!
    }
  }
}

export function isScrolledToBottom(elt: HTMLElement | Window) {
  if (elt instanceof Window) return elt.pageYOffset > Math.max(0, elt.document.documentElement.scrollHeight - elt.innerHeight - 4)
  return elt.scrollTop > Math.max(1, elt.scrollHeight - elt.clientHeight - 4)
}

export function textNodeBefore(startNode: Node, startOffset: number): {node: Text, offset: number} | null {
  for (let node = startNode, offset = startOffset;;) {
    if (node.nodeType == 3 && offset > 0) {
      return {node: node as Text, offset: offset}
    } else if (node.nodeType == 1 && offset > 0) {
      if ((node as HTMLElement).contentEditable == "false") return null
      node = node.childNodes[offset - 1]
      offset = maxOffset(node)
    } else if (node.parentNode && !isBlockElement(node)) {
      offset = domIndex(node)
      node = node.parentNode
    } else {
      return null
    }
  }
}

export function textNodeAfter(startNode: Node, startOffset: number): {node: Text, offset: number} | null {
  for (let node = startNode, offset = startOffset;;) {
    if (node.nodeType == 3 && offset < node.nodeValue!.length) {
      return {node: node as Text, offset: offset}
    } else if (node.nodeType == 1 && offset < node.childNodes.length) {
      if ((node as HTMLElement).contentEditable == "false") return null
      node = node.childNodes[offset]
      offset = 0
    } else if (node.parentNode && !isBlockElement(node)) {
      offset = domIndex(node) + 1
      node = node.parentNode
    } else {
      return null
    }
  }
}

export class DOMPos {
  constructor(readonly node: Node, readonly offset: number, readonly precise = true) {}

  static before(dom: Node, precise?: boolean) { return new DOMPos(dom.parentNode!, domIndex(dom), precise) }
  static after(dom: Node, precise?: boolean) { return new DOMPos(dom.parentNode!, domIndex(dom) + 1, precise) }
}
