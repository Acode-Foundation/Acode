import "./style.scss";
import Page from "components/page";
import toast from "components/toast";
import confirm from "dialogs/confirm";
import actionStack from "lib/actionStack";

const text = (key, fallback) => strings[key] || fallback;

export default function RunningProcesses() {
	const $refresh = (
		<button
			className="icon refresh"
			aria-label={strings.refresh || "Refresh"}
		></button>
	);
	const $page = Page(text("running processes", "Running processes"), {
		tail: $refresh,
	});
	const $content = <div id="running-processes"></div>;
	let refreshTimer;
	let visible = true;

	$page.body = $content;
	$refresh.addEventListener("click", refresh);
	$content.addEventListener("click", handleClick);
	app.append($page);

	actionStack.push({ id: "running-processes", action: $page.hide });
	$page.onhide = () => {
		visible = false;
		clearTimeout(refreshTimer);
		actionStack.remove("running-processes");
	};

	refresh();

	async function refresh() {
		clearTimeout(refreshTimer);
		$refresh.disabled = true;

		try {
			const results = await Promise.all([
				Executor.listProcesses(),
				Executor.BackgroundExecutor.listProcesses(),
			]);
			render(results.flat().sort((a, b) => b.startedAt - a.startedAt));
		} catch (error) {
			console.error("Failed to list executor processes:", error);
			$content.replaceChildren(
				<div className="process-state error">
					{text("process list failed", "Could not load running processes.")}
				</div>,
			);
		} finally {
			$refresh.disabled = false;
			if (visible) refreshTimer = setTimeout(refresh, 3000);
		}
	}

	function render(processes) {
		if (!processes.length) {
			$content.replaceChildren(
				<div className="process-state">
					<span className="icon check_circle"></span>
					{text("no running processes", "No running processes")}
				</div>,
			);
			return;
		}

		$content.replaceChildren(
			...processes.map((process) => (
				<article className="process-card">
					<div className="process-card-main">
						<div className="process-command">{process.command}</div>
						<div className="process-meta">
							<span>
								{process.background
									? "Background executor"
									: "Terminal service"}
							</span>
							<span>{process.alpine ? "Alpine" : "Android"}</span>
							<span>{formatStartedAt(process.startedAt)}</span>
						</div>
						<code className="process-id">{process.id}</code>
					</div>
					<button
						className="process-kill icon power_settings_new"
						data-action="kill"
						data-id={process.id}
						data-background={String(process.background)}
						aria-label={text("kill process", "Kill process")}
					></button>
				</article>
			)),
		);
	}

	async function handleClick(event) {
		const $button = event.target.closest("[data-action='kill']");
		if (!$button) return;

		const shouldKill = await confirm(
			text("kill process", "Kill process"),
			text(
				"kill process confirmation",
				"Terminate this process? Unsaved process data will be lost.",
			),
		);
		if (!shouldKill) return;

		$button.disabled = true;
		const executor =
			$button.dataset.background === "true"
				? Executor.BackgroundExecutor
				: Executor;
		try {
			await executor.stop($button.dataset.id);
			await refresh();
		} catch (error) {
			console.error("Failed to terminate process:", error);
			toast(text("kill process failed", "Failed to terminate process"));
			$button.disabled = false;
		}
	}
}

function formatStartedAt(timestamp) {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
