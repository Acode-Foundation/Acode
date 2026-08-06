import { BANNER_SUPPRESSION_REASON } from "./bannerVisibilityController.mjs";

const DEFAULT_MAX_TIMEOUT = 2_147_483_647;

/**
 * Returns whether a normalized reward state still grants ad-free time.
 * The clock is injectable so expiry boundaries remain deterministic in tests.
 *
 * @param {{isActive?:boolean, adFreeUntil?:number} | null | undefined} state
 * @param {number} [now]
 */
export function isRewardPassActive(state, now = Date.now()) {
	return Boolean(state?.isActive && Number(state.adFreeUntil) > Number(now));
}

/**
 * Synchronizes the rewarded-pass blocker without affecting any other reason.
 *
 * @param {{isActive?:boolean, adFreeUntil?:number} | null | undefined} state
 * @param {(reason:string, suppressed:boolean)=>void} setBannerSuppressed
 * @param {number} [now]
 */
export function syncRewardBannerSuppression(
	state,
	setBannerSuppressed,
	now = Date.now(),
) {
	if (typeof setBannerSuppressed !== "function") {
		throw new TypeError("A banner suppression updater is required.");
	}

	const active = isRewardPassActive(state, now);
	setBannerSuppressed(BANNER_SUPPRESSION_REASON.REWARDED_PASS, active);
	return active;
}

/**
 * Owns reward-state application, refreshes, and expiry scheduling. Callers keep
 * the state storage so existing consumers can continue to read it directly.
 *
 * @template T
 * @param {{
 *   loadStatus:()=>Promise<unknown>,
 *   normalizeStatus:(status:unknown)=>T,
 *   getCurrentState:()=>T,
 *   setCurrentState:(state:T)=>void,
 *   setBannerSuppressed:(reason:string,suppressed:boolean)=>void,
 *   emitChange:(state:T)=>void,
 *   onRefreshError?:(error:unknown)=>void,
 *   onListenerError?:(error:unknown)=>void,
 *   onExpiryNotice?:(state:T)=>void,
 *   now?:()=>number,
 *   setTimer?:(callback:()=>void,delay:number)=>unknown,
 *   clearTimer?:(timer:unknown)=>void,
 *   maxTimeout?:number
 * }} options
 */
export function createRewardStateLifecycle({
	loadStatus,
	normalizeStatus,
	getCurrentState,
	setCurrentState,
	setBannerSuppressed,
	emitChange,
	onRefreshError = () => {},
	onListenerError = () => {},
	onExpiryNotice = () => {},
	now = Date.now,
	setTimer = setTimeout,
	clearTimer = clearTimeout,
	maxTimeout = DEFAULT_MAX_TIMEOUT,
}) {
	let expiryTimer = null;
	let pendingRefresh = Promise.resolve();

	function clearExpiryTimer() {
		if (expiryTimer === null) return;
		clearTimer(expiryTimer);
		expiryTimer = null;
	}

	function scheduleExpiryCheck() {
		clearExpiryTimer();
		const currentState = getCurrentState();
		const currentTime = now();
		if (!isRewardPassActive(currentState, currentTime)) return;

		const remainingMs = Number(currentState.adFreeUntil) - currentTime;
		expiryTimer = setTimer(() => {
			expiryTimer = null;
			void startRefresh({ notifyExpiry: true });
		}, Math.min(remainingMs, maxTimeout));
	}

	/**
	 * @param {T} nextState
	 * @returns {T}
	 */
	function applyNormalizedState(nextState) {
		setCurrentState(nextState);
		syncRewardBannerSuppression(nextState, setBannerSuppressed, now());

		try {
			emitChange(nextState);
		} catch (error) {
			onListenerError(error);
		}

		scheduleExpiryCheck();
		return nextState;
	}

	/**
	 * @param {unknown} status
	 * @returns {T}
	 */
	function applyStatus(status) {
		return applyNormalizedState(normalizeStatus(status));
	}

	async function refresh({ notifyExpiry = false } = {}) {
		let nextState;
		try {
			nextState = normalizeStatus(await loadStatus());
		} catch (error) {
			onRefreshError(error);
			return { state: getCurrentState(), refreshed: false };
		}

		applyNormalizedState(nextState);
		if (notifyExpiry && nextState.hasPendingExpiryNotice) {
			try {
				onExpiryNotice(nextState);
			} catch (error) {
				onListenerError(error);
			}
		}
		return { state: nextState, refreshed: true };
	}

	function startRefresh(options) {
		const operation = refresh(options);
		pendingRefresh = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	return Object.freeze({
		applyStatus,
		dispose: clearExpiryTimer,
		initialize: () => startRefresh({ notifyExpiry: false }),
		refresh: (options) => startRefresh(options),
		resume: () => startRefresh({ notifyExpiry: true }),
		whenIdle: () => pendingRefresh,
	});
}
