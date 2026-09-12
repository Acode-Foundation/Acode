import { afterEach, describe, expect, it } from "vitest";
import "cm/supportedModes";
import {
	addMode,
	getModeForPath,
	getModes,
	removeMode,
} from "cm/modelist";

function getModeSpecificityScore(modeInstance) {
	if (modeInstance.name.toLowerCase() === "text") {
		return 0;
	}

	const extensionsStr = modeInstance.extensions;
	let maxScore = 0;

	if (extensionsStr) {
		const patterns = extensionsStr.split("|");
		for (const pattern of patterns) {
			let currentScore = 0;
			if (pattern.startsWith("^")) {
				currentScore = 1000 + (pattern.length - 1);
			} else {
				currentScore = pattern.length;
			}
			if (currentScore > maxScore) {
				maxScore = currentScore;
			}
		}
	}

	for (const matcher of modeInstance.filenameMatchers) {
		const score = 1000 + matcher.source.length;
		if (score > maxScore) {
			maxScore = score;
		}
	}

	return maxScore;
}

function legacyGetModeForPath(path) {
	const modes = getModes();
	let mode = modes.find((entry) => entry.name === "text");
	const fileName = path.split(/[/\\]/).pop() || "";

	const sortedModes = [...modes].sort((a, b) => {
		const scoreDiff = getModeSpecificityScore(b) - getModeSpecificityScore(a);
		if (scoreDiff !== 0) return scoreDiff;
		return modes.indexOf(b) - modes.indexOf(a);
	});

	for (const iMode of sortedModes) {
		if (iMode.supportsFile?.(fileName)) {
			mode = iMode;
			break;
		}
	}
	return mode;
}

function collectParityPaths() {
	const paths = new Set([
		"",
		"README",
		".gitignore",
		".env",
		"Dockerfile",
		"dockerfile",
		"MAKEFILE",
		"Makefile",
		"CMakeLists.txt",
		"Gemfile",
		"Rakefile",
		"BUILD",
		"BUCK",
		"Jenkinsfile",
		"nginx.conf",
		"sites-enabled/nginx.proxy.conf",
		"yarn.lock",
		"Cargo.lock",
		"poetry.lock",
		"package.json",
		"tsconfig.json",
		"foo.text",
		"notes.txt",
		"file.d.ts",
		"file.ts",
		"app.test.js",
		"app.js",
		"APP.JS",
		"src/components/Button.tsx",
		"C:\\Users\\dev\\main.py",
		"folder/sub/file.unknownext",
		"example.html ",
		".bashrc",
		".prettierrc",
		"bun.lock",
		"file.astro",
		"game.luau",
	]);

	for (const mode of getModes()) {
		if (mode.extensions) {
			for (const raw of mode.extensions.split("|")) {
				const pattern = raw.trim();
				if (!pattern) continue;
				if (pattern.startsWith("^")) {
					paths.add(pattern.slice(1));
					paths.add(`/tmp/${pattern.slice(1)}`);
				} else {
					paths.add(`sample.${pattern}`);
					paths.add(`nested/dir/sample.${pattern}`);
				}
			}
		}
		for (const matcher of mode.filenameMatchers) {
			const source = matcher.source;
			if (
				source.startsWith("^") &&
				source.endsWith("$") &&
				!/[|()[*+?]/.test(source.slice(1, -1).replace(/\\./g, ""))
			) {
				const name = source
					.slice(1, -1)
					.replace(/\\(.)/g, "$1");
				if (name) paths.add(name);
			}
		}
	}

	return [...paths];
}

const addedModes = [];

afterEach(() => {
	while (addedModes.length) {
		removeMode(addedModes.pop());
	}
});

function registerTestMode(name, extensions, options) {
	addMode(name, extensions, name, null, options);
	addedModes.push(name);
}

describe("getModeForPath", () => {
	it("matches the previous sort-and-scan result for built-in modes", () => {
		const paths = collectParityPaths();
		expect(paths.length).toBeGreaterThan(100);

		const mismatches = [];
		for (const path of paths) {
			const next = getModeForPath(path);
			const legacy = legacyGetModeForPath(path);
			if (next !== legacy) {
				mismatches.push({
					path,
					next: next?.name,
					legacy: legacy?.name,
				});
			}
		}

		expect(mismatches).toEqual([]);
	});

	it("prefers later registrations when specificity is equal", () => {
		registerTestMode("acodebench-first", "acodebench");
		registerTestMode("acodebench-second", "acodebench");

		expect(getModeForPath("demo.acodebench").name).toBe("acodebench-second");

		removeMode("acodebench-second");
		addedModes.pop();

		expect(getModeForPath("demo.acodebench").name).toBe("acodebench-first");
	});

	it("keeps anchored filenames ahead of generic extensions", () => {
		expect(getModeForPath("Dockerfile").name).toBe("dockerfile");
		expect(getModeForPath("dockerfile").name).toBe(
			legacyGetModeForPath("dockerfile").name,
		);
		expect(getModeForPath("CMakeLists.txt").name).toBe("cmake");
		expect(getModeForPath("notes.txt").name).toBe("text");
	});

	it("keeps longer extensions ahead of shorter suffixes", () => {
		expect(getModeForPath("types.d.ts").name).toBe(
			legacyGetModeForPath("types.d.ts").name,
		);
		expect(getModeForPath("types.ts").name).toBe(
			legacyGetModeForPath("types.ts").name,
		);
	});

	it("resolves regex filename matchers", () => {
		expect(getModeForPath("nginx.conf").name).toBe(
			legacyGetModeForPath("nginx.conf").name,
		);
		expect(getModeForPath("BUILD").name).toBe(
			legacyGetModeForPath("BUILD").name,
		);
	});

	it("keeps higher-specificity filename regexes ahead of exact names", () => {
		registerTestMode("acode-exact-foo", "^acodepluginfile");
		registerTestMode("acode-regex-foo", "", {
			filenameMatchers: [/^acodepluginfile.*/],
		});

		expect(getModeForPath("acodepluginfile").name).toBe(
			legacyGetModeForPath("acodepluginfile").name,
		);
		expect(getModeForPath("acodepluginfile").name).toBe("acode-regex-foo");
	});

	it("invalidates plugin registrations immediately", () => {
		registerTestMode("acodepluginmode", "acodepluginmode");

		expect(getModeForPath("demo.acodepluginmode").name).toBe("acodepluginmode");
		expect(getModes().some((mode) => mode.name === "acodepluginmode")).toBe(
			true,
		);

		removeMode("acodepluginmode");
		addedModes.pop();

		expect(getModeForPath("demo.acodepluginmode").name).toBe("text");
	});
});

describe("getModeForPath speed", () => {
	it("is much faster than copying and sorting modes per lookup", () => {
		const files = [];
		for (let i = 0; i < 400; i++) {
			files.push(`src/app${i}.js`);
			files.push(`src/app${i}.ts`);
			files.push(`src/app${i}.json`);
			files.push(`src/app${i}.py`);
			files.push(`src/app${i}.md`);
			files.push(`src/app${i}.css`);
			files.push(`src/app${i}.unknownext`);
			files.push("Dockerfile");
			files.push("nginx.conf");
			files.push("CMakeLists.txt");
		}

		legacyGetModeForPath(files[0]);
		getModeForPath(`cold-index-${Date.now()}.js`);

		const legacyStart = performance.now();
		for (const file of files) {
			legacyGetModeForPath(file);
		}
		const legacyMs = performance.now() - legacyStart;

		const indexedStart = performance.now();
		for (const file of files) {
			getModeForPath(file);
		}
		const indexedMs = performance.now() - indexedStart;

		const warmStart = performance.now();
		for (const file of files) {
			getModeForPath(file);
		}
		const warmMs = performance.now() - warmStart;

		console.log(
			`[modelist] ${files.length} lookups — legacy ${legacyMs.toFixed(2)}ms, indexed ${indexedMs.toFixed(2)}ms, cached ${warmMs.toFixed(2)}ms, speedup ${(legacyMs / Math.max(indexedMs, 0.001)).toFixed(1)}x`,
		);

		expect(indexedMs).toBeLessThan(legacyMs);
		if (legacyMs >= 8) {
			expect(indexedMs * 5).toBeLessThan(legacyMs);
		}
		expect(warmMs).toBeLessThanOrEqual(indexedMs + 1);
	});
});
