import ist from "ist"
import {EditorState} from "@codemirror/state"
import {Tag} from "@lezer/highlight"
import {StreamLanguage, syntaxTree, getIndentation, Language} from "@codemirror/language"
import {SyntaxNode} from "@lezer/common"

let startStates = 0, keywords = ["if", "else", "return"]

const language = StreamLanguage.define<{count: number}>({
  startState() {
    startStates++
    return {count: 0}
  },

  token(stream, state) {
    if (stream.eatSpace()) return null
    state.count++
    if (stream.match(/^\/\/.*/)) return "lineComment"
    if (stream.match(/^"[^"]*"/)) return "string"
    if (stream.match(/^\d+/)) return "number"
    if (stream.match(/^\w+/)) return keywords.indexOf(stream.current()) >= 0 ? "keyword" : "variableName"
    if (stream.match(/^[();{}]/)) return "punctuation"
    stream.next()
    return "invalid"
  },

  indent(state) {
    return state.count
  }
})

describe("StreamLanguage", () => {
  it("can parse content", () => {
    ist(language.parser.parse("if (x) return 500").toString(),
        "Document(keyword,punctuation,variableName,punctuation,keyword,number)")
  })

  it("can reuse state on updates", () => {
    let state = EditorState.create({
      doc: "// filler content\nif (a) foo()\nelse if (b) bar()\nelse quux()\n\n".repeat(100),
      extensions: language
    })

    startStates = 0
    state = state.update({changes: {from: 5000, to: 5001}}).state
    ist(startStates, 0)
  })

  it("can find the correct parse state for indentation", () => {
    let state = EditorState.create({
      doc: '"abcdefg"\n'.repeat(200),
      extensions: language
    })
    ist(getIndentation(state, 0), 0)
    ist(getIndentation(state, 10), 1)
    ist(getIndentation(state, 100), 10)
    ist(getIndentation(state, 1000), 100)
  })

  // Fragile kludge to set the parser context viewport without
  // actually having access to the relevant field
  function setViewport(state: EditorState, from: number, to: number) {
    let field = (Language as any).state
    ;(state.field(field) as any).context.updateViewport({from, to})
  }

  it("will make up a state when the viewport is far away from the frontier", () => {
    let line = "1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0\n"
    let state = EditorState.create({doc: line.repeat(100), extensions: language})
    setViewport(state, 4000, 8000)
    state = state.update({changes: {from: 3000, insert: line.repeat(10000)}}).state
    let tree = syntaxTree(state)
    // No nodes in the skipped range
    ist(tree.resolve(10000, 1).name, "Document")
    // But the viewport is populated
    ist(tree.resolve(805000, 1).name, "number")
    let treeSize = 0
    tree.iterate({enter() { treeSize++ }})
    ist(treeSize, 2000, ">")
    ist(treeSize, 4000, "<")
    setViewport(state, 4000, 8000)
    state = state.update({changes: {from: 100000, insert: "?"}}).state
    tree = syntaxTree(state)
    ist(tree.resolve(5000, 1).name, "number")
    ist(tree.resolve(50000, 1).name, "Document")
  })

  it("doesn't parse beyond the viewport", () => {
    let line = "1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0\n"
    let state = EditorState.create({doc: line.repeat(100), extensions: language})
    setViewport(state, 0, 4000)
    state = state.update({changes: {from: 5000, insert: line.repeat(100)}}).state
    ist(syntaxTree(state).resolve(2000, 1).name, "number")
    ist(syntaxTree(state).resolve(6000, 1).name, "Document")
  })

  function isNode(node: SyntaxNode | null, name: string, from: number, to: number) {
    ist(node)
    ist(node!.type.name, name)
    ist(node!.from, from)
    ist(node!.to, to)
  }

  it("supports gaps", () => {
    let text = "1 50 xxx\nxxx\nxxx 60\n70 xxx80xxx 9xxx0"
    let ranges = [{from: 0, to: 5}, {from: 16, to: 23}, {from: 26, to: 28}, {from: 31, to: 33}, {from: 36, to: 37}]
    let tree = language.parser.parse(text, [], ranges)
    ist(tree.toString(), "Document(number,number,number,number,number,number)")
    isNode(tree.resolve(17, 1), "number", 17, 19)
    isNode(tree.resolve(20, 1), "number", 20, 22)
    isNode(tree.resolve(26, 1), "number", 26, 28)
    isNode(tree.resolve(32, 1), "number", 32, 37)
  })

  it("accepts custom token types", () => {
    let tag = Tag.define()
    let lang = StreamLanguage.define<null>({
      token(stream) {
        if (stream.match(/^\w+/)) return "foo"
        stream.next()
        return null
      },
      tokenTable: {foo: tag}
    })
    ist(lang.parser.parse("hello").toString(), "Document(foo)")
  })
})
