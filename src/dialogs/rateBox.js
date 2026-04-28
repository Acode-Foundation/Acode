import config from "lib/config";
import template from "views/rating.hbs";
import box from "./box";

function rateBox() {
	const $box = box("Did you like the app?", template, strings.cancel).onclick(
		onInteract,
	);

	function onInteract(e) {
		/**
		 * @type {HTMLSpanElement}
		 */
		const $el = e.target;
		if (!$el) return;
		let val = $el.getAttribute("value");
		if (val) val = Number.parseInt(val);
		const siblings = $el.parentElement.children;
		const len = siblings.length;
		for (let i = 0; i < len; ++i) {
			const star = siblings[i];
			star.classList.remove("stargrade", "star_outline");
			if (i < val) star.classList.add("stargrade");
			else star.classList.add("star_outline");
		}

		setTimeout(() => {
			if (val === 5) {
				system.openInBrowser(
					`https://play.google.com/store/apps/details?id=${BuildInfo.packageName}`,
				);
				localStorage.dontAskForRating = true;
			} else {
				const stars = getStars(val);
				const subject = "feedback - Acode editor";
				const textBody = stars + "</br>%0A" + getFeedbackBody("</br>%0A");
				const email = config.FEEDBACK_EMAIL;
				system.openInBrowser(
					`mailto:${email}?subject=${subject}&body=${textBody}`,
				);
			}
		}, 100);

		$box.hide();
	}
}

/**
 * Gets body for feedback email
 * @param {String} eol
 * @returns
 */
function getFeedbackBody(eol) {
	const buildInfo = window.BuildInfo || {};
	const device = window.device || {};
	return (
		"Version: " +
		`${buildInfo.version} (${buildInfo.versionCode})` +
		eol +
		"Device: " +
		(device.model || "") +
		eol +
		"Manufacturer: " +
		(device.manufacturer || "") +
		eol +
		"Android version: " +
		device.version +
		eol +
		"Info: "
	);
}

/**
 *
 * @param {number} num
 */
function getStars(num) {
	let star = num;
	let noStar = 5 - num;
	let str = "";

	while (star--) str += "★";
	while (noStar--) str += "☆";

	return str;
}

export default rateBox;
