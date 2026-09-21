import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

const requireFromTest = createRequire(import.meta.url);
const { parseGitmodules, hasSubmoduleSources, findMissingSubmodules } =
	requireFromTest("../../utils/setup.js");

const GITMODULES = `[submodule "codemirror-lsp-client"]
\tpath = codemirror-lsp-client
\turl = https://github.com/Acode-Foundation/codemirror-lsp-client
`;

function makeRepoRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "acode-setup-"));
}

test("parses submodule path, name and url from .gitmodules", () => {
	const submodules = parseGitmodules(`# a comment
[submodule "codemirror-lsp-client"]
\tpath = codemirror-lsp-client
\turl = https://github.com/Acode-Foundation/codemirror-lsp-client

[submodule "other"]
\tpath = vendor/other
`);

	assert.deepEqual(submodules, [
		{
			name: "codemirror-lsp-client",
			path: "codemirror-lsp-client",
			url: "https://github.com/Acode-Foundation/codemirror-lsp-client",
		},
		{ name: "other", path: "vendor/other", url: "" },
	]);
});

test("treats a missing, empty or .DS_Store-only directory as not checked out", () => {
	const repoRoot = makeRepoRoot();
	const submodule = { path: "codemirror-lsp-client" };

	try {
		assert.equal(hasSubmoduleSources(repoRoot, submodule), false);

		fs.mkdirSync(path.join(repoRoot, submodule.path));
		assert.equal(hasSubmoduleSources(repoRoot, submodule), false);

		fs.writeFileSync(path.join(repoRoot, submodule.path, ".DS_Store"), "");
		assert.equal(hasSubmoduleSources(repoRoot, submodule), false);

		fs.writeFileSync(path.join(repoRoot, submodule.path, "package.json"), "{}");
		assert.equal(hasSubmoduleSources(repoRoot, submodule), true);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("reports the submodules that are not checked out", () => {
	const repoRoot = makeRepoRoot();

	try {
		fs.writeFileSync(path.join(repoRoot, ".gitmodules"), GITMODULES);

		assert.deepEqual(findMissingSubmodules(repoRoot), [
			{
				name: "codemirror-lsp-client",
				path: "codemirror-lsp-client",
				url: "https://github.com/Acode-Foundation/codemirror-lsp-client",
			},
		]);

		fs.mkdirSync(path.join(repoRoot, "codemirror-lsp-client"));
		fs.writeFileSync(
			path.join(repoRoot, "codemirror-lsp-client", "package.json"),
			"{}",
		);

		assert.deepEqual(findMissingSubmodules(repoRoot), []);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("does not require submodules when there is no .gitmodules", () => {
	const repoRoot = makeRepoRoot();

	try {
		assert.deepEqual(findMissingSubmodules(repoRoot), []);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
});
