import {Text, RangeSetBuilder, Range} from "@codemirror/state"
import {EditorView} from "./editorview"
import {ViewUpdate} from "./extension"
import {Decoration, DecorationSet} from "./decoration"

function iterMatches(doc: Text, re: RegExp, from: number, to: number, f: (from: number, m: RegExpExecArray) => void) {
  re.lastIndex = 0
  for (let cursor = doc.iterRange(from, to), pos = from, m; !cursor.next().done; pos += cursor.value.length) {
    if (!cursor.lineBreak) while (m = re.exec(cursor.value))
      f(pos + m.index, m)
  }
}

function matchRanges(view: EditorView, maxLength: number) {
  let visible = view.visibleRanges
  if (visible.length == 1 && visible[0].from == view.viewport.from &&
      visible[0].to == view.viewport.to) return visible
  let result = []
  for (let {from, to} of visible) {
    from = Math.max(view.state.doc.lineAt(from).from, from - maxLength)
    to = Math.min(view.state.doc.lineAt(to).to, to + maxLength)
    if (result.length && result[result.length - 1].to >= from) result[result.length - 1].to = to
    else result.push({from, to})
  }
  return result
}

/// Helper class used to make it easier to maintain decorations on
/// visible code that matches a given regular expression. To be used
/// in a [view plugin](#view.ViewPlugin). Instances of this object
/// represent a matching configuration.
export class MatchDecorator {
  private regexp: RegExp
  private addMatch: (match: RegExpExecArray,
                     view: EditorView,
                     from: number,
                     add: (from: number, to: number, deco: Decoration) => void) => void
  private boundary: RegExp | undefined
  private maxLength: number

  /// Create a decorator.
  constructor(config: {
    /// The regular expression to match against the content. Will only
    /// be matched inside lines (not across them). Should have its 'g'
    /// flag set.
    regexp: RegExp,
    /// The decoration to apply to matches, either directly or as a
    /// function of the match.
    decoration?: Decoration | ((match: RegExpExecArray, view: EditorView, pos: number) => Decoration | null),
    /// Customize the way decorations are added for matches. This
    /// function, when given, will be called for matches and should
    /// call `add` to create decorations for them. Note that the
    /// decorations should appear *in* the given range, and the
    /// function should have no side effects beyond calling `add`.
    ///
    /// The `decoration` option is ignored when `decorate` is
    /// provided.
    decorate?: (add: (from: number, to: number, decoration: Decoration) => void, from: number, to: number, match: RegExpExecArray, view: EditorView) => void,
    /// By default, changed lines are re-matched entirely. You can
    /// provide a boundary expression, which should match single
    /// character strings that can never occur in `regexp`, to reduce
    /// the amount of re-matching.
    boundary?: RegExp,
    /// Matching happens by line, by default, but when lines are
    /// folded or very long lines are only partially drawn, the
    /// decorator may avoid matching part of them for speed. This
    /// controls how much additional invisible content it should
    /// include in its matches. Defaults to 1000.
    maxLength?: number,
  }) {
    const {regexp, decoration, decorate, boundary, maxLength = 1000} = config
    if (!regexp.global) throw new RangeError("The regular expression given to MatchDecorator should have its 'g' flag set")
    this.regexp = regexp
    if (decorate) {
      this.addMatch = (match, view, from, add) => decorate(add, from, from + match[0].length, match, view)
    } else if (typeof decoration == "function") {
      this.addMatch = (match, view, from, add) => {
        let deco = decoration(match, view, from)
        if (deco) add(from, from + match[0].length, deco)
      }
    } else if (decoration) {
      this.addMatch = (match, _view, from, add) => add(from, from + match[0].length, decoration)
    } else {
      throw new RangeError("Either 'decorate' or 'decoration' should be provided to MatchDecorator")
    }
    this.boundary = boundary
    this.maxLength = maxLength
  }

  /// Compute the full set of decorations for matches in the given
  /// view's viewport. You'll want to call this when initializing your
  /// plugin.
  createDeco(view: EditorView) {
    let build = new RangeSetBuilder<Decoration>(), add = build.add.bind(build)
    for (let {from, to} of matchRanges(view, this.maxLength))
      iterMatches(view.state.doc, this.regexp, from, to, (from, m) => this.addMatch(m, view, from, add))
    return build.finish()
  }

  /// Update a set of decorations for a view update. `deco` _must_ be
  /// the set of decorations produced by _this_ `MatchDecorator` for
  /// the view state before the update.
  updateDeco(update: ViewUpdate, deco: DecorationSet) {
    let changeFrom = 1e9, changeTo = -1
    if (update.docChanged) update.changes.iterChanges((_f, _t, from, to) => {
      if (to >= update.view.viewport.from && from <= update.view.viewport.to) {
        changeFrom = Math.min(from, changeFrom)
        changeTo = Math.max(to, changeTo)
      }
    })
    if (update.viewportMoved || changeTo - changeFrom > 1000)
      return this.createDeco(update.view)
    if (changeTo > -1)
      return this.updateRange(update.view, deco.map(update.changes), changeFrom, changeTo)
    return deco
  }

  private updateRange(view: EditorView, deco: DecorationSet, updateFrom: number, updateTo: number) {
    for (let r of view.visibleRanges) {
      let from = Math.max(r.from, updateFrom), to = Math.min(r.to, updateTo)
      if (to >= from) {
        let fromLine = view.state.doc.lineAt(from), toLine = fromLine.to < to ? view.state.doc.lineAt(to) : fromLine
        let start = Math.max(r.from, fromLine.from), end = Math.min(r.to, toLine.to)
        if (this.boundary) {
          for (; from > fromLine.from; from--) if (this.boundary.test(fromLine.text[from - 1 - fromLine.from])) {
            start = from
            break
          }
          for (; to < toLine.to; to++) if (this.boundary.test(toLine.text[to - toLine.from])) {
            end = to
            break
          }
        }
        let ranges: Range<Decoration>[] = [], m
        let add = (from: number, to: number, deco: Decoration) => ranges.push(deco.range(from, to))
        if (fromLine == toLine) {
          this.regexp.lastIndex = start - fromLine.from
          while ((m = this.regexp.exec(fromLine.text)) && m.index < end - fromLine.from)
            this.addMatch(m, view, m.index + fromLine.from, add)
        } else {
          iterMatches(view.state.doc, this.regexp, start, end, (from, m) => this.addMatch(m, view, from, add))
        }
        deco = deco.update({filterFrom: start, filterTo: end, filter: (from, to) => from < start || to > end, add: ranges})
      }
    }
    return deco
  }
}
