import { fromArrayBuffer, toArrayBuffer } from "./base64";
import bridge from "./bridge";
import exec from "./exec";

const call = bridge("WebSocketPlugin");
type SocketData = string | ArrayBuffer | ArrayBufferView;
interface SocketReply {
	type: string;
	data?: any;
	extensions?: string;
	isBinary?: boolean;
	parseAsText?: boolean;
	readyState?: number;
}
type BinaryMessageEvent = MessageEvent & { binary?: boolean };
const sockets = {
	connect,
	listClients: () => call<unknown[]>("listClients"),
	send,
	close: (id: string, code?: number, reason?: string) =>
		call("close", [id, code, reason]),
	DEBUG: false,
};
export default sockets;

export class WebSocketInstance extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	extensions = "";
	readyState = WebSocketInstance.CONNECTING;
	onopen: ((event: SocketReply) => void) | null = null;
	onmessage: ((event: BinaryMessageEvent) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event & { message?: unknown }) => void) | null = null;
	private binaryMode: string;
	constructor(
		readonly url: string,
		readonly instanceId: string,
		binaryType = "",
	) {
		super();
		this.binaryMode = binaryType;
		exec(
			(event: SocketReply) => this.receive(event),
			(error) =>
				this.onerror?.(Object.assign(new Event("error"), { message: error })),
			"WebSocketPlugin",
			"registerListener",
			[instanceId],
		);
	}
	get binaryType() {
		return this.binaryMode;
	}
	set binaryType(value: string) {
		if (!["", "blob", "arraybuffer"].includes(value)) {
			console.warn('Invalid binaryType, expected "blob" or "arraybuffer"');
			return;
		}
		this.binaryMode = value === "blob" ? "" : value;
		exec(null, null, "WebSocketPlugin", "setBinaryType", [
			this.instanceId,
			value,
		]);
	}
	send(message: SocketData, binary?: boolean) {
		if (this.readyState !== WebSocketInstance.OPEN)
			throw new Error("WebSocket is not open/connected");
		const encoded = encodeMessage(message, binary);
		exec(
			() => log("Sent message", this.instanceId),
			(error) => console.error("WebSocket send error", error),
			"WebSocketPlugin",
			"send",
			[this.instanceId, ...encoded],
		);
	}
	close(code?: number, reason?: string) {
		this.readyState = WebSocketInstance.CLOSING;
		exec(
			null,
			(error) => console.error("WebSocket close error", error),
			"WebSocketPlugin",
			"close",
			[this.instanceId, code, reason],
		);
	}
	private receive(event: SocketReply) {
		log("Native WebSocket event", event);
		if (event.readyState !== undefined) this.readyState = event.readyState;
		if (event.type === "open") {
			this.readyState = WebSocketInstance.OPEN;
			this.extensions = event.extensions ?? "";
			this.onopen?.(event);
			this.dispatchEvent(new Event("open"));
		} else if (event.type === "message") {
			const data =
				event.isBinary &&
				this.binaryType === "arraybuffer" &&
				!event.parseAsText
					? toArrayBuffer(event.data)
					: event.data;
			const message = Object.assign(new MessageEvent("message", { data }), {
				binary: event.isBinary,
			});
			this.onmessage?.(message);
			this.dispatchEvent(message);
		} else if (event.type === "close") {
			this.readyState = WebSocketInstance.CLOSED;
			const data =
				typeof event.data === "string" ? JSON.parse(event.data) : event.data;
			const closeEvent = new CloseEvent("close", {
				code: data?.code,
				reason: data?.reason,
			});
			this.onclose?.(closeEvent);
			this.dispatchEvent(closeEvent);
		} else if (event.type === "error") {
			const error = Object.assign(new Event("error"), { message: event.data });
			this.onerror?.(error);
			this.dispatchEvent(error);
		}
	}
}

async function connect(
	url: string,
	protocols: string[] | null = null,
	headers: Record<string, string> | null = null,
	binaryType = "",
) {
	const id = await call<string>("connect", [
		url,
		protocols,
		headers,
		binaryType,
	]);
	return new WebSocketInstance(url, id, binaryType);
}
function send(id: string, message: SocketData, binary?: boolean) {
	return call("send", [id, ...encodeMessage(message, binary)]);
}
function encodeMessage(
	message: SocketData,
	binary?: boolean,
): [string, boolean | undefined] {
	if (typeof message === "string")
		return [binary ? btoa(message) : message, binary];
	if (message instanceof ArrayBuffer) return [fromArrayBuffer(message), true];
	if (ArrayBuffer.isView(message))
		return [
			fromArrayBuffer(
				new Uint8Array(
					message.buffer,
					message.byteOffset,
					message.byteLength,
				).slice().buffer,
			),
			true,
		];
	throw new Error(`Unsupported message type: ${typeof message}`);
}
function log(...values: unknown[]) {
	if (sockets.DEBUG) console.log(...values);
}
