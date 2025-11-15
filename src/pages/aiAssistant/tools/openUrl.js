import { StructuredTool } from "@langchain/core/tools";
import browser from "plugins/browser";
import { z } from "zod";

const SUPPORTED_PROTOCOL = /^https?:\/\//i;

function normalizeTarget(target) {
	if (!target) return "inApp";
	if (target === "in-app" || target === "inapp") return "inApp";
	return target;
}

class OpenUrlTool extends StructuredTool {
	name = "openUrl";
	description =
		"Opens a URL in the system browser or the in-app browser. " +
		"Use this to hand off documentation, dashboards, or other web resources to the user.";

	schema = z.object({
		url: z
			.string()
			.min(1)
			.describe("Full URL including scheme (http or https)."),
		target: z
			.enum(["external", "inApp"])
			.default("inApp")
			.describe(
				"Destination: external (system browser) or inApp (Acode's built-in browser). Default inApp.",
			),
	});

	async _call({ url, target = "inApp" }) {
		const trimmedUrl = url.trim();
		if (!SUPPORTED_PROTOCOL.test(trimmedUrl)) {
			return "Error: Only http and https URLs are supported.";
		}

		const normalizedTarget = normalizeTarget(target);

		try {
			if (normalizedTarget === "inApp") {
				browser.open(trimmedUrl);
				return `Opened ${trimmedUrl} in the in-app browser.`;
			}

			if (typeof window.system.openInBrowser !== "function") {
				return "Error: External browser integration is unavailable.";
			}

			window.system.openInBrowser(trimmedUrl);
			return `Opened ${trimmedUrl} in the system browser.`;
		} catch (error) {
			return `Error opening URL: ${error.message}`;
		}
	}
}

export const openUrl = new OpenUrlTool();
