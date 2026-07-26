import { Diagnostic, linter, lintGutter } from "@codemirror/lint";
import type { LSPClient } from "@codemirror/lsp-client";
import { LSPPlugin } from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import {
	EditorState,
	MapMode,
	StateEffect,
	StateField,
} from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { addLspLogFor } from "./logs";
import type {
	DocumentDiagnosticParams,
	DocumentDiagnosticReport,
	LSPClientWithWorkspace,
	LSPPluginAPI,
	LspDiagnostic,
	PublishDiagnosticsParams,
	RawDiagnostic,
} from "./types";

const setPublishedDiagnostics = StateEffect.define<LspDiagnostic[]>();
let diagnosticsEventTimer: ReturnType<typeof setTimeout> | null = null;
let diagnosticsViewCount = 0;

export const LSP_DIAGNOSTICS_EVENT = "acode:lsp-diagnostics-updated";
const PULL_DIAGNOSTICS_DELAY = 250;

interface PullDiagnosticsState {
	timers: Map<string, ReturnType<typeof setTimeout>>;
	generations: Map<string, number>;
	resultIds: Map<string, string>;
	failures: Map<string, number>;
}

const pullDiagnosticsStates = new WeakMap<LSPClient, PullDiagnosticsState>();

function getPullDiagnosticsState(client: LSPClient): PullDiagnosticsState {
	let state = pullDiagnosticsStates.get(client);
	if (!state) {
		state = {
			timers: new Map(),
			generations: new Map(),
			resultIds: new Map(),
			failures: new Map(),
		};
		pullDiagnosticsStates.set(client, state);
	}
	return state;
}

function supportsPullDiagnostics(client: LSPClient): boolean {
	return !!client.serverCapabilities?.diagnosticProvider;
}

function isCoarsePointerDevice(): boolean {
	if (typeof window !== "undefined") {
		try {
			if (window.matchMedia?.("(pointer: coarse)").matches) {
				return true;
			}
		} catch (_) {
			// Ignore matchMedia failures and fall back to maxTouchPoints.
		}
	}

	return (
		typeof navigator !== "undefined" &&
		Number(navigator.maxTouchPoints || 0) > 0
	);
}

function emitDiagnosticsUpdated(): void {
	if (
		typeof document === "undefined" ||
		typeof document.dispatchEvent !== "function"
	) {
		return;
	}

	let event: CustomEvent | Event;
	try {
		event = new CustomEvent(LSP_DIAGNOSTICS_EVENT);
	} catch (_) {
		try {
			event = document.createEvent("CustomEvent");
			(event as CustomEvent).initCustomEvent(
				LSP_DIAGNOSTICS_EVENT,
				false,
				false,
				undefined,
			);
		} catch (_) {
			return;
		}
	}

	document.dispatchEvent(event);
}

function clearScheduledDiagnosticsUpdated(): void {
	if (diagnosticsEventTimer == null) return;
	clearTimeout(diagnosticsEventTimer);
	diagnosticsEventTimer = null;
}

const lspPublishedDiagnostics = StateField.define<LspDiagnostic[]>({
	create(): LspDiagnostic[] {
		return [];
	},
	update(value: LspDiagnostic[], tr): LspDiagnostic[] {
		for (const effect of tr.effects) {
			if (effect.is(setPublishedDiagnostics)) {
				value = effect.value;
			}
		}
		return value;
	},
});

type DiagnosticSeverity = "error" | "warning" | "info" | "hint";
const severities: DiagnosticSeverity[] = [
	"hint",
	"error",
	"warning",
	"info",
	"hint",
];

function collectLspDiagnostics(
	plugin: LSPPluginAPI,
	diagnostics: RawDiagnostic[],
): LspDiagnostic[] {
	const items: LspDiagnostic[] = [];
	const { syncedDoc } = plugin;

	for (const diagnostic of diagnostics) {
		let from: number;
		let to: number;
		try {
			const mappedFrom = plugin.fromPosition(
				diagnostic.range.start,
				plugin.syncedDoc,
			);
			const mappedTo = plugin.fromPosition(
				diagnostic.range.end,
				plugin.syncedDoc,
			);
			const fromResult = plugin.unsyncedChanges.mapPos(mappedFrom);
			const toResult = plugin.unsyncedChanges.mapPos(mappedTo);
			if (fromResult === null || toResult === null) continue;
			from = fromResult;
			to = toResult;
		} catch (_) {
			continue;
		}
		if (to > syncedDoc.length) continue;

		const severity = severities[diagnostic.severity ?? 0] ?? "info";
		const source = diagnostic.code
			? `${diagnostic.source ? `${diagnostic.source}-` : ""}${diagnostic.code}`
			: undefined;

		items.push({
			from,
			to,
			severity,
			message: diagnostic.message,
			source,
		});
	}

	return items;
}

function storeLspDiagnostics(
	items: LspDiagnostic[],
): StateEffect<LspDiagnostic[]> {
	return setPublishedDiagnostics.of(items);
}

function sameDiagnostics(
	current: readonly LspDiagnostic[],
	next: readonly LspDiagnostic[],
): boolean {
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index++) {
		const left = current[index];
		const right = next[index];
		if (
			left.from !== right.from ||
			left.to !== right.to ||
			left.severity !== right.severity ||
			left.message !== right.message ||
			left.source !== right.source
		) {
			return false;
		}
	}
	return true;
}

function applyDiagnostics(
	client: LSPClient,
	uri: string,
	version: number | undefined,
	rawDiagnostics: RawDiagnostic[],
): boolean {
	const clientWithWorkspace = client as unknown as LSPClientWithWorkspace;
	const file = clientWithWorkspace.workspace.getFile(uri);
	if (!file || (version != null && version !== file.version)) {
		return false;
	}
	const view = file.getView();
	if (!view) return false;
	const plugin = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!plugin) return false;

	const diagnostics = collectLspDiagnostics(plugin, rawDiagnostics);
	const current = view.state.field(lspPublishedDiagnostics, false) ?? [];
	if (sameDiagnostics(current, diagnostics)) {
		return true;
	}

	view.dispatch({
		effects: storeLspDiagnostics(diagnostics),
	});
	scheduleDiagnosticsUpdated();
	return true;
}

async function pullDiagnostics(
	client: LSPClient,
	uri: string,
	generation: number,
): Promise<void> {
	if (!supportsPullDiagnostics(client)) return;

	client.sync();
	const clientWithWorkspace = client as unknown as LSPClientWithWorkspace;
	const file = clientWithWorkspace.workspace.getFile(uri);
	if (!file) return;

	const state = getPullDiagnosticsState(client);
	const version = file.version;
	const provider = client.serverCapabilities?.diagnosticProvider;
	const params: DocumentDiagnosticParams = {
		textDocument: { uri },
	};
	if (
		provider &&
		typeof provider === "object" &&
		"identifier" in provider &&
		typeof provider.identifier === "string"
	) {
		params.identifier = provider.identifier;
	}
	const previousResultId = state.resultIds.get(uri);
	if (previousResultId !== undefined) {
		params.previousResultId = previousResultId;
	}

	try {
		const report = await client.request<
			DocumentDiagnosticParams,
			DocumentDiagnosticReport
		>("textDocument/diagnostic", params);
		if (state.generations.get(uri) !== generation) return;
		state.failures.delete(uri);

		const currentFile = clientWithWorkspace.workspace.getFile(uri);
		if (!currentFile || currentFile.version !== version) {
			schedulePullDiagnostics(client, uri, 0);
			return;
		}

		if (report.kind === "unchanged") {
			state.resultIds.set(uri, report.resultId);
			return;
		}

		if (typeof report.resultId === "string") {
			state.resultIds.set(uri, report.resultId);
		} else {
			state.resultIds.delete(uri);
		}
		applyDiagnostics(client, uri, version, report.items);
	} catch (error) {
		if (state.generations.get(uri) === generation) {
			const message =
				error instanceof Error ? error.message : String(error);
			const failures = (state.failures.get(uri) ?? 0) + 1;
			state.failures.set(uri, failures);
			if (/timed out/i.test(message) && failures <= 2) {
				schedulePullDiagnostics(client, uri, failures * 750);
				return;
			}
			addLspLogFor(
				client,
				"warn",
				`Diagnostic pull failed for ${uri}: ${message}`,
				error,
			);
			console.warn(`[LSP:Diagnostics] Pull failed for ${uri}`, error);
		}
	}
}

export function schedulePullDiagnostics(
	client: LSPClient,
	uri: string,
	delay = PULL_DIAGNOSTICS_DELAY,
): void {
	if (!supportsPullDiagnostics(client)) {
		if (client.connected && !client.serverCapabilities) {
			void client.initializing
				.then(() => {
					schedulePullDiagnostics(client, uri, delay);
				})
				.catch(() => {});
		}
		return;
	}

	const state = getPullDiagnosticsState(client);
	const existing = state.timers.get(uri);
	if (existing != null) clearTimeout(existing);

	const generation = (state.generations.get(uri) ?? 0) + 1;
	state.generations.set(uri, generation);
	state.timers.set(
		uri,
		setTimeout(() => {
			state.timers.delete(uri);
			void pullDiagnostics(client, uri, generation);
		}, Math.max(0, delay)),
	);
}

export function schedulePullDiagnosticsForOpenFiles(
	client: LSPClient,
	delay = 0,
): void {
	if (!supportsPullDiagnostics(client)) return;
	for (const file of client.workspace.files) {
		schedulePullDiagnostics(client, file.uri, delay);
	}
}

export function forgetPullDiagnostics(client: LSPClient, uri: string): void {
	const state = pullDiagnosticsStates.get(client);
	if (!state) return;
	const timer = state.timers.get(uri);
	if (timer != null) clearTimeout(timer);
	state.timers.delete(uri);
	state.generations.delete(uri);
	state.resultIds.delete(uri);
	state.failures.delete(uri);
}

export function disposePullDiagnostics(client: LSPClient): void {
	const state = pullDiagnosticsStates.get(client);
	if (!state) return;
	for (const timer of state.timers.values()) {
		clearTimeout(timer);
	}
	state.generations.clear();
	state.failures.clear();
	pullDiagnosticsStates.delete(client);
}

export function lspDiagnosticsAutoSyncExtension(
	client: LSPClient,
	uri: string,
): Extension {
	return ViewPlugin.fromClass(
		class {
			pending: ReturnType<typeof setTimeout> | null = null;

			constructor() {
				schedulePullDiagnostics(client, uri, 0);
			}

			update(update: ViewUpdate): void {
				if (!update.docChanged) return;
				if (this.pending != null) clearTimeout(this.pending);
				this.pending = setTimeout(() => {
					this.pending = null;
					client.sync();
					schedulePullDiagnostics(client, uri, 0);
				}, 500);
			}

			destroy(): void {
				if (this.pending != null) clearTimeout(this.pending);
			}
		},
	);
}

function scheduleDiagnosticsUpdated(): void {
	if (diagnosticsEventTimer != null) return;
	diagnosticsEventTimer = setTimeout(() => {
		diagnosticsEventTimer = null;
		if (diagnosticsViewCount > 0) {
			emitDiagnosticsUpdated();
		}
	}, 32);
}

const diagnosticsLifecyclePlugin = ViewPlugin.fromClass(
	class {
		constructor() {
			diagnosticsViewCount++;
		}

		destroy(): void {
			diagnosticsViewCount = Math.max(0, diagnosticsViewCount - 1);
			if (!diagnosticsViewCount) {
				clearScheduledDiagnosticsUpdated();
			}
		}
	},
);

function mapDiagnostics(
	plugin: LSPPluginAPI,
	state: EditorState,
): Diagnostic[] {
	const stored = state.field(lspPublishedDiagnostics);
	const changes = plugin.unsyncedChanges;
	const mapped: Diagnostic[] = [];

	for (const diagnostic of stored) {
		let from: number | null;
		let to: number | null;
		try {
			from = changes.mapPos(diagnostic.from, 1, MapMode.TrackDel);
			to = changes.mapPos(diagnostic.to, -1, MapMode.TrackDel);
		} catch (_) {
			continue;
		}
		if (from != null && to != null) {
			mapped.push({ ...diagnostic, from, to });
		}
	}

	return mapped;
}

function lspLinterSource(view: EditorView): Diagnostic[] {
	const plugin = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!plugin) return [];
	return mapDiagnostics(plugin, view.state);
}

export function lspDiagnosticsClientExtension(): {
	clientCapabilities: Record<string, unknown>;
	notificationHandlers: Record<
		string,
		(client: LSPClient, params: unknown) => boolean
	>;
} {
	return {
		clientCapabilities: {
			textDocument: {
				publishDiagnostics: {
					relatedInformation: true,
					codeDescriptionSupport: true,
					dataSupport: true,
					versionSupport: true,
				},
				diagnostic: {
					dynamicRegistration: false,
					relatedDocumentSupport: false,
				},
			},
			workspace: {
				diagnostics: {
					refreshSupport: true,
				},
			},
		},
		notificationHandlers: {
			"textDocument/publishDiagnostics": (
				client: LSPClient,
				rawParams: unknown,
			): boolean => {
				const params = rawParams as PublishDiagnosticsParams;
				applyDiagnostics(
					client,
					params.uri,
					params.version,
					params.diagnostics,
				);
				return true;
			},
			"workspace/diagnostic/refresh": (client: LSPClient): boolean => {
				schedulePullDiagnosticsForOpenFiles(client);
				return true;
			},
		},
	};
}

export function lspDiagnosticsUiExtension(includeGutter = true): Extension[] {
	const diagnosticsMarkerFilter = isCoarsePointerDevice()
		? () => []
		: undefined;
	const diagnosticsTooltipFilter = isCoarsePointerDevice()
		? () => []
		: undefined;
	const extensions: Extension[] = [
		diagnosticsLifecyclePlugin,
		lspPublishedDiagnostics,
		linter(lspLinterSource, {
			needsRefresh(update) {
				return update.transactions.some((tr) =>
					tr.effects.some((effect) => effect.is(setPublishedDiagnostics)),
				);
			},
			markerFilter: diagnosticsMarkerFilter,
			tooltipFilter: diagnosticsTooltipFilter,
			// keep panel closed by default
			autoPanel: false,
		}),
	];
	if (includeGutter) {
		extensions.splice(
			1,
			0,
			lintGutter({
				tooltipFilter: diagnosticsTooltipFilter,
			}),
		);
	}
	return extensions;
}

interface DiagnosticsExtension {
	clientCapabilities: Record<string, unknown>;
	notificationHandlers: Record<
		string,
		(client: LSPClient, params: unknown) => boolean
	>;
	editorExtension: Extension[];
}

export function lspDiagnosticsExtension(
	includeGutter = true,
): DiagnosticsExtension {
	return {
		...lspDiagnosticsClientExtension(),
		editorExtension: lspDiagnosticsUiExtension(includeGutter),
	};
}

export default lspDiagnosticsExtension;

export function clearDiagnosticsEffect(): StateEffect<LspDiagnostic[]> {
	return setPublishedDiagnostics.of([]);
}

export function getLspDiagnostics(state: EditorState | null): LspDiagnostic[] {
	if (!state || typeof state.field !== "function") return [];
	try {
		const stored = state.field(lspPublishedDiagnostics, false);
		if (!stored || !Array.isArray(stored)) return [];
		return stored.map((diagnostic) => ({ ...diagnostic }));
	} catch (_) {
		return [];
	}
}
