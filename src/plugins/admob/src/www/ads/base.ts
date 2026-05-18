import { execAsync } from "../common";

/** @internal */
export type MobileAdOptions = {
  id?: string;
  adUnitId: string;
  contentUrl?: string;
  keywords?: string[];
  npa?: "1";
};

interface MyWindow extends Window {
  admobAds?: Record<string, MobileAd>;
}

/** @internal */
export class MobileAd<T extends MobileAdOptions = MobileAdOptions> {
  public readonly id: string;

  protected readonly opts: T;
  private _initPromise: ReturnType<typeof this._init> | undefined;

  constructor(opts: T) {
    this.opts = opts;

    this.id = opts.id ?? opts.adUnitId;
    MobileAd.allAds[this.id] = this;
  }

  private static get allAds() {
    const win: MyWindow = window;
    if (typeof win.admobAds === "undefined") win.admobAds = {};
    return win.admobAds;
  }

  public static getAdById(id: string) {
    return MobileAd.allAds[id];
  }

  public get adUnitId() {
    return this.opts.adUnitId;
  }

  public on(...args: Parameters<typeof document.addEventListener>): () => void {
    const [eventName, cb, ...rest] = args;
    const type = `admob.ad.${eventName.toLowerCase()}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const listener = (evt: any) => {
      if (evt.adId === this.id) {
        cb(evt);
      }
    };
    document.addEventListener(type, listener, ...rest);

    return () => {
      document.removeEventListener(type, listener, ...rest);
    };
  }

  protected async isLoaded() {
    await this.init();
    return execAsync("adIsLoaded", [{ id: this.id }]) as Promise<boolean>;
  }

  protected async load() {
    await this.init();
    // TODO read `opts` in native code?
    await execAsync("adLoad", [{ ...this.opts, id: this.id }]);
  }

  protected async show(opts?: Record<string, unknown>) {
    await this.init();
    return execAsync("adShow", [{ ...opts, id: this.id }]);
  }

  protected async hide() {
    await this.init();
    return execAsync("adHide", [{ id: this.id }]);
  }

  protected async init() {
    // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
    return (this._initPromise ??= this._init());
  }

  private async _init() {
    await admob.start();

    const cls =
      (this.constructor as unknown as { cls?: string }).cls ??
      this.constructor.name;

    return execAsync("adCreate", [{ ...this.opts, id: this.id, cls }]);
  }
}
