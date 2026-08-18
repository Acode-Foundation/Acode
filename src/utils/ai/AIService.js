import appSettings from "lib/settings";
import OpenAiAdapter from "./OpenAiAdapter";
import OpenRouterAdapter from "./OpenRouterAdapter";
import AcodeProAdapter from "./AcodeProAdapter";

class AIService {
	/**
	 * Get the active provider adapter based on settings and fallback logic
	 */
	async getActiveAdapter() {
		const settings = appSettings.value.ai;

		// 1. Check Acode Pro first if enabled
		if (settings.useAcodePro) {
			// In a real implementation, we would check if the user is logged in
			// and has an active acode_pro subscription from `auth.getLoggedInUser()`
			// For now, we will return the adapter and let it throw QUOTA_EXHAUSTED
			// if they don't have access.
			return new AcodeProAdapter();
		}

		// 2. Fallback to direct keys based on provider selection
		switch (settings.provider) {
			case "openai":
				if (!settings.openaiKey) throw new Error("OpenAI Key missing. Please update AI Settings.");
				return new OpenAiAdapter(settings.openaiKey);
			case "openrouter":
				if (!settings.openRouterKey) throw new Error("OpenRouter Key missing. Please update AI Settings.");
				return new OpenRouterAdapter(settings.openRouterKey);
			// Implement gemini and anthropic later
			default:
				throw new Error("Selected AI provider is not supported yet.");
		}
	}

	/**
	 * Prompt the user for an API key if quota is exhausted
	 */
	async promptForKey() {
		// In a real implementation, we can trigger a dialog or redirect to settings
		alert("Acode Pro AI quota exhausted. Please enter your own API key in Settings > AI Settings.");
		appSettings.uiSettings["ai-settings"].show();
	}

	async chat(messages) {
		try {
			const adapter = await this.getActiveAdapter();
			return await adapter.chat(messages);
		} catch (error) {
			if (error.code === "QUOTA_EXHAUSTED") {
				await this.promptForKey();
				throw new Error("Quota exhausted. Switched to fallback.");
			}
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
