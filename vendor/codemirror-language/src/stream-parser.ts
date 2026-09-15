import {Tree, Input, TreeFragment, NodeType, NodeSet, PartialParse, Parser, NodeProp} from "@lezer/common"
import {Tag, tags as highlightTags, styleTags} from "@lezer/highlight"
import {EditorState, Facet} from "@codemirror/state"
import {Language, defineLanguageFacet, languageDataProp, ParseContext} from "./language"
import {TreeIndentContext, IndentContext, indentNodeProp, getIndentUnit} from "./indent"
import {StringStream} from "./stringstream"

export {StringStream}

/// A stream parser parses or tokenizes content from start to end,
/// emitting tokens as it goes over it. It keeps a mutable (but
/// copyable) object with state, in which it can store information
/// about the current context.
export interface StreamParser<State> {
  /// A name for this language.
  name?: string
  /// Produce a start state for the parser.
  startState?(indentUnit: number): State
  /// Read one token, advancing the stream past it, and returning a
  /// string indicating the token's style tag—either the name of one
  /// of the tags in
  /// [`tags`](https://lezer.codemirror.net/docs/ref#highlight.tags)
  /// or [`tokenTable`](#language.StreamParser.tokenTable), or such a
  /// name suffixed by one or more tag
  /// [modifier](https://lezer.codemirror.net/docs/ref#highlight.Tag^defineModifier)
  /// names, separated by periods. For example `"keyword"` or
  /// "`variableName.constant"`, or a space-separated set of such
  /// token types.
  ///
  /// It is okay to return a zero-length token, but only if that
  /// updates the state so that the next call will return a non-empty
  /// token again.
  token(stream: StringStream, state: State): string | null
  /// This notifies the parser of a blank line in the input. It can
  /// update its state here if it needs to.
  blankLine?(state: State, indentUnit: number): void
  /// Copy a given state. By default, a shallow object copy is done
  /// which also copies arrays held at the top level of the object.
  copyState?(state: State): State
  /// Compute automatic indentation for the line that starts with the
  /// given state and text.
  indent?(state: State, textAfter: string, context: IndentContext): number | null
  /// Default [language data](#state.EditorState.languageDataAt) to
  /// attach to this language.
  languageData?: {[name: string]: any}
  /// Extra tokens to use in this parser. When the tokenizer returns a
  /// token name that exists as a property in this object, the
  /// corresponding tags will be assigned to the token.
  tokenTable?: {[name: string]: Tag | readonly Tag[]}
  /// By default, adjacent tokens of the same type are merged in the
  /// output tree. Set this to false to disable that.
  mergeTokens?: boolean
}

function fullParser<State>(spec: StreamParser<State>): Required<StreamParser<State>> {
  return {
    name: spec.name || "",
    token: spec.token,
    blankLine: spec.blankLine || (() => {}),
    startState: spec.startState || (() => (true as any)),
    copyState: spec.copyState || defaultCopyState,
    indent: spec.indent || (() => null),
    languageData: spec.languageData || {},
    tokenTable: spec.tokenTable || noTokens,
    mergeTokens: spec.mergeTokens !== false
  }
}

function defaultCopyState<State>(state: State) {
  if (typeof state != "object") return state
  let newState = {} as State
  for (let prop in state) {
    let val = state[prop]
    newState[prop] = (val instanceof Array ? val.slice() : val) as any
  }
  return newState
}

const IndentedFrom = new WeakMap<EditorState, number>()

/// A [language](#language.Language) class based on a CodeMirror
/// 5-style [streaming parser](#language.StreamParser).
export class StreamLanguage<State> extends Language {
  /// @internal
  streamParser: Required<StreamParser<State>>
  /// @internal
  stateAfter: NodeProp<State>
  /// @internal
  tokenTable: TokenTable
  /// @internal
  topNode: NodeType

  private constructor(parser: StreamParser<State>) {
    let data = defineLanguageFacet(parser.languageData)
    let p = fullParser(parser), self: StreamLanguage<State>
    let impl = new class extends Parser {
      createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly {from: number, to: number}[]) {
        return new Parse(self, input, fragments, ranges)
      }
    }
    super(data, impl, [], parser.name)
    this.topNode = docID(data, this)
    self = this
    this.streamParser = p
    this.stateAfter = new NodeProp<State>({perNode: true})
    this.tokenTable = parser.tokenTable ? new TokenTable(p.tokenTable) : defaultTokenTable
  }

  /// Define a stream language.
  static define<State>(spec: StreamParser<State>) { return new StreamLanguage(spec) }

  /// @internal
  getIndent(cx: TreeIndentContext) {
    let from = undefined
    let {overrideIndentation} = cx.options
    if (overrideIndentation) {
      from = IndentedFrom.get(cx.state)
      if (from != null && from < cx.pos - 1e4) from = undefined
    }
    let start = findState(this, cx.node.tree!, cx.node.from, cx.node.from, from ?? cx.pos), statePos, state
    if (start) { state = start.state; statePos = start.pos + 1 }
    else { state = this.streamParser.startState(cx.unit) ; statePos = cx.node.from }
    if (cx.pos - statePos > C.MaxIndentScanDist) return null
    while (statePos < cx.pos) {
      let line = cx.state.doc.lineAt(statePos), end = Math.min(cx.pos, line.to)
      if (line.length) {
        let indentation = overrideIndentation ? overrideIndentation(line.from) : -1
        let stream = new StringStream(line.text, cx.state.tabSize, cx.unit, indentation < 0 ? undefined : indentation)
        while (stream.pos < end - line.from)
          readToken(this.streamParser.token, stream, state)
      } else {
        this.streamParser.blankLine(state, cx.unit)
      }
      if (end == cx.pos) break
      statePos = line.to + 1
    }
    let line = cx.lineAt(cx.pos)
    if (overrideIndentation && from == null) IndentedFrom.set(cx.state, line.from)
    return this.streamParser.indent(state, /^\s*(.*)/.exec(line.text)![1], cx)
  }

  get allowsNesting() { return false }
}

function findState<State>(
  lang: StreamLanguage<State>, tree: Tree, off: number, startPos: number, before: number
): {state: State, pos: number} | null {
  let state = off >= startPos && off + tree.length <= before && tree.prop(lang.stateAfter)
  if (state) return {state: lang.streamParser.copyState(state), pos: off + tree.length}
  for (let i = tree.children.length - 1; i >= 0; i--) {
    let child = tree.children[i], pos = off + tree.positions[i]
    let found = child instanceof Tree && pos < before && findState(lang, child, pos, startPos, before)
    if (found) return found
  }
  return null
}

function cutTree(lang: StreamLanguage<unknown>, tree: Tree, from: number, to: number, inside: boolean): Tree | null {
  if (inside && from <= 0 && to >= tree.length) return tree
  if (!inside && from == 0 && tree.type == lang.topNode) inside = true
  for (let i = tree.children.length - 1; i >= 0; i--) {
    let pos = tree.positions[i], child = tree.children[i], inner
    if (pos < to && child instanceof Tree) {
      if (!(inner = cutTree(lang, child, from - pos, to - pos, inside))) break
      return !inside ? inner
        : new Tree(tree.type, tree.children.slice(0, i).concat(inner), tree.positions.slice(0, i + 1), pos + inner.length)
    }
  }
  return null
}

function findStartInFragments<State>(lang: StreamLanguage<State>, fragments: readonly TreeFragment[],
                                     startPos: number, endPos: number, editorState?: EditorState) {
  for (let f of fragments) {
    let from = f.from + (f.openStart ? 25 : 0), to = f.to - (f.openEnd ? 25 : 0)
    let found = from <= startPos && to > startPos && findState(lang, f.tree, 0 - f.offset, startPos, to), tree
    if (found && found.pos <= endPos && (tree = cutTree(lang, f.tree, startPos + f.offset, found.pos + f.offset, false)))
      return {state: found.state, tree}
  }
  return {state: lang.streamParser.startState(editorState ? getIndentUnit(editorState) : 4), tree: Tree.empty}
}

const enum C {
  ChunkSize = 512,
  MaxDistanceBeforeViewport = 1e5,
  MaxIndentScanDist = 1e4,
  MaxLineLength = 1e4
}

class Parse<State> implements PartialParse {
  state: State
  parsedPos: number
  stoppedAt: number | null = null
  chunks: Tree[] = []
  chunkPos: number[] = []
  chunkStart: number
  chunk: number[] = []
  chunkReused: undefined | Tree[] = undefined
  rangeIndex = 0
  to: number

  constructor(readonly lang: StreamLanguage<State>,
              readonly input: Input,
              readonly fragments: readonly TreeFragment[],
              readonly ranges: readonly {from: number, to: number}[]) {
    this.to = ranges[ranges.length - 1].to
    let context = ParseContext.get(), from = ranges[0].from
    let {state, tree} = findStartInFragments(lang, fragments, from, this.to, context?.state)
    this.state = state
    this.parsedPos = this.chunkStart = from + tree.length
    for (let i = 0; i < tree.children.length; i++) {
      this.chunks.push(tree.children[i] as Tree)
      this.chunkPos.push(tree.positions[i])
    }
    if (context && this.parsedPos < context.viewport.from - C.MaxDistanceBeforeViewport &&
        ranges.some(r => r.from <= context!.viewport.from && r.to >= context!.viewport.from)) {
      this.state = this.lang.streamParser.startState(getIndentUnit(context.state))
      context.skipUntilInView(this.parsedPos, context.viewport.from)
      this.parsedPos = context.viewport.from
    }
    this.moveRangeIndex()
  }

  advance() {
    let context = ParseContext.get()
    let parseEnd = this.stoppedAt == null ? this.to : Math.min(this.to, this.stoppedAt)
    let end = Math.min(parseEnd, this.chunkStart + C.ChunkSize)
    if (context) end = Math.min(end, context.viewport.to)
    while (this.parsedPos < end) this.parseLine(context)
    if (this.chunkStart < this.parsedPos) this.finishChunk()
    if (this.parsedPos >= parseEnd) return this.finish()
    if (context && this.parsedPos >= context.viewport.to) {
      context.skipUntilInView(this.parsedPos, parseEnd)
      return this.finish()
    }
    return null
  }

  stopAt(pos: number) {
    this.stoppedAt = pos
  }

  lineAfter(pos: number) {
    let chunk = this.input.chunk(pos)
    if (!this.input.lineChunks) {
      let eol = chunk.indexOf("\n")
      if (eol > -1) chunk = chunk.slice(0, eol)
    } else if (chunk == "\n") {
      chunk = ""
    }
    return pos + chunk.length <= this.to ? chunk : chunk.slice(0, this.to - pos)
  }

  nextLine() {
    let from = this.parsedPos, line = this.lineAfter(from), end = from + line.length
    for (let index = this.rangeIndex;;) {
      let rangeEnd = this.ranges[index].to
      if (rangeEnd >= end) break
      line = line.slice(0, rangeEnd - (end - line.length))
      index++
      if (index == this.ranges.length) break
      let rangeStart = this.ranges[index].from
      let after = this.lineAfter(rangeStart)
      line += after
      end = rangeStart + after.length
    }
    return {line, end}
  }

  skipGapsTo(pos: number, offset: number, side: -1 | 1) {
    for (;;) {
      let end = this.ranges[this.rangeIndex].to, offPos = pos + offset
      if (side > 0 ? end > offPos : end >= offPos) break
      let start = this.ranges[++this.rangeIndex].from
      offset += start - end
    }
    return offset
  }

  moveRangeIndex() {
    while (this.ranges[this.rangeIndex].to < this.parsedPos) this.rangeIndex++
  }

  emitToken(id: number, from: number, to: number, offset: number) {
    let size = 4
    if (this.ranges.length > 1) {
      offset = this.skipGapsTo(from, offset, 1)
      from += offset
      let len0 = this.chunk.length
      offset = this.skipGapsTo(to, offset, -1)
      to += offset
      size += this.chunk.length - len0
    }
    let last = this.chunk.length - 4
    if (this.lang.streamParser.mergeTokens && size == 4 && last >= 0 &&
        this.chunk[last] == id && this.chunk[last + 2] == from)
      this.chunk[last + 2] = to
    else
      this.chunk.push(id, from, to, size)
    return offset
  }

  parseLine(context: ParseContext | null) {
    let {line, end} = this.nextLine(), offset = 0, {streamParser} = this.lang
    let stream = new StringStream(line, context ? context.state.tabSize : 4, context ? getIndentUnit(context.state) : 2)
    if (stream.eol()) {
      streamParser.blankLine(this.state, stream.indentUnit)
    } else {
      while (!stream.eol()) {
        let token = readToken(streamParser.token, stream, this.state)
        if (token)
          offset = this.emitToken(this.lang.tokenTable.resolve(token), this.parsedPos + stream.start,
                                  this.parsedPos + stream.pos, offset)
        if (stream.start > C.MaxLineLength) break
      }
    }
    this.parsedPos = end
    this.moveRangeIndex()
    if (this.parsedPos < this.to) this.parsedPos++
  }

  finishChunk() {
    let tree = Tree.build({
      buffer: this.chunk,
      start: this.chunkStart,
      length: this.parsedPos - this.chunkStart,
      nodeSet,
      topID: 0,
      maxBufferLength: C.ChunkSize,
      reused: this.chunkReused
    })
    tree = new Tree(tree.type, tree.children, tree.positions, tree.length,
                    [[this.lang.stateAfter, this.lang.streamParser.copyState(this.state)]])
    this.chunks.push(tree)
    this.chunkPos.push(this.chunkStart - this.ranges[0].from)
    this.chunk = []
    this.chunkReused = undefined
    this.chunkStart = this.parsedPos
  }

  finish() {
    return new Tree(this.lang.topNode, this.chunks, this.chunkPos, this.parsedPos - this.ranges[0].from).balance()
  }
}

function readToken<State>(token: (stream: StringStream, state: State) => string | null,
                          stream: StringStream, state: State) {
  stream.start = stream.pos
  for (let i = 0; i < 10; i++) {
    let result = token(stream, state)
    if (stream.pos > stream.start) return result
  }
  throw new Error("Stream parser failed to advance stream.")
}

const noTokens: {[name: string]: Tag} = Object.create(null)

const typeArray: NodeType[] = [NodeType.none]
const nodeSet = new NodeSet(typeArray)
const warned: string[] = []

// Cache of node types by name and tags
const byTag: {[key: string]: NodeType} = Object.create(null)

const defaultTable: {[name: string]: number} = Object.create(null)
for (let [legacyName, name] of [
  ["variable", "variableName"],
  ["variable-2", "variableName.special"],
  ["string-2", "string.special"],
  ["def", "variableName.definition"],
  ["tag", "tagName"],
  ["attribute", "attributeName"],
  ["type", "typeName"],
  ["builtin", "variableName.standard"],
  ["qualifier", "modifier"],
  ["error", "invalid"],
  ["header", "heading"],
  ["property", "propertyName"]
]) defaultTable[legacyName] = createTokenType(noTokens, name)

class TokenTable {
  table: {[name: string]: number} = Object.assign(Object.create(null), defaultTable)

  constructor(readonly extra: {[name: string]: Tag | readonly Tag[]}) {}

  resolve(tag: string) {
    return !tag ? 0 : this.table[tag] || (this.table[tag] = createTokenType(this.extra, tag))
  }
}

const defaultTokenTable = new TokenTable(noTokens)

function warnForPart(part: string, msg: string) {
  if (warned.indexOf(part) > -1) return
  warned.push(part)
  console.warn(msg)
}

function createTokenType(extra: {[name: string]: Tag | readonly Tag[]}, tagStr: string) {
  let tags = []
  for (let name of tagStr.split(" ")) {
    let found: readonly Tag[] = []
    for (let part of name.split(".")) {
      let value = (extra[part] || (highlightTags as any)[part]) as Tag | readonly Tag[] | ((t: Tag) => Tag) | undefined
      if (!value) {
        warnForPart(part, `Unknown highlighting tag ${part}`)
      } else if (typeof value == "function") {
        if (!found.length) warnForPart(part, `Modifier ${part} used at start of tag`)
        else found = found.map(value) as Tag[]
      } else {
        if (found.length) warnForPart(part, `Tag ${part} used as modifier`)
        else found = Array.isArray(value) ? value : [value]
      }
    }
    for (let tag of found) tags.push(tag)
  }
  if (!tags.length) return 0

  let name = tagStr.replace(/ /g, "_"), key = name + " " + tags.map(t => (t as any).id)
  let known = byTag[key]
  if (known) return known.id
  let type = byTag[key] = NodeType.define({
    id: typeArray.length,
    name,
    props: [styleTags({[name]: tags})]
  })
  typeArray.push(type)
  return type.id
}

function docID(data: Facet<{[name: string]: any}>, lang: StreamLanguage<unknown>) {
  let type = NodeType.define({id: typeArray.length, name: "Document", props: [
    languageDataProp.add(() => data),
    indentNodeProp.add(() => cx => lang.getIndent(cx))
  ], top: true})
  typeArray.push(type)
  return type
}
