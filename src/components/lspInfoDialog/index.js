import "./styles.scss";
import lspClientManager from "cm/lsp/clientManager";
import {
	getCurrentFileLanguage,
	getServersForCurrentFile,
	hasConnectedServers,
} from "cm/lsp/connectionState";
import { addLspLog, clearLspLogs, getLspLogs } from "cm/lsp/logs";
import { getServerStats } from "cm/lsp/serverLauncher";
import toast from "components/toast";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

let dialogInstance = null;

function getActiveClients() {
	try {
		return lspClientManager.getActiveClients();
	} catch {
		return [];
	}
}

function getServerStatus(serverId) {
	const activeClients = getActiveClients();
	const client = activeClients.find((c) => c.server?.id === serverId);
	if (!client) return "stopped";
	try {
		return client.client?.connected !== false ? "active" : "connecting";
	} catch {
		return "stopped";
	}
}

function getClientState(serverId) {
	const activeClients = getActiveClients();
	return activeClients.find((c) => c.server?.id === serverId) || null;
}

function getStatusColor(status) {
	switch (status) {
		case "active":
			return "var(--lsp-status-active, #22c55e)";
		case "connecting":
			return "var(--lsp-status-connecting, #f59e0b)";
		default:
			return "var(--lsp-status-stopped, #6b7280)";
	}
}

function copyLogsToClipboard(serverId, serverLabel) {
	const logs = getLspLogs(serverId);
	if (logs.length === 0) {
		toast(strings["lsp:no-logs-to-copy"]);
		return;
	}

	const text = logs
		.map((log) => {
			const time = log.timestamp.toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
			return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
		})
		.join("\n");

	const header = `=== ${serverLabel} LSP Logs ===\n`;

	if (navigator.clipboard?.writeText) {
		navigator.clipboard.writeText(header + text).catch(() => {
			toast(strings["lsp:failed-to-copy"]);
		});
	} else if (cordova?.plugins?.clipboard) {
		cordova.plugins.clipboard.copy(header + text);
	} else {
		toast(strings["lsp:clipboard-not-available"]);
	}
}

async function restartServer(serverId) {
	addLspLog(serverId, "info", "Restart requested by user");
	toast(strings["lsp:restarting-server"]);

	try {
		const clientState = getClientState(serverId);
		if (clientState) {
			await clientState.dispose();
		}

		const { stopManagedServer } = await import("cm/lsp/serverLauncher");
		stopManagedServer(serverId);

		window.editorManager?.restartLsp?.();

		addLspLog(serverId, "info", "Server restarted successfully");
		toast(strings["lsp:server-restarted"]);
	} catch (err) {
		addLspLog(serverId, "error", `Restart failed: ${err.message}`);
		toast(strings["lsp:restart failed"]);
	}
}

async function stopServer(serverId) {
	addLspLog(serverId, "info", "Stop requested by user");
	toast(strings["lsp:stopping"]);

	try {
		const clientState = getClientState(serverId);
		if (clientState) {
			await clientState.dispose();
		}

		const { stopManagedServer } = await import("cm/lsp/serverLauncher");
		stopManagedServer(serverId);

		addLspLog(serverId, "info", "Server stopped");
		toast(strings["lsp:server stopped"]);
	} catch (err) {
		addLspLog(serverId, "error", `Stop failed: ${err.message}`);
		toast(strings["lsp:failed to stop"]);
	}
}

async function startAllServers() {
	toast(strings["lsp:starting lsp servers"]);
	try {
		window.editorManager?.restartLsp?.();
		toast(strings["lsp:servers started"]);
	} catch (err) {
		toast(strings["lsp:failed to start servers"]);
	}
}

async function restartAllServers() {
	const activeClients = getActiveClients();
	if (!activeClients.length) {
		await startAllServers();
		return;
	}

	const count = activeClients.length;
	toast(`Restarting ${count} LSP server${count > 1 ? "s" : ""}...`);

	try {
		await lspClientManager.dispose();
		window.editorManager?.restartLsp?.();
		toast("All servers restarted");
	} catch (err) {
		toast("Failed to restart servers");
	}
}

async function stopAllServers() {
	const activeClients = getActiveClients();
	if (!activeClients.length) {
		toast("No LSP servers are currently running");
		return;
	}

	const count = activeClients.length;

	try {
		await lspClientManager.dispose();
		toast(`Stopped ${count} LSP server${count > 1 ? "s" : ""}`);
	} catch (err) {
		toast("Failed to stop servers");
	}
}

function showLspInfoDialog() {
	if (dialogInstance) {
		dialogInstance.hide();
		return;
	}

	const relevantServers = getServersForCurrentFile();
	const currentLanguage = getCurrentFileLanguage();

	let currentView = "list";
	let selectedServer = null;

	const $mask = <span className="mask" onclick={hide} />;
	const $dialog = (
		<div className="prompt lsp-info-dialog">
			<div className="title">
				<span className="icon zap" style={{ marginRight: "8px" }} />
				Language Servers
			</div>
			<div className="lsp-dialog-body" />
		</div>
	);

	const $body = $dialog.querySelector(".lsp-dialog-body");

	function renderList() {
		$body.innerHTML = "";

		if (relevantServers.length === 0) {
			$body.appendChild(
				<div className="lsp-empty-state">
					<span className="icon code" />
					<p>
						No language servers for{" "}
						<strong>{currentLanguage || "this file"}</strong>
					</p>
				</div>,
			);
			return;
		}

		const $list = <ul className="lsp-server-list" />;

		const runningServers = relevantServers.filter(
			(s) => getServerStatus(s.id) !== "stopped",
		);
		const hasRunning = runningServers.length > 0;

		const $actions = (
			<div className="lsp-list-actions">
				<button
					type="button"
					className="lsp-action-btn"
					onclick={async () => {
						await restartAllServers();
						await new Promise((r) => setTimeout(r, 500));
						renderList();
					}}
				>
					<span className="icon autorenew" />
					<span>{hasRunning ? "Restart All" : "Start All"}</span>
				</button>
				{hasRunning && (
					<button
						type="button"
						className="lsp-action-btn danger"
						onclick={async () => {
							await stopAllServers();
							renderList();
						}}
					>
						<span className="icon power_settings_new" />
						<span>Stop All</span>
					</button>
				)}
			</div>
		);
		$body.appendChild($actions);

		for (const server of relevantServers) {
			const status = getServerStatus(server.id);
			const statusColor = getStatusColor(status);
			const logs = getLspLogs(server.id);
			const errorCount = logs.filter((l) => l.level === "error").length;

			const $item = (
				<li
					className="lsp-server-item"
					onclick={() => {
						selectedServer = server;
						currentView = "details";
						renderDetails();
					}}
				>
					<span
						className="lsp-status-dot"
						style={{ backgroundColor: statusColor }}
					/>
					<div className="lsp-server-info">
						<span className="lsp-server-name">{server.label}</span>
						<span className="lsp-server-status">{status}</span>
					</div>
					{errorCount > 0 && (
						<span className="lsp-error-badge">{errorCount}</span>
					)}
					<span className="icon keyboard_arrow_right lsp-arrow" />
				</li>
			);
			$list.appendChild($item);
		}

		$body.appendChild($list);
	}

	function renderDetails() {
		if (!selectedServer) return;
		$body.innerHTML = "";

		const server = selectedServer;
		const status = getServerStatus(server.id);
		const clientState = getClientState(server.id);
		const isRunning = status !== "stopped";

		const capabilities = [];
		const hasCapabilities = clientState?.client?.serverCapabilities;
		if (hasCapabilities) {
			const caps = clientState.client.serverCapabilities;
			if (caps.completionProvider) capabilities.push("Completion");
			if (caps.hoverProvider) capabilities.push("Hover");
			if (caps.definitionProvider) capabilities.push("Go to Definition");
			if (caps.referencesProvider) capabilities.push("Find References");
			if (caps.renameProvider) capabilities.push("Rename");
			if (caps.documentFormattingProvider) capabilities.push("Format");
			if (caps.signatureHelpProvider) capabilities.push("Signature Help");
			if (caps.inlayHintProvider) capabilities.push("Inlay Hints");
			if (caps.codeActionProvider) capabilities.push("Code Actions");
			if (caps.diagnosticProvider) capabilities.push("Diagnostics");
		}
		if (isRunning && capabilities.length === 0 && hasCapabilities) {
			capabilities.push("Diagnostics");
		}

		const logs = getLspLogs(server.id);

		const $details = (
			<div className="lsp-details">
				<div className="lsp-details-header">
					<button
						type="button"
						className="lsp-icon-btn"
						onclick={() => {
							currentView = "list";
							selectedServer = null;
							renderList();
						}}
						aria-label="Back"
					>
						<span className="icon keyboard_arrow_left" />
					</button>
					<div className="lsp-details-title">
						<span
							className="lsp-status-dot"
							style={{ backgroundColor: getStatusColor(status) }}
						/>
						<span>{server.label}</span>
					</div>
					<div className="lsp-header-actions">
						<button
							type="button"
							className="lsp-icon-btn"
							onclick={async () => {
								await restartServer(server.id);
								await new Promise((r) => setTimeout(r, 500));
								renderDetails();
							}}
							aria-label="Restart Server"
							title="Restart Server"
						>
							<span className="icon autorenew" />
						</button>
						{isRunning && (
							<button
								type="button"
								className="lsp-icon-btn danger"
								onclick={async () => {
									await stopServer(server.id);
									renderDetails();
								}}
								aria-label="Stop Server"
								title="Stop Server"
							>
								<span className="icon power_settings_new" />
							</button>
						)}
					</div>
				</div>

				{isRunning && (
					<div className="lsp-section">
						<div className="lsp-section-label">Capabilities</div>
						<div className="lsp-chip-container">
							{capabilities.length > 0
								? capabilities.map((cap) => (
										<span className="lsp-chip">{cap}</span>
									))
								: !hasCapabilities && (
										<span className="lsp-chip">Initializing...</span>
									)}
						</div>
					</div>
				)}

				<div className="lsp-section">
					<div className="lsp-section-label">Supported</div>
					<div className="lsp-chip-container">
						{server.languages.map((lang) => (
							<span className="lsp-chip ext">.{lang}</span>
						))}
					</div>
				</div>

				{isRunning && (
					<div className="lsp-section">
						<div className="lsp-section-label">Project</div>
						<div className="lsp-project-path">
							{clientState?.rootUri || "(workspace folders mode)"}
						</div>
					</div>
				)}

				{isRunning && (
					<div className="lsp-section">
						<div className="lsp-section-label">Resources</div>
						<div className="lsp-stats-container">
							<div className="lsp-stat">
								<span className="lsp-stat-label">Memory</span>
								<span className="lsp-stat-value" id={`lsp-mem-${server.id}`}>
									—
								</span>
							</div>
							<div className="lsp-stat">
								<span className="lsp-stat-label">Uptime</span>
								<span className="lsp-stat-value" id={`lsp-uptime-${server.id}`}>
									—
								</span>
							</div>
							<div className="lsp-stat">
								<span className="lsp-stat-label">PID</span>
								<span className="lsp-stat-value" id={`lsp-pid-${server.id}`}>
									—
								</span>
							</div>
						</div>
					</div>
				)}
			</div>
		);

		$body.appendChild($details);

		// Create simple collapsible logs section
		const $logsSection = (
			<div className="lsp-logs-section collapsed">
				<div
					className="lsp-logs-header"
					onclick={(e) => {
						const section = e.currentTarget.closest(".lsp-logs-section");
						if (section) {
							section.classList.toggle("collapsed");
							if (!section.classList.contains("collapsed")) {
								const container = section.querySelector(".lsp-logs-container");
								if (container) container.scrollTop = container.scrollHeight;
							}
						}
					}}
				>
					<div className="lsp-logs-title">
						<span className="icon expand_more lsp-expand-icon" />
						<span>LSP Logs</span>
						{logs.length > 0 && (
							<span className="lsp-log-count">({logs.length})</span>
						)}
					</div>
					<div className="lsp-logs-actions">
						<button
							type="button"
							className="lsp-icon-btn small"
							onclick={(e) => {
								e.stopPropagation();
								copyLogsToClipboard(server.id, server.label);
							}}
							aria-label="Copy Logs"
							title="Copy Logs"
						>
							<span className="icon copy" />
						</button>
						<button
							type="button"
							className="lsp-icon-btn small lsp-clear-btn"
							onclick={(e) => {
								e.stopPropagation();
								clearLspLogs(server.id);
								renderDetails();
							}}
							aria-label="Clear Logs"
							title="Clear Logs"
						>
							<span className="icon delete" />
						</button>
					</div>
				</div>
				<div className="lsp-logs-container">
					{logs.length === 0 ? (
						<div className="lsp-logs-empty">No logs yet</div>
					) : (
						logs.slice(-50).map((log) => {
							const time = log.timestamp.toLocaleTimeString("en-US", {
								hour12: false,
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							});
							return (
								<div className={`lsp-log ${log.level}`}>
									<span className="lsp-log-time">{time}</span>
									<span className="lsp-log-text">{log.message}</span>
								</div>
							);
						})
					)}
				</div>
			</div>
		);

		$body.appendChild($logsSection);

		// Fetch and update stats asynchronously
		if (isRunning) {
			getServerStats(server.id).then((stats) => {
				if (!stats) return;
				const $mem = document.getElementById(`lsp-mem-${server.id}`);
				const $uptime = document.getElementById(`lsp-uptime-${server.id}`);
				const $pid = document.getElementById(`lsp-pid-${server.id}`);
				if ($mem) $mem.textContent = stats.memoryFormatted;
				if ($uptime) $uptime.textContent = stats.uptimeFormatted;
				if ($pid) $pid.textContent = stats.pid ? String(stats.pid) : "—";
			});
		}
	}

	function hide() {
		$dialog.classList.add("hide");
		restoreTheme();
		actionStack.remove("lsp-info-dialog");
		setTimeout(() => {
			$dialog.remove();
			$mask.remove();
			dialogInstance = null;
		}, 200);
	}

	dialogInstance = { hide, element: $dialog };

	actionStack.push({
		id: "lsp-info-dialog",
		action: hide,
	});

	restoreTheme(true);
	document.body.appendChild($dialog);
	document.body.appendChild($mask);

	if (currentView === "list") {
		renderList();
	}
}

export { addLspLog, getLspLogs, hasConnectedServers, showLspInfoDialog };
export default showLspInfoDialog;
