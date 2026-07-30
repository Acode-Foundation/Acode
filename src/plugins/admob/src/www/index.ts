import * as ads from "./ads";
import { type AdMobConfig, Events, execAsync } from "./common";
import { Privacy } from "./privacy";

export * from "./ads";
export * from "./common";
export * from "./privacy";

export class AdMob {
  public readonly AppOpenAd = ads.AppOpenAd;
  public readonly BannerAd = ads.BannerAd;
  public readonly InterstitialAd = ads.InterstitialAd;
  public readonly NativeAd = ads.NativeAd;
  public readonly RewardedAd = ads.RewardedAd;
  public readonly RewardedInterstitialAd = ads.RewardedInterstitialAd;
  public readonly WebViewAd = ads.WebViewAd;

  public readonly Events = Events;
  public readonly privacy = new Privacy();

  private _startPromise: ReturnType<typeof this._start> | undefined;

  configure(config: AdMobConfig) {
    return execAsync("configure", [config]);
  }

  public start() {
    // biome-ignore lint/suspicious/noAssignInExpressions: ignore
    return (this._startPromise ??= this._start());
  }

  private _start() {
    return execAsync<{ version: string }>("start");
  }
}

declare global {
  const admob: AdMob;
}

export default AdMob;
