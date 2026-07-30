/**
 * Keeps banner intent separate from transient native visibility.
 *
 * Pages register once when they request a banner. The active top page, keyboard
 * state, and named suppression reasons then determine whether the native banner
 * should be visible.
 */
export const BANNER_SUPPRESSION_REASON = Object.freeze({
	PRO: "pro",
	REWARDED_PASS: "rewarded-pass",
});

export class BannerVisibilityController {
	#banner = null;
	#registeredPages = new WeakSet();
	#getActivePage;
	#observePageChanges;
	#stopObserving = null;
	#keyboardVisible = false;
	#suppressions = new Set();
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
		this.#startObserving();
		this.reconcile();
	}

	setKeyboardVisible(visible) {
		const nextValue = Boolean(visible);
		if (this.#keyboardVisible === nextValue) return;
		this.#keyboardVisible = nextValue;
		this.reconcile();
	}

	setSuppressed(reason, suppressed) {
		if (typeof reason !== "string" || !reason.trim()) {
			throw new TypeError("Banner suppression reason must be a non-empty string.");
		}

		const normalizedReason = reason.trim();
		const shouldSuppress = Boolean(suppressed);
		const isSuppressed = this.#suppressions.has(normalizedReason);
		if (isSuppressed === shouldSuppress) return;

		if (shouldSuppress) {
			this.#suppressions.add(normalizedReason);
		} else {
			this.#suppressions.delete(normalizedReason);
		}
		this.reconcile();
	}

	reconcile() {
		const activePage = this.#getActivePage?.() ?? null;
		const pageRequestsBanner =
			this.#suppressions.size === 0 &&
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
	const connectedPages = [...pages].filter((page) => page.isConnected);
	return connectedPages[connectedPages.length - 1] ?? null;
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
