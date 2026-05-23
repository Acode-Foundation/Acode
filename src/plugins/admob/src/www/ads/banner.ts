import { Platform, execAsync } from "../common";
import { MobileAd, type MobileAdOptions } from "./base";

type Position = "top" | "bottom";

export enum AdSizeType {
  BANNER = 0,
  LARGE_BANNER = 1,
  MEDIUM_RECTANGLE = 2,
  FULL_BANNER = 3,
  LEADERBOARD = 4,
  SMART_BANNER = 5,
}

const colorToRGBA = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;

  return (
    col: string,
  ): { r: number; g: number; b: number; a: number } | undefined => {
    ctx.clearRect(0, 0, 1, 1);
    // In order to detect invalid values,
    // we can't rely on col being in the same format as what fillStyle is computed as,
    // but we can ask it to implicitly compute a normalized value twice and compare.
    ctx.fillStyle = "#000";
    ctx.fillStyle = col;
    const computed = ctx.fillStyle;
    ctx.fillStyle = "#fff";
    ctx.fillStyle = col;
    if (computed !== ctx.fillStyle) {
      return; // invalid color
    }
    ctx.fillRect(0, 0, 1, 1);
    const { data } = ctx.getImageData(0, 0, 1, 1);
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  };
})();

type BannerSize =
  | AdSizeType
  | { width: number; height: number }
  | {
      adaptive: "anchored";
      orientation?: "portrait" | "landscape";
      width?: number;
    }
  | {
      adaptive: "inline";
      maxHeight: number;
      width?: number;
    };

export interface BannerAdOptions extends MobileAdOptions {
  position?: Position;
  size?: BannerSize;
  offset?: number;
}

export class BannerAd extends MobileAd<BannerAdOptions> {
  static readonly cls = "BannerAd";

  private _loaded = false;

  constructor(opts: BannerAdOptions) {
    super({
      position: "bottom",
      size: AdSizeType.SMART_BANNER,
      ...opts,
    });
  }

  public static config(opts: {
    backgroundColor?: string;
    marginTop?: number;
    marginBottom?: number;
  }) {
    if (cordova.platformId === Platform.ios) {
      const { backgroundColor: bgColor } = opts;
      return execAsync("bannerConfig", [
        { ...opts, backgroundColor: bgColor ? colorToRGBA(bgColor) : bgColor },
      ]);
    }
    return false;
  }

  public async load() {
    await super.load();
    this._loaded = true;
  }

  public async show() {
    if (!this._loaded) {
      await this.load();
    }

    return super.show();
  }

  public async hide() {
    return super.hide();
  }
}
