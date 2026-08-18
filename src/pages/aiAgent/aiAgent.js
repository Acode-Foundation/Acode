import "./aiAgent.scss";
import Page from "components/page";
import actionStack from "lib/actionStack";
import { render, Component } from "preact";
import { html } from "htm/preact";
import aiService from "utils/ai/AIService";

class AiAgentApp extends Component {
	constructor(props) {
		super(props);
		this.state = {
			messages: [
				{ role: "assistant", content: "Hello! I am your AI agent. How can I help you today?" }
			],
			input: "",
			isLoading: false
		};
	}

	handleInput = (e) => {
		this.setState({ input: e.target.value });
	}

	sendMessage = async () => {
		const { input, messages } = this.state;
		if (!input.trim() || this.state.isLoading) return;

		const userMsg = { role: "user", content: input };
		const newMessages = [...messages, userMsg];

		this.setState({
			messages: newMessages,
			input: "",
			isLoading: true
		});

		try {
			// This represents the Think -> Act -> Observe loop at a basic level
			// We can expand this logic in aiService to actually perform multi-step reasoning
			const response = await aiService.chat(newMessages);
			this.setState({
				messages: [...newMessages, { role: "assistant", content: response }],
				isLoading: false
			});
		} catch (error) {
			this.setState({
				messages: [...newMessages, { role: "assistant", content: `**Error:** ${error.message}` }],
				isLoading: false
			});
		}
	}

	handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this.sendMessage();
		}
	}

	render() {
		const { messages, input, isLoading } = this.state;
		return html`
			<div class="ai-agent-container">
				<div class="ai-chat-history">
					${messages.map(msg => html`
						<div class="ai-message ${msg.role}">
							<div class="ai-message-bubble">
								<span class="ai-message-content">${msg.content}</span>
							</div>
						</div>
					`)}
					${isLoading ? html`<div class="ai-message assistant"><div class="ai-message-bubble"><span class="ai-loading">Thinking...</span></div></div>` : null}
				</div>
				<div class="ai-chat-input">
					<textarea 
						placeholder="Ask me anything..." 
						value=${input}
						onInput=${this.handleInput}
						onKeyDown=${this.handleKeyDown}
					></textarea>
					<button onclick=${this.sendMessage} disabled=${isLoading}>
						<span class="icon send"></span>
					</button>
				</div>
			</div>
		`;
	}
}

export default function AiAgentInclude() {
	const $page = Page("AI Agent");
	$page.classList.add("ai-agent-page");

	// We mount the Preact component into the $page.body
	// HTML Tag JS (which Acode uses) requires standard DOM elements
	// The Page component already sets $page.body = tag('div', { className: 'main' });
	// Wait, actually Page() returns a DOM element. We can just render into a new div.
	
	const rootDiv = document.createElement("div");
	rootDiv.className = "main";
	$page.body = rootDiv;

	render(html`<${AiAgentApp} />`, rootDiv);

	actionStack.push({
		id: "aiAgent",
		action: $page.hide,
	});

	$page.onhide = function () {
		render(null, rootDiv); // Unmount
		actionStack.remove("aiAgent");
	};

	app.append($page);
}
