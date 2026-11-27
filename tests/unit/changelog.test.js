// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import vm from "node:vm";
import DOMPurify from "dompurify";
import markdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import { expect, it } from "vitest";

it("renders device wording while preserving links and code", () => {
	const element = render(
		[
			"Fix Android device crashes and ANDROID phone layouts. [Android guide](https://example.com/android)",
			"https://developer.android.com/guide and android@example.com",
			"Android 15, Android Studio, Android SDK, and Android support.",
			"`android.permission.INTERNET` and `<Android device>`",
			"<code>Android device: android.intent.action</code>",
			"<pre>Android device</pre>",
			"<strong>Android tablet support</strong>",
			"Thanks @contributor and @another-author for #123.",
			"https://twitter.com/@foo/status/1",
			"[Profile](https://twitter.com/@foo/status/1)",
			"https://example.com/?user=@foo",
			'<a href="https://example.com/@foo">@foo profile</a>',
			"`@codeuser` and <code>@rawcode</code>",
			"```text\n@fencedcode\n```",
		].join("\n\n"),
	);
	expect(element.textContent).toContain(
		"Fix mobile device crashes and mobile phone layouts.",
	);
	expect(element.querySelector("a").textContent).toBe("Android guide");
	expect(element.querySelector("a").href).toBe("https://example.com/android");
	for (const label of [
		"https://developer.android.com/guide",
		"android@example.com",
	]) {
		const link = [...element.querySelectorAll("a")].find(
			(item) => item.textContent === label,
		);
		expect(link?.getAttribute("href")).toBe(
			label.includes("@") ? `mailto:${label}` : label,
		);
	}
	expect(element.textContent).toContain(
		"Android 15, Android Studio, Android SDK, and Android support.",
	);
	expect(
		[...element.querySelectorAll("code")].map((item) => item.textContent),
	).toEqual([
		"android.permission.INTERNET",
		"<Android device>",
		"Android device: android.intent.action",
		"@codeuser",
		"@rawcode",
		"@fencedcode\n",
	]);
	expect(element.querySelector("pre").textContent).toBe("Android device");
	expect(element.querySelector("strong").textContent).toBe(
		"mobile tablet support",
	);
	expect(
		element.querySelector('a[href="https://github.com/contributor"]'),
	).not.toBeNull();
	expect(
		element.querySelector(
			'a[href="https://github.com/Acode-Foundation/Acode/pull/123"]',
		),
	).not.toBeNull();
	for (const href of [
		"https://twitter.com/@foo/status/1",
		"https://example.com/?user=@foo",
		"https://example.com/@foo",
	]) {
		expect(element.querySelector(`a[href="${href}"]`)).not.toBeNull();
	}
	expect(
		element.querySelectorAll('a[href="https://twitter.com/@foo/status/1"]'),
	).toHaveLength(2);
	expect(
		element.querySelector('a[href="https://github.com/another-author"]')
			?.textContent,
	).toBe("@another-author");
	expect(
		element.querySelector(
			'a[href="https://github.com/foo"], code a, pre a, a a',
		),
	).toBeNull();
});

it("links prose PR references without rewriting code or URL destinations", () => {
	const repo = "https://github.com/Acode-Foundation/Acode";
	const element = render(
		[
			"Fix #123 and (#456).",
			"`#123` and <code>#456</code>",
			"```text\n#789\n```",
			"https://example.com/#123",
			"[Fragment](https://example.com/#456)",
			`${repo}/pull/123`,
			`[Custom title](${repo}/pull/456)`,
			`${repo}/pull/123/files`,
			`${repo}/pull/123?diff=split#discussion`,
			`\`${repo}/pull/123\``,
		].join("\n\n"),
	);
	expect(
		[...element.querySelectorAll("code")].map((node) => node.textContent),
	).toEqual(["#123", "#456", "#789\n", `${repo}/pull/123`]);
	const links = [...element.querySelectorAll("a")].map((node) => [
		node.textContent,
		node.getAttribute("href"),
	]);
	expect(links).toEqual([
		["#123", `${repo}/pull/123`],
		["#456", `${repo}/pull/456`],
		["https://example.com/#123", "https://example.com/#123"],
		["Fragment", "https://example.com/#456"],
		["#123", `${repo}/pull/123`],
		["Custom title", `${repo}/pull/456`],
		[`${repo}/pull/123/files`, `${repo}/pull/123/files`],
		[
			`${repo}/pull/123?diff=split#discussion`,
			`${repo}/pull/123?diff=split#discussion`,
		],
	]);
});

it("links complete author mentions without treating invalid tokens as profiles", () => {
	const longest = "a".repeat(39);
	const text =
		`Thanks @contributor. (@another-author), @${longest}! ` +
		`contact @example.com @foo.bar @- @foo_bar @user- @foo--bar @${longest}a @foo/bar @@foo #123abc`;
	const element = render(text);
	expect(element.textContent.trim()).toBe(text);
	expect(
		[...element.querySelectorAll("a")].map((node) => node.getAttribute("href")),
	).toEqual([
		"https://github.com/contributor",
		"https://github.com/another-author",
		`https://github.com/${longest}`,
	]);
});

function render(text) {
	const source = readFileSync("src/pages/changelog/changelog.js", "utf8");
	const start = source.indexOf("function renderChangelog(");
	const end = source.indexOf("function updateVersionSelector(", start);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	const renderSource = source.slice(start, end);
	const element = document.createElement("div");
	const body = { el: element };
	const render = vm.runInNewContext(`(${renderSource.trim()})`, {
		body,
		document,
		NodeFilter,
		DOMPurify,
		markdownIt,
		markdownItFootnote,
		markdownItTaskLists,
	});
	render(text);
	return element;
}
