import { execAsync } from "./common";

export type PrivacyConsentStatus =
  | "unknown"
  | "required"
  | "notRequired"
  | "obtained";

export type PrivacyConsentState = {
  consentStatus: PrivacyConsentStatus;
  canRequestAds: boolean;
  privacyOptionsRequired: boolean;
};

export type ConsentDebugGeography = "disabled" | "eea" | "notEea";

export type GatherConsentOptions = {
  /**
   * Debug controls are rejected by native code in non-debuggable builds.
   */
  debugGeography?: ConsentDebugGeography;
  testDeviceIds?: string[];
};

export class Privacy {
  public gatherConsent(options: GatherConsentOptions = {}) {
    return execAsync<PrivacyConsentState>("privacyGatherConsent", [options]);
  }

  public getState() {
    return execAsync<PrivacyConsentState>("privacyGetState", [{}]);
  }

  public showOptions() {
    return execAsync<PrivacyConsentState>("privacyShowOptions", [{}]);
  }

  /**
   * Clears UMP state for first-install testing. Native code rejects this in
   * non-debuggable builds.
   */
  public resetForTesting() {
    return execAsync<void>("privacyResetForTesting", [{}]);
  }
}
