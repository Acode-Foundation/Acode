export {EditorView, EditorViewConfig, DOMEventMap, DOMEventHandlers} from "./editorview"
export {Command, ViewPlugin, PluginValue, PluginSpec, ViewUpdate, logException} from "./extension"
export {ViewportBufferConfig, ControlledTouchScrollConfig} from "./extension"
export {Decoration, DecorationSet, WidgetType, BlockType, BlockWrapper} from "./decoration"
export {BlockInfo} from "./heightmap"
export {MouseSelectionStyle} from "./input"
export {BidiSpan, Direction} from "./bidi"
export {KeyBinding, keymap, runScopeHandlers} from "./keymap"
export {drawSelection, getDrawSelectionConfig} from "./draw-selection"
export {dropCursor} from "./dropcursor"
export {highlightSpecialChars} from "./special-chars"
export {scrollPastEnd} from "./scrollpastend"
export {highlightActiveLine} from "./active-line"
export {placeholder} from "./placeholder"
export {Rect} from "./dom"
export {layer, LayerMarker, RectangleMarker} from "./layer"
export {MatchDecorator} from "./matchdecorator"
export {rectangularSelection, crosshairCursor} from "./rectangular-selection"
export {showTooltip, Tooltip, TooltipView, tooltips, getTooltip, hoverTooltip, HoverTooltipSource, hasHoverTooltips,
        closeHoverTooltips, closeHoverTooltip, activateHover, repositionTooltips} from "./tooltip"
export {showPanel, PanelConstructor, Panel, getPanel, panels} from "./panel"
export {showDialog, getDialog} from "./dialog"
export {lineNumbers, highlightActiveLineGutter, gutter, gutters, GutterMarker,
        gutterLineClass, gutterWidgetClass, lineNumberMarkers, lineNumberWidgetMarker} from "./gutter"
export {highlightWhitespace, highlightTrailingWhitespace} from "./highlight-space"

import {HeightMap, HeightOracle, MeasuredHeights, QueryType, clearHeightChangeFlag, heightChangeFlag} from "./heightmap"
import {applyViewportBuffer} from "./viewstate"
import {isNativeScrollActivity} from "./domobserver"
import {ControlledTouchScroll, claimControlledTouchGesture} from "./controlled-scroll"
import {AndroidMinimumFlingVelocity, AndroidMaximumFlingVelocity, createAndroidSplineFling,
        estimateCommittedVelocity, sampleAndroidSpline} from "./android-spline"
import {ChangedRange} from "./extension"
import {computeOrder, moveVisually} from "./bidi"
/// @internal
export const __test = {HeightMap, HeightOracle, MeasuredHeights, QueryType, ChangedRange, computeOrder,
                       moveVisually, clearHeightChangeFlag, getHeightChangeFlag: () => heightChangeFlag,
                       applyViewportBuffer, isNativeScrollActivity, claimControlledTouchGesture,
                       AndroidMinimumFlingVelocity, AndroidMaximumFlingVelocity,
                       createAndroidSplineFling, estimateCommittedVelocity, sampleAndroidSpline,
                       ControlledTouchScroll}
