import BaseProvider from "./BaseProvider";

export default class AcodeProAdapter extends BaseProvider {
	constructor(apiKey = "acode_pro_token", model = "claude-3-haiku") {
		super(apiKey, model);
		// Replace with the actual Acode Pro AI endpoint
		this.baseUrl = "https://api.foxdebug.com/v1/ai";
	}

	async chat(messages) {
		const res = await fetch(`${this.baseUrl}/chat`, {
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

		if (res.status === 402 || res.status === 429) {
			const error = new Error("Acode Pro subscription exhausted.");
			error.code = "QUOTA_EXHAUSTED";
			throw error;
		}

		if (!res.ok) {
			const error = await res.json();
			throw new Error(error.error?.message || "Acode Pro API Error");
		}

		const data = await res.json();
		return data.choices[0].message.content;
	}

	async completeCode(prefix, suffix) {
		// Use the chat endpoint since /complete doesn't exist on api.foxdebug.com
		const messages = [
			{
				role: "system",
				content:
					"You are a code completion assistant. Given a code prefix and suffix, output ONLY the code that fills in the middle. No explanations, no markdown, no extra text.",
			},
			{
				role: "user",
				content: `Complete the code between the prefix and suffix.\n\nPREFIX:\n${prefix}\n\nSUFFIX:\n${suffix}\n\nOutput only the fill-in-the-middle code:`,
			},
		];

		const res = await fetch(`${this.baseUrl}/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages,
				max_tokens: 64,
				temperature: 0.2,
			}),
		});

		if (res.status === 402 || res.status === 429) {
			const error = new Error("Acode Pro subscription exhausted.");
			error.code = "QUOTA_EXHAUSTED";
			throw error;
		}

		if (!res.ok) {
			throw new Error("Acode Pro Code Completion Error");
		}

		const data = await res.json();
		return data.choices[0].message.content ?? "";
	}
}
