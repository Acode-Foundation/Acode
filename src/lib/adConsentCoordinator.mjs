export const EMPTY_PRIVACY_STATE = Object.freeze({
	consentStatus: "unknown",
	canRequestAds: false,
	privacyOptionsRequired: false,
});

const VALID_CONSENT_STATUSES = new Set([
	"unknown",
	"required",
	"notRequired",
	"obtained",
]);

function normalizePrivacyState(state) {
	const consentStatus = VALID_CONSENT_STATUSES.has(state?.consentStatus)
		? state.consentStatus
		: "unknown";

	return {
		consentStatus,
		canRequestAds: state?.canRequestAds === true,
		privacyOptionsRequired: state?.privacyOptionsRequired === true,
	};
}

/**
 * Coordinates UMP and ad initialization for one application launch.
 * Consent is gathered once, ad initialization is idempotent, and a valid
 * previous-session UMP state can be used when the network update fails.
 */
export class AdConsentCoordinator {
	#privacy;
	#initializeAds;
	#onError;
	#state = EMPTY_PRIVACY_STATE;
	#consentPromise;
	#adStartPromise;
	#listeners = new Set();

	constructor({ privacy, initializeAds, onError = console.error }) {
		this.#privacy = privacy;
		this.#initializeAds = initializeAds;
		this.#onError = onError;
	}

	get state() {
		return { ...this.#state };
	}

	start() {
		return (this.#consentPromise ??= this.#gatherAndStart());
	}

	async showPrivacyOptions() {
		const state = await this.#privacy.showOptions();
		this.#setState(state);
		await this.#startAdsIfAllowed();
		return this.state;
	}

	subscribe(listener) {
		this.#listeners.add(listener);
		listener(this.state);
		return () => this.#listeners.delete(listener);
	}

	async #gatherAndStart() {
		try {
			this.#setState(await this.#privacy.gatherConsent());
		} catch (error) {
			this.#onError(error);
			try {
				this.#setState(await this.#privacy.getState());
			} catch (stateError) {
				this.#onError(stateError);
				this.#setState(EMPTY_PRIVACY_STATE);
			}
		}

		await this.#startAdsIfAllowed();
		return this.state;
	}

	async #startAdsIfAllowed() {
		if (!this.#state.canRequestAds) return false;
		this.#adStartPromise ??= Promise.resolve().then(this.#initializeAds);
		try {
			await this.#adStartPromise;
			return true;
		} catch (error) {
			this.#adStartPromise = undefined;
			throw error;
		}
	}

	#setState(state) {
		this.#state = normalizePrivacyState(state);
		for (const listener of this.#listeners) {
			listener(this.state);
		}
	}
}
