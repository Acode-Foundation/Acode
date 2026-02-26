import "./styles.scss";
import actionStack from "lib/actionStack";
import { openReferencesTab } from "./referencesTab";
import {
	buildFlatList,
	clearHighlightCache,
	createReferenceItem,
	getReferencesStats,
	navigateToReference,
	sanitize,
} from "./utils";

let currentPanel = null;

function createReferencesPanel() {
	const state = {
		visible: false,
		expanded: false,
		loading: true,
		symbolName: "",
		references: [],
		collapsedFiles: new Set(),
		flatItems: [],
	};

	const $mask = <span className="references-panel-mask" />;
	const $panel = <div className="references-panel" />;
	const $dragHandle = <div className="drag-handle" />;
	const $title = <div className="header-title" />;
	const $subtitle = <span className="header-subtitle" />;
	const $content = <div className="panel-content" />;
	const $refList = <div className="references-list" />;

	const $openTabBtn = (
		<button
			className="action-btn open-tab-btn"
			title="Open in Tab"
			onclick={openInTab}
		>
			<span className="icon fullscreen" />
		</button>
	);

	const $closeBtn = (
		<button className="action-btn close-btn" onclick={hide}>
			<span className="icon clearclose" />
		</button>
	);

	const $header = (
		<div className="panel-header">
			<div className="header-content">
				{$title}
				{$subtitle}
			</div>
			<div className="header-actions">
				{$openTabBtn}
				{$closeBtn}
			</div>
		</div>
	);

	$panel.append($dragHandle, $header, $content);
	$mask.onclick = hide;

	let startY = 0;
	let currentY = 0;
	let isDragging = false;

	$dragHandle.ontouchstart = onDragStart;
	$dragHandle.onmousedown = onDragStart;

	function onDragStart(e) {
		isDragging = true;
		startY = e.touches ? e.touches[0].clientY : e.clientY;
		currentY = startY;
		$panel.style.transition = "none";

		document.addEventListener("touchmove", onDragMove, { passive: false });
		document.addEventListener("mousemove", onDragMove);
		document.addEventListener("touchend", onDragEnd);
		document.addEventListener("mouseup", onDragEnd);
	}

	function onDragMove(e) {
		if (!isDragging) return;
		e.preventDefault();
		currentY = e.touches ? e.touches[0].clientY : e.clientY;
		const deltaY = currentY - startY;

		if (deltaY > 0) {
			$panel.style.transform = `translateY(${deltaY}px)`;
		} else if (!state.expanded) {
			const expansion = Math.min(Math.abs(deltaY), 100);
			$panel.style.maxHeight = `${60 + (expansion / 100) * 25}vh`;
		}
	}

	function onDragEnd() {
		isDragging = false;
		document.removeEventListener("touchmove", onDragMove);
		document.removeEventListener("mousemove", onDragMove);
		document.removeEventListener("touchend", onDragEnd);
		document.removeEventListener("mouseup", onDragEnd);

		$panel.style.transition = "";
		const deltaY = currentY - startY;

		if (deltaY > 100) {
			hide();
		} else if (deltaY < -50 && !state.expanded) {
			state.expanded = true;
			$panel.classList.add("expanded");
			$panel.style.transform = "";
			$panel.style.maxHeight = "";
		} else {
			$panel.style.transform = "";
			$panel.style.maxHeight = "";
		}
	}

	function setTitle(symbolName) {
		$title.innerHTML = "";
		$title.append(
			<span className="icon linkinsert_link" />,
			<span>References to </span>,
			<span className="symbol-name">{sanitize(symbolName)}</span>,
		);
	}

	function setSubtitle(text) {
		$subtitle.textContent = text;
	}

	function openInTab() {
		const refs = state.references;
		const sym = state.symbolName;
		hide();
		openReferencesTab({
			symbolName: sym,
			references: refs,
		});
	}

	function toggleFile(uri) {
		if (state.collapsedFiles.has(uri)) {
			state.collapsedFiles.delete(uri);
		} else {
			state.collapsedFiles.add(uri);
		}
		renderReferencesList();
	}

	function renderLoading() {
		$content.innerHTML = "";
		$content.append(
			<div className="loading-state">
				<div className="loader" />
				<span>Finding references...</span>
			</div>,
		);
	}

	function renderEmpty() {
		$content.innerHTML = "";
		$content.append(
			<div className="empty-state">
				<span className="icon search" />
				<span>No references found</span>
			</div>,
		);
	}

	function renderReferencesList() {
		$refList.innerHTML = "";

		const visibleItems = state.flatItems.filter((item) => {
			if (item.type === "file-header") return true;
			return !state.collapsedFiles.has(item.uri);
		});

		const fragment = document.createDocumentFragment();

		for (const item of visibleItems) {
			const $el = createReferenceItem(item, {
				collapsedFiles: state.collapsedFiles,
				onToggleFile: toggleFile,
				onNavigate: (ref) => {
					hide();
					navigateToReference(ref);
				},
			});
			fragment.appendChild($el);
		}

		$refList.appendChild(fragment);
		$content.innerHTML = "";
		$content.appendChild($refList);
	}

	async function renderReferences() {
		$content.innerHTML = "";
		$content.append(
			<div className="loading-state">
				<div className="loader" />
				<span>Highlighting code...</span>
			</div>,
		);

		const stats = getReferencesStats(state.references);
		setSubtitle(stats.text);

		state.flatItems = await buildFlatList(state.references, state.symbolName);

		renderReferencesList();
	}

	function show(options = {}) {
		if (currentPanel && currentPanel !== panelInstance) {
			currentPanel.hide();
		}
		currentPanel = panelInstance;

		state.symbolName = options.symbolName || "";
		state.references = [];
		state.loading = true;
		state.expanded = false;
		state.collapsedFiles.clear();
		state.flatItems = [];

		clearHighlightCache();

		setTitle(state.symbolName);
		setSubtitle("Searching...");
		renderLoading();

		document.body.append($mask, $panel);

		requestAnimationFrame(() => {
			$mask.classList.add("visible");
			$panel.classList.add("visible");
			$panel.classList.remove("expanded");
		});

		state.visible = true;

		actionStack.push({
			id: "references-panel",
			action: hide,
		});
	}

	function hide() {
		if (!state.visible) return;
		state.visible = false;

		$mask.classList.remove("visible");
		$panel.classList.remove("visible");

		actionStack.remove("references-panel");

		setTimeout(() => {
			$mask.remove();
			$panel.remove();
		}, 250);

		if (currentPanel === panelInstance) {
			currentPanel = null;
		}
	}

	function setReferences(references) {
		state.loading = false;
		state.references = references || [];

		if (state.references.length === 0) {
			setSubtitle("No references found");
			renderEmpty();
		} else {
			renderReferences();
		}
	}

	function setError(message) {
		state.loading = false;
		setSubtitle("Error");
		$content.innerHTML = "";
		$content.append(
			<div className="empty-state">
				<span className="icon error_outline" />
				<span>{sanitize(message)}</span>
			</div>,
		);
	}

	const panelInstance = {
		show,
		hide,
		setReferences,
		setError,
		get visible() {
			return state.visible;
		},
	};

	return panelInstance;
}

let panelSingleton = null;

function getPanel() {
	if (!panelSingleton) {
		panelSingleton = createReferencesPanel();
	}
	return panelSingleton;
}

export function showReferencesPanel(options) {
	const panel = getPanel();
	panel.show(options);
	return panel;
}

export function hideReferencesPanel() {
	const panel = getPanel();
	panel.hide();
}

export { openReferencesTab };

export default {
	show: showReferencesPanel,
	hide: hideReferencesPanel,
	getPanel,
	openReferencesTab,
};
