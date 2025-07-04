# Cordova Plugin: OkHttp WebSocket

A Cordova plugin that uses [OkHttp](https://square.github.io/okhttp/) to provide WebSocket support in your Cordova app.
It aims to mimic the [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) in JavaScript, with additional features.

## Features

* ✅ WebSocket API-like interface
* ✅ Event support: `onopen`, `onmessage`, `onerror`, `onclose`
* ✅ `extensions` and `readyState` properties
* ✅ `listClients()` to list active connections
* ✅ Support for protocols
* ✅ Support for Custom Headers.
* ✅ Compatible with Cordova for Android

---

## Usage

### Import

```javascript
const WebSocketPlugin = cordova.websocket;
```

### Connect to WebSocket

```javascript
WebSocketPlugin.connect("wss://example.com/socket", ["protocol1", "protocol2"], headers)
  .then(ws => {
    ws.onopen = (e) => console.log("Connected!", e);
    ws.onmessage = (e) => console.log("Message:", e.data);
    ws.onerror = (e) => console.error("Error:", e);
    ws.onclose = (e) => console.log("Closed:", e);
    
    ws.send("Hello from Cordova!");
    ws.close();
  })
  .catch(err => console.error("WebSocket connection failed:", err));
```

---

## API Reference

### Methods

* `WebSocketPlugin.connect(url, protocols, headers, binaryType)`
    * Connects to a WebSocket server.
    * `url`: The WebSocket server URL.
    * `protocols`: (Optional) An array of subprotocol strings.
    * `headers`: (Optional) Custom headers as key-value pairs.
    * `binaryType`: (Optional) Initial binary type setting.
    * **Returns:** A Promise that resolves to a `WebSocketInstance`.

* `WebSocketPlugin.listClients()`
    * Lists all stored webSocket instance IDs.
    * **Returns:** `Promise` that resolves to an array of `instanceId` strings.

* `WebSocketPlugin.send(instanceId, message, binary)`
    * Sends a message to the server using an instance ID.
    * `instanceId`: The ID of the WebSocket instance.
    * `message`: The message to send (string or ArrayBuffer/ArrayBufferView).
    * `binary`: (Optional) Whether to send the message as binary, accepts `boolean`
    * **Returns:** `Promise` that resolves when the message is sent.

* `WebSocketPlugin.close(instanceId, code, reason)`
    * same as `WebSocketInstance.close(code, reason)` but needs `instanceId`.
    * **Returns:** `Promise` that resolves.

### WebSocketInstance Methods

* `WebSocketInstance.send(message, binary)`
    * Sends a message to the server.
    * `message`: The message to send (string or ArrayBuffer/ArrayBufferView).
    * `binary`: (Optional) Whether to send the message as binary. accepts `boolean`
    * Throws an error if the connection is not open.

* `WebSocketInstance.close(code, reason)`
    * Closes the connection.
    * `code`: (Optional) If unspecified, a close code for the connection is automatically set: to 1000 for a normal closure, or otherwise to [another standard value in the range 1001-1015](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1) that indicates the actual reason the connection was closed.
    * `reason`: A string providing a [custom WebSocket connection close reason](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.1.6) (a concise human-readable prose explanation for the closure). The value must be no longer than 123 bytes (encoded in UTF-8).

---

### Properties of `WebSocketInstance`

* `onopen`: Event listener for connection open.
* `onmessage`: Event listener for messages received.
* `onclose`: Event listener for connection close.
* `onerror`: Event listener for errors.
* `readyState`: (number) The state of the connection.
    * 0 (`CONNECTING`): Socket created, not yet open.
    * 1 (`OPEN`): Connection is open and ready.
    * 2 (`CLOSING`): Connection is closing.
    * 3 (`CLOSED`): Connection is closed or couldn't be opened.
* `extensions`: (string) Extensions negotiated by the server.
* `binaryType`: (string) Type of binary data to use ('arraybuffer' or '' (binary payload returned as strings.)).
* `url`: (string) The WebSocket server URL.
* `instanceId`: (string) Unique identifier for this WebSocket instance.

### Event Handling

`WebSocketInstance` extends `EventTarget`, providing standard event handling methods:

* `addEventListener(type, listener)`: Registers an event listener.
* `removeEventListener(type, listener)`: Removes an event listener.
* `dispatchEvent(event)`: Dispatches an event to the object.

Example of using event listeners:
```javascript
const ws = await WebSocketPlugin.connect("wss://example.com/socket");

// Using on* properties
ws.onmessage = (event) => console.log("Message:", event.data);

// Using addEventListener
ws.addEventListener('message', (event) => console.log("Message:", event.data));
```

### Constants

* `WebSocketInstance.CONNECTING`: 0
* `WebSocketInstance.OPEN`: 1
* `WebSocketInstance.CLOSING`: 2
* `WebSocketInstance.CLOSED`: 3

---

## Notes

* Only supported on Android (via OkHttp).
* Make sure to handle connection lifecycle properly (close sockets when done).
* `listClients()` is useful for debugging and management.
---