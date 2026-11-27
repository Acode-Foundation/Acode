package com.foxdebug.acode.websocket;

import android.util.Base64;
import android.util.Log;

import androidx.annotation.NonNull;

import com.foxdebug.acode.runtime.*;
import com.foxdebug.acode.runtime.Callback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.ArrayDeque;
import java.util.concurrent.TimeUnit;

import okhttp3.*;

import okio.ByteString;

public class WebSocketInstance extends WebSocketListener {
    private static final String TAG = "WebSocketInstance";
    private static final int DEFAULT_CLOSE_CODE = 1000;
    private static final String DEFAULT_CLOSE_REASON = "Normal closure";

    private WebSocket webSocket;
    private Callback callbackContext;
    private final ArrayDeque<Payload> pendingEvents = new ArrayDeque<>();
    private final Host host;
    private final String instanceId;
    private String extensions = "";
    private String protocol = "";
    private String binaryType = "";
    private int readyState = 0; // CONNECTING

    // okHttpMainClient parameter is used. To have a single main client(singleton), with per-websocket configuration using newBuilder method.
    public WebSocketInstance(String url, JSONArray protocols, JSONObject headers, String binaryType, OkHttpClient okHttpMainClient, Host host, String instanceId) {
        this(url, protocols, headers, binaryType, (WebSocket.Factory) okHttpMainClient.newBuilder()
                .connectTimeout(10, TimeUnit.SECONDS).build(), host, instanceId);
    }

    WebSocketInstance(String url, JSONArray protocols, JSONObject headers, String binaryType, WebSocket.Factory client, Host host, String instanceId) {
        this.host = host;
        this.instanceId = instanceId;
        this.binaryType = binaryType;

        Request.Builder requestBuilder = new Request.Builder().url(url);

        // custom headers support.
        if (headers != null) {
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headers.optString(key);
                requestBuilder.addHeader(key, value);
            }
        }

        // adds Sec-WebSocket-Protocol header if protocols is present.
        if (protocols != null) {
            StringBuilder protocolHeader = new StringBuilder();
            for (int i = 0; i < protocols.length(); i++) {
                protocolHeader.append(protocols.optString(i)).append(",");
            }
            if (protocolHeader.length() > 0) {
                protocolHeader.setLength(protocolHeader.length() - 1);
                requestBuilder.addHeader("Sec-WebSocket-Protocol", protocolHeader.toString());
            }
        }

        client.newWebSocket(requestBuilder.build(), this);
    }

    public synchronized void setCallback(Callback callbackContext) {
        this.callbackContext = callbackContext;
        Payload result = new Payload(Payload.Status.NO_RESULT);
        result.setKeepCallback(true);
        callbackContext.sendPayload(result);
        while (!pendingEvents.isEmpty()) callbackContext.sendPayload(pendingEvents.removeFirst());
        if (readyState == 3) WebSocketPlugin.removeInstance(instanceId);
    }

    public void send(String message, boolean isBinary) {
        if (this.webSocket != null) {
            Log.d(TAG, "websocket instanceId=" + this.instanceId + " received send(..., isBinary=" + isBinary + ") action call, sending message=" + message);
            if(isBinary) {
                this.sendBinary(message);
                return;
            }
            this.webSocket.send(message);
        } else {
            Log.d(TAG, "websocket instanceId=" + this.instanceId + " received send(..., isBinary=" + isBinary + ")  ignoring... as webSocket is null (not present/connected)");
        }
    }

    /**
     * Sends bytes as the data of a binary (type 0x2) message.
     * @param base64Data Binary Data received from JS bridge encoded as base64 String
     */
    private void sendBinary(String base64Data) {
        byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
        this.webSocket.send(ByteString.of(data));
    }

    public String close(int code, String reason) {
        if (this.webSocket != null) {
            this.readyState = 2; // CLOSING
            try {
                boolean result = this.webSocket.close(code, reason);
                Log.d(TAG, "websocket instanceId=" + this.instanceId + " received close() action call, code=" + code + " reason=" + reason + " close method result: " + result);

                // if a graceful shutdown was already underway...
                // or if the web socket is already closed or canceled. do nothing.
                if(!result) {
                    return null;
                }
            } catch (Exception e) {
                return e.getMessage();
            }

            return null;
        } else {
            Log.d(TAG, "websocket instanceId=" + this.instanceId + " received close() action call, ignoring... as webSocket is null (not present)");
            // TODO: finding a better way of telling it wasn't successful.
            return "";
        }
    }

    public String close() {
        Log.d(TAG, "WebSocket instanceId=" + this.instanceId + " close() called with no arguments. Using defaults.");
        // Calls the more specific version with default values
        return close(DEFAULT_CLOSE_CODE, DEFAULT_CLOSE_REASON);
    }

    @Override
    public void onOpen(@NonNull WebSocket webSocket, Response response) {
        this.webSocket = webSocket;
        this.readyState = 1; // OPEN
        this.extensions = response.headers("Sec-WebSocket-Extensions").toString();
        this.protocol = response.header("Sec-WebSocket-Protocol");
        Log.i(TAG, "websocket instanceId=" + this.instanceId + " Opened" + "received extensions=" + this.extensions);
        sendEvent("open", null, false, false);
    }

    @Override
    public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
        Log.d(TAG, "websocket instanceId=" + this.instanceId +  " Received message: " + text);
        sendEvent("message", text, false, false);
    }

    // This is called when the Websocket server sends a binary(type 0x2) message.
    @Override
    public void onMessage(@NonNull WebSocket webSocket, @NonNull ByteString bytes) {
        Log.d(TAG, "websocket instanceId=" + this.instanceId +  " Received message(bytes/binary payload): " + bytes.toString());

        try {
            if ("arraybuffer".equals(this.binaryType)) {
                String base64 = bytes.base64();
                sendEvent("message", base64, true, false);
            } else {
                sendEvent("message", bytes.utf8(), true, true);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending message", e);
        }

    }

    @Override
    public void onClosing(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
        this.readyState = 2; // CLOSING
        Log.i(TAG, "websocket instanceId=" + this.instanceId + " is Closing code: " + code + " reason: " + reason);
        this.webSocket.close(code, reason);
    }

    @Override
    public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
        this.readyState = 3; // CLOSED
        Log.i(TAG, "websocket instanceId=" + this.instanceId + " Closed code: " + code + " reason: " + reason);
        JSONObject closedEvent = new JSONObject();
        try {
            closedEvent.put("code", code);
            closedEvent.put("reason", reason);
        } catch (JSONException e) {
            Log.e(TAG, "Error creating close event", e);
        }
        sendEvent("close", closedEvent.toString(), false, false);
    }

    @Override
    public void onFailure(@NonNull WebSocket webSocket, Throwable t, Response response) {
        this.readyState = 3; // CLOSED
        sendEvent("error", t.getMessage(), false, false);
        Log.e(TAG, "websocket instanceId=" + this.instanceId + " Error: " + t.getMessage());
    }

    public void setBinaryType(String binaryType) {
        this.binaryType = binaryType;
    }

    private synchronized void sendEvent(String type, String data, boolean isBinary, boolean parseAsText) {
        try {
            JSONObject event = new JSONObject();
            event.put("type", type);
            event.put("extensions", this.extensions);
            event.put("readyState", this.readyState);
            event.put("isBinary", isBinary);
            event.put("parseAsText", parseAsText);
            if (data != null) event.put("data", data);
            Log.d(TAG, "sending event: " + type + " eventObj " + event.toString());
            Payload result = new Payload(Payload.Status.OK, event);
            result.setKeepCallback(readyState != 3);
            // The connection can open before JS receives its ID and registers a listener.
            if (callbackContext == null) pendingEvents.addLast(result);
            else {
                callbackContext.sendPayload(result);
                if (readyState == 3) WebSocketPlugin.removeInstance(instanceId);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending event", e);
        }
    }
}
