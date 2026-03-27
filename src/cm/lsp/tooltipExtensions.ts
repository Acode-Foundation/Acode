import {
	highlightingFor,
	type Language,
	language as languageFacet,
} from "@codemirror/language";
import { LSPPlugin } from "@codemirror/lsp-client";
import {
	type Extension,
	Prec,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	type Command,
	closeHoverTooltips,
	EditorView,
	hasHoverTooltips,
	hoverTooltip,
	type KeyBinding,
	keymap,
	showTooltip,
	type Tooltip,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { highlightCode } from "@lezer/highlight";
import type {
	HoverParams,
	SignatureHelpContext,
	SignatureHelpParams,
} from "vscode-languageserver-protocol";
import type {
	Hover,
	SignatureHelp as LspSignatureHelp,
	MarkedString,
	MarkupContent,
} from "vscode-languageserver-types";

interface LspClientInternals {
	config?: {
		highlightLanguage?: (language: string) => Language | null | undefined;
	};
	hasCapability?: (name: string) => boolean;
}

const SIGNATURE_TRIGGER_DELAY = 120;
const SIGNATURE_RETRIGGER_DELAY = 250;

function fromPosition(
	doc: EditorView["state"]["doc"],
	position: { line: number; character: number },
): number {
	const line = doc.line(position.line + 1);
	return Math.min(line.to, line.from + position.character);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (match) => {
		switch (match) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

function renderCode(plugin: LSPPlugin, code: MarkedString): string {
	const client = plugin.client as typeof plugin.client & LspClientInternals;

	if (typeof code === "string") {
		return plugin.docToHTML(code, "markdown");
	}

	const { language, value } = code;
	let lang = client.config?.highlightLanguage?.(language || "") ?? undefined;

	if (!lang) {
		const viewLang = plugin.view.state.facet(languageFacet);
		if (viewLang && (!language || viewLang.name === language)) {
			lang = viewLang;
		}
	}

	if (!lang) return escapeHtml(value);

	let result = "";
	highlightCode(
		value,
		lang.parser.parse(value),
		{ style: (tags) => highlightingFor(plugin.view.state, tags) },
		(text, cls) => {
			result += cls
				? `<span class="${cls}">${escapeHtml(text)}</span>`
				: escapeHtml(text);
		},
		() => {
			result += "<br>";
		},
	);
	return result;
}

function renderTooltipContent(
	plugin: LSPPlugin,
	value: string | MarkupContent | MarkedString | MarkedString[],
): string {
	if (Array.isArray(value)) {
		return value.map((item) => renderCode(plugin, item)).join("<br>");
	}

	if (
		typeof value === "string" ||
		(typeof value === "object" && value != null && "language" in value)
	) {
		return renderCode(plugin, value);
	}

	return plugin.docToHTML(value);
}

function isPointerOrTouchSelection(update: ViewUpdate): boolean {
	return (
		update.selectionSet &&
		update.transactions.some(
			(tr) =>
				tr.isUserEvent("pointer") ||
				tr.isUserEvent("select.pointer") ||
				tr.isUserEvent("touch") ||
				tr.isUserEvent("select.touch"),
		)
	);
}

function closeHoverIfNeeded(view: EditorView): void {
	if (hasHoverTooltips(view.state)) {
		view.dispatch({ effects: closeHoverTooltips });
	}
}

function hoverRequest(plugin: LSPPlugin, pos: number) {
	const client = plugin.client as typeof plugin.client & LspClientInternals;
	if (client.hasCapability?.("hoverProvider") === false) {
		return Promise.resolve(null);
	}

	plugin.client.sync();
	return plugin.client.request<HoverParams, Hover | null>(
		"textDocument/hover",
		{
			position: plugin.toPosition(pos),
			textDocument: { uri: plugin.uri },
		},
	);
}

function lspTooltipSource(
	view: EditorView,
	pos: number,
): Promise<Tooltip | null> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return Promise.resolve(null);

	return hoverRequest(plugin, pos).then((result) => {
		if (!result) return null;

		return {
			pos: result.range
				? fromPosition(view.state.doc, result.range.start)
				: pos,
			end: result.range ? fromPosition(view.state.doc, result.range.end) : pos,
			create() {
				const dom = document.createElement("div");
				dom.className = "cm-lsp-hover-tooltip cm-lsp-documentation";
				dom.innerHTML = renderTooltipContent(plugin, result.contents);
				return { dom };
			},
			above: true,
		};
	});
}

const closeHoverOnInteraction = ViewPlugin.fromClass(
	class {
		constructor(readonly view: EditorView) {}
	},
	{
		eventObservers: {
			pointerdown() {
				closeHoverIfNeeded(this.view);
			},
			touchstart() {
				closeHoverIfNeeded(this.view);
			},
			wheel() {
				closeHoverIfNeeded(this.view);
			},
			scroll() {
				closeHoverIfNeeded(this.view);
			},
		},
	},
);

function getSignatureHelp(
	plugin: LSPPlugin,
	pos: number,
	context: SignatureHelpContext,
) {
	const client = plugin.client as typeof plugin.client & LspClientInternals;
	if (client.hasCapability?.("signatureHelpProvider") === false) {
		return Promise.resolve(null);
	}

	plugin.client.sync();
	return plugin.client.request<SignatureHelpParams, LspSignatureHelp | null>(
		"textDocument/signatureHelp",
		{
			context,
			position: plugin.toPosition(pos),
			textDocument: { uri: plugin.uri },
		},
	);
}

function sameSignatures(a: LspSignatureHelp, b: LspSignatureHelp): boolean {
	if (a.signatures.length !== b.signatures.length) return false;
	return a.signatures.every((signature, index) => {
		return signature.label === b.signatures[index]?.label;
	});
}

function sameActiveParam(
	a: LspSignatureHelp,
	b: LspSignatureHelp,
	active: number,
): boolean {
	const current = a.signatures[active];
	const next = b.signatures[active];
	if (!current || !next) return false;

	return (
		(current.activeParameter ?? a.activeParameter) ===
		(next.activeParameter ?? b.activeParameter)
	);
}

class SignatureState {
	constructor(
		readonly data: LspSignatureHelp,
		readonly active: number,
		readonly tooltip: Tooltip,
	) {}
}

const signatureEffect = StateEffect.define<{
	data: LspSignatureHelp;
	active: number;
	pos: number;
} | null>();

function signatureTooltip(
	data: LspSignatureHelp,
	active: number,
	pos: number,
): Tooltip {
	return {
		pos,
		above: true,
		create: (view) => drawSignatureTooltip(view, data, active),
	};
}

const signatureState = StateField.define<SignatureState | null>({
	create() {
		return null;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(signatureEffect)) {
				if (effect.value) {
					return new SignatureState(
						effect.value.data,
						effect.value.active,
						signatureTooltip(
							effect.value.data,
							effect.value.active,
							effect.value.pos,
						),
					);
				}
				return null;
			}
		}

		if (value && tr.docChanged) {
			return new SignatureState(value.data, value.active, {
				...value.tooltip,
				pos: tr.changes.mapPos(value.tooltip.pos),
			});
		}

		return value;
	},
	provide: (field) =>
		showTooltip.from(field, (value) => value?.tooltip ?? null),
});

function drawSignatureTooltip(
	view: EditorView,
	data: LspSignatureHelp,
	active: number,
) {
	const dom = document.createElement("div");
	dom.className = "cm-lsp-signature-tooltip";

	if (data.signatures.length > 1) {
		dom.classList.add("cm-lsp-signature-multiple");
		const num = dom.appendChild(document.createElement("div"));
		num.className = "cm-lsp-signature-num";
		num.textContent = `${active + 1}/${data.signatures.length}`;
	}

	const signature = data.signatures[active];
	if (!signature) {
		return { dom };
	}

	const sig = dom.appendChild(document.createElement("div"));
	sig.className = "cm-lsp-signature";
	let activeFrom = 0;
	let activeTo = 0;
	const activeParamIndex = signature.activeParameter ?? data.activeParameter;
	const activeParam =
		activeParamIndex != null && signature.parameters
			? signature.parameters[activeParamIndex]
			: null;

	if (activeParam && Array.isArray(activeParam.label)) {
		[activeFrom, activeTo] = activeParam.label;
	} else if (activeParam) {
		const found = signature.label.indexOf(activeParam.label as string);
		if (found > -1) {
			activeFrom = found;
			activeTo = found + activeParam.label.length;
		}
	}

	if (activeTo) {
		sig.appendChild(
			document.createTextNode(signature.label.slice(0, activeFrom)),
		);
		const activeElt = sig.appendChild(document.createElement("span"));
		activeElt.className = "cm-lsp-active-parameter";
		activeElt.textContent = signature.label.slice(activeFrom, activeTo);
		sig.appendChild(document.createTextNode(signature.label.slice(activeTo)));
	} else {
		sig.textContent = signature.label;
	}

	if (signature.documentation) {
		const plugin = LSPPlugin.get(view);
		if (plugin) {
			const docs = dom.appendChild(document.createElement("div"));
			docs.className = "cm-lsp-signature-documentation cm-lsp-documentation";
			docs.innerHTML = plugin.docToHTML(signature.documentation);
		}
	}

	return { dom };
}

const signaturePlugin = ViewPlugin.fromClass(
	class {
		activeRequest: { pos: number; drop: boolean } | null = null;
		delayedRequest = 0;

		constructor(readonly view: EditorView) {}

		update(update: ViewUpdate) {
			const pointerOrTouchSelection = isPointerOrTouchSelection(update);

			if (this.activeRequest) {
				if (update.selectionSet) {
					this.activeRequest.drop = true;
					this.activeRequest = null;
				} else if (update.docChanged) {
					this.activeRequest.pos = update.changes.mapPos(
						this.activeRequest.pos,
					);
				}
			}

			const plugin = LSPPlugin.get(update.view);
			if (!plugin) return;

			const sigState = update.view.state.field(signatureState);
			let triggerCharacter = "";

			if (
				update.docChanged &&
				update.transactions.some((tr) => tr.isUserEvent("input.type"))
			) {
				const serverConf =
					plugin.client.serverCapabilities?.signatureHelpProvider;
				const triggers = (serverConf?.triggerCharacters || []).concat(
					(sigState && serverConf?.retriggerCharacters) || [],
				);

				if (triggers.length) {
					update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
						const insertedText = inserted.toString();
						if (!insertedText) return;
						for (const trigger of triggers) {
							if (insertedText.includes(trigger)) {
								triggerCharacter = trigger;
							}
						}
					});
				}
			}

			if (triggerCharacter) {
				this.scheduleRequest(
					plugin,
					{
						triggerKind: 2,
						isRetrigger: !!sigState,
						triggerCharacter,
						activeSignatureHelp: sigState?.data,
					},
					SIGNATURE_TRIGGER_DELAY,
				);
			} else if (sigState && update.selectionSet && !pointerOrTouchSelection) {
				this.scheduleRequest(
					plugin,
					{
						triggerKind: 3,
						isRetrigger: true,
						activeSignatureHelp: sigState.data,
					},
					SIGNATURE_RETRIGGER_DELAY,
				);
			}
		}

		scheduleRequest(
			plugin: LSPPlugin,
			context: SignatureHelpContext,
			delay: number,
		) {
			if (this.delayedRequest) {
				clearTimeout(this.delayedRequest);
			}
			this.delayedRequest = window.setTimeout(() => {
				this.delayedRequest = 0;
				this.startRequest(plugin, context);
			}, delay);
		}

		startRequest(plugin: LSPPlugin, context: SignatureHelpContext) {
			if (this.delayedRequest) {
				clearTimeout(this.delayedRequest);
				this.delayedRequest = 0;
			}

			const { view } = plugin;
			const pos = view.state.selection.main.head;

			if (this.activeRequest) this.activeRequest.drop = true;
			const request = (this.activeRequest = { pos, drop: false });

			getSignatureHelp(plugin, pos, context).then(
				(result) => {
					if (request.drop) return;

					if (result && result.signatures.length) {
						const current = view.state.field(signatureState);
						const same = current && sameSignatures(current.data, result);
						const active =
							same && context.triggerKind === 3
								? current!.active
								: (result.activeSignature ?? 0);

						if (same && sameActiveParam(current!.data, result, active)) return;

						view.dispatch({
							effects: signatureEffect.of({
								data: result,
								active,
								pos: same ? current!.tooltip.pos : request.pos,
							}),
						});
					} else if (view.state.field(signatureState, false)) {
						view.dispatch({ effects: signatureEffect.of(null) });
					}
				},
				context.triggerKind === 1
					? (error) => plugin.reportError("Signature request failed", error)
					: undefined,
			);
		}

		close() {
			if (this.delayedRequest) {
				clearTimeout(this.delayedRequest);
				this.delayedRequest = 0;
			}
			if (this.activeRequest) {
				this.activeRequest.drop = true;
				this.activeRequest = null;
			}
			if (this.view.state.field(signatureState, false)) {
				this.view.dispatch({ effects: signatureEffect.of(null) });
			}
		}

		destroy() {
			this.close();
		}
	},
	{
		eventObservers: {
			pointerdown() {
				this.close();
			},
			touchstart() {
				this.close();
			},
			wheel() {
				this.close();
			},
			scroll() {
				this.close();
			},
		},
	},
);

export const showSignatureHelp: Command = (view) => {
	let plugin = view.plugin(signaturePlugin);
	if (!plugin) {
		view.dispatch({
			effects: StateEffect.appendConfig.of([signatureState, signaturePlugin]),
		});
		plugin = view.plugin(signaturePlugin);
	}

	const field = view.state.field(signatureState);
	if (!plugin || field === undefined) return false;

	const lspPlugin = LSPPlugin.get(view);
	if (!lspPlugin) return false;

	plugin.startRequest(lspPlugin, {
		triggerKind: 1,
		activeSignatureHelp: field ? field.data : undefined,
		isRetrigger: !!field,
	});
	return true;
};

export const nextSignature: Command = (view) => {
	const field = view.state.field(signatureState, false);
	if (!field) return false;
	if (field.active < field.data.signatures.length - 1) {
		view.dispatch({
			effects: signatureEffect.of({
				data: field.data,
				active: field.active + 1,
				pos: field.tooltip.pos,
			}),
		});
	}
	return true;
};

export const prevSignature: Command = (view) => {
	const field = view.state.field(signatureState, false);
	if (!field) return false;
	if (field.active > 0) {
		view.dispatch({
			effects: signatureEffect.of({
				data: field.data,
				active: field.active - 1,
				pos: field.tooltip.pos,
			}),
		});
	}
	return true;
};

export const signatureKeymap: readonly KeyBinding[] = [
	{ key: "Mod-Shift-Space", run: showSignatureHelp },
	{ key: "Mod-Shift-ArrowUp", run: prevSignature },
	{ key: "Mod-Shift-ArrowDown", run: nextSignature },
];

export function hoverTooltips(config: { hoverTime?: number } = {}): Extension {
	return [
		hoverTooltip(lspTooltipSource, {
			hideOnChange: true,
			hoverTime: config.hoverTime,
		}),
		closeHoverOnInteraction,
	];
}

export function signatureHelp(config: { keymap?: boolean } = {}): Extension {
	return [
		signatureState,
		signaturePlugin,
		config.keymap === false ? [] : Prec.high(keymap.of(signatureKeymap)),
	];
}
