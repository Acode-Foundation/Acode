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

	it("keeps mode-level ranking when a longer suffix is claimed by a lower-ranked mode", () => {
		registerTestMode("acode-long-ts", "ts|verylongextension");
		registerTestMode("acode-dts", "d.ts");

		expect(getModeForPath("types.d.ts").name).toBe(
			legacyGetModeForPath("types.d.ts").name,
		);
		expect(getModeForPath("types.d.ts").name).toBe("acode-long-ts");
		expect(getModeForPath("file.verylongextension").name).toBe("acode-long-ts");
		expect(getModeForPath("file.ts").name).toBe("acode-long-ts");
	});

	it("matches the previous sort-and-scan result for a large mixed folder", () => {
		const files = [];
		for (let i = 0; i < 50; i++) {
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
			files.push("types.d.ts");
		}

		const mismatches = [];
		for (const file of files) {
			const next = getModeForPath(file);
			const legacy = legacyGetModeForPath(file);
			if (next !== legacy) {
				mismatches.push({
					file,
					next: next?.name,
					legacy: legacy?.name,
				});
			}
		}

		expect(mismatches).toEqual([]);
	});
});
