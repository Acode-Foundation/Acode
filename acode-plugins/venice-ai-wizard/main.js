/**
 * Venice AI Coding Wizard — Acode Plugin v1.1.0
 * Integrates Venice AI (OpenAI-compatible) into Acode for full-context
 * code generation, editing, reading and file creation.
 *
 * Fixes in v1.1.0:
 *  - Removed Element.after() (unsupported on older Android WebViews);
 *    replaced with insertBefore / appendChild ordering
 *  - Wrapped init & buildPanel in try/catch so failures don't mark the
 *    plugin broken in Acode's BROKEN_PLUGINS registry
 *  - Simplified settings list value types
 *  - Added defensive null-checks throughout
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

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (_) {}
    return defaults();
  }

  const cfg = loadSettings();

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

    const res = await fetch(VENICE_BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: messages,
        temperature: parseFloat(cfg.temperature) || 0.7,
        max_tokens: parseInt(cfg.maxTokens, 10) || 4096,
        stream: useStream,
      }),
    });

    if (!res.ok) {
      var msg = "Venice AI error " + res.status;
      try {
        var e = await res.json();
        msg = (e && e.error && e.error.message) || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    if (!useStream) {
      var data = await res.json();
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    }

    /* streaming */
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var full = "";
    var buf = "";

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var lines = buf.split("\n");
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.indexOf("data: ") === 0) {
          try {
            var json = JSON.parse(trimmed.slice(6));
            var delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || "";
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
      var em = window.editorManager;
      if (!em) return null;
      var file = em.activeFile;
      if (!file || file.type !== "editor") return null;
      var content = (em.editor && em.editor.getValue && em.editor.getValue()) || "";
      var filename = file.filename || file.name || "untitled";
      return { filename: filename, content: content, language: guesslang(filename) };
    } catch (_) {
      return null;
    }
  }

  function getSelection() {
    try {
      var editor = window.editorManager && window.editorManager.editor;
      if (!editor || !editor.state) return "";
      var sel = editor.state.selection.main;
      return sel.from !== sel.to ? editor.state.doc.sliceString(sel.from, sel.to) : "";
    } catch (_) {
      return "";
    }
  }

  function getOpenFilesContext() {
    try {
      var em = window.editorManager;
      if (!em || !em.files) return [];
      return em.files
        .filter(function (f) { return f.type === "editor" && f !== em.activeFile; })
        .slice(0, 4)
        .map(function (f) {
          return {
            filename: f.filename || f.name || "untitled",
            content: (f.session && f.session.doc && f.session.doc.toString && f.session.doc.toString()) || "",
            language: guesslang(f.filename || f.name || ""),
          };
        });
    } catch (_) {
      return [];
    }
  }

  function guesslang(filename) {
    if (!filename) return "text";
    var ext = filename.split(".").pop().toLowerCase();
    var map = {
      js: "javascript", ts: "typescript", jsx: "jsx", tsx: "tsx",
      py: "python", rb: "ruby", java: "java", kt: "kotlin",
      go: "go", rs: "rust", cpp: "cpp", c: "c", cs: "csharp",
      php: "php", html: "html", css: "css", scss: "scss",
      json: "json", xml: "xml", md: "markdown", sh: "bash",
      sql: "sql", yaml: "yaml", yml: "yaml",
    };
    return map[ext] || ext || "text";
  }

  function buildContextualHistory() {
    if (!conversationHistory.length) return [];
    var history = conversationHistory.map(function (m) { return { role: m.role, content: m.content }; });

    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") {
        var original = history[i].content;
        var parts = [];

        if (cfg.includeCurrentFile) {
          var ctx = getActiveFileContext();
          if (ctx && ctx.content) {
            parts.push("## Current file: " + ctx.filename + "\n```" + ctx.language + "\n" + ctx.content + "\n```");
          }
        }
        if (cfg.includeSelection) {
          var sel = getSelection();
          if (sel) parts.push("## Selected text\n```\n" + sel + "\n```");
        }
        if (cfg.includeOpenFiles) {
          var others = getOpenFilesContext();
          if (others.length) {
            var txt = others.map(function (f) {
              return "### " + f.filename + "\n```" + f.language + "\n" + f.content + "\n```";
            }).join("\n\n");
            parts.push("## Other open files\n" + txt);
          }
        }

        history[i] = {
          role: "user",
          content: parts.length ? parts.join("\n\n") + "\n\n---\n\n" + original : original,
        };
        break;
      }
    }
    return history;
  }

  /* ── File operations ──────────────────────────────────────────────────── */
  function insertIntoEditor(text) {
    try {
      var editor = window.editorManager && window.editorManager.editor;
      if (!editor) return false;
      editor.insert(String(text));
      return true;
    } catch (_) {
      return false;
    }
  }

  function replaceEditorContent(text) {
    try {
      var em = window.editorManager;
      if (!em || !em.editor) return false;
      var state = em.editor.state;
      em.editor.dispatch({ changes: { from: 0, to: state.doc.length, insert: String(text) } });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function createNewFile(filename, content) {
    try {
      acode.newEditorFile(filename, { text: content, isUnsaved: true });
      return true;
    } catch (e) {
      console.error("[Venice AI] createNewFile error:", e);
      return false;
    }
  }

  /* ── Code block extraction ────────────────────────────────────────────── */
  function extractCodeBlocks(markdown) {
    var blocks = [];
    var re = /```(\w*)\n?([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(markdown)) !== null) {
      blocks.push({ lang: m[1] || "text", code: m[2].replace(/\s+$/, "") });
    }
    return blocks;
  }

  function parseFilenameFromResponse(text) {
    var patterns = [
      /create(?:d)?\s+(?:a\s+)?(?:new\s+)?file\s*[:`]?\s*[`'"]?([\w./\\-]+\.\w+)/i,
      /filename[:`]?\s*[`'"]?([\w./\\-]+\.\w+)/i,
      /(?:save|write)\s+(?:to|as)\s*[`'"]?([\w./\\-]+\.\w+)/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) return m[1];
    }
    return null;
  }

  /* ── Toast helper ─────────────────────────────────────────────────────── */
  function showToast(msg) {
    try { acode.require("toast")(msg, 2000); } catch (_) {}
  }

  /* ── Styles ───────────────────────────────────────────────────────────── */
  var STYLES = [
    ".vai-panel{display:flex;flex-direction:column;height:100%;background:var(--secondary-color,#1e1e2e);color:var(--primary-text-color,#cdd6f4);font-size:13px;}",
    ".vai-header{display:flex;align-items:center;padding:8px 10px;background:var(--primary-color,#181825);border-bottom:1px solid #313244;gap:6px;flex-shrink:0;}",
    ".vai-header-title{flex:1;font-weight:600;font-size:13px;}",
    ".vai-header-icon{font-size:18px;color:#89b4fa;user-select:none;}",
    ".vai-model-badge{font-size:10px;background:#313244;border-radius:4px;padding:2px 6px;color:#a6e3a1;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}",
    ".vai-prompt-bar{display:flex;align-items:center;gap:6px;padding:4px 8px;background:#11111b;border-bottom:1px solid #313244;flex-shrink:0;min-height:30px;}",
    ".vai-prompt-preview{flex:1;font-size:10px;color:#6c7086;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;font-style:italic;}",
    ".vai-prompt-preview:hover{color:#cdd6f4;}",
    ".vai-edit-prompt-btn{font-size:10px;padding:2px 7px;background:transparent;border:1px solid #45475a;border-radius:4px;color:#89b4fa;cursor:pointer;white-space:nowrap;flex-shrink:0;}",
    ".vai-prompt-editor{flex-direction:column;gap:4px;padding:6px 8px;background:#11111b;border-bottom:1px solid #313244;flex-shrink:0;}",
    ".vai-prompt-editor-label{font-size:10px;color:#89b4fa;font-weight:600;}",
    ".vai-prompt-editor-textarea{width:100%;min-height:80px;max-height:200px;resize:vertical;background:#181825;border:1px solid #45475a;border-radius:5px;color:#cdd6f4;font-size:12px;padding:6px 8px;box-sizing:border-box;outline:none;line-height:1.4;}",
    ".vai-prompt-editor-textarea:focus{border-color:#89b4fa;}",
    ".vai-prompt-editor-row{display:flex;gap:4px;justify-content:flex-end;}",
    ".vai-messages{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:10px;min-height:0;}",
    ".vai-message{border-radius:8px;padding:8px 10px;line-height:1.5;word-break:break-word;max-width:100%;}",
    ".vai-message.user{background:#313244;align-self:flex-end;border-bottom-right-radius:2px;max-width:88%;white-space:pre-wrap;}",
    ".vai-message.assistant{background:#1e1e2e;border:1px solid #313244;align-self:flex-start;width:100%;border-bottom-left-radius:2px;}",
    ".vai-message.sys-msg{background:transparent;border:none;color:#6c7086;font-size:11px;text-align:center;align-self:center;}",
    ".vai-message.err-msg{background:#45102a;border:1px solid #f38ba8;color:#f38ba8;}",
    ".vai-pre{background:#11111b;border-radius:6px;padding:8px 10px;overflow-x:auto;font-size:12px;line-height:1.4;margin:6px 0;}",
    ".vai-pre code{color:#cdd6f4;display:block;white-space:pre;}",
    ".vai-code-lang{font-size:10px;color:#89dceb;margin-bottom:4px;display:block;}",
    ".vai-code-actions{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;}",
    ".vai-btn{padding:4px 10px;border-radius:5px;border:none;cursor:pointer;font-size:11px;transition:opacity .15s;outline:none;}",
    ".vai-btn:active{opacity:.7;}",
    ".vai-btn-primary{background:#89b4fa;color:#1e1e2e;font-weight:600;}",
    ".vai-btn-secondary{background:#313244;color:#cdd6f4;}",
    ".vai-btn-success{background:#a6e3a1;color:#1e1e2e;font-weight:600;}",
    ".vai-ctx-bar{display:flex;gap:4px;padding:4px 8px;background:var(--primary-color,#181825);border-top:1px solid #313244;flex-wrap:wrap;flex-shrink:0;}",
    ".vai-ctx-btn{display:flex;align-items:center;gap:3px;font-size:10px;padding:3px 6px;border-radius:4px;cursor:pointer;user-select:none;border:1px solid #313244;background:transparent;color:#6c7086;}",
    ".vai-ctx-btn.on{background:#313244;color:#89b4fa;border-color:#89b4fa;}",
    ".vai-input-area{padding:8px;background:var(--primary-color,#181825);border-top:1px solid #313244;display:flex;flex-direction:column;gap:6px;flex-shrink:0;}",
    ".vai-textarea{width:100%;min-height:64px;max-height:160px;resize:vertical;background:#11111b;border:1px solid #313244;border-radius:6px;color:var(--primary-text-color,#cdd6f4);font-size:13px;padding:8px;box-sizing:border-box;outline:none;line-height:1.4;}",
    ".vai-textarea:focus{border-color:#89b4fa;}",
    ".vai-input-row{display:flex;gap:6px;align-items:center;}",
    ".vai-send-btn{padding:8px 16px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;flex-shrink:0;}",
    ".vai-send-btn:disabled{opacity:.4;cursor:not-allowed;}",
    ".vai-clear-btn{padding:8px 10px;background:#313244;color:#6c7086;border:none;border-radius:6px;font-size:12px;cursor:pointer;}",
    ".vai-spinner{display:inline-block;width:14px;height:14px;border:2px solid #313244;border-top-color:#89b4fa;border-radius:50%;animation:vai-spin .8s linear infinite;}",
    "@keyframes vai-spin{to{transform:rotate(360deg)}}",
    ".vai-typing{display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;background:#1e1e2e;border:1px solid #313244;align-self:flex-start;color:#6c7086;font-size:12px;}",
    ".vai-md-p{margin:4px 0;}",
    ".vai-md-h{font-weight:700;margin:8px 0 4px;color:#89b4fa;}",
    ".vai-md-ul{margin:4px 0 4px 16px;}",
    ".vai-md-li{margin:2px 0;}",
    ".vai-ic{background:#11111b;border-radius:3px;padding:1px 4px;font-size:12px;color:#89dceb;}",
    ".vai-bold{font-weight:700;}",
  ].join("");

  function injectStyles() {
    if (document.getElementById("vai-styles")) return;
    var style = document.createElement("style");
    style.id = "vai-styles";
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  /* ── Markdown renderer ────────────────────────────────────────────────── */
  function renderMarkdown(md) {
    var frag = document.createDocumentFragment();
    var lines = String(md || "").split("\n");
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (line.indexOf("```") === 0) {
        var lang = line.slice(3).trim();
        var codeLines = [];
        i++;
        while (i < lines.length && lines[i].indexOf("```") !== 0) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        var code = codeLines.join("\n").replace(/\s+$/, "");
        frag.appendChild(makeCodeBlock(lang, code));
        continue;
      }

      var hm = line.match(/^(#{1,6})\s+(.*)/);
      if (hm) {
        var h = el("div", "vai-md-h");
        h.style.fontSize = (15 - hm[1].length) + "px";
        h.appendChild(renderInline(hm[2]));
        frag.appendChild(h);
        i++;
        continue;
      }

      if (/^[-*]\s/.test(line)) {
        var ul = el("ul", "vai-md-ul");
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          var li = el("li", "vai-md-li");
          li.appendChild(renderInline(lines[i].slice(2)));
          ul.appendChild(li);
          i++;
        }
        frag.appendChild(ul);
        continue;
      }

      if (!line.trim()) { i++; continue; }

      var p = el("p", "vai-md-p");
      p.appendChild(renderInline(line));
      frag.appendChild(p);
      i++;
    }

    return frag;
  }

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function renderInline(text) {
    var span = el("span");
    var parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.charAt(0) === "`" && p.charAt(p.length - 1) === "`" && p.length > 2) {
        var c = el("code", "vai-ic");
        c.textContent = p.slice(1, -1);
        span.appendChild(c);
      } else if (p.indexOf("**") === 0 && p.lastIndexOf("**") === p.length - 2 && p.length > 4) {
        var b = el("span", "vai-bold");
        b.textContent = p.slice(2, -2);
        span.appendChild(b);
      } else if (p.charAt(0) === "*" && p.charAt(p.length - 1) === "*" && p.length > 2) {
        var em = el("em");
        em.textContent = p.slice(1, -1);
        span.appendChild(em);
      } else {
        span.appendChild(document.createTextNode(p));
      }
    }
    return span;
  }

  function makeCodeBlock(lang, code) {
    var pre = el("div", "vai-pre");
    if (lang) {
      var badge = el("span", "vai-code-lang");
      badge.textContent = lang;
      pre.appendChild(badge);
    }
    var codeEl = el("code");
    codeEl.textContent = code;
    pre.appendChild(codeEl);

    var actions = el("div", "vai-code-actions");

    var btnI = mkBtn("Insert at cursor", "vai-btn vai-btn-primary", function () {
      if (!insertIntoEditor(code)) showToast("No active editor");
      else showToast("Inserted ✓");
    });
    var btnR = mkBtn("Replace file", "vai-btn vai-btn-secondary", function () {
      showToast(replaceEditorContent(code) ? "File replaced ✓" : "No active editor");
    });
    var btnN = mkBtn("New file…", "vai-btn vai-btn-success", function () {
      var name = prompt("Filename", "untitled." + (lang || "txt")) || "";
      if (!name.trim()) return;
      createNewFile(name.trim(), code).then(function () { showToast("Created " + name + " ✓"); });
    });
    var btnC = mkBtn("Copy", "vai-btn vai-btn-secondary", function () {
      try {
        navigator.clipboard.writeText(code).then(function () { showToast("Copied ✓"); });
      } catch (_) {}
    });

    actions.appendChild(btnI);
    actions.appendChild(btnR);
    actions.appendChild(btnN);
    actions.appendChild(btnC);
    pre.appendChild(actions);
    return pre;
  }

  function mkBtn(text, cls, onclick) {
    var b = el("button", cls);
    b.textContent = text;
    b.onclick = onclick;
    return b;
  }

  /* ── Chat state ───────────────────────────────────────────────────────── */
  var conversationHistory = [];
  var isThinking = false;
  var $messagesEl = null;
  var $textareaEl = null;
  var $sendBtn = null;
  var $modelBadge = null;
  var $ctxCurrentFile = null;
  var $ctxSelection = null;
  var $ctxOpenFiles = null;
  var $promptPreview = null;
  var $promptEditorWrap = null;

  /* ── Panel builder ────────────────────────────────────────────────────── */
  function buildPanel(container) {
    injectStyles();

    var panel = el("div", "vai-panel");

    /* header */
    var header = el("div", "vai-header");
    var headerIcon = el("span", "vai-header-icon");
    headerIcon.textContent = "✦";
    var titleEl = el("span", "vai-header-title");
    titleEl.textContent = "Venice AI Wizard";

    $modelBadge = el("span", "vai-model-badge");
    $modelBadge.title = "Click to change model";
    $modelBadge.textContent = getModelLabel(cfg.model);
    $modelBadge.onclick = openModelPicker;

    var settingsBtn = el("span", "icon settings");
    settingsBtn.title = "Settings";
    settingsBtn.style.cssText = "cursor:pointer;font-size:18px;color:#6c7086;";
    settingsBtn.onclick = openSettings;

    header.appendChild(headerIcon);
    header.appendChild(titleEl);
    header.appendChild($modelBadge);
    header.appendChild(settingsBtn);

    /* system-prompt bar */
    var promptBar = el("div", "vai-prompt-bar");
    $promptPreview = el("span", "vai-prompt-preview");
    $promptPreview.title = "Click to edit system prompt";
    refreshPromptPreview();
    $promptPreview.onclick = togglePromptEditor;
    var editPromptBtn = el("button", "vai-edit-prompt-btn");
    editPromptBtn.textContent = "Edit system prompt";
    editPromptBtn.onclick = togglePromptEditor;
    promptBar.appendChild($promptPreview);
    promptBar.appendChild(editPromptBtn);

    /* inline prompt editor (hidden) */
    $promptEditorWrap = el("div", "vai-prompt-editor");
    $promptEditorWrap.style.display = "none";
    var promptLabel = el("div", "vai-prompt-editor-label");
    promptLabel.textContent = "System Prompt";
    var promptTA = el("textarea", "vai-prompt-editor-textarea");
    promptTA.value = cfg.systemPrompt;
    var promptRow = el("div", "vai-prompt-editor-row");
    var resetBtn = mkBtn("Reset to default", "vai-btn vai-btn-secondary", function () {
      promptTA.value = DEFAULT_SYSTEM_PROMPT;
    });
    var cancelPBtn = mkBtn("Cancel", "vai-btn vai-btn-secondary", function () {
      promptTA.value = cfg.systemPrompt;
      $promptEditorWrap.style.display = "none";
    });
    var savePBtn = mkBtn("Save", "vai-btn vai-btn-primary", function () {
      cfg.systemPrompt = promptTA.value.trim() || DEFAULT_SYSTEM_PROMPT;
      saveSettings();
      refreshPromptPreview();
      $promptEditorWrap.style.display = "none";
      showToast("System prompt saved ✓");
    });
    promptRow.appendChild(resetBtn);
    promptRow.appendChild(cancelPBtn);
    promptRow.appendChild(savePBtn);
    $promptEditorWrap.appendChild(promptLabel);
    $promptEditorWrap.appendChild(promptTA);
    $promptEditorWrap.appendChild(promptRow);

    /* messages */
    $messagesEl = el("div", "vai-messages");

    /* context bar */
    var ctxBar = el("div", "vai-ctx-bar");
    $ctxCurrentFile = makeCtxBtn("📄 Current file", cfg.includeCurrentFile, function (v) {
      cfg.includeCurrentFile = v; saveSettings();
    });
    $ctxSelection = makeCtxBtn("✂️ Selection", cfg.includeSelection, function (v) {
      cfg.includeSelection = v; saveSettings();
    });
    $ctxOpenFiles = makeCtxBtn("📂 All open", cfg.includeOpenFiles, function (v) {
      cfg.includeOpenFiles = v; saveSettings();
    });
    ctxBar.appendChild($ctxCurrentFile);
    ctxBar.appendChild($ctxSelection);
    ctxBar.appendChild($ctxOpenFiles);

    /* input area */
    var inputArea = el("div", "vai-input-area");
    $textareaEl = el("textarea", "vai-textarea");
    $textareaEl.setAttribute("placeholder", "Ask Venice AI to write, edit or create code… (Enter to send, Shift+Enter for newline)");
    $textareaEl.setAttribute("rows", "3");
    $textareaEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    var inputRow = el("div", "vai-input-row");
    $sendBtn = el("button", "vai-send-btn");
    $sendBtn.textContent = "Send";
    $sendBtn.onclick = sendMessage;
    var clearBtn = el("button", "vai-clear-btn");
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear conversation";
    clearBtn.onclick = clearConversation;
    inputRow.appendChild($sendBtn);
    inputRow.appendChild(clearBtn);
    inputArea.appendChild($textareaEl);
    inputArea.appendChild(inputRow);

    /* assemble — strict appendChild order, no Element.after() */
    panel.appendChild(header);
    panel.appendChild(promptBar);
    panel.appendChild($promptEditorWrap);
    panel.appendChild($messagesEl);
    panel.appendChild(ctxBar);
    panel.appendChild(inputArea);

    container.appendChild(panel);

    addSysMsg("Ask me to write, edit, read or create any code. I have full context of your open files.");

    return function cleanup() {
      var s = document.getElementById("vai-styles");
      if (s) s.parentNode.removeChild(s);
    };
  }

  function makeCtxBtn(label, active, onChange) {
    var b = el("button", "vai-ctx-btn" + (active ? " on" : ""));
    b.textContent = label;
    b.onclick = function () {
      var next = b.className.indexOf(" on") === -1;
      b.className = "vai-ctx-btn" + (next ? " on" : "");
      onChange(next);
    };
    return b;
  }

  function getModelLabel(id) {
    for (var i = 0; i < MODELS.length; i++) {
      if (MODELS[i][0] === id) return MODELS[i][1];
    }
    return id;
  }

  /* ── System prompt UI ─────────────────────────────────────────────────── */
  function refreshPromptPreview() {
    if (!$promptPreview) return;
    var s = cfg.systemPrompt;
    $promptPreview.textContent = "System: " + (s.length > 70 ? s.slice(0, 70) + "…" : s);
  }

  function togglePromptEditor() {
    if (!$promptEditorWrap) return;
    var hidden = $promptEditorWrap.style.display === "none";
    $promptEditorWrap.style.display = hidden ? "flex" : "none";
    if (hidden) {
      var ta = $promptEditorWrap.querySelector(".vai-prompt-editor-textarea");
      if (ta) ta.value = cfg.systemPrompt;
    }
  }

  /* ── Messages ─────────────────────────────────────────────────────────── */
  function addSysMsg(text) {
    var d = el("div", "vai-message sys-msg");
    d.textContent = text;
    if ($messagesEl) $messagesEl.appendChild(d);
  }

  function addErrMsg(text) {
    var d = el("div", "vai-message err-msg");
    d.textContent = "⚠ " + text;
    if ($messagesEl) {
      $messagesEl.appendChild(d);
      $messagesEl.scrollTop = $messagesEl.scrollHeight;
    }
  }

  function addUserMsg(text) {
    var d = el("div", "vai-message user");
    d.textContent = text;
    if ($messagesEl) {
      $messagesEl.appendChild(d);
      $messagesEl.scrollTop = $messagesEl.scrollHeight;
    }
  }

  function addAssistantMsg(text) {
    var d = el("div", "vai-message assistant");
    d.appendChild(renderMarkdown(text));
    maybeAddFileCreation(d, text);
    if ($messagesEl) {
      $messagesEl.appendChild(d);
      $messagesEl.scrollTop = $messagesEl.scrollHeight;
    }
    return d;
  }

  function addTypingEl() {
    var d = el("div", "vai-typing");
    d.id = "vai-typing";
    var spinner = el("div", "vai-spinner");
    d.appendChild(spinner);
    d.appendChild(document.createTextNode(" Venice AI is thinking…"));
    if ($messagesEl) {
      $messagesEl.appendChild(d);
      $messagesEl.scrollTop = $messagesEl.scrollHeight;
    }
    return d;
  }

  function removeTypingEl() {
    var el = document.getElementById("vai-typing");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function maybeAddFileCreation(div, content) {
    try {
      var fn = parseFilenameFromResponse(content);
      var blocks = extractCodeBlocks(content);
      if (!fn || !blocks.length) return;
      var banner = el("div");
      banner.style.cssText = "margin-top:8px;padding:6px 8px;background:#1c2a1c;border:1px solid #a6e3a1;border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
      var lbl = el("span");
      lbl.style.cssText = "color:#a6e3a1;font-size:11px;";
      lbl.textContent = "💾 Create " + fn + "?";
      var btn = mkBtn("Create file", "vai-btn vai-btn-success", function () {
        createNewFile(fn, blocks[0].code).then(function () { showToast(fn + " created ✓"); });
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      });
      banner.appendChild(lbl);
      banner.appendChild(btn);
      div.appendChild(banner);
    } catch (_) {}
  }

  function clearConversation() {
    conversationHistory = [];
    if ($messagesEl) $messagesEl.innerHTML = "";
    addSysMsg("Conversation cleared. Ask me anything about your code.");
  }

  /* ── Send flow ────────────────────────────────────────────────────────── */
  async function sendMessage() {
    if (isThinking || !$textareaEl) return;
    var userText = $textareaEl.value.trim();
    if (!userText) return;

    if (!cfg.apiKey) {
      addErrMsg("Please configure your Venice AI API key in settings first.");
      openSettings();
      return;
    }

    $textareaEl.value = "";
    isThinking = true;
    if ($sendBtn) $sendBtn.disabled = true;

    addUserMsg(userText);
    conversationHistory.push({ role: "user", content: userText });

    addTypingEl();

    try {
      var messages = [{ role: "system", content: cfg.systemPrompt }].concat(buildContextualHistory());
      var assistantContent = "";
      var streamDiv = null;
      var rawBuf = "";

      try {
        removeTypingEl();
        streamDiv = el("div", "vai-message assistant");
        if ($messagesEl) $messagesEl.appendChild(streamDiv);

        await callVenice(messages, function (delta, full) {
          rawBuf = full;
          if (streamDiv) streamDiv.textContent = full;
          if ($messagesEl) $messagesEl.scrollTop = $messagesEl.scrollHeight;
        });

        assistantContent = rawBuf;
        if (streamDiv) {
          streamDiv.textContent = "";
          streamDiv.appendChild(renderMarkdown(assistantContent));
          maybeAddFileCreation(streamDiv, assistantContent);
        }
      } catch (streamErr) {
        if (streamDiv && streamDiv.parentNode) streamDiv.parentNode.removeChild(streamDiv);
        removeTypingEl();
        assistantContent = await callVenice(messages);
        addAssistantMsg(assistantContent);
      }

      conversationHistory.push({ role: "assistant", content: assistantContent });
      if ($messagesEl) $messagesEl.scrollTop = $messagesEl.scrollHeight;
    } catch (err) {
      removeTypingEl();
      addErrMsg(err && err.message ? err.message : String(err));
    } finally {
      isThinking = false;
      if ($sendBtn) $sendBtn.disabled = false;
      if ($textareaEl) $textareaEl.focus();
    }
  }

  /* ── Settings dialogs ─────────────────────────────────────────────────── */
  async function openSettings() {
    try {
      var appSettings = acode.require("settings");
      if (appSettings && appSettings.uiSettings && appSettings.uiSettings["plugin-" + PLUGIN_ID]) {
        appSettings.uiSettings["plugin-" + PLUGIN_ID].show();
        return;
      }
    } catch (_) {}
    /* fallback */
    try {
      var vals = await acode.multiPrompt("Venice AI — Settings", [
        { type: "text", id: "apiKey", placeholder: "API Key", value: cfg.apiKey },
        { type: "text", id: "temperature", placeholder: "Temperature (0-1)", value: cfg.temperature },
        { type: "text", id: "maxTokens", placeholder: "Max Tokens", value: cfg.maxTokens },
      ]);
      if (!vals) return;
      if (vals.apiKey !== undefined) cfg.apiKey = vals.apiKey.trim();
      if (vals.temperature !== undefined) cfg.temperature = vals.temperature;
      if (vals.maxTokens !== undefined) cfg.maxTokens = vals.maxTokens;
      saveSettings();
      showToast("Settings saved ✓");
    } catch (_) {}
  }

  async function openModelPicker() {
    try {
      var select = acode.require("select");
      var chosen = await select("Select Venice AI Model", MODELS, { default: cfg.model });
      if (chosen) {
        cfg.model = chosen;
        if ($modelBadge) $modelBadge.textContent = getModelLabel(chosen);
        saveSettings();
        showToast("Model: " + getModelLabel(chosen));
      }
    } catch (e) {
      console.error("[Venice AI] model picker error:", e);
    }
  }

  /* ── Acode settings list ──────────────────────────────────────────────── */
  var settingsList = [
    {
      key: "apiKey",
      text: "Venice AI API Key",
      info: "Your API key from venice.ai",
      value: cfg.apiKey,
      prompt: "Enter Venice AI API key",
      promptType: "text",
    },
    {
      key: "model",
      text: "AI Model",
      info: "Which Venice AI model to use",
      value: cfg.model,
      select: MODELS,
      valueText: function (v) { return getModelLabel(v); },
    },
    {
      key: "temperature",
      text: "Temperature",
      info: "Creativity: 0.0 = precise, 1.0 = creative",
      value: cfg.temperature,
      prompt: "Temperature (0.0 – 1.0)",
      promptType: "number",
    },
    {
      key: "maxTokens",
      text: "Max Tokens",
      info: "Maximum response length",
      value: cfg.maxTokens,
      prompt: "Max tokens",
      promptType: "number",
    },
    {
      key: "systemPrompt",
      text: "System Prompt",
      info: "Edit directly in the sidebar panel",
      value: "tap panel to edit",
      chevron: true,
    },
    {
      key: "includeCurrentFile",
      text: "Include Current File",
      info: "Send the active file as context",
      checkbox: cfg.includeCurrentFile,
      value: cfg.includeCurrentFile,
    },
    {
      key: "includeSelection",
      text: "Include Selection",
      info: "Send highlighted text as context",
      checkbox: cfg.includeSelection,
      value: cfg.includeSelection,
    },
    {
      key: "includeOpenFiles",
      text: "Include All Open Files",
      info: "Include up to 4 other open tabs",
      checkbox: cfg.includeOpenFiles,
      value: cfg.includeOpenFiles,
    },
  ];

  function onSettingChange(key, value) {
    if (key === "systemPrompt") {
      togglePromptEditor();
      return;
    }
    cfg[key] = value;
    saveSettings();
    if (key === "model" && $modelBadge) $modelBadge.textContent = getModelLabel(value);
    if (key === "includeCurrentFile" && $ctxCurrentFile) {
      $ctxCurrentFile.className = "vai-ctx-btn" + (value ? " on" : "");
    }
    if (key === "includeSelection" && $ctxSelection) {
      $ctxSelection.className = "vai-ctx-btn" + (value ? " on" : "");
    }
    if (key === "includeOpenFiles" && $ctxOpenFiles) {
      $ctxOpenFiles.className = "vai-ctx-btn" + (value ? " on" : "");
    }
  }

  /* ── Lifecycle ────────────────────────────────────────────────────────── */
  function init(baseUrl, $page, options) {
    try {
      var sidebarApps = acode.require("sidebarApps");
      if (!sidebarApps) {
        console.error("[Venice AI] sidebarApps module not available");
        return;
      }
      sidebarApps.add(
        "smart_toy",
        PLUGIN_ID,
        "Venice AI Wizard",
        buildPanel
      );
    } catch (e) {
      console.error("[Venice AI] init error:", e);
    }
  }

  function destroy() {
    try {
      var sidebarApps = acode.require("sidebarApps");
      if (sidebarApps) sidebarApps.remove(PLUGIN_ID);
    } catch (_) {}
    try {
      var s = document.getElementById("vai-styles");
      if (s && s.parentNode) s.parentNode.removeChild(s);
    } catch (_) {}
  }

  /* register */
  try {
    if (typeof acode !== "undefined") {
      acode.setPluginInit(PLUGIN_ID, init, {
        list: settingsList,
        cb: onSettingChange,
      });
      acode.setPluginUnmount(PLUGIN_ID, destroy);
    }
  } catch (e) {
    console.error("[Venice AI] registration error:", e);
  }
})();
