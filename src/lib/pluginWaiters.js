export default class PluginWaiters {
	#waiters = new Map();

	waitFor(pluginId) {
		return new Promise((resolve, reject) => {
			let waiters = this.#waiters.get(pluginId);
			if (!waiters) {
				waiters = new Set();
				this.#waiters.set(pluginId, waiters);
			}
			waiters.add({ resolve, reject });
		});
	}

	resolve(pluginId) {
		const waiters = this.#waiters.get(pluginId);
		if (!waiters) return;

		this.#waiters.delete(pluginId);
		for (const waiter of waiters) waiter.resolve();
	}

	rejectAll(getError) {
		for (const [pluginId, waiters] of this.#waiters) {
			this.#waiters.delete(pluginId);
			for (const waiter of waiters) waiter.reject(getError(pluginId));
		}
	}
}
