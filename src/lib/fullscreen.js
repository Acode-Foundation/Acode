/** Opt-in Android Back delivery for the current browser fullscreen owner. */
let owner = fullscreenElement();
let generation = 0;
let registration = null;
let requested = false;
let queue = Promise.resolve();

function fullscreenElement() {
	let element = document.fullscreenElement;
	while (element?.shadowRoot?.fullscreenElement) {
		element = element.shadowRoot.fullscreenElement;
	}
	return element;
}

function enqueue(operation) {
	const result = queue.then(operation);
	queue = result.catch(() => {});
	return result;
}

function setNativeHandler(enabled) {
	return new Promise((resolve, reject) => {
		cordova.exec(
			resolve,
			(message) => reject(new Error(message)),
			"System",
			"set-fullscreen-back-handler",
			[enabled],
		);
	});
}

function updateOwner() {
	const next = fullscreenElement();
	if (next === owner) return;
	owner = next;
	generation++;
	registration = null;
	if (requested) {
		requested = false;
		// Finish any in-flight enable before releasing it. New registrations queue
		// behind this release; an old acknowledgement cannot reinstall a callback.
		enqueue(() => setNativeHandler(false)).catch(() => {});
	}
}

document.addEventListener("fullscreenchange", updateOwner);
document.addEventListener("fullscreenbackbutton", () => {
	updateOwner();
	const current = registration;
	const currentOwner = owner;
	const currentGeneration = generation;
	const exit = () => {
		updateOwner();
		if (
			currentOwner &&
			owner === currentOwner &&
			generation === currentGeneration &&
			registration === current
		) {
			Promise.resolve(document.exitFullscreen()).catch(() => {});
		}
	};
	if (!current) return exit();
	try {
		Promise.resolve(current.callback()).catch(exit);
	} catch {
		exit();
	}
});

export default {
	/**
	 * Claim Back while fullscreen, or release it with null. The callback must
	 * explicitly exit fullscreen when desired. Native acceptance is asynchronous.
	 * @param {(() => void | Promise<void>) | null} callback
	 * @returns {Promise<void>}
	 */
	async setBackHandler(callback) {
		if (callback !== null && typeof callback !== "function") {
			throw new TypeError("Back handler must be a function or null.");
		}
		updateOwner();
		if (callback && !owner) {
			throw new Error("Back handler requires fullscreen.");
		}
		const requestGeneration = generation;
		const next = callback ? { callback } : null;
		requested = true;
		await enqueue(async () => {
			updateOwner();
			if (requestGeneration !== generation) {
				if (callback) throw new Error("Fullscreen session changed.");
				return;
			}
			const previous = registration;
			// Back can arrive after native acceptance but before its acknowledgement.
			registration = next;
			try {
				await setNativeHandler(!!callback);
			} catch (error) {
				updateOwner();
				if (requestGeneration === generation) registration = previous;
				throw error;
			}
			updateOwner();
			if (callback && requestGeneration !== generation) {
				throw new Error("Fullscreen session changed.");
			}
		});
	},
};
