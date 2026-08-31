import {NodeProp, SyntaxNode, NodeIterator, Tree} from "@lezer/common"
import {EditorState, Extension, Facet, countColumn, ChangeSpec} from "@codemirror/state"
import {syntaxTree} from "./language"

/// Facet that defines a way to provide a function that computes the
/// appropriate indentation depth, as a column number (see
/// [`indentString`](#language.indentString)), at the start of a given
/// line. A return value of `null` indicates no indentation can be
/// determined, and the line should inherit the indentation of the one
/// above it. A return value of `undefined` defers to the next indent
/// service.
export const indentService = Facet.define<(context: IndentContext, pos: number) => number | null | undefined>()

/// Facet for overriding the unit by which indentation happens. Should
/// be a string consisting entirely of the same whitespace character.
/// When not set, this defaults to 2 spaces.
export const indentUnit = Facet.define<string, string>({
  combine: values => {
    if (!values.length) return "  "
    let unit = values[0]
    if (!unit || /\S/.test(unit) || Array.from(unit).some(e => e != unit[0]))
      throw new Error("Invalid indent unit: " + JSON.stringify(values[0]))
    return unit
  }
})

/// Return the _column width_ of an indent unit in the state.
/// Determined by the [`indentUnit`](#language.indentUnit)
/// facet, and [`tabSize`](#state.EditorState^tabSize) when that
/// contains tabs.
export function getIndentUnit(state: EditorState) {
  let unit = state.facet(indentUnit)
  return unit.charCodeAt(0) == 9 ? state.tabSize * unit.length : unit.length
}

/// Create an indentation string that covers columns 0 to `cols`.
/// Will use tabs for as much of the columns as possible when the
/// [`indentUnit`](#language.indentUnit) facet contains
/// tabs.
export function indentString(state: EditorState, cols: number) {
  let result = "", ts = state.tabSize, ch = state.facet(indentUnit)[0]
  if (ch == "\t") {
    while (cols >= ts) {
      result += "\t"
      cols -= ts
    }
    ch = " "
  }
  for (let i = 0; i < cols; i++) result += ch
  return result
}

/// Get the indentation, as a column number, at the given position.
/// Will first consult any [indent services](#language.indentService)
/// that are registered, and if none of those return an indentation,
/// this will check the syntax tree for the [indent node
/// prop](#language.indentNodeProp) and use that if found. Returns a
/// number when an indentation could be determined, and null
/// otherwise.
export function getIndentation(context: IndentContext | EditorState, pos: number): number | null {
  if (context instanceof EditorState) context = new IndentContext(context)
  for (let service of context.state.facet(indentService)) {
    let result = service(context, pos)
    if (result !== undefined) return result
  }
  let tree = syntaxTree(context.state)
  return tree.length >= pos ? syntaxIndentation(context, tree, pos) : null
}

/// Create a change set that auto-indents all lines touched by the
/// given document range.
export function indentRange(state: EditorState, from: number, to: number) {
  let updated: {[lineStart: number]: number} = Object.create(null)
  let context = new IndentContext(state, {overrideIndentation: start => updated[start] ?? -1})
  let changes: ChangeSpec[] = []
  for (let pos = from; pos <= to;) {
    let line = state.doc.lineAt(pos)
    pos = line.to + 1
    let indent = getIndentation(context, line.from)
    if (indent == null) continue
    if (!/\S/.test(line.text)) indent = 0
    let cur = /^\s*/.exec(line.text)![0]
    let norm = indentString(state, indent)
    if (cur != norm) {
      updated[line.from] = indent
      changes.push({from: line.from, to: line.from + cur.length, insert: norm})
    }
  }
  return state.changes(changes)
}

/// Indentation contexts are used when calling [indentation
/// services](#language.indentService). They provide helper utilities
/// useful in indentation logic, and can selectively override the
/// indentation reported for some lines.
export class IndentContext {
  /// The indent unit (number of columns per indentation level).
  unit: number

  /// Create an indent context.
  constructor(
    /// The editor state.
    readonly state: EditorState,
    /// @internal
    readonly options: {
      /// Override line indentations provided to the indentation
      /// helper function, which is useful when implementing region
      /// indentation, where indentation for later lines needs to refer
      /// to previous lines, which may have been reindented compared to
      /// the original start state. If given, this function should
      /// return -1 for lines (given by start position) that didn't
      /// change, and an updated indentation otherwise.
      overrideIndentation?: (pos: number) => number,
      /// Make it look, to the indent logic, like a line break was
      /// added at the given position (which is mostly just useful for
      /// implementing something like
      /// [`insertNewlineAndIndent`](#commands.insertNewlineAndIndent)).
      simulateBreak?: number,
      /// When `simulateBreak` is given, this can be used to make the
      /// simulated break behave like a double line break.
      simulateDoubleBreak?: boolean
    } = {}
  ) {
    this.unit = getIndentUnit(state)
  }

  /// Get a description of the line at the given position, taking
  /// [simulated line
  /// breaks](#language.IndentContext.constructor^options.simulateBreak)
  /// into account. If there is such a break at `pos`, the `bias`
  /// argument determines whether the part of the line line before or
  /// after the break is used.
  lineAt(pos: number, bias: -1 | 1 = 1): {text: string, from: number} {
    let line = this.state.doc.lineAt(pos)
    let {simulateBreak, simulateDoubleBreak} = this.options
    if (simulateBreak != null && simulateBreak >= line.from && simulateBreak <= line.to) {
      if (simulateDoubleBreak && simulateBreak == pos)
        return {text: "", from: pos}
      else if (bias < 0 ? simulateBreak < pos : simulateBreak <= pos)
        return {text: line.text.slice(simulateBreak - line.from), from: simulateBreak}
      else
        return {text: line.text.slice(0, simulateBreak - line.from), from: line.from}
    }
    return line
  }

  /// Get the text directly after `pos`, either the entire line
  /// or the next 100 characters, whichever is shorter.
  textAfterPos(pos: number, bias: -1 | 1 = 1) {
    if (this.options.simulateDoubleBreak && pos == this.options.simulateBreak) return ""
    let {text, from} = this.lineAt(pos, bias)
    return text.slice(pos - from, Math.min(text.length, pos + 100 - from))
  }

  /// Find the column for the given position.
  column(pos: number, bias: -1 | 1 = 1) {
    let {text, from} = this.lineAt(pos, bias)
    let result = this.countColumn(text, pos - from)
    let override = this.options.overrideIndentation ? this.options.overrideIndentation(from) : -1
    if (override > -1) result += override - this.countColumn(text, text.search(/\S|$/))
    return result
  }

  /// Find the column position (taking tabs into account) of the given
  /// position in the given string.
  countColumn(line: string, pos: number = line.length) {
    return countColumn(line, this.state.tabSize, pos)
  }

  /// Find the indentation column of the line at the given point.
  lineIndent(pos: number, bias: -1 | 1 = 1) {
    let {text, from} = this.lineAt(pos, bias)
    let override = this.options.overrideIndentation
    if (override) {
      let overriden = override(from)
      if (overriden > -1) return overriden
    }
    return this.countColumn(text, text.search(/\S|$/))
  }

  /// Returns the [simulated line
  /// break](#language.IndentContext.constructor^options.simulateBreak)
  /// for this context, if any.
  get simulatedBreak(): number | null {
    return this.options.simulateBreak || null
  }
}

/// A syntax tree node prop used to associate indentation strategies
/// with node types. Such a strategy is a function from an indentation
/// context to a column number (see also
/// [`indentString`](#language.indentString)) or null, where null
/// indicates that no definitive indentation can be determined.
export const indentNodeProp = new NodeProp<(context: TreeIndentContext) => number | null>()

// Compute the indentation for a given position from the syntax tree.
function syntaxIndentation(cx: IndentContext, ast: Tree, pos: number) {
  let stack = ast.resolveStack(pos)
  let inner = ast.resolveInner(pos, -1).resolve(pos, 0).enterUnfinishedNodesBefore(pos)
  if (inner != stack.node) {
    let add = []
    for (let cur = inner; cur && !(
      cur.from < stack.node.from || cur.to > stack.node.to ||
      cur.from == stack.node.from && cur.type == stack.node.type
    ); cur = cur.parent!) add.push(cur)
    for (let i = add.length - 1; i >= 0; i--) stack = {node: add[i], next: stack}
  }
  return indentFor(stack, cx, pos)
}

function indentFor(stack: NodeIterator | null, cx: IndentContext, pos: number): number | null {
  for (let cur: NodeIterator | null = stack; cur; cur = cur.next) {
    let strategy = indentStrategy(cur.node)
    if (strategy) return strategy(TreeIndentContext.create(cx, pos, cur))
  }
  return 0
}

function ignoreClosed(cx: TreeIndentContext) {
  return cx.pos == cx.options.simulateBreak && cx.options.simulateDoubleBreak
}

function indentStrategy(tree: SyntaxNode): ((context: TreeIndentContext) => number | null) | null {
  let strategy = tree.type.prop(indentNodeProp)
  if (strategy) return strategy
  let first = tree.firstChild, close: readonly string[] | undefined
  if (first && (close = first.type.prop(NodeProp.closedBy))) {
    let last = tree.lastChild, closed = last && close.indexOf(last.name) > -1
    return cx => delimitedStrategy(cx, true, 1, undefined, closed && !ignoreClosed(cx) ? last!.from : undefined)
  }
  return tree.parent == null ? topIndent : null
}

function topIndent() { return 0 }

/// Objects of this type provide context information and helper
/// methods to indentation functions registered on syntax nodes.
export class TreeIndentContext extends IndentContext {
  private constructor(
    private base: IndentContext,
    /// The position at which indentation is being computed.
    readonly pos: number,
    /// @internal
    readonly context: NodeIterator
  ) {
    super(base.state, base.options)
  }

  /// The syntax tree node to which the indentation strategy
  /// applies.
  get node(): SyntaxNode { return this.context.node }


  /// @internal
  static create(base: IndentContext, pos: number, context: NodeIterator) {
    return new TreeIndentContext(base, pos, context)
  }

  /// Get the text directly after `this.pos`, either the entire line
  /// or the next 100 characters, whichever is shorter.
  get textAfter() {
    return this.textAfterPos(this.pos)
  }

  /// Get the indentation at the reference line for `this.node`, which
  /// is the line on which it starts, unless there is a node that is
  /// _not_ a parent of this node covering the start of that line. If
  /// so, the line at the start of that node is tried, again skipping
  /// on if it is covered by another such node.
  get baseIndent() {
    return this.baseIndentFor(this.node)
  }

  /// Get the indentation for the reference line of the given node
  /// (see [`baseIndent`](#language.TreeIndentContext.baseIndent)).
  baseIndentFor(node: SyntaxNode) {
    let line = this.state.doc.lineAt(node.from)
    // Skip line starts that are covered by a sibling (or cousin, etc)
    for (;;) {
      let atBreak = node.resolve(line.from)
      while (atBreak.parent && atBreak.parent.from == atBreak.from) atBreak = atBreak.parent
      if (isParent(atBreak, node)) break
      line = this.state.doc.lineAt(atBreak.from)
    }
    return this.lineIndent(line.from)
  }

  /// Continue looking for indentations in the node's parent nodes,
  /// and return the result of that.
  continue() {
    return indentFor(this.context.next, this.base, this.pos)
  }
}

function isParent(parent: SyntaxNode, of: SyntaxNode) {
  for (let cur: SyntaxNode | null = of; cur; cur = cur.parent) if (parent == cur) return true
  return false
}

// Check whether a delimited node is aligned (meaning there are
// non-skipped nodes on the same line as the opening delimiter). And
// if so, return the opening token.
function bracketedAligned(context: TreeIndentContext) {
  let tree = context.node
  let openToken = tree.childAfter(tree.from), last = tree.lastChild
  if (!openToken) return null
  let sim = context.options.simulateBreak
  let openLine = context.state.doc.lineAt(openToken.from)
  let lineEnd = sim == null || sim <= openLine.from ? openLine.to : Math.min(openLine.to, sim)
  for (let pos = openToken.to;;) {
    let next = tree.childAfter(pos)
    if (!next || next == last) return null
    if (!next.type.isSkipped) {
      if (next.from >= lineEnd) return null
      let space = /^ */.exec(openLine.text.slice(openToken.to - openLine.from))![0].length
      return {from: openToken.from, to: openToken.to + space}
    }
    pos = next.to
  }
}

/// An indentation strategy for delimited (usually bracketed) nodes.
/// Will, by default, indent one unit more than the parent's base
/// indent unless the line starts with a closing token. When `align`
/// is true and there are non-skipped nodes on the node's opening
/// line, the content of the node will be aligned with the end of the
/// opening node, like this:
///
///     foo(bar,
///         baz)
export function delimitedIndent({closing, align = true, units = 1}: {closing: string, align?: boolean, units?: number}) {
  return (context: TreeIndentContext) => delimitedStrategy(context, align, units, closing)
}

function delimitedStrategy(context: TreeIndentContext, align: boolean, units: number, closing?: string, closedAt?: number) {
  let after = context.textAfter, space = after.match(/^\s*/)![0].length
  let closed = closing && after.slice(space, space + closing.length) == closing || closedAt == context.pos + space
  let aligned = align ? bracketedAligned(context) : null
  if (aligned) return closed ? context.column(aligned.from) : context.column(aligned.to)
  return context.baseIndent + (closed ? 0 : context.unit * units)
}

/// An indentation strategy that aligns a node's content to its base
/// indentation.
export const flatIndent = (context: TreeIndentContext) => context.baseIndent

/// Creates an indentation strategy that, by default, indents
/// continued lines one unit more than the node's base indentation.
/// You can provide `except` to prevent indentation of lines that
/// match a pattern (for example `/^else\b/` in `if`/`else`
/// constructs), and you can change the amount of units used with the
/// `units` option.
export function continuedIndent({except, units = 1}: {except?: RegExp, units?: number} = {}) {
  return (context: TreeIndentContext) => {
    let matchExcept = except && except.test(context.textAfter)
    return context.baseIndent + (matchExcept ? 0 : units * context.unit)
  }
}

const DontIndentBeyond = 200

/// Enables reindentation on input. When a language defines an
/// `indentOnInput` field in its [language
/// data](#state.EditorState.languageDataAt), which must hold a regular
/// expression, the line at the cursor will be reindented whenever new
/// text is typed and the input from the start of the line up to the
/// cursor matches that regexp.
///
/// To avoid unneccesary reindents, it is recommended to start the
/// regexp with `^` (usually followed by `\s*`), and end it with `$`.
/// For example, `/^\s*\}$/` will reindent when a closing brace is
/// added at the start of a line.
export function indentOnInput(): Extension {
  return EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || !tr.isUserEvent("input.type") && !tr.isUserEvent("input.complete")) return tr
    let rules = tr.startState.languageDataAt<RegExp>("indentOnInput", tr.startState.selection.main.head)
    if (!rules.length) return tr
    let doc = tr.newDoc, {head} = tr.newSelection.main, line = doc.lineAt(head)
    if (head > line.from + DontIndentBeyond) return tr
    let lineStart = doc.sliceString(line.from, head)
    if (!rules.some(r => r.test(lineStart))) return tr
    let {state} = tr, last = -1, changes = []
    for (let {head} of state.selection.ranges) {
      let line = state.doc.lineAt(head)
      if (line.from == last) continue
      last = line.from
      let indent = getIndentation(state, line.from)
      if (indent == null) continue
      let cur = /^\s*/.exec(line.text)![0]
      let norm = indentString(state, indent)
      if (cur != norm)
        changes.push({from: line.from, to: line.from + cur.length, insert: norm})
    }
    return changes.length ? [tr, {changes, sequential: true}] : tr
  })
}
