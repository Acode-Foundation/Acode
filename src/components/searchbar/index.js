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

		if (!$list.parentElement) return;
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
		$list.append(...result);
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
}

export default searchBar;
