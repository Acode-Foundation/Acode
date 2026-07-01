interface ShiftSelectionOptions {
	event?: {
		shiftKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
	};
	quickToolsShift?: boolean;
	quickToolsCtrl?: boolean;
	quickToolsMeta?: boolean;
	shiftClickSelection?: boolean;
	isMac?: boolean;
}

export function isRangeSelectionActive({
	event,
	quickToolsShift,
}: ShiftSelectionOptions = {}): boolean {
	if (quickToolsShift) return true;
	return !!event?.shiftKey;
}

export function isMultiCursorSelectionActive({
	event,
	quickToolsCtrl,
	quickToolsMeta,
	isMac = isMacPlatform(),
}: ShiftSelectionOptions = {}): boolean {
	if (quickToolsCtrl || quickToolsMeta) return true;
	return isMac ? !!event?.metaKey : !!event?.ctrlKey;
}

export const isShiftSelectionActive = isRangeSelectionActive;

function isMacPlatform(): boolean {
	const platform = navigator?.platform || "";
	return (
		/Mac|iPhone|iPad|iPod/i.test(platform) ||
		(platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}
