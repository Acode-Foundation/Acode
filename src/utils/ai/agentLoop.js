import { TOOL_DEFINITIONS, TOOL_LABELS, executeTool } from "./agentTools";

const MAX_ITERATIONS = 15;

const AGENT_SYSTEM_PROMPT = `You are an expert AI coding agent inside Acode, a mobile code editor on Android.

You have access to tools that let you read, write, create, and edit files in the user's project. 
Use them proactively to complete tasks autonomously.

Guidelines:
- Always read a file before editing it to understand its current state.
- Use edit_file for small targeted changes, write_file only when rewriting completely.
- After completing changes, provide a clear summary of what you did.
- If a task is ambiguous, make a reasonable assumption and proceed.
- When you have completed the task, respond with a final natural language summary — do NOT call more tools.`;

/**
 * Run the Think → Act → Observe agent loop.
 *
 * @param {object} adapter     - An OpenAiAdapter or OpenRouterAdapter instance
 * @param {Array}  messages    - The full message history (with system context prepended)
 * @param {function} onEvent   - Callback: { type, name?, args?, result?, error?, content? }
 * @returns {Promise<string>}  - The final text response
 */
export async function runAgentLoop(adapter, messages, onEvent) {
	if (!adapter.chatWithTools) {
		throw new Error("This provider does not support tool/function calling.");
	}

	const workingMessages = [...messages];

	// Inject agent system guidance
	if (workingMessages[0]?.role === "system") {
		workingMessages[0].content += `\n\n${AGENT_SYSTEM_PROMPT}`;
	} else {
		workingMessages.unshift({ role: "system", content: AGENT_SYSTEM_PROMPT });
	}

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		// ── Think: call the LLM ──────────────────────────────────────────────
		let response;
		try {
			response = await adapter.chatWithTools(workingMessages, TOOL_DEFINITIONS);
		} catch (err) {
			onEvent({ type: "error", error: err.message });
			throw err;
		}

		// Add assistant message to history
		workingMessages.push(response.message);

		// ── No tool calls → final answer ─────────────────────────────────────
		if (!response.tool_calls || response.tool_calls.length === 0) {
			const content = response.content || "(No response)";
			onEvent({ type: "done", content });
			return content;
		}

		// ── Act + Observe: execute each tool call ────────────────────────────
		for (const toolCall of response.tool_calls) {
			const name = toolCall.function.name;
			let args;
			try {
				args = JSON.parse(toolCall.function.arguments || "{}");
			} catch {
				args = {};
			}

			const label = TOOL_LABELS[name] || name;
			const argSummary = _summarizeArgs(name, args);

			// Notify UI: tool starting
			onEvent({ type: "tool_start", name, label, argSummary });

			let result;
			try {
				result = await executeTool(name, args);
				onEvent({ type: "tool_done", name, label, result });
			} catch (err) {
				result = `Error: ${err.message}`;
				onEvent({ type: "tool_error", name, label, error: err.message });
			}

			// Feed result back to LLM as tool message
			workingMessages.push({
				role: "tool",
				tool_call_id: toolCall.id,
				content: typeof result === "string" ? result : JSON.stringify(result),
			});
		}
	}

	const timeout = "Agent reached the maximum number of steps. Task may be incomplete.";
	onEvent({ type: "done", content: timeout });
	return timeout;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _summarizeArgs(name, args) {
	switch (name) {
		case "read_file":
		case "list_dir":
		case "search_in_file":
		case "open_file":
			return args.path || "";
		case "write_file":
		case "edit_file":
			return args.path || "";
		case "apply_to_editor":
			return args.code ? args.code.slice(0, 40) + (args.code.length > 40 ? "…" : "") : "";
		default:
			return "";
	}
}
