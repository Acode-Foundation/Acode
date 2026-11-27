import type * as lsp from "vscode-languageserver-protocol"
import {EditorView, ViewPlugin, ViewUpdate, showDialog} from "@codemirror/view"
import {ChangeSet, Text, Extension, Facet} from "@codemirror/state"
import {language} from "@codemirror/language"
import {type LSPClient} from "./client"
import {docToHTML, withContext} from "./text"
import {toPosition, fromPosition} from "./pos"

/// Features that can be independently enabled or disabled for an editor
/// binding. This lets a supplemental server contribute completions and
/// diagnostics without becoming the formatter or rename provider.
export type LSPFeature =
  | "completion"
  | "hover"
  | "signatureHelp"
  | "diagnostics"
  | "formatting"
  | "rename"
  | "definition"
  | "declaration"
  | "typeDefinition"
  | "implementation"
  | "references"
  | "codeAction"
  | "documentSymbol"
  | "inlayHint"
  | "documentColor"

/// Options controlling a client's role when several clients are attached to
/// the same editor.
export type LSPPluginOptions = {
  /// Higher-priority clients are considered first for single-owner features.
  priority?: number
  /// Features default to enabled. Set a feature to false to exclude this
  /// client from that feature's provider set.
  features?: Partial<Record<LSPFeature, boolean>>
}

type LSPPluginSpec = {
  client: LSPClient
  uri: string
  languageID?: string
  options?: LSPPluginOptions
}

type ChangeEntry = {
  revision: number
  changes: ChangeSet
}

const lspBindings = Facet.define<LSPPluginSpec, readonly LSPPluginSpec[]>({
  combine: values => values
})

class LSPViewPlugin {
  private revision = 0
  private changes: ChangeEntry[] = []
  private plugins: LSPPlugin[] = []

  constructor(readonly view: EditorView) {
    this.configure(view.state.facet(lspBindings))
  }

  update(update: ViewUpdate) {
    // Record each editor transaction once, regardless of how many language
    // servers are attached. Per-client ChangeSets are composed lazily at sync.
    if (update.docChanged) {
      this.revision++
      this.changes.push({revision: this.revision, changes: update.changes})
    }
    const before = update.startState.facet(lspBindings)
    const after = update.state.facet(lspBindings)
    if (before !== after) this.configure(after)
  }

  destroy() {
    for (const plugin of this.plugins) plugin.destroy()
    this.plugins = []
    this.changes = []
  }

  get(client?: LSPClient): LSPPlugin | null {
    if (!client) return this.plugins[0] || null
    return this.plugins.find(plugin => plugin.client === client) || null
  }

  getAll(feature?: LSPFeature): readonly LSPPlugin[] {
    return feature
      ? this.plugins.filter(plugin => plugin.featureEnabled(feature))
      : this.plugins
  }

  pendingChanges(plugin: LSPPlugin): ChangeSet {
    let result = ChangeSet.empty(plugin.syncedDoc.length)
    for (const entry of this.changes) {
      if (entry.revision > plugin.syncedRevision)
        result = result.compose(entry.changes)
    }
    return result
  }

  clear(plugin: LSPPlugin) {
    plugin.syncedDoc = this.view.state.doc
    plugin.syncedRevision = this.revision
    this.pruneChanges()
  }

  private configure(specs: readonly LSPPluginSpec[]) {
    const unique: LSPPluginSpec[] = []
    for (const spec of specs) {
      if (!unique.some(other => other.client === spec.client)) unique.push(spec)
    }

    const remaining = new Set(this.plugins)
    const next: {plugin: LSPPlugin, order: number}[] = []
    for (let order = 0; order < unique.length; order++) {
      const spec = unique[order]
      let plugin = this.plugins.find(candidate =>
        candidate.client === spec.client &&
        candidate.uri === spec.uri &&
        candidate.languageID === spec.languageID)
      if (plugin) {
        remaining.delete(plugin)
        plugin.setOptions(spec.options)
      } else {
        plugin = new LSPPlugin(this.view, spec, this, this.revision)
      }
      next.push({plugin, order})
    }
    for (const plugin of remaining) plugin.destroy()
    next.sort((a, b) => b.plugin.priority - a.plugin.priority || a.order - b.order)
    this.plugins = next.map(item => item.plugin)
    this.pruneChanges()
  }

  private pruneChanges() {
    if (!this.plugins.length) {
      this.changes = []
      return
    }
    let earliest = this.plugins[0].syncedRevision
    for (let i = 1; i < this.plugins.length; i++)
      earliest = Math.min(earliest, this.plugins[i].syncedRevision)
    let drop = 0
    while (drop < this.changes.length && this.changes[drop].revision <= earliest) drop++
    if (drop) this.changes.splice(0, drop)
  }
}

/// A binding between one editor and one language server client.
export class LSPPlugin {
  /// The client connection.
  client: LSPClient
  /// The URI of this file.
  uri: string
  /// The language identifier sent to this client.
  languageID: string
  /// The version of the document that was synchronized to the server.
  syncedDoc: Text
  /// @internal
  syncedRevision: number
  private options: LSPPluginOptions

  /// @internal
  constructor(
    readonly view: EditorView,
    {client, uri, languageID, options}: LSPPluginSpec,
    private owner: LSPViewPlugin,
    revision: number
  ) {
    this.client = client
    this.uri = uri
    if (!languageID) {
      const lang = view.state.facet(language)
      languageID = lang ? lang.name : ""
    }
    this.languageID = languageID
    this.options = options || {}
    this.syncedDoc = view.state.doc
    this.syncedRevision = revision
    client.workspace.openFile(uri, languageID, view)
  }

  /// Priority used when a feature needs a single owning client.
  get priority() { return this.options.priority ?? 0 }

  /// Whether this binding is eligible to provide a feature.
  featureEnabled(feature: LSPFeature) {
    return this.options.features?.[feature] !== false
  }

  /// @internal
  setOptions(options?: LSPPluginOptions) {
    this.options = options || {}
  }

  /// Render a doc string from the server to HTML.
  docToHTML(value: string | lsp.MarkupContent, defaultKind: lsp.MarkupKind = "plaintext") {
    const html = withContext(this.view, this.client.config.highlightLanguage, () => docToHTML(value, defaultKind))
    return this.client.config.sanitizeHTML ? this.client.config.sanitizeHTML(html) : html
  }

  /// Convert a document offset into an LSP position.
  toPosition(pos: number, doc: Text = this.view.state.doc) {
    return toPosition(doc, pos)
  }

  /// Convert an LSP position into a document offset.
  fromPosition(pos: lsp.Position, doc: Text = this.view.state.doc) {
    return fromPosition(doc, pos)
  }

  /// Display an error in this plugin's editor.
  reportError(message: string, err: any) {
    showDialog(this.view, {
      label: this.view.state.phrase(message) + ": " + (err.message || err),
      class: "cm-lsp-message cm-lsp-message-error",
      top: true
    })
  }

  /// Changes since this client last synchronized. They are composed lazily so
  /// typing cost does not scale with the number of attached clients.
  get unsyncedChanges(): ChangeSet {
    return this.owner.pendingChanges(this)
  }

  /// Mark this client's current pending changes as synchronized.
  clear() {
    this.owner.clear(this)
  }

  /// @internal
  destroy() {
    this.client.workspace.closeFile(this.uri, this.view)
  }

  /// Get the primary plugin, or the plugin for a specific client.
  static get(view: EditorView, client?: LSPClient) {
    return view.plugin(lspPlugin)?.get(client) || null
  }

  /// Get all plugins, ordered by descending priority.
  static getAll(view: EditorView, feature?: LSPFeature) {
    return view.plugin(lspPlugin)?.getAll(feature) || []
  }

  /// Get the first plugin eligible for a feature.
  static getForFeature(view: EditorView, feature: LSPFeature) {
    return this.getAll(view, feature)[0] || null
  }

  /// Synchronize all attached clients. Each client independently decides
  /// whether it has pending document changes.
  static syncAll(view: EditorView) {
    for (const plugin of this.getAll(view)) plugin.client.sync()
  }

  /// Deprecated. Use `LSPClient.plugin` instead.
  static create(client: LSPClient, fileURI: string, languageID?: string, options?: LSPPluginOptions): Extension {
    return client.plugin(fileURI, languageID, options)
  }
}

export const lspPlugin = ViewPlugin.fromClass(LSPViewPlugin)

/// @internal
export function lspPluginBinding(spec: LSPPluginSpec): Extension {
  return [lspBindings.of(spec), lspPlugin]
}
