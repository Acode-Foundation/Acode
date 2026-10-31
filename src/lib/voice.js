import nativeVoice from "../plugins/voice/www/voice";

export const VOICE_PERMISSION = "android.permission.RECORD_AUDIO";

export const VoiceEvents = Object.freeze({
	READY: "ready",
	START: "start",
	SPEECH_START: "speechstart",
	SPEECH_END: "speechend",
	VOLUME: "volume",
	PARTIAL: "partial",
	RESULT: "result",
	ERROR: "error",
	END: "end",
	CANCELLED: "cancelled",
	RESTART: "restart",
});

const MIC_GRANTED_KEY = "acode.voice.micGranted";
const DEFAULT_TIMEOUT = 30000;
const MIN_TIMEOUT = 1000;
const WEB_STOP_TIMEOUT = 5000;

const listeners = new Map();
let backendPromise = null;
let startPromise = null;
let listening = false;
let activeOptions = null;
let webRecognition = null;
let webStopping = false;
let webRestartAllowed = true;
let webLastResult = null;
let webStopPromise = null;
let webStopResolve = null;
let webStopTimer = null;

function ensureBridge() {
	nativeVoice.setCallback(handleNativeEvent);
}

function resolveBackend() {
	if (backendPromise) return backendPromise;

	backendPromise = (async () => {
		try {
			ensureBridge();
			const info = await nativeVoice.isAvailable();
			if (info?.available) return "native";
		} catch (error) {
			// The native plugin is unavailable (for example in a browser build).
			// Fall through to the Web Speech API when it exists.
		}

		return getWebSpeech() ? "web" : null;
	})().then((backend) => {
		// Do not cache a miss: Cordova may still be starting up on the first
		// call, and a later attempt can find the native plugin.
		if (!backend) backendPromise = null;
		return backend;
	});

	return backendPromise;
}

function getWebSpeech() {
	if (typeof window === "undefined") return null;
	return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function readGrantedCache() {
	try {
		return localStorage.getItem(MIC_GRANTED_KEY) === "true";
	} catch (error) {
		return false;
	}
}

function writeGrantedCache(granted) {
	try {
		localStorage.setItem(MIC_GRANTED_KEY, granted ? "true" : "false");
	} catch (error) {
		// Storage can be unavailable in private or restricted contexts.
	}
}

function emit(event, payload) {
	const handlers = listeners.get(event);
	if (!handlers) return;

	for (const handler of [...handlers]) {
		try {
			handler(payload);
		} catch (error) {
			console.error(`Voice listener failed for "${event}"`, error);
		}
	}
}

function handleNativeEvent(payload) {
	const event = payload?.event;
	if (!event) return;

	switch (event) {
		case VoiceEvents.START:
			listening = true;
			break;
		case VoiceEvents.RESULT:
			if (!activeOptions?.continuous) listening = false;
			break;
		case VoiceEvents.ERROR:
			if (!payload.recoverable || !activeOptions?.continuous) {
				listening = false;
			}
			break;
		case VoiceEvents.CANCELLED:
			listening = false;
			activeOptions = null;
			break;
		case VoiceEvents.END:
			if (!activeOptions?.continuous) listening = false;
			break;
	}

	emit(event, payload);
}

function createVoiceError(code, message, recoverable = false) {
	const error = new Error(message || code);
	error.code = code;
	error.recoverable = recoverable;
	return error;
}

function toVoiceError(payload) {
	if (payload instanceof Error) {
		if (!payload.code) payload.code = "unknown";
		return payload;
	}

	const code = payload?.code || "unknown";
	const message = payload?.message || "Speech recognition failed.";
	return createVoiceError(code, message, !!payload?.recoverable);
}

function clamp(value, min, max) {
	const number = Number(value);
	if (!Number.isFinite(number)) return min;
	return Math.min(max, Math.max(min, number));
}

function normalizeOptions(options) {
	if (options == null) options = {};
	if (typeof options !== "object") {
		throw new TypeError("Voice options must be an object.");
	}

	return {
		language: options.language == null ? "" : String(options.language).trim(),
		continuous: !!options.continuous,
		partialResults: options.partialResults !== false,
		preferOffline: !!options.preferOffline,
		onDevice: !!options.onDevice,
		maxResults: Math.round(clamp(options.maxResults ?? 1, 1, 10)),
		silenceLengthMillis: Math.round(
			clamp(options.silenceLengthMillis ?? 0, 0, 60000),
		),
		timeout: Math.round(
			clamp(options.timeout ?? DEFAULT_TIMEOUT, MIN_TIMEOUT, 120000),
		),
	};
}

/**
 * Checks whether speech recognition is usable on this device.
 * @returns {Promise<boolean>}
 */
async function isSupported() {
	return (await resolveBackend()) !== null;
}

/**
 * Returns backend and microphone details without prompting the user.
 * @returns {Promise<{backend: string|null, available: boolean, permission: boolean, onDevice: boolean}>}
 */
async function getCapabilities() {
	const backend = await resolveBackend();
	const permission = await hasPermission();

	if (backend === "native") {
		try {
			const info = await nativeVoice.isAvailable();
			return {
				backend,
				available: !!info?.available,
				permission,
				onDevice: !!info?.onDevice,
			};
		} catch (error) {
			// Fall through to the generic result.
		}
	}

	return {
		backend,
		available: backend !== null,
		permission,
		onDevice: false,
	};
}

/**
 * Checks the microphone permission. Native checks always win; the cached
 * grant only keeps the app from prompting again when the platform cannot
 * answer the query directly.
 * @returns {Promise<boolean>}
 */
async function hasPermission() {
	const backend = await resolveBackend();

	if (backend === "native") {
		try {
			const granted = !!(await nativeVoice.hasPermission());
			writeGrantedCache(granted);
			return granted;
		} catch (error) {
			return readGrantedCache();
		}
	}

	if (globalThis.navigator?.permissions?.query) {
		try {
			const status = await globalThis.navigator.permissions.query({
				name: "microphone",
			});
			const granted = status.state === "granted";
			writeGrantedCache(granted);
			return granted;
		} catch (error) {
			// Some WebView versions reject the microphone permission name.
		}
	}

	return readGrantedCache();
}

/**
 * Requests microphone access once. Android remembers the grant, so later
 * calls resolve without showing another prompt.
 * @returns {Promise<boolean>}
 */
async function requestPermission() {
	if (await hasPermission()) return true;

	const backend = await resolveBackend();

	if (backend === "native") {
		try {
			const granted = !!(await nativeVoice.requestPermission());
			writeGrantedCache(granted);
			return granted;
		} catch (error) {
			writeGrantedCache(false);
			return false;
		}
	}

	if (globalThis.navigator?.mediaDevices?.getUserMedia) {
		try {
			const stream = await globalThis.navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			for (const track of stream.getTracks()) track.stop();
			writeGrantedCache(true);
			return true;
		} catch (error) {
			writeGrantedCache(false);
			return false;
		}
	}

	return readGrantedCache();
}

/** Clears the remembered microphone grant. The next request prompts again. */
function clearPermissionCache() {
	try {
		localStorage.removeItem(MIC_GRANTED_KEY);
	} catch (error) {
		// Ignore storage failures.
	}
}

/**
 * Starts a recognition session.
 *
 * The session is reserved before the first asynchronous step so two callers
 * cannot both pass the "already listening" check while permission or backend
 * lookup is still pending.
 *
 * @param {object} [options]
 * @param {string} [options.language]
 * @param {boolean} [options.continuous]
 * @param {boolean} [options.partialResults]
 * @param {boolean} [options.preferOffline]
 * @param {boolean} [options.onDevice]
 * @param {number} [options.maxResults]
 * @param {number} [options.silenceLengthMillis]
 * @param {number} [options.timeout]
 * @returns {Promise<object>}
 */
function start(options = {}) {
	if (listening || startPromise || webRecognition || webStopPromise) {
		return Promise.reject(
			createVoiceError(
				"already_listening",
				"Voice recognition is already running.",
			),
		);
	}

	const promise = startSession(options);
	startPromise = promise;

	const clearStartPromise = () => {
		if (startPromise === promise) startPromise = null;
	};
	promise.then(clearStartPromise, clearStartPromise);

	return promise;
}

async function startSession(options = {}) {
	const normalized = normalizeOptions(options);
	const backend = await resolveBackend();
	if (!backend) {
		throw createVoiceError(
			"unavailable",
			"Speech recognition is not available on this device.",
		);
	}

	const granted = await hasPermission();
	if (!granted) {
		const accepted = await requestPermission();
		if (!accepted) {
			throw createVoiceError(
				"permission_denied",
				"Microphone permission was denied.",
			);
		}
	}

	if (backend === "native") {
		try {
			const state = await nativeVoice.start(normalized);
			listening = true;
			activeOptions = normalized;
			return state || { listening: true };
		} catch (error) {
			listening = false;
			activeOptions = null;
			throw toVoiceError(error);
		}
	}

	return startWebRecognition(normalized);
}

/**
 * Stops the current session. The final result is emitted before this
 * promise resolves when the recognizer has one.
 * @returns {Promise<object>}
 */
async function stop() {
	if (webRecognition || webStopPromise) return stopWebRecognition();

	// If a start is still waiting for permission or a backend, let it settle
	// first so the stop applies to the session it creates.
	if (startPromise) await startPromise.catch(() => {});
	if (webRecognition || webStopPromise) return stopWebRecognition();

	const backend = await resolveBackend();
	if (backend !== "native") {
		listening = false;
		activeOptions = null;
		return { listening: false };
	}

	// Always delegate to the native plugin. Local state can be stale after a
	// WebView reload or a missed event, and native stop() is a no-op when idle.
	try {
		const result = await nativeVoice.stop();
		listening = false;
		activeOptions = null;
		return result || { listening: false };
	} catch (error) {
		listening = false;
		activeOptions = null;
		throw toVoiceError(error);
	}
}

/**
 * Cancels the current session without waiting for a final result.
 * @returns {Promise<object>}
 */
async function cancel() {
	if (webRecognition || webStopPromise) return cancelWebRecognition();

	// Match stop(): wait for a pending start so cancellation cannot leave a
	// microphone session running after this promise resolves.
	if (startPromise) await startPromise.catch(() => {});
	if (webRecognition || webStopPromise) return cancelWebRecognition();

	const backend = await resolveBackend();
	if (backend !== "native") {
		listening = false;
		activeOptions = null;
		return { listening: false };
	}

	try {
		return (await nativeVoice.cancel()) || { listening: false };
	} catch (error) {
		throw toVoiceError(error);
	} finally {
		listening = false;
		activeOptions = null;
	}
}

/**
 * One-shot dictation helper. Resolves with the final result.
 * @param {object} [options]
 * @returns {Promise<{text: string, alternatives: string[], isFinal: boolean}>}
 */
function recognize(options = {}) {
	const normalized = normalizeOptions({ ...options, continuous: false });

	return new Promise((resolve, reject) => {
		let settled = false;
		let started = false;
		let timer = null;

		const finish = (error, payload) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			off(VoiceEvents.RESULT, onResult);
			off(VoiceEvents.ERROR, onError);

			if (error) {
				if (started) cancel().catch(() => {});
				reject(error);
				return;
			}
			resolve(payload);
		};

		const onResult = (payload) => finish(null, payload);
		const onError = (payload) => finish(toVoiceError(payload));

		on(VoiceEvents.RESULT, onResult);
		on(VoiceEvents.ERROR, onError);

		timer = setTimeout(() => {
			finish(
				createVoiceError("timeout", "Speech recognition timed out.", true),
			);
		}, normalized.timeout);

		start(normalized)
			.then(() => {
				started = true;
				if (settled) cancel().catch(() => {});
			})
			.catch((error) => finish(toVoiceError(error)));
	});
}

/**
 * Returns the current recognition state.
 * @returns {Promise<object>}
 */
async function getState() {
	const backend = await resolveBackend();

	if (backend === "web") {
		return {
			listening,
			continuous: !!activeOptions?.continuous,
			backend: "web",
		};
	}

	if (backend === "native") {
		try {
			const state = await nativeVoice.getState();
			return { ...state, backend: "native" };
		} catch (error) {
			// Fall through to the local state when the bridge is unavailable.
		}
	}

	return {
		listening,
		continuous: !!activeOptions?.continuous,
		backend: backend || null,
	};
}

function startWebRecognition(options) {
	const Recognition = getWebSpeech();
	if (!Recognition) {
		throw createVoiceError(
			"unavailable",
			"Speech recognition is not available on this device.",
		);
	}

	if (webRecognition) {
		throw createVoiceError(
			"already_listening",
			"Voice recognition is already running.",
		);
	}

	const recognition = new Recognition();
	webRecognition = recognition;
	webStopping = false;
	webRestartAllowed = true;
	webLastResult = null;

	const isCurrent = () => webRecognition === recognition;

	recognition.continuous = options.continuous;
	recognition.interimResults = options.partialResults;
	recognition.maxAlternatives = options.maxResults;
	if (options.language) recognition.lang = options.language;

	recognition.onstart = () => {
		if (!isCurrent()) return;
		listening = true;
		activeOptions = options;
		emit(VoiceEvents.START, { listening: true, backend: "web" });
	};

	recognition.onresult = (event) => {
		if (!isCurrent()) return;

		const result = event.results?.[event.resultIndex];
		if (!result) return;

		const alternatives = Array.from(
			result,
			(alternative) => alternative?.transcript || "",
		);

		const payload = {
			text: alternatives[0] || "",
			alternatives,
			isFinal: !!result.isFinal,
			confidence: result[0]?.confidence,
		};

		if (result.isFinal) {
			webLastResult = payload;
			if (!options.continuous) listening = false;
			emit(VoiceEvents.RESULT, payload);
		} else {
			emit(VoiceEvents.PARTIAL, payload);
		}
	};

	recognition.onerror = (event) => {
		if (!isCurrent()) return;

		const recoverable = ["no-speech", "network", "aborted"].includes(
			event.error,
		);
		const payload = {
			code: event.error || "unknown",
			message: event.message || "Speech recognition failed.",
			recoverable,
		};

		if (!options.continuous || !recoverable) listening = false;
		if (!recoverable) webRestartAllowed = false;
		emit(VoiceEvents.ERROR, payload);

		if (!recoverable) {
			finishWebSession(recognition);
			try {
				recognition.abort();
			} catch (error) {
				// The recognizer may already have ended.
			}
		}
	};

	recognition.onend = () => {
		if (!isCurrent()) return;

		if (options.continuous && webRestartAllowed && !webStopping) {
			try {
				recognition.start();
				return;
			} catch (error) {
				// Fall through and clean up when the browser refuses a restart.
			}
		}

		finishWebSession(recognition);
	};

	try {
		recognition.start();
	} catch (error) {
		detachWebHandlers(recognition);
		webRecognition = null;
		listening = false;
		activeOptions = null;
		throw createVoiceError(
			"start_failed",
			error?.message || "Speech recognition could not be started.",
		);
	}

	if (webRecognition === recognition) {
		listening = true;
		activeOptions = options;
	}

	return { listening: webRecognition === recognition, backend: "web" };
}

function detachWebHandlers(recognition) {
	if (!recognition) return;
	recognition.onstart = null;
	recognition.onresult = null;
	recognition.onerror = null;
	recognition.onend = null;
}

function finishWebSession(recognition) {
	if (webRecognition !== recognition) return;

	detachWebHandlers(recognition);
	webRecognition = null;
	listening = false;
	activeOptions = null;
	webStopping = false;
	webRestartAllowed = true;

	const payload = {
		listening: false,
		text: webLastResult?.text || "",
	};
	settleWebStop(payload);
	emit(VoiceEvents.END, payload);
}

function settleWebStop(payload) {
	if (webStopTimer) {
		clearTimeout(webStopTimer);
		webStopTimer = null;
	}

	const resolve = webStopResolve;
	webStopResolve = null;
	webStopPromise = null;
	if (resolve) resolve(payload);
}

function stopWebRecognition() {
	if (webStopPromise) return webStopPromise;

	const recognition = webRecognition;
	if (!recognition) return Promise.resolve({ listening: false });

	webStopping = true;
	listening = false;

	const stopPromise = new Promise((resolve) => {
		webStopResolve = resolve;
		webStopTimer = setTimeout(() => {
			if (webRecognition === recognition) {
				finishWebSession(recognition);
				try {
					recognition.abort();
				} catch (error) {
					// The recognizer may already have ended.
				}
			} else {
				settleWebStop({
					listening: false,
					text: webLastResult?.text || "",
				});
			}
		}, WEB_STOP_TIMEOUT);
	});

	webStopPromise = stopPromise;

	try {
		recognition.stop();
	} catch (error) {
		finishWebSession(recognition);
		try {
			recognition.abort();
		} catch (abortError) {
			// The recognizer may already have ended.
		}
	}

	return stopPromise;
}

function cancelWebRecognition() {
	const recognition = webRecognition;
	webStopping = true;
	webRestartAllowed = false;

	if (recognition) {
		detachWebHandlers(recognition);
		try {
			recognition.abort();
		} catch (error) {
			// The recognizer may already have ended.
		}
	}

	webRecognition = null;
	listening = false;
	activeOptions = null;
	const payload = { listening: false };
	settleWebStop(payload);
	return Promise.resolve(payload);
}

/**
 * Subscribes to a recognition event.
 * @param {string} event
 * @param {(payload: object) => void} handler
 * @returns {() => void} unsubscribe function
 */
function on(event, handler) {
	if (typeof handler !== "function") {
		throw new TypeError("Voice event handler must be a function.");
	}

	let handlers = listeners.get(event);
	if (!handlers) {
		handlers = new Set();
		listeners.set(event, handlers);
	}
	handlers.add(handler);
	return () => off(event, handler);
}

/**
 * Removes a recognition event listener.
 * @param {string} event
 * @param {(payload: object) => void} handler
 */
function off(event, handler) {
	const handlers = listeners.get(event);
	if (!handlers) return;
	handlers.delete(handler);
	if (!handlers.size) listeners.delete(event);
}

/**
 * Subscribes to one recognition event.
 * @param {string} event
 * @param {(payload: object) => void} handler
 * @returns {() => void} unsubscribe function
 */
function once(event, handler) {
	const unsubscribe = on(event, (payload) => {
		unsubscribe();
		handler(payload);
	});
	return unsubscribe;
}

export default {
	PERMISSION: VOICE_PERMISSION,
	events: VoiceEvents,
	isSupported,
	getCapabilities,
	hasPermission,
	requestPermission,
	clearPermissionCache,
	start,
	stop,
	cancel,
	recognize,
	getState,
	isListening: () => listening,
	on,
	off,
	once,
};
