// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createQuickToolsAdapterRegistry } from "../../src/lib/quickToolsAdapter";
import {
	hasQuickToolsOverlay,
	watchQuickToolsOverlays,
} from "../../src/lib/quickToolsOverlays";
let dispose;
afterEach(() => {
	dispose?.();
	document.body.replaceChildren();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
it("cancels clipboard and repeats on native overlays without observing editor content or changing the Back stack", async () => {
	let tab = {},
		finish;
	const registry = createQuickToolsAdapterRegistry(
		() => tab,
		(action) =>
			new Promise((resolve) => {
				finish = () => resolve(action);
			}),
		hasQuickToolsOverlay,
	);
	const execute = vi.fn(),
		cancel = vi.fn();
	const unregister = registry.register(tab, {
		getState: () => ({ enabled: true }),
		canHandle: () => true,
		subscribe: () => () => {},
		execute,
	});
	dispose = watchQuickToolsOverlays(registry, cancel);
	registry.dispatch({ type: "text", text: "pending" });
	await settle();
	const prompt = document.createElement("div");
	prompt.className = "prompt";
	document.body.append(prompt);
	await settle();
	expect(cancel).toHaveBeenCalledOnce();
	expect(registry.available({ type: "text" })).toBe(false);
	prompt.remove();
	await settle();
	finish();
	await settle();
	expect(execute).not.toHaveBeenCalled();
	const content = document.createElement("div");
	document.body.append(content);
	await settle();
	content.append(document.createElement("div"));
	await settle();
	expect(cancel).toHaveBeenCalledOnce();
	for (const type of ["editor", "terminal"]) {
		tab = { type };
		registry.sync();
		document.body.append(prompt);
		await settle();
		expect(registry.dispatch({ type: "text" })).toBe(false);
		prompt.remove();
	}
	unregister();
	expect(cancel).toHaveBeenCalledOnce();
});
it("checks an overlay synchronously before dispatch and does not refocus into a busy adapter", async () => {
	const tab = {},
		execute = vi.fn(),
		focus = vi.fn();
	let busy = false;
	const registry = createQuickToolsAdapterRegistry(
		() => tab,
		undefined,
		hasQuickToolsOverlay,
	);
	registry.register(tab, {
		getState: () => ({ enabled: true, busy }),
		canHandle: () => true,
		subscribe: () => () => {},
		execute,
		focus,
	});
	const palette = document.createElement("div");
	palette.id = "palette";
	document.body.append(palette);
	registry.dispatch({ type: "text", text: "x" });
	registry.focus();
	await settle();
	expect(execute).not.toHaveBeenCalled();
	expect(focus).not.toHaveBeenCalled();
	palette.remove();
	busy = true;
	registry.focus();
	await settle();
	expect(focus).not.toHaveBeenCalled();
});
