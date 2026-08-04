import type * as lsp from "vscode-languageserver-protocol"
import {forEachDiagnostic, setDiagnostics} from "@codemirror/lint"
import type {Diagnostic} from "@codemirror/lint"
import {ViewPlugin, ViewUpdate} from "@codemirror/view"
import {LSPPlugin} from "./plugin"
import type {LSPClient, LSPClientExtension} from "./client"

function toSeverity(sev: lsp.DiagnosticSeverity): Diagnostic["severity"] {
  return sev == 1 ? "error" : sev == 2 ? "warning" : sev == 3 ? "info" : "hint"
}

const diagnosticClient = Symbol("lspDiagnosticClient")
type ClientDiagnostic = Diagnostic & {[diagnosticClient]?: LSPClient}

const autoSync = ViewPlugin.fromClass(class {
  pending: ReturnType<typeof setTimeout> | null = null
  update(update: ViewUpdate) {
    if (update.docChanged) {
      if (this.pending != null) clearTimeout(this.pending)
      this.pending = setTimeout(() => {
        this.pending = null
        LSPPlugin.syncAll(update.view)
      }, 500)
    }
  }
  destroy() {
    if (this.pending != null) clearTimeout(this.pending)
  }
})

export function serverDiagnostics(): LSPClientExtension {
  return {
    clientCapabilities: {textDocument: {publishDiagnostics: {versionSupport: true}}},
    notificationHandlers: {
      "textDocument/publishDiagnostics": (client, params: lsp.PublishDiagnosticsParams) => {
        let file = client.workspace.getFile(params.uri)
        if (!file || params.version != null && params.version != file.version) return false
        const view = file.getView(), plugin = view && LSPPlugin.get(view, client)
        if (!view || !plugin) return false
        // The lint package already maps stored diagnostics through editor
        // changes. Preserve those current positions for every other provider
        // and replace only this client's contribution.
        const diagnostics: ClientDiagnostic[] = []
        forEachDiagnostic(view.state, (item: ClientDiagnostic, from, to) => {
          if (item[diagnosticClient] !== client) diagnostics.push({...item, from, to})
        })
        diagnostics.push(...params.diagnostics.map(item => ({
          from: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.start, plugin.syncedDoc)),
          to: plugin.unsyncedChanges.mapPos(plugin.fromPosition(item.range.end, plugin.syncedDoc)),
          severity: toSeverity(item.severity ?? 1),
          message: item.message,
          [diagnosticClient]: client
        })))
        view.dispatch(setDiagnostics(view.state, diagnostics))
        return true
      }
    },
    editorExtension: autoSync
  }
}
