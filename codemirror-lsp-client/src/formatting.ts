import type * as lsp from "vscode-languageserver-protocol"
import {Command, KeyBinding} from "@codemirror/view"
import {ChangeSpec} from "@codemirror/state"
import {indentUnit, getIndentUnit} from "@codemirror/language"
import {LSPPlugin} from "./plugin"

function getFormatting(plugin: LSPPlugin, options: lsp.FormattingOptions) {
  return plugin.client.request<lsp.DocumentFormattingParams, lsp.TextEdit[] | null>("textDocument/formatting", {
    options,
    textDocument: {uri: plugin.uri},
  })
}

/// This command asks the language server to reformat the document,
/// and then applies the changes it returns.
export const formatDocument: Command = view => {
  const plugin = LSPPlugin.getAll(view, "formatting")
    .find(plugin => plugin.client.hasCapability("documentFormattingProvider") !== false)
  if (!plugin) return false
  plugin.client.sync()
  plugin.client.withMapping(mapping => getFormatting(plugin, {
    tabSize: getIndentUnit(view.state),
    insertSpaces: view.state.facet(indentUnit).indexOf("\t") < 0,
  }).then(response => {
    if (!response) return
    let changed = mapping.getMapping(plugin.uri)
    let changes: ChangeSpec[] = []
    for (let change of response) {
      let from = mapping.mapPosition(plugin.uri, change.range.start)
      let to = mapping.mapPosition(plugin.uri, change.range.end)
      if (changed) {
        // Don't try to apply the changes if code inside of any of them was touched
        if (changed.touchesRange(from, to)) return
        from = changed.mapPos(from, 1)
        to = changed.mapPos(to, -1)
      }
      changes.push({from, to, insert: change.newText})
    }
    view.dispatch({
      changes,
      userEvent: "format"
    })
  }, err => {
    plugin.reportError("Formatting request failed", err)
  }))
  return true
}

/// A keymap that binds Shift-Alt-f to
/// [`formatDocument`](#lsp-client.formatDocument).
export const formatKeymap: readonly KeyBinding[] = [
  {key: "Shift-Alt-f", run: formatDocument, preventDefault: true}
]
