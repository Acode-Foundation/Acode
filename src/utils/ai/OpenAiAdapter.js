import BaseProvider from "./BaseProvider";

export default class OpenAiAdapter extends BaseProvider {
	constructor(apiKey, model = "gpt-4o-mini") {
		super(apiKey, model);
		this.baseUrl = "https://api.openai.com/v1";
	}

	async chat(messages) {
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages: messages,
			}),
		});

		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error?.message || "OpenAI API Error");
		}

		const data = await res.json();
		return data.choices[0].message.content;
	}

	async completeCode(prefix, suffix) {
		// Example using FIM (Fill-in-the-middle) if supported, or generic prompt
		const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
		const res = await fetch(`${this.baseUrl}/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: "gpt-3.5-turbo-instruct",
				prompt: prompt,
				max_tokens: 64,
				temperature: 0.2,
			}),
		});

		if (!res.ok) {
			throw new Error("OpenAI Code Completion Error");
		}
		const data = await res.json();
		return data.choices[0].text;
	}
}
