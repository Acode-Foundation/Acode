#!/usr/bin/env node
/**
 * ✨ @ UnschooledGamer (baked With AI, Modified by @ UnschooledGamer) ~ 2025.
 *
 * GitHub Release Notes Generator
 *
 * Features:
 *  - Auto categorizes commits by type
 *  - Optional compact "plain" output to save space
 *  - Option to include only important tags (feat, fix, refactor, perf)
 *  - Option to use only merge commits
 *
 * Usage:
 *  GITHUB_TOKEN=<token> node generate-release-notes.js <owner> <repo> <current_tag> [options]
 *
 * Options:
 *  --plain             Output minimal Markdown (no emojis, compact)
 *  --important-only    Include only features, fixes, refactors, and perf
 *  --merge-only        Include only merge commits
 *  --help              Show usage
 *  --format [md/json]  Output Format
 *  --fromTag v1.11.0   The From/Previous Tag
 *  --quiet             Suppress output to stdout
 */

const args = process.argv.slice(2);

function getArgValue(flag) {
	const idx = args.indexOf(flag);
	return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")
		? args[idx + 1]
		: null;
}
if (args.includes("--help") || args.length < 3) {
	console.log(`
Usage: GITHUB_TOKEN=<token> node generate-release-notes.js <owner> <repo> <tag> [options]
✨ @ UnschooledGamer (baked With AI, Modified by @ UnschooledGamer) ~ 2025

Options:
  --plain             Compact, no emojis (saves space)
  --important-only    Only include Features, Fixes, Refactors, Perf
  --merge-only        Include only merge commits
  --help              Show this help message
  --format [md/json]  Output Format
  --from-tag v1.11.0   The From/Previous Tag
  --quiet             Suppress output to stdout
  --stdout-only       Output to stdout only
  --changelog-only    Output changelog only
`);
	process.exit(0);
}

const [owner, repo, currentTag, previousTagArg] = args;
const token = process.env.GITHUB_TOKEN;
if (!token) {
	console.error("❌ Missing GITHUB_TOKEN environment variable.");
	process.exit(1);
}

const flags = {
	plain: args.includes("--plain"),
	importantOnly: args.includes("--important-only"),
	mergeOnly: args.includes("--merge-only"),
	quiet: args.includes("--quiet") || args.includes("--stdout-only"),
	format: getArgValue("--format") || "md",
	fromTag: getArgValue("--from-tag"),
	changelogOnly: args.includes("--changelog-only"),
};

function log(...msg) {
	if (!flags.quiet) console.error(...msg);
}

const headers = {
	Authorization: `token ${token}`,
	Accept: "application/vnd.github+json",
	"User-Agent": "release-notes-script",
};

async function getPreviousTag() {
	const res = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/tags`,
		{ headers },
	);
	const tags = await res.json();
	if (!Array.isArray(tags) || tags.length < 2) return null;
	return tags[1].name;
}

async function getCommits(previousTag, currentTag) {
	const url = `https://api.github.com/repos/${owner}/${repo}/compare/${previousTag}...${currentTag}`;
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(`Failed to fetch commits: ${res.status}`);
	const data = await res.json();
	return data.commits || [];
}

function categorizeCommits(commits, { mergeOnly, importantOnly }) {
	const sections = {
		feat: [],
		fix: [],
		perf: [],
		refactor: [],
		docs: [],
		chore: [],
		test: [],
		add: [],
		revert: [],
		update: [],
		other: [],
	};

	for (const c of commits) {
		const msg = c.commit.message.split("\n")[0];
		const isMerge =
			msg.startsWith("Merge pull request") || msg.startsWith("Merge branch");

		if (mergeOnly && !isMerge) continue;

		const type =
			Object.keys(sections).find((k) => {
				const lowerMsg = msg.toLowerCase();
				return (
					lowerMsg.startsWith(`${k}:`) ||
					lowerMsg.startsWith(`${k} `) ||
					lowerMsg.startsWith(`${k}: `) ||
					lowerMsg.startsWith(`${k}(`) // handles e.g. 'feat(plugin-api): ...'
				);
			}) || "other";

		if (
			importantOnly &&
			!["feat", "fix", "refactor", "perf", "add", "revert", "update"].includes(
				type,
			)
		)
			continue;

		const author = c.author?.login
			? `[${c.author.login}](https://github.com/${c.author.login})`
			: "unknown";

		const entry = `- ${msg} (${c.sha.slice(0, 7)}) by ${author}`;
		sections[type].push(entry);
	}

	return sections;
}

const emojis = {
	feat: flags.plain ? "" : "✨ ",
	fix: flags.plain ? "" : "🐞 ",
	perf: flags.plain ? "" : "⚡ ",
	refactor: flags.plain ? "" : "🔧 ",
	docs: flags.plain ? "" : "📝 ",
	chore: flags.plain ? "" : "🧹 ",
	test: flags.plain ? "" : "🧪 ",
	other: flags.plain ? "" : "📦 ",
	revert: flags.plain ? "" : "⏪ ",
	add: flags.plain ? "" : "➕ ",
	update: flags.plain ? "" : "🔄 ",
};

function formatMarkdown(tag, prevTag, sections, { plain }) {
	const lines = [
		flags.changelogOnly
			? ""
			: `Changes since [${prevTag}](https://github.com/${owner}/${repo}/releases/tag/${prevTag})`,
		"",
	];

	for (const [type, list] of Object.entries(sections)) {
		if (list.length === 0) continue;
		const header = plain
			? `## ${type}`
			: `## ${emojis[type]}${type[0].toUpperCase() + type.slice(1)}`;
		lines.push(header, "", list.join("\n"), "");
	}

	// Compact single-line mode for super small output
	// if (plain) {
	//   const compact = Object.entries(sections)
	//     .filter(([_, list]) => list.length)
	//     .map(([type, list]) => `${type.toUpperCase()}: ${list.length} commits`)
	//     .join(" | ");
	//   lines.push(`\n_Summary: ${compact}_`);
	// }

	return lines.join("\n");
}

function formatJSON(tag, prevTag, sections, plain = true) {
	const lines = [
		"",
		flags.changelogOnly
			? ""
			: `Changes since [${prevTag}](https://github.com/${owner}/${repo}/releases/tag/${prevTag})`,
		"",
	];

	// todo: split into function
	for (const [type, list] of Object.entries(sections)) {
		if (list.length === 0) continue;
		const header = plain
			? `## ${type}`
			: `## ${emojis[type]}${type[0].toUpperCase() + type.slice(1)}`;
		lines.push(header, "", list.join("\n"), "");
	}
	return JSON.stringify(
		{
			release: tag,
			previous: prevTag,
			sections: Object.fromEntries(
				Object.entries(sections).filter(([_, v]) => v.length),
			),
			notes: lines.join("\n"),
		},
		null,
		2,
	);
}

async function main() {
	log(`🔍 Generating release notes for ${owner}/${repo} @ ${currentTag}...`);

	const prevTag = flags.fromTag || (await getPreviousTag());
	if (!prevTag) {
		console.error("No previous tag found. Use --from-tag to specify one.");
		process.exit(1);
	}

	const commits = await getCommits(prevTag, currentTag);
	if (!commits.length) {
		console.error("No commits found.");
		process.exit(1);
	}
	const categorized = categorizeCommits(commits, flags);
	let output;

	if (flags.format === "json") {
		output = formatJSON(currentTag, prevTag, categorized);
	} else {
		output = formatMarkdown(currentTag, prevTag, categorized, flags);
	}

	process.stdout.write(output + "\n");
}

main().catch((err) => console.error(err));
