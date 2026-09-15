import ist from "ist"
import {foldEffect, unfoldEffect, foldState} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {DecorationSet} from "@codemirror/view"

let doc = "1\n2\n3\n4\n5\n6\n7\n8\n"

function ranges(set: DecorationSet) {
  let result: string[] = []
  set.between(0, 1e8, (f, t) => {result.push(`${f}-${t}`)})
  return result.join(" ")
}

describe("Folding", () => {
  it("stores fold state", () => {
    let state = EditorState.create({doc, extensions: foldState}).update({
      effects: [foldEffect.of({from: 0, to: 3}), foldEffect.of({from: 4, to: 7})]
    }).state
    ist(ranges(state.field(foldState)), "0-3 4-7")
    state = state.update({
      effects: unfoldEffect.of({from: 4, to: 7})
    }).state
    ist(ranges(state.field(foldState)), "0-3")
  })

  it("can store fold state as JSON", () => {
    let state = EditorState.create({doc, extensions: foldState}).update({
      effects: [foldEffect.of({from: 4, to: 7}), foldEffect.of({from: 8, to: 11})]
    }).state
    let fields = {fold: foldState}
    state = EditorState.fromJSON(state.toJSON(fields), {}, fields)
    ist(ranges(state.field(foldState)), "4-7 8-11")
  })
})
