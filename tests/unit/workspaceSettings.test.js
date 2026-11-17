import {
	MAX_SETTINGS_SIZE,
	NO_PROJECT_SETTINGS,
	PROJECT_SETTING_KEYS,
	parseProjectSettings,
	SETTINGS_FILE,
	sameProjectSettings,
	unusableProjectSettings,
} from "lib/workspaceSettings";
import { describe, expect, it } from "vitest";

describe("project settings allowlist", () => {
	it("only offers settings every reader of which can ask for the project's value", () => {
		expect([...PROJECT_SETTING_KEYS].sort()).toEqual([
			"formatOnSave",
			"softTab",
			"tabSize",
		]);
	});

	it("reads from settings.json", () => {
		expect(SETTINGS_FILE).toBe("settings.json");
		expect(MAX_SETTINGS_SIZE).toBeGreaterThan(0);
	});
});

describe("parseProjectSettings", () => {
	it("accepts valid overrides", () => {
		const result = parseProjectSettings('{"tabSize": 4, "softTab": false}');
		expect(result.values).toEqual({ tabSize: 4, softTab: false });
		expect(result.problems).toEqual([]);
		expect(result.ignored).toEqual([]);
	});

	it.each([
		["", "empty"],
		["   \n\t", "blank"],
		[undefined, "undefined"],
		[null, "null"],
		[42, "a number"],
	])("treats %j (%s) as no settings, without a problem", (input) => {
		expect(parseProjectSettings(input)).toBe(NO_PROJECT_SETTINGS);
	});

	it("treats an empty object as no overrides", () => {
		const result = parseProjectSettings("{}");
		expect(result.values).toEqual({});
		expect(result.problems).toEqual([]);
	});

	it("reports invalid JSON instead of throwing", () => {
		const result = parseProjectSettings('{"tabSize": 4,}');
		expect(result.values).toEqual({});
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0]).toMatch(/not valid json/i);
	});

	it.each([
		"[]",
		"[1, 2]",
		"42",
		'"text"',
		"true",
		"null",
	])("rejects %s because it is not an object", (text) => {
		const result = parseProjectSettings(text);
		expect(result.values).toEqual({});
		expect(result.problems).toEqual(["Expected a JSON object"]);
	});

	describe("tabSize", () => {
		it.each([1, 2, 4, 8])("accepts %i", (tabSize) => {
			expect(parseProjectSettings(JSON.stringify({ tabSize })).values).toEqual({
				tabSize,
			});
		});

		it.each([
			0,
			9,
			-2,
			2.5,
			"4",
			null,
			true,
			[4],
			{ n: 4 },
			1e9,
		])("rejects %j", (tabSize) => {
			const result = parseProjectSettings(JSON.stringify({ tabSize }));
			expect(result.values).toEqual({});
			expect(result.problems).toEqual([
				'"tabSize" must be a whole number from 1 to 8',
			]);
		});
	});

	describe("formatOnSave", () => {
		it.each([true, false])("accepts %s", (formatOnSave) => {
			expect(
				parseProjectSettings(JSON.stringify({ formatOnSave })).values,
			).toEqual({ formatOnSave });
		});

		it.each(["true", "yes", 1, 0, null, []])("rejects %j", (formatOnSave) => {
			const result = parseProjectSettings(JSON.stringify({ formatOnSave }));
			expect(result.values).toEqual({});
			expect(result.problems).toEqual(['"formatOnSave" must be true or false']);
		});
	});

	describe("settings that are not offered yet", () => {
		// Read from many places, or by the canvas renderer's own path, so a project
		// value would disagree with the rest of Acode. See workspaceSettings.js.
		it.each([
			"textWrap",
			"linenumbers",
			"showSpaces",
			"indentGuides",
			"relativeLineNumbers",
		])("ignores %s", (key) => {
			const result = parseProjectSettings(JSON.stringify({ [key]: true }));
			expect(result.values).toEqual({});
			expect(result.ignored).toEqual([key]);
		});
	});

	describe("softTab", () => {
		it.each([true, false])("accepts %s", (softTab) => {
			expect(parseProjectSettings(JSON.stringify({ softTab })).values).toEqual({
				softTab,
			});
		});

		it.each(["true", 1, 0, null, []])("rejects %j", (softTab) => {
			const result = parseProjectSettings(JSON.stringify({ softTab }));
			expect(result.values).toEqual({});
			expect(result.problems).toEqual(['"softTab" must be true or false']);
		});
	});

	it("keeps the valid values when another value is wrong", () => {
		const result = parseProjectSettings('{"tabSize": 99, "softTab": false}');
		expect(result.values).toEqual({ softTab: false });
		expect(result.problems).toEqual([
			'"tabSize" must be a whole number from 1 to 8',
		]);
	});

	it("ignores unknown settings without calling them problems", () => {
		const result = parseProjectSettings(
			'{"tabSize": 2, "fontSize": "30px", "someFutureSetting": 1}',
		);
		expect(result.values).toEqual({ tabSize: 2 });
		expect(result.problems).toEqual([]);
		expect(result.ignored).toEqual(["fontSize", "someFutureSetting"]);
	});

	it.each([
		"formatter",
		"prettier",
		"excludeFolders",
		"lsp",
		"pluginsDisabled",
		"serverPort",
		"host",
		"console",
	])("never honours the sensitive global setting %s", (key) => {
		const result = parseProjectSettings(JSON.stringify({ [key]: {} }));
		expect(result.values).toEqual({});
		expect(result.ignored).toEqual([key]);
	});

	describe("hostile input", () => {
		it("does not pollute prototypes through __proto__", () => {
			const result = parseProjectSettings(
				'{"__proto__": {"tabSize": 3, "polluted": true}, "tabSize": 4}',
			);

			expect(result.values).toEqual({ tabSize: 4 });
			expect({}.polluted).toBeUndefined();
			expect(Object.prototype.tabSize).toBeUndefined();
			expect(result.ignored).toEqual(["__proto__"]);
		});

		it("does not treat inherited names as settings", () => {
			const result = parseProjectSettings(
				'{"constructor": 1, "toString": 2, "hasOwnProperty": 3}',
			);
			expect(result.values).toEqual({});
			expect(result.problems).toEqual([]);
		});

		it("does not take values from the prototype chain", () => {
			// A key that exists only on Object.prototype must not satisfy the schema.
			const result = parseProjectSettings('{"valueOf": 4}');
			expect(result.values).toEqual({});
		});
	});

	it("returns frozen results that cannot be altered by callers", () => {
		const result = parseProjectSettings('{"tabSize": 4}');
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.values)).toBe(true);
		expect(Object.isFrozen(result.problems)).toBe(true);
		expect(() => {
			"use strict";
			result.values.tabSize = 8;
		}).toThrow();
		expect(result.values.tabSize).toBe(4);
	});

	it("shares one frozen empty result", () => {
		expect(Object.isFrozen(NO_PROJECT_SETTINGS)).toBe(true);
		expect(Object.isFrozen(NO_PROJECT_SETTINGS.values)).toBe(true);
	});
});

describe("unusableProjectSettings", () => {
	it("carries the problem and no values", () => {
		const result = unusableProjectSettings("too big");
		expect(result.values).toEqual({});
		expect(result.problems).toEqual(["too big"]);
		expect(Object.isFrozen(result)).toBe(true);
	});
});

describe("sameProjectSettings", () => {
	it("compares values and problems", () => {
		const a = parseProjectSettings('{"tabSize": 4}');
		expect(sameProjectSettings(a, parseProjectSettings('{"tabSize": 4}'))).toBe(
			true,
		);
		expect(sameProjectSettings(a, parseProjectSettings('{"tabSize": 2}'))).toBe(
			false,
		);
		expect(sameProjectSettings(a, NO_PROJECT_SETTINGS)).toBe(false);
	});

	it("notices a newly appearing problem", () => {
		expect(
			sameProjectSettings(
				NO_PROJECT_SETTINGS,
				parseProjectSettings('{"tabSize": 99}'),
			),
		).toBe(false);
	});

	it("ignores whitespace and unknown settings, which change nothing", () => {
		expect(
			sameProjectSettings(
				parseProjectSettings('{"tabSize":4}'),
				parseProjectSettings('{ "tabSize": 4, "other": 1 }'),
			),
		).toBe(true);
	});
});
