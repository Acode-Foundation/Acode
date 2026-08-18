import settingsPage from "../components/settingsPage";
import appSettings from "../lib/settings";

export default function aiSettings() {
	const title = strings["ai settings"] || "AI Settings";
	const values = appSettings.value.ai;
	const items = [
		{
			key: "useAcodePro",
			text: strings["use acode pro ai"] || "Use Acode Pro AI",
			info: "Prioritize using existing Claude/Codex subscription if active",
			checkbox: values.useAcodePro,
		},
		{
			key: "provider",
			text: strings["ai provider"] || "AI Provider",
			value: values.provider,
			select: [
				["openai", "OpenAI"],
				["gemini", "Google Gemini"],
				["anthropic", "Anthropic Claude"],
				["openrouter", "OpenRouter"],
			],
		},
		{
			key: "openaiKey",
			text: "OpenAI API Key",
			value: values.openaiKey,
			prompt: "OpenAI API Key",
			promptType: "text",
		},
		{
			key: "geminiKey",
			text: "Gemini API Key",
			value: values.geminiKey,
			prompt: "Gemini API Key",
			promptType: "text",
		},
		{
			key: "anthropicKey",
			text: "Anthropic API Key",
			value: values.anthropicKey,
			prompt: "Anthropic API Key",
			promptType: "text",
		},
		{
			key: "openRouterKey",
			text: "OpenRouter API Key",
			value: values.openRouterKey,
			prompt: "OpenRouter API Key",
			promptType: "text",
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		groupByDefault: true,
	});

	function callback(key, value) {
		values[key] = value;
		appSettings.update();
	}
}
