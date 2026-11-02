## HostKeyVerifier.java
```java
package com.foxdebug.sftp;

import android.util.Base64;
import android.util.Log;
import com.sshtools.client.SshClientContext;
import com.sshtools.common.knownhosts.HostKeyVerification;
import com.sshtools.common.ssh.SshException;
import com.sshtools.common.ssh.components.SshPublicKey;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Verifies SSH host keys, trusting a host the first time it is seen and asking
 * before replacing a key that changed.
 *
 * The SSH specification requires a client to reject a key it did not expect.
 * Silently accepting one would make a man-in-the-middle invisible, so a changed
 * key stops the connection unless the person explicitly accepts the new one.
 */
final class HostKeyVerifier {

  private static final String TAG = "SFTP";

  private final SftpSecurityStore securityStore;
  private final WebConfirm confirm;
  private final String endpoint;

  /** Failure recorded during verification, reported to the caller afterwards. */
  private volatile JSONObject failure;

  /**
   * @param securityStore trusted-host storage
   * @param confirm prompt shown when a decision is needed
   * @param endpoint `host:port`, the key trusted-host records are keyed by
   */
  HostKeyVerifier(
    SftpSecurityStore securityStore,
    WebConfirm confirm,
    String endpoint
  ) {
    this.securityStore = securityStore;
    this.confirm = confirm;
    this.endpoint = endpoint;
  }

  /**
   * Apply this verifier and the network policy to a client context.
   * @param sshContext context being configured
   */
  void configure(SshClientContext sshContext) {
    SftpSession.configureClient(sshContext);
    sshContext.setHostKeyVerification(new Verifier());
  }

  /**
   * Hand a recorded failure to the caller, if verification failed.
   * @param callback destination for the error
   * @return true when an error was reported
   */
  boolean reportFailure(ErrorSink sink) {
    JSONObject error = takeFailure();
    if (error == null) return false;
    sink.error(error);
    return true;
  }

  /** Where a recorded failure is delivered; the caller decides how. */
  interface ErrorSink {
    void error(JSONObject error);
  }

  private JSONObject takeFailure() {
    JSONObject error = failure;
    failure = null;
    return error;
  }

  private final class Verifier implements HostKeyVerification {

    @Override
    public boolean verifyHost(String host, SshPublicKey publicKey)
      throws SshException {
      try {
        String fingerprint = publicKey.getFingerprint();
        String algorithm = publicKey.getAlgorithm();
        String encodedKey = Base64.encodeToString(
          publicKey.getEncoded(),
          Base64.NO_WRAP
        );

        JSONObject trusted = securityStore.getKnownHost(endpoint);
        if (trusted == null) return trustNewHost(algorithm, fingerprint, encodedKey);
        return verifyKnownHost(trusted, algorithm, fingerprint, encodedKey);
      } catch (JSONException | InterruptedException e) {
        if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        throw new SshException(
          "Could not verify the SSH host key",
          SshException.HOST_KEY_ERROR,
          e
        );
      }
    }

    /** First connection to this host. */
    private boolean trustNewHost(
      String algorithm,
      String fingerprint,
      String encodedKey
    ) throws JSONException, InterruptedException {
      String message =
        "This is the first connection to " +
        endpoint +
        ".\n\nKey type: " +
        algorithm +
        "\nFingerprint: " +
        fingerprint +
        "\n\nVerify this fingerprint before trusting the host.";

      if (confirm.ask("Unknown SSH host", message, "Trust and connect")) {
        securityStore.trustHost(endpoint, algorithm, fingerprint, encodedKey);
        return true;
      }

      failure = hostKeyFailure("HOST_KEY_REJECTED", fingerprint, null);
      return false;
    }

    /** Host seen before; its key must match the one on record. */
    private boolean verifyKnownHost(
      JSONObject trusted,
      String algorithm,
      String fingerprint,
      String encodedKey
    ) throws JSONException, InterruptedException {
      String expectedFingerprint = trusted.optString("fingerprint");
      String expectedKey = trusted.optString("publicKey");
      boolean matches = !expectedKey.isEmpty()
        ? encodedKey.equals(expectedKey)
        : fingerprint.equals(expectedFingerprint);
      if (matches) return true;

      // Ask before failing. Rejecting outright meant accepting the new key could
      // never take effect: every retry hit the same wall.
      String message =
        "The identity of " +
        endpoint +
        " has changed since you last connected.\n\nExpected: " +
        expectedFingerprint +
        "\nReceived: " +
        fingerprint +
        "\n\nOnly accept this if you changed the server yourself, or you have confirmed the new fingerprint with whoever runs it.";

      if (confirm.ask("SSH host key changed", message, "Trust new key")) {
        // Records are keyed by host, so this replaces the old fingerprint.
        securityStore.trustHost(endpoint, algorithm, fingerprint, encodedKey);
        return true;
      }

      failure = hostKeyFailure(
        "HOST_KEY_CHANGED",
        fingerprint,
        expectedFingerprint
      );
      return false;
    }
  }

  private JSONObject hostKeyFailure(
    String code,
    String fingerprint,
    String expectedFingerprint
  ) throws JSONException {
    JSONObject error = new JSONObject();
    error.put("code", code);
    error.put("host", endpoint);
    error.put("fingerprint", fingerprint);
    if (expectedFingerprint != null) {
      error.put("expectedFingerprint", expectedFingerprint);
    }
    return error;
  }

  /** Log helper kept local so the class has no other dependencies. */
  static void log(String message, Throwable error) {
    Log.w(TAG, message, error);
  }
}

```

## Metadata.java
```java
package com.foxdebug.sftp;

import com.sshtools.common.sftp.SftpFileAttributes;
import java.nio.file.attribute.FileTime;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Converts SFTP attributes into the JSON the page reads.
 *
 * Kept in one place so the two calls that report entries (`lsDir` and `stat`)
 * cannot disagree, and so the conversion rules are stated once.
 */
final class Metadata {

  private Metadata() {}

  /**
   * Describe one file or directory.
   *
   * @param name entry name
   * @param path absolute remote path
   * @param attributes server attributes, may be null
   * @return JSON payload for the page
   */
  static JSONObject describe(
    String name,
    String path,
    SftpFileAttributes attributes
  ) throws JSONException {
    JSONObject entry = new JSONObject();
    entry.put("name", name);
    entry.put("exists", true);

    if (attributes == null) {
      // A server that reports no attributes still has to produce a usable row.
      entry.put("isFile", false);
      entry.put("isDirectory", false);
      entry.put("isLink", false);
      entry.put("url", path);
      entry.put("length", 0);
      entry.put("lastModified", 0);
      return entry;
    }

    String permissions = attributes.toPermissionsString();
    boolean canRead = permissions.length() > 1 && permissions.charAt(1) == 'r';
    boolean canWrite = permissions.length() > 2 && permissions.charAt(2) == 'w';

    entry.put("canRead", canRead);
    entry.put("canWrite", canWrite);
    entry.put("permissions", permissions);
    // A directory reports a block size, not the size of its contents. Sending it
    // made every folder look like a small file when sorted by size.
    entry.put(
      "length",
      attributes.isDirectory() ? 0 : sizeOf(attributes)
    );
    entry.put("url", path);
    entry.put("lastModified", lastModifiedMillis(attributes));
    entry.put("isLink", attributes.isLink());
    entry.put("isDirectory", attributes.isDirectory());
    entry.put("isFile", attributes.isFile());
    return entry;
  }

  /**
   * Mirror an entry whose target should be resolved by the caller (a symlink).
   * @param entry entry to update
   * @param target absolute target path
   */
  static void addLinkTarget(JSONObject entry, String target)
    throws JSONException {
    entry.put("linkTarget", target);
  }

  /**
   * Fill in the attributes of a symlink's target, falling back to "broken link"
   * when the target cannot be read.
   * @param entry entry to update
   * @param attributes target attributes, or null when unreadable
   */
  static void applyLinkTarget(JSONObject entry, SftpFileAttributes attributes)
    throws JSONException {
    if (attributes == null) {
      entry.put("isFile", false);
      entry.put("isDirectory", false);
      entry.put("isLink", false);
      return;
    }
    entry.put("isFile", attributes.isFile());
    entry.put("isDirectory", attributes.isDirectory());
  }

  private static long sizeOf(SftpFileAttributes attributes) {
    try {
      return attributes.size().longValue();
    } catch (RuntimeException e) {
      return 0;
    }
  }

  /**
   * Milliseconds since the epoch, for direct use as a JavaScript `Date`.
   *
   * Serialising Maverick's `FileTime` straight into JSON produced a
   * human-readable string that JavaScript could not parse as a timestamp.
   * @param attributes server attributes
   * @return epoch milliseconds, or 0 when the server does not report a time
   */
  static long lastModifiedMillis(SftpFileAttributes attributes) {
    if (attributes == null || !attributes.hasLastModifiedTime()) return 0;
    try {
      FileTime time = attributes.lastModifiedTime();
      return time == null ? 0 : time.toMillis();
    } catch (RuntimeException e) {
      return 0;
    }
  }
}

```

## RemoteShell.java
```java
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

```

## SftpOperationQueue.java
```java
package com.foxdebug.sftp;

import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs SFTP work one task at a time, in submission order.
 *
 * The SSH/SFTP client is not safe for concurrent use, and a transfer holds a
 * channel open for its whole duration. Cordova dispatches each plug-in call to a
 * different pool thread, so without serialising them a save that overlaps a
 * directory listing interleaves packets on the channel and tears it down
 * ("The channel unexpectedly terminated").
 *
 * The queue is created lazily and recreated after a shutdown, because Cordova
 * can reuse a plugin instance after a WebView reload; a queue left shut down
 * would silently drop every operation and stall every save with no callback.
 */
final class SftpOperationQueue {

  private static final String TAG = "SFTP";

  private final String name;
  private final Object lock = new Object();
  private volatile ExecutorService executor;

  /**
   * @param name thread name, for stack traces and logcat
   */
  SftpOperationQueue(String name) {
    this.name = name;
  }

  /**
   * Submit a task, creating the queue if needed.
   * @param task work to run
   * @return true when the task was accepted
   */
  boolean submit(Runnable task) {
    try {
      executor().execute(task);
      return true;
    } catch (RejectedExecutionException e) {
      // Only reachable while the plugin is being torn down.
      Log.w(TAG, "SFTP operation rejected during shutdown", e);
      return false;
    }
  }

  /**
   * Stop the queue. Any queued work is discarded and the running task is
   * interrupted, because it must not outlive the WebView waiting for it.
   */
  void shutdown() {
    synchronized (lock) {
      ExecutorService current = executor;
      executor = null;
      if (current != null) current.shutdownNow();
    }
  }

  private ExecutorService executor() {
    ExecutorService current = executor;
    if (current != null && !current.isShutdown()) return current;

    synchronized (lock) {
      if (executor == null || executor.isShutdown()) {
        executor = Executors.newSingleThreadExecutor(new NamedFactory(name));
      }
      return executor;
    }
  }

  /** Daemon threads, named so a stuck task is identifiable in a log. */
  private static final class NamedFactory implements ThreadFactory {

    private final String prefix;
    private final AtomicInteger counter = new AtomicInteger();

    private NamedFactory(String prefix) {
      this.prefix = prefix;
    }

    @Override
    public Thread newThread(Runnable runnable) {
      Thread thread = new Thread(
        runnable,
        prefix + "-" + counter.incrementAndGet()
      );
      thread.setDaemon(true);
      return thread;
    }
  }
}

```

## SftpPlugin.java
```java
package com.foxdebug.sftp;

import android.app.Activity;
import android.content.Context;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;
import com.sshtools.client.SshClient;
import com.sshtools.client.sftp.SftpClient;
import com.sshtools.client.sftp.SftpFile;
import com.sshtools.common.publickey.InvalidPassphraseException;
import com.sshtools.common.sftp.SftpFileAttributes;
import com.sshtools.common.ssh.SshException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.FutureTask;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * SFTP and SSH for Cordova on Android.
 *
 * Every action the page can invoke is listed in {@link #execute}. Actions that
 * touch the SSH connection are handed to a single-thread queue, because the
 * client is not safe for concurrent use; the rest run on Cordova's pool.
 */
public class SftpPlugin extends CordovaPlugin {

  private static final String TAG = "SFTP";
  private static final String SERVICE = "Sftp";

  private static final long DEFAULT_CONNECT_TIMEOUT_MS = 10000L;
  private static final long MIN_CONNECT_TIMEOUT_MS = 1000L;
  // Covers the whole attempt, which may pause on a host key prompt.
  private static final long MAX_CONNECT_TIMEOUT_MS = 180000L;

  private static boolean cryptoProviderConfigured;

  private final SftpSession session = new SftpSession();
  private final SftpOperationQueue operations = new SftpOperationQueue(
    "sftp-operations"
  );
  private final Map<String, RemoteShell> shells = new ConcurrentHashMap<>();
  private final Map<String, ConnectionAttempt> attempts = new ConcurrentHashMap<>();

  private Context context;
  private Activity activity;
  private SftpSecurityStore securityStore;
  private WebConfirm confirm;

  @Override
  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    context = cordova.getContext();
    activity = cordova.getActivity();
    securityStore = new SftpSecurityStore(context);
    confirm = new WebConfirm(webView, activity);
    System.setProperty("maverick.log.nothread", "true");
    configureCryptoProvider();
  }

  private static synchronized void configureCryptoProvider() {
    if (cryptoProviderConfigured) return;
    java.security.Security.removeProvider(
      org.bouncycastle.jce.provider.BouncyCastleProvider.PROVIDER_NAME
    );
    java.security.Security.insertProviderAt(
      new org.bouncycastle.jce.provider.BouncyCastleProvider(),
      1
    );
    com.sshtools.common.ssh.components.jce.JCEProvider.enableBouncyCastle(true);
    cryptoProviderConfigured = true;
  }

  @Override
  public void onReset() {
    cancelAttempts();
    closeShells();
    confirm.releaseAll();
    super.onReset();
  }

  @Override
  public void onDestroy() {
    cancelAttempts();
    closeShells();
    confirm.releaseAll();
    operations.shutdown();
    super.onDestroy();
  }

  @Override
  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callback
  ) {
    switch (action) {
      // Lifecycle and storage: never touch the connection.
      case "isConnected":
        answerConnectionState(callback);
        return true;
      case "resolveConfirmation":
        confirm.resolve(args, callback);
        return true;
      case "showToast":
        showToast(args, callback);
        return true;
      case "saveProfile":
        saveProfile(args, callback);
        return true;
      case "editProfile":
        editProfile(args, callback);
        return true;
      case "getProfileInfo":
        getProfileInfo(args, callback);
        return true;
      case "deleteProfile":
        deleteProfile(args, callback);
        return true;

      // Connection attempts have their own cancellation and must not queue
      // behind a running transfer.
      case "connectUsingProfile":
        connect(args, callback, false);
        return true;
      case "testProfile":
        connect(args, callback, true);
        return true;
      case "cancelConnection":
        cancelConnection(args, callback);
        return true;

      // Shells own their own connections.
      case "openShellUsingProfile":
        openShell(args, callback);
        return true;
      case "writeShell":
        return writeShell(args, callback);
      case "resizeShell":
        return resizeShell(args, callback);
      case "closeShell":
        closeShell(args, callback);
        return true;

      // Everything below drives the shared SFTP client, so it is serialised.
      case "exec":
        operations.submit(() -> exec(args, callback));
        return true;
      case "getFile":
        operations.submit(() -> getFile(args, callback));
        return true;
      case "putFile":
        operations.submit(() -> putFile(args, callback));
        return true;
      case "lsDir":
        operations.submit(() -> lsDir(args, callback));
        return true;
      case "stat":
        operations.submit(() -> stat(args, callback));
        return true;
      case "mkdir":
        operations.submit(() -> mkdir(args, callback));
        return true;
      case "rm":
        operations.submit(() -> rm(args, callback));
        return true;
      case "createFile":
        operations.submit(() -> createFile(args, callback));
        return true;
      case "rename":
        operations.submit(() -> rename(args, callback));
        return true;
      case "pwd":
        operations.submit(() -> pwd(callback));
        return true;
      case "close":
        operations.submit(() -> {
          session.close();
          callback.success();
        });
        return true;

      default:
        callback.error("SFTP action is not available: " + action);
        return false;
    }
  }

  /**
   * Report the connection state.
   *
   * The page compares the answer against a profile id and treats anything
   * falsy as disconnected, so this replies with the id when connected and the
   * number 0 when not.
   */
  private void answerConnectionState(CallbackContext callback) {
    String id = session.connectionId();
    if (id == null) callback.success(0);
    else callback.success(id);
  }

  // ---------------------------------------------------------------------
  // connection
  // ---------------------------------------------------------------------

  private void connect(
    JSONArray args,
    CallbackContext callback,
    boolean returnWorkingDirectory
  ) {
    String profileID = args.optString(0);
    String suppliedRequestID = args.optString(1);
    String requestID = suppliedRequestID.isEmpty()
      ? UUID.randomUUID().toString()
      : suppliedRequestID;
    long requested = args.optLong(2, DEFAULT_CONNECT_TIMEOUT_MS);
    long timeout = Math.max(
      MIN_CONNECT_TIMEOUT_MS,
      Math.min(requested, MAX_CONNECT_TIMEOUT_MS)
    );

    ConnectionAttempt attempt = new ConnectionAttempt(callback);
    if (attempts.putIfAbsent(requestID, attempt) != null) {
      callback.error("An SFTP connection with this request ID is already running");
      return;
    }

    FutureTask<Void> task = new FutureTask<Void>(() -> {
      HostKeyVerifier verifier = null;
      try {
        JSONObject profile = securityStore.getProfile(profileID);
        verifier = new HostKeyVerifier(
          securityStore,
          confirm,
          profile.getString("hostname") + ":" + profile.optInt("port", 22)
        );

        com.sshtools.client.SshClient.SshClientBuilder builder =
          SftpSession.builderFor(profile, timeout);
        builder.onConfigure(verifier::configure);

        boolean connected = session.connect(builder, profileID);
        if (attempt.isCancelled()) return null;

        if (connected) {
          if (returnWorkingDirectory) {
            SftpClient client = session.sftp();
            if (client == null) throw new IOException("Connection closed early");
            attempt.success(client.pwd());
          } else {
            attempt.success();
          }
          return null;
        }

        if (!reportSecurityFailure(verifier, attempt)) {
          attempt.error("Failed to establish SSH connection");
        }
      } catch (InvalidPassphraseException e) {
        attempt.error("Invalid passphrase for stored key");
      } catch (Exception e) {
        if (attempt.isCancelled()) return null;
        if (!reportSecurityFailure(verifier, attempt)) {
          attempt.error("Failed to connect SFTP profile: " + errMessage(e));
          Log.e(TAG, "Failed to connect SFTP profile", e);
        }
      } catch (OutOfMemoryError e) {
        session.close();
        attempt.error("Not enough memory to initialize SFTP");
      }
      return null;
    }) {
      @Override
      protected void done() {
        attempts.remove(requestID, attempt);
      }
    };

    attempt.setFuture(task);
    cordova.getThreadPool().execute(task);
  }

  /** Report a host key failure if there is one, so the page can act on it. */
  private boolean reportSecurityFailure(
    HostKeyVerifier verifier,
    ConnectionAttempt attempt
  ) {
    if (verifier == null) return false;
    return verifier.reportFailure(attempt::error);
  }

  private void cancelConnection(JSONArray args, CallbackContext callback) {
    ConnectionAttempt attempt = attempts.get(args.optString(0));
    if (attempt != null) attempt.cancel();
    callback.success();
  }

  private void cancelAttempts() {
    for (ConnectionAttempt attempt : attempts.values()) attempt.cancel();
    attempts.clear();
  }

  // ---------------------------------------------------------------------
  // profiles
  // ---------------------------------------------------------------------

  private void saveProfile(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      try {
        String requestedID = args.optString(0, null);
        if (requestedID != null && !requestedID.isEmpty()) {
          callback.error("Legacy profile import cannot replace a saved profile");
          return;
        }

        String authType = args.optString(4, "password");
        JSONObject profile = new JSONObject();
        profile.put("hostname", args.getString(1));
        profile.put("port", args.optInt(2, 22));
        profile.put("username", args.getString(3));
        profile.put("authType", authType);
        putCredentials(profile, args, authType, null);

        callback.success(securityStore.saveProfile(requestedID, profile));
      } catch (Exception e) {
        callback.error("Could not securely save SFTP profile: " + errMessage(e));
        Log.e(TAG, "Could not save SFTP profile", e);
      }
    });
  }

  private void editProfile(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      try {
        String requestedID = nullableProfileID(args);
        JSONObject existing = requestedID == null
          ? null
          : securityStore.getProfile(requestedID);

        String hostname = args.getString(1).trim();
        int port = args.optInt(2, 22);
        String username = args.getString(3).trim();
        String authType = args.optString(4, "password");
        validateProfile(hostname, username, port);

        JSONObject profile = new JSONObject();
        profile.put("hostname", hostname);
        profile.put("port", port);
        profile.put("username", username);
        profile.put("authType", authType);
        putCredentials(profile, args, authType, existing);

        String profileID = securityStore.saveProfile(requestedID, profile);
        callback.success(profileInfo(profileID, profile));
      } catch (Exception e) {
        callback.error(
          "Could not securely save SFTP profile: " + errMessage(e)
        );
        Log.e(TAG, "Could not save SFTP profile", e);
      }
    });
  }

  /**
   * Copy credentials from the call into the profile.
   *
   * An empty secret on an edit keeps the stored one, so editing a connection
   * does not require re-entering the password or key.
   */
  private void putCredentials(
    JSONObject profile,
    JSONArray args,
    String authType,
    JSONObject existing
  ) throws Exception {
    if ("key".equals(authType)) {
      String keyFile = args.optString(6);
      boolean hadKey = existing != null &&
        "key".equals(existing.optString("authType"));

      if (!keyFile.isEmpty()) {
        profile.put(
          "privateKey",
          Base64.encodeToString(readUri(keyFile), Base64.NO_WRAP)
        );
        profile.put("passphrase", args.optString(7));
      } else if (hadKey) {
        profile.put("privateKey", existing.getString("privateKey"));
        profile.put("passphrase", existing.optString("passphrase"));
      } else {
        throw new IllegalArgumentException("Select a private key file");
      }
      return;
    }

    String password = args.optString(5);
    boolean keepStoredPassword =
      password.isEmpty() &&
      existing != null &&
      "password".equals(existing.optString("authType"));
    profile.put("password", keepStoredPassword ? existing.optString("password") : password);
  }

  private static void validateProfile(String hostname, String username, int port) {
    if (hostname.isEmpty()) throw new IllegalArgumentException(
      "Hostname is required"
    );
    if (username.isEmpty()) throw new IllegalArgumentException(
      "Username is required"
    );
    if (port < 1 || port > 65535) throw new IllegalArgumentException(
      "Port must be between 1 and 65535"
    );
  }

  private void getProfileInfo(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      try {
        String profileID = args.getString(0);
        callback.success(profileInfo(profileID, securityStore.getProfile(profileID)));
      } catch (Exception e) {
        callback.error("Could not read SFTP profile: " + errMessage(e));
      }
    });
  }

  private void deleteProfile(JSONArray args, CallbackContext callback) {
    try {
      // The app confirms before removing the storage this profile belongs to.
      securityStore.deleteProfile(args.optString(0));
      callback.success();
    } catch (Exception e) {
      callback.error("Could not delete SFTP profile: " + errMessage(e));
    }
  }

  private static JSONObject profileInfo(String profileID, JSONObject profile)
    throws JSONException {
    JSONObject info = new JSONObject();
    info.put("profileId", profileID);
    info.put("hostname", profile.getString("hostname"));
    info.put("port", profile.optInt("port", 22));
    info.put("username", profile.getString("username"));
    info.put("authType", profile.optString("authType", "password"));
    return info;
  }

  private static String nullableProfileID(JSONArray args) {
    if (args.length() == 0 || args.isNull(0)) return null;
    String value = args.optString(0, null);
    if (value == null) return null;
    value = value.trim();
    if (
      value.isEmpty() ||
      "null".equalsIgnoreCase(value) ||
      "undefined".equalsIgnoreCase(value)
    ) return null;
    return value;
  }

  private byte[] readUri(String uriString) throws IOException {
    if (uriString == null || uriString.isEmpty()) {
      throw new IOException("Private key file is required");
    }
    try (
      InputStream input = context
        .getContentResolver()
        .openInputStream(android.net.Uri.parse(uriString));
      ByteArrayOutputStream output = new ByteArrayOutputStream()
    ) {
      if (input == null) throw new IOException("Could not open key file");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
      return output.toByteArray();
    }
  }

  // ---------------------------------------------------------------------
  // file operations
  // ---------------------------------------------------------------------

  private void exec(JSONArray args, CallbackContext callback) {
    try {
      SshClient ssh = session.ssh();
      if (ssh == null) {
        callback.error("Not connected");
        return;
      }
      StringBuffer buffer = new StringBuffer();
      int code = ssh.executeCommandWithResult(args.optString(0), buffer);
      JSONObject result = new JSONObject();
      result.put("code", code);
      result.put("result", buffer.toString());
      callback.success(result);
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void getFile(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      long bytes = Transfer.download(
        client,
        context,
        args.optString(0),
        args.optString(1)
      );
      JSONObject result = new JSONObject();
      result.put("bytes", bytes);
      callback.success(result);
    } catch (Exception e) {
      Log.e(TAG, "Error downloading file", e);
      // Only drop the connection when it is really broken. A missing file or
      // a permission error leaves it perfectly usable.
      if (isConnectionError(e)) invalidate(client);
      callback.error("File transfer error: " + errMessage(e));
    }
  }

  private void putFile(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      long bytes = Transfer.upload(
        client,
        context,
        args.optString(1),
        args.optString(0)
      );
      JSONObject result = new JSONObject();
      result.put("bytes", bytes);
      callback.success(result);
    } catch (Exception e) {
      Log.e(TAG, "Error uploading file", e);
      if (isConnectionError(e)) invalidate(client);
      callback.error("Error uploading file: " + errMessage(e));
    }
  }

  private void lsDir(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      JSONArray files = new JSONArray();
      for (SftpFile file : client.ls(args.optString(0))) {
        String name = file.getFilename();
        if (".".equals(name) || "..".equals(name)) continue;
        files.put(describe(client, name, file.getAbsolutePath(), file.attributes()));
      }
      callback.success(files);
    } catch (SshException | RuntimeException e) {
      invalidate(client);
      callback.error(
        "SFTP connection was interrupted. Reconnect and try again."
      );
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void stat(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      String path = sanitizePath(args.optString(0));
      JSONObject entry;
      try {
        entry = describe(client, basename(path), path, client.stat(path));
      } catch (Exception missing) {
        // Report "does not exist" instead of failing: callers use this to test
        // for existence.
        entry = new JSONObject();
        entry.put("exists", false);
        entry.put("url", path);
      }
      callback.success(entry);
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  /** Describe an entry, resolving symlink targets. */
  private JSONObject describe(
    SftpClient client,
    String name,
    String path,
    SftpFileAttributes attributes
  ) throws JSONException {
    JSONObject entry = Metadata.describe(name, path, attributes);
    if (attributes == null || !attributes.isLink()) return entry;

    try {
      String target = client.getSymbolicLinkTarget(path);
      Metadata.addLinkTarget(entry, target);
      Metadata.applyLinkTarget(entry, client.stat(target));
    } catch (Exception broken) {
      // A link pointing nowhere is reported without attributes.
      Metadata.applyLinkTarget(entry, null);
    }
    return entry;
  }

  private void mkdir(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      client.mkdir(args.optString(0));
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void rm(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      client.rm(
        args.optString(0),
        args.optBoolean(1, false),
        args.optBoolean(2, false)
      );
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void createFile(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      String path = args.optString(0);
      if (exists(client, path)) {
        callback.error("File already exists");
        return;
      }
      byte[] content = args.optString(1, "").getBytes(StandardCharsets.UTF_8);
      client.put(new ByteArrayInputStream(content), path);
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void rename(JSONArray args, CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      client.rename(args.optString(0), args.optString(1));
      callback.success();
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private void pwd(CallbackContext callback) {
    SftpClient client = session.sftp();
    if (client == null) {
      callback.error("Not connected");
      return;
    }
    try {
      callback.success(client.pwd());
    } catch (Exception e) {
      callback.error(errMessage(e));
    }
  }

  private static boolean exists(SftpClient client, String path) {
    try {
      return client.stat(path) != null;
    } catch (Exception e) {
      return false;
    }
  }

  private void invalidate(SftpClient client) {
    session.invalidateIfCurrent(client);
  }

  /**
   * True when the error means the connection itself is broken, not just that
   * one operation failed (missing file, permission denied and so on).
   */
  private static boolean isConnectionError(Throwable error) {
    Throwable current = error;
    int depth = 0;
    while (current != null && depth < 10) {
      if (
        current instanceof SshException ||
        current instanceof SocketException ||
        current instanceof EOFException
      ) return true;
      String message = current.getMessage();
      if (message != null) {
        String lower = message.toLowerCase();
        if (
          lower.contains("channel unexpectedly terminated") ||
          lower.contains("connection reset") ||
          lower.contains("broken pipe") ||
          lower.contains("connection closed") ||
          lower.contains("socket closed")
        ) return true;
      }
      current = current.getCause();
      depth++;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // shells
  // ---------------------------------------------------------------------

  private void openShell(JSONArray args, CallbackContext callback) {
    cordova.getThreadPool().execute(() -> {
      HostKeyVerifier verifier = null;
      try {
        JSONObject profile = securityStore.getProfile(args.optString(0));
        verifier = new HostKeyVerifier(
          securityStore,
          confirm,
          profile.getString("hostname") + ":" + profile.optInt("port", 22)
        );

        RemoteShell shell = RemoteShell.open(
          SftpSession.builderFor(profile, DEFAULT_CONNECT_TIMEOUT_MS)
            .onConfigure(verifier::configure)
            .build(),
          Math.max(1, args.optInt(1, 80)),
          Math.max(1, args.optInt(2, 24)),
          callback
        );
        if (shell != null) shells.put(shell.id(), shell);
      } catch (InvalidPassphraseException e) {
        callback.error("Invalid passphrase for stored key");
      } catch (Exception e) {
        if (verifier != null && verifier.reportFailure(callback::error)) return;
        callback.error("Failed to open SSH shell: " + errMessage(e));
        Log.e(TAG, "Failed to open SSH shell from profile", e);
      }
    });
  }

  private boolean writeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = shells.get(args.optString(0));
    if (shell == null || shell.isFinished()) {
      callback.error("SSH shell is not connected");
      return true;
    }
    shell.write(args.optString(1), callback);
    return true;
  }

  private boolean resizeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = shells.get(args.optString(0));
    if (shell == null || shell.isFinished()) {
      callback.error("SSH shell is not connected");
      return true;
    }
    shell.resize(
      Math.max(1, args.optInt(1, 80)),
      Math.max(1, args.optInt(2, 24))
    );
    callback.success();
    return true;
  }

  private void closeShell(JSONArray args, CallbackContext callback) {
    RemoteShell shell = shells.remove(args.optString(0));
    if (shell != null) shell.finish(null, null);
    callback.success();
  }

  private void closeShells() {
    for (RemoteShell shell : shells.values()) shell.finish(null, null);
    shells.clear();
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  private void showToast(JSONArray args, CallbackContext callback) {
    String message = args.optString(0);
    if (message != null && !message.isEmpty()) {
      Toast.makeText(context, message, Toast.LENGTH_LONG).show();
    }
    callback.success();
  }

  /**
   * A connection attempt that can be cancelled, and that reports exactly one
   * outcome however many callbacks arrive.
   */
  private static final class ConnectionAttempt {

    private final CallbackContext callback;
    private final java.util.concurrent.atomic.AtomicBoolean cancelled =
      new java.util.concurrent.atomic.AtomicBoolean(false);
    private final java.util.concurrent.atomic.AtomicBoolean completed =
      new java.util.concurrent.atomic.AtomicBoolean(false);
    private volatile java.util.concurrent.Future<?> future;

    private ConnectionAttempt(CallbackContext callback) {
      this.callback = callback;
    }

    private void setFuture(java.util.concurrent.Future<?> future) {
      this.future = future;
      if (cancelled.get()) future.cancel(true);
    }

    private boolean isCancelled() {
      return cancelled.get();
    }

    private void cancel() {
      cancelled.set(true);
      java.util.concurrent.Future<?> current = future;
      if (current != null) current.cancel(true);
      JSONObject error = new JSONObject();
      try {
        error.put("code", "SFTP_CONNECT_CANCELLED");
        error.put("message", "SFTP connection cancelled");
        error.put("cancelled", true);
        error.put("nonRetryable", true);
      } catch (JSONException ignored) {}
      error(error);
    }

    private void success() {
      if (completed.compareAndSet(false, true)) callback.success();
    }

    private void success(String value) {
      if (completed.compareAndSet(false, true)) callback.success(value);
    }

    private void error(JSONObject error) {
      if (completed.compareAndSet(false, true)) callback.error(error);
    }

    private void error(String message) {
      if (completed.compareAndSet(false, true)) callback.error(message);
    }
  }

  private static String basename(String path) {
    String[] segments = path.split("/");
    return segments.length == 0 ? path : segments[segments.length - 1];
  }

  /**
   * Normalise a remote path so spaces and reserved characters survive the
   * round trip through the page, while separators stay literal.
   */
  private static String sanitizePath(String path) {
    try {
      String decoded = java.net.URLDecoder.decode(
        path,
        StandardCharsets.UTF_8.toString()
      );
      return java.net.URLEncoder.encode(
        decoded,
        StandardCharsets.UTF_8.toString()
      )
        .replace("+", "%20")
        .replace("%2F", "/")
        .replace("%5C", "\\");
    } catch (java.io.UnsupportedEncodingException e) {
      return path;
    }
  }

  static String errMessage(Exception e) {
    String message = e.getMessage();
    return message == null || message.isEmpty() ? e.toString() : message;
  }
}
```

## SftpSecurityStore.java
```java
package com.foxdebug.sftp;

import android.content.Context;
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import java.security.GeneralSecurityException;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

final class SftpSecurityStore {

  static final String PROFILE_PREFIX = "profile-";
  private static final String PROFILE_PREFS = "acode_sftp_profiles_v1";
  private static final String HOST_PREFS = "acode_ssh_known_hosts_v1";

  private final EncryptedPreferenceManager profiles;
  private final EncryptedPreferenceManager knownHosts;

  SftpSecurityStore(Context context) {
    // SSH credentials and trusted-host records must never fall back to plaintext.
    profiles = new EncryptedPreferenceManager(context, PROFILE_PREFS, false);
    knownHosts = new EncryptedPreferenceManager(context, HOST_PREFS, false);
  }

  static boolean isProfileID(String value) {
    return value != null && value.startsWith(PROFILE_PREFIX);
  }

  synchronized String saveProfile(String requestedID, JSONObject profile)
    throws GeneralSecurityException, JSONException {
    String profileID = isProfileID(requestedID)
      ? requestedID
      : PROFILE_PREFIX + UUID.randomUUID();
    if (!profiles.setStringSync(profileID, profile.toString())) {
      throw new GeneralSecurityException("Could not persist SFTP profile");
    }
    return profileID;
  }

  synchronized JSONObject getProfile(String profileID)
    throws GeneralSecurityException, JSONException {
    if (!isProfileID(profileID)) throw new GeneralSecurityException(
      "Invalid SFTP profile ID"
    );
    String storedProfile = profiles.getString(profileID, null);
    if (storedProfile == null) throw new GeneralSecurityException(
      "SFTP profile was not found"
    );
    return new JSONObject(storedProfile);
  }

  synchronized void deleteProfile(String profileID) {
    if (isProfileID(profileID)) profiles.removeSync(profileID);
  }

  synchronized JSONObject getKnownHost(String host) throws JSONException {
    String value = knownHosts.getString(host, null);
    return value == null ? null : new JSONObject(value);
  }

  /**
   * Forget a trusted host, so the next connection asks for confirmation again.
   * @param host `host:port` endpoint
   */
  synchronized void forgetHost(String host) {
    knownHosts.removeSync(host);
  }

  synchronized void trustHost(
    String host,
    String algorithm,
    String fingerprint,
    String publicKey
  ) throws JSONException {
    JSONObject record = new JSONObject();
    record.put("algorithm", algorithm);
    record.put("fingerprint", fingerprint);
    record.put("publicKey", publicKey);
    if (!knownHosts.setStringSync(host, record.toString())) {
      throw new JSONException("Could not persist trusted SSH host");
    }
  }
}

```

## SftpSession.java
```java
package com.foxdebug.sftp;

import android.util.Log;
import com.sshtools.client.SshClient;
import com.sshtools.client.SshClient.SshClientBuilder;
import com.sshtools.client.SshClientContext;
import com.sshtools.client.sftp.SftpClient;
import com.sshtools.client.sftp.SftpClient.SftpClientBuilder;
import com.sshtools.common.policy.FileSystemPolicy;
import com.sshtools.common.ssh.SshException;
import com.sshtools.common.util.UnsignedInteger32;
import java.io.UnsupportedEncodingException;
import org.json.JSONObject;

/**
 * The live SSH connection and its SFTP subsystem.
 *
 * One connection at a time: the plugin interface carries no connection id, so
 * there is nowhere to keep a second one. Everything that touches the client is
 * expected to run on the plugin's operation queue, which serialises access.
 */
final class SftpSession {

  private static final String TAG = "SFTP";

  // Maverick's 16 MB default is allocated in full for every SFTP subsystem.
  // A smaller mobile window keeps connection bursts from exhausting the heap.
  private static final long SFTP_MAX_WINDOW_SIZE = 1024L * 1024L;
  private static final long SFTP_MIN_WINDOW_SIZE = 128L * 1024L;

  // Seconds between keep-alive pings, so idle connections are not dropped by
  // mobile networks, NAT or the server.
  private static final int KEEP_ALIVE_INTERVAL_SECONDS = 30;

  private final Object lock = new Object();
  private SshClient ssh;
  private SftpClient sftp;
  private String connectionId;

  /**
   * Connect using an already configured builder.
   *
   * Any existing connection is closed first: the interface has no room for a
   * second one, and a half-open previous connection would be worse than none.
   *
   * @param builder configured client builder
   * @param id identifier reported to the page while connected
   * @return true when the connection and subsystem are both live
   */
  boolean connect(SshClientBuilder builder, String id) throws Exception {
    synchronized (lock) {
      close();
      SshClient client = builder.build();
      if (!client.isConnected()) {
        closeClient(client);
        return false;
      }

      SftpClient subsystem;
      try {
        subsystem = SftpClientBuilder.create().withClient(client).build();
      } catch (Exception e) {
        closeClient(client);
        throw e;
      }

      try {
        subsystem.getSubsystemChannel().setCharsetEncoding("UTF-8");
      } catch (UnsupportedEncodingException | SshException e) {
        Log.w(TAG, "Failed to set UTF-8 encoding, using the default", e);
      }

      ssh = client;
      sftp = subsystem;
      connectionId = id;
      return true;
    }
  }

  /**
   * The connected SFTP client, or null when there is no live connection.
   * @return client
   */
  SftpClient sftp() {
    synchronized (lock) {
      if (sftp == null || ssh == null || !ssh.isConnected() || sftp.isClosed()) {
        return null;
      }
      return sftp;
    }
  }

  /**
   * The identifier reported while connected, or null.
   * @return connection id
   */
  String connectionId() {
    synchronized (lock) {
      return connectionId;
    }
  }

  /**
   * A connected SSH client, for callers that need the whole connection
   * (running a command).
   * @return client, or null
   */
  SshClient ssh() {
    synchronized (lock) {
      return ssh;
    }
  }

  /** Close the connection and subsystem, ignoring errors. */
  void close() {
    synchronized (lock) {
      SftpClient previousSftp = sftp;
      SshClient previousSsh = ssh;
      sftp = null;
      ssh = null;
      connectionId = null;

      if (previousSftp != null) {
        try {
          previousSftp.quit();
        } catch (Exception e) {
          Log.w(TAG, "Failed to close the SFTP subsystem", e);
        }
      }
      closeClient(previousSsh);
    }
  }

  /**
   * Drop the connection only if it is still the one that failed, so a newer
   * connection is not closed by a stale failure.
   * @param failed client that failed
   */
  void invalidateIfCurrent(SftpClient failed) {
    synchronized (lock) {
      if (failed == null || failed != sftp) return;
      Log.w(TAG, "Invalidating a failed SFTP connection");
      close();
    }
  }

  private static void closeClient(SshClient client) {
    if (client == null) return;
    try {
      client.close();
    } catch (Exception e) {
      Log.w(TAG, "Failed to close the SSH connection", e);
    }
  }

  /**
   * Apply the mobile-friendly transfer window sizes and keep-alive to a client
   * context.
   * @param sshContext context being configured
   */
  static void configureClient(SshClientContext sshContext) {
    FileSystemPolicy policy = sshContext.getPolicy(FileSystemPolicy.class);
    policy.setSftpMaxWindowSize(new UnsignedInteger32(SFTP_MAX_WINDOW_SIZE));
    policy.setSftpMinWindowSize(new UnsignedInteger32(SFTP_MIN_WINDOW_SIZE));
    policy.setMaximumNumberofAsyncSFTPRequests(4);
    sshContext.setKeepAliveInterval(KEEP_ALIVE_INTERVAL_SECONDS);
  }

  /**
   * Build a client builder for a stored profile.
   * @param profile stored credentials
   * @param connectTimeout timeout in milliseconds
   * @return configured builder
   */
  static SshClientBuilder builderFor(JSONObject profile, long connectTimeout)
    throws Exception {
    SshClientBuilder builder = SshClientBuilder.create()
      .withHostname(profile.getString("hostname"))
      .withPort(profile.optInt("port", 22))
      .withConnectTimeout(connectTimeout)
      .withUsername(profile.getString("username"));

    if ("key".equals(profile.optString("authType"))) {
      byte[] privateKey = android.util.Base64.decode(
        profile.getString("privateKey"),
        android.util.Base64.NO_WRAP
      );
      builder.withIdentities(
        com.sshtools.common.publickey.SshKeyUtils.getPrivateKey(
          new java.io.ByteArrayInputStream(privateKey),
          profile.optString("passphrase")
        )
      );
    } else {
      builder.withPassword(profile.optString("password"));
    }
    return builder;
  }
}
```

## Transfer.java
```java
package com.foxdebug.sftp;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import com.sshtools.client.sftp.SftpClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Reads and writes file content for transfers between the device and the server.
 *
 * Local paths arrive from the page as either a `file://` path or a `content://`
 * URI, so the caller hands over a `Uri` and this resolves whichever form was
 * given. The previous implementation assumed `content://` unconditionally, which
 * fails for a plain path.
 */
final class Transfer {

  private static final int BUFFER_SIZE = 32768;

  private Transfer() {}

  /**
   * Download a remote file into a local destination.
   *
   * @param sftp connected client
   * @param context application context, for the content resolver
   * @param remotePath absolute remote path
   * @param localUri destination, as a `file://` or `content://` URI
   * @return bytes written
   */
  static long download(
    SftpClient sftp,
    Context context,
    String remotePath,
    String localUri
  ) throws Exception {
    Uri uri = Uri.parse(localUri);

    try (
      InputStream input = sftp.getInputStream(remotePath);
      OutputStream output = openLocalOutput(context, uri, localUri, "wt")
    ) {
      return copy(input, output);
    }
  }

  /**
   * Upload a local file to a remote destination.
   *
   * @param sftp connected client
   * @param context application context, for the content resolver
   * @param localUri source, as a `file://` or `content://` URI
   * @param remotePath absolute remote path
   * @return bytes read
   */
  static long upload(
    SftpClient sftp,
    Context context,
    String localUri,
    String remotePath
  ) throws Exception {
    Uri uri = Uri.parse(localUri);

    try (
      InputStream input = openLocalInput(context, uri, localUri);
      OutputStream output = sftp.getOutputStream(remotePath)
    ) {
      return copy(input, output);
    }
  }

  /**
   * Open a local file for reading, accepting either URI form.
   * @param context application context
   * @param uri parsed uri
   * @param raw original string, used in error messages
   */
  static InputStream openLocalInput(Context context, Uri uri, String raw)
    throws IOException {
    if ("file".equals(uri.getScheme())) {
      return new FileInputStream(fileFor(uri, raw));
    }

    InputStream input = context.getContentResolver().openInputStream(uri);
    if (input == null) throw new IOException("Could not open " + raw);
    return input;
  }

  /**
   * Open a local file for writing, accepting either URI form.
   * @param context application context
   * @param uri parsed uri
   * @param raw original string, used in error messages
   * @param mode content-resolver mode, e.g. `wt` to truncate
   */
  static OutputStream openLocalOutput(
    Context context,
    Uri uri,
    String raw,
    String mode
  ) throws IOException {
    if ("file".equals(uri.getScheme())) {
      return new FileOutputStream(fileFor(uri, raw));
    }

    ContentResolver resolver = context.getContentResolver();
    OutputStream output = resolver.openOutputStream(uri, mode);
    if (output == null) throw new IOException("Could not write " + raw);
    return output;
  }

  private static File fileFor(Uri uri, String raw) throws IOException {
    String path = uri.getPath();
    if (path == null) throw new IOException("Invalid local path: " + raw);
    return new File(path);
  }

  private static long copy(InputStream input, OutputStream output)
    throws IOException {
    byte[] buffer = new byte[BUFFER_SIZE];
    long total = 0;
    int read;
    while ((read = input.read(buffer)) != -1) {
      output.write(buffer, 0, read);
      total += read;
    }
    output.flush();
    return total;
  }
}

```

## WebConfirm.java
```java
package com.foxdebug.sftp;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Asks the page for a yes/no answer and waits for it.
 *
 * Prompts run in the WebView rather than as platform dialogs: Acode sets
 * `colorAccent` to `#FFFFFF`, so Android dialog buttons are drawn white on
 * white, and they sit behind the WebView where taps do not reach them.
 *
 * The bridge is: native calls `window.__acodeSftpConfirm(request)`, the page
 * answers with `sftp.resolveConfirmation(id, confirmed)`.
 */
final class WebConfirm {

  private static final String TAG = "SFTP";
  private static final String SERVICE = "Sftp";
  private static final long TIMEOUT_MS = 120000L;

  /** A prompt with no answer yet, keyed by request id. */
  private final Map<String, Consumer<Object>> pending = new ConcurrentHashMap<>();
  private final CordovaWebView webView;
  private final Activity activity;

  WebConfirm(CordovaWebView webView, Activity activity) {
    this.webView = webView;
    this.activity = activity;
  }

  /**
   * Show a confirmation and block until it is answered.
   *
   * Blocking is deliberate: the caller needs the answer to decide whether a
   * connection may proceed, so it cannot continue on a callback.
   *
   * @param title heading
   * @param message body text, newlines preserved
   * @param acceptLabel label for the confirming button
   * @return true when the person confirmed
   */
  boolean ask(String title, String message, String acceptLabel)
    throws InterruptedException {
    if (activity == null || activity.isFinishing()) return false;

    CountDownLatch decision = new CountDownLatch(1);
    AtomicBoolean confirmed = new AtomicBoolean(false);

    Consumer<Object> answer = (result) -> {
      confirmed.set(
        result instanceof JSONObject &&
        ((JSONObject) result).optBoolean("confirmed", false)
      );
      decision.countDown();
    };

    try {
      show(title, message, acceptLabel, answer);
    } catch (RuntimeException e) {
      Log.w(TAG, "Could not show the confirmation", e);
      decision.countDown();
    }

    // A prompt lost to a configuration change must not wedge the connection.
    if (!decision.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
      Log.w(TAG, "Confirmation timed out: " + title);
      return false;
    }
    return confirmed.get();
  }

  /**
   * Receive the page's answer to a prompt.
   * @param args `[requestId, confirmed]`
   */
  void resolve(JSONArray args, CallbackContext callback) {
    String requestId = args.optString(0);
    Consumer<Object> waiting = pending.remove(requestId);
    if (waiting == null) {
      callback.error("Unknown confirmation request");
      return;
    }

    JSONObject result = new JSONObject();
    try {
      result.put("confirmed", args.optBoolean(1, false));
    } catch (JSONException e) {
      // Read as "no" by the caller.
    }
    waiting.accept(result);
    callback.success();
  }

  /**
   * Release every waiting prompt, so a connection blocked on one finishes when
   * the page goes away.
   */
  void releaseAll() {
    for (Consumer<Object> waiting : pending.values()) waiting.accept(null);
    pending.clear();
  }

  private void show(
    String title,
    String message,
    String acceptLabel,
    Consumer<Object> onResult
  ) {
    if (webView == null) throw new IllegalStateException("WebView is not ready");

    String requestId = "sftp-confirm-" + UUID.randomUUID();
    pending.put(requestId, onResult);

    JSONObject request = new JSONObject();
    try {
      request.put("id", requestId);
      request.put("title", title);
      request.put("message", message);
      request.put("acceptLabel", acceptLabel);
      request.put("cancelLabel", "Cancel");
    } catch (JSONException e) {
      pending.remove(requestId);
      throw new IllegalStateException("Could not build the confirmation", e);
    }

    // Base64: the payload carries a fingerprint and free text, which must not
    // be spliced into a javascript: URL verbatim.
    String encoded = Base64.encodeToString(
      request.toString().getBytes(StandardCharsets.UTF_8),
      Base64.NO_WRAP
    );
    String fail =
      "function(){cordova.exec(null,null,'" +
      SERVICE +
      "','resolveConfirmation',['" +
      requestId +
      "',false]);}";
    String script =
      "javascript:(function(){" +
      "var fail=" +
      fail +
      ";" +
      "if(!window.__acodeSftpConfirm){fail();return;}" +
      "try{window.__acodeSftpConfirm(JSON.parse(" +
      "decodeURIComponent(escape(window.atob('" +
      encoded +
      "')))));}catch(e){fail();}" +
      "})()";

    new Handler(Looper.getMainLooper()).post(
      () -> {
        try {
          webView.loadUrl(script);
        } catch (RuntimeException e) {
          Log.e(TAG, "Could not dispatch the confirmation", e);
          Consumer<Object> waiting = pending.remove(requestId);
          if (waiting != null) waiting.accept(null);
        }
      }
    );
  }
}

```

