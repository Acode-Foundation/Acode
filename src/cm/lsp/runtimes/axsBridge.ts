import { quoteArg } from "../installRuntime";
import type { BridgeConfig } from "../types";

export const DEFAULT_AXS_BINARY = "$PREFIX/axs";

export type AxsBridgeStatusCheckResult = "alive" | "unsupported" | "dead";

interface AxsBridgeStatusResponse {
	program?: unknown;
	processes?: unknown;
}

export function buildAxsBridgeCommand(
	bridge: BridgeConfig | undefined,
	commandOverride?: string | null,
	session?: string,
	axsBinary = DEFAULT_AXS_BINARY,
): string | null {
	if (!bridge || bridge.kind !== "axs") return null;

	const binary =
		commandOverride || bridge.command
			? String(commandOverride || bridge.command)
			: (() => {
					throw new Error("Bridge requires a command to execute");
				})();
	const args: string[] = Array.isArray(bridge.args)
		? bridge.args.map((arg) => String(arg))
		: [];
	const effectiveSession = session || bridge.session || binary;
	const parts = [axsBinary, "lsp", "--session", quoteArg(effectiveSession)];

	if (
		typeof bridge.port === "number" &&
		bridge.port > 0 &&
		bridge.port <= 65535
	) {
		parts.push("--port", String(bridge.port));
	}

	parts.push(quoteArg(binary));

	if (args.length) {
		parts.push("--");
		args.forEach((arg) => parts.push(quoteArg(arg)));
	}

	return parts.join(" ");
}

export function getAxsBridgeStatusUrl(webSocketUrl: string): string {
	return webSocketUrl
		.replace(/^ws:/i, "http:")
		.replace(/^wss:/i, "https:")
		.replace(/\/?$/, "/status");
}

function isAxsBridgeStatusResponse(
	value: AxsBridgeStatusResponse | null,
): boolean {
	return (
		!!value &&
		typeof value.program === "string" &&
		Array.isArray(value.processes)
	);
}

export async function checkAxsBridgeStatus(
	url: string,
	timeout = 1000,
): Promise<AxsBridgeStatusCheckResult> {
	const statusUrl = getAxsBridgeStatusUrl(url);
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(statusUrl, {
			signal: controller.signal,
		});
		if (!response.ok) {
			return "unsupported";
		}

		const data = (await response.json().catch(() => null)) as
			| AxsBridgeStatusResponse
			| null;
		return isAxsBridgeStatusResponse(data) ? "alive" : "dead";
	} catch {
		return "dead";
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function checkServerAliveViaWebSocket(
	url: string,
	timeout = 1000,
): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const ws = new WebSocket(url);
			let settled = false;
			const finish = (alive: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(alive);
			};
			const timer = setTimeout(() => {
				try {
					ws.close();
				} catch {}
				finish(false);
			}, timeout);

			ws.onopen = () => {
				try {
					ws.close();
				} catch {}
				finish(true);
			};

			ws.onerror = () => {
				finish(false);
			};

			ws.onclose = () => {
				finish(false);
			};
		} catch {
			resolve(false);
		}
	});
}
