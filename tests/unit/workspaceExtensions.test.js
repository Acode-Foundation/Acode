import {
	EXTENSIONS_FILE,
	isPluginId,
	MAX_EXTENSIONS_FILE_SIZE,
	MAX_RECOMMENDATIONS,
	NO_RECOMMENDATIONS,
	parseExtensionRecommendations,
	sameRecommendations,
	unusableRecommendations,
} from "lib/workspaceExtensions";
import { describe, expect, it } from "vitest";

const parse = (value) => parseExtensionRecommendations(JSON.stringify(value));

describe("constants", () => {
	it("reads from extensions.json", () => {
		expect(EXTENSIONS_FILE).toBe("extensions.json");
		expect(MAX_EXTENSIONS_FILE_SIZE).toBeGreaterThan(0);
	});
});

describe("isPluginId", () => {
	it.each([
		"acode.plugin.extra_syntax_highlights",
		"a",
		"A1",
		"x.y-z_w",
		"com.example.plugin-2",
		"a".repeat(100),
	])("accepts %s", (id) => {
		expect(isPluginId(id)).toBe(true);
	});

	// An id reaches Url.join(PLUGIN_DIR, id) and installPlugin(), which treats
	// anything that looks like a URL as a place to install from.
	it.each([
		"https://evil.example/plugin.zip",
		"http://evil.example/p",
		"file:///data/data/com.foxdebug.acode/x",
		"content://com.android.externalstorage.documents/x",
		"javascript:alert(1)",
		"../../etc/passwd",
		"..",
		".",
		"a/b",
		"a\\b",
		"/abs",
		"a:b",
		"a b",
		" a",
		"a ",
		"a\n",
		"a\u0000b",
		".hidden",
		"-leading-dash",
		"_leading_underscore",
		"é",
		"a%2Fb",
		"a?b=c",
		"a#b",
		"",
		"a".repeat(101),
	])("rejects %j", (id) => {
		expect(isPluginId(id)).toBe(false);
	});

	it.each([
		null,
		undefined,
		1,
		true,
		{},
		[],
		["a"],
	])("rejects the non-string %j", (value) => {
		expect(isPluginId(value)).toBe(false);
	});
});

describe("parseExtensionRecommendations", () => {
	it("accepts a list of plugin ids", () => {
		const result = parse({ recommendations: ["a.b", "c-d"] });
		expect(result.recommendations).toEqual(["a.b", "c-d"]);
		expect(result.problems).toEqual([]);
	});

	it.each([
		["", "empty"],
		["  \n", "blank"],
		[undefined, "undefined"],
		[null, "null"],
		[7, "a number"],
	])("treats %j (%s) as no recommendations, without a problem", (input) => {
		expect(parseExtensionRecommendations(input)).toBe(NO_RECOMMENDATIONS);
	});

	it("treats an object without the key as no recommendations", () => {
		expect(parse({})).toBe(NO_RECOMMENDATIONS);
		expect(parse({ somethingElse: ["a"] })).toBe(NO_RECOMMENDATIONS);
	});

	it("treats an empty list as no recommendations", () => {
		const result = parse({ recommendations: [] });
		expect(result.recommendations).toEqual([]);
		expect(result.problems).toEqual([]);
	});

	it("reports invalid JSON instead of throwing", () => {
		const result = parseExtensionRecommendations('{"recommendations": [');
		expect(result.recommendations).toEqual([]);
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0]).toMatch(/not valid json/i);
	});

	it.each([
		"[]",
		'["a"]',
		"42",
		'"a"',
		"true",
	])("rejects %s because it is not an object", (text) => {
		const result = parseExtensionRecommendations(text);
		expect(result.recommendations).toEqual([]);
		expect(result.problems).toEqual(["Expected a JSON object"]);
	});

	it.each([
		"acode.plugin.x",
		{ 0: "a" },
		42,
		true,
		null,
	])("rejects a recommendations value that is not a list: %j", (value) => {
		const result = parse({ recommendations: value });
		expect(result.recommendations).toEqual([]);
		expect(result.problems).toEqual([
			'"recommendations" must be a list of plugin ids',
		]);
	});

	it("keeps the valid ids when others are bad", () => {
		const result = parse({
			recommendations: [
				"good.one",
				"https://evil.example/x.zip",
				"good.two",
				5,
			],
		});
		expect(result.recommendations).toEqual(["good.one", "good.two"]);
		expect(result.problems).toEqual([
			'"https://evil.example/x.zip" is not a valid plugin id',
			"A number entry is not a valid plugin id",
		]);
	});

	it("never lets a path- or URL-like id through", () => {
		const hostile = [
			"https://evil.example/p.zip",
			"file:///x",
			"content://x/y",
			"../../x",
			"a/b",
			"a:b",
		];
		const result = parse({ recommendations: hostile });
		expect(result.recommendations).toEqual([]);
		expect(result.problems).toHaveLength(hostile.length);
	});

	it("removes duplicates quietly", () => {
		const result = parse({ recommendations: ["a", "b", "a", "b", "a"] });
		expect(result.recommendations).toEqual(["a", "b"]);
		expect(result.problems).toEqual([]);
	});

	it("treats ids that differ only in case as different, as the file system might", () => {
		expect(parse({ recommendations: ["Abc", "abc"] }).recommendations).toEqual([
			"Abc",
			"abc",
		]);
	});

	it("uses only the first MAX_RECOMMENDATIONS and says so", () => {
		const ids = Array.from(
			{ length: MAX_RECOMMENDATIONS + 5 },
			(_, i) => `p${i}`,
		);
		const result = parse({ recommendations: ids });
		expect(result.recommendations).toEqual(ids.slice(0, MAX_RECOMMENDATIONS));
		expect(result.problems).toEqual([
			`Only the first ${MAX_RECOMMENDATIONS} plugins are used`,
		]);
	});

	it("does not count duplicates or bad entries against the limit", () => {
		const ids = [
			...Array.from({ length: MAX_RECOMMENDATIONS }, (_, i) => `p${i}`),
			"p0",
		];
		const result = parse({ recommendations: ids });
		expect(result.recommendations).toHaveLength(MAX_RECOMMENDATIONS);
		expect(result.problems).toEqual([]);
	});

	it("shortens a huge bad entry in its message", () => {
		const result = parse({ recommendations: ["x/".repeat(5000)] });
		expect(result.problems).toHaveLength(1);
		expect(result.problems[0].length).toBeLessThan(80);
	});

	describe("hostile input", () => {
		it("ignores a __proto__ key and pollutes nothing", () => {
			const result = parseExtensionRecommendations(
				'{"__proto__": {"recommendations": ["evil"], "polluted": true}}',
			);
			expect(result).toBe(NO_RECOMMENDATIONS);
			expect({}.polluted).toBeUndefined();
			expect({}.recommendations).toBeUndefined();
		});

		it("does not read an inherited recommendations property", () => {
			// Only an own property named "recommendations" counts.
			const result = parseExtensionRecommendations('{"constructor": 1}');
			expect(result).toBe(NO_RECOMMENDATIONS);
		});

		it("rejects __proto__ as an id, since ids must start with a letter or digit", () => {
			const result = parse({ recommendations: ["__proto__", "constructor"] });
			// "constructor" is a plain, harmless id; "__proto__" is not a valid one.
			expect(result.recommendations).toEqual(["constructor"]);
			expect(result.problems).toEqual(['"__proto__" is not a valid plugin id']);
		});
	});

	it("returns frozen results that callers cannot alter", () => {
		const result = parse({ recommendations: ["a"] });
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.recommendations)).toBe(true);
		expect(Object.isFrozen(result.problems)).toBe(true);
		expect(() => {
			"use strict";
			result.recommendations.push("b");
		}).toThrow();
	});

	it("shares one frozen empty result", () => {
		expect(Object.isFrozen(NO_RECOMMENDATIONS)).toBe(true);
		expect(Object.isFrozen(NO_RECOMMENDATIONS.recommendations)).toBe(true);
	});
});

describe("unusableRecommendations", () => {
	it("carries the problem and no recommendations", () => {
		const result = unusableRecommendations("too big");
		expect(result.recommendations).toEqual([]);
		expect(result.problems).toEqual(["too big"]);
		expect(Object.isFrozen(result)).toBe(true);
	});
});

describe("sameRecommendations", () => {
	it("compares ids and problems", () => {
		const a = parse({ recommendations: ["a", "b"] });
		expect(sameRecommendations(a, parse({ recommendations: ["a", "b"] }))).toBe(
			true,
		);
		expect(sameRecommendations(a, parse({ recommendations: ["b", "a"] }))).toBe(
			false,
		);
		expect(sameRecommendations(a, NO_RECOMMENDATIONS)).toBe(false);
	});

	it("notices a newly appearing problem", () => {
		expect(
			sameRecommendations(
				NO_RECOMMENDATIONS,
				parse({ recommendations: ["a/b"] }),
			),
		).toBe(false);
	});

	it("ignores whitespace and unknown keys, which change nothing", () => {
		expect(
			sameRecommendations(
				parseExtensionRecommendations('{"recommendations":["a"]}'),
				parseExtensionRecommendations(
					'{ "recommendations": [ "a" ], "other": 1 }',
				),
			),
		).toBe(true);
	});
});
