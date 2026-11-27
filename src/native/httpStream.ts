import bridge from "./bridge";

const { exec } = bridge("System");
export default function httpStream(
	url: string,
	options: HttpStreamOptions = {},
) {
	options = options || {};
	const signal = options.signal || null;
	const { signal: abortSignal, ...nativeOptions } = options;
	return new Promise<Response>(function (resolve, reject) {
		const requestId =
			"httpStream_" +
			Date.now() +
			"_" +
			Math.random().toString(36).slice(2, 10);
		const HIGH_WATER_MARK = 65536;
		let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
		let headersReceived = false;
		let started = false;
		let cancelSent = false;
		let terminal = false;
		let receivedBytes = 0;
		let ackedBytes = 0;
		function sendCancel() {
			if (cancelSent) return;
			cancelSent = true;
			exec(null, null, "http-stream-cancel", [requestId]);
		}
		function teardownSignal() {
			if (signal) {
				try {
					signal.removeEventListener("abort", onAbort);
				} catch (e) {}
			}
		}
		function finish() {
			terminal = true;
			teardownSignal();
		}
		function fail(err: unknown) {
			if (terminal) return;
			finish();
			if (headersReceived && controller) {
				controller.error(err);
			} else {
				reject(err);
			}
		}
		function onAbort() {
			if (terminal) return;
			if (started) sendCancel();
			const err = new Error("The http stream was aborted");
			err.name = "AbortError";
			fail(err);
		}
		function ackConsumed() {
			if (terminal || !controller) return;
			const desired = controller.desiredSize;
			if (desired === null) return;
			const buffered = Math.max(0, HIGH_WATER_MARK - desired);
			const consumed = receivedBytes - buffered;
			const delta = consumed - ackedBytes;
			if (delta > 0) {
				ackedBytes = consumed;
				exec(null, null, "http-stream-ack", [requestId, delta]);
			}
		}
		function headersFromPairs(
			pairs: [string, string][] | Record<string, string>,
		) {
			const h = new Headers();
			if (!pairs) return h;
			if (!Array.isArray(pairs)) {
				for (let name in pairs) {
					try {
						h.append(name, pairs[name]);
					} catch (e) {}
				}
				return h;
			}
			for (const pair of pairs) {
				if (!pair || pair.length < 2) continue;
				try {
					h.append(pair[0], pair[1]);
				} catch (e) {}
			}
			return h;
		}
		const stream = new ReadableStream<Uint8Array>(
			{
				start(c) {
					controller = c;
				},
				pull() {
					ackConsumed();
				},
				cancel() {
					finish();
					if (started) sendCancel();
				},
			},
			{
				highWaterMark: HIGH_WATER_MARK,
				size(chunk) {
					return chunk.byteLength;
				},
			},
		);
		if (signal) {
			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener("abort", onAbort);
			}
		}
		if (terminal) return;
		started = true;
		exec(
			function (event) {
				if (!event || typeof event !== "object" || terminal) return;
				switch (event.type) {
					case "headers": {
						headersReceived = true;
						const status = event.status;
						const cannotHaveBody =
							status === 204 || status === 205 || status === 304;
						const headers = headersFromPairs(event.headers || []);
						let response;
						if (cannotHaveBody) {
							response = new Response(null, {
								status,
								statusText: event.statusText || "",
								headers,
							});
						} else {
							response = new Response(stream, {
								status,
								statusText: event.statusText || "",
								headers,
							});
						}
						if (event.url) {
							Object.defineProperty(response, "url", {
								value: event.url,
								configurable: true,
							});
						}
						resolve(response);
						break;
					}
					case "data": {
						if (controller && event.chunk) {
							const bytes = event.b64
								? base64ToBytes(event.chunk)
								: latin1ToBytes(event.chunk);
							controller.enqueue(bytes);
							receivedBytes += bytes.byteLength;
						}
						break;
					}
					case "complete": {
						finish();
						if (controller) controller.close();
						break;
					}
					case "error": {
						fail(new Error(event.message || "Stream failed"));
						break;
					}
				}
			},
			function (err) {
				fail(typeof err === "string" ? new Error(err) : err);
			},
			"http-stream-start",
			[requestId, url, nativeOptions],
		);
	});
}
function base64ToBytes(base64: string) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
function latin1ToBytes(text: string) {
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		bytes[i] = text.charCodeAt(i);
	}
	return bytes;
}
