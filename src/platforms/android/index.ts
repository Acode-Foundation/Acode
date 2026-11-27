import { createTransport, type NativeReply } from "../../native/bridge";

export interface AndroidHost {
	exec(
		service: string,
		action: string,
		args: string,
		id: number,
	): boolean | void;
	callback(reply: NativeReply): void;
}

export default function setup() {
	const transport = createTransport((...args) => window.Android.exec(...args));
	window.Android.callback = transport.receive;
	return transport.exec;
}
