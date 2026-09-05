import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";

import system from "../../src/plugins/system/www/plugin.js";

/**
 * A minimal local HTTP test server that intentionally flushes data
 * incrementally so we can prove the streaming path is genuinely streaming
 * rather than buffering the whole response.
 */
class TestServer {
	constructor() {
		this.server = http.createServer((req, res) => this.handle(req, res));
		this.port = 0;
		this.serverLog = [];
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
		const path = url.pathname;
		this.requestLog.push({
			method: req.method,
			path,
			headers: req.headers,
			body: [],
		});

		req.on("data", (chunk) => {
			this.requestLog[this.requestLog.length - 1].body.push(chunk);
		});

		const write = (chunk, meta = {}) => {
			this.serverLog.push({ time: Date.now(), chunk, ...meta });
			res.write(chunk);
		};

		switch (path) {
			case "/simple":
				res.writeHead(200, { "Content-Type": "text/plain" });
				write("hello world");
				res.end();
				break;

			case "/chunked":
				res.writeHead(200, { "Content-Type": "text/plain" });
				write("chunk-1");
				setTimeout(() => {
					write("chunk-2");
					setTimeout(() => {
						write("chunk-3");
						res.end();
					}, 100);
				}, 100);
				break;

			case "/genuine-stream":
				// chunk 1 -> wait -> chunk 2 -> wait -> chunk 3 -> close
				res.writeHead(200, { "Content-Type": "text/event-stream" });
				write("data: {\"tok", { seq: 1 });
				setTimeout(() => {
					write("en\":\"Hel\"}\n\n", { seq: 2 });
					setTimeout(() => {
						write("data: {\"token\":\"lo\"}\n\n", { seq: 3 });
						res.end();
					}, 400);
				}, 400);
				break;

			case "/utf8-split":
				// "hétérogénéité" split mid multi-byte char
				const text = "héllo \u00e9\u00e8\u00ea wörld";
				res.writeHead(200, { "Content-Type": "text/plain" });
				const bytes = Buffer.from(text, "utf8");
				write(bytes.subarray(0, 5));
				setTimeout(() => write(bytes.subarray(5)), 50);
				setTimeout(() => res.end(), 100);
				break;

			case "/sse-split":
				res.writeHead(200, { "Content-Type": "text/event-stream" });
				write("data: {\"a\":1");
				setTimeout(() => write("}\n\n"), 50);
				setTimeout(() => res.end(), 100);
				break;

			case "/large":
				res.writeHead(200, { "Content-Type": "application/octet-stream" });
				const block = Buffer.alloc(65536, 0x61);
				let sent = 0;
				const total = 5 * 1024 * 1024; // 5 MiB
				const tick = () => {
					write(block.subarray(0, Math.min(block.length, total - sent)));
					sent += block.length;
					if (sent < total) {
						setImmediate(tick);
					} else {
						res.end();
					}
				};
				tick();
				break;

			case "/long-lived":
				res.writeHead(200, { "Content-Type": "text/event-stream" });
				write("data: 1\n\n");
				const heartbeat = setInterval(() => {
					write(": keepalive\n\n");
				}, 50);
				setTimeout(() => {
					clearInterval(heartbeat);
					write("data: done\n\n");
					res.end();
				}, 500);
				break;

			case "/close-normal":
				res.writeHead(200, { "Content-Type": "text/plain" });
				write("closing");
				res.end();
				break;

			case "/error-after-data":
				res.writeHead(200, { "Content-Type": "text/plain" });
				write("partial-data");
				setTimeout(() => res.socket.destroy(), 50);
				break;

			case "/network-error":
				res.socket.destroy();
				break;

			case "/metadata":
				res.writeHead(201, {
					"Content-Type": "application/json",
					"X-Custom-Header": "custom-value",
					"Set-Cookie": "a=1; Path=/, b=2; Path=/",
				});
				write("{}");
				res.end();
				break;

			case "/echo-body":
				res.writeHead(200, { "Content-Type": "application/json" });
				req.on("end", () => {
					const body = Buffer.concat(
						this.requestLog[this.requestLog.length - 1].body,
					).toString("utf8");
					res.write(body);
					res.end();
				});
				break;

			case "/status500":
				res.writeHead(500, { "Content-Type": "text/plain" });
				write("server error body");
				res.end();
				break;

			case "/empty":
				res.writeHead(204);
				res.end();
				break;

			default:
				res.writeHead(404, { "Content-Type": "text/plain" });
				write("not found");
				res.end();
		}
	}

	close() {
		return new Promise((resolve) => this.server.close(resolve));
	}
}

/**
 * A fake native bridge. It mirrors the protocol the Java StreamHttp layer
 * uses (headers/data/complete/error events) but performs a *real* HTTP
 * request against the local test server, forwarding chunks as they arrive.
 *
 * This keeps the JS side of the plugin fully testable in Node while still
 * exercising genuinely incremental network reads.
 */
function createNativeBridge(server) {
	const streams = new Map();
	const calls = [];

	const exec = (success, error, service, action, args) => {
		calls.push({ action, args });

		if (action === "http-stream-start") {
			const [requestId, url, options] = args;
			startStream(requestId, url, options, success);
		} else if (action === "http-stream-pause") {
			const s = streams.get(args[0]);
			if (s) {
				s.paused = true;
				// mirror native: stop reading from the socket
				s.res?.pause();
			}
			if (success) success();
		} else if (action === "http-stream-resume") {
			const s = streams.get(args[0]);
			if (s) {
				s.paused = false;
				s.res?.resume();
			}
			if (success) success();
		} else if (action === "http-stream-cancel") {
			const s = streams.get(args[0]);
			if (s) {
				s.cancelled = true;
				s.req.destroy();
			}
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
				const headerObj = {};
				for (const [k, v] of Object.entries(res.headers)) {
					headerObj[k] = Array.isArray(v) ? v.join(", ") : v;
				}
				success({
					type: "headers",
					status: res.statusCode,
					statusText: res.statusMessage || "",
					url,
					headers: headerObj,
				});

				const entry = { paused: false, cancelled: false, req, res };
				streams.set(requestId, entry);

				res.on("data", (chunk) => {
					if (entry.paused || entry.cancelled) return;
					success({ type: "data", chunk: chunk.toString("base64") });
				});

				res.on("end", () => {
					if (entry.cancelled) return;
					streams.delete(requestId);
					success({ type: "complete" });
				});

				res.on("error", (err) => {
					if (entry.cancelled) return;
					streams.delete(requestId);
					success({ type: "error", message: err.message });
				});
			},
		);

		req.on("error", (err) => {
			// connection-level failure before headers: emit error event
			success({ type: "error", message: err.message });
		});

		if (options.body != null) {
			req.write(options.body);
		}
		req.end();

		if (!streams.has(requestId)) {
			streams.set(requestId, { paused: false, cancelled: false, req });
		}
	}

	return { exec, calls, streams };
}

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

	// The plugin.js module reads the global `cordova` at call time.
	origCordova = globalThis.cordova;
	globalThis.cordova = {
		exec: (...args) => bridge.exec(...args),
	};
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
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/simple"));
		expect(response.status).toBe(200);
		const chunks = await collect(response);
		expect(decode(chunks)).toBe("hello world");
	});

	it("2. delivers multiple response chunks in order", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/chunked"));
		const chunks = await collect(response);
		expect(decode(chunks)).toBe("chunk-1chunk-2chunk-3");
		expect(chunks.length).toBeGreaterThanOrEqual(3);
	});

	it("3. streams genuinely: chunk 1 arrives before chunk 2 is generated", async () => {
		bridge = createNativeBridge(server);

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

		// chunk boundaries are arbitrary: at least 2 separate deliveries
		expect(received.length).toBeGreaterThanOrEqual(2);

		// the first chunk was delivered before the server generated chunk 2
		// (which happens at ~400ms). Prove genuine streaming, not buffering.
		expect(received[0].time).toBeLessThan(350);

		// and the whole stream took ~800ms (i.e. we didn't wait for it all)
		const total = received[received.length - 1].time;
		expect(total).toBeGreaterThanOrEqual(700);
	});

	it("4. handles chunks that split a UTF-8 character", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/utf8-split"));
		const chunks = await collect(response);
		// Reconstruct using TextDecoder which handles split multibyte chars
		const decoder = new TextDecoder();
		let text = "";
		for (const c of chunks) {
			text += decoder.decode(c, { stream: true });
		}
		text += decoder.decode();
		expect(text).toBe("héllo \u00e9\u00e8\u00ea wörld");
	});

	it("5. forwards SSE bytes as-is (no native parsing, raw text)", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/sse-split"));
		const chunks = await collect(response);
		// The JS consumer is responsible for SSE parsing; native just forwards bytes.
		expect(decode(chunks)).toBe('data: {"a":1}\n\n');
	});

	it("6. supports very large responses without a single buffered blob", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/large"));
		const chunks = await collect(response);
		const total = concat(chunks);
		expect(total.byteLength).toBe(5 * 1024 * 1024);
		// received in many chunks (incremental), not one giant buffer
		expect(chunks.length).toBeGreaterThan(10);
	});

	it("7. handles a long-lived response that stays open", async () => {
		bridge = createNativeBridge(server);
		const start = Date.now();
		const response = await system.httpStream(server.url("/long-lived"));
		const chunks = await collect(response);
		const elapsed = Date.now() - start;
		expect(decode(chunks)).toContain("data: done");
		expect(elapsed).toBeGreaterThanOrEqual(400);
	});

	it("8. completes normally when the server closes the connection", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/close-normal"));
		const chunks = await collect(response);
		expect(decode(chunks)).toBe("closing");
	});

	it("9. surfaces a network error after partial data", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/error-after-data"));
		const reader = response.body.getReader();
		const chunks = [];
		let error;
		while (true) {
			try {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			} catch (e) {
				error = e;
				break;
			}
		}
		expect(decode(chunks)).toBe("partial-data");
		expect(error).toBeInstanceOf(Error);
	});

	it("10. rejects with a transport error on connection failure before headers", async () => {
		bridge = createNativeBridge(server);
		// server not listening on this port -> connection refused
		const url = `http://127.0.0.1:${server.port}/network-error`;
		// open a socket and destroy it to simulate connection error via the route
		const response = await system.httpStream(url).then(
			() => null,
			(err) => err,
		);
		expect(response).toBeInstanceOf(Error);
	});

	it("11. preserves HTTP response metadata", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/metadata"));
		expect(response.status).toBe(201);
		expect(response.statusText).toBe("Created");
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("x-custom-header")).toBe("custom-value");
		expect(response.url).toBe(server.url("/metadata"));
	});

	it("12. keeps a 500 status as a normal response, distinguishable from a network failure", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/status500"));
		expect(response.status).toBe(500);
		const chunks = await collect(response);
		expect(decode(chunks)).toBe("server error body");
	});

	it("13. handles an empty response body", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/empty"));
		expect(response.status).toBe(204);
		const chunks = await collect(response);
		expect(chunks).toHaveLength(0);
	});

	it("14. supports POST bodies", async () => {
		bridge = createNativeBridge(server);
		const body = JSON.stringify({ model: "test", stream: true });
		const response = await system.httpStream(server.url("/echo-body"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		});
		const chunks = await collect(response);
		expect(decode(chunks)).toBe(body);
	});

	it("15. cancelling the stream cancels the underlying request", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/long-lived"));
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
	});

	it("16. supports multiple simultaneous streaming requests", async () => {
		bridge = createNativeBridge(server);
		const [a, b, c] = await Promise.all([
			system.httpStream(server.url("/simple")),
			system.httpStream(server.url("/close-normal")),
			system.httpStream(server.url("/empty")),
		]);
		const results = await Promise.all([
			collect(a),
			collect(b),
			collect(c),
		]);
		expect(decode(results[0])).toBe("hello world");
		expect(decode(results[1])).toBe("closing");
		expect(results[2]).toHaveLength(0);
	});

	it("17. existing non-streaming API is unchanged", async () => {
		// `sendRequest` lives in cordova.plugin.http (untouched). The system
		// plugin still exposes its original methods.
		expect(typeof system.getWebviewInfo).toBe("function");
		expect(typeof system.fileAction).toBe("function");
		expect(typeof system.httpStream).toBe("function");
		expect(typeof system.getAppInfo).toBe("function");
	});

	it("18. pauses the native reader when the JS consumer is slower", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/large"));
		const reader = response.body.getReader();

		// Consume only the first chunk, then stop reading for a while so the
		// native side pushes more data than JS drains -> backpressure pause.
		const first = await reader.read();
		expect(first.done).toBe(false);

		await new Promise((r) => setTimeout(r, 120));

		const sawPause = bridge.calls.some(
			(c) => c.action === "http-stream-pause",
		);

		// drain the rest to let the stream finish cleanly
		while (true) {
			const { done } = await reader.read();
			if (done) break;
		}

		const sawResume = bridge.calls.some(
			(c) => c.action === "http-stream-resume",
		);
		expect(sawPause).toBe(true);
		expect(sawResume).toBe(true);
	});

	it("19. native chunk boundaries may split SSE frames (raw bytes preserved)", async () => {
		bridge = createNativeBridge(server);
		const response = await system.httpStream(server.url("/genuine-stream"));
		const reader = response.body.getReader();
		const received = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received.push(Buffer.from(value).toString("utf8"));
		}
		// chunk 1 is '"data: {"tok"' and chunk 2 is 'en":"Hel"}\n\n'
		// i.e. the first SSE frame is split across native chunks. The JS
		// consumer must reassemble; native must not parse/alter the bytes.
		const full = received.join("");
		expect(full).toBe('data: {"token":"Hel"}\n\ndata: {"token":"lo"}\n\n');
	});
});
