import {
	bindServerRegistry,
	ensureBuiltinBundlesRegistered,
} from "./serverCatalog";
import type {
	AcodeClientConfig,
	BridgeConfig,
	LanguageResolverContext,
	LauncherConfig,
	LspServerDefinition,
	LspServerManifest,
	RegistryEventListener,
	RegistryEventType,
	RootUriContext,
	TransportDescriptor,
	WebSocketTransportOptions,
} from "./types";

const registry = new Map<string, LspServerDefinition>();
const listeners = new Set<RegistryEventListener>();

function toKey(id: string | undefined | null): string {
	return String(id ?? "")
		.trim()
		.toLowerCase();
}

function clone<T>(value: T): T | undefined {
	if (!value || typeof value !== "object") return undefined;
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch (_) {
		return value;
	}
}

function sanitizeLanguages(languages: string[] = []): string[] {
	if (!Array.isArray(languages)) return [];
	return languages
		.map((lang) =>
			String(lang ?? "")
				.trim()
				.toLowerCase(),
		)
		.filter(Boolean);
}

function parsePort(value: unknown): number | null {
	const num = Number(value);
	if (!Number.isFinite(num)) return null;
	const int = Math.floor(num);
	if (int !== num || int <= 0 || int > 65535) return null;
	return int;
}

interface RawBridgeConfig {
	kind?: string;
	port?: unknown;
	command?: string;
	args?: unknown[];
	session?: string;
}

function sanitizeInstallKind(
	value: unknown,
):
	| "apk"
	| "npm"
	| "pip"
	| "cargo"
	| "github-release"
	| "manual"
	| "shell"
	| undefined {
	switch (value) {
		case "apk":
		case "npm":
		case "pip":
		case "cargo":
		case "github-release":
		case "manual":
		case "shell":
			return value;
		default:
			return undefined;
	}
}

function sanitizeBridge(
	serverId: string,
	bridge: RawBridgeConfig | undefined | null,
): BridgeConfig | undefined {
	if (!bridge || typeof bridge !== "object") return undefined;
	const kind = bridge.kind ?? "axs";
	if (kind !== "axs") {
		throw new Error(
			`LSP server ${serverId} declares unsupported bridge kind ${kind}`,
		);
	}
	// Port is now optional - if not provided, auto-port discovery will be used
	const port = bridge.port ? (parsePort(bridge.port) ?? undefined) : undefined;
	const command = bridge.command ? String(bridge.command) : null;
	if (!command) {
		throw new Error(`LSP server ${serverId} bridge must supply a command`);
	}
	const args = Array.isArray(bridge.args)
		? bridge.args.map((arg) => String(arg))
		: undefined;
	return {
		kind: "axs",
		port,
		command,
		args,
		session: bridge.session ? String(bridge.session) : undefined,
	};
}

interface RawTransportDescriptor {
	kind?: string;
	command?: string;
	args?: unknown[];
	options?: Record<string, unknown> | WebSocketTransportOptions;
	url?: string;
}

interface RawLauncherConfig {
	command?: string;
	args?: unknown[];
	startCommand?: string | string[];
	checkCommand?: string;
	versionCommand?: string;
	updateCommand?: string;
	install?: {
		kind?: string;
		command?: string;
		updateCommand?: string;
		uninstallCommand?: string;
		label?: string;
		source?: string;
		executable?: string;
		packages?: unknown[];
		pipCommand?: string;
		npmCommand?: string;
		pythonCommand?: string;
		global?: boolean;
		breakSystemPackages?: boolean;
		repo?: string;
		assetNames?: Record<string, unknown>;
		archiveType?: string;
		extractFile?: string;
		binaryPath?: string;
	};
	bridge?: RawBridgeConfig;
}

export type RawServerDefinition = LspServerManifest;

function sanitizeDefinition(
	definition: RawServerDefinition,
): LspServerDefinition {
	if (!definition || typeof definition !== "object") {
		throw new TypeError("LSP server definition must be an object");
	}

	const id = toKey(definition.id);
	if (!id) throw new Error("LSP server definition requires a non-empty id");

	const transport: RawTransportDescriptor = definition.transport ?? {};
	const kind = (transport.kind ?? "stdio") as
		| "stdio"
		| "websocket"
		| "external";

	if (!transport || typeof transport !== "object") {
		throw new Error(`LSP server ${id} is missing a transport descriptor`);
	}

	if (
		!("languages" in definition) ||
		!sanitizeLanguages(definition.languages).length
	) {
		throw new Error(`LSP server ${id} must declare supported languages`);
	}

	if (kind === "stdio" && !transport.command) {
		throw new Error(`LSP server ${id} (stdio) requires a command`);
	}

	// Websocket transport requires a URL unless a bridge is configured for auto-port discovery
	const hasBridge = definition.launcher?.bridge?.command;
	if (kind === "websocket" && !transport.url && !hasBridge) {
		throw new Error(
			`LSP server ${id} (websocket) requires a url or a launcher bridge`,
		);
	}

	const transportOptions: Record<string, unknown> =
		transport.options && typeof transport.options === "object"
			? { ...transport.options }
			: {};

	const sanitizedTransport: TransportDescriptor = {
		kind,
		command: transport.command,
		args: Array.isArray(transport.args)
			? transport.args.map((arg) => String(arg))
			: undefined,
		options: transportOptions,
		url: transport.url,
		protocols: undefined,
	};

	let launcher: LauncherConfig | undefined;
	if (definition.launcher && typeof definition.launcher === "object") {
		const rawLauncher = definition.launcher;
		const installExecutable =
			typeof rawLauncher.install?.executable === "string"
				? rawLauncher.install.executable.trim()
				: "";
		launcher = {
			command: rawLauncher.command,
			args: Array.isArray(rawLauncher.args)
				? rawLauncher.args.map((arg) => String(arg))
				: undefined,
			startCommand: Array.isArray(rawLauncher.startCommand)
				? rawLauncher.startCommand.map((arg) => String(arg))
				: rawLauncher.startCommand,
			checkCommand: rawLauncher.checkCommand,
			versionCommand: rawLauncher.versionCommand,
			updateCommand: rawLauncher.updateCommand,
			uninstallCommand: rawLauncher.uninstallCommand,
			install:
				rawLauncher.install && typeof rawLauncher.install === "object"
					? {
							kind: sanitizeInstallKind(rawLauncher.install.kind),
							command: rawLauncher.install.command ?? "",
							updateCommand: rawLauncher.install.updateCommand,
							uninstallCommand: rawLauncher.install.uninstallCommand,
							label: rawLauncher.install.label,
							source: rawLauncher.install.source,
							executable: installExecutable || undefined,
							packages: Array.isArray(rawLauncher.install.packages)
								? rawLauncher.install.packages.map((entry) => String(entry))
								: undefined,
							pipCommand: rawLauncher.install.pipCommand,
							npmCommand: rawLauncher.install.npmCommand,
							pythonCommand: rawLauncher.install.pythonCommand,
							global: rawLauncher.install.global,
							breakSystemPackages: rawLauncher.install.breakSystemPackages,
							repo: rawLauncher.install.repo,
							assetNames:
								rawLauncher.install.assetNames &&
								typeof rawLauncher.install.assetNames === "object"
									? Object.fromEntries(
											Object.entries(rawLauncher.install.assetNames).map(
												([key, value]) => [String(key), String(value)],
											),
										)
									: undefined,
							archiveType:
								rawLauncher.install.archiveType === "binary" ? "binary" : "zip",
							extractFile: rawLauncher.install.extractFile,
							binaryPath: rawLauncher.install.binaryPath,
						}
					: undefined,
			bridge: sanitizeBridge(id, rawLauncher.bridge),
		};

		const installKind = launcher.install?.kind;
		const isManagedInstall = installKind && installKind !== "shell";
		if (isManagedInstall) {
			const providedExecutable =
				launcher.install?.binaryPath || launcher.install?.executable;
			if (!providedExecutable) {
				throw new Error(
					`LSP server ${id} managed installers must declare install.binaryPath or install.executable`,
				);
			}
		}
	}

	const sanitized: LspServerDefinition = {
		id,
		label: definition.label ?? id,
		enabled: definition.enabled !== false,
		languages: sanitizeLanguages(definition.languages),
		transport: sanitizedTransport,
		initializationOptions: clone(definition.initializationOptions),
		clientConfig: clone(definition.clientConfig),
		startupTimeout:
			typeof definition.startupTimeout === "number"
				? definition.startupTimeout
				: undefined,
		capabilityOverrides: clone(definition.capabilityOverrides),
		rootUri:
			typeof definition.rootUri === "function" ? definition.rootUri : null,
		documentUri:
			typeof definition.documentUri === "function"
				? definition.documentUri
				: null,
		resolveLanguageId:
			typeof definition.resolveLanguageId === "function"
				? definition.resolveLanguageId
				: null,
		launcher,
		useWorkspaceFolders: definition.useWorkspaceFolders === true,
	};

	if (!Object.keys(transportOptions).length) {
		sanitized.transport.options = undefined;
	}

	return sanitized;
}

function notify(event: RegistryEventType, payload: LspServerDefinition): void {
	listeners.forEach((fn) => {
		try {
			fn(event, payload);
		} catch (error) {
			console.error("LSP server registry listener failed", error);
		}
	});
}

export interface RegisterServerOptions {
	replace?: boolean;
}

export function registerServer(
	definition: RawServerDefinition,
	options: RegisterServerOptions = {},
): LspServerDefinition {
	const { replace = false } = options;
	const normalized = sanitizeDefinition(definition);
	const exists = registry.has(normalized.id);
	if (exists && !replace) {
		const existing = registry.get(normalized.id);
		if (existing) return existing;
	}

	registry.set(normalized.id, normalized);
	notify("register", normalized);
	return normalized;
}

export function unregisterServer(id: string): boolean {
	const key = toKey(id);
	if (!key || !registry.has(key)) return false;
	const existing = registry.get(key);
	registry.delete(key);
	if (existing) {
		notify("unregister", existing);
	}
	return true;
}

export type ServerUpdater = (
	current: LspServerDefinition,
) => Partial<LspServerDefinition> | null;

export function updateServer(
	id: string,
	updater: ServerUpdater,
): LspServerDefinition | null {
	const key = toKey(id);
	if (!key || !registry.has(key)) return null;
	const current = registry.get(key);
	if (!current) return null;
	const next = updater({ ...current });
	if (!next) return current;
	const normalized = sanitizeDefinition({
		...current,
		...next,
		id: current.id,
	});
	registry.set(key, normalized);
	notify("update", normalized);
	return normalized;
}

export function getServer(id: string): LspServerDefinition | null {
	return registry.get(toKey(id)) ?? null;
}

export function listServers(): LspServerDefinition[] {
	return Array.from(registry.values());
}

export interface GetServersOptions {
	includeDisabled?: boolean;
}

export function getServersForLanguage(
	languageId: string,
	options: GetServersOptions = {},
): LspServerDefinition[] {
	const { includeDisabled = false } = options;
	const langKey = toKey(languageId);
	if (!langKey) return [];

	return listServers().filter((server) => {
		if (!includeDisabled && !server.enabled) return false;
		return server.languages.includes(langKey);
	});
}

export function onRegistryChange(listener: RegistryEventListener): () => void {
	if (typeof listener !== "function") return () => {};
	listeners.add(listener);
	return () => listeners.delete(listener);
}

bindServerRegistry({
	registerServer,
	unregisterServer,
});
ensureBuiltinBundlesRegistered();

export default {
	registerServer,
	unregisterServer,
	updateServer,
	getServer,
	getServersForLanguage,
	listServers,
	onRegistryChange,
};
