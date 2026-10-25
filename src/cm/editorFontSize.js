/**
 * Shared font-size rules for the editor.
 * Keeping these values consistent across editor commands and pinch-to-zoom.
 */

export const DEFAULT_EDITOR_FONT_SIZE = 12;
export const MIN_EDITOR_FONT_SIZE = 6;
export const MAX_EDITOR_FONT_SIZE = 72;

/**
 * Keeps the editor font size within the supported range.
 * @param {number} px
 * @returns {number}
 */
export function clampEditorFontSize(px) {
	if (!Number.isFinite(px)) {
		return DEFAULT_EDITOR_FONT_SIZE;
	}

	return Math.min(
		MAX_EDITOR_FONT_SIZE,
		Math.max(MIN_EDITOR_FONT_SIZE, Math.round(px)),
	);
}
