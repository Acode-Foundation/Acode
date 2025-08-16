import DOMPurify from "dompurify";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

let loaderIsImmortal = false;
let onCancelCallback = null;
let $currentDialog = null;
let $currentMask = null;

/**
 * @typedef {object} LoaderOptions
 * @property {number} timeout Timeout in milliseconds after which the loader will be shown
 * @property {function():void} oncancel Callback function to be called when the loader is shown
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

	const $oldLoader = tag.get("#__loader");
	const $oldMask = tag.get("#__loader-mask");

	if ($oldLoader) $oldLoader.remove();

	const $message = Ref();
	const $titleSpan = Ref();

	const $mask = $oldMask || <span className="mask" id="__loader-mask"></span>;
	const $dialog = $oldLoader || (
		<div className="prompt alert" id="__loader">
			<strong ref={$titleSpan} className="title">
				{titleText}
			</strong>
			<span className="message loader">
				<span className="loader"></span>
				<div
					ref={$message}
					className="message"
					innerHTML={DOMPurify.sanitize(message)}
					style={{ whiteSpace: "pre-wrap" }}
				></div>
			</span>
		</div>
	);

	const { timeout, oncancel } = options;
	if (typeof oncancel === "function") {
		onCancelCallback = oncancel;
	}

	if (typeof timeout === "number") {
		setTimeout(() => {
			$dialog.append(
				<div className="button-container">
					<button onclick={destroy}>{strings.cancel}</button>
				</div>,
			);
		}, timeout);
	}

	if (!$oldLoader) {
		actionStack.freeze();
		document.body.append($dialog, $mask);
		restoreTheme(true);
	}

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

/**
 * Removes the loader from DOM permanently
 */
function destroy() {
	const loaderDiv = tag.get("#__loader");
	const mask = tag.get("#__loader-mask");
	restoreTheme();

	if (!loaderDiv && !mask) {
		actionStack.unfreeze();
		return;
	}

	loaderDiv?.classList.add("hide");
	setTimeout(() => {
		actionStack.unfreeze();
		if (loaderDiv?.isConnected) loaderDiv.remove();
		if (mask?.isConnected) mask.remove();
		onCancelCallback?.();
	}, 300);
}

/**
 * Hides the loading dialog box temporarily and can be restored using show method
 */
function hide() {
	const loaderDiv = tag.get("#__loader");
	const mask = tag.get("#__loader-mask");

	if (loaderDiv) {
		$currentDialog = loaderDiv;
		loaderDiv.remove();
	}
	if (mask) {
		$currentMask = mask;
		mask.remove();
	}
}

/**
 * Shows previously hidden dialog box.
 */
function show() {
	if ($currentDialog) {
		app.append($currentDialog);
		$currentDialog = null;
	}
	if ($currentMask) {
		app.append($currentMask);
		$currentMask = null;
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
