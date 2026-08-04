import type * as lsp from "vscode-languageserver-protocol"
import {Text} from "@codemirror/state"

export function toPosition(doc: Text, pos: number): lsp.Position {
  let line = doc.lineAt(pos)
  return {line: line.number - 1, character: pos - line.from}
}

export function fromPosition(doc: Text, pos: lsp.Position): number {
  let line = doc.line(pos.line + 1)
  return line.from + pos.character
}

export function fromPositionChecked(doc: Text, pos: lsp.Position): number | null {
  if (pos.line < 0 || pos.line >= doc.lines) return null
  let line = doc.line(pos.line + 1)
  if (pos.character < 0 || pos.character > line.length) return null
  return line.from + pos.character
}

