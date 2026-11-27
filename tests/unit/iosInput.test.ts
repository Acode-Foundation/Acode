// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import setInputType from "../../src/platforms/ios/input";
import proxy from "../../src/platforms/ios/proxy";

afterEach(() => {
	setInputType("NORMAL");
	document.body.replaceChildren();
});

test("disables suggestions without changing input types, autofill or selection, then restores field defaults", () => {
	document.body.innerHTML =
		'<input type="email" autocomplete="email" autocorrect="on"><textarea spellcheck="false">code</textarea><div contenteditable="true" autocorrect="off">editor</div>';
	const input = document.querySelector("input")!;
	const area = document.querySelector("textarea")!;
	area.focus();
	area.setSelectionRange(1, 3);
	setInputType("NO_SUGGESTIONS_AGGRESSIVE");
	expect(input.getAttribute("autocorrect")).toBe("off");
	expect(input.getAttribute("writingsuggestions")).toBe("false");
	expect(input.type).toBe("email");
	expect(input.autocomplete).toBe("email");
	expect(document.activeElement).toBe(area);
	expect([area.selectionStart, area.selectionEnd, area.value]).toEqual([
		1,
		3,
		"code",
	]);
	setInputType("NO_SUGGESTIONS");
	setInputType("NORMAL");
	expect(input.getAttribute("autocorrect")).toBe("on");
	expect(input.hasAttribute("writingsuggestions")).toBe(false);
	expect(area.getAttribute("spellcheck")).toBe("false");
	expect(document.querySelector("div")!.getAttribute("autocorrect")).toBe(
		"off",
	);
});

test("handles dynamic plugin fields, author attribute updates, removal and repeated mode changes", async () => {
	setInputType("NO_SUGGESTIONS");
	const field = document.createElement("textarea");
	document.body.append(field);
	await vi.waitFor(() => expect(field.getAttribute("autocorrect")).toBe("off"));
	field.setAttribute("autocorrect", "on");
	await vi.waitFor(() => expect(field.getAttribute("autocorrect")).toBe("off"));
	field.remove();
	await vi.waitFor(() => expect(field.getAttribute("autocorrect")).toBe("on"));
	expect(field.hasAttribute("writingsuggestions")).toBe(false);
	document.body.append(field);
	field.focus();
	expect(field.getAttribute("autocorrect")).toBe("off");
	setInputType("NORMAL");
	expect(field.getAttribute("autocorrect")).toBe("on");
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(field.getAttribute("autocorrect")).toBe("on");
});

test("both existing bridge entry points share the same suggestion policy", () => {
	document.body.innerHTML = "<input>";
	const input = document.querySelector("input")!;
	const success = vi.fn();
	proxy.System["set-input-type"](success, null, ["NO_SUGGESTIONS"]);
	expect(input.getAttribute("spellcheck")).toBe("false");
	proxy.Native.setKeyboardSuggestionsEnabled(success, null, [true]);
	expect(input.hasAttribute("spellcheck")).toBe(false);
	expect(success).toHaveBeenLastCalledWith(1);
});
