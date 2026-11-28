import appSettings from "lib/settings";

export default function restorePromptInput() {
	const activePrompt = document.querySelector("form.prompt:not(.hide)");
	system.setInputType(activePrompt ? "NORMAL" : appSettings.value.keyboardMode);
}
