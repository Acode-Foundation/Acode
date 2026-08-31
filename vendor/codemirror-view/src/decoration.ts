import {MapMode, RangeValue, Range, RangeSet} from "@codemirror/state"
import {Direction} from "./bidi"
import {attrsEq, Attrs, noAttrs, combineAttrs} from "./attributes"
import {EditorView} from "./editorview"
import {Rect} from "./dom"

interface MarkDecorationSpec {
  /// Whether the mark covers its start and end position or not. This
  /// influences whether content inserted at those positions becomes
  /// part of the mark. Defaults to false.
  inclusive?: boolean
  /// Specify whether the start position of the marked range should be
  /// inclusive. Overrides `inclusive`, when both are present.
  inclusiveStart?: boolean
  /// Whether the end should be inclusive.
  inclusiveEnd?: boolean
  /// Add attributes to the DOM elements that hold the text in the
  /// marked range.
  attributes?: {[key: string]: string}
  /// Shorthand for `{attributes: {class: value}}`.
  class?: string
  /// Add a wrapping element around the text in the marked range. Note
  /// that there will not necessarily be a single element covering the
  /// entire range—other decorations with lower precedence might split
  /// this one if they partially overlap it, and line breaks always
  /// end decoration elements.
  tagName?: string
  /// When using sets of decorations in
  /// [`bidiIsolatedRanges`](##view.EditorView^bidiIsolatedRanges),
  /// this property provides the direction of the isolates. When null
  /// or not given, it indicates the range has `dir=auto`, and its
  /// direction should be derived from the first strong directional
  /// character in it.
  bidiIsolate?: Direction | null
  /// Decoration specs allow extra properties, which can be retrieved
  /// through the decoration's [`spec`](#view.Decoration.spec)
  /// property.
  [other: string]: any
}

interface WidgetDecorationSpec {
  /// The type of widget to draw here.
  widget: WidgetType
  /// Which side of the given position the widget is on. When this is
  /// positive, the widget will be drawn after the cursor if the
  /// cursor is on the same position. Otherwise, it'll be drawn before
  /// it. When multiple widgets sit at the same position, their `side`
  /// values will determine their ordering—those with a lower value
  /// come first. Defaults to 0. May not be more than 10000 or less
  /// than -10000.
  side?: number
  /// By default, to avoid unintended mixing of block and inline
  /// widgets, block widgets with a positive `side` are always drawn
  /// after all inline widgets at that position, and those with a
  /// non-positive side before inline widgets. Setting this option to
  /// `true` for a block widget will turn this off and cause it to be
  /// rendered between the inline widgets, ordered by `side`.
  inlineOrder?: boolean
  /// Determines whether this is a block widgets, which will be drawn
  /// between lines, or an inline widget (the default) which is drawn
  /// between the surrounding text.
  ///
  /// Note that block-level decorations should not have vertical
  /// margins, and if you dynamically change their height, you should
  /// make sure to call
  /// [`requestMeasure`](#view.EditorView.requestMeasure), so that the
  /// editor can update its information about its vertical layout.
  block?: boolean
  /// Other properties are allowed.
  [other: string]: any
}

interface ReplaceDecorationSpec {
  /// An optional widget to drawn in the place of the replaced
  /// content.
  widget?: WidgetType
  /// Whether this range covers the positions on its sides. This
  /// influences whether new content becomes part of the range and
  /// whether the cursor can be drawn on its sides. Defaults to false
  /// for inline replacements, and true for block replacements.
  inclusive?: boolean
  /// Set inclusivity at the start.
  inclusiveStart?: boolean
  /// Set inclusivity at the end.
  inclusiveEnd?: boolean
  /// Whether this is a block-level decoration. Defaults to false.
  block?: boolean
  /// Other properties are allowed.
  [other: string]: any
}

interface LineDecorationSpec {
  /// DOM attributes to add to the element wrapping the line.
  attributes?: {[key: string]: string}
  /// Shorthand for `{attributes: {class: value}}`.
  class?: string
  /// Other properties are allowed.
  [other: string]: any
}

/// Widgets added to the content are described by subclasses of this
/// class. Using a description object like that makes it possible to
/// delay creating of the DOM structure for a widget until it is
/// needed, and to avoid redrawing widgets even if the decorations
/// that define them are recreated.
export abstract class WidgetType {
  /// Build the DOM structure for this widget instance.
  abstract toDOM(view: EditorView): HTMLElement

  /// Compare this instance to another instance of the same type.
  /// (TypeScript can't express this, but only instances of the same
  /// specific class will be passed to this method.) This is used to
  /// avoid redrawing widgets when they are replaced by a new
  /// decoration of the same type. The default implementation just
  /// returns `false`, which will cause new instances of the widget to
  /// always be redrawn.
  eq(widget: WidgetType): boolean { return false }

  /// Update a DOM element created by a widget of the same type (but
  /// different, non-`eq` content) to reflect this widget. May return
  /// true to indicate that it could update, false to indicate it
  /// couldn't (in which case the widget will be redrawn). The default
  /// implementation just returns false.
  updateDOM(dom: HTMLElement, view: EditorView, from: this): boolean { return false }

  /// @internal
  compare(other: WidgetType): boolean {
    return this == other || this.constructor == other.constructor && this.eq(other)
  }

  /// The estimated height this widget will have, to be used when
  /// estimating the height of content that hasn't been drawn. May
  /// return -1 to indicate you don't know. The default implementation
  /// returns -1.
  get estimatedHeight(): number { return -1 }

  /// For inline widgets that are displayed inline (as opposed to
  /// `inline-block`) and introduce line breaks (through `<br>` tags
  /// or textual newlines), this must indicate the amount of line
  /// breaks they introduce. Defaults to 0.
  get lineBreaks(): number { return 0 }

  /// Can be used to configure which kinds of events inside the widget
  /// should be ignored by the editor. The default is to ignore all
  /// events.
  ignoreEvent(event: Event): boolean { return true }

  /// Override the way screen coordinates for positions at/in the
  /// widget are found. `pos` will be the offset into the widget, and
  /// `side` the side of the position that is being queried—less than
  /// zero for before, greater than zero for after, and zero for
  /// directly at that position.
  coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null { return null }

  /// @internal
  get isHidden() { return false }

  /// @internal
  get editable() { return false }

  /// This is called when the an instance of the widget is removed
  /// from the editor view.
  destroy(dom: HTMLElement) {}
}

/// A decoration set represents a collection of decorated ranges,
/// organized for efficient access and mapping. See
/// [`RangeSet`](#state.RangeSet) for its methods.
export type DecorationSet = RangeSet<Decoration>

const enum Side {
  NonIncEnd = -6e8, // (end of non-inclusive range)
  GapStart = -5e8,
  BlockBefore = -4e8, // + widget side option (block widget before)
  BlockIncStart = -3e8, // (start of inclusive block range)
  Line = -2e8, // (line widget)
  InlineBefore = -1e8, // + widget side (inline widget before)
  InlineIncStart = -1, // (start of inclusive inline range)
  InlineIncEnd = 1, // (end of inclusive inline range)
  InlineAfter = 1e8, // + widget side (inline widget after)
  BlockIncEnd = 2e8, // (end of inclusive block range)
  BlockAfter = 3e8, // + widget side (block widget after)
  GapEnd = 4e8,
  NonIncStart = 5e8 // (start of non-inclusive range)
}

/// The different types of blocks that can occur in an editor view.
export enum BlockType {
  /// A line of text.
  Text,
  /// A block widget associated with the position after it.
  WidgetBefore,
  /// A block widget associated with the position before it.
  WidgetAfter,
  /// A block widget [replacing](#view.Decoration^replace) a range of content.
  WidgetRange
}

/// A decoration provides information on how to draw or style a piece
/// of content. You'll usually use it wrapped in a
/// [`Range`](#state.Range), which adds a start and end position.
/// @nonabstract
export abstract class Decoration extends RangeValue {
  protected constructor(
    /// @internal
    readonly startSide: number,
    /// @internal
    readonly endSide: number,
    /// @internal
    readonly widget: WidgetType | null,
    /// The config object used to create this decoration. You can
    /// include additional properties in there to store metadata about
    /// your decoration.
    readonly spec: any) { super() }

  /// @internal
  declare point: boolean

  /// @internal
  get heightRelevant() { return false }

  abstract eq(other: Decoration): boolean

  /// Create a mark decoration, which influences the styling of the
  /// content in its range. Nested mark decorations will cause nested
  /// DOM elements to be created. Nesting order is determined by
  /// precedence of the [facet](#view.EditorView^decorations), with
  /// the higher-precedence decorations creating the inner DOM nodes.
  /// Such elements are split on line boundaries and on the boundaries
  /// of lower-precedence decorations.
  static mark(spec: MarkDecorationSpec): Decoration {
    return new MarkDecoration(spec)
  }

  /// Create a widget decoration, which displays a DOM element at the
  /// given position.
  static widget(spec: WidgetDecorationSpec): Decoration {
    let side = Math.max(-10000, Math.min(10000, spec.side || 0)), block = !!spec.block
    side += (block && !spec.inlineOrder)
      ? (side > 0 ? Side.BlockAfter : Side.BlockBefore)
      : (side > 0 ? Side.InlineAfter : Side.InlineBefore)
    return new PointDecoration(spec, side, side, block, spec.widget || null, false)
  }

  /// Create a replace decoration which replaces the given range with
  /// a widget, or simply hides it.
  static replace(spec: ReplaceDecorationSpec): Decoration {
    let block = !!spec.block, startSide, endSide
    if (spec.isBlockGap) {
      startSide = Side.GapStart
      endSide = Side.GapEnd
    } else {
      let {start, end} = getInclusive(spec, block)
      startSide = (start ? (block ? Side.BlockIncStart : Side.InlineIncStart) : Side.NonIncStart) - 1
      endSide = (end ? (block ? Side.BlockIncEnd : Side.InlineIncEnd) : Side.NonIncEnd) + 1
    }
    return new PointDecoration(spec, startSide, endSide, block, spec.widget || null, true)
  }

  /// Create a line decoration, which can add DOM attributes to the
  /// line starting at the given position.
  static line(spec: LineDecorationSpec): Decoration {
    return new LineDecoration(spec)
  }

  /// Build a [`DecorationSet`](#view.DecorationSet) from the given
  /// decorated range or ranges. If the ranges aren't already sorted,
  /// pass `true` for `sort` to make the library sort them for you.
  static set(of: Range<Decoration> | readonly Range<Decoration>[], sort = false): DecorationSet {
    return RangeSet.of<Decoration>(of, sort)
  }

  /// The empty set of decorations.
  static none = RangeSet.empty as DecorationSet

  /// @internal
  hasHeight() { return this.widget ? this.widget.estimatedHeight > -1 : false }
}

export class MarkDecoration extends Decoration {
  tagName: string
  attrs: Attrs

  constructor(spec: MarkDecorationSpec) {
    let {start, end} = getInclusive(spec)
    super(start ? Side.InlineIncStart : Side.NonIncStart,
          end ? Side.InlineIncEnd : Side.NonIncEnd,
          null, spec)
    this.tagName = spec.tagName || "span"
    this.attrs = spec.class && spec.attributes ? combineAttrs(spec.attributes, {class: spec.class})
      : spec.class ? {class: spec.class} : spec.attributes || noAttrs
  }

  eq(other: Decoration): boolean {
    return this == other || other instanceof MarkDecoration && this.tagName == other.tagName && attrsEq(this.attrs, other.attrs)
  }

  range(from: number, to = from) {
    if (from >= to) throw new RangeError("Mark decorations may not be empty")
    return super.range(from, to)
  }
}

MarkDecoration.prototype.point = false

export class LineDecoration extends Decoration {
  constructor(spec: LineDecorationSpec) {
    super(Side.Line, Side.Line, null, spec)
  }

  eq(other: Decoration): boolean {
    return other instanceof LineDecoration &&
      this.spec.class == other.spec.class &&
      attrsEq(this.spec.attributes, other.spec.attributes)
  }

  range(from: number, to = from) {
    if (to != from) throw new RangeError("Line decoration ranges must be zero-length")
    return super.range(from, to)
  }
}

LineDecoration.prototype.mapMode = MapMode.TrackBefore
LineDecoration.prototype.point = true

export class PointDecoration extends Decoration {
  constructor(spec: any,
              startSide: number, endSide: number,
              public block: boolean,
              widget: WidgetType | null,
              readonly isReplace: boolean) {
    super(startSide, endSide, widget, spec)
    this.mapMode = !block ? MapMode.TrackDel : startSide <= 0 ? MapMode.TrackBefore : MapMode.TrackAfter
  }

  // Only relevant when this.block == true
  get type() {
    return this.startSide != this.endSide ? BlockType.WidgetRange
      : this.startSide <= 0 ? BlockType.WidgetBefore : BlockType.WidgetAfter
  }

  get heightRelevant() {
    return this.block || !!this.widget && (this.widget.estimatedHeight >= 5 || this.widget.lineBreaks > 0)
  }

  eq(other: Decoration): boolean {
    return other instanceof PointDecoration &&
      widgetsEq(this.widget, other.widget) &&
      this.block == other.block &&
      this.startSide == other.startSide && this.endSide == other.endSide
  }

  range(from: number, to = from) {
    if (this.isReplace && (from > to || (from == to && this.startSide > 0 && this.endSide <= 0)))
      throw new RangeError("Invalid range for replacement decoration")
    if (!this.isReplace && to != from)
      throw new RangeError("Widget decorations can only have zero-length ranges")
    return super.range(from, to)
  }
}

PointDecoration.prototype.point = true

function getInclusive(spec: {
  inclusive?: boolean,
  inclusiveStart?: boolean,
  inclusiveEnd?: boolean
}, block = false): {start: boolean, end: boolean} {
  let {inclusiveStart: start, inclusiveEnd: end} = spec
  if (start == null) start = spec.inclusive
  if (end == null) end = spec.inclusive
  return {start: start ?? block, end: end ?? block}
}

function widgetsEq(a: WidgetType | null, b: WidgetType | null): boolean {
  return a == b || !!(a && b && a.compare(b))
}

export function addRange(from: number, to: number, ranges: number[], margin = 0) {
  let last = ranges.length - 1
  if (last >= 0 && ranges[last] + margin >= from) ranges[last] = Math.max(ranges[last], to)
  else ranges.push(from, to)
}

interface BlockWrapperSpec {
  /// Tag name of the wrapping element.
  tagName: string
  /// DOM attributes to add to the wrapping element.
  attributes?: {[key: string]: string}
  /// When multiple overlapping block wrappers are produced by the
  /// same source, this determines their relative precedence. Lower
  /// rank wrappers are nested inside higher-rank ones. Should be
  /// a number between 0 and 100.
  rank?: number
}

/// A block wrapper defines a DOM node that wraps lines or other block
/// wrappers at the top of the document. It affects any line or block
/// widget that starts inside its range, including blocks starting
/// directly at `from` but not including `to`.
export class BlockWrapper extends RangeValue {
  private constructor(
    /// @internal
    readonly tagName: string,
    /// @internal
    readonly attributes: Attrs,
    /// @internal
    readonly rank: number
  ) {
    super()
  }

  eq(other: RangeValue): boolean {
    return other == this ||
      other instanceof BlockWrapper && this.tagName == other.tagName && attrsEq(this.attributes, other.attributes)
  }

  /// Create a block wrapper object with the given tag name and
  /// attributes.
  static create(spec: BlockWrapperSpec) {
    return new BlockWrapper(spec.tagName, spec.attributes || noAttrs,
                            spec.rank == null ? 50 : Math.max(0, Math.min(spec.rank, 100)))
  }

  /// Create a range set from the given block wrapper ranges.
  static set(of: Range<BlockWrapper> | readonly Range<BlockWrapper>[], sort = false) {
    return RangeSet.of<BlockWrapper>(of, sort)
  }
}

BlockWrapper.prototype.startSide = BlockWrapper.prototype.endSide = -1
