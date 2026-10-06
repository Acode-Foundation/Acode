import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";

import system from "../../src/plugins/system/www/plugin.js";

const CREDIT_WINDOW = 128 * 1024;
const BRIDGE_CHUNK = 8192;

class TestServer {
	constructor() {
		this.server = http.createServer((req, res) => this.handle(req, res));
		this.port = 0;
		this.requestLog = [];
	}

	listen() {
		return new Promise((resolve) => {
			this.server.listen(0, "127.0.0.1", () => {
				this.port = this.server.address().port;
				resolve();
			});
		});
	}

	url(path) {
		return `http://127.0.0.1:${this.port}${path}`;
	}

	handle(req, res) {
		const url = new URL(req.url, "http://localhost");
		this.requestLog.push({ method: req.method, path: url.pathname });

		switch (url.pathname) {
			case "/simple":
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("hello world");
				break;

			case "/genuine-stream":
				// chunk 1 -> wait -> chunk 2 -> wait -> chunk 3 -> close
				res.writeHead(200, { "Content-Type": "text/event-stream" });
				res.write('data: {"tok', () => {
					setTimeout(() => {
						res.write('en":"Hel"}\n\n', () => {
							setTimeout(() => {
								res.end('data: {"token":"lo"}\n\n');
							}, 300);
						});
					}, 300);
				});
				break;

			case "/utf8-split":
				res.writeHead(200, { "Content-Type": "text/plain" });
				const text = "héllo \u00e9\u00e8\u00ea wörld";
				const bytes = Buffer.from(text, "utf8");
				res.write(bytes.subarray(0, 5));
				setTimeout(() => res.end(bytes.subarray(5)), 50);
				break;

			case "/large":
				res.writeHead(200, { "Content-Type": "application/octet-stream" });
				const block = Buffer.alloc(65536, 0x61);
				let sent = 0;
				const total = 1024 * 1024; // 1 MiB
				const tick = () => {
					res.write(block.subarray(0, Math.min(block.length, total - sent)));
					sent += block.length;
					if (sent < total) {
						setImmediate(tick);
					} else {
						res.end();
					}
				};
				tick();
				break;

			case "/status500-empty":
				// 4xx/5xx response with NO error body: Java's getErrorStream()
				// returns null and the response must be treated as an empty body
				// followed by complete, not as a transport failure.
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end();
				break;

			case "/network-error":
				res.socket.destroy();
				break;

			case "/keep-open":
				res.writeHead(200, { "Content-Type": "text/event-stream" });
				res.write("data: 1\n\n");
				break;

			case "/cookies":
				res.writeHead(200, {
					"Content-Type": "text/plain",
					"Set-Cookie": ["session=abc; Path=/", "theme=dark; Path=/"],
				});
				res.end("ok");
				break;

			case "/latin1-text":
				// No control bytes (<0x20): must travel on the raw latin1 fast path.
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end('say "hi" \\ path \u00e9\u00ff\u2028 done');
				break;

			case "/binary-ctrl":
				// Contains control bytes (0x00/0x08/0x1f): must fall back to base64.
				res.writeHead(200, { "Content-Type": "application/octet-stream" });
				res.end(Buffer.from([0x00, 0x08, 0x1f, 0x7f, 0xff, 0x22, 0x00]));
				break;

			default:
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("not found");
		}
	}

	close() {
		return new Promise((resolve) => this.server.close(resolve));
	}
}

/**
 * An asynchronous fake native bridge that mirrors the real Cordova/Java
 * contract:
 *
 * - The Java reader thread only hands bytes to the Cordova bridge while fewer
 *   than CREDIT_WINDOW bytes are awaiting a JavaScript ACK (`http-stream-ack`).
 * - Delivery to JavaScript is asynchronous (like the Cordova message queue), so
 *   messages can sit in the bridge while JS catches up. A synchronous fake
 *   bridge hides real backpressure races, so this one does not deliver inline.
 *
 * The JS under test must ACK bytes only once the consumer has actually read
 * them; if it ACKed ahead of consumption the windowed reader here would keep
 * flowing and the bounded-buffer guarantees of the protocol would be broken.
 */
function createNativeBridge() {
	const streams = new Map();
	const calls = [];

	const exec = (success, error, service, action, args) => {
		calls.push({ action, args });

		if (action === "http-stream-start") {
			const [requestId, url, options] = args;
			startStream(requestId, url, options, success);
		} else if (action === "http-stream-ack") {
			const s = streams.get(args[0]);
			if (s) s.ack(args[1]);
			if (success) success();
		} else if (action === "http-stream-cancel") {
			const s = streams.get(args[0]);
			if (s) s.cancel();
			if (success) success();
		}
	};

	function startStream(requestId, url, options, success) {
		const u = new URL(url);
		const headers = {};
		if (options.headers) {
			for (const [k, v] of Object.entries(options.headers)) headers[k] = v;
		}

		const req = http.request(
			{
				hostname: u.hostname,
				port: u.port,
				path: u.pathname + u.search,
				method: options.method || "GET",
				headers,
			},
			(res) => {
				const pairs = [];
				for (const [k, v] of Object.entries(res.headers)) {
					const values = Array.isArray(v) ? v : [v];
					for (const value of values) {
						pairs.push([k, value]);
					}
				}
				success({
					type: "headers",
					status: res.statusCode,
					statusText: res.statusMessage || "",
					url,
					headers: pairs,
				});

				const entry = {
					pending: 0,
					acked: 0,
					forwarded: 0,
					maxPending: 0,
					backlog: [],
					delivered: [],
					cancelled: false,
					ended: false,
					completeSent: false,
					req,
					res,
				};
				streams.set(requestId, entry);

				// Mirrors the real Java bridge: PluginResults are JSON encoded on
				// the native side and parsed on the JS side.
				const deliver = (msg) =>
					setImmediate(() => success(JSON.parse(JSON.stringify(msg))));

				// Mirrors StreamHttp.sendData: chunks without control bytes (<0x20)
				// travel as raw ISO-8859-1 characters; everything else uses base64.
				const encodeChunk = (buf) => {
					for (const b of buf) {
						if (b < 0x20) {
							return { chunk: buf.toString("base64"), b64: true };
						}
					}
					return { chunk: buf.toString("latin1") };
				};

				const flush = () => {
					while (entry.pending < CREDIT_WINDOW && entry.backlog.length > 0) {
						const part = entry.backlog.shift();
						entry.pending += part.length;
						entry.forwarded += part.length;
						entry.maxPending = Math.max(entry.maxPending, entry.pending);
						const msg = { type: "data", ...encodeChunk(part) };
						entry.delivered.push(msg);
						deliver(msg);
					}
					if (entry.backlog.length === 0) {
						res.resume();
						if (entry.ended && !entry.completeSent) {
							entry.completeSent = true;
							deliver({ type: "complete" });
						}
					}
				};

				entry.ack = (bytes) => {
					entry.pending = Math.max(0, entry.pending - bytes);
					entry.acked += bytes;
					flush();
				};

				entry.cancel = () => {
					entry.cancelled = true;
					req.destroy();
				};

				// Flowing mode so chunks arrive as the server writes them (the
				// paused/readable mode coalesces everything into one event).
				res.on("data", (chunk) => {
					if (entry.cancelled) return;
					for (let off = 0; off < chunk.length; off += BRIDGE_CHUNK) {
						entry.backlog.push(chunk.subarray(off, off + BRIDGE_CHUNK));
					}
					// Stop draining the socket while the credit window is full so
					// the server experiences real backpressure, like StreamHttp.
					res.pause();
					flush();
				});
				res.on("end", () => {
					entry.ended = true;
					flush();
				});
				res.on("error", () => {
					if (!entry.cancelled && !entry.completeSent) {
						entry.completeSent = true;
						deliver({ type: "error", message: "socket error" });
					}
				});
			},
		);

		if (options.body != null) {
			req.write(options.body);
		}
		req.end();

		req.on("error", (err) => {
			if (!streams.has(requestId)) {
				success({ type: "error", message: err.message });
			}
		});
	}

	return { exec, calls, streams };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server;
let bridge;
let origCordova;

async function collect(response) {
	if (!response.body) return [];
	const reader = response.body.getReader();
	const chunks = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	return chunks;
}

function concat(chunks) {
	const total = chunks.reduce((n, c) => n + c.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function decode(chunks) {
	return Buffer.from(concat(chunks)).toString("utf8");
}

beforeAll(async () => {
	server = new TestServer();
	await server.listen();

	origCordova = globalThis.cordova;
});

afterAll(() => {
	if (origCordova !== undefined) {
		globalThis.cordova = origCordova;
	} else {
		delete globalThis.cordova;
	}
	return server.close();
});

describe("system.httpStream", () => {
	it("1. delivers a small streamed response", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };
		const response = await system.httpStream(server.url("/simple"));
		expect(response.status).toBe(200);
		expect(decode(await collect(response))).toBe("hello world");
	});

	it("2. streams genuinely: chunk 1 arrives before the later chunks exist", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const start = Date.now();
		const response = await system.httpStream(server.url("/genuine-stream"));
		const reader = response.body.getReader();
		const received = [];

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received.push({ time: Date.now() - start, chunk: value });
		}

		const text = received
			.map((r) => Buffer.from(r.chunk).toString("utf8"))
			.join("");
		expect(text).toBe('data: {"token":"Hel"}\n\ndata: {"token":"lo"}\n\n');
		expect(received.length).toBeGreaterThanOrEqual(2);
		expect(received[0].time).toBeLessThan(280);
		expect(received[received.length - 1].time).toBeGreaterThanOrEqual(500);
	});

	it("3. handles chunks that split a UTF-8 character", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };
		const response = await system.httpStream(server.url("/utf8-split"));
		const decoder = new TextDecoder();
		let text = "";
		for (const c of await collect(response)) {
			text += decoder.decode(c, { stream: true });
		}
		text += decoder.decode();
		expect(text).toBe("héllo \u00e9\u00e8\u00ea wörld");
	});

	it("4. ACKs bytes only as the consumer reads them (bounded in flight)", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const response = await system.httpStream(server.url("/large"));
		const reader = response.body.getReader();

		const first = await reader.read();
		expect(first.done).toBe(false);
		const firstLen = first.value.byteLength;

		// While the consumer stalls, JS stops granting credit, so the bridge
		// reader must stall at its window instead of forwarding the whole 1 MiB.
		await sleep(200);
		const entry = bridge.streams.values().next().value;
		expect(entry.maxPending).toBeLessThanOrEqual(CREDIT_WINDOW + BRIDGE_CHUNK);
		expect(entry.forwarded).toBeLessThan(1024 * 1024);
		// JS must never ACK more bytes than the consumer has actually read.
		expect(entry.acked).toBeLessThanOrEqual(firstLen);

		// Resume consuming; the stream must drain to completion.
		let total = firstLen;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
		}
		expect(total).toBe(1024 * 1024);
		expect(entry.acked).toBe(1024 * 1024);
		expect(entry.maxPending).toBeLessThanOrEqual(CREDIT_WINDOW + BRIDGE_CHUNK);
	});

	it("5. keeps a 4xx/5xx with no error body a normal, empty response", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };
		const response = await system.httpStream(server.url("/status500-empty"));
		expect(response.status).toBe(500);
		const chunks = await collect(response);
		expect(chunks).toHaveLength(0);
	});

	it("6. rejects with a transport error on connection failure before headers", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };
		const url = server.url("/network-error");
		const err = await system.httpStream(url).then(() => null, (e) => e);
		expect(err).toBeInstanceOf(Error);
	});

	it("7. cancelling the reader cancels the underlying request and drops late events", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const response = await system.httpStream(server.url("/keep-open"));
		const reader = response.body.getReader();
		const first = await reader.read();
		expect(first.done).toBe(false);

		await reader.cancel();

		expect(
			bridge.calls.some(
				(c) =>
					c.action === "http-stream-cancel" &&
					typeof c.args[0] === "string",
			),
		).toBe(true);

		// The underlying request must have been torn down.
		const entry = bridge.streams.values().next().value;
		expect(entry.cancelled).toBe(true);
	});

	it("8. preserves repeated headers such as Set-Cookie", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const response = await system.httpStream(server.url("/cookies"));
		expect(response.status).toBe(200);
		const h = response.headers;
		if (typeof h.getSetCookie === "function") {
			expect(h.getSetCookie()).toEqual([
				"session=abc; Path=/",
				"theme=dark; Path=/",
			]);
		} else {
			expect(h.get("set-cookie")).toBe(
				"session=abc; Path=/, theme=dark; Path=/",
			);
		}
		await collect(response);
	});

	it("9. rejects without starting when the signal is already aborted", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const controller = new AbortController();
		controller.abort();

		const err = await system
			.httpStream(server.url("/simple"), { signal: controller.signal })
			.then(() => null, (e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("AbortError");
		expect(
			bridge.calls.some((c) => c.action === "http-stream-start"),
		).toBe(false);
	});

	it("10. aborting the signal cancels an in-flight stream and errors the body", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const controller = new AbortController();
		const response = await system.httpStream(server.url("/keep-open"), {
			signal: controller.signal,
		});
		const reader = response.body.getReader();
		const first = await reader.read();
		expect(first.done).toBe(false);

		controller.abort();

		const err = await reader.read().then(() => null, (e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("AbortError");

		expect(
			bridge.calls.some(
				(c) =>
					c.action === "http-stream-cancel" &&
					typeof c.args[0] === "string",
			),
		).toBe(true);
		const entry = bridge.streams.values().next().value;
		expect(entry.cancelled).toBe(true);
	});

	it("11. ships text chunks raw (latin1 fast path, no base64) and decodes them", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const response = await system.httpStream(server.url("/latin1-text"));
		const text = decode(await collect(response));
		expect(text).toBe('say "hi" \\ path \u00e9\u00ff\u2028 done');

		const entry = bridge.streams.values().next().value;
		const dataMsgs = entry.delivered.filter((m) => m.type === "data");
		expect(dataMsgs.length).toBeGreaterThan(0);
		expect(dataMsgs.every((m) => !m.b64)).toBe(true);
	});

	it("12. falls back to base64 for chunks with control bytes and still decodes", async () => {
		bridge = createNativeBridge();
		globalThis.cordova = { exec: (...args) => bridge.exec(...args) };

		const expected = Buffer.from([
			0x00, 0x08, 0x1f, 0x7f, 0xff, 0x22, 0x00,
		]);
		const response = await system.httpStream(server.url("/binary-ctrl"));
		const bytes = Buffer.from(concat(await collect(response)));
		expect(bytes.equals(expected)).toBe(true);

		const entry = bridge.streams.values().next().value;
		const dataMsgs = entry.delivered.filter((m) => m.type === "data");
		expect(dataMsgs.some((m) => m.b64)).toBe(true);
	});
});
