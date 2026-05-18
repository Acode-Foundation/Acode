import { MobileAd, type MobileAdOptions } from "./base";

type ShowOptions = { x: number; y: number; width: number; height: number };

export interface NativeAdOptions extends MobileAdOptions {
  view?: string;
}

export class NativeAd extends MobileAd<NativeAdOptions> {
  static readonly cls = "NativeAd";

  public isLoaded() {
    return super.isLoaded();
  }

  async hide() {
    return super.hide();
  }

  public load() {
    return super.load();
  }

  async show(opts?: ShowOptions) {
    return super.show({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      ...opts,
    });
  }

  async showWith(elm: HTMLElement) {
    const update = async () => {
      const r = elm.getBoundingClientRect();
      await this.show({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    document.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    await update();
  }
}
