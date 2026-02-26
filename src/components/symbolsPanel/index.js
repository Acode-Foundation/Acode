import "./styles.scss";
import { fetchDocumentSymbols, navigateToSymbol } from "cm/lsp";
import actionStack from "lib/actionStack";

let currentPanel = null;

const SYMBOL_KIND_ABBREV = {
	1: "Fi",
	2: "Mo",
	3: "Ns",
	4: "Pk",
	5: "C",
	6: "M",
	7: "P",
	8: "F",
	9: "Co",
	10: "E",
	11: "I",
	12: "fn",
	13: "V",
	14: "c",
	15: "S",
	16: "#",
	17: "B",
	18: "[]",
	19: "{}",
	20: "K",
	21: "∅",
	22: "Em",
	23: "St",
	24: "Ev",
	25: "Op",
	26: "T",
};

function sanitize(str) {
	if (!str) return "";
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function flattenSymbolsForDisplay(symbols, depth = 0) {
	const result = [];
	for (const sym of symbols) {
		result.push({
			...sym,
			depth,
			id: `${sym.selectionRange.startLine}-${sym.selectionRange.startCharacter}-${sym.name}`,
		});
		if (sym.children && sym.children.length > 0) {
			result.push(...flattenSymbolsForDisplay(sym.children, depth + 1));
		}
	}
	return result;
}

function createSymbolsPanel() {
	const state = {
		visible: false,
		expanded: false,
		loading: true,
		symbols: [],
		flatSymbols: [],
		filteredSymbols: [],
		searchQuery: "",
		editorView: null,
	};

	const $mask = <span className="symbols-panel-mask" />;
	const $panel = <div className="symbols-panel" />;
	const $dragHandle = <div className="drag-handle" />;
	const $title = <div className="header-title" />;
	const $subtitle = <span className="header-subtitle" />;
	const $searchInput = (
		<input
			type="text"
			placeholder="Filter symbols..."
			oninput={onSearchInput}
		/>
	);
	const $content = <div className="panel-content" />;
	const $symbolsList = <div className="symbols-list" />;

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
			<div className="header-actions">{$closeBtn}</div>
		</div>
	);

	const $search = <div className="panel-search">{$searchInput}</div>;

	$panel.append($dragHandle, $header, $search, $content);
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

	function setTitle(text) {
		$title.innerHTML = "";
		$title.append(
			<span className="icon document-code" />,
			<span>{sanitize(text)}</span>,
		);
	}

	function setSubtitle(text) {
		$subtitle.textContent = text;
	}

	function onSearchInput(e) {
		state.searchQuery = e.target.value.trim();
		filterSymbols();
	}

	function clearSearch() {
		$searchInput.value = "";
		state.searchQuery = "";
	}

	function filterSymbols() {
		const query = state.searchQuery.toLowerCase();

		if (!query) {
			state.filteredSymbols = state.flatSymbols;
		} else {
			state.filteredSymbols = state.flatSymbols.filter((sym) => {
				const nameMatch = sym.name.toLowerCase().includes(query);
				const kindMatch = sym.kindName.toLowerCase().includes(query);
				const detailMatch = sym.detail?.toLowerCase().includes(query);
				return nameMatch || kindMatch || detailMatch;
			});
		}

		updateList();
	}

	function updateList() {
		setSubtitle(getSubtitle());
		renderSymbolsList();
	}

	function getSubtitle() {
		const total = state.flatSymbols.length;
		const filtered = state.filteredSymbols.length;

		if (total === 0) return "No symbols";
		if (filtered === total) return `${total} symbol${total !== 1 ? "s" : ""}`;
		return `${filtered} of ${total} symbols`;
	}

	function renderLoading() {
		$content.innerHTML = "";
		$content.append(
			<div className="loading-state">
				<div className="loader" />
				<span>Loading symbols...</span>
			</div>,
		);
	}

	function renderEmpty() {
		const message = state.searchQuery
			? "No matching symbols"
			: "No symbols found";
		$content.innerHTML = "";
		$content.append(
			<div className="empty-state">
				<span className="icon search" />
				<span>{message}</span>
			</div>,
		);
	}

	function renderNotSupported() {
		$content.innerHTML = "";
		$content.append(
			<div className="empty-state">
				<span className="icon error_outline" />
				<span>Language server does not support document symbols</span>
			</div>,
		);
	}

	function highlightMatch(text, query) {
		if (!query) return sanitize(text);

		const lowerText = text.toLowerCase();
		const lowerQuery = query.toLowerCase();
		const index = lowerText.indexOf(lowerQuery);

		if (index === -1) return sanitize(text);

		const before = sanitize(text.slice(0, index));
		const match = sanitize(text.slice(index, index + query.length));
		const after = sanitize(text.slice(index + query.length));

		return `${before}<span class="symbol-match">${match}</span>${after}`;
	}

	function createSymbolItem(symbol) {
		const kindName = symbol.kindName || "Unknown";
		const kindClass = `kind-${kindName.toLowerCase().replace(/\s+/g, "")}`;
		const abbrev = SYMBOL_KIND_ABBREV[symbol.kind] || "?";
		const indent = (symbol.depth || 0) * 16;
		const startLine = symbol.selectionRange?.startLine ?? 0;

		const $item = (
			<div className="symbol-item" onclick={() => onSymbolClick(symbol)}>
				<span className="symbol-indent" style={`width: ${indent}px`} />
				<span className={`symbol-icon ${kindClass}`}>{abbrev}</span>
				<span className="symbol-info">
					<span className="symbol-name" />
					{symbol.detail && (
						<span className="symbol-detail">{sanitize(symbol.detail)}</span>
					)}
				</span>
				<span className="symbol-line">:{startLine + 1}</span>
			</div>
		);

		$item.get(".symbol-name").innerHTML = highlightMatch(
			symbol.name,
			state.searchQuery,
		);

		return $item;
	}

	function renderSymbolsList() {
		$symbolsList.innerHTML = "";

		if (state.filteredSymbols.length === 0) {
			renderEmpty();
			return;
		}

		$content.innerHTML = "";
		const fragment = document.createDocumentFragment();

		for (const symbol of state.filteredSymbols) {
			fragment.appendChild(createSymbolItem(symbol));
		}

		$symbolsList.appendChild(fragment);
		$content.appendChild($symbolsList);
	}

	function onSymbolClick(symbol) {
		if (!state.editorView) return;
		hide();
		navigateToSymbol(state.editorView, symbol);
	}

	async function loadSymbols() {
		if (!state.editorView) {
			renderNotSupported();
			return;
		}

		renderLoading();

		try {
			const symbols = await fetchDocumentSymbols(state.editorView);

			if (symbols === null) {
				state.loading = false;
				setSubtitle("Not supported");
				renderNotSupported();
				return;
			}

			state.loading = false;
			state.symbols = symbols;
			state.flatSymbols = flattenSymbolsForDisplay(symbols);
			state.filteredSymbols = state.flatSymbols;

			if (state.flatSymbols.length === 0) {
				setSubtitle("No symbols");
				renderEmpty();
			} else {
				setSubtitle(getSubtitle());
				renderSymbolsList();
			}
		} catch (error) {
			console.error("Failed to load symbols:", error);
			state.loading = false;
			setSubtitle("Error");
			$content.innerHTML = "";
			$content.append(
				<div className="empty-state">
					<span className="icon error_outline" />
					<span>{sanitize(error.message || "Failed to load symbols")}</span>
				</div>,
			);
		}
	}

	function show(options = {}) {
		if (currentPanel && currentPanel !== panelInstance) {
			currentPanel.hide();
		}
		currentPanel = panelInstance;

		state.editorView = options.view || null;
		state.symbols = [];
		state.flatSymbols = [];
		state.filteredSymbols = [];
		state.searchQuery = "";
		state.loading = true;
		state.expanded = false;

		clearSearch();
		setTitle("Document Outline");
		setSubtitle("Loading...");
		renderLoading();

		document.body.append($mask, $panel);

		requestAnimationFrame(() => {
			$mask.classList.add("visible");
			$panel.classList.add("visible");
			$panel.classList.remove("expanded");
		});

		state.visible = true;

		actionStack.push({
			id: "symbols-panel",
			action: hide,
		});

		loadSymbols();
	}

	function hide() {
		if (!state.visible) return;
		state.visible = false;

		$mask.classList.remove("visible");
		$panel.classList.remove("visible");

		actionStack.remove("symbols-panel");

		setTimeout(() => {
			$mask.remove();
			$panel.remove();
		}, 250);

		if (currentPanel === panelInstance) {
			currentPanel = null;
		}

		if (state.editorView) {
			state.editorView.focus();
		}
	}

	const panelInstance = {
		show,
		hide,
		get visible() {
			return state.visible;
		},
	};

	return panelInstance;
}

let panelSingleton = null;

function getPanel() {
	if (!panelSingleton) {
		panelSingleton = createSymbolsPanel();
	}
	return panelSingleton;
}

export function showSymbolsPanel(options) {
	const panel = getPanel();
	panel.show(options);
	return panel;
}

export function hideSymbolsPanel() {
	const panel = getPanel();
	panel.hide();
}

export async function showDocumentSymbols(view) {
	if (!view) {
		const em = globalThis.editorManager;
		view = em?.editor;
	}

	if (!view) {
		const toast = globalThis.toast;
		toast?.("No editor available");
		return false;
	}

	showSymbolsPanel({ view });
	return true;
}

export default {
	show: showSymbolsPanel,
	hide: hideSymbolsPanel,
	showDocumentSymbols,
	getPanel,
};
