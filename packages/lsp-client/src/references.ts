import type * as lsp from "vscode-languageserver-protocol"
import {Command, KeyBinding, showPanel, PanelConstructor, EditorView} from "@codemirror/view"
import {StateField, StateEffect} from "@codemirror/state"
import {LSPPlugin} from "./plugin"
import {WorkspaceFile} from "./workspace"
import {WorkspaceMapping} from "./client"
import type {LSPClient} from "./client"

function getReferences(plugin: LSPPlugin, pos: number) {
  return plugin.client.request<lsp.ReferenceParams, lsp.Location[] | null>("textDocument/references", {
    textDocument: {uri: plugin.uri},
    position: plugin.toPosition(pos),
    context: {includeDeclaration: true}
  })
}

type ReferenceLocation = {file: WorkspaceFile, range: lsp.Range}

/// Ask the server to locate all references to the symbol at the
/// cursor. When the server can provide such references, show them as
/// a list in a panel.
export const findReferences: Command = view => {
  const plugin = LSPPlugin.getAll(view, "references")
    .find(plugin => plugin.client.hasCapability("referencesProvider") !== false)
  if (!plugin || plugin.client.hasCapability("referencesProvider") === false) return false
  plugin.client.sync()
  let mapping = plugin.client.workspaceMapping(), passedMapping = false
  getReferences(plugin, view.state.selection.main.head).then(response => {
    if (!response) return
    return Promise.all(response.map(loc => plugin.client.workspace.requestFile(loc.uri).then(file => {
      return file ? {file, range: loc.range} : null
    }))).then(resolved => {
      let locs = resolved.filter(l => l) as ReferenceLocation[]
      if (locs.length) {
        displayReferences(plugin.view, locs, mapping, plugin.client)
        passedMapping = true
      }
    })
  }, err => plugin.reportError("Finding references failed", err)).finally(() => {
    if (!passedMapping) mapping.destroy()
  })
  return true
}

/// Close the reference panel, if it is open.
export const closeReferencePanel: Command = view => {
  if (!view.state.field(referencePanel, false)) return false
  view.dispatch({effects: setReferencePanel.of(null)})
  return true
}

const referencePanel = StateField.define<PanelConstructor | null>({
  create() { return null },

  update(panel, tr) {
    for (let e of tr.effects) if (e.is(setReferencePanel)) return e.value
    return panel
  },

  provide: f => showPanel.from(f)
})

const setReferencePanel = StateEffect.define<PanelConstructor | null>()

function displayReferences(view: EditorView, locs: readonly ReferenceLocation[], mapping: WorkspaceMapping, client: LSPClient) {
  let panel = createReferencePanel(locs, mapping, client)
  let effect = view.state.field(referencePanel, false) === undefined
    ? StateEffect.appendConfig.of(referencePanel.init(() => panel))
    : setReferencePanel.of(panel)
  view.dispatch({effects: effect})
}

function createReferencePanel(locs: readonly ReferenceLocation[], mapping: WorkspaceMapping, client: LSPClient): PanelConstructor {
  let created = false
  // Make sure that if this panel isn't used, the mapping still gets destroyed
  setTimeout(() => {if (!created) mapping.destroy()}, 500)

  return view => {
    created = true
    let prefixLen = findCommonPrefix(locs.map(l => l.file.uri))
    let panel = document.createElement("div"), curFile = null
    panel.className = "cm-lsp-reference-panel"
    panel.tabIndex = 0
    panel.role = "listbox"
    panel.setAttribute("aria-label", view.state.phrase("Reference list"))
    let options: HTMLElement[] = []
    for (let {file, range} of locs) {
      let fileName = file.uri.slice(prefixLen)
      if (fileName != curFile) {
        curFile = fileName
        let header = panel.appendChild(document.createElement("div"))
        header.className = "cm-lsp-reference-file"
        header.textContent = fileName
      }
      let entry = panel.appendChild(document.createElement("div"))
      entry.className = "cm-lsp-reference"
      entry.role = "option"
      let from = mapping.mapPosition(file.uri, range.start, 1), to = mapping.mapPosition(file.uri, range.end, -1)
      let view = file.getView(), line = (view ? view.state.doc : file.doc).lineAt(from)
      let lineNumber = entry.appendChild(document.createElement("span"))
      lineNumber.className = "cm-lsp-reference-line"
      lineNumber.textContent = (line.number + ": ").padStart(5, " ")
      let textBefore = line.text.slice(Math.max(0, from - line.from - 50), from - line.from)
      if (textBefore) entry.appendChild(document.createTextNode(textBefore))
      entry.appendChild(document.createElement("strong")).textContent = line.text.slice(from - line.from, to - line.from)
      let textAfter = line.text.slice(to - line.from, Math.min(line.length, 100 - textBefore.length))
      if (textAfter) entry.appendChild(document.createTextNode(textAfter))
      if (!options.length) entry.setAttribute("aria-selected", "true")
      options.push(entry)
    }

    function curSelection() {
      for (let i = 0; i < options.length; i++) {
        if (options[i].hasAttribute("aria-selected")) return i
      }
      return 0
    }
    function setSelection(index: number) {
      for (let i = 0; i < options.length; i++) {
        if (i == index) options[i].setAttribute("aria-selected", "true")
        else options[i].removeAttribute("aria-selected")
      }
    }
    function showReference(index: number) {
      let {file, range} = locs[index]
      let plugin = LSPPlugin.get(view, client)
      if (!plugin) return
      Promise.resolve(file.uri == plugin.uri ? view : plugin.client.workspace.displayFile(file.uri)).then(view => {
        if (!view) return
        let pos = mapping.mapPosition(file.uri, range.start, 1)
        view.focus()
        view.dispatch({
          selection: {anchor: pos},
          scrollIntoView: true
        })
      })
    }

    panel.addEventListener("keydown", event => {
      if (event.keyCode == 27) { // Escape
        closeReferencePanel(view)
        view.focus()
      } else if (event.keyCode == 38 || event.keyCode == 33) { // ArrowUp, PageUp
        setSelection((curSelection() - 1 + locs.length) % locs.length)
      } else if (event.keyCode == 40 || event.keyCode == 34) { // ArrowDown, PageDown
        setSelection((curSelection() + 1) % locs.length)
      } else if (event.keyCode == 36) { // Home
        setSelection(0)
      } else if (event.keyCode == 35) { // End
        setSelection(options.length - 1)
      } else if (event.keyCode == 13 || event.keyCode == 10) { // Enter, Space
        showReference(curSelection())
      } else {
        return
      }
      event.preventDefault()
    })
    panel.addEventListener("click", event => {
      for (let i = 0; i < options.length; i++) {
        if (options[i].contains(event.target as HTMLElement)) {
          setSelection(i)
          showReference(i)
          event.preventDefault()
        }
      }
    })
    let dom = document.createElement("div")
    dom.appendChild(panel)
    let close = dom.appendChild(document.createElement("button"))
    close.className = "cm-dialog-close"
    close.textContent = "×"
    close.addEventListener("click", () => closeReferencePanel(view))
    close.setAttribute("aria-label", view.state.phrase("close"))

    return {
      dom,
      destroy: () => mapping.destroy(),
      mount: () => panel.focus(),
    }
  }
}

function findCommonPrefix(uris: string[]) {
  let first = uris[0], prefix = first.length
  for (let i = 1; i < uris.length; i++) {
    let uri = uris[i], j = 0
    for (let e = Math.min(prefix, uri.length); j < e && first[j] == uri[j]; j++) {}
    prefix = j
  }
  while (prefix && first[prefix - 1] != "/") prefix--
  return prefix
}

/// Binds Shift-F12 to [`findReferences`](#lsp-client.findReferences)
/// and Escape to
/// [`closeReferencePanel`](#lsp-client.closeReferencePanel).
export const findReferencesKeymap: readonly KeyBinding[] = [
  {key: "Shift-F12", run: findReferences, preventDefault: true},
  {key: "Escape", run: closeReferencePanel},
]
