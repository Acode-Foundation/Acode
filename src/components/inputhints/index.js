import "./style.scss";

/**
 * @typedef {Object} HintObj
 * @property {string} value
 * @property {string} text
 */

/**
 * @typedef {HintObj|string} Hint
 */

/**
 * @typedef {Object} HintModification
 * @property {(hint:Hint, index:number)=>void} add
 * @property {(hint:Hint)=>void} remove
 * @property {(index:number)=>void} removeIndex
 */

/**
 * @typedef {(setHints:(hints:Array<Hint>)=>void, modification: HintModification) => void} HintCallback
 */

/**
 * Generate a list of hints for an input field
 * @param {HTMLInputElement} $input Input field
 * @param {Array<Hint>|HintCallback} hints Hints or a callback to generate hints
 * @param {(value: string) => void} onSelect Callback to call when a hint is selected
 * @returns {{getSelected: ()=>HTMLLIElement, container: HTMLUListElement}}
 */
export default function inputhints($input, hints, onSelect) {
	/**@type {HTMLUListElement} */
	const $ul = <Ul />;
	const LIMIT = 100;

	let preventUpdate = false;
	let updateUlTimeout;
	let pages = 0;
	let currentHints = [];

	$input.addEventListener("focus", onfocus);

	if (typeof hints === "function") {
		const cb = hints;
		hints = [];
		$ul.content = [<Hint hint={{ value: "", text: strings["loading..."] }} />];
		cb(setHints, hintModification());
	} else {
		setHints(hints);
	}

	/**
	 * Retain the focus on the input field
	 */
	function handleMouseDown() {
		preventUpdate = true;
	}

	function handleMouseUp() {
		$input.focus();
		preventUpdate = false;
	}

	/**
	 * Handle click event
	 * @param {MouseEvent} e Event
	 */
	function handleClick(e) {
		const $el = e.target;
		const action = $el.getAttribute("action");
		if (action !== "hint") return;
		const value = $el.getAttribute("value");
		if (!value) {
			onblur();
			return;
		}
		$input.value = $el.textContent;
		if (onSelect) onSelect(value);
		preventUpdate = false;
		onblur();
	}

	/**
	 * Handle keypress event
	 * @param {KeyboardEvent} e Event
	 */
	function handleKeypress(e) {
		if (e.key !== "Enter") return;

		e.preventDefault();
		e.stopPropagation();
		const activeHint = $ul.get(".active");
		if (!activeHint) return;
		const value = activeHint.getAttribute("value");
		if (onSelect) onSelect(value);
		else $input.value = value;
	}

	/**
	 * Handle keydown event
	 * @param {KeyboardEvent} e Event
	 */
	function handleKeydown(e) {
		const code = e.key;
		if (code === "ArrowUp" || code === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
		}
		updateHintFocus(code);
	}

	/**
	 * Moves the active hint up or down
	 * @param {"ArrowDown" | "ArrowUp"} key Direction to move
	 */
	function updateHintFocus(key) {
		let nextHint;
		let activeHint = $ul.get(".active");
		if (!activeHint) activeHint = $ul.firstChild;

		if (key === "ArrowDown") {
			nextHint = activeHint.nextElementSibling;
			if (!nextHint) nextHint = $ul.firstElementChild;
		} else if (key === "ArrowUp") {
			nextHint = activeHint.previousElementSibling;
			if (!nextHint) nextHint = $ul.lastElementChild;
		}

		if (nextHint) {
			activeHint.classList.remove("active");
			nextHint.classList.add("active");
			nextHint.scrollIntoView();
		}
	}

	/**
	 * @this {HTMLInputElement}
	 */
	function oninput() {
		const { value: toTest } = this;
		const matched = [];
		const regexp = new RegExp(toTest, "i");
		hints.forEach((hint) => {
			const { value, text } = hint;
			if (regexp.test(value) || regexp.test(text)) {
				matched.push(hint);
			}
		});
		updateUl(matched);
	}

	function onfocus() {
		if (preventUpdate) return;

		$input.addEventListener("keypress", handleKeypress);
		$input.addEventListener("keydown", handleKeydown);
		$input.addEventListener("blur", onblur);
		$input.addEventListener("input", oninput);
		window.addEventListener("resize", position);
		ulAddEventListeners();
		app.append($ul);
		position();
	}

	/**
	 * Event listener for blur
	 * @returns
	 */
	function onblur() {
		if (preventUpdate) return;

		clearTimeout(updateUlTimeout);
		$input.removeEventListener("keypress", handleKeypress);
		$input.removeEventListener("keydown", handleKeydown);
		$input.removeEventListener("blur", onblur);
		$input.removeEventListener("input", oninput);
		window.removeEventListener("resize", position);
		ulRemoveEventListeners();
		$ul.remove();
	}

	/**
	 * Update the position of the hint list
	 * @param {boolean} append Append the list to the body or not
	 */
	function position() {
		const activeHint = $ul.get(".active");
		const { firstElementChild } = $ul;
		if (!activeHint && firstElementChild)
			firstElementChild.classList.add("active");
		const client = $input.getBoundingClientRect();
		const inputTop = client.top - 5;
		const inputBottom = client.bottom + 5;
		const inputLeft = client.left;
		const bottomHeight = window.innerHeight - inputBottom;
		const mid = window.innerHeight / 2;

		if (bottomHeight >= mid) {
			$ul.classList.remove("bottom");
			$ul.style.top = `${inputBottom}px`;
			$ul.style.bottom = "auto";
		} else {
			$ul.classList.add("bottom");
			$ul.style.top = "auto";
			$ul.style.bottom = `${inputTop}px`;
		}

		$ul.style.left = `${inputLeft}px`;
		$ul.style.width = `${client.width}px`;
	}

	/**
	 * Set hint items
	 * @param {Array<Hint>} list Hint items
	 */
	function setHints(list) {
		if (Array.isArray(list)) {
			hints = list;
		} else {
			hints = [];
		}
		updateUl(hints);
		$ul.classList.remove("loading");
	}

	function hintModification() {
		return {
			add(item, index) {
				if (index) {
					hints.splice(index, 0, item);
					const child = $ul.children[index];
					if (child) {
						$ul.insertBefore(child, $ul.children[index]);
					}
					return;
				}

				hints.push(item);
			},
			remove(item) {
				const index = hints.indexOf(item);
				if (index > -1) {
					hints.splice(index, 1);
				}
			},
			removeIndex(index) {
				hints.splice(index, 1);
			},
		};
	}

	function ulAddEventListeners() {
		window.addEventListener("resize", position);
		$ul.addEventListener("click", handleClick);
		$ul.addEventListener("mousedown", handleMouseDown);
		$ul.addEventListener("mouseup", handleMouseUp);
		$ul.addEventListener("touchstart", handleMouseDown);
		$ul.addEventListener("touchend", handleMouseUp);
		$ul.addEventListener("scroll", updatePage);
	}

	function ulRemoveEventListeners() {
		window.removeEventListener("resize", position);
		$ul.removeEventListener("click", handleClick);
		$ul.removeEventListener("mousedown", handleMouseDown);
		$ul.removeEventListener("mouseup", handleMouseUp);
		$ul.removeEventListener("touchstart", handleMouseDown);
		$ul.removeEventListener("touchend", handleMouseUp);
		$ul.removeEventListener("scroll", updatePage);
	}

	function updatePage() {
		const offset = (pages + 1) * LIMIT;
		const hasMore = offset < currentHints.length;

		// if the scroll is at the bottom
		if ($ul.scrollTop + $ul.clientHeight >= $ul.scrollHeight && hasMore) {
			pages++;
			updateUlNow(currentHints, pages);
		}
	}

	/**
	 * First time updates the hint instantly, then debounce
	 * @param {Array<HintObj>} hints
	 */
	function updateUl(hints) {
		updateUlNow(hints);
		updateUl = updateUlDebounce;
	}

	/**
	 * Update the hint list after a delay
	 * @param {Array<HintObj>} hints
	 */
	function updateUlDebounce(hints) {
		clearTimeout(updateUlTimeout);
		updateUlTimeout = setTimeout(updateUlNow, 300, hints);
	}

	/**
	 * Update the hint list instantly
	 * @param {Array<HintObj>} hints
	 * @param {number} page
	 */
	function updateUlNow(hints, page = 0) {
		// render only first 500 hints
		currentHints = hints;
		const offset = page * LIMIT;
		const end = offset + LIMIT;
		const list = hints.slice(offset, end);
		let scrollTop = $ul.scrollTop;
		//if (!list.length) return;

		$ul.remove();

		if (!hints.length) {
			$ul.content = [<Hint hint={{ value: "", text: "No matches found" }} />];
		} else if (!list.length) {
			// No more hints to load
			return;
		} else {
			if (!page) {
				scrollTop = 0;
				$ul.content = list.map((hint) => <Hint hint={hint} />);
			} else {
				$ul.append(...list.map((hint) => <Hint hint={hint} />));
			}
		}
		app.append($ul);
		$ul.scrollTop = scrollTop;
		position(); // Update the position of the new list
	}

	return {
		getSelected() {
			$ul.get(".active");
		},
		get container() {
			return $ul;
		},
	};
}

/**
 * Create a hint item
 * @param {object} param0 Hint item
 * @param {HintObj} param0.hint Hint item
 * @returns {HTMLLIElement}
 */
function Hint({ hint }) {
	let value = "";
	let text = "";

	if (typeof hint === "string") {
		value = hint;
		text = hint;
	} else {
		value = hint.value;
		text = hint.text;
	}

	return <li attr-action="hint" attr-value={value} innerHTML={text}></li>;
}

/**
 * Create a hint list
 * @param {object} param0 Attributes
 * @param {Array<Hint>} param0.hints Hint items
 * @returns {HTMLUListElement}
 */
function Ul({ hints = [] }) {
	return (
		<ul id="hints" className="scroll">
			{hints.map((hint) => (
				<Hint hint={hint} />
			))}
		</ul>
	);
}
