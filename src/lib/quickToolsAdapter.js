import { hasQuickToolsOverlay } from "./quickToolsOverlays";

/**
 * Per-tab input routing for custom editors. No editor engine or UI dependencies.
 * An adapter owns all editing actions on its tab: unsupported actions never fall
 * through to the code editor, including while an asynchronous action is pending.
 */
export function createQuickToolsAdapterRegistry(
	getActiveTab,
	resolveAction = async (action) => action,
	isBlocked = () => false,
) {
	const entries = new Map();
	const listeners = new Set();
	let activeTab,
		blocked = false;
	const notify = (change) => listeners.forEach((listener) => listener(change));
	const current = () => entries.get(getActiveTab());
	function cancel(entry) {
		if (!entry) return;
		entry.controller.abort();
		entry.controller = new AbortController();
		entry.queue = Promise.resolve();
		entry.pending = 0;
		entry.selection = undefined;
		entry.adapter.cancel?.();
	}
	const valid = (entry, signal) =>
		!signal.aborted &&
		!blocked &&
		!isBlocked() &&
		current() === entry &&
		entry.adapter.getState().enabled &&
		!entry.adapter.getState().busy;
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		register(tab, adapter) {
			if (
				!tab ||
				!adapter?.getState ||
				!adapter?.canHandle ||
				!adapter?.execute ||
				!adapter?.subscribe
			)
				throw new TypeError(
					"A quicktools adapter needs a tab, state, availability and execution handlers.",
				);
			if (entries.has(tab))
				throw new Error("This tab already has a quicktools adapter.");
			const entry = {
				tab,
				adapter,
				controller: new AbortController(),
				queue: Promise.resolve(),
				pending: 0,
				selection: undefined,
			};
			entries.set(tab, entry);
			const unsubscribe = adapter.subscribe(() => {
				const state = adapter.getState();
				const cancelled = !state.enabled || state.busy;
				if (cancelled) cancel(entry);
				notify({ tab, cancelled });
			});
			const dispose = () => {
				if (entries.get(tab) !== entry) return;
				entries.delete(tab);
				unsubscribe?.();
				tab.off?.("close", dispose);
				cancel(entry);
				notify({ tab, cancelled: true });
			};
			tab.on?.("close", dispose);
			notify();
			return dispose;
		},
		sync() {
			const next = getActiveTab();
			if (next !== activeTab) {
				cancel(entries.get(activeTab));
				activeTab = next;
			}
			notify();
		},
		setBlocked(value) {
			if (blocked === value) return;
			blocked = value;
			if (value) cancel(current());
			notify();
		},
		has(tab = getActiveTab()) {
			return entries.has(tab);
		},
		visible(tab = getActiveTab()) {
			const entry = entries.get(tab);
			return entry ? !!entry.adapter.getState().enabled : !tab?.hideQuickTools;
		},
		available(action) {
			const entry = current();
			return (
				!!entry &&
				!blocked &&
				!isBlocked() &&
				entry.adapter.getState().enabled &&
				!entry.adapter.getState().busy &&
				entry.adapter.canHandle(action)
			);
		},
		capture() {
			const entry = current();
			if (!entry || blocked || isBlocked() || entry.selection) return;
			// Repeated input must capture the selection produced by the preceding
			// action, rather than restoring an older caret when the queue catches up.
			entry.selection = entry.pending
				? entry.queue.then(() => entry.adapter.captureSelection?.())
				: Promise.resolve(entry.adapter.captureSelection?.());
			// Capture failures are reported by dispatch, without an unhandled rejection.
			entry.selection.catch(() => {});
		},
		dispatch(action) {
			const entry = current();
			if (!entry) return false;
			if (!this.available(action)) return true;
			const signal = entry.controller.signal,
				selection = entry.selection;
			entry.selection = undefined;
			entry.pending++;
			entry.queue = entry.queue
				.then(async () => {
					if (!valid(entry, signal) || !this.available(action)) return;
					if (selection) {
						const snapshot = await selection;
						if (!valid(entry, signal)) return;
						await entry.adapter.restoreSelection?.(snapshot);
					}
					if (!valid(entry, signal) || !this.available(action)) return;
					const resolved = await resolveAction(action);
					if (valid(entry, signal) && this.available(action))
						await entry.adapter.execute(resolved, { signal });
				})
				.catch((error) => {
					if (valid(entry, signal)) entry.adapter.onError?.(error);
				})
				.finally(() => {
					if (signal === entry.controller.signal) entry.pending--;
				});
			return true;
		},
		focus() {
			const entry = current();
			if (entry && !blocked && entry.adapter.getState().enabled) {
				const signal = entry.controller.signal;
				Promise.resolve()
					.then(() => {
						if (valid(entry, signal)) return entry.adapter.focus?.();
					})
					.catch((error) => {
						if (valid(entry, signal)) entry.adapter.onError?.(error);
					});
			}
		},
		cancel() {
			cancel(current());
		},
	};
}

export default createQuickToolsAdapterRegistry(
	() => globalThis.editorManager?.activeFile,
	async (action) => {
		const paste =
			(action.type === "command" && action.command === "paste") ||
			(action.type === "key" &&
				(action.ctrlKey || action.metaKey) &&
				action.key.toLowerCase() === "v");
		if (!paste) return action;
		const text = await new Promise((resolve, reject) => {
			const clipboard = globalThis.cordova?.plugins?.clipboard;
			if (!clipboard) {
				reject(new Error("Clipboard is unavailable."));
				return;
			}
			clipboard.paste(resolve, reject);
		});
		return { type: "text", text: String(text || "") };
	},
	hasQuickToolsOverlay,
);
