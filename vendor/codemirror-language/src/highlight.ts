import {Tree, NodeType} from "@lezer/common"
import {Tag, tags, tagHighlighter, Highlighter, highlightTree} from "@lezer/highlight"
import {StyleSpec, StyleModule} from "style-mod"
import {EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet} from "@codemirror/view"
import {EditorState, Prec, Facet, Extension, RangeSetBuilder} from "@codemirror/state"
import {syntaxTree, Language, language, languageDataProp, viewportPriorityTree,
        viewportPriorityParsingFailed, viewportPriorityParsingPending,
        ViewportPriorityTree} from "./language"

/// A highlight style associates CSS styles with highlighting
/// [tags](https://lezer.codemirror.net/docs/ref#highlight.Tag).
export class HighlightStyle implements Highlighter {
  /// A style module holding the CSS rules for this highlight style.
  /// When using
  /// [`highlightTree`](https://lezer.codemirror.net/docs/ref#highlight.highlightTree)
  /// outside of the editor, you may want to manually mount this
  /// module to show the highlighting.
  readonly module: StyleModule | null

  /// @internal
  readonly themeType: "dark" | "light" | undefined

  readonly style: (tags: readonly Tag[]) => string | null
  readonly scope?: (type: NodeType) => boolean

  private constructor(
    /// The tag styles used to create this highlight style.
    readonly specs: readonly TagStyle[],
    options: {scope?: NodeType | Language, all?: string | StyleSpec, themeType?: "dark" | "light"}
  ) {
    let modSpec: {[name: string]: StyleSpec} | undefined
    function def(spec: StyleSpec) {
      let cls = StyleModule.newName()
      ;(modSpec || (modSpec = Object.create(null)))["." + cls] = spec
      return cls
    }

    const all = typeof options.all == "string" ? options.all : options.all ? def(options.all) : undefined

    const scopeOpt = options.scope
    this.scope = scopeOpt instanceof Language ? (type: NodeType) => type.prop(languageDataProp) == scopeOpt.data
      : scopeOpt ? (type: NodeType) => type == scopeOpt : undefined

    this.style = tagHighlighter(specs.map(style => ({
      tag: style.tag,
      class: style.class as string || def(Object.assign({}, style, {tag: null}))
    })), {
      all,
    }).style

    this.module = modSpec ? new StyleModule(modSpec) : null
    this.themeType = options.themeType
  }

  /// Create a highlighter style that associates the given styles to
  /// the given tags. The specs must be objects that hold a style tag
  /// or array of tags in their `tag` property, and either a single
  /// `class` property providing a static CSS class (for highlighter
  /// that rely on external styling), or a
  /// [`style-mod`](https://code.haverbeke.berlin/marijn/style-mod#documentation)-style
  /// set of CSS properties (which define the styling for those tags).
  ///
  /// The CSS rules created for a highlighter will be emitted in the
  /// order of the spec's properties. That means that for elements that
  /// have multiple tags associated with them, styles defined further
  /// down in the list will have a higher CSS precedence than styles
  /// defined earlier.
  static define(specs: readonly TagStyle[], options?: {
    /// By default, highlighters apply to the entire document. You can
    /// scope them to a single language by providing the language
    /// object or a language's top node type here.
    scope?: Language | NodeType,
    /// Add a style to _all_ content. Probably only useful in
    /// combination with `scope`.
    all?: string | StyleSpec,
    /// Specify that this highlight style should only be active then
    /// the theme is dark or light. By default, it is active
    /// regardless of theme.
    themeType?: "dark" | "light"
  }) {
    return new HighlightStyle(specs, options || {})
  }
}

const highlighterFacet = Facet.define<Highlighter>()

const fallbackHighlighter = Facet.define<Highlighter, readonly Highlighter[] | null>({
  combine(values) { return values.length ? [values[0]] : null }
})

function getHighlighters(state: EditorState): readonly Highlighter[] | null {
  let main = state.facet(highlighterFacet)
  return main.length ? main : state.facet(fallbackHighlighter)
}

/// Wrap a highlighter in an editor extension that uses it to apply
/// syntax highlighting to the editor content.
///
/// When multiple (non-fallback) styles are provided, the styling
/// applied is the union of the classes they emit.
export function syntaxHighlighting(highlighter: Highlighter, options?: {
  /// When enabled, this marks the highlighter as a fallback, which
  /// only takes effect if no other highlighters are registered.
  fallback: boolean
}): Extension {
  let ext: Extension[] = [treeHighlighter], themeType: string | undefined
  if (highlighter instanceof HighlightStyle) {
    if (highlighter.module) ext.push(EditorView.styleModule.of(highlighter.module))
    themeType = highlighter.themeType
  }
  if (options?.fallback)
    ext.push(fallbackHighlighter.of(highlighter))
  else if (themeType)
    ext.push(highlighterFacet.computeN([EditorView.darkTheme], state => {
      return state.facet(EditorView.darkTheme) == (themeType == "dark") ? [highlighter] : []
    }))
  else
    ext.push(highlighterFacet.of(highlighter))
  return ext
}

/// Returns the CSS classes (if any) that the highlighters active in
/// the state would assign to the given style
/// [tags](https://lezer.codemirror.net/docs/ref#highlight.Tag) and
/// (optional) language
/// [scope](#language.HighlightStyle^define^options.scope).
export function highlightingFor(state: EditorState, tags: readonly Tag[], scope?: NodeType): string | null {
  let highlighters = getHighlighters(state)
  let result = null
  if (highlighters) for (let highlighter of highlighters) {
    if (!highlighter.scope || scope && highlighter.scope(scope)) {
      let cls = highlighter.style(tags)
      if (cls) result = result ? result + " " + cls : cls
    }
  }
  return result
}

/// The type of object used in
/// [`HighlightStyle.define`](#language.HighlightStyle^define).
/// Assigns a style to one or more highlighting
/// [tags](https://lezer.codemirror.net/docs/ref#highlight.Tag), which can either be a fixed class name
/// (which must be defined elsewhere), or a set of CSS properties, for
/// which the library will define an anonymous class.
export interface TagStyle {
  /// The tag or tags to target.
  tag: Tag | readonly Tag[],
  /// If given, this maps the tags to a fixed class name.
  class?: string,
  /// Any further properties (if `class` isn't given) will be
  /// interpreted as in style objects given to
  /// [style-mod](https://code.haverbeke.berlin/marijn/style-mod#documentation).
  /// (The type here is `any` because of TypeScript limitations.)
  [styleProperty: string]: any
}

class TreeHighlighter {
  decorations: DecorationSet
  decoratedFrom: number
  decoratedTo: number
  tree: Tree
  markCache: {[cls: string]: Decoration} = Object.create(null)
  provisionalVersion = -1
  usedProvisional = false
  mappedFallback = false
  fallbackExpired = false
  fallbackGeneration = 0
  fallbackTimer = -1

  constructor(readonly view: EditorView) {
    this.tree = syntaxTree(view.state)
    this.decorations = this.buildDeco(view, getHighlighters(view.state))
    this.decoratedFrom = view.viewport.from
    this.decoratedTo = view.viewport.to
    let provisional = viewportPriorityTree(view)
    this.provisionalVersion = provisional?.version ?? -1
    this.usedProvisional = !!provisional
    this.publishControlledCoverage(view, provisional)
  }

  update(update: ViewUpdate) {
    let tree = syntaxTree(update.state), highlighters = getHighlighters(update.state)
    let styleChange = highlighters != getHighlighters(update.startState)
    let provisional = viewportPriorityTree(update.view)
    let provisionalFailed = viewportPriorityParsingFailed(update.view)
    let provisionalVersion = provisional?.version ?? -1
    let {viewport} = update.view
    let decoratedFromMapped = update.changes.mapPos(this.decoratedFrom, -1)
    let decoratedToMapped = update.changes.mapPos(this.decoratedTo, 1)
    let sameLanguage = update.startState.facet(language) == update.state.facet(language)
    let retainMapped = retainMappedHighlighting(
      update.docChanged, this.usedProvisional, this.fallbackExpired,
      sameLanguage, styleChange,
      tree.length, viewport.from, viewport.to, decoratedFromMapped, decoratedToMapped)
    if (retainMapped) {
      this.tree = tree
      this.decorations = this.decorations.map(update.changes)
      this.decoratedFrom = decoratedFromMapped
      this.decoratedTo = decoratedToMapped
      this.provisionalVersion = -1
      this.usedProvisional = this.mappedFallback = true
      this.scheduleFallbackExpiry(update.view)
    } else if (retainMappedHighlightingWhileParsing(
                 this.mappedFallback, this.fallbackExpired, sameLanguage, styleChange,
                 !!provisional, provisionalFailed, tree.length, viewport.from, viewport.to,
                 decoratedFromMapped, decoratedToMapped)) {
      // Canonical parsing may publish several incomplete trees while an edit's
      // replacement provisional tree is still pending. Keep the mapped visual
      // state through those updates instead of rebuilding a plain viewport.
      this.tree = tree
      if (!update.changes.empty) this.decorations = this.decorations.map(update.changes)
      this.decoratedFrom = decoratedFromMapped
      this.decoratedTo = decoratedToMapped
    } else if (retainHighlightingDuringControlledPreparation(
                 !!(update.view as any).viewState?.controlledScrollActive,
                 this.usedProvisional, sameLanguage, styleChange, !!provisional,
                 provisionalFailed, tree.length, viewport.to)) {
      // A rolling corridor first expands the DOM, then publishes its
      // provisional parse. Retain decorations for the already safe range so
      // preparing the next chunk cannot flash the current viewport plain.
      this.tree = tree
    } else if (!this.mappedFallback && tree.length < viewport.to && !styleChange &&
               provisionalVersion == this.provisionalVersion && tree.type == this.tree.type &&
               decoratedFromMapped <= viewport.from && decoratedToMapped >= viewport.to) {
      this.decorations = this.decorations.map(update.changes)
      this.decoratedFrom = decoratedFromMapped
      this.decoratedTo = decoratedToMapped
    } else if (this.mappedFallback && this.fallbackExpired ||
               provisionalFailed ||
               tree != this.tree || update.viewportChanged || styleChange ||
               provisionalVersion != this.provisionalVersion) {
      this.tree = tree
      this.decorations = this.buildDeco(update.view, highlighters)
      this.decoratedFrom = viewport.from
      this.decoratedTo = viewport.to
      this.provisionalVersion = provisionalVersion
      this.usedProvisional = !!provisional
      this.clearFallback()
    }
    this.publishControlledCoverage(
      update.view, provisional, styleChange || !sameLanguage || provisionalFailed)
  }

  private scheduleFallbackExpiry(view: EditorView) {
    if (this.fallbackTimer > -1) clearTimeout(this.fallbackTimer)
    let generation = ++this.fallbackGeneration
    this.fallbackExpired = false
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = -1
      if (generation != this.fallbackGeneration || !this.mappedFallback) return
      if (viewportPriorityParsingPending(view)) {
        this.scheduleFallbackExpiry(view)
        return
      }
      this.fallbackExpired = true
      view.dispatch({})
    }, 5000) as any
  }

  private clearFallback() {
    this.mappedFallback = this.fallbackExpired = false
    this.fallbackGeneration++
    if (this.fallbackTimer > -1) clearTimeout(this.fallbackTimer)
    this.fallbackTimer = -1
  }

  private publishControlledCoverage(view: EditorView,
                                    provisional: ViewportPriorityTree | null,
                                    invalidate = false) {
    let controller = (view as any).controlledTouchScrollController
    let {viewport} = view
    let complete = this.tree.length >= viewport.to ||
      (!!provisional && provisional.from <= viewport.from && provisional.to >= viewport.to) ||
      (this.mappedFallback && this.decoratedFrom <= viewport.from && this.decoratedTo >= viewport.to)
    if (complete) controller?.onHighlightCoverageReady?.()
    else if (invalidate) controller?.onHighlightCoverageInvalidated?.()
  }

  destroy() {
    this.clearFallback()
    ;(this.view as any).controlledTouchScrollController?.onHighlightCoverageInvalidated?.()
  }

  buildDeco(view: EditorView, highlighters: readonly Highlighter[] | null) {
    if (!highlighters) return Decoration.none

    let builder = new RangeSetBuilder<Decoration>()
    let provisional = viewportPriorityTree(view)
    let provisionalHighlighters = provisional ? outerLanguageHighlighters(provisional, highlighters) : null
    for (let {from, to} of view.visibleRanges) {
      let canonicalTo = Math.min(to, this.tree.length)
      if (from < canonicalTo) this.addTreeHighlights(builder, this.tree, highlighters, from, canonicalTo)
      if (provisional && provisionalHighlighters) {
        let priority = provisionalHighlightRange(from, to, this.tree.length, provisional.from, provisional.to)
        if (priority)
          this.addTreeHighlights(builder, provisional.tree, provisionalHighlighters,
                                 priority.from - provisional.from, priority.to - provisional.from,
                                 provisional.from)
      }
    }
    return builder.finish()
  }

  private addTreeHighlights(builder: RangeSetBuilder<Decoration>, tree: Tree,
                            highlighters: readonly Highlighter[], from: number, to: number,
                            offset = 0) {
    highlightTree(tree, highlighters, (from, to, style) => {
      builder.add(from + offset, to + offset,
                  this.markCache[style] || (this.markCache[style] = Decoration.mark({class: style})))
    }, from, to)
  }
}

/// @internal
export function retainMappedHighlighting(docChanged: boolean, usedProvisional: boolean,
                                         fallbackExpired: boolean, sameLanguage: boolean,
                                         styleChanged: boolean, canonicalLength: number,
                                         viewportFrom: number, viewportTo: number,
                                         decoratedFrom: number, decoratedTo: number) {
  return docChanged && usedProvisional && !fallbackExpired && sameLanguage && !styleChanged &&
    canonicalLength < viewportTo && decoratedFrom <= viewportFrom && decoratedTo >= viewportTo
}

/// @internal
export function retainMappedHighlightingWhileParsing(mappedFallback: boolean,
                                                      fallbackExpired: boolean,
                                                      sameLanguage: boolean,
                                                      styleChanged: boolean,
                                                      hasPublishedProvisional: boolean,
                                                      provisionalFailed: boolean,
                                                      canonicalLength: number,
                                                      viewportFrom: number, viewportTo: number,
                                                      decoratedFrom: number, decoratedTo: number) {
  return mappedFallback && !fallbackExpired && sameLanguage && !styleChanged &&
    !hasPublishedProvisional && !provisionalFailed && canonicalLength < viewportTo &&
    decoratedFrom <= viewportFrom && decoratedTo >= viewportTo
}

/// @internal
export function retainHighlightingDuringControlledPreparation(controlledActive: boolean,
                                                               usedProvisional: boolean,
                                                               sameLanguage: boolean,
                                                               styleChanged: boolean,
                                                               hasPublishedProvisional: boolean,
                                                               provisionalFailed: boolean,
                                                               canonicalLength: number,
                                                               viewportTo: number) {
  return controlledActive && usedProvisional && sameLanguage && !styleChanged &&
    !hasPublishedProvisional && !provisionalFailed && canonicalLength < viewportTo
}

/// @internal
export function provisionalHighlightRange(from: number, to: number, canonicalLength: number,
                                           provisionalFrom: number, provisionalTo: number) {
  let priorityFrom = Math.max(from, Math.min(to, canonicalLength), provisionalFrom)
  let priorityTo = Math.min(to, provisionalTo)
  return priorityFrom < priorityTo ? {from: priorityFrom, to: priorityTo} : null
}

/// @internal
export function outerLanguageHighlighters(provisional: ViewportPriorityTree,
                                          highlighters: readonly Highlighter[]): readonly Highlighter[] {
  let top = provisional.tree.topNode.type
  return highlighters.map(highlighter => ({
    style: highlighter.style,
    scope: (type: NodeType) => type == top && (!highlighter.scope || highlighter.scope(type))
  }))
}

const treeHighlighter = Prec.high(ViewPlugin.fromClass(TreeHighlighter, {
  decorations: v => v.decorations
}))

/// A default highlight style (works well with light themes).
export const defaultHighlightStyle = HighlightStyle.define([
  {tag: tags.meta,
   color: "#404740"},
  {tag: tags.link,
   textDecoration: "underline"},
  {tag: tags.heading,
   textDecoration: "underline",
   fontWeight: "bold"},
  {tag: tags.emphasis,
   fontStyle: "italic"},
  {tag: tags.strong,
   fontWeight: "bold"},
  {tag: tags.strikethrough,
   textDecoration: "line-through"},
  {tag: tags.keyword,
   color: "#708"},
  {tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
   color: "#219"},
  {tag: [tags.literal, tags.inserted],
   color: "#164"},
  {tag: [tags.string, tags.deleted],
   color: "#a11"},
  {tag: [tags.regexp, tags.escape, tags.special(tags.string)],
   color: "#e40"},
  {tag: tags.definition(tags.variableName),
   color: "#00f"},
  {tag: tags.local(tags.variableName),
   color: "#30a"},
  {tag: [tags.typeName, tags.namespace],
   color: "#085"},
  {tag: tags.className,
   color: "#167"},
  {tag: [tags.special(tags.variableName), tags.macroName],
   color: "#256"},
  {tag: tags.definition(tags.propertyName),
   color: "#00c"},
  {tag: tags.comment,
   color: "#940"},
  {tag: tags.invalid,
   color: "#f00"}
])
