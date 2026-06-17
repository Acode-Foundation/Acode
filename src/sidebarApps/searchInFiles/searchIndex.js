const requests = new Map();
const fileRequests = new Map();

let worker;
let requestId = 0;

export function createSearchIndex({ readFile, onStatus }) {
	function getWorker() {
		if (worker) return worker;

		worker = new Worker("build/searchIndexWorker.js");
		worker.onmessage = async ({ data }) => {
			const { action, id, error } = data;

			if (action === "status") {
				onStatus?.(data.data);
				return;
			}

			if (action === "get-file") {
				handleGetFile(data);
				return;
			}

			const pending = requests.get(id);
			if (!pending) return;
			requests.delete(id);

			if (error) pending.reject(error);
			else pending.resolve(data.data);
		};
		worker.onerror = (error) => {
			onStatus?.({ state: "error", message: "Search index unavailable" });
			for (const pending of requests.values()) {
				pending.reject(error);
			}
			requests.clear();
			console.error(error);
		};

		return worker;
	}

	async function handleGetFile({ id, data }) {
		const fileRequest = fileRequests.get(id);
		if (fileRequest) return;
		fileRequests.set(id, true);
		const targetWorker = worker;

		try {
			const content = await readFile(data);
			if (worker !== targetWorker || !targetWorker) return;
			targetWorker.postMessage({
				action: "get-file",
				id,
				data: content || "",
			});
		} catch (error) {
			if (worker !== targetWorker || !targetWorker) return;
			targetWorker.postMessage({
				action: "get-file",
				id,
				error: error?.message || String(error),
			});
		} finally {
			fileRequests.delete(id);
		}
	}

	function post(action, data, expectResponse = false) {
		const id = ++requestId;
		getWorker().postMessage({ action, id, data });

		if (!expectResponse) return Promise.resolve();

		return new Promise((resolve, reject) => {
			requests.set(id, { resolve, reject });
		});
	}

	function stop() {
		if (!worker) return;
		worker.terminate();
		worker = null;
		fileRequests.clear();
		for (const pending of requests.values()) {
			pending.reject(new Error("Search index stopped"));
		}
		requests.clear();
	}

	return {
		sync(files) {
			return post("sync", { files });
		},
		query(files, search, options, forceUrls) {
			return post(
				"query",
				{
					files,
					search,
					options,
					forceUrls: [...forceUrls],
				},
				true,
			);
		},
		markDirty(urls) {
			return post("mark-dirty", { urls });
		},
		stop,
	};
}
