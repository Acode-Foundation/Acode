import { describe, expect, it } from "vitest";
import { isExcludedFileOperationPath } from "utils/fileOperationExclusions";

const patterns = [
	"**/node_modules/**",
	"**/.git/**",
	"**/*.egg-info/**",
	"*.map",
];

describe("isExcludedFileOperationPath", () => {
	it("matches an excluded directory itself", () => {
		expect(
			isExcludedFileOperationPath(
				"file:///storage/emulated/0/project/node_modules",
				patterns,
			),
		).toBe(true);
	});

	it("matches descendants and file basename patterns", () => {
		expect(
			isExcludedFileOperationPath(
				"file:///storage/emulated/0/project/node_modules/pkg/index.js",
				patterns,
			),
		).toBe(true);
		expect(
			isExcludedFileOperationPath(
				"sftp://example.com/project/dist/app.js.map",
				patterns,
			),
		).toBe(true);
	});

	it("normalizes Windows separators", () => {
		expect(
			isExcludedFileOperationPath(
				"C:\\project\\package.egg-info",
				patterns,
			),
		).toBe(true);
	});

	it("matches paths inside SAF tree URIs", () => {
		const safRoot =
			"content://com.android.externalstorage.documents/tree/primary%3AProjects";

		expect(
			isExcludedFileOperationPath(
				`${safRoot}::primary:Projects/app/node_modules`,
				patterns,
			),
		).toBe(true);
		expect(
			isExcludedFileOperationPath(
				`${safRoot}::primary:Projects/app/src/index.js`,
				patterns,
			),
		).toBe(false);
	});

	it("keeps paths that do not match an exclusion", () => {
		expect(
			isExcludedFileOperationPath(
				"file:///storage/emulated/0/project/src/index.js",
				patterns,
			),
		).toBe(false);
	});

	it("ignores empty and invalid patterns", () => {
		expect(
			isExcludedFileOperationPath("/project/src/index.js", ["", "[invalid"]),
		).toBe(false);
	});
});
