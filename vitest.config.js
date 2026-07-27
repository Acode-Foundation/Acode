import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// Mirror the bundler resolution (rspack `resolve.modules: ["node_modules", "src"]`
// and tsconfig `paths: { "*": ["./src/*"] }`) so unit tests can import app
// modules via bare paths like `utils/version` or `lib/settings`.
const srcAliases = fs
	.readdirSync(srcDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => ({
		find: new RegExp(`^${entry.name}(?:/(.*))?$`),
		replacement: `${path.join(srcDir, entry.name)}/$1`,
	}));

export default defineConfig({
	resolve: {
		alias: srcAliases,
	},
	test: {
		// Vitest unit tests live ONLY under `tests/`.
		// `src/test/` is Acode's in-app runtime test harness: it runs on-device
		// inside the WebView (launched from the app commands) and depends on
		// cordova/editorManager globals, so it must never be collected here.
		include: ["tests/**/*.test.{js,ts}"],
		exclude: [
			...configDefaults.exclude,
			"src/test/**",
			"www/**",
			"platforms/**",
		],
	},
});
