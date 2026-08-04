import type * as lsp from "vscode-languageserver-protocol"
import {StateField, StateEffect, Prec, Extension} from "@codemirror/state"
import {EditorView, ViewPlugin, ViewUpdate, keymap, KeyBinding,
        Tooltip, showTooltip, Command} from "@codemirror/view"
import {LSPPlugin} from "./plugin"
import type {LSPClient} from "./client"

function getSignatureHelp(plugin: LSPPlugin, pos: number, context: lsp.SignatureHelpContext) {
  if (plugin.client.hasCapability("signatureHelpProvider") === false) return Promise.resolve(null)
  plugin.client.sync()
  return plugin.client.request<lsp.SignatureHelpParams, lsp.SignatureHelp | null>("textDocument/signatureHelp", {
    context,
    position: plugin.toPosition(pos),
    textDocument: {uri: plugin.uri},
  })
}

const signaturePlugin = ViewPlugin.fromClass(class {
  activeRequest: {pos: number, drop: boolean} | null = null
  delayedRequest: ReturnType<typeof setTimeout> | null = null

  update(update: ViewUpdate) {
    if (this.activeRequest) {
      if (update.selectionSet) {
        this.activeRequest.drop = true
        this.activeRequest = null
      } else if (update.docChanged) {
        this.activeRequest.pos = update.changes.mapPos(this.activeRequest.pos)
      }
    }

    const plugin = LSPPlugin.getAll(update.view, "signatureHelp")
      .find(plugin => plugin.client.hasCapability("signatureHelpProvider") !== false)
    if (!plugin) return
    const sigState = update.view.state.field(signatureState)
    let triggerCharacter = ""
    if (update.docChanged && update.transactions.some(tr => tr.isUserEvent("input.type"))) {
      const serverConf = plugin.client.serverCapabilities?.signatureHelpProvider
      const triggers = (serverConf?.triggerCharacters || []).concat(sigState && serverConf?.retriggerCharacters || [])
      if (triggers) {
        update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          let ins = inserted.toString()
          if (ins) for (let ch of triggers) {
            if (ins.indexOf(ch) > -1) triggerCharacter = ch
          }
        })
      }
    }

    if (triggerCharacter) {
      this.startRequest(plugin, {
        triggerKind: 2 /* TriggerCharacter */,
        isRetrigger: !!sigState,
        triggerCharacter,
        activeSignatureHelp: sigState ? sigState.data : undefined
      })
    } else if (sigState && update.selectionSet) {
      if (this.delayedRequest != null) clearTimeout(this.delayedRequest)
      this.delayedRequest = setTimeout(() => {
        this.startRequest(plugin, {
          triggerKind: 3 /* ContentChange */,
          isRetrigger: true,
          activeSignatureHelp: sigState.data,
        })
      }, 250)
    }
  }

  startRequest(plugin: LSPPlugin, context: lsp.SignatureHelpContext) {
    if (this.delayedRequest != null) clearTimeout(this.delayedRequest)
    let {view} = plugin, pos = view.state.selection.main.head
    if (this.activeRequest) this.activeRequest.drop = true
    let req = this.activeRequest = {pos, drop: false}
    getSignatureHelp(plugin, pos, context).then(result => {
      if (req.drop) return
      if (result && result.signatures.length) {
        let cur = view.state.field(signatureState)
        let same = cur && sameSignatures(cur.data, result)
        let active = same && context.triggerKind == 3 ? cur!.active : result.activeSignature ?? 0
        // Don't update at all if nothing changed
        if (same && sameActiveParam(cur!.data, result, active)) return
        view.dispatch({effects: signatureEffect.of({
          data: result,
          active,
          pos: same ? cur!.tooltip.pos : req.pos,
          client: plugin.client
        })})
      } else if (view.state.field(signatureState)) {
        view.dispatch({effects: signatureEffect.of(null)})
      }
    }, context.triggerKind == 1 /* Invoked */ ? err => plugin.reportError("Signature request failed", err) : undefined)
  }

  destroy() {
    if (this.delayedRequest != null) clearTimeout(this.delayedRequest)
    if (this.activeRequest) this.activeRequest.drop = true
  }
})

function sameSignatures(a: lsp.SignatureHelp, b: lsp.SignatureHelp) {
  if (a.signatures.length != b.signatures.length) return false
  return a.signatures.every((s, i) => s.label == b.signatures[i].label)
}

function sameActiveParam(a: lsp.SignatureHelp, b: lsp.SignatureHelp, active: number) {
  return (a.signatures[active].activeParameter ?? a.activeParameter) ==
    (b.signatures[active].activeParameter ?? b.activeParameter)
}

class SignatureState {
  constructor(
    readonly data: lsp.SignatureHelp,
    readonly active: number,
    readonly tooltip: Tooltip,
    readonly client: LSPClient
  ) {}
}

const signatureState = StateField.define<SignatureState | null>({
  create() { return null },
  update(sig, tr) {
    for (let e of tr.effects) if (e.is(signatureEffect)) {
      if (e.value) {
        return new SignatureState(e.value.data, e.value.active,
          signatureTooltip(e.value.data, e.value.active, e.value.pos, e.value.client), e.value.client)
      } else {
        return null
      }
    }
    if (sig && tr.docChanged)
      return new SignatureState(sig.data, sig.active,
        {...sig.tooltip, pos: tr.changes.mapPos(sig.tooltip.pos)}, sig.client)
    return sig
  },
  provide: f => showTooltip.from(f, sig => sig && sig.tooltip)
})

const signatureEffect = StateEffect.define<{
  data: lsp.SignatureHelp,
  active: number,
  pos: number,
  client: LSPClient
} | null>()

function signatureTooltip(data: lsp.SignatureHelp, active: number, pos: number, client: LSPClient): Tooltip {
  return {
    pos,
    above: true,
    create: view => drawSignatureTooltip(view, data, active, client)
  }
}

function drawSignatureTooltip(view: EditorView, data: lsp.SignatureHelp, active: number, client: LSPClient) {
  let dom = document.createElement("div")
  dom.className = "cm-lsp-signature-tooltip"
  if (data.signatures.length > 1) {
    dom.classList.add("cm-lsp-signature-multiple")
    let num = dom.appendChild(document.createElement("div"))
    num.className = "cm-lsp-signature-num"
    num.textContent = `${active + 1}/${data.signatures.length}`
  }

  let signature = data.signatures[active]
  let sig = dom.appendChild(document.createElement("div"))
  sig.className = "cm-lsp-signature"
  let activeFrom = 0, activeTo = 0
  let activeN = signature.activeParameter ?? data.activeParameter
  let activeParam = activeN != null && signature.parameters ? signature.parameters[activeN] : null
  if (activeParam && Array.isArray(activeParam.label)) {
    ;[activeFrom, activeTo] = activeParam.label
  } else if (activeParam) {
    let found = signature.label.indexOf(activeParam.label as string)
    if (found > -1) {
      activeFrom = found
      activeTo = found + activeParam.label.length
    }
  }
  if (activeTo) {
    sig.appendChild(document.createTextNode(signature.label.slice(0, activeFrom)))
    let activeElt = sig.appendChild(document.createElement("span"))
    activeElt.className = "cm-lsp-active-parameter"
    activeElt.textContent = signature.label.slice(activeFrom, activeTo)
    sig.appendChild(document.createTextNode(signature.label.slice(activeTo)))
  } else {
    sig.textContent = signature.label
  }
  if (signature.documentation) {
    let plugin = LSPPlugin.get(view, client)
    if (plugin) {
      let docs = dom.appendChild(document.createElement("div"))
      docs.className = "cm-lsp-signature-documentation cm-lsp-documentation"
      docs.innerHTML = plugin.docToHTML(signature.documentation)
    }
  }
  return {dom}
}

/// Explicitly prompt the server to provide signature help at the
/// cursor.
export const showSignatureHelp: Command = view => {
  let plugin = view.plugin(signaturePlugin)
  if (!plugin) {
    view.dispatch({effects: StateEffect.appendConfig.of([signatureState, signaturePlugin])})
    plugin = view.plugin(signaturePlugin)
  }
  let field = view.state.field(signatureState)
  if (!plugin || field === undefined) return false
  let lspPlugin = LSPPlugin.getAll(view, "signatureHelp")
    .find(plugin => plugin.client.hasCapability("signatureHelpProvider") !== false)
  if (!lspPlugin) return false
  plugin.startRequest(lspPlugin, {
    triggerKind: 1 /* Invoked */,
    activeSignatureHelp: field ? field.data : undefined,
    isRetrigger: !!field
  })
  return true
}

/// If there is an active signature tooltip with multiple signatures,
/// move to the next one.
export const nextSignature: Command = view => {
  let field = view.state.field(signatureState)
  if (!field) return false
  if (field.active < field.data.signatures.length - 1)
    view.dispatch({effects: signatureEffect.of({
      data: field.data, active: field.active + 1, pos: field.tooltip.pos, client: field.client
    })})
  return true
}

/// If there is an active signature tooltip with multiple signatures,
/// move to the previous signature.
export const prevSignature: Command = view => {
  let field = view.state.field(signatureState)
  if (!field) return false
  if (field.active > 0)
    view.dispatch({effects: signatureEffect.of({
      data: field.data, active: field.active - 1, pos: field.tooltip.pos, client: field.client
    })})
  return true
}

/// A keymap that binds
///
/// - Ctrl-Shift-Space (Cmd-Shift-Space on macOS) to
///   [`showSignatureHelp`](#lsp-client.showSignatureHelp)
///
/// - Ctrl-Shift-ArrowUp (Cmd-Shift-ArrowUp on macOS) to
///   [`prevSignature`](#lsp-client.prevSignature)
///
/// - Ctrl-Shift-ArrowDown (Cmd-Shift-ArrowDown on macOS) to
///   [`nextSignature`](#lsp-client.nextSignature)
///
/// Note that these keys are automatically bound by
/// [`signatureHelp`](#lsp-client.signatureHelp) unless you pass it
/// `keymap: false`.
export const signatureKeymap: readonly KeyBinding[] = [
  {key: "Mod-Shift-Space", run: showSignatureHelp},
  {key: "Mod-Shift-ArrowUp", run: prevSignature},
  {key: "Mod-Shift-ArrowDown", run: nextSignature},
]

/// Returns an extension that enables signature help. Will bind the
/// keys in [`signatureKeymap`](#lsp-client.signatureKeymap) unless
/// `keymap` is set to `false`.
const signatureHelpWithoutKeymap: Extension = [signatureState, signaturePlugin]
const signatureHelpWithKeymap: Extension = [
  signatureHelpWithoutKeymap,
  Prec.high(keymap.of(signatureKeymap))
]

export function signatureHelp(config: {keymap?: boolean} = {}): Extension {
  return config.keymap === false ? signatureHelpWithoutKeymap : signatureHelpWithKeymap
}
