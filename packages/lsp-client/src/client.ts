import type * as lsp from "vscode-languageserver-protocol"
import {showDialog} from "@codemirror/view"
import {ChangeSet, ChangeDesc, MapMode, Text, Extension} from "@codemirror/state"
import {Language} from "@codemirror/language"
import {LSPPlugin, LSPPluginOptions, lspPluginBinding} from "./plugin"
import {toPosition, fromPosition} from "./pos"
import {Workspace, WorkspaceFile, DefaultWorkspace} from "./workspace"
import {lspTheme} from "./theme"

class Request<Result> {
  declare resolve: (result: Result) => void
  declare reject: (error: any) => void
  promise: Promise<Result>

  constructor(
    readonly id: number,
    readonly params: any,
    readonly timeout: ReturnType<typeof setTimeout>
  ) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

const clientCapabilities: lsp.ClientCapabilities = {
  general: {
    markdown: {
      parser: "marked",
    },
  },
  textDocument: {
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        insertReplaceSupport: false,
      },
      completionList: {
        itemDefaults: ["commitCharacters", "editRange", "insertTextFormat"]
      },
      completionItemKind: {valueSet: []},
      contextSupport: true,
    },
    hover: {
      contentFormat: ["markdown", "plaintext"]
    },
    formatting: {},
    rename: {},
    signatureHelp: {
      contextSupport: true,
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: {labelOffsetSupport: true},
        activeParameterSupport: true,
      },
    },
    definition: {},
    declaration: {},
    implementation: {},
    typeDefinition: {},
    references: {},
    diagnostic: {},
  },
  window: {
    showMessage: {}
  }
}

/// A workspace mapping is used to track changes made to open
/// documents, so that positions returned by a request can be
/// interpreted in terms of the current, potentially changed document.
export class WorkspaceMapping {
  /// @internal
  mappings: Map<string, ChangeDesc> = new Map
  private startDocs: Map<string, Text> = new Map

  /// @internal
  constructor(private client: LSPClient) {
    for (let file of client.workspace.files) {
      this.mappings.set(file.uri, ChangeSet.empty(file.doc.length))
      this.startDocs.set(file.uri, file.doc)
    }
  }

  /// @internal
  addChanges(uri: string, changes: ChangeDesc) {
    let known = this.mappings.get(uri)
    if (known) this.mappings.set(uri, known.composeDesc(changes))
  }

  /// Get the changes made to the document with the given URI since
  /// the mapping was created. Returns null for documents that aren't
  /// open.
  getMapping(uri: string) {
    let known = this.mappings.get(uri)
    if (!known) return null
    let file = this.client.workspace.getFile(uri), view = file?.getView(), plugin = view && LSPPlugin.get(view, this.client)
    return plugin ? known.composeDesc(plugin.unsyncedChanges) : known
  }

  /// Map a position in the given file forward to the current document state.
  mapPos(uri: string, pos: number, assoc?: number): number
  mapPos(uri: string, pos: number, assoc: number, mode: MapMode): number | null
  mapPos(uri: string, pos: number, assoc = -1, mode: MapMode = MapMode.Simple): number | null {
    let changes = this.getMapping(uri)
    return changes ? changes.mapPos(pos, assoc, mode) : pos
  }

  /// Convert an LSP-style position referring to a document at the
  /// time the mapping was created to an offset in the current document.
  mapPosition(uri: string, pos: lsp.Position, assoc?: number): number
  mapPosition(uri: string, pos: lsp.Position, assoc: number, mode: MapMode): number | null
  mapPosition(uri: string, pos: lsp.Position, assoc = -1, mode: MapMode = MapMode.Simple): number | null {
    let start = this.startDocs.get(uri)
    if (!start) throw new Error("Cannot map from a file that's not in the workspace")
    let off = fromPosition(start, pos)
    let changes = this.getMapping(uri)
    return changes ? changes.mapPos(off, assoc, mode) : off
  }

  /// Disconnect this mapping from the client so that it will no
  /// longer be notified of new changes. You must make sure to call
  /// this on every mapping you create, except when you use
  /// [`withMapping`](#lsp-client.LSPClient.withMapping), which will
  /// automatically schedule a disconnect when the given promise
  /// resolves or aborts.
  destroy() {
    this.client.activeMappings = this.client.activeMappings.filter(m => m != this)
  }
}

/// An object of this type should be used to wrap whatever transport
/// layer you use to talk to your language server. Messages should
/// contain only the JSON messages, no LSP headers.
export type Transport = {
  /// Send a message to the server. Should throw if the connection is
  /// broken somehow.
  send(message: string): void
  /// Register a handler for messages coming from the server.
  subscribe(handler: (value: string) => void): void
  /// Unregister a handler registered with `subscribe`.
  unsubscribe(handler: (value: string) => void): void
}

const defaultNotificationHandlers: {[method: string]: (client: LSPClient, params: any) => void} = {
  "window/logMessage": (client, params: lsp.LogMessageParams) => {
    if (params.type == 1) console.error("[lsp] " + params.message)
    else if (params.type == 2) console.warn("[lsp] " + params.message)
  },
  "window/showMessage": (client, params: lsp.ShowMessageParams) => {
    if (params.type > 3 /* Info */) return
    let view
    for (let f of client.workspace.files) if (view = f.getView()) break
    if (view) showDialog(view, {
      label: params.message,
      class: "cm-lsp-message cm-lsp-message-" + (params.type == 1 ? "error" : params.type == 2 ? "warning" : "info"),
      top: true
    })
  }
}

/// Configuration options that can be passed to the LSP client.
export type LSPClientConfig = {
  /// The project root URI passed to the server, when necessary.
  rootUri?: string
  /// An optional function to create a
  /// [workspace](#lsp-client.Workspace) object for the client to use.
  /// When not given, this will default to a simple workspace that
  /// only opens files that have an active editor, and only allows one
  /// editor per file.
  workspace?: (client: LSPClient) => Workspace
  /// The amount of milliseconds after which requests are
  /// automatically timed out. Defaults to 3000.
  timeout?: number
  /// LSP servers can send Markdown code, which the client must render
  /// and display as HTML. Markdown can contain arbitrary HTML and is
  /// thus a potential channel for cross-site scripting attacks, if
  /// someone is able to compromise your LSP server or your connection
  /// to it. You can pass an HTML sanitizer here to strip out
  /// suspicious HTML structure.
  sanitizeHTML?: (html: string) => string
  /// By default, the Markdown renderer will only be able to highlght
  /// code embedded in the Markdown text when its language tag matches
  /// the name of the language used by the editor. You can provide a
  /// function here that returns a CodeMirror language object for a
  /// given language tag to support more languages.
  highlightLanguage?: (name: string) => Language | null
  /// By default, the client will only handle the server notifications
  /// `window/logMessage` (logging warnings and errors to the console)
  /// and `window/showMessage`. You can pass additional handlers here.
  /// They will be tried before the built-in handlers, and override
  /// those when they return true.
  notificationHandlers?: {[method: string]: (client: LSPClient, params: any) => boolean}
  /// When no handler is found for a notification, it will be passed
  /// to this function, if given.
  unhandledNotification?: (client: LSPClient, method: string, params: any) => void
  /// Provide a set of extensions, which may be plain CodeMirror
  /// extensions, or objects containing additional client capabilities
  /// or notification handlers. Any CodeMirror extensions provided
  /// here will be included in the extension returned by
  /// [`LSPPlugin.create`](#lsp-client.LSPPlugin^create).
  extensions?: readonly (Extension | LSPClientExtension)[]
}

/// Objects of this type can be included in the
/// [`extensions`](#lsp-client.LSPClientConfig.extensions) option to
/// `LSPClient` to modularly configure client capabilities or
/// notification handlers.
export type LSPClientExtension = {
  /// Extra [client
  /// capabilities](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#clientCapabilities)
  /// to send to the server when initializing. The object provided
  /// here will be merged with the capabilities the client provides by
  /// default.
  clientCapabilities?: Record<string, any>,
  /// Additional [notification
  /// handlers](#lsp-client.LSPClientConfig.notificationHandlers).
  /// These will be tried after notification handlers defined directly
  /// in the config object, and then in order of appearance in the
  /// [`extensions`](#lsp-client.LSPClientConfig.extensions) array.
  notificationHandlers?: {[method: string]: (client: LSPClient, params: any) => boolean},
  /// An optional CodeMirror extension to include.
  editorExtension?: Extension
}

/// An LSP client manages a connection to a language server. It should
/// be explicitly [connected](#lsp-client.LSPClient.connect) before
/// use.
export class LSPClient {
  /// @internal
  transport: Transport | null = null
  /// The client's [workspace](#lsp-client.Workspace).
  workspace: Workspace
  private nextReqID = 0
  private requests: Request<any>[] = []
  /// @internal
  activeMappings: WorkspaceMapping[] = []
  /// The capabilities advertised by the server. Will be null when not
  /// connected or initialized.
  serverCapabilities: lsp.ServerCapabilities | null = null
  private supportSync = -1
  /// A promise that resolves once the client connection is initialized. Will be
  /// replaced by a new promise object when you call `disconnect`.
  initializing: Promise<null>
  declare private init: {resolve: (value: null) => void, reject: (err: any) => void}
  private timeout: number
  /// @internal
  extensions: Extension[] = []

  /// Create a client object.
  constructor(
    /// @internal
    readonly config: LSPClientConfig = {}
  ) {
    this.receiveMessage = this.receiveMessage.bind(this)
    this.initializing = new Promise((resolve, reject) => this.init = {resolve, reject})
    this.timeout = config.timeout ?? 3000
    this.workspace = config.workspace ? config.workspace(this) : new DefaultWorkspace(this)

    if (config.extensions) for (let ext of config.extensions) {
      if (Array.isArray(ext) || (ext as any).extension) this.extensions.push(ext as Extension)
      else if ((ext as LSPClientExtension).editorExtension) this.extensions.push((ext as LSPClientExtension).editorExtension!)
    }
  }

  /// Whether this client is connected (has a transport).
  get connected() { return !!this.transport }

  /// Connect this client to a server over the given transport. Will
  /// immediately start the initialization exchange with the server,
  /// and resolve `this.initializing` (which it also returns) when
  /// successful.
  connect(transport: Transport) {
    if (this.transport) this.transport.unsubscribe(this.receiveMessage)
    this.transport = transport
    transport.subscribe(this.receiveMessage)
    let capabilities = clientCapabilities
    if (this.config.extensions) for (let ext of this.config.extensions) {
      let {clientCapabilities} = ext as LSPClientExtension
      if (clientCapabilities) capabilities = mergeCapabilities(capabilities, clientCapabilities)
    }
    this.requestInner<lsp.InitializeParams, lsp.InitializeResult>("initialize", {
      processId: null,
      clientInfo: {name: "@codemirror/lsp-client"},
      rootUri: this.config.rootUri || null,
      capabilities
    }).promise.then(resp => {
      this.serverCapabilities = resp.capabilities
      let sync = resp.capabilities.textDocumentSync
      this.supportSync = sync == null ? 0 : typeof sync == "number" ? sync : sync.change ?? 0
      transport.send(JSON.stringify({jsonrpc: "2.0", method: "initialized", params: {}}))
      this.init.resolve(null)
    }, this.init.reject)
    this.workspace.connected()
    return this
  }

  /// Disconnect the client from the server.
  disconnect() {
    if (this.transport) this.transport.unsubscribe(this.receiveMessage)
    this.serverCapabilities = null
    this.initializing = new Promise((resolve, reject) => this.init = {resolve, reject})
    this.workspace.disconnected()
  }

  /// Create a plugin for this client, to add to an editor
  /// configuration. This extension is necessary to use LSP-related
  /// functionality exported by this package. The returned extension
  /// will include the editor
  /// extensions included in this client's
  /// [configuration](#lsp-client.LSPClientConfig.extensions).
  ///
  /// Creating an editor with this plugin will cause
  /// [`openFile`](#lsp-client.Workspace.openFile) to be called on the
  /// workspace.
  ///
  /// By default, the language ID given to the server for this file is
  /// derived from the editor's language configuration via
  /// [`Language.name`](#language.Language.name). You can pass in
  /// a specific ID as a third parameter.
  plugin(fileURI: string, languageID?: string, options?: LSPPluginOptions): Extension {
    return [
      lspPluginBinding({client: this, uri: fileURI, languageID, options}),
      lspTheme,
      this.extensions
    ]
  }

  /// Send a `textDocument/didOpen` notification to the server.
  didOpen(file: WorkspaceFile) {
    this.notification<lsp.DidOpenTextDocumentParams>("textDocument/didOpen", {
      textDocument: {
        uri: file.uri,
        languageId: file.languageId,
        text: file.doc.toString(),
        version: file.version
      }
    })
  }

  /// Send a `textDocument/didClose` notification to the server.
  didClose(uri: string) {
    this.notification<lsp.DidCloseTextDocumentParams>("textDocument/didClose", {textDocument: {uri}})
  }

  private receiveMessage(msg: string) {
    const value = JSON.parse(msg) as lsp.ResponseMessage | lsp.NotificationMessage | lsp.RequestMessage
    if ("id" in value && !("method" in value)) {
      let index = this.requests.findIndex(r => r.id == value.id)
      if (index < 0) {
        console.warn(`[lsp] Received a response for non-existent request ${value.id}`)
      } else {
        let req = this.requests[index]
        clearTimeout(req.timeout)
        this.requests.splice(index, 1)
        if (value.error) req.reject(value.error)
        else req.resolve(value.result)
      }
    } else if (!("id" in value)) {
      let handler = this.config.notificationHandlers?.[value.method]
      if (handler && handler(this, value.params)) return
      if (this.config.extensions) for (let ext of this.config.extensions) {
        let {notificationHandlers} = ext as LSPClientExtension
        let handler = notificationHandlers?.[value.method]
        if (handler && handler(this, value.params)) return
      }
      let deflt = defaultNotificationHandlers[value.method]
      if (deflt) deflt(this, value.params)
      else if (this.config.unhandledNotification) this.config.unhandledNotification(this, value.method, value.params)
    } else {
      let resp: lsp.ResponseMessage = {
        jsonrpc: "2.0",
        id: value.id,
        error: {code: -32601 /* MethodNotFound */, message: "Method not implemented"}
      }
      this.transport!.send(JSON.stringify(resp))
    }
  }

  /// Make a request to the server. Returns a promise that resolves to
  /// the response or rejects with a failure message. You'll probably
  /// want to use types from the `vscode-languageserver-protocol`
  /// package for the type parameters.
  ///
  /// The caller is responsible for
  /// [synchronizing](#lsp-client.LSPClient.sync) state before the
  /// request and correctly handling state drift caused by local
  /// changes that happened during the request.
  request<Params, Result>(method: string, params: Params): Promise<Result> {
    if (!this.transport) return Promise.reject(new Error("Client not connected"))
    return this.initializing.then(() => this.requestInner<Params, Result>(method, params).promise)
  }

  private requestInner<Params, Result>(
    method: string,
    params: Params,
    mapped = false
  ): Request<Result> {
    let id = ++this.nextReqID, data: lsp.RequestMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params: params as any
    }
    let req = new Request<Result>(id, params, setTimeout(() => this.timeoutRequest(req), this.timeout))
    this.requests.push(req)
    try { this.transport!.send(JSON.stringify(data)) }
    catch(e) { req.reject(e) }
    return req
  }

  /// Send a notification to the server.
  notification<Params>(method: string, params: Params) {
    if (!this.transport) return
    this.initializing.then(() => {
      let data: lsp.NotificationMessage = {
        jsonrpc: "2.0",
        method,
        params: params as any
      }
      this.transport!.send(JSON.stringify(data))
    })
  }

  /// Cancel the in-progress request with the given parameter value
  /// (which is compared by identity).
  cancelRequest(params: any) {
    let found = this.requests.find(r => r.params === params)
    if (found) this.notification("$/cancelRequest", {id: found.id})
  }

  /// @internal
  hasCapability(name: keyof lsp.ServerCapabilities) {
    return this.serverCapabilities ? !!this.serverCapabilities[name] : null
  }

  /// Create a [workspace mapping](#lsp-client.WorkspaceMapping) that
  /// tracks changes to files in this client's workspace, relative to
  /// the moment where it was created. Make sure you call
  /// [`destroy`](#lsp-client.WorkspaceMapping.destroy) on the mapping
  /// when you're done with it.
  workspaceMapping() {
    let mapping = new WorkspaceMapping(this)
    this.activeMappings.push(mapping)
    return mapping
  }

  /// Run the given promise with a [workspace
  /// mapping](#lsp-client.WorkspaceMapping) active. Automatically
  /// release the mapping when the promise resolves or rejects.
  withMapping<T>(f: (mapping: WorkspaceMapping) => Promise<T>): Promise<T> {
    let mapping = this.workspaceMapping()
    return f(mapping).finally(() => mapping.destroy())
  }

  /// Push any [pending changes](#lsp-client.Workspace.syncFiles) in
  /// the open files to the server. You'll want to call this before
  /// most types of requests, to make sure the server isn't working
  /// with outdated information.
  sync() {
    for (let {file, changes, prevDoc} of this.workspace.syncFiles()) {
      for (let mapping of this.activeMappings)
        mapping.addChanges(file.uri, changes)
      if (this.supportSync) this.notification<lsp.DidChangeTextDocumentParams>("textDocument/didChange", {
        textDocument: {uri: file.uri, version: file.version},
        contentChanges: contentChangesFor(file, prevDoc, changes, this.supportSync == 2 /* Incremental */)
      })
    }
  }

  private timeoutRequest(req: Request<any>) {
    let index = this.requests.indexOf(req)
    if (index > -1) {
      req.reject(new Error("Request timed out"))
      this.requests.splice(index, 1)
    }
  }
}

const enum Sync { AlwaysIfSmaller = 1024 }

function contentChangesFor(
  file: WorkspaceFile,
  startDoc: Text,
  changes: ChangeSet,
  supportInc: boolean
): lsp.TextDocumentContentChangeEvent[] {
  if (!supportInc || file.doc.length < Sync.AlwaysIfSmaller)
    return [{text: file.doc.toString()}]
  let events: lsp.TextDocumentContentChangeEvent[] = []
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    events.push({
      range: {start: toPosition(startDoc, fromA), end: toPosition(startDoc, toA)},
      text: inserted.toString()
    })
  })
  return events.reverse()
}

function mergeCapabilities(base: any, add?: any) {
  if (add == null) return base
  if (typeof base != "object" || typeof add != "object") return add
  let result: Record<string, any> = {}
  let baseProps = Object.keys(base), addProps = Object.keys(add)
  for (let prop of baseProps)
    result[prop] = addProps.indexOf(prop) > -1 ? mergeCapabilities(base[prop], add[prop]) : base[prop]
  for (let prop of addProps)
    if (baseProps.indexOf(prop) < 0) result[prop] = add[prop]
  return result
}
