import type * as lsp from "vscode-languageserver-protocol"
import {EditorView, Command, KeyBinding, showDialog, getDialog} from "@codemirror/view"
import {LSPPlugin} from "./plugin"

function getRename(plugin: LSPPlugin, pos: number, newName: string) {
  return plugin.client.request<lsp.RenameParams, lsp.WorkspaceEdit | null>("textDocument/rename", {
    newName,
    position: plugin.toPosition(pos),
    textDocument: {uri: plugin.uri},
  })
}

/// This command will, if the cursor is over a word, prompt the user
/// for a new name for that symbol, and ask the language server to
/// perform a rename of that symbol.
///
/// Note that this may affect files other than the one loaded into
/// this view. See the
/// [`Workspace.updateFile`](#lsp-client.Workspace.updateFile)
/// method.
export const renameSymbol: Command = view => {
  let wordRange = view.state.wordAt(view.state.selection.main.head)
  let plugin = LSPPlugin.getAll(view, "rename")
    .find(plugin => plugin.client.hasCapability("renameProvider") !== false)
  if (!wordRange || !plugin || plugin.client.hasCapability("renameProvider") === false) return false
  const word = view.state.sliceDoc(wordRange.from, wordRange.to)
  let panel = getDialog(view, "cm-lsp-rename-panel")
  if (panel) {
    let input = panel.dom.querySelector("[name=name]") as HTMLInputElement
    input.value = word
    input.select()
  } else {
    let {close, result} = showDialog(view, {
      label: view.state.phrase("New name"),
      input: {name: "name", value: word},
      focus: true,
      submitLabel: view.state.phrase("rename"),
      class: "cm-lsp-rename-panel",
    })
    result.then(form => {
      view.dispatch({effects: close})
      if (form) doRename(view, (form.elements.namedItem("name") as HTMLInputElement).value)
    })
  }
  return true
}

function doRename(view: EditorView, newName: string) {
  const plugin = LSPPlugin.getAll(view, "rename")
    .find(plugin => plugin.client.hasCapability("renameProvider") !== false)
  const word = view.state.wordAt(view.state.selection.main.head)
  if (!plugin || !word) return false

  plugin.client.sync()
  plugin.client.withMapping(mapping => getRename(plugin, word.from, newName).then(response => {
    if (!response) return
    uris: for (let uri in response.changes) {
      let lspChanges = response.changes[uri], file = plugin.client.workspace.getFile(uri)
      if (!lspChanges.length || !file) continue
      plugin.client.workspace.updateFile(uri, {
        changes: lspChanges.map(change => ({
          from: mapping.mapPosition(uri, change.range.start),
          to: mapping.mapPosition(uri, change.range.end),
          insert: change.newText
        })),
        userEvent: "rename"
      })
    }
  }, err => {
    plugin.reportError("Rename request failed", err)
  }))
}

/// A keymap that binds F2 to [`renameSymbol`](#lsp-client.renameSymbol).
export const renameKeymap: readonly KeyBinding[] = [
  {key: "F2", run: renameSymbol, preventDefault: true}
]
