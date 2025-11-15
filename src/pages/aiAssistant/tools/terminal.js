import { StructuredTool } from "@langchain/core/tools";
import terminalManager from "components/terminal/terminalManager";
import confirm from "dialogs/confirm";
import { z } from "zod";

const executor = () => {
	const ref = window.Executor;
	if (!ref) {
		throw new Error(
			"Terminal subsystem is unavailable. Ensure the terminal plugin is installed.",
		);
	}
	return ref;
};

const DEFAULT_CWD = "/home";
const REMOTE_PROTOCOL_REGEX = /^(?:content|ftp|sftp|smb):\/\//i;
const BLOCKED_PATTERNS = [
	/\b(npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve)\b/i,
	/\b(vite|expo|nx|next|nuxt|astro|svelte-kit|webpack)\b.*\b(dev|start|serve)\b/i,
	/\b(pnpm|npm|yarn)\s+watch\b/i,
	/\bnode\b.*\b(--watch|-w)\b/i,
	/\bpython\b.*-m\s+http\.server\b/i,
	/\btail\b\s+-f\b/i,
];

function waitForTerminalConnection(component, timeoutMs = 10000) {
	if (!component || component.isConnected) {
		return Promise.resolve();
	}

	return new Promise((resolve, reject) => {
		const start = Date.now();
		const interval = setInterval(() => {
			if (component.isConnected) {
				clearInterval(interval);
				resolve();
				return;
			}

			if (Date.now() - start > timeoutMs) {
				clearInterval(interval);
				reject(new Error("Timed out waiting for terminal to become ready."));
			}
		}, 150);
	});
}

function resolvePosixPath(base, target) {
	const raw = target.startsWith("/")
		? target
		: `${base.replace(/\/$/, "")}/${target}`;
	const parts = raw.split("/");
	const stack = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") {
			stack.pop();
		} else {
			stack.push(part);
		}
	}
	return `/${stack.join("/")}` || "/";
}

function toShellPreview(output) {
	if (!output) return "";
	return output.length > 4000
		? `${output.slice(0, 4000)}\n… (truncated)`
		: output;
}

class TerminalTool extends StructuredTool {
	name = "terminal";
	description =
		"Runs a single shell command inside Acode's Alpine proot environment. " +
		"Long-running dev servers or watch tasks are blocked; use the interactive terminal instead.";

	schema = z.object({
		command: z
			.string()
			.min(1)
			.describe(
				"Shell command to execute. Avoid long-running dev/watch tasks.",
			),
		cwd: z
			.string()
			.optional()
			.describe(
				"Optional working directory. Defaults to the last directory (initially /home). Accepts absolute or relative POSIX paths.",
			),
		requireConfirmation: z
			.boolean()
			.default(true)
			.describe("Prompt the user for confirmation before executing."),
	});

	constructor() {
		super();
		this.currentWorkingDirectory = DEFAULT_CWD;
	}

	isSessionAlive() {
		return Promise.resolve(false);
	}

	getCurrentWorkingDirectory() {
		return this.currentWorkingDirectory;
	}

	async resetSession() {
		this.currentWorkingDirectory = DEFAULT_CWD;
	}

	async stopCurrentProcess() {
		await this.resetSession();
	}

	validateCommand(command) {
		for (const pattern of BLOCKED_PATTERNS) {
			if (pattern.test(command)) {
				throw new Error(
					"This command starts a long-running process. Please use the interactive terminal instead.",
				);
			}
		}
	}

	normalizeCwd(input) {
		if (!input || !input.trim()) {
			return this.currentWorkingDirectory;
		}

		let path = input.trim();

		if (REMOTE_PROTOCOL_REGEX.test(path)) {
			throw new Error(
				"Remote or SAF paths are not accessible from the terminal tool. Only local paths are supported.",
			);
		}

		if (path.startsWith("~")) {
			path = path.replace(/^~(?=\/|$)/, DEFAULT_CWD);
		}

		const resolved = resolvePosixPath(this.currentWorkingDirectory, path);
		return resolved || DEFAULT_CWD;
	}

	async confirmExecution({ command, cwd }) {
		const message =
			`Environment: <strong>Alpine proot sandbox</strong><br>` +
			`Working directory: <code>${cwd}</code><br><br>` +
			`Command:<br><pre style="background:#1f1f1f;color:#fff;padding:12px;border-radius:6px;white-space:pre-wrap;">${command}</pre>` +
			`<br><span style="color:#ffa726;">Please confirm before executing.</span>`;

		const userConfirmed = await confirm("Run Terminal Command", message, true);
		return Boolean(userConfirmed);
	}

	async runExecutor(command) {
		try {
			const stdout = await executor().execute(
				`sh -c "${command.replace(/"/g, '\\"')}"`,
				true,
			);
			return { success: true, stdout: stdout || "" };
		} catch (error) {
			const message =
				typeof error === "string" ? error : error?.message || String(error);
			return { success: false, stderr: message };
		}
	}

	async _call({ command, cwd, requireConfirmation = true }) {
		try {
			const trimmedCommand = command.trim();
			if (!trimmedCommand) {
				return "Error: Empty command provided.";
			}

			this.validateCommand(trimmedCommand);

			const normalizedCwd = this.normalizeCwd(cwd);

			if (requireConfirmation) {
				const consent = await this.confirmExecution({
					command: trimmedCommand,
					cwd: normalizedCwd,
				});
				if (!consent) {
					return "Command cancelled by user.";
				}
			}

			const wrappedCommand = `cd "${normalizedCwd.replace(/"/g, '\\"')}" && ${trimmedCommand}`;

			const result = await this.runExecutor(wrappedCommand);

			if (result.success) {
				this.currentWorkingDirectory = normalizedCwd;
			}

			const lines = [
				"Environment: Alpine proot sandbox",
				`Working directory: ${normalizedCwd}`,
				`Command: ${trimmedCommand}`,
				result.success ? "Status: SUCCESS" : "Status: FAILED",
			];

			const body = [];
			if (result.success && result.stdout) {
				body.push(`STDOUT:\n${toShellPreview(result.stdout)}`);
			} else if (result.success) {
				body.push("STDOUT:\n(no output)\n");
			}

			if (!result.success && result.stderr) {
				body.push(`STDERR:\n${toShellPreview(result.stderr)}`);
			}

			if (!result.success) {
				body.push(
					"Hint: Use the interactive terminal tool for commands that need an ongoing session.",
				);
			}

			return [...lines, "", ...body].join("\n");
		} catch (error) {
			return `Error: ${error.message}`;
		}
	}
}

class InteractiveTerminalTool extends StructuredTool {
	name = "interactiveTerminal";
	description =
		"Opens a dedicated terminal tab in the UI (server-backed) for manual interaction. " +
		"Use this for long-running or interactive workflows.";

	schema = z.object({
		name: z.string().optional().describe("Optional custom tab title."),
		command: z
			.string()
			.optional()
			.describe(
				"Optional command to send once the terminal is ready (a newline is appended automatically).",
			),
	});

	async _call({ name, command }) {
		try {
			const terminal = await terminalManager.createTerminal({
				name: name || "AI Assistant Terminal",
				serverMode: true,
			});

			if (!terminal) {
				return "Failed to create terminal session.";
			}

			try {
				await waitForTerminalConnection(terminal.component);
			} catch (connectionError) {
				return `Terminal tab opened, but the backend did not become ready: ${connectionError.message}`;
			}

			if (command && command.trim()) {
				terminalManager.writeToTerminal(terminal.id, `${command.trim()}\r\n`);
				return `Interactive terminal "${terminal.name}" opened and command sent.`;
			}

			return `Interactive terminal "${terminal.name}" opened. You can find it in the tab bar.`;
		} catch (error) {
			return `Error creating terminal: ${error.message}`;
		}
	}
}

const terminalToolInstance = new TerminalTool();

export const terminal = terminalToolInstance;
export const interactiveTerminal = new InteractiveTerminalTool();
