import "dialogs/style.scss";
import "./appIconSetting.scss";
import loader from "dialogs/loader";
import actionStack from "lib/actionStack";
import selectAppIcon from "lib/appIconSelection";
import { APP_ICONS } from "lib/appIcons";
import restoreTheme from "lib/restoreTheme";
import appSettings from "lib/settings";

let activeDialog;
let nextDialogId = 0;

export default function appIconSetting() {
	if (activeDialog) return activeDialog;
	const actionId = `app-icon-${++nextDialogId}`;
	const previousFocus = document.activeElement;
	const controller = new AbortController();
	const current = appSettings.value.appIcon || "default";
	let loading = false;
	let resolve;
	const closed = new Promise((res) => {
		resolve = res;
	});
	const $list = (
		<div className="app-icon-list message scroll">
			{APP_ICONS.map((icon) => (
				<button
					className={`app-icon-item${icon.id === current ? " current" : ""}`}
					data-icon={icon.id}
					type="button"
					aria-label={icon.label}
					aria-pressed={String(icon.id === current)}
				>
					<span className="app-icon-preview">
						<img src={icon.image} alt="" />
					</span>
				</button>
			))}
		</div>
	);
	const $close = <button type="button">{strings.close}</button>;
	const $dialog = (
		<div
			className="prompt app-icon-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${actionId}-title`}
		>
			<strong className="title" id={`${actionId}-title`}>
				{strings["app icon"] || "App icon"}
			</strong>
			{$list}
			<div className="button-container">{$close}</div>
		</div>
	);
	const $mask = <span className="mask" />;
	const selectionOptions = {
		signal: controller.signal,
		onBusy(value) {
			$list.setAttribute("aria-busy", String(value));
			if (value && $list.contains(document.activeElement)) $close.focus();
			for (const button of $list.querySelectorAll("button")) {
				button.disabled = value;
			}
		},
		onLoading(value) {
			if (loading === value) return;
			loading = value;
			$dialog.inert = value;
			if (value) loader.create(strings["app icon"], strings["loading..."]);
			else loader.destroy();
		},
		onChange: close,
	};

	activeDialog = closed;
	$list.addEventListener("click", clickHandler);
	$close.addEventListener("click", close);
	$mask.addEventListener("click", close);
	$dialog.addEventListener("keydown", keyHandler);
	actionStack.push({ id: actionId, action: close });
	app.append($dialog, $mask);
	restoreTheme(true);
	($list.querySelector(".current") || $close).focus();
	return closed;

	function close() {
		if (controller.signal.aborted) return;
		controller.abort();
		if (loading) loader.destroy();
		actionStack.remove(actionId);
		$list.removeEventListener("click", clickHandler);
		$close.removeEventListener("click", close);
		$mask.removeEventListener("click", close);
		$dialog.removeEventListener("keydown", keyHandler);
		$dialog.classList.add("hide");
		$dialog.inert = true;
		restoreTheme();
		setTimeout(
			() => {
				$dialog.remove();
				$mask.remove();
				activeDialog = undefined;
				if (previousFocus?.isConnected) previousFocus.focus();
				resolve();
			},
			document.body.classList.contains("no-animation") ? 0 : 180,
		);
	}

	function clickHandler(e) {
		const $target = e.target.closest("[data-icon]");
		if ($target) selectAppIcon($target.dataset.icon, selectionOptions);
	}

	function keyHandler(e) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			actionStack.pop();
		} else if (e.key === "Tab") {
			// A confirmation may be open while focus still belongs to the picker.
			const prompts = document.querySelectorAll(".prompt:not(.hide)");
			if (prompts[prompts.length - 1] !== $dialog) return;
			const buttons = $dialog.querySelectorAll("button:not(:disabled)");
			const first = buttons[0];
			const last = buttons[buttons.length - 1];
			if (e.shiftKey && e.target === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && e.target === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}
}
