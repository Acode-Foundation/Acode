import EditorFile from "lib/editorFile";
import {
	buildFlatList,
	clearHighlightCache,
	createReferenceItem,
	getReferencesStats,
	navigateToReference,
	sanitize,
} from "./utils";

export function createReferencesTab(options = {}) {
	const {
		symbolName = "",
		references = [],
		flatItems: prebuiltItems = null,
	} = options;
	const collapsedFiles = new Set();
	let flatItems = prebuiltItems || [];
	let isInitialized = false;

	const $container = <div className="references-tab-container" />;
	const $listContainer = <div className="references-list-container" />;
	const $refList = <div className="references-list" />;

	const stats = getReferencesStats(references);

	const $header = (
		<div className="references-tab-header">
			<div className="header-info">
				<span className="icon linkinsert_link" />
				<span className="header-title">
					References to <code>{sanitize(symbolName)}</code>
				</span>
				<span className="header-stats">{stats.text}</span>
			</div>
		</div>
	);

	const $loadingState = (
		<div className="loading-state">
			<div className="loader" />
			<span>Highlighting code...</span>
		</div>
	);

	$container.append($header, $listContainer);

	function getVisibleItems() {
		return flatItems.filter((item) => {
			if (item.type === "file-header") return true;
			return !collapsedFiles.has(item.uri);
		});
	}

	function toggleFile(uri) {
		if (collapsedFiles.has(uri)) {
			collapsedFiles.delete(uri);
		} else {
			collapsedFiles.add(uri);
		}
		renderList();
	}

	function renderList() {
		$refList.innerHTML = "";

		const visibleItems = getVisibleItems();
		const fragment = document.createDocumentFragment();

		for (const item of visibleItems) {
			const $el = createReferenceItem(item, {
				collapsedFiles,
				onToggleFile: toggleFile,
				onNavigate: navigateToReference,
			});
			fragment.appendChild($el);
		}

		$refList.appendChild(fragment);
	}

	async function init() {
		if (isInitialized) return;
		isInitialized = true;

		if (!prebuiltItems || prebuiltItems.length === 0) {
			$listContainer.appendChild($loadingState);
			flatItems = await buildFlatList(references, symbolName);
			$loadingState.remove();
		}

		renderList();
		$listContainer.appendChild($refList);
	}

	function destroy() {
		$refList.innerHTML = "";
	}

	return {
		container: $container,
		init,
		destroy,
		get symbolName() {
			return symbolName;
		},
		get referenceCount() {
			return references.length;
		},
	};
}

export async function openReferencesTab(options = {}) {
	const { symbolName = "", references = [] } = options;

	const tabName = `Refs: ${symbolName}`;
	const existingFile = editorManager.getFile(tabName, "filename");
	if (existingFile) {
		existingFile.makeActive();
		return existingFile;
	}

	clearHighlightCache();
	const flatItems = await buildFlatList(references, symbolName);
	const stats = getReferencesStats(references);

	const tabView = createReferencesTab({ symbolName, references, flatItems });

	const file = new EditorFile(tabName, {
		type: "terminal",
		content: tabView.container,
		tabIcon: "icon linkinsert_link",
		render: true,
	});

	file.setCustomTitle(() => stats.text);
	tabView.init();

	file.on("close", () => {
		tabView.destroy();
	});

	return file;
}

export default {
	createReferencesTab,
	openReferencesTab,
};
