import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
	hasBinaryContent,
	isBinaryFile,
	isTextFile,
} from "utils/binaryExtensions";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("../../src/sidebarApps/searchInFiles/worker.js", import.meta.url),
	"utf8",
).replace(/^import [^;]*;\n/gm, "");
async function search(content, regex) {
	const messages = [];
	const context = vm.createContext({
		self: {
			postMessage(message) {
				messages.push(message);
				if (message.action === "search-result")
					queueMicrotask(() =>
						context.self.onmessage({
							data: { action: "result-ack", id: message.id },
						}),
					);
			},
		},
		picomatch: { isMatch: () => true },
		isBinaryFile: () => false,
		hasBinaryContent: () => false,
		isTextFile: () => false,
	});
	vm.runInContext(source, context);
	context.content = content;
	context.regex = regex;
	await vm.runInContext(
		`searchInFile({ file: { name: "test" }, content, search: regex })`,
		context,
		{ timeout: 1000 },
	);
	const batches = messages
		.filter((m) => m.action === "search-result")
		.map((m) => m.data);
	return { batches, matches: batches.flatMap((b) => b.matches) };
}
describe("fallback search matching", () => {
	it("advances empty Unicode matches without hanging", async () => {
		const result = await search("😀x", /(?:)/gu);
		expect(result.matches.map((m) => m.position.start.column)).toEqual([
			0, 2, 3,
		]);
	});
	it("tracks multiline positions and resets regex state", async () => {
		const regex = /ab\ncd/g;
		regex.lastIndex = 100;
		const result = await search("z\nab\ncd\nab\ncd", regex);
		expect(result.matches.map((m) => m.position)).toEqual([
			{ start: { row: 1, column: 0 }, end: { row: 2, column: 2 } },
			{ start: { row: 3, column: 0 }, end: { row: 4, column: 2 } },
		]);
	});
	it("streams every dense long-line match in bounded batches", async () => {
		const result = await search("x ".repeat(100000), /x/g);
		expect(result.matches).toHaveLength(100000);
		expect(result.batches.every((b) => b.matches.length <= 200)).toBe(true);
		expect(result.matches.every((m) => m.line.length <= 166)).toBe(true);
	});
	it("bounds even a match spanning the entire document", async () => {
		const result = await search("x".repeat(100000), /x+/g);
		expect(result.matches[0].position.end.column).toBe(100000);
		expect(result.matches[0].renderText.length).toBe(160);
		expect(result.matches[0].line.length).toBeLessThanOrEqual(166);
	});
});

async function searchFiles(
	fileContents,
	regex,
	mime = "application/octet-stream",
) {
	const messages = [];
	const context = vm.createContext({
		self: {
			postMessage(message) {
				messages.push(message);
				if (message.action === "get-file")
					queueMicrotask(() =>
						context.self.onmessage({
							data: {
								action: "get-file",
								id: message.id,
								data: fileContents[message.data],
							},
						}),
					);
				if (message.action === "search-result")
					queueMicrotask(() =>
						context.self.onmessage({
							data: { action: "result-ack", id: message.id },
						}),
					);
			},
		},
		picomatch: { isMatch: () => true },
		isBinaryFile,
		hasBinaryContent,
		isTextFile,
	});
	vm.runInContext(source, context);
	const finished = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("search timed out")), 1000);
		const check = () => {
			if (messages.some((m) => m.action === "done-searching")) {
				clearTimeout(timer);
				resolve();
			} else setTimeout(check, 5);
		};
		check();
	});
	context.self.onmessage({
		data: {
			action: "search-files",
			data: {
				files: Object.keys(fileContents).map((url) => ({
					url,
					path: url,
					name: url,
					mime,
				})),
				search: regex,
				options: {},
			},
		},
	});
	await finished;
	return messages
		.filter((m) => m.action === "search-result")
		.map((m) => m.data.file.url);
}

describe("search files with an unknown mime type", () => {
	it("searches text files reported as application/octet-stream", async () => {
		const urls = await searchFiles(
			{
				"session.jsonl": '{"msg":"needle"}\n',
				"session.jsonl.bak": '{"msg":"needle"}\n',
			},
			/needle/g,
		);
		expect(urls.sort()).toEqual(["session.jsonl", "session.jsonl.bak"]);
	});

	it("skips files whose content is binary", async () => {
		const urls = await searchFiles(
			{
				"notes.unknownext": "needle\n",
				"blob.unknownext": "\u0000\u0001needle\u0002",
			},
			/needle/g,
		);
		expect(urls).toEqual(["notes.unknownext"]);
	});

	it("keeps ANSI-colored logs searchable", async () => {
		const colored = "\u001b[31mneedle\u001b[0m\n";
		const urls = await searchFiles(
			{ "app.log": colored, "output.unknownext": colored },
			/needle/g,
		);
		expect(urls.sort()).toEqual(["app.log", "output.unknownext"]);
	});

	it("does not inspect the content of files already known to be text", async () => {
		const urls = await searchFiles(
			{ "app.log": "\u0001needle\n", "notes.txt": "\u0000needle\n" },
			/needle/g,
			undefined,
		);
		expect(urls.sort()).toEqual(["app.log", "notes.txt"]);
	});
});
