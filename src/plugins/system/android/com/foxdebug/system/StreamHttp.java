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
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Incrementally streams an HTTP response body to JavaScript.
 *
 * <p>The request runs on a dedicated background thread (never the UI thread).
 * Response bytes are forwarded to the bridge as they arrive, base64 encoded so
 * they survive the JSON bridge, and the native layer performs no SSE/LLM
 * specific parsing: chunk boundaries are arbitrary and may split multi-byte
 * UTF-8 characters or SSE frames.
 *
 * <p>Events emitted to JS (JSON object with a {@code type} field):
 * <ul>
 *   <li>{@code headers} - status, statusText, url and response headers</li>
 *   <li>{@code data} - a base64 encoded byte chunk</li>
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
  private static final int DEFAULT_CHUNK_SIZE = 8192;
  private static final int MAX_CHUNK_SIZE = 100 * 1024;

  private static final int MAX_CONCURRENT_STREAMS = 50;

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

  private final Object pauseLock = new Object();
  private volatile boolean paused;
  private volatile boolean cancelled;
  private volatile boolean finished;

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

  /** Tells the reader thread to stop reading from the socket (bounded buffering). */
  public static void pause(String requestId) {
    StreamHttp stream = STREAMS.get(requestId);
    if (stream != null) stream.pause();
  }

  /** Tells the reader thread to resume reading from the socket. */
  public static void resume(String requestId) {
    StreamHttp stream = STREAMS.get(requestId);
    if (stream != null) stream.resume();
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

  private void pause() {
    synchronized (pauseLock) {
      paused = true;
    }
  }

  private void resume() {
    synchronized (pauseLock) {
      paused = false;
      pauseLock.notifyAll();
    }
  }

  private void cancel() {
    cancelled = true;
    synchronized (pauseLock) {
      pauseLock.notifyAll();
    }
    if (connection != null) {
      try {
        connection.disconnect();
      } catch (Exception e) {
        Log.w(TAG, "Failed to disconnect stream " + requestId, e);
      }
    }
  }

  @Override
  public void run() {
    try {
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

      int status = connection.getResponseCode();
      String statusText = connection.getResponseMessage();
      String finalUrl = connection.getURL().toString();
      sendHeaders(status, statusText, finalUrl, connection.getHeaderFields());

      InputStream stream = status >= 400
        ? connection.getErrorStream()
        : connection.getInputStream();
      if (stream == null) {
        stream = connection.getInputStream();
      }
      inputStream = stream;

      byte[] buffer = new byte[chunkSize];
      int read;
      while (!cancelled && (read = stream.read(buffer)) != -1) {
        waitWhilePaused();
        if (cancelled) break;
        if (read > 0) {
          byte[] chunk = new byte[read];
          java.lang.System.arraycopy(buffer, 0, chunk, 0, read);
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

  private void waitWhilePaused() {
    synchronized (pauseLock) {
      while (paused && !cancelled) {
        try {
          pauseLock.wait();
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          return;
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

    JSONObject headersJson = new JSONObject();
    if (headerFields != null) {
      for (Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
        String name = entry.getKey();
        List<String> values = entry.getValue();
        if (name == null || values == null || values.isEmpty()) {
          continue;
        }
        StringBuilder joined = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
          if (i > 0) joined.append(", ");
          joined.append(values.get(i));
        }
        headersJson.put(name.toLowerCase(), joined.toString());
      }
    }
    event.put("headers", headersJson);
    sendEvent(event, true);
  }

  private void sendData(byte[] chunk) throws JSONException {
    JSONObject event = new JSONObject();
    event.put("type", "data");
    event.put("chunk", Base64.encodeToString(chunk, Base64.NO_WRAP));
    sendEvent(event, true);
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
