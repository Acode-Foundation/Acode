import settingsPage from "components/settingsPage";
import constants from "lib/constants";
import appSettings from "lib/settings";

export default function scrollSettings() {
	const values = appSettings.value;
	const title = strings["scroll settings"];

	const items = [
		{
			key: "scrollSpeed",
			text: strings["scroll speed"],
			value: values.scrollSpeed,
			valueText: getScrollSpeedString,
			select: [
				[constants.SCROLL_SPEED_FAST_X2, `${strings.fast} x2`],
				[constants.SCROLL_SPEED_FAST, strings.fast],
				[constants.SCROLL_SPEED_NORMAL, strings.normal],
				[constants.SCROLL_SPEED_SLOW, strings.slow],
			],
		},
		{
			key: "reverseScrolling",
			text: strings["reverse scrolling"],
			checkbox: values.reverseScrolling,
		},
		{
			key: "diagonalScrolling",
			text: strings["diagonal scrolling"],
			checkbox: values.diagonalScrolling,
		},
		{
			key: "scrollbarSize",
			text: strings["scrollbar size"],
			value: values.scrollbarSize,
			valueText: (size) => `${size}px`,
			select: [5, 10, 15, 20],
		},
	];

	return settingsPage(title, items, callback);

	function callback(key, value) {
		appSettings.update({
			[key]: value,
		});
	}
}

function getScrollSpeedString(speed) {
	switch (speed) {
		case constants.SCROLL_SPEED_FAST:
			return strings.fast;
		case constants.SCROLL_SPEED_SLOW:
			return strings.slow;
		case constants.SCROLL_SPEED_FAST_X2:
			return `${strings.fast} x2`;
		case constants.SCROLL_SPEED_NORMAL:
			return strings.normal;
		default:
			return strings.normal;
	}
}
