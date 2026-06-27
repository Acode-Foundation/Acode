import { animate, press } from "motion";
import tile from "../tile";

export default class WCPage extends HTMLElement {
	#leadBtn;
	#header;
	#on = {
		hide: [],
		show: [],
		willconnect: [],
		willdisconnect: [],
	};
	#append;
	handler;
	onhide;
	onconnect;
	ondisconnect;
	onwillconnect;
	onwilldisconnect;

	constructor() {
		super();
		const title = this.getAttribute("data-title");

		this.handler = new PageHandler(this);
		this.#append = super.append.bind(this);
		this.append = this.appendBody.bind(this);
		this.hide = this.hide.bind(this);
		this.settitle = this.settitle.bind(this);
		this.on = this.on.bind(this);
		this.off = this.off.bind(this);

		this.handler.onReplace = () => {
			if (typeof this.onwilldisconnect === "function") {
				this.onwilldisconnect();
			}

			this.#on.willdisconnect.forEach((cb) => cb.call(this));
		};

		this.handler.onRestore = () => {
			if (typeof this.onwillconnect === "function") {
				this.onwillconnect();
			}

			this.#on.willconnect.forEach((cb) => cb.call(this));
		};

		this.#leadBtn = (
			<span
				className="icon arrow_back"
				onclick={() => this.hide.call(this)}
				attr-action="go-back"
			></span>
		);

		press(this.#leadBtn, (element) => {
			animate(
				element,
				{ scale: 0.85 },
				{ type: "spring", stiffness: 400, damping: 20 },
			);
			return () => {
				animate(
					element,
					{ scale: 1 },
					{ type: "spring", stiffness: 400, damping: 20 },
				);
			};
		});

		this.#header = tile({
			type: "header",
			text: title || "Page",
			lead: this.#leadBtn,
		});
	}

	appendBody(...$els) {
		let $main = this.body;
		if (!$main) return;
		for (const $el of $els) {
			$main.append($el);
		}
	}

	appendOuter(...$els) {
		this.#append(...$els);
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (name === "data-title") {
			this.settitle = newValue;
		}
	}

	connectedCallback() {
		this.classList.remove("hide");
		const isPrimary = this.classList.contains("primary");
		const isNoTransition = this.classList.contains("no-transition");

		if (!isPrimary) {
			this.style.opacity = "0";
			animate(
				this,
				{
					opacity: 1,
				},
				{
					duration: isNoTransition ? 0.08 : 0.14,
					ease: "easeOut",
				},
			).then(() => {
				this.style.opacity = "";
			});
		}

		if (typeof this.onconnect === "function") this.onconnect();
		this.#on.show.forEach((cb) => cb.call(this));
	}

	disconnectedCallback() {
		if (typeof this.ondisconnect === "function") this.ondisconnect();
		this.#on.hide.forEach((cb) => cb.call(this));
	}

	/**
	 * Adds event listener to the page
	 * @param {'hide' | 'show'} event
	 * @param {function(this: WCPage):void} cb
	 */
	on(event, cb) {
		if (event in this.#on) {
			this.#on[event].push(cb);
		}
	}

	/**
	 * Removes event listener from the page
	 * @param {'hide' | 'show'} event
	 * @param {function(this: WCPage):void} cb
	 */
	off(event, cb) {
		if (event in this.#on) {
			this.#on[event] = this.#on[event].filter((fn) => fn !== cb);
		}
	}

	/**
	 * Sets the title of the page
	 * @param {string} title
	 */
	settitle(title) {
		this.header.text = title;
	}

	hide() {
		if (typeof this.onhide === "function") this.onhide();

		const isPrimary = this.classList.contains("primary");
		const isNoTransition = this.classList.contains("no-transition");

		if (isPrimary) {
			this.remove();
			this.handler.remove();
		} else {
			animate(
				this,
				{
					opacity: 0,
				},
				{
					duration: isNoTransition ? 0.08 : 0.12,
					ease: "easeIn",
				},
			).then(() => {
				this.remove();
				this.handler.remove();
			});
		}
	}

	get body() {
		return this.get(".main") || this.get("main");
	}

	set body($el) {
		if (this.body) this.replaceChild($el, this.body);

		const headerAdjacent = this.header.nextElementSibling;
		if (headerAdjacent) {
			this.insertBefore($el, headerAdjacent);
			return;
		}

		this.appendChild($el);
	}

	get innerHTML() {
		return this.body?.innerHTML;
	}

	set innerHTML(html) {
		if (this.body) this.body.innerHTML = html;
	}

	get textContent() {
		return this.body?.textContent;
	}

	set textContent(text) {
		if (this.body) this.body.textContent = text;
	}

	get lead() {
		return this.#leadBtn;
	}

	set lead($el) {
		this.header.replaceChild($el, this.#leadBtn);
		this.#leadBtn = $el;
	}

	get header() {
		return this.#header;
	}

	set header($el) {
		this.#header.replaceChild($el, this.#header);
		this.#header = $el;
	}

	initializeIfNotAlreadyInitialized() {
		if (!this.#header.isConnected) {
			this.#addHeaderOrAssignHeader();
		}
	}

	#addHeaderOrAssignHeader() {
		if (!this.classList.contains("primary")) {
			this.#append(this.#header);
			this.#append(<div className="main"></div>);
		} else {
			this.#header = this.get("header");
			if (this.#header) {
				this.#leadBtn = this.#header.firstChild;
			}
		}
	}
}

class PageHandler {
	$el;
	$replacement;
	scrollLeft = 0;
	scrollTop = 0;
	onRestore;
	onReplace;

	/**
	 *
	 * @param {HTMLElement} $el
	 */
	constructor($el) {
		this.$el = $el;

		this.onhide = this.onhide.bind(this);
		this.onshow = this.onshow.bind(this);

		this.$replacement = <span className="page-replacement"></span>;
		this.$replacement.handler = this;

		this.$el.on("hide", this.onhide);
		this.$el.on("show", this.onshow);

		// Cache scroll position on scroll event to prevent synchronous layout reading (forced reflow) during page transitions
		this.$el.addEventListener(
			"scroll",
			(e) => {
				const $body = this.$el.body;
				if ($body && e.target === $body) {
					this.scrollLeft = $body.scrollLeft;
					this.scrollTop = $body.scrollTop;
				}
			},
			{ capture: true, passive: true },
		);
	}

	/**
	 * Replace current element with a replacement element
	 */
	replaceEl() {
		this.$el.off("hide", this.onhide);
		if (!this.$el.isConnected || this.$replacement.isConnected) return;
		if (typeof this.onReplace === "function") this.onReplace();
		this.$el.parentElement.replaceChild(this.$replacement, this.$el);
		this.$el.classList.add("no-transition");
	}

	/**
	 * Restore current element from a replacement element
	 */
	restoreEl() {
		if (this.$el.isConnected || !this.$replacement.isConnected) return;
		if (typeof this.onRestore === "function") this.onRestore();
		this.$el.off("hide", this.onhide);
		this.$replacement.parentElement.replaceChild(this.$el, this.$replacement);
		const { scrollLeft, scrollTop } = this;
		requestAnimationFrame(() => {
			const $body = this.$el.body;
			if ($body) {
				$body.scrollLeft = scrollLeft;
				$body.scrollTop = scrollTop;
			}
		});
		this.$el.on("hide", this.onhide);
	}

	onhide() {
		this.$el.off("hide", this.onhide);
		handlePagesForSmoothExperienceBack();
	}

	onshow() {
		this.$el.off("show", this.onshow);
		handlePagesForSmoothExperience();
	}

	remove() {
		this.$replacement.remove();
	}
}

/**
 * Remove invisible pages from DOM and add them to the stack
 */
function handlePagesForSmoothExperience() {
	const $pages = [...tag.getAll("wc-page")];
	for (let $page of $pages.slice(0, -1)) {
		$page.handler.replaceEl();
	}
}

function handlePagesForSmoothExperienceBack() {
	[...tag.getAll(".page-replacement")].pop()?.handler.restoreEl();
}
