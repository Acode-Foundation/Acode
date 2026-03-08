function getExecutor(): Executor {
	const executor = (globalThis as unknown as { Executor?: Executor }).Executor;
	if (!executor) {
		throw new Error("Executor plugin is not available");
	}
	return executor;
}

function getBackgroundExecutor(): Executor {
	const executor = getExecutor();
	return executor.BackgroundExecutor ?? executor;
}

export function quoteArg(value: unknown): string {
	const str = String(value ?? "");
	if (!str.length) return "''";
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(str)) return str;
	return `'${str.replace(/'/g, "'\\''")}'`;
}

export function formatCommand(
	command: string | string[] | null | undefined,
): string {
	if (Array.isArray(command)) {
		return command.map((part) => quoteArg(part)).join(" ");
	}
	if (typeof command === "string") {
		return command.trim();
	}
	return "";
}

function wrapShellCommand(command: string): string {
	const script = command.trim();
	return `sh -lc ${quoteArg(`set -e\n${script}`)}`;
}

export async function runQuickCommand(command: string): Promise<string> {
	const wrapped = wrapShellCommand(command);
	return getBackgroundExecutor().execute(wrapped, true);
}

export async function runForegroundCommand(command: string): Promise<string> {
	const wrapped = wrapShellCommand(command);
	return getExecutor().execute(wrapped, true);
}
