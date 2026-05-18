import { MobileAd } from "./base";
import type { RewardedAdOptions } from "./rewarded";

export type RewardedInterstitialAdOptions = RewardedAdOptions;

export class RewardedInterstitialAd extends MobileAd<RewardedInterstitialAdOptions> {
  static readonly cls = "RewardedInterstitialAd";

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
