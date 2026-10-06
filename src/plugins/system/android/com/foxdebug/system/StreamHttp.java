package com.foxdebug.system;

import android.util.Base64;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Incrementally streams an HTTP response body to JavaScript.
 *
 * <p>The request runs on a dedicated background thread (never the UI thread).
 * Response bytes are forwarded to the bridge as they arrive. To survive the
 * JSON bridge without a base64 round trip, chunks are sent as raw bytes mapped
 * onto ISO-8859-1 characters (byte n == code point n), which the JSON bridge
 * round-trips losslessly; only chunks containing control bytes (&lt; 0x20,
 * which JSON must escape) fall back to base64. The native layer performs no
 * SSE/LLM specific parsing: chunk boundaries are arbitrary and may split
 * multi-byte UTF-8 characters or SSE frames.
 *
 * <p>Events emitted to JS (JSON object with a {@code type} field):
 * <ul>
 *   <li>{@code headers} - status, statusText, url and response headers</li>
 *   <li>{@code data} - a byte chunk (raw ISO-8859-1 string, or base64 when the
 *     {@code b64} flag is set)</li>
 *   <li>{@code complete} - response body finished (terminal)</li>
 *   <li>{@code error} - transport failure (terminal)</li>
 * </ul>
 *
 * <p>Exactly one terminal event ({@code complete} or {@code error}) is ever
 * emitted per stream. 4xx/5xx HTTP statuses are still delivered as a normal
 * {@code headers} + body stream and remain distinguishable from network
 * failures.
 */
public class StreamHttp implements Runnable {

  private static final String TAG = "SystemStreamHttp";
  private static final int DEFAULT_CHUNK_SIZE = 32 * 1024;
  private static final int MAX_CHUNK_SIZE = 100 * 1024;

  private static final int MAX_CONCURRENT_STREAMS = 50;

  private static final int CREDIT_WINDOW_BYTES = 256 * 1024;

  private static final ConcurrentHashMap<String, StreamHttp> STREAMS = new ConcurrentHashMap<>();

  private final String requestId;
  private final String url;
  private final String method;
  private final JSONObject headers;
  private final String body;
  private final boolean bodyIsBase64;
  private final boolean followRedirects;
  private final int connectTimeout;
  private final int readTimeout;
  private final int chunkSize;
  private final CallbackContext callback;

  private final Object creditLock = new Object();
  private volatile boolean cancelled;
  private volatile boolean finished;
  private long pendingBytes;

  private HttpURLConnection connection;
  private InputStream inputStream;

  public StreamHttp(
    String requestId,
    String url,
    String method,
    JSONObject headers,
    String body,
    boolean bodyIsBase64,
    boolean followRedirects,
    int connectTimeout,
    int readTimeout,
    int chunkSize,
    CallbackContext callback
  ) {
    this.requestId = requestId;
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.body = body;
    this.bodyIsBase64 = bodyIsBase64;
    this.followRedirects = followRedirects;
    this.connectTimeout = connectTimeout;
    this.readTimeout = readTimeout;
    this.chunkSize = chunkSize > 0
      ? Math.min(chunkSize, MAX_CHUNK_SIZE)
      : DEFAULT_CHUNK_SIZE;
    this.callback = callback;
  }

  public static void start(
    String requestId,
    String url,
    String method,
    JSONObject headers,
    String body,
    boolean bodyIsBase64,
    boolean followRedirects,
    int connectTimeout,
    int readTimeout,
    int chunkSize,
    CallbackContext callback
  ) {
    StreamHttp stream = new StreamHttp(
      requestId,
      url,
      method,
      headers,
      body,
      bodyIsBase64,
      followRedirects,
      connectTimeout,
      readTimeout,
      chunkSize,
      callback
    );
    if (STREAMS.size() >= MAX_CONCURRENT_STREAMS) {
      callback.error(
        "Too many concurrent HTTP streams (" +
        MAX_CONCURRENT_STREAMS +
        "). Cancel an active stream or retry later."
      );
      return;
    }
    STREAMS.put(requestId, stream);
    Thread thread = new Thread(stream, "SystemStreamHttp-" + requestId);
    thread.setDaemon(true);
    thread.start();
  }

  /** Acknowledges that JavaScript has consumed {@code bytes} response bytes. */
  public static void ack(String requestId, int bytes) {
    StreamHttp stream = STREAMS.get(requestId);
    if (stream != null) stream.ack(bytes);
  }

  /** Cancels the request and disconnects the underlying connection. */
  public static void cancel(String requestId) {
    StreamHttp stream = STREAMS.get(requestId);
    if (stream != null) stream.cancel();
  }

  /** Cancels every active stream. Used during plugin/app teardown. */
  public static void cancelAll() {
    for (StreamHttp stream : STREAMS.values()) {
      stream.cancel();
    }
  }

  private void ack(int bytes) {
    if (bytes <= 0) return;
    synchronized (creditLock) {
      pendingBytes = Math.max(0, pendingBytes - bytes);
      creditLock.notifyAll();
    }
  }

  private void cancel() {
    cancelled = true;
    synchronized (creditLock) {
      creditLock.notifyAll();
    }
    if (connection != null) {
      try {
        connection.disconnect();
      } catch (Exception e) {
        Log.w(TAG, "Failed to disconnect stream " + requestId, e);
      }
    }
    release();
  }

  private void release() {
    if (finished) return;
    finished = true;
    try {
      PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
      result.setKeepCallback(false);
      callback.sendPluginResult(result);
    } catch (Exception e) {
      Log.w(TAG, "Failed to release stream callback " + requestId, e);
    }
  }

  @Override
  public void run() {
    try {
      if (cancelled) return;
      URL url = new URL(this.url);
      connection = (HttpURLConnection) url.openConnection();
      connection.setRequestMethod(method);
      connection.setInstanceFollowRedirects(followRedirects);
      connection.setConnectTimeout(connectTimeout);
      connection.setReadTimeout(readTimeout);
      connection.setUseCaches(false);

      if (headers != null) {
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          String value = headers.optString(key);
          if (key != null && value != null) {
            connection.setRequestProperty(key, value);
          }
        }
      }

      if (body != null) {
        byte[] bytes = bodyIsBase64
          ? Base64.decode(body, Base64.NO_WRAP)
          : body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        connection.setDoOutput(true);
        OutputStream out = connection.getOutputStream();
        out.write(bytes);
        out.flush();
      }

      if (cancelled) return;

      int status = connection.getResponseCode();
      if (cancelled) return;

      String statusText = connection.getResponseMessage();
      String finalUrl = connection.getURL().toString();
      sendHeaders(status, statusText, finalUrl, connection.getHeaderFields());

      InputStream stream = status >= 400
        ? connection.getErrorStream()
        : connection.getInputStream();
      inputStream = stream;

      if (stream != null) {
        byte[] buffer = new byte[chunkSize];
        int read;
        while (!cancelled && (read = stream.read(buffer)) != -1) {
          if (read <= 0) continue;
          waitForCredit(read);
          if (cancelled) break;
          byte[] chunk = read == buffer.length
            ? buffer
            : java.util.Arrays.copyOf(buffer, read);
          if (read == buffer.length) {
            buffer = new byte[chunkSize];
          }
          // Reserve credit before publishing: ack() can only race against
          // chunks JavaScript has already received, so incrementing here keeps
          // the subtraction in ack() from ever clamping a not-yet-accounted
          // reservation to zero and silently exhausting the credit window.
          synchronized (creditLock) {
            pendingBytes += read;
          }
          sendData(chunk);
        }
      }

      if (!cancelled) {
        sendComplete();
      }
    } catch (Exception e) {
      Log.w(TAG, "Stream " + requestId + " failed", e);
      if (!cancelled && !finished) {
        try {
          sendError(e.getMessage() != null ? e.getMessage() : e.toString());
        } catch (JSONException jsonError) {
          Log.w(TAG, "Failed to send stream error event", jsonError);
        }
      }
    } finally {
      cleanup();
    }
  }

  private void waitForCredit(long bytes) {
    synchronized (creditLock) {
      while (!cancelled && pendingBytes + bytes > CREDIT_WINDOW_BYTES) {
        try {
          creditLock.wait();
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          if (cancelled) return;
        }
      }
    }
  }

  private void sendHeaders(
    int status,
    String statusText,
    String finalUrl,
    Map<String, List<String>> headerFields
  ) throws JSONException {
    JSONObject event = new JSONObject();
    event.put("type", "headers");
    event.put("status", status);
    event.put("statusText", statusText != null ? statusText : "");
    event.put("url", finalUrl != null ? finalUrl : "");

    // Delivered as ordered [name, value] pairs so repeated headers (e.g.
    // Set-Cookie, which cannot be comma joined) survive the JSON bridge.
    JSONArray headerPairs = new JSONArray();
    if (headerFields != null) {
      for (Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
        String name = entry.getKey();
        List<String> values = entry.getValue();
        if (name == null || values == null || values.isEmpty()) {
          continue;
        }
        String lower = name.toLowerCase();
        for (String value : values) {
          if (value == null) continue;
          JSONArray pair = new JSONArray();
          pair.put(lower);
          pair.put(value);
          headerPairs.put(pair);
        }
      }
    }
    event.put("headers", headerPairs);
    sendEvent(event, true);
  }

  private void sendData(byte[] chunk) throws JSONException {
    JSONObject event = new JSONObject();
    event.put("type", "data");
    if (jsonSafe(chunk)) {
      // Byte n as code point n survives the JSON bridge unescaped, avoiding
      // the ~33% base64 inflation and the base64 decode on the JS side.
      event.put("chunk", new String(chunk, StandardCharsets.ISO_8859_1));
    } else {
      event.put("b64", true);
      event.put("chunk", Base64.encodeToString(chunk, Base64.NO_WRAP));
    }
    sendEvent(event, true);
  }

  // True when the chunk has no byte below 0x20, i.e. nothing the JSON encoder
  // is forced to escape (as a U+XXXX sequence) into a larger payload.
  private static boolean jsonSafe(byte[] chunk) {
    for (byte b : chunk) {
      if ((b & 0xFF) < 0x20) return false;
    }
    return true;
  }

  private void sendComplete() throws JSONException {
    JSONObject event = new JSONObject();
    event.put("type", "complete");
    sendEvent(event, false);
  }

  private void sendError(String message) throws JSONException {
    JSONObject event = new JSONObject();
    event.put("type", "error");
    event.put("message", message);
    sendEvent(event, false);
  }

  private void sendEvent(JSONObject event, boolean keepCallback) {
    if (finished) return;
    if (!keepCallback) finished = true;
    PluginResult result = new PluginResult(PluginResult.Status.OK, event);
    result.setKeepCallback(keepCallback);
    callback.sendPluginResult(result);
  }

  private void cleanup() {
    STREAMS.remove(requestId);
    if (inputStream != null) {
      try {
        inputStream.close();
      } catch (IOException ignored) {
      }
    }
    if (connection != null) {
      try {
        connection.disconnect();
      } catch (Exception ignored) {
      }
    }
  }
}
