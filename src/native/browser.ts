import settings from "lib/settings";
import themes from "theme/list";
import type { NativeCallback } from "./bridge";

const SERVICE = "Browser";
function open(url: string, isConsole: boolean = false) {
	const ACTION = "open";
	const success = () => {};
	const error = () => {};
	const theme = themes.get(settings.value.appTheme).toJSON("hex");
	Bridge.exec(success, error, SERVICE, ACTION, [url, theme, isConsole]);
}
export default {
	open,
};
