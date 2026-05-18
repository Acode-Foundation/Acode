import { MobileAd, type MobileAdOptions } from "./base";

export interface ServerSideVerificationOptions {
  customData?: string;
  userId?: string;
}

export interface RewardedAdOptions extends MobileAdOptions {
  serverSideVerification?: ServerSideVerificationOptions;
}

export class RewardedAd extends MobileAd<RewardedAdOptions> {
  static readonly cls = "RewardedAd";

  public isLoaded() {
    return super.isLoaded();
  }

  public load() {
    return super.load();
  }

  public show() {
    return super.show();
  }
}
