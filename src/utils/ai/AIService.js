import appSettings from "lib/settings";
import OpenAiAdapter from "./OpenAiAdapter";
import OpenRouterAdapter from "./OpenRouterAdapter";

const HISTORY_PREFIX = "acode_ai_history_";
const MAX_HISTORY_ENTRIES = 20;

class AIService {
	/**
	 * Get the active provider adapter based on settings
	 */
	async getActiveAdapter() {
		const settings = appSettings.value.ai;

		switch (settings.provider) {
			case "openai":
				if (!settings.openaiKey)
					throw new Error(
						"OpenAI Key missing. Please go to Settings > AI Settings.",
					);
				return new OpenAiAdapter(settings.openaiKey, settings.model);
			case "openrouter":
				if (!settings.openRouterKey)
					throw new Error(
						"OpenRouter Key missing. Please go to Settings > AI Settings.",
					);
				return new OpenRouterAdapter(settings.openRouterKey, settings.model);
			default:
				throw new Error(
					`Provider "${settings.provider || "none"}" is not configured. Please go to Settings > AI Settings.`,
				);
		}
	}

	/**
	 * Prompt the user to configure API key in settings
	 */
	async promptForConfig(message) {
		alert(message || "Please configure your AI provider in Settings > AI Settings.");
		appSettings.uiSettings["ai-settings"]?.show();
	}

	/**
	 * Build a context-injected system message for the current file
	 */
	getFileContext() {
		try {
			const file = editorManager?.activeFile;
			if (!file) return null;
			const editor = editorManager?.editor;
			const selection = editor?.state?.sliceDoc?.(
				editor.state.selection.main.from,
				editor.state.selection.main.to,
			);
			const lang = file.session?.customData?.mode || file.filename?.split(".").pop() || "unknown";
			const fileName = file.filename || "untitled";
			const fullCode = editor?.state?.doc?.toString?.() || "";

			let ctx = `You are an AI coding assistant inside Acode, a mobile code editor.\nActive file: ${fileName} (${lang})`;
			if (selection && selection.trim().length > 0) {
				ctx += `\n\nCurrently selected code:\n\`\`\`${lang}\n${selection}\n\`\`\``;
			} else if (fullCode && fullCode.length < 8000) {
				ctx += `\n\nFile contents:\n\`\`\`${lang}\n${fullCode}\n\`\`\``;
			}
			return ctx;
		} catch (_) {
			return "You are an AI coding assistant inside Acode, a mobile code editor.";
		}
	}

	/**
	 * Build full messages array with system context prepended
	 */
	buildMessages(userMessages) {
		const sysContent = this.getFileContext();
		const system = sysContent
			? [{ role: "system", content: sysContent }]
			: [];
		return [...system, ...userMessages];
	}

	/**
	 * Streaming chat — calls onChunk(token, fullText) live
	 * @param {Array} messages  plain user/assistant messages (no system)
	 * @param {function|null} onChunk
	 */
	async chat(messages, onChunk = null) {
		try {
			const adapter = await this.getActiveAdapter();
			const fullMessages = this.buildMessages(messages);
			return await adapter.chat(fullMessages, onChunk);
		} catch (error) {
			await this.promptForConfig(error.message);
			throw error;
		}
	}

	/**
	 * Code completion (no context injection — just prefix/suffix)
	 */
	async completeCode(prefix, suffix) {
		try {
			const adapter = await this.getActiveAdapter();
			if (!adapter.completeCode) return "";
			return await adapter.completeCode(prefix, suffix);
		} catch (error) {
			console.error("AI Completion error", error);
			return "";
		}
	}

	/**
	 * Run the Agentic Think → Act → Observe loop.
	 * @param {Array}    messages  - plain user/assistant messages (no system)
	 * @param {function} onEvent   - called on every agent step event
	 * @returns {Promise<string>}  - the final assistant text
	 */
	async runAgent(messages, onEvent) {
		try {
			const adapter = await this.getActiveAdapter();
			const fullMessages = this.buildMessages(messages);
			const { runAgentLoop } = await import("./agentLoop");
			return await runAgentLoop(adapter, fullMessages, onEvent);
		} catch (error) {
			await this.promptForConfig(error.message);
			throw error;
		}
	}

	// ─── Conversation History ─────────────────────────────────────────────────

	/**
	 * Returns storage key for the given file URI (or global if null)
	 */
	_historyKey(fileUri) {
		const safe = (fileUri || "global").replace(/[^a-zA-Z0-9]/g, "_");
		return `${HISTORY_PREFIX}${safe}`;
	}

	/**
	 * Load conversation history for a file URI
	 * @param {string|null} fileUri
	 * @returns {Array}
	 */
	loadHistory(fileUri) {
		try {
			const raw = localStorage.getItem(this._historyKey(fileUri));
			return raw ? JSON.parse(raw) : [];
		} catch (_) {
			return [];
		}
	}

	/**
	 * Save conversation history for a file URI
	 * @param {string|null} fileUri
	 * @param {Array} messages
	 */
	saveHistory(fileUri, messages) {
		try {
			const trimmed = messages.slice(-MAX_HISTORY_ENTRIES);
			localStorage.setItem(this._historyKey(fileUri), JSON.stringify(trimmed));
		} catch (_) {}
	}

	/**
	 * Clear history for a file URI
	 * @param {string|null} fileUri
	 */
	clearHistory(fileUri) {
		localStorage.removeItem(this._historyKey(fileUri));
	}
}

export default new AIService();
