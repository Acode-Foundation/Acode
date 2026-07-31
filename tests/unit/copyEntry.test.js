import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => {
	const entries = new Map([
		[
			"/source",
			{
				name: "source",
				isDirectory: true,
				children: ["/source/src", "/source/node_modules"],
			},
		],
		[
			"/source/src",
			{
				name: "src",
				isDirectory: true,
				children: ["/source/src/index.js"],
			},
		],
		[
			"/source/src/index.js",
			{
				name: "index.js",
				isDirectory: false,
				content: "console.log('copied');",
			},
		],
		[
			"/source/node_modules",
			{
				name: "node_modules",
				isDirectory: true,
				children: ["/source/node_modules/package.json"],
			},
		],
		[
			"/source/node_modules/package.json",
			{
				name: "package.json",
				isDirectory: false,
				content: "{}",
			},
		],
	]);

	return {
		entries,
		created: [],
	};
});

vi.mock("fileSystem", () => ({
	default(url) {
		const entry = fileSystem.entries.get(url);

		return {
			async stat() {
				return { ...entry, url };
			},
			async lsDir() {
				return entry.children.map((childUrl) => ({
					...fileSystem.entries.get(childUrl),
					url: childUrl,
				}));
			},
			async readFile() {
				return entry.content;
			},
			async createDirectory(name) {
				const createdUrl = `${url}/${name}`;
				fileSystem.created.push({ type: "directory", url: createdUrl });
				return createdUrl;
			},
			async createFile(name, content) {
				const createdUrl = `${url}/${name}`;
				fileSystem.created.push({ type: "file", url: createdUrl, content });
				return createdUrl;
			},
		};
	},
}));

import copyEntry from "utils/copyEntry";

describe("copyEntry", () => {
	beforeEach(() => {
		fileSystem.created.length = 0;
	});

	it("prunes excluded directory subtrees", async () => {
		const result = await copyEntry("/source", "/target", {
			excludePatterns: ["**/node_modules/**"],
		});

		expect(result).toEqual({
			url: "/target/source",
			copied: 3,
			skipped: 1,
		});
		expect(fileSystem.created).toEqual([
			{ type: "directory", url: "/target/source" },
			{ type: "directory", url: "/target/source/src" },
			{
				type: "file",
				url: "/target/source/src/index.js",
				content: "console.log('copied');",
			},
		]);
	});

	it("copies excluded paths when no patterns are enabled", async () => {
		const result = await copyEntry("/source/node_modules", "/target");

		expect(result.skipped).toBe(0);
		expect(fileSystem.created.map(({ url }) => url)).toEqual([
			"/target/node_modules",
			"/target/node_modules/package.json",
		]);
	});
});
