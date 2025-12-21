import "./style.scss";
import Page from "components/page";
import items, { description } from "components/quickTools/items";
import actionStack from "lib/actionStack";
import settings from "lib/settings";
import helpers from "utils/helpers";

export default function QuickTools() {
	const $page = Page(strings["shortcut buttons"]);
	$page.id = "quicktools-settings-page";
	$page.style.overflow = "hidden";
	$page.style.display = "flex";
	$page.style.flexDirection = "column";

	const manager = new QuickToolsManager();
	$page.body = manager.getContainer();

	const onShow = $page.onshow;
	$page.onshow = function () {
		if (onShow) onShow.call(this);
		const scrollContainer = $page.get(".scroll-container") || $page;
		scrollContainer.style.overflow = "hidden";
		manager.getContainer().style.height = "100%";
	};

	actionStack.push({
		id: "quicktools-settings",
		action: $page.hide,
	});

	$page.onhide = () => {
		actionStack.remove("quicktools-settings");
		helpers.hideAd();
		// Cleanup manager
		manager.destroy();
	};

	app.append($page);
	helpers.showAd();
}

class QuickToolsManager {
	constructor() {
		this.container = <div id="quicktools-settings"></div>;
		this.render();
		this.bindEvents();

		this.longPressTimer = null;
		this.dragState = null;
	}

	getContainer() {
		return this.container;
	}

	render() {
		this.destroy(); // Cleanup potential drag states before re-rendering
		this.container.textContent = "";

		// --- Active Tools Section ---
		const activeSection = <div className="section active-tools"></div>;
		activeSection.appendChild(
			<div className="section-title">{strings["active tools"]}</div>,
		);

		const activeGrid = <div className="quicktools-grid active-grid"></div>;

		const totalSlots =
			settings.QUICKTOOLS_ROWS *
			settings.QUICKTOOLS_GROUPS *
			settings.QUICKTOOLS_GROUP_CAPACITY;

		for (let i = 0; i < totalSlots; i++) {
			const itemIndex = settings.value.quicktoolsItems[i];
			const itemDef = items[itemIndex];
			const el = this.createItemElement(itemDef, i, "active");
			activeGrid.appendChild(el);
		}

		activeSection.appendChild(activeGrid);
		this.container.appendChild(activeSection);

		// --- Available Tools Section ---
		const availableSection = <div className="section available-tools"></div>;
		availableSection.appendChild(
			<div className="section-title">{strings["available tools"]}</div>,
		);

		// Group items
		const categories = {
			Modifiers: ["ctrl", "shift", "alt", "meta"],
			Commands: ["command", "undo", "redo", "save", "search"],
			Navigation: ["key"],
			Symbols: ["insert"],
			Other: [],
		};

		const groupedItems = {};
		items.forEach((item, index) => {
			let category = "Other";
			for (const [cat, actions] of Object.entries(categories)) {
				if (actions.includes(item.action)) {
					category = cat;
					break;
				}
			}
			if (!groupedItems[category]) groupedItems[category] = [];
			groupedItems[category].push({ item, index });
		});

		Object.entries(groupedItems).forEach(([category, list]) => {
			const catHeader = <div className="category-header">{category}</div>;
			const catGrid = <div className="quicktools-grid source-grid"></div>;

			list.forEach(({ item, index }) => {
				const el = this.createItemElement(item, index, "source");
				catGrid.appendChild(el);
			});

			availableSection.appendChild(catHeader);
			availableSection.appendChild(catGrid);
		});

		this.container.appendChild(availableSection);
	}

	createItemElement(itemDef, index, type) {
		if (!itemDef)
			return (
				<div
					className="tool-item empty"
					data-index={index}
					data-type={type}
				></div>
			);

		const hasIcon = itemDef.icon && itemDef.icon !== "letters";
		// If it's not an icon, we assume it relies on 'letters'
		// Some items might have both, but 'letters' mode implies text rendering

		const el = (
			<div
				className={`tool-item ${hasIcon ? "has-icon" : "has-letters"}`}
				data-index={index} // active: slot index, source: item index
				data-type={type}
				data-letters={itemDef.letters || ""}
			>
				{hasIcon ? <span className={`icon ${itemDef.icon}`}></span> : null}
			</div>
		);
		return el;
	}

	bindEvents() {
		const c = this.container;
		c.addEventListener("touchstart", this.handleTouchStart.bind(this), {
			passive: false,
		});
		c.addEventListener("touchmove", this.handleTouchMove.bind(this), {
			passive: false,
		});
		c.addEventListener("touchend", this.handleTouchEnd.bind(this));
		c.addEventListener("contextmenu", (e) => e.preventDefault());

		c.addEventListener("mousedown", this.handleMouseDown.bind(this));
	}

	// --- Touch Handlers ---

	handleTouchStart(e) {
		// If already dragging or pending, ignore new touches (prevent multi-touch mess)
		if (this.dragState || this.longPressTimer) return;

		const target = e.target.closest(".tool-item");
		if (!target) return;

		this.longPressTimer = setTimeout(() => {
			this.startDrag(target, e.touches[0]);
		}, 300);

		this.touchStartX = e.touches[0].clientX;
		this.touchStartY = e.touches[0].clientY;
		this.potentialTarget = target;
	}

	handleTouchMove(e) {
		const touch = e.touches[0];
		if (this.dragState) {
			e.preventDefault();
			this.updateDrag(touch);
			return;
		}

		if (
			Math.hypot(
				touch.clientX - this.touchStartX,
				touch.clientY - this.touchStartY,
			) > 10
		) {
			clearTimeout(this.longPressTimer);
			this.longPressTimer = null;
			this.potentialTarget = null;
		}
	}

	handleTouchEnd(e) {
		clearTimeout(this.longPressTimer);

		if (this.dragState) {
			this.endDrag();
		} else if (this.potentialTarget) {
			// It was a tap
			if (e.cancelable) e.preventDefault();
			this.handleClick(this.potentialTarget);
		}

		this.potentialTarget = null;
	}

	// --- Mouse Handlers ---

	handleMouseDown(e) {
		const target = e.target.closest(".tool-item");
		if (!target) return;

		this.mouseDownInfo = {
			target,
			x: e.clientX,
			y: e.clientY,
			isDrag: false,
		};

		const moveHandler = (ev) => {
			if (!this.mouseDownInfo.isDrag) {
				if (
					Math.hypot(
						ev.clientX - this.mouseDownInfo.x,
						ev.clientY - this.mouseDownInfo.y,
					) > 5
				) {
					this.mouseDownInfo.isDrag = true;
					this.startDrag(target, this.mouseDownInfo);
				}
			}
			if (this.dragState) {
				this.updateDrag(ev);
			}
		};

		const upHandler = () => {
			document.removeEventListener("mousemove", moveHandler);
			document.removeEventListener("mouseup", upHandler);

			if (this.dragState) {
				this.endDrag();
			} else {
				this.handleClick(target);
			}
		};

		document.addEventListener("mousemove", moveHandler);
		document.addEventListener("mouseup", upHandler);
	}

	// --- Core Drag Logic ---

	startDrag(el, pointer) {
		// Double check state
		if (this.dragState) {
			this.destroy();
			return;
		}

		if (navigator.vibrate) navigator.vibrate(30);

		const rect = el.getBoundingClientRect();
		const ghost = el.cloneNode(true);
		ghost.classList.add("tool-ghost");
		ghost.style.width = rect.width + "px";
		ghost.style.height = rect.height + "px";

		document.body.appendChild(ghost);
		el.classList.add("dragging");

		const type = el.dataset.type;
		const index = Number.parseInt(el.dataset.index, 10);

		this.dragState = {
			el,
			type, // 'active' or 'source'
			index, // slot index (active) or item ID (source)
			ghost,
			offsetX: pointer.clientX - rect.left - rect.width / 2,
			offsetY: pointer.clientY - rect.top - rect.height / 2,
		};

		this.updateDrag(pointer);
	}

	updateDrag(pointer) {
		const { ghost } = this.dragState;
		ghost.style.left = pointer.clientX + "px";
		ghost.style.top = pointer.clientY + "px";

		const elementBelow = document.elementFromPoint(
			pointer.clientX,
			pointer.clientY,
		);

		this.cleanupHighlight();

		const targetItem = elementBelow?.closest(".tool-item");
		if (targetItem && targetItem.dataset.type === "active") {
			targetItem.classList.add("highlight-target");
			this.dragState.dropTarget = targetItem;
		} else {
			this.dragState.dropTarget = null;
		}
	}

	cleanupHighlight() {
		const highlighted = this.container.querySelectorAll(".highlight-target");
		highlighted.forEach((el) => el.classList.remove("highlight-target"));
	}

	endDrag() {
		const { el, ghost, dropTarget, type, index } = this.dragState;

		this.cleanupHighlight();
		el.classList.remove("dragging");
		ghost.remove();
		this.dragState = null;

		if (dropTarget) {
			const targetIndex = Number.parseInt(dropTarget.dataset.index, 10);

			if (type === "active") {
				// Swap within active
				if (targetIndex !== index) {
					this.swapItems(index, targetIndex);
				}
			} else if (type === "source") {
				// Replace active slot with source item
				this.replaceItem(targetIndex, index);
			}
		}
	}

	swapItems(srcIndex, destIndex) {
		const temp = settings.value.quicktoolsItems[srcIndex];
		settings.value.quicktoolsItems[srcIndex] =
			settings.value.quicktoolsItems[destIndex];
		settings.value.quicktoolsItems[destIndex] = temp;

		settings.update();
		this.render(); // Re-render to reflect changes
	}

	replaceItem(slotIndex, newItemId) {
		settings.value.quicktoolsItems[slotIndex] = newItemId;
		settings.update();
		this.render();
	}

	async handleClick(el) {
		const type = el.dataset.type;
		const index = Number.parseInt(el.dataset.index, 10);

		let itemDef;
		if (type === "active") {
			const itemIndex = settings.value.quicktoolsItems[index];
			itemDef = items[itemIndex];
		} else {
			itemDef = items[index];
		}

		if (itemDef) {
			const desc = description(itemDef.id);
			window.toast(desc, 2000);
		}
	}

	destroy() {
		if (this.longPressTimer) clearTimeout(this.longPressTimer);
		this.longPressTimer = null;

		if (this.dragState) {
			if (this.dragState.ghost) {
				this.dragState.ghost.remove();
			}
			if (this.dragState.el) {
				this.dragState.el.classList.remove("dragging");
			}
		}

		this.cleanupHighlight();
		this.dragState = null;
		this.potentialTarget = null;
	}
}
