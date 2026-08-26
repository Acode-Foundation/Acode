import fsOperation from "fileSystem";
import Url from "utils/Url";

// ─── Path resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a relative or absolute path to an Acode URI.
 * Tries each open folder as a root.
 */
function resolvePath(path) {
	if (!path) return null;

	// Already a full URI
	if (/^(file|content|ftp|sftp|https?):\/\//.test(path)) return path;

	// Normalize slashes
	path = path.replace(/\\/g, "/").replace(/^\/+/, "");

	// Try open folders
	const folders = window.addedFolder || [];
	for (const folder of folders) {
		const base = folder.url?.replace(/\/$/, "") || folder;
		if (base) return `${base}/${path}`;
	}

	// Fallback: try DATA_STORAGE or just return as-is
	return path;
}

// ─── Tool Definitions (OpenAI function-calling format) ────────────────────────

export const TOOL_DEFINITIONS = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read the full contents of a file. Use relative paths like 'src/index.js'.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to the file" },
				},
				required: ["path"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "write_file",
			description: "Create or completely overwrite a file with new content.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to the file" },
					content: { type: "string", description: "Full content to write" },
				},
				required: ["path", "content"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "edit_file",
			description:
				"Replace an exact string in a file with new content. Prefer this over write_file for small edits.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to the file" },
					old_string: { type: "string", description: "Exact string to find and replace" },
					new_string: { type: "string", description: "Replacement string" },
				},
				required: ["path", "old_string", "new_string"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "list_dir",
			description: "List all files and subdirectories at a given path.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Directory path. Use '.' or '' for project root.",
					},
				},
				required: ["path"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "search_in_file",
			description: "Search for a text pattern inside a file and return matching lines.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to the file to search" },
					query: { type: "string", description: "Text or regex pattern to search" },
				},
				required: ["path", "query"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_active_file",
			description: "Get the filename, path, and full content of the currently active editor file.",
			parameters: { type: "object", properties: {} },
		},
	},
	{
		type: "function",
		function: {
			name: "apply_to_editor",
			description:
				"Insert or replace code in the active editor at the current cursor selection.",
			parameters: {
				type: "object",
				properties: {
					code: { type: "string", description: "Code to insert/replace at cursor" },
				},
				required: ["code"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "open_file",
			description: "Open a file in the Acode editor as a new tab.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to the file to open" },
				},
				required: ["path"],
			},
		},
	},
];

// ─── Tool names (human-readable labels) ──────────────────────────────────────

export const TOOL_LABELS = {
	read_file: "Reading file",
	write_file: "Writing file",
	edit_file: "Editing file",
	list_dir: "Listing directory",
	search_in_file: "Searching in file",
	get_active_file: "Getting active file",
	apply_to_editor: "Applying code to editor",
	open_file: "Opening file",
};

// ─── Tool Executor ────────────────────────────────────────────────────────────

/**
 * Execute a tool call and return a string result for the LLM.
 * @param {string} name
 * @param {object} args
 * @returns {Promise<string>}
 */
export async function executeTool(name, args) {
	switch (name) {
		case "read_file": {
			const uri = resolvePath(args.path);
			if (!uri) throw new Error(`Cannot resolve path: ${args.path}`);
			const fs = fsOperation(uri);
			const data = await fs.readFile("utf-8");
			if (!data) throw new Error(`File is empty or cannot be read: ${args.path}`);
			return typeof data === "string" ? data : new TextDecoder().decode(data);
		}

		case "write_file": {
			const uri = resolvePath(args.path);
			if (!uri) throw new Error(`Cannot resolve path: ${args.path}`);
			const exists = await fsOperation(uri).exists().catch(() => false);
			if (exists) {
				await fsOperation(uri).writeFile(args.content);
			} else {
				const parentUri = Url.dirname(uri);
				const filename = Url.basename(uri);
				await fsOperation(parentUri).createFile(filename, args.content);
			}
			// Reload if open in editor
			_reloadFileIfOpen(uri);
			return `File written: ${args.path}`;
		}

		case "edit_file": {
			const uri = resolvePath(args.path);
			if (!uri) throw new Error(`Cannot resolve path: ${args.path}`);
			const fs = fsOperation(uri);
			const raw = await fs.readFile("utf-8");
			const content = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
			if (!content.includes(args.old_string)) {
				throw new Error(
					`String not found in ${args.path}. The exact string must match including whitespace.`,
				);
			}
			const updated = content.replace(args.old_string, args.new_string);
			await fs.writeFile(updated);
			_reloadFileIfOpen(uri);
			return `File edited: ${args.path}`;
		}

		case "list_dir": {
			const path = args.path === "." || !args.path ? null : args.path;
			let uri;
			if (!path) {
				const folders = window.addedFolder || [];
				if (!folders.length) return "No project folder is open.";
				uri = folders[0].url || folders[0];
			} else {
				uri = resolvePath(path);
			}
			const entries = await fsOperation(uri).lsDir();
			if (!entries || !entries.length) return "Directory is empty.";
			const lines = entries.map((e) => {
				const name = e.name || Url.basename(e.url || "");
				const type = e.isDirectory || e.type === "dir" ? "📁" : "📄";
				return `${type} ${name}`;
			});
			return lines.join("\n");
		}

		case "search_in_file": {
			const uri = resolvePath(args.path);
			const raw = await fsOperation(uri).readFile("utf-8");
			const content = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
			const lines = content.split("\n");
			let re;
			try {
				re = new RegExp(args.query, "i");
			} catch {
				re = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
			}
			const matches = [];
			lines.forEach((line, i) => {
				if (re.test(line)) matches.push(`L${i + 1}: ${line.trim()}`);
			});
			return matches.length ? matches.join("\n") : "No matches found.";
		}

		case "get_active_file": {
			const file = editorManager?.activeFile;
			if (!file) return "No file is currently open.";
			const content = editorManager?.editor?.state?.doc?.toString?.() || "";
			return JSON.stringify({
				filename: file.filename,
				uri: file.uri,
				content,
			});
		}

		case "apply_to_editor": {
			const editor = editorManager?.editor;
			if (!editor) throw new Error("No editor is open.");
			const { from, to } = editor.state.selection.main;
			editor.dispatch({ changes: { from, to, insert: args.code } });
			return `Code applied to editor at cursor position.`;
		}

		case "open_file": {
			const uri = resolvePath(args.path);
			const { default: openFile } = await import("lib/openFile");
			await openFile(uri, { render: true });
			return `Opened: ${args.path}`;
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _reloadFileIfOpen(uri) {
	try {
		const openFile = editorManager?.getFile?.(uri, "uri");
		if (openFile && typeof openFile.reloadContent === "function") {
			openFile.reloadContent();
		}
	} catch (_) {}
}
