import {Facet, Extension} from "@codemirror/state"
import {EditorView} from "./editorview"
import {ViewPlugin, ViewUpdate} from "./extension"

type PanelConfig = {
  /// By default, panels will be placed inside the editor's DOM
  /// structure. You can use this option to override where panels with
  /// `top: true` are placed.
  topContainer?: HTMLElement
  /// Override where panels with `top: false` are placed.
  bottomContainer?: HTMLElement
}

const panelConfig = Facet.define<PanelConfig, PanelConfig>({
  combine(configs: readonly PanelConfig[]) {
    let topContainer, bottomContainer
    for (let c of configs) {
      topContainer = topContainer || c.topContainer
      bottomContainer = bottomContainer || c.bottomContainer
    }
    return {topContainer, bottomContainer}
  }
})

/// Configures the panel-managing extension.
export function panels(config?: PanelConfig): Extension {
  return config ? [panelConfig.of(config)] : []
}

/// Object that describes an active panel.
export interface Panel {
  /// The element representing this panel. The library will add the
  /// `"cm-panel"` DOM class to this.
  dom: HTMLElement,
  /// Optionally called after the panel has been added to the editor.
  mount?(): void
  /// Update the DOM for a given view update.
  update?(update: ViewUpdate): void
  /// Called when the panel is removed from the editor or the editor
  /// is destroyed.
  destroy?(): void
  /// Whether the panel should be at the top or bottom of the editor.
  /// Defaults to false.
  top?: boolean
}

/// Get the active panel created by the given constructor, if any.
/// This can be useful when you need access to your panels' DOM
/// structure.
export function getPanel(view: EditorView, panel: PanelConstructor) {
  let plugin = view.plugin(panelPlugin)
  let index = plugin ? plugin.specs.indexOf(panel) : -1
  return index > -1 ? plugin!.panels[index] : null
}

const panelPlugin = ViewPlugin.fromClass(class {
  input: readonly (null | PanelConstructor)[]
  specs: readonly PanelConstructor[]
  panels: Panel[]
  top: PanelGroup
  bottom: PanelGroup

  constructor(view: EditorView) {
    this.input = view.state.facet(showPanel)
    this.specs = this.input.filter(s => s) as PanelConstructor[]
    this.panels = this.specs.map(spec => spec(view))
    let conf = view.state.facet(panelConfig)
    this.top = new PanelGroup(view, true, conf.topContainer)
    this.bottom = new PanelGroup(view, false, conf.bottomContainer)
    this.top.sync(this.panels.filter(p => p.top))
    this.bottom.sync(this.panels.filter(p => !p.top))
    for (let p of this.panels) {
      p.dom.classList.add("cm-panel")
      if (p.mount) p.mount()
    }
  }

  update(update: ViewUpdate) {
    let conf = update.state.facet(panelConfig)
    if (this.top.container != conf.topContainer) {
      this.top.sync([])
      this.top = new PanelGroup(update.view, true, conf.topContainer)
    }
    if (this.bottom.container != conf.bottomContainer) {
      this.bottom.sync([])
      this.bottom = new PanelGroup(update.view, false, conf.bottomContainer)
    }
    this.top.syncClasses()
    this.bottom.syncClasses()
    let input = update.state.facet(showPanel)
    if (input != this.input) {
      let specs = input.filter(x => x) as PanelConstructor[]
      let panels = [], top: Panel[] = [], bottom: Panel[] = [], mount = []
      for (let spec of specs) {
        let known = this.specs.indexOf(spec), panel
        if (known < 0) {
          panel = spec(update.view)
          mount.push(panel)
        } else {
          panel = this.panels[known]
          if (panel.update) panel.update(update)
        }
        panels.push(panel)
        ;(panel.top ? top : bottom).push(panel)
      }
      this.specs = specs
      this.panels = panels
      this.top.sync(top)
      this.bottom.sync(bottom)
      for (let p of mount) {
        p.dom.classList.add("cm-panel")
        if (p.mount) p.mount!()
      }
    } else {
      for (let p of this.panels) if (p.update) p.update(update)
    }
  }

  destroy() {
    this.top.sync([])
    this.bottom.sync([])
  }
}, {
  provide: plugin => EditorView.scrollMargins.of(view => {
    let value = view.plugin(plugin)
    return value && {top: value.top.scrollMargin(), bottom: value.bottom.scrollMargin()}
  })
})

class PanelGroup {
  dom: HTMLElement | undefined = undefined
  classes = ""
  panels: Panel[] = []

  constructor(readonly view: EditorView, readonly top: boolean, readonly container: HTMLElement | undefined) {
    this.syncClasses()
  }

  sync(panels: Panel[]) {
    for (let p of this.panels) if (p.destroy && panels.indexOf(p) < 0) p.destroy()
    this.panels = panels
    this.syncDOM()
  }

  syncDOM() {
    if (this.panels.length == 0) {
      if (this.dom) {
        this.dom.remove()
        this.dom = undefined
      }
      return
    }

    if (!this.dom) {
      this.dom = document.createElement("div")
      this.dom.className = this.top ? "cm-panels cm-panels-top" : "cm-panels cm-panels-bottom"
      let parent = this.container || this.view.dom
      parent.insertBefore(this.dom, this.top ? parent.firstChild : null)
    }

    let curDOM = this.dom.firstChild
    for (let panel of this.panels) {
      if (panel.dom.parentNode == this.dom) {
        while (curDOM != panel.dom) curDOM = rm(curDOM!)
        curDOM = curDOM!.nextSibling
      } else {
        this.dom.insertBefore(panel.dom, curDOM)
      }
    }
    while (curDOM) curDOM = rm(curDOM)
  }

  scrollMargin() {
    return !this.dom || this.container ? 0
      : Math.max(0, this.top ?
        this.dom.getBoundingClientRect().bottom - Math.max(0, this.view.scrollDOM.getBoundingClientRect().top) :
        Math.min(innerHeight, this.view.scrollDOM.getBoundingClientRect().bottom) - this.dom.getBoundingClientRect().top)
  }

  syncClasses() {
    if (!this.container || this.classes == this.view.themeClasses) return
    for (let cls of this.classes.split(" ")) if (cls) this.container.classList.remove(cls)
    for (let cls of (this.classes = this.view.themeClasses).split(" ")) if (cls) this.container.classList.add(cls)
  }
}

function rm(node: ChildNode) {
  let next = node.nextSibling
  node.remove()
  return next
}

/// A function that initializes a panel. Used in
/// [`showPanel`](#view.showPanel).
export type PanelConstructor = (view: EditorView) => Panel

/// Opening a panel is done by providing a constructor function for
/// the panel through this facet. (The panel is closed again when its
/// constructor is no longer provided.) Values of `null` are ignored.
export const showPanel = Facet.define<PanelConstructor | null>({
  enables: panelPlugin
})
