/**
 * Venice AI Coding Wizard — Acode Plugin
 * Integrates Venice AI (OpenAI-compatible) into Acode for full-context
 * code generation, editing, reading and file creation.
 */
(function () {
  "use strict";

  const PLUGIN_ID = "venice-ai-wizard";
  const STORAGE_KEY = "venice_ai_wizard_settings";
  const VENICE_BASE = "https://api.venice.ai/api/v1";

  /* ── Available models ─────────────────────────────────────────────────── */
  const MODELS = [
    ["gemma-4-uncensored", "Gemma 4 Uncensored (Default)"],
    ["llama-3.3-70b", "Llama 3.3 70B"],
    ["deepseek-r1-671b", "DeepSeek R1 671B"],
    ["qwen-2.5-coder-32b-instruct", "Qwen 2.5 Coder 32B"],
    ["mistral-31-24b", "Mistral 3.1 24B"],
    ["venice-uncensored", "Venice Uncensored"],
    ["llama-3.2-3b", "Llama 3.2 3B (Fast)"],
  ];

  const DEFAULT_SYSTEM_PROMPT =
    "You are an expert coding assistant integrated into Acode, a code editor. " +
    "You help users write, read, edit and create code files. " +
    "When providing code always include complete, working implementations without placeholders. " +
    "Use markdown fenced code blocks with language identifiers. " +
    "When asked to create a file, state the filename clearly before the code block.";

  /* ── Settings ─────────────────────────────────────────────────────────── */
  const cfg = loadSettings();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (_) {}
    return defaults();
  }

  function defaults() {
    return {
      apiKey: "",
      model: "gemma-4-uncensored",
      temperature: "0.7",
      maxTokens: "4096",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      includeCurrentFile: true,
      includeSelection: true,
      includeOpenFiles: false,
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  /* ── Venice AI API ────────────────────────────────────────────────────── */
  async function callVenice(messages, onChunk) {
    if (!cfg.apiKey) {
      throw new Error(
        "No API key configured. Open plugin settings and enter your Venice AI API key.",
      );
    }

    const useStream = typeof onChunk === "function";

    const res = await fetch(`${VENICE_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: parseFloat(cfg.temperature) || 0.7,
        max_tokens: parseInt(cfg.maxTokens, 10) || 4096,
        stream: useStream,
      }),
    });

    if (!res.ok) {
      let msg = `Venice AI error ${res.status}`;
      try {
        const e = await res.json();
        msg = e?.error?.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    if (!useStream) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    }

    /* streaming */
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              onChunk(delta, full);
            }
          } catch (_) {}
        }
      }
    }
    return full;
  }

  /* ── Context helpers ──────────────────────────────────────────────────── */
  function getActiveFileContext() {
    try {
      const em = window.editorManager;
      if (!em) return null;
      const file = em.activeFile;
      if (!file || file.type !== "editor") return null;
      const content = em.editor?.getValue?.() ?? "";
      const filename = file.filename || file.name || "untitled";
      return { filename, content, language: guesslang(filename) };
    } catch (_) {
      return null;
    }
  }

  function getSelection() {
    try {
      const editor = window.editorManager?.editor;
      if (!editor) return "";
      const { from, to } = editor.state.selection.main;
      return from !== to ? editor.state.doc.sliceString(from, to) : "";
    } catch (_) {
      return "";
    }
  }

  function getOpenFilesContext() {
    try {
      const em = window.editorManager;
      if (!em) return [];
      return (em.files || [])
        .filter((f) => f.type === "editor" && f !== em.activeFile)
        .slice(0, 4)
        .map((f) => ({
          filename: f.filename || f.name || "untitled",
          content: f.session?.doc?.toString?.() ?? "",
          language: guesslang(f.filename || f.name || ""),
        }));
    } catch (_) {
      return [];
    }
  }

  function guesslang(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const map = {
      js: "javascript",
      ts: "typescript",
      jsx: "jsx",
      tsx: "tsx",
      py: "python",
      rb: "ruby",
      java: "java",
      kt: "kotlin",
      go: "go",
      rs: "rust",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      php: "php",
      html: "html",
      css: "css",
      scss: "scss",
      json: "json",
      xml: "xml",
      md: "markdown",
      sh: "bash",
      sql: "sql",
      yaml: "yaml",
      yml: "yaml",
    };
    return map[ext] || ext || "text";
  }

  function buildMessages(userPrompt) {
    const msgs = [{ role: "system", content: cfg.systemPrompt }];

    const contextParts = [];

    if (cfg.includeCurrentFile) {
      const ctx = getActiveFileContext();
      if (ctx && ctx.content) {
        contextParts.push(
          `## Current file: ${ctx.filename}\n\`\`\`${ctx.language}\n${ctx.content}\n\`\`\``,
        );
      }
    }

    if (cfg.includeSelection) {
      const sel = getSelection();
      if (sel) {
        contextParts.push(`## Selected text\n\`\`\`\n${sel}\n\`\`\``);
      }
    }

    if (cfg.includeOpenFiles) {
      const others = getOpenFilesContext();
      if (others.length) {
        const othersText = others
          .map(
            (f) =>
              `### ${f.filename}\n\`\`\`${f.language}\n${f.content}\n\`\`\``,
          )
          .join("\n\n");
        contextParts.push(`## Other open files\n${othersText}`);
      }
    }

    let finalPrompt = userPrompt;
    if (contextParts.length) {
      finalPrompt = contextParts.join("\n\n") + "\n\n---\n\n" + userPrompt;
    }

    msgs.push({ role: "user", content: finalPrompt });
    return msgs;
  }

  /* ── File operations ──────────────────────────────────────────────────── */
  function insertIntoEditor(text) {
    try {
      const editor = window.editorManager?.editor;
      if (!editor) return false;
      editor.insert(text);
      return true;
    } catch (_) {
      return false;
    }
  }

  function replaceEditorContent(text) {
    try {
      const em = window.editorManager;
      if (!em?.editor) return false;
      const state = em.editor.state;
      em.editor.dispatch({
        changes: { from: 0, to: state.doc.length, insert: text },
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function createNewFile(filename, content) {
    try {
      const fs = acode.require("fs") || acode.require("fsOperation");
      const FileBrowser = acode.require("fileBrowser");
      const helpers = acode.require("helpers");
      const Url = acode.require("Url");

      const em = window.editorManager;
      if (!em) return false;

      /* Use Acode's newEditorFile API */
      acode.newEditorFile(filename, { text: content, isUnsaved: true });
      return true;
    } catch (e) {
      console.error("[Venice AI] createNewFile error:", e);
      return false;
    }
  }

  /* ── Code block extraction ────────────────────────────────────────────── */
  function extractCodeBlocks(markdown) {
    const blocks = [];
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(markdown)) !== null) {
      blocks.push({ lang: m[1] || "text", code: m[2].trimEnd() });
    }
    return blocks;
  }

  function parseFilenameFromResponse(text) {
    const patterns = [
      /create(?:d)?\s+(?:a\s+)?(?:new\s+)?file\s*[:`]?\s*[`'"]?([\w./\\-]+\.\w+)/i,
      /filename[:`]?\s*[`'"]?([\w./\\-]+\.\w+)/i,
      /(?:save|write)\s+(?:to|as)\s*[`'"]?([\w./\\-]+\.\w+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return null;
  }

  /* ── Styles ───────────────────────────────────────────────────────────── */
  const STYLES = `
  .vai-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--secondary-color, #1e1e2e);
    color: var(--primary-text-color, #cdd6f4);
    font-family: var(--editor-font, monospace);
    font-size: 13px;
  }
  .vai-header {
    display: flex;
    align-items: center;
    padding: 8px 10px;
    background: var(--primary-color, #181825);
    border-bottom: 1px solid var(--border-color, #313244);
    gap: 6px;
    flex-shrink: 0;
  }
  .vai-header-title {
    flex: 1;
    font-weight: 600;
    font-size: 13px;
    color: var(--primary-text-color, #cdd6f4);
  }
  .vai-header-icon {
    font-size: 18px;
    color: #89b4fa;
    user-select: none;
  }
  .vai-model-badge {
    font-size: 10px;
    background: #313244;
    border-radius: 4px;
    padding: 2px 6px;
    color: #a6e3a1;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .vai-prompt-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: #11111b;
    border-bottom: 1px solid #313244;
    flex-shrink: 0;
    min-height: 30px;
  }
  .vai-prompt-preview {
    flex: 1;
    font-size: 10px;
    color: #6c7086;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
    font-style: italic;
  }
  .vai-prompt-preview:hover { color: #cdd6f4; }
  .vai-edit-prompt-btn {
    font-size: 10px;
    padding: 2px 7px;
    background: transparent;
    border: 1px solid #45475a;
    border-radius: 4px;
    color: #89b4fa;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .vai-edit-prompt-btn:active { opacity: 0.7; }
  /* Inline system-prompt editor */
  .vai-prompt-editor {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    background: #11111b;
    border-bottom: 1px solid #313244;
    flex-shrink: 0;
  }
  .vai-prompt-editor-label {
    font-size: 10px;
    color: #89b4fa;
    font-weight: 600;
  }
  .vai-prompt-editor-textarea {
    width: 100%;
    min-height: 80px;
    max-height: 200px;
    resize: vertical;
    background: #181825;
    border: 1px solid #45475a;
    border-radius: 5px;
    color: #cdd6f4;
    font-family: inherit;
    font-size: 12px;
    padding: 6px 8px;
    box-sizing: border-box;
    outline: none;
    line-height: 1.4;
  }
  .vai-prompt-editor-textarea:focus { border-color: #89b4fa; }
  .vai-prompt-editor-row {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  .vai-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }
  .vai-message {
    border-radius: 8px;
    padding: 8px 10px;
    line-height: 1.5;
    word-break: break-word;
    max-width: 100%;
    animation: vai-fade-in 0.15s ease;
  }
  @keyframes vai-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .vai-message.user {
    background: #313244;
    align-self: flex-end;
    border-bottom-right-radius: 2px;
    max-width: 88%;
    white-space: pre-wrap;
  }
  .vai-message.assistant {
    background: #1e1e2e;
    border: 1px solid #313244;
    align-self: flex-start;
    width: 100%;
    border-bottom-left-radius: 2px;
  }
  .vai-message.system-msg {
    background: transparent;
    border: none;
    color: #6c7086;
    font-size: 11px;
    text-align: center;
    align-self: center;
  }
  .vai-message.error-msg {
    background: #45102a;
    border: 1px solid #f38ba8;
    color: #f38ba8;
  }
  .vai-pre {
    background: #11111b;
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.4;
    margin: 6px 0;
    position: relative;
  }
  .vai-pre code {
    font-family: var(--editor-font, monospace);
    color: #cdd6f4;
    display: block;
    white-space: pre;
  }
  .vai-code-lang {
    font-size: 10px;
    color: #89dceb;
    margin-bottom: 4px;
    display: block;
  }
  .vai-code-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .vai-btn {
    padding: 4px 10px;
    border-radius: 5px;
    border: none;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    transition: opacity 0.15s;
    outline: none;
  }
  .vai-btn:active { opacity: 0.7; }
  .vai-btn-primary {
    background: #89b4fa;
    color: #1e1e2e;
    font-weight: 600;
  }
  .vai-btn-secondary {
    background: #313244;
    color: #cdd6f4;
  }
  .vai-btn-success {
    background: #a6e3a1;
    color: #1e1e2e;
    font-weight: 600;
  }
  .vai-btn-danger {
    background: #f38ba8;
    color: #1e1e2e;
    font-weight: 600;
  }
  .vai-context-bar {
    display: flex;
    gap: 4px;
    padding: 4px 8px;
    background: var(--primary-color, #181825);
    border-top: 1px solid #313244;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .vai-ctx-toggle {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    border: 1px solid #313244;
    background: transparent;
    color: #6c7086;
    transition: all 0.15s;
  }
  .vai-ctx-toggle.active {
    background: #313244;
    color: #89b4fa;
    border-color: #89b4fa;
  }
  .vai-input-area {
    padding: 8px;
    background: var(--primary-color, #181825);
    border-top: 1px solid #313244;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  .vai-textarea {
    width: 100%;
    min-height: 64px;
    max-height: 160px;
    resize: vertical;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
    color: var(--primary-text-color, #cdd6f4);
    font-family: inherit;
    font-size: 13px;
    padding: 8px;
    box-sizing: border-box;
    outline: none;
    line-height: 1.4;
  }
  .vai-textarea:focus {
    border-color: #89b4fa;
  }
  .vai-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .vai-send-btn {
    padding: 8px 16px;
    background: #89b4fa;
    color: #1e1e2e;
    border: none;
    border-radius: 6px;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    flex-shrink: 0;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  .vai-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .vai-send-btn:active:not(:disabled) { opacity: 0.8; }
  .vai-clear-btn {
    padding: 8px 10px;
    background: #313244;
    color: #6c7086;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  .vai-clear-btn:active { opacity: 0.7; }
  .vai-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid #313244;
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: vai-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes vai-spin {
    to { transform: rotate(360deg); }
  }
  .vai-typing-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #1e1e2e;
    border: 1px solid #313244;
    align-self: flex-start;
    color: #6c7086;
    font-size: 12px;
  }
  .vai-md-p { margin: 4px 0; }
  .vai-md-h { font-weight: 700; margin: 8px 0 4px; color: #89b4fa; }
  .vai-md-ul { margin: 4px 0 4px 16px; }
  .vai-md-li { margin: 2px 0; }
  .vai-inline-code {
    background: #11111b;
    border-radius: 3px;
    padding: 1px 4px;
    font-family: monospace;
    font-size: 12px;
    color: #89dceb;
  }
  .vai-bold { font-weight: 700; }
  `;

  /* ── Markdown renderer (lightweight) ──────────────────────────────────── */
  function renderMarkdown(md) {
    const frag = document.createDocumentFragment();
    const lines = md.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      /* fenced code block */
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;

        const code = codeLines.join("\n").trimEnd();
        const pre = document.createElement("div");
        pre.className = "vai-pre";
        if (lang) {
          const langBadge = document.createElement("span");
          langBadge.className = "vai-code-lang";
          langBadge.textContent = lang;
          pre.appendChild(langBadge);
        }
        const codeEl = document.createElement("code");
        codeEl.textContent = code;
        pre.appendChild(codeEl);

        /* action buttons per code block */
        const actions = document.createElement("div");
        actions.className = "vai-code-actions";

        const btnInsert = document.createElement("button");
        btnInsert.className = "vai-btn vai-btn-primary";
        btnInsert.textContent = "Insert at cursor";
        btnInsert.onclick = () => {
          if (!insertIntoEditor(code)) {
            showToast("No active editor");
          } else {
            showToast("Inserted ✓");
          }
        };

        const btnReplace = document.createElement("button");
        btnReplace.className = "vai-btn vai-btn-secondary";
        btnReplace.textContent = "Replace file";
        btnReplace.onclick = async () => {
          const ok = replaceEditorContent(code);
          showToast(ok ? "File replaced ✓" : "No active editor");
        };

        const btnNew = document.createElement("button");
        btnNew.className = "vai-btn vai-btn-success";
        btnNew.textContent = "New file…";
        btnNew.onclick = async () => {
          const name = await acode.prompt("Filename for new file", `untitled.${lang || "txt"}`, "text");
          if (!name) return;
          await createNewFile(name, code);
          showToast(`Created ${name} ✓`);
        };

        const btnCopy = document.createElement("button");
        btnCopy.className = "vai-btn vai-btn-secondary";
        btnCopy.textContent = "Copy";
        btnCopy.onclick = () => {
          navigator.clipboard?.writeText(code).then(() => showToast("Copied ✓")).catch(() => {});
        };

        actions.append(btnInsert, btnReplace, btnNew, btnCopy);
        pre.appendChild(actions);
        frag.appendChild(pre);
        continue;
      }

      /* heading */
      const hMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (hMatch) {
        const h = document.createElement("div");
        h.className = "vai-md-h";
        h.style.fontSize = `${15 - hMatch[1].length}px`;
        h.appendChild(renderInline(hMatch[2]));
        frag.appendChild(h);
        i++;
        continue;
      }

      /* bullet list */
      if (/^[-*]\s/.test(line)) {
        const ul = document.createElement("ul");
        ul.className = "vai-md-ul";
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          const li = document.createElement("li");
          li.className = "vai-md-li";
          li.appendChild(renderInline(lines[i].slice(2)));
          ul.appendChild(li);
          i++;
        }
        frag.appendChild(ul);
        continue;
      }

      /* blank line */
      if (!line.trim()) {
        i++;
        continue;
      }

      /* paragraph */
      const p = document.createElement("p");
      p.className = "vai-md-p";
      p.appendChild(renderInline(line));
      frag.appendChild(p);
      i++;
    }

    return frag;
  }

  function renderInline(text) {
    const span = document.createElement("span");
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
    for (const part of parts) {
      if (part.startsWith("`") && part.endsWith("`")) {
        const code = document.createElement("code");
        code.className = "vai-inline-code";
        code.textContent = part.slice(1, -1);
        span.appendChild(code);
      } else if (part.startsWith("**") && part.endsWith("**")) {
        const b = document.createElement("span");
        b.className = "vai-bold";
        b.textContent = part.slice(2, -2);
        span.appendChild(b);
      } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        const em = document.createElement("em");
        em.textContent = part.slice(1, -1);
        span.appendChild(em);
      } else {
        span.appendChild(document.createTextNode(part));
      }
    }
    return span;
  }

  /* ── Toast helper ─────────────────────────────────────────────────────── */
  function showToast(msg) {
    try {
      acode.require("toast")(msg, 2000);
    } catch (_) {}
  }

  /* ── Chat state ───────────────────────────────────────────────────────── */
  let conversationHistory = [];
  let isThinking = false;

  /* ── UI construction ──────────────────────────────────────────────────── */
  let $messagesEl = null;
  let $textareaEl = null;
  let $sendBtn = null;
  let $modelBadge = null;
  let $ctxCurrentFile = null;
  let $ctxSelection = null;
  let $ctxOpenFiles = null;

  function buildPanel(container) {
    /* inject styles once */
    if (!document.getElementById("vai-styles")) {
      const style = document.createElement("style");
      style.id = "vai-styles";
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    const panel = document.createElement("div");
    panel.className = "vai-panel";

    /* ── header ── */
    const header = document.createElement("div");
    header.className = "vai-header";

    const headerIcon = document.createElement("span");
    headerIcon.className = "vai-header-icon";
    headerIcon.textContent = "✦";

    const title = document.createElement("span");
    title.className = "vai-header-title";
    title.textContent = "Venice AI Wizard";

    $modelBadge = document.createElement("span");
    $modelBadge.className = "vai-model-badge";
    $modelBadge.title = "Click to change model";
    $modelBadge.textContent = getModelLabel(cfg.model);
    $modelBadge.onclick = openModelPicker;

    const settingsBtn = document.createElement("span");
    settingsBtn.className = "icon settings";
    settingsBtn.title = "Plugin settings";
    settingsBtn.style.cssText = "cursor:pointer;font-size:18px;color:#6c7086;";
    settingsBtn.onclick = openSettings;

    header.append(headerIcon, title, $modelBadge, settingsBtn);

    /* ── messages area ── */
    $messagesEl = document.createElement("div");
    $messagesEl.className = "vai-messages";

    /* (prompt bar gets inserted after header is appended to panel) */

    addSystemMessage("Ask me to write, edit, read or create any code. I have full context of your open files.");

    /* ── context toggles ── */
    const ctxBar = document.createElement("div");
    ctxBar.className = "vai-context-bar";

    $ctxCurrentFile = makeCtxToggle("📄 Current file", cfg.includeCurrentFile, (v) => {
      cfg.includeCurrentFile = v;
      saveSettings();
    });
    $ctxSelection = makeCtxToggle("✂️ Selection", cfg.includeSelection, (v) => {
      cfg.includeSelection = v;
      saveSettings();
    });
    $ctxOpenFiles = makeCtxToggle("📂 All open files", cfg.includeOpenFiles, (v) => {
      cfg.includeOpenFiles = v;
      saveSettings();
    });

    ctxBar.append($ctxCurrentFile, $ctxSelection, $ctxOpenFiles);

    /* ── input area ── */
    const inputArea = document.createElement("div");
    inputArea.className = "vai-input-area";

    $textareaEl = document.createElement("textarea");
    $textareaEl.className = "vai-textarea";
    $textareaEl.placeholder = "Ask Venice AI to write, edit or create code…";
    $textareaEl.setAttribute("rows", "3");

    $textareaEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    const inputRow = document.createElement("div");
    inputRow.className = "vai-input-row";

    $sendBtn = document.createElement("button");
    $sendBtn.className = "vai-send-btn";
    $sendBtn.textContent = "Send";
    $sendBtn.onclick = sendMessage;

    const clearBtn = document.createElement("button");
    clearBtn.className = "vai-clear-btn";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear conversation";
    clearBtn.onclick = clearConversation;

    inputRow.append($sendBtn, clearBtn);
    inputArea.append($textareaEl, inputRow);

    panel.append(header, $messagesEl, ctxBar, inputArea);
    container.appendChild(panel);

    /* insert prompt bar between header and messages (DOM order) */
    buildPromptBar(header);

    return () => {
      /* cleanup: remove styles when plugin unloads */
      document.getElementById("vai-styles")?.remove();
    };
  }

  function makeCtxToggle(label, initialValue, onChange) {
    const btn = document.createElement("button");
    btn.className = "vai-ctx-toggle" + (initialValue ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      const next = !btn.classList.contains("active");
      btn.classList.toggle("active", next);
      onChange(next);
    };
    return btn;
  }

  function getModelLabel(modelId) {
    const found = MODELS.find(([id]) => id === modelId);
    return found ? found[1] : modelId;
  }

  /* ── Message rendering ────────────────────────────────────────────────── */
  function addMessage(role, content, streaming = false) {
    const div = document.createElement("div");
    div.className = `vai-message ${role}`;

    if (role === "assistant") {
      if (streaming) {
        div.dataset.streaming = "1";
        div.textContent = "";
      } else {
        div.appendChild(renderMarkdown(content));
        addAutoFileCreation(div, content);
      }
    } else {
      div.textContent = content;
    }

    $messagesEl.appendChild(div);
    $messagesEl.scrollTop = $messagesEl.scrollHeight;
    return div;
  }

  function addSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "vai-message system-msg";
    div.textContent = text;
    $messagesEl.appendChild(div);
  }

  function addErrorMessage(text) {
    const div = document.createElement("div");
    div.className = "vai-message error-msg";
    div.textContent = `⚠ ${text}`;
    $messagesEl.appendChild(div);
    $messagesEl.scrollTop = $messagesEl.scrollHeight;
  }

  function addTypingIndicator() {
    const div = document.createElement("div");
    div.className = "vai-typing-indicator";
    div.id = "vai-typing";
    const spinner = document.createElement("div");
    spinner.className = "vai-spinner";
    div.append(spinner, "Venice AI is thinking…");
    $messagesEl.appendChild(div);
    $messagesEl.scrollTop = $messagesEl.scrollHeight;
    return div;
  }

  function removeTypingIndicator() {
    document.getElementById("vai-typing")?.remove();
  }

  /* Look for "Create file: filename" patterns and offer one-click creation */
  function addAutoFileCreation(div, content) {
    const filename = parseFilenameFromResponse(content);
    const blocks = extractCodeBlocks(content);
    if (!filename || !blocks.length) return;

    const banner = document.createElement("div");
    banner.style.cssText =
      "margin-top:8px;padding:6px 8px;background:#1c2a1c;border:1px solid #a6e3a1;border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
    banner.innerHTML = `<span style="color:#a6e3a1;font-size:11px;">💾 Create <strong>${filename}</strong>?</span>`;

    const btn = document.createElement("button");
    btn.className = "vai-btn vai-btn-success";
    btn.textContent = "Create file";
    btn.onclick = async () => {
      await createNewFile(filename, blocks[0].code);
      showToast(`${filename} created ✓`);
      banner.remove();
    };
    banner.appendChild(btn);
    div.appendChild(banner);
  }

  /* ── Send message flow ────────────────────────────────────────────────── */
  async function sendMessage() {
    if (isThinking) return;
    const prompt = $textareaEl.value.trim();
    if (!prompt) return;

    if (!cfg.apiKey) {
      addErrorMessage("Please configure your Venice AI API key in settings first.");
      openSettings();
      return;
    }

    $textareaEl.value = "";
    isThinking = true;
    $sendBtn.disabled = true;

    addMessage("user", prompt);
    conversationHistory.push({ role: "user", content: prompt });

    const typingEl = addTypingIndicator();

    try {
      /* Build full messages with context prepended to the FIRST user turn only */
      const contextedHistory = [
        { role: "system", content: cfg.systemPrompt },
        ...buildContextualHistory(),
      ];

      let assistantContent = "";
      let streamingDiv = null;
      let rawBuffer = "";

      try {
        /* attempt streaming */
        removeTypingIndicator();
        streamingDiv = document.createElement("div");
        streamingDiv.className = "vai-message assistant";
        $messagesEl.appendChild(streamingDiv);

        await callVenice(contextedHistory, (delta, full) => {
          rawBuffer = full;
          streamingDiv.textContent = full;
          $messagesEl.scrollTop = $messagesEl.scrollHeight;
        });

        assistantContent = rawBuffer;

        /* re-render with markdown after streaming finishes */
        streamingDiv.textContent = "";
        streamingDiv.appendChild(renderMarkdown(assistantContent));
        addAutoFileCreation(streamingDiv, assistantContent);
      } catch (streamErr) {
        /* streaming failed (browser may not support it) — fall back to non-streaming */
        streamingDiv?.remove();
        removeTypingIndicator();

        assistantContent = await callVenice(contextedHistory);
        addMessage("assistant", assistantContent);
      }

      conversationHistory.push({ role: "assistant", content: assistantContent });
      $messagesEl.scrollTop = $messagesEl.scrollHeight;
    } catch (err) {
      removeTypingIndicator();
      addErrorMessage(err.message || String(err));
    } finally {
      isThinking = false;
      $sendBtn.disabled = false;
      $textareaEl.focus();
    }
  }

  function buildContextualHistory() {
    /* inject file context into the last user message only */
    if (!conversationHistory.length) return [];
    const history = [...conversationHistory];
    /* find the last user message and prepend context to it */
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") {
        const original = history[i].content;
        const contextParts = [];

        if (cfg.includeCurrentFile) {
          const ctx = getActiveFileContext();
          if (ctx && ctx.content) {
            contextParts.push(
              `## Current file: ${ctx.filename}\n\`\`\`${ctx.language}\n${ctx.content}\n\`\`\``,
            );
          }
        }

        if (cfg.includeSelection) {
          const sel = getSelection();
          if (sel) {
            contextParts.push(`## Selected text\n\`\`\`\n${sel}\n\`\`\``);
          }
        }

        if (cfg.includeOpenFiles) {
          const others = getOpenFilesContext();
          if (others.length) {
            const txt = others
              .map(
                (f) => `### ${f.filename}\n\`\`\`${f.language}\n${f.content}\n\`\`\``,
              )
              .join("\n\n");
            contextParts.push(`## Other open files\n${txt}`);
          }
        }

        history[i] = {
          role: "user",
          content: contextParts.length
            ? contextParts.join("\n\n") + "\n\n---\n\n" + original
            : original,
        };
        break;
      }
    }
    return history;
  }

  function clearConversation() {
    conversationHistory = [];
    $messagesEl.innerHTML = "";
    addSystemMessage("Conversation cleared. Ask me anything about your code.");
  }

  /* ── Inline system-prompt editor ─────────────────────────────────────── */
  let $promptBar = null;
  let $promptPreview = null;
  let $promptEditorWrap = null;

  function buildPromptBar(insertAfter) {
    $promptBar = document.createElement("div");
    $promptBar.className = "vai-prompt-bar";

    $promptPreview = document.createElement("span");
    $promptPreview.className = "vai-prompt-preview";
    $promptPreview.title = "Click to edit system prompt";
    refreshPromptPreview();
    $promptPreview.onclick = togglePromptEditor;

    const editBtn = document.createElement("button");
    editBtn.className = "vai-edit-prompt-btn";
    editBtn.textContent = "Edit system prompt";
    editBtn.onclick = togglePromptEditor;

    $promptBar.append($promptPreview, editBtn);
    insertAfter.after($promptBar);

    /* build the inline editor (hidden initially) */
    $promptEditorWrap = document.createElement("div");
    $promptEditorWrap.className = "vai-prompt-editor";
    $promptEditorWrap.style.display = "none";

    const label = document.createElement("div");
    label.className = "vai-prompt-editor-label";
    label.textContent = "System Prompt";

    const textarea = document.createElement("textarea");
    textarea.className = "vai-prompt-editor-textarea";
    textarea.value = cfg.systemPrompt;

    const row = document.createElement("div");
    row.className = "vai-prompt-editor-row";

    const resetBtn = document.createElement("button");
    resetBtn.className = "vai-btn vai-btn-secondary";
    resetBtn.textContent = "Reset to default";
    resetBtn.onclick = () => {
      textarea.value = DEFAULT_SYSTEM_PROMPT;
    };

    const saveBtn = document.createElement("button");
    saveBtn.className = "vai-btn vai-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.onclick = () => {
      cfg.systemPrompt = textarea.value.trim() || DEFAULT_SYSTEM_PROMPT;
      saveSettings();
      refreshPromptPreview();
      togglePromptEditor();
      showToast("System prompt saved ✓");
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "vai-btn vai-btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => {
      textarea.value = cfg.systemPrompt;
      togglePromptEditor();
    };

    row.append(resetBtn, cancelBtn, saveBtn);
    $promptEditorWrap.append(label, textarea, row);
    $promptBar.after($promptEditorWrap);

    return textarea;
  }

  function refreshPromptPreview() {
    if ($promptPreview) {
      $promptPreview.textContent = "System: " + cfg.systemPrompt.slice(0, 70) + (cfg.systemPrompt.length > 70 ? "…" : "");
    }
  }

  function togglePromptEditor() {
    if (!$promptEditorWrap) return;
    const hidden = $promptEditorWrap.style.display === "none";
    $promptEditorWrap.style.display = hidden ? "flex" : "none";
    if (hidden) {
      /* sync textarea when opening */
      const ta = $promptEditorWrap.querySelector(".vai-prompt-editor-textarea");
      if (ta) ta.value = cfg.systemPrompt;
    }
  }

  /* ── Settings ─────────────────────────────────────────────────────────── */
  async function openSettings() {
    try {
      const settingsPage = acode.require("settings");
      if (settingsPage?.uiSettings?.[`plugin-${PLUGIN_ID}`]) {
        settingsPage.uiSettings[`plugin-${PLUGIN_ID}`].show();
        return;
      }
    } catch (_) {}

    /* fallback: custom settings dialog */
    showCustomSettingsDialog();
  }

  async function showCustomSettingsDialog() {
    const values = await acode.multiPrompt("Venice AI Wizard — Settings", [
      {
        type: "text",
        id: "apiKey",
        placeholder: "Venice AI API Key",
        value: cfg.apiKey,
        required: false,
      },
      {
        type: "text",
        id: "systemPrompt",
        placeholder: "System Prompt",
        value: cfg.systemPrompt,
        required: false,
      },
      {
        type: "text",
        id: "temperature",
        placeholder: "Temperature (0.0 – 1.0)",
        value: String(cfg.temperature),
        required: false,
      },
      {
        type: "text",
        id: "maxTokens",
        placeholder: "Max Tokens",
        value: String(cfg.maxTokens),
        required: false,
      },
    ]);

    if (!values) return;

    if (values.apiKey !== undefined) cfg.apiKey = values.apiKey.trim();
    if (values.systemPrompt !== undefined) cfg.systemPrompt = values.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    if (values.temperature !== undefined) cfg.temperature = values.temperature || "0.7";
    if (values.maxTokens !== undefined) cfg.maxTokens = values.maxTokens || "4096";

    saveSettings();
    showToast("Settings saved ✓");
  }

  async function openModelPicker() {
    try {
      const select = acode.require("select");
      const chosen = await select("Select Venice AI Model", MODELS, {
        default: cfg.model,
      });
      if (chosen) {
        cfg.model = chosen;
        $modelBadge.textContent = getModelLabel(chosen);
        saveSettings();
        showToast(`Model: ${getModelLabel(chosen)}`);
      }
    } catch (e) {
      console.error("[Venice AI] model picker error:", e);
    }
  }

  /* ── Acode settings integration ───────────────────────────────────────── */
  const settingsList = [
    {
      key: "apiKey",
      text: "Venice AI API Key",
      icon: "vpn_key",
      info: "Your Venice AI API key from venice.ai",
      value: cfg.apiKey,
      prompt: "Enter Venice AI API key",
      promptType: "password",
    },
    {
      key: "model",
      text: "AI Model",
      icon: "smart_toy",
      info: "Which Venice AI model to use",
      value: cfg.model,
      select: MODELS,
      valueText(v) {
        return getModelLabel(v);
      },
    },
    {
      key: "temperature",
      text: "Temperature",
      icon: "thermostat",
      info: "Creativity level (0.0 = deterministic, 1.0 = creative)",
      value: cfg.temperature,
      prompt: "Temperature (0.0 – 1.0)",
      promptType: "number",
    },
    {
      key: "maxTokens",
      text: "Max Tokens",
      icon: "token",
      info: "Maximum tokens in each response",
      value: cfg.maxTokens,
      prompt: "Max tokens",
      promptType: "number",
    },
    {
      key: "systemPrompt",
      text: "System Prompt",
      icon: "edit_note",
      info: "Custom instructions for the AI assistant",
      value: cfg.systemPrompt,
      prompt: "System prompt",
      promptType: "textarea",
    },
    {
      key: "includeCurrentFile",
      text: "Include Current File",
      icon: "description",
      info: "Send the active file content to the AI",
      checkbox: cfg.includeCurrentFile,
      value: cfg.includeCurrentFile,
    },
    {
      key: "includeSelection",
      text: "Include Selection",
      icon: "select_all",
      info: "Send selected text as context",
      checkbox: cfg.includeSelection,
      value: cfg.includeSelection,
    },
    {
      key: "includeOpenFiles",
      text: "Include All Open Files",
      icon: "folder_open",
      info: "Include up to 4 other open files as context",
      checkbox: cfg.includeOpenFiles,
      value: cfg.includeOpenFiles,
    },
  ];

  function onSettingChange(key, value) {
    cfg[key] = value;
    saveSettings();

    if (key === "model" && $modelBadge) {
      $modelBadge.textContent = getModelLabel(value);
    }
    if (key === "includeCurrentFile" && $ctxCurrentFile) {
      $ctxCurrentFile.classList.toggle("active", !!value);
    }
    if (key === "includeSelection" && $ctxSelection) {
      $ctxSelection.classList.toggle("active", !!value);
    }
    if (key === "includeOpenFiles" && $ctxOpenFiles) {
      $ctxOpenFiles.classList.toggle("active", !!value);
    }
  }

  /* ── Plugin lifecycle ─────────────────────────────────────────────────── */
  function init(baseUrl, $page, options) {
    const sidebarApps = acode.require("sidebarApps");

    sidebarApps.add(
      "auto_fix_high",          /* Acode built-in icon class */
      PLUGIN_ID,
      "Venice AI Wizard",
      (container) => buildPanel(container),
    );
  }

  function destroy() {
    const sidebarApps = acode.require("sidebarApps");
    sidebarApps.remove(PLUGIN_ID);
    document.getElementById("vai-styles")?.remove();
  }

  /* register */
  if (typeof acode !== "undefined") {
    acode.setPluginInit(PLUGIN_ID, init, {
      list: settingsList,
      cb: onSettingChange,
    });
    acode.setPluginUnmount(PLUGIN_ID, destroy);
  }
})();
