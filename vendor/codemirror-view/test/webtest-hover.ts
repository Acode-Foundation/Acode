import {EditorState} from "@codemirror/state"
import {EditorView, hoverTooltip} from "@codemirror/view"
import ist from "ist"

async function waitForSuccess(assert: () => void) {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 50))
    try {
      assert()
      return
    }
    catch {
    }
  }
  // final try
  assert()
}

function setupHover(...tooltips: Array<string|{text: string, start: number, end: number, destroy?: () => void}>) {
  const testText = "test"
  const hoverTooltips = tooltips.map(x => {
    const {text, start, end, destroy} = typeof x === "string"
      ? {text: x, start: 0, end: testText.length - 1, destroy: undefined}
      : x

    return hoverTooltip((_, pos) => {
      if (pos < start || pos > end) return null

      return {pos, create: () => {
        const dom = document.createElement("div")
        dom.innerText = text
        return {dom, destroy}
      }}
    }, {hoverTime: 10})
  })
  const root = document.body.querySelector("#workspace")!
  return new EditorView({state: EditorState.create({doc: testText, extensions: hoverTooltips}), parent: root})
}

function mouseMove(view: EditorView, pos = 0) {
  const line = view.dom.querySelector(".cm-line")!
  const {top, left} = view.coordsAtPos(pos)!
  line.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: left + 1, clientY: top + 1}))
}

function expectTooltip(view: EditorView, html: string) {
  return waitForSuccess(() => {
    const tooltip = view.dom.querySelector(".cm-tooltip")!
    ist(tooltip)
    ist(tooltip.classList.contains("cm-tooltip"))
    ist(tooltip.classList.contains("cm-tooltip-hover"))
    ist(tooltip.innerHTML, html)
  })
}

describe("hoverTooltip", () => {
  it("renders one tooltip view in container", async () => {
    let view = setupHover("test")
    mouseMove(view)
    await expectTooltip(view, '<div class="cm-tooltip-section">test</div>')
    view.destroy()
  }),

  it("renders two tooltip views in container", async () => {
    let view = setupHover("test1", "test2")
    mouseMove(view)
    await expectTooltip(view, '<div class="cm-tooltip-section">test1</div>' +
      '<div class="cm-tooltip-section">test2</div>')
    view.destroy()
  })

  it("adds tooltip view if mouse moves into the range", async () => {
    let view = setupHover(
      {text: "add", start: 2, end: 4},
      {text: "keep", start: 0, end: 4}
    )
    mouseMove(view, 0)
    await expectTooltip(view, '<div class="cm-tooltip-section">keep</div>')
    mouseMove(view, 3)
    await expectTooltip(view, '<div class="cm-tooltip-section">add</div>'
      + '<div class="cm-tooltip-section">keep</div>')
    view.destroy()
  })

  it("removes tooltip view if mouse moves outside of the range", async () => {
    let destroyed = false
    let view = setupHover(
      {text: "remove", start: 0, end: 2, destroy: () => destroyed = true},
      {text: "keep", start: 0, end: 4}
    )
    mouseMove(view, 0)
    await expectTooltip(view, '<div class="cm-tooltip-section">remove</div>' +
      '<div class="cm-tooltip-section">keep</div>')
    mouseMove(view, 3)
    await expectTooltip(view, '<div class="cm-tooltip-section">keep</div>')
    ist(destroyed, true)
    view.destroy()
  })
})
