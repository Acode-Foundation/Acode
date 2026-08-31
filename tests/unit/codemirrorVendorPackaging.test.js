import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { list } from "tar";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const packages = [
	{
		name: "@codemirror/view",
		archive: "codemirror-view-6.43.9.tgz",
		files: [
			"package/package.json",
			"package/README.md",
			"package/CHANGELOG.md",
			"package/LICENSE",
			"package/LICENSE-APACHE-2.0",
			"package/ANDROID-NOTICE.md",
			"package/UPSTREAM.md",
			"package/dist/index.js",
			"package/dist/index.cjs",
			"package/dist/index.d.ts",
			"package/dist/index.d.cts",
		],
	},
	{
		name: "@codemirror/language",
		archive: "codemirror-language-6.12.4.tgz",
		files: [
			"package/package.json",
			"package/README.md",
			"package/CHANGELOG.md",
			"package/LICENSE",
			"package/UPSTREAM.md",
			"package/dist/index.js",
			"package/dist/index.cjs",
			"package/dist/index.d.ts",
			"package/dist/index.d.cts",
		],
	},
];

async function archiveEntries(archive) {
	const entries = [];
	await list({
		file: archive,
		onReadEntry(entry) {
			entries.push(entry.path);
			entry.resume();
		},
	});
	return entries;
}

describe("vendored CodeMirror packages", () => {
	it.each(packages)("ships only compiled $name runtime and required metadata", async (pkg) => {
		const archive = path.join(root, "vendor", "packages", pkg.archive);
		const entries = await archiveEntries(archive);

		expect(entries.toSorted()).toEqual(pkg.files.toSorted());
	});

	it("retains the complete Android license and Acode modification notice", () => {
		const packageRoot = path.join(root, "vendor", "codemirror-view");
		const license = fs.readFileSync(
			path.join(packageRoot, "LICENSE-APACHE-2.0"),
			"utf8",
		);
		const notice = fs.readFileSync(path.join(packageRoot, "ANDROID-NOTICE.md"), "utf8");
		expect(license).toContain("Apache License\n                           Version 2.0, January 2004");
		expect(license).toContain("END OF TERMS AND CONDITIONS");
		expect(notice).toContain("Android Open Source Project");
		expect(notice).toContain("Acode ported the calculations to TypeScript");
	});

	it("matches the local archive integrity recorded in package-lock.json", () => {
		const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
		for (const pkg of packages) {
			const archive = fs.readFileSync(path.join(root, "vendor", "packages", pkg.archive));
			const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
			expect(lock.packages[`node_modules/${pkg.name}`].integrity).toBe(integrity);
		}
	});

	it("does not leave emitted JavaScript beside upstream TypeScript tests", () => {
		for (const packageName of ["codemirror-view", "codemirror-language"]) {
			const testDirectory = path.join(root, "vendor", packageName, "test");
			expect(fs.readdirSync(testDirectory).filter((file) => file.endsWith(".js"))).toEqual([]);
		}
	});
});
