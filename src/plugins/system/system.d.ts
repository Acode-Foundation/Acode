interface Info {
  versionName: string;
  packageName: string;
  versionCode: number;
}

interface AppInfo extends Info {
  label: string;
  firstInstallTime: number;
  lastUpdateTime: number;
}

interface ShortCut {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: string;
  data: string;
}

interface FileShortcut {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  uri: string;
}

interface Intent {
  uris?: string[];
  action: string;
  data: string;
  type: string;
  package: string;
  extras: {
    [key: string]: any;
  };
}

interface RewardStatus {
  adFreeUntil: number;
  lastExpiredRewardUntil: number;
  isActive: boolean;
  remainingMs: number;
  redemptionsToday: number;
  remainingRedemptions: number;
  maxRedemptionsPerDay: number;
  maxActivePassMs: number;
  hasPendingExpiryNotice: boolean;
  expiryNoticePendingUntil: number;
  canRedeem: boolean;
  redeemDisabledReason: string;
  grantedDurationMs?: number;
  appliedDurationMs?: number;
  offerId?: string;
}

type FileAction = 'VIEW' | 'EDIT' | 'SEND' | 'RUN';
type OnFail = (err: string) => void;
type OnSuccessBool = (res: boolean) => void;

interface LaunchAppWithFileOptions {
  /** Package name of the target app, e.g. `org.love2d.android`. Omit to let the system choose. */
  app?: string;
  /**
   * Fully qualified activity class name, e.g. `org.love2d.android.GameActivity`.
   * Omit to resolve the best matching activity inside `app`. Requires `app`.
   */
  className?: string;
  /**
   * `file://` URL of a file to hand over, or an existing `content://` URI.
   *
   * A `file://` path is exposed through the app's FileProvider (copied to the
   * cache first when it lives outside the shareable roots). A `content://` URI
   * is passed through unchanged and re-granted to the target, so it stays
   * readable only while this app still holds access to it.
   */
  fileUri?: string;
  /**
   * Several files to hand over together; `fileUri`, if given, comes first.
   * Same source rules as `fileUri`.
   */
  fileUris?: string[];
  /** Display name used when a shareable copy has to be created */
  filename?: string;
  /** Label for the shared item; defaults to the file name */
  clipLabel?: string;
  /**
   * MIME type to advertise. When given it is always honoured, including
   * `application/octet-stream`; such a value is never second-guessed by file
   * detection. When omitted it is taken from the files, narrowed to the type
   * they all share. Pass the universal wildcard to force detection.
   */
  mimeType?: string;
  /**
   * Intent action, short (`VIEW`, `EDIT`, `SEND`, `SEND_MULTIPLE`, `RUN`) or
   * fully qualified. Defaults to `VIEW` for one file, `SEND_MULTIPLE` for
   * several files, and `MAIN` when no file is given.
   */
  action?: FileAction | string;
  /** Intent categories, e.g. `["LAUNCHER"]`, or fully qualified names */
  categories?: string[];
  /**
   * Extra intent flags, as readable names (`NEW_TASK`, `SINGLE_TOP`,
   * `CLEAR_TOP`, `GRANT_WRITE_URI_PERMISSION`, …) or raw flag integers.
   */
  flags?: Array<string | number>;
  /**
   * Intent extras. Arrays arrive as typed arrays on the receiving side;
   * integers outside the 32-bit range arrive as a `long[]` rather than being
   * truncated.
   */
  extras?: Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  >;
  /** Grant the target write access; implied by the `EDIT` action */
  writeAccess?: boolean;
  /** Also place the first URI in `Intent.EXTRA_STREAM` */
  attachAsStream?: boolean;
  /** Launch the activity in a new task. Defaults to `true` */
  newTask?: boolean;
}

interface LaunchAppWithFileResult {
  /** First content URI handed over, or `''` when no file was passed */
  uri: string;
  /** Every content URI handed over, in order */
  uris: string[];
  /**
   * Package actually targeted. Empty when the receiver is not pinned down,
   * e.g. an implicit launch where the system (or the user) chooses.
   */
  app: string;
  /** Targeted activity class, or `''` when the receiver is not pinned down */
  className: string;
  /**
   * `package/class` of the target, or `''` when the receiver is not pinned
   * down. Never reports the system's app picker as if it were the receiver.
   */
  component: string;
  /** Fully qualified action the intent was created with */
  action: string;
  /** MIME type the intent was resolved to */
  mimeType: string;
}

interface HttpStreamOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyIsBase64?: boolean;
  followRedirects?: boolean;
  connectTimeout?: number;
  readTimeout?: number;
  chunkSize?: number;
  signal?: AbortSignal;
}

interface System {
  /**
   * Get information about current webview
   */
  getWebviewInfo(onSuccess: (res: Info) => void, onFail: OnFail): void;
  /**
   * Checks if power saving mode is on
   * @param onSuccess
   * @param onFail
   */
  isPowerSaveMode(onSuccess: OnSuccessBool, onFail: OnFail): void;
  /**
   * File action using Apps content provider
   * @param fileUri File uri
   * @param filename file name
   * @param action file name
   * @param onFail
   */
  fileAction(
    fileUri: string,
    filename: string,
    action: FileAction,
    mimeType: string,
    onFail: OnFail,
  ): void;
  /**
   * File action using Apps content provider
   * @param fileUri File uri
   * @param filename file name
   * @param action file name
   */
  fileAction(
    fileUri: string,
    filename: string,
    action: FileAction,
    mimeType: string,
  ): void;
  /**
   * File action using Apps content provider
   * @param fileUri File uri
   * @param action file name
   * @param onFail
   */
  fileAction(
    fileUri: string,
    action: FileAction,
    mimeType: string,
    onFail: OnFail,
  ): void;
  /**
   * File action using Apps content provider
   * @param fileUri File uri
   * @param action file name
   */
  fileAction(fileUri: string, action: FileAction, mimeType: string): void;
  /**
   * File action using Apps content provider
   * @param fileUri File uri
   * @param action file name
   */
  fileAction(fileUri: string, action: FileAction, onFail: OnFail): void;
  /**
   * File action using Apps content provider
   * @param fileUri File uri
   * @param action file name
   */
  fileAction(fileUri: string, action: FileAction): void;
  /**
   * Gets app information
   * @param onSuccess
   * @param onFail
   */
  getAppInfo(onSuccess: (info: AppInfo) => void, onFail: OnFail): void;
  /**
   * Add shortcut to app context menu
   * @param shortCut
   * @param onSuccess
   * @param onFail
   */
  addShortcut(
    shortCut: ShortCut,
    onSuccess: OnSuccessBool,
    onFail: OnFail,
  ): void;
  /**
   * Removes shortcut
   * @param id
   * @param onSuccess
   * @param onFail
   */
  removeShortcut(id: string, onSuccess: OnSuccessBool, onFail: OnFail): void;
  /**
   * Pins a shortcut
   * @param id
   * @param onSuccess
   * @param onFail
   */
  pinShortcut(id: string, onSuccess: OnSuccessBool, onFail: OnFail): void;

  /**
   * Pin a shortcut for a specific file to the home screen
   * @param shortcut Shortcut configuration
   * @param onSuccess
   * @param onFail
   */
  pinFileShortcut(
    shortcut: FileShortcut,
    onSuccess: OnSuccessBool,
    onFail: OnFail,
  ): void;
  /**
   * Gets android version
   * @param onSuccess
   * @param onFail
   */
  getAndroidVersion(onSuccess: (res: Number) => void, onFail: OnFail): void;
  /**
   * Open settings which lets user change app settings to manage all files
   * @param onSuccess
   * @param onFail
   */
  manageAllFiles(onSuccess: OnSuccessBool, onFail: OnFail): void;
  /**
   * Opens settings to allow to grant the app permission manage all files on device
   * @param onSuccess
   * @param onFail
   */
  isExternalStorageManager(onSuccess: OnSuccessBool, onFail: OnFail): void;
  /**
   * Requests user to grant the provided permissions
   * @param permissions constant value of the permission required @see https://developer.android.com/reference/android/Manifest.permission
   * @param onSuccess
   * @param onFail
   */
  requestPermissions(
    permissions: string[],
    onSuccess: OnSuccessBool,
    onFail: OnFail,
  ): void;
  /**
   * Requests user to grant the provided permission
   * @param permission constant value of the permission required @see https://developer.android.com/reference/android/Manifest.permission
   * @param onSuccess
   * @param onFail
   */
  requestPermission(
    permission: string,
    onSuccess: OnSuccessBool,
    onFail: OnFail,
  ): void;
  /**
   * Checks whether the app has provided permission
   * @param permission constant value of the permission required @see https://developer.android.com/reference/android/Manifest.permission
   * @param onSuccess
   * @param onFail
   */
  hasPermission(
    permission: string,
    onSuccess: OnSuccessBool,
    onFail: OnFail,
  ): void;
  /**
   * Opens src in browser
   * @param src
   */
  openInBrowser(src: string): void;
  /**
   * Launch an Android application activity.
   *
   * @param app Package name of the application (e.g. `com.example.app`)
   * @param className Fully qualified activity class name (e.g. `com.example.app.MainActivity`)
   * @param extras Optional key-value pairs passed as Android Intent extras
   * @param onSuccess Called when the activity launches successfully
   * @param onFail Called if launching the activity fails
   */
  launchApp(
    app: string,
    className: string,
    extras?: Record<string, string | number | boolean>,
    onSuccess?: OnSuccessBool,
    onFail?: OnFail,
  ): void;

  /**
   * Launch an activity and hand it content URIs for one or more files.
   *
   * Combines `launchApp` (a chosen package and activity, so no system chooser
   * is shown) with `fileAction` (a `content://` URI the target may read), and
   * is more flexible than either:
   * - pass `app` + `className` to target one exact activity,
   * - pass only `app` to resolve the best matching activity in that package,
   * - pass neither to let the system pick a handler.
   *
   * Files are passed as the intent data and as `ClipData`, so the target can
   * read them through a normal `ContentResolver` stream.
   *
   * @param options Target, files and optional intent details
   * @param onSuccess Called with the content URIs and the resolved component
   * @param onFail Called with an error message if nothing could be launched
   *
   * @example
   * system.launchAppWithFile({
   *   app: "org.love2d.android",
   *   className: "org.love2d.android.GameActivity",
   *   fileUri: "file:///storage/emulated/0/Games/mygame.love",
   *   mimeType: "application/zip",
   * }, (result) => console.log(result.uris, result.component), (err) =>
   *   console.error(err));
   */
  launchAppWithFile(
    options: LaunchAppWithFileOptions,
    onSuccess?: (result: LaunchAppWithFileResult) => void,
    onFail?: OnFail,
  ): void;

  /**
   * Opens a link within the app
   * @param url Url to open
   * @param title Title of the page
   * @param showButtons Set to true to show buttons like console, open in browser, etc
   */
  inAppBrowser(url: string, title: string, showButtons: boolean): void;
  /**
   * Sets the color of status bar and navigation bar
   * @param systemBarColor Color of status bar and navigation bar
   * @param theme Theme as object
   * @param onSuccess Callback on success
   * @param onFail Callback on fail
   */
  setUiTheme(
    systemBarColor: string,
    theme: object,
    onSuccess: OnSuccessBool,
    onFail: OnFail,
  ): void;
  /**
   * Sets intent handler for the app
   * @param onSuccess
   * @param onFail
   */
  setIntentHandler(onSuccess: (intent: Intent) => void, onFail: OnFail): void;
  /**
   * Gets the launch intent
   * @param onSuccess
   * @param onFail
   */
  getCordovaIntent(onSuccess: (intent: Intent) => void, onFail: OnFail): void;
  getRewardStatus(
    onSuccess: (status: RewardStatus | string) => void,
    onFail: OnFail,
  ): void;
  redeemReward(
    offerId: string,
    onSuccess: (status: RewardStatus | string) => void,
    onFail: OnFail,
  ): void;
  /**
   * Enable/disable native WebView long-press context behavior.
   * Use this when rendering a custom editor context menu.
   * @param disabled
   * @param onSuccess
   * @param onFail
   */
  setNativeContextMenuDisabled(
    disabled: boolean,
    onSuccess?: () => void,
    onFail?: OnFail,
  ): void;
  /**
   * Perform an HTTP request and stream the response body to JavaScript.
   *
   * The response body is exposed as a WHATWG `ReadableStream` of `Uint8Array`
   * chunks. The native layer does not buffer the whole response and performs
   * no SSE/provider specific parsing. A 4xx/5xx status is a normal response;
   * only transport failures reject the promise. Cancelling the returned
   * stream's reader (or aborting `options.signal`) cancels the underlying
   * native HTTP request.
   *
   * @param url Request URL
   * @param options Request options
   * @returns A `Response` whose `body` is a `ReadableStream` of `Uint8Array` chunks
   */
  httpStream(url: string, options?: HttpStreamOptions): Promise<Response>;
  /*
   * Change the app icon at runtime.
   * @param iconName Icon id, e.g. "midnight_circuit", or "default" to restore the original icon
   * @param onSuccess
   * @param onFail
   */
  setAppIcon(iconName: string, onSuccess: OnSuccessBool, onFail: OnFail): void;
}

interface Window{
  system: System;
}
