import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorView } from "@codemirror/view";
import toast from "components/toast";
import select from "dialogs/select";
import type {
	CodeAction,
	CodeActionContext,
	CodeActionKind,
	Command,
	Diagnostic,
	Range as LspRange,
	WorkspaceEdit,
} from "vscode-languageserver-types";
import type { Position, Range } from "./types";
import type AcodeWorkspace from "./workspace";

type CodeActionResponse = (CodeAction | Command)[] | null;

const CODE_ACTION_KINDS = {
	QUICK_FIX: "quickfix",
	REFACTOR: "refactor",
	REFACTOR_EXTRACT: "refactor.extract",
	REFACTOR_INLINE: "refactor.inline",
	REFACTOR_REWRITE: "refactor.rewrite",
	SOURCE: "source",
	SOURCE_ORGANIZE_IMPORTS: "source.organizeImports",
	SOURCE_FIX_ALL: "source.fixAll",
} as const;

const CODE_ACTION_ICONS: Record<string, string> = {
	quickfix: "build",
	refactor: "code",
	"refactor.extract": "call_split",
	"refactor.inline": "call_merge",
	"refactor.rewrite": "edit",
	source: "settings",
	"source.organizeImports": "sort",
	"source.fixAll": "done_all",
};

function getCodeActionIcon(kind?: CodeActionKind): string {
	if (!kind) return "licons zap";
	for (const [prefix, icon] of Object.entries(CODE_ACTION_ICONS)) {
		if (kind.startsWith(prefix)) return icon;
	}
	return "licons zap";
}

function formatCodeActionKind(kind?: CodeActionKind): string {
	if (!kind) return "";
	return kind
		.split(".")
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" › ");
}

function isCommand(item: CodeAction | Command): item is Command {
	return (
		"command" in item && typeof item.command === "string" && !("edit" in item)
	);
}

function lspPositionToOffset(
	doc: { line: (n: number) => { from: number } },
	pos: Position,
): number {
	return doc.line(pos.line + 1).from + pos.character;
}

async function requestCodeActions(
	plugin: LSPPlugin,
	range: LspRange,
	diagnostics: Diagnostic[] = [],
): Promise<CodeActionResponse> {
	const context: CodeActionContext = {
		diagnostics,
		triggerKind: 1, // CodeActionTriggerKind.Invoked
	};

	return plugin.client.request<
		{
			textDocument: { uri: string };
			range: LspRange;
			context: CodeActionContext;
		},
		CodeActionResponse
	>("textDocument/codeAction", {
		textDocument: { uri: plugin.uri },
		range,
		context,
	});
}

async function resolveCodeAction(
	plugin: LSPPlugin,
	action: CodeAction,
): Promise<CodeAction> {
	// If action already has an edit, no need to resolve
	if (action.edit) return action;

	const capabilities = plugin.client.serverCapabilities;
	const provider = capabilities?.codeActionProvider;
	const supportsResolve =
		typeof provider === "object" &&
		provider !== null &&
		"resolveProvider" in provider &&
		provider.resolveProvider === true;

	if (!supportsResolve) return action;

	// Resolve to get the edit property (lazy computation per LSP 3.16+)
	try {
		const resolved = await plugin.client.request<CodeAction, CodeAction>(
			"codeAction/resolve",
			action,
		);
		return resolved ?? action;
	} catch (error) {
		console.warn("[LSP:CodeAction] Failed to resolve:", error);
		return action;
	}
}

async function executeCommand(
	plugin: LSPPlugin,
	command: Command,
): Promise<boolean> {
	try {
		await plugin.client.request<
			{ command: string; arguments?: unknown[] },
			unknown
		>("workspace/executeCommand", {
			command: command.command,
			arguments: command.arguments,
		});
		return true;
	} catch (error) {
		// -32601 = Method not implemented (expected for some LSP servers)
		const lspError = error as { code?: number };
		if (lspError?.code !== -32601) {
			console.warn("[LSP:CodeAction] Command execution failed:", error);
		}
		return false;
	}
}

interface LspChange {
	range: Range;
	newText: string;
}

async function applyChangesToFile(
	workspace: AcodeWorkspace,
	uri: string,
	changes: LspChange[],
	mapping: { mapPosition: (uri: string, pos: Position) => number },
): Promise<boolean> {
	const file = workspace.getFile(uri);
	if (file) {
		const view = file.getView();
		if (view) {
			view.dispatch({
				changes: changes.map((c) => ({
					from: mapping.mapPosition(uri, c.range.start),
					to: mapping.mapPosition(uri, c.range.end),
					insert: c.newText,
				})),
				userEvent: "codeAction",
			});
			return true;
		}
	}

	const displayedView = await workspace.displayFile(uri);
	if (!displayedView?.state?.doc) {
		console.warn(`[LSP:CodeAction] Could not open file: ${uri}`);
		return false;
	}

	displayedView.dispatch({
		changes: changes.map((c) => ({
			from: lspPositionToOffset(displayedView.state.doc, c.range.start),
			to: lspPositionToOffset(displayedView.state.doc, c.range.end),
			insert: c.newText,
		})),
		userEvent: "codeAction",
	});
	return true;
}

async function applyWorkspaceEdit(
	view: EditorView,
	edit: WorkspaceEdit,
): Promise<boolean> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return false;

	const workspace = plugin.client.workspace as AcodeWorkspace;
	if (!workspace) return false;

	let filesChanged = 0;

	const result = await plugin.client.withMapping(async (mapping) => {
		// Handle simple changes format
		if (edit.changes) {
			for (const uri in edit.changes) {
				const changes = edit.changes[uri] as LspChange[];
				if (
					changes.length &&
					(await applyChangesToFile(workspace, uri, changes, mapping))
				) {
					filesChanged++;
				}
			}
		}

		// Handle documentChanges format (supports versioned edits)
		if (edit.documentChanges) {
			for (const docChange of edit.documentChanges) {
				if ("textDocument" in docChange && "edits" in docChange) {
					const uri = docChange.textDocument.uri;
					const edits = docChange.edits as LspChange[];
					if (
						edits.length &&
						(await applyChangesToFile(workspace, uri, edits, mapping))
					) {
						filesChanged++;
					}
				}
			}
		}
		return filesChanged;
	});

	return (result ?? 0) > 0;
}

/**
 * Apply a code action following the LSP spec:
 * "If both edit and command are supplied, first the edit is applied, then the command is executed"
 */
async function applyCodeAction(
	view: EditorView,
	action: CodeAction,
): Promise<boolean> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return false;

	plugin.client.sync();

	// Resolve to get the edit if not already present
	const resolved = await resolveCodeAction(plugin, action);
	let success = false;

	// Step 1: Apply workspace edit if present
	if (resolved.edit) {
		success = await applyWorkspaceEdit(view, resolved.edit);
	}

	// Step 2: Execute command if present (after edit per LSP spec)
	if (resolved.command) {
		const commandSuccess = await executeCommand(plugin, resolved.command);
		success = success || commandSuccess;
	}

	plugin.client.sync();
	return success;
}

export interface CodeActionItem {
	title: string;
	kind?: CodeActionKind;
	icon: string;
	isPreferred?: boolean;
	disabled?: boolean;
	disabledReason?: string;
	action: CodeAction | Command;
}

export async function fetchCodeActions(
	view: EditorView,
): Promise<CodeActionItem[]> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return [];

	const capabilities = plugin.client.serverCapabilities;
	if (!capabilities?.codeActionProvider) return [];

	const { from, to } = view.state.selection.main;
	const range: LspRange = {
		start: plugin.toPosition(from),
		end: plugin.toPosition(to),
	};

	plugin.client.sync();

	try {
		const response = await requestCodeActions(plugin, range);
		if (!response?.length) return [];

		const items: CodeActionItem[] = response.map((item) => {
			if (isCommand(item)) {
				return { title: item.title, icon: "terminal", action: item };
			}
			return {
				title: item.title,
				kind: item.kind,
				icon: getCodeActionIcon(item.kind),
				isPreferred: item.isPreferred,
				disabled: !!item.disabled,
				disabledReason: item.disabled?.reason,
				action: item,
			};
		});

		// Sort: preferred first, then quickfixes, then alphabetically
		items.sort((a, b) => {
			if (a.isPreferred && !b.isPreferred) return -1;
			if (!a.isPreferred && b.isPreferred) return 1;
			if (a.kind?.startsWith("quickfix") && !b.kind?.startsWith("quickfix"))
				return -1;
			if (!a.kind?.startsWith("quickfix") && b.kind?.startsWith("quickfix"))
				return 1;
			return a.title.localeCompare(b.title);
		});

		return items;
	} catch (error) {
		console.error("[LSP:CodeAction] Failed to fetch:", error);
		return [];
	}
}

export async function executeCodeAction(
	view: EditorView,
	item: CodeActionItem,
): Promise<boolean> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return false;

	try {
		plugin.client.sync();

		// Handle standalone Command (not CodeAction)
		if (isCommand(item.action)) {
			return executeCommand(plugin, item.action);
		}

		// Handle CodeAction
		return applyCodeAction(view, item.action);
	} catch (error) {
		console.error("[LSP:CodeAction] Failed to execute:", error);
		return false;
	}
}

export function supportsCodeActions(view: EditorView): boolean {
	const plugin = LSPPlugin.get(view);
	return !!plugin?.client.serverCapabilities?.codeActionProvider;
}

export async function showCodeActionsMenu(view: EditorView): Promise<boolean> {
	if (!supportsCodeActions(view)) return false;

	const items = await fetchCodeActions(view);
	if (!items.length) {
		toast("No code actions available");
		return false;
	}

	const selectItems = items.map((item, i) => ({
		value: String(i),
		text: item.title,
		icon: item.icon,
		disabled: item.disabled,
	}));

	try {
		const result = await select(
			strings["code actions"] || "Code Actions",
			selectItems as unknown as string[],
			{ hideOnSelect: true },
		);

		if (result !== null && result !== undefined) {
			const index = Number.parseInt(String(result), 10);
			if (!Number.isNaN(index) && index >= 0 && index < items.length) {
				await executeCodeAction(view, items[index]);
				view.focus();
				return true;
			}
		}
	} catch {
		// User cancelled selection
	}

	view.focus();
	return false;
}

export async function performQuickFix(view: EditorView): Promise<boolean> {
	const items = await fetchCodeActions(view);
	if (!items.length) return false;

	// Find preferred action or first quickfix
	const quickFix =
		items.find((i) => i.isPreferred) ??
		items.find((i) => i.kind?.startsWith("quickfix"));

	if (quickFix) {
		return executeCodeAction(view, quickFix);
	}

	// Fall back to showing menu
	return showCodeActionsMenu(view);
}

export { CODE_ACTION_KINDS, getCodeActionIcon, formatCodeActionKind };
