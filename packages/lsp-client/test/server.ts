import type * as lsp from "vscode-languageserver-protocol"
import {Transport} from "@codemirror/lsp-client"

const serverCapabilities: lsp.ServerCapabilities = {
  textDocumentSync: {openClose: true, change: 2},
  renameProvider: true,
  documentFormattingProvider: true,
  completionProvider: {triggerCharacters: [","]},
  hoverProvider: true,
  signatureHelpProvider: {},
}

const requestHandlers: {[method: string]: (params: any, server: DummyServer) => any} = {
  "initialize": (params: lsp.InitializeParams, server): lsp.InitializeResult => {
    return {capabilities: serverCapabilities, serverInfo: {name: "Dummy server"}}
  },

  "textDocument/rename": (params: lsp.RenameParams, server): lsp.WorkspaceEdit | null => {
    let file = server.getFile(params.textDocument.uri)
    if (!file) throw new ServerError(-32602, "File not open")
    let pos = resolvePosition(file.text, params.position)
    let from = pos, to = pos
    while (from && /\w/.test(file.text[from - 1])) from--
    while (to < file.text.length && /\w/.test(file.text[to])) to++
    if (from == to) return null
    let word = file.text.slice(from, to), changes: {[uri: string]: lsp.TextEdit[]} = {}
    for (let file of server.files) {
      let found: lsp.TextEdit[] = [], pos = 0, next
      while ((next = file.text.indexOf(word, pos)) > -1) {
        pos = next + word.length
        found.push({
          newText: params.newName,
          range: {start: toPosition(file.text, next), end: toPosition(file.text, pos)}
        })
      }
      if (found.length) changes[file.uri] = found
    }
    return {changes}
  },

  "textDocument/formatting": (params: lsp.DocumentFormattingParams, server): lsp.TextEdit[] | null => {
    let file = server.getFile(params.textDocument.uri)
    if (!file) throw new ServerError(-32602, "File not open")
    let end = toPosition(file.text, file.text.length)
    return [{newText: "\n// formatted!", range: {start: end, end}}]
  },

  "textDocument/completion": (params: lsp.CompletionParams, server): lsp.CompletionList | null => {
    let before = {line: params.position.line, character: params.position.character - 1}
    return {
      isIncomplete: true,
      itemDefaults: {
        editRange: {start: before, end: params.position}
      },
      items: [
        {label: "one", kind: 14, commitCharacters: ["."], textEdit: {newText: "one!", range: {start: before, end: params.position}}},
        {label: "ookay", kind: 7, documentation: "`code` stuff", insertText: "okay"},
        {label: "fn", kind: 3, insertText: "fn(${1:\\$arg})$0", insertTextFormat: 2},
        {label: "Bar", kind: 7, insertText: "Bar", additionalTextEdits: [
          {range: {start: {line: 0, character: 0}, end: {line: 0, character: 0}}, newText: "use Bar;\n"},
        ]},
        {label: "Zap", kind: 7, insertText: "Zap", additionalTextEdits: [
          {range: {start: {line: 2, character: 0}, end: {line: 2, character: 0}}, newText: "MID\n"},
        ]},
      ]
    }
  },

  "textDocument/hover": (params: lsp.HoverParams, server): lsp.Hover | null => {
    return {
      range: {start: params.position, end: params.position},
      contents: {language: "javascript", value: "'hover'"}
    }
  },

  "textDocument/signatureHelp": (params: lsp.SignatureHelpParams, server): lsp.SignatureHelp | null => {
    return {
      signatures: [{
        label: "(a, b) => c",
        activeParameter: 1,
        parameters: [{label: [1, 2]}, {label: [4, 5]}]
      }, {
        label: "(x, y) => c",
        activeParameter: 1,
        parameters: [{label: [1, 2]}, {label: [4, 5]}]
      }],
      activeSignature: 0,
    }
  },

  "custom/sendNotification": (params: {method: string, params: any}, server) => {
    server.broadcast({jsonrpc: "2.0", method: params.method, params: params.params})
  },
}

const notificationHandlers: {[method: string]: (params: any, server: DummyServer) => void} = {
  "initialized": (params: lsp.InitializedParams, server) => {
    server.initialized = true
  },
  "textDocument/didOpen": (params: lsp.DidOpenTextDocumentParams, server) => {
    let {uri, text, languageId} = params.textDocument
    if (!server.getFile(params.textDocument.uri))
      server.files.push(new OpenFile(uri, languageId, text))
  },
  "textDocument/didClose": (params: lsp.DidCloseTextDocumentParams, server) => {
    server.files = server.files.filter(f => f.uri != params.textDocument.uri)
  },
  "textDocument/didChange": (params: lsp.DidChangeTextDocumentParams, server) => {
    let file = server.getFile(params.textDocument.uri)
    if (file) for (let ch of params.contentChanges) {
      if ("range" in ch)
        file.text = file.text.slice(0, resolvePosition(file.text, ch.range.start)) + ch.text +
          file.text.slice(resolvePosition(file.text, ch.range.end))
      else
        file.text = ch.text
    }
  }
}

function resolvePosition(text: string, pos: lsp.Position) {
  let line = 0, off = 0
  while (line < pos.line) {
    let next = text.indexOf("\n", off)
    if (!next) throw new RangeError("Position out of bounds")
    off = next + 1
    line++
  }
  off += pos.character
  if (off > text.length) throw new RangeError("Position out of bounds")
  return off
}

function toPosition(text: string, pos: number): lsp.Position {
  for (let off = 0, line = 0;;) {
    let next = text.indexOf("\n", off)
    if (next < 0 || next >= pos) return {line, character: pos - off}
    off = next + 1
    line++
  }
}

class ServerError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}

class OpenFile {
  constructor(readonly uri: string, readonly languageId: string, public text: string) {}
}

export class DummyServer implements Transport {
  initialized = false
  subscribers: ((msg: string) => void)[] = []
  files: OpenFile[] = []

  constructor(readonly config: {
    delay?: {[method: string]: number},
    brokenPipe?: () => boolean
  } = {}) {
  }

  subscribe(listener: (msg: string) => void) {
    this.subscribers.push(listener)
  }

  unsubscribe(listener: (msg: string) => void) {
    this.subscribers = this.subscribers.filter(l => l != listener)
  }

  send(message: string) {
    if (this.config.brokenPipe?.()) throw new Error("Broken Pipe")
    const msg = JSON.parse(message) as lsp.RequestMessage | lsp.NotificationMessage
    if ("id" in msg) {
      this.handleRequest(msg.method, msg.params).then(result => {
        this.broadcast({jsonrpc: "2.0", id: msg.id, result})
      }, e => {
        let error = e instanceof ServerError ? {code: e.code, message: e.message}
          : {code: -32603 /* InternalError */, message: String(e)}
        this.broadcast({jsonrpc: "2.0", id: msg.id, error})
      })
    } else {
      this.handleNotification(msg.method, msg.params)
    }
  }

  broadcast(message: any) {
    for (let sub of this.subscribers) sub(JSON.stringify(message))
  }

  handleRequest<Params, Response>(method: string, params: Params): Promise<Response> {
    return new Promise(resolve => {
      if (!this.initialized && method != "initialize")
        throw new ServerError(-32002 /* ServerNotInitialized */, "Not initialized")
      let handler = requestHandlers[method]
      if (!handler) throw new ServerError(-32601 /* MethodNotFound */, "Method not found")
      let result = handler(params, this), delay = this.config.delay?.[method]
      if (delay) setTimeout(() => resolve(result), delay)
      else queueMicrotask(() => resolve(result))
    })
  }

  handleNotification<Params>(method: string, params: Params) {
    let handler = notificationHandlers[method]
    if (handler) handler(params, this)
  }

  getFile(uri: string) { return this.files.find(f => f.uri == uri) }
}
