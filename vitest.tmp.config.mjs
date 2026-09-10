import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const srcAliases = fs
	.readdirSync(srcDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => ({
		find: new RegExp(`^${entry.name}(?:/(.*))?$`),
		replacement: `${path.join(srcDir, entry.name)}/$1`,
	}));

export default {
	resolve: { alias: srcAliases },
	test: {
		include: ["tests/**/*.test.{js,ts}"],
		exclude: ["src/test/**", "www/**", "platforms/**", "**/node_modules/**"],
	},
};
