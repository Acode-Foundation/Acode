import settingsPage from "../components/settingsPage";
import appSettings from "../lib/settings";

export default function aiSettings() {
	const title = strings["ai settings"] || "AI Settings";
	const values = appSettings.value.ai;
	const items = [
		{
			key: "provider",
			text: strings["ai provider"] || "AI Provider",
			value: values.provider,
			select: [
				["openai", "OpenAI"],
				["openrouter", "OpenRouter"],
			],
			info: "Select which AI API provider to use",
		},
		{
			key: "model",
			text: "AI Model",
			value: values.model || "gpt-4o-mini",
			prompt: "AI Model (e.g. gpt-4o-mini, anthropic/claude-3-haiku)",
			promptType: "text",
			info: "The exact model string to request",
		},
		{
			key: "openaiKey",
			text: "OpenAI API Key",
			value: values.openaiKey,
			prompt: "OpenAI API Key",
			promptType: "text",
			info: "Your direct OpenAI API key",
		},
		{
			key: "openRouterKey",
			text: "OpenRouter API Key",
			value: values.openRouterKey,
			prompt: "OpenRouter API Key",
			promptType: "text",
			info: "Your OpenRouter API key",
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	function callback(key, value) {
		values[key] = value;
		appSettings.update();
	}
}
