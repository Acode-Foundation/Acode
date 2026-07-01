interface ShiftSelectionOptions {
	event?: {
		shiftKey?: boolean;
	};
	quickToolsShift?: boolean;
	shiftClickSelection?: boolean;
}

export function isShiftSelectionActive({
	event,
	quickToolsShift,
	shiftClickSelection,
}: ShiftSelectionOptions = {}): boolean {
	if (quickToolsShift) return true;
	if (!shiftClickSelection) return false;
	return !!event?.shiftKey;
}
