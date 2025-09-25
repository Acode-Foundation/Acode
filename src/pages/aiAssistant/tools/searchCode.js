import fsOperation from "fileSystem";
import { StructuredTool } from "@langchain/core/tools";
import { addedFolder } from "lib/openFolder";
import { z } from "zod";

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_CONTEXT_LINES = 2;
const MAX_RESULTS_LIMIT = 200;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // Skip files over 1MB to avoid heavy reads
const DEFAULT_EXCLUDED_DIRS = new Set([
	".git",
	".svn",
	".hg",
	"node_modules",
	"build",
	"dist",
	".gradle",
	".idea",
	"Pods",
	".expo",
	".turbo",
	".cache",
	".output",
	"android/app/build",
	"ios/Pods",
	"www/build",
]);

function shellSafePreview(text) {
	if (!text) return "";
	const trimmed = text.replace(/\t/g, "    ").replace(/\r/g, "");
	return trimmed.length > 160 ? `${trimmed.slice(0, 159)}…` : trimmed;
}

function formatContext(lines, matchIndex, contextLines) {
	const start = Math.max(0, matchIndex - contextLines);
	const end = Math.min(lines.length - 1, matchIndex + contextLines);
	const formatted = [];
	for (let i = start; i <= end; i++) {
		const prefix = i === matchIndex ? ">" : " ";
		const lineNo = String(i + 1).padStart(4, " ");
		formatted.push(`${prefix}${lineNo} ${lines[i]}`);
	}
	return formatted.join("\n");
}

function normalizePathForFilters(path) {
	return path.replace(/\\/g, "/");
}

function matchesIncludeExclude(
	path,
	includePatterns,
	excludePatterns,
	{ treatAsDirectory = false } = {},
) {
	const normalized = normalizePathForFilters(path);
	if (excludePatterns?.some((pattern) => normalized.includes(pattern))) {
		return false;
	}
	if (includePatterns && includePatterns.length > 0) {
		if (treatAsDirectory) {
			return includePatterns.some(
				(pattern) =>
					normalized.includes(pattern) || pattern.includes(normalized),
			);
		}
		return includePatterns.some((pattern) => normalized.includes(pattern));
	}
	return true;
}

async function listDirectorySafe(url) {
	try {
		return await fsOperation(url).lsDir();
	} catch (error) {
		console.error("searchCode: failed to list directory", url, error);
		return [];
	}
}

async function readFileSafe(url) {
	try {
		return await fsOperation(url).readFile("utf8");
	} catch (error) {
		return null;
	}
}

function shouldSkipDirectory(relPath) {
	if (!relPath) return false;
	const normalized = normalizePathForFilters(relPath);
	for (const dir of DEFAULT_EXCLUDED_DIRS) {
		if (normalized === dir || normalized.endsWith(`/${dir}`)) {
			return true;
		}
	}
	return false;
}

function buildRegex(query, caseSensitive) {
	const flags = caseSensitive ? "g" : "gi";
	return new RegExp(query, flags);
}

function findMatchesInLine({
	line,
	lineIndex,
	query,
	regex,
	caseSensitive,
	path,
	results,
	maxResults,
}) {
	if (results.length >= maxResults) return;
	if (typeof line !== "string" || line.length === 0) return;

	if (regex) {
		regex.lastIndex = 0;
		let match = regex.exec(line);
		while (match && results.length < maxResults) {
			const column = match.index + 1;
			results.push({
				path,
				line: lineIndex + 1,
				column,
				lineText: line,
				matchIndex: lineIndex,
			});
			match = regex.exec(line);
		}
		return;
	}

	const haystack = caseSensitive ? line : line.toLowerCase();
	const needle = caseSensitive ? query : query.toLowerCase();
	let startIndex = haystack.indexOf(needle);
	while (startIndex !== -1 && results.length < maxResults) {
		results.push({
			path,
			line: lineIndex + 1,
			column: startIndex + 1,
			lineText: line,
			matchIndex: lineIndex,
		});
		startIndex = haystack.indexOf(needle, startIndex + needle.length);
	}
}

async function searchFile({
	fileUrl,
	relativePath,
	query,
	regex,
	caseSensitive,
	contextLines,
	maxResults,
	results,
}) {
	if (results.length >= maxResults) return;

	const content = await readFileSafe(fileUrl);
	if (content === null) return;

	const lines = content.split(/\r?\n/);
	const re = regex ? regex : null;
	const startLength = results.length;

	for (let i = 0; i < lines.length && results.length < maxResults; i++) {
		findMatchesInLine({
			line: lines[i],
			lineIndex: i,
			query,
			regex: re,
			caseSensitive,
			path: relativePath,
			results,
			maxResults,
		});
	}

	for (let idx = startLength; idx < results.length; idx++) {
		const match = results[idx];
		if (!match.lineText) continue;
		match.preview = shellSafePreview(match.lineText);
		match.context = formatContext(lines, match.matchIndex, contextLines);
		delete match.lineText;
	}
}

async function traverse({
	project,
	currentUrl,
	relativePath,
	query,
	regex,
	caseSensitive,
	contextLines,
	maxResults,
	results,
	includePatterns,
	excludePatterns,
}) {
	if (results.length >= maxResults) return;

	const entries = await listDirectorySafe(currentUrl);
	if (!entries || entries.length === 0) return;

	for (const entry of entries) {
		if (results.length >= maxResults) break;
		if (!entry || entry.name === "." || entry.name === "..") continue;

		const relPath = relativePath
			? `${relativePath}/${entry.name}`
			: `${project.title}/${entry.name}`;
		const childUrl = entry.url || `${currentUrl}/${entry.name}`;

		if (entry.isDirectory) {
			const directoryAllowed = matchesIncludeExclude(
				relPath,
				includePatterns,
				excludePatterns,
				{ treatAsDirectory: true },
			);
			if (shouldSkipDirectory(relPath) || !directoryAllowed) {
				continue;
			}
			await traverse({
				project,
				currentUrl: childUrl,
				relativePath: relPath,
				query,
				regex,
				caseSensitive,
				contextLines,
				maxResults,
				results,
				includePatterns,
				excludePatterns,
			});
		} else if (entry.isFile) {
			if (!matchesIncludeExclude(relPath, includePatterns, excludePatterns)) {
				continue;
			}
			if (
				typeof entry.length === "number" &&
				entry.length > MAX_FILE_SIZE_BYTES
			) {
				continue;
			}
			await searchFile({
				fileUrl: childUrl,
				relativePath: relPath,
				query,
				regex,
				caseSensitive,
				contextLines,
				maxResults,
				results,
			});
		}
	}
}

class SearchCodeTool extends StructuredTool {
	name = "searchCode";
	description =
		"Searches files in the current project using a plain string or regular expression." +
		" Returns the path, line, column, and a short preview for each match.";
	schema = z.object({
		query: z
			.string()
			.min(1)
			.describe("Search term or regex pattern depending on 'isRegex'."),
		path: z
			.string()
			.optional()
			.describe(
				"Optional relative path to scope the search. Start with the project root name as shown in the sidebar (e.g. 'project/src').",
			),
		maxResults: z
			.number()
			.int()
			.min(1)
			.max(MAX_RESULTS_LIMIT)
			.optional()
			.describe("Maximum number of matches to return (default 50, cap 200)."),
		caseSensitive: z
			.boolean()
			.optional()
			.describe("Perform a case-sensitive search when true."),
		isRegex: z
			.boolean()
			.optional()
			.describe("Interpret the query as a regular expression when true."),
		contextLines: z
			.number()
			.int()
			.min(0)
			.max(5)
			.optional()
			.describe(
				"Number of context lines to include before and after each match (default 2).",
			),
		include: z
			.array(z.string())
			.optional()
			.describe(
				"Optional list of path substrings to include (any match qualifies).",
			),
		exclude: z
			.array(z.string())
			.optional()
			.describe("Optional list of path substrings to exclude."),
	});

	resolvePath(inputPath) {
		if (
			!inputPath ||
			inputPath === "." ||
			inputPath === "*" ||
			inputPath === "./"
		) {
			return null;
		}
		const parts = inputPath.split("/").filter(Boolean);
		const projectName = parts[0];
		const project = addedFolder.find((folder) => folder.title === projectName);
		if (!project) {
			return {
				error: `Error: Project '${projectName}' not found in opened folders.`,
			};
		}
		const subPath = parts.slice(1).join("/");
		const targetUrl = subPath ? `${project.url}/${subPath}` : project.url;
		const relativeBase = subPath ? `${projectName}/${subPath}` : projectName;
		return { project, targetUrl, relativeBase };
	}

	async _call(options) {
		const {
			query,
			path,
			maxResults = DEFAULT_MAX_RESULTS,
			caseSensitive = false,
			isRegex = false,
			contextLines = DEFAULT_CONTEXT_LINES,
			include,
			exclude,
		} = options;

		try {
			const results = [];
			let roots = [];

			if (path) {
				const resolved = this.resolvePath(path.trim());
				if (resolved?.error) {
					return resolved.error;
				}
				if (!resolved) {
					// Path pointed to root wildcard; fall back to all projects
					roots = addedFolder.slice();
				} else {
					roots = [resolved];
				}
			} else {
				roots = addedFolder.map((folder) => ({
					project: folder,
					targetUrl: folder.url,
					relativeBase: folder.title,
				}));
			}

			if (!roots || roots.length === 0) {
				return "No open folders to search.";
			}

			let compiledRegex = null;
			if (isRegex) {
				try {
					compiledRegex = buildRegex(query, caseSensitive);
				} catch (error) {
					return `Invalid regular expression: ${error.message}`;
				}
			}

			for (const root of roots) {
				if (results.length >= maxResults) break;
				const projectInfo = root.project
					? root
					: { project: root, targetUrl: root.url, relativeBase: root.title };
				await traverse({
					project: projectInfo.project,
					currentUrl: projectInfo.targetUrl,
					relativePath: projectInfo.relativeBase,
					query,
					regex: compiledRegex,
					caseSensitive,
					contextLines,
					maxResults,
					results,
					includePatterns: include,
					excludePatterns: exclude,
				});
			}

			if (results.length === 0) {
				return `No matches for "${query}"${path ? ` in ${path}` : ""}.`;
			}

			const formatted = results.slice(0, maxResults).map((match) => {
				const header = `${match.path}:${match.line}:${match.column}`;
				return `${header}\n${match.context}`;
			});

			if (results.length > maxResults) {
				formatted.push(`\n… truncated after ${maxResults} matches.`);
			}

			return formatted.join("\n\n");
		} catch (error) {
			console.error("searchCode tool error", error);
			return `Error during search: ${error.message}`;
		}
	}
}

export const searchCode = new SearchCodeTool();
