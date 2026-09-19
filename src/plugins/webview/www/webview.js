const SERVICE = "AcodeWebView";

let messageCallback = null;

function setMessageCallback(callback) {
  messageCallback = callback;
  cordova.exec(
    (payload) => {
      if (messageCallback) {
        messageCallback(payload);
      }
    },
    (error) => {
      console.error("WebView message callback error:", error);
    },
    SERVICE,
    "setMessageCallback",
    []
  );
}

function create(options) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "create", [options || {}]);
  });
}

function loadURL(id, url) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "loadURL", [id, url]);
  });
}

function loadHTML(id, html) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "loadHTML", [id, html]);
  });
}

function evaluate(id, js) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "evaluate", [id, js]);
  });
}

function postMessage(id, message) {
  return new Promise((resolve, reject) => {
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    cordova.exec(resolve, reject, SERVICE, "postMessage", [id, payload]);
  });
}

function show(id) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "show", [id]);
  });
}

function hide(id) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "hide", [id]);
  });
}

function reload(id) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "reload", [id]);
  });
}

function destroy(id) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "destroy", [id]);
  });
}

/**
 * Overrides the User-Agent for an existing WebView instance.
 * @param {string} id
 * @param {string} userAgent non-empty User-Agent string
 */
function setUserAgent(id, userAgent) {
  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, SERVICE, "setUserAgent", [id, userAgent]);
  });
}

/**
 * create() options:
 *   mode            "hidden" | "fullscreen" (default "hidden")
 *   title           string (default "")
 *   allowNavigation boolean (default true)
 *   allowDownloads  boolean (default false)
 *   visible         boolean (default true)
 *   incognito       boolean (default true) — never serve from the HTTP cache;
 *                   clears navigation history and form data on destroy.
 *                   Cookies stay shared with the host app (platform limit).
 *   userAgent       string (optional) — custom User-Agent for the instance
 *
 * Events delivered via setMessageCallback payloads ({ id, event, data }):
 *   pageStarted     { url }
 *   pageFinished    { url, title }
 *   progressChanged { progress }            // 0..100
 *   loadError       { url, code, description }
 *   titleChanged    { title }
 */

export default {
  setMessageCallback,
  create,
  loadURL,
  loadHTML,
  evaluate,
  postMessage,
  show,
  hide,
  reload,
  destroy,
  setUserAgent,
};
