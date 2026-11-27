import type { NativeCallback } from "./bridge";
import bridge from "./bridge";

const { exec } = bridge("Server");

export default (function (
	port: number,
	onRequest: NativeCallback,
	onError: NativeCallback,
) {
	exec(onRequest, onError, "start", [port]);
	return {
		stop(onSuccess: NativeCallback, onError: NativeCallback) {
			onSuccess = onSuccess || function () {};
			onError = onError || console.error.bind(console);
			exec(onSuccess, onError, "stop", [port]);
		},
		send(
			req_id: string,
			data: unknown,
			onSuccess: NativeCallback,
			onError: NativeCallback,
		) {
			onSuccess = onSuccess || function () {};
			onError = onError || console.error.bind(console);
			exec(onSuccess, onError, "send", [port, req_id, data]);
		},
		setOnRequestHandler(onRequest: NativeCallback, onError: NativeCallback) {
			onError = onError || console.error.bind(console);
			exec(onRequest, onError, "setOnRequestHandler", [port]);
		},
		port,
	};
});
