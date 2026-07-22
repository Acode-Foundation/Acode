import nativeBridge from "../plugins/webview/www/webview";

let initialized = false;
const instances = new Map();
const eventCallbacks = new Map();

function ensureInit() {
  if (!initialized) {
    nativeBridge.setMessageCallback((payload) => {
      const { id, message, event, data } = payload;

      if (event) {
        const callbacks = eventCallbacks.get(id);
        if (callbacks) {
          callbacks.forEach((entry) => {
            if (entry.event === event) {
              try {
                entry.callback(event, data);
              } catch (e) {
                console.error("WebView event callback error:", e);
              }
            }
          });
        }
        return;
      }

      if (message !== undefined) {
        const instance = instances.get(id);
        if (instance && instance._messageCallbacks) {
          let parsed = message;
          try {
            parsed = JSON.parse(message);
          } catch (_) {}
          instance._messageCallbacks.forEach((cb) => {
            try {
              cb(parsed);
            } catch (e) {
              console.error("WebView message callback error:", e);
            }
          });
        }
      }
    });
    initialized = true;
  }
}

class WebView {
  constructor(id, options = {}) {
    this.id = id;
    this.options = options;
    this._messageCallbacks = [];
    this._eventCallbacks = [];
    this._destroyed = false;

    instances.set(id, this);
    eventCallbacks.set(id, this._eventCallbacks);
  }

  async loadURL(url) {
    this._checkDestroyed();
    await nativeBridge.loadURL(this.id, url);
  }

  async loadHTML(html) {
    this._checkDestroyed();
    await nativeBridge.loadHTML(this.id, html);
  }

  async evaluate(js) {
    this._checkDestroyed();
    return await nativeBridge.evaluate(this.id, js);
  }

  onMessage(callback) {
    this._checkDestroyed();
    if (typeof callback === "function") {
      this._messageCallbacks.push(callback);
    }
  }

  offMessage(callback) {
    this._messageCallbacks = this._messageCallbacks.filter(
      (cb) => cb !== callback,
    );
  }

  on(event, callback) {
    this._checkDestroyed();
    if (typeof callback === "function") {
      this._eventCallbacks.push({ event, callback });
    }
  }

  off(event, callback) {
    this._eventCallbacks = this._eventCallbacks.filter(
      (entry) => !(entry.event === event && entry.callback === callback),
    );
  }

  async postMessage(message) {
    this._checkDestroyed();
    await nativeBridge.postMessage(this.id, message);
  }

  async show() {
    this._checkDestroyed();
    await nativeBridge.show(this.id);
  }

  async hide() {
    this._checkDestroyed();
    await nativeBridge.hide(this.id);
  }

  async reload() {
    this._checkDestroyed();
    await nativeBridge.reload(this.id);
  }

  async destroy() {
    this._checkDestroyed();
    this._destroyed = true;
    await nativeBridge.destroy(this.id);
    instances.delete(this.id);
    eventCallbacks.delete(this.id);
    this._messageCallbacks = [];
    this._eventCallbacks = [];
  }

  _checkDestroyed() {
    if (this._destroyed) {
      throw new Error("WebView has been destroyed");
    }
  }
}

const webviewAPI = {
  async create(options = {}) {
    ensureInit();

    const id = await nativeBridge.create({
      title: options.title || "",
      mode: options.mode || "hidden",
      width: options.width || 0,
      height: options.height || 0,
      x: options.x || 0,
      y: options.y || 0,
      allowNavigation: options.allowNavigation !== false,
      allowDownloads: options.allowDownloads === true,
      visible: options.visible !== false,
    });

    return new WebView(id, options);
  },
};

export default webviewAPI;
