interface RspackContext {
	(key: string): string | { default: string };
	keys(): string[];
}

interface RspackRequire {
	context(
		directory: string,
		useSubdirectories: boolean,
		filter: RegExp,
	): RspackContext;
}

declare const require: RspackRequire;

const context = require.context(
	"typescript/lib",
	false,
	/^\.\/lib\..*\.d\.ts$/,
);

const libraries: Record<string, string> = {};
for (const key of context.keys()) {
	const value = context(key);
	libraries[key.slice(2)] =
		typeof value === "string" ? value : value.default;
}

export default libraries;
