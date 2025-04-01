import "./style.scss";

import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

/**
 * Confirm dialog box
 * @param {string} titleText Title text
 * @param {string} html HTML string
 * @param {string} [hideButtonText] Text for hide button
 * @param {string} [cancelButtonText] Text for cancel button
 * @returns {PromiseLike}
 */
function box(titleText, html, hideButtonText, cancelButtonText) {
	let waitFor = 0,
		strOK = hideButtonText || strings.ok,
		_onclick = () => {},
		_onhide = () => {},
		_then = () => {},
		_onOk = _hide,
		_onCancel = () => {};

	const promiseLike = {
		hide,
		wait,
		onclick,
		onhide,
		then,
		ok,
		cancel,
	};

	let cancelBtn;
	const hideButton =
		typeof hideButtonText === "boolean" ? hideButtonText : false;

	if (cancelButtonText) {
		cancelBtn = tag("button", {
			className: "disabled",
			textContent: cancelButtonText,
			onclick: () => {
				_onCancel();
			},
		});
	}

	const okBtn = tag("button", {
		className: "disabled",
		textContent: strOK,
		onclick: () => {
			_onOk();
		},
	});
	const body = tag("div", {
		className: "message",
		innerHTML: html,
		onclick: __onclick,
	});
	const box = tag("div", {
		className: "prompt box",
		children: [
			tag("strong", {
				className: "title",
				textContent: titleText,
			}),
			body,
		],
	});
	const mask = tag("span", {
		className: "mask",
		onclick: _hide,
	});

	if (!hideButton) {
		box.append(
			tag("div", {
				className: "button-container",
				children: cancelBtn ? [cancelBtn, okBtn] : [okBtn],
			}),
		);
	}

	setTimeout(() => {
		decTime();
		actionStack.push({
			id: "box",
			action: hideBox,
		});

		document.body.append(box, mask);
		__then();

		restoreTheme(true);
	}, 0);

	function decTime() {
		if (waitFor >= 1000) {
			okBtn.textContent = `${strOK} (${Number.parseInt(waitFor / 1000)}sec)`;
			waitFor -= 1000;
			setTimeout(decTime, 1000);
		} else {
			okBtn.textContent = strOK;
			okBtn.classList.remove("disabled");
			cancelBtn?.classList.remove("disabled");
		}
	}

	function hideBox() {
		box.classList.add("hide");
		restoreTheme();
		setTimeout(() => {
			document.body.removeChild(box);
			document.body.removeChild(mask);
		}, 300);
	}

	function hide() {
		if (waitFor) return;
		const imgs = box.getAll("img");
		if (imgs) {
			for (const img of imgs) {
				URL.revokeObjectURL(img.src);
			}
		}
		actionStack.remove("box");
		hideBox();
	}

	function _hide() {
		hide();
		if (_onhide) _onhide.call(promiseLike);
	}

	function wait(time) {
		time -= time % 1000;
		waitFor = time;
		return promiseLike;
	}

	function __onclick(e) {
		if (_onclick) _onclick.call(this, e);
	}

	function __then() {
		if (_then) _then(body.children);
	}

	/**
	 * Set callback function
	 * @param {function(HTMLCollection)} callback Callback function
	 * @returns {PromiseLike}
	 */
	function then(callback) {
		_then = callback;
		return promiseLike;
	}

	/**
	 * Set onclick callback function
	 * @param {function(this:HTMLElement, Event):void} onclick Callback function
	 * @returns {PromiseLike}
	 */
	function onclick(onclick) {
		_onclick = onclick;
		return promiseLike;
	}

	/**
	 * Set onhide callback function
	 * @param {function():void} onhide Callback function
	 * @returns {PromiseLike}
	 */
	function onhide(onhide) {
		_onhide = onhide;
		return promiseLike;
	}

	/**
	 * Set onOk callback function
	 * @param {function():void} onOk Callback function
	 * @returns {PromiseLike}
	 */
	function ok(onOk) {
		_onOk = onOk;
		return promiseLike;
	}

	/**
	 * Set onCancel callback function
	 * @param {function():void} onCancel Callback function
	 * @returns {PromiseLike}
	 */
	function cancel(onCancel) {
		_onCancel = onCancel;
		return promiseLike;
	}

	return promiseLike;
}

export default box;
