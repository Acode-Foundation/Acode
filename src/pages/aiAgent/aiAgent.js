import "./aiAgent.scss";
import Page from "components/page";
import actionStack from "lib/actionStack";
import { render, Component } from "preact";
import { html } from "htm/preact";
import aiService from "utils/ai/AIService";

// ── Simple markdown-ish renderer (bold, inline code, code blocks, newlines) ──
function renderMarkdown(text) {
	if (!text) return "";
	// Extract code blocks first
	const blocks = [];
	text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const idx = blocks.length;
		blocks.push({ lang, code: code.trim() });
		return `\x00BLOCK${idx}\x00`;
	});

	// Inline transforms
	text = text
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/\n/g, "<br>");

	// Restore code blocks
	text = text.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => {
		const { lang, code } = blocks[i];
		const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
		return `<pre><div class="code-header"><span class="code-lang">${lang || "code"}</span><button class="apply-btn" data-code="${encodeURIComponent(code)}">Apply</button></div><code>${escaped}</code></pre>`;
	});

	return text;
}

class AiAgentApp extends Component {
	constructor(props) {
		super(props);
		// Load history keyed to the active file
		this._fileUri = editorManager?.activeFile?.uri || null;
		const saved = aiService.loadHistory(this._fileUri);
		this.state = {
			messages: saved.length
				? saved
				: [{ role: "assistant", content: "Hello! I'm your AI coding assistant. Ask me anything about your code." }],
			input: "",
			isLoading: false,
			streamingText: "",
		};
		this._historyRef = null;
	}

	componentDidMount() {
		this._scrollToBottom();

		// Handle "Apply" button clicks inside rendered markdown
		this._handleApply = (e) => {
			const btn = e.target.closest(".apply-btn");
			if (!btn) return;
			const code = decodeURIComponent(btn.dataset.code || "");
			if (!code) return;
			try {
				const editor = editorManager?.editor;
				const state = editor?.state;
				if (!editor || !state) return;
				const { from, to } = state.selection.main;
				editor.dispatch({
					changes: { from, to, insert: code },
				});
				toast("Code applied to editor!");
			} catch (_) {}
		};

		this._historyRef?.addEventListener("click", this._handleApply);
	}

	componentWillUnmount() {
		this._historyRef?.removeEventListener("click", this._handleApply);
	}

	componentDidUpdate() {
		this._scrollToBottom();
	}

	_scrollToBottom() {
		if (this._historyRef) {
			this._historyRef.scrollTop = this._historyRef.scrollHeight;
		}
	}

	_saveHistory(messages) {
		aiService.saveHistory(this._fileUri, messages);
	}

	handleInput = (e) => {
		this.setState({ input: e.target.value });
	};

	sendMessage = async () => {
		const { input, messages } = this.state;
		if (!input.trim() || this.state.isLoading) return;

		const userMsg = { role: "user", content: input };
		const newMessages = [...messages, userMsg];

		this.setState({ messages: newMessages, input: "", isLoading: true, streamingText: "" });

		try {
			let streamBuf = "";
			const onChunk = (token, full) => {
				streamBuf = full;
				this.setState({ streamingText: full });
			};

			const response = await aiService.chat(newMessages, onChunk);
			const final = response || streamBuf;

			const finalMessages = [...newMessages, { role: "assistant", content: final }];
			this.setState({ messages: finalMessages, isLoading: false, streamingText: "" });
			this._saveHistory(finalMessages);
		} catch (error) {
			const errMessages = [
				...newMessages,
				{ role: "assistant", content: `**Error:** ${error.message}` },
			];
			this.setState({ messages: errMessages, isLoading: false, streamingText: "" });
		}
	};

	handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this.sendMessage();
		}
	};

	clearHistory = () => {
		const initial = [{ role: "assistant", content: "Chat cleared! How can I help?" }];
		this.setState({ messages: initial, streamingText: "" });
		aiService.clearHistory(this._fileUri);
	};

	_getFileLabel() {
		const file = editorManager?.activeFile;
		if (!file) return null;
		return file.filename || "untitled";
	}

	render() {
		const { messages, input, isLoading, streamingText } = this.state;
		const fileLabel = this._getFileLabel();

		return html`
			<div class="ai-agent-container">
				<div class="ai-agent-header">
					${fileLabel ? html`<span class="ai-file-context">
						<span class="icon folder"></span> ${fileLabel}
					</span>` : null}
					<button class="ai-clear-btn" onclick=${this.clearHistory} title="Clear history">
						<span class="icon delete_sweep"></span>
					</button>
				</div>

				<div class="ai-chat-history" ref=${(el) => (this._historyRef = el)}>
					${messages.map(
						(msg) => html`
							<div class="ai-message ${msg.role}">
								<div class="ai-avatar">
									${msg.role === "assistant"
										? html`<span class="icon acode"></span>`
										: html`<span class="icon person"></span>`}
								</div>
								<div class="ai-message-bubble">
									<div
										class="ai-message-content"
										dangerouslySetInnerHTML=${{ __html: renderMarkdown(msg.content) }}
									></div>
								</div>
							</div>
						`,
					)}

					${isLoading
						? html`<div class="ai-message assistant">
								<div class="ai-avatar"><span class="icon acode"></span></div>
								<div class="ai-message-bubble">
									<div
										class="ai-message-content streaming"
										dangerouslySetInnerHTML=${{
											__html: streamingText
												? renderMarkdown(streamingText)
												: `<span class="ai-thinking"><span></span><span></span><span></span></span>`,
										}}
									></div>
								</div>
							</div>`
						: null}
				</div>

				<div class="ai-chat-input">
					<textarea
						placeholder="Ask about your code... (Enter to send, Shift+Enter for newline)"
						value=${input}
						onInput=${this.handleInput}
						onKeyDown=${this.handleKeyDown}
						rows="1"
					></textarea>
					<button class="ai-send-btn" onclick=${this.sendMessage} disabled=${isLoading}>
						<span class="icon send"></span>
					</button>
				</div>
			</div>
		`;
	}
}

export default function AiAgentInclude() {
	// Don't re-open if already open
	if (document.querySelector(".ai-agent-page")) return;

	const $page = Page("AI Agent");
	$page.classList.add("ai-agent-page");

	const rootDiv = document.createElement("div");
	rootDiv.className = "main";
	$page.body = rootDiv;

	render(html`<${AiAgentApp} />`, rootDiv);

	actionStack.push({
		id: "aiAgent",
		action: $page.hide,
	});

	$page.onhide = function () {
		render(null, rootDiv);
		actionStack.remove("aiAgent");
	};

	app.append($page);
	$page.show();
}
