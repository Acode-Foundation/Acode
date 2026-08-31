import {Extension} from "@codemirror/state"
import {ViewPlugin, ViewUpdate, contentAttributes} from "./extension"

const plugin = ViewPlugin.fromClass(class {
  height = 1000
  attrs = {style: "padding-bottom: 1000px"}

  update(update: ViewUpdate) {
    let {view} = update
    let height = view.viewState.editorHeight -
      view.defaultLineHeight - view.documentPadding.top - 0.5
    if (height >= 0 && height != this.height) {
      this.height = height
      this.attrs = {style: `padding-bottom: ${height}px`}
    }
  }
})

/// Returns an extension that makes sure the content has a bottom
/// margin equivalent to the height of the editor, minus one line
/// height, so that every line in the document can be scrolled to the
/// top of the editor.
///
/// This is only meaningful when the editor is scrollable, and should
/// not be enabled in editors that take the size of their content.
export function scrollPastEnd(): Extension {
  return [plugin, contentAttributes.of(view => view.plugin(plugin)?.attrs || null)]
}
