import toast from "components/toast";
import voice from "lib/voice";

let active = false;
let busy = false;
let targetFile = null;
let resultListener = null;
let errorListener = null;

/** @returns {boolean} */
export function isVoiceInputActive() {
	return active;
}

/**
 * Toggles dictation at the editor cursor.
 * @returns {Promise<boolean>}
 */
export async function toggleVoiceInput() {
	if (busy) return false;
	if (active) return stopVoiceInput();
	return startVoiceInput();
}

async function startVoiceInput() {
	const view = editorManager?.editor;
	const file = editorManager?.activeFile;

	if (!view || !file || file.readOnly || view.state.readOnly) {
		toast("Open an editable file to use voice input.");
		return false;
	}

	busy = true;
	try {
		if (!(await voice.isSupported())) {
			toast("Speech recognition is not available on this device.");
			return false;
		}

		const granted =
			(await voice.hasPermission()) || (await voice.requestPermission());
		if (!granted) {
			toast("Microphone permission is required for voice input.");
			return false;
		}

		resultListener = (payload) => {
			const text = String(payload?.text || "").trim();
			if (!text) return;

			if (editorManager?.activeFile !== targetFile) {
				toast("Voice input stopped: the active file changed.");
				stopVoiceInput();
				return;
			}

			if (!insertTranscript(text)) {
				toast("Voice input stopped: the editor is no longer editable.");
				stopVoiceInput();
			}
		};

		errorListener = (payload) => {
			if (!active) return;

			const code = payload?.code;
			if (code === "no_match" || code === "speech_timeout") return;

			toast(payload?.message || "Voice input failed.");
			if (!payload?.recoverable) stopVoiceInput();
		};

		voice.on("result", resultListener);
		voice.on("error", errorListener);

		targetFile = file;
		active = true;
		await voice.start({
			continuous: true,
			partialResults: true,
			language: globalThis.navigator?.language || "",
		});

		if (!active) return false;

		toast("Voice input started. Speak now.", 3000);
		return true;
	} catch (error) {
		active = false;
		cleanupListeners();
		toast(error?.message || "Unable to start voice input.");
		return false;
	} finally {
		busy = false;
	}
}

async function stopVoiceInput() {
	if (!active) return false;

	busy = true;
	active = false;

	try {
		await voice.stop();
	} catch (error) {
		if (error?.code !== "no_match" && error?.code !== "speech_timeout") {
			toast(error?.message || "Unable to stop voice input.");
		}
	} finally {
		cleanupListeners();
		busy = false;
		toast("Voice input stopped.", 2000);
	}

	return true;
}

function cleanupListeners() {
	if (resultListener) {
		voice.off("result", resultListener);
		resultListener = null;
	}
	if (errorListener) {
		voice.off("error", errorListener);
		errorListener = null;
	}
	targetFile = null;
}

function insertTranscript(text) {
	const view = editorManager?.editor;
	const file = editorManager?.activeFile;

	if (!view || !file || file.readOnly || view.state.readOnly) return false;

	const selection = view.state.selection.main;
	const insert = /[\s\n]$/.test(text) ? text : `${text} `;

	view.dispatch({
		changes: {
			from: selection.from,
			to: selection.to,
			insert,
		},
		selection: { anchor: selection.from + insert.length },
		scrollIntoView: true,
		userEvent: "input.voice",
	});
	view.focus();
	return true;
}
