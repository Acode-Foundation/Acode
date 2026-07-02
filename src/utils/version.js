export function parseVersion(version) {
	const parts = String(version || "")
		.trim()
		.replace(/^v/i, "")
		.split(".");

	if (parts.length !== 3) return null;

	const numbers = parts.map((part) => {
		if (!/^\d+$/.test(part)) return Number.NaN;
		return Number(part);
	});

	if (numbers.some((part) => !Number.isSafeInteger(part))) return null;

	return numbers;
}

export function compareVersions(versionA, versionB) {
	const a = parseVersion(versionA);
	const b = parseVersion(versionB);

	if (!a || !b) return 0;

	for (let i = 0; i < a.length; i++) {
		if (a[i] > b[i]) return 1;
		if (a[i] < b[i]) return -1;
	}

	return 0;
}

export function isVersionGreater(newVersion, currentVersion) {
	return compareVersions(newVersion, currentVersion) > 0;
}
