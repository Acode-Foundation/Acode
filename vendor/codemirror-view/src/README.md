The “view” is the part of the editor that the user sees—a DOM
component that displays the editor state and allows text input.

@EditorViewConfig

@EditorView

@Direction

@BlockInfo

@BlockType

@BidiSpan

@DOMEventHandlers

@DOMEventMap

@Rect

### Extending the View

@Command

@ViewPlugin

@PluginValue

@PluginSpec

@ViewUpdate

@logException

@MouseSelectionStyle

@drawSelection

@getDrawSelectionConfig

@dropCursor

@highlightActiveLine

@highlightSpecialChars

@highlightWhitespace

@highlightTrailingWhitespace

@placeholder

@scrollPastEnd

### Key bindings

@KeyBinding

@keymap

@runScopeHandlers

### Decorations

Your code should not try to directly change the DOM structure
CodeMirror creates for its content—that will not work. Instead, the
way to influence how things are drawn is by providing decorations,
which can add styling or replace content with an alternative
representation.

@Decoration

@DecorationSet

@WidgetType

@MatchDecorator

@BlockWrapper

### Gutters

Functionality for showing "gutters" (for line numbers or other
purposes) on the side of the editor. See also the [gutter
example](../../examples/gutter/).

@lineNumbers

@highlightActiveLineGutter

@gutter

@gutters

@GutterMarker

@gutterLineClass

@gutterWidgetClass

@lineNumberMarkers

@lineNumberWidgetMarker

### Tooltips

Tooltips are DOM elements overlaid on the editor near a given document
position. This package helps manage and position such elements.

See also the [tooltip example](../../examples/tooltip/).

@showTooltip

@Tooltip

@TooltipView

@tooltips

@getTooltip

@hoverTooltip

@HoverTooltipSource

@hasHoverTooltips

@activateHover

@closeHoverTooltips

@closeHoverTooltip

@repositionTooltips

### Panels

Panels are UI elements positioned above or below the editor (things
like a search dialog). They will take space from the editor when it
has a fixed height, and will stay in view even when the editor is
partially scrolled out of view.

See also the [panel example](../../examples/panel/).

@showPanel

@PanelConstructor

@Panel

@getPanel

@panels

@showDialog

@getDialog

### Layers

Layers are sets of DOM elements drawn over or below the document text.
They can be useful for displaying user interface elements that don't
take up space and shouldn't influence line wrapping, such as
additional cursors.

Note that, being outside of the regular DOM order, such elements are
invisible to screen readers. Make sure to also
[provide](#view.EditorView^announce) any important information they
convey in an accessible way.

@layer

@LayerMarker

@RectangleMarker

### Rectangular Selection

@rectangularSelection

@crosshairCursor
