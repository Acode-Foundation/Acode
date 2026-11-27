import { fromArrayBuffer } from "../../native/base64";
import type { NativeExec } from "../../native/bridge";
import { createTransport } from "../../native/bridge";
import installAPITransport from "./api";
import installFullscreen from "./fullscreen";
import proxy from "./proxy";

export interface IOSReply {
	id: number;
	status?: number;
	keep?: boolean;
	success?: unknown;
	error?: unknown;
	isBinary?: boolean;
	length?: number;
}

export default function setup() {
	installAPITransport();
	const transport = createTransport((service, action, args, id) => {
		window.webkit.messageHandlers.exec.postMessage({
			service,
			action,
			args,
			id,
		});
	});
	window.iOS = {
		callback(reply: IOSReply) {
			let data = reply.success;
			if (reply.isBinary && typeof data === "string") {
				const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0));
				data = { kind: "arrayBuffer", data: fromArrayBuffer(bytes.buffer) };
			}
			const failed = reply.error !== null && reply.error !== undefined;
			transport.receive({
				id: reply.id,
				keep: reply.keep,
				status: reply.status ?? (failed ? 9 : 1),
				data: failed ? reply.error : data,
			});
		},
	};
	const exec: NativeExec = (success, error, service, action, args = []) => {
		const handler = proxy[service]?.[action];
		if (handler) handler(success, error, args);
		else transport.exec(success, error, service, action, args);
	};
	installFullscreen(
		(active) =>
			new Promise((resolve, reject) =>
				transport.exec(resolve, reject, "System", "set-fullscreen", [active]),
			),
	);
	return exec;
}
