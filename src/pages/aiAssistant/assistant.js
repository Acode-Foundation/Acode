import { isAIMessageChunk, isToolMessageChunk } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import confirm from "dialogs/confirm";
import select from "dialogs/select";
import Ref from "html-tag-js/ref";
import EditorFile from "lib/editorFile";
import settings from "lib/settings";
import markdownIt from "markdown-it";
import styles from "./assistant.m.scss";
import {
	addConversation,
	addMessageToDB,
	deleteConversation,
	getAllConversations,
	getConversation,
	getMessagesForConversation,
	updateConversation,
} from "./db";
import { CordovaSqliteSaver } from "./memory";
import { SYSTEM_PROMPT } from "./system_prompt";
import { allTools } from "./tools";

export default function openAIAssistantPage() {
	// References
	const profileBtnRef = Ref();
	const historySidebarRef = Ref();
	const chatInputRef = Ref();
	const sendBtnRef = Ref();
	const messageContainerRef = Ref();
	const stopBtnRef = Ref();

	let currentProfile = "ask";
	let currentConversationId = null;
	let currentConversation = null;
	let chatHistory = [];
	let currentController = null;
	let aiTabInstance;

	const GEMINI_API_KEY = ""; // Replace

	const agentCheckpointer = new CordovaSqliteSaver();
	const model = new ChatGoogleGenerativeAI({
		model: "gemini-2.0-flash",
		apiKey: GEMINI_API_KEY,
	});

	// Get all tools as an array for the agent including search
	const toolsArray = Object.values(allTools);

	const agent = createReactAgent({
		llm: model,
		tools: toolsArray,
		checkpointSaver: agentCheckpointer,
		stateModifier: SYSTEM_PROMPT,
	});

	const generateConversationId = () =>
		`conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
	const generateMessageId = (() => {
		let counter = 0;
		return () => `msg_${Date.now()}_${++counter}`;
	})();

	const formatTime = (timestamp) =>
		new Date(timestamp).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});

	const copyToClipboard = (text) => {
		cordova.plugins.clipboard.copy(text || "");
	};

	const scrollToBottom = () => {
		messageContainerRef.el.scrollTop = messageContainerRef.el.scrollHeight;
	};

	// Format code blocks with custom UI elements
	const formatCodeBlocks = (contentElement, content) => {
		if (!contentElement) return;

		const md = markdownIt({
			html: true,
			linkify: true,
			typographer: true,
		});

		contentElement.innerHTML = md.render(content);

		contentElement.innerHTML = contentElement.innerHTML.replace(
			/<pre><code(?: class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g,
			(match, language, code) => {
				language = language || "plaintext";
				return `
					<div class="code-block">
						<div class="code-header">
							<div class="code-language">
								<i class="icon code"></i>
								<span>${language}</span>
							</div>
							<div class="code-actions">
								<button class="btn btn-icon code-copy" title="Copy code">
									<i class="icon copy"></i>
								</button>
							</div>
						</div>
						<div class="code-content">
							<pre><code class="language-${language}">${code}</code></pre>
						</div>
						<div class="code-expand">
							<i class="icon keyboard_arrow_down"></i>
							<span>Show more</span>
						</div>
					</div>
				`;
			},
		);

		contentElement.querySelectorAll(".code-block").forEach((codeBlock) => {
			const codeContent = codeBlock.querySelector(".code-content");
			const codeElement = codeBlock.querySelector("pre code");
			const copyButton = codeBlock.querySelector(".code-copy");
			const expandButton = codeBlock.querySelector(".code-expand");

			// Apply Ace highlighting
			if (codeElement) {
				const langMatch = codeElement.className.match(/language-(\w+)/);
				if (langMatch) {
					const langMap = {
						bash: "sh",
						shell: "sh",
					};
					const lang = langMatch[1];
					const mappedLang = langMap[lang] || lang;
					const highlight = ace.require("ace/ext/static_highlight");
					highlight.render(
						codeElement.textContent,
						`ace/mode/${mappedLang}`,
						settings.value.editorTheme.startsWith("ace/theme/")
							? settings.value.editorTheme
							: "ace/theme/" + settings.value.editorTheme,
						1,
						true,
						(highlighted) => {
							aiTabInstance?.addStyle(highlighted.css);
							codeElement.innerHTML = highlighted.html;
						},
					);
				}
			}

			// copy functionality
			copyButton.addEventListener("click", async () => {
				const code = codeElement?.textContent || "";
				try {
					cordova.plugins.clipboard.copy(code);
					copyButton.querySelector("i").className = "icon check";
					setTimeout(() => {
						copyButton.querySelector("i").className = "icon copy";
					}, 2000);
				} catch (err) {
					copyButton.querySelector("i").className =
						"icon warningreport_problem";
					setTimeout(() => {
						copyButton.querySelector("i").className = "icon copy";
					}, 2000);
				}
			});

			// expand/collapse functionality
			expandButton.addEventListener("click", () => {
				const isExpanded = codeContent.classList.contains("expanded");
				codeContent.classList.toggle("expanded", !isExpanded);
				expandButton.innerHTML = isExpanded
					? `<i class="icon keyboard_arrow_down"></i> <span>Show more</span>`
					: `<i class="icon keyboard_arrow_up"></i> <span>Show less</span>`;
			});

			// Only show expand button if content overflows
			if (codeContent.scrollHeight <= codeContent.clientHeight) {
				expandButton.style.display = "none";
			}
		});
	};

	const addMessage = (message) => {
		const messageEl = tag("div", {
			className: `message ${message.role === "user" ? "user" : ""}`,
			id: `message-${message.id}`,
		});
		const messageHeader = tag("div", {
			className: "message-header",
		});
		const messageSender = tag("div", {
			className: `message-sender ${message.role === "user" ? "user" : "ai"}`,
			textContent: message.role === "user" ? "You" : "AI",
		});
		const messageActions = tag("div", {
			className: "message-actions",
		});
		const messageTime = tag("div", {
			className: "message-time",
			textContent: formatTime(message.timestamp),
		});
		messageActions.appendChild(messageTime);

		if (message.role === "assistant") {
			const copyBtn = tag("button", {
				className: "btn btn-icon",
				title: "Copy message",
				child: tag("i", {
					className: "icon copy",
				}),
				onclick: () => copyToClipboard(message.content),
			});
			messageActions.appendChild(copyBtn);
		}

		if (message.role === "user") {
			const editBtn = tag("button", {
				className: "btn btn-icon",
				title: "Edit message",
				child: tag("i", {
					className: "icon edit",
				}),
				onclick: () => editMessage(message.id),
			});
			messageActions.appendChild(editBtn);
		}

		messageHeader.appendChild(messageSender);
		messageHeader.appendChild(messageActions);

		const messageContent = tag("div", {
			className: "message-content md",
		});

		if (message.role === "user") {
			messageContent.textContent = message.content;
		} else {
			const md = markdownIt({
				html: true,
				linkify: true,
				typographer: true,
			});
			messageContent.innerHTML = md.render(message.content);
		}

		messageEl.appendChild(messageHeader);
		messageEl.appendChild(messageContent);
		messageContainerRef.el.appendChild(messageEl);
		scrollToBottom();
	};

	const editMessage = (messageId) => {
		const message = chatHistory.find((msg) => msg.id === messageId);
		if (!message) return;

		const messageEl = messageContainerRef.el.querySelector(
			`#message-${message.id}`,
		);
		const messageContent = messageEl.querySelector(".message-content");

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
						// TODO: cancel edit
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
						const md = markdownIt({
							html: true,
							linkify: true,
							typographer: true,
						});
						messageContent.innerHTML = md.render(message.content);
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
	};

	/**
	 * Updates the profile button appearance and state
	 * @param {string} profile - Profile type ("ask" or "write")
	 */
	const handleProfileSwitch = (profile) => {
		const iconEl = profileBtnRef.el.querySelector("i:first-child");
		const textEl = profileBtnRef.el.querySelector("span");

		currentProfile = profile;

		// Update button appearance based on selected profile
		if (profile === "ask") {
			iconEl.className = "icon help";
			textEl.textContent = "Ask";
		} else {
			iconEl.className = "icon edit";
			textEl.textContent = "Write";
		}
	};

	/**
	 * Shows profile selection menu
	 */
	const showProfileMenu = async (e) => {
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
		handleProfileSwitch(profile);
	};
	const toggleHistorySidebar = () => {
		historySidebarRef.classList.toggle("hidden");
	};

	const showLoading = () => {
		const loadingEl = tag("div", {
			className: "ai_loading",
			id: "loading-indicator",
		});
		const loadingDots = tag("div", {
			className: "loading-dots",
		});

		for (let i = 0; i < 3; i++) {
			const dot = tag("div", {
				className: "loading-dot",
			});
			loadingDots.appendChild(dot);
		}

		const text = tag("span", {
			textContent: "AI is thinking...",
		});

		loadingEl.appendChild(loadingDots);
		loadingEl.appendChild(text);

		messageContainerRef.el.appendChild(loadingEl);
		scrollToBottom();
	};

	const removeLoading = () => {
		const loadingEl =
			messageContainerRef.el.querySelector("#loading-indicator");
		if (loadingEl) {
			messageContainerRef.el.removeChild(loadingEl);
		}
	};

	const handleChatInput = () => {
		sendBtnRef.el.disabled = chatInputRef.value.trim().length === 0;
		chatInputRef.el.style.height = "auto";
		chatInputRef.el.style.height =
			Math.min(chatInputRef.el.scrollHeight, 120) + `px`;
	};

	async function updateHistorySidebar() {
		if (!historySidebarRef.el) return;
		const conversations = await getAllConversations();
		const historyItemsContainer =
			historySidebarRef.el.querySelector(".chat-history");
		if (!historyItemsContainer) return;
		historyItemsContainer.innerHTML = "";
		conversations.forEach((conv) => {
			const item = (
				<div
					className={`history-item ${conv.id === currentConversationId ? "active" : ""}`}
					onclick={() => {
						if (conv.id !== currentConversationId) {
							loadOrCreateConversation(conv.id);
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

			const text = (
				<div className="history-text">{conv.title || "Untitled Chat"}</div>
			);

			const deleteBtn = (
				<button className="btn btn-icon history-delete" title="Delete chat">
					<i className="icon delete"></i>
				</button>
			);
			deleteBtn.onclick = async (e) => {
				e.stopPropagation();
				const confirmation = await confirm(
					"Delete Chat",
					`Are you sure you want to delete "<strong>${conv.title || "Untitled Chat"}</strong>"? This action cannot be undone.`,
					true,
				);
				if (!confirmation) return;
				await deleteConversation(conv.id);
				if (conv.id === currentConversationId) {
					await loadOrCreateConversation(null);
				}
				await updateHistorySidebar();
			};

			item.append(iconWrapper, text, deleteBtn);
			historyItemsContainer.appendChild(item);
		});
	}

	async function loadOrCreateConversation(conversationIdToLoad) {
		if (currentController) currentController.abort();
		currentController = null;

		if (conversationIdToLoad) {
			const conversation = await getConversation(conversationIdToLoad);
			if (conversation) {
				currentConversation = conversation;
				currentConversationId = conversation.id;
				handleProfileSwitch(currentConversation.profile || "ask");
				const messagesFromDB = await getMessagesForConversation(
					currentConversationId,
				);
				if (messageContainerRef.el) messageContainerRef.el.innerHTML = "";
				chatHistory = [];
				messagesFromDB.forEach((msg) => {
					addMessage(msg);
					if (msg.role === "assistant") {
						formatCodeBlocks(
							messageContainerRef.el.querySelector(
								`#message-${msg.id} .message-content`,
							),
							msg.content,
						);
					}
					chatHistory.push({
						id: msg.id,
						role: msg.role,
						content: msg.content,
					});
				});
			} else {
				console.warn(
					`Conversation ${conversationIdToLoad} not found. Starting new one.`,
				);
				conversationIdToLoad = null;
			}
		}

		if (!conversationIdToLoad) {
			currentConversationId = generateConversationId();
			const now = Date.now();
			currentConversation = {
				id: currentConversationId,
				title: "New Chat",
				createdAt: now,
				lastModifiedAt: now,
				profile: currentProfile,
			};
			await addConversation(currentConversation);
			chatHistory = [];
			if (messageContainerRef.el) messageContainerRef.el.innerHTML = "";
		}
		updateHistorySidebar();
		if (chatInputRef.el) chatInputRef.el.focus();
	}

	async function saveUserMessageAndUpdateConversation(
		userMessage,
		currentConv,
		isFirstUIMessage,
	) {
		if (isFirstUIMessage && currentConv && currentConv.title === "New Chat") {
			currentConv.title =
				userMessage.content.substring(0, 30) +
				(userMessage.content.length > 30 ? "..." : "");
		}
		if (currentConv) {
			currentConv.lastModifiedAt = Date.now();
			await updateConversation(currentConv);
		}
		await addMessageToDB(userMessage);
	}

	const handleSendBtn = async () => {
		const userInput = chatInputRef.value.trim();

		if (!userInput) return;
		if (!currentConversationId) {
			alert("Error: No active conversation. Please start a new chat.");
			return;
		}

		const userMsgId = {
			id: generateMessageId(),
			conversationId: currentConversationId,
			role: "user",
			content: userInput,
			timestamp: Date.now(),
		};
		addMessage(userMsgId);

		const userMessageForAgent = {
			role: "user",
			content: userInput,
		};
		chatHistory.push({
			...userMessageForAgent,
			id: userMsgId.id,
		});

		chatInputRef.el.value = "";
		handleChatInput();
		saveUserMessageAndUpdateConversation(
			userMsgId,
			currentConversation,
			chatHistory.filter((msg) => msg.role === "user").length === 1,
		);

		showLoading();

		let messagesForAgentTurn;
		if (chatHistory.filter((msg) => msg.role === "user").length === 1) {
			messagesForAgentTurn = [userMessageForAgent];
		} else {
			messagesForAgentTurn = [userMessageForAgent];
		}

		currentController = new AbortController();
		sendBtnRef.el.style.display = "none";
		stopBtnRef.el.style.display = "block";

		const assistantMsgId = generateMessageId();
		let streamedContent = "";
		let wasError = false;
		let finalTimestamp = Date.now();
		const md = markdownIt({
			html: true,
			linkify: true,
			typographer: true,
		});

		try {
			//Chat history not passed anymore, memory saver and checkpoint will handle context
			const inputsForAgent = {
				messages: messagesForAgentTurn,
			};

			const stream = await agent.stream(inputsForAgent, {
				streamMode: "messages",
				signal: currentController.signal,
				//thread_id is the checkpoint marker
				configurable: {
					thread_id: currentConversationId,
				},
			});

			// Remove loading indicator
			removeLoading();

			const assistantPlaceholderMsg = {
				id: assistantMsgId,
				conversationId: currentConversationId,
				role: "assistant",
				content: "▌",
				timestamp: Date.now(),
			};
			addMessage(assistantPlaceholderMsg);

			const messageElContent = messageContainerRef.el.querySelector(
				`#message-${assistantMsgId} .message-content`,
			);

			for await (const eventData of stream) {
				let messageChunkPayload = null;
				if (
					Array.isArray(eventData) &&
					eventData.length > 0 &&
					eventData[0] &&
					typeof eventData[0].content !== "undefined"
				) {
					messageChunkPayload = eventData[0];
				} else if (eventData && typeof eventData.content !== "undefined") {
					messageChunkPayload = eventData;
				}

				let chunkText = "";
				if (messageChunkPayload) {
					if (isToolMessageChunk(messageChunkPayload)) {
						console.log("tool call", messageChunkPayload);
					} else if (
						isAIMessageChunk(messageChunkPayload) &&
						messageChunkPayload.tool_call_chunks?.length
					) {
						chunkText = messageChunkPayload.tool_call_chunks
							.map((tc) => (tc.args ? JSON.stringify(tc.args) : ""))
							.join("\n");
					} else if (typeof messageChunkPayload.content === "string") {
						chunkText = messageChunkPayload.content;
					} else if (typeof messageChunkPayload === "string") {
						chunkText = messageChunkPayload;
					}
				}

				if (chunkText) {
					streamedContent += chunkText;
					if (messageElContent) {
						messageElContent.innerHTML = md.render(streamedContent + " ▌");
						scrollToBottom();
					}
				}
			}
			finalTimestamp = Date.now();
			if (messageElContent) {
				messageElContent.innerHTML = md.render(streamedContent);
			}
		} catch (err) {
			removeLoading();
			wasError = true;
			finalTimestamp = Date.now();
			const isAbort =
				err.name === "AbortError" ||
				(err.message && /abort/i.test(err.message));

			const errorContent = isAbort
				? `<span class="badge badge-yellow">Streaming cancelled by user.</span>`
				: `<span class="badge badge-red">Error: ${err.message || "Unknown error."}</span>`;

			streamedContent += errorContent;

			const targetMessageElContent = messageContainerRef.el.querySelector(
				`#message-${assistantMsgId} .message-content`,
			);
			if (targetMessageElContent) {
				targetMessageElContent.innerHTML += errorContent;
			} else {
				const assistantErrorMsg = {
					id: assistantMsgId,
					conversationId: currentConversationId,
					role: "assistant",
					content: errorContent,
					timestamp: Date.now(),
				};
				addMessage(assistantErrorMsg);
			}
		} finally {
			currentController = null;
			if (sendBtnRef.el) sendBtnRef.el.style.display = "block";
			if (stopBtnRef.el) stopBtnRef.el.style.display = "none";
			handleChatInput();

			const assistantFinalData = {
				id: assistantMsgId,
				conversationId: currentConversationId,
				role: "assistant",
				content: streamedContent,
				timestamp: finalTimestamp,
			};
			await addMessageToDB(assistantFinalData);
			if (currentConversation && !wasError) {
				currentConversation.lastModifiedAt = finalTimestamp;
				await updateConversation(currentConversation);
			}

			if (!wasError) {
				chatHistory.push({
					id: assistantFinalData.id,
					role: "assistant",
					content: streamedContent,
				});
			}
			updateHistorySidebar();

			const messageContentElToFinalize = messageContainerRef.el?.querySelector(
				`#message-${assistantMsgId} .message-content`,
			);
			if (messageContentElToFinalize && !wasError) {
				const timeEl = messageContainerRef.el.querySelector(
					`#message-${assistantMsgId} .message-actions .message-time`,
				);
				if (timeEl) timeEl.textContent = formatTime(finalTimestamp);

				formatCodeBlocks(messageContentElToFinalize, streamedContent);
			}
		}
	};

	const handleStopBtn = () => {
		if (currentController) {
			currentController?.abort();
			currentController = null;
			stopBtnRef.el.style.display = "none";
			sendBtnRef.el.style.display = "block";
		}
	};

	const aiAssistantContainer = (
		<div className="chat-container">
			{/* Header */}
			<div className="chat-header">
				<div className="header-left">
					<button
						className="btn btn-sm btn-outline"
						id="new-chat-btn"
						onclick={() => loadOrCreateConversation(null)}
					>
						<i className="icon add"></i>
						<span className="btn-text">New Chat</span>
					</button>
					<div className="separator"></div>
					<button
						onclick={toggleHistorySidebar}
						className="btn btn-sm btn-outline"
						id="toggle-history-btn"
					>
						<i className="icon historyrestore"></i>
						<span className="btn-text">History</span>
					</button>
					<div className="separator"></div>
					<div className="profile-switcher">
						<button
							className="profile-button"
							id="profile-btn"
							ref={profileBtnRef}
							onclick={showProfileMenu}
						>
							<i className="icon help"></i>
							<span>Ask</span>
							<i className="icon keyboard_arrow_down"></i>
						</button>
					</div>
				</div>
				<div className="header-right">
					<button
						className="btn btn-icon btn-outline"
						id="settings-btn"
						title="Settings"
					>
						<i className="icon settings"></i>
						{/* onclick for settings TODO: e.g. onclick={openSettingsPage} */}
					</button>
				</div>
			</div>

			{/* Main content */}
			<div className="chat-main">
				<div
					className="chat-sidebar hidden"
					id="chat-sidebar"
					ref={historySidebarRef}
				>
					<div className="sidebar-header">
						<h3 className="sidebar-title">CHAT HISTORY</h3>
						<button
							className="btn btn-icon"
							title="New Chat from Sidebar"
							onclick={() => loadOrCreateConversation(null)}
						>
							<i className="icon add"></i>
						</button>
					</div>
					<div className="chat-history">
						{/* Populated by updateHistorySidebar */}
					</div>
				</div>

				<div className="messages-wrapper" id="messages-wrapper">
					<div
						className="messages-container"
						id="messages-container"
						ref={messageContainerRef}
					>
						{/* Messages are added by addMessage function */}
					</div>
				</div>
			</div>

			{/* Input area */}
			<div className="input-area">
				<div className="input-container">
					<button className="attach-btn" title="Attach file">
						<i className="icon attach_file"></i>
						{/* onclick for attach file: e.g. onclick={handleAttachFile} */}
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
							<i className="icon block"></i> {/* Upstream icon */}
						</button>
						<button
							className="action-btn send-btn"
							id="send-btn"
							ref={sendBtnRef}
							onclick={handleSendBtn}
							title="Send"
							disabled // Start disabled
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
			const conversations = await getAllConversations();
			if (conversations.length > 0) {
				await loadOrCreateConversation(conversations[0].id);
			} else {
				await loadOrCreateConversation(null);
			}
		} catch (error) {
			console.error(
				"Failed to initialize AI Assistant page or database:",
				error,
			);
			const errDiv = `<div class="error-message acode-error">Failed to initialize AI Assistant: ${error.message}. Ensure SQLite plugin is functional.</div>`;
			if (messageContainerRef.el) {
				// Check after potential rendering by EditorFile
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
}
