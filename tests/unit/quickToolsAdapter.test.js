import { describe, it, expect, vi } from "vitest";
import { createQuickToolsAdapterRegistry } from "../../src/lib/quickToolsAdapter";

function setup(resolve) {
	let tab = { hideQuickTools: true };
	const original = tab;
	const registry = createQuickToolsAdapterRegistry(() => tab, resolve);
	let state = { enabled: true, busy: false }, notify;
	const adapter = {
		getState: () => state,
		canHandle: (action) => action.type !== "command" || action.command === "undo",
		subscribe: (fn) => { notify = fn; return vi.fn(); },
		execute: vi.fn(async () => {}),
		captureSelection: vi.fn(async () => ({ anchor: 3 })),
		restoreSelection: vi.fn(async () => {}),
		focus: vi.fn(), onError: vi.fn(), cancel: vi.fn(),
	};
	const dispose = registry.register(tab, adapter);
	registry.sync();
	return { registry, adapter, original, dispose,
		change: (value) => { tab = value; registry.sync(); },
		state: (value) => { state = { ...state, ...value }; notify(); },
	};
}
const insert = { type: "text", text: "x" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("custom-tab quicktools", () => {
	it("uses editor availability, preserves configured opt-out for unadapted tabs, and never falls through unsupported actions", async () => {
		const f = setup();
		expect(f.registry.visible()).toBe(true);
		expect(f.registry.dispatch({ type: "command", command: "movelinesup" })).toBe(true);
		f.state({ busy: true });
		expect(f.registry.visible()).toBe(true);
		expect(f.registry.available(insert)).toBe(false);
		f.registry.dispatch(insert);
		await settle();
		expect(f.adapter.execute).not.toHaveBeenCalled();
		f.state({ enabled: false });
		expect(f.registry.visible()).toBe(false);
		f.change({ type: "editor", hideQuickTools: false });
		expect(f.registry.visible()).toBe(true);
		expect(f.registry.dispatch(insert)).toBe(false);
		f.change({ type: "terminal", hideQuickTools: false });
		expect(f.registry.dispatch(insert)).toBe(false);
	});
	it("captures once before focus moves and preserves sequential repeated input", async () => {
		const f = setup();
		f.registry.capture(); f.registry.capture();
		for (let i = 0; i < 3; i++) f.registry.dispatch({ type: "text", text: String(i) });
		await settle();
		expect(f.adapter.captureSelection).toHaveBeenCalledOnce();
		expect(f.adapter.restoreSelection).toHaveBeenCalledOnce();
		expect(f.adapter.execute.mock.calls.map(([action]) => action.text)).toEqual(["0", "1", "2"]);
		expect(f.adapter.focus).not.toHaveBeenCalled();
	});
	it("drops clipboard work and queued repeats after switching away and back", async () => {
		let finish;
		const f = setup(() => new Promise((resolve) => { finish = resolve; }));
		f.registry.dispatch(insert); f.registry.dispatch(insert);
		await settle();
		f.change({ type: "editor" }); f.change(f.original);
		finish(insert);
		await settle();
		expect(f.adapter.execute).not.toHaveBeenCalled();
	});
	it("cancels pending selection restoration when a dialog opens or the adapter closes", async () => {
		for (const close of [false, true]) {
			const f = setup(); let finish;
			f.adapter.captureSelection.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
			f.registry.capture(); f.registry.dispatch(insert);
			await settle();
			if (close) f.dispose(); else f.registry.setBlocked(true);
			finish({ anchor: 3 }); await settle();
			expect(f.adapter.restoreSelection).not.toHaveBeenCalled();
			expect(f.adapter.execute).not.toHaveBeenCalled();
		}
	});
	it("isolates two custom tabs and makes stale cleanup harmless", async () => {
		const f = setup(); const second = { hideQuickTools: true }, execute = vi.fn();
		f.registry.register(second, { ...f.adapter, execute });
		f.change(second); f.registry.dispatch(insert); await settle();
		expect(execute).toHaveBeenCalledOnce();
		expect(f.adapter.execute).not.toHaveBeenCalled();
		f.dispose(); f.dispose();
		expect(f.registry.has(second)).toBe(true);
	});
	it("starts a fresh queue after cancellation even if the old clipboard never resolves", async () => {
		let first = true;
		const f = setup(action => { if (first) { first = false; return new Promise(() => {}); } return action; });
		f.registry.dispatch(insert); await settle();
		f.change({ type: "editor" }); f.change(f.original);
		f.registry.dispatch(insert); await settle();
		expect(f.adapter.execute).toHaveBeenCalledOnce();
	});
	it("captures the updated caret for rapid taps and cancels deferred focus", async () => {
		const f = setup(); let caret = 0;
		f.adapter.captureSelection.mockImplementation(async () => caret);
		f.adapter.restoreSelection.mockImplementation(async (value) => { caret = value; });
		f.adapter.execute.mockImplementation(async () => { caret++; });
		for (let i = 0; i < 4; i++) { f.registry.capture(); f.registry.dispatch(insert); }
		await settle(); expect(caret).toBe(4);
		f.registry.focus(); f.registry.cancel(); await settle();
		expect(f.adapter.focus).not.toHaveBeenCalled();
	});

});
