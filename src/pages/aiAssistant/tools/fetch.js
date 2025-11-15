import { StructuredTool } from "@langchain/core/tools";
import TurndownService from "turndown";
import { z } from "zod";

/**
 * Tool for fetching content from a URL
 */
class FetchTool extends StructuredTool {
	name = "fetch";
	description = "Fetches a URL and returns the content as Markdown.";
	schema = z.object({
		url: z.string().describe("The url to fetch."),
	});

	async _call({ url }) {
		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			url = `https://${url}`;
		}

		return new Promise((resolve, reject) => {
			cordova.plugin.http.sendRequest(
				url,
				{
					method: "get",
				},
				(response) => {
					const contentType =
						response.headers["content-type"] ||
						response.headers["Content-Type"] ||
						"";

					if (contentType.includes("text/html")) {
						// Convert HTML to Markdown
						const markdown = this.htmlToMarkdown(response.data);
						resolve(markdown);
					} else if (contentType.includes("application/json")) {
						// Return JSON as string
						const jsonString =
							typeof response.data === "string"
								? response.data
								: JSON.stringify(response.data);
						resolve(jsonString);
					} else {
						// Return as plain text
						resolve(response.data);
					}
				},
				(error) => {
					console.error(error);
					reject(error);
				},
			);
		});
	}

	htmlToMarkdown(html) {
		const turndownService = new TurndownService();
		return turndownService.turndown(html);
	}
}

export const fetchTool = new FetchTool();
