import settings from "lib/settings";
import themes from "theme/list";
import type { NativeCallback } from "./bridge";

const SERVICE = "Browser";
interface BrowserOptions {
	ephemeral?: boolean;
	onError?: NativeCallback;
}

export default { open };

function open(
	url: string,
	isConsole: boolean = false,
	options: BrowserOptions = {},
) {
	const ACTION = "open";
	const success = () => {};
	const error = options.onError ?? console.error;
	const theme = themes.get(settings.value.appTheme).toJSON("hex");
	Bridge.exec(success, error, SERVICE, ACTION, [
		url,
		theme,
		isConsole,
		options.ephemeral === true,
	]);
}
