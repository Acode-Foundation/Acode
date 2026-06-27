export type LspLogLevel = "debug" | "info" | "log" | "warn" | "error" | "stderr";

export interface LspLogEntry {
	timestamp: Date;
	level: LspLogLevel;
	message: string;
	details?: unknown;
}

const MAX_LOGS = 200;
const logsByServer = new Map<string, LspLogEntry[]>();
const listeners = new Set<(serverId: string, entry: LspLogEntry) => void>();
const IGNORED_LOG_PATTERNS = [
	/\$\/progress\b/i,
	/\bProgress:/i,
	/\bwindow\/workDoneProgress\/create\b/i,
	/\bAuto-responded to window\/workDoneProgress\/create\b/i,
];

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function normalizeMessage(message: unknown): string {
	let text: string;
	if (typeof message === "string") {
		text = message;
	} else if (message instanceof Error) {
		text = message.message;
	} else {
		try {
			text = JSON.stringify(message);
		} catch {
			text = String(message);
		}
	}
	return stripAnsi(String(text || ""))
		.replace(/\[LSP:[^\]]+\]\s*/g, "")
		.replace(/\[LSP-STDERR:[^\]]+\]\s*/g, "")
		.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s*/g, "")
		.replace(/\s*(INFO|WARN|ERROR|DEBUG|TRACE)\s+/gi, "")
		.replace(/[a-z_]+::[a-z_]+:\s*/gi, "")
		.trim();
}

function shouldIgnoreLog(message: string): boolean {
	return IGNORED_LOG_PATTERNS.some((pattern) => pattern.test(message));
}

export function addLspLog(
	serverId: string,
	level: LspLogLevel,
	message: unknown,
	details?: unknown,
): void {
	const id = String(serverId || "").trim();
	if (!id) return;

	const normalized = normalizeMessage(message);
	if (!normalized || shouldIgnoreLog(normalized)) return;

	const logs = logsByServer.get(id) || [];
	const entry: LspLogEntry = {
		timestamp: new Date(),
		level,
		message: normalized,
		details,
	};
	logs.push(entry);
	if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
	logsByServer.set(id, logs);
	listeners.forEach((listener) => listener(id, entry));
}

export function getLspLogServerId(source: unknown): string | null {
	const client =
		source && typeof source === "object" && "client" in source
			? (source as { client?: unknown }).client
			: source;
	const metadata = client as
		| { __acodeServerId?: unknown; serverId?: unknown }
		| null
		| undefined;
	const serverId = metadata?.__acodeServerId ?? metadata?.serverId;
	return typeof serverId === "string" && serverId.trim()
		? serverId.trim()
		: null;
}

export function addLspLogFor(
	source: unknown,
	level: LspLogLevel,
	message: unknown,
	details?: unknown,
): void {
	const serverId = getLspLogServerId(source);
	if (!serverId) return;
	addLspLog(serverId, level, message, details);
}

export function getLspLogs(serverId: string): LspLogEntry[] {
	return logsByServer.get(String(serverId || "").trim()) || [];
}

export function clearLspLogs(serverId: string): void {
	logsByServer.delete(String(serverId || "").trim());
}

export function onLspLog(
	listener: (serverId: string, entry: LspLogEntry) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
