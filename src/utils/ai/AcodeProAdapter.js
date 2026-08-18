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
}
