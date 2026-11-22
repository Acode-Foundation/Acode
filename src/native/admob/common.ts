export const NativeService = "AdMob";

export type NativeAction =
	| "adCreate"
	| "adDestroy"
	| "adHide"
	| "adIsLoaded"
	| "adLoad"
	| "adRecoverPresentation"
	| "adShow"
	| "bannerConfig"
	| "configure"
	| "privacyGatherConsent"
	| "privacyGetState"
	| "privacyResetForTesting"
	| "privacyShowOptions"
	| "ready"
	| "start"
	| "webviewGoto";

export enum Events {
	adClick = "admob.ad.click",
	adDismiss = "admob.ad.dismiss",
	adImpression = "admob.ad.impression",
	adLoad = "admob.ad.load",
	adLoadFail = "admob.ad.loadfail",
	adPaid = "admob.ad.paid",
	adReward = "admob.ad.reward",
	adShow = "admob.ad.show",
	adShowFail = "admob.ad.showfail",
	bannerSize = "admob.banner.size",
	ready = "admob.ready",
}

export type AdPaidEvent = {
	adId: string;
	adUnitId: string;
	adFormat: string;
	valueMicros: number;
	currencyCode: string;
	precision: number;
	adSourceName?: string;
	adSourceId?: string;
	adSourceInstanceName?: string;
	adSourceInstanceId?: string;
	mediationGroupName?: string;
	mediationABTestName?: string;
	mediationABTestVariant?: string;
};

export const enum Platform {
	android = "android",
	ios = "ios",
}

/**
 * An enum that represents the maximum ad content rating for an app or ad request.
 * @enum {string}
 */
type MaxAdContentRating =
	| /** Content suitable for general audiences, including families. */ "G"
	| /** Content suitable only for mature audiences. */ "MA"
	| /** Content suitable for most audiences with parental guidance. */ "PG"
	| /** Content suitable for teen and older audiences. */ "T"
	| /** Content suitability is unspecified. */ "";

/**
 * On iOS, either age flag being true selects Google's child age treatment.
 * Omitted/null flags retain their previous values; both false clear treatment.
 * See https://developers.google.com/admob/ios/targeting#migrate_to_age_treatment_from_tfcd_and_tfua
 */
export interface RequestConfig {
	maxAdContentRating?: MaxAdContentRating;
	tagForChildDirectedTreatment?: boolean | null;
	tagForUnderAgeOfConsent?: boolean | null;
	testDeviceIds?: string[];
}

export interface AdMobConfig extends RequestConfig {
	appMuted?: boolean;
	appVolume?: number;
	/** @deprecated Use publisherFirstPartyIDEnabled instead */
	sameAppKey?: boolean;
	publisherFirstPartyIDEnabled?: boolean;
}

/** @internal */
export function execAsync<T>(action: NativeAction, args?: unknown[]) {
	return new Promise<T>((resolve, reject) => {
		Bridge.exec(resolve, reject, NativeService, action, args);
	});
}
