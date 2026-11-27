/** Runs host requests with bounded concurrency so a scan cannot flood the bridge. */
export default class TaskQueue {
	#concurrency: number;
	#queue: Array<() => Promise<void>> = [];
	#active = 0;

	constructor(concurrency: number) {
		this.#concurrency = concurrency;
	}

	get busy(): boolean {
		return this.#active > 0 || this.#queue.length > 0;
	}

	run<T>(task: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this.#queue.push(() => task().then(resolve, reject));
			this.#drain();
		});
	}

	#drain(): void {
		while (this.#active < this.#concurrency && this.#queue.length) {
			const job = this.#queue.shift()!;
			this.#active++;
			void job().finally(() => {
				this.#active--;
				this.#drain();
			});
		}
	}
}
