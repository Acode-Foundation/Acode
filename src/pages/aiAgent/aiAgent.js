import "./aiAgent.scss";
import Page from "components/page";
import actionStack from "lib/actionStack";
import { render, Component } from "preact";
import { html } from "htm/preact";
import aiService from "utils/ai/AIService";

// ── Simple markdown renderer ──────────────────────────────────────────────────
function renderMarkdown(text) {
	if (!text) return "";
	const blocks = [];
	text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const idx = blocks.length;
		blocks.push({ lang, code: code.trim() });
		return `\x00BLOCK${idx}\x00`;
	});
	text = text
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/\n/g, "<br>");
	text = text.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => {
		const { lang, code } = blocks[i];
		const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
		return `<pre><div class="code-header"><span class="code-lang">${lang || "code"}</span><button class="apply-btn" data-code="${encodeURIComponent(code)}">Apply</button></div><code>${escaped}</code></pre>`;
	});
	return text;
}

// ── Tool step card ─────────────────────────────────────────────────────────────
function ToolStep({ step }) {
	const icon = {
		tool_start: "⏳",
		tool_done: "✅",
		tool_error: "❌",
	}[step.type] || "🔧";

	return html`
		<div class="agent-step ${step.type}">
			<span class="step-icon">${icon}</span>
			<div class="step-body">
				<span class="step-label">${step.label}</span>
				${step.argSummary ? html`<span class="step-arg">${step.argSummary}</span>` : null}
				${step.type === "tool_error"
					? html`<span class="step-error">${step.error}</span>`
					: null}
			</div>
		</div>
	`;
}

class AiAgentApp extends Component {
	constructor(props) {
		super(props);
		this._fileUri = editorManager?.activeFile?.uri || null;
		const saved = aiService.loadHistory(this._fileUri);
		this.state = {
			messages: saved.length
				? saved
				: [{ role: "assistant", content: "Hello! I'm your AI coding assistant.\n\nUse **Chat** mode for questions, or switch to **Agent** mode and I'll autonomously read, edit, and create files in your project." }],
			input: "",
			isLoading: false,
			streamingText: "",
			agentMode: false,
			agentSteps: [],   // current run steps
		};
		this._historyRef = null;
	}

	componentDidMount() {
		this._scrollToBottom();
		this._handleApply = (e) => {
			const btn = e.target.closest(".apply-btn");
			if (!btn) return;
			const code = decodeURIComponent(btn.dataset.code || "");
			if (!code) return;
			try {
				const editor = editorManager?.editor;
				if (!editor) return;
				const { from, to } = editor.state.selection.main;
				editor.dispatch({ changes: { from, to, insert: code } });
				window.toast?.("Code applied!");
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

	handleInput = (e) => this.setState({ input: e.target.value });

	toggleAgentMode = () => {
		this.setState((s) => ({ agentMode: !s.agentMode }));
	};

	// ── Chat mode ─────────────────────────────────────────────────────────────
	sendChat = async () => {
		const { input, messages } = this.state;
		if (!input.trim() || this.state.isLoading) return;

		const userMsg = { role: "user", content: input };
		const newMessages = [...messages, userMsg];
		this.setState({ messages: newMessages, input: "", isLoading: true, streamingText: "" });

		try {
			let streamBuf = "";
			const response = await aiService.chat(newMessages, (token, full) => {
				streamBuf = full;
				this.setState({ streamingText: full });
			});

			const final = response || streamBuf;
			const finalMessages = [...newMessages, { role: "assistant", content: final }];
			this.setState({ messages: finalMessages, isLoading: false, streamingText: "" });
			this._saveHistory(finalMessages);
		} catch (error) {
			const errMessages = [...newMessages, { role: "assistant", content: `**Error:** ${error.message}` }];
			this.setState({ messages: errMessages, isLoading: false, streamingText: "" });
		}
	};

	// ── Agent mode ─────────────────────────────────────────────────────────────
	sendAgent = async () => {
		const { input, messages } = this.state;
		if (!input.trim() || this.state.isLoading) return;

		const userMsg = { role: "user", content: input };
		const newMessages = [...messages, userMsg];
		this.setState({
			messages: newMessages,
			input: "",
			isLoading: true,
			agentSteps: [],
			streamingText: "",
		});

		const steps = [];

		try {
			const final = await aiService.runAgent(newMessages, (event) => {
				if (event.type === "tool_start") {
					steps.push({ type: "tool_start", label: event.label, argSummary: event.argSummary });
					this.setState({ agentSteps: [...steps] });
				} else if (event.type === "tool_done") {
					// Replace last step with done
					const last = steps[steps.length - 1];
					if (last) last.type = "tool_done";
					this.setState({ agentSteps: [...steps] });
				} else if (event.type === "tool_error") {
					const last = steps[steps.length - 1];
					if (last) { last.type = "tool_error"; last.error = event.error; }
					this.setState({ agentSteps: [...steps] });
				}
			});

			// Build a combined message with steps + final response
			const agentMessage = {
				role: "assistant",
				content: final,
				steps: [...steps],
			};
			const finalMessages = [...newMessages, agentMessage];
			this.setState({ messages: finalMessages, isLoading: false, agentSteps: [] });
			this._saveHistory(finalMessages);
		} catch (error) {
			const errMessages = [...newMessages, { role: "assistant", content: `**Agent Error:** ${error.message}` }];
			this.setState({ messages: errMessages, isLoading: false, agentSteps: [] });
		}
	};

	handleSend = () => {
		if (this.state.agentMode) this.sendAgent();
		else this.sendChat();
	};

	handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this.handleSend();
		}
	};

	clearHistory = () => {
		const initial = [{ role: "assistant", content: "Chat cleared! How can I help?" }];
		this.setState({ messages: initial, streamingText: "", agentSteps: [] });
		aiService.clearHistory(this._fileUri);
	};

	render() {
		const { messages, input, isLoading, streamingText, agentMode, agentSteps } = this.state;
		const fileLabel = editorManager?.activeFile?.filename;

		return html`
			<div class="ai-agent-container">
				<!-- Header -->
				<div class="ai-agent-header">
					${fileLabel ? html`<span class="ai-file-context">
						<span class="icon folder"></span> ${fileLabel}
					</span>` : html`<span class="ai-file-context">AI Assistant</span>`}
					<div class="ai-header-actions">
						<button
							class="ai-mode-toggle ${agentMode ? "active" : ""}"
							onclick=${this.toggleAgentMode}
							title="${agentMode ? "Switch to Chat mode" : "Switch to Agent mode"}"
						>
							<span class="icon ${agentMode ? "adb" : "chat"}"></span>
							${agentMode ? "Agent" : "Chat"}
						</button>
						<button class="ai-clear-btn" onclick=${this.clearHistory} title="Clear history">
							<span class="icon delete_sweep"></span>
						</button>
					</div>
				</div>

				<!-- Messages -->
				<div class="ai-chat-history" ref=${(el) => (this._historyRef = el)}>
					${messages.map((msg) => html`
						<div class="ai-message ${msg.role}">
							<div class="ai-avatar">
								${msg.role === "assistant"
									? html`<span class="icon acode"></span>`
									: html`<span class="icon person"></span>`}
							</div>
							<div class="ai-message-bubble">
								<!-- Agent steps attached to this message -->
								${msg.steps?.length ? html`
									<div class="agent-steps-log">
										${msg.steps.map((s) => html`<${ToolStep} step=${s} />`)}
									</div>
								` : null}
								<div
									class="ai-message-content"
									dangerouslySetInnerHTML=${{ __html: renderMarkdown(msg.content) }}
								></div>
							</div>
						</div>
					`)}

					<!-- Live agent steps during execution -->
					${isLoading && agentMode && agentSteps.length ? html`
						<div class="ai-message assistant">
							<div class="ai-avatar"><span class="icon acode"></span></div>
							<div class="ai-message-bubble">
								<div class="agent-steps-log live">
									${agentSteps.map((s) => html`<${ToolStep} step=${s} />`)}
								</div>
								<div class="ai-message-content">
									<span class="ai-thinking"><span></span><span></span><span></span></span>
								</div>
							</div>
						</div>
					` : isLoading ? html`
						<div class="ai-message assistant">
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
						</div>
					` : null}
				</div>

				<!-- Input -->
				<div class="ai-chat-input ${agentMode ? "agent-mode" : ""}">
					${agentMode ? html`<div class="agent-hint">Agent will read &amp; modify files autonomously</div>` : null}
					<div class="ai-input-row">
						<textarea
							placeholder="${agentMode
								? "Describe a task... e.g. 'Refactor auth.js to use async/await'"
								: "Ask about your code... (Enter to send)"}"
							value=${input}
							onInput=${this.handleInput}
							onKeyDown=${this.handleKeyDown}
							rows="1"
						></textarea>
						<button class="ai-send-btn" onclick=${this.handleSend} disabled=${isLoading}>
							<span class="icon ${agentMode ? "adb" : "send"}"></span>
						</button>
					</div>
				</div>
			</div>
		`;
	}
}

export default function AiAgentInclude() {
	if (document.querySelector(".ai-agent-page")) return;

	const $page = Page("AI Agent");
	$page.classList.add("ai-agent-page");

	const rootDiv = document.createElement("div");
	rootDiv.className = "main";
	$page.body = rootDiv;

	render(html`<${AiAgentApp} />`, rootDiv);

	actionStack.push({ id: "aiAgent", action: $page.hide });
	$page.onhide = function () {
		render(null, rootDiv);
		actionStack.remove("aiAgent");
	};

	app.append($page);
	$page.show();
}
