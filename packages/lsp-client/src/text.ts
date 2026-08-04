import type * as lsp from "vscode-languageserver-protocol"
import {Marked} from "marked"
import {EditorView} from "@codemirror/view"
import {Language, language as languageFacet, highlightingFor} from "@codemirror/language"
import {highlightCode, Highlighter} from "@lezer/highlight"

let context: {view: EditorView, language: ((name: string) => Language | null) | undefined} | null = null

export function withContext<T>(view: EditorView, language: ((name: string) => Language | null) | undefined, f: () => T): T {
  let prev = context
  try {
    context = {view, language}
    return f()
  } finally {
    context = prev
  }
}

const marked = new Marked({
  walkTokens(token) {
    if (!context || token.type != "code") return

    let lang = context.language && context.language(token.lang)
    if (!lang) {
      let viewLang = context.view.state.facet(languageFacet)
      if (viewLang && viewLang.name == token.lang) lang = viewLang
    }
    if (!lang) return
    let highlighter: Highlighter = {style: tags => highlightingFor(context!.view.state, tags)}
    let result = ""
    highlightCode(token.text, lang.parser.parse(token.text), highlighter, (text, cls) => {
      result += cls ? `<span class="${cls}">${escHTML(text)}</span>` : escHTML(text)
    }, () => {
      result += "<br>"
    })
    token.escaped = true
    token.text = result
  }
})

export function escHTML(text: string) {
  return text.replace(/[\n<&]/g, ch => ch == "\n" ? "<br>" : ch == "<" ? "&lt;" : "&amp;")
}

export function docToHTML(value: string | lsp.MarkupContent, defaultKind: lsp.MarkupKind) {
  let kind = defaultKind, text = value
  if (typeof text != "string") {
    kind = text.kind
    text = text.value
  }
  if (kind == "plaintext") {
    return escHTML(text)
  } else {
    return marked.parse(text, {async: false, })
  }
}
