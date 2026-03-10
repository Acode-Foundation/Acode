import "./style.scss";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";

/**
 * Create and activate search bar
 * @param {HTMLUListElement|HTMLOListElement} $list
 * @param {(hide:Function)=>void} setHide
 * @param {()=>void} onhideCb callback to be called when search bar is hidden
 * @param {(value:string)=>HTMLElement[]} searchFunction
 */
function searchBar($list, setHide, onhideCb, searchFunction) {
	let hideOnBlur = true;
	let timeout = null;
	const $searchInput = Ref();
	/**@type {HTMLDivElement} */
	const $container = (
		<div id="search-bar">
			<input
				ref={$searchInput}
				type="search"
				placeholder={strings.search}
				enterKeyHint="go"
			/>
			<span className="icon clearclose" onclick={hide}></span>
		</div>
	);

	/**@type {HTMLElement[]} */
	const children = [...$list.children];

	if (typeof setHide === "function") {
		hideOnBlur = false;
		setHide(hide);
	}
	app.appendChild($container);

	$searchInput.el.oninput = search;
	$searchInput.el.focus();
	$searchInput.el.onblur = () => {
		if (!hideOnBlur) return;
		setTimeout(hide, 0);
	};

	actionStack.push({
		id: "searchbar",
		action: hide,
	});

	function hide() {
		actionStack.remove("searchbar");
		if (typeof onhideCb === "function") onhideCb();

		$list.content = children;
		$container.classList.add("hide");
		setTimeout(() => {
			$container.remove();
		}, 300);
	}

	function search() {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(searchNow.bind(this), 500);
	}

	/**
	 * @this {HTMLInputElement}
	 */
	async function searchNow() {
		const val = $searchInput.value.toLowerCase();

		if (!val) {
			$list.content = children;
			return;
		}

		let result;

		if (searchFunction) {
			result = searchFunction(val);

			if (result instanceof Promise) {
				try {
					result = await result;
				} catch (error) {
					window.log("error", "Search function failed:");
					window.log("error", error);
					result = [];
				}
			}
		} else {
			result = filterList(val);
		}

		$list.textContent = "";
		$list.append(...buildSearchContent(result, val));
	}

	/**
	 * Search list items
	 * @param {string} val
	 * @returns
	 */
	function filterList(val) {
		return children.filter((child) => {
			const text = child.textContent.toLowerCase();
			return text.match(val, "i");
		});
	}

	/**
	 * Keep grouped settings search results in section cards instead of flattening them.
	 * @param {HTMLElement[]} result
	 * @param {string} val
	 * @returns {HTMLElement[]}
	 */
	function buildSearchContent(result, val) {
		if (!val || !result.length) return result;

		const groupedSections = [];
		const sectionIndexByLabel = new Map();
		let hasGroups = false;

		result.forEach(($item) => {
			const label = $item.dataset.searchGroup;
			if (!label) {
				groupedSections.push({
					items: [$item],
					type: "ungrouped",
				});
				return;
			}

			hasGroups = true;
			const existingSectionIndex = sectionIndexByLabel.get(label);
			if (existingSectionIndex !== undefined) {
				groupedSections[existingSectionIndex].items.push($item);
				return;
			}

			sectionIndexByLabel.set(label, groupedSections.length);
			groupedSections.push({
				items: [$item],
				label,
				type: "group",
			});
		});

		if (!hasGroups) return result.map(cloneSearchItem);

		const countLabel = `${result.length} ${
			result.length === 1
				? strings["search result label singular"]
				: strings["search result label plural"]
		}`;
		const content = [
			<div className="settings-search-summary">{countLabel}</div>,
		];

		groupedSections.forEach((section) => {
			if (section.type === "ungrouped") {
				content.push(...section.items.map(cloneSearchItem));
				return;
			}

			content.push(
				<section className="settings-section settings-search-section">
					<div className="settings-section-label">{section.label}</div>
					<div className="settings-section-card">
						{section.items.map(cloneSearchItem)}
					</div>
				</section>,
			);
		});

		return content;
	}

	/**
	 * Render search results without moving the original list items out of their groups.
	 * @param {HTMLElement} $item
	 * @returns {HTMLElement}
	 */
	function cloneSearchItem($item) {
		const $clone = $item.cloneNode(true);
		$clone.addEventListener("click", () => {
			$item.click();
		});
		return $clone;
	}
}

export default searchBar;
