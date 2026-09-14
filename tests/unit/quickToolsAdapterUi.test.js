// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

function mockQuickTools() {
	vi.doMock("components/quickTools", () => {
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
}
vi.mock("cm/commandRegistry", () => ({
	executeCommand: vi.fn(),
	getRegisteredCommands: () => [],
}));
vi.mock("settings/searchSettings", () => ({ default: vi.fn() }));
vi.mock("dialogs/confirm", () => ({ default: vi.fn() }));
// Happy DOM lacks the legacy initKeyboardEvent API used by the app's polyfill.
vi.mock("utils/keyboardEvent", () => ({
	default: (type, init) =>
		new KeyboardEvent(type, {
			...init,
			key: init.key || { 37: "ArrowLeft", 39: "ArrowRight" }[init.keyCode],
		}),
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

const cleanups = [];
afterEach(async () => {
	cleanups.splice(0).forEach((dispose) => dispose());
	document.body.replaceChildren();
	await vi.advanceTimersByTimeAsync(0);
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.resetModules();
	vi.clearAllMocks();
	document.body.replaceChildren();
});

async function setup(triggerMode = "click") {
	vi.useFakeTimers();
	mockQuickTools();
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
	settings.value = { ...settings.value, quickToolsTriggerMode: triggerMode };
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

async function adaptedSetup(triggerMode) {
	const f = await setup(triggerMode);
	const tab = { type: "docs" };
	f.switchTab(tab);
	const editor = document.createElement("textarea");
	editor.value = "0123456789";
	document.body.append(editor);
	editor.focus();
	editor.setSelectionRange(3, 3);
	let state = { enabled: true },
		notify;
	const adapter = {
		getState: () => state,
		canHandle: (action) => action.command !== "unsupported",
		subscribe: (listener) => {
			notify = listener;
			return () => {};
		},
		captureSelection: vi.fn(() => editor.selectionStart),
		restoreSelection: vi.fn((position) =>
			editor.setSelectionRange(position, position),
		),
		execute: vi.fn((action) => {
			if (action.type === "text") editor.setRangeText(action.text);
		}),
		focus: vi.fn(() => editor.focus()),
		cancel: vi.fn(),
	};
	const dispose = f.registry.register(tab, adapter);
	cleanups.push(dispose);
	const button = f.tools.$footer.querySelector('[data-id="move"]');
	button.dataset.action = "insert";
	button.dataset.value = "x";
	const pointer = (type, target = button) =>
		target.dispatchEvent(new PointerEvent(type, { bubbles: true }));
	const click = () =>
		button.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	return {
		...f,
		editor,
		adapter,
		button,
		pointer,
		click,
		dispose,
		setState(value) {
			state = { ...state, ...value };
			notify();
		},
	};
}

it.each([
	"keydown",
	"beforeinput",
	"input",
	"compositionend",
	"composition",
])("finishes %s shortcut capture, absorbs trailing events, and resumes normal typing", async (type) => {
	const f = await adaptedSetup();
	f.actions("ctrl");
	const input = f.tools.$input;
	if (type === "composition") {
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Process", isComposing: true }),
		);
	}
	input.value = "c";
	const event =
		type === "keydown"
			? new KeyboardEvent(type, { key: "c", cancelable: true })
			: new InputEvent(type === "composition" ? "beforeinput" : type, {
					data: "c",
					inputType:
						type === "composition" ? "insertCompositionText" : "insertText",
					isComposing: type === "composition",
					cancelable: true,
				});
	input.dispatchEvent(event);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.adapter.execute).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ type: "key", key: "c", ctrlKey: true }),
		expect.any(Object),
	);
	expect(f.key.ctrl).toBe(false);
	expect(document.activeElement).toBe(f.editor);
	for (const type of ["beforeinput", "input", "compositionend"]) {
		input.value = "c";
		input.dispatchEvent(new InputEvent(type, { data: "c", cancelable: true }));
	}
	for (const text of ["x", "y"]) {
		const target = document.activeElement;
		if (
			target.dispatchEvent(
				new InputEvent("beforeinput", {
					data: text,
					inputType: "insertText",
					cancelable: true,
				}),
			)
		) {
			const caret = target.selectionStart + text.length;
			target.setRangeText(text);
			target.setSelectionRange(caret, caret);
		}
	}
	await vi.advanceTimersByTimeAsync(0);
	expect(f.editor.value).toBe("012xy3456789");
	expect(input.value).toBe("");
	expect(f.adapter.execute).toHaveBeenCalledOnce();
	expect(f.adapter.cancel).not.toHaveBeenCalled();
});

it("completes special keys and toolbar input while preserving modifier arrow repeats", async () => {
	const f = await adaptedSetup();
	for (const key of ["ArrowLeft", "Backspace"]) {
		f.actions("ctrl");
		f.tools.$input.dispatchEvent(
			new KeyboardEvent("keydown", { key, cancelable: true }),
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(f.key.ctrl).toBe(false);
		expect(document.activeElement).toBe(f.editor);
	}
	f.actions("ctrl");
	f.actions("shift");
	f.actions("key", 39);
	f.actions("key", 39);
	await vi.advanceTimersByTimeAsync(0);
	expect(
		f.adapter.execute.mock.calls.slice(-2).map(([action]) => action),
	).toEqual([
		expect.objectContaining({
			key: "ArrowRight",
			ctrlKey: true,
			shiftKey: true,
		}),
		expect.objectContaining({
			key: "ArrowRight",
			ctrlKey: true,
			shiftKey: true,
		}),
	]);
	expect(f.key.ctrl && f.key.shift).toBe(true);
	f.actions("insert", "x");
	await vi.advanceTimersByTimeAsync(0);
	expect(f.key.ctrl || f.key.shift).toBe(false);
	expect(document.activeElement).toBe(f.editor);
	expect(f.adapter.cancel).not.toHaveBeenCalled();
});

it.each([
	"no focus callback",
	"tab switch",
	"overlay",
	"busy",
	"disabled",
	"disposal",
])("releases shortcut input without stale focus after %s", async (transition) => {
	const f = await adaptedSetup();
	f.actions("ctrl");
	f.tools.$input.dispatchEvent(
		new InputEvent("beforeinput", { data: "c", cancelable: true }),
	);
	if (transition === "no focus callback") delete f.adapter.focus;
	if (transition === "tab switch") f.switchTab({ type: "editor" });
	if (transition === "overlay") {
		const overlay = document.createElement("div");
		overlay.className = "prompt";
		document.body.append(overlay);
	}
	if (transition === "busy") f.setState({ busy: true });
	if (transition === "disabled") f.setState({ enabled: false });
	if (transition === "disposal") f.dispose();
	await vi.advanceTimersByTimeAsync(0);
	expect(document.activeElement).not.toBe(f.tools.$input);
	if (f.adapter.focus) expect(f.adapter.focus).not.toHaveBeenCalled();
});

it.each([
	"pointercancel",
	"scroll",
	"outside pointer",
	"outside focus",
	"unsupported",
	"unused gesture",
])("drops selection after %s without disturbing queued edits", async (transition) => {
	const f = await adaptedSetup();
	f.pointer("pointerdown");
	if (transition === "pointercancel") f.pointer("pointercancel");
	if (transition === "scroll") f.tools.$row1.dispatchEvent(new Event("scroll"));
	if (transition === "outside pointer") f.pointer("pointerdown", f.editor);
	if (transition === "outside focus") {
		f.button.focus();
		f.editor.focus();
	}
	if (transition === "unsupported") f.actions("command", "unsupported");
	f.editor.setSelectionRange(8, 8);
	f.pointer("pointerdown");
	f.click();
	await vi.advanceTimersByTimeAsync(0);
	expect(f.editor.value).toBe("01234567x89");
	expect(f.adapter.cancel).not.toHaveBeenCalled();
});

it("retains touch selection until dispatch and drops a cancelled touch", async () => {
	const f = await adaptedSetup("touch");
	vi.spyOn(document, "elementFromPoint").mockReturnValue(f.button);
	const touch = (type) =>
		f.button.dispatchEvent(
			new TouchEvent(type, {
				bubbles: true,
				cancelable: true,
				changedTouches: [{ clientX: 0, clientY: 0 }],
			}),
		);
	f.pointer("pointerdown");
	touch("touchstart");
	touch("touchcancel");
	f.editor.setSelectionRange(8, 8);
	f.pointer("pointerdown");
	touch("touchstart");
	// Simulate selection being lost when the toolbar takes focus.
	f.editor.setSelectionRange(0, 0);
	touch("touchend");
	await vi.advanceTimersByTimeAsync(0);
	expect(f.editor.value).toBe("01234567x89");
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
