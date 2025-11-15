import {
	isAIMessageChunk,
	isToolMessage,
	isToolMessageChunk,
} from "@langchain/core/messages";

function extractText(contentLike) {
	if (!contentLike) return "";
	if (typeof contentLike === "string") return contentLike;
	if (Array.isArray(contentLike)) {
		return contentLike
			.map((item) => {
				if (!item) return "";
				if (typeof item === "string") return item;
				if (typeof item === "object" && "text" in item) return item.text ?? "";
				if (typeof item === "object" && "content" in item)
					return extractText(item.content);
				return "";
			})
			.join("");
	}
	if (typeof contentLike === "object" && "text" in contentLike) {
		return contentLike.text ?? "";
	}
	return "";
}

function ensureToolState(toolStates, toolCallId, defaults = {}) {
	if (!toolStates.has(toolCallId)) {
		toolStates.set(toolCallId, {
			id: toolCallId,
			name: defaults.name || "Tool",
			argsBuffer: "",
			argsObject: undefined,
			output: "",
			status: "running",
			isNew: true,
			stage: "start",
		});
	}
	const state = toolStates.get(toolCallId);
	Object.assign(state, defaults);
	return state;
}

export function createSessionManager(agent) {
	return {
		async runTurn({
			conversationId,
			userMessage,
			signal,
			assistantMessageId,
			onStart,
			onToken,
			onToolEvent,
		}) {
			const toolStates = new Map();
			let accumulatedText = "";

			const emitToolState = (state) => {
				if (!onToolEvent) return;
				state.parentMessageId = assistantMessageId;
				onToolEvent({
					id: state.id,
					name: state.name,
					argsText: state.argsBuffer,
					argsObject: state.argsObject,
					output: state.output,
					status: state.status,
					stage: state.stage,
					isNew: state.isNew,
					parentMessageId: assistantMessageId,
				});
				state.isNew = false;
			};

			try {
				const stream = await agent.stream(
					{ messages: [userMessage] },
					{
						streamMode: "messages",
						signal,
						configurable: {
							thread_id: conversationId,
						},
					},
				);

				onStart?.();

				for await (const event of stream) {
					const payload = Array.isArray(event) ? event[0] : event;
					if (!payload) continue;

					if (isToolMessageChunk(payload) || isToolMessage(payload)) {
						const toolCallId =
							payload.tool_call_id || payload.id || `tool_${toolStates.size}`;
						const state = ensureToolState(toolStates, toolCallId);
						const chunkText = extractText(payload.content ?? payload);
						if (chunkText) {
							state.output = `${state.output || ""}${chunkText}`;
						}
						if (payload.status) {
							state.status = payload.status === "error" ? "error" : "success";
						}
						state.stage = "output";
						emitToolState(state);
						continue;
					}

					if (isAIMessageChunk(payload)) {
						const { tool_call_chunks: toolCallChunks, tool_calls: toolCalls } =
							payload;

						if (Array.isArray(toolCallChunks) && toolCallChunks.length) {
							for (const chunk of toolCallChunks) {
								const toolCallId =
									chunk.id ||
									chunk.tool_call_id ||
									chunk.name ||
									`tool_${toolStates.size}`;
								const state = ensureToolState(toolStates, toolCallId, {
									name:
										chunk.name || toolStates.get(toolCallId)?.name || "Tool",
								});
								if (chunk.args) {
									state.argsBuffer = `${state.argsBuffer || ""}${chunk.args}`;
								}
								state.stage = "args-delta";
								emitToolState(state);
							}
						}

						if (Array.isArray(toolCalls) && toolCalls.length) {
							for (const call of toolCalls) {
								const toolCallId =
									call.id || call.name || `tool_${toolStates.size}`;
								const state = ensureToolState(toolStates, toolCallId, {
									name: call.name || toolStates.get(toolCallId)?.name || "Tool",
								});
								state.argsObject = call.args;
								try {
									state.argsBuffer = JSON.stringify(call.args, null, 2);
								} catch (error) {
									state.argsBuffer = String(call.args);
								}
								state.stage = "args-final";
								emitToolState(state);
							}
						}
					}

					const chunkText = extractText(payload?.content ?? payload);
					if (chunkText) {
						accumulatedText += chunkText;
						onToken?.({
							fullText: accumulatedText,
							delta: chunkText,
						});
					}
				}

				const toolRuns = Array.from(toolStates.values()).map((state) => {
					if (!state.status || state.status === "running") {
						state.status = "success";
					}
					state.stage = "complete";
					emitToolState(state);
					return {
						id: state.id,
						name: state.name,
						status: state.status,
						argsText: state.argsBuffer,
						argsObject: state.argsObject,
						output: state.output,
						timestamp: Date.now(),
						parentMessageId: assistantMessageId,
					};
				});

				return {
					content: accumulatedText,
					toolRuns,
				};
			} catch (error) {
				if (toolStates.size) {
					error.toolRuns = Array.from(toolStates.values()).map((state) => ({
						id: state.id,
						name: state.name,
						status: state.status,
						argsText: state.argsBuffer,
						argsObject: state.argsObject,
						output: state.output,
						timestamp: Date.now(),
						parentMessageId: assistantMessageId,
					}));
				}
				throw error;
			}
		},
	};
}
