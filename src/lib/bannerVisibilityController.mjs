/**
 * Keeps banner intent separate from transient native visibility.
 *
 * Pages register once when they request a banner. The active top page, keyboard
 * state, and forced suspension then determine whether the native banner should
 * be visible.
 */
export class BannerVisibilityController {
	#banner = null;
	#registeredPages = new WeakSet();
	#getActivePage;
	#observePageChanges;
	#stopObserving = null;
	#keyboardVisible = false;
	#suspended = false;
	#nativeVisible = false;
	#scheduledVisible = false;
	#operation = Promise.resolve();
	#revision = 0;
	#onError;

	constructor({
		getActivePage,
		observePageChanges = () => () => {},
		onError = (error) => console.warn("Unable to update banner visibility:", error),
	}) {
		this.#getActivePage = getActivePage;
		this.#observePageChanges = observePageChanges;
		this.#onError = onError;
	}

	setBanner(banner) {
		this.#banner = banner;
		this.#nativeVisible = false;
		this.#scheduledVisible = false;
		this.reconcile();
	}

	registerPage(page) {
		if (!page || (typeof page !== "object" && typeof page !== "function")) {
			return;
		}

		this.#registeredPages.add(page);
		this.#suspended = false;
		this.#startObserving();
		this.reconcile();
	}

	setKeyboardVisible(visible) {
		const nextValue = Boolean(visible);
		if (this.#keyboardVisible === nextValue) return;
		this.#keyboardVisible = nextValue;
		this.reconcile();
	}

	suspend() {
		if (this.#suspended && !this.#nativeVisible) return;
		this.#suspended = true;
		this.reconcile();
	}

	reconcile() {
		const activePage = this.#getActivePage?.() ?? null;
		const pageRequestsBanner =
			!this.#suspended &&
			activePage !== null &&
			this.#registeredPages.has(activePage);
		const shouldShow = pageRequestsBanner && !this.#keyboardVisible;

		if (this.#banner) {
			this.#banner.active = pageRequestsBanner;
		}

		this.#queueNativeVisibility(shouldShow);
	}

	whenIdle() {
		return this.#operation;
	}

	dispose() {
		this.#stopObserving?.();
		this.#stopObserving = null;
		this.#banner = null;
		this.#revision++;
	}

	#startObserving() {
		if (this.#stopObserving) return;
		this.#stopObserving = this.#observePageChanges(() => this.reconcile());
	}

	#queueNativeVisibility(shouldShow) {
		const banner = this.#banner;
		if (!banner || shouldShow === this.#scheduledVisible) return;

		this.#scheduledVisible = shouldShow;
		const revision = ++this.#revision;
		this.#operation = this.#operation
			.catch(this.#onError)
			.then(async () => {
				if (revision !== this.#revision || banner !== this.#banner) return;

				try {
					if (shouldShow) {
						await banner.show?.();
					} else {
						await banner.hide?.();
					}
					this.#nativeVisible = shouldShow;
				} catch (error) {
					this.#nativeVisible = !shouldShow;
					this.#scheduledVisible = !shouldShow;
					this.#onError(error);
				}
			});
	}
}

function getActivePage() {
	if (typeof document === "undefined") return null;
	const pages = document.querySelectorAll("wc-page:not(#root)");
	return [...pages].filter((page) => page.isConnected).at(-1) ?? null;
}

function observePageChanges(onChange) {
	if (
		typeof document === "undefined" ||
		!document.body ||
		typeof MutationObserver === "undefined"
	) {
		return () => {};
	}

	const observer = new MutationObserver(onChange);
	observer.observe(document.body, { childList: true });
	return () => observer.disconnect();
}

export const bannerVisibilityController = new BannerVisibilityController({
	getActivePage,
	observePageChanges,
});
