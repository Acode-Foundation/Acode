import helpers from "utils/helpers";

/**
 * Open custom tab
 */
export default function customTab(
	url: string,
	options?: {
		showTitle?: boolean;
		toolbarColor?: string;
		authTabId?: string;
		reportLifecycle?: boolean;
	},
) {
	if (!options) {
		options = {};
	}

	options.showTitle ??= true;

	return new Promise((resolve, reject) => {
		Bridge.exec(resolve, reject, "CustomTabs", "open", [url, options]);
	});
}
