import {
	addConversation,
	addMessageToDB,
	deleteConversation,
	getAllConversations,
	getConversation as getConversationById,
	getMessagesForConversation,
	updateConversation,
} from "../db";

function createConversationId() {
	return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createChatStore() {
	let currentConversation = null;
	let currentConversationId = null;
	let currentProfile = "ask";
	let chatHistory = [];
	let messageCounter = 0;

	const getCurrentConversation = () => currentConversation;
	const getConversationId = () => currentConversationId;
	const getProfile = () => currentProfile;
	const getHistory = () => [...chatHistory];

	const generateMessageId = () => `msg_${Date.now()}_${++messageCounter}`;

	async function listConversations() {
		return getAllConversations();
	}

	async function ensureConversation() {
		if (currentConversation) return currentConversation;
		return startNewConversation(currentProfile);
	}

	async function startNewConversation(profile = currentProfile) {
		const now = Date.now();
		currentConversationId = createConversationId();
		currentConversation = {
			id: currentConversationId,
			title: "New Chat",
			createdAt: now,
			lastModifiedAt: now,
			profile: profile,
		};
		currentProfile = profile;
		chatHistory = [];
		messageCounter = 0;
		await addConversation(currentConversation);
		return currentConversation;
	}

	async function loadConversation(conversationId) {
		const conversation = await getConversationById(conversationId);
		if (!conversation) return null;

		const messages = await getMessagesForConversation(conversationId);

		currentConversation = conversation;
		currentConversationId = conversation.id;
		currentProfile = conversation.profile || currentProfile;
		chatHistory = messages.map((msg) => ({
			id: msg.id,
			role: msg.role,
			content: msg.content,
			timestamp: msg.timestamp,
		}));
		messageCounter = 0;

		return { conversation, messages };
	}

	async function setProfile(profile) {
		currentProfile = profile;
		if (currentConversation) {
			currentConversation.profile = profile;
			await updateConversation(currentConversation);
		}
	}

	async function deleteConversationById(conversationId) {
		await deleteConversation(conversationId);
		if (conversationId === currentConversationId) {
			currentConversation = null;
			currentConversationId = null;
			chatHistory = [];
		}
	}

	async function prepareMessage(role, content = "", overrides = {}) {
		await ensureConversation();
		return {
			id: overrides.id || generateMessageId(),
			conversationId: currentConversationId,
			role,
			content,
			timestamp: overrides.timestamp || Date.now(),
			...overrides,
		};
	}

	async function commitUserMessage(message) {
		if (!currentConversation) {
			throw new Error("Cannot save user message without active conversation.");
		}

		const isFirstUserMessage =
			chatHistory.findIndex((msg) => msg.role === "user") === -1;

		if (isFirstUserMessage && currentConversation.title === "New Chat") {
			const trimmed = message.content.trim();
			currentConversation.title =
				trimmed.substring(0, 30) + (trimmed.length > 30 ? "..." : "");
		}

		currentConversation.lastModifiedAt = message.timestamp;
		await addMessageToDB(message);
		await updateConversation(currentConversation);

		chatHistory.push({
			id: message.id,
			role: message.role,
			content: message.content,
			timestamp: message.timestamp,
		});

		return { isFirstUserMessage };
	}

	async function commitAssistantMessage(message, { wasError = false } = {}) {
		if (!currentConversation) {
			throw new Error(
				"Cannot save assistant message without active conversation.",
			);
		}

		currentConversation.lastModifiedAt = message.timestamp;
		await addMessageToDB(message);
		await updateConversation(currentConversation);

		if (!wasError) {
			chatHistory.push({
				id: message.id,
				role: message.role,
				content: message.content,
				timestamp: message.timestamp,
			});
		}
	}

	async function commitToolMessage(toolRun) {
		if (!currentConversation) return;

		const messageId = toolRun.id || generateMessageId();
		const payload = {
			id: toolRun.id || messageId,
			name: toolRun.name,
			status: toolRun.status,
			args: toolRun.argsObject ?? toolRun.argsText ?? null,
			output: toolRun.output ?? "",
			parentMessageId: toolRun.parentMessageId ?? null,
		};
		const message = {
			id: messageId,
			conversationId: currentConversationId,
			role: "tool",
			content: JSON.stringify(payload),
			timestamp: toolRun.timestamp || Date.now(),
		};

		await addMessageToDB(message);
		chatHistory.push({
			id: message.id,
			role: message.role,
			content: message.content,
			timestamp: message.timestamp,
		});
	}

	return {
		getConversation: getCurrentConversation,
		getConversationId,
		getProfile,
		getHistory,
		listConversations,
		loadConversation,
		startNewConversation,
		setProfile,
		deleteConversationById,
		prepareMessage,
		commitUserMessage,
		commitAssistantMessage,
		commitToolMessage,
		generateMessageId,
	};
}
