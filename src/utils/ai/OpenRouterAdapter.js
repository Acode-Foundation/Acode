import BaseProvider from "./BaseProvider";

export default class OpenRouterAdapter extends BaseProvider {
	constructor(apiKey, model = "openai/gpt-4o-mini") {
		super(apiKey, model);
		this.baseUrl = "https://openrouter.ai/api/v1";
	}

	async chat(messages) {
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
				messages: messages,
			}),
		});

		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error?.message || "OpenRouter API Error");
		}

		const data = await res.json();
		return data.choices[0].message.content;
	}
}
