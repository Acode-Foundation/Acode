/**
 * Ordering rules for directory listings, kept separate from `helpers.sortDir`
 * so they can be tested without the editor's DOM and JSX setup.
 */

/** @typedef {'name'|'size'|'date'|'type'|'none'} SortField */
/** @typedef {'asc'|'desc'} SortOrder */

/**
 * @param {string} [order]
 * @returns {SortOrder}
 */
export function normalizeSortOrder(order) {
	return order === "desc" ? "desc" : "asc";
}

/**
 * Compares two entries by a field, falling back to the name so equal sizes or
 * dates still have a stable, predictable order.
 * @param {SortField} sortBy
 * @param {SortOrder} sortOrder
 * @returns {((a: object, b: object) => number) | null} null when unsorted
 */
export function getEntryComparator(sortBy, sortOrder) {
	if (!sortBy || sortBy === "none") return null;

	const sign = sortOrder === "desc" ? -1 : 1;
	const byName = (a, b) => sign * compareText(a.name || "", b.name || "");

	switch (sortBy) {
		case "size":
			return (a, b) =>
				compareReported(sizeOf(a), sizeOf(b), sign) || byName(a, b);
		case "date":
			return (a, b) =>
				compareReported(timeOf(a), timeOf(b), sign) || byName(a, b);
		case "type":
			return (a, b) => sign * compareText(kindOf(a), kindOf(b)) || byName(a, b);
		default:
			return byName;
	}
}

/**
 * Compares two optional numbers. Entries whose provider did not report the
 * value (-1) go last in both directions: "unknown" is not "smallest", and
 * flipping the sort should not move them to the top.
 * @param {number} a
 * @param {number} b
 * @param {number} sign
 * @returns {number}
 */
function compareReported(a, b, sign) {
	const aMissing = a < 0;
	const bMissing = b < 0;
	if (aMissing || bMissing) {
		if (aMissing && bMissing) return 0;
		return aMissing ? 1 : -1;
	}
	return sign * (a - b);
}

function compareText(a, b) {
	a = a.toLowerCase();
	b = b.toLowerCase();
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

/**
 * Size in bytes, or -1 when the provider did not report one. Unknown sizes sort
 * last in ascending order instead of pretending to be empty files.
 */
function sizeOf(entry) {
	const size = Number(entry.length ?? entry.size);
	if (!Number.isFinite(size) || size < 0) return -1;
	return size;
}

/** Modification time in milliseconds, or -1 when it is not reported. */
function timeOf(entry) {
	const raw = entry.lastModified ?? entry.modifiedDate;
	if (raw == null) return -1;
	if (raw instanceof Date) return raw.getTime();
	const time = Number(raw);
	return Number.isFinite(time) ? time : -1;
}

/** Extension used to group files of the same kind, e.g. "md" or "txt". */
function kindOf(entry) {
	const name = String(entry.name || "");
	const index = name.lastIndexOf(".");
	if (index <= 0 || index === name.length - 1) return "";
	return name.slice(index + 1).toLowerCase();
}
