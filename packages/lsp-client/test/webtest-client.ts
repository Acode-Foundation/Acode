import type * as lsp from "vscode-languageserver-protocol"
import ist from "ist"
import {LSPClientConfig, LSPClient, LSPPlugin, renameSymbol,
        formatDocument, serverCompletion, hoverTooltips,
        showSignatureHelp, nextSignature} from "@codemirror/lsp-client"
import {EditorView, EditorViewConfig} from "@codemirror/view"
import {javascript} from "@codemirror/lang-javascript"
import {syntaxHighlighting} from "@codemirror/language"
import {startCompletion, currentCompletions, acceptCompletion, autocompletion, moveCompletionSelection} from "@codemirror/autocomplete"
import {classHighlighter} from "@lezer/highlight"
import {DummyServer} from "./server.js"

function setup(conf: {client?: LSPClientConfig, server?: ConstructorParameters<typeof DummyServer>[0]} = {}) {
  let server = new DummyServer(conf.server)
  let client = new LSPClient(conf.client)
  client.connect(server)
  return {server, client}
}

const URI = "file:///home/holly/src/test.js"

function ed(client: LSPClient, conf: EditorViewConfig, uri = URI) {
  return new EditorView({...conf, extensions: [conf.extensions || [], LSPPlugin.create(client, uri, "javascript")]})
}

function sync(cm: EditorView) {
  LSPPlugin.get(cm)!.client.sync()
}

function wait(ms: number = 2) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function place(cm: EditorView) {
  let ws = document.querySelector("#workspace")!
  while (ws.firstChild) ws.firstChild.remove()
  ws.appendChild(cm.dom)
  setTimeout(() => cm.destroy(), 1000)
  return cm
}

describe("LSPClient", () => {
  it("can connect to a server", () => {
    let {client} = setup()
    return client.initializing
  })

  it("can open a file", async () => {
    let {client, server} = setup()
    ed(client, {doc: "stitchwort"})
    await wait()
    ist(server.getFile(URI)!.text, "stitchwort")
  })

  it("can update a file", async () => {
    let {client, server} = setup()
    let cm = ed(client, {doc: "goldenrod"})
    cm.dispatch({changes: {from: 1, insert: "-"}})
    sync(cm)
    await wait()
    ist(server.getFile(URI)!.text, cm.state.sliceDoc())
  })

  it("can update a file with multiple changes", async () => {
    let {client, server} = setup()
    let cm = ed(client, {doc: "hawkweed\n".repeat(1000)})
    await wait()
    cm.dispatch({changes: [{from: 0, insert: "<"}, {from: cm.state.doc.length, insert: ">"}]})
    sync(cm)
    await wait()
    ist(server.getFile(URI)!.text, cm.state.sliceDoc())
  })

  it("can close a file", async () => {
    let {client, server} = setup()
    let cm = ed(client, {doc: "cowleek"})
    await wait()
    cm.destroy()
    await wait()
    ist(!server.getFile(URI))
  })

  it("can open multiple files", async () => {
    let {client, server} = setup()
    let cm1 = ed(client, {doc: "elder"}), cm2 = ed(client, {doc: "alfalfa"}, "file:///x")
    cm1.dispatch({changes: {from: 5, insert: "?"}})
    cm2.dispatch({changes: {from: 7, insert: "!"}})
    sync(cm1)
    await wait()
    ist(server.getFile(URI)!.text, "elder?")
    ist(server.getFile("file:///x")!.text, "alfalfa!")
  })

  it("can provide mapping", async () => {
    let {client} = setup()
    let cm = ed(client, {doc: "1\n2\n3"})
    await client.withMapping(async mapping => {
      let req = client.request<lsp.DocumentFormattingParams, lsp.TextEdit[] | null>("textDocument/formatting", {
        textDocument: {uri: URI},
        options: {tabSize: 2, insertSpaces: true}
      })
      cm.dispatch({changes: {from: 1, to: 3}})
      let response = await req
      ist(response![0].range.start.line, 2)
      ist(mapping.mapPos(URI, 5), 3)
    })
  })

  it("can provide mapping across syncs", async () => {
    let {client} = setup({server: {delay: {"textDocument/formatting": 10}}})
    let cm = ed(client, {doc: "1\n2\n3"})
    await client.withMapping(async mapping => {
      let req = client.request<lsp.DocumentFormattingParams, lsp.TextEdit[] | null>("textDocument/formatting", {
        textDocument: {uri: URI},
        options: {tabSize: 2, insertSpaces: true}
      })
      cm.dispatch({changes: {from: 1, to: 3}})
      sync(cm)
      cm.dispatch({changes: {from: 0, insert: "#"}})
      let response = await req
      ist(response![0].range.start.line, 2)
      ist(mapping.mapPos(URI, 5), 4)
    })
  })

  it("reports invalid methods", async () => {
    let {client} = setup()
    try {
      await client.request("none/such", {})
      ist(false)
    } catch (e: any) {
      ist(e.code, -32601)
    }
  })

  it("can receive custom notifications", async () => {
    let received: any = null
    let {client} = setup({client: {notificationHandlers: {
      "custom/notification": (client, params) => received = params
    }}})
    client.request("custom/sendNotification", {method: "custom/notification", params: {verify: true}})
    await wait()
    ist(received.verify)
  })

  it("can report unknown notifications", async () => {
    let received: any = null
    let {client} = setup({client: {unhandledNotification: (client, method, params) => received = params}})
    client.request("custom/sendNotification", {method: "custom/notification", params: {verify: true}})
    await wait()
    ist(received.verify)
  })

  it("can display messages in the editor", async () => {
    let {client} = setup()
    let cm = ed(client, {})
    client.request("custom/sendNotification", {method: "window/showMessage", params: {type: 2 /* Warning */, message: "WARNING"}})
    await wait()
    let dialog = cm.dom.querySelector(".cm-lsp-message-warning")!
    ist(dialog)
    ist(dialog.innerHTML.indexOf("WARNING"), "-1", ">")
  })

  it("routes exceptions from Transport.send to the request promise", async () => {
    let broken = false
    let {client} = setup({server: {brokenPipe: () => broken}})
    await client.initializing
    broken = true
    let req = client.request("test", {})
    try {
      await req
      ist(false)
    } catch (e: any) {
      ist(e.message, "Broken Pipe")
    }
  })

  describe("LSPPlugin", () => {
    it("can render doc strings", () => {
      let {client} = setup({client: {sanitizeHTML: s => s.replace(/x/g, "y")}})
      let cm = ed(client, {})
      ist(LSPPlugin.get(cm)!.docToHTML({kind: "markdown", value: "# xx"}), "<h1>yy</h1>\n")
    })

    it("can render doc strings with highlighting", () => {
      let {client} = setup()
      let cm = ed(client, {extensions: [
        javascript(),
        syntaxHighlighting(classHighlighter)
      ]})
      ist(LSPPlugin.get(cm)!.docToHTML({kind: "markdown", value: "```javascript\nreturn\n```"}),
          '<pre><code class="language-javascript"><span class="tok-keyword">return</span>\n</code></pre>\n')
    })

    it("can convert to LSP positions", () => {
      let {client} = setup()
      let cm = ed(client, {doc: "one\ntwo\nthree"})
      let pos = LSPPlugin.get(cm)!.toPosition(6)
      ist(pos.line, 1)
      ist(pos.character, 2)
    })

    it("can convert from positions", () => {
      let {client} = setup()
      let cm = ed(client, {doc: "one\ntwo\nthree"})
      ist(LSPPlugin.get(cm)!.fromPosition({line: 0, character: 3}), 3)
      ist(LSPPlugin.get(cm)!.fromPosition({line: 2, character: 1}), 9)
    })

    it("can display errors", () => {
      let {client} = setup()
      let cm = ed(client, {})
      LSPPlugin.get(cm)!.reportError("E", "Oh no")
      ist(cm.dom.querySelector(".cm-lsp-message-error")!.innerHTML.indexOf("Oh no"), -1, ">")
    })
  })

  describe("renameSymbol", () => {
    it("can run a rename", async () => {
      let {client} = setup()
      let cm = place(ed(client, {doc: "let foo = 1; console.log(foo)", selection: {anchor: 4}}))
      let cm2 = ed(client, {doc: "foo?"}, "file:///2")
      await wait()
      ist(renameSymbol(cm), true)
      let form = cm.dom.querySelector(".cm-panel form") as HTMLFormElement
      form.querySelector("input")!.value = "bar"
      form.requestSubmit()
      await wait()
      ist(cm.state.sliceDoc(), "let bar = 1; console.log(bar)")
      ist(cm2.state.sliceDoc(), "bar?")
      cm.destroy()
    })

    it("can handle changes during the request", async () => {
      let {client} = setup({server: {delay: {"textDocument/rename": 5}}})
      let cm = place(ed(client, {doc: "let foo = 1; console.log(foo)", selection: {anchor: 4}}))
      await wait()
      ist(renameSymbol(cm), true)
      let form = cm.dom.querySelector(".cm-panel form") as HTMLFormElement
      form.querySelector("input")!.value = "bar"
      form.requestSubmit()
      await wait()
      cm.dispatch({changes: {from: 0, insert: "  "}})
      await wait(10)
      ist(cm.state.sliceDoc(), "  let bar = 1; console.log(bar)")
      cm.destroy()
    })
  })

  describe("formatDocument", () => {
    it("can make format requests", async () => {
      let {client} = setup()
      let cm = ed(client, {doc: "hawthorn"})
      formatDocument(cm)
      await wait()
      ist(cm.state.sliceDoc(), "hawthorn\n// formatted!")
    })
  })

  describe("completion", () => {
    it("can get completions from the server", async () => {
      let {client} = setup()
      let cm = ed(client, {doc: "..o", selection: {anchor: 3}, extensions: [
        serverCompletion(),
        autocompletion({interactionDelay: 0, activateOnTypingDelay: 10})
      ]})
      startCompletion(cm)
      await wait(60)
      let cs = currentCompletions(cm.state)
      ist(cs.length, 2)
      ist(cs[0].label, "one")
      ist(cs[1].label, "ookay")
      acceptCompletion(cm)
      ist(cm.state.sliceDoc(), "..one!")
      cm.dispatch({changes: {from: 6, insert: "\no"}, userEvent: "input.type", selection: {anchor: 8}})
      await wait(20)
      ist(currentCompletions(cm.state).length, 2)
      moveCompletionSelection(true)(cm)
      await wait()
      ist(cm.dom.querySelector(".cm-completionInfo"))
      acceptCompletion(cm)
      ist(cm.state.sliceDoc(), "..one!\nokay")
    })

    it("expands snippet completions and unescapes LSP escapes", async () => {
      let {client} = setup()
      let cm = ed(client, {doc: "..f", selection: {anchor: 3}, extensions: [
        serverCompletion(),
        autocompletion({interactionDelay: 0, activateOnTypingDelay: 10})
      ]})
      startCompletion(cm)
      await wait(60)
      let cs = currentCompletions(cm.state)
      ist(cs.length, 1)
      ist(cs[0].label, "fn")
      acceptCompletion(cm)
      // `\$arg` must come through as a literal `$arg`, not the raw `\$arg`.
      ist(cm.state.sliceDoc(), "..fn($arg)")
    })

    it("applies additionalTextEdits (e.g. an auto-import)", async () => {
      let {client} = setup()
      let cm = ed(client, {doc: "..b", selection: {anchor: 3}, extensions: [
        serverCompletion(),
        autocompletion({interactionDelay: 0, activateOnTypingDelay: 10})
      ]})
      startCompletion(cm)
      await wait(60)
      let cs = currentCompletions(cm.state)
      ist(cs.length, 1)
      ist(cs[0].label, "Bar")
      acceptCompletion(cm)
      // The completion inserts "Bar" *and* the item's additionalTextEdits add
      // the `use Bar;` line at the top.
      ist(cm.state.sliceDoc(), "use Bar;\n..Bar")
    })

    it("maps additionalTextEdit positions through changes that arrive while the completion is active", async () => {
      let {client} = setup()
      // Server's "Zap" completion ships an additionalTextEdit at line 2,
      // char 0 — i.e. the start of "L2" in this document.
      let cm = ed(client, {doc: "L0\nL1\nL2\n..z", selection: {anchor: 12}, extensions: [
        serverCompletion(),
        autocompletion({interactionDelay: 0, activateOnTypingDelay: 10})
      ]})
      startCompletion(cm)
      await wait(60)
      let cs = currentCompletions(cm.state)
      ist(cs.length, 1)
      ist(cs[0].label, "Zap")
      // Insert a line at the very top. This is far from the cursor, so CM
      // keeps the completion alive — but the LSP edit's `line: 2` now refers
      // to a different line in the new document.
      cm.dispatch({changes: {from: 0, insert: "HEADER\n"}})
      acceptCompletion(cm)
      // The "MID\n" insertion should land before the *original* L2 line,
      // which after the HEADER insertion is the third line.
      ist(cm.state.sliceDoc(), "HEADER\nL0\nL1\nMID\nL2\n..Zap")
    })
  })

  describe("hoverTooltips", () => {
    it("can retrieve hover info", async () => {
      let {client} = setup()
      let cm = place(ed(client, {doc: "speedwell", extensions: [
        hoverTooltips({hoverTime: 10}),
        javascript(),
        syntaxHighlighting(classHighlighter)
      ]}))
      let pos = cm.coordsAtPos(1)!, x = pos.left, y = pos.top + 5
      cm.contentDOM.firstChild!.dispatchEvent(new MouseEvent("mousemove", {
        screenX: x, screenY: y,
        clientX: x, clientY: y,
        bubbles: true
      }))
      await wait(15)
      ist(cm.dom.querySelector(".cm-tooltip .tok-string"))
      cm.destroy()
    })
  })

  describe("signatureHelp", () => {
    it("can display a signature", async () => {
      let {client} = setup()
      let cm = ed(client, {doc: "bugloss"})
      showSignatureHelp(cm)
      await wait()
      ist(cm.dom.querySelector(".cm-lsp-active-parameter")!.innerHTML, "b")
      nextSignature(cm)
      ist(cm.dom.querySelector(".cm-lsp-active-parameter")!.innerHTML, "y")
    })
  })
})
