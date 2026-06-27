# Venice AI Coding Wizard

An AI coding assistant for Acode powered by [Venice AI](https://venice.ai) — the privacy-first, uncensored AI platform.

## Features

- **Full codebase context** — automatically sends your active file, selected text, or all open files to the AI
- **Write, edit, read & create** — generate code, refactor files, create new files from AI output
- **Streaming responses** — see the AI think in real-time
- **Model selection** — choose from Gemma 4 Uncensored, Llama 3.3 70B, DeepSeek R1, Qwen 2.5 Coder and more
- **Editable system prompt** — customize the AI's personality and instructions directly from the panel
- **Code block actions** — each code block has "Insert at cursor", "Replace file", "New file…" and "Copy" buttons
- **Conversation history** — multi-turn conversations with full context

## Setup

1. Install the plugin in Acode
2. Open the Venice AI Wizard sidebar panel (click the ✦ icon in the sidebar)
3. Click the ⚙ settings icon and enter your **Venice AI API key**
   - Get a free key at [venice.ai](https://venice.ai)
4. Select your preferred model
5. Start chatting!

## System Prompt

The AI behavior is governed by a **system prompt** that you can customize at any time. Look for the italic preview bar just below the header — click it or the "Edit system prompt" button to expand an inline editor where you can:

- Write any instructions you want the AI to follow
- Reset to the built-in default with the "Reset to default" button
- Save changes immediately

## Context Options

Three toggles below the chat control what context is sent with each message:

| Toggle | What it sends |
|--------|--------------|
| 📄 Current file | The full content of the file you have open |
| ✂️ Selection | Only the text you have highlighted |
| 📂 All open files | Up to 4 other open editor tabs |

## Models

| Model ID | Notes |
|----------|-------|
| `gemma-4-uncensored` | Default — capable & uncensored |
| `llama-3.3-70b` | Strong general-purpose |
| `deepseek-r1-671b` | Deep reasoning |
| `qwen-2.5-coder-32b-instruct` | Specialized for code |
| `mistral-31-24b` | Fast, balanced |
| `venice-uncensored` | Venice's own uncensored model |
| `llama-3.2-3b` | Lightweight & fast |

## File Operations

When the AI suggests code, every fenced code block gets action buttons:

- **Insert at cursor** — insert the code at the current editor cursor position
- **Replace file** — replace the entire active file with the generated code
- **New file…** — prompts for a filename and opens a new unsaved editor tab with the code
- **Copy** — copy to clipboard

If the AI mentions creating a specific filename (e.g. `Create file: index.js`), a quick-create banner appears automatically.

## Settings

All settings are accessible via the ⚙ icon in the panel header or through Acode's plugin settings:

- **Venice AI API Key** — required for all requests
- **AI Model** — which Venice AI model to use
- **Temperature** — randomness (0.0 = precise, 1.0 = creative)
- **Max Tokens** — response length limit
- **System Prompt** — full AI personality / instruction control
- **Context toggles** — what to include with each request

## Privacy

Venice AI does not train on your data and offers uncensored models. See [venice.ai/privacy](https://venice.ai/privacy) for details.
