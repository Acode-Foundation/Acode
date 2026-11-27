import { fromArrayBuffer, toArrayBuffer } from "./base64";

export type NativeCallback = ((...values: any[]) => void) | null | undefined;
export type NativeExec = (
	success: NativeCallback,
	error: NativeCallback,
	service: string,
	action: string,
	args?: unknown[],
) => void;
export interface NativeReply {
	id: number;
	keep?: boolean;
	status: number;
	data?: unknown;
}
export type NativeSender = (
	service: string,
	action: string,
	args: string,
	id: number,
) => boolean | void;

/** Bind a service once, then call its actions through the shared native transport. */
export default function bridge(service: string) {
	const exec = (
		success: NativeCallback,
		error: NativeCallback,
		action: string,
		args: unknown[] = [],
	) => Bridge.exec(success, error, service, action, args);
	const call = <T = void>(action: string, args: unknown[] = []): Promise<T> =>
		new Promise((resolve, reject) => exec(resolve, reject, action, args));
	return Object.assign(call, { exec });
}

export function createTransport(send: NativeSender) {
	const callbacks = new Map<
		number,
		{ success: NativeCallback; error: NativeCallback }
	>();
	let callbackId = 0;
	const exec: NativeExec = (success, error, service, action, args = []) => {
		const id = ++callbackId;
		callbacks.set(id, { success, error });
		try {
			const encoded = args.map((value) =>
				Object.prototype.toString.call(value) === "[object ArrayBuffer]"
					? fromArrayBuffer(value as ArrayBuffer)
					: value,
			);
			if (send(service, action, JSON.stringify(encoded), id) === false)
				throw new Error(`Native service rejected ${service}.${action}`);
		} catch (exception) {
			callbacks.delete(id);
			if (error)
				error(
					exception instanceof Error ? exception.message : String(exception),
				);
			else throw exception;
		}
	};
	const receive = ({ id, keep, status, data }: NativeReply) => {
		const callback = callbacks.get(id);
		if (!callback) return;
		if (!keep) callbacks.delete(id);
		if (status === 0) return;
		const listener = status === 1 ? callback.success : callback.error;
		const payload = data as { kind?: string; data?: unknown[] } | undefined;
		listener?.(
			...(payload?.kind === "multipart"
				? payload.data!.map(decode)
				: [decode(data)]),
		);
	};
	return { exec, receive };
}

function decode(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	const payload = value as { kind?: string; data: string };
	if (payload.kind === "binaryString") return atob(payload.data);
	if (payload.kind === "arrayBuffer") return toArrayBuffer(payload.data);
	return value;
}
