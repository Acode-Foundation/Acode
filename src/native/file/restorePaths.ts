interface PathReplacement {
	from: string;
	to: string;
}

const storageKeys = [
	"storageList",
	"files",
	"folders",
	"recentFiles",
	"recentFolders",
	"fileBrowserState",
];

export default function restorePaths(
	replacements: PathReplacement[] = [],
	storage: Storage = localStorage,
) {
	if (!replacements.length) return;
	const paths = [...replacements].sort((a, b) => b.from.length - a.from.length);
	for (const key of storageKeys) {
		const original = storage.getItem(key);
		if (!original) continue;
		let value: unknown;
		try {
			value = JSON.parse(original);
		} catch {
			continue;
		}
		const restored = JSON.stringify(restore(value, paths));
		if (restored !== JSON.stringify(value)) {
			try {
				storage.setItem(key, restored);
			} catch (error) {
				console.warn("Could not restore saved file paths", key, error);
			}
		}
	}
}

function restore(value: unknown, paths: PathReplacement[]): unknown {
	if (typeof value === "string") return restoreURL(value, paths);
	if (Array.isArray(value)) return value.map((item) => restore(item, paths));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				restoreURL(key, paths),
				restore(item, paths),
			]),
		);
	}
	return value;
}

function restoreURL(value: string, paths: PathReplacement[]) {
	if (!value.startsWith("file://")) return value;
	if (paths.some(({ to }) => value === to || value.startsWith(`${to}/`)))
		return value;
	const path = paths.find(
		({ from }) => value === from || value.startsWith(`${from}/`),
	);
	return path ? path.to + value.slice(path.from.length) : value;
}
