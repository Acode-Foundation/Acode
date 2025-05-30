import { isAIMessageChunk } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import select from "dialogs/select";
import Ref from "html-tag-js/ref";
import EditorFile from "lib/editorFile";
import settings from "lib/settings";
import markdownIt from "markdown-it";
import styles from "./assistant.module.scss";

let aiTabInstance;

export default function openAIAssistantPage() {
	// References
	const profileBtnRef = new Ref();
	const historySidebarRef = new Ref();
	const chatInputRef = new Ref();
	const sendBtnRef = new Ref();
	const messageContainerRef = new Ref();
	const stopBtnRef = new Ref();

	// States
	let currentProfile = "ask"; // Default to ask profile

	const model = new ChatGoogleGenerativeAI({
		model: "gemini-2.0-flash",
		apiKey: "",
	});
	const agent = createReactAgent({ llm: model, tools: [] });

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
			{ value: "ask", text: "Ask", icon: "help" },
			{ value: "write", text: "Write", icon: "edit" },
		]);
		handleProfileSwitch(profile);
	};

	const toggleHistorySidebar = () => {
		historySidebarRef.classList.toggle("hidden");
	};

	const handleChatInput = () => {
		sendBtnRef.el.disabled = chatInputRef.value.trim().length === 0;
		chatInputRef.el.style.height = "auto";
		chatInputRef.el.style.height =
			Math.min(chatInputRef.el.scrollHeight, 120) + `px`;
	};

	const scrollToBottom = () => {
		messageContainerRef.el.scrollTop = messageContainerRef.el.scrollHeight;
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

	const formatTime = (timestamp) => {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	};

	const copyToClipboard = (text) => {
		const { clipboard } = cordova.plugins;
		clipboard.copy(text || "");
	};

	const addMessage = (message) => {
		const messageEl = tag("div", {
			className: `message ${message.role === "user" ? "user" : ""}`,
			id: `message-${message.id}`,
		});
		const messageHeader = tag("div", { className: "message-header" });
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
				child: tag("i", { className: "icon copy" }),
				onclick: () => copyToClipboard(message.content),
			});
			messageActions.appendChild(copyBtn);
		}

		if (message.role === "user") {
			const editBtn = tag("button", {
				className: "btn btn-icon",
				title: "Edit message",
				child: tag("i", { className: "icon edit" }),
				// TODO: Implement edit functionality
				//onclick: () => editMessage(message.id),
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
			messageContent.innerHTML = markdownIt().render(message.content);
		}

		messageEl.appendChild(messageHeader);
		messageEl.appendChild(messageContent);
		messageContainerRef.el.appendChild(messageEl);
		scrollToBottom();
	};

	// Generate a unique id for each message
	const generateMessageId = (() => {
		let counter = 0;
		return () => {
			counter += 1;
			return `msg_${Date.now()}_${counter}`;
		};
	})();

	// Store chat history in memory for this session
	let chatHistory = [];
	let currentController = null;

	const handleSendBtn = async () => {
		const userInput = chatInputRef.value.trim();
		if (!userInput) return;

		// Add user message to UI and history
		const userMsgId = generateMessageId();
		const userMessage = {
			id: userMsgId,
			role: "user",
			content: userInput,
			timestamp: Date.now(),
		};
		addMessage(userMessage);
		chatHistory.push({ role: "user", content: userInput });

		// Clear input
		chatInputRef.value = "";
		chatInputRef.style.height = "auto";

		// Show loading indicator
		showLoading();

		// Prepare inputs for agent
		let inputs = { messages: [...chatHistory] };
		currentController = new AbortController();

		sendBtnRef.el.style.display = "none";
		stopBtnRef.el.style.display = "block";

		const assistantMsgId = generateMessageId();

		try {
			const stream = await agent.stream(inputs, {
				streamMode: "messages",
				signal: currentController.signal,
			});

			// Remove loading indicator
			removeLoading();

			// Add assistant message placeholder
			const assistantMessage = {
				id: assistantMsgId,
				role: "assistant",
				content: "",
				timestamp: Date.now(),
			};
			addMessage(assistantMessage);

			const messageEl = messageContainerRef.el.querySelector(
				`#message-${assistantMsgId} .message-content`,
			);
			let streamedContent = "";

			for await (const [message, _metadata] of stream) {
				if (isAIMessageChunk(message) && message.tool_call_chunks?.length) {
					streamedContent += message.tool_call_chunks[0].args;
				} else {
					streamedContent += message.content;
				}

				if (messageEl) {
					messageEl.innerHTML = markdownIt().render(streamedContent);
					scrollToBottom();
				}
			}

			// After streaming, update chat history with assistant message
			chatHistory.push({ role: "assistant", content: streamedContent });

			const timeEl = messageContainerRef.el.querySelector(
				`#message-${assistantMsgId} .message-actions > div`,
			);
			if (timeEl) {
				timeEl.textContent = formatTime(Date.now());
			}
		} catch (err) {
			removeLoading();
			if (/abort/i.test(err.message)) {
				const messageEl = messageContainerRef.el.querySelector(
					`#message-${assistantMsgId} .message-content`,
				);
				if (messageEl) {
					messageEl.innerHTML += `<div class="badge badge-red">Cancelled by user.</div>`;
				}
			} else {
				const messageEl = messageContainerRef.el.querySelector(
					`#message-${assistantMsgId} .message-content`,
				);
				if (messageEl) {
					messageEl.innerHTML += markdownIt().render(`Error: ${err.message}`);
				}
			}
		} finally {
			// add custom code blocks with syntax highlighting
			const messageContent = messageContainerRef.el.querySelector(
				`#message-${assistantMsgId} .message-content`,
			);

			// Replace markdown code blocks with custom components
			messageContent.innerHTML = messageContent.innerHTML.replace(
				/<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
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

			// Process all code blocks
			const codeBlocks = messageContent.querySelectorAll(".code-block");
			codeBlocks.forEach((codeBlock) => {
				const codeContent = codeBlock.querySelector(".code-content");
				const codeElement = codeBlock.querySelector("code");
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

			currentController = null;
			sendBtnRef.el.style.display = "block";
			stopBtnRef.el.style.display = "none";
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
					<button className="btn btn-sm btn-outline" id="new-chat-btn">
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
					<button className="btn btn-icon btn-outline" id="settings-btn">
						<i className="icon settings"></i>
					</button>
				</div>
			</div>

			{/* Main content */}
			<div className="chat-main">
				{/* Chat history sidebar */}
				<div
					className="chat-sidebar hidden"
					id="chat-sidebar"
					ref={historySidebarRef}
				>
					<div className="sidebar-header">
						<h3 className="sidebar-title">CHAT HISTORY</h3>
						<button className="btn btn-icon">
							<i className="icon add"></i>
						</button>
					</div>
					<div className="chat-history">
						<div className="history-item active">
							<div className="history-icon">
								<i className="icon chat_bubble"></i>
							</div>
							<div className="history-text">File upload component</div>
						</div>
						<div className="history-item">
							<div className="history-icon">
								<i className="icon chat_bubble"></i>
							</div>
							<div className="history-text">Authentication implementation</div>
						</div>
						<div className="history-item">
							<div className="history-icon">
								<i className="icon chat_bubble"></i>
							</div>
							<div className="history-text">React state management</div>
						</div>
					</div>
				</div>

				{/* Messages area */}
				<div className="messages-wrapper" id="messages-wrapper">
					<div
						className="messages-container"
						id="messages-container"
						ref={messageContainerRef}
					>
						{/* Messages will be added here dynamically */}
					</div>
				</div>
			</div>

			{/* Input area */}
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
					></textarea>
					<div className="action-buttons">
						<button
							className="action-btn stop-btn"
							id="stop-btn"
							ref={stopBtnRef}
							onclick={handleStopBtn}
							title="Stop"
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
								strokeWidth="2"
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

	chatInputRef.el.addEventListener("input", handleChatInput);

	const uri = "ai://assistant";

	// Check if the tab is already open
	const existingFile = editorManager.getFile(uri, "uri");

	if (existingFile) {
		existingFile.makeActive();
		return;
	}

	// Create a new EditorFile instance for the AI Assistant tab
	aiTabInstance = new EditorFile("AI Assistant", {
		uri: uri,
		type: "page",
		tabIcon: "file file_type_assistant",
		content: aiAssistantContainer,
		render: true,
		stylesheets: styles,
		hideQuickTools: true,
	});
}
