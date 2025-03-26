export default class TaskManager {
	/**
	 * @typedef {'linear'|'parallel'} TaskManagerMode
	 */

	/**
	 * @type {Array<()=>Promise>}
	 */
	#queue = [];
	/**
	 * @type {TaskManagerMode}
	 */
	#mode = "linear";
	/**
	 * @type {boolean}
	 */
	#busy = false;
	/**
	 * @type {TaskCallback[]}
	 */
	#listeners = [];
	#count = 0;

	/**
	 * Create new TaskManager
	 * @param {TaskManagerMode} mode
	 */
	constructor(mode) {
		this.#mode = mode;

		this.queueTask = this.queueTask.bind(this);
	}

	/**
	 * Add task to queue
	 * @param {()=>Promise} task
	 */
	async queueTask(task) {
		this.#queue.push(task);
		this.#execNext();
		return new Promise((resolve, reject) => {
			const listener = (t, result, error) => {
				if (t !== task) return;

				this.#listeners = this.#listeners.filter((l) => l !== listener);

				if (error) reject(error);
				else resolve(result);
			};

			this.#listeners.push(listener);
		});
	}

	async #execNext() {
		if (this.#mode === "linear" && this.#busy) {
			return;
		}

		const task = this.#queue.shift();
		if (!task) return;

		let result;
		let error;

		try {
			this.#busy = true;
			const id = this.#count++;
			result = await task(id);
		} catch (err) {
			error = err;
		} finally {
			this.#busy = false;
		}

		for (const l of this.#listeners) {
			l(task, result, error);
		}
		if (this.#mode === "linear") this.#execNext();
	}
}
