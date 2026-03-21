import type {
	BridgeConfig,
	InstallCheckResult,
	LauncherInstallConfig,
	LspServerBundle,
	LspServerManifest,
	TransportDescriptor,
} from "./types";

export interface ManagedServerOptions {
	id: string;
	label: string;
	languages: string[];
	enabled?: boolean;
	useWorkspaceFolders?: boolean;
	command?: string;
	args?: string[];
	transport?: Partial<TransportDescriptor>;
	bridge?: Partial<BridgeConfig> | null;
	installer?: LauncherInstallConfig;
	checkCommand?: string;
	versionCommand?: string;
	updateCommand?: string;
	uninstallCommand?: string;
	startupTimeout?: number;
	initializationOptions?: Record<string, unknown>;
	clientConfig?: LspServerManifest["clientConfig"];
	resolveLanguageId?: LspServerManifest["resolveLanguageId"];
	rootUri?: LspServerManifest["rootUri"];
	capabilityOverrides?: Record<string, unknown>;
}

export interface BundleHooks {
	getExecutable?: (
		serverId: string,
		manifest: LspServerManifest,
	) => string | null | undefined;
	checkInstallation?: (
		serverId: string,
		manifest: LspServerManifest,
	) => Promise<InstallCheckResult | null | undefined>;
	installServer?: (
		serverId: string,
		manifest: LspServerManifest,
		mode: "install" | "update" | "reinstall",
		options?: { promptConfirm?: boolean },
	) => Promise<boolean>;
}

export function defineBundle(options: {
	id: string;
	label?: string;
	servers: LspServerManifest[];
	hooks?: BundleHooks;
}): LspServerBundle {
	const { id, label, servers, hooks } = options;
	return {
		id,
		label,
		getServers: () => servers,
		...hooks,
	};
}

export function defineServer(options: ManagedServerOptions): LspServerManifest {
	const {
		id,
		label,
		languages,
		enabled = true,
		useWorkspaceFolders = false,
		command,
		args,
		transport,
		bridge,
		installer,
		checkCommand,
		versionCommand,
		updateCommand,
		uninstallCommand,
		startupTimeout,
		initializationOptions,
		clientConfig,
		resolveLanguageId,
		rootUri,
		capabilityOverrides,
	} = options;

	const bridgeCommand = command || bridge?.command;
	return {
		id,
		label,
		languages,
		enabled,
		useWorkspaceFolders,
		transport: {
			kind: "websocket",
			...(transport || {}),
		} as TransportDescriptor,
		launcher: {
			checkCommand,
			versionCommand,
			updateCommand,
			uninstallCommand,
			install: installer,
			bridge: bridgeCommand
				? {
						kind: "axs",
						command: bridgeCommand,
						args: args || bridge?.args,
						port: bridge?.port,
						session: bridge?.session,
					}
				: undefined,
		},
		startupTimeout,
		initializationOptions,
		clientConfig,
		resolveLanguageId,
		rootUri,
		capabilityOverrides,
	};
}

export const installers = {
	apk(options: {
		packages: string[];
		executable: string;
		label?: string;
		source?: string;
	}): LauncherInstallConfig {
		return {
			kind: "apk",
			source: options.source || "apk",
			label: options.label,
			executable: options.executable,
			packages: options.packages,
		};
	},
	npm(options: {
		packages: string[];
		executable: string;
		label?: string;
		source?: string;
		global?: boolean;
	}): LauncherInstallConfig {
		return {
			kind: "npm",
			source: options.source || "npm",
			label: options.label,
			executable: options.executable,
			packages: options.packages,
			global: options.global,
		};
	},
	pip(options: {
		packages: string[];
		executable: string;
		label?: string;
		source?: string;
		breakSystemPackages?: boolean;
	}): LauncherInstallConfig {
		return {
			kind: "pip",
			source: options.source || "pip",
			label: options.label,
			executable: options.executable,
			packages: options.packages,
			breakSystemPackages: options.breakSystemPackages,
		};
	},
	cargo(options: {
		packages: string[];
		executable: string;
		label?: string;
		source?: string;
	}): LauncherInstallConfig {
		return {
			kind: "cargo",
			source: options.source || "cargo",
			label: options.label,
			executable: options.executable,
			packages: options.packages,
		};
	},
	manual(options: {
		binaryPath: string;
		executable?: string;
		label?: string;
		source?: string;
	}): LauncherInstallConfig {
		return {
			kind: "manual",
			source: options.source || "manual",
			label: options.label,
			executable: options.executable || options.binaryPath,
			binaryPath: options.binaryPath,
		};
	},
	shell(options: {
		command: string;
		executable: string;
		updateCommand?: string;
		uninstallCommand?: string;
		label?: string;
		source?: string;
	}): LauncherInstallConfig {
		return {
			kind: "shell",
			source: options.source || "custom",
			label: options.label,
			executable: options.executable,
			command: options.command,
			updateCommand: options.updateCommand,
			uninstallCommand: options.uninstallCommand,
		};
	},
	githubRelease(options: {
		repo: string;
		binaryPath: string;
		executable?: string;
		assetNames: Record<string, string>;
		extractFile?: string;
		archiveType?: "zip" | "binary";
		label?: string;
		source?: string;
	}): LauncherInstallConfig {
		return {
			kind: "github-release",
			source: options.source || "github-release",
			label: options.label,
			executable: options.executable || options.binaryPath,
			repo: options.repo,
			assetNames: options.assetNames,
			extractFile: options.extractFile,
			archiveType: options.archiveType,
			binaryPath: options.binaryPath,
		};
	},
};
