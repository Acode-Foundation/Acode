import { afterEach, describe, expect, it } from "vitest";
import "cm/supportedModes";
import { addMode, getMode, getModeForPath, removeMode } from "cm/modelist";

// Modes the Additional Language Modes plugin (acode.additional.langmodes)
// replaces with Lezer grammars, with the extensions it registers.
const pluginModes = [
	{ name: "assembly", extensions: ["asm", "s", "S", "nasm"] },
	{ name: "c", extensions: ["c", "h", "ino"] },
	{ name: "clojure", extensions: ["clj", "cljs", "cljc", "cljx", "edn"] },
	{ name: "kotlin", extensions: ["kt", "kts"] },
	{ name: "latex", extensions: ["tex", "ltx", "sty", "cls", "latex"] },
	{ name: "lua", extensions: ["lua"] },
	{ name: "swift", extensions: ["swift"] },
	{ name: "handlebars", extensions: ["hbs", "handlebars"] },
	{ name: "mustache", extensions: ["mustache"] },
];

/** The plugin's registration rule: keep Acode's mode, add "<name>-enhanced". */
function registerLikePlugin({ name, extensions }) {
	const registered = getMode(name) ? `${name}-enhanced` : name;
	addMode(registered, extensions, registered, () => []);
	return registered;
}

describe("legacy modes replaced by the Additional Language Modes plugin", () => {
	const registered = [];

	afterEach(() => {
		for (const name of registered.splice(0)) removeMode(name);
	});

	it.each([
		"clojure",
		"clojurescript",
		"edn",
		"gas",
		"kotlin",
		"latex",
		"tex",
		"stex",
		"lua",
		"swift",
	])("does not ship a built-in %s mode", (name) => {
		expect(getMode(name)).toBeNull();
	});

	it.each([
		"a.kt",
		"a.kts",
		"a.lua",
		"a.swift",
		"a.clj",
		"a.cljs",
		"a.edn",
		"a.s",
		"a.tex",
		"a.hbs",
		"a.handlebars",
	])("falls back to plain text for %s without the plugin", (path) => {
		expect(getModeForPath(path).name).toBe("text");
	});

	it("keeps C, C++, HTML and Luau built in", () => {
		expect(getModeForPath("a.html").name).toBe("html");
		expect(getModeForPath("a.c").name).toBe("c");
		expect(getModeForPath("a.cpp").name).toBe("cpp");
		expect(getModeForPath("a.luau").name).toBe("luau");
	});

	it("opens .text files as plain text instead of LaTeX", () => {
		expect(getModeForPath("notes.text").name).toBe("text");
	});

	it("lets the plugin register the replaced modes under canonical names", () => {
		for (const mode of pluginModes) registered.push(registerLikePlugin(mode));

		expect(registered).toEqual([
			"assembly",
			"c-enhanced",
			"clojure",
			"kotlin",
			"latex",
			"lua",
			"swift",
			"handlebars",
			"mustache",
		]);
		expect(getModeForPath("a.kt").name).toBe("kotlin");
		expect(getModeForPath("a.lua").name).toBe("lua");
		expect(getModeForPath("a.swift").name).toBe("swift");
		expect(getModeForPath("a.cljs").name).toBe("clojure");
		expect(getModeForPath("a.edn").name).toBe("clojure");
		expect(getModeForPath("a.s").name).toBe("assembly");
		expect(getModeForPath("a.tex").name).toBe("latex");
		expect(getModeForPath("a.c").name).toBe("c-enhanced");
		expect(getModeForPath("a.hbs").name).toBe("handlebars");
		expect(getModeForPath("a.handlebars").name).toBe("handlebars");
		expect(getModeForPath("a.mustache").name).toBe("mustache");
		expect(getModeForPath("a.html").name).toBe("html");
		// Luau keeps its own mode even though "lua" now comes from the plugin.
		expect(getModeForPath("a.luau").name).toBe("luau");
	});
});
