package com.foxdebug.sftp;

import android.util.Base64;
import android.util.Log;
import com.sshtools.client.SessionChannelNG;
import com.sshtools.client.SshClient;
import com.sshtools.common.ssh.Channel;
import com.sshtools.common.ssh.ChannelEventListener;
import com.sshtools.common.ssh.RequestFuture;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * An interactive SSH shell, streamed to the page.
 *
 * Events sent to the page, which `src/components/terminal/terminal.js` parses:
 * `{type:'ready', sessionId}`, `{type:'data', data:base64}`,
 * `{type:'exit', exitCode}` and `{type:'error', message}`.
 */
final class RemoteShell {

  private static final String TAG = "SFTP";
  private static final long CHANNEL_TIMEOUT_MS = 30000L;

  private final String id;
  private final SshClient client;
  private final SessionChannelNG channel;
  private final CallbackContext streamCallback;
  private final AtomicBoolean finished = new AtomicBoolean(false);
  // Writes go through one thread so two keystrokes cannot interleave on the
  // channel stream.
  private final ExecutorService inputWriter;

  private RemoteShell(
    String id,
    SshClient client,
    SessionChannelNG channel,
    CallbackContext streamCallback
  ) {
    this.id = id;
    this.client = client;
    this.channel = channel;
    this.streamCallback = streamCallback;
    this.inputWriter = Executors.newSingleThreadExecutor(r -> {
      Thread thread = new Thread(r, "sftp-shell-" + id);
      thread.setDaemon(true);
      return thread;
    });
  }

  /**
   * Open a shell on a fresh SSH connection and stream it to the page.
   *
   * @param client connected SSH client, owned by the shell afterwards
   * @param columns terminal width
   * @param rows terminal height
   * @param callback receives stream events for the lifetime of the shell
   * @return the shell, or null when it failed to start
   */
  static RemoteShell open(
    SshClient client,
    int columns,
    int rows,
    CallbackContext callback
  ) throws Exception {
    if (!client.isConnected()) {
      client.close();
      throw new IOException("Failed to establish SSH connection");
    }

    String id = java.util.UUID.randomUUID().toString();
    SessionChannelNG channel;
    try {
      channel = client.openSessionChannel(true);
    } catch (Exception e) {
      client.close();
      throw e;
    }

    RemoteShell shell = new RemoteShell(id, client, channel, callback);
    channel.addEventListener(shell.new Events());

    RequestFuture pty = channel
      .allocatePseudoTerminal("xterm-256color", columns, rows)
      .waitFor(CHANNEL_TIMEOUT_MS);
    if (!pty.isSuccess()) {
      shell.finish(null, "Remote server rejected PTY allocation");
      return null;
    }
    if (shell.finished.get()) return null;

    RequestFuture start = channel.startShell().waitFor(CHANNEL_TIMEOUT_MS);
    if (!start.isSuccess()) {
      shell.finish(null, "Remote server rejected the interactive shell");
      return null;
    }
    if (shell.finished.get()) return null;

    JSONObject ready = new JSONObject();
    ready.put("type", "ready");
    ready.put("sessionId", id);
    sendEvent(callback, ready, true);
    return shell;
  }

  String id() {
    return id;
  }

  boolean isFinished() {
    return finished.get();
  }

  /**
   * Resize the terminal.
   * @param columns new width
   * @param rows new height
   */
  void resize(int columns, int rows) {
    channel.changeTerminalDimensions(columns, rows, 0, 0);
  }

  /**
   * Send input to the shell.
   * @param input text typed at the terminal
   * @param callback resolves once written
   */
  void write(String input, CallbackContext callback) {
    if (finished.get()) {
      callback.error("SSH shell is not connected");
      return;
    }

    try {
      inputWriter.execute(() -> {
        try {
          channel.getOutputStream().write(input.getBytes(StandardCharsets.UTF_8));
          channel.getOutputStream().flush();
          callback.success();
        } catch (IOException e) {
          finish(null, errMessage(e));
          callback.error(errMessage(e));
        }
      });
    } catch (RejectedExecutionException e) {
      callback.error("SSH shell is not connected");
    }
  }

  /** Close the shell, reporting an exit or error event and no further data. */
  void finish(Integer exitCode, String error) {
    if (!finished.compareAndSet(false, true)) return;
    inputWriter.shutdownNow();

    try {
      channel.close();
    } catch (Exception e) {
      Log.w(TAG, "Failed to close SSH shell channel " + id, e);
    }
    try {
      client.close();
    } catch (IOException e) {
      Log.w(TAG, "Failed to close SSH shell connection " + id, e);
    }

    try {
      JSONObject event = new JSONObject();
      event.put("type", error == null ? "exit" : "error");
      if (exitCode != null) event.put("exitCode", exitCode);
      if (error != null) event.put("message", error);
      sendEvent(streamCallback, event, false);
    } catch (JSONException e) {
      streamCallback.error(errMessage(e));
    }
  }

  private void sendData(ByteBuffer source) {
    if (finished.get() || source == null || !source.hasRemaining()) return;

    ByteBuffer data = source.asReadOnlyBuffer();
    byte[] bytes = new byte[data.remaining()];
    data.get(bytes);
    try {
      JSONObject event = new JSONObject();
      event.put("type", "data");
      event.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
      sendEvent(streamCallback, event, true);
    } catch (JSONException e) {
      finish(null, e.getMessage());
    }
  }

  private static void sendEvent(
    CallbackContext callback,
    JSONObject event,
    boolean keepCallback
  ) {
    PluginResult result = new PluginResult(PluginResult.Status.OK, event);
    result.setKeepCallback(keepCallback);
    callback.sendPluginResult(result);
  }

  private static String errMessage(Exception e) {
    String message = e.getMessage();
    return message == null || message.isEmpty() ? e.toString() : message;
  }

  /** Channel callbacks, forwarded to the shell. */
  private final class Events implements ChannelEventListener {

    @Override
    public void onChannelDataIn(Channel source, ByteBuffer data) {
      sendData(data);
    }

    @Override
    public void onChannelExtendedData(
      Channel source,
      ByteBuffer data,
      int type
    ) {
      sendData(data);
    }

    @Override
    public void onChannelClose(Channel source) {
      int exitCode = channel.getExitCode();
      finish(
        exitCode == SessionChannelNG.EXITCODE_NOT_RECEIVED ? null : exitCode,
        null
      );
    }

    @Override
    public void onChannelError(Channel source, Throwable error) {
      finish(null, error == null ? "SSH shell error" : error.toString());
    }
  }
}
