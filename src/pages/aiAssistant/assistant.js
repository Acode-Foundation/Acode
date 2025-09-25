import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import confirm from "dialogs/confirm";
import select from "dialogs/select";
import Ref from "html-tag-js/ref";
import EditorFile from "lib/editorFile";
import { createSessionManager } from "./agent/sessionManager";
import styles from "./assistant.m.scss";
import { CordovaSqliteSaver } from "./memory";
import { createChatStore } from "./state/chatStore";
import { SYSTEM_PROMPT } from "./system_prompt";
import { allTools } from "./tools";
import { createMessageRenderer } from "./ui/messageRenderer";

const GEMINI_API_KEY = ""; // Replace

export default function openAIAssistantPage() {
	// References
	const profileBtnRef = Ref();
	const historySidebarRef = Ref();
	const chatInputRef = Ref();
	const sendBtnRef = Ref();
	const messageContainerRef = Ref();
	const stopBtnRef = Ref();

	let currentProfile = "ask";
	let currentController = null;
	let aiTabInstance;

	const chatStore = createChatStore();

	const messageRenderer = createMessageRenderer({
		messageContainerRef,
		onUserEdit: handleEditMessage,
	});

	const agentCheckpointer = new CordovaSqliteSaver();
	const model = new ChatOpenAI({
		model: "openrouter/sonoma-sky-alpha",
		apiKey: GEMINI_API_KEY,
		streaming: true,
		configuration: {
			baseURL: "https://openrouter.ai/api/v1",
		},
	});

	const toolsArray = Object.values(allTools);

	const agent = createReactAgent({
		llm: model,
		tools: toolsArray,
		checkpointSaver: agentCheckpointer,
		stateModifier: SYSTEM_PROMPT,
	});

	const sessionManager = createSessionManager(agent);

	function getActiveConversationId() {
		return chatStore.getConversationId();
	}

	function handleProfileSwitch(profile, { updateStore = true } = {}) {
		const iconEl = profileBtnRef.el?.querySelector("i:first-child");
		const textEl = profileBtnRef.el?.querySelector("span");

		currentProfile = profile;

		if (iconEl && textEl) {
			if (profile === "ask") {
				iconEl.className = "icon help";
				textEl.textContent = "Ask";
			} else {
				iconEl.className = "icon edit";
				textEl.textContent = "Write";
			}
		}

		if (updateStore) {
			void chatStore.setProfile(profile);
		}
	}

	async function showProfileMenu(e) {
		e.preventDefault();
		const profile = await select("Select Profile", [
			{
				value: "ask",
				text: "Ask",
				icon: "help",
			},
			{
				value: "write",
				text: "Write",
				icon: "edit",
			},
		]);
		if (profile) handleProfileSwitch(profile);
	}

	function toggleHistorySidebar() {
		if (!historySidebarRef.el) return;
		historySidebarRef.el.classList.toggle("hidden");
	}

	function handleChatInput() {
		if (!chatInputRef.el) return;
		const value = chatInputRef.el.value || "";
		if (sendBtnRef.el) {
			sendBtnRef.el.disabled = value.trim().length === 0;
		}
		chatInputRef.el.style.height = "auto";
		chatInputRef.el.style.height =
			Math.min(chatInputRef.el.scrollHeight, 120) + `px`;
	}

	async function updateHistorySidebar() {
		if (!historySidebarRef.el) return;
		const conversations = await chatStore.listConversations();
		const historyItemsContainer =
			historySidebarRef.el.querySelector(".chat-history");
		if (!historyItemsContainer) return;

		historyItemsContainer.innerHTML = "";
		const activeConversationId = getActiveConversationId();

		conversations.forEach((conv) => {
			const item = (
				<div
					className={`history-item ${
						conv.id === activeConversationId ? "active" : ""
					}`}
					onclick={() => {
						if (conv.id !== activeConversationId) {
							loadConversation(conv.id);
							toggleHistorySidebar();
						}
					}}
				/>
			);

			const iconWrapper = (
				<div className="history-icon">
					<i
						className={`icon ${conv.profile === "write" ? "edit" : "chat_bubble"}`}
					></i>
				</div>
			);
			const textWrapper = (
				<div className="history-text">{conv.title || "Untitled"}</div>
			);
			const deleteBtn = (
				<button
					className="btn btn-icon history-delete"
					title="Delete conversation"
					onclick={async (e) => {
						e.stopPropagation();
						const confirmed = await confirm(
							"Delete conversation?",
							"This will delete the conversation permanently.",
						);
						if (!confirmed) return;
						const previousActiveId = getActiveConversationId();
						await chatStore.deleteConversationById(conv.id);
						if (conv.id === previousActiveId) {
							await reloadOrCreateConversation(null);
						}
						updateHistorySidebar();
					}}
				>
					<i className="icon delete"></i>
				</button>
			);

			item.append(iconWrapper, textWrapper, deleteBtn);
			historyItemsContainer.appendChild(item);
		});
	}

	async function loadConversation(conversationId) {
		currentController?.abort();
		currentController = null;

		messageRenderer.clearMessages();

		if (conversationId) {
			const loaded = await chatStore.loadConversation(conversationId);
			if (loaded) {
				currentProfile = chatStore.getProfile();
				handleProfileSwitch(currentProfile, { updateStore: false });

				loaded.messages.forEach((msg) => {
					if (msg.role === "tool") {
						try {
							const toolPayload = JSON.parse(msg.content);
							const toolState = {
								id: toolPayload.id || msg.id,
								name: toolPayload.name,
								status: toolPayload.status,
								argsText:
									typeof toolPayload.args === "string"
										? toolPayload.args
										: undefined,
								argsObject:
									typeof toolPayload.args === "object"
										? toolPayload.args
										: undefined,
								output: toolPayload.output,
								stage: "complete",
								isNew: true,
								parentMessageId: toolPayload.parentMessageId,
							};
							messageRenderer.renderToolEvent(toolState, {
								targetMessageId: toolPayload.parentMessageId,
								fallbackToStandalone: true,
							});
						} catch (error) {
							console.error("Failed to parse tool message", error);
						}
					} else {
						messageRenderer.renderMessage(msg);
					}
				});
			}
		}

		if (!chatStore.getConversation()) {
			await chatStore.startNewConversation(currentProfile);
		}

		updateHistorySidebar();
		chatInputRef.el?.focus();
	}

	async function reloadOrCreateConversation(conversationId) {
		if (conversationId) {
			await loadConversation(conversationId);
			return;
		}
		await chatStore.startNewConversation(currentProfile);
		messageRenderer.clearMessages();
		updateHistorySidebar();
		chatInputRef.el?.focus();
	}

	async function handleSendBtn() {
		const inputEl = chatInputRef.el;
		if (!inputEl) return;

		const userInput = (inputEl.value || "").trim();
		if (!userInput) return;

		const userMessage = await chatStore.prepareMessage("user", userInput);
		messageRenderer.renderMessage(userMessage, { renderMarkdown: false });

		inputEl.value = "";
		handleChatInput();

		messageRenderer.showLoadingIndicator();

		const { isFirstUserMessage } =
			await chatStore.commitUserMessage(userMessage);

		updateHistorySidebar();

		const assistantMessageId = chatStore.generateMessageId();
		const assistantTimestamp = Date.now();
		const assistantMessage = await chatStore.prepareMessage("assistant", "", {
			id: assistantMessageId,
			timestamp: assistantTimestamp,
		});

		currentController = new AbortController();
		if (sendBtnRef.el) sendBtnRef.el.style.display = "none";
		if (stopBtnRef.el) stopBtnRef.el.style.display = "block";

		let streamedContent = "";
		let assistantMessageRendered = false;

		try {
			const result = await sessionManager.runTurn({
				conversationId: getActiveConversationId(),
				userMessage: { role: "user", content: userInput },
				signal: currentController.signal,
				assistantMessageId,
				onStart: () => {
					messageRenderer.removeLoadingIndicator();
					messageRenderer.renderAssistantPlaceholder(assistantMessage);
					assistantMessageRendered = true;
				},
				onToken: ({ fullText }) => {
					streamedContent = fullText;
					messageRenderer.updateAssistantStreaming(
						assistantMessageId,
						fullText,
						{ showCursor: true },
					);
				},
				onToolEvent: (toolState) => {
					messageRenderer.renderToolEvent(toolState, {
						targetMessageId: assistantMessageId,
					});
				},
			});

			streamedContent = result.content;

			messageRenderer.updateAssistantStreaming(
				assistantMessageId,
				streamedContent,
				{ showCursor: false },
			);

			const finalTimestamp = Date.now();
			assistantMessage.content = streamedContent;
			assistantMessage.timestamp = finalTimestamp;
			messageRenderer.finalizeAssistantMessage(
				assistantMessageId,
				streamedContent,
				finalTimestamp,
			);

			await chatStore.commitAssistantMessage(assistantMessage, {
				wasError: false,
			});

			if (Array.isArray(result.toolRuns) && result.toolRuns.length) {
				for (const toolRun of result.toolRuns) {
					await chatStore.commitToolMessage(toolRun);
				}
			}

			updateHistorySidebar();
		} catch (error) {
			messageRenderer.removeLoadingIndicator();

			const isAbort =
				error.name === "AbortError" ||
				(error.message && /abort/i.test(error.message));

			const errorContent = isAbort
				? `<span class="badge badge-yellow">Streaming cancelled by user.</span>`
				: `<span class="badge badge-red">Error: ${error.message || "Unknown error."}</span>`;

			if (!assistantMessageRendered) {
				messageRenderer.renderAssistantPlaceholder(assistantMessage);
				assistantMessageRendered = true;
			}

			assistantMessage.content = `${streamedContent}${errorContent}`;
			assistantMessage.timestamp = Date.now();
			messageRenderer.updateAssistantStreaming(
				assistantMessageId,
				assistantMessage.content,
			);
			messageRenderer.finalizeAssistantMessage(
				assistantMessageId,
				assistantMessage.content,
				assistantMessage.timestamp,
			);

			await chatStore.commitAssistantMessage(assistantMessage, {
				wasError: !isAbort,
			});

			if (error.toolRuns) {
				for (const toolRun of error.toolRuns) {
					await chatStore.commitToolMessage(toolRun);
				}
			}

			updateHistorySidebar();
		} finally {
			currentController = null;
			if (sendBtnRef.el) sendBtnRef.el.style.display = "block";
			if (stopBtnRef.el) stopBtnRef.el.style.display = "none";
			handleChatInput();
		}

		if (isFirstUserMessage) {
			updateHistorySidebar();
		}
	}

	function handleStopBtn() {
		if (currentController) {
			currentController.abort();
			currentController = null;
			if (stopBtnRef.el) stopBtnRef.el.style.display = "none";
			if (sendBtnRef.el) sendBtnRef.el.style.display = "block";
		}
	}

	function handleEditMessage(message) {
		if (!message || !messageContainerRef.el) return;
		const messageEl = messageContainerRef.el.querySelector(
			`#message-${message.id}`,
		);
		if (!messageEl) return;

		const messageContent = messageEl.querySelector(".message-content");
		if (!messageContent) return;

		const editContainer = <div className="edit-container"></div>;

		const textarea = (
			<textarea
				className="edit-textarea"
				defaultValue={message.content}
				placeholder="Edit your message..."
				onkeydown={(e) => {
					if (e.key === "Enter" && e.ctrlKey) {
						e.preventDefault();
						// TODO: save edit
					} else if (e.key === "Escape") {
						e.preventDefault();
						messageContent.textContent = message.content;
					}
				}}
			/>
		);

		const editActions = <div className="edit-actions"></div>;

		const editInfo = (
			<div className="edit-info">
				Press Ctrl+Enter to save, Escape to cancel
			</div>
		);

		const editButtons = (
			<div className="edit-buttons">
				<button
					className="btn btn-sm btn-outline"
					onclick={() => {
						messageContent.textContent = message.content;
					}}
				>
					<i className="icon clearclose"></i>{" "}
					<span className="btn-text">Cancel</span>
				</button>
				<button className="btn btn-sm btn-primary">
					<i className="icon check"></i> <span className="btn-text">Save</span>
				</button>
			</div>
		);

		editActions.append(editInfo, editButtons);
		editContainer.append(textarea, editActions);

		messageContent.innerHTML = "";
		messageContent.appendChild(editContainer);

		textarea.focus();
		textarea.select();
	}

	const aiAssistantContainer = (
		<div className="chat-container">
			<div className="chat-header">
				<div className="header-left">
					<button
						className="btn btn-icon"
						title="Toggle chat history"
						onclick={toggleHistorySidebar}
					>
						<i className="icon menu"></i>
					</button>
					<div className="separator"></div>
					<button
						className="btn btn-secondary"
						onclick={() => reloadOrCreateConversation(null)}
					>
						<i className="icon add"></i>
						<span>New Chat</span>
					</button>
				</div>
				<div className="header-right">
					<button
						className="btn btn-secondary"
						onclick={showProfileMenu}
						ref={profileBtnRef}
					>
						<i className="icon help"></i>
						<span>Ask</span>
						<i className="icon keyboard_arrow_down"></i>
					</button>
				</div>
			</div>

			<div className="chat-main">
				<div className="chat-sidebar hidden" ref={historySidebarRef}>
					<div className="sidebar-header">
						<div className="sidebar-title">History</div>
						<div className="sidebar-actions">
							<button
								className="btn btn-icon"
								title="New Chat from Sidebar"
								onclick={() => reloadOrCreateConversation(null)}
							>
								<i className="icon add"></i>
							</button>
						</div>
					</div>
					<div className="chat-history"></div>
				</div>

				<div className="messages-wrapper" id="messages-wrapper">
					<div
						className="messages-container"
						id="messages-container"
						ref={messageContainerRef}
					></div>
				</div>
			</div>

			<div className="input-area">
				<div className="input-container">
					<button className="attach-btn" title="Attach file">
						<i className="icon attach_file"></i>
					</button>
					<textarea
						className="chat-input"
						id="chat-input"
						placeholder="Message..."
						rows={1}
						ref={chatInputRef}
						oninput={handleChatInput}
						onkeydown={(e) => {
							if (
								e.key === "Enter" &&
								!e.shiftKey &&
								sendBtnRef.el &&
								!sendBtnRef.el.disabled
							) {
								e.preventDefault();
								handleSendBtn();
							}
						}}
					></textarea>
					<div className="action-buttons">
						<button
							className="action-btn stop-btn"
							id="stop-btn"
							ref={stopBtnRef}
							onclick={handleStopBtn}
							title="Stop"
							style={{ display: "none" }}
						>
							<i className="icon block"></i>
						</button>
						<button
							className="action-btn send-btn"
							id="send-btn"
							ref={sendBtnRef}
							onclick={handleSendBtn}
							title="Send"
							disabled
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<line x1="22" y1="2" x2="11" y2="13" />
								<polygon points="22,2 15,22 11,13 2,9" />
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	);

	(async () => {
		try {
			const conversations = await chatStore.listConversations();
			if (conversations.length > 0) {
				await loadConversation(conversations[0].id);
			} else {
				await reloadOrCreateConversation(null);
			}
		} catch (error) {
			console.error(
				"Failed to initialize AI Assistant page or database:",
				error,
			);
			const errDiv = `<div class="error-message acode-error">Failed to initialize AI Assistant: ${error.message}. Ensure SQLite plugin is functional.</div>`;
			if (messageContainerRef.el) {
				messageContainerRef.el.innerHTML = errDiv;
			} else {
				alert(
					`Critical Error: AI Assistant failed to initialize. ${error.message}`,
				);
			}
		}
	})();

	const uri = "ai://assistant";
	const existingFile = window.editorManager.getFile(uri, "uri");
	if (existingFile) {
		existingFile.makeActive();
		return;
	}

	aiTabInstance = new EditorFile("AI Assistant", {
		uri: uri,
		type: "page",
		tabIcon: "file file_type_assistant",
		content: aiAssistantContainer,
		render: true,
		stylesheets: [styles],
		hideQuickTools: true,
	});

	messageRenderer.setEditorInstance(aiTabInstance);
}
