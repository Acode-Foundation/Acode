import {Decoration, DecorationSet, WidgetType} from "./decoration"
import {ViewPlugin, ViewUpdate} from "./extension"
import {EditorView} from "./editorview"
import {MatchDecorator} from "./matchdecorator"
import {combineConfig, Facet, Extension, countColumn, codePointAt} from "@codemirror/state"

interface SpecialCharConfig {
  /// An optional function that renders the placeholder elements.
  ///
  /// The `description` argument will be text that clarifies what the
  /// character is, which should be provided to screen readers (for
  /// example with the
  /// [`aria-label`](https://www.w3.org/TR/wai-aria/#aria-label)
  /// attribute) and optionally shown to the user in other ways (such
  /// as the
  /// [`title`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/title)
  /// attribute).
  ///
  /// The given placeholder string is a suggestion for how to display
  /// the character visually.
  render?: ((code: number, description: string | null, placeholder: string) => HTMLElement) | null
  /// Regular expression that matches the special characters to
  /// highlight. Must have its 'g'/global flag set.
  specialChars?: RegExp
  /// Regular expression that can be used to add characters to the
  /// default set of characters to highlight.
  addSpecialChars?: RegExp | null
}

const UnicodeRegexpSupport = /x/.unicode != null ? "gu" : "g"
const Specials = new RegExp("[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]", UnicodeRegexpSupport)

const Names: {[key: number]: string} = {
  0: "null",
  7: "bell",
  8: "backspace",
  10: "newline",
  11: "vertical tab",
  13: "carriage return",
  27: "escape",
  8203: "zero width space",
  8204: "zero width non-joiner",
  8205: "zero width joiner",
  8206: "left-to-right mark",
  8207: "right-to-left mark",
  8232: "line separator",
  8237: "left-to-right override",
  8238: "right-to-left override",
  8294: "left-to-right isolate",
  8295: "right-to-left isolate",
  8297: "pop directional isolate",
  8233: "paragraph separator",
  65279: "zero width no-break space",
  65532: "object replacement"
}

let _supportsTabSize: null | boolean = null
function supportsTabSize() {
  if (_supportsTabSize == null && typeof document != "undefined" && document.body) {
    let styles = document.body.style as any
    _supportsTabSize = (styles.tabSize ?? styles.MozTabSize) != null
  }
  return _supportsTabSize || false
}

const specialCharConfig = Facet.define<SpecialCharConfig, Required<SpecialCharConfig> & {replaceTabs?: boolean}>({
  combine(configs) {
    let config: Required<SpecialCharConfig> & {replaceTabs?: boolean} = combineConfig(configs, {
      render: null,
      specialChars: Specials,
      addSpecialChars: null
    })
    
    if (config.replaceTabs = !supportsTabSize())
      config.specialChars = new RegExp("\t|" + config.specialChars.source, UnicodeRegexpSupport)

    if (config.addSpecialChars)
      config.specialChars = new RegExp(config.specialChars.source + "|" + config.addSpecialChars.source, UnicodeRegexpSupport)

    return config
  }
})

/// Returns an extension that installs highlighting of special
/// characters.
export function highlightSpecialChars(
  /// Configuration options.
  config: SpecialCharConfig = {}
): Extension {
  return [specialCharConfig.of(config), specialCharPlugin()]
}

let _plugin: Extension | null = null
function specialCharPlugin() {
  return _plugin || (_plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    decorationCache: {[char: number]: Decoration} = Object.create(null)
    decorator: MatchDecorator

    constructor(public view: EditorView) {
      this.decorator = this.makeDecorator(view.state.facet(specialCharConfig))
      this.decorations = this.decorator.createDeco(view)
    }

    makeDecorator(conf: Required<SpecialCharConfig> & {replaceTabs?: boolean}) {
      return new MatchDecorator({
        regexp: conf.specialChars,
        decoration: (m, view, pos) => {
          let {doc} = view.state
          let code = codePointAt(m[0], 0)
          if (code == 9) {
            let line = doc.lineAt(pos)
            let size = view.state.tabSize, col = countColumn(line.text, size, pos - line.from)
            return Decoration.replace({
              widget: new TabWidget((size - (col % size)) * this.view.defaultCharacterWidth / this.view.scaleX)
            })
          }
          return this.decorationCache[code] ||
            (this.decorationCache[code] = Decoration.replace({widget: new SpecialCharWidget(conf, code)}))
        },
        boundary: conf.replaceTabs ? undefined : /[^]/
      })
    }

    update(update: ViewUpdate) {
      let conf = update.state.facet(specialCharConfig)
      if (update.startState.facet(specialCharConfig) != conf) {
        this.decorator = this.makeDecorator(conf)
        this.decorations = this.decorator.createDeco(update.view)
      } else {
        this.decorations = this.decorator.updateDeco(update, this.decorations)
      }
    }
  }, {
    decorations: v => v.decorations
  }))
}

const DefaultPlaceholder = "\u2022"

// Assigns placeholder characters from the Control Pictures block to
// ASCII control characters
function placeholder(code: number): string {
  if (code >= 32) return DefaultPlaceholder
  if (code == 10) return "\u2424"
  return String.fromCharCode(9216 + code)
}

class SpecialCharWidget extends WidgetType {
  constructor(readonly options: Required<SpecialCharConfig>,
              readonly code: number) { super() }

  eq(other: SpecialCharWidget) { return other.code == this.code }

  toDOM(view: EditorView) {
    let ph = placeholder(this.code)
    let desc = view.state.phrase("Control character") + " " + (Names[this.code] || "0x" + this.code.toString(16))
    let custom = this.options.render && this.options.render(this.code, desc, ph)
    if (custom) return custom
    let span = document.createElement("span")
    span.textContent = ph
    span.title = desc
    span.setAttribute("aria-label", desc)
    span.className = "cm-specialChar"
    return span
  }

  ignoreEvent(): boolean { return false }
}

class TabWidget extends WidgetType {
  constructor(readonly width: number) { super() }

  eq(other: TabWidget) { return other.width == this.width }

  toDOM() {
    let span = document.createElement("span")
    span.textContent = "\t"
    span.className = "cm-tab"
    span.style.width = this.width + "px"
    return span
  }

  ignoreEvent(): boolean { return false }
}
