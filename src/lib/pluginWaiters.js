export default class PluginWaiters {
	#waiters = new Map();

	waitFor(pluginId) {
		let deferred = this.#waiters.get(pluginId);
		if (!deferred) {
			let resolve;
			let reject;
			const promise = new Promise((res, rej) => {
				resolve = res;
				reject = rej;
			});
			deferred = { promise, resolve, reject };
			this.#waiters.set(pluginId, deferred);
		}
		return deferred.promise;
	}

	resolve(pluginId, value = true) {
		const deferred = this.#waiters.get(pluginId);
		if (!deferred) return;

		this.#waiters.delete(pluginId);
		deferred.resolve(value);
	}

	reject(pluginId, error) {
		const deferred = this.#waiters.get(pluginId);
		if (!deferred) return;

		this.#waiters.delete(pluginId);
		deferred.reject(error);
	}

	rejectAll(getError, filter) {
		for (const [pluginId, deferred] of this.#waiters) {
			if (filter && !filter(pluginId)) continue;
			this.#waiters.delete(pluginId);
			const error = getError(pluginId);
			deferred.reject(error);
		}
	}
}
