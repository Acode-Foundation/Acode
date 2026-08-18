import appSettings from "lib/settings";
import OpenAiAdapter from "./OpenAiAdapter";
import OpenRouterAdapter from "./OpenRouterAdapter";

class AIService {
	/**
	 * Get the active provider adapter based on settings
	 */
	async getActiveAdapter() {
		const settings = appSettings.value.ai;

		switch (settings.provider) {
			case "openai":
				if (!settings.openaiKey) throw new Error("OpenAI Key missing. Please go to Settings > AI Settings.");
				return new OpenAiAdapter(settings.openaiKey);
			case "openrouter":
				if (!settings.openRouterKey) throw new Error("OpenRouter Key missing. Please go to Settings > AI Settings.");
				return new OpenRouterAdapter(settings.openRouterKey);
			// Gemini and Anthropic adapters to be added later
			default:
				throw new Error(`Provider "${settings.provider || 'none'}" is not configured. Please go to Settings > AI Settings.`);
		}
	}

	/**
	 * Prompt the user to configure API key in settings
	 */
	async promptForConfig(message) {
		alert(message || "Please configure your AI provider in Settings > AI Settings.");
		appSettings.uiSettings["ai-settings"]?.show();
	}

	async chat(messages) {
		try {
			const adapter = await this.getActiveAdapter();
			return await adapter.chat(messages);
		} catch (error) {
			await this.promptForConfig(error.message);
			throw error;
		}
	}

	async completeCode(prefix, suffix) {
		try {
			const adapter = await this.getActiveAdapter();
			if (!adapter.completeCode) {
				return ""; // not supported by this adapter
			}
			return await adapter.completeCode(prefix, suffix);
		} catch (error) {
			console.error("AI Completion error", error);
			return "";
		}
	}
}

export default new AIService();
