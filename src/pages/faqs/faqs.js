import "./faqs.scss";
import Page from "components/page";
import searchBar from "components/searchbar";
import DOMPurify from "dompurify";
import defaultStrings from "lang/en-us.json";
import actionStack from "lib/actionStack";
import config from "lib/config";
import platform from "lib/platform";
import markdownIt from "markdown-it";

export default function FAQs() {
	const faqPlatform = platform.isIOS ? "ios" : "android";
	const cacheKey = `faqs:${config.API_BASE}:${faqPlatform}`;
	const markdown = markdownIt({ linkify: true });
	const search = (
		<button
			type="button"
			className="icon search"
			attr-action="search"
			aria-label={strings.search}
			onclick={showSearch}
			disabled
		/>
	);
	const page = Page(strings.faqs, { tail: search });
	page.classList.add("faqs-page");
	const status = <p role="status" />;
	const retry = (
		<button type="button" className="button faq-retry" onclick={load} hidden>
			{strings.retry || defaultStrings.retry}
		</button>
	);
	const state = (
		<div className="faq-state">
			<span className="icon help" aria-hidden="true" />
			{status}
			{retry}
		</div>
	);
	const list = <div className="faq-list" />;
	let faqs = [];
	let controller;
	let closed = false;
	let hideSearchBar;

	page.body = (
		<main id="faqs-page" className="main scroll">
			{state}
			{list}
		</main>
	);
	page.onhide = cleanup;
	page.ondisconnect = () => hideSearchBar?.();
	actionStack.push({ id: "faqs", action: page.hide });
	app.append(page);
	void load();
	return page;

	function cleanup() {
		if (closed) return;
		closed = true;
		hideSearchBar?.();
		controller?.abort();
		actionStack.remove("faqs");
	}

	async function load() {
		if (closed) return;
		const request = new AbortController();
		controller = request;
		const timeout = setTimeout(() => request.abort(), 15000);
		retry.hidden = true;
		status.textContent = strings["loading..."];
		try {
			const response = await fetch(
				`${config.API_BASE}/faqs?platform=${faqPlatform}`,
				{
					signal: request.signal,
					cache: "no-store",
				},
			);
			if (!response.ok)
				throw new Error(`FAQ request failed: ${response.status}`);
			const data = await response.json();
			if (!isValid(data)) throw new Error("Invalid FAQ response");
			if (closed) return;
			try {
				localStorage.setItem(cacheKey, JSON.stringify(data));
			} catch (error) {
				console.warn("Unable to cache FAQs", error);
			}
			render(data);
		} catch (error) {
			if (closed) return;
			const cached = readCache();
			if (cached?.length) {
				render(cached);
				return;
			}
			console.error("Unable to load FAQs", error);
			status.textContent =
				strings["faqs load failed"] || defaultStrings["faqs load failed"];
			retry.hidden = false;
		} finally {
			clearTimeout(timeout);
		}
	}

	function render(data) {
		faqs = data.map((faq) => ({ ...faq, element: renderFAQ(faq) }));
		search.disabled = !faqs.length;
		state.hidden = !!faqs.length;
		status.textContent = faqs.length
			? ""
			: strings["faqs empty"] || defaultStrings["faqs empty"];
		list.replaceChildren(...(faqs.length ? results(faqs) : []));
	}

	function readCache() {
		try {
			const data = JSON.parse(localStorage.getItem(cacheKey));
			if (isValid(data)) return data;
		} catch (error) {
			console.warn("Unable to read cached FAQs", error);
		}
	}

	function isValid(data) {
		return (
			Array.isArray(data) &&
			data.every(
				(faq) => typeof faq?.q === "string" && typeof faq?.a === "string",
			)
		);
	}

	function showSearch() {
		if (hideSearchBar || search.disabled) return;
		searchBar(
			list,
			(hide) => {
				hideSearchBar = hide;
			},
			() => {
				hideSearchBar = null;
			},
			(value) => {
				const query = value.trim().toLowerCase();
				page.body.scrollTop = 0;
				return results(
					faqs.filter((faq) =>
						`${faq.q}\n${faq.a}`.toLowerCase().includes(query),
					),
				);
			},
			false,
		);
	}

	function results(matches) {
		if (!matches.length)
			return [
				<div className="faq-state">
					<span className="icon search" aria-hidden="true" />
					<p role="status">{strings["no result"]}</p>
				</div>,
			];
		const key =
			matches.length === 1
				? "search result label singular"
				: "search result label plural";
		const label = strings[key] || defaultStrings[key];
		return [
			<div className="faq-count" role="status">
				{`${matches.length} ${label}`}
			</div>,
			...matches.map((faq) => faq.element),
		];
	}

	function renderFAQ(faq) {
		const answer = <div className="md faq-answer" />;
		const details = (
			<details>
				<summary>
					<span>{faq.q}</span>
					<span className="icon keyboard_arrow_down" aria-hidden="true" />
				</summary>
				{answer}
			</details>
		);
		details.ontoggle = () => {
			if (!details.open || answer.childNodes.length) return;
			answer.innerHTML = DOMPurify.sanitize(markdown.render(faq.a));
			for (const link of answer.querySelectorAll("a[href]")) {
				try {
					link.href = new URL(link.getAttribute("href"), config.BASE_URL).href;
				} catch {
					link.removeAttribute("href");
				}
			}
		};
		return details;
	}
}
