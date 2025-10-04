import tag from "html-tag-js";
import settings from "lib/settings";
import markdownIt from "markdown-it";

const md = markdownIt({
	html: true,
	linkify: true,
	typographer: true,
});

function formatTime(timestamp) {
	return new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function copyToClipboard(text = "") {
	try {
		cordova.plugins.clipboard.copy(text);
	} catch (error) {
		console.error("Clipboard copy failed", error);
	}
}

function normalizeToolStatus(status) {
	switch (status) {
		case "error":
		case "failed":
			return "error";
		case "success":
		case "completed":
			return "success";
		default:
			return "running";
	}
}

function prettifyArgs({ argsObject, argsText }) {
	if (argsObject) {
		try {
			return JSON.stringify(argsObject, null, 2);
		} catch (error) {
			console.warn("Failed to stringify tool args object", error);
		}
	}
	if (argsText && argsText.trim().length) {
		return argsText;
	}
	return "—";
}

export function createMessageRenderer({ messageContainerRef, onUserEdit }) {
	let aiTabInstance = null;
	const toolWidgets = new Map();
	const toolContainers = new Map();
	const pendingToolEvents = new Map();
	const standaloneToolWidgets = new Map();

	function setEditorInstance(instance) {
		aiTabInstance = instance;
	}

	function scrollToBottom() {
		const container = messageContainerRef.el;
		if (!container) return;
		container.scrollTop = container.scrollHeight;
	}

	function renderMarkdownInto(element, content) {
		if (!element) return;
		element.innerHTML = md.render(content);
	}

	function enhanceCodeBlocks(messageContentEl) {
		if (!messageContentEl) return;

		messageContentEl.querySelectorAll("pre code").forEach((codeElement) => {
			const languageMatch = codeElement.className.match(/language-(\w+)/);
			let language = languageMatch ? languageMatch[1] : "plaintext";
			const langMap = {
				bash: "sh",
				shell: "sh",
			};
			language = langMap[language] || language;

			const highlight = ace.require("ace/ext/static_highlight");
			highlight.render(
				codeElement.textContent,
				`ace/mode/${language}`,
				settings.value.editorTheme.startsWith("ace/theme/")
					? settings.value.editorTheme
					: `ace/theme/${settings.value.editorTheme}`,
				1,
				true,
				(highlighted) => {
					if (aiTabInstance) {
						aiTabInstance.addStyle(highlighted.css);
					}
					codeElement.innerHTML = highlighted.html;
				},
			);
		});

		messageContentEl.querySelectorAll("pre").forEach((preEl) => {
			preEl.classList.add("code-block-native");
		});
	}

	function buildMessageHeader(message, messageEl) {
		const header = tag("div", { className: "message-header" });
		const sender = tag("div", {
			className: `message-sender ${message.role === "user" ? "user" : "ai"}`,
			textContent: message.role === "user" ? "You" : "AI",
		});
		const actions = tag("div", { className: "message-actions" });
		const time = tag("div", {
			className: "message-time",
			textContent: formatTime(message.timestamp),
		});

		actions.appendChild(time);

		if (message.role === "assistant") {
			const copyBtn = tag("button", {
				className: "btn btn-icon",
				title: "Copy message",
				onclick: () => copyToClipboard(message.content),
			});
			copyBtn.appendChild(tag("i", { className: "icon copy" }));
			actions.appendChild(copyBtn);
		}

		if (message.role === "user" && typeof onUserEdit === "function") {
			const editBtn = tag("button", {
				className: "btn btn-icon",
				title: "Edit message",
				onclick: () => onUserEdit(message),
			});
			editBtn.appendChild(tag("i", { className: "icon edit" }));
			actions.appendChild(editBtn);
		}

		header.appendChild(sender);
		header.appendChild(actions);
		messageEl.appendChild(header);
	}

	function buildMessageContent(message, { renderMarkdown = true } = {}) {
		const contentEl = tag("div", { className: "message-content md" });

		if (message.role === "user" || !renderMarkdown) {
			contentEl.textContent = message.content || "";
		} else if (message.role === "assistant" && message.content) {
			renderMarkdownInto(contentEl, message.content);
			enhanceCodeBlocks(contentEl);
		}

		return contentEl;
	}

	function renderMessage(message, { renderMarkdown = true } = {}) {
		const roleClass =
			message.role === "user"
				? "user"
				: message.role === "tool"
					? "tool"
					: "assistant";
		const messageEl = tag("div", {
			className: `message ${roleClass}`,
			id: `message-${message.id}`,
		});

		buildMessageHeader(message, messageEl);

		let toolContainer = null;
		if (message.role === "assistant") {
			toolContainer = tag("div", {
				className: "assistant-tools",
				id: `assistant-tools-${message.id}`,
			});
			toolContainers.set(message.id, toolContainer);
			messageEl.appendChild(toolContainer);
		}

		const contentEl = buildMessageContent(message, { renderMarkdown });
		messageEl.appendChild(contentEl);

		messageContainerRef.el.appendChild(messageEl);

		if (message.role === "assistant" && pendingToolEvents.has(message.id)) {
			const queued = pendingToolEvents.get(message.id) || [];
			pendingToolEvents.delete(message.id);
			queued.forEach((queuedEvent) => {
				renderToolEvent(queuedEvent.state, {
					targetMessageId: message.id,
					queueIfMissing: false,
					fallbackToStandalone: queuedEvent.fallbackToStandalone,
				});
			});
		}

		scrollToBottom();
		return messageEl;
	}

	function renderAssistantPlaceholder(message) {
		const placeholderMessage = { ...message, content: "" };
		const messageEl = renderMessage(placeholderMessage, {
			renderMarkdown: false,
		});
		const contentEl = messageEl.querySelector(".message-content");
		if (contentEl) {
			contentEl.innerHTML = '<span class="assistant-caret">▌</span>';
		}
		return messageEl;
	}

	function updateAssistantStreaming(
		messageId,
		content,
		{ showCursor = false } = {},
	) {
		const messageEl = messageContainerRef.el?.querySelector(
			`#message-${messageId} .message-content`,
		);
		if (!messageEl) return;

		const suffix = showCursor ? " ▌" : "";
		renderMarkdownInto(messageEl, `${content}${suffix}`);
	}

	function finalizeAssistantMessage(messageId, content, timestamp) {
		const messageEl = messageContainerRef.el?.querySelector(
			`#message-${messageId}`,
		);
		if (!messageEl) return;

		const contentEl = messageEl.querySelector(".message-content");
		if (contentEl) {
			renderMarkdownInto(contentEl, content);
			enhanceCodeBlocks(contentEl);
		}

		const timeEl = messageEl.querySelector(".message-time");
		if (timeEl) {
			timeEl.textContent = formatTime(timestamp);
		}
	}

	function clearMessages() {
		if (messageContainerRef.el) {
			messageContainerRef.el.innerHTML = "";
		}
		toolWidgets.clear();
		toolContainers.clear();
		pendingToolEvents.clear();
		standaloneToolWidgets.clear();
	}

	function showLoadingIndicator() {
		const loadingEl = tag("div", {
			className: "ai_loading",
			id: "loading-indicator",
		});
		const loadingDots = tag("div", { className: "loading-dots" });

		for (let i = 0; i < 3; i++) {
			loadingDots.appendChild(tag("div", { className: "loading-dot" }));
		}

		loadingEl.appendChild(loadingDots);
		loadingEl.appendChild(tag("span", { textContent: "AI is thinking..." }));

		messageContainerRef.el.appendChild(loadingEl);
		scrollToBottom();
	}

	function removeLoadingIndicator() {
		const loadingEl =
			messageContainerRef.el?.querySelector("#loading-indicator");
		if (loadingEl) {
			loadingEl.remove();
		}
	}

	function statusLabel(normalizedStatus) {
		switch (normalizedStatus) {
			case "error":
				return "Failed";
			case "success":
				return "Completed";
			default:
				return "Running";
		}
	}

	function truncate(text, max = 80) {
		if (!text) return "";
		const trimmed = text.trim();
		return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
	}

	function createToolSection(label) {
		const section = tag("div", { className: "assistant-tool__section" });
		section.appendChild(
			tag("div", {
				className: "assistant-tool__section-title",
				textContent: label,
			}),
		);
		const content = tag("pre", {
			className: "assistant-tool__section-content",
		});
		section.appendChild(content);
		return { section, content };
	}

	function createAttachedToolWidget(state) {
		const wrapper = tag("div", {
			className: "assistant-tool",
			id: `tool-${state.id}`,
		});
		wrapper.dataset.toolId = state.id || "";
		wrapper.dataset.parentMessageId = state.parentMessageId || "";

		const summary = tag("button", {
			className: "assistant-tool__summary",
			type: "button",
		});

		const titleGroup = tag("div", { className: "assistant-tool__title" });
		const nameEl = tag("span", {
			className: "assistant-tool__name",
			textContent: state.name || "Tool",
		});
		const previewEl = tag("span", { className: "assistant-tool__preview" });
		titleGroup.appendChild(nameEl);
		titleGroup.appendChild(previewEl);

		const statusValue = normalizeToolStatus(state.status);
		const statusEl = tag("span", {
			className: `assistant-tool__status status-${statusValue}`,
			textContent: statusLabel(statusValue),
		});

		const caretEl = tag("i", {
			className: "icon keyboard_arrow_down assistant-tool__caret",
		});

		summary.appendChild(titleGroup);
		summary.appendChild(statusEl);
		summary.appendChild(caretEl);

		const body = tag("div", { className: "assistant-tool__body" });
		const argsSection = createToolSection("Arguments");
		const outputSection = createToolSection("Output");
		body.appendChild(argsSection.section);
		body.appendChild(outputSection.section);

		summary.onclick = () => {
			const expanded = body.classList.toggle("visible");
			summary.classList.toggle("expanded", expanded);
			caretEl.className = expanded
				? "icon keyboard_arrow_up assistant-tool__caret"
				: "icon keyboard_arrow_down assistant-tool__caret";
		};

		wrapper.appendChild(summary);
		wrapper.appendChild(body);

		wrapper._statusEl = statusEl;
		wrapper._previewEl = previewEl;
		wrapper._argsEl = argsSection.content;
		wrapper._outputEl = outputSection.content;
		wrapper._bodyEl = body;
		wrapper._summaryEl = summary;
		wrapper._caretEl = caretEl;

		return wrapper;
	}

	function updateAttachedToolWidget(widget, state) {
		if (!widget) return;
		widget.dataset.parentMessageId =
			state.parentMessageId || widget.dataset.parentMessageId || "";

		const normalized = normalizeToolStatus(state.status);
		if (widget._statusEl) {
			widget._statusEl.textContent = statusLabel(normalized);
			widget._statusEl.className = `assistant-tool__status status-${normalized}`;
		}

		if (widget._argsEl && (state.isNew || state.stage?.startsWith("args"))) {
			widget._argsEl.textContent = prettifyArgs(state);
		}

		if (widget._outputEl) {
			if (state.output && state.output.trim().length) {
				widget._outputEl.textContent = state.output;
			} else if (normalized === "running") {
				widget._outputEl.textContent = "Pending...";
			}
		}

		if (widget._previewEl) {
			const previewSource =
				state.output?.trim() ||
				state.argsText?.trim() ||
				(state.argsObject ? JSON.stringify(state.argsObject) : "");
			const previewText = truncate(previewSource, 80);
			widget._previewEl.textContent = previewText ? `• ${previewText}` : "";
			widget._previewEl.classList.toggle("visible", Boolean(previewText));
		}
	}

	function createStandaloneToolWidget(state) {
		const wrapper = tag("div", {
			className: "message tool",
			id: `tool-${state.id}`,
		});

		const card = tag("div", { className: "tool-card" });
		const header = tag("div", { className: "tool-card-header" });
		const title = tag("div", {
			className: "tool-card-title",
			textContent: state.name || "Tool",
		});
		const statusValue = normalizeToolStatus(state.status);
		const status = tag("span", {
			className: `tool-status status-${statusValue}`,
			textContent: statusLabel(statusValue),
		});
		header.appendChild(title);
		header.appendChild(status);

		const body = tag("div", { className: "tool-card-body" });
		const argsSection = createToolSection("Arguments");
		argsSection.content.textContent = prettifyArgs(state);

		const outputSection = createToolSection("Output");
		outputSection.content.textContent = state.output?.trim()?.length
			? state.output
			: "Pending...";

		body.appendChild(argsSection.section);
		body.appendChild(outputSection.section);
		card.appendChild(header);
		card.appendChild(body);
		wrapper.appendChild(card);

		wrapper._statusEl = status;
		wrapper._argsEl = argsSection.content;
		wrapper._outputEl = outputSection.content;

		return wrapper;
	}

	function updateStandaloneToolWidget(widget, state) {
		if (!widget) return;
		const statusValue = normalizeToolStatus(state.status);
		widget._statusEl.textContent = statusLabel(statusValue);
		widget._statusEl.className = `tool-status status-${statusValue}`;
		if (state.isNew || state.stage?.startsWith("args")) {
			widget._argsEl.textContent = prettifyArgs(state);
		}
		if (widget._outputEl) {
			if (state.output && state.output.trim().length) {
				widget._outputEl.textContent = state.output;
			} else if (statusValue === "running") {
				widget._outputEl.textContent = "Pending...";
			}
		}
	}

	function attachStandaloneWidget(widget) {
		messageContainerRef.el.appendChild(widget);
		scrollToBottom();
	}

	function renderToolEvent(
		state,
		{
			targetMessageId,
			fallbackToStandalone = false,
			queueIfMissing = true,
		} = {},
	) {
		const toolId = state.id || `tool-${toolWidgets.size + 1}`;
		state.id = toolId;

		if (targetMessageId) {
			const container = toolContainers.get(targetMessageId);
			if (!container) {
				if (queueIfMissing) {
					const existingQueue = pendingToolEvents.get(targetMessageId) || [];
					existingQueue.push({ state, fallbackToStandalone });
					pendingToolEvents.set(targetMessageId, existingQueue);
				} else if (fallbackToStandalone) {
					renderToolEvent(state, {
						targetMessageId: null,
						fallbackToStandalone: true,
						queueIfMissing: false,
					});
				}
				return;
			}

			let widget = toolWidgets.get(toolId);
			if (!widget || !container.contains(widget)) {
				widget = createAttachedToolWidget(state);
				toolWidgets.set(toolId, widget);
				container.appendChild(widget);
			}
			updateAttachedToolWidget(widget, state);
			scrollToBottom();
			return;
		}

		if (!fallbackToStandalone) {
			return;
		}

		let fallbackWidget = standaloneToolWidgets.get(toolId);
		if (!fallbackWidget) {
			fallbackWidget = createStandaloneToolWidget(state);
			standaloneToolWidgets.set(toolId, fallbackWidget);
			attachStandaloneWidget(fallbackWidget);
		}
		updateStandaloneToolWidget(fallbackWidget, state);
	}

	return {
		setEditorInstance,
		scrollToBottom,
		renderMessage,
		renderAssistantPlaceholder,
		updateAssistantStreaming,
		finalizeAssistantMessage,
		clearMessages,
		showLoadingIndicator,
		removeLoadingIndicator,
		renderToolEvent,
	};
}
