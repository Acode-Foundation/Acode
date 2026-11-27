import type { NativeCallback } from "./bridge";
import exec from "./exec";
export default {
	open(
		url: string,
		options: Record<string, unknown> | null,
		success?: NativeCallback,
		error?: NativeCallback,
	) {
		exec(success, error, "CustomTabs", "open", [url, options ?? {}]);
	},
};
