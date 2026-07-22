import {
	checkRuntimeServerInstallation,
	createTransport,
	selectRuntimeProvider,
} from "cm/lsp";
import lspApi from "cm/lsp/api";
import { TestRunner } from "./tester";

const ROOT_URI = "file:///tmp";
const DEFAULT_TIMEOUT = 10000;
const CLEANUP_GRACE_PERIOD = 5000;

function timeoutFor(server) {
	const timeout = Number(server.startupTimeout);
	return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT;
}

function withTimeout(promise, timeout, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), timeout);
		Promise.resolve(promise).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function initializationRequest(id = 1) {
	return {
		jsonrpc: "2.0",
		id,
		method: "initialize",
		params: {
			processId: null,
			clientInfo: {
				name: "Acode",
				version: "1.0",
			},
			rootUri: ROOT_URI,
			capabilities: {},
			workspaceFolders: null,
		},
	};
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidInitializationResponse(response, id = 1) {
	return (
		isObject(response) &&
		response.jsonrpc === "2.0" &&
		response.id === id &&
		isObject(response.result) &&
		isObject(response.result.capabilities)
	);
}

function waitForInitialization(transport, server, timeout) {
	const id = 1;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error, response) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			transport.unsubscribe?.(onMessage);
			if (error) reject(error);
			else resolve(response);
		};
		const onMessage = (data) => {
			let payload;
			try {
				payload = typeof data === "string" ? JSON.parse(data) : data;
			} catch {
				return;
			}
			const messages = Array.isArray(payload) ? payload : [payload];
			const response = messages.find((message) => message?.id === id);
			if (!response) return;
			if (response.error) {
				const detail = response.error.message || JSON.stringify(response.error);
				finish(new Error(`${server.label} rejected initialize: ${detail}`));
				return;
			}
			if (!isValidInitializationResponse(response, id)) {
				finish(
					new Error(`${server.label} returned an invalid initialize result`),
				);
				return;
			}
			finish(null, response);
		};
		const timer = setTimeout(() => {
			finish(
				new Error(
					`${server.label} did not respond to initialize within ${timeout}ms`,
				),
			);
		}, timeout);

		transport.subscribe(onMessage);
		try {
			transport.send(JSON.stringify(initializationRequest(id)));
		} catch (error) {
			finish(error);
		}
	});
}

function createRuntimeContext(server) {
	return {
		uri: ROOT_URI,
		documentUri: ROOT_URI,
		originalDocumentUri: ROOT_URI,
		rootUri: ROOT_URI,
		originalRootUri: ROOT_URI,
		serverId: server.id,
		workspaceKind: "app-private",
		allowNonTerminalWorkspace: true,
	};
}

function transportFromConnection(server, context, connection) {
	if (connection.kind === "transport") {
		return connection.transport;
	}

	return createTransport(
		{
			...server,
			transport: {
				...server.transport,
				kind: "websocket",
				url: connection.url,
				protocols: connection.protocols,
			},
		},
		context,
	);
}

async function cleanup(provider, connection, transportHandle) {
	const errors = [];
	try {
		await transportHandle?.dispose?.();
	} catch (error) {
		errors.push(error);
	}
	try {
		await connection?.dispose?.();
	} catch (error) {
		errors.push(error);
	}
	try {
		if (connection) await provider?.stop?.(connection);
	} catch (error) {
		errors.push(error);
	}
	if (errors.length) {
		console.warn("Failed to completely clean up LSP test connection", errors);
	}
}

async function testServer(server, test) {
	const timeout = timeoutFor(server);
	const context = createRuntimeContext(server);
	const installation = await withTimeout(
		checkRuntimeServerInstallation(server, context),
		timeout,
		`Timed out checking whether ${server.label} is installed`,
	);

	if (installation.status === "missing") {
		return test.skip(`${server.label} is not installed`);
	}

	const provider = await withTimeout(
		selectRuntimeProvider(server, context),
		timeout,
		`Timed out selecting a runtime for ${server.label}`,
	);
	if (!provider) {
		throw new Error(`No runtime can start ${server.label}`);
	}

	let connection;
	let transportHandle;
	try {
		connection = await withTimeout(
			provider.start(server, context),
			timeout,
			`${server.label} did not start within ${timeout}ms`,
		);
		transportHandle = transportFromConnection(server, context, connection);
		await withTimeout(
			transportHandle.ready,
			timeout,
			`${server.label} transport was not ready within ${timeout}ms`,
		);
		await waitForInitialization(transportHandle.transport, server, timeout);
	} finally {
		await cleanup(provider, connection, transportHandle);
	}
}

export async function runLspTests(writeOutput) {
	const runner = new TestRunner("LSP Server Tests");
	const servers = lspApi.servers.list();

	for (const server of servers) {
		const timeout = timeoutFor(server);
		runner.test(
			`${server.label} (${server.id}) initializes`,
			(test) => testServer(server, test),
			{
				timeout: timeout * 5 + CLEANUP_GRACE_PERIOD,
			},
		);
	}

	return await runner.run(writeOutput);
}
