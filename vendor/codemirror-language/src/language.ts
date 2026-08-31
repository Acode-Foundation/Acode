import {Tree, SyntaxNode, ChangedRange, TreeFragment, NodeProp, NodeType, Input,
        PartialParse, Parser, IterMode} from "@lezer/common"
import type {LRParser, ParserConfig} from "@lezer/lr"
import {EditorState, StateField, Transaction, Extension, StateEffect, Facet,
        ChangeDesc, Text, TextIterator} from "@codemirror/state"
import {ViewPlugin, ViewUpdate, EditorView, logException} from "@codemirror/view"

/// Node prop stored in a parser's top syntax node to provide the
/// facet that stores language-specific data for that language.
export const languageDataProp = new NodeProp<Facet<{[name: string]: any}>>()

/// Helper function to define a facet (to be added to the top syntax
/// node(s) for a language via
/// [`languageDataProp`](#language.languageDataProp)), that will be
/// used to associate language data with the language. You
/// probably only need this when subclassing
/// [`Language`](#language.Language).
export function defineLanguageFacet(baseData?: {[name: string]: any}) {
  return Facet.define<{[name: string]: any}>({
    combine: baseData ? values => values.concat(baseData!) : undefined
  })
}

/// Some languages need to return different [language
/// data](#state.EditorState.languageDataAt) for some parts of their
/// tree. Sublanguages, registered by adding a [node
/// prop](#language.sublanguageProp) to the language's top syntax
/// node, provide a mechanism to do this.
///
/// (Note that when using nested parsing, where nested syntax is
/// parsed by a different parser and has its own top node type, you
/// don't need a sublanguage.)
export interface Sublanguage {
  /// Determines whether the data provided by this sublanguage should
  /// completely replace the regular data or be added to it (with
  /// higher-precedence). The default is `"extend"`.
  type?: "replace" | "extend",
  /// A predicate that returns whether the node at the queried
  /// position is part of the sublanguage.
  test: (node: SyntaxNode, state: EditorState) => boolean,
  /// The language data facet that holds the sublanguage's data.
  /// You'll want to use
  /// [`defineLanguageFacet`](#language.defineLanguageFacet) to create
  /// this.
  facet: Facet<{[name: string]: any}>
}

/// Syntax node prop used to register sublanguages. Should be added to
/// the top level node type for the language.
export const sublanguageProp = new NodeProp<Sublanguage[]>()

/// A language object manages parsing and per-language
/// [metadata](#state.EditorState.languageDataAt). Parse data is
/// managed as a [Lezer](https://lezer.codemirror.net) tree. The class
/// can be used directly, via the [`LRLanguage`](#language.LRLanguage)
/// subclass for [Lezer](https://lezer.codemirror.net/) LR parsers, or
/// via the [`StreamLanguage`](#language.StreamLanguage) subclass
/// for stream parsers.
export class Language {
  /// The extension value to install this as the document language.
  readonly extension: Extension

  /// The parser object. Can be useful when using this as a [nested
  /// parser](https://lezer.codemirror.net/docs/ref#common.Parser).
  parser: Parser

  /// Construct a language object. If you need to invoke this
  /// directly, first define a data facet with
  /// [`defineLanguageFacet`](#language.defineLanguageFacet), and then
  /// configure your parser to [attach](#language.languageDataProp) it
  /// to the language's outer syntax node.
  constructor(
    /// The [language data](#state.EditorState.languageDataAt) facet
    /// used for this language.
    readonly data: Facet<{[name: string]: any}>,
    parser: Parser,
    extraExtensions: Extension[] = [],
    /// A language name.
    readonly name: string = ""
  ) {
    // Kludge to define EditorState.tree as a debugging helper,
    // without the EditorState package actually knowing about
    // languages and lezer trees.
    if (!EditorState.prototype.hasOwnProperty("tree"))
      Object.defineProperty(EditorState.prototype, "tree", {get() { return syntaxTree(this) }})

    this.parser = parser
    this.extension = [
      language.of(this),
      EditorState.languageData.of((state, pos, side) => {
        let top = topNodeAt(state, pos, side), data = top.type.prop(languageDataProp)
        if (!data) return []
        let base = state.facet(data), sub = top.type.prop(sublanguageProp)
        if (sub) {
          let innerNode = top.resolve(pos - top.from, side)
          for (let sublang of sub) if (sublang.test(innerNode, state)) {
            let data = state.facet(sublang.facet)
            return sublang.type == "replace" ? data : data.concat(base)
          }
        }
        return base
      })
    ].concat(extraExtensions)
  }

  /// Query whether this language is active at the given position.
  isActiveAt(state: EditorState, pos: number, side: -1 | 0 | 1 = -1) {
    return topNodeAt(state, pos, side).type.prop(languageDataProp) == this.data
  }

  /// Find the document regions that were parsed using this language.
  /// The returned regions will _include_ any nested languages rooted
  /// in this language, when those exist.
  findRegions(state: EditorState) {
    let lang = state.facet(language)
    if (lang?.data == this.data) return [{from: 0, to: state.doc.length}]
    if (!lang || !lang.allowsNesting) return []
    let result: {from: number, to: number}[] = []
    let explore = (tree: Tree, from: number) => {
      if (tree.prop(languageDataProp) == this.data) {
        result.push({from, to: from + tree.length})
        return
      }
      let mount = tree.prop(NodeProp.mounted)
      if (mount) {
        if (mount.tree.prop(languageDataProp) == this.data) {
          if (mount.overlay) for (let r of mount.overlay) result.push({from: r.from + from, to: r.to + from})
          else result.push({from: from, to: from + tree.length})
          return
        } else if (mount.overlay) {
          let size = result.length
          explore(mount.tree, mount.overlay[0].from + from)
          if (result.length > size) return
        }
      }
      for (let i = 0; i < tree.children.length; i++) {
        let ch = tree.children[i]
        if (ch instanceof Tree) explore(ch, tree.positions[i] + from)
      }
    }
    explore(syntaxTree(state), 0)
    return result
  }

  /// Indicates whether this language allows nested languages. The
  /// default implementation returns true.
  get allowsNesting() { return true }

  /// @internal
  static state: StateField<LanguageState>

  /// @internal
  static setState = StateEffect.define<LanguageState>()
}

function topNodeAt(state: EditorState, pos: number, side: -1 | 0 | 1) {
  let topLang = state.facet(language), tree = syntaxTree(state).topNode
  if (!topLang || topLang.allowsNesting) {
    for (let node: SyntaxNode | null = tree; node; node = node.enter(pos, side, IterMode.ExcludeBuffers | IterMode.EnterBracketed))
      if (node.type.isTop) tree = node
  }
  return tree
}

/// A subclass of [`Language`](#language.Language) for use with Lezer
/// [LR parsers](https://lezer.codemirror.net/docs/ref#lr.LRParser).
export class LRLanguage extends Language {
  private constructor(data: Facet<{[name: string]: any}>, readonly parser: LRParser, name?: string) {
    super(data, parser, [], name)
  }

  /// Define a language from a parser.
  static define(spec: {
    /// The [name](#Language.name) of the language.
    name?: string,
    /// The parser to use. Should already have added editor-relevant
    /// node props (and optionally things like dialect and top rule)
    /// configured.
    parser: LRParser,
    /// [Language data](#state.EditorState.languageDataAt)
    /// to register for this language.
    languageData?: {[name: string]: any}
  }) {
    let data = defineLanguageFacet(spec.languageData)
    return new LRLanguage(data, spec.parser.configure({
      props: [languageDataProp.add(type => type.isTop ? data : undefined)]
    }), spec.name)
  }

  /// Create a new instance of this language with a reconfigured
  /// version of its parser and optionally a new name.
  configure(options: ParserConfig, name?: string): LRLanguage {
    return new LRLanguage(this.data, this.parser.configure(options), name || this.name)
  }

  get allowsNesting() { return this.parser.hasWrappers() }
}

/// Get the syntax tree for a state, which is the current (possibly
/// incomplete) parse tree of the active
/// [language](#language.Language), or the empty tree if there is no
/// language available.
export function syntaxTree(state: EditorState): Tree {
  let field = state.field(Language.state, false)
  return field ? field.tree : Tree.empty
}

/// Try to get a parse tree that spans at least up to `upto`. The
/// method will do at most `timeout` milliseconds of work to parse
/// up to that point if the tree isn't already available.
export function ensureSyntaxTree(state: EditorState, upto: number, timeout = 50): Tree | null {
  let parse = state.field(Language.state, false)?.context
  if (!parse) return null
  let oldVieport = parse.viewport
  parse.updateViewport({from: 0, to: upto})
  let result = parse.isDone(upto) || parse.work(timeout, upto) ? parse.tree : null
  parse.updateViewport(oldVieport)
  return result
}

/// Queries whether there is a full syntax tree available up to the
/// given document position. If there isn't, the background parse
/// process _might_ still be working and update the tree further, but
/// there is no guarantee of that—the parser will [stop
/// working](#language.syntaxParserRunning) when it has spent a
/// certain amount of time or has moved beyond the visible viewport.
/// Always returns false if no language has been enabled.
export function syntaxTreeAvailable(state: EditorState, upto = state.doc.length) {
  return state.field(Language.state, false)?.context.isDone(upto) || false
}

/// Move parsing forward, and update the editor state afterwards to
/// reflect the new tree. Will work for at most `timeout`
/// milliseconds. Returns true if the parser managed get to the given
/// position in that time.
export function forceParsing(view: EditorView, upto = view.viewport.to, timeout = 100): boolean {
  let success = ensureSyntaxTree(view.state, upto, timeout)
  if (success != syntaxTree(view.state)) view.dispatch({})
  return !!success
}

/// Tells you whether the language parser is planning to do more
/// parsing work (in a `requestIdleCallback` pseudo-thread) or has
/// stopped running, either because it parsed the entire document,
/// because it spent too much time and was cut off, or because there
/// is no language parser enabled.
export function syntaxParserRunning(view: EditorView) {
  return view.plugin(parseWorker)?.isWorking() || false
}

/// Configuration for viewport-priority provisional parsing.
export interface ViewportPriorityParsingConfig {
  /// Maximum amount of work performed in one main-thread slice.
  sliceMs?: number,
  /// Provisional trees only apply highlighting from the outer language.
  approximate: "outer-language"
}

interface ResolvedViewportPriorityParsing {
  sliceMs: number,
  approximate: "outer-language"
}

const viewportPriorityParsingFacet = Facet.define<ViewportPriorityParsingConfig,
                                                   ResolvedViewportPriorityParsing | null>({
  combine(values) {
    if (!values.length) return null
    let value = values[0]
    return {
      sliceMs: Math.max(1, Math.min(8, Number.isFinite(value.sliceMs) ? value.sliceMs! : 4)),
      approximate: "outer-language"
    }
  }
})

/// Enable temporary viewport-priority highlighting while the canonical parser
/// is still working through an earlier part of a large document. The
/// provisional tree is never exposed through `syntaxTree` or other language
/// services.
export function viewportPriorityParsing(config: ViewportPriorityParsingConfig): Extension {
  return viewportPriorityParsingFacet.of(config)
}

/// Lezer-style
/// [`Input`](https://lezer.codemirror.net/docs/ref#common.Input)
/// object for a [`Text`](#state.Text) object.
export class DocInput implements Input {
  private cursor: TextIterator
  private cursorPos = 0
  private string = ""

  /// Create an input object for the given document.
  constructor(readonly doc: Text) {
    this.cursor = doc.iter()
  }

  get length() { return this.doc.length }

  private syncTo(pos: number) {
    this.string = this.cursor.next(pos - this.cursorPos).value
    this.cursorPos = pos + this.string.length
    return this.cursorPos - this.string.length
  }

  chunk(pos: number) {
    this.syncTo(pos)
    return this.string
  }

  get lineChunks() { return true }

  read(from: number, to: number) {
    let stringStart = this.cursorPos - this.string.length
    if (from < stringStart || to >= this.cursorPos)
      return this.doc.sliceString(from, to)
    else
      return this.string.slice(from - stringStart, to - stringStart)
  }
}

const enum Work {
  // Milliseconds of work time to perform immediately for a state doc change
  Apply = 20,
  // Minimum amount of work time to perform in an idle callback
  MinSlice = 25,
  // Amount of work time to perform in pseudo-thread when idle callbacks aren't supported
  Slice = 100,
  // Minimum pause between pseudo-thread slices
  MinPause = 100,
  // Maximum pause (timeout) for the pseudo-thread
  MaxPause = 500,
  // Parse time budgets are assigned per chunk—the parser can run for
  // ChunkBudget milliseconds at most during ChunkTime milliseconds.
  // After that, no further background parsing is scheduled until the
  // next chunk in which the editor is active.
  ChunkBudget = 3000,
  ChunkTime = 30000,
  // For every change the editor receives while focused, it gets a
  // small bonus to its parsing budget (as a way to allow active
  // editors to continue doing work).
  ChangeBonus = 50,
  // Don't eagerly parse this far beyond the end of the viewport
  MaxParseAhead = 1e5,
  // When initializing the state field (before viewport info is
  // available), pretend the viewport goes from 0 to here.
  InitViewport = 3000,
}

let currentContext: ParseContext | null = null

/// A parse context provided to parsers working on the editor content.
export class ParseContext {
  private parse: PartialParse | null = null
  /// @internal
  tempSkipped: {from: number, to: number}[] = []

  private constructor(
    private parser: Parser,
    /// The current editor state.
    readonly state: EditorState,
    /// Tree fragments that can be reused by incremental re-parses.
    public fragments: readonly TreeFragment[] = [],
    /// @internal
    public tree: Tree,
    /// @internal
    public treeLen: number,
    /// The current editor viewport (or some overapproximation
    /// thereof). Intended to be used for opportunistically avoiding
    /// work (in which case
    /// [`skipUntilInView`](#language.ParseContext.skipUntilInView)
    /// should be called to make sure the parser is restarted when the
    /// skipped region becomes visible).
    public viewport: {from: number, to: number},
    /// @internal
    public skipped: {from: number, to: number}[],
    /// This is where skipping parsers can register a promise that,
    /// when resolved, will schedule a new parse. It is cleared when
    /// the parse worker picks up the promise. @internal
    public scheduleOn: Promise<unknown> | null
  ) {}

  /// @internal
  static create(parser: Parser, state: EditorState, viewport: {from: number, to: number}) {
    return new ParseContext(parser, state, [], Tree.empty, 0, viewport, [], null)
  }

  private startParse() {
    return this.parser.startParse(new DocInput(this.state.doc), this.fragments)
  }

  /// @internal
  work(until: number | (() => boolean), upto?: number) {
    if (upto != null && upto >= this.state.doc.length) upto = undefined
    if (this.tree != Tree.empty && this.isDone(upto ?? this.state.doc.length)) {
      this.takeTree()
      return true
    }
    return this.withContext(() => {
      if (typeof until == "number") {
        let endTime = Date.now() + until
        until = () => Date.now() > endTime
      }
      if (!this.parse) this.parse = this.startParse()
      if (upto != null && (this.parse.stoppedAt == null || this.parse.stoppedAt > upto) &&
          upto < this.state.doc.length) this.parse.stopAt(upto)
      for (;;) {
        let done = this.parse.advance()
        if (done) {
          this.fragments = this.withoutTempSkipped(TreeFragment.addTree(done, this.fragments, this.parse.stoppedAt != null))
          this.treeLen = this.parse.stoppedAt ?? this.state.doc.length
          this.tree = done
          this.parse = null
          if (this.treeLen < (upto ?? this.state.doc.length))
            this.parse = this.startParse()
          else
            return true
        }
        if (until()) return false
      }
    })
  }
  
  /// @internal
  takeTree() {
    let pos, tree: Tree | undefined | null
    if (this.parse && (pos = this.parse.parsedPos) >= this.treeLen) {
      if (this.parse.stoppedAt == null || this.parse.stoppedAt > pos) this.parse.stopAt(pos)
      this.withContext(() => { while (!(tree = this.parse!.advance())) {} })
      this.treeLen = pos
      this.tree = tree!
      this.fragments = this.withoutTempSkipped(TreeFragment.addTree(this.tree, this.fragments, true))
      this.parse = null
    }
  }

  private withContext<T>(f: () => T): T {
    let prev = currentContext
    currentContext = this
    try { return f() }
    finally { currentContext = prev }
  }

  private withoutTempSkipped(fragments: readonly TreeFragment[]) {
    for (let r; r = this.tempSkipped.pop();)
      fragments = cutFragments(fragments, r.from, r.to)
    return fragments
  }

  /// @internal
  changes(changes: ChangeDesc, newState: EditorState) {
    let {fragments, tree, treeLen, viewport, skipped} = this
    this.takeTree()
    if (!changes.empty) {
      let ranges: ChangedRange[] = []
      changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({fromA, toA, fromB, toB}))
      fragments = TreeFragment.applyChanges(fragments, ranges)
      tree = Tree.empty
      treeLen = 0
      viewport = {from: changes.mapPos(viewport.from, -1), to: changes.mapPos(viewport.to, 1)}
      if (this.skipped.length) {
        skipped = []
        for (let r of this.skipped) {
          let from = changes.mapPos(r.from, 1), to = changes.mapPos(r.to, -1)
          if (from < to) skipped.push({from, to})
        }
      }
    }
    return new ParseContext(this.parser, newState, fragments, tree, treeLen, viewport, skipped, this.scheduleOn)
  }

  /// @internal
  updateViewport(viewport: {from: number, to: number}) {
    if (this.viewport.from == viewport.from && this.viewport.to == viewport.to) return false
    this.viewport = viewport
    let startLen = this.skipped.length
    for (let i = 0; i < this.skipped.length; i++) {
      let {from, to} = this.skipped[i]
      if (from < viewport.to && to > viewport.from) {
        this.fragments = cutFragments(this.fragments, from, to)
        this.skipped.splice(i--, 1)
      }
    }
    if (this.skipped.length >= startLen) return false
    this.reset()
    return true
  }

  /// @internal
  reset() {
    if (this.parse) {
      this.takeTree()
      this.parse = null
    }
  }

  /// Notify the parse scheduler that the given region was skipped
  /// because it wasn't in view, and the parse should be restarted
  /// when it comes into view.
  skipUntilInView(from: number, to: number) {
    this.skipped.push({from, to})
  }

  /// Returns a parser intended to be used as placeholder when
  /// asynchronously loading a nested parser. It'll skip its input and
  /// mark it as not-really-parsed, so that the next update will parse
  /// it again.
  ///
  /// When `until` is given, a reparse will be scheduled when that
  /// promise resolves.
  static getSkippingParser(until?: Promise<unknown>): Parser {
    return new class extends Parser {
      createParse(
        input: Input,
        fragments: readonly TreeFragment[],
        ranges: readonly {from: number, to: number}[]
      ): PartialParse {
        let from = ranges[0].from, to = ranges[ranges.length - 1].to
        let parser = {
          parsedPos: from,
          advance() {
            let cx = currentContext
            if (cx) {
              for (let r of ranges) cx.tempSkipped.push(r)
              if (until) cx.scheduleOn = cx.scheduleOn ? Promise.all([cx.scheduleOn, until]) : until
            }
            this.parsedPos = to
            return new Tree(NodeType.none, [], [], to - from)
          },
          stoppedAt: null,
          stopAt() {}
        }
        return parser
      }
    }
  }

  /// @internal
  isDone(upto: number) {
    upto = Math.min(upto, this.state.doc.length)
    let frags = this.fragments
    return this.treeLen >= upto && frags.length && frags[0].from == 0 && frags[0].to >= upto
  }

  /// Get the context for the current parse, or `null` if no editor
  /// parse is in progress.
  static get() { return currentContext }
}

function cutFragments(fragments: readonly TreeFragment[], from: number, to: number) {
  return TreeFragment.applyChanges(fragments, [{fromA: from, toA: to, fromB: from, toB: to}])
}

class LanguageState {
  // The current tree. Immutable, because directly accessible from
  // the editor state.
  readonly tree: Tree

  constructor(
    // A mutable parse state that is used to preserve work done during
    // the lifetime of a state when moving to the next state.
    readonly context: ParseContext
  ) {
    this.tree = context.tree
  }

  apply(tr: Transaction) {
    if (!tr.docChanged && this.tree == this.context.tree) return this
    let newCx = this.context.changes(tr.changes, tr.state)
    // If the previous parse wasn't done, go forward only up to its
    // end position or the end of the viewport, to avoid slowing down
    // state updates with parse work beyond the viewport.
    let upto = this.context.treeLen == tr.startState.doc.length ? undefined
      : Math.max(tr.changes.mapPos(this.context.treeLen), newCx.viewport.to)
    if (!newCx.work(Work.Apply, upto)) newCx.takeTree()
    return new LanguageState(newCx)
  }

  static init(state: EditorState) {
    let vpTo = Math.min(Work.InitViewport, state.doc.length)
    let parseState = ParseContext.create(state.facet(language)!.parser, state, {from: 0, to: vpTo})
    if (!parseState.work(Work.Apply, vpTo)) parseState.takeTree()
    return new LanguageState(parseState)
  }
}

Language.state = StateField.define<LanguageState>({
  create: LanguageState.init,
  update(value, tr) {
    for (let e of tr.effects) if (e.is(Language.setState)) return e.value
    if (tr.startState.facet(language) != tr.state.facet(language)) return LanguageState.init(tr.state)
    return value.apply(tr)
  }
})

let requestIdle = (callback: (deadline?: IdleDeadline) => void) => {
  let timeout = setTimeout(() => callback(), Work.MaxPause)
  return () => clearTimeout(timeout)
}

if (typeof requestIdleCallback != "undefined") requestIdle = (callback: (deadline?: IdleDeadline) => void) => {
  let idle = -1, timeout = setTimeout(() => {
    idle = requestIdleCallback(callback, {timeout: Work.MaxPause - Work.MinPause})
  }, Work.MinPause)
  return () => idle < 0 ? clearTimeout(timeout) : cancelIdleCallback(idle)
}

const isInputPending = typeof navigator != "undefined" && (navigator as any).scheduling?.isInputPending
  ? () => (navigator as any).scheduling.isInputPending() : null

const ProvisionalEditDebounce = 50
const ProvisionalDebug = Symbol.for("@codemirror/language.viewportPriorityDebug")

interface ProvisionalParse {
  generation: number,
  doc: Text,
  language: Language,
  from: number,
  to: number,
  parse: PartialParse | null,
  tree: Tree | null,
  published: boolean,
  failed: boolean
}

/// @internal
export function provisionalParseIsCurrent(task: ProvisionalParse | null, generation: number,
                                          doc: Text, lang: Language | null, destroyed: boolean) {
  return !!task?.parse && !destroyed && task.generation == generation &&
    task.doc == doc && task.language == lang
}

export interface ViewportPriorityTree {
  tree: Tree,
  from: number,
  to: number,
  version: number,
  approximate: "outer-language"
}

class ParseWorker {
  working: (() => void) | null = null
  workScheduled = 0
  // End of the current time chunk
  chunkEnd = -1
  // Milliseconds of budget left for this chunk
  chunkBudget = -1
  provisional: ProvisionalParse | null = null
  provisionalTimer = -1
  provisionalGeneration = 0
  provisionalVersion = 0
  destroyed = false

  constructor(readonly view: EditorView) {
    this.work = this.work.bind(this)
    this.workProvisional = this.workProvisional.bind(this)
    this.scheduleWork()
    this.restartProvisional()
    Object.defineProperty(this.view, ProvisionalDebug, {
      configurable: true,
      value: () => ({
        generation: this.provisionalGeneration,
        version: this.provisionalVersion,
        pending: !!this.provisional?.parse,
        published: !!this.provisional?.published,
        failed: !!this.provisional?.failed
      })
    })
  }

  update(update: ViewUpdate) {
    let cx = this.view.state.field(Language.state).context
    if (cx.updateViewport(update.view.viewport) || this.view.viewport.to > cx.treeLen)
      this.scheduleWork()
    if (update.docChanged || update.selectionSet) {
      if (this.view.hasFocus) this.chunkBudget += Work.ChangeBonus
      this.scheduleWork()
    }
    let languageChanged = update.startState.facet(language) != update.state.facet(language)
    if (update.docChanged || languageChanged)
      this.clearProvisional()
    this.restartProvisional(update.docChanged ? ProvisionalEditDebounce : 0)
    if (update.viewportChanged && !update.docChanged && !languageChanged) this.workProvisional(false)
    this.checkAsyncSchedule(cx)
  }

  private provisionalRange() {
    let ranges = this.view.visibleRanges
    if (!ranges.length) return null
    let doc = this.view.state.doc
    let from = doc.lineAt(ranges[0].from).from
    let to = doc.lineAt(ranges[ranges.length - 1].to).to
    return from < to ? {from, to} : null
  }

  private clearProvisional(notify = false) {
    if (this.provisionalTimer > -1) clearTimeout(this.provisionalTimer)
    this.provisionalTimer = -1
    this.provisionalGeneration++
    let hadTree = !!this.provisional?.tree
    this.provisional = null
    if (notify && hadTree) this.provisionalVersion++
  }

  private restartProvisional(delay = 0) {
    let config = this.view.state.facet(viewportPriorityParsingFacet)
    let lang = this.view.state.facet(language)
    let range = this.provisionalRange()
    let cx = this.view.state.field(Language.state).context
    if (!config || !lang || !range || cx.isDone(range.to)) {
      this.clearProvisional(true)
      return
    }

    let current = this.provisional
    if (current && current.doc == this.view.state.doc && current.language == lang &&
        current.from == range.from && current.to == range.to) return

    this.clearProvisional(true)
    let generation = ++this.provisionalGeneration
    try {
      this.provisional = {
        generation,
        doc: this.view.state.doc,
        language: lang,
        from: range.from,
        to: range.to,
        parse: lang.parser.startParse(new DocInput(this.view.state.doc), [], [range]),
        tree: null,
        published: false,
        failed: false
      }
      this.scheduleProvisional(delay)
    } catch (error) {
      this.provisional = {
        generation,
        doc: this.view.state.doc,
        language: lang,
        from: range.from,
        to: range.to,
        parse: null,
        tree: null,
        published: false,
        failed: true
      }
      this.provisionalTimer = setTimeout(() => {
        this.provisionalTimer = -1
        if (!this.destroyed && this.provisional?.generation == generation && this.provisional.failed)
          this.view.dispatch({})
      }, 0) as any
      logException(this.view.state, error, "viewport-priority parse")
    }
  }

  private scheduleProvisional(delay = 0) {
    if (this.provisionalTimer > -1 || !this.provisional || this.destroyed) return
    this.provisionalTimer = setTimeout(this.workProvisional, Math.max(0, delay)) as any
  }

  private renderCritical() {
    return !!(this.view as any).controlledTouchScrollController?.renderCritical
  }

  private publishProvisional(task: ProvisionalParse, notify: boolean) {
    task.published = true
    this.provisionalVersion++
    if (notify) {
      this.view.dispatch({})
    } else {
      let generation = task.generation
      this.provisionalTimer = setTimeout(() => {
        this.provisionalTimer = -1
        if (!this.destroyed && this.provisional?.generation == generation && this.provisional.published)
          this.view.dispatch({})
      }, 0) as any
    }
  }

  private workProvisional(notify = true) {
    if (this.provisionalTimer > -1) clearTimeout(this.provisionalTimer)
    this.provisionalTimer = -1
    let task = this.provisional
    let config = this.view.state.facet(viewportPriorityParsingFacet)
    if (task?.tree && !task.published) {
      if (this.renderCritical() || isInputPending?.()) this.scheduleProvisional(16)
      else this.publishProvisional(task, notify)
      return
    }
    if (!config || !provisionalParseIsCurrent(task, this.provisionalGeneration, this.view.state.doc,
                                              this.view.state.facet(language), this.destroyed)) return

    if (this.renderCritical() || isInputPending?.()) {
      this.scheduleProvisional(16)
      return
    }

    let clock = this.view.win.performance
    let end = clock.now() + config.sliceMs
    let tree: Tree | null = null
    do {
      tree = task.parse.advance()
      if (tree || notify && isInputPending && isInputPending()) break
    } while (clock.now() < end)

    if (tree) {
      task.tree = tree
      task.parse = null
      if (this.renderCritical() || isInputPending?.()) this.scheduleProvisional(16)
      else this.publishProvisional(task, notify)
    } else {
      this.scheduleProvisional()
    }
  }

  viewportTree(): ViewportPriorityTree | null {
    let task = this.provisional
    return task?.tree && task.published && task.doc == this.view.state.doc ? {
      tree: task.tree,
      from: task.from,
      to: task.to,
      version: this.provisionalVersion,
      approximate: "outer-language"
    } : null
  }

  provisionalPending() {
    return !!(this.provisionalTimer > -1 || this.provisional?.parse ||
      this.provisional?.tree && !this.provisional.published)
  }

  scheduleWork() {
    if (this.working) return
    let {state} = this.view, field = state.field(Language.state)
    if (field.tree != field.context.tree || !field.context.isDone(state.doc.length))
      this.working = requestIdle(this.work)
  }

  work(deadline?: IdleDeadline) {
    this.working = null

    if (this.renderCritical()) {
      this.scheduleWork()
      return
    }

    let now = Date.now()
    if (this.chunkEnd < now && (this.chunkEnd < 0 || this.view.hasFocus)) { // Start a new chunk
      this.chunkEnd = now + Work.ChunkTime
      this.chunkBudget = Work.ChunkBudget
    }
    if (this.chunkBudget <= 0) return // No more budget

    let {state, viewport: {to: vpTo}} = this.view, field = state.field(Language.state)
    if (field.tree == field.context.tree && field.context.isDone(vpTo + Work.MaxParseAhead)) return
    let endTime = Date.now() + Math.min(
      this.chunkBudget, Work.Slice, deadline && !isInputPending ? Math.max(Work.MinSlice, deadline.timeRemaining() - 5) : 1e9)
    let viewportFirst = field.context.treeLen < vpTo && state.doc.length > vpTo + 1000
    let done = field.context.work(() => {
      return this.renderCritical() || isInputPending && isInputPending() || Date.now() > endTime
    } , vpTo + (viewportFirst ? 0 : Work.MaxParseAhead))
    this.chunkBudget -= Date.now() - now
    if (done || this.chunkBudget <= 0) {
      field.context.takeTree()
      this.view.dispatch({effects: Language.setState.of(new LanguageState(field.context))})
    }
    if (this.chunkBudget > 0 && !(done && !viewportFirst)) this.scheduleWork()
    this.checkAsyncSchedule(field.context)
  }

  checkAsyncSchedule(cx: ParseContext) {
    if (cx.scheduleOn) {
      this.workScheduled++
      cx.scheduleOn
        .then(() => this.scheduleWork())
        .catch(err => logException(this.view.state, err))
        .then(() => this.workScheduled--)
      cx.scheduleOn = null
    }
  }

  destroy() {
    this.destroyed = true
    if (this.working) this.working()
    this.clearProvisional()
    delete (this.view as any)[ProvisionalDebug]
  }

  isWorking() {
    return !!(this.working || this.workScheduled > 0 || this.provisionalTimer > -1 || this.provisional?.parse)
  }
}

const parseWorker = ViewPlugin.fromClass(ParseWorker, {
  eventHandlers: {focus() { this.scheduleWork() }}
})

/// @internal
export function viewportPriorityTree(view: EditorView): ViewportPriorityTree | null {
  return view.plugin(parseWorker)?.viewportTree() || null
}

/// @internal
export function viewportPriorityParsingPending(view: EditorView) {
  return !!view.plugin(parseWorker)?.provisionalPending()
}

/// @internal
export function viewportPriorityParsingFailed(view: EditorView) {
  return !!view.plugin(parseWorker)?.provisional?.failed
}

/// The facet used to associate a language with an editor state. Used
/// by `Language` object's `extension` property (so you don't need to
/// manually wrap your languages in this). Can be used to access the
/// current language on a state.
export const language = Facet.define<Language, Language | null>({
  combine(languages) { return languages.length ? languages[0] : null },
  enables: language => [
    Language.state,
    parseWorker,
    EditorView.contentAttributes.compute([language], state => {
      let lang = state.facet(language)
      return lang && lang.name ? {"data-language": lang.name} : {} as {}
    })
  ]
})

/// This class bundles a [language](#language.Language) with an
/// optional set of supporting extensions. Language packages are
/// encouraged to export a function that optionally takes a
/// configuration object and returns a `LanguageSupport` instance, as
/// the main way for client code to use the package.
export class LanguageSupport {
  /// An extension including both the language and its support
  /// extensions. (Allowing the object to be used as an extension
  /// value itself.)
  extension: Extension

  /// Create a language support object.
  constructor(
    /// The language object.
    readonly language: Language,
    /// An optional set of supporting extensions. When nesting a
    /// language in another language, the outer language is encouraged
    /// to include the supporting extensions for its inner languages
    /// in its own set of support extensions.
    readonly support: Extension = []
  ) {
    this.extension = [language, support]
  }
}

/// Language descriptions are used to store metadata about languages
/// and to dynamically load them. Their main role is finding the
/// appropriate language for a filename or dynamically loading nested
/// parsers.
export class LanguageDescription {
  private loading: Promise<LanguageSupport> | null = null

  private constructor(
    /// The name of this language.
    readonly name: string,
    /// Alternative names for the mode (lowercased, includes `this.name`).
    readonly alias: readonly string[],
    /// File extensions associated with this language.
    readonly extensions: readonly string[],
    /// Optional filename pattern that should be associated with this
    /// language.
    readonly filename: RegExp | undefined,
    private loadFunc: () => Promise<LanguageSupport>,
    /// If the language has been loaded, this will hold its value.
    public support: LanguageSupport | undefined = undefined
  ) {}

  /// Start loading the the language. Will return a promise that
  /// resolves to a [`LanguageSupport`](#language.LanguageSupport)
  /// object when the language successfully loads.
  load(): Promise<LanguageSupport> {
    return this.loading || (this.loading = this.loadFunc().then(
      support => this.support = support,
      err => { this.loading = null; throw err }
    ))
  }

  /// Create a language description.
  static of(spec: {
    /// The language's name.
    name: string,
    /// An optional array of alternative names.
    alias?: readonly string[],
    /// An optional array of filename extensions associated with this
    /// language.
    extensions?: readonly string[],
    /// An optional filename pattern associated with this language.
    filename?: RegExp,
    /// A function that will asynchronously load the language.
    load?: () => Promise<LanguageSupport>,
    /// Alternatively to `load`, you can provide an already loaded
    /// support object. Either this or `load` should be provided.
    support?: LanguageSupport
  }) {
    let {load, support} = spec
    if (!load) {
      if (!support) throw new RangeError("Must pass either 'load' or 'support' to LanguageDescription.of")
      load = () => Promise.resolve(support!)
    }
    return new LanguageDescription(spec.name, (spec.alias || []).concat(spec.name).map(s => s.toLowerCase()),
                                   spec.extensions || [], spec.filename, load, support)
  }

  /// Look for a language in the given array of descriptions that
  /// matches the filename. Will first match
  /// [`filename`](#language.LanguageDescription.filename) patterns,
  /// and then [extensions](#language.LanguageDescription.extensions),
  /// and return the first language that matches.
  static matchFilename(descs: readonly LanguageDescription[], filename: string) {
    for (let d of descs) if (d.filename && d.filename.test(filename)) return d
    let ext = /\.([^.]+)$/.exec(filename)
    if (ext) for (let d of descs) if (d.extensions.indexOf(ext[1]) > -1) return d
    return null
  }

  /// Look for a language whose name or alias matches the the given
  /// name (case-insensitively). If `fuzzy` is true, and no direct
  /// matchs is found, this'll also search for a language whose name
  /// or alias occurs in the string (for names shorter than three
  /// characters, only when surrounded by non-word characters).
  static matchLanguageName(descs: readonly LanguageDescription[], name: string, fuzzy = true) {
    name = name.toLowerCase()
    for (let d of descs) if (d.alias.some(a => a == name)) return d
    if (fuzzy) for (let d of descs) for (let a of d.alias) {
      let found = name.indexOf(a)
      if (found > -1 && (a.length > 2 || !/\w/.test(name[found - 1]) && !/\w/.test(name[found + a.length])))
        return d
    }
    return null
  }
}
