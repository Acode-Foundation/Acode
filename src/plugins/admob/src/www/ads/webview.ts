import { execAsync } from "../common";
import { MobileAd, type MobileAdOptions } from "./base";

export interface WebViewAdOptions extends MobileAdOptions {
  src?: string;
  adsense: string;
  npa?: "1";
}

export class WebViewAd extends MobileAd<WebViewAdOptions> {
  static readonly cls = "WebViewAd";

  static async checkIntegration() {
    await execAsync("webviewGoto", [
      "https://webview-api-for-ads-test.glitch.me/",
    ]);
  }

  private _loaded = false;
  private _src = "";
  private _adsense = "";
  private _originalHref = window.location.href || "";
  private _historyCurrentHref = "";

  constructor(opts: WebViewAdOptions) {
    opts.adUnitId = "";
    super(opts);
    this._adsense = opts.adsense;
    this._src =
      opts.src ||
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const win = <any>window;
    if (
      typeof win.gmaSdk?.getQueryInfo === "function" ||
      typeof win.webkit?.messageHandlers?.getGmaQueryInfo?.postMessage ===
        "function" ||
      typeof win.webkit?.messageHandlers?.getGmaSig?.postMessage === "function"
    ) {
      const html = `<script async src="${this._src}" crossorigin="anonymous"></script>

      ${
        opts.npa
          ? "<script>(window.adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = 1</script>"
          : ""
      }

      <script>
        (window.adsbygoogle = window.adsbygoogle || []).push({google_ad_client: "${
          this._adsense
        }", enable_page_level_ads: true, overlays: false});
      </script>
      `;
      const div = document.createElement("div");
      div.innerHTML = html;
      document.head.appendChild(div);
      this.nodeScriptReplace(div);
      this._loaded = true;
    } else {
      console.error("WebView does not appear to be setup correctly");
    }

    document.addEventListener("pause", () => {
      this._historyCurrentHref = this.historyCurrentHref();
      this.historyRestoreOriginalHref();
    });

    document.addEventListener("resume", () => {
      if (this._historyCurrentHref) {
        this.historyReplaceState(this._historyCurrentHref);
      }
    });
  }

  public addAd(options: {
    element: HTMLElement;
    slot: string;
    format?: string;
    fullWidth?: boolean;
    html?: string;
  }) {
    const opts = {
      format: "auto",
      fullWidth: true,
      ...options,
    };
    if (this._loaded) {
      let html = opts.html || "";
      if (!opts.html) {
        html = `<script async src="${this._src}" crossorigin="anonymous"></script>

        <ins class="adsbygoogle" style="display:block" data-ad-client="${
          this._adsense
        }" data-ad-slot="${opts.slot}" data-ad-format="${
          opts.format
        }" data-full-width-responsive="${opts.fullWidth ? "true" : "false"}"></ins>

        <script>(window.adsbygoogle = window.adsbygoogle || []).push({});</script>`;
      }
      if (opts.element) {
        opts.element.innerHTML = html;
        this.nodeScriptReplace(opts.element);
        return true;
      }
    }
    return false;
  }

  private nodeScriptReplace(node) {
    if (this.isNodeScript(node) === true) {
      node.parentNode.replaceChild(this.nodeScriptClone(node), node);
    } else {
      const children = node.childNodes;
      for (let i = 0, len = children.length; i < len; i++) {
        this.nodeScriptReplace(children[i]);
      }
    }
    return node;
  }

  private nodeScriptClone(node) {
    const script = document.createElement("script");
    script.text = node.innerHTML;
    const attrs = node.attributes;
    for (let i = 0, len = attrs.length; i < len; i++) {
      script.setAttribute(attrs[i].name, attrs[i].value);
    }
    return script;
  }

  private isNodeScript(node) {
    return node.tagName === "SCRIPT";
  }

  private historyReplaceState(url: string) {
    if (!this._originalHref) {
      this._originalHref = window.location.href;
    }
    if (this._loaded) {
      window.history.replaceState(null, "", url);
    }
  }

  private historySetPage(page: string, parameters = {}) {
    const _parameters: string[] = [];
    for (const name in parameters) {
      _parameters.push(`${name}=${encodeURI(parameters[name])}`);
    }
    const url = `${page}${
      _parameters.length > 0 ? `?${_parameters.join("&")}` : ""
    }`;
    this.historyReplaceState(url);
    return url;
  }

  private historyOriginalHref() {
    return this._originalHref || window.location.href;
  }

  private historyCurrentHref() {
    return window.location.href;
  }

  private historyRestoreOriginalHref() {
    this.historyReplaceState(this.historyOriginalHref());
  }

  public async show() {
    if (!this._loaded) {
      await this.load();
    }

    return super.show();
  }
}
