export default class BaseProvider {
	constructor(apiKey, model) {
		this.apiKey = apiKey;
		this.model = model;
	}

	/**
	 * Send a chat message to the provider.
	 * @param {Array<{role: string, content: string}>} messages
	 * @returns {Promise<string>} The response string
	 */
	async chat(messages) {
		throw new Error("chat() not implemented for " + this.constructor.name);
	}

	/**
	 * Complete code based on prefix and suffix
	 * @param {string} prefix
	 * @param {string} suffix
	 * @returns {Promise<string>} The completion text
	 */
	async completeCode(prefix, suffix) {
		throw new Error(
			"completeCode() not implemented for " + this.constructor.name,
		);
	}

	/**
	 * Execute an agent loop for a task
	 * @param {string} task
	 * @param {Function} onStep - Callback for each step (Thought, Action, Observation)
	 */
	async executeAgentLoop(task, onStep) {
		throw new Error(
			"executeAgentLoop() not implemented for " + this.constructor.name,
		);
	}
}
