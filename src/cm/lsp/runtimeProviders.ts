import type {
	LspRuntimeContext,
	LspRuntimeProvider,
	LspServerDefinition,
	WorkspaceKind,
} from "./types";
import { getConfiguredRuntimeId } from "./runtimeSettings";

export const BUILTIN_ALPINE_RUNTIME_ID = "builtin-alpine";
export const EXTERNAL_WEBSOCKET_RUNTIME_ID = "external-websocket";

interface RegisterRuntimeProviderOptions {
	replace?: boolean;
}

const providers = new Map<string, LspRuntimeProvider>();

function toKey(id: string | null | undefined): string {
	return String(id ?? "")
		.trim()
		.toLowerCase();
}

function normalizeProvider(
	provider: LspRuntimeProvider,
): LspRuntimeProvider {
	const id = toKey(provider?.id);
	if (!id) throw new Error("LSP runtime provider requires a non-empty id");
	if (!provider.label || typeof provider.label !== "string") {
		throw new Error(`LSP runtime provider ${id} requires a label`);
	}
	if (typeof provider.canHandle !== "function") {
		throw new Error(`LSP runtime provider ${id} requires canHandle()`);
	}
	if (typeof provider.start !== "function") {
		throw new Error(`LSP runtime provider ${id} requires start()`);
	}
	for (const method of [
		"checkInstallation",
		"install",
		"uninstall",
		"getInstallCommand",
		"getUninstallCommand",
		"stop",
	] as const) {
		if (
			provider[method] !== undefined &&
			typeof provider[method] !== "function"
		) {
			throw new Error(`LSP runtime provider ${id} has invalid ${method}()`);
		}
	}
	return { ...provider, id };
}

function getPriority(provider: LspRuntimeProvider): number {
	const priority = Number(provider.priority);
	return Number.isFinite(priority) ? priority : 0;
}

function getAllowedRuntimes(server: LspServerDefinition): Set<string> | null {
	if (!Array.isArray(server.runtimes) || !server.runtimes.length) {
		return null;
	}
	const ids = server.runtimes.map(toKey).filter(Boolean);
	return ids.length ? new Set(ids) : null;
}

function canProviderRunServer(
	provider: LspRuntimeProvider,
	server: LspServerDefinition,
): boolean {
	const allowed = getAllowedRuntimes(server);
	if (allowed) return allowed.has(provider.id);
	return true;
}

function withDerivedContext(
	server: LspServerDefinition,
	context: LspRuntimeContext = {},
): LspRuntimeContext {
	return {
		...context,
		serverId: context.serverId || server.id,
		workspaceKind: context.workspaceKind || inferWorkspaceKind(context),
	};
}

export function registerRuntimeProvider(
	provider: LspRuntimeProvider,
	options: RegisterRuntimeProviderOptions = {},
): LspRuntimeProvider {
	const normalized = normalizeProvider(provider);
	if (providers.has(normalized.id) && !options.replace) {
		throw new Error(
			`LSP runtime provider ${normalized.id} is already registered`,
		);
	}
	providers.set(normalized.id, normalized);
	return normalized;
}

export function unregisterRuntimeProvider(id: string): boolean {
	return providers.delete(toKey(id));
}

export function getRuntimeProvider(id: string): LspRuntimeProvider | null {
	return providers.get(toKey(id)) ?? null;
}

export function listRuntimeProviders(): LspRuntimeProvider[] {
	return Array.from(providers.values()).sort(
		(a, b) => getPriority(b) - getPriority(a) || a.id.localeCompare(b.id),
	);
}

export async function selectRuntimeProvider(
	server: LspServerDefinition,
	context: LspRuntimeContext = {},
): Promise<LspRuntimeProvider | null> {
	const runtimeContext = withDerivedContext(server, context);
	const configuredRuntimeId = getConfiguredRuntimeId(server, runtimeContext);
	if (configuredRuntimeId) {
		const configuredProvider = getRuntimeProvider(configuredRuntimeId);
		if (!configuredProvider) {
			console.warn(
				`Configured LSP runtime provider ${configuredRuntimeId} is not registered`,
			);
		} else if (!canProviderRunServer(configuredProvider, server)) {
			console.warn(
				`Configured LSP runtime provider ${configuredRuntimeId} is not allowed for ${server.id}`,
			);
		} else {
			try {
				if (await configuredProvider.canHandle(server, runtimeContext)) {
					return configuredProvider;
				}
				console.warn(
					`Configured LSP runtime provider ${configuredRuntimeId} cannot handle ${server.id}`,
				);
			} catch (error) {
				console.warn(
					`Configured LSP runtime provider ${configuredRuntimeId} failed canHandle() for ${server.id}`,
					error,
				);
			}
		}
	}

	for (const provider of listRuntimeProviders()) {
		if (!canProviderRunServer(provider, server)) continue;
		try {
			if (await provider.canHandle(server, runtimeContext)) {
				return provider;
			}
		} catch (error) {
			console.warn(
				`LSP runtime provider ${provider.id} failed canHandle() for ${server.id}`,
				error,
			);
		}
	}
	return null;
}

export function inferWorkspaceKind(
	context: Pick<LspRuntimeContext, "uri" | "rootUri" | "file">,
): WorkspaceKind {
	const uri = String(context.rootUri || context.file?.uri || context.uri || "");
	if (!uri) return "unknown";

	const schemeMatch = /^([a-zA-Z][\w+\-.]*?):/.exec(uri);
	const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;

	if (!scheme) return uri.startsWith("/") ? "app-private" : "unknown";
	if (scheme === "file") return "app-private";
	if (scheme === "untitled") return "virtual";
	if (
		scheme === "ftp" ||
		scheme === "sftp" ||
		scheme === "http" ||
		scheme === "https"
	) {
		return "remote";
	}
	if (scheme !== "content") return "unknown";

	if (/^content:\/\/com\.foxdebug\.acode(?:free)?\.documents\//i.test(uri)) {
		return "builtin-alpine";
	}
	if (/termux/i.test(uri)) return "termux-saf";
	return "saf";
}

export function isBuiltinAlpineAccessible(
	context: Pick<LspRuntimeContext, "uri" | "rootUri" | "file">,
): boolean {
	const uri = String(context.rootUri || context.file?.uri || context.uri || "");
	if (!uri) return false;

	const schemeMatch = /^([a-zA-Z][\w+\-.]*?):/.exec(uri);
	const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;

	if (!scheme) return uri.startsWith("/");
	if (scheme === "file" || scheme === "untitled") return true;
	if (scheme !== "content") return false;

	return /^content:\/\/com\.foxdebug\.acode(?:free)?\.documents\//i.test(uri);
}

export default {
	BUILTIN_ALPINE_RUNTIME_ID,
	getRuntimeProvider,
	inferWorkspaceKind,
	isBuiltinAlpineAccessible,
	listRuntimeProviders,
	registerRuntimeProvider,
	selectRuntimeProvider,
	unregisterRuntimeProvider,
};
