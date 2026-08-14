export interface SelectionMenuItem {
	mode?: "selected" | "all";
	readOnly?: boolean;
}

export interface SelectionMenuFilterOptions {
	readOnly: boolean;
	hasSelection: boolean;
}

/** Filter selection actions using Acode's read-only and selection rules. */
export function filterSelectionMenuItems<T extends SelectionMenuItem>(
	items: readonly T[],
	options: SelectionMenuFilterOptions,
): T[] {
	const { readOnly, hasSelection } = options;
	return items.filter((item) => {
		if (readOnly && !item.readOnly) return false;
		if (hasSelection && !["selected", "all"].includes(item.mode ?? "all")) {
			return false;
		}
		if (!hasSelection && item.mode === "selected") return false;
		return true;
	});
}
