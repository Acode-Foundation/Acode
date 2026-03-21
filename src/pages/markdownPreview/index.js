import "./style.scss";

import fsOperation from "fileSystem";
import Page from "components/page";
import DOMPurify from "dompurify";
import actionStack from "lib/actionStack";
import openFile from "lib/openFile";
import { highlightCodeBlock, initHighlighting } from "utils/codeHighlight";
import {
	getMarkdownBaseUri,
	hasMathContent,
	isExternalLink,
	isMarkdownPath,
	renderMarkdown,
	resolveMarkdownTarget,
} from "./renderer";

let previewController = null;
let mermaidModulePromise = null;
let mermaidThemeSignature = "";
let mathStylesPromise = null;

function getThemeColor(name, fallback) {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
}

function isDarkColor(color) {
	const normalized = color.replace(/\s+/g, "");
	const match = normalized.match(/^#([0-9a-f]{6})$/i);
	if (!match) return true;

	const value = match[1];
	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance < 0.5;
}

function escapeHtml(text) {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function getTargetElement(container, targetId) {
	const decodedId = decodeURIComponent(targetId || "");
	if (!decodedId) return null;

	const elements = container.querySelectorAll("[id], [name]");
	return (
		Array.from(elements).find(
			(element) =>
				element.getAttribute("id") === decodedId ||
				element.getAttribute("name") === decodedId,
		) || null
	);
}

function getOffsetTopWithinContainer(target, container) {
	let top = 0;
	let element = target;

	while (element && element !== container) {
		top += element.offsetTop || 0;
		element = element.offsetParent;
	}

	return top;
}

async function getMermaid() {
	if (!mermaidModulePromise) {
		mermaidModulePromise = import("mermaid")
			.then(({ default: mermaid }) => mermaid)
			.catch((error) => {
				mermaidModulePromise = null;
				throw error;
			});
	}

	return mermaidModulePromise;
}

async function ensureMathStyles() {
	if (!mathStylesPromise) {
		mathStylesPromise = Promise.all([
			import("katex/dist/katex.min.css"),
			import("markdown-it-texmath/css/texmath.css"),
		]).catch((error) => {
			mathStylesPromise = null;
			throw error;
		});
	}

	return mathStylesPromise;
}

function getMermaidThemeConfig() {
	const backgroundColor = getThemeColor("--background-color", "#1e1e1e");
	const panelColor = getThemeColor("--popup-background-color", "#2a2f3a");
	const borderColor = getThemeColor("--border-color", "#4a4f5a");
	const primaryTextColor = getThemeColor("--primary-text-color", "#f5f5f5");
	const accentColor = getThemeColor("--link-text-color", "#4ba3ff");
	const activeColor = getThemeColor("--active-color", accentColor);

	return {
		startOnLoad: false,
		securityLevel: "strict",
		htmlLabels: false,
		theme: "base",
		flowchart: {
			htmlLabels: false,
		},
		themeVariables: {
			darkMode: isDarkColor(backgroundColor),
			background: backgroundColor,
			mainBkg: panelColor,
			primaryColor: panelColor,
			mainContrastColor: primaryTextColor,
			textColor: primaryTextColor,
			primaryTextColor,
			primaryBorderColor: borderColor,
			lineColor: primaryTextColor,
			secondaryColor: accentColor,
			secondaryBorderColor: borderColor,
			secondaryTextColor: primaryTextColor,
			tertiaryColor: backgroundColor,
			tertiaryBorderColor: borderColor,
			tertiaryTextColor: primaryTextColor,
			clusterBkg: panelColor,
			clusterBorder: borderColor,
			nodeBorder: borderColor,
			nodeTextColor: primaryTextColor,
			titleColor: primaryTextColor,
			defaultLinkColor: activeColor,
			actorTextColor: primaryTextColor,
			labelTextColor: primaryTextColor,
			loopTextColor: primaryTextColor,
			noteTextColor: primaryTextColor,
			sectionBkgColor: panelColor,
			sectionBkgColor2: backgroundColor,
			sectionTitleColor: primaryTextColor,
			sequenceNumberColor: primaryTextColor,
			signalTextColor: primaryTextColor,
			taskTextColor: primaryTextColor,
			taskTextDarkColor: primaryTextColor,
			taskTextOutsideColor: primaryTextColor,
			edgeLabelBackground: backgroundColor,
			pieTitleTextColor: primaryTextColor,
			pieLegendTextColor: primaryTextColor,
			pieSectionTextColor: primaryTextColor,
			git0: panelColor,
			git1: backgroundColor,
			git2: accentColor,
			git3: activeColor,
		},
	};
}

function initializeMermaid(mermaid) {
	const config = getMermaidThemeConfig();
	const signature = JSON.stringify(config);
	if (signature === mermaidThemeSignature) return;
	mermaid.initialize(config);
	mermaidThemeSignature = signature;
}

async function copyText(text) {
	if (cordova?.plugins?.clipboard) {
		cordova.plugins.clipboard.copy(text);
		return;
	}

	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	throw new Error("Clipboard API unavailable");
}

async function fileToObjectUrl(file) {
	const fs = fsOperation(file);
	const fileInfo = await fs.stat();
	const binData = await fs.readFile();
	return URL.createObjectURL(
		new Blob([binData], { type: fileInfo.mime || "application/octet-stream" }),
	);
}

function revokeObjectUrls(urls) {
	urls.forEach((url) => {
		try {
			URL.revokeObjectURL(url);
		} catch (error) {
			console.warn("Failed to revoke object URL", error);
		}
	});
}

async function resolveRenderedImages(container, file) {
	const baseUri = getMarkdownBaseUri(file);
	const objectUrls = [];
	const images = Array.from(container.querySelectorAll("img[src]"));

	images.forEach((image) => {
		const src = image.getAttribute("src");
		if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
		if (src.startsWith("#") || isExternalLink(src)) return;
		if (!image.hasAttribute("data-markdown-local-src")) {
			image.setAttribute(
				"data-markdown-local-src",
				resolveMarkdownTarget(src, baseUri),
			);
		}
	});

	await Promise.all(
		images.map(async (image) => {
			const resolvedPath = image.getAttribute("data-markdown-local-src");
			if (!resolvedPath) return;

			try {
				const objectUrl = await fileToObjectUrl(resolvedPath);

				image.setAttribute("src", objectUrl);
				image.setAttribute("data-source-uri", resolvedPath);
				image.setAttribute("loading", "lazy");
				image.setAttribute("decoding", "async");
				image.classList.add("markdown-image");
				objectUrls.push(objectUrl);
			} catch (error) {
				console.warn("Failed to resolve markdown image:", resolvedPath, error);
			}
		}),
	);

	return objectUrls;
}

function createMarkdownPreview(file) {
	const $page = Page(file.filename);
	const $content = <div className="main markdown-preview md"></div>;
	$page.body = $content;
	app.append($page);

	const previewState = {
		page: $page,
		file,
		content: $content,
		renderVersion: 0,
		objectUrls: [],
		pendingHash: "",
		disposed: false,
	};

	const removeAction = () => actionStack.remove("markdown-preview");

	actionStack.push({
		id: "markdown-preview",
		action: () => $page.hide(),
	});

	$page.onhide = () => {
		removeAction();
		dispose();
	};

	const onFileChanged = (changedFile) => {
		if (changedFile?.id !== previewState.file?.id) return;
		void render();
	};

	const onFileRenamed = (renamedFile) => {
		if (renamedFile?.id !== previewState.file?.id) return;
		previewState.file = renamedFile;
		$page.settitle(renamedFile.filename);
		void render();
	};

	const onFileRemoved = (removedFile) => {
		if (removedFile?.id !== previewState.file?.id) return;
		if ($page.isConnected) {
			$page.hide();
		} else {
			dispose();
		}
	};

	previewState.content.addEventListener("click", onContentClick, true);
	editorManager.on("file-content-changed", onFileChanged);
	editorManager.on("rename-file", onFileRenamed);
	editorManager.on("remove-file", onFileRemoved);
	initHighlighting();

	async function onContentClick(event) {
		const link = event.target.closest("a[href]");
		if (!link) return;

		const originalHref = link.getAttribute("href") || "";
		const resolvedHref =
			link.getAttribute("data-resolved-href") ||
			resolveMarkdownTarget(
				originalHref,
				getMarkdownBaseUri(previewState.file),
			);
		event.preventDefault();
		event.stopPropagation();

		if (originalHref.startsWith("#")) {
			scrollToHash(originalHref.slice(1));
			return;
		}

		if (isExternalLink(originalHref)) {
			system.openInBrowser(originalHref);
			return;
		}

		const hashIndex = resolvedHref.indexOf("#");
		const targetPath =
			hashIndex === -1 ? resolvedHref : resolvedHref.slice(0, hashIndex);
		const targetHash =
			hashIndex === -1 ? "" : resolvedHref.slice(hashIndex + 1);

		if (!targetPath && targetHash) {
			scrollToHash(targetHash);
			return;
		}

		if (isMarkdownPath(resolvedHref)) {
			await openFile(targetPath, { render: true });
			const nextFile =
				editorManager.getFile(targetPath, "uri") || editorManager.activeFile;
			if (nextFile) {
				await bind(nextFile, targetHash);
			}
			return;
		}

		$page.hide();
		await openFile(targetPath, { render: true });
	}

	function scrollToHash(targetId) {
		const target = getTargetElement(previewState.content, targetId);
		if (!target) return;

		const topOffset = 12;
		const top =
			getOffsetTopWithinContainer(target, previewState.content) - topOffset;

		previewState.content.scrollTo({
			top: Math.max(0, top),
			behavior: "smooth",
		});
	}

	async function enhanceCodeBlocks(version) {
		const codeBlocks = Array.from(previewState.content.querySelectorAll("pre"));

		await Promise.all(
			codeBlocks.map(async (pre) => {
				const codeElement = pre.querySelector("code");
				if (!codeElement || codeElement.closest(".mermaid-error")) return;

				const language =
					codeElement.dataset.language ||
					codeElement.className.match(/language-(\S+)/)?.[1];
				if (!language) return;

				const originalCode = codeElement.textContent || "";
				codeElement.classList.add("cm-highlighted");

				const highlighted = await highlightCodeBlock(originalCode, language);
				if (
					previewState.disposed ||
					version !== previewState.renderVersion ||
					!codeElement.isConnected
				) {
					return;
				}

				if (highlighted && highlighted !== originalCode) {
					codeElement.innerHTML = DOMPurify.sanitize(highlighted, {
						ALLOWED_TAGS: ["span"],
						ALLOWED_ATTR: ["class"],
					});
				}
			}),
		);

		if (previewState.disposed || version !== previewState.renderVersion) return;

		codeBlocks.forEach((pre) => {
			if (pre.querySelector(".copy-button")) return;

			pre.style.position = "relative";

			const copyButton = document.createElement("button");
			copyButton.className = "copy-button";
			copyButton.textContent = "Copy";
			copyButton.addEventListener("click", async (event) => {
				event.preventDefault();
				event.stopPropagation();

				try {
					const code = pre.querySelector("code")?.textContent || "";
					await copyText(code);
					copyButton.textContent = "Copied!";
					setTimeout(() => {
						if (copyButton.isConnected) copyButton.textContent = "Copy";
					}, 2000);
				} catch (error) {
					console.warn("Failed to copy markdown code block", error);
					copyButton.textContent = "Failed to copy";
					setTimeout(() => {
						if (copyButton.isConnected) copyButton.textContent = "Copy";
					}, 2000);
				}
			});

			pre.append(copyButton);
		});
	}

	async function renderMermaidBlocks(version) {
		const mermaidBlocks = Array.from(
			previewState.content.querySelectorAll(".mermaid"),
		);
		if (!mermaidBlocks.length) return;

		const mermaid = await getMermaid();
		if (previewState.disposed || version !== previewState.renderVersion) return;
		initializeMermaid(mermaid);
		let index = 0;
		await Promise.all(
			mermaidBlocks.map(async (block) => {
				const source = block.textContent || "";
				const id = `acode-markdown-mermaid-${Date.now()}-${version}-${index++}`;

				try {
					const { svg, bindFunctions } = await mermaid.render(id, source);
					if (
						previewState.disposed ||
						version !== previewState.renderVersion ||
						!block.isConnected
					) {
						return;
					}

					const sanitizedSvg = DOMPurify.sanitize(svg, {
						USE_PROFILES: { svg: true, svgFilters: true },
						ADD_TAGS: ["style"],
						ADD_ATTR: ["data-et", "data-id", "data-node", "data-zoom", "class"],
					});
					block.innerHTML = sanitizedSvg;
					bindFunctions?.(block);
				} catch (error) {
					if (!block.isConnected) return;
					block.classList.add("mermaid-error");
					block.innerHTML = `
						<pre><code>${escapeHtml(source)}</code></pre>
						<div class="mermaid-error-message">${escapeHtml(error?.message || "Failed to render Mermaid diagram.")}</div>
					`;
				}
			}),
		);
	}

	async function render() {
		const version = ++previewState.renderVersion;
		previewState.page.settitle(previewState.file.filename);
		revokeObjectUrls(previewState.objectUrls);
		previewState.objectUrls = [];

		const markdownText = previewState.file.session?.doc?.toString?.() || "";
		const pendingRenderTasks = [
			renderMarkdown(markdownText, previewState.file),
		];
		if (hasMathContent(markdownText)) {
			pendingRenderTasks.push(ensureMathStyles());
		}
		const [{ html }] = await Promise.all(pendingRenderTasks);

		if (previewState.disposed || version !== previewState.renderVersion) {
			return;
		}

		previewState.content.innerHTML = DOMPurify.sanitize(html, {
			FORBID_TAGS: ["style"],
			ADD_TAGS: ["eq", "eqn"],
		});

		const objectUrls = await resolveRenderedImages(
			previewState.content,
			previewState.file,
		);

		if (previewState.disposed || version !== previewState.renderVersion) {
			revokeObjectUrls(objectUrls);
			return;
		}
		previewState.objectUrls = objectUrls;
		await enhanceCodeBlocks(version);
		await renderMermaidBlocks(version);

		if (
			previewState.pendingHash &&
			!previewState.disposed &&
			version === previewState.renderVersion
		) {
			scrollToHash(previewState.pendingHash);
			previewState.pendingHash = "";
		}
	}

	async function bind(nextFile, hash = "") {
		previewState.file = nextFile;
		previewState.pendingHash = hash;
		if (!previewState.page.isConnected) {
			app.append(previewState.page);
		}
		await render();
	}

	function dispose() {
		if (previewState.disposed) return;
		previewState.disposed = true;
		previewState.content.removeEventListener("click", onContentClick, true);
		editorManager.off("file-content-changed", onFileChanged);
		editorManager.off("rename-file", onFileRenamed);
		editorManager.off("remove-file", onFileRemoved);
		revokeObjectUrls(previewState.objectUrls);
		if (previewController === controller) {
			previewController = null;
		}
	}

	const controller = {
		bind,
		render,
		page: $page,
	};

	return controller;
}

export default async function openMarkdownPreview(file, hash = "") {
	if (!file) return null;

	if (!previewController || previewController.page?.isConnected === false) {
		previewController = createMarkdownPreview(file);
	}

	await previewController.bind(file, hash);
	return previewController.page;
}
