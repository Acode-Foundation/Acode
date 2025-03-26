/**@type {HTMLElement} */
let $apps;
/**@type {HTMLElement} */
let $sidebar;
/**@type {HTMLElement} */
let $contaienr;

export default class SidebarApp {
	/**@type {HTMLSpanElement} */
	#icon;
	/**@type {string} */
	#id;
	/**@type {string} */
	#init;
	/**@type {string} */
	#title;
	/**@type {boolean} */
	#active;
	/**@type {(el:HTMLElement)=>void} */
	#onselect;
	/**@type {HTMLElement} */
	#container;

	/**
	 * Creates a new sidebar app.
	 * @param {string} icon
	 * @param {string} id
	 * @param {string} title
	 * @param {(el:HTMLElement)=>void} init
	 * @param {(el:HTMLElement)=>void} onselect
	 */
	constructor(icon, id, title, init, onselect) {
		const emptyFunc = () => {};
		this.#container = <div className="container" />;
		this.#icon = <Icon icon={icon} id={id} title={title} />;
		this.#id = id;
		this.#title = title;
		this.#init = init || emptyFunc;
		this.#onselect = onselect || emptyFunc;
		this.#init(this.#container);
	}

	/**
	 * Installs the app in the sidebar.
	 * @param {boolean} prepend
	 * @returns {void}
	 */
	install(prepend = false) {
		if (prepend) {
			$apps.prepend(this.#icon);
			return;
		}

		$apps.append(this.#icon);
	}

	/**
	 * Initialize the sidebar element.
	 * @param {HTMLElement} $el  sidebar element
	 * @param {HTMLElement} $el2 apps element
	 */
	static init($el, $el2) {
		$sidebar = $el;
		$apps = $el2;
	}

	/**@type {HTMLSpanElement} */
	get icon() {
		return this.#icon;
	}

	/**@type {string} */
	get id() {
		return this.#id;
	}

	/**@type {string} */
	get title() {
		return this.#title;
	}

	/**@type {boolean} */
	get active() {
		return !!this.#active;
	}

	/**@param {boolean} value */
	set active(value) {
		this.#active = !!value;
		this.#icon.classList.toggle("active", this.#active);
		if (this.#active) {
			const child = getContainer(this.#container);
			$sidebar.replaceChild($contaienr, child);
			this.#onselect(this.#container);
		}
	}

	/**@type {HTMLElement} */
	get container() {
		return this.#container;
	}

	/**@type {(el:HTMLElement)=>void} */
	get init() {
		return this.#init;
	}

	/**@type {(el:HTMLElement)=>void} */
	get onselect() {
		return this.#onselect;
	}

	remove() {
		this.#icon.remove();
		this.#container.remove();
		this.#icon = null;
		this.#container = null;
	}
}

/**
 * Creates a icon element for a sidebar app.
 * @param {object} param0
 * @param {string} param0.icon
 * @param {string} param0.id
 * @returns {HTMLElement}
 */
function Icon({ icon, id, title }) {
	const className = `icon ${icon}`;
	return (
		<span
			data-action="sidebar-app"
			data-id={id}
			title={title}
			className={className}
		/>
	);
}

/**
 * Gets the container or sets it if it's not set.
 * @param {HTMLElement} $el
 * @returns {HTMLElement}
 */
function getContainer($el) {
	const res = $contaienr;

	if ($el) {
		$contaienr = $el;
	}

	return res || $sidebar.get(".container");
}
