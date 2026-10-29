import createTailSpinSvg from "components/tailSpin.js";
import DOMPurify from "dompurify";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

let loaderIsImmortal = false;
let onCancelCallback = null;
let cancelButtonTimeout = null;
let destroyTimeout = null;
let $currentDialog = null;
let $currentMask = null;
const titleLoaderId = "__title-loader";

/**
 * @typedef {object} LoaderOptions
 * @property {number} timeout Delay before the cancel button is shown, in milliseconds
 * @property {function():void} oncancel Callback invoked only when the user cancels
 */

/**
 * @typedef {object} Loader
 * @property {function(title:string):void} setTitle Sets the title of the loader
 * @property {function(message:string):void} setMessage Sets the message of the loader
 * @property {function():void} hide Hides the loader
 * @property {function():void} destroy Removes the loader from DOM permanently
 * @property {function():void} show Shows previously hidden loader
 */

/**
 * Creates new loading dialog
 * @param {string} titleText Title text
 * @param {string} [message] Loading message
 * @param {LoaderOptions} [options] Loader options
 * @returns {Loader}
 */
function create(titleText, message = "", options = {}) {
	if (!message && titleText) {
		message = titleText;
		titleText = "";
	}

	clearTimeout(destroyTimeout);
	destroyTimeout = null;
	const replacingActiveLoader =
		$currentDialog && !$currentDialog.classList.contains("hide");
	$currentDialog?.remove();
	$currentMask?.remove();

	const $message = Ref();
	const $titleSpan = Ref();

	const $mask = <span className="mask" id="__loader-mask"></span>;
	const $dialog = (
		<div className="prompt alert" id="__loader">
			<strong ref={$titleSpan} className="title">
				{titleText}
			</strong>
			<span className="message loader">
				<span className="loader" innerHTML={createTailSpinSvg()}></span>
				<div
					ref={$message}
					className="message"
					innerHTML={DOMPurify.sanitize(message)}
					style={{ whiteSpace: "pre-wrap" }}
				></div>
			</span>
		</div>
	);

	clearTimeout(cancelButtonTimeout);
	cancelButtonTimeout = null;
	onCancelCallback =
		typeof options.oncancel === "function" ? options.oncancel : null;

	if (typeof options.timeout === "number") {
		cancelButtonTimeout = setTimeout(() => {
			cancelButtonTimeout = null;
			if (!$dialog.isConnected) return;
			$dialog.append(
				<div className="button-container">
					<button onclick={cancel}>{strings.cancel}</button>
				</div>,
			);
		}, options.timeout);
	}

	$currentDialog = $dialog;
	$currentMask = $mask;
	actionStack.freeze();
	document.body.append($dialog, $mask);
	if (!replacingActiveLoader) restoreTheme(true);

	return {
		setTitle(title) {
			$titleSpan.textContent = title;
		},
		setMessage(message) {
			$message.innerHTML = DOMPurify.sanitize(message);
		},
		hide,
		show,
		destroy,
	};
}

function cancel() {
	const callback = onCancelCallback;
	onCancelCallback = null;
	destroy();
	callback?.();
}

function createTitleLoader() {
	const $titleLoader = tag.get(`#${titleLoaderId}`) || (
		<span id={titleLoaderId} innerHTML={createTailSpinSvg()}></span>
	);

	if (!$titleLoader.isConnected) {
		app.append($titleLoader);
	}

	return $titleLoader;
}

/**
 * Removes the loader from DOM permanently
 */
function destroy() {
	const loaderDiv = $currentDialog;
	const mask = $currentMask;
	clearTimeout(cancelButtonTimeout);
	cancelButtonTimeout = null;
	onCancelCallback = null;
	if (!loaderDiv || loaderDiv.classList.contains("hide")) return;
	restoreTheme();

	loaderDiv.classList.add("hide");
	destroyTimeout = setTimeout(() => {
		// A newer loader must retain its dialog and Back/Escape lock.
		if ($currentDialog !== loaderDiv) return;
		destroyTimeout = null;
		loaderDiv.remove();
		mask?.remove();
		$currentDialog = null;
		$currentMask = null;
		actionStack.unfreeze();
	}, 300);
}

/**
 * Hides the loading dialog box temporarily and can be restored using show method
 */
function hide() {
	$currentDialog?.remove();
	$currentMask?.remove();
}

/**
 * Shows previously hidden dialog box.
 */
function show() {
	if ($currentDialog && !$currentDialog.isConnected) {
		app.append($currentDialog);
	}
	if ($currentMask && !$currentMask.isConnected) {
		app.append($currentMask);
	}
}

/**
 * Shows title loader
 * @param {boolean} [immortal] If true, the loader will not be removed automatically
 */
function showTitleLoader(immortal = false) {
	if (typeof immortal === "boolean") {
		loaderIsImmortal = immortal;
	}

	setTimeout(() => {
		createTitleLoader();
		app.classList.remove("title-loading-hide");
		app.classList.add("title-loading");
	}, 0);
}

/**
 * Removes title loader
 * @param {boolean} immortal If not true, the loader will not remove when immortal was true when it was created.
 * @returns
 */
function removeTitleLoader(immortal = undefined) {
	if (typeof immortal === "boolean") {
		loaderIsImmortal = immortal;
	}

	if (loaderIsImmortal) return;
	setTimeout(() => {
		app.classList.add("title-loading-hide");
	}, 0);
}

export default {
	create,
	destroy,
	hide,
	show,
	showTitleLoader,
	removeTitleLoader,
};
