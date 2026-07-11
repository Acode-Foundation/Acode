import "./style.scss";
import Page from "components/page";
import searchBar from "components/searchbar";
import toast from "components/toast";
import confirm from "dialogs/confirm";
import actionStack from "lib/actionStack";

const text = (key, fallback) => strings[key] || fallback;

export default function RunningProcesses() {
	const $refresh = (
		<span
			className="icon refresh"
			onclick={refresh}
			attr-action="refresh"
			aria-label={strings.refresh || "Refresh"}
		></span>
	);

	const $search = (
		<span
			className="icon search"
			onclick={showSearch}
			attr-action="search"
		></span>
	);

	const $page = Page(text("running processes", "Running processes"));
	$page.header.append($search, $refresh);

	let isSearching = false;
	let searchQuery = "";
	let hideSearchBar = () => {};

	const expandedPids = new Set();
	let allProcesses = [];
	let refreshTimer;
	let visible = true;

	const $totalProcVal = <span className="metric-value">0</span>;
	const $totalMemVal = <span className="metric-value">0 KB</span>;

	const $listContainer = (
		<div id="running-processes-list" className="list scroll"></div>
	);

	const $content = (
		<div id="running-processes">
			<div className="metrics">
				<div className="metric-card">
					{$totalProcVal}
					<span className="metric-label">
						{text("active processes", "Active Processes")}
					</span>
				</div>
				<div className="metric-card">
					{$totalMemVal}
					<span className="metric-label">
						{text("total memory", "Memory Usage")}
					</span>
				</div>
			</div>
			{$listContainer}
		</div>
	);

	$page.body = $content;
	app.append($page);

	actionStack.push({ id: "running-processes", action: $page.hide });
	$page.onhide = () => {
		visible = false;
		clearTimeout(refreshTimer);
		actionStack.remove("running-processes");
	};

	refresh();

	function showSearch() {
		isSearching = true;
		searchBar(
			$listContainer,
			(hide) => {
				hideSearchBar = hide;
			},
			() => {
				isSearching = false;
				searchQuery = "";
				renderList();
			},
			(value) => {
				searchQuery = value;
				return renderSearch(value);
			},
			false,
		);
	}

	async function refresh() {
		if ($refresh.classList.contains("spinning")) return;
		clearTimeout(refreshTimer);
		if (typeof Executor === "undefined") {
			$listContainer.replaceChildren(
				<div className="process-state error">
					<span className="icon error"></span>
					{text("feature not available", "This feature is not available.")}
				</div>,
			);
			return;
		}
		$refresh.classList.add("spinning");

		try {
			allProcesses = await Executor.listAllProcesses();

			const [managedTerminal, managedBg] = await Promise.all([
				Executor.listProcesses(),
				Executor.BackgroundExecutor.listProcesses(),
			]);

			const managedMap = new Map();
			for (const p of managedTerminal) {
				if (p.pid)
					managedMap.set(p.pid, {
						type: "Terminal service",
						id: p.id,
						alpine: p.alpine,
						startedAt: p.startedAt,
						background: false,
					});
			}
			for (const p of managedBg) {
				if (p.pid)
					managedMap.set(p.pid, {
						type: "Background executor",
						id: p.id,
						alpine: p.alpine,
						startedAt: p.startedAt,
						background: true,
					});
			}

			for (const p of allProcesses) {
				const managed = managedMap.get(p.pid);
				if (managed) {
					p.managed = true;
					p.managedType = managed.type;
					p.managedId = managed.id;
					p.alpine = managed.alpine;
					if (managed.startedAt) p.startedAt = managed.startedAt;
				}
			}

			allProcesses.sort((a, b) => {
				if (a.isSelf) return -1;
				if (b.isSelf) return 1;
				if (a.managed && !b.managed) return -1;
				if (!a.managed && b.managed) return 1;
				return a.pid - b.pid;
			});

			$totalProcVal.textContent = allProcesses.length;
			const totalMemKb = allProcesses.reduce((acc, p) => acc + p.memory, 0);
			$totalMemVal.textContent = formatMemory(totalMemKb);

			if (isSearching) {
				const results = renderSearch(searchQuery);
				$listContainer.textContent = "";
				$listContainer.append(...results);
			} else {
				renderList();
			}
		} catch (error) {
			console.error("Failed to list executor processes:", error);
			$listContainer.replaceChildren(
				<div className="process-state error">
					<span className="icon error"></span>
					{text("process list failed", "Could not load running processes.")}
				</div>,
			);
		} finally {
			$refresh.classList.remove("spinning");
			if (visible) refreshTimer = setTimeout(refresh, 3000);
		}
	}

	function renderList() {
		if (isSearching) return;

		if (!allProcesses.length) {
			$listContainer.replaceChildren(
				<div className="process-state">
					<span className="icon check_circle"></span>
					{text("no running processes", "No running processes")}
				</div>,
			);
			return;
		}

		$listContainer.replaceChildren(
			...allProcesses.map((proc) => createProcessItem(proc)),
		);
	}

	function renderSearch(query) {
		const q = query.toLowerCase().trim();
		const filtered = allProcesses.filter((p) => {
			const name = extractProcessName(p.command, p.name);
			return (
				name.toLowerCase().includes(q) ||
				p.command.toLowerCase().includes(q) ||
				String(p.pid).includes(q)
			);
		});

		return filtered.map((proc) => createProcessItem(proc));
	}

	function createProcessItem(proc) {
		const isExpanded = expandedPids.has(proc.pid);
		const name = extractProcessName(proc.command, proc.name);
		const uptime = formatUptime(proc.startedAt);

		const classes = ["process-item"];
		if (proc.isSelf) classes.push("self");
		if (proc.managed) classes.push("managed");

		return (
			<div className={classes.join(" ")}>
				<div
					className="process-item-header"
					onclick={() => toggleExpand(proc.pid)}
				>
					<span className="process-name">{name}</span>
					<span className="process-pid">{proc.pid}</span>
					{proc.managed && (
						<span className="process-tag">{text("managed", "Managed")}</span>
					)}
					<span className="process-memory">{formatMemory(proc.memory)}</span>
					{!proc.isSelf && (
						<span
							className="process-kill icon power_settings_new"
							onclick={(e) => {
								e.stopPropagation();
								handleKill(proc);
							}}
						></span>
					)}
					<span
						className={`expand-icon icon ${isExpanded ? "keyboard_arrow_up" : "keyboard_arrow_down"}`}
					></span>
				</div>

				<div className={`process-item-details ${isExpanded ? "expanded" : ""}`}>
					<div className="detail-row">
						<span className="detail-label">{text("command", "Command")}</span>
						<code className="detail-value monospace selectable">
							{proc.command}
						</code>
					</div>
					<div className="detail-row">
						<span className="detail-label">
							{text("ppid parent", "PPID (Parent)")}
						</span>
						<code className="detail-value">{proc.ppid}</code>
					</div>
					<div className="detail-row">
						<span className="detail-label">{text("uptime", "Uptime")}</span>
						<span className="detail-value">{uptime}</span>
					</div>
					{proc.managed && (
						<div className="detail-row highlight">
							<span className="detail-label">
								{text("acode service", "Acode Service")}
							</span>
							<span className="detail-value">
								{proc.managedType} ({proc.alpine ? "Alpine" : "Android"})
							</span>
						</div>
					)}
					{proc.isSelf && (
						<div className="detail-row highlight-self">
							<span className="detail-label">{text("note", "Note")}</span>
							<span className="detail-value">
								{text("acode main process", "Acode main process")}
							</span>
						</div>
					)}
				</div>
			</div>
		);
	}

	function toggleExpand(pid) {
		if (expandedPids.has(pid)) {
			expandedPids.delete(pid);
		} else {
			expandedPids.add(pid);
		}
		if (isSearching) {
			$listContainer.replaceChildren(...renderSearch(searchQuery));
		} else {
			renderList();
		}
	}

	async function handleKill(proc) {
		const shouldKill = await confirm(
			text("kill process", "Kill process"),
			`${text("kill process confirmation", "Terminate this process?")} (PID: ${proc.pid} - ${displayName(proc)})\nUnsaved data will be lost.`,
		);
		if (!shouldKill) return;

		try {
			clearTimeout(refreshTimer);
			if (proc.managed) {
				const executor =
					proc.managedType === "Background executor"
						? Executor.BackgroundExecutor
						: Executor;
				await executor.stop(proc.managedId);
			} else {
				await Executor.killProcess(proc.pid);
			}
			toast(text("process terminated", "Process terminated"));
			await refresh();
		} catch (error) {
			console.error("Failed to terminate process:", error);
			toast(text("kill process failed", "Failed to terminate process"));
			if (visible) refreshTimer = setTimeout(refresh, 3000);
		}
	}

	function displayName(proc) {
		return extractProcessName(proc.command, proc.name);
	}
}

function extractProcessName(command, fallbackName) {
	if (!command) return fallbackName || "unknown";

	const args = command.trim().split(/\s+/);
	if (args.length === 0) return fallbackName || "unknown";

	const getBasename = (path) => {
		if (!path) return "";
		const parts = path.split("/");
		return parts[parts.length - 1];
	};

	const interpreters = new Set([
		"sh",
		"bash",
		"zsh",
		"dash",
		"ash",
		"node",
		"python",
		"python3",
		"perl",
		"ruby",
		"env",
		"linker64",
		"linker32",
		"linker",
		"libproot-xed.so",
		"proot",
		"axs",
		"system/bin/linker64",
	]);

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (
			arg === "-b" ||
			arg === "-r" ||
			arg === "-w" ||
			arg === "-L" ||
			arg === "-c" ||
			arg === "--bind"
		) {
			i += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			i++;
			continue;
		}

		const basename = getBasename(arg);
		if (!basename) {
			i++;
			continue;
		}

		if (interpreters.has(basename.toLowerCase())) {
			i++;
			continue;
		}

		if (
			basename.endsWith(".sh") &&
			i < args.length - 1 &&
			interpreters.has(getBasename(args[i + 1]).toLowerCase())
		) {
			i++;
			continue;
		}

		return basename;
	}

	const firstBasename = getBasename(args[0]);
	return firstBasename || fallbackName || "unknown";
}

function formatMemory(kb) {
	if (!kb) return "0 KB";
	if (kb < 1024) return `${kb} KB`;
	const mb = kb / 1024;
	return `${mb.toFixed(1)} MB`;
}

function formatUptime(startedAt) {
	if (!startedAt) return "Unknown";
	const now = Date.now();
	const diffMs = now - startedAt;
	if (diffMs < 0) return "Just started";

	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDays = Math.floor(diffHr / 24);

	if (diffDays > 0) {
		return `${diffDays}d ${diffHr % 24}h ago`;
	}
	if (diffHr > 0) {
		return `${diffHr}h ${diffMin % 60}m ago`;
	}
	if (diffMin > 0) {
		return `${diffMin}m ${diffSec % 60}s ago`;
	}
	return `${diffSec}s ago`;
}
