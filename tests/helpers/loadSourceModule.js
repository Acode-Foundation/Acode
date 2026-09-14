import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const compiled = new Map();
// Compile the actual source with Acode's JSX transform; replace only its environment.
export function loadSourceModule(relative, dependencies, globals = {}) {
	const filename = path.resolve(relative);
	if (!compiled.has(filename)) compiled.set(filename, transformSync(readFileSync(filename, "utf8"), {
		filename, babelrc: false, configFile: false,
		presets: [["@babel/preset-env", { targets: { node: "current" }, modules: "commonjs" }]],
		plugins: ["html-tag-js/jsx/syntax-parser.js", "html-tag-js/jsx/jsx-to-tag.js"],
	}).code);
	const exports = {};
	vm.runInNewContext(compiled.get(filename), {
		exports, Promise, console, setTimeout, clearTimeout,
		require(id) {
			if (!(id in dependencies)) throw Error(`Unexpected import: ${id}`);
			return dependencies[id];
		}, ...globals,
	}, { filename });
	return exports;
}
