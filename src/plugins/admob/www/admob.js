'use strict';

var cordova$1 = require('cordova');
var channel = require('cordova/channel');
var exec = require('cordova/exec');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var cordova__namespace = /*#__PURE__*/_interopNamespaceDefault(cordova$1);

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const CordovaService = "AdMob";
var Events;
(function (Events) {
    Events["adClick"] = "admob.ad.click";
    Events["adDismiss"] = "admob.ad.dismiss";
    Events["adImpression"] = "admob.ad.impression";
    Events["adLoad"] = "admob.ad.load";
    Events["adLoadFail"] = "admob.ad.loadfail";
    Events["adPaid"] = "admob.ad.paid";
    Events["adReward"] = "admob.ad.reward";
    Events["adShow"] = "admob.ad.show";
    Events["adShowFail"] = "admob.ad.showfail";
    Events["bannerSize"] = "admob.banner.size";
    Events["ready"] = "admob.ready";
})(Events || (Events = {}));
/** @internal */
function execAsync(action, args) {
    return new Promise((resolve, reject) => {
        cordova.exec(resolve, reject, CordovaService, action, args);
    });
}

/** @internal */
class MobileAd {
    constructor(opts) {
        var _a;
        this.opts = opts;
        this.id = (_a = opts.id) !== null && _a !== void 0 ? _a : opts.adUnitId;
        MobileAd.allAds[this.id] = this;
    }
    static get allAds() {
        const win = window;
        if (typeof win.admobAds === "undefined")
            win.admobAds = {};
        return win.admobAds;
    }
    static getAdById(id) {
        return MobileAd.allAds[id];
    }
    get adUnitId() {
        return this.opts.adUnitId;
    }
    on(...args) {
        const [eventName, cb, ...rest] = args;
        const type = `admob.ad.${eventName.toLowerCase()}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const listener = (evt) => {
            if (evt.adId === this.id) {
                cb(evt);
            }
        };
        document.addEventListener(type, listener, ...rest);
        return () => {
            document.removeEventListener(type, listener, ...rest);
        };
    }
    isLoaded() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.init();
            return execAsync("adIsLoaded", [{ id: this.id }]);
        });
    }
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.init();
            // TODO read `opts` in native code?
            yield execAsync("adLoad", [Object.assign(Object.assign({}, this.opts), { id: this.id })]);
        });
    }
    show(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.init();
            return execAsync("adShow", [Object.assign(Object.assign({}, opts), { id: this.id })]);
        });
    }
    hide() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.init();
            return execAsync("adHide", [{ id: this.id }]);
        });
    }
    init() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
            return ((_a = this._initPromise) !== null && _a !== void 0 ? _a : (this._initPromise = this._init()));
        });
    }
    _init() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            yield admob.start();
            const cls = (_a = this.constructor.cls) !== null && _a !== void 0 ? _a : this.constructor.name;
            return execAsync("adCreate", [Object.assign(Object.assign({}, this.opts), { id: this.id, cls })]);
        });
    }
}

class AppOpenAd extends MobileAd {
    isLoaded() {
        return super.isLoaded();
    }
    load() {
        return super.load();
    }
    show() {
        const _super = Object.create(null, {
            show: { get: () => super.show }
        });
        return __awaiter(this, void 0, void 0, function* () {
            return _super.show.call(this);
        });
    }
}
AppOpenAd.cls = "AppOpenAd";

var AdSizeType;
(function (AdSizeType) {
    AdSizeType[AdSizeType["BANNER"] = 0] = "BANNER";
    AdSizeType[AdSizeType["LARGE_BANNER"] = 1] = "LARGE_BANNER";
    AdSizeType[AdSizeType["MEDIUM_RECTANGLE"] = 2] = "MEDIUM_RECTANGLE";
    AdSizeType[AdSizeType["FULL_BANNER"] = 3] = "FULL_BANNER";
    AdSizeType[AdSizeType["LEADERBOARD"] = 4] = "LEADERBOARD";
    /** @deprecated Use an adaptive BannerSize object instead. */
    AdSizeType[AdSizeType["SMART_BANNER"] = 5] = "SMART_BANNER";
})(AdSizeType || (AdSizeType = {}));
const colorToRGBA = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return () => undefined;
    return (col) => {
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
class BannerAd extends MobileAd {
    constructor(opts) {
        super(Object.assign({ position: "bottom", size: { adaptive: "anchored" } }, opts));
    }
    static config(opts) {
        if (cordova.platformId === "ios" /* Platform.ios */) {
            const { backgroundColor: bgColor } = opts;
            return execAsync("bannerConfig", [
                Object.assign(Object.assign({}, opts), { backgroundColor: bgColor ? colorToRGBA(bgColor) : bgColor }),
            ]);
        }
        return false;
    }
    load() {
        const _super = Object.create(null, {
            load: { get: () => super.load }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield _super.load.call(this);
        });
    }
    show() {
        const _super = Object.create(null, {
            show: { get: () => super.show }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield this.load();
            return _super.show.call(this);
        });
    }
    hide() {
        const _super = Object.create(null, {
            hide: { get: () => super.hide }
        });
        return __awaiter(this, void 0, void 0, function* () {
            return _super.hide.call(this);
        });
    }
}
BannerAd.cls = "BannerAd";

class InterstitialAd extends MobileAd {
    isLoaded() {
        return super.isLoaded();
    }
    load() {
        return super.load();
    }
    show() {
        return super.show();
    }
}
InterstitialAd.cls = "InterstitialAd";

class NativeAd extends MobileAd {
    isLoaded() {
        return super.isLoaded();
    }
    hide() {
        const _super = Object.create(null, {
            hide: { get: () => super.hide }
        });
        return __awaiter(this, void 0, void 0, function* () {
            return _super.hide.call(this);
        });
    }
    load() {
        return super.load();
    }
    show(opts) {
        const _super = Object.create(null, {
            show: { get: () => super.show }
        });
        return __awaiter(this, void 0, void 0, function* () {
            return _super.show.call(this, Object.assign({ x: 0, y: 0, width: 0, height: 0 }, opts));
        });
    }
    showWith(elm) {
        return __awaiter(this, void 0, void 0, function* () {
            const update = () => __awaiter(this, void 0, void 0, function* () {
                const r = elm.getBoundingClientRect();
                yield this.show({
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                });
            });
            const observer = new MutationObserver(update);
            observer.observe(document.body, {
                attributes: true,
                childList: true,
                subtree: true,
            });
            document.addEventListener("scroll", update);
            window.addEventListener("resize", update);
            yield update();
        });
    }
}
NativeAd.cls = "NativeAd";

class RewardedAd extends MobileAd {
    isLoaded() {
        return super.isLoaded();
    }
    load() {
        return super.load();
    }
    show() {
        return super.show();
    }
}
RewardedAd.cls = "RewardedAd";

class RewardedInterstitialAd extends MobileAd {
    isLoaded() {
        return super.isLoaded();
    }
    load() {
        return super.load();
    }
    show() {
        return super.show();
    }
}
RewardedInterstitialAd.cls = "RewardedInterstitialAd";

class WebViewAd extends MobileAd {
    static checkIntegration() {
        return __awaiter(this, void 0, void 0, function* () {
            yield execAsync("webviewGoto", [
                "https://webview-api-for-ads-test.glitch.me/",
            ]);
        });
    }
    constructor(opts) {
        var _a, _b, _c, _d, _e, _f, _g;
        opts.adUnitId = "";
        super(opts);
        this._loaded = false;
        this._src = "";
        this._adsense = "";
        this._originalHref = window.location.href || "";
        this._historyCurrentHref = "";
        this._adsense = opts.adsense;
        this._src =
            opts.src ||
                "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const win = window;
        if (typeof ((_a = win.gmaSdk) === null || _a === void 0 ? void 0 : _a.getQueryInfo) === "function" ||
            typeof ((_d = (_c = (_b = win.webkit) === null || _b === void 0 ? void 0 : _b.messageHandlers) === null || _c === void 0 ? void 0 : _c.getGmaQueryInfo) === null || _d === void 0 ? void 0 : _d.postMessage) ===
                "function" ||
            typeof ((_g = (_f = (_e = win.webkit) === null || _e === void 0 ? void 0 : _e.messageHandlers) === null || _f === void 0 ? void 0 : _f.getGmaSig) === null || _g === void 0 ? void 0 : _g.postMessage) === "function") {
            const html = `<script async src="${this._src}" crossorigin="anonymous"></script>

      ${opts.npa
                ? "<script>(window.adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = 1</script>"
                : ""}

      <script>
        (window.adsbygoogle = window.adsbygoogle || []).push({google_ad_client: "${this._adsense}", enable_page_level_ads: true, overlays: false});
      </script>
      `;
            const div = document.createElement("div");
            div.innerHTML = html;
            document.head.appendChild(div);
            this.nodeScriptReplace(div);
            this._loaded = true;
        }
        else {
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
    addAd(options) {
        const opts = Object.assign({ format: "auto", fullWidth: true }, options);
        if (this._loaded) {
            let html = opts.html || "";
            if (!opts.html) {
                html = `<script async src="${this._src}" crossorigin="anonymous"></script>

        <ins class="adsbygoogle" style="display:block" data-ad-client="${this._adsense}" data-ad-slot="${opts.slot}" data-ad-format="${opts.format}" data-full-width-responsive="${opts.fullWidth ? "true" : "false"}"></ins>

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
    nodeScriptReplace(node) {
        if (this.isNodeScript(node) === true) {
            node.parentNode.replaceChild(this.nodeScriptClone(node), node);
        }
        else {
            const children = node.childNodes;
            for (let i = 0, len = children.length; i < len; i++) {
                this.nodeScriptReplace(children[i]);
            }
        }
        return node;
    }
    nodeScriptClone(node) {
        const script = document.createElement("script");
        script.text = node.innerHTML;
        const attrs = node.attributes;
        for (let i = 0, len = attrs.length; i < len; i++) {
            script.setAttribute(attrs[i].name, attrs[i].value);
        }
        return script;
    }
    isNodeScript(node) {
        return node.tagName === "SCRIPT";
    }
    historyReplaceState(url) {
        if (!this._originalHref) {
            this._originalHref = window.location.href;
        }
        if (this._loaded) {
            window.history.replaceState(null, "", url);
        }
    }
    historySetPage(page, parameters = {}) {
        const _parameters = [];
        for (const name in parameters) {
            _parameters.push(`${name}=${encodeURI(parameters[name])}`);
        }
        const url = `${page}${_parameters.length > 0 ? `?${_parameters.join("&")}` : ""}`;
        this.historyReplaceState(url);
        return url;
    }
    historyOriginalHref() {
        return this._originalHref || window.location.href;
    }
    historyCurrentHref() {
        return window.location.href;
    }
    historyRestoreOriginalHref() {
        this.historyReplaceState(this.historyOriginalHref());
    }
    show() {
        const _super = Object.create(null, {
            show: { get: () => super.show }
        });
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._loaded) {
                yield this.load();
            }
            return _super.show.call(this);
        });
    }
}
WebViewAd.cls = "WebViewAd";

class Privacy {
    gatherConsent(options = {}) {
        return execAsync("privacyGatherConsent", [options]);
    }
    getState() {
        return execAsync("privacyGetState", [{}]);
    }
    showOptions() {
        return execAsync("privacyShowOptions", [{}]);
    }
    /**
     * Clears UMP state for first-install testing. Native code rejects this in
     * non-debuggable builds.
     */
    resetForTesting() {
        return execAsync("privacyResetForTesting", [{}]);
    }
}

class AdMob {
    constructor() {
        this.AppOpenAd = AppOpenAd;
        this.BannerAd = BannerAd;
        this.InterstitialAd = InterstitialAd;
        this.NativeAd = NativeAd;
        this.RewardedAd = RewardedAd;
        this.RewardedInterstitialAd = RewardedInterstitialAd;
        this.WebViewAd = WebViewAd;
        this.Events = Events;
        this.privacy = new Privacy();
    }
    configure(config) {
        return execAsync("configure", [config]);
    }
    start() {
        var _a;
        // biome-ignore lint/suspicious/noAssignInExpressions: ignore
        return ((_a = this._startPromise) !== null && _a !== void 0 ? _a : (this._startPromise = this._start()));
    }
    _start() {
        return execAsync("start");
    }
}

const admob$1 = new AdMob();
// biome-ignore lint/suspicious/noExplicitAny: ignore
function onMessageFromNative(event) {
    const { data } = event;
    if (data === null || data === void 0 ? void 0 : data.adId) {
        data.ad = MobileAd.getAdById(data.adId);
    }
    cordova__namespace.fireDocumentEvent(event.type, data);
}
const feature = "onAdMobPlusReady";
channel.createSticky(feature);
channel.waitForInitialization(feature);
channel.onCordovaReady.subscribe(() => {
    const action = "ready";
    exec(onMessageFromNative, console.error, CordovaService, action, []);
    channel.initializationComplete(feature);
});

module.exports = admob$1;
