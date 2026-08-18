// @vitest-environment happy-dom

import {StateEffect} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const registry = vi.hoisted(() => ({servers: []}));

// Keep the lifecycle test independent of app UI modules that use JSX in .js
// files, which Vitest's native import analysis does not transform.
vi.mock("cm/lsp/serverRegistry", () => ({
	default: {
		getServersForLanguage: (languageId) =>
			registry.servers.filter(
				(server) => server.enabled !== false && server.languages.includes(languageId),
			),
	},
}));

vi.mock("components/lspStatusBar", () => ({
	default: {
		show: vi.fn(),
		update: vi.fn(),
		hideById: vi.fn(),
	},
}));

vi.mock("components/settingsPage", () => ({default: vi.fn()}));
vi.mock("components/checkbox", () => ({
	default: vi.fn(),
	updateSwitchHandle: vi.fn(),
}));

vi.mock("lib/notificationManager", () => ({
	default: {add: vi.fn()},
}));

vi.mock("lib/settings", () => ({
	default: {value: {lsp: {}}},
}));

vi.mock("cm/lsp/diagnostics", () => ({
	clearDiagnosticsEffect: StateEffect.define(),
	disposePullDiagnostics: vi.fn(),
	lspDiagnosticsAutoSyncExtension: () => [],
}));

vi.mock("cm/lsp/documentColors", () => ({
	documentColorsExtension: () => [],
}));

vi.mock("cm/lsp/formattingSupport", () => ({
	supportsBuiltinFormatting: () => false,
}));

vi.mock("cm/lsp/inlayHints", () => ({
	inlayHintsExtension: () => [],
}));

vi.mock("cm/lsp/logs", () => ({addLspLog: vi.fn()}));

vi.mock("cm/lsp/tooltipExtensions", () => ({
	hoverTooltips: () => [],
	resolveLspHoverHighlightLanguage: vi.fn(),
	signatureHelp: () => [],
}));

import {LspClientManager} from "cm/lsp/clientManager";
import {
	registerRuntimeProvider,
	unregisterRuntimeProvider,
} from "cm/lsp/runtimeProviders";
import externalWebSocketRuntimeProvider from "cm/lsp/runtimes/externalWebSocket";

const SERVER_ID = "external-websocket-lifecycle-test";
const LANGUAGE_ID = "external-websocket-lifecycle-test";
const DISPOSABLE_RUNTIME_ID = "disposable-lifecycle-test";

class TestWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static instances = [];

	readyState = TestWebSocket.CONNECTING;
	onopen = null;
	onmessage = null;
	onerror = null;
	onclose = null;
	sent = [];
	closeCalls = 0;

	constructor(url) {
		this.url = url;
		TestWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = TestWebSocket.OPEN;
			this.onopen?.({type: "open"});
		});
	}

	send(data) {
		if (this.readyState !== TestWebSocket.OPEN) {
			throw new Error("socket is not open");
		}
		this.sent.push(data);
		const message = JSON.parse(data);
		if (message.method !== "initialize") return;
		queueMicrotask(() => {
			this.onmessage?.({
				data: JSON.stringify({
					jsonrpc: "2.0",
					id: message.id,
					result: {capabilities: {}},
				}),
			});
		});
	}

	close(code = 1000) {
		this.closeCalls++;
		this.readyState = TestWebSocket.CLOSED;
		this.onclose?.({code, wasClean: code === 1000});
	}
}

let originalWebSocket;
let manager;
let view;

beforeEach(() => {
	originalWebSocket = globalThis.WebSocket;
	globalThis.WebSocket = TestWebSocket;
	TestWebSocket.instances = [];
	registerRuntimeProvider(externalWebSocketRuntimeProvider, {replace: true});
	registry.servers = [
		{
			id: SERVER_ID,
			label: SERVER_ID,
			enabled: true,
			priority: 0,
			languages: [LANGUAGE_ID],
			transport: {
				kind: "websocket",
				url: "ws://localhost:3030",
			},
		},
	];
	view = new EditorView({doc: "fn main() {}", parent: document.body});
});

afterEach(async () => {
	await manager?.dispose();
	view?.destroy();
	registry.servers = [];
	unregisterRuntimeProvider(DISPOSABLE_RUNTIME_ID);
	globalThis.WebSocket = originalWebSocket;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("external WebSocket LSP lifecycle", () => {
	it("reuses one client and socket when switching files in a workspace", async () => {
		const onClientIdle = vi.fn(({dispose}) => void dispose());
		manager = new LspClientManager({onClientIdle});
		const rootUri = "file:///workspace";

		await manager.getExtensionsForFile({
			uri: `${rootUri}/first.rs`,
			rootUri,
			languageId: LANGUAGE_ID,
			view,
		});
		manager.detach(`${rootUri}/first.rs`, view);

		await manager.getExtensionsForFile({
			uri: `${rootUri}/second.rs`,
			rootUri,
			languageId: LANGUAGE_ID,
			view,
		});

		expect(onClientIdle).not.toHaveBeenCalled();
		expect(manager.getActiveClients()).toHaveLength(1);
		expect(TestWebSocket.instances).toHaveLength(1);
		expect(TestWebSocket.instances[0].closeCalls).toBe(0);
	});

	it("preserves eager idle cleanup for runtimes without keep-alive", async () => {
		registerRuntimeProvider(
			{
				id: DISPOSABLE_RUNTIME_ID,
				label: "Disposable test runtime",
				priority: 100,
				canHandle: () => true,
				start: async (server) => ({
					kind: "websocket",
					providerId: DISPOSABLE_RUNTIME_ID,
					url: server.transport.url,
				}),
			},
			{replace: true},
		);
		registry.servers[0].runtimes = [DISPOSABLE_RUNTIME_ID];
		const onClientIdle = vi.fn(({dispose}) => void dispose());
		manager = new LspClientManager({onClientIdle});
		const rootUri = "file:///workspace";
		const uri = `${rootUri}/only.rs`;

		await manager.getExtensionsForFile({
			uri,
			rootUri,
			languageId: LANGUAGE_ID,
			view,
		});
		manager.detach(uri, view);
		await Promise.resolve();

		expect(onClientIdle).toHaveBeenCalledOnce();
		expect(manager.getActiveClients()).toHaveLength(0);
		expect(TestWebSocket.instances[0].closeCalls).toBe(1);
	});
});
