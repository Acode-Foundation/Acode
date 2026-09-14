// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { installIconTooltips } from "../../src/components/tooltip/longPress";
let controller;
afterEach(() => {
	controller?.dispose();
	vi.useRealTimers();
	document.body.replaceChildren();
});
function fixture() {
	vi.useFakeTimers();
	const owner = document.createElement("div");
	document.body.append(owner);
	const root = owner.attachShadow({ mode: "open" });
	root.innerHTML = '<button data-label="Format"><svg></svg></button>';
	const button = root.querySelector("button"),
		icon = root.querySelector("svg");
	const show = vi.fn(),
		hide = vi.fn();
	controller = installIconTooltips(document, show, hide);
	const send = (name, options = {}) =>
		icon.dispatchEvent(
			new PointerEvent(name, {
				bubbles: true,
				composed: true,
				cancelable: true,
				pointerId: 1,
				pointerType: "touch",
				button: 0,
				clientX: 20,
				clientY: 20,
				...options,
			}),
		);
	return { root, owner, button, icon, show, hide, send };
}

function click(target, detail = 1) {
	const event = new MouseEvent("click", {
		bubbles: true,
		composed: true,
		cancelable: true,
		detail,
	});
	target.dispatchEvent(event);
	return event;
}

it.each([
	["plain content", false],
	["plain content", true],
	["unlabeled control", false],
	["unlabeled control", true],
	["quicktools", false],
	["quicktools", true],
])("passes ordinary clicks on %s (Shadow DOM: %s) without browser errors", (kind, shadow) => {
	const f = fixture();
	const container = document.createElement("div");
	container.innerHTML =
		kind === "plain content"
			? "<div>Content</div>"
			: "<button><svg></svg></button>";
	if (kind === "quicktools") {
		container.id = "quick-tools";
		container.firstChild.setAttribute("aria-label", "Quicktool");
	}
	(shadow ? f.root : document.body).append(container);
	const target = container.querySelector("svg") || container.firstChild;
	const activated = vi.fn();
	container.firstChild.addEventListener("click", activated);
	const errors = vi.fn((event) => event.preventDefault());
	window.addEventListener("error", errors);
	try {
		for (const type of ["pointerdown", "pointerup"]) {
			target.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					composed: true,
					pointerId: 1,
					button: 0,
				}),
			);
		}
		expect(click(target).defaultPrevented).toBe(false);
		expect(activated).toHaveBeenCalledOnce();
		expect(errors).not.toHaveBeenCalled();
		expect(f.show).not.toHaveBeenCalled();
	} finally {
		window.removeEventListener("error", errors);
	}
});

it.each([
	"expired",
	"keyboard",
	"programmatic",
	"different target",
])("allows %s clicks after a long press and clears suppression", async (kind) => {
	const f = fixture(),
		activated = vi.fn();
	f.button.addEventListener("click", activated);
	f.send("pointerdown");
	await vi.advanceTimersByTimeAsync(500);
	f.send("pointerup");
	if (kind === "expired") await vi.advanceTimersByTimeAsync(750);
	if (kind === "programmatic") f.button.click();
	else if (kind === "different target") {
		const other = document.createElement("button");
		document.body.append(other);
		other.addEventListener("click", activated);
		expect(click(other).defaultPrevented).toBe(false);
	} else {
		expect(click(f.icon, kind === "keyboard" ? 0 : 1).defaultPrevented).toBe(
			false,
		);
	}
	expect(activated).toHaveBeenCalledOnce();
	expect(click(f.icon).defaultPrevented).toBe(false);
	expect(activated).toHaveBeenCalledTimes(2);
});

it("reads metadata through Shadow DOM and consumes the release click without activating the icon", async () => {
	const f = fixture(),
		clicked = vi.fn();
	f.button.onclick = clicked;
	f.button.dataset.description = "<b>Existing description</b>";
	f.send("pointerdown");
	await vi.advanceTimersByTimeAsync(499);
	expect(f.show).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(f.show).toHaveBeenCalledWith(
		f.button,
		"Format",
		"<b>Existing description</b>",
	);
	f.send("pointerup");
	expect(click(f.icon).defaultPrevented).toBe(true);
	expect(clicked).not.toHaveBeenCalled();
	f.send("pointerdown");
	f.send("pointerup");
	expect(click(f.icon).defaultPrevented).toBe(false);
	expect(clicked).toHaveBeenCalledOnce();
});
it("cancels scrolling, movement, extra touches and removal; leaves stock quicktools alone", async () => {
	const f = fixture();
	for (const cancel of [
		() => f.send("pointermove", { clientX: 40 }),
		() => document.dispatchEvent(new Event("scroll")),
		() => f.root.dispatchEvent(new Event("scroll")),
		() => f.send("pointercancel"),
	]) {
		f.send("pointerdown");
		cancel();
		f.send("pointerup");
		await vi.advanceTimersByTimeAsync(600);
	}
	expect(f.show).not.toHaveBeenCalled();
	f.send("pointerdown");
	f.send("pointerdown", { pointerId: 2 });
	await vi.advanceTimersByTimeAsync(600);
	expect(f.show).not.toHaveBeenCalled();
	f.send("pointerup", { pointerId: 2 });
	f.send("pointerup");
	f.send("pointerdown");
	await vi.advanceTimersByTimeAsync(500);
	expect(f.show).toHaveBeenCalledWith(f.button, "Format", undefined);
	f.hide.mockClear();
	f.owner.remove();
	await vi.advanceTimersByTimeAsync(0);
	expect(f.hide).toHaveBeenCalled();
	document.body.append(f.owner);
	f.owner.id = "quick-tools";
	f.send("pointerup");
	f.show.mockClear();
	f.send("pointerdown");
	await vi.advanceTimersByTimeAsync(600);
	expect(f.show).not.toHaveBeenCalled();
});
it("uses existing global labels in precedence order and lets an existing context menu win", async () => {
	const f = fixture();
	f.button.setAttribute("aria-label", "Accessible label");
	f.button.title = "Title label";
	for (const [remove, label] of [
		[null, "Format"],
		["data-label", "Accessible label"],
		["aria-label", "Title label"],
	]) {
		if (remove) f.button.removeAttribute(remove);
		f.send("pointerdown");
		await vi.advanceTimersByTimeAsync(500);
		expect(f.show).toHaveBeenLastCalledWith(f.button, label, undefined);
		f.send("pointerup");
	}
	f.button.addEventListener("contextmenu", (event) => event.preventDefault());
	f.send("pointerdown");
	f.hide.mockClear();
	f.icon.dispatchEvent(
		new Event("contextmenu", {
			bubbles: true,
			composed: true,
			cancelable: true,
		}),
	);
	await vi.advanceTimersByTimeAsync(600);
	expect(f.hide).toHaveBeenCalled();
	f.send("pointerup");
	f.button.removeAttribute("title");
	f.show.mockClear();
	f.send("pointerdown");
	await vi.advanceTimersByTimeAsync(600);
	expect(f.show).not.toHaveBeenCalled();
});
