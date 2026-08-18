import BaseProvider from "./BaseProvider";

export default class OpenRouterAdapter extends BaseProvider {
	constructor(apiKey, model = "openai/gpt-4o-mini") {
		super(apiKey, model);
		this.baseUrl = "https://openrouter.ai/api/v1";
	}

	/**
	 * Streaming chat — calls onChunk(text) for each SSE token, returns full text
	 * @param {Array} messages
	 * @param {function|null} onChunk
	 */
	async chat(messages, onChunk = null) {
		const stream = !!onChunk;
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
				"HTTP-Referer": "https://acode.foxdebug.com",
				"X-Title": "Acode",
			},
			body: JSON.stringify({
				model: this.model,
				messages,
				stream,
			}),
		});

		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error?.message || "OpenRouter API Error");
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

	async completeCode(prefix, suffix) {
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
