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

interface Intent {
  action: string;
  data: string;
  type: string;
  package: string;
  extras: {
    [key: string]: any;
  };
}

type FileAction = 'VIEW' | 'EDIT' | 'SEND' | 'RUN';
type OnFail = (err: string) => void;
type OnSuccessBool = (res: boolean) => void;

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
   * Launches and app
   * @param app the package name of the app
   * @param className the full class name of the activity
   * @param data Data to pass to the app
   * @param onSuccess
   * @param onFail
   */
  launchApp(
    app: string,
    className: string,
    data: string,
    onSuccess: OnSuccessBool,
    onFail: OnFail,
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
}

interface Window{
  system: System;
}
