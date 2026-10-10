/// <reference path="./lang/index.d.ts" />
/// <reference path="../node_modules/html-tag-js/index.d.ts" />

declare const ASSETS_DIRECTORY: string;
declare const DATA_STORAGE: string;
declare const CACHE_STORAGE: string;
declare const PLUGIN_DIR: string;
declare const KEYBINDING_FILE: string;
declare const ANDROID_SDK_INT: number;
declare const DOES_SUPPORT_THEME: boolean;
declare const acode: {
  webview: AcodeWebViewAPI;
  require(module: "fullscreen"): AcodeFullscreenAPI;
  require(module: "orientation"): AcodeOrientationAPI;
  require(module: string): unknown;
  [key: string]: unknown;
};

interface Window {
  ASSETS_DIRECTORY: string;
  DATA_STORAGE: string;
  CACHE_STORAGE: string;
  PLUGIN_DIR: string;
  KEYBINDING_FILE: string;
  ANDROID_SDK_INT: number;
  DOES_SUPPORT_THEME: boolean;
  acode: object;
}

interface String {
  /**
   * Capitalize the first letter of a string
   */
  capitalize(): string;
  /**
   * Generate a hash from a string
   */
  hashCode(): string;
}

type ExecutorCallback = (
  type: "stdout" | "stderr" | "exit",
  data: string,
) => void;

interface Executor {
  execute: (command: string, alpine: boolean) => Promise<string>;
  start: (
    command: string,
    callback: ExecutorCallback,
    alpine: boolean,
  ) => Promise<string>;
  write: (uuid: string, input: string) => Promise<void>;
  stop: (uuid: string) => Promise<void>;
  isRunning: (uuid: string) => Promise<boolean>;
  listProcesses: () => Promise<ExecutorProcess[]>;
  /** Move the executor service to the foreground (shows notification) */
  moveToForeground: () => Promise<void>;
  /** Move the executor service to the background (hides notification) */
  moveToBackground: () => Promise<void>;
  /** Stop the executor service completely */
  stopService: () => Promise<void>;
  /**
   * Background executor
   */
  BackgroundExecutor: Executor;
}

interface ExecutorProcess {
  id: string;
  pid: number;
  command: string;
  alpine: boolean;
  startedAt: number;
  background: boolean;
}

declare const Executor: Executor | undefined;

interface Window {
  Executor?: Executor;
  editorManager?: EditorManager;
}

interface EditorManager {
  editor?: import("@codemirror/view").EditorView;
  isCodeMirror?: boolean;
  activeFile?: AcodeFile;
  getLspMetadata?: (file: AcodeFile) => LspFileMetadata | null;
}

interface LspFileMetadata {
  uri: string;
  languageId?: string;
  languageName?: string;
  view?: import("@codemirror/view").EditorView;
  file?: AcodeFile;
  rootUri?: string;
}

/**
 * Acode file object
 */
interface AcodeFile {
  uri?: string;
  name?: string;
  session?: unknown;
  cacheFile?: string;
  [key: string]: unknown;
}

// Extend globalThis with Executor
declare global {
  var Executor: Executor | undefined;
}

type WebViewMode = "fullscreen" | "hidden";
type WebViewCacheMode =
  | "default"
  | "no-cache"
  | "cache-only"
  | "cache-else-network";
type WebViewMixedContentMode =
  | "never-allow"
  | "compatibility"
  | "always-allow";
type WebViewUserAgentMode = "default" | "mobile" | "desktop";
type WebViewAlgorithmicDarkening = "auto" | "on" | "off";

/** Web settings that can be set at creation and changed at runtime. */
interface WebViewSettings {
  /** Exact user-agent string. Takes precedence over userAgentMode. */
  userAgent?: string | null;
  /** Preset user agent: platform default, mobile, or desktop. */
  userAgentMode?: WebViewUserAgentMode;
  javaScript?: boolean;
  domStorage?: boolean;
  databaseStorage?: boolean;
  cacheMode?: WebViewCacheMode;
  mediaPlaybackRequiresUserGesture?: boolean;
  loadImages?: boolean;
  mixedContentMode?: WebViewMixedContentMode;
  /** Page text zoom in percent (25-500). */
  textZoom?: number;
  /** Initial viewport scale in percent (0 = WebView default). */
  initialScale?: number;
  useWideViewPort?: boolean;
  loadWithOverviewMode?: boolean;
  supportZoom?: boolean;
  builtInZoomControls?: boolean;
  displayZoomControls?: boolean;
  geolocation?: boolean;
  safeBrowsing?: boolean;
  algorithmicDarkening?: WebViewAlgorithmicDarkening;
  acceptThirdPartyCookies?: boolean;
  /** CSS color (e.g. "#101418") painted behind the page. */
  backgroundColor?: string;
}

interface WebViewOptions extends WebViewSettings {
  /** Title applied to the hosting activity in fullscreen mode. */
  title?: string;
  /**
   * "fullscreen" displays the WebView in its own activity, "hidden" runs it
   * headless (never displayed). Defaults to "hidden".
   */
  mode?: WebViewMode;
  /**
   * Show immediately after creation. Defaults to true. Only meaningful for
   * fullscreen mode: when false, the activity launch is deferred until
   * show() is called.
   */
  visible?: boolean;
  /**
   * Run in a private, ephemeral profile: separate cookies/localStorage (when
   * the WebView provider supports multi-profile), no cache, and all data is
   * cleared when the instance is destroyed. Defaults to false.
   */
  incognito?: boolean;
  /**
   * Named WebView profile used for isolation. Incognito instances get an
   * auto-generated ephemeral name when this is omitted; a named incognito
   * profile is shared by every instance that uses the same name.
   *
   * Must be 1-64 characters from `A-Z a-z 0-9 _ -`. Names are used verbatim
   * and invalid or reserved (`acode_incognito_*`) names are rejected so two
   * different requests can never select the same profile.
   */
  profileName?: string;
  /**
   * Allow in-WebView navigation. Defaults to true. Only http(s) targets ever
   * load; other schemes are always blocked for isolation.
   */
  allowNavigation?: boolean;
  /**
   * Ask the user with a confirmation dialog before downloading files via the
   * system DownloadManager. Defaults to false.
   */
  allowDownloads?: boolean;
  /** Resolved by the native layer: whether profile isolation is active. */
  readonly isolated?: boolean;
}

interface WebViewHTMLLoadOptions {
  baseUrl?: string;
  mimeType?: string;
  encoding?: string;
  historyUrl?: string;
}

interface WebViewCapabilities {
  version: string;
  /** Multi-profile support: required for true incognito isolation. */
  multiProfile: boolean;
  deleteBrowsingData: boolean;
  documentStartScript: boolean;
  safeBrowsing: boolean;
  algorithmicDarkening: boolean;
}

interface WebViewInfo {
  id: string;
  mode: WebViewMode;
  incognito: boolean;
  isolated: boolean;
  destroyed: boolean;
  ready: boolean;
  profileName?: string;
  url: string;
  title: string;
  progress: number;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  userAgent?: string | null;
}

type WebViewEventName =
  | "pageStarted"
  | "pageCommitVisible"
  | "pageFinished"
  | "progressChanged"
  | "titleChanged"
  | "faviconChanged"
  | "historyChanged"
  | "scrollChanged"
  | "renderProcessGone"
  | "ready"
  | "closed"
  | "navigationRequested"
  | "navigationBlocked"
  | "resourceError"
  | "httpError"
  | "sslError"
  | "consoleMessage"
  | "jsAlert"
  | "jsConfirm"
  | "jsPrompt"
  | "jsBeforeUnload"
  | "permissionRequest"
  | "geolocationPermissionRequest"
  | "fullscreenChanged"
  | "windowRequested"
  | "downloadRequested"
  | "downloadStarted"
  | "downloadFailed"
  | "shown"
  | "hidden"
  | "destroyed";

type WebViewEventHandler<T = unknown> = (data: T, event: string) => void;
type WebViewAnyEventHandler = (event: string, data: unknown) => void;
type WebViewMessageHandler = (message: unknown) => void;

interface AcodeWebView {
  readonly id: string;
  readonly options: WebViewOptions;
  readonly capabilities: WebViewCapabilities;
  readonly isDestroyed: boolean;
  /** True once the native WebView exists (see waitForReady). */
  readonly ready: boolean;
  readonly isIncognito: boolean;
  /** True when the instance runs in its own isolated WebView profile. */
  readonly isIsolated: boolean;
  readonly profileName: string | null;
  readonly url: string;
  readonly title: string;
  readonly progress: number;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** Load an http(s) URL. Other schemes are rejected. */
  loadURL(url: string, headers?: Record<string, string>): Promise<void>;
  loadHTML(html: string, options?: WebViewHTMLLoadOptions): Promise<void>;
  evaluate(js: string): Promise<string | null>;
  postMessage(message: unknown): Promise<void>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
  /** Navigates back; resolves true when a navigation happened. */
  goBack(): Promise<boolean>;
  goForward(): Promise<boolean>;
  /** Re-reads the back/forward flags from the native WebView. */
  refreshHistory(): Promise<{ canGoBack: boolean; canGoForward: boolean }>;
  /**
   * Resolves once the native WebView exists. Hidden instances are ready by the
   * time create() resolves; fullscreen instances become ready when their
   * activity builds the WebView, so await this before evaluate() on a
   * fullscreen instance. Rejects on close/destroy or timeout (ms; 0 disables).
   */
  waitForReady(timeout?: number): Promise<void>;
  /**
   * Resolves when the main frame finishes loading, or rejects on a main-frame
   * load error, close/destroy, or timeout (ms; 0 disables the timeout).
   * Attach it before starting the navigation, since loadURL()/loadHTML()
   * resolve as soon as the load is initiated.
   */
  waitForLoad(timeout?: number): Promise<{ url: string; title: string }>;
  /**
   * Show the WebView. Only fullscreen instances can be shown; rejects for
   * "hidden" mode.
   */
  show(): Promise<void>;
  /**
   * Hide the WebView. Fullscreen instances are moved to the background;
   * show() brings the same WebView back with its page state intact.
   * No-op for "hidden" mode.
   */
  hide(): Promise<void>;
  clearCache(includeDiskFiles?: boolean): Promise<void>;
  clearHistory(): Promise<void>;
  clearFormData(): Promise<void>;
  setUserAgent(
    userAgent: string | null,
    mode?: WebViewUserAgentMode,
  ): Promise<WebViewSettings>;
  getUserAgent(): Promise<string | null>;
  /** Applies a partial batch of web settings. */
  configure(settings: WebViewSettings): Promise<WebViewSettings>;
  getSettings(): Promise<WebViewSettings>;
  getInfo(): Promise<WebViewInfo>;
  on(event: WebViewEventName | "*", callback: WebViewEventHandler): this;
  off(event: WebViewEventName | "*", callback: WebViewEventHandler): this;
  once(event: WebViewEventName | "*", callback: WebViewEventHandler): this;
  onAny(callback: WebViewAnyEventHandler): this;
  offAny(callback: WebViewAnyEventHandler): this;
  removeAllListeners(event?: WebViewEventName | "*"): this;
  onMessage(callback: WebViewMessageHandler): this;
  offMessage(callback: WebViewMessageHandler): this;
  destroy(): Promise<void>;
}

interface AcodeWebViewEvents {
  readonly PAGE_STARTED: "pageStarted";
  readonly PAGE_COMMIT_VISIBLE: "pageCommitVisible";
  readonly PAGE_FINISHED: "pageFinished";
  readonly PROGRESS: "progressChanged";
  readonly TITLE_CHANGED: "titleChanged";
  readonly FAVICON_CHANGED: "faviconChanged";
  readonly HISTORY_CHANGED: "historyChanged";
  readonly SCROLL_CHANGED: "scrollChanged";
  readonly RENDER_PROCESS_GONE: "renderProcessGone";
  readonly READY: "ready";
  readonly CLOSED: "closed";
  readonly NAVIGATION_REQUESTED: "navigationRequested";
  readonly NAVIGATION_BLOCKED: "navigationBlocked";
  readonly RESOURCE_ERROR: "resourceError";
  readonly HTTP_ERROR: "httpError";
  readonly SSL_ERROR: "sslError";
  readonly CONSOLE_MESSAGE: "consoleMessage";
  readonly JS_ALERT: "jsAlert";
  readonly JS_CONFIRM: "jsConfirm";
  readonly JS_PROMPT: "jsPrompt";
  readonly JS_BEFORE_UNLOAD: "jsBeforeUnload";
  readonly PERMISSION_REQUEST: "permissionRequest";
  readonly GEOLOCATION_PERMISSION: "geolocationPermissionRequest";
  readonly FULLSCREEN_CHANGED: "fullscreenChanged";
  readonly WINDOW_REQUESTED: "windowRequested";
  readonly DOWNLOAD_REQUESTED: "downloadRequested";
  readonly DOWNLOAD_STARTED: "downloadStarted";
  readonly DOWNLOAD_FAILED: "downloadFailed";
  readonly SHOWN: "shown";
  readonly HIDDEN: "hidden";
  readonly DESTROYED: "destroyed";
}

interface AcodeWebViewAPI {
  create(options?: WebViewOptions): Promise<AcodeWebView>;
  /** Feature support of the installed WebView provider. */
  getCapabilities(): Promise<WebViewCapabilities>;
  /** Live instance for an id, or null when it no longer exists. */
  get(id: string): AcodeWebView | null;
  /** Ids of all live instances. */
  list(): string[];
  /** Destroys every live instance. */
  destroyAll(): Promise<void>;
  readonly AcodeWebView: new (
    id: string,
    options?: WebViewOptions,
    capabilities?: WebViewCapabilities,
  ) => AcodeWebView;
  readonly events: AcodeWebViewEvents;
  readonly modes: { readonly FULLSCREEN: "fullscreen"; readonly HIDDEN: "hidden" };
  readonly cacheModes: {
    readonly DEFAULT: "default";
    readonly NO_CACHE: "no-cache";
    readonly CACHE_ONLY: "cache-only";
    readonly CACHE_ELSE_NETWORK: "cache-else-network";
  };
  readonly mixedContentModes: {
    readonly NEVER_ALLOW: "never-allow";
    readonly COMPATIBILITY: "compatibility";
    readonly ALWAYS_ALLOW: "always-allow";
  };
  readonly userAgentModes: {
    readonly DEFAULT: "default";
    readonly MOBILE: "mobile";
    readonly DESKTOP: "desktop";
  };
  readonly algorithmicDarkeningModes: {
    readonly AUTO: "auto";
    readonly ON: "on";
    readonly OFF: "off";
  };
}

interface AcodeFullscreenAPI {
  /**
   * Claim Back for the current browser fullscreen owner, or release with null.
   * The callback must explicitly exit fullscreen when desired.
   * Resolves when the native request is accepted.
   */
  setBackHandler(callback: (() => void | Promise<void>) | null): Promise<void>;
}

/** Fullscreen-scoped orientation requests resolve on native acceptance. */
interface AcodeOrientationAPI {
  /** Requires a foreground browser fullscreen session. */
  lock(mode: "landscape" | "portrait"): Promise<void>;
  /** Restores the previous orientation policy, if overridden. */
  unlock(): Promise<void>;
}
