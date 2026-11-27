import type * as lsp from "vscode-languageserver-protocol"
import {EditorView, Tooltip, hoverTooltip} from "@codemirror/view"
import {Extension} from "@codemirror/state"
import {language as languageFacet, highlightingFor} from "@codemirror/language"
import {highlightCode} from "@lezer/highlight"
import {fromPosition} from "./pos"
import {escHTML} from "./text"
import {LSPPlugin} from "./plugin"

/// Create an extension that queries the language server for hover
/// tooltips when the user hovers over the code with their pointer,
/// and displays a tooltip when the server provides one.
let defaultHoverTooltips: Extension | null = null

export function hoverTooltips(config: {hoverTime?: number} = {}): Extension {
  if (config.hoverTime == null && defaultHoverTooltips) return defaultHoverTooltips
  const extension = hoverTooltip(lspTooltipSource, {
    hideOn: tr => tr.docChanged,
    hoverTime: config.hoverTime
  })
  if (config.hoverTime == null) defaultHoverTooltips = extension
  return extension
}

function hoverRequest(plugin: LSPPlugin, pos: number) {
  if (plugin.client.hasCapability("hoverProvider") === false) return Promise.resolve(null)
  plugin.client.sync()
  return plugin.client.request<lsp.HoverParams, lsp.Hover | null>("textDocument/hover", {
    position: plugin.toPosition(pos),
    textDocument: {uri: plugin.uri},
  })
}

function lspTooltipSource(view: EditorView, pos: number): Promise<Tooltip | null> {
  const plugins = LSPPlugin.getAll(view, "hover")
    .filter(plugin => plugin.client.hasCapability("hoverProvider") !== false)
  if (!plugins.length) return Promise.resolve(null)
  return Promise.allSettled(plugins.map(plugin => hoverRequest(plugin, pos))).then(settled => {
    const results: {plugin: LSPPlugin, result: lsp.Hover}[] = []
    for (let i = 0; i < settled.length; i++) {
      const item = settled[i]
      if (item.status == "fulfilled" && item.value) results.push({plugin: plugins[i], result: item.value})
      else if (item.status == "rejected") console.warn("[lsp] Hover provider failed", item.reason)
    }
    if (!results.length) return null
    let from = pos, to = pos
    for (const {result} of results) if (result.range) {
      from = Math.min(from, fromPosition(view.state.doc, result.range.start))
      to = Math.max(to, fromPosition(view.state.doc, result.range.end))
    }
    return {
      pos: from,
      end: to,
      create() {
        let elt = document.createElement("div")
        elt.className = "cm-lsp-hover-tooltip cm-lsp-documentation"
        for (let i = 0; i < results.length; i++) {
          if (i) elt.appendChild(document.createElement("hr"))
          const section = elt.appendChild(document.createElement("div"))
          section.innerHTML = renderTooltipContent(results[i].plugin, results[i].result.contents)
        }
        return {dom: elt}
      },
      above: true
    }
  })
}

function renderTooltipContent(
  plugin: LSPPlugin,
  value: string | lsp.MarkupContent | lsp.MarkedString | lsp.MarkedString[]
) {
  if (Array.isArray(value)) return value.map(m => renderCode(plugin, m)).join("<br>")
  if (typeof value == "string" || typeof value == "object" && "language" in value) return renderCode(plugin, value)
  return plugin.docToHTML(value)
}

function renderCode(plugin: LSPPlugin, code: lsp.MarkedString) {
  if (typeof code == "string") return plugin.docToHTML(code, "markdown")
  let {language, value} = code
  let lang = plugin.client.config.highlightLanguage && plugin.client.config.highlightLanguage(language || "")
  if (!lang) {
    let viewLang = plugin.view.state.facet(languageFacet)
    if (viewLang && (!language || viewLang.name == language)) lang = viewLang
  }
  if (!lang) return escHTML(value)
  let result = ""
  highlightCode(value, lang.parser.parse(value), {style: tags => highlightingFor(plugin.view.state, tags)}, (text, cls) => {
    result += cls ? `<span class="${cls}">${escHTML(text)}</span>` : escHTML(text)
  }, () => {
    result += "<br>"
  })
  return result
}
