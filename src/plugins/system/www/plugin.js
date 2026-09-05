module.exports = {
  isManageExternalStorageDeclared: function (success, error) {
    cordova.exec(success, error, 'System', 'isManageExternalStorageDeclared', []);
  },
  hasGrantedStorageManager: function (success, error) {
    cordova.exec(success, error, 'System', 'hasGrantedStorageManager', []);
  },
  requestStorageManager: function (success, error) {
    cordova.exec(success, error, 'System', 'requestStorageManager', []);
  },
  copyToUri: function (srcUri, destUri, fileName, success, error) {
    cordova.exec(success, error, 'System', 'copyToUri', [srcUri, destUri, fileName]);
  },
  fileExists: function (path, countSymlinks, success, error) {
    cordova.exec(success, error, 'System', 'fileExists', [path, String(countSymlinks)]);
  },

  createSymlink: function (target, linkPath, success, error) {
    cordova.exec(success, error, 'System', 'createSymlink', [target, linkPath]);
  },
  writeText: function (path, content, success, error) {
    cordova.exec(success, error, 'System', 'writeText', [path, content]);
  },
  deleteFile: function (path, success, error) {
    cordova.exec(success, error, 'System', 'deleteFile', [path]);
  },
  setExec: function (path, executable, success, error) {
    cordova.exec(success, error, 'System', 'setExec', [path, String(executable)]);
  },
  getInstaller: function (success, error) {
    cordova.exec(success, error, 'System', 'getInstaller', []);
  },
  shareText: function (text, success, error) {
    cordova.exec(success, error, 'System', 'shareText', [text]);
  },
  getNativeLibraryPath: function (success, error) {
    cordova.exec(success, error, 'System', 'getNativeLibraryPath', []);
  },


  getNativeLibraryPath: function (success, error) {
    cordova.exec(success, error, 'System', 'getNativeLibraryPath', []);
  },

  getFilesDir: function (success, error) {
    cordova.exec(success, error, 'System', 'getFilesDir', []);
  },
  getRewardStatus: function (success, error) {
    cordova.exec(success, error, 'System', 'getRewardStatus', []);
  },
  redeemReward: function (offerId, success, error) {
    cordova.exec(success, error, 'System', 'redeemReward', [offerId]);
  },
  extractAsset: function (assetName, destinationPath, success, error) {
    cordova.exec(success, error, 'System', 'extractAsset', [assetName, destinationPath]);
  },

  getParentPath: function (path, success, error) {
    cordova.exec(success, error, 'System', 'getParentPath', [path]);
  },

  listChildren: function (path, success, error) {
    cordova.exec(success, error, 'System', 'listChildren', [path]);
  },
  mkdirs: function (path, success, error) {
    cordova.exec(success, error, 'System', 'mkdirs', [path]);
  },
  getArch: function (success, error) {
    cordova.exec(success, error, 'System', 'getArch', []);
  },

  clearCache: function (success, fail) {
    return cordova.exec(success, fail, "System", "clearCache", []);
  },
  getWebviewInfo: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'get-webkit-info', []);
  },
  isPowerSaveMode: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'is-powersave-mode', []);
  },
  fileAction: function (fileUri, filename, action, mimeType, onFail) {
    if (typeof action !== 'string') {
      onFail = action || function () { };
      action = filename;
      filename = '';
    } else if (typeof mimeType !== 'string') {
      onFail = mimeType || function () { };
      mimeType = action;
      action = filename;
      filename = '';
    } else if (typeof onFail !== 'function') {
      onFail = function () { };
    }

    action = "android.intent.action." + action;
    cordova.exec(function () { }, onFail, 'System', 'file-action', [fileUri, filename, action, mimeType]);
  },
  getAppInfo: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'get-app-info', []);
  },
  addShortcut: function (shortcut, onSuccess, onFail) {
    var id, label, description, icon, data;
    id = shortcut.id;
    label = shortcut.label;
    description = shortcut.description;
    icon = shortcut.icon;
    data = shortcut.data;
    action = shortcut.action;
    cordova.exec(onSuccess, onFail, 'System', 'add-shortcut', [id, label, description, icon, action, data]);
  },
  removeShortcut: function (id, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'remove-shortcut', [id]);
  },
  pinShortcut: function (id, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'pin-shortcut', [id]);
  },
  pinFileShortcut: function (shortcut, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'pin-file-shortcut', [shortcut]);
  },
  manageAllFiles: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'manage-all-files', []);
  },
  getAndroidVersion: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'get-android-version', []);
  },
  isExternalStorageManager: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'is-external-storage-manager', []);
  },
  requestPermission: function (permission, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'request-permission', [permission]);
  },
  requestPermissions: function (permissions, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'request-permissions', [permissions]);
  },
  hasPermission: function (permission, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'has-permission', [permission]);
  },
  openInBrowser: function (src) {
    cordova.exec(null, null, 'System', 'open-in-browser', [src]);
  },
  /**
   * Launch an Android application activity.
   *
   * @param {string} app - Package name of the application (e.g. `com.example.app`).
   * @param {string} className - Fully qualified activity class name (e.g. `com.example.app.MainActivity`).
   * @param {Object<string, (string|number|boolean)>} [extras] - Optional key-value pairs passed as Intent extras.
   * @param {(message: string) => void} [onSuccess] - Callback invoked when the activity launches successfully.
   * @param {(error: any) => void} [onFail] - Callback invoked if launching the activity fails.
   *
   * @example
   * System.launchApp(
   *   "com.example.app",
   *   "com.example.app.MainActivity",
   *   {
   *     user: "example",
   *     age: 20,
   *     premium: true
   *   },
   *   (msg) => console.log(msg),
   *   (err) => console.error(err)
   * );
   */
  launchApp: function (app, className, extras, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'launch-app', [app, className, extras]);
  },
  inAppBrowser: function (url, title, showButtons, disableCache) {
    var myInAppBrowser = {
      onOpenExternalBrowser: null,
      onError: null,
    };

    cordova.exec(function (data) {
      if (typeof data !== 'string') {
        console.warn('System.inAppBrowser: invalid callback payload', data);
        return;
      }
      var separatorIndex = data.indexOf(':');
      if (separatorIndex < 0) {
        console.warn('System.inAppBrowser: malformed callback payload', data);
        return;
      }
      var dataTag = data.slice(0, separatorIndex);
      var dataUrl = data.slice(separatorIndex + 1);
      if (dataTag === 'onOpenExternalBrowser') {
        if (typeof myInAppBrowser.onOpenExternalBrowser === 'function') {
          myInAppBrowser.onOpenExternalBrowser(dataUrl);
        } else {
          console.warn('System.inAppBrowser: onOpenExternalBrowser handler is not set');
        }
      }
    }, function (err) {
      if (typeof myInAppBrowser.onError === 'function') {
        myInAppBrowser.onError(err);
        return;
      }
      console.warn('System.inAppBrowser error callback not handled', err);
    }, 'System', 'in-app-browser', [url, title, !!showButtons, disableCache]);
    return myInAppBrowser;
  },
  setUiTheme: function (systemBarColor, theme, onSuccess, onFail) {
    const color = systemBarColor.toLowerCase();

    if (color === '#ffffff' || color === '#ffffffff') {
      systemBarColor = '#fffffe';
    }

    cordova.exec((out) => {
      window.statusbar.setBackgroundColor(systemBarColor);

      if (typeof onSuccess === "function") {
        onSuccess(out);
      }

    }, onFail, 'System', 'set-ui-theme', [systemBarColor, theme]);
  },
  setIntentHandler: function (handler, onerror) {
    cordova.exec(handler, onerror, 'System', 'set-intent-handler', []);
  },
  getCordovaIntent: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'get-cordova-intent', []);
  },
  setInputType: function (type, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'set-input-type', [type]);
  },
  setNativeContextMenuDisabled: function (disabled, onSuccess, onFail) {
    cordova.exec(
      onSuccess,
      onFail,
      'System',
      'set-native-context-menu-disabled',
      [String(!!disabled)]
    );
  },
  getGlobalSetting: function (key, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'System', 'get-global-setting', [key]);
  },
  /**
   * Compare file content with provided text in a background thread.
   * @param {string} fileUri - The URI of the file to read
   * @param {string} encoding - The character encoding to use
   * @param {string} currentText - The text to compare against
   * @returns {Promise<boolean>} - Resolves to true if content differs, false if same
   */
  compareFileText: function (fileUri, encoding, currentText) {
    return new Promise((resolve, reject) => {
      cordova.exec(
        function(result) {
          resolve(result === 1);
        },
        reject,
        'System',
        'compare-file-text',
        [fileUri, encoding, currentText]
      );
    });
  },
  /**
   * Compare two text strings in a background thread.
   * @param {string} text1 - First text to compare
   * @param {string} text2 - Second text to compare
   * @returns {Promise<boolean>} - Resolves to true if texts differ, false if same
   */
  compareTexts: function (text1, text2) {
    return new Promise((resolve, reject) => {
      cordova.exec(
        function(result) {
          resolve(result === 1);
        },
        reject,
        'System',
        'compare-texts',
        [text1, text2]
      );
    });
  },
  /**
   * Make an HTTP request and receive the response body as a WHATWG
   * `ReadableStream` of `Uint8Array` chunks, as bytes arrive from the server.
   *
   * The native layer does not buffer the whole response and performs no SSE /
   * provider specific parsing; it simply forwards raw byte chunks. Chunk
   * boundaries are arbitrary and may split multi-byte UTF-8 characters or SSE
   * frames. The consumer is responsible for decoding / parsing the stream.
   *
   * @param {string} url - Request URL
   * @param {Object} [options]
   * @param {string} [options.method="GET"] - HTTP method
   * @param {Object<string,string>} [options.headers] - Request headers
   * @param {string} [options.body] - Request body. Sent as UTF-8 text unless
   *   `bodyIsBase64` is set, in which case it is decoded from base64.
   * @param {boolean} [options.bodyIsBase64=false]
   * @param {boolean} [options.followRedirects=true]
   * @param {number} [options.connectTimeout=30000] - Connect timeout in ms
   * @param {number} [options.readTimeout=0] - Read timeout in ms (0 = none)
   * @param {number} [options.chunkSize=8192] - Requested native chunk size in bytes
   * @returns {Promise<Response>} Resolves with a `Response` whose `body` is a
   *   `ReadableStream` delivering `Uint8Array` chunks. A 4xx/5xx HTTP status
   *   is a normal response (not a rejected promise); only transport failures
   *   reject. Cancelling the returned stream's reader cancels the underlying
   *   native HTTP request.
   */
  httpStream: function (url, options) {
    options = options || {};

    return new Promise(function (resolve, reject) {
      var requestId = "httpStream_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      var controller = null;
      var headersReceived = false;
      var paused = false;
      var terminal = false;

      var stream = new ReadableStream({
        start: function (c) {
          controller = c;
        },
        pull: function () {
          if (paused && !terminal) {
            paused = false;
            cordova.exec(null, null, 'System', 'http-stream-resume', [requestId]);
          }
        },
        cancel: function () {
          cordova.exec(null, null, 'System', 'http-stream-cancel', [requestId]);
        }
      }, {
        highWaterMark: 65536,
        size: function (chunk) {
          return chunk.byteLength;
        }
      });

      function fail(err) {
        if (terminal) return;
        terminal = true;
        if (headersReceived && controller) {
          controller.error(err);
        } else {
          reject(err);
        }
      }

      cordova.exec(
        function (event) {
          if (!event || typeof event !== 'object' || terminal) return;

          switch (event.type) {
            case 'headers': {
              headersReceived = true;
              var status = event.status;
              var cannotHaveBody = status === 204 || status === 205 || status === 304;
              var response;
              if (cannotHaveBody) {
                response = new Response(null, {
                  status: status,
                  statusText: event.statusText || '',
                  headers: new Headers(event.headers || {})
                });
              } else {
                response = new Response(stream, {
                  status: status,
                  statusText: event.statusText || '',
                  headers: new Headers(event.headers || {})
                });
              }
              if (event.url) {
                Object.defineProperty(response, 'url', { value: event.url, configurable: true });
              }
              resolve(response);
              break;
            }
            case 'data': {
              if (controller && event.chunk) {
                controller.enqueue(base64ToBytes(event.chunk));
                var desired = controller.desiredSize;
                if (desired !== null && desired < 0 && !paused) {
                  paused = true;
                  cordova.exec(null, null, 'System', 'http-stream-pause', [requestId]);
                }
              }
              break;
            }
            case 'complete': {
              terminal = true;
              if (controller) controller.close();
              break;
            }
            case 'error': {
              fail(new Error(event.message || 'Stream failed'));
              break;
            }
          }
        },
        function (err) {
          fail(typeof err === 'string' ? new Error(err) : err);
        },
        'System',
        'http-stream-start',
        [requestId, url, options]
      );
    });
  }
};

function base64ToBytes(base64) {
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
