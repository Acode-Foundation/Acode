import appSettings from "lib/settings";
import type { LspRuntimeContext, LspServerDefinition } from "./types";

export const AUTO_RUNTIME_ID = "auto";

interface RuntimeSettings {
	default?: string;
	servers?: Record<string, string>;
	workspaces?: Record<string, string>;
}

function toRuntimeId(value: unknown): string | null {
	const id = String(value ?? "")
		.trim()
		.toLowerCase();
	return id || null;
}

function getRuntimeSettings(): RuntimeSettings {
	const runtime = appSettings.value?.lsp?.runtime;
	return runtime && typeof runtime === "object" ? runtime : {};
}

function getWorkspaceRuntimeOverride(
	settings: RuntimeSettings,
	context: LspRuntimeContext,
): string | null {
	const workspaces = settings.workspaces;
	if (!workspaces || typeof workspaces !== "object") return null;

	const candidates = [
		context.rootUri,
		context.file?.uri,
		context.uri,
		context.documentUri,
	]
		.map((uri) => String(uri || ""))
		.filter(Boolean);

	let bestMatch = "";
	let bestRuntime: string | null = null;
	for (const [prefix, runtimeId] of Object.entries(workspaces)) {
		const normalizedPrefix = String(prefix || "");
		if (!normalizedPrefix) continue;
		if (
			normalizedPrefix.length > bestMatch.length &&
			candidates.some((uri) => uri.startsWith(normalizedPrefix))
		) {
			bestMatch = normalizedPrefix;
			bestRuntime = toRuntimeId(runtimeId);
		}
	}

	return bestRuntime;
}

export function getConfiguredRuntimeId(
	server: LspServerDefinition,
	context: LspRuntimeContext = {},
): string | null {
	const settings = getRuntimeSettings();
	const serverId = String(server.id || "").toLowerCase();
	const serverOverride = toRuntimeId(settings.servers?.[serverId]);
	if (serverOverride && serverOverride !== AUTO_RUNTIME_ID) {
		return serverOverride;
	}

	const workspaceOverride = getWorkspaceRuntimeOverride(settings, context);
	if (workspaceOverride && workspaceOverride !== AUTO_RUNTIME_ID) {
		return workspaceOverride;
	}

	const defaultRuntime = toRuntimeId(settings.default);
	if (defaultRuntime && defaultRuntime !== AUTO_RUNTIME_ID) {
		return defaultRuntime;
	}

	return null;
}

export async function setDefaultRuntime(runtimeId: string): Promise<void> {
	const current = appSettings.value?.lsp || {};
	await appSettings.update({
		lsp: {
			...current,
			runtime: {
				...(current.runtime || {}),
				default: toRuntimeId(runtimeId) || AUTO_RUNTIME_ID,
			},
		},
	});
}

export async function setServerRuntime(
	serverId: string,
	runtimeId: string,
): Promise<void> {
	const normalizedServerId = String(serverId || "")
		.trim()
		.toLowerCase();
	if (!normalizedServerId) throw new Error("Server id is required");

	const current = appSettings.value?.lsp || {};
	const currentRuntime = (current.runtime || {}) as RuntimeSettings;
	const runtime = {
		...currentRuntime,
		servers: {
			...(currentRuntime.servers || {}),
		} as Record<string, string>,
	};
	const normalizedRuntimeId = toRuntimeId(runtimeId) || AUTO_RUNTIME_ID;
	if (normalizedRuntimeId === AUTO_RUNTIME_ID) {
		delete runtime.servers[normalizedServerId];
	} else {
		runtime.servers[normalizedServerId] = normalizedRuntimeId;
	}

	await appSettings.update({
		lsp: {
			...current,
			runtime,
		},
	});
}

export function getDefaultRuntimeSetting(): string {
	return toRuntimeId(appSettings.value?.lsp?.runtime?.default) || AUTO_RUNTIME_ID;
}

export function getServerRuntimeSetting(serverId: string): string {
	const normalizedServerId = String(serverId || "")
		.trim()
		.toLowerCase();
	const servers = (appSettings.value?.lsp?.runtime?.servers || {}) as Record<
		string,
		unknown
	>;
	return (
		toRuntimeId(servers[normalizedServerId]) ||
		AUTO_RUNTIME_ID
	);
}
