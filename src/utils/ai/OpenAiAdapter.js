import BaseProvider from "./BaseProvider";

export default class OpenAiAdapter extends BaseProvider {
	constructor(apiKey, model = "gpt-4o-mini") {
		super(apiKey, model);
		this.baseUrl = "https://api.openai.com/v1";
	}

	/**
	 * Streaming chat — calls onChunk(text) for each SSE token, returns full text
	 * @param {Array} messages
	 * @param {function} onChunk
	 */
	async chat(messages, onChunk = null) {
		const stream = !!onChunk;
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages,
				stream,
			}),
		});

		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error?.message || "OpenAI API Error");
		}

		if (!stream) {
			const data = await res.json();
			return data.choices[0].message.content;
		}

		// SSE streaming
		return this._readStream(res, onChunk);
	}

	async _readStream(res, onChunk) {
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let fullText = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split("\n");

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				const data = line.slice(6).trim();
				if (data === "[DONE]") continue;

				try {
					const json = JSON.parse(data);
					const token = json.choices?.[0]?.delta?.content;
					if (token) {
						fullText += token;
						onChunk(token, fullText);
					}
				} catch (_) {}
			}
		}

		return fullText;
	}

	/**
	 * Non-streaming chat with tool/function calling support.
	 * @param {Array} messages
	 * @param {Array} tools
	 * @returns {Promise<{content, tool_calls, finish_reason, message}>}
	 */
	async chatWithTools(messages, tools) {
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages,
				tools,
				tool_choice: "auto",
			}),
		});

		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error?.message || "OpenAI API Error");
		}

		const data = await res.json();
		const choice = data.choices[0];
		return {
			content: choice.message.content || null,
			tool_calls: choice.message.tool_calls || null,
			finish_reason: choice.finish_reason,
			message: choice.message,
		};
	}

	async completeCode(prefix, suffix) {
		// Use chat-based FIM since /completions is legacy
		const messages = [
			{
				role: "system",
				content:
					"You are a code completion engine. Output ONLY the code that fills the middle. No explanations, no markdown fences.",
			},
			{
				role: "user",
				content: `PREFIX:\n${prefix}\n\nSUFFIX:\n${suffix}\n\nFill in the middle:`,
			},
		];
		return this.chat(messages);
	}
}
