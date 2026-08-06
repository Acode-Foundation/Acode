// @vitest-environment happy-dom

import {CompletionContext} from "@codemirror/autocomplete";
import {forEachDiagnostic} from "@codemirror/lint";
import {Compartment} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {
	LSPClient,
	LSPPlugin,
	Workspace,
	serverCompletionSource,
	serverDiagnostics,
} from "@codemirror/lsp-client";
import {
	getLspDiagnostics,
	lspDiagnosticsAutoSyncExtension,
	lspDiagnosticsClientExtension,
	lspDiagnosticsUiExtension,
	schedulePullDiagnostics,
} from "cm/lsp/diagnostics";
import {afterEach, describe, expect, it, vi} from "vitest";

const views = [];

afterEach(() => {
	while (views.length) views.pop().destroy();
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class TestWorkspace extends Workspace {
	files = [];
	opened = 0;
	closed = 0;

	openFile(uri, languageId, view) {
		this.opened++;
		this.files.push({
			uri,
			languageId,
			version: 0,
			doc: view.state.doc,
			getView: () => view,
		});
	}

	closeFile(uri, view) {
		const index = this.files.findIndex(
			(file) => file.uri === uri && file.getView() === view,
		);
		if (index >= 0) {
			this.closed++;
			this.files.splice(index, 1);
		}
	}

	syncFiles() {
		const updates = [];
		for (const file of this.files) {
			const view = file.getView();
			const plugin = LSPPlugin.get(view, this.client);
			if (!plugin) continue;
			const changes = plugin.unsyncedChanges;
			if (changes.empty) continue;
			const prevDoc = file.doc;
			file.doc = changes.apply(prevDoc);
			file.version++;
			plugin.clear();
			updates.push({file, prevDoc, changes});
		}
		return updates;
	}
}

function client() {
	return new LSPClient({workspace: (lspClient) => new TestWorkspace(lspClient)});
}

function editor(doc, extensions) {
	const view = new EditorView({
		doc,
		extensions,
		parent: document.body,
	});
	views.push(view);
	return view;
}

describe("multiple LSP clients on one editor", () => {
	it("tracks one change stream with an independent sync checkpoint per client", () => {
		const primary = client();
		const supplemental = client();
		const bindings = new Compartment();
		const uri = "file:///workspace/example.ts";
		const primaryBinding = primary.plugin(uri, "typescript", {priority: 100});
		const supplementalBinding = supplemental.plugin(uri, "typescript", {
			priority: 20,
			features: {formatting: false, rename: false},
		});
		const view = editor(
			"const value = 1",
			bindings.of([supplementalBinding, primaryBinding]),
		);

		expect(LSPPlugin.getAll(view).map((plugin) => plugin.client)).toEqual([
			primary,
			supplemental,
		]);
		expect(LSPPlugin.getForFeature(view, "formatting")?.client).toBe(primary);
		expect(LSPPlugin.get(view, supplemental)?.client).toBe(supplemental);

		view.dispatch({changes: {from: view.state.doc.length, insert: ";"}});
		const firstText = view.state.doc.toString();
		expect(LSPPlugin.get(view, primary).unsyncedChanges.apply(
			primary.workspace.files[0].doc,
		).toString()).toBe(firstText);
		expect(LSPPlugin.get(view, supplemental).unsyncedChanges.apply(
			supplemental.workspace.files[0].doc,
		).toString()).toBe(firstText);

		expect(primary.workspace.syncFiles()).toHaveLength(1);
		expect(LSPPlugin.get(view, primary).unsyncedChanges.empty).toBe(true);
		expect(LSPPlugin.get(view, supplemental).unsyncedChanges.empty).toBe(false);

		view.dispatch({changes: {from: 0, insert: "export "}});
		expect(LSPPlugin.get(view, supplemental).unsyncedChanges.apply(
			supplemental.workspace.files[0].doc,
		).toString()).toBe(view.state.doc.toString());
		expect(supplemental.workspace.syncFiles()).toHaveLength(1);
		expect(LSPPlugin.get(view, supplemental).unsyncedChanges.empty).toBe(true);

		view.dispatch({
			effects: bindings.reconfigure(primaryBinding),
		});
		expect(LSPPlugin.getAll(view)).toHaveLength(1);
		expect(supplemental.workspace.closed).toBe(1);
		expect(primary.workspace.closed).toBe(0);

		view.destroy();
		views.pop();
		expect(primary.workspace.closed).toBe(1);
	});

	it("merges completion providers by priority and isolates failures", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const primary = client();
		const supplemental = client();
		const failing = client();
		primary.serverCapabilities = {completionProvider: {}};
		supplemental.serverCapabilities = {completionProvider: {}};
		failing.serverCapabilities = {completionProvider: {}};
		primary.sync = vi.fn();
		supplemental.sync = vi.fn();
		failing.sync = vi.fn();
		primary.request = vi.fn().mockResolvedValue([
			{label: "typescriptItem", detail: "TypeScript"},
			{label: "sharedItem"},
		]);
		supplemental.request = vi.fn().mockResolvedValue([
			{label: "tailwindItem", detail: "Tailwind CSS"},
			{label: "sharedItem"},
		]);
		failing.request = vi.fn().mockRejectedValue(new Error("server unavailable"));

		const view = editor("di", [
			primary.plugin("file:///workspace/example.tsx", "typescriptreact", {
				priority: 100,
			}),
			supplemental.plugin("file:///workspace/example.tsx", "typescriptreact", {
				priority: 50,
			}),
			failing.plugin("file:///workspace/example.tsx", "typescriptreact", {
				priority: 10,
			}),
		]);
		const context = new CompletionContext(
			view.state,
			view.state.doc.length,
			true,
			view,
		);

		const result = await serverCompletionSource(context);
		expect(result.options.map((option) => option.label)).toEqual([
			"typescriptItem",
			"sharedItem",
			"tailwindItem",
		]);
		expect(primary.request).toHaveBeenCalledOnce();
		expect(supplemental.request).toHaveBeenCalledOnce();
		expect(failing.request).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			"[lsp] Completion provider failed",
			expect.objectContaining({message: "server unavailable"}),
		);
	});

	it("does not query a client when completion is disabled for its binding", async () => {
		const primary = client();
		const diagnosticsOnly = client();
		primary.serverCapabilities = {completionProvider: {}};
		diagnosticsOnly.serverCapabilities = {completionProvider: {}};
		primary.sync = vi.fn();
		diagnosticsOnly.sync = vi.fn();
		primary.request = vi.fn().mockResolvedValue([{label: "primaryItem"}]);
		diagnosticsOnly.request = vi.fn().mockResolvedValue([{label: "wrongItem"}]);
		const view = editor("x", [
			primary.plugin("file:///workspace/example.ts", "typescript"),
			diagnosticsOnly.plugin("file:///workspace/example.ts", "typescript", {
				features: {completion: false},
			}),
		]);

		const result = await serverCompletionSource(
			new CompletionContext(view.state, 1, true, view),
		);
		expect(result.options.map((option) => option.label)).toEqual(["primaryItem"]);
		expect(diagnosticsOnly.request).not.toHaveBeenCalled();
	});

	it("keeps diagnostics from each server when another server publishes", () => {
		const primary = client();
		const supplemental = client();
		const diagnosticsExtension = serverDiagnostics();
		const view = editor("const x = 1", [
			primary.plugin("file:///workspace/example.ts", "typescript"),
			supplemental.plugin("file:///workspace/example.ts", "typescript"),
			diagnosticsExtension.editorExtension,
		]);
		const publish =
			diagnosticsExtension.notificationHandlers[
				"textDocument/publishDiagnostics"
			];
		const diagnostic = (message, character) => ({
			message,
			severity: 2,
			range: {
				start: {line: 0, character},
				end: {line: 0, character: character + 1},
			},
		});

		publish(primary, {
			uri: "file:///workspace/example.ts",
			version: 0,
			diagnostics: [diagnostic("TypeScript", 6)],
		});
		publish(supplemental, {
			uri: "file:///workspace/example.ts",
			version: 0,
			diagnostics: [diagnostic("Tailwind CSS", 8)],
		});
		const messages = [];
		forEachDiagnostic(view.state, (item) => messages.push(item.message));
		expect(messages).toEqual(["TypeScript", "Tailwind CSS"]);

		publish(primary, {
			uri: "file:///workspace/example.ts",
			version: 0,
			diagnostics: [],
		});
		const remaining = [];
		forEachDiagnostic(view.state, (item) => remaining.push(item.message));
		expect(remaining).toEqual(["Tailwind CSS"]);
	});

	it("does not synchronize a server whose diagnostics feature is disabled", async () => {
		vi.useFakeTimers();
		const enabled = client();
		const disabled = client();
		enabled.sync = vi.fn();
		disabled.sync = vi.fn();
		const uri = "file:///workspace/example.ts";
		const view = editor("const x = 1", [
			enabled.plugin(uri, "typescript"),
			disabled.plugin(uri, "typescript", {
				features: {diagnostics: false},
			}),
			lspDiagnosticsAutoSyncExtension(),
		]);

		await vi.advanceTimersByTimeAsync(0);
		expect(enabled.sync).toHaveBeenCalledOnce();
		expect(disabled.sync).not.toHaveBeenCalled();

		view.dispatch({changes: {from: view.state.doc.length, insert: ";"}});
		await vi.advanceTimersByTimeAsync(500);
		expect(enabled.sync).toHaveBeenCalledTimes(2);
		expect(disabled.sync).not.toHaveBeenCalled();
	});

	it("rejects pull and push diagnostics from a disabled provider", () => {
		const disabled = client();
		disabled.serverCapabilities = {diagnosticProvider: {}};
		disabled.request = vi.fn();
		const uri = "file:///workspace/example.ts";
		const view = editor("const x = 1", [
			disabled.plugin(uri, "typescript", {
				features: {diagnostics: false},
			}),
			lspDiagnosticsUiExtension(false),
		]);

		schedulePullDiagnostics(disabled, uri, 0);
		expect(disabled.request).not.toHaveBeenCalled();

		const publish =
			lspDiagnosticsClientExtension().notificationHandlers[
				"textDocument/publishDiagnostics"
			];
		publish(disabled, {
			uri,
			version: 0,
			diagnostics: [
				{
					message: "must stay hidden",
					severity: 2,
					range: {
						start: {line: 0, character: 6},
						end: {line: 0, character: 7},
					},
				},
			],
		});
		expect(getLspDiagnostics(view.state)).toEqual([]);
	});
});
