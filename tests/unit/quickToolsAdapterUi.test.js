// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

vi.mock("components/quickTools", () => {
	const $footer = document.createElement("footer");
	$footer.innerHTML = `<div><button data-id="search" data-action="search">Search</button><button data-id="move" data-action="command" data-value="movelinesup">Move</button><button data-id="undo">Undo</button><button data-id="redo">Redo</button></div><div></div>`;
	return {
		default: {
			$footer,
			$row1: $footer.children[0],
			$row2: $footer.children[1],
			$input: document.createElement("input"),
			$toggler: document.createElement("button"),
		},
	};
});
vi.mock("cm/commandRegistry", () => ({
	executeCommand: vi.fn(),
	getRegisteredCommands: () => [],
}));
vi.mock("settings/searchSettings", () => ({ default: vi.fn() }));
vi.mock("dialogs/confirm", () => ({ default: vi.fn() }));
// Happy DOM lacks the legacy initKeyboardEvent API used by the app's polyfill.
vi.mock("utils/keyboardEvent", () => ({
	default: (type, init) => new KeyboardEvent(type, init),
}));
vi.mock("lib/settings", () => ({
	default: {
		value: Object.freeze({
			quickTools: 2,
			quicktoolsItems: Object.freeze([5, 20, 3, 4]),
			floatingButton: false,
			quickToolsTriggerMode: "click",
		}),
		QUICKTOOLS_TRIGGER_MODE_CLICK: "click",
		on: vi.fn(),
	},
}));
vi.mock("lib/editorFile", () => ({ syncQuickToolsVisibility: vi.fn() }));
vi.mock("components/quickTools/items", () => ({ description: {} }));
vi.mock("components/tooltip", () => ({
	hideTooltip: vi.fn(),
	showTooltip: vi.fn(),
}));
vi.mock("lib/config", () => ({ default: {} }));
vi.mock("cm/editorReadOnly", () => ({ focusEditorIfEditable: vi.fn() }));
vi.mock("@codemirror/commands", async (importOriginal) => ({
	...(await importOriginal()),
	undoDepth: () => 1,
	redoDepth: () => 0,
}));

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.resetModules();
	vi.clearAllMocks();
	document.body.replaceChildren();
});

async function setup() {
	vi.useFakeTimers();
	const listeners = new Map();
	const manager = {
		activeFile: { type: "editor" },
		editor: { state: {} },
		on(events, listener) {
			for (const event of [events].flat())
				listeners.set(event, [...(listeners.get(event) || []), listener]);
		},
	};
	vi.stubGlobal("editorManager", manager);
	vi.stubGlobal("root", document.body);
	const { default: init } = await import("handlers/quickToolsInit");
	const { default: tools } = await import("components/quickTools");
	const { default: registry } = await import("lib/quickToolsAdapter");
	const { default: settings } = await import("lib/settings");
	const { syncQuickToolsVisibility } = await import("lib/editorFile");
	const { default: actions, key } = await import("handlers/quickTools");
	const { default: stack } = await import("lib/actionStack");
	const switchTab = (tab) => {
		manager.activeFile = tab;
		listeners.get("switch-file").forEach((fn) => fn());
	};
	init();
	vi.runOnlyPendingTimers();
	return {
		tools,
		registry,
		settings,
		syncQuickToolsVisibility,
		switchTab,
		actions,
		key,
		stack,
	};
}

it("keeps stock items and preferences intact through adapter state and tab changes", async () => {
	const { tools, registry, settings, syncQuickToolsVisibility, switchTab } =
		await setup();
	const stock = () =>
		[...tools.$footer.querySelectorAll("[data-action]")].map(
			(button) => button.outerHTML,
		);
	const before = stock(),
		preferences = JSON.stringify(settings.value);
	let state = { enabled: true, busy: false },
		notify;
	const word = { hideQuickTools: true };
	switchTab(word);
	const dispose = registry.register(word, {
		getState: () => state,
		canHandle: (action) => action.command === "redo",
		execute: vi.fn(),
		subscribe: (fn) => {
			notify = fn;
			return () => {};
		},
	});
	expect(syncQuickToolsVisibility).toHaveBeenLastCalledWith(word);
	expect(tools.$footer.querySelector('[data-id="undo"]').disabled).toBe(true);
	expect(tools.$footer.querySelector('[data-id="redo"]').disabled).toBe(false);
	state = { ...state, busy: true };
	notify();
	expect(tools.$footer.querySelector('[data-id="redo"]').disabled).toBe(true);
	expect(stock()).toEqual(before);
	switchTab({ type: "editor" });
	vi.runOnlyPendingTimers();
	expect(tools.$footer.querySelector('[data-id="undo"]').disabled).toBe(false);
	expect(tools.$footer.querySelector('[data-id="redo"]').disabled).toBe(true);
	// Loading another tab must not reuse the previous document's visibility cache.
	const second = { hideQuickTools: true };
	switchTab(second);
	const disposeSecond = registry.register(second, {
		getState: () => ({ enabled: true }),
		canHandle: () => false,
		execute: vi.fn(),
		subscribe: () => () => {},
	});
	expect(syncQuickToolsVisibility).toHaveBeenLastCalledWith(second);
	dispose();
	expect(stock()).toEqual(before);
	expect(JSON.stringify(settings.value)).toBe(preferences);
	disposeSecond();
});

it("routes modifier input and cancels capture on state, overlay, tab and disposal changes without touching the Back stack", async () => {
	const { tools, registry, switchTab, actions, key, stack } = await setup();
	const entry = { id: "navigation", action: vi.fn() };
	stack.push(entry);
	const mutations = ["push", "remove", "pop"].map((method) =>
		vi.spyOn(stack, method),
	);
	const word = {};
	switchTab(word);
	const execute = vi.fn();
	let busy = false,
		notify;
	const dispose = registry.register(word, {
		getState: () => ({ enabled: true, busy }),
		canHandle: () => true,
		subscribe: (listener) => {
			notify = listener;
			return () => {};
		},
		execute,
	});
	expect(actions("ctrl")).toBe(true);
	tools.$input.dispatchEvent(
		new InputEvent("beforeinput", {
			inputType: "insertText",
			data: "c",
			cancelable: true,
		}),
	);
	await vi.advanceTimersByTimeAsync(0);
	expect(execute).toHaveBeenCalledWith(
		expect.objectContaining({ type: "key", key: "c", ctrlKey: true }),
		expect.any(Object),
	);
	expect(key.ctrl).toBe(false);

	const checkCancellation = (transition) => {
		expect(actions("ctrl")).toBe(true);
		tools.$input.value = "pending";
		transition();
		expect(key.ctrl).toBe(false);
		expect(tools.$input.value).toBe("");
	};
	checkCancellation(() => {
		busy = true;
		notify();
	});
	busy = false;
	notify();
	const overlay = document.createElement("div");
	overlay.className = "prompt";
	checkCancellation(() => {
		document.body.append(overlay);
		overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
	});
	overlay.remove();
	document.body.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true }),
	);
	checkCancellation(() => switchTab({ type: "editor" }));
	switchTab(word);
	checkCancellation(dispose);
	expect(stack.length).toBe(1);
	expect(stack.get(entry.id)).toBe(entry);
	mutations.forEach((method) => expect(method).not.toHaveBeenCalled());
});
