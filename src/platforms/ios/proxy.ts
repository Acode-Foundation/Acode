import type { NativeCallback } from "../../native/bridge";
import setInputType from "./input";

type ProxyAction = (
	success: NativeCallback,
	error: NativeCallback,
	args: unknown[],
) => void;

const proxy: Record<string, Record<string, ProxyAction>> = {
	System: {
		"set-input-type"(success, error, args) {
			setInputType(args[0]);
			success?.();
		},
	},
	Native: {
		setKeyboardSuggestionsEnabled(success, error, args) {
			setInputType(args[0] ? "NORMAL" : "NO_SUGGESTIONS");
			success?.(1);
		},
		showToast(success, error, args) {
			const [message] = args;
			if (typeof message !== "string") {
				error?.(new Error("message required"));
				return;
			}
			window.toast(message);
			success?.();
		},
	},
};

export default proxy;
