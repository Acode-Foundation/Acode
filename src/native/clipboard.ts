import type { NativeCallback } from "./bridge";
import exec from "./exec";
export default {
	copy(
		text: string | null | undefined,
		success?: NativeCallback,
		failure?: NativeCallback,
	) {
		exec(success, failure, "Clipboard", "copy", [text ?? ""]);
	},
	paste(success?: NativeCallback, failure?: NativeCallback) {
		exec(success, failure, "Clipboard", "paste");
	},
	clear(success?: NativeCallback, failure?: NativeCallback) {
		exec(success, failure, "Clipboard", "clear");
	},
};
