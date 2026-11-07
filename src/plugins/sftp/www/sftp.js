/**
 * SFTP and SSH for Cordova.
 *
 * Two call styles are supported:
 *
 *   // Promise, for new code
 *   const home = await sftp.testProfile(profileId, requestId, timeout);
 *
 *   // Callbacks, kept because the app's existing callers use them
 *   sftp.lsDir(path, onSuccess, onFail);
 *
 * Every method accepts either form. A method with callbacks returns nothing;
 * without them it returns a promise.
 */

const SERVICE = "Sftp";

/**
 * Invoke a native action, using callbacks when they are supplied and a promise
 * otherwise.
 *
 * @param {string} action native method name
 * @param {Array} args arguments, in the order the native side reads them
 * @param {Function} [onSuccess]
 * @param {Function} [onFail]
 * @returns {Promise|undefined}
 */
function invoke(action, args, onSuccess, onFail) {
  const callbacks = typeof onSuccess === "function" || typeof onFail === "function";

  if (callbacks) {
    cordova.exec(
      onSuccess || function () {},
      onFail || function () {},
      SERVICE,
      action,
      args
    );
    return;
  }

  return new Promise(function (resolve, reject) {
    cordova.exec(resolve, reject, SERVICE, action, args);
  });
}

module.exports = {
  /** Run a command on the connected server. */
  exec: function (command, onSuccess, onFail) {
    return invoke("exec", [command], onSuccess, onFail);
  },

  /**
   * Connect using stored credentials.
   * @param {string} profileId stored profile
   * @param {Function} [onSuccess]
   * @param {Function} [onFail]
   * @param {number} [timeout] milliseconds for the whole attempt
   */
  connectUsingProfile: function (profileId, onSuccess, onFail, timeout) {
    // The request id is an empty string, not null: the native side reads a
    // JSON null as the text "null", which would be used as a real request id.
    return invoke("connectUsingProfile", [profileId, "", timeout], onSuccess, onFail);
  },

  /**
   * Connect once and report the remote working directory.
   * @param {string} profileId stored profile
   * @param {string} requestId id used to cancel the attempt
   * @param {number} timeout milliseconds
   */
  testProfile: function (profileId, requestId, timeout, onSuccess, onFail) {
    return invoke("testProfile", [profileId, requestId, timeout], onSuccess, onFail);
  },

  /** Cancel an in-flight connection attempt. */
  cancelConnection: function (requestId, onSuccess, onFail) {
    return invoke("cancelConnection", [requestId], onSuccess, onFail);
  },

  /** Store credentials. Only used to import legacy credentials. */
  saveProfile: function (
    profileId,
    host,
    port,
    username,
    authType,
    password,
    keyFile,
    passphrase,
    onSuccess,
    onFail
  ) {
    // An empty string, not null: the native side reads a JSON null as the
    // text "null" and would reject it as an existing profile id.
    const id = profileId == null ? "" : profileId;
    return invoke(
      "saveProfile",
      [id, host, port, username, authType, password, keyFile, passphrase],
      onSuccess,
      onFail
    );
  },

  /**
   * Create or update a stored profile. Leave the password or key file empty to
   * keep the stored one.
   */
  editProfile: function (
    profileId,
    host,
    port,
    username,
    authType,
    password,
    keyFile,
    passphrase,
    onSuccess,
    onFail
  ) {
    return invoke(
      "editProfile",
      [profileId, host, port, username, authType, password, keyFile, passphrase],
      onSuccess,
      onFail
    );
  },

  /** Read a stored profile without its secrets. */
  getProfileInfo: function (profileId, onSuccess, onFail) {
    return invoke("getProfileInfo", [profileId], onSuccess, onFail);
  },

  /** Remove a stored profile and its credentials. */
  deleteProfile: function (profileId, onSuccess, onFail) {
    return invoke("deleteProfile", [profileId], onSuccess, onFail);
  },

  /** Download a remote file to a local path. Resolves with `{bytes}`. */
  getFile: function (filename, localFilename, onSuccess, onFail) {
    return invoke("getFile", [filename, localFilename], onSuccess, onFail);
  },

  /** Upload a local file to a remote path. Resolves with `{bytes}`. */
  putFile: function (filename, localFilename, onSuccess, onFail) {
    return invoke("putFile", [filename, localFilename], onSuccess, onFail);
  },

  /** List a directory. */
  lsDir: function (path, onSuccess, onFail) {
    return invoke("lsDir", [path], onSuccess, onFail);
  },

  /** Describe a path. `exists: false` when it is absent. */
  stat: function (path, onSuccess, onFail) {
    return invoke("stat", [path], onSuccess, onFail);
  },

  /** Create a directory. */
  mkdir: function (path, onSuccess, onFail) {
    return invoke("mkdir", [path], onSuccess, onFail);
  },

  /** Delete a file, or a directory when `recurse` is set. */
  rm: function (path, force, recurse, onSuccess, onFail) {
    return invoke("rm", [path, force, recurse], onSuccess, onFail);
  },

  /** Create a file, failing when it already exists. */
  createFile: function (path, content, onSuccess, onFail) {
    return invoke("createFile", [path, content], onSuccess, onFail);
  },

  /** Rename or move a path. */
  rename: function (oldpath, newpath, onSuccess, onFail) {
    return invoke("rename", [oldpath, newpath], onSuccess, onFail);
  },

  /** The remote working directory. */
  pwd: function (onSuccess, onFail) {
    return invoke("pwd", [], onSuccess, onFail);
  },

  /** Close the connection. */
  close: function (onSuccess, onFail) {
    return invoke("close", [], onSuccess, onFail);
  },

  /** The connected profile id, or 0 when disconnected. */
  isConnected: function (onSuccess, onFail) {
    return invoke("isConnected", [], onSuccess, onFail);
  },

  /** Open an interactive SSH shell, streaming events to `onEvent`. */
  openShellUsingProfile: function (profileId, cols, rows, onEvent, onFail) {
    return invoke("openShellUsingProfile", [profileId, cols, rows], onEvent, onFail);
  },

  /** Send input to a shell. */
  writeShell: function (sessionId, data, onSuccess, onFail) {
    return invoke("writeShell", [sessionId, data], onSuccess, onFail);
  },

  /** Resize a shell's terminal. */
  resizeShell: function (sessionId, cols, rows, onSuccess, onFail) {
    return invoke("resizeShell", [sessionId, cols, rows], onSuccess, onFail);
  },

  /** Close a shell. */
  closeShell: function (sessionId, onSuccess, onFail) {
    return invoke("closeShell", [sessionId], onSuccess, onFail);
  },

  /**
   * Answer a host key prompt.
   *
   * The plugin calls `window.__acodeSftpConfirm(request)` and the page replies
   * here once the person has decided.
   */
  resolveConfirmation: function (callbackId, confirmed, onSuccess, onFail) {
    return invoke("resolveConfirmation", [callbackId, confirmed], onSuccess, onFail);
  },

  /** Show a native message, for notices raised off the UI thread. */
  showToast: function (message, onSuccess, onFail) {
    return invoke("showToast", [message], onSuccess, onFail);
  },
};