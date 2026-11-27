import { EMPTY_PRIVACY_STATE } from "./adDefaults.mjs";

export { EMPTY_PRIVACY_STATE };

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
 * Successful consent collection is cached and ad initialization is idempotent.
 * Valid previous-session UMP state can be used when the network update fails.
 */
export class AdConsentCoordinator {
	#privacy;
	#initializeAds;
	#onError;
	#state = EMPTY_PRIVACY_STATE;
	#consentPromise;
	#adStartPromise;
	#privacyOptionsPromise;
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
		this.#consentPromise ??= this.#gatherAndStart().then(
			(state) => {
				if (!state.canRequestAds) this.#consentPromise = undefined;
				return state;
			},
			(error) => {
				this.#consentPromise = undefined;
				throw error;
			},
		);
		return this.#consentPromise.then(() => this.state);
	}

	showPrivacyOptions() {
		this.#privacyOptionsPromise ??= this.#showPrivacyOptions().finally(() => {
			this.#privacyOptionsPromise = undefined;
		});
		return this.#privacyOptionsPromise;
	}

	async #showPrivacyOptions() {
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
