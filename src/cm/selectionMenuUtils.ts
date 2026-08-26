export interface SelectionMenuItem {
	id?: string;
	mode?: "selected" | "all";
	readOnly?: boolean;
}

export interface SelectionMenuFilterOptions {
	readOnly: boolean;
	hasSelection: boolean;
}

/** Preserve editor focus during a pointer press and activate on release. */
export function bindSelectionMenuButton(
	button: HTMLButtonElement,
	onActivate: (event: Event) => void,
): void {
	let activePointerId: number | null = null;

	const stopEvent = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const clearPointer = () => {
		activePointerId = null;
		button.classList.remove("is-pressed");
	};

	button.addEventListener("pointerdown", (event) => {
		if (event.isPrimary === false) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		activePointerId = event.pointerId;
		button.classList.add("is-pressed");
		stopEvent(event);
		try {
			button.setPointerCapture?.(event.pointerId);
		} catch {
			// Pointer capture is optional in older Android WebViews.
		}
	});

	button.addEventListener("pointerup", (event) => {
		if (event.pointerId !== activePointerId) return;
		clearPointer();
		stopEvent(event);
		onActivate(event);
	});

	button.addEventListener("pointercancel", clearPointer);
	button.addEventListener("lostpointercapture", clearPointer);
	button.addEventListener("click", (event) => {
		stopEvent(event);
		if (event.detail === 0) onActivate(event);
	});
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

const SELECTION_PRIMARY_ACTIONS = new Set([
	"copy",
	"cut",
	"paste",
	"select-all",
]);
const CARET_PRIMARY_ACTIONS = new Set(["paste", "select-all"]);

/** Keep the touch toolbar compact by moving secondary/plugin actions into More. */
export function partitionSelectionMenuItems<T extends SelectionMenuItem>(
	items: readonly T[],
	options: Pick<SelectionMenuFilterOptions, "hasSelection">,
): { primary: T[]; overflow: T[] } {
	const primaryIds = options.hasSelection
		? SELECTION_PRIMARY_ACTIONS
		: CARET_PRIMARY_ACTIONS;
	const primary: T[] = [];
	const overflow: T[] = [];

	for (const item of items) {
		(primaryIds.has(item.id ?? "") ? primary : overflow).push(item);
	}

	return { primary, overflow };
}
