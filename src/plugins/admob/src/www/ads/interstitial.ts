import { MobileAd, type MobileAdOptions } from "./base";

export class InterstitialAd extends MobileAd<MobileAdOptions> {
  static readonly cls = "InterstitialAd";

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
