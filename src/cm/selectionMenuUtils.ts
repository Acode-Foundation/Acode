export interface SelectionMenuItem {
	id?: string;
	mode?: "selected" | "all";
	readOnly?: boolean;
}

export interface SelectionMenuFilterOptions {
	readOnly: boolean;
	hasSelection: boolean;
}

const POINTER_MOVE_TOLERANCE = 8;

/** Preserve editor focus during a pointer press and activate on release. */
export function bindSelectionMenuButton(
	button: HTMLButtonElement,
	onActivate: (event: Event) => void,
): void {
	let activePointerId: number | null = null;
	let pointerStart: { x: number; y: number } | null = null;

	const stopEvent = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const clearPointer = () => {
		activePointerId = null;
		pointerStart = null;
		button.classList.remove("is-pressed");
	};
	const pointerMoved = (event: PointerEvent) => {
		if (!pointerStart) return false;
		const xDistance = event.clientX - pointerStart.x;
		const yDistance = event.clientY - pointerStart.y;
		return (
			xDistance ** 2 + yDistance ** 2 >
			POINTER_MOVE_TOLERANCE ** 2
		);
	};

	button.addEventListener("pointerdown", (event) => {
		if (event.isPrimary === false) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		activePointerId = event.pointerId;
		pointerStart = { x: event.clientX, y: event.clientY };
		button.classList.add("is-pressed");
		stopEvent(event);
		try {
			button.setPointerCapture?.(event.pointerId);
		} catch {
			// Pointer capture is optional in older Android WebViews.
		}
	});

	button.addEventListener("pointermove", (event) => {
		if (event.pointerId !== activePointerId || !pointerStart) return;
		if (pointerMoved(event)) clearPointer();
	});

	button.addEventListener("pointerup", (event) => {
		if (event.pointerId !== activePointerId || !pointerStart) return;
		const moved = pointerMoved(event);
		clearPointer();
		stopEvent(event);
		if (!moved) onActivate(event);
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
