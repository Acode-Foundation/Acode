import { LSPPlugin } from "@codemirror/lsp-client";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import pickColor from "dialogs/color";
import color from "utils/color";
import type { Color as LspColor } from "vscode-languageserver-types";

export const COLOR_CHIP_CLASS = "cm-color-chip";
export const COLOR_CHIP_SOURCE_ATTR = "data-color-source";

export type ColorChipSource = "regex" | "lsp";

export interface ColorChipPayload {
	from: number;
	to: number;
	css: string;
	pickerSeed?: string;
	source: ColorChipSource;
}

const chipState = new WeakMap<HTMLElement, ColorChipPayload>();

export function getColorChipPayload(
	el: HTMLElement | null | undefined,
): ColorChipPayload | undefined {
	if (!el) return undefined;
	return chipState.get(el);
}

export function findColorChip(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Element)) return null;
	return target.closest(`.${COLOR_CHIP_CLASS}`) as HTMLElement | null;
}

export class ColorChipWidget extends WidgetType {
	constructor(readonly payload: ColorChipPayload) {
		super();
	}

	eq(other: ColorChipWidget): boolean {
		return (
			other.payload.from === this.payload.from &&
			other.payload.to === this.payload.to &&
			other.payload.css === this.payload.css &&
			other.payload.source === this.payload.source &&
			(other.payload.pickerSeed || "") === (this.payload.pickerSeed || "")
		);
	}

	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = COLOR_CHIP_CLASS;
		el.setAttribute(COLOR_CHIP_SOURCE_ATTR, this.payload.source);
		el.style.display = "inline-block";
		el.style.width = "0.9em";
		el.style.height = "0.9em";
		el.style.borderRadius = "2px";
		el.style.verticalAlign = "middle";
		el.style.margin = "0 2px";
		el.style.boxSizing = "border-box";
		el.style.border = "1px solid rgba(0,0,0,0.2)";
		el.style.backgroundColor = this.payload.css;
		el.style.cursor = "pointer";
		el.style.userSelect = "none";
		el.title = this.payload.css;
		el.dataset["color"] = this.payload.pickerSeed || this.payload.css;
		el.dataset["colorraw"] = this.payload.css;
		chipState.set(el, this.payload);
		return el;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

export function colorChipDecoration(
	payload: ColorChipPayload,
): Range<Decoration> {
	return Decoration.widget({
		widget: new ColorChipWidget(payload),
		side: -1,
	}).range(payload.from);
}

export function isViewEditable(view: EditorView): boolean {
	const readOnly = view.contentDOM.ariaReadOnly === "true";
	const editable = view.contentDOM.contentEditable === "true";
	return !readOnly && editable;
}

export function hasLspColorProvider(view: EditorView): boolean {
	const lsp = LSPPlugin.get(view) as {
		client?: {
			connected?: boolean;
			serverCapabilities?: { colorProvider?: boolean | object } | null;
		};
	} | null;
	return !!(
		lsp?.client?.connected && lsp.client.serverCapabilities?.colorProvider
	);
}

export async function openColorPicker(seed: string): Promise<string | null> {
	try {
		const picked = await pickColor(seed || "#ffffff");
		return picked || null;
	} catch {
		return null;
	}
}

export function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(1, Math.max(0, n));
}

function channelToByte(n: number): number {
	return Math.round(clamp01(n) * 255);
}

export function lspColorToCss(c: LspColor): string {
	const r = channelToByte(c.red);
	const g = channelToByte(c.green);
	const b = channelToByte(c.blue);
	const a = clamp01(c.alpha ?? 1);
	if (a < 1) {
		const alpha = Number(a.toFixed(3));
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return `rgb(${r}, ${g}, ${b})`;
}

export function lspColorToHex(c: LspColor): string {
	const r = channelToByte(c.red).toString(16).padStart(2, "0");
	const g = channelToByte(c.green).toString(16).padStart(2, "0");
	const b = channelToByte(c.blue).toString(16).padStart(2, "0");
	const a = clamp01(c.alpha ?? 1);
	if (a < 1) {
		const aa = channelToByte(a).toString(16).padStart(2, "0");
		return `#${r}${g}${b}${aa}`;
	}
	return `#${r}${g}${b}`;
}

export function cssToLspColor(css: string): LspColor | null {
	if (!css || typeof css !== "string") return null;
	try {
		const { r, g, b, a } = color(css.trim()).rgb;
		return {
			red: clamp01(r / 255),
			green: clamp01(g / 255),
			blue: clamp01(b / 255),
			alpha: clamp01(a),
		};
	} catch {
		return null;
	}
}

export function detectColorFormat(
	text: string,
): "hex" | "rgb" | "hsl" | "other" {
	const t = text.trim().toLowerCase();
	if (t.startsWith("#")) return "hex";
	if (t.startsWith("rgb")) return "rgb";
	if (t.startsWith("hsl")) return "hsl";
	return "other";
}

export const colorChipTheme = EditorView.baseTheme({
	[`.${COLOR_CHIP_CLASS}`]: {
		userSelect: "none",
	},
});
