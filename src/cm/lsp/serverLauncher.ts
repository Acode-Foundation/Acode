import lspStatusBar from "components/lspStatusBar";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import { buildShellArchCase } from "./installerUtils";
import {
	formatCommand,
	quoteArg,
	runForegroundCommand,
	runQuickCommand,
} from "./installRuntime";
import { getServerBundle } from "./serverCatalog";
import type {
	BridgeConfig,
	InstallCheckResult,
	InstallStatus,
	LauncherConfig,
	LspServerDefinition,
	LspServerStats,
	LspServerStatsFormatted,
	ManagedServerEntry,
	PortInfo,
	WaitOptions,
} from "./types";

const managedServers = new Map<string, ManagedServerEntry>();
const checkedCommands = new Map<string, InstallStatus>();
const pendingInstallChecks = new Map<string, Promise<boolean>>();
const announcedServers = new Set<string>();

const STATUS_PRESENT: InstallStatus = "present";
const STATUS_DECLINED: InstallStatus = "declined";
const STATUS_FAILED: InstallStatus = "failed";

const AXS_BINARY = "$PREFIX/axs";

function getTerminalRequiredMessage(): string {
	return (
		strings?.terminal_required_message_for_lsp ??
		"Terminal not installed. Please install Terminal first to use LSP servers."
	);
}

interface LspError extends Error {
	code?: string;
}

function getExecutor(): Executor {
	const executor = (globalThis as unknown as { Executor?: Executor }).Executor;
	if (!executor) {
		throw new Error("Executor plugin is not available");
	}
	return executor;
}

/**
 * Get the background executor
 */
function getBackgroundExecutor(): Executor {
	const executor = getExecutor();
	return executor.BackgroundExecutor ?? executor;
}

function joinCommand(command: string, args: string[] = []): string {
	if (!Array.isArray(args) || !args.length) return quoteArg(command);
	return [quoteArg(command), ...args.map((arg) => quoteArg(arg))].join(" ");
}

export { formatCommand } from "./installRuntime";

// ============================================================================
// Auto-Port Discovery
// ============================================================================

// Cache for the filesDir path
let cachedFilesDir: string | null = null;

/**
 * Get the terminal home directory from system.getFilesDir().
 * This is where axs stores port files.
 */
async function getTerminalHomeDir(): Promise<string> {
	if (cachedFilesDir) {
		return `${cachedFilesDir}/alpine/home`;
	}

	const system = (
		globalThis as unknown as {
			system?: {
				getFilesDir: (
					success: (filesDir: string) => void,
					error: (error: string) => void,
				) => void;
			};
		}
	).system;

	if (!system?.getFilesDir) {
		throw new Error("System plugin is not available");
	}

	return new Promise((resolve, reject) => {
		system.getFilesDir(
			(filesDir: string) => {
				cachedFilesDir = filesDir;
				resolve(`${filesDir}/alpine/home`);
			},
			(error: string) => reject(new Error(error)),
		);
	});
}

/**
 * Get the port file path for a given server and session.
 * Port file format: ~/.axs/lsp_ports/{serverName}_{session}
 */
async function getPortFilePath(
	serverName: string,
	session: string,
): Promise<string> {
	const homeDir = await getTerminalHomeDir();
	// Use just the binary name (not full path), mirroring axs behavior
	const baseName = serverName.split("/").pop() || serverName;
	return `file://${homeDir}/.axs/lsp_ports/${baseName}_${session}`;
}

/**
 * Read the port from a port file using the filesystem API.
 * Returns null if the file doesn't exist or contains invalid data.
 */
async function readPortFromFile(filePath: string): Promise<number | null> {
	try {
		// Dynamic import to get fsOperation
		const { default: fsOperation } = await import("fileSystem");
		const fs = fsOperation(filePath);

		// Check if file exists first
		const exists = await fs.exists();
		if (!exists) {
			return null;
		}

		// Read the file content as text
		const content = (await fs.readFile("utf-8")) as string;
		const port = Number.parseInt(content.trim(), 10);

		if (!Number.isFinite(port) || port <= 0 || port > 65535) {
			return null;
		}

		return port;
	} catch {
		// File doesn't exist or couldn't be read
		return null;
	}
}

/**
 * Get the port for a running LSP server from the axs port file.
 * @param serverName - The LSP server binary name (e.g., "typescript-language-server")
 * @param session - Session ID for port file naming
 */
export async function getLspPort(
	serverName: string,
	session: string,
): Promise<PortInfo | null> {
	try {
		const filePath = await getPortFilePath(serverName, session);
		const port = await readPortFromFile(filePath);

		if (port === null) {
			return null;
		}

		return { port, filePath, session };
	} catch {
		return null;
	}
}

/**
 * Wait for the server ready signal (when axs prints "listening on").
 * The axs proxy writes the port file immediately after binding, then prints the message.
 * So once the signal is received, the port file should be available.
 */
async function waitForServerReady(
	serverId: string,
	timeout = 10000,
): Promise<boolean> {
	const deadline = Date.now() + timeout;
	const pollInterval = 50;

	while (Date.now() < deadline) {
		if (serverReadySignals.has(serverId)) {
			serverReadySignals.delete(serverId);
			return true;
		}
		await sleep(pollInterval);
	}

	return false;
}

/**
 * Wait for the port file to be available after server signals ready.
 * This is the most efficient approach: wait for ready signal, then read port.
 */
async function waitForPort(
	serverId: string,
	serverName: string,
	session: string,
	timeout = 10000,
): Promise<PortInfo | null> {
	// First, wait for the server to signal it's ready
	const ready = await waitForServerReady(serverId, timeout);

	if (!ready) {
		console.warn(
			`[LSP:${serverId}] Server did not signal ready within timeout`,
		);
	}

	// The port file should be available now (axs writes it before printing "listening on")
	// Read it directly
	const portInfo = await getLspPort(serverName, session);

	if (!portInfo && ready) {
		// Server signaled ready but port file not found - retry a few times
		for (let i = 0; i < 5; i++) {
			await sleep(100);
			const retryPortInfo = await getLspPort(serverName, session);
			if (retryPortInfo) {
				return retryPortInfo;
			}
		}
	}

	return portInfo;
}

/**
 * Quick check if a server is running and connectable.
 * Attempts a fast WebSocket connection test.
 */
async function checkServerAlive(url: string, timeout = 1000): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const ws = new WebSocket(url);
			const timer = setTimeout(() => {
				try {
					ws.close();
				} catch {}
				resolve(false);
			}, timeout);

			ws.onopen = () => {
				clearTimeout(timer);
				try {
					ws.close();
				} catch {}
				resolve(true);
			};

			ws.onerror = () => {
				clearTimeout(timer);
				resolve(false);
			};

			ws.onclose = () => {
				clearTimeout(timer);
				resolve(false);
			};
		} catch {
			resolve(false);
		}
	});
}

/**
 * Check if we can reuse an existing server by testing the port.
 * Returns the port number if the server is alive, null otherwise.
 */
export async function canReuseExistingServer(
	server: LspServerDefinition,
	session: string,
): Promise<number | null> {
	const bridge = server.launcher?.bridge;
	const serverName =
		resolveServerExecutable(server) ||
		bridge?.command ||
		server.launcher?.command ||
		server.id;

	const portInfo = await getLspPort(serverName, session);
	if (!portInfo) {
		return null;
	}

	const url = `ws://127.0.0.1:${portInfo.port}/`;
	const alive = await checkServerAlive(url, 1000);

	if (alive) {
		console.info(
			`[LSP:${server.id}] Reusing existing server on port ${portInfo.port}`,
		);
		return portInfo.port;
	}

	console.info(
		`[LSP:${server.id}] Found stale port file, will start new server`,
	);
	return null;
}

function buildAxsBridgeCommand(
	bridge: BridgeConfig | undefined,
	commandOverride?: string | null,
	session?: string,
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

	// Use session ID or bridge session or server command as fallback session
	const effectiveSession = session || bridge.session || binary;

	const parts = [AXS_BINARY, "lsp"];

	// Add --session flag for port file naming
	parts.push("--session", quoteArg(effectiveSession));

	// Only add --port if explicitly specified
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

function resolveStartCommand(
	server: LspServerDefinition,
	session?: string,
): string | null {
	const launcher = server.launcher;
	if (!launcher) return null;
	const executable = resolveServerExecutable(server);

	if (launcher.startCommand) {
		return formatCommand(launcher.startCommand);
	}
	if (launcher.command) {
		return joinCommand(executable || launcher.command, launcher.args);
	}
	if (launcher.bridge) {
		return buildAxsBridgeCommand(launcher.bridge, executable, session);
	}
	return null;
}

export function getStartCommand(server: LspServerDefinition): string | null {
	return resolveStartCommand(server);
}

function getInstallCacheKey(server: LspServerDefinition): string | null {
	const checkCommand =
		server.launcher?.checkCommand || buildDerivedCheckCommand(server);
	if (!checkCommand) return null;
	return `${server.id}:${checkCommand}`;
}

function normalizeInstallSpec(server: LspServerDefinition) {
	const install = server.launcher?.install;
	if (!install) return null;

	const packages = Array.isArray(install.packages)
		? install.packages
				.map((entry) => String(entry || "").trim())
				.filter(Boolean)
		: [];
	const kind =
		install.kind ||
		(install.binaryPath ? "manual" : null) ||
		(install.source === "apk" ? "apk" : null) ||
		(install.source === "npm" ? "npm" : null) ||
		(install.source === "pip" ? "pip" : null) ||
		(install.source === "cargo" ? "cargo" : null) ||
		(install.command ? "shell" : null) ||
		"shell";

	return {
		...install,
		kind,
		packages,
		command:
			typeof install.command === "string" && install.command.trim()
				? install.command.trim()
				: undefined,
		updateCommand:
			typeof install.updateCommand === "string" && install.updateCommand.trim()
				? install.updateCommand.trim()
				: undefined,
		source:
			install.source ||
			(kind === "shell" ? "custom" : kind === "manual" ? "manual" : kind),
		executable:
			typeof install.executable === "string" && install.executable.trim()
				? install.executable.trim()
				: undefined,
		binaryPath:
			typeof install.binaryPath === "string" && install.binaryPath.trim()
				? install.binaryPath.trim()
				: undefined,
		repo:
			typeof install.repo === "string" && install.repo.trim()
				? install.repo.trim()
				: undefined,
		assetNames:
			install.assetNames && typeof install.assetNames === "object"
				? Object.fromEntries(
						Object.entries(install.assetNames)
							.map(([key, value]) => [String(key), String(value || "").trim()])
							.filter(([, value]) => Boolean(value)),
					)
				: {},
		archiveType: install.archiveType === "binary" ? "binary" : "zip",
		extractFile:
			typeof install.extractFile === "string" && install.extractFile.trim()
				? install.extractFile.trim()
				: undefined,
		npmCommand:
			typeof install.npmCommand === "string" && install.npmCommand.trim()
				? install.npmCommand.trim()
				: "npm",
		pipCommand:
			typeof install.pipCommand === "string" && install.pipCommand.trim()
				? install.pipCommand.trim()
				: "pip",
		pythonCommand:
			typeof install.pythonCommand === "string" && install.pythonCommand.trim()
				? install.pythonCommand.trim()
				: "python3",
		global: install.global !== false,
		breakSystemPackages: install.breakSystemPackages !== false,
	};
}

function getInstallerExecutable(server: LspServerDefinition): string | null {
	const install = normalizeInstallSpec(server);
	if (!install) return null;
	return install.binaryPath || install.executable || null;
}

function getProviderExecutable(server: LspServerDefinition): string | null {
	const bundle = getServerBundle(server.id);
	if (!bundle?.getExecutable) return null;
	try {
		return bundle.getExecutable(server.id, server) || null;
	} catch (error) {
		console.warn(`Failed to resolve bundle executable for ${server.id}`, error);
		return null;
	}
}

function resolveServerExecutable(server: LspServerDefinition): string | null {
	return (
		getProviderExecutable(server) ||
		getInstallerExecutable(server) ||
		server.launcher?.bridge?.command ||
		server.launcher?.command ||
		null
	);
}

function getInstallLabel(server: LspServerDefinition): string {
	return (
		normalizeInstallSpec(server)?.label ||
		server.launcher?.install?.label ||
		server.label ||
		server.id
	).trim();
}

function buildUninstallCommand(server: LspServerDefinition): string | null {
	const spec = normalizeInstallSpec(server);
	if (!spec) return null;

	if (spec.uninstallCommand) {
		return spec.uninstallCommand;
	}
	if (server.launcher?.uninstallCommand) {
		return server.launcher.uninstallCommand;
	}

	switch (spec.kind) {
		case "apk":
			return spec.packages.length
				? `apk del ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`
				: null;
		case "npm": {
			if (!spec.packages.length) return null;
			const npmCommand = spec.npmCommand || "npm";
			const uninstallFlags =
				spec.global !== false ? "uninstall -g" : "uninstall";
			return `${npmCommand} ${uninstallFlags} ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`;
		}
		case "pip":
			return spec.packages.length
				? `${spec.pipCommand || "pip"} uninstall -y ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`
				: null;
		case "cargo":
			return spec.packages.length
				? spec.packages
						.map((entry) => `cargo uninstall ${quoteArg(entry)}`)
						.join(" && ")
				: null;
		case "github-release":
		case "manual":
			return spec.binaryPath ? `rm -f ${quoteArg(spec.binaryPath)}` : null;
		default:
			return null;
	}
}

function buildInstallCommand(
	server: LspServerDefinition,
	mode: "install" | "update" = "install",
): string | null {
	const spec = normalizeInstallSpec(server);
	if (!spec) return null;

	if (mode === "update" && spec.updateCommand) {
		return spec.updateCommand;
	}

	switch (spec.kind) {
		case "apk":
			return spec.packages.length
				? `apk add --no-cache ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`
				: null;
		case "npm": {
			if (!spec.packages.length) return null;
			const npmCommand = spec.npmCommand || "npm";
			const installFlags = spec.global !== false ? "install -g" : "install";
			return `apk add --no-cache nodejs npm && ${npmCommand} ${installFlags} ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`;
		}
		case "pip": {
			if (!spec.packages.length) return null;
			const pipCommand = spec.pipCommand || "pip";
			const breakPackages =
				spec.breakSystemPackages !== false
					? "PIP_BREAK_SYSTEM_PACKAGES=1 "
					: "";
			return `apk add --no-cache python3 py3-pip && ${breakPackages}${pipCommand} install ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`;
		}
		case "cargo":
			return spec.packages.length
				? `apk add --no-cache rust cargo && cargo install ${spec.packages.map((entry) => quoteArg(entry)).join(" ")}`
				: null;
		case "github-release": {
			if (!spec.repo || !spec.binaryPath) return null;
			const caseLines = buildShellArchCase(spec.assetNames, quoteArg);
			if (!caseLines) return null;
			const archivePath = '"$TMP_DIR/$ASSET"';
			const extractedFile = quoteArg(spec.extractFile || "luau-lsp");
			const installTarget = quoteArg(spec.binaryPath);
			const downloadUrl = `https://github.com/${spec.repo}/releases/latest/download/$ASSET`;

			if (spec.archiveType === "binary") {
				return `apk add --no-cache curl && ARCH="$(uname -m)" && case "$ARCH" in\n${caseLines}\n\t*) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;\nesac && TMP_DIR="$(mktemp -d)" && cleanup() { rm -rf "$TMP_DIR"; } && trap cleanup EXIT && curl -fsSL "${downloadUrl}" -o ${archivePath} && install -Dm755 ${archivePath} ${installTarget}`;
			}

			return `apk add --no-cache curl unzip && ARCH="$(uname -m)" && case "$ARCH" in\n${caseLines}\n\t*) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;\nesac && TMP_DIR="$(mktemp -d)" && cleanup() { rm -rf "$TMP_DIR"; } && trap cleanup EXIT && curl -fsSL "${downloadUrl}" -o ${archivePath} && unzip -oq ${archivePath} -d "$TMP_DIR" && install -Dm755 "$TMP_DIR"/${extractedFile} ${installTarget}`;
		}
		case "manual":
			return null;
		default:
			return spec.command || null;
	}
}

function buildDerivedCheckCommand(server: LspServerDefinition): string | null {
	const binary = resolveServerExecutable(server)?.trim() || "";
	const install = normalizeInstallSpec(server);

	if (install?.kind === "manual" && install.binaryPath) {
		return `test -x ${quoteArg(install.binaryPath)}`;
	}

	if (binary.includes("/")) {
		return `test -x ${quoteArg(binary)}`;
	}

	if (binary) {
		return `which ${quoteArg(binary)}`;
	}

	return null;
}

function getUpdateCommand(server: LspServerDefinition): string | null {
	const launcher = server.launcher;
	if (!launcher) return null;
	if (
		typeof launcher.updateCommand === "string" &&
		launcher.updateCommand.trim()
	) {
		return launcher.updateCommand.trim();
	}
	return buildInstallCommand(server, "update");
}

async function readServerVersion(
	server: LspServerDefinition,
): Promise<string | null> {
	const command = server.launcher?.versionCommand;
	if (!command) return null;

	try {
		const output = await runQuickCommand(command);
		const version = String(output || "")
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
		return version || null;
	} catch {
		return null;
	}
}

export function getInstallCommand(
	server: LspServerDefinition,
	mode: "install" | "update" = "install",
): string | null {
	if (mode === "update") {
		return getUpdateCommand(server);
	}
	return buildInstallCommand(server, "install");
}

export function getInstallSource(server: LspServerDefinition): string | null {
	return normalizeInstallSpec(server)?.source || null;
}

export function getUninstallCommand(
	server: LspServerDefinition,
): string | null {
	return buildUninstallCommand(server);
}

export async function checkServerInstallation(
	server: LspServerDefinition,
): Promise<InstallCheckResult> {
	const bundle = getServerBundle(server.id);
	if (bundle?.checkInstallation) {
		try {
			const result = await bundle.checkInstallation(server.id, server);
			if (result) return result;
		} catch (error) {
			return {
				status: "failed",
				version: null,
				canInstall: Boolean(getInstallCommand(server, "install")),
				canUpdate: Boolean(getInstallCommand(server, "update")),
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	const launcher = server.launcher;
	const installCommand = getInstallCommand(server, "install");
	const updateCommand = getInstallCommand(server, "update");
	const checkCommand =
		launcher?.checkCommand || buildDerivedCheckCommand(server);

	if (!checkCommand) {
		return {
			status: "unknown",
			version: await readServerVersion(server),
			canInstall: Boolean(installCommand),
			canUpdate: Boolean(updateCommand),
			message: "No install check configured for this server.",
		};
	}

	try {
		await runQuickCommand(checkCommand);
		return {
			status: "present",
			version: await readServerVersion(server),
			canInstall: Boolean(installCommand),
			canUpdate: Boolean(updateCommand),
		};
	} catch (error) {
		return {
			status: installCommand ? "missing" : "failed",
			version: null,
			canInstall: Boolean(installCommand),
			canUpdate: Boolean(updateCommand),
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export function resetInstallState(serverId?: string): void {
	if (!serverId) {
		checkedCommands.clear();
		return;
	}

	const prefix = `${serverId}:`;
	for (const key of Array.from(checkedCommands.keys())) {
		if (key.startsWith(prefix)) {
			checkedCommands.delete(key);
		}
	}
}

async function ensureInstalled(server: LspServerDefinition): Promise<boolean> {
	const launcher = server.launcher;
	const checkCommand =
		launcher?.checkCommand || buildDerivedCheckCommand(server);
	if (!checkCommand) return true;

	const cacheKey = getInstallCacheKey(server);
	if (!cacheKey) return true;

	// Return cached result if already checked
	if (checkedCommands.has(cacheKey)) {
		const status = checkedCommands.get(cacheKey);
		if (status === STATUS_PRESENT) {
			return true;
		}
		if (status === STATUS_DECLINED) {
			return false;
		}
		checkedCommands.delete(cacheKey);
	}

	// If there's already a pending check for this server, wait for it
	if (pendingInstallChecks.has(cacheKey)) {
		const pending = pendingInstallChecks.get(cacheKey);
		if (pending) return pending;
	}

	// Create and track the pending promise
	const checkPromise = performInstallCheck(server, launcher, cacheKey);
	pendingInstallChecks.set(cacheKey, checkPromise);

	try {
		return await checkPromise;
	} finally {
		pendingInstallChecks.delete(cacheKey);
	}
}

interface LoaderDialog {
	show: () => void;
	destroy: () => void;
}

type InstallActionMode = "install" | "update" | "reinstall";

export async function installServer(
	server: LspServerDefinition,
	mode: InstallActionMode = "install",
	options: { promptConfirm?: boolean } = {},
): Promise<boolean> {
	const bundle = getServerBundle(server.id);
	if (bundle?.installServer) {
		return bundle.installServer(server.id, server, mode, options);
	}

	const { promptConfirm = true } = options;
	const cacheKey = getInstallCacheKey(server);
	const displayLabel = getInstallLabel(server);
	const isUpdate = mode === "update";
	const actionLabel = isUpdate ? "Update" : "Install";
	const command =
		mode === "install"
			? getInstallCommand(server, "install")
			: getUpdateCommand(server);

	if (!command) {
		throw new Error(
			`${displayLabel} has no ${actionLabel.toLowerCase()} command.`,
		);
	}

	if (promptConfirm) {
		const shouldContinue = await confirm(
			displayLabel,
			`${actionLabel} ${displayLabel} language server?`,
		);
		if (!shouldContinue) {
			if (cacheKey) {
				checkedCommands.set(cacheKey, STATUS_DECLINED);
			}
			return false;
		}
	}

	let loadingDialog: LoaderDialog | null = null;
	try {
		loadingDialog = loader.create(
			displayLabel,
			`${actionLabel}ing ${displayLabel}...`,
		);
		loadingDialog.show();
		await runForegroundCommand(command);
		resetInstallState(server.id);

		const result = await checkServerInstallation(server);
		if (cacheKey && result.status === "present") {
			checkedCommands.set(cacheKey, STATUS_PRESENT);
		}

		toast(
			result.status === "present"
				? `${displayLabel} ${isUpdate ? "updated" : "installed"}`
				: `${displayLabel} ${actionLabel.toLowerCase()} finished`,
		);
		return true;
	} catch (error) {
		console.error(`Failed to ${actionLabel.toLowerCase()} ${server.id}`, error);
		if (cacheKey) {
			checkedCommands.set(cacheKey, STATUS_FAILED);
		}
		toast(strings?.error ?? "Error");
		throw error;
	} finally {
		loadingDialog?.destroy?.();
	}
}

export async function uninstallServer(
	server: LspServerDefinition,
	options: { promptConfirm?: boolean } = {},
): Promise<boolean> {
	const bundle = getServerBundle(server.id);
	if (bundle?.uninstallServer) {
		return bundle.uninstallServer(server.id, server, options);
	}

	const { promptConfirm = true } = options;
	const cacheKey = getInstallCacheKey(server);
	const displayLabel = getInstallLabel(server);
	const command = getUninstallCommand(server);

	if (!command) {
		throw new Error(`${displayLabel} has no uninstall command.`);
	}

	if (promptConfirm) {
		const shouldContinue = await confirm(
			displayLabel,
			`Uninstall ${displayLabel} language server?`,
		);
		if (!shouldContinue) {
			return false;
		}
	}

	let loadingDialog: LoaderDialog | null = null;
	try {
		loadingDialog = loader.create(
			displayLabel,
			`Uninstalling ${displayLabel}...`,
		);
		loadingDialog.show();
		await runForegroundCommand(command);
		if (cacheKey) {
			checkedCommands.delete(cacheKey);
		}
		resetInstallState(server.id);
		stopManagedServer(server.id);
		return true;
	} catch (error) {
		console.error(`Failed to uninstall ${server.id}`, error);
		toast(strings?.error ?? "Error");
		throw error;
	} finally {
		loadingDialog?.destroy();
	}
}

async function performInstallCheck(
	server: LspServerDefinition,
	launcher: LauncherConfig | undefined,
	cacheKey: string,
): Promise<boolean> {
	try {
		const checkCommand =
			launcher?.checkCommand || buildDerivedCheckCommand(server);
		if (checkCommand) {
			await runQuickCommand(checkCommand);
		}
		checkedCommands.set(cacheKey, STATUS_PRESENT);
		return true;
	} catch (error) {
		if (!getInstallCommand(server, "install")) {
			checkedCommands.set(cacheKey, STATUS_FAILED);
			console.warn(
				`LSP server ${server.id} is missing check command result and has no installer.`,
				error,
			);
			throw error;
		}

		const installed = await installServer(server, "install", {
			promptConfirm: true,
		});
		if (!installed) {
			checkedCommands.set(cacheKey, STATUS_DECLINED);
			return false;
		}
		checkedCommands.set(cacheKey, STATUS_PRESENT);
		return true;
	}
}

async function startInteractiveServer(
	command: string,
	serverId: string,
): Promise<string> {
	const executor = getExecutor();
	const callback: ExecutorCallback = (type, data) => {
		if (type === "stderr") {
			if (/proot warning/i.test(data)) return;
			console.warn(`[LSP:${serverId}] ${data}`);
		} else if (type === "stdout" && data && data.trim()) {
			console.info(`[LSP:${serverId}] ${data}`);
			// Detect when the axs proxy signals it's listening
			if (/listening on/i.test(data)) {
				signalServerReady(serverId);
			}
		}
	};
	const uuid = await executor.start(command, callback, true);
	managedServers.set(serverId, {
		uuid,
		command,
		startedAt: Date.now(),
	});
	return uuid;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tracks servers that have signaled they're ready (listening)
 * Key: serverId, Value: timestamp when ready
 */
const serverReadySignals = new Map<string, number>();

/**
 * Called when stdout contains a "listening" message from the axs proxy.
 * This signals that the server is ready to accept connections.
 */
export function signalServerReady(serverId: string): void {
	serverReadySignals.set(serverId, Date.now());
}

/**
 * Wait for the LSP server to be ready.
 *
 * This function polls for a ready signal (set when stdout contains "listening")
 */
async function waitForWebSocket(
	url: string,
	options: WaitOptions = {},
): Promise<void> {
	const {
		delay = 100, // Poll interval
		probeTimeout = 5000, // Max wait time
	} = options;

	// Extract server ID from URL (e.g., "ws://127.0.0.1:2090" -> check by port)
	const portMatch = url.match(/:(\d+)/);
	const port = portMatch ? portMatch[1] : null;

	// Find the server ID that's starting on this port
	let targetServerId: string | null = null;
	const entries = Array.from(managedServers.entries());
	for (const [serverId, entry] of entries) {
		if (
			entry.command.includes(`--port ${port}`) ||
			entry.command.includes(`:${port}`)
		) {
			targetServerId = serverId;
			break;
		}
	}

	const deadline = Date.now() + probeTimeout;

	while (Date.now() < deadline) {
		// Check if we got a ready signal
		if (targetServerId && serverReadySignals.has(targetServerId)) {
			// Server is ready, clear the signal and return
			serverReadySignals.delete(targetServerId);
			return;
		}

		await sleep(delay);
	}

	// Timeout reached, proceed anyway (transport will retry if needed)
	console.debug(
		`[LSP] waitForWebSocket timed out for ${url}, proceeding anyway`,
	);
}

export interface EnsureServerResult {
	uuid: string | null;
	/** Port discovered from port file (for auto-port discovery) */
	discoveredPort?: number;
}

export async function ensureServerRunning(
	server: LspServerDefinition,
	session?: string,
): Promise<EnsureServerResult> {
	const launcher = server.launcher;
	if (!launcher) return { uuid: null };

	// Derive session from server ID if not provided
	const effectiveSession = session || server.id;

	// Check if server is already running via port file (dead client detection)
	const bridge = launcher.bridge;
	const serverName =
		resolveServerExecutable(server) ||
		bridge?.command ||
		launcher.command ||
		server.id;

	try {
		const existingPort = await canReuseExistingServer(server, effectiveSession);
		if (existingPort !== null) {
			// Server is already running and responsive, no need to start
			return { uuid: null, discoveredPort: existingPort };
		}
	} catch {
		// Failed to check, proceed with normal startup
	}

	const terminal = (
		globalThis as unknown as {
			Terminal?: { isInstalled?: () => Promise<boolean> | boolean };
		}
	).Terminal;
	let isTerminalInstalled = false;
	try {
		isTerminalInstalled = Boolean(await terminal?.isInstalled?.());
	} catch {}
	if (!isTerminalInstalled) {
		const message = getTerminalRequiredMessage();
		alert(strings?.error, message);
		const unavailable: LspError = new Error(message);
		unavailable.code = "LSP_SERVER_UNAVAILABLE";
		throw unavailable;
	}

	const installed = await ensureInstalled(server);
	if (!installed) {
		const unavailable: LspError = new Error(
			`Language server ${server.id} is not available.`,
		);
		unavailable.code = "LSP_SERVER_UNAVAILABLE";
		throw unavailable;
	}

	const key = server.id;
	if (managedServers.has(key)) {
		const existing = managedServers.get(key);
		return { uuid: existing?.uuid ?? null };
	}

	const command = resolveStartCommand(server, effectiveSession);
	if (!command) {
		return { uuid: null };
	}

	try {
		const uuid = await startInteractiveServer(command, key);

		// For auto-port discovery, wait for server ready signal then read port
		let discoveredPort: number | undefined;
		if (bridge && !bridge.port) {
			// Auto-port mode - wait for server ready signal and then read port file
			const portInfo = await waitForPort(
				key,
				serverName,
				effectiveSession,
				10000,
			);
			if (portInfo) {
				discoveredPort = portInfo.port;
				console.info(
					`[LSP:${server.id}] Auto-discovered port ${discoveredPort}`,
				);
				// Update managed server entry with the port
				const entry = managedServers.get(key);
				if (entry) {
					entry.port = discoveredPort;
				}
			}
		} else if (
			server.transport?.url &&
			(server.transport.kind === "websocket" ||
				server.transport.kind === "stdio")
		) {
			// Fixed port mode - wait for the server to signal ready
			await waitForWebSocket(server.transport.url);
		}

		if (!announcedServers.has(key)) {
			console.info(`[LSP:${server.id}] ${server.label} connected`);
			announcedServers.add(key);
		}
		return { uuid, discoveredPort };
	} catch (error) {
		console.error(`Failed to start language server ${server.id}`, error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		lspStatusBar.show({
			message: errorMessage || "Connection failed",
			title: `${server.label} failed`,
			type: "error",
			icon: "error",
			duration: false,
		});
		const entry = managedServers.get(key);
		if (entry) {
			getExecutor()
				.stop(entry.uuid)
				.catch((err: Error) => {
					console.warn(
						`Failed to stop language server shell ${server.id}`,
						err,
					);
				});
			managedServers.delete(key);
		}
		const unavailable: LspError = new Error(
			`Language server ${server.id} failed to start (${errorMessage})`,
		);
		unavailable.code = "LSP_SERVER_UNAVAILABLE";
		throw unavailable;
	}
}

export function stopManagedServer(serverId: string): void {
	const entry = managedServers.get(serverId);
	if (!entry) return;
	const executor = getExecutor();
	executor.stop(entry.uuid).catch((error: Error) => {
		console.warn(`Failed to stop language server ${serverId}`, error);
	});
	managedServers.delete(serverId);
	announcedServers.delete(serverId);

	// Stop foreground service when all servers are stopped
	if (managedServers.size === 0) {
		executor.stopService().catch(() => {});
	}
}

export function resetManagedServers(): void {
	for (const id of Array.from(managedServers.keys())) {
		stopManagedServer(id);
	}
	managedServers.clear();
	// Ensure foreground service is stopped
	getExecutor()
		.stopService()
		.catch(() => {});
}

/**
 * Get managed server info by server ID
 */
export function getManagedServerInfo(
	serverId: string,
): ManagedServerEntry | null {
	return managedServers.get(serverId) ?? null;
}

/**
 * Get all managed servers
 */
export function getAllManagedServers(): Map<string, ManagedServerEntry> {
	return new Map(managedServers);
}

function formatMemory(bytes: number): string {
	if (!bytes || bytes <= 0) return "—";
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${mb.toFixed(1)} MB`;
	const kb = bytes / 1024;
	return `${kb.toFixed(0)} KB`;
}

function formatUptime(seconds: number): string {
	if (!seconds || seconds <= 0) return "—";
	if (seconds < 60) return `${seconds}s`;
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	if (mins < 60) return `${mins}m ${secs}s`;
	const hours = Math.floor(mins / 60);
	const remainingMins = mins % 60;
	return `${hours}h ${remainingMins}m`;
}

/**
 * Fetch server stats from the axs proxy /status endpoint
 * @param serverId - The server ID to fetch stats for
 * @param timeout - Timeout in milliseconds (default: 2000)
 */
export async function getServerStats(
	serverId: string,
	timeout = 2000,
): Promise<LspServerStatsFormatted | null> {
	const entry = managedServers.get(serverId);
	if (!entry?.port) {
		return null;
	}

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const response = await fetch(`http://127.0.0.1:${entry.port}/status`, {
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as LspServerStats;

		// Aggregate stats from all processes
		let totalMemory = 0;
		let maxUptime = 0;
		let firstPid: number | null = null;

		for (const proc of data.processes || []) {
			totalMemory += proc.memory_bytes || 0;
			if (proc.uptime_secs > maxUptime) {
				maxUptime = proc.uptime_secs;
			}
			if (firstPid === null && proc.pid) {
				firstPid = proc.pid;
			}
		}

		return {
			memoryBytes: totalMemory,
			memoryFormatted: formatMemory(totalMemory),
			uptimeSeconds: maxUptime,
			uptimeFormatted: formatUptime(maxUptime),
			pid: firstPid,
			processCount: data.processes?.length ?? 0,
		};
	} catch {
		return null;
	}
}
