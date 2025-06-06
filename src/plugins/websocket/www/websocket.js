var exec = require('cordova/exec');
/**
 * Whether to log debug messages
 */
let DEBUG = false;

const logIfDebug = (...args) => {
    console.log("DEBUG flag -> ", cordova.websocket.DEBUG)
    if (cordova.websocket.DEBUG) {
        console.log(...args);
    }
};

class WebSocketInstance extends EventTarget {
    constructor(url, instanceId, binaryType) {
        super();
        this.instanceId = instanceId;
        this.extensions = '';
        this.readyState = WebSocketInstance.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        this.url = url;
        // NOTE: blob is not supported currently.
        this._binaryType = binaryType ? binaryType : ''; // empty as Default is string (Same Plugins might require this behavior)

        exec((event) => {
            logIfDebug(`[Cordova WebSocket - ID=${this.instanceId}] Event from native:`, event);

            if (event.type === 'open') {
                this.readyState = WebSocketInstance.OPEN;
                this.extensions = event.extensions || '';
                if (this.onopen) this.onopen(event);
                this.dispatchEvent(new Event('open'));
            }

            if (event.type === 'message') {
                let msgData = event.data;
                // parseAsText solely takes care of the state of binaryType,
                // sometimes, syncing binaryType to Java side might take longer. it's there to not wrongly pass normal string as base64.
                if (event.isBinary && this.binaryType === 'arraybuffer' && !event.parseAsText) {
                    let binary = atob(msgData);
                    let bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    msgData = bytes.buffer;
                }
                logIfDebug(`[Cordova WebSocket - ID=${this.instanceId}] msg Event:`, event, msgData);
                const msgEvent = new MessageEvent('message', { data: msgData  });

                Object.defineProperty(msgEvent, "binary", { enumerable: true, value: event.isBinary })

                if (this.onmessage) this.onmessage(msgEvent);
                this.dispatchEvent(msgEvent);
            }

            if (event.type === 'close') {
                this.readyState = WebSocketInstance.CLOSED;
                const closeEvent = new CloseEvent('close', { code: event.data?.code, reason: event.data?.reason });
                if (this.onclose) this.onclose(closeEvent);
                this.dispatchEvent(closeEvent);
            }

            if (event.type === 'error') {
                const errorEvent = new Event('error', { message: event?.data });
                if (this.onerror) this.onerror(errorEvent);
                this.dispatchEvent(errorEvent);
            }
        }, null, "WebSocketPlugin", "registerListener", [this.instanceId]);
    }

    get binaryType() {
        return this._binaryType || '';
    }
    
    set binaryType(type) {
        // blob isn't supported but checked as browser compatibility, & it default to empty string
        if (type === 'blob' || type === 'arraybuffer' || type === '') {
            this._binaryType = type !== 'blob' ? type : '';

            exec(null, null, "WebSocketPlugin", "setBinaryType", [this.instanceId, type]);
        } else {
            console.warn('Invalid binaryType, expected "blob" or "arraybuffer"');
        }
    }


    send(message, binary) {
        if (this.readyState !== WebSocketInstance.OPEN) {
            throw new Error(`WebSocket is not open/connected`);
        }

        let finalMessage = null;
        if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
            const uint8Array = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
            finalMessage = btoa(String.fromCharCode.apply(null, uint8Array));

            // set to true as it's the data of a binary (type 0x2) message.
            binary = true;

            exec(() => logIfDebug(`[Cordova WebSocket - ID=${this.instanceId}] Sent message(binary payload):`, finalMessage), (err) => console.error(`[Cordova WebSocket - ID=${this.instanceId}] Send error:`, err), "WebSocketPlugin", "send", [this.instanceId, finalMessage, binary]);
        } else if (typeof message === 'string') {
            finalMessage = message;
            
            // maybe a String to be sent as Binary (if it's true)
            if(binary) finalMessage = btoa(message)

            exec(() => logIfDebug(`[Cordova WebSocket - ID=${this.instanceId}] Sent message(binary=${binary}):`, finalMessage), (err) => console.error(`[Cordova WebSocket - ID=${this.instanceId}] Send error:`, err), "WebSocketPlugin", "send", [this.instanceId, finalMessage, binary]);
        } else {
            throw new Error(`Unsupported message type: ${typeof message}`);
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
        exec(() => logIfDebug(`[Cordova WebSocket - ID=${this.instanceId}] Close requested`, code, reason), (err) => console.error(`[Cordova WebSocket - ID=${this.instanceId}] Close error`, err), "WebSocketPlugin", "close", [this.instanceId, code, reason]);
    }
}

WebSocketInstance.CONNECTING = 0;
WebSocketInstance.OPEN = 1;
WebSocketInstance.CLOSING = 2;
WebSocketInstance.CLOSED = 3;

const connect = function(url, protocols = null, headers = null, binaryType) {
    return new Promise((resolve, reject) => {
        exec(instanceId => resolve(new WebSocketInstance(url, instanceId)), reject, "WebSocketPlugin", "connect", [url, protocols, binaryType, headers]);
    });
};

const listClients = function() {
    return new Promise((resolve, reject) => {
        exec(resolve, reject, "WebSocketPlugin", "listClients", []);
    });
};

/** Utility functions, in-case you lost the websocketInstance returned from the connect function */

const send = function(instanceId, message, binary) {
    return new Promise((resolve, reject) => {
        if (typeof message === 'string') {
            
            if(binary) message = btoa(message);

            exec(resolve, reject, "WebSocketPlugin", "send", [instanceId, message, binary]);
        } else if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
            const uint8Array = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
            const base64Message = btoa(String.fromCharCode.apply(null, uint8Array));
            
            exec(resolve, reject, "WebSocketPlugin", "send", [instanceId, base64Message, true]);
        } else {
            reject(`Unsupported message type: ${typeof message}`);
        }
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

module.exports = { connect, listClients, send, close, DEBUG };
