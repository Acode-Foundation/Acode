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

const DEFAULT_RETRY_DELAY_MS = 500;
const TRANSIENT_LOAD_ERROR_CODES = new Set([0, 2, 3, 9]);

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
	#desiredVisible = false;
	#operation = Promise.resolve();
	#revision = 0;
	#onError;
	#retryTimer = null;
	#retryUsed = false;
	#stopBannerListeners = [];

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
		this.#stopListeningToBanner();
		this.#resetRetry();
		this.#revision++;
		this.#banner = banner;
		this.#nativeVisible = false;
		this.#scheduledVisible = false;
		this.#listenToBanner(banner);
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
		const eligibilityChanged = shouldShow !== this.#desiredVisible;
		this.#desiredVisible = shouldShow;

		if (!shouldShow || eligibilityChanged) {
			this.#resetRetry();
		}

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
		this.#stopListeningToBanner();
		this.#resetRetry();
		this.#banner = null;
		this.#desiredVisible = false;
		this.#nativeVisible = false;
		this.#scheduledVisible = false;
		this.#revision++;
	}

	#startObserving() {
		if (this.#stopObserving) return;
		this.#stopObserving = this.#observePageChanges(() => this.reconcile());
	}

	#queueNativeVisibility(shouldShow, isRetry = false) {
		const banner = this.#banner;
		if (
			!banner ||
			shouldShow === this.#scheduledVisible ||
			(shouldShow &&
				(this.#retryTimer !== null || (this.#retryUsed && !isRetry)))
		) {
			return;
		}

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
					if (revision !== this.#revision || banner !== this.#banner) return;
					this.#nativeVisible = shouldShow;
				} catch (error) {
					if (revision !== this.#revision || banner !== this.#banner) return;
					this.#nativeVisible = !shouldShow;
					this.#scheduledVisible = !shouldShow;
					this.#onError(error);
					if (shouldShow) this.#scheduleRetry();
				}
			});
	}

	#listenToBanner(banner) {
		if (typeof banner?.on !== "function") return;

		for (const [eventName, listener] of [
			["load", () => this.#handleBannerLoad()],
			["loadfail", (event) => this.#handleBannerLoadFailure(event)],
		]) {
			const stopListening = banner.on(eventName, listener);
			if (typeof stopListening === "function") {
				this.#stopBannerListeners.push(stopListening);
			}
		}
	}

	#stopListeningToBanner() {
		for (const stopListening of this.#stopBannerListeners.splice(0)) {
			stopListening();
		}
	}

	#handleBannerLoad() {
		this.#resetRetry();
		if (!this.#desiredVisible) return;

		this.#nativeVisible = true;
		this.#scheduledVisible = true;
	}

	#handleBannerLoadFailure(event) {
		this.#nativeVisible = false;
		this.#scheduledVisible = false;
		this.#onError(event);

		const errorCode = Number(event?.code);
		if (TRANSIENT_LOAD_ERROR_CODES.has(errorCode)) {
			this.#scheduleRetry();
		} else {
			this.#retryUsed = true;
		}
	}

	#scheduleRetry() {
		if (!this.#desiredVisible || this.#retryTimer !== null || this.#retryUsed) {
			return;
		}

		this.#retryUsed = true;
		const banner = this.#banner;
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = null;
			if (!this.#desiredVisible || banner !== this.#banner) return;
			this.#queueNativeVisibility(true, true);
		}, DEFAULT_RETRY_DELAY_MS);
	}

	#resetRetry() {
		if (this.#retryTimer !== null) {
			clearTimeout(this.#retryTimer);
			this.#retryTimer = null;
		}
		this.#retryUsed = false;
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
