import { MobileAd, type MobileAdOptions } from "./base";

export class AppOpenAd extends MobileAd<MobileAdOptions> {
  static readonly cls = "AppOpenAd";

  public isLoaded() {
    return super.isLoaded();
  }

  public load() {
    return super.load();
  }

  async show() {
    return super.show() as Promise<boolean>;
  }
}
