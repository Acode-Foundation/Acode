var exec = require('cordova/exec');

class WebSocketInstance {
    constructor(url, instanceId) {
        this.instanceId = instanceId;
        this.extensions = '';
        this.readyState = WebSocketInstance.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        this.url = url;

        exec((event) => {
            if (event.type === 'open') {
                this.readyState = WebSocketInstance.OPEN;
                this.extensions = event.extensions || '';
                if (this.onopen) this.onopen.bind(this)(event);
            }
            if (event.type === 'message' && this.onmessage) this.onmessage.bind(this)(event);
            if (event.type === 'close') {
                this.readyState = WebSocketInstance.CLOSED;
                if (this.onclose) this.onclose.bind(this)(event);
            }
            if (event.type === 'error' && this.onerror) this.onerror.bind(this)(event);
        }, null, "WebSocketPlugin", "registerListener", [this.instanceId]);
    }

    send(message) {
        if (this.readyState === WebSocketInstance.OPEN) {
            exec(null, null, "WebSocketPlugin", "send", [this.instanceId, message]);
        } else {
            throw new Error("WebSocket is not open");
        }
    }

    /**
     * Closes the WebSocket connection.
     *
     * @param {number} code The status code explaining why the connection is being closed.
     * @param {string} reason A human-readable string explaining why the connection is being closed.
     */
    close(code, reason) {
        this.readyState = WebSocketInstance.CLOSING;
        exec(null, null, "WebSocketPlugin", "close", [this.instanceId, code, reason]);
    }
}

WebSocketInstance.CONNECTING = 0;
WebSocketInstance.OPEN = 1;
WebSocketInstance.CLOSING = 2;
WebSocketInstance.CLOSED = 3;

const connect = function(url, protocols = null, headers = null) {
    return new Promise((resolve, reject) => {
        exec(instanceId => resolve(new WebSocketInstance(url, instanceId)), reject, "WebSocketPlugin", "connect", [url, protocols, headers]);
    });
};

const listClients = function() {
    return new Promise((resolve, reject) => {
        exec(resolve, reject, "WebSocketPlugin", "listClients", []);
    });
};

/** Utility functions, in-case you lost the websocketInstance returned from the connect function */

const send = function(instanceId, message) {
    return new Promise((resolve, reject) => {
        exec(resolve, reject, "WebSocketPlugin", "send", [instanceId, message]);
    });
};

/**
 * Closes the WebSocket connection.
 *
 * @param {string} instanceId The ID of the WebSocketInstance to close.
 * @param {number} [code] (optional) The status code explaining why the connection is being closed.
 * @param {string} [reason] (optional) A human-readable string explaining why the connection is being closed.
 *
 * @returns {Promise} A promise that resolves when the close operation has completed.
 */
const close = function(instanceId, code, reason) {
    return new Promise((resolve, reject) => {
        exec(resolve, reject, "WebSocketPlugin", "close", [instanceId, code, reason]);
    });
};

module.exports = { connect, listClients, send, close };
